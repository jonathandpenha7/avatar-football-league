import "server-only";
import { revalidatePath } from "next/cache";
import type { ZodError } from "zod";
import type { ActionResult } from "@/lib/types";

interface PgError {
  message: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
}

/** Translate database errors into messages an organiser can act on. */
export function dbError(error: PgError | null | undefined): { ok: false; error: string } {
  if (!error) return { ok: false, error: "Something went wrong." };
  const msg = error.message ?? "";
  if (error.code === "42501" || /row-level security|permission denied/i.test(msg)) {
    return { ok: false, error: /permission denied|row-level security/i.test(msg) ? "You do not have permission to do that." : msg };
  }
  if (error.code === "23505") {
    if (/teams_name_key/.test(msg)) return { ok: false, error: "A team with that name already exists in this tournament." };
    if (/jersey/.test(msg)) return { ok: false, error: "That jersey number is already taken in this team." };
    if (/one_captain/.test(msg)) return { ok: false, error: "This team already has a captain." };
    if (/player_contacts_email/.test(msg)) return { ok: false, error: "A player with that email is already registered in this tournament." };
    if (/player_contacts_phone/.test(msg)) return { ok: false, error: "A player with that phone number is already registered in this tournament." };
    if (/pitches_name/.test(msg)) return { ok: false, error: "A pitch with that name already exists." };
    if (/invitations_open_email/.test(msg)) return { ok: false, error: "There is already an open invitation for that email." };
    if (/tournament_members_tournament_id_user_id/.test(msg)) return { ok: false, error: "That person is already a member." };
    if (/fixtures_tournament_id_code/.test(msg)) return { ok: false, error: "Fixture codes must be unique." };
    return { ok: false, error: "That would create a duplicate record." };
  }
  if (error.code === "23503") {
    if (/fixtures_(home|away)_team_id_fkey/.test(msg)) {
      return { ok: false, error: "This team has fixtures. Remove or regenerate the fixtures before deleting the team." };
    }
    return { ok: false, error: "This record is still referenced elsewhere." };
  }
  if (error.code === "23514") return { ok: false, error: "One of the values is outside the allowed range." };
  if (error.code === "PGRST116") return { ok: false, error: "Record not found." };
  return { ok: false, error: msg || "Something went wrong." };
}

export function invalid(error: ZodError): { ok: false; error: string } {
  const first = error.issues[0];
  const field = first?.path?.join(".");
  return { ok: false, error: first ? (field ? `${field}: ${first.message}` : first.message) : "Invalid input." };
}

export function ok<T>(data?: T, message?: string): ActionResult<T> {
  return { ok: true, data, message };
}

/** Refresh every page of a tournament after a change. */
export function refreshTournament(tournamentId: string) {
  revalidatePath(`/tournaments/${tournamentId}`, "layout");
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
