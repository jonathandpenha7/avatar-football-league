import { beforeAll, describe, expect, it } from "vitest";
import { asAnon, asService, asUser, createTestDb, createUser, type TestDb } from "./harness";

/**
 * These tests run the real Supabase migrations in PGlite (Postgres in WASM)
 * and exercise RLS policies, triggers and RPC functions as different users.
 */
let db: TestDb;
let superAdmin: string;
let admin: string;
let referee: string;
let scorekeeper: string;
let viewer: string;
let outsider: string;
let tournamentId: string;
const teamIds: string[] = [];

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const res = await db.query<T>(sql, params);
  return res.rows[0];
}

async function expectError(promise: Promise<unknown>, pattern: RegExp) {
  await expect(promise).rejects.toThrow(pattern);
}

beforeAll(async () => {
  db = await createTestDb();
  superAdmin = await createUser(db, "owner@church.test", "Owner");
  admin = await createUser(db, "admin@church.test", "Admin");
  referee = await createUser(db, "ref@church.test", "Ref");
  scorekeeper = await createUser(db, "score@church.test", "Score");
  viewer = await createUser(db, "viewer@church.test", "Viewer");
  outsider = await createUser(db, "outsider@church.test", "Outsider");

  await asUser(db, superAdmin);
  const created = await one<{ id: string }>("select public.create_tournament($1::jsonb) as id", [
    JSON.stringify({
      tournament: { name: "Test League", format: "league_playoff", start_date: "2026-12-12", daily_start_time: "17:00", daily_end_time: "21:00" },
      settings: { team_count: 4, max_squad_size: 3, players_on_pitch: 2, qualifiers: 2, match_duration_min: 12, transition_min: 3, forfeit_goals: 3 },
      pitches: [{ name: "Pitch 1" }, { name: "Pitch 2" }],
      teams: [{ name: "Lions" }, { name: "Eagles" }, { name: "Bears" }, { name: "Wolves" }],
      decisions: [{ key: "match_duration", question: "Confirm match duration", options: ["10", "12"] }],
    }),
  ]);
  tournamentId = created.id;
  const teams = await db.query<{ id: string }>("select id from public.teams where tournament_id = $1 order by seed", [tournamentId]);
  teamIds.push(...teams.rows.map((t) => t.id));
  for (const [user, role] of [[admin, "tournament_admin"], [referee, "referee"], [scorekeeper, "scorekeeper"], [viewer, "viewer"]]) {
    await db.query("insert into public.tournament_members (tournament_id, user_id, role) values ($1, $2, $3)", [tournamentId, user, role]);
  }
});

describe("accounts and tournament creation", () => {
  it("makes only the first user a Super Admin", async () => {
    await asService(db);
    const rows = await db.query<{ email: string; is_super_admin: boolean }>("select email, is_super_admin from public.profiles order by created_at, email");
    expect(rows.rows.filter((r) => r.is_super_admin).map((r) => r.email)).toEqual(["owner@church.test"]);
  });

  it("creates settings, pitches, teams and admin membership atomically", async () => {
    await asUser(db, superAdmin);
    const s = await one<{ max_squad_size: number; tiebreakers_confirmed: boolean; red_card_suspension_matches: number | null }>(
      "select * from public.tournament_settings where tournament_id = $1", [tournamentId]);
    expect(s.max_squad_size).toBe(3);
    expect(s.tiebreakers_confirmed).toBe(false);
    expect(s.red_card_suspension_matches).toBeNull(); // never invented
    expect((await one<{ c: number }>("select count(*)::int c from public.pitches where tournament_id = $1", [tournamentId])).c).toBe(2);
  });

  it("refuses tournament creation for ordinary users", async () => {
    await asUser(db, outsider);
    await expectError(db.query("select public.create_tournament($1::jsonb)", [JSON.stringify({ tournament: { name: "Nope" } })]), /permission/);
  });

  it("prevents users from granting themselves Super Admin", async () => {
    await asUser(db, admin);
    await expectError(db.query("update public.profiles set is_super_admin = true where id = $1", [admin]), /Super Admin/);
  });
});

