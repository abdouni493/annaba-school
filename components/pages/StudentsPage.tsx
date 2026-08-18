"use client";

import { useState, useEffect } from "react";
import { useData, uid } from "@/lib/store/data";
import { deleteRoleUser, resetUserPassword } from "@/lib/accounts/users";
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
  Search,
  Printer,
  User,
  BookOpen,
  History,
  CheckCircle,
  Scan,
  Bell,
  Send,
  AlertTriangle,
  MessageCircle,
  Repeat,
  Wallet,
} from "lucide-react";
import type {
  AbsencePenalty,
  AttendanceRecord,
  AttendanceStatus,
  Student,
  SubscriptionPlan,
} from "@/lib/types";
import {
  daysUntil,
  discountLabel,
  enrollmentLabel,
  formatDateFr,
  formatDays,
  monthlyPriceOf,
  netPriceFor,
  remainingSeances,
  studentDebt,
  studentEnrollments,
  studentPayments,
  totalRemainingSeances,
  EXPIRY_WARNING_DAYS,
} from "@/lib/helpers";
import { useSettings } from "@/lib/store/settings";
import { printHtmlDocument } from "@/lib/print";
import { buildStudentPaymentsReport } from "@/lib/reports/studentPayments";
import { speakMessage, speechCaseForScan } from "@/lib/speech";
import { useToast } from "@/lib/store/toast";
import {
  WhatsAppMessageModal,
  type WhatsAppRecipient,
  type WhatsAppStudentContext,
} from "@/components/whatsapp/WhatsAppMessageModal";
import { isSendablePhone } from "@/lib/whatsapp/phone";
import { buildBalanceAlert } from "@/lib/whatsapp/alert";
import {
} from "@/components/students/ClassTimingPicker";
import { CreateStudentModal } from "@/components/students/CreateStudentModal";
import { formatDA } from "@/lib/utils";
import { SoldManagerModal } from "@/components/students/SoldManagerModal";
import {
  cycleSizeOf,
  currentCycleIndex,
  enrollmentCycles,
  registrationNumberOf,
  soldFor,
  soldStatus,
  studentCaseLabel,
  studentCaseTone,
  studentMatches,
  studentSoldDebt,
} from "@/lib/helpers";

