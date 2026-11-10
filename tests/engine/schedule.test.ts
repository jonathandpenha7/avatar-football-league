import { describe, expect, it } from "vitest";
import {
  assessFeasibility,
  buildSlots,
  detectConflicts,
  planTournament,
  scheduleFixtures,
  type ScheduleResult,
} from "@/lib/engine";

const pitches = [
  { id: "p1", name: "Pitch 1" },
  { id: "p2", name: "Pitch 2" },
];
const avatarDay = [{ date: "2026-12-12", start: 17 * 60, end: 21 * 60 }];
const announcement = [{ start: 17 * 60, end: 17 * 60 + 10, label: "Rules announcement" }];

function makeTeams(n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: `t${i + 1}`, name: `Team ${i + 1}`, seed: i + 1 }));
}

function assertNoTeamDoubleBooked(result: ScheduleResult, fixtures: ReturnType<typeof planTournament>["fixtures"]) {
  const byCode = new Map(fixtures.map((f) => [f.code, f]));
  const bySlot = new Map<number, string[]>();
  for (const a of result.assignments) {
    const f = byCode.get(a.code)!;
    const list = bySlot.get(a.slotIndex) ?? [];
    for (const t of [f.homeTeamId, f.awayTeamId]) if (t) list.push(t);
    bySlot.set(a.slotIndex, list);
  }
  for (const list of bySlot.values()) expect(new Set(list).size).toBe(list.length);
  // Never two matches on one pitch at once
  const pitchSlot = result.assignments.map((a) => `${a.slotIndex}|${a.pitchId}`);
  expect(new Set(pitchSlot).size).toBe(pitchSlot.length);
}

describe("slot building", () => {
  it("respects match length, transitions and blocked periods", () => {
    const slots = buildSlots(avatarDay, { matchMin: 12, transitionMin: 3 }, pitches, announcement);
    expect(slots[0].start).toBe(17 * 60 + 10); // after the announcement
    expect(slots[1].start - slots[0].start).toBe(15);
    expect(slots.every((s) => s.end <= 21 * 60)).toBe(true);
    expect(slots).toHaveLength(15); // 230 minutes / 15 → 15 kick-offs (last ends 20:55)
  });

  it("includes half-time for two-period matches", () => {
    const slots = buildSlots(avatarDay, { matchMin: 20, periods: 2, halfTimeMin: 2, transitionMin: 3 }, pitches);
    expect(slots[0].end - slots[0].start).toBe(22);
    expect(slots[1].start - slots[0].start).toBe(25);
  });

  it("removes a pitch for pitch-specific blocks and availability", () => {
    const slots = buildSlots(
      avatarDay,
      { matchMin: 10, transitionMin: 0 },
      [{ id: "p1", name: "1" }, { id: "p2", name: "2", availableFrom: 18 * 60 }],
      [{ start: 19 * 60, end: 19 * 60 + 30, pitchId: "p1" }],
    );
    expect(slots[0].pitchIds).toEqual(["p1"]);
    expect(slots.find((s) => s.start === 18 * 60)!.pitchIds).toEqual(["p1", "p2"]);
    expect(slots.find((s) => s.start === 19 * 60)!.pitchIds).toEqual(["p2"]);
  });
});

describe("scheduler", () => {
  it.each([4, 5, 6, 7, 8])("schedules a %i-team round robin with no team on two pitches at once", (n) => {
    const plan = planTournament(makeTeams(n), { format: "round_robin" });
    const result = scheduleFixtures({
      fixtures: plan.fixtures,
      days: avatarDay,
      timing: { matchMin: 10, transitionMin: 2 },
      pitches,
      blocked: announcement,
    });
    expect(result.feasible).toBe(true);
    expect(result.assignments).toHaveLength(plan.fixtures.length);
    assertNoTeamDoubleBooked(result, plan.fixtures);
  });

  it("Avatar format with 7 teams: league, then simultaneous semis, then the final", () => {
    const plan = planTournament(makeTeams(7), { format: "league_playoff", qualifiers: 4 });
    const result = scheduleFixtures({
      fixtures: plan.fixtures,
      days: avatarDay,
      timing: { matchMin: 12, transitionMin: 3 },
      pitches,
      blocked: announcement,
    });
    expect(result.feasible).toBe(true);
    assertNoTeamDoubleBooked(result, plan.fixtures);
    const at = (code: string) => result.assignments.find((a) => a.code === code)!;
    const lastLeague = Math.max(
      ...result.assignments.filter((a) => a.code.startsWith("L")).map((a) => a.slotIndex),
    );
    expect(at("SF1").slotIndex).toBeGreaterThan(lastLeague);
    expect(at("SF1").slotIndex).toBe(at("SF2").slotIndex); // simultaneous
    expect(at("SF1").pitchId).not.toBe(at("SF2").pitchId);
    expect(at("F").slotIndex).toBeGreaterThan(at("SF1").slotIndex);
    expect(result.metrics.endMinute!).toBeLessThanOrEqual(21 * 60);
  });

  it("fills both pitches and keeps 7-team league to the minimum 11 slots", () => {
    const plan = planTournament(makeTeams(7), { format: "round_robin" });
    const result = scheduleFixtures({
      fixtures: plan.fixtures,
      days: avatarDay,
      timing: { matchMin: 12, transitionMin: 3 },
      pitches,
    });
    expect(result.metrics.slotsUsed).toBe(11); // ceil(21 / 2)
  });

  it("limits back-to-back matches for 6 teams on 2 pitches", () => {
    const plan = planTournament(makeTeams(6), { format: "round_robin" });
    const result = scheduleFixtures({
      fixtures: plan.fixtures,
      days: avatarDay,
      timing: { matchMin: 12, transitionMin: 3 },
      pitches,
    });
    // 6 teams, 2 pitches: 4 of 6 play every slot, so some back-to-backs are unavoidable,
    // but no team should have more than its fair share.
    for (const t of result.metrics.teams) expect(t.backToBack).toBeLessThanOrEqual(3);
    expect(result.metrics.slotsUsed).toBe(8); // ceil(15 / 2)
  });

  it("is deterministic for identical input", () => {
    const plan = planTournament(makeTeams(6), { format: "league_playoff", qualifiers: 4 });
    const input = { fixtures: plan.fixtures, days: avatarDay, timing: { matchMin: 12, transitionMin: 3 }, pitches };
    expect(scheduleFixtures(input).assignments).toEqual(scheduleFixtures(input).assignments);
  });

  it("schedules double elimination respecting dependencies", () => {
    const plan = planTournament(makeTeams(8), { format: "double_elimination" });
    const result = scheduleFixtures({
      fixtures: plan.fixtures,
      days: [{ date: "2026-12-12", start: 9 * 60, end: 18 * 60 }],
      timing: { matchMin: 15, transitionMin: 5 },
      pitches,
    });
    expect(result.feasible).toBe(true);
    const at = new Map(result.assignments.map((a) => [a.code, a]));
    for (const f of plan.fixtures) {
      for (const dep of f.dependsOn) expect(at.get(f.code)!.slotIndex).toBeGreaterThan(at.get(dep)!.slotIndex);
    }
  });

  it("reports unscheduled matches instead of inventing time", () => {
    const plan = planTournament(makeTeams(8), { format: "round_robin" });
    const result = scheduleFixtures({
      fixtures: plan.fixtures,
      days: [{ date: "2026-12-12", start: 17 * 60, end: 18 * 60 }],
      timing: { matchMin: 12, transitionMin: 3 },
      pitches,
    });
    expect(result.feasible).toBe(false);
    expect(result.unscheduled.length).toBe(28 - result.assignments.length);
    expect(result.assignments.every((a) => a.end <= 18 * 60)).toBe(true);
  });
});

