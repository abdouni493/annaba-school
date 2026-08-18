"use client";

/**
 * Student payments statement (printable receipt) over a selected period — same
 * flow as the teacher report: pick start/end date, generate, print. School
 * letterhead, student identity block, the séance purchases and debt
 * settlements of the period, and the totals with a signature area.
 */

import type {
  Enrollment,
  Group,
  Module,
  Parent,
  Payment,
  ScheduleSession,
  School,
  SchoolClass,
  Student,
  Subscription,
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

const LABELS = {
  fr: {
    docTitle: "Relevé des Paiements Élève",
    period: (s: string, e: string) => `Période du <strong>${s}</strong> au <strong>${e}</strong>`,
    studentInfo: "Informations de l'Élève",
    fullName: "Nom Complet :",
    card: "N° Carte / RFID :",
    phone: "Téléphone :",
    parent: "Parent / Tuteur :",
    classLevel: "Classe / Niveau :",
    enrollments: "Modules & Groupes :",
    none: "Aucune inscription",
    paymentsTitle: "Détail des Paiements de la Période",
    date: "Date",
    description: "Module / Désignation",
    type: "Type",
    seances: "Séances",
    unit: "Prix séance",
    discount: "Remise",
    net: "Net",
    paid: "Payé",
    rest: "Reste",
    typePurchase: "Achat séances",
    typeMonth: "Abonn. mensuel",
    typeDebt: "Règl. dette",
    noTx: "Aucun paiement sur cette période.",
    totalsTitle: "Totaux de la Période",
    totalPaid: "TOTAL VERSÉ SUR LA PÉRIODE :",
    totalNet: "Total facturé (net) :",
    totalSeances: "Séances achetées :",
    txCount: "Nombre d'opérations :",
    currentDebt: "Dette restante du compte :",
    remaining: "Séances restantes :",
    printedOn: "Date d'impression :",
    signParent: "Signature du Parent / Élève",
    signCashier: "Cachet & Signature de l'École",
    da: "DA",
  },
  ar: {
    docTitle: "كشف مدفوعات التلميذ",
    period: (s: string, e: string) => `الفترة من <strong>${s}</strong> إلى <strong>${e}</strong>`,
    studentInfo: "معلومات التلميذ",
    fullName: "الاسم الكامل :",
    card: "رقم البطاقة / RFID :",
    phone: "الهاتف :",
    parent: "الولي :",
    classLevel: "القسم / المستوى :",
    enrollments: "المواد والأفواج :",
    none: "لا توجد تسجيلات",
    paymentsTitle: "تفاصيل مدفوعات الفترة",
    date: "التاريخ",
    description: "المادة / البيان",
    type: "النوع",
    seances: "الحصص",
    unit: "سعر الحصة",
    discount: "التخفيض",
    net: "الصافي",
    paid: "المدفوع",
    rest: "الباقي",
    typePurchase: "شراء حصص",
    typeMonth: "اشتراك شهري",
    typeDebt: "تسديد دين",
    noTx: "لا توجد مدفوعات في هذه الفترة.",
    totalsTitle: "مجاميع الفترة",
    totalPaid: "إجمالي المدفوع خلال الفترة :",
    totalNet: "إجمالي المفوتر (صافي) :",
    totalSeances: "الحصص المشتراة :",
    txCount: "عدد العمليات :",
    currentDebt: "الدين المتبقي :",
    remaining: "الحصص المتبقية :",
    printedOn: "تاريخ الطباعة :",
    signParent: "إمضاء الولي / التلميذ",
    signCashier: "ختم وإمضاء المدرسة",
    da: "دج",
  },
} as const;

export interface StudentPaymentsData {
  student: Student;
  school: School;
  lang: Language;
  startDate: string;
  endDate: string;
  payments: Payment[];
  enrollments: Enrollment[];
  subscriptions: Subscription[];
  sessions: ScheduleSession[];
  classes: SchoolClass[];
  modules: Module[];
  groups: Group[];
  parents: Parent[];
}

export function buildStudentPaymentsReport(data: StudentPaymentsData): string {
  const { student, school, lang } = data;
  const L = LABELS[lang];

  const start = data.startDate ? new Date(`${data.startDate}T00:00:00`) : new Date(0);
  const end = data.endDate ? new Date(`${data.endDate}T23:59:59.999`) : new Date();

  const mine = data.payments.filter((p) => p.studentId === student.id);
  const rows = mine
    .filter((p) => {
      const d = new Date(p.date);
      return d >= start && d <= end;
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const totalPaid = rows.reduce((s, p) => s + p.amountPaid, 0);
  const totalNet = rows.reduce((s, p) => s + p.netTotal, 0);
  const totalSeances = rows.reduce((s, p) => s + p.seancesPurchased, 0);
  const currentDebt = Math.max(0, mine.reduce((s, p) => s + p.rest, 0));

  const myEnrollments = data.enrollments.filter((e) => e.studentId === student.id);
  const remaining = myEnrollments.reduce(
    (s, e) => s + Math.max(0, e.paidSeances - e.consumedSeances),
    0,
  );

  /** Module label of a payment, resolved through its enrollment. */
  const labelOf = (p: Payment): string => {
    if (p.type === "debt_payment") return p.description || L.typeDebt;
    const enr = myEnrollments.find((e) => e.id === p.enrollmentId);
    const sub = enr ? data.subscriptions.find((s) => s.id === enr.subscriptionId) : undefined;
    const sess = sub ? data.sessions.find((se) => se.id === sub.sessionId) : undefined;
    if (!sess) return p.description || "—";
    const mod = data.modules.find((m) => m.id === sess.moduleId)?.name ?? "-";
    const grp = data.groups.find((g) => g.id === sess.groupId)?.name ?? "-";
    return `${mod} — ${grp}`;
  };

  // Identity block: class levels + module/group labels from the enrollments.
  const enrollmentLabels: string[] = [];
  const classLabels = new Set<string>();
  for (const subId of student.subscriptionIds) {
    const sub = data.subscriptions.find((s) => s.id === subId);
    const sess = sub ? data.sessions.find((se) => se.id === sub.sessionId) : undefined;
    if (!sess) continue;
    const cls = data.classes.find((c) => c.id === sess.classId);
    const mod = data.modules.find((m) => m.id === sess.moduleId)?.name ?? "-";
    const grp = data.groups.find((g) => g.id === sess.groupId)?.name ?? "-";
    if (cls) {
      const lvl = cls.type === "cours" ? cls.coursLevel : cls.formationLevel;
      classLabels.add(lvl ? `${cls.name} (${lvl})` : cls.name);
    }
    enrollmentLabels.push(`${mod} — ${grp}`);
  }
  const parentObj = data.parents.find((p) => p.id === student.parentId);

  // A month is not N séances at the unit price: it is a pack sold at its own
  // price, so the receipt names it for what it is.
  const typeBadge = (p: Payment) =>
    p.type === "debt_payment"
      ? `<span class="badge badge-success">${L.typeDebt}</span>`
      : p.plan === "month"
        ? `<span class="badge badge-primary">${L.typeMonth}</span>`
        : `<span class="badge badge-primary">${L.typePurchase}</span>`;

  const discountOf = (p: Payment) =>
    p.discountValue && p.discountValue > 0
      ? p.discountType === "percent"
        ? `-${p.discountValue}%`
        : `-${p.discountValue} ${L.da}`
      : "—";

  const bodyHtml = `
    ${letterheadHtml(school)}
    ${bannerHtml(L.docTitle, L.period(fmtDate(data.startDate, lang), fmtDate(data.endDate, lang)))}

    <div class="frame frame-info" style="margin-bottom:20px;">
      <h3>${L.studentInfo}</h3>
      <table style="margin-top:0;">
        <tr>
          <td style="width:18%; font-weight:bold; color:#5c567a;">${L.fullName}</td>
          <td style="width:32%; font-weight:bold; font-size:1.1em;">${student.lastName} ${student.firstName}</td>
          <td style="width:18%; font-weight:bold; color:#5c567a;">${L.card}</td>
          <td style="width:32%; font-family:monospace;">${student.rfid || "-"}</td>
        </tr>
        <tr>
          <td style="font-weight:bold; color:#5c567a;">${L.phone}</td>
          <td style="font-family:monospace;">${student.phone || "-"}</td>
          <td style="font-weight:bold; color:#5c567a;">${L.parent}</td>
          <td>${parentObj ? `${parentObj.lastName} ${parentObj.firstName} (${parentObj.phone})` : "-"}</td>
        </tr>
        <tr>
          <td style="font-weight:bold; color:#5c567a;">${L.classLevel}</td>
          <td>${classLabels.size ? [...classLabels].join(" · ") : L.none}</td>
          <td style="font-weight:bold; color:#5c567a;">${L.enrollments}</td>
          <td>${enrollmentLabels.length ? enrollmentLabels.join("<br/>") : L.none}</td>
        </tr>
      </table>
    </div>

    <div class="frame">
      <h3>${L.paymentsTitle}</h3>
      <table>
        <thead>
          <tr>
            <th>${L.date}</th>
            <th>${L.description}</th>
            <th class="ctr">${L.type}</th>
            <th class="num">${L.seances}</th>
            <th class="num">${L.unit}</th>
            <th class="ctr">${L.discount}</th>
            <th class="num">${L.net}</th>
            <th class="num">${L.paid}</th>
            <th class="num">${L.rest}</th>
          </tr>
        </thead>
        <tbody>
          ${
            rows.length === 0
              ? `<tr><td colspan="9" style="text-align:center; font-style:italic; color:#999;">${L.noTx}</td></tr>`
              : rows
                  .map(
                    (p) => `
            <tr>
              <td>${fmtDateTime(p.date, lang)}</td>
              <td>${labelOf(p)}</td>
              <td class="ctr">${typeBadge(p)}</td>
              <td class="num">${p.seancesPurchased || "—"}</td>
              <td class="num">${p.unitPrice ? `${p.unitPrice} ${L.da}` : "—"}</td>
              <td class="ctr">${discountOf(p)}</td>
              <td class="num">${p.netTotal ? `${p.netTotal} ${L.da}` : "—"}</td>
              <td class="num" style="color:#15803d;">${p.amountPaid} ${L.da}</td>
              <td class="num" style="color:${p.rest > 0 ? "#b91c1c" : "#5c567a"};">${p.rest} ${L.da}</td>
            </tr>`,
                  )
                  .join("")
          }
        </tbody>
      </table>
    </div>

    <div class="summary-card">
      <h3>${L.totalsTitle}</h3>
      <div class="summary-line"><span>${L.txCount}</span><strong>${rows.length}</strong></div>
      <div class="summary-line"><span>${L.totalSeances}</span><strong>${totalSeances}</strong></div>
      <div class="summary-line"><span>${L.totalNet}</span><strong>${totalNet} ${L.da}</strong></div>
      <div class="summary-line"><span>${L.remaining}</span><strong>${remaining}</strong></div>
      <div class="summary-line"><span>${L.currentDebt}</span><strong style="color:${currentDebt > 0 ? "#b91c1c" : "#15803d"};">${currentDebt} ${L.da}</strong></div>
      <div class="summary-line"><span>${L.printedOn}</span><strong>${fmtDateTime(new Date().toISOString(), lang)}</strong></div>
      <div class="net-pay-box">
        <span>${L.totalPaid}</span>
        <span>${totalPaid} ${L.da}</span>
      </div>
    </div>

    ${signaturesHtml(L.signParent, L.signCashier)}
    ${metaFooterHtml(school.name, lang)}
  `;

  return printDocument({
    title: `${L.docTitle} - ${student.firstName} ${student.lastName}`,
    lang,
    bodyHtml,
  });
}
