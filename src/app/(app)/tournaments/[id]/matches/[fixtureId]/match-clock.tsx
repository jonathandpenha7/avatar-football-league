"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Ban, CircleCheck, Flag, Pause, Play, Plus, RotateCcw, Send, Square, Timer, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/app/confirm-action";
import { toast } from "sonner";
import { clockView, formatMinSec, PERIOD_LABELS, type ClockConfig } from "@/lib/engine";
import type { ActionResult, Fixture } from "@/lib/types";
import { cn } from "@/lib/utils";

// One shared 250 ms tick for every clock on the page.
let tick = 0;
const listeners = new Set<() => void>();
let interval: ReturnType<typeof setInterval> | undefined;
function subscribe(cb: () => void) {
  listeners.add(cb);
  if (!interval) {
    tick = Date.now();
    interval = setInterval(() => {
      tick = Date.now();
      listeners.forEach((l) => l());
    }, 250);
  }
  return () => {
    listeners.delete(cb);
    if (!listeners.size && interval) {
      clearInterval(interval);
      interval = undefined;
    }
  };
}

/** Current time corrected to the server's clock. */
export function useServerNow(serverNow: number) {
  // Device clocks can be off by seconds; measure the difference once when the page loads.
  const [offset] = useState(() => serverNow - Date.now());
  const local = useSyncExternalStore(subscribe, () => tick || Date.now(), () => serverNow - offset);
  return local + offset;
}

export function clockStateOf(f: Fixture) {
  return {
    status: f.status,
    period: f.period,
    timerStartedAt: f.timer_started_at,
    timerElapsedSec: f.timer_elapsed_sec,
    phaseTargetSec: f.phase_target_sec,
    addedTimeSec: f.added_time_sec,
    firstHalfElapsedSec: f.first_half_elapsed_sec,
    secondHalfElapsedSec: f.second_half_elapsed_sec,
  };
}

const PHASE_STYLE: Record<string, string> = {
  not_started: "bg-muted text-muted-foreground",
  first_half: "bg-live text-white",
  second_half: "bg-live text-white",
  extra_time: "bg-live text-white",
  half_time: "bg-warning text-black",
  penalties: "bg-chart-4 text-white",
  full_time: "bg-foreground text-background",
  paused: "bg-warning text-black",
  abandoned: "bg-destructive text-white",
};

