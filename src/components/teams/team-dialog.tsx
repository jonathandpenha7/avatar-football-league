"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field, NativeSelect } from "@/components/app/field";
import { ImageUpload } from "@/components/app/image-upload";
import { useAction } from "@/hooks/use-action";
import { createTeam, setTeamLogo, updateTeam } from "@/lib/actions/teams";
import type { Team } from "@/lib/types";

const COLOURS = ["#16a34a", "#2563eb", "#dc2626", "#f59e0b", "#7c3aed", "#0891b2", "#db2777", "#475569", "#ea580c", "#65a30d"];

export function TeamDialog({
  tournamentId,
  team,
  trigger,
  showGroups,
  open: controlledOpen,
  onOpenChange,
}: {
  tournamentId: string;
  team?: Team;
  trigger?: ReactNode;
  showGroups?: boolean;
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const { pending, run } = useAction();
  const [form, setForm] = useState({
    name: team?.name ?? "",
    short_name: team?.short_name ?? "",
    colour: team?.colour ?? COLOURS[0],
    group_label: team?.group_label ?? "",
    seed: team?.seed ?? null,
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{team ? "Edit team" : "Add team"}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => (team ? updateTeam(tournamentId, team.id, form) : createTeam(tournamentId, form)), {
              onSuccess: () => setOpen(false),
            });
          }}
        >
          <Field label="Team name" htmlFor="team-name">
            <Input id="team-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Short name" htmlFor="team-short" hint="Up to 6 characters.">
              <Input id="team-short" maxLength={6} value={form.short_name} onChange={(e) => setForm({ ...form, short_name: e.target.value })} />
            </Field>
            <Field label="Seed" htmlFor="team-seed" hint="Used for brackets and groups.">
              <Input id="team-seed" type="number" min={1} max={128} value={form.seed ?? ""} onChange={(e) => setForm({ ...form, seed: e.target.value ? Number(e.target.value) : null })} />
            </Field>
          </div>
          <Field label="Team colour">
            <div className="flex flex-wrap items-center gap-2">
              {COLOURS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Colour ${c}`}
                  className="size-7 rounded-full ring-offset-2 ring-offset-background transition data-[on=true]:ring-2 data-[on=true]:ring-foreground"
                  data-on={form.colour === c}
                  style={{ backgroundColor: c }}
                  onClick={() => setForm({ ...form, colour: c })}
                />
              ))}
              <Input type="color" aria-label="Custom colour" value={form.colour ?? "#16a34a"} onChange={(e) => setForm({ ...form, colour: e.target.value })} className="h-7 w-12 p-0.5" />
            </div>
          </Field>
          {showGroups ? (
            <Field label="Group" htmlFor="team-group">
              <NativeSelect id="team-group" value={form.group_label} onChange={(e) => setForm({ ...form, group_label: e.target.value })}>
                <option value="">No group</option>
                {"ABCDEFGHIJKLMNOP".split("").map((g) => (
                  <option key={g} value={g}>Group {g}</option>
                ))}
              </NativeSelect>
            </Field>
          ) : null}
          {team ? (
            <Field label="Team logo">
              <ImageUpload tournamentId={tournamentId} prefix={`team-${team.id}`} currentUrl={team.logo_url} onSaved={(url) => setTeamLogo(tournamentId, team.id, url)} />
            </Field>
          ) : null}
          <DialogFooter>
            <Button type="submit" disabled={pending}>{pending ? "Saving…" : team ? "Save team" : "Add team"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
