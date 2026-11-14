import { describe, expect, it } from "vitest";
import { classifyError, displayScore, isNewerFixture, liveReducer, timeline, type LiveState } from "@/lib/live-match";
import { bumpAttempts, outboxFor, putOutbox, readOutbox, removeOutbox, type OutboxStorage } from "@/lib/event-outbox";
import { percentile, summarisePerf } from "@/lib/perf-summary";
import type { Fixture, MatchEvent } from "@/lib/types";

const HOME = "h0000000-0000-4000-8000-000000000001";
const AWAY = "a0000000-0000-4000-8000-000000000002";
const fixture = (over: Partial<Fixture> = {}): Fixture =>
  ({
    id: "f1", tournament_id: "t1", code: "L1", stage: "league", status: "in_progress", period: "first_half",
    home_team_id: HOME, away_team_id: AWAY, home_score: 0, away_score: 0, home_penalties: null, away_penalties: null,
    decided_by: null, state_version: 3, updated_at: "2026-11-15T11:30:00.000Z", ...over,
  }) as Fixture;
let n = 0;
const ev = (type: MatchEvent["event_type"], team: string, over: Partial<MatchEvent> = {}): MatchEvent =>
  ({
    id: `e${++n}`, tournament_id: "t1", fixture_id: "f1", event_type: type, team_id: team, player_id: null, assist_player_id: null,
    related_player_id: null, match_second: 60, period: "first_half", duration_min: null, detail: null, created_by: "u1",
    created_at: `2026-11-15T11:3${n % 10}:00.000Z`, ...over,
  }) as MatchEvent;
const state = (over: Partial<LiveState> = {}): LiveState => ({ fixture: fixture(), events: [], pending: [], ...over });

describe("optimistic event state", () => {
  it("a pending goal shows in the score at once and is replaced, not doubled, when saved", () => {
    const goal = ev("goal", HOME);
    let s = liveReducer(state(), { type: "addPending", event: goal });
    expect(displayScore(s.fixture, s.events, s.pending)).toMatchObject({ home: 1, away: 0 });
    // Saved row arrives from the insert response...
    s = liveReducer(s, { type: "upsertEvent", row: { ...goal, match_second: 125 } });
    // ...and again from realtime.
    s = liveReducer(s, { type: "upsertEvent", row: { ...goal, match_second: 125 } });
    expect(s.pending).toHaveLength(0);
    expect(s.events).toHaveLength(1);
    expect(s.events[0].match_second).toBe(125);
    expect(displayScore(s.fixture, s.events, s.pending)).toMatchObject({ home: 1, away: 0 });
  });

  it("the same pending event added twice (double tap or retry) is kept once", () => {
    const goal = ev("goal", AWAY);
    let s = liveReducer(state(), { type: "addPending", event: goal });
    s = liveReducer(s, { type: "addPending", event: goal });
    expect(s.pending).toHaveLength(1);
    s = liveReducer(s, { type: "upsertEvent", row: goal });
    s = liveReducer(s, { type: "addPending", event: goal });
    expect(s.pending).toHaveLength(0);
  });

  it("a rejected event is removed and the score goes back", () => {
    const goal = ev("goal", HOME);
    let s = liveReducer(state(), { type: "addPending", event: goal });
    s = liveReducer(s, { type: "removePending", id: goal.id });
    expect(displayScore(s.fixture, s.events, s.pending)).toMatchObject({ home: 0, away: 0 });
  });

  it("an event waiting for the connection stays visible and counted, flagged as not saved", () => {
    const goal = ev("goal", HOME);
    let s = liveReducer(state(), { type: "addPending", event: goal });
    s = liveReducer(s, { type: "pendingStatus", id: goal.id, status: "retrying", error: "offline" });
    expect(timeline(s)[0].pendingStatus).toBe("retrying");
    expect(displayScore(s.fixture, s.events, s.pending).home).toBe(1);
  });

  it("server data replaces local data but keeps events still being saved", () => {
    const saved = ev("goal", HOME);
    const waiting = ev("goal", AWAY);
    let s = liveReducer(state(), { type: "addPending", event: waiting });
    s = liveReducer(s, { type: "reset", fixture: fixture({ state_version: 4 }), events: [saved] });
    expect(s.events.map((e) => e.id)).toEqual([saved.id]);
    expect(s.pending.map((p) => p.event.id)).toEqual([waiting.id]);
    expect(displayScore(s.fixture, s.events, s.pending)).toMatchObject({ home: 1, away: 1 });
  });

  it("deletes from another device remove the event", () => {
    const goal = ev("goal", HOME);
    let s = liveReducer(state(), { type: "upsertEvent", row: goal });
    s = liveReducer(s, { type: "deleteEvent", id: goal.id });
    expect(s.events).toHaveLength(0);
  });

  it("events for another match are ignored", () => {
    const s = liveReducer(state(), { type: "upsertEvent", row: ev("goal", HOME, { fixture_id: "f2" }) });
    expect(s.events).toHaveLength(0);
  });
});

