"use server";

import { z } from "zod";
import { requireSession, getTournamentContext } from "@/lib/data/session";
import { assignGroups } from "@/lib/engine";
import { playerSchema, teamSchema } from "@/lib/validation";
import type { ActionResult } from "@/lib/types";
import { UUID, dbError, invalid, ok, refreshTournament } from "./utils";

export async function createTeam(tournamentId: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = teamSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { supabase } = await requireSession();
  const { data, error } = await supabase
    .from("teams")
    .insert({ ...parsed.data, tournament_id: tournamentId })
    .select("id")
    .single();
  if (error) return dbError(error);
  refreshTournament(tournamentId);
  return ok({ id: data.id as string }, "Team added.");
}

export async function updateTeam(tournamentId: string, teamId: string, input: unknown): Promise<ActionResult> {
  const parsed = teamSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { supabase } = await requireSession();
  const { error } = await supabase
    .from("teams")
    .update({ ...parsed.data, is_placeholder: false })
    .eq("id", teamId)
    .eq("tournament_id", tournamentId);
  if (error) return dbError(error);
  refreshTournament(tournamentId);
  return ok(undefined, "Team saved.");
}

export async function setTeamLogo(tournamentId: string, teamId: string, url: string | null): Promise<ActionResult> {
  if (url && !/^https:\/\//.test(url)) return { ok: false, error: "Invalid image URL." };
  const { supabase } = await requireSession();
  const { error } = await supabase.from("teams").update({ logo_url: url }).eq("id", teamId).eq("tournament_id", tournamentId);
  if (error) return dbError(error);
  refreshTournament(tournamentId);
  return ok();
}

export async function deleteTeam(tournamentId: string, teamId: string): Promise<ActionResult> {
  const { supabase } = await requireSession();
  const { count } = await supabase
    .from("players")
    .select("id", { count: "exact", head: true })
    .eq("team_id", teamId)
    .neq("registration_status", "withdrawn");
  if ((count ?? 0) > 0) return { ok: false, error: "Move or remove this team's players before deleting it." };
  const { error } = await supabase.from("teams").delete().eq("id", teamId).eq("tournament_id", tournamentId);
  if (error) return dbError(error);
  refreshTournament(tournamentId);
  return ok(undefined, "Team deleted.");
}

export async function autoAssignGroups(tournamentId: string): Promise<ActionResult> {
  const ctx = await getTournamentContext(tournamentId);
  if (!ctx.isAdmin) return { ok: false, error: "Only tournament admins can assign groups." };
  const groupCount = ctx.settings.group_count ?? 0;
  if (groupCount < 2) return { ok: false, error: "Set the number of groups in Settings first." };
  const { data: teams, error } = await ctx.supabase.from("teams").select("id, name, seed").eq("tournament_id", tournamentId);
  if (error) return dbError(error);
  const groups = assignGroups((teams ?? []) as { id: string; name: string; seed: number | null }[], groupCount);
  for (const [id, label] of groups) {
    const { error: e } = await ctx.supabase.from("teams").update({ group_label: label }).eq("id", id);
    if (e) return dbError(e);
  }
  refreshTournament(tournamentId);
  return ok(undefined, `Teams distributed across ${groupCount} groups by seed.`);
}

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

async function writeContact(
  supabase: Awaited<ReturnType<typeof requireSession>>["supabase"],
  tournamentId: string,
  playerId: string,
  email: string | null,
  phone: string | null,
) {
  if (!email && !phone) {
    return supabase.from("player_contacts").delete().eq("player_id", playerId);
  }
  return supabase
    .from("player_contacts")
    .upsert({ player_id: playerId, tournament_id: tournamentId, email, phone }, { onConflict: "player_id" });
}

async function duplicateNameWarning(
  supabase: Awaited<ReturnType<typeof requireSession>>["supabase"],
  tournamentId: string,
  name: string,
  excludeId?: string,
) {
  let q = supabase.from("players").select("id, full_name").eq("tournament_id", tournamentId).ilike("full_name", name.trim());
  if (excludeId) q = q.neq("id", excludeId);
  const { data } = await q;
  return (data ?? []).length > 0;
}

export async function createPlayer(
  tournamentId: string,
  input: unknown,
  options: { allowDuplicateName?: boolean } = {},
): Promise<ActionResult<{ id: string; duplicateName?: boolean }>> {
  const parsed = playerSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { supabase } = await requireSession();
  const { email, phone, ...player } = parsed.data;
  if (!options.allowDuplicateName && (await duplicateNameWarning(supabase, tournamentId, player.full_name))) {
    return {
      ok: false,
      error: `A player called "${player.full_name}" is already registered in this tournament. If this is a different person, confirm to add them anyway.`,
    };
  }
  const { data, error } = await supabase
    .from("players")
    .insert({ ...player, tournament_id: tournamentId, consent_at: player.consent_given ? new Date().toISOString() : null })
    .select("id")
    .single();
  if (error) return dbError(error);
  const contact = await writeContact(supabase, tournamentId, data.id, email, phone);
  if (contact.error) {
    await supabase.from("players").delete().eq("id", data.id);
    return dbError(contact.error);
  }
  refreshTournament(tournamentId);
  return ok({ id: data.id as string }, "Player added.");
}

export async function updatePlayer(tournamentId: string, playerId: string, input: unknown): Promise<ActionResult> {
  if (!UUID.test(playerId)) return { ok: false, error: "Invalid player." };
  const parsed = playerSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { supabase } = await requireSession();
  const { email, phone, ...player } = parsed.data;
  const { error } = await supabase
    .from("players")
    .update(player)
    .eq("id", playerId)
    .eq("tournament_id", tournamentId);
  if (error) return dbError(error);
  const contact = await writeContact(supabase, tournamentId, playerId, email, phone);
  if (contact.error) return dbError(contact.error);
  refreshTournament(tournamentId);
  return ok(undefined, "Player saved.");
}

export async function deletePlayer(tournamentId: string, playerId: string): Promise<ActionResult> {
  if (!UUID.test(playerId)) return { ok: false, error: "Invalid player." }; // also guards the .or() filter below
  const { supabase } = await requireSession();
  const { count } = await supabase
    .from("match_events")
    .select("id", { count: "exact", head: true })
    .or(`player_id.eq.${playerId},assist_player_id.eq.${playerId},related_player_id.eq.${playerId}`);
  if ((count ?? 0) > 0) {
    // Keep match history intact: withdraw instead of deleting.
    const { error } = await supabase
      .from("players")
      .update({ registration_status: "withdrawn", is_captain: false })
      .eq("id", playerId)
      .eq("tournament_id", tournamentId);
    if (error) return dbError(error);
    refreshTournament(tournamentId);
    return ok(undefined, "This player has match events, so they were marked as withdrawn instead of deleted.");
  }
  const { error } = await supabase.from("players").delete().eq("id", playerId).eq("tournament_id", tournamentId);
  if (error) return dbError(error);
  refreshTournament(tournamentId);
  return ok(undefined, "Player removed.");
}

export async function setCaptain(tournamentId: string, teamId: string, playerId: string): Promise<ActionResult> {
  const { supabase } = await requireSession();
  const clear = await supabase.from("players").update({ is_captain: false }).eq("team_id", teamId).eq("is_captain", true);
  if (clear.error) return dbError(clear.error);
  const { error } = await supabase
    .from("players")
    .update({ is_captain: true })
    .eq("id", playerId)
    .eq("team_id", teamId)
    .eq("tournament_id", tournamentId);
  if (error) return dbError(error);
  refreshTournament(tournamentId);
  return ok(undefined, "Captain updated.");
}

const importRow = z.object({
  full_name: z.string().trim().min(2).max(120),
  team: z.string().trim().max(80).optional().default(""),
  position: z.string().trim().max(40).optional().default(""),
  jersey_number: z.string().trim().regex(/^\d{0,3}$/).optional().default(""),
  email: z.union([z.string().trim().email(), z.literal("")]).optional().default(""),
  phone: z.string().trim().max(30).optional().default(""),
  captain: z.string().trim().optional().default(""),
});

export interface ImportSummary {
  created: number;
  createdTeams: string[];
  skipped: { row: number; name: string; reason: string }[];
}

/** Import players from parsed CSV rows. Each row is validated; problems are reported, not hidden. */
export async function importPlayers(
  tournamentId: string,
  rows: Record<string, string>[],
  options: { createMissingTeams: boolean },
): Promise<ActionResult<ImportSummary>> {
  if (!Array.isArray(rows) || rows.length === 0) return { ok: false, error: "The file has no rows." };
  if (rows.length > 1000) return { ok: false, error: "Import at most 1,000 players at a time." };
  const ctx = await getTournamentContext(tournamentId);
  if (!ctx.isAdmin) return { ok: false, error: "Only tournament admins can import players." };
  const { supabase } = ctx;

  const { data: teamRows } = await supabase.from("teams").select("id, name").eq("tournament_id", tournamentId);
  const teams = new Map((teamRows ?? []).map((t) => [String(t.name).trim().toLowerCase(), t.id as string]));
  const { data: existing } = await supabase.from("players").select("full_name").eq("tournament_id", tournamentId);
  const existingNames = new Set((existing ?? []).map((p) => String(p.full_name).trim().toLowerCase()));

  const summary: ImportSummary = { created: 0, createdTeams: [], skipped: [] };
  for (const [i, raw] of rows.entries()) {
    const normalised = Object.fromEntries(
      Object.entries(raw).map(([k, v]) => [k.trim().toLowerCase().replace(/[\s-]+/g, "_"), String(v ?? "")]),
    );
    const parsed = importRow.safeParse({
      full_name: normalised.full_name ?? normalised.name ?? "",
      team: normalised.team ?? normalised.team_name ?? "",
      position: normalised.position ?? normalised.preferred_position ?? "",
      jersey_number: normalised.jersey_number ?? normalised.jersey ?? normalised.number ?? "",
      email: normalised.email ?? "",
      phone: normalised.phone ?? normalised.mobile ?? "",
      captain: normalised.captain ?? "",
    });
    const name = normalised.full_name ?? normalised.name ?? "";
    if (!parsed.success) {
      summary.skipped.push({ row: i + 2, name, reason: parsed.error.issues[0]?.message ?? "Invalid row" });
      continue;
    }
    const r = parsed.data;
    if (existingNames.has(r.full_name.toLowerCase())) {
      summary.skipped.push({ row: i + 2, name: r.full_name, reason: "A player with this name already exists" });
      continue;
    }
    let teamId: string | null = null;
    if (r.team) {
      teamId = teams.get(r.team.toLowerCase()) ?? null;
      if (!teamId && options.createMissingTeams) {
        const { data: t, error } = await supabase
          .from("teams")
          .insert({ tournament_id: tournamentId, name: r.team })
          .select("id")
          .single();
        if (error) {
          summary.skipped.push({ row: i + 2, name: r.full_name, reason: dbError(error).error });
          continue;
        }
        teamId = t.id as string;
        teams.set(r.team.toLowerCase(), teamId);
        summary.createdTeams.push(r.team);
      } else if (!teamId) {
        summary.skipped.push({ row: i + 2, name: r.full_name, reason: `Team "${r.team}" does not exist` });
        continue;
      }
    }
    const position = r.position && ctx.settings.positions.includes(r.position) ? r.position : r.position ? "Other" : null;
    const { data: p, error } = await supabase
      .from("players")
      .insert({
        tournament_id: tournamentId,
        team_id: teamId,
        full_name: r.full_name,
        position,
        jersey_number: r.jersey_number ? Number(r.jersey_number) : null,
        is_captain: /^(y|yes|true|1)$/i.test(r.captain),
        registration_status: "confirmed",
      })
      .select("id")
      .single();
    if (error) {
      summary.skipped.push({ row: i + 2, name: r.full_name, reason: dbError(error).error });
      continue;
    }
    if (r.email || r.phone) {
      const c = await writeContact(supabase, tournamentId, p.id as string, r.email || null, r.phone || null);
      if (c.error) {
        await supabase.from("players").delete().eq("id", p.id);
        summary.skipped.push({ row: i + 2, name: r.full_name, reason: dbError(c.error).error });
        continue;
      }
    }
    existingNames.add(r.full_name.toLowerCase());
    summary.created++;
  }
  refreshTournament(tournamentId);
  return ok(summary);
}