describe("row level security", () => {
  it("hides tournaments from non-members", async () => {
    await asUser(db, outsider);
    expect((await db.query("select * from public.tournaments where id = $1", [tournamentId])).rows).toHaveLength(0);
    expect((await db.query("select * from public.teams where tournament_id = $1", [tournamentId])).rows).toHaveLength(0);
  });

  it("lets viewers read but not write", async () => {
    await asUser(db, viewer);
    expect((await db.query("select * from public.teams where tournament_id = $1", [tournamentId])).rows).toHaveLength(4);
    await expectError(db.query("insert into public.teams (tournament_id, name) values ($1, 'Hackers')", [tournamentId]), /row-level security/);
    const upd = await db.query("update public.teams set name = 'Renamed' where tournament_id = $1", [tournamentId]);
    expect(upd.affectedRows).toBe(0);
  });

  it("lets tournament admins manage teams", async () => {
    await asUser(db, admin);
    await db.query("update public.teams set colour = '#22c55e' where id = $1", [teamIds[0]]);
    expect((await one<{ colour: string }>("select colour from public.teams where id = $1", [teamIds[0]])).colour).toBe("#22c55e");
  });

  it("prevents duplicate team names in a tournament", async () => {
    await asUser(db, admin);
    await expectError(db.query("insert into public.teams (tournament_id, name) values ($1, ' lions ')", [tournamentId]), /duplicate key/);
  });

  it("keeps player contact details admin-only", async () => {
    await asUser(db, admin);
    const p = await one<{ id: string }>("insert into public.players (tournament_id, team_id, full_name) values ($1, $2, 'Contact Person') returning id", [tournamentId, teamIds[0]]);
    await db.query("insert into public.player_contacts (player_id, tournament_id, email) values ($1, $2, 'p@x.test')", [p.id, tournamentId]);
    await asUser(db, viewer);
    expect((await db.query("select * from public.players where id = $1", [p.id])).rows).toHaveLength(1);
    expect((await db.query("select * from public.player_contacts where player_id = $1", [p.id])).rows).toHaveLength(0);
    await asUser(db, admin);
    await db.query("delete from public.players where id = $1", [p.id]);
  });

  it("enforces the maximum squad size", async () => {
    await asUser(db, admin);
    for (const name of ["A One", "A Two", "A Three"]) {
      await db.query("insert into public.players (tournament_id, team_id, full_name) values ($1, $2, $3)", [tournamentId, teamIds[1], name]);
    }
    await expectError(
      db.query("insert into public.players (tournament_id, team_id, full_name) values ($1, $2, 'A Four')", [tournamentId, teamIds[1]]),
      /Squad is full/,
    );
  });

  it("allows only one captain per team", async () => {
    await asUser(db, admin);
    const players = await db.query<{ id: string }>("select id from public.players where team_id = $1 order by full_name", [teamIds[1]]);
    await db.query("update public.players set is_captain = true where id = $1", [players.rows[0].id]);
    await expectError(db.query("update public.players set is_captain = true where id = $1", [players.rows[1].id]), /duplicate key/);
  });

  it("does not let anyone write audit logs directly", async () => {
    await asUser(db, superAdmin);
    await expectError(db.query("insert into public.audit_logs (action, entity_type) values ('x', 'y')"), /permission denied/);
  });
});

