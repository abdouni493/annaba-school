import type { Database } from "@/lib/store/data";
import { DAYS } from "@/lib/types";
import type {
  AttendanceRecord,
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

// ---- Emploi-du-temps months: M1, M2 … counted in SÉANCES, not in calendar --
/**
 * Months are NOT calendar months and they no longer start in September.
 *
 * Every emploi du temps counts its OWN months, and every student walks them at
 * his own pace:
 *  - the month M1 of an emploi opens on the student's FIRST présence on it,
 *  - it closes on the séance that completes the pack (`monthlySeances`),
 *  - the very next présence opens M2, and so on.
 *
 * So an emploi created in August whose pack is 4 séances, first attended in
 * September, has its M1 running from that first présence to the 4th one —
 * whatever the calendar says.
 */
export interface SchoolMonth {
  code: string;
  /** 0-based position of the month (M1 -> 0) */
  index: number;
  label: string;
  short: string;
}

/** Séances a month contains when the emploi has no monthly pack defined. */
export const DEFAULT_CYCLE_SIZE = 4;
/** How many months the month pickers offer. */
export const MONTH_CYCLE_COUNT = 12;

export function monthCycleAt(index: number): SchoolMonth {
  const i = Math.max(0, Math.round(index));
  return { code: `M${i + 1}`, index: i, label: `Mois ${i + 1}`, short: `M${i + 1}` };
}

export const SCHOOL_MONTHS: SchoolMonth[] = Array.from({ length: MONTH_CYCLE_COUNT }, (_, i) =>
  monthCycleAt(i),
);

/** "M3" -> its descriptor. Accepts any Mn, even beyond the picker's list. */
export function schoolMonthByCode(code: string): SchoolMonth | null {
  const m = /^M(\d+)$/.exec(code || "");
  return m ? monthCycleAt(Number(m[1]) - 1) : null;
}

/** Ordering index of a month code (M1 = 0, M2 = 1 …); -1 when unparsable. */
export function monthOrder(code: string): number {
  return schoolMonthByCode(code)?.index ?? -1;
}

/** "M3 · Mois 3" — the human label of a month code. */
export function monthCodeLabel(code: string): string {
  const m = schoolMonthByCode(code);
  return m ? `${m.code} · ${m.label}` : code;
}

/** Months from M1 up to (and including) the given code. */
export function schoolMonthsUpTo(code: string): SchoolMonth[] {
  const idx = monthOrder(code);
  return idx < 0 ? SCHOOL_MONTHS.slice() : SCHOOL_MONTHS.slice(0, idx + 1);
}

/** Séances one month of this emploi du temps contains. */
export function cycleSizeOf(sub?: Subscription): number {
  const n = Math.round(sub?.monthlySeances ?? 0);
  return n > 0 ? n : DEFAULT_CYCLE_SIZE;
}

/**
 * Does this attendance row move the student's month forward? A cancelled
 * séance and a "courtesy" first absence cost nothing, so they do not.
 */
export function consumesSeance(a: AttendanceRecord): boolean {
  return a.status !== "cancelled" && !a.noCharge;
}

/** Every attendance row of ONE student on ONE emploi, oldest first. */
export function sessionAttendance(
  db: Database,
  studentId: string,
  sessionId: string,
): AttendanceRecord[] {
  return db.attendance
    .filter((a) => a.studentId === studentId && a.sessionId === sessionId)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

/** …limited to the rows that actually burn a séance (they set the pace). */
export function cycleRecords(
  db: Database,
  studentId: string,
  sessionId: string,
): AttendanceRecord[] {
  return sessionAttendance(db, studentId, sessionId).filter(consumesSeance);
}

/** One month of one student on one emploi du temps. */
export interface MonthCycle {
  code: string;
  index: number;
  /** séances the month contains */
  size: number;
  /** the billable rows of that month, in order */
  records: AttendanceRecord[];
  /** how many of the `size` séances are already used */
  done: number;
  /** the month is over: its last séance has been recorded */
  complete: boolean;
  /** money the séances of that month took off the solde */
  consumed: number;
  /** money credited to that month */
  credited: number;
  /** credited − consumed. NEGATIVE = the student owes that much on that month. */
  balance: number;
  /** day the month opened (first billable séance) */
  startDate?: string;
  /** day it closed (only once complete) */
  endDate?: string;
}

/** LOCAL YYYY-MM-DD of a stored timestamp — the store writes ISO/UTC, and an
 *  evening séance would land on the wrong day if the string were just sliced. */
export function dayKeyOf(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? (iso || "").slice(0, 10) : d.toLocaleDateString("fr-CA");
}

const dayOfIso = dayKeyOf;

/**
 * The whole month history of ONE student on ONE emploi du temps: the séances
 * chunked `size` by `size`, with the money credited to each month.
 */
export function enrollmentCycles(
  db: Database,
  studentId: string,
  subscriptionId: string,
): MonthCycle[] {
  const sub = db.subscriptions.find((s) => s.id === subscriptionId);
  const size = cycleSizeOf(sub);
  const records = sub ? cycleRecords(db, studentId, sub.sessionId) : [];

  // Money is attributed to the month reception credited it to.
  const credits: Record<string, number> = {};
  for (const p of db.payments) {
    if (p.studentId !== studentId || p.subscriptionId !== subscriptionId) continue;
    const code = p.monthCode || "M1";
    credits[code] = (credits[code] ?? 0) + p.amountPaid;
  }

  const fromRecords = Math.ceil(records.length / size);
  const fromCredits = Object.keys(credits).reduce((mx, c) => Math.max(mx, monthOrder(c) + 1), 0);
  const count = Math.max(1, fromRecords, fromCredits);

  const out: MonthCycle[] = [];
  for (let i = 0; i < count; i++) {
    const slice = records.slice(i * size, i * size + size);
    const code = `M${i + 1}`;
    const consumed = slice.reduce((t, a) => t + (a.amountDeducted || 0), 0);
    const credited = credits[code] ?? 0;
    const complete = slice.length >= size;
    out.push({
      code,
      index: i,
      size,
      records: slice,
      done: slice.length,
      complete,
      consumed,
      credited,
      balance: credited - consumed,
      startDate: slice[0] ? dayOfIso(slice[0].timestamp) : undefined,
      endDate: complete ? dayOfIso(slice[slice.length - 1].timestamp) : undefined,
    });
  }
  return out;
}

/** The month a student is CURRENTLY on for one emploi (0-based index). A month
 *  whose last séance has just been recorded is closed: the next one is open. */
export function currentCycleIndex(db: Database, studentId: string, subscriptionId: string): number {
  const sub = db.subscriptions.find((s) => s.id === subscriptionId);
  if (!sub) return 0;
  const size = cycleSizeOf(sub);
  return Math.floor(cycleRecords(db, studentId, sub.sessionId).length / size);
}

export function currentCycleCode(db: Database, studentId: string, subscriptionId: string): string {
  return `M${currentCycleIndex(db, studentId, subscriptionId) + 1}`;
}

/** The month `code` of one student on one emploi — synthesised (empty) when he
 *  has not reached it yet, so every screen can still render a row for it. */
export function cycleOf(
  db: Database,
  studentId: string,
  subscriptionId: string,
  code: string,
): MonthCycle {
  const idx = Math.max(0, monthOrder(code));
  const all = enrollmentCycles(db, studentId, subscriptionId);
  if (all[idx]) return all[idx];
  const sub = db.subscriptions.find((s) => s.id === subscriptionId);
  return {
    code: `M${idx + 1}`,
    index: idx,
    size: cycleSizeOf(sub),
    records: [],
    done: 0,
    complete: false,
    consumed: 0,
    credited: 0,
    balance: 0,
  };
}

/** The month code an attendance row falls in, for its own emploi du temps. */
export function monthCodeOfAttendance(db: Database, record: AttendanceRecord): string | null {
  const sub = db.subscriptions.find((s) => s.sessionId === record.sessionId);
  if (!sub) return null;
  const size = cycleSizeOf(sub);
  const rows = cycleRecords(db, record.studentId, record.sessionId);
  const pos = rows.findIndex((a) => a.id === record.id);
  return pos < 0 ? null : `M${Math.floor(pos / size) + 1}`;
}

/** Current month of a whole GROUP: the month most of its students are on, so
 *  the présence sheet opens where the work actually is. */
export function sessionCurrentMonthCode(db: Database, sessionId: string): string {
  const sub = db.subscriptions.find((s) => s.sessionId === sessionId);
  if (!sub) return "M1";
  const students = sessionEnrolledStudents(db, sessionId);
  if (students.length === 0) return "M1";
  const tally = new Map<number, number>();
  for (const stu of students) {
    const i = currentCycleIndex(db, stu.id, sub.id);
    tally.set(i, (tally.get(i) ?? 0) + 1);
  }
  let best = 0;
  let bestCount = -1;
  for (const [i, n] of tally) {
    if (n > bestCount || (n === bestCount && i < best)) {
      best = i;
      bestCount = n;
    }
  }
  return `M${best + 1}`;
}

/** Neutral fallback for the few screens that group loose money by month. */
export function currentMonthCode(): string {
  return "M1";
}

// ---- Solde (money left on ONE emploi du temps) ------------------------------
/** What is left on an inscription. Negative = the student owes that much. */
export function enrollmentBalance(enrollment?: Enrollment): number {
  return Math.round(enrollment?.balance ?? 0);
}

export function studentEnrollmentFor(
  db: Database,
  studentId: string,
  subscriptionId: string,
): Enrollment | undefined {
  return db.enrollments.find(
    (e) => e.studentId === studentId && e.subscriptionId === subscriptionId,
  );
}

/** Solde of ONE student on ONE emploi du temps. */
export function soldFor(db: Database, studentId: string, subscriptionId: string): number {
  return enrollmentBalance(studentEnrollmentFor(db, studentId, subscriptionId));
}

export type SoldStatus = "ok" | "low" | "empty" | "debt";
/** How a solde reads on the cards: healthy, about to run out, empty, in debt. */
export function soldStatus(balance: number, unitPrice: number): SoldStatus {
  if (balance < 0) return "debt";
  if (balance === 0) return "empty";
  if (unitPrice > 0 && balance < unitPrice * 2) return "low";
  return "ok";
}

/** Everything a student owes across his emplois du temps (soldes in the red). */
export function studentSoldDebt(db: Database, studentId: string): number {
  return db.enrollments
    .filter((e) => e.studentId === studentId)
    .reduce((t, e) => t + Math.max(0, -enrollmentBalance(e)), 0);
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

/**
 * What the student still owes, all emplois du temps together: every solde in
 * the red, plus whatever an old purchase left unpaid.
 */
export function studentDebt(db: Database, studentId: string): number {
  const rests = db.payments
    .filter((p) => p.studentId === studentId)
    .reduce((s, p) => s + p.rest, 0);
  return Math.max(0, rests + studentSoldDebt(db, studentId));
}

/** Total debt of the school's students. */
export function totalStudentDebt(db: Database): number {
  return db.students.reduce((s, st) => s + studentDebt(db, st.id), 0);
}

// ---- Debt split by month (each emploi counts its own M1, M2 …) --------------
/** Payments that still carry an unpaid remainder. */
export function studentUnpaidPayments(db: Database, studentId: string): Payment[] {
  return db.payments.filter((p) => p.studentId === studentId && p.rest > 0);
}

/** One emploi du temps a student is behind on, for ONE of its months. */
export interface SoldDebtRow {
  subscriptionId: string;
  sessionId: string;
  label: string;
  code: string;
  debt: number;
}

/**
 * Every month, of every emploi, the student is in the red on. Because months
 * are per-emploi, "M2" here means "the 2nd month OF THAT emploi" — two rows
 * with the same code may well cover totally different dates.
 */
export function studentSoldDebtRows(db: Database, studentId: string): SoldDebtRow[] {
  const student = db.students.find((s) => s.id === studentId);
  if (!student) return [];
  const out: SoldDebtRow[] = [];
  for (const subId of student.subscriptionIds) {
    const sub = db.subscriptions.find((s) => s.id === subId);
    if (!sub) continue;
    for (const cycle of enrollmentCycles(db, studentId, subId)) {
      if (cycle.balance >= 0) continue;
      out.push({
        subscriptionId: subId,
        sessionId: sub.sessionId,
        label: subscriptionLabel(db, sub),
        code: cycle.code,
        debt: -cycle.balance,
      });
    }
  }
  return out;
}

/** A student's outstanding debt grouped by month code, emplois merged. */
export function studentDebtByMonth(db: Database, studentId: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of studentUnpaidPayments(db, studentId)) {
    const code = p.monthCode || "M1";
    out[code] = (out[code] ?? 0) + p.rest;
  }
  for (const row of studentSoldDebtRows(db, studentId)) {
    out[row.code] = (out[row.code] ?? 0) + row.debt;
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

/** Debt a student carries on OTHER emplois than the one being looked at. */
export function studentOtherSoldDebt(
  db: Database,
  studentId: string,
  exceptSubscriptionId: string,
): number {
  return studentSoldDebtRows(db, studentId)
    .filter((r) => r.subscriptionId !== exceptSubscriptionId)
    .reduce((s, r) => s + r.debt, 0);
}

/** Séances a student attended in ONE emploi during ONE of its months. */
export function presentSeancesInMonth(
  db: Database,
  studentId: string,
  sessionId: string,
  code: string,
): number {
  const sub = db.subscriptions.find((s) => s.sessionId === sessionId);
  if (!sub) return 0;
  return cycleOf(db, studentId, sub.id, code).records.filter((a) => a.status !== "absent").length;
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

// ---- Student registration numbers ------------------------------------------
/** "00001" — the number printed on the card and searched from every roster. */
export function formatRegistrationNumber(n: number): string {
  return String(Math.max(1, Math.round(n))).padStart(5, "0");
}

/** The number the NEXT student created will carry. Numbering starts at 00001. */
export function nextRegistrationNumber(db: Database): string {
  const max = db.students.reduce((top, s) => {
    const n = Number.parseInt(s.registrationNumber ?? "", 10);
    return Number.isFinite(n) && n > top ? n : top;
  }, 0);
  return formatRegistrationNumber(max + 1);
}

/** The number to show for a student — falls back on his rank in the list so a
 *  seeded student without one still reads as a number. */
export function registrationNumberOf(db: Database, student: Student): string {
  if (student.registrationNumber) return student.registrationNumber;
  const idx = db.students.findIndex((s) => s.id === student.id);
  return formatRegistrationNumber(idx + 1);
}

/** One search box for the rosters: full name, phone, or registration number
 *  (typing "12" finds 00012). */
export function studentMatches(db: Database, student: Student, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const num = registrationNumberOf(db, student);
  return (
    `${student.firstName} ${student.lastName}`.toLowerCase().includes(q) ||
    `${student.lastName} ${student.firstName}`.toLowerCase().includes(q) ||
    (student.phone ?? "").includes(q) ||
    num.includes(q) ||
    num.replace(/^0+/, "").includes(q.replace(/^0+/, ""))
  );
}

// ---- Student billing case labels -------------------------------------------
/** Short label of a student's billing case, shown next to his solde. */
export function studentCaseLabel(student: Student): string {
  switch (student.studentCase) {
    case "special":
      return "Cas spécial · gratuit";
    case "teacher_child":
      return "Fils d'enseignant";
    case "reduction":
      return "Réduction";
    case "school_only":
      return "École seule";
    default:
      return "";
  }
}

/** Tone the case badge takes on the présence sheet. */
export function studentCaseTone(student: Student): "success" | "warning" | "primary" | "neutral" {
  switch (student.studentCase) {
    case "special":
      return "success";
    case "teacher_child":
      return "primary";
    case "reduction":
      return "warning";
    case "school_only":
      return "warning";
    default:
      return "neutral";
  }
}

// ---- Séance slots of one month ---------------------------------------------
/**
 * The séances the présence sheet prints as columns for ONE student, ONE emploi
 * and ONE of its months: the billable rows of that month plus the annulées that
 * happened inside its window, in the order they were recorded. The sheet then
 * pads to `cycleSizeOf(sub)` so an untouched month still shows its N columns.
 */
export function cycleSlots(
  db: Database,
  studentId: string,
  subscriptionId: string,
  code: string,
): AttendanceRecord[] {
  const sub = db.subscriptions.find((s) => s.id === subscriptionId);
  if (!sub) return [];
  const cycles = enrollmentCycles(db, studentId, subscriptionId);
  const idx = Math.max(0, monthOrder(code));
  const cycle = cycles[idx];
  const all = sessionAttendance(db, studentId, sub.sessionId);
  const billable = new Set((cycle?.records ?? []).map((r) => r.id));

  // Window: right after the last séance of the previous month, up to the last
  // séance of this one (or the newest row while the month is still open).
  const prev = cycles[idx - 1];
  const prevLast = prev?.records[prev.records.length - 1]?.id;
  const from = prevLast ? all.findIndex((a) => a.id === prevLast) + 1 : 0;
  const lastId = cycle?.complete ? cycle.records[cycle.records.length - 1]?.id : undefined;
  const to = lastId ? all.findIndex((a) => a.id === lastId) + 1 : all.length;

  return all.slice(from, Math.max(from, to)).filter((a) => billable.has(a.id) || !consumesSeance(a));
}

/** How many séance columns a month of this emploi shows. */
export function slotCountFor(
  db: Database,
  subscriptionId: string,
  studentIds: string[],
  code: string,
): number {
  const sub = db.subscriptions.find((s) => s.id === subscriptionId);
  const base = cycleSizeOf(sub);
  return studentIds.reduce(
    (mx, id) => Math.max(mx, cycleSlots(db, id, subscriptionId, code).length),
    base,
  );
}

/** The row written for ONE student on ONE emploi on ONE day, if any. */
export function attendanceOn(
  db: Database,
  studentId: string,
  sessionId: string,
  date: string,
): AttendanceRecord | undefined {
  return db.attendance.find(
    (a) => a.studentId === studentId && a.sessionId === sessionId && dayKeyOf(a.timestamp) === date,
  );
}
