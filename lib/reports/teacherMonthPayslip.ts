"use client";

/**
 * LA FICHE DE PAIE D'UN MOIS — « فيش دفعة الأستاذ », calquée sur le modèle
 * papier de l'école (logo, coordonnées, puis trois tableaux numérotés) :
 *
 *   1. la liste des élèves du mois et ce que leurs séances rapportent ;
 *   2. les mekhalfat du mois précédent — arriérés débloqués par un paiement
 *      tardif, et séances libres tombées sur ce mois ;
 *   3. les dépenses retenues sur la paie (avances, frais, scolarité des
 *      enfants).
 *
 * Puis le résumé : table 1 + table 2 − table 3 = net versé.
 */

import type { School, Teacher, TeacherPayBoard } from "@/lib/types";
import type { Language } from "@/lib/store/settings";
import { fmtDateTime, metaFooterHtml, printDocument } from "@/lib/printTemplates";
import { monthCodeLabel, schoolYearLabel } from "@/lib/helpers";

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const LABELS = {
  fr: {
    docTitle: "Fiche de Paie de l'Enseignant",
    receiptNo: "Bon N° :",
    teacherName: "Nom et prénom de l'enseignant",
    emploi: "Emploi du temps",
    group: "Groupe",
    month: "Mois",
    year: "Année scolaire",
    t1title: "Liste des élèves et des séances",
    number: "N°",
    student: "Nom et prénom de l'élève",
    seances: "Nb. séances",
    amountCol: "Montant des séances (DA)",
    total: "Total",
    withheldTag: "Retenu",
    stateCol: "État",
    statePaid: "Réglé sur ce bon",
    stateWithheld: "Retenu — élève en dette",
    stateLater: "Non réglé sur ce bon",
    noStudents: "Aucun élève sur ce mois.",
    t2title: "Arriérés du mois précédent",
    tStudent: "Élève",
    status: "Statut",
    arrearStatus: (m: string) => `Règlement en retard — ${m}`,
    passagerTag: "Séance libre",
    noPrevious: "Aucun arriéré ni séance libre sur ce mois.",
    t3title: "Dépenses de l'enseignant",
    label: "Désignation",
    expense: "Dépense",
    acompte: "Acompte",
    child: "Scolarité enfant",
    childDebt: "Scolarité avancée",
    noExpenses: "Aucune dépense retenue sur cette paie.",
    net: "Net à payer à l'enseignant",
    signTeacher: "Signature de l'enseignant",
    signAdmin: "Signature de l'administration",
    paidOn: "Date de paiement :",
  },
  ar: {
    docTitle: "فيش دفعة الأستاذ",
    receiptNo: "رقم الفيش :",
    teacherName: "اسم ولقب الأستاذ",
    emploi: "جدول التوقيت",
    group: "المجموعة",
    month: "الشهر",
    year: "السنة الدراسية",
    t1title: "قائمة التلاميذ والحصص",
    number: "رقم",
    student: "اسم ولقب التلميذ",
    seances: "عدد الحصص",
    amountCol: "مبلغ الحصص(دج)",
    total: "المجموع",
    withheldTag: "محجوز",
    stateCol: "الحالة",
    statePaid: "مدفوع في هذا الوصل",
    stateWithheld: "محجوز — التلميذ مدين",
    stateLater: "غير مدفوع في هذا الوصل",
    noStudents: "لا يوجد تلاميذ على هذا الشهر.",
    t2title: "مخلفات الشهر السابق",
    tStudent: "التلميذ",
    status: "الحالة",
    arrearStatus: (m: string) => `تسوية متأخرة — ${m}`,
    passagerTag: "حصة حرة",
    noPrevious: "لا توجد مخلفات على الشهر السابق.",
    t3title: "مصاريف الأستاذ",
    label: "البيان",
    expense: "مصروف",
    acompte: "تسبيق",
    child: "دراسة ابن",
    childDebt: "دراسة مقدَّمة",
    noExpenses: "لا توجد مصاريف على هذا الفيش.",
    net: "الصافي المستحق للأستاذ",
    signTeacher: "إمضاء الأستاذ",
    signAdmin: "إمضاء الإدارة",
    paidOn: "تاريخ الدفع :",
  },
} as const;