describe("matches, scoring and results", () => {
  let l1: string;
  let sf1: string;
  let sfFinal: string;
  const [lions, eagles, bears, wolves] = [0, 1, 2, 3];

  beforeAll(async () => {
    await asUser(db, admin);
    const plan = [
      { code: "L1", stage: "league", round_number: 1, home_team_id: teamIds[lions], away_team_id: teamIds[eagles], scheduled_date: "2026-12-12", scheduled_time: "17:10" },
      { code: "L2", stage: "league", round_number: 1, home_team_id: teamIds[bears], away_team_id: teamIds[wolves], scheduled_date: "2026-12-12", scheduled_time: "17:10" },
      { code: "SF1", stage: "knockout", round_number: 1, round_name: "Semi-final", home_source: "league:1", away_source: "league:2", scheduled_date: "2026-12-12", scheduled_time: "18:00" },
      { code: "F", stage: "knockout", round_number: 2, round_name: "Final", home_source: "winner:SF1", away_source: "winner:L2", scheduled_date: "2026-12-12", scheduled_time: "18:30" },
    ];
    expect((await one<{ n: number }>("select public.replace_fixtures($1, 'all', $2::jsonb) as n", [tournamentId, JSON.stringify(plan)])).n).toBe(4);
    const rows = await db.query<{ id: string; code: string }>("select id, code from public.fixtures where tournament_id = $1", [tournamentId]);
    const by = Object.fromEntries(rows.rows.map((r) => [r.code, r.id]));
    l1 = by.L1;
    sf1 = by.SF1;
    sfFinal = by.F;
    await db.query("insert into public.match_officials (tournament_id, fixture_id, user_id, role) values ($1, $2, $3, 'scorekeeper'), ($1, $2, $4, 'referee')", [tournamentId, l1, scorekeeper, referee]);
  });

  it("only lets assigned officials record events", async () => {
    await asUser(db, viewer);
    await expectError(db.query("insert into public.match_events (tournament_id, fixture_id, event_type, team_id) values ($1, $2, 'goal', $3)", [tournamentId, l1, teamIds[lions]]), /row-level security/);
    const l2 = await one<{ id: string }>("select id from public.fixtures where code = 'L2' and tournament_id = $1", [tournamentId]);
    await asUser(db, scorekeeper);
    await expectError(db.query("insert into public.match_events (tournament_id, fixture_id, event_type, team_id) values ($1, $2, 'goal', $3)", [tournamentId, l2.id, teamIds[bears]]), /row-level security/);
  });

  it("lets officials run the clock but not change teams or schedule", async () => {
    await asUser(db, scorekeeper);
    await db.query("update public.fixtures set status = 'in_progress', period = 'first_half', timer_started_at = now() where id = $1", [l1]);
    await expectError(db.query("update public.fixtures set scheduled_time = '20:00' where id = $1", [l1]), /only update match status/);
  });

  it("derives the score from goal events, including own goals", async () => {
    await asUser(db, scorekeeper);
    const ins = "insert into public.match_events (tournament_id, fixture_id, event_type, team_id) values ($1, $2, $3, $4)";
    await db.query(ins, [tournamentId, l1, "goal", teamIds[lions]]);
    await db.query(ins, [tournamentId, l1, "goal", teamIds[lions]]);
    await db.query(ins, [tournamentId, l1, "own_goal", teamIds[lions]]); // counts for Eagles
    const f = await one<{ home_score: number; away_score: number }>("select home_score, away_score from public.fixtures where id = $1", [l1]);
    expect([f.home_score, f.away_score]).toEqual([2, 1]);
    await expectError(db.query("update public.fixtures set home_score = 9 where id = $1", [l1]), /calculated from recorded match events/);
  });

  it("rejects events for teams not in the match", async () => {
    await asUser(db, scorekeeper);
    await expectError(db.query("insert into public.match_events (tournament_id, fixture_id, event_type, team_id) values ($1, $2, 'goal', $3)", [tournamentId, l1, teamIds[bears]]), /not playing in this match/);
  });

  it("does not let scorekeepers confirm results", async () => {
    await asUser(db, scorekeeper);
    await db.query("update public.fixtures set status = 'completed' where id = $1", [l1]);
    await expectError(db.query("select public.confirm_match_result($1, null)", [l1]), /not authorised/);
    await expectError(db.query("update public.fixtures set status = 'confirmed' where id = $1", [l1]), /confirm action/);
  });

  it("lets referees confirm only when the tournament allows it", async () => {
    await asUser(db, referee);
    await expectError(db.query("select public.confirm_match_result($1, null)", [l1]), /not authorised/);
  });

  it("confirms results, then locks events", async () => {
    await asUser(db, admin);
    const f = await one<{ status: string; winner_team_id: string }>("select * from public.confirm_match_result($1, 'Signed off')", [l1]);
    expect(f.status).toBe("confirmed");
    expect(f.winner_team_id).toBe(teamIds[lions]);
    await asUser(db, scorekeeper);
    await expectError(db.query("insert into public.match_events (tournament_id, fixture_id, event_type, team_id) values ($1, $2, 'goal', $3)", [tournamentId, l1, teamIds[eagles]]), /confirmed/);
  });

  it("requires a reason to correct a confirmed score and audits it", async () => {
    await asUser(db, admin);
    await expectError(db.query("select public.reopen_match_result($1, '')", [l1]), /reason/);
    await db.query("select public.reopen_match_result($1, 'Goal credited to wrong team')", [l1]);
    const goal = await one<{ id: string }>("select id from public.match_events where fixture_id = $1 and event_type = 'goal' limit 1", [l1]);
    await db.query("delete from public.match_events where id = $1", [goal.id]);
    await db.query("select public.confirm_match_result($1, null)", [l1]);
    const f = await one<{ home_score: number; away_score: number; correction_count: number }>("select * from public.fixtures where id = $1", [l1]);
    expect([f.home_score, f.away_score, f.correction_count]).toEqual([1, 1, 1]);
    const logs = await db.query<{ action: string; reason: string | null }>(
      "select action, reason from public.audit_logs where entity_id = $1 and action like 'result_%' order by id", [l1]);
    expect(logs.rows.map((r) => r.action)).toEqual(["result_confirmed", "result_reopened", "result_reconfirmed"]);
    expect(logs.rows[1].reason).toBe("Goal credited to wrong team");
  });

  it("seeds the knockout and requires a shootout winner for drawn knockout matches", async () => {
    await asUser(db, admin);
    await db.query("select public.assign_knockout_teams($1, $2::jsonb, false)", [
      tournamentId, JSON.stringify([{ source: "league:1", team_id: teamIds[lions] }, { source: "league:2", team_id: teamIds[eagles] }]),
    ]);
    await db.query("update public.fixtures set status = 'completed' where id = $1", [sf1]);
    await expectError(db.query("select public.confirm_match_result($1, null)", [sf1]), /penalty shootout/);
    const ins = "insert into public.match_events (tournament_id, fixture_id, event_type, team_id) values ($1, $2, $3, $4)";
    await db.query(ins, [tournamentId, sf1, "shootout_goal", teamIds[eagles]]);
    await db.query(ins, [tournamentId, sf1, "shootout_miss", teamIds[lions]]);
    const f = await one<{ winner_team_id: string; decided_by: string }>("select * from public.confirm_match_result($1, null)", [sf1]);
    expect(f.winner_team_id).toBe(teamIds[eagles]);
    expect(f.decided_by).toBe("penalties");
    const final = await one<{ home_team_id: string }>("select home_team_id from public.fixtures where id = $1", [sfFinal]);
    expect(final.home_team_id).toBe(teamIds[eagles]); // winner advanced automatically
  });

  it("refuses to regenerate fixtures once matches have been played", async () => {
    await asUser(db, admin);
    await expectError(db.query("select public.replace_fixtures($1, 'all', '[]'::jsonb)", [tournamentId]), /already started or been played/);
  });

  it("reverses knockout advancement when a result is reopened", async () => {
    await asUser(db, admin);
    await db.query("select public.reopen_match_result($1, 'Shootout recorded wrongly')", [sf1]);
    const final = await one<{ home_team_id: string | null }>("select home_team_id from public.fixtures where id = $1", [sfFinal]);
    expect(final.home_team_id).toBeNull();
    await db.query("select public.confirm_match_result($1, null)", [sf1]);
  });
});

