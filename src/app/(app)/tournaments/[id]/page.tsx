import Link from "next/link";
import {
  CalendarCheck,
  CalendarClock,
  CalendarRange,
  CircleAlert,
  ClipboardCheck,
  ListOrdered,
  MapPin,
  Plus,
  Shirt,
  Swords,
  Timer,
  Trophy,
  UserPlus,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardAction } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/app/page-header";
import { StatCard } from "@/components/app/stat-card";
import { EmptyState } from "@/components/app/empty-state";
import { TournamentStatusBadge } from "@/components/app/status-badge";
import { FixtureRow } from "@/components/tournament/fixture-row";
import { StandingsTable } from "@/components/tournament/standings-table";
import { getTournamentContext } from "@/lib/data/session";
import {
  getDecisions,
  getEvents,
  getFixtures,
  getOfficials,
  getPitches,
  getPlayers,
  getTeams,
  getTiebreakDecisions,
} from "@/lib/data/loaders";
import { FORMAT_LABELS, LIVE_STATUSES, formatDate, groupLabels, hasLeaguePhase, standingsFor } from "@/lib/domain";
import { formatClock, toMinutes } from "@/lib/engine";
import { pendingTasks } from "@/lib/tasks";
import { cn } from "@/lib/utils";

export default async function DashboardPage(props: PageProps<"/tournaments/[id]">) {
  const { id } = await props.params;
  const ctx = await getTournamentContext(id);
  const { tournament: t, settings: s } = ctx;
  const [teams, players, fixtures, events, pitches, decisions, officials, tiebreaks] = await Promise.all([
    getTeams(id),
    getPlayers(id),
    getFixtures(id),
    getEvents(id),
    getPitches(id),
    getDecisions(id),
    getOfficials(id),
    getTiebreakDecisions(id),
  ]);
  const { count: pendingRegistrations } = ctx.isAdmin
    ? await ctx.supabase.from("registrations").select("id", { count: "exact", head: true }).eq("tournament_id", id).eq("status", "pending")
    : { count: 0 };

  const teamMap = new Map(teams.map((x) => [x.id, x]));
  const pitchName = new Map(pitches.map((p) => [p.id, p.name]));
  const confirmed = fixtures.filter((f) => f.status === "confirmed");
  const live = fixtures.filter((f) => LIVE_STATUSES.includes(f.status));
  const upcoming = fixtures.filter((f) => f.status === "scheduled").slice(0, 6);
  const recent = [...confirmed]
    .sort((a, b) => (b.confirmed_at ?? "").localeCompare(a.confirmed_at ?? ""))
    .slice(0, 5);
  const activePlayers = players.filter((p) => p.registration_status === "confirmed").length;
  const tasks = ctx.isAdmin
    ? pendingTasks({ tournament: t, settings: s, teams, players, fixtures, decisions, officials, pendingRegistrations: pendingRegistrations ?? 0 })
    : [];
  const myAssignments = officials.filter((o) => o.user_id === ctx.profile.id);
  const myFixtureIds = new Set(myAssignments.map((o) => o.fixture_id));
  const base = `/tournaments/${id}`;

  const showLeague = hasLeaguePhase(t.format);
  const groups = t.format === "group_knockout" ? groupLabels(teams) : [];
  const standings = showLeague ? standingsFor(s, teams, fixtures, events, tiebreaks, { stage: "league" }) : null;
  const nextForMe = fixtures.find((f) => myFixtureIds.has(f.id) && ["scheduled", "in_progress", "paused", "completed"].includes(f.status));
  const awaitingConfirmation = fixtures.find((f) => f.status === "completed") ?? live[0];

  return (
    <>
      <PageHeader
        eyebrow={FORMAT_LABELS[t.format]}
        title={
          <span className="flex items-center gap-3">
            {t.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={t.logo_url} alt="" className="size-10 rounded-lg object-cover" />
            ) : null}
            {t.name}
            <TournamentStatusBadge status={t.status} />
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="inline-flex items-center gap-1"><CalendarRange className="size-3.5" /> {formatDate(t.start_date)}</span>
            {t.daily_start_time && t.daily_end_time ? (
              <span className="inline-flex items-center gap-1">
                <CalendarClock className="size-3.5" /> {formatClock(toMinutes(t.daily_start_time))} to {formatClock(toMinutes(t.daily_end_time))}
              </span>
            ) : null}
            {t.venue ? <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" /> {t.venue}</span> : null}
          </span>
        }
      />

      <div className="no-print mb-6 flex flex-wrap gap-2">
        {ctx.can("tournament.create") ? (
          <Button asChild variant="outline" size="sm"><Link href="/tournaments/new"><Trophy /> Create tournament</Link></Button>
        ) : null}
        {ctx.isAdmin ? (
          <>
            <Button asChild variant="outline" size="sm"><Link href={`${base}/teams?new=team`}><Plus /> Add team</Link></Button>
            <Button asChild variant="outline" size="sm"><Link href={`${base}/teams?new=player`}><UserPlus /> Add player</Link></Button>
            <Button asChild variant="outline" size="sm"><Link href={`${base}/fixtures`}><Swords /> Generate fixtures</Link></Button>
          </>
        ) : null}
        {awaitingConfirmation || nextForMe ? (
          <Button asChild size="sm">
            <Link href={`${base}/matches/${(nextForMe ?? awaitingConfirmation)!.id}`}><Timer /> Enter match result</Link>
          </Button>
        ) : (
          <Button asChild size="sm"><Link href={`${base}/matches`}><Timer /> Enter match result</Link></Button>
        )}
        <Button asChild variant="outline" size="sm"><Link href={`${base}/standings`}><ListOrdered /> View standings</Link></Button>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Teams" value={teams.length} icon={Users} hint={`${s.team_count} expected`} />
        <StatCard label="Registered players" value={activePlayers} icon={Shirt} hint={`max ${s.max_squad_size} per squad`} />
        <StatCard label="Fixtures" value={fixtures.length} icon={CalendarRange} hint={t.fixtures_published ? "Published" : fixtures.length ? "Not published" : "Not generated"} />
        <StatCard label="Completed" value={confirmed.length} icon={CalendarCheck} hint={`${fixtures.filter((f) => f.status === "completed").length} awaiting confirmation`} />
        <StatCard label="Upcoming" value={fixtures.filter((f) => f.status === "scheduled").length} icon={CalendarClock} hint={live.length ? `${live.length} live now` : undefined} />
      </div>

      {live.length ? (
        <Card className="mb-6 ring-live/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="size-2 animate-pulse rounded-full bg-live" /> Live now
            </CardTitle>
          </CardHeader>
          <CardContent className="-mx-4 -mb-4 divide-y border-t">
            {live.map((f) => (
              <FixtureRow key={f.id} fixture={f} teams={teamMap} pitchName={f.pitch_id ? pitchName.get(f.pitch_id) : null} href={`${base}/matches/${f.id}`} />
            ))}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-6">
          {standings ? (
            <Card>
              <CardHeader>
                <CardTitle>League standings</CardTitle>
                <CardAction>
                  <Button asChild variant="ghost" size="sm"><Link href={`${base}/standings`}>Full table</Link></Button>
                </CardAction>
              </CardHeader>
              <CardContent className="-mx-4 -mb-4 border-t">
                {teams.length ? (
                  <StandingsTable standings={standings} teams={teamMap} qualifiers={t.format === "league_playoff" ? s.qualifiers : null} compact />
                ) : (
                  <p className="p-4 text-sm text-muted-foreground">Add teams to see the table.</p>
                )}
              </CardContent>
            </Card>
          ) : groups.length ? (
            <Card>
              <CardHeader><CardTitle>Groups</CardTitle></CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                {groups.map((g) => (
                  <div key={g}>
                    <div className="mb-1 text-xs font-semibold text-muted-foreground">Group {g}</div>
                    <StandingsTable
                      standings={standingsFor(s, teams, fixtures, events, tiebreaks, { stage: "group", group: g })}
                      teams={teamMap}
                      qualifiers={s.qualifiers_per_group}
                      compact
                    />
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}

          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Recent results</CardTitle></CardHeader>
              <CardContent className="-mx-4 -mb-4 divide-y border-t">
                {recent.length ? (
                  recent.map((f) => <FixtureRow key={f.id} fixture={f} teams={teamMap} href={`${base}/matches/${f.id}`} />)
                ) : (
                  <p className="p-4 text-sm text-muted-foreground">No confirmed results yet.</p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Upcoming fixtures</CardTitle>
                <CardAction>
                  <Button asChild variant="ghost" size="sm"><Link href={`${base}/fixtures`}>All</Link></Button>
                </CardAction>
              </CardHeader>
              <CardContent className="-mx-4 -mb-4 divide-y border-t">
                {upcoming.length ? (
                  upcoming.map((f) => (
                    <FixtureRow key={f.id} fixture={f} teams={teamMap} pitchName={f.pitch_id ? pitchName.get(f.pitch_id) : null} href={`${base}/matches/${f.id}`} />
                  ))
                ) : (
                  <p className="p-4 text-sm text-muted-foreground">{fixtures.length ? "No upcoming matches." : "Fixtures have not been generated yet."}</p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="space-y-6">
          {ctx.isAdmin ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><ClipboardCheck className="size-4" /> Pending tasks</CardTitle>
              </CardHeader>
              <CardContent className="-mx-4 -mb-4 border-t">
                {tasks.length ? (
                  <ul className="divide-y">
                    {tasks.map((task) => (
                      <li key={task.key}>
                        <Link href={task.href} className="flex items-start gap-2.5 px-4 py-2.5 text-sm transition-colors hover:bg-muted/50">
                          <CircleAlert className={cn("mt-0.5 size-4 shrink-0", task.severity === "high" ? "text-amber-600" : "text-muted-foreground")} />
                          <span className="min-w-0">
                            <span className="block">{task.label}</span>
                            {task.detail ? <span className="block truncate text-xs text-muted-foreground">{task.detail}</span> : null}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="p-4 text-sm text-muted-foreground">Nothing outstanding.</p>
                )}
              </CardContent>
            </Card>
          ) : null}

          {myAssignments.length ? (
            <Card>
              <CardHeader><CardTitle>Your assigned matches</CardTitle></CardHeader>
              <CardContent className="-mx-4 -mb-4 divide-y border-t">
                {fixtures
                  .filter((f) => myFixtureIds.has(f.id))
                  .slice(0, 8)
                  .map((f) => (
                    <div key={f.id} className="relative">
                      <FixtureRow fixture={f} teams={teamMap} pitchName={f.pitch_id ? pitchName.get(f.pitch_id) : null} href={`${base}/matches/${f.id}`} />
                      <Badge variant="outline" className="absolute top-1 right-2 text-[10px]">
                        {myAssignments.filter((o) => o.fixture_id === f.id).map((o) => o.role).join(", ")}
                      </Badge>
                    </div>
                  ))}
              </CardContent>
            </Card>
          ) : null}

          {!fixtures.length && !ctx.isAdmin ? (
            <EmptyState title="Fixtures are not ready" description="The organisers have not published fixtures yet." />
          ) : null}
        </div>
      </div>
    </>
  );
}
