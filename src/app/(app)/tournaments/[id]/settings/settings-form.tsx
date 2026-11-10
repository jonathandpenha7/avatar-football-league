"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, Copy, ExternalLink, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/app/field";
import { ConfirmAction } from "@/components/app/confirm-action";
import { ImageUpload } from "@/components/app/image-upload";
import { FeasibilityPanel } from "@/components/tournament/feasibility-panel";
import {
  DisciplineSection,
  FormatSection,
  GeneralSection,
  MatchSection,
  PointsSection,
  RegistrationSection,
  TeamsSection,
  type GeneralDraft,
  type PitchDraft,
  type SettingsDraft,
} from "@/components/tournament/settings-sections";
import { useAction } from "@/hooks/use-action";
import {
  cloneTournament,
  deleteTournament,
  regenerateRegistrationLink,
  savePitches,
  setLogoUrl,
  setPublishing,
  updateFormat,
  updateGeneral,
  updateSettings,
} from "@/lib/actions/tournaments";
import type { PlanTeam } from "@/lib/engine";
import type { TournamentFormat } from "@/lib/engine/types";
import type { Tournament } from "@/lib/types";

const TABS = [
  ["general", "General"],
  ["teams", "Teams"],
  ["format", "Format"],
  ["points", "Points and ties"],
  ["match", "Match and schedule"],
  ["discipline", "Discipline"],
  ["registration", "Registration"],
  ["publishing", "Public page"],
  ["danger", "Archive and delete"],
] as const;

