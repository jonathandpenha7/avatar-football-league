import type { Metadata } from "next";
import { Goal, ShieldCheck, Swords, Target } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/app/page-header";
import { StatCard } from "@/components/app/stat-card";
import { TeamName } from "@/components/app/team-name";
import { getTournamentContext } from "@/lib/data/session";
import { getEvents, getFixtures, getPlayers, getTeams } from "@/lib/data/loaders";
import { computeStats } from "@/lib/engine";
import { StatBar } from "./charts";

export const metadata: Metadata = { title: "Statistics" };

export default async function StatsPage(props: PageProps<"/tournaments/[id]/stats">) {
  const { id } = await props.params;
  await getTournamentContext(id);
  const [teams, players, fixtures, events] = await Promise.all([getTeams(id), getPlayers(id), getFixtures(id), getEvents(id)]);
  const stats = computeStats(
    fixtures.map((f) => ({ id: f.id, homeTeamId: f.home_team_id, awayTeamId: f.away_team_id, homeScore: f.home_score, awayScore: f.away_score, status: f.status })),
    events.map((e) => ({ fixtureId: e.fixture_id, eventType: e.event_type, teamId: e.team_id, playerId: e.player_id, assistPlayerId: e.assist_player_id })),
  );
  const teamMap = new Map(teams.map((t) => [t.id, t]));
  const playerMap = new Map(players.map((p) => [p.id, p]));
  const teamStats = [...stats.teams].sort((a, b) => b.goalsFor - a.goalsFor);
  const confirmed = fixtures.filter((f) => f.status === "confirmed");
  const cards = stats.players.filter((p) => p.yellow || p.red).sort((a, b) => b.red - a.red || b.yellow - a.yellow);

  return (
    <>
      <PageHeader title="Statistics" description="From confirmed matches only." />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Matches played" value={stats.matchesPlayed} icon={Swords} />
        <StatCard label="Goals" value={stats.totalGoals} icon={Goal} />
        <StatCard label="Goals per match" value={stats.goalsPerMatch.toFixed(2)} icon={Target} />
        <StatCard label="Clean sheets" value={stats.teams.reduce((s, t) => s + t.cleanSheets, 0)} icon={ShieldCheck} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Goals scored per team</CardTitle></CardHeader>
          <CardContent>
            <StatBar data={teamStats.map((t) => ({ label: teamMap.get(t.teamId)?.name ?? "?", value: t.goalsFor }))} unit="goals" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Goals per match</CardTitle></CardHeader>
          <CardContent>
            <StatBar data={confirmed.map((f) => ({ label: f.code, value: f.home_score + f.away_score }))} unit="goals" />
          </CardContent>
        </Card>
        <Card className="gap-0 py-0">
          <CardHeader className="border-b py-3"><CardTitle>Top scorers</CardTitle></CardHeader>
          <Table className="tabular">
            <TableHeader><TableRow><TableHead className="w-8">#</TableHead><TableHead>Player</TableHead><TableHead className="text-center">Goals</TableHead><TableHead className="text-center">Assists</TableHead></TableRow></TableHeader>
            <TableBody>
              {stats.topScorers.slice(0, 15).map((p, i) => {
                const pl = playerMap.get(p.playerId);
                return (
                  <TableRow key={p.playerId}>
                    <TableCell>{i + 1}</TableCell>
                    <TableCell><div className="font-medium">{pl?.full_name ?? "Unknown"}</div><div className="text-xs text-muted-foreground">{pl?.team_id ? teamMap.get(pl.team_id)?.name : ""}</div></TableCell>
                    <TableCell className="text-center font-semibold">{p.goals}</TableCell>
                    <TableCell className="text-center">{p.assists}</TableCell>
                  </TableRow>
                );
              })}
              {!stats.topScorers.length ? <TableRow><TableCell colSpan={4} className="text-muted-foreground">No goals with a named scorer yet.</TableCell></TableRow> : null}
            </TableBody>
          </Table>
        </Card>
        <Card className="gap-0 py-0">
          <CardHeader className="border-b py-3"><CardTitle>Team performance</CardTitle></CardHeader>
          <Table className="tabular">
            <TableHeader><TableRow><TableHead>Team</TableHead><TableHead className="text-center">P</TableHead><TableHead className="text-center">W-D-L</TableHead><TableHead className="text-center">GF</TableHead><TableHead className="text-center">GA</TableHead><TableHead className="text-center" title="Clean sheets">CS</TableHead><TableHead className="text-center">Cards</TableHead></TableRow></TableHeader>
            <TableBody>
              {teamStats.map((t) => (
                <TableRow key={t.teamId}>
                  <TableCell className="max-w-0"><TeamName team={teamMap.get(t.teamId)} /></TableCell>
                  <TableCell className="text-center">{t.played}</TableCell>
                  <TableCell className="text-center">{t.wins}-{t.draws}-{t.losses}</TableCell>
                  <TableCell className="text-center">{t.goalsFor}</TableCell>
                  <TableCell className="text-center">{t.goalsAgainst}</TableCell>
                  <TableCell className="text-center">{t.cleanSheets}</TableCell>
                  <TableCell className="text-center">{t.yellow}Y {t.red}R</TableCell>
                </TableRow>
              ))}
              {!teamStats.length ? <TableRow><TableCell colSpan={7} className="text-muted-foreground">No confirmed matches yet.</TableCell></TableRow> : null}
            </TableBody>
          </Table>
        </Card>
        <Card className="gap-0 py-0 lg:col-span-2">
          <CardHeader className="border-b py-3"><CardTitle>Cards by player</CardTitle></CardHeader>
          <Table className="tabular">
            <TableHeader><TableRow><TableHead>Player</TableHead><TableHead className="text-center">Yellow</TableHead><TableHead className="text-center">Red</TableHead><TableHead className="text-center">Fouls</TableHead></TableRow></TableHeader>
            <TableBody>
              {cards.map((p) => (
                <TableRow key={p.playerId}>
                  <TableCell>{playerMap.get(p.playerId)?.full_name ?? "Unknown"}</TableCell>
                  <TableCell className="text-center">{p.yellow}</TableCell>
                  <TableCell className="text-center">{p.red}</TableCell>
                  <TableCell className="text-center">{p.fouls}</TableCell>
                </TableRow>
              ))}
              {!cards.length ? <TableRow><TableCell colSpan={4} className="text-muted-foreground">No cards shown.</TableCell></TableRow> : null}
            </TableBody>
          </Table>
        </Card>
      </div>
    </>
  );
}
