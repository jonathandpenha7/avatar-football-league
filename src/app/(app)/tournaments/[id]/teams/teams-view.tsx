"use client";

import { useState } from "react";
import Link from "next/link";
import { Crown, Download, MoreHorizontal, Pencil, Plus, Shuffle, Trash2, UserPlus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/app/empty-state";
import { TeamMark } from "@/components/app/team-name";
import { ConfirmAction } from "@/components/app/confirm-action";
import { TeamDialog } from "@/components/teams/team-dialog";
import { PlayerDialog } from "@/components/teams/player-dialog";
import { ImportDialog } from "@/components/teams/import-dialog";
import { useAction } from "@/hooks/use-action";
import { autoAssignGroups, deleteTeam } from "@/lib/actions/teams";
import { downloadCsv, slugify } from "@/lib/csv";
import type { Player, PlayerContact, Team } from "@/lib/types";

export function TeamsView({
  tournamentId,
  tournamentName,
  isAdmin,
  teams,
  players,
  contacts,
  positions,
  maxSquad,
  minToStart,
  showGroups,
  suspendedIds,
  openNew,
}: {
  tournamentId: string;
  tournamentName: string;
  isAdmin: boolean;
  teams: Team[];
  players: Player[];
  contacts: PlayerContact[];
  positions: string[];
  maxSquad: number;
  minToStart: number;
  showGroups: boolean;
  suspendedIds: string[];
  openNew: "team" | "player" | null;
}) {
  const [teamOpen, setTeamOpen] = useState(openNew === "team");
  const [playerOpen, setPlayerOpen] = useState(openNew === "player");
  const [editing, setEditing] = useState<Team | null>(null);
  const { pending, run } = useAction();
  const contactMap = new Map(contacts.map((c) => [c.player_id, c]));
  const unassigned = players.filter((p) => !p.team_id && p.registration_status !== "withdrawn");
  const suspended = new Set(suspendedIds);

  const exportAll = () => {
    const teamName = new Map(teams.map((t) => [t.id, t.name]));
    downloadCsv(
      `${slugify(tournamentName)}-team-lists.csv`,
      [...players]
        .sort((a, b) => (teamName.get(a.team_id ?? "") ?? "~").localeCompare(teamName.get(b.team_id ?? "") ?? "~") || a.full_name.localeCompare(b.full_name))
        .map((p) => ({
          team: p.team_id ? teamName.get(p.team_id) : "Unassigned",
          full_name: p.full_name,
          position: p.position ?? "",
          jersey_number: p.jersey_number ?? "",
          captain: p.is_captain ? "yes" : "",
          registration: p.registration_status,
          eligibility: p.eligibility_status,
          payment: p.payment_status,
          ...(isAdmin ? { email: contactMap.get(p.id)?.email ?? "", phone: contactMap.get(p.id)?.phone ?? "" } : {}),
        })),
    );
  };

  return (
    <div className="space-y-6">
      <div className="no-print flex flex-wrap gap-2">
        {isAdmin ? (
          <>
            <Button size="sm" onClick={() => setTeamOpen(true)}><Plus /> Add team</Button>
            <Button size="sm" variant="outline" onClick={() => setPlayerOpen(true)} disabled={!teams.length}><UserPlus /> Add player</Button>
            <ImportDialog tournamentId={tournamentId} />
            {showGroups ? (
              <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => autoAssignGroups(tournamentId))}>
                <Shuffle /> Auto-assign groups
              </Button>
            ) : null}
          </>
        ) : null}
        <Button size="sm" variant="outline" onClick={exportAll} disabled={!players.length}><Download /> Export team lists</Button>
      </div>

      {isAdmin ? (
        <>
          <TeamDialog tournamentId={tournamentId} open={teamOpen} onOpenChange={setTeamOpen} showGroups={showGroups} />
          {editing ? (
            <TeamDialog key={editing.id} tournamentId={tournamentId} team={editing} open onOpenChange={(o) => !o && setEditing(null)} showGroups={showGroups} />
          ) : null}
          <PlayerDialog tournamentId={tournamentId} teams={teams} positions={positions} open={playerOpen} onOpenChange={setPlayerOpen} maxSquad={maxSquad} />
        </>
      ) : null}

      {teams.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No teams yet"
          description="Add teams one by one or import your registration CSV."
          action={isAdmin ? <Button onClick={() => setTeamOpen(true)}><Plus /> Add team</Button> : null}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {teams.map((team) => {
            const squad = players.filter((p) => p.team_id === team.id && p.registration_status === "confirmed");
            const pendingCount = players.filter((p) => p.team_id === team.id && p.registration_status === "pending").length;
            const captain = squad.find((p) => p.is_captain);
            const flagged = squad.filter((p) => suspended.has(p.id) || p.eligibility_status !== "eligible").length;
            return (
              <Card key={team.id} className="gap-3 px-4">
                <div className="flex items-start justify-between gap-2">
                  <Link href={`/tournaments/${tournamentId}/teams/${team.id}`} className="flex min-w-0 items-center gap-3 hover:underline">
                    <TeamMark team={team} size="md" />
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{team.name}</div>
                      <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">
                        {team.group_label ? <span>Group {team.group_label}</span> : null}
                        {team.seed ? <span>Seed {team.seed}</span> : null}
                      </div>
                    </div>
                  </Link>
                  {isAdmin ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${team.name}`}><MoreHorizontal /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setEditing(team)}><Pencil /> Edit team</DropdownMenuItem>
                        <ConfirmAction
                          destructive
                          trigger={
                            <DropdownMenuItem variant="destructive" onSelect={(e) => e.preventDefault()}>
                              <Trash2 /> Delete team
                            </DropdownMenuItem>
                          }
                          title={`Delete ${team.name}?`}
                          description="Teams with players or fixtures cannot be deleted. Move players and regenerate fixtures first."
                          confirmLabel="Delete team"
                          action={() => deleteTeam(tournamentId, team.id)}
                        />
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Squad</span>
                    <span className="tabular font-medium">{squad.length} / {maxSquad}</span>
                  </div>
                  <Progress value={(squad.length / maxSquad) * 100} />
                </div>
                <div className="flex flex-wrap gap-1.5 text-xs">
                  {team.is_placeholder ? <Badge variant="outline">Placeholder name</Badge> : null}
                  {captain ? (
                    <Badge variant="secondary"><Crown /> {captain.full_name}</Badge>
                  ) : squad.length ? (
                    <Badge variant="outline">No captain</Badge>
                  ) : null}
                  {squad.length < minToStart ? <Badge variant="outline" className="text-amber-700 dark:text-warning">Below {minToStart} players</Badge> : null}
                  {pendingCount ? <Badge variant="outline">{pendingCount} pending</Badge> : null}
                  {flagged ? <Badge variant="destructive">{flagged} unavailable</Badge> : null}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {unassigned.length ? (
        <Card className="gap-2 px-4">
          <div className="text-sm font-semibold">Unassigned players ({unassigned.length})</div>
          <div className="flex flex-wrap gap-1.5">
            {unassigned.map((p) => (
              <PlayerDialog
                key={p.id}
                tournamentId={tournamentId}
                teams={teams}
                positions={positions}
                player={p}
                contact={contactMap.get(p.id)}
                trigger={<Button variant="outline" size="xs" disabled={!isAdmin}>{p.full_name}</Button>}
              />
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
