"use server";

import { z } from "zod";
import { getTournamentContext } from "@/lib/data/session";
import { getFixtures, getEvents, getPitches, getTeams, getTiebreakDecisions } from "@/lib/data/loaders";
import {
  evaluateQualification,
  fromMinutes,
  planTournament,
  scheduleFixtures,
  type PlannedFixture,
} from "@/lib/engine";
import { blockedPeriods, formatOptions, groupLabels, occupiedFor, playingDays, standingsFor } from "@/lib/domain";
import type { ActionResult } from "@/lib/types";
import { UUID, dbError, invalid, ok, refreshTournament } from "./utils";

const generateSchema = z.object({
  withSchedule: z.boolean(),
  seed: z.number().int().min(1).max(2_147_483_647).optional(),
});

/**
 * Generate the full fixture plan (and, optionally, the schedule) and replace
 * all unplayed fixtures atomically. Refuses if the schedule would not fit.
 */
export async function generateFixtures(
  tournamentId: string,
  input: unknown,
): Promise<ActionResult<{ count: number; unscheduled: number }>> {
  const parsed = generateSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const ctx = await getTournamentContext(tournamentId);
  if (!ctx.isAdmin) return { ok: false, error: "Only tournament admins can generate fixtures." };
  if (ctx.tournament.fixtures_published) {
    return { ok: false, error: "Fixtures are published. Unpublish them before regenerating." };
  }
  const [teams, pitches] = await Promise.all([getTeams(tournamentId), getPitches(tournamentId)]);
  const plan = planTournament(
    teams.map((t) => ({ id: t.id, name: t.name, seed: t.seed, groupLabel: t.group_label })),
    formatOptions(ctx),
  );
  if (plan.errors.length) return { ok: false, error: plan.errors.join(" ") };

  let placed = new Map<string, { date: string; start: number; pitchId: string; order: number }>();
  const duration = occupiedFor(ctx.settings);
  if (parsed.data.withSchedule) {
    if (!duration) return { ok: false, error: "Set the match duration in Settings before scheduling." };
    if (ctx.settings.transition_min === null) return { ok: false, error: "Set the transition time in Settings before scheduling." };
    const days = playingDays(ctx.tournament);
    if (!days.length) return { ok: false, error: "Set the tournament date and daily start and end times first." };
    if (!pitches.length) return { ok: false, error: "Add at least one pitch first." };
    const result = scheduleFixtures({
      fixtures: plan.fixtures,
      days,
      timing: {
        matchMin: ctx.settings.match_duration_min!,
        periods: ctx.settings.periods,
        halfTimeMin: ctx.settings.half_time_min,
        transitionMin: ctx.settings.transition_min,
      },
      knockoutTiming: ctx.settings.knockout_match_duration_min
        ? {
            matchMin: ctx.settings.knockout_match_duration_min,
            periods: ctx.settings.periods,
            halfTimeMin: ctx.settings.knockout_half_time_min ?? ctx.settings.half_time_min,
            transitionMin: ctx.settings.transition_min,
          }
        : undefined,
      pitches: pitches.map((p) => ({ id: p.id, name: p.name, availableFrom: toMin(p.available_from), availableUntil: toMin(p.available_until) })),
      blocked: blockedPeriods(ctx.settings),
      knockoutBreakMin: ctx.settings.knockout_break_min,
      seed: parsed.data.seed,
      attempts: 80,
    });
    if (!result.feasible) {
      return {
        ok: false,
        error: `${result.unscheduled.length} of ${plan.fixtures.length} matches do not fit in the playing window. Nothing was saved. Check the feasibility panel for suggested adjustments.`,
      };
    }
    placed = new Map(result.assignments.map((a) => [a.code, { date: a.date, start: a.start, pitchId: a.pitchId, order: a.order }]));
  }

  const rows = plan.fixtures.map((f: PlannedFixture, i) => {
    const p = placed.get(f.code);
    return {
      code: f.code,
      stage: f.stage,
      round_number: f.roundNumber,
      round_name: f.roundName,
      group_label: f.groupLabel,
      match_order: p?.order ?? i + 1,
      home_team_id: f.homeTeamId,
      away_team_id: f.awayTeamId,
      home_source: f.homeSource,
      away_source: f.awaySource,
      pitch_id: p?.pitchId ?? null,
      scheduled_date: p?.date ?? null,
      scheduled_time: p ? fromMinutes(p.start) : null,
      duration_min: occupiedFor(ctx.settings, f.stage) ?? duration,
    };
  });
  const { data, error } = await ctx.supabase.rpc("replace_fixtures", {
    p_tournament: tournamentId,
    p_scope: "all",
    p_fixtures: rows,
  });
  if (error) return dbError(error);
  refreshTournament(tournamentId);
  return ok({ count: data as number, unscheduled: parsed.data.withSchedule ? 0 : rows.length });
}

