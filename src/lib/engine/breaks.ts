/** Tournament breaks, team rest periods and the schedule summary. Pure functions. */

export interface BreakInput {
  date?: string | null;
  start: number;
  end: number;
  pitchId?: string | null;
  label?: string | null;
  description?: string | null;
}

export interface ScheduleItem {
  id: string;
  code: string;
  stage: string;
  homeTeamId: string | null;
  awayTeamId: string | null;
  pitchId: string | null;
  date: string | null;
  start: number | null;
  durationMin: number;
  status: string;
}

export interface BreakItem {
  key: string;
  label: string;
  description: string | null;
  date: string | null;
  start: number;
  end: number;
  durationMin: number;
  /** null = affects every pitch */
  pitchId: string | null;
  source: "configured" | "knockout_gap";
}

/**
 * Configured breaks plus the real gap between the last league or group match
 * and the first knockout match (shown as "Break before the knockouts").
 */
export function scheduleBreaks(breaks: BreakInput[], items: ScheduleItem[], defaultDate: string | null): BreakItem[] {
  const out: BreakItem[] = breaks
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => b.end > b.start)
    .map(({ b, i }) => ({
      key: `b${i}`,
      label: b.label?.trim() || "Break",
      description: b.description ?? null,
      date: b.date ?? defaultDate,
      start: b.start,
      end: b.end,
      durationMin: b.end - b.start,
      pitchId: b.pitchId ?? null,
      source: "configured" as const,
    }));
  const timed = items.filter((x) => x.date && x.start !== null && x.status !== "cancelled");
  const league = timed.filter((x) => x.stage !== "knockout");
  const knockout = timed.filter((x) => x.stage === "knockout");
  if (league.length && knockout.length) {
    const lastLeague = league.reduce((a, b) => (key(b, true) > key(a, true) ? b : a));
    const firstKo = knockout.reduce((a, b) => (key(b) < key(a) ? b : a));
    const gapStart = lastLeague.start! + lastLeague.durationMin;
    if (lastLeague.date === firstKo.date && firstKo.start! > gapStart) {
      out.push({
        key: "ko-gap",
        label: "Break before the knockouts",
        description: "League review and preparation for the semi-finals.",
        date: firstKo.date,
        start: gapStart,
        end: firstKo.start!,
        durationMin: firstKo.start! - gapStart,
        pitchId: null,
        source: "knockout_gap",
      });
    }
  }
  return out.sort((a, b) => `${a.date ?? ""}${pad(a.start)}`.localeCompare(`${b.date ?? ""}${pad(b.start)}`));
}

const pad = (n: number) => String(n).padStart(5, "0");
const key = (x: ScheduleItem, end = false) => `${x.date}${pad(x.start! + (end ? x.durationMin : 0))}`;

export interface RestPeriod {
  teamId: string;
  previousCode: string;
  nextCode: string;
  date: string;
  previousEnd: number;
  nextStart: number;
  restMin: number;
}

/** Time between each team's consecutive matches (same day). */
export function teamRestPeriods(items: ScheduleItem[]): RestPeriod[] {
  const byTeam = new Map<string, ScheduleItem[]>();
  for (const x of items) {
    if (!x.date || x.start === null || x.status === "cancelled") continue;
    for (const t of [x.homeTeamId, x.awayTeamId]) if (t) byTeam.set(t, [...(byTeam.get(t) ?? []), x]);
  }
  const out: RestPeriod[] = [];
  for (const [teamId, list] of byTeam) {
    list.sort((a, b) => key(a).localeCompare(key(b)));
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1];
      const next = list[i];
      if (prev.date !== next.date) continue;
      const prevEnd = prev.start! + prev.durationMin;
      out.push({ teamId, previousCode: prev.code, nextCode: next.code, date: next.date!, previousEnd: prevEnd, nextStart: next.start!, restMin: next.start! - prevEnd });
    }
  }
  return out;
}

export interface ScheduleSummary {
  totalMatches: number;
  scheduledMatches: number;
  totalPlayingMin: number;
  totalBreakMin: number;
  matchesPerPitch: Record<string, number>;
  firstStart: number | null;
  lastEnd: number | null;
  breaks: number;
}

export function scheduleSummary(items: ScheduleItem[], breaks: BreakItem[]): ScheduleSummary {
  const active = items.filter((x) => x.status !== "cancelled");
  const timed = active.filter((x) => x.date && x.start !== null);
  const matchesPerPitch: Record<string, number> = {};
  for (const x of active) if (x.pitchId) matchesPerPitch[x.pitchId] = (matchesPerPitch[x.pitchId] ?? 0) + 1;
  return {
    totalMatches: active.length,
    scheduledMatches: timed.length,
    totalPlayingMin: active.reduce((s, x) => s + x.durationMin, 0),
    totalBreakMin: breaks.filter((b) => !b.pitchId).reduce((s, b) => s + b.durationMin, 0),
    matchesPerPitch,
    firstStart: timed.length ? Math.min(...timed.map((x) => x.start!)) : null,
    lastEnd: timed.length ? Math.max(...timed.map((x) => x.start! + x.durationMin)) : null,
    breaks: breaks.length,
  };
}

/** The break happening at `nowMin` on `date`, if any. */
export function activeBreak(breaks: BreakItem[], date: string, nowMin: number): BreakItem | null {
  return breaks.find((b) => (b.date ?? date) === date && nowMin >= b.start && nowMin < b.end) ?? null;
}
