export interface Pairing {
  round: number;
  home: string;
  away: string;
}

/** Number of matches in a single round robin: n × (n − 1) / 2. */
export function roundRobinMatchCount(teams: number, double = false): number {
  if (teams < 2) return 0;
  const single = (teams * (teams - 1)) / 2;
  return double ? single * 2 : single;
}

/** Rounds needed: n − 1 for even n, n for odd n (one team rests each round). */
export function roundRobinRoundCount(teams: number, double = false): number {
  if (teams < 2) return 0;
  const single = teams % 2 === 0 ? teams - 1 : teams;
  return double ? single * 2 : single;
}

/**
 * Circle-method round robin. Every team meets every other team exactly once
 * (twice with `double`, with home and away swapped). Odd team counts get a
 * rotating bye. Home/away is alternated so no team is always "home".
 */
export function roundRobin(teamIds: string[], options: { double?: boolean } = {}): Pairing[] {
  const unique = Array.from(new Set(teamIds));
  if (unique.length !== teamIds.length) {
    throw new Error("Duplicate team IDs passed to round robin generator");
  }
  if (unique.length < 2) return [];

  const slots: (string | null)[] = [...unique];
  if (slots.length % 2 === 1) slots.push(null); // bye
  const n = slots.length;
  const rounds = n - 1;
  const half = n / 2;
  const pairings: Pairing[] = [];

  let arrangement = slots;
  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < half; i++) {
      const a = arrangement[i];
      const b = arrangement[n - 1 - i];
      if (a === null || b === null) continue;
      // Rotating teams balance naturally by moving between the top (home) and
      // bottom (away) rows; only the fixed team's pairing needs alternating.
      const flip = i === 0 && r % 2 === 1;
      pairings.push({ round: r + 1, home: flip ? b : a, away: flip ? a : b });
    }
    // Keep the first slot fixed and rotate the rest clockwise.
    arrangement = [arrangement[0], arrangement[n - 1], ...arrangement.slice(1, n - 1)];
  }

  if (options.double) {
    const firstLeg = [...pairings];
    for (const p of firstLeg) {
      pairings.push({ round: p.round + rounds, home: p.away, away: p.home });
    }
  }
  return pairings;
}
