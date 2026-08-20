"use client";

/**
 * Le règlement d'un enseignant — organisé PAR EMPLOI DU TEMPS et PAR MOIS.
 *
 * On ne paie plus « des créneaux » en vrac : on paie LE MOIS d'un emploi du
 * temps, exactement le mois que l'école compte déjà pour les élèves (M1, M2 …,
 * ouvert par la première présence, fermé par la séance qui complète le pack).
 *
 * Conséquences, et c'est tout l'intérêt :
 *  - l'écran s'ouvre sur le dernier mois CLOS non réglé, jamais sur le mois en
 *    cours : si le groupe en est à la 3ᵉ séance d'un mois de 4, c'est le mois
 *    précédent qu'on règle,
 *  - chaque mois montre qui a payé et qui n'a pas payé, avec le détail,
 *  - la part d'un élève en dette est RETENUE : elle ne disparaît pas, elle
 *    revient au règlement suivant dès que l'élève s'est acquitté,
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
  formatDateFr,
  registrationNumberOf,
  studentCaseLabel,
  studentSoldDebtRows,
} from "@/lib/helpers";
import {
  buildTeacherPayslip,
  type PayslipEmploi,
  type PayslipStudent,
} from "@/lib/reports/teacherPayslip";
import {
  defaultPayableMonthKeys,
  teacherEmplois,
  type MonthPayState,
  type TeacherDue,
  type TeacherEmploi,
  type TeacherMonth,
} from "@/lib/teacherMonths";
import {
  AlertTriangle,
  CalendarClock,
  DollarSign,
  Percent,
  Users,
} from "lucide-react";
import type {
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
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
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
  /** Les enfants de l'enseignant, scolarisés sur son salaire. */
  const childCharges: TeacherChildCharge[] = useMemo(
    () =>
      students
        .filter((st) => st.studentCase === "teacher_child" && st.teacherFatherId === teacher.id)
        .map((st) => {
          const lines = studentSoldDebtRows(db, st.id).map((r) => ({
            subscriptionId: r.subscriptionId,
            label: r.label,
            monthCode: r.code,
            amount: r.debt,
          }));
          return {
            studentId: st.id,
            studentName: `${st.firstName} ${st.lastName}`,
            registrationNumber: registrationNumberOf(db, st),
            lines,
            amount: lines.reduce((s, l) => s + l.amount, 0),
          };
        })
        .filter((c) => c.lines.length > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [teacher, students, db.enrollments, db.payments],
  );

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

  const chosenExpenses = unpaidExpenses.filter((e) => expenseIds.includes(e.id));
  const chosenAcomptes = unpaidAcomptes.filter((a) => acompteIds.includes(a.id));
  const chosenChildren = childCharges.filter((c) => childIds.includes(c.studentId));
  const expensesTotal = chosenExpenses.reduce((s, e) => s + e.amount, 0);
  const acomptesTotal = chosenAcomptes.reduce((s, a) => s + a.amount, 0);
  const childrenTotal = chosenChildren.reduce((s, c) => s + c.amount, 0);
  const deductionsTotal = expensesTotal + acomptesTotal + childrenTotal;
  const net = gross - deductionsTotal;

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
        childCharges: chosenChildren,
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
            childCharges: chosenChildren,
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
    <Modal open onClose={onClose} title="Règlement de l'enseignant — mois par mois" full>
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

            {/* ---- les emplois du temps, mois par mois ------------------ */}
            <div className="max-h-[42vh] space-y-3 overflow-y-auto pr-1">
              {owingEmplois.map((e) => (
                <div key={e.sessionId} className="overflow-hidden rounded-2xl border border-line">
                  <div className="flex flex-wrap items-center justify-between gap-2 bg-canvas/40 p-3">
                    <div className="min-w-0">
                      <strong className="block text-xs text-ink">
                        📚 {e.title}
                        {e.isOpen && (
                          <Badge tone="success" className="ml-1.5 text-[9px]">
                            Séance libre
                          </Badge>
                        )}
                      </strong>
                      <span className="block text-[10px] text-muted">
                        {e.className} · Gr. {e.groupName} · {e.daysLabel} ·{" "}
                        <span className="font-mono">{e.timeLabel}</span>
                      </span>
                      <span className="block text-[10px] text-muted">
                        {e.size} séances / mois ·{" "}
                        {e.priced ? (
                          <>part enseignant {formatDA(e.perSeance)} / séance</>
                        ) : (
                          <span className="font-semibold text-warning">
                            aucune part enseignant définie
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
                      <Button size="sm" variant="outline" onClick={() => toggleEmploi(e)}>
                        Tout cocher / décocher
                      </Button>
                    </div>
                  </div>

                  <div className="divide-y divide-line/60">
                    {e.months.map((m) => (
                      <MonthLine
                        key={m.key}
                        month={m}
                        checked={selectedKeys.includes(m.key)}
                        expanded={expandedKey === m.key}
                        share={selectedKeys.includes(m.key) ? monthShare(m) : 0}
                        method={method}
                        pct={pct}
                        dueShare={dueShare}
                        onToggle={() => toggleMonth(m.key)}
                        onExpand={() => setExpandedKey(expandedKey === m.key ? null : m.key)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>

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
                <div className="max-h-44 overflow-y-auto rounded-xl border border-line bg-surface">
                  <table className="w-full text-[11px]">
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

            {/* ---- retenues -------------------------------------------- */}
            <div className="space-y-3 rounded-2xl border border-warning/30 bg-warning/5 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-warning">
                  Retenues sur ce règlement
                </span>
                <Badge tone="danger" className="font-mono font-bold">
                  − {formatDA(deductionsTotal)}
                </Badge>
              </div>

              {unpaidExpenses.length === 0 &&
              unpaidAcomptes.length === 0 &&
              childCharges.length === 0 ? (
                <p className="text-[11px] italic text-muted">
                  Aucune dépense, aucun acompte et aucun enfant à charge en attente.
                </p>
              ) : (
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                  <DeductionBox
                    title={`Dépenses (${unpaidExpenses.length})`}
                    total={expensesTotal}
                    empty="Aucune dépense en attente."
                    rows={unpaidExpenses.map((e) => ({
                      id: e.id,
                      title: e.name,
                      sub: `${formatDateFr(e.date)}${e.description ? ` · ${e.description}` : ""}`,
                      amount: e.amount,
                    }))}
                    selected={expenseIds}
                    onToggle={(id) =>
                      setExpenseIds((prev) =>
                        prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
                      )
                    }
                  />
                  <DeductionBox
                    title={`Acomptes (${unpaidAcomptes.length})`}
                    total={acomptesTotal}
                    empty="Aucun acompte en attente."
                    rows={unpaidAcomptes.map((a) => ({
                      id: a.id,
                      title: "Acompte",
                      sub: `${formatDateFr(a.date.slice(0, 10))}${a.description ? ` · ${a.description}` : ""}`,
                      amount: a.amount,
                    }))}
                    selected={acompteIds}
                    onToggle={(id) =>
                      setAcompteIds((prev) =>
                        prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
                      )
                    }
                  />
                  <DeductionBox
                    title={`Scolarité enfants (${childCharges.length})`}
                    total={childrenTotal}
                    empty="Aucun enfant à charge en dette."
                    rows={childCharges.map((c) => ({
                      id: c.studentId,
                      title: c.studentName,
                      sub: `N° ${c.registrationNumber} · ${c.lines
                        .map((l) => `${l.label} ${l.monthCode} ${formatDA(l.amount)}`)
                        .join(" · ")}`,
                      amount: c.amount,
                    }))}
                    selected={childIds}
                    onToggle={(id) =>
                      setChildIds((prev) =>
                        prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
                      )
                    }
                  />
                </div>
              )}
            </div>

            {/* ---- net à verser ---------------------------------------- */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border-2 border-success/40 bg-success/5 p-4">
              <div>
                <span className="block text-[10px] font-bold uppercase text-muted">
                  Net à verser
                </span>
                <strong className={`text-xl font-black ${net < 0 ? "text-danger" : "text-success"}`}>
                  {formatDA(net)}
                </strong>
                <span className="mt-0.5 block text-[10px] text-muted">
                  Brut {formatDA(gross)}
                  {deductionsTotal > 0 && (
                    <>
                      {" "}
                      − retenues {formatDA(deductionsTotal)}
                      <span className="text-[9px]">
                        {" "}
                        (dépenses {expensesTotal} · acomptes {acomptesTotal} · enfants{" "}
                        {childrenTotal})
                      </span>
                    </>
                  )}
                </span>
                <span className="mt-0.5 block text-[10px] text-muted">
                  {chosen.map((m) => m.code).join(", ") || "aucun mois"} ·{" "}
                  {chosenDues.length} présence(s)
                  {chosenPassagers.length > 0 && ` · ${chosenPassagers.length} passager(s)`}
                </span>
                {withheldTotal > 0 && (
                  <span className="mt-1 block rounded-lg bg-danger/10 px-2 py-1 text-[10px] font-semibold text-danger">
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

function MonthLine({
  month,
  checked,
  expanded,
  share,
  method,
  pct,
  dueShare,
  onToggle,
  onExpand,
}: {
  month: TeacherMonth;
  checked: boolean;
  expanded: boolean;
  share: number;
  method: PayMethod;
  pct: number;
  dueShare: (d: TeacherDue) => number;
  onToggle: () => void;
  onExpand: () => void;
}) {
  const closed = month.state === "done";
  return (
    <div className={month.isCurrent ? "bg-primary-50/20" : ""}>
      <div className="flex flex-wrap items-center justify-between gap-2 p-3">
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
                {closed ? "Mois clos" : `En cours — séance ${Math.min(month.held, month.size)}/${month.size}`}
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
          <Button size="sm" variant="outline" onClick={onExpand}>
            {expanded ? "Masquer" : "Détails élèves"}
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="space-y-2 border-t border-line bg-surface p-3">
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

          {month.dates.length > 0 && (
            <p className="text-[10px] text-muted">
              <strong className="text-ink">Séances :</strong>{" "}
              {month.dates.map((d, i) => (
                <span key={d} className="font-mono">
                  {i > 0 ? " · " : ""}S{i + 1} {formatDateFr(d)}
                </span>
              ))}
            </p>
          )}

          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-[11px]">
              <thead>
                <tr className="text-left text-[9px] uppercase tracking-wide text-muted">
                  <th className="py-1">N°</th>
                  <th className="py-1">Élève</th>
                  <th className="py-1 text-right">Son tarif</th>
                  <th className="py-1 text-center">Séances</th>
                  <th className="py-1 text-center">P / A</th>
                  <th className="py-1 text-right">Versé</th>
                  <th className="py-1 text-right">Reste dû</th>
                  <th className="py-1">Statut</th>
                  <th className="py-1 text-right">
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
                {month.students.map((st) => {
                  const badge = PAY_STATE[st.status];
                  const dues = month.dues.filter((d) => d.studentId === st.studentId && !d.paid);
                  const payable = dues.filter((d) => !d.withheld);
                  return (
                    <tr
                      key={st.studentId}
                      className={`border-t border-line/50 ${st.debt > 0 ? "bg-danger/5" : ""}`}
                    >
                      <td className="py-1.5 font-mono text-muted">{st.registrationNumber}</td>
                      <td className="py-1.5">
                        <strong className="text-ink">{st.name}</strong>
                        {st.caseLabel && (
                          <Badge tone="warning" className="ml-1.5 text-[8px]">
                            {st.caseLabel}
                          </Badge>
                        )}
                        {st.previousDebt > 0 && (
                          <span className="block text-[9px] text-danger">
                            + {formatDA(st.previousDebt)} d&apos;arriérés
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 text-right font-mono text-muted">
                        {formatDA(st.unitPrice)}
                        <span className="block text-[8px]">séance · {formatDA(st.expected)} / mois</span>
                      </td>
                      <td className="py-1.5 text-center font-mono">
                        {st.done}/{st.size}
                      </td>
                      <td className="py-1.5 text-center font-mono text-muted">
                        {st.presents} / {st.absents}
                      </td>
                      <td className="py-1.5 text-right font-mono text-success">
                        {formatDA(st.credited)}
                      </td>
                      <td className="py-1.5 text-right font-mono">
                        {st.debt > 0 ? (
                          <strong className="text-danger">{formatDA(st.debt)}</strong>
                        ) : (
                          <span className="text-success">0</span>
                        )}
                      </td>
                      <td className="py-1.5">
                        <Badge tone={badge.tone} className="text-[9px]">
                          {badge.label}
                        </Badge>
                      </td>
                      <td className="py-1.5 text-right font-mono font-bold text-primary">
                        {payable.length === 0 && dues.length > 0
                          ? "— (dette)"
                          : formatDA(payable.reduce((s, d) => s + dueShare(d), 0))}
                      </td>
                    </tr>
                  );
                })}
                {month.passagers.map((p) => (
                  <tr key={p.id} className="border-t border-line/50">
                    <td className="py-1.5 font-mono text-muted">—</td>
                    <td className="py-1.5">
                      <strong className="text-ink">{p.name}</strong>
                      <Badge tone="warning" className="ml-1.5 text-[8px]">
                        Passager
                      </Badge>
                    </td>
                    <td className="py-1.5 text-right font-mono text-muted">{formatDA(p.price)}</td>
                    <td className="py-1.5 text-center font-mono">1</td>
                    <td className="py-1.5 text-center font-mono text-muted">1 / 0</td>
                    <td className="py-1.5 text-right font-mono text-success">
                      {formatDA(p.price)}
                    </td>
                    <td className="py-1.5 text-right font-mono text-success">0</td>
                    <td className="py-1.5">
                      <Badge tone="success" className="text-[9px]">
                        Payé
                      </Badge>
                    </td>
                    <td className="py-1.5 text-right font-mono text-muted">—</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function DeductionBox({
  title,
  total,
  empty,
  rows,
  selected,
  onToggle,
}: {
  title: string;
  total: number;
  empty: string;
  rows: { id: string; title: string; sub: string; amount: number }[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase text-muted">{title}</span>
        <strong className="text-xs text-danger">− {formatDA(total)}</strong>
      </div>
      {rows.length === 0 ? (
        <p className="text-[10px] italic text-muted">{empty}</p>
      ) : (
        <div className="max-h-40 space-y-1.5 overflow-y-auto">
          {rows.map((r) => (
            <label
              key={r.id}
              className="flex cursor-pointer items-start gap-2 rounded-lg border border-line/60 p-2 text-[11px] hover:bg-primary-50/40"
            >
              <input
                type="checkbox"
                checked={selected.includes(r.id)}
                onChange={() => onToggle(r.id)}
                className="mt-0.5 h-3.5 w-3.5 shrink-0"
              />
              <span className="min-w-0 flex-1">
                <strong className="block text-ink">{r.title}</strong>
                <span className="block text-[10px] text-muted">{r.sub}</span>
              </span>
              <strong className="shrink-0 font-mono text-danger">{formatDA(r.amount)}</strong>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
