import type { Tiebreaker } from "./types";

export interface StandingsTeam {
  id: string;
  name: string;
}

export interface ResultFixture {
  id: string;
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeScore: number;
  awayScore: number;
  status: string;
}

export interface TiebreakDecision {
  orderedTeamIds: string[];
  createdAt?: string;
}

export interface StandingsOptions {
  pointsWin: number;
  pointsDraw: number;
  pointsLoss: number;
  tiebreakers: Tiebreaker[];
  /** Unconfirmed tie-breakers are never applied: ties on points stay unresolved. */
  tiebreakersConfirmed: boolean;
  /** Fair-play penalty points per team (lower is better). */
  fairPlay?: Record<string, number>;
  decisions?: TiebreakDecision[];
  /** Preview only: also count matches in progress or awaiting confirmation. Never used for official standings. */
  includeProvisional?: boolean;
}

const PROVISIONAL = new Set(["confirmed", "completed", "in_progress", "paused"]);

export interface StandingRow {
  teamId: string;
  name: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  fairPlay: number;
  position: number;
  /** True when this team shares its position because a tie could not be broken. */
  shared: boolean;
  tiedWith: string[];
  /** The criterion that separated this team from the team directly below, if any. */
  separatedBy: string | null;
}

export interface StandingsResult {
  rows: StandingRow[];
  unresolvedTies: string[][];
  notes: string[];
}

export const TIEBREAKER_LABELS: Record<Tiebreaker | "points", string> = {
  points: "Points",
  goal_difference: "Goal difference",
  goals_for: "Goals scored",
  goals_against: "Fewest goals conceded",
  wins: "Number of wins",
  head_to_head: "Head-to-head",
  fair_play: "Fair-play points",
  organiser_decision: "Organiser decision",
  playoff: "Play-off match",
};

type Row = Omit<StandingRow, "position" | "shared" | "tiedWith" | "separatedBy">;

function tabulate(teamIds: string[], fixtures: ResultFixture[], opts: StandingsOptions, names: Map<string, string>) {
  const rows = new Map<string, Row>();
  for (const id of teamIds) {
    rows.set(id, {
      teamId: id,
      name: names.get(id) ?? id,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDifference: 0,
      points: 0,
      fairPlay: opts.fairPlay?.[id] ?? 0,
    });
  }
  for (const f of fixtures) {
    const counted = opts.includeProvisional ? PROVISIONAL.has(f.status) : f.status === "confirmed";
    if (!counted || !f.homeTeamId || !f.awayTeamId) continue;
    const home = rows.get(f.homeTeamId);
    const away = rows.get(f.awayTeamId);
    if (!home || !away) continue;
    home.played++;
    away.played++;
    home.goalsFor += f.homeScore;
    home.goalsAgainst += f.awayScore;
    away.goalsFor += f.awayScore;
    away.goalsAgainst += f.homeScore;
    if (f.homeScore > f.awayScore) {
      home.won++;
      away.lost++;
      home.points += opts.pointsWin;
      away.points += opts.pointsLoss;
    } else if (f.homeScore < f.awayScore) {
      away.won++;
      home.lost++;
      away.points += opts.pointsWin;
      home.points += opts.pointsLoss;
    } else {
      home.drawn++;
      away.drawn++;
      home.points += opts.pointsDraw;
      away.points += opts.pointsDraw;
    }
  }
  for (const r of rows.values()) r.goalDifference = r.goalsFor - r.goalsAgainst;
  return rows;
}

/** Partition ids into groups with equal key, ordered best-first. */
function partition(ids: string[], key: (id: string) => number[]): string[][] {
  const sorted = [...ids].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return kb[i] - ka[i];
    return 0;
  });
  const groups: string[][] = [];
  for (const id of sorted) {
    const last = groups[groups.length - 1];
    if (last && key(last[0]).every((v, i) => v === key(id)[i])) last.push(id);
    else groups.push([id]);
  }
  return groups;
}

/**
 * League table with organiser-configured points and tie-breakers.
 * Ties that the configured criteria cannot break are reported, never
 * silently ordered.
 */
