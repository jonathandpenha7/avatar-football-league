"use server";

import { z } from "zod";
import { requireSession } from "@/lib/data/session";
import { eventSchema } from "@/lib/validation";
import type { ActionResult } from "@/lib/types";
import { UUID, dbError, invalid, ok, refreshTournament } from "./utils";

export async function recordEvent(tournamentId: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = eventSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { supabase } = await requireSession();
  const v = parsed.data;
  const { data, error } = await supabase
    .from("match_events")
    .insert({
      tournament_id: tournamentId,
      fixture_id: v.fixture_id,
      event_type: v.event_type,
      team_id: v.team_id,
      player_id: v.player_id ?? null,
      assist_player_id: v.assist_player_id ?? null,
      related_player_id: v.related_player_id ?? null,
      match_second: v.match_second ?? null,
      period: v.period ?? null,
      duration_min: v.duration_min ?? null,
      detail: v.detail?.trim() || null,
    })
    .select("id")
    .single();
  if (error) return dbError(error);
  refreshTournament(tournamentId);
  return ok({ id: data.id as string });
}

export async function deleteEvent(tournamentId: string, eventId: string, reason: string): Promise<ActionResult> {
  if (!UUID.test(eventId)) return { ok: false, error: "Invalid event." };
  const { supabase } = await requireSession();
  const { error } = await supabase.rpc("delete_match_event", { p_event: eventId, p_reason: reason });
  if (error) return dbError(error);
  refreshTournament(tournamentId);
  return ok(undefined, "Event removed. Score and statistics recalculated.");
}

const controlSchema = z.object({
  command: z.enum([
    "sync", "start", "pause", "resume", "add_time", "end_first_half", "start_second_half", "end_match",
    "extra_time", "penalties", "resume_play", "submit", "abandon", "reinstate", "reset_to_scheduled",
  ]),
  expectedVersion: z.number().int().nullable().optional(),
  minutes: z.number().int().min(1).max(10).nullable().optional(),
  reason: z.string().max(500).nullable().optional(),
});

/**
 * Every clock and phase change goes through the database (server time, row lock,
 * version check, audit entry). The browser only displays the stored state.
 */
export async function controlMatch(tournamentId: string, fixtureId: string, input: unknown): Promise<ActionResult> {
  if (!UUID.test(fixtureId)) return { ok: false, error: "Invalid match." };
  const parsed = controlSchema.safeParse(typeof input === "string" ? { command: input } : input);
  if (!parsed.success) return invalid(parsed.error);
  const v = parsed.data;
  const { supabase } = await requireSession();
  const { error } = await supabase.rpc("match_control", {
    p_fixture: fixtureId,
    p_command: v.command,
    p_expected_version: v.expectedVersion ?? null,
    p_minutes: v.minutes ?? null,
    p_reason: v.reason?.trim() || null,
  });
  if (error) {
    refreshTournament(tournamentId); // stale screens pick up the latest state
    return dbError(error);
  }
  refreshTournament(tournamentId);
  return ok();
}

const correctionSchema = z.object({
  event_type: z.enum(["goal", "own_goal", "penalty_goal", "yellow_card", "red_card", "foul", "substitution", "sin_bin", "shootout_goal", "shootout_miss", "note"]).optional(),
  team_id: z.string().uuid().optional(),
  player_id: z.union([z.string().uuid(), z.literal("")]).optional(),
  related_player_id: z.union([z.string().uuid(), z.literal("")]).optional(),
  assist_player_id: z.union([z.string().uuid(), z.literal("")]).optional(),
  match_second: z.number().int().min(0).max(36_000).optional(),
  detail: z.string().max(1000).optional(),
});

