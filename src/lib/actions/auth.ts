"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { siteUrl } from "@/lib/supabase/env";
import { requireSession } from "@/lib/data/session";
import type { ActionResult } from "@/lib/types";
import { invalid, ok } from "./utils";

const safeNext = (next: unknown) =>
  typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : "/";

const credentials = z.object({
  email: z.string().trim().email("Enter a valid email").transform((v) => v.toLowerCase()),
  password: z.string().min(8, "Use at least 8 characters").max(72),
});

export async function signIn(input: unknown, next?: string): Promise<ActionResult> {
  const parsed = credentials.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    return {
      ok: false,
      error: /confirm/i.test(error.message) ? "Confirm your email address first (check your inbox)." : "Email or password is incorrect.",
    };
  }
  revalidatePath("/", "layout");
  redirect(safeNext(next));
}

export async function signUp(input: unknown, next?: string): Promise<ActionResult> {
  const parsed = credentials.extend({ full_name: z.string().trim().min(2, "Enter your name").max(120) }).safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.full_name },
      emailRedirectTo: `${siteUrl()}/auth/callback?next=${encodeURIComponent(safeNext(next))}`,
    },
  });
  if (error) return { ok: false, error: error.message };
  if (data.session) {
    revalidatePath("/", "layout");
    redirect(safeNext(next));
  }
  return ok(undefined, "Check your email to confirm your account, then sign in.");
}

export async function sendMagicLink(email: string, next?: string): Promise<ActionResult> {
  const parsed = z.string().trim().email("Enter a valid email").safeParse(email);
  if (!parsed.success) return invalid(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.toLowerCase(),
    options: { emailRedirectTo: `${siteUrl()}/auth/callback?next=${encodeURIComponent(safeNext(next))}`, shouldCreateUser: true },
  });
  if (error) return { ok: false, error: error.message };
  return ok(undefined, "Check your email for a sign-in link.");
}

export async function sendPasswordReset(email: string): Promise<ActionResult> {
  const parsed = z.string().trim().email("Enter a valid email").safeParse(email);
  if (!parsed.success) return invalid(parsed.error);
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(parsed.data.toLowerCase(), {
    redirectTo: `${siteUrl()}/auth/callback?next=/account`,
  });
  // Same message whether or not the account exists.
  return ok(undefined, "If an account exists for that email, a reset link is on its way.");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}

export async function updateProfile(input: unknown): Promise<ActionResult> {
  const parsed = z.object({ full_name: z.string().trim().min(2).max(120) }).safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { supabase, profile } = await requireSession();
  const { error } = await supabase.from("profiles").update(parsed.data).eq("id", profile.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/", "layout");
  return ok(undefined, "Profile updated.");
}

export async function updatePassword(password: string): Promise<ActionResult> {
  const parsed = z.string().min(8, "Use at least 8 characters").max(72).safeParse(password);
  if (!parsed.success) return invalid(parsed.error);
  const { supabase } = await requireSession();
  const { error } = await supabase.auth.updateUser({ password: parsed.data });
  if (error) return { ok: false, error: error.message };
  return ok(undefined, "Password updated.");
}
