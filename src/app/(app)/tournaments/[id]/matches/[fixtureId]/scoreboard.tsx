"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeftRight,
  CircleAlert,
  CircleCheck,
  Clock,
  Flag,
  Goal,
  MapPin,
  Pause,
  Play,
  RotateCcw,
  Square,
  StickyNote,
  Timer,
  Trash2,
  UserX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, NativeSelect } from "@/components/app/field";
import { FixtureStatusBadge } from "@/components/app/status-badge";
import { TeamMark } from "@/components/app/team-name";
import { ConfirmAction } from "@/components/app/confirm-action";
import { useAction } from "@/hooks/use-action";
import {
  clearForfeit,
  confirmResult,
  controlMatch,
  deleteEvent,
  recordEvent,
  recordForfeit,
  reopenResult,
  saveMatchNotes,
} from "@/lib/actions/matches";
import { EVENT_LABELS, elapsedSeconds, formatClockSeconds } from "@/lib/domain";
import { describeSource, type MatchAlert } from "@/lib/engine";
import type { EventType, Fixture, MatchEvent, MatchOfficial, Player, Team } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Permissions {
  record: boolean;
  control: boolean;
  confirm: boolean;
  correct: boolean;
  admin: boolean;
  refereeNotes: boolean;
}

interface MatchSettings {
  periods: 1 | 2;
  matchDurationMin: number | null;
  extraTime: boolean;
  shootoutKicks: number;
  forfeitGoals: number | null;
  minPlayers: number | null;
  secondYellowIsRed: boolean;
}

const PERIOD_LABELS: Record<Fixture["period"], string> = {
  not_started: "Not started",
  first_half: "First half",
  half_time: "Half-time",
  second_half: "Second half",
  extra_time: "Extra time",
  penalties: "Penalty shootout",
  full_time: "Full time",
};

type Pending = { type: EventType; teamId: string } | null;

