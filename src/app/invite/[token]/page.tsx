import type { Metadata } from "next";
import Link from "next/link";
import { MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, type MemberRole } from "@/lib/permissions";
import { AcceptButton } from "./accept-button";

export const metadata: Metadata = { title: "Invitation" };

export default async function InvitePage(props: PageProps<"/invite/[token]">) {
  const { token } = await props.params;
  const supabase = await createClient();
  const valid = /^[0-9a-f-]{36}$/i.test(token);
  const { data } = valid ? await supabase.rpc("get_invitation", { p_token: token }) : { data: null };
  const inv = data as { tournament_name: string; role: MemberRole; email: string; expired: boolean; accepted: boolean; revoked: boolean } | null;
  const { data: { user } } = await supabase.auth.getUser();

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <MailCheck className="mb-2 size-6 text-primary" />
          <CardTitle>{inv ? `Join ${inv.tournament_name}` : "Invitation not found"}</CardTitle>
          {inv ? <CardDescription>You have been invited as {ROLE_LABELS[inv.role]}. {ROLE_DESCRIPTIONS[inv.role]}</CardDescription> : null}
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {!inv ? (
            <p className="text-muted-foreground">This link is not valid. Ask the organiser to send a new invitation.</p>
          ) : inv.revoked ? (
            <p className="text-muted-foreground">This invitation was revoked.</p>
          ) : inv.expired ? (
            <p className="text-muted-foreground">This invitation has expired. Ask the organiser for a new one.</p>
          ) : !user ? (
            <>
              <p>Sign in or create an account with <strong>{inv.email}</strong> to accept.</p>
              <Button asChild className="w-full"><Link href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}>Sign in to accept</Link></Button>
            </>
          ) : user.email?.toLowerCase() !== inv.email.toLowerCase() ? (
            <p className="text-destructive">You are signed in as {user.email}, but this invitation is for {inv.email}. Sign out and sign in with the invited address.</p>
          ) : (
            <AcceptButton token={token} accepted={inv.accepted} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