describe("discipline", () => {
  it("records cards in the discipline register without inventing suspensions", async () => {
    await asUser(db, admin);
    const l2 = await one<{ id: string }>("select id from public.fixtures where code = 'L2' and tournament_id = $1", [tournamentId]);
    const player = await one<{ id: string }>("insert into public.players (tournament_id, team_id, full_name) values ($1, $2, 'Hot Head') returning id", [tournamentId, teamIds[2]]);
    await db.query("update public.fixtures set status = 'in_progress' where id = $1", [l2.id]);
    await db.query("insert into public.match_events (tournament_id, fixture_id, event_type, team_id, player_id) values ($1, $2, 'red_card', $3, $4)", [tournamentId, l2.id, teamIds[2], player.id]);
    expect((await db.query("select * from public.disciplinary_records where player_id = $1", [player.id])).rows).toHaveLength(1);
    expect((await db.query("select * from public.suspensions where player_id = $1", [player.id])).rows).toHaveLength(0);

    await db.query("update public.tournament_settings set red_card_suspension_matches = 1 where tournament_id = $1", [tournamentId]);
    await db.query("insert into public.match_events (tournament_id, fixture_id, event_type, team_id, player_id) values ($1, $2, 'yellow_card', $3, $4)", [tournamentId, l2.id, teamIds[2], player.id]);
    await db.query("insert into public.match_events (tournament_id, fixture_id, event_type, team_id, player_id) values ($1, $2, 'yellow_card', $3, $4)", [tournamentId, l2.id, teamIds[2], player.id]);
    const recs = await db.query<{ incident_type: string }>("select incident_type from public.disciplinary_records where player_id = $1 order by created_at, incident_type", [player.id]);
    expect(recs.rows.map((r) => r.incident_type).sort()).toEqual(["red_card", "second_yellow", "yellow_card"]);
    const susp = await db.query<{ matches: number; reason: string }>("select matches, reason from public.suspensions where player_id = $1", [player.id]);
    expect(susp.rows).toHaveLength(1);
    expect(susp.rows[0].reason).toMatch(/second yellow/);
  });

  it("removes the discipline record when the card event is deleted", async () => {
    await asUser(db, admin);
    const ev = await one<{ id: string }>("select id from public.match_events where event_type = 'red_card' limit 1");
    await db.query("delete from public.match_events where id = $1", [ev.id]);
    expect((await db.query("select * from public.disciplinary_records where match_event_id = $1", [ev.id])).rows).toHaveLength(0);
  });
});