export function Scoreboard({
  tournamentId,
  fixture: f,
  home,
  away,
  players,
  events,
  pitchName,
  officials,
  authorNames,
  alerts,
  settings,
  squadCounts,
  permissions: can,
}: {
  tournamentId: string;
  fixture: Fixture;
  home: Team | null;
  away: Team | null;
  players: Player[];
  events: MatchEvent[];
  pitchName: string | null;
  officials: (MatchOfficial & { name: string })[];
  authorNames: Record<string, string>;
  alerts: MatchAlert[];
  settings: MatchSettings;
  squadCounts: Record<string, number>;
  permissions: Permissions;
}) {
  const { pending, run } = useAction();
  const [now, setNow] = useState(() => Date.now());
  const [entry, setEntry] = useState<Pending>(null);
  useEffect(() => {
    if (f.status !== "in_progress") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [f.status]);
  const elapsed = elapsedSeconds(f, now);
  const playerMap = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const teamOf = (id: string | null) => (id === home?.id ? home : id === away?.id ? away : null);
  const isLive = f.status === "in_progress" || f.status === "paused";
  const teamsKnown = !!home && !!away;
  const knockout = f.stage === "knockout";
  const drawn = f.home_score === f.away_score;
  const showShootout = knockout && (f.period === "penalties" || f.home_penalties !== null || (f.status === "completed" && drawn));
  const unavailable = new Set(alerts.map((a) => a.playerId));
  const control = (cmd: string) => run(() => controlMatch(tournamentId, f.id, cmd));

  const record = (type: EventType, teamId: string, extra: Partial<MatchEvent> = {}) =>
    run(
      () =>
        recordEvent(tournamentId, {
          fixture_id: f.id,
          event_type: type,
          team_id: teamId,
          match_second: isLive || f.status === "completed" ? elapsed : null,
          period: f.period,
          ...extra,
        }),
      { success: `${EVENT_LABELS[type]} recorded.`, onSuccess: () => setEntry(null) },
    );

  return (
    <div className="space-y-5">
      {/* Scoreboard */}
      <Card className={cn("gap-4 overflow-hidden", isLive && "ring-live/40")}>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-2">
            <FixtureStatusBadge status={f.status} />
            <span>{f.code}{f.round_name ? ` · ${f.round_name}` : ""}</span>
            {f.correction_count ? <Badge variant="outline">Corrected {f.correction_count}×</Badge> : null}
            {f.decided_by === "forfeit" ? <Badge variant="outline">Forfeit</Badge> : null}
          </span>
          <span className="flex items-center gap-3">
            {pitchName ? <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" />{pitchName}</span> : null}
            {f.scheduled_time ? <span className="inline-flex items-center gap-1"><Clock className="size-3.5" />{f.scheduled_time.slice(0, 5)}</span> : null}
          </span>
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 sm:gap-6">
          <TeamSide team={home} fallback={describeSource(f.home_source)} winner={f.winner_team_id === home?.id && !!home} />
          <div className="text-center">
            <div className="text-5xl font-bold tracking-tight tabular sm:text-6xl">
              {f.home_score}<span className="mx-2 text-muted-foreground/60">–</span>{f.away_score}
            </div>
            {f.home_penalties !== null && f.away_penalties !== null ? (
              <div className="mt-1 text-sm text-muted-foreground tabular">Penalties {f.home_penalties}–{f.away_penalties}</div>
            ) : null}
            <div className={cn("mt-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium tabular", isLive ? "bg-live/10 text-live" : "bg-muted text-muted-foreground")}>
              <Timer className="size-3.5" />
              {/* The clock ticks, so server and browser render different seconds. */}
              <span suppressHydrationWarning>{formatClockSeconds(elapsed)}</span>
              {settings.matchDurationMin ? <span className="text-xs opacity-70">/ {settings.matchDurationMin}:00</span> : null}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{PERIOD_LABELS[f.period]}</div>
          </div>
          <TeamSide team={away} fallback={describeSource(f.away_source)} winner={f.winner_team_id === away?.id && !!away} align="right" />
        </div>

        {can.control && teamsKnown ? (
          <div className="no-print flex flex-wrap justify-center gap-2 border-t px-4 pt-4">
            {f.status === "scheduled" ? (
              <Button size="lg" onClick={() => control("start")} disabled={pending}><Play /> Start match</Button>
            ) : null}
            {f.status === "in_progress" ? (
              <Button size="lg" variant="outline" onClick={() => control("pause")} disabled={pending}><Pause /> Pause</Button>
            ) : null}
            {f.status === "paused" && f.period !== "half_time" && f.period !== "penalties" ? (
              <Button size="lg" onClick={() => control("resume")} disabled={pending}><Play /> Resume</Button>
            ) : null}
            {settings.periods === 2 && f.period === "first_half" && isLive ? (
              <Button size="lg" variant="outline" onClick={() => control("half_time")} disabled={pending}>Half-time</Button>
            ) : null}
            {f.period === "half_time" ? (
              <Button size="lg" onClick={() => control("second_half")} disabled={pending}><Play /> Start second half</Button>
            ) : null}
            {knockout && settings.extraTime && isLive && f.period !== "extra_time" && f.period !== "penalties" && drawn ? (
              <Button size="lg" variant="outline" onClick={() => control("extra_time")} disabled={pending}>Extra time</Button>
            ) : null}
            {knockout && isLive && f.period !== "penalties" && drawn ? (
              <Button size="lg" variant="outline" onClick={() => control("penalties")} disabled={pending}>Penalty shootout</Button>
            ) : null}
            {isLive ? (
              <ConfirmAction
                trigger={<Button size="lg" variant="destructive" disabled={pending}><Square /> End match</Button>}
                title="End the match?"
                description={`Final score ${f.home_score}–${f.away_score}. The result still needs to be confirmed before standings update.`}
                confirmLabel="End match"
                action={() => controlMatch(tournamentId, f.id, "end")}
              />
            ) : null}
          </div>
        ) : null}
        {!teamsKnown ? (
          <p className="px-4 text-center text-sm text-muted-foreground">Teams for this match are decided by earlier results.</p>
        ) : null}
      </Card>

      {alerts.length ? (
        <Alert variant="destructive">
          <UserX />
          <AlertTitle>{alerts.length} player{alerts.length > 1 ? "s" : ""} must not play</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {alerts.map((a) => (
                <li key={a.playerId}><strong>{a.playerName}</strong> ({teamOf(a.teamId)?.name}): {a.reasons.join(" ")}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
      {settings.minPlayers && teamsKnown && f.status === "scheduled"
        ? [home!, away!]
            .filter((t) => (squadCounts[t.id] ?? 0) < settings.minPlayers!)
            .map((t) => (
              <Alert key={t.id}>
                <CircleAlert />
                <AlertDescription>{t.name} has only {squadCounts[t.id] ?? 0} confirmed players (minimum to start: {settings.minPlayers}).</AlertDescription>
              </Alert>
            ))
        : null}

      {/* Quick event entry */}
      {can.record && teamsKnown ? (
        <div className="no-print grid gap-4 md:grid-cols-2">
          {[home!, away!].map((team) => (
            <Card key={team.id} className="gap-3 px-4">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <TeamMark team={team} /> {team.name}
              </div>
              {showShootout ? (
                <div className="grid grid-cols-2 gap-2">
                  <Button size="lg" className="h-14 text-base" disabled={pending} onClick={() => setEntry({ type: "shootout_goal", teamId: team.id })}>
                    <CircleCheck /> Penalty scored
                  </Button>
                  <Button size="lg" variant="outline" className="h-14 text-base" disabled={pending} onClick={() => setEntry({ type: "shootout_miss", teamId: team.id })}>
                    Penalty missed
                  </Button>
                </div>
              ) : (
                <Button size="lg" className="h-14 text-base" disabled={pending} onClick={() => setEntry({ type: "goal", teamId: team.id })}>
                  <Goal className="size-5!" /> Goal
                </Button>
              )}
              <div className="grid grid-cols-3 gap-2">
                <EventButton label="Yellow" onClick={() => setEntry({ type: "yellow_card", teamId: team.id })} swatch="bg-yellow-400" disabled={pending} />
                <EventButton label="Red" onClick={() => setEntry({ type: "red_card", teamId: team.id })} swatch="bg-red-600" disabled={pending} />
                <EventButton label="Foul" onClick={() => setEntry({ type: "foul", teamId: team.id })} icon={Flag} disabled={pending} />
                <EventButton label="Penalty goal" onClick={() => setEntry({ type: "penalty_goal", teamId: team.id })} icon={Goal} disabled={pending} />
                <EventButton label="Own goal" onClick={() => setEntry({ type: "own_goal", teamId: team.id })} icon={RotateCcw} disabled={pending} />
                <EventButton label="Time penalty" onClick={() => setEntry({ type: "sin_bin", teamId: team.id })} icon={Timer} disabled={pending} />
                <EventButton label="Substitution" onClick={() => setEntry({ type: "substitution", teamId: team.id })} icon={ArrowLeftRight} disabled={pending} className="col-span-3" />
              </div>
            </Card>
          ))}
        </div>
      ) : null}

      {entry ? (
        <EventDialog
          entry={entry}
          team={teamOf(entry.teamId)!}
          players={players.filter((p) => p.team_id === entry.teamId && p.registration_status === "confirmed")}
          unavailable={unavailable}
          events={events}
          secondYellowIsRed={settings.secondYellowIsRed}
          pending={pending}
          onCancel={() => setEntry(null)}
          onSubmit={(extra) => record(entry.type, entry.teamId, extra)}
        />
      ) : null}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_20rem]">
        {/* Timeline */}
        <Card className="gap-0 py-0">
          <div className="border-b px-4 py-3 text-sm font-semibold">Match events</div>
          {events.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No events recorded yet.</p>
          ) : (
            <ol className="divide-y">
              {[...events].reverse().map((e) => {
                const team = teamOf(e.team_id);
                const player = e.player_id ? playerMap.get(e.player_id) : null;
                const assist = e.assist_player_id ? playerMap.get(e.assist_player_id) : null;
                const off = e.related_player_id ? playerMap.get(e.related_player_id) : null;
                return (
                  <li key={e.id} className={cn("flex items-start gap-3 px-4 py-2.5 text-sm", team?.id === away?.id && "sm:flex-row-reverse sm:text-right")}>
                    <span className="w-10 shrink-0 text-xs text-muted-foreground tabular">
                      {e.match_second !== null ? `${Math.floor(e.match_second / 60) + 1}'` : "–"}
                    </span>
                    <EventIcon type={e.event_type} />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">
                        {EVENT_LABELS[e.event_type]}
                        {e.event_type === "sin_bin" && e.duration_min ? ` (${e.duration_min} min)` : ""}
                        {player ? <span className="font-normal">: {player.full_name}</span> : null}
                        {e.event_type === "substitution" && off ? <span className="font-normal text-muted-foreground"> for {off.full_name}</span> : null}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {team?.name}
                        {assist ? ` · assist ${assist.full_name}` : ""}
                        {e.detail ? ` · ${e.detail}` : ""}
                        {` · by ${e.created_by ? authorNames[e.created_by] ?? "an organiser" : "system"} at ${new Date(e.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`}
                      </div>
                    </div>
                    {can.record ? (
                      <ConfirmAction
                        destructive
                        trigger={<Button variant="ghost" size="icon-sm" aria-label="Remove event" className="no-print"><Trash2 /></Button>}
                        title="Remove this event?"
                        description="The score and discipline records are recalculated."
                        confirmLabel="Remove"
                        action={() => deleteEvent(tournamentId, e.id)}
                      />
                    ) : null}
                  </li>
                );
              })}
            </ol>
          )}
        </Card>

        <div className="space-y-5">
          {/* Result */}
          <Card>
            <CardHeader><CardTitle>Result</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              {f.status === "confirmed" ? (
                <p className="flex items-center gap-2 text-success"><CircleCheck className="size-4" /> Confirmed{f.confirmed_at ? ` at ${new Date(f.confirmed_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}. Standings include this result.</p>
              ) : f.status === "completed" ? (
                <p className="text-muted-foreground">The match has ended. Check the events, then confirm the result to update the standings.</p>
              ) : (
                <p className="text-muted-foreground">The result can be confirmed once the match has ended.</p>
              )}
              {can.confirm && f.status === "completed" ? (
                <ConfirmAction
                  trigger={<Button className="w-full" size="lg"><CircleCheck /> Confirm result</Button>}
                  title={`Confirm ${f.home_score}–${f.away_score}?`}
                  description={
                    knockout && drawn && (f.home_penalties ?? 0) === (f.away_penalties ?? 0)
                      ? "This knockout match is level. Record the penalty shootout first."
                      : "Standings and knockout progression update immediately. Later changes need an audited correction."
                  }
                  confirmLabel="Confirm result"
                  action={() => confirmResult(tournamentId, f.id)}
                />
              ) : null}
              {can.correct && f.status === "confirmed" ? (
                <ConfirmAction
                  trigger={<Button variant="outline" className="w-full"><RotateCcw /> Correct result</Button>}
                  title="Correct a confirmed result?"
                  description="The result is reopened so events can be fixed, then it must be confirmed again. The reason is stored in the audit log."
                  reason={{ label: "Reason for the correction", placeholder: "e.g. Goal credited to the wrong player" }}
                  confirmLabel="Reopen for correction"
                  action={(reason) => reopenResult(tournamentId, f.id, reason)}
                />
              ) : null}
              {can.admin && teamsKnown && f.status !== "confirmed" ? (
                f.decided_by === "forfeit" ? (
                  <Button variant="ghost" className="w-full" disabled={pending} onClick={() => run(() => clearForfeit(tournamentId, f.id))}>Clear forfeit</Button>
                ) : (
                  <ForfeitButton tournamentId={tournamentId} fixtureId={f.id} home={home!} away={away!} forfeitGoals={settings.forfeitGoals} />
                )
              ) : null}
              {can.admin && isLive && events.length === 0 ? (
                <Button variant="ghost" size="sm" className="w-full" disabled={pending} onClick={() => control("reset_to_scheduled")}>Reset to not started</Button>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Officials</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              {officials.length ? (
                officials.map((o) => (
                  <div key={o.id} className="flex justify-between gap-2">
                    <span>{o.name}</span>
                    <span className="text-muted-foreground capitalize">{o.role}</span>
                  </div>
                ))
              ) : (
                <p className="text-muted-foreground">No officials assigned.</p>
              )}
            </CardContent>
          </Card>

          {can.admin || can.refereeNotes ? (
            <NotesCard tournamentId={tournamentId} fixture={f} canMatch={can.admin} canReferee={can.refereeNotes} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function TeamSide({ team, fallback, winner, align }: { team: Team | null; fallback: string; winner: boolean; align?: "right" }) {
  return (
    <div className={cn("flex min-w-0 flex-col items-center gap-2 text-center", align === "right" ? "sm:items-center" : "")}>
      <TeamMark team={team ?? { name: fallback }} size="lg" />
      <div className={cn("line-clamp-2 w-full text-sm leading-tight font-semibold break-words sm:text-base", !team && "text-muted-foreground italic", winner && "text-success")}>
        {team?.name ?? fallback}
      </div>
    </div>
  );
}

function EventButton({
  label,
  onClick,
  icon: Icon,
  swatch,
  disabled,
  className,
}: {
  label: string;
  onClick: () => void;
  icon?: typeof Goal;
  swatch?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Button variant="outline" className={cn("h-11 flex-col gap-0.5 px-1 text-xs", className)} onClick={onClick} disabled={disabled}>
      {swatch ? <span className={cn("h-3.5 w-2.5 rounded-[2px]", swatch)} /> : Icon ? <Icon /> : null}
      {label}
    </Button>
  );
}

function EventIcon({ type }: { type: EventType }) {
  if (type === "yellow_card") return <span className="mt-0.5 h-4 w-3 shrink-0 rounded-[2px] bg-yellow-400" />;
  if (type === "red_card") return <span className="mt-0.5 h-4 w-3 shrink-0 rounded-[2px] bg-red-600" />;
  const Icon = type === "substitution" ? ArrowLeftRight : type === "foul" ? Flag : type === "sin_bin" ? Timer : type === "note" ? StickyNote : Goal;
  return <Icon className={cn("mt-0.5 size-4 shrink-0", type.includes("goal") ? "text-success" : "text-muted-foreground", type === "own_goal" && "text-destructive", type === "shootout_miss" && "text-destructive")} />;
}

const QUICK_TYPES: EventType[] = ["goal", "own_goal", "penalty_goal", "foul", "shootout_goal", "shootout_miss"];

function EventDialog({
  entry,
  team,
  players,
  unavailable,
  events,
  secondYellowIsRed,
  pending,
  onCancel,
  onSubmit,
}: {
  entry: { type: EventType; teamId: string };
  team: Team;
  players: Player[];
  unavailable: Set<string>;
  events: MatchEvent[];
  secondYellowIsRed: boolean;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (extra: Partial<MatchEvent>) => void;
}) {
  const [assist, setAssist] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [off, setOff] = useState("");
  const [detail, setDetail] = useState("");
  const [minutes, setMinutes] = useState(2);
  const quick = QUICK_TYPES.includes(entry.type);
  const needsPlayer = ["yellow_card", "red_card", "sin_bin", "substitution"].includes(entry.type);
  const isGoal = entry.type === "goal" || entry.type === "penalty_goal";
  const sorted = [...players].sort((a, b) => (a.jersey_number ?? 999) - (b.jersey_number ?? 999) || a.full_name.localeCompare(b.full_name));
  const yellowsThisMatch = (pid: string) => events.filter((e) => e.player_id === pid && e.event_type === "yellow_card").length;

  const submit = (playerId: string | null) =>
    onSubmit({
      player_id: playerId,
      assist_player_id: isGoal && assist ? assist : null,
      related_player_id: entry.type === "substitution" && off ? off : null,
      duration_min: entry.type === "sin_bin" ? minutes : null,
      detail: detail.trim() || null,
    });

  const title =
    entry.type === "own_goal"
      ? `Own goal by a ${team.name} player`
      : `${EVENT_LABELS[entry.type]}: ${team.name}`;

  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {quick ? "Tap the player to record it straight away." : entry.type === "substitution" ? "Choose the player coming on and the player going off." : "Choose the player, then confirm."}
            {entry.type === "own_goal" ? " The goal is credited to the opposing team." : ""}
          </DialogDescription>
        </DialogHeader>
        {isGoal && players.length > 1 ? (
          <Field label="Assist (optional, choose before the scorer)" htmlFor="ev-assist">
            <NativeSelect id="ev-assist" value={assist} onChange={(e) => setAssist(e.target.value)}>
              <option value="">No assist</option>
              {sorted.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </NativeSelect>
          </Field>
        ) : null}
        {entry.type === "sin_bin" ? (
          <Field label="Length" hint="The rulebook uses 2 minutes for a sliding tackle and 4 minutes for aggression towards the referee.">
            <div className="flex gap-2">
              {[2, 4].map((m) => (
                <Button key={m} type="button" variant={minutes === m ? "default" : "outline"} size="sm" onClick={() => setMinutes(m)}>{m} min</Button>
              ))}
              <Input type="number" min={1} max={30} value={minutes} onChange={(e) => setMinutes(Number(e.target.value) || 1)} className="w-20" aria-label="Minutes" />
            </div>
          </Field>
        ) : null}
        {sorted.length === 0 ? <p className="text-sm text-muted-foreground">This team has no confirmed players.</p> : null}
        <div className="grid grid-cols-2 gap-2">
          {sorted.map((p) => {
            const second = entry.type === "yellow_card" && yellowsThisMatch(p.id) >= 1;
            return (
              <Button
                key={p.id}
                type="button"
                variant={selected === p.id ? "default" : "outline"}
                className="h-auto min-h-11 justify-start gap-2 py-2 text-left whitespace-normal"
                disabled={pending || (entry.type === "substitution" && p.id === off)}
                onClick={() => (quick ? submit(p.id) : setSelected(p.id))}
              >
                <span className="w-6 shrink-0 text-xs tabular opacity-70">{p.jersey_number ?? ""}</span>
                <span className="min-w-0 flex-1">
                  {p.full_name}
                  {unavailable.has(p.id) ? <span className="block text-[11px] text-destructive">Not eligible</span> : null}
                  {second ? <span className="block text-[11px] text-amber-600">Already booked{secondYellowIsRed ? ": second yellow means a red" : ""}</span> : null}
                </span>
              </Button>
            );
          })}
        </div>
        {entry.type === "substitution" ? (
          <Field label="Player going off" htmlFor="ev-off">
            <NativeSelect id="ev-off" value={off} onChange={(e) => setOff(e.target.value)}>
              <option value="">Not recorded</option>
              {sorted.filter((p) => p.id !== selected).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </NativeSelect>
          </Field>
        ) : null}
        {!quick ? (
          <Field label={entry.type.includes("card") ? "Reason (optional)" : "Note (optional)"} htmlFor="ev-detail">
            <Textarea id="ev-detail" rows={2} value={detail} onChange={(e) => setDetail(e.target.value)} />
          </Field>
        ) : null}
        <DialogFooter className="gap-2">
          {quick && entry.type !== "own_goal" ? (
            <Button type="button" variant="outline" disabled={pending} onClick={() => submit(null)}>Player unknown</Button>
          ) : null}
          {!quick ? (
            <Button type="button" disabled={pending || (needsPlayer && !selected)} onClick={() => submit(selected)}>
              {pending ? "Saving…" : `Record ${EVENT_LABELS[entry.type].toLowerCase()}`}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ForfeitButton({ tournamentId, fixtureId, home, away, forfeitGoals }: { tournamentId: string; fixtureId: string; home: Team; away: Team; forfeitGoals: number | null }) {
  const [awarded, setAwarded] = useState(home.id);
  return (
    <ConfirmAction
      trigger={<Button variant="ghost" className="w-full">Record forfeit or walkover</Button>}
      title="Record a forfeit"
      description={
        <>
          {forfeitGoals === null ? (
            <p className="text-destructive">Set the forfeit score in Settings, Discipline first.</p>
          ) : (
            <p>The awarded team wins {forfeitGoals}–0. Recorded events are kept but do not count.</p>
          )}
          <NativeSelect aria-label="Awarded team" value={awarded} onChange={(e) => setAwarded(e.target.value)}>
            <option value={home.id}>Award to {home.name}</option>
            <option value={away.id}>Award to {away.name}</option>
          </NativeSelect>
        </>
      }
      reason={{ label: "Reason", placeholder: "e.g. Team could not field enough players" }}
      confirmLabel="Record forfeit"
      action={(reason) => recordForfeit(tournamentId, fixtureId, awarded, reason)}
    />
  );
}

function NotesCard({ tournamentId, fixture, canMatch, canReferee }: { tournamentId: string; fixture: Fixture; canMatch: boolean; canReferee: boolean }) {
  const { pending, run } = useAction();
  const [notes, setNotes] = useState(fixture.notes ?? "");
  const [refNotes, setRefNotes] = useState(fixture.referee_notes ?? "");
  return (
    <Card>
      <CardHeader><CardTitle>Notes</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {canMatch && fixture.status !== "confirmed" ? (
          <Field label="Match notes" htmlFor="n-match">
            <Textarea id="n-match" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== (fixture.notes ?? "") && run(() => saveMatchNotes(tournamentId, fixture.id, "notes", notes))} />
          </Field>
        ) : fixture.notes ? (
          <p className="text-sm">{fixture.notes}</p>
        ) : null}
        {canReferee && fixture.status !== "confirmed" ? (
          <Field label="Referee notes" htmlFor="n-ref" hint="Saved when you leave the field.">
            <Textarea id="n-ref" rows={3} value={refNotes} onChange={(e) => setRefNotes(e.target.value)} onBlur={() => refNotes !== (fixture.referee_notes ?? "") && run(() => saveMatchNotes(tournamentId, fixture.id, "referee_notes", refNotes))} />
          </Field>
        ) : fixture.referee_notes ? (
          <p className="text-sm"><span className="text-muted-foreground">Referee:</span> {fixture.referee_notes}</p>
        ) : null}
        {pending ? <p className="text-xs text-muted-foreground">Saving…</p> : null}
      </CardContent>
    </Card>
  );
}
