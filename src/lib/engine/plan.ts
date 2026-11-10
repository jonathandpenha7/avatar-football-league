import { doubleElimination, groupKnockoutBracket, singleElimination } from "./bracket";
import { roundRobin } from "./round-robin";
import type { FormatOptions, PlanTeam, PlannedFixture } from "./types";

export interface TournamentPlan {
  fixtures: PlannedFixture[];
  errors: string[];
  warnings: string[];
}

const GROUP_LETTERS = "ABCDEFGHIJKLMNOP".split("");

/** Sort teams by seed (unseeded last), then by name, for deterministic plans. */
export function seededOrder(teams: PlanTeam[]): PlanTeam[] {
  return [...teams].sort((a, b) => {
    const sa = a.seed ?? Number.MAX_SAFE_INTEGER;
    const sb = b.seed ?? Number.MAX_SAFE_INTEGER;
    if (sa !== sb) return sa - sb;
    return (a.name ?? a.id).localeCompare(b.name ?? b.id);
  });
}

/** Snake-distribute teams into groups by seed: A B C C B A A B C … */
export function assignGroups(teams: PlanTeam[], groupCount: number): Map<string, string> {
  const result = new Map<string, string>();
  const ordered = seededOrder(teams);
  ordered.forEach((team, i) => {
    const row = Math.floor(i / groupCount);
    const col = i % groupCount;
    const idx = row % 2 === 0 ? col : groupCount - 1 - col;
    result.set(team.id, GROUP_LETTERS[idx]);
  });
  return result;
}

function leagueFixtures(
  teams: PlanTeam[],
  stage: "league" | "group",
  double: boolean,
  groupLabel: string | null,
  codePrefix: string,
): PlannedFixture[] {
  const ids = seededOrder(teams).map((t) => t.id);
  return roundRobin(ids, { double }).map((p, i) => ({
    code: `${codePrefix}${i + 1}`,
    stage,
    roundNumber: p.round,
    roundName: groupLabel ? `Group ${groupLabel} · Round ${p.round}` : `Round ${p.round}`,
    groupLabel,
    homeTeamId: p.home,
    awayTeamId: p.away,
    homeSource: null,
    awaySource: null,
    dependsOn: [],
    afterGroupPhase: false,
  }));
}

/** Resolve `seed:N` sources to concrete team IDs. */
function resolveSeeds(fixtures: PlannedFixture[], seeds: PlanTeam[]): PlannedFixture[] {
  const lookup = (s: string | null) => {
    const m = s ? /^seed:(\d+)$/.exec(s) : null;
    return m ? seeds[Number(m[1]) - 1]?.id ?? null : null;
  };
  return fixtures.map((f) => ({
    ...f,
    homeTeamId: f.homeTeamId ?? lookup(f.homeSource),
    awayTeamId: f.awayTeamId ?? lookup(f.awaySource),
  }));
}

