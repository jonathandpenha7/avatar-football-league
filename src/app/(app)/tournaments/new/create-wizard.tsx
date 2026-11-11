"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronLeft, ChevronRight, FileText, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { useAction } from "@/hooks/use-action";
import { createTournament } from "@/lib/actions/tournaments";
import { FORMAT_LABELS } from "@/lib/domain";
import { TIEBREAKER_LABELS, roundRobinMatchCount } from "@/lib/engine";
import type { TournamentFormat } from "@/lib/engine/types";
import {
  DEFAULT_SETTINGS,
  DisciplineSection,
  FormatSection,
  GeneralSection,
  MatchSection,
  PointsSection,
  TeamsSection,
  type GeneralDraft,
  type PitchDraft,
  type SettingsDraft,
} from "@/components/tournament/settings-sections";
import { FeasibilityPanel } from "@/components/tournament/feasibility-panel";
import type { TournamentSettings } from "@/lib/types";

interface TemplateSummary {
  key: string;
  name: string;
  description: string;
  format: TournamentFormat;
  dailyStart: string;
  dailyEnd: string;
  pitches: string[];
  teamCountOptions: number[];
  settings: Partial<TournamentSettings>;
  decisionCount: number;
  ruleCount: number;
}

const STEPS = ["Start", "Details", "Teams", "Format", "Points", "Match and schedule", "Discipline", "Review"] as const;

