import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { getTournamentContext } from "@/lib/data/session";
import { getFixtures, getMembers, getOfficials, getPitches, getTeams } from "@/lib/data/loaders";
import { siteUrl } from "@/lib/supabase/env";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Invitation } from "@/lib/types";
import { OfficialsView } from "./officials-view";

export const metadata: Metadata = { title: "Organisers and officials" };

export default async function OfficialsPage(props: PageProps<"/tournaments/[id]/officials">) {
  const { id } = await props.params;
  const ctx = await getTournamentContext(id);
  if (!ctx.isAdmin) notFound();
  const [members, officials, fixtures, teams, pitches, inv] = await Promise.all([
    getMembers(id),
    getOfficials(id),
    getFixtures(id),
    getTeams(id),
    getPitches(id),
    ctx.supabase.from("tournament_invitations").select("*").eq("tournament_id", id).is("accepted_at", null).is("revoked_at", null).order("created_at", { ascending: false }),
  ]);
  return (
    <>
      <PageHeader title="Organisers and officials" description="Invite people, set their role in this tournament and assign referees and scorekeepers to matches." />
      <OfficialsView
        tournamentId={id}
        currentUserId={ctx.profile.id}
        members={members}
        invitations={(inv.data ?? []) as Invitation[]}
        officials={officials}
        fixtures={fixtures}
        teams={teams.map((t) => ({ id: t.id, name: t.name }))}
        pitches={pitches.map((p) => ({ id: p.id, name: p.name }))}
        siteUrl={siteUrl()}
        emailConfigured={!!createAdminClient()}
      />
    </>
  );
}
