"use client";

/**
 * The printable paperwork the desk hands over: the bon d'inscription a new
 * student leaves with, the receipt of every solde recharge, the feuille de
 * présence of a group, and the small séance-libre invoice.
 *
 * All of them are plain HTML strings built on the shared blocks of
 * `lib/printTemplates.ts` and handed to `printHtmlDocument()`.
 */

import type { Language } from "@/lib/store/settings";
import type { Database } from "@/lib/store/data";
import type { AttendanceStatus, ScheduleSession, Student } from "@/lib/types";
import {
  bannerHtml,
  letterheadHtml,
  metaFooterHtml,
  printDocument,
  signaturesHtml,
} from "@/lib/printTemplates";
import {
  formatDateFr,
  groupName,
  monthCodeLabel,
  registrationNumberOf,
  salleName,
  sessionLabel,
  studentCaseLabel,
  studentName,
  teacherName,
} from "@/lib/helpers";

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const da = (n: number) => `${Math.round(n).toLocaleString("fr-DZ")} DA`;

/** Identity block reused by every student-facing document. */
function studentIdentityHtml(db: Database, student: Student): string {
  const caseLabel = studentCaseLabel(student);
  return `
    <div class="frame frame-info">
      <h3>Informations de l'élève</h3>
      <table>
        <tbody>
          <tr><th style="width:32%">N° d'inscription</th><td><strong style="font-family:monospace;font-size:1.15em">${esc(registrationNumberOf(db, student))}</strong></td></tr>
          <tr><th>Nom et prénom</th><td><strong>${esc(studentName(student))}</strong></td></tr>
          <tr><th>Date de naissance</th><td>${esc(formatDateFr(student.birthDate) || "-")}</td></tr>
          <tr><th>Téléphone</th><td>${esc(student.phone || "-")}</td></tr>
          <tr><th>E-mail</th><td>${esc(student.email || "-")}</td></tr>
          ${caseLabel ? `<tr><th>Cas de facturation</th><td><span class="badge badge-warning">${esc(caseLabel)}</span></td></tr>` : ""}
        </tbody>
      </table>
    </div>`;
}

// ---------------------------------------------------------------------------
// Bon d'inscription — printed right after a student is created.
// ---------------------------------------------------------------------------
export interface InscriptionLine {
  label: string;
  /** séances one month of that emploi contains */
  monthSeances: number;
  /** price of one séance */
  unitPrice: number;
  /** what the family handed over on that emploi (its opening solde) */
  sold: number;
  monthCode: string;
}

