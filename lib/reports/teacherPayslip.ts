"use client";

/**
 * The teacher's payslip — printed right after a settlement is validated, and
 * reprintable from his file afterwards.
 *
 * It lays the whole calculation out, in the order the desk reads it:
 *   1. the school (logo, address, fiscal identifiers) and the teacher,
 *   2. ONE table per emploi du temps he was paid for: every student, how many
 *      séances he attended, what he generated and what that earned the
 *      teacher — with the emploi's subtotal, then the grand total,
 *   3. the students whose case changes what is owed (cas spéciaux, réductions,
 *      écoles-seules) so nothing on the first table looks like a mistake,
 *   4. his own children, schooled on his pay: what they owed, emploi by
 *      emploi, and what is therefore taken off,
 *   5. the dépenses and the acomptes he has already had, each listed,
 *   6. the settlement itself: brut − retenues = net versé.
 */

import type {
  School,
  Teacher,
  TeacherChildCharge,
  TeacherPaymentDeduction,
} from "@/lib/types";
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

const da = (n: number) => `${Math.round(n).toLocaleString("fr-DZ")} DA`;

/** One student on one emploi du temps, over the settled period. */
export interface PayslipStudent {
  studentId?: string;
  name: string;
  registrationNumber?: string;
  /** "Fils d'enseignant", "Réduction" … — empty for an ordinary student */
  caseLabel?: string;
  isPassager: boolean;
  /** his money is held back: the teacher is not paid for him yet */
  withheld: boolean;
  presents: number;
  /** what his présences generated for the school */
  fees: number;
  /** what they earn the teacher */
  total: number;
}

/** One emploi du temps of the teacher, over the settled period. */
export interface PayslipEmploi {
  sessionId: string;
  title: string;
  className: string;
  groupName: string;
  salleName: string;
  daysLabel: string;
  timeLabel: string;
  /** dated séances of this emploi included in the settlement */
  sessionsCount: number;
  students: PayslipStudent[];
  presents: number;
  fees: number;
  total: number;
}

export interface TeacherPayslipData {
  school: School;
  teacher: Teacher;
  lang: Language;
  paidAt: string;
  receiptNo?: string;
  /** "group" = the emplois du temps priced their own séances */
  method: "fixed" | "percent" | "group";
  percentage?: number;
  emplois: PayslipEmploi[];
  expenses: TeacherPaymentDeduction[];
  acomptes: TeacherPaymentDeduction[];
  childCharges: TeacherChildCharge[];
  /** what the séances earned him before anything was taken off */
  gross: number;
  /** what he takes home */
  net: number;
  /** présences left unpaid because the student still owes the school */
  withheld?: { count: number; amount: number };
}

const EXTRA_CSS = `
  .emploi-head { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; background:#f5f3ff; border:1px solid #e8e6f4; border-radius:10px; padding:8px 12px; margin-bottom:8px; }
  .emploi-head h4 { margin:0; font-size:0.95em; color:#5b21b6; }
  .emploi-head span { display:block; font-size:0.75em; color:#5c567a; }
  .emploi-head .chip { background:#fff; border:1px solid #c0b6e9; border-radius:999px; padding:3px 10px; font-size:0.72em; font-weight:700; color:#7c3aed; white-space:nowrap; }
  .grand-total { display:flex; justify-content:space-between; align-items:center; background:#f5f3ff; border:2px solid #7c3aed; border-radius:10px; padding:12px 14px; margin-top:14px; font-weight:800; color:#5b21b6; }
  .note { font-size:0.75em; color:#5c567a; margin:6px 0 0; font-style:italic; }
  .deduct { color:#b91c1c; }
`;

