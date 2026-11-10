import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { getTournamentContext } from "@/lib/data/session";
import { getFixtures, getPitches, getTeams } from "@/lib/data/loaders";
import { siteUrl } from "@/lib/supabase/env";
import { SettingsForm } from "./settings-form";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage(props: PageProps<"/tournaments/[id]/settings">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const ctx = await getTournamentContext(id);
  if (!ctx.isAdmin) notFound();
  const [pitches, fixtures, teams] = await Promise.all([getPitches(id), getFixtures(id), getTeams(id)]);
  const started = fixtures.some((f) => f.status !== "scheduled" && f.status !== "postponed" && f.status !== "cancelled");
  const { tournament_id: _omit, ...settings } = ctx.settings;
  void _omit;
  return (
    <>
      <PageHeader title="Settings" description="Configuration for this tournament only. Other tournaments are not affected." />
      <SettingsForm
        tournament={ctx.tournament}
        settings={settings}
        pitches={pitches.map((p) => ({ id: p.id, name: p.name, available_from: p.available_from, available_until: p.available_until }))}
        teams={teams.map((t) => ({ id: t.id, name: t.name, seed: t.seed, groupLabel: t.group_label }))}
        formatLocked={started}
        hasFixtures={fixtures.length > 0}
        isSuperAdmin={ctx.profile.is_super_admin}
        canCreate={ctx.can("tournament.create")}
        siteUrl={siteUrl()}
        initialTab={typeof sp.tab === "string" ? sp.tab : "general"}
      />
    </>
  );
}