export function MatchClock({
  fixture: f,
  config,
  serverNow,
  canControl,
  canAbandon,
  isAdmin,
  extraTimeEnabled,
  penaltiesEnabled,
  teamsKnown,
  onCommand,
  busyCommand,
}: {
  fixture: Fixture;
  config: ClockConfig;
  serverNow: number;
  canControl: boolean;
  canAbandon: boolean;
  isAdmin: boolean;
  extraTimeEnabled: boolean;
  penaltiesEnabled: boolean;
  teamsKnown: boolean;
  /** Sends a clock or phase command straight to the database and applies the returned state. */
  onCommand: (command: string, extra?: { minutes?: number; reason?: string }, opts?: { quiet?: boolean }) => Promise<ActionResult>;
  busyCommand: string | null;
}) {
  const now = useServerNow(serverNow);
  const view = clockView(clockStateOf(f), config, now);
  const pending = busyCommand !== null;
  const version = f.state_version;
  // Errors are shown by ConfirmAction (quiet here to avoid a second message).
  const cmd = (command: string, extra: { minutes?: number; reason?: string } = {}) => onCommand(command, extra, { quiet: true });
  // Plain buttons: the screen updates from the returned state; errors show as a toast.
  const act = (command: string, success?: string, extra: { minutes?: number } = {}) =>
    void onCommand(command, extra).then((r) => {
      if (r.ok && success) toast.success(success);
    });

  // Automatic transitions (end of a half, end of half-time clock) are written by
  // the server when due. Any authorised device on the page triggers it once.
  const dueKey = view.transitionDue && canControl ? `${version}:${view.period}:${view.status}` : null;
  useEffect(() => {
    if (!dueKey) return;
    void onCommand("sync", {}, { quiet: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dueKey]);

  const knockout = f.stage === "knockout";
  const level = f.home_score === f.away_score;
  const paused = view.status === "paused" && view.period !== "penalties";
  const phaseKey = view.status === "abandoned" ? "abandoned" : paused ? "paused" : view.period;
  const phaseTitle =
    view.status === "abandoned"
      ? "Abandoned"
      : view.period === "half_time"
        ? "Half-time — break"
        : paused
          ? `${PERIOD_LABELS[view.period]} · paused`
          : PERIOD_LABELS[view.period];
  const live = view.status === "in_progress" || view.status === "paused";
  const inPlay = ["first_half", "second_half", "extra_time"].includes(view.period) && live;
  const halfTimeOver = view.period === "half_time" && !view.running && view.remainingSec === 0;
  const added = f.added_time_sec ? ` (+${Math.round(f.added_time_sec / 60)} min added)` : "";

  return (
    <div className="space-y-4">
      <div className={cn("mx-auto w-fit rounded-full px-4 py-1.5 text-sm font-bold tracking-wide uppercase", PHASE_STYLE[phaseKey] ?? PHASE_STYLE.not_started, view.running && "animate-none")}>
        {view.running ? <span className="mr-2 inline-block size-2 animate-pulse rounded-full bg-current align-middle" /> : null}
        {phaseTitle}
      </div>

      <div className="text-center">
        {view.remainingSec !== null && view.period !== "full_time" && view.period !== "penalties" && view.status !== "scheduled" && view.status !== "abandoned" ? (
          <>
            <div suppressHydrationWarning className={cn("text-6xl font-bold tracking-tight tabular sm:text-7xl", view.period === "half_time" && "text-amber-600 dark:text-warning", paused && "opacity-60")}>
              {formatMinSec(view.remainingSec)}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              {view.period === "half_time"
                ? halfTimeOver
                  ? "Half-time is over. Start the second half when the teams are ready."
                  : `Break ends in ${formatMinSec(view.remainingSec)} of ${formatMinSec(view.targetSec ?? 0)}`
                : `remaining of ${formatMinSec((view.targetSec ?? 0) - f.added_time_sec)}${added} · match time ${Math.floor(view.matchSecond / 60) + 1}'`}
            </div>
          </>
        ) : view.status === "scheduled" ? (
          <div className="text-sm text-muted-foreground">
            {config.halfSec ? (config.periods === 2 ? `${config.halfSec / 60} + ${config.halfTimeSec / 60} + ${config.halfSec / 60} minutes` : `${config.halfSec / 60} minutes`) : "Set the match duration in Settings before kick-off."}
          </div>
        ) : view.period === "full_time" ? (
          <div className="text-sm text-muted-foreground">
            Played {formatMinSec((f.first_half_elapsed_sec ?? 0) + (f.second_half_elapsed_sec ?? 0) || f.timer_elapsed_sec)}
            {f.submitted_at ? " · result submitted" : ""}
          </div>
        ) : null}
        {f.abandoned_reason && view.status === "abandoned" ? <p className="mt-1 text-sm text-destructive">{f.abandoned_reason}</p> : null}
      </div>

      {canControl && teamsKnown ? (
        <div className="no-print flex flex-wrap justify-center gap-2">
          {view.status === "scheduled" ? (
            <Button size="lg" className="h-12 px-6 text-base" onClick={() => act("start", "First half started.")} disabled={pending || !config.halfSec}>
              <Play /> Start first half
            </Button>
          ) : null}

          {inPlay && view.running ? <Button size="lg" variant="outline" onClick={() => act("pause")} disabled={pending}><Pause /> Pause</Button> : null}
          {view.period === "half_time" && view.running ? <Button size="lg" variant="outline" onClick={() => act("pause")} disabled={pending}><Pause /> Pause break</Button> : null}
          {paused && view.period !== "half_time" ? <Button size="lg" onClick={() => act("resume")} disabled={pending}><Play /> Resume</Button> : null}
          {paused && view.period === "half_time" ? <Button size="lg" variant="outline" onClick={() => act("resume")} disabled={pending}><Play /> Resume break</Button> : null}

          {view.period === "half_time" ? (
            <Button size="lg" className={cn(halfTimeOver && "h-12 px-6 text-base")} onClick={() => act("start_second_half", "Second half started.")} disabled={pending}>
              <Play /> Start second half
            </Button>
          ) : null}

          {inPlay ? (
            <Button size="lg" variant="outline" onClick={() => act("add_time", "1 minute added.", { minutes: 1 })} disabled={pending}><Plus /> 1 min</Button>
          ) : null}

          {inPlay && view.period === "first_half" && config.periods === 2 ? (
            <ConfirmAction
              trigger={<Button size="lg" variant="outline" disabled={pending}><Flag /> End first half</Button>}
              title="End the first half now?"
              description={`${formatMinSec(view.remainingSec ?? 0)} is still on the clock. The 2-minute half-time break starts straight away.`}
              confirmLabel="End first half"
              action={() => cmd("end_first_half")}
            />
          ) : null}

          {(inPlay && (view.period !== "first_half" || config.periods === 1)) || view.period === "penalties" ? (
            <ConfirmAction
              trigger={<Button size="lg" variant="destructive" disabled={pending}><Square /> {view.period === "penalties" ? "End shootout" : "End match"}</Button>}
              title={view.period === "penalties" ? "End the shootout?" : "End the match now?"}
              description={`Score ${f.home_score}–${f.away_score}${f.home_penalties !== null ? ` (penalties ${f.home_penalties}–${f.away_penalties})` : ""}. The result then needs to be submitted and confirmed.`}
              confirmLabel={view.period === "penalties" ? "End shootout" : "End match"}
              action={() => cmd("end_match")}
            />
          ) : null}

          {view.status === "completed" && knockout && level && f.decided_by !== "forfeit" ? (
            <>
              {extraTimeEnabled && !f.home_penalties && f.period !== "penalties" ? (
                <Button size="lg" variant="outline" onClick={() => act("extra_time", "Extra time started.")} disabled={pending}><Timer /> Extra time</Button>
              ) : null}
              {penaltiesEnabled ? <Button size="lg" onClick={() => act("penalties")} disabled={pending}><CircleCheck /> Penalty shootout</Button> : null}
            </>
          ) : null}

          {view.status === "completed" && !f.submitted_at ? (
            <Button size="lg" onClick={() => act("submit", "Result submitted for confirmation.")} disabled={pending}><Send /> Submit result</Button>
          ) : null}

          {view.status === "completed" && f.decided_by !== "forfeit" ? (
            <ConfirmAction
              trigger={<Button size="lg" variant="ghost" disabled={pending}><Undo2 /> Resume play</Button>}
              title="Undo full time?"
              description="Use this if the match was ended by mistake. The clock returns to the end of the last half, paused. This is recorded in the audit log."
              confirmLabel="Resume play"
              action={() => cmd("resume_play")}
            />
          ) : null}

          {canAbandon && ["scheduled", "in_progress", "paused", "completed"].includes(view.status) ? (
            <ConfirmAction
              destructive
              trigger={<Button size="lg" variant="ghost" className="text-destructive" disabled={pending}><Ban /> Abandon</Button>}
              title="Abandon this match?"
              description="The clock stops and the match does not count in the standings. An admin can reinstate it, reset it for a replay, or record a forfeit."
              reason={{ label: "Reason", placeholder: "e.g. Heavy rain, injury, floodlights" }}
              confirmLabel="Abandon match"
              action={(reason) => cmd("abandon", { reason })}
            />
          ) : null}

          {isAdmin && view.status === "abandoned" ? (
            <Button size="lg" onClick={() => act("reinstate", "Match reinstated.")} disabled={pending}><RotateCcw /> Reinstate</Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
