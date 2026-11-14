"use client";

import { useState } from "react";
import { Coffee, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field, NativeSelect } from "@/components/app/field";
import { ConfirmAction } from "@/components/app/confirm-action";
import { useAction } from "@/hooks/use-action";
import { saveBreaks } from "@/lib/actions/tournaments";
import { formatClock, toMinutes, type BreakItem } from "@/lib/engine";
import type { BlockedPeriodRow } from "@/lib/types";

const PRESETS = ["Water break", "Refreshment break", "Announcements", "Organiser briefing", "League review", "Break before semi-finals", "Break before the final", "Prayer"];

export function BreaksManager({
  tournamentId,
  configured,
  items,
  pitches,
  isAdmin,
}: {
  tournamentId: string;
  configured: BlockedPeriodRow[];
  items: BreakItem[];
  pitches: { id: string; name: string }[];
  isAdmin: boolean;
}) {
  const { pending, run } = useAction();
  const [editing, setEditing] = useState<{ index: number | null; row: BlockedPeriodRow } | null>(null);
  const pitchName = new Map(pitches.map((p) => [p.id, p.name]));
  const save = (list: BlockedPeriodRow[]) => run(() => saveBreaks(tournamentId, list), { onSuccess: () => setEditing(null) });
  const row = editing?.row;
  const dur = row ? (toMinutes(row.end) ?? 0) - (toMinutes(row.start) ?? 0) : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Coffee className="size-4" /> Breaks</CardTitle>
        <CardDescription>Shown in the timeline and on the dashboard. Adding or editing a break never moves fixtures; any overlap is flagged as a warning.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.length ? (
          <ul className="divide-y rounded-lg border">
            {items.map((b) => {
              const index = b.source === "configured" ? Number(b.key.slice(1)) : null;
              return (
                <li key={b.key} className="flex items-start gap-3 px-3 py-2 text-sm">
                  <div className="w-24 shrink-0 text-xs tabular text-muted-foreground">
                    <div className="font-medium text-foreground">{formatClock(b.start)}</div>
                    to {formatClock(b.end)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{b.label} <span className="font-normal text-muted-foreground">· {b.durationMin} min</span></div>
                    <div className="text-xs text-muted-foreground">
                      {b.pitchId ? `${pitchName.get(b.pitchId) ?? "One pitch"} only` : "All pitches"}
                      {b.description ? ` · ${b.description}` : ""}
                      {b.source === "knockout_gap" ? " · from the schedule" : ""}
                    </div>
                  </div>
                  {isAdmin && index !== null ? (
                    <div className="flex shrink-0 gap-0.5">
                      <Button variant="ghost" size="icon-sm" aria-label={`Edit ${b.label}`} onClick={() => setEditing({ index, row: { ...configured[index] } })}><Pencil /></Button>
                      <ConfirmAction
                        destructive
                        trigger={<Button variant="ghost" size="icon-sm" aria-label={`Delete ${b.label}`}><Trash2 /></Button>}
                        title={`Delete "${b.label}"?`}
                        description="Fixtures are not moved."
                        confirmLabel="Delete"
                        action={() => saveBreaks(tournamentId, configured.filter((_, i) => i !== index))}
                      />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No breaks scheduled.</p>
        )}
        {isAdmin ? (
          <Button size="sm" variant="outline" onClick={() => setEditing({ index: null, row: { start: "18:30", end: "18:40", label: "Water break", description: null, pitch_id: null } })}>
            <Plus /> Add break
          </Button>
        ) : null}
      </CardContent>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing?.index === null ? "Add break" : "Edit break"}</DialogTitle></DialogHeader>
          {row ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Name" htmlFor="br-name" className="col-span-2">
                <Input id="br-name" list="break-presets" value={row.label ?? ""} onChange={(e) => setEditing({ ...editing!, row: { ...row, label: e.target.value } })} />
                <datalist id="break-presets">{PRESETS.map((p) => <option key={p} value={p} />)}</datalist>
              </Field>
              <Field label="Start" htmlFor="br-start"><Input id="br-start" type="time" value={row.start.slice(0, 5)} onChange={(e) => setEditing({ ...editing!, row: { ...row, start: e.target.value } })} /></Field>
              <Field label="End" htmlFor="br-end" hint={dur > 0 ? `${dur} minutes` : "End must be after start"}><Input id="br-end" type="time" value={row.end.slice(0, 5)} onChange={(e) => setEditing({ ...editing!, row: { ...row, end: e.target.value } })} /></Field>
              <Field label="Pitches" htmlFor="br-pitch" className="col-span-2">
                <NativeSelect id="br-pitch" value={row.pitch_id ?? ""} onChange={(e) => setEditing({ ...editing!, row: { ...row, pitch_id: e.target.value || null } })}>
                  <option value="">All pitches</option>
                  {pitches.map((p) => <option key={p.id} value={p.id}>{p.name} only</option>)}
                </NativeSelect>
              </Field>
              <Field label="Description (optional)" htmlFor="br-desc" className="col-span-2">
                <Input id="br-desc" value={row.description ?? ""} onChange={(e) => setEditing({ ...editing!, row: { ...row, description: e.target.value } })} />
              </Field>
            </div>
          ) : null}
          <DialogFooter>
            <Button
              disabled={pending || !row || dur <= 0 || !(row.label ?? "").trim()}
              onClick={() => {
                if (!editing || !row) return;
                const list = [...configured];
                if (editing.index === null) list.push(row);
                else list[editing.index] = row;
                save(list);
              }}
            >
              Save break
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
