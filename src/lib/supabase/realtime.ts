"use client";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Realtime only delivers rows the user may read (RLS). The browser client loads
 * the session from cookies asynchronously, so a channel joined too early is
 * anonymous and receives nothing for private tournaments. Always authorise the
 * realtime connection with the current session first.
 */
export async function authorizeRealtime(supabase: SupabaseClient) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (token) await supabase.realtime.setAuth(token);
  return !!token;
}
