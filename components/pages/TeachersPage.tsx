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
  CalendarClock,
  DollarSign,
  Printer,
  Receipt,
  Search,
  Clock,
  X,
} from "lucide-react";
import type { Teacher, TeacherPaymentType } from "@/lib/types";
import { printHtmlDocument } from "@/lib/print";
import { formatDA } from "@/lib/utils";
import { buildTeacherPaymentReport } from "@/lib/reports/teacherPayment";
import { buildTeacherSettlementReceipt } from "@/lib/reports/teacherSettlement";
import { buildTeacherPayslip, type PayslipEmploi } from "@/lib/reports/teacherPayslip";
import { TeacherPayModal } from "@/components/teachers/TeacherPayModal";
import { TeacherMonthsModal } from "@/components/teachers/TeacherMonthsModal";
import { teacherEmplois, unpaidStudents } from "@/lib/teacherMonths";
import {
  cycleSizeOf,
  groupSeanceTotals,
  teacherGroupSeances,
  monthlyPriceOf,
  schoolMonthShareOf,
  teacherMonthShareOf,
  teacherPerSeanceOf,
  formatDateFr,
  formatDays,
  salleName,
  todayIso,
} from "@/lib/helpers";
import { useSettings } from "@/lib/store/settings";

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
    attendance,
    independent,
    teacherPayments,
    school,
    push,
    deleteFrom,
    updateItem,
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
  const [paymentType, setPaymentType] = useState<TeacherPaymentType>("percentage");
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

  // ---- Règlement (écran « mois par mois ») et lecture des mois -------------
  const [isTimingPayOpen, setIsTimingPayOpen] = useState(false);
  const [isMonthsOpen, setIsMonthsOpen] = useState(false);
  // Passager teacher created straight from this page
  const [isPassagerCreateOpen, setIsPassagerCreateOpen] = useState(false);

  /**
   * Ce que la fiche de chaque enseignant affiche : ses mois d'emploi du temps,
   * ce qui lui est réellement payable et ce qui reste retenu parce qu'un élève
   * n'a pas payé. Mémoïsé une fois pour toute la grille — chaque carte lisait
   * l'historique complet à chaque rendu.
   */
  const payroll = useMemo(() => {
    const map = new Map<
      string,
      { payable: number; withheld: number; closed: number; running: number; debtors: number }
    >();
    for (const t of teachers) {
      const emplois = teacherEmplois(db, t.id);
      map.set(t.id, {
        payable: emplois.reduce((s, e) => s + e.payable, 0),
        withheld: emplois.reduce((s, e) => s + e.withheld, 0),
        closed: emplois.reduce(
          (s, e) => s + e.months.filter((m) => m.state === "done" && m.payable > 0).length,
          0,
        ),
        running: emplois.length,
        debtors: unpaidStudents(emplois).length,
      });
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teachers, sessions, subscriptions, students, attendance, unpaidTeacher, payments, db.enrollments, independent]);

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

  const getTeacherAbsences = (tid: string) => {
    return absences.filter((a) => a.teacherId === tid);
  };

  // ---------------------------------------------------------------------------
  // Rémunération "par groupe"
  //
  // Le tarif de l'enseignant n'est PAS sur sa fiche : il est fixé emploi du
  // temps par emploi du temps, sur l'abonnement (prix du mois -> part de
  // l'école -> le reste pour l'enseignant, divisé par le nombre de séances).
  // Cette liste est ce que sa fiche affiche : un groupe non tarifé se voit
  // tout de suite, avant qu'une séance ne lui rapporte 0 DA.
  // ---------------------------------------------------------------------------
  interface GroupRate {
    sessionId: string;
    title: string;
    className: string;
    groupName: string;
    monthPrice: number;
    schoolShare: number;
    teacherShare: number;
    perSeance: number;
    /** l'abonnement porte bien un partage école / enseignant */
    configured: boolean;
  }

  const groupRatesOf = (tid: string): GroupRate[] =>
    sessions
      .filter((sess) => sess.teacherId === tid)
      .map((sess) => {
        const sub = subscriptions.find((x) => x.sessionId === sess.id);
        const moduleName = modules.find((m) => m.id === sess.moduleId)?.name ?? "Séance";
        return {
          sessionId: sess.id,
          title: sess.isOpen ? sess.title || `Séance libre — ${moduleName}` : moduleName,
          className: classes.find((c) => c.id === sess.classId)?.name ?? "-",
          groupName: sess.isOpen
            ? (sess.groupIds?.length ? sess.groupIds : [sess.groupId])
                .map((id) => groups.find((g) => g.id === id)?.name ?? "-")
                .join(" · ")
            : groups.find((g) => g.id === sess.groupId)?.name ?? "-",
          monthPrice: monthlyPriceOf(sub),
          schoolShare: schoolMonthShareOf(sub),
          teacherShare: teacherMonthShareOf(sub),
          perSeance: teacherPerSeanceOf(sub),
          configured: teacherPerSeanceOf(sub) > 0,
        };
      })
      .sort((a, b) => a.title.localeCompare(b.title));

  /** The panel both the création and the modification modals show under the
   *  "Par groupe" formula. Before the teacher exists there is nothing to list,
   *  so it explains where the tarif is typed instead. */
  const renderGroupRates = (tid?: string) => {
    const rows = tid ? groupRatesOf(tid) : [];
    const missing = rows.filter((r) => !r.configured).length;
    return (
      <div className="md:col-span-2 rounded-2xl border border-primary/25 bg-primary-50/40 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-primary">
            Tarif par groupe — fixé sur l&apos;emploi du temps
          </span>
          {rows.length > 0 && (
            <Badge tone={missing > 0 ? "warning" : "success"} className="text-[9px] font-bold">
              {missing > 0 ? `${missing} groupe(s) sans tarif` : `${rows.length} groupe(s) tarifé(s)`}
            </Badge>
          )}
        </div>
        <p className="text-[11px] leading-relaxed text-muted">
          Avec cette formule l&apos;enseignant n&apos;a pas de taux sur sa fiche : chaque emploi du
          temps le rémunère au tarif défini dans son <strong className="text-ink">abonnement</strong>{" "}
          (prix du mois → part de l&apos;école → le reste revient à l&apos;enseignant, divisé par le
          nombre de séances). Une séance lui rapporte exactement ce tarif, quel que soit le nombre
          d&apos;élèves présents.
        </p>

        {!tid ? (
          <p className="text-[11px] leading-relaxed text-muted bg-surface border border-line rounded-xl p-3">
            Créez d&apos;abord l&apos;enseignant, affectez-le à ses emplois du temps, puis réglez la
            part école / enseignant depuis <strong className="text-ink">Emploi du temps</strong> ou{" "}
            <strong className="text-ink">Abonnements</strong>. Ses tarifs apparaîtront ici.
          </p>
        ) : rows.length === 0 ? (
          <p className="text-[11px] leading-relaxed text-muted bg-surface border border-line rounded-xl p-3">
            Cet enseignant n&apos;est encore affecté à aucun emploi du temps.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] uppercase text-muted font-bold text-left">
                  <th className="py-2 px-2">Emploi du temps</th>
                  <th className="py-2 px-2">Groupe</th>
                  <th className="py-2 px-2 text-right">Prix du mois</th>
                  <th className="py-2 px-2 text-right">Part école</th>
                  <th className="py-2 px-2 text-right">Part enseignant</th>
                  <th className="py-2 px-2 text-right">Par séance</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.sessionId} className="border-t border-line/60">
                    <td className="py-1.5 px-2 font-semibold text-ink">
                      {r.title}
                      <span className="block text-[10px] font-normal text-muted">{r.className}</span>
                    </td>
                    <td className="py-1.5 px-2 text-muted">{r.groupName}</td>
                    <td className="py-1.5 px-2 text-right font-mono">{formatDA(r.monthPrice)}</td>
                    <td className="py-1.5 px-2 text-right font-mono">{formatDA(r.schoolShare)}</td>
                    <td className="py-1.5 px-2 text-right font-mono text-success">
                      {formatDA(r.teacherShare)}
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono font-bold text-primary">
                      {r.configured ? (
                        formatDA(r.perSeance)
                      ) : (
                        <Badge tone="warning" className="text-[9px]">Non tarifé</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };


  /** Ouvre le règlement : il s'occupe lui-même de cocher les mois CLOS dus. */
  const openTimingPay = (t: Teacher) => {
    setSelectedTeacher(t);
    setIsTimingPayOpen(true);
    setActiveMenuId(null);
  };

  /** Ouvre la lecture des mois : où en est chaque emploi du temps, qui a payé. */
  const openMonths = (t: Teacher) => {
    setSelectedTeacher(t);
    setIsMonthsOpen(true);
    setActiveMenuId(null);
  };

  /** Records a cost the school carried for a teacher — it is taken off his
   *  next settlement, once. */
  const handleCreateExpense = () => {
    if (!selectedTeacher) return;
    // Only the name is required — a dépense is often noted the moment the school
    // carries it and priced once the receipt arrives. A 0 DA line simply
    // deducts nothing from the next règlement.
    if (!expenseName.trim()) {
      alert("Indiquez au moins le nom de la dépense.");
      return;
    }
    const value = Math.max(0, Math.round(expenseAmount || 0));
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


  /** What the fiche stores for the chosen formula. "Par groupe" carries no
   *  rate at all — the emplois du temps hold it. */
  const payFields = () =>
    paymentType === "monthly"
      ? { monthlyAmount, startDate }
      : paymentType === "percentage"
        ? { percentage }
        : {};

  /**
   * Only a name is required. Everything else is optional: an enseignant typed
   * without email / mot de passe is simply created WITHOUT a login — exactly
   * like a travailleur — and the desk can add his credentials later from
   * "Modifier".
   */
  const handleCreateTeacher = async () => {
    if (!firstName.trim() && !lastName.trim()) {
      alert("Indiquez au moins un nom ou un prénom.");
      return;
    }

    // Credentials are optional, but half of them is not: an email without a
    // usable password (or the reverse) cannot open an account.
    const wantsAccount = email.trim() !== "" || password !== "";
    if (wantsAccount) {
      if (!email.trim()) {
        alert("Saisissez un email de connexion, ou laissez email et mot de passe vides pour créer l'enseignant sans compte.");
        return;
      }
      if (password.length < 6) {
        alert("Le mot de passe doit contenir au moins 6 caractères.");
        return;
      }
    }

    const base = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      phone: phone.trim(),
      email: email.trim(),
      paymentType,
      ...payFields(),
    };

    if (!wantsAccount) {
      // No login: the row is simply added, like an enseignant passager.
      push("teachers", { id: uid("tch"), ...base } as Teacher);
      setIsCreateOpen(false);
      resetForm();
      return;
    }

    try {
      const { id: teacherId } = await createRoleUser({
        role: "teacher",
        email: email.trim(),
        password,
        firstName: base.firstName,
        lastName: base.lastName,
        phone: base.phone,
        paymentType,
        ...payFields(),
      });

      push("teachers", { id: teacherId, ...base } as Teacher);

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
      // "Par groupe" keeps no rate on the fiche: the emplois du temps do.
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
          const pay = payroll.get(t.id) ?? {
            payable: 0,
            withheld: 0,
            closed: 0,
            running: 0,
            debtors: 0,
          };

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
                      <button
                        onClick={() => openMonths(t)}
                        className="col-span-2 flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-bold rounded-xl bg-primary/15 text-primary border border-primary/30 hover:bg-primary/25 transition-colors"
                      >
                        <CalendarClock className="h-3.5 w-3.5" /> Mois & emplois du temps
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
                          {t.isPassager
                            ? "À la séance"
                            : t.paymentType === "monthly"
                              ? "Fixe Mensuel"
                              : t.paymentType === "per_group"
                                ? "Par groupe"
                                : "Pourcentage"}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] text-muted block uppercase font-semibold">Rémunération</span>
                        <span className="font-bold text-primary">
                          {t.isPassager
                            ? "Montant / %"
                            : t.paymentType === "monthly"
                              ? `${t.monthlyAmount} DA/m`
                              : t.paymentType === "per_group"
                                ? "Tarif emploi du temps"
                                : `${t.percentage}% / élève`}
                        </span>
                      </div>
                    </div>

                    {t.isPassager ? (
                      <div className="grid grid-cols-2 gap-2 text-[11px]">
                        <div className="bg-canvas/20 border border-line/50 p-2 rounded-xl flex flex-col justify-between">
                          <span className="text-muted block text-[9px] uppercase">Mois clos à régler</span>
                          <strong className="text-warning mt-0.5">{pay.closed}</strong>
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
                  const owing = pay.payable > 0 || pay.withheld > 0;
                  return (
                    <div className="border-t border-line/60 pt-3 mt-4 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[10px] text-muted flex items-center gap-1.5">
                        <span className={`h-1.5 w-1.5 rounded-full ${owing ? "bg-warning animate-pulse" : "bg-success"}`} />
                        {pay.closed} mois clos à régler · {unpaidSess.length} présence(s)
                        {pay.debtors > 0 && ` · ${pay.debtors} impayé(s) élève`}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {pay.withheld > 0 && (
                          <Badge tone="warning" className="font-mono font-bold text-[10px]" title="Part retenue : élèves en dette">
                            ⏳ {pay.withheld} DA
                          </Badge>
                        )}
                        {pendingDeductions > 0 && (
                          <Badge tone="danger" className="font-mono font-bold text-[10px]" title="Dépenses et acomptes à retenir">
                            − {pendingDeductions} DA
                          </Badge>
                        )}
                        <Badge tone={owing ? "warning" : "success"} className="font-mono font-bold text-[10px]">
                          {pay.payable} DA
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
        <p className="text-[11px] leading-relaxed text-muted bg-canvas border border-line rounded-xl p-3 mb-4">
          Seul le <strong className="text-ink">nom</strong> est demandé. Le téléphone, l&apos;email et
          le mot de passe sont facultatifs : laissez l&apos;email et le mot de passe vides pour créer
          l&apos;enseignant <strong className="text-ink">sans compte de connexion</strong> — vous
          pourrez les ajouter plus tard depuis « Modifier ».
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-muted mb-1 font-sans">Prénom</label>
            <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Prénom" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Nom</label>
            <Input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Nom" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Téléphone</label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+213 5XX XX XX XX (facultatif)" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted mb-1 font-sans">Email (Login)</label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@ecole.com (facultatif)" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Mot de passe</label>
            <Input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="6 caractères min. (facultatif)" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Type de rémunération</label>
            <Select
              value={paymentType}
              onChange={(e) => setPaymentType(e.target.value as TeacherPaymentType)}
              className="w-full"
            >
              <option value="percentage">Pourcentage par élève/présence</option>
              <option value="monthly">Fixe mensuel</option>
              <option value="per_group">Par groupe — tarif de l&apos;emploi du temps</option>
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
          ) : paymentType === "percentage" ? (
            <div>
              <label className="block text-xs font-semibold text-muted mb-1">Pourcentage par séance (%)</label>
              <Input
                type="number"
                value={percentage || ""}
                onChange={(e) => setPercentage(Number(e.target.value))}
                placeholder="Ex: 55"
              />
            </div>
          ) : (
            renderGroupRates()
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
              onChange={(e) => setPaymentType(e.target.value as TeacherPaymentType)}
              className="w-full"
            >
              <option value="percentage">Pourcentage</option>
              <option value="monthly">Fixe mensuel</option>
              <option value="per_group">Par groupe — tarif de l&apos;emploi du temps</option>
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
          ) : paymentType === "percentage" ? (
            <div>
              <label className="block text-xs font-semibold text-muted mb-1">Pourcentage (%)</label>
              <Input
                type="number"
                value={percentage || ""}
                onChange={(e) => setPercentage(Number(e.target.value))}
              />
            </div>
          ) : (
            renderGroupRates(selectedTeacher?.id)
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
                      : selectedTeacher.paymentType === "per_group"
                        ? "Rémunération: par groupe (tarif de chaque emploi du temps)"
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
              const myPayroll = payroll.get(selectedTeacher.id);
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
                      <span className="text-[9px] text-warning block">{myPayroll?.closed ?? 0} mois clos à régler</span>
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
                      <DollarSign className="h-4 w-4" /> Payer ses séances ({formatDA(myPayroll?.payable ?? 0)})
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

              // Les VRAIS règlements de cet enseignant — plus aucune devinette
              // sur le libellé des mouvements de caisse.
              const settlements = teacherPayments
                .filter((p) => p.teacherId === selectedTeacher.id)
                .sort((a, b) => b.paidAt.localeCompare(a.paidAt));
              const settlementLogs = settlements.map((pay) => ({
                id: pay.id,
                type: "payment" as const,
                title: "Règlement de salaire",
                amount: pay.amount,
                date: pay.paidAt.split("T")[0],
                description:
                  (pay.months ?? []).length > 0
                    ? `${(pay.months ?? []).map((m) => `${m.title} ${m.monthCode}`).join(" · ")}`
                    : pay.description,
                color: "text-success bg-success/5 border-success/20",
              }));

              // Les séances libres de GROUPE qu'il a animées : elles le paient
              // au moment où la réception les crée.
              const groupRows = teacherGroupSeances(db, selectedTeacher.id);
              const groupLogs = groupRows.map((g) => ({
                id: g.id,
                type: "group" as const,
                title: `Séance libre de groupe — ${g.title}`,
                amount: groupSeanceTotals(g).teacherTotal,
                date: g.date,
                description: `${groupSeanceTotals(g).students} élève(s) · ${g.startTime} → ${g.endTime}`,
                color: "text-primary bg-primary/5 border-primary/20",
              }));

              const allFinancialLogs = [
                ...groupLogs,
                ...teacherAcomptes,
                ...teacherExpenseLogs,
                ...teacherAbsences,
                ...settlementLogs,
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
                      <strong className="text-success text-base font-mono">
                        {settlementLogs.reduce((t, a) => t + a.amount, 0) +
                          groupLogs.reduce((t, a) => t + a.amount, 0)}{" "}
                        DA
                      </strong>
                      {groupLogs.length > 0 && (
                        <span className="text-[9px] text-primary block">
                          dont {groupLogs.reduce((t, a) => t + a.amount, 0)} DA de séances de groupe
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Historique des règlements — avec les mois soldés et la
                      réimpression de la fiche de paie. */}
                  <div className="rounded-2xl border border-line bg-surface p-4">
                    <h4 className="mb-3 text-xs font-bold uppercase tracking-wider text-muted">
                      💸 Historique des règlements ({settlements.length})
                    </h4>
                    {settlements.length === 0 ? (
                      <p className="py-6 text-center text-xs italic text-muted">
                        Aucun règlement enregistré pour cet enseignant.
                      </p>
                    ) : (
                      <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                        {settlements.map((pay) => (
                          <div
                            key={pay.id}
                            className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-success/20 bg-success/5 p-3 text-xs"
                          >
                            <div className="min-w-0">
                              <strong className="block text-ink">
                                {pay.amount} DA net
                                <Badge tone="neutral" className="ml-1.5 text-[9px]">
                                  {pay.method === "percent"
                                    ? `${pay.percentage ?? 0} %`
                                    : pay.method === "group"
                                      ? "par groupe"
                                      : "montant fixe"}
                                </Badge>
                              </strong>
                              <span className="block text-[10px] text-muted">
                                {new Date(pay.paidAt).toLocaleString("fr-DZ", {
                                  day: "2-digit",
                                  month: "2-digit",
                                  year: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                                {pay.gross != null && ` · brut ${pay.gross} DA`}
                                {(pay.expenses?.length ?? 0) + (pay.acomptes?.length ?? 0) > 0 &&
                                  ` · ${(pay.expenses?.length ?? 0)} dépense(s), ${(pay.acomptes?.length ?? 0)} acompte(s) retenus`}
                              </span>
                              {(pay.months ?? []).length > 0 && (
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {(pay.months ?? []).map((m, i) => (
                                    <Badge key={`${m.sessionId}-${m.monthCode}-${i}`} tone="primary" className="text-[9px]">
                                      {m.title} · {m.monthCode} · {m.seances} séance(s) ·{" "}
                                      {m.gross} DA
                                    </Badge>
                                  ))}
                                </div>
                              )}
                            </div>
                            <button
                              onClick={() => reprintSettlement(pay.id)}
                              className="shrink-0 rounded-lg p-1.5 text-primary hover:bg-primary-50"
                              title="Réimprimer la fiche de paie"
                            >
                              <Printer className="h-4 w-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Séances libres de groupe animées par cet enseignant */}
                  {groupRows.length > 0 && (
                    <div className="rounded-2xl border border-line bg-surface p-4">
                      <h4 className="mb-3 text-xs font-bold uppercase tracking-wider text-muted">
                        👥 Séances libres de groupe ({groupRows.length})
                      </h4>
                      <div className="max-h-52 overflow-y-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-line text-left text-[10px] font-bold uppercase text-muted">
                              <th className="py-1.5">Date</th>
                              <th className="py-1.5">Séance</th>
                              <th className="py-1.5 text-center">Élèves</th>
                              <th className="py-1.5 text-right">Sa part</th>
                            </tr>
                          </thead>
                          <tbody>
                            {groupRows.map((g) => {
                              const gt = groupSeanceTotals(g);
                              return (
                                <tr key={g.id} className="border-b border-line/50 last:border-0">
                                  <td className="py-1.5 font-mono text-[10px]">
                                    {formatDateFr(g.date)}
                                  </td>
                                  <td className="py-1.5">
                                    <strong className="block text-ink">{g.title}</strong>
                                    <span className="block font-mono text-[9px] text-muted">
                                      {g.startTime} → {g.endTime}
                                    </span>
                                  </td>
                                  <td className="py-1.5 text-center font-mono">{gt.students}</td>
                                  <td className="py-1.5 text-right font-mono font-bold text-warning">
                                    {gt.teacherTotal} DA
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

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
            <label className="mb-1 block text-xs font-semibold text-muted">Nom de la dépense</label>
            <Input
              value={expenseName}
              onChange={(e) => setExpenseName(e.target.value)}
              placeholder="Ex: Photocopies, transport, matériel…"
              autoFocus
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-muted">Montant (DA)</label>
              <Input
                type="number"
                min={0}
                value={expenseAmount || ""}
                onChange={(e) => setExpenseAmount(Math.max(0, Number(e.target.value) || 0))}
                placeholder="Ex: 1800"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-muted">Date</label>
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
            <label className="block text-xs font-semibold text-muted mb-1 font-sans">Montant de l&apos;acompte (DA) *</label>
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
            <label className="block text-xs font-semibold text-muted mb-1">Motif de l&apos;absence</label>
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
              <label className="block text-xs font-semibold text-muted mb-1 font-sans">Prénom</label>
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

      {/* Règlement — organisé par emploi du temps et par mois */}
      <TeacherPayModal
        open={isTimingPayOpen}
        teacher={selectedTeacher}
        onClose={() => setIsTimingPayOpen(false)}
      />

      {/* Lecture des mois : où en est chaque emploi du temps, qui a payé */}
      <TeacherMonthsModal
        open={isMonthsOpen}
        teacher={selectedTeacher}
        onClose={() => setIsMonthsOpen(false)}
        onPay={() => {
          setIsMonthsOpen(false);
          setIsTimingPayOpen(true);
        }}
      />

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
