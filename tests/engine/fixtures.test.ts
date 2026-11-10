import { describe, expect, it } from "vitest";
import {
  collapseByes,
  doubleElimination,
  groupKnockoutBracket,
  planTournament,
  roundRobin,
  roundRobinMatchCount,
  roundRobinRoundCount,
  singleElimination,
  standardSeedOrder,
  assignGroups,
} from "@/lib/engine";

const teams = (n: number) => Array.from({ length: n }, (_, i) => `team-${i + 1}`);
const pairKey = (a: string, b: string) => [a, b].sort().join("|");

describe("round robin", () => {
  it.each([
    [4, 6],
    [5, 10],
    [6, 15],
    [7, 21],
    [8, 28],
  ])("%i teams produce %i matches (n(n-1)/2)", (n, expected) => {
    expect(roundRobinMatchCount(n)).toBe(expected);
    expect(roundRobin(teams(n))).toHaveLength(expected);
  });

  it.each([2, 3, 4, 5, 6, 7, 8, 9, 12, 15, 16])("every pair meets exactly once with %i teams", (n) => {
    const ids = teams(n);
    const pairs = roundRobin(ids);
    const seen = new Map<string, number>();
    for (const p of pairs) {
      expect(p.home).not.toBe(p.away);
      seen.set(pairKey(p.home, p.away), (seen.get(pairKey(p.home, p.away)) ?? 0) + 1);
    }
    expect(seen.size).toBe((n * (n - 1)) / 2);
    expect([...seen.values()].every((c) => c === 1)).toBe(true);
  });

  it.each([4, 5, 6, 7, 8])("no team plays twice in the same round (%i teams)", (n) => {
    const pairs = roundRobin(teams(n));
    const rounds = new Map<number, string[]>();
    for (const p of pairs) rounds.set(p.round, [...(rounds.get(p.round) ?? []), p.home, p.away]);
    for (const list of rounds.values()) expect(new Set(list).size).toBe(list.length);
    expect(rounds.size).toBe(roundRobinRoundCount(n));
  });

  it("gives every team exactly one bye with an odd number of teams", () => {
    const ids = teams(7);
    const pairs = roundRobin(ids);
    const rounds = roundRobinRoundCount(7);
    for (const id of ids) {
      const played = new Set(pairs.filter((p) => p.home === id || p.away === id).map((p) => p.round));
      expect(rounds - played.size).toBe(1);
    }
  });

  it("balances home and away appearances", () => {
    const pairs = roundRobin(teams(8));
    for (const id of teams(8)) {
      const home = pairs.filter((p) => p.home === id).length;
      expect(Math.abs(home - (7 - home))).toBeLessThanOrEqual(1);
    }
  });

  it("double round robin plays each pair twice with home and away swapped", () => {
    const pairs = roundRobin(teams(6), { double: true });
    expect(pairs).toHaveLength(30);
    const directed = new Set(pairs.map((p) => `${p.home}>${p.away}`));
    expect(directed.size).toBe(30);
  });

  it("rejects duplicate team ids", () => {
    expect(() => roundRobin(["a", "a", "b"])).toThrow();
  });
});

