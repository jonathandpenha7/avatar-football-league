"use client";
import { createBrowserClient } from "@supabase/ssr";
import { supabaseEnv } from "./env";

let client: ReturnType<typeof createBrowserClient> | null = null;

/** Browser Supabase client (used for realtime subscriptions and uploads). */
export function createClient() {
  if (!client) {
    const { url, key } = supabaseEnv();
    client = createBrowserClient(url, key);
  }
  return client;
}
