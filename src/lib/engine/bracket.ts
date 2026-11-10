import type { PlannedFixture, Source } from "./types";

export const BYE = "bye";

export function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/**
 * Standard bracket seed order so that seed 1 and seed 2 can only meet in the
 * final, e.g. size 8 → [1, 8, 4, 5, 2, 7, 3, 6].
 */
export function standardSeedOrder(size: number): number[] {
  if (size < 2 || (size & (size - 1)) !== 0) {
    throw new Error("Bracket size must be a power of two");
  }
  let order = [1, 2];
  while (order.length < size) {
    const sum = order.length * 2 + 1;
    order = order.flatMap((s) => [s, sum - s]);
  }
  return order;
}

export function knockoutRoundName(matchesInRound: number): string {
  if (matchesInRound === 1) return "Final";
  if (matchesInRound === 2) return "Semi-final";
  if (matchesInRound === 4) return "Quarter-final";
  return `Round of ${matchesInRound * 2}`;
}

function roundCodePrefix(matchesInRound: number): string {
  if (matchesInRound === 1) return "F";
  if (matchesInRound === 2) return "SF";
  if (matchesInRound === 4) return "QF";
  return `R${matchesInRound * 2}-`;
}

function node(
  code: string,
  roundNumber: number,
  roundName: string,
  home: Source,
  away: Source,
): PlannedFixture {
  return {
    code,
    stage: "knockout",
    roundNumber,
    roundName,
    groupLabel: null,
    homeTeamId: null,
    awayTeamId: null,
    homeSource: home,
    awaySource: away,
    dependsOn: [],
    afterGroupPhase: false,
  };
}

function fixtureRef(source: Source | null): string | null {
  if (!source) return null;
  const m = /^(winner|loser):(.+)$/.exec(source);
  return m ? m[2] : null;
}

/** Fill `dependsOn` and `afterGroupPhase` from the sources. */
export function annotateDependencies(fixtures: PlannedFixture[]): PlannedFixture[] {
  return fixtures.map((f) => {
    const deps = [fixtureRef(f.homeSource), fixtureRef(f.awaySource)].filter((d): d is string => !!d);
    const fromTable = [f.homeSource, f.awaySource].some((s) => !!s && /^(league|group):/.test(s));
    return { ...f, dependsOn: Array.from(new Set(deps)), afterGroupPhase: fromTable };
  });
}

/**
 * Remove matches that contain a bye. Their winner is the other participant
 * and their loser is a bye, which may cascade (e.g. into a losers bracket).
 */
export function collapseByes(fixtures: PlannedFixture[]): PlannedFixture[] {
  let list = fixtures.map((f) => ({ ...f }));
  let changed = true;
  while (changed) {
    changed = false;
    const target = list.find((f) => f.homeSource === BYE || f.awaySource === BYE);
    if (!target) break;
    const winner = target.homeSource === BYE ? target.awaySource : target.homeSource;
    const replace = (s: Source | null): Source | null => {
      if (s === `winner:${target.code}`) return winner;
      if (s === `loser:${target.code}`) return BYE;
      return s;
    };
    list = list
      .filter((f) => f.code !== target.code)
      .map((f) => ({ ...f, homeSource: replace(f.homeSource), awaySource: replace(f.awaySource) }));
    changed = true;
  }
  return list;
}

/**
 * Single-elimination bracket. `entrants` are sources in seed order
 * (index 0 = top seed). Non-power-of-two fields give byes to the top seeds.
 */
export function singleElimination(
  entrants: Source[],
  options: { thirdPlaceMatch?: boolean; firstRoundPairs?: [Source, Source][] } = {},
): PlannedFixture[] {
  if (!options.firstRoundPairs && entrants.length < 2) return [];
  const fixtures: PlannedFixture[] = [];

  let firstRound: [Source, Source][];
  if (options.firstRoundPairs) {
    firstRound = options.firstRoundPairs;
  } else {
    const size = nextPowerOfTwo(entrants.length);
    const order = standardSeedOrder(size);
    firstRound = [];
    for (let i = 0; i < order.length; i += 2) {
      const a = entrants[order[i] - 1] ?? BYE;
      const b = entrants[order[i + 1] - 1] ?? BYE;
      firstRound.push([a, b]);
    }
  }

  const totalRounds = Math.log2(firstRound.length * 2);
  if (!Number.isInteger(totalRounds)) throw new Error("First round must have a power-of-two match count");

  let previousCodes: string[] = [];
  let matches = firstRound.length;
  for (let r = 1; r <= totalRounds; r++) {
    const prefix = roundCodePrefix(matches);
    const name = knockoutRoundName(matches);
    const codes: string[] = [];
    for (let i = 0; i < matches; i++) {
      const code = matches === 1 ? "F" : `${prefix}${i + 1}`;
      codes.push(code);
      const home = r === 1 ? firstRound[i][0] : `winner:${previousCodes[i * 2]}`;
      const away = r === 1 ? firstRound[i][1] : `winner:${previousCodes[i * 2 + 1]}`;
      fixtures.push(node(code, r, name, home, away));
    }
    if (matches === 2 && options.thirdPlaceMatch) {
      fixtures.push(node("P3", r + 1, "Third-place play-off", `loser:${codes[0]}`, `loser:${codes[1]}`));
    }
    previousCodes = codes;
    matches /= 2;
  }
  return annotateDependencies(collapseByes(fixtures));
}

/**
 * Double elimination: winners bracket, losers bracket and a single grand
 * final (no bracket reset). Byes are resolved statically.
 */
