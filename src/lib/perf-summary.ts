/** Summaries for the admin performance view (pure, unit tested). */
export interface PerfRowLite {
  kind: string;
  duration_ms: number | null;
  ok: boolean;
  path: string | null;
  meta: Record<string, unknown> | null;
  created_at: string;
}

export interface PerfGroup {
  key: string;
  label: string;
  count: number;
  failures: number;
  p50: number | null;
  p90: number | null;
  p99: number | null;
  target: number | null;
}

/** Nearest-rank percentile of a sorted list. */
export function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

const LABELS: Record<string, string> = {
  event_save: "Event save (first attempt)",
  event_retry: "Event save (retry)",
  timer_action: "Timer and match actions",
  realtime_event_delivery: "Event reaches another device",
  realtime_fixture_delivery: "Clock or score reaches another device",
  realtime_reconnect: "Realtime reconnects",
  request_failed: "Failed requests (connection)",
  js_error: "JavaScript errors",
  "page_web_vital:LCP": "Page load (largest paint)",
  "page_web_vital:FCP": "First paint",
  "page_web_vital:TTFB": "Server response (TTFB)",
  "page_web_vital:INP": "Tap to screen update (INP)",
  "page_web_vital:CLS": "Layout shift (×1000)",
};

/** Targets from the performance brief, in milliseconds. */
const TARGETS: Record<string, number> = {
  event_save: 500,
  realtime_event_delivery: 1000,
  realtime_fixture_delivery: 1000,
  "page_web_vital:LCP": 2000,
  "page_web_vital:INP": 200,
};

export function groupKey(row: PerfRowLite) {
  return row.kind === "page_web_vital" ? `page_web_vital:${String(row.meta?.metric ?? "other")}` : row.kind;
}

export function summarisePerf(rows: PerfRowLite[]): PerfGroup[] {
  const groups = new Map<string, { durations: number[]; count: number; failures: number }>();
  for (const r of rows) {
    const key = groupKey(r);
    const g = groups.get(key) ?? { durations: [], count: 0, failures: 0 };
    g.count++;
    if (!r.ok) g.failures++;
    if (r.duration_ms !== null) g.durations.push(r.duration_ms);
    groups.set(key, g);
  }
  return [...groups.entries()]
    .map(([key, g]) => {
      const sorted = [...g.durations].sort((a, b) => a - b);
      return {
        key,
        label: LABELS[key] ?? key,
        count: g.count,
        failures: g.failures,
        p50: percentile(sorted, 50),
        p90: percentile(sorted, 90),
        p99: percentile(sorted, 99),
        target: TARGETS[key] ?? null,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}
