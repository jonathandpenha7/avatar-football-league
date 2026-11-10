import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RealtimeRefresher } from "@/components/app/realtime-refresher";
import { getTournamentContext } from "@/lib/data/session";
import { getFixtures, getMembers, getOfficials, getPitches, getPlayers, getSuspensions, getTeams } from "@/lib/data/loaders";
import { preMatchAlerts } from "@/lib/engine";
import { toDisciplineFixture } from "@/lib/domain";
import type { MatchEvent } from "@/lib/types";
import { Scoreboard } from "./scoreboard";

export default async function MatchPage(props: PageProps<"/tournaments/[id]/matches/[fixtureId]">) {
  const { id, fixtureId } = await props.params;
  const ctx = await getTournamentContext(id);
  const [fixtures, teams, players, pitches, officials, suspensions] = await Promise.all([
    getFixtures(id),
    getTeams(id),
    getPlayers(id),
    getPitches(id),
    getOfficials(id),
    getSuspensions(id),
  ]);
  const fixture = fixtures.find((f) => f.id === fixtureId);
  if (!fixture) notFound();
  const { data: eventRows } = await ctx.supabase
    .from("match_events")
    .select("*")
    .eq("fixture_id", fixtureId)
    .order("created_at", { ascending: true });
  const events = (eventRows ?? []) as MatchEvent[];
  const members = ctx.isAdmin || officials.some((o) => o.user_id === ctx.profile.id) ? await getMembers(id) : [];
  const memberName = new Map(members.map((m) => [m.user_id, m.profile?.full_name ?? m.profile?.email ?? "Organiser"]));

  const fixtureOfficials = officials.filter((o) => o.fixture_id === fixtureId);
  const assignedAs = fixtureOfficials.filter((o) => o.user_id === ctx.profile.id).map((o) => o.role);
  const matchCtx = { assignedAs, refereeCanConfirm: ctx.settings.referee_can_confirm };
  const teamIds = [fixture.home_team_id, fixture.away_team_id];
  const squad = players.filter((p) => p.team_id && teamIds.includes(p.team_id) && p.registration_status !== "withdrawn");

  const alerts = preMatchAlerts(
    toDisciplineFixture(fixture),
    squad.map((p) => ({
      id: p.id,
      fullName: p.full_name,
      teamId: p.team_id,
      registrationStatus: p.registration_status,
      eligibilityStatus: p.eligibility_status,
      eligibilityNote: p.eligibility_note,
    })),
    suspensions.map((s) => ({
      id: s.id,
      playerId: s.player_id,
      teamId: s.team_id,
      startsAfterFixtureId: s.starts_after_fixture_id,
      matches: s.matches,
      status: s.status,
      reason: s.reason,
    })),
    fixtures.map(toDisciplineFixture),
  );
  const confirmedCount = new Map<string, number>();
  for (const p of squad) if (p.registration_status === "confirmed") confirmedCount.set(p.team_id!, (confirmedCount.get(p.team_id!) ?? 0) + 1);

  return (
    <>
      <div className="no-print mb-3 flex items-center justify-between">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href={`/tournaments/${id}/matches`}><ChevronLeft /> Match centre</Link>
        </Button>
        <RealtimeRefresher tournamentId={id} fixtureId={fixtureId} />
      </div>
      <Scoreboard
        tournamentId={id}
        fixture={fixture}
        home={teams.find((t) => t.id === fixture.home_team_id) ?? null}
        away={teams.find((t) => t.id === fixture.away_team_id) ?? null}
        players={squad}
        events={events}
        pitchName={pitches.find((p) => p.id === fixture.pitch_id)?.name ?? null}
        officials={fixtureOfficials.map((o) => ({ ...o, name: memberName.get(o.user_id) ?? "Assigned" }))}
        authorNames={Object.fromEntries(memberName)}
        alerts={alerts}
        settings={{
          periods: ctx.settings.periods,
          matchDurationMin: ctx.settings.match_duration_min,
          extraTime: ctx.settings.extra_time_enabled,
          shootoutKicks: ctx.settings.shootout_kicks,
          forfeitGoals: ctx.settings.forfeit_goals,
          minPlayers: ctx.settings.min_players_to_start,
          secondYellowIsRed: ctx.settings.second_yellow_is_red,
        }}
        squadCounts={Object.fromEntries(confirmedCount)}
        permissions={{
          record: ctx.can("match.record", matchCtx) && fixture.status !== "confirmed",
          control: ctx.can("match.control", matchCtx),
          confirm: ctx.can("match.confirm", matchCtx),
          correct: ctx.can("match.correct"),
          admin: ctx.isAdmin,
          refereeNotes: ctx.isAdmin || assignedAs.includes("referee"),
        }}
      />
    </>
  );
}
