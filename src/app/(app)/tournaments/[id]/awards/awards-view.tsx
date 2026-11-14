"use client";

import { useState } from "react";
import { Award, CircleCheck, Crown, Eye, EyeOff, Lock, Medal, Star, Trophy, Unlock, Vote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Field, NativeSelect } from "@/components/app/field";
import { TeamName, type TeamLike } from "@/components/app/team-name";
import { ConfirmAction } from "@/components/app/confirm-action";
import { useAction } from "@/hooks/use-action";
import { confirmAwards, nominateMvp, saveMvp, setAwardsPublished, setFinalised, withdrawNomination } from "@/lib/actions/awards";
import type { PlayerStat } from "@/lib/engine";
import type { MvpNomination, TournamentAwards } from "@/lib/types";
import { cn } from "@/lib/utils";

interface P { id: string; name: string; teamId: string | null }

export function AwardsView({
  tournamentId,
  isAdmin,
  canNominate,
  nominationsEnabled,
  currentUserId,
  teams,
  players,
  stats,
  mostGoals,
  live,
  hasFinal,
  awards,
  nominations,
  nominators,
  unfinishedMatches,
  publicEnabled,
}: {
  tournamentId: string;
  isAdmin: boolean;
  canNominate: boolean;
  nominationsEnabled: boolean;
  currentUserId: string;
  teams: (TeamLike & { id: string })[];
  players: P[];
  stats: PlayerStat[];
  mostGoals: { goals: number; playerIds: string[] };
  live: { champion: string | null; runnerUp: string | null; thirdPlace: string | null; finalConfirmed: boolean };
  hasFinal: boolean;
  awards: TournamentAwards | null;
  nominations: MvpNomination[];
  nominators: Record<string, string>;
  unfinishedMatches: number;
  publicEnabled: boolean;
}) {
  const { pending, run } = useAction();
  const teamMap = new Map(teams.map((t) => [t.id, t]));
  const playerMap = new Map(players.map((p) => [p.id, p]));
  const statMap = new Map(stats.map((s) => [s.playerId, s]));
  const confirmed = !!awards?.confirmed_at;
  const finalised = !!awards?.finalised_at;
  // Before confirmation show live values; after, the confirmed snapshot.
  const champion = confirmed ? awards!.champion_team_id : live.champion;
  const runnerUp = confirmed ? awards!.runner_up_team_id : live.runnerUp;
  const third = confirmed ? awards!.third_place_team_id : live.thirdPlace;
  const scorers = confirmed ? { goals: awards!.top_scorer_goals ?? 0, playerIds: awards!.top_scorer_player_ids } : mostGoals;
  const playerLabel = (id: string) => {
    const p = playerMap.get(id);
    return p ? `${p.name}${p.teamId && teamMap.get(p.teamId) ? ` (${teamMap.get(p.teamId)!.name})` : ""}` : "Unknown player";
  };
  const nominationCount = (pid: string) => nominations.filter((n) => n.player_id === pid).length;

  const [mvp, setMvp] = useState({ mvp_player_id: awards?.mvp_player_id ?? "", mvp_reason: awards?.mvp_reason ?? "", mvp_comments: awards?.mvp_comments ?? "" });
  const [nom, setNom] = useState({ player: "", reason: "" });
  const candidates = [...players].sort(
    (a, b) => nominationCount(b.id) - nominationCount(a.id) || (statMap.get(b.id)?.goals ?? 0) - (statMap.get(a.id)?.goals ?? 0) || a.name.localeCompare(b.name),
  );

  const rows = [
    {
      icon: Trophy, label: "Winners",
      value: champion ? <TeamName team={teamMap.get(champion)} size="md" className="font-semibold" /> : null,
      empty: hasFinal ? (live.finalConfirmed ? "Final has no winner recorded" : "Decided when the final is confirmed") : "This format has no final",
    },
    {
      icon: Medal, label: "Runners up",
      value: runnerUp ? <TeamName team={teamMap.get(runnerUp)} size="md" /> : null,
      empty: hasFinal ? "Decided when the final is confirmed" : "This format has no final",
    },
    ...(third || live.thirdPlace ? [{ icon: Award, label: "Third place", value: third ? <TeamName team={teamMap.get(third)} size="md" /> : null, empty: "Decided by the third-place match" }] : []),
    {
      icon: Star, label: "MVP",
      value: awards?.mvp_player_id ? (
        <div>
          <div className="font-semibold">{playerLabel(awards.mvp_player_id)}</div>
          {awards.mvp_reason ? <div className="text-xs text-muted-foreground">{awards.mvp_reason}</div> : null}
        </div>
      ) : null,
      empty: "Not selected yet. The organisers choose the MVP below.",
    },
    {
      icon: Crown, label: "Most Goals",
      value: scorers.playerIds.length ? (
        <div>
          <div className="font-semibold">{scorers.playerIds.map(playerLabel).join(", ")}</div>
          <div className="text-xs text-muted-foreground">{scorers.goals} goal{scorers.goals === 1 ? "" : "s"}{scorers.playerIds.length > 1 ? ` each · ${scorers.playerIds.length} players tied` : ""}</div>
        </div>
      ) : null,
      empty: "No goals with a named scorer in confirmed matches yet.",
    },
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            Final results
            {finalised ? <Badge className="gap-1"><Lock className="size-3" /> Finalised</Badge> : confirmed ? <Badge variant="secondary" className="bg-success/15 text-success">Confirmed</Badge> : <Badge variant="outline">Provisional</Badge>}
            {awards?.published ? <Badge variant="outline">Published</Badge> : null}
          </CardTitle>
          <CardDescription>
            {confirmed
              ? `Confirmed ${new Date(awards!.confirmed_at!).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}. Changes to the MVP require confirming again.`
              : "Live values from confirmed matches. Review them, then confirm the awards."}
          </CardDescription>
        </CardHeader>
        <CardContent className="-mx-4 -mb-4 border-t px-0">
          <Table>
            <TableHeader><TableRow><TableHead className="w-40">Award</TableHead><TableHead>Winner</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.label}>
                  <TableCell className="font-medium"><span className="inline-flex items-center gap-2"><r.icon className="size-4 text-primary" /> {r.label}</span></TableCell>
                  <TableCell className={cn(!r.value && "text-muted-foreground")}>{r.value ?? r.empty}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {isAdmin ? (
        <Card className="gap-3 px-4">
          <div className="text-sm font-semibold">Review, confirm and publish</div>
          {unfinishedMatches ? (
            <Alert><AlertDescription>{unfinishedMatches} match{unfinishedMatches === 1 ? " is" : "es are"} not finished and confirmed yet. Awards can be confirmed once the final is confirmed; the tournament can be finalised once every match is done.</AlertDescription></Alert>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {!finalised ? (
              <ConfirmAction
                trigger={<Button disabled={pending}><CircleCheck /> {confirmed ? "Confirm again" : "Confirm awards"}</Button>}
                title="Confirm the awards?"
                description="Winners, Runners up, third place and Most Goals are taken from the confirmed results now and saved with your MVP choice."
                confirmLabel="Confirm awards"
                action={() => confirmAwards(tournamentId)}
              />
            ) : null}
            {confirmed ? (
              awards!.published ? (
                <Button variant="outline" disabled={pending} onClick={() => run(() => setAwardsPublished(tournamentId, false))}><EyeOff /> Hide from public page</Button>
              ) : (
                <Button variant="outline" disabled={pending} onClick={() => run(() => setAwardsPublished(tournamentId, true))}><Eye /> Publish final results</Button>
              )
            ) : null}
            {confirmed && !finalised ? (
              <ConfirmAction
                trigger={<Button variant="outline" disabled={pending}><Lock /> Finalise tournament</Button>}
                title="Finalise the tournament?"
                description="The awards are locked and the tournament is marked completed. You can reopen it later with a reason."
                confirmLabel="Finalise"
                action={() => setFinalised(tournamentId, true)}
              />
            ) : null}
            {finalised ? (
              <ConfirmAction
                trigger={<Button variant="outline" disabled={pending}><Unlock /> Reopen</Button>}
                title="Reopen the tournament?"
                description="Awards become editable again. The reason is recorded in the audit log."
                reason={{ label: "Reason", minLength: 5 }}
                confirmLabel="Reopen"
                action={(reason) => setFinalised(tournamentId, false, reason)}
              />
            ) : null}
          </div>
          {awards?.published && !publicEnabled ? <p className="text-xs text-muted-foreground">The public page is turned off in Settings, so nobody outside can see the results yet.</p> : null}
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_22rem]">
        <Card className="gap-0 py-0">
          <CardHeader className="border-b py-3">
            <CardTitle>MVP candidates</CardTitle>
            <CardDescription>Statistics from confirmed matches. The MVP is not chosen automatically from goals.</CardDescription>
          </CardHeader>
          <Table className="tabular">
            <TableHeader>
              <TableRow>
                <TableHead>Player</TableHead>
                <TableHead className="text-center" title="Matches played">MP</TableHead>
                <TableHead className="text-center" title="Goals">G</TableHead>
                <TableHead className="hidden text-center sm:table-cell" title="Penalty goals">Pen</TableHead>
                <TableHead className="hidden text-center sm:table-cell" title="Own goals">OG</TableHead>
                <TableHead className="text-center" title="Cards">Cards</TableHead>
                <TableHead className="text-center" title="Nominations"><Vote className="mx-auto size-4" /></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {candidates.slice(0, 40).map((p) => {
                const s = statMap.get(p.id);
                return (
                  <TableRow key={p.id} className={cn(awards?.mvp_player_id === p.id && "bg-primary/5")}>
                    <TableCell>
                      <div className="font-medium">{p.name}{awards?.mvp_player_id === p.id ? <Star className="ml-1 inline size-3.5 text-amber-500" /> : null}</div>
                      <div className="text-xs text-muted-foreground">{p.teamId ? teamMap.get(p.teamId)?.name : ""}</div>
                    </TableCell>
                    <TableCell className="text-center">{s?.matchesPlayed ?? 0}</TableCell>
                    <TableCell className="text-center font-semibold">{s?.goals ?? 0}</TableCell>
                    <TableCell className="hidden text-center sm:table-cell">{s?.penaltyGoals ?? 0}</TableCell>
                    <TableCell className="hidden text-center sm:table-cell">{s?.ownGoals ?? 0}</TableCell>
                    <TableCell className="text-center">{s?.yellow || s?.red ? `${s.yellow}Y ${s.red}R` : "–"}</TableCell>
                    <TableCell className="text-center">{nominationCount(p.id) || "–"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>

        <div className="space-y-6">
          {isAdmin ? (
            <Card>
              <CardHeader>
                <CardTitle>Select the MVP</CardTitle>
                <CardDescription>{finalised ? "Locked: the tournament is finalised." : "Editable until the tournament is finalised."}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Field label="Player" htmlFor="mvp-player">
                  <NativeSelect id="mvp-player" value={mvp.mvp_player_id} disabled={finalised} onChange={(e) => setMvp({ ...mvp, mvp_player_id: e.target.value })}>
                    <option value="">Not selected</option>
                    {candidates.map((p) => <option key={p.id} value={p.id}>{playerLabel(p.id)}{nominationCount(p.id) ? ` · ${nominationCount(p.id)} nomination(s)` : ""}</option>)}
                  </NativeSelect>
                </Field>
                <Field label="Reason for the selection" htmlFor="mvp-reason">
                  <Textarea id="mvp-reason" rows={3} disabled={finalised} value={mvp.mvp_reason} onChange={(e) => setMvp({ ...mvp, mvp_reason: e.target.value })} placeholder="e.g. Organised the defence in every match and scored the winner in the final" />
                </Field>
                <Field label="Comments (optional)" htmlFor="mvp-comments">
                  <Input id="mvp-comments" disabled={finalised} value={mvp.mvp_comments} onChange={(e) => setMvp({ ...mvp, mvp_comments: e.target.value })} />
                </Field>
                <Button className="w-full" disabled={pending || finalised || (!!mvp.mvp_player_id && mvp.mvp_reason.trim().length < 5)} onClick={() => run(() => saveMvp(tournamentId, mvp))}>
                  Save MVP selection
                </Button>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Nominations</CardTitle>
              <CardDescription>
                {nominationsEnabled ? "Organisers, referees and scorekeepers can nominate players. Nominations inform the organisers' choice." : "Only organisers can nominate. Turn on nominations by referees and scorekeepers in Settings, Discipline."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {nominations.length ? (
                <ul className="divide-y rounded-lg border">
                  {nominations.map((n) => (
                    <li key={n.id} className="flex items-start gap-2 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">{playerLabel(n.player_id)}</div>
                        <div className="text-xs text-muted-foreground">by {nominators[n.nominated_by] ?? "Organiser"}{n.reason ? ` · ${n.reason}` : ""}</div>
                      </div>
                      {(n.nominated_by === currentUserId || isAdmin) && !finalised ? (
                        <Button variant="ghost" size="xs" disabled={pending} onClick={() => run(() => withdrawNomination(tournamentId, n.id))}>Remove</Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground">No nominations yet.</p>
              )}
              {canNominate && !finalised ? (
                <div className="space-y-2 border-t pt-3">
                  <NativeSelect aria-label="Player to nominate" value={nom.player} onChange={(e) => setNom({ ...nom, player: e.target.value })}>
                    <option value="">Choose a player to nominate</option>
                    {candidates.map((p) => <option key={p.id} value={p.id}>{playerLabel(p.id)}</option>)}
                  </NativeSelect>
                  <Input placeholder="Why? (optional)" value={nom.reason} onChange={(e) => setNom({ ...nom, reason: e.target.value })} />
                  <Button size="sm" variant="outline" disabled={pending || !nom.player} onClick={() => run(() => nominateMvp(tournamentId, nom.player, nom.reason), { onSuccess: () => setNom({ player: "", reason: "" }) })}>
                    <Vote /> Nominate
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
