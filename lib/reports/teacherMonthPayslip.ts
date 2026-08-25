"use client";

/**
 * LA FICHE DE PAIE D'UN MOIS — le miroir imprimé de l'écran de règlement.
 *
 * Elle reprend, dans le même ordre et avec les mêmes colonnes, les trois tables
 * que la réception vient de lire à l'écran :
 *
 *   1. les ÉLÈVES du mois — séances, versements, part de l'enseignant, avec la
 *      mention explicite des parts retenues et des dettes avancées par l'école ;
 *   2. les ARRIÉRÉS rattrapés — des parts d'un mois DÉJÀ réglé, libérées par un
 *      paiement tardif, présentées avec leur mois d'origine et leurs dates ;
 *   3. les RETENUES — dépenses, acomptes, scolarité de ses enfants.
 *
 * Puis le résumé : table 1 + table 2 − table 3 = net versé. L'enseignant doit
 * pouvoir refaire l'addition ligne à ligne, sans rien avoir à croire sur parole.
 */

import type { School, Teacher, TeacherPayBoard } from "@/lib/types";
import type { Language } from "@/lib/store/settings";
import {
  bannerHtml,
  fmtDate,
  fmtDateTime,
  letterheadHtml,
  metaFooterHtml,
  printDocument,
  signaturesHtml,
} from "@/lib/printTemplates";

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Un montant AVEC SES DÉCIMALES.
 *
 * La part d'une séance tombe rarement juste (1 333,33 DA) : arrondir chaque
 * ligne au dinar ferait que la somme des lignes ne retombe plus sur le net.
 * Les décimales ne s'affichent que lorsqu'il y en a.
 */
const da = (n: number) => {
  const value = Math.round((Number(n) || 0) * 100) / 100;
  const digits = Number.isInteger(value) ? 0 : 2;
  return `${value.toLocaleString("fr-DZ", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} DA`;
};

/**
 * UNE SÉANCE DU MOIS, IMPRIMÉE COMME SUR LA FEUILLE DE PRÉSENCE.
 *
 * P / R / A / × sont exactement les pastilles que la réception a sous les yeux
 * toute la journée : la fiche de paie ne réinvente pas un vocabulaire pour
 * l'occasion. Une case vide est une séance non pointée, une case grisée une
 * séance tenue avant l'inscription de l'élève — elle n'a jamais été la sienne.
 */
const SLOT_MARK: Record<string, { text: string; cls: string }> = {
  present: { text: "P", cls: "slot-p" },
  late: { text: "R", cls: "slot-r" },
  absent: { text: "A", cls: "slot-a" },
  cancelled: { text: "×", cls: "slot-c" },
  before: { text: "·", cls: "slot-b" },
};

function slotCells(slots: (string | null)[] | undefined, size: number): string {
  const list = slots ?? Array.from({ length: size }, () => null);
  return list
    .map((v) => {
      const mark = v ? SLOT_MARK[v] : undefined;
      return `<td style="text-align:center; padding:3px;"><span class="slot ${mark?.cls ?? "slot-n"}">${mark?.text ?? "–"}</span></td>`;
    })
    .join("");
}

const EXTRA_CSS = `
  .board-head { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; background:#f5f3ff; border:1px solid #e8e6f4; border-radius:10px; padding:10px 14px; margin-bottom:12px; }
  .board-head h4 { margin:0 0 2px; font-size:1em; color:#5b21b6; }
  .board-head span { display:block; font-size:0.76em; color:#5c567a; }
  .board-head .chip { background:#fff; border:1px solid #c0b6e9; border-radius:999px; padding:4px 12px; font-size:0.74em; font-weight:700; color:#7c3aed; white-space:nowrap; }
  .tbl-title { display:flex; justify-content:space-between; align-items:baseline; gap:10px; margin:16px 0 6px; }
  .tbl-title h3 { margin:0; font-size:0.95em; color:#5b21b6; }
  .tbl-title em { font-style:normal; font-size:0.74em; color:#5c567a; }
  .row-withheld td { background:#fff7ed; }
  .row-covered td { background:#fef2f2; }
  .tag { display:inline-block; border-radius:999px; padding:1px 7px; font-size:0.72em; font-weight:700; }
  .tag-danger { background:#fee2e2; color:#b91c1c; }
  .tag-warn { background:#fef3c7; color:#b45309; }
  .tag-ok { background:#dcfce7; color:#15803d; }
  .tag-mute { background:#f1f0f7; color:#5c567a; }
  .sum { width:100%; border-collapse:collapse; margin-top:14px; }
  .sum td { padding:7px 12px; border-bottom:1px solid #ece9f8; font-size:0.9em; }
  .sum td:last-child { text-align:end; font-family:monospace; font-weight:700; }
  .sum tr.net td { background:#f5f3ff; border-top:2px solid #7c3aed; border-bottom:none; font-size:1.1em; font-weight:800; color:#5b21b6; }
  .sum tr.minus td:last-child { color:#b91c1c; }
  .slot { display:inline-block; width:18px; height:18px; line-height:17px; text-align:center; border-radius:5px; border:1px solid #ddd9f0; font-size:0.72em; font-weight:800; }
  .slot-p { background:#dcfce7; border-color:#86efac; color:#15803d; }
  .slot-r { background:#fef3c7; border-color:#fcd34d; color:#b45309; }
  .slot-a { background:#fee2e2; border-color:#fca5a5; color:#b91c1c; }
  .slot-c { background:#ede9fe; border-color:#c4b5fd; color:#6d28d9; }
  .slot-b { background:#f8f7fd; border-style:dashed; color:#c8c4dd; }
  .slot-n { background:#fff; color:#c8c4dd; }
  .note { font-size:0.75em; color:#5c567a; margin:6px 0 0; font-style:italic; }
  .empty { padding:12px; text-align:center; font-style:italic; color:#5c567a; font-size:0.82em; border:1px dashed #ddd9f0; border-radius:8px; }
`;

