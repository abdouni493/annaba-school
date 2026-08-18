"use client";

import { useMemo, useState } from "react";
import { useData, uid } from "@/lib/store/data";
import {
  createRoleUser,
  deleteRoleUser,
  resetUserPassword,
  updateUserEmail,
} from "@/lib/accounts/users";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { Input, Select } from "@/components/ui/SearchInput";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  Trash2,
  Edit,
  Eye,
  Plus,
  MoreVertical,
  DollarSign,
  Percent,
  Printer,
  Receipt,
  Search,
  Users,
  Clock,
  X,
} from "lucide-react";
import type {
  Teacher,
  TeacherChildCharge,
  TeacherPaymentDeduction,
  TeacherPaymentDetail,
} from "@/lib/types";
import { printHtmlDocument } from "@/lib/print";
import { formatDA } from "@/lib/utils";
import { buildTeacherPaymentReport } from "@/lib/reports/teacherPayment";
import { buildTeacherSettlementReceipt } from "@/lib/reports/teacherSettlement";
import {
  buildTeacherPayslip,
  type PayslipEmploi,
  type PayslipStudent,
} from "@/lib/reports/teacherPayslip";
import {
  cycleSizeOf,
  monthlyPriceOf,
  schoolMonthShareOf,
  teacherMonthShareOf,
  teacherPerSeanceOf,
  formatDateFr,
  formatDays,
  registrationNumberOf,
  salleName,
  studentCaseLabel,
  studentSoldDebtRows,
  todayIso,
} from "@/lib/helpers";
import { useSettings } from "@/lib/store/settings";

/** One unpaid timing of a teacher: a (date, séance) pair with everyone who was
 *  present on it — registered students AND passagers. */
interface UnpaidTiming {
  key: string; // "YYYY-MM-DD|sessionId" — the key the settlement RPC expects
  dateKey: string;
  sessionId: string;
  isOpen: boolean;
  title: string;
  moduleName: string;
  className: string;
  groupName: string;
  startTime: string;
  endTime: string;
  students: {
    studentId?: string;
    name: string;
    groupName: string;
    time: string;
    status: string;
    fee: number;
    share: number;
    isPassager: boolean;
    /** the student still owes money: the teacher is NOT paid for this présence
     *  yet — it carries over to the next settlement once the debt is cleared */
    withheld: boolean;
  }[];
  passagers: number;
  totalFees: number;
  totalShare: number;
  /** share of students who have paid — the only part actually settled now */
  payableShare: number;
  /** share withheld because the student is still in debt */
  withheldShare: number;
}