describe("public access, registration and invitations", () => {
  it("returns nothing for a private tournament", async () => {
    await asAnon(db);
    const slug = (await (async () => { await asService(db); return one<{ slug: string }>("select slug from public.tournaments where id = $1", [tournamentId]); })()).slug;
    await asAnon(db);
    expect((await one<{ data: unknown }>("select public.get_public_tournament($1) as data", [slug])).data).toBeNull();
  });

  it("exposes a public page without contact data once enabled", async () => {
    await asUser(db, admin);
    await db.query("update public.tournaments set public_enabled = true, fixtures_published = true where id = $1", [tournamentId]);
    const slug = (await one<{ slug: string }>("select slug from public.tournaments where id = $1", [tournamentId])).slug;
    await asAnon(db);
    const data = (await one<{ data: Record<string, unknown> }>("select public.get_public_tournament($1) as data", [slug])).data;
    expect(data).not.toBeNull();
    const text = JSON.stringify(data);
    expect(text).not.toContain("p@x.test");
    expect(text).not.toContain("referee_notes");
    expect((data.fixtures as unknown[]).length).toBe(4);
    await expectError(db.query("select * from public.players"), /permission denied/);
    expect((await db.query("select * from public.fixtures where tournament_id = $1", [tournamentId])).rows).toHaveLength(4);
  });

  it("accepts registrations by token and never marks them paid", async () => {
    await asUser(db, admin);
    await db.query("update public.tournaments set registration_open = true where id = $1", [tournamentId]);
    await db.query("update public.tournament_settings set registration_requires_payment = true where tournament_id = $1", [tournamentId]);
    const token = (await one<{ registration_token: string }>("select registration_token from public.tournaments where id = $1", [tournamentId])).registration_token;
    await asAnon(db);
    const regId = (await one<{ id: string }>("select public.submit_registration($1, $2::jsonb) as id", [
      token, JSON.stringify({ full_name: "New Player", email: "new@x.test", payment_option_selected: "Paid by UPI", position: "Striker" }),
    ])).id;
    await expectError(db.query("select public.submit_registration($1, $2::jsonb)", [token, JSON.stringify({ full_name: "Dup", email: "NEW@x.test" })]), /already exists/);
    await asUser(db, admin);
    const reg = await one<{ payment_status: string; status: string }>("select * from public.registrations where id = $1", [regId]);
    expect(reg.payment_status).toBe("unpaid");
    expect(reg.status).toBe("pending");
    const playerId = (await one<{ id: string }>("select public.approve_registration($1, $2, null) as id", [regId, teamIds[3]])).id;
    const player = await one<{ payment_status: string; position: string }>("select * from public.players where id = $1", [playerId]);
    expect(player.payment_status).toBe("unpaid");
    expect(player.position).toBe("Striker");
  });

  it("rejects registrations when closed", async () => {
    await asUser(db, admin);
    await db.query("update public.tournaments set registration_open = false where id = $1", [tournamentId]);
    const token = (await one<{ registration_token: string }>("select registration_token from public.tournaments where id = $1", [tournamentId])).registration_token;
    await asAnon(db);
    await expectError(db.query("select public.submit_registration($1, $2::jsonb)", [token, JSON.stringify({ full_name: "Late", email: "late@x.test" })]), /closed/);
  });

  it("only lets the invited email accept an invitation", async () => {
    await asUser(db, admin);
    const token = (await one<{ token: string }>(
      "insert into public.tournament_invitations (tournament_id, email, role, invited_by) values ($1, 'Outsider@church.test', 'scorekeeper', $2) returning token", [tournamentId, admin])).token;
    await asUser(db, viewer);
    await expectError(db.query("select public.accept_invitation($1)", [token]), /sent to/);
    await asUser(db, outsider);
    expect((await one<{ id: string }>("select public.accept_invitation($1) as id", [token])).id).toBe(tournamentId);
    expect((await db.query("select * from public.teams where tournament_id = $1", [tournamentId])).rows.length).toBe(4);
  });

  it("only Super Admins can delete a tournament, with the exact name", async () => {
    await asUser(db, admin);
    await expectError(db.query("select public.delete_tournament($1, 'Test League')", [tournamentId]), /Super Admin/);
    await asUser(db, superAdmin);
    await expectError(db.query("select public.delete_tournament($1, 'test league')", [tournamentId]), /exactly/);
    await db.query("select public.delete_tournament($1, 'Test League')", [tournamentId]);
    expect((await db.query("select * from public.tournaments where id = $1", [tournamentId])).rows).toHaveLength(0);
  });
});
