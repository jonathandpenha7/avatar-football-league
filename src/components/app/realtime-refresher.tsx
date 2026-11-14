"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { authorizeRealtime } from "@/lib/supabase/realtime";
import { cn } from "@/lib/utils";

/**
 * Subscribes to Supabase Realtime changes for a tournament's fixtures and
 * match events and refreshes server data when another device changes them.
 * RLS still applies to what each subscriber receives.
 */
export function RealtimeRefresher({
  tournamentId,
  fixtureId,
  showIndicator = true,
  debounceMs = 400,
}: {
  tournamentId: string;
  fixtureId?: string;
  showIndicator?: boolean;
  /** List pages batch bursts of changes into one refresh. */
  debounceMs?: number;
}) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<"connecting" | "live" | "offline">("connecting");

  useEffect(() => {
    const supabase = createClient();
    const refresh = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), debounceMs);
    };
    const filter = fixtureId ? `fixture_id=eq.${fixtureId}` : `tournament_id=eq.${tournamentId}`;
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    // Join with the signed-in session, or RLS hides every change from this device.
    void authorizeRealtime(supabase).then(() => {
      if (cancelled) return;
      channel = supabase
        .channel(`ctm-${tournamentId}-${fixtureId ?? "all"}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "match_events", filter }, refresh)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "fixtures", filter: fixtureId ? `id=eq.${fixtureId}` : `tournament_id=eq.${tournamentId}` },
          refresh,
        )
        .subscribe((s: string) => setStatus(s === "SUBSCRIBED" ? "live" : s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED" ? "offline" : "connecting"));
    });
    // Recover after a dropped connection or a phone waking up: fetch the latest state.
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", onVisible);
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [router, tournamentId, fixtureId, debounceMs]);

  if (!showIndicator) return null;
  return (
    <span className="no-print inline-flex items-center gap-1.5 text-xs text-muted-foreground" title="Live updates from other devices">
      <span className={cn("size-1.5 rounded-full", status === "live" ? "bg-success" : status === "offline" ? "bg-destructive" : "bg-warning")} />
      {status === "live" ? "Live sync" : status === "offline" ? "Sync offline" : "Connecting"}
    </span>
  );
}
