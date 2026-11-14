"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { useAction } from "@/hooks/use-action";
import { setParticipants } from "@/lib/actions/matches";
import type { MatchParticipant, Player, Team } from "@/lib/types";

/**
 * Who played in this match (for "matches played"). If nothing is recorded,
 * the team's confirmed, eligible squad is counted when the result is confirmed.
 */
export function LineupCard({
  tournamentId,
  fixtureId,
  teams,
  players,
  participants,
  editable,
}: {
  tournamentId: string;
  fixtureId: string;
  teams: Team[];
  players: Player[];
  participants: MatchParticipant[];
  editable: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Who played</CardTitle>
        <CardDescription>Used for players&apos; matches played. If left empty, the full eligible squad is counted when the result is confirmed.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {teams.map((t) => (
          <TeamLineup
            key={t.id}
            tournamentId={tournamentId}
            fixtureId={fixtureId}
            team={t}
            squad={players.filter((p) => p.team_id === t.id && p.registration_status === "confirmed")}
            recorded={participants.filter((p) => p.team_id === t.id)}
            editable={editable}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function TeamLineup({
  tournamentId,
  fixtureId,
  team,
  squad,
  recorded,
  editable,
}: {
  tournamentId: string;
  fixtureId: string;
  team: Team;
  squad: Player[];
  recorded: MatchParticipant[];
  editable: boolean;
}) {
  const { pending, run } = useAction();
  const initial = recorded.length ? recorded.map((r) => r.player_id) : squad.filter((p) => p.eligibility_status === "eligible").map((p) => p.id);
  const [selected, setSelected] = useState<string[]>(initial);
  const source = recorded.length ? (recorded[0].source === "default" ? "Full squad (default)" : "Recorded") : "Not recorded yet";
  const dirty = recorded.length === 0 || [...selected].sort().join() !== recorded.map((r) => r.player_id).sort().join();
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{team.name}</span>
        <span className="text-xs text-muted-foreground">{source}</span>
      </div>
      <div className="grid grid-cols-1 gap-1">
        {squad.map((p) => (
          <label key={p.id} className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={selected.includes(p.id)}
              disabled={!editable}
              onCheckedChange={(v) => setSelected((s) => (v ? [...s, p.id] : s.filter((x) => x !== p.id)))}
            />
            <span className="min-w-0 break-words">{p.full_name}</span>
          </label>
        ))}
        {!squad.length ? <span className="text-xs text-muted-foreground">No confirmed players.</span> : null}
      </div>
      {editable && squad.length && dirty ? (
        <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => setParticipants(tournamentId, fixtureId, team.id, selected))}>
          Save lineup
        </Button>
      ) : null}
    </div>
  );
}
