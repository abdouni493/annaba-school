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
import type { AttendanceStatus, Payment, School, ScheduleSession, Student } from "@/lib/types";
import {
  bannerHtml,
  letterheadHtml,
  metaFooterHtml,
  printDocument,
  signaturesHtml,
} from "@/lib/printTemplates";
import {
  enrollmentLabel,
  formatDateFr,
  groupName,
  monthCodeLabel,
  receiptNumberOf,
  registrationNumberOf,
  salleName,
  sessionLabel,
  studentCaseLabel,
  studentChargeDebt,
  studentLevelLabel,
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
// LE REÇU DE PAIEMENT DE L'ÉLÈVE — le petit ticket "وصل دفع" remis à la
// famille à chaque encaissement (rechargement de solde, règlement de frais,
// séance libre). Un seul générateur visuel (`brandedTicketHtml`) habille les
// trois documents : même logo, mêmes couleurs, même reçu numéroté — seul le
// contenu des lignes change d'un cas à l'autre.
// ---------------------------------------------------------------------------
const TICKET_LABELS = {
  fr: {
    docTitle: "Reçu de Paiement",
    receiptNo: "N° de reçu :",
    name: "Nom et prénom :",
    level: "Niveau :",
    group: "Emploi du temps :",
    date: "Date :",
    amount: "Montant :",
    month: "Mois :",
    note: "Remarque :",
    items: "Désignation",
    itemsDate: "Mois / Date",
    total: "Total",
    thanks: "Merci pour votre confiance",
    disclaimer: "Ce reçu ne constitue pas une pièce justificative de remboursement.",
    da: "DA",
  },
  ar: {
    docTitle: "وصل دفع",
    receiptNo: "رقم الوصل :",
    name: "الاسم واللقب :",
    level: "المستوى :",
    group: "المجموعة :",
    date: "التاريخ :",
    amount: "المبلغ :",
    month: "الشهر :",
    note: "الملاحظة :",
    items: "البيان",
    itemsDate: "الشهر / التاريخ",
    total: "المجموع",
    thanks: "شكرا على ثقتكم",
    disclaimer: "هذا الوصل لا يعتبر سندا لاسترجاع المبلغ",
    da: "دج",
  },
} as const;

/** Amounts on the branded ticket read "4.000 دج" — dot-grouped, currency
 *  spelled per language — the convention printed on the sample template. */
export function daTicket(n: number, lang: Language): string {
  const value = Math.round((Number(n) || 0) * 100) / 100;
  const digits = Number.isInteger(value) ? 0 : 2;
  const grouped = Math.abs(value).toLocaleString("de-DE", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return `${value < 0 ? "-" : ""}${grouped} ${TICKET_LABELS[lang].da}`;
}

export const TICKET_CSS = `
  @page { size: A5; margin: 8mm; }
  body { padding: 14px 0; background: #f6ecf1; }
  .rcpt { max-width: 380px; margin: 0 auto; background: #fff; border: 1px solid #efd9e3; border-radius: 16px 16px 0 0; padding: 20px 22px 6px; }
  .rcpt-head { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 2px; }
  .rcpt-logo, .rcpt-logo-fallback { width: 78px; height: 78px; border-radius: 50%; object-fit: cover; border: 3px solid #fbe4ee; margin-bottom: 6px; }
  .rcpt-logo-fallback { background: #7a1440; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 2em; }
  .rcpt-desc { font-size: 0.72em; color: #7a1440; font-weight: 700; }
  .rcpt-name { font-size: 1.4em; font-weight: 800; color: #7a1440; letter-spacing: 0.3px; margin: 1px 0; }
  .rcpt-contact { display: flex; gap: 12px; flex-wrap: wrap; justify-content: center; font-size: 0.72em; color: #4a4453; }
  .rcpt-sep { border-top: 1px dashed #d9c3cf; margin: 12px 0; }
  .rcpt-title-box { margin: 0 auto; width: fit-content; border: 1.5px solid #1e1b2e; border-radius: 10px; padding: 5px 26px; font-weight: 800; font-size: 1.05em; text-align: center; color: #1e1b2e; }
  .rcpt-no { text-align: center; font-size: 0.85em; margin-top: 9px; color: #3a3444; }
  .rcpt-no strong { font-family: monospace; font-size: 1.15em; color: #7a1440; letter-spacing: 1.5px; }
  .rcpt-fields { display: flex; flex-direction: column; gap: 9px; margin-top: 2px; }
  .field { display: flex; justify-content: center; align-items: baseline; gap: 10px; font-size: 0.86em; text-align: center; }
  .field-label { font-weight: 700; color: #3a3444; white-space: nowrap; }
  .field-value { color: #1e1b2e; font-weight: 600; }
  .field-value.muted { color: #a79fae; font-weight: 400; }
  .field-amount .field-value { font-size: 1.2em; font-weight: 800; color: #15803d; }
  .field-value.danger { color: #b91c1c; font-weight: 800; }
  .field-value.success { color: #15803d; font-weight: 800; }
  .rcpt-table { width: 100%; border-collapse: collapse; margin-top: 4px; font-size: 0.8em; }
  .rcpt-table th { background: #fbe4ee; color: #7a1440; font-weight: 700; padding: 6px; text-align: center; }
  .rcpt-table td { padding: 6px; border-bottom: 1px solid #f4e9ee; text-align: center; }
  .rcpt-table td.num { text-align: end; font-family: monospace; font-weight: 700; }
  .rcpt-table tfoot td { border-top: 2px solid #7a1440; font-weight: 800; color: #7a1440; border-bottom: none; }
  .rcpt-summary { display: flex; flex-direction: column; gap: 6px; }
  .rcpt-summary-line { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; font-size: 0.84em; color: #3a3444; }
  .rcpt-summary-line strong { font-family: monospace; font-weight: 800; color: #1e1b2e; }
  .rcpt-summary-line strong.danger { color: #b91c1c; }
  .rcpt-summary-line strong.success { color: #15803d; }
  .rcpt-summary-line strong.muted { color: #a79fae; font-weight: 600; }
  .rcpt-summary-line.strong { border-top: 2px solid #7a1440; margin-top: 4px; padding-top: 8px; font-size: 0.98em; font-weight: 800; color: #7a1440; }
  .rcpt-summary-line.strong strong { font-size: 1.15em; }
  .rcpt-thanks { text-align: center; font-weight: 700; color: #7a1440; font-size: 0.95em; margin-top: 8px; }
  .rcpt-disclaimer { text-align: center; font-size: 0.68em; color: #8c8594; font-style: italic; margin: 4px 0 10px; }
  .rcpt-torn { height: 12px; background-image: linear-gradient(135deg, transparent 50%, #f6ecf1 50%), linear-gradient(45deg, #f6ecf1 50%, transparent 50%); background-size: 16px 16px; background-position: top left, top right; background-repeat: repeat-x; }
`;

export interface TicketRow {
  label: string;
  meta?: string;
  amount: number;
  extraLabel?: string;
  extra?: string;
  extraTone?: "success" | "danger" | "muted";
}

/** Une ligne « libellé — valeur » du récapitulatif, sous le tableau. */
export interface TicketSummaryLine {
  label: string;
  value: string;
  tone?: "success" | "danger" | "muted";
  /** la ligne du bas, celle qu'on lit en premier */
  strong?: boolean;
}

/**
 * LE MODÈLE PAPIER DE L'ÉCOLE — le seul générateur visuel des reçus.
 *
 * Reçu de solde, reçu de frais, acompte d'un travailleur, fiche de paie d'un
 * travailleur : tous sortent d'ici, donc tous se ressemblent, et changer le
 * logo ou l'en-tête les change tous d'un coup.
 */
export function brandedTicketHtml(opts: {
  school: School;
  language: Language;
  docTitle?: string;
  receiptNo: string;
  name: string;
  level?: string;
  date?: string;
  rows: TicketRow[];
  note?: string;
  /** le récapitulatif chiffré, quand le document en demande un */
  summary?: TicketSummaryLine[];
  /** le titre du tableau des lignes, quand « Désignation » ne suffit pas */
  itemsLabel?: string;
}): string {
  const { school, language: lang, rows } = opts;
  const L = TICKET_LABELS[lang];
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const single = rows.length <= 1 ? rows[0] : undefined;

  const logo = school.logo
    ? `<img src="${esc(school.logo)}" alt="logo" class="rcpt-logo" />`
    : `<div class="rcpt-logo-fallback">🎓</div>`;

  const extraToneClass = (t?: TicketRow["extraTone"]) =>
    t === "danger" ? "danger" : t === "muted" ? "muted" : "success";

  const fieldsHtml = single
    ? `
      <div class="field"><span class="field-label">${L.group}</span><span class="field-value">${esc(single.label)}</span></div>
      ${single.meta ? `<div class="field"><span class="field-label">${L.month}</span><span class="field-value">${esc(single.meta)}</span></div>` : ""}
      <div class="field field-amount"><span class="field-label">${L.amount}</span><span class="field-value">${daTicket(single.amount, lang)}</span></div>
      ${
        single.extra
          ? `<div class="field"><span class="field-label">${esc(single.extraLabel ?? "")}</span><span class="field-value ${extraToneClass(single.extraTone)}">${esc(single.extra)}</span></div>`
          : ""
      }
    `
    : `
      <table class="rcpt-table">
        <thead><tr><th>${esc(opts.itemsLabel ?? L.items)}</th><th>${L.itemsDate}</th><th>${L.amount.replace(" :", "")}</th></tr></thead>
        <tbody>
          ${rows
            .map(
              (r) => `<tr>
                <td>${esc(r.label)}</td>
                <td>${esc(r.meta ?? "—")}</td>
                <td class="num">${daTicket(r.amount, lang)}</td>
              </tr>`,
            )
            .join("")}
        </tbody>
        <tfoot><tr><td colspan="2">${L.total}</td><td class="num">${daTicket(total, lang)}</td></tr></tfoot>
      </table>
    `;

  const summaryHtml = opts.summary?.length
    ? `<div class="rcpt-sep"></div>
       <div class="rcpt-summary">
         ${opts.summary
           .map(
             (line) => `<div class="rcpt-summary-line${line.strong ? " strong" : ""}">
               <span>${esc(line.label)}</span>
               <strong class="${extraToneClass(line.tone)}">${esc(line.value)}</strong>
             </div>`,
           )
           .join("")}
       </div>`
    : "";

  const body = `
    <div class="rcpt">
      <div class="rcpt-head">
        ${logo}
        ${school.description ? `<div class="rcpt-desc">${esc(school.description)}</div>` : ""}
        <div class="rcpt-name">${esc(school.name)}</div>
        <div class="rcpt-contact">
          ${school.address ? `<span>📍 ${esc(school.address)}</span>` : ""}
          ${school.phone ? `<span>📞 ${esc(school.phone)}</span>` : ""}
        </div>
      </div>
      <div class="rcpt-sep"></div>
      <div class="rcpt-title-box">${esc(opts.docTitle || L.docTitle)}</div>
      <div class="rcpt-no">${L.receiptNo} <strong>${esc(opts.receiptNo)}</strong></div>
      <div class="rcpt-sep"></div>
      <div class="rcpt-fields">
        <div class="field"><span class="field-label">${L.name}</span><span class="field-value">${esc(opts.name)}</span></div>
        ${opts.level ? `<div class="field"><span class="field-label">${L.level}</span><span class="field-value">${esc(opts.level)}</span></div>` : ""}
        ${opts.date ? `<div class="field"><span class="field-label">${L.date}</span><span class="field-value">${esc(formatDateFr(opts.date))}</span></div>` : ""}
        ${fieldsHtml}
        <div class="field"><span class="field-label">${L.note}</span><span class="field-value ${opts.note ? "" : "muted"}">${esc(opts.note || "—")}</span></div>
      </div>
      ${summaryHtml}
      <div class="rcpt-sep"></div>
      <div class="rcpt-thanks">★ ${L.thanks} ★</div>
      <div class="rcpt-disclaimer">${L.disclaimer}</div>
    </div>
    <div class="rcpt-torn"></div>
  `;

  return printDocument({
    title: opts.docTitle || L.docTitle,
    lang,
    bodyHtml: body,
    extraCss: TICKET_CSS,
  });
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
    /**
     * NE PAS AFFICHER LE SOLDE OBTENU.
     *
     * Au guichet, la famille repart en sachant le nouveau solde de l'emploi.
     * Mais quand on RÉIMPRIME un vieux versement (l'historique, la cloche du
     * tableau de bord), ce solde-là n'est plus celui du jour du versement : le
     * reçu ne doit alors dire qu'une chose sûre — CE QUE L'ÉLÈVE A VERSÉ ce
     * jour-là. On masque donc la colonne « Nouveau solde ».
     */
    hideBalance?: boolean;
  },
): string {
  const { student, lines, language, hideBalance } = opts;
  const extraLabel = language === "ar" ? "الرصيد الجديد :" : "Nouveau solde :";

  return brandedTicketHtml({
    school: db.school,
    language,
    docTitle: opts.title,
    receiptNo: receiptNumberOf(db),
    name: studentName(student),
    level: studentLevelLabel(db, student),
    date: new Date().toISOString().slice(0, 10),
    note: opts.note,
    rows: lines.map((l) => ({
      label: l.label,
      meta: monthCodeLabel(l.monthCode),
      amount: l.amount,
      ...(hideBalance
        ? {}
        : {
            extraLabel,
            extra: daTicket(l.balanceAfter, language),
            extraTone: l.balanceAfter < 0 ? "danger" : "success",
          }),
    })),
  });
}

// ---------------------------------------------------------------------------
// Reçu de règlement de FRAIS — un livre, une tenue, une sortie, ou la dette que
// l'école avait avancée. Il se lit comme le reçu de solde, à ceci près que la
// dernière colonne ne dit pas un solde mais CE QUI RESTE DÛ sur ce frais-là :
// la famille repart en sachant si elle a fini de payer.
// ---------------------------------------------------------------------------
export interface ChargeReceiptLine {
  /** le nom du frais, tel que la réception l'a tapé */
  label: string;
  /** le jour où le frais est né */
  date: string;
  /** ce que le frais coûte en entier */
  total: number;
  /** ce qui vient d'être versé */
  amount: number;
  /** ce qu'il reste dû dessus, l'encaissement fait */
  remaining: number;
}

export function chargeReceiptHtml(
  db: Database,
  opts: {
    student: Student;
    lines: ChargeReceiptLine[];
    language: Language;
    title?: string;
    note?: string;
    /** ce que l'élève doit ENCORE sur TOUS ses frais, celui-ci compris */
    restAfter?: number;
    /** réimpression : ne dire que ce qui a été versé, pas ce qui reste dû */
    hideRemaining?: boolean;
  },
): string {
  const { student, lines, language, hideRemaining } = opts;
  const extraLabel = language === "ar" ? "الباقي على هذا الفرض :" : "Reste sur ce frais :";
  const soldeLabel = language === "ar" ? "مسدد بالكامل" : "Soldé";

  return brandedTicketHtml({
    school: db.school,
    language,
    docTitle: opts.title,
    receiptNo: receiptNumberOf(db),
    name: studentName(student),
    level: studentLevelLabel(db, student),
    date: new Date().toISOString().slice(0, 10),
    note: hideRemaining
      ? opts.note
      : opts.note ??
        (opts.restAfter !== undefined && opts.restAfter > 0
          ? `${language === "ar" ? "إجمالي الباقي على كل الفرائض" : "Total restant dû, tous frais confondus"} : ${daTicket(opts.restAfter, language)}`
          : undefined),
    rows: lines.map((l) => ({
      label: l.label,
      meta: formatDateFr(l.date),
      amount: l.amount,
      ...(hideRemaining
        ? {}
        : {
            extraLabel,
            extra: l.remaining > 0 ? daTicket(l.remaining, language) : soldeLabel,
            extraTone: l.remaining > 0 ? ("danger" as const) : ("success" as const),
          }),
    })),
  });
}

// ---------------------------------------------------------------------------
// Reçu d'UN versement déjà enregistré — réimprimé longtemps après coup.
// ---------------------------------------------------------------------------

/**
 * LE REÇU D'UN PAIEMENT QU'ON RELIT.
 *
 * `soldReceiptHtml` sert au moment de l'encaissement : la réception SAIT ce
 * qu'elle vient de faire, et lui passe le libellé, le mois et le solde obtenu.
 * Ici on part du versement lui-même, des mois ou des années plus tard —
 * l'historique d'un élève, la cloche du tableau de bord — et tout se relit
 * depuis la ligne : sur quel emploi du temps il portait, quel mois il créditait,
 * et ce qu'il a laissé derrière lui.
 *
 * Un règlement de FRAIS (un livre, une tenue) sort sur son propre reçu : la
 * dernière colonne n'y dit pas un solde mais ce qui reste dû sur ce frais-là.
 */
export function paymentReceiptHtml(
  db: Database,
  opts: { payment: Payment; language: Language; title?: string },
): string {
  const { payment, language } = opts;
  const student = db.students.find((s) => s.id === payment.studentId);
  if (!student) {
    throw new Error("Le versement ne porte sur aucun élève connu.");
  }

  // Un règlement de frais : le reçu dit ce qu'il reste dû SUR CE FRAIS.
  if (payment.chargeId) {
    const charge = db.studentCharges.find((c) => c.id === payment.chargeId);
    if (charge) {
      return chargeReceiptHtml(db, {
        student,
        language,
        title: opts.title,
        // Réimpression : on ne dit que le versement, jamais un « reste » qui
        // n'est plus celui du jour du paiement.
        hideRemaining: true,
        lines: [
          {
            label: charge.name,
            date: charge.date,
            total: charge.amount,
            amount: payment.amountPaid,
            remaining: Math.max(0, charge.amount - (charge.paidAmount ?? 0)),
          },
        ],
        restAfter: studentChargeDebt(db, student.id),
      });
    }
  }

  const enrollment = payment.enrollmentId
    ? db.enrollments.find((e) => e.id === payment.enrollmentId)
    : undefined;
  const label = enrollment
    ? enrollmentLabel(db, enrollment)
    : payment.description || "Versement";

  return soldReceiptHtml(db, {
    student,
    language,
    title: opts.title,
    note: payment.description,
    // Réimpression d'un vieux versement : le reçu ne dit que CE QUI A ÉTÉ VERSÉ
    // ce jour-là, pas un solde qui n'est plus celui du jour du paiement.
    hideBalance: true,
    lines: [
      {
        label,
        monthCode: payment.monthCode ?? "",
        amount: payment.amountPaid,
        balanceAfter: enrollment?.balance ?? 0,
      },
    ],
  });
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
    /** class/level of the payer, when he is a registered student */
    classLabel?: string;
    itemLabel: string;
    price: number;
    date: string;
    time?: string;
    language: Language;
  },
): string {
  const { payer, itemLabel, price, date, time, language } = opts;
  const docTitle = language === "ar" ? "وصل — حصة حرة" : "Reçu — Séance libre";

  return brandedTicketHtml({
    school: db.school,
    language,
    docTitle,
    receiptNo: receiptNumberOf(db),
    name: payer,
    level: opts.classLabel,
    rows: [
      {
        label: itemLabel,
        meta: time ? `${formatDateFr(date)} · ${time}` : formatDateFr(date),
        amount: price,
      },
    ],
  });
}
