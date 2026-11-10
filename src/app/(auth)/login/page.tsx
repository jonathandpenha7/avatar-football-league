import type { Metadata } from "next";
import { Trophy } from "lucide-react";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage(props: PageProps<"/login">) {
  const sp = await props.searchParams;
  const next = typeof sp.next === "string" ? sp.next : "/";
  const error = typeof sp.error === "string" ? sp.error : undefined;
  return (
    <div className="grid grid-cols-1 min-h-svh lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-primary text-primary-foreground lg:flex lg:flex-col lg:justify-between lg:p-10">
        <div className="flex items-center gap-2 font-semibold">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary-foreground/15">
            <Trophy className="size-4" />
          </span>
          Church Tournament Manager
        </div>
        <div className="relative z-10 max-w-md space-y-3">
          <h2 className="text-3xl font-semibold tracking-tight text-balance">Run match day from one place.</h2>
          <p className="text-primary-foreground/80">
            Fixtures, schedules across pitches, live scores, standings, knockouts and discipline, kept in sync on every organiser&apos;s device.
          </p>
        </div>
        <svg aria-hidden className="absolute -right-24 -bottom-24 size-[28rem] opacity-15" viewBox="0 0 200 200" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="10" y="30" width="180" height="140" rx="4" />
          <line x1="100" y1="30" x2="100" y2="170" />
          <circle cx="100" cy="100" r="22" />
          <rect x="10" y="70" width="28" height="60" />
          <rect x="162" y="70" width="28" height="60" />
        </svg>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6">
          <div className="space-y-1 text-center lg:text-left">
            <h1 className="text-2xl font-semibold tracking-tight">Welcome</h1>
            <p className="text-sm text-muted-foreground">Sign in to manage your tournaments.</p>
          </div>
          <LoginForm next={next} initialError={error} />
        </div>
      </div>
    </div>
  );
}
