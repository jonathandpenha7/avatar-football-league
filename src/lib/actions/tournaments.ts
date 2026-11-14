"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession, getTournamentContext } from "@/lib/data/session";
import { getTemplate } from "@/lib/templates";
import { blockedPeriodSchema, createTournamentSchema, generalSchema, pitchSchema, settingsSchema } from "@/lib/validation";
import type { ActionResult } from "@/lib/types";
import { UUID, dbError, invalid, ok, refreshTournament } from "./utils";

export async function createTournament(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = createTournamentSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { supabase } = await requireSession();
  const v = parsed.data;
  const template = getTemplate(v.templateKey);

  const { data, error } = await supabase.rpc("create_tournament", {
    p: {
      tournament: { ...v.general, format: v.format, template_key: template?.key ?? null },
      settings: v.settings,
      pitches: v.pitches,
      teams: v.teamNames.map((name) => ({ name, is_placeholder: /^Team \d+$/.test(name) })),
      rules: template?.rules ?? [],
      decisions: template?.decisions ?? [],
    },
  });
  if (error) return dbError(error);
  revalidatePath("/", "layout");
  return ok({ id: data as string });
}

export async function updateGeneral(tournamentId: string, input: unknown): Promise<ActionResult> {
  const parsed = generalSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { supabase } = await requireSession();
  const v = parsed.data;
  const { error } = await supabase
    .from("tournaments")
    .update({ ...v, archived_at: v.status === "archived" ? new Date().toISOString() : null })
    .eq("id", tournamentId);
  if (error) return dbError(error);
  refreshTournament(tournamentId);
  revalidatePath("/tournaments");
  return ok(undefined, "Tournament details saved.");
}

export async function updateSettings(tournamentId: string, input: unknown): Promise<ActionResult> {
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { supabase } = await requireSession();
  const { error, count } = await supabase
    .from("tournament_settings")
    .update(parsed.data, { count: "exact" })
    .eq("tournament_id", tournamentId);
  if (error) return dbError(error);
  if (count === 0) return { ok: false, error: "You do not have permission to change these settings." };
  refreshTournament(tournamentId);
  return ok(undefined, "Settings saved.");
}

export async function updateFormat(tournamentId: string, format: string): Promise<ActionResult> {
  const f = z.enum(["round_robin", "league_playoff", "single_elimination", "double_elimination", "group_knockout"]).safeParse(format);
  if (!f.success) return { ok: false, error: "Unknown format." };
  const ctx = await getTournamentContext(tournamentId);
  const { count } = await ctx.supabase
    .from("fixtures")
    .select("id", { count: "exact", head: true })
    .eq("tournament_id", tournamentId)
    .neq("status", "scheduled");
  if ((count ?? 0) > 0) return { ok: false, error: "Matches have already started, so the format can no longer change." };
  const { error } = await ctx.supabase.from("tournaments").update({ format: f.data }).eq("id", tournamentId);
  if (error) return dbError(error);
  refreshTournament(tournamentId);
  return ok(undefined, "Format updated. Regenerate fixtures to apply it.");
}

const publishSchema = z.object({
  public_enabled: z.boolean().optional(),
  rules_published: z.boolean().optional(),
  fixtures_published: z.boolean().optional(),
  registration_open: z.boolean().optional(),
});

export async function setPublishing(tournamentId: string, input: unknown): Promise<ActionResult> {
  const parsed = publishSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { supabase } = await requireSession();
  const { error, count } = await supabase
    .from("tournaments")
    .update(parsed.data, { count: "exact" })
    .eq("id", tournamentId);
  if (error) return dbError(error);
  if (count === 0) return { ok: false, error: "You do not have permission to change this." };
  refreshTournament(tournamentId);
  return ok();
}

export async function regenerateRegistrationLink(tournamentId: string): Promise<ActionResult> {
  const { supabase } = await requireSession();
  const { error } = await supabase
    .from("tournaments")
    .update({ registration_token: crypto.randomUUID() })
    .eq("id", tournamentId);
  if (error) return dbError(error);
  refreshTournament(tournamentId);
  return ok(undefined, "A new registration link was created. The old link no longer works.");
}

