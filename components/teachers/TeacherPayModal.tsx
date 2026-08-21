"use client";

/**
 * Le règlement d'un enseignant — UN GRAND TABLEAU PAR GROUPE, mois par mois.
 *
 * L'écran se lit exactement comme la feuille de présence d'un groupe, parce que
 * c'est la même question posée à l'envers : la feuille demande « qui est venu ? »,
 * la paie demande « qui a payé, et combien cela rapporte-t-il à l'enseignant ? ».
 * Un emploi du temps = un bloc ; un mois = un tableau ; une ligne = un élève,
 * avec ses séances S1…Sn, ce qu'il a versé sur le mois, ce qu'il traîne des mois
 * précédents, et la part qui revient à l'enseignant.
 *
 * On ne paie pas « des créneaux » en vrac : on paie LE MOIS d'un emploi du temps,
 * exactement le mois que l'école compte déjà pour les élèves (M1, M2 …, ouvert
 * par la première présence, fermé par la séance qui complète le pack).
 *
 *  - l'écran s'ouvre sur le dernier mois CLOS non réglé, jamais sur le mois en
 *    cours : si le groupe en est à la 3ᵉ séance d'un mois de 4, c'est le mois
 *    précédent qu'on règle,
 *  - la part d'un élève en dette est RETENUE : elle ne disparaît pas, elle
 *    revient au règlement suivant dès que l'élève s'est acquitté — et la colonne
 *    « arriérés débloqués » la montre noir sur blanc,
 *  - les cas d'élèves sont appliqués à la source : un « école seule » n'est même
 *    pas listé (l'enseignant n'est délibérément pas payé pour lui), un
 *    « cas spécial » ne rapporte rien, une « réduction » ne lui coûte que SA
 *    moitié de la remise, et un « fils d'enseignant » sort du salaire du père,
 *  - la formule « par groupe » lit le tarif de l'abonnement (part enseignant du
 *    mois ÷ séances) déjà figé sur chaque présence, donc rien à saisir.
 */

