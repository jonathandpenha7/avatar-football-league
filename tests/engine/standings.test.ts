import { describe, expect, it } from "vitest";
import {
  computeStandings,
  evaluateQualification,
  fairPlayPoints,
  type ResultFixture,
  type StandingsOptions,
} from "@/lib/engine";

const teams = ["Grace", "Hope", "Faith", "Joy", "Peace"].map((name) => ({ id: name.toLowerCase(), name }));
let id = 0;
const r = (home: string, away: string, hs: number, as: number, status = "confirmed"): ResultFixture => ({
  id: String(++id),
  homeTeamId: home,
  awayTeamId: away,
  homeScore: hs,
  awayScore: as,
  status,
});

const confirmed: StandingsOptions = {
  pointsWin: 3,
  pointsDraw: 1,
  pointsLoss: 0,
  tiebreakers: ["goal_difference", "goals_for", "head_to_head"],
  tiebreakersConfirmed: true,
};

describe("league standings", () => {
  it("calculates played, W/D/L, goals and points", () => {
    const s = computeStandings(teams, [r("grace", "hope", 3, 1), r("faith", "joy", 2, 2), r("grace", "faith", 0, 1)], confirmed);
    const grace = s.rows.find((x) => x.teamId === "grace")!;
    expect(grace).toMatchObject({ played: 2, won: 1, drawn: 0, lost: 1, goalsFor: 3, goalsAgainst: 2, goalDifference: 1, points: 3 });
    const faith = s.rows.find((x) => x.teamId === "faith")!;
    expect(faith).toMatchObject({ played: 2, won: 1, drawn: 1, points: 4 });
    expect(s.rows[0].teamId).toBe("faith");
  });

  it("ignores unconfirmed results", () => {
    const s = computeStandings(teams, [r("grace", "hope", 3, 1, "completed"), r("grace", "joy", 1, 0, "in_progress")], confirmed);
    expect(s.rows.every((x) => x.played === 0)).toBe(true);
  });

  it("uses custom points", () => {
    const s = computeStandings(teams, [r("grace", "hope", 1, 0), r("faith", "joy", 1, 1)], {
      ...confirmed,
      pointsWin: 2,
      pointsDraw: 1,
      pointsLoss: 0,
    });
    expect(s.rows.find((x) => x.teamId === "grace")!.points).toBe(2);
    expect(s.rows.find((x) => x.teamId === "joy")!.points).toBe(1);
  });

  it("applies goal difference, then goals scored", () => {
    const s = computeStandings(
      teams,
      [r("grace", "peace", 3, 0), r("hope", "peace", 4, 2), r("faith", "peace", 2, 0), r("joy", "peace", 1, 0)],
      confirmed,
    );
    // All four winners have 3 points. GD: grace +3, faith +2, hope +2, joy +1. Faith vs Hope by goals scored.
    expect(s.rows.slice(0, 4).map((x) => x.teamId)).toEqual(["grace", "hope", "faith", "joy"]);
    expect(s.rows.find((x) => x.teamId === "hope")!.separatedBy).toBe("Goals scored");
    expect(s.unresolvedTies).toEqual([]);
  });

  it("applies head-to-head among tied teams only", () => {
    const opts: StandingsOptions = { ...confirmed, tiebreakers: ["head_to_head", "goal_difference"] };
    const s = computeStandings(
      teams,
      [r("grace", "hope", 1, 0), r("hope", "joy", 5, 0), r("grace", "joy", 0, 1), r("joy", "peace", 0, 0)],
      opts,
    );
    // Grace 3, Hope 3, Joy 4 … Grace beat Hope head-to-head despite Hope's better GD.
    const order = s.rows.map((x) => x.teamId);
    expect(order.indexOf("grace")).toBeLessThan(order.indexOf("hope"));
    expect(s.rows.find((x) => x.teamId === "grace")!.separatedBy).toBe("Head-to-head");
  });

  it("re-applies head-to-head within a three-way tie", () => {
    const three = teams.slice(0, 3);
    const opts: StandingsOptions = { ...confirmed, tiebreakers: ["head_to_head", "goals_for"] };
    // Cyclic: grace>hope, hope>faith, faith>grace — head-to-head points equal; GD in h2h differs.
    const s = computeStandings(three, [r("grace", "hope", 3, 0), r("hope", "faith", 1, 0), r("faith", "grace", 1, 0)], opts);
    // H2H GD: grace +2, hope -2, faith 0
    expect(s.rows.map((x) => x.teamId)).toEqual(["grace", "faith", "hope"]);
  });

  it("does not silently apply unconfirmed tie-breakers", () => {
    const s = computeStandings(teams, [r("grace", "peace", 5, 0), r("hope", "joy", 1, 0)], {
      ...confirmed,
      tiebreakersConfirmed: false,
    });
    const grace = s.rows.find((x) => x.teamId === "grace")!;
    const hope = s.rows.find((x) => x.teamId === "hope")!;
    expect(grace.position).toBe(1);
    expect(hope.position).toBe(1);
    expect(grace.shared).toBe(true);
    expect(s.unresolvedTies).toContainEqual(["grace", "hope"]);
    expect(s.notes[0]).toMatch(/not been confirmed/);
  });

  it("uses fair-play points (fewer is better)", () => {
    const fp = fairPlayPoints(
      [
        { teamId: "grace", type: "yellow" },
        { teamId: "hope", type: "red" },
      ],
      { yellow: 1, red: 3 },
    );
    const s = computeStandings(teams, [r("grace", "joy", 1, 0), r("hope", "peace", 1, 0)], {
      ...confirmed,
      tiebreakers: ["goal_difference", "goals_for", "fair_play"],
      fairPlay: fp,
    });
    expect(s.rows[0].teamId).toBe("grace");
    expect(s.rows[0].separatedBy).toBe("Fair-play points");
  });

  it("leaves a tie unresolved when criteria run out, then honours an organiser decision", () => {
    const fixtures = [r("grace", "joy", 1, 0), r("hope", "peace", 1, 0)];
    const opts: StandingsOptions = { ...confirmed, tiebreakers: ["goal_difference", "goals_for", "organiser_decision"] };
    const before = computeStandings(teams, fixtures, opts);
    expect(before.unresolvedTies).toContainEqual(["grace", "hope"]);
    const after = computeStandings(teams, fixtures, { ...opts, decisions: [{ orderedTeamIds: ["hope", "grace"] }] });
    expect(after.rows[0].teamId).toBe("hope");
    expect(after.rows[1].teamId).toBe("grace");
    expect(after.unresolvedTies.filter((t) => t.includes("grace"))).toEqual([]);
  });
});