export function StudentsPage() {
  const db = useData();
  const {
    school,
    students,
    subscriptions,
    sessions,
    classes,
    modules,
    teachers,
    groups,
    salles,
    coursework,
    enrollments,
    payments,
    attendance,
    absencePenalties,
    parents,
    classCategories,
    studentCredentials,
    push,
    deleteFrom,
    updateItem,
    scanCard,
    cancelAttendance,
    updateAttendance,
    deleteAbsencePenalty,
    setStudentPassword,
  } = db;

  const { language, autoSendWhatsapp, autoSendEmail, setAutoSendWhatsapp, setAutoSendEmail } = useSettings();
  const { addToast } = useToast();

  // Search & Filtering
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<"all" | "debt" | "paid" | "free" | "soon">("all");

  // Modals
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  /** "Payer & recharger" — the ONE money action of a card. */
  const [soldStudent, setSoldStudent] = useState<Student | null>(null);
  const [isScanOpen, setIsScanOpen] = useState(false);
  const [isAlertLowBalanceOpen, setIsAlertLowBalanceOpen] = useState(false);
  const [selectedAlertStudentIds, setSelectedAlertStudentIds] = useState<string[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);

  // WhatsApp — fenêtre d'envoi partagée par les boutons « élève » et « parent »
  const [waTarget, setWaTarget] = useState<{
    recipients: WhatsAppRecipient[];
    students: WhatsAppStudentContext[];
    defaultRecipientIds: string[];
  } | null>(null);
  const [sendingAlerts, setSendingAlerts] = useState(false);

  // Form: Create/Edit Student
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [phone, setPhone] = useState("");
  const [rfid, setRfid] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isFree, setIsFree] = useState(false);
  const [isEmailDirty, setIsEmailDirty] = useState(false);
  const [isPasswordDirty, setIsPasswordDirty] = useState(false);

  // ---- Student billing case (normal by default) ---------------------------

  // Form: inscriptions taken WHILE creating the student — reception searches the
  // student's class, the class opens its timings, and one or several of them are
  // ticked. Each ticked timing is one inscription, stored on the new student
  // exactly like the "Affecter des abonnements" modal stores them.

  // Form: the first recharge, paid at the desk on the same screen. It credits ONE
  // of the inscriptions above and is written to the student's payment history
  // through the very same store action the "Payer des séances" modal uses.

  // Form: renewing an inscription (replaces the old money "recharge")
  /** the renewal screen shows the student's own inscriptions; this opens the
   *  rest of the catalogue, for the rarer "sell him a new module" case */
  // "seance" = N séances at the unit price · "month" = one whole month, which
  // starts on `buyStartDate` and expires exactly one month later.

  // Form: Pay Debt

  // Print Confirm Modal Data
  const [printConfirmData, setPrintConfirmData] = useState<{
    student: Student;
    amount: number;
    description: string;
    settledReg: boolean;
    seances: number;
    /** "month" = a whole month was bought, not a handful of séances */
    plan: SubscriptionPlan;
    /** monthly purchase: the day the month stops being valid */
    expiryDate?: string;
    moduleLabel: string;
    unitPrice: number;
    grossTotal: number;
    netTotal: number;
    discountLabel: string;
    rest: number;
  } | null>(null);

  // Print payments over a period (same flow as the teacher report)
  const [isPrintPayOpen, setIsPrintPayOpen] = useState(false);
  const [printPayStart, setPrintPayStart] = useState("");
  const [printPayEnd, setPrintPayEnd] = useState("");

  // Form: Assign subscription/coursework (the class search lives in the picker)
  // Per-module reduction: subscription id -> { type, value }
  // "Réduction groupée": one reduction applied at once to every ticked module

  // Active overlay actions index
  const [overlayStudentId, setOverlayStudentId] = useState<string | null>(null);

  // Scanner state
  const [scanRfidInput, setScanRfidInput] = useState("");
  const [scanResult, setScanResult] = useState<{
    ok: boolean;
    studentName?: string;
    /** séances left on the inscription the badge was matched to */
    remaining?: number;
    consumed?: boolean;
    msg?: string;
  } | null>(null);

  // Tab state in Details modal
  const [detailsTab, setDetailsTab] = useState<"personal" | "subs" | "payments" | "attendance">("personal");

  // Details modal filters — transactions per module; presences per module and
  // per date (by month or custom period)
  const [txModuleFilter, setTxModuleFilter] = useState<string>("all");
  const [attModuleFilter, setAttModuleFilter] = useState<string>("all");
  const [attDateMode, setAttDateMode] = useState<"all" | "month" | "range">("all");
  const [attMonth, setAttMonth] = useState("");
  const [attStart, setAttStart] = useState("");
  const [attEnd, setAttEnd] = useState("");
  const [attKindFilter, setAttKindFilter] = useState<"all" | "present" | "absent">("all");

  // Correcting one presence / removing one billed absence
  const [editingAtt, setEditingAtt] = useState<AttendanceRecord | null>(null);
  const [deletingAtt, setDeletingAtt] = useState<AttendanceRecord | null>(null);
  const [deletingPen, setDeletingPen] = useState<AbsencePenalty | null>(null);
  const [attEditStatus, setAttEditStatus] = useState<AttendanceStatus>("present");
  const [attEditDate, setAttEditDate] = useState("");
  const [attEditAmount, setAttEditAmount] = useState<number>(0);
  const [attBusy, setAttBusy] = useState(false);

  // The selected student is a snapshot: re-sync it after every store change
  // (scan, purchase) so the detail view never shows stale data.
  useEffect(() => {
    if (!selectedStudent) return;
    const fresh = students.find((s) => s.id === selectedStudent.id);
    if (fresh && fresh !== selectedStudent) setSelectedStudent(fresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [students]);

  /** Modules assigned to a student (via his subscriptions), for the filters. */
  const getStudentModuleOptions = (stu: Student) => {
    const map = new Map<string, string>();
    stu.subscriptionIds.forEach((subId) => {
      const sub = subscriptions.find((s) => s.id === subId);
      const sess = sub ? sessions.find((se) => se.id === sub.sessionId) : undefined;
      if (!sess) return;
      const mod = modules.find((m) => m.id === sess.moduleId);
      if (mod) map.set(mod.id, mod.name);
    });
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  };

  // Helpers
  const getModuleLabel = (subId: string) => {
    const sub = subscriptions.find((s) => s.id === subId);
    if (!sub) {
      const cw = coursework.find((c) => c.id === subId);
      if (cw) return `Stage: ${cw.name}`;
      return "Abonnement inconnu";
    }
    const s = sessions.find((se) => se.id === sub.sessionId);
    if (!s) return "Séance inconnue";
    const mod = modules.find((m) => m.id === s.moduleId)?.name ?? "Module";
    const cls = classes.find((c) => c.id === s.classId);
    if (!cls) return mod;
    const level = cls.coursLevel || cls.formationLevel || "";
    const cat = classCategories.find((c) => c.id === cls.categoryId)?.name ?? "";

    const classNameClean = cls.name || "";

    const parts: string[] = [];
    if (classNameClean) parts.push(classNameClean);
    if (level) parts.push(level);
    if (cat) parts.push(cat);

    return `${mod} (${parts.join(" - ")})`;
  };

  /** The timing an inscription was taken on — the créneau ticked when the
   *  student was enrolled: group, days, hours, salle and teacher. */
  const getTimingLabel = (subId: string) => {
    const sub = subscriptions.find((s) => s.id === subId);
    const s = sub ? sessions.find((se) => se.id === sub.sessionId) : undefined;
    if (!s) return "";
    const t = teachers.find((te) => te.id === s.teacherId);
    return [
      groups.find((g) => g.id === s.groupId)?.name,
      `${formatDays(s.days) || "—"} · ${s.startTime}-${s.endTime}`,
      salles.find((sl) => sl.id === s.salleId)?.name,
      t ? `${t.firstName} ${t.lastName}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
  };

  /** Expiry info for every formation enrollment of the student (dates only exist for formations). */
  const getFormationExpiries = (stu: Student) =>
    stu.subscriptionIds.flatMap((subId) => {
      const dates = stu.subscriptionDates?.[subId];
      if (!dates?.expiryDate) return [];
      return [
        {
          subId,
          label: getModuleLabel(subId),
          startDate: dates.startDate,
          expiryDate: dates.expiryDate,
          daysLeft: daysUntil(dates.expiryDate),
        },
      ];
    });

  /** The formula an inscription is taken on, capped by what the tariff offers. */
  // Auto-generate credentials when firstName, lastName, or birthDate changes in the creation modal
  useEffect(() => {
    if (isCreateOpen) {
      // Login credentials are generated silently — reception no longer types an
      // email or a password. Birthdate is optional, so a short numeric suffix
      // keeps the auto-password at least 6 chars long even without one.
      const cleanedFirst = firstName.trim().toLowerCase().replace(/\s+/g, "");
      const cleanedLast = lastName.trim().toLowerCase().replace(/\s+/g, "");
      const cleanedBirth = birthDate.replace(/-/g, "");
      const suffix = cleanedBirth || (phone.replace(/\D/g, "").slice(-4) || "0000");

      if (cleanedFirst && cleanedLast) {
        if (!isEmailDirty) {
          setEmail(`${cleanedFirst}${cleanedLast}${suffix}@elilm.com`);
        }
        if (!isPasswordDirty) {
          setPassword(`${cleanedFirst}${cleanedLast}${suffix}`);
        }
      } else {
        if (!isEmailDirty) {
          setEmail("");
        }
        if (!isPasswordDirty) {
          setPassword("");
        }
      }
    }
  }, [firstName, lastName, birthDate, phone, isCreateOpen, isEmailDirty, isPasswordDirty]);

  /** Money left across every emploi du temps — his soldes added up. */
  const remainingFor = (student: Student) =>
    student.subscriptionIds.reduce((t, subId) => t + soldFor(db, student.id, subId), 0);
  const debtFor = (student: Student) => studentDebt(db, student.id);

  /** How many séances his soldes still cover — what the WhatsApp templates
   *  speak in (they count séances, not dinars). */
  const seancesLeftFor = (student: Student) =>
    student.subscriptionIds.reduce((t, subId) => {
      const unit = subscriptions.find((x) => x.id === subId)?.pricePerSession ?? 0;
      const sold = soldFor(db, student.id, subId);
      return t + (unit > 0 ? Math.max(0, Math.floor(sold / unit)) : 0);
    }, 0);

  /** At least one emploi du temps whose solde no longer covers two séances —
   *  the alert reception relaunches families on. */
  const isSoonToRunOut = (student: Student) => {
    if (student.isFree) return false;
    if (student.subscriptionIds.length === 0) return false;
    return student.subscriptionIds.some((subId) => {
      const sub = subscriptions.find((x) => x.id === subId);
      const st = soldStatus(soldFor(db, student.id, subId), sub?.pricePerSession ?? 0);
      return st !== "ok";
    });
  };

  // Filter students based on queries
  const getFilteredStudents = () => {
    return students.filter((s) => {
      // One box: name, phone, e-mail — or the registration number ("12" finds
      // 00012), which is how the desk actually looks a student up.
      const matchesSearch =
        studentMatches(db, s, searchQuery) ||
        s.email.toLowerCase().includes(searchQuery.trim().toLowerCase());

      if (!matchesSearch) return false;

      if (filterType === "debt") return debtFor(s) > 0 || (s.registrationDue ?? 0) > 0;
      if (filterType === "paid") return debtFor(s) === 0 && (s.registrationDue ?? 0) === 0;
      if (filterType === "free") return s.isFree;
      if (filterType === "soon") return isSoonToRunOut(s);

      return true;
    });
  };

  const handleEditStudent = async () => {
    if (!selectedStudent) return;

    if (password) {
      try {
        await resetUserPassword(selectedStudent.id, password);
        // Mirror the new password into the staff-only table so the receipt
        // keeps printing credentials that actually work.
        await setStudentPassword(selectedStudent.id, password);
      } catch (err) {
        alert(err instanceof Error ? err.message : "Erreur lors du changement de mot de passe.");
        return;
      }
    }

    updateItem("students", selectedStudent.id, {
      firstName,
      lastName,
      birthDate,
      phone,
      email,
      rfid,
      isFree,
    });
    setIsEditOpen(false);
    resetForm();
  };

  const openSoldManager = (stu: Student) => {
    setSoldStudent(stu);
    setOverlayStudentId(null);
  };

  const handleDelete = (id: string) => {
    if (confirm("Êtes-vous sûr de vouloir supprimer cet étudiant ?")) {
      deleteFrom("students", id);
      void deleteRoleUser(id);
      setOverlayStudentId(null);
    }
  };

  /** Priced modules the student is NOT on yet: paying one here enrolls him,
   *  so the renewal screen doubles as a desk sale when needed. */
  const handleSettleRegistrationCost = (student: Student) => {
    if (!student.registrationDue) return;
    if (confirm(`Marquer les frais d'inscription de ${student.registrationDue} DA comme réglés ?`)) {
      updateItem("students", student.id, { registrationDue: 0 });
    }
  };

  // ---- Correcting the presence history ---------------------------------------
  // A presence carries money (it debited the séance), so editing/removing one
  // has to move the balance back by the same amount — both live in a server-side
  // RPC (update_attendance / cancel_attendance) for that reason.
  const openEditAtt = (att: AttendanceRecord) => {
    setEditingAtt(att);
    setAttEditStatus(att.status);
    setAttEditDate(att.timestamp.substring(0, 16));
    setAttEditAmount(att.amountDeducted);
  };

  const closeAttModals = () => {
    setEditingAtt(null);
    setDeletingAtt(null);
    setDeletingPen(null);
    setAttBusy(false);
  };

  /** `datetime-local` value -> ISO. The list renders the raw timestamp, so the
   *  edit box works on the very same string (what you see is what you edit). */
  const dtInputToIso = (value: string) =>
    value.length === 16 ? `${value}:00.000Z` : new Date(value).toISOString();

  const handleUpdateAtt = async () => {
    if (!editingAtt || !attEditDate) return;
    setAttBusy(true);
    const res = await updateAttendance(editingAtt.id, {
      status: attEditStatus,
      occurredAt: dtInputToIso(attEditDate),
      amount: Math.max(0, Math.round(attEditAmount || 0)),
    });
    setAttBusy(false);
    if (!res.ok) {
      addToast({
        type: "danger",
        title: "Modification impossible",
        message:
          res.messageKey === "attendance.duplicateDay"
            ? "Une présence existe déjà pour cet élève sur ce créneau à cette date."
            : "La présence n'a pas pu être modifiée.",
      });
      return;
    }
    addToast({
      type: "success",
      title: "Présence modifiée",
      message: `Prix de la séance retenu pour la part enseignant : ${res.cost ?? 0} DA.`,
    });
    closeAttModals();
  };

  const handleDeleteAtt = async () => {
    if (!deletingAtt) return;
    setAttBusy(true);
    const res = await cancelAttendance(deletingAtt.id);
    setAttBusy(false);
    if (!res.ok) {
      addToast({ type: "danger", title: "Suppression impossible", message: "La présence n'a pas pu être supprimée." });
      return;
    }
    addToast({
      type: "success",
      title: "Présence supprimée",
      message: (res.refunded ?? 0) > 0
        ? `1 séance recréditée — ${res.remaining ?? 0} séance(s) restante(s).`
        : "Présence supprimée (aucune séance à recréditer).",
    });
    closeAttModals();
  };

  const handleDeletePenalty = async () => {
    if (!deletingPen) return;
    setAttBusy(true);
    const res = await deleteAbsencePenalty(deletingPen.id);
    setAttBusy(false);
    if (!res.ok) {
      addToast({ type: "danger", title: "Suppression impossible", message: "L'absence n'a pas pu être supprimée." });
      return;
    }
    addToast({
      type: "success",
      title: "Absence supprimée",
      message: `${res.refunded ?? 0} DA remboursés sur la facturation d'absence.`,
    });
    closeAttModals();
  };

  const handleScanCard = async () => {
    if (!scanRfidInput) return;
    const res = await scanCard(scanRfidInput);
    const matchedStu = students.find((s) => s.rfid === scanRfidInput || s.id === scanRfidInput);

    // Voice verdict (good / low / expired) once the check-in RPC answered.
    const speechCase = speechCaseForScan(res);
    if (speechCase) {
      speakMessage(speechCase, matchedStu ? `${matchedStu.firstName} ${matchedStu.lastName}` : "", language);
    }

    if (res.ok && matchedStu) {
      const seance = res.moduleName
        ? ` — ${res.moduleName}${res.groupName ? ` (${res.groupName})` : ""}${res.sessionStart ? ` (${res.sessionStart} - ${res.sessionEnd})` : ""}`
        : "";
      // Attended another group of the same cours: allowed, billed normally.
      const substitution = res.otherGroup
        ? ` Rattrapage sur le groupe ${res.groupName ?? "suivi"}${res.ownGroupName ? ` (inscrit en ${res.ownGroupName})` : ""}.`
        : "";
      setScanResult({
        ok: true,
        studentName: `${matchedStu.firstName} ${matchedStu.lastName}`,
        remaining: res.remaining,
        consumed: (res.cost ?? 0) > 0,
        msg: (res.messageKey === "scan.alreadyPresent"
          ? "Élève déjà marqué présent pour cette séance aujourd'hui (aucune séance décomptée)."
          : res.outOfSeances
          ? `Présence enregistrée${seance} — ATTENTION: aucune séance restante, à régulariser à la réception.`
          : res.messageKey === "scan.successLate"
          ? `Présence enregistrée (en retard)${seance}.`
          : `Présence validée — 1 séance décomptée${seance}.`) + substitution,
      });
    } else {
      const failureMsgs: Record<string, string> = {
        "scan.noSession": "Aucune séance programmée à cette heure.",
        "scan.noSessionToday": "Aucune séance de son niveau/module aujourd'hui.",
        "scan.noSessionNow": "Ce n'est pas l'heure de la séance de cet élève.",
        "scan.tooEarly": `Trop tôt — la séance n'a pas encore commencé.${res.nextStart ? ` Prochaine séance à ${res.nextStart}.` : ""}`,
        "scan.sessionEnded": "Séance déjà terminée — scan refusé, l'élève reste absent.",
        "scan.subscriptionExpired": "Abonnement EXPIRÉ pour ce module — carte refusée.",
        "scan.notEligible": "La séance en cours est d'un autre niveau ou d'un module non affecté à cet élève.",
        "scan.cooldown": "Déjà enregistré sur cette séance — passage ignoré (moins de 30 min depuis le dernier scan sur ce créneau).",
        "scan.notFound": "Carte introuvable.",
        "scan.error": "Erreur lors du scan — réessayez.",
      };
      setScanResult({
        ok: false,
        studentName: matchedStu ? `${matchedStu.firstName} ${matchedStu.lastName}` : "Étudiant inconnu",
        msg: failureMsgs[res.messageKey] ?? "Carte introuvable.",
      });
    }
    setScanRfidInput("");
  };

  /** Clears the edit form. Creation lives in its own component now. */
  const resetForm = () => {
    setFirstName("");
    setLastName("");
    setBirthDate("");
    setPhone("");
    setRfid("");
    setEmail("");
    setPassword("");
    setIsFree(false);
    setSelectedStudent(null);
    setIsEmailDirty(false);
    setIsPasswordDirty(false);
  };

  const openEdit = (stu: Student) => {
    setSelectedStudent(stu);
    setFirstName(stu.firstName);
    setLastName(stu.lastName);
    setBirthDate(stu.birthDate);
    setPhone(stu.phone);
    setRfid(stu.rfid);
    setEmail(stu.email);
    setPassword("");
    setIsFree(stu.isFree);
    setIsEditOpen(true);
    setOverlayStudentId(null);
  };

  const openDetails = (stu: Student) => {
    setSelectedStudent(stu);
    setDetailsTab("personal");
    setTxModuleFilter("all");
    setAttModuleFilter("all");
    setAttDateMode("all");
    setAttMonth("");
    setAttStart("");
    setAttEnd("");
    setIsDetailsOpen(true);
    setOverlayStudentId(null);
  };

  /** Ouvre l'envoi WhatsApp pour un élève. Les deux numéros (élève et parent
   *  rattaché) sont toujours proposés ; `focus` détermine celui coché d'emblée,
   *  pour pouvoir prévenir les deux en une fois sans rouvrir la fenêtre. */
  const openWhatsApp = (stu: Student, focus: "student" | "parent") => {
    const parent = parents.find((p) => p.id === stu.parentId);
    const studentName = `${stu.firstName} ${stu.lastName}`;

    const recipients: WhatsAppRecipient[] = [
      { id: `student-${stu.id}`, name: studentName, phone: stu.phone, role: "student" },
    ];
    if (parent) {
      recipients.push({
        id: `parent-${parent.id}`,
        name: `${parent.firstName} ${parent.lastName}`,
        phone: parent.phone,
        role: "parent",
      });
    }

    setWaTarget({
      recipients,
      students: [
        {
          id: stu.id,
          name: studentName,
          remainingSeances: seancesLeftFor(stu),
          debt: debtFor(stu),
          registrationDue: stu.registrationDue,
        },
      ],
      defaultRecipientIds: [
        focus === "parent" && parent ? `parent-${parent.id}` : `student-${stu.id}`,
      ],
    });
    setOverlayStudentId(null);
  };

  /** Alertes de séances en lot : notification dans l'application pour tous, plus
   *  un WhatsApp personnalisé par élève — au parent rattaché s'il en a un,
   *  sinon à l'élève lui-même. */
  const handleSendLowBalanceAlerts = async () => {
    const selected = selectedAlertStudentIds
      .map((id) => students.find((s) => s.id === id))
      .filter((s): s is Student => Boolean(s));
    if (selected.length === 0) return;

    setSendingAlerts(true);

    const nowIso = new Date().toISOString();
    selected.forEach((stu) => {
      push("notifications", {
        id: uid("ntf"),
        parentId: stu.parentId ?? "",
        title: "Alerte : solde bientôt épuisé",
        description: `Rappel de paiement: ${stu.firstName} ${stu.lastName} n'a plus que ${formatDA(remainingFor(stu))} de solde (${seancesLeftFor(stu)} séance(s) couverte(s)). Merci de recharger à la réception pour éviter toute interruption.`,
        date: nowIso,
        read: false,
        auto: false,
      });
    });

    const msgLang = language === "ar" ? "ar" : "fr";
    // Même résolution destinataire + modèle que l'alerte automatique du scan
    // (lib/whatsapp/alert) : le parent rattaché s'il est joignable, sinon
    // l'élève. `low: true` — ce bouton EST l'alerte « séances bientôt épuisées »,
    // qui exige un modèle approuvé par Meta (message proactif).
    const waRecipients = selected.flatMap((stu) => {
      const parent = parents.find((p) => p.id === stu.parentId);
      const payload = buildBalanceAlert({
        student: {
          ...stu,
          remainingSeances: seancesLeftFor(stu),
          debt: debtFor(stu),
        },
        parent,
        school,
        lang: msgLang,
        low: true,
      });
      return payload ? [payload] : [];
    });

    if (waRecipients.length === 0) {
      setSendingAlerts(false);
      setIsAlertLowBalanceOpen(false);
      addToast({
        type: "warning",
        title: "Alertes enregistrées",
        message: `${selected.length} notification(s) créée(s) dans l'application, mais aucun numéro exploitable pour un envoi WhatsApp.`,
      });
      return;
    }

    // Mode démo : les notifications internes sont bien créées, mais aucun
    // message ne part — il n'y a pas de passerelle WhatsApp branchée.
    addToast({
      type: "info",
      title: "WhatsApp désactivé en mode démo",
      message: `${selected.length} notification(s) créée(s) dans l'application. ${waRecipients.length} destinataire(s) auraient été contactés par WhatsApp.`,
    });
    setIsAlertLowBalanceOpen(false);
    setSendingAlerts(false);
  };

  const openPrintPayments = (stu: Student) => {
    setSelectedStudent(stu);
    setPrintPayStart("");
    setPrintPayEnd("");
    setIsPrintPayOpen(true);
    setOverlayStudentId(null);
  };

  const handlePrintPayments = () => {
    if (!selectedStudent) return;
    printHtmlDocument(
      buildStudentPaymentsReport({
        student: selectedStudent,
        school,
        lang: language,
        startDate: printPayStart,
        endDate: printPayEnd,
        payments,
        enrollments,
        subscriptions,
        sessions,
        classes,
        modules,
        groups,
        parents,
      }),
    );
    setIsPrintPayOpen(false);
  };

  /** Stages ("coursework") are not timings of a class: they are sold whole, so
   *  they keep their own flat list next to the class picker. */
  const handlePrintStudent = (stu: Student) => {
    const studentPays = studentPayments(db, stu.id);
    const studentEnr = studentEnrollments(db, stu.id);
    const parentObj = parents.find((p) => p.id === stu.parentId);

    // Get detailed subscriptions
    const subDetails = stu.subscriptionIds.map((subId) => {
      const sub = subscriptions.find((s) => s.id === subId);
      const sess = sub ? sessions.find((se) => se.id === sub.sessionId) : null;
      const cl = sess ? classes.find((c) => c.id === sess.classId) : null;
      const mod = sess ? modules.find((m) => m.id === sess.moduleId) : null;
      const t = sess ? teachers.find((te) => te.id === sess.teacherId) : null;
      const gr = sess ? groups.find((g) => g.id === sess.groupId) : null;
      const sa = sess ? salles.find((sl) => sl.id === sess.salleId) : null;

      const daysMapping: Record<string, string> = {
        sunday: "Dimanche",
        monday: "Lundi",
        tuesday: "Mardi",
        wednesday: "Mercredi",
        thursday: "Jeudi",
        friday: "Vendredi",
        saturday: "Samedi",
      };

      const daysText = sess ? sess.days.map(d => daysMapping[d] || d).join(", ") : "-";
      const schedule = sess ? `${daysText} (${sess.startTime} - ${sess.endTime})` : "-";

      return {
        moduleName: mod?.name ?? "-",
        className: cl?.name ?? "-",
        teacherName: t ? `${t.firstName} ${t.lastName}` : "-",
        groupName: gr?.name ?? "-",
        salleName: sa?.name ?? "-",
        price: sub?.pricePerSession ?? 0,
        schedule,
      };
    });

    // Get attendance records
    const studentAttendance = attendance.filter((a) => a.studentId === stu.id);
    // Automatic weekly-absence charges (shown in the presence table too).
    const studentPenalties = absencePenalties.filter((p) => p.studentId === stu.id);

    // Financial + séance totals
    const totalPaid = studentPays.reduce((sum, p) => sum + p.amountPaid, 0);
    const totalSeancesBought = studentPays.reduce((sum, p) => sum + p.seancesPurchased, 0);
    const totalRemaining = studentEnr.reduce((sum, e) => sum + remainingSeances(e), 0);
    const totalConsumed = studentEnr.reduce((sum, e) => sum + e.consumedSeances, 0);
    const currentDebt = studentDebt(db, stu.id);

    const formatDate = (dateStr: string) => {
      if (!dateStr) return "";
      const d = new Date(dateStr);
      return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
    };

    const formatDateTime = (dateStr: string) => {
      if (!dateStr) return "";
      const d = new Date(dateStr);
      return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }) + " à " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    };

    const logoHtml = school.logo
      ? `<img src="${school.logo}" alt="logo" class="school-logo" />`
      : `<div class="school-logo-fallback">🏫</div>`;

    const html = `
      <html>
        <head>
          <title>Fiche Étudiant - ${stu.firstName} ${stu.lastName}</title>
          <style>
            @media print {
              body { padding: 0; margin: 0; background: #fff; color: #000; font-size: 11px; }
              .no-print { display: none; }
              .page-break { page-break-before: always; }
            }
            * { box-sizing: border-box; }
            body { font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; padding: 25px; color: #1e1b4b; background-color: #faf9ff; }
            
            /* Letterhead Header */
            .letterhead { display: flex; justify-content: space-between; align-items: stretch; border: 1px solid #e8e6f4; background: #fff; padding: 15px; border-radius: 12px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); }
            .school-identity { display: flex; align-items: center; gap: 15px; }
            .school-logo, .school-logo-fallback { width: 65px; height: 65px; border-radius: 12px; object-fit: cover; }
            .school-logo-fallback { background: #f5f3ff; border: 1px solid #ddd; display: flex; align-items: center; justify-content: center; font-size: 2.2em; }
            .school-details h2 { margin: 0; font-size: 1.4em; color: #7c3aed; font-weight: 800; }
            .school-details p { margin: 2px 0; font-size: 0.85em; color: #5c567a; }
            
            .school-tax-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 10px; border-left: 2px solid #7c3aed; padding-left: 15px; align-items: center; }
            .tax-item { font-size: 0.78em; color: #5c567a; }
            .tax-item strong { color: #1e1b4b; font-family: monospace; }
            
            /* Document title banner */
            .doc-title-banner { background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%); color: #fff; padding: 15px; border-radius: 12px; margin-bottom: 20px; text-align: center; }
            .doc-title-banner h1 { margin: 0; font-size: 1.5em; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; }
            .doc-title-banner p { margin: 5px 0 0; font-size: 0.9em; opacity: 0.9; }

            /* Grid Layout of Frames */
            .frames-grid { display: grid; grid-template-columns: 1fr; gap: 20px; }
            .frame { border: 1px solid #e8e6f4; border-top: 4px solid #7c3aed; background: #fff; padding: 16px; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); }
            .frame-info { border-top-color: #3b82f6; }
            .frame-success { border-top-color: #22c55e; }
            .frame h3 { margin: 0 0 12px; font-size: 1.05em; color: #1e1b4b; border-bottom: 1px dashed #e8e6f4; padding-bottom: 6px; }
            
            /* Tables styled inside frames */
            table { width: 100%; border-collapse: collapse; margin-top: 5px; font-size: 0.9em; }
            th, td { padding: 8px 10px; text-align: left; border-bottom: 1px solid #f1f0fb; }
            th { background-color: #fcfbff; font-weight: 700; color: #5c567a; font-size: 0.8em; text-transform: uppercase; letter-spacing: 0.3px; }
            tr:last-child td { border-bottom: 0; }
            
            /* Badges */
            .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 0.75em; font-weight: bold; text-align: center; }
            .badge-primary { background-color: #f5f3ff; color: #7c3aed; }
            .badge-success { background-color: #dcfce7; color: #15803d; }
            .badge-danger { background-color: #fee2e2; color: #b91c1c; }
            .badge-warning { background-color: #fef9c3; color: #854d0e; }
            
            /* Account Card */
            .summary-card { background: #fdfcff; border: 2px solid #7c3aed; border-radius: 12px; padding: 15px; margin-top: 20px; }
            .summary-line { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #f1f0fb; font-size: 0.95em; }
            .summary-line:last-child { border-bottom: 0; padding-bottom: 0; }
            .balance-box { display: flex; justify-content: space-between; border-radius: 10px; padding: 12px; margin-top: 10px; font-size: 1.15em; font-weight: 800; }
            .balance-positive { background: #f0fdf4; border: 2px solid #22c55e; color: #15803d; }
            .balance-negative { background: #fdf2f2; border: 2px solid #ef4444; color: #b91c1c; }
            
            /* Signatures block */
            .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 40px; }
            .signature-block { border: 1px dashed #c0b6e9; border-radius: 10px; background: #fff; padding: 15px; height: 100px; display: flex; flex-direction: column; justify-content: space-between; }
            .signature-label { font-size: 0.8em; font-weight: bold; text-transform: uppercase; color: #5c567a; text-align: center; }
            
            .meta-text { text-align: center; font-size: 0.75em; color: #999; margin-top: 30px; font-style: italic; }
          </style>
        </head>
        <body>
          <!-- School Letterhead -->
          <div class="letterhead">
            <div class="school-identity">
              ${logoHtml}
              <div class="school-details">
                <h2>${school.name}</h2>
                <p>${school.description}</p>
                <p>📍 ${school.address} | 📞 ${school.phone}</p>
                <p>✉️ ${school.email}</p>
              </div>
            </div>
            <div class="school-tax-grid">
              <div class="tax-item">NIF: <strong>${school.nif || "-"}</strong></div>
              <div class="tax-item">NIS: <strong>${school.nis || "-"}</strong></div>
              <div class="tax-item">RC: <strong>${school.registreCommerce || "-"}</strong></div>
              <div class="tax-item">Art. Fiscal: <strong>${school.articleFiscal || "-"}</strong></div>
            </div>
          </div>

          <!-- Document Title -->
          <div class="doc-title-banner">
            <h1>Dossier & Relevé de Compte Élève</h1>
            <p>Date d'édition : <strong>${new Date().toLocaleDateString("fr-DZ")}</strong></p>
          </div>

          <!-- Student Profile Frame -->
          <div class="frame frame-info" style="margin-bottom: 20px;">
            <h3>Informations Personnelles de l'Élève</h3>
            <table style="margin-top:0;">
              <tr>
                <td style="width:15%; font-weight:bold; color:#5c567a;">Nom Complet :</td>
                <td style="width:35%; font-weight:bold; font-size:1.1em;">${stu.lastName} ${stu.firstName}</td>
                <td style="width:15%; font-weight:bold; color:#5c567a;">ID Unique / RFID :</td>
                <td style="width:35%; font-family:monospace;">${stu.id} / ${stu.rfid || "-"}</td>
              </tr>
              <tr>
                <td style="font-weight:bold; color:#5c567a;">Date de Naiss. :</td>
                <td>${formatDate(stu.birthDate)}</td>
                <td style="font-weight:bold; color:#5c567a;">Téléphone Élève :</td>
                <td style="font-family:monospace;">${stu.phone || "-"}</td>
              </tr>
              <tr>
                <td style="font-weight:bold; color:#5c567a;">Parent / Tuteur :</td>
                <td>${parentObj ? `${parentObj.lastName} ${parentObj.firstName}` : "-"}</td>
                <td style="font-weight:bold; color:#5c567a;">Tél Parent :</td>
                <td style="font-family:monospace;">${parentObj ? parentObj.phone : "-"}</td>
              </tr>
              <tr>
                <td style="font-weight:bold; color:#5c567a;">Statut Spécial :</td>
                <td colspan="3">
                  <span class="badge ${stu.isFree ? "badge-warning" : "badge-success"}">
                    ${stu.isFree ? "Bénéficiaire (Accès Gratuit)" : "Standard (Payant)"}
                  </span>
                </td>
              </tr>
            </table>
          </div>

          <div class="frames-grid">
            
            <!-- Courses Subscriptions Frame -->
            <div class="frame">
              <h3>Abonnements Académiques Actifs</h3>
              <table>
                <thead>
                  <tr>
                    <th>Module (Classe)</th>
                    <th>Enseignant</th>
                    <th>Groupe & Salle</th>
                    <th style="text-align:right;">Tarif Séance</th>
                    <th>Horaires & Planification</th>
                  </tr>
                </thead>
                <tbody>
                  ${subDetails.length === 0 
                    ? `<tr><td colspan="5" style="text-align:center; font-style:italic; color:#999;">Aucune inscription active.</td></tr>`
                    : subDetails.map(sub => `
                        <tr>
                          <td style="font-weight:bold;">${sub.moduleName} (${sub.className})</td>
                          <td>${sub.teacherName}</td>
                          <td>${sub.groupName} <span style="font-size:0.85em; color:#888;">(Salle ${sub.salleName})</span></td>
                          <td style="text-align:right; font-weight:bold;">${stu.isFree ? 0 : sub.price} DA</td>
                          <td style="font-size:0.85em; color:#5c567a;">${sub.schedule}</td>
                        </tr>
                      `).join("")
                  }
                </tbody>
              </table>
            </div>

            <!-- Attendance History Frame -->
            <div class="frame">
              <h3>Historique Récent des Présences (Scans)</h3>
              <table>
                <thead>
                  <tr>
                    <th>Date & Heure</th>
                    <th>Cours / Séance</th>
                    <th style="text-align:center;">Statut</th>
                    <th style="text-align:right;">Déduction</th>
                  </tr>
                </thead>
                <tbody>
                  ${(() => {
                    const fmtDay = (d: string) => d.split("-").reverse().join("/");
                    const presenceRows = [
                      ...studentAttendance.map((a) => {
                        const sess = sessions.find(s => s.id === a.sessionId);
                        const mod = sess ? modules.find(m => m.id === sess.moduleId)?.name : "";
                        const cls = sess ? classes.find(c => c.id === sess.classId)?.name : "";
                        return {
                          sort: new Date(a.timestamp).getTime(),
                          html: `
                          <tr>
                            <td>${formatDateTime(a.timestamp)}</td>
                            <td style="font-weight:bold;">${mod} <span style="font-size:0.85em; font-weight:normal; color:#888;">(${cls})</span></td>
                            <td style="text-align:center;">
                              <span class="badge ${a.status === "present" ? "badge-success" : "badge-warning"}">
                                ${a.status === "present" ? "Présent" : "En Retard"}
                              </span>
                            </td>
                            <td style="text-align:right; font-weight:bold; color:#b91c1c;">-${a.amountDeducted} DA</td>
                          </tr>`,
                        };
                      }),
                      ...studentPenalties.map((p) => {
                        const mod = modules.find(m => m.id === p.moduleId)?.name ?? "";
                        return {
                          sort: new Date(`${p.periodEnd}T12:00:00`).getTime(),
                          html: `
                          <tr>
                            <td>${fmtDay(p.periodStart)} → ${fmtDay(p.periodEnd)}</td>
                            <td style="font-weight:bold;">${mod} <span style="font-size:0.85em; font-weight:normal; color:#888;">(Absence semaine)</span></td>
                            <td style="text-align:center;">
                              <span class="badge badge-warning" style="background:#fee2e2; color:#b91c1c;">Absent</span>
                            </td>
                            <td style="text-align:right; font-weight:bold; color:#b91c1c;">-${p.amount} DA</td>
                          </tr>`,
                        };
                      }),
                    ].sort((a, b) => b.sort - a.sort);
                    return presenceRows.length === 0
                      ? `<tr><td colspan="4" style="text-align:center; font-style:italic; color:#999;">Aucune présence scannée.</td></tr>`
                      : presenceRows.slice(0, 8).map(r => r.html).join("");
                  })()}
                </tbody>
              </table>
            </div>

            <!-- Payments Frame -->
            <div class="frame">
              <h3>Historique des Paiements (Séances achetées & règlements)</h3>
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Désignation</th>
                    <th style="text-align:center;">Séances</th>
                    <th style="text-align:right;">Net</th>
                    <th style="text-align:right;">Payé</th>
                    <th style="text-align:right;">Reste</th>
                  </tr>
                </thead>
                <tbody>
                  ${studentPays.length === 0
                    ? `<tr><td colspan="6" style="text-align:center; font-style:italic; color:#999;">Aucun paiement sur ce compte.</td></tr>`
                    : studentPays.slice(0, 10).map(p => `
                        <tr>
                          <td>${formatDate(p.date)}</td>
                          <td>${p.description ?? (p.type === "debt_payment" ? "Règlement de dette" : "Paiement de séances")}</td>
                          <td style="text-align:center;">${p.seancesPurchased || "—"}</td>
                          <td style="text-align:right;">${p.netTotal ? `${p.netTotal} DA` : "—"}</td>
                          <td style="text-align:right; font-weight:bold; color:#15803d;">${p.amountPaid} DA</td>
                          <td style="text-align:right; font-weight:bold; color:${p.rest > 0 ? "#b91c1c" : "#5c567a"};">${p.rest} DA</td>
                        </tr>
                      `).join("")
                  }
                </tbody>
              </table>
            </div>

          </div>

          <!-- Séances + debt summary -->
          <div class="summary-card">
            <h3 style="margin-top:0; border-bottom:1px solid #7c3aed; padding-bottom:6px; color:#7c3aed;">Situation des Séances de l'Élève</h3>
            <div class="summary-line">
              <span>Séances achetées (cumul) :</span>
              <strong>${totalSeancesBought}</strong>
            </div>
            <div class="summary-line">
              <span>Séances consommées :</span>
              <strong style="color:#b91c1c;">${totalConsumed}</strong>
            </div>
            <div class="summary-line">
              <span>Total versé :</span>
              <strong style="color:#15803d;">${totalPaid} DA</strong>
            </div>
            ${stu.registrationDue !== undefined && stu.registrationDue > 0
              ? `
                <div class="summary-line" style="color:#b91c1c;">
                  <span>Frais d'inscription annuels restants :</span>
                  <strong>-${stu.registrationDue} DA</strong>
                </div>
              `
              : ""
            }
            ${currentDebt > 0
              ? `
                <div class="summary-line" style="color:#b91c1c;">
                  <span>Dette (reste à payer) :</span>
                  <strong>${currentDebt} DA</strong>
                </div>
              `
              : ""
            }

            <div class="balance-box ${totalRemaining > 0 ? "balance-positive" : "balance-negative"}">
              <span>SÉANCES RESTANTES :</span>
              <span>${totalRemaining}</span>
            </div>
          </div>

          <!-- Signature blocks -->
          <div class="signatures">
            <div class="signature-block">
              <span class="signature-label">Signature de l'Élève / Parent</span>
            </div>
            <div class="signature-block">
              <span class="signature-label">Le Secrétariat / Caisse</span>
            </div>
          </div>

          <div class="meta-text">
            Fiche éditée par le système centralisé de l'école ${school.name} le ${new Date().toLocaleString("fr-DZ")}
          </div>
        </body>
      </html>
    `;
    printHtmlDocument(html);
  };

  /** The modules a student is enrolled in, with the price actually charged
   *  (per-module reduction applied) — printed on the payment receipt. */
  const getStudentEnrollmentRows = (stu: Student) =>
    stu.subscriptionIds.flatMap((subId) => {
      const sub = subscriptions.find((s) => s.id === subId);
      if (!sub) {
        const cw = coursework.find((c) => c.id === subId);
        return cw
          ? [{
              module: `Stage: ${cw.name}`,
              classLabel: "-",
              group: "-",
              teacher: teachers.find((t) => t.id === cw.teacherId)
                ? `${teachers.find((t) => t.id === cw.teacherId)!.firstName} ${teachers.find((t) => t.id === cw.teacherId)!.lastName}`
                : "-",
              basePrice: cw.total,
              netPrice: cw.total,
              discountLabel: "",
              unit: "total",
            }]
          : [];
      }
      const sess = sessions.find((se) => se.id === sub.sessionId);
      if (!sess) return [];
      const cls = classes.find((c) => c.id === sess.classId);
      const lvl = cls ? (cls.type === "cours" ? cls.coursLevel : cls.formationLevel) : undefined;
      const t = teachers.find((te) => te.id === sess.teacherId);
      const isFormation = cls?.type === "formation";
      const basePrice = isFormation ? sub.levelPrice ?? 0 : sub.pricePerSession;
      const disc = stu.subscriptionDiscounts?.[subId];
      return [{
        module: modules.find((m) => m.id === sess.moduleId)?.name ?? "Module",
        classLabel: cls ? (lvl ? `${cls.name} (${lvl})` : cls.name) : "-",
        group: groups.find((g) => g.id === sess.groupId)?.name ?? "-",
        teacher: t ? `${t.firstName} ${t.lastName}` : "-",
        basePrice,
        netPrice: netPriceFor(basePrice, disc),
        discountLabel: disc && disc.value > 0
          ? disc.type === "percent" ? `-${disc.value}%` : `-${disc.value} DA`
          : "",
        unit: isFormation ? `${sub.periodMonths ?? 0} mois` : "séance",
      }];
    });

  /** Receipt for one séance purchase. */
  const handlePrintInvoice = (receipt: NonNullable<typeof printConfirmData>) => {
    const { student: stu, amount, description: desc, seances, moduleLabel, plan, expiryDate } = receipt;
    const isMonthReceipt = plan === "month";
    // Get fresh values from useData store
    const state = useData.getState();
    const updatedStu = state.students.find((s) => s.id === stu.id) || stu;

    const invoiceNum = `REC-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;
    const portalPassword = studentCredentials.find((c) => c.studentId === stu.id)?.password ?? "";
    const enrollmentRows = getStudentEnrollmentRows(updatedStu);
    const remainingAfter = totalRemainingSeances(state, stu.id);
    const debtAfter = studentDebt(state, stu.id);

    const logoHtml = school.logo
      ? `<img src="${school.logo}" alt="logo" class="school-logo" />`
      : `<div class="school-logo-fallback">🏫</div>`;

    const html = `
      <html>
        <head>
          <title>Reçu de Paiement - ${invoiceNum}</title>
          <style>
            @media print {
              body { padding: 0; margin: 0; background: #fff; color: #000; font-size: 11px; }
              .no-print { display: none; }
            }
            * { box-sizing: border-box; }
            body { font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; padding: 20px; color: #1e1b4b; background-color: #faf9ff; max-width: 600px; margin: 0 auto; }
            
            /* Letterhead Header */
            .letterhead { display: flex; justify-content: space-between; align-items: stretch; border: 1px solid #e8e6f4; background: #fff; padding: 12px; border-radius: 12px; margin-bottom: 15px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); }
            .school-identity { display: flex; align-items: center; gap: 12px; }
            .school-logo, .school-logo-fallback { width: 50px; height: 50px; border-radius: 10px; object-fit: cover; }
            .school-logo-fallback { background: #f5f3ff; border: 1px solid #ddd; display: flex; align-items: center; justify-content: center; font-size: 1.8em; }
            .school-details h2 { margin: 0; font-size: 1.2em; color: #7c3aed; font-weight: 800; }
            .school-details p { margin: 1px 0; font-size: 0.8em; color: #5c567a; }
            
            .school-tax-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 8px; border-left: 2px solid #7c3aed; padding-left: 12px; align-items: center; }
            .tax-item { font-size: 0.72em; color: #5c567a; }
            .tax-item strong { color: #1e1b4b; font-family: monospace; }
            
            /* Document title banner */
            .doc-title-banner { background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%); color: #fff; padding: 10px; border-radius: 10px; margin-bottom: 15px; text-align: center; }
            .doc-title-banner h1 { margin: 0; font-size: 1.15em; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; }

            /* Compact Side-by-Side Information Grid */
            .info-grid {
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 15px;
              border: 1px solid #e8e6f4;
              border-top: 4px solid #7c3aed;
              background: #fff;
              padding: 12px;
              border-radius: 12px;
              box-shadow: 0 1px 3px rgba(0,0,0,0.02);
              margin-bottom: 15px;
            }
            .info-column {
              display: flex;
              flex-direction: column;
              gap: 6px;
            }
            .info-item {
              display: flex;
              justify-content: space-between;
              border-bottom: 1px dashed #f1f0fb;
              padding-bottom: 4px;
              font-size: 0.85em;
            }
            .info-item:last-child {
              border-bottom: 0;
              padding-bottom: 0;
            }
            .info-label {
              font-weight: bold;
              color: #5c567a;
            }
            .info-value {
              font-weight: bold;
              color: #1e1b4b;
              text-align: right;
            }
            
            /* Portal credentials block */
            .credentials { border: 1px solid #e8e6f4; border-top: 4px solid #3b82f6; background: #fff; border-radius: 12px; padding: 12px; margin-bottom: 15px; }
            .credentials h3 { margin: 0 0 8px; font-size: 0.9em; color: #1e40af; border-bottom: 1px dashed #e8e6f4; padding-bottom: 5px; }
            .cred-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 15px; }
            .cred-note { margin-top: 8px; font-size: 0.68em; color: #92400e; background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 5px 8px; }

            /* Modules table */
            .modules-card { border: 1px solid #e8e6f4; border-top: 4px solid #7c3aed; background: #fff; border-radius: 12px; padding: 12px; margin-bottom: 15px; }
            .modules-card h3 { margin: 0 0 8px; font-size: 0.9em; color: #7c3aed; border-bottom: 1px dashed #e8e6f4; padding-bottom: 5px; }
            table.modules { width: 100%; border-collapse: collapse; font-size: 0.78em; }
            table.modules th { background: #fcfbff; color: #5c567a; text-transform: uppercase; font-size: 0.9em; letter-spacing: 0.3px; text-align: left; padding: 6px 8px; border-bottom: 1px solid #f1f0fb; }
            table.modules td { padding: 6px 8px; border-bottom: 1px solid #f1f0fb; }
            table.modules tr:last-child td { border-bottom: 0; }
            .num { text-align: right; font-family: monospace; font-weight: 700; }
            .strike { text-decoration: line-through; color: #9ca3af; font-weight: 400; }
            .cut { color: #b91c1c; font-weight: 700; }

            /* Payment Synthesis Card */
            .synthesis-card { background: #fdfcff; border: 2px solid #7c3aed; border-radius: 12px; padding: 14px; margin-top: 15px; }
            .synthesis-line { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #f1f0fb; font-size: 0.9em; }
            .synthesis-line:last-child { border-bottom: 0; padding-bottom: 0; }
            .amount-box { display: flex; justify-content: space-between; background: #f0fdf4; border: 2px solid #22c55e; color: #15803d; border-radius: 8px; padding: 10px; margin-top: 8px; font-size: 1.15em; font-weight: 800; }
            
            /* Signatures block */
            .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-top: 25px; }
            .signature-block { border: 1px dashed #c0b6e9; border-radius: 10px; background: #fff; padding: 10px; height: 75px; display: flex; flex-direction: column; justify-content: space-between; }
            .signature-label { font-size: 0.75em; font-weight: bold; text-transform: uppercase; color: #5c567a; text-align: center; }
            
            .meta-text { text-align: center; font-size: 0.7em; color: #999; margin-top: 20px; font-style: italic; }
          </style>
        </head>
        <body>
          <!-- School Letterhead -->
          <div class="letterhead">
            <div class="school-identity">
              ${logoHtml}
              <div class="school-details">
                <h2>${school.name}</h2>
                <p>${school.description}</p>
                <p>📍 ${school.address} | 📞 ${school.phone}</p>
              </div>
            </div>
            <div class="school-tax-grid">
              <div class="tax-item">NIF: <strong>${school.nif || "-"}</strong></div>
              <div class="tax-item">NIS: <strong>${school.nis || "-"}</strong></div>
              <div class="tax-item">RC: <strong>${school.registreCommerce || "-"}</strong></div>
              <div class="tax-item">Art. Fiscal: <strong>${school.articleFiscal || "-"}</strong></div>
            </div>
          </div>

          <!-- Document Title -->
          <div class="doc-title-banner">
            <h1>Reçu de Versement</h1>
          </div>

          <!-- Compact Information Grid (Left & Right columns) -->
          <div class="info-grid">
            <!-- Left Column -->
            <div class="info-column">
              <div class="info-item">
                <span class="info-label">Élève :</span>
                <span class="info-value" style="color: #7c3aed;">${stu.lastName} ${stu.firstName}</span>
              </div>
              <div class="info-item">
                <span class="info-label">RFID :</span>
                <span class="info-value" style="font-family: monospace;">${stu.rfid || "-"}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Date :</span>
                <span class="info-value">${new Date().toLocaleString("fr-DZ")}</span>
              </div>
            </div>
            
            <!-- Right Column -->
            <div class="info-column">
              <div class="info-item">
                <span class="info-label">Reçu N° :</span>
                <span class="info-value" style="font-family: monospace; color: #7c3aed;">${invoiceNum}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Opération :</span>
                <span class="info-value">${
                  isMonthReceipt
                    ? `Abonnement mensuel — ${seances} séance(s)`
                    : `Paiement de ${seances} séance(s)`
                }</span>
              </div>
              ${
                isMonthReceipt
                  ? `<div class="info-item">
                <span class="info-label">Valable jusqu'au :</span>
                <span class="info-value">${formatDateFr(expiryDate)}</span>
              </div>`
                  : ""
              }
              <div class="info-item">
                <span class="info-label">Désignation :</span>
                <span class="info-value">${desc}</span>
              </div>
            </div>
          </div>

          <!-- Portal account (login the family uses on the app) -->
          <div class="credentials">
            <h3>🔐 Compte de l'Élève (Espace en ligne)</h3>
            <div class="cred-grid">
              <div class="info-item">
                <span class="info-label">Email / Identifiant :</span>
                <span class="info-value" style="font-family: monospace;">${stu.email || "-"}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Mot de passe :</span>
                <span class="info-value" style="font-family: monospace; letter-spacing: 0.5px;">${
                  portalPassword || "— (non enregistré)"
                }</span>
              </div>
            </div>
            <div class="cred-note">
              ⚠️ Document confidentiel — remettre en main propre au parent / à l'élève.
              ${portalPassword ? "Le mot de passe peut être modifié à tout moment depuis l'espace personnel." : "Le mot de passe n'a pas été enregistré à la création : réinitialisez-le depuis la fiche de l'élève pour le faire apparaître ici."}
            </div>
          </div>

          <!-- Modules the student is subscribed to -->
          <div class="modules-card">
            <h3>📚 Modules Souscrits (${enrollmentRows.length})</h3>
            ${
              enrollmentRows.length === 0
                ? `<p style="font-size:0.78em; color:#999; font-style:italic; margin:6px 0 0;">Aucun module souscrit pour le moment.</p>`
                : `<table class="modules">
              <thead>
                <tr>
                  <th>Module</th>
                  <th>Classe / Niveau</th>
                  <th>Groupe</th>
                  <th>Enseignant</th>
                  <th class="num">Tarif</th>
                </tr>
              </thead>
              <tbody>
                ${enrollmentRows
                  .map(
                    (e) => `
                <tr>
                  <td style="font-weight:bold; color:#1e1b4b;">${e.module}</td>
                  <td>${e.classLabel}</td>
                  <td>${e.group}</td>
                  <td>${e.teacher}</td>
                  <td class="num">
                    ${
                      e.discountLabel
                        ? `<span class="strike">${e.basePrice}</span> ${e.netPrice} DA<br/><span class="cut" style="font-size:0.85em;">${e.discountLabel}</span>`
                        : `${e.netPrice} DA`
                    }
                    <br/><span style="font-weight:400; color:#9ca3af; font-size:0.85em;">/ ${e.unit}</span>
                  </td>
                </tr>`,
                  )
                  .join("")}
              </tbody>
            </table>`
            }
          </div>

          <!-- Payment Synthesis Card -->
          <div class="synthesis-card">
            <h3 style="margin-top:0; border-bottom:1px dashed #7c3aed; padding-bottom:6px; color:#7c3aed; font-size: 0.95em;">Détail du Paiement</h3>
            <div class="synthesis-line">
              <span>Module :</span>
              <strong>${moduleLabel}</strong>
            </div>
            <div class="synthesis-line">
              <span>Séances payées :</span>
              <strong>${seances} × ${receipt.unitPrice} DA = ${receipt.grossTotal} DA</strong>
            </div>
            ${receipt.discountLabel
              ? `
                <div class="synthesis-line" style="color: #b45309;">
                  <span>Remise :</span>
                  <strong>${receipt.discountLabel}</strong>
                </div>
              `
              : ""
            }
            <div class="synthesis-line">
              <span>Net à payer :</span>
              <strong style="color: #1e1b4b;">${receipt.netTotal} DA</strong>
            </div>
            <div class="synthesis-line">
              <span>Reste à payer :</span>
              <strong style="color: ${receipt.rest > 0 ? "#b91c1c" : "#15803d"};">${receipt.rest} DA</strong>
            </div>
            <div class="synthesis-line">
              <span>Séances restantes (tous modules) :</span>
              <strong>${remainingAfter}</strong>
            </div>
            ${debtAfter > 0
              ? `
                <div class="synthesis-line" style="color: #b91c1c;">
                  <span>Dette totale du compte :</span>
                  <strong>${debtAfter} DA</strong>
                </div>
              `
              : ""
            }

            <div class="amount-box">
              <span>MONTANT REÇU :</span>
              <span>${amount} DA</span>
            </div>
          </div>

          <!-- Signature blocks -->
          <div class="signatures">
            <div class="signature-block">
              <span class="signature-label">Le Parent / Élève</span>
            </div>
            <div class="signature-block">
              <span class="signature-label">La Caisse / Direction</span>
            </div>
          </div>

          <div class="meta-text">
            Reçu généré par le système centralisé de l'école ${school.name}
          </div>
        </body>
      </html>
    `;
    printHtmlDocument(html);
  };

  return (
    <div>
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
        <PageHeader emoji="🎓" title="Étudiants" subtitle="Gérer les inscriptions et abonnements des élèves" />

        <div className="flex items-center gap-2">
          <Button
            onClick={() => {
              const lowStus = students.filter(isSoonToRunOut);
              setSelectedAlertStudentIds(lowStus.map((s) => s.id));
              setIsAlertLowBalanceOpen(true);
            }}
            variant="outline"
            className="flex items-center gap-2 border-danger/30 hover:border-danger hover:bg-danger/10 text-danger relative"
          >
            <Bell className="h-4 w-4 text-danger" /> Alertes soldes
            {students.filter(isSoonToRunOut).length > 0 && (
              <span className="absolute -top-1 -right-1 bg-danger text-white text-[9px] font-bold h-4.5 w-4.5 rounded-full flex items-center justify-center pulse-glow">
                {students.filter(isSoonToRunOut).length}
              </span>
            )}
          </Button>
          <Button onClick={() => setIsScanOpen(true)} variant="secondary" className="flex items-center gap-2">
            <Scan className="h-4 w-4" /> Scanner RFID
          </Button>
          <Button onClick={() => { resetForm(); setIsCreateOpen(true); }} className="flex items-center gap-2">
            <Plus className="h-4 w-4" /> Nouvel Étudiant
          </Button>
        </div>
      </div>

      {/* Filter panel */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6 bg-surface border border-line p-3 rounded-2xl">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Rechercher par n° d'inscription (00001), nom, téléphone ou email..."
            className="pl-9"
          />
        </div>
        <div className="flex gap-1">
          <Button size="sm" variant={filterType === "all" ? "primary" : "outline"} onClick={() => setFilterType("all")}>
            Tous
          </Button>
          <Button size="sm" variant={filterType === "soon" ? "primary" : "outline"} onClick={() => setFilterType("soon")}>
            Solde faible
          </Button>
          <Button size="sm" variant={filterType === "debt" ? "primary" : "outline"} onClick={() => setFilterType("debt")}>
            En dette
          </Button>
          <Button size="sm" variant={filterType === "paid" ? "primary" : "outline"} onClick={() => setFilterType("paid")}>
            À jour
          </Button>
          <Button size="sm" variant={filterType === "free" ? "primary" : "outline"} onClick={() => setFilterType("free")}>
            Cas Spéciaux
          </Button>
        </div>
      </div>

      {/* Formation expiry alerts */}
      {(() => {
        const alerts = students
          .flatMap((stu) =>
            getFormationExpiries(stu)
              .filter((f) => f.daysLeft <= EXPIRY_WARNING_DAYS)
              .map((f) => ({ stu, ...f })),
          )
          .sort((a, b) => a.daysLeft - b.daysLeft);
        if (alerts.length === 0) return null;
        return (
          <Card className="mb-6">
            <CardBody>
              <div className="flex items-start gap-3">
                <div className="rounded-xl bg-warning/15 p-2.5 text-warning">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-bold text-ink">Alertes d&apos;expiration des formations</h3>
                  <p className="mt-0.5 text-xs text-muted">
                    Formations expirées ou qui expirent dans les {EXPIRY_WARNING_DAYS} prochains jours.
                  </p>
                  <div className="mt-2 space-y-1.5">
                    {alerts.map((a) => (
                      <div
                        key={`${a.stu.id}-${a.subId}`}
                        className="flex flex-wrap items-center justify-between gap-2 text-xs bg-canvas/40 border border-line rounded-lg px-3 py-1.5"
                      >
                        <span>
                          <strong className="text-ink">
                            {a.stu.firstName} {a.stu.lastName}
                          </strong>
                          <span className="text-muted"> — {a.label}</span>
                        </span>
                        <Badge tone={a.daysLeft < 0 ? "danger" : "warning"} className="text-[10px]">
                          {a.daysLeft < 0
                            ? `Expirée le ${formatDateFr(a.expiryDate)}`
                            : a.daysLeft === 0
                              ? "Expire aujourd'hui"
                              : `Expire dans ${a.daysLeft} j (${formatDateFr(a.expiryDate)})`}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </CardBody>
          </Card>
        );
      })()}

      {/* Students list */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {getFilteredStudents().map((stu) => {
          const isOverlaid = overlayStudentId === stu.id;
          const debt = debtFor(stu);
          const number = registrationNumberOf(db, stu);
          const caseLabel = studentCaseLabel(stu);

          return (
            <Card
              key={stu.id}
              className={`relative overflow-visible ${
                debt > 0 ? "border-2 border-danger/60 shadow-[0_0_0_3px_rgba(239,68,68,0.08)]" : ""
              }`}
            >
              <CardBody className="flex flex-col justify-between h-64 relative">
                {/* Overlay Action Buttons displayed ABOVE the card when three dots are clicked */}
                {isOverlaid && (
                  <div className="absolute inset-0 z-20 flex flex-col rounded-2xl bg-primary-600/95 text-white backdrop-blur-sm">
                    {/* Header stays put while the actions scroll under it */}
                    <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/20 px-3 py-2">
                      <span className="truncate text-xs font-bold">
                        {stu.firstName} {stu.lastName}
                      </span>
                      <button
                        onClick={() => setOverlayStudentId(null)}
                        className="shrink-0 rounded-lg bg-white/15 px-2 py-0.5 text-[10px] font-semibold hover:bg-white/25"
                      >
                        Fermer
                      </button>
                    </div>

                    <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
                      {/* ONE money action: the soldes of every emploi du temps
                          are consulted, alerted on and recharged from here. */}
                      <div>
                        <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-white/60">
                          Paiement
                        </span>
                        <button
                          onClick={() => openSoldManager(stu)}
                          className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-[11px] font-bold ${
                            debt > 0
                              ? "bg-danger text-white hover:bg-danger/80"
                              : "bg-white text-primary hover:bg-white/90"
                          }`}
                        >
                          <Wallet className="h-4 w-4 shrink-0" />
                          <span className="min-w-0 text-start">
                            Payer &amp; recharger les soldes
                            <span
                              className={`block text-[9px] font-semibold ${
                                debt > 0 ? "text-white/80" : "text-primary/70"
                              }`}
                            >
                              {debt > 0
                                ? `Dette de ${debt} DA à régler`
                                : "Soldes par emploi du temps, mois par mois"}
                            </span>
                          </span>
                        </button>
                      </div>

                      {/* Fiche */}
                      <div>
                        <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-white/60">
                          Fiche élève
                        </span>
                        <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                          <button
                            onClick={() => openDetails(stu)}
                            className="flex items-center justify-center gap-1.5 rounded-xl bg-white/15 py-2 font-semibold hover:bg-white/25"
                          >
                            <Eye className="h-3.5 w-3.5" /> Détails
                          </button>
                          <button
                            onClick={() => openEdit(stu)}
                            className="flex items-center justify-center gap-1.5 rounded-xl bg-white/15 py-2 font-semibold hover:bg-white/25"
                          >
                            <Edit className="h-3.5 w-3.5" /> Modifier
                          </button>
                          <button
                            onClick={() => handlePrintStudent(stu)}
                            className="flex items-center justify-center gap-1.5 rounded-xl bg-white/15 py-2 font-semibold hover:bg-white/25"
                          >
                            <Printer className="h-3.5 w-3.5" /> Imprimer fiche
                          </button>
                          <button
                            onClick={() => openPrintPayments(stu)}
                            className="flex items-center justify-center gap-1.5 rounded-xl bg-white/15 py-2 font-semibold hover:bg-white/25"
                          >
                            <Printer className="h-3.5 w-3.5" /> Paiements
                          </button>
                        </div>
                      </div>

                      {/* Envoi WhatsApp — l'action de relance la plus fréquente
                          sur une fiche en dette. */}
                      <div>
                        <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-white/60">
                          Contact
                        </span>
                        <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                          <button
                            onClick={() => openWhatsApp(stu, "student")}
                            disabled={!isSendablePhone(stu.phone)}
                            title={
                              isSendablePhone(stu.phone)
                                ? "Envoyer un message WhatsApp à l'élève"
                                : "Aucun numéro exploitable pour cet élève"
                            }
                            className="flex items-center justify-center gap-1.5 rounded-xl bg-emerald-500/90 py-2 font-semibold hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <MessageCircle className="h-3.5 w-3.5" /> Élève
                          </button>
                          {(() => {
                            const parent = parents.find((p) => p.id === stu.parentId);
                            const canSend = isSendablePhone(parent?.phone);
                            return (
                              <button
                                onClick={() => openWhatsApp(stu, "parent")}
                                disabled={!canSend}
                                title={
                                  !parent
                                    ? "Aucun parent rattaché à cet élève"
                                    : canSend
                                      ? `Envoyer un message WhatsApp à ${parent.firstName} ${parent.lastName}`
                                      : "Le parent rattaché n'a pas de numéro exploitable"
                                }
                                className="flex items-center justify-center gap-1.5 rounded-xl bg-emerald-500/90 py-2 font-semibold hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                <MessageCircle className="h-3.5 w-3.5" /> Parent
                              </button>
                            );
                          })()}
                        </div>
                      </div>

                      <button
                        onClick={() => handleDelete(stu.id)}
                        className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-danger py-2 text-[11px] font-bold hover:bg-danger/80"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Supprimer l&apos;élève
                      </button>
                    </div>
                  </div>
                )}

                <div>
                  <div className="flex items-start justify-between">
                    <button
                      type="button"
                      onClick={() => openDetails(stu)}
                      title="Voir la fiche de l'élève"
                      className="flex items-center gap-2 text-start rounded-xl hover:bg-primary-50/60 transition-colors p-0.5 -m-0.5"
                    >
                      <div className="h-10 w-10 shrink-0 bg-primary/10 rounded-xl flex flex-col items-center justify-center font-bold text-primary leading-none">
                        <span className="text-[8px] font-semibold uppercase tracking-wide text-primary/70">
                          N°
                        </span>
                        <span className="font-mono text-[10px]">{number}</span>
                      </div>
                      <div className="min-w-0">
                        <h4 className="text-sm font-bold text-ink hover:text-primary transition-colors">
                          {stu.firstName} {stu.lastName}
                        </h4>
                        <span className="block text-[10px] text-muted">{stu.phone || "—"}</span>
                        {caseLabel && (
                          <Badge tone={studentCaseTone(stu)} className="mt-0.5 text-[9px]">
                            {caseLabel}
                          </Badge>
                        )}
                      </div>
                    </button>

                    <button
                      onClick={() => setOverlayStudentId(stu.id)}
                      className="p-1 rounded-lg hover:bg-primary-50 text-muted hover:text-ink transition-colors"
                    >
                      <MoreVertical className="h-5 w-5" />
                    </button>
                  </div>

                  {/* Only what actually drives an action at the desk: the
                      total the student owes, clickable to see the details. */}
                  <div className="mt-3 space-y-1.5 text-xs">
                    <button
                      onClick={() => openDetails(stu)}
                      title={debt > 0 ? "Voir le détail des dettes" : "Compte à jour"}
                      className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-start transition-colors ${
                        debt > 0
                          ? "border-danger/50 bg-danger/10 hover:bg-danger/20"
                          : "border-success/40 bg-success/10 hover:bg-success/20"
                      }`}
                    >
                      <span>
                        <span className="block text-[9px] font-semibold uppercase tracking-wide text-muted">
                          Dette totale
                        </span>
                        <strong className={`block text-base ${debt > 0 ? "text-danger" : "text-success"}`}>
                          {debt > 0 ? `${debt} DA` : "Aucune"}
                        </strong>
                      </span>
                      {debt > 0 ? (
                        <span className="flex items-center gap-1 text-[10px] font-bold text-danger">
                          <AlertTriangle className="h-3.5 w-3.5" /> Voir le détail
                        </span>
                      ) : (
                        <span className="text-lg">✅</span>
                      )}
                    </button>

                    {stu.registrationDue && stu.registrationDue > 0 ? (
                      <div className="flex justify-between items-center bg-danger/10 p-1.5 rounded-lg">
                        <span className="text-danger text-[10px] font-bold">Frais d&apos;inscription dus: {stu.registrationDue} DA</span>
                        <button
                          onClick={() => handleSettleRegistrationCost(stu)}
                          className="text-[9px] bg-danger text-white px-2 py-0.5 rounded font-bold hover:bg-danger/80"
                        >
                          Régler
                        </button>
                      </div>
                    ) : (
                      <div className="flex justify-between text-[10px] text-success bg-success/15 px-2 py-0.5 rounded">
                        <span>Frais d&apos;inscription</span>
                        <strong>Payé ✔</strong>
                      </div>
                    )}
                  </div>
                </div>

                <div className="border-t border-line pt-2 mt-2">
                  <span className="text-[10px] text-muted block mb-1">
                    Emplois du temps ({stu.subscriptionIds.length}) :
                  </span>
                  {stu.subscriptionIds.length === 0 ? (
                    <span className="text-[10px] text-muted italic">Non inscrit</span>
                  ) : (
                    <div className="flex flex-wrap gap-1 max-h-16 overflow-y-auto">
                      {stu.subscriptionIds.map((id) => {
                        const sub = subscriptions.find((x) => x.id === id);
                        const sold = soldFor(db, stu.id, id);
                        const st = stu.isFree ? "ok" : soldStatus(sold, sub?.pricePerSession ?? 0);
                        const tone =
                          st === "debt" ? "danger" : st === "empty" || st === "low" ? "warning" : "success";
                        const month = currentCycleIndex(db, stu.id, id) + 1;
                        return (
                          <Badge key={id} tone={tone} className="text-[9px] px-1 py-0.5 whitespace-normal">
                            {getModuleLabel(id)} · M{month}
                            {!stu.isFree && ` · ${sold} DA`}
                          </Badge>
                        );
                      })}
                    </div>
                  )}
                </div>
              </CardBody>
            </Card>
          );
        })}
      </div>

      {/* Edit Modal */}
      <Modal open={isEditOpen} onClose={() => setIsEditOpen(false)} title="Modifier l'étudiant">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-muted mb-1">Prénom</label>
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted mb-1">Nom</label>
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Date de naissance</label>
            <Input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Téléphone</label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">RFID</label>
            <Input value={rfid} onChange={(e) => setRfid(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Email</label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Nouveau mot de passe</label>
            <Input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Laisser vide pour ne pas changer" />
          </div>
          <div className="flex items-center justify-between p-3 bg-canvas border border-line rounded-xl">
            <span className="text-xs font-bold text-ink">Cas Spécial (Études gratuites)</span>
            <input type="checkbox" checked={isFree} onChange={(e) => setIsFree(e.target.checked)} className="h-5 w-5" />
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => setIsEditOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handleEditStudent}>Enregistrer</Button>
          </div>
        </div>
      </Modal>

      {/* Details Modal with subdivisions */}
      <Modal open={isDetailsOpen} onClose={() => setIsDetailsOpen(false)} title="Fiche Étudiant" wide>
        {selectedStudent && (
          <div className="space-y-6">
            {/* Header brief info */}
            <div className="bg-primary-50/50 p-4 border border-line rounded-xl flex items-center justify-between">
              <div>
                <h3 className="font-bold text-lg text-ink">{selectedStudent.firstName} {selectedStudent.lastName}</h3>
                <span className="text-xs text-muted">ID: {selectedStudent.id} | Carte: {selectedStudent.rfid}</span>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {selectedStudent.isFree ? (
                  <Badge tone="success" className="text-sm px-3 py-1">Études gratuites</Badge>
                ) : (
                  <Badge
                    tone={
                      remainingFor(selectedStudent) < 0
                        ? "danger"
                        : isSoonToRunOut(selectedStudent)
                          ? "warning"
                          : "primary"
                    }
                    className="text-sm px-3 py-1"
                  >
                    Solde total : {formatDA(remainingFor(selectedStudent))}
                  </Badge>
                )}
                {debtFor(selectedStudent) > 0 && (
                  <Badge tone="danger" className="text-sm px-3 py-1">
                    Dette: {debtFor(selectedStudent)} DA
                  </Badge>
                )}
              </div>
            </div>

            {/* Navigation Tabs inside details modal */}
            <div className="flex border-b border-line gap-2">
              <button
                onClick={() => setDetailsTab("personal")}
                className={`pb-2.5 px-4 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
                  detailsTab === "personal" ? "border-primary text-primary" : "border-transparent text-muted hover:text-ink"
                }`}
              >
                <User className="h-4 w-4" /> Personnel
              </button>
              <button
                onClick={() => setDetailsTab("subs")}
                className={`pb-2.5 px-4 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
                  detailsTab === "subs" ? "border-primary text-primary" : "border-transparent text-muted hover:text-ink"
                }`}
              >
                <BookOpen className="h-4 w-4" /> Abonnements ({selectedStudent.subscriptionIds.length})
              </button>
              <button
                onClick={() => setDetailsTab("payments")}
                className={`pb-2.5 px-4 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
                  detailsTab === "payments" ? "border-primary text-primary" : "border-transparent text-muted hover:text-ink"
                }`}
              >
                <History className="h-4 w-4" /> Paiements ({studentPayments(db, selectedStudent.id).length})
              </button>
              <button
                onClick={() => setDetailsTab("attendance")}
                className={`pb-2.5 px-4 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
                  detailsTab === "attendance" ? "border-primary text-primary" : "border-transparent text-muted hover:text-ink"
                }`}
              >
                <CheckCircle className="h-4 w-4" /> Présences &amp; Absences (
                {attendance.filter((t) => t.studentId === selectedStudent.id).length +
                  absencePenalties.filter((p) => p.studentId === selectedStudent.id).length}
                )
              </button>
            </div>

            {/* Tab Contents */}
            <div className="min-h-[220px]">
              {detailsTab === "personal" && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div>
                    <span className="text-muted block font-semibold mb-0.5">Date de naissance:</span>
                    <span className="text-ink font-bold">{selectedStudent.birthDate || "-"}</span>
                  </div>
                  <div>
                    <span className="text-muted block font-semibold mb-0.5">Téléphone:</span>
                    <span className="text-ink font-bold">{selectedStudent.phone}</span>
                  </div>
                  <div>
                    <span className="text-muted block font-semibold mb-0.5">Email de connexion:</span>
                    <span className="text-ink font-bold">{selectedStudent.email}</span>
                  </div>
                  <div>
                    <span className="text-muted block font-semibold mb-0.5">Mot de passe de connexion:</span>
                    <span className="text-ink font-bold text-xs italic text-muted">
                      Non affiché — utilisez « Modifier » pour définir un nouveau mot de passe.
                    </span>
                  </div>
                  <div>
                    <span className="text-muted block font-semibold mb-0.5">Tuteur affecté:</span>
                    <span className="text-ink font-bold">
                      {parents.find((p) => p.id === selectedStudent.parentId)
                        ? `${parents.find((p) => p.id === selectedStudent.parentId)?.firstName} ${
                            parents.find((p) => p.id === selectedStudent.parentId)?.lastName
                          } (${parents.find((p) => p.id === selectedStudent.parentId)?.phone})`
                        : "Aucun tuteur assigné"}
                    </span>
                  </div>
                </div>
              )}

              {/* Emplois du temps — the SOLDE of each one, month by month.
                  This is where the money paid at the inscription (and every
                  recharge since) shows up: what was credited on each of the
                  emploi's own months, what the séances of that month ate, and
                  what is left. */}
              {detailsTab === "subs" && (
                <div className="space-y-3">
                  {selectedStudent.subscriptionIds.length === 0 ? (
                    <p className="text-xs text-muted italic">
                      Cet élève n&apos;est inscrit sur aucun emploi du temps.
                    </p>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-canvas/40 px-3 py-2">
                        <span className="text-[11px] font-semibold text-muted">
                          {selectedStudent.subscriptionIds.length} emploi(s) du temps
                        </span>
                        <div className="flex items-center gap-2">
                          <Badge
                            tone={
                              studentSoldDebt(db, selectedStudent.id) > 0 ? "danger" : "success"
                            }
                          >
                            Dette soldes :{" "}
                            {formatDA(studentSoldDebt(db, selectedStudent.id))}
                          </Badge>
                          <Button
                            size="sm"
                            onClick={() => {
                              setIsDetailsOpen(false);
                              openSoldManager(selectedStudent);
                            }}
                            className="gap-1.5"
                          >
                            <Wallet className="h-3.5 w-3.5" /> Payer &amp; recharger
                          </Button>
                        </div>
                      </div>

                      {selectedStudent.subscriptionIds.map((subId) => {
                        const sub = subscriptions.find((s) => s.id === subId);
                        if (!sub) {
                          return (
                            <div
                              key={subId}
                              className="rounded-xl border border-line bg-surface p-3 text-xs text-muted"
                            >
                              {getModuleLabel(subId)} — tarif introuvable.
                            </div>
                          );
                        }
                        const sold = soldFor(db, selectedStudent.id, subId);
                        const st = selectedStudent.isFree
                          ? "ok"
                          : soldStatus(sold, sub.pricePerSession);
                        const cycles = enrollmentCycles(db, selectedStudent.id, subId);
                        const current = currentCycleIndex(db, selectedStudent.id, subId);
                        return (
                          <div key={subId} className="rounded-xl border border-line bg-surface p-3">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div className="min-w-0">
                                <strong className="block text-xs text-ink">
                                  {getModuleLabel(subId)}
                                </strong>
                                <span className="block text-[10px] text-muted">
                                  {getTimingLabel(subId)}
                                </span>
                                <span className="block text-[10px] text-muted">
                                  {cycleSizeOf(sub)} séances / mois · séance à{" "}
                                  {formatDA(sub.pricePerSession)} · mois à{" "}
                                  {formatDA(monthlyPriceOf(sub))}
                                </span>
                              </div>
                              <Badge
                                tone={
                                  st === "debt"
                                    ? "danger"
                                    : st === "empty" || st === "low"
                                      ? "warning"
                                      : "success"
                                }
                                className="font-mono"
                              >
                                Solde {formatDA(sold)}
                              </Badge>
                            </div>

                            <div className="mt-2 overflow-x-auto">
                              <table className="w-full min-w-[420px] text-[11px]">
                                <thead>
                                  <tr className="text-left text-[9px] uppercase tracking-wide text-muted">
                                    <th className="py-1">Mois</th>
                                    <th className="py-1 text-center">Séances</th>
                                    <th className="py-1 text-right">Versé</th>
                                    <th className="py-1 text-right">Consommé</th>
                                    <th className="py-1 text-right">Reste</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {cycles.map((c) => (
                                    <tr
                                      key={c.code}
                                      className={`border-t border-line/60 ${
                                        c.index === current ? "bg-primary-50/40" : ""
                                      }`}
                                    >
                                      <td className="py-1.5 font-bold text-ink">
                                        {c.code}
                                        {c.index === current && (
                                          <span className="ml-1 text-[9px] font-semibold text-primary">
                                            en cours
                                          </span>
                                        )}
                                        {c.startDate && (
                                          <span className="block text-[9px] font-normal text-muted">
                                            {formatDateFr(c.startDate)}
                                            {c.endDate ? ` → ${formatDateFr(c.endDate)}` : " → …"}
                                          </span>
                                        )}
                                      </td>
                                      <td className="py-1.5 text-center font-mono">
                                        {c.done}/{c.size}
                                      </td>
                                      <td className="py-1.5 text-right font-mono text-success">
                                        {formatDA(c.credited)}
                                      </td>
                                      <td className="py-1.5 text-right font-mono text-muted">
                                        {formatDA(c.consumed)}
                                      </td>
                                      <td
                                        className={`py-1.5 text-right font-mono font-bold ${
                                          c.balance < 0 ? "text-danger" : "text-ink"
                                        }`}
                                      >
                                        {formatDA(c.balance)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>

                            <div className="mt-2 flex justify-end">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  if (confirm("Retirer cet emploi du temps de sa fiche ?")) {
                                    updateItem("students", selectedStudent.id, {
                                      subscriptionIds: selectedStudent.subscriptionIds.filter(
                                        (id) => id !== subId,
                                      ),
                                    });
                                  }
                                }}
                                className="text-danger"
                              >
                                Retirer
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>
              )}

              {/* Paiements — the séance purchases and the debt settlements.
                  A purchase is filtered by the module its enrollment belongs to;
                  a debt settlement covers the whole account, so it is only
                  listed when no module filter is on. */}
              {detailsTab === "payments" && (() => {
                const moduleOptions = getStudentModuleOptions(selectedStudent);
                const moduleOfEnrollment = (enrollmentId?: string) => {
                  const enr = enrollments.find((e) => e.id === enrollmentId);
                  const sub = enr ? subscriptions.find((s) => s.id === enr.subscriptionId) : undefined;
                  const sess = sub ? sessions.find((se) => se.id === sub.sessionId) : undefined;
                  return sess?.moduleId;
                };
                const payList = studentPayments(db, selectedStudent.id).filter((p) => {
                  if (txModuleFilter === "all") return true;
                  return moduleOfEnrollment(p.enrollmentId) === txModuleFilter;
                });
                const totalPaid = payList.reduce((s, p) => s + p.amountPaid, 0);
                return (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2 bg-canvas/40 border border-line rounded-xl p-2">
                      <label className="text-[10px] font-bold text-muted uppercase shrink-0">Module :</label>
                      <Select value={txModuleFilter} onChange={(e) => setTxModuleFilter(e.target.value)} className="w-52">
                        <option value="all">Tous les modules</option>
                        {moduleOptions.map((m) => (
                          <option key={m.id} value={m.id}>{m.name}</option>
                        ))}
                      </Select>
                      <span className="text-[10px] text-muted ms-auto font-mono">
                        {payList.length} paiement(s) · {totalPaid} DA versés
                      </span>
                    </div>
                    <div className="space-y-2 max-h-60 overflow-y-auto">
                      {payList.length === 0 ? (
                        <p className="text-xs text-muted italic">Aucun paiement pour ce filtre.</p>
                      ) : (
                        payList.map((p) => {
                          const isDebt = p.type === "debt_payment";
                          const enr = enrollments.find((e) => e.id === p.enrollmentId);
                          return (
                            <div
                              key={p.id}
                              className={`text-xs p-3 rounded-xl border ${
                                p.rest > 0 ? "bg-danger/5 border-danger/40" : "bg-canvas border-line"
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <strong className="text-ink flex items-center gap-1.5">
                                    <Badge tone={isDebt ? "success" : "primary"} className="text-[9px] px-1.5 py-0">
                                      {isDebt ? "Règlement de dette" : "Achat de séances"}
                                    </Badge>
                                    {enr ? enrollmentLabel(db, enr) : p.description ?? "—"}
                                  </strong>
                                  <span className="text-[10px] text-muted">
                                    {p.date.substring(0, 16).replace("T", " ")}
                                    {p.description && enr ? ` · ${p.description}` : ""}
                                  </span>
                                </div>
                                <strong className="shrink-0 font-bold text-success">+{p.amountPaid} DA</strong>
                              </div>

                              {!isDebt && (
                                <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 border-t border-line/60 pt-1.5 text-[10px] text-muted sm:grid-cols-3">
                                  <span>Séances: <strong className="text-ink">{p.seancesPurchased}</strong></span>
                                  <span>Prix séance: <strong className="text-ink">{p.unitPrice} DA</strong></span>
                                  <span>Brut: <strong className="text-ink">{p.grossTotal} DA</strong></span>
                                  <span>
                                    Remise:{" "}
                                    <strong className="text-warning">
                                      {p.discountValue && p.discountValue > 0
                                        ? discountLabel({ type: p.discountType ?? "percent", value: p.discountValue })
                                        : "—"}
                                    </strong>
                                  </span>
                                  <span>Net: <strong className="text-primary">{p.netTotal} DA</strong></span>
                                  <span>
                                    Reste:{" "}
                                    <strong className={p.rest > 0 ? "text-danger" : "text-ink"}>{p.rest} DA</strong>
                                  </span>
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })()}

              {detailsTab === "attendance" && (() => {
                const moduleOptions = getStudentModuleOptions(selectedStudent);
                const inDateWindow = (when: Date) => {
                  if (attDateMode === "month" && attMonth) {
                    const key = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, "0")}`;
                    if (key !== attMonth) return false;
                  }
                  if (attDateMode === "range") {
                    if (attStart && when < new Date(`${attStart}T00:00:00`)) return false;
                    if (attEnd && when > new Date(`${attEnd}T23:59:59.999`)) return false;
                  }
                  return true;
                };
                const attList = attendance.filter((att) => {
                  if (att.studentId !== selectedStudent.id) return false;
                  if (attModuleFilter !== "all") {
                    const sess = sessions.find((se) => se.id === att.sessionId);
                    if (!sess || sess.moduleId !== attModuleFilter) return false;
                  }
                  if (attKindFilter === "absent" && att.status !== "absent") return false;
                  if (attKindFilter === "present" && att.status === "absent") return false;
                  return inDateWindow(new Date(att.timestamp));
                });
                // Automatic weekly-absence charges, shown alongside real scans so
                // the presence history tells the whole story (a "-price DA" entry
                // for every module week the student never showed up for).
                const penList = absencePenalties.filter((pen) => {
                  if (pen.studentId !== selectedStudent.id) return false;
                  if (attModuleFilter !== "all" && pen.moduleId !== attModuleFilter) return false;
                  if (attKindFilter === "present") return false;
                  return inDateWindow(new Date(`${pen.periodEnd}T12:00:00`));
                });
                const presentCount = attList.filter((a) => a.status !== "absent").length;
                const lateCount = attList.filter((a) => a.status === "late").length;
                const absentTotal = attList.filter((a) => a.status === "absent").length + penList.length;
                const chargedTotal =
                  attList.reduce((sum, a) => sum + a.amountDeducted, 0) +
                  penList.reduce((sum, p) => sum + p.amount, 0);
                const fmtDay = (d: string) => d.split("-").reverse().join("/");
                const rows = [
                  ...attList.map((att) => ({ kind: "att" as const, id: att.id, when: new Date(att.timestamp), att })),
                  ...penList.map((pen) => ({ kind: "pen" as const, id: pen.id, when: new Date(`${pen.periodEnd}T12:00:00`), pen })),
                ].sort((a, b) => b.when.getTime() - a.when.getTime());
                return (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2 bg-canvas/40 border border-line rounded-xl p-2">
                      <label className="text-[10px] font-bold text-muted uppercase shrink-0">Module :</label>
                      <Select value={attModuleFilter} onChange={(e) => setAttModuleFilter(e.target.value)} className="w-44">
                        <option value="all">Tous les modules</option>
                        {moduleOptions.map((m) => (
                          <option key={m.id} value={m.id}>{m.name}</option>
                        ))}
                      </Select>

                      <label className="text-[10px] font-bold text-muted uppercase shrink-0 ms-2">Date :</label>
                      <div className="flex gap-1">
                        {([
                          ["all", "Tout"],
                          ["month", "Par mois"],
                          ["range", "Période"],
                        ] as const).map(([mode, label]) => (
                          <Button
                            key={mode}
                            size="sm"
                            variant={attDateMode === mode ? "primary" : "outline"}
                            onClick={() => setAttDateMode(mode)}
                          >
                            {label}
                          </Button>
                        ))}
                      </div>

                      {attDateMode === "month" && (
                        <Input
                          type="month"
                          value={attMonth}
                          onChange={(e) => setAttMonth(e.target.value)}
                          className="w-40"
                        />
                      )}
                      {attDateMode === "range" && (
                        <div className="flex items-center gap-1.5">
                          <Input type="date" value={attStart} onChange={(e) => setAttStart(e.target.value)} className="w-36" />
                          <span className="text-[10px] text-muted">→</span>
                          <Input type="date" value={attEnd} onChange={(e) => setAttEnd(e.target.value)} className="w-36" />
                        </div>
                      )}

                      <label className="text-[10px] font-bold text-muted uppercase shrink-0 ms-2">Type :</label>
                      <div className="flex gap-1">
                        {([
                          ["all", "Tout"],
                          ["present", "Présences"],
                          ["absent", "Absences"],
                        ] as const).map(([mode, label]) => (
                          <Button
                            key={mode}
                            size="sm"
                            variant={attKindFilter === mode ? "primary" : "outline"}
                            onClick={() => setAttKindFilter(mode)}
                          >
                            {label}
                          </Button>
                        ))}
                      </div>
                    </div>

                    {/* Compte-rendu du filtre courant */}
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <div className="rounded-xl border border-success/30 bg-success/5 p-2 text-center">
                        <span className="block text-[10px] font-semibold text-muted">Présences</span>
                        <strong className="text-sm text-success">{presentCount}</strong>
                      </div>
                      <div className="rounded-xl border border-warning/30 bg-warning/5 p-2 text-center">
                        <span className="block text-[10px] font-semibold text-muted">Dont retards</span>
                        <strong className="text-sm text-warning">{lateCount}</strong>
                      </div>
                      <div className="rounded-xl border border-danger/30 bg-danger/5 p-2 text-center">
                        <span className="block text-[10px] font-semibold text-muted">Absences</span>
                        <strong className="text-sm text-danger">{absentTotal}</strong>
                      </div>
                      <div className="rounded-xl border border-line bg-canvas/40 p-2 text-center">
                        <span className="block text-[10px] font-semibold text-muted">Total débité</span>
                        <strong className="text-sm text-ink">{chargedTotal} DA</strong>
                      </div>
                    </div>

                    <div className="space-y-2 max-h-72 overflow-y-auto">
                      {rows.length === 0 ? (
                        <p className="text-xs text-muted italic">Aucune présence ni absence pour ces filtres.</p>
                      ) : (
                        rows.map((row) => {
                          if (row.kind === "att") {
                            const att = row.att;
                            const s = sessions.find((se) => se.id === att.sessionId);
                            const modName = s ? modules.find((m) => m.id === s.moduleId)?.name : "Module";
                            const grpName = s ? groups.find((g) => g.id === s.groupId)?.name : undefined;
                            const salleName = s ? salles.find((sl) => sl.id === s.salleId)?.name : undefined;
                            const isAbsent = att.status === "absent";
                            return (
                              <div
                                key={att.id}
                                className={`flex flex-wrap justify-between items-center gap-2 text-xs p-3 rounded-xl border ${
                                  isAbsent ? "bg-danger/5 border-danger/30" : "bg-canvas border-line"
                                }`}
                              >
                                <div className="min-w-0">
                                  <strong className="text-ink block">
                                    {isAbsent ? "Absence" : "Présence"}: {modName}
                                    {grpName ? <span className="text-muted font-semibold"> — {grpName}</span> : null}
                                    {att.substituteGroup && (
                                      <Badge tone="primary" className="ms-1.5 text-[9px] px-1.5 py-0">
                                        <Repeat className="me-0.5 inline h-2.5 w-2.5" /> Autre groupe
                                      </Badge>
                                    )}
                                  </strong>
                                  <span className="text-[10px] text-muted">
                                    {att.timestamp.substring(0, 16).replace("T", " ")}
                                    {s ? ` · ${s.startTime}-${s.endTime}` : ""}
                                    {salleName ? ` · Salle ${salleName}` : ""}
                                  </span>
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <Badge tone={att.status === "present" ? "success" : att.status === "late" ? "warning" : "danger"}>
                                    {att.status === "present" ? "Présent" : att.status === "late" ? "En retard" : "Absent"}
                                  </Badge>
                                  {att.preStart || att.freePeriodId ? (
                                    <span
                                      className="text-[10px] font-bold text-success"
                                      title={
                                        att.preStart
                                          ? "Séance offerte : abonnement pas encore commencé"
                                          : "Séance offerte : période gratuite"
                                      }
                                    >
                                      Offert ({att.waivedAmount ?? 0} DA)
                                    </span>
                                  ) : (
                                    <span className="font-bold text-danger text-[10px]">-{att.amountDeducted} DA</span>
                                  )}
                                  <button
                                    onClick={() => openEditAtt(att)}
                                    title="Modifier cette présence"
                                    className="p-1.5 rounded-lg text-muted hover:bg-primary-50 hover:text-primary transition-colors"
                                  >
                                    <Edit className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    onClick={() => setDeletingAtt(att)}
                                    title="Supprimer cette présence (et rembourser)"
                                    className="p-1.5 rounded-lg text-muted hover:bg-danger/10 hover:text-danger transition-colors"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </div>
                            );
                          }
                          const pen = row.pen;
                          const s = sessions.find((se) => se.id === pen.sessionId);
                          const modName = modules.find((m) => m.id === pen.moduleId)?.name ?? "Module";
                          const grpName = s ? groups.find((g) => g.id === s.groupId)?.name : undefined;
                          return (
                            <div key={pen.id} className="flex flex-wrap justify-between items-center gap-2 text-xs bg-danger/5 border border-danger/30 p-3 rounded-xl">
                              <div className="min-w-0">
                                <strong className="text-ink block">
                                  Absence facturée: {modName}
                                  {grpName ? <span className="text-muted font-semibold"> — {grpName}</span> : null}
                                </strong>
                                <span className="text-[10px] text-muted">
                                  Semaine du {fmtDay(pen.periodStart)} au {fmtDay(pen.periodEnd)}
                                  {" · "}séances restantes après :{" "}
                                  <span className={pen.remainingAfter === 0 ? "text-danger font-bold" : ""}>
                                    {pen.remainingAfter}
                                  </span>
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <Badge tone="danger">Absent (semaine)</Badge>
                                <span className="font-bold text-danger text-[10px]">-1 séance</span>
                                <button
                                  onClick={() => setDeletingPen(pen)}
                                  title="Supprimer cette absence (et recréditer la séance)"
                                  className="p-1.5 rounded-lg text-muted hover:bg-danger/10 hover:text-danger transition-colors"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>

            <div className="flex justify-end pt-2 border-t border-line">
              <Button onClick={() => setIsDetailsOpen(false)}>Fermer</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Correct one presence — the amount only drives the teacher's share */}
      <Modal open={!!editingAtt} onClose={closeAttModals} title="Modifier la présence">
        {editingAtt && (() => {
          const s = sessions.find((se) => se.id === editingAtt.sessionId);
          const modName = s ? modules.find((m) => m.id === s.moduleId)?.name ?? "Module" : "Module";
          const grpName = s ? groups.find((g) => g.id === s.groupId)?.name ?? "-" : "-";
          const owner = students.find((st) => st.id === editingAtt.studentId);
          return (
            <div className="space-y-4">
              <div className="rounded-xl border border-line bg-canvas p-3 text-xs space-y-0.5">
                <strong className="block text-ink">
                  {modName} — {grpName}
                  {editingAtt.substituteGroup && (
                    <Badge tone="primary" className="ms-1.5 text-[9px] px-1.5 py-0">Autre groupe</Badge>
                  )}
                </strong>
                <span className="block text-muted">
                  {owner ? `${owner.firstName} ${owner.lastName} · ` : ""}
                  {s ? `${formatDays(s.days)} · ${s.startTime}-${s.endTime}` : ""}
                </span>
                <span className="block text-muted">
                  Prix de la séance d&apos;origine : {editingAtt.amountDeducted} DA
                </span>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-muted">Statut</label>
                <Select
                  value={attEditStatus}
                  onChange={(e) => setAttEditStatus(e.target.value as AttendanceStatus)}
                  className="w-full"
                >
                  <option value="present">Présent</option>
                  <option value="late">En retard</option>
                  <option value="absent">Absent</option>
                </Select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-muted">Date et heure</label>
                <Input type="datetime-local" value={attEditDate} onChange={(e) => setAttEditDate(e.target.value)} />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-muted">
                  Prix de la séance retenu (DA)
                </label>
                <Input
                  type="number"
                  min={0}
                  value={attEditAmount}
                  onChange={(e) => setAttEditAmount(Number(e.target.value))}
                />
                <p className="mt-1 text-[10px] text-muted">
                  Aucun montant n&apos;est débité à l&apos;élève : ce prix sert uniquement à calculer
                  la part due à l&apos;enseignant. Mettez <strong>0</strong> pour une séance offerte.
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={closeAttModals} disabled={attBusy}>Annuler</Button>
                <Button onClick={handleUpdateAtt} disabled={attBusy || !attEditDate}>
                  {attBusy ? "Enregistrement…" : "Enregistrer"}
                </Button>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* Delete one presence — refunds the séance and clears the teacher due */}
      <Modal open={!!deletingAtt} onClose={closeAttModals} title="Supprimer la présence">
        {deletingAtt && (() => {
          const s = sessions.find((se) => se.id === deletingAtt.sessionId);
          const modName = s ? modules.find((m) => m.id === s.moduleId)?.name ?? "Module" : "Module";
          const grpName = s ? groups.find((g) => g.id === s.groupId)?.name ?? "-" : "-";
          const owner = students.find((st) => st.id === deletingAtt.studentId);
          return (
            <div className="space-y-4">
              <div className="flex items-start gap-2.5 rounded-xl border border-danger/30 bg-danger/5 p-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
                <p className="text-xs leading-relaxed text-ink">
                  La présence sera supprimée, la séance consommée sera recréditée sur son
                  inscription et la part due à l&apos;enseignant pour cette séance sera annulée.
                </p>
              </div>

              <div className="rounded-xl border border-line bg-canvas p-3 text-xs space-y-0.5">
                <strong className="block text-ink">{modName} — {grpName}</strong>
                <span className="block text-muted">
                  {owner ? `${owner.firstName} ${owner.lastName} · ` : ""}
                  {deletingAtt.timestamp.substring(0, 16).replace("T", " ")}
                </span>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={closeAttModals} disabled={attBusy}>Annuler</Button>
                <Button variant="danger" onClick={handleDeleteAtt} disabled={attBusy}>
                  {attBusy ? "Suppression…" : "Supprimer"}
                </Button>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* Delete one automatic weekly-absence charge */}
      <Modal open={!!deletingPen} onClose={closeAttModals} title="Supprimer l'absence facturée">
        {deletingPen && (() => {
          const modName = modules.find((m) => m.id === deletingPen.moduleId)?.name ?? "Module";
          const owner = students.find((st) => st.id === deletingPen.studentId);
          const fmt = (d: string) => d.split("-").reverse().join("/");
          return (
            <div className="space-y-4">
              <div className="flex items-start gap-2.5 rounded-xl border border-danger/30 bg-danger/5 p-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
                <p className="text-xs leading-relaxed text-ink">
                  L&apos;absence hebdomadaire sera supprimée et la séance décomptée sera recréditée
                  sur l&apos;inscription de l&apos;élève.
                </p>
              </div>

              <div className="rounded-xl border border-line bg-canvas p-3 text-xs space-y-0.5">
                <strong className="block text-ink">{modName}</strong>
                <span className="block text-muted">
                  {owner ? `${owner.firstName} ${owner.lastName} · ` : ""}
                  Semaine du {fmt(deletingPen.periodStart)} au {fmt(deletingPen.periodEnd)}
                </span>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={closeAttModals} disabled={attBusy}>Annuler</Button>
                <Button variant="danger" onClick={handleDeletePenalty} disabled={attBusy}>
                  {attBusy ? "Suppression…" : "Supprimer"}
                </Button>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* Card scanner Modal */}
      <Modal open={isScanOpen} onClose={() => { setIsScanOpen(false); setScanResult(null); }} title="Scanner de carte RFID">
        <div className="space-y-4">
          <p className="text-xs text-muted">
            Scannez une carte RFID à l'aide d'un lecteur physique ou saisissez manuellement le code de la carte pour simuler.
          </p>

          <div className="flex gap-2">
            <Input
              value={scanRfidInput}
              onChange={(e) => setScanRfidInput(e.target.value)}
              placeholder="RFID-XXXX"
              className="flex-1 font-mono uppercase"
              onKeyDown={(e) => e.key === "Enter" && handleScanCard()}
              autoFocus
            />
            <Button onClick={handleScanCard}>Valider</Button>
          </div>

          {scanResult && (
            <div className={`p-4 rounded-xl border ${scanResult.ok ? "bg-success/10 border-success/30 text-success" : "bg-danger/10 border-danger/30 text-danger"} space-y-2 text-xs`}>
              <h4 className="font-bold flex items-center gap-1.5">
                {scanResult.ok ? "✔ Succès" : "❌ Échec"}
              </h4>
              <p><strong>Élève:</strong> {scanResult.studentName}</p>
              <p>{scanResult.msg}</p>
              {scanResult.ok && (
                <>
                  <p><strong>Consommé:</strong> {scanResult.consumed ? "1 séance" : "aucune séance"}</p>
                  {scanResult.remaining !== undefined && (
                    <p><strong>Séances restantes:</strong> {scanResult.remaining}</p>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </Modal>

      {/* Alert Low Balance Modal */}
      <Modal
        open={isAlertLowBalanceOpen}
        onClose={() => setIsAlertLowBalanceOpen(false)}
        title="Alerte soldes presque épuisés"
      >
        <div className="space-y-4">
          <p className="text-xs text-muted">
            Les étudiants suivants ont au moins une inscription presque épuisée (2 séances ou moins).
            Chaque élève sélectionné reçoit une notification dans l&apos;application et un message
            WhatsApp personnalisé — envoyé au parent rattaché, ou à l&apos;élève à défaut.
          </p>

          {/* Automatic alert settings (Email & WhatsApp toggles) */}
          <div className="bg-canvas border border-line p-3.5 rounded-2xl space-y-2.5">
            <h4 className="text-[11px] uppercase font-bold text-muted tracking-wider">Alertes Automatiques (au passage de carte)</h4>
            <div className="flex flex-col sm:flex-row gap-4">
              <label className="flex items-center gap-2 text-xs text-ink cursor-pointer font-medium">
                <input
                  type="checkbox"
                  checked={autoSendWhatsapp}
                  onChange={(e) => setAutoSendWhatsapp(e.target.checked)}
                  className="rounded text-primary focus:ring-primary border-line h-4 w-4 bg-surface"
                />
                Envoi automatique WhatsApp
              </label>
              <label className="flex items-center gap-2 text-xs text-ink cursor-pointer font-medium">
                <input
                  type="checkbox"
                  checked={autoSendEmail}
                  onChange={(e) => setAutoSendEmail(e.target.checked)}
                  className="rounded text-primary focus:ring-primary border-line h-4 w-4 bg-surface"
                />
                Envoi automatique Email
              </label>
            </div>
          </div>

          {/* List of low balance students */}
          <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
            {students.filter(isSoonToRunOut).length === 0 ? (
              <p className="text-xs text-muted italic p-4 text-center">Aucun étudiant n'a de séances presque épuisées en ce moment.</p>
            ) : (
              <>
                <div className="flex justify-between items-center px-1 pb-1">
                  <label className="flex items-center gap-2 text-xs font-bold text-ink cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedAlertStudentIds.length === students.filter(isSoonToRunOut).length}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedAlertStudentIds(students.filter(isSoonToRunOut).map(s => s.id));
                        } else {
                          setSelectedAlertStudentIds([]);
                        }
                      }}
                      className="rounded text-primary focus:ring-primary border-line h-4 w-4 bg-surface"
                    />
                    Tout Sélectionner
                  </label>
                  <span className="text-[10px] text-muted font-mono">
                    {selectedAlertStudentIds.length} / {students.filter(isSoonToRunOut).length} élèves
                  </span>
                </div>

                {students.filter(isSoonToRunOut).map((stu) => {
                  const isChecked = selectedAlertStudentIds.includes(stu.id);
                  const parentObj = parents.find((p) => p.id === stu.parentId);

                  return (
                    <div
                      key={stu.id}
                      className="flex items-center justify-between p-2.5 bg-canvas/30 border border-line rounded-xl gap-3 hover:bg-primary-50/10 transition-colors"
                    >
                      <label className="flex items-center gap-2.5 cursor-pointer flex-1 min-w-0">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {
                            if (isChecked) {
                              setSelectedAlertStudentIds(selectedAlertStudentIds.filter(id => id !== stu.id));
                            } else {
                              setSelectedAlertStudentIds([...selectedAlertStudentIds, stu.id]);
                            }
                          }}
                          className="rounded text-primary focus:ring-primary border-line h-4 w-4 bg-surface"
                        />
                        <div className="min-w-0">
                          <strong className="text-xs text-ink block truncate">{stu.firstName} {stu.lastName}</strong>
                          <span className="text-[10px] text-muted block truncate">
                            Parent: {parentObj ? `${parentObj.firstName} (${parentObj.phone})` : "Aucun"}
                          </span>
                        </div>
                      </label>
                      <Badge tone="danger" className="font-mono text-[10px]">
                        {remainingFor(stu)} séance(s)
                      </Badge>
                    </div>
                  );
                })}
              </>
            )}
          </div>

          {/* Action button */}
          <div className="flex justify-end gap-2 pt-4 border-t border-line">
            <Button variant="outline" onClick={() => setIsAlertLowBalanceOpen(false)}>
              Fermer
            </Button>
            <Button
              disabled={selectedAlertStudentIds.length === 0 || sendingAlerts}
              onClick={handleSendLowBalanceAlerts}
              className="flex items-center gap-2"
            >
              <Send className="h-4 w-4" />
              {sendingAlerts
                ? "Envoi en cours…"
                : `Envoyer les alertes (${selectedAlertStudentIds.length})`}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Print payments over a period — pick range, generate, print */}
      <Modal
        open={isPrintPayOpen}
        onClose={() => setIsPrintPayOpen(false)}
        title="Imprimer les paiements — sélectionner la période"
      >
        <div className="space-y-4">
          {selectedStudent && (
            <div className="bg-canvas border border-line rounded-xl p-3 text-xs">
              <span className="text-[10px] text-muted block uppercase">Élève</span>
              <strong className="text-ink block mt-0.5">
                {selectedStudent.firstName} {selectedStudent.lastName}
              </strong>
              <span className="text-muted">
                Séances restantes: {remainingFor(selectedStudent)}
                {debtFor(selectedStudent) > 0 && (
                  <strong className="text-danger"> · Dette: {debtFor(selectedStudent)} DA</strong>
                )}
              </span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-muted mb-1">Date de début</label>
              <Input type="date" value={printPayStart} onChange={(e) => setPrintPayStart(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted mb-1">Date de fin</label>
              <Input type="date" value={printPayEnd} onChange={(e) => setPrintPayEnd(e.target.value)} />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => setIsPrintPayOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handlePrintPayments} className="flex items-center gap-2">
              <Printer className="h-4 w-4" /> Générer & Imprimer
            </Button>
          </div>
        </div>
      </Modal>

      {/* Custom Print Invoice Confirmation Modal */}
      <Modal 
        open={printConfirmData !== null} 
        onClose={() => setPrintConfirmData(null)} 
        title="Reçu de Paiement"
      >
        <div className="space-y-6 text-center py-4">
          <div className="mx-auto w-12 h-12 bg-primary-50 rounded-full flex items-center justify-center text-primary text-xl">
            🖨️
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-bold text-ink">Paiement enregistré avec succès !</h3>
            <p className="text-xs text-muted max-w-sm mx-auto leading-relaxed">
              {printConfirmData?.plan === "month" ? (
                <>
                  <strong>Abonnement mensuel de {printConfirmData?.seances} séance(s)</strong>, valable
                  jusqu&apos;au <strong>{formatDateFr(printConfirmData?.expiryDate)}</strong>, enregistré pour{" "}
                </>
              ) : (
                <>
                  <strong>{printConfirmData?.seances} séance(s)</strong> ajoutée(s) à l&apos;inscription de{" "}
                </>
              )}
              <strong>{printConfirmData?.student.firstName} {printConfirmData?.student.lastName}</strong>{" "}
              ({printConfirmData?.moduleLabel}) — {printConfirmData?.amount} DA reçus
              {(printConfirmData?.rest ?? 0) > 0 && (
                <>, <strong className="text-danger">reste à payer {printConfirmData?.rest} DA</strong></>
              )}.
              Souhaitez-vous imprimer le reçu de paiement ?
            </p>
          </div>
          
          <div className="flex justify-center gap-3 pt-4 border-t border-line">
            <Button 
              variant="outline" 
              onClick={() => setPrintConfirmData(null)}
              className="px-5 py-2 rounded-xl text-xs font-bold"
            >
              Ignorer
            </Button>
            <Button 
              onClick={() => {
                if (printConfirmData) handlePrintInvoice(printConfirmData);
                setPrintConfirmData(null);
              }}
              className="px-5 py-2 rounded-xl text-xs font-bold"
            >
              Imprimer le Reçu
            </Button>
          </div>
        </div>
      </Modal>

      {/* Envoi WhatsApp (élève et/ou parent rattaché) */}
      {waTarget && (
        <WhatsAppMessageModal
          onClose={() => setWaTarget(null)}
          recipients={waTarget.recipients}
          students={waTarget.students}
          defaultRecipientIds={waTarget.defaultRecipientIds}
        />
      )}

      {/* Création d'un élève — the shared screen, also used by the dashboard
          and by every présence sheet. */}
      <CreateStudentModal open={isCreateOpen} onClose={() => setIsCreateOpen(false)} />

      {/* Payer & recharger les soldes — replaces "Inscriptions" + "Renouvellement" */}
      {soldStudent && (
        <SoldManagerModal
          student={students.find((s) => s.id === soldStudent.id) ?? soldStudent}
          open
          onClose={() => setSoldStudent(null)}
        />
      )}
    </div>
  );
}
