"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

// The only new client component in the menu admin — everything else stays
// server-rendered. Uploads via the session-scoped browser client; RLS
// (is_restaurant_admin on the storage.foldername prefix) enforces the admin
// can only write under their own restaurantId folder, same authorization
// primitive as every other table in this app.
export function ImageUploadField({
  restaurantId,
  name = "image_url",
  defaultValue,
}: {
  restaurantId: string;
  name?: string;
  defaultValue?: string | null;
}) {
  const [url, setUrl] = useState(defaultValue ?? "");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File | undefined) {
    setError(null);
    if (!file) return;

    const ext = ALLOWED_TYPES[file.type];
    if (!ext) return setError("Only JPEG, PNG, or WebP images are allowed.");
    if (file.size > MAX_BYTES) return setError("Image must be 5MB or smaller.");

    setUploading(true);
    try {
      const supabase = createClient();
      const path = `${restaurantId}/${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from("menu-item-images").upload(path, file, { contentType: file.type });
      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from("menu-item-images").getPublicUrl(path);
      setUrl(data.publicUrl);
    } catch {
      setError("Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="col-span-2 flex items-center gap-3">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-12 w-12 rounded-md border border-neutral-200 object-cover" />
      ) : (
        <div className="h-12 w-12 rounded-md border border-dashed border-neutral-300" />
      )}
      <div className="flex-1">
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(e) => handleFile(e.target.files?.[0])}
          disabled={uploading}
          className="block w-full text-xs text-neutral-600"
        />
        {uploading && <p className="mt-1 text-xs text-neutral-400">Uploading…</p>}
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </div>
      <input type="hidden" name={name} value={url} />
    </div>
  );
}
