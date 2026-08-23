"use client";

import { create } from "zustand";
import { emptyDatabase, loadDatabase, loadSchool } from "@/lib/supabase/load";
import {
  caseReductionCut,
  cycleSizeOf,
  currentCycleCode,
  isFreeSub,
  joinPointFor,
  groupSeanceTotals,
  netPriceFor,
  sessionTimesOn,
  soldFor,
  studentDebtSummary,
  studentHasDebt,
  studentListPrice,
} from "@/lib/helpers";
import type {
  AbsencePenalty,
  Announcement,
  AttendanceRecord,
  AttendanceStatus,
  CashTransaction,
  ClassCategory,
  Coursework,
  Day,
  DiscountType,
  Enrollment,
  Expense,
  ExpenseCategory,
  FreePeriod,
  FreePeriodStat,
  Group,
  GroupSeance,
  IndependentSession,
  Module,
  ModuleAbsenceRule,
  Notification,
  Parent,
  Payment,
  PaymentSource,
  ReceptionStaff,
  Salle,
  School,
  ScheduleSession,
  SchoolClass,
  Student,
  StudentCredential,
  Subject,
  Subscription,
  SubscriptionDiscount,
  SubscriptionPlan,
  Teacher,
  TeacherAbsence,
  TeacherAcompte,
  TeacherChildCharge,
  TeacherChildDebt,
  TeacherExpense,
  TeacherPayment,
  TeacherPaymentDeduction,
  TeacherPaymentMonth,
  UnpaidTeacherSession,
  WorkerShift,
} from "@/lib/types";

export interface Database {
  school: School;
  /** optional kindergarten class categories */
  classCategories: ClassCategory[];
  modules: Module[];
  groups: Group[];
  salles: Salle[];
  classes: SchoolClass[];
  teachers: Teacher[];
  teacherPayments: TeacherPayment[];
  reception: ReceptionStaff[];
  workerShifts: WorkerShift[];
  sessions: ScheduleSession[];
  subscriptions: Subscription[];
  freePeriods: FreePeriod[];
  students: Student[];
  studentCredentials: StudentCredential[];
  moduleAbsenceRules: ModuleAbsenceRule[];
  /** séance-counted inscriptions (student × subscription) */
  enrollments: Enrollment[];
  /** séance purchases and debt settlements */
  payments: Payment[];
  attendance: AttendanceRecord[];
  absencePenalties: AbsencePenalty[];
  unpaidTeacher: UnpaidTeacherSession[];
  acomptes: TeacherAcompte[];
  /** costs the school carries for a teacher, deducted from his next settlement */
  teacherExpenses: TeacherExpense[];
  /** scolarités d'enfants créditées d'avance et portées sur le salaire du père */
  teacherChildDebts: TeacherChildDebt[];
  absences: TeacherAbsence[];
  subjects: Subject[];
  announcements: Announcement[];
  categories: ExpenseCategory[];
  expenses: Expense[];
  cash: CashTransaction[];
  parents: Parent[];
  notifications: Notification[];
  coursework: Coursework[];
  independent: IndependentSession[];
  /** séances libres vendues à un GROUPE d'élèves, sans nommer personne */
  groupSeances: GroupSeance[];
}

/** Ids are generated locally now (demo mode); the prefix is kept so the ~100
 *  existing `uid("stu")`-style call sites read the same. */
