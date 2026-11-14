import type { Metadata } from "next";
import Link from "next/link";
import { Crown, Goal, ShieldCheck, Swords, Target } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/app/page-header";
import { StatCard } from "@/components/app/stat-card";
import { TeamName } from "@/components/app/team-name";
import { getTournamentContext } from "@/lib/data/session";
import { getEvents, getFixtures, getParticipants, getPlayers, getTeams } from "@/lib/data/loaders";
import { computeStats } from "@/lib/engine";
import { cn } from "@/lib/utils";
import { StatBar } from "./charts";

export const metadata: Metadata = { title: "Statistics" };

export default async function StatsPage(props: PageProps<"/tournaments/[id]/stats">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const view = sp.view === "players" ? "players" : "teams";
  await getTournamentContext(id);
  const [teams, players, fixtures, events, participants] = await Promise.all([getTeams(id), getPlayers(id), getFixtures(id), getEvents(id), getParticipants(id)]);
  const stats = computeStats(
    fixtures.map((f) => ({ id: f.id, code: f.code, stage: f.stage, homeTeamId: f.home_team_id, awayTeamId: f.away_team_id, homeScore: f.home_score, awayScore: f.away_score, status: f.status, homePenalties: f.home_penalties, awayPenalties: f.away_penalties })),
    events.map((e) => ({ fixtureId: e.fixture_id, eventType: e.event_type, teamId: e.team_id, playerId: e.player_id, assistPlayerId: e.assist_player_id, relatedPlayerId: e.related_player_id })),
    participants.map((p) => ({ fixtureId: p.fixture_id, playerId: p.player_id })),
  );
  const teamMap = new Map(teams.map((t) => [t.id, t]));
  const playerMap = new Map(players.map((p) => [p.id, p]));
  const teamStats = [...stats.teams].sort((a, b) => b.goalsFor - a.goalsFor || a.teamId.localeCompare(b.teamId));
  const confirmed = fixtures.filter((f) => f.status === "confirmed");
  const playerRows = [...stats.players]
    .filter((p) => playerMap.has(p.playerId))
    .sort((a, b) => b.goals - a.goals || b.matchesPlayed - a.matchesPlayed || playerMap.get(a.playerId)!.full_name.localeCompare(playerMap.get(b.playerId)!.full_name));
  const tab = (key: string, label: string) => (
    <Link href={`/tournaments/${id}/stats${key === "teams" ? "" : "?view=players"}`} className={cn("rounded-md px-3 py-1", view === key && "bg-background font-medium shadow-xs")}>{label}</Link>
  );

  return (
    <>
      <PageHeader title="Statistics" description="From confirmed matches only. Own goals count for the opposing team and are never credited to the player. Shootout penalties are excluded." />
      <div className="mb-6 grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-5">
        <StatCard label="Matches played" value={stats.matchesPlayed} icon={Swords} />
        <StatCard label="Goals" value={stats.totalGoals} icon={Goal} />
        <StatCard label="Goals per match" value={stats.goalsPerMatch.toFixed(2)} icon={Target} />
        <StatCard label="Clean sheets" value={stats.teams.reduce((s, t) => s + t.cleanSheets, 0)} icon={ShieldCheck} />
        <StatCard
          label="Most goals"
          value={stats.mostGoals.goals || "–"}
          icon={Crown}
          hint={stats.mostGoals.playerIds.map((pid) => playerMap.get(pid)?.full_name ?? "Unknown").join(", ") || "No goals yet"}
          className="col-span-2 lg:col-span-1"
        />
      </div>

      <div className="mb-4 inline-flex rounded-lg bg-muted p-[3px] text-sm">
        {tab("teams", "Team statistics")}
        {tab("players", "Player statistics")}
      </div>

      {view === "teams" ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card className="gap-0 py-0 lg:col-span-2">
            <CardHeader className="border-b py-3"><CardTitle>Team performance</CardTitle></CardHeader>
            <Table className="tabular">
              <TableHeader>
                <TableRow>
                  <TableHead>Team</TableHead>
                  <TableHead className="text-center" title="Played">P</TableHead>
                  <TableHead className="text-center">W</TableHead>
                  <TableHead className="text-center">D</TableHead>
                  <TableHead className="text-center">L</TableHead>
                  <TableHead className="text-center" title="Goals for">GF</TableHead>
                  <TableHead className="text-center" title="Goals against">GA</TableHead>
                  <TableHead className="text-center" title="Goal difference">GD</TableHead>
                  <TableHead className="hidden text-center md:table-cell" title="Clean sheets">CS</TableHead>
                  <TableHead className="hidden text-center md:table-cell" title="Penalty goals">Pen</TableHead>
                  <TableHead className="hidden text-center md:table-cell">Y</TableHead>
                  <TableHead className="hidden text-center md:table-cell">R</TableHead>
                  <TableHead className="hidden text-center md:table-cell">Fouls</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {teamStats.map((t) => (
                  <TableRow key={t.teamId}>
                    <TableCell className="max-w-0"><Link href={`/tournaments/${id}/teams/${t.teamId}`} className="hover:underline"><TeamName team={teamMap.get(t.teamId)} /></Link></TableCell>
                    <TableCell className="text-center">{t.played}</TableCell>
                    <TableCell className="text-center">{t.wins}</TableCell>
                    <TableCell className="text-center">{t.draws}</TableCell>
                    <TableCell className="text-center">{t.losses}</TableCell>
                    <TableCell className="text-center">{t.goalsFor}</TableCell>
                    <TableCell className="text-center">{t.goalsAgainst}</TableCell>
                    <TableCell className="text-center font-medium">{t.goalDifference > 0 ? `+${t.goalDifference}` : t.goalDifference}</TableCell>
                    <TableCell className="hidden text-center md:table-cell">{t.cleanSheets}</TableCell>
                    <TableCell className="hidden text-center md:table-cell">{t.penaltyGoals}</TableCell>
                    <TableCell className="hidden text-center md:table-cell">{t.yellow}</TableCell>
                    <TableCell className="hidden text-center md:table-cell">{t.red}</TableCell>
                    <TableCell className="hidden text-center md:table-cell">{t.fouls}</TableCell>
                  </TableRow>
                ))}
                {!teamStats.length ? <TableRow><TableCell colSpan={13} className="text-muted-foreground">No confirmed matches yet.</TableCell></TableRow> : null}
              </TableBody>
            </Table>
          </Card>
          <Card>
            <CardHeader><CardTitle>Goals scored per team</CardTitle></CardHeader>
            <CardContent><StatBar data={teamStats.map((t) => ({ label: teamMap.get(t.teamId)?.name ?? "?", value: t.goalsFor }))} unit="goals" /></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Goals per match</CardTitle></CardHeader>
            <CardContent><StatBar data={confirmed.map((f) => ({ label: f.code, value: f.home_score + f.away_score }))} unit="goals" /></CardContent>
          </Card>
        </div>
      ) : (
        <Card className="gap-0 py-0">
          <CardHeader className="border-b py-3">
            <CardTitle>Player statistics</CardTitle>
            <CardDescription>Matches played comes from the recorded lineups (the full eligible squad when no lineup was entered).</CardDescription>
          </CardHeader>
          <Table className="tabular">
            <TableHeader>
              <TableRow>
                <TableHead>Player</TableHead>
                <TableHead className="text-center" title="Matches played">MP</TableHead>
                <TableHead className="text-center" title="Goals (including penalty goals)">G</TableHead>
                <TableHead className="text-center" title="Penalty goals in normal play">Pen</TableHead>
                <TableHead className="text-center" title="Own goals">OG</TableHead>
                <TableHead className="hidden text-center sm:table-cell">Y</TableHead>
                <TableHead className="hidden text-center sm:table-cell">R</TableHead>
                <TableHead className="hidden text-center md:table-cell">Fouls</TableHead>
                <TableHead className="hidden text-center md:table-cell" title="Time penalties">TP</TableHead>
                <TableHead className="hidden text-center md:table-cell" title="Substitutions on / off">Subs</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {playerRows.map((p) => {
                const pl = playerMap.get(p.playerId)!;
                return (
                  <TableRow key={p.playerId} className={cn(stats.mostGoals.playerIds.includes(p.playerId) && "bg-primary/5")}>
                    <TableCell>
                      <div className="font-medium">{pl.full_name}{stats.mostGoals.playerIds.includes(p.playerId) ? <Crown className="ml-1 inline size-3.5 text-amber-500" /> : null}</div>
                      <div className="text-xs text-muted-foreground">{pl.team_id ? teamMap.get(pl.team_id)?.name : "No team"}</div>
                    </TableCell>
                    <TableCell className="text-center">{p.matchesPlayed}</TableCell>
                    <TableCell className="text-center font-semibold">{p.goals}</TableCell>
                    <TableCell className="text-center">{p.penaltyGoals}</TableCell>
                    <TableCell className="text-center">{p.ownGoals}</TableCell>
                    <TableCell className="hidden text-center sm:table-cell">{p.yellow}</TableCell>
                    <TableCell className="hidden text-center sm:table-cell">{p.red}</TableCell>
                    <TableCell className="hidden text-center md:table-cell">{p.fouls}</TableCell>
                    <TableCell className="hidden text-center md:table-cell">{p.timePenalties}</TableCell>
                    <TableCell className="hidden text-center md:table-cell">{p.subbedOn}/{p.subbedOff}</TableCell>
                  </TableRow>
                );
              })}
              {!playerRows.length ? <TableRow><TableCell colSpan={10} className="text-muted-foreground">No player statistics from confirmed matches yet.</TableCell></TableRow> : null}
            </TableBody>
          </Table>
        </Card>
      )}
    </>
  );
}
