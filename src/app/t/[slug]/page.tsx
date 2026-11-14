import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CalendarRange, MapPin, Megaphone, Trophy } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { RealtimeRefresher } from "@/components/app/realtime-refresher";
import { FixtureRow } from "@/components/tournament/fixture-row";
import { StandingsTable } from "@/components/tournament/standings-table";
import { Bracket } from "@/components/tournament/bracket";
import { createClient } from "@/lib/supabase/server";
import { computeStandings, computeStats, fairPlayPoints, formatClock, toMinutes, type Tiebreaker } from "@/lib/engine";
import { RULE_CATEGORY_LABELS, formatDate, todayIn } from "@/lib/domain";
import type { Fixture, Team, Tournament } from "@/lib/types";

interface PublicData {
  tournament: Pick<Tournament, "id" | "slug" | "name" | "description" | "logo_url" | "venue" | "organiser" | "start_date" | "end_date" | "daily_start_time" | "daily_end_time" | "timezone" | "status" | "format" | "fixtures_published" | "rules_published">;
  settings: { points_win: number; points_draw: number; points_loss: number; tiebreakers: Tiebreaker[]; tiebreakers_confirmed: boolean; fair_play_yellow: number; fair_play_red: number; qualifiers: number | null; qualifiers_per_group: number | null };
  pitches: { id: string; name: string }[];
  teams: Pick<Team, "id" | "name" | "short_name" | "colour" | "logo_url" | "group_label">[];
  players: { id: string; full_name: string; team_id: string | null; jersey_number: number | null }[];
  fixtures: Fixture[];
  events: { id: string; fixture_id: string; event_type: string; team_id: string | null; player_id: string | null; assist_player_id: string | null }[];
  rules: { id: string; category: string; title: string; body: string }[];
  announcements: { id: string; title: string; body: string; created_at: string }[];
  tiebreak_decisions: { scope: string; ordered_team_ids: string[] }[];
  breaks?: { date?: string | null; start: string; end: string; label?: string | null; description?: string | null; pitch_id?: string | null }[];
  awards?: {
    champion_team_id: string | null; runner_up_team_id: string | null; third_place_team_id: string | null;
    mvp_player_id: string | null; mvp_reason: string | null; top_scorer_player_ids: string[]; top_scorer_goals: number | null; finalised: boolean;
  } | null;
}

async function load(slug: string) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_public_tournament", { p_slug: slug });
  return data as PublicData | null;
}

export async function generateMetadata(props: PageProps<"/t/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const data = await load(slug);
  return { title: data?.tournament.name ?? "Tournament", description: data?.tournament.description ?? undefined };
}