export function doubleElimination(entrants: Source[]): PlannedFixture[] {
  if (entrants.length < 3) return singleElimination(entrants);
  const size = nextPowerOfTwo(entrants.length);
  const k = Math.log2(size);
  const order = standardSeedOrder(size);
  const fixtures: PlannedFixture[] = [];
  const wb: string[][] = [];

  // Winners bracket
  for (let r = 1; r <= k; r++) {
    const matches = size / 2 ** r;
    const codes: string[] = [];
    for (let i = 0; i < matches; i++) {
      const code = `W${r}-${i + 1}`;
      codes.push(code);
      const home = r === 1 ? entrants[order[i * 2] - 1] ?? BYE : `winner:${wb[r - 2][i * 2]}`;
      const away = r === 1 ? entrants[order[i * 2 + 1] - 1] ?? BYE : `winner:${wb[r - 2][i * 2 + 1]}`;
      const name = r === k ? "Winners final" : `Winners round ${r}`;
      fixtures.push(node(code, r, name, home, away));
    }
    wb.push(codes);
  }

  // Losers bracket: 2(k − 1) rounds alternating "pairing" and "drop-in" rounds.
  const lbRounds = 2 * (k - 1);
  const lb: string[][] = [];
  for (let lr = 1; lr <= lbRounds; lr++) {
    const codes: string[] = [];
    const name = lr === lbRounds ? "Losers final" : `Losers round ${lr}`;
    if (lr === 1) {
      const m = size / 4;
      for (let i = 0; i < m; i++) {
        const code = `L1-${i + 1}`;
        codes.push(code);
        fixtures.push(node(code, k + lr, name, `loser:${wb[0][i * 2]}`, `loser:${wb[0][i * 2 + 1]}`));
      }
    } else if (lr % 2 === 0) {
      // Drop-in: winners of previous LB round meet losers from WB round (lr/2 + 1),
      // in reverse order to delay rematches.
      const wbRound = wb[lr / 2];
      const prev = lb[lr - 2];
      const m = prev.length;
      for (let i = 0; i < m; i++) {
        const code = `L${lr}-${i + 1}`;
        codes.push(code);
        fixtures.push(node(code, k + lr, name, `winner:${prev[i]}`, `loser:${wbRound[m - 1 - i]}`));
      }
    } else {
      const prev = lb[lr - 2];
      for (let i = 0; i < prev.length / 2; i++) {
        const code = `L${lr}-${i + 1}`;
        codes.push(code);
        fixtures.push(node(code, k + lr, name, `winner:${prev[i * 2]}`, `winner:${prev[i * 2 + 1]}`));
      }
    }
    lb.push(codes);
  }

  fixtures.push(
    node("GF", k + lbRounds + 1, "Grand final", `winner:${wb[k - 1][0]}`, `winner:${lb[lbRounds - 1][0]}`),
  );
  return annotateDependencies(collapseByes(fixtures));
}

/**
 * Knockout entrants from group positions. With two qualifiers per group and an
 * even number of groups, winners meet runners-up of the paired group
 * (A1–B2, B1–A2 …) and group winners from paired groups are placed in
 * opposite halves of the bracket.
 */
export function groupKnockoutBracket(
  groupLabels: string[],
  qualifiersPerGroup: number,
  options: { thirdPlaceMatch?: boolean } = {},
): PlannedFixture[] {
  const groups = [...groupLabels].sort();
  if (qualifiersPerGroup === 2 && groups.length % 2 === 0 && groups.length >= 2) {
    const topHalf: [Source, Source][] = [];
    const bottomHalf: [Source, Source][] = [];
    for (let i = 0; i < groups.length; i += 2) {
      const a = groups[i];
      const b = groups[i + 1];
      topHalf.push([`group:${a}:1`, `group:${b}:2`]);
      bottomHalf.push([`group:${b}:1`, `group:${a}:2`]);
    }
    const pairs = [...topHalf, ...bottomHalf];
    if (Number.isInteger(Math.log2(pairs.length * 2))) {
      return singleElimination([], { ...options, firstRoundPairs: pairs });
    }
  }
  // General case: tier-major seeding (all group winners, then runners-up …).
  const entrants: Source[] = [];
  for (let tier = 1; tier <= qualifiersPerGroup; tier++) {
    const ordered = tier % 2 === 1 ? groups : [...groups].reverse();
    for (const g of ordered) entrants.push(`group:${g}:${tier}`);
  }
  return avoidSameGroupFirstRound(singleElimination(entrants, options));
}

function groupOf(source: Source | null): string | null {
  const m = source ? /^group:([A-Z]):/.exec(source) : null;
  return m ? m[1] : null;
}

/** Swap lower-tier entrants between first-round matches to avoid same-group pairings where possible. */
function avoidSameGroupFirstRound(fixtures: PlannedFixture[]): PlannedFixture[] {
  const list = fixtures.map((f) => ({ ...f }));
  const firstRound = list.filter(
    (f) => groupOf(f.homeSource) !== null && groupOf(f.awaySource) !== null,
  );
  for (const f of firstRound) {
    if (groupOf(f.homeSource) !== groupOf(f.awaySource)) continue;
    const swapWith = firstRound.find(
      (o) =>
        o !== f &&
        groupOf(o.awaySource) !== groupOf(f.homeSource) &&
        groupOf(f.awaySource) !== groupOf(o.homeSource),
    );
    if (swapWith) {
      const tmp = f.awaySource;
      f.awaySource = swapWith.awaySource;
      swapWith.awaySource = tmp;
    }
  }
  return list;
}
