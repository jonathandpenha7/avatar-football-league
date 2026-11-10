"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/lib/types";

/**
 * Run a server action with a pending state and toast feedback.
 * Returns the result so callers can react (close dialogs, reset forms).
 */
export function useAction() {
  const [pending, startTransition] = useTransition();
  function run<T>(
    action: () => Promise<ActionResult<T>>,
    options: { success?: string; onSuccess?: (data: T | undefined) => void; onError?: (error: string) => void } = {},
  ) {
    return new Promise<ActionResult<T>>((resolve) => {
      startTransition(async () => {
        try {
          const result = await action();
          if (result.ok) {
            const msg = options.success ?? result.message;
            if (msg) toast.success(msg);
            options.onSuccess?.(result.data);
          } else {
            toast.error(result.error);
            options.onError?.(result.error);
          }
          resolve(result);
        } catch (e) {
          // redirect() inside a server action throws a special error that Next handles.
          if (e && typeof e === "object" && "digest" in e && String((e as { digest: string }).digest).startsWith("NEXT_REDIRECT")) {
            throw e;
          }
          const message = e instanceof Error ? e.message : "Something went wrong.";
          toast.error(message);
          resolve({ ok: false, error: message });
        }
      });
    });
  }
  return { pending, run };
}
