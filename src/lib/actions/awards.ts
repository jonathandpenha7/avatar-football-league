"use server";

import { z } from "zod";
import { getTournamentContext, requireSession } from "@/lib/data/session";
import { getEvents, getFixtures, getParticipants } from "@/lib/data/loaders";
import { computeStats, finalPlacings } from "@/lib/engine";
import type { ActionResult } from "@/lib/types";
import { UUID, dbError, invalid, ok, refreshTournament } from "./utils";

const mvpSchema = z.object({
  mvp_player_id: z.union([z.string().uuid(), z.literal("")]).transform((v) => v || null),
  mvp_reason: z.string().trim().max(2000),
  mvp_comments: z.string().trim().max(2000).optional(),
});

/** Organiser's MVP choice. Changing it after confirmation requires the awards to be confirmed again. */
export async function saveMvp(tournamentId: string, input: unknown): Promise<ActionResult> {
  const parsed = mvpSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const v = parsed.data;
  if (v.mvp_player_id && v.mvp_reason.length < 5) return { ok: false, error: "Give a reason for the MVP selection (at least 5 characters)." };
  const ctx = await getTournamentContext(tournamentId);
  if (!ctx.isAdmin) return { ok: false, error: "Only tournament admins can select the MVP." };
  const { error } = await ctx.supabase.from("tournament_awards").upsert(
    {
      tournament_id: tournamentId,
      mvp_player_id: v.mvp_player_id,
      mvp_reason: v.mvp_player_id ? v.mvp_reason : null,
      mvp_comments: v.mvp_comments || null,
      confirmed_at: null,
      confirmed_by: null,
      published: false,
    },
    { onConflict: "tournament_id" },
  );
  if (error) return dbError(error);
  refreshTournament(tournamentId);
  return ok(undefined, "MVP saved. Review and confirm the awards when ready.");
}

/**
 * Snapshot Winners, Runners up, third place and Most Goals from confirmed
 * results and mark the awards as confirmed by this organiser.
 */
export async function confirmAwards(tournamentId: string): Promise<ActionResult> {
  const ctx = await getTournamentContext(tournamentId);
  if (!ctx.isAdmin) return { ok: false, error: "Only tournament admins can confirm awards." };
  const [fixtures, events, participants] = await Promise.all([getFixtures(tournamentId), getEvents(tournamentId), getParticipants(tournamentId)]);
  const stat = fixtures.map((f) => ({
    id: f.id, code: f.code, stage: f.stage, homeTeamId: f.home_team_id, awayTeamId: f.away_team_id,
    homeScore: f.home_score, awayScore: f.away_score, status: f.status, homePenalties: f.home_penalties, awayPenalties: f.away_penalties,
  }));
  const placings = finalPlacings(stat);
  const hasFinal = fixtures.some((f) => f.code === "F" || f.code === "GF");
  if (hasFinal && !placings.finalConfirmed) return { ok: false, error: "Confirm the final result before confirming the awards." };
  const stats = computeStats(stat, events.map((e) => ({ fixtureId: e.fixture_id, eventType: e.event_type, teamId: e.team_id, playerId: e.player_id })), participants.map((p) => ({ fixtureId: p.fixture_id, playerId: p.player_id })));
  const { data: existing } = await ctx.supabase.from("tournament_awards").select("mvp_player_id").eq("tournament_id", tournamentId).maybeSingle();
  if (!existing?.mvp_player_id) return { ok: false, error: "Select the MVP before confirming the awards." };
  const { error } = await ctx.supabase.from("tournament_awards").upsert(
    {
      tournament_id: tournamentId,
      champion_team_id: placings.champion,
      runner_up_team_id: placings.runnerUp,
      third_place_team_id: placings.thirdPlace,
      top_scorer_player_ids: stats.mostGoals.playerIds,
      top_scorer_goals: stats.mostGoals.goals || null,
      confirmed_at: new Date().toISOString(),
      confirmed_by: ctx.profile.id,
    },
    { onConflict: "tournament_id" },
  );
  if (error) return dbError(error);
  refreshTournament(tournamentId);
  return ok(undefined, "Awards confirmed.");
}

export async function setAwardsPublished(tournamentId: string, published: boolean): Promise<ActionResult> {
  const { supabase } = await requireSession();
  const { error, count } = await supabase.from("tournament_awards").update({ published }, { count: "exact" }).eq("tournament_id", tournamentId);
  if (error) return dbError(error);
  if (!count) return { ok: false, error: "Confirm the awards first." };
  refreshTournament(tournamentId);
  return ok(undefined, published ? "Final results published to the public page." : "Final results hidden from the public page.");
}

export async function setFinalised(tournamentId: string, finalise: boolean, reason?: string): Promise<ActionResult> {
  const { supabase } = await requireSession();
  const { error } = await supabase.rpc("set_tournament_finalised", { p_tournament: tournamentId, p_finalise: finalise, p_reason: reason ?? null });
  if (error) return dbError(error);
  refreshTournament(tournamentId);
  return ok(undefined, finalise ? "Tournament finalised. Awards are locked." : "Tournament reopened.");
}

export async function nominateMvp(tournamentId: string, playerId: string, reason: string): Promise<ActionResult> {
  if (!UUID.test(playerId)) return { ok: false, error: "Choose a player." };
  const { supabase } = await requireSession();
  const { error } = await supabase.from("mvp_nominations").insert({ tournament_id: tournamentId, player_id: playerId, reason: reason.trim() || null });
  if (error) {
    if (error.code === "23505") return { ok: false, error: "You have already nominated this player." };
    return dbError(error);
  }
  refreshTournament(tournamentId);
  return ok(undefined, "Nomination recorded.");
}

export async function withdrawNomination(tournamentId: string, id: string): Promise<ActionResult> {
  if (!UUID.test(id)) return { ok: false, error: "Invalid nomination." };
  const { supabase } = await requireSession();
  const { error } = await supabase.from("mvp_nominations").delete().eq("id", id);
  if (error) return dbError(error);
  refreshTournament(tournamentId);
  return ok(undefined, "Nomination withdrawn.");
}