function toMin(t: string | null) {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

const fixtureEditSchema = z.object({
  scheduled_date: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("")]).transform((v) => v || null),
  scheduled_time: z.union([z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/), z.literal("")]).transform((v) => v || null),
  pitch_id: z.union([z.string().uuid(), z.literal("")]).transform((v) => v || null),
  home_team_id: z.union([z.string().uuid(), z.literal("")]).transform((v) => v || null),
  away_team_id: z.union([z.string().uuid(), z.literal("")]).transform((v) => v || null),
  match_order: z.number().int().min(0).max(100_000),
  status: z.enum(["scheduled", "postponed", "cancelled"]).optional(),
});

/** Manual edit of a fixture. Conflicts are shown in the UI; the database blocks edits after kick-off. */
export async function updateFixture(tournamentId: string, fixtureId: string, input: unknown): Promise<ActionResult> {
  if (!UUID.test(fixtureId)) return { ok: false, error: "Invalid fixture." };
  const parsed = fixtureEditSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  if (parsed.data.home_team_id && parsed.data.home_team_id === parsed.data.away_team_id) {
    return { ok: false, error: "A team cannot play itself." };
  }
  const ctx = await getTournamentContext(tournamentId);
  const { error, count } = await ctx.supabase
    .from("fixtures")
    .update(parsed.data, { count: "exact" })
    .eq("id", fixtureId)
    .eq("tournament_id", tournamentId);
  if (error) return dbError(error);
  if (count === 0) return { ok: false, error: "You do not have permission to edit this fixture." };
  refreshTournament(tournamentId);
  return ok(undefined, "Fixture updated.");
}

/** Swap the time and pitch of two fixtures (quick reordering). */
export async function swapFixtureSlots(tournamentId: string, aId: string, bId: string): Promise<ActionResult> {
  if (!UUID.test(aId) || !UUID.test(bId)) return { ok: false, error: "Invalid fixtures." };
  const ctx = await getTournamentContext(tournamentId);
  const { data, error } = await ctx.supabase
    .from("fixtures")
    .select("id, scheduled_date, scheduled_time, pitch_id, match_order")
    .in("id", [aId, bId]);
  if (error) return dbError(error);
  if (!data || data.length !== 2) return { ok: false, error: "Fixtures not found." };
  const [a, b] = aId === data[0].id ? data : [data[1], data[0]];
  const slot = (x: typeof a) => ({ scheduled_date: x.scheduled_date, scheduled_time: x.scheduled_time, pitch_id: x.pitch_id, match_order: x.match_order });
  const r1 = await ctx.supabase.from("fixtures").update(slot(b)).eq("id", a.id);
  if (r1.error) return dbError(r1.error);
  const r2 = await ctx.supabase.from("fixtures").update(slot(a)).eq("id", b.id);
  if (r2.error) {
    await ctx.supabase.from("fixtures").update(slot(a)).eq("id", a.id); // roll back the first half
    return dbError(r2.error);
  }
  refreshTournament(tournamentId);
  return ok(undefined, "Fixtures swapped.");
}

export async function setFixturesPublished(tournamentId: string, published: boolean): Promise<ActionResult> {
  const ctx = await getTournamentContext(tournamentId);
  if (published) {
    const fixtures = await getFixtures(tournamentId);
    if (!fixtures.length) return { ok: false, error: "Generate fixtures before publishing." };
  }
  const { error } = await ctx.supabase.from("tournaments").update({ fixtures_published: published }).eq("id", tournamentId);
  if (error) return dbError(error);
  refreshTournament(tournamentId);
  return ok(undefined, published ? "Fixtures published." : "Fixtures unpublished. You can regenerate them now.");
}

/**
 * Fill knockout slots from the league or group tables. Only runs when the
 * qualification criteria are satisfied, unless provisional seeding is
 * enabled in settings AND explicitly requested.
 */
