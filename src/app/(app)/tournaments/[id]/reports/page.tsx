import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { getTournamentContext } from "@/lib/data/session";
import { getAwards, getDiscipline, getEvents, getFixtures, getParticipants, getPitches, getPlayers, getRules, getSuspensions, getTeams, getTiebreakDecisions } from "@/lib/data/loaders";
import { computeStats, describeSource, finalPlacings } from "@/lib/engine";
import { EVENT_LABELS, FORMAT_LABELS, groupLabels, standingsFor } from "@/lib/domain";
import type { PlayerContact } from "@/lib/types";
import { ReportsView, type ReportData } from "./reports-view";

export const metadata: Metadata = { title: "Reports and exports" };

export default async function ReportsPage(props: PageProps<"/tournaments/[id]/reports">) {
  const { id } = await props.params;
  const ctx = await getTournamentContext(id);
  const { tournament: t, settings: s } = ctx;
  const [teams, players, fixtures, events, pitches, discipline, suspensions, rules, decisions] = await Promise.all([
    getTeams(id), getPlayers(id), getFixtures(id), getEvents(id), getPitches(id), getDiscipline(id), getSuspensions(id), getRules(id), getTiebreakDecisions(id),
  ]);
  const teamName = new Map(teams.map((x) => [x.id, x.name]));
  const playerName = new Map(players.map((p) => [p.id, p.full_name]));
  const pitchName = new Map(pitches.map((p) => [p.id, p.name]));
  const name = (tid: string | null, src: string | null) => (tid ? teamName.get(tid) ?? "?" : describeSource(src));

  const scopes =
    t.format === "group_knockout"
      ? groupLabels(teams).map((g) => ({ title: `Group ${g}`, scope: { stage: "group" as const, group: g } }))
      : t.format === "round_robin" || t.format === "league_playoff"
        ? [{ title: "League", scope: { stage: "league" as const } }]
        : [];
  const [participants, awards] = await Promise.all([getParticipants(id), getAwards(id)]);
  const stats = computeStats(
    fixtures.map((f) => ({ id: f.id, code: f.code, homeTeamId: f.home_team_id, awayTeamId: f.away_team_id, homeScore: f.home_score, awayScore: f.away_score, status: f.status, homePenalties: f.home_penalties, awayPenalties: f.away_penalties })),
    events.map((e) => ({ fixtureId: e.fixture_id, eventType: e.event_type, teamId: e.team_id, playerId: e.player_id, assistPlayerId: e.assist_player_id, relatedPlayerId: e.related_player_id })),
    participants.map((p) => ({ fixtureId: p.fixture_id, playerId: p.player_id })),
  );
  const placings = finalPlacings(fixtures.map((f) => ({ id: f.id, code: f.code, homeTeamId: f.home_team_id, awayTeamId: f.away_team_id, homeScore: f.home_score, awayScore: f.away_score, status: f.status, homePenalties: f.home_penalties, awayPenalties: f.away_penalties })));
  const confirmedAwards = awards?.confirmed_at ? awards : null;
  const most = confirmedAwards ? { goals: confirmedAwards.top_scorer_goals ?? 0, ids: confirmedAwards.top_scorer_player_ids } : { goals: stats.mostGoals.goals, ids: stats.mostGoals.playerIds };

  const data: ReportData = {
    tournament: { name: t.name, venue: t.venue, date: t.start_date, format: FORMAT_LABELS[t.format], slug: t.slug },
    fixtures: fixtures.map((f) => ({
      id: f.id,
      code: f.code,
      round: f.round_name ?? "",
      date: f.scheduled_date ?? "",
      time: f.scheduled_time?.slice(0, 5) ?? "",
      pitch: f.pitch_id ? pitchName.get(f.pitch_id) ?? "" : "",
      home: name(f.home_team_id, f.home_source),
      away: name(f.away_team_id, f.away_source),
      status: f.status,
      score: ["confirmed", "completed", "in_progress", "paused"].includes(f.status) ? `${f.home_score}-${f.away_score}${f.home_penalties !== null ? ` (${f.home_penalties}-${f.away_penalties} pens)` : ""}` : "",
      notes: f.notes ?? "",
      events: events
        .filter((e) => e.fixture_id === f.id)
        .map((e) => ({
          minute: e.match_second !== null ? `${Math.floor(e.match_second / 60) + 1}'` : "",
          type: EVENT_LABELS[e.event_type],
          team: e.team_id ? teamName.get(e.team_id) ?? "" : "",
          player: e.player_id ? playerName.get(e.player_id) ?? "" : "",
          detail: [e.assist_player_id ? `assist ${playerName.get(e.assist_player_id)}` : "", e.detail ?? ""].filter(Boolean).join("; "),
        })),
    })),
    teamLists: players
      .filter((p) => p.registration_status !== "withdrawn")
      .map((p) => ({ team: p.team_id ? teamName.get(p.team_id) ?? "" : "Unassigned", name: p.full_name, position: p.position ?? "", number: p.jersey_number ?? "", captain: p.is_captain ? "Captain" : "", status: p.registration_status }))
      .sort((a, b) => a.team.localeCompare(b.team) || a.name.localeCompare(b.name)),
    standings: scopes.map((x) => ({
      title: x.title,
      rows: standingsFor(s, teams, fixtures, events, decisions, x.scope).rows.map((r) => ({
        pos: r.shared ? `=${r.position}` : String(r.position), team: r.name, p: r.played, w: r.won, d: r.drawn, l: r.lost, gf: r.goalsFor, ga: r.goalsAgainst, gd: r.goalDifference, pts: r.points,
      })),
    })),
    discipline: discipline.map((r) => ({
      player: r.player_id ? playerName.get(r.player_id) ?? "" : "",
      team: r.team_id ? teamName.get(r.team_id) ?? "" : "",
      match: r.fixture_id ? fixtures.find((f) => f.id === r.fixture_id)?.code ?? "" : "",
      incident: r.incident_type.replace(/_/g, " "),
      reason: r.reason ?? "",
      time: r.occurred_at.slice(0, 16).replace("T", " "),
    })),
    suspensions: suspensions.map((x) => ({ player: playerName.get(x.player_id) ?? "", matches: x.matches, reason: x.reason, status: x.status })),
    scorers: stats.topScorers.map((p) => ({ player: playerName.get(p.playerId) ?? "", team: teamName.get(players.find((pl) => pl.id === p.playerId)?.team_id ?? "") ?? "", goals: p.goals, assists: p.assists })),
    summary: {
      matches: stats.matchesPlayed, goals: stats.totalGoals, teams: teams.length, players: players.filter((p) => p.registration_status === "confirmed").length,
      champion: (confirmedAwards?.champion_team_id ?? placings.champion) ? teamName.get((confirmedAwards?.champion_team_id ?? placings.champion)!) ?? null : null,
    },
    awards: {
      confirmed: !!confirmedAwards,
      winners: (confirmedAwards?.champion_team_id ?? placings.champion) ? teamName.get((confirmedAwards?.champion_team_id ?? placings.champion)!) ?? "" : "To be decided",
      runnersUp: (confirmedAwards?.runner_up_team_id ?? placings.runnerUp) ? teamName.get((confirmedAwards?.runner_up_team_id ?? placings.runnerUp)!) ?? "" : "To be decided",
      mvp: awards?.mvp_player_id ? `${playerName.get(awards.mvp_player_id) ?? ""}${awards.mvp_reason ? ` (${awards.mvp_reason})` : ""}` : "Not selected",
      mostGoals: most.ids.length ? `${most.ids.map((x) => playerName.get(x) ?? "").join(", ")} (${most.goals})` : "None",
    },
    knockout: fixtures.filter((f) => f.stage === "knockout").map((f) => ({
      round: f.round_name ?? f.code, home: name(f.home_team_id, f.home_source), away: name(f.away_team_id, f.away_source),
      score: f.status === "confirmed" ? `${f.home_score}-${f.away_score}${f.home_penalties !== null ? ` (${f.home_penalties}-${f.away_penalties} pens)` : ""}` : "Not played",
      winner: f.winner_team_id ? teamName.get(f.winner_team_id) ?? "" : "",
    })),
    teamStats: stats.teams.map((x) => ({ team: teamName.get(x.teamId) ?? "", p: x.played, w: x.wins, d: x.draws, l: x.losses, gf: x.goalsFor, ga: x.goalsAgainst, gd: x.goalDifference, cs: x.cleanSheets, y: x.yellow, r: x.red })),
    playerStats: stats.players.filter((x) => playerName.has(x.playerId)).sort((a, b) => b.goals - a.goals).map((x) => ({
      player: playerName.get(x.playerId) ?? "", team: teamName.get(players.find((pl) => pl.id === x.playerId)?.team_id ?? "") ?? "",
      mp: x.matchesPlayed, goals: x.goals, pens: x.penaltyGoals, og: x.ownGoals, y: x.yellow, r: x.red, fouls: x.fouls,
    })),
  };

  let backup: Record<string, unknown> | null = null;
  if (ctx.isAdmin) {
    const [{ data: contacts }, { data: registrations }, { data: officials }] = await Promise.all([
      ctx.supabase.from("player_contacts").select("*").eq("tournament_id", id),
      ctx.supabase.from("registrations").select("*").eq("tournament_id", id),
      ctx.supabase.from("match_officials").select("*").eq("tournament_id", id),
    ]);
    backup = {
      exported_at: new Date().toISOString(),
      schema: "church-tournament-manager/v1",
      tournament: t, settings: s, pitches, teams, players, player_contacts: (contacts ?? []) as PlayerContact[], registrations: registrations ?? [],
      fixtures, match_events: events, match_officials: officials ?? [], disciplinary_records: discipline, suspensions, rules, tiebreak_decisions: decisions,
    };
  }

  return (
    <>
      <PageHeader title="Reports and exports" description="Download reports as PDF or CSV. Public reports never include contact details." />
      <ReportsView data={data} backup={backup} />
    </>
  );
}
