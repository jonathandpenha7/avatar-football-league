import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/app/page-header";
import { TeamMark, TeamName } from "@/components/app/team-name";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getTournamentContext } from "@/lib/data/session";
import { getEvents, getFixtures, getPlayers, getSuspensions, getTeams } from "@/lib/data/loaders";
import { computeStats, playerEligibility } from "@/lib/engine";
import { toDisciplineFixture } from "@/lib/domain";
import type { PlayerContact } from "@/lib/types";
import { SquadTable } from "./squad-table";

export default async function TeamPage(props: PageProps<"/tournaments/[id]/teams/[teamId]">) {
  const { id, teamId } = await props.params;
  const ctx = await getTournamentContext(id);
  const [teams, players, suspensions, fixtures, events] = await Promise.all([getTeams(id), getPlayers(id), getSuspensions(id), getFixtures(id), getEvents(id)]);
  const team = teams.find((t) => t.id === teamId);
  if (!team) notFound();
  const squad = players.filter((p) => p.team_id === teamId);
  let contacts: PlayerContact[] = [];
  if (ctx.isAdmin && squad.length) {
    const { data } = await ctx.supabase.from("player_contacts").select("player_id, email, phone").in("player_id", squad.map((p) => p.id));
    contacts = (data ?? []) as PlayerContact[];
  }
  const dfx = fixtures.map(toDisciplineFixture);
  const susp = suspensions.map((s) => ({ id: s.id, playerId: s.player_id, teamId: s.team_id, startsAfterFixtureId: s.starts_after_fixture_id, matches: s.matches, status: s.status, reason: s.reason }));
  const nextFixture = fixtures.find((f) => f.status === "scheduled" && (f.home_team_id === teamId || f.away_team_id === teamId));
  const eligibility = Object.fromEntries(
    squad.map((p) => [
      p.id,
      playerEligibility(
        { id: p.id, fullName: p.full_name, teamId: p.team_id, registrationStatus: p.registration_status, eligibilityStatus: p.eligibility_status, eligibilityNote: p.eligibility_note },
        susp,
        dfx,
        nextFixture?.id,
      ),
    ]),
  );
  const stats = computeStats(
    fixtures.map((f) => ({ id: f.id, code: f.code, homeTeamId: f.home_team_id, awayTeamId: f.away_team_id, homeScore: f.home_score, awayScore: f.away_score, status: f.status, homePenalties: f.home_penalties, awayPenalties: f.away_penalties })),
    events.map((e) => ({ fixtureId: e.fixture_id, eventType: e.event_type, teamId: e.team_id, playerId: e.player_id, assistPlayerId: e.assist_player_id })),
  );
  const teamStat = stats.teams.find((t) => t.teamId === teamId);

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="no-print mb-2 -ml-2">
        <Link href={`/tournaments/${id}/teams`}><ChevronLeft /> All teams</Link>
      </Button>
      <PageHeader
        title={<span className="flex items-center gap-3"><TeamMark team={team} size="lg" /> {team.name}</span>}
        description={
          teamStat
            ? `Played ${teamStat.played}: ${teamStat.wins} won, ${teamStat.draws} drawn, ${teamStat.losses} lost. Goals ${teamStat.goalsFor}–${teamStat.goalsAgainst}.`
            : "No confirmed matches yet."
        }
      />
      <SquadTable
        tournamentId={id}
        team={team}
        teams={teams.map((t) => ({ id: t.id, name: t.name }))}
        players={squad}
        contacts={contacts}
        positions={ctx.settings.positions}
        maxSquad={ctx.settings.max_squad_size}
        isAdmin={ctx.isAdmin}
        eligibility={eligibility}
        stats={Object.fromEntries(stats.players.map((p) => [p.playerId, p]))}
        nextFixtureLabel={nextFixture ? `${nextFixture.code}${nextFixture.scheduled_time ? ` at ${nextFixture.scheduled_time.slice(0, 5)}` : ""}` : null}
      />
      <Card className="mt-6 gap-0 py-0">
        <CardHeader className="border-b py-3"><CardTitle>Match by match</CardTitle></CardHeader>
        {teamStat?.matches.length ? (
          <Table className="tabular">
            <TableHeader><TableRow><TableHead>Match</TableHead><TableHead>Opponent</TableHead><TableHead className="text-center">Score</TableHead><TableHead className="text-center">Result</TableHead></TableRow></TableHeader>
            <TableBody>
              {teamStat.matches.map((m) => (
                <TableRow key={m.fixtureId}>
                  <TableCell><Link href={`/tournaments/${id}/matches/${m.fixtureId}`} className="hover:underline">{m.code}</Link></TableCell>
                  <TableCell className="max-w-0"><TeamName team={teams.find((t) => t.id === m.opponentId)} /></TableCell>
                  <TableCell className="text-center">{m.goalsFor}–{m.goalsAgainst}{m.penalties ? <span className="text-xs text-muted-foreground"> ({m.penalties} p)</span> : null}</TableCell>
                  <TableCell className="text-center"><Badge variant="secondary" className={m.result === "W" ? "bg-success/15 text-success" : m.result === "L" ? "bg-destructive/10 text-destructive" : ""}>{m.result}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">No confirmed matches yet.</p>
        )}
      </Card>
    </>
  );
}
