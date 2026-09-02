"use client";

/**
 * CE QU'UN TRAVAILLEUR A GAGNÉ, ET CE QU'ON LUI DOIT ENCORE.
 *
 * L'écran des travailleurs devinait autrefois tout cela en relisant la
 * DESCRIPTION des mouvements de caisse. Les règlements sont désormais des
 * lignes à part entière (`workerPayments`), et ce fichier est le seul endroit
 * qui sait lire :
 *
 *   - quelles périodes restent dues, selon le contrat (mois, journée,
 *     demi-journée, heures pointées) ;
 *   - quels acomptes et quelles absences n'ont pas encore été retenus ;
 *   - ce qu'il faut donc verser.
 *
 * Il est partagé par la fiche du travailleur, l'écran de règlement et les
 * documents imprimés, pour qu'ils ne puissent pas se contredire.
 */

import type { Database } from "@/lib/store/data";
import type {
  ReceptionPaymentType,
  ReceptionStaff,
  WorkerAbsence,
  WorkerAcompte,
  WorkerPayment,
  WorkerShift,
} from "@/lib/types";
import { money } from "@/lib/utils";

export const WORKER_PAYMENT_LABELS: Record<ReceptionPaymentType, string> = {
  monthly: "Mensuel",
  daily: "Journalier",
  half_day: "Demi-journée",
  hourly: "Horaire",
};

export const WORKER_PAYMENT_UNITS: Record<ReceptionPaymentType, string> = {
  monthly: "mois",
  daily: "jour",
  half_day: "½ journée",
  hourly: "heure",
};

/**
 * Une liste de journées dues ne doit pas devenir un mur : un journalier
 * embauché il y a deux ans en aurait sept cents. Au-delà de cette limite, seules
 * les plus RÉCENTES sont proposées — ce sont celles qu'on règle.
 */
const MAX_PERIODS = 200;

export function workerName(worker: ReceptionStaff): string {
  return `${worker.firstName} ${worker.lastName}`.trim() || "Travailleur";
}

export function workerInitials(worker: ReceptionStaff): string {
  const a = worker.firstName.slice(0, 1).toUpperCase();
  const b = worker.lastName.slice(0, 1).toUpperCase();
  return `${a}${b}` || "?";
}

/** Le nom du métier, ou son identifiant quand la ligne a disparu. */
export function workerRoleName(db: Pick<Database, "workerRoles">, roleId?: string): string {
  if (!roleId) return "Sans métier";
  return db.workerRoles.find((r) => r.id === roleId)?.name ?? roleId;
}