export async function setLogoUrl(tournamentId: string, url: string | null): Promise<ActionResult> {
  if (url && !/^https:\/\//.test(url)) return { ok: false, error: "Invalid image URL." };
  const { supabase } = await requireSession();
  const { error } = await supabase.from("tournaments").update({ logo_url: url }).eq("id", tournamentId);
  if (error) return dbError(error);
  refreshTournament(tournamentId);
  return ok();
}

export async function savePitches(
  tournamentId: string,
  pitches: { id?: string | null; name: string; available_from?: string | null; available_until?: string | null }[],
): Promise<ActionResult> {
  const parsed = z.array(pitchSchema.extend({ id: z.string().uuid().optional().nullable() })).min(1, "Keep at least one pitch").safeParse(pitches);
  if (!parsed.success) return invalid(parsed.error);
  const names = parsed.data.map((p) => p.name.toLowerCase());
  if (new Set(names).size !== names.length) return { ok: false, error: "Pitch names must be unique." };
  const { supabase } = await requireSession();
  const { data: existing, error: loadError } = await supabase.from("pitches").select("id").eq("tournament_id", tournamentId);
  if (loadError) return dbError(loadError);
  const keep = new Set(parsed.data.map((p) => p.id).filter(Boolean));
  const remove = (existing ?? []).map((p) => p.id as string).filter((id) => !keep.has(id));
  if (remove.length) {
    const { error } = await supabase.from("pitches").delete().in("id", remove);
    if (error) return dbError(error);
  }
  for (const [i, p] of parsed.data.entries()) {
    const row = { tournament_id: tournamentId, name: p.name, available_from: p.available_from, available_until: p.available_until, sort_order: i + 1 };
    const { error } = p.id
      ? await supabase.from("pitches").update(row).eq("id", p.id)
      : await supabase.from("pitches").insert(row);
    if (error) return dbError(error);
  }
  refreshTournament(tournamentId);
  return ok(undefined, "Pitches saved.");
}

export async function cloneTournament(
  tournamentId: string,
  input: { name: string; startDate?: string | null; copyTeams: boolean; archiveSource: boolean },
): Promise<ActionResult<{ id: string }>> {
  const parsed = z
    .object({
      name: z.string().trim().min(2).max(120),
      startDate: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("")]).optional().nullable(),
      copyTeams: z.boolean(),
      archiveSource: z.boolean(),
    })
    .safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { supabase } = await requireSession();
  const { data, error } = await supabase.rpc("clone_tournament", {
    p_source: tournamentId,
    p_name: parsed.data.name,
    p_start_date: parsed.data.startDate || null,
    p_copy_teams: parsed.data.copyTeams,
  });
  if (error) return dbError(error);
  if (parsed.data.archiveSource) {
    const { error: archiveError } = await supabase
      .from("tournaments")
      .update({ status: "archived", archived_at: new Date().toISOString() })
      .eq("id", tournamentId);
    if (archiveError) return dbError(archiveError);
  }
  revalidatePath("/", "layout");
  return ok({ id: data as string });
}

export async function deleteTournament(tournamentId: string, confirmName: string): Promise<ActionResult> {
  const { supabase } = await requireSession();
  const { error } = await supabase.rpc("delete_tournament", { p_tournament: tournamentId, p_confirm_name: confirmName });
  if (error) return dbError(error);
  revalidatePath("/", "layout");
  redirect("/tournaments");
}

export async function resolveDecision(
  tournamentId: string,
  decisionId: string,
  resolution: string | null,
): Promise<ActionResult> {
  if (!UUID.test(decisionId)) return { ok: false, error: "Invalid decision." };
  const text = resolution?.trim() ?? null;
  if (text !== null && (text.length < 1 || text.length > 2000)) return { ok: false, error: "Enter the decision." };
  const { supabase, profile } = await requireSession();
  const { error } = await supabase
    .from("tournament_decisions")
    .update(
      text
        ? { status: "resolved", resolution: text, resolved_by: profile.id, resolved_at: new Date().toISOString() }
        : { status: "open", resolution: null, resolved_by: null, resolved_at: null },
    )
    .eq("id", decisionId)
    .eq("tournament_id", tournamentId);
  if (error) return dbError(error);
  refreshTournament(tournamentId);
  return ok(undefined, text ? "Decision recorded. Update the related rule or setting if needed." : "Decision reopened.");
}

export async function addDecision(tournamentId: string, question: string, context: string | null): Promise<ActionResult> {
  const q = question.trim();
  if (q.length < 5 || q.length > 500) return { ok: false, error: "Enter the question (5 to 500 characters)." };
  const { supabase } = await requireSession();
  const { error } = await supabase.from("tournament_decisions").insert({
    tournament_id: tournamentId,
    key: `custom-${Date.now()}`,
    question: q,
    context: context?.trim() || null,
    sort_order: 1000,
  });
  if (error) return dbError(error);
  refreshTournament(tournamentId);
  return ok();
}

/** Save the tournament's scheduled breaks only. Fixtures are not moved; overlaps show as warnings. */
export async function saveBreaks(tournamentId: string, breaks: unknown): Promise<ActionResult> {
  const parsed = z.array(blockedPeriodSchema).max(20).safeParse(breaks);
  if (!parsed.success) return invalid(parsed.error);
  const { supabase } = await requireSession();
  const { error, count } = await supabase
    .from("tournament_settings")
    .update({ blocked_periods: parsed.data }, { count: "exact" })
    .eq("tournament_id", tournamentId);
  if (error) return dbError(error);
  if (!count) return { ok: false, error: "You do not have permission to change the schedule." };
  refreshTournament(tournamentId);
  return ok(undefined, "Breaks saved. Fixtures were not moved.");
}
