"use client";

/**
 * LES PAPIERS D'UN TRAVAILLEUR — fiche de paie, reçu d'acompte, avis de
 * retenue pour absence.
 *
 * Ils sortent du MÊME générateur que le reçu de l'élève (`brandedTicketHtml`) :
 * même logo, même en-tête, même mise en page. Un travailleur et un parent
 * repartent avec le papier de la même école, et changer l'en-tête les change
 * tous d'un coup.
 */

import type { Language } from "@/lib/store/settings";
import type { Database } from "@/lib/store/data";
import type {
  ReceptionStaff,
  WorkerAbsence,
  WorkerAcompte,
  WorkerPayment,
} from "@/lib/types";
import { brandedTicketHtml, daTicket, type TicketSummaryLine } from "@/lib/reports/documents";
import { formatDateFr } from "@/lib/helpers";
import {
  WORKER_PAYMENT_LABELS,
  formatHours,
  workerName,
  workerRoleName,
} from "@/lib/workers";

const LABELS = {
  fr: {
    payslip: "Fiche de paie",
    acompte: "Reçu d'acompte",
    absence: "Avis de retenue",
    job: "Métier :",
    contract: "Contrat :",
    periods: "Périodes réglées",
    gross: "Total des périodes",
    acomptes: "Acomptes retenus",
    absences: "Absences retenues",
    net: "Net calculé",
    paid: "Montant versé",
    nothing: "Aucune période",
    motive: "Motif",
    hours: "Heures",
  },
  ar: {
    payslip: "وصل الأجرة",
    acompte: "وصل تسبيق",
    absence: "إشعار اقتطاع",
    job: "المهنة :",
    contract: "نوع العقد :",
    periods: "الفترات المسددة",
    gross: "مجموع الفترات",
    acomptes: "التسبيقات المقتطعة",
    absences: "الغيابات المقتطعة",
    net: "الصافي المحسوب",
    paid: "المبلغ المدفوع",
    nothing: "لا توجد فترة",
    motive: "السبب",
    hours: "الساعات",
  },
} as const;

/**
 * « 08/2026 » se lit mal sur un papier qu'on remet à quelqu'un.
 *
 * Une clé de mois redevient « août 2026 », une clé de jour une date complète.
 * Tout le reste — l'identifiant d'une journée pointée — est nommé par la
 * journée elle-même, plus haut.
 */
function periodLabel(key: string, lang: Language): string {
  const month = /^(\d{2})\/(\d{4})$/.exec(key);
  if (month) {
    return new Date(Number(month[2]), Number(month[1]) - 1, 1).toLocaleDateString(
      lang === "ar" ? "ar-DZ" : "fr-FR",
      { month: "long", year: "numeric" },
    );
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) return formatDateFr(key);
  return key;
}

/** Le numéro d'un papier de travailleur, dans sa propre série. */
function receiptNo(db: Database, id: string): string {
  const all = [
    ...db.workerPayments.map((p) => p.id),
    ...db.workerAcomptes.map((a) => a.id),
    ...db.workerAbsences.map((a) => a.id),
  ];
  const idx = all.indexOf(id);
  return String(Math.max(1, idx >= 0 ? idx + 1 : all.length + 1)).padStart(6, "0");
}

/** Le métier et le contrat, la ligne d'identité d'un travailleur. */
function levelOf(db: Database, worker: ReceptionStaff, lang: Language): string {
  const L = LABELS[lang];
  const job = workerRoleName(db, worker.role);
  const contract = WORKER_PAYMENT_LABELS[worker.paymentType];
  return `${job} — ${L.contract} ${contract}`;
}

// ---------------------------------------------------------------------------
//  La fiche de paie
// ---------------------------------------------------------------------------

/**
 * Ce que ce règlement a soldé, ce qui en a été retenu, et ce qui a été versé.
 *
 * Les périodes s'affichent telles que l'écran de règlement les nommait : « août
 * 2026 », « samedi 15 août 2026 », ou la journée pointée avec ses heures. Elles
 * sont recopiées ici plutôt que recalculées — un mois renommé, une journée
 * effacée, et le papier déjà remis dirait autre chose que ce qui a été payé.
 */
