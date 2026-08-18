import type { Database } from "@/lib/store/data";
import { DAYS } from "@/lib/types";
import type {
  CoursLevel,
  Day,
  Enrollment,
  Payment,
  ScheduleSession,
  SchoolClass,
  Student,
  Subscription,
  SubscriptionDiscount,
} from "@/lib/types";

/** French weekday labels — shared by every screen that prints a timing. */
export const DAY_LABELS_FR: Record<Day, string> = {
  saturday: "Samedi",
  sunday: "Dimanche",
  monday: "Lundi",
  tuesday: "Mardi",
  wednesday: "Mercredi",
  thursday: "Jeudi",
  friday: "Vendredi",
};

/** "Samedi, Lundi" — always in the school's week order, never the click order. */
export function formatDays(days: Day[] = []): string {
  return DAYS.filter((d) => days.includes(d))
    .map((d) => DAY_LABELS_FR[d])
    .join(", ");
}

export const teacherName = (db: Database, id: string) => {
  const t = db.teachers.find((x) => x.id === id);
  return t ? `${t.firstName} ${t.lastName}` : "—";
};
export const moduleName = (db: Database, id: string) =>
  db.modules.find((m) => m.id === id)?.name ?? "—";
export const groupName = (db: Database, id: string) =>
  db.groups.find((g) => g.id === id)?.name ?? "—";
export const salleName = (db: Database, id: string) =>
  db.salles.find((s) => s.id === id)?.name ?? "—";
/** Optional kindergarten category name. */
export const categoryName = (db: Database, id?: string) =>
  id ? db.classCategories.find((c) => c.id === id)?.name ?? "" : "";

export const studentName = (s: Student) => `${s.firstName} ${s.lastName}`;

/** The four school levels, ordered youngest → oldest, with their French labels.
 *  In the enrollment screens the user picks one of these before a year. */
export const COURS_LEVELS: { value: CoursLevel; label: string }[] = [
  { value: "maternelle", label: "Maternelle" },
  { value: "primaire", label: "Primaire" },
  { value: "moyen", label: "Moyen" },
  { value: "lycee", label: "Secondaire (Lycée)" },
];

export function coursLevelLabel(level?: CoursLevel): string {
  return COURS_LEVELS.find((l) => l.value === level)?.label ?? "";
}

export function classLabel(db: Database, cls: SchoolClass): string {
  if (cls.type === "formation") return `${cls.name} (${cls.formationLevel})`;
  const cat = categoryName(db, cls.categoryId);
  return [cls.name, cat].filter(Boolean).join(" · ");
}

export function classOf(db: Database, id: string): SchoolClass | undefined {
  return db.classes.find((c) => c.id === id);
}

/** Identity of a "cours": one class + one module + one teacher, taught to
 *  several groups. Every group of a cours shares ONE tariff, and a student
 *  enrolled in any of them may attend any other (rattrapage). A séance libre
 *  timing is a product on its own, so it never merges with anything. */
export function courseKeyOf(session: ScheduleSession): string {
  return session.isOpen
    ? `open-${session.id}`
    : `${session.classId}|${session.moduleId}|${session.teacherId}`;
}

/** Every timing of the same cours (i.e. all its groups), week-order sorted. */
export function siblingSessions(db: Database, session: ScheduleSession): ScheduleSession[] {
  const key = courseKeyOf(session);
  return db.sessions.filter((s) => courseKeyOf(s) === key);
}

/** Full session label. `withGroup=false` drops the group (used by the
 *  Subscriptions listing where one label covers multiple groups). */
export function sessionLabel(
  db: Database,
  session: ScheduleSession,
  opts: { withGroup?: boolean } = {},
): string {
  const cls = classOf(db, session.classId);
  const parts = [
    cls ? classLabel(db, cls) : "",
    moduleName(db, session.moduleId),
    opts.withGroup === false ? "" : groupName(db, session.groupId),
    salleName(db, session.salleId),
    teacherName(db, session.teacherId),
  ].filter(Boolean);
  return parts.join(" · ");
}

