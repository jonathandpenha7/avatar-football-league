"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Field, NativeSelect } from "@/components/app/field";
import { FORMAT_DESCRIPTIONS, FORMAT_LABELS, STATUS_LABELS } from "@/lib/domain";
import { TIEBREAKER_LABELS, roundRobinMatchCount } from "@/lib/engine";
import type { Tiebreaker, TournamentFormat } from "@/lib/engine/types";
import type { BlockedPeriodRow, TournamentSettings, TournamentStatus } from "@/lib/types";
import { TIEBREAKERS } from "@/lib/validation";

export type SettingsDraft = Omit<TournamentSettings, "tournament_id">;

export interface GeneralDraft {
  name: string;
  description: string | null;
  venue: string | null;
  organiser: string | null;
  start_date: string | null;
  end_date: string | null;
  daily_start_time: string | null;
  daily_end_time: string | null;
  timezone: string;
  status: TournamentStatus;
}

export interface PitchDraft {
  id?: string | null;
  name: string;
  available_from: string | null;
  available_until: string | null;
}

export const DEFAULT_SETTINGS: SettingsDraft = {
  team_count: 8,
  max_squad_size: 12,
  players_on_pitch: 5,
  substitutes: 3,
  min_players_to_start: null,
  positions: ["Goalkeeper", "Defender", "Midfielder", "Striker", "All-rounder", "Other"],
  double_round_robin: false,
  qualifiers: 4,
  third_place_match: false,
  group_count: 2,
  qualifiers_per_group: 2,
  allow_provisional_seeding: false,
  points_win: 3,
  points_draw: 1,
  points_loss: 0,
  tiebreakers: ["goal_difference", "goals_for", "head_to_head"],
  tiebreakers_confirmed: false,
  fair_play_yellow: 1,
  fair_play_red: 3,
  match_duration_min: null,
  periods: 1,
  half_time_min: 0,
  knockout_match_duration_min: null,
  knockout_half_time_min: null,
  transition_min: null,
  extra_time_enabled: false,
  extra_time_min: null,
  penalties_enabled: true,
  shootout_kicks: 3,
  knockout_break_min: 0,
  blocked_periods: [],
  referee_can_confirm: false,
  second_yellow_is_red: true,
  red_card_suspension_matches: null,
  yellow_accumulation_threshold: null,
  yellow_accumulation_suspension_matches: null,
  forfeit_goals: null,
  registration_requires_payment: false,
  registration_fee_note: null,
  registration_consent_text: null,
};

type Change<T> = (patch: Partial<T>) => void;