export function SettingsForm({
  tournament: t,
  settings: initialSettings,
  pitches: initialPitches,
  teams,
  formatLocked,
  hasFixtures,
  isSuperAdmin,
  canCreate,
  siteUrl,
  initialTab,
}: {
  tournament: Tournament;
  settings: SettingsDraft;
  pitches: PitchDraft[];
  teams: PlanTeam[];
  formatLocked: boolean;
  hasFixtures: boolean;
  isSuperAdmin: boolean;
  canCreate: boolean;
  siteUrl: string;
  initialTab: string;
}) {
  const router = useRouter();
  const { pending, run } = useAction();
  const [general, setGeneral] = useState<GeneralDraft>({
    name: t.name,
    description: t.description,
    venue: t.venue,
    organiser: t.organiser,
    start_date: t.start_date,
    end_date: t.end_date,
    daily_start_time: t.daily_start_time?.slice(0, 5) ?? null,
    daily_end_time: t.daily_end_time?.slice(0, 5) ?? null,
    timezone: t.timezone,
    status: t.status,
  });
  const [format, setFormat] = useState<TournamentFormat>(t.format);
  const [settings, setSettings] = useState<SettingsDraft>(initialSettings);
  const [pitches, setPitches] = useState<PitchDraft[]>(initialPitches);
  const patch = (p: Partial<SettingsDraft>) => setSettings((s) => ({ ...s, ...p }));
  const saveSettings = () => run(() => updateSettings(t.id, settings));
  const regenerateHint = hasFixtures ? " Regenerate fixtures to apply format or timing changes." : "";

  const [clone, setClone] = useState({ name: `${t.name} ${new Date().getFullYear() + 1}`, startDate: "", copyTeams: false, archiveSource: true });
  const publicUrl = `${siteUrl}/t/${t.slug}`;
  const registrationUrl = `${siteUrl}/register/${t.registration_token}`;

  return (
    <Tabs defaultValue={initialTab} className="gap-4">
      <TabsList className="no-scrollbar h-auto w-full justify-start overflow-x-auto md:flex-wrap">
        {TABS.map(([k, label]) => (
          <TabsTrigger key={k} value={k} className="flex-none">{label}</TabsTrigger>
        ))}
      </TabsList>

      <TabsContent value="general">
        <Card>
          <CardHeader>
            <CardTitle>General information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <Field label="Tournament logo">
              <ImageUpload tournamentId={t.id} prefix="logo" currentUrl={t.logo_url} onSaved={(url) => setLogoUrl(t.id, url)} />
            </Field>
            <GeneralSection value={general} onChange={(p) => setGeneral((g) => ({ ...g, ...p }))} />
          </CardContent>
          <SaveBar pending={pending} onSave={() => run(() => updateGeneral(t.id, general))} note={regenerateHint.trim()} />
        </Card>
      </TabsContent>

      <TabsContent value="teams">
        <Card>
          <CardHeader>
            <CardTitle>Team configuration</CardTitle>
            <CardDescription>Squad limits are enforced when players are added or approved.</CardDescription>
          </CardHeader>
          <CardContent>
            <TeamsSection settings={settings} onChange={patch} />
          </CardContent>
          <SaveBar pending={pending} onSave={saveSettings} />
        </Card>
      </TabsContent>

      <TabsContent value="format" className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Tournament format</CardTitle>
          </CardHeader>
          <CardContent>
            <FormatSection format={format} onFormat={setFormat} settings={settings} onChange={patch} locked={formatLocked} />
          </CardContent>
          <SaveBar
            pending={pending}
            onSave={() =>
              run(async () => {
                if (format !== t.format) {
                  const r = await updateFormat(t.id, format);
                  if (!r.ok) return r;
                }
                return updateSettings(t.id, settings);
              })
            }
            note={regenerateHint.trim()}
          />
        </Card>
        <FeasibilityPanel draft={{ general, format, settings, pitches, teams }} />
      </TabsContent>

      <TabsContent value="points">
        <Card>
          <CardHeader>
            <CardTitle>Points and tie-breakers</CardTitle>
            <CardDescription>Standings recalculate from confirmed results every time they are viewed, so changes apply immediately.</CardDescription>
          </CardHeader>
          <CardContent>
            <PointsSection settings={settings} onChange={patch} />
          </CardContent>
          <SaveBar pending={pending} onSave={saveSettings} />
        </Card>
      </TabsContent>

      <TabsContent value="match" className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Match timing, pitches and schedule</CardTitle>
          </CardHeader>
          <CardContent>
            <MatchSection settings={settings} onChange={patch} pitches={pitches} onPitches={setPitches} />
          </CardContent>
          <SaveBar
            pending={pending}
            onSave={() =>
              run(async () => {
                const p = await savePitches(t.id, pitches);
                if (!p.ok) return p;
                const r = await updateSettings(t.id, settings);
                if (r.ok) router.refresh();
                return r;
              })
            }
            note={regenerateHint.trim()}
          />
        </Card>
        <FeasibilityPanel draft={{ general, format, settings, pitches, teams }} />
      </TabsContent>

      <TabsContent value="discipline">
        <Card>
          <CardHeader>
            <CardTitle>Discipline and forfeits</CardTitle>
          </CardHeader>
          <CardContent>
            <DisciplineSection settings={settings} onChange={patch} />
          </CardContent>
          <SaveBar pending={pending} onSave={saveSettings} note="New rules apply to cards recorded from now on." />
        </Card>
      </TabsContent>

      <TabsContent value="registration" className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Online registration</CardTitle>
            <CardDescription>Players register through a private link. Every submission needs organiser approval.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-center justify-between gap-4 rounded-lg border px-3 py-2.5">
              <div>
                <Label htmlFor="reg-open" className="text-[13px]">Registration open</Label>
                <p className="text-xs text-muted-foreground">When closed, the link shows a closed message.</p>
              </div>
              <Switch id="reg-open" checked={t.registration_open} disabled={pending} onCheckedChange={(v) => run(() => setPublishing(t.id, { registration_open: v }), { success: v ? "Registration opened." : "Registration closed." })} />
            </div>
            <Field label="Registration link">
              <div className="flex gap-2">
                <Input readOnly value={registrationUrl} onFocus={(e) => e.target.select()} />
                <Button variant="outline" size="icon" aria-label="Copy link" onClick={() => navigator.clipboard.writeText(registrationUrl).then(() => toast.success("Link copied."))}>
                  <Copy />
                </Button>
                <ConfirmAction
                  trigger={<Button variant="outline" size="icon" aria-label="Create a new link"><RefreshCw /></Button>}
                  title="Create a new registration link?"
                  description="The current link will stop working immediately."
                  confirmLabel="Create new link"
                  action={() => regenerateRegistrationLink(t.id)}
                />
              </div>
            </Field>
            <RegistrationSection settings={settings} onChange={patch} />
          </CardContent>
          <SaveBar pending={pending} onSave={saveSettings} />
        </Card>
      </TabsContent>

      <TabsContent value="publishing">
        <Card>
          <CardHeader>
            <CardTitle>Public tournament page</CardTitle>
            <CardDescription>A read-only page with fixtures, live scores, standings, the bracket, top scorers and rules. Player contact details are never shown.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {(
              [
                ["public_enabled", "Public page enabled", "Anyone with the link can view it.", t.public_enabled],
                ["fixtures_published", "Fixtures and results published", "Shows the schedule, live scores and results.", t.fixtures_published],
                ["rules_published", "Rules published", "Shows the tournament rules to participants.", t.rules_published],
              ] as const
            ).map(([key, label, hint, value]) => (
              <div key={key} className="flex items-center justify-between gap-4 rounded-lg border px-3 py-2.5">
                <div>
                  <Label htmlFor={key} className="text-[13px]">{label}</Label>
                  <p className="text-xs text-muted-foreground">{hint}</p>
                </div>
                <Switch id={key} checked={value} disabled={pending} onCheckedChange={(v) => run(() => setPublishing(t.id, { [key]: v }), { success: "Saved." })} />
              </div>
            ))}
            <Field label="Public link">
              <div className="flex gap-2">
                <Input readOnly value={publicUrl} onFocus={(e) => e.target.select()} />
                <Button variant="outline" size="icon" aria-label="Copy link" onClick={() => navigator.clipboard.writeText(publicUrl).then(() => toast.success("Link copied."))}>
                  <Copy />
                </Button>
                <Button variant="outline" size="icon" asChild aria-label="Open public page">
                  <a href={`/t/${t.slug}`} target="_blank" rel="noreferrer"><ExternalLink /></a>
                </Button>
              </div>
            </Field>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="danger" className="space-y-4">
        {canCreate ? (
          <Card>
            <CardHeader>
              <CardTitle>Start the next tournament</CardTitle>
              <CardDescription>Copies settings, pitches, rules and decisions into a new draft tournament. Fixtures and results are not copied.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="New tournament name" htmlFor="c-name">
                <Input id="c-name" value={clone.name} onChange={(e) => setClone({ ...clone, name: e.target.value })} />
              </Field>
              <Field label="Date" htmlFor="c-date">
                <Input id="c-date" type="date" value={clone.startDate} onChange={(e) => setClone({ ...clone, startDate: e.target.value })} />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={clone.copyTeams} onCheckedChange={(v) => setClone({ ...clone, copyTeams: !!v })} /> Copy team names (not players)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={clone.archiveSource} onCheckedChange={(v) => setClone({ ...clone, archiveSource: !!v })} /> Archive this tournament
              </label>
            </CardContent>
            <CardFooter className="justify-end border-t">
              <Button
                disabled={pending}
                onClick={() => run(() => cloneTournament(t.id, clone), { success: "New tournament created.", onSuccess: (d) => d && router.push(`/tournaments/${d.id}`) })}
              >
                <Copy /> Create next tournament
              </Button>
            </CardFooter>
          </Card>
        ) : null}
        <Card>
          <CardHeader>
            <CardTitle>Archive</CardTitle>
            <CardDescription>Archived tournaments stay readable under Previous tournaments.</CardDescription>
          </CardHeader>
          <CardFooter className="justify-end border-t">
            <ConfirmAction
              trigger={<Button variant="outline" disabled={t.status === "archived"}><Archive /> Archive tournament</Button>}
              title="Archive this tournament?"
              description="It moves to Previous tournaments. You can change the status back at any time."
              confirmLabel="Archive"
              action={() => updateGeneral(t.id, { ...general, status: "archived" })}
              onDone={() => router.refresh()}
            />
          </CardFooter>
        </Card>
        {isSuperAdmin ? (
          <Card className="ring-destructive/30">
            <CardHeader>
              <CardTitle className="text-destructive">Delete tournament</CardTitle>
              <CardDescription>Permanently deletes the tournament with all teams, players, fixtures and results. The audit log is kept. Export a backup first.</CardDescription>
            </CardHeader>
            <CardFooter className="justify-end border-t">
              <ConfirmAction
                destructive
                trigger={<Button variant="destructive"><Trash2 /> Delete permanently</Button>}
                title="Delete this tournament permanently?"
                description="This cannot be undone."
                typeToConfirm={t.name}
                confirmLabel="Delete"
                action={() => deleteTournament(t.id, t.name)}
              />
            </CardFooter>
          </Card>
        ) : null}
      </TabsContent>
    </Tabs>
  );
}

function SaveBar({ onSave, note, pending }: { onSave: () => void; note?: string; pending: boolean }) {
  return (
    <CardFooter className="justify-between gap-3 border-t">
      <p className="text-xs text-muted-foreground">{note}</p>
      <Button onClick={onSave} disabled={pending}>{pending ? "Saving…" : "Save changes"}</Button>
    </CardFooter>
  );
}