export function workerPayslipHtml(
  db: Database,
  opts: { worker: ReceptionStaff; payment: WorkerPayment; language: Language },
): string {
  const { worker, payment, language: lang } = opts;
  const L = LABELS[lang];

  const shiftById = new Map(db.workerShifts.map((s) => [s.id, s]));
  const unitAmount =
    payment.periodKeys.length > 0 ? payment.gross / payment.periodKeys.length : payment.gross;

  const rows = payment.periodKeys.map((key) => {
    const shift = shiftById.get(key);
    if (shift) {
      return {
        label: formatDateFr(shift.workDate),
        meta: `${L.hours} · ${formatHours(shift.minutes)}`,
        amount: (shift.minutes / 60) * (worker.hourlyRate ?? 0),
      };
    }
    return {
      label: periodLabel(key, lang),
      meta: key,
      amount: unitAmount,
    };
  });

  const summary: TicketSummaryLine[] = [
    { label: L.gross, value: daTicket(payment.gross, lang) },
  ];
  if (payment.acomptes > 0) {
    summary.push({
      label: L.acomptes,
      value: `- ${daTicket(payment.acomptes, lang)}`,
      tone: "danger",
    });
  }
  if (payment.absences > 0) {
    summary.push({
      label: L.absences,
      value: `- ${daTicket(payment.absences, lang)}`,
      tone: "danger",
    });
  }
  summary.push({ label: L.net, value: daTicket(payment.net, lang), tone: "muted" });
  summary.push({
    label: L.paid,
    value: daTicket(payment.amount, lang),
    tone: "success",
    strong: true,
  });

  return brandedTicketHtml({
    school: db.school,
    language: lang,
    docTitle: L.payslip,
    receiptNo: receiptNo(db, payment.id),
    name: workerName(worker),
    level: levelOf(db, worker, lang),
    date: payment.date,
    note: payment.description,
    itemsLabel: L.periods,
    // Une seule période tiendrait dans la mise en page « champ par champ », mais
    // une fiche de paie se lit en tableau : le récapitulatif chiffré n'a de sens
    // qu'au-dessous d'une liste.
    rows: rows.length > 0 ? rows : [{ label: L.nothing, meta: "—", amount: 0 }],
    summary,
  });
}

// ---------------------------------------------------------------------------
//  Le reçu d'acompte
// ---------------------------------------------------------------------------

export function workerAcompteReceiptHtml(
  db: Database,
  opts: { worker: ReceptionStaff; acompte: WorkerAcompte; language: Language },
): string {
  const { worker, acompte, language: lang } = opts;
  const L = LABELS[lang];

  return brandedTicketHtml({
    school: db.school,
    language: lang,
    docTitle: L.acompte,
    receiptNo: receiptNo(db, acompte.id),
    name: workerName(worker),
    level: levelOf(db, worker, lang),
    date: acompte.date,
    rows: [
      {
        label: acompte.description || L.acompte,
        meta: formatDateFr(acompte.date),
        amount: acompte.amount,
      },
    ],
    note: acompte.description,
  });
}

// ---------------------------------------------------------------------------
//  L'avis de retenue pour absence
// ---------------------------------------------------------------------------

export function workerAbsenceNoticeHtml(
  db: Database,
  opts: { worker: ReceptionStaff; absence: WorkerAbsence; language: Language },
): string {
  const { worker, absence, language: lang } = opts;
  const L = LABELS[lang];

  return brandedTicketHtml({
    school: db.school,
    language: lang,
    docTitle: L.absence,
    receiptNo: receiptNo(db, absence.id),
    name: workerName(worker),
    level: levelOf(db, worker, lang),
    date: absence.date,
    rows: [
      {
        label: absence.description || L.absence,
        meta: formatDateFr(absence.date),
        amount: absence.cost,
      },
    ],
    note: absence.description,
  });
}
