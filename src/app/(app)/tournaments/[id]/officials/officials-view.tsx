"use client";

import { useState } from "react";
import { Copy, Mail, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Field, NativeSelect } from "@/components/app/field";
import { ConfirmAction } from "@/components/app/confirm-action";
import { useAction } from "@/hooks/use-action";
import { inviteMember, removeMember, revokeInvitation, updateMemberRole } from "@/lib/actions/members";
import { assignOfficial, removeOfficial } from "@/lib/actions/fixtures";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, type MemberRole } from "@/lib/permissions";
import { describeSource } from "@/lib/engine";
import type { Fixture, Invitation, MatchOfficial, Member } from "@/lib/types";

const ROLES: MemberRole[] = ["tournament_admin", "referee", "scorekeeper", "viewer"];

export function OfficialsView({
  tournamentId,
  currentUserId,
  members,
  invitations,
  officials,
  fixtures,
  teams,
  pitches,
  siteUrl,
  emailConfigured,
}: {
  tournamentId: string;
  currentUserId: string;
  members: Member[];
  invitations: Invitation[];
  officials: MatchOfficial[];
  fixtures: Fixture[];
  teams: { id: string; name: string }[];
  pitches: { id: string; name: string }[];
  siteUrl: string;
  emailConfigured: boolean;
}) {
  const { pending, run } = useAction();
  const [invite, setInvite] = useState({ email: "", role: "referee" as MemberRole });
  const [lastLink, setLastLink] = useState<{ link: string; note: string } | null>(null);
  const [bulk, setBulk] = useState({ userId: "", role: "scorekeeper" as "referee" | "scorekeeper", pitchId: "" });
  const teamName = new Map(teams.map((t) => [t.id, t.name]));
  const pitchName = new Map(pitches.map((p) => [p.id, p.name]));
  const memberName = (uid: string) => {
    const m = members.find((x) => x.user_id === uid);
    return m?.profile?.full_name ?? m?.profile?.email ?? "Unknown";
  };
  const eligible = members.filter((m) => m.role !== "viewer");
  const copy = (text: string) => navigator.clipboard.writeText(text).then(() => toast.success("Link copied."));
  const assignable = fixtures.filter((f) => f.status !== "confirmed" && f.status !== "cancelled");

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_22rem]">
        <Card className="gap-0 py-0">
          <CardHeader className="border-b py-3"><CardTitle>Members ({members.length})</CardTitle></CardHeader>
          <Table>
            <TableHeader><TableRow><TableHead>Person</TableHead><TableHead>Role</TableHead><TableHead className="w-10" /></TableRow></TableHeader>
            <TableBody>
              {members.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>
                    <div className="font-medium">{m.profile?.full_name ?? "No name"}{m.user_id === currentUserId ? <span className="text-muted-foreground"> (you)</span> : null}</div>
                    <div className="text-xs text-muted-foreground">{m.profile?.email}</div>
                  </TableCell>
                  <TableCell>
                    <NativeSelect aria-label="Role" value={m.role} disabled={pending} onChange={(e) => run(() => updateMemberRole(tournamentId, m.id, e.target.value))} className="w-44">
                      {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                    </NativeSelect>
                  </TableCell>
                  <TableCell>
                    <ConfirmAction destructive trigger={<Button variant="ghost" size="icon-sm" aria-label="Remove member"><Trash2 /></Button>} title={`Remove ${m.profile?.full_name ?? m.profile?.email}?`} description="They lose access to this tournament and their match assignments are removed." confirmLabel="Remove" action={() => removeMember(tournamentId, m.id)} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><UserPlus className="size-4" /> Invite someone</CardTitle>
            <CardDescription>{emailConfigured ? "They receive an email with a sign-in link." : "Email sending is not configured, so you will get a link to send yourself."}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Field label="Email" htmlFor="inv-email"><Input id="inv-email" type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} /></Field>
            <Field label="Role" htmlFor="inv-role" hint={ROLE_DESCRIPTIONS[invite.role]}>
              <NativeSelect id="inv-role" value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value as MemberRole })}>
                {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </NativeSelect>
            </Field>
            <Button className="w-full" disabled={pending || !invite.email} onClick={() => run(() => inviteMember(tournamentId, invite), { onSuccess: (d) => { if (d) { setLastLink({ link: d.link, note: d.emailNote }); toast.message(d.emailNote); } setInvite({ ...invite, email: "" }); } })}>
              <Mail /> Send invitation
            </Button>
            {lastLink ? (
              <Alert>
                <AlertDescription className="space-y-2">
                  <p>{lastLink.note}</p>
                  <div className="flex gap-2"><Input readOnly value={lastLink.link} onFocus={(e) => e.target.select()} /><Button variant="outline" size="icon" aria-label="Copy link" onClick={() => copy(lastLink.link)}><Copy /></Button></div>
                </AlertDescription>
              </Alert>
            ) : null}
            {invitations.length ? (
              <div className="space-y-2 border-t pt-3">
                <div className="text-xs font-medium text-muted-foreground">Pending invitations</div>
                {invitations.map((i) => (
                  <div key={i.id} className="flex items-center gap-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{i.email}</div>
                      <div className="text-xs text-muted-foreground">{ROLE_LABELS[i.role]}{new Date(i.expires_at) < new Date() ? " · expired" : ""}</div>
                    </div>
                    <Button variant="ghost" size="icon-sm" aria-label="Copy invitation link" onClick={() => copy(`${siteUrl}/invite/${i.token}`)}><Copy /></Button>
                    <ConfirmAction trigger={<Button variant="ghost" size="icon-sm" aria-label="Revoke"><Trash2 /></Button>} title="Revoke this invitation?" confirmLabel="Revoke" action={() => revokeInvitation(tournamentId, i.id)} />
                  </div>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Match assignments</CardTitle>
          <CardDescription>Referees and scorekeepers can only record events for matches they are assigned to.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-2 rounded-lg border bg-muted/30 p-3 sm:grid-cols-[1fr_9rem_10rem_auto] sm:items-end">
            <Field label="Person" htmlFor="b-user">
              <NativeSelect id="b-user" value={bulk.userId} onChange={(e) => setBulk({ ...bulk, userId: e.target.value })}>
                <option value="">Choose</option>
                {eligible.map((m) => <option key={m.user_id} value={m.user_id}>{memberName(m.user_id)} ({ROLE_LABELS[m.role]})</option>)}
              </NativeSelect>
            </Field>
            <Field label="As" htmlFor="b-role">
              <NativeSelect id="b-role" value={bulk.role} onChange={(e) => setBulk({ ...bulk, role: e.target.value as "referee" | "scorekeeper" })}>
                <option value="scorekeeper">Scorekeeper</option>
                <option value="referee">Referee</option>
              </NativeSelect>
            </Field>
            <Field label="For matches on" htmlFor="b-pitch">
              <NativeSelect id="b-pitch" value={bulk.pitchId} onChange={(e) => setBulk({ ...bulk, pitchId: e.target.value })}>
                <option value="">All pitches</option>
                {pitches.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </NativeSelect>
            </Field>
            <Button
              disabled={pending || !bulk.userId}
              onClick={() => {
                const ids = assignable.filter((f) => !bulk.pitchId || f.pitch_id === bulk.pitchId).map((f) => f.id);
                if (!ids.length) return toast.error("No unplayed matches to assign.");
                run(() => assignOfficial(tournamentId, { fixtureIds: ids, userId: bulk.userId, role: bulk.role }));
              }}
            >
              Assign
            </Button>
          </div>
          {eligible.length === 0 ? <p className="text-sm text-muted-foreground">Invite referees or scorekeepers first.</p> : null}
          <div className="divide-y rounded-lg border">
            {fixtures.map((f) => {
              const list = officials.filter((o) => o.fixture_id === f.id);
              return (
                <div key={f.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                  <div className="w-14 text-xs text-muted-foreground tabular">{f.code}<div>{f.scheduled_time?.slice(0, 5) ?? ""}</div></div>
                  <div className="min-w-40 flex-1 truncate">
                    {f.home_team_id ? teamName.get(f.home_team_id) : describeSource(f.home_source)} v {f.away_team_id ? teamName.get(f.away_team_id) : describeSource(f.away_source)}
                    {f.pitch_id ? <span className="text-xs text-muted-foreground"> · {pitchName.get(f.pitch_id)}</span> : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    {list.map((o) => (
                      <Badge key={o.id} variant="secondary" className="gap-1">
                        {memberName(o.user_id)} · {o.role}
                        <button type="button" aria-label="Remove assignment" className="ml-0.5 opacity-60 hover:opacity-100" onClick={() => run(() => removeOfficial(tournamentId, o.id))}>×</button>
                      </Badge>
                    ))}
                    {f.status !== "confirmed" && eligible.length ? (
                      <NativeSelect
                        aria-label={`Assign official to ${f.code}`}
                        className="h-7 w-36 text-xs"
                        value=""
                        onChange={(e) => {
                          const [uid, role] = e.target.value.split("|");
                          if (uid) run(() => assignOfficial(tournamentId, { fixtureIds: [f.id], userId: uid, role }));
                        }}
                      >
                        <option value="">+ Assign</option>
                        {eligible.flatMap((m) => [
                          <option key={`${m.user_id}r`} value={`${m.user_id}|referee`}>{memberName(m.user_id)} as referee</option>,
                          <option key={`${m.user_id}s`} value={`${m.user_id}|scorekeeper`}>{memberName(m.user_id)} as scorekeeper</option>,
                        ])}
                      </NativeSelect>
                    ) : null}
                  </div>
                </div>
              );
            })}
            {!fixtures.length ? <p className="p-3 text-sm text-muted-foreground">Generate fixtures first.</p> : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