function num(v: string): number | null {
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function NumberInput({
  id,
  value,
  onChange,
  min,
  max,
  placeholder,
  disabled,
}: {
  id: string;
  value: number | null;
  onChange: (v: number | null) => void;
  min?: number;
  max?: number;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <Input
      id={id}
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      placeholder={placeholder}
      disabled={disabled}
      value={value ?? ""}
      onChange={(e) => onChange(num(e.target.value))}
      className="tabular"
    />
  );
}

function Toggle({ id, label, hint, checked, onChange }: { id: string; label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border px-3 py-2.5">
      <div className="space-y-0.5">
        <Label htmlFor={id} className="text-[13px]">{label}</Label>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

/** A number field that can be explicitly left "not decided" (null) rather than given a default. */
function UndecidedNumber({
  id,
  label,
  hint,
  value,
  onChange,
  min,
  max,
  suggestion,
}: {
  id: string;
  label: string;
  hint?: string;
  value: number | null;
  onChange: (v: number | null) => void;
  min?: number;
  max?: number;
  suggestion: number;
}) {
  const undecided = value === null;
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <div className="flex items-center gap-2">
        <NumberInput id={id} value={value} onChange={onChange} min={min} max={max} disabled={undecided} placeholder="Not decided" />
        <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" checked={undecided} onChange={(e) => onChange(e.target.checked ? null : suggestion)} />
          Not decided
        </label>
      </div>
    </Field>
  );
}

export function GeneralSection({ value, onChange }: { value: GeneralDraft; onChange: Change<GeneralDraft> }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label="Tournament name" htmlFor="g-name" className="sm:col-span-2">
        <Input id="g-name" value={value.name} onChange={(e) => onChange({ name: e.target.value })} required />
      </Field>
      <Field label="Description" htmlFor="g-desc" className="sm:col-span-2">
        <Textarea id="g-desc" rows={3} value={value.description ?? ""} onChange={(e) => onChange({ description: e.target.value })} />
      </Field>
      <Field label="Venue" htmlFor="g-venue">
        <Input id="g-venue" value={value.venue ?? ""} onChange={(e) => onChange({ venue: e.target.value })} />
      </Field>
      <Field label="Organising church or group" htmlFor="g-org">
        <Input id="g-org" value={value.organiser ?? ""} onChange={(e) => onChange({ organiser: e.target.value })} />
      </Field>
      <Field label="Tournament date" htmlFor="g-date">
        <Input id="g-date" type="date" value={value.start_date ?? ""} onChange={(e) => onChange({ start_date: e.target.value || null })} />
      </Field>
      <Field label="Last day (multi-day tournaments only)" htmlFor="g-end">
        <Input id="g-end" type="date" value={value.end_date ?? ""} onChange={(e) => onChange({ end_date: e.target.value || null })} />
      </Field>
      <Field label="Start time" htmlFor="g-start">
        <Input id="g-start" type="time" value={value.daily_start_time?.slice(0, 5) ?? ""} onChange={(e) => onChange({ daily_start_time: e.target.value || null })} />
      </Field>
      <Field label="End time" htmlFor="g-endt">
        <Input id="g-endt" type="time" value={value.daily_end_time?.slice(0, 5) ?? ""} onChange={(e) => onChange({ daily_end_time: e.target.value || null })} />
      </Field>
      <Field label="Time zone" htmlFor="g-tz" hint="Used to decide which matches are 'today'.">
        <Input id="g-tz" value={value.timezone} onChange={(e) => onChange({ timezone: e.target.value })} />
      </Field>
      <Field label="Status" htmlFor="g-status">
        <NativeSelect id="g-status" value={value.status} onChange={(e) => onChange({ status: e.target.value as TournamentStatus })}>
          {Object.entries(STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </NativeSelect>
      </Field>
    </div>
  );
}

export function TeamsSection({
  settings,
  onChange,
  teamCountOptions,
}: {
  settings: SettingsDraft;
  onChange: Change<SettingsDraft>;
  teamCountOptions?: number[];
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field
        label="Number of teams"
        htmlFor="t-count"
        hint={`${roundRobinMatchCount(settings.team_count, settings.double_round_robin)} league matches in a ${settings.double_round_robin ? "double" : "single"} round robin.`}
      >
        {teamCountOptions ? (
          <NativeSelect id="t-count" value={settings.team_count} onChange={(e) => onChange({ team_count: Number(e.target.value) })}>
            {teamCountOptions.map((n) => (
              <option key={n} value={n}>{n} teams</option>
            ))}
          </NativeSelect>
        ) : (
          <NumberInput id="t-count" min={2} max={64} value={settings.team_count} onChange={(v) => onChange({ team_count: v ?? 2 })} />
        )}
      </Field>
      <Field label="Maximum players per squad" htmlFor="t-squad">
        <NumberInput id="t-squad" min={1} max={60} value={settings.max_squad_size} onChange={(v) => onChange({ max_squad_size: v ?? 1 })} />
      </Field>
      <Field label="Players on the pitch" htmlFor="t-pitch">
        <NumberInput id="t-pitch" min={1} max={11} value={settings.players_on_pitch} onChange={(v) => onChange({ players_on_pitch: v ?? 1 })} />
      </Field>
      <Field label="Substitutes" htmlFor="t-subs">
        <NumberInput id="t-subs" min={0} max={30} value={settings.substitutes} onChange={(v) => onChange({ substitutes: v ?? 0 })} />
      </Field>
      <UndecidedNumber
        id="t-min"
        label="Minimum players to start a match"
        value={settings.min_players_to_start}
        onChange={(v) => onChange({ min_players_to_start: v })}
        min={1}
        max={11}
        suggestion={Math.max(1, settings.players_on_pitch - 1)}
      />
      <Field label="Playing positions" htmlFor="t-pos" hint="Comma separated." className="sm:col-span-2">
        <Input
          id="t-pos"
          value={settings.positions.join(", ")}
          onChange={(e) => onChange({ positions: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
        />
      </Field>
    </div>
  );
}

export function FormatSection({
  format,
  onFormat,
  settings,
  onChange,
  locked,
}: {
  format: TournamentFormat;
  onFormat: (f: TournamentFormat) => void;
  settings: SettingsDraft;
  onChange: Change<SettingsDraft>;
  locked?: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label="Format" htmlFor="f-format" className="sm:col-span-2" hint={locked ? "Matches have started, so the format can no longer change." : FORMAT_DESCRIPTIONS[format]}>
        <NativeSelect id="f-format" value={format} disabled={locked} onChange={(e) => onFormat(e.target.value as TournamentFormat)}>
          {Object.entries(FORMAT_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </NativeSelect>
      </Field>
      {format === "round_robin" || format === "league_playoff" || format === "group_knockout" ? (
        <Toggle id="f-double" label="Double round robin" hint="Every pair meets twice, home and away." checked={settings.double_round_robin} onChange={(v) => onChange({ double_round_robin: v })} />
      ) : null}
      {format === "league_playoff" ? (
        <Field label="Teams qualifying for the play-offs" htmlFor="f-q" hint="4 gives semi-finals: 1st v 4th and 2nd v 3rd.">
          <NumberInput id="f-q" min={2} max={64} value={settings.qualifiers} onChange={(v) => onChange({ qualifiers: v })} />
        </Field>
      ) : null}
      {format === "group_knockout" ? (
        <>
          <Field label="Number of groups" htmlFor="f-g">
            <NumberInput id="f-g" min={2} max={16} value={settings.group_count} onChange={(v) => onChange({ group_count: v })} />
          </Field>
          <Field label="Teams qualifying from each group" htmlFor="f-qg">
            <NumberInput id="f-qg" min={1} max={8} value={settings.qualifiers_per_group} onChange={(v) => onChange({ qualifiers_per_group: v })} />
          </Field>
        </>
      ) : null}
      {format !== "round_robin" ? (
        <Toggle id="f-3rd" label="Third-place play-off" checked={settings.third_place_match} onChange={(v) => onChange({ third_place_match: v })} />
      ) : null}
      {format === "league_playoff" || format === "group_knockout" ? (
        <Toggle
          id="f-prov"
          label="Allow provisional seeding"
          hint="Lets an admin fill knockout slots before every league match is confirmed. Off by default."
          checked={settings.allow_provisional_seeding}
          onChange={(v) => onChange({ allow_provisional_seeding: v })}
        />
      ) : null}
    </div>
  );
}

export function PointsSection({ settings, onChange }: { settings: SettingsDraft; onChange: Change<SettingsDraft> }) {
  const unused = TIEBREAKERS.filter((t) => !settings.tiebreakers.includes(t));
  const move = (i: number, d: -1 | 1) => {
    const list = [...settings.tiebreakers];
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    onChange({ tiebreakers: list });
  };
  return (
    <div className="grid gap-5">
      <div className="grid grid-cols-3 gap-3">
        <Field label="Win" htmlFor="p-w"><NumberInput id="p-w" min={0} max={10} value={settings.points_win} onChange={(v) => onChange({ points_win: v ?? 0 })} /></Field>
        <Field label="Draw" htmlFor="p-d"><NumberInput id="p-d" min={0} max={10} value={settings.points_draw} onChange={(v) => onChange({ points_draw: v ?? 0 })} /></Field>
        <Field label="Loss" htmlFor="p-l"><NumberInput id="p-l" min={-5} max={10} value={settings.points_loss} onChange={(v) => onChange({ points_loss: v ?? 0 })} /></Field>
      </div>
      <div className="space-y-2">
        <Label className="text-[13px]">Tie-breaker order (after points)</Label>
        <ol className="divide-y rounded-lg border">
          {settings.tiebreakers.length === 0 ? <li className="px-3 py-2 text-sm text-muted-foreground">No tie-breakers: teams level on points share a position.</li> : null}
          {settings.tiebreakers.map((t, i) => (
            <li key={t} className="flex items-center gap-2 px-3 py-1.5 text-sm">
              <span className="w-5 text-xs text-muted-foreground tabular">{i + 1}.</span>
              <span className="flex-1">{TIEBREAKER_LABELS[t]}</span>
              <Button type="button" variant="ghost" size="icon-xs" aria-label="Move up" onClick={() => move(i, -1)} disabled={i === 0}><ArrowUp /></Button>
              <Button type="button" variant="ghost" size="icon-xs" aria-label="Move down" onClick={() => move(i, 1)} disabled={i === settings.tiebreakers.length - 1}><ArrowDown /></Button>
              <Button type="button" variant="ghost" size="icon-xs" aria-label="Remove" onClick={() => onChange({ tiebreakers: settings.tiebreakers.filter((x) => x !== t) })}><Trash2 /></Button>
            </li>
          ))}
        </ol>
        {unused.length ? (
          <div className="flex flex-wrap gap-1.5">
            {unused.map((t) => (
              <Button key={t} type="button" variant="outline" size="xs" onClick={() => onChange({ tiebreakers: [...settings.tiebreakers, t as Tiebreaker] })}>
                <Plus /> {TIEBREAKER_LABELS[t as Tiebreaker]}
              </Button>
            ))}
          </div>
        ) : null}
      </div>
      <Toggle
        id="p-confirm"
        label="Tie-breaker order is confirmed"
        hint="Until confirmed, the standings never apply these rules: teams level on points share a position and knockout seeding waits."
        checked={settings.tiebreakers_confirmed}
        onChange={(v) => onChange({ tiebreakers_confirmed: v })}
      />
      {settings.tiebreakers.includes("fair_play") ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Fair-play points per yellow" htmlFor="fp-y"><NumberInput id="fp-y" min={0} max={20} value={settings.fair_play_yellow} onChange={(v) => onChange({ fair_play_yellow: v ?? 0 })} /></Field>
          <Field label="Fair-play points per red" htmlFor="fp-r"><NumberInput id="fp-r" min={0} max={20} value={settings.fair_play_red} onChange={(v) => onChange({ fair_play_red: v ?? 0 })} /></Field>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Match timing written the way organisers say it: "7 + 2 + 7, then a 5-minute changeover".
 * Stored as total playing minutes (match_duration_min) plus half-time and changeover.
 */
function TimingEditor({ settings, onChange }: { settings: SettingsDraft; onChange: Change<SettingsDraft> }) {
  const two = settings.periods === 2;
  const toHalf = (total: number | null) => (total === null ? null : two ? total / 2 : total);
  const fromHalf = (half: number | null) => (half === null ? null : two ? half * 2 : half);
  const leagueHalf = toHalf(settings.match_duration_min);
  const koSame = settings.knockout_match_duration_min === null;
  const koHalf = koSame ? leagueHalf : toHalf(settings.knockout_match_duration_min);
  const koHalfTime = settings.knockout_half_time_min ?? settings.half_time_min;
  const change = settings.transition_min;
  const undecided = settings.match_duration_min === null;

  const formula = (half: number | null, ht: number) => {
    if (half === null) return "not decided";
    const play = two ? `${half} + ${ht} + ${half}` : `${half}`;
    const total = (two ? half * 2 + ht : half) + (change ?? 0);
    return `${play} min${change !== null ? `, then ${change} min changeover = ${total} min per match` : ""}`;
  };

  const halfLabel = two ? "Each half (minutes)" : "Match length (minutes)";

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Match format" htmlFor="m-periods">
          <NativeSelect
            id="m-periods"
            value={settings.periods}
            onChange={(e) => {
              const p = Number(e.target.value) as 1 | 2;
              // Keep the per-half length the organiser typed when switching.
              const conv = (total: number | null) => (total === null ? null : p === 2 && !two ? total * 2 : p === 1 && two ? total / 2 : total);
              onChange({ periods: p, match_duration_min: conv(settings.match_duration_min), knockout_match_duration_min: conv(settings.knockout_match_duration_min) });
            }}
          >
            <option value={2}>Two halves with a half-time break</option>
            <option value={1}>One period, no half-time</option>
          </NativeSelect>
        </Field>
        <UndecidedNumber
          id="m-trans"
          label="Changeover between matches (minutes)"
          hint="Time between the final whistle and the next kick-off on the same pitch."
          value={settings.transition_min}
          onChange={(v) => onChange({ transition_min: v })}
          min={0}
          max={120}
          suggestion={5}
        />
      </div>

      <div className="rounded-lg border p-3">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <div className="text-[13px] font-medium">League and group matches</div>
          <div className="text-xs text-muted-foreground tabular">{formula(leagueHalf, settings.half_time_min)}</div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={halfLabel} htmlFor="m-half">
            <div className="flex items-center gap-2">
              <NumberInput id="m-half" min={1} max={120} value={leagueHalf} disabled={undecided} placeholder="Not decided" onChange={(v) => onChange({ match_duration_min: fromHalf(v) })} />
              <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                <input type="checkbox" checked={undecided} onChange={(e) => onChange({ match_duration_min: e.target.checked ? null : fromHalf(7) })} />
                Not decided
              </label>
            </div>
          </Field>
          {two ? (
            <Field label="Half-time (minutes)" htmlFor="m-ht">
              <NumberInput id="m-ht" min={0} max={60} value={settings.half_time_min} onChange={(v) => onChange({ half_time_min: v ?? 0 })} />
            </Field>
          ) : null}
        </div>
      </div>

      <div className="rounded-lg border p-3">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <div className="text-[13px] font-medium">Knockout matches (semi-finals, third place, final)</div>
          <div className="text-xs text-muted-foreground tabular">{formula(koHalf, koSame ? settings.half_time_min : koHalfTime)}</div>
        </div>
        <label className="mb-3 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={koSame}
            onChange={(e) =>
              onChange(
                e.target.checked
                  ? { knockout_match_duration_min: null, knockout_half_time_min: null }
                  : { knockout_match_duration_min: fromHalf(10), knockout_half_time_min: settings.half_time_min },
              )
            }
          />
          Same timing as league matches
        </label>
        {!koSame ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={halfLabel} htmlFor="m-kohalf">
              <NumberInput id="m-kohalf" min={1} max={120} value={koHalf} onChange={(v) => onChange({ knockout_match_duration_min: fromHalf(v ?? 1) })} />
            </Field>
            {two ? (
              <Field label="Half-time (minutes)" htmlFor="m-koht">
                <NumberInput id="m-koht" min={0} max={60} value={koHalfTime} onChange={(v) => onChange({ knockout_half_time_min: v ?? 0 })} />
              </Field>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function MatchSection({
  settings,
  onChange,
  pitches,
  onPitches,
}: {
  settings: SettingsDraft;
  onChange: Change<SettingsDraft>;
  pitches: PitchDraft[];
  onPitches: (p: PitchDraft[]) => void;
}) {
  const blocked = settings.blocked_periods;
  const setBlocked = (list: BlockedPeriodRow[]) => onChange({ blocked_periods: list });
  return (
    <div className="grid gap-5">
      <TimingEditor settings={settings} onChange={onChange} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Extra break before the knockouts (minutes)" htmlFor="m-kb" hint="On top of the normal changeover. Usually 0.">
          <NumberInput id="m-kb" min={0} max={240} value={settings.knockout_break_min} onChange={(v) => onChange({ knockout_break_min: v ?? 0 })} />
        </Field>
        <Field label="Penalty shootout kicks per team" htmlFor="m-pk" hint="Then sudden death.">
          <NumberInput id="m-pk" min={1} max={10} value={settings.shootout_kicks} onChange={(v) => onChange({ shootout_kicks: v ?? 1 })} />
        </Field>
        <Toggle id="m-et" label="Extra time in knockout matches" checked={settings.extra_time_enabled} onChange={(v) => onChange({ extra_time_enabled: v, extra_time_min: v ? settings.extra_time_min ?? 5 : null })} />
        {settings.extra_time_enabled ? (
          <Field label="Extra time (minutes)" htmlFor="m-etm">
            <NumberInput id="m-etm" min={1} max={60} value={settings.extra_time_min} onChange={(v) => onChange({ extra_time_min: v })} />
          </Field>
        ) : null}
        <Toggle id="m-pen" label="Penalty shootouts decide drawn knockout matches" checked={settings.penalties_enabled} onChange={(v) => onChange({ penalties_enabled: v })} />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-[13px]">Pitches ({pitches.length})</Label>
          <Button type="button" variant="outline" size="xs" onClick={() => onPitches([...pitches, { name: `Pitch ${pitches.length + 1}`, available_from: null, available_until: null }])}>
            <Plus /> Add pitch
          </Button>
        </div>
        <div className="divide-y rounded-lg border">
          {pitches.map((p, i) => (
            <div key={i} className="grid grid-cols-[1fr_auto] items-end gap-2 p-2 sm:grid-cols-[1fr_7rem_7rem_auto]">
              <Input aria-label="Pitch name" value={p.name} onChange={(e) => onPitches(pitches.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <Input aria-label="Available from" type="time" title="Available from (optional)" value={p.available_from?.slice(0, 5) ?? ""} onChange={(e) => onPitches(pitches.map((x, j) => (j === i ? { ...x, available_from: e.target.value || null } : x)))} className="hidden sm:block" />
              <Input aria-label="Available until" type="time" title="Available until (optional)" value={p.available_until?.slice(0, 5) ?? ""} onChange={(e) => onPitches(pitches.map((x, j) => (j === i ? { ...x, available_until: e.target.value || null } : x)))} className="hidden sm:block" />
              <Button type="button" variant="ghost" size="icon" aria-label="Remove pitch" disabled={pitches.length <= 1} onClick={() => onPitches(pitches.filter((_, j) => j !== i))}>
                <Trash2 />
              </Button>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Optional availability times restrict when a pitch can be used. Matches on different pitches run simultaneously.</p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-[13px]">Blocked time periods</Label>
          <Button type="button" variant="outline" size="xs" onClick={() => setBlocked([...blocked, { start: "12:00", end: "12:30", label: "Break" }])}>
            <Plus /> Add block
          </Button>
        </div>
        {blocked.length === 0 ? <p className="text-xs text-muted-foreground">No blocked periods. Add one for announcements, meals or prayer time.</p> : null}
        <div className="divide-y rounded-lg border empty:hidden">
          {blocked.map((b, i) => (
            <div key={i} className="grid grid-cols-2 gap-2 p-2 sm:grid-cols-[1fr_6.5rem_6.5rem_9rem_auto]">
              <Input aria-label="Label" placeholder="Label" value={b.label ?? ""} onChange={(e) => setBlocked(blocked.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} className="col-span-2 sm:col-span-1" />
              <Input aria-label="Start" type="time" value={b.start.slice(0, 5)} onChange={(e) => setBlocked(blocked.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} />
              <Input aria-label="End" type="time" value={b.end.slice(0, 5)} onChange={(e) => setBlocked(blocked.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} />
              <NativeSelect aria-label="Pitch" value={b.pitch_id ?? ""} onChange={(e) => setBlocked(blocked.map((x, j) => (j === i ? { ...x, pitch_id: e.target.value || null } : x)))}>
                <option value="">All pitches</option>
                {pitches.filter((p) => p.id).map((p) => (
                  <option key={p.id!} value={p.id!}>{p.name}</option>
                ))}
              </NativeSelect>
              <Button type="button" variant="ghost" size="icon" aria-label="Remove block" onClick={() => setBlocked(blocked.filter((_, j) => j !== i))}>
                <Trash2 />
              </Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function DisciplineSection({ settings, onChange }: { settings: SettingsDraft; onChange: Change<SettingsDraft> }) {
  return (
    <div className="grid gap-4">
      <Alert>
        <AlertDescription>
          Suspensions are only created automatically when you configure a rule here. Leave a rule as &quot;Not decided&quot; and no suspension will be applied. You can always add suspensions manually.
        </AlertDescription>
      </Alert>
      <Toggle id="d-2y" label="Two yellow cards in a match count as a red card" checked={settings.second_yellow_is_red} onChange={(v) => onChange({ second_yellow_is_red: v })} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <UndecidedNumber id="d-red" label="Matches suspended after a red card" hint="0 = no ban beyond the match." value={settings.red_card_suspension_matches} onChange={(v) => onChange({ red_card_suspension_matches: v })} min={0} max={20} suggestion={1} />
        <UndecidedNumber id="d-yt" label="Yellow cards before an accumulation ban" value={settings.yellow_accumulation_threshold} onChange={(v) => onChange({ yellow_accumulation_threshold: v, yellow_accumulation_suspension_matches: v ? settings.yellow_accumulation_suspension_matches ?? 1 : null })} min={2} max={20} suggestion={3} />
        {settings.yellow_accumulation_threshold ? (
          <Field label="Matches suspended for accumulated yellows" htmlFor="d-ym">
            <NumberInput id="d-ym" min={1} max={20} value={settings.yellow_accumulation_suspension_matches} onChange={(v) => onChange({ yellow_accumulation_suspension_matches: v })} />
          </Field>
        ) : null}
        <UndecidedNumber id="d-forfeit" label="Goals awarded for a forfeit" hint="The winner is awarded this score, e.g. 3–0." value={settings.forfeit_goals} onChange={(v) => onChange({ forfeit_goals: v })} min={0} max={20} suggestion={3} />
      </div>
      <Toggle
        id="d-refconf"
        label="Assigned referees can confirm results"
        hint="Otherwise only tournament admins confirm. Corrections always need an admin."
        checked={settings.referee_can_confirm}
        onChange={(v) => onChange({ referee_can_confirm: v })}
      />
    </div>
  );
}

export function RegistrationSection({ settings, onChange }: { settings: SettingsDraft; onChange: Change<SettingsDraft> }) {
  return (
    <div className="grid gap-4">
      <Field label="Consent statement" htmlFor="r-consent" hint="If set, registrants must tick this before submitting.">
        <Textarea id="r-consent" rows={3} value={settings.registration_consent_text ?? ""} onChange={(e) => onChange({ registration_consent_text: e.target.value || null })} placeholder="I agree to take part at my own risk and consent to photos being taken…" />
      </Field>
      <Toggle id="r-pay" label="Registration involves a fee" hint="Payment is tracked separately and only marked as paid by an organiser." checked={settings.registration_requires_payment} onChange={(v) => onChange({ registration_requires_payment: v })} />
      {settings.registration_requires_payment ? (
        <Field label="Payment instructions shown on the form" htmlFor="r-fee">
          <Textarea id="r-fee" rows={2} value={settings.registration_fee_note ?? ""} onChange={(e) => onChange({ registration_fee_note: e.target.value || null })} />
        </Field>
      ) : null}
    </div>
  );
}