/** Minutes -> « 7 h 30 ». */
export function formatHours(minutes: number): string {
  const sign = minutes < 0 ? "-" : "";
  const total = Math.abs(Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${sign}${h} h` : `${sign}${h} h ${String(m).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
//  Les retenues encore ouvertes
// ---------------------------------------------------------------------------

/** Les acomptes qui n'ont pas encore été retenus sur un règlement. */
export function openAcomptesOf(
  db: Pick<Database, "workerAcomptes">,
  workerId: string,
): WorkerAcompte[] {
  return acomptesOf(db, workerId).filter((a) => !a.paid);
}

/** Les absences qui n'ont pas encore été retenues sur un règlement. */
export function openAbsencesOf(
  db: Pick<Database, "workerAbsences">,
  workerId: string,
): WorkerAbsence[] {
  return absencesOf(db, workerId).filter((a) => !a.paid);
}

export function acomptesOf(
  db: Pick<Database, "workerAcomptes">,
  workerId: string,
): WorkerAcompte[] {
  return db.workerAcomptes
    .filter((a) => a.workerId === workerId)
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function absencesOf(
  db: Pick<Database, "workerAbsences">,
  workerId: string,
): WorkerAbsence[] {
  return db.workerAbsences
    .filter((a) => a.workerId === workerId)
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function paymentsOf(
  db: Pick<Database, "workerPayments">,
  workerId: string,
): WorkerPayment[] {
  return db.workerPayments
    .filter((p) => p.workerId === workerId)
    .sort((a, b) => b.date.localeCompare(a.date));
}

// ---------------------------------------------------------------------------
//  Les journées pointées (contrat horaire)
// ---------------------------------------------------------------------------

export function shiftsOf(db: Pick<Database, "workerShifts">, workerId: string): WorkerShift[] {
  return db.workerShifts
    .filter((s) => s.workerId === workerId)
    .sort((a, b) => b.workDate.localeCompare(a.workDate));
}

/** Journées complètes, non gelées, pas encore réglées — les seules payables. */
export function payableShiftsOf(
  db: Pick<Database, "workerShifts">,
  workerId: string,
): WorkerShift[] {
  return shiftsOf(db, workerId).filter((s) => !s.paid && !s.frozen && !!s.endAt);
}

/** Journées bloquées : l'arrivée a été badgée, jamais la sortie. */
export function frozenShiftsOf(
  db: Pick<Database, "workerShifts">,
  workerId: string,
): WorkerShift[] {
  return shiftsOf(db, workerId).filter((s) => s.frozen && !s.paid);
}

export function minutesOf(shifts: WorkerShift[]): number {
  return shifts.reduce((sum, s) => sum + s.minutes, 0);
}

export function hourlyDue(worker: ReceptionStaff, shifts: WorkerShift[]): number {
  return money((minutesOf(shifts) / 60) * (worker.hourlyRate ?? 0));
}

// ---------------------------------------------------------------------------
//  Les périodes dues
// ---------------------------------------------------------------------------

export interface WorkerPeriod {
  /** « 08/2026 » pour un mois, « 2026-08-14 » pour une journée */
  key: string;
  label: string;
  amount: number;
  /** contrat horaire : la journée pointée derrière la période */
  shift?: WorkerShift;
}

function monthKey(d: Date): string {
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

function dayKey(d: Date): string {
  return d.toLocaleDateString("fr-CA");
}

/** `Date.getDay()` (0 = dimanche) → la clé du jour telle que la fiche l'écrit. */
const WEEKDAY_KEYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

/**
 * CE JOUR-LÀ EST-IL UN JOUR TRAVAILLÉ ? — vrai quand la fiche n'a pas choisi de
 * jours (comportement d'avant : tous les jours), ou quand ce jour de la semaine
 * fait partie des jours de travail sélectionnés. Un jour de repos n'est donc
 * jamais compté comme une journée non payée.
 */
function isWorkingDay(worker: ReceptionStaff, d: Date): boolean {
  const days = worker.workDays;
  if (!days || days.length === 0) return true;
  return days.includes(WEEKDAY_KEYS[d.getDay()]);
}

/**
 * LES PÉRIODES QUE CE RÈGLEMENT A DÉJÀ SOLDÉES.
 *
 * Les règlements écrits depuis la mise à jour le disent eux-mêmes. Ceux d'AVANT
 * n'existaient que sous la forme d'un mouvement de caisse dont le LIBELLÉ
 * contenait le nom de famille et la période : ils sont relus ici aussi, sans
 * quoi tous les mois déjà payés repasseraient pour dus le jour de la mise à
 * jour. C'est une lecture de secours, et elle ne concerne que le passé.
 */
function settledKeys(db: Database, worker: ReceptionStaff): Set<string> {
  const keys = new Set<string>();
  for (const p of db.workerPayments) {
    if (p.workerId !== worker.id) continue;
    for (const k of p.periodKeys) keys.add(k);
  }
  return keys;
}

function legacySettled(db: Database, worker: ReceptionStaff, key: string): boolean {
  const name = worker.lastName.trim().toLowerCase();
  if (!name) return false;
  return db.cash.some(
    (c) =>
      c.type === "teacher_payment" &&
      c.description.toLowerCase().includes(name) &&
      c.description.includes(key),
  );
}

/**
 * Ce qu'on doit encore à ce travailleur, période par période.
 *
 * Le contrat décide de l'unité : un mois pour un mensuel, une journée pour un
 * journalier ou un demi-journalier, une journée POINTÉE pour un horaire (dont
 * le montant se calcule sur les minutes réellement travaillées).
 */
export function unpaidPeriodsOf(db: Database, worker: ReceptionStaff): WorkerPeriod[] {
  if (worker.paymentType === "hourly") {
    return payableShiftsOf(db, worker.id).map((s) => ({
      key: s.id,
      label: `${new Date(`${s.workDate}T12:00:00`).toLocaleDateString("fr-FR", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      })} — ${formatHours(s.minutes)}`,
      amount: money((s.minutes / 60) * (worker.hourlyRate ?? 0)),
      shift: s,
    }));
  }

  if (!worker.startDate) return [];
  const start = new Date(`${worker.startDate}T12:00:00`);
  if (isNaN(start.getTime())) return [];
  const today = new Date();
  const done = settledKeys(db, worker);
  const out: WorkerPeriod[] = [];

  if (worker.paymentType === "monthly") {
    const cursor = new Date(start.getFullYear(), start.getMonth(), 1, 12);
    while (cursor <= today && out.length < MAX_PERIODS) {
      const key = monthKey(cursor);
      if (!done.has(key) && !legacySettled(db, worker, key)) {
        out.push({
          key,
          label: cursor.toLocaleDateString("fr-FR", { month: "long", year: "numeric" }),
          amount: money(worker.salary),
        });
      }
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return out;
  }

  // Journalier / demi-journée : une ligne par JOUR TRAVAILLÉ depuis l'embauche.
  // Les jours de repos (hors des jours de travail choisis) ne sont pas des
  // journées dues — ils ne comptent tout simplement pas.
  const days: WorkerPeriod[] = [];
  const cursor = new Date(start);
  while (cursor <= today) {
    const key = dayKey(cursor);
    if (isWorkingDay(worker, cursor) && !done.has(key) && !legacySettled(db, worker, key)) {
      days.push({
        key,
        label: cursor.toLocaleDateString("fr-FR", {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
        }),
        amount: money(worker.salary),
      });
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  // Au-delà de la limite, on garde les plus RÉCENTES : ce sont celles qu'on règle.
  return days.length > MAX_PERIODS ? days.slice(days.length - MAX_PERIODS) : days;
}

/** Ce que ce travailleur coûte encore, tout compris. */
export interface WorkerBalance {
  periods: WorkerPeriod[];
  /** ce que les périodes dues valent */
  gross: number;
  openAcomptes: WorkerAcompte[];
  openAbsences: WorkerAbsence[];
  acomptesTotal: number;
  absencesTotal: number;
  /** brut − acomptes − absences, jamais négatif à l'affichage */
  net: number;
}

export function workerBalance(db: Database, worker: ReceptionStaff): WorkerBalance {
  const periods = unpaidPeriodsOf(db, worker);
  const openAcomptes = openAcomptesOf(db, worker.id);
  const openAbsences = openAbsencesOf(db, worker.id);
  const gross = money(periods.reduce((s, p) => s + p.amount, 0));
  const acomptesTotal = money(openAcomptes.reduce((s, a) => s + a.amount, 0));
  const absencesTotal = money(openAbsences.reduce((s, a) => s + a.cost, 0));
  return {
    periods,
    gross,
    openAcomptes,
    openAbsences,
    acomptesTotal,
    absencesTotal,
    net: money(gross - acomptesTotal - absencesTotal),
  };
}
