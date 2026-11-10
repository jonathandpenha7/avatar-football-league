import { beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb, createUser, type TestDb } from "./harness";
import { avatarFootballLeague } from "@/lib/templates";
import { createTournamentSchema } from "@/lib/validation";
import { DEFAULT_SETTINGS } from "@/components/tournament/settings-sections";
import { evaluateQualification, fromMinutes, planTournament, scheduleFixtures } from "@/lib/engine";
import { standingsFor, blockedPeriods, playingDays } from "@/lib/domain";
import type { Fixture, MatchEvent, Team, Tournament, TournamentSettings } from "@/lib/types";

/**
 * End-to-end: the Avatar Football League template is created exactly as the
 * wizard would send it, fixtures are generated and scheduled by the engine,
 * every league match is played and confirmed in the database, the knockout
 * is seeded from the standings and winners advance to the final.
 */
let db: TestDb;
let admin: string;
let tid: string;

const q = async <T,>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;

beforeAll(async () => {
  db = await createTestDb();
  admin = await createUser(db, "organiser@avatar.test", "Organiser");
});

describe("Avatar Football League end to end", () => {
  it("validates and creates the template payload exactly as the wizard sends it", async () => {
    const t = avatarFootballLeague;
    const payload = {
      general: {
        name: t.name, description: t.description, venue: "Church grounds", organiser: null,
        start_date: "2026-12-12", end_date: null, daily_start_time: t.dailyStart, daily_end_time: t.dailyEnd,
        timezone: "Asia/Kolkata", status: "draft",
      },
      format: t.format,
      settings: { ...DEFAULT_SETTINGS, ...t.settings, team_count: 7 },
      pitches: t.pitches.map((name) => ({ name, available_from: null, available_until: null })),
      teamNames: Array.from({ length: 7 }, (_, i) => `Team ${i + 1}`),
      templateKey: t.key,
    };
    const parsed = createTournamentSchema.safeParse(payload);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    const v = parsed.data!;
    await asUser(db, admin);
    const [{ id }] = await q<{ id: string }>("select public.create_tournament($1::jsonb) as id", [
      JSON.stringify({
        tournament: { ...v.general, format: v.format, template_key: t.key },
        settings: v.settings,
        pitches: v.pitches,
        teams: v.teamNames.map((name) => ({ name, is_placeholder: true })),
        rules: t.rules,
        decisions: t.decisions,
      }),
    ]);
    tid = id;
    const [s] = await q<TournamentSettings>("select * from public.tournament_settings where tournament_id = $1", [tid]);
    // Unresolved items stay unresolved.
    expect(s.match_duration_min).toBeNull();
    expect(s.transition_min).toBeNull();
    expect(s.red_card_suspension_matches).toBeNull();
    expect(s.tiebreakers_confirmed).toBe(false);
    expect(s.max_squad_size).toBe(6);
    expect(s.players_on_pitch).toBe(5);
    expect(s.qualifiers).toBe(4);
    const decisions = await q<{ key: string; status: string }>("select key, status from public.tournament_decisions where tournament_id = $1", [tid]);
    expect(decisions.map((d) => d.key)).toEqual(expect.arrayContaining(["gk_handball_outside_area", "kick_in_distance", "corner_direct_goal", "match_duration", "tiebreaker_order", "suspension_rules"]));
    expect(decisions.every((d) => d.status === "open")).toBe(true);
    expect((await q("select * from public.teams where tournament_id = $1", [tid])).length).toBe(7);
  });

  it("generates and schedules 21 league matches plus semis and final in the 5 PM to 9 PM window", async () => {
    // Organisers decide timings (simulated), then generate.
    await db.query("update public.tournament_settings set match_duration_min = 12, transition_min = 3, tiebreakers_confirmed = true where tournament_id = $1", [tid]);
    const [t] = await q<Tournament>("select * from public.tournaments where id = $1", [tid]);
    const [s] = await q<TournamentSettings>("select * from public.tournament_settings where tournament_id = $1", [tid]);
    const teams = await q<Team>("select * from public.teams where tournament_id = $1 order by seed", [tid]);
    const pitches = await q<{ id: string; name: string }>("select id, name from public.pitches where tournament_id = $1 order by sort_order", [tid]);
    const plan = planTournament(teams.map((x) => ({ id: x.id, name: x.name, seed: x.seed })), { format: t.format, qualifiers: s.qualifiers });
    const result = scheduleFixtures({
      fixtures: plan.fixtures,
      days: playingDays(t),
      timing: { matchMin: s.match_duration_min!, transitionMin: s.transition_min!, periods: s.periods, halfTimeMin: s.half_time_min },
      pitches,
      blocked: blockedPeriods(s),
    });
    expect(result.feasible).toBe(true);
    const at = new Map(result.assignments.map((a) => [a.code, a]));
    const rows = plan.fixtures.map((f) => ({
      code: f.code, stage: f.stage, round_number: f.roundNumber, round_name: f.roundName, match_order: at.get(f.code)!.order,
      home_team_id: f.homeTeamId, away_team_id: f.awayTeamId, home_source: f.homeSource, away_source: f.awaySource,
      pitch_id: at.get(f.code)!.pitchId, scheduled_date: at.get(f.code)!.date, scheduled_time: fromMinutes(at.get(f.code)!.start), duration_min: 12,
    }));
    const [{ n }] = await q<{ n: number }>("select public.replace_fixtures($1, 'all', $2::jsonb) as n", [tid, JSON.stringify(rows)]);
    expect(n).toBe(24);
    const first = await q<{ scheduled_time: string }>("select scheduled_time from public.fixtures where tournament_id = $1 order by scheduled_time limit 1", [tid]);
    expect(first[0].scheduled_time).toBe("17:10:00"); // after the rules announcement block
  });

  it("plays and confirms the league, then seeds 1st v 4th and 2nd v 3rd", async () => {
    const teams = await q<Team>("select * from public.teams where tournament_id = $1 order by seed", [tid]);
    const strength = new Map(teams.map((x, i) => [x.id, 7 - i])); // Team 1 strongest
    const league = await q<Fixture>("select * from public.fixtures where tournament_id = $1 and stage = 'league' order by match_order", [tid]);
    for (const f of league) {
      const hs = strength.get(f.home_team_id!)!;
      const as = strength.get(f.away_team_id!)!;
      await db.query("update public.fixtures set status = 'in_progress' where id = $1", [f.id]);
      const goals = Math.abs(hs - as) % 3 + (hs > as ? 1 : 0);
      const scorer = hs >= as ? f.home_team_id : f.away_team_id;
      for (let g = 0; g < goals; g++) {
        await db.query("insert into public.match_events (tournament_id, fixture_id, event_type, team_id) values ($1, $2, 'goal', $3)", [tid, f.id, scorer]);
      }
      await db.query("update public.fixtures set status = 'completed' where id = $1", [f.id]);
      await db.query("select public.confirm_match_result($1, null)", [f.id]);
    }
    const [s] = await q<TournamentSettings>("select * from public.tournament_settings where tournament_id = $1", [tid]);
    const fixtures = await q<Fixture>("select * from public.fixtures where tournament_id = $1", [tid]);
    const events = await q<MatchEvent>("select * from public.match_events where tournament_id = $1", [tid]);
    const standings = standingsFor(s, teams, fixtures, events, [], { stage: "league" });
    expect(standings.rows.every((r) => r.played === 6)).toBe(true);
    const q4 = evaluateQualification({ standings, qualifiers: 4, complete: true, sourcePrefix: "league" });
    expect(q4.blockers).toEqual([]);
    await db.query("select public.assign_knockout_teams($1, $2::jsonb, false)", [tid, JSON.stringify(q4.assignments.map((a) => ({ source: a.source, team_id: a.teamId })))]);
    const [sf1] = await q<Fixture>("select * from public.fixtures where tournament_id = $1 and code = 'SF1'", [tid]);
    const [sf2] = await q<Fixture>("select * from public.fixtures where tournament_id = $1 and code = 'SF2'", [tid]);
    const pos = (n: number) => q4.assignments.find((a) => a.position === n)!.teamId;
    expect([sf1.home_team_id, sf1.away_team_id]).toEqual([pos(1), pos(4)]);
    expect([sf2.home_team_id, sf2.away_team_id]).toEqual([pos(2), pos(3)]);
    expect(sf1.scheduled_time).toBe(sf2.scheduled_time); // semis played simultaneously
  });

  it("advances semi-final winners into the final and crowns a champion", async () => {
    for (const code of ["SF1", "SF2"]) {
      const [f] = await q<Fixture>("select * from public.fixtures where tournament_id = $1 and code = $2", [tid, code]);
      await db.query("update public.fixtures set status = 'in_progress' where id = $1", [f.id]);
      await db.query("insert into public.match_events (tournament_id, fixture_id, event_type, team_id) values ($1, $2, 'goal', $3)", [tid, f.id, f.away_team_id]);
      await db.query("update public.fixtures set status = 'completed' where id = $1", [f.id]);
      await db.query("select public.confirm_match_result($1, null)", [f.id]);
    }
    const [sf1] = await q<Fixture>("select * from public.fixtures where tournament_id = $1 and code = 'SF1'", [tid]);
    const [sf2] = await q<Fixture>("select * from public.fixtures where tournament_id = $1 and code = 'SF2'", [tid]);
    const [final] = await q<Fixture>("select * from public.fixtures where tournament_id = $1 and code = 'F'", [tid]);
    expect(final.home_team_id).toBe(sf1.away_team_id);
    expect(final.away_team_id).toBe(sf2.away_team_id);
    await db.query("update public.fixtures set status = 'in_progress' where id = $1", [final.id]);
    await db.query("update public.fixtures set status = 'completed' where id = $1", [final.id]);
    await db.query("insert into public.match_events (tournament_id, fixture_id, event_type, team_id) values ($1, $2, 'shootout_goal', $3)", [tid, final.id, final.home_team_id]);
    const [done] = await q<Fixture>("select * from public.confirm_match_result($1, null)", [final.id]);
    expect(done.winner_team_id).toBe(final.home_team_id);
    expect(done.decided_by).toBe("penalties");
  });
});
