import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { can, type Action, type Actor, type MatchContext, type MemberRole } from "@/lib/permissions";
import type { Profile, Tournament, TournamentSettings } from "@/lib/types";

export const getSession = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  return { supabase, user, profile: (profile as Profile | null) ?? null };
});

export async function requireSession() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.profile) {
    // The profile trigger runs on sign-up; if it is missing the database was not migrated.
    throw new Error("Your profile was not found. Make sure the Supabase migrations have been applied.");
  }
  return { ...session, profile: session.profile };
}

export const getTournamentContext = cache(async (tournamentId: string) => {
  const session = await requireSession();
  const { supabase, profile } = session;
  if (!/^[0-9a-f-]{36}$/i.test(tournamentId)) notFound();
  const [t, s, m] = await Promise.all([
    supabase.from("tournaments").select("*").eq("id", tournamentId).maybeSingle(),
    supabase.from("tournament_settings").select("*").eq("tournament_id", tournamentId).maybeSingle(),
    supabase
      .from("tournament_members")
      .select("role")
      .eq("tournament_id", tournamentId)
      .eq("user_id", profile.id)
      .maybeSingle(),
  ]);
  const tournament = t.data as Tournament | null;
  const role = (m.data?.role as MemberRole | undefined) ?? null;
  if (!tournament || (!role && !profile.is_super_admin)) notFound();
  const settings = s.data as TournamentSettings;
  const actor: Actor = {
    isSuperAdmin: profile.is_super_admin,
    canCreateTournaments: profile.can_create_tournaments,
    role,
  };
  return {
    ...session,
    tournament,
    settings,
    role,
    actor,
    can: (action: Action, ctx?: MatchContext) => can(actor, action, ctx),
    isAdmin: can(actor, "tournament.edit"),
  };
});

export type TournamentContext = Awaited<ReturnType<typeof getTournamentContext>>;

/** Tournaments the user belongs to (all of them for Super Admins), newest first, with the user's role. */
export const getMyTournaments = cache(async () => {
  const { supabase, profile } = await requireSession();
  const columns = "id, name, slug, status, start_date, logo_url, format, archived_at, created_at";
  const [{ data: memberships }, all] = await Promise.all([
    supabase.from("tournament_members").select("tournament_id, role").eq("user_id", profile.id),
    // RLS also exposes public tournaments, so non-admins are filtered to memberships below.
    supabase.from("tournaments").select(columns).order("created_at", { ascending: false }),
  ]);
  const roles = new Map((memberships ?? []).map((m) => [m.tournament_id as string, m.role as MemberRole]));
  type Row = Pick<Tournament, "id" | "name" | "slug" | "status" | "start_date" | "logo_url" | "format" | "archived_at" | "created_at">;
  return ((all.data ?? []) as Row[])
    .filter((t) => profile.is_super_admin || roles.has(t.id))
    .map((t) => ({ ...t, role: roles.get(t.id) ?? null }));
});

export type MyTournament = Awaited<ReturnType<typeof getMyTournaments>>[number];