export function subscriptionPrice(db: Database, sub: Subscription): number {
  return sub.pricePerSession;
}

// ---- Monthly formula ----
/** The cours can also be sold by the month (a pack of séances at a fixed price). */
export function hasMonthlyPlan(sub?: Subscription): boolean {
  return !!sub && (sub.monthlySeances ?? 0) > 0;
}

/** What one month costs: the price the school set, or the séances it contains. */
export function monthlyPriceOf(sub?: Subscription): number {
  if (!sub) return 0;
  const computed = (sub.monthlySeances ?? 0) * (sub.pricePerSession ?? 0);
  return Math.max(0, Math.round(sub.monthlyPrice ?? computed));
}

/** Price of the séances of a month bought one by one — the reference the
 *  monthly price is compared against (a pack is often cheaper). */
export function monthlySeancesValue(sub?: Subscription): number {
  if (!sub) return 0;
  return Math.max(0, Math.round((sub.monthlySeances ?? 0) * (sub.pricePerSession ?? 0)));
}

// ---- School / teacher split of a month ------------------------------------
/** What the school keeps from one month. Defaults to the whole month price when
 *  no split has been set. Never exceeds the month price. */
export function schoolMonthShareOf(sub?: Subscription): number {
  if (!sub) return 0;
  const total = monthlyPriceOf(sub);
  if (sub.schoolMonthShare == null) return total;
  return Math.min(Math.max(0, Math.round(sub.schoolMonthShare)), total);
}

/** The teacher's share of one month = month price − school share. */
export function teacherMonthShareOf(sub?: Subscription): number {
  if (!sub) return 0;
  return Math.max(0, monthlyPriceOf(sub) - schoolMonthShareOf(sub));
}

/** The teacher's pay for ONE séance of this subscription. Uses the stored value
 *  when present, otherwise teacherMonthShare / monthlySeances. This is what a
 *  teacher settlement multiplies by the number of séances actually attended. */
export function teacherPerSeanceOf(sub?: Subscription): number {
  if (!sub) return 0;
  if (sub.teacherPerSeance != null) return Math.max(0, Math.round(sub.teacherPerSeance));
  const n = sub.monthlySeances ?? 0;
  return n > 0 ? Math.max(0, Math.round(teacherMonthShareOf(sub) / n)) : 0;
}

// ---- Per-module reductions ----
/**
 * Price actually charged once the student's reduction on that module is
 * applied. Mirrors the `public.discounted_price()` SQL function 1:1 — the scan,
 * the manual présence and the weekly-absence billing all use the SQL one, so
 * this must stay in sync or the UI would advertise a price the server doesn't
 * charge. Never returns a negative price.
 */
export function netPriceFor(basePrice: number, discount?: SubscriptionDiscount): number {
  const price = Math.max(0, Math.round(basePrice || 0));
  if (!discount || discount.value <= 0) return price;
  const cut =
    discount.type === "percent"
      ? Math.round((price * Math.min(Math.max(discount.value, 0), 100)) / 100)
      : Math.max(discount.value, 0);
  return Math.max(0, price - cut);
}

/** Human label for a reduction, e.g. "-20%" or "-500 DA". Empty when none. */
export function discountLabel(discount?: SubscriptionDiscount): string {
  if (!discount || discount.value <= 0) return "";
  return discount.type === "percent" ? `-${discount.value}%` : `-${discount.value} DA`;
}

/** Net price of one séance for a given student on a given subscription. */
export function studentSeancePrice(student: Student, sub: Subscription): number {
  return netPriceFor(sub.pricePerSession, student.subscriptionDiscounts?.[sub.id]);
}

export function subscriptionLabel(db: Database, sub: Subscription): string {
  const session = db.sessions.find((s) => s.id === sub.sessionId);
  return session ? sessionLabel(db, session, { withGroup: false }) : "—";
}