export async function correctEvent(tournamentId: string, eventId: string, changes: unknown, reason: string): Promise<ActionResult> {
  if (!UUID.test(eventId)) return { ok: false, error: "Invalid event." };
  const parsed = correctionSchema.safeParse(changes);
  if (!parsed.success) return invalid(parsed.error);
  const { supabase } = await requireSession();
  const { error } = await supabase.rpc("correct_match_event", { p_event: eventId, p_changes: parsed.data, p_reason: reason });
  if (error) return dbError(error);
  refreshTournament(tournamentId);
  return ok(undefined, "Event corrected. Score and statistics recalculated.");
}

export async function setParticipants(
  tournamentId: string,
  fixtureId: string,
  teamId: string,
  playerIds: string[],
): Promise<ActionResult> {
  if (!UUID.test(fixtureId) || !UUID.test(teamId) || !playerIds.every((p) => UUID.test(p))) return { ok: false, error: "Invalid input." };
  const { supabase } = await requireSession();
  const del = await supabase.from("match_participants").delete().eq("fixture_id", fixtureId).eq("team_id", teamId);
  if (del.error) return dbError(del.error);
  if (playerIds.length) {
    const { error } = await supabase
      .from("match_participants")
      .insert(playerIds.map((player_id) => ({ tournament_id: tournamentId, fixture_id: fixtureId, team_id: teamId, player_id, source: "recorded" })));
    if (error) return dbError(error);
  }
  refreshTournament(tournamentId);
  return ok(undefined, "Lineup saved.");
}

export async function saveMatchNotes(
  tournamentId: string,
  fixtureId: string,
  field: "notes" | "referee_notes",
  text: string,
): Promise<ActionResult> {
  if (!UUID.test(fixtureId)) return { ok: false, error: "Invalid match." };
  if (text.length > 4000) return { ok: false, error: "Notes are too long (4,000 characters maximum)." };
  const { supabase } = await requireSession();
  const { error, count } = await supabase
    .from("fixtures")
    .update({ [field]: text.trim() || null }, { count: "exact" })
    .eq("id", fixtureId);
  if (error) return dbError(error);
  if (count === 0) return { ok: false, error: "You cannot edit notes for this match." };
  refreshTournament(tournamentId);
  return ok(undefined, "Notes saved.");
}

export async function confirmResult(tournamentId: string, fixtureId: string, note?: string): Promise<ActionResult> {
  if (!UUID.test(fixtureId)) return { ok: false, error: "Invalid match." };
  const { supabase } = await requireSession();
  const { error } = await supabase.rpc("confirm_match_result", { p_fixture: fixtureId, p_note: note?.trim() || null });
  if (error) return dbError(error);
  refreshTournament(tournamentId);
  return ok(undefined, "Result confirmed. Standings updated.");
}

export async function reopenResult(tournamentId: string, fixtureId: string, reason: string): Promise<ActionResult> {
  if (!UUID.test(fixtureId)) return { ok: false, error: "Invalid match." };
  const { supabase } = await requireSession();
  const { error } = await supabase.rpc("reopen_match_result", { p_fixture: fixtureId, p_reason: reason });
  if (error) return dbError(error);
  refreshTournament(tournamentId);
  return ok(undefined, "Result reopened for correction. Fix the events, then confirm again.");
}

export async function recordForfeit(
  tournamentId: string,
  fixtureId: string,
  awardedTeamId: string,
  reason: string,
): Promise<ActionResult> {
  if (!UUID.test(fixtureId) || !UUID.test(awardedTeamId)) return { ok: false, error: "Invalid input." };
  const { supabase } = await requireSession();
  const { error } = await supabase.rpc("record_forfeit", { p_fixture: fixtureId, p_awarded_team: awardedTeamId, p_reason: reason });
  if (error) return dbError(error);
  refreshTournament(tournamentId);
  return ok(undefined, "Forfeit recorded. Confirm the result to update standings.");
}

export async function clearForfeit(tournamentId: string, fixtureId: string): Promise<ActionResult> {
  const { supabase } = await requireSession();
  const { error } = await supabase.rpc("clear_forfeit", { p_fixture: fixtureId });
  if (error) return dbError(error);
  refreshTournament(tournamentId);
  return ok(undefined, "Forfeit cleared.");
}
