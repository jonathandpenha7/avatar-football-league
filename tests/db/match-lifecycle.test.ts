import { beforeAll, describe, expect, it } from "vitest";
import { asService, asUser, createTestDb, createUser, type TestDb } from "./harness";

/**
 * Match lifecycle on the real migrations: server-timed halves (7 + 2 + 7),
 * automatic transitions, pause/resume of every clock, duplicate protection,
 * permissions, goal handling, corrections, participation and awards.
 * Time is controlled with app.test_now so minutes can pass instantly.
 */
let db: TestDb;
let admin: string;
let referee: string;
let scorekeeper: string;
let viewer: string;
let tid: string;
let teams: string[] = [];
let fx: Record<string, string> = {};
const playersByTeam: Record<string, string[]> = {};

const T0 = Date.parse("2026-11-15T11:30:00Z"); // 5:00 PM IST
const at = async (sec: number) => {
  await db.query("select set_config('app.test_now', $1, false)", [new Date(T0 + sec * 1000).toISOString()]);
};
type Row = Record<string, unknown>;
const one = async <T = Row>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];
const control = async (code: string, cmd: string, opts: { version?: number | null; minutes?: number; reason?: string } = {}) =>
  one<Row>("select * from public.match_control($1, $2, $3, $4, $5)", [fx[code], cmd, opts.version ?? null, opts.minutes ?? null, opts.reason ?? null]);
const fixture = (code: string) => one<Row>("select * from public.fixtures where id = $1", [fx[code]]);
const goal = (code: string, type: string, team: string, player: string | null = null) =>
  db.query("insert into public.match_events (tournament_id, fixture_id, event_type, team_id, player_id) values ($1, $2, $3, $4, $5)", [tid, fx[code], type, team, player]);

beforeAll(async () => {
  db = await createTestDb();
  admin = await createUser(db, "admin@avatar.test");
  referee = await createUser(db, "ref@avatar.test");
  scorekeeper = await createUser(db, "score@avatar.test");
  viewer = await createUser(db, "viewer@avatar.test");
  await asUser(db, admin);
  tid = (await one<{ id: string }>("select public.create_tournament($1::jsonb) id", [JSON.stringify({
    tournament: { name: "Lifecycle Cup", format: "league_playoff" },
    settings: { team_count: 4, max_squad_size: 6, players_on_pitch: 5, qualifiers: 4, periods: 2, match_duration_min: 14, half_time_min: 2, knockout_match_duration_min: 20, transition_min: 5, extra_time_enabled: true, extra_time_min: 5, max_substitutions: 2 },
    teams: [{ name: "Lions" }, { name: "Eagles" }, { name: "Bears" }, { name: "Wolves" }],
  })])).id;
  teams = (await db.query<{ id: string }>("select id from public.teams where tournament_id = $1 order by seed", [tid])).rows.map((r) => r.id);
  for (const t of teams) {
    playersByTeam[t] = [];
    for (let i = 1; i <= 3; i++) {
      const p = await one<{ id: string }>("insert into public.players (tournament_id, team_id, full_name) values ($1, $2, $3) returning id", [tid, t, `P${i} ${t.slice(0, 4)}`]);
      playersByTeam[t].push(p.id);
    }
  }
  for (const [user, role] of [[referee, "referee"], [scorekeeper, "scorekeeper"], [viewer, "viewer"]]) {
    await db.query("insert into public.tournament_members (tournament_id, user_id, role) values ($1, $2, $3)", [tid, user, role]);
  }
  const plan = [
    { code: "L1", stage: "league", home_team_id: teams[0], away_team_id: teams[1] },
    { code: "L2", stage: "league", home_team_id: teams[2], away_team_id: teams[3] },
    { code: "SF1", stage: "knockout", home_team_id: teams[0], away_team_id: teams[3], home_source: "league:1", away_source: "league:4" },
    { code: "SF2", stage: "knockout", home_team_id: teams[1], away_team_id: teams[2], home_source: "league:2", away_source: "league:3" },
    { code: "F", stage: "knockout", home_source: "winner:SF1", away_source: "winner:SF2" },
  ];
  await db.query("select public.replace_fixtures($1, 'all', $2::jsonb)", [tid, JSON.stringify(plan)]);
  fx = Object.fromEntries((await db.query<{ id: string; code: string }>("select id, code from public.fixtures where tournament_id = $1", [tid])).rows.map((r) => [r.code, r.id]));
  for (const code of ["L1", "SF1", "SF2", "F"]) {
    await db.query("insert into public.match_officials (tournament_id, fixture_id, user_id, role) values ($1, $2, $3, 'referee'), ($1, $2, $4, 'scorekeeper')", [tid, fx[code], referee, scorekeeper]);
  }
  await db.query("insert into public.match_officials (tournament_id, fixture_id, user_id, role) values ($1, $2, $3, 'referee')", [tid, fx.L2, referee]);
});

