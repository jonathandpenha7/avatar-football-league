import type { Metadata } from "next";
import { Info } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PageHeader } from "@/components/app/page-header";
import { RealtimeRefresher } from "@/components/app/realtime-refresher";
import { EmptyState } from "@/components/app/empty-state";
import { StandingsTable } from "@/components/tournament/standings-table";
import { getTournamentContext } from "@/lib/data/session";
import { getEvents, getFixtures, getTeams, getTiebreakDecisions } from "@/lib/data/loaders";
import { groupLabels, standingsFor } from "@/lib/domain";
import { TIEBREAKER_LABELS } from "@/lib/engine";
import { StandingsTools } from "./standings-tools";

export const metadata: Metadata = { title: "Standings" };

export default async function StandingsPage(props: PageProps<"/tournaments/[id]/standings">) {
  const { id } = await props.params;
  const ctx = await getTournamentContext(id);
  const { tournament: t, settings: s } = ctx;
  const [teams, fixtures, events, decisions] = await Promise.all([getTeams(id), getFixtures(id), getEvents(id), getTiebreakDecisions(id)]);
  const teamMap = new Map(teams.map((x) => [x.id, x]));

  const scopes =
    t.format === "group_knockout"
      ? groupLabels(teams).map((g) => ({ key: `group:${g}`, title: `Group ${g}`, scope: { stage: "group" as const, group: g }, qualifiers: s.qualifiers_per_group }))
      : t.format === "round_robin" || t.format === "league_playoff"
        ? [{ key: "league", title: "League table", scope: { stage: "league" as const }, qualifiers: t.format === "league_playoff" ? s.qualifiers : null }]
        : [];
  const tables = scopes.map((x) => ({ ...x, standings: standingsFor(s, teams, fixtures, events, decisions, x.scope) }));
  const confirmedCount = fixtures.filter((f) => f.stage !== "knockout" && f.status === "confirmed").length;
  const total = fixtures.filter((f) => f.stage !== "knockout" && f.status !== "cancelled").length;
  const criteria = s.tiebreakers.map((c) => TIEBREAKER_LABELS[c]).join(", ");

  return (
    <>
      <PageHeader
        title="Standings"
        description={`Calculated from ${confirmedCount} of ${total} confirmed matches. Win ${s.points_win}, draw ${s.points_draw}, loss ${s.points_loss}.`}
        actions={<RealtimeRefresher tournamentId={id} />}
      />
      {tables.length === 0 ? (
        <EmptyState title="No league table for this format" description="Knockout-only tournaments are shown on the Knockout page." />
      ) : (
        <div className="space-y-6">
          <Alert className="no-print">
            <Info />
            <AlertDescription>
              {s.tiebreakers_confirmed
                ? `Teams level on points are separated by: ${criteria || "no further criteria"}.`
                : `Tie-breakers (${criteria || "none"}) are not confirmed yet, so teams level on points share a position. Confirm them in Settings.`}
              {tables.some((x) => x.qualifiers) ? " Green rows are in qualifying positions." : ""}
            </AlertDescription>
          </Alert>
          {tables.map((x) => (
            <section key={x.key} className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">{x.title}</h2>
                <StandingsTools
                  tournamentId={id}
                  tournamentName={t.name}
                  scopeKey={x.key}
                  title={x.title}
                  rows={x.standings.rows.map((r) => ({ ...r }))}
                  unresolvedTies={x.standings.unresolvedTies.map((tie) => tie.map((tid) => ({ id: tid, name: teamMap.get(tid)?.name ?? tid })))}
                  canDecide={ctx.isAdmin && s.tiebreakers.includes("organiser_decision")}
                  decisions={decisions.filter((d) => d.scope === x.key).map((d) => ({ ...d, names: d.ordered_team_ids.map((tid) => teamMap.get(tid)?.name ?? "?") }))}
                  isAdmin={ctx.isAdmin}
                />
              </div>
              <Card className="gap-0 py-0">
                <StandingsTable standings={x.standings} teams={teamMap} qualifiers={x.qualifiers} />
              </Card>
              {x.standings.notes.map((n) => (
                <p key={n} className="text-xs text-muted-foreground">{n}</p>
              ))}
            </section>
          ))}
        </div>
      )}
    </>
  );
}
