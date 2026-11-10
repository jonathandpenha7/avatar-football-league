import type { Metadata } from "next";
import { getTournamentContext } from "@/lib/data/session";
import { getPlayers, getSuspensions, getFixtures, getTeams } from "@/lib/data/loaders";
import { PageHeader } from "@/components/app/page-header";
import { playerEligibility } from "@/lib/engine";
import { toDisciplineFixture } from "@/lib/domain";
import type { PlayerContact } from "@/lib/types";
import { TeamsView } from "./teams-view";

export const metadata: Metadata = { title: "Teams and players" };

export default async function TeamsPage(props: PageProps<"/tournaments/[id]/teams">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const ctx = await getTournamentContext(id);
  const [teams, players, suspensions, fixtures] = await Promise.all([getTeams(id), getPlayers(id), getSuspensions(id), getFixtures(id)]);
  let contacts: PlayerContact[] = [];
  if (ctx.isAdmin) {
    const { data } = await ctx.supabase.from("player_contacts").select("player_id, email, phone").eq("tournament_id", id);
    contacts = (data ?? []) as PlayerContact[];
  }
  const dfx = fixtures.map(toDisciplineFixture);
  const suspended = players
    .filter((p) =>
      !playerEligibility(
        { id: p.id, fullName: p.full_name, teamId: p.team_id, registrationStatus: "confirmed", eligibilityStatus: "eligible" },
        suspensions.map((s) => ({ id: s.id, playerId: s.player_id, teamId: s.team_id, startsAfterFixtureId: s.starts_after_fixture_id, matches: s.matches, status: s.status, reason: s.reason })),
        dfx,
      ).eligible,
    )
    .map((p) => p.id);

  return (
    <>
      <PageHeader
        title="Teams and players"
        description={`${teams.length} teams, ${players.filter((p) => p.registration_status === "confirmed").length} confirmed players. Squads are limited to ${ctx.settings.max_squad_size}.`}
      />
      <TeamsView
        tournamentId={id}
        tournamentName={ctx.tournament.name}
        isAdmin={ctx.isAdmin}
        teams={teams}
        players={players}
        contacts={contacts}
        positions={ctx.settings.positions}
        maxSquad={ctx.settings.max_squad_size}
        minToStart={ctx.settings.min_players_to_start ?? ctx.settings.players_on_pitch}
        showGroups={ctx.tournament.format === "group_knockout"}
        suspendedIds={suspended}
        openNew={sp.new === "team" || sp.new === "player" ? sp.new : null}
      />
    </>
  );
}