/** Modules a student is enrolled in (via their subscriptions). */
export function studentModules(db: Database, student: Student): string[] {
  return student.subscriptionIds
    .map((sid) => db.subscriptions.find((s) => s.id === sid))
    .filter(Boolean)
    .map((sub) => {
      const session = db.sessions.find((s) => s.id === sub!.sessionId);
      return session ? moduleName(db, session.moduleId) : "";
    })
    .filter(Boolean);
}

export function enrolledCount(db: Database, classId: string): number {
  const sessionIds = db.sessions
    .filter((s) => s.classId === classId)
    .map((s) => s.id);
  const subIds = new Set(
    db.subscriptions.filter((s) => sessionIds.includes(s.sessionId)).map((s) => s.id),
  );
  return db.students.filter((st) =>
    st.subscriptionIds.some((id) => subIds.has(id)),
  ).length;
}

export function sessionEnrolledStudents(db: Database, sessionId: string): Student[] {
  const subIds = db.subscriptions
    .filter((s) => s.sessionId === sessionId)
    .map((s) => s.id);
  return db.students.filter((st) =>
    st.subscriptionIds.some((id) => subIds.includes(id)),
  );
}

// ---- Formation dates ----
export function todayIso(): string {
  return new Date().toLocaleDateString("fr-CA"); // YYYY-MM-DD
}

/** Add N months to a YYYY-MM-DD date, clamped to the last day of the target month. */
export function addMonths(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const target = new Date(y, m - 1 + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d, lastDay));
  return target.toLocaleDateString("fr-CA");
}

/** Add N days to a YYYY-MM-DD date (negative goes back). */
export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d + days).toLocaleDateString("fr-CA");
}

/**
 * Last day a monthly plan started on `startDate` is still valid — inclusive.
 * A month bought on the 16/08 runs to the 15/09: one full month, never a day
 * more, whatever is left unused on it.
 */
export function monthlyExpiry(startDate: string, months = 1): string {
  return addDays(addMonths(startDate, Math.max(1, months)), -1);
}

/** Whole days from today (local) until a YYYY-MM-DD date. Negative = already past. */
export function daysUntil(dateStr: string): number {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const [y, m, d] = dateStr.split("-").map(Number);
  return Math.round((new Date(y, m - 1, d).getTime() - today) / 86400000);
}

export function formatDateFr(dateStr?: string): string {
  if (!dateStr) return "—";
  const [y, m, d] = dateStr.split("-");
  return `${d}/${m}/${y}`;
}

// ---- School-year months: September = M1 … July = M11 -----------------------
/**
 * The school year runs from September to July. Each month gets a code M1…M11
 * used everywhere presences, payments and debts are grouped by month. August is
 * outside the school year, so it maps to nothing.
 * `month` is the JS month index (0 = January).
 */
export interface SchoolMonth {
  code: string;
  /** JS month index, 0 = January */
  month: number;
  label: string;
  short: string;
}

export const SCHOOL_MONTHS: SchoolMonth[] = [
  { code: "M1", month: 8, label: "Septembre", short: "Sep" },
  { code: "M2", month: 9, label: "Octobre", short: "Oct" },
  { code: "M3", month: 10, label: "Novembre", short: "Nov" },
  { code: "M4", month: 11, label: "Décembre", short: "Déc" },
  { code: "M5", month: 0, label: "Janvier", short: "Jan" },
  { code: "M6", month: 1, label: "Février", short: "Fév" },
  { code: "M7", month: 2, label: "Mars", short: "Mar" },
  { code: "M8", month: 3, label: "Avril", short: "Avr" },
  { code: "M9", month: 4, label: "Mai", short: "Mai" },
  { code: "M10", month: 5, label: "Juin", short: "Jun" },
  { code: "M11", month: 6, label: "Juillet", short: "Jul" },
];

/** School month for a JS month index (0-11), or null for August (index 7). */
export function schoolMonthByJsMonth(jsMonth: number): SchoolMonth | null {
  return SCHOOL_MONTHS.find((m) => m.month === jsMonth) ?? null;
}

export function schoolMonthByCode(code: string): SchoolMonth | null {
  return SCHOOL_MONTHS.find((m) => m.code === code) ?? null;
}

