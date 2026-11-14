import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { getTournamentContext } from "@/lib/data/session";
import { getAwards, getEvents, getFixtures, getMembers, getNominations, getParticipants, getPlayers, getTeams } from "@/lib/data/loaders";
import { computeStats, finalPlacings } from "@/lib/engine";
import { AwardsView } from "./awards-view";

export const metadata: Metadata = { title: "Awards and final results" };

export default async function AwardsPage(props: PageProps<"/tournaments/[id]/awards">) {
  const { id } = await props.params;
  const ctx = await getTournamentContext(id);
  const [teams, players, fixtures, events, participants, awards, nominations, members] = await Promise.all([
    getTeams(id), getPlayers(id), getFixtures(id), getEvents(id), getParticipants(id), getAwards(id), getNominations(id), getMembers(id),
  ]);
  const statFixtures = fixtures.map((f) => ({
    id: f.id, code: f.code, stage: f.stage, homeTeamId: f.home_team_id, awayTeamId: f.away_team_id,
    homeScore: f.home_score, awayScore: f.away_score, status: f.status, homePenalties: f.home_penalties, awayPenalties: f.away_penalties,
  }));
  const stats = computeStats(
    statFixtures,
    events.map((e) => ({ fixtureId: e.fixture_id, eventType: e.event_type, teamId: e.team_id, playerId: e.player_id, relatedPlayerId: e.related_player_id })),
    participants.map((p) => ({ fixtureId: p.fixture_id, playerId: p.player_id })),
  );
  const placings = finalPlacings(statFixtures);
  const pending = fixtures.filter((f) => ["scheduled", "in_progress", "paused", "completed"].includes(f.status)).length;
  const role = ctx.role;
  return (
    <>
      <PageHeader
        title="Tournament Awards and Final Results"
        description="Winners and Runners up come from the confirmed final. Most Goals is calculated from confirmed goals. The MVP is chosen by the organisers."
      />
      <AwardsView
        tournamentId={id}
        isAdmin={ctx.isAdmin}
        canNominate={ctx.isAdmin || (ctx.settings.mvp_nominations_enabled && (role === "referee" || role === "scorekeeper"))}
        nominationsEnabled={ctx.settings.mvp_nominations_enabled}
        currentUserId={ctx.profile.id}
        teams={teams.map((t) => ({ id: t.id, name: t.name, colour: t.colour, logo_url: t.logo_url }))}
        players={players.filter((p) => p.registration_status !== "withdrawn").map((p) => ({ id: p.id, name: p.full_name, teamId: p.team_id }))}
        stats={stats.players}
        mostGoals={stats.mostGoals}
        live={{ champion: placings.champion, runnerUp: placings.runnerUp, thirdPlace: placings.thirdPlace, finalConfirmed: placings.finalConfirmed }}
        hasFinal={fixtures.some((f) => f.code === "F" || f.code === "GF")}
        awards={awards}
        nominations={nominations}
        nominators={Object.fromEntries(members.map((m) => [m.user_id, m.profile?.full_name ?? m.profile?.email ?? "Organiser"]))}
        unfinishedMatches={pending}
        publicEnabled={ctx.tournament.public_enabled}
      />
    </>
  );
}
