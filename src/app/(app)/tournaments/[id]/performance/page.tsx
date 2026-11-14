import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Gauge } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { getTournamentContext } from "@/lib/data/session";
import { serverTimeMs } from "@/lib/server-time";
import { groupKey, summarisePerf, type PerfRowLite } from "@/lib/perf-summary";

export const metadata: Metadata = { title: "Performance" };

const fmt = (v: number | null) => (v === null ? "–" : v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${v} ms`);

export default async function PerformancePage(props: PageProps<"/tournaments/[id]/performance">) {
  const { id } = await props.params;
  const ctx = await getTournamentContext(id);
  if (!ctx.isAdmin) notFound();
  const since = new Date(serverTimeMs() - 7 * 24 * 3600 * 1000).toISOString();
  const { data } = await ctx.supabase
    .from("perf_events")
    .select("kind, duration_ms, ok, path, meta, created_at")
    .eq("tournament_id", id)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(5000);
  const rows = (data ?? []) as PerfRowLite[];
  const groups = summarisePerf(rows);
  const failures = rows.filter((r) => !r.ok).slice(0, 30);

  return (
    <>
      <PageHeader title="Performance" description="Measured on the devices using this tournament over the last 7 days. Timings only: no names or personal details are stored." />
      {rows.length === 0 ? (
        <EmptyState icon={Gauge} title="No measurements yet" description="Timings appear here once organisers and referees use the app." />
      ) : (
        <div className="space-y-5">
          <Card className="gap-0 overflow-x-auto py-0">
            <table className="w-full min-w-[36rem] text-sm">
              <thead className="border-b text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Measure</th>
                  <th className="px-2 py-2 text-right font-medium">Count</th>
                  <th className="px-2 py-2 text-right font-medium">Median</th>
                  <th className="px-2 py-2 text-right font-medium">90%</th>
                  <th className="px-2 py-2 text-right font-medium">99%</th>
                  <th className="px-2 py-2 text-right font-medium">Target</th>
                  <th className="px-4 py-2 text-right font-medium">Failures</th>
                </tr>
              </thead>
              <tbody className="divide-y tabular">
                {groups.map((g) => (
                  <tr key={g.key}>
                    <td className="px-4 py-2">{g.label}</td>
                    <td className="px-2 py-2 text-right">{g.count}</td>
                    <td className="px-2 py-2 text-right">{fmt(g.p50)}</td>
                    <td className="px-2 py-2 text-right">{fmt(g.p90)}</td>
                    <td className="px-2 py-2 text-right">{fmt(g.p99)}</td>
                    <td className="px-2 py-2 text-right">
                      {g.target === null ? "–" : (
                        <Badge variant={g.p90 !== null && g.p90 > g.target ? "destructive" : "outline"}>{fmt(g.target)}</Badge>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">{g.failures ? `${g.failures} (${Math.round((g.failures / g.count) * 100)}%)` : "0"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          {failures.length ? (
            <Card className="gap-0 py-0">
              <div className="border-b px-4 py-3 text-sm font-semibold">Recent failures</div>
              <ol className="divide-y text-sm">
                {failures.map((r, i) => (
                  <li key={i} className="flex flex-wrap gap-x-3 px-4 py-2">
                    <span className="text-muted-foreground tabular">{new Date(r.created_at).toLocaleString([], { dateStyle: "short", timeStyle: "medium" })}</span>
                    <span className="font-medium">{groupKey(r)}</span>
                    <span className="text-muted-foreground">{r.path}</span>
                    {r.meta && Object.keys(r.meta).length ? <span className="min-w-0 break-all text-xs text-muted-foreground">{JSON.stringify(r.meta)}</span> : null}
                  </li>
                ))}
              </ol>
            </Card>
          ) : null}
        </div>
      )}
    </>
  );
}
