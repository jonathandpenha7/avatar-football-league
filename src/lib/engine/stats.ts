export interface StatEvent {
  fixtureId: string;
  eventType: string;
  teamId: string | null;
  playerId: string | null;
  assistPlayerId?: string | null;
  relatedPlayerId?: string | null;
}

export interface StatFixture {
  id: string;
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeScore: number;
  awayScore: number;
  status: string;
  stage?: string;
  code?: string;
  decidedBy?: string | null;
  homePenalties?: number | null;
  awayPenalties?: number | null;
}

export interface StatParticipant {
  fixtureId: string;
  playerId: string;
}

export interface PlayerStat {
  playerId: string;
  matchesPlayed: number;
  /** Credited goals: normal goals plus penalty goals in normal play. Never own goals or shootout kicks. */
  goals: number;
  penaltyGoals: number;
  ownGoals: number;
  assists: number;
  yellow: number;
  red: number;
  fouls: number;
  timePenalties: number;
  subbedOn: number;
  subbedOff: number;
}

export interface TeamMatchLine {
  fixtureId: string;
  code: string | undefined;
  opponentId: string | null;
  goalsFor: number;
  goalsAgainst: number;
  result: "W" | "D" | "L";
  penalties: string | null;
}

export interface TeamStat {
  teamId: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  cleanSheets: number;
  penaltyGoals: number;
  yellow: number;
  red: number;
  fouls: number;
  timePenalties: number;
  matches: TeamMatchLine[];
}

/** Goal types that count for a player and as a team goal in normal play. */
export const CREDITED_GOALS = new Set(["goal", "penalty_goal"]);

/**
 * Team and player statistics from confirmed matches only. Scores come from the
 * stored (event-derived) match score, so goals for/against always reconcile with
 * results: an own goal counts for the opponent, shootout kicks never count.
 */
export function computeStats(fixtures: StatFixture[], events: StatEvent[], participants: StatParticipant[] = []) {
  const confirmed = fixtures.filter((f) => f.status === "confirmed");
  const confirmedIds = new Set(confirmed.map((f) => f.id));
  const players = new Map<string, PlayerStat>();
  const teams = new Map<string, TeamStat>();
  const player = (id: string) => {
    if (!players.has(id)) {
      players.set(id, {
        playerId: id, matchesPlayed: 0, goals: 0, penaltyGoals: 0, ownGoals: 0, assists: 0,
        yellow: 0, red: 0, fouls: 0, timePenalties: 0, subbedOn: 0, subbedOff: 0,
      });
    }
    return players.get(id)!;
  };
  const team = (id: string) => {
    if (!teams.has(id)) {
      teams.set(id, {
        teamId: id, played: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0, goalDifference: 0,
        cleanSheets: 0, penaltyGoals: 0, yellow: 0, red: 0, fouls: 0, timePenalties: 0, matches: [],
      });
    }
    return teams.get(id)!;
  };

  for (const f of confirmed) {
    if (!f.homeTeamId || !f.awayTeamId) continue;
    const sides: [string, string, number, number, number | null | undefined, number | null | undefined][] = [
      [f.homeTeamId, f.awayTeamId, f.homeScore, f.awayScore, f.homePenalties, f.awayPenalties],
      [f.awayTeamId, f.homeTeamId, f.awayScore, f.homeScore, f.awayPenalties, f.homePenalties],
    ];
    for (const [id, opp, gf, ga, pf, pa] of sides) {
      const t = team(id);
      t.played++;
      t.goalsFor += gf;
      t.goalsAgainst += ga;
      if (ga === 0) t.cleanSheets++;
      const result = gf > ga ? "W" : gf < ga ? "L" : "D";
      if (result === "W") t.wins++;
      else if (result === "L") t.losses++;
      else t.draws++;
      t.matches.push({
        fixtureId: f.id, code: f.code, opponentId: opp, goalsFor: gf, goalsAgainst: ga, result,
        penalties: pf !== null && pf !== undefined && pa !== null && pa !== undefined ? `${pf}–${pa}` : null,
      });
    }
  }
  for (const t of teams.values()) t.goalDifference = t.goalsFor - t.goalsAgainst;

  for (const p of participants) if (confirmedIds.has(p.fixtureId)) player(p.playerId).matchesPlayed++;

  for (const e of events) {
    if (!confirmedIds.has(e.fixtureId)) continue;
    if (e.playerId) {
      const p = player(e.playerId);
      if (CREDITED_GOALS.has(e.eventType)) p.goals++;
      if (e.eventType === "penalty_goal") p.penaltyGoals++;
      if (e.eventType === "own_goal") p.ownGoals++;
      if (e.eventType === "yellow_card") p.yellow++;
      if (e.eventType === "red_card") p.red++;
      if (e.eventType === "foul") p.fouls++;
      if (e.eventType === "sin_bin") p.timePenalties++;
      if (e.eventType === "substitution") p.subbedOn++;
    }
    if (e.eventType === "substitution" && e.relatedPlayerId) player(e.relatedPlayerId).subbedOff++;
    if (e.assistPlayerId && CREDITED_GOALS.has(e.eventType)) player(e.assistPlayerId).assists++;
    if (e.teamId) {
      const t = team(e.teamId);
      if (e.eventType === "yellow_card") t.yellow++;
      if (e.eventType === "red_card") t.red++;
      if (e.eventType === "foul") t.fouls++;
      if (e.eventType === "sin_bin") t.timePenalties++;
      if (e.eventType === "penalty_goal") t.penaltyGoals++;
    }
  }

  const totalGoals = confirmed.reduce((s, f) => s + f.homeScore + f.awayScore, 0);
  const playerList = [...players.values()];
  return {
    players: playerList,
    teams: [...teams.values()],
    matchesPlayed: confirmed.length,
    totalGoals,
    goalsPerMatch: confirmed.length ? totalGoals / confirmed.length : 0,
    topScorers: playerList.filter((p) => p.goals > 0).sort((a, b) => b.goals - a.goals || b.penaltyGoals - a.penaltyGoals),
    mostGoals: mostGoals(playerList),
  };
}

/** The Most Goals award: every player on the highest credited goal total (ties included). */
export function mostGoals(players: PlayerStat[]): { goals: number; playerIds: string[] } {
  const best = Math.max(0, ...players.map((p) => p.goals));
  return best === 0 ? { goals: 0, playerIds: [] } : { goals: best, playerIds: players.filter((p) => p.goals === best).map((p) => p.playerId) };
}

/** Champion, runner-up and third place from confirmed knockout fixtures (final 'F' / 'GF', third place 'P3'). */
export function finalPlacings(fixtures: StatFixture[]) {
  const final = fixtures.find((f) => f.code === "F" || f.code === "GF");
  const third = fixtures.find((f) => f.code === "P3");
  const winnerOf = (f: StatFixture | undefined) => {
    if (!f || f.status !== "confirmed" || !f.homeTeamId || !f.awayTeamId) return null;
    if (f.homeScore !== f.awayScore) return f.homeScore > f.awayScore ? f.homeTeamId : f.awayTeamId;
    if (f.homePenalties != null && f.awayPenalties != null && f.homePenalties !== f.awayPenalties) {
      return f.homePenalties > f.awayPenalties ? f.homeTeamId : f.awayTeamId;
    }
    return null;
  };
  const champion = winnerOf(final);
  const thirdPlace = winnerOf(third);
  return {
    finalConfirmed: !!final && final.status === "confirmed",
    champion,
    runnerUp: champion && final ? (champion === final.homeTeamId ? final.awayTeamId : final.homeTeamId) : null,
    thirdPlace,
  };
}