describe("match timer: first half, half-time, second half, full time", () => {
  it("1. starts the first half with a 7-minute countdown", async () => {
    await asUser(db, referee);
    await at(0);
    const f = await control("L1", "start");
    expect([f.status, f.period, f.phase_target_sec, f.timer_elapsed_sec]).toEqual(["in_progress", "first_half", 420, 0]);
  });

  it("2. counts down from the server clock (survives refresh: state is in the database)", async () => {
    await at(200);
    const f = await control("L1", "sync");
    expect(f.period).toBe("first_half");
    const e = await one<{ e: number }>("select private.running_elapsed(f) e from public.fixtures f where id = $1", [fx.L1]);
    expect(e.e).toBe(200);
  });

  it("8/10. pauses and resumes from the exact remaining time", async () => {
    const before = await fixture("L1");
    await control("L1", "pause", { version: before.state_version as number });
    await at(500); // 300 s pass while paused
    const paused = await fixture("L1");
    expect([paused.status, paused.timer_elapsed_sec]).toEqual(["paused", 200]);
    await control("L1", "resume");
    await at(600);
    const e = await one<{ e: number }>("select private.running_elapsed(f) e from public.fixtures f where id = $1", [fx.L1]);
    expect(e.e).toBe(300); // paused time did not count
  });

  it("records events with the server-calculated period and match time", async () => {
    await goal("L1", "goal", teams[0], playersByTeam[teams[0]][0]);
    const ev = await one<{ period: string; match_second: number }>("select period, match_second from public.match_events where fixture_id = $1 order by created_at desc limit 1", [fx.L1]);
    expect([ev.period, ev.match_second]).toEqual(["first_half", 300]);
  });

  it("3/4. moves to half-time at the exact expiry moment and starts the 2-minute break", async () => {
    // 120 s remain (300 of 420 played at t=600) -> expiry at t=720. Nobody checks until t=750.
    await at(750);
    const f = await control("L1", "sync");
    expect([f.status, f.period, f.first_half_elapsed_sec, f.phase_target_sec]).toEqual(["in_progress", "half_time", 420, 120]);
    expect(new Date(f.timer_started_at as string).getTime()).toBe(T0 + 720 * 1000);
    const e = await one<{ e: number }>("select private.running_elapsed(f) e from public.fixtures f where id = $1", [fx.L1]);
    expect(e.e).toBe(30); // 1:30 of half-time left
  });

  it("9. pauses and resumes the half-time clock", async () => {
    await control("L1", "pause");
    await at(900);
    await control("L1", "resume");
    await at(960);
    const e = await one<{ e: number }>("select private.running_elapsed(f) e from public.fixtures f where id = $1", [fx.L1]);
    expect(e.e).toBe(90);
  });

  it("5. half-time stops at zero and waits for the referee", async () => {
    await at(1200);
    const f = await control("L1", "sync");
    expect([f.status, f.period, f.timer_started_at, f.timer_elapsed_sec]).toEqual(["in_progress", "half_time", null, 120]);
  });

  it("6/7. starts the second half with its own 7-minute clock; events continue the match time", async () => {
    const f = await control("L1", "start_second_half");
    expect([f.period, f.phase_target_sec, f.timer_elapsed_sec]).toEqual(["second_half", 420, 0]);
    await at(1300);
    await goal("L1", "own_goal", teams[0], playersByTeam[teams[0]][1]); // credited to Eagles
    const ev = await one<{ period: string; match_second: number }>("select period, match_second from public.match_events where fixture_id = $1 order by created_at desc limit 1", [fx.L1]);
    expect([ev.period, ev.match_second]).toEqual(["second_half", 420 + 100]);
  });

  it("supports added time", async () => {
    const f = await control("L1", "add_time", { minutes: 1 });
    expect(f.added_time_sec).toBe(60);
  });

  it("14. moves to full time when the second half (plus added time) runs out", async () => {
    await at(1200 + 420 + 59);
    expect((await control("L1", "sync")).period).toBe("second_half");
    await at(1200 + 420 + 60);
    const f = await control("L1", "sync");
    expect([f.status, f.period, f.second_half_elapsed_sec]).toEqual(["completed", "full_time", 480]);
  });

  it("prevents duplicate and stale transitions", async () => {
    await expect(control("L1", "start_second_half")).rejects.toThrow(/half-time/);
    const f = await fixture("L1");
    await expect(control("L1", "submit", { version: (f.state_version as number) - 1 })).rejects.toThrow(/another device/);
    const s = await control("L1", "submit", { version: f.state_version as number });
    expect(s.submitted_by).toBe(referee);
  });

  it("12. runs independent timers for simultaneous matches", async () => {
    await at(100);
    await control("L2", "start");
    await at(160);
    const l2 = await one<{ e: number; period: string }>("select private.running_elapsed(f) e, period from public.fixtures f where id = $1", [fx.L2]);
    const l1 = await fixture("L1");
    expect([l2.period, l2.e]).toEqual(["first_half", 60]);
    expect(l1.period).toBe("full_time");
  });

  it("records who started, paused and transitioned each phase in the audit log", async () => {
    await asService(db);
    const logs = await db.query<{ action: string; actor_id: string }>("select action, actor_id from public.audit_logs where entity_id = $1 and action like 'match_%' order by id", [fx.L1]);
    expect(logs.rows.map((r) => r.action)).toEqual([
      "match_start", "match_pause", "match_resume", "match_auto_half_time", "match_pause", "match_resume",
      "match_auto_half_time", "match_start_second_half", "match_add_time", "match_auto_full_time", "match_submit",
    ]);
    expect(new Set(logs.rows.map((r) => r.actor_id))).toEqual(new Set([referee]));
  });
});

