import { describe, expect, it } from "vitest";
import {
  activeBreak, computeStats, finalPlacings, mostGoals, scheduleBreaks, scheduleSummary, teamRestPeriods,
  type ScheduleItem, type StatEvent, type StatFixture,
} from "@/lib/engine";

const fx = (id: string, h: string, a: string, hs: number, as: number, status = "confirmed", extra: Partial<StatFixture> = {}): StatFixture =>
  ({ id, homeTeamId: h, awayTeamId: a, homeScore: hs, awayScore: as, status, ...extra });
const ev = (fixtureId: string, eventType: string, teamId: string, playerId: string | null, extra: Partial<StatEvent> = {}): StatEvent =>
  ({ fixtureId, eventType, teamId, playerId, ...extra });

describe("team and player statistics", () => {
  // Lions 2-1 Eagles: Sam goal, Sam penalty goal, Eagles own goal by Lions' Ben (credited to Eagles).
  const fixtures = [fx("m1", "lions", "eagles", 2, 1), fx("m2", "eagles", "bears", 0, 0), fx("m3", "lions", "bears", 3, 0, "completed")];
  const events = [
    ev("m1", "goal", "lions", "sam"), ev("m1", "penalty_goal", "lions", "sam"), ev("m1", "own_goal", "lions", "ben"),
    ev("m1", "yellow_card", "eagles", "eve"), ev("m1", "substitution", "lions", "joe", { relatedPlayerId: "ben" }),
    ev("m3", "goal", "lions", "sam"), // unconfirmed match: must not count
  ];
  const stats = computeStats(fixtures, events, [{ fixtureId: "m1", playerId: "sam" }, { fixtureId: "m3", playerId: "sam" }]);
  const team = (id: string) => stats.teams.find((t) => t.teamId === id)!;
  const player = (id: string) => stats.players.find((p) => p.playerId === id)!;

  it("22-24. goals for, against and difference come from confirmed results", () => {
    expect([team("lions").goalsFor, team("lions").goalsAgainst, team("lions").goalDifference]).toEqual([2, 1, 1]);
    expect([team("eagles").goalsFor, team("eagles").goalsAgainst, team("eagles").goalDifference]).toEqual([1, 2, -1]);
    expect(team("bears").cleanSheets).toBe(1);
  });

  it("25/26. player goals count goals and penalty goals; own goals are separate", () => {
    expect([player("sam").goals, player("sam").penaltyGoals]).toEqual([2, 1]);
    expect([player("ben").goals, player("ben").ownGoals]).toEqual([0, 1]);
  });

  it("counts matches played, substitutions, cards and team penalty goals", () => {
    expect(player("sam").matchesPlayed).toBe(1);
    expect([player("joe").subbedOn, player("ben").subbedOff]).toEqual([1, 1]);
    expect(team("eagles").yellow).toBe(1);
    expect(team("lions").penaltyGoals).toBe(1);
    expect(team("lions").matches.map((m) => m.result)).toEqual(["W"]);
  });

  it("44/45. Most Goals shows every tied player and excludes own goals and shootout kicks", () => {
    const tie = computeStats([fx("a", "x", "y", 1, 1, "confirmed", { stage: "knockout", homePenalties: 3, awayPenalties: 2 })], [
      ev("a", "goal", "x", "p1"), ev("a", "goal", "y", "p2"), ev("a", "shootout_goal", "x", "p1"), ev("a", "shootout_goal", "x", "p1"),
    ]);
    expect(tie.mostGoals).toEqual({ goals: 1, playerIds: ["p1", "p2"] });
    expect(mostGoals([])).toEqual({ goals: 0, playerIds: [] });
  });

  it("43. the final decides champion and runner-up, including on penalties", () => {
    const placings = finalPlacings([
      fx("sf1", "a", "d", 1, 0, "confirmed", { code: "SF1" }),
      fx("f", "a", "b", 1, 1, "confirmed", { code: "F", homePenalties: 2, awayPenalties: 4 }),
      fx("p3", "c", "d", 2, 0, "confirmed", { code: "P3" }),
    ]);
    expect(placings).toEqual({ finalConfirmed: true, champion: "b", runnerUp: "a", thirdPlace: "c" });
    expect(finalPlacings([fx("f", "a", "b", 0, 0, "completed", { code: "F" })]).champion).toBeNull();
  });
});

describe("breaks and schedule summary", () => {
  const item = (code: string, stage: string, h: string, a: string, start: number, pitch = "p1"): ScheduleItem =>
    ({ id: code, code, stage, homeTeamId: h, awayTeamId: a, pitchId: pitch, date: "2026-11-15", start, durationMin: 16, status: "scheduled" });
  const items = [
    item("L1", "league", "a", "b", 1030), item("L2", "league", "c", "d", 1030, "p2"),
    item("L3", "league", "a", "c", 1051), item("L4", "league", "b", "d", 1072, "p2"),
    item("SF1", "knockout", "x", "y", 1110), item("SF2", "knockout", "z", "w", 1110, "p2"),
  ];
  const breaks = scheduleBreaks([{ start: 1020, end: 1030, label: "Rules announcement", description: "Captains meet the referees" }], items, "2026-11-15");

  it("34/35. shows configured breaks with their duration", () => {
    expect(breaks[0]).toMatchObject({ label: "Rules announcement", durationMin: 10, description: "Captains meet the referees", pitchId: null });
  });

  it("37. shows the break between the league and the knockouts", () => {
    const ko = breaks.find((b) => b.source === "knockout_gap")!;
    expect([ko.start, ko.end, ko.durationMin]).toEqual([1088, 1110, 22]);
  });

  it("36. calculates each team's rest between matches", () => {
    const a = teamRestPeriods(items).find((r) => r.teamId === "a")!;
    expect([a.previousEnd, a.nextStart, a.restMin]).toEqual([1046, 1051, 5]);
  });

  it("summarises matches, playing time, breaks and pitches", () => {
    const s = scheduleSummary(items, breaks);
    expect(s).toMatchObject({ totalMatches: 6, totalPlayingMin: 96, totalBreakMin: 32, firstStart: 1030, lastEnd: 1126, breaks: 2 });
    expect(s.matchesPerPitch).toEqual({ p1: 3, p2: 3 });
  });

  it("38. knows which break is active now (for the dashboard)", () => {
    expect(activeBreak(breaks, "2026-11-15", 1025)?.label).toBe("Rules announcement");
    expect(activeBreak(breaks, "2026-11-15", 1095)?.label).toBe("Break before the knockouts");
    expect(activeBreak(breaks, "2026-11-15", 1040)).toBeNull();
  });
});
