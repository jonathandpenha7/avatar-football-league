import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { getTournamentContext } from "@/lib/data/session";
import { getFixtures, getPitches, getTeams } from "@/lib/data/loaders";
import { detectConflicts, toMinutes } from "@/lib/engine";
import { blockedPeriods, fixtureDuration, playingDays } from "@/lib/domain";
import { FixturesView } from "./fixtures-view";

export const metadata: Metadata = { title: "Fixtures and schedule" };

export default async function FixturesPage(props: PageProps<"/tournaments/[id]/fixtures">) {
  const { id } = await props.params;
  const ctx = await getTournamentContext(id);
  const [fixtures, teams, pitches] = await Promise.all([getFixtures(id), getTeams(id), getPitches(id)]);
  const teamName = new Map(teams.map((t) => [t.id, t.name]));
  const pitchName = new Map(pitches.map((p) => [p.id, p.name]));
  const conflicts = detectConflicts(
    fixtures.map((f) => ({
      id: f.id,
      code: f.code,
      homeTeamId: f.home_team_id,
      awayTeamId: f.away_team_id,
      homeSource: f.home_source,
      awaySource: f.away_source,
      pitchId: f.pitch_id,
      date: f.scheduled_date,
      start: toMinutes(f.scheduled_time),
      durationMin: fixtureDuration(f, ctx.settings),
      status: f.status,
    })),
    {
      transitionMin: ctx.settings.transition_min ?? 0,
      windows: playingDays(ctx.tournament),
      blocked: blockedPeriods(ctx.settings),
      teamName: (tid) => teamName.get(tid) ?? "A team",
      pitchName: (pid) => pitchName.get(pid) ?? "a pitch",
    },
  );
  const { tournament_id: _omit, ...settings } = ctx.settings;
  void _omit;
  return (
    <>
      <PageHeader
        title="Fixtures and schedule"
        description={
          ctx.isAdmin
            ? "Generate the fixture list and schedule, check for conflicts, then publish."
            : "The match schedule across all pitches."
        }
      />
      <FixturesView
        tournament={ctx.tournament}
        settings={settings}
        fixtures={fixtures}
        teams={teams}
        pitches={pitches}
        conflicts={conflicts}
        isAdmin={ctx.isAdmin}
      />
    </>
  );
}