const LABELS = {
  fr: {
    docTitle: "Fiche de Paie — Règlement d'un mois",
    receiptNo: "Bon N° :",
    teacherInfo: "Enseignant",
    fullName: "Nom complet :",
    phone: "Téléphone :",
    email: "E-mail :",
    status: "Statut :",
    passager: "Enseignant passager (sans compte)",
    regular: "Enseignant de l'école",
    emploiInfo: "Emploi du temps réglé",
    month: "Mois",
    seances: "Séances tenues",
    monthPrice: "Prix du mois (élève)",
    teacherShare: "Part de l'enseignant (mois)",
    perSeance: "Part par séance",

    t1: "1. Élèves du mois",
    t1note:
      "Une ligne par élève du mois : ce qu'il a suivi, ce qu'il a versé, et ce que ses séances rapportent à l'enseignant. Une part RETENUE appartient à un élève qui doit encore de l'argent : elle sera réglée dès qu'il se sera acquitté.",
    slotLegend:
      "Colonnes S1…Sn : P = présent, R = retard, A = absent, × = séance annulée, – = pas encore pointée, · = séance tenue avant son inscription.",
    t2: "2. Arriérés rattrapés — élèves ayant payé en retard",
    t2note:
      "Ces parts appartiennent à des MOIS DÉJÀ RÉGLÉS : elles avaient été retenues faute de paiement. L'élève s'est acquitté depuis, elles sont donc dues aujourd'hui — sans se confondre avec le mois courant.",
    t3: "3. Retenues sur la paie",
    t3note:
      "Dépenses avancées par l'école, acomptes déjà versés, et scolarité des enfants de l'enseignant réglée sur son salaire.",

    number: "N°",
    student: "Élève",
    case: "Cas",
    presence: "P / A / An.",
    paidSeances: "Séances payables",
    unit: "Part / séance",
    credited: "Versé par l'élève",
    debt: "Reste dû",
    share: "Part enseignant",
    origin: "Mois d'origine",
    dates: "Dates concernées",
    dedDate: "Date",
    dedKind: "Nature",
    dedLabel: "Libellé",
    dedAmount: "Montant",
    expense: "Dépense",
    acompte: "Acompte",
    child: "Scolarité enfant",
    childDebt: "Scolarité avancée",
    subtotal: "Sous-total",
    noStudents: "Aucun élève réglé sur ce mois.",
    noArrears: "Aucun arriéré à rattraper.",
    noDeductions: "Aucune retenue sur cette paie.",

    withheld: "retenu",
    covered: "dette avancée par l'école",
    summary: "Résumé du règlement",
    sumStudents: "Total des élèves du mois (table 1) :",
    sumArrears: "Total des arriérés rattrapés (table 2) :",
    sumGross: "TOTAL BRUT :",
    sumDeductions: "Retenues (table 3) :",
    sumNet: "NET VERSÉ À L'ENSEIGNANT :",
    paidOn: "Payé le :",
    signTeacher: "Signature de l'enseignant",
    signCashier: "La Caisse / Direction",
  },
  ar: {
    docTitle: "كشف الراتب — تسوية شهر",
    receiptNo: "وصل رقم :",
    teacherInfo: "الأستاذ",
    fullName: "الاسم الكامل :",
    phone: "الهاتف :",
    email: "البريد الإلكتروني :",
    status: "الحالة :",
    passager: "أستاذ عابر (بدون حساب)",
    regular: "أستاذ بالمدرسة",
    emploiInfo: "جدول التوقيت المسوّى",
    month: "الشهر",
    seances: "الحصص المنجزة",
    monthPrice: "سعر الشهر (للتلميذ)",
    teacherShare: "نصيب الأستاذ (الشهر)",
    perSeance: "النصيب لكل حصة",

    t1: "1. تلاميذ الشهر",
    t1note:
      "سطر لكل تلميذ : ما حضره، ما دفعه، وما تدرّه حصصه على الأستاذ. المبلغ المحجوز يخص تلميذًا لا يزال مدينًا، ويُدفع فور تسديده.",
    slotLegend:
      "الأعمدة S1…Sn : P = حاضر، R = متأخر، A = غائب، × = حصة ملغاة، – = لم تُسجَّل بعد، · = حصة سابقة لتسجيله.",
    t2: "2. المتأخرات المسترجعة — تلاميذ دفعوا متأخرين",
    t2note:
      "تخص هذه المبالغ أشهرًا سُوّيت من قبل : حُجزت لعدم الدفع، وقد سدّد التلميذ منذ ذلك الحين فأصبحت مستحقة اليوم.",
    t3: "3. الخصومات من الراتب",
    t3note: "مصاريف قدّمتها المدرسة، تسبيقات، ودراسة أبناء الأستاذ المخصومة من راتبه.",

    number: "رقم",
    student: "التلميذ",
    case: "الحالة",
    presence: "ح / غ / ملغاة",
    paidSeances: "الحصص المستحقة",
    unit: "النصيب / حصة",
    credited: "المدفوع من التلميذ",
    debt: "الباقي",
    share: "نصيب الأستاذ",
    origin: "الشهر الأصلي",
    dates: "التواريخ المعنية",
    dedDate: "التاريخ",
    dedKind: "النوع",
    dedLabel: "البيان",
    dedAmount: "المبلغ",
    expense: "مصروف",
    acompte: "تسبيق",
    child: "دراسة ابن",
    childDebt: "دراسة مقدَّمة",
    subtotal: "المجموع الجزئي",
    noStudents: "لا يوجد تلميذ مسوّى في هذا الشهر.",
    noArrears: "لا توجد متأخرات.",
    noDeductions: "لا توجد خصومات.",

    withheld: "محجوز",
    covered: "دين قدّمته المدرسة",
    summary: "ملخص التسوية",
    sumStudents: "مجموع تلاميذ الشهر (الجدول 1) :",
    sumArrears: "مجموع المتأخرات (الجدول 2) :",
    sumGross: "المجموع الخام :",
    sumDeductions: "الخصومات (الجدول 3) :",
    sumNet: "الصافي المدفوع للأستاذ :",
    paidOn: "تاريخ الدفع :",
    signTeacher: "إمضاء الأستاذ",
    signCashier: "الصندوق / الإدارة",
  },
} as const;

