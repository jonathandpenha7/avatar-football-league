import { assignGroups, planTournament } from "./plan";
import {
  type BlockedPeriod,
  type DayWindow,
  type SchedulePitch,
  type ScheduleResult,
  type TimingConfig,
  buildSlots,
  minimumSlots,
  scheduleFixtures,
  slotStep,
} from "./schedule";
import { formatClock, formatDuration } from "./time";
import type { FormatOptions, PlanTeam, PlannedFixture } from "./types";

export interface FeasibilityInput {
  teamCount: number;
  format: FormatOptions;
  days: DayWindow[];
  matchMin: number | null;
  periods?: 1 | 2;
  halfTimeMin?: number;
  transitionMin: number | null;
  /** Knockout match length (all periods); null/undefined = same as league. */
  knockoutMatchMin?: number | null;
  knockoutHalfTimeMin?: number | null;
  pitches: SchedulePitch[];
  blocked?: BlockedPeriod[];
  knockoutBreakMin?: number;
  /** Use the real teams (with groups) instead of placeholders. */
  teams?: PlanTeam[];
}

export interface FeasibilityReport {
  status: "feasible" | "infeasible" | "incomplete";
  missing: string[];
  planErrors: string[];
  totalMatches: number;
  groupPhaseMatches: number;
  knockoutMatches: number;
  windowMinutes: number;
  availableSlots: number;
  availablePitchSlots: number;
  minimumSlots: number;
  minutesPerSlot: number | null;
  /** Shortest possible total playing time (first kick-off to last final whistle). */
  minimumMinutes: number | null;
  /** Largest whole-minute match length that still fits (with the configured transition). */
  maxMatchMinutes: number | null;
  result: ScheduleResult | null;
  suggestions: string[];
}

function placeholderTeams(input: FeasibilityInput): PlanTeam[] {
  if (input.teams && input.teams.length) return input.teams;
  const teams: PlanTeam[] = Array.from({ length: input.teamCount }, (_, i) => ({
    id: `T${i + 1}`,
    name: `Team ${i + 1}`,
    seed: i + 1,
  }));
  if (input.format.format === "group_knockout" && (input.format.groupCount ?? 0) >= 2) {
    const groups = assignGroups(teams, input.format.groupCount!);
    return teams.map((t) => ({ ...t, groupLabel: groups.get(t.id) }));
  }
  return teams;
}

function koTimingOf(input: FeasibilityInput, transitionMin: number): TimingConfig | undefined {
  if (!input.knockoutMatchMin) return undefined;
  return {
    matchMin: input.knockoutMatchMin,
    periods: input.periods ?? 1,
    halfTimeMin: input.knockoutHalfTimeMin ?? input.halfTimeMin ?? 0,
    transitionMin,
  };
}

/** Shortest possible time from first kick-off to the last final whistle. */
export function minimumMinutes(fixtures: PlannedFixture[], pitchCount: number, league: TimingConfig, knockout?: TimingConfig): number {
  const groupOnly = fixtures.filter((f) => f.stage !== "knockout");
  const koOnly = fixtures.filter((f) => f.stage === "knockout");
  const g = minimumSlots(groupOnly, pitchCount);
  const k = minimumSlots(koOnly, pitchCount);
  const ko = knockout ?? league;
  const total = g * slotStep(league) + k * slotStep(ko);
  return Math.max(0, total - (k ? ko.transitionMin : g ? league.transitionMin : 0));
}

function trySchedule(
  fixtures: PlannedFixture[],
  input: FeasibilityInput,
  overrides: Partial<{ matchMin: number; transitionMin: number; pitches: SchedulePitch[]; days: DayWindow[] }>,
  attempts = 20,
): ScheduleResult {
  const timing: TimingConfig = {
    matchMin: overrides.matchMin ?? input.matchMin ?? 0,
    periods: input.periods ?? 1,
    halfTimeMin: input.halfTimeMin ?? 0,
    transitionMin: overrides.transitionMin ?? input.transitionMin ?? 0,
  };
  return scheduleFixtures({
    fixtures,
    days: overrides.days ?? input.days,
    timing,
    knockoutTiming: koTimingOf(input, timing.transitionMin),
    pitches: overrides.pitches ?? input.pitches,
    blocked: input.blocked,
    knockoutBreakMin: input.knockoutBreakMin,
    attempts,
  });
}

