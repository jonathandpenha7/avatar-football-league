"use client";

import { useDeferredValue, useMemo } from "react";
import { CircleAlert, CircleCheck, CircleHelp, Clock } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { assessFeasibility, dateRange, formatClock, formatDuration, toMinutes, type PlanTeam } from "@/lib/engine";
import type { TournamentFormat } from "@/lib/engine/types";
import type { GeneralDraft, PitchDraft, SettingsDraft } from "./settings-sections";

export interface FeasibilityDraft {
  general: Pick<GeneralDraft, "start_date" | "end_date" | "daily_start_time" | "daily_end_time">;
  format: TournamentFormat;
  settings: SettingsDraft;
  pitches: PitchDraft[];
  /** Real teams (with groups) if they exist; otherwise settings.team_count placeholders are used. */
  teams?: PlanTeam[];
}

export function FeasibilityPanel({ draft, compact }: { draft: FeasibilityDraft; compact?: boolean }) {
  const deferred = useDeferredValue(draft);
  const report = useMemo(() => {
    const { general, settings, pitches, format, teams } = deferred;
    const start = toMinutes(general.daily_start_time);
    const end = toMinutes(general.daily_end_time);
    const days =
      general.start_date && start !== null && end !== null && end > start
        ? dateRange(general.start_date, general.end_date).map((date) => ({ date, start, end }))
        : [];
    const pitchList = pitches
      .filter((p) => p.name.trim())
      .map((p, i) => ({
        id: p.id ?? `draft-${i}`,
        name: p.name,
        availableFrom: toMinutes(p.available_from),
        availableUntil: toMinutes(p.available_until),
      }));
    return assessFeasibility({
      teamCount: teams?.length || settings.team_count,
      teams: teams?.length ? teams : undefined,
      format: {
        format,
        doubleRoundRobin: settings.double_round_robin,
        qualifiers: settings.qualifiers,
        thirdPlaceMatch: settings.third_place_match,
        groupCount: settings.group_count,
        qualifiersPerGroup: settings.qualifiers_per_group,
      },
      days,
      matchMin: settings.match_duration_min,
      periods: settings.periods,
      halfTimeMin: settings.half_time_min,
      knockoutMatchMin: settings.knockout_match_duration_min,
      knockoutHalfTimeMin: settings.knockout_half_time_min,
      transitionMin: settings.transition_min,
      pitches: pitchList,
      blocked: settings.blocked_periods.map((b) => ({
        date: b.date ?? null,
        start: toMinutes(b.start) ?? 0,
        end: toMinutes(b.end) ?? 0,
        pitchId: b.pitch_id ?? null,
        label: b.label ?? null,
      })),
      knockoutBreakMin: settings.knockout_break_min,
    });
  }, [deferred]);

  const tone =
    report.status === "feasible"
      ? { icon: CircleCheck, title: "The schedule fits", cls: "border-success/40 bg-success/5 [&>svg]:text-success" }
      : report.status === "infeasible"
        ? { icon: CircleAlert, title: "The schedule does not fit", cls: "border-destructive/40 bg-destructive/5 [&>svg]:text-destructive" }
        : { icon: CircleHelp, title: "Add the match timings to check the schedule", cls: "border-warning/50 bg-warning/5 [&>svg]:text-amber-600" };
  const Icon = tone.icon;

  return (
    <Alert className={tone.cls}>
      <Icon />
      <AlertTitle>{tone.title}</AlertTitle>
      <AlertDescription>
        <div className="mt-1 space-y-2 text-[13px]">
          {report.planErrors.map((e) => (
            <p key={e} className="text-destructive">{e}</p>
          ))}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-foreground/80">
            <span><strong className="tabular">{report.totalMatches}</strong> matches</span>
            {report.knockoutMatches ? (
              <span className="text-muted-foreground">({report.groupPhaseMatches} league or group, {report.knockoutMatches} knockout)</span>
            ) : null}
            {report.windowMinutes ? <span><Clock className="mr-1 inline size-3.5" />{formatDuration(report.windowMinutes)} available</span> : null}
            {report.status !== "incomplete" && report.minimumMinutes !== null ? (
              <span>
                needs at least <strong className="tabular">{formatDuration(report.minimumMinutes)}</strong> of playing time
              </span>
            ) : null}
          </div>
          {report.missing.length ? (
            <ul className="list-disc pl-4 text-muted-foreground">
              {report.missing.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          ) : null}
          {report.status === "feasible" && report.result && !compact ? (
            <p className="text-muted-foreground">
              {report.result.metrics.backToBack} back-to-back appearance{report.result.metrics.backToBack === 1 ? "" : "s"} across all teams.
              {report.result.metrics.endMinute !== null ? ` Last match ends at ${formatClock(report.result.metrics.endMinute)}.` : ""}
            </p>
          ) : null}
          {report.suggestions.length ? (
            <ul className="list-disc space-y-0.5 pl-4">
              {report.suggestions.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          ) : null}
          {report.status === "feasible" && report.maxMatchMinutes ? (
            <p className="text-muted-foreground">League matches could be up to {report.maxMatchMinutes} minutes of play and still fit.</p>
          ) : null}
        </div>
      </AlertDescription>
    </Alert>
  );
}
