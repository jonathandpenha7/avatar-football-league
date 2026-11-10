import {
  computeStandings,
  dateRange,
  fairPlayPoints,
  toMinutes,
  type BlockedPeriod,
  type DayWindow,
  type DisciplineFixture,
  type FormatOptions,
  type StandingsResult,
} from "@/lib/engine";
import type {
  EventType,
  Fixture,
  FixtureStatus,
  MatchEvent,
  TiebreakDecisionRow,
  Team,
  Tournament,
  TournamentSettings,
  TournamentStatus,
} from "@/lib/types";

export const FORMAT_LABELS: Record<Tournament["format"], string> = {
  round_robin: "Round robin league",
  league_playoff: "League followed by play-offs",
  single_elimination: "Single elimination",
  double_elimination: "Double elimination",
  group_knockout: "Group stage then knockout",
};

export const FORMAT_DESCRIPTIONS: Record<Tournament["format"], string> = {
  round_robin: "Every team plays every other team once. The team top of the table wins. No semi-finals or final.",
  league_playoff: "Every team plays every other team once, then the top teams play semi-finals (1st v 4th, 2nd v 3rd) and a final. This is the Avatar Football League format.",
  single_elimination: "Knockout from the first match: lose once and you are out.",
  double_elimination: "Knockout where a team is only out after losing twice.",
  group_knockout: "Teams are split into groups that each play a mini-league, then the top teams from each group go into a knockout.",
};

export const STATUS_LABELS: Record<TournamentStatus, string> = {
  draft: "Draft",
  registration_open: "Registration open",
  ready: "Ready",
  live: "Live",
  completed: "Completed",
  archived: "Archived",
};

export const FIXTURE_STATUS_LABELS: Record<FixtureStatus, string> = {
  scheduled: "Scheduled",
  in_progress: "In progress",
  paused: "Paused",
  completed: "Awaiting confirmation",
  confirmed: "Confirmed",
  postponed: "Postponed",
  cancelled: "Cancelled",
};

export const EVENT_LABELS: Record<EventType, string> = {
  goal: "Goal",
  own_goal: "Own goal",
  penalty_goal: "Penalty goal",
  yellow_card: "Yellow card",
  red_card: "Red card",
  foul: "Foul",
  substitution: "Substitution",
  sin_bin: "Time penalty",
  shootout_goal: "Shootout: scored",
  shootout_miss: "Shootout: missed",
  note: "Note",
};

export const RULE_CATEGORY_LABELS: Record<string, string> = {
  general: "General",
  match: "Match rules",
  eligibility: "Player eligibility",
  substitution: "Substitution rules",
  fouls_cards: "Fouls and cards",
  suspensions: "Suspensions",
  referee: "Referee decisions",
  forfeits: "Forfeits and walkovers",
  knockout: "Knockout rules",
};

export const LIVE_STATUSES: FixtureStatus[] = ["in_progress", "paused"];

/** Minutes a pitch is occupied by a match, per tournament settings. */
export function occupiedFor(settings: TournamentSettings, stage: Fixture["stage"] = "league"): number | null {
  if (stage === "knockout" && settings.knockout_match_duration_min) {
    const ht = settings.knockout_half_time_min ?? settings.half_time_min;
    return settings.knockout_match_duration_min + (settings.periods === 2 ? ht : 0);
  }
  if (!settings.match_duration_min) return null;
  return settings.match_duration_min + (settings.periods === 2 ? settings.half_time_min : 0);
}

/** Playing time (without half-time) for a stage. */
export function playingMinutes(settings: TournamentSettings, stage: Fixture["stage"]): number | null {
  return stage === "knockout" && settings.knockout_match_duration_min ? settings.knockout_match_duration_min : settings.match_duration_min;
}

export function fixtureDuration(f: Fixture, settings: TournamentSettings): number {
  return f.duration_min ?? occupiedFor(settings, f.stage) ?? 0;
}

/** Daily playing windows derived from tournament dates and times. */
export function playingDays(t: Tournament): DayWindow[] {
  const start = toMinutes(t.daily_start_time);
  const end = toMinutes(t.daily_end_time);
  if (!t.start_date || start === null || end === null) return [];
  return dateRange(t.start_date, t.end_date).map((date) => ({ date, start, end }));
}

