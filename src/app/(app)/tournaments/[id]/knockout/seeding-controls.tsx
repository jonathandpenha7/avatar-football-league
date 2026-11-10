"use client";

import { CircleAlert, CircleCheck, Eraser, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/app/confirm-action";
import { clearKnockoutSeeding, seedKnockout } from "@/lib/actions/fixtures";

export function SeedingControls({
  tournamentId,
  isAdmin,
  ready,
  blockers,
  preview,
  seeded,
  started,
  allowProvisional,
}: {
  tournamentId: string;
  isAdmin: boolean;
  ready: boolean;
  blockers: string[];
  preview: { source: string; team: string }[];
  seeded: boolean;
  started: boolean;
  allowProvisional: boolean;
}) {
  return (
    <div className="space-y-3 text-sm">
      {blockers.length ? (
        <ul className="space-y-1">
          {blockers.map((b) => (
            <li key={b} className="flex gap-2 text-muted-foreground"><CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" /> {b}</li>
          ))}
        </ul>
      ) : null}
      {ready ? (
        <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          {preview.map((p) => (
            <li key={p.source} className="flex items-center gap-2"><CircleCheck className="size-4 text-success" /> {p.source}: <strong>{p.team}</strong></li>
          ))}
        </ul>
      ) : null}
      {isAdmin ? (
        <div className="flex flex-wrap gap-2">
          <ConfirmAction
            trigger={<Button disabled={!ready || started}><ListChecks /> {seeded ? "Re-seed knockout" : "Seed knockout"}</Button>}
            title="Seed the knockout stage?"
            description="Qualified teams are placed into their knockout fixtures using the final standings."
            confirmLabel="Seed"
            action={() => seedKnockout(tournamentId, false)}
          />
          {allowProvisional && !ready ? (
            <ConfirmAction
              trigger={<Button variant="outline" disabled={started}>Seed provisionally</Button>}
              title="Seed provisionally?"
              description="Uses the current standings before all matches are confirmed. Ties affecting qualification still block seeding. Re-seed once the league is complete."
              confirmLabel="Seed provisionally"
              action={() => seedKnockout(tournamentId, true)}
            />
          ) : null}
          {seeded ? (
            <ConfirmAction
              destructive
              trigger={<Button variant="ghost" disabled={started}><Eraser /> Clear seeding</Button>}
              title="Clear knockout seeding?"
              confirmLabel="Clear"
              action={() => clearKnockoutSeeding(tournamentId)}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
