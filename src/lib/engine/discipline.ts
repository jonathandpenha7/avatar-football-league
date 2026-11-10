export interface DisciplineFixture {
  id: string;
  homeTeamId: string | null;
  awayTeamId: string | null;
  status: string;
  date: string | null;
  start: number | null;
  order: number;
}

export interface SuspensionLike {
  id: string;
  playerId: string;
  teamId: string | null;
  startsAfterFixtureId: string | null;
  matches: number;
  status: "active" | "overturned";
  reason: string;
}

export interface PlayerLike {
  id: string;
  fullName: string;
  teamId: string | null;
  registrationStatus: string;
  eligibilityStatus: string;
  eligibilityNote?: string | null;
}

/** Chronological sort key: date, kick-off, then match order. */
function chronoKey(f: DisciplineFixture): string {
  return `${f.date ?? "9999-12-31"}|${String(f.start ?? 99_999).padStart(5, "0")}|${String(f.order).padStart(6, "0")}`;
}

export interface SuspensionProgress {
  served: number;
  remaining: number;
  active: boolean;
}

/**
 * A suspension is served by the player's team playing confirmed matches after
 * the incident. If `beforeFixtureId` is given, only matches before that fixture count
 * (used to decide eligibility for an upcoming match).
 */
export function suspensionProgress(
  suspension: SuspensionLike,
  fixtures: DisciplineFixture[],
  beforeFixtureId?: string,
): SuspensionProgress {
  if (suspension.status === "overturned") return { served: 0, remaining: 0, active: false };
  const incident = fixtures.find((f) => f.id === suspension.startsAfterFixtureId);
  const target = beforeFixtureId ? fixtures.find((f) => f.id === beforeFixtureId) : undefined;
  const after = incident ? chronoKey(incident) : "";
  const before = target ? chronoKey(target) : "￿";
  const served = fixtures.filter(
    (f) =>
      f.status === "confirmed" &&
      f.id !== suspension.startsAfterFixtureId &&
      f.id !== beforeFixtureId &&
      suspension.teamId !== null &&
      (f.homeTeamId === suspension.teamId || f.awayTeamId === suspension.teamId) &&
      chronoKey(f) > after &&
      chronoKey(f) < before,
  ).length;
  const capped = Math.min(served, suspension.matches);
  return { served: capped, remaining: suspension.matches - capped, active: suspension.matches - capped > 0 };
}

export interface Eligibility {
  eligible: boolean;
  reasons: string[];
  suspendedMatches: number;
}

export function playerEligibility(
  player: PlayerLike,
  suspensions: SuspensionLike[],
  fixtures: DisciplineFixture[],
  forFixtureId?: string,
): Eligibility {
  const reasons: string[] = [];
  if (player.registrationStatus !== "confirmed") reasons.push(`Registration is ${player.registrationStatus}.`);
  if (player.eligibilityStatus !== "eligible") {
    reasons.push(player.eligibilityNote ? `Ineligible: ${player.eligibilityNote}` : "Marked ineligible by the organiser.");
  }
  let suspendedMatches = 0;
  for (const s of suspensions.filter((x) => x.playerId === player.id)) {
    const p = suspensionProgress(s, fixtures, forFixtureId);
    if (p.active) {
      suspendedMatches += p.remaining;
      reasons.push(`Suspended: ${s.reason} (${p.remaining} of ${s.matches} match${s.matches > 1 ? "es" : ""} remaining).`);
    }
  }
  return { eligible: reasons.length === 0, reasons, suspendedMatches };
}

export interface MatchAlert {
  teamId: string;
  playerId: string;
  playerName: string;
  reasons: string[];
}

/** Players in either team who must not play in the given fixture. */
export function preMatchAlerts(
  fixture: DisciplineFixture,
  players: PlayerLike[],
  suspensions: SuspensionLike[],
  fixtures: DisciplineFixture[],
): MatchAlert[] {
  const teams = [fixture.homeTeamId, fixture.awayTeamId].filter(Boolean);
  return players
    .filter((p) => p.teamId && teams.includes(p.teamId) && p.registrationStatus !== "withdrawn")
    .map((p) => ({ p, e: playerEligibility(p, suspensions, fixtures, fixture.id) }))
    .filter(({ e }) => !e.eligible)
    .map(({ p, e }) => ({ teamId: p.teamId!, playerId: p.id, playerName: p.fullName, reasons: e.reasons }));
}

/** How many more yellow cards before the configured accumulation suspension. */
export function yellowsUntilSuspension(yellowCount: number, threshold: number | null): number | null {
  if (!threshold) return null;
  return threshold - (yellowCount % threshold);
}