export function blockedPeriods(settings: TournamentSettings): BlockedPeriod[] {
  return (settings.blocked_periods ?? [])
    .map((b) => ({
      date: b.date ?? null,
      start: toMinutes(b.start) ?? 0,
      end: toMinutes(b.end) ?? 0,
      pitchId: b.pitch_id ?? null,
      label: b.label ?? null,
    }))
    .filter((b) => b.end > b.start);
}

export function toDisciplineFixture(f: Fixture): DisciplineFixture {
  return {
    id: f.id,
    homeTeamId: f.home_team_id,
    awayTeamId: f.away_team_id,
    status: f.status,
    date: f.scheduled_date,
    start: toMinutes(f.scheduled_time),
    order: f.match_order,
  };
}

/** Standings for the league, or one group, from confirmed fixtures only. */
export function standingsFor(
  settings: TournamentSettings,
  teams: Team[],
  fixtures: Fixture[],
  events: MatchEvent[],
  decisions: TiebreakDecisionRow[],
  scope: { stage: "league" } | { stage: "group"; group: string },
): StandingsResult {
  const scopedTeams =
    scope.stage === "group" ? teams.filter((t) => t.group_label === scope.group) : teams;
  const scopedFixtures = fixtures.filter((f) =>
    scope.stage === "group" ? f.stage === "group" && f.group_label === scope.group : f.stage === "league",
  );
  const fixtureIds = new Set(scopedFixtures.filter((f) => f.status === "confirmed").map((f) => f.id));
  const cards = events
    .filter((e) => fixtureIds.has(e.fixture_id) && e.team_id && (e.event_type === "yellow_card" || e.event_type === "red_card"))
    .map((e) => ({ teamId: e.team_id!, type: e.event_type === "yellow_card" ? ("yellow" as const) : ("red" as const) }));
  const scopeKey = scope.stage === "group" ? `group:${scope.group}` : "league";
  return computeStandings(
    scopedTeams.map((t) => ({ id: t.id, name: t.name })),
    scopedFixtures.map((f) => ({
      id: f.id,
      homeTeamId: f.home_team_id,
      awayTeamId: f.away_team_id,
      homeScore: f.home_score,
      awayScore: f.away_score,
      status: f.status,
    })),
    {
      pointsWin: settings.points_win,
      pointsDraw: settings.points_draw,
      pointsLoss: settings.points_loss,
      tiebreakers: settings.tiebreakers,
      tiebreakersConfirmed: settings.tiebreakers_confirmed,
      fairPlay: fairPlayPoints(cards, { yellow: settings.fair_play_yellow, red: settings.fair_play_red }),
      decisions: decisions
        .filter((d) => d.scope === scopeKey)
        .map((d) => ({ orderedTeamIds: d.ordered_team_ids, createdAt: d.created_at })),
    },
  );
}

export function hasLeaguePhase(format: Tournament["format"]) {
  return format === "round_robin" || format === "league_playoff";
}

export function hasKnockout(format: Tournament["format"]) {
  return format !== "round_robin";
}

export function groupLabels(teams: Team[]): string[] {
  return [...new Set(teams.map((t) => t.group_label).filter((g): g is string => !!g))].sort();
}

/** Live match clock in seconds. */
export function elapsedSeconds(f: Pick<Fixture, "timer_started_at" | "timer_elapsed_sec" | "status">, now = Date.now()) {
  const running = f.status === "in_progress" && f.timer_started_at;
  return f.timer_elapsed_sec + (running ? Math.max(0, Math.floor((now - new Date(f.timer_started_at!).getTime()) / 1000)) : 0);
}

export function formatClockSeconds(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Today's date in the tournament's time zone (YYYY-MM-DD). */
export function todayIn(timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export function formatDate(date: string | null | undefined, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short", year: "numeric" }) {
  if (!date) return "Date not set";
  return new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

export function formatOptions(ctx: { tournament: Tournament; settings: TournamentSettings }): FormatOptions {
  return {
    format: ctx.tournament.format,
    doubleRoundRobin: ctx.settings.double_round_robin,
    qualifiers: ctx.settings.qualifiers,
    thirdPlaceMatch: ctx.settings.third_place_match,
    groupCount: ctx.settings.group_count,
    qualifiersPerGroup: ctx.settings.qualifiers_per_group,
  };
}
