"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * The one Supabase connection of the app. Everything — auth, the 32 business
 * tables, the two storage buckets — goes through this single browser client.
 *
 * The project credentials ship as defaults so `npm run dev` works with no
 * setup; put them in `.env.local` to point the app at another project.
 */
export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://jehpfbupmhbnbbkzhiwr.supabase.co";

export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImplaHBmYnVwbWhibmJia3poaXdyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcwNzk5NzIsImV4cCI6MjEwMjY1NTk3Mn0.WkEp9gUnjPiztMPha5xUmvkP5lD17mt9eBXk9RrwBqI";

let cached: SupabaseClient | null = null;

/**
 * Lazily created singleton. Next.js renders modules on the server too, where
 * `localStorage` does not exist, so the client is only built on demand and the
 * session is persisted exclusively in the browser.
 */
export function supabase(): SupabaseClient {
  if (cached) return cached;
  cached = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: "altech-school-auth",
    },
  });
  return cached;
}

/** Turns a PostgREST / GoTrue failure into the message the forms already show. */
export function friendlyError(err: unknown): string {
  const raw =
    typeof err === "string"
      ? err
      : err && typeof err === "object" && "message" in err
        ? String((err as { message: unknown }).message)
        : "";

  if (/ADMIN_ALREADY_EXISTS/i.test(raw)) return "Un compte administrateur existe déjà.";
  if (/EMAIL_ALREADY_EXISTS|duplicate key|already registered/i.test(raw))
    return "Cet email est déjà utilisé par un autre compte.";
  if (/PASSWORD_TOO_SHORT/i.test(raw)) return "Le mot de passe doit contenir au moins 6 caractères.";
  if (/EMAIL_REQUIRED/i.test(raw)) return "L'email est obligatoire.";
  if (/INVALID_ROLE/i.test(raw)) return "Rôle invalide.";
  if (/NOT_ALLOWED|row-level security|permission denied/i.test(raw))
    return "Vous n'avez pas les droits nécessaires pour cette action.";
  if (/NO_ACCOUNT/i.test(raw))
    return "Cette fiche n'a pas de compte de connexion.";
  if (/Invalid login credentials/i.test(raw)) return "Identifiants invalides";
  if (/Failed to fetch|NetworkError/i.test(raw))
    return "Connexion à la base de données impossible. Vérifiez votre réseau.";
  return raw || "Une erreur est survenue.";
}
