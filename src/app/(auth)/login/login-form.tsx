"use client";

import { useState } from "react";
import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Field } from "@/components/app/field";
import { useAction } from "@/hooks/use-action";
import { sendMagicLink, sendPasswordReset, signIn, signUp } from "@/lib/actions/auth";

export function LoginForm({ next, initialError }: { next: string; initialError?: string }) {
  const { pending, run } = useAction();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      {initialError ? (
        <Alert variant="destructive">
          <AlertDescription>{initialError}</AlertDescription>
        </Alert>
      ) : null}
      {notice ? (
        <Alert>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}
      <Tabs defaultValue="signin">
        <TabsList className="w-full">
          <TabsTrigger value="signin">Sign in</TabsTrigger>
          <TabsTrigger value="signup">Create account</TabsTrigger>
        </TabsList>
        <TabsContent value="signin">
          <form
            className="mt-4 grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => signIn({ email, password }, next));
            }}
          >
            <Field label="Email" htmlFor="email">
              <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Password" htmlFor="password">
              <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <Button type="submit" size="lg" disabled={pending}>
              {pending ? "Signing in…" : "Sign in"}
            </Button>
            <div className="flex items-center justify-between text-sm">
              <button
                type="button"
                className="text-muted-foreground underline-offset-4 hover:underline"
                onClick={() => run(() => sendPasswordReset(email), { onSuccess: () => setNotice("If an account exists, a password reset link has been sent.") })}
              >
                Forgot password?
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                onClick={() => run(() => sendMagicLink(email, next), { onSuccess: () => setNotice("Check your inbox for a sign-in link.") })}
              >
                <Mail className="size-3.5" /> Email me a link
              </button>
            </div>
          </form>
        </TabsContent>
        <TabsContent value="signup">
          <form
            className="mt-4 grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => signUp({ email, password, full_name: name }, next), {
                onSuccess: () => setNotice("Check your email to confirm your account, then sign in."),
              });
            }}
          >
            <Field label="Full name" htmlFor="name">
              <Input id="name" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Email" htmlFor="email2">
              <Input id="email2" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Password" htmlFor="password2" hint="At least 8 characters.">
              <Input id="password2" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <Button type="submit" size="lg" disabled={pending}>
              {pending ? "Creating account…" : "Create account"}
            </Button>
            <p className="text-xs text-muted-foreground">
              The first account created becomes the Super Admin. Other people get access when an organiser invites them.
            </p>
          </form>
        </TabsContent>
      </Tabs>
    </div>
  );
}