describe("goals and scores", () => {
  it("15-18. own goals are credited to the opposing team; normal goals to the scorer's team", async () => {
    const f = await fixture("L1");
    expect([f.home_score, f.away_score]).toEqual([1, 1]); // Lions goal + Lions own goal
  });

  it("19. penalty shootout goals stay separate from the score", async () => {
    await asUser(db, referee);
    await at(5000);
    await control("SF1", "start");
    await at(5000 + 600); // first half (10 min) done
    await control("SF1", "sync");
    await control("SF1", "start_second_half");
    await at(5000 + 600 + 120 + 600);
    expect((await control("SF1", "sync")).status).toBe("completed");
    await control("SF1", "penalties");
    await goal("SF1", "shootout_goal", teams[3]);
    await goal("SF1", "shootout_miss", teams[0]);
    const f = await fixture("SF1");
    expect([f.home_score, f.away_score, f.home_penalties, f.away_penalties]).toEqual([0, 0, 0, 1]);
    expect(f.phase_target_sec).not.toBeNull();
  });

  it("20/21. correcting a goal (with a reason) recalculates the score and keeps the original in the audit log", async () => {
    await asUser(db, scorekeeper);
    const ev = await one<{ id: string }>("select id from public.match_events where fixture_id = $1 and event_type = 'goal'", [fx.L1]);
    await expect(db.query("select public.correct_match_event($1, $2::jsonb, '')", [ev.id, JSON.stringify({ team_id: teams[1], player_id: null })])).rejects.toThrow(/reason/);
    await db.query("select public.correct_match_event($1, $2::jsonb, 'Scorer was from Eagles')", [ev.id, JSON.stringify({ team_id: teams[1], player_id: playersByTeam[teams[1]][0] })]);
    const f = await fixture("L1");
    expect([f.home_score, f.away_score]).toEqual([0, 2]);
    await asService(db);
    const log = await one<{ reason: string; before_data: { team_id: string } }>("select reason, before_data from public.audit_logs where entity_id = $1 and action = 'update'", [ev.id]);
    expect(log.reason).toBe("Scorer was from Eagles");
    expect(log.before_data.team_id).toBe(teams[0]);
  });

  it("removing an event needs a reason and is audited", async () => {
    await asUser(db, scorekeeper);
    const ev = await one<{ id: string }>("select id from public.match_events where fixture_id = $1 and event_type = 'own_goal'", [fx.L1]);
    await db.query("select public.delete_match_event($1, 'Recorded twice by mistake')", [ev.id]);
    expect((await fixture("L1")).away_score).toBe(1);
  });

  it("enforces the configured substitution limit", async () => {
    await asUser(db, referee);
    const [a, b, c] = playersByTeam[teams[2]];
    const sub = (on: string, off: string) => db.query("insert into public.match_events (tournament_id, fixture_id, event_type, team_id, player_id, related_player_id) values ($1, $2, 'substitution', $3, $4, $5)", [tid, fx.L2, teams[2], on, off]);
    await sub(a, b);
    await sub(b, a);
    await expect(sub(c, a)).rejects.toThrow(/all 2 substitutions/);
  });

  it("a corrected card rebuilds its discipline record", async () => {
    await asUser(db, referee);
    const [p1, p2] = playersByTeam[teams[2]];
    await db.query("insert into public.match_events (tournament_id, fixture_id, event_type, team_id, player_id) values ($1, $2, 'yellow_card', $3, $4)", [tid, fx.L2, teams[2], p1]);
    const ev = await one<{ id: string }>("select id from public.match_events where fixture_id = $1 and event_type = 'yellow_card'", [fx.L2]);
    await db.query("select public.correct_match_event($1, $2::jsonb, 'Wrong player booked')", [ev.id, JSON.stringify({ player_id: p2 })]);
    const rec = await db.query<{ player_id: string }>("select player_id from public.disciplinary_records where match_event_id = $1", [ev.id]);
    expect(rec.rows.map((r) => r.player_id)).toEqual([p2]);
  });
});

