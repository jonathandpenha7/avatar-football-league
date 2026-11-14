"use client";

import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { toast } from "sonner";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { authorizeRealtime } from "@/lib/supabase/realtime";
import { classifyError, liveReducer, type LiveState } from "@/lib/live-match";
import {
  bumpAttempts,
  outboxFor,
  putOutbox,
  removeOutbox,
} from "@/lib/event-outbox";
import { setPerfTournament, track } from "@/lib/perf";
import type { ActionResult, EventType, Fixture, MatchEvent } from "@/lib/types";

const EVENT_COLUMNS =
  "id, tournament_id, fixture_id, event_type, team_id, player_id, assist_player_id, related_player_id, match_second, period, duration_min, detail, created_by, created_at";

function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

export function useOnline() {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

export type SyncStatus = "connecting" | "live" | "offline";

export interface NewEvent {
  event_type: EventType;
  team_id: string;
  player_id?: string | null;
  assist_player_id?: string | null;
  related_player_id?: string | null;
  duration_min?: number | null;
  detail?: string | null;
}

/**
 * Live match state with direct, idempotent writes to the database and
 * incremental realtime updates (no full page reloads while scoring).
 */
export function useLiveMatch({
  tournamentId,
  fixture: serverFixture,
  events: serverEvents,
  userId,
  serverNow,
}: {
  tournamentId: string;
  fixture: Fixture;
  events: MatchEvent[];
  userId: string;
  serverNow: number;
}) {
  const [state, dispatch] = useReducer(liveReducer, {
    fixture: serverFixture,
    events: serverEvents,
    pending: [],
  } satisfies LiveState);
  const [sync, setSync] = useState<SyncStatus>("connecting");
  const [busyCommand, setBusyCommand] = useState<string | null>(null);
  const online = useOnline();
  const [offset] = useState(() => serverNow - Date.now());
  const stateRef = useRef(state);
  const inflight = useRef(new Set<string>());
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // New server props (e.g. after confirming a result) replace local data.
  const [seen, setSeen] = useState({
    fixture: serverFixture,
    events: serverEvents,
  });
  if (seen.fixture !== serverFixture || seen.events !== serverEvents) {
    setSeen({ fixture: serverFixture, events: serverEvents });
    dispatch({ type: "reset", fixture: serverFixture, events: serverEvents });
  }

  const supabase = createClient();
  const fixtureId = serverFixture.id;

  /** Re-read the match from the database (after reconnecting or a rejected action). */
  const resync = useCallback(async () => {
    const [f, e] = await Promise.all([
      supabase.from("fixtures").select("*").eq("id", fixtureId).single(),
      supabase
        .from("match_events")
        .select(EVENT_COLUMNS)
        .eq("fixture_id", fixtureId)
        .order("created_at"),
    ]);
    if (!f.error && f.data && !e.error && e.data)
      dispatch({
        type: "reset",
        fixture: f.data as Fixture,
        events: e.data as MatchEvent[],
      });
  }, [supabase, fixtureId]);

  const send = useCallback(
    async (
      entry: { id: string; payload: Record<string, unknown> },
      attempt: number,
    ) => {
      if (inflight.current.has(entry.id)) return; // already being sent
      inflight.current.add(entry.id);
      const started = performance.now();
      const { data, error } = await supabase
        .from("match_events")
        .insert(entry.payload)
        .select(EVENT_COLUMNS)
        .single();
      inflight.current.delete(entry.id);
      const kind = classifyError(error, navigator.onLine);
      if (kind === "ok") {
        dispatch({ type: "upsertEvent", row: data as MatchEvent });
        removeOutbox(entry.id);
        track(
          attempt > 1 ? "event_retry" : "event_save",
          performance.now() - started,
          true,
          { attempt, type: String(entry.payload.event_type) },
        );
        return;
      }
      if (kind === "duplicate") {
        // Already saved by an earlier attempt: fetch the stored event instead of adding another.
        const { data: existing } = await supabase
          .from("match_events")
          .select(EVENT_COLUMNS)
          .eq("id", entry.id)
          .maybeSingle();
        if (existing)
          dispatch({ type: "upsertEvent", row: existing as MatchEvent });
        removeOutbox(entry.id);
        track("event_retry", performance.now() - started, true, {
          attempt,
          duplicate: true,
        });
        return;
      }
      if (kind === "network") {
        bumpAttempts(entry.id);
        dispatch({
          type: "pendingStatus",
          id: entry.id,
          status: "retrying",
          error: "Not saved yet. Retrying when the connection returns.",
        });
        track("request_failed", performance.now() - started, false, {
          op: "event_save",
          attempt,
        });
        return;
      }
      // Rejected by the database (e.g. match confirmed, player not in team): undo and explain.
      removeOutbox(entry.id);
      dispatch({ type: "removePending", id: entry.id });
      track("event_save", performance.now() - started, false, {
        attempt,
        rejected: true,
      });
      toast.error(
        `Not recorded: ${error?.message ?? "the server rejected this event."}`,
      );
    },
    [supabase],
  );

  /** Record an event: visible at once, saved in the background, never duplicated. */
  const record = useCallback(
    (input: NewEvent) => {
      const id = crypto.randomUUID();
      const payload = {
        id,
        tournament_id: tournamentId,
        fixture_id: fixtureId,
        ...input,
      };
      const local: MatchEvent = {
        id,
        tournament_id: tournamentId,
        fixture_id: fixtureId,
        event_type: input.event_type,
        team_id: input.team_id,
        player_id: input.player_id ?? null,
        assist_player_id: input.assist_player_id ?? null,
        related_player_id: input.related_player_id ?? null,
        match_second: null,
        period: stateRef.current.fixture.period,
        duration_min: input.duration_min ?? null,
        detail: input.detail ?? null,
        created_by: userId,
        created_at: new Date(Date.now() + offset).toISOString(),
      };
      const durable = putOutbox({
        id,
        tournamentId,
        fixtureId,
        payload,
        createdAt: local.created_at,
        attempts: 1,
      });
      if (!durable)
        toast.warning(
          "This device cannot store unsent events. Keep the page open until it shows as saved.",
        );
      dispatch({ type: "addPending", event: local });
      void send({ id, payload }, 1);
    },
    [tournamentId, fixtureId, userId, offset, send],
  );

  /** Retry everything still in this device's outbox for this match. */
  const flushOutbox = useCallback(() => {
    for (const entry of outboxFor(fixtureId)) {
      if (inflight.current.has(entry.id)) continue;
      const exists = stateRef.current.pending.find(
        (p) => p.event.id === entry.id,
      );
      if (!exists) {
        const p = entry.payload as Record<string, unknown>;
        dispatch({
          type: "addPending",
          event: {
            id: entry.id,
            tournament_id: tournamentId,
            fixture_id: fixtureId,
            event_type: p.event_type as EventType,
            team_id: (p.team_id as string) ?? null,
            player_id: (p.player_id as string) ?? null,
            assist_player_id: (p.assist_player_id as string) ?? null,
            related_player_id: (p.related_player_id as string) ?? null,
            match_second: null,
            period: null,
            duration_min: (p.duration_min as number) ?? null,
            detail: (p.detail as string) ?? null,
            created_by: userId,
            created_at: entry.createdAt,
          },
        });
      } else {
        dispatch({ type: "pendingStatus", id: entry.id, status: "saving" });
      }
      void send({ id: entry.id, payload: entry.payload }, entry.attempts + 1);
    }
  }, [fixtureId, tournamentId, userId, send]);

  /** Clock and phase commands go straight to the database function; the returned row updates the screen. */
  const command = useCallback(
    async (
      cmd: string,
      extra: { minutes?: number; reason?: string } = {},
      opts: { quiet?: boolean } = {},
    ): Promise<ActionResult> => {
      setBusyCommand(cmd);
      const started = performance.now();
      const { data, error } = await supabase.rpc("match_control", {
        p_fixture: fixtureId,
        p_command: cmd,
        p_expected_version:
          cmd === "sync" ? null : stateRef.current.fixture.state_version,
        p_minutes: extra.minutes ?? null,
        p_reason: extra.reason ?? null,
      });
      setBusyCommand(null);
      track("timer_action", performance.now() - started, !error, {
        command: cmd,
      });
      if (error) {
        if (!opts.quiet) toast.error(error.message);
        void resync(); // someone else may have changed the match: show the stored state
        return { ok: false, error: error.message };
      }
      if (data) dispatch({ type: "fixture", row: data as Fixture });
      return { ok: true };
    },
    [supabase, fixtureId, resync],
  );

  const removeEvent = useCallback(
    async (eventId: string, reason: string): Promise<ActionResult> => {
      const { error } = await supabase.rpc("delete_match_event", {
        p_event: eventId,
        p_reason: reason,
      });
      if (error) return { ok: false, error: error.message };
      dispatch({ type: "deleteEvent", id: eventId });
      return {
        ok: true,
        message: "Event removed. Score and statistics recalculated.",
      };
    },
    [supabase],
  );

  // Realtime: only this match's rows, applied incrementally.
  useEffect(() => {
    setPerfTournament(tournamentId);
    let wasLive = false;
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    void authorizeRealtime(supabase).then(() => {
      if (cancelled) return;
      channel = supabase
        .channel(`match-${fixtureId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "match_events",
            filter: `fixture_id=eq.${fixtureId}`,
          },
          (msg: RealtimePostgresChangesPayload<MatchEvent>) => {
            if (msg.eventType === "DELETE") {
              const id = (msg.old as { id?: string }).id;
              if (id) dispatch({ type: "deleteEvent", id });
              return;
            }
            const row = msg.new as MatchEvent;
            const mine =
              stateRef.current.pending.some((p) => p.event.id === row.id) ||
              stateRef.current.events.some((e) => e.id === row.id);
            if (msg.eventType === "INSERT" && !mine) {
              track(
                "realtime_event_delivery",
                Date.now() + offset - Date.parse(row.created_at),
                true,
              );
            }
            dispatch({ type: "upsertEvent", row });
          },
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "fixtures",
            filter: `id=eq.${fixtureId}`,
          },
          (msg: RealtimePostgresChangesPayload<Fixture>) => {
            const row = msg.new as Fixture;
            if (row.updated_at)
              track(
                "realtime_fixture_delivery",
                Date.now() + offset - Date.parse(row.updated_at),
                true,
              );
            dispatch({ type: "fixture", row });
          },
        )
        .subscribe((status: string) => {
          if (status === "SUBSCRIBED") {
            setSync("live");
            if (wasLive) {
              track("realtime_reconnect", null, true);
              void resync(); // catch up on anything missed while disconnected
            }
            wasLive = true;
            flushOutbox();
          } else if (
            status === "CHANNEL_ERROR" ||
            status === "TIMED_OUT" ||
            status === "CLOSED"
          ) {
            setSync("offline");
          }
        });
    });
    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixtureId]);

  // Retry unsent events when the connection returns, and periodically while any are waiting.
  useEffect(() => {
    if (!online) return;
    flushOutbox();
    const id = setInterval(() => {
      if (stateRef.current.pending.some((p) => p.status === "retrying"))
        flushOutbox();
    }, 5000);
    return () => clearInterval(id);
  }, [online, flushOutbox]);

  return {
    state,
    record,
    command,
    busyCommand,
    removeEvent,
    sync: online ? sync : ("offline" as SyncStatus),
    online,
    resync,
  };
}