export function TeachersPage() {
  const db = useData();
  const {
    teachers,
    sessions,
    modules,
    groups,
    classes,
    subscriptions,
    students,
    payments,
    unpaidTeacher,
    acomptes,
    teacherExpenses,
    absences,
    cash,
    attendance,
    independent,
    teacherPayments,
    school,
    push,
    deleteFrom,
    updateItem,
    payTeacherSessions,
  } = db;
  const { language } = useSettings();

  // Modals
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isAcompteOpen, setIsAcompteOpen] = useState(false);
  const [isExpenseOpen, setIsExpenseOpen] = useState(false);
  const [isAbsenceOpen, setIsAbsenceOpen] = useState(false);
  const [isPrintOpen, setIsPrintOpen] = useState(false);
  const [selectedTeacher, setSelectedTeacher] = useState<Teacher | null>(null);

  // Form: Create/Edit Teacher
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [paymentType, setPaymentType] = useState<"monthly" | "percentage">("percentage");
  const [monthlyAmount, setMonthlyAmount] = useState<number>(0);
  const [startDate, setStartDate] = useState(new Date().toISOString().split("T")[0]);
  const [percentage, setPercentage] = useState<number>(50);

  // Form: Acompte & Absence
  const [amount, setAmount] = useState<number>(0);
  const [description, setDescription] = useState("");
  const [actionDate, setActionDate] = useState(new Date().toISOString().split("T")[0]);

  // Form: dépense de l'enseignant — nom, montant, description (optionnelle), date
  const [expenseName, setExpenseName] = useState("");
  const [expenseAmount, setExpenseAmount] = useState<number>(0);
  const [expenseDesc, setExpenseDesc] = useState("");
  const [expenseDate, setExpenseDate] = useState(todayIso());

  // Form: Print
  const [printStart, setPrintStart] = useState("");
  const [printEnd, setPrintEnd] = useState("");

  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [detailsTab, setDetailsTab] = useState<"info" | "finance" | "sessions">("info");
  const [sessionFilter, setSessionFilter] = useState<"all" | "paid" | "unpaid">("all");

  // ---- List search / filters ------------------------------------------------
  const [teacherSearch, setTeacherSearch] = useState("");
  const [teacherKind, setTeacherKind] = useState<"all" | "staff" | "passager">("all");

  // ---- Per-timing settlement (séance libre + enseignant passager) ----------
  const [isTimingPayOpen, setIsTimingPayOpen] = useState(false);
  const [selectedTimingKeys, setSelectedTimingKeys] = useState<string[]>([]);
  const [payMethod, setPayMethod] = useState<"fixed" | "percent">("fixed");
  const [payFixedAmount, setPayFixedAmount] = useState<number>(0);
  const [payPercentage, setPayPercentage] = useState<number>(50);
  const [expandedTimingKey, setExpandedTimingKey] = useState<string | null>(null);
  const [timingGroupFilter, setTimingGroupFilter] = useState<string>("all");
  const [savingPayment, setSavingPayment] = useState(false);
  /** What the settlement takes off the pay: dépenses, acomptes, and the
   *  schooling of the teacher's own children. All three are ticked by default
   *  and settled once — they never come back on the next payment. */
  const [payExpenseIds, setPayExpenseIds] = useState<string[]>([]);
  const [payAcompteIds, setPayAcompteIds] = useState<string[]>([]);
  const [payChildIds, setPayChildIds] = useState<string[]>([]);
  // Passager teacher created straight from this page
  const [isPassagerCreateOpen, setIsPassagerCreateOpen] = useState(false);

  // Helpers
  const getTeacherUnpaidSessions = (tid: string) => {
    return unpaidTeacher.filter((u) => u.teacherId === tid && !u.paid);
  };

  const getTeacherAcomptes = (tid: string) => {
    return acomptes.filter((a) => a.teacherId === tid);
  };

  /** Acomptes not yet taken off a settlement — the only ones a payment shows. */
  const getUnpaidAcomptes = (tid: string) =>
    acomptes.filter((a) => a.teacherId === tid && !a.paid);

  const getTeacherExpenses = (tid: string) =>
    teacherExpenses.filter((e) => e.teacherId === tid);

  /** Dépenses not yet taken off a settlement. */
  const getUnpaidExpenses = (tid: string) =>
    teacherExpenses.filter((e) => e.teacherId === tid && !e.paid);

  /**
   * The teacher's own children, and what their schooling still costs. Their
   * case is `teacher_child`: the school is paid from their father's salary, so
   * every emploi they are in the red on is listed here and deducted from his
   * pay — which clears their solde at the same time.
   */
  const getChildCharges = (tid: string): TeacherChildCharge[] =>
    students
      .filter((st) => st.studentCase === "teacher_child" && st.teacherFatherId === tid)
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
      .filter((c) => c.lines.length > 0);

  const getTeacherAbsences = (tid: string) => {
    return absences.filter((a) => a.teacherId === tid);
  };


  // ---------------------------------------------------------------------------
  // Per-timing view of what a teacher is still owed.
  //
  // A "timing" is one (date, séance) pair. The presences of registered students
  // come from `unpaid_teacher_sessions` (one row per présence, flipped to paid
  // by the settlement RPC), and the passagers come from the séances libres
  // recorded on the Séances Libres screen for the same timing — so the payout
  // screen shows the FULL attendance of the créneau.
  //
  // Only UNPAID timings are ever listed: once settled, the underlying rows are
  // `paid = true` and the timing disappears from here for good.
  // ---------------------------------------------------------------------------
  /** A student still owes money — the teacher is withheld until it is paid. */
  const hasDebt = (studentId: string) => {
    const debt = payments.filter((p) => p.studentId === studentId).reduce((s, p) => s + p.rest, 0);
    if (debt > 0) return true;
    return (students.find((s) => s.id === studentId)?.registrationDue ?? 0) > 0;
  };

  const buildUnpaidTimings = (tid: string): UnpaidTiming[] => {
    const map = new Map<string, UnpaidTiming>();

    const timingFor = (sessionId: string, dateKey: string): UnpaidTiming => {
      const key = `${dateKey}|${sessionId}`;
      let t = map.get(key);
      if (!t) {
        const sess = sessions.find((s) => s.id === sessionId);
        const moduleName = sess ? modules.find((m) => m.id === sess.moduleId)?.name ?? "Séance" : "Séance";
        t = {
          key,
          dateKey,
          sessionId,
          isOpen: !!sess?.isOpen,
          title: sess?.isOpen ? sess.title || `Séance libre — ${moduleName}` : moduleName,
          moduleName,
          className: sess ? classes.find((c) => c.id === sess.classId)?.name ?? "-" : "-",
          groupName: sess
            ? sess.isOpen
              ? (sess.groupIds?.length ? sess.groupIds : [sess.groupId])
                  .map((id) => groups.find((g) => g.id === id)?.name ?? "-")
                  .join(" · ")
              : groups.find((g) => g.id === sess.groupId)?.name ?? "-"
            : "-",
          startTime: sess?.startTime ?? "",
          endTime: sess?.endTime ?? "",
          students: [],
          passagers: 0,
          totalFees: 0,
          totalShare: 0,
          payableShare: 0,
          withheldShare: 0,
        };
        map.set(key, t);
      }
      return t;
    };

    // Registered students, from the teacher's unpaid dues
    unpaidTeacher
      .filter((u) => u.teacherId === tid && !u.paid)
      .forEach((u) => {
        const dateKey = new Date(u.date).toLocaleDateString("fr-CA");
        const t = timingFor(u.sessionId, dateKey);
        const stu = students.find((st) => st.id === u.studentId);
        const att = attendance.find(
          (a) =>
            a.studentId === u.studentId &&
            a.sessionId === u.sessionId &&
            new Date(a.timestamp).toLocaleDateString("fr-CA") === dateKey,
        );
        const sess = sessions.find((s) => s.id === u.sessionId);
        const withheld = hasDebt(u.studentId);
        t.students.push({
          studentId: u.studentId,
          name: stu ? `${stu.firstName} ${stu.lastName}` : "Élève inconnu",
          groupName: sess ? groups.find((g) => g.id === sess.groupId)?.name ?? "-" : "-",
          time: new Date(att?.timestamp ?? u.date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          status: att?.status === "late" ? "En Retard" : "Présent",
          fee: att?.amountDeducted ?? 0,
          share: u.amount,
          isPassager: false,
          withheld,
        });
        t.totalFees += att?.amountDeducted ?? 0;
        t.totalShare += u.amount;
        if (withheld) t.withheldShare += u.amount;
        else t.payableShare += u.amount;
      });

    // Passagers of the same timings (séances libres, no student account).
    // `teacherPaid` is their own settlement flag: a créneau attended only by
    // passagers has no unpaid_teacher_sessions row to flip.
    const teacherSessionIds = new Set(sessions.filter((s) => s.teacherId === tid).map((s) => s.id));
    independent
      .filter(
        (ind) => ind.sessionId && teacherSessionIds.has(ind.sessionId) && !ind.studentId && !ind.teacherPaid,
      )
      .forEach((ind) => {
        const key = `${ind.date}|${ind.sessionId}`;
        // A passager alone can also create the timing: he still generated money.
        const t = map.get(key) ?? timingFor(ind.sessionId!, ind.date);
        t.students.push({
          name: ind.passagerName ?? "Passager",
          groupName: "Passager",
          time: ind.startTime ?? "-",
          status: "Présent",
          fee: ind.price,
          share: 0,
          isPassager: true,
          withheld: false,
        });
        t.passagers += 1;
        t.totalFees += ind.price;
      });

    return [...map.values()].sort(
      (a, b) => b.dateKey.localeCompare(a.dateKey) || a.startTime.localeCompare(b.startTime),
    );
  };

  /** The timings currently listed in the payment modal (memoised: the modal
   *  recomputes them on every keystroke of the amount field otherwise). */
  const payTimings = useMemo(
    () => (selectedTeacher ? buildUnpaidTimings(selectedTeacher.id) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedTeacher, unpaidTeacher, independent, attendance, sessions, students, groups, modules, classes],
  );

  const chosenTimings = payTimings.filter((t) => selectedTimingKeys.includes(t.key));
  const chosenPresents = chosenTimings.reduce((s, t) => s + t.students.length, 0);
  const chosenPassagers = chosenTimings.reduce((s, t) => s + t.passagers, 0);
  const chosenRevenue = chosenTimings.reduce((s, t) => s + t.totalFees, 0);
  /** Fees of paid students only — the base for a fixed amount's proportional
   *  spread, and what the percentage method applies to. */
  const chosenPayableRevenue = chosenTimings.reduce(
    (s, t) => s + t.students.filter((st) => !st.withheld).reduce((a, st) => a + st.fee, 0),
    0,
  );
  /** Withheld share across the chosen timings — shown as "en attente" and
   *  never paid until the students clear their debt. */
  const chosenWithheldShare = chosenTimings.reduce((s, t) => s + t.withheldShare, 0);
  const chosenWithheldCount = chosenTimings.reduce(
    (s, t) => s + t.students.filter((st) => st.withheld).length,
    0,
  );

  /**
   * What the teacher gets for the chosen timings.
   *  - "fixed": whatever the user typed.
   *  - "percent": the percentage is applied to what each student generated
   *    (module cost × %), summed over every présence — computed automatically.
   */
  const computedPayout = useMemo(() => {
    if (payMethod === "fixed") return Math.max(0, Math.round(payFixedAmount || 0));
    const pct = Math.min(Math.max(payPercentage || 0, 0), 100);
    // Only students who have paid are counted — a student in debt is withheld.
    return chosenTimings.reduce(
      (sum, t) =>
        sum +
        t.students
          .filter((st) => !st.withheld)
          .reduce((s, st) => s + Math.round((st.fee * pct) / 100), 0),
      0,
    );
  }, [payMethod, payFixedAmount, payPercentage, chosenTimings]);

  // ---- Retenues : dépenses, acomptes, scolarité des enfants ---------------
  /** Only what has NEVER been settled: once a payment clears a dépense or an
   *  acompte it is flagged paid and disappears from here for good. */
  const payExpenses = selectedTeacher ? getUnpaidExpenses(selectedTeacher.id) : [];
  const payAcomptes = selectedTeacher ? getUnpaidAcomptes(selectedTeacher.id) : [];
  const payChildren = selectedTeacher ? getChildCharges(selectedTeacher.id) : [];

  const chosenExpenses = payExpenses.filter((e) => payExpenseIds.includes(e.id));
  const chosenAcomptes = payAcomptes.filter((a) => payAcompteIds.includes(a.id));
  const chosenChildren = payChildren.filter((c) => payChildIds.includes(c.studentId));

  const expensesTotal = chosenExpenses.reduce((s, e) => s + e.amount, 0);
  const acomptesTotal = chosenAcomptes.reduce((s, a) => s + a.amount, 0);
  const childrenTotal = chosenChildren.reduce((s, c) => s + c.amount, 0);
  const deductionsTotal = expensesTotal + acomptesTotal + childrenTotal;

  /** What the teacher actually takes home. It may go negative — he has drawn
   *  more in advances and costs than the séances earned him. */
  const netPayout = computedPayout - deductionsTotal;

  /** Per-timing share, distributed the same way the total is computed — always
   *  over paid students only. */
  const shareForTiming = (t: UnpaidTiming) => {
    const payableFees = t.students.filter((st) => !st.withheld).reduce((s, st) => s + st.fee, 0);
    if (payMethod === "percent") {
      const pct = Math.min(Math.max(payPercentage || 0, 0), 100);
      return t.students
        .filter((st) => !st.withheld)
        .reduce((s, st) => s + Math.round((st.fee * pct) / 100), 0);
    }
    // Fixed amount: spread proportionally to what each timing's PAID students
    // generated, so the printed slip still adds up to the amount actually paid.
    if (chosenPayableRevenue <= 0) {
      return chosenTimings.length > 0 ? Math.round(computedPayout / chosenTimings.length) : 0;
    }
    return Math.round((computedPayout * payableFees) / chosenPayableRevenue);
  };

  /**
   * Regroups the chosen timings by EMPLOI DU TEMPS (not by date): the payslip
   * shows one table per emploi, each listing its students once with how many
   * séances they attended over the settled period and what that earned him.
   */
  const buildPayslipEmplois = (): PayslipEmploi[] => {
    const byEmploi = new Map<string, PayslipEmploi>();

    for (const t of chosenTimings) {
      let e = byEmploi.get(t.sessionId);
      if (!e) {
        const sess = sessions.find((x) => x.id === t.sessionId);
        e = {
          sessionId: t.sessionId,
          title: t.title,
          className: t.className,
          groupName: t.groupName,
          salleName: sess ? salleName(db, sess.salleId) : "—",
          daysLabel: sess ? formatDays(sess.days) || "—" : "—",
          timeLabel: `${t.startTime} - ${t.endTime}`,
          sessionsCount: 0,
          students: [],
          presents: 0,
          fees: 0,
          total: 0,
        };
        byEmploi.set(t.sessionId, e);
      }
      e.sessionsCount += 1;

      const share = shareForTiming(t);
      const payableFees = t.students.filter((st) => !st.withheld).reduce((a, st) => a + st.fee, 0);

      for (const st of t.students) {
        const key = st.studentId ?? `passager:${st.name}`;
        let row = e.students.find((r) => (r.studentId ?? `passager:${r.name}`) === key);
        if (!row) {
          const stu = st.studentId ? students.find((x) => x.id === st.studentId) : undefined;
          row = {
            studentId: st.studentId,
            name: st.name,
            registrationNumber: stu ? registrationNumberOf(db, stu) : undefined,
            caseLabel: stu ? studentCaseLabel(stu) || undefined : undefined,
            isPassager: st.isPassager,
            withheld: st.withheld,
            presents: 0,
            fees: 0,
            total: 0,
          } satisfies PayslipStudent;
          e.students.push(row);
        }
        row.presents += 1;
        row.fees += st.fee;
        // A withheld présence earns him nothing yet, so it adds 0 — but it is
        // still printed, flagged, so the count matches the sheet.
        if (!st.withheld) {
          row.total +=
            payMethod === "percent"
              ? Math.round((st.fee * Math.min(Math.max(payPercentage || 0, 0), 100)) / 100)
              : payableFees > 0
                ? Math.round((share * st.fee) / payableFees)
                : 0;
        }
        // Once a présence is withheld, the row stays flagged.
        row.withheld = row.withheld || st.withheld;
        e.presents += 1;
        e.fees += st.fee;
      }
    }

    for (const e of byEmploi.values()) {
      e.students.sort((a, b) => a.name.localeCompare(b.name));
      e.total = e.students.reduce((sum, r) => sum + r.total, 0);
    }
    return [...byEmploi.values()].sort((a, b) => a.title.localeCompare(b.title));
  };

  const openTimingPay = (t: Teacher) => {
    setSelectedTeacher(t);
    const timings = buildUnpaidTimings(t.id);
    setSelectedTimingKeys(timings.map((x) => x.key));
    // A salaried teacher opens on his contract amount; everyone else on the
    // percentage his présences earn.
    const monthly = t.paymentType === "monthly";
    setPayMethod(t.isPassager || monthly ? "fixed" : "percent");
    setPayFixedAmount(monthly ? t.monthlyAmount ?? 0 : 0);
    setPayPercentage(t.percentage ?? 50);
    setExpandedTimingKey(null);
    setTimingGroupFilter("all");
    // Everything still owed is ticked by default — the desk unticks what it
    // wants to carry over to the next settlement.
    setPayExpenseIds(getUnpaidExpenses(t.id).map((e) => e.id));
    setPayAcompteIds(getUnpaidAcomptes(t.id).map((a) => a.id));
    setPayChildIds(getChildCharges(t.id).map((c) => c.studentId));
    setIsTimingPayOpen(true);
    setActiveMenuId(null);
  };

  const handleTimingPayment = async () => {
    if (!selectedTeacher) return;
    if (selectedTimingKeys.length === 0) {
      alert("Sélectionnez au moins un créneau à régler.");
      return;
    }
    if (computedPayout <= 0) {
      alert("Le montant brut des séances doit être supérieur à 0 DA.");
      return;
    }
    if (netPayout < 0 && !confirm(
      `Les retenues (${deductionsTotal} DA) dépassent le brut (${computedPayout} DA).\n` +
      `L'enseignant sera enregistré à ${netPayout} DA. Continuer ?`,
    )) {
      return;
    }

    const details: TeacherPaymentDetail[] = chosenTimings.map((t) => ({
      dateKey: t.dateKey,
      sessionId: t.sessionId,
      title: t.title,
      moduleName: t.moduleName,
      groupName: t.groupName,
      startTime: t.startTime,
      endTime: t.endTime,
      presents: t.students.length,
      passagers: t.passagers,
      gross: t.totalFees,
      share: shareForTiming(t),
    }));

    // The payslip is built from what is on screen, BEFORE the store settles
    // anything: once the dépenses are flagged paid and the children's soldes
    // are cleared, those figures are gone.
    const emplois = buildPayslipEmplois();
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

    setSavingPayment(true);
    try {
      const res = await payTeacherSessions({
        teacherId: selectedTeacher.id,
        keys: selectedTimingKeys,
        amount: netPayout,
        gross: computedPayout,
        method: payMethod,
        percentage: payMethod === "percent" ? payPercentage : undefined,
        details,
        description: `Règlement séances ${selectedTeacher.firstName} ${selectedTeacher.lastName}`,
        expenseIds: chosenExpenses.map((e) => e.id),
        acompteIds: chosenAcomptes.map((a) => a.id),
        childCharges: chosenChildren,
      });

      if (!res.ok) {
        alert("Le règlement a échoué — veuillez réessayer.");
        return;
      }

      setIsTimingPayOpen(false);

      if (confirm(`Paiement de ${netPayout} DA enregistré. Imprimer la fiche de paie ?`)) {
        printHtmlDocument(
          buildTeacherPayslip({
            teacher: selectedTeacher,
            school,
            lang: language,
            paidAt,
            receiptNo: res.paymentId ? `PAY-${res.paymentId.slice(0, 8).toUpperCase()}` : undefined,
            method: payMethod,
            percentage: payMethod === "percent" ? payPercentage : undefined,
            emplois,
            expenses: expenseLines,
            acomptes: acompteLines,
            childCharges: chosenChildren,
            gross: computedPayout,
            net: netPayout,
            withheld: { count: chosenWithheldCount, amount: chosenWithheldShare },
          }),
        );
      }
    } finally {
      setSavingPayment(false);
    }
  };

  /** Records a cost the school carried for a teacher — it is taken off his
   *  next settlement, once. */
  const handleCreateExpense = () => {
    if (!selectedTeacher) return;
    if (!expenseName.trim()) {
      alert("Le nom de la dépense est obligatoire.");
      return;
    }
    const value = Math.max(0, Math.round(expenseAmount || 0));
    if (value <= 0) {
      alert("Le montant de la dépense doit être supérieur à 0 DA.");
      return;
    }
    push("teacherExpenses", {
      id: uid("tex"),
      teacherId: selectedTeacher.id,
      name: expenseName.trim(),
      amount: value,
      description: expenseDesc.trim() || undefined,
      date: expenseDate || todayIso(),
      paid: false,
      createdAt: new Date().toISOString(),
    });
    setIsExpenseOpen(false);
    setExpenseName("");
    setExpenseAmount(0);
    setExpenseDesc("");
    setExpenseDate(todayIso());
  };

  const openExpense = (t: Teacher) => {
    setSelectedTeacher(t);
    setExpenseName("");
    setExpenseAmount(0);
    setExpenseDesc("");
    setExpenseDate(todayIso());
    setIsExpenseOpen(true);
    setActiveMenuId(null);
  };

  /**
   * Reprints an old settlement. Payments written before the payslip existed
   * have no per-emploi snapshot, so they fall back to the older, timing-based
   * receipt rather than printing an empty table.
   */
  const reprintSettlement = (paymentId: string) => {
    const pay = teacherPayments.find((p) => p.id === paymentId);
    const t = pay ? teachers.find((x) => x.id === pay.teacherId) : undefined;
    if (!pay || !t) return;

    const hasPayslip =
      (pay.expenses?.length ?? 0) > 0 ||
      (pay.acomptes?.length ?? 0) > 0 ||
      (pay.childCharges?.length ?? 0) > 0 ||
      pay.gross != null;

    if (hasPayslip) {
      // The frozen `details` are per (date, timing); regroup them per emploi so
      // the reprint reads like the original.
      const byEmploi = new Map<string, PayslipEmploi>();
      for (const d of pay.details ?? []) {
        let e = byEmploi.get(d.sessionId);
        if (!e) {
          const sess = sessions.find((x) => x.id === d.sessionId);
          e = {
            sessionId: d.sessionId,
            title: d.title || d.moduleName,
            className: sess ? classes.find((c) => c.id === sess.classId)?.name ?? "—" : "—",
            groupName: d.groupName,
            salleName: sess ? salleName(db, sess.salleId) : "—",
            daysLabel: sess ? formatDays(sess.days) || "—" : "—",
            timeLabel: `${d.startTime} - ${d.endTime}`,
            sessionsCount: 0,
            students: [],
            presents: 0,
            fees: 0,
            total: 0,
          };
          byEmploi.set(d.sessionId, e);
        }
        e.sessionsCount += 1;
        e.presents += d.presents;
        e.fees += d.gross;
        e.total += d.share;
      }
      printHtmlDocument(
        buildTeacherPayslip({
          teacher: t,
          school,
          lang: language,
          paidAt: pay.paidAt,
          receiptNo: `PAY-${pay.id.slice(0, 8).toUpperCase()}`,
          method: pay.method,
          percentage: pay.percentage,
          emplois: [...byEmploi.values()],
          expenses: pay.expenses ?? [],
          acomptes: pay.acomptes ?? [],
          childCharges: pay.childCharges ?? [],
          gross: pay.gross ?? pay.amount,
          net: pay.amount,
        }),
      );
      return;
    }

    printHtmlDocument(
      buildTeacherSettlementReceipt({
        teacher: t,
        school,
        lang: language,
        amount: pay.amount,
        method: pay.method,
        percentage: pay.percentage,
        details: Array.isArray(pay.details) ? pay.details : [],
        paidAt: pay.paidAt,
        receiptNo: `PAY-${pay.id.slice(0, 8).toUpperCase()}`,
      }),
    );
  };

  /** Creates a login-less "enseignant passager" straight from this page. */
  const handleCreatePassager = async () => {
    if (!firstName.trim()) {
      alert("Le nom de l'enseignant passager est obligatoire.");
      return;
    }
    const newTeacher: Teacher = {
      id: uid("tch"),
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      phone,
      email: "",
      paymentType: "percentage",
      isPassager: true,
    };
    // A passager has no login: the row is simply added to the store.
    push("teachers", newTeacher);
    setIsPassagerCreateOpen(false);
    resetForm();
  };


  const handleCreateTeacher = async () => {
    if (!firstName || !lastName || !phone || !email) {
      alert("Veuillez remplir tous les champs obligatoires.");
      return;
    }
    if (password.length < 6) {
      alert("Le mot de passe doit contenir au moins 6 caractères.");
      return;
    }

    try {
      const { id: teacherId } = await createRoleUser({
        role: "teacher",
        email,
        password,
        firstName,
        lastName,
        phone,
        paymentType,
        ...(paymentType === "monthly" ? { monthlyAmount, startDate } : { percentage }),
      });

      const newTeacher: Teacher = {
        id: teacherId,
        firstName,
        lastName,
        phone,
        email,
        paymentType,
        ...(paymentType === "monthly" ? { monthlyAmount, startDate } : { percentage }),
      };
      push("teachers", newTeacher);

      setIsCreateOpen(false);
      resetForm();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erreur lors de la création du compte.");
    }
  };

  const handleEditTeacher = async () => {
    if (!selectedTeacher) return;

    if (password) {
      try {
        await resetUserPassword(selectedTeacher.id, password);
      } catch (err) {
        alert(err instanceof Error ? err.message : "Erreur lors du changement de mot de passe.");
        return;
      }
    }

    if (email && email !== selectedTeacher.email) {
      try {
        await updateUserEmail(selectedTeacher.id, email);
      } catch (err) {
        alert(err instanceof Error ? err.message : "Erreur lors du changement d'email.");
        return;
      }
    }

    updateItem("teachers", selectedTeacher.id, {
      firstName,
      lastName,
      phone,
      email,
      paymentType,
      monthlyAmount: paymentType === "monthly" ? monthlyAmount : undefined,
      startDate: paymentType === "monthly" ? startDate : undefined,
      percentage: paymentType === "percentage" ? percentage : undefined,
    });
    setIsEditOpen(false);
    resetForm();
  };

  const handleDelete = (id: string) => {
    if (confirm("Êtes-vous sûr de vouloir supprimer cet enseignant ?")) {
      deleteFrom("teachers", id);
      void deleteRoleUser(id);
      setActiveMenuId(null);
    }
  };

  const handleCreateAcompte = () => {
    if (!selectedTeacher || amount <= 0) return;
    push("acomptes", {
      id: uid("ac"),
      teacherId: selectedTeacher.id,
      amount,
      description: description || "Avance sur salaire",
      date: actionDate,
    });

    // Deduct directly from cash register
    push("cash", {
      id: uid("csh"),
      type: "acompte",
      amount: -amount,
      date: new Date().toISOString(),
      description: `Acompte versé à ${selectedTeacher.firstName} ${selectedTeacher.lastName} (${description || "Acompte"})`,
    });

    setIsAcompteOpen(false);
    setAmount(0);
    setDescription("");
  };

  const handleCreateAbsence = () => {
    if (!selectedTeacher || amount <= 0) return;
    push("absences", {
      id: uid("ab"),
      teacherId: selectedTeacher.id,
      cost: amount,
      description: description || "Absence non justifiée",
      date: actionDate,
    });

    setIsAbsenceOpen(false);
    setAmount(0);
    setDescription("");
  };


  const handlePrintTeacherReport = () => {
    if (!selectedTeacher) return;
    printHtmlDocument(
      buildTeacherPaymentReport({
        teacher: selectedTeacher,
        school,
        lang: language,
        startDate: printStart,
        endDate: printEnd,
        sessions,
        attendance,
        unpaidTeacher,
        modules,
        groups,
        classes,
      }),
    );
    setIsPrintOpen(false);
  };

  const resetForm = () => {
    setFirstName("");
    setLastName("");
    setPhone("");
    setEmail("");
    setPassword("");
    setPaymentType("percentage");
    setMonthlyAmount(0);
    setPercentage(50);
    setSelectedTeacher(null);
  };

  const openEdit = (t: Teacher) => {
    setSelectedTeacher(t);
    setFirstName(t.firstName);
    setLastName(t.lastName);
    setPhone(t.phone);
    setEmail(t.email);
    setPassword("");
    setPaymentType(t.paymentType);
    if (t.paymentType === "monthly") {
      setMonthlyAmount(t.monthlyAmount || 0);
      setStartDate(t.startDate || "");
    } else {
      setPercentage(t.percentage || 50);
    }
    setIsEditOpen(true);
    setActiveMenuId(null);
  };

  const openDetails = (t: Teacher) => {
    setSelectedTeacher(t);
    setDetailsTab("info");
    setSessionFilter("all");
    setIsDetailsOpen(true);
    setActiveMenuId(null);
  };

  const openAcompte = (t: Teacher) => {
    setSelectedTeacher(t);
    setAmount(0);
    setDescription("Avance sur salaire");
    setIsAcompteOpen(true);
    setActiveMenuId(null);
  };

  const openAbsence = (t: Teacher) => {
    setSelectedTeacher(t);
    setAmount(0);
    setDescription("Absence non justifiée");
    setIsAbsenceOpen(true);
    setActiveMenuId(null);
  };


  const openPrint = (t: Teacher) => {
    setSelectedTeacher(t);
    setPrintStart("");
    setPrintEnd("");
    setIsPrintOpen(true);
    setActiveMenuId(null);
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <PageHeader emoji="👨‍🏫" title="Enseignants" subtitle="Gérer le corps enseignant et leurs salaires" />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={() => { resetForm(); setIsPassagerCreateOpen(true); }}
            className="flex items-center gap-2 border-warning/30 text-warning hover:bg-warning/10"
          >
            <Plus className="h-4 w-4" /> Enseignant Passager
          </Button>
          <Button onClick={() => { resetForm(); setIsCreateOpen(true); }} className="flex items-center gap-2">
            <Plus className="h-4 w-4" /> Nouvel Enseignant
          </Button>
        </div>
      </div>

      {/* Search + kind filter */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6 bg-surface border border-line p-3 rounded-2xl">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
          <Input
            value={teacherSearch}
            onChange={(e) => setTeacherSearch(e.target.value)}
            placeholder="Rechercher un enseignant (nom, téléphone, email)..."
            className="pl-9"
          />
        </div>
        <div className="flex gap-1.5">
          {([
            { key: "all", label: `Tous (${teachers.length})` },
            { key: "staff", label: `École (${teachers.filter((t) => !t.isPassager).length})` },
            { key: "passager", label: `Passagers (${teachers.filter((t) => t.isPassager).length})` },
          ] as const).map((k) => (
            <button
              key={k.key}
              onClick={() => setTeacherKind(k.key)}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
                teacherKind === k.key ? "bg-primary text-white shadow-sm" : "bg-canvas text-muted hover:text-ink"
              }`}
            >
              {k.label}
            </button>
          ))}
        </div>
      </div>

      {/* Grid of teachers */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {teachers
          .filter((t) => {
            if (teacherKind === "staff" && t.isPassager) return false;
            if (teacherKind === "passager" && !t.isPassager) return false;
            if (!teacherSearch.trim()) return true;
            return `${t.firstName} ${t.lastName} ${t.phone} ${t.email}`
              .toLowerCase()
              .includes(teacherSearch.toLowerCase());
          })
          .map((t) => {
          const unpaidSess = getTeacherUnpaidSessions(t.id);
          const unpaidTimingsCount = buildUnpaidTimings(t.id).length;

          return (
            <Card
              key={t.id}
              className={`relative transition-all duration-300 ${
                activeMenuId === t.id
                  ? "z-30 scale-[1.02] ring-2 ring-primary/45 shadow-2xl"
                  : "z-10 hover:z-20 hover:shadow-lg hover:-translate-y-0.5 border border-line"
              }`}
            >
              <CardBody className="flex flex-col justify-between min-h-[220px] relative p-5">
                {/* Actions overlay panel */}
                {activeMenuId === t.id && (
                  <div className="absolute inset-0 bg-surface/98 backdrop-blur-md rounded-2xl p-4 flex flex-col justify-between z-20 animate-in fade-in zoom-in-95 duration-200 border border-primary/20">
                    <div className="flex justify-between items-center border-b border-line pb-2">
                      <span className="font-bold text-[10px] text-muted uppercase tracking-wider">
                        Actions: {t.firstName} {t.lastName}
                      </span>
                      <button
                        onClick={() => setActiveMenuId(null)}
                        className="p-1 rounded-lg hover:bg-canvas text-muted hover:text-ink transition-colors"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>

                    {/* A "passager" has no account and no contract with the
                        school: only the two actions the brief asks for. */}
                    <div className="grid grid-cols-2 gap-2 my-2 flex-1 items-center">
                      <button
                        onClick={() => openDetails(t)}
                        className="flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-bold rounded-xl bg-canvas border border-line text-ink hover:bg-primary-50 transition-colors"
                      >
                        <Eye className="h-3.5 w-3.5" /> Détails
                      </button>
                      <button
                        onClick={() => openTimingPay(t)}
                        className="flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-bold rounded-xl bg-success/15 text-success border border-success/30 hover:bg-success/25 transition-colors"
                      >
                        <DollarSign className="h-3.5 w-3.5" /> Payer
                      </button>
                      {!t.isPassager && (
                        <>
                          <button
                            onClick={() => openAcompte(t)}
                            className="flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-bold rounded-xl bg-canvas border border-line text-ink hover:bg-primary-50 transition-colors"
                          >
                            <Plus className="h-3.5 w-3.5" /> Acompte
                          </button>
                          <button
                            onClick={() => openExpense(t)}
                            className="flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-bold rounded-xl bg-warning/15 text-warning border border-warning/30 hover:bg-warning/25 transition-colors"
                          >
                            <Receipt className="h-3.5 w-3.5" /> Dépense
                          </button>
                          <button
                            onClick={() => openAbsence(t)}
                            className="flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-bold rounded-xl bg-danger/15 text-danger border border-danger/30 hover:bg-danger/25 transition-colors"
                          >
                            <Plus className="h-3.5 w-3.5" /> Absence
                          </button>
                          <button
                            onClick={() => openPrint(t)}
                            className="flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-bold rounded-xl bg-canvas border border-line text-ink hover:bg-primary-50 transition-colors"
                          >
                            <Printer className="h-3.5 w-3.5" /> Rapport
                          </button>
                          <button
                            onClick={() => openEdit(t)}
                            className="flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-bold rounded-xl bg-canvas border border-line text-ink hover:bg-primary-50 transition-colors"
                          >
                            <Edit className="h-3.5 w-3.5" /> Modifier
                          </button>
                        </>
                      )}
                    </div>

                    <div className="border-t border-line pt-2">
                      <button
                        onClick={() => handleDelete(t.id)}
                        className="flex items-center justify-center gap-1.5 w-full py-2 px-3 text-xs font-bold rounded-xl bg-danger text-white hover:bg-danger/90 transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Supprimer
                      </button>
                    </div>
                  </div>
                )}

                <div>
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-full bg-primary/10 border border-primary/20 text-primary font-bold text-xs flex items-center justify-center tracking-wider shrink-0">
                        {t.firstName.charAt(0).toUpperCase()}{t.lastName.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <h4 className="text-sm font-bold text-ink hover:text-primary transition-colors truncate">
                          {t.firstName} {t.lastName}
                        </h4>
                        <span className="text-[10px] text-muted block font-mono truncate">{t.phone || "—"}</span>
                        {t.isPassager && (
                          <Badge tone="warning" className="text-[9px] px-1.5 py-0 mt-0.5">Passager</Badge>
                        )}
                      </div>
                    </div>

                    <button
                      onClick={() => setActiveMenuId(activeMenuId === t.id ? null : t.id)}
                      className="p-1.5 rounded-lg hover:bg-primary-50 text-muted hover:text-ink transition-colors shrink-0"
                    >
                      <MoreVertical className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between text-xs bg-canvas/30 border border-line/60 rounded-xl p-2.5">
                      <div>
                        <span className="text-[10px] text-muted block uppercase font-semibold">Contrat</span>
                        <span className="font-semibold text-ink">
                          {t.isPassager ? "À la séance" : t.paymentType === "monthly" ? "Fixe Mensuel" : "Pourcentage"}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] text-muted block uppercase font-semibold">Rémunération</span>
                        <span className="font-bold text-primary">
                          {t.isPassager
                            ? "Montant / %"
                            : t.paymentType === "monthly"
                              ? `${t.monthlyAmount} DA/m`
                              : `${t.percentage}% / élève`}
                        </span>
                      </div>
                    </div>

                    {t.isPassager ? (
                      <div className="grid grid-cols-2 gap-2 text-[11px]">
                        <div className="bg-canvas/20 border border-line/50 p-2 rounded-xl flex flex-col justify-between">
                          <span className="text-muted block text-[9px] uppercase">Créneaux non payés</span>
                          <strong className="text-warning mt-0.5">{unpaidTimingsCount}</strong>
                        </div>
                        <div className="bg-canvas/20 border border-line/50 p-2 rounded-xl flex flex-col justify-between">
                          <span className="text-muted block text-[9px] uppercase">Total déjà versé</span>
                          <strong className="text-success mt-0.5">
                            {teacherPayments.filter((p) => p.teacherId === t.id).reduce((s, p) => s + p.amount, 0)} DA
                          </strong>
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-2 text-[11px]">
                        <div className="bg-canvas/20 border border-line/50 p-2 rounded-xl flex flex-col justify-between">
                          <span className="text-muted block text-[9px] uppercase">Dernier acompte</span>
                          <strong className="text-ink mt-0.5">{getTeacherAcomptes(t.id).slice(-1)[0]?.amount ?? 0} DA</strong>
                        </div>
                        <div className="bg-canvas/20 border border-line/50 p-2 rounded-xl flex flex-col justify-between">
                          <span className="text-muted block text-[9px] uppercase">Absences (Coût)</span>
                          <strong className="text-danger mt-0.5">
                            {getTeacherAbsences(t.id).length} ({getTeacherAbsences(t.id).reduce((s, a) => s + a.cost, 0)} DA)
                          </strong>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* What the next settlement will look like: what his séances
                    still owe him, and what will be taken off it. */}
                {(() => {
                  const pendingDeductions =
                    getUnpaidExpenses(t.id).reduce((sum, e) => sum + e.amount, 0) +
                    getUnpaidAcomptes(t.id).reduce((sum, a) => sum + a.amount, 0);
                  const dueAmount = unpaidSess.reduce((sum, u) => sum + u.amount, 0);
                  const owing = unpaidTimingsCount > 0 || dueAmount > 0;
                  return (
                    <div className="border-t border-line/60 pt-3 mt-4 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[10px] text-muted flex items-center gap-1.5">
                        <span className={`h-1.5 w-1.5 rounded-full ${owing ? "bg-warning animate-pulse" : "bg-success"}`} />
                        {unpaidTimingsCount} créneau(x) dus · {unpaidSess.length} présence(s)
                      </span>
                      <div className="flex items-center gap-1.5">
                        {pendingDeductions > 0 && (
                          <Badge tone="danger" className="font-mono font-bold text-[10px]" title="Dépenses et acomptes à retenir">
                            − {pendingDeductions} DA
                          </Badge>
                        )}
                        <Badge tone={owing ? "warning" : "success"} className="font-mono font-bold text-[10px]">
                          {dueAmount} DA
                        </Badge>
                      </div>
                    </div>
                  );
                })()}
              </CardBody>
            </Card>
          );
        })}
      </div>

      {/* Creation Modal */}
      <Modal open={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="Créer un enseignant" wide>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-muted mb-1 font-sans">Prénom *</label>
            <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Prénom" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Nom *</label>
            <Input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Nom" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Téléphone *</label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+213 5XX XX XX XX" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted mb-1 font-sans">Email (Login) *</label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@ecole.com" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Mot de passe *</label>
            <Input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="6 caractères min." />
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Type de rémunération</label>
            <Select
              value={paymentType}
              onChange={(e) => setPaymentType(e.target.value as "monthly" | "percentage")}
              className="w-full"
            >
              <option value="percentage">Pourcentage par élève/présence</option>
              <option value="monthly">Fixe mensuel</option>
            </Select>
          </div>

          {paymentType === "monthly" ? (
            <>
              <div>
                <label className="block text-xs font-semibold text-muted mb-1">Montant mensuel (DA)</label>
                <Input
                  type="number"
                  value={monthlyAmount || ""}
                  onChange={(e) => setMonthlyAmount(Number(e.target.value))}
                  placeholder="Ex: 45000"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted mb-1">Date de début de contrat</label>
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
            </>
          ) : (
            <div>
              <label className="block text-xs font-semibold text-muted mb-1">Pourcentage par séance (%)</label>
              <Input
                type="number"
                value={percentage || ""}
                onChange={(e) => setPercentage(Number(e.target.value))}
                placeholder="Ex: 55"
              />
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-6 mt-4 border-t border-line">
          <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
            Annuler
          </Button>
          <Button onClick={handleCreateTeacher}>Créer</Button>
        </div>
      </Modal>

      {/* Edit Modal */}
      <Modal open={isEditOpen} onClose={() => setIsEditOpen(false)} title="Modifier l'enseignant" wide>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Prénom</label>
            <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1 font-sans">Nom</label>
            <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Téléphone</label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Email</label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Nouveau mot de passe</label>
            <Input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Laisser vide pour ne pas changer" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Type de rémunération</label>
            <Select
              value={paymentType}
              onChange={(e) => setPaymentType(e.target.value as "monthly" | "percentage")}
              className="w-full"
            >
              <option value="percentage">Pourcentage</option>
              <option value="monthly">Fixe mensuel</option>
            </Select>
          </div>
          {paymentType === "monthly" ? (
            <>
              <div>
                <label className="block text-xs font-semibold text-muted mb-1 font-sans">Salaire mensuel (DA)</label>
                <Input
                  type="number"
                  value={monthlyAmount || ""}
                  onChange={(e) => setMonthlyAmount(Number(e.target.value))}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted mb-1">Date début</label>
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
            </>
          ) : (
            <div>
              <label className="block text-xs font-semibold text-muted mb-1">Pourcentage (%)</label>
              <Input
                type="number"
                value={percentage || ""}
                onChange={(e) => setPercentage(Number(e.target.value))}
              />
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-6 mt-4 border-t border-line">
          <Button variant="outline" onClick={() => setIsEditOpen(false)}>
            Annuler
          </Button>
          <Button onClick={handleEditTeacher}>Enregistrer</Button>
        </div>
      </Modal>

      {/* Details Modal */}
      <Modal open={isDetailsOpen} onClose={() => setIsDetailsOpen(false)} title="Détails de l'Enseignant" wide>
        {selectedTeacher && (
          <div className="space-y-5">
            {/* Header info */}
            <div className="bg-canvas border border-line p-4 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-full bg-primary/10 border border-primary/20 text-primary font-bold text-sm flex items-center justify-center tracking-wider">
                  {selectedTeacher.firstName.charAt(0).toUpperCase()}{selectedTeacher.lastName.charAt(0).toUpperCase()}
                </div>
                <div>
                  <h3 className="font-bold text-base text-ink">{selectedTeacher.firstName} {selectedTeacher.lastName}</h3>
                  <span className="text-xs text-muted block">Téléphone: {selectedTeacher.phone} | Email: {selectedTeacher.email}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {selectedTeacher.isPassager && (
                  <Badge tone="warning" className="text-xs px-3 py-1 font-bold">Enseignant passager</Badge>
                )}
                <Badge tone="primary" className="text-xs px-3 py-1 font-bold">
                  {selectedTeacher.isPassager
                    ? "Réglé à la séance"
                    : selectedTeacher.paymentType === "monthly"
                      ? `Salaire Fixe: ${selectedTeacher.monthlyAmount} DA / mois`
                      : `Rémunération: ${selectedTeacher.percentage}% / séance`}
                </Badge>
              </div>
            </div>

            {/* -------------------------------------------------------------- */}
            {/* Ses emplois du temps et ce que chacun lui rapporte              */}
            {/* -------------------------------------------------------------- */}
            {(() => {
              const mine = sessions.filter((se) => se.teacherId === selectedTeacher.id);
              if (mine.length === 0) return null;
              return (
                <div className="rounded-2xl border border-line bg-surface p-4">
                  <h4 className="mb-3 text-xs font-bold uppercase tracking-wider text-muted">
                    📅 Emplois du temps &amp; rémunération
                  </h4>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[720px] text-left text-xs">
                      <thead>
                        <tr className="border-b border-line text-[10px] font-bold uppercase text-muted">
                          <th className="py-1.5">Emploi du temps</th>
                          <th className="py-1.5 text-center">Séances / mois</th>
                          <th className="py-1.5 text-right">Prix du mois</th>
                          <th className="py-1.5 text-right">Prix séance</th>
                          <th className="py-1.5 text-right">Part école</th>
                          <th className="py-1.5 text-right">Part enseignant</th>
                          <th className="py-1.5 text-right">Séance enseignant</th>
                          <th className="py-1.5 text-center">Inscrits</th>
                        </tr>
                      </thead>
                      <tbody>
                        {mine.map((se) => {
                          const sub = subscriptions.find((x) => x.sessionId === se.id);
                          const label =
                            se.title || modules.find((m) => m.id === se.moduleId)?.name || "Emploi du temps";
                          return (
                            <tr key={se.id} className="border-b border-line/50 last:border-0">
                              <td className="py-2">
                                <span className="block font-semibold text-ink">{label}</span>
                                <span className="block font-mono text-[9px] text-muted">
                                  {groups.find((g) => g.id === se.groupId)?.name ?? "-"} ·{" "}
                                  {se.startTime}-{se.endTime}
                                </span>
                              </td>
                              <td className="py-2 text-center font-mono">
                                {sub ? cycleSizeOf(sub) : "—"}
                              </td>
                              <td className="py-2 text-right font-mono">
                                {sub ? formatDA(monthlyPriceOf(sub)) : "—"}
                              </td>
                              <td className="py-2 text-right font-mono text-primary">
                                {sub ? formatDA(sub.pricePerSession) : "—"}
                              </td>
                              <td className="py-2 text-right font-mono">
                                {sub ? formatDA(schoolMonthShareOf(sub)) : "—"}
                              </td>
                              <td className="py-2 text-right font-mono font-bold text-success">
                                {sub ? formatDA(teacherMonthShareOf(sub)) : "—"}
                              </td>
                              <td className="py-2 text-right font-mono font-bold text-success">
                                {sub ? formatDA(teacherPerSeanceOf(sub)) : "—"}
                              </td>
                              <td className="py-2 text-center font-mono">
                                {sub ? students.filter((st) => st.subscriptionIds.includes(sub.id)).length : 0}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-2 text-[10px] leading-relaxed text-muted">
                    La « séance enseignant » est ce que chaque présence lui rapporte : part enseignant du
                    mois ÷ nombre de séances du mois, telle qu&apos;elle a été fixée à la création de
                    l&apos;emploi du temps.
                  </p>
                </div>
              );
            })()}

            {/* -------------------------------------------------------------- */}
            {/* Passager: a dedicated, complete file (history + payments)       */}
            {/* -------------------------------------------------------------- */}
            {selectedTeacher.isPassager && (() => {
              const myTimings = sessions.filter((s) => s.teacherId === selectedTeacher.id);
              const myTimingIds = new Set(myTimings.map((s) => s.id));
              const myDues = unpaidTeacher.filter((u) => u.teacherId === selectedTeacher.id);
              const myPassagerAttendees = independent.filter(
                (ind) => ind.sessionId && myTimingIds.has(ind.sessionId) && !ind.studentId,
              );
              const myPayments = teacherPayments
                .filter((p) => p.teacherId === selectedTeacher.id)
                .sort((a, b) => b.paidAt.localeCompare(a.paidAt));
              const distinctStudents = new Set(myDues.map((u) => u.studentId)).size;
              const unpaidList = buildUnpaidTimings(selectedTeacher.id);
              const revenueGenerated = attendance
                .filter((a) => myTimingIds.has(a.sessionId))
                .reduce((s, a) => s + a.amountDeducted, 0)
                + myPassagerAttendees.reduce((s, i) => s + i.price, 0);

              // One line per (date, timing) actually held, paid or not.
              const heldTimings = new Map<string, { dateKey: string; sessionId: string; presents: number; passagers: number; revenue: number; paid: boolean }>();
              attendance.forEach((a) => {
                if (!myTimingIds.has(a.sessionId)) return;
                const dateKey = new Date(a.timestamp).toLocaleDateString("fr-CA");
                const key = `${dateKey}|${a.sessionId}`;
                const row = heldTimings.get(key) ?? { dateKey, sessionId: a.sessionId, presents: 0, passagers: 0, revenue: 0, paid: true };
                row.presents += 1;
                row.revenue += a.amountDeducted;
                heldTimings.set(key, row);
              });
              myPassagerAttendees.forEach((ind) => {
                const key = `${ind.date}|${ind.sessionId}`;
                const row = heldTimings.get(key) ?? { dateKey: ind.date, sessionId: ind.sessionId!, presents: 0, passagers: 0, revenue: 0, paid: true };
                row.presents += 1;
                row.passagers += 1;
                row.revenue += ind.price;
                heldTimings.set(key, row);
              });
              myDues.forEach((u) => {
                const dateKey = new Date(u.date).toLocaleDateString("fr-CA");
                const row = heldTimings.get(`${dateKey}|${u.sessionId}`);
                if (row && !u.paid) row.paid = false;
              });
              myPassagerAttendees.forEach((ind) => {
                const row = heldTimings.get(`${ind.date}|${ind.sessionId}`);
                if (row && !ind.teacherPaid) row.paid = false;
              });
              const heldList = [...heldTimings.values()].sort((a, b) => b.dateKey.localeCompare(a.dateKey));

              return (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="bg-canvas border border-line p-3 rounded-xl text-center">
                      <span className="text-muted text-[10px] uppercase block font-semibold">Créneaux animés</span>
                      <strong className="text-ink text-base font-mono">{myTimings.length}</strong>
                    </div>
                    <div className="bg-canvas border border-line p-3 rounded-xl text-center">
                      <span className="text-muted text-[10px] uppercase block font-semibold">Élèves suivis</span>
                      <strong className="text-primary text-base font-mono">{distinctStudents}</strong>
                      <span className="text-[9px] text-muted block">+ {myPassagerAttendees.length} passager(s)</span>
                    </div>
                    <div className="bg-canvas border border-line p-3 rounded-xl text-center">
                      <span className="text-muted text-[10px] uppercase block font-semibold">Recette générée</span>
                      <strong className="text-success text-base font-mono">{revenueGenerated} DA</strong>
                    </div>
                    <div className="bg-canvas border border-line p-3 rounded-xl text-center">
                      <span className="text-muted text-[10px] uppercase block font-semibold">Total versé</span>
                      <strong className="text-success text-base font-mono">
                        {myPayments.reduce((s, p) => s + p.amount, 0)} DA
                      </strong>
                      <span className="text-[9px] text-warning block">{unpaidList.length} créneau(x) dus</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {/* Séance libre history */}
                    <div className="border border-line rounded-2xl p-4 bg-surface">
                      <h4 className="font-bold text-ink mb-3 text-xs uppercase tracking-wider text-muted">
                        🎯 Historique des séances libres
                      </h4>
                      {heldList.length === 0 ? (
                        <p className="text-xs text-muted italic text-center py-6">Aucune séance tenue pour le moment.</p>
                      ) : (
                        <div className="max-h-60 overflow-y-auto">
                          <table className="w-full text-xs text-left">
                            <thead>
                              <tr className="text-[10px] uppercase text-muted font-bold border-b border-line">
                                <th className="py-1.5">Date</th>
                                <th className="py-1.5">Créneau</th>
                                <th className="py-1.5 text-center">Présents</th>
                                <th className="py-1.5 text-right">Recette</th>
                                <th className="py-1.5 text-right">Statut</th>
                              </tr>
                            </thead>
                            <tbody>
                              {heldList.map((r) => {
                                const sess = sessions.find((s) => s.id === r.sessionId);
                                return (
                                  <tr key={`${r.dateKey}-${r.sessionId}`} className="border-b border-line/50 last:border-0">
                                    <td className="py-1.5 font-mono text-[10px]">{formatDateFr(r.dateKey)}</td>
                                    <td className="py-1.5">
                                      <span className="text-ink block truncate max-w-[160px]">
                                        {sess?.title || modules.find((m) => m.id === sess?.moduleId)?.name || "Séance"}
                                      </span>
                                      <span className="text-[9px] text-muted font-mono">
                                        {sess?.startTime} - {sess?.endTime}
                                      </span>
                                    </td>
                                    <td className="py-1.5 text-center">
                                      <strong>{r.presents}</strong>
                                      {r.passagers > 0 && (
                                        <span className="text-[9px] text-warning block">{r.passagers} pass.</span>
                                      )}
                                    </td>
                                    <td className="py-1.5 text-right font-mono">{r.revenue} DA</td>
                                    <td className="py-1.5 text-right">
                                      <Badge tone={r.paid ? "success" : "warning"} className="text-[9px]">
                                        {r.paid ? "Payé" : "Dû"}
                                      </Badge>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    {/* Payments history */}
                    <div className="border border-line rounded-2xl p-4 bg-surface">
                      <h4 className="font-bold text-ink mb-3 text-xs uppercase tracking-wider text-muted">
                        💸 Historique des règlements
                      </h4>
                      {myPayments.length === 0 ? (
                        <p className="text-xs text-muted italic text-center py-6">Aucun règlement enregistré.</p>
                      ) : (
                        <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                          {myPayments.map((p) => (
                            <div
                              key={p.id}
                              className="flex items-center justify-between gap-3 p-3 rounded-xl border border-success/20 bg-success/5 text-xs"
                            >
                              <div className="min-w-0">
                                <span className="font-bold text-ink block">
                                  {p.amount} DA
                                  <Badge tone={p.method === "percent" ? "primary" : "neutral"} className="ml-1.5 text-[9px]">
                                    {p.method === "percent" ? `${p.percentage ?? 0}%` : "Montant fixe"}
                                  </Badge>
                                </span>
                                <span className="text-[10px] text-muted block">
                                  {p.sessionsCount} créneau(x) ·{" "}
                                  {new Date(p.paidAt).toLocaleString("fr-DZ", {
                                    day: "2-digit", month: "2-digit", year: "numeric",
                                    hour: "2-digit", minute: "2-digit",
                                  })}
                                </span>
                              </div>
                              <button
                                onClick={() => reprintSettlement(p.id)}
                                className="p-1.5 rounded-lg hover:bg-primary-50 text-primary shrink-0"
                                title="Réimprimer le bon"
                              >
                                <Printer className="h-4 w-4" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Timings he is attached to */}
                  <div className="border border-line rounded-2xl p-4 bg-surface">
                    <h4 className="font-bold text-ink mb-3 text-xs uppercase tracking-wider text-muted">
                      📅 Créneaux affectés
                    </h4>
                    {myTimings.length === 0 ? (
                      <p className="text-xs text-muted italic text-center py-6">Aucun créneau affecté.</p>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {myTimings.map((s) => (
                          <div key={s.id} className="text-xs bg-canvas/30 p-3 rounded-xl border border-line space-y-1">
                            <strong className="text-ink block">
                              {s.title || modules.find((m) => m.id === s.moduleId)?.name}
                            </strong>
                            <span className="text-[10px] text-muted block">
                              {classes.find((c) => c.id === s.classId)?.name} · Gr:{" "}
                              {groups.find((g) => g.id === s.groupId)?.name}
                            </span>
                            <div className="flex items-center gap-1.5 text-[10px] text-primary font-mono">
                              <Clock className="h-3 w-3" /> {s.startTime} - {s.endTime}
                              {s.periodStart && (
                                <span className="text-muted">
                                  · {formatDateFr(s.periodStart)} → {formatDateFr(s.periodEnd)}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex justify-between items-center pt-3 border-t border-line">
                    <Button
                      onClick={() => { setIsDetailsOpen(false); openTimingPay(selectedTeacher); }}
                      className="flex items-center gap-2"
                    >
                      <DollarSign className="h-4 w-4" /> Payer ses séances ({unpaidList.length})
                    </Button>
                    <Button variant="outline" onClick={() => setIsDetailsOpen(false)}>Fermer</Button>
                  </div>
                </div>
              );
            })()}

            {/* Modal Tabs navigation — school teachers only; a passager has his
                own single-page file above. */}
            <div className={`flex border-b border-line gap-1.5 pb-0.5 ${selectedTeacher.isPassager ? "hidden" : ""}`}>
              <button
                onClick={() => setDetailsTab("info")}
                className={`px-4 py-2 text-xs font-bold rounded-t-xl transition-colors border-b-2 -mb-0.5 ${
                  detailsTab === "info"
                    ? "border-primary text-primary"
                    : "border-transparent text-muted hover:text-ink hover:bg-canvas/50"
                }`}
              >
                📅 Emploi du Temps
              </button>
              <button
                onClick={() => setDetailsTab("finance")}
                className={`px-4 py-2 text-xs font-bold rounded-t-xl transition-colors border-b-2 -mb-0.5 ${
                  detailsTab === "finance"
                    ? "border-primary text-primary"
                    : "border-transparent text-muted hover:text-ink hover:bg-canvas/50"
                }`}
              >
                💸 Historique Financier
              </button>
              <button
                onClick={() => setDetailsTab("sessions")}
                className={`px-4 py-2 text-xs font-bold rounded-t-xl transition-colors border-b-2 -mb-0.5 ${
                  detailsTab === "sessions"
                    ? "border-primary text-primary"
                    : "border-transparent text-muted hover:text-ink hover:bg-canvas/50"
                }`}
              >
                📊 Historique des Séances
              </button>
            </div>

            {/* TAB CONTENT: Info / Schedule */}
            {!selectedTeacher.isPassager && detailsTab === "info" && (
              <div className="space-y-4">
                <div className="border border-line rounded-2xl p-4 bg-surface">
                  <h4 className="font-bold text-ink mb-3 flex items-center gap-2 text-xs uppercase tracking-wider text-muted">
                    📅 Séances de cours programmées
                  </h4>
                  {sessions.filter((s) => s.teacherId === selectedTeacher.id).length === 0 ? (
                    <p className="text-xs text-muted italic text-center py-6">Aucune séance programmée pour cet enseignant.</p>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-72 overflow-y-auto pr-1">
                      {sessions
                        .filter((s) => s.teacherId === selectedTeacher.id)
                        .map((s) => (
                          <div key={s.id} className="text-xs bg-canvas/30 p-3 rounded-xl border border-line flex flex-col justify-between gap-1">
                            <div>
                              <strong className="text-ink block text-sm">
                                {modules.find((m) => m.id === s.moduleId)?.name}
                              </strong>
                              <span className="text-muted block text-[10px] uppercase font-semibold mt-0.5">
                                Groupe: {groups.find((g) => g.id === s.groupId)?.name || "Inconnu"} | Salle: {classes.find((c) => c.id === s.classId)?.name}
                              </span>
                            </div>
                            <div className="text-primary font-bold mt-1 text-[11px] font-mono">
                              Horaires: {s.startTime} - {s.endTime}
                            </div>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB CONTENT: Finance History */}
            {!selectedTeacher.isPassager && detailsTab === "finance" && (() => {
              const teacherAcomptes = getTeacherAcomptes(selectedTeacher.id).map(ac => ({
                id: ac.id,
                type: "acompte" as const,
                title: ac.paid ? "Acompte (retenu)" : "Acompte (à retenir)",
                amount: ac.amount,
                date: ac.date,
                description: ac.description,
                color: "text-warning bg-warning/5 border-warning/20",
              }));

              const expensesOf = getTeacherExpenses(selectedTeacher.id);
              const teacherExpenseLogs = expensesOf.map((ex) => ({
                id: ex.id,
                type: "expense" as const,
                title: ex.paid ? `Dépense (retenue) — ${ex.name}` : `Dépense (à retenir) — ${ex.name}`,
                amount: ex.amount,
                date: ex.date,
                description: ex.description ?? "",
                color: "text-warning bg-warning/5 border-warning/20",
              }));

              const teacherAbsences = getTeacherAbsences(selectedTeacher.id).map(ab => ({
                id: ab.id,
                type: "absence" as const,
                title: "Retenue pour Absence",
                amount: ab.cost,
                date: ab.date,
                description: ab.description,
                color: "text-danger bg-danger/5 border-danger/20",
              }));

              const teacherPayments = cash
                .filter(c => c.type === "teacher_payment" && (c.description.toLowerCase().includes(selectedTeacher.lastName.toLowerCase()) || c.description.toLowerCase().includes(selectedTeacher.firstName.toLowerCase())))
                .map(pay => ({
                  id: pay.id,
                  type: "payment" as const,
                  title: "Règlement de Salaire",
                  amount: Math.abs(pay.amount),
                  date: pay.date.split("T")[0],
                  description: pay.description,
                  color: "text-success bg-success/5 border-success/20",
                }));

              const allFinancialLogs = [
                ...teacherAcomptes,
                ...teacherExpenseLogs,
                ...teacherAbsences,
                ...teacherPayments,
              ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

              const unpaidExpenses = expensesOf.filter((e) => !e.paid);
              const unpaidAcomptesOf = getUnpaidAcomptes(selectedTeacher.id);
              const pendingTotal =
                unpaidExpenses.reduce((t, e) => t + e.amount, 0) +
                unpaidAcomptesOf.reduce((t, a) => t + a.amount, 0);

              return (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div className="bg-canvas border border-line p-3 rounded-xl text-center">
                      <span className="text-muted text-[10px] uppercase block font-semibold">Total Acomptes</span>
                      <strong className="text-warning text-base font-mono">{teacherAcomptes.reduce((s, a) => s + a.amount, 0)} DA</strong>
                    </div>
                    <div className="bg-canvas border border-line p-3 rounded-xl text-center">
                      <span className="text-muted text-[10px] uppercase block font-semibold">Total Dépenses</span>
                      <strong className="text-warning text-base font-mono">{expensesOf.reduce((s, e) => s + e.amount, 0)} DA</strong>
                    </div>
                    <div className="bg-canvas border border-line p-3 rounded-xl text-center">
                      <span className="text-muted text-[10px] uppercase block font-semibold">Total Absences</span>
                      <strong className="text-danger text-base font-mono">{teacherAbsences.reduce((s, a) => s + a.amount, 0)} DA</strong>
                    </div>
                    <div className="bg-canvas border border-line p-3 rounded-xl text-center">
                      <span className="text-muted text-[10px] uppercase block font-semibold">Total Payé</span>
                      <strong className="text-success text-base font-mono">{teacherPayments.reduce((s, a) => s + a.amount, 0)} DA</strong>
                    </div>
                  </div>

                  {/* Ce qui sera retenu sur le prochain règlement — et rien d'autre :
                      tout ce qui a déjà été réglé n'y figure plus. */}
                  <div className="rounded-2xl border border-warning/30 bg-warning/5 p-4">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-warning">
                        À retenir sur le prochain règlement
                      </h4>
                      <Badge tone="danger" className="font-mono font-bold">− {pendingTotal} DA</Badge>
                    </div>
                    {unpaidExpenses.length === 0 && unpaidAcomptesOf.length === 0 ? (
                      <p className="text-[11px] italic text-muted">
                        Rien en attente : toutes les dépenses et tous les acomptes ont été retenus.
                      </p>
                    ) : (
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-left text-[10px] font-bold uppercase text-muted">
                            <th className="py-1">Date</th>
                            <th className="py-1">Nature</th>
                            <th className="py-1">Libellé</th>
                            <th className="py-1 text-right">Montant</th>
                          </tr>
                        </thead>
                        <tbody>
                          {unpaidExpenses.map((e) => (
                            <tr key={e.id} className="border-t border-line/50">
                              <td className="py-1.5 font-mono text-[10px]">{formatDateFr(e.date)}</td>
                              <td className="py-1.5">
                                <Badge tone="warning" className="text-[9px]">Dépense</Badge>
                              </td>
                              <td className="py-1.5">
                                <strong className="text-ink">{e.name}</strong>
                                {e.description && (
                                  <span className="block text-[10px] text-muted">{e.description}</span>
                                )}
                              </td>
                              <td className="py-1.5 text-right font-mono font-bold text-danger">
                                {e.amount} DA
                              </td>
                            </tr>
                          ))}
                          {unpaidAcomptesOf.map((a) => (
                            <tr key={a.id} className="border-t border-line/50">
                              <td className="py-1.5 font-mono text-[10px]">
                                {formatDateFr(a.date.slice(0, 10))}
                              </td>
                              <td className="py-1.5">
                                <Badge tone="primary" className="text-[9px]">Acompte</Badge>
                              </td>
                              <td className="py-1.5">
                                <strong className="text-ink">Acompte</strong>
                                {a.description && (
                                  <span className="block text-[10px] text-muted">{a.description}</span>
                                )}
                              </td>
                              <td className="py-1.5 text-right font-mono font-bold text-danger">
                                {a.amount} DA
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>

                  <div className="border border-line rounded-2xl p-4 bg-surface">
                    <h4 className="font-bold text-ink mb-3 text-xs uppercase tracking-wider text-muted">
                      🕒 Journal des transactions financières
                    </h4>
                    {allFinancialLogs.length === 0 ? (
                      <p className="text-xs text-muted italic text-center py-6">Aucun acompte, absence ou paiement enregistré.</p>
                    ) : (
                      <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                        {allFinancialLogs.map((log, index) => (
                          <div
                            key={`${log.id}-${index}`}
                            className={`flex items-center justify-between p-3 rounded-xl border text-xs gap-3 ${log.color}`}
                          >
                            <div className="min-w-0">
                              <span className="font-bold block text-ink">{log.title}</span>
                              <span className="text-[10px] text-muted block truncate mt-0.5">{log.description}</span>
                            </div>
                            <div className="text-right shrink-0">
                              <span className="font-mono font-bold block text-sm">
                                {log.type === "absence" ? "-" : ""}{log.amount} DA
                              </span>
                              <span className="text-[9px] text-muted block font-mono">{log.date}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* TAB CONTENT: Sessions History */}
            {!selectedTeacher.isPassager && detailsTab === "sessions" && (() => {
              const allTeacherSessions = unpaidTeacher.filter((u) => u.teacherId === selectedTeacher.id);
              const unpaidSessions = allTeacherSessions.filter((u) => !u.paid);
              const paidSessions = allTeacherSessions.filter((u) => u.paid);

              const filteredSessionsList = allTeacherSessions.filter((u) => {
                if (sessionFilter === "paid") return u.paid;
                if (sessionFilter === "unpaid") return !u.paid;
                return true;
              }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

              return (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="bg-canvas border border-line p-3 rounded-xl flex items-center justify-between">
                      <div>
                        <span className="text-muted text-[10px] uppercase block font-semibold">Total Séances</span>
                        <strong className="text-ink text-base font-mono">{allTeacherSessions.length}</strong>
                      </div>
                      <Badge tone="primary">Toutes</Badge>
                    </div>
                    <div className="bg-canvas border border-line p-3 rounded-xl flex items-center justify-between">
                      <div>
                        <span className="text-muted text-[10px] uppercase block font-semibold">Réglées / Payées</span>
                        <strong className="text-success text-base font-mono">{paidSessions.length}</strong>
                      </div>
                      <Badge tone="success">Payé</Badge>
                    </div>
                    <div className="bg-canvas border border-line p-3 rounded-xl flex items-center justify-between">
                      <div>
                        <span className="text-muted text-[10px] uppercase block font-semibold">En attente</span>
                        <strong className="text-warning text-base font-mono">{unpaidSessions.length}</strong>
                      </div>
                      <Badge tone="warning">Dues ({unpaidSessions.reduce((s, a) => s + a.amount, 0)} DA)</Badge>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant={sessionFilter === "all" ? "primary" : "outline"}
                      onClick={() => setSessionFilter("all")}
                    >
                      Toutes ({allTeacherSessions.length})
                    </Button>
                    <Button
                      size="sm"
                      variant={sessionFilter === "paid" ? "primary" : "outline"}
                      onClick={() => setSessionFilter("paid")}
                    >
                      Payées ({paidSessions.length})
                    </Button>
                    <Button
                      size="sm"
                      variant={sessionFilter === "unpaid" ? "primary" : "outline"}
                      onClick={() => setSessionFilter("unpaid")}
                    >
                      Dues ({unpaidSessions.length})
                    </Button>
                  </div>

                  <div className="border border-line rounded-2xl overflow-hidden bg-surface">
                    <div className="max-h-60 overflow-y-auto">
                      <table className="w-full text-xs text-left border-collapse">
                        <thead>
                          <tr className="bg-canvas border-b border-line text-[10px] text-muted uppercase font-bold tracking-wider">
                            <th className="p-3">Date</th>
                            <th className="p-3">Module / Groupe</th>
                            <th className="p-3">Montant Dû</th>
                            <th className="p-3 text-right">Statut</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredSessionsList.length === 0 ? (
                            <tr>
                              <td colSpan={4} className="p-6 text-center text-muted italic">Aucune séance enregistrée pour cet enseignant.</td>
                            </tr>
                          ) : (
                            filteredSessionsList.map((u) => {
                              const moduleName = modules.find((m) => m.id === sessions.find((s) => s.id === u.sessionId)?.moduleId)?.name || "Séance";
                              const groupName = groups.find((g) => g.id === sessions.find((s) => s.id === u.sessionId)?.groupId)?.name || "Groupe";

                              return (
                                <tr key={u.id} className="border-b border-line last:border-0 hover:bg-canvas/30 transition-colors">
                                  <td className="p-3 font-mono text-[10px] text-ink">{u.date}</td>
                                  <td className="p-3">
                                    <span className="font-bold text-ink block">{moduleName}</span>
                                    <span className="text-[10px] text-muted">{groupName}</span>
                                  </td>
                                  <td className="p-3 font-bold text-primary font-mono">{u.amount} DA</td>
                                  <td className="p-3 text-right">
                                    <Badge tone={u.paid ? "success" : "warning"} className="font-bold">
                                      {u.paid ? "Payée" : "En attente"}
                                    </Badge>
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              );
            })()}

            {!selectedTeacher.isPassager && (
              <div className="flex justify-end pt-3 border-t border-line">
                <Button onClick={() => setIsDetailsOpen(false)}>Fermer</Button>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Dépense de l'enseignant — retenue sur son prochain règlement */}
      <Modal
        open={isExpenseOpen}
        onClose={() => setIsExpenseOpen(false)}
        title="Enregistrer une dépense de l'enseignant"
      >
        <div className="space-y-4">
          {selectedTeacher && (
            <div className="rounded-xl bg-primary-50/60 p-3">
              <strong className="block text-sm text-ink">
                {selectedTeacher.firstName} {selectedTeacher.lastName}
              </strong>
              <span className="text-[11px] text-muted">
                La dépense sera retenue sur son prochain règlement, une seule fois.
              </span>
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted">Nom de la dépense *</label>
            <Input
              value={expenseName}
              onChange={(e) => setExpenseName(e.target.value)}
              placeholder="Ex: Photocopies, transport, matériel…"
              autoFocus
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-muted">Montant (DA) *</label>
              <Input
                type="number"
                min={0}
                value={expenseAmount || ""}
                onChange={(e) => setExpenseAmount(Math.max(0, Number(e.target.value) || 0))}
                placeholder="Ex: 1800"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-muted">Date *</label>
              <Input
                type="date"
                value={expenseDate}
                onChange={(e) => setExpenseDate(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted">
              Description (optionnelle)
            </label>
            <Input
              value={expenseDesc}
              onChange={(e) => setExpenseDesc(e.target.value)}
              placeholder="Détail de la dépense"
            />
          </div>
          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Button variant="outline" onClick={() => setIsExpenseOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handleCreateExpense}>Enregistrer la dépense</Button>
          </div>
        </div>
      </Modal>

      {/* Acompte Modal */}
      <Modal open={isAcompteOpen} onClose={() => setIsAcompteOpen(false)} title="Enregistrer un acompte">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-muted mb-1 font-sans">Montant de l'acompte (DA) *</label>
            <Input
              type="number"
              value={amount || ""}
              onChange={(e) => setAmount(Number(e.target.value))}
              placeholder="Ex: 5000"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Description / Motif</label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Avance" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Date</label>
            <Input type="date" value={actionDate} onChange={(e) => setActionDate(e.target.value)} />
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => setIsAcompteOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handleCreateAcompte}>Confirmer</Button>
          </div>
        </div>
      </Modal>

      {/* Absence Modal */}
      <Modal open={isAbsenceOpen} onClose={() => setIsAbsenceOpen(false)} title="Signaler une absence / retenue">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-muted mb-1 font-sans">Retenue financière (Coût - DA)</label>
            <Input
              type="number"
              value={amount || ""}
              onChange={(e) => setAmount(Number(e.target.value))}
              placeholder="Ex: 1000"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Motif de l'absence</label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Absence non justifiée" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Date</label>
            <Input type="date" value={actionDate} onChange={(e) => setActionDate(e.target.value)} />
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => setIsAbsenceOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handleCreateAbsence}>Enregistrer</Button>
          </div>
        </div>
      </Modal>

      {/* ---------------------------------------------------------------- */}
      {/* Create an "enseignant passager" (no login, paid per timing)       */}
      {/* ---------------------------------------------------------------- */}
      <Modal open={isPassagerCreateOpen} onClose={() => setIsPassagerCreateOpen(false)} title="Nouvel enseignant passager">
        <div className="space-y-4">
          <div className="bg-warning/10 border border-warning/20 rounded-xl p-3 text-[11px] text-muted leading-relaxed">
            Un <strong className="text-warning">enseignant passager</strong> intervient ponctuellement sur des
            séances libres. Il n&apos;a <strong>pas de compte de connexion</strong> et n&apos;apparaît qu&apos;avec
            les actions <strong>Payer</strong> et <strong>Détails</strong>.
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-muted mb-1 font-sans">Prénom *</label>
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Prénom" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted mb-1">Nom</label>
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Nom" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-muted mb-1">Téléphone</label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+213 5XX XX XX XX" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-4 border-t border-line">
            <Button variant="outline" onClick={() => setIsPassagerCreateOpen(false)}>Annuler</Button>
            <Button onClick={handleCreatePassager}>Enregistrer</Button>
          </div>
        </div>
      </Modal>

      {/* ---------------------------------------------------------------- */}
      {/* Per-timing settlement: only UNPAID timings, fixed or percentage   */}
      {/* ---------------------------------------------------------------- */}
      <Modal
        open={isTimingPayOpen}
        onClose={() => setIsTimingPayOpen(false)}
        title="Règlement des séances de l'enseignant"
        wide
      >
        {selectedTeacher && (
          <div className="space-y-4">
            <div className="bg-canvas border border-line rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <strong className="text-ink text-sm block">
                  {selectedTeacher.firstName} {selectedTeacher.lastName}
                </strong>
                <span className="text-[11px] text-muted">
                  {selectedTeacher.isPassager ? "Enseignant passager (sans compte)" : "Enseignant de l'école"}
                  {selectedTeacher.phone ? ` · ${selectedTeacher.phone}` : ""}
                </span>
              </div>
              <div className="flex gap-2">
                <Badge tone="warning" className="font-bold">{payTimings.length} créneau(x) non payé(s)</Badge>
                <Badge tone="primary" className="font-bold">{chosenPresents} présence(s) sélectionnée(s)</Badge>
              </div>
            </div>

            {payTimings.length === 0 ? (
              <p className="text-xs text-success font-bold text-center py-10 border border-dashed border-line rounded-2xl">
                Tous les créneaux de cet enseignant ont déjà été réglés.
              </p>
            ) : (
              <>
                {/* Summary of what is being paid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="bg-canvas border border-line p-3 rounded-xl text-center">
                    <span className="text-muted text-[10px] uppercase block font-semibold">Créneaux</span>
                    <strong className="text-ink text-base font-mono">{chosenTimings.length}</strong>
                  </div>
                  <div className="bg-canvas border border-line p-3 rounded-xl text-center">
                    <span className="text-muted text-[10px] uppercase block font-semibold">Élèves présents</span>
                    <strong className="text-ink text-base font-mono">{chosenPresents}</strong>
                  </div>
                  <div className="bg-canvas border border-line p-3 rounded-xl text-center">
                    <span className="text-muted text-[10px] uppercase block font-semibold">Dont passagers</span>
                    <strong className="text-warning text-base font-mono">{chosenPassagers}</strong>
                  </div>
                  <div className="bg-canvas border border-line p-3 rounded-xl text-center">
                    <span className="text-muted text-[10px] uppercase block font-semibold">Montant généré</span>
                    <strong className="text-success text-base font-mono">{chosenRevenue} DA</strong>
                  </div>
                </div>

                {/* Payment method */}
                <div className="rounded-2xl border border-primary/25 bg-primary-50/40 p-4 space-y-3">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-primary">
                    Mode de rémunération
                  </span>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setPayMethod("fixed")}
                      className={`p-3 rounded-xl border text-left transition-all ${
                        payMethod === "fixed" ? "border-primary bg-primary/10 ring-2 ring-primary/25" : "border-line bg-surface"
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <DollarSign className={`h-4 w-4 ${payMethod === "fixed" ? "text-primary" : "text-muted"}`} />
                        <span className="font-bold text-xs text-ink">Montant fixe</span>
                      </div>
                      <span className="text-[10px] text-muted block leading-normal">
                        Vous saisissez directement la somme à verser.
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setPayMethod("percent")}
                      className={`p-3 rounded-xl border text-left transition-all ${
                        payMethod === "percent" ? "border-primary bg-primary/10 ring-2 ring-primary/25" : "border-line bg-surface"
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <Percent className={`h-4 w-4 ${payMethod === "percent" ? "text-primary" : "text-muted"}`} />
                        <span className="font-bold text-xs text-ink">Pourcentage</span>
                      </div>
                      <span className="text-[10px] text-muted block leading-normal">
                        % appliqué au tarif de chaque élève présent — calcul automatique.
                      </span>
                    </button>
                  </div>

                  {payMethod === "fixed" ? (
                    <div>
                      <label className="block text-[10px] font-semibold text-muted mb-1">Montant à verser (DA) *</label>
                      <Input
                        type="number"
                        min={0}
                        value={payFixedAmount || ""}
                        onChange={(e) => setPayFixedAmount(Number(e.target.value))}
                        placeholder="Ex: 4000"
                        className="w-48"
                      />
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-end gap-4">
                      <div>
                        <label className="block text-[10px] font-semibold text-muted mb-1">
                          Pourcentage par élève / par module (%)
                        </label>
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          value={payPercentage || ""}
                          onChange={(e) => setPayPercentage(Number(e.target.value))}
                          className="w-32"
                        />
                      </div>
                      <div className="pb-1.5 text-xs">
                        <span className="block text-[10px] font-semibold text-muted mb-1">Calcul automatique</span>
                        <strong className="text-primary">
                          {chosenRevenue} DA × {payPercentage}% = {computedPayout} DA
                        </strong>
                      </div>
                    </div>
                  )}
                </div>

                {/* Timings list, each expandable to the students present */}
                <div className="space-y-2 max-h-[38vh] overflow-y-auto pr-1">
                  {payTimings.map((t) => {
                    const checked = selectedTimingKeys.includes(t.key);
                    const expanded = expandedTimingKey === t.key;
                    const groupsInTiming = [...new Set(t.students.map((s) => s.groupName))];
                    const visibleStudents =
                      timingGroupFilter === "all"
                        ? t.students
                        : t.students.filter((s) => s.groupName === timingGroupFilter);
                    return (
                      <div key={t.key} className="border border-line rounded-2xl bg-canvas/20 overflow-hidden">
                        <div className="flex flex-wrap items-center justify-between gap-2 p-3">
                          <label className="flex items-start gap-2.5 min-w-0 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() =>
                                setSelectedTimingKeys(
                                  checked
                                    ? selectedTimingKeys.filter((k) => k !== t.key)
                                    : [...selectedTimingKeys, t.key],
                                )
                              }
                              className="h-4 w-4 mt-0.5 shrink-0"
                            />
                            <span className="min-w-0">
                              <strong className="text-ink block text-xs">
                                📅 {formatDateFr(t.dateKey)} — {t.title}
                                {t.isOpen && <Badge tone="success" className="ml-1.5 text-[9px]">Séance libre</Badge>}
                              </strong>
                              <span className="text-[10px] text-muted block">
                                {t.className} · Gr: {t.groupName} ·{" "}
                                <span className="font-mono">{t.startTime} - {t.endTime}</span>
                              </span>
                            </span>
                          </label>
                          <div className="flex items-center gap-2 shrink-0">
                            <Badge tone="primary" className="font-mono font-bold text-[10px]">
                              <Users className="h-3 w-3 inline mr-1" />
                              {t.students.length}
                              {t.passagers > 0 && ` (${t.passagers} pass.)`}
                            </Badge>
                            <Badge tone="success" className="font-mono font-bold text-[10px]">{t.totalFees} DA</Badge>
                            {checked && (
                              <Badge tone="warning" className="font-mono font-bold text-[10px]">
                                → {shareForTiming(t)} DA
                              </Badge>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setExpandedTimingKey(expanded ? null : t.key)}
                            >
                              {expanded ? "Masquer" : "Détails élèves"}
                            </Button>
                          </div>
                        </div>

                        {expanded && (
                          <div className="border-t border-line bg-surface p-3 space-y-2">
                            {/* Filter the presence list by group */}
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-[10px] uppercase font-bold text-muted mr-1">Filtrer :</span>
                              {["all", ...groupsInTiming].map((g) => (
                                <button
                                  key={g}
                                  onClick={() => setTimingGroupFilter(g)}
                                  className={`px-2 py-1 rounded-lg text-[10px] font-bold transition-all ${
                                    timingGroupFilter === g ? "bg-primary text-white" : "bg-canvas text-muted hover:text-ink"
                                  }`}
                                >
                                  {g === "all" ? `Tous (${t.students.length})` : `${g} (${t.students.filter((s) => s.groupName === g).length})`}
                                </button>
                              ))}
                            </div>
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-[10px] uppercase text-muted font-bold text-left">
                                  <th className="py-1">Élève</th>
                                  <th className="py-1">Groupe</th>
                                  <th className="py-1">Heure</th>
                                  <th className="py-1">Statut</th>
                                  <th className="py-1 text-right">Tarif élève</th>
                                  <th className="py-1 text-right">
                                    Part prof {payMethod === "percent" ? `(${payPercentage}%)` : ""}
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {visibleStudents.map((st, i) => (
                                  <tr key={i} className={`border-t border-line/50 ${st.withheld ? "bg-danger/5" : ""}`}>
                                    <td className="py-1.5 font-semibold text-ink">
                                      {st.name}
                                      {st.isPassager && (
                                        <Badge tone="warning" className="ml-1.5 text-[8px]">Passager</Badge>
                                      )}
                                      {st.withheld && (
                                        <Badge tone="danger" className="ml-1.5 text-[8px]">En dette — non réglé</Badge>
                                      )}
                                    </td>
                                    <td className="py-1.5 text-muted">{st.groupName}</td>
                                    <td className="py-1.5 font-mono">{st.time}</td>
                                    <td className="py-1.5">
                                      <Badge tone={st.status === "En Retard" ? "warning" : "success"} className="text-[9px]">
                                        {st.status}
                                      </Badge>
                                    </td>
                                    <td className="py-1.5 text-right font-mono">{st.fee} DA</td>
                                    <td className="py-1.5 text-right font-mono font-bold text-primary">
                                      {st.withheld
                                        ? "— (dette)"
                                        : payMethod === "percent"
                                          ? `${Math.round((st.fee * payPercentage) / 100)} DA`
                                          : "—"}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Retenues — dépenses, acomptes et scolarité de ses enfants.
                    Seules celles jamais réglées apparaissent ici : une fois le
                    paiement enregistré, elles ne reviennent plus. */}
                <div className="rounded-2xl border border-warning/30 bg-warning/5 p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-warning">
                      Retenues sur ce règlement
                    </span>
                    <Badge tone="danger" className="font-mono font-bold">
                      − {deductionsTotal} DA
                    </Badge>
                  </div>

                  {payExpenses.length === 0 && payAcomptes.length === 0 && payChildren.length === 0 ? (
                    <p className="text-[11px] italic text-muted">
                      Aucune dépense, aucun acompte et aucun enfant à charge en attente.
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                      {/* Dépenses */}
                      <div className="rounded-xl border border-line bg-surface p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <span className="text-[10px] font-bold uppercase text-muted">
                            Dépenses ({payExpenses.length})
                          </span>
                          <strong className="text-xs text-danger">− {expensesTotal} DA</strong>
                        </div>
                        {payExpenses.length === 0 ? (
                          <p className="text-[10px] italic text-muted">Aucune dépense en attente.</p>
                        ) : (
                          <div className="max-h-40 space-y-1.5 overflow-y-auto">
                            {payExpenses.map((e) => {
                              const on = payExpenseIds.includes(e.id);
                              return (
                                <label
                                  key={e.id}
                                  className="flex cursor-pointer items-start gap-2 rounded-lg border border-line/60 p-2 text-[11px] hover:bg-primary-50/40"
                                >
                                  <input
                                    type="checkbox"
                                    checked={on}
                                    onChange={() =>
                                      setPayExpenseIds(
                                        on
                                          ? payExpenseIds.filter((id) => id !== e.id)
                                          : [...payExpenseIds, e.id],
                                      )
                                    }
                                    className="mt-0.5 h-3.5 w-3.5 shrink-0"
                                  />
                                  <span className="min-w-0 flex-1">
                                    <strong className="block text-ink">{e.name}</strong>
                                    <span className="block text-[10px] text-muted">
                                      {formatDateFr(e.date)}
                                      {e.description ? ` · ${e.description}` : ""}
                                    </span>
                                  </span>
                                  <strong className="shrink-0 font-mono text-danger">{e.amount} DA</strong>
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {/* Acomptes */}
                      <div className="rounded-xl border border-line bg-surface p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <span className="text-[10px] font-bold uppercase text-muted">
                            Acomptes ({payAcomptes.length})
                          </span>
                          <strong className="text-xs text-danger">− {acomptesTotal} DA</strong>
                        </div>
                        {payAcomptes.length === 0 ? (
                          <p className="text-[10px] italic text-muted">Aucun acompte en attente.</p>
                        ) : (
                          <div className="max-h-40 space-y-1.5 overflow-y-auto">
                            {payAcomptes.map((a) => {
                              const on = payAcompteIds.includes(a.id);
                              return (
                                <label
                                  key={a.id}
                                  className="flex cursor-pointer items-start gap-2 rounded-lg border border-line/60 p-2 text-[11px] hover:bg-primary-50/40"
                                >
                                  <input
                                    type="checkbox"
                                    checked={on}
                                    onChange={() =>
                                      setPayAcompteIds(
                                        on
                                          ? payAcompteIds.filter((id) => id !== a.id)
                                          : [...payAcompteIds, a.id],
                                      )
                                    }
                                    className="mt-0.5 h-3.5 w-3.5 shrink-0"
                                  />
                                  <span className="min-w-0 flex-1">
                                    <strong className="block text-ink">Acompte</strong>
                                    <span className="block text-[10px] text-muted">
                                      {formatDateFr(a.date.slice(0, 10))}
                                      {a.description ? ` · ${a.description}` : ""}
                                    </span>
                                  </span>
                                  <strong className="shrink-0 font-mono text-danger">{a.amount} DA</strong>
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {/* Enfants scolarisés sur son salaire */}
                      <div className="rounded-xl border border-line bg-surface p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <span className="text-[10px] font-bold uppercase text-muted">
                            Scolarité enfants ({payChildren.length})
                          </span>
                          <strong className="text-xs text-danger">− {childrenTotal} DA</strong>
                        </div>
                        {payChildren.length === 0 ? (
                          <p className="text-[10px] italic text-muted">
                            Aucun enfant à charge en dette.
                          </p>
                        ) : (
                          <div className="max-h-40 space-y-1.5 overflow-y-auto">
                            {payChildren.map((c) => {
                              const on = payChildIds.includes(c.studentId);
                              return (
                                <label
                                  key={c.studentId}
                                  className="flex cursor-pointer items-start gap-2 rounded-lg border border-line/60 p-2 text-[11px] hover:bg-primary-50/40"
                                >
                                  <input
                                    type="checkbox"
                                    checked={on}
                                    onChange={() =>
                                      setPayChildIds(
                                        on
                                          ? payChildIds.filter((id) => id !== c.studentId)
                                          : [...payChildIds, c.studentId],
                                      )
                                    }
                                    className="mt-0.5 h-3.5 w-3.5 shrink-0"
                                  />
                                  <span className="min-w-0 flex-1">
                                    <strong className="block text-ink">{c.studentName}</strong>
                                    <span className="block font-mono text-[9px] text-muted">
                                      N° {c.registrationNumber}
                                    </span>
                                    {c.lines.map((l) => (
                                      <span
                                        key={`${l.subscriptionId}-${l.monthCode}`}
                                        className="block text-[10px] text-muted"
                                      >
                                        {l.label} · {l.monthCode} · {l.amount} DA
                                      </span>
                                    ))}
                                  </span>
                                  <strong className="shrink-0 font-mono text-danger">{c.amount} DA</strong>
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div className="rounded-2xl border-2 border-success/40 bg-success/5 p-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-muted block">Net à verser</span>
                    <strong
                      className={`text-xl font-black ${netPayout < 0 ? "text-danger" : "text-success"}`}
                    >
                      {netPayout} DA
                    </strong>
                    <span className="mt-0.5 block text-[10px] text-muted">
                      Brut {computedPayout} DA
                      {deductionsTotal > 0 && (
                        <>
                          {" "}
                          − retenues {deductionsTotal} DA
                          <span className="text-[9px]">
                            {" "}
                            (dépenses {expensesTotal} · acomptes {acomptesTotal} · enfants{" "}
                            {childrenTotal})
                          </span>
                        </>
                      )}
                    </span>
                    <span className="text-[10px] text-muted block mt-0.5">
                      {chosenTimings.length} créneau(x) · {chosenPresents} présence(s)
                      {chosenPassagers > 0 && ` · ${chosenPassagers} passager(s)`}
                    </span>
                    {chosenWithheldCount > 0 && (
                      <span className="mt-1 block rounded-lg bg-danger/10 px-2 py-1 text-[10px] font-semibold text-danger">
                        ⏳ {chosenWithheldCount} présence(s) en attente (élève en dette) — {chosenWithheldShare} DA
                        non réglés. Ils réapparaîtront au prochain paiement une fois la dette payée.
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setIsTimingPayOpen(false)}>Annuler</Button>
                    <Button
                      onClick={handleTimingPayment}
                      disabled={savingPayment || computedPayout <= 0 || selectedTimingKeys.length === 0}
                    >
                      {savingPayment ? "Enregistrement..." : `Payer ${netPayout} DA`}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </Modal>

      {/* Print Salary Modal */}
      <Modal open={isPrintOpen} onClose={() => setIsPrintOpen(false)} title="Sélectionner la période d'impression">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-muted mb-1">Date de début</label>
              <Input type="date" value={printStart} onChange={(e) => setPrintStart(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted mb-1 font-sans">Date de fin</label>
              <Input type="date" value={printEnd} onChange={(e) => setPrintEnd(e.target.value)} />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => setIsPrintOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handlePrintTeacherReport}>Générer & Imprimer</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
