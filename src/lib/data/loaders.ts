import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type {
  Announcement,
  Decision,
  DisciplinaryRecord,
  Fixture,
  MatchEvent,
  MatchParticipant,
  MvpNomination,
  TournamentAwards,
  MatchOfficial,
  Member,
  Pitch,
  Player,
  Rule,
  Suspension,
  Team,
  TiebreakDecisionRow,
} from "@/lib/types";

async function list<T>(table: string, tournamentId: string, order?: { column: string; ascending?: boolean }[]) {
  const supabase = await createClient();
  let q = supabase.from(table).select("*").eq("tournament_id", tournamentId);
  for (const o of order ?? []) q = q.order(o.column, { ascending: o.ascending ?? true, nullsFirst: false });
  const { data, error } = await q;
  if (error) throw new Error(`Could not load ${table}: ${error.message}`);
  return (data ?? []) as T[];
}

export const getTeams = cache((id: string) => list<Team>("teams", id, [{ column: "name" }]));
export const getPitches = cache((id: string) => list<Pitch>("pitches", id, [{ column: "sort_order" }]));
export const getPlayers = cache((id: string) => list<Player>("players", id, [{ column: "full_name" }]));
export const getFixtures = cache((id: string) =>
  list<Fixture>("fixtures", id, [
    { column: "scheduled_date" },
    { column: "scheduled_time" },
    { column: "match_order" },
  ]),
);
export const getEvents = cache((id: string) => list<MatchEvent>("match_events", id, [{ column: "created_at" }]));
export const getSuspensions = cache((id: string) =>
  list<Suspension>("suspensions", id, [{ column: "created_at", ascending: false }]),
);
export const getDiscipline = cache((id: string) =>
  list<DisciplinaryRecord>("disciplinary_records", id, [{ column: "occurred_at", ascending: false }]),
);
export const getRules = cache((id: string) =>
  list<Rule>("tournament_rules", id, [{ column: "category" }, { column: "sort_order" }]),
);
export const getDecisions = cache((id: string) =>
  list<Decision>("tournament_decisions", id, [{ column: "sort_order" }]),
);
export const getTiebreakDecisions = cache((id: string) =>
  list<TiebreakDecisionRow>("tiebreak_decisions", id, [{ column: "created_at" }]),
);
export const getAnnouncements = cache((id: string) =>
  list<Announcement>("tournament_announcements", id, [{ column: "created_at", ascending: false }]),
);
export const getOfficials = cache((id: string) => list<MatchOfficial>("match_officials", id));

export const getMembers = cache(async (id: string) => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tournament_members")
    .select("*, profile:profiles!tournament_members_user_id_fkey(id, email, full_name)")
    .eq("tournament_id", id)
    .order("created_at");
  if (error) throw new Error(`Could not load members: ${error.message}`);
  return (data ?? []) as Member[];
});

export function nameMap<T extends { id: string }>(rows: T[], key: keyof T = "name" as keyof T) {
  return new Map(rows.map((r) => [r.id, String(r[key] ?? "")]));
}

export const getParticipants = cache(async (id: string) => {
  const supabase = await createClient();
  const { data, error } = await supabase.from("match_participants").select("fixture_id, team_id, player_id, source").eq("tournament_id", id);
  if (error) throw new Error(`Could not load lineups: ${error.message}`);
  return (data ?? []) as MatchParticipant[];
});

export const getAwards = cache(async (id: string) => {
  const supabase = await createClient();
  const { data } = await supabase.from("tournament_awards").select("*").eq("tournament_id", id).maybeSingle();
  return (data as TournamentAwards | null) ?? null;
});

export const getNominations = cache((id: string) => list<MvpNomination>("mvp_nominations", id, [{ column: "created_at" }]));
