import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { getTournamentContext } from "@/lib/data/session";
import { getDiscipline, getEvents, getFixtures, getMembers, getPlayers, getSuspensions, getTeams } from "@/lib/data/loaders";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TeamName } from "@/components/app/team-name";
import { suspensionProgress, yellowsUntilSuspension } from "@/lib/engine";
import { toDisciplineFixture } from "@/lib/domain";
import { DisciplineView } from "./discipline-view";

export const metadata: Metadata = { title: "Discipline" };

export default async function DisciplinePage(props: PageProps<"/tournaments/[id]/discipline">) {
  const { id } = await props.params;
  const ctx = await getTournamentContext(id);
  const s = ctx.settings;
  const [records, suspensions, players, teams, fixtures] = await Promise.all([getDiscipline(id), getSuspensions(id), getPlayers(id), getTeams(id), getFixtures(id)]);
  const members = await getMembers(id).catch(() => []);
  const events = await getEvents(id);
  // Every recorded event counts here (including matches not yet confirmed), because discipline applies immediately.
  const teamRec = teams.map((t) => {
    const ev = events.filter((e) => e.team_id === t.id);
    return { team: t, y: ev.filter((e) => e.event_type === "yellow_card").length, r: ev.filter((e) => e.event_type === "red_card").length, fouls: ev.filter((e) => e.event_type === "foul").length, tp: ev.filter((e) => e.event_type === "sin_bin").length };
  });
  const playerRec = players
    .map((p) => {
      const ev = events.filter((e) => e.player_id === p.id);
      return { p, y: ev.filter((e) => e.event_type === "yellow_card").length, r: ev.filter((e) => e.event_type === "red_card").length, fouls: ev.filter((e) => e.event_type === "foul").length, tp: ev.filter((e) => e.event_type === "sin_bin").length, susp: suspensions.filter((x) => x.player_id === p.id).length };
    })
    .filter((x) => x.y || x.r || x.fouls || x.tp || x.susp)
    .sort((a, b) => b.r - a.r || b.y - a.y || b.fouls - a.fouls);
  const teamName = new Map(teams.map((t) => [t.id, t.name]));
  const dfx = fixtures.map(toDisciplineFixture);
  const progress = Object.fromEntries(
    suspensions.map((x) => [
      x.id,
      suspensionProgress({ id: x.id, playerId: x.player_id, teamId: x.team_id, startsAfterFixtureId: x.starts_after_fixture_id, matches: x.matches, status: x.status, reason: x.reason }, dfx),
    ]),
  );
  const yellowCounts = new Map<string, number>();
  for (const r of records) if (r.incident_type === "yellow_card" && r.player_id) yellowCounts.set(r.player_id, (yellowCounts.get(r.player_id) ?? 0) + 1);
  const atRisk = [...yellowCounts.entries()]
    .map(([pid, n]) => ({ playerId: pid, yellows: n, until: yellowsUntilSuspension(n, s.yellow_accumulation_threshold) }))
    .filter((x) => x.until === 1);

  const rules: string[] = [];
  rules.push(s.second_yellow_is_red ? "Two yellow cards in one match count as a red card." : "Two yellow cards in one match do not automatically count as a red card.");
  rules.push(
    s.red_card_suspension_matches === null
      ? "Red card suspension: not decided, so no automatic suspension is applied."
      : s.red_card_suspension_matches === 0
        ? "Red cards carry no suspension beyond the match."
        : `A red card suspends the player for ${s.red_card_suspension_matches} match${s.red_card_suspension_matches > 1 ? "es" : ""}.`,
  );
  rules.push(
    s.yellow_accumulation_threshold
      ? `${s.yellow_accumulation_threshold} yellow cards lead to a ${s.yellow_accumulation_suspension_matches}-match suspension.`
      : "Yellow card accumulation: no rule configured.",
  );

  return (
    <>
      <PageHeader title="Discipline" description="Cards, time penalties and suspensions. Suspensions are served as the player's team plays confirmed matches." />
      <DisciplineView
        tournamentId={id}
        tournamentName={ctx.tournament.name}
        isAdmin={ctx.isAdmin}
        records={records}
        suspensions={suspensions}
        progress={progress}
        players={players.map((p) => ({ id: p.id, name: p.full_name, teamId: p.team_id }))}
        teams={teams.map((t) => ({ id: t.id, name: t.name, colour: t.colour, logo_url: t.logo_url }))}
        fixtures={fixtures.map((f) => ({ id: f.id, code: f.code, status: f.status }))}
        referees={Object.fromEntries(members.map((m) => [m.user_id, m.profile?.full_name ?? m.profile?.email ?? "Referee"]))}
        rules={rules}
        atRisk={atRisk}
      />
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="gap-0 py-0">
          <CardHeader className="border-b py-3"><CardTitle>Team disciplinary records</CardTitle><CardDescription>All recorded events, including matches awaiting confirmation.</CardDescription></CardHeader>
          <Table className="tabular">
            <TableHeader><TableRow><TableHead>Team</TableHead><TableHead className="text-center">Y</TableHead><TableHead className="text-center">R</TableHead><TableHead className="text-center">Fouls</TableHead><TableHead className="text-center" title="Time penalties">TP</TableHead></TableRow></TableHeader>
            <TableBody>
              {teamRec.map((x) => (
                <TableRow key={x.team.id}><TableCell className="max-w-0"><TeamName team={x.team} /></TableCell><TableCell className="text-center">{x.y}</TableCell><TableCell className="text-center">{x.r}</TableCell><TableCell className="text-center">{x.fouls}</TableCell><TableCell className="text-center">{x.tp}</TableCell></TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
        <Card className="gap-0 py-0">
          <CardHeader className="border-b py-3"><CardTitle>Player disciplinary history</CardTitle></CardHeader>
          <Table className="tabular">
            <TableHeader><TableRow><TableHead>Player</TableHead><TableHead className="text-center">Y</TableHead><TableHead className="text-center">R</TableHead><TableHead className="text-center">Fouls</TableHead><TableHead className="text-center" title="Time penalties">TP</TableHead><TableHead className="text-center" title="Suspensions">S</TableHead></TableRow></TableHeader>
            <TableBody>
              {playerRec.map((x) => (
                <TableRow key={x.p.id}><TableCell><div className="font-medium">{x.p.full_name}</div><div className="text-xs text-muted-foreground">{x.p.team_id ? teamName.get(x.p.team_id) : ""}</div></TableCell><TableCell className="text-center">{x.y}</TableCell><TableCell className="text-center">{x.r}</TableCell><TableCell className="text-center">{x.fouls}</TableCell><TableCell className="text-center">{x.tp}</TableCell><TableCell className="text-center">{x.susp}</TableCell></TableRow>
              ))}
              {!playerRec.length ? <TableRow><TableCell colSpan={6} className="text-muted-foreground">No disciplinary events recorded.</TableCell></TableRow> : null}
            </TableBody>
          </Table>
        </Card>
      </div>
    </>
  );
}
