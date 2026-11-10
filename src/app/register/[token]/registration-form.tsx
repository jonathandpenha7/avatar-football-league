"use client";

import { useState } from "react";
import { CircleCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, NativeSelect } from "@/components/app/field";
import { useAction } from "@/hooks/use-action";
import { submitRegistration } from "@/lib/actions/registrations";

export function RegistrationForm({
  token,
  info,
}: {
  token: string;
  info: { positions: string[]; consent_text: string | null; requires_payment: boolean; fee_note: string | null; teams: { id: string; name: string }[] };
}) {
  const { pending, run } = useAction();
  const [done, setDone] = useState(false);
  const [f, setF] = useState({ full_name: "", email: "", phone: "", preferred_team_id: "", requested_team_name: "", position: "", jersey_number: "", consent_given: false, payment_option_selected: "", notes: "" });
  if (done) {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-center">
        <CircleCheck className="size-10 text-success" />
        <p className="font-medium">Thank you, your registration has been received.</p>
        <p className="text-sm text-muted-foreground">The organisers will review it and confirm your place.</p>
      </div>
    );
  }
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => submitRegistration(token, f), { onSuccess: () => setDone(true) });
      }}
    >
      <Field label="Full name" htmlFor="r-name"><Input id="r-name" required value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} autoComplete="name" /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Email" htmlFor="r-email"><Input id="r-email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="email" /></Field>
        <Field label="Phone" htmlFor="r-phone" hint="Email or phone is required."><Input id="r-phone" type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} autoComplete="tel" /></Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {info.teams.length ? (
          <Field label="Team" htmlFor="r-team">
            <NativeSelect id="r-team" value={f.preferred_team_id} onChange={(e) => setF({ ...f, preferred_team_id: e.target.value })}>
              <option value="">No preference</option>
              {info.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </NativeSelect>
          </Field>
        ) : (
          <Field label="Team name (if you have one)" htmlFor="r-tname"><Input id="r-tname" value={f.requested_team_name} onChange={(e) => setF({ ...f, requested_team_name: e.target.value })} /></Field>
        )}
        <Field label="Preferred position" htmlFor="r-pos">
          <NativeSelect id="r-pos" value={f.position} onChange={(e) => setF({ ...f, position: e.target.value })}>
            <option value="">No preference</option>
            {info.positions.map((p) => <option key={p} value={p}>{p}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Jersey number (optional)" htmlFor="r-num"><Input id="r-num" inputMode="numeric" maxLength={3} value={f.jersey_number} onChange={(e) => setF({ ...f, jersey_number: e.target.value.replace(/\D/g, "") })} /></Field>
      </div>
      {info.requires_payment ? (
        <Field label="Payment" htmlFor="r-pay" hint={info.fee_note ?? "The organisers confirm payment separately."}>
          <NativeSelect id="r-pay" value={f.payment_option_selected} onChange={(e) => setF({ ...f, payment_option_selected: e.target.value })}>
            <option value="">Choose how you will pay</option>
            <option value="Cash on the day">Cash on the day</option>
            <option value="Bank transfer or UPI">Bank transfer or UPI</option>
            <option value="Other">Other (add a note)</option>
          </NativeSelect>
        </Field>
      ) : null}
      <Field label="Anything the organisers should know?" htmlFor="r-notes"><Textarea id="r-notes" rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      {info.consent_text ? (
        <label className="flex items-start gap-2 rounded-lg border p-3 text-sm">
          <Checkbox checked={f.consent_given} onCheckedChange={(v) => setF({ ...f, consent_given: !!v })} className="mt-0.5" />
          <span className="whitespace-pre-line">{info.consent_text}</span>
        </label>
      ) : null}
      <Button type="submit" size="lg" disabled={pending || (!!info.consent_text && !f.consent_given)}>{pending ? "Submitting…" : "Submit registration"}</Button>
      <p className="text-xs text-muted-foreground">Your contact details are only visible to the tournament organisers.</p>
    </form>
  );
}