/** Largest match length (minutes) that schedules everything, or null if even 1 minute fails. */
export function findMaxMatchMinutes(fixtures: PlannedFixture[], input: FeasibilityInput, upper = 120): number | null {
  let lo = 1;
  let hi = upper;
  if (!trySchedule(fixtures, input, { matchMin: lo }).feasible) return null;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (trySchedule(fixtures, input, { matchMin: mid }).feasible) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Check whether the format fits in the configured window before generating.
 * Never silently produces an impossible schedule: reports what is missing,
 * how much room there is, and concrete adjustments.
 */
export function assessFeasibility(input: FeasibilityInput): FeasibilityReport {
  const missing: string[] = [];
  if (!input.days.length) missing.push("Set the tournament date and daily start and end times.");
  if (!input.pitches.length) missing.push("Add at least one pitch.");
  if (input.matchMin === null) missing.push("Match duration has not been decided.");
  if (input.transitionMin === null) missing.push("Transition time between matches has not been decided.");

  const teams = placeholderTeams(input);
  const plan = planTournament(teams, input.format);
  const fixtures = plan.fixtures;
  const groupPhaseMatches = fixtures.filter((f) => f.stage !== "knockout").length;
  const knockoutMatches = fixtures.length - groupPhaseMatches;
  const windowMinutes = input.days.reduce((s, d) => s + Math.max(0, d.end - d.start), 0);
  const minSlots = minimumSlots(fixtures, input.pitches.length);

  const base: FeasibilityReport = {
    status: "incomplete",
    missing,
    planErrors: plan.errors,
    totalMatches: fixtures.length,
    groupPhaseMatches,
    knockoutMatches,
    windowMinutes,
    availableSlots: 0,
    availablePitchSlots: 0,
    minimumSlots: minSlots,
    minutesPerSlot: null,
    minimumMinutes: null,
    maxMatchMinutes: null,
    result: null,
    suggestions: [],
  };
  if (plan.errors.length || !input.days.length || !input.pitches.length || fixtures.length === 0) {
    return base;
  }

  // Without a decided match length we can still say how long matches may be.
  if (input.matchMin === null || input.transitionMin === null) {
    const max = findMaxMatchMinutes(fixtures, { ...input, transitionMin: input.transitionMin ?? 0 });
    base.maxMatchMinutes = max;
    base.suggestions.push(
      max === null
        ? "Even 1-minute matches do not fit. Add pitches or extend the tournament window."
        : `Set the match length and changeover to check the schedule. For reference: on ${input.pitches.length} pitch${input.pitches.length === 1 ? "" : "es"}${input.transitionMin === null ? " with no changeover" : ` with a ${input.transitionMin}-minute changeover`}, league matches could last up to ${max} minutes of play.`,
    );
    return base;
  }

  const timing: TimingConfig = {
    matchMin: input.matchMin,
    periods: input.periods ?? 1,
    halfTimeMin: input.halfTimeMin ?? 0,
    transitionMin: input.transitionMin,
  };
  const slots = buildSlots(input.days, timing, input.pitches, input.blocked ?? []);
  const koTiming = koTimingOf(input, input.transitionMin);
  const result = scheduleFixtures({
    fixtures,
    days: input.days,
    timing,
    knockoutTiming: koTiming,
    pitches: input.pitches,
    blocked: input.blocked,
    knockoutBreakMin: input.knockoutBreakMin,
    attempts: 40,
  });
  const report: FeasibilityReport = {
    ...base,
    status: result.feasible ? "feasible" : "infeasible",
    availableSlots: slots.length,
    availablePitchSlots: slots.reduce((s, sl) => s + sl.pitchIds.length, 0),
    minutesPerSlot: slotStep(timing),
    minimumMinutes: minimumMinutes(fixtures, input.pitches.length, timing, koTiming),
    result,
  };

  if (result.feasible) {
    const lastDay = input.days[input.days.length - 1];
    if (result.metrics.endMinute !== null && result.metrics.endDate === lastDay.date) {
      const spare = lastDay.end - result.metrics.endMinute;
      report.suggestions.push(
        `Last match ends at ${formatClock(result.metrics.endMinute)}, leaving ${formatDuration(spare)} spare.`,
      );
    }
    report.maxMatchMinutes = findMaxMatchMinutes(fixtures, input, Math.max(input.matchMin * 3, 60));
    return report;
  }

  // Infeasible: work out concrete adjustments.
  const s: string[] = [];
  s.push(
    `${result.unscheduled.length} of ${fixtures.length} matches do not fit. Playing everything takes at least ${formatDuration(report.minimumMinutes ?? 0)}, but the playing window is ${formatDuration(windowMinutes)}${(input.blocked ?? []).length ? " (before blocked periods)" : ""}.`,
  );
  const rawMax = findMaxMatchMinutes(fixtures, input, input.matchMin);
  const halves = (input.periods ?? 1) === 2;
  // With two halves, suggest whole minutes per half (e.g. 4 + 4, not 9).
  const maxLen = rawMax !== null && halves ? Math.floor(rawMax / 2) * 2 : rawMax;
  report.maxMatchMinutes = maxLen;
  if (maxLen) {
    s.push(
      halves
        ? `Shorten league matches to ${maxLen / 2} + ${input.halfTimeMin ?? 0} + ${maxLen / 2} minutes or less (currently ${input.matchMin / 2} + ${input.halfTimeMin ?? 0} + ${input.matchMin / 2}).`
        : `Shorten league matches to ${maxLen} minutes or less (currently ${input.matchMin}).`,
    );
  }
  if (input.transitionMin > 0) {
    for (let tr = input.transitionMin - 1; tr >= 0; tr--) {
      if (trySchedule(fixtures, input, { transitionMin: tr }).feasible) {
        s.push(`Reduce the changeover between matches to ${tr} minutes.`);
        break;
      }
    }
  }
  for (let extra = 1; extra <= 4; extra++) {
    const pitches = [
      ...input.pitches,
      ...Array.from({ length: extra }, (_, i) => ({ id: `extra-${i}`, name: `Extra pitch ${i + 1}` })),
    ];
    if (trySchedule(fixtures, input, { pitches }).feasible) {
      s.push(`Add ${extra} more pitch${extra > 1 ? "es" : ""} (${input.pitches.length + extra} in total).`);
      break;
    }
  }
  const lastIdx = input.days.length - 1;
  for (let ext = 5; ext <= 6 * 60; ext += 5) {
    const days = input.days.map((d, i) => (i === lastIdx ? { ...d, end: d.end + ext } : d));
    if (trySchedule(fixtures, input, { days }).feasible) {
      s.push(`Extend the tournament window by ${formatDuration(ext)} (finish at ${formatClock(input.days[lastIdx].end + ext)}).`);
      break;
    }
  }
  if (input.format.doubleRoundRobin) s.push("Switch to a single round robin.");
  if (input.format.thirdPlaceMatch) {
    const without = planTournament(placeholderTeams(input), { ...input.format, thirdPlaceMatch: false }).fixtures;
    if (trySchedule(without, input, {}).feasible) s.push("Drop the third-place play-off.");
  }
  report.suggestions = s;
  return report;
}