import { useMemo, useState } from "react";
import { useData } from "@/lib/store/data";
import { useSettings } from "@/lib/store/settings";
import { Badge, type Tone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/SearchInput";
import { printHtmlDocument } from "@/lib/print";
import { formatDA } from "@/lib/utils";
import {
  cycleLead,
  cycleSlots,
  formatDateFr,
  slotCountFor,
  studentCaseLabel,
} from "@/lib/helpers";
import {
  buildTeacherPayslip,
  type PayslipEmploi,
  type PayslipStudent,
} from "@/lib/reports/teacherPayslip";
import {
  defaultPayableMonthKeys,
  studentArrearsBefore,
  teacherChildRows,
  teacherEmplois,
  type MonthPayState,
  type TeacherChildRow,
  type TeacherDue,
  type TeacherEmploi,
  type TeacherMonth,
  type TeacherMonthStudent,
} from "@/lib/teacherMonths";
import {
  AlertTriangle,
  CalendarClock,
  DollarSign,
  GraduationCap,
  Percent,
  Receipt,
  Users,
} from "lucide-react";
import type {
  AttendanceStatus,
  Teacher,
  TeacherChildCharge,
  TeacherPaymentDeduction,
  TeacherPaymentDetail,
  TeacherPaymentMonth,
} from "@/lib/types";

type PayMethod = "fixed" | "percent" | "group";

const PAY_STATE: Record<MonthPayState, { label: string; tone: Tone }> = {
  paid: { label: "Payé", tone: "success" },
  partial: { label: "Partiel", tone: "warning" },
  unpaid: { label: "Impayé", tone: "danger" },
  pending: { label: "Rien encore", tone: "neutral" },
  free: { label: "Gratuit", tone: "primary" },
};

/** Les mêmes pastilles que la feuille de présence — même écran, même langage. */
const STATUS_STYLE: Record<AttendanceStatus, { label: string; short: string; cls: string }> = {
  present: { label: "Présent", short: "P", cls: "bg-success/15 text-success border-success/40" },
  late: { label: "Retard", short: "R", cls: "bg-warning/15 text-warning border-warning/40" },
  absent: { label: "Absent", short: "A", cls: "bg-danger/15 text-danger border-danger/40" },
  cancelled: { label: "Annulée", short: "×", cls: "bg-primary/15 text-primary border-primary/40" },
};

export function TeacherPayModal({
  open,
  teacher,
  onClose,
}: {
  open: boolean;
  teacher: Teacher | null;
  onClose: () => void;
}) {
  // Remonté à chaque ouverture : l'écran repart toujours des mois clos du jour,
  // sans effet de bord ni état survivant d'un enseignant à l'autre.
  if (!open || !teacher) return null;
  return <PaySheet key={teacher.id} teacher={teacher} onClose={onClose} />;
}

function PaySheet({ teacher, onClose }: { teacher: Teacher; onClose: () => void }) {
  const db = useData();
  const { payTeacherSessions, teacherExpenses, acomptes, students, school } = db;
  const { language } = useSettings();

  const [selectedKeys, setSelectedKeys] = useState<string[]>(() =>
    defaultPayableMonthKeys(teacherEmplois(db, teacher.id)),
  );
  // Chaque contrat s'ouvre sur SA formule : un salarié sur son montant fixe, un
  // « par groupe » sur les tarifs déjà écrits par ses emplois du temps, les
  // autres sur leur pourcentage.
  const [method, setMethod] = useState<PayMethod>(() =>
    teacher.paymentType === "per_group"
      ? "group"
      : teacher.isPassager || teacher.paymentType === "monthly"
        ? "fixed"
        : "percent",
  );
  const [fixedAmount, setFixedAmount] = useState<number>(() =>
    teacher.paymentType === "monthly" ? teacher.monthlyAmount ?? 0 : 0,
  );
  const [percentage, setPercentage] = useState<number>(teacher.percentage ?? 50);
  const [expenseIds, setExpenseIds] = useState<string[]>(() =>
    db.teacherExpenses.filter((e) => e.teacherId === teacher.id && !e.paid).map((e) => e.id),
  );
  const [acompteIds, setAcompteIds] = useState<string[]>(() =>
    db.acomptes.filter((a) => a.teacherId === teacher.id && !a.paid).map((a) => a.id),
  );
  const [childIds, setChildIds] = useState<string[]>(() =>
    db.students
      .filter((st) => st.studentCase === "teacher_child" && st.teacherFatherId === teacher.id)
      .map((st) => st.id),
  );
  const [saving, setSaving] = useState(false);

  const emplois = useMemo(
    () => teacherEmplois(db, teacher.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [teacher, db.sessions, db.attendance, db.unpaidTeacher, db.payments, db.enrollments, db.students, db.subscriptions, db.independent],
  );

  /** Ce qui doit encore quelque chose : les autres mois n'ont rien à régler. */
  const owingEmplois = useMemo(
    () =>
      emplois
        .map((e) => ({
          ...e,
          months: e.months.filter((m) => m.open > 0 || m.passagers.length > 0),
        }))
        .filter((e) => e.months.length > 0),
    [emplois],
  );

  const unpaidExpenses = teacherExpenses.filter((e) => e.teacherId === teacher.id && !e.paid);
  const unpaidAcomptes = acomptes.filter((a) => a.teacherId === teacher.id && !a.paid);

  /** Ses enfants, scolarisés sur son salaire — avec ce qu'ils ont étudié. */
  const childRows: TeacherChildRow[] = useMemo(
    () => teacherChildRows(db, teacher.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [teacher, students, db.enrollments, db.payments, db.attendance, db.subscriptions],
  );

  /** Les élèves à réduction croisés sur ces mois : leur remise se lit en clair. */
  const reductionRows = useMemo(() => {
    const seen = new Map<
      string,
      { student: TeacherMonthStudent; emploi: string; months: string[] }
    >();
    for (const e of owingEmplois) {
      for (const m of e.months) {
        for (const st of m.students) {
          if (st.caseKind !== "reduction" && st.caseKind !== "special") continue;
          const key = `${e.sessionId}|${st.studentId}`;
          const row = seen.get(key);
          if (row) row.months.push(m.code);
          else seen.set(key, { student: st, emploi: e.title, months: [m.code] });
        }
      }
    }
    return [...seen.values()];
  }, [owingEmplois]);

  // ---- ce qui est coché --------------------------------------------------
  const allMonths = owingEmplois.flatMap((e) => e.months);
  const chosen = allMonths.filter((m) => selectedKeys.includes(m.key));
  const payableDuesOf = (m: TeacherMonth) => m.dues.filter((d) => !d.paid && !d.withheld);
  const chosenDues = chosen.flatMap(payableDuesOf);
  const chosenWithheldDues = chosen.flatMap((m) => m.dues.filter((d) => !d.paid && d.withheld));
  const chosenPassagers = chosen.flatMap((m) => m.passagers);
  const chosenFees = chosenDues.reduce((s, d) => s + d.fee, 0);
  const chosenRevenue = chosenFees + chosenPassagers.reduce((s, p) => s + p.price, 0);
  const pct = Math.min(Math.max(percentage || 0, 0), 100);

  /** Ce qu'une présence rapporte, selon la formule choisie. */
  const dueShare = (d: TeacherDue): number => {
    if (method === "group") return d.amount;
    if (method === "percent") return Math.round((d.fee * pct) / 100);
    const amount = Math.max(0, Math.round(fixedAmount || 0));
    if (chosenFees > 0) return Math.round((amount * d.fee) / chosenFees);
    return chosenDues.length > 0 ? Math.round(amount / chosenDues.length) : 0;
  };

  const gross =
    method === "fixed"
      ? Math.max(0, Math.round(fixedAmount || 0))
      : chosenDues.reduce((s, d) => s + dueShare(d), 0);

  const monthShare = (m: TeacherMonth) => payableDuesOf(m).reduce((s, d) => s + dueShare(d), 0);

  /** Ce qu'un élève rapporte sur CE mois, une fois la formule appliquée. */
  const studentShare = (m: TeacherMonth, studentId: string) =>
    m.dues
      .filter((d) => d.studentId === studentId && !d.paid && !d.withheld)
      .reduce((s, d) => s + dueShare(d), 0);

  const chosenExpenses = unpaidExpenses.filter((e) => expenseIds.includes(e.id));
  const chosenAcomptes = unpaidAcomptes.filter((a) => acompteIds.includes(a.id));
  const chosenChildren = childRows.filter((c) => childIds.includes(c.studentId));
  const expensesTotal = chosenExpenses.reduce((s, e) => s + e.amount, 0);
  const acomptesTotal = chosenAcomptes.reduce((s, a) => s + a.amount, 0);
  const childrenTotal = chosenChildren.reduce((s, c) => s + c.amount, 0);
  const deductionsTotal = expensesTotal + acomptesTotal + childrenTotal;
  const net = gross - deductionsTotal;

  /** La forme figée que le règlement enregistre pour les enfants. */
  const childCharges: TeacherChildCharge[] = chosenChildren.map((c) => ({
    studentId: c.studentId,
    studentName: c.studentName,
    registrationNumber: c.registrationNumber,
    lines: c.lines.map((l) => ({
      subscriptionId: l.subscriptionId,
      label: l.label,
      monthCode: l.monthCode,
      amount: l.amount,
    })),
    amount: c.amount,
  }));

  const withheldTotal = chosenWithheldDues.reduce((s, d) => s + d.amount, 0);
  const withheldStudents = new Set(chosenWithheldDues.map((d) => d.studentId)).size;
  const unpaidRows = chosen.flatMap((m) =>
    m.students.filter((st) => st.debt > 0).map((st) => ({ month: m, student: st })),
  );

  /**
   * Ce que l'enseignant doit toucher, TOUS emplois du temps confondus — la
   * question à laquelle cet écran répond en premier. Les mois déjà réglés n'y
   * entrent pas : ils ne sont même plus listés.
   */
  const owed = emplois.reduce(
    (acc, e) => {
      acc.gross += e.gross;
      acc.settled += e.settled;
      acc.open += e.open;
      acc.withheld += e.withheld;
      acc.payable += e.payable;
      return acc;
    },
    { gross: 0, settled: 0, open: 0, withheld: 0, payable: 0 },
  );
  const openMonths = allMonths.filter((m) => m.open > 0);
  const closedOwing = allMonths.filter((m) => m.state === "done" && m.payable > 0);

  /** Les mois clos non réglés que l'écran a cochés tout seul. */
  const suggested = defaultPayableMonthKeys(emplois);
  const runningOnly = suggested.length === 0 && allMonths.some((m) => m.payable > 0);

  const toggleMonth = (key: string) =>
    setSelectedKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  const toggleEmploi = (e: TeacherEmploi) => {
    const keys = e.months.map((m) => m.key);
    const allOn = keys.every((k) => selectedKeys.includes(k));
    setSelectedKeys((prev) =>
      allOn ? prev.filter((k) => !keys.includes(k)) : [...new Set([...prev, ...keys])],
    );
  };

  // ---- la fiche de paie, construite AVANT que le store ne solde ----------
  const buildPayslipEmplois = (): PayslipEmploi[] =>
    owingEmplois
      .map((e) => {
        const months = e.months.filter((m) => selectedKeys.includes(m.key));
        if (months.length === 0) return null;
        const rows = new Map<string, PayslipStudent>();
        let presents = 0;
        let fees = 0;

        for (const m of months) {
          for (const d of m.dues.filter((x) => !x.paid)) {
            const stu = students.find((x) => x.id === d.studentId);
            let row = rows.get(d.studentId);
            if (!row) {
              const arrears = studentArrearsBefore(e, d.studentId, m.index);
              row = {
                studentId: d.studentId,
                name: d.studentName,
                registrationNumber: d.registrationNumber,
                caseLabel: stu ? studentCaseLabel(stu) || undefined : undefined,
                isPassager: false,
                withheld: false,
                presents: 0,
                fees: 0,
                total: 0,
                arrears: arrears.payable || undefined,
                arrearsMonths: arrears.months.length ? arrears.months.join(", ") : undefined,
              };
              rows.set(d.studentId, row);
            }
            row.presents += 1;
            row.fees += d.fee;
            if (d.withheld) row.withheld = true;
            else row.total += dueShare(d);
            presents += 1;
            fees += d.fee;
          }
          for (const p of m.passagers) {
            const key = `passager:${p.name}`;
            let row = rows.get(key);
            if (!row) {
              row = {
                name: p.name,
                isPassager: true,
                withheld: false,
                presents: 0,
                fees: 0,
                total: 0,
              };
              rows.set(key, row);
            }
            row.presents += 1;
            row.fees += p.price;
            presents += 1;
            fees += p.price;
          }
        }

        const list = [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
        return {
          sessionId: e.sessionId,
          title: e.title,
          className: e.className,
          groupName: e.groupName,
          salleName: e.salleName,
          daysLabel: e.daysLabel,
          timeLabel: e.timeLabel,
          monthsLabel: months.map((m) => m.code).join(", "),
          sessionsCount: months.reduce((s, m) => s + m.held, 0),
          students: list,
          presents,
          fees,
          total: list.reduce((s, r) => s + r.total, 0),
        } satisfies PayslipEmploi;
      })
      .filter(Boolean) as PayslipEmploi[];

  const submit = async () => {
    if (!teacher) return;
    if (chosen.length === 0) {
      alert("Sélectionnez au moins un mois à régler.");
      return;
    }
    if (gross <= 0) {
      alert("Le montant brut de ces mois doit être supérieur à 0 DA.");
      return;
    }
    // Tout est retenu : régler quand même paierait une somme que les présences
    // ne solderaient pas — elles reviendraient au prochain paiement.
    if (chosenDues.length === 0 && chosenPassagers.length === 0) {
      alert(
        "Aucune présence réglable dans les mois cochés : elles sont toutes retenues " +
          "parce que les élèves n'ont pas payé. Encaissez leurs soldes d'abord.",
      );
      return;
    }
    if (
      net < 0 &&
      !confirm(
        `Les retenues (${deductionsTotal} DA) dépassent le brut (${gross} DA).\n` +
          `L'enseignant sera enregistré à ${net} DA. Continuer ?`,
      )
    ) {
      return;
    }

    const emploiOf = (sessionId: string) => owingEmplois.find((e) => e.sessionId === sessionId);

    const monthSnapshot: TeacherPaymentMonth[] = chosen.map((m) => {
      const e = emploiOf(m.sessionId);
      return {
        sessionId: m.sessionId,
        title: e?.title ?? "Emploi du temps",
        groupName: e?.groupName ?? "—",
        monthCode: m.code,
        seances: m.held,
        presents: payableDuesOf(m).length,
        students: new Set(payableDuesOf(m).map((d) => d.studentId)).size,
        gross: monthShare(m),
      };
    });

    // Le reçu « ancien format » reste imprimable : une ligne par mois réglé.
    const details: TeacherPaymentDetail[] = chosen.map((m) => {
      const e = emploiOf(m.sessionId);
      return {
        dateKey: m.startDate ?? m.dates[0] ?? "",
        sessionId: m.sessionId,
        title: `${e?.title ?? "Emploi du temps"} — ${m.code}`,
        moduleName: e?.title ?? "",
        groupName: e?.groupName ?? "—",
        startTime: e?.timeLabel ?? "",
        endTime: "",
        presents: payableDuesOf(m).length,
        passagers: m.passagers.length,
        gross: payableDuesOf(m).reduce((s, d) => s + d.fee, 0),
        share: monthShare(m),
      };
    });

    const payslipEmplois = buildPayslipEmplois();
    const expenseLines: TeacherPaymentDeduction[] = chosenExpenses.map((e) => ({
      id: e.id,
      kind: "expense",
      label: e.name,
      description: e.description,
      amount: e.amount,
      date: e.date,
    }));
    const acompteLines: TeacherPaymentDeduction[] = chosenAcomptes.map((a) => ({
      id: a.id,
      kind: "acompte",
      label: "Acompte",
      description: a.description,
      amount: a.amount,
      date: a.date.slice(0, 10),
    }));
    const paidAt = new Date().toISOString();

    setSaving(true);
    try {
      const res = await payTeacherSessions({
        teacherId: teacher.id,
        dueIds: chosenDues.map((d) => d.id),
        passagerIds: chosenPassagers.map((p) => p.id),
        amount: net,
        gross,
        method,
        percentage: method === "percent" ? pct : undefined,
        details,
        months: monthSnapshot,
        description: `Règlement ${chosen.map((m) => m.code).join(", ")} — ${teacher.firstName} ${teacher.lastName}`,
        expenseIds: chosenExpenses.map((e) => e.id),
        acompteIds: chosenAcomptes.map((a) => a.id),
        childCharges,
      });

      if (!res.ok) {
        alert("Le règlement a échoué — veuillez réessayer.");
        return;
      }

      onClose();

      if (confirm(`Paiement de ${net} DA enregistré. Imprimer la fiche de paie ?`)) {
        printHtmlDocument(
          buildTeacherPayslip({
            teacher,
            school,
            lang: language,
            paidAt,
            receiptNo: res.paymentId ? `PAY-${res.paymentId.slice(0, 8).toUpperCase()}` : undefined,
            method,
            percentage: method === "percent" ? pct : undefined,
            emplois: payslipEmplois,
            expenses: expenseLines,
            acomptes: acompteLines,
            childCharges,
            gross,
            net,
            withheld: { count: withheldStudents, amount: withheldTotal },
          }),
        );
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Règlement de l'enseignant — groupe par groupe" full>
      <div className="space-y-4">
        {/* ---- en-tête ------------------------------------------------- */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-canvas p-4">
          <div>
            <strong className="block text-sm text-ink">
              {teacher.firstName} {teacher.lastName}
            </strong>
            <span className="text-[11px] text-muted">
              {teacher.isPassager ? "Enseignant passager (sans compte)" : "Enseignant de l'école"}
              {teacher.phone ? ` · ${teacher.phone}` : ""}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone="warning" className="font-bold">
              {allMonths.filter((m) => m.payable > 0).length} mois à régler
            </Badge>
            <Badge tone="primary" className="font-bold">
              {chosen.length} mois sélectionné(s) · {chosenDues.length} présence(s)
            </Badge>
          </div>
        </div>

        {allMonths.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line py-10 text-center text-xs font-bold text-success">
            Tous les mois de cet enseignant ont déjà été réglés.
          </p>
        ) : (
          <>
            {/* ---- la règle du mois clos ------------------------------- */}
            <div
              className={`rounded-2xl border p-3 text-[11px] leading-relaxed ${
                runningOnly
                  ? "border-warning/40 bg-warning/5 text-warning"
                  : "border-primary/30 bg-primary-50/50 text-primary"
              }`}
            >
              {runningOnly ? (
                <>
                  <strong>Aucun mois clos à régler.</strong> Les mois encore ouverts sont listés
                  ci-dessous mais ne sont pas cochés : un mois se règle une fois sa dernière séance
                  tenue (par ex. la 4ᵉ sur 4). Cochez-en un pour payer d&apos;avance.
                </>
              ) : (
                <>
                  <strong>{suggested.length} mois clos</strong> sont cochés automatiquement — le mois
                  en cours d&apos;un emploi du temps (3 séances sur 4, par ex.) n&apos;est jamais
                  proposé : on règle le mois qui vient de se terminer.
                </>
              )}
            </div>

            {/* ---- ce qu'il doit toucher, avant toute sélection --------- */}
            <div className="space-y-2 rounded-2xl border-2 border-primary/30 bg-primary-50/40 p-4">
              <span className="text-[10px] font-bold uppercase tracking-wider text-primary">
                Ce que cet enseignant doit toucher
              </span>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Généré (non réglé)" value={formatDA(owed.open)} tone="text-ink" />
                <Stat
                  label="Payable maintenant"
                  value={formatDA(owed.payable)}
                  tone="text-success"
                />
                <Stat
                  label="Retenu (élèves en dette)"
                  value={formatDA(owed.withheld)}
                  tone={owed.withheld > 0 ? "text-danger" : "text-muted"}
                />
                <Stat label="Déjà réglé" value={formatDA(owed.settled)} tone="text-muted" />
              </div>
              <p className="text-[11px] leading-relaxed text-muted">
                {openMonths.length} mois non réglé(s) sur {emplois.length} emploi(s) du temps —
                dont <strong className="text-primary">{closedOwing.length} mois clos</strong>. Les
                mois déjà payés ne sont plus listés : ce que vous voyez ci-dessous est exactement ce
                qui reste dû.
              </p>
            </div>

            {/* ---- résumé de la sélection ------------------------------ */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Mois réglés" value={String(chosen.length)} />
              <Stat label="Présences payées" value={String(chosenDues.length)} tone="text-ink" />
              <Stat
                label="Montant généré"
                value={formatDA(chosenRevenue)}
                tone="text-success"
              />
              <Stat
                label="Retenu (élèves en dette)"
                value={formatDA(withheldTotal)}
                tone={withheldTotal > 0 ? "text-danger" : "text-muted"}
              />
            </div>

            {/* ---- formule --------------------------------------------- */}
            <div className="space-y-3 rounded-2xl border border-primary/25 bg-primary-50/40 p-4">
              <span className="text-[10px] font-bold uppercase tracking-wider text-primary">
                Mode de rémunération
              </span>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <MethodCard
                  active={method === "fixed"}
                  onClick={() => setMethod("fixed")}
                  icon={DollarSign}
                  title="Montant fixe"
                  text="Vous saisissez directement la somme à verser."
                />
                <MethodCard
                  active={method === "percent"}
                  onClick={() => setMethod("percent")}
                  icon={Percent}
                  title="Pourcentage"
                  text="% appliqué au tarif de chaque élève présent — calcul automatique."
                />
                <MethodCard
                  active={method === "group"}
                  onClick={() => setMethod("group")}
                  icon={Users}
                  title="Par groupe"
                  text="Tarif enseignant défini sur chaque emploi du temps — calcul automatique."
                />
              </div>

              {method === "group" ? (
                <div className="rounded-xl border border-line bg-surface p-3 text-[11px] leading-relaxed text-muted">
                  Chaque présence porte déjà le tarif de son emploi du temps (part de
                  l&apos;enseignant du mois ÷ nombre de séances, réglée sur l&apos;abonnement). Le
                  montant ci-dessous est la somme de ces tarifs pour les mois cochés — rien à saisir.
                  {chosen.some((m) => payableDuesOf(m).length > 0 && monthShare(m) === 0) && (
                    <span className="mt-2 block font-semibold text-warning">
                      Certains mois cochés ne rapportent rien : leur abonnement n&apos;a pas encore
                      de part enseignant.
                    </span>
                  )}
                </div>
              ) : method === "fixed" ? (
                <div>
                  <label className="mb-1 block text-[10px] font-semibold text-muted">
                    Montant à verser (DA) *
                  </label>
                  <Input
                    type="number"
                    min={0}
                    value={fixedAmount || ""}
                    onChange={(e) => setFixedAmount(Number(e.target.value))}
                    placeholder="Ex: 4000"
                    className="w-48"
                  />
                </div>
              ) : (
                <div className="flex flex-wrap items-end gap-4">
                  <div>
                    <label className="mb-1 block text-[10px] font-semibold text-muted">
                      Pourcentage par élève (%)
                    </label>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={percentage || ""}
                      onChange={(e) => setPercentage(Number(e.target.value))}
                      className="w-32"
                    />
                  </div>
                  <div className="pb-1.5 text-xs">
                    <span className="mb-1 block text-[10px] font-semibold text-muted">
                      Calcul automatique
                    </span>
                    <strong className="text-primary">
                      {formatDA(chosenFees)} × {pct}% = {formatDA(gross)}
                    </strong>
                  </div>
                </div>
              )}
            </div>

            {/* ---- UN GRAND TABLEAU PAR GROUPE ------------------------- */}
            <div className="space-y-4">
              {owingEmplois.map((e) => (
                <div key={e.sessionId} className="overflow-hidden rounded-2xl border border-line">
                  <div className="flex flex-wrap items-center justify-between gap-2 bg-primary-50/60 p-3">
                    <div className="min-w-0">
                      <strong className="block text-sm text-ink">
                        📚 {e.title} — Groupe {e.groupName}
                        {e.isOpen && (
                          <Badge tone="success" className="ml-1.5 text-[9px]">
                            Séance libre
                          </Badge>
                        )}
                      </strong>
                      <span className="block text-[10px] text-muted">
                        {e.className} · Salle {e.salleName} · {e.daysLabel} ·{" "}
                        <span className="font-mono">{e.timeLabel}</span>
                      </span>
                      <span className="block text-[10px] text-muted">
                        {e.size} séances / mois ·{" "}
                        {e.priced ? (
                          <>
                            part enseignant <strong className="text-primary">{formatDA(e.perSeance)}</strong>{" "}
                            / séance · {formatDA(e.perSeance * e.size)} le mois complet
                          </>
                        ) : (
                          <span className="font-semibold text-warning">
                            aucune part enseignant définie sur cet abonnement
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="primary" className="gap-1 font-bold text-[10px]">
                        <CalendarClock className="h-3 w-3" />
                        Mois en cours {e.currentCode} · séance{" "}
                        {Math.min(Math.max(e.currentHeld, 0), e.size)}/{e.size}
                      </Badge>
                      <Badge tone="success" className="font-mono text-[10px] font-bold">
                        {formatDA(e.payable)} payable
                      </Badge>
                      <Button size="sm" variant="outline" onClick={() => toggleEmploi(e)}>
                        Tout cocher / décocher
                      </Button>
                    </div>
                  </div>

                  <div className="divide-y-4 divide-canvas">
                    {e.months.map((m) => (
                      <MonthBoard
                        key={m.key}
                        emploi={e}
                        month={m}
                        checked={selectedKeys.includes(m.key)}
                        selectedKeys={selectedKeys}
                        share={selectedKeys.includes(m.key) ? monthShare(m) : 0}
                        method={method}
                        pct={pct}
                        studentShare={studentShare}
                        onToggle={() => toggleMonth(m.key)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* ---- les cas particuliers -------------------------------- */}
            <SpecialCases
              childRows={childRows}
              childIds={childIds}
              onToggleChild={(id) =>
                setChildIds((prev) =>
                  prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
                )
              }
              reductionRows={reductionRows}
              childrenTotal={childrenTotal}
            />

            {/* ---- les élèves qui n'ont pas payé ----------------------- */}
            {unpaidRows.length > 0 && (
              <div className="space-y-2 rounded-2xl border border-danger/30 bg-danger/5 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-danger">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Élèves non réglés sur les mois cochés ({unpaidRows.length})
                  </span>
                  <Badge tone="danger" className="font-mono font-bold">
                    {formatDA(unpaidRows.reduce((s, r) => s + r.student.debt, 0))}
                  </Badge>
                </div>
                <div className="max-h-44 overflow-x-auto overflow-y-auto rounded-xl border border-line bg-surface">
                  <table className="w-full min-w-[640px] text-[11px]">
                    <thead className="bg-canvas/60">
                      <tr className="text-left text-[9px] uppercase tracking-wide text-muted">
                        <th className="px-2 py-1.5">N°</th>
                        <th className="px-2 py-1.5">Élève</th>
                        <th className="px-2 py-1.5">Mois</th>
                        <th className="px-2 py-1.5 text-center">Séances</th>
                        <th className="px-2 py-1.5 text-right">Versé</th>
                        <th className="px-2 py-1.5 text-right">Reste dû</th>
                        <th className="px-2 py-1.5 text-right">Part prof bloquée</th>
                      </tr>
                    </thead>
                    <tbody>
                      {unpaidRows.map(({ month, student }) => (
                        <tr
                          key={`${month.key}-${student.studentId}`}
                          className="border-t border-line/50"
                        >
                          <td className="px-2 py-1.5 font-mono text-muted">
                            {student.registrationNumber}
                          </td>
                          <td className="px-2 py-1.5 font-semibold text-ink">
                            {student.name}
                            {student.caseLabel && (
                              <Badge tone="warning" className="ml-1.5 text-[8px]">
                                {student.caseLabel}
                              </Badge>
                            )}
                          </td>
                          <td className="px-2 py-1.5 font-mono">{month.code}</td>
                          <td className="px-2 py-1.5 text-center font-mono">
                            {student.done}/{student.size}
                          </td>
                          <td className="px-2 py-1.5 text-right font-mono text-success">
                            {formatDA(student.credited)}
                          </td>
                          <td className="px-2 py-1.5 text-right font-mono font-bold text-danger">
                            {formatDA(student.debt)}
                          </td>
                          <td className="px-2 py-1.5 text-right font-mono text-warning">
                            {student.withheld > 0 ? formatDA(student.withheld) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[10px] text-danger">
                  Leur part n&apos;est pas versée aujourd&apos;hui : elle reste ouverte et
                  réapparaîtra au prochain règlement dès qu&apos;ils auront payé.
                </p>
              </div>
            )}

            {/* ---- les dépenses de l'enseignant ------------------------ */}
            <DeductionTable
              title="Dépenses avancées par l'école pour cet enseignant"
              icon={Receipt}
              empty="Aucune dépense en attente pour cet enseignant."
              total={expensesTotal}
              rows={unpaidExpenses.map((e) => ({
                id: e.id,
                date: e.date,
                label: e.name,
                description: e.description ?? "",
                amount: e.amount,
              }))}
              selected={expenseIds}
              onToggle={(id) =>
                setExpenseIds((prev) =>
                  prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
                )
              }
            />

            <DeductionTable
              title="Acomptes déjà versés"
              icon={DollarSign}
              empty="Aucun acompte en attente."
              total={acomptesTotal}
              rows={unpaidAcomptes.map((a) => ({
                id: a.id,
                date: a.date.slice(0, 10),
                label: "Acompte",
                description: a.description ?? "",
                amount: a.amount,
              }))}
              selected={acompteIds}
              onToggle={(id) =>
                setAcompteIds((prev) =>
                  prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
                )
              }
            />

            {/* ---- net à verser ---------------------------------------- */}
            <div className="space-y-3 rounded-2xl border-2 border-success/40 bg-success/5 p-4">
              <span className="text-[10px] font-bold uppercase tracking-wider text-success">
                Récapitulatif du règlement
              </span>
              <div className="overflow-x-auto rounded-xl border border-line bg-surface">
                <table className="w-full min-w-[420px] text-xs">
                  <tbody>
                    <SummaryLine
                      label={`Total des élèves (${chosenDues.length} présence(s) sur ${chosen.length} mois)`}
                      value={formatDA(gross)}
                      tone="text-success"
                    />
                    <SummaryLine
                      label={`Dépenses (${chosenExpenses.length})`}
                      value={`− ${formatDA(expensesTotal)}`}
                      tone="text-danger"
                    />
                    <SummaryLine
                      label={`Acomptes (${chosenAcomptes.length})`}
                      value={`− ${formatDA(acomptesTotal)}`}
                      tone="text-danger"
                    />
                    <SummaryLine
                      label={`Scolarité de ses enfants (${chosenChildren.length})`}
                      value={`− ${formatDA(childrenTotal)}`}
                      tone="text-danger"
                    />
                    <tr className="border-t-2 border-success/40 bg-success/10">
                      <td className="px-3 py-2.5 text-sm font-black uppercase text-ink">
                        Net à verser
                      </td>
                      <td
                        className={`px-3 py-2.5 text-right font-mono text-xl font-black ${
                          net < 0 ? "text-danger" : "text-success"
                        }`}
                      >
                        {formatDA(net)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="text-[10px] text-muted">
                  <span className="block">
                    {chosen.map((m) => m.code).join(", ") || "aucun mois"} ·{" "}
                    {chosenDues.length} présence(s)
                    {chosenPassagers.length > 0 && ` · ${chosenPassagers.length} passager(s)`}
                  </span>
                  {withheldTotal > 0 && (
                    <span className="mt-1 block rounded-lg bg-danger/10 px-2 py-1 font-semibold text-danger">
                      ⏳ {chosenWithheldDues.length} présence(s) de {withheldStudents} élève(s) en
                      dette — {formatDA(withheldTotal)} non réglés. Ils réapparaîtront au prochain
                      paiement une fois la dette payée.
                    </span>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={onClose}>
                    Annuler
                  </Button>
                  <Button onClick={submit} disabled={saving || gross <= 0 || chosen.length === 0}>
                    {saving ? "Enregistrement..." : `Payer ${formatDA(net)}`}
                  </Button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

function Stat({ label, value, tone = "text-ink" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-line bg-canvas p-3 text-center">
      <span className="block text-[10px] font-semibold uppercase text-muted">{label}</span>
      <strong className={`font-mono text-base ${tone}`}>{value}</strong>
    </div>
  );
}

function SummaryLine({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <tr className="border-t border-line/60">
      <td className="px-3 py-2 text-muted">{label}</td>
      <td className={`px-3 py-2 text-right font-mono font-bold ${tone}`}>{value}</td>
    </tr>
  );
}

function MethodCard({
  active,
  onClick,
  icon: Icon,
  title,
  text,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof DollarSign;
  title: string;
  text: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border p-3 text-left transition-all ${
        active ? "border-primary bg-primary/10 ring-2 ring-primary/25" : "border-line bg-surface"
      }`}
    >
      <div className="mb-1 flex items-center gap-2">
        <Icon className={`h-4 w-4 ${active ? "text-primary" : "text-muted"}`} />
        <span className="text-xs font-bold text-ink">{title}</span>
      </div>
      <span className="block text-[10px] leading-normal text-muted">{text}</span>
    </button>
  );
}

/**
 * UN MOIS D'UN GROUPE — la feuille de présence, lue du côté de la paie.
 *
 * Une ligne par élève, ses séances S1…Sn comme sur la feuille, puis les trois
 * colonnes d'argent qui décident du règlement : ce qu'il a payé sur CE mois, ce
 * qu'il traîne des mois précédents, et les arriérés que sa dette bloquait et
 * qu'un versement récent vient de débloquer.
 */
function MonthBoard({
  emploi,
  month,
  checked,
  selectedKeys,
  share,
  method,
  pct,
  studentShare,
  onToggle,
}: {
  emploi: TeacherEmploi;
  month: TeacherMonth;
  checked: boolean;
  selectedKeys: string[];
  share: number;
  method: PayMethod;
  pct: number;
  studentShare: (m: TeacherMonth, studentId: string) => number;
  onToggle: () => void;
}) {
  const db = useData();
  const subId = emploi.subscriptionId;
  const closed = month.state === "done";

  /** Autant de colonnes que la feuille de présence en montrerait ce mois-là. */
  const slotCount = subId
    ? slotCountFor(db, subId, month.students.map((s) => s.studentId), month.code)
    : month.size;

  return (
    <div className={checked ? "bg-primary-50/25" : "bg-surface"}>
      {/* ---- la barre du mois ------------------------------------------ */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line p-3">
        <label className="flex min-w-0 cursor-pointer items-start gap-2.5">
          <input
            type="checkbox"
            checked={checked}
            onChange={onToggle}
            className="mt-0.5 h-4 w-4 shrink-0"
          />
          <span className="min-w-0">
            <strong className="block text-xs text-ink">
              {month.code}
              <Badge tone={closed ? "primary" : "warning"} className="ml-1.5 text-[9px]">
                {closed
                  ? "Mois clos"
                  : `En cours — séance ${Math.min(month.held, month.size)}/${month.size}`}
              </Badge>
              {month.isCurrent && (
                <Badge tone="neutral" className="ml-1.5 text-[9px]">
                  mois courant du groupe
                </Badge>
              )}
            </strong>
            <span className="block text-[10px] text-muted">
              {month.held}/{month.size} séance(s) ·{" "}
              {month.startDate ? formatDateFr(month.startDate) : "—"}
              {month.endDate ? ` → ${formatDateFr(month.endDate)}` : ""} · {month.students.length}{" "}
              élève(s) · <span className="text-success">{month.studentsPaid} payé(s)</span> ·{" "}
              <span className="text-danger">{month.studentsUnpaid} impayé(s)</span>
            </span>
          </span>
        </label>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {month.studentsDebt > 0 && (
            <Badge tone="danger" className="font-mono text-[10px] font-bold">
              {formatDA(month.studentsDebt)} dus par les élèves
            </Badge>
          )}
          {month.withheld > 0 && (
            <Badge tone="warning" className="font-mono text-[10px] font-bold">
              {formatDA(month.withheld)} retenus
            </Badge>
          )}
          <Badge tone="success" className="font-mono text-[10px] font-bold">
            {formatDA(month.payable)} payable
          </Badge>
          {checked && (
            <Badge tone="primary" className="font-mono text-[10px] font-bold">
              → {formatDA(share)}
            </Badge>
          )}
        </div>
      </div>

      {/* ---- les alertes du mois --------------------------------------- */}
      {month.alerts.length > 0 && (
        <div className="space-y-1 px-3 pt-2">
          {month.alerts.map((a, i) => (
            <p
              key={i}
              className={`rounded-lg border px-2 py-1.5 text-[10px] font-semibold ${
                a.tone === "danger"
                  ? "border-danger/40 bg-danger/10 text-danger"
                  : a.tone === "warning"
                    ? "border-warning/40 bg-warning/10 text-warning"
                    : a.tone === "success"
                      ? "border-success/40 bg-success/10 text-success"
                      : "border-primary/30 bg-primary-50/60 text-primary"
              }`}
            >
              {a.text}
            </p>
          ))}
        </div>
      )}

      {month.dates.length > 0 && (
        <p className="px-3 pt-2 text-[10px] text-muted">
          <strong className="text-ink">Séances :</strong>{" "}
          {month.dates.map((d, i) => (
            <span key={d} className="font-mono">
              {i > 0 ? " · " : ""}S{i + 1} {formatDateFr(d)}
            </span>
          ))}
        </p>
      )}

      {/* ---- LE TABLEAU, comme la feuille de présence ------------------- */}
      <div className="overflow-x-auto p-3">
        <table className="w-full min-w-[1080px] text-xs">
          <thead className="bg-canvas/60">
            <tr className="text-left text-[10px] uppercase tracking-wide text-muted">
              <th className="px-2 py-2.5">N°</th>
              <th className="px-2 py-2.5">Élève</th>
              {Array.from({ length: slotCount }, (_, i) => (
                <th key={i} className="px-1 py-2.5 text-center" title={`Séance ${i + 1} du mois`}>
                  S{i + 1}
                </th>
              ))}
              <th className="px-2 py-2.5 text-right">Son tarif</th>
              <th className="px-2 py-2.5">Payé {month.code} ?</th>
              <th className="px-2 py-2.5">Mois préc. impayés</th>
              <th className="px-2 py-2.5">Arriérés débloqués</th>
              <th className="px-2 py-2.5 text-right">
                Part prof{" "}
                {method === "percent"
                  ? `(${pct}%)`
                  : method === "group"
                    ? "(tarif du groupe)"
                    : "(réparti)"}
              </th>
            </tr>
          </thead>
          <tbody>
            {month.students.length === 0 && month.passagers.length === 0 ? (
              <tr>
                <td
                  colSpan={slotCount + 7}
                  className="px-3 py-8 text-center text-xs italic text-muted"
                >
                  Aucun élève sur ce mois.
                </td>
              </tr>
            ) : (
              month.students.map((st) => (
                <StudentPayRow
                  key={st.studentId}
                  emploi={emploi}
                  month={month}
                  student={st}
                  subId={subId}
                  slotCount={slotCount}
                  selectedKeys={selectedKeys}
                  share={studentShare(month, st.studentId)}
                />
              ))
            )}
            {month.passagers.map((p) => (
              <tr key={p.id} className="border-t border-line/50">
                <td className="px-2 py-2 font-mono text-muted">—</td>
                <td className="px-2 py-2">
                  <strong className="text-ink">{p.name}</strong>
                  <Badge tone="warning" className="ml-1.5 text-[8px]">
                    Passager
                  </Badge>
                </td>
                <td colSpan={slotCount} className="px-2 py-2 text-center text-[10px] text-muted">
                  séance libre du {formatDateFr(p.dateKey)}
                </td>
                <td className="px-2 py-2 text-right font-mono text-muted">{formatDA(p.price)}</td>
                <td className="px-2 py-2">
                  <Badge tone="success" className="text-[9px]">
                    Payé
                  </Badge>
                </td>
                <td className="px-2 py-2 text-center text-success">✅</td>
                <td className="px-2 py-2 text-center text-muted">—</td>
                <td className="px-2 py-2 text-right font-mono text-muted">—</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Une ligne d'élève sur un mois — l'exact pendant payant de la feuille. */
function StudentPayRow({
  emploi,
  month,
  student,
  subId,
  slotCount,
  selectedKeys,
  share,
}: {
  emploi: TeacherEmploi;
  month: TeacherMonth;
  student: TeacherMonthStudent;
  subId?: string;
  slotCount: number;
  selectedKeys: string[];
  share: number;
}) {
  const db = useData();
  const badge = PAY_STATE[student.status];

  const slots = subId ? cycleSlots(db, student.studentId, subId, month.code) : [];
  const lead = subId ? cycleLead(db, student.studentId, subId, month.code) : 0;

  /** Ce que les mois d'AVANT doivent encore pour lui à l'enseignant. */
  const arrears = studentArrearsBefore(emploi, student.studentId, month.index);
  const arrearsTicked = arrears.months.every((code) =>
    selectedKeys.includes(`${emploi.sessionId}|${code}`),
  );

  return (
    <tr className={`border-t border-line/60 align-middle ${student.debt > 0 ? "bg-danger/5" : ""}`}>
      <td className="px-2 py-2 font-mono text-[11px] text-muted">{student.registrationNumber}</td>
      <td className="px-2 py-2">
        <strong className="block text-ink">{student.name}</strong>
        {student.caseLabel && (
          <Badge
            tone={student.caseKind === "teacher_child" ? "primary" : "warning"}
            className="mt-0.5 text-[9px]"
          >
            {student.caseLabel}
          </Badge>
        )}
      </td>

      {Array.from({ length: slotCount }, (_, i) => {
        // Les séances tenues avant son inscription ne sont pas les siennes.
        const before = i < lead;
        const rec = before ? undefined : slots[i - lead];
        return (
          <td key={i} className="px-1 py-2 text-center">
            <span
              title={
                before
                  ? `Séance tenue avant son inscription (inscrit à la séance ${lead + 1})`
                  : rec
                    ? `${STATUS_STYLE[rec.status].label} — ${formatDateFr(rec.timestamp.slice(0, 10))}`
                    : "Pas encore pointé"
              }
              className={`inline-flex h-6 w-6 items-center justify-center rounded-lg border text-[11px] font-black ${
                before
                  ? "border-dashed border-line bg-canvas/40 text-muted/40"
                  : rec
                    ? STATUS_STYLE[rec.status].cls
                    : "border-line bg-canvas text-muted/50"
              }`}
            >
              {before ? "" : rec ? STATUS_STYLE[rec.status].short : "–"}
            </span>
          </td>
        );
      })}

      {/* son tarif */}
      <td className="px-2 py-2 text-right font-mono text-muted">
        {formatDA(student.unitPrice)}
        <span className="block text-[8px]">
          séance · {formatDA(student.expected)} / mois
          {student.teacherPerSeance > 0 && (
            <>
              <br />
              prof {formatDA(student.teacherPerSeance)} / séance
            </>
          )}
        </span>
      </td>

      {/* payé ce mois ? */}
      <td className="px-2 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={badge.tone} className="text-[9px]">
            {badge.label}
          </Badge>
          <Badge tone="success" className="font-mono text-[9px]" title={`Versé sur ${month.code}`}>
            {formatDA(student.credited)}
          </Badge>
          {student.debt > 0 && (
            <Badge tone="danger" className="font-mono text-[9px]" title="Reste dû sur ce mois">
              reste {formatDA(student.debt)}
            </Badge>
          )}
        </div>
        <span className="mt-0.5 block text-[9px] text-muted">
          {student.done}/{Math.max(0, student.size - lead)} séance(s) · {student.presents} P /{" "}
          {student.absents} A
          {student.cancelled > 0 ? ` / ${student.cancelled} ×` : ""}
        </span>
      </td>

      {/* mois précédents impayés */}
      <td className="px-2 py-2">
        {student.previousDebt > 0 ? (
          <span className="rounded-lg border border-danger/40 bg-danger/10 px-2 py-1 font-mono text-[10px] font-bold text-danger">
            {formatDA(student.previousDebt)}
          </span>
        ) : (
          <span className="text-sm" title="Rien en retard sur les mois précédents">
            ✅
          </span>
        )}
        {student.otherDebt > 0 && (
          <span className="mt-0.5 block text-[9px] text-warning">
            + {formatDA(student.otherDebt)} sur ses autres emplois
          </span>
        )}
      </td>

      {/* arriérés débloqués : payés depuis, donc dus à l'enseignant */}
      <td className="px-2 py-2">
        {arrears.payable > 0 ? (
          <>
            <span className="rounded-lg border border-success/40 bg-success/10 px-2 py-1 font-mono text-[10px] font-bold text-success">
              {formatDA(arrears.payable)}
            </span>
            <span className="mt-0.5 block text-[9px] text-muted">
              {arrears.months.join(", ")} —{" "}
              {arrearsTicked ? (
                <span className="font-semibold text-success">inclus dans ce règlement</span>
              ) : (
                <span className="font-semibold text-warning">cochez ce mois pour le régler</span>
              )}
            </span>
          </>
        ) : arrears.withheld > 0 ? (
          <>
            <span className="rounded-lg border border-warning/40 bg-warning/10 px-2 py-1 font-mono text-[10px] font-bold text-warning">
              {formatDA(arrears.withheld)}
            </span>
            <span className="mt-0.5 block text-[9px] text-muted">
              {arrears.months.join(", ")} — encore bloqués par sa dette
            </span>
          </>
        ) : (
          <span className="text-sm" title="Aucun arriéré de part enseignant">
            —
          </span>
        )}
      </td>

      {/* part prof de ce mois */}
      <td className="px-2 py-2 text-right font-mono font-bold text-primary">
        {student.open > 0 && share === 0 ? "— (dette)" : formatDA(share)}
      </td>
    </tr>
  );
}

/**
 * LES CAS PARTICULIERS, en bas du règlement, là où on les vérifie une dernière
 * fois avant de payer :
 *  - ses ENFANTS, scolarisés sur son salaire : ce que chacun a étudié ce mois-ci,
 *    ce qu'il traîne des mois d'avant, et le total retenu ;
 *  - les élèves à RÉDUCTION : le prix d'origine, ce que l'école garde après sa
 *    part de remise, ce que l'enseignant touche après la sienne ;
 *  - les élèves « école seule », rappelés mais jamais listés : l'enseignant
 *    n'est délibérément pas payé pour eux.
 */
function SpecialCases({
  childRows,
  childIds,
  onToggleChild,
  reductionRows,
  childrenTotal,
}: {
  childRows: TeacherChildRow[];
  childIds: string[];
  onToggleChild: (id: string) => void;
  reductionRows: { student: TeacherMonthStudent; emploi: string; months: string[] }[];
  childrenTotal: number;
}) {
  return (
    <div className="space-y-3 rounded-2xl border border-warning/30 bg-warning/5 p-4">
      <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-warning">
        <GraduationCap className="h-3.5 w-3.5" /> Cas particuliers de ce règlement
      </span>

      {/* ---- ses enfants ------------------------------------------------ */}
      <div className="rounded-xl border border-primary/30 bg-surface p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <strong className="text-[11px] text-ink">
            Ses enfants, scolarisés sur son salaire ({childRows.length})
          </strong>
          <Badge tone="danger" className="font-mono font-bold">
            − {formatDA(childrenTotal)}
          </Badge>
        </div>
        {childRows.length === 0 ? (
          <p className="text-[10px] italic text-muted">
            Aucun enfant à charge en dette sur ce salaire.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[720px] text-[11px]">
              <thead className="bg-canvas/60">
                <tr className="text-left text-[9px] uppercase tracking-wide text-muted">
                  <th className="px-2 py-1.5">Retenir</th>
                  <th className="px-2 py-1.5">Enfant</th>
                  <th className="px-2 py-1.5">Emploi du temps</th>
                  <th className="px-2 py-1.5">Mois</th>
                  <th className="px-2 py-1.5 text-center">Séances suivies</th>
                  <th className="px-2 py-1.5 text-right">Prix / séance</th>
                  <th className="px-2 py-1.5 text-right">Montant</th>
                </tr>
              </thead>
              <tbody>
                {childRows.map((c) =>
                  c.lines.map((l, i) => (
                    <tr key={`${c.studentId}-${l.subscriptionId}-${l.monthCode}`} className="border-t border-line/50">
                      {i === 0 && (
                        <td rowSpan={c.lines.length} className="px-2 py-1.5 align-top">
                          <input
                            type="checkbox"
                            checked={childIds.includes(c.studentId)}
                            onChange={() => onToggleChild(c.studentId)}
                            className="h-4 w-4"
                          />
                        </td>
                      )}
                      {i === 0 && (
                        <td rowSpan={c.lines.length} className="px-2 py-1.5 align-top">
                          <strong className="block text-ink">{c.studentName}</strong>
                          <span className="block font-mono text-[9px] text-muted">
                            N° {c.registrationNumber}
                          </span>
                        </td>
                      )}
                      <td className="px-2 py-1.5 text-muted">{l.label}</td>
                      <td className="px-2 py-1.5">
                        <span className="font-mono">{l.monthCode}</span>
                        {l.current ? (
                          <Badge tone="primary" className="ml-1.5 text-[8px]">
                            mois en cours
                          </Badge>
                        ) : (
                          <Badge tone="danger" className="ml-1.5 text-[8px]">
                            arriéré
                          </Badge>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-center font-mono">{l.seances}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-muted">
                        {formatDA(l.unitPrice)}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono font-bold text-danger">
                        {formatDA(l.amount)}
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
              <tfoot>
                {childRows.map((c) => (
                  <tr key={`total-${c.studentId}`} className="border-t border-line bg-canvas/40">
                    <td colSpan={4} className="px-2 py-1.5 text-[10px] font-bold uppercase text-muted">
                      {c.studentName} — mois en cours {formatDA(c.currentAmount)} ·{" "}
                      {c.currentSeances} séance(s) · arriérés {formatDA(c.previousAmount)}
                    </td>
                    <td colSpan={3} className="px-2 py-1.5 text-right font-mono font-black text-danger">
                      total à retenir {formatDA(c.amount)}
                    </td>
                  </tr>
                ))}
              </tfoot>
            </table>
          </div>
        )}
        <p className="mt-1.5 text-[10px] leading-relaxed text-muted">
          Cet argent ne passe jamais par la caisse : l&apos;école est payée en versant
          <strong className="text-ink"> moins</strong> à l&apos;enseignant, et le solde de
          l&apos;enfant revient à zéro sur les mois cochés.
        </p>
      </div>

      {/* ---- réductions & cas spéciaux ---------------------------------- */}
      <div className="rounded-xl border border-line bg-surface p-3">
        <strong className="mb-2 block text-[11px] text-ink">
          Réductions et cas spéciaux sur ces mois ({reductionRows.length})
        </strong>
        {reductionRows.length === 0 ? (
          <p className="text-[10px] italic text-muted">
            Aucun élève à réduction ni cas spécial sur les mois listés.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[720px] text-[11px]">
              <thead className="bg-canvas/60">
                <tr className="text-left text-[9px] uppercase tracking-wide text-muted">
                  <th className="px-2 py-1.5">Élève</th>
                  <th className="px-2 py-1.5">Emploi du temps</th>
                  <th className="px-2 py-1.5">Mois</th>
                  <th className="px-2 py-1.5">Cas</th>
                  <th className="px-2 py-1.5 text-right">Prix d&apos;origine</th>
                  <th className="px-2 py-1.5 text-right">Il paie</th>
                  <th className="px-2 py-1.5 text-right">Part école</th>
                  <th className="px-2 py-1.5 text-right">Part enseignant</th>
                </tr>
              </thead>
              <tbody>
                {reductionRows.map(({ student, emploi, months }) => (
                  <tr key={`${emploi}-${student.studentId}`} className="border-t border-line/50">
                    <td className="px-2 py-1.5">
                      <strong className="text-ink">{student.name}</strong>
                      <span className="block font-mono text-[9px] text-muted">
                        N° {student.registrationNumber}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-muted">{emploi}</td>
                    <td className="px-2 py-1.5 font-mono">{months.join(", ")}</td>
                    <td className="px-2 py-1.5">
                      <Badge tone={student.caseKind === "special" ? "success" : "warning"} className="text-[9px]">
                        {student.caseLabel}
                      </Badge>
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-muted line-through">
                      {formatDA(student.listPrice)}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono font-bold text-ink">
                      {formatDA(student.unitPrice)}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-success">
                      {formatDA(student.schoolPerSeance)}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono font-bold text-primary">
                      {formatDA(student.teacherPerSeance)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-1.5 text-[10px] leading-relaxed text-muted">
          La remise se partage : l&apos;école en accorde sa moitié sur SA part, l&apos;enseignant la
          sienne sur LA SIENNE — les deux colonnes rendent donc exactement ce que l&apos;élève paie.
          Un <strong className="text-ink">cas spécial</strong> ne rapporte rien à personne, et un
          élève <strong className="text-ink">« école seule »</strong> n&apos;est volontairement pas
          listé sur cette paie : l&apos;enseignant n&apos;est pas payé pour lui.
        </p>
      </div>
    </div>
  );
}

/** Une retenue tabulée — dépenses ou acomptes, même lecture, même total. */
function DeductionTable({
  title,
  icon: Icon,
  empty,
  total,
  rows,
  selected,
  onToggle,
}: {
  title: string;
  icon: typeof DollarSign;
  empty: string;
  total: number;
  rows: { id: string; date: string; label: string; description: string; amount: number }[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <div className="space-y-2 rounded-2xl border border-danger/25 bg-danger/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-danger">
          <Icon className="h-3.5 w-3.5" /> {title} ({rows.length})
        </span>
        <Badge tone="danger" className="font-mono font-bold">
          − {formatDA(total)}
        </Badge>
      </div>
      {rows.length === 0 ? (
        <p className="text-[11px] italic text-muted">{empty}</p>
      ) : (
        <div className="max-h-56 overflow-x-auto overflow-y-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[560px] text-[11px]">
            <thead className="bg-canvas/60">
              <tr className="text-left text-[9px] uppercase tracking-wide text-muted">
                <th className="px-2 py-1.5">Retenir</th>
                <th className="px-2 py-1.5">Date</th>
                <th className="px-2 py-1.5">Intitulé</th>
                <th className="px-2 py-1.5">Description</th>
                <th className="px-2 py-1.5 text-right">Montant</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-line/50">
                  <td className="px-2 py-1.5">
                    <input
                      type="checkbox"
                      checked={selected.includes(r.id)}
                      onChange={() => onToggle(r.id)}
                      className="h-4 w-4"
                    />
                  </td>
                  <td className="px-2 py-1.5 font-mono text-muted">{formatDateFr(r.date)}</td>
                  <td className="px-2 py-1.5 font-semibold text-ink">{r.label}</td>
                  <td className="px-2 py-1.5 text-muted">{r.description || "—"}</td>
                  <td className="px-2 py-1.5 text-right font-mono font-bold text-danger">
                    {formatDA(r.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-danger/30 bg-canvas/40">
                <td colSpan={4} className="px-2 py-1.5 text-[10px] font-bold uppercase text-muted">
                  Total retenu
                </td>
                <td className="px-2 py-1.5 text-right font-mono font-black text-danger">
                  − {formatDA(total)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
