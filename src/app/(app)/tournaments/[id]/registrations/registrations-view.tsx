"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Copy, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/app/empty-state";
import { NativeSelect } from "@/components/app/field";
import { ConfirmAction } from "@/components/app/confirm-action";
import { PAYMENT_LABELS } from "@/components/teams/player-dialog";
import { useAction } from "@/hooks/use-action";
import { approveRegistration, rejectRegistration, setRegistrationPayment } from "@/lib/actions/registrations";
import type { Registration } from "@/lib/types";

export function RegistrationsView({
  tournamentId,
  registrations,
  teams,
  squad,
  maxSquad,
  link,
  open,
  existingNames,
}: {
  tournamentId: string;
  registrations: Registration[];
  teams: { id: string; name: string }[];
  squad: Record<string, number>;
  maxSquad: number;
  link: string;
  open: boolean;
  existingNames: string[];
}) {
  const [tab, setTab] = useState<"pending" | "approved" | "rejected">("pending");
  const list = registrations.filter((r) => r.status === tab);
  const teamName = new Map(teams.map((t) => [t.id, t.name]));
  const names = new Set(existingNames);
  return (
    <div className="space-y-4">
      <Card className="flex-row flex-wrap items-center gap-3 px-4">
        <Badge variant={open ? "default" : "outline"}>{open ? "Registration open" : "Registration closed"}</Badge>
        <Input readOnly value={link} className="min-w-0 flex-1" onFocus={(e) => e.target.select()} />
        <Button variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(link).then(() => toast.success("Link copied."))}><Copy /> Copy link</Button>
        <Button asChild variant="ghost" size="sm"><Link href={`/tournaments/${tournamentId}/settings?tab=registration`}>Registration settings</Link></Button>
      </Card>
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          {(["pending", "approved", "rejected"] as const).map((s) => (
            <TabsTrigger key={s} value={s} className="capitalize">{s} ({registrations.filter((r) => r.status === s).length})</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {list.length === 0 ? (
        <EmptyState icon={UserPlus} title={`No ${tab} registrations`} description={tab === "pending" ? "Share the registration link with players." : undefined} />
      ) : (
        <div className="space-y-3">
          {list.map((r) => (
            <RegistrationCard key={r.id} tournamentId={tournamentId} r={r} teams={teams} teamName={teamName} squad={squad} maxSquad={maxSquad} duplicate={names.has(r.full_name.toLowerCase()) && r.status === "pending"} />
          ))}
        </div>
      )}
    </div>
  );
}

function RegistrationCard({
  tournamentId,
  r,
  teams,
  teamName,
  squad,
  maxSquad,
  duplicate,
}: {
  tournamentId: string;
  r: Registration;
  teams: { id: string; name: string }[];
  teamName: Map<string, string>;
  squad: Record<string, number>;
  maxSquad: number;
  duplicate: boolean;
}) {
  const { pending, run } = useAction();
  const [team, setTeam] = useState(r.preferred_team_id ?? "");
  return (
    <Card className="gap-3 px-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-semibold">{r.full_name}</div>
          <div className="text-xs text-muted-foreground">{[r.email, r.phone].filter(Boolean).join(" · ")} · {new Date(r.created_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</div>
        </div>
        <div className="flex flex-wrap gap-1">
          {duplicate ? <Badge variant="destructive">Name already registered</Badge> : null}
          <Badge variant="outline">{r.consent_given ? "Consent given" : "No consent recorded"}</Badge>
        </div>
      </div>
      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
        <div><dt className="text-xs text-muted-foreground">Preferred team</dt><dd>{r.preferred_team_id ? teamName.get(r.preferred_team_id) : r.requested_team_name ?? "Any"}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Position</dt><dd>{r.position ?? "–"}{r.jersey_number !== null ? ` · #${r.jersey_number}` : ""}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Payment option selected</dt><dd>{r.payment_option_selected ?? "–"}</dd></div>
        {r.notes ? <div className="sm:col-span-3"><dt className="text-xs text-muted-foreground">Notes</dt><dd className="whitespace-pre-line">{r.notes}</dd></div> : null}
        {r.review_note ? <div className="sm:col-span-3"><dt className="text-xs text-muted-foreground">Review note</dt><dd>{r.review_note}</dd></div> : null}
      </dl>
      <div className="flex flex-wrap items-center gap-2 border-t pt-3">
        <span className="text-xs text-muted-foreground">Payment status</span>
        <NativeSelect aria-label="Payment status" className="w-48" value={r.payment_status} disabled={pending} onChange={(e) => run(() => setRegistrationPayment(tournamentId, r.id, e.target.value))}>
          {Object.entries(PAYMENT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </NativeSelect>
        {r.status === "pending" ? (
          <>
            <div className="flex-1" />
            <NativeSelect aria-label="Team" className="w-48" value={team} onChange={(e) => setTeam(e.target.value)}>
              <option value="">No team yet</option>
              {teams.map((t) => <option key={t.id} value={t.id} disabled={(squad[t.id] ?? 0) >= maxSquad}>{t.name} ({squad[t.id] ?? 0}/{maxSquad})</option>)}
            </NativeSelect>
            <Button size="sm" disabled={pending} onClick={() => run(() => approveRegistration(tournamentId, r.id, team || null))}><Check /> Approve</Button>
            <ConfirmAction destructive trigger={<Button size="sm" variant="ghost"><X /> Reject</Button>} title={`Reject ${r.full_name}?`} reason={{ label: "Note (optional)", minLength: 0 }} confirmLabel="Reject" action={(note) => rejectRegistration(tournamentId, r.id, note)} />
          </>
        ) : null}
      </div>
    </Card>
  );
}