export function uid(prefix?: string): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix ?? "id"}-${Date.now().toString(36)}-${rand}`;
}

// =============================================================================
// Date / time helpers — the whole app runs on the local clock in demo mode, so
// the "Africa/Algiers" conversions the SQL used are simply local time here.
// =============================================================================

const JS_DAYS: Day[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

/** "HH:mm" -> minutes since midnight. */
function timeToMinutes(t?: string): number {
  if (!t) return 0;
  const [h, m] = t.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function minutesToTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Local YYYY-MM-DD of a Date (or of an ISO string). */
function dateKey(value: Date | string): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleDateString("fr-CA");
}

function dayOf(d: Date): Day {
  return JS_DAYS[d.getDay()];
}

/** The weekday a YYYY-MM-DD key falls on. Parsed at midday so a timezone shift
 *  can never push the date onto the day before. */
function dayOfKey(key: string): Day {
  return dayOf(new Date(`${key}T12:00:00`));
}

/** When an emploi du temps starts on a GIVEN date — its hours may differ from
 *  one weekday to the next. */
function startTimeOnDate(session: ScheduleSession, date: string): string {
  return sessionTimesOn(session, dayOfKey(date)).startTime;
}

function minutesOf(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

/** Adds `n` days to a YYYY-MM-DD key. */
function addDays(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d + n);
  return date.toLocaleDateString("fr-CA");
}

/** Whole days between two YYYY-MM-DD keys (b - a). */
function diffDays(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round(
    (new Date(by, bm - 1, bd).getTime() - new Date(ay, am - 1, ad).getTime()) / 86400000,
  );
}

function maxKey(...keys: Array<string | undefined>): string {
  return keys.filter(Boolean).sort().slice(-1)[0] as string;
}

function frDate(key: string): string {
  const [y, m, d] = key.split("-");
  return `${d}/${m}/${y}`;
}

/** Last "week opening day" (0 = sunday … 6 = saturday) on or before `key`. */
function weekAnchor(key: string, startDow: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const dow = new Date(y, m - 1, d).getDay();
  return addDays(key, -(((dow - startDow + 7) % 7)));
}

// =============================================================================
// Result shapes — unchanged, every page reads them.
// =============================================================================

export interface ScanResult {
  ok: boolean;
  studentId?: string;
  sessionId?: string;
  /** net price of ONE séance on that inscription. Money never moves on a
   *  presence any more — this only sizes the teacher's share and is what the
   *  receipt prints. */
  cost?: number;
  /** present | late | absent | cancelled (set on successful writes) */
  status?: AttendanceStatus;
  /** séances left on that inscription once the presence is written */
  remaining?: number;
  /** this presence took the last séance of the inscription */
  exhausted?: boolean;
  /** there was nothing left to take: the presence is kept and flagged */
  outOfSeances?: boolean;
  moduleName?: string;
  sessionStart?: string;
  sessionEnd?: string;
  /** on scan.tooEarly: start time (HH:mm) of the next séance today */
  nextStart?: string;
  /** on absent/cancel: how many séances were given back (0 or 1) */
  refunded?: number;
  /** group of the séance the scan was actually matched to */
  groupName?: string;
  /** the student is enrolled in ANOTHER group of the same course: he attended
   *  a sibling group ("rattrapage"), which is allowed and billed normally */
  otherGroup?: boolean;
  /** the group he is actually enrolled in (only set when otherGroup) */
  ownGroupName?: string;
  /** a "période gratuite" covered the séance: presence written, balance intact */
  free?: boolean;
  /** label of that free period */
  freePeriodName?: string;
  /** the séance happened BEFORE the enrollment's start date: presence written,
   *  balance strictly untouched */
  preStart?: boolean;
  /** that start date (YYYY-MM-DD), only set when preStart */
  enrollmentStart?: string;
  /** what was offered on this scan — free period or pre-start séance (the
   *  price NOT charged) */
  waived?: number;
  messageKey: string;
}

/** What one click on the présence sheet actually did. */
export interface PresenceResult {
  ok: boolean;
  messageKey: string;
  /** what is now written for that day — null when the row was removed */
  status?: AttendanceStatus | null;
  /** money taken off the solde by this click */
  charged?: number;
  /** money given back by this click */
  refunded?: number;
  /** the solde of that emploi once the click is applied */
  balance?: number;
  /** the row costs nothing (annulée, or a first-ever absence) */
  noCharge?: boolean;
  moduleName?: string;
}

export interface TeacherSettlement {
  ok: boolean;
  net?: number;
  gross?: number;
  sessions?: number;
  acomptes?: number;
  absences?: number;
  messageKey?: string;
}

/** Result of a worker badge swipe (clock-in / clock-out). */
export interface WorkerScanResult {
  ok: boolean;
  workerId?: string;
  workerName?: string;
  date?: string;
  startAt?: string;
  minutes?: number;
  messageKey: string;
}

interface DataActions {
  loaded: boolean;
  fetchSchool: () => Promise<void>;
  fetchAll: () => Promise<void>;
  clear: () => void;

  scanCard: (rfidOrStudentId: string, when?: Date) => Promise<ScanResult>;
  markAttendance: (
    studentId: string,
    sessionId: string,
    status: "present" | "late" | "absent",
    opts?: { date?: string; allowDebt?: boolean; skipTeacherDue?: boolean },
  ) => Promise<ScanResult>;
  /**
   * The présence sheet writes through THIS action: one call per click, no
   * confirmation, fully reversible. It upserts the row of
   * `{student, emploi, day}` and moves the student's SOLDE by exactly the price
   * of one séance — forward on présent/absent, not at all on annulée, and
   * backwards when `status` is null (the click was a mistake).
   */
  setPresence: (args: {
    studentId: string;
    sessionId: string;
    date: string;
    /** null undoes whatever was recorded that day */
    status: AttendanceStatus | null;
  }) => Promise<PresenceResult>;
  /**
   * Recharges the SOLDE of one emploi du temps. The money is booked on ONE of
   * that emploi's own months (M1, M2 …) — by default the month the student is
   * currently on.
   */
  addSold: (args: {
    studentId: string;
    subscriptionId: string;
    amount: number;
    monthCode?: string;
    description?: string;
    /**
     * WHERE the money comes from:
     *  - `cash` (default): the family paid at the desk — one inflow in the till,
     *  - `teacher_salary`: taken off a teacher-father's pay — NO cash movement,
     *  - `school_cash`: the school covered it out of its own caisse — the till
     *    carries BOTH the payment booked on the student and the outflow that
     *    paid for it, so the balance stays exact and the history says so.
     */
    source?: PaymentSource;
  }) => Promise<{ ok: boolean; paymentId?: string; balance?: number; monthCode?: string }>;
  /**
   * L'ÉCOLE COUVRE LA DETTE D'UN ÉLÈVE, de sa propre caisse.
   *
   * Tant qu'un élève doit de l'argent, la part que ses séances rapportent à
   * l'enseignant reste RETENUE : elle ne se règle pas. Quand l'école décide de
   * ne pas faire attendre l'enseignant, elle avance elle-même ce que l'élève
   * doit — et la paie se débloque immédiatement.
   *
   * Tout ce que `studentHasDebt` regarde est couvert : les mois dans le rouge,
   * les restes d'anciens paiements et les frais d'inscription. Restreindre à un
   * `subscriptionId` (et éventuellement à un `monthCode`) ne couvre que cette
   * dette-là — les autres restent dues et continuent de retenir la part.
   *
   * Deux mouvements sont écrits dans la caisse par dette couverte : le paiement
   * porté au crédit de l'élève, et la sortie qui l'a financé. Le solde de la
   * caisse est donc juste, et l'historique montre exactement ce qui s'est passé.
   */
  coverStudentDebt: (args: {
    studentId: string;
    /** ne couvrir que cet emploi du temps (absent = toutes ses dettes) */
    subscriptionId?: string;
    /** ne couvrir que ce mois de cet emploi */
    monthCode?: string;
    /**
     * LE CHOIX EXPLICITE DE LA CAISSE : les mois à couvrir, et pour COMBIEN.
     *
     * Sans cette liste, l'école avance tout ce qui retient la part de
     * l'enseignant, au dinar près. Avec elle, la réception décide : elle coche
     * les mois impayés qu'elle veut régler et corrige le montant de chacun à la
     * main — l'école peut donc n'avancer qu'une partie d'un mois, et le reste
     * demeure dû par la famille. Une ligne à 0 est simplement ignorée.
     */
    lines?: { subscriptionId: string; monthCode: string; amount: number; label?: string }[];
    /** ce que l'école règle sur les restes d'anciens paiements et les frais
     *  d'inscription (n'a de sens qu'avec `lines`) */
    otherAmount?: number;
    description?: string;
  }) => Promise<{ ok: boolean; amount?: number; rows?: number; messageKey?: string }>;
  /**
   * LA SCOLARITÉ D'UN FILS D'ENSEIGNANT, RÉGLÉE DEPUIS LA FEUILLE DU GROUPE.
   *
   * Deux chemins, et c'est la réception qui tranche au guichet :
   *
   *  - `source: "cash"` — la famille paie elle-même, maintenant. L'argent entre
   *    en caisse comme n'importe quel versement d'élève, et RIEN n'est retenu au
   *    père : son salaire n'est pas amputé, l'écran de paie affiche simplement
   *    le mois « payé par la famille ».
   *  - `source: "teacher_debt"` — à porter sur le salaire du père. Le solde de
   *    l'enfant est crédité tout de suite (ses mois sortent du rouge, la part
   *    que ses séances rapportent se débloque) et le montant est inscrit en
   *    attente sur l'enseignant : son prochain règlement le retient sur son net,
   *    une fois et une seule.
   *
   * Dans les deux cas, aucun règlement d'enseignant n'a besoin d'être ouvert.
   */
  payTeacherChild: (args: {
    studentId: string;
    subscriptionId: string;
    monthCode: string;
    amount: number;
    /** "cash" = la famille paie, "teacher_debt" = à retenir sur le père */
    source: "cash" | "teacher_debt";
    description?: string;
  }) => Promise<{
    ok: boolean;
    paymentId?: string;
    debtId?: string;
    balance?: number;
    messageKey?: string;
  }>;
  /**
   * SUPPRIME UN EMPLOI DU TEMPS SANS RIEN EFFACER DE SON HISTOIRE.
   *
   * L'emploi disparaît de la grille, de la feuille de présence et du catalogue
   * d'inscription — mais sa ligne, son tarif et tout ce qui s'y rattache
   * restent : les présences pointées, les soldes et les paiements des élèves,
   * les parts dues à l'enseignant. L'historique continue donc de les afficher
   * avec le nom du module, du groupe et de la salle, au lieu de tirets.
   *
   * Les élèves inscrits en sont sortis à la date du jour, exactement comme une
   * désinscription : leur fiche garde le module, daté de la sortie.
   */
  archiveSession: (
    sessionId: string,
  ) => Promise<{ ok: boolean; students?: number; subscriptions?: number }>;
  cancelAttendance: (attendanceId: string) => Promise<ScanResult>;
  /** Corrects one presence (status / date-time / amount charged); the balance
   *  moves by exactly the same delta. */
  updateAttendance: (
    attendanceId: string,
    fields: { status?: AttendanceStatus; occurredAt?: string; amount?: number },
  ) => Promise<ScanResult>;
  /** Removes one automatic weekly-absence charge and refunds it. */
  deleteAbsencePenalty: (penaltyId: string) => Promise<ScanResult>;
  /** Writes ONE tariff for every group of a course (same class + module +
   *  teacher), creating the missing ones. Returns how many groups were priced. */
  setSubscriptionPrice: (
    sessionId: string,
    price: number,
    opts?: {
      levelPrice?: number;
      periodMonths?: number;
      /** monthly formula: séances included in a month (0 = no monthly offer) */
      monthlySeances?: number;
      /** price of that month (defaults to séances × unit price) */
      monthlyPrice?: number;
      /** how much of the month price the school keeps */
      schoolMonthShare?: number;
      /** teacher pay for one séance (teacher month share / monthlySeances) */
      teacherPerSeance?: number;
    },
  ) => Promise<{ ok: boolean; groups?: number; created?: number; updated?: number }>;
  /**
   * Retire le tarif d'un cours entier (tous ses groupes).
   *
   * Comme la suppression d'un emploi du temps, elle ARCHIVE au lieu d'effacer :
   * un tarif effacé emporterait avec lui les inscriptions qui s'y accrochent —
   * donc les soldes — et rendrait illisibles les paiements déjà encaissés
   * dessus. Le tarif quitte le catalogue, ses élèves en sont désinscrits à la
   * date du jour, et tout l'historique reste nommé. Le redéfinir plus tard le
   * remet simplement en service.
   */
  deleteSubscriptionPrice: (sessionId: string) => Promise<{ ok: boolean; deleted?: number }>;
  /** Cost of every "période gratuite" (presences, students, total offered). */
  fetchFreePeriodStats: () => Promise<FreePeriodStat[]>;
  /** Bills every module a student has been absent on for a full week
   *  (idempotent). Returns how many weekly charges were written. */
  processWeeklyAbsences: () => Promise<{ ok: boolean; charged?: number; students?: number }>;
  settleTeacherPercentage: (teacherId: string) => Promise<TeacherSettlement>;

  /** Worker badge: 1st swipe of the day = clock-in, 2nd = clock-out. */
  scanWorkerCard: (code: string) => Promise<WorkerScanResult>;
  /** Freezes days started without a clock-out once the day is over. */
  freezeOpenWorkerShifts: () => Promise<{ ok: boolean; frozen?: number }>;
  /** Settles the selected worked days; they never reappear as unpaid. */
  payWorkerShifts: (
    workerId: string,
    shiftIds: string[],
    amount: number,
    description?: string,
  ) => Promise<{ ok: boolean; days?: number; minutes?: number; messageKey?: string }>;
  /**
   * Settles the selected teacher timings ("YYYY-MM-DD|sessionId" keys).
   *
   * `amount` is what he actually takes home. Everything taken off on the way
   * there is settled in the same movement and never comes back: the dépenses
   * and acomptes listed in `expenseIds` / `acompteIds` are flagged paid, and
   * the soldes of the children in `childCharges` are cleared — the school is
   * paid for them out of their father's salary, so no cash changes hands.
   */
  payTeacherSessions: (args: {
    teacherId: string;
    /** legacy selection: "YYYY-MM-DD|sessionId" créneaux, settled whole */
    keys?: string[];
    /**
     * The EXACT dues settled — `unpaid_teacher_sessions` ids. Months are per
     * student, so two students of the same créneau may well sit in different
     * months: only an explicit list can settle one month without touching the
     * next. When given, it wins over `keys`.
     */
    dueIds?: string[];
    /** the exact passager rows (séances libres) settled alongside */
    passagerIds?: string[];
    /** net paid to the teacher */
    amount: number;
    /** what the séances earned him before the deductions */
    gross?: number;
    /** "group" = each emploi du temps priced its own séances */
    method: "fixed" | "percent" | "group";
    percentage?: number;
    details?: unknown[];
    /** the emploi-du-temps months this settlement closes */
    months?: TeacherPaymentMonth[];
    description?: string;
    /** dépenses cleared by this settlement */
    expenseIds?: string[];
    /** acomptes cleared by this settlement */
    acompteIds?: string[];
    /** children whose inscriptions this settlement pays for */
    childCharges?: TeacherChildCharge[];
    /** scolarités déjà créditées et portées sur lui (`TeacherChildDebt`) que ce
     *  règlement solde — elles ne reviendront pas sur le suivant */
    childDebtIds?: string[];
  }) => Promise<{ ok: boolean; paymentId?: string; sessions?: number; messageKey?: string }>;
  /** Buys N séances on one inscription: creates or tops up the
   *  `{studentId, subscriptionId}` enrollment and writes the matching Payment
   *  (gross, remise, net, what was handed over, and the rest left owing). */
  createEnrollmentPayment: (args: {
    studentId: string;
    subscriptionId: string;
    seances: number;
    discountType?: DiscountType;
    discountValue?: number;
    amountPaid: number;
    startDate?: string;
    expiryDate?: string;
    description?: string;
    /** "month" buys a whole month: the séance counter is RESET to the pack and
     *  the inscription expires one month after `startDate`. */
    plan?: SubscriptionPlan;
    /** séances the bought month includes (defaults to the tariff's own) */
    monthSeances?: number;
    /** price of that month (defaults to the tariff's own) */
    packagePrice?: number;
  }) => Promise<{ ok: boolean; enrollmentId?: string; paymentId?: string; rest?: number }>;
  /** Rewrites the formula and the dates of ONE inscription (student × module)
   *  without touching the money — used when reception edits the inscription. */
  setEnrollmentPlan: (
    studentId: string,
    subscriptionId: string,
    fields: {
      plan?: SubscriptionPlan;
      startDate?: string;
      expiryDate?: string;
      monthSeances?: number;
    },
  ) => Promise<{ ok: boolean }>;
  /** Settles a student's debt oldest-first. Returns what is still owed. */
  payStudentDebt: (
    studentId: string,
    amount: number,
  ) => Promise<{ ok: boolean; settled?: number; remainingDebt?: number }>;
  /** Settles a student's debt for ONE school month only (M1…M11), oldest-first
   *  within that month. Used by the dashboard fiche and the debts screen. */
  payMonthDebt: (
    studentId: string,
    monthCode: string,
    amount: number,
    description?: string,
  ) => Promise<{ ok: boolean; settled?: number; remainingDebt?: number }>;
  /**
   * Registers a student on ONE emploi du temps, exactly where the group stands:
   * the month it is living and the séance being held on `date` (the next one
   * when nothing has been pointed that day). The séances that ran before him
   * are never his — they stay blank on the sheet, and the months he was not
   * part of do not list him.
   */
  subscribeStudent: (args: {
    studentId: string;
    subscriptionId: string;
    /** the day he comes in on (defaults to today) */
    date?: string;
  }) => Promise<{ ok: boolean; monthCode?: string; slotIndex?: number }>;
  /**
   * Takes a student OFF one emploi du temps. His history stays untouched —
   * présences, paiements and solde are kept, so re-registering him later finds
   * his money exactly where he left it; only his place on the roster goes.
   */
  unsubscribeStudent: (
    studentId: string,
    subscriptionId: string,
  ) => Promise<{ ok: boolean; balance?: number; leftOn?: string }>;
  /**
   * Removes ONE money movement of a student from his history: the solde it
   * credited is taken back off the emploi du temps, and the cash movement it
   * posted leaves the caisse with it. Used by the fiche élève and by the
   * group's présence sheet, so a mis-typed encaissement is undone where it was
   * made.
   */
  deleteStudentPayment: (
    paymentId: string,
  ) => Promise<{ ok: boolean; balance?: number; amount?: number; messageKey?: string }>;
  /**
   * Corrects ONE money movement: the amount, the month it is booked on, its
   * date or its wording. The solde moves by exactly the difference, and the
   * caisse follows.
   */
  updateStudentPayment: (
    paymentId: string,
    fields: { amount?: number; monthCode?: string; description?: string; date?: string },
  ) => Promise<{ ok: boolean; balance?: number; messageKey?: string }>;
  /**
   * Creates or rewrites a "séance libre de groupe". Both cash movements — the
   * money in and the teacher's pay out — are written, rewritten or removed
   * with the row, so the caisse, la fiche de l'enseignant et les rapports ne
   * peuvent pas diverger.
   */
  saveGroupSeance: (
    input: Omit<GroupSeance, "cashInId" | "cashOutId" | "createdAt"> & { createdAt?: string },
  ) => Promise<{ ok: boolean; id?: string }>;
  /** Deletes a séance libre de groupe and both of its cash movements. */
  deleteGroupSeance: (id: string) => Promise<{ ok: boolean }>;
  /** Uses up one séance of an inscription (attendance). */
  consumeSeance: (
    enrollmentId: string,
  ) => Promise<{ ok: boolean; remaining?: number; exhausted?: boolean }>;
  /** Stores/updates the printable portal password. */
  setStudentPassword: (studentId: string, password: string) => Promise<void>;
  /** Turns the weekly-absence billing on/off for a single module. */
  setModuleAbsenceRule: (moduleId: string, enabled: boolean, daysWindow?: number) => Promise<void>;
  deleteFrom: <K extends keyof Database>(key: K, id: string) => void;
  push: <K extends keyof Database>(
    key: K,
    item: Database[K] extends Array<infer T> ? T : never,
  ) => void;
  updateItem: <K extends keyof Database>(
    key: K,
    id: string,
    updatedFields: Partial<Database[K] extends Array<infer T> ? T : never>,
  ) => void;
  cashMove: (
    type: "deposit" | "withdraw",
    amount: number,
    description: string,
    date?: string,
  ) => void;
  updateSchool: (updatedFields: Partial<School>) => void;
  restoreState: (dump: Partial<Database>) => void;
  reset: () => void;
}

export type DataStore = Database & DataActions;

// =============================================================================
// Pure selectors over a snapshot — the in-memory replacement for the SQL rules.
// =============================================================================

/** Identity of a cours: class + module + teacher. A séance libre stands alone. */
function courseKey(s: ScheduleSession): string {
  return s.isOpen ? `open-${s.id}` : `${s.classId}|${s.moduleId}|${s.teacherId}`;
}

function siblingIds(db: Database, sessionId: string): string[] {
  const src = db.sessions.find((s) => s.id === sessionId);
  if (!src) return [];
  const key = courseKey(src);
  return db.sessions.filter((s) => courseKey(s) === key).map((s) => s.id);
}

interface EnrollmentView {
  subscriptionId: string;
  sessionId: string;
  session: ScheduleSession;
  price: number;
  discount?: SubscriptionDiscount;
  startDate?: string;
  expiryDate?: string;
  /** the séance-counted Enrollment row, when one exists */
  enrollmentId?: string;
  remaining: number;
}

/** Every module the student is enrolled in, resolved to its timing, its tariff
 *  and how many séances it has left. The reduction stored on the Enrollment
 *  wins over the legacy per-student map, since that is what was actually
 *  applied when the séances were bought. */
function enrollmentsOf(db: Database, student: Student): EnrollmentView[] {
  return student.subscriptionIds
    .map((subId) => {
      const sub = db.subscriptions.find((s) => s.id === subId);
      if (!sub) return null;
      const session = db.sessions.find((s) => s.id === sub.sessionId);
      if (!session) return null;
      const dates = student.subscriptionDates?.[subId];
      const row = db.enrollments.find(
        (e) => e.studentId === student.id && e.subscriptionId === subId,
      );
      const discount = row?.discount ?? student.subscriptionDiscounts?.[subId];
      return {
        subscriptionId: subId,
        sessionId: sub.sessionId,
        session,
        price: netPriceFor(studentListPrice(student, sub), discount),
        discount,
        startDate: row?.startDate ?? dates?.startDate,
        expiryDate: row?.expiryDate ?? dates?.expiryDate,
        enrollmentId: row?.id,
        remaining: row ? row.paidSeances - row.consumedSeances : 0,
      } satisfies EnrollmentView;
    })
    .filter(Boolean) as EnrollmentView[];
}

/** The enrollment that covers a given timing: his own group first, then any
 *  sibling group of the same cours (rattrapage). */
function enrollmentFor(
  db: Database,
  student: Student,
  session: ScheduleSession,
  onDate: string,
): EnrollmentView | undefined {
  const all = enrollmentsOf(db, student);
  const own = all.find((e) => e.sessionId === session.id);
  if (own) return own;
  return all
    .filter(
      (e) =>
        e.session.moduleId === session.moduleId &&
        e.session.classId === session.classId &&
        (!e.expiryDate || e.expiryDate >= onDate),
    )
    .sort((a, b) => (a.startDate ?? "").localeCompare(b.startDate ?? ""))[0];
}

/** The free period covering that class on that day, if any. */
function activeFreePeriod(
  db: Database,
  classIds: string[],
  onDate: string,
): FreePeriod | undefined {
  return db.freePeriods
    .filter(
      (fp) =>
        fp.active &&
        onDate >= fp.startDate &&
        onDate <= fp.endDate &&
        (fp.allClasses || fp.classIds.some((c) => classIds.includes(c))),
    )
    .sort((a, b) => b.startDate.localeCompare(a.startDate))[0];
}

/**
 * What the teacher earns on ONE séance of a given emploi du temps. When the
 * emploi carries a monthly split (month price -> school share -> teacher
 * remainder / séances), that fixed per-séance price wins; otherwise the
 * teacher's own percentage contract applies.
 *
 * A teacher paid "par groupe" is priced by the emplois du temps ONLY: if the
 * one he just taught carries no split yet, the séance simply owes him nothing
 * until the abonnement is given one — his fiche has no rate of its own.
 *
 * The STUDENT's case then has the last word, exactly as the fiche promises:
 *  - `special` (scolarité offerte SUR CET EMPLOI DU TEMPS): neither the school
 *    nor the teacher is paid. La gratuité se coche module par module, donc un
 *    même élève peut très bien rapporter sur un autre de ses emplois,
 *  - `school_only`: the school is paid, the listed teachers are not,
 *  - `reduction`: the teacher grants his own part of the remise, so it comes
 *    off his share and not off the school's.
 */
function teacherDueFor(
  db: Database,
  session: ScheduleSession,
  sub: Subscription | undefined,
  base: number,
  student?: Student,
): number {
  if (student) {
    if (isFreeSub(student, sub?.id)) return 0;
    if (
      student.studentCase === "school_only" &&
      session.teacherId &&
      (student.unpaidTeacherIds ?? []).includes(session.teacherId)
    ) {
      return 0;
    }
  }

  const perSeance = sub?.teacherPerSeance ?? 0;
  const gross =
    perSeance > 0
      ? Math.max(0, Math.round(perSeance))
      : teacherShare(db, session.teacherId, base);

  // La moitié « enseignant » de la remise, calculée par le MÊME helper que
  // celui qui l'affiche sur la paie et qui la retire du prix de l'élève : les
  // deux côtés du partage ne peuvent donc pas diverger.
  return Math.max(0, gross - caseReductionCut(student, "teacher", gross));
}

function teacherShare(db: Database, teacherId: string | undefined, base: number): number {
  if (!teacherId) return 0;
  const teacher = db.teachers.find((t) => t.id === teacherId);
  // "monthly" is paid by contract and "per_group" by the emploi du temps —
  // neither earns a percentage of what the student paid.
  if (!teacher || teacher.paymentType !== "percentage") return 0;
  return Math.round((base * (teacher.percentage ?? 0)) / 100);
}

const MODULE_NAME = (db: Database, id: string) => db.modules.find((m) => m.id === id)?.name ?? "";
const GROUP_NAME = (db: Database, id: string) => db.groups.find((g) => g.id === id)?.name ?? "";

// Throttle for the automatic weekly-absence billing (the SQL kept it on the
// school row; in demo mode one run per app session is plenty).
let lastAbsenceRun: string | null = null;

const SCAN_EARLY_MARGIN = 30; // min before the start the card is already accepted
const SCAN_LATE_AFTER = 30; // min after the start a presence counts as "late"
const SCAN_COOLDOWN_MIN = 30; // min before the SAME timing accepts a new swipe
const SCAN_DOUBLE_SWIPE_SEC = 60; // reader sometimes sends two frames

export const useData = create<DataStore>((set, get) => ({
  ...emptyDatabase(),
  loaded: false,

  /** The establishment alone — the login screen needs its name and logo before
   *  anyone is signed in, and that row is readable without an account. */
  fetchSchool: async () => {
    try {
      set({ school: await loadSchool() });
    } catch (err) {
      console.error("[supabase] fetchSchool", err);
    }
  },

  /** Reads the whole database in one pass. Every screen then works off this
   *  snapshot, and `lib/supabase/sync.ts` mirrors back whatever they change. */
  fetchAll: async () => {
    try {
      const db = await loadDatabase();
      set({ ...db, loaded: true });
    } catch (err) {
      console.error("[supabase] fetchAll", err);
      set({ loaded: true });
    }
  },

  clear: () => set({ ...emptyDatabase(), loaded: false }),

  // ---------------------------------------------------------------------------
  // Check-in — schedule matching, cross-group rattrapage, free periods,
  // pre-start enrollments, deduction, presence, teacher payout.
  // ---------------------------------------------------------------------------
  scanCard: async (rfidOrStudentId, when) => {
    const db = get();
    const code = rfidOrStudentId.trim();
    const student = db.students.find((s) => s.rfid === code || s.id === code);
    if (!student) return { ok: false, messageKey: "scan.notFound" };

    const now = when ?? new Date();
    const today = dateKey(now);
    const dow = dayOf(now);
    const nowMin = minutesOf(now);

    // Anti double-swipe: very short, across every timing.
    const lastAny = db.attendance
      .filter((a) => a.studentId === student.id)
      .map((a) => new Date(a.timestamp).getTime())
      .sort((a, b) => b - a)[0];
    if (
      lastAny !== undefined &&
      now.getTime() >= lastAny &&
      now.getTime() - lastAny < SCAN_DOUBLE_SWIPE_SEC * 1000
    ) {
      return { ok: false, studentId: student.id, messageKey: "scan.cooldown" };
    }

    const enrollments = enrollmentsOf(db, student);
    const eligible = (se: ScheduleSession) =>
      enrollments.some(
        (e) =>
          e.session.moduleId === se.moduleId &&
          e.session.classId === se.classId &&
          (!e.expiryDate || e.expiryDate >= today),
      );

    // Un emploi du temps supprimé ne tient plus séance : une carte scannée ne
    // peut plus y être pointée, même si tout son passé reste lisible.
    const scheduledToday = db.sessions.filter(
      (se) =>
        !se.archivedAt &&
        se.days.includes(dow) &&
        (!se.periodStart || se.periodStart <= today) &&
        (!se.periodEnd || se.periodEnd >= today),
    );

    // An emploi may run at different hours depending on the weekday, so every
    // comparison below reads the hours OF TODAY, never the emploi's default.
    const startsAt = (se: ScheduleSession) => timeToMinutes(sessionTimesOn(se, dow).startTime);
    const endsAt = (se: ScheduleSession) => timeToMinutes(sessionTimesOn(se, dow).endTime);

    const matched = scheduledToday
      .filter(
        (se) =>
          nowMin >= startsAt(se) - SCAN_EARLY_MARGIN && nowMin <= endsAt(se) && eligible(se),
      )
      .sort((a, b) => {
        const started = (s: ScheduleSession) => (nowMin >= startsAt(s) ? 0 : 1);
        const own = (s: ScheduleSession) => (enrollments.some((e) => e.sessionId === s.id) ? 0 : 1);
        return (
          started(a) - started(b) ||
          own(a) - own(b) ||
          Math.abs(startsAt(a) - nowMin) - Math.abs(startsAt(b) - nowMin)
        );
      })[0];

    if (!matched) {
      const eligibleToday = scheduledToday.filter(eligible);
      if (eligibleToday.length > 0) {
        const upcoming = eligibleToday
          .map(startsAt)
          .filter((m) => m - SCAN_EARLY_MARGIN > nowMin)
          .sort((a, b) => a - b)[0];
        if (upcoming !== undefined) {
          return {
            ok: false,
            studentId: student.id,
            messageKey: "scan.tooEarly",
            nextStart: minutesToTime(upcoming),
          };
        }
        return { ok: false, studentId: student.id, messageKey: "scan.sessionEnded" };
      }

      const validEnr = enrollments.filter((e) => !e.expiryDate || e.expiryDate >= today);
      if (enrollments.length > 0 && validEnr.length === 0) {
        return { ok: false, studentId: student.id, messageKey: "scan.subscriptionExpired" };
      }

      const runningNow = db.sessions.some(
        (se) =>
          !se.archivedAt &&
          se.days.includes(dow) &&
          nowMin >= startsAt(se) - SCAN_EARLY_MARGIN &&
          nowMin <= endsAt(se),
      );
      return {
        ok: false,
        studentId: student.id,
        messageKey: runningNow ? "scan.notEligible" : "scan.noSessionToday",
      };
    }

    // Anti re-swipe on the SAME timing (30 min).
    const lastSame = db.attendance
      .filter((a) => a.studentId === student.id && a.sessionId === matched.id)
      .map((a) => new Date(a.timestamp).getTime())
      .sort((a, b) => b - a)[0];
    if (
      lastSame !== undefined &&
      now.getTime() >= lastSame &&
      now.getTime() - lastSame < SCAN_COOLDOWN_MIN * 60000
    ) {
      return {
        ok: false,
        studentId: student.id,
        sessionId: matched.id,
        messageKey: "scan.cooldown",
      };
    }

    const moduleName = MODULE_NAME(db, matched.moduleId);
    const groupName = GROUP_NAME(db, matched.groupId);
    const ownGroup = enrollments.some((e) => e.sessionId === matched.id);
    const ownGroupName = ownGroup
      ? undefined
      : GROUP_NAME(
          db,
          enrollments.find(
            (e) =>
              e.session.moduleId === matched.moduleId && e.session.classId === matched.classId,
          )?.session.groupId ?? "",
        ) || undefined;

    // The student may ONLY be marked present on the exact group he is enrolled
    // in. Attending a sibling group of the same cours (rattrapage) is refused —
    // séances libres are the only shared timing and are exempt.
    if (!ownGroup && !matched.isOpen) {
      return {
        ok: false,
        studentId: student.id,
        sessionId: matched.id,
        moduleName,
        groupName,
        ownGroupName,
        otherGroup: true,
        messageKey: "scan.wrongGroup",
      };
    }

    const already = db.attendance.find(
      (a) =>
        a.studentId === student.id &&
        a.sessionId === matched.id &&
        dateKey(a.timestamp) === today,
    );
    if (already) {
      const enr = enrollmentFor(db, student, matched, today);
      return {
        ok: true,
        studentId: student.id,
        sessionId: matched.id,
        cost: 0,
        remaining: enr ? Math.max(0, enr.remaining) : undefined,
        moduleName,
        groupName,
        otherGroup: !ownGroup,
        ownGroupName,
        sessionStart: sessionTimesOn(matched, dow).startTime,
        sessionEnd: sessionTimesOn(matched, dow).endTime,
        messageKey: "scan.alreadyPresent",
      };
    }

    // An enrollment that has run out of TIME is refused outright: unlike an
    // empty séance counter, there is nothing to regularise at the desk.
    const enrollment = enrollmentFor(db, student, matched, today);
    if (enrollment?.expiryDate && enrollment.expiryDate < today) {
      return {
        ok: false,
        studentId: student.id,
        sessionId: matched.id,
        moduleName,
        groupName,
        sessionStart: sessionTimesOn(matched, dow).startTime,
        sessionEnd: sessionTimesOn(matched, dow).endTime,
        messageKey: "scan.subscriptionExpired",
      };
    }

    // Net price: his OWN tariff (with his reduction) even on a sibling group.
    // It is no longer charged to anybody — it only sizes the teacher's share.
    const scannedSub = db.subscriptions.find((s) => s.sessionId === matched.id);
    const fallbackPrice = studentListPrice(student, scannedSub, 0);
    const price = enrollment?.price ?? fallbackPrice;

    const enrollmentStart = enrollment?.startDate;
    const beforeStart = !!enrollmentStart && enrollmentStart > today;

    const freePeriod = activeFreePeriod(
      db,
      [matched.classId, ...(matched.classIds ?? [])],
      today,
    );
    const isFreePeriod = !!freePeriod;

    // A free period and a not-yet-started enrollment are both "offered": the
    // presence is written and NO séance is taken off the counter.
    // Cet emploi du temps est-il offert à CET élève ? La gratuité se coche
    // module par module, donc la question n'a de sens qu'avec l'abonnement.
    const freeHere = isFreeSub(student, scannedSub?.id);
    const offered = isFreePeriod || beforeStart;
    const waived = offered && !freeHere ? price : 0;
    const cost = freeHere || offered ? 0 : price;

    const status: "present" | "late" =
      nowMin > startsAt(matched) + SCAN_LATE_AFTER ? "late" : "present";

    // The teacher taught the séance: an offered one still pays.
    const teacherBase =
      (isFreePeriod && (freePeriod?.payTeachers ?? true)) || beforeStart ? waived : cost;
    const teacherDue = teacherDueFor(db, matched, scannedSub, teacherBase, student);

    // Burn ONE séance and take its price off the SOLDE of that emploi — exactly
    // what the présence sheet does, so a badge and a click can never disagree.
    // A student whose solde is already empty is still let in: it simply goes
    // into the red and the desk regularises it.
    const consumes = !freeHere && !offered && !!enrollment?.enrollmentId;
    const before = enrollment?.remaining ?? 0;
    const outOfSeances = consumes && before <= 0;
    const remaining = consumes ? Math.max(0, before - 1) : Math.max(0, before);

    const record: AttendanceRecord = {
      id: uid("att"),
      studentId: student.id,
      sessionId: matched.id,
      timestamp: now.toISOString(),
      amountDeducted: cost,
      status,
      substituteGroup: !ownGroup,
      freePeriodId: isFreePeriod ? freePeriod!.id : undefined,
      waivedAmount: waived,
      preStart: beforeStart && !isFreePeriod,
    };

    set((state) => {
      const patch: Partial<DataStore> = {
        attendance: [...state.attendance, record],
      };
      if (consumes) {
        patch.enrollments = state.enrollments.map((e) =>
          e.id === enrollment!.enrollmentId
            ? {
                ...e,
                consumedSeances: e.consumedSeances + 1,
                balance: (e.balance ?? 0) - cost,
              }
            : e,
        );
      }
      if (matched.teacherId) {
        patch.unpaidTeacher = [
          ...state.unpaidTeacher,
          {
            id: uid("utp"),
            teacherId: matched.teacherId,
            sessionId: matched.id,
            studentId: student.id,
            amount: teacherDue,
            date: now.toISOString(),
            paid: false,
          },
        ];
      }
      return patch;
    });

    return {
      ok: true,
      studentId: student.id,
      sessionId: matched.id,
      cost,
      status,
      remaining,
      exhausted: consumes && before === 1,
      outOfSeances,
      moduleName,
      groupName,
      otherGroup: !ownGroup,
      ownGroupName,
      sessionStart: sessionTimesOn(matched, dow).startTime,
      sessionEnd: sessionTimesOn(matched, dow).endTime,
      free: isFreePeriod,
      freePeriodName: isFreePeriod ? freePeriod!.name || undefined : undefined,
      preStart: beforeStart && !isFreePeriod,
      enrollmentStart: beforeStart ? enrollmentStart : undefined,
      waived,
      messageKey: status === "late" ? "scan.successLate" : "scan.success",
    };
  },

  // Manual attendance sheet — exactly the same rules as the badge.
  markAttendance: async (studentId, sessionId, status, opts) => {
    const db = get();
    const student = db.students.find((s) => s.id === studentId);
    if (!student) return { ok: false, messageKey: "scan.notFound" };
    const session = db.sessions.find((s) => s.id === sessionId);
    if (!session) return { ok: false, messageKey: "attendance.sessionNotFound" };

    const date = opts?.date ?? dateKey(new Date());
    const [y, m, d] = date.split("-").map(Number);
    const day = JS_DAYS[new Date(y, m - 1, d).getDay()];
    if (!session.days.includes(day)) {
      return { ok: false, messageKey: "attendance.notScheduledThatDay" };
    }

    const moduleName = MODULE_NAME(db, session.moduleId);
    const groupName = GROUP_NAME(db, session.groupId);

    const existing = db.attendance.find(
      (a) => a.studentId === studentId && a.sessionId === sessionId && dateKey(a.timestamp) === date,
    );

    if (status === "absent") {
      if (!existing) {
        return { ok: true, messageKey: "attendance.alreadyAbsent", cost: 0, refunded: 0 };
      }
      // Marking someone absent gives the séance back — never money.
      const enrollment = enrollmentFor(db, student, session, date);
      const refundSeance =
        !existing.preStart &&
        !existing.freePeriodId &&
        !isFreeSub(student, db.subscriptions.find((x) => x.sessionId === sessionId)?.id) &&
        !!enrollment?.enrollmentId;
      set((state) => ({
        attendance: state.attendance.filter((a) => a.id !== existing.id),
        unpaidTeacher: state.unpaidTeacher.filter(
          (u) =>
            !(
              u.studentId === studentId &&
              u.sessionId === sessionId &&
              !u.paid &&
              dateKey(u.date) === date
            ),
        ),
        enrollments: refundSeance
          ? state.enrollments.map((e) =>
              e.id === enrollment!.enrollmentId
                ? {
                    ...e,
                    consumedSeances: Math.max(0, e.consumedSeances - 1),
                    balance: (e.balance ?? 0) + (existing.amountDeducted || 0),
                  }
                : e,
            )
          : state.enrollments,
      }));
      return {
        ok: true,
        messageKey: "attendance.markedAbsent",
        refunded: refundSeance ? 1 : 0,
        remaining: enrollment ? Math.max(0, enrollment.remaining + (refundSeance ? 1 : 0)) : undefined,
        moduleName,
      };
    }

    if (existing) {
      set((state) => ({
        attendance: state.attendance.map((a) => (a.id === existing.id ? { ...a, status } : a)),
      }));
      return { ok: true, messageKey: "attendance.statusUpdated", cost: 0, status };
    }

    const ownGroup = student.subscriptionIds.some(
      (id) => db.subscriptions.find((s) => s.id === id)?.sessionId === sessionId,
    );

    // A student can only be presented on his own group. Marking him on another
    // group of the same cours is refused (séances libres excepted).
    if (!ownGroup && !session.isOpen) {
      return { ok: false, messageKey: "scan.wrongGroup", moduleName };
    }

    const enrollment = enrollmentFor(db, student, session, date);
    // The emploi's own subscription: it is what carries the per-groupe teacher
    // share, so it is looked up whether or not the price falls back on it.
    const markedSub = db.subscriptions.find((s) => s.sessionId === sessionId);
    let price = enrollment?.price;
    let enrollmentStart = enrollment?.startDate;
    if (price === undefined) {
      if (!session.isOpen) return { ok: false, messageKey: "attendance.notEnrolled" };
      price = studentListPrice(student, markedSub, session.openPrice ?? 0);
      enrollmentStart = undefined;
    }

    if (enrollment?.expiryDate && enrollment.expiryDate < date) {
      return { ok: false, messageKey: "scan.subscriptionExpired", moduleName };
    }

    const beforeStart = !!enrollmentStart && enrollmentStart > date;
    const freePeriod = activeFreePeriod(db, [session.classId, ...(session.classIds ?? [])], date);
    const isFreePeriod = !!freePeriod;

    const freeHere = isFreeSub(student, markedSub?.id);
    const offered = isFreePeriod || beforeStart;
    const waived = offered && !freeHere ? price : 0;
    const cost = freeHere || offered ? 0 : price;

    const teacherBase =
      (isFreePeriod && (freePeriod?.payTeachers ?? true)) || beforeStart ? waived : cost;
    const teacherDue = opts?.skipTeacherDue
      ? 0
      : teacherDueFor(db, session, markedSub, teacherBase, student);

    const occurred =
      date === dateKey(new Date())
        ? new Date().toISOString()
        : new Date(`${date}T${startTimeOnDate(session, date)}:00`).toISOString();

    const consumes = !freeHere && !offered && !!enrollment?.enrollmentId;
    const before = enrollment?.remaining ?? 0;
    const outOfSeances = consumes && before <= 0;
    const remaining = consumes ? Math.max(0, before - 1) : Math.max(0, before);

    const record: AttendanceRecord = {
      id: uid("att"),
      studentId,
      sessionId,
      timestamp: occurred,
      amountDeducted: cost,
      status,
      substituteGroup: !ownGroup,
      freePeriodId: isFreePeriod ? freePeriod!.id : undefined,
      waivedAmount: waived,
      preStart: beforeStart && !isFreePeriod,
    };

    set((state) => {
      const patch: Partial<DataStore> = { attendance: [...state.attendance, record] };
      if (consumes) {
        patch.enrollments = state.enrollments.map((e) =>
          e.id === enrollment!.enrollmentId
            ? {
                ...e,
                consumedSeances: e.consumedSeances + 1,
                balance: (e.balance ?? 0) - cost,
              }
            : e,
        );
      }
      if (session.teacherId && !opts?.skipTeacherDue) {
        patch.unpaidTeacher = [
          ...state.unpaidTeacher,
          {
            id: uid("utp"),
            teacherId: session.teacherId,
            sessionId,
            studentId,
            amount: teacherDue,
            date: occurred,
            paid: false,
          },
        ];
      }
      return patch;
    });

    return {
      ok: true,
      studentId,
      sessionId,
      cost,
      status,
      remaining,
      exhausted: consumes && before === 1,
      outOfSeances,
      moduleName,
      groupName,
      otherGroup: !ownGroup,
      free: isFreePeriod,
      freePeriodName: isFreePeriod ? freePeriod!.name || undefined : undefined,
      preStart: beforeStart && !isFreePeriod,
      enrollmentStart: beforeStart ? enrollmentStart : undefined,
      waived,
      messageKey: status === "late" ? "scan.successLate" : "scan.success",
    };
  },

  /**
   * The présence sheet writes through here: ONE click, no confirmation, and
   * always reversible.
   *
   * The row of `{student, emploi, day}` is upserted, and the student's SOLDE on
   * that emploi moves by exactly the price of one séance:
   *  - `present` / `late` / `absent` -> the séance is burnt and its price is
   *    taken off the solde,
   *  - EXCEPT when the absence is the student's very first record on that
   *    emploi: his month has not opened yet, so it costs him nothing,
   *  - `cancelled` -> the séance did not happen: nothing burnt, nothing taken,
   *  - `null` -> the click was a mistake: the row goes and the money comes back.
   */
  setPresence: async ({ studentId, sessionId, date, status }) => {
    const db = get();
    const student = db.students.find((s) => s.id === studentId);
    if (!student) return { ok: false, messageKey: "scan.notFound" };
    const session = db.sessions.find((s) => s.id === sessionId);
    if (!session) return { ok: false, messageKey: "attendance.sessionNotFound" };

    const moduleName = MODULE_NAME(db, session.moduleId);
    const sub = db.subscriptions.find((x) => x.sessionId === sessionId);
    // A student enrolled on the emploi but who has never paid has no solde row
    // yet. He still has to be pointed — and his solde still has to go into the
    // red — so the row is opened here, empty, the first time he is marked.
    let enrollment = sub
      ? db.enrollments.find((e) => e.studentId === studentId && e.subscriptionId === sub.id)
      : undefined;
    if (!enrollment && sub && student.subscriptionIds.includes(sub.id)) {
      enrollment = {
        id: uid("enr"),
        studentId,
        subscriptionId: sub.id,
        paidSeances: 0,
        consumedSeances: 0,
        balance: 0,
        startDate: student.subscriptionDates?.[sub.id]?.startDate,
        monthSeances: cycleSizeOf(sub),
        createdAt: new Date().toISOString(),
      };
      const opened = enrollment;
      set((state) => ({ enrollments: [...state.enrollments, opened] }));
    }
    const discount =
      enrollment?.discount ?? (sub ? student.subscriptionDiscounts?.[sub.id] : undefined);
    // « École seule » : il ne paie que la part de l'école, jamais celle de
    // l'enseignant — que personne ne lui versera.
    const listPrice = studentListPrice(student, sub, session.openPrice ?? 0);

    const existing = db.attendance.find(
      (a) => a.studentId === studentId && a.sessionId === sessionId && dateKey(a.timestamp) === date,
    );

    // What the row already written for that day costs today — undoing it gives
    // exactly that back.
    const undoBillable = !!existing && existing.status !== "cancelled" && !existing.noCharge;
    const undoCharge = undoBillable ? existing!.amountDeducted || 0 : 0;
    const balanceBefore = enrollment?.balance ?? 0;

    const dropDayRows = (rows: UnpaidTeacherSession[]) =>
      rows.filter(
        (u) =>
          !(
            u.studentId === studentId &&
            u.sessionId === sessionId &&
            !u.paid &&
            dateKey(u.date) === date
          ),
      );

    if (status === null) {
      if (!existing) {
        return {
          ok: true,
          messageKey: "attendance.nothingToUndo",
          status: null,
          balance: balanceBefore,
          moduleName,
        };
      }
      set((state) => ({
        attendance: state.attendance.filter((a) => a.id !== existing.id),
        unpaidTeacher: dropDayRows(state.unpaidTeacher),
        enrollments: enrollment
          ? state.enrollments.map((e) =>
              e.id === enrollment.id
                ? {
                    ...e,
                    consumedSeances: Math.max(0, e.consumedSeances - (undoBillable ? 1 : 0)),
                    balance: (e.balance ?? 0) + undoCharge,
                  }
                : e,
            )
          : state.enrollments,
      }));
      return {
        ok: true,
        messageKey: "attendance.undone",
        status: null,
        refunded: undoCharge,
        balance: balanceBefore + undoCharge,
        moduleName,
      };
    }

    // A student may only be marked on HIS own group (séances libres excepted).
    const ownGroup = !!sub && student.subscriptionIds.includes(sub.id);
    if (!ownGroup && !session.isOpen) {
      return { ok: false, messageKey: "scan.wrongGroup", moduleName };
    }

    // "First séance ever and he is not there": the month has not opened, so the
    // absence is recorded but never billed.
    const hasEarlierBillable = db.attendance.some(
      (a) =>
        a.studentId === studentId &&
        a.sessionId === sessionId &&
        a.id !== existing?.id &&
        a.status !== "cancelled" &&
        !a.noCharge &&
        dateKey(a.timestamp) < date,
    );
    const firstAbsence = status === "absent" && !hasEarlierBillable;

    const freePeriod = activeFreePeriod(db, [session.classId, ...(session.classIds ?? [])], date);
    const startDate = enrollment?.startDate ?? student.subscriptionDates?.[sub?.id ?? ""]?.startDate;
    const beforeStart = !!startDate && startDate > date;

    const noCharge = status === "cancelled" || firstAbsence;
    const offered = !noCharge && (!!freePeriod || beforeStart || isFreeSub(student, sub?.id));
    const netPrice = netPriceFor(listPrice, discount);
    const charge = noCharge || offered ? 0 : netPrice;
    const waived = offered ? netPrice : 0;

    const occurred =
      date === dateKey(new Date())
        ? new Date().toISOString()
        : new Date(`${date}T${startTimeOnDate(session, date)}:00`).toISOString();

    const record: AttendanceRecord = {
      id: existing?.id ?? uid("att"),
      studentId,
      sessionId,
      timestamp: existing?.timestamp ?? occurred,
      amountDeducted: charge,
      status,
      substituteGroup: !ownGroup,
      freePeriodId: freePeriod && !noCharge ? freePeriod.id : undefined,
      waivedAmount: waived,
      preStart: beforeStart && !freePeriod && !noCharge,
      noCharge: noCharge || undefined,
    };

    // The teacher earns on the séances that happened; an annulée pays nobody.
    const teacherBase = noCharge ? 0 : charge || waived;
    const teacherDue = teacherDueFor(db, session, sub, teacherBase, student);
    const billable = !noCharge;

    set((state) => {
      const patch: Partial<DataStore> = {
        attendance: existing
          ? state.attendance.map((a) => (a.id === record.id ? record : a))
          : [...state.attendance, record],
        unpaidTeacher: dropDayRows(state.unpaidTeacher),
      };
      if (enrollment) {
        patch.enrollments = state.enrollments.map((e) =>
          e.id === enrollment.id
            ? {
                ...e,
                consumedSeances: Math.max(
                  0,
                  e.consumedSeances - (undoBillable ? 1 : 0) + (billable ? 1 : 0),
                ),
                balance: (e.balance ?? 0) + undoCharge - charge,
              }
            : e,
        );
      }
      if (session.teacherId && billable && teacherDue > 0) {
        patch.unpaidTeacher = [
          ...(patch.unpaidTeacher as UnpaidTeacherSession[]),
          {
            id: uid("utp"),
            teacherId: session.teacherId,
            sessionId,
            studentId,
            amount: teacherDue,
            date: record.timestamp,
            paid: false,
          },
        ];
      }
      return patch;
    });

    return {
      ok: true,
      messageKey: "attendance.saved",
      status,
      charged: charge,
      refunded: undoCharge,
      balance: balanceBefore + undoCharge - charge,
      noCharge,
      moduleName,
    };
  },

  /**
   * Recharges the SOLDE of one emploi du temps. The money is booked on ONE of
   * that emploi's own months — by default the month the student is walking
   * through right now on it.
   */
  addSold: async ({ studentId, subscriptionId, amount, monthCode, description, source }) => {
    const db = get();
    const student = db.students.find((s) => s.id === studentId);
    const sub = db.subscriptions.find((s) => s.id === subscriptionId);
    if (!student || !sub) return { ok: false };

    const credit = Math.max(0, Math.round(amount || 0));
    if (credit <= 0) return { ok: false };

    const code = monthCode || currentCycleCode(db, studentId, subscriptionId);
    const now = new Date().toISOString();
    const today = dateKey(new Date());
    const existing = db.enrollments.find(
      (e) => e.studentId === studentId && e.subscriptionId === subscriptionId,
    );
    const enrollmentId = existing?.id ?? uid("enr");
    const packSeances = cycleSizeOf(sub);
    const unit = Math.max(1, netPriceFor(studentListPrice(student, sub), existing?.discount));

    const enrollment: Enrollment = existing
      ? { ...existing, balance: (existing.balance ?? 0) + credit }
      : {
          id: enrollmentId,
          studentId,
          subscriptionId,
          paidSeances: 0,
          consumedSeances: 0,
          balance: credit,
          startDate: student.subscriptionDates?.[subscriptionId]?.startDate ?? today,
          plan: student.subscriptionDates?.[subscriptionId]?.plan,
          monthSeances: packSeances,
          createdAt: now,
        };
    // The séance counter follows the money, so the old screens keep reading a
    // coherent "séances restantes".
    enrollment.paidSeances =
      enrollment.consumedSeances + Math.max(0, Math.floor((enrollment.balance ?? 0) / unit));

    const payment: Payment = {
      id: uid("pay"),
      studentId,
      enrollmentId,
      subscriptionId,
      monthCode: code,
      seancesPurchased: Math.round(credit / unit),
      unitPrice: unit,
      grossTotal: credit,
      netTotal: credit,
      amountPaid: credit,
      rest: 0,
      type: "subscription_payment",
      paidFrom: source ?? "cash",
      date: now,
      description:
        description?.trim() ||
        `Solde ${code} — ${MODULE_NAME(db, sub ? db.sessions.find((x) => x.id === sub.sessionId)?.moduleId ?? "" : "")}`,
    };

    /**
     * Ce que la caisse enregistre :
     *  - un versement de la famille : une entrée, comme toujours ;
     *  - un règlement sur le salaire du père : RIEN, l'argent n'a jamais
     *    traversé le tiroir (l'enseignant touche simplement moins) ;
     *  - une scolarité PORTÉE sur le salaire du père : rien non plus, et pour
     *    la même raison — l'école sera payée le jour de la paie, en versant
     *    moins ; la retenue en attente vit dans `teacherChildDebts` ;
     *  - une dette couverte par l'école : l'entrée portée au crédit de l'élève
     *    ET la sortie qui l'a financée. Les deux s'annulent, si bien que le
     *    solde de la caisse ne bouge que du jour où l'enseignant est payé —
     *    et l'historique montre noir sur blanc que l'école a avancé l'argent.
     */
    const studentLabel = `${student.firstName} ${student.lastName}`.trim();
    const cashRows: CashTransaction[] =
      source === "teacher_salary" || source === "teacher_debt"
        ? []
        : [
            {
              id: uid("csh"),
              type: "student_payment" as const,
              amount: credit,
              date: now,
              description:
                source === "school_cash"
                  ? `Dette ${code} de ${studentLabel} réglée par l'école`
                  : `Solde ${code} — ${studentLabel}`,
            },
            ...(source === "school_cash"
              ? [
                  {
                    id: uid("csh"),
                    type: "student_debt" as const,
                    amount: -credit,
                    date: now,
                    description: `Caisse école → dette ${code} de ${studentLabel} (${
                      description?.trim() || "part enseignant débloquée"
                    })`,
                  },
                ]
              : []),
          ];

    set((state) => ({
      enrollments: existing
        ? state.enrollments.map((e) => (e.id === enrollmentId ? enrollment : e))
        : [...state.enrollments, enrollment],
      payments: [...state.payments, payment],
      students: state.students.map((st) =>
        st.id === studentId
          ? {
              ...st,
              subscriptionIds: st.subscriptionIds.includes(subscriptionId)
                ? st.subscriptionIds
                : [...st.subscriptionIds, subscriptionId],
              subscriptionDates: {
                ...st.subscriptionDates,
                [subscriptionId]: {
                  ...st.subscriptionDates?.[subscriptionId],
                  subscribedAt: st.subscriptionDates?.[subscriptionId]?.subscribedAt ?? today,
                  startDate: st.subscriptionDates?.[subscriptionId]?.startDate ?? today,
                },
              },
            }
          : st,
      ),
      cash: cashRows.length > 0 ? [...state.cash, ...cashRows] : state.cash,
    }));

    return { ok: true, paymentId: payment.id, balance: enrollment.balance, monthCode: code };
  },

  /**
   * L'école avance ce qu'un élève doit, pour que l'enseignant soit payé
   * aujourd'hui. Voir la description de l'action sur l'interface : tout ce qui
   * retient la part de l'enseignant est couvert — les mois dans le rouge, les
   * restes d'anciens paiements et les frais d'inscription.
   */
  coverStudentDebt: async ({
    studentId,
    subscriptionId,
    monthCode,
    lines,
    otherAmount,
    description,
  }) => {
    const db = get();
    const student = db.students.find((s) => s.id === studentId);
    if (!student) return { ok: false, messageKey: "student.notFound" };

    const summary = studentDebtSummary(db, studentId);
    /**
     * Deux façons de décider ce que l'école avance :
     *
     *  - la réception a coché les mois et corrigé les montants (`lines`) : on
     *    règle EXACTEMENT ce qu'elle a saisi, jamais plus que ce qui est dû sur
     *    le mois — un montant partiel laisse le reste à la charge de la famille ;
     *  - rien n'a été précisé : l'école avance tout ce qui retient la part de
     *    l'enseignant, comme le bouton le promet depuis toujours.
     */
    const picked = (lines ?? []).filter((l) => Math.round(l.amount || 0) > 0);
    const explicit = picked.length > 0 || (otherAmount ?? 0) > 0;

    const rows = explicit
      ? picked.map((l) => {
          const known = summary.soldRows.find(
            (r) => r.subscriptionId === l.subscriptionId && r.code === l.monthCode,
          );
          return {
            subscriptionId: l.subscriptionId,
            sessionId: known?.sessionId ?? "",
            label: l.label ?? known?.label ?? "Emploi du temps",
            code: l.monthCode,
            // Avancer plus que ce que le mois doit créerait une avance sur le
            // solde payée par l'école : on plafonne au dû.
            debt: known ? Math.min(Math.round(l.amount), known.debt) : Math.round(l.amount),
          };
        }).filter((r) => r.debt > 0)
      : summary.soldRows.filter(
          (r) =>
            (!subscriptionId || r.subscriptionId === subscriptionId) &&
            (!monthCode || r.code === monthCode),
        );
    // Restreindre à un emploi du temps ne touche QUE ses mois : les restes et
    // les frais d'inscription ne relèvent d'aucun emploi en particulier, ils ne
    // sont donc soldés que quand toute la dette est couverte.
    const whole = !subscriptionId && !monthCode;
    const otherDue = summary.rests + summary.registrationDue;
    const otherPaid = explicit
      ? Math.min(Math.max(0, Math.round(otherAmount ?? 0)), otherDue)
      : whole
        ? otherDue
        : 0;
    // Les restes s'éteignent avant les frais d'inscription : c'est la plus
    // ancienne dette, et c'est celle qui bloque la part de l'enseignant.
    const rests = Math.min(summary.rests, otherPaid);
    const registration = otherPaid - rests;

    const total = rows.reduce((t, r) => t + r.debt, 0) + rests + registration;
    if (total <= 0) return { ok: false, amount: 0, rows: 0, messageKey: "debt.nothingDue" };

    const label = description?.trim() || "Dette avancée par l'école";

    // Mois par mois : chaque versement porte sa provenance et pose ses deux
    // mouvements de caisse, donc l'historique reste lisible ligne par ligne.
    for (const row of rows) {
      await get().addSold({
        studentId,
        subscriptionId: row.subscriptionId,
        amount: row.debt,
        monthCode: row.code,
        source: "school_cash",
        description: `${label} — ${row.label} (${row.code})`,
      });
    }

    // Les restes d'anciens paiements et les frais d'inscription se soldent en
    // une seule écriture : ils ne portent ni emploi du temps ni mois.
    if (rests > 0 || registration > 0) {
      const now = new Date().toISOString();
      const settled = rests + registration;
      // Du plus ancien au plus récent, jusqu'à épuisement de ce que l'école a
      // décidé d'avancer : un règlement partiel laisse les restes suivants dus.
      let left = rests;
      const cleared = new Map<string, number>();
      for (const p of db.payments
        .filter((p) => p.studentId === studentId && p.rest > 0)
        .sort((a, b) => a.date.localeCompare(b.date))) {
        if (left <= 0) break;
        const cut = Math.min(p.rest, left);
        cleared.set(p.id, p.rest - cut);
        left -= cut;
      }
      const studentLabel = `${student.firstName} ${student.lastName}`.trim();
      const receipt: Payment = {
        id: uid("pay"),
        studentId,
        seancesPurchased: 0,
        unitPrice: 0,
        grossTotal: settled,
        netTotal: settled,
        amountPaid: settled,
        rest: 0,
        type: "debt_payment",
        paidFrom: "school_cash",
        date: now,
        description:
          registration > 0
            ? `${label} — restes et frais d'inscription`
            : `${label} — restes d'anciens paiements`,
      };
      set((state) => ({
        payments: [
          ...state.payments.map((p) =>
            cleared.has(p.id) ? { ...p, rest: cleared.get(p.id)! } : p,
          ),
          receipt,
        ],
        students: state.students.map((st) =>
          st.id === studentId && registration > 0
            ? { ...st, registrationDue: Math.max(0, (st.registrationDue ?? 0) - registration) }
            : st,
        ),
        cash: [
          ...state.cash,
          {
            id: uid("csh"),
            type: "student_payment" as const,
            amount: settled,
            date: now,
            description: `Dette de ${studentLabel} réglée par l'école`,
          },
          {
            id: uid("csh"),
            type: "student_debt" as const,
            amount: -settled,
            date: now,
            description: `Caisse école → dette de ${studentLabel} (${label})`,
          },
        ],
      }));
    }

    return { ok: true, amount: total, rows: rows.length + (rests + registration > 0 ? 1 : 0) };
  },

  /**
   * La scolarité d'un fils d'enseignant, réglée depuis la feuille de présence
   * du groupe. Voir la description de l'action : soit la famille paie au
   * guichet (l'argent entre en caisse, rien n'est retenu au père), soit le
   * montant est PORTÉ sur le salaire du père — l'enfant est soldé tout de
   * suite, et la retenue attend la prochaine paie.
   */
  payTeacherChild: async ({ studentId, subscriptionId, monthCode, amount, source, description }) => {
    const db = get();
    const student = db.students.find((s) => s.id === studentId);
    if (!student) return { ok: false, messageKey: "student.notFound" };

    const due = Math.max(0, Math.round(amount || 0));
    if (due <= 0) return { ok: false, messageKey: "debt.nothingDue" };

    // Porter la somme sur un père suppose qu'il y en ait un : sans enseignant
    // père désigné, la retenue n'aurait personne à qui être présentée.
    const teacherId = student.teacherFatherId;
    if (source === "teacher_debt" && !teacherId) {
      return { ok: false, messageKey: "student.noTeacherFather" };
    }

    const sub = db.subscriptions.find((x) => x.id === subscriptionId);
    const ses = sub && db.sessions.find((x) => x.id === sub.sessionId);
    const label =
      (ses && (ses.title || MODULE_NAME(db, ses.moduleId))) || "Emploi du temps";
    const note =
      description?.trim() ||
      (source === "cash"
        ? `Versé par la famille au guichet (${monthCode})`
        : `Scolarité portée sur le salaire du père (${monthCode})`);

    const res = await get().addSold({
      studentId,
      subscriptionId,
      amount: due,
      monthCode,
      source,
      description: `${note} — ${label}`,
    });
    if (!res.ok) return { ok: false, messageKey: "payment.failed" };

    if (source === "cash" || !teacherId) {
      return { ok: true, paymentId: res.paymentId, balance: res.balance };
    }

    // La retenue en attente : le prochain règlement du père la lit, la déduit
    // de son net et la marque payée — donc jamais deux fois.
    const debt: TeacherChildDebt = {
      id: uid("tcd"),
      teacherId,
      studentId,
      subscriptionId,
      monthCode,
      label: `${student.firstName} ${student.lastName}`.trim() || "Enfant",
      amount: due,
      date: dateKey(new Date()),
      paid: false,
      createdAt: new Date().toISOString(),
    };
    set((state) => ({ teacherChildDebts: [...state.teacherChildDebts, debt] }));

    return { ok: true, paymentId: res.paymentId, debtId: debt.id, balance: res.balance };
  },

  /**
   * Supprimer un emploi du temps, c'est l'ARCHIVER : voir la description de
   * l'action. Rien n'est effacé — ni les présences, ni les soldes, ni les
   * paiements, ni les parts dues à l'enseignant — et l'historique continue donc
   * de les nommer correctement.
   */
  archiveSession: async (sessionId) => {
    const db = get();
    const session = db.sessions.find((s) => s.id === sessionId);
    if (!session) return { ok: false };

    const today = dateKey(new Date());
    const subIds = db.subscriptions
      .filter((sub) => sub.sessionId === sessionId)
      .map((sub) => sub.id);

    // Les élèves en sortent comme d'une désinscription ordinaire : leur fiche
    // garde le module, ses présences, ses paiements et son solde, datés du jour.
    let moved = 0;
    for (const subId of subIds) {
      for (const st of db.students.filter((x) => x.subscriptionIds.includes(subId))) {
        await get().unsubscribeStudent(st.id, subId);
        moved += 1;
      }
    }

    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === sessionId ? { ...s, archivedAt: today } : s,
      ),
      subscriptions: state.subscriptions.map((sub) =>
        sub.sessionId === sessionId ? { ...sub, archivedAt: today } : sub,
      ),
    }));

    return { ok: true, students: moved, subscriptions: subIds.length };
  },

  // Cancelling a presence gives the séance back — the mirror of consuming it.
  cancelAttendance: async (attendanceId) => {
    const db = get();
    const att = db.attendance.find((a) => a.id === attendanceId);
    if (!att) return { ok: false, messageKey: "attendance.notFound" };

    const date = dateKey(att.timestamp);
    const student = db.students.find((s) => s.id === att.studentId);
    const session = db.sessions.find((s) => s.id === att.sessionId);
    const enrollment =
      student && session ? enrollmentFor(db, student, session, date) : undefined;
    const refundSeance =
      !att.preStart &&
      !att.freePeriodId &&
      !isFreeSub(student, db.subscriptions.find((x) => x.sessionId === att.sessionId)?.id) &&
      !!enrollment?.enrollmentId;

    set((state) => ({
      attendance: state.attendance.filter((a) => a.id !== attendanceId),
      unpaidTeacher: state.unpaidTeacher.filter(
        (u) =>
          !(
            u.studentId === att.studentId &&
            u.sessionId === att.sessionId &&
            !u.paid &&
            dateKey(u.date) === date
          ),
      ),
      enrollments: refundSeance
        ? state.enrollments.map((e) =>
            e.id === enrollment!.enrollmentId
              ? {
                  ...e,
                  consumedSeances: Math.max(0, e.consumedSeances - 1),
                  balance: (e.balance ?? 0) + (att.amountDeducted || 0),
                }
              : e,
          )
        : state.enrollments,
    }));

    return {
      ok: true,
      refunded: refundSeance ? 1 : 0,
      remaining: enrollment
        ? Math.max(0, enrollment.remaining + (refundSeance ? 1 : 0))
        : undefined,
      moduleName: session ? MODULE_NAME(db, session.moduleId) : undefined,
      messageKey: "attendance.cancelled",
    };
  },

  updateAttendance: async (attendanceId, fields) => {
    const db = get();
    const att = db.attendance.find((a) => a.id === attendanceId);
    if (!att) return { ok: false, messageKey: "attendance.notFound" };
    const session = db.sessions.find((s) => s.id === att.sessionId);

    const status = fields.status ?? att.status;
    const occurred = fields.occurredAt ?? att.timestamp;
    // The amount no longer moves money: it is the séance price the teacher's
    // share is computed from, so correcting it only re-sizes that share.
    const amount = Math.max(fields.amount ?? att.amountDeducted, 0);
    const oldDate = dateKey(att.timestamp);
    const newDate = dateKey(occurred);

    // One presence per student / timing / day.
    const clash = db.attendance.find(
      (a) =>
        a.id !== attendanceId &&
        a.studentId === att.studentId &&
        a.sessionId === att.sessionId &&
        dateKey(a.timestamp) === newDate,
    );
    if (clash) return { ok: false, messageKey: "attendance.duplicateDay" };

    set((state) => ({
      attendance: state.attendance.map((a) =>
        a.id === attendanceId
          ? { ...a, status, timestamp: occurred, amountDeducted: amount }
          : a,
      ),
      // The teacher share follows the new amount.
      unpaidTeacher: state.unpaidTeacher.map((u) => {
        if (
          u.studentId !== att.studentId ||
          u.sessionId !== att.sessionId ||
          u.paid ||
          dateKey(u.date) !== oldDate
        ) {
          return u;
        }
        const teacher = state.teachers.find((t) => t.id === u.teacherId);
        if (!teacher || teacher.paymentType !== "percentage") return u;
        return {
          ...u,
          amount: Math.round((amount * (teacher.percentage ?? 0)) / 100),
          date: occurred,
        };
      }),
    }));

    return {
      ok: true,
      cost: amount,
      status,
      messageKey: "attendance.updated",
    };
  },

  // Removing a weekly-absence charge gives its séance back.
  deleteAbsencePenalty: async (penaltyId) => {
    const db = get();
    const pen = db.absencePenalties.find((p) => p.id === penaltyId);
    if (!pen) return { ok: false, messageKey: "absence.notFound" };

    const enrollment = db.enrollments.find(
      (e) => e.studentId === pen.studentId && e.subscriptionId === pen.subscriptionId,
    );

    set((state) => ({
      absencePenalties: state.absencePenalties.filter((p) => p.id !== penaltyId),
      enrollments: enrollment
        ? state.enrollments.map((e) =>
            e.id === enrollment.id
              ? { ...e, consumedSeances: Math.max(0, e.consumedSeances - 1) }
              : e,
          )
        : state.enrollments,
    }));

    return {
      ok: true,
      refunded: enrollment ? 1 : 0,
      remaining: enrollment
        ? enrollment.paidSeances - enrollment.consumedSeances + 1
        : undefined,
      messageKey: "absence.deleted",
    };
  },

  // One tariff per COURSE, not per group: every sibling timing gets the same
  // price so two groups of the same cours can never drift apart.
  setSubscriptionPrice: async (sessionId, price, opts) => {
    const db = get();
    const session = db.sessions.find((s) => s.id === sessionId);
    if (!session) return { ok: false };

    const ids = siblingIds(db, sessionId);
    const clean = Math.max(Math.round(price || 0), 0);
    const { levelPrice, periodMonths } = opts ?? {};
    // A monthly formula only exists once it holds séances; without them the
    // whole offer is dropped, so an old one never survives its removal.
    const monthlySeances = Math.max(0, Math.round(opts?.monthlySeances ?? 0)) || undefined;
    const monthlyPrice = monthlySeances
      ? Math.max(0, Math.round(opts?.monthlyPrice ?? monthlySeances * clean))
      : undefined;
    // The school/teacher split only means something on a monthly formula.
    const schoolMonthShare =
      monthlySeances && opts?.schoolMonthShare != null
        ? Math.min(Math.max(0, Math.round(opts.schoolMonthShare)), monthlyPrice ?? 0)
        : undefined;
    const teacherPerSeance =
      monthlySeances && opts?.teacherPerSeance != null
        ? Math.max(0, Math.round(opts.teacherPerSeance))
        : undefined;
    let created = 0;
    let updated = 0;
    const additions: Subscription[] = [];

    for (const id of ids) {
      if (db.subscriptions.some((s) => s.sessionId === id)) updated += 1;
      else {
        created += 1;
        additions.push({
          id: uid("sub"),
          sessionId: id,
          pricePerSession: clean,
          levelPrice,
          periodMonths,
          monthlySeances,
          monthlyPrice,
          schoolMonthShare,
          teacherPerSeance,
        });
      }
    }

    set((state) => ({
      subscriptions: [
        ...state.subscriptions.map((s) =>
          ids.includes(s.sessionId)
            ? {
                ...s,
                // Redéfinir le tarif d'un cours archivé le remet en service.
                archivedAt: undefined,
                pricePerSession: clean,
                levelPrice,
                periodMonths,
                monthlySeances,
                monthlyPrice,
                schoolMonthShare,
                teacherPerSeance,
              }
            : s,
        ),
        ...additions,
      ],
      sessions: session.isOpen
        ? state.sessions.map((s) => (s.id === sessionId ? { ...s, openPrice: clean } : s))
        : state.sessions,
    }));

    return { ok: true, created, updated, groups: created + updated };
  },

  deleteSubscriptionPrice: async (sessionId) => {
    const db = get();
    const ids = siblingIds(db, sessionId);
    const doomed = db.subscriptions.filter((s) => ids.includes(s.sessionId) && !s.archivedAt);
    const doomedIds = new Set(doomed.map((s) => s.id));
    if (doomedIds.size === 0) return { ok: true, deleted: 0 };

    const today = dateKey(new Date());
    // Les élèves en sortent comme d'une désinscription : leur fiche garde le
    // module, ses présences, ses paiements et son solde, datés du jour.
    for (const subId of doomedIds) {
      for (const st of db.students.filter((x) => x.subscriptionIds.includes(subId))) {
        await get().unsubscribeStudent(st.id, subId);
      }
    }

    set((state) => ({
      // Le tarif est archivé, jamais effacé : l'effacer emporterait les
      // inscriptions — donc les soldes — et laisserait les paiements encaissés
      // dessus sans nom sur les écrans d'historique.
      subscriptions: state.subscriptions.map((s) =>
        doomedIds.has(s.id) ? { ...s, archivedAt: today } : s,
      ),
    }));

    return { ok: true, deleted: doomed.length };
  },

  fetchFreePeriodStats: async () => {
    const db = get();
    return db.freePeriods.map((fp) => {
      const rows = db.attendance.filter((a) => a.freePeriodId === fp.id);
      return {
        id: fp.id,
        presences: rows.length,
        students: new Set(rows.map((a) => a.studentId)).size,
        waived: rows.reduce((s, a) => s + (a.waivedAmount ?? 0), 0),
      };
    });
  },

  // Automatic weekly-absence billing: one charge per module the student did not
  // attend for a whole window. It costs ONE SÉANCE — the same currency a
  // presence costs — never money. Idempotent (a written penalty anchors the
  // next window) and throttled to once per day.
  processWeeklyAbsences: async () => {
    const db = get();
    const today = dateKey(new Date());
    if (!(db.school.absencePenaltyEnabled ?? true)) {
      return { ok: true, charged: 0, students: 0 };
    }
    if (lastAbsenceRun && lastAbsenceRun >= today) {
      return { ok: true, charged: 0, students: 0 };
    }
    lastAbsenceRun = today;

    const floor = db.school.absencePenaltySince ?? today;
    const startDow = db.school.absenceWeekStartDay ?? 5;
    const MAX_WINDOWS = 8;

    const penalties: AbsencePenalty[] = [];
    /** séances burnt per enrollment id, so several windows in a row stack up */
    const burnt = new Map<string, number>();
    const touched = new Set<string>();

    for (const student of db.students) {
      for (const enr of enrollmentsOf(db, student)) {
        const sub = db.subscriptions.find((s) => s.id === enr.subscriptionId);
        if (!sub || (sub.pricePerSession ?? 0) <= 0) continue;
        // Nothing to take from a student without a séance-counted inscription.
        if (!enr.enrollmentId) continue;
        // An inscription that ran out of TIME is closed: what was left on it is
        // already lost, so no absence can be billed on it any more.
        if (enr.expiryDate && enr.expiryDate < today) continue;

        const rule = db.moduleAbsenceRules.find((r) => r.moduleId === enr.session.moduleId);
        if (rule && !rule.enabled) continue;
        const windowDays = Math.max(rule?.daysWindow ?? 7, 1);
        const aligned = windowDays === 7;

        const cost = isFreeSub(student, enr.subscriptionId) ? 0 : enr.price;
        if (cost <= 0) continue;

        const attended = db.attendance.filter((a) => {
          const se = db.sessions.find((s) => s.id === a.sessionId);
          return (
            a.studentId === student.id &&
            se?.moduleId === enr.session.moduleId &&
            se?.classId === enr.session.classId &&
            (a.status === "present" || a.status === "late")
          );
        });
        const lastAtt = attended.map((a) => dateKey(a.timestamp)).sort().slice(-1)[0];
        const lastPen = db.absencePenalties
          .filter(
            (p) => p.studentId === student.id && p.subscriptionId === enr.subscriptionId,
          )
          .map((p) => p.periodEnd)
          .sort()
          .slice(-1)[0];

        let anchor: string;
        if (aligned) {
          anchor = weekAnchor(maxKey(floor, enr.startDate, floor), startDow);
          if (lastPen) {
            let penAnchor = weekAnchor(lastPen, startDow);
            if (penAnchor < lastPen) penAnchor = addDays(penAnchor, windowDays);
            anchor = maxKey(anchor, penAnchor);
          }
          anchor = maxKey(anchor, addDays(weekAnchor(today, startDow), -MAX_WINDOWS * windowDays));
        } else {
          anchor = maxKey(floor, enr.startDate, lastAtt, lastPen);
        }

        for (let i = 0; i <= MAX_WINDOWS; i += 1) {
          let periodStart: string;
          let periodEnd: string;
          if (aligned) {
            periodStart = anchor;
            periodEnd = addDays(anchor, windowDays);
            if (periodEnd > today) break;
          } else {
            periodStart = addDays(anchor, 1);
            periodEnd = addDays(anchor, windowDays);
            if (diffDays(anchor, today) < windowDays) break;
          }

          const startFloor = maxKey(floor, enr.startDate);
          if (periodEnd <= startFloor) {
            anchor = addDays(anchor, windowDays);
            continue;
          }

          if (
            enr.session.isOpen &&
            ((enr.session.periodEnd && enr.session.periodEnd < periodStart) ||
              (enr.session.periodStart && enr.session.periodStart > periodEnd))
          ) {
            anchor = addDays(anchor, windowDays);
            continue;
          }

          const offered = db.freePeriods.some(
            (fp) =>
              fp.active &&
              (fp.allClasses || fp.classIds.includes(enr.session.classId)) &&
              fp.startDate < periodEnd &&
              fp.endDate >= periodStart,
          );
          if (offered) {
            anchor = addDays(anchor, windowDays);
            continue;
          }

          const present = attended.some((a) => {
            const k = dateKey(a.timestamp);
            return k >= periodStart && k < periodEnd;
          });
          if (present) {
            anchor = addDays(anchor, windowDays);
            continue;
          }

          const already = burnt.get(enr.enrollmentId) ?? 0;
          burnt.set(enr.enrollmentId, already + 1);

          penalties.push({
            id: uid("pen"),
            studentId: student.id,
            subscriptionId: enr.subscriptionId,
            sessionId: enr.sessionId,
            moduleId: enr.session.moduleId,
            periodStart,
            periodEnd,
            amount: cost,
            remainingAfter: Math.max(0, enr.remaining - already - 1),
            createdAt: new Date().toISOString(),
          });
          touched.add(student.id);
          anchor = addDays(anchor, windowDays);
        }
      }
    }

    if (penalties.length === 0) return { ok: true, charged: 0, students: 0 };

    set((state) => ({
      absencePenalties: [...state.absencePenalties, ...penalties],
      enrollments: state.enrollments.map((e) =>
        burnt.has(e.id) ? { ...e, consumedSeances: e.consumedSeances + burnt.get(e.id)! } : e,
      ),
    }));

    return { ok: true, charged: penalties.length, students: touched.size };
  },

  settleTeacherPercentage: async (teacherId) => {
    const db = get();
    const teacher = db.teachers.find((t) => t.id === teacherId);
    if (!teacher) return { ok: false, messageKey: "pay.teacherNotFound" };

    // Dues of students who still owe money are withheld: the teacher is only
    // settled for students who have paid.
    const unpaid = db.unpaidTeacher.filter(
      (u) => u.teacherId === teacherId && !u.paid && !studentHasDebt(db, u.studentId),
    );
    const gross = unpaid.reduce((s, u) => s + u.amount, 0);
    const acomptes = db.acomptes
      .filter((a) => a.teacherId === teacherId)
      .reduce((s, a) => s + a.amount, 0);
    const absences = db.absences
      .filter((a) => a.teacherId === teacherId)
      .reduce((s, a) => s + a.cost, 0);
    const net = gross - acomptes - absences;

    if (net <= 0) {
      return { ok: false, messageKey: "pay.nothingDue", gross, acomptes, absences, net };
    }

    const settledIds = new Set(unpaid.map((u) => u.id));
    set((state) => ({
      unpaidTeacher: state.unpaidTeacher.map((u) =>
        settledIds.has(u.id) ? { ...u, paid: true } : u,
      ),
      acomptes: state.acomptes.filter((a) => a.teacherId !== teacherId),
      absences: state.absences.filter((a) => a.teacherId !== teacherId),
      cash: [
        ...state.cash,
        {
          id: uid("csh"),
          type: "teacher_payment",
          amount: -net,
          date: new Date().toISOString(),
          description:
            `Règlement salaire au pourcentage - ${teacher.firstName} ${teacher.lastName}` +
            ` (${unpaid.length} présences, brut ${gross} DA, acomptes -${acomptes} DA, absences -${absences} DA)`,
        },
      ],
    }));

    return { ok: true, net, gross, sessions: unpaid.length, acomptes, absences };
  },

  // ---- Workers: badge + hourly settlement -----------------------------------
  scanWorkerCard: async (code) => {
    const db = get();
    const trimmed = code.trim();
    const worker = db.reception.find((w) => !!w.rfid && w.rfid === trimmed);
    if (!worker) return { ok: false, messageKey: "worker.notFound" };

    const now = new Date();
    const date = dateKey(now);
    const name = `${worker.firstName} ${worker.lastName}`;
    const shift = db.workerShifts.find((s) => s.workerId === worker.id && s.workDate === date);

    if (!shift) {
      const created: WorkerShift = {
        id: uid("wsh"),
        workerId: worker.id,
        workDate: date,
        startAt: now.toISOString(),
        minutes: 0,
        frozen: false,
        paid: false,
        createdAt: now.toISOString(),
      };
      set((state) => ({ workerShifts: [...state.workerShifts, created] }));
      return {
        ok: true,
        messageKey: "worker.clockIn",
        workerId: worker.id,
        workerName: name,
        date,
        startAt: created.startAt,
      };
    }

    if (shift.frozen) {
      return { ok: false, messageKey: "worker.frozen", workerId: worker.id, workerName: name, date };
    }

    if (!shift.startAt) {
      set((state) => ({
        workerShifts: state.workerShifts.map((s) =>
          s.id === shift.id ? { ...s, startAt: now.toISOString() } : s,
        ),
      }));
      return {
        ok: true,
        messageKey: "worker.clockIn",
        workerId: worker.id,
        workerName: name,
        date,
        startAt: now.toISOString(),
      };
    }

    if (shift.endAt) {
      return {
        ok: true,
        messageKey: "worker.alreadyClosed",
        workerId: worker.id,
        workerName: name,
        date,
        minutes: shift.minutes,
      };
    }

    const minutes = Math.max(
      0,
      Math.round((now.getTime() - new Date(shift.startAt).getTime()) / 60000),
    );
    set((state) => ({
      workerShifts: state.workerShifts.map((s) =>
        s.id === shift.id ? { ...s, endAt: now.toISOString(), minutes } : s,
      ),
    }));
    return {
      ok: true,
      messageKey: "worker.clockOut",
      workerId: worker.id,
      workerName: name,
      date,
      minutes,
    };
  },

  freezeOpenWorkerShifts: async () => {
    const db = get();
    const today = dateKey(new Date());
    const doomed = db.workerShifts.filter(
      (s) => !s.endAt && s.startAt && !s.frozen && s.workDate < today,
    );
    if (doomed.length === 0) return { ok: true, frozen: 0 };
    const ids = new Set(doomed.map((s) => s.id));
    set((state) => ({
      workerShifts: state.workerShifts.map((s) =>
        ids.has(s.id) ? { ...s, frozen: true, minutes: 0 } : s,
      ),
    }));
    return { ok: true, frozen: doomed.length };
  },

  payWorkerShifts: async (workerId, shiftIds, amount, description) => {
    const db = get();
    const worker = db.reception.find((w) => w.id === workerId);
    if (!worker) return { ok: false, messageKey: "worker.notFound" };

    const payable = db.workerShifts.filter(
      (s) => s.workerId === workerId && !s.paid && !s.frozen && !!s.endAt && shiftIds.includes(s.id),
    );
    if (payable.length === 0) return { ok: false, messageKey: "worker.nothingDue" };

    const paymentId = uid("wpy");
    const ids = new Set(payable.map((s) => s.id));
    const minutes = payable.reduce((s, x) => s + x.minutes, 0);

    set((state) => ({
      workerShifts: state.workerShifts.map((s) =>
        ids.has(s.id) ? { ...s, paid: true, paymentId } : s,
      ),
      cash: [
        ...state.cash,
        {
          id: uid("csh"),
          type: "teacher_payment",
          amount: -Math.max(amount, 0),
          date: new Date().toISOString(),
          description:
            (description?.trim() || `Règlement heures ${worker.firstName} ${worker.lastName}`) +
            ` (${payable.length} jour(s), ${(minutes / 60).toFixed(2)} h)`,
        },
      ],
    }));

    return { ok: true, days: payable.length, minutes };
  },

  payTeacherSessions: async ({
    teacherId,
    keys,
    dueIds,
    passagerIds,
    amount,
    gross,
    method,
    percentage,
    details,
    months,
    description,
    expenseIds,
    acompteIds,
    childCharges,
    childDebtIds,
  }) => {
    const db = get();
    const teacher = db.teachers.find((t) => t.id === teacherId);
    if (!teacher) return { ok: false, messageKey: "pay.teacherNotFound" };

    const parsed = (keys ?? []).map((k) => {
      const [date, sessionId] = k.split("|");
      return { date, sessionId };
    });
    // A settlement now names the exact dues it closes, because a créneau can
    // hold two students living two different months. The old "whole créneau"
    // selection still works for anything that has not been migrated.
    const byId = Array.isArray(dueIds);
    const dueIdSet = new Set(dueIds ?? []);
    const passagerIdSet = new Set(passagerIds ?? []);

    const settledDues = db.unpaidTeacher.filter(
      (u) =>
        u.teacherId === teacherId &&
        !u.paid &&
        // The teacher is never paid for a student who still owes money — the
        // due stays open and reappears once the student clears the debt.
        !studentHasDebt(db, u.studentId) &&
        (byId
          ? dueIdSet.has(u.id)
          : parsed.some((p) => p.sessionId === u.sessionId && p.date === dateKey(u.date))),
    );
    const settledPassagers = db.independent.filter(
      (i) =>
        !i.studentId &&
        !i.teacherPaid &&
        (byId
          ? passagerIdSet.has(i.id)
          : parsed.some((p) => p.sessionId === i.sessionId && p.date === i.date)),
    );

    // How many dated séances the settlement actually covers.
    const covered = byId
      ? new Set([
          ...settledDues.map((u) => `${dateKey(u.date)}|${u.sessionId}`),
          ...settledPassagers.map((i) => `${i.date}|${i.sessionId}`),
        ]).size
      : parsed.filter(
          (p) =>
            settledDues.some((u) => u.sessionId === p.sessionId && dateKey(u.date) === p.date) ||
            settledPassagers.some((i) => i.sessionId === p.sessionId && i.date === p.date),
        ).length;

    const detailRows = (details ?? []) as Array<{ presents?: number }>;
    const studentsCount = detailRows.reduce((s, d) => s + (d.presents ?? 0), 0);

    const paymentId = uid("tpy");
    const settledDueIds = new Set(settledDues.map((u) => u.id));
    const settledPassagerIds = new Set(settledPassagers.map((i) => i.id));
    const paidAmount = Math.max(amount, 0);

    // What is taken off the pay — each line settled here and only here.
    const clearedExpenses = db.teacherExpenses.filter(
      (e) => e.teacherId === teacherId && !e.paid && (expenseIds ?? []).includes(e.id),
    );
    const clearedAcomptes = db.acomptes.filter(
      (a) => a.teacherId === teacherId && !a.paid && (acompteIds ?? []).includes(a.id),
    );
    const expenseSnapshot: TeacherPaymentDeduction[] = clearedExpenses.map((e) => ({
      id: e.id,
      kind: "expense",
      label: e.name,
      description: e.description,
      amount: e.amount,
      date: e.date,
    }));
    const acompteSnapshot: TeacherPaymentDeduction[] = clearedAcomptes.map((a) => ({
      id: a.id,
      kind: "acompte",
      label: "Acompte",
      description: a.description,
      amount: a.amount,
      date: dateKey(a.date),
    }));
    const expenseIdSet = new Set(clearedExpenses.map((e) => e.id));
    const acompteIdSet = new Set(clearedAcomptes.map((a) => a.id));

    // Les scolarités déjà créditées aux enfants et portées sur ce salaire : ce
    // règlement les retient, et elles ne reviendront jamais sur le suivant.
    const clearedChildDebts = db.teacherChildDebts.filter(
      (d) => d.teacherId === teacherId && !d.paid && (childDebtIds ?? []).includes(d.id),
    );
    const childDebtSnapshot: TeacherPaymentDeduction[] = clearedChildDebts.map((d) => ({
      id: d.id,
      kind: "expense",
      label: `Scolarité — ${d.label}`,
      description: [d.monthCode, d.subscriptionId ? undefined : "hors emploi du temps"]
        .filter(Boolean)
        .join(" · "),
      amount: d.amount,
      date: d.date,
    }));
    const childDebtIdSet = new Set(clearedChildDebts.map((d) => d.id));

    set((state) => ({
      unpaidTeacher: state.unpaidTeacher.map((u) =>
        settledDueIds.has(u.id) ? { ...u, paid: true } : u,
      ),
      independent: state.independent.map((i) =>
        settledPassagerIds.has(i.id) ? { ...i, teacherPaid: true } : i,
      ),
      teacherExpenses: state.teacherExpenses.map((e) =>
        expenseIdSet.has(e.id) ? { ...e, paid: true, paymentId } : e,
      ),
      acomptes: state.acomptes.map((a) =>
        acompteIdSet.has(a.id) ? { ...a, paid: true, paymentId } : a,
      ),
      teacherChildDebts: state.teacherChildDebts.map((d) =>
        childDebtIdSet.has(d.id) ? { ...d, paid: true, paymentId } : d,
      ),
      teacherPayments: [
        ...state.teacherPayments,
        {
          id: paymentId,
          teacherId,
          amount: paidAmount,
          method: method ?? "fixed",
          percentage,
          studentsCount,
          sessionsCount: covered,
          description:
            description?.trim() ||
            `Règlement séances ${teacher.firstName} ${teacher.lastName}`,
          details: (details ?? []) as TeacherPayment["details"],
          gross: Math.max(0, Math.round(gross ?? paidAmount)),
          expenses: expenseSnapshot,
          acomptes: acompteSnapshot,
          childCharges: childCharges ?? [],
          childDebts: childDebtSnapshot,
          months: months ?? [],
          paidAt: new Date().toISOString(),
        },
      ],
      cash: [
        ...state.cash,
        {
          id: uid("csh"),
          type: "teacher_payment",
          amount: -paidAmount,
          date: new Date().toISOString(),
          description: `Règlement séances ${teacher.firstName} ${teacher.lastName} (${covered} créneau(x))`,
        },
      ],
    }));

    // The children of a teacher-father are schooled on his pay: their soldes
    // are brought back to zero here, without any cash moving — the school is
    // paid by simply handing him less.
    for (const charge of childCharges ?? []) {
      for (const line of charge.lines) {
        if (line.amount <= 0) continue;
        await get().addSold({
          studentId: charge.studentId,
          subscriptionId: line.subscriptionId,
          amount: line.amount,
          monthCode: line.monthCode,
          source: "teacher_salary",
          description: `Réglé sur le salaire de ${teacher.firstName} ${teacher.lastName} (${line.monthCode})`,
        });
      }
    }

    return { ok: true, paymentId, sessions: covered };
  },

  // ---- Séances: buying, owing, consuming ------------------------------------
  createEnrollmentPayment: async ({
    studentId,
    subscriptionId,
    seances,
    discountType,
    discountValue,
    amountPaid,
    startDate,
    expiryDate,
    description,
    plan,
    monthSeances,
    packagePrice,
  }) => {
    const db = get();
    const student = db.students.find((s) => s.id === studentId);
    const sub = db.subscriptions.find((s) => s.id === subscriptionId);
    if (!student || !sub) return { ok: false };

    // A month is bought whole: its pack of séances at its own price, whatever
    // the séance-by-séance boxes hold.
    const monthly = plan === "month";
    const packSeances = Math.max(0, Math.round(monthSeances ?? sub.monthlySeances ?? 0));
    const count = monthly ? packSeances : Math.max(0, Math.round(seances || 0));
    const discount: SubscriptionDiscount | undefined =
      discountType && (discountValue ?? 0) > 0
        ? { type: discountType, value: Math.max(0, Math.round(discountValue!)) }
        : undefined;

    const unitPrice = Math.max(0, Math.round(sub.pricePerSession || 0));
    const grossTotal = monthly
      ? Math.max(
          0,
          Math.round(packagePrice ?? sub.monthlyPrice ?? packSeances * unitPrice),
        )
      : unitPrice * count;
    // The remise applies to the whole basket, through the same helper the rest
    // of the app prices séances with — so what is charged is what was shown.
    const netTotal = netPriceFor(grossTotal, discount);
    const paid = Math.max(0, Math.round(amountPaid || 0));
    const rest = Math.max(0, netTotal - paid);

    const existing = db.enrollments.find(
      (e) => e.studentId === studentId && e.subscriptionId === subscriptionId,
    );
    const enrollmentId = existing?.id ?? uid("enr");
    const now = new Date().toISOString();
    const today = dateKey(new Date());

    // Buying a month opens a NEW period: the counter restarts at the pack and
    // the séances left on the month that ends are not carried over — they
    // expired with it. Buying séances one by one simply tops the counter up.
    const enrollment: Enrollment = existing
      ? {
          ...existing,
          paidSeances: monthly ? count : existing.paidSeances + count,
          consumedSeances: monthly ? 0 : existing.consumedSeances,
          // What was handed over lands on the emploi's solde.
          balance: (existing.balance ?? 0) + Math.max(0, Math.round(amountPaid || 0)),
          discount: discount ?? existing.discount,
          startDate: startDate ?? existing.startDate,
          expiryDate: monthly ? expiryDate : expiryDate ?? existing.expiryDate,
          plan: plan ?? existing.plan,
          monthSeances: monthly ? count : existing.monthSeances,
        }
      : {
          id: enrollmentId,
          studentId,
          subscriptionId,
          paidSeances: count,
          consumedSeances: 0,
          balance: Math.max(0, Math.round(amountPaid || 0)),
          discount,
          startDate: startDate ?? today,
          expiryDate,
          plan,
          monthSeances: monthly ? count : undefined,
          createdAt: now,
        };

    const payment: Payment = {
      id: uid("pay"),
      studentId,
      enrollmentId,
      subscriptionId,
      // Months belong to the emploi, so the money lands on the month this
      // student is currently walking through on it.
      monthCode: currentCycleCode(db, studentId, subscriptionId),
      seancesPurchased: count,
      unitPrice,
      grossTotal,
      discountType: discount?.type,
      discountValue: discount?.value,
      netTotal,
      amountPaid: paid,
      rest,
      type: "subscription_payment",
      plan,
      date: now,
      description,
    };

    set((state) => ({
      enrollments: existing
        ? state.enrollments.map((e) => (e.id === enrollmentId ? enrollment : e))
        : [...state.enrollments, enrollment],
      payments: [...state.payments, payment],
      // The student must stay enrolled on the module he just paid séances for,
      // otherwise the scanner would no longer match his card to that timing —
      // and his inscription dates must mirror the period he just bought.
      students: state.students.map((s) =>
        s.id === studentId
          ? {
              ...s,
              subscriptionIds: s.subscriptionIds.includes(subscriptionId)
                ? s.subscriptionIds
                : [...s.subscriptionIds, subscriptionId],
              subscriptionDates: {
                ...s.subscriptionDates,
                [subscriptionId]: {
                  ...s.subscriptionDates?.[subscriptionId],
                  subscribedAt: s.subscriptionDates?.[subscriptionId]?.subscribedAt ?? today,
                  startDate: enrollment.startDate,
                  expiryDate: enrollment.expiryDate,
                  plan: enrollment.plan,
                },
              },
            }
          : s,
      ),
      cash: paid > 0
        ? [
            ...state.cash,
            {
              id: uid("csh"),
              type: "student_payment" as const,
              amount: paid,
              date: now,
              description: `Paiement séances ${student.firstName} ${student.lastName}`,
            },
          ]
        : state.cash,
    }));

    return { ok: true, enrollmentId, paymentId: payment.id, rest };
  },

  // Reception edited the inscription itself (formula, start, expiry). The money
  // already paid is untouched: only the period the séances live in moves.
  setEnrollmentPlan: async (studentId, subscriptionId, fields) => {
    const db = get();
    const row = db.enrollments.find(
      (e) => e.studentId === studentId && e.subscriptionId === subscriptionId,
    );
    if (!row) return { ok: true };

    set((state) => ({
      enrollments: state.enrollments.map((e) =>
        e.id === row.id
          ? {
              ...e,
              plan: fields.plan ?? e.plan,
              startDate: fields.startDate ?? e.startDate,
              // Passing the formula makes `expiryDate` authoritative: leaving it
              // out is how a module goes back to séance-by-séance, deadline-free.
              expiryDate: fields.plan ? fields.expiryDate : fields.expiryDate ?? e.expiryDate,
              monthSeances: fields.monthSeances ?? e.monthSeances,
            }
          : e,
      ),
    }));

    return { ok: true };
  },

  payStudentDebt: async (studentId, amount) => {
    const db = get();
    const student = db.students.find((s) => s.id === studentId);
    if (!student) return { ok: false };

    const owed = db.payments
      .filter((p) => p.studentId === studentId)
      .reduce((s, p) => s + p.rest, 0);
    const settled = Math.min(Math.max(0, Math.round(amount || 0)), Math.max(owed, 0));
    if (settled <= 0) return { ok: false, settled: 0, remainingDebt: Math.max(owed, 0) };

    // Oldest debts first, so the history reads chronologically.
    const order = db.payments
      .filter((p) => p.studentId === studentId && p.rest > 0)
      .sort((a, b) => a.date.localeCompare(b.date));
    const reduced = new Map<string, number>();
    let left = settled;
    for (const p of order) {
      if (left <= 0) break;
      const take = Math.min(p.rest, left);
      reduced.set(p.id, p.rest - take);
      left -= take;
    }

    const now = new Date().toISOString();
    const receipt: Payment = {
      id: uid("pay"),
      studentId,
      seancesPurchased: 0,
      unitPrice: 0,
      grossTotal: 0,
      netTotal: 0,
      amountPaid: settled,
      rest: 0,
      type: "debt_payment",
      date: now,
      description: "Règlement de dette",
    };

    set((state) => ({
      payments: [
        ...state.payments.map((p) => (reduced.has(p.id) ? { ...p, rest: reduced.get(p.id)! } : p)),
        receipt,
      ],
      cash: [
        ...state.cash,
        {
          id: uid("csh"),
          type: "student_payment" as const,
          amount: settled,
          date: now,
          description: `Règlement de dette ${student.firstName} ${student.lastName}`,
        },
      ],
    }));

    return { ok: true, settled, remainingDebt: Math.max(0, owed - settled) };
  },

  payMonthDebt: async (studentId, monthCode, amount, description) => {
    const db = get();
    const student = db.students.find((s) => s.id === studentId);
    if (!student) return { ok: false };

    // Only the unpaid remainders that fall in the requested school month.
    const monthOwed = db.payments
      .filter((p) => p.studentId === studentId && p.rest > 0 && (p.monthCode || "M1") === monthCode)
      .reduce((s, p) => s + p.rest, 0);
    const settled = Math.min(Math.max(0, Math.round(amount || 0)), Math.max(monthOwed, 0));
    if (settled <= 0) return { ok: false, settled: 0, remainingDebt: Math.max(monthOwed, 0) };

    const order = db.payments
      .filter((p) => p.studentId === studentId && p.rest > 0 && (p.monthCode || "M1") === monthCode)
      .sort((a, b) => a.date.localeCompare(b.date));
    const reduced = new Map<string, number>();
    let left = settled;
    for (const p of order) {
      if (left <= 0) break;
      const take = Math.min(p.rest, left);
      reduced.set(p.id, p.rest - take);
      left -= take;
    }

    const now = new Date().toISOString();
    const receipt: Payment = {
      id: uid("pay"),
      studentId,
      seancesPurchased: 0,
      unitPrice: 0,
      grossTotal: 0,
      netTotal: 0,
      amountPaid: settled,
      rest: 0,
      type: "debt_payment",
      date: now,
      description: description?.trim() || `Règlement dette ${monthCode}`,
    };

    set((state) => ({
      payments: [
        ...state.payments.map((p) => (reduced.has(p.id) ? { ...p, rest: reduced.get(p.id)! } : p)),
        receipt,
      ],
      cash: [
        ...state.cash,
        {
          id: uid("csh"),
          type: "student_payment" as const,
          amount: settled,
          date: now,
          description: `Règlement dette ${monthCode} — ${student.firstName} ${student.lastName}`,
        },
      ],
    }));

    return { ok: true, settled, remainingDebt: Math.max(0, monthOwed - settled) };
  },

  consumeSeance: async (enrollmentId) => {
    const db = get();
    const enrollment = db.enrollments.find((e) => e.id === enrollmentId);
    if (!enrollment) return { ok: false };

    const before = enrollment.paidSeances - enrollment.consumedSeances;
    set((state) => ({
      enrollments: state.enrollments.map((e) =>
        e.id === enrollmentId ? { ...e, consumedSeances: e.consumedSeances + 1 } : e,
      ),
    }));

    return {
      ok: true,
      remaining: Math.max(0, before - 1),
      // Nothing was left to take: the séance still happened, it just needs
      // regularising at the desk.
      exhausted: before <= 0,
    };
  },

  subscribeStudent: async ({ studentId, subscriptionId, date }) => {
    const db = get();
    const student = db.students.find((s) => s.id === studentId);
    const sub = db.subscriptions.find((s) => s.id === subscriptionId);
    if (!student || !sub) return { ok: false };

    const day = date || dateKey(new Date());
    const point = joinPointFor(db, subscriptionId, day, studentId);

    set((state) => ({
      students: state.students.map((st) =>
        st.id === studentId
          ? {
              ...st,
              subscriptionIds: st.subscriptionIds.includes(subscriptionId)
                ? st.subscriptionIds
                : [...st.subscriptionIds, subscriptionId],
              subscriptionDates: {
                ...st.subscriptionDates,
                [subscriptionId]: {
                  ...st.subscriptionDates?.[subscriptionId],
                  subscribedAt: st.subscriptionDates?.[subscriptionId]?.subscribedAt ?? day,
                  startDate: st.subscriptionDates?.[subscriptionId]?.startDate ?? day,
                  joinMonthCode: point.monthCode,
                  joinSlotIndex: point.slotIndex,
                  // He is back on the roster: the old leaving date is history
                  // no more.
                  unsubscribedAt: undefined,
                },
              },
            }
          : st,
      ),
    }));

    return { ok: true, monthCode: point.monthCode, slotIndex: point.slotIndex };
  },

  unsubscribeStudent: async (studentId, subscriptionId) => {
    const db = get();
    const student = db.students.find((s) => s.id === studentId);
    if (!student || !student.subscriptionIds.includes(subscriptionId)) return { ok: false };
    const balance = soldFor(db, studentId, subscriptionId);

    const leftOn = dateKey(new Date());

    set((state) => ({
      students: state.students.map((st) => {
        if (st.id !== studentId) return st;
        // The block is KEPT and simply dated: his présences, ses paiements et
        // son solde restent lisibles sur sa fiche, avec le jour de la sortie.
        // Re-registering him rewrites the join point and clears that date, so
        // he lands where the group stands THEN, not where it stood before.
        const dates = { ...(st.subscriptionDates ?? {}) };
        dates[subscriptionId] = { ...(dates[subscriptionId] ?? {}), unsubscribedAt: leftOn };
        return {
          ...st,
          subscriptionIds: st.subscriptionIds.filter((id) => id !== subscriptionId),
          subscriptionDates: dates,
        };
      }),
    }));

    return { ok: true, balance, leftOn };
  },

  deleteStudentPayment: async (paymentId) => {
    const db = get();
    const payment = db.payments.find((p) => p.id === paymentId);
    if (!payment) return { ok: false };
    // Un règlement de dette a effacé des restes à payer répartis sur plusieurs
    // achats, sans garder lesquels : le supprimer laisserait ces dettes
    // soldées pour rien. Il se corrige en réencaissant, pas en effaçant.
    if (payment.type === "debt_payment") return { ok: false, messageKey: "payment.debtLocked" };

    const credit = Math.max(0, Math.round(payment.amountPaid || 0));
    const enrollment = db.enrollments.find(
      (e) =>
        e.studentId === payment.studentId &&
        (payment.enrollmentId ? e.id === payment.enrollmentId : e.subscriptionId === payment.subscriptionId),
    );
    // The caisse row written alongside carries the very same timestamp and
    // amount — that is what identifies it, no extra column needed.
    const cashRow = db.cash.find(
      (c) => c.type === "student_payment" && c.date === payment.date && c.amount === credit,
    );
    const balanceAfter = (enrollment?.balance ?? 0) - credit;

    set((state) => ({
      payments: state.payments.filter((p) => p.id !== paymentId),
      enrollments: enrollment
        ? state.enrollments.map((e) =>
            e.id === enrollment.id ? { ...e, balance: (e.balance ?? 0) - credit } : e,
          )
        : state.enrollments,
      cash: cashRow ? state.cash.filter((c) => c.id !== cashRow.id) : state.cash,
    }));

    return { ok: true, balance: balanceAfter, amount: credit };
  },

  updateStudentPayment: async (paymentId, fields) => {
    const db = get();
    const payment = db.payments.find((p) => p.id === paymentId);
    if (!payment) return { ok: false };
    if (payment.type === "debt_payment" && fields.amount !== undefined) {
      return { ok: false, messageKey: "payment.debtLocked" };
    }

    const before = Math.max(0, Math.round(payment.amountPaid || 0));
    const after = fields.amount === undefined ? before : Math.max(0, Math.round(fields.amount));
    const delta = after - before;
    const enrollment = db.enrollments.find(
      (e) =>
        e.studentId === payment.studentId &&
        (payment.enrollmentId ? e.id === payment.enrollmentId : e.subscriptionId === payment.subscriptionId),
    );
    const cashRow = db.cash.find(
      (c) => c.type === "student_payment" && c.date === payment.date && c.amount === before,
    );
    const nextDate = fields.date
      ? fields.date.length === 10
        ? `${fields.date}T${payment.date.slice(11) || "12:00:00.000Z"}`
        : new Date(fields.date).toISOString()
      : payment.date;

    const patched: Payment = {
      ...payment,
      amountPaid: after,
      // A purchase priced at its net total keeps its arithmetic straight: what
      // is not handed over is exactly what stays owed.
      rest: Math.max(0, Math.round((payment.netTotal || after) - after)),
      monthCode: fields.monthCode ?? payment.monthCode,
      description: fields.description ?? payment.description,
      date: nextDate,
    };

    set((state) => ({
      payments: state.payments.map((p) => (p.id === paymentId ? patched : p)),
      enrollments:
        enrollment && delta !== 0
          ? state.enrollments.map((e) =>
              e.id === enrollment.id ? { ...e, balance: (e.balance ?? 0) + delta } : e,
            )
          : state.enrollments,
      cash: cashRow
        ? state.cash.map((c) =>
            c.id === cashRow.id ? { ...c, amount: after, date: nextDate } : c,
          )
        : state.cash,
    }));

    return { ok: true, balance: (enrollment?.balance ?? 0) + delta };
  },

  // ---- Séances libres de groupe --------------------------------------------
  saveGroupSeance: async (input) => {
    const db = get();
    const teacher = db.teachers.find((t) => t.id === input.teacherId);
    if (!teacher) return { ok: false };

    const existing = db.groupSeances.find((g) => g.id === input.id);
    const totals = groupSeanceTotals(input);
    const when = input.date.length === 10 ? `${input.date}T12:00:00.000Z` : input.date;
    const label = input.title?.trim() || "Séance libre de groupe";

    const cashInId = existing?.cashInId ?? uid("csh");
    const cashOutId = existing?.cashOutId ?? uid("csh");
    const cashIn: CashTransaction = {
      id: cashInId,
      type: "student_payment",
      amount: totals.total,
      date: when,
      description: `Séance libre de groupe : ${label} — ${totals.students} élève(s) × ${totals.pricePerStudent} DA`,
    };
    const cashOut: CashTransaction = {
      id: cashOutId,
      type: "teacher_payment",
      amount: -totals.teacherTotal,
      date: when,
      description: `Séance libre de groupe : ${label} — ${teacher.firstName} ${teacher.lastName}`,
    };

    const row: GroupSeance = {
      ...input,
      title: label,
      studentsCount: totals.students,
      pricePerStudent: totals.pricePerStudent,
      schoolPerStudent: totals.schoolPerStudent,
      cashInId,
      cashOutId,
      createdAt: existing?.createdAt ?? input.createdAt ?? new Date().toISOString(),
    };

    set((state) => {
      // The two movements are rewritten in place: editing the séance can never
      // leave a stale amount behind in the caisse or in the rapports.
      const cash = state.cash.filter((c) => c.id !== cashInId && c.id !== cashOutId);
      cash.push(cashIn);
      if (totals.teacherTotal > 0) cash.push(cashOut);
      return {
        groupSeances: existing
          ? state.groupSeances.map((g) => (g.id === row.id ? row : g))
          : [...state.groupSeances, row],
        cash,
      };
    });

    return { ok: true, id: row.id };
  },

  deleteGroupSeance: async (id) => {
    const db = get();
    const row = db.groupSeances.find((g) => g.id === id);
    if (!row) return { ok: false };
    set((state) => ({
      groupSeances: state.groupSeances.filter((g) => g.id !== id),
      cash: state.cash.filter((c) => c.id !== row.cashInId && c.id !== row.cashOutId),
    }));
    return { ok: true };
  },

  setStudentPassword: async (studentId, password) => {
    set((state) => ({
      studentCredentials: [
        ...state.studentCredentials.filter((c) => c.studentId !== studentId),
        { studentId, password, updatedAt: new Date().toISOString() },
      ],
    }));
  },

  setModuleAbsenceRule: async (moduleId, enabled, daysWindow = 7) => {
    set((state) => ({
      moduleAbsenceRules: [
        ...state.moduleAbsenceRules.filter((r) => r.moduleId !== moduleId),
        { moduleId, enabled, daysWindow },
      ],
    }));
  },

  // ---- Plain collection mutations -------------------------------------------
  push: (key, item) => {
    set((state) => ({ [key]: [...(state[key] as unknown[]), item] }) as Partial<DataStore>);
  },

  updateItem: (key, id, updatedFields) => {
    set((state) => ({
      [key]: (state[key] as Array<{ id: string }>).map((x) =>
        x.id === id ? { ...x, ...updatedFields } : x,
      ),
    }) as Partial<DataStore>);
  },

  deleteFrom: (key, id) => {
    set((state) => {
      const patch: Record<string, unknown> = {
        [key]: (state[key] as Array<{ id: string }>).filter((x) => x.id !== id),
      };
      // Keep the obvious back-references clean, the way the SQL cascades did.
      if (key === "parents") {
        patch.students = state.students.map((s) =>
          s.parentId === id ? { ...s, parentId: undefined } : s,
        );
      }
      if (key === "subscriptions") {
        patch.students = state.students.map((s) =>
          s.subscriptionIds.includes(id)
            ? { ...s, subscriptionIds: s.subscriptionIds.filter((x) => x !== id) }
            : s,
        );
      }
      return patch as Partial<DataStore>;
    });
  },

  cashMove: (type, amount, description, date) => {
    let isoDate = new Date().toISOString();
    if (date) {
      isoDate =
        date.length === 10
          ? `${date}T${new Date().toISOString().substring(11)}`
          : new Date(date).toISOString();
    }
    const signedAmount = type === "withdraw" ? -Math.abs(amount) : Math.abs(amount);
    const item: CashTransaction = {
      id: uid("csh"),
      type,
      amount: signedAmount,
      date: isoDate,
      description,
    };
    set((state) => ({ cash: [...state.cash, item] }));
  },

  updateSchool: (updatedFields) => {
    set((state) => ({ school: { ...state.school, ...updatedFields } }));
  },

  restoreState: (dump) => set(() => ({ ...dump })),

  /** Empties the local snapshot. The database is untouched — the next
   *  `fetchAll()` simply reads it again. */
  reset: () => {
    lastAbsenceRun = null;
    set({ ...emptyDatabase(), loaded: false });
  },
}));