export interface TeacherMonthPayslipData {
  school: School;
  teacher: Teacher;
  lang: Language;
  paidAt: string;
  receiptNo?: string;
  board: TeacherPayBoard;
}

/** La fiche de paie complète d'un règlement de mois, prête à imprimer. */
export function buildTeacherMonthPayslip(data: TeacherMonthPayslipData): string {
  const { school, teacher, lang, board } = data;
  const L = LABELS[lang];
  const receiptNo = data.receiptNo ?? "";

  const kindLabel: Record<string, string> = {
    expense: L.expense,
    acompte: L.acompte,
    child: L.child,
    child_debt: L.childDebt,
  };

  // ---- en-tête : l'enseignant et l'emploi du temps réglé -------------------
  const headHtml = `
    <div class="frame frame-info" style="margin-bottom:16px;">
      <h3>${L.teacherInfo}</h3>
      <table style="margin-top:0;">
        <tr>
          <td style="width:18%; font-weight:bold; color:#5c567a;">${L.fullName}</td>
          <td style="width:32%; font-weight:bold; font-size:1.05em;">${esc(teacher.firstName)} ${esc(teacher.lastName)}</td>
          <td style="width:18%; font-weight:bold; color:#5c567a;">${L.phone}</td>
          <td style="width:32%; font-family:monospace;">${esc(teacher.phone) || "—"}</td>
        </tr>
        <tr>
          <td style="font-weight:bold; color:#5c567a;">${L.email}</td>
          <td>${esc(teacher.email) || "—"}</td>
          <td style="font-weight:bold; color:#5c567a;">${L.status}</td>
          <td>${teacher.isPassager ? L.passager : L.regular}</td>
        </tr>
      </table>
    </div>

    <div class="board-head">
      <div>
        <h4>${esc(board.emploi)} — ${esc(board.groupName)}</h4>
        <span>${esc(board.className)} · ${esc(board.salleName)} · ${esc(board.daysLabel)} · ${esc(board.timeLabel)}</span>
        <span>${L.monthPrice} ${da(board.monthPrice)} · ${L.teacherShare} ${da(board.teacherMonthShare)} · ${L.perSeance} ${da(board.perSeance)}</span>
      </div>
      <div style="text-align:end;">
        <span class="chip">${L.month} ${esc(board.monthCode)}</span>
        <span style="margin-top:6px;">${L.seances} : <strong>${board.held}/${board.size}</strong></span>
      </div>
    </div>`;

  // ---- table 1 : les élèves du mois ---------------------------------------
  const studentsRows = board.students
    .map((r) => {
      const cls = r.schoolCovered ? "row-covered" : r.withheld ? "row-withheld" : "";
      const flags = [
        r.withheld ? `<span class="tag tag-warn">${L.withheld}</span>` : "",
        r.schoolCovered ? `<span class="tag tag-danger">${L.covered}</span>` : "",
        r.caseLabel ? `<span class="tag tag-mute">${esc(r.caseLabel)}</span>` : "",
      ]
        .filter(Boolean)
        .join(" ");
      return `
      <tr class="${cls}">
        <td style="font-family:monospace;">${esc(r.registrationNumber) || "—"}</td>
        <td><strong>${esc(r.name)}</strong>${flags ? `<br/>${flags}` : ""}</td>
        ${slotCells(r.slots, board.size)}
        <td style="text-align:center; font-family:monospace;">${r.presents} / ${r.absents} / ${r.cancelled}</td>
        <td style="text-align:center; font-family:monospace;">${r.seances}</td>
        <td style="text-align:end; font-family:monospace;">${da(r.perSeance)}</td>
        <td style="text-align:end; font-family:monospace;">${da(r.credited)}</td>
        <td style="text-align:end; font-family:monospace; color:${r.debt > 0 ? "#b91c1c" : "#5c567a"};">${r.debt > 0 ? da(r.debt) : "—"}</td>
        <td style="text-align:end; font-family:monospace; font-weight:700;">${r.withheld ? `<span class="tag tag-warn">${L.withheld}</span>` : da(r.amount)}</td>
      </tr>`;
    })
    .join("");

  const table1 = `
    <div class="tbl-title"><h3>${L.t1}</h3><em>${board.students.length} élève(s)</em></div>
    ${
      board.students.length === 0
        ? `<div class="empty">${L.noStudents}</div>`
        : `<table>
      <thead>
        <tr>
          <th>${L.number}</th><th>${L.student}</th>
          ${Array.from({ length: board.size }, (_, i) => `<th style="text-align:center;">S${i + 1}</th>`).join("")}
          <th style="text-align:center;">${L.presence}</th>
          <th style="text-align:center;">${L.paidSeances}</th><th style="text-align:end;">${L.unit}</th>
          <th style="text-align:end;">${L.credited}</th><th style="text-align:end;">${L.debt}</th>
          <th style="text-align:end;">${L.share}</th>
        </tr>
      </thead>
      <tbody>${studentsRows}</tbody>
      <tfoot>
        <tr>
          <td colspan="${7 + board.size}" style="text-align:end; font-weight:700;">${L.subtotal}</td>
          <td style="text-align:end; font-family:monospace; font-weight:800; color:#5b21b6;">${da(board.studentsTotal)}</td>
        </tr>
      </tfoot>
    </table>`
    }
    <p class="note">${L.t1note} ${L.slotLegend}</p>`;

  // ---- table 2 : les arriérés rattrapés -----------------------------------
  const arrearRows = board.arrears
    .map(
      (r) => `
      <tr>
        <td style="font-family:monospace;">${esc(r.registrationNumber) || "—"}</td>
        <td><strong>${esc(r.name)}</strong>${r.caseLabel ? `<br/><span class="tag tag-mute">${esc(r.caseLabel)}</span>` : ""}</td>
        <td style="text-align:center;"><span class="tag tag-ok">${esc(r.monthCode)}</span></td>
        <td style="text-align:center; font-family:monospace;">${r.seances}</td>
        <td style="font-size:0.78em;">${r.dates.map((d) => fmtDate(d, lang)).join(" · ") || "—"}</td>
        <td style="text-align:end; font-family:monospace;">${da(r.credited)}</td>
        <td style="text-align:end; font-family:monospace; font-weight:700;">${da(r.amount)}</td>
      </tr>`,
    )
    .join("");

  const table2 = `
    <div class="tbl-title"><h3>${L.t2}</h3><em>${board.arrears.length} ligne(s)</em></div>
    ${
      board.arrears.length === 0
        ? `<div class="empty">${L.noArrears}</div>`
        : `<table>
      <thead>
        <tr>
          <th>${L.number}</th><th>${L.student}</th><th style="text-align:center;">${L.origin}</th>
          <th style="text-align:center;">${L.paidSeances}</th><th>${L.dates}</th>
          <th style="text-align:end;">${L.credited}</th><th style="text-align:end;">${L.share}</th>
        </tr>
      </thead>
      <tbody>${arrearRows}</tbody>
      <tfoot>
        <tr>
          <td colspan="6" style="text-align:end; font-weight:700;">${L.subtotal}</td>
          <td style="text-align:end; font-family:monospace; font-weight:800; color:#15803d;">${da(board.arrearsTotal)}</td>
        </tr>
      </tfoot>
    </table>`
    }
    <p class="note">${L.t2note}</p>`;

  // ---- table 3 : les retenues ---------------------------------------------
  const dedRows = board.deductions
    .map(
      (d) => `
      <tr>
        <td style="font-family:monospace; font-size:0.8em;">${d.date ? fmtDate(d.date, lang) : "—"}</td>
        <td><span class="tag tag-mute">${kindLabel[d.kind] ?? d.kind}</span></td>
        <td><strong>${esc(d.label)}</strong>${d.description ? `<br/><span style="font-size:0.78em; color:#5c567a;">${esc(d.description)}</span>` : ""}</td>
        <td style="text-align:end; font-family:monospace; color:#b91c1c; font-weight:700;">− ${da(d.amount)}</td>
      </tr>`,
    )
    .join("");

  const table3 = `
    <div class="tbl-title"><h3>${L.t3}</h3><em>${board.deductions.length} ligne(s)</em></div>
    ${
      board.deductions.length === 0
        ? `<div class="empty">${L.noDeductions}</div>`
        : `<table>
      <thead>
        <tr>
          <th>${L.dedDate}</th><th>${L.dedKind}</th><th>${L.dedLabel}</th>
          <th style="text-align:end;">${L.dedAmount}</th>
        </tr>
      </thead>
      <tbody>${dedRows}</tbody>
      <tfoot>
        <tr>
          <td colspan="3" style="text-align:end; font-weight:700;">${L.subtotal}</td>
          <td style="text-align:end; font-family:monospace; font-weight:800; color:#b91c1c;">− ${da(board.deductionsTotal)}</td>
        </tr>
      </tfoot>
    </table>`
    }
    <p class="note">${L.t3note}</p>`;

  // ---- le résumé -----------------------------------------------------------
  const summary = `
    <div class="frame" style="margin-top:18px;">
      <h3>${L.summary}</h3>
      <table class="sum">
        <tr><td>${L.sumStudents}</td><td>${da(board.studentsTotal)}</td></tr>
        <tr><td>${L.sumArrears}</td><td>${da(board.arrearsTotal)}</td></tr>
        <tr><td style="font-weight:700;">${L.sumGross}</td><td>${da(board.gross)}</td></tr>
        <tr class="minus"><td>${L.sumDeductions}</td><td>− ${da(board.deductionsTotal)}</td></tr>
        <tr><td>${L.paidOn}</td><td>${fmtDateTime(data.paidAt, lang)}</td></tr>
        <tr class="net"><td>${L.sumNet}</td><td>${da(board.net)}</td></tr>
      </table>
    </div>`;

  const bodyHtml = `
    ${letterheadHtml(school)}
    ${bannerHtml(
      `${L.docTitle} — ${esc(board.emploi)} · ${esc(board.monthCode)}`,
      receiptNo ? `${L.receiptNo} ${esc(receiptNo)}` : undefined,
    )}
    ${headHtml}
    ${table1}
    ${table2}
    ${table3}
    ${summary}
    ${signaturesHtml(L.signTeacher, L.signCashier)}
    ${metaFooterHtml(school.name, lang)}
  `;

  return printDocument({
    title: `${L.docTitle} - ${teacher.firstName} ${teacher.lastName} - ${board.monthCode}`,
    lang,
    bodyHtml,
    extraCss: EXTRA_CSS,
  });
}