/** Build the full fixture plan for a tournament format. Pure and deterministic. */
export function planTournament(teams: PlanTeam[], options: FormatOptions): TournamentPlan {
  const errors: string[] = [];
  const warnings: string[] = [];
  const n = teams.length;
  if (n < 2) {
    return { fixtures: [], errors: ["Add at least two teams before generating fixtures."], warnings };
  }

  switch (options.format) {
    case "round_robin":
      return { fixtures: leagueFixtures(teams, "league", !!options.doubleRoundRobin, null, "L"), errors, warnings };

    case "league_playoff": {
      const q = options.qualifiers ?? 0;
      if (q < 2) errors.push("Set how many teams qualify for the play-offs (at least 2).");
      if (q > n) errors.push(`${q} qualifiers is more than the ${n} teams entered.`);
      if (errors.length) return { fixtures: [], errors, warnings };
      if ((q & (q - 1)) !== 0) warnings.push(`${q} qualifiers is not a power of two, so the top seeds receive byes.`);
      const league = leagueFixtures(teams, "league", !!options.doubleRoundRobin, null, "L");
      const entrants = Array.from({ length: q }, (_, i) => `league:${i + 1}`);
      const knockout = singleElimination(entrants, { thirdPlaceMatch: options.thirdPlaceMatch });
      return { fixtures: [...league, ...knockout], errors, warnings };
    }

    case "single_elimination": {
      const seeds = seededOrder(teams);
      const entrants = seeds.map((_, i) => `seed:${i + 1}`);
      const knockout = singleElimination(entrants, { thirdPlaceMatch: options.thirdPlaceMatch });
      if ((n & (n - 1)) !== 0) warnings.push(`${n} teams is not a power of two, so the top seeds receive byes.`);
      return { fixtures: resolveSeeds(knockout, seeds), errors, warnings };
    }

    case "double_elimination": {
      if (n < 3) errors.push("Double elimination needs at least three teams.");
      if (errors.length) return { fixtures: [], errors, warnings };
      const seeds = seededOrder(teams);
      const entrants = seeds.map((_, i) => `seed:${i + 1}`);
      if ((n & (n - 1)) !== 0) warnings.push(`${n} teams is not a power of two, so the top seeds receive byes.`);
      warnings.push("The grand final is a single match (no bracket reset).");
      return { fixtures: resolveSeeds(doubleElimination(entrants), seeds), errors, warnings };
    }

    case "group_knockout": {
      const g = options.groupCount ?? 0;
      const perGroup = options.qualifiersPerGroup ?? 0;
      if (g < 2) errors.push("Set the number of groups (at least 2).");
      if (perGroup < 1) errors.push("Set how many teams qualify from each group.");
      const missing = teams.filter((t) => !t.groupLabel);
      if (missing.length) errors.push(`${missing.length} team(s) have no group. Assign groups first.`);
      if (errors.length) return { fixtures: [], errors, warnings };

      const byGroup = new Map<string, PlanTeam[]>();
      for (const t of teams) {
        const list = byGroup.get(t.groupLabel!) ?? [];
        list.push(t);
        byGroup.set(t.groupLabel!, list);
      }
      const labels = [...byGroup.keys()].sort();
      if (labels.length !== g) warnings.push(`Teams are spread across ${labels.length} groups, not ${g}.`);
      for (const label of labels) {
        const size = byGroup.get(label)!.length;
        if (size < 2) errors.push(`Group ${label} needs at least two teams.`);
        if (size < perGroup) errors.push(`Group ${label} has fewer teams than qualifiers per group.`);
      }
      if (errors.length) return { fixtures: [], errors, warnings };
      const sizes = labels.map((l) => byGroup.get(l)!.length);
      if (Math.max(...sizes) - Math.min(...sizes) > 1) warnings.push("Group sizes are uneven by more than one team.");

      const groupFixtures = labels.flatMap((label) =>
        leagueFixtures(byGroup.get(label)!, "group", !!options.doubleRoundRobin, label, `G${label}-`),
      );
      const knockout = groupKnockoutBracket(labels, perGroup, { thirdPlaceMatch: options.thirdPlaceMatch });
      return { fixtures: [...groupFixtures, ...knockout], errors, warnings };
    }
  }
}

export function isTableSource(source: string | null): boolean {
  return !!source && /^(league|group):/.test(source);
}

export function describeSource(source: string | null, teamName?: (id: string) => string | undefined): string {
  if (!source) return "TBD";
  let m = /^league:(\d+)$/.exec(source);
  if (m) return `League ${ordinal(Number(m[1]))}`;
  m = /^group:([A-Z]):(\d+)$/.exec(source);
  if (m) return `Group ${m[1]} ${ordinal(Number(m[2]))}`;
  m = /^seed:(\d+)$/.exec(source);
  if (m) return `Seed ${m[1]}`;
  m = /^winner:(.+)$/.exec(source);
  if (m) return `Winner ${m[1]}`;
  m = /^loser:(.+)$/.exec(source);
  if (m) return `Loser ${m[1]}`;
  void teamName;
  return source;
}

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
