import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { requireSession } from "@/lib/data/session";
import { TEMPLATES } from "@/lib/templates";
import { CreateWizard } from "./create-wizard";

export const metadata: Metadata = { title: "Create tournament" };

export default async function NewTournamentPage(props: PageProps<"/tournaments/new">) {
  const { profile } = await requireSession();
  if (!profile.is_super_admin && !profile.can_create_tournaments) redirect("/tournaments");
  const sp = await props.searchParams;
  const template = typeof sp.template === "string" ? sp.template : null;
  return (
    <>
      <PageHeader title="Create a tournament" description="Set up the format, rules and schedule. Everything can be changed later in Settings." />
      <CreateWizard
        initialTemplate={template}
        templates={TEMPLATES.map((t) => ({
          key: t.key,
          name: t.name,
          description: t.description,
          format: t.format,
          dailyStart: t.dailyStart,
          dailyEnd: t.dailyEnd,
          pitches: t.pitches,
          teamCountOptions: t.teamCountOptions,
          settings: t.settings,
          decisionCount: t.decisions.length,
          ruleCount: t.rules.length,
        }))}
      />
    </>
  );
}
