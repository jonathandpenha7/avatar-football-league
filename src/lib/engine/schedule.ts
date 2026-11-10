import { overlaps } from "./time";
import type { PlannedFixture } from "./types";

export interface SchedulePitch {
  id: string;
  name: string;
  availableFrom?: number | null;
  availableUntil?: number | null;
}

export interface BlockedPeriod {
  /** ISO date; null/undefined = every day */
  date?: string | null;
  start: number;
  end: number;
  /** null/undefined = all pitches */
  pitchId?: string | null;
  label?: string | null;
}

export interface DayWindow {
  date: string;
  start: number;
  end: number;
}

export interface TimingConfig {
  /** Total playing time, all periods. */
  matchMin: number;
  periods?: 1 | 2;
  halfTimeMin?: number;
  transitionMin: number;
}

export interface Slot {
  index: number;
  date: string;
  dayIndex: number;
  start: number;
  end: number;
  pitchIds: string[];
}

export interface Assignment {
  code: string;
  date: string;
  start: number;
  end: number;
  pitchId: string;
  slotIndex: number;
  order: number;
}

export interface TeamScheduleStats {
  teamId: string;
  matches: number;
  backToBack: number;
  longestWaitMin: number;
  firstStart: number | null;
  lastEnd: number | null;
}

export interface ScheduleResult {
  feasible: boolean;
  assignments: Assignment[];
  unscheduled: string[];
  slots: Slot[];
  metrics: {
    endDate: string | null;
    endMinute: number | null;
    slotsUsed: number;
    backToBack: number;
    emptyPitchSlots: number;
    pitchUsage: Record<string, number>;
    teams: TeamScheduleStats[];
  };
}

export interface ScheduleInput {
  fixtures: PlannedFixture[];
  days: DayWindow[];
  timing: TimingConfig;
  pitches: SchedulePitch[];
  blocked?: BlockedPeriod[];
  /** Extra gap between the end of the league/group phase and the knockouts. */
  knockoutBreakMin?: number;
  attempts?: number;
  seed?: number;
}

/** Minutes a pitch is occupied by one match (playing time + half-time). */
export function occupiedMinutes(t: TimingConfig): number {
  return t.matchMin + (t.periods === 2 ? t.halfTimeMin ?? 0 : 0);
}

export function slotStep(t: TimingConfig): number {
  return occupiedMinutes(t) + t.transitionMin;
}

/**
 * Time slots across all days. A slot is a kick-off time plus the pitches
 * available for the whole match. Global blocked periods push the next
 * kick-off to the end of the block; pitch-specific blocks remove that pitch.
 */
export function buildSlots(
  days: DayWindow[],
  timing: TimingConfig,
  pitches: SchedulePitch[],
  blocked: BlockedPeriod[] = [],
): Slot[] {
  const occ = occupiedMinutes(timing);
  const step = slotStep(timing);
  if (occ <= 0 || step <= 0 || pitches.length === 0) return [];
  const slots: Slot[] = [];
  days.forEach((day, dayIndex) => {
    const dayBlocks = blocked.filter((b) => !b.date || b.date === day.date);
    let t = day.start;
    let guard = 0;
    while (t + occ <= day.end && guard++ < 10_000) {
      const global = dayBlocks.find((b) => !b.pitchId && overlaps(t, t + occ, b.start, b.end));
      if (global) {
        t = Math.max(t + 1, global.end);
        continue;
      }
      const pitchIds = pitches
        .filter((p) => (p.availableFrom ?? -Infinity) <= t && t + occ <= (p.availableUntil ?? Infinity))
        .filter((p) => !dayBlocks.some((b) => b.pitchId === p.id && overlaps(t, t + occ, b.start, b.end)))
        .map((p) => p.id);
      if (pitchIds.length > 0) {
        slots.push({ index: slots.length, date: day.date, dayIndex, start: t, end: t + occ, pitchIds });
      }
      t += step;
    }
  });
  return slots;
}

