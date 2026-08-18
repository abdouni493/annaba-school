"use client";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Demo replacement for the storage upload: the picked file never leaves the
 * browser, it is simply exposed through an object URL that `<img src>` can
 * render. The URL lives as long as the tab does, which matches the lifetime of
 * the in-memory database it gets stored in.
 */
export async function uploadImage(_bucket: "logos" | "subjects", file: File): Promise<string> {
  if (file.size > MAX_BYTES) {
    throw new Error("Le fichier est trop volumineux (maximum 10 Mo).");
  }
  return URL.createObjectURL(file);
}
