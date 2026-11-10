import Link from "next/link";
import { MapPin } from "lucide-react";
import { FixtureStatusBadge } from "@/components/app/status-badge";
import { TeamName, type TeamLike } from "@/components/app/team-name";
import { describeSource, formatClock, toMinutes } from "@/lib/engine";
import type { Fixture } from "@/lib/types";
import { cn } from "@/lib/utils";

export function scoreText(f: Pick<Fixture, "status" | "home_score" | "away_score" | "home_penalties" | "away_penalties">) {
  if (f.status === "scheduled" || f.status === "postponed" || f.status === "cancelled") return null;
  const pens = f.home_penalties !== null && f.away_penalties !== null ? ` (${f.home_penalties}–${f.away_penalties} p)` : "";
  return `${f.home_score} – ${f.away_score}${pens}`;
}

export function FixtureRow({
  fixture: f,
  teams,
  pitchName,
  href,
  showDate,
}: {
  fixture: Fixture;
  teams: Map<string, TeamLike>;
  pitchName?: string | null;
  href?: string;
  showDate?: boolean;
}) {
  const home = f.home_team_id ? teams.get(f.home_team_id) : null;
  const away = f.away_team_id ? teams.get(f.away_team_id) : null;
  const score = scoreText(f);
  const content = (
    <div className={cn("grid grid-cols-[3.75rem_1fr_auto] items-center gap-3 px-3 py-2.5 text-sm", href && "transition-colors hover:bg-muted/50")}>
      <div className="text-xs leading-tight text-muted-foreground tabular">
        <div className="font-medium text-foreground">{f.scheduled_time ? formatClock(toMinutes(f.scheduled_time)) : "TBC"}</div>
        <div>{showDate && f.scheduled_date ? f.scheduled_date.slice(5) : f.code}</div>
      </div>
      <div className="min-w-0 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <TeamName team={home} fallback={describeSource(f.home_source)} className={cn(f.winner_team_id && f.winner_team_id === f.home_team_id && "font-semibold")} />
          {score ? <span className="shrink-0 font-semibold tabular">{f.home_score}</span> : null}
        </div>
        <div className="flex items-center justify-between gap-2">
          <TeamName team={away} fallback={describeSource(f.away_source)} className={cn(f.winner_team_id && f.winner_team_id === f.away_team_id && "font-semibold")} />
          {score ? <span className="shrink-0 font-semibold tabular">{f.away_score}</span> : null}
        </div>
        {f.home_penalties !== null && f.away_penalties !== null ? (
          <div className="text-xs text-muted-foreground">Penalties {f.home_penalties}–{f.away_penalties}</div>
        ) : null}
      </div>
      <div className="flex flex-col items-end gap-1">
        <FixtureStatusBadge status={f.status} />
        {pitchName ? (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <MapPin className="size-3" /> {pitchName}
          </span>
        ) : null}
        {f.round_name && f.stage === "knockout" ? <span className="text-xs text-muted-foreground">{f.round_name}</span> : null}
      </div>
    </div>
  );
  return href ? <Link href={href} className="block">{content}</Link> : content;
}
