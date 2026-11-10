"use server";

import { z } from "zod";
import { requireSession } from "@/lib/data/session";
import { ruleSchema } from "@/lib/validation";
import type { ActionResult } from "@/lib/types";
import { UUID, dbError, invalid, ok, refreshTournament } from "./utils";

export async function saveRule(tournamentId: string, ruleId: string | null, input: unknown): Promise<ActionResult> {
  const parsed = ruleSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { supabase, profile } = await requireSession();
  const row = { ...parsed.data, updated_by: profile.id };
  const { error } = ruleId
    ? await supabase.from("tournament_rules").update(row).eq("id", ruleId).eq("tournament_id", tournamentId)
    : await supabase.from("tournament_rules").insert({ ...row, tournament_id: tournamentId, sort_order: Date.now() % 1_000_000 });
  if (error) return dbError(error);
  refreshTournament(tournamentId);
  return ok(undefined, "Rule saved.");
}

export async function deleteRule(tournamentId: string, ruleId: string): Promise<ActionResult> {
  if (!UUID.test(ruleId)) return { ok: false, error: "Invalid rule." };
  const { supabase } = await requireSession();
  const { error } = await supabase.from("tournament_rules").delete().eq("id", ruleId).eq("tournament_id", tournamentId);
  if (error) return dbError(error);
  refreshTournament(tournamentId);
  return ok(undefined, "Rule deleted.");
}

export async function moveRule(tournamentId: string, ruleId: string, direction: "up" | "down"): Promise<ActionResult> {
  const { supabase } = await requireSession();
  const { data: rule } = await supabase.from("tournament_rules").select("id, category, sort_order").eq("id", ruleId).single();
  if (!rule) return { ok: false, error: "Rule not found." };
  const { data: siblings } = await supabase
    .from("tournament_rules")
    .select("id, sort_order")
    .eq("tournament_id", tournamentId)
    .eq("category", rule.category)
    .order("sort_order");
  const list = siblings ?? [];
  const i = list.findIndex((r) => r.id === ruleId);
  const j = direction === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= list.length) return ok();
  const a = await supabase.from("tournament_rules").update({ sort_order: list[j].sort_order }).eq("id", list[i].id);
  const b = await supabase.from("tournament_rules").update({ sort_order: list[i].sort_order }).eq("id", list[j].id);
  if (a.error || b.error) return dbError(a.error ?? b.error);
  refreshTournament(tournamentId);
  return ok();
}

const announcementSchema = z.object({
  title: z.string().trim().min(1).max(160),
  body: z.string().max(5000),
  is_published: z.boolean(),
});

export async function saveAnnouncement(tournamentId: string, input: unknown): Promise<ActionResult> {
  const parsed = announcementSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { supabase, profile } = await requireSession();
  const { error } = await supabase
    .from("tournament_announcements")
    .insert({ ...parsed.data, tournament_id: tournamentId, created_by: profile.id });
  if (error) return dbError(error);
  refreshTournament(tournamentId);
  return ok(undefined, "Announcement saved.");
}

export async function setAnnouncementPublished(tournamentId: string, id: string, published: boolean): Promise<ActionResult> {
  const { supabase } = await requireSession();
  const { error } = await supabase
    .from("tournament_announcements")
    .update({ is_published: published })
    .eq("id", id)
    .eq("tournament_id", tournamentId);
  if (error) return dbError(error);
  refreshTournament(tournamentId);
  return ok();
}

export async function deleteAnnouncement(tournamentId: string, id: string): Promise<ActionResult> {
  const { supabase } = await requireSession();
  const { error } = await supabase.from("tournament_announcements").delete().eq("id", id).eq("tournament_id", tournamentId);
  if (error) return dbError(error);
  refreshTournament(tournamentId);
  return ok(undefined, "Announcement deleted.");
}
