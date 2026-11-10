"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

/** Reads tokens from the URL fragment and stores the session. Returns an error message or null. */
async function completeFromFragment(): Promise<string | null> {
  const hash = new URLSearchParams(window.location.hash.slice(1));
  const nextParam = new URLSearchParams(window.location.search).get("next") ?? "/";
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/";
  if (hash.get("error_description")) return hash.get("error_description");
  const access_token = hash.get("access_token");
  const refresh_token = hash.get("refresh_token");
  if (!access_token || !refresh_token) return "This sign-in link is incomplete or has already been used. Request a new one.";
  const { error } = await createClient().auth.setSession({ access_token, refresh_token });
  if (error) return error.message;
  window.location.replace(next);
  return null;
}

/** Completes sign-ins whose tokens arrive in the URL fragment (Supabase default email links). */
export default function CompleteSignIn() {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    completeFromFragment().then(setError, (e: unknown) => setError(e instanceof Error ? e.message : "Sign-in failed."));
  }, []);
  return (
    <div className="flex min-h-svh items-center justify-center p-6 text-center">
      {error ? (
        <div className="space-y-3">
          <p className="text-sm text-destructive">{error}</p>
          <Link href="/login" className="text-sm text-primary underline-offset-4 hover:underline">Back to sign in</Link>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Signing you in…</p>
      )}
    </div>
  );
}
