import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { RealtimeRefresher } from "@/components/app/realtime-refresher";
import { getTournamentContext } from "@/lib/data/session";
import { getFixtures, getMembers, getOfficials, getPitches, getTeams } from "@/lib/data/loaders";
import { todayIn } from "@/lib/domain";
import { MatchCentre } from "./match-centre";

export const metadata: Metadata = { title: "Match centre" };

export default async function MatchesPage(props: PageProps<"/tournaments/[id]/matches">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const ctx = await getTournamentContext(id);
  const [fixtures, teams, pitches, officials] = await Promise.all([getFixtures(id), getTeams(id), getPitches(id), getOfficials(id)]);
  const mine = officials.filter((o) => o.user_id === ctx.profile.id).map((o) => o.fixture_id);
  const members = await getMembers(id);
  const nameOf = new Map(members.map((m) => [m.user_id, m.profile?.full_name ?? m.profile?.email ?? "Organiser"]));
  const referees: Record<string, string[]> = {};
  for (const o of officials) if (o.role === "referee") (referees[o.fixture_id] ??= []).push(nameOf.get(o.user_id) ?? "Assigned");
  return (
    <>
      <PageHeader title="Match centre" description="Open a match to keep score. Changes appear on every device instantly." actions={<RealtimeRefresher tournamentId={id} />} />
      <MatchCentre
        tournamentId={id}
        fixtures={fixtures}
        teams={teams}
        pitches={pitches}
        myFixtureIds={mine}
        referees={referees}
        today={todayIn(ctx.tournament.timezone)}
        initialView={typeof sp.view === "string" ? sp.view : undefined}
        isAdmin={ctx.isAdmin}
      />
    </>
  );
}
