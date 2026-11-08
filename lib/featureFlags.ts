"use client";

/**
 * DRAPEAUX DE DÉPLOIEMENT PROGRESSIF (Phase 2).
 *
 * Les gros chantiers de la phase 2 — lecture à la demande par écran, écritures
 * transactionnelles via `rpc()` — sont introduits DERRIÈRE un drapeau. Tant
 * qu'un drapeau est à `false`, l'application garde EXACTEMENT son comportement
 * actuel (miroir Zustand complet). Cela garantit :
 *   • aucun double chemin d'écriture (l'ancien miroir OU le nouveau RPC, jamais
 *     les deux pour la même opération) ;
 *   • un retour arrière immédiat (remettre le drapeau à `false`) sans redéploie-
 *     ment de schéma ;
 *   • une migration écran par écran, vérifiable, plutôt qu'une réécriture d'un
 *     seul bloc.
 *
 * Les valeurs se lisent dans les variables d'environnement `NEXT_PUBLIC_*` au
 * build. Par défaut TOUT est à `false` : le code livré ici ne change donc rien
 * au comportement de production tant que l'administrateur n'a pas activé un
 * drapeau ET appliqué le SQL correspondant.
 */

/**
 * Next.js only inlines NEXT_PUBLIC_* references that are statically written.
 * Dynamic process.env[name] lookups evaluate to undefined in browser bundles.
 * Flags stay OFF by default; never enable a migration without its UI, tests,
 * RLS and write-path integration being deployed together.
 */
function enabled(raw: string | undefined): boolean {
  return raw === "1" || raw === "true";
}

export const featureFlags = {
  /** Reading code exists, but the Students UI has NOT yet been migrated. */
  scopedStudentReads: enabled(process.env.NEXT_PUBLIC_FF_SCOPED_STUDENT_READS),
  /** Do not activate until an end-to-end transactional write path is wired. */
  atomicTuitionPayment: enabled(process.env.NEXT_PUBLIC_FF_ATOMIC_TUITION_PAYMENT),
  /** Do not activate until an end-to-end transactional write path is wired. */
  atomicPaymentReversal: enabled(process.env.NEXT_PUBLIC_FF_ATOMIC_PAYMENT_REVERSAL),
} as const;

export type FeatureFlag = keyof typeof featureFlags;

/** Lecture d'un drapeau par son nom (utile pour les tests et le code générique). */
export function isEnabled(flag: FeatureFlag): boolean {
  return featureFlags[flag];
}