export default async function PublicTournamentPage(props: PageProps<"/t/[slug]">) {
  const { slug } = await props.params;
  const data = await load(slug);
  if (!data) notFound();
  const t = data.tournament;
  const s = data.settings;
  const teamMap = new Map(data.teams.map((x) => [x.id, x]));
  const pitchName = new Map(data.pitches.map((p) => [p.id, p.name]));
  const playerMap = new Map(data.players.map((p) => [p.id, p]));
  const fixtures = data.fixtures;
  const live = fixtures.filter((f) => f.status === "in_progress" || f.status === "paused");
  const today = todayIn(t.timezone);

  const tableScopes =
    t.format === "group_knockout"
      ? [...new Set(data.teams.map((x) => x.group_label).filter(Boolean))].sort().map((g) => ({ key: `group:${g}`, title: `Group ${g}`, teams: data.teams.filter((x) => x.group_label === g), fx: fixtures.filter((f) => f.stage === "group" && f.group_label === g), q: s.qualifiers_per_group }))
      : t.format === "round_robin" || t.format === "league_playoff"
        ? [{ key: "league", title: "League table", teams: data.teams, fx: fixtures.filter((f) => f.stage === "league"), q: t.format === "league_playoff" ? s.qualifiers : null }]
        : [];
  const tables = tableScopes.map((x) => {
    const ids = new Set(x.fx.filter((f) => f.status === "confirmed").map((f) => f.id));
    const cards = data.events
      .filter((e) => ids.has(e.fixture_id) && e.team_id && (e.event_type === "yellow_card" || e.event_type === "red_card"))
      .map((e) => ({ teamId: e.team_id!, type: e.event_type === "yellow_card" ? ("yellow" as const) : ("red" as const) }));
    return {
      ...x,
      standings: computeStandings(
        x.teams.map((tm) => ({ id: tm.id, name: tm.name })),
        x.fx.map((f) => ({ id: f.id, homeTeamId: f.home_team_id, awayTeamId: f.away_team_id, homeScore: f.home_score, awayScore: f.away_score, status: f.status })),
        {
          pointsWin: s.points_win, pointsDraw: s.points_draw, pointsLoss: s.points_loss,
          tiebreakers: s.tiebreakers, tiebreakersConfirmed: s.tiebreakers_confirmed,
          fairPlay: fairPlayPoints(cards, { yellow: s.fair_play_yellow, red: s.fair_play_red }),
          decisions: data.tiebreak_decisions.filter((d) => d.scope === x.key).map((d) => ({ orderedTeamIds: d.ordered_team_ids })),
        },
      ),
    };
  });
  const stats = computeStats(
    fixtures.map((f) => ({ id: f.id, homeTeamId: f.home_team_id, awayTeamId: f.away_team_id, homeScore: f.home_score, awayScore: f.away_score, status: f.status })),
    data.events.map((e) => ({ fixtureId: e.fixture_id, eventType: e.event_type, teamId: e.team_id, playerId: e.player_id, assistPlayerId: e.assist_player_id })),
  );
  const hasKnockout = fixtures.some((f) => f.stage === "knockout");
  const rulesByCat = Object.keys(RULE_CATEGORY_LABELS).map((c) => ({ c, list: data.rules.filter((r) => r.category === c) })).filter((x) => x.list.length);
  const byDate = new Map<string, Fixture[]>();
  for (const f of fixtures) byDate.set(f.scheduled_date ?? "", [...(byDate.get(f.scheduled_date ?? "") ?? []), f]);

  return (
    <div className="min-h-svh bg-background">
      <header className="border-b bg-gradient-to-b from-accent/60 to-background">
        <div className="mx-auto flex max-w-5xl items-start justify-between gap-4 px-4 py-8">
          <div className="flex items-center gap-4">
            {t.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={t.logo_url} alt="" className="size-16 rounded-xl object-cover ring-1 ring-border" />
            ) : (
              <span className="flex size-16 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Trophy className="size-7" /></span>
            )}
            <div>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t.name}</h1>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-1"><CalendarRange className="size-3.5" />{formatDate(t.start_date)}{t.daily_start_time ? `, ${formatClock(toMinutes(t.daily_start_time))}` : ""}</span>
                {t.venue ? <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" />{t.venue}</span> : null}
                {t.organiser ? <span>{t.organiser}</span> : null}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {t.fixtures_published ? <RealtimeRefresher tournamentId={t.id} /> : null}
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-4 py-6">
        {t.description ? <p className="text-muted-foreground">{t.description}</p> : null}
        {data.announcements.slice(0, 2).map((a) => (
          <Card key={a.id} className="gap-1 px-4">
            <div className="flex items-center gap-2 font-semibold"><Megaphone className="size-4 text-primary" /> {a.title}</div>
            <p className="text-sm whitespace-pre-line text-muted-foreground">{a.body}</p>
          </Card>
        ))}
        {data.awards ? (
          <Card className="gap-3 px-4 ring-primary/30">
            <div className="flex items-center gap-2 text-lg font-semibold"><Trophy className="size-5 text-primary" /> Final results</div>
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              {[
                ["Winners", data.awards.champion_team_id ? teamMap.get(data.awards.champion_team_id)?.name : null],
                ["Runners up", data.awards.runner_up_team_id ? teamMap.get(data.awards.runner_up_team_id)?.name : null],
                ...(data.awards.third_place_team_id ? [["Third place", teamMap.get(data.awards.third_place_team_id)?.name]] : []),
                ["MVP", data.awards.mvp_player_id ? playerMap.get(data.awards.mvp_player_id)?.full_name : null],
                ["Most goals", data.awards.top_scorer_player_ids.length ? `${data.awards.top_scorer_player_ids.map((id) => playerMap.get(id)?.full_name ?? "Unknown").join(", ")} (${data.awards.top_scorer_goals})` : null],
              ].map(([label, value]) => (
                <div key={label as string} className="rounded-lg border p-3">
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="font-semibold">{value ?? "To be confirmed"}</dd>
                </div>
              ))}
            </dl>
          </Card>
        ) : null}
        {live.length ? (
          <Card className="gap-0 py-0 ring-live/30">
            <div className="flex items-center gap-2 border-b px-4 py-2.5 text-sm font-semibold"><span className="size-2 animate-pulse rounded-full bg-live" /> Live now</div>
            <div className="divide-y">{live.map((f) => <FixtureRow key={f.id} fixture={f} teams={teamMap} pitchName={f.pitch_id ? pitchName.get(f.pitch_id) : null} />)}</div>
          </Card>
        ) : null}

        {!t.fixtures_published ? (
          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Fixtures will appear here once the organisers publish them.</p>
        ) : (
          <Tabs defaultValue={tables.length ? "table" : "fixtures"} className="min-w-0">
            <TabsList className="no-scrollbar h-auto max-w-full justify-start overflow-x-auto md:flex-wrap">
              {tables.length ? <TabsTrigger value="table" className="flex-none">Standings</TabsTrigger> : null}
              <TabsTrigger value="fixtures" className="flex-none">Fixtures and results</TabsTrigger>
              {hasKnockout ? <TabsTrigger value="bracket" className="flex-none">Knockout</TabsTrigger> : null}
              <TabsTrigger value="scorers" className="flex-none">Top scorers</TabsTrigger>
              {data.rules.length ? <TabsTrigger value="rules" className="flex-none">Rules</TabsTrigger> : null}
            </TabsList>
            <TabsContent value="table" className="space-y-6 pt-2">
              {tables.map((x) => (
                <section key={x.key}>
                  <h2 className="mb-2 text-sm font-semibold">{x.title}</h2>
                  <Card className="gap-0 py-0"><StandingsTable standings={x.standings} teams={teamMap} qualifiers={x.q} /></Card>
                  {x.standings.notes.map((n) => <p key={n} className="mt-1 text-xs text-muted-foreground">{n}</p>)}
                </section>
              ))}
            </TabsContent>
            <TabsContent value="fixtures" className="space-y-4 pt-2">
              {[...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, list]) => (
                <section key={date}>
                  <h2 className="mb-2 text-sm font-semibold">{date ? formatDate(date) : "Date to be confirmed"}{date === today ? " (today)" : ""}</h2>
                  {(data.breaks ?? []).filter((b) => (b.date ?? t.start_date) === date).length ? (
                    <div className="mb-2 flex flex-wrap gap-2 text-xs">
                      {(data.breaks ?? []).filter((b) => (b.date ?? t.start_date) === date).map((b, i) => (
                        <span key={i} className="rounded-full border border-dashed border-warning/60 bg-warning/10 px-2.5 py-1">
                          {b.label ?? "Break"}: {formatClock(toMinutes(b.start))} to {formatClock(toMinutes(b.end))}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <Card className="gap-0 divide-y py-0">
                    {list.map((f) => <FixtureRow key={f.id} fixture={f} teams={teamMap} pitchName={f.pitch_id ? pitchName.get(f.pitch_id) : null} />)}
                  </Card>
                </section>
              ))}
            </TabsContent>
            <TabsContent value="bracket" className="pt-2"><Bracket fixtures={fixtures} teams={teamMap} /></TabsContent>
            <TabsContent value="scorers" className="pt-2">
              <Card className="gap-0 py-0">
                <Table className="tabular">
                  <TableHeader><TableRow><TableHead className="w-10">#</TableHead><TableHead>Player</TableHead><TableHead>Team</TableHead><TableHead className="text-center">Goals</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {stats.topScorers.slice(0, 20).map((p, i) => {
                      const pl = playerMap.get(p.playerId);
                      return (
                        <TableRow key={p.playerId}>
                          <TableCell>{i + 1}</TableCell>
                          <TableCell className="font-medium">{pl?.full_name ?? "Unknown"}</TableCell>
                          <TableCell className="text-muted-foreground">{pl?.team_id ? teamMap.get(pl.team_id)?.name : ""}</TableCell>
                          <TableCell className="text-center font-semibold">{p.goals}</TableCell>
                        </TableRow>
                      );
                    })}
                    {!stats.topScorers.length ? <TableRow><TableCell colSpan={4} className="text-muted-foreground">No goals yet.</TableCell></TableRow> : null}
                  </TableBody>
                </Table>
              </Card>
            </TabsContent>
            <TabsContent value="rules" className="space-y-5 pt-2">
              {rulesByCat.map(({ c, list }) => (
                <section key={c}>
                  <h2 className="mb-2 text-sm font-semibold text-muted-foreground">{RULE_CATEGORY_LABELS[c]}</h2>
                  <Card className="gap-0 divide-y py-0">
                    {list.map((r) => (
                      <article key={r.id} className="px-4 py-3">
                        <h3 className="font-medium">{r.title}</h3>
                        <p className="mt-1 text-sm whitespace-pre-line text-muted-foreground">{r.body}</p>
                      </article>
                    ))}
                  </Card>
                </section>
              ))}
            </TabsContent>
          </Tabs>
        )}
        <footer className="pt-6 text-center text-xs text-muted-foreground">Results are confirmed by the organisers. Live scores may change until a result is confirmed.</footer>
      </main>
    </div>
  );
}
