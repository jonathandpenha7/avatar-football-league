"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  CalendarCog,
  CircleAlert,
  Download,
  Eye,
  EyeOff,
  Pencil,
  Printer,
  RefreshCw,
  Swords,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/app/empty-state";
import { Field, NativeSelect } from "@/components/app/field";
import { FixtureStatusBadge } from "@/components/app/status-badge";
import { ConfirmAction } from "@/components/app/confirm-action";
import { FeasibilityPanel } from "@/components/tournament/feasibility-panel";
import type { SettingsDraft } from "@/components/tournament/settings-sections";
import { useAction } from "@/hooks/use-action";
import { generateFixtures, setFixturesPublished, swapFixtureSlots, updateFixture } from "@/lib/actions/fixtures";
import { describeSource, formatClock, toMinutes, type Conflict } from "@/lib/engine";
import { formatDate } from "@/lib/domain";
import { downloadCsv, slugify } from "@/lib/csv";
import type { Fixture, Pitch, Team, Tournament } from "@/lib/types";
import { cn } from "@/lib/utils";

export function FixturesView({
  tournament: t,
  settings,
  fixtures,
  teams,
  pitches,
  conflicts,
  isAdmin,
}: {
  tournament: Tournament;
  settings: SettingsDraft;
  fixtures: Fixture[];
  teams: Team[];
  pitches: Pitch[];
  conflicts: Conflict[];
  isAdmin: boolean;
}) {
  const { pending, run } = useAction();
  const [view, setView] = useState<"grid" | "list">("grid");
  const [editing, setEditing] = useState<Fixture | null>(null);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [withSchedule, setWithSchedule] = useState(settings.match_duration_min !== null && settings.transition_min !== null);
  const teamMap = useMemo(() => new Map(teams.map((x) => [x.id, x])), [teams]);
  const pitchMap = useMemo(() => new Map(pitches.map((p) => [p.id, p])), [pitches]);
  const conflictIds = new Set(conflicts.filter((c) => c.severity === "error").flatMap((c) => c.fixtureIds));
  const warningIds = new Set(conflicts.filter((c) => c.severity === "warning").flatMap((c) => c.fixtureIds));
  const started = fixtures.some((f) => !["scheduled", "postponed", "cancelled"].includes(f.status));
  const errors = conflicts.filter((c) => c.severity === "error");
  const warnings = conflicts.filter((c) => c.severity === "warning");

  const label = (id: string | null, source: string | null) => (id ? teamMap.get(id)?.name ?? "?" : describeSource(source));

  const exportCsv = () =>
    downloadCsv(
      `${slugify(t.name)}-fixtures.csv`,
      fixtures.map((f) => ({
        code: f.code,
        stage: f.round_name ?? f.stage,
        date: f.scheduled_date ?? "",
        time: f.scheduled_time?.slice(0, 5) ?? "",
        pitch: f.pitch_id ? pitchMap.get(f.pitch_id)?.name ?? "" : "",
        home: label(f.home_team_id, f.home_source),
        away: label(f.away_team_id, f.away_source),
        status: f.status,
        score: f.status === "confirmed" ? `${f.home_score}-${f.away_score}` : "",
      })),
    );

  // Grid rows: one per kick-off time, one column per pitch.
  const slots = useMemo(() => {
    const map = new Map<string, Fixture[]>();
    for (const f of fixtures) {
      const key = f.scheduled_date && f.scheduled_time ? `${f.scheduled_date}|${f.scheduled_time.slice(0, 5)}` : "unscheduled";
      map.set(key, [...(map.get(key) ?? []), f]);
    }
    return [...map.entries()].sort(([a], [b]) => (a === "unscheduled" ? 1 : b === "unscheduled" ? -1 : a.localeCompare(b)));
  }, [fixtures]);
  const multiDay = new Set(fixtures.map((f) => f.scheduled_date).filter(Boolean)).size > 1;

  return (
    <div className="space-y-5">
      <div className="no-print flex flex-wrap items-center gap-2">
        {isAdmin ? (
          <>
            <Button size="sm" onClick={() => setGenerateOpen(true)} disabled={t.fixtures_published || started}>
              {fixtures.length ? <RefreshCw /> : <Swords />} {fixtures.length ? "Regenerate" : "Generate fixtures"}
            </Button>
            {fixtures.length ? (
              t.fixtures_published ? (
                <ConfirmAction
                  trigger={<Button size="sm" variant="outline"><EyeOff /> Unpublish</Button>}
                  title="Unpublish fixtures?"
                  description="The public page will stop showing fixtures and results. You can then regenerate fixtures that have not started."
                  confirmLabel="Unpublish"
                  action={() => setFixturesPublished(t.id, false)}
                />
              ) : (
                <ConfirmAction
                  trigger={<Button size="sm" variant="outline"><Eye /> Publish fixtures</Button>}
                  title="Publish fixtures?"
                  description={
                    errors.length
                      ? `There ${errors.length === 1 ? "is 1 schedule conflict" : `are ${errors.length} schedule conflicts`}. Fix them before publishing if you can.`
                      : "Published fixtures appear on the public page and can no longer be regenerated until you unpublish them."
                  }
                  confirmLabel="Publish"
                  action={() => setFixturesPublished(t.id, true)}
                />
              )
            ) : null}
          </>
        ) : null}
        <div className="flex-1" />
        {fixtures.length ? (
          <>
            <Tabs value={view} onValueChange={(v) => setView(v as "grid" | "list")} className="hidden md:flex">
              <TabsList>
                <TabsTrigger value="grid">By pitch</TabsTrigger>
                <TabsTrigger value="list">List</TabsTrigger>
              </TabsList>
            </Tabs>
            <Button size="sm" variant="outline" onClick={exportCsv}><Download /> CSV</Button>
            <Button size="sm" variant="outline" onClick={() => window.print()}><Printer /> Print</Button>
          </>
        ) : null}
      </div>

      {isAdmin ? (
        <div className="no-print">
          <FeasibilityPanel
            compact
            draft={{
              general: { start_date: t.start_date, end_date: t.end_date, daily_start_time: t.daily_start_time, daily_end_time: t.daily_end_time },
              format: t.format,
              settings,
              pitches: pitches.map((p) => ({ id: p.id, name: p.name, available_from: p.available_from, available_until: p.available_until })),
              teams: teams.map((x) => ({ id: x.id, name: x.name, seed: x.seed, groupLabel: x.group_label })),
            }}
          />
        </div>
      ) : null}

      {t.fixtures_published ? (
        <Badge variant="secondary" className="bg-success/15 text-success">Published</Badge>
      ) : fixtures.length ? (
        <Badge variant="outline">Draft: not visible on the public page</Badge>
      ) : null}

      {errors.length ? (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>{errors.length} schedule conflict{errors.length > 1 ? "s" : ""}</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">{errors.slice(0, 8).map((c, i) => <li key={i}>{c.message}</li>)}</ul>
          </AlertDescription>
        </Alert>
      ) : null}
      {warnings.length ? (
        <Alert>
          <TriangleAlert />
          <AlertTitle>{warnings.length} warning{warnings.length > 1 ? "s" : ""}</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">{warnings.slice(0, 6).map((c, i) => <li key={i}>{c.message}</li>)}</ul>
            {warnings.length > 6 ? <p>…and {warnings.length - 6} more.</p> : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {fixtures.length === 0 ? (
        <EmptyState
          icon={CalendarCog}
          title="No fixtures yet"
          description={isAdmin ? "Add your teams, check the feasibility panel above, then generate fixtures." : "The organisers have not generated fixtures yet."}
          action={isAdmin ? <Button onClick={() => setGenerateOpen(true)} disabled={teams.length < 2}><Swords /> Generate fixtures</Button> : null}
        />
      ) : (
        <>
        {view === "grid" ? (
        <Card className="hidden gap-0 overflow-x-auto py-0 md:flex">
          <div className="min-w-[36rem]">
            <div className="grid border-b bg-muted/40 text-xs font-medium text-muted-foreground" style={{ gridTemplateColumns: `5.5rem repeat(${Math.max(1, pitches.length)}, minmax(0, 1fr))` }}>
              <div className="px-3 py-2">Kick-off</div>
              {pitches.map((p) => <div key={p.id} className="border-l px-3 py-2">{p.name}</div>)}
            </div>
            {slots.map(([key, list]) => {
              const [date, time] = key.split("|");
              const unplaced = key === "unscheduled" ? list : list.filter((f) => !f.pitch_id || !pitchMap.has(f.pitch_id));
              return (
                <div key={key} className="border-b last:border-b-0">
                  <div className="grid" style={{ gridTemplateColumns: `5.5rem repeat(${Math.max(1, pitches.length)}, minmax(0, 1fr))` }}>
                    <div className="px-3 py-2 text-sm font-medium tabular">
                      {key === "unscheduled" ? <span className="text-muted-foreground">No time</span> : formatClock(toMinutes(time))}
                      {multiDay && key !== "unscheduled" ? <div className="text-xs font-normal text-muted-foreground">{formatDate(date, { day: "numeric", month: "short" })}</div> : null}
                    </div>
                    {pitches.map((p) => (
                      <div key={p.id} className="space-y-1 border-l p-1.5">
                        {key !== "unscheduled"
                          ? list.filter((f) => f.pitch_id === p.id).map((f) => (
                              <FixtureChip key={f.id} f={f} label={label} isAdmin={isAdmin} onEdit={setEditing} conflict={conflictIds.has(f.id)} warning={warningIds.has(f.id)} tid={t.id} />
                            ))
                          : null}
                      </div>
                    ))}
                  </div>
                  {unplaced.length ? (
                    <div className="flex flex-wrap gap-1.5 border-t border-dashed px-3 py-2">
                      {unplaced.map((f) => (
                        <FixtureChip key={f.id} f={f} label={label} isAdmin={isAdmin} onEdit={setEditing} conflict={conflictIds.has(f.id)} warning={warningIds.has(f.id)} tid={t.id} />
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </Card>
        ) : null}
        {/* Phones always get the list: the pitch grid needs a wide screen. */}
        <Card className={cn("gap-0 divide-y py-0", view === "grid" && "md:hidden")}>
          {fixtures.map((f) => (
            <div key={f.id} className={cn("grid grid-cols-[4rem_1fr_auto] items-center gap-3 px-3 py-2 text-sm", conflictIds.has(f.id) && "bg-destructive/5")}>
              <div className="text-xs tabular text-muted-foreground">
                <div className="font-medium text-foreground">{f.scheduled_time ? formatClock(toMinutes(f.scheduled_time)) : "TBC"}</div>
                {f.code}
              </div>
              <div className="min-w-0">
                <div className="leading-snug break-words">{label(f.home_team_id, f.home_source)} <span className="text-muted-foreground">v</span> {label(f.away_team_id, f.away_source)}</div>
                <div className="text-xs text-muted-foreground">{f.round_name}{f.pitch_id ? ` · ${pitchMap.get(f.pitch_id)?.name}` : ""}</div>
              </div>
              <div className="flex items-center gap-2">
                <FixtureStatusBadge status={f.status} className={f.status === "scheduled" ? "hidden sm:inline-flex" : undefined} />
                {isAdmin && ["scheduled", "postponed", "cancelled"].includes(f.status) ? (
                  <Button variant="ghost" size="icon-sm" aria-label={`Edit ${f.code}`} onClick={() => setEditing(f)}><Pencil /></Button>
                ) : null}
              </div>
            </div>
          ))}
        </Card>
        </>
      )}

      {editing ? (
        <EditFixtureDialog
          key={editing.id}
          tournamentId={t.id}
          fixture={editing}
          fixtures={fixtures}
          teams={teams}
          pitches={pitches}
          label={label}
          onClose={() => setEditing(null)}
        />
      ) : null}

      <Dialog open={generateOpen} onOpenChange={setGenerateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{fixtures.length ? "Regenerate fixtures" : "Generate fixtures"}</DialogTitle>
            <DialogDescription>
              Builds every fixture for the {teams.length} current teams using the tournament format.
              {fixtures.length ? " This replaces all existing fixtures and their official assignments." : ""}
            </DialogDescription>
          </DialogHeader>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={withSchedule}
              onCheckedChange={(v) => setWithSchedule(!!v)}
              disabled={settings.match_duration_min === null || settings.transition_min === null}
              className="mt-0.5"
            />
            <span>
              Schedule matches across pitches
              <span className="block text-xs text-muted-foreground">
                {settings.match_duration_min === null || settings.transition_min === null
                  ? "Set the match duration and transition time in Settings to enable scheduling. Without it, only the pairings are created."
                  : "Nothing is saved if the matches do not fit in the playing window."}
              </span>
            </span>
          </label>
          <DialogFooter>
            <Button
              disabled={pending}
              onClick={() =>
                run(() => generateFixtures(t.id, { withSchedule, seed: Math.floor(Math.random() * 2_000_000_000) + 1 }), {
                  success: withSchedule ? "Fixtures generated and scheduled." : "Fixtures generated. Add times once the match duration is decided.",
                  onSuccess: () => setGenerateOpen(false),
                })
              }
            >
              {pending ? "Generating…" : fixtures.length ? "Replace fixtures" : "Generate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FixtureChip({
  f,
  label,
  isAdmin,
  onEdit,
  conflict,
  warning,
  tid,
}: {
  f: Fixture;
  label: (id: string | null, src: string | null) => string;
  isAdmin: boolean;
  onEdit: (f: Fixture) => void;
  conflict: boolean;
  warning: boolean;
  tid: string;
}) {
  const editable = isAdmin && ["scheduled", "postponed", "cancelled"].includes(f.status);
  return (
    <div
      className={cn(
        "group relative rounded-lg border bg-card px-2.5 py-1.5 text-xs shadow-xs",
        conflict && "border-destructive/60 bg-destructive/5",
        !conflict && warning && "border-warning/70",
        f.stage === "knockout" && "border-l-2 border-l-primary",
        f.status === "cancelled" && "opacity-50",
      )}
    >
      <div className="mb-0.5 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="font-medium">{f.code}{f.stage === "knockout" ? ` · ${f.round_name}` : f.group_label ? ` · Group ${f.group_label}` : ""}</span>
        {f.status !== "scheduled" ? <FixtureStatusBadge status={f.status} className="h-4 px-1.5 text-[10px]" /> : null}
      </div>
      <Link href={`/tournaments/${tid}/matches/${f.id}`} className="block truncate font-medium hover:underline">
        {label(f.home_team_id, f.home_source)}
        {f.status === "confirmed" || f.status === "in_progress" || f.status === "completed" || f.status === "paused" ? (
          <span className="mx-1 tabular">{f.home_score}–{f.away_score}</span>
        ) : (
          <span className="mx-1 text-muted-foreground">v</span>
        )}
        {label(f.away_team_id, f.away_source)}
      </Link>
      {editable ? (
        <button
          type="button"
          onClick={() => onEdit(f)}
          className="no-print absolute top-1 right-1 hidden rounded p-0.5 text-muted-foreground hover:bg-muted group-hover:block focus:block"
          aria-label={`Edit ${f.code}`}
        >
          <Pencil className="size-3" />
        </button>
      ) : null}
    </div>
  );
}

function EditFixtureDialog({
  tournamentId,
  fixture: f,
  fixtures,
  teams,
  pitches,
  label,
  onClose,
}: {
  tournamentId: string;
  fixture: Fixture;
  fixtures: Fixture[];
  teams: Team[];
  pitches: Pitch[];
  label: (id: string | null, src: string | null) => string;
  onClose: () => void;
}) {
  const { pending, run } = useAction();
  const [form, setForm] = useState({
    scheduled_date: f.scheduled_date ?? "",
    scheduled_time: f.scheduled_time?.slice(0, 5) ?? "",
    pitch_id: f.pitch_id ?? "",
    home_team_id: f.home_team_id ?? "",
    away_team_id: f.away_team_id ?? "",
    match_order: f.match_order,
    status: f.status as "scheduled" | "postponed" | "cancelled",
  });
  const [swapWith, setSwapWith] = useState("");
  const isTableSlot = f.stage === "knockout";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit {f.code}</DialogTitle>
          <DialogDescription>{label(f.home_team_id, f.home_source)} v {label(f.away_team_id, f.away_source)}. Conflicts are shown after saving.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date" htmlFor="ef-date">
            <Input id="ef-date" type="date" value={form.scheduled_date} onChange={(e) => setForm({ ...form, scheduled_date: e.target.value })} />
          </Field>
          <Field label="Kick-off" htmlFor="ef-time">
            <Input id="ef-time" type="time" value={form.scheduled_time} onChange={(e) => setForm({ ...form, scheduled_time: e.target.value })} />
          </Field>
          <Field label="Pitch" htmlFor="ef-pitch">
            <NativeSelect id="ef-pitch" value={form.pitch_id} onChange={(e) => setForm({ ...form, pitch_id: e.target.value })}>
              <option value="">No pitch</option>
              {pitches.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Status" htmlFor="ef-status">
            <NativeSelect id="ef-status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as typeof form.status })}>
              <option value="scheduled">Scheduled</option>
              <option value="postponed">Postponed</option>
              <option value="cancelled">Cancelled</option>
            </NativeSelect>
          </Field>
          <Field label="Home team" htmlFor="ef-home" hint={isTableSlot && f.home_source ? `Slot: ${describeSource(f.home_source)}` : undefined}>
            <NativeSelect id="ef-home" value={form.home_team_id} onChange={(e) => setForm({ ...form, home_team_id: e.target.value })}>
              <option value="">{isTableSlot ? "To be decided" : "Choose team"}</option>
              {teams.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Away team" htmlFor="ef-away" hint={isTableSlot && f.away_source ? `Slot: ${describeSource(f.away_source)}` : undefined}>
            <NativeSelect id="ef-away" value={form.away_team_id} onChange={(e) => setForm({ ...form, away_team_id: e.target.value })}>
              <option value="">{isTableSlot ? "To be decided" : "Choose team"}</option>
              {teams.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Match order" htmlFor="ef-order">
            <Input id="ef-order" type="number" min={0} value={form.match_order} onChange={(e) => setForm({ ...form, match_order: Number(e.target.value) })} />
          </Field>
        </div>
        <div className="flex items-end gap-2 border-t pt-3">
          <Field label="Swap time and pitch with" htmlFor="ef-swap" className="flex-1">
            <NativeSelect id="ef-swap" value={swapWith} onChange={(e) => setSwapWith(e.target.value)}>
              <option value="">Choose a fixture</option>
              {fixtures
                .filter((x) => x.id !== f.id && x.status === "scheduled")
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.code}: {label(x.home_team_id, x.home_source)} v {label(x.away_team_id, x.away_source)} ({x.scheduled_time?.slice(0, 5) ?? "no time"})
                  </option>
                ))}
            </NativeSelect>
          </Field>
          <Button variant="outline" disabled={!swapWith || pending} onClick={() => run(() => swapFixtureSlots(tournamentId, f.id, swapWith), { onSuccess: onClose })}>
            Swap
          </Button>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={pending} onClick={() => run(() => updateFixture(tournamentId, f.id, form), { onSuccess: onClose })}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