describe("feasibility", () => {
  const base = {
    format: { format: "league_playoff" as const, qualifiers: 4 },
    days: avatarDay,
    pitches,
    blocked: announcement,
    periods: 1 as const,
  };

  it("Avatar league with 7 teams fits 12-minute matches and 3-minute transitions", () => {
    const r = assessFeasibility({ ...base, teamCount: 7, matchMin: 12, transitionMin: 3 });
    expect(r.status).toBe("feasible");
    expect(r.totalMatches).toBe(24);
    expect(r.minimumSlots).toBe(13); // 11 league + 1 semi slot + 1 final slot
    expect(r.maxMatchMinutes).toBeGreaterThanOrEqual(12);
  });

  it("flags an impossible plan and suggests concrete fixes", () => {
    const r = assessFeasibility({ ...base, teamCount: 7, matchMin: 20, transitionMin: 5 });
    expect(r.status).toBe("infeasible");
    expect(r.suggestions.some((s) => /Shorten matches to \d+ minutes/.test(s))).toBe(true);
    expect(r.suggestions.some((s) => /Add \d+ more pitch/.test(s))).toBe(true);
    expect(r.suggestions.some((s) => /Extend the tournament window/.test(s))).toBe(true);
    // The suggested maximum must itself be feasible
    const fixed = assessFeasibility({ ...base, teamCount: 7, matchMin: r.maxMatchMinutes!, transitionMin: 5 });
    expect(fixed.status).toBe("feasible");
  });

  it("does not assume a match duration: reports it as missing and gives the maximum", () => {
    const r = assessFeasibility({ ...base, teamCount: 7, matchMin: null, transitionMin: 3 });
    expect(r.status).toBe("incomplete");
    expect(r.missing).toContain("Match duration has not been decided.");
    expect(r.maxMatchMinutes).toBeGreaterThan(0);
  });
});

describe("conflict detection", () => {
  const base = { durationMin: 12, status: "scheduled" };
  it("finds teams double-booked, pitch clashes and dependency violations", () => {
    const conflicts = detectConflicts([
      { ...base, id: "1", code: "L1", homeTeamId: "a", awayTeamId: "b", pitchId: "p1", date: "2026-12-12", start: 1020 },
      { ...base, id: "2", code: "L2", homeTeamId: "a", awayTeamId: "c", pitchId: "p2", date: "2026-12-12", start: 1025 },
      { ...base, id: "3", code: "L3", homeTeamId: "d", awayTeamId: "e", pitchId: "p1", date: "2026-12-12", start: 1030 },
      { ...base, id: "4", code: "SF1", homeTeamId: null, awayTeamId: null, homeSource: "winner:L3", pitchId: "p2", date: "2026-12-12", start: 1035 },
    ]);
    const kinds = conflicts.map((c) => c.kind);
    expect(kinds).toContain("team_double_booked");
    expect(kinds).toContain("pitch_double_booked");
    expect(kinds).toContain("dependency_order");
  });

  it("warns about back-to-back matches", () => {
    const conflicts = detectConflicts(
      [
        { ...base, id: "1", code: "L1", homeTeamId: "a", awayTeamId: "b", pitchId: "p1", date: "2026-12-12", start: 1020 },
        { ...base, id: "2", code: "L2", homeTeamId: "a", awayTeamId: "c", pitchId: "p1", date: "2026-12-12", start: 1035 },
      ],
      { transitionMin: 3 },
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].kind).toBe("back_to_back");
    expect(conflicts[0].severity).toBe("warning");
  });
});
