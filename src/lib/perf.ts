"use client";

/**
 * Lightweight performance telemetry. Measurements are batched and written to
 * the perf_events table (admins can read their tournament's rows). Never record
 * names, contact details, tokens or free text entered by users.
 */
import { createClient } from "@/lib/supabase/client";

export type PerfKind =
  | "event_save"
  | "event_retry"
  | "timer_action"
  | "realtime_event_delivery"
  | "realtime_fixture_delivery"
  | "realtime_reconnect"
  | "request_failed"
  | "page_web_vital"
  | "js_error";

interface PerfRow {
  tournament_id: string | null;
  kind: PerfKind;
  duration_ms: number | null;
  ok: boolean;
  path: string;
  meta: Record<string, string | number | boolean | null>;
}

let buffer: PerfRow[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let currentTournament: string | null = null;

export function setPerfTournament(id: string | null) {
  currentTournament = id;
}

function path() {
  if (typeof window === "undefined") return "";
  // Replace ids so paths group together and carry no identifiers.
  return window.location.pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ":id");
}

export function track(kind: PerfKind, durationMs: number | null, ok = true, meta: PerfRow["meta"] = {}) {
  if (typeof window === "undefined") return;
  buffer.push({
    tournament_id: currentTournament,
    kind,
    duration_ms: durationMs === null ? null : Math.max(0, Math.round(durationMs)),
    ok,
    path: path(),
    meta,
  });
  if (buffer.length >= 25) void flush();
  else if (!timer) timer = setTimeout(() => void flush(), 10_000);
}

export async function flush() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (!buffer.length || (typeof navigator !== "undefined" && !navigator.onLine)) return;
  const rows = buffer.slice(0, 50);
  buffer = buffer.slice(50);
  try {
    const { error } = await createClient().from("perf_events").insert(rows);
    if (error && buffer.length < 200) buffer = [...rows, ...buffer]; // keep for the next attempt
  } catch {
    if (buffer.length < 200) buffer = [...rows, ...buffer];
  }
}

let installed = false;
/** Global listeners: JavaScript errors and flushing when the page is hidden. */
export function installPerfListeners() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (e) => track("js_error", null, false, { message: String(e.message ?? "").slice(0, 120) }));
  window.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason instanceof Error ? e.reason.message : String(e.reason ?? "");
    track("js_error", null, false, { message: reason.slice(0, 120) });
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flush();
  });
  window.addEventListener("online", () => void flush());
}