const TP_CSS = `
  body { background: #f6ecf1; }
  .tp-page { background: #fff; }
  .tp-header { display: flex; justify-content: space-between; align-items: stretch; flex-wrap: wrap; gap: 16px; border: 1px solid #f0d9e3; border-radius: 14px; padding: 16px 18px; margin-bottom: 18px; background: #fff; }
  .tp-brand { display: flex; align-items: center; gap: 14px; }
  .tp-logo, .tp-logo-fallback { width: 82px; height: 82px; border-radius: 50%; object-fit: cover; border: 3px solid #fbe4ee; flex-shrink: 0; }
  .tp-logo-fallback { background: #7a1440; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 2.2em; }
  .tp-desc { margin: 0; font-size: 0.78em; color: #7a1440; font-weight: 700; }
  .tp-name { margin: 1px 0; font-size: 1.5em; font-weight: 800; color: #7a1440; }
  .tp-contact { display: flex; flex-direction: column; gap: 1px; font-size: 0.78em; color: #4a4453; }
  .tp-right { display: flex; flex-direction: column; align-items: stretch; gap: 8px; min-width: 240px; }
  .tp-title-box { background: linear-gradient(135deg, #7a1440, #4d0c28); color: #fff; text-align: center; font-weight: 800; font-size: 1.05em; padding: 8px 14px; border-radius: 10px; }
  .tp-title-box small { display: block; font-size: 0.68em; font-weight: 600; opacity: 0.9; margin-top: 3px; letter-spacing: 0.5px; }
  .tp-fields { width: 100%; border-collapse: collapse; font-size: 0.82em; }
  .tp-fields th { text-align: start; color: #5c5566; font-weight: 700; padding: 3px 8px 3px 0; white-space: nowrap; }
  .tp-fields td { text-align: start; font-weight: 700; color: #1e1b2e; padding: 3px 0; }
  .tp-section { margin-bottom: 16px; }
  .tp-section-title { display: flex; align-items: center; gap: 8px; font-weight: 800; color: #7a1440; font-size: 1em; margin-bottom: 8px; }
  .tp-num { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 50%; background: #7a1440; color: #fff; font-size: 0.8em; flex-shrink: 0; }
  .tp-table { width: 100%; border-collapse: collapse; font-size: 0.85em; border: 1px solid #f0d9e3; border-radius: 10px; overflow: hidden; }
  .tp-table th { background: #7a1440; color: #fff; padding: 8px; font-weight: 700; text-align: center; }
  .tp-table td { padding: 7px 8px; border-bottom: 1px solid #f6e9ee; text-align: center; }
  .tp-table td.num { text-align: end; font-family: monospace; font-weight: 700; }
  .tp-table tbody tr:nth-child(even) { background: #fdf5f8; }
  .tp-table tfoot td { background: #fbe4ee; color: #7a1440; font-weight: 800; border-top: 2px solid #7a1440; border-bottom: none; }
  .tp-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .tp-empty { text-align: center; color: #9a93a3; font-size: 0.82em; font-style: italic; padding: 14px; border: 1px dashed #e6d4de; border-radius: 10px; }
  .tp-net { display: flex; justify-content: space-between; align-items: center; background: #fdf5f8; border: 2px solid #7a1440; border-radius: 12px; padding: 14px 18px; margin: 18px 0; font-weight: 800; color: #5c0f30; font-size: 1.05em; }
  .tp-net.negative { border-color: #b91c1c; color: #b91c1c; background: #fdf2f2; }
  .tp-net span:last-child { font-size: 1.3em; }
  .tp-sign { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-top: 26px; }
  .tp-sign-box { border: 1px dashed #d9c3cf; border-radius: 10px; height: 80px; display: flex; align-items: flex-end; justify-content: center; padding-bottom: 10px; font-size: 0.8em; font-weight: 700; color: #5c5566; text-transform: uppercase; }
  .tp-paidon { text-align: end; margin-top: 14px; font-size: 0.85em; color: #4a4453; }
  .tp-tag { display: inline-block; border-radius: 999px; padding: 1px 8px; font-size: 0.72em; font-weight: 700; margin-inline-start: 4px; }
  .tp-tag-warn { background: #fef3c7; color: #b45309; }
  .tp-tag-mute { background: #f1f0f7; color: #5c567a; }
  .tp-tag-ok { background: #dcfce7; color: #166534; }
  .tp-row-open td { background: #fbfafc; color: #6b6580; }
  /* L'emploi du temps qu'une scolarité d'enfant paie : la seule étiquette de
     la fiche qui répond à « pour quel cours me retient-on cette somme ? ». */
  .tp-tag-emploi { background: #fdf0f5; color: #7a1440; border: 1px solid #e6c3d4; }
  @media print { body { background: #fff; } }
`;

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
  const receiptNo = data.receiptNo;

  /** Montant AVEC SES DÉCIMALES (la part d'une séance tombe rarement juste) —
   *  groupé au point, devise selon la langue, comme sur le fiche papier. */
  const da = (n: number) => {
    const value = Math.round((Number(n) || 0) * 100) / 100;
    const digits = Number.isInteger(value) ? 0 : 2;
    const grouped = Math.abs(value).toLocaleString("de-DE", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    return `${value < 0 ? "-" : ""}${grouped} ${lang === "ar" ? "دج" : "DA"}`;
  };

  const teacherFullName = `${teacher.firstName} ${teacher.lastName}`.trim();
  const logo = school.logo
    ? `<img src="${esc(school.logo)}" alt="logo" class="tp-logo" />`
    : `<div class="tp-logo-fallback">🎓</div>`;

  // ---- en-tête : logo, école, et le petit encart "fiche" ------------------
  const headerHtml = `
    <div class="tp-header">
      <div class="tp-brand">
        ${logo}
        <div>
          ${school.description ? `<p class="tp-desc">${esc(school.description)}</p>` : ""}
          <h1 class="tp-name">${esc(school.name)}</h1>
          <div class="tp-contact">
            ${school.address ? `<span>📍 ${esc(school.address)}</span>` : ""}
            ${school.phone ? `<span>📞 ${esc(school.phone)}</span>` : ""}
          </div>
        </div>
      </div>
      <div class="tp-right">
        <div class="tp-title-box">
          ${L.docTitle}
          ${receiptNo ? `<small>${L.receiptNo} ${esc(receiptNo)}</small>` : ""}
        </div>
        <table class="tp-fields">
          <tr><th>${L.teacherName} :</th><td>${esc(teacherFullName)}</td></tr>
          <tr><th>${L.emploi} :</th><td>${esc(board.emploi || "—")}</td></tr>
          <tr><th>${L.group} :</th><td>${esc(
            [board.groupName, board.className, board.salleName ? `Salle ${board.salleName}` : ""]
              .filter((x) => x && x !== "—")
              .join(" · ") || "—",
          )}</td></tr>
          <tr><th>${L.month} :</th><td>${esc(monthCodeLabel(board.monthCode))}</td></tr>
          <tr><th>${L.year} :</th><td>${esc(schoolYearLabel(data.paidAt))}</td></tr>
        </table>
      </div>
    </div>`;

  // ---- 1. la liste des élèves et des séances ------------------------------
  // LA LISTE EST CELLE DU MOIS ENTIER — ceux dont la part est versée par ce
  // bon ET ceux dont elle ne l'est pas. Un règlement figé avant cette colonne
  // ne portait que des lignes payées : `settledHere` absent vaut donc « payé ».
  const settledOn = (r: (typeof board.students)[number]) =>
    r.settledHere ?? !r.withheld;
  const s1Rows = board.students
    .map((r) => {
      const paidHere = settledOn(r);
      const tags = [
        r.caseLabel ? `<span class="tp-tag tp-tag-mute">${esc(r.caseLabel)}</span>` : "",
        r.withheld ? `<span class="tp-tag tp-tag-warn">${L.withheldTag}</span>` : "",
      ]
        .filter(Boolean)
        .join(" ");
      const state = r.withheld ? L.stateWithheld : paidHere ? L.statePaid : L.stateLater;
      const tone = r.withheld ? "tp-tag-warn" : paidHere ? "tp-tag-ok" : "tp-tag-mute";
      return `<tr${paidHere ? "" : ' class="tp-row-open"'}>
        <td style="font-family:monospace;">${esc(r.registrationNumber || "—")}</td>
        <td style="text-align:start;"><strong>${esc(r.name)}</strong>${tags ? `<br/>${tags}` : ""}</td>
        <td>${r.seances}</td>
        <td style="font-size:0.8em;"><span class="tp-tag ${tone}">${esc(state)}</span></td>
        <td class="num">${paidHere ? da(r.amount) : "—"}</td>
      </tr>`;
    })
    .join("");
  const s1Seances = board.students
    .filter(settledOn)
    .reduce((s, r) => s + r.seances, 0);

  const section1 = `
    <div class="tp-section">
      <div class="tp-section-title"><span class="tp-num">1</span>${L.t1title}</div>
      ${
        board.students.length === 0
          ? `<div class="tp-empty">${L.noStudents}</div>`
          : `<table class="tp-table">
        <thead><tr><th>${L.number}</th><th style="text-align:start;">${L.student}</th><th>${L.seances}</th><th>${L.stateCol}</th><th>${L.amountCol}</th></tr></thead>
        <tbody>${s1Rows}</tbody>
        <tfoot><tr><td colspan="2">${L.total}</td><td>${s1Seances}</td><td></td><td class="num">${da(board.studentsTotal)}</td></tr></tfoot>
      </table>`
      }
    </div>`;

  // ---- 2. mekhalfat du mois précédent : arriérés + séances libres ---------
  const prevRows = [
    ...board.arrears.map((a) => ({
      name: a.name,
      status: L.arrearStatus(monthCodeLabel(a.monthCode)),
      amount: a.amount,
    })),
    ...(board.passagers ?? []).map((p) => ({
      name: p.name,
      status: L.passagerTag,
      amount: p.teacherShare,
    })),
  ];
  const prevTotal = board.arrearsTotal + (board.passagersTotal ?? 0);

  const section2 = `
    <div class="tp-section">
      <div class="tp-section-title"><span class="tp-num">2</span>${L.t2title}</div>
      ${
        prevRows.length === 0
          ? `<div class="tp-empty">${L.noPrevious}</div>`
          : `<table class="tp-table">
        <thead><tr><th style="text-align:start;">${L.tStudent}</th><th>${L.status}</th><th>${L.amountCol}</th></tr></thead>
        <tbody>${prevRows
          .map(
            (r) => `<tr>
          <td style="text-align:start;"><strong>${esc(r.name)}</strong></td>
          <td style="font-size:0.82em;">${esc(r.status)}</td>
          <td class="num">${da(r.amount)}</td>
        </tr>`,
          )
          .join("")}</tbody>
        <tfoot><tr><td colspan="2">${L.total}</td><td class="num">${da(prevTotal)}</td></tr></tfoot>
      </table>`
      }
    </div>`;

  // ---- 3. les dépenses retenues sur la paie -------------------------------
  const kindLabel: Record<string, string> = {
    expense: L.expense,
    acompte: L.acompte,
    child: L.child,
    child_debt: L.childDebt,
  };
  const section3 = `
    <div class="tp-section">
      <div class="tp-section-title"><span class="tp-num">3</span>${L.t3title}</div>
      ${
        board.deductions.length === 0
          ? `<div class="tp-empty">${L.noExpenses}</div>`
          : `<table class="tp-table">
        <thead><tr><th style="text-align:start;">${L.label}</th><th>${L.amountCol}</th></tr></thead>
        <tbody>${board.deductions
          .map((d) => {
            // UNE SCOLARITÉ D'ENFANT DIT POUR QUEL COURS ELLE EST RETENUE.
            // Le nom de l'emploi du temps et son mois sortent de la phrase
            // pour devenir des étiquettes : sur une fiche imprimée, c'est la
            // ligne que l'enseignant vérifie en premier.
            // Un règlement figé avant cette colonne ne porte pas d'`emploi` :
            // son intitulé vit encore dans la phrase, qui reste alors imprimée
            // telle quelle plutôt que remplacée par une étiquette devinée.
            const named = (d.kind === "child" || d.kind === "child_debt") && !!d.emploi;
            const tags = named
              ? `<span class="tp-tag tp-tag-emploi">${esc(d.emploi!)}</span>${
                  d.monthCode ? ` <span class="tp-tag tp-tag-mute">${esc(d.monthCode)}</span>` : ""
                }`
              : "";
            // Le détail répète l'emploi et le mois : les étiquettes le disent
            // déjà, la phrase ne garde que le reste.
            const rest = named
              ? d.description
                  ?.split("·")
                  .map((x) => x.trim())
                  .filter((x) => x && x !== d.emploi && x !== d.monthCode)
                  .join(" · ")
              : d.description;
            return `<tr>
          <td style="text-align:start;">
            <strong>${esc(d.label)}</strong> <span class="tp-tag tp-tag-mute">${esc(kindLabel[d.kind] ?? d.kind)}</span>
            ${tags ? `<br/>${tags}` : ""}
            ${rest ? `<br/><span style="font-size:0.78em;color:#5c567a;">${esc(rest)}</span>` : ""}
          </td>
          <td class="num">− ${da(d.amount)}</td>
        </tr>`;
          })
          .join("")}</tbody>
        <tfoot><tr><td>${L.total}</td><td class="num">− ${da(board.deductionsTotal)}</td></tr></tfoot>
      </table>`
      }
    </div>`;

  const netHtml = `
    <div class="tp-net${board.net < 0 ? " negative" : ""}">
      <span>${L.net}</span>
      <span>${da(board.net)}</span>
    </div>`;

  const signHtml = `
    <div class="tp-sign">
      <div class="tp-sign-box">${L.signTeacher}</div>
      <div class="tp-sign-box">${L.signAdmin}</div>
    </div>
    <div class="tp-paidon">${L.paidOn} <strong>${fmtDateTime(data.paidAt, lang)}</strong></div>`;

  const bodyHtml = `
    <div class="tp-page">
      ${headerHtml}
      ${section1}
      <div class="tp-cols">${section2}${section3}</div>
      ${netHtml}
      ${signHtml}
      ${metaFooterHtml(school.name, lang)}
    </div>`;

  return printDocument({
    title: `${L.docTitle} - ${teacher.firstName} ${teacher.lastName} - ${board.monthCode}`,
    lang,
    bodyHtml,
    extraCss: TP_CSS,
  });
}
