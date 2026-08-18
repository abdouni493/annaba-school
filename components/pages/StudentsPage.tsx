"use client";

import { useState, useEffect } from "react";
import { useData, uid } from "@/lib/store/data";
import { createRoleUser, resetUserPassword } from "@/lib/demo/users";
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
  CreditCard,
  Printer,
  DollarSign,
  User,
  BookOpen,
  History,
  CheckCircle,
  Scan,
  Bell,
  Send,
  AlertTriangle,
  MessageCircle,
  Clock,
  Repeat,
  Check,
} from "lucide-react";
import type {
  AbsencePenalty,
  AttendanceRecord,
  AttendanceStatus,
  CaseReduction,
  Student,
  StudentCase,
  Subscription,
  SubscriptionDates,
  SubscriptionDiscount,
  SubscriptionPlan,
  DiscountType,
  Coursework,
} from "@/lib/types";
import {
  addMonths,
  attendedSeances,
  daysUntil,
  discountLabel,
  enrollmentExpiryStatus,
  enrollmentLabel,
  enrollmentUnitPrice,
  formatDateFr,
  formatDays,
  hasMonthlyPlan,
  lostSeances,
  monthlyExpiry,
  monthlyPriceOf,
  monthlySeancesValue,
  netPriceFor,
  remainingSeances,
  studentDebt,
  studentEnrollments,
  studentPayments,
  todayIso,
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
  ClassTimingPicker,
  toggleTimingSelection,
  type ClassTimingOption,
} from "@/components/students/ClassTimingPicker";

