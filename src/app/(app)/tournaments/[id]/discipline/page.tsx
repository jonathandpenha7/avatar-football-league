import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { getTournamentContext } from "@/lib/data/session";
import { getDiscipline, getFixtures, getMembers, getPlayers, getSuspensions, getTeams } from "@/lib/data/loaders";
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
    </>
  );
}
