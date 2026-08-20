import type { Database } from "@/lib/store/data";
import { DAYS } from "@/lib/types";
import type {
  AttendanceRecord,
  CoursLevel,
  Day,
  DayTime,
  Enrollment,
  GroupSeance,
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

// ---- Horaires jour par jour ------------------------------------------------
/**
 * The hours an emploi du temps runs on a GIVEN day.
 *
 * An emploi may run at different hours depending on the day — Samedi 08:00 and
 * Mardi 14:00 on the same module. `dayTimes` holds those overrides and
 * `startTime`/`endTime` remain the default, so a timing that keeps the same
 * hours all week stores nothing extra.
 */
export function sessionTimesOn(session: ScheduleSession, day?: Day): DayTime {
  const override = day ? session.dayTimes?.[day] : undefined;
  return {
    startTime: override?.startTime || session.startTime,
    endTime: override?.endTime || session.endTime,
  };
}

/** "08:00 – 10:00" for one day, or every distinct pair when no day is given. */
export function sessionTimeLabel(session: ScheduleSession, day?: Day): string {
  if (day) {
    const { startTime, endTime } = sessionTimesOn(session, day);
    return `${startTime} – ${endTime}`;
  }
  const seen = new Set<string>();
  for (const d of session.days ?? []) {
    const { startTime, endTime } = sessionTimesOn(session, d);
    seen.add(`${startTime} – ${endTime}`);
  }
  if (seen.size === 0) return `${session.startTime} – ${session.endTime}`;
  return [...seen].join(" · ");
}

/** Does the emploi keep the same hours every day it runs? */
export function hasUniformTimes(session: ScheduleSession): boolean {
  const seen = new Set<string>();
  for (const d of session.days ?? []) {
    const { startTime, endTime } = sessionTimesOn(session, d);
    seen.add(`${startTime}-${endTime}`);
  }
  return seen.size <= 1;
}

/** "08:30" -> 510. Anything unparsable sorts first, at 0. */
export function minutesOf(time: string): number {
  const [h, m] = (time || "").split(":");
  return (Number(h) || 0) * 60 + (Number(m) || 0);
}

/** Do two half-open [start, end) ranges overlap? Touching ends do NOT clash:
 *  a room frees at 10:00 and the next cours may start at 10:00. */
export function timesOverlap(a: DayTime, b: DayTime): boolean {
  return minutesOf(a.startTime) < minutesOf(b.endTime) && minutesOf(b.startTime) < minutesOf(a.endTime);
}

/**
 * The days on which two emplois du temps collide in time — used to tell the
 * desk which salle is already taken before it picks one.
 */
export function clashingDays(
  a: { days: Day[]; startTime: string; endTime: string; dayTimes?: Partial<Record<Day, DayTime>> },
  b: ScheduleSession,
): Day[] {
  const shared = (a.days ?? []).filter((d) => (b.days ?? []).includes(d));
  return shared.filter((d) =>
    timesOverlap(sessionTimesOn(a as ScheduleSession, d), sessionTimesOn(b, d)),
  );
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

/**
 * What ONE séance of a subscription costs the SCHOOL side of the split:
 * `part école du mois ÷ séances du mois`. With a month at 2000 DA over 4
 * séances of which the school keeps 800, that is 200 DA — not 500.
 *
 * Falls back on the ordinary séance price when the emploi carries no monthly
 * split at all (there is then nothing to take the school's part out of).
 */
export function schoolPerSeanceOf(sub?: Subscription): number {
  if (!sub) return 0;
  const n = sub.monthlySeances ?? 0;
  if (n <= 0) return Math.max(0, Math.round(sub.pricePerSession ?? 0));
  return Math.max(0, Math.round(schoolMonthShareOf(sub) / n));
}

/**
 * The LIST price of one séance for one student — before his own reduction.
 *
 * Everybody pays the emploi's séance price, with ONE exception: an
 * « école seule » student pays only what the school keeps, because the teacher
 * is deliberately not paid for him. Charging him the full price would collect
 * a teacher's share nobody is ever going to hand over.
 */
export function studentListPrice(
  student: Student | undefined,
  sub: Subscription | undefined,
  fallback = 0,
): number {
  const base = Math.max(0, Math.round(sub?.pricePerSession ?? fallback));
  if (!student || !sub) return base;
  if (student.studentCase !== "school_only") return base;
  const schoolPart = schoolPerSeanceOf(sub);
  return schoolPart > 0 ? schoolPart : base;
}

/** What a full month of an emploi costs one student — his séance price × the
 *  séances of the pack, or the pack price when he pays the ordinary tariff. */
export function studentMonthPrice(student: Student | undefined, sub?: Subscription): number {
  if (!sub) return 0;
  if (student?.studentCase === "school_only") {
    return Math.max(0, Math.round(schoolMonthShareOf(sub)));
  }
  return monthlyPriceOf(sub) || Math.round((sub.pricePerSession ?? 0) * cycleSizeOf(sub));
}

/** Net price of one séance for a given student on a given subscription. */
export function studentSeancePrice(student: Student, sub: Subscription): number {
  return netPriceFor(studentListPrice(student, sub), student.subscriptionDiscounts?.[sub.id]);
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
  /**
   * Séances of that month the student was NOT part of — he was registered
   * after they had been held. 0 on an ordinary month, `startSlot` on the month
   * he arrived on, and the whole `size` on a month that ran before him.
   * What he can still attend is therefore `size - lead`.
   */
  lead: number;
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
 * Where ONE student's history starts on ONE emploi du temps.
 *
 * A child registered while the group is on its 2nd month, 3rd séance, does not
 * start the emploi at M1 · séance 1: the séances held before him were never
 * his. `subscriptionDates` carries that arrival point, and every month
 * calculation offsets his séances by it.
 */
export interface EnrollmentStart {
  /** 0-based month he came in on (M2 -> 1) */
  monthIndex: number;
  /** 0-based séance of that month he came in on (séance 3 -> 2) */
  slotIndex: number;
  /** séances of the emploi that ran before him: monthIndex × size + slotIndex */
  offset: number;
}

/** The arrival point of a student on an emploi — M1 · séance 1 when unmarked. */
export function enrollmentStart(
  db: Database,
  studentId: string,
  subscriptionId: string,
): EnrollmentStart {
  const size = cycleSizeOf(db.subscriptions.find((s) => s.id === subscriptionId));
  const dates = db.students.find((s) => s.id === studentId)?.subscriptionDates?.[subscriptionId];
  const month = Math.max(0, monthOrder(dates?.joinMonthCode || "M1"));
  const slot = Math.max(0, Math.round(dates?.joinSlotIndex ?? 0));
  // A slot spilling past the pack simply belongs to the month after it.
  const offset = month * size + slot;
  return { monthIndex: Math.floor(offset / size), slotIndex: offset % size, offset };
}

/**
 * The whole month history of ONE student on ONE emploi du temps: the séances
 * chunked `size` by `size`, with the money credited to each month.
 *
 * The chunking starts at his arrival point, not at séance 1: a student who came
 * in on M2 · séance 3 has his very first présence recorded there, and the two
 * séances that opened M2 are marked as never his (`lead`).
 */
export function enrollmentCycles(
  db: Database,
  studentId: string,
  subscriptionId: string,
): MonthCycle[] {
  const sub = db.subscriptions.find((s) => s.id === subscriptionId);
  const size = cycleSizeOf(sub);
  const records = sub ? cycleRecords(db, studentId, sub.sessionId) : [];
  const start = enrollmentStart(db, studentId, subscriptionId);

  // Money is attributed to the month reception credited it to.
  const credits: Record<string, number> = {};
  for (const p of db.payments) {
    if (p.studentId !== studentId || p.subscriptionId !== subscriptionId) continue;
    const code = p.monthCode || "M1";
    credits[code] = (credits[code] ?? 0) + p.amountPaid;
  }

  const fromRecords = Math.ceil((start.offset + records.length) / size);
  const fromCredits = Object.keys(credits).reduce((mx, c) => Math.max(mx, monthOrder(c) + 1), 0);
  const count = Math.max(1, start.monthIndex + 1, fromRecords, fromCredits);

  const clamp = (n: number) => Math.min(Math.max(n, 0), records.length);
  const out: MonthCycle[] = [];
  for (let i = 0; i < count; i++) {
    // What the month holds for HIM: the whole pack, minus the séances that ran
    // before he arrived (all of them on a month he was not there for).
    const lead = i < start.monthIndex ? size : i === start.monthIndex ? start.slotIndex : 0;
    const slice = records.slice(clamp(i * size - start.offset), clamp((i + 1) * size - start.offset));
    const code = `M${i + 1}`;
    const consumed = slice.reduce((t, a) => t + (a.amountDeducted || 0), 0);
    const credited = credits[code] ?? 0;
    const complete = size - lead > 0 && slice.length >= size - lead;
    out.push({
      code,
      index: i,
      size,
      lead,
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
 *  whose last séance has just been recorded is closed: the next one is open.
 *  A student registered mid-course starts on the month he came in on, even
 *  before his first présence. */
export function currentCycleIndex(db: Database, studentId: string, subscriptionId: string): number {
  const sub = db.subscriptions.find((s) => s.id === subscriptionId);
  if (!sub) return 0;
  const size = cycleSizeOf(sub);
  const { offset } = enrollmentStart(db, studentId, subscriptionId);
  return Math.floor((offset + cycleRecords(db, studentId, sub.sessionId).length) / size);
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
    lead: 0,
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
 *  the présence sheet opens where the work actually is. `exceptStudentId` is
 *  left out of the vote — the one being registered must not decide where the
 *  group stands. */
export function sessionCurrentMonthCode(
  db: Database,
  sessionId: string,
  exceptStudentId?: string,
): string {
  const sub = db.subscriptions.find((s) => s.sessionId === sessionId);
  if (!sub) return "M1";
  const students = sessionEnrolledStudents(db, sessionId).filter(
    (s) => s.id !== exceptStudentId,
  );
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

/**
 * Every emploi du temps a student has EVER been on — the ones he follows today
 * plus the ones he has been taken off. A désinscription only removes him from
 * the roster: his présences, ses paiements et son solde restent, so every
 * history screen reads this list rather than `subscriptionIds`.
 */
export function studentSubscriptionHistory(db: Database, student: Student): string[] {
  const ids = new Set(student.subscriptionIds);
  for (const id of Object.keys(student.subscriptionDates ?? {})) ids.add(id);
  for (const e of db.enrollments) if (e.studentId === student.id) ids.add(e.subscriptionId);
  return [...ids].filter((id) => db.subscriptions.some((s) => s.id === id));
}

/** The emplois he has LEFT — those in his history he no longer follows. */
export function studentPastSubscriptions(db: Database, student: Student): string[] {
  return studentSubscriptionHistory(db, student).filter(
    (id) => !student.subscriptionIds.includes(id),
  );
}

/** The day a student was taken off an emploi du temps, when he was. */
export function unsubscribedAtOf(
  db: Database,
  studentId: string,
  subscriptionId: string,
): string | undefined {
  const student = db.students.find((s) => s.id === studentId);
  if (!student || student.subscriptionIds.includes(subscriptionId)) return undefined;
  return student.subscriptionDates?.[subscriptionId]?.unsubscribedAt;
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
  // The emplois he LEFT are included: leaving a group never cancels what is
  // still owed on it, and the fiche must keep showing that money.
  for (const subId of studentSubscriptionHistory(db, student)) {
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
  // A month that ran before he was registered holds nothing of his.
  if (idx < enrollmentStart(db, studentId, subscriptionId).monthIndex) return [];
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

/**
 * Columns of that month a student was not there for — they are printed blank
 * and never count as "pas encore pointé": the séances simply are not his.
 */
export function cycleLead(
  db: Database,
  studentId: string,
  subscriptionId: string,
  code: string,
): number {
  const idx = Math.max(0, monthOrder(code));
  const { monthIndex, slotIndex } = enrollmentStart(db, studentId, subscriptionId);
  if (idx < monthIndex) return cycleSizeOf(db.subscriptions.find((s) => s.id === subscriptionId));
  return idx === monthIndex ? slotIndex : 0;
}

/** Is the student part of that month of the emploi? A child registered on M2
 *  never appears on M1 — he was not there. */
export function enrolledInMonth(
  db: Database,
  studentId: string,
  subscriptionId: string,
  code: string,
): boolean {
  return (
    Math.max(0, monthOrder(code)) >= enrollmentStart(db, studentId, subscriptionId).monthIndex
  );
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
    (mx, id) =>
      Math.max(
        mx,
        cycleLead(db, id, subscriptionId, code) + cycleSlots(db, id, subscriptionId, code).length,
      ),
    base,
  );
}

/** The days a GROUP actually held a séance during one of its months, oldest
 *  first — the séances the sheet numbers S1, S2, S3 … */
export function sessionMonthDays(
  db: Database,
  subscriptionId: string,
  code: string,
  exceptStudentId?: string,
): string[] {
  const sub = db.subscriptions.find((s) => s.id === subscriptionId);
  if (!sub) return [];
  const days = new Set<string>();
  for (const student of sessionEnrolledStudents(db, sub.sessionId)) {
    if (student.id === exceptStudentId) continue;
    for (const rec of cycleSlots(db, student.id, subscriptionId, code)) {
      days.add(dayKeyOf(rec.timestamp));
    }
  }
  return [...days].sort();
}

/**
 * Where a student registered on `date` comes into an emploi du temps: the month
 * the GROUP is living, and the séance of that month held that day — the next
 * one when nothing has been pointed yet. Registering during M2 · séance 3 gives
 * exactly `{ monthCode: "M2", slotIndex: 2 }`.
 */
export function joinPointFor(
  db: Database,
  subscriptionId: string,
  date: string,
  /** the student being registered — his own (empty) history must not count */
  exceptStudentId?: string,
): { monthCode: string; slotIndex: number } {
  const sub = db.subscriptions.find((s) => s.id === subscriptionId);
  if (!sub) return { monthCode: "M1", slotIndex: 0 };
  const size = cycleSizeOf(sub);
  const code = sessionCurrentMonthCode(db, sub.sessionId, exceptStudentId);
  const days = sessionMonthDays(db, subscriptionId, code, exceptStudentId);
  const held = days.indexOf(date);
  // Already pointed today: he joins THAT séance. Otherwise the next one.
  const slot = held >= 0 ? held : days.length;
  const offset = Math.max(0, monthOrder(code)) * size + slot;
  return { monthCode: `M${Math.floor(offset / size) + 1}`, slotIndex: offset % size };
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


// ---- Séances libres de groupe ----------------------------------------------
/** Everything a "séance libre de groupe" is worth, from the three numbers
 *  reception typed. Never negative: the school's part is capped at the price. */
export interface GroupSeanceTotals {
  students: number;
  pricePerStudent: number;
  schoolPerStudent: number;
  /** what ONE student earns the teacher */
  teacherPerStudent: number;
  /** élèves × prix élève */
  total: number;
  /** élèves × part école */
  schoolTotal: number;
  /** élèves × part enseignant — what the fiche de paie pays */
  teacherTotal: number;
}

export function groupSeanceTotals(seance: {
  studentsCount: number;
  pricePerStudent: number;
  schoolPerStudent: number;
}): GroupSeanceTotals {
  const students = Math.max(0, Math.round(seance.studentsCount || 0));
  const price = Math.max(0, Math.round(seance.pricePerStudent || 0));
  const school = Math.min(Math.max(0, Math.round(seance.schoolPerStudent || 0)), price);
  const teacherPer = price - school;
  return {
    students,
    pricePerStudent: price,
    schoolPerStudent: school,
    teacherPerStudent: teacherPer,
    total: students * price,
    schoolTotal: students * school,
    teacherTotal: students * teacherPer,
  };
}

/** The séances libres de groupe of one teacher, most recent first. */
export function teacherGroupSeances(db: Database, teacherId: string): GroupSeance[] {
  return db.groupSeances
    .filter((g) => g.teacherId === teacherId)
    .sort((a, b) => `${b.date}${b.createdAt}`.localeCompare(`${a.date}${a.createdAt}`));
}

/** What the séances libres de groupe have paid a teacher in total. */
export function teacherGroupSeanceTotal(db: Database, teacherId: string): number {
  return teacherGroupSeances(db, teacherId).reduce(
    (s, g) => s + groupSeanceTotals(g).teacherTotal,
    0,
  );
}

/** Readable hours of a séance libre de groupe. */
export function groupSeanceTimeLabel(g: GroupSeance): string {
  return `${g.startTime || "--:--"} → ${g.endTime || "--:--"}`;
}
