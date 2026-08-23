import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge conditional class names, de-duping conflicting Tailwind utilities. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * ARRONDI MONÉTAIRE — À DEUX DÉCIMALES, JAMAIS À L'ENTIER.
 *
 * Le prix d'une séance ne tombe presque jamais juste : un mois à 4 000 DA sur 3
 * séances vaut 1 333,33 DA la séance, et un mois à 2 500 DA dont l'école garde
 * 1 000 laisse 1 500 DA à l'enseignant, soit 500 DA la séance sur 3 — mais
 * 375 DA sur 4. Arrondir à l'entier à chaque division faisait dériver la paie
 * de l'enseignant et le solde de l'élève de quelques dinars par séance, et
 * l'écart se voyait au bout d'un mois.
 *
 * Toute la monnaie de l'application passe donc par ici : deux décimales, ni
 * plus (le dinar n'a pas de millimes) ni moins.
 */
export function money(amount: number): number {
  const n = Number(amount);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/** `money()` mais jamais négatif — ce que la plupart des prix attendent. */
export function positiveMoney(amount: number): number {
  return Math.max(0, money(amount));
}

/**
 * Format an amount as Algerian Dinar, locale-aware.
 *
 * Les décimales ne s'affichent QUE lorsqu'il y en a : « 4 000 DA » reste
 * « 4 000 DA », et « 1 333,33 DA » garde sa virgule au lieu d'être arrondi à
 * 1 333 DA comme avant.
 */
export function formatDA(amount: number, locale: string = "fr"): string {
  const value = money(amount);
  const digits = Number.isInteger(value) ? 0 : 2;
  const formatted = new Intl.NumberFormat(locale === "ar" ? "ar-DZ" : "fr-DZ", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Math.abs(value));
  return value < 0 ? `-${formatted} DA` : `${formatted} DA`;
}

/** Le nombre seul, avec sa virgule et sans l'unité — pour les tableaux serrés. */
export function formatAmount(amount: number, locale: string = "fr"): string {
  const value = money(amount);
  const digits = Number.isInteger(value) ? 0 : 2;
  return new Intl.NumberFormat(locale === "ar" ? "ar-DZ" : "fr-DZ", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

import type { Day } from "@/lib/types";

const DAY_ORDER: Day[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

export function todayDayKey(d: Date = new Date()): Day {
  return DAY_ORDER[d.getDay()];
}

export function formatDate(dateStr: string, withTime = false): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleString("fr-DZ", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}