export function CreateWizard({ templates, initialTemplate }: { templates: TemplateSummary[]; initialTemplate: string | null }) {
  const router = useRouter();
  const { pending, run } = useAction();
  const [step, setStep] = useState(0);
  const [templateKey, setTemplateKey] = useState<string | null>(null);
  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);
  const [general, setGeneral] = useState<GeneralDraft>({
    name: "",
    description: null,
    venue: null,
    organiser: null,
    start_date: null,
    end_date: null,
    daily_start_time: "09:00",
    daily_end_time: "17:00",
    timezone,
    status: "draft",
  });
  const [format, setFormat] = useState<TournamentFormat>("league_playoff");
  const [settings, setSettings] = useState<SettingsDraft>(DEFAULT_SETTINGS);
  const [pitches, setPitches] = useState<PitchDraft[]>([{ name: "Pitch 1", available_from: null, available_until: null }]);
  const [teamNames, setTeamNames] = useState<string[] | null>(null);
  const template = templates.find((t) => t.key === templateKey) ?? null;

  const applyTemplate = (t: TemplateSummary | null) => {
    setTemplateKey(t?.key ?? null);
    if (!t) return;
    setGeneral((g) => ({ ...g, name: t.name, description: t.description, daily_start_time: t.dailyStart, daily_end_time: t.dailyEnd }));
    setFormat(t.format);
    setSettings({ ...DEFAULT_SETTINGS, ...t.settings, team_count: t.teamCountOptions[0] ?? DEFAULT_SETTINGS.team_count } as SettingsDraft);
    setPitches(t.pitches.map((name) => ({ name, available_from: null, available_until: null })));
  };

  // Apply a template passed in the URL once.
  const [appliedInitial, setAppliedInitial] = useState(false);
  if (!appliedInitial && initialTemplate) {
    setAppliedInitial(true);
    const t = templates.find((x) => x.key === initialTemplate);
    if (t) {
      applyTemplate(t);
      setStep(1);
    }
  }

  const names = teamNames ?? Array.from({ length: settings.team_count }, (_, i) => `Team ${i + 1}`);
  const resizedNames = Array.from({ length: settings.team_count }, (_, i) => names[i] ?? `Team ${i + 1}`);
  const canNext = step !== 1 || general.name.trim().length >= 2;

  const submit = () =>
    run(
      () =>
        createTournament({
          general,
          format,
          settings,
          pitches: pitches.filter((p) => p.name.trim()),
          teamNames: resizedNames.map((n) => n.trim()).filter(Boolean),
          templateKey,
        }),
      { success: "Tournament created.", onSuccess: (data) => data && router.push(`/tournaments/${data.id}`) },
    );

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[13rem_1fr] lg:gap-6">
      <div className="lg:hidden">
        <div className="mb-1.5 flex items-baseline justify-between text-sm">
          <span className="font-medium">{STEPS[step]}</span>
          <span className="text-xs text-muted-foreground tabular">Step {step + 1} of {STEPS.length}</span>
        </div>
        <Progress value={((step + 1) / STEPS.length) * 100} />
      </div>
      <nav aria-label="Steps" className="no-print hidden lg:block">
        <ol className="flex gap-1 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible">
          {STEPS.map((s, i) => (
            <li key={s}>
              <button
                type="button"
                onClick={() => (i <= step || canNext ? setStep(i) : undefined)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm whitespace-nowrap transition-colors",
                  i === step ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:bg-muted",
                )}
              >
                <span className={cn("flex size-5 items-center justify-center rounded-full border text-[11px] tabular", i < step && "border-primary bg-primary text-primary-foreground")}>
                  {i < step ? <Check className="size-3" /> : i + 1}
                </span>
                {s}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <div className="min-w-0 space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>{STEPS[step]}</CardTitle>
            {step === 0 ? <CardDescription>Start from scratch or from a saved tournament template.</CardDescription> : null}
          </CardHeader>
          <CardContent>
            {step === 0 ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => {
                    applyTemplate(null);
                    setStep(1);
                  }}
                  className={cn("rounded-xl border p-4 text-left transition-colors hover:border-primary/50 hover:bg-accent/40", !templateKey && "border-primary/60")}
                >
                  <FileText className="mb-2 size-5 text-muted-foreground" />
                  <div className="font-medium">Blank tournament</div>
                  <p className="mt-1 text-sm text-muted-foreground">Choose every setting yourself.</p>
                </button>
                {templates.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => {
                      applyTemplate(t);
                      setStep(1);
                    }}
                    className={cn("rounded-xl border p-4 text-left transition-colors hover:border-primary/50 hover:bg-accent/40", templateKey === t.key && "border-primary/60")}
                  >
                    <Sparkles className="mb-2 size-5 text-primary" />
                    <div className="font-medium">{t.name}</div>
                    <p className="mt-1 text-sm text-muted-foreground">{t.description}</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      <Badge variant="secondary">{t.ruleCount} rules from the rulebook</Badge>
                      <Badge variant="secondary">{t.decisionCount} open decisions</Badge>
                    </div>
                  </button>
                ))}
              </div>
            ) : null}
            {step === 1 ? <GeneralSection value={general} onChange={(p) => setGeneral((g) => ({ ...g, ...p }))} /> : null}
            {step === 2 ? (
              <div className="space-y-5">
                <TeamsSection settings={settings} onChange={(p) => setSettings((s) => ({ ...s, ...p }))} teamCountOptions={template?.teamCountOptions} />
                <div className="space-y-2">
                  <div className="text-[13px] font-medium">Team names</div>
                  <p className="text-xs text-muted-foreground">
                    Placeholder names are fine. Rename teams and import players once registration is confirmed.
                  </p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {resizedNames.map((n, i) => (
                      <Input
                        key={i}
                        aria-label={`Team ${i + 1} name`}
                        value={n}
                        onChange={(e) => setTeamNames(resizedNames.map((x, j) => (j === i ? e.target.value : x)))}
                      />
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
            {step === 3 ? <FormatSection format={format} onFormat={setFormat} settings={settings} onChange={(p) => setSettings((s) => ({ ...s, ...p }))} /> : null}
            {step === 4 ? <PointsSection settings={settings} onChange={(p) => setSettings((s) => ({ ...s, ...p }))} /> : null}
            {step === 5 ? <MatchSection settings={settings} onChange={(p) => setSettings((s) => ({ ...s, ...p }))} pitches={pitches} onPitches={setPitches} /> : null}
            {step === 6 ? <DisciplineSection settings={settings} onChange={(p) => setSettings((s) => ({ ...s, ...p }))} /> : null}
            {step === 7 ? (
              <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                <Summary label="Name" value={general.name || "Not set"} />
                <Summary label="Template" value={template?.name ?? "Blank"} />
                <Summary label="Date" value={general.start_date ?? "Not set"} />
                <Summary label="Playing window" value={`${general.daily_start_time ?? "?"} to ${general.daily_end_time ?? "?"}`} />
                <Summary label="Format" value={FORMAT_LABELS[format]} />
                {format === "round_robin" || format === "league_playoff" || format === "group_knockout" ? (
                  <Summary
                    label="League"
                    value={
                      settings.double_round_robin
                        ? `Double round robin: every pair plays twice (${roundRobinMatchCount(settings.team_count, true)} matches)`
                        : `Single round robin: every pair plays once (${roundRobinMatchCount(settings.team_count)} matches)`
                    }
                  />
                ) : null}
                <Summary label="Teams" value={`${settings.team_count} (max ${settings.max_squad_size} per squad, ${settings.players_on_pitch} on the pitch)`} />
                <Summary label="Points" value={`Win ${settings.points_win}, draw ${settings.points_draw}, loss ${settings.points_loss}`} />
                <Summary
                  label="Tie-breakers"
                  value={`${settings.tiebreakers.map((t) => TIEBREAKER_LABELS[t]).join(", ") || "None"}${settings.tiebreakers_confirmed ? "" : " (not confirmed)"}`}
                />
                <Summary label="League matches" value={timingText(settings.match_duration_min, settings.half_time_min, settings.periods, settings.transition_min)} />
                {format !== "round_robin" ? (
                  <Summary
                    label="Knockout matches"
                    value={
                      settings.knockout_match_duration_min
                        ? timingText(settings.knockout_match_duration_min, settings.knockout_half_time_min ?? settings.half_time_min, settings.periods, settings.transition_min)
                        : "Same as league matches"
                    }
                  />
                ) : null}
                <Summary label="Pitches" value={pitches.map((p) => p.name).join(", ")} />
                <Summary
                  label="Red card suspension"
                  value={settings.red_card_suspension_matches === null ? "Not decided" : `${settings.red_card_suspension_matches} match(es)`}
                />
              </dl>
            ) : null}
          </CardContent>
        </Card>

        {step >= 2 ? (
          <FeasibilityPanel draft={{ general, format, settings, pitches }} compact={step !== 5 && step !== 7} />
        ) : null}

        <div className="flex items-center justify-between">
          <Button variant="outline" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || pending}>
            <ChevronLeft /> Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button onClick={() => setStep((s) => s + 1)} disabled={!canNext || step === 0}>
              Next <ChevronRight />
            </Button>
          ) : (
            <Button onClick={submit} disabled={pending || general.name.trim().length < 2}>
              {pending ? "Creating…" : "Create tournament"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function timingText(total: number | null, halfTime: number, periods: 1 | 2, changeover: number | null) {
  if (total === null) return "Not decided";
  const play = periods === 2 ? `${total / 2} + ${halfTime} + ${total / 2} min` : `${total} min`;
  return changeover === null ? `${play}, changeover not decided` : `${play}, then ${changeover} min changeover`;
}
