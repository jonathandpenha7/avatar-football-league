import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/app/empty-state";
import { SearchX } from "lucide-react";

export default function NotFound() {
  return (
    <EmptyState
      icon={SearchX}
      title="Not found"
      description="This page does not exist, or you do not have access to it. Ask a tournament admin to invite you."
      action={<Button asChild variant="outline"><Link href="/tournaments">Back to tournaments</Link></Button>}
    />
  );
}
