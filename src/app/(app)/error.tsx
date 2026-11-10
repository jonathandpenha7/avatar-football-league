"use client";

import { CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/app/empty-state";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <EmptyState
      icon={CircleAlert}
      title="Something went wrong"
      description={error.message || "An unexpected error occurred while loading this page."}
      action={<Button onClick={reset}>Try again</Button>}
    />
  );
}
