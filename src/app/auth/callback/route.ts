import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Handles email confirmation, magic links, password recovery and invitation redirects. */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const nextParam = url.searchParams.get("next") ?? "/";
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/";
  const supabase = await createClient();

  let error: { message: string } | null = null;
  if (code) {
    ({ error } = await supabase.auth.exchangeCodeForSession(code));
  } else if (tokenHash && type) {
    ({ error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as "email" | "invite" | "recovery" | "magiclink" | "signup" }));
  } else {
    // Default Supabase emails (e.g. invitations) put the session in the URL fragment,
    // which never reaches the server. Browsers keep the fragment across redirects,
    // so a client page can finish the sign-in.
    return NextResponse.redirect(new URL(`/auth/complete?next=${encodeURIComponent(next)}`, url.origin));
  }
  if (error) {
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error.message)}`, url.origin));
  }
  return NextResponse.redirect(new URL(next, url.origin));
}
