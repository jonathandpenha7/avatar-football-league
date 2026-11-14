import type { Metadata } from "next";
import Link from "next/link";
import { CircleAlert, CircleCheck, Coffee } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/app/page-header";
import { TeamName } from "@/components/app/team-name";
import { StandingsTable } from "@/components/tournament/standings-table";
import { getTournamentContext } from "@/lib/data/session";
import { getDecisions, getDiscipline, getEvents, getFixtures, getNominations, getParticipants, getPlayers, getSuspensions, getTeams, getTiebreakDecisions } from "@/lib/data/loaders";
import { computeStats, describeSource, evaluateQualification, formatClock, scheduleBreaks, toMinutes } from "@/lib/engine";
import { blockedPeriods, fixtureDuration, groupLabels, standingsFor } from "@/lib/domain";
import { SeedingControls } from "../knockout/seeding-controls";

export const metadata: Metadata = { title: "League review" };

export default async function ReviewPage(props: PageProps<"/tournaments/[id]/review">) {
  const { id } = await props.params;
  const ctx = await getTournamentContext(id);
  const { tournament: t, settings: s } = ctx;
  const [teams, players, fixtures, events, participants, tiebreaks, discipline, suspensions, nominations, decisions] = await Promise.all([
    getTeams(id), getPlayers(id), getFixtures(id), getEvents(id), getParticipants(id), getTiebreakDecisions(id),
    getDiscipline(id), getSuspensions(id), getNominations(id), getDecisions(id),
  ]);
  const teamMap = new Map(teams.map((x) => [x.id, x]));
  const playerMap = new Map(players.map((p) => [p.id, p]));
  const league = fixtures.filter((f) => f.stage !== "knockout" && f.status !== "cancelled");
  const confirmedLeague = league.filter((f) => f.status === "confirmed");
  const ko = fixtures.filter((f) => f.stage === "knockout");

  const scopes = t.format === "group_knockout"
    ? groupLabels(teams).map((g) => ({ key: `group:${g}`, title: `Group ${g}`, scope: { stage: "group" as const, group: g }, q: s.qualifiers_per_group ?? 0, done: league.filter((f) => f.group_label === g).every((f) => f.status === "confirmed") }))
    : [{ key: "league", title: "Final league table", scope: { stage: "league" as const }, q: s.qualifiers ?? 0, done: league.length > 0 && league.every((f) => f.status === "confirmed") }];
  const tables = scopes.map((x) => {
    const standings = standingsFor(s, teams, fixtures, events, tiebreaks, x.scope);
    return { ...x, standings, qual: evaluateQualification({ standings, qualifiers: x.q, complete: x.done, sourcePrefix: x.key, label: x.title }) };
  });
  const stats = computeStats(
    fixtures.map((f) => ({ id: f.id, homeTeamId: f.home_team_id, awayTeamId: f.away_team_id, homeScore: f.home_score, awayScore: f.away_score, status: f.status, stage: f.stage, code: f.code })),
    events.map((e) => ({ fixtureId: e.fixture_id, eventType: e.event_type, teamId: e.team_id, playerId: e.player_id, relatedPlayerId: e.related_player_id })),
    participants.map((p) => ({ fixtureId: p.fixture_id, playerId: p.player_id })),
  );

  const unresolved: { text: string; href?: string }[] = [];
  for (const f of league.filter((x) => x.status === "completed")) unresolved.push({ text: `${f.code} has ended but is not confirmed (${f.home_score}–${f.away_score}).`, href: `/tournaments/${id}/matches/${f.id}` });
  for (const f of league.filter((x) => x.status === "in_progress" || x.status === "paused")) unresolved.push({ text: `${f.code} is still being played.`, href: `/tournaments/${id}/matches/${f.id}` });
  for (const f of league.filter((x) => x.status === "abandoned")) unresolved.push({ text: `${f.code} was abandoned${f.abandoned_reason ? ` (${f.abandoned_reason})` : ""}. Reinstate, replay or record a forfeit.`, href: `/tournaments/${id}/matches/${f.id}` });
  for (const f of league.filter((x) => x.status === "scheduled" || x.status === "postponed")) unresolved.push({ text: `${f.code} has not been played yet.` });
  for (const tb of tables) for (const b of tb.qual.blockers.filter((x) => /tied/.test(x))) unresolved.push({ text: b, href: `/tournaments/${id}/standings` });
  if (!s.tiebreakers_confirmed) unresolved.push({ text: "The tie-breaker order is not confirmed, so teams level on points share a position.", href: `/tournaments/${id}/settings?tab=points` });
  for (const d of decisions.filter((x) => x.status === "open" && /tiebreak|knockout/.test(x.key))) unresolved.push({ text: `Open decision: ${d.question}`, href: `/tournaments/${id}/rules` });

  const breaks = scheduleBreaks(blockedPeriods(s).map((b) => ({ ...b })), fixtures.map((f) => ({ id: f.id, code: f.code, stage: f.stage, homeTeamId: f.home_team_id, awayTeamId: f.away_team_id, pitchId: f.pitch_id, date: f.scheduled_date, start: toMinutes(f.scheduled_time), durationMin: fixtureDuration(f, s), status: f.status })), t.start_date);
  const koBreak = breaks.find((b) => b.source === "knockout_gap");
  const ready = tables.every((x) => x.qual.ready);
  const seeded = ko.some((f) => (f.home_source && /^(league|group):/.test(f.home_source) && f.home_team_id) || (f.away_source && /^(league|group):/.test(f.away_source) && f.away_team_id));
  const preview = tables.flatMap((x) => x.qual.assignments).map((a) => ({ source: describeSource(a.source), team: teamMap.get(a.teamId)?.name ?? "?" }));
  const nominationsByPlayer = new Map<string, number>();
  for (const n of nominations) nominationsByPlayer.set(n.player_id, (nominationsByPlayer.get(n.player_id) ?? 0) + 1);
  const activeSuspensions = suspensions.filter((x) => x.status === "active").length;
  const firstSemis = ko.filter((f) => f.round_name === "Semi-final" || f.code.startsWith("SF"));

  return (
    <>
      <PageHeader
        title="League review and knockout preparation"
        description={`${confirmedLeague.length} of ${league.length} league matches confirmed. Review everything below, then confirm qualification to fill the semi-finals.`}
      />

      {t.league_confirmed_at ? (
        <Alert className="mb-6 border-success/40 bg-success/5 [&>svg]:text-success">
          <CircleCheck />
          <AlertTitle>League results and qualification confirmed</AlertTitle>
          <AlertDescription>Confirmed {new Date(t.league_confirmed_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}. The semi-finals are set.</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-6">
          {tables.map((x) => (
            <Card key={x.key} className="gap-0 py-0">
              <CardHeader className="border-b py-3">
                <CardTitle>{x.title}</CardTitle>
                <CardDescription>Top {x.q} qualify (highlighted). Only confirmed results count.</CardDescription>
              </CardHeader>
              <StandingsTable standings={x.standings} teams={teamMap} qualifiers={x.q} />
            </Card>
          ))}

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <Card className="gap-0 py-0">
              <CardHeader className="border-b py-3"><CardTitle>Most goals</CardTitle></CardHeader>
              <Table className="tabular">
                <TableBody>
                  {stats.topScorers.slice(0, 10).map((p, i) => (
                    <TableRow key={p.playerId}>
                      <TableCell className="w-8 text-muted-foreground">{i + 1}</TableCell>
                      <TableCell><div className="font-medium">{playerMap.get(p.playerId)?.full_name ?? "Unknown"}</div><div className="text-xs text-muted-foreground">{teamMap.get(playerMap.get(p.playerId)?.team_id ?? "")?.name}</div></TableCell>
                      <TableCell className="text-right font-semibold">{p.goals}</TableCell>
                    </TableRow>
                  ))}
                  {!stats.topScorers.length ? <TableRow><TableCell className="text-muted-foreground">No goals with a named scorer yet.</TableCell></TableRow> : null}
                </TableBody>
              </Table>
            </Card>
            <Card className="gap-0 py-0">
              <CardHeader className="border-b py-3"><CardTitle>Discipline</CardTitle></CardHeader>
              <Table className="tabular">
                <TableHeader><TableRow><TableHead>Team</TableHead><TableHead className="text-center">Y</TableHead><TableHead className="text-center">R</TableHead><TableHead className="text-center">Fouls</TableHead></TableRow></TableHeader>
                <TableBody>
                  {stats.teams.map((x) => (
                    <TableRow key={x.teamId}>
                      <TableCell className="max-w-0"><TeamName team={teamMap.get(x.teamId)} /></TableCell>
                      <TableCell className="text-center">{x.yellow}</TableCell>
                      <TableCell className="text-center">{x.red}</TableCell>
                      <TableCell className="text-center">{x.fouls}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="px-4 py-2 text-xs text-muted-foreground">{discipline.length} incidents recorded · {activeSuspensions} active suspension{activeSuspensions === 1 ? "" : "s"}</p>
            </Card>
          </div>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Before the semi-finals</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              {unresolved.length ? (
                <ul className="space-y-2">
                  {unresolved.map((u, i) => (
                    <li key={i} className="flex gap-2">
                      <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
                      {u.href ? <Link href={u.href} className="hover:underline">{u.text}</Link> : <span>{u.text}</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="flex items-center gap-2 text-success"><CircleCheck className="size-4" /> No unresolved results.</p>
              )}
              {koBreak ? (
                <div className="flex gap-2 rounded-lg border bg-muted/40 p-3">
                  <Coffee className="mt-0.5 size-4 shrink-0" />
                  <div>
                    <div className="font-medium">{koBreak.label}: {koBreak.durationMin} min</div>
                    <div className="text-xs text-muted-foreground">{formatClock(koBreak.start)} to {formatClock(koBreak.end)}</div>
                  </div>
                </div>
              ) : null}
              {firstSemis.length ? (
                <div className="space-y-1">
                  {firstSemis.map((f) => (
                    <div key={f.id} className="flex justify-between gap-2 text-xs">
                      <span>{f.code}: {f.home_team_id ? teamMap.get(f.home_team_id)?.name : describeSource(f.home_source)} v {f.away_team_id ? teamMap.get(f.away_team_id)?.name : describeSource(f.away_source)}</span>
                      <span className="text-muted-foreground tabular">{f.scheduled_time ? formatClock(toMinutes(f.scheduled_time)) : "TBC"}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>

          {ko.length && t.format !== "single_elimination" && t.format !== "double_elimination" ? (
            <Card>
              <CardHeader>
                <CardTitle>Confirm qualification</CardTitle>
                <CardDescription>Semi-final 1: League 1st v League 4th. Semi-final 2: League 2nd v League 3rd.</CardDescription>
              </CardHeader>
              <CardContent>
                <SeedingControls
                  tournamentId={id}
                  isAdmin={ctx.isAdmin}
                  ready={ready}
                  blockers={tables.flatMap((x) => x.qual.blockers)}
                  preview={preview}
                  seeded={seeded}
                  started={ko.some((f) => f.status !== "scheduled" && f.status !== "postponed")}
                  allowProvisional={s.allow_provisional_seeding}
                />
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader><CardTitle>MVP candidates</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {[...nominationsByPlayer.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([pid, n]) => (
                <div key={pid} className="flex justify-between"><span>{playerMap.get(pid)?.full_name ?? "Unknown"}</span><Badge variant="secondary">{n} nomination{n === 1 ? "" : "s"}</Badge></div>
              ))}
              {!nominations.length ? <p className="text-muted-foreground">No nominations yet.</p> : null}
              <Button asChild variant="outline" size="sm"><Link href={`/tournaments/${id}/awards`}>Awards and MVP</Link></Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
