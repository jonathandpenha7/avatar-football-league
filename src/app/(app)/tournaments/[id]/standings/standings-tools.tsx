"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Download, Gavel, Printer, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/app/field";
import { ConfirmAction } from "@/components/app/confirm-action";
import { useAction } from "@/hooks/use-action";
import { deleteTiebreakDecision, recordTiebreakDecision } from "@/lib/actions/discipline";
import { downloadCsv, slugify } from "@/lib/csv";
import type { StandingRow } from "@/lib/engine";

export function StandingsTools({
  tournamentId,
  tournamentName,
  scopeKey,
  title,
  rows,
  unresolvedTies,
  canDecide,
  decisions,
  isAdmin,
}: {
  tournamentId: string;
  tournamentName: string;
  scopeKey: string;
  title: string;
  rows: StandingRow[];
  unresolvedTies: { id: string; name: string }[][];
  canDecide: boolean;
  decisions: { id: string; names: string[]; note: string; created_at: string }[];
  isAdmin: boolean;
}) {
  const [tie, setTie] = useState<{ id: string; name: string }[] | null>(null);
  const [note, setNote] = useState("");
  const { pending, run } = useAction();
  const move = (i: number, d: -1 | 1) => {
    if (!tie) return;
    const list = [...tie];
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    setTie(list);
  };

  return (
    <div className="no-print flex flex-wrap items-center gap-2">
      {canDecide
        ? unresolvedTies.map((t) => (
            <Button key={t.map((x) => x.id).join()} size="sm" variant="outline" onClick={() => { setTie(t); setNote(""); }}>
              <Gavel /> Decide tie: {t.map((x) => x.name).join(", ")}
            </Button>
          ))
        : null}
      <Button
        size="sm"
        variant="outline"
        onClick={() =>
          downloadCsv(
            `${slugify(tournamentName)}-${slugify(title)}.csv`,
            rows.map((r) => ({
              position: r.shared ? `=${r.position}` : r.position,
              team: r.name,
              played: r.played,
              won: r.won,
              drawn: r.drawn,
              lost: r.lost,
              goals_for: r.goalsFor,
              goals_against: r.goalsAgainst,
              goal_difference: r.goalDifference,
              points: r.points,
            })),
          )
        }
      >
        <Download /> CSV
      </Button>
      <Button size="sm" variant="outline" onClick={() => window.print()}><Printer /> Print</Button>
      {isAdmin && decisions.length ? (
        <div className="w-full space-y-1 text-xs text-muted-foreground">
          {decisions.map((d) => (
            <div key={d.id} className="flex items-center gap-2">
              <Gavel className="size-3" /> Organiser decision: {d.names.join(" ahead of ")} ({d.note})
              <ConfirmAction
                destructive
                trigger={<Button variant="ghost" size="icon-xs" aria-label="Remove decision"><Trash2 /></Button>}
                title="Remove this organiser decision?"
                confirmLabel="Remove"
                action={() => deleteTiebreakDecision(tournamentId, d.id)}
              />
            </div>
          ))}
        </div>
      ) : null}
      <Dialog open={!!tie} onOpenChange={(o) => !o && setTie(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Organiser decision</DialogTitle>
            <DialogDescription>Order the tied teams as decided (for example after a play-off or coin toss). This is recorded in the audit log.</DialogDescription>
          </DialogHeader>
          <ol className="divide-y rounded-lg border">
            {tie?.map((t, i) => (
              <li key={t.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                <span className="w-5 text-muted-foreground tabular">{i + 1}.</span>
                <span className="flex-1">{t.name}</span>
                <Button variant="ghost" size="icon-xs" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp /></Button>
                <Button variant="ghost" size="icon-xs" aria-label="Move down" disabled={i === (tie?.length ?? 0) - 1} onClick={() => move(i, 1)}><ArrowDown /></Button>
              </li>
            ))}
          </ol>
          <Field label="How was it decided?" htmlFor="tie-note">
            <Textarea id="tie-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Penalty play-off won 3–2" />
          </Field>
          <DialogFooter>
            <Button
              disabled={pending || note.trim().length < 5 || !tie}
              onClick={() =>
                run(() => recordTiebreakDecision(tournamentId, { scope: scopeKey, ordered_team_ids: tie!.map((t) => t.id), note }), {
                  onSuccess: () => setTie(null),
                })
              }
            >
              Save decision
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
