"use server";

import { z } from "zod";
import { requireSession } from "@/lib/data/session";
import { eventSchema } from "@/lib/validation";
import type { ActionResult, Fixture } from "@/lib/types";
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

export async function deleteEvent(tournamentId: string, eventId: string): Promise<ActionResult> {
  if (!UUID.test(eventId)) return { ok: false, error: "Invalid event." };
  const { supabase } = await requireSession();
  const { error, count } = await supabase.from("match_events").delete({ count: "exact" }).eq("id", eventId);
  if (error) return dbError(error);
  if (count === 0) return { ok: false, error: "You cannot remove this event." };
  refreshTournament(tournamentId);
  return ok(undefined, "Event removed.");
}

const controlSchema = z.enum([
  "start",
  "pause",
  "resume",
  "half_time",
  "second_half",
  "extra_time",
  "penalties",
  "end",
  "reset_to_scheduled",
]);

/** Match clock and status transitions. The clock state is stored so every device shows the same time. */
export async function controlMatch(tournamentId: string, fixtureId: string, command: string): Promise<ActionResult> {
  if (!UUID.test(fixtureId)) return { ok: false, error: "Invalid match." };
  const c = controlSchema.safeParse(command);
  if (!c.success) return { ok: false, error: "Unknown command." };
  const { supabase } = await requireSession();
  const { data: f, error: loadError } = await supabase.from("fixtures").select("*").eq("id", fixtureId).single();
  if (loadError) return dbError(loadError);
  const fixture = f as Fixture;
  if (!fixture.home_team_id || !fixture.away_team_id) return { ok: false, error: "Both teams must be known before the match starts." };

  const now = new Date();
  const runningFor = fixture.timer_started_at ? Math.max(0, Math.floor((now.getTime() - new Date(fixture.timer_started_at).getTime()) / 1000)) : 0;
  const stopClock = { timer_started_at: null, timer_elapsed_sec: fixture.timer_elapsed_sec + runningFor };
  let update: Partial<Fixture>;
  switch (c.data) {
    case "start":
      if (fixture.status !== "scheduled") return { ok: false, error: "This match has already started." };
      update = { status: "in_progress", period: "first_half", timer_started_at: now.toISOString(), timer_elapsed_sec: 0 };
      break;
    case "pause":
      if (fixture.status !== "in_progress") return { ok: false, error: "The clock is not running." };
      update = { status: "paused", ...stopClock };
      break;
    case "resume":
      if (fixture.status !== "paused") return { ok: false, error: "The match is not paused." };
      update = { status: "in_progress", timer_started_at: now.toISOString() };
      break;
    case "half_time":
      update = { status: "paused", period: "half_time", ...stopClock };
      break;
    case "second_half":
      update = { status: "in_progress", period: "second_half", timer_started_at: now.toISOString() };
      break;
    case "extra_time":
      update = { status: "in_progress", period: "extra_time", timer_started_at: now.toISOString() };
      break;
    case "penalties":
      if (fixture.stage !== "knockout") return { ok: false, error: "Shootouts only apply to knockout matches." };
      update = { status: "paused", period: "penalties", ...stopClock };
      break;
    case "end":
      if (!["in_progress", "paused"].includes(fixture.status)) return { ok: false, error: "The match is not in progress." };
      update = { status: "completed", period: "full_time", ...stopClock };
      break;
    case "reset_to_scheduled": {
      const { count } = await supabase.from("match_events").select("id", { count: "exact", head: true }).eq("fixture_id", fixtureId);
      if ((count ?? 0) > 0) return { ok: false, error: "Remove the recorded events before resetting this match." };
      update = { status: "scheduled", period: "not_started", timer_started_at: null, timer_elapsed_sec: 0 };
      break;
    }
  }
  const { error, count } = await supabase.from("fixtures").update(update, { count: "exact" }).eq("id", fixtureId);
  if (error) return dbError(error);
  if (count === 0) return { ok: false, error: "You are not assigned to this match." };
  refreshTournament(tournamentId);
  return ok();
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