const LABELS = {
  fr: {
    docTitle: "Fiche de Paie — Enseignant",
    receiptNo: "Bon N° :",
    teacherInfo: "Informations de l'enseignant",
    fullName: "Nom complet :",
    phone: "Téléphone :",
    email: "E-mail :",
    status: "Statut :",
    passager: "Enseignant passager (sans compte)",
    regular: "Enseignant de l'école",
    contract: "Contrat :",
    method: "Mode de calcul :",
    methodFixed: "Montant fixe saisi",
    methodPercent: (p: number) => `Pourcentage — ${p}% du montant généré par élève`,
    methodGroup: "Par groupe — tarif enseignant de chaque emploi du temps",
    contractGroup: "Par groupe (tarif de chaque emploi du temps)",
    emploisTitle: "Détail par emploi du temps",
    noEmplois: "Aucun emploi du temps réglé sur cette période.",
    student: "Élève",
    number: "N°",
    presents: "Présences",
    fees: "Montant généré",
    share: "Part enseignant",
    subtotal: "Sous-total",
    grandTotal: "TOTAL DES SÉANCES (BRUT)",
    casesTitle: "Cas particuliers des élèves",
    caseStudent: "Élève",
    caseEmploi: "Emploi du temps",
    caseKind: "Cas",
    childrenTitle: "Enfants de l'enseignant scolarisés à l'école",
    childrenNote:
      "La scolarité des enfants de l'enseignant est réglée sur son salaire : les montants ci-dessous sont retenus sur sa paie et leurs soldes sont remis à jour.",
    childName: "Enfant",
    childEmploi: "Emploi du temps",
    childMonth: "Mois",
    childAmount: "Montant dû",
    deductionsTitle: "Dépenses & acomptes retenus",
    dedDate: "Date",
    dedKind: "Nature",
    dedLabel: "Libellé",
    dedDesc: "Description",
    dedAmount: "Montant",
    expense: "Dépense",
    acompte: "Acompte",
    noDeductions: "Aucune dépense ni acompte à retenir.",
    totalDeductions: "Total des retenues",
    settlement: "Règlement",
    gross: "Total brut des séances :",
    totalExpenses: "Dépenses retenues :",
    totalAcomptes: "Acomptes retenus :",
    totalChildren: "Scolarité des enfants :",
    withheld: (n: number) => `Présences en attente (${n} élève(s) en dette) :`,
    paidOn: "Payé le :",
    net: "NET VERSÉ À L'ENSEIGNANT :",
    signTeacher: "Signature de l'enseignant",
    signCashier: "La Caisse / Direction",
    seances: "séance(s)",
  },
  ar: {
    docTitle: "كشف الراتب — الأستاذ",
    receiptNo: "وصل رقم :",
    teacherInfo: "معلومات الأستاذ",
    fullName: "الاسم الكامل :",
    phone: "الهاتف :",
    email: "البريد الإلكتروني :",
    status: "الحالة :",
    passager: "أستاذ عابر (بدون حساب)",
    regular: "أستاذ بالمدرسة",
    contract: "العقد :",
    method: "طريقة الحساب :",
    methodFixed: "مبلغ ثابت",
    methodPercent: (p: number) => `نسبة مئوية — ${p}٪ من المبلغ المحقق لكل تلميذ`,
    methodGroup: "حسب الفوج — أجر الأستاذ المحدد في كل جدول توقيت",
    contractGroup: "حسب الفوج (أجر كل جدول توقيت)",
    emploisTitle: "التفصيل حسب جدول التوقيت",
    noEmplois: "لا يوجد جدول توقيت مدفوع في هذه الفترة.",
    student: "التلميذ",
    number: "رقم",
    presents: "الحضور",
    fees: "المبلغ المحقق",
    share: "نصيب الأستاذ",
    subtotal: "المجموع الجزئي",
    grandTotal: "إجمالي الحصص (الخام)",
    casesTitle: "حالات خاصة للتلاميذ",
    caseStudent: "التلميذ",
    caseEmploi: "جدول التوقيت",
    caseKind: "الحالة",
    childrenTitle: "أبناء الأستاذ المسجلون بالمدرسة",
    childrenNote: "تُخصم مصاريف دراسة أبناء الأستاذ من راتبه، وتُسوّى أرصدتهم تلقائيًا.",
    childName: "الابن",
    childEmploi: "جدول التوقيت",
    childMonth: "الشهر",
    childAmount: "المبلغ المستحق",
    deductionsTitle: "المصاريف والتسبيقات المخصومة",
    dedDate: "التاريخ",
    dedKind: "النوع",
    dedLabel: "البيان",
    dedDesc: "الوصف",
    dedAmount: "المبلغ",
    expense: "مصروف",
    acompte: "تسبيق",
    noDeductions: "لا توجد مصاريف ولا تسبيقات.",
    totalDeductions: "مجموع الخصومات",
    settlement: "التسوية",
    gross: "إجمالي الحصص الخام :",
    totalExpenses: "المصاريف المخصومة :",
    totalAcomptes: "التسبيقات المخصومة :",
    totalChildren: "دراسة الأبناء :",
    withheld: (n: number) => `حضور معلّق (${n} تلميذ مدين) :`,
    paidOn: "تاريخ الدفع :",
    net: "الصافي المدفوع للأستاذ :",
    signTeacher: "إمضاء الأستاذ",
    signCashier: "الصندوق / الإدارة",
    seances: "حصة",
  },
} as const;

