import type { Decision, Fixture, MatchOfficial, Player, Team, Tournament, TournamentSettings } from "@/lib/types";

export interface PendingTask {
  key: string;
  label: string;
  detail?: string;
  href: string;
  severity: "high" | "normal";
}

/** Administrative to-dos derived from the current tournament state. */
export function pendingTasks(input: {
  tournament: Tournament;
  settings: TournamentSettings;
  teams: Team[];
  players: Player[];
  fixtures: Fixture[];
  decisions: Decision[];
  officials: MatchOfficial[];
  pendingRegistrations: number;
}): PendingTask[] {
  const { tournament: t, settings: s, teams, players, fixtures, decisions, officials } = input;
  const base = `/tournaments/${t.id}`;
  const tasks: PendingTask[] = [];

  const awaiting = fixtures.filter((f) => f.status === "completed");
  if (awaiting.length) {
    tasks.push({ key: "confirm", label: `${awaiting.length} result${awaiting.length > 1 ? "s" : ""} awaiting confirmation`, href: `${base}/matches?view=completed`, severity: "high" });
  }
  const open = decisions.filter((d) => d.status === "open");
  if (open.length) {
    tasks.push({ key: "decisions", label: `${open.length} rule decision${open.length > 1 ? "s" : ""} still open`, detail: open[0].question, href: `${base}/rules`, severity: "high" });
  }
  if (!s.tiebreakers_confirmed && t.format !== "single_elimination" && t.format !== "double_elimination") {
    tasks.push({ key: "tiebreakers", label: "Confirm the tie-breaker order", detail: "Tied teams share a position until you do.", href: `${base}/settings?tab=points`, severity: "normal" });
  }
  if (s.match_duration_min === null) {
    tasks.push({ key: "duration", label: "Set the match duration", href: `${base}/settings?tab=match`, severity: "high" });
  }
  if (s.transition_min === null) {
    tasks.push({ key: "transition", label: "Set the transition time between matches", href: `${base}/settings?tab=match`, severity: "normal" });
  }
  const placeholders = teams.filter((x) => x.is_placeholder);
  if (placeholders.length) {
    tasks.push({ key: "placeholders", label: `${placeholders.length} placeholder team${placeholders.length > 1 ? "s" : ""} to rename`, href: `${base}/teams`, severity: "normal" });
  }
  if (teams.length !== s.team_count) {
    tasks.push({ key: "teamcount", label: `${teams.length} teams entered, ${s.team_count} expected`, href: `${base}/teams`, severity: "normal" });
  }
  if (input.pendingRegistrations) {
    tasks.push({ key: "registrations", label: `${input.pendingRegistrations} registration${input.pendingRegistrations > 1 ? "s" : ""} to review`, href: `${base}/registrations`, severity: "normal" });
  }
  const confirmedByTeam = new Map<string, number>();
  for (const p of players) if (p.team_id && p.registration_status === "confirmed") confirmedByTeam.set(p.team_id, (confirmedByTeam.get(p.team_id) ?? 0) + 1);
  const minimum = s.min_players_to_start ?? s.players_on_pitch;
  const short = teams.filter((x) => (confirmedByTeam.get(x.id) ?? 0) < minimum);
  if (short.length && teams.length) {
    tasks.push({ key: "squads", label: `${short.length} team${short.length > 1 ? "s have" : " has"} fewer than ${minimum} confirmed players`, href: `${base}/teams`, severity: "normal" });
  }
  if (!fixtures.length) {
    tasks.push({ key: "fixtures", label: "Generate fixtures", href: `${base}/fixtures`, severity: "normal" });
  } else {
    const unscheduled = fixtures.filter((f) => !f.scheduled_time && f.status !== "cancelled");
    if (unscheduled.length) tasks.push({ key: "unscheduled", label: `${unscheduled.length} fixtures have no time`, href: `${base}/fixtures`, severity: "normal" });
    if (!t.fixtures_published) tasks.push({ key: "publish", label: "Publish fixtures when they are final", href: `${base}/fixtures`, severity: "normal" });
    const covered = new Set(officials.filter((o) => o.role === "referee").map((o) => o.fixture_id));
    const noRef = fixtures.filter((f) => f.status === "scheduled" && !covered.has(f.id));
    if (noRef.length) tasks.push({ key: "officials", label: `${noRef.length} upcoming match${noRef.length > 1 ? "es have" : " has"} no referee assigned`, href: `${base}/officials`, severity: "normal" });
  }
  return tasks;
}