export function computeStandings(
  teams: StandingsTeam[],
  fixtures: ResultFixture[],
  opts: StandingsOptions,
): StandingsResult {
  const names = new Map(teams.map((t) => [t.id, t.name]));
  const ids = teams.map((t) => t.id);
  const table = tabulate(ids, fixtures, opts, names);
  const criteria: Tiebreaker[] = opts.tiebreakersConfirmed ? opts.tiebreakers : [];
  const notes: string[] = [];
  if (!opts.tiebreakersConfirmed && opts.tiebreakers.length) {
    notes.push("Tie-breakers have not been confirmed, so teams level on points share a position.");
  }
  const separatedBy = new Map<string, string>();

  const valueOf = (c: Tiebreaker, id: string): number[] | null => {
    const r = table.get(id)!;
    switch (c) {
      case "goal_difference":
        return [r.goalDifference];
      case "goals_for":
        return [r.goalsFor];
      case "goals_against":
        return [-r.goalsAgainst];
      case "wins":
        return [r.won];
      case "fair_play":
        return [-r.fairPlay];
      default:
        return null;
    }
  };

  const rank = (group: string[], idx: number): string[][] => {
    if (group.length <= 1) return [group];
    if (idx >= criteria.length) return [group];
    const c = criteria[idx];

    if (c === "head_to_head") {
      const mini = tabulate(
        group,
        fixtures.filter((f) => group.includes(f.homeTeamId ?? "") && group.includes(f.awayTeamId ?? "")),
        opts,
        names,
      );
      const parts = partition(group, (id) => {
        const r = mini.get(id)!;
        return [r.points, r.goalDifference, r.goalsFor];
      });
      if (parts.length === 1) return rank(group, idx + 1);
      return parts.flatMap((p, i) => {
        if (i < parts.length - 1) separatedBy.set(p[p.length - 1], TIEBREAKER_LABELS.head_to_head);
        // Re-apply head-to-head among a smaller tied subset, then continue down the list.
        return p.length > 1 ? rank(p, p.length < group.length ? idx : idx + 1) : [p];
      });
    }

    if (c === "organiser_decision") {
      const decision = [...(opts.decisions ?? [])]
        .reverse()
        .find((d) => group.every((id) => d.orderedTeamIds.includes(id)));
      if (!decision) return rank(group, idx + 1);
      const ordered = [...group].sort(
        (a, b) => decision.orderedTeamIds.indexOf(a) - decision.orderedTeamIds.indexOf(b),
      );
      ordered.slice(0, -1).forEach((id) => separatedBy.set(id, TIEBREAKER_LABELS.organiser_decision));
      return ordered.map((id) => [id]);
    }

    if (c === "playoff") {
      notes.push("A play-off match is required to separate some teams.");
      return rank(group, idx + 1);
    }

    const parts = partition(group, (id) => valueOf(c, id) ?? [0]);
    if (parts.length === 1) return rank(group, idx + 1);
    return parts.flatMap((p, i) => {
      if (i < parts.length - 1) separatedBy.set(p[p.length - 1], TIEBREAKER_LABELS[c]);
      return rank(p, idx + 1);
    });
  };

  const pointGroups = partition(ids, (id) => [table.get(id)!.points]);
  pointGroups.slice(0, -1).forEach((g) => separatedBy.set(g[g.length - 1], TIEBREAKER_LABELS.points));
  const ordered = pointGroups.flatMap((g) => rank(g, 0));

  const rows: StandingRow[] = [];
  const unresolvedTies: string[][] = [];
  let position = 1;
  for (const group of ordered) {
    const display = [...group].sort((a, b) => names.get(a)!.localeCompare(names.get(b)!));
    if (group.length > 1) unresolvedTies.push(display);
    for (const id of display) {
      rows.push({
        ...table.get(id)!,
        position,
        shared: group.length > 1,
        tiedWith: group.filter((g) => g !== id),
        separatedBy: group.length === 1 ? separatedBy.get(id) ?? null : null,
      });
    }
    position += group.length;
  }
  // Ties between teams that have not played yet are expected, not a problem.
  const meaningful = unresolvedTies.filter((t) => t.some((id) => table.get(id)!.played > 0));
  return { rows, unresolvedTies: meaningful, notes: Array.from(new Set(notes)) };
}

/** Fair-play penalty points per team from card counts. */
export function fairPlayPoints(
  cards: { teamId: string; type: "yellow" | "red" }[],
  weights: { yellow: number; red: number },
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of cards) out[c.teamId] = (out[c.teamId] ?? 0) + (c.type === "yellow" ? weights.yellow : weights.red);
  return out;
}
