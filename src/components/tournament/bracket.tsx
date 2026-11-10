import Link from "next/link";
import { TeamName, type TeamLike } from "@/components/app/team-name";
import { FixtureStatusBadge } from "@/components/app/status-badge";
import { describeSource, formatClock, toMinutes } from "@/lib/engine";
import type { Fixture } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Knockout fixtures arranged in columns by round (winners, losers and finals sections for double elimination). */
export function Bracket({ fixtures, teams, hrefBase }: { fixtures: Fixture[]; teams: Map<string, TeamLike>; hrefBase?: string }) {
  const ko = fixtures.filter((f) => f.stage === "knockout");
  const sections = [
    { key: "W", title: "Winners bracket", list: ko.filter((f) => /^W\d/.test(f.code)) },
    { key: "L", title: "Losers bracket", list: ko.filter((f) => /^L\d/.test(f.code)) },
  ].filter((s) => s.list.length);
  const rest = ko.filter((f) => !/^[WL]\d/.test(f.code));
  if (!sections.length) sections.push({ key: "K", title: "", list: rest });
  else if (rest.length) sections.push({ key: "F", title: "Finals", list: rest });

  return (
    <div className="space-y-8">
      {sections.map((section) => {
        const rounds = new Map<string, Fixture[]>();
        for (const f of [...section.list].sort((a, b) => a.round_number - b.round_number || a.code.localeCompare(b.code, undefined, { numeric: true }))) {
          const key = `${String(f.round_number).padStart(3, "0")}|${f.round_name ?? `Round ${f.round_number}`}`;
          rounds.set(key, [...(rounds.get(key) ?? []), f]);
        }
        const cols = [...rounds.entries()].sort(([a], [b]) => a.localeCompare(b));
        return (
          <div key={section.key}>
            {section.title ? <h3 className="mb-3 text-sm font-semibold text-muted-foreground">{section.title}</h3> : null}
            <div className="flex gap-4 overflow-x-auto pb-2">
              {cols.map(([key, list]) => (
                <div key={key} className="flex min-w-60 flex-1 flex-col">
                  <div className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">{key.split("|")[1]}</div>
                  <div className="flex flex-1 flex-col justify-around gap-3">
                    {list.map((f) => (
                      <BracketMatch key={f.id} f={f} teams={teams} href={hrefBase ? `${hrefBase}/${f.id}` : undefined} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BracketMatch({ f, teams, href }: { f: Fixture; teams: Map<string, TeamLike>; href?: string }) {
  const played = ["in_progress", "paused", "completed", "confirmed"].includes(f.status);
  const row = (teamId: string | null, source: string | null, score: number, pens: number | null) => {
    const won = f.winner_team_id && teamId === f.winner_team_id;
    return (
      <div className={cn("flex items-center justify-between gap-2 px-3 py-1.5", won && "font-semibold")}>
        <TeamName team={teamId ? teams.get(teamId) : null} fallback={describeSource(source)} />
        {played ? (
          <span className="tabular">
            {score}
            {pens !== null ? <span className="ml-1 text-xs text-muted-foreground">({pens})</span> : null}
          </span>
        ) : null}
      </div>
    );
  };
  const body = (
    <div className={cn("overflow-hidden rounded-lg border bg-card text-sm shadow-xs", href && "transition-shadow hover:shadow-md", f.code === "F" || f.code === "GF" ? "ring-1 ring-primary/40" : "")}>
      <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-1 text-[11px] text-muted-foreground">
        <span>{f.code}{f.scheduled_time ? ` · ${formatClock(toMinutes(f.scheduled_time))}` : ""}</span>
        {f.status !== "scheduled" ? <FixtureStatusBadge status={f.status} className="h-4 px-1.5 text-[10px]" /> : null}
      </div>
      {row(f.home_team_id, f.home_source, f.home_score, f.home_penalties)}
      <div className="border-t" />
      {row(f.away_team_id, f.away_source, f.away_score, f.away_penalties)}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}