/** The billing cases offered when creating or editing a student. */
const STUDENT_CASE_OPTIONS: { value: StudentCase; label: string }[] = [
  { value: "normal", label: "Normal" },
  { value: "special", label: "Cas spécial (gratuit)" },
  { value: "teacher_child", label: "Fils d'enseignant" },
  { value: "reduction", label: "Réduction" },
  { value: "school_only", label: "École seulement" },
];

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
    createEnrollmentPayment,
    setEnrollmentPlan,
    payStudentDebt,
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
  const [isAssignOpen, setIsAssignOpen] = useState(false);
  const [isBuyOpen, setIsBuyOpen] = useState(false);
  const [isPayDebtOpen, setIsPayDebtOpen] = useState(false);
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
  const [studentCase, setStudentCase] = useState<StudentCase>("normal");
  const [teacherFatherId, setTeacherFatherId] = useState("");
  const [teacherFatherSearch, setTeacherFatherSearch] = useState("");
  const [caseRedType, setCaseRedType] = useState<DiscountType>("percent");
  const [caseRedSchool, setCaseRedSchool] = useState<number>(0);
  const [caseRedTeacher, setCaseRedTeacher] = useState<number>(0);
  const [unpaidTeacherIds, setUnpaidTeacherIds] = useState<string[]>([]);
  const [unpaidTeacherSearch, setUnpaidTeacherSearch] = useState("");

  /** Collapses the case form into the fields actually stored on the student. */
  const caseFieldsFor = (kind: StudentCase) => ({
    studentCase: kind,
    isFree: kind === "special",
    teacherFatherId: kind === "teacher_child" ? teacherFatherId || undefined : undefined,
    caseReduction:
      kind === "reduction"
        ? ({ type: caseRedType, schoolValue: caseRedSchool || 0, teacherValue: caseRedTeacher || 0 } as CaseReduction)
        : undefined,
    unpaidTeacherIds: kind === "school_only" ? unpaidTeacherIds : undefined,
  });

  const resetCaseForm = () => {
    setStudentCase("normal");
    setTeacherFatherId("");
    setTeacherFatherSearch("");
    setCaseRedType("percent");
    setCaseRedSchool(0);
    setCaseRedTeacher(0);
    setUnpaidTeacherIds([]);
    setUnpaidTeacherSearch("");
  };

  // Form: inscriptions taken WHILE creating the student — reception searches the
  // student's class, the class opens its timings, and one or several of them are
  // ticked. Each ticked timing is one inscription, stored on the new student
  // exactly like the "Affecter des abonnements" modal stores them.
  const [createSubIds, setCreateSubIds] = useState<string[]>([]);
  const [createPlans, setCreatePlans] = useState<Record<string, SubscriptionPlan>>({});
  const [createStartDates, setCreateStartDates] = useState<Record<string, string>>({});

  // Form: the first recharge, paid at the desk on the same screen. It credits ONE
  // of the inscriptions above and is written to the student's payment history
  // through the very same store action the "Payer des séances" modal uses.
  const [createPayEnabled, setCreatePayEnabled] = useState(false);
  const [createPaySubId, setCreatePaySubId] = useState("");
  const [createPaySeances, setCreatePaySeances] = useState<number>(0);
  const [createPayDiscountType, setCreatePayDiscountType] = useState<DiscountType>("percent");
  const [createPayDiscountValue, setCreatePayDiscountValue] = useState<number>(0);
  const [createPayAmountPaid, setCreatePayAmountPaid] = useState<number>(0);
  const [createPayDesc, setCreatePayDesc] = useState("");
  const [createBusy, setCreateBusy] = useState(false);

  // Form: renewing an inscription (replaces the old money "recharge")
  const [buySearch, setBuySearch] = useState("");
  /** the renewal screen shows the student's own inscriptions; this opens the
   *  rest of the catalogue, for the rarer "sell him a new module" case */
  const [buyShowOthers, setBuyShowOthers] = useState(false);
  const [buySubId, setBuySubId] = useState("");
  const [buySeances, setBuySeances] = useState<number>(0);
  // "seance" = N séances at the unit price · "month" = one whole month, which
  // starts on `buyStartDate` and expires exactly one month later.
  const [buyPlan, setBuyPlan] = useState<SubscriptionPlan>("seance");
  const [buyStartDate, setBuyStartDate] = useState<string>(todayIso());
  const [buyDiscountType, setBuyDiscountType] = useState<DiscountType>("percent");
  const [buyDiscountValue, setBuyDiscountValue] = useState<number>(0);
  const [buyAmountPaid, setBuyAmountPaid] = useState<number>(0);
  const [buyDesc, setBuyDesc] = useState("");
  const [buyBusy, setBuyBusy] = useState(false);

  // Form: Pay Debt
  const [payAmount, setPayAmount] = useState<number>(0);

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
  const [selectedAssignIds, setSelectedAssignIds] = useState<string[]>([]); // subscription or coursework ids
  // Enrollment dates, kept per subscription id for EVERY module (cours and
  // formations): the day the student was registered, and the day billing opens.
  const [assignSubDates, setAssignSubDates] = useState<Record<string, string>>({}); // sub id -> date d'inscription
  const [assignStartDates, setAssignStartDates] = useState<Record<string, string>>({}); // sub id -> date de début
  // Formula chosen for each module: séance by séance (the default) or by month.
  const [assignPlans, setAssignPlans] = useState<Record<string, SubscriptionPlan>>({});
  // Per-module reduction: subscription id -> { type, value }
  const [assignDiscounts, setAssignDiscounts] = useState<Record<string, SubscriptionDiscount>>({});
  // "Réduction groupée": one reduction applied at once to every ticked module
  const [bulkDiscountType, setBulkDiscountType] = useState<DiscountType>("percent");
  const [bulkDiscountValue, setBulkDiscountValue] = useState<number>(0);

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

  const getSubLabel = (subId: string) => {
    const sub = subscriptions.find((s) => s.id === subId);
    if (!sub) {
      // Check if it's a coursework instead
      const cw = coursework.find((c) => c.id === subId);
      if (cw) return `Stage: ${cw.name}`;
      return "Abonnement inconnu";
    }
    const s = sessions.find((se) => se.id === sub.sessionId);
    if (!s) return "Séance inconnue";
    const mod = modules.find((m) => m.id === s.moduleId)?.name ?? "Module";
    const cls = classes.find((c) => c.id === s.classId)?.name ?? "Classe";
    return `${cls} - ${mod}`;
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

  /** The subscription, if it belongs to a formation class (level-priced, time-limited). */
  const getFormationSub = (subId: string): Subscription | undefined => {
    const sub = subscriptions.find((s) => s.id === subId);
    if (!sub) return undefined;
    const sess = sessions.find((se) => se.id === sub.sessionId);
    const cls = sess ? classes.find((c) => c.id === sess.classId) : undefined;
    return cls?.type === "formation" || sub.periodMonths ? sub : undefined;
  };

  /** How a module is (or is about to be) sold to the student. */
  const planOf = (subId: string): SubscriptionPlan => assignPlans[subId] ?? "seance";

  /**
   * The day an inscription stops being valid:
   *  - monthly plan: exactly one month after its start date,
   *  - formation: its level duration after its start date,
   *  - séances bought one by one: never.
   * Past that day the card is refused and the séances still on the counter are
   * lost — which is the whole point of the monthly formula.
   */
  const expiryFor = (subId: string, startDate: string, plan: SubscriptionPlan) => {
    if (plan === "month") return monthlyExpiry(startDate);
    const formationSub = getFormationSub(subId);
    return formationSub ? addMonths(startDate, formationSub.periodMonths ?? 0) : undefined;
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

  // ---- Creation modal: timings ticked on the class picker, and the recharge --
  /** Ticking a timing enrolls the student on it; unticking removes it. Several
   *  timings can be ticked, from several classes — they are all kept. Ticking
   *  another group of a cours the student is already on MOVES him to it: a
   *  cours is followed through exactly one of its groups. */
  const toggleCreateTiming = (opt: ClassTimingOption) => {
    const alreadyPicked = createSubIds.includes(opt.subId);
    const next = toggleTimingSelection(createSubIds, opt);
    setCreateSubIds(next);

    if (alreadyPicked) {
      // The recharge was aimed at the inscription that just left the basket.
      if (createPaySubId === opt.subId) setCreatePaySubId(next[0] ?? "");
      return;
    }
    // Moving groups keeps the dates and the formula already chosen for the cours.
    const moved = createSubIds.find((id) => opt.siblingSubIds.includes(id));
    setCreateStartDates({
      ...createStartDates,
      [opt.subId]:
        createStartDates[opt.subId] ?? (moved ? createStartDates[moved] : undefined) ?? todayIso(),
    });
    setCreatePlans({
      ...createPlans,
      [opt.subId]:
        createPlans[opt.subId] ?? (moved ? createPlans[moved] : undefined) ?? "seance",
    });
    if (!createPaySubId || createPaySubId === moved) setCreatePaySubId(opt.subId);
  };

  /** The formula an inscription is taken on, capped by what the tariff offers. */
  const createPlanOf = (subId: string): SubscriptionPlan =>
    createPlans[subId] === "month" && hasMonthlyPlan(subscriptions.find((s) => s.id === subId))
      ? "month"
      : "seance";

  /** Prefills what the family hands over: paying in full is the common case at
   *  the desk, the cashier only edits it when part of it is left owing. `plan`
   *  is passed explicitly by the formula buttons, whose setState has not landed
   *  yet when this runs. */
  const prefillCreatePayAmount = (subId: string, seances: number, plan?: SubscriptionPlan) => {
    const sub = subscriptions.find((s) => s.id === subId);
    const monthly = (plan ?? createPlanOf(subId)) === "month" && hasMonthlyPlan(sub);
    const gross = monthly
      ? monthlyPriceOf(sub)
      : (sub?.pricePerSession ?? 0) * Math.max(0, Math.round(seances || 0));
    setCreatePayAmountPaid(
      netPriceFor(
        gross,
        createPayDiscountValue > 0
          ? { type: createPayDiscountType, value: createPayDiscountValue }
          : undefined,
      ),
    );
  };

  // The first recharge is priced exactly like the "Payer des séances" modal:
  // the unit price is the subscription's own, the month is the tariff's pack at
  // the tariff's price, and the remise runs through the shared helper.
  const createPaySub = subscriptions.find((s) => s.id === createPaySubId);
  const createPayPlan = createPaySubId ? createPlanOf(createPaySubId) : "seance";
  const createPayMonthly = createPayPlan === "month";
  const createPayUnitPrice = createPaySub?.pricePerSession ?? 0;
  const createPayMonthSeances = createPaySub?.monthlySeances ?? 0;
  const createPayCount = createPayMonthly
    ? createPayMonthSeances
    : Math.max(0, Math.round(createPaySeances || 0));
  const createPayGross = createPayMonthly
    ? monthlyPriceOf(createPaySub)
    : createPayUnitPrice * createPayCount;
  const createPayDiscount: SubscriptionDiscount | undefined =
    createPayDiscountValue > 0
      ? { type: createPayDiscountType, value: createPayDiscountValue }
      : undefined;
  const createPayNet = netPriceFor(createPayGross, createPayDiscount);
  const createPayRest = Math.max(0, createPayNet - Math.max(0, Math.round(createPayAmountPaid || 0)));
  const createPayStartDate = createStartDates[createPaySubId] || todayIso();
  const createPayExpiry = createPayMonthly ? monthlyExpiry(createPayStartDate) : undefined;

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

  /** Séances left, per student and in total — the new "balance". */
  const remainingFor = (student: Student) => totalRemainingSeances(db, student.id);
  const debtFor = (student: Student) => studentDebt(db, student.id);

  /** At least one inscription is down to its last two séances (or already at
   *  zero) — the séance-based replacement for the old "low balance". */
  const isSoonToRunOut = (student: Student) => {
    if (student.isFree) return false;
    const mine = studentEnrollments(db, student.id);
    if (mine.length === 0) return false;
    return mine.some((e) => remainingSeances(e) <= 2);
  };

  // Filter students based on queries
  const getFilteredStudents = () => {
    return students.filter((s) => {
      const nameMatch = `${s.firstName} ${s.lastName}`.toLowerCase().includes(searchQuery.toLowerCase());
      const phoneMatch = s.phone.includes(searchQuery);
      const emailMatch = s.email.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesSearch = nameMatch || phoneMatch || emailMatch;

      if (!matchesSearch) return false;

      if (filterType === "debt") return debtFor(s) > 0 || (s.registrationDue ?? 0) > 0;
      if (filterType === "paid") return debtFor(s) === 0 && (s.registrationDue ?? 0) === 0;
      if (filterType === "free") return s.isFree;
      if (filterType === "soon") return isSoonToRunOut(s);

      return true;
    });
  };

  const handleCreateStudent = async () => {
    if (!firstName || !lastName || !phone) {
      alert("Prénom, nom et téléphone sont obligatoires.");
      return;
    }
    if (studentCase === "teacher_child" && !teacherFatherId) {
      alert("Sélectionnez l'enseignant père pour ce cas.");
      return;
    }
    if (studentCase === "school_only" && unpaidTeacherIds.length === 0) {
      alert("Sélectionnez au moins un enseignant qui ne sera pas payé pour cet étudiant.");
      return;
    }
    // The first recharge credits ONE inscription: without a ticked timing there
    // is nothing to buy séances on.
    if (createPayEnabled) {
      if (!createPaySubId) {
        alert("Sélectionnez le créneau à créditer pour le premier rechargement.");
        return;
      }
      if (!createPayMonthly && createPaySeances <= 0) {
        alert("Veuillez saisir le nombre de séances du premier rechargement.");
        return;
      }
      if (createPayMonthly && createPayMonthSeances <= 0) {
        alert("Ce module n'a pas de formule mensuelle. Définissez-la sur la page Abonnements.");
        return;
      }
    }

    // Credentials and the badge id are generated silently now — reception only
    // types name + phone (+ optional birthdate).
    const cleanBase = `${firstName}${lastName}`.toLowerCase().replace(/\s+/g, "");
    const genSuffix = birthDate.replace(/-/g, "") || phone.replace(/\D/g, "").slice(-4) || "0000";
    const finalEmail = email || `${cleanBase}${genSuffix}@elilm.com`;
    const finalPassword = password && password.length >= 6 ? password : `${cleanBase}${genSuffix}`;
    const finalRfid = rfid || uid("rfid");
    const caseFields = caseFieldsFor(studentCase);

    // Inscriptions taken on this screen, with the same dates the "Affecter"
    // modal writes: the registration day, the day billing opens, and the day it
    // all stops (monthly formula or formation level).
    const subscriptionDates: Record<string, SubscriptionDates> = {};
    for (const subId of createSubIds) {
      if (!subscriptions.some((s) => s.id === subId)) continue;
      const startDate = createStartDates[subId] || todayIso();
      const plan = createPlanOf(subId);
      subscriptionDates[subId] = {
        subscribedAt: todayIso(),
        startDate,
        expiryDate: expiryFor(subId, startDate, plan),
        plan,
      };
    }
    // The one-time registration fee is charged once, on first enrollment
    // (paying students only) — exactly as the assignment modal does it.
    const registrationDue =
      createSubIds.length > 0 && !caseFields.isFree ? school?.registrationFee || 0 : 0;

    setCreateBusy(true);
    try {
      const { id: studentId } = await createRoleUser({
        role: "student",
        email: finalEmail,
        password: finalPassword,
        firstName,
        lastName,
        phone,
        birthDate,
        rfid: finalRfid,
        isFree: caseFields.isFree,
        subscriptionIds: createSubIds,
        registrationDue,
      });

      const newStudent: Student = {
        id: studentId,
        firstName,
        lastName,
        birthDate,
        phone,
        email: finalEmail,
        rfid: finalRfid,
        isFree: caseFields.isFree,
        studentCase: caseFields.studentCase,
        teacherFatherId: caseFields.teacherFatherId,
        caseReduction: caseFields.caseReduction,
        unpaidTeacherIds: caseFields.unpaidTeacherIds,
        subscriptionIds: createSubIds,
        subscriptionDates,
        registrationDue,
      };
      push("students", newStudent);

      // Keep the portal password so the payment receipt can print the login.
      // It lives in a staff-only table — never readable by the student/parent.
      await setStudentPassword(studentId, finalPassword);

      // ---- First recharge, on the very same screen -------------------------
      // Same store action as "Payer des séances": it opens the inscription's
      // séance counter, writes the payment in the student's history (with the
      // part left unpaid) and posts the cash movement.
      if (createPayEnabled && createPaySubId) {
        const moduleLabel = getModuleLabel(createPaySubId);
        const description =
          createPayDesc.trim() ||
          (createPayMonthly
            ? `Premier abonnement mensuel (${createPayMonthSeances} séances) du ${formatDateFr(createPayStartDate)} au ${formatDateFr(createPayExpiry)} — ${moduleLabel}`
            : `Premier rechargement de ${createPayCount} séance(s) — ${moduleLabel}`);
        const formationSub = getFormationSub(createPaySubId);
        const res = await createEnrollmentPayment({
          studentId,
          subscriptionId: createPaySubId,
          seances: createPayCount,
          plan: createPayMonthly ? "month" : "seance",
          monthSeances: createPayMonthly ? createPayMonthSeances : undefined,
          packagePrice: createPayMonthly ? createPayGross : undefined,
          discountType: createPayDiscount?.type,
          discountValue: createPayDiscount?.value,
          amountPaid: createPayAmountPaid,
          startDate: createPayStartDate,
          expiryDate: createPayMonthly
            ? createPayExpiry
            : formationSub
              ? addMonths(createPayStartDate, formationSub.periodMonths ?? 0)
              : undefined,
          description,
        });

        if (!res.ok) {
          setCreateBusy(false);
          alert("L'étudiant a été créé, mais le premier rechargement n'a pas pu être enregistré.");
          return;
        }

        const bought = createPayMonthly
          ? `Mois de ${createPayCount} séance(s) sur ${moduleLabel}, valable jusqu'au ${formatDateFr(createPayExpiry)}`
          : `${createPayCount} séance(s) ajoutée(s) sur ${moduleLabel}`;
        addToast({
          type: (res.rest ?? 0) > 0 ? "warning" : "success",
          title: "Étudiant créé et premier rechargement enregistré",
          message:
            (res.rest ?? 0) > 0
              ? `${bought}. Reste à payer : ${res.rest} DA.`
              : `${bought}. Payé intégralement.`,
          studentName: `${firstName} ${lastName}`,
        });
        setPrintConfirmData({
          student: newStudent,
          amount: createPayAmountPaid,
          description,
          settledReg: false,
          seances: createPayCount,
          plan: createPayMonthly ? "month" : "seance",
          expiryDate: createPayExpiry,
          moduleLabel,
          unitPrice: createPayUnitPrice,
          grossTotal: createPayGross,
          netTotal: createPayNet,
          discountLabel: discountLabel(createPayDiscount),
          rest: res.rest ?? 0,
        });
      } else {
        addToast({
          type: "success",
          title: "Étudiant créé",
          message:
            createSubIds.length > 0
              ? `${createSubIds.length} inscription(s) enregistrée(s) sur sa fiche.`
              : "Aucune inscription pour le moment — à affecter depuis sa fiche.",
          studentName: `${firstName} ${lastName}`,
        });
      }

      setCreateBusy(false);
      setIsCreateOpen(false);
      resetForm();
    } catch (err) {
      setCreateBusy(false);
      alert(err instanceof Error ? err.message : "Erreur lors de la création du compte.");
    }
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

  const handleDelete = (id: string) => {
    if (confirm("Êtes-vous sûr de vouloir supprimer cet étudiant ?")) {
      deleteFrom("students", id);
      setOverlayStudentId(null);
    }
  };

  // ---- Renewing an inscription ------------------------------------------------
  /** The student's CURRENT inscriptions, each with what is left on it: the
   *  renewal screen is built on these, so reception sees what it is topping up
   *  before it charges anything. Stages carry no séance counter — they are not
   *  renewed here. */
  const currentInscriptions = (stu: Student) => {
    const rows = stu.subscriptionIds.flatMap((subId) => {
      const sub = subscriptions.find((s) => s.id === subId);
      if (!sub) return [];
      const enr = enrollments.find(
        (e) => e.studentId === stu.id && e.subscriptionId === subId,
      );
      const dates = stu.subscriptionDates?.[subId];
      const expiryDate = enr?.expiryDate ?? dates?.expiryDate;
      const remaining = enr ? remainingSeances(enr) : 0;
      const expired = !!expiryDate && daysUntil(expiryDate) < 0;
      return [
        {
          id: subId,
          label: getModuleLabel(subId),
          price: sub.pricePerSession,
          hasMonthly: hasMonthlyPlan(sub),
          monthlySeances: sub.monthlySeances ?? 0,
          monthlyPrice: monthlyPriceOf(sub),
          plan: (enr?.plan ?? dates?.plan ?? "seance") as SubscriptionPlan,
          remaining,
          consumed: enr?.consumedSeances ?? 0,
          /** séances paid for but lost when the period expired */
          lost: enr ? lostSeances(enr) : 0,
          /** enrolled, but no séance ever paid on it */
          neverPaid: !enr,
          expiryDate,
          daysLeft: expiryDate ? daysUntil(expiryDate) : null,
          expired,
          /** expired or down to its last séances: what reception must renew */
          urgent: expired || remaining <= 2,
        },
      ];
    });
    return rows.sort(
      (a, b) =>
        Number(b.urgent) - Number(a.urgent) ||
        a.remaining - b.remaining ||
        a.label.localeCompare(b.label),
    );
  };

  /** Priced modules the student is NOT on yet: paying one here enrolls him,
   *  so the renewal screen doubles as a desk sale when needed. */
  const otherSubscriptions = (stu: Student) =>
    subscriptions
      .filter((sub) => !stu.subscriptionIds.includes(sub.id))
      .map((sub) => ({
        id: sub.id,
        label: getModuleLabel(sub.id),
        price: sub.pricePerSession,
        hasMonthly: hasMonthlyPlan(sub),
        monthlySeances: sub.monthlySeances ?? 0,
        monthlyPrice: monthlyPriceOf(sub),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));

  // The unit price never comes from the form: it is the subscription's own
  // séance price, so what is billed is always what the Abonnements page set.
  // A month is the same story one level up: its pack and its price are the
  // tariff's, and buying it opens a period that ends one month later.
  const buySub = subscriptions.find((s) => s.id === buySubId);
  const buyUnitPrice = buySub?.pricePerSession ?? 0;
  const buyMonthly = buyPlan === "month" && hasMonthlyPlan(buySub);
  const buyMonthSeances = buySub?.monthlySeances ?? 0;
  const buyCount = buyMonthly ? buyMonthSeances : Math.max(0, Math.round(buySeances || 0));
  const buyGross = buyMonthly ? monthlyPriceOf(buySub) : buyUnitPrice * buyCount;
  const buyExpiry = buyMonthly ? monthlyExpiry(buyStartDate || todayIso()) : undefined;
  const buyDiscount: SubscriptionDiscount | undefined =
    buyDiscountValue > 0 ? { type: buyDiscountType, value: buyDiscountValue } : undefined;
  const buyNet = netPriceFor(buyGross, buyDiscount);
  const buyRest = Math.max(0, buyNet - Math.max(0, Math.round(buyAmountPaid || 0)));

  const handleBuySeances = async () => {
    if (!selectedStudent || !buySubId) return;
    if (!buyMonthly && buySeances <= 0) {
      alert("Veuillez saisir le nombre de séances à payer.");
      return;
    }
    if (buyMonthly && buyMonthSeances <= 0) {
      alert("Ce module n'a pas de formule mensuelle. Définissez-la sur la page Abonnements.");
      return;
    }
    const stu = selectedStudent;
    const moduleLabel = getModuleLabel(buySubId);
    const description =
      buyDesc.trim() ||
      (buyMonthly
        ? `Abonnement mensuel (${buyMonthSeances} séances) du ${formatDateFr(buyStartDate)} au ${formatDateFr(buyExpiry)} — ${moduleLabel}`
        : `Paiement de ${buySeances} séance(s) — ${moduleLabel}`);

    setBuyBusy(true);
    // A month always opens on the date chosen here; séances bought one by one
    // keep the start date already recorded on the inscription.
    const startDate = buyMonthly
      ? buyStartDate || todayIso()
      : stu.subscriptionDates?.[buySubId]?.startDate ?? todayIso();
    const formationSub = getFormationSub(buySubId);
    const res = await createEnrollmentPayment({
      studentId: stu.id,
      subscriptionId: buySubId,
      seances: buySeances,
      plan: buyMonthly ? "month" : "seance",
      monthSeances: buyMonthly ? buyMonthSeances : undefined,
      packagePrice: buyMonthly ? buyGross : undefined,
      discountType: buyDiscount?.type,
      discountValue: buyDiscount?.value,
      amountPaid: buyAmountPaid,
      startDate,
      expiryDate: buyMonthly
        ? buyExpiry
        : stu.subscriptionDates?.[buySubId]?.expiryDate ??
          (formationSub ? addMonths(startDate, formationSub.periodMonths ?? 0) : undefined),
      description,
    });
    setBuyBusy(false);

    if (!res.ok) {
      alert("Enregistrement du paiement impossible.");
      return;
    }

    setIsBuyOpen(false);
    setOverlayStudentId(null);
    const bought = buyMonthly
      ? `Mois de ${buyCount} séance(s) sur ${moduleLabel}, valable jusqu'au ${formatDateFr(buyExpiry)}`
      : `${buyCount} séance(s) ajoutée(s) sur ${moduleLabel}`;
    addToast({
      type: (res.rest ?? 0) > 0 ? "warning" : "success",
      title: buyMonthly ? "Abonnement mensuel enregistré" : "Séances enregistrées",
      message:
        (res.rest ?? 0) > 0
          ? `${bought}. Reste à payer : ${res.rest} DA.`
          : `${bought}. Payé intégralement.`,
      studentName: `${stu.firstName} ${stu.lastName}`,
    });

    setPrintConfirmData({
      student: stu,
      amount: buyAmountPaid,
      description,
      settledReg: false,
      seances: buyCount,
      plan: buyMonthly ? "month" : "seance",
      expiryDate: buyExpiry,
      moduleLabel,
      unitPrice: buyUnitPrice,
      grossTotal: buyGross,
      netTotal: buyNet,
      discountLabel: discountLabel(buyDiscount),
      rest: res.rest ?? 0,
    });
  };

  const handlePayDebtSubmit = async () => {
    if (!selectedStudent || payAmount <= 0) return;
    const stu = selectedStudent;
    const res = await payStudentDebt(stu.id, payAmount);
    setIsPayDebtOpen(false);
    setOverlayStudentId(null);
    if (!res.ok) {
      addToast({ type: "info", title: "Aucune dette à régler", message: "Ce compte est à jour." });
      return;
    }
    addToast({
      type: (res.remainingDebt ?? 0) > 0 ? "warning" : "success",
      title: "Dette réglée",
      message:
        (res.remainingDebt ?? 0) > 0
          ? `${res.settled} DA encaissés. Reste dû : ${res.remainingDebt} DA.`
          : `${res.settled} DA encaissés. Le compte est soldé.`,
      studentName: `${stu.firstName} ${stu.lastName}`,
    });
  };

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

  const resetForm = () => {
    setFirstName("");
    setLastName("");
    setBirthDate("");
    setPhone("");
    setRfid("");
    setEmail("");
    setPassword("");
    setIsFree(false);
    resetCaseForm();
    setBuySubId("");
    setBuySearch("");
    setBuySeances(0);
    setBuyPlan("seance");
    setBuyStartDate(todayIso());
    setBuyDiscountType("percent");
    setBuyDiscountValue(0);
    setBuyAmountPaid(0);
    setBuyDesc("");
    setPayAmount(0);
    setSelectedAssignIds([]);
    setAssignStartDates({});
    setAssignSubDates({});
    setAssignPlans({});
    setAssignDiscounts({});
    setBulkDiscountType("percent");
    setBulkDiscountValue(0);
    setSelectedStudent(null);
    setIsEmailDirty(false);
    setIsPasswordDirty(false);
    setCreateSubIds([]);
    setCreatePlans({});
    setCreateStartDates({});
    setCreatePayEnabled(false);
    setCreatePaySubId("");
    setCreatePaySeances(0);
    setCreatePayDiscountType("percent");
    setCreatePayDiscountValue(0);
    setCreatePayAmountPaid(0);
    setCreatePayDesc("");
    setCreateBusy(false);
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
          remainingSeances: remainingFor(stu),
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
        title: "Alerte : séances bientôt épuisées",
        description: `Rappel de paiement: ${stu.firstName} ${stu.lastName} n'a plus que ${remainingFor(stu)} séance(s). Merci de régler de nouvelles séances à la réception pour éviter toute interruption.`,
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
          remainingSeances: remainingFor(stu),
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

  const openAssign = (stu: Student) => {
    setSelectedStudent(stu);
    setSelectedAssignIds(stu.subscriptionIds);
    // Reopen on the dates and formulas already recorded, so the modal doubles
    // as the edit screen for them (an empty date falls back to today at save
    // time). The enrollment row wins: it is what the scanner actually reads.
    const starts: Record<string, string> = {};
    const subscribed: Record<string, string> = {};
    const plans: Record<string, SubscriptionPlan> = {};
    for (const subId of stu.subscriptionIds) {
      const dates = stu.subscriptionDates?.[subId];
      const enr = enrollments.find((e) => e.studentId === stu.id && e.subscriptionId === subId);
      const start = enr?.startDate ?? dates?.startDate;
      if (start) starts[subId] = start;
      if (dates?.subscribedAt) subscribed[subId] = dates.subscribedAt;
      const plan = enr?.plan ?? dates?.plan;
      if (plan) plans[subId] = plan;
    }
    setAssignStartDates(starts);
    setAssignSubDates(subscribed);
    setAssignPlans(plans);
    setAssignDiscounts({ ...(stu.subscriptionDiscounts ?? {}) });
    setBulkDiscountType("percent");
    setBulkDiscountValue(0);
    setIsAssignOpen(true);
    setOverlayStudentId(null);
  };

  /** Apply the "réduction groupée" to every currently ticked module at once,
   *  instead of setting each one individually. */
  const applyBulkDiscount = () => {
    if (selectedAssignIds.length === 0) {
      alert("Sélectionnez d'abord les modules concernés par la réduction.");
      return;
    }
    const next = { ...assignDiscounts };
    for (const id of selectedAssignIds) {
      if (bulkDiscountValue > 0) next[id] = { type: bulkDiscountType, value: bulkDiscountValue };
      else delete next[id];
    }
    setAssignDiscounts(next);
  };

  const clearAllDiscounts = () => {
    setAssignDiscounts({});
    setBulkDiscountValue(0);
  };

  const setItemDiscount = (id: string, patch: Partial<SubscriptionDiscount>) => {
    setAssignDiscounts((prev) => {
      const current = prev[id] ?? { type: "percent" as DiscountType, value: 0 };
      const merged = { ...current, ...patch };
      const next = { ...prev };
      if (merged.value > 0) next[id] = merged;
      else delete next[id];
      return next;
    });
  };

  /** Opens the séance-purchase modal, pre-selecting the inscription that is
   *  closest to running out — the one reception is most likely renewing. */
  const openBuySeances = (stu: Student) => {
    setSelectedStudent(stu);
    // Opens on the inscription that needs renewing most: expired first, then
    // the one closest to running out — the one reception is at the desk for.
    const mine = currentInscriptions(stu);
    const target = mine[0]?.id ?? "";
    setBuySubId(target);
    // A module already sold by the month reopens on that formula: the common
    // case at the desk is renewing the month that just ran out.
    const targetRow = mine[0];
    setBuyPlan(targetRow?.plan === "month" && targetRow.hasMonthly ? "month" : "seance");
    setBuyStartDate(todayIso());
    setBuySearch("");
    setBuyShowOthers(mine.length === 0);
    setBuySeances(0);
    setBuyDiscountType("percent");
    setBuyDiscountValue(0);
    setBuyAmountPaid(
      targetRow?.plan === "month" && targetRow.hasMonthly ? targetRow.monthlyPrice : 0,
    );
    setBuyDesc("");
    setIsBuyOpen(true);
    setOverlayStudentId(null);
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

  const openPayDebt = (stu: Student) => {
    setSelectedStudent(stu);
    // Defaults to the full outstanding rest of every unpaid purchase.
    setPayAmount(debtFor(stu));
    setIsPayDebtOpen(true);
    setOverlayStudentId(null);
  };

  const handleAssignSubmit = async () => {
    if (!selectedStudent) return;

    // The one-time registration fee is charged once, on first enrollment
    // (paying students only). It is configured globally on the Abonnements page.
    const wasEnrolled = selectedStudent.subscriptionIds.length > 0;
    const willBeEnrolled = selectedAssignIds.length > 0;
    const chargeRegistration =
      !wasEnrolled && willBeEnrolled && !selectedStudent.isFree
        ? school?.registrationFee || 0
        : 0;

    // Enrollment dates for EVERY module: the registration day (informative) and
    // the day billing opens — a séance attended before it is recorded but never
    // charged. A monthly formula (and a formation) adds the day it all stops.
    const subscriptionDates: Record<string, SubscriptionDates> = {};
    const plannedEnrollments: Array<{
      subId: string;
      plan: SubscriptionPlan;
      startDate: string;
      expiryDate?: string;
    }> = [];
    for (const subId of selectedAssignIds) {
      // Stages ("coursework") are not subscriptions — they carry no dates.
      const sub = subscriptions.find((s) => s.id === subId);
      if (!sub) continue;
      const startDate = assignStartDates[subId] || todayIso();
      // A formula can only be monthly if the tariff actually defines one.
      const plan: SubscriptionPlan = planOf(subId) === "month" && hasMonthlyPlan(sub) ? "month" : "seance";
      const expiryDate = expiryFor(subId, startDate, plan);
      subscriptionDates[subId] = {
        subscribedAt: assignSubDates[subId] || todayIso(),
        startDate,
        expiryDate,
        plan,
      };
      plannedEnrollments.push({ subId, plan, startDate, expiryDate });
    }

    // Only keep reductions that still belong to a selected module.
    const subscriptionDiscounts: Record<string, SubscriptionDiscount> = {};
    for (const subId of selectedAssignIds) {
      const d = assignDiscounts[subId];
      if (d && d.value > 0) subscriptionDiscounts[subId] = d;
    }

    updateItem("students", selectedStudent.id, {
      subscriptionIds: selectedAssignIds,
      subscriptionDates,
      subscriptionDiscounts,
      registrationDue: (selectedStudent.registrationDue || 0) + chargeRegistration,
    });

    // The séance counters carry their own copy of the period — it is the one
    // the scanner reads — so an inscription edited here has to be realigned.
    for (const row of plannedEnrollments) {
      await setEnrollmentPlan(selectedStudent.id, row.subId, {
        plan: row.plan,
        startDate: row.startDate,
        expiryDate: row.expiryDate,
        monthSeances:
          row.plan === "month"
            ? subscriptions.find((s) => s.id === row.subId)?.monthlySeances
            : undefined,
      });
    }

    setIsAssignOpen(false);
    resetForm();
  };

  // ---- What can be assigned -------------------------------------------------
  // Modules are picked on the shared class picker: search the student's class,
  // open it, tick its timings. A cours is followed through exactly ONE of its
  // groups, so ticking another group of the same cours MOVES him to it.
  /** Ticks/unticks one timing on the inscription modal. */
  const toggleAssignTiming = (opt: ClassTimingOption) => {
    const alreadyPicked = selectedAssignIds.includes(opt.subId);
    const moved = selectedAssignIds.find((id) => opt.siblingSubIds.includes(id));
    const next = toggleTimingSelection(selectedAssignIds, opt);
    setSelectedAssignIds(next);
    if (alreadyPicked) return;
    // A newly ticked module starts today by default; moving the student to
    // another group of the same cours keeps the dates and the formula already
    // chosen. All of them stay editable under "Inscriptions retenues".
    setAssignStartDates({
      ...assignStartDates,
      [opt.subId]:
        assignStartDates[opt.subId] ?? (moved ? assignStartDates[moved] : undefined) ?? todayIso(),
    });
    setAssignSubDates({
      ...assignSubDates,
      [opt.subId]:
        assignSubDates[opt.subId] ?? (moved ? assignSubDates[moved] : undefined) ?? todayIso(),
    });
    setAssignPlans({
      ...assignPlans,
      [opt.subId]: assignPlans[opt.subId] ?? (moved ? assignPlans[moved] : undefined) ?? "seance",
    });
    // The reduction follows the student, not the group he sits in.
    if (moved && assignDiscounts[moved] && !assignDiscounts[opt.subId]) {
      setAssignDiscounts({ ...assignDiscounts, [opt.subId]: assignDiscounts[moved] });
    }
  };

  /** Stages ("coursework") are not timings of a class: they are sold whole, so
   *  they keep their own flat list next to the class picker. */
  const getAssignableCoursework = () =>
    coursework
      .map((cw) => {
        const t = teachers.find((te) => te.id === cw.teacherId);
        return {
          id: cw.id,
          name: cw.name,
          teacherName: t ? `${t.firstName} ${t.lastName}` : "-",
          sessions: cw.dates.length,
          total: cw.total,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

  const toggleAssignCoursework = (id: string) => {
    setSelectedAssignIds(
      selectedAssignIds.includes(id)
        ? selectedAssignIds.filter((x) => x !== id)
        : [...selectedAssignIds, id],
    );
  };

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
            <Bell className="h-4 w-4 text-danger" /> Alertes Séances
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
            placeholder="Rechercher par nom, téléphone ou email..."
            className="pl-9"
          />
        </div>
        <div className="flex gap-1">
          <Button size="sm" variant={filterType === "all" ? "primary" : "outline"} onClick={() => setFilterType("all")}>
            Tous
          </Button>
          <Button size="sm" variant={filterType === "soon" ? "primary" : "outline"} onClick={() => setFilterType("soon")}>
            Presque Épuisé
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
          const remaining = remainingFor(stu);
          const runningOut = isSoonToRunOut(stu);
          const presences = attendedSeances(db, stu.id);

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
                      {/* Inscription & paiement — le cœur de la fiche : c'est ici
                          que se choisit la formule (à la séance ou au mois). */}
                      <div>
                        <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-white/60">
                          Inscription &amp; paiement
                        </span>
                        <div className="space-y-1.5">
                          <button
                            onClick={() => openAssign(stu)}
                            className="flex w-full items-center gap-2 rounded-xl bg-white px-3 py-2 text-[11px] font-bold text-primary hover:bg-white/90"
                          >
                            <BookOpen className="h-4 w-4 shrink-0" />
                            <span className="min-w-0 text-start">
                              Inscriptions
                              <span className="block text-[9px] font-semibold text-primary/70">
                                Modules, groupe, formule séance/mois, dates
                              </span>
                            </span>
                          </button>
                          <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                            <button
                              onClick={() => openBuySeances(stu)}
                              className="flex items-center justify-center gap-1.5 rounded-xl bg-white/15 py-2 font-semibold hover:bg-white/25"
                            >
                              <DollarSign className="h-3.5 w-3.5" /> Séances / Mois
                            </button>
                            <button
                              onClick={() => openPayDebt(stu)}
                              className={`flex items-center justify-center gap-1.5 rounded-xl py-2 font-semibold ${
                                debt > 0 ? "bg-danger hover:bg-danger/80" : "bg-white/15 hover:bg-white/25"
                              }`}
                            >
                              <DollarSign className="h-3.5 w-3.5" /> Régler dette
                            </button>
                          </div>
                        </div>
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
                      <div className="h-10 w-10 bg-primary/10 rounded-xl flex items-center justify-center font-bold text-primary text-sm">
                        {stu.firstName.substring(0, 1)}{stu.lastName.substring(0, 1)}
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-ink hover:text-primary transition-colors">
                          {stu.firstName} {stu.lastName}
                        </h4>
                        <span className="text-[10px] text-muted block flex items-center gap-1">
                          <CreditCard className="h-3 w-3 inline" /> {stu.rfid}
                        </span>
                      </div>
                    </button>

                    <button
                      onClick={() => setOverlayStudentId(stu.id)}
                      className="p-1 rounded-lg hover:bg-primary-50 text-muted hover:text-ink transition-colors"
                    >
                      <MoreVertical className="h-5 w-5" />
                    </button>
                  </div>

                  {/* Where the student stands, at a glance: what he attended,
                      what he has left to attend, and what he still owes. */}
                  <div className="mt-3 space-y-1.5 text-xs">
                    <div className="grid grid-cols-3 gap-1.5">
                      <div className="rounded-lg border border-line bg-canvas/60 px-1.5 py-1 text-center">
                        <span className="block text-[9px] font-semibold uppercase tracking-wide text-muted">
                          Présences
                        </span>
                        <strong className="block text-sm text-ink">{presences}</strong>
                        <span className="block text-[9px] text-muted">séance(s) suivie(s)</span>
                      </div>
                      <div
                        className={`rounded-lg border px-1.5 py-1 text-center ${
                          stu.isFree
                            ? "border-success/40 bg-success/10"
                            : remaining === 0
                              ? "border-danger/40 bg-danger/10"
                              : runningOut
                                ? "border-warning/40 bg-warning/10"
                                : "border-success/40 bg-success/10"
                        }`}
                      >
                        <span className="block text-[9px] font-semibold uppercase tracking-wide text-muted">
                          Restantes
                        </span>
                        <strong
                          className={`block text-sm ${
                            stu.isFree
                              ? "text-success"
                              : remaining === 0
                                ? "text-danger"
                                : runningOut
                                  ? "text-warning"
                                  : "text-success"
                          }`}
                        >
                          {stu.isFree ? "Gratuit" : remaining}
                        </strong>
                        <span className="block text-[9px] text-muted">
                          {stu.isFree ? "études offertes" : "séance(s) à suivre"}
                        </span>
                      </div>
                      <button
                        onClick={() => debt > 0 && openPayDebt(stu)}
                        disabled={debt === 0}
                        title={debt > 0 ? "Régler la dette" : "Aucun reste à payer"}
                        className={`rounded-lg border px-1.5 py-1 text-center transition-colors disabled:cursor-default ${
                          debt > 0
                            ? "border-danger/40 bg-danger/10 hover:bg-danger/20"
                            : "border-success/40 bg-success/10"
                        }`}
                      >
                        <span className="block text-[9px] font-semibold uppercase tracking-wide text-muted">
                          Dette
                        </span>
                        <strong
                          className={`block text-sm ${debt > 0 ? "text-danger" : "text-success"}`}
                        >
                          {debt} DA
                        </strong>
                        <span className="block text-[9px] text-muted">
                          {debt > 0 ? "à régler" : "compte à jour"}
                        </span>
                      </button>
                    </div>

                    <div className="flex justify-between">
                      <span className="text-muted">Téléphone:</span>
                      <strong className="text-ink">{stu.phone}</strong>
                    </div>

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
                  <span className="text-[10px] text-muted block mb-1">Modules/Abonnements:</span>
                  {stu.subscriptionIds.length === 0 ? (
                    <span className="text-[10px] text-muted italic">Non inscrit</span>
                  ) : (
                    <div className="flex flex-wrap gap-1 max-h-12 overflow-y-auto">
                      {stu.subscriptionIds.map((id) => {
                        const exp = stu.subscriptionDates?.[id]?.expiryDate;
                        const days = exp ? daysUntil(exp) : null;
                        const enr = enrollments.find(
                          (e) => e.studentId === stu.id && e.subscriptionId === id,
                        );
                        const left = enr ? remainingSeances(enr) : 0;
                        const expired = days !== null && days < 0;
                        const expiring = days !== null && days >= 0 && days <= EXPIRY_WARNING_DAYS;
                        const tone =
                          expired || (!stu.isFree && left === 0)
                            ? "danger"
                            : expiring || (!stu.isFree && left <= 2)
                              ? "warning"
                              : "neutral";
                        const monthly = (enr?.plan ?? stu.subscriptionDates?.[id]?.plan) === "month";
                        return (
                          <Badge key={id} tone={tone} className="text-[9px] px-1 py-0.5 whitespace-normal">
                            {getModuleLabel(id)}
                            {monthly && " · Mensuel"}
                            {!stu.isFree && ` · ${left} séance${left > 1 ? "s" : ""}`}
                            {expired && " · Expirée"}
                            {expiring && ` · J-${days}`}
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

      {/* Creation Modal */}
      <Modal open={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="Ajouter un étudiant" wide>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Prénom *</label>
            <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Prénom" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted mb-1 font-sans">Nom de famille *</label>
            <Input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Nom de famille" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Téléphone *</label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+213 5XX XX XX XX" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Date de naissance (optionnel)</label>
            <Input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
          </div>

          {/* ---- Billing case: normal by default, then one of the four cases -- */}
          <div className="md:col-span-2 space-y-2 rounded-xl border border-line bg-canvas/30 p-3">
            <span className="text-[10px] font-bold uppercase tracking-wider text-primary">
              🎫 Cas de l&apos;étudiant
            </span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {STUDENT_CASE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setStudentCase(opt.value)}
                  className={`rounded-lg border px-2 py-1.5 text-[11px] font-semibold transition-colors ${
                    studentCase === opt.value
                      ? "border-primary bg-primary text-white"
                      : "border-line bg-surface text-ink hover:bg-primary-50"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {studentCase === "special" && (
              <p className="rounded-lg bg-primary-50/50 p-2 text-[10px] text-muted">
                Études gratuites : ni l&apos;école ni l&apos;enseignant ne sont payés pour cet étudiant.
              </p>
            )}

            {studentCase === "teacher_child" && (
              <div className="space-y-1.5">
                <p className="text-[10px] text-muted">
                  L&apos;école est payée sur le salaire de l&apos;enseignant père (pas par l&apos;étudiant). Cherchez et
                  sélectionnez l&apos;enseignant.
                </p>
                <Input
                  value={teacherFatherSearch}
                  onChange={(e) => setTeacherFatherSearch(e.target.value)}
                  placeholder="Rechercher un enseignant par nom..."
                />
                <div className="max-h-32 space-y-1 overflow-y-auto">
                  {teachers
                    .filter((t) =>
                      `${t.firstName} ${t.lastName}`.toLowerCase().includes(teacherFatherSearch.toLowerCase()),
                    )
                    .map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setTeacherFatherId(t.id)}
                        className={`flex w-full items-center justify-between rounded-lg border px-2.5 py-1.5 text-[11px] transition-colors ${
                          teacherFatherId === t.id
                            ? "border-primary bg-primary text-white"
                            : "border-line bg-surface text-ink hover:bg-primary-50"
                        }`}
                      >
                        <span>{t.firstName} {t.lastName}</span>
                        {teacherFatherId === t.id && <Check className="h-3.5 w-3.5" />}
                      </button>
                    ))}
                </div>
              </div>
            )}

            {studentCase === "reduction" && (
              <div className="space-y-2">
                <p className="text-[10px] text-muted">
                  Réduction sur ce que l&apos;étudiant doit payer, répartie entre l&apos;école et l&apos;enseignant.
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setCaseRedType("percent")}
                    className={`flex-1 rounded-lg border px-2 py-1 text-[11px] font-semibold ${
                      caseRedType === "percent" ? "border-primary bg-primary text-white" : "border-line bg-surface text-ink"
                    }`}
                  >
                    Pourcentage (%)
                  </button>
                  <button
                    type="button"
                    onClick={() => setCaseRedType("amount")}
                    className={`flex-1 rounded-lg border px-2 py-1 text-[11px] font-semibold ${
                      caseRedType === "amount" ? "border-primary bg-primary text-white" : "border-line bg-surface text-ink"
                    }`}
                  >
                    Montant fixe (DA)
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-1 block text-[10px] font-semibold text-muted">
                      Part école ({caseRedType === "percent" ? "%" : "DA"})
                    </label>
                    <Input
                      type="number"
                      min={0}
                      value={caseRedSchool || ""}
                      onChange={(e) => setCaseRedSchool(Math.max(0, Number(e.target.value) || 0))}
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-semibold text-muted">
                      Part enseignant ({caseRedType === "percent" ? "%" : "DA"})
                    </label>
                    <Input
                      type="number"
                      min={0}
                      value={caseRedTeacher || ""}
                      onChange={(e) => setCaseRedTeacher(Math.max(0, Number(e.target.value) || 0))}
                      placeholder="0"
                    />
                  </div>
                </div>
              </div>
            )}

            {studentCase === "school_only" && (
              <div className="space-y-1.5">
                <p className="text-[10px] text-muted">
                  Seule l&apos;école est payée. Cochez les enseignants qui ne seront PAS payés pour cet étudiant
                  (sélection multiple).
                </p>
                <Input
                  value={unpaidTeacherSearch}
                  onChange={(e) => setUnpaidTeacherSearch(e.target.value)}
                  placeholder="Rechercher un enseignant par nom..."
                />
                <div className="max-h-32 space-y-1 overflow-y-auto">
                  {teachers
                    .filter((t) =>
                      `${t.firstName} ${t.lastName}`.toLowerCase().includes(unpaidTeacherSearch.toLowerCase()),
                    )
                    .map((t) => {
                      const picked = unpaidTeacherIds.includes(t.id);
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() =>
                            setUnpaidTeacherIds(
                              picked ? unpaidTeacherIds.filter((id) => id !== t.id) : [...unpaidTeacherIds, t.id],
                            )
                          }
                          className={`flex w-full items-center justify-between rounded-lg border px-2.5 py-1.5 text-[11px] transition-colors ${
                            picked ? "border-primary bg-primary text-white" : "border-line bg-surface text-ink hover:bg-primary-50"
                          }`}
                        >
                          <span>{t.firstName} {t.lastName}</span>
                          {picked && <Check className="h-3.5 w-3.5" />}
                        </button>
                      );
                    })}
                </div>
              </div>
            )}
          </div>

          {/* ---- Inscriptions: search the class, then tick its timings ------- */}
          <div className="md:col-span-2 space-y-3 rounded-xl border border-line bg-canvas/30 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-primary">
                <BookOpen className="h-3.5 w-3.5" /> Inscriptions de l&apos;étudiant (optionnel)
              </span>
              <span className="text-[10px] font-semibold text-muted">
                {createSubIds.length} créneau(x) sélectionné(s)
              </span>
            </div>
            <p className="text-[10px] leading-relaxed text-muted">
              Cherchez la classe de l&apos;élève : elle affiche <strong className="text-ink">tous ses
              créneaux</strong>. Cochez-en un ou <strong className="text-ink">plusieurs</strong> — chaque
              créneau coché devient une inscription enregistrée sur sa fiche dès sa création.
            </p>

            <ClassTimingPicker selectedSubIds={createSubIds} onToggle={toggleCreateTiming} />

            {/* What the student will be enrolled on, formula + start date each */}
            {createSubIds.length > 0 && (
              <div className="space-y-1.5">
                <span className="text-[9px] font-bold uppercase tracking-wider text-muted">
                  Inscriptions retenues
                </span>
                {createSubIds.map((subId) => {
                  const sub = subscriptions.find((s) => s.id === subId);
                  const monthly = createPlanOf(subId) === "month";
                  const startDate = createStartDates[subId] || todayIso();
                  const expiry = expiryFor(subId, startDate, monthly ? "month" : "seance");
                  const formationSub = getFormationSub(subId);
                  return (
                    <div key={subId} className="rounded-xl border border-line bg-surface p-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <strong className="text-[11px] text-ink">{getModuleLabel(subId)}</strong>
                        <button
                          onClick={() => {
                            setCreateSubIds(createSubIds.filter((id) => id !== subId));
                            if (createPaySubId === subId) {
                              setCreatePaySubId(createSubIds.filter((id) => id !== subId)[0] ?? "");
                            }
                          }}
                          className="shrink-0 text-muted hover:text-danger"
                          title="Retirer cette inscription"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <div className="mt-2 flex flex-wrap items-end gap-3">
                        <div>
                          <span className="mb-1 flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-muted">
                            <Repeat className="h-3 w-3" /> Formule
                          </span>
                          <div className="flex gap-1.5">
                            <button
                              onClick={() => {
                                setCreatePlans({ ...createPlans, [subId]: "seance" });
                                if (createPayEnabled && createPaySubId === subId) {
                                  prefillCreatePayAmount(subId, createPaySeances, "seance");
                                }
                              }}
                              className={`rounded-lg border px-2.5 py-1.5 text-[10px] transition-colors ${
                                !monthly
                                  ? "border-primary bg-primary text-white"
                                  : "border-line bg-canvas/40 text-ink hover:bg-primary-50"
                              }`}
                            >
                              À la séance · {sub?.pricePerSession ?? 0} DA
                            </button>
                            <button
                              onClick={() => {
                                if (!hasMonthlyPlan(sub)) return;
                                setCreatePlans({ ...createPlans, [subId]: "month" });
                                if (createPayEnabled && createPaySubId === subId) {
                                  prefillCreatePayAmount(subId, createPaySeances, "month");
                                }
                              }}
                              disabled={!hasMonthlyPlan(sub)}
                              title={
                                hasMonthlyPlan(sub)
                                  ? "Un mois complet, à renouveler à son échéance"
                                  : "Aucune formule mensuelle définie pour ce cours (page Abonnements)"
                              }
                              className={`rounded-lg border px-2.5 py-1.5 text-[10px] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                                monthly
                                  ? "border-primary bg-primary text-white"
                                  : "border-line bg-canvas/40 text-ink hover:bg-primary-50 disabled:hover:bg-canvas/40"
                              }`}
                            >
                              {hasMonthlyPlan(sub)
                                ? `Au mois · ${sub?.monthlySeances} séances · ${monthlyPriceOf(sub)} DA`
                                : "Au mois · non proposé"}
                            </button>
                          </div>
                        </div>
                        <div>
                          <label className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-muted">
                            {monthly ? "Début du mois" : "Date de début"}
                          </label>
                          <Input
                            type="date"
                            value={startDate}
                            onChange={(e) =>
                              setCreateStartDates({ ...createStartDates, [subId]: e.target.value })
                            }
                            className="w-40"
                          />
                        </div>
                        {(monthly || formationSub) && (
                          <div className="pb-1.5 text-[11px]">
                            <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-muted">
                              {monthly ? "Fin du mois (calculée)" : "Expiration (calculée)"}
                            </span>
                            <strong className={monthly ? "text-danger" : "text-primary"}>
                              {formatDateFr(expiry)}
                            </strong>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                {!isFree && (school?.registrationFee ?? 0) > 0 && (
                  <p className="text-[10px] text-muted">
                    ℹ️ Frais d&apos;inscription uniques de{" "}
                    <strong className="text-ink">{school?.registrationFee} DA</strong> ajoutés à sa fiche
                    (réglables depuis sa carte).
                  </p>
                )}
              </div>
            )}
          </div>

          {/* ---- First recharge, paid at the desk on the same screen --------- */}
          <div className="md:col-span-2 space-y-3 rounded-xl border border-line bg-canvas/30 p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-primary">
                  <CreditCard className="h-3.5 w-3.5" /> Premier rechargement (optionnel)
                </span>
                <span className="mt-0.5 block text-[10px] text-muted">
                  Encaissé maintenant et enregistré dans l&apos;historique des paiements de l&apos;élève.
                </span>
              </div>
              <input
                type="checkbox"
                checked={createPayEnabled}
                onChange={(e) => {
                  setCreatePayEnabled(e.target.checked);
                  if (!e.target.checked) return;
                  const target = createPaySubId || createSubIds[0] || "";
                  setCreatePaySubId(target);
                  if (target) prefillCreatePayAmount(target, createPaySeances);
                }}
                disabled={createSubIds.length === 0}
                className="h-5 w-5 shrink-0 rounded border-line text-primary focus:ring-primary disabled:opacity-40"
              />
            </div>

            {createSubIds.length === 0 ? (
              <p className="rounded-xl border border-line bg-surface p-2.5 text-[10px] italic text-muted">
                Sélectionnez d&apos;abord au moins un créneau ci-dessus : un rechargement crédite les
                séances d&apos;une inscription précise.
              </p>
            ) : (
              createPayEnabled && (
                <div className="space-y-3">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-muted">
                      Inscription à créditer *
                    </label>
                    <Select
                      value={createPaySubId}
                      onChange={(e) => {
                        setCreatePaySubId(e.target.value);
                        setCreatePaySeances(0);
                        prefillCreatePayAmount(e.target.value, 0);
                      }}
                      className="w-full"
                    >
                      {createSubIds.map((subId) => (
                        <option key={subId} value={subId}>
                          {getModuleLabel(subId)}
                          {createPlanOf(subId) === "month" ? " — au mois" : " — à la séance"}
                        </option>
                      ))}
                    </Select>
                    <span className="mt-1 block text-[10px] text-muted">
                      La formule suit celle choisie sur l&apos;inscription ci-dessus.
                    </span>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {createPayMonthly ? (
                      <>
                        <div>
                          <label className="mb-1 block text-xs font-semibold text-muted">
                            Mois payé ({createPayMonthSeances} séances)
                          </label>
                          <div className="rounded-xl border border-line bg-canvas px-3 py-2 text-sm font-bold text-ink">
                            {formatDateFr(createPayStartDate)}
                          </div>
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-semibold text-muted">
                            Fin du mois (calculée)
                          </label>
                          <div className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm font-bold text-danger">
                            {formatDateFr(createPayExpiry)}
                          </div>
                        </div>
                      </>
                    ) : (
                      <>
                        <div>
                          <label className="mb-1 block text-xs font-semibold text-muted">
                            Nombre de séances à payer *
                          </label>
                          <Input
                            type="number"
                            min={1}
                            value={createPaySeances || ""}
                            onChange={(e) => {
                              const n = Number(e.target.value);
                              setCreatePaySeances(n);
                              prefillCreatePayAmount(createPaySubId, n, "seance");
                            }}
                            placeholder="Ex: 8"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-semibold text-muted">
                            Prix d&apos;une séance
                          </label>
                          <div className="rounded-xl border border-line bg-canvas px-3 py-2 text-sm font-bold text-ink">
                            {createPayUnitPrice} DA
                          </div>
                        </div>
                      </>
                    )}
                  </div>

                  <div className="rounded-xl border border-line p-3">
                    <label className="mb-2 block text-xs font-semibold text-muted">Remise (optionnelle)</label>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <Select
                        value={createPayDiscountType}
                        onChange={(e) => setCreatePayDiscountType(e.target.value as DiscountType)}
                      >
                        <option value="percent">Pourcentage (%)</option>
                        <option value="amount">Montant fixe (DA)</option>
                      </Select>
                      <Input
                        type="number"
                        min={0}
                        value={createPayDiscountValue || ""}
                        onChange={(e) => setCreatePayDiscountValue(Number(e.target.value))}
                        placeholder={createPayDiscountType === "percent" ? "Ex: 10" : "Ex: 500"}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-muted">
                        Montant payé par l&apos;étudiant (DA) *
                      </label>
                      <Input
                        type="number"
                        min={0}
                        value={createPayAmountPaid || ""}
                        onChange={(e) => setCreatePayAmountPaid(Number(e.target.value))}
                        placeholder="Ex: 4000"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-muted">Reste à payer</label>
                      <div
                        className={`rounded-xl border px-3 py-2 text-sm font-bold ${
                          createPayRest > 0
                            ? "border-danger/40 bg-danger/10 text-danger"
                            : "border-success/40 bg-success/10 text-success"
                        }`}
                      >
                        {createPayRest} DA
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-semibold text-muted">Description</label>
                    <Input
                      value={createPayDesc}
                      onChange={(e) => setCreatePayDesc(e.target.value)}
                      placeholder="Laisser vide pour la description automatique"
                    />
                  </div>

                  <div className="space-y-1 rounded-xl border border-line bg-canvas p-3 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted">
                        {createPayMonthly
                          ? `Prix du mois (${createPayMonthSeances} séances):`
                          : `Total brut (${createPayCount} × ${createPayUnitPrice} DA):`}
                      </span>
                      <strong className="text-ink">{createPayGross} DA</strong>
                    </div>
                    {createPayDiscountValue > 0 && (
                      <div className="flex justify-between">
                        <span className="text-muted">Remise appliquée:</span>
                        <strong className="text-warning">
                          {discountLabel({ type: createPayDiscountType, value: createPayDiscountValue })} (−
                          {createPayGross - createPayNet} DA)
                        </strong>
                      </div>
                    )}
                    <div className="flex justify-between border-t border-line pt-1">
                      <span className="font-semibold text-muted">Net à payer:</span>
                      <strong className="text-sm text-primary">{createPayNet} DA</strong>
                    </div>
                  </div>
                </div>
              )
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-6 mt-4 border-t border-line">
          <Button variant="outline" onClick={() => setIsCreateOpen(false)} disabled={createBusy}>
            Annuler
          </Button>
          <Button onClick={handleCreateStudent} disabled={createBusy}>
            {createBusy ? "Création…" : "Créer"}
          </Button>
        </div>
      </Modal>

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
                      remainingFor(selectedStudent) === 0
                        ? "danger"
                        : isSoonToRunOut(selectedStudent)
                          ? "warning"
                          : "primary"
                    }
                    className="text-sm px-3 py-1"
                  >
                    Séances restantes: {remainingFor(selectedStudent)}
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

              {detailsTab === "subs" && (
                <div className="space-y-2">
                  {selectedStudent.subscriptionIds.length === 0 ? (
                    <p className="text-xs text-muted italic">Non inscrit à des cours ou stages.</p>
                  ) : (
                    selectedStudent.subscriptionIds.map((subId) => {
                      const sub = subscriptions.find((s) => s.id === subId);
                      const isCw = !sub; // If not in subscriptions, check coursework
                      const formationSub = isCw ? undefined : getFormationSub(subId);
                      const dates = selectedStudent.subscriptionDates?.[subId];
                      const days = dates?.expiryDate ? daysUntil(dates.expiryDate) : null;
                      const enr = enrollments.find(
                        (e) => e.studentId === selectedStudent.id && e.subscriptionId === subId,
                      );
                      const paid = enr?.paidSeances ?? 0;
                      const consumed = enr?.consumedSeances ?? 0;
                      const left = enr ? remainingSeances(enr) : 0;
                      // Séances the expired month took with it — paid, unused,
                      // and no longer usable: worth showing plainly.
                      const lost = enr ? lostSeances(enr) : 0;
                      const isMonthly = (enr?.plan ?? dates?.plan) === "month";
                      const expiry = enr ? enrollmentExpiryStatus(enr) : "active";
                      const unitPrice = enr ? enrollmentUnitPrice(db, enr) : sub?.pricePerSession ?? 0;
                      // The row itself turns into the alert: nothing left to
                      // consume, or an enrollment that has run out of time.
                      const alarming =
                        !selectedStudent.isFree &&
                        !isCw &&
                        (left === 0 || expiry === "expired" || expiry === "soon");
                      return (
                        <div
                          key={subId}
                          className={`flex justify-between items-center gap-3 text-xs p-3 rounded-xl border ${
                            alarming
                              ? expiry === "expired" || left === 0
                                ? "bg-danger/5 border-danger/50"
                                : "bg-warning/5 border-warning/50"
                              : "bg-canvas border-line"
                          }`}
                        >
                          <div className="min-w-0">
                            <strong className="text-ink block">
                              {getSubLabel(subId)}
                              {isMonthly && (
                                <Badge tone="warning" className="ms-1.5 text-[9px] px-1.5 py-0">
                                  Mensuel
                                </Badge>
                              )}
                            </strong>
                            <span className="text-[10px] text-muted">
                              {isCw
                                ? "Stage Intensif"
                                : formationSub
                                  ? `Formation · ${unitPrice} DA / séance · Niveau: ${formationSub.levelPrice ?? 0} DA · ${formationSub.periodMonths ?? 0} mois`
                                  : isMonthly
                                    ? `${enr?.monthSeances ?? sub?.monthlySeances ?? 0} séances / mois · ${monthlyPriceOf(sub)} DA / mois`
                                    : `${unitPrice} DA / séance`}
                              {enr?.discount && enr.discount.value > 0 && (
                                <strong className="text-warning"> · {discountLabel(enr.discount)}</strong>
                              )}
                            </span>

                            {/* The créneau this inscription was taken on */}
                            {!isCw && getTimingLabel(subId) && (
                              <span className="mt-0.5 flex items-center gap-1 text-[10px] font-semibold text-primary">
                                <Clock className="h-3 w-3 shrink-0" /> {getTimingLabel(subId)}
                              </span>
                            )}

                            {!isCw && (
                              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-muted">
                                <span>Payées: <strong className="text-ink">{paid}</strong></span>
                                <span>Consommées: <strong className="text-ink">{consumed}</strong></span>
                                <span>
                                  Restantes:{" "}
                                  <strong
                                    className={`text-sm ${
                                      left === 0 ? "text-danger" : left <= 2 ? "text-warning" : "text-success"
                                    }`}
                                  >
                                    {left}
                                  </strong>
                                </span>
                                <Badge
                                  tone={left === 0 ? "danger" : left <= 2 ? "warning" : "success"}
                                  className="text-[9px] px-1.5 py-0"
                                >
                                  {expiry === "expired"
                                    ? "Expiré"
                                    : left === 0
                                      ? "Épuisé"
                                      : left <= 2
                                        ? "Bientôt épuisé"
                                        : "Actif"}
                                </Badge>
                                {lost > 0 && (
                                  <span className="text-danger">
                                    {lost} séance(s) perdue(s) à l&apos;expiration
                                  </span>
                                )}
                              </div>
                            )}

                            {!isCw && (
                              <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted">
                                <span>
                                  Inscrit le <strong className="text-ink">{formatDateFr(dates?.subscribedAt)}</strong>
                                </span>
                                <span>
                                  · Début <strong className="text-ink">{formatDateFr(dates?.startDate)}</strong>
                                </span>
                                {dates?.startDate && daysUntil(dates.startDate) > 0 && (
                                  <Badge tone="success" className="text-[9px] px-1.5 py-0">
                                    Pas encore commencé
                                  </Badge>
                                )}
                              </span>
                            )}

                            {dates?.expiryDate && days !== null && (
                              <span className="flex items-center gap-1.5 mt-0.5 text-[10px] text-muted">
                                Du {formatDateFr(dates.startDate)} au {formatDateFr(dates.expiryDate)}
                                <Badge
                                  tone={
                                    expiry === "expired" ? "danger" : expiry === "soon" ? "warning" : "success"
                                  }
                                  className="text-[9px] px-1.5 py-0"
                                >
                                  {days < 0
                                    ? "Expirée"
                                    : days === 0
                                      ? "Expire aujourd'hui"
                                      : days <= EXPIRY_WARNING_DAYS
                                        ? `Expire dans ${days} j`
                                        : "Active"}
                                </Badge>
                              </span>
                            )}
                          </div>

                          <div className="flex shrink-0 flex-col items-end gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setIsDetailsOpen(false);
                                openBuySeances(selectedStudent);
                                setBuySubId(subId);
                                setBuyPlan(isMonthly ? "month" : "seance");
                              }}
                            >
                              {isMonthly ? "Renouveler le mois" : "Payer des séances"}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                if (confirm("Se désabonner de ce module ?")) {
                                  updateItem("students", selectedStudent.id, {
                                    subscriptionIds: selectedStudent.subscriptionIds.filter((id) => id !== subId),
                                  });
                                }
                              }}
                              className="text-danger hover:bg-danger/10"
                            >
                              Désinscrire
                            </Button>
                          </div>
                        </div>
                      );
                    })
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

      {/* Assign Subscriptions Modal */}
      <Modal open={isAssignOpen} onClose={() => setIsAssignOpen(false)} title="Affecter des abonnements / cours" wide>
        <div className="space-y-4">
          {selectedStudent && (
            <div className="rounded-xl border border-line bg-canvas p-3 text-xs">
              <span className="block text-[10px] uppercase text-muted">Élève</span>
              <strong className="mt-0.5 block text-ink">
                {selectedStudent.firstName} {selectedStudent.lastName}
              </strong>
              <span className="text-muted">
                {selectedAssignIds.length} inscription(s) retenue(s) · Séances restantes (tous
                modules) : {remainingFor(selectedStudent)}
              </span>
            </div>
          )}

          {/* Same picker as the creation screen: search the CLASS, open it, tick
              one or several of its timings. */}
          <div className="space-y-2 rounded-xl border border-line bg-canvas/30 p-3">
            <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-primary">
              <BookOpen className="h-3.5 w-3.5" /> Chercher la classe, puis cocher ses créneaux
            </span>
            <p className="text-[10px] leading-relaxed text-muted">
              La classe affiche <strong className="text-ink">tous ses créneaux</strong> : cochez-en
              un ou <strong className="text-ink">plusieurs</strong>, de plusieurs classes au besoin.
              Chaque créneau coché devient une inscription de l&apos;élève, visible sur sa fiche.
            </p>
            <ClassTimingPicker selectedSubIds={selectedAssignIds} onToggle={toggleAssignTiming} />
          </div>

          {/* Stages: sold whole, outside any class timetable. */}
          {getAssignableCoursework().length > 0 && (
            <div className="space-y-1.5 rounded-xl border border-line bg-canvas/30 p-3">
              <span className="text-[10px] font-bold uppercase tracking-wider text-warning">
                Stages intensifs
              </span>
              {getAssignableCoursework().map((cw) => {
                const picked = selectedAssignIds.includes(cw.id);
                return (
                  <button
                    key={cw.id}
                    onClick={() => toggleAssignCoursework(cw.id)}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg border p-2 text-start text-[11px] transition-colors ${
                      picked
                        ? "border-primary bg-primary text-white"
                        : "border-line bg-surface text-ink hover:bg-primary-50"
                    }`}
                  >
                    <span className="min-w-0">
                      <strong className="block">Stage : {cw.name}</strong>
                      <span className={picked ? "text-white/85" : "text-muted"}>
                        Ens: {cw.teacherName} · {cw.sessions} séance(s)
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <strong>{cw.total} DA</strong>
                      <input type="checkbox" checked={picked} readOnly className="h-4 w-4" />
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Bulk reduction: one rate for every ticked module, in one go —
              instead of opening each module and setting it individually. */}
          <div className="rounded-xl border border-primary/25 bg-primary-50/40 p-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-primary flex items-center gap-1.5">
                <DollarSign className="h-3.5 w-3.5" /> Réduction groupée ({selectedAssignIds.length} module(s) sélectionné(s))
              </span>
              {Object.keys(assignDiscounts).length > 0 && (
                <button onClick={clearAllDiscounts} className="text-[10px] font-bold text-danger hover:underline">
                  Tout réinitialiser
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label className="block text-[10px] font-semibold text-muted mb-1">Type</label>
                <Select
                  value={bulkDiscountType}
                  onChange={(e) => setBulkDiscountType(e.target.value as DiscountType)}
                  className="w-40"
                >
                  <option value="percent">Pourcentage (%)</option>
                  <option value="amount">Montant fixe (DA)</option>
                </Select>
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-muted mb-1">
                  Valeur {bulkDiscountType === "percent" ? "(%)" : "(DA)"}
                </label>
                <Input
                  type="number"
                  min={0}
                  max={bulkDiscountType === "percent" ? 100 : undefined}
                  value={bulkDiscountValue || ""}
                  onChange={(e) => setBulkDiscountValue(Number(e.target.value))}
                  placeholder={bulkDiscountType === "percent" ? "Ex: 20" : "Ex: 500"}
                  className="w-32"
                />
              </div>
              <Button size="sm" onClick={applyBulkDiscount} className="mb-0.5">
                Appliquer à la sélection
              </Button>
            </div>
            <p className="text-[10px] leading-relaxed text-muted">
              Cochez plusieurs modules puis appliquez la réduction une seule fois. Chaque module reste
              modifiable individuellement ci-dessous. Le tarif réduit est celui réellement débité au scan,
              en présence manuelle et par la facturation d&apos;absence hebdomadaire.
            </p>
          </div>

          {/* Everything ticked, with the formula, the dates and the reduction of
              each inscription — the settings the store actually reads. */}
          {selectedAssignIds.length === 0 ? (
            <p className="rounded-xl border border-line bg-canvas/40 p-3 text-[11px] italic text-muted">
              Aucun créneau coché : confirmer maintenant retirerait toutes ses inscriptions.
            </p>
          ) : (
            <div className="space-y-2">
              <span className="text-[9px] font-bold uppercase tracking-wider text-muted">
                Inscriptions retenues
              </span>
              {selectedAssignIds.map((subId) => {
                const sub = subscriptions.find((s) => s.id === subId);
                const cw = sub ? undefined : coursework.find((c) => c.id === subId);
                const discount = assignDiscounts[subId];
                const hasDiscount = !!discount && discount.value > 0;

                // Stages carry no formula and no dates: only their reduction.
                if (!sub) {
                  const base = cw?.total ?? 0;
                  return (
                    <div key={subId} className="rounded-xl border border-line bg-surface p-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <strong className="text-[11px] text-ink">Stage : {cw?.name ?? "—"}</strong>
                        <button
                          onClick={() => toggleAssignCoursework(subId)}
                          className="shrink-0 text-muted hover:text-danger"
                          title="Retirer ce stage"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <div className="mt-2 flex flex-wrap items-end gap-3">
                        <div>
                          <label className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-muted">
                            Réduction
                          </label>
                          <Select
                            value={discount?.type ?? "percent"}
                            onChange={(e) => setItemDiscount(subId, { type: e.target.value as DiscountType })}
                            className="w-36"
                          >
                            <option value="percent">Pourcentage (%)</option>
                            <option value="amount">Montant fixe (DA)</option>
                          </Select>
                        </div>
                        <div>
                          <label className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-muted">
                            Valeur {(discount?.type ?? "percent") === "percent" ? "(%)" : "(DA)"}
                          </label>
                          <Input
                            type="number"
                            min={0}
                            max={(discount?.type ?? "percent") === "percent" ? 100 : undefined}
                            value={discount?.value || ""}
                            onChange={(e) => setItemDiscount(subId, { value: Number(e.target.value) })}
                            placeholder="0"
                            className="w-28"
                          />
                        </div>
                        <div className="pb-1.5 text-[11px]">
                          <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-muted">
                            Prix du stage
                          </span>
                          <strong className={hasDiscount ? "text-success" : "text-ink"}>
                            {netPriceFor(base, discount)} DA
                          </strong>
                          {hasDiscount && <span className="text-muted"> (au lieu de {base} DA)</span>}
                        </div>
                      </div>
                    </div>
                  );
                }

                const formationSub = getFormationSub(subId);
                const monthly = planOf(subId) === "month" && hasMonthlyPlan(sub);
                const startDate = assignStartDates[subId] || todayIso();
                const subDate = assignSubDates[subId] || todayIso();
                const expiry = expiryFor(subId, startDate, monthly ? "month" : "seance");
                const startsLater = daysUntil(startDate) > 0;
                const base = formationSub ? sub.levelPrice ?? 0 : sub.pricePerSession;

                return (
                  <div key={subId} className="rounded-xl border border-line bg-surface p-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <strong className="text-[11px] text-ink">
                        {getModuleLabel(subId)}
                        {hasDiscount && (
                          <span className="ml-1.5 rounded bg-success/15 px-1.5 py-0.5 text-[9px] font-bold text-success">
                            {discountLabel(discount)}
                          </span>
                        )}
                      </strong>
                      <button
                        onClick={() =>
                          setSelectedAssignIds(selectedAssignIds.filter((id) => id !== subId))
                        }
                        className="shrink-0 text-muted hover:text-danger"
                        title="Retirer cette inscription"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <div className="mt-2 flex flex-wrap items-end gap-3">
                      <div>
                        <span className="mb-1 flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-muted">
                          <Repeat className="h-3 w-3" /> Formule
                        </span>
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => setAssignPlans({ ...assignPlans, [subId]: "seance" })}
                            className={`rounded-lg border px-2.5 py-1.5 text-[10px] transition-colors ${
                              !monthly
                                ? "border-primary bg-primary text-white"
                                : "border-line bg-canvas/40 text-ink hover:bg-primary-50"
                            }`}
                          >
                            À la séance · {netPriceFor(base, discount)} DA
                          </button>
                          <button
                            onClick={() =>
                              hasMonthlyPlan(sub) && setAssignPlans({ ...assignPlans, [subId]: "month" })
                            }
                            disabled={!hasMonthlyPlan(sub)}
                            title={
                              hasMonthlyPlan(sub)
                                ? "Un mois complet, à renouveler à son échéance"
                                : "Aucune formule mensuelle définie pour ce cours (page Abonnements)"
                            }
                            className={`rounded-lg border px-2.5 py-1.5 text-[10px] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                              monthly
                                ? "border-primary bg-primary text-white"
                                : "border-line bg-canvas/40 text-ink hover:bg-primary-50 disabled:hover:bg-canvas/40"
                            }`}
                          >
                            {hasMonthlyPlan(sub)
                              ? `Au mois · ${sub.monthlySeances} séances · ${netPriceFor(monthlyPriceOf(sub), discount)} DA`
                              : "Au mois · non proposé"}
                          </button>
                        </div>
                      </div>

                      <div>
                        <label className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-muted">
                          Date d&apos;inscription
                        </label>
                        <Input
                          type="date"
                          value={subDate}
                          onChange={(e) => setAssignSubDates({ ...assignSubDates, [subId]: e.target.value })}
                          className="w-40"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-muted">
                          {monthly ? "Début du mois *" : "Date de début *"}
                        </label>
                        <Input
                          type="date"
                          value={startDate}
                          onChange={(e) =>
                            setAssignStartDates({ ...assignStartDates, [subId]: e.target.value })
                          }
                          className="w-40"
                        />
                        {startsLater && (
                          <span className="mt-1 block text-[9px] font-semibold text-success">
                            Séances offertes jusqu&apos;au {formatDateFr(startDate)}
                          </span>
                        )}
                      </div>
                      {(monthly || formationSub) && (
                        <div className="pb-1.5 text-[11px]">
                          <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-muted">
                            {monthly ? "Fin du mois (calculée)" : "Expiration (calculée)"}
                          </span>
                          <strong className={monthly ? "text-danger" : "text-primary"}>
                            {formatDateFr(expiry)}
                          </strong>
                          {monthly && (
                            <span className="block text-[9px] text-muted">
                              Séances restantes perdues ce jour-là
                            </span>
                          )}
                        </div>
                      )}

                      <div>
                        <label className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-muted">
                          Réduction
                        </label>
                        <Select
                          value={discount?.type ?? "percent"}
                          onChange={(e) => setItemDiscount(subId, { type: e.target.value as DiscountType })}
                          className="w-36"
                        >
                          <option value="percent">Pourcentage (%)</option>
                          <option value="amount">Montant fixe (DA)</option>
                        </Select>
                      </div>
                      <div>
                        <label className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-muted">
                          Valeur {(discount?.type ?? "percent") === "percent" ? "(%)" : "(DA)"}
                        </label>
                        <Input
                          type="number"
                          min={0}
                          max={(discount?.type ?? "percent") === "percent" ? 100 : undefined}
                          value={discount?.value || ""}
                          onChange={(e) => setItemDiscount(subId, { value: Number(e.target.value) })}
                          placeholder="0"
                          className="w-28"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="rounded-xl border border-line bg-canvas/40 p-3 text-[10px] leading-relaxed text-muted">
            📅 <strong className="text-ink">Dates d&apos;inscription :</strong> la{" "}
            <strong className="text-ink">date d&apos;inscription</strong> est le jour où l&apos;élève est enregistré
            sur le module (information de suivi). La <strong className="text-ink">date de début</strong> est le jour
            où la facturation commence : tant qu&apos;elle n&apos;est pas atteinte, la carte est acceptée, la présence
            est enregistrée mais <strong className="text-ink">aucun montant n&apos;est retiré du solde</strong>. Les
            deux dates restent modifiables ici à tout moment.
          </div>

          <div className="rounded-xl border border-line bg-canvas/40 p-3 text-[10px] leading-relaxed text-muted">
            🗓️ <strong className="text-ink">À la séance ou au mois :</strong> à la séance, l&apos;élève paie ses
            séances à l&apos;unité et elles ne périment jamais. Au mois, il achète{" "}
            <strong className="text-ink">un nombre de séances fixe pour un mois</strong> à partir de la date de
            début choisie (aujourd&apos;hui par défaut, modifiable) :{" "}
            <strong className="text-ink">
              passé la date de fin, l&apos;abonnement expire et sa carte est refusée, même s&apos;il n&apos;a pas
              consommé toutes les séances du mois
            </strong>{" "}
            — il faut alors le renouveler depuis « Payer des séances ».
          </div>

          <div className="rounded-xl border border-line bg-canvas/40 p-3 text-[10px] leading-relaxed text-muted">
            🔁 <strong className="text-ink">Groupe et rattrapage :</strong> l&apos;étudiant est inscrit sur le groupe
            choisi ci-dessus, mais sa carte est acceptée sur <strong className="text-ink">n&apos;importe quel autre
            groupe du même cours</strong> (même classe, même module, même enseignant). La présence est alors
            enregistrée sur le groupe réellement suivi, au tarif de son inscription.
          </div>

          {/* Running total: what one séance costs on the modules sold à la
              séance, and what the months cost on the ones sold by the month. */}
          {selectedAssignIds.length > 0 && (() => {
            const totals = selectedAssignIds.reduce(
              (acc, id) => {
                const sub = subscriptions.find((s) => s.id === id);
                if (!sub) {
                  const cw = coursework.find((c) => c.id === id);
                  acc.perSeance += netPriceFor(cw?.total ?? 0, assignDiscounts[id]);
                  return acc;
                }
                if (planOf(id) === "month" && hasMonthlyPlan(sub)) {
                  acc.perMonth += netPriceFor(monthlyPriceOf(sub), assignDiscounts[id]);
                  acc.months += 1;
                  return acc;
                }
                const sess = sessions.find((se) => se.id === sub.sessionId);
                const cls = sess ? classes.find((c) => c.id === sess.classId) : undefined;
                const base = cls?.type === "formation" ? sub.levelPrice ?? 0 : sub.pricePerSession;
                acc.perSeance += netPriceFor(base, assignDiscounts[id]);
                return acc;
              },
              { perSeance: 0, perMonth: 0, months: 0 },
            );
            return (
              <div className="space-y-1 rounded-xl border border-line bg-canvas/40 p-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-muted font-semibold">
                    Total par séance après réductions ({selectedAssignIds.length - totals.months} module(s) à la séance)
                  </span>
                  <strong className="text-primary text-sm">{totals.perSeance} DA</strong>
                </div>
                {totals.months > 0 && (
                  <div className="flex items-center justify-between border-t border-line pt-1">
                    <span className="text-muted font-semibold">
                      Total mensuel ({totals.months} abonnement(s) au mois)
                    </span>
                    <strong className="text-primary text-sm">{totals.perMonth} DA / mois</strong>
                  </div>
                )}
              </div>
            );
          })()}

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => setIsAssignOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handleAssignSubmit}>Confirmer les inscriptions</Button>
          </div>
        </div>
      </Modal>

      {/* Renewal — replaces the old money "recharge". It opens on the student's
          own inscriptions and what is left on each, so reception tops up the one
          that ran out. The unit price is the subscription's own séance price and
          the remise runs through the same helper the scanner prices séances
          with, so the modal can never advertise a total the store would not
          apply. */}
      <Modal
        open={isBuyOpen}
        onClose={() => setIsBuyOpen(false)}
        title="Renouvellement — payer des séances ou un mois"
        wide
      >
        <div className="space-y-4">
          {selectedStudent && (
            <div className="bg-canvas border border-line rounded-xl p-3 text-xs">
              <span className="text-[10px] text-muted block uppercase">Élève</span>
              <strong className="text-ink block mt-0.5">
                {selectedStudent.firstName} {selectedStudent.lastName}
              </strong>
              <span className="text-muted">
                Séances restantes (tous modules): {remainingFor(selectedStudent)}
                {debtFor(selectedStudent) > 0 && (
                  <strong className="text-danger"> · Dette: {debtFor(selectedStudent)} DA</strong>
                )}
              </span>
            </div>
          )}

          {/* 1 — the inscription being renewed. The student's OWN inscriptions
              come first and carry their counter, so reception renews what is
              running out instead of hunting for it in the whole catalogue. */}
          <div>
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-1.5 text-xs font-semibold text-muted">
                <Repeat className="h-3.5 w-3.5" /> Inscriptions en cours — choisir celle à renouveler *
              </label>
              {selectedStudent && (
                <button
                  onClick={() => setBuyShowOthers(!buyShowOthers)}
                  className="text-[10px] font-bold text-primary hover:underline"
                >
                  {buyShowOthers ? "Masquer les autres modules" : "+ Payer un autre module"}
                </button>
              )}
            </div>

            <div className="max-h-64 space-y-1.5 overflow-y-auto rounded-xl border border-line p-2">
              {(() => {
                if (!selectedStudent) return null;
                const mine = currentInscriptions(selectedStudent);
                if (mine.length === 0) {
                  return (
                    <p className="p-2 text-xs italic text-muted">
                      Cet élève n&apos;a aucune inscription. Ouvrez « Inscriptions » pour lui affecter
                      des créneaux, puis revenez ici pour les payer.
                    </p>
                  );
                }
                return mine.map((o) => {
                  const active = buySubId === o.id;
                  const monthlyPlan = o.plan === "month";
                  return (
                    <button
                      key={o.id}
                      onClick={() => {
                        setBuySubId(o.id);
                        // Renewing continues on the formula the module is sold
                        // on — and never on "au mois" when the tariff has none.
                        setBuyPlan(monthlyPlan && o.hasMonthly ? "month" : "seance");
                        setBuySeances(0);
                        setBuyAmountPaid(
                          monthlyPlan && o.hasMonthly
                            ? netPriceFor(o.monthlyPrice, buyDiscount)
                            : 0,
                        );
                      }}
                      className={`w-full rounded-xl border p-2.5 text-start text-xs transition-colors ${
                        active
                          ? "border-primary bg-primary/10"
                          : o.urgent
                            ? "border-danger/40 bg-danger/5 hover:border-primary/40"
                            : "border-line hover:border-primary/40 hover:bg-primary-50/40"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <strong className="min-w-0 text-ink">
                          {o.label}
                          <span
                            className={`ml-1.5 rounded px-1.5 py-0.5 text-[9px] font-bold ${
                              monthlyPlan
                                ? "bg-warning/15 text-warning"
                                : "bg-primary/10 text-primary"
                            }`}
                          >
                            {monthlyPlan ? "Au mois" : "À la séance"}
                          </span>
                        </strong>
                        <span className="shrink-0 text-end font-bold text-primary">
                          {o.price} DA / séance
                          {o.hasMonthly && (
                            <span className="block text-[10px] font-semibold text-warning">
                              {o.monthlySeances} séances · {o.monthlyPrice} DA / mois
                            </span>
                          )}
                        </span>
                      </div>

                      {/* What is actually left on that inscription today */}
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]">
                        <span
                          className={`rounded px-1.5 py-0.5 font-bold ${
                            o.remaining === 0
                              ? "bg-danger/15 text-danger"
                              : o.remaining <= 2
                                ? "bg-warning/15 text-warning"
                                : "bg-success/15 text-success"
                          }`}
                        >
                          {o.remaining} séance(s) restante(s)
                        </span>
                        <span className="text-muted">{o.consumed} consommée(s)</span>
                        {o.expiryDate && (
                          <span className={o.expired ? "font-bold text-danger" : "text-muted"}>
                            {o.expired
                              ? `Expirée le ${formatDateFr(o.expiryDate)}`
                              : `Valable jusqu'au ${formatDateFr(o.expiryDate)} (J-${o.daysLeft})`}
                          </span>
                        )}
                        {o.lost > 0 && (
                          <span className="font-semibold text-danger">
                            {o.lost} séance(s) perdue(s) à l&apos;expiration
                          </span>
                        )}
                        {o.neverPaid && (
                          <span className="font-semibold text-warning">Jamais payée</span>
                        )}
                      </div>

                      {o.urgent && (
                        <span className="mt-1 block text-[10px] font-bold text-danger">
                          ⚠ À renouveler — {o.expired ? "la carte est refusée" : "réserve épuisée"}
                        </span>
                      )}
                    </button>
                  );
                });
              })()}
            </div>
          </div>

          {/* Selling a module the student is not on yet — kept out of the way */}
          {buyShowOthers && (
            <div>
              <label className="mb-1 block text-xs font-semibold text-muted">
                Autres modules (le paiement inscrit l&apos;élève)
              </label>
              <div className="relative mb-2">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
                <Input
                  value={buySearch}
                  onChange={(e) => setBuySearch(e.target.value)}
                  placeholder="Rechercher un module, une classe, un enseignant..."
                  className="pl-9"
                />
              </div>
              <div className="max-h-44 space-y-1.5 overflow-y-auto rounded-xl border border-line p-2">
                {(() => {
                  if (!selectedStudent) return null;
                  const options = otherSubscriptions(selectedStudent).filter((o) =>
                    o.label.toLowerCase().includes(buySearch.trim().toLowerCase()),
                  );
                  if (options.length === 0) {
                    return (
                      <p className="p-2 text-xs italic text-muted">
                        Aucun autre module ne correspond. Les tarifs se définissent sur la page
                        Abonnements.
                      </p>
                    );
                  }
                  return options.map((o) => (
                    <button
                      key={o.id}
                      onClick={() => {
                        setBuySubId(o.id);
                        setBuyPlan("seance");
                        setBuySeances(0);
                        setBuyAmountPaid(0);
                      }}
                      className={`w-full rounded-xl border p-2.5 text-start text-xs transition-colors ${
                        buySubId === o.id
                          ? "border-primary bg-primary/10"
                          : "border-line hover:border-primary/40 hover:bg-primary-50/40"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <strong className="text-ink">{o.label}</strong>
                        <span className="shrink-0 font-bold text-primary">
                          {o.price} DA / séance
                          {o.hasMonthly && (
                            <span className="ms-1 text-[10px] font-semibold text-warning">
                              · {o.monthlyPrice} DA / mois
                            </span>
                          )}
                        </span>
                      </div>
                      <span className="mt-0.5 block text-[10px] text-muted">Nouvelle inscription</span>
                    </button>
                  ));
                })()}
              </div>
            </div>
          )}

          {/* 2 — the formula: séances at the unit price, or one whole month */}
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted">Formule *</label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                onClick={() => {
                  setBuyPlan("seance");
                  setBuyAmountPaid(netPriceFor(buyUnitPrice * Math.max(0, Math.round(buySeances || 0)), buyDiscount));
                }}
                className={`rounded-xl border p-2.5 text-start text-xs transition-colors ${
                  !buyMonthly
                    ? "border-primary bg-primary text-white"
                    : "border-line bg-canvas/40 text-ink hover:bg-primary-50"
                }`}
              >
                <strong className="block">À la séance</strong>
                <span className={!buyMonthly ? "text-white/80" : "text-muted"}>
                  {buyUnitPrice} DA / séance · sans date de fin
                </span>
              </button>
              <button
                onClick={() => {
                  if (!hasMonthlyPlan(buySub)) return;
                  setBuyPlan("month");
                  // The month is paid in full at the desk in the usual case.
                  setBuyAmountPaid(netPriceFor(monthlyPriceOf(buySub), buyDiscount));
                }}
                disabled={!hasMonthlyPlan(buySub)}
                title={
                  hasMonthlyPlan(buySub)
                    ? "Un mois complet à partir de la date choisie"
                    : "Aucune formule mensuelle définie pour ce cours (page Abonnements)"
                }
                className={`rounded-xl border p-2.5 text-start text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  buyMonthly
                    ? "border-primary bg-primary text-white"
                    : "border-line bg-canvas/40 text-ink hover:bg-primary-50 disabled:hover:bg-canvas/40"
                }`}
              >
                <strong className="block">Au mois</strong>
                <span className={buyMonthly ? "text-white/80" : "text-muted"}>
                  {hasMonthlyPlan(buySub)
                    ? `${buyMonthSeances} séances · ${monthlyPriceOf(buySub)} DA / mois`
                    : "Non proposé pour ce cours"}
                </span>
              </button>
            </div>
          </div>

          {/* 3 — how many séances (or which month), at what unit price */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {buyMonthly ? (
              <>
                <div>
                  <label className="block text-xs font-semibold text-muted mb-1">
                    Début du mois * (aujourd&apos;hui par défaut)
                  </label>
                  <Input
                    type="date"
                    value={buyStartDate}
                    onChange={(e) => setBuyStartDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted mb-1">
                    Fin du mois (calculée)
                  </label>
                  <div className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm font-bold text-danger">
                    {formatDateFr(buyExpiry)}
                  </div>
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className="block text-xs font-semibold text-muted mb-1">
                    Nombre de séances à payer *
                  </label>
                  <Input
                    type="number"
                    min={1}
                    value={buySeances || ""}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      setBuySeances(n);
                      // "Paid in full" is the common case: prefill it, the cashier
                      // only edits the field when the family pays part of it.
                      const gross = buyUnitPrice * Math.max(0, Math.round(n || 0));
                      setBuyAmountPaid(
                        netPriceFor(
                          gross,
                          buyDiscountValue > 0
                            ? { type: buyDiscountType, value: buyDiscountValue }
                            : undefined,
                        ),
                      );
                    }}
                    placeholder="Ex: 8"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted mb-1">Prix d&apos;une séance</label>
                  <div className="rounded-xl border border-line bg-canvas px-3 py-2 text-sm font-bold text-ink">
                    {buyUnitPrice} DA
                  </div>
                </div>
              </>
            )}
          </div>

          {buyMonthly && (
            <div className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-[11px] leading-relaxed text-muted">
              🗓️ <strong className="text-ink">Mois du {formatDateFr(buyStartDate)} au {formatDateFr(buyExpiry)} :</strong>{" "}
              le compteur repart à <strong className="text-ink">{buyMonthSeances} séance(s)</strong> et
              l&apos;abonnement <strong className="text-ink">expire le {formatDateFr(buyExpiry)}</strong> — les
              séances non utilisées à cette date sont perdues et la carte est refusée jusqu&apos;au
              renouvellement.
            </div>
          )}

          {/* 4 — remise */}
          <div className="rounded-xl border border-line p-3">
            <label className="mb-2 block text-xs font-semibold text-muted">Remise (optionnelle)</label>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Select
                value={buyDiscountType}
                onChange={(e) => setBuyDiscountType(e.target.value as DiscountType)}
              >
                <option value="percent">Pourcentage (%)</option>
                <option value="amount">Montant fixe (DA)</option>
              </Select>
              <Input
                type="number"
                min={0}
                value={buyDiscountValue || ""}
                onChange={(e) => setBuyDiscountValue(Number(e.target.value))}
                placeholder={buyDiscountType === "percent" ? "Ex: 10" : "Ex: 500"}
              />
            </div>
          </div>

          {/* 5 & 6 — what is handed over, and what is left owing */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-muted mb-1">
                Montant payé par l&apos;étudiant (DA) *
              </label>
              <Input
                type="number"
                min={0}
                value={buyAmountPaid || ""}
                onChange={(e) => setBuyAmountPaid(Number(e.target.value))}
                placeholder="Ex: 4000"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted mb-1">Reste à payer</label>
              <div
                className={`rounded-xl border px-3 py-2 text-sm font-bold ${
                  buyRest > 0
                    ? "border-danger/40 bg-danger/10 text-danger"
                    : "border-success/40 bg-success/10 text-success"
                }`}
              >
                {buyRest} DA
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Description</label>
            <Input
              value={buyDesc}
              onChange={(e) => setBuyDesc(e.target.value)}
              placeholder="Laisser vide pour la description automatique"
            />
          </div>

          <div className="space-y-1 rounded-xl border border-line bg-canvas p-3 text-xs">
            <div className="flex justify-between">
              <span className="text-muted">
                {buyMonthly
                  ? `Prix du mois (${buyMonthSeances} séances):`
                  : `Total brut (${buySeances || 0} × ${buyUnitPrice} DA):`}
              </span>
              <strong className="text-ink">{buyGross} DA</strong>
            </div>
            {buyMonthly && monthlySeancesValue(buySub) !== buyGross && (
              <div className="flex justify-between">
                <span className="text-muted">Ces séances à l&apos;unité:</span>
                <strong
                  className={monthlySeancesValue(buySub) > buyGross ? "text-success" : "text-warning"}
                >
                  {monthlySeancesValue(buySub)} DA
                </strong>
              </div>
            )}
            {buyDiscountValue > 0 && (
              <div className="flex justify-between">
                <span className="text-muted">Remise appliquée:</span>
                <strong className="text-warning">
                  {discountLabel({ type: buyDiscountType, value: buyDiscountValue })} (−{buyGross - buyNet} DA)
                </strong>
              </div>
            )}
            <div className="flex justify-between border-t border-line pt-1">
              <span className="font-semibold text-muted">Net à payer:</span>
              <strong className="text-primary text-sm">{buyNet} DA</strong>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setIsBuyOpen(false)} disabled={buyBusy}>
              Annuler
            </Button>
            <Button
              onClick={handleBuySeances}
              disabled={buyBusy || !buySubId || (buyMonthly ? buyMonthSeances <= 0 : buySeances <= 0)}
            >
              {buyBusy
                ? "Enregistrement…"
                : buyMonthly
                  ? "Enregistrer le mois"
                  : "Enregistrer le paiement"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Pay Debt (Régler dette) — settles the unpaid remainder of the séance
          purchases, oldest first. */}
      <Modal open={isPayDebtOpen} onClose={() => setIsPayDebtOpen(false)} title="Régler la dette">
        <div className="space-y-4">
          {selectedStudent && (
            <div className="bg-canvas border border-line p-3 rounded-xl text-xs space-y-1">
              <div>
                <span className="text-muted block text-[10px] uppercase">Étudiant</span>
                <strong className="text-ink">{selectedStudent.firstName} {selectedStudent.lastName}</strong>
              </div>
              <div className="flex justify-between border-t border-line/50 pt-1.5 mt-1">
                <span className="text-muted">Dette actuelle:</span>
                <strong className={debtFor(selectedStudent) > 0 ? "text-danger" : "text-success"}>
                  {debtFor(selectedStudent)} DA
                </strong>
              </div>
              {selectedStudent.registrationDue ? (
                <div className="flex justify-between">
                  <span className="text-muted">Frais d&apos;inscription dus:</span>
                  <strong className="text-danger">{selectedStudent.registrationDue} DA</strong>
                </div>
              ) : null}
            </div>
          )}

          {selectedStudent && debtFor(selectedStudent) === 0 ? (
            <div className="rounded-xl border border-success/30 bg-success/10 p-3 text-xs font-semibold text-success">
              ✅ Ce compte est à jour : aucun reste à payer sur ses paiements de séances.
            </div>
          ) : (
            <>
              {/* Which purchases are still owed, oldest first */}
              {selectedStudent && (
                <div className="max-h-40 space-y-1 overflow-y-auto rounded-xl border border-line p-2 text-[11px]">
                  {studentPayments(db, selectedStudent.id)
                    .filter((p) => p.rest > 0)
                    .slice()
                    .reverse()
                    .map((p) => (
                      <div key={p.id} className="flex items-center justify-between gap-2">
                        <span className="truncate text-muted">
                          {p.date.substring(0, 10)} · {p.description ?? "Paiement de séances"}
                        </span>
                        <strong className="shrink-0 text-danger">{p.rest} DA</strong>
                      </div>
                    ))}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-muted mb-1 font-sans">
                  Montant à régler (DA) *
                </label>
                <Input
                  type="number"
                  min={0}
                  value={payAmount || ""}
                  onChange={(e) => setPayAmount(Number(e.target.value))}
                  placeholder="Ex: 1000"
                />
                <p className="mt-1 text-[11px] text-muted">
                  Le règlement s&apos;impute sur les paiements les plus anciens en premier.
                </p>
              </div>
            </>
          )}

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => setIsPayDebtOpen(false)}>
              Annuler
            </Button>
            <Button
              onClick={handlePayDebtSubmit}
              disabled={!selectedStudent || debtFor(selectedStudent) === 0 || payAmount <= 0}
            >
              Enregistrer le règlement
            </Button>
          </div>
        </div>
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
        title="Alerte Séances Presque Épuisées"
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
    </div>
  );
}
