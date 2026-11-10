"use server";

import { z } from "zod";
import { requireSession } from "@/lib/data/session";
import type { ActionResult } from "@/lib/types";
import { UUID, dbError, invalid, ok, refreshTournament } from "./utils";

const suspensionSchema = z.object({
  player_id: z.string().uuid(),
  starts_after_fixture_id: z.union([z.string().uuid(), z.literal("")]).transform((v) => v || null),
  matches: z.number().int().min(1).max(20),
  reason: z.string().trim().min(3, "Enter a reason").max(500),
});

export async function addSuspension(tournamentId: string, input: unknown): Promise<ActionResult> {
  const parsed = suspensionSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { supabase, profile } = await requireSession();
  const { data: player } = await supabase.from("players").select("team_id").eq("id", parsed.data.player_id).single();
  let startsAfter = parsed.data.starts_after_fixture_id;
  if (!startsAfter && player?.team_id) {
    // Anchor to the team's latest confirmed match so earlier matches never count as served.
    const { data: last } = await supabase
      .from("fixtures")
      .select("id")
      .eq("tournament_id", tournamentId)
      .eq("status", "confirmed")
      .or(`home_team_id.eq.${player.team_id},away_team_id.eq.${player.team_id}`)
      .order("scheduled_date", { ascending: false, nullsFirst: false })
      .order("scheduled_time", { ascending: false, nullsFirst: false })
      .order("match_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    startsAfter = last?.id ?? null;
  }
  const { error } = await supabase.from("suspensions").insert({
    ...parsed.data,
    starts_after_fixture_id: startsAfter,
    tournament_id: tournamentId,
    team_id: player?.team_id ?? null,
    source: "manual",
    created_by: profile.id,
  });
  if (error) return dbError(error);
  refreshTournament(tournamentId);
  return ok(undefined, "Suspension added.");
}

export async function setSuspensionStatus(
  tournamentId: string,
  suspensionId: string,
  status: "active" | "overturned",
  note: string,
): Promise<ActionResult> {
  if (!UUID.test(suspensionId)) return { ok: false, error: "Invalid suspension." };
  if (status === "overturned" && note.trim().length < 3) return { ok: false, error: "Give a reason for overturning." };
  const { supabase } = await requireSession();
  const { error } = await supabase
    .from("suspensions")
    .update({ status, status_note: note.trim() || null })
    .eq("id", suspensionId)
    .eq("tournament_id", tournamentId);
  if (error) return dbError(error);
  refreshTournament(tournamentId);
  return ok(undefined, status === "overturned" ? "Suspension overturned." : "Suspension reinstated.");
}

const recordSchema = z.object({
  player_id: z.string().uuid(),
  fixture_id: z.union([z.string().uuid(), z.literal("")]).transform((v) => v || null),
  incident_type: z.enum(["misconduct", "other"]),
  reason: z.string().trim().min(3).max(1000),
});

export async function addDisciplinaryRecord(tournamentId: string, input: unknown): Promise<ActionResult> {
  const parsed = recordSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { supabase, profile } = await requireSession();
  const { data: player } = await supabase.from("players").select("team_id").eq("id", parsed.data.player_id).single();
  const { error } = await supabase.from("disciplinary_records").insert({
    ...parsed.data,
    tournament_id: tournamentId,
    team_id: player?.team_id ?? null,
    card_type: "none",
    created_by: profile.id,
  });
  if (error) return dbError(error);
  refreshTournament(tournamentId);
  return ok(undefined, "Incident recorded.");
}

const tiebreakSchema = z.object({
  scope: z.string().regex(/^(league|group:[A-P])$/),
  ordered_team_ids: z.array(z.string().uuid()).min(2),
  note: z.string().trim().min(5, "Explain how the tie was decided").max(1000),
});

/** Organiser decision that orders teams the configured tie-breakers could not separate. */
export async function recordTiebreakDecision(tournamentId: string, input: unknown): Promise<ActionResult> {
  const parsed = tiebreakSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { supabase, profile } = await requireSession();
  const { error } = await supabase
    .from("tiebreak_decisions")
    .insert({ ...parsed.data, tournament_id: tournamentId, decided_by: profile.id });
  if (error) return dbError(error);
  refreshTournament(tournamentId);
  return ok(undefined, "Decision recorded. It applies where 'Organiser decision' is in the tie-breaker order.");
}

export async function deleteTiebreakDecision(tournamentId: string, id: string): Promise<ActionResult> {
  const { supabase } = await requireSession();
  const { error } = await supabase.from("tiebreak_decisions").delete().eq("id", id).eq("tournament_id", tournamentId);
  if (error) return dbError(error);
  refreshTournament(tournamentId);
  return ok(undefined, "Decision removed.");
}
