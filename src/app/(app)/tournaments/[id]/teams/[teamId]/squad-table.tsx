"use client";

import { Crown, Pencil, Trash2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/app/empty-state";
import { ConfirmAction } from "@/components/app/confirm-action";
import { PAYMENT_LABELS, PlayerDialog } from "@/components/teams/player-dialog";
import { useAction } from "@/hooks/use-action";
import { deletePlayer, setCaptain } from "@/lib/actions/teams";
import type { Eligibility, PlayerStat } from "@/lib/engine";
import type { Player, PlayerContact, Team } from "@/lib/types";
import { cn } from "@/lib/utils";

export function SquadTable({
  tournamentId,
  team,
  teams,
  players,
  contacts,
  positions,
  maxSquad,
  isAdmin,
  eligibility,
  stats,
  nextFixtureLabel,
}: {
  tournamentId: string;
  team: Team;
  teams: Pick<Team, "id" | "name">[];
  players: Player[];
  contacts: PlayerContact[];
  positions: string[];
  maxSquad: number;
  isAdmin: boolean;
  eligibility: Record<string, Eligibility>;
  stats: Record<string, PlayerStat>;
  nextFixtureLabel: string | null;
}) {
  const { pending, run } = useAction();
  const contactMap = new Map(contacts.map((c) => [c.player_id, c]));
  const confirmed = players.filter((p) => p.registration_status === "confirmed").length;
  const sorted = [...players].sort((a, b) => Number(a.registration_status === "withdrawn") - Number(b.registration_status === "withdrawn") || (a.jersey_number ?? 999) - (b.jersey_number ?? 999) || a.full_name.localeCompare(b.full_name));

  return (
    <Card className="gap-0 py-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <div className="text-sm">
          <span className="font-semibold tabular">{confirmed} / {maxSquad}</span> confirmed players
          {nextFixtureLabel ? <span className="text-muted-foreground"> · eligibility shown for next match {nextFixtureLabel}</span> : null}
        </div>
        {isAdmin ? (
          <PlayerDialog
            tournamentId={tournamentId}
            teams={teams}
            positions={positions}
            defaultTeamId={team.id}
            maxSquad={maxSquad}
            trigger={<Button size="sm" disabled={confirmed >= maxSquad}><UserPlus /> Add player</Button>}
          />
        ) : null}
      </div>
      {players.length === 0 ? (
        <div className="p-4"><EmptyState title="No players in this squad" description="Add players or approve registrations." /></div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12 text-center">#</TableHead>
              <TableHead>Player</TableHead>
              <TableHead className="hidden sm:table-cell">Position</TableHead>
              <TableHead className="hidden md:table-cell text-center">Goals</TableHead>
              <TableHead className="hidden md:table-cell text-center">Cards</TableHead>
              <TableHead>Status</TableHead>
              {isAdmin ? <TableHead className="hidden lg:table-cell">Contact</TableHead> : null}
              {isAdmin ? <TableHead className="hidden lg:table-cell">Payment</TableHead> : null}
              {isAdmin ? <TableHead className="w-24" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((p) => {
              const e = eligibility[p.id];
              const s = stats[p.id];
              const c = contactMap.get(p.id);
              return (
                <TableRow key={p.id} className={cn(p.registration_status === "withdrawn" && "opacity-55")}>
                  <TableCell className="text-center tabular text-muted-foreground">{p.jersey_number ?? "–"}</TableCell>
                  <TableCell className="font-medium">
                    <span className="inline-flex items-center gap-1.5">
                      {p.full_name}
                      {p.is_captain ? (
                        <Tooltip>
                          <TooltipTrigger asChild><Crown className="size-3.5 text-amber-500" /></TooltipTrigger>
                          <TooltipContent>Captain</TooltipContent>
                        </Tooltip>
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">{p.position ?? "–"}</TableCell>
                  <TableCell className="hidden text-center tabular md:table-cell">{s?.goals ?? 0}</TableCell>
                  <TableCell className="hidden text-center md:table-cell">
                    <span className="inline-flex gap-1">
                      {s?.yellow ? <span className="inline-block h-3.5 w-2.5 rounded-[2px] bg-yellow-400" title={`${s.yellow} yellow`} /> : null}
                      {s?.red ? <span className="inline-block h-3.5 w-2.5 rounded-[2px] bg-red-600" title={`${s.red} red`} /> : null}
                      {!s?.yellow && !s?.red ? <span className="text-muted-foreground">–</span> : null}
                    </span>
                  </TableCell>
                  <TableCell>
                    {e && !e.eligible ? (
                      <Tooltip>
                        <TooltipTrigger asChild><Badge variant="destructive">Unavailable</Badge></TooltipTrigger>
                        <TooltipContent className="max-w-xs">{e.reasons.join(" ")}</TooltipContent>
                      </Tooltip>
                    ) : (
                      <Badge variant="secondary" className="bg-success/15 text-success">Eligible</Badge>
                    )}
                  </TableCell>
                  {isAdmin ? (
                    <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">
                      {c?.email ?? ""}{c?.email && c?.phone ? <br /> : null}{c?.phone ?? ""}
                      {!c ? "–" : null}
                    </TableCell>
                  ) : null}
                  {isAdmin ? <TableCell className="hidden text-xs lg:table-cell">{PAYMENT_LABELS[p.payment_status]}</TableCell> : null}
                  {isAdmin ? (
                    <TableCell>
                      <div className="flex justify-end gap-0.5">
                        {!p.is_captain && p.registration_status === "confirmed" ? (
                          <Button variant="ghost" size="icon-sm" aria-label="Make captain" title="Make captain" disabled={pending} onClick={() => run(() => setCaptain(tournamentId, team.id, p.id))}>
                            <Crown />
                          </Button>
                        ) : null}
                        <PlayerDialog
                          tournamentId={tournamentId}
                          teams={teams}
                          positions={positions}
                          player={p}
                          contact={c}
                          trigger={<Button variant="ghost" size="icon-sm" aria-label="Edit player"><Pencil /></Button>}
                        />
                        <ConfirmAction
                          destructive
                          trigger={<Button variant="ghost" size="icon-sm" aria-label="Remove player"><Trash2 /></Button>}
                          title={`Remove ${p.full_name}?`}
                          description="Players with recorded match events are marked as withdrawn so match history stays intact."
                          confirmLabel="Remove"
                          action={() => deletePlayer(tournamentId, p.id)}
                        />
                      </div>
                    </TableCell>
                  ) : null}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}
