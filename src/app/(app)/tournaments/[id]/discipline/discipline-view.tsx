"use client";

import { useState } from "react";
import { Ban, Download, Plus, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { EmptyState } from "@/components/app/empty-state";
import { Field, NativeSelect } from "@/components/app/field";
import { TeamName, type TeamLike } from "@/components/app/team-name";
import { ConfirmAction } from "@/components/app/confirm-action";
import { useAction } from "@/hooks/use-action";
import { addDisciplinaryRecord, addSuspension, setSuspensionStatus } from "@/lib/actions/discipline";
import { downloadCsv, slugify } from "@/lib/csv";
import type { SuspensionProgress } from "@/lib/engine";
import type { DisciplinaryRecord, Suspension } from "@/lib/types";

const INCIDENT_LABELS: Record<DisciplinaryRecord["incident_type"], string> = {
  yellow_card: "Yellow card",
  second_yellow: "Second yellow (sent off)",
  red_card: "Red card",
  sin_bin: "Time penalty",
  misconduct: "Misconduct",
  other: "Other",
};

export function DisciplineView({
  tournamentId,
  tournamentName,
  isAdmin,
  records,
  suspensions,
  progress,
  players,
  teams,
  fixtures,
  referees,
  rules,
  atRisk,
}: {
  tournamentId: string;
  tournamentName: string;
  isAdmin: boolean;
  records: DisciplinaryRecord[];
  suspensions: Suspension[];
  progress: Record<string, SuspensionProgress>;
  players: { id: string; name: string; teamId: string | null }[];
  teams: (TeamLike & { id: string })[];
  fixtures: { id: string; code: string; status: string }[];
  referees: Record<string, string>;
  rules: string[];
  atRisk: { playerId: string; yellows: number }[];
}) {
  const { pending, run } = useAction();
  const [dialog, setDialog] = useState<"suspension" | "incident" | null>(null);
  const [form, setForm] = useState({ player_id: "", starts_after_fixture_id: "", matches: 1, reason: "", incident_type: "misconduct" as "misconduct" | "other" });
  const playerName = new Map(players.map((p) => [p.id, p.name]));
  const teamMap = new Map(teams.map((t) => [t.id, t]));
  const fixtureCode = new Map(fixtures.map((f) => [f.id, f.code]));

  const exportCsv = () =>
    downloadCsv(`${slugify(tournamentName)}-discipline.csv`, [
      ...records.map((r) => ({
        type: "incident",
        player: r.player_id ? playerName.get(r.player_id) : "",
        team: r.team_id ? teamMap.get(r.team_id)?.name : "",
        match: r.fixture_id ? fixtureCode.get(r.fixture_id) : "",
        incident: INCIDENT_LABELS[r.incident_type],
        card: r.card_type,
        reason: r.reason ?? "",
        referee: r.referee_id ? referees[r.referee_id] ?? "" : "",
        time: r.occurred_at,
        suspension_matches: "",
        suspension_status: "",
      })),
      ...suspensions.map((s) => ({
        type: "suspension",
        player: playerName.get(s.player_id),
        team: s.team_id ? teamMap.get(s.team_id)?.name : "",
        match: s.starts_after_fixture_id ? fixtureCode.get(s.starts_after_fixture_id) : "",
        incident: s.source,
        card: "",
        reason: s.reason,
        referee: "",
        time: s.created_at,
        suspension_matches: s.matches,
        suspension_status: s.status === "overturned" ? "overturned" : progress[s.id]?.active ? `active (${progress[s.id].remaining} left)` : "served",
      })),
    ]);

  return (
    <div className="space-y-6">
      <div className="no-print flex flex-wrap gap-2">
        {isAdmin ? (
          <>
            <Button size="sm" onClick={() => setDialog("suspension")}><Ban /> Add suspension</Button>
            <Button size="sm" variant="outline" onClick={() => setDialog("incident")}><Plus /> Record incident</Button>
          </>
        ) : null}
        <Button size="sm" variant="outline" onClick={exportCsv}><Download /> Discipline report (CSV)</Button>
      </div>

      <Alert>
        <ShieldAlert />
        <AlertDescription>
          <ul className="list-disc pl-4">{rules.map((r) => <li key={r}>{r}</li>)}</ul>
        </AlertDescription>
      </Alert>

      {atRisk.length ? (
        <Alert>
          <AlertDescription>
            One more yellow card triggers a suspension for: {atRisk.map((a) => `${playerName.get(a.playerId)} (${a.yellows})`).join(", ")}.
          </AlertDescription>
        </Alert>
      ) : null}

      <Card className="gap-0 py-0">
        <CardHeader className="border-b py-3"><CardTitle>Suspensions</CardTitle></CardHeader>
        <CardContent className="px-0">
          {suspensions.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Player</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead className="hidden text-center sm:table-cell">Served</TableHead>
                  <TableHead>Status</TableHead>
                  {isAdmin ? <TableHead /> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {suspensions.map((s) => {
                  const p = progress[s.id];
                  return (
                    <TableRow key={s.id}>
                      <TableCell>
                        <div className="font-medium">{playerName.get(s.player_id)}</div>
                        <div className="text-xs text-muted-foreground">{s.team_id ? teamMap.get(s.team_id)?.name : ""}</div>
                      </TableCell>
                      <TableCell className="max-w-64 text-sm">
                        {s.reason}
                        <div className="text-xs text-muted-foreground">{s.source === "automatic" ? "Automatic" : "Manual"}{s.starts_after_fixture_id ? ` · after ${fixtureCode.get(s.starts_after_fixture_id)}` : ""}</div>
                      </TableCell>
                      <TableCell className="hidden text-center tabular sm:table-cell">{p?.served ?? 0} / {s.matches}</TableCell>
                      <TableCell>
                        {s.status === "overturned" ? (
                          <Badge variant="outline">Overturned</Badge>
                        ) : p?.active ? (
                          <Badge variant="destructive">Active: {p.remaining} left</Badge>
                        ) : (
                          <Badge variant="secondary" className="bg-success/15 text-success">Served</Badge>
                        )}
                        {s.status_note ? <div className="mt-1 text-xs text-muted-foreground">{s.status_note}</div> : null}
                      </TableCell>
                      {isAdmin ? (
                        <TableCell className="text-right">
                          {s.status === "active" ? (
                            <ConfirmAction
                              trigger={<Button variant="ghost" size="sm">Overturn</Button>}
                              title="Overturn this suspension?"
                              reason={{ label: "Reason", minLength: 3 }}
                              confirmLabel="Overturn"
                              action={(reason) => setSuspensionStatus(tournamentId, s.id, "overturned", reason)}
                            />
                          ) : (
                            <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => setSuspensionStatus(tournamentId, s.id, "active", ""))}>Reinstate</Button>
                          )}
                        </TableCell>
                      ) : null}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <p className="p-4 text-sm text-muted-foreground">No suspensions.</p>
          )}
        </CardContent>
      </Card>

      <Card className="gap-0 py-0">
        <CardHeader className="border-b py-3"><CardTitle>Discipline register</CardTitle></CardHeader>
        <CardContent className="px-0">
          {records.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Incident</TableHead>
                  <TableHead>Player</TableHead>
                  <TableHead className="hidden sm:table-cell">Match</TableHead>
                  <TableHead className="hidden md:table-cell">Reason</TableHead>
                  <TableHead className="hidden lg:table-cell">Referee</TableHead>
                  <TableHead className="hidden sm:table-cell">Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <span className="inline-flex items-center gap-2">
                        {r.card_type === "yellow" ? <span className="h-4 w-3 rounded-[2px] bg-yellow-400" /> : r.card_type === "red" ? <span className="h-4 w-3 rounded-[2px] bg-red-600" /> : null}
                        {INCIDENT_LABELS[r.incident_type]}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{r.player_id ? playerName.get(r.player_id) : "–"}</div>
                      {r.team_id ? <TeamName team={teamMap.get(r.team_id)} className="text-xs text-muted-foreground" /> : null}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">{r.fixture_id ? fixtureCode.get(r.fixture_id) : "–"}</TableCell>
                    <TableCell className="hidden max-w-64 truncate md:table-cell">{r.reason ?? "–"}</TableCell>
                    <TableCell className="hidden lg:table-cell">{r.referee_id ? referees[r.referee_id] ?? "–" : "–"}</TableCell>
                    <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">{new Date(r.occurred_at).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="p-4"><EmptyState title="Clean so far" description="Cards recorded in the match centre appear here automatically." /></div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialog === "suspension" ? "Add suspension" : "Record incident"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <Field label="Player" htmlFor="d-player">
              <NativeSelect id="d-player" value={form.player_id} onChange={(e) => setForm({ ...form, player_id: e.target.value })}>
                <option value="">Choose a player</option>
                {players.map((p) => <option key={p.id} value={p.id}>{p.name}{p.teamId ? ` (${teamMap.get(p.teamId)?.name})` : ""}</option>)}
              </NativeSelect>
            </Field>
            <Field label={dialog === "suspension" ? "Counts from matches after" : "Match"} htmlFor="d-fixture" hint={dialog === "suspension" ? "Leave empty to count every later confirmed match of the team." : undefined}>
              <NativeSelect id="d-fixture" value={form.starts_after_fixture_id} onChange={(e) => setForm({ ...form, starts_after_fixture_id: e.target.value })}>
                <option value="">None</option>
                {fixtures.map((f) => <option key={f.id} value={f.id}>{f.code}</option>)}
              </NativeSelect>
            </Field>
            {dialog === "suspension" ? (
              <Field label="Matches" htmlFor="d-matches">
                <Input id="d-matches" type="number" min={1} max={20} value={form.matches} onChange={(e) => setForm({ ...form, matches: Number(e.target.value) || 1 })} />
              </Field>
            ) : (
              <Field label="Type" htmlFor="d-type">
                <NativeSelect id="d-type" value={form.incident_type} onChange={(e) => setForm({ ...form, incident_type: e.target.value as "misconduct" | "other" })}>
                  <option value="misconduct">Misconduct</option>
                  <option value="other">Other</option>
                </NativeSelect>
              </Field>
            )}
            <Field label="Reason" htmlFor="d-reason">
              <Textarea id="d-reason" rows={2} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
            </Field>
          </div>
          <DialogFooter>
            <Button
              disabled={pending || !form.player_id}
              onClick={() =>
                run(
                  () =>
                    dialog === "suspension"
                      ? addSuspension(tournamentId, { player_id: form.player_id, starts_after_fixture_id: form.starts_after_fixture_id, matches: form.matches, reason: form.reason })
                      : addDisciplinaryRecord(tournamentId, { player_id: form.player_id, fixture_id: form.starts_after_fixture_id, incident_type: form.incident_type, reason: form.reason }),
                  { onSuccess: () => setDialog(null) },
                )
              }
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
