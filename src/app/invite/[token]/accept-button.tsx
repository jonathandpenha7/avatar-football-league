"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useAction } from "@/hooks/use-action";
import { acceptInvitation } from "@/lib/actions/members";

export function AcceptButton({ token, accepted }: { token: string; accepted: boolean }) {
  const router = useRouter();
  const { pending, run } = useAction();
  return (
    <Button className="w-full" disabled={pending} onClick={() => run(() => acceptInvitation(token), { success: "Welcome aboard.", onSuccess: (d) => d && router.push(`/tournaments/${d.tournamentId}`) })}>
      {pending ? "Joining…" : accepted ? "Open tournament" : "Accept invitation"}
    </Button>
  );
}
