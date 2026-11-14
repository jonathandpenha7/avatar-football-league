import { expect, it } from "vitest";
import { applyMigrationsFrom, asService, asUser, createTestDb, createUser } from "./harness";

it("55. new migrations preserve existing tournament data and keep a running match working", async () => {
  const NEW = "20261114000001";
  const db = await createTestDb({ before: NEW });
  const admin = await createUser(db, "admin@old.test");
  await asUser(db, admin);
  const tid = (await db.query<{ id: string }>("select public.create_tournament($1::jsonb) id", [JSON.stringify({
    tournament: { name: "Existing Cup", format: "league_playoff" },
    settings: { team_count: 2, periods: 2, match_duration_min: 14, half_time_min: 2, qualifiers: 2 },
    teams: [{ name: "Lions" }, { name: "Eagles" }],
  })])).rows[0].id;
  const teams = (await db.query<{ id: string }>("select id from public.teams where tournament_id = $1 order by seed", [tid])).rows.map((r) => r.id);
  await db.query("select public.replace_fixtures($1, 'all', $2::jsonb)", [tid, JSON.stringify([
    { code: "L1", stage: "league", home_team_id: teams[0], away_team_id: teams[1] },
    { code: "L2", stage: "league", home_team_id: teams[1], away_team_id: teams[0] },
  ])]);
  const fx = Object.fromEntries((await db.query<{ id: string; code: string }>("select id, code from public.fixtures")).rows.map((r) => [r.code, r.id]));
  // Old-style live match (as on the real database: started, clock running, no phase target stored).
  await db.query("update public.fixtures set status = 'in_progress', period = 'first_half', timer_started_at = now() - interval '60 seconds' where id = $1", [fx.L1]);
  await db.query("insert into public.match_events (tournament_id, fixture_id, event_type, team_id) values ($1, $2, 'goal', $3), ($1, $2, 'own_goal', $3)", [tid, fx.L1, teams[0]]);
  await db.query("update public.fixtures set status = 'completed' where id = $1", [fx.L2]);
  await db.query("select public.confirm_match_result($1, null)", [fx.L2]);
  await asService(db);
  const before = await db.query("select id, status, period, home_score, away_score, winner_team_id from public.fixtures order by code");
  const eventsBefore = (await db.query<{ n: number }>("select count(*)::int n from public.match_events")).rows[0].n;

  await applyMigrationsFrom(db, NEW);

  const after = await db.query("select id, status, period, home_score, away_score, winner_team_id from public.fixtures order by code");
  expect(after.rows).toEqual(before.rows);
  expect((await db.query<{ n: number }>("select count(*)::int n from public.match_events")).rows[0].n).toBe(eventsBefore);
  expect((await db.query<{ added_time_sec: number; state_version: number }>("select added_time_sec, state_version from public.fixtures where id = $1", [fx.L1])).rows[0]).toEqual({ added_time_sec: 0, state_version: 0 });

  // The old running match continues with the new clock (target falls back to settings: 7 minutes).
  await asUser(db, admin);
  const paused = (await db.query<{ status: string; timer_elapsed_sec: number }>("select * from public.match_control($1, 'pause')", [fx.L1])).rows[0];
  expect(paused.status).toBe("paused");
  expect(paused.timer_elapsed_sec).toBeGreaterThanOrEqual(60);
  expect(paused.timer_elapsed_sec).toBeLessThan(70);
});
