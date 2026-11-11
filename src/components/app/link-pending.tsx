"use client";

import { useLinkStatus } from "next/link";
import { cn } from "@/lib/utils";

/** Small pulsing dot shown inside a Link while its page is loading. Must be a child of <Link>. */
export function LinkPending({ className }: { className?: string }) {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden
      className={cn("size-1.5 rounded-full bg-primary transition-opacity", pending ? "animate-pulse opacity-100" : "opacity-0", className)}
    />
  );
}
