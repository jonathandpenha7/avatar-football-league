"use client";

import { useState, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useAction } from "@/hooks/use-action";
import type { ActionResult } from "@/lib/types";

/**
 * Confirmation dialog for destructive or important actions. Optionally asks
 * for a reason (stored in the audit log) or for a typed confirmation phrase.
 */
export function ConfirmAction({
  trigger,
  title,
  description,
  confirmLabel = "Confirm",
  destructive,
  reason,
  typeToConfirm,
  action,
  onDone,
}: {
  trigger: ReactNode;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  reason?: { label: string; placeholder?: string; minLength?: number };
  typeToConfirm?: string;
  action: (reason: string) => Promise<ActionResult<unknown>>;
  onDone?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [typed, setTyped] = useState("");
  const { pending, run } = useAction();
  const reasonOk = !reason || text.trim().length >= (reason.minLength ?? 5);
  const typedOk = !typeToConfirm || typed === typeToConfirm;

  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setText("");
          setTyped("");
        }
      }}
    >
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? <AlertDialogDescription asChild><div className="space-y-2">{description}</div></AlertDialogDescription> : null}
        </AlertDialogHeader>
        {reason ? (
          <div className="grid gap-1.5">
            <Label htmlFor="confirm-reason">{reason.label}</Label>
            <Textarea id="confirm-reason" value={text} onChange={(e) => setText(e.target.value)} placeholder={reason.placeholder} rows={3} />
          </div>
        ) : null}
        {typeToConfirm ? (
          <div className="grid gap-1.5">
            <Label htmlFor="confirm-typed">
              Type <span className="font-semibold">{typeToConfirm}</span> to confirm
            </Label>
            <Input id="confirm-typed" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          </div>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant={destructive ? "destructive" : "default"}
            disabled={pending || !reasonOk || !typedOk}
            onClick={(e) => {
              e.preventDefault();
              run(() => action(text.trim()), {
                onSuccess: () => {
                  setOpen(false);
                  onDone?.();
                },
              });
            }}
          >
            {pending ? "Working…" : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
