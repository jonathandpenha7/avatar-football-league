import { Badge } from "@/components/ui/badge";
import { FIXTURE_STATUS_LABELS, STATUS_LABELS } from "@/lib/domain";
import type { FixtureStatus, TournamentStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const fixtureTone: Record<FixtureStatus, string> = {
  scheduled: "bg-muted text-muted-foreground",
  in_progress: "bg-live/15 text-live",
  paused: "bg-warning/20 text-warning-foreground dark:text-warning",
  completed: "bg-warning/20 text-amber-700 dark:text-warning",
  confirmed: "bg-success/15 text-success",
  postponed: "bg-muted text-muted-foreground line-through",
  cancelled: "bg-destructive/10 text-destructive",
  abandoned: "bg-destructive/10 text-destructive",
};

export function FixtureStatusBadge({ status, className }: { status: FixtureStatus; className?: string }) {
  return (
    <Badge variant="secondary" className={cn("gap-1.5 border-0", fixtureTone[status], className)}>
      {status === "in_progress" ? <span className="size-1.5 animate-pulse rounded-full bg-current" /> : null}
      {status === "in_progress" ? "Live" : FIXTURE_STATUS_LABELS[status]}
    </Badge>
  );
}

const tournamentTone: Record<TournamentStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  registration_open: "bg-chart-2/15 text-chart-2",
  ready: "bg-accent text-accent-foreground",
  live: "bg-live/15 text-live",
  completed: "bg-success/15 text-success",
  archived: "bg-muted text-muted-foreground",
};

export function TournamentStatusBadge({ status }: { status: TournamentStatus }) {
  return (
    <Badge variant="secondary" className={cn("border-0", tournamentTone[status])}>
      {STATUS_LABELS[status]}
    </Badge>
  );
}