/** Deterministic PRNG so the same input always produces the same schedule. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const abs = (slot: { dayIndex: number; start: number }) => slot.dayIndex * 1440 + slot.start;

interface AttemptResult {
  placed: Map<string, { slot: Slot; pitchId: string }>;
  unscheduled: string[];
}

function scheduleGroupPhase(
  fixtures: PlannedFixture[],
  slots: Slot[],
  timing: TimingConfig,
  rng: () => number,
  jitter: number,
): AttemptResult {
  const placed = new Map<string, { slot: Slot; pitchId: string }>();
  const remaining = [...fixtures].sort((a, b) => a.roundNumber - b.roundNumber);
  const remainingByTeam = new Map<string, number>();
  for (const f of remaining) {
    for (const t of [f.homeTeamId!, f.awayTeamId!]) remainingByTeam.set(t, (remainingByTeam.get(t) ?? 0) + 1);
  }
  const lastSlot = new Map<string, Slot>();
  const pitchCount = new Map<string, number>();
  const step = slotStep(timing);

  for (const slot of slots) {
    if (remaining.length === 0) break;
    const busy = new Set<string>();
    const chosen: PlannedFixture[] = [];
    const minRound = Math.min(...remaining.map((f) => f.roundNumber));

    for (let k = 0; k < slot.pitchIds.length; k++) {
      let best: PlannedFixture | null = null;
      let bestScore = -Infinity;
      for (const f of remaining) {
        if (chosen.includes(f)) continue;
        const h = f.homeTeamId!;
        const a = f.awayTeamId!;
        if (busy.has(h) || busy.has(a)) continue;
        let score = 0;
        for (const team of [h, a]) {
          const last = lastSlot.get(team);
          if (!last || last.dayIndex !== slot.dayIndex) {
            score += 40;
          } else {
            const gap = slot.start - last.end;
            const backToBack = gap <= timing.transitionMin;
            score += backToBack ? -60 : Math.min(gap / Math.max(step, 1), 5) * 8;
          }
          score += (remainingByTeam.get(team) ?? 0) * 6;
        }
        score -= (f.roundNumber - minRound) * 6;
        score += rng() * jitter;
        if (score > bestScore) {
          bestScore = score;
          best = f;
        }
      }
      if (!best) break;
      chosen.push(best);
      busy.add(best.homeTeamId!);
      busy.add(best.awayTeamId!);
    }

    // Spread each team across pitches as evenly as possible.
    const freePitches = [...slot.pitchIds];
    for (const f of chosen) {
      let bestPitch = freePitches[0];
      let bestUse = Infinity;
      for (const p of freePitches) {
        const use =
          (pitchCount.get(`${f.homeTeamId}|${p}`) ?? 0) + (pitchCount.get(`${f.awayTeamId}|${p}`) ?? 0);
        if (use < bestUse) {
          bestUse = use;
          bestPitch = p;
        }
      }
      freePitches.splice(freePitches.indexOf(bestPitch), 1);
      placed.set(f.code, { slot, pitchId: bestPitch });
      for (const t of [f.homeTeamId!, f.awayTeamId!]) {
        lastSlot.set(t, slot);
        remainingByTeam.set(t, (remainingByTeam.get(t) ?? 1) - 1);
        pitchCount.set(`${t}|${bestPitch}`, (pitchCount.get(`${t}|${bestPitch}`) ?? 0) + 1);
      }
      remaining.splice(remaining.indexOf(f), 1);
    }
  }
  return { placed, unscheduled: remaining.map((f) => f.code) };
}

function scheduleKnockouts(
  fixtures: PlannedFixture[],
  slots: Slot[],
  placed: Map<string, { slot: Slot; pitchId: string }>,
  groupPhaseEnd: number | null,
  breakMin: number,
): string[] {
  const unscheduled: string[] = [];
  const byCode = new Map(fixtures.map((f) => [f.code, f]));
  const depthMemo = new Map<string, number>();
  const depth = (f: PlannedFixture, seen = new Set<string>()): number => {
    if (depthMemo.has(f.code)) return depthMemo.get(f.code)!;
    if (seen.has(f.code)) throw new Error(`Circular fixture dependency at ${f.code}`);
    seen.add(f.code);
    const d = 1 + Math.max(0, ...f.dependsOn.map((c) => (byCode.has(c) ? depth(byCode.get(c)!, seen) : 0)));
    depthMemo.set(f.code, d);
    return d;
  };
  const used = new Map<number, Set<string>>();
  for (const { slot, pitchId } of placed.values()) {
    if (!used.has(slot.index)) used.set(slot.index, new Set());
    used.get(slot.index)!.add(pitchId);
  }
  const freeIn = (slot: Slot) => slot.pitchIds.filter((p) => !used.get(slot.index)?.has(p));

  const earliest = (f: PlannedFixture): number | null => {
    let t = -Infinity;
    if (f.afterGroupPhase && groupPhaseEnd !== null) t = groupPhaseEnd + breakMin;
    for (const dep of f.dependsOn) {
      const p = placed.get(dep);
      if (!p) {
        if (byCode.has(dep)) return null; // dependency could not be scheduled
        continue;
      }
      t = Math.max(t, p.slot.dayIndex * 1440 + p.slot.end);
    }
    return t;
  };

  const levels = new Map<number, PlannedFixture[]>();
  for (const f of fixtures) {
    const d = depth(f);
    levels.set(d, [...(levels.get(d) ?? []), f]);
  }
  for (const d of [...levels.keys()].sort((a, b) => a - b)) {
    const group = levels.get(d)!;
    // Try to play the whole round simultaneously (e.g. both semi-finals together).
    const starts = group.map(earliest);
    if (starts.every((s) => s !== null)) {
      const from = Math.max(...(starts as number[]));
      const together = slots.find((s) => abs(s) >= from && freeIn(s).length >= group.length);
      if (together) {
        const free = freeIn(together);
        group.forEach((f, i) => {
          placed.set(f.code, { slot: together, pitchId: free[i] });
          if (!used.has(together.index)) used.set(together.index, new Set());
          used.get(together.index)!.add(free[i]);
        });
        continue;
      }
    }
    for (const f of group) {
      const from = earliest(f);
      const slot = from === null ? undefined : slots.find((s) => abs(s) >= from && freeIn(s).length > 0);
      if (!slot) {
        unscheduled.push(f.code);
        continue;
      }
      const pitch = freeIn(slot)[0];
      placed.set(f.code, { slot, pitchId: pitch });
      if (!used.has(slot.index)) used.set(slot.index, new Set());
      used.get(slot.index)!.add(pitch);
    }
  }
  return unscheduled;
}

function evaluate(
  fixtures: PlannedFixture[],
  placed: Map<string, { slot: Slot; pitchId: string }>,
  unscheduled: string[],
  slots: Slot[],
  timing: TimingConfig,
): ScheduleResult {
  const assignments: Assignment[] = [];
  const sortedCodes = fixtures
    .map((f) => f.code)
    .filter((c) => placed.has(c))
    .sort((a, b) => {
      const pa = placed.get(a)!;
      const pb = placed.get(b)!;
      return pa.slot.index - pb.slot.index || pa.slot.pitchIds.indexOf(pa.pitchId) - pb.slot.pitchIds.indexOf(pb.pitchId);
    });
  sortedCodes.forEach((code, i) => {
    const { slot, pitchId } = placed.get(code)!;
    assignments.push({ code, date: slot.date, start: slot.start, end: slot.end, pitchId, slotIndex: slot.index, order: i + 1 });
  });

  const byCode = new Map(fixtures.map((f) => [f.code, f]));
  const teamSlots = new Map<string, Slot[]>();
  const pitchUsage: Record<string, number> = {};
  for (const a of assignments) {
    pitchUsage[a.pitchId] = (pitchUsage[a.pitchId] ?? 0) + 1;
    const f = byCode.get(a.code)!;
    for (const t of [f.homeTeamId, f.awayTeamId]) {
      if (!t) continue;
      teamSlots.set(t, [...(teamSlots.get(t) ?? []), slots[a.slotIndex]]);
    }
  }
  let backToBack = 0;
  const teams: TeamScheduleStats[] = [];
  for (const [teamId, list] of teamSlots) {
    list.sort((a, b) => a.index - b.index);
    let b2b = 0;
    let longest = 0;
    for (let i = 1; i < list.length; i++) {
      if (list[i].dayIndex !== list[i - 1].dayIndex) continue;
      const gap = list[i].start - list[i - 1].end;
      if (gap <= timing.transitionMin) b2b++;
      longest = Math.max(longest, gap);
    }
    backToBack += b2b;
    teams.push({
      teamId,
      matches: list.length,
      backToBack: b2b,
      longestWaitMin: longest,
      firstStart: list[0]?.start ?? null,
      lastEnd: list[list.length - 1]?.end ?? null,
    });
  }
  const last = assignments.reduce<Assignment | null>(
    (acc, a) => (!acc || a.slotIndex > acc.slotIndex ? a : acc),
    null,
  );
  const usedSlotIndexes = new Set(assignments.map((a) => a.slotIndex));
  let emptyPitchSlots = 0;
  for (const idx of usedSlotIndexes) {
    emptyPitchSlots += slots[idx].pitchIds.length - assignments.filter((a) => a.slotIndex === idx).length;
  }
  return {
    feasible: unscheduled.length === 0,
    assignments,
    unscheduled,
    slots,
    metrics: {
      endDate: last?.date ?? null,
      endMinute: last?.end ?? null,
      slotsUsed: usedSlotIndexes.size,
      backToBack,
      emptyPitchSlots,
      pitchUsage,
      teams: teams.sort((a, b) => a.teamId.localeCompare(b.teamId)),
    },
  };
}

function cost(r: ScheduleResult): number {
  const lastSlot = Math.max(-1, ...r.assignments.map((a) => a.slotIndex));
  const waits = r.metrics.teams.reduce((s, t) => s + t.longestWaitMin, 0);
  const spread = Object.values(r.metrics.pitchUsage);
  const imbalance = spread.length ? Math.max(...spread) - Math.min(...spread) : 0;
  return r.unscheduled.length * 1_000_000 + lastSlot * 200 + r.metrics.backToBack * 50 + waits * 0.5 + imbalance * 5;
}

/**
 * Allocate fixtures to slots and pitches.
 *  - No team ever plays twice in the same slot (hard constraint).
 *  - Knockout fixtures start only after the matches they depend on.
 *  - Soft goals: fill pitches, avoid back-to-back matches, balance waits and
 *    pitch usage, keep knockout rounds simultaneous where pitches allow.
 * Several seeded randomised passes are run and the best one is kept.
 */
