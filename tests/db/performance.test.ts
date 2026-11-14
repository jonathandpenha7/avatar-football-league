import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { asAnon, asService, asUser, createTestDb, createUser, playMatch, type TestDb } from "./harness";

/**
 * Database side of the fast scoring path: client-generated event ids make
 * retries idempotent, scores always equal the stored events, two referees on
 * two pitches stay isolated, fouls no longer rewrite the fixture, and the
 * telemetry table is protected by RLS.
 */
let db: TestDb;
let admin: string;
let ref1: string;
let ref2: string;
let viewer: string;
let outsider: string;
let tid: string;
let otherTid: string;
let teams: string[] = [];
let p1: string;
let p2: string;
const players: Record<string, string[]> = {};

type Row = Record<string, unknown>;
const one = async <T = Row>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];
const fixture = (id: string) => one<{ home_score: number; away_score: number; updated_at: string; state_version: number }>("select * from public.fixtures where id = $1", [id]);
const insertEvent = (id: string, fixtureId: string, type: string, team: string, player: string | null = null) =>
  db.query(
    "insert into public.match_events (id, tournament_id, fixture_id, event_type, team_id, player_id) values ($1, $2, $3, $4, $5, $6) returning id",
    [id, tid, fixtureId, type, team, player],
  );
const errorOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    return e as { code?: string; message: string; constraint?: string };
  }
};
const countEvents = async (fixtureId: string) =>
  Number((await one<{ n: string }>("select count(*) n from public.match_events where fixture_id = $1", [fixtureId])).n);

beforeAll(async () => {
  db = await createTestDb();
  admin = await createUser(db, "admin@perf.test");
  ref1 = await createUser(db, "ref1@perf.test");
  ref2 = await createUser(db, "ref2@perf.test");
  viewer = await createUser(db, "viewer@perf.test");
  outsider = await createUser(db, "outsider@perf.test");
  await asUser(db, admin);
  const create = (name: string) =>
    one<{ id: string }>("select public.create_tournament($1::jsonb) id", [JSON.stringify({
      tournament: { name, format: "league_playoff" },
      settings: { team_count: 4, max_squad_size: 6, players_on_pitch: 5, qualifiers: 4, periods: 2, match_duration_min: 14, half_time_min: 2 },
      teams: [{ name: "Lions" }, { name: "Eagles" }, { name: "Bears" }, { name: "Wolves" }],
    })]);
  tid = (await create("Perf Cup")).id;
  otherTid = (await create("Other Cup")).id;
  teams = (await db.query<{ id: string }>("select id from public.teams where tournament_id = $1 order by seed", [tid])).rows.map((r) => r.id);
  for (const t of teams) {
    players[t] = [];
    for (let i = 1; i <= 3; i++) {
      players[t].push((await one<{ id: string }>("insert into public.players (tournament_id, team_id, full_name) values ($1, $2, $3) returning id", [tid, t, `P${i}`])).id);
    }
  }
  for (const [user, role] of [[ref1, "referee"], [ref2, "referee"], [viewer, "viewer"]]) {
    await db.query("insert into public.tournament_members (tournament_id, user_id, role) values ($1, $2, $3)", [tid, user, role]);
  }
  await db.query("select public.replace_fixtures($1, 'all', $2::jsonb)", [tid, JSON.stringify([
    { code: "P1", stage: "league", home_team_id: teams[0], away_team_id: teams[1] },
    { code: "P2", stage: "league", home_team_id: teams[2], away_team_id: teams[3] },
  ])]);
  const fx = Object.fromEntries((await db.query<{ id: string; code: string }>("select id, code from public.fixtures where tournament_id = $1", [tid])).rows.map((r) => [r.code, r.id]));
  p1 = fx.P1;
  p2 = fx.P2;
  await db.query("insert into public.match_officials (tournament_id, fixture_id, user_id, role) values ($1, $2, $3, 'referee'), ($1, $4, $5, 'referee')", [tid, p1, ref1, p2, ref2]);
  await asUser(db, ref1);
  await playMatch(db, p1, "started");
  await asUser(db, ref2);
  await playMatch(db, p2, "started");
});

describe("idempotent event saves", () => {
  it("a retried save with the same client id never creates a second event", async () => {
    await asUser(db, ref1);
    const id = randomUUID();
    await insertEvent(id, p1, "goal", teams[0], players[teams[0]][0]);
    const err = await errorOf(insertEvent(id, p1, "goal", teams[0], players[teams[0]][0]));
    expect(err?.code).toBe("23505");
    expect(err?.message).toMatch(/match_events_pkey/);
    expect(await countEvents(p1)).toBe(1);
    expect((await fixture(p1)).home_score).toBe(1);
  });

  it("the stored event can be read back after a duplicate (how the app recovers)", async () => {
    await asUser(db, ref1);
    const id = randomUUID();
    await insertEvent(id, p1, "goal", teams[1], players[teams[1]][0]);
    await errorOf(insertEvent(id, p1, "goal", teams[1], players[teams[1]][0]));
    const row = await one<{ id: string; created_by: string; period: string }>("select id, created_by, period from public.match_events where id = $1", [id]);
    expect(row.id).toBe(id);
    expect(row.created_by).toBe(ref1);
    expect(row.period).toBe("first_half"); // stamped by the server, not the client
    expect((await fixture(p1)).away_score).toBe(1);
  });
});