describe("permissions", () => {
  it("50/51. assigned referee and scorekeeper can run the clock; others cannot", async () => {
    await asUser(db, viewer);
    await expect(control("L2", "pause")).rejects.toThrow(/not assigned/);
    await asUser(db, scorekeeper);
    await expect(control("L2", "pause")).rejects.toThrow(/not assigned/); // scorekeeper is not assigned to L2
    await expect(control("L1", "abandon", { reason: "rain" })).rejects.toThrow(/referee or a tournament admin/);
  });

  it("52. officials cannot edit the clock or results directly", async () => {
    await asUser(db, referee);
    await expect(db.query("update public.fixtures set timer_elapsed_sec = 999 where id = $1", [fx.L2])).rejects.toThrow(/match controls/);
    await expect(db.query("update public.fixtures set status = 'completed' where id = $1", [fx.L2])).rejects.toThrow(/match controls/);
    await expect(db.query("select public.confirm_match_result($1, null)", [fx.L1])).rejects.toThrow(/not authorised/);
  });

  it("abandoned matches cannot take events or be confirmed until reinstated", async () => {
    await asUser(db, referee);
    await control("L2", "abandon", { reason: "Floodlights failed" });
    await expect(goal("L2", "goal", teams[2])).rejects.toThrow(/abandoned/);
    await asUser(db, admin);
    await expect(db.query("select public.confirm_match_result($1, null)", [fx.L2])).rejects.toThrow(/abandoned/);
    const f = await control("L2", "reinstate");
    expect(f.status).toBe("paused");
  });
});

