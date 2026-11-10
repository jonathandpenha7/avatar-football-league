import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CircleAlert } from "lucide-react";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export const metadata: Metadata = { title: "Setup required" };
export const dynamic = "force-dynamic";

/** Shown when Supabase environment variables are missing. Never fakes a connection. */
export default function SetupPage() {
  if (isSupabaseConfigured()) redirect("/");
  return (
    <div className="mx-auto flex min-h-svh max-w-2xl flex-col justify-center gap-6 p-6">
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-full bg-warning/20 text-amber-700 dark:text-warning">
          <CircleAlert className="size-5" />
        </span>
        <h1 className="text-2xl font-semibold tracking-tight">Connect Supabase to continue</h1>
      </div>
      <p className="text-muted-foreground">
        The app is not connected to a database yet. Nothing is stored locally, so it cannot run without Supabase.
      </p>
      <ol className="list-decimal space-y-3 pl-5 text-sm">
        <li>Create a project at supabase.com (free tier is fine).</li>
        <li>
          Apply the migrations in <code className="rounded bg-muted px-1">supabase/migrations</code> (with the Supabase CLI: <code className="rounded bg-muted px-1">supabase db push</code>, or paste them into the SQL editor in order).
        </li>
        <li>
          Copy <code className="rounded bg-muted px-1">.env.example</code> to <code className="rounded bg-muted px-1">.env.local</code> and fill in <code className="rounded bg-muted px-1">NEXT_PUBLIC_SUPABASE_URL</code> and <code className="rounded bg-muted px-1">NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> from Project Settings, API.
        </li>
        <li>Restart the dev server and create the first account. It becomes the Super Admin.</li>
      </ol>
      <p className="text-sm text-muted-foreground">Full instructions are in README.md.</p>
    </div>
  );
}