describe("rapid and concurrent scoring", () => {
  it("many quick events: the score always equals the stored goals", async () => {
    await asUser(db, ref1);
    const ids = Array.from({ length: 30 }, () => randomUUID());
    await Promise.all(ids.map((id, i) => insertEvent(id, p1, i % 3 === 2 ? "foul" : "goal", teams[i % 2], players[teams[i % 2]][i % 3])));
    const goals = await one<{ h: string; a: string }>(
      "select count(*) filter (where team_id = $2 and event_type = 'goal') h, count(*) filter (where team_id = $3 and event_type = 'goal') a from public.match_events where fixture_id = $1",
      [p1, teams[0], teams[1]],
    );
    const f = await fixture(p1);
    expect(f.home_score).toBe(Number(goals.h));
    expect(f.away_score).toBe(Number(goals.a));
    expect(await countEvents(p1)).toBe(32);
  });

  it("two referees on two pitches: events land only in their own match", async () => {
    const before1 = await countEvents(p1);
    const before2 = await countEvents(p2);
    for (let i = 0; i < 10; i++) {
      await asUser(db, ref1);
      await insertEvent(randomUUID(), p1, "goal", teams[0], players[teams[0]][0]);
      await asUser(db, ref2);
      await insertEvent(randomUUID(), p2, "own_goal", teams[2], players[teams[2]][1]);
    }
    expect(await countEvents(p1)).toBe(before1 + 10);
    expect(await countEvents(p2)).toBe(before2 + 10);
    const f2 = await fixture(p2);
    expect([f2.home_score, f2.away_score]).toEqual([0, 10]); // own goals count for the other team
  });

  it("a referee cannot write to a match they are not assigned to", async () => {
    await asUser(db, ref2);
    const err = await errorOf(insertEvent(randomUUID(), p1, "goal", teams[0], players[teams[0]][0]));
    expect(err?.message).toMatch(/row-level security/);
  });

  it("an event with an id that already exists in another match is rejected, not merged", async () => {
    await asUser(db, ref1);
    const id = randomUUID();
    await insertEvent(id, p1, "foul", teams[0]);
    await asUser(db, ref2);
    const err = await errorOf(insertEvent(id, p2, "goal", teams[2], players[teams[2]][0]));
    expect(err?.code).toBe("23505");
  });
});

describe("score recalculation skips writes that change nothing", () => {
  it("a foul or card does not rewrite the fixture row", async () => {
    await asUser(db, ref1);
    const before = await fixture(p1);
    await insertEvent(randomUUID(), p1, "foul", teams[0]);
    await insertEvent(randomUUID(), p1, "yellow_card", teams[1], players[teams[1]][2]);
    const after = await fixture(p1);
    expect(after.updated_at).toBe(before.updated_at);
    expect(after.home_score).toBe(before.home_score);
  });

  it("a goal still updates the score, and removing it reverses it", async () => {
    await asUser(db, ref1);
    const before = await fixture(p1);
    const id = randomUUID();
    await insertEvent(id, p1, "penalty_goal", teams[1], players[teams[1]][0]);
    expect((await fixture(p1)).away_score).toBe(before.away_score + 1);
    await db.query("select public.delete_match_event($1, $2)", [id, "Recorded twice by mistake"]);
    expect((await fixture(p1)).away_score).toBe(before.away_score);
  });
});

describe("telemetry table security", () => {
  const add = (tournament: string | null, user: string | null = null) =>
    db.query(
      `insert into public.perf_events (tournament_id, kind, duration_ms, ok, path, meta${user ? ", user_id" : ""}) values ($1, 'event_save', 120, true, '/tournaments/:id/matches/:id', '{"attempt":1}'${user ? ", $2" : ""})`,
      user ? [tournament, user] : [tournament],
    );

  it("members can record timings for their tournament", async () => {
    await asUser(db, ref1);
    await add(tid);
    await asUser(db, viewer);
    await add(tid);
    await add(null);
  });

  it("nobody can record for a tournament they do not belong to, or as someone else", async () => {
    await asUser(db, outsider);
    expect((await errorOf(add(tid)))?.message).toMatch(/row-level security/);
    await asUser(db, ref1);
    expect((await errorOf(add(otherTid)))?.message).toMatch(/row-level security/);
    expect((await errorOf(add(tid, admin)))?.message).toMatch(/row-level security/);
    await asAnon(db);
    expect(await errorOf(add(tid))).not.toBeNull();
  });

  it("only admins can read the measurements", async () => {
    await asUser(db, ref1);
    expect((await db.query("select * from public.perf_events")).rows).toHaveLength(0);
    await asUser(db, viewer);
    expect((await db.query("select * from public.perf_events")).rows).toHaveLength(0);
    await asUser(db, admin);
    expect((await db.query("select * from public.perf_events where tournament_id = $1", [tid])).rows).toHaveLength(2);
  });

  it("telemetry cannot be changed or deleted from the app", async () => {
    await asUser(db, admin);
    expect(await errorOf(db.query("update public.perf_events set ok = false"))).not.toBeNull();
    expect(await errorOf(db.query("delete from public.perf_events"))).not.toBeNull();
    await asService(db);
    expect(Number((await one<{ n: string }>("select count(*) n from public.perf_events")).n)).toBe(3);
  });

  it("oversized metadata is refused", async () => {
    await asUser(db, ref1);
    const big = JSON.stringify({ x: "y".repeat(5000) });
    const err = await errorOf(db.query("insert into public.perf_events (tournament_id, kind, meta) values ($1, 'js_error', $2::jsonb)", [tid, big]));
    expect(err?.message).toMatch(/check constraint/);
  });
});
