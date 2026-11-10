export type TournamentFormat =
  | "round_robin"
  | "single_elimination"
  | "double_elimination"
  | "group_knockout"
  | "league_playoff";

export type FixtureStage = "league" | "group" | "knockout";

export type Tiebreaker =
  | "goal_difference"
  | "goals_for"
  | "goals_against"
  | "wins"
  | "head_to_head"
  | "fair_play"
  | "organiser_decision"
  | "playoff";

/**
 * Participant source notation for knockout fixtures:
 *   seed:3        third seed (known when the bracket is generated)
 *   league:1      first place in the league table
 *   group:A:2     second place in group A
 *   winner:SF1    winner of fixture SF1
 *   loser:W1-2    loser of fixture W1-2
 *   bye           no opponent
 */
export type Source = string;

export interface PlannedFixture {
  code: string;
  stage: FixtureStage;
  roundNumber: number;
  roundName: string;
  groupLabel: string | null;
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeSource: Source | null;
  awaySource: Source | null;
  /** Codes of fixtures that must finish before this one can start. */
  dependsOn: string[];
  /** True when the fixture can only start after the league / group phase ends. */
  afterGroupPhase: boolean;
}

export interface PlanTeam {
  id: string;
  name?: string;
  seed?: number | null;
  groupLabel?: string | null;
}

export interface FormatOptions {
  format: TournamentFormat;
  doubleRoundRobin?: boolean;
  qualifiers?: number | null;
  thirdPlaceMatch?: boolean;
  groupCount?: number | null;
  qualifiersPerGroup?: number | null;
}
