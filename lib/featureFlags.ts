"use client";

/** Legacy phase-2 switches. The paged /students directory is wired directly;
 * scopedStudentReads remains only for compatibility with existing settings.
 * Atomic writes remain OFF until their complete business transaction, offline
 * replay and mirror exclusion are implemented and validated against staging. */

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
  /** Legacy compatibility flag; /students directory uses scoped reads unconditionally. */
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
