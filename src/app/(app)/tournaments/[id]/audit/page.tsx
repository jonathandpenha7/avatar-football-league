import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { History } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { getTournamentContext } from "@/lib/data/session";
import { getMembers } from "@/lib/data/loaders";
import type { AuditLog } from "@/lib/types";

export const metadata: Metadata = { title: "Audit log" };

const LABELS: Record<string, string> = {
  result_confirmed: "Result confirmed",
  result_reopened: "Result reopened for correction",
  result_reconfirmed: "Corrected result confirmed",
  forfeit_recorded: "Forfeit recorded",
  forfeit_cleared: "Forfeit cleared",
  fixtures_generated: "Fixtures generated",
  knockout_seeded: "Knockout seeded",
  knockout_seeded_provisionally: "Knockout seeded provisionally",
  create: "Created",
  clone: "Created from a copy",
  insert: "Added",
  update: "Changed",
  delete: "Deleted",
};

function summarise(log: AuditLog): string | null {
  const b = log.before_data ?? {};
  const a = log.after_data ?? {};
  if ("home_score" in a || "home_score" in b) {
    const before = "home_score" in b ? `${b.home_score}–${b.away_score}` : null;
    const after = "home_score" in a ? `${a.home_score}–${a.away_score}` : null;
    if (before && after && before !== after) return `${before} → ${after}`;
    return after ?? before;
  }
  if (log.action === "update" && log.before_data && log.after_data) {
    const changed = Object.keys(a).filter((k) => !["updated_at"].includes(k) && JSON.stringify(a[k]) !== JSON.stringify(b[k]));
    return changed.length ? `Fields: ${changed.slice(0, 6).join(", ")}${changed.length > 6 ? "…" : ""}` : null;
  }
  if (typeof a.name === "string") return a.name;
  if (typeof b.name === "string") return b.name;
  if (typeof a.code === "string") return a.code;
  if (typeof b.code === "string") return b.code;
  if (typeof b.full_name === "string") return b.full_name;
  return null;
}

export default async function AuditPage(props: PageProps<"/tournaments/[id]/audit">) {
  const { id } = await props.params;
  const ctx = await getTournamentContext(id);
  if (!ctx.isAdmin) notFound();
  const [{ data }, members] = await Promise.all([
    ctx.supabase.from("audit_logs").select("*").eq("tournament_id", id).order("created_at", { ascending: false }).limit(300),
    getMembers(id),
  ]);
  const logs = (data ?? []) as AuditLog[];
  const who = new Map(members.map((m) => [m.user_id, m.profile?.full_name ?? m.profile?.email ?? "Member"]));
  return (
    <>
      <PageHeader title="Audit log" description="Score confirmations, corrections, deletions and configuration changes. Showing the latest 300 entries." />
      {logs.length === 0 ? (
        <EmptyState icon={History} title="No entries yet" />
      ) : (
        <Card className="gap-0 divide-y py-0">
          {logs.map((l) => (
            <div key={l.id} className="grid gap-1 px-4 py-2.5 text-sm sm:grid-cols-[10rem_1fr_auto]">
              <div className="text-xs text-muted-foreground tabular">{new Date(l.created_at).toLocaleString([], { dateStyle: "medium", timeStyle: "medium" })}</div>
              <div className="min-w-0">
                <span className="font-medium">{LABELS[l.action] ?? l.action}</span>{" "}
                <Badge variant="outline" className="ml-1">{l.entity_type.replace(/_/g, " ")}</Badge>
                {summarise(l) ? <span className="ml-2 text-muted-foreground">{summarise(l)}</span> : null}
                {l.reason ? <div className="text-xs">Reason: {l.reason}</div> : null}
              </div>
              <div className="text-xs text-muted-foreground">{l.actor_id ? who.get(l.actor_id) ?? "Former member" : "System"}</div>
            </div>
          ))}
        </Card>
      )}
    </>
  );
}
