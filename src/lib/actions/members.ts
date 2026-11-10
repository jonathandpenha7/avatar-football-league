"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { siteUrl } from "@/lib/supabase/env";
import { getTournamentContext, requireSession } from "@/lib/data/session";
import { inviteSchema } from "@/lib/validation";
import type { ActionResult } from "@/lib/types";
import { UUID, dbError, invalid, ok, refreshTournament } from "./utils";

export interface InviteResult {
  link: string;
  emailed: boolean;
  emailNote: string;
}

/**
 * Create an invitation. If a service-role key is configured, Supabase Auth
 * emails the person; otherwise the organiser copies the link and sends it.
 */
export async function inviteMember(tournamentId: string, input: unknown): Promise<ActionResult<InviteResult>> {
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const ctx = await getTournamentContext(tournamentId);
  if (!ctx.isAdmin) return { ok: false, error: "Only tournament admins can invite organisers." };
  const { data, error } = await ctx.supabase
    .from("tournament_invitations")
    .insert({ tournament_id: tournamentId, email: parsed.data.email, role: parsed.data.role, invited_by: ctx.profile.id })
    .select("token")
    .single();
  if (error) return dbError(error);
  const link = `${siteUrl()}/invite/${data.token}`;

  let emailed = false;
  let emailNote = "Email sending is not configured. Copy the link and send it yourself.";
  const admin = createAdminClient();
  if (admin) {
    const { error: mailError } = await admin.auth.admin.inviteUserByEmail(parsed.data.email, {
      redirectTo: `${siteUrl()}/auth/callback?next=${encodeURIComponent(`/invite/${data.token}`)}`,
      data: { invited_to: ctx.tournament.name },
    });
    if (!mailError) {
      emailed = true;
      emailNote = "Invitation email sent.";
    } else if (/already been registered|already registered|exists/i.test(mailError.message)) {
      emailNote = "This person already has an account. Send them the link to accept.";
    } else {
      emailNote = `Could not send the email (${mailError.message}). Copy the link and send it yourself.`;
    }
  }
  refreshTournament(tournamentId);
  return ok({ link, emailed, emailNote });
}

export async function revokeInvitation(tournamentId: string, invitationId: string): Promise<ActionResult> {
  if (!UUID.test(invitationId)) return { ok: false, error: "Invalid invitation." };
  const { supabase } = await requireSession();
  const { error } = await supabase
    .from("tournament_invitations")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", invitationId)
    .eq("tournament_id", tournamentId);
  if (error) return dbError(error);
  refreshTournament(tournamentId);
  return ok(undefined, "Invitation revoked.");
}

export async function updateMemberRole(tournamentId: string, memberId: string, role: string): Promise<ActionResult> {
  const r = z.enum(["tournament_admin", "referee", "scorekeeper", "viewer"]).safeParse(role);
  if (!r.success || !UUID.test(memberId)) return { ok: false, error: "Invalid input." };
  const ctx = await getTournamentContext(tournamentId);
  if (r.data !== "tournament_admin") {
    const { data: admins } = await ctx.supabase
      .from("tournament_members")
      .select("id")
      .eq("tournament_id", tournamentId)
      .eq("role", "tournament_admin");
    if ((admins ?? []).length === 1 && admins![0].id === memberId) {
      return { ok: false, error: "A tournament needs at least one Tournament Admin." };
    }
  }
  const { error } = await ctx.supabase.from("tournament_members").update({ role: r.data }).eq("id", memberId).eq("tournament_id", tournamentId);
  if (error) return dbError(error);
  refreshTournament(tournamentId);
  return ok(undefined, "Role updated.");
}

export async function removeMember(tournamentId: string, memberId: string): Promise<ActionResult> {
  if (!UUID.test(memberId)) return { ok: false, error: "Invalid member." };
  const ctx = await getTournamentContext(tournamentId);
  const { data: member } = await ctx.supabase.from("tournament_members").select("role, user_id").eq("id", memberId).single();
  if (member?.role === "tournament_admin") {
    const { count } = await ctx.supabase
      .from("tournament_members")
      .select("id", { count: "exact", head: true })
      .eq("tournament_id", tournamentId)
      .eq("role", "tournament_admin");
    if ((count ?? 0) <= 1) return { ok: false, error: "A tournament needs at least one Tournament Admin." };
  }
  if (member) {
    const { error: offError } = await ctx.supabase
      .from("match_officials")
      .delete()
      .eq("tournament_id", tournamentId)
      .eq("user_id", member.user_id);
    if (offError) return dbError(offError);
  }
  const { error } = await ctx.supabase.from("tournament_members").delete().eq("id", memberId).eq("tournament_id", tournamentId);
  if (error) return dbError(error);
  refreshTournament(tournamentId);
  return ok(undefined, "Member removed.");
}

export async function acceptInvitation(token: string): Promise<ActionResult<{ tournamentId: string }>> {
  if (!UUID.test(token)) return { ok: false, error: "This invitation link is not valid." };
  const { supabase } = await requireSession();
  const { data, error } = await supabase.rpc("accept_invitation", { p_token: token });
  if (error) return dbError(error);
  revalidatePath("/", "layout");
  return ok({ tournamentId: data as string });
}

export async function setPlatformFlags(
  userId: string,
  flags: { is_super_admin?: boolean; can_create_tournaments?: boolean },
): Promise<ActionResult> {
  if (!UUID.test(userId)) return { ok: false, error: "Invalid user." };
  const { supabase, profile } = await requireSession();
  if (!profile.is_super_admin) return { ok: false, error: "Only Super Admins can manage users." };
  const { error } = await supabase.from("profiles").update(flags).eq("id", userId);
  if (error) return dbError(error);
  revalidatePath("/admin/users");
  return ok(undefined, "User permissions updated.");
}

export async function addExistingUserToTournament(
  tournamentId: string,
  userId: string,
  role: string,
): Promise<ActionResult> {
  const r = z.enum(["tournament_admin", "referee", "scorekeeper", "viewer"]).safeParse(role);
  if (!r.success || !UUID.test(userId)) return { ok: false, error: "Invalid input." };
  const { supabase, profile } = await requireSession();
  const { error } = await supabase
    .from("tournament_members")
    .insert({ tournament_id: tournamentId, user_id: userId, role: r.data, created_by: profile.id });
  if (error) return dbError(error);
  refreshTournament(tournamentId);
  revalidatePath("/admin/users");
  return ok(undefined, "Added to tournament.");
}