/** "M3" for a YYYY-MM-DD / ISO date / Date. Null when the date falls in August. */
export function monthCodeForDate(value?: string | Date): string | null {
  if (!value) return null;
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return null;
  return schoolMonthByJsMonth(d.getMonth())?.code ?? null;
}

/** "M3 · Novembre" — the human label of a month code. */
export function monthCodeLabel(code: string): string {
  const m = schoolMonthByCode(code);
  return m ? `${m.code} · ${m.label}` : code;
}

/** Current school month code. August (out of the school year) falls back to M1
 *  so the demo always lands on a valid month. */
export function currentMonthCode(): string {
  return schoolMonthByJsMonth(new Date().getMonth())?.code ?? "M1";
}

/** Ordering index of a month code in the school year (M1 = 0 … M11 = 10). */
export function monthOrder(code: string): number {
  return SCHOOL_MONTHS.findIndex((m) => m.code === code);
}

/** School months from M1 up to (and including) the given code — used to list
 *  the months a student may already owe on. */
export function schoolMonthsUpTo(code: string): SchoolMonth[] {
  const idx = monthOrder(code);
  return idx < 0 ? SCHOOL_MONTHS.slice() : SCHOOL_MONTHS.slice(0, idx + 1);
}

/** True when a date belongs to the given school month code. */
export function isInMonth(dateStr: string | undefined, code: string): boolean {
  return !!dateStr && monthCodeForDate(dateStr) === code;
}

// ---- Month-based debt & presence (drives the dashboard, renewals, debts) ----
/** Debt (unpaid remainders) a student carries for one school month — the sum of
 *  the `rest` of the payments he made that month. */
export function monthDebt(db: Database, studentId: string, code: string): number {
  return db.payments
    .filter((p) => p.studentId === studentId && p.rest > 0 && monthCodeForDate(p.date) === code)
    .reduce((s, p) => s + p.rest, 0);
}

export interface MonthDebt {
  code: string;
  label: string;
  debt: number;
}

/** Every school month a student still owes on, ordered M1 → M11. */
export function debtByMonth(db: Database, studentId: string): MonthDebt[] {
  return SCHOOL_MONTHS.map((m) => ({
    code: m.code,
    label: `${m.code} · ${m.label}`,
    debt: monthDebt(db, studentId, m.code),
  })).filter((x) => x.debt > 0);
}

/** Debt carried in the current school month. */
export function currentMonthDebt(db: Database, studentId: string): number {
  return monthDebt(db, studentId, currentMonthCode());
}

/** Debt carried in every month BEFORE the current one. */
export function previousMonthsDebt(db: Database, studentId: string): number {
  const cur = monthOrder(currentMonthCode());
  return debtByMonth(db, studentId)
    .filter((m) => monthOrder(m.code) < cur)
    .reduce((s, m) => s + m.debt, 0);
}

/** Séances a student actually attended (present/late) in a school month —
 *  optionally limited to one timing. */
export function seancesPresentedInMonth(
  db: Database,
  studentId: string,
  code: string,
  sessionId?: string,
): number {
  return db.attendance.filter(
    (a) =>
      a.studentId === studentId &&
      a.status !== "absent" &&
      monthCodeForDate(a.timestamp) === code &&
      (!sessionId || a.sessionId === sessionId),
  ).length;
}

export const EXPIRY_WARNING_DAYS = 7;
export type FormationExpiryStatus = "active" | "expiring" | "expired";
export function formationExpiryStatus(expiryDate: string): FormationExpiryStatus {
  const days = daysUntil(expiryDate);
  if (days < 0) return "expired";
  if (days <= EXPIRY_WARNING_DAYS) return "expiring";
  return "active";
}

// ---- Séances: inscriptions, remaining, debt, payments ----------------------
/** The inscription ran out of TIME (monthly plan or formation over). */
export function isEnrollmentExpired(enrollment: Enrollment): boolean {
  return !!enrollment.expiryDate && daysUntil(enrollment.expiryDate) < 0;
}