describe("score rules match the database", () => {
  it("own goals count for the other team; penalty goals count; cards and fouls do not", () => {
    const events = [ev("goal", HOME), ev("own_goal", HOME), ev("penalty_goal", AWAY), ev("yellow_card", HOME), ev("foul", AWAY)];
    expect(displayScore(fixture(), events, [])).toEqual({ home: 1, away: 2, homePens: null, awayPens: null });
  });

  it("shootout kicks are counted separately from the score", () => {
    const events = [ev("goal", HOME), ev("shootout_goal", HOME), ev("shootout_miss", AWAY), ev("shootout_goal", AWAY), ev("shootout_goal", HOME)];
    expect(displayScore(fixture(), events, [])).toEqual({ home: 1, away: 0, homePens: 2, awayPens: 1 });
  });

  it("a forfeit shows the stored result, not the events", () => {
    const f = fixture({ decided_by: "forfeit", home_score: 3, away_score: 0 });
    expect(displayScore(f, [ev("goal", AWAY)], [])).toMatchObject({ home: 3, away: 0 });
  });
});

describe("clock updates never go backwards", () => {
  it("newer state versions win and stale realtime messages are ignored", () => {
    const current = fixture({ state_version: 5, status: "paused" });
    expect(isNewerFixture(current, fixture({ state_version: 4, status: "in_progress" }))).toBe(false);
    expect(isNewerFixture(current, fixture({ state_version: 6 }))).toBe(true);
    let s = state({ fixture: current });
    s = liveReducer(s, { type: "fixture", row: fixture({ state_version: 4, status: "in_progress" }) });
    expect(s.fixture.status).toBe("paused");
  });

  it("same version: a later update (e.g. score recalculation) is applied", () => {
    const current = fixture({ state_version: 5 });
    const s = liveReducer(state({ fixture: current }), { type: "fixture", row: fixture({ state_version: 5, home_score: 1, updated_at: "2026-11-15T11:31:00.000Z" }) });
    expect(s.fixture.home_score).toBe(1);
  });
});

describe("error classification", () => {
  it("connection problems are retried, duplicates count as saved, rule violations are reverted", () => {
    expect(classifyError(null, true)).toBe("ok");
    expect(classifyError({ message: "TypeError: Failed to fetch", code: "" }, true)).toBe("network");
    expect(classifyError({ message: "anything", code: "42501" }, false)).toBe("network");
    expect(classifyError({ message: 'duplicate key value violates unique constraint "match_events_pkey"', code: "23505" }, true)).toBe("duplicate");
    expect(classifyError({ message: "Events can only be recorded while the match is in progress.", code: "P0001" }, true)).toBe("rejected");
    expect(classifyError({ message: "new row violates row-level security policy", code: "42501" }, true)).toBe("rejected");
  });
});

describe("durable outbox", () => {
  const memory = (): OutboxStorage & { data: Map<string, string> } => {
    const data = new Map<string, string>();
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
  };
  const entry = (id: string, fixtureId = "f1") => ({ id, tournamentId: "t1", fixtureId, payload: { id, event_type: "goal" }, createdAt: "x", attempts: 1 });

  it("keeps entries across reloads, per match, without duplicates", () => {
    const store = memory();
    expect(putOutbox(entry("a"), store)).toBe(true);
    putOutbox(entry("a"), store);
    putOutbox(entry("b", "f2"), store);
    expect(readOutbox(store)).toHaveLength(2);
    expect(outboxFor("f1", store).map((e) => e.id)).toEqual(["a"]);
    bumpAttempts("a", store);
    expect(outboxFor("f1", store)[0].attempts).toBe(2);
    removeOutbox("a", store);
    expect(outboxFor("f1", store)).toHaveLength(0);
    expect(outboxFor("f2", store)).toHaveLength(1);
  });

  it("reports when nothing can be stored, and survives corrupt data", () => {
    const full: OutboxStorage = { getItem: () => null, setItem: () => { throw new Error("QuotaExceededError"); } };
    expect(putOutbox(entry("a"), full)).toBe(false);
    expect(putOutbox(entry("a"), null)).toBe(false);
    const store = memory();
    store.data.set("ctm:event-outbox:v1", "{not json");
    expect(readOutbox(store)).toEqual([]);
  });
});

describe("performance summary", () => {
  it("nearest-rank percentiles", () => {
    const sorted = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(sorted, 50)).toBe(50);
    expect(percentile(sorted, 90)).toBe(90);
    expect(percentile(sorted, 99)).toBe(99);
    expect(percentile([], 50)).toBeNull();
  });

  it("groups by measure and web-vital name, counting failures", () => {
    const row = (kind: string, d: number | null, ok = true, meta: Record<string, unknown> = {}) => ({ kind, duration_ms: d, ok, path: "/", meta, created_at: "x" });
    const groups = summarisePerf([
      row("event_save", 100), row("event_save", 300), row("event_save", 900, false),
      row("page_web_vital", 1500, true, { metric: "LCP" }), row("page_web_vital", 20, true, { metric: "TTFB" }),
    ]);
    const save = groups.find((g) => g.key === "event_save")!;
    expect(save).toMatchObject({ count: 3, failures: 1, p50: 300, target: 500 });
    expect(groups.find((g) => g.key === "page_web_vital:LCP")?.target).toBe(2000);
  });
});
