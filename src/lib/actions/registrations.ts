"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/data/session";
import { registrationSubmitSchema } from "@/lib/validation";
import type { ActionResult } from "@/lib/types";
import { UUID, dbError, invalid, ok, refreshTournament } from "./utils";

/** Public registration form submission (no account required). */
export async function submitRegistration(token: string, input: unknown): Promise<ActionResult> {
  if (!UUID.test(token)) return { ok: false, error: "This registration link is not valid." };
  const parsed = registrationSubmitSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const v = parsed.data;
  if (!v.email && !v.phone) return { ok: false, error: "Enter an email address or phone number." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_registration", {
    p_token: token,
    p: {
      ...v,
      preferred_team_id: v.preferred_team_id && UUID.test(v.preferred_team_id) ? v.preferred_team_id : null,
      jersey_number: v.jersey_number || null,
    },
  });
  if (error) return dbError(error);
  return ok(undefined, "Registration received. The organisers will review it.");
}

export async function approveRegistration(
  tournamentId: string,
  registrationId: string,
  teamId: string | null,
  note?: string,
): Promise<ActionResult> {
  if (!UUID.test(registrationId)) return { ok: false, error: "Invalid registration." };
  const { supabase } = await requireSession();
  const { error } = await supabase.rpc("approve_registration", {
    p_registration: registrationId,
    p_team: teamId && UUID.test(teamId) ? teamId : null,
    p_note: note?.trim() || null,
  });
  if (error) return dbError(error);
  refreshTournament(tournamentId);
  return ok(undefined, "Registration approved and player created.");
}

export async function rejectRegistration(tournamentId: string, registrationId: string, note: string): Promise<ActionResult> {
  const { supabase, profile } = await requireSession();
  const { error } = await supabase
    .from("registrations")
    .update({ status: "rejected", review_note: note.trim() || null, reviewed_by: profile.id, reviewed_at: new Date().toISOString() })
    .eq("id", registrationId)
    .eq("tournament_id", tournamentId)
    .eq("status", "pending");
  if (error) return dbError(error);
  refreshTournament(tournamentId);
  return ok(undefined, "Registration rejected.");
}

const paymentSchema = z.enum(["not_required", "unpaid", "pending_verification", "paid", "waived", "refunded"]);

/** Payment status is only ever changed by an organiser, never by the registrant's selection. */
export async function setRegistrationPayment(
  tournamentId: string,
  registrationId: string,
  status: string,
): Promise<ActionResult> {
  const s = paymentSchema.safeParse(status);
  if (!s.success) return { ok: false, error: "Unknown payment status." };
  const { supabase } = await requireSession();
  const { data: reg, error } = await supabase
    .from("registrations")
    .update({ payment_status: s.data })
    .eq("id", registrationId)
    .eq("tournament_id", tournamentId)
    .select("player_id")
    .single();
  if (error) return dbError(error);
  if (reg?.player_id) {
    const { error: pe } = await supabase.from("players").update({ payment_status: s.data }).eq("id", reg.player_id);
    if (pe) return dbError(pe);
  }
  refreshTournament(tournamentId);
  return ok(undefined, "Payment status updated.");
}
