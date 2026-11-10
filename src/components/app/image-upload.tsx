"use client";

import { useRef, useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import type { ActionResult } from "@/lib/types";

const MAX_BYTES = 2 * 1024 * 1024;

/**
 * Uploads an image to the tournament's folder in Supabase Storage (only
 * tournament admins may write there, enforced by storage policies), then
 * saves the public URL through a server action.
 */
export function ImageUpload({
  tournamentId,
  prefix,
  currentUrl,
  onSaved,
  label = "Upload logo",
}: {
  tournamentId: string;
  prefix: string;
  currentUrl: string | null;
  onSaved: (url: string | null) => Promise<ActionResult>;
  label?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function upload(file: File) {
    if (!file.type.startsWith("image/")) return toast.error("Choose an image file.");
    if (file.size > MAX_BYTES) return toast.error("Images must be 2 MB or smaller.");
    setBusy(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
      const path = `${tournamentId}/${prefix}-${Date.now()}.${ext}`;
      const supabase = createClient();
      const { error } = await supabase.storage.from("tournament-assets").upload(path, file, { upsert: false, contentType: file.type });
      if (error) throw new Error(error.message);
      const { data } = supabase.storage.from("tournament-assets").getPublicUrl(path);
      const res = await onSaved(data.publicUrl);
      if (!res.ok) throw new Error(res.error);
      toast.success("Image updated.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="flex items-center gap-3">
      {currentUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={currentUrl} alt="" className="size-14 rounded-lg object-cover ring-1 ring-border" />
      ) : (
        <div className="flex size-14 items-center justify-center rounded-lg border border-dashed text-muted-foreground">
          <ImagePlus className="size-5" />
        </div>
      )}
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? "Uploading…" : label}
      </Button>
      {currentUrl ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Remove image"
          disabled={busy}
          onClick={async () => {
            const res = await onSaved(null);
            if (res.ok) toast.success("Image removed.");
            else toast.error(res.error);
          }}
        >
          <Trash2 />
        </Button>
      ) : null}
    </div>
  );
}