export function inscriptionVoucherHtml(
  db: Database,
  opts: { student: Student; lines: InscriptionLine[]; language: Language; registrationFee?: number },
): string {
  const { student, lines, language, registrationFee = 0 } = opts;
  const total = lines.reduce((s, l) => s + l.sold, 0);

  const rows = lines
    .map(
      (l) => `<tr>
        <td><strong>${esc(l.label)}</strong></td>
        <td class="ctr">${esc(l.monthCode)}</td>
        <td class="ctr">${l.monthSeances}</td>
        <td class="num">${da(l.unitPrice)}</td>
        <td class="num"><strong>${da(l.sold)}</strong></td>
      </tr>`,
    )
    .join("");

  const body = `
    ${letterheadHtml(db.school)}
    ${bannerHtml("Bon d'inscription", `${esc(studentName(student))} — N° ${esc(registrationNumberOf(db, student))}`)}
    ${studentIdentityHtml(db, student)}
    <div class="frame" style="margin-top:16px">
      <h3>Emplois du temps souscrits</h3>
      <table>
        <thead>
          <tr>
            <th>Emploi du temps</th>
            <th class="ctr">Mois</th>
            <th class="ctr">Séances / mois</th>
            <th class="num">Prix séance</th>
            <th class="num">Solde versé</th>
          </tr>
        </thead>
        <tbody>${rows || `<tr><td colspan="5" class="ctr">Aucun emploi du temps souscrit.</td></tr>`}</tbody>
      </table>
    </div>
    <div class="summary-card">
      <h3>Récapitulatif</h3>
      <div class="summary-line"><span>Emplois du temps souscrits</span><strong>${lines.length}</strong></div>
      ${registrationFee > 0 ? `<div class="summary-line"><span>Frais d'inscription</span><strong>${da(registrationFee)}</strong></div>` : ""}
      <div class="net-pay-box"><span>Total versé</span><span>${da(total)}</span></div>
    </div>
    ${signaturesHtml("La Direction", "Le Parent / L'Élève")}
    ${metaFooterHtml(db.school.name, language)}
  `;
  return printDocument({ title: "Bon d'inscription", lang: language, bodyHtml: body });
}

// ---------------------------------------------------------------------------
// Reçu de paiement — every solde recharge.
// ---------------------------------------------------------------------------
export interface SoldReceiptLine {
  label: string;
  monthCode: string;
  amount: number;
  /** solde of that emploi once the money is in */
  balanceAfter: number;
}

export function soldReceiptHtml(
  db: Database,
  opts: {
    student: Student;
    lines: SoldReceiptLine[];
    language: Language;
    title?: string;
    note?: string;
  },
): string {
  const { student, lines, language } = opts;
  const total = lines.reduce((s, l) => s + l.amount, 0);

  const rows = lines
    .map(
      (l) => `<tr>
        <td><strong>${esc(l.label)}</strong></td>
        <td class="ctr">${esc(monthCodeLabel(l.monthCode))}</td>
        <td class="num">${da(l.amount)}</td>
        <td class="num"><span class="badge ${l.balanceAfter < 0 ? "badge-danger" : "badge-success"}">${da(l.balanceAfter)}</span></td>
      </tr>`,
    )
    .join("");

  const body = `
    ${letterheadHtml(db.school)}
    ${bannerHtml(opts.title || "Reçu de paiement", `${esc(studentName(student))} — N° ${esc(registrationNumberOf(db, student))} — ${new Date().toLocaleDateString("fr-FR")}`)}
    <div class="frame frame-success">
      <h3>Détail du versement</h3>
      <table>
        <thead>
          <tr><th>Emploi du temps</th><th class="ctr">Mois</th><th class="num">Montant versé</th><th class="num">Nouveau solde</th></tr>
        </thead>
        <tbody>${rows || `<tr><td colspan="4" class="ctr">—</td></tr>`}</tbody>
      </table>
      ${opts.note ? `<p style="margin-top:10px;font-size:0.85em;color:#5c567a">${esc(opts.note)}</p>` : ""}
    </div>
    <div class="summary-card">
      <h3>Récapitulatif</h3>
      <div class="summary-line"><span>Élève</span><strong>${esc(studentName(student))}</strong></div>
      <div class="summary-line"><span>N° d'inscription</span><strong style="font-family:monospace">${esc(registrationNumberOf(db, student))}</strong></div>
      <div class="net-pay-box"><span>Total encaissé</span><span>${da(total)}</span></div>
    </div>
    ${signaturesHtml("La Direction", "Le Payeur")}
    ${metaFooterHtml(db.school.name, language)}
  `;
  return printDocument({ title: opts.title || "Reçu de paiement", lang: language, bodyHtml: body });
}

// ---------------------------------------------------------------------------
// Feuille de présence — the very table the sheet shows, minus its buttons.
// ---------------------------------------------------------------------------
export interface PresenceSheetRow {
  number: string;
  name: string;
  phone: string;
  /** one entry per séance of the month: the status, or null when untouched */
  slots: (AttendanceStatus | null)[];
  sold: number;
  caseLabel: string;
  previousDebt: number;
  otherDebt: number;
}

const SLOT_MARK: Record<AttendanceStatus, string> = {
  present: "P",
  late: "R",
  absent: "A",
  cancelled: "×",
};
const SLOT_CLASS: Record<AttendanceStatus, string> = {
  present: "badge-success",
  late: "badge-warning",
  absent: "badge-danger",
  cancelled: "badge-primary",
};

export function presenceSheetHtml(
  db: Database,
  opts: {
    session: ScheduleSession;
    monthCode: string;
    slotCount: number;
    rows: PresenceSheetRow[];
    date: string;
    language: Language;
  },
): string {
  const { session, monthCode, slotCount, rows, date, language } = opts;

  const head = Array.from({ length: slotCount }, (_, i) => `<th class="ctr">S${i + 1}</th>`).join("");
  const body = rows
    .map((r) => {
      const slots = Array.from({ length: slotCount }, (_, i) => {
        const st = r.slots[i];
        return st
          ? `<td class="ctr"><span class="badge ${SLOT_CLASS[st]}">${SLOT_MARK[st]}</span></td>`
          : `<td class="ctr">—</td>`;
      }).join("");
      return `<tr>
        <td class="ctr" style="font-family:monospace">${esc(r.number)}</td>
        <td><strong>${esc(r.name)}</strong>${r.caseLabel ? `<br/><span style="font-size:0.75em;color:#5c567a">${esc(r.caseLabel)}</span>` : ""}</td>
        <td>${esc(r.phone || "-")}</td>
        ${slots}
        <td class="num"><span class="badge ${r.sold < 0 ? "badge-danger" : r.sold === 0 ? "badge-warning" : "badge-success"}">${da(r.sold)}</span></td>
        <td class="num">${r.previousDebt > 0 ? `<span class="badge badge-danger">${da(r.previousDebt)}</span>` : "✔"}</td>
        <td class="num">${r.otherDebt > 0 ? `<span class="badge badge-warning">${da(r.otherDebt)}</span>` : "✔"}</td>
      </tr>`;
    })
    .join("");

  const title = session.title || sessionLabel(db, session, { withGroup: true });
  const html = `
    ${letterheadHtml(db.school)}
    ${bannerHtml("Feuille de présence", `${esc(title)} — ${esc(monthCodeLabel(monthCode))}`)}
    <div class="frame">
      <h3>
        Séance du ${esc(formatDateFr(date))} · ${esc(session.startTime)}–${esc(session.endTime)}
        · Groupe : ${esc(groupName(db, session.groupId))}
        · Salle : ${esc(salleName(db, session.salleId))}
        · Enseignant : ${esc(teacherName(db, session.teacherId))}
      </h3>
      <table>
        <thead>
          <tr>
            <th class="ctr">N°</th><th>Élève</th><th>Téléphone</th>
            ${head}
            <th class="num">Solde ${esc(monthCode)}</th>
            <th class="num">Mois préc.</th>
            <th class="num">Autres</th>
          </tr>
        </thead>
        <tbody>${body || `<tr><td colspan="${slotCount + 6}" class="ctr">Aucun élève inscrit.</td></tr>`}</tbody>
      </table>
      <p style="margin-top:10px;font-size:0.8em;color:#5c567a">
        Légende : <span class="badge badge-success">P</span> présent ·
        <span class="badge badge-warning">R</span> retard ·
        <span class="badge badge-danger">A</span> absent ·
        <span class="badge badge-primary">×</span> annulée · — non pointé
      </p>
    </div>
    ${signaturesHtml("La Direction", "L'Enseignant")}
    ${metaFooterHtml(db.school.name, language)}
  `;
  return printDocument({ title: "Feuille de présence", lang: language, bodyHtml: html });
}

// ---------------------------------------------------------------------------
// Séance libre — a small, streamlined invoice (half an A4).
// ---------------------------------------------------------------------------
export function seanceLibreInvoiceHtml(
  db: Database,
  opts: {
    payer: string;
    /** set when the payer is a registered student */
    registrationNumber?: string;
    itemLabel: string;
    price: number;
    date: string;
    time?: string;
    language: Language;
  },
): string {
  const { payer, itemLabel, price, date, time, language } = opts;
  const body = `
    <div class="ticket">
      <div class="ticket-head">
        <strong>${esc(db.school.name)}</strong>
        <span>${esc(db.school.address || "")}</span>
        <span>${esc(db.school.phone || "")}</span>
      </div>
      <h1>Reçu — Séance libre</h1>
      <div class="line"><span>Date</span><strong>${esc(formatDateFr(date))}${time ? ` · ${esc(time)}` : ""}</strong></div>
      <div class="line"><span>Élève</span><strong>${esc(payer)}</strong></div>
      ${opts.registrationNumber ? `<div class="line"><span>N° d'inscription</span><strong style="font-family:monospace">${esc(opts.registrationNumber)}</strong></div>` : ""}
      <div class="line"><span>Séance</span><strong>${esc(itemLabel)}</strong></div>
      <div class="total"><span>Total payé</span><span>${da(price)}</span></div>
      <p class="thanks">Merci et bonne séance.</p>
    </div>
  `;
  const css = `
    @page { size: A5; margin: 8mm; }
    body { padding: 0; background: #fff; }
    .ticket { max-width: 340px; margin: 0 auto; border: 1px solid #e8e6f4; border-radius: 12px; padding: 16px; background: #fff; }
    .ticket-head { display: flex; flex-direction: column; align-items: center; gap: 2px; text-align: center; border-bottom: 1px dashed #c0b6e9; padding-bottom: 10px; }
    .ticket-head strong { font-size: 1.1em; color: #7c3aed; }
    .ticket-head span { font-size: 0.75em; color: #5c567a; }
    .ticket h1 { font-size: 1em; text-align: center; text-transform: uppercase; letter-spacing: 0.5px; margin: 12px 0; color: #1e1b4b; }
    .line { display: flex; justify-content: space-between; gap: 10px; font-size: 0.85em; padding: 5px 0; border-bottom: 1px solid #f1f0fb; }
    .total { display: flex; justify-content: space-between; margin-top: 12px; padding: 10px; border-radius: 8px; background: #f0fdf4; border: 1px solid #22c55e; color: #15803d; font-weight: 800; }
    .thanks { text-align: center; font-size: 0.75em; color: #999; font-style: italic; margin-top: 12px; }
  `;
  return printDocument({
    title: "Reçu séance libre",
    lang: language,
    bodyHtml: body,
    extraCss: css,
  });
}