export function scheduleFixtures(input: ScheduleInput): ScheduleResult {
  const blocked = input.blocked ?? [];
  const slots = buildSlots(input.days, input.timing, input.pitches, blocked);
  const groupPhase = input.fixtures.filter((f) => f.stage !== "knockout");
  const knockouts = input.fixtures.filter((f) => f.stage === "knockout");
  for (const f of groupPhase) {
    if (!f.homeTeamId || !f.awayTeamId) throw new Error(`League fixture ${f.code} is missing a team`);
  }
  const attempts = Math.max(1, input.attempts ?? 60);
  const rng = mulberry32(input.seed ?? 20261110);

  let best: ScheduleResult | null = null;
  for (let i = 0; i < attempts; i++) {
    const { placed, unscheduled } = scheduleGroupPhase(groupPhase, slots, input.timing, rng, i === 0 ? 0 : 12);
    const groupPhaseEnd = groupPhase.length
      ? Math.max(...[...placed.values()].map((p) => p.slot.dayIndex * 1440 + p.slot.end), -Infinity)
      : null;
    const koUnscheduled = unscheduled.length
      ? knockouts.map((k) => k.code)
      : scheduleKnockouts(knockouts, slots, placed, groupPhaseEnd === -Infinity ? null : groupPhaseEnd, input.knockoutBreakMin ?? 0);
    const result = evaluate(input.fixtures, placed, [...unscheduled, ...koUnscheduled], slots, input.timing);
    if (!best || cost(result) < cost(best)) best = result;
    if (groupPhase.length === 0) break; // knockouts alone are deterministic
  }
  return best!;
}