/**
 * Séances still usable on one inscription. Never negative — and always 0 once
 * the inscription expired: a month that is over takes its unused séances with
 * it, exactly like the scanner, which refuses the card past the expiry date.
 */
export function remainingSeances(enrollment: Enrollment): number {
  if (isEnrollmentExpired(enrollment)) return 0;
  return Math.max(0, enrollment.paidSeances - enrollment.consumedSeances);
}

/** Séances the student paid for but lost when the inscription expired. */
export function lostSeances(enrollment: Enrollment): number {
  if (!isEnrollmentExpired(enrollment)) return 0;
  return Math.max(0, enrollment.paidSeances - enrollment.consumedSeances);
}

/** Raw difference — negative when attendance ran past what was paid for. */
export function seanceBalance(enrollment: Enrollment): number {
  return enrollment.paidSeances - enrollment.consumedSeances;
}

export function studentEnrollments(db: Database, studentId: string): Enrollment[] {
  return db.enrollments.filter((e) => e.studentId === studentId);
}

/** Total séances left across every inscription of a student. */
export function totalRemainingSeances(db: Database, studentId: string): number {
  return studentEnrollments(db, studentId).reduce((s, e) => s + remainingSeances(e), 0);
}

/** Séances the student actually attended. A manually recorded absence is a row
 *  of the attendance table too, so only present/late count as a presence. */
export function attendedSeances(db: Database, studentId: string): number {
  return db.attendance.filter((a) => a.studentId === studentId && a.status !== "absent").length;
}

export function studentPayments(db: Database, studentId: string): Payment[] {
  return db.payments
    .filter((p) => p.studentId === studentId)
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** What the student still owes = the sum of every payment's unpaid remainder. */
export function studentDebt(db: Database, studentId: string): number {
  return Math.max(
    0,
    db.payments.filter((p) => p.studentId === studentId).reduce((s, p) => s + p.rest, 0),
  );
}

/** Total debt of the school's students. */
export function totalStudentDebt(db: Database): number {
  return db.students.reduce((s, st) => s + studentDebt(db, st.id), 0);
}

// ---- Debt split by school month (M1…M11) -----------------------------------
/** Payments that still carry an unpaid remainder. */
export function studentUnpaidPayments(db: Database, studentId: string): Payment[] {
  return db.payments.filter((p) => p.studentId === studentId && p.rest > 0);
}

/** A student's outstanding debt grouped by the school month of each payment. */
export function studentDebtByMonth(db: Database, studentId: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of studentUnpaidPayments(db, studentId)) {
    const code = monthCodeForDate(p.date) ?? "M1";
    out[code] = (out[code] ?? 0) + p.rest;
  }
  return out;
}

export function studentMonthDebt(db: Database, studentId: string, code: string): number {
  return studentDebtByMonth(db, studentId)[code] ?? 0;
}

/** Debt carried from months earlier than the given one (the "arriérés"). */
export function studentPreviousMonthsDebt(db: Database, studentId: string, currentCode: string): number {
  const cur = monthOrder(currentCode);
  return Object.entries(studentDebtByMonth(db, studentId))
    .filter(([code]) => monthOrder(code) >= 0 && monthOrder(code) < cur)
    .reduce((s, [, amt]) => s + amt, 0);
}

/** Séances a student actually attended in ONE group during a school month. */
export function presentSeancesInMonth(
  db: Database,
  studentId: string,
  sessionId: string,
  code: string,
): number {
  return db.attendance.filter(
    (a) =>
      a.studentId === studentId &&
      a.sessionId === sessionId &&
      a.status !== "absent" &&
      monthCodeForDate(a.timestamp) === code,
  ).length;
}

export type EnrollmentExpiryStatus = "active" | "soon" | "expired";
/** Expiry state of one inscription — `active` when it never expires. */
export function enrollmentExpiryStatus(enrollment: Enrollment): EnrollmentExpiryStatus {
  if (!enrollment.expiryDate) return "active";
  const days = daysUntil(enrollment.expiryDate);
  if (days < 0) return "expired";
  if (days <= EXPIRY_WARNING_DAYS) return "soon";
  return "active";
}