describe("participation, awards and finalisation", () => {
  it("confirming records the squad as having played when no lineup was entered", async () => {
    await asUser(db, admin);
    await db.query("select public.confirm_match_result($1, null)", [fx.L1]);
    const n = await one<{ n: number }>("select count(*)::int n from public.match_participants where fixture_id = $1 and source = 'default'", [fx.L1]);
    expect(n.n).toBe(6);
  });

  it("46/47. MVP is chosen by an organiser with a reason; officials can nominate when enabled", async () => {
    await asUser(db, referee);
    await expect(db.query("insert into public.mvp_nominations (tournament_id, player_id) values ($1, $2)", [tid, playersByTeam[teams[0]][0]])).rejects.toThrow(/row-level security/);
    await asUser(db, admin);
    await db.query("update public.tournament_settings set mvp_nominations_enabled = true where tournament_id = $1", [tid]);
    await asUser(db, referee);
    await db.query("insert into public.mvp_nominations (tournament_id, player_id, reason) values ($1, $2, 'Captained brilliantly')", [tid, playersByTeam[teams[0]][0]]);
    await asUser(db, admin);
    await expect(db.query("insert into public.tournament_awards (tournament_id, mvp_player_id) values ($1, $2)", [tid, playersByTeam[teams[0]][0]])).rejects.toThrow(/check constraint/);
    await db.query("insert into public.tournament_awards (tournament_id, mvp_player_id, mvp_reason) values ($1, $2, 'Outstanding throughout')", [tid, playersByTeam[teams[0]][0]]);
  });

  it("48. awards must be confirmed, and every match finished, before finalising; then they are locked", async () => {
    await asUser(db, admin);
    await expect(db.query("select public.set_tournament_finalised($1, true)", [tid])).rejects.toThrow(/confirm the awards/);
    await db.query("update public.tournament_awards set confirmed_at = now(), confirmed_by = $2 where tournament_id = $1", [tid, admin]);
    await expect(db.query("select public.set_tournament_finalised($1, true)", [tid])).rejects.toThrow(/not finished/);
    await asService(db);
    await db.query("update public.fixtures set status = 'cancelled' where tournament_id = $1 and status <> 'confirmed'", [tid]).catch(() => undefined);
    await db.exec("select set_config('app.internal', 'on', false)");
    await db.query("update public.fixtures set status = 'cancelled' where tournament_id = $1 and status <> 'confirmed'", [tid]);
    await db.exec("select set_config('app.internal', '', false)");
    await asUser(db, admin);
    await db.query("select public.set_tournament_finalised($1, true)", [tid]);
    await expect(db.query("update public.tournament_awards set mvp_reason = 'x' where tournament_id = $1", [tid])).rejects.toThrow(/finalised/);
    expect((await one<{ status: string }>("select status from public.tournaments where id = $1", [tid])).status).toBe("completed");
    await expect(db.query("select public.set_tournament_finalised($1, false, '')", [tid])).rejects.toThrow(/reason/);
    await db.query("select public.set_tournament_finalised($1, false, 'Wrong MVP recorded')", [tid]);
    await db.query("update public.tournament_awards set mvp_reason = 'Best player of the day' where tournament_id = $1", [tid]);
  });
});
