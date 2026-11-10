import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/domain";
import { RegistrationForm } from "./registration-form";

export const metadata: Metadata = { title: "Player registration" };

interface FormInfo {
  name: string;
  logo_url: string | null;
  venue: string | null;
  start_date: string | null;
  open: boolean;
  positions: string[];
  consent_text: string | null;
  requires_payment: boolean;
  fee_note: string | null;
  teams: { id: string; name: string }[];
}

export default async function RegisterPage(props: PageProps<"/register/[token]">) {
  const { token } = await props.params;
  const supabase = await createClient();
  const { data } = /^[0-9a-f-]{36}$/i.test(token) ? await supabase.rpc("get_registration_form", { p_token: token }) : { data: null };
  const info = data as FormInfo | null;
  return (
    <div className="min-h-svh bg-muted/30 px-4 py-10">
      <Card className="mx-auto w-full max-w-xl">
        <CardHeader>
          {info?.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={info.logo_url} alt="" className="mb-2 size-12 rounded-lg object-cover" />
          ) : null}
          <CardTitle className="text-xl">{info ? `Register for ${info.name}` : "Registration link not valid"}</CardTitle>
          {info ? <CardDescription>{[info.venue, info.start_date ? formatDate(info.start_date) : null].filter(Boolean).join(" · ")}</CardDescription> : null}
        </CardHeader>
        <CardContent>
          {!info ? (
            <p className="text-sm text-muted-foreground">Ask the organisers for the current registration link.</p>
          ) : !info.open ? (
            <p className="text-sm text-muted-foreground">Registration is closed. Contact the organisers if you still want to take part.</p>
          ) : (
            <RegistrationForm token={token} info={info} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
