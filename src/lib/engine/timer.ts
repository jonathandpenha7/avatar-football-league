/**
 * Match clock as displayed on every device. Mirrors private.normalize_clock in
 * the database: the stored state plus "now" fully determines the phase and the
 * remaining time, so refreshing, switching devices or reconnecting always
 * shows the correct time. The database remains the source of truth; this only
 * renders it (and tells the client when an automatic transition is due).
 */
export type MatchPeriod = "not_started" | "first_half" | "half_time" | "second_half" | "extra_time" | "penalties" | "full_time";

export interface ClockState {
  status: string;
  period: MatchPeriod;
  timerStartedAt: string | null;
  timerElapsedSec: number;
  phaseTargetSec: number | null;
  addedTimeSec: number;
  firstHalfElapsedSec: number | null;
  secondHalfElapsedSec: number | null;
}

export interface ClockConfig {
  periods: 1 | 2;
  /** Length of each half (or the whole match when periods = 1), in seconds. */
  halfSec: number | null;
  halfTimeSec: number;
  extraTimeSec: number;
}

export interface ClockView {
  status: string;
  period: MatchPeriod;
  running: boolean;
  elapsedSec: number;
  targetSec: number | null;
  remainingSec: number | null;
  /** Total match time for event minutes (first half + second half so far). */
  matchSecond: number;
  /** True when the stored state is behind (an automatic transition is due and should be synced). */
  transitionDue: boolean;
}

const PLAY: MatchPeriod[] = ["first_half", "second_half", "extra_time"];

function baseTarget(period: MatchPeriod, cfg: ClockConfig): number | null {
  switch (period) {
    case "first_half":
    case "second_half":
      return cfg.halfSec;
    case "half_time":
      return cfg.halfTimeSec;
    case "extra_time":
      return cfg.extraTimeSec;
    default:
      return null;
  }
}

function targetOf(s: ClockState, cfg: ClockConfig): number | null {
  const base = s.phaseTargetSec ?? baseTarget(s.period, cfg);
  if (base === null) return null;
  return base + (PLAY.includes(s.period) ? s.addedTimeSec : 0);
}

function runningElapsed(s: ClockState, nowMs: number): number {
  if (!s.timerStartedAt) return s.timerElapsedSec;
  return s.timerElapsedSec + Math.max(0, Math.floor((nowMs - Date.parse(s.timerStartedAt)) / 1000));
}

/** Apply automatic transitions that are due at `nowMs` (same rules as the database). */
export function normalizeClock(input: ClockState, cfg: ClockConfig, nowMs: number): ClockState {
  let s = { ...input };
  for (let i = 0; i < 4; i++) {
    if (s.status !== "in_progress" || !s.timerStartedAt || !["first_half", "half_time", "second_half", "extra_time"].includes(s.period)) break;
    const target = targetOf(s, cfg);
    if (target === null || runningElapsed(s, nowMs) < target) break;
    const expiry = Date.parse(s.timerStartedAt) + (target - s.timerElapsedSec) * 1000;
    if (s.period === "first_half" && cfg.periods === 2) {
      s = {
        ...s,
        firstHalfElapsedSec: target,
        period: "half_time",
        timerElapsedSec: 0,
        timerStartedAt: new Date(expiry).toISOString(),
        addedTimeSec: 0,
        phaseTargetSec: cfg.halfTimeSec,
      };
    } else if (s.period === "half_time") {
      s = { ...s, timerElapsedSec: target, timerStartedAt: null };
      break;
    } else {
      s = {
        ...s,
        firstHalfElapsedSec: s.period === "first_half" ? target : s.firstHalfElapsedSec,
        secondHalfElapsedSec: s.period === "second_half" ? target : s.secondHalfElapsedSec,
        timerElapsedSec: target,
        timerStartedAt: null,
        status: "completed",
        period: "full_time",
      };
      break;
    }
  }
  return s;
}

export function clockView(state: ClockState, cfg: ClockConfig, nowMs: number): ClockView {
  const s = normalizeClock(state, cfg, nowMs);
  const elapsed = runningElapsed(s, nowMs);
  const target = targetOf(s, cfg);
  const offset =
    s.period === "second_half"
      ? s.firstHalfElapsedSec ?? cfg.halfSec ?? 0
      : s.period === "extra_time"
        ? (s.firstHalfElapsedSec ?? 0) + (s.secondHalfElapsedSec ?? 0)
        : 0;
  const matchSecond =
    s.period === "half_time"
      ? s.firstHalfElapsedSec ?? 0
      : s.period === "full_time" || s.period === "penalties"
        ? (s.firstHalfElapsedSec ?? 0) + (s.secondHalfElapsedSec ?? s.timerElapsedSec)
        : offset + Math.min(elapsed, target ?? elapsed);
  return {
    status: s.status,
    period: s.period,
    running: !!s.timerStartedAt && s.status === "in_progress",
    elapsedSec: elapsed,
    targetSec: target,
    remainingSec: target === null ? null : Math.max(0, target - elapsed),
    matchSecond,
    transitionDue: s.period !== state.period || s.status !== state.status || s.timerStartedAt !== state.timerStartedAt,
  };
}

export const PERIOD_LABELS: Record<MatchPeriod, string> = {
  not_started: "Not started",
  first_half: "First half",
  half_time: "Half-time break",
  second_half: "Second half",
  extra_time: "Extra time",
  penalties: "Penalty shootout",
  full_time: "Full time",
};

export function formatMinSec(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
