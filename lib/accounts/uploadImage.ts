"use client";

import { friendlyError, supabase } from "@/lib/supabase/client";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Uploads the school logo or a matière illustration to Supabase Storage and
 * returns its public URL — that URL is what gets stored on the row, so the
 * image survives a reload and is visible from every device.
 */
export async function uploadImage(bucket: "logos" | "subjects", file: File): Promise<string> {
  if (file.size > MAX_BYTES) {
    throw new Error("Le fichier est trop volumineux (maximum 10 Mo).");
  }

  const extension = file.name.split(".").pop()?.toLowerCase() || "png";
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;

  const { error } = await supabase()
    .storage.from(bucket)
    .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type });
  if (error) throw new Error(friendlyError(error));

  const { data } = supabase().storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}
