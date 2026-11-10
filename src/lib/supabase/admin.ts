import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabaseEnv } from "./env";

/**
 * Service-role client. Only used to send invitation emails through Supabase
 * Auth. It bypasses RLS, so it must never be used for data reads/writes on
 * behalf of a user.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!key) return null;
  return createClient(supabaseEnv().url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}
