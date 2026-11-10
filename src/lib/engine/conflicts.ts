import type { BlockedPeriod, DayWindow } from "./schedule";
import { formatClock, overlaps } from "./time";

export interface ScheduledMatch {
  id: string;
  code: string;
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeSource?: string | null;
  awaySource?: string | null;
  pitchId: string | null;
  date: string | null;
  start: number | null;
  durationMin: number;
  status?: string;
}

export type ConflictSeverity = "error" | "warning";

export interface Conflict {
  severity: ConflictSeverity;
  kind:
    | "team_double_booked"
    | "pitch_double_booked"
    | "dependency_order"
    | "outside_window"
    | "blocked_period"
    | "back_to_back"
    | "unscheduled"
    | "same_team";
  message: string;
  fixtureIds: string[];
}

export interface ConflictOptions {
  transitionMin?: number;
  windows?: DayWindow[];
  blocked?: BlockedPeriod[];
  teamName?: (id: string) => string;
  pitchName?: (id: string) => string;
}

/**
 * Validate a (possibly manually edited) schedule. Errors make the schedule
 * unplayable; warnings are allowed but shown to the organiser.
 */
export function detectConflicts(matches: ScheduledMatch[], options: ConflictOptions = {}): Conflict[] {
  const conflicts: Conflict[] = [];
  const teamName = options.teamName ?? ((id: string) => id);
  const pitchName = options.pitchName ?? ((id: string) => id);
  const transition = options.transitionMin ?? 0;
  const active = matches.filter((m) => m.status !== "cancelled");
  const scheduled = active.filter((m) => m.date && m.start !== null);

  for (const m of active) {
    if (!m.date || m.start === null) {
      conflicts.push({ severity: "warning", kind: "unscheduled", message: `${m.code} has no date or time.`, fixtureIds: [m.id] });
    }
    if (m.homeTeamId && m.homeTeamId === m.awayTeamId) {
      conflicts.push({ severity: "error", kind: "same_team", message: `${m.code}: a team cannot play itself.`, fixtureIds: [m.id] });
    }
  }

  for (let i = 0; i < scheduled.length; i++) {
    for (let j = i + 1; j < scheduled.length; j++) {
      const a = scheduled[i];
      const b = scheduled[j];
      if (a.date !== b.date) continue;
      const aEnd = a.start! + a.durationMin;
      const bEnd = b.start! + b.durationMin;
      const clash = overlaps(a.start!, aEnd, b.start!, bEnd);
      const teamsA = [a.homeTeamId, a.awayTeamId].filter(Boolean) as string[];
      const shared = [b.homeTeamId, b.awayTeamId].filter((t): t is string => !!t && teamsA.includes(t));
      if (clash && a.pitchId && a.pitchId === b.pitchId) {
        conflicts.push({
          severity: "error",
          kind: "pitch_double_booked",
          message: `${a.code} and ${b.code} overlap on ${pitchName(a.pitchId)} at ${formatClock(Math.max(a.start!, b.start!))}.`,
          fixtureIds: [a.id, b.id],
        });
      }
      for (const t of shared) {
        if (clash) {
          conflicts.push({
            severity: "error",
            kind: "team_double_booked",
            message: `${teamName(t)} is scheduled in ${a.code} and ${b.code} at the same time.`,
            fixtureIds: [a.id, b.id],
          });
        } else {
          const gap = a.start! < b.start! ? b.start! - aEnd : a.start! - bEnd;
          if (gap >= 0 && gap <= transition) {
            conflicts.push({
              severity: "warning",
              kind: "back_to_back",
              message: `${teamName(t)} plays back-to-back in ${a.code} and ${b.code}.`,
              fixtureIds: [a.id, b.id],
            });
          }
        }
      }
    }
  }

  // Knockout fixtures must start after the matches that feed them.
  const byCode = new Map(active.map((m) => [m.code, m]));
  for (const m of scheduled) {
    for (const src of [m.homeSource, m.awaySource]) {
      const ref = src ? /^(?:winner|loser):(.+)$/.exec(src)?.[1] : undefined;
      const dep = ref ? byCode.get(ref) : undefined;
      if (!dep || !dep.date || dep.start === null) continue;
      const depEnd = dep.date + String(dep.start + dep.durationMin).padStart(5, "0");
      const start = m.date + String(m.start).padStart(5, "0");
      if (start < depEnd) {
        conflicts.push({
          severity: "error",
          kind: "dependency_order",
          message: `${m.code} starts before ${dep.code} (which decides one of its teams) has finished.`,
          fixtureIds: [m.id, dep.id],
        });
      }
    }
  }

  if (options.windows?.length) {
    for (const m of scheduled) {
      const w = options.windows.find((d) => d.date === m.date);
      if (!w || m.start! < w.start || m.start! + m.durationMin > w.end) {
        conflicts.push({
          severity: "warning",
          kind: "outside_window",
          message: `${m.code} is outside the tournament playing window.`,
          fixtureIds: [m.id],
        });
      }
    }
  }
  if (options.blocked?.length) {
    for (const m of scheduled) {
      const hit = options.blocked.find(
        (b) =>
          (!b.date || b.date === m.date) &&
          (!b.pitchId || b.pitchId === m.pitchId) &&
          overlaps(m.start!, m.start! + m.durationMin, b.start, b.end),
      );
      if (hit) {
        conflicts.push({
          severity: "warning",
          kind: "blocked_period",
          message: `${m.code} overlaps a blocked period${hit.label ? ` (${hit.label})` : ""}.`,
          fixtureIds: [m.id],
        });
      }
    }
  }
  return conflicts;
}
