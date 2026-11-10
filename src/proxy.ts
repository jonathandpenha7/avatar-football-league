import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured, supabaseEnv } from "@/lib/supabase/env";

const PUBLIC_PREFIXES = ["/login", "/auth", "/t/", "/register/", "/invite/", "/setup"];

/** Refreshes the Supabase session cookie and protects organiser routes. */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (!isSupabaseConfigured()) {
    if (pathname === "/setup") return NextResponse.next();
    return NextResponse.redirect(new URL("/setup", request.url));
  }

  let response = NextResponse.next({ request });
  const { url, key } = supabaseEnv();
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const signedIn = !!data?.claims;
  const isPublic = pathname === "/" ? false : PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));

  if (!signedIn && !isPublic) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(login);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