/** Simple lower bound on the number of time slots the plan needs. */
export function minimumSlots(fixtures: PlannedFixture[], pitchCount: number): number {
  if (pitchCount < 1) return Infinity;
  const groupPhase = fixtures.filter((f) => f.stage !== "knockout");
  const perTeam = new Map<string, number>();
  for (const f of groupPhase) {
    for (const t of [f.homeTeamId, f.awayTeamId]) if (t) perTeam.set(t, (perTeam.get(t) ?? 0) + 1);
  }
  const teams = perTeam.size;
  const perSlot = Math.min(pitchCount, Math.floor(teams / 2)) || 1;
  const groupSlots = groupPhase.length
    ? Math.max(Math.ceil(groupPhase.length / perSlot), Math.max(0, ...perTeam.values()))
    : 0;

  const byCode = new Map(fixtures.map((f) => [f.code, f]));
  const memo = new Map<string, number>();
  const depth = (f: PlannedFixture): number => {
    if (memo.has(f.code)) return memo.get(f.code)!;
    const d = 1 + Math.max(0, ...f.dependsOn.map((c) => (byCode.has(c) ? depth(byCode.get(c)!) : 0)));
    memo.set(f.code, d);
    return d;
  };
  const levels = new Map<number, number>();
  for (const f of fixtures.filter((x) => x.stage === "knockout")) {
    const d = depth(f);
    levels.set(d, (levels.get(d) ?? 0) + 1);
  }
  let koSlots = 0;
  for (const count of levels.values()) koSlots += Math.ceil(count / pitchCount);
  return groupSlots + koSlots;
}
