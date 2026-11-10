export interface StatEvent {
  fixtureId: string;
  eventType: string;
  teamId: string | null;
  playerId: string | null;
  assistPlayerId?: string | null;
}

export interface StatFixture {
  id: string;
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeScore: number;
  awayScore: number;
  status: string;
}

export interface PlayerStat {
  playerId: string;
  goals: number;
  penaltyGoals: number;
  ownGoals: number;
  assists: number;
  yellow: number;
  red: number;
  fouls: number;
}

export interface TeamStat {
  teamId: string;
  played: number;
  goalsFor: number;
  goalsAgainst: number;
  cleanSheets: number;
  yellow: number;
  red: number;
  fouls: number;
  wins: number;
  draws: number;
  losses: number;
}

const GOALS = new Set(["goal", "penalty_goal"]);

/** Player and team statistics from confirmed matches only. */
export function computeStats(fixtures: StatFixture[], events: StatEvent[]) {
  const confirmed = fixtures.filter((f) => f.status === "confirmed");
  const confirmedIds = new Set(confirmed.map((f) => f.id));
  const players = new Map<string, PlayerStat>();
  const teams = new Map<string, TeamStat>();
  const player = (id: string) => {
    if (!players.has(id)) {
      players.set(id, { playerId: id, goals: 0, penaltyGoals: 0, ownGoals: 0, assists: 0, yellow: 0, red: 0, fouls: 0 });
    }
    return players.get(id)!;
  };
  const team = (id: string) => {
    if (!teams.has(id)) {
      teams.set(id, {
        teamId: id, played: 0, goalsFor: 0, goalsAgainst: 0, cleanSheets: 0,
        yellow: 0, red: 0, fouls: 0, wins: 0, draws: 0, losses: 0,
      });
    }
    return teams.get(id)!;
  };

  for (const f of confirmed) {
    if (!f.homeTeamId || !f.awayTeamId) continue;
    const h = team(f.homeTeamId);
    const a = team(f.awayTeamId);
    h.played++;
    a.played++;
    h.goalsFor += f.homeScore;
    h.goalsAgainst += f.awayScore;
    a.goalsFor += f.awayScore;
    a.goalsAgainst += f.homeScore;
    if (f.awayScore === 0) h.cleanSheets++;
    if (f.homeScore === 0) a.cleanSheets++;
    if (f.homeScore > f.awayScore) { h.wins++; a.losses++; }
    else if (f.homeScore < f.awayScore) { a.wins++; h.losses++; }
    else { h.draws++; a.draws++; }
  }

  for (const e of events) {
    if (!confirmedIds.has(e.fixtureId)) continue;
    if (e.playerId) {
      const p = player(e.playerId);
      if (GOALS.has(e.eventType)) p.goals++;
      if (e.eventType === "penalty_goal") p.penaltyGoals++;
      if (e.eventType === "own_goal") p.ownGoals++;
      if (e.eventType === "yellow_card") p.yellow++;
      if (e.eventType === "red_card") p.red++;
      if (e.eventType === "foul") p.fouls++;
    }
    if (e.assistPlayerId && GOALS.has(e.eventType)) player(e.assistPlayerId).assists++;
    if (e.teamId) {
      const t = team(e.teamId);
      if (e.eventType === "yellow_card") t.yellow++;
      if (e.eventType === "red_card") t.red++;
      if (e.eventType === "foul") t.fouls++;
    }
  }

  const totalGoals = confirmed.reduce((s, f) => s + f.homeScore + f.awayScore, 0);
  return {
    players: [...players.values()],
    teams: [...teams.values()],
    matchesPlayed: confirmed.length,
    totalGoals,
    goalsPerMatch: confirmed.length ? totalGoals / confirmed.length : 0,
    topScorers: [...players.values()].filter((p) => p.goals > 0).sort((a, b) => b.goals - a.goals || b.assists - a.assists),
  };
}
