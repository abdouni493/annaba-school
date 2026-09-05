"use client";

/**
 * LES DOCUMENTS D'UNE SÉANCE LIBRE **SOLO**.
 *
 * Deux papiers, et ils ne disent pas la même chose :
 *
 *  · LA FICHE DE PAIE DE L'ENSEIGNANT — remise à l'enseignant. Elle nomme les
 *    élèves qu'il a eus, ce que chacun lui rapporte, le total qui lui revient
 *    et si cette part lui a déjà été versée. Elle ne dit JAMAIS ce que l'école
 *    garde : cela ne le regarde pas, et l'écran de la réception le montre déjà.
 *
 *  · LE BON D'UN ÉLÈVE — un par élève, à SON nom et pour SON prix. Six élèves
 *    sur la même séance, ce sont six bons imprimables séparément.
 */

import type { Language } from "@/lib/store/settings";
import type { Database } from "@/lib/store/data";
import type { SoloSeance, Teacher } from "@/lib/types";
import {
  bannerHtml,
  letterheadHtml,
  metaFooterHtml,
  printDocument,
  signaturesHtml,
} from "@/lib/printTemplates";
import { brandedTicketHtml } from "@/lib/reports/documents";
import { formatDateFr, receiptNumberOf, salleName, soloSeanceTotals } from "@/lib/helpers";

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Les décimales ne s'affichent QUE lorsqu'il y en a — « 437,50 DA » garde sa
 *  virgule au lieu d'être arrondi à 438 DA. */
const da = (n: number) => {
  const value = Math.round((Number(n) || 0) * 100) / 100;
  const digits = Number.isInteger(value) ? 0 : 2;
  return `${value.toLocaleString("fr-DZ", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} DA`;
};

/** La fiche de paie de l'enseignant pour UNE séance libre solo. */
export function soloSeancePayslipHtml(
  db: Database,
  opts: { seance: SoloSeance; teacher: Teacher; language: Language },
): string {
  const { seance, teacher, language } = opts;
  const t = soloSeanceTotals(seance);
  const room = seance.salleId ? salleName(db, seance.salleId) : "";

  const rows = t.attendees
    .map(
      (a, i) => `<tr>
        <td class="ctr">${i + 1}</td>
        <td><strong>${esc(a.name)}</strong></td>
        <td class="num">${da(t.teacherPerStudent)}</td>
      </tr>`,
    )
    .join("");

  const body = `
    ${letterheadHtml(db.school)}
    ${bannerHtml(
      "Fiche de paie — séance libre solo",
      `${esc(teacher.firstName)} ${esc(teacher.lastName)} — ${esc(formatDateFr(seance.date))}`,
    )}

    <div class="frame frame-info">
      <h3>La séance</h3>
      <table>
        <tbody>
          <tr><th style="width:34%">Intitulé</th><td><strong>${esc(seance.title)}</strong></td></tr>
          <tr><th>Date</th><td>${esc(formatDateFr(seance.date))}</td></tr>
          <tr><th>Horaire</th><td><span style="font-family:monospace">${esc(seance.startTime)} → ${esc(seance.endTime)}</span></td></tr>
          ${room ? `<tr><th>Salle</th><td>${esc(room)}</td></tr>` : ""}
          <tr><th>Enseignant</th><td><strong>${esc(teacher.firstName)} ${esc(teacher.lastName)}</strong>${teacher.phone ? ` — ${esc(teacher.phone)}` : ""}</td></tr>
          ${seance.description ? `<tr><th>Description</th><td>${esc(seance.description)}</td></tr>` : ""}
        </tbody>
      </table>
    </div>

    <div class="frame frame-success" style="margin-top:16px">
      <h3>Les élèves de la séance</h3>
      <table>
        <thead>
          <tr><th class="ctr" style="width:12%">N°</th><th>Élève</th><th class="num">Part enseignant</th></tr>
        </thead>
        <tbody>${rows || `<tr><td colspan="3" class="ctr">Aucun élève sur cette séance.</td></tr>`}</tbody>
      </table>
    </div>

    <div class="summary-card">
      <h3>Récapitulatif</h3>
      <div class="summary-line"><span>Élèves</span><strong>${t.students}</strong></div>
      <div class="summary-line"><span>Part de l'enseignant par élève</span><strong>${da(t.teacherPerStudent)}</strong></div>
      <div class="summary-line">
        <span>État du versement</span>
        <strong>${
          seance.teacherPaid
            ? `Versée${seance.teacherPaidAt ? ` le ${esc(formatDateFr(seance.teacherPaidAt))}` : ""}`
            : "À verser"
        }</strong>
      </div>
      <div class="net-pay-box"><span>Net à verser à l'enseignant</span><span>${da(t.teacherTotal)}</span></div>
    </div>

    ${signaturesHtml("La Direction", "L'Enseignant")}
    ${metaFooterHtml(db.school.name, language)}
  `;

  return printDocument({
    title: "Fiche de paie — séance libre solo",
    lang: language,
    bodyHtml: body,
  });
}

/** Le bon d'UN élève de la séance — un document par élève, jamais un pour tous. */
export function soloSeanceTicketHtml(
  db: Database,
  opts: {
    seance: SoloSeance;
    payer: string;
    registrationNumber?: string;
    language: Language;
  },
): string {
  const { seance, payer, language } = opts;
  const t = soloSeanceTotals(seance);
  const room = seance.salleId ? salleName(db, seance.salleId) : "";

  return brandedTicketHtml({
    school: db.school,
    language,
    docTitle: language === "ar" ? "وصل — حصة حرة فردية" : "Reçu — Séance libre solo",
    receiptNo: receiptNumberOf(db),
    name: payer,
    level: opts.registrationNumber ? `N° ${opts.registrationNumber}` : undefined,
    rows: [
      {
        label: seance.title,
        meta: [
          formatDateFr(seance.date),
          `${seance.startTime} - ${seance.endTime}`,
          room ? `Salle ${room}` : "",
        ]
          .filter(Boolean)
          .join(" · "),
        amount: t.pricePerStudent,
      },
    ],
    note: seance.description || undefined,
  });
}
