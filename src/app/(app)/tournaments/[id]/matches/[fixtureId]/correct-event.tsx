"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, NativeSelect } from "@/components/app/field";
import { useAction } from "@/hooks/use-action";
import { correctEvent } from "@/lib/actions/matches";
import { EVENT_LABELS } from "@/lib/domain";
import type { EventType, MatchEvent, Player, Team } from "@/lib/types";

const TYPES: EventType[] = ["goal", "penalty_goal", "own_goal", "yellow_card", "red_card", "foul", "sin_bin", "substitution", "shootout_goal", "shootout_miss"];

/** Correct a recorded event. The original is kept in the audit log with the reason. */
export function CorrectEventDialog({
  tournamentId,
  event: e,
  home,
  away,
  players,
  onClose,
}: {
  tournamentId: string;
  event: MatchEvent;
  home: Team;
  away: Team;
  players: Player[];
  onClose: () => void;
}) {
  const { pending, run } = useAction();
  const [type, setType] = useState<EventType>(e.event_type);
  const [team, setTeam] = useState(e.team_id ?? home.id);
  const [player, setPlayer] = useState(e.player_id ?? "");
  const [off, setOff] = useState(e.related_player_id ?? "");
  const [minute, setMinute] = useState(e.match_second !== null ? String(Math.floor(e.match_second / 60) + 1) : "");
  const [reason, setReason] = useState("");
  const squad = players.filter((p) => p.team_id === team && p.registration_status !== "withdrawn");

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Correct event</DialogTitle>
          <DialogDescription>The score, statistics, standings and discipline records are recalculated. The original entry stays in the audit log.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Event" htmlFor="ce-type">
            <NativeSelect id="ce-type" value={type} onChange={(ev) => setType(ev.target.value as EventType)}>
              {TYPES.map((t) => <option key={t} value={t}>{EVENT_LABELS[t]}</option>)}
            </NativeSelect>
          </Field>
          <Field label={type === "own_goal" ? "Team of the player (goal goes to the other team)" : "Team"} htmlFor="ce-team">
            <NativeSelect id="ce-team" value={team} onChange={(ev) => { setTeam(ev.target.value); setPlayer(""); setOff(""); }}>
              <option value={home.id}>{home.name}</option>
              <option value={away.id}>{away.name}</option>
            </NativeSelect>
          </Field>
          <Field label={type === "substitution" ? "Player coming on" : "Player"} htmlFor="ce-player">
            <NativeSelect id="ce-player" value={player} onChange={(ev) => setPlayer(ev.target.value)}>
              <option value="">Unknown</option>
              {squad.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </NativeSelect>
          </Field>
          {type === "substitution" ? (
            <Field label="Player going off" htmlFor="ce-off">
              <NativeSelect id="ce-off" value={off} onChange={(ev) => setOff(ev.target.value)}>
                <option value="">Not recorded</option>
                {squad.filter((p) => p.id !== player).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </NativeSelect>
            </Field>
          ) : (
            <Field label="Minute" htmlFor="ce-min">
              <Input id="ce-min" type="number" min={1} max={200} value={minute} onChange={(ev) => setMinute(ev.target.value)} />
            </Field>
          )}
        </div>
        <Field label="Reason for the correction" htmlFor="ce-reason">
          <Textarea id="ce-reason" rows={2} value={reason} onChange={(ev) => setReason(ev.target.value)} placeholder="e.g. Goal was scored by number 7, not number 9" />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={pending || reason.trim().length < 3}
            onClick={() =>
              run(
                () =>
                  correctEvent(
                    tournamentId,
                    e.id,
                    {
                      event_type: type,
                      team_id: team,
                      player_id: player,
                      related_player_id: type === "substitution" ? off : "",
                      ...(minute && type !== "substitution" ? { match_second: (Number(minute) - 1) * 60 } : {}),
                    },
                    reason,
                  ),
                { onSuccess: onClose },
              )
            }
          >
            {pending ? "Saving…" : "Save correction"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
