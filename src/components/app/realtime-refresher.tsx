"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
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
}: {
  tournamentId: string;
  fixtureId?: string;
  showIndicator?: boolean;
}) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<"connecting" | "live" | "offline">("connecting");

  useEffect(() => {
    const supabase = createClient();
    const refresh = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 250);
    };
    const filter = fixtureId ? `fixture_id=eq.${fixtureId}` : `tournament_id=eq.${tournamentId}`;
    const channel = supabase
      .channel(`ctm-${tournamentId}-${fixtureId ?? "all"}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "match_events", filter }, refresh)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "fixtures", filter: fixtureId ? `id=eq.${fixtureId}` : `tournament_id=eq.${tournamentId}` },
        refresh,
      )
      .subscribe((s: string) => setStatus(s === "SUBSCRIBED" ? "live" : s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED" ? "offline" : "connecting"));
    return () => {
      if (timer.current) clearTimeout(timer.current);
      supabase.removeChannel(channel);
    };
  }, [router, tournamentId, fixtureId]);

  if (!showIndicator) return null;
  return (
    <span className="no-print inline-flex items-center gap-1.5 text-xs text-muted-foreground" title="Live updates from other devices">
      <span className={cn("size-1.5 rounded-full", status === "live" ? "bg-success" : status === "offline" ? "bg-destructive" : "bg-warning")} />
      {status === "live" ? "Live sync" : status === "offline" ? "Sync offline" : "Connecting"}
    </span>
  );
}
