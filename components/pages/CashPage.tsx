"use client";

import { useMemo, useState } from "react";
import { useData } from "@/lib/store/data";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input, Select } from "@/components/ui/SearchInput";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  ArrowUpRight,
  ArrowDownLeft,
  Plus,
  DollarSign,
  Calendar,
  TrendingUp,
  TrendingDown,
  Trash2,
  Edit,
  Search,
  Filter,
  ArrowUpDown,
  BookOpen,
  UserCheck,
  Receipt,
  AlertTriangle,
  X
} from "lucide-react";
import type { CashTransaction, CashTxType, PaymentSource } from "@/lib/types";
import {
  formatDateFr,
  formatDays,
  groupName,
  groupSeanceTotals,
  moduleName,
  monthCodeLabel,
  registrationNumberOf,
  sessionTimeLabel,
  studentName,
} from "@/lib/helpers";
import { formatDA } from "@/lib/utils";
import { workerRoleName } from "@/lib/workers";
import { useToast } from "@/lib/store/toast";

import { useCan } from "@/lib/usePermissions";
export function CashPage() {
  const can = useCan("cash");
  const db = useData();
  const { addToast } = useToast();
  const {
    cash,
    cashMove,
    deleteFrom,
    updateItem,
    groupSeances,
    teachers,
    teacherPayments,
    payments,
    students,
    expenses,
    subscriptions,
    sessions,
    workerPayments,
    studentCharges,
    reception,
    deleteStudentPayment,
    deleteTeacherPayment,
    deleteWorkerPayment,
    deleteGroupSeance,
  } = db;

  // Helper for timezone-safe local date string (YYYY-MM-DD)
  const getLocalDateString = (d: Date) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  // Filters
  /**
   * LA CAISSE S'OUVRE SUR TOUT L'HISTORIQUE.
   *
   * Elle s'ouvrait sur « aujourd'hui » : un écran vide dès le lendemain d'un
   * encaissement, alors même que la question posée à cette page est « qu'est-ce
   * qui est passé par la caisse ? ». La période par défaut est donc l'histoire
   * entière, et les autres filtres restent à un clic.
   */
  const [filterPeriod, setFilterPeriod] = useState<
    "all" | "today" | "week" | "month" | "custom"
  >("all");
  const [customStart, setCustomStart] = useState(getLocalDateString(new Date()));
  const [customEnd, setCustomEnd] = useState(getLocalDateString(new Date()));
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"all" | "students" | "teachers" | "school_expenses" | "manual">("all");

  // Modals
  const [isDepositOpen, setIsDepositOpen] = useState(false);
  const [isWithdrawOpen, setIsWithdrawOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);

  // Form states (Deposit & Withdrawal)
  const [amount, setAmount] = useState<number>(0);
  const [description, setDescription] = useState("");
  const [txDate, setTxDate] = useState(getLocalDateString(new Date()));

  // Form states (Edit Transaction)
  const [selectedTx, setSelectedTx] = useState<CashTransaction | null>(null);
  const [editAmount, setEditAmount] = useState<number>(0);
  const [editDescription, setEditDescription] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editType, setEditType] = useState<CashTxType>("deposit");

  const resetForm = () => {
    setAmount(0);
    setDescription("");
    setTxDate(getLocalDateString(new Date()));
  };

  /**
   * Les bornes de la période affichée, calculées UNE fois : le journal de caisse
   * les applique aux mouvements, et l'historique des paiements des élèves aux
   * versements eux-mêmes. Les deux tableaux parlent donc toujours des mêmes
   * jours, ce qui est la moindre des choses quand on les lit l'un sous l'autre.
   */
  const periodRange = (() => {
    const now = new Date();
    const todayStr = getLocalDateString(now);
    if (filterPeriod === "all") return { from: "1970-01-01", to: "9999-12-31" };
    if (filterPeriod === "today") return { from: todayStr, to: todayStr };
    if (filterPeriod === "week") {
      const start = new Date();
      start.setDate(now.getDate() - 7);
      return { from: getLocalDateString(start), to: todayStr };
    }
    if (filterPeriod === "month") {
      return {
        from: getLocalDateString(new Date(now.getFullYear(), now.getMonth(), 1)),
        to: todayStr,
      };
    }
    return { from: customStart || "1970-01-01", to: customEnd || todayStr };
  })();

  const teacherNameOf = (id: string) => {
    const t = teachers.find((x) => x.id === id);
    return t ? `${t.firstName} ${t.lastName}` : "—";
  };

  /**
   * LES PIÈCES, RANGÉES PAR CE QUI PERMET DE LES RETROUVER.
   *
   * Chaque ligne du journal remonte jusqu'à la pièce qui l'a écrite, et le
   * journal d'une année en compte des milliers : les reparcourir toutes pour
   * chaque ligne alourdissait la page à vue d'œil. Les correspondances sont
   * donc préparées UNE fois, puis lues directement.
   */
  const pieces = useMemo(() => {
    const paymentsByDate = new Map<string, typeof payments>();
    for (const p of payments) {
      const bucket = paymentsByDate.get(p.date);
      if (bucket) bucket.push(p);
      else paymentsByDate.set(p.date, [p]);
    }
    const teacherPayByCash = new Map<string, (typeof teacherPayments)[number]>();
    for (const p of teacherPayments) if (p.cashId) teacherPayByCash.set(p.cashId, p);
    const workerPayByCash = new Map<string, (typeof workerPayments)[number]>();
    for (const p of workerPayments) if (p.cashId) workerPayByCash.set(p.cashId, p);
    // Une séance libre de groupe porte SES DEUX mouvements — l'entrée des
    // élèves et la sortie de l'enseignant — et les signe tous les deux.
    const seanceByCash = new Map<string, (typeof groupSeances)[number]>();
    for (const g of groupSeances) {
      if (g.cashInId) seanceByCash.set(g.cashInId, g);
      if (g.cashOutId) seanceByCash.set(g.cashOutId, g);
    }
    return {
      paymentsByDate,
      teacherPayByCash,
      workerPayByCash,
      seanceByCash,
      subById: new Map(subscriptions.map((s) => [s.id, s] as const)),
      sessionById: new Map(sessions.map((s) => [s.id, s] as const)),
      chargeById: new Map(studentCharges.map((c) => [c.id, c] as const)),
    };
  }, [
    payments,
    teacherPayments,
    workerPayments,
    groupSeances,
    subscriptions,
    sessions,
    studentCharges,
  ]);

  /**
   * LE VERSEMENT D'ÉLÈVE QUI A ÉCRIT CE MOUVEMENT.
   *
   * `addSold` écrit le paiement et sa ligne de caisse dans la MÊME seconde et
   * avec la même date : on retrouve donc d'abord la correspondance exacte, et
   * la fenêtre de deux secondes ne sert que de filet pour les anciennes lignes.
   * Le montant départage deux versements du même instant.
   */
  const paymentOfTx = (tx: CashTransaction) => {
    const credit = Math.abs(tx.amount);
    const exact = pieces.paymentsByDate.get(tx.date) ?? [];
    return (
      exact.find((p) => p.amountPaid === credit) ??
      exact[0] ??
      payments.find(
        (p) =>
          Math.abs(new Date(p.date).getTime() - new Date(tx.date).getTime()) < 2000 &&
          p.amountPaid === credit,
      ) ??
      payments.find(
        (p) => Math.abs(new Date(p.date).getTime() - new Date(tx.date).getTime()) < 2000,
      )
    );
  };

  /**
   * CE QUE LA COLONNE « EMPLOI DU TEMPS » DIT D'UNE LIGNE.
   *
   * `label` est le nom du cours, `hint` son groupe / ses jours / ses horaires,
   * `note` le mois qu'il règle. `offSchedule` marque ce qui ne PEUT pas porter
   * d'emploi du temps — un livre, un salaire de personnel, une séance libre :
   * la colonne le dit alors franchement au lieu d'en inventer un.
   */
  type EmploiCell = {
    label: string;
    hint?: string;
    note?: string;
    offSchedule?: boolean;
  };

  /**
   * L'EMPLOI DU TEMPS QUE CE MOUVEMENT PAIE.
   *
   * C'est la question qu'on pose à la caisse et à laquelle elle ne répondait
   * pas : « + 4 000 DA — Amine Benali », d'accord, mais SUR QUEL COURS ? Chaque
   * ligne remonte donc jusqu'à la pièce qui l'a produite — le versement de
   * l'élève pour une entrée, le règlement de l'enseignant pour une sortie, la
   * séance libre pour ses deux mouvements — et en tire le nom de l'emploi du
   * temps, son groupe, ses jours et ses heures.
   *
   * `null` = la pièce est introuvable, et la colonne le dit plutôt que d'aller
   * chercher au hasard un versement du même instant.
   */
  const emploiOfTx = (tx: CashTransaction): EmploiCell | null => {
    // 1. La séance libre de groupe signe elle-même ses deux mouvements : c'est
    //    la piste la plus sûre, donc la première — sans quoi son entrée irait
    //    se faire attribuer le versement d'un élève tombé à la même seconde.
    const seance = pieces.seanceByCash.get(tx.id);
    if (seance) {
      return {
        label: seance.title,
        hint: `${teacherNameOf(seance.teacherId)} · ${formatDateFr(seance.date)} · ${seance.startTime}–${seance.endTime}`,
        note: "séance libre de groupe",
        offSchedule: true,
      };
    }

    // 2. La paie d'un travailleur ne tient à aucun cours : elle tient à un
    //    métier et à une période, et c'est cela qu'il faut lire.
    const wage = pieces.workerPayByCash.get(tx.id);
    if (wage) {
      const w = reception.find((x) => x.id === wage.workerId);
      return {
        label: "Salaire du personnel",
        hint: w ? `${w.firstName} ${w.lastName} · ${workerRoleName(db, w.role)}` : undefined,
        note: wage.periodKeys.join(" · ") || undefined,
        offSchedule: true,
      };
    }

    if (tx.type === "student_payment" || tx.type === "student_debt") {
      const pmt = paymentOfTx(tx);
      if (!pmt) return null;
      // Un frais (livre, tenue, avance de l'école) ne touche aucun emploi du
      // temps : il n'en porte pas, et la colonne ne doit pas lui en prêter un.
      if (pmt.chargeId) {
        const charge = pieces.chargeById.get(pmt.chargeId);
        return {
          label: "Frais divers",
          hint: charge ? charge.name : undefined,
          note: "hors emploi du temps",
          offSchedule: true,
        };
      }
      const sub = pmt.subscriptionId ? pieces.subById.get(pmt.subscriptionId) : undefined;
      const ses = sub && pieces.sessionById.get(sub.sessionId);
      if (!ses) return null;
      return {
        label: ses.title || moduleName(db, ses.moduleId) || "Emploi du temps",
        hint: `Groupe ${groupName(db, ses.groupId)} · ${formatDays(ses.days) || "—"} · ${sessionTimeLabel(ses)}`,
        note: pmt.monthCode ? monthCodeLabel(pmt.monthCode) : undefined,
      };
    }

    if (tx.type === "teacher_payment") {
      const pay = pieces.teacherPayByCash.get(tx.id);
      if (!pay) return null;
      const b = pay.board;
      if (b) {
        return {
          label: b.emploi,
          hint: `Groupe ${b.groupName} · ${b.daysLabel} · ${b.timeLabel}`,
          note: monthCodeLabel(b.monthCode),
        };
      }
      const months = pay.months ?? [];
      if (months.length > 0) {
        return {
          label: months.map((m) => m.title).join(" · "),
          note: months.map((m) => monthCodeLabel(m.monthCode)).join(" · "),
        };
      }
      const titles = Array.from(
        new Set((pay.details ?? []).map((d) => d.title || d.moduleName).filter(Boolean)),
      );
      if (titles.length > 0) return { label: titles.join(" · ") };
      // Un vieux règlement AU POURCENTAGE soldait toutes les présences d'un
      // coup : il ne nomme aucun emploi, et le prétendre serait mentir.
      if (pay.method === "percent") {
        return {
          label: "Tous créneaux confondus",
          hint: `${pay.sessionsCount} créneau(x) · ${pay.studentsCount} élève(s)`,
          note: "règlement au pourcentage",
          offSchedule: true,
        };
      }
      return null;
    }
    return null;
  };

  /** Pourquoi cette ligne-là ne porte aucun emploi du temps. */
  const noEmploiReason = (tx: CashTransaction) => {
    if (tx.type === "acompte") return "acompte sur salaire";
    if (tx.type === "expense") return "dépense de l'école";
    if (tx.type === "deposit" || tx.type === "withdraw") return "mouvement manuel";
    return "—";
  };

  /** Ce que la colonne affiche, mis à plat pour que la recherche le trouve. */
  const emploiTextOf = (tx: CashTransaction) => {
    const e = emploiOfTx(tx);
    return e ? `${e.label} ${e.hint ?? ""} ${e.note ?? ""}` : "";
  };

  // Filtering transactions
  const getFilteredTransactions = () => {
    const now = new Date();
    
    return cash.filter((tx) => {
      const txDateStr = tx.date.substring(0, 10); // YYYY-MM-DD
      
      let inPeriod = false;
      if (filterPeriod === "all") {
        inPeriod = true;
      } else if (filterPeriod === "today") {
        const todayStr = getLocalDateString(now);
        inPeriod = txDateStr === todayStr;
      } else if (filterPeriod === "week") {
        const startOfWeek = new Date();
        startOfWeek.setDate(now.getDate() - 7);
        const startStr = getLocalDateString(startOfWeek);
        const todayStr = getLocalDateString(now);
        inPeriod = txDateStr >= startStr && txDateStr <= todayStr;
      } else if (filterPeriod === "month") {
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const startStr = getLocalDateString(startOfMonth);
        const todayStr = getLocalDateString(now);
        inPeriod = txDateStr >= startStr && txDateStr <= todayStr;
      } else {
        // Custom
        const startStr = customStart || "1970-01-01";
        const endStr = customEnd || getLocalDateString(now);
        inPeriod = txDateStr >= startStr && txDateStr <= endStr;
      }

      if (!inPeriod) return false;

      // Filter by search query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        return (
          tx.description.toLowerCase().includes(query) ||
          tx.type.toLowerCase().includes(query) ||
          tx.amount.toString().includes(query) ||
          // On cherche aussi PAR COURS : taper « maths 4AM » doit ramener tout
          // ce qui est passé par cet emploi du temps, dans les deux sens.
          emploiTextOf(tx).toLowerCase().includes(query)
        );
      }

      return true;
    });
  };

  const filteredTx = getFilteredTransactions();

  // 1. Overall Application Totals (All-Time)
  const totalEarningsAllTime = cash
    .filter((t) => t.amount > 0)
    .reduce((sum, t) => sum + t.amount, 0);

  const totalExpensesAllTime = cash
    .filter((t) => t.amount < 0)
    .reduce((sum, t) => sum + Math.abs(t.amount), 0);

  const currentCashBalance = totalEarningsAllTime - totalExpensesAllTime;

  // 2. Filtered Period Totals
  const periodInflows = filteredTx
    .filter((t) => t.amount > 0)
    .reduce((sum, t) => sum + t.amount, 0);

  const periodOutflows = filteredTx
    .filter((t) => t.amount < 0)
    .reduce((sum, t) => sum + Math.abs(t.amount), 0);

  const periodNetFlow = periodInflows - periodOutflows;

  // 3. Specific breakdowns for filtered period
  // Ce que les élèves ont réellement versé : une dette avancée par l'école
  // s'annule d'elle-même (l'entrée portée à l'élève, la sortie qui l'a payée),
  // et n'a donc jamais enrichi la caisse.
  const studentPaymentsPeriod = filteredTx
    .filter((t) => t.type === "student_payment" || t.type === "student_debt")
    .reduce((sum, t) => sum + t.amount, 0);

  /** Ce que l'école a avancé pour ses élèves sur la période (un positif). */
  const coveredDebtsPeriod = filteredTx
    .filter((t) => t.type === "student_debt")
    .reduce((sum, t) => sum + Math.abs(t.amount), 0);

  const teacherPaymentsPeriod = filteredTx
    .filter((t) => t.type === "teacher_payment" || t.type === "acompte")
    .reduce((sum, t) => sum + Math.abs(t.amount), 0);

  const schoolExpensesPeriod = filteredTx
    .filter((t) => t.type === "expense" || t.type === "withdraw")
    .reduce((sum, t) => sum + Math.abs(t.amount), 0);

  // Tab Filtering
  const getTabFilteredTransactions = () => {
    switch (activeTab) {
      case "students":
        // Une dette avancée par l'école écrit DEUX mouvements : le paiement
        // porté au crédit de l'élève et la sortie qui l'a financé. Les deux
        // appartiennent à l'élève, donc les deux se lisent ici.
        return filteredTx.filter(
          (t) => t.type === "student_payment" || t.type === "student_debt",
        );
      case "teachers":
        return filteredTx.filter((t) => t.type === "teacher_payment" || t.type === "acompte");
      case "school_expenses":
        return filteredTx.filter((t) => t.type === "expense");
      case "manual":
        return filteredTx.filter((t) => t.type === "deposit" || t.type === "withdraw");
      default:
        return filteredTx;
    }
  };

  const tabTxList = getTabFilteredTransactions();

  /**
   * LE JOURNAL, DU PLUS RÉCENT AU PLUS ANCIEN, AVEC LE SOLDE APRÈS CHAQUE LIGNE.
   *
   * Une caisse se relit toujours de la même façon : « après ce mouvement, il
   * restait combien ? ». Le solde est cumulé dans l'ordre CHRONOLOGIQUE puis la
   * liste est retournée, pour que la ligne du haut soit la plus récente sans
   * que les soldes en soient faussés.
   */
  const journalRows = (() => {
    const chrono = tabTxList.slice().sort((a, b) => a.date.localeCompare(b.date));
    let running = 0;
    const rows = chrono.map((tx) => {
      running += tx.amount;
      return { tx, running };
    });
    return rows.reverse();
  })();

  // Create Transaction Handlers
  const handleDepositSubmit = () => {
    if (amount <= 0 || !description) {
      alert("Veuillez saisir un montant et une description valides.");
      return;
    }
    cashMove("deposit", amount, description, txDate);
    setIsDepositOpen(false);
    resetForm();
  };

  const handleWithdrawSubmit = () => {
    if (amount <= 0 || !description) {
      alert("Veuillez saisir un montant et une description valides.");
      return;
    }
    cashMove("withdraw", amount, description, txDate);
    setIsWithdrawOpen(false);
    resetForm();
  };

  // Edit / Delete Handlers
  const openEdit = (tx: CashTransaction) => {
    setSelectedTx(tx);
    setEditAmount(Math.abs(tx.amount));
    setEditDescription(tx.description);
    setEditDate(tx.date.substring(0, 10));
    setEditType(tx.type);
    setIsEditOpen(true);
  };

  const handleSaveEdit = () => {
    if (!selectedTx || editAmount <= 0 || !editDescription || !editDate) {
      alert("Veuillez remplir tous les champs obligatoires.");
      return;
    }

    const isOutflow = ["withdraw", "expense", "teacher_payment", "acompte", "student_debt"].includes(editType);
    const signedAmount = isOutflow ? -Math.abs(editAmount) : Math.abs(editAmount);

    let isoDate = selectedTx.date;
    if (editDate !== selectedTx.date.substring(0, 10)) {
      const currentTime = new Date().toISOString().substring(11);
      isoDate = `${editDate}T${currentTime}`;
    }

    updateItem("cash", selectedTx.id, {
      type: editType,
      amount: signedAmount,
      description: editDescription,
      date: isoDate,
    });

    setIsEditOpen(false);
    setSelectedTx(null);
  };

  /**
   * SUPPRIMER UNE LIGNE DE CAISSE, EN DÉFAISANT CE QU'ELLE AVAIT FAIT.
   *
   * Une ligne de caisse n'est presque jamais seule : le versement d'un élève a
   * crédité SON SOLDE, le règlement d'un enseignant vit dans SA FICHE DE PAIE,
   * la paie d'un travailleur a soldé ses journées, une séance libre porte ses
   * DEUX mouvements. Effacer la seule ligne de caisse laissait donc l'argent
   * disparu du tiroir mais le paiement toujours porté à l'élève et le règlement
   * toujours dans l'historique du professeur.
   *
   * On remonte donc jusqu'à la PIÈCE qui a écrit la ligne et on la supprime
   * PAR ELLE — l'action dédiée reprend le solde, rouvre ce qui était soldé et
   * retire la (ou les) ligne(s) de caisse d'un même geste. Ce qui n'est rattaché
   * à aucune pièce (dépôt, retrait, dépense, acompte, dette avancée) tombe sur
   * l'ancien comportement : la ligne de caisse seule s'en va.
   */
  const handleDelete = async (tx: CashTransaction) => {
    // 1. Séance libre de groupe : elle signe ses deux mouvements (entrée des
    //    élèves ET part de l'enseignant) — les deux partent avec elle.
    const seance = pieces.seanceByCash.get(tx.id);
    if (seance) {
      if (
        !confirm(
          `Supprimer la séance libre de groupe « ${seance.title} » ? Ses deux mouvements de caisse (encaissement des élèves et part de l'enseignant) seront retirés.`,
        )
      )
        return;
      const res = await deleteGroupSeance(seance.id);
      addToast({
        type: res.ok ? "success" : "danger",
        title: res.ok ? "Séance supprimée" : "Suppression impossible",
        message: res.ok
          ? "La séance et ses deux mouvements de caisse ont été retirés."
          : "La séance n'a pas pu être supprimée.",
      });
      return;
    }

    // 2. Paie d'un travailleur : l'argent revient en caisse, et ses journées,
    //    acomptes et absences soldés redeviennent dus.
    const wage = pieces.workerPayByCash.get(tx.id);
    if (wage) {
      const w = reception.find((x) => x.id === wage.workerId);
      const who = w ? `${w.firstName} ${w.lastName}` : "ce travailleur";
      if (
        !confirm(
          `Supprimer ce règlement de ${who} ? Il sera retiré de son historique, et ses journées, acomptes et absences soldés redeviendront dus.`,
        )
      )
        return;
      const res = await deleteWorkerPayment(wage.id);
      addToast({
        type: res.ok ? "success" : "danger",
        title: res.ok ? "Règlement supprimé" : "Suppression impossible",
        message: res.ok
          ? "Le règlement a été retiré de l'historique du travailleur et de la caisse."
          : "Le règlement n'a pas pu être supprimé.",
      });
      return;
    }

    // 3. Règlement d'un enseignant : retiré de sa fiche de paie ; les présences,
    //    arriérés, dépenses, acomptes et scolarités qu'il avait soldés
    //    redeviennent dus. Un vieux règlement sans `cashId` est retrouvé par son
    //    montant et sa date, exactement comme l'action de suppression le fait.
    const teacherPay =
      pieces.teacherPayByCash.get(tx.id) ??
      (tx.type === "teacher_payment"
        ? teacherPayments.find(
            (p) => p.amount === -tx.amount && p.paidAt.slice(0, 10) === tx.date.slice(0, 10),
          )
        : undefined);
    if (teacherPay) {
      const who = teacherNameOf(teacherPay.teacherId);
      if (
        !confirm(
          `Supprimer ce règlement de ${who} ? Il sera retiré de l'historique de l'enseignant, et tout ce qu'il avait soldé (présences, arriérés, retenues) redeviendra dû.`,
        )
      )
        return;
      const res = await deleteTeacherPayment(teacherPay.id);
      addToast({
        type: res.ok ? "success" : "danger",
        title: res.ok ? "Règlement supprimé" : "Suppression impossible",
        message: res.ok
          ? `${formatDA(res.amount ?? 0)} retirés de l'historique de l'enseignant et de la caisse.`
          : "Le règlement n'a pas pu être supprimé.",
      });
      return;
    }

    // 4. Versement d'un élève : repris de SON SOLDE (l'emploi du temps crédité)
    //    et retiré de la caisse. On ne cible QUE le versement qui a écrit
    //    exactement cette ligne — même type, même date, même montant — pour ne
    //    jamais reprendre le solde d'un autre élève par ressemblance. Un
    //    règlement de dette ou de frais ne se défait pas ainsi (il se corrige en
    //    réencaissant), donc il n'est pas visé ici.
    if (tx.type === "student_payment") {
      const credit = Math.abs(tx.amount);
      const pmt = payments.find(
        (p) => p.type !== "debt_payment" && p.date === tx.date && p.amountPaid === credit,
      );
      if (pmt) {
        const stu = students.find((s) => s.id === pmt.studentId);
        const who = stu ? `${stu.firstName} ${stu.lastName}` : "cet élève";
        if (
          !confirm(
            `Supprimer ce versement de ${who} ? Il sera repris de son solde et retiré de la caisse.`,
          )
        )
          return;
        const res = await deleteStudentPayment(pmt.id);
        if (!res.ok && res.messageKey === "payment.debtLocked") {
          addToast({
            type: "danger",
            title: "Suppression impossible",
            message:
              "Ce règlement de dette se corrige en réencaissant depuis la fiche de l'élève, pas en le supprimant ici.",
          });
          return;
        }
        addToast({
          type: res.ok ? "success" : "danger",
          title: res.ok ? "Versement supprimé" : "Suppression impossible",
          message: res.ok
            ? `${formatDA(res.amount ?? 0)} repris du solde de l'élève et de la caisse.`
            : "Le versement n'a pas pu être supprimé.",
          studentName: stu ? `${stu.firstName} ${stu.lastName}` : undefined,
        });
        return;
      }
      // Aucun versement rattaché (séance de passage, ancien mouvement) : on
      // retombe sur la suppression simple de la ligne de caisse.
    }

    // 5. Tout le reste — dépôt/retrait manuel, dépense, acompte, dette avancée,
    //    et les paiements d'élève sans versement rattaché : seule la ligne de
    //    caisse est retirée, comme auparavant.
    if (
      confirm("Voulez-vous vraiment supprimer cette transaction ? Cette action est irréversible.")
    ) {
      deleteFrom("cash", tx.id);
    }
  };

  /**
   * Les séances libres de GROUPE de la période affichée. Leurs deux mouvements
   * sont déjà dans le journal ci-dessous ; ce bloc en donne le détail complet —
   * élèves, prix par élève, part de l'école et part de l'enseignant.
   */
  const periodGroupSeances = (() => {
    // La fenêtre est celle du filtre — pas celle que les mouvements affichés
    // dessinent : sans mouvement, l'ancienne version n'affichait plus rien.
    const { from, to } = periodRange;
    return groupSeances
      .filter((g) => g.date >= from && g.date <= to)
      .sort((a, b) => b.date.localeCompare(a.date));
  })();

  /**
   * LES RÈGLEMENTS D'ENSEIGNANTS DE LA PÉRIODE, DÉPLIÉS.
   *
   * Un mouvement de caisse ne dit qu'un montant. Ce que la direction veut lire,
   * c'est ce qu'il A PAYÉ : quel emploi du temps, quel mois, combien d'élèves,
   * ce que les arriérés ont rattrapé et ce que les retenues ont repris. Chaque
   * règlement de mois porte cette photographie, donc il suffit de la relire.
   */
  const periodSettlements = (() => {
    const { from, to } = periodRange;
    return teacherPayments
      .filter((p) => p.paidAt.slice(0, 10) >= from && p.paidAt.slice(0, 10) <= to)
      .sort((a, b) => b.paidAt.localeCompare(a.paidAt));
  })();

  /**
   * LE DÉTAIL DERRIÈRE CHAQUE MOUVEMENT DE CAISSE.
   *
   * Une ligne de caisse ne dit que « Règlement séances Untel (3 créneaux) ».
   * Ce qu'on veut lire, c'est CE QU'ELLE PAIE : quel élève, quel emploi du
   * temps, quel mois, quelle dépense, quel règlement d'enseignant. Chaque
   * mouvement est donc relié à la pièce qui l'a produit.
   */
  const detailOf = (tx: CashTransaction) => {
    if (tx.type === "teacher_payment") {
      // La paie d'un travailleur : ni mois d'emploi ni élèves, mais un brut et
      // ce qui a été repris dessus.
      const wage = pieces.workerPayByCash.get(tx.id);
      if (wage) {
        const w = reception.find((x) => x.id === wage.workerId);
        return [
          w ? `${w.firstName} ${w.lastName}` : "Travailleur",
          `brut ${formatDA(wage.gross)}`,
          wage.acomptes > 0 ? `acomptes -${formatDA(wage.acomptes)}` : "",
          wage.absences > 0 ? `absences -${formatDA(wage.absences)}` : "",
        ]
          .filter(Boolean)
          .join(" · ");
      }
      const pay = pieces.teacherPayByCash.get(tx.id);
      if (pay) {
        const t = teachers.find((x) => x.id === pay.teacherId);
        // Un règlement de MOIS porte sa photographie : on peut donc dire
        // exactement ce qu'il a payé — quel groupe, quel mois, combien
        // d'élèves, combien d'arriérés et combien de retenues — au lieu de
        // « 3 créneaux ».
        const b = pay.board;
        if (b) {
          // L'emploi, le groupe et le mois ont maintenant leur propre colonne :
          // les redire ici ne ferait que noyer ce qu'on vient lire — combien
          // d'élèves, combien de séances tenues, et ce qui a été repris.
          return [
            t ? `${t.firstName} ${t.lastName}` : "Enseignant",
            `${b.students.length} élève(s) · ${b.held}/${b.size} séances`,
            `brut ${formatDA(b.gross)}`,
            b.arrears.length > 0 ? `${b.arrears.length} arriéré(s) rattrapé(s)` : "",
            b.deductionsTotal > 0 ? `${formatDA(b.deductionsTotal)} de retenues` : "",
          ]
            .filter(Boolean)
            .join(" · ");
        }
        const arrears = (pay.arrears ?? []).length;
        return [
          t ? `${t.firstName} ${t.lastName}` : "Enseignant",
          `${pay.sessionsCount} créneau(x)`,
          pay.gross != null ? `brut ${formatDA(pay.gross)}` : "",
          arrears > 0 ? `${arrears} arriéré(s) débloqué(s)` : "",
        ]
          .filter(Boolean)
          .join(" · ");
      }
    }
    if (tx.type === "student_payment" || tx.type === "student_debt") {
      // Le versement de l'élève écrit dans la même seconde que le mouvement.
      const near = paymentOfTx(tx);
      if (near) {
        const stu = students.find((x) => x.id === near.studentId);
        // Le mois est dans la colonne « Emploi du temps » : ici on lit qui a
        // payé, et s'il reste quelque chose à devoir.
        return [
          stu ? `${stu.firstName} ${stu.lastName}` : "Élève",
          near.rest > 0 ? `reste ${formatDA(near.rest)}` : "soldé",
        ]
          .filter(Boolean)
          .join(" · ");
      }
    }
    if (tx.type === "expense") {
      const exp = expenses.find(
        (e) => e.date.slice(0, 10) === tx.date.slice(0, 10) && e.amount === Math.abs(tx.amount),
      );
      if (exp) return `Dépense « ${exp.name} »`;
    }
    return "";
  };

  const getTxTypeBadge = (type: string) => {
    const labels: Record<string, { label: string; style: string }> = {
      deposit: { label: "Dépôt manuel", style: "bg-success/15 text-success border border-success/30" },
      withdraw: { label: "Retrait manuel", style: "bg-danger/15 text-danger border border-danger/30" },
      expense: { label: "Dépense école", style: "bg-rose-500/15 text-rose-600 border border-rose-500/30" },
      student_payment: { label: "Paiement élève", style: "bg-primary-50 text-primary border border-primary/20" },
      teacher_payment: { label: "Règlement prof / staff", style: "bg-warning/15 text-warning border border-warning/30" },
      acompte: { label: "Acompte", style: "bg-warning/15 text-warning border border-warning/30" },
      student_debt: { label: "Dette élève avancée", style: "bg-danger/15 text-danger border border-danger/30" },
      registration: { label: "Inscription", style: "bg-success/15 text-success border border-success/30" },
    };
    const info = labels[type] ?? { label: type, style: "bg-canvas text-ink border border-line" };
    return <span className={`px-2.5 py-1 rounded-xl text-[10px] font-bold ${info.style}`}>{info.label}</span>;
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <PageHeader emoji="🏦" title="Caisse" subtitle="Suivi des flux de trésorerie en temps réel" />

        <div className="flex items-center gap-2">
          {can("deposit") && (
<Button
              onClick={() => { resetForm(); setIsDepositOpen(true); }}
              className="bg-success hover:bg-success/90 shadow-md hover:shadow-lg transition-all duration-300 flex items-center gap-2 py-2.5 rounded-xl text-xs font-bold text-white border-none"
            >
              <Plus className="h-4 w-4" /> Dépôt Caisse
            </Button>
          )}
          {can("withdraw") && (
<Button
              onClick={() => { resetForm(); setIsWithdrawOpen(true); }}
              className="bg-danger hover:bg-danger/90 shadow-md hover:shadow-lg transition-all duration-300 flex items-center gap-2 py-2.5 rounded-xl text-xs font-bold text-white border-none"
            >
              <ArrowDownLeft className="h-4 w-4" /> Retrait Caisse
            </Button>
          )}
        </div>
      </div>

      {/* Main KPI Stats Dashboard */}
      <div className="space-y-6">
        {/* Row 1: Period Metrics */}
        <div>
          <span className="text-[10px] text-muted font-bold uppercase tracking-wider block mb-2.5">
            Flux Périodiques (
            {filterPeriod === "all"
              ? "tout l'historique"
              : filterPeriod === "today"
                ? "Aujourd'hui"
                : filterPeriod === "week"
                  ? "7 derniers jours"
                  : filterPeriod === "month"
                    ? "Ce mois-ci"
                    : "Personnalisé"}
            )
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="border border-line bg-surface card-shadow hover:translate-y-[-2px] transition-transform duration-300">
              <CardBody className="flex justify-between items-center p-5">
                <div>
                  <span className="text-[10px] text-muted font-bold uppercase tracking-wider block">Flux Net Période</span>
                  <strong className={`text-2xl font-black block mt-1.5 ${periodNetFlow >= 0 ? "text-success" : "text-danger"}`}>
                    {periodNetFlow >= 0 ? "+" : ""}{formatDA(periodNetFlow)}
                  </strong>
                </div>
                <div className={`h-11 w-11 rounded-2xl flex items-center justify-center ${periodNetFlow >= 0 ? "bg-success/10 text-success" : "bg-danger/10 text-danger"}`}>
                  {periodNetFlow >= 0 ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}
                </div>
              </CardBody>
            </Card>

            <Card className="border border-line bg-surface card-shadow hover:translate-y-[-2px] transition-transform duration-300">
              <CardBody className="flex justify-between items-center p-5">
                <div>
                  <span className="text-[10px] text-muted font-bold uppercase tracking-wider block">Paiements Élèves</span>
                  <strong className="text-2xl font-black text-primary block mt-1.5">
                    {formatDA(studentPaymentsPeriod)}
                  </strong>
                  {coveredDebtsPeriod > 0 && (
                    <span className="text-[10px] text-danger font-bold block mt-0.5">
                      dont {formatDA(coveredDebtsPeriod)} de dettes avancées par l&apos;école
                    </span>
                  )}
                </div>
                <div className="h-11 w-11 rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
                  <UserCheck className="h-5 w-5" />
                </div>
              </CardBody>
            </Card>

            <Card className="border border-line bg-surface card-shadow hover:translate-y-[-2px] transition-transform duration-300">
              <CardBody className="flex justify-between items-center p-5">
                <div>
                  <span className="text-[10px] text-muted font-bold uppercase tracking-wider block">Règlements Profs</span>
                  <strong className="text-2xl font-black text-warning block mt-1.5">
                    -{formatDA(teacherPaymentsPeriod)}
                  </strong>
                </div>
                <div className="h-11 w-11 rounded-2xl bg-warning/10 text-warning flex items-center justify-center">
                  <BookOpen className="h-5 w-5" />
                </div>
              </CardBody>
            </Card>

            <Card className="border border-line bg-surface card-shadow hover:translate-y-[-2px] transition-transform duration-300">
              <CardBody className="flex justify-between items-center p-5">
                <div>
                  <span className="text-[10px] text-muted font-bold uppercase tracking-wider block">Dépenses & Retraits</span>
                  <strong className="text-2xl font-black text-danger block mt-1.5">
                    -{formatDA(schoolExpensesPeriod)}
                  </strong>
                </div>
                <div className="h-11 w-11 rounded-2xl bg-rose-500/10 text-rose-600 flex items-center justify-center">
                  <Receipt className="h-5 w-5" />
                </div>
              </CardBody>
            </Card>
          </div>
        </div>

        {/* Row 2: All-Time Application Cash Flow */}
        <div>
          <span className="text-[10px] text-muted font-bold uppercase tracking-wider block mb-2.5">
            Flux Globaux (Toutes Périodes)
          </span>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <Card className="relative overflow-hidden bg-gradient-to-br from-primary-600 to-primary-750 text-white border-none card-shadow hover:translate-y-[-2px] transition-transform duration-300">
              <div className="absolute right-[-15px] bottom-[-15px] opacity-15 text-white">
                <DollarSign className="h-32 w-32" />
              </div>
              <CardBody className="flex justify-between items-center p-5 h-28 relative z-10">
                <div>
                  <span className="text-xs text-white/80 font-bold uppercase tracking-wider block">Solde Caisse Réel</span>
                  <strong className="text-3xl font-black block mt-1.5">{formatDA(currentCashBalance)}</strong>
                </div>
                <div className="h-12 w-12 rounded-2xl bg-white/10 flex items-center justify-center shadow-inner">
                  <DollarSign className="h-6 w-6" />
                </div>
              </CardBody>
            </Card>

            <Card className="border border-success/20 bg-success/5 hover:translate-y-[-2px] transition-transform duration-300">
              <CardBody className="flex justify-between items-center p-5 h-28">
                <div>
                  <span className="text-xs text-success/80 font-bold uppercase tracking-wider block">Total Recettes Application</span>
                  <strong className="text-2xl font-black text-success block mt-1.5">+{formatDA(totalEarningsAllTime)}</strong>
                </div>
                <div className="h-11 w-11 rounded-2xl bg-success/15 text-success flex items-center justify-center">
                  <ArrowUpRight className="h-5 w-5" />
                </div>
              </CardBody>
            </Card>

            <Card className="border border-danger/20 bg-danger/5 hover:translate-y-[-2px] transition-transform duration-300">
              <CardBody className="flex justify-between items-center p-5 h-28">
                <div>
                  <span className="text-xs text-danger/80 font-bold uppercase tracking-wider block font-sans">Total Dépenses Application</span>
                  <strong className="text-2xl font-black text-danger block mt-1.5">-{formatDA(totalExpensesAllTime)}</strong>
                </div>
                <div className="h-11 w-11 rounded-2xl bg-danger/15 text-danger flex items-center justify-center">
                  <ArrowDownLeft className="h-5 w-5" />
                </div>
              </CardBody>
            </Card>
          </div>
        </div>
      </div>

      {/* Toolbar: Filters, Search, Custom Dates */}
      <div className="bg-surface border border-line p-4 rounded-2xl flex flex-col xl:flex-row xl:items-center justify-between gap-4 text-xs">
        {/* Time period filter */}
        <div className="flex flex-wrap items-center gap-1 shrink-0">
          <Button
            size="sm"
            variant={filterPeriod === "all" ? "primary" : "outline"}
            onClick={() => setFilterPeriod("all")}
            className="rounded-xl font-bold py-1.5 px-3"
          >
            Tout l&apos;historique
          </Button>
          <Button
            size="sm"
            variant={filterPeriod === "today" ? "primary" : "outline"}
            onClick={() => setFilterPeriod("today")}
            className="rounded-xl font-bold py-1.5 px-3"
          >
            Aujourd'hui
          </Button>
          <Button
            size="sm"
            variant={filterPeriod === "week" ? "primary" : "outline"}
            onClick={() => setFilterPeriod("week")}
            className="rounded-xl font-bold py-1.5 px-3"
          >
            7 derniers jours
          </Button>
          <Button
            size="sm"
            variant={filterPeriod === "month" ? "primary" : "outline"}
            onClick={() => setFilterPeriod("month")}
            className="rounded-xl font-bold py-1.5 px-3"
          >
            Ce mois-ci
          </Button>
          <Button
            size="sm"
            variant={filterPeriod === "custom" ? "primary" : "outline"}
            onClick={() => setFilterPeriod("custom")}
            className="rounded-xl font-bold py-1.5 px-3"
          >
            Période personnalisée
          </Button>
        </div>

        {/* Custom date range fields */}
        {filterPeriod === "custom" && (
          <div className="flex items-center gap-2 animate-in fade-in slide-in-from-left-2 duration-200">
            <div>
              <label className="block text-[10px] text-muted mb-1 font-bold">Début</label>
              <Input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="py-1 text-xs rounded-xl"
              />
            </div>
            <div>
              <label className="block text-[10px] text-muted mb-1 font-bold">Fin</label>
              <Input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="py-1 text-xs rounded-xl"
              />
            </div>
          </div>
        )}

        {/* Search bar */}
        <div className="relative flex-1 max-w-md xl:ml-auto">
          <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-muted">
            <Search className="h-4 w-4" />
          </span>
          <Input
            type="text"
            placeholder="Rechercher par description, montant, type..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 pr-4 py-2 text-xs rounded-xl w-full"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted hover:text-ink"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Tabs & Table */}
      <div className="bg-surface border border-line rounded-2xl overflow-hidden card-shadow">
        {/* Tab List */}
        <div className="flex border-b border-line bg-canvas/30 px-4 pt-3 gap-1 scrollbar-none overflow-x-auto">
          {[
            { id: "all", label: "Toutes les Transactions", count: filteredTx.length },
            { id: "students", label: "Paiements Élèves", count: filteredTx.filter((t) => t.type === "student_payment" || t.type === "student_debt").length },
            { id: "teachers", label: "Règlements Profs/Staff", count: filteredTx.filter((t) => t.type === "teacher_payment" || t.type === "acompte").length },
            { id: "school_expenses", label: "Dépenses École", count: filteredTx.filter((t) => t.type === "expense").length },
            { id: "manual", label: "Dépôts & Retraits", count: filteredTx.filter((t) => t.type === "deposit" || t.type === "withdraw").length },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-4 py-2.5 text-xs font-bold rounded-t-xl transition-all border-b-2 -mb-0.5 whitespace-nowrap flex items-center gap-2 ${
                activeTab === tab.id
                  ? "border-primary text-primary bg-surface shadow-sm"
                  : "border-transparent text-muted hover:text-ink hover:bg-canvas/45"
              }`}
            >
              {tab.label}
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                activeTab === tab.id ? "bg-primary/10 text-primary" : "bg-canvas text-muted"
              }`}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        {/* Le détail des versements d'élèves — qui, quel emploi, quel mois. */}
        {(activeTab === "all" || activeTab === "students") && (
          <StudentPaymentsHistory
            from={periodRange.from}
            to={periodRange.to}
            query={searchQuery}
          />
        )}

        {/* Règlements d'enseignants — ce que chaque versement a réellement payé */}
        {(activeTab === "all" || activeTab === "teachers") && periodSettlements.length > 0 && (
          <div className="border-b border-line p-4">
            <h4 className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted">
              <UserCheck className="h-3.5 w-3.5 text-warning" /> Règlements d&apos;enseignants (
              {periodSettlements.length})
            </h4>
            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="w-full min-w-[900px] text-left text-[11px]">
                <thead className="bg-canvas/50">
                  <tr className="text-[9px] font-bold uppercase tracking-wider text-muted">
                    <th className="p-2.5">Date</th>
                    <th className="p-2.5">Enseignant</th>
                    <th className="p-2.5">Emploi du temps · mois</th>
                    <th className="p-2.5 text-center">Élèves</th>
                    <th className="p-2.5 text-right">Table 1 — élèves</th>
                    <th className="p-2.5 text-right">Table 2 — arriérés</th>
                    <th className="p-2.5 text-right">Table 3 — retenues</th>
                    <th className="p-2.5 text-right">Net versé</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {periodSettlements.map((pay) => {
                    const b = pay.board;
                    return (
                      <tr key={pay.id}>
                        <td className="p-2.5 font-mono text-[10px]">
                          {formatDateFr(pay.paidAt.slice(0, 10))}
                        </td>
                        <td className="p-2.5">
                          <strong className="text-ink">{teacherNameOf(pay.teacherId)}</strong>
                        </td>
                        <td className="p-2.5 text-muted">
                          {b ? (
                            <>
                              <strong className="block text-ink">
                                {b.emploi} · {b.groupName}
                              </strong>
                              <span className="block text-[9px]">
                                {b.monthCode} · {b.held}/{b.size} séances
                              </span>
                            </>
                          ) : (
                            (pay.months ?? []).map((m) => `${m.title} ${m.monthCode}`).join(" · ") ||
                            `${pay.sessionsCount} créneau(x)`
                          )}
                        </td>
                        <td className="p-2.5 text-center font-mono">
                          {b ? b.students.length : pay.studentsCount}
                        </td>
                        <td className="p-2.5 text-right font-mono text-success">
                          {b ? formatDA(b.studentsTotal) : formatDA(pay.gross ?? pay.amount)}
                        </td>
                        <td className="p-2.5 text-right font-mono text-primary">
                          {b
                            ? formatDA(b.arrearsTotal)
                            : formatDA((pay.arrears ?? []).reduce((t, a) => t + a.amount, 0))}
                        </td>
                        <td className="p-2.5 text-right font-mono text-danger">
                          −{" "}
                          {b
                            ? formatDA(b.deductionsTotal)
                            : formatDA(
                                (pay.expenses ?? []).reduce((t, x) => t + x.amount, 0) +
                                  (pay.acomptes ?? []).reduce((t, x) => t + x.amount, 0) +
                                  (pay.childDebts ?? []).reduce((t, x) => t + x.amount, 0) +
                                  (pay.childCharges ?? []).reduce((t, x) => t + x.amount, 0),
                              )}
                        </td>
                        <td className="p-2.5 text-right font-mono font-bold text-warning">
                          {formatDA(pay.amount)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-1.5 text-[10px] leading-relaxed text-muted">
              Un règlement se lit en trois tables : les <strong>élèves du mois</strong>, les{" "}
              <strong>arriérés rattrapés</strong> (des parts d&apos;un mois déjà réglé, libérées par
              un paiement tardif) et les <strong>retenues</strong> (dépenses, acomptes, scolarité
              des enfants). Le net versé est la somme des deux premières moins la troisième.
            </p>
          </div>
        )}

        {/* Séances libres de groupe — le détail derrière les deux mouvements */}
        {periodGroupSeances.length > 0 && (
          <div className="border-b border-line p-4">
            <h4 className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted">
              <UserCheck className="h-3.5 w-3.5 text-primary" /> Séances libres de groupe (
              {periodGroupSeances.length})
            </h4>
            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="w-full min-w-[760px] text-left text-[11px]">
                <thead className="bg-canvas/50">
                  <tr className="text-[9px] font-bold uppercase tracking-wider text-muted">
                    <th className="p-2.5">Date</th>
                    <th className="p-2.5">Séance</th>
                    <th className="p-2.5">Enseignant</th>
                    <th className="p-2.5 text-center">Élèves</th>
                    <th className="p-2.5 text-right">Prix / élève</th>
                    <th className="p-2.5 text-right">Encaissé</th>
                    <th className="p-2.5 text-right">École</th>
                    <th className="p-2.5 text-right">Enseignant</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {periodGroupSeances.map((g) => {
                    const t = groupSeanceTotals(g);
                    return (
                      <tr key={g.id}>
                        <td className="p-2.5">
                          <span className="block font-semibold text-ink">{formatDateFr(g.date)}</span>
                          <span className="block font-mono text-[9px] text-muted">
                            {g.startTime} → {g.endTime}
                          </span>
                        </td>
                        <td className="p-2.5">
                          <strong className="block text-ink">{g.title}</strong>
                          {g.description && (
                            <span className="block text-[9px] text-muted">{g.description}</span>
                          )}
                        </td>
                        <td className="p-2.5 text-muted">{teacherNameOf(g.teacherId)}</td>
                        <td className="p-2.5 text-center font-mono">{t.students}</td>
                        <td className="p-2.5 text-right font-mono">{formatDA(t.pricePerStudent)}</td>
                        <td className="p-2.5 text-right font-mono font-bold text-success">
                          {formatDA(t.total)}
                        </td>
                        <td className="p-2.5 text-right font-mono text-primary">
                          {formatDA(t.schoolTotal)}
                        </td>
                        <td className="p-2.5 text-right font-mono text-warning">
                          {formatDA(t.teacherTotal)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Transaction Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-canvas/50 border-b border-line text-muted font-bold text-[10px] uppercase tracking-wider">
                <th className="p-4 pl-6">Date / Heure</th>
                <th className="p-4">Type</th>
                <th className="p-4">Emploi du temps</th>
                <th className="p-4">Description</th>
                <th className="p-4">Détail de la pièce</th>
                <th className="p-4 text-right">Montant</th>
                <th className="p-4 text-right">Solde après</th>
                <th className="p-4 text-center pr-6 w-28">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {tabTxList.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-12 text-center text-muted italic bg-surface/30">
                    <div className="max-w-sm mx-auto flex flex-col items-center gap-2">
                      <AlertTriangle className="h-8 w-8 text-muted/65" />
                      <span className="block font-bold mt-1.5">Aucune transaction trouvée</span>
                      <span className="text-[11px] block text-muted/80 font-sans">
                        Aucune transaction ne correspond aux critères pour cette période.
                      </span>
                    </div>
                  </td>
                </tr>
              ) : (
                journalRows.map(({ tx, running }) => (
                  <tr key={tx.id} className="hover:bg-primary-50/10 transition-colors group">
                    <td className="p-4 pl-6 font-mono text-[10px] text-muted">
                      <div className="flex items-center gap-1.5">
                        <Calendar className="h-3.5 w-3.5 text-muted/70 shrink-0" />
                        <span>{tx.date.substring(0, 16).replace("T", " ")}</span>
                      </div>
                    </td>
                    <td className="p-4">{getTxTypeBadge(tx.type)}</td>
                    {/* SUR QUEL COURS CET ARGENT EST-IL PASSÉ ? La caisse ne le
                        disait nulle part : il fallait ouvrir la fiche de
                        l'élève ou celle de l'enseignant pour le savoir. */}
                    <td className="p-4 max-w-[220px]">
                      {(() => {
                        const emploi = emploiOfTx(tx);
                        if (!emploi)
                          return (
                            <span className="text-[10px] italic text-muted/60">
                              {noEmploiReason(tx)}
                            </span>
                          );
                        return (
                          <span title={emploi.hint}>
                            <strong
                              className={`block text-[11px] leading-tight ${
                                emploi.offSchedule ? "text-muted" : "text-ink"
                              }`}
                            >
                              <BookOpen
                                className={`mr-1 inline h-3 w-3 ${
                                  emploi.offSchedule ? "text-muted/60" : "text-primary"
                                }`}
                              />
                              {emploi.label}
                            </strong>
                            {emploi.note && (
                              <span
                                className={`block font-mono text-[9px] ${
                                  emploi.offSchedule ? "text-muted/70" : "text-primary"
                                }`}
                              >
                                {emploi.note}
                              </span>
                            )}
                            {emploi.hint && (
                              <span className="block text-[9px] leading-tight text-muted">
                                {emploi.hint}
                              </span>
                            )}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="p-4 font-semibold text-ink max-w-md truncate">{tx.description}</td>
                    <td className="p-4 text-[10px] text-muted max-w-xs">
                      {detailOf(tx) || <span className="italic text-muted/60">—</span>}
                    </td>
                    <td className={`p-4 text-right font-extrabold text-sm ${tx.amount > 0 ? "text-success" : "text-danger"}`}>
                      {tx.amount > 0 ? `+${formatDA(tx.amount)}` : formatDA(tx.amount)}
                    </td>
                    <td className="p-4 text-right font-mono text-[11px] text-muted">
                      {formatDA(running)}
                    </td>
                    <td className="p-4 text-center pr-6">
                      <div className="flex items-center justify-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                        {can("edit") && (
<button
                            onClick={() => openEdit(tx)}
                            className="p-1.5 rounded-lg hover:bg-primary-50 text-muted hover:text-primary transition-colors"
                            title="Modifier"
                          >
                            <Edit className="h-4 w-4" />
                          </button>
                        )}
                        {can("delete") && (
<button
                            onClick={() => handleDelete(tx)}
                            className="p-1.5 rounded-lg hover:bg-danger/10 text-muted hover:text-danger transition-colors"
                            title="Supprimer"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Deposit Modal */}
      <Modal open={isDepositOpen} onClose={() => setIsDepositOpen(false)} title="Nouveau dépôt en caisse">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Montant du dépôt (DA) *</label>
            <Input
              type="number"
              value={amount || ""}
              onChange={(e) => setAmount(Number(e.target.value))}
              placeholder="Ex: 10000"
              className="rounded-xl"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Description *</label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ex: Fonds de roulement ou apport initial"
              className="rounded-xl"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Date du dépôt *</label>
            <Input
              type="date"
              value={txDate}
              onChange={(e) => setTxDate(e.target.value)}
              className="rounded-xl"
            />
          </div>
          <div className="flex justify-end gap-2 pt-4 border-t border-line">
            <Button variant="outline" onClick={() => setIsDepositOpen(false)} className="rounded-xl">
              Annuler
            </Button>
            <Button onClick={handleDepositSubmit} className="rounded-xl">
              Confirmer le dépôt
            </Button>
          </div>
        </div>
      </Modal>

      {/* Withdraw Modal */}
      <Modal open={isWithdrawOpen} onClose={() => setIsWithdrawOpen(false)} title="Nouveau retrait de caisse">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Montant du retrait (DA) *</label>
            <Input
              type="number"
              value={amount || ""}
              onChange={(e) => setAmount(Number(e.target.value))}
              placeholder="Ex: 5000"
              className="rounded-xl"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1 font-sans">Description *</label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ex: Achat de papier ou fournitures"
              className="rounded-xl"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Date du retrait *</label>
            <Input
              type="date"
              value={txDate}
              onChange={(e) => setTxDate(e.target.value)}
              className="rounded-xl"
            />
          </div>
          <div className="flex justify-end gap-2 pt-4 border-t border-line">
            <Button variant="outline" onClick={() => setIsWithdrawOpen(false)} className="rounded-xl">
              Annuler
            </Button>
            <Button onClick={handleWithdrawSubmit} className="bg-danger hover:bg-danger/90 border-none rounded-xl">
              Confirmer le retrait
            </Button>
          </div>
        </div>
      </Modal>

      {/* Edit Modal */}
      <Modal open={isEditOpen} onClose={() => setIsEditOpen(false)} title="Modifier la transaction">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Type de transaction *</label>
            <Select
              value={editType}
              onChange={(e) => setEditType(e.target.value as CashTxType)}
              className="w-full rounded-xl"
            >
              <option value="deposit">Dépôt manuel</option>
              <option value="withdraw">Retrait manuel</option>
              <option value="expense">Dépense école</option>
              <option value="student_payment">Paiement élève</option>
              <option value="teacher_payment">Règlement prof / staff</option>
              <option value="acompte">Acompte prof</option>
              <option value="student_debt">Dette élève avancée par l’école</option>
            </Select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1 font-sans">Montant (DA) *</label>
            <Input
              type="number"
              value={editAmount || ""}
              onChange={(e) => setEditAmount(Number(e.target.value))}
              className="rounded-xl"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Description *</label>
            <Input
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              className="rounded-xl"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Date *</label>
            <Input
              type="date"
              value={editDate}
              onChange={(e) => setEditDate(e.target.value)}
              className="rounded-xl"
            />
          </div>
          <div className="flex justify-end gap-2 pt-4 border-t border-line">
            <Button variant="outline" onClick={() => setIsEditOpen(false)} className="rounded-xl">
              Annuler
            </Button>
            <Button onClick={handleSaveEdit} className="rounded-xl">
              Enregistrer
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/**
 * L'HISTORIQUE DES PAIEMENTS DES ÉLÈVES — le détail derrière la ligne de caisse.
 *
 * Le journal de caisse ne dit qu'une chose : « + 4 000 DA, Solde M2 — Amine
 * Benali ». C'est assez pour compter l'argent, jamais pour répondre à la
 * question qu'on pose vraiment six mois plus tard : QUI a payé, POUR QUEL
 * EMPLOI DU TEMPS, SUR QUEL MOIS, et QUAND exactement.
 *
 * Ce tableau lit donc les versements eux-mêmes (`payments`) plutôt que leur
 * reflet en caisse, et donne pour chacun l'élève et son numéro d'inscription,
 * le montant, la date ET l'heure, le mois de l'emploi du temps crédité, et
 * l'emploi du temps lui-même — avec son groupe, ses jours et ses heures.
 *
 * La provenance est dite en clair, car trois d'entre elles ne font PAS entrer
 * d'argent dans le tiroir : une scolarité retenue sur le salaire d'un père, une
 * scolarité portée en dette sur lui, et une dette avancée par l'école (dont la
 * sortie qui la finance est, elle, dans le journal).
 */
function StudentPaymentsHistory({
  from,
  to,
  query,
}: {
  from: string;
  to: string;
  query: string;
}) {
  const db = useData();
  const { payments, students, subscriptions, sessions } = db;
  const [source, setSource] = useState<"all" | PaymentSource>("all");

  const SOURCE_INFO: Record<PaymentSource, { label: string; style: string; hint: string }> = {
    cash: {
      label: "Famille (caisse)",
      style: "bg-success/15 text-success border border-success/30",
      hint: "Versé au guichet : l'argent est entré dans la caisse.",
    },
    teacher_salary: {
      label: "Retenu sur un salaire",
      style: "bg-primary-50 text-primary border border-primary/20",
      hint: "Scolarité d'un fils d'enseignant prise sur la paie de son père : aucun mouvement de caisse.",
    },
    teacher_debt: {
      label: "Porté sur un salaire",
      style: "bg-warning/15 text-warning border border-warning/30",
      hint: "Scolarité soldée d'avance au guichet et portée sur le salaire du père : elle sera retenue sur son prochain règlement.",
    },
    school_cash: {
      label: "Avancé par l'école",
      style: "bg-danger/15 text-danger border border-danger/30",
      hint: "L'école a couvert la dette sur sa propre caisse ; la sortie qui l'a financée est dans le journal.",
    },
  };

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return payments
      .filter((p) => {
        const day = p.date.substring(0, 10);
        if (day < from || day > to) return false;
        if (source !== "all" && (p.paidFrom ?? "cash") !== source) return false;
        if (!q) return true;
        const stu = students.find((s) => s.id === p.studentId);
        const sub = subscriptions.find((s) => s.id === p.subscriptionId);
        const ses = sub && sessions.find((s) => s.id === sub.sessionId);
        return [
          stu ? studentName(stu) : "",
          stu ? registrationNumberOf(db, stu) : "",
          ses ? ses.title || moduleName(db, ses.moduleId) : "",
          p.monthCode ?? "",
          p.description ?? "",
          String(p.amountPaid),
        ]
          .join(" ")
          .toLowerCase()
          .includes(q);
      })
      .sort((a, b) => b.date.localeCompare(a.date));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payments, students, subscriptions, sessions, from, to, query, source]);

  /** Ce que la période a réellement fait entrer dans le tiroir. */
  const cashedIn = rows
    .filter((p) => (p.paidFrom ?? "cash") === "cash")
    .reduce((s, p) => s + p.amountPaid, 0);
  const total = rows.reduce((s, p) => s + p.amountPaid, 0);

  return (
    <div className="border-b border-line p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted">
          <Receipt className="h-3.5 w-3.5 text-primary" /> Historique des paiements des élèves (
          {rows.length})
        </h4>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={source}
            onChange={(e) => setSource(e.target.value as typeof source)}
            className="h-8 text-[11px] rounded-xl"
          >
            <option value="all">Toutes provenances</option>
            <option value="cash">Famille (caisse)</option>
            <option value="teacher_salary">Retenu sur un salaire</option>
            <option value="teacher_debt">Porté sur un salaire</option>
            <option value="school_cash">Avancé par l&apos;école</option>
          </Select>
          <span className="rounded-xl border border-success/30 bg-success/10 px-2.5 py-1 text-[10px] font-bold text-success">
            {formatDA(cashedIn)} encaissés
          </span>
          {total !== cashedIn && (
            <span className="rounded-xl border border-line bg-canvas px-2.5 py-1 text-[10px] font-bold text-muted">
              {formatDA(total)} portés aux élèves
            </span>
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[900px] text-left text-[11px]">
          <thead className="bg-canvas/50">
            <tr className="text-[9px] font-bold uppercase tracking-wider text-muted">
              <th className="p-2.5">Date &amp; heure</th>
              <th className="p-2.5">Élève</th>
              <th className="p-2.5">Emploi du temps</th>
              <th className="p-2.5">Mois payé</th>
              <th className="p-2.5">Provenance</th>
              <th className="p-2.5">Libellé</th>
              <th className="p-2.5 text-right">Montant</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-8 text-center italic text-muted">
                  Aucun paiement d&apos;élève sur cette période.
                </td>
              </tr>
            ) : (
              rows.map((p) => {
                const stu = students.find((s) => s.id === p.studentId);
                const sub = subscriptions.find((s) => s.id === p.subscriptionId);
                const ses = sub && sessions.find((s) => s.id === sub.sessionId);
                const info = SOURCE_INFO[(p.paidFrom ?? "cash") as PaymentSource];
                return (
                  <tr key={p.id} className="hover:bg-primary-50/10">
                    <td className="p-2.5 font-mono text-[10px] text-muted">
                      <span className="block text-ink">{formatDateFr(p.date.substring(0, 10))}</span>
                      <span className="block">{p.date.substring(11, 16) || "—"}</span>
                    </td>
                    <td className="p-2.5">
                      <strong className="block text-ink">
                        {stu ? studentName(stu) : "Élève supprimé"}
                      </strong>
                      <span className="block font-mono text-[9px] text-muted">
                        {stu ? `N° ${registrationNumberOf(db, stu)}` : "—"}
                        {stu?.phone ? ` · ${stu.phone}` : ""}
                      </span>
                    </td>
                    <td className="p-2.5">
                      {ses ? (
                        <>
                          <strong className="block text-ink">
                            {ses.title || moduleName(db, ses.moduleId) || "Emploi du temps"}
                            {ses.archivedAt && (
                              <span className="ml-1 rounded bg-canvas px-1 py-0.5 text-[8px] font-bold text-muted">
                                supprimé
                              </span>
                            )}
                          </strong>
                          <span className="block text-[9px] text-muted">
                            Groupe {groupName(db, ses.groupId)} · {formatDays(ses.days) || "—"} ·{" "}
                            <span className="font-mono">{sessionTimeLabel(ses)}</span>
                          </span>
                        </>
                      ) : (
                        <span className="italic text-muted">Hors emploi du temps</span>
                      )}
                    </td>
                    <td className="p-2.5 font-mono">
                      {p.monthCode ? monthCodeLabel(p.monthCode) : "—"}
                    </td>
                    <td className="p-2.5">
                      <span
                        title={info.hint}
                        className={`rounded-xl px-2 py-1 text-[9px] font-bold ${info.style}`}
                      >
                        {info.label}
                      </span>
                    </td>
                    <td className="p-2.5 max-w-[260px] truncate text-muted">
                      {p.description || "—"}
                      {p.rest > 0 && (
                        <span className="ml-1 font-bold text-danger">
                          (reste {formatDA(p.rest)})
                        </span>
                      )}
                    </td>
                    <td className="p-2.5 text-right font-mono font-extrabold text-success">
                      {formatDA(p.amountPaid)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

