"use client";

import { useState } from "react";
import { Timer } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/app/empty-state";
import { FixtureRow } from "@/components/tournament/fixture-row";
import type { Fixture, Pitch, Team } from "@/lib/types";

const VIEWS = [
  ["today", "Today"],
  ["live", "In progress"],
  ["upcoming", "Upcoming"],
  ["completed", "Awaiting confirmation"],
  ["confirmed", "Completed"],
  ["pitch", "By pitch"],
] as const;

export function MatchCentre({
  tournamentId,
  fixtures,
  teams,
  pitches,
  myFixtureIds,
  referees,
  today,
  initialView,
  isAdmin,
}: {
  tournamentId: string;
  fixtures: Fixture[];
  teams: Team[];
  pitches: Pitch[];
  myFixtureIds: string[];
  referees: Record<string, string[]>;
  today: string;
  initialView?: string;
  isAdmin: boolean;
}) {
  const hasToday = fixtures.some((f) => f.scheduled_date === today);
  const live = fixtures.filter((f) => f.status === "in_progress" || f.status === "paused");
  const [view, setView] = useState<string>(initialView ?? (live.length ? "live" : hasToday ? "today" : "upcoming"));
  const [onlyMine, setOnlyMine] = useState(!isAdmin && myFixtureIds.length > 0);
  const teamMap = new Map(teams.map((t) => [t.id, t]));
  const pitchName = new Map(pitches.map((p) => [p.id, p.name]));
  const mine = new Set(myFixtureIds);
  const refLine = (f: Fixture) => {
    if (f.status === "confirmed" || f.status === "cancelled") return referees[f.id]?.length ? <span className="text-muted-foreground">Ref: {referees[f.id].join(", ")}</span> : null;
    if (referees[f.id]?.length) return <span className="text-muted-foreground">Ref: {referees[f.id].join(", ")}</span>;
    return isAdmin ? <span className="font-medium text-amber-700 dark:text-warning">No referee yet</span> : null;
  };
  const base = fixtures.filter((f) => !onlyMine || mine.has(f.id));

  const filtered = (() => {
    switch (view) {
      case "today": return base.filter((f) => f.scheduled_date === today);
      case "live": return base.filter((f) => f.status === "in_progress" || f.status === "paused");
      case "upcoming": return base.filter((f) => f.status === "scheduled" || f.status === "postponed");
      case "completed": return base.filter((f) => f.status === "completed");
      case "confirmed": return base.filter((f) => f.status === "confirmed").reverse();
      default: return base;
    }
  })();
  const counts: Record<string, number> = {
    live: base.filter((f) => f.status === "in_progress" || f.status === "paused").length,
    completed: base.filter((f) => f.status === "completed").length,
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={view} onValueChange={setView} className="min-w-0 max-w-full">
          <TabsList className="no-scrollbar h-auto max-w-full justify-start overflow-x-auto md:flex-wrap">
            {VIEWS.map(([k, l]) => (
              <TabsTrigger key={k} value={k} className="flex-none">
                {l}
                {counts[k] ? <span className="ml-1 rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground tabular">{counts[k]}</span> : null}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {myFixtureIds.length ? (
          <div className="flex items-center gap-2">
            <Switch id="mine" checked={onlyMine} onCheckedChange={setOnlyMine} />
            <Label htmlFor="mine" className="text-sm">Only my matches</Label>
          </div>
        ) : null}
      </div>

      {view === "pitch" ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {pitches.map((p) => {
            const list = base.filter((f) => f.pitch_id === p.id);
            return (
              <Card key={p.id} className="gap-0 py-0">
                <div className="border-b px-4 py-2.5 text-sm font-semibold">{p.name}</div>
                <div className="divide-y">
                  {list.length ? list.map((f) => (
                    <FixtureRow key={f.id} fixture={f} teams={teamMap} href={`/tournaments/${tournamentId}/matches/${f.id}`} footer={refLine(f)} />
                  )) : <p className="p-4 text-sm text-muted-foreground">No matches on this pitch.</p>}
                </div>
              </Card>
            );
          })}
        </div>
      ) : filtered.length ? (
        <Card className="gap-0 divide-y py-0">
          {filtered.map((f) => (
            <FixtureRow key={f.id} fixture={f} teams={teamMap} pitchName={f.pitch_id ? pitchName.get(f.pitch_id) : null} href={`/tournaments/${tournamentId}/matches/${f.id}`} showDate={view !== "today"} footer={refLine(f)} />
          ))}
        </Card>
      ) : (
        <EmptyState icon={Timer} title="No matches here" description={fixtures.length ? "Try another tab." : "Fixtures have not been generated yet."} />
      )}
    </div>
  );
}
