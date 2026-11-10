/** Supabase configuration from environment variables. Never hard-code keys. */
export function supabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  return { url, key };
}

export function isSupabaseConfigured(): boolean {
  const { url, key } = supabaseEnv();
  return /^https?:\/\//.test(url) && key.length > 20;
}

export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
}
