/**
 * Client-side state for a live match: the stored fixture, saved events and
 * events still being saved. Pure functions so they can be unit tested.
 *
 * Rules:
 *  - The database is the source of truth. A pending event is shown as "saving"
 *    (or "not saved yet") until the database returns it.
 *  - Every event has a client-generated id, so the same event arriving from the
 *    local save and from realtime (or a retry) is never shown twice.
 */
import type { Fixture, MatchEvent } from "@/lib/types";

export type PendingStatus = "saving" | "retrying" | "failed";

export interface PendingEvent {
  event: MatchEvent;
  status: PendingStatus;
  error?: string;
  attempts: number;
}

export interface LiveState {
  fixture: Fixture;
  events: MatchEvent[];
  pending: PendingEvent[];
}

export type LiveAction =
  | { type: "reset"; fixture: Fixture; events: MatchEvent[] }
  | { type: "fixture"; row: Fixture }
  | { type: "upsertEvent"; row: MatchEvent }
  | { type: "deleteEvent"; id: string }
  | { type: "addPending"; event: MatchEvent }
  | { type: "pendingStatus"; id: string; status: PendingStatus; error?: string }
  | { type: "removePending"; id: string };

const byTime = (a: MatchEvent, b: MatchEvent) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);

/** Newer fixture rows win; stale realtime messages never roll the clock back. */
export function isNewerFixture(current: Fixture, incoming: Fixture): boolean {
  if (incoming.id !== current.id) return false;
  if ((incoming.state_version ?? 0) !== (current.state_version ?? 0)) return (incoming.state_version ?? 0) > (current.state_version ?? 0);
  return incoming.updated_at >= current.updated_at;
}

export function liveReducer(state: LiveState, action: LiveAction): LiveState {
  switch (action.type) {
    case "reset": {
      // Server data replaces local data, but keep events that are still being saved.
      const ids = new Set(action.events.map((e) => e.id));
      return { fixture: action.fixture, events: [...action.events].sort(byTime), pending: state.pending.filter((p) => !ids.has(p.event.id)) };
    }
    case "fixture":
      return isNewerFixture(state.fixture, action.row) ? { ...state, fixture: { ...state.fixture, ...action.row } } : state;
    case "upsertEvent": {
      if (action.row.fixture_id !== state.fixture.id) return state;
      const events = state.events.filter((e) => e.id !== action.row.id);
      events.push(action.row);
      return { ...state, events: events.sort(byTime), pending: state.pending.filter((p) => p.event.id !== action.row.id) };
    }
    case "deleteEvent":
      return { ...state, events: state.events.filter((e) => e.id !== action.id), pending: state.pending.filter((p) => p.event.id !== action.id) };
    case "addPending":
      if (state.pending.some((p) => p.event.id === action.event.id) || state.events.some((e) => e.id === action.event.id)) return state;
      return { ...state, pending: [...state.pending, { event: action.event, status: "saving", attempts: 1 }] };
    case "pendingStatus":
      return {
        ...state,
        pending: state.pending.map((p) =>
          p.event.id === action.id ? { ...p, status: action.status, error: action.error, attempts: p.attempts + (action.status === "saving" ? 1 : 0) } : p,
        ),
      };
    case "removePending":
      return { ...state, pending: state.pending.filter((p) => p.event.id !== action.id) };
  }
}

const SCORING = new Set(["goal", "penalty_goal"]);

/**
 * Score shown on screen: saved events plus events still being saved (not failed),
 * using the same rules as the database trigger. Own goals count for the other team;
 * shootout kicks are separate. Forfeits use the stored score.
 */
export function displayScore(fixture: Fixture, events: MatchEvent[], pending: PendingEvent[]) {
  if (fixture.decided_by === "forfeit") {
    return { home: fixture.home_score, away: fixture.away_score, homePens: fixture.home_penalties, awayPens: fixture.away_penalties };
  }
  const all = [...events, ...pending.filter((p) => p.status !== "failed").map((p) => p.event)];
  let home = 0;
  let away = 0;
  let homePens = 0;
  let awayPens = 0;
  let shootout = false;
  for (const e of all) {
    if (SCORING.has(e.event_type)) {
      if (e.team_id === fixture.home_team_id) home++;
      else if (e.team_id === fixture.away_team_id) away++;
    } else if (e.event_type === "own_goal") {
      if (e.team_id === fixture.home_team_id) away++;
      else if (e.team_id === fixture.away_team_id) home++;
    } else if (e.event_type === "shootout_goal" || e.event_type === "shootout_miss") {
      shootout = true;
      if (e.event_type === "shootout_goal") {
        if (e.team_id === fixture.home_team_id) homePens++;
        else if (e.team_id === fixture.away_team_id) awayPens++;
      }
    }
  }
  return { home, away, homePens: shootout ? homePens : null, awayPens: shootout ? awayPens : null };
}

/** Saved and pending events in one timeline (pending flagged). */
export function timeline(state: LiveState): (MatchEvent & { pendingStatus?: PendingStatus; pendingError?: string })[] {
  return [
    ...state.events,
    ...state.pending.map((p) => ({ ...p.event, pendingStatus: p.status, pendingError: p.error })),
  ].sort(byTime);
}

/** Classify a failed save: network problems are retried, rejections are reverted. */
export function classifyError(error: { message?: string; code?: string; details?: string | null } | null | undefined, online: boolean) {
  if (!error) return "ok" as const;
  const msg = `${error.message ?? ""} ${error.details ?? ""}`;
  if (!online || /Failed to fetch|NetworkError|network|Load failed|timeout|fetch failed|ECONN|aborted/i.test(msg) || error.code === "" || error.code === undefined) {
    return "network" as const;
  }
  if (error.code === "23505" && /match_events_pkey/.test(msg)) return "duplicate" as const;
  return "rejected" as const;
}
