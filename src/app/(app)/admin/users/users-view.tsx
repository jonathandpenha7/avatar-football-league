"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NativeSelect } from "@/components/app/field";
import { useAction } from "@/hooks/use-action";
import { addExistingUserToTournament, setPlatformFlags } from "@/lib/actions/members";
import { ROLE_LABELS, type MemberRole } from "@/lib/permissions";
import type { Profile } from "@/lib/types";

export function UsersView({
  currentUserId,
  users,
  memberships,
  tournaments,
}: {
  currentUserId: string;
  users: Profile[];
  memberships: { user_id: string; tournament_id: string; role: string }[];
  tournaments: { id: string; name: string }[];
}) {
  const { pending, run } = useAction();
  const tName = new Map(tournaments.map((t) => [t.id, t.name]));
  return (
    <Card className="gap-0 py-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>User</TableHead>
            <TableHead className="text-center">Super Admin</TableHead>
            <TableHead className="text-center">Can create tournaments</TableHead>
            <TableHead>Tournaments</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((u) => (
            <TableRow key={u.id}>
              <TableCell>
                <div className="font-medium">{u.full_name ?? "No name"}{u.id === currentUserId ? <span className="text-muted-foreground"> (you)</span> : null}</div>
                <div className="text-xs text-muted-foreground">{u.email}</div>
              </TableCell>
              <TableCell className="text-center">
                <Switch aria-label="Super Admin" checked={u.is_super_admin} disabled={pending} onCheckedChange={(v) => run(() => setPlatformFlags(u.id, { is_super_admin: v }))} />
              </TableCell>
              <TableCell className="text-center">
                <Switch aria-label="Can create tournaments" checked={u.can_create_tournaments || u.is_super_admin} disabled={pending || u.is_super_admin} onCheckedChange={(v) => run(() => setPlatformFlags(u.id, { can_create_tournaments: v }))} />
              </TableCell>
              <TableCell className="space-y-1 text-xs">
                {memberships.filter((m) => m.user_id === u.id).map((m) => (
                  <div key={m.tournament_id}>{tName.get(m.tournament_id) ?? "Tournament"}: {ROLE_LABELS[m.role as MemberRole]}</div>
                ))}
                <AddToTournament userId={u.id} tournaments={tournaments.filter((t) => !memberships.some((m) => m.user_id === u.id && m.tournament_id === t.id))} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function AddToTournament({ userId, tournaments }: { userId: string; tournaments: { id: string; name: string }[] }) {
  const { pending, run } = useAction();
  const [t, setT] = useState("");
  const [role, setRole] = useState<MemberRole>("viewer");
  if (!tournaments.length) return null;
  return (
    <div className="flex flex-wrap gap-1 pt-1">
      <NativeSelect aria-label="Tournament" className="h-7 w-40 text-xs" value={t} onChange={(e) => setT(e.target.value)}>
        <option value="">Add to tournament</option>
        {tournaments.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
      </NativeSelect>
      {t ? (
        <>
          <NativeSelect aria-label="Role" className="h-7 w-36 text-xs" value={role} onChange={(e) => setRole(e.target.value as MemberRole)}>
            {(["tournament_admin", "referee", "scorekeeper", "viewer"] as MemberRole[]).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </NativeSelect>
          <Button size="xs" disabled={pending} onClick={() => run(() => addExistingUserToTournament(t, userId, role), { onSuccess: () => setT("") })}>Add</Button>
        </>
      ) : null}
    </div>
  );
}