/** The subscription (and thus the séance price) behind an inscription. */
export function enrollmentSubscription(db: Database, enrollment: Enrollment): Subscription | undefined {
  return db.subscriptions.find((s) => s.id === enrollment.subscriptionId);
}

/** Net price of one séance on this inscription, reduction applied. */
export function enrollmentUnitPrice(db: Database, enrollment: Enrollment): number {
  const sub = enrollmentSubscription(db, enrollment);
  return netPriceFor(sub?.pricePerSession ?? 0, enrollment.discount);
}

/** Human label of the module an inscription is for. */
export function enrollmentLabel(db: Database, enrollment: Enrollment): string {
  const sub = enrollmentSubscription(db, enrollment);
  if (!sub) return "—";
  const session = db.sessions.find((s) => s.id === sub.sessionId);
  if (!session) return "—";
  return session.isOpen && session.title
    ? session.title
    : `${moduleName(db, session.moduleId)} · ${groupName(db, session.groupId)}`;
}

// ---- Teacher dues ----
export function teacherUnpaidSessions(db: Database, teacherId: string) {
  return db.unpaidTeacher.filter((u) => u.teacherId === teacherId && !u.paid);
}
export function teacherUnpaidTotal(db: Database, teacherId: string): number {
  return teacherUnpaidSessions(db, teacherId).reduce((s, u) => s + u.amount, 0);
}

/** A student is "en dette" as soon as any payment left a remainder, or a
 *  registration fee is still owed. Teachers are never paid for such a student's
 *  séances until the debt is cleared. */
export function studentHasDebt(db: Database, studentId: string): boolean {
  if (studentDebt(db, studentId) > 0) return true;
  return (db.students.find((s) => s.id === studentId)?.registrationDue ?? 0) > 0;
}

/** Teacher dues that are actually payable now — the student behind them has NO
 *  outstanding debt. */
export function teacherPayableSessions(db: Database, teacherId: string) {
  return teacherUnpaidSessions(db, teacherId).filter((u) => !studentHasDebt(db, u.studentId));
}

/** Teacher dues WITHHELD because the student still owes money. They stay unpaid
 *  and reappear on the next settlement once the debt is cleared. */
export function teacherWithheldSessions(db: Database, teacherId: string) {
  return teacherUnpaidSessions(db, teacherId).filter((u) => studentHasDebt(db, u.studentId));
}

export function teacherPayableTotal(db: Database, teacherId: string): number {
  return teacherPayableSessions(db, teacherId).reduce((s, u) => s + u.amount, 0);
}
export function teacherWithheldTotal(db: Database, teacherId: string): number {
  return teacherWithheldSessions(db, teacherId).reduce((s, u) => s + u.amount, 0);
}

// ---- Money ----
/** What a subscription actually brought in: the séance purchases made on it.
 *  Attendance no longer moves money, so it is not counted here. */
export function subscriptionRevenue(db: Database, sub: Subscription): number {
  const enrollmentIds = new Set(
    db.enrollments.filter((e) => e.subscriptionId === sub.id).map((e) => e.id),
  );
  return db.payments
    .filter(
      (p) =>
        p.type === "subscription_payment" && p.enrollmentId && enrollmentIds.has(p.enrollmentId),
    )
    .reduce((s, p) => s + p.netTotal, 0);
}

export function cashBalance(db: Database, from?: Date, to?: Date): number {
  return db.cash
    .filter((c) => {
      const d = new Date(c.date);
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    })
    .reduce((s, c) => s + c.amount, 0);
}

/** Everything the school is still owed by its students (a positive number). */
export function totalDebt(db: Database): number {
  return totalStudentDebt(db);
}

export function totalRevenue(db: Database): number {
  return db.cash
    .filter((c) => c.type === "student_payment")
    .reduce((s, c) => s + c.amount, 0);
}

export function totalExpenses(db: Database): number {
  return db.expenses.reduce((s, e) => s + e.amount, 0);
}
