import { describe, expect, it } from "vitest";
import {
  playerEligibility,
  preMatchAlerts,
  suspensionProgress,
  yellowsUntilSuspension,
  type DisciplineFixture,
  type SuspensionLike,
} from "@/lib/engine";
import { can, type Actor } from "@/lib/permissions";

const fx = (id: string, home: string, away: string, start: number, status = "scheduled"): DisciplineFixture => ({
  id, homeTeamId: home, awayTeamId: away, status, date: "2026-12-12", start, order: start,
});

describe("suspensions", () => {
  const fixtures = [
    fx("m1", "lions", "eagles", 1020, "confirmed"), // red card here
    fx("m2", "lions", "bears", 1050, "confirmed"),
    fx("m3", "lions", "wolves", 1080),
    fx("m4", "lions", "hawks", 1110),
  ];
  const suspension: SuspensionLike = {
    id: "s1", playerId: "p1", teamId: "lions", startsAfterFixtureId: "m1", matches: 2, status: "active", reason: "Red card",
  };
  const player = { id: "p1", fullName: "Sam", teamId: "lions", registrationStatus: "confirmed", eligibilityStatus: "eligible" };

  it("counts confirmed team matches after the incident as served", () => {
    expect(suspensionProgress(suspension, fixtures)).toEqual({ served: 1, remaining: 1, active: true });
  });

  it("player is ineligible for the next match and eligible once served", () => {
    expect(playerEligibility(player, [suspension], fixtures, "m3").eligible).toBe(false);
    const afterM3 = fixtures.map((f) => (f.id === "m3" ? { ...f, status: "confirmed" } : f));
    expect(playerEligibility(player, [suspension], afterM3, "m4").eligible).toBe(true);
  });

  it("an overturned suspension never blocks", () => {
    expect(playerEligibility(player, [{ ...suspension, status: "overturned" }], fixtures, "m3").eligible).toBe(true);
  });

  it("raises pre-match alerts for suspended or ineligible players", () => {
    const players = [
      player,
      { id: "p2", fullName: "Alex", teamId: "wolves", registrationStatus: "confirmed", eligibilityStatus: "ineligible", eligibilityNote: "Age" },
      { id: "p3", fullName: "Kim", teamId: "wolves", registrationStatus: "confirmed", eligibilityStatus: "eligible" },
    ];
    const alerts = preMatchAlerts(fixtures[2], players, [suspension], fixtures);
    expect(alerts.map((a) => a.playerName).sort()).toEqual(["Alex", "Sam"]);
  });

  it("only reports yellow accumulation when a threshold is configured", () => {
    expect(yellowsUntilSuspension(2, null)).toBeNull();
    expect(yellowsUntilSuspension(2, 3)).toBe(1);
  });
});

describe("permission matrix", () => {
  const admin: Actor = { isSuperAdmin: false, role: "tournament_admin" };
  const referee: Actor = { isSuperAdmin: false, role: "referee" };
  const scorekeeper: Actor = { isSuperAdmin: false, role: "scorekeeper" };
  const viewer: Actor = { isSuperAdmin: false, role: "viewer" };
  const outsider: Actor = { isSuperAdmin: false, role: null };
  const superAdmin: Actor = { isSuperAdmin: true, role: null };

  it("super admins can do everything", () => {
    expect(can(superAdmin, "tournament.delete")).toBe(true);
    expect(can(superAdmin, "users.manage")).toBe(true);
  });

  it("tournament admins manage their tournament but not the platform", () => {
    expect(can(admin, "fixtures.generate")).toBe(true);
    expect(can(admin, "match.correct")).toBe(true);
    expect(can(admin, "tournament.delete")).toBe(false);
    expect(can(admin, "users.manage")).toBe(false);
  });

  it("officials can only score assigned matches", () => {
    expect(can(referee, "match.record")).toBe(false);
    expect(can(referee, "match.record", { assignedAs: ["referee"] })).toBe(true);
    expect(can(scorekeeper, "match.record", { assignedAs: ["scorekeeper"] })).toBe(true);
    expect(can(scorekeeper, "fixtures.generate")).toBe(false);
  });

  it("referees confirm results only when the tournament allows it", () => {
    expect(can(referee, "match.confirm", { assignedAs: ["referee"] })).toBe(false);
    expect(can(referee, "match.confirm", { assignedAs: ["referee"], refereeCanConfirm: true })).toBe(true);
    expect(can(scorekeeper, "match.confirm", { assignedAs: ["scorekeeper"], refereeCanConfirm: true })).toBe(false);
    expect(can(referee, "match.correct", { assignedAs: ["referee"] })).toBe(false);
  });

  it("viewers and outsiders are read-only", () => {
    expect(can(viewer, "tournament.view")).toBe(true);
    expect(can(viewer, "match.record", { assignedAs: ["referee"] })).toBe(false);
    expect(can(outsider, "tournament.view")).toBe(false);
  });
});