describe("knockout brackets", () => {
  it("uses standard seeding", () => {
    expect(standardSeedOrder(4)).toEqual([1, 4, 2, 3]);
    expect(standardSeedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });

  it("league play-off with four qualifiers: 1st v 4th, 2nd v 3rd, winners in the final", () => {
    const ko = singleElimination(["league:1", "league:2", "league:3", "league:4"]);
    const sf1 = ko.find((f) => f.code === "SF1")!;
    const sf2 = ko.find((f) => f.code === "SF2")!;
    const final = ko.find((f) => f.code === "F")!;
    expect([sf1.homeSource, sf1.awaySource]).toEqual(["league:1", "league:4"]);
    expect([sf2.homeSource, sf2.awaySource]).toEqual(["league:2", "league:3"]);
    expect([final.homeSource, final.awaySource]).toEqual(["winner:SF1", "winner:SF2"]);
    expect(final.dependsOn.sort()).toEqual(["SF1", "SF2"]);
    expect(sf1.afterGroupPhase).toBe(true);
  });

  it("adds an optional third-place play-off", () => {
    const ko = singleElimination(["league:1", "league:2", "league:3", "league:4"], { thirdPlaceMatch: true });
    const p3 = ko.find((f) => f.code === "P3")!;
    expect([p3.homeSource, p3.awaySource]).toEqual(["loser:SF1", "loser:SF2"]);
  });

  it("gives byes to top seeds when the field is not a power of two", () => {
    const ko = singleElimination(["seed:1", "seed:2", "seed:3", "seed:4", "seed:5", "seed:6"]);
    expect(ko).toHaveLength(5); // 6 teams → 5 matches
    expect(ko.some((f) => f.homeSource === "bye" || f.awaySource === "bye")).toBe(false);
    const sources = ko.flatMap((f) => [f.homeSource, f.awaySource]);
    expect(sources).toContain("seed:1");
    expect(sources).toContain("seed:2");
    // Seeds 1 and 2 skip the first round
    const firstRound = ko.filter((f) => f.code.startsWith("QF"));
    expect(firstRound.flatMap((f) => [f.homeSource, f.awaySource])).not.toContain("seed:1");
  });

  it.each([3, 4, 5, 6, 7, 8, 11, 16])("single elimination with %i teams has n-1 matches", (n) => {
    const ko = singleElimination(Array.from({ length: n }, (_, i) => `seed:${i + 1}`));
    expect(ko).toHaveLength(n - 1);
  });

  it.each([4, 5, 6, 8, 12, 16])("double elimination with %i teams has 2n-2 matches and no byes", (n) => {
    const ko = doubleElimination(Array.from({ length: n }, (_, i) => `seed:${i + 1}`));
    expect(ko).toHaveLength(2 * n - 2);
    expect(ko.some((f) => f.homeSource === "bye" || f.awaySource === "bye")).toBe(false);
    expect(ko.find((f) => f.code === "GF")).toBeDefined();
    // Every referenced fixture exists
    const codes = new Set(ko.map((f) => f.code));
    for (const f of ko) for (const d of f.dependsOn) expect(codes.has(d)).toBe(true);
  });

  it("collapses byes through dependent matches", () => {
    const out = collapseByes([
      { code: "A", stage: "knockout", roundNumber: 1, roundName: "", groupLabel: null, homeTeamId: null, awayTeamId: null, homeSource: "seed:1", awaySource: "bye", dependsOn: [], afterGroupPhase: false },
      { code: "B", stage: "knockout", roundNumber: 2, roundName: "", groupLabel: null, homeTeamId: null, awayTeamId: null, homeSource: "winner:A", awaySource: "seed:2", dependsOn: [], afterGroupPhase: false },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].homeSource).toBe("seed:1");
  });

  it("crosses groups in the first knockout round (A1 v B2, B1 v A2)", () => {
    const ko = groupKnockoutBracket(["A", "B"], 2);
    const pairs = ko.filter((f) => f.code.startsWith("SF")).map((f) => [f.homeSource, f.awaySource]);
    expect(pairs).toEqual([
      ["group:A:1", "group:B:2"],
      ["group:B:1", "group:A:2"],
    ]);
  });

  it("puts paired group winners in opposite halves with four groups", () => {
    const ko = groupKnockoutBracket(["A", "B", "C", "D"], 2);
    const qf = ko.filter((f) => f.code.startsWith("QF"));
    expect(qf).toHaveLength(4);
    const sf1 = ko.find((f) => f.code === "SF1")!;
    const feeding = [sf1.homeSource, sf1.awaySource].map((s) => qf.find((q) => `winner:${q.code}` === s)!);
    const winnersInSf1 = feeding.map((q) => q.homeSource);
    expect(winnersInSf1).toContain("group:A:1");
    expect(winnersInSf1).not.toContain("group:B:1");
  });
});

describe("tournament plans", () => {
  const plTeams = teams(7).map((id, i) => ({ id, name: id, seed: i + 1 }));

  it("league + play-offs for 7 teams: 21 league matches + 2 semis + final", () => {
    const plan = planTournament(plTeams, { format: "league_playoff", qualifiers: 4 });
    expect(plan.errors).toEqual([]);
    expect(plan.fixtures.filter((f) => f.stage === "league")).toHaveLength(21);
    expect(plan.fixtures.filter((f) => f.stage === "knockout").map((f) => f.code).sort()).toEqual(["F", "SF1", "SF2"]);
    expect(new Set(plan.fixtures.map((f) => f.code)).size).toBe(plan.fixtures.length);
  });

  it("refuses more qualifiers than teams", () => {
    const plan = planTournament(plTeams.slice(0, 3), { format: "league_playoff", qualifiers: 4 });
    expect(plan.errors.length).toBeGreaterThan(0);
    expect(plan.fixtures).toHaveLength(0);
  });

  it("single elimination resolves seeds to team ids", () => {
    const plan = planTournament(plTeams.slice(0, 4), { format: "single_elimination" });
    const sf1 = plan.fixtures.find((f) => f.code === "SF1")!;
    expect(sf1.homeTeamId).toBe("team-1");
    expect(sf1.awayTeamId).toBe("team-4");
  });

  it("group stage requires group assignments, then builds group round robins", () => {
    expect(planTournament(plTeams.slice(0, 6), { format: "group_knockout", groupCount: 2, qualifiersPerGroup: 2 }).errors[0]).toMatch(/no group/);
    const groups = assignGroups(plTeams.slice(0, 6), 2);
    const withGroups = plTeams.slice(0, 6).map((t) => ({ ...t, groupLabel: groups.get(t.id) }));
    const plan = planTournament(withGroups, { format: "group_knockout", groupCount: 2, qualifiersPerGroup: 2 });
    expect(plan.errors).toEqual([]);
    expect(plan.fixtures.filter((f) => f.stage === "group")).toHaveLength(6); // 2 groups × 3
    for (const f of plan.fixtures.filter((x) => x.stage === "group")) {
      expect(groups.get(f.homeTeamId!)).toBe(groups.get(f.awayTeamId!));
    }
  });

  it("snake-distributes seeds across groups", () => {
    const groups = assignGroups(plTeams.slice(0, 6), 2);
    expect([groups.get("team-1"), groups.get("team-2"), groups.get("team-3"), groups.get("team-4")]).toEqual(["A", "B", "B", "A"]);
  });
});
