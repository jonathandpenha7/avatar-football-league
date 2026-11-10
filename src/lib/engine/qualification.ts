import { ordinal } from "./plan";
import type { StandingsResult } from "./standings";

export interface QualificationInput {
  /** Standings for the league, or for one group. */
  standings: StandingsResult;
  qualifiers: number;
  /** All league/group fixtures confirmed. */
  complete: boolean;
  /** Organiser explicitly asked for provisional seeding and the tournament allows it. */
  provisional?: boolean;
  /** Source prefix, e.g. "league" or "group:A". */
  sourcePrefix: string;
  label?: string;
}

export interface QualificationResult {
  ready: boolean;
  provisional: boolean;
  assignments: { source: string; teamId: string; position: number }[];
  blockers: string[];
}

/**
 * Decide who qualifies, and in which seed, only when the criteria are met:
 * every match played (unless provisional seeding is explicitly requested)
 * and no unresolved tie that affects a qualifying position or seed.
 */
export function evaluateQualification(input: QualificationInput): QualificationResult {
  const blockers: string[] = [];
  const label = input.label ?? "League";
  const rows = input.standings.rows;
  if (rows.length < input.qualifiers) {
    blockers.push(`${label} has ${rows.length} teams but ${input.qualifiers} must qualify.`);
  }
  if (!input.complete && !input.provisional) {
    blockers.push(`${label} matches are not all confirmed yet.`);
  }
  // A tie matters if it touches any qualifying position (seeding order matters too).
  for (const row of rows) {
    if (row.shared && row.position <= input.qualifiers) {
      const tied = [row.teamId, ...row.tiedWith];
      const names = tied.map((id) => rows.find((r) => r.teamId === id)?.name ?? id).sort();
      const msg = `${label}: ${names.join(", ")} are tied for ${ordinal(row.position)} place and the configured tie-breakers cannot separate them. Record an organiser decision or confirm the tie-breaker order.`;
      if (!blockers.includes(msg)) blockers.push(msg);
    }
  }
  const ready = blockers.length === 0;
  return {
    ready,
    provisional: ready && !input.complete,
    assignments: ready
      ? rows
          .filter((r) => r.position <= input.qualifiers)
          .map((r) => ({ source: `${input.sourcePrefix}:${r.position}`, teamId: r.teamId, position: r.position }))
      : [],
    blockers,
  };
}
