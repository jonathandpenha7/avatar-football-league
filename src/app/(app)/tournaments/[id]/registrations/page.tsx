import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { getTournamentContext } from "@/lib/data/session";
import { getPlayers, getTeams } from "@/lib/data/loaders";
import { siteUrl } from "@/lib/supabase/env";
import type { Registration } from "@/lib/types";
import { RegistrationsView } from "./registrations-view";

export const metadata: Metadata = { title: "Registrations" };

export default async function RegistrationsPage(props: PageProps<"/tournaments/[id]/registrations">) {
  const { id } = await props.params;
  const ctx = await getTournamentContext(id);
  if (!ctx.isAdmin) notFound();
  const [teams, players, { data }] = await Promise.all([
    getTeams(id),
    getPlayers(id),
    ctx.supabase.from("registrations").select("*").eq("tournament_id", id).order("created_at", { ascending: false }),
  ]);
  const squad: Record<string, number> = {};
  for (const p of players) if (p.team_id && p.registration_status === "confirmed") squad[p.team_id] = (squad[p.team_id] ?? 0) + 1;
  return (
    <>
      <PageHeader title="Registrations" description="Online submissions become players only after you approve them. Payment is tracked separately and never assumed." />
      <RegistrationsView
        tournamentId={id}
        registrations={(data ?? []) as Registration[]}
        teams={teams.map((t) => ({ id: t.id, name: t.name }))}
        squad={squad}
        maxSquad={ctx.settings.max_squad_size}
        link={`${siteUrl()}/register/${ctx.tournament.registration_token}`}
        open={ctx.tournament.registration_open}
        existingNames={players.map((p) => p.full_name.toLowerCase())}
      />
    </>
  );
}
