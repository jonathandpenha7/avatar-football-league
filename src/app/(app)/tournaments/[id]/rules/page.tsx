import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { getTournamentContext } from "@/lib/data/session";
import { getAnnouncements, getDecisions, getRules } from "@/lib/data/loaders";
import { RulesView } from "./rules-view";

export const metadata: Metadata = { title: "Rules and decisions" };

export default async function RulesPage(props: PageProps<"/tournaments/[id]/rules">) {
  const { id } = await props.params;
  const ctx = await getTournamentContext(id);
  const [rules, decisions, announcements] = await Promise.all([getRules(id), getDecisions(id), getAnnouncements(id)]);
  return (
    <>
      <PageHeader title="Rules and decisions" description="Tournament-specific rules, the organiser decision checklist and announcements." />
      <RulesView
        tournamentId={id}
        isAdmin={ctx.isAdmin}
        rules={rules}
        decisions={decisions}
        announcements={announcements}
        rulesPublished={ctx.tournament.rules_published}
        publicEnabled={ctx.tournament.public_enabled}
      />
    </>
  );
}