describe("qualification", () => {
  const four = teams.slice(0, 5);
  const fullLeague = (scores: Record<string, [number, number]>) =>
    Object.entries(scores).map(([k, [hs, as]]) => {
      const [h, a] = k.split("-");
      return r(h, a, hs, as);
    });

  const results = fullLeague({
    "grace-hope": [2, 0], "grace-faith": [1, 0], "grace-joy": [3, 1], "grace-peace": [2, 2],
    "hope-faith": [1, 1], "hope-joy": [2, 0], "hope-peace": [3, 0],
    "faith-joy": [2, 1], "faith-peace": [1, 0],
    "joy-peace": [0, 1],
  });

  it("seeds the top four once every match is confirmed", () => {
    const standings = computeStandings(four, results, confirmed);
    const q = evaluateQualification({ standings, qualifiers: 4, complete: true, sourcePrefix: "league" });
    expect(q.ready).toBe(true);
    expect(q.assignments.map((a) => a.source)).toEqual(["league:1", "league:2", "league:3", "league:4"]);
    expect(q.assignments[0].teamId).toBe("grace");
  });

  it("blocks seeding while league matches remain", () => {
    const standings = computeStandings(four, results.slice(0, 8), confirmed);
    const q = evaluateQualification({ standings, qualifiers: 4, complete: false, sourcePrefix: "league" });
    expect(q.ready).toBe(false);
    expect(q.blockers[0]).toMatch(/not all confirmed/);
  });

  it("allows provisional seeding only when explicitly requested", () => {
    const standings = computeStandings(four, results.slice(0, 8), confirmed);
    const q = evaluateQualification({ standings, qualifiers: 4, complete: false, provisional: true, sourcePrefix: "league" });
    expect(q.ready).toBe(true);
    expect(q.provisional).toBe(true);
  });

  it("blocks seeding when a tie affects a qualifying position", () => {
    const standings = computeStandings(four, results, { ...confirmed, tiebreakersConfirmed: false });
    const tied = standings.rows.some((x) => x.shared && x.position <= 4);
    const q = evaluateQualification({ standings, qualifiers: 4, complete: true, sourcePrefix: "league" });
    expect(q.ready).toBe(!tied);
    if (tied) expect(q.blockers.join(" ")).toMatch(/tied for/);
  });
});

describe("provisional standings", () => {
  it("33. official standings ignore unconfirmed results; the provisional preview includes them", () => {
    const fixtures = [r("grace", "hope", 2, 0, "confirmed"), r("joy", "peace", 1, 0, "completed"), r("faith", "joy", 3, 3, "in_progress")];
    const official = computeStandings(teams, fixtures, confirmed);
    const preview = computeStandings(teams, fixtures, { ...confirmed, includeProvisional: true });
    expect(official.rows.find((x) => x.teamId === "joy")!.points).toBe(0);
    expect(preview.rows.find((x) => x.teamId === "joy")!.points).toBe(4);
    expect(official.rows.find((x) => x.teamId === "grace")!.points).toBe(3);
  });
});