export function buildTeacherPayslip(data: TeacherPayslipData): string {
  const { school, teacher, lang } = data;
  const L = LABELS[lang];
  const receiptNo =
    data.receiptNo ?? `PAY-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;

  const totalPresents = data.emplois.reduce((s, e) => s + e.presents, 0);
  const totalFees = data.emplois.reduce((s, e) => s + e.fees, 0);
  const totalShare = data.emplois.reduce((s, e) => s + e.total, 0);
  const totalExpenses = data.expenses.reduce((s, e) => s + e.amount, 0);
  const totalAcomptes = data.acomptes.reduce((s, a) => s + a.amount, 0);
  const totalChildren = data.childCharges.reduce((s, c) => s + c.amount, 0);

  const contract = teacher.isPassager
    ? L.passager
    : teacher.paymentType === "monthly"
      ? `${da(teacher.monthlyAmount ?? 0)} / mois`
      : teacher.paymentType === "per_group"
        ? L.contractGroup
        : `${teacher.percentage ?? 0}% par séance`;

  // ---- 2. one table per emploi du temps -----------------------------------
  const emploisHtml = data.emplois.length
    ? data.emplois
        .map((e) => {
          const rows = e.students
            .map(
              (st) => `<tr>
                <td class="ctr" style="font-family:monospace;">${esc(st.registrationNumber ?? "—")}</td>
                <td>
                  <strong>${esc(st.name)}</strong>
                  ${st.isPassager ? `<span class="badge badge-warning" style="margin-inline-start:6px;">passager</span>` : ""}
                  ${st.caseLabel ? `<br/><span style="font-size:0.78em;color:#5c567a;">${esc(st.caseLabel)}</span>` : ""}
                  ${st.withheld ? `<br/><span class="badge badge-danger">élève en dette — non réglé</span>` : ""}
                </td>
                <td class="ctr"><strong>${st.presents}</strong></td>
                <td class="num">${da(st.fees)}</td>
                <td class="num" style="color:#7c3aed;">${st.withheld ? "—" : da(st.total)}</td>
              </tr>`,
            )
            .join("");
          return `
          <div class="frame" style="margin-bottom:16px;">
            <div class="emploi-head">
              <div>
                <h4>${esc(e.title)}</h4>
                <span>${esc(e.className)} · ${esc(e.groupName)} · ${esc(e.salleName)}</span>
                <span>${esc(e.daysLabel)} · ${esc(e.timeLabel)}</span>
              </div>
              <span class="chip">${e.sessionsCount} ${L.seances}</span>
            </div>
            <table>
              <thead>
                <tr>
                  <th class="ctr" style="width:9%;">${L.number}</th>
                  <th>${L.student}</th>
                  <th class="ctr" style="width:12%;">${L.presents}</th>
                  <th class="num" style="width:18%;">${L.fees}</th>
                  <th class="num" style="width:18%;">${L.share}</th>
                </tr>
              </thead>
              <tbody>${rows || `<tr><td colspan="5" class="ctr">—</td></tr>`}</tbody>
              <tfoot>
                <tr style="background:#fcfbff;border-top:2px solid #c0b6e9;">
                  <td colspan="2" style="font-weight:800;text-transform:uppercase;">${L.subtotal}</td>
                  <td class="ctr" style="font-weight:800;">${e.presents}</td>
                  <td class="num" style="font-weight:800;">${da(e.fees)}</td>
                  <td class="num" style="font-weight:800;color:#7c3aed;">${da(e.total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>`;
        })
        .join("")
    : `<div class="frame"><p class="note">${L.noEmplois}</p></div>`;

  // ---- 3. the students whose case changes what is owed --------------------
  const caseRows = data.emplois.flatMap((e) =>
    e.students
      .filter((st) => st.caseLabel)
      .map(
        (st) => `<tr>
          <td><strong>${esc(st.name)}</strong>${st.registrationNumber ? ` <span style="font-family:monospace;color:#5c567a;">${esc(st.registrationNumber)}</span>` : ""}</td>
          <td>${esc(e.title)}</td>
          <td><span class="badge badge-warning">${esc(st.caseLabel)}</span></td>
          <td class="ctr">${st.presents}</td>
          <td class="num" style="color:#7c3aed;">${st.withheld ? "—" : da(st.total)}</td>
        </tr>`,
      ),
  );
  const casesHtml = caseRows.length
    ? `<div class="frame frame-warning">
        <h3>${L.casesTitle}</h3>
        <table>
          <thead>
            <tr><th>${L.caseStudent}</th><th>${L.caseEmploi}</th><th>${L.caseKind}</th><th class="ctr">${L.presents}</th><th class="num">${L.share}</th></tr>
          </thead>
          <tbody>${caseRows.join("")}</tbody>
        </table>
      </div>`
    : "";

  // ---- 4. his children, schooled on his pay -------------------------------
  const childRows = data.childCharges.flatMap((c) =>
    c.lines.map(
      (l, i) => `<tr>
        ${i === 0 ? `<td rowspan="${c.lines.length}"><strong>${esc(c.studentName)}</strong>${c.registrationNumber ? `<br/><span style="font-family:monospace;font-size:0.8em;color:#5c567a;">N° ${esc(c.registrationNumber)}</span>` : ""}</td>` : ""}
        <td>${esc(l.label)}</td>
        <td class="ctr">${esc(l.monthCode)}</td>
        <td class="num deduct">${da(l.amount)}</td>
      </tr>`,
    ),
  );
  const childrenHtml = data.childCharges.length
    ? `<div class="frame frame-info">
        <h3>${L.childrenTitle}</h3>
        <table>
          <thead>
            <tr><th>${L.childName}</th><th>${L.childEmploi}</th><th class="ctr">${L.childMonth}</th><th class="num">${L.childAmount}</th></tr>
          </thead>
          <tbody>${childRows.join("")}</tbody>
          <tfoot>
            <tr style="background:#fcfbff;border-top:2px solid #3b82f6;">
              <td colspan="3" style="font-weight:800;text-transform:uppercase;">${L.totalChildren}</td>
              <td class="num deduct" style="font-weight:800;">${da(totalChildren)}</td>
            </tr>
          </tfoot>
        </table>
        <p class="note">${L.childrenNote}</p>
      </div>`
    : "";

  // ---- 5. dépenses & acomptes ---------------------------------------------
  const deductions = [...data.expenses, ...data.acomptes].sort((a, b) => a.date.localeCompare(b.date));
  const deductionsHtml = `
    <div class="frame frame-danger">
      <h3>${L.deductionsTitle}</h3>
      <table>
        <thead>
          <tr><th style="width:14%;">${L.dedDate}</th><th style="width:14%;">${L.dedKind}</th><th>${L.dedLabel}</th><th>${L.dedDesc}</th><th class="num" style="width:16%;">${L.dedAmount}</th></tr>
        </thead>
        <tbody>
          ${
            deductions.length
              ? deductions
                  .map(
                    (d) => `<tr>
                      <td>${fmtDate(d.date, lang)}</td>
                      <td><span class="badge ${d.kind === "expense" ? "badge-danger" : "badge-warning"}">${d.kind === "expense" ? L.expense : L.acompte}</span></td>
                      <td><strong>${esc(d.label)}</strong></td>
                      <td>${esc(d.description || "—")}</td>
                      <td class="num deduct">${da(d.amount)}</td>
                    </tr>`,
                  )
                  .join("")
              : `<tr><td colspan="5" class="ctr">${L.noDeductions}</td></tr>`
          }
        </tbody>
        ${
          deductions.length
            ? `<tfoot>
                <tr style="background:#fcfbff;border-top:2px solid #ef4444;">
                  <td colspan="4" style="font-weight:800;text-transform:uppercase;">${L.totalDeductions}</td>
                  <td class="num deduct" style="font-weight:800;">${da(totalExpenses + totalAcomptes)}</td>
                </tr>
              </tfoot>`
            : ""
        }
      </table>
    </div>`;

  // ---- 6. the settlement ---------------------------------------------------
  const bodyHtml = `
    ${letterheadHtml(school)}
    ${bannerHtml(L.docTitle, `${L.receiptNo} <strong style="font-family:monospace;">${esc(receiptNo)}</strong>`)}

    <div class="frame frame-info" style="margin-bottom:20px;">
      <h3>${L.teacherInfo}</h3>
      <table style="margin-top:0;">
        <tr>
          <td style="width:16%;font-weight:bold;color:#5c567a;">${L.fullName}</td>
          <td style="width:34%;font-weight:bold;font-size:1.1em;">${esc(teacher.lastName)} ${esc(teacher.firstName)}</td>
          <td style="width:16%;font-weight:bold;color:#5c567a;">${L.phone}</td>
          <td style="width:34%;font-family:monospace;">${esc(teacher.phone || "-")}</td>
        </tr>
        <tr>
          <td style="font-weight:bold;color:#5c567a;">${L.email}</td>
          <td>${esc(teacher.email || "-")}</td>
          <td style="font-weight:bold;color:#5c567a;">${L.contract}</td>
          <td><span class="badge badge-primary">${esc(contract)}</span></td>
        </tr>
        <tr>
          <td style="font-weight:bold;color:#5c567a;">${L.status}</td>
          <td><span class="badge ${teacher.isPassager ? "badge-warning" : "badge-primary"}">${teacher.isPassager ? L.passager : L.regular}</span></td>
          <td style="font-weight:bold;color:#5c567a;">${L.method}</td>
          <td><span class="badge badge-success">${data.method === "percent" ? L.methodPercent(data.percentage ?? 0) : data.method === "group" ? L.methodGroup : L.methodFixed}</span></td>
        </tr>
      </table>
    </div>

    <h3 style="margin:0 0 10px;font-size:1.05em;color:#1e1b4b;">${L.emploisTitle}</h3>
    ${emploisHtml}

    <div class="grand-total">
      <span>${L.grandTotal} — ${totalPresents} ${L.presents.toLowerCase()} · ${da(totalFees)} ${L.fees.toLowerCase()}</span>
      <span>${da(totalShare)}</span>
    </div>

    ${casesHtml}
    ${childrenHtml}
    ${deductionsHtml}

    <div class="summary-card">
      <h3>${L.settlement}</h3>
      <div class="summary-line"><span>${L.gross}</span><strong>${da(data.gross)}</strong></div>
      ${totalExpenses > 0 ? `<div class="summary-line"><span>${L.totalExpenses}</span><strong class="deduct">− ${da(totalExpenses)}</strong></div>` : ""}
      ${totalAcomptes > 0 ? `<div class="summary-line"><span>${L.totalAcomptes}</span><strong class="deduct">− ${da(totalAcomptes)}</strong></div>` : ""}
      ${totalChildren > 0 ? `<div class="summary-line"><span>${L.totalChildren}</span><strong class="deduct">− ${da(totalChildren)}</strong></div>` : ""}
      ${
        data.withheld && data.withheld.count > 0
          ? `<div class="summary-line"><span>${L.withheld(data.withheld.count)}</span><strong>${da(data.withheld.amount)}</strong></div>`
          : ""
      }
      <div class="summary-line"><span>${L.paidOn}</span><strong>${fmtDateTime(data.paidAt, lang)}</strong></div>
      <div class="net-pay-box ${data.net < 0 ? "negative" : ""}">
        <span>${L.net}</span>
        <span>${da(data.net)}</span>
      </div>
    </div>

    ${signaturesHtml(L.signTeacher, L.signCashier)}
    ${metaFooterHtml(school.name, lang)}
  `;

  return printDocument({
    title: `${L.docTitle} - ${teacher.firstName} ${teacher.lastName}`,
    lang,
    bodyHtml,
    extraCss: EXTRA_CSS,
  });
}
