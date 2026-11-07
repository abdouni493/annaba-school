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
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://vkdbinhvkswjoafcvhos.supabase.co";

export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZrZGJpbmh2a3N3am9hZmN2aG9zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQwNjM1MzMsImV4cCI6MjEwOTYzOTUzM30.rMYpkch45B-Lm3v0anv74BIq-82tus53DUZBf0tjJ8k";

let cached: SupabaseClient | null = null;

/**
 * LA CLÉ DE SESSION PORTE LE NOM DU PROJET.
 *
 * La session connectée est gardée dans le navigateur. Tant que la clé de
 * rangement était fixe, CHANGER DE PROJET Supabase était un piège : le jeton
 * émis par l'ANCIEN projet restait là, l'application l'affichait (« on ne voit
 * que les comptes »), mais chaque lecture de données partait vers le NOUVEAU
 * projet avec ce jeton étranger — refusé — et tous les écrans restaient vides.
 *
 * En suffixant la clé par la référence du projet, un jeton de l'ancien projet
 * n'est tout simplement plus trouvé : l'application se présente déconnectée, une
 * seule reconnexion suffit, et les données reviennent. Aucune manipulation du
 * navigateur n'est demandée à l'utilisateur.
 */
function projectRef(url: string): string {
  return /https?:\/\/([a-z0-9]+)\.supabase\.co/i.exec(url)?.[1] ?? "default";
}

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
      storageKey: `altech-school-auth-${projectRef(SUPABASE_URL)}`,
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
