import type { Metadata } from "next";
import { Network } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { RealtimeRefresher } from "@/components/app/realtime-refresher";
import { Bracket } from "@/components/tournament/bracket";
import { getTournamentContext } from "@/lib/data/session";
import { getEvents, getFixtures, getTeams, getTiebreakDecisions } from "@/lib/data/loaders";
import { evaluateQualification, describeSource } from "@/lib/engine";
import { groupLabels, standingsFor } from "@/lib/domain";
import { SeedingControls } from "./seeding-controls";

export const metadata: Metadata = { title: "Knockout" };

export default async function KnockoutPage(props: PageProps<"/tournaments/[id]/knockout">) {
  const { id } = await props.params;
  const ctx = await getTournamentContext(id);
  const { tournament: t, settings: s } = ctx;
  const [teams, fixtures, events, decisions] = await Promise.all([getTeams(id), getFixtures(id), getEvents(id), getTiebreakDecisions(id)]);
  const teamMap = new Map(teams.map((x) => [x.id, x]));
  const ko = fixtures.filter((f) => f.stage === "knockout");
  const seedsFromTable = t.format === "league_playoff" || t.format === "group_knockout";

  const evaluations = !seedsFromTable
    ? []
    : t.format === "league_playoff"
      ? [
          evaluateQualification({
            standings: standingsFor(s, teams, fixtures, events, decisions, { stage: "league" }),
            qualifiers: s.qualifiers ?? 0,
            complete: fixtures.some((f) => f.stage === "league") && fixtures.filter((f) => f.stage === "league" && f.status !== "cancelled").every((f) => f.status === "confirmed"),
            sourcePrefix: "league",
            label: "League",
          }),
        ]
      : groupLabels(teams).map((g) =>
          evaluateQualification({
            standings: standingsFor(s, teams, fixtures, events, decisions, { stage: "group", group: g }),
            qualifiers: s.qualifiers_per_group ?? 0,
            complete: fixtures.filter((f) => f.stage === "group" && f.group_label === g && f.status !== "cancelled").every((f) => f.status === "confirmed"),
            sourcePrefix: `group:${g}`,
            label: `Group ${g}`,
          }),
        );
  const ready = evaluations.length > 0 && evaluations.every((e) => e.ready);
  const blockers = evaluations.flatMap((e) => e.blockers);
  const preview = evaluations.flatMap((e) => e.assignments).map((a) => ({ source: describeSource(a.source), team: teamMap.get(a.teamId)?.name ?? "?" }));
  const seeded = ko.some((f) => (f.home_source && /^(league|group):/.test(f.home_source) && f.home_team_id) || (f.away_source && /^(league|group):/.test(f.away_source) && f.away_team_id));
  const started = ko.some((f) => f.status !== "scheduled" && f.status !== "postponed");

  return (
    <>
      <PageHeader title="Knockout stage" description="Winners advance automatically when results are confirmed." actions={<RealtimeRefresher tournamentId={id} />} />
      {seedsFromTable && ko.length ? (
        <Card className="no-print mb-6">
          <CardHeader>
            <CardTitle>Qualification and seeding</CardTitle>
            <CardDescription>
              {ready
                ? "All qualification criteria are met."
                : "Knockout places are filled only when every qualifying match is confirmed and no tie affects a qualifying position."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SeedingControls
              tournamentId={id}
              isAdmin={ctx.isAdmin}
              ready={ready}
              blockers={blockers}
              preview={preview}
              seeded={seeded}
              started={started}
              allowProvisional={s.allow_provisional_seeding}
            />
          </CardContent>
        </Card>
      ) : null}
      {ko.length ? (
        <Bracket fixtures={fixtures} teams={teamMap} hrefBase={`/tournaments/${id}/matches`} />
      ) : (
        <EmptyState icon={Network} title="No knockout fixtures yet" description="Knockout fixtures are created with the rest of the fixtures on the Fixtures page." />
      )}
    </>
  );
}
