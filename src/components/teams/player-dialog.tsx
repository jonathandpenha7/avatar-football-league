"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Field, NativeSelect } from "@/components/app/field";
import { useAction } from "@/hooks/use-action";
import { createPlayer, updatePlayer } from "@/lib/actions/teams";
import type { Player, PlayerContact, Team } from "@/lib/types";

export const PAYMENT_LABELS: Record<Player["payment_status"], string> = {
  not_required: "Not required",
  unpaid: "Unpaid",
  pending_verification: "Awaiting verification",
  paid: "Paid (verified)",
  waived: "Waived",
  refunded: "Refunded",
};

export function PlayerDialog({
  tournamentId,
  teams,
  positions,
  player,
  contact,
  defaultTeamId,
  trigger,
  open: controlledOpen,
  onOpenChange,
  maxSquad,
}: {
  tournamentId: string;
  teams: Pick<Team, "id" | "name">[];
  positions: string[];
  player?: Player;
  contact?: PlayerContact | null;
  defaultTeamId?: string | null;
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
  maxSquad?: number;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const { pending, run } = useAction();
  const [duplicate, setDuplicate] = useState<string | null>(null);
  const initial = () => ({
    full_name: player?.full_name ?? "",
    team_id: player?.team_id ?? defaultTeamId ?? null,
    position: player?.position ?? "",
    jersey_number: player?.jersey_number ?? null,
    is_captain: player?.is_captain ?? false,
    registration_status: player?.registration_status ?? "confirmed",
    eligibility_status: player?.eligibility_status ?? "eligible",
    eligibility_note: player?.eligibility_note ?? "",
    consent_given: player?.consent_given ?? false,
    payment_status: player?.payment_status ?? "not_required",
    payment_note: player?.payment_note ?? "",
    email: contact?.email ?? "",
    phone: contact?.phone ?? "",
  });
  const [form, setForm] = useState(initial);
  const set = (p: Partial<ReturnType<typeof initial>>) => setForm((f) => ({ ...f, ...p }));

  const submit = (allowDuplicateName = false) =>
    run(
      () =>
        player
          ? updatePlayer(tournamentId, player.id, form)
          : createPlayer(tournamentId, form, { allowDuplicateName }),
      {
        onSuccess: () => {
          setOpen(false);
          setDuplicate(null);
          if (!player) setForm(initial());
        },
        onError: (e) => setDuplicate(/already registered in this tournament. If this is a different person/.test(e) ? e : null),
      },
    );

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setForm(initial());
        setDuplicate(null);
      }}
    >
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{player ? "Edit player" : "Add player"}</DialogTitle>
          {maxSquad ? <DialogDescription>Squads are limited to {maxSquad} confirmed players.</DialogDescription> : null}
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit(false);
          }}
        >
          <Field label="Full name" htmlFor="pl-name">
            <Input id="pl-name" value={form.full_name} onChange={(e) => set({ full_name: e.target.value })} required autoFocus />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Team" htmlFor="pl-team">
              <NativeSelect id="pl-team" value={form.team_id ?? ""} onChange={(e) => set({ team_id: e.target.value || null, is_captain: false })}>
                <option value="">Unassigned</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Preferred position" htmlFor="pl-pos">
              <NativeSelect id="pl-pos" value={form.position} onChange={(e) => set({ position: e.target.value })}>
                <option value="">Not specified</option>
                {positions.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Jersey number" htmlFor="pl-num" hint="Optional.">
              <Input id="pl-num" type="number" min={0} max={999} value={form.jersey_number ?? ""} onChange={(e) => set({ jersey_number: e.target.value ? Number(e.target.value) : null })} />
            </Field>
            <Field label="Registration" htmlFor="pl-reg">
              <NativeSelect id="pl-reg" value={form.registration_status} onChange={(e) => set({ registration_status: e.target.value as Player["registration_status"] })}>
                <option value="confirmed">Confirmed</option>
                <option value="pending">Pending</option>
                <option value="withdrawn">Withdrawn</option>
              </NativeSelect>
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={form.is_captain} disabled={!form.team_id} onCheckedChange={(v) => set({ is_captain: !!v })} /> Team captain
          </label>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Email (private)" htmlFor="pl-email">
              <Input id="pl-email" type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} />
            </Field>
            <Field label="Phone (private)" htmlFor="pl-phone">
              <Input id="pl-phone" type="tel" value={form.phone} onChange={(e) => set({ phone: e.target.value })} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Eligibility" htmlFor="pl-elig">
              <NativeSelect id="pl-elig" value={form.eligibility_status} onChange={(e) => set({ eligibility_status: e.target.value as Player["eligibility_status"] })}>
                <option value="eligible">Eligible</option>
                <option value="ineligible">Ineligible</option>
              </NativeSelect>
            </Field>
            <Field label="Payment" htmlFor="pl-pay" hint="Only mark as paid once verified.">
              <NativeSelect id="pl-pay" value={form.payment_status} onChange={(e) => set({ payment_status: e.target.value as Player["payment_status"] })}>
                {Object.entries(PAYMENT_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          {form.eligibility_status === "ineligible" ? (
            <Field label="Eligibility note" htmlFor="pl-enote">
              <Input id="pl-enote" value={form.eligibility_note} onChange={(e) => set({ eligibility_note: e.target.value })} />
            </Field>
          ) : null}
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={form.consent_given} onCheckedChange={(v) => set({ consent_given: !!v })} /> Registration consent received
          </label>
          {duplicate ? (
            <Alert>
              <AlertDescription className="space-y-2">
                <p>{duplicate}</p>
                <Button type="button" size="sm" variant="outline" onClick={() => submit(true)} disabled={pending}>
                  Add anyway
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button type="submit" disabled={pending}>{pending ? "Saving…" : player ? "Save player" : "Add player"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