export async function seedKnockout(tournamentId: string, provisional: boolean): Promise<ActionResult<{ assigned: number }>> {
  const ctx = await getTournamentContext(tournamentId);
  if (!ctx.isAdmin) return { ok: false, error: "Only tournament admins can seed the knockout stage." };
  if (provisional && !ctx.settings.allow_provisional_seeding) {
    return { ok: false, error: "Provisional seeding is turned off in Settings." };
  }
  const [teams, fixtures, events, decisions] = await Promise.all([
    getTeams(tournamentId),
    getFixtures(tournamentId),
    getEvents(tournamentId),
    getTiebreakDecisions(tournamentId),
  ]);
  const assignments: { source: string; team_id: string }[] = [];
  const blockers: string[] = [];

  if (ctx.tournament.format === "league_playoff") {
    const league = fixtures.filter((f) => f.stage === "league" && f.status !== "cancelled");
    const standings = standingsFor(ctx.settings, teams, fixtures, events, decisions, { stage: "league" });
    const q = evaluateQualification({
      standings,
      qualifiers: ctx.settings.qualifiers ?? 0,
      complete: league.length > 0 && league.every((f) => f.status === "confirmed"),
      provisional,
      sourcePrefix: "league",
      label: "League",
    });
    blockers.push(...q.blockers);
    assignments.push(...q.assignments.map((a) => ({ source: a.source, team_id: a.teamId })));
  } else if (ctx.tournament.format === "group_knockout") {
    for (const g of groupLabels(teams)) {
      const gf = fixtures.filter((f) => f.stage === "group" && f.group_label === g && f.status !== "cancelled");
      const standings = standingsFor(ctx.settings, teams, fixtures, events, decisions, { stage: "group", group: g });
      const q = evaluateQualification({
        standings,
        qualifiers: ctx.settings.qualifiers_per_group ?? 0,
        complete: gf.length > 0 && gf.every((f) => f.status === "confirmed"),
        provisional,
        sourcePrefix: `group:${g}`,
        label: `Group ${g}`,
      });
      blockers.push(...q.blockers);
      assignments.push(...q.assignments.map((a) => ({ source: a.source, team_id: a.teamId })));
    }
  } else {
    return { ok: false, error: "This format seeds its bracket when fixtures are generated." };
  }

  if (blockers.length) return { ok: false, error: blockers.join(" ") };
  const { data, error } = await ctx.supabase.rpc("assign_knockout_teams", {
    p_tournament: tournamentId,
    p_assignments: assignments,
    p_provisional: provisional,
  });
  if (error) return dbError(error);
  refreshTournament(tournamentId);
  return ok({ assigned: data as number }, provisional ? "Knockout seeded provisionally." : "Knockout stage seeded.");
}

export async function clearKnockoutSeeding(tournamentId: string): Promise<ActionResult> {
  const ctx = await getTournamentContext(tournamentId);
  const fixtures = await getFixtures(tournamentId);
  const sources = new Set(
    fixtures.flatMap((f) => [f.home_source, f.away_source]).filter((s): s is string => !!s && /^(league|group):/.test(s)),
  );
  const { error } = await ctx.supabase.rpc("assign_knockout_teams", {
    p_tournament: tournamentId,
    p_assignments: [...sources].map((source) => ({ source, team_id: null })),
    p_provisional: false,
  });
  if (error) return dbError(error);
  refreshTournament(tournamentId);
  return ok(undefined, "Knockout seeding cleared.");
}

// ---------------------------------------------------------------------------
// Officials
// ---------------------------------------------------------------------------
const officialSchema = z.object({
  fixtureIds: z.array(z.string().uuid()).min(1).max(500),
  userId: z.string().uuid(),
  role: z.enum(["referee", "scorekeeper"]),
});

export async function assignOfficial(tournamentId: string, input: unknown): Promise<ActionResult> {
  const parsed = officialSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const ctx = await getTournamentContext(tournamentId);
  const rows = parsed.data.fixtureIds.map((fixture_id) => ({
    tournament_id: tournamentId,
    fixture_id,
    user_id: parsed.data.userId,
    role: parsed.data.role,
  }));
  const { error } = await ctx.supabase.from("match_officials").upsert(rows, { onConflict: "fixture_id,user_id,role", ignoreDuplicates: true });
  if (error) return dbError(error);
  refreshTournament(tournamentId);
  return ok(undefined, `Assigned to ${rows.length} match${rows.length > 1 ? "es" : ""}.`);
}

export async function removeOfficial(tournamentId: string, officialId: string): Promise<ActionResult> {
  if (!UUID.test(officialId)) return { ok: false, error: "Invalid assignment." };
  const ctx = await getTournamentContext(tournamentId);
  const { error } = await ctx.supabase.from("match_officials").delete().eq("id", officialId).eq("tournament_id", tournamentId);
  if (error) return dbError(error);
  refreshTournament(tournamentId);
  return ok(undefined, "Assignment removed.");
}
