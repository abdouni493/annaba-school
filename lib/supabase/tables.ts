"use client";

import type { Database } from "@/lib/store/data";

/**
 * The map between the store's collections and the Postgres tables of
 * `supabase/schema.sql`.
 *
 * Every collection is listed exactly once, in DEPENDENCY ORDER: a table only
 * appears after the tables its foreign keys point at. Inserts walk the list
 * forwards and deletes walk it backwards, so a write never trips a constraint.
 *
 * Column names are spelled out rather than derived, so a stray property on a
 * pushed object can never reach PostgREST and fail the whole write.
 */

/** Keys of `Database` that hold an array of rows (i.e. everything but `school`). */
export type CollectionKey = Exclude<keyof Database, "school">;

export interface TableSpec {
  /** Postgres table name. */
  table: string;
  /** Primary-key column. */
  pk: string;
  /** The object property that carries the primary key (defaults to `id`). */
  pkField: string;
  /** Every column of the table, as object-property names. */
  fields: string[];
  /** Property -> column, only where the generic snake_case rule does not apply. */
  aliases?: Record<string, string>;
  /**
   * LES COLONNES « NOT NULL » DONT LA PROPRIÉTÉ EST FACULTATIVE, et la valeur à
   * écrire quand elle manque.
   *
   * Un champ absent devient un `null` EXPLICITE (voir `toRow`), et Postgres
   * n'applique JAMAIS le `default` d'une colonne à qui on passe null : il
   * refuse la ligne. Un versement d'élève, dont personne ne renseigne
   * `alertRead` à la création, était ainsi rejeté à chaque écriture — la caisse
   * gardait son mouvement, le versement lui-même disparaissait au rechargement,
   * et l'écran ne savait plus dire sur quel emploi du temps l'argent était
   * passé. La valeur par défaut du schéma est donc recopiée ici, et écrite.
   */
  notNull?: Record<string, unknown>;
}

/** camelCase -> snake_case, the rule every column follows unless aliased. */
export function toColumn(field: string, spec?: TableSpec): string {
  return spec?.aliases?.[field] ?? field.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/** snake_case -> camelCase. */
function toField(column: string, spec: TableSpec): string {
  const aliased = spec.aliases
    ? Object.entries(spec.aliases).find(([, col]) => col === column)?.[0]
    : undefined;
  return aliased ?? column.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// The school row is a singleton, kept apart from the collections.
// ---------------------------------------------------------------------------

export const SCHOOL_TABLE = "schools";
/** The app runs one establishment; its row always carries this id. */
export const SCHOOL_ID = "school";

export const SCHOOL_SPEC: TableSpec = {
  table: SCHOOL_TABLE,
  pk: "id",
  pkField: "id",
  fields: [
    "id", "name", "description", "phone", "email", "logo", "address",
    "articleFiscal", "registreCommerce", "nif", "nis", "registrationFee",
    "registrationFeeScope", "registrationFeeLevels", "registrationFeeClassIds",
    "registrationFeeSessionIds",
    "absencePenaltyEnabled", "absencePenaltySince", "absenceWeekStartDay",
  ],
};

// ---------------------------------------------------------------------------
// The collections, in dependency order.
// ---------------------------------------------------------------------------

export const TABLES: Record<CollectionKey, TableSpec> = {
  classCategories: {
    table: "class_categories", pk: "id", pkField: "id",
    fields: ["id", "name",
             "createdBy", "createdByName", "createdByRole"],
  },
  modules: {
    table: "modules", pk: "id", pkField: "id",
    fields: ["id", "name",
             "createdBy", "createdByName", "createdByRole"],
  },
  groups: {
    table: "class_groups", pk: "id", pkField: "id",
    fields: ["id", "name",
             "createdBy", "createdByName", "createdByRole"],
  },
  salles: {
    table: "salles", pk: "id", pkField: "id",
    fields: ["id", "name",
             "createdBy", "createdByName", "createdByRole"],
  },
  classes: {
    table: "classes", pk: "id", pkField: "id",
    fields: ["id", "type", "name", "description", "coursLevel", "year", "categoryId", "formationLevel",
             "createdBy", "createdByName", "createdByRole"],
  },
  teachers: {
    table: "teachers", pk: "id", pkField: "id",
    fields: ["id", "firstName", "lastName", "phone", "email", "paymentType",
             "monthlyAmount", "startDate", "percentage", "isPassager", "createdAt",
             "createdBy", "createdByName", "createdByRole"],
  },
  workerRoles: {
    table: "worker_roles", pk: "id", pkField: "id",
    fields: ["id", "name", "createdAt",
             "createdBy", "createdByName", "createdByRole"],
  },
  reception: {
    table: "reception_staff", pk: "id", pkField: "id",
    fields: ["id", "firstName", "lastName", "phone", "email", "paymentType",
             "startDate", "salary", "role", "rfid", "hourlyRate", "workDays",
             "hasAccount", "username", "navKeys", "actionKeys", "createdAt",
             "createdBy", "createdByName", "createdByRole"],
    notNull: { hasAccount: false },
  },
  parents: {
    table: "parents", pk: "id", pkField: "id",
    fields: ["id", "firstName", "lastName", "phone", "email", "childIds",
             "createdBy", "createdByName", "createdByRole"],
  },
  sessions: {
    table: "schedule_sessions", pk: "id", pkField: "id",
    fields: ["id", "classId", "moduleId", "groupId", "salleId", "teacherId", "days",
             "startTime", "endTime", "dayTimes", "daySalles", "classGroups", "isOpen",
             "title", "periodStart", "periodEnd", "classIds", "groupIds", "salleIds",
             "openPrice", "archivedAt",
             "createdBy", "createdByName", "createdByRole"],
  },
  subscriptions: {
    table: "subscriptions", pk: "id", pkField: "id",
    fields: ["id", "sessionId", "pricePerSession", "levelPrice", "periodMonths",
             "monthlySeances", "monthlyPrice", "schoolMonthShare", "teacherPerSeance",
             "archivedAt",
             "createdBy", "createdByName", "createdByRole"],
  },
  students: {
    table: "students", pk: "id", pkField: "id",
    fields: ["id", "registrationNumber", "firstName", "lastName", "birthDate", "phone",
             "phone2",
             "email", "rfid", "isFree", "studentCase", "freeSubscriptionIds",
             "teacherFatherId", "caseReduction",
             "unpaidTeacherIds", "schoolOnlySubscriptionIds",
             "enrollmentLevel", "enrollmentYear",
             "parentId", "subscriptionIds", "subscriptionDates",
             "subscriptionDiscounts", "registrationDue",
             "createdBy", "createdByName", "createdByRole"],
  },
  studentCredentials: {
    table: "student_credentials", pk: "student_id", pkField: "studentId",
    fields: ["studentId", "password", "updatedAt"],
  },
  enrollments: {
    table: "enrollments", pk: "id", pkField: "id",
    fields: ["id", "studentId", "subscriptionId", "paidSeances", "consumedSeances",
             "discount", "startDate", "expiryDate", "plan", "monthSeances", "balance",
             "createdAt",
             "createdBy", "createdByName", "createdByRole"],
    notNull: { balance: 0 },
  },
  payments: {
    table: "payments", pk: "id", pkField: "id",
    fields: ["id", "studentId", "enrollmentId", "subscriptionId", "monthCode",
             "seancesPurchased", "unitPrice", "grossTotal", "plan", "discountType",
             "discountValue", "netTotal", "amountPaid", "rest", "type", "paidFrom",
             "chargeId", "date", "description", "alertRead",
             "createdBy", "createdByName", "createdByRole"],
    notNull: { alertRead: false },
  },
  studentCharges: {
    table: "student_charges", pk: "id", pkField: "id",
    fields: ["id", "studentId", "name", "amount", "description", "date", "origin",
             "sourcePaymentId", "subscriptionId", "monthCode", "paidAmount", "paid",
             "paymentId", "createdAt",
             "createdBy", "createdByName", "createdByRole"],
    notNull: { origin: "manual", paidAmount: 0, paid: false },
  },
  attendance: {
    table: "attendance_records", pk: "id", pkField: "id",
    fields: ["id", "studentId", "sessionId", "timestamp", "amountDeducted", "status",
             "substituteGroup", "freePeriodId", "preStart", "waivedAmount", "noCharge",
             "createdBy", "createdByName", "createdByRole"],
    // `timestamp` is a type name in SQL — the column carries a plainer name.
    aliases: { timestamp: "occurred_at" },
  },
  absencePenalties: {
    table: "absence_penalties", pk: "id", pkField: "id",
    fields: ["id", "studentId", "subscriptionId", "sessionId", "moduleId", "periodStart",
             "periodEnd", "amount", "remainingAfter", "createdAt",
             "createdBy", "createdByName", "createdByRole"],
  },
  teacherPayments: {
    table: "teacher_payments", pk: "id", pkField: "id",
    fields: ["id", "teacherId", "amount", "method", "percentage", "studentsCount",
             "sessionsCount", "description", "details", "gross", "expenses", "acomptes",
             "childCharges", "childDebts", "months", "arrears", "board", "cashId",
             "paidAt",
             "createdBy", "createdByName", "createdByRole"],
  },
  acomptes: {
    table: "teacher_acomptes", pk: "id", pkField: "id",
    fields: ["id", "teacherId", "amount", "description", "date", "paid", "paymentId",
             "createdBy", "createdByName", "createdByRole"],
    notNull: { paid: false },
  },
  teacherExpenses: {
    table: "teacher_expenses", pk: "id", pkField: "id",
    fields: ["id", "teacherId", "name", "amount", "description", "date", "paid",
             "paymentId", "createdAt",
             "createdBy", "createdByName", "createdByRole"],
    notNull: { paid: false },
  },
  teacherChildDebts: {
    table: "teacher_child_debts", pk: "id", pkField: "id",
    fields: ["id", "teacherId", "studentId", "subscriptionId", "emploi", "monthCode", "label",
             "amount", "date", "paid", "paymentId", "createdAt",
             "createdBy", "createdByName", "createdByRole"],
    notNull: { paid: false },
  },
  absences: {
    table: "teacher_absences", pk: "id", pkField: "id",
    fields: ["id", "teacherId", "cost", "description", "date",
             "createdBy", "createdByName", "createdByRole"],
  },
  unpaidTeacher: {
    table: "unpaid_teacher_sessions", pk: "id", pkField: "id",
    fields: ["id", "teacherId", "sessionId", "studentId", "amount", "date", "paid",
             "paymentId",
             "createdBy", "createdByName", "createdByRole"],
  },
  workerShifts: {
    table: "worker_shifts", pk: "id", pkField: "id",
    fields: ["id", "workerId", "workDate", "startAt", "endAt", "minutes", "frozen",
             "paid", "paymentId", "createdAt",
             "createdBy", "createdByName", "createdByRole"],
  },
  workerAcomptes: {
    table: "worker_acomptes", pk: "id", pkField: "id",
    fields: ["id", "workerId", "amount", "description", "date", "paid", "paymentId",
             "createdBy", "createdByName", "createdByRole"],
    notNull: { paid: false },
  },
  workerAbsences: {
    table: "worker_absences", pk: "id", pkField: "id",
    fields: ["id", "workerId", "cost", "description", "date", "paid", "paymentId",
             "createdBy", "createdByName", "createdByRole"],
    notNull: { paid: false },
  },
  workerPayments: {
    table: "worker_payments", pk: "id", pkField: "id",
    fields: ["id", "workerId", "kind", "periodKeys", "shiftIds", "gross", "acomptes",
             "absences", "net", "amount", "date", "description", "cashId", "createdAt",
             "createdBy", "createdByName", "createdByRole"],
  },
  freePeriods: {
    table: "free_periods", pk: "id", pkField: "id",
    fields: ["id", "name", "description", "startDate", "endDate", "allClasses",
             "classIds", "payTeachers", "active", "createdAt",
             "createdBy", "createdByName", "createdByRole"],
  },
  moduleAbsenceRules: {
    table: "module_absence_rules", pk: "module_id", pkField: "moduleId",
    fields: ["moduleId", "enabled", "daysWindow"],
  },
  subjects: {
    table: "subjects", pk: "id", pkField: "id",
    fields: ["id", "title", "description", "image", "sessionId", "date",
             "createdBy", "createdByName", "createdByRole"],
  },
  announcements: {
    table: "announcements", pk: "id", pkField: "id",
    fields: ["id", "title", "description", "audience", "endDate", "date",
             "targetGroupIds", "includeParents",
             "createdBy", "createdByName", "createdByRole"],
  },
  categories: {
    table: "expense_categories", pk: "id", pkField: "id",
    fields: ["id", "name",
             "createdBy", "createdByName", "createdByRole"],
  },
  expenses: {
    table: "expenses", pk: "id", pkField: "id",
    fields: ["id", "name", "categoryId", "amount", "date",
             "createdBy", "createdByName", "createdByRole"],
  },
  cash: {
    table: "cash_transactions", pk: "id", pkField: "id",
    fields: ["id", "type", "amount", "date", "description",
             "createdBy", "createdByName", "createdByRole"],
  },
  notifications: {
    table: "notifications", pk: "id", pkField: "id",
    fields: ["id", "parentId", "title", "description", "date", "read", "auto",
             "createdBy", "createdByName", "createdByRole"],
  },
  coursework: {
    table: "coursework", pk: "id", pkField: "id",
    fields: ["id", "name", "type", "dates", "pricePerSession", "total", "teacherId",
             "createdBy", "createdByName", "createdByRole"],
  },
  independent: {
    table: "independent_sessions", pk: "id", pkField: "id",
    fields: ["id", "studentId", "passagerName", "itemLabel", "price", "date", "sessionId",
             "startTime", "endTime", "createdAt", "teacherPaid", "schoolShare", "teacherId",
             "alertRead",
             "createdBy", "createdByName", "createdByRole"],
    notNull: { teacherPaid: false, alertRead: false },
  },
  groupSeances: {
    table: "group_seances", pk: "id", pkField: "id",
    fields: ["id", "teacherId", "title", "description", "date", "startTime", "endTime",
             "studentsCount", "pricePerStudent", "schoolPerStudent", "cashInId",
             "cashOutId", "createdAt",
             "createdBy", "createdByName", "createdByRole"],
  },
  soloSeances: {
    table: "solo_seances", pk: "id", pkField: "id",
    fields: ["id", "teacherId", "salleId", "title", "description", "date",
             "startTime", "endTime", "attendees", "pricePerStudent",
             "schoolPerStudent", "teacherPaid", "teacherPaidAt", "cashInId",
             "cashOutId", "createdAt",
             "createdBy", "createdByName", "createdByRole"],
    // `teacher_paid` est « not null » : une séance créée « non réglée » doit
    // écrire `false` explicitement, sinon Postgres refuse la ligne.
    notNull: { teacherPaid: false, attendees: [] },
  },
};

/** Dependency order: safe for inserts, reverse it for deletes. */
export const COLLECTION_ORDER = Object.keys(TABLES) as CollectionKey[];

// ---------------------------------------------------------------------------
// Codecs
// ---------------------------------------------------------------------------

/**
 * Object -> row. Only declared columns are emitted, and `undefined` becomes an
 * explicit `null`: without it JSON serialisation would drop the key and an
 * "unset this field" edit would leave the old value in the database.
 */
export function toRow(spec: TableSpec, obj: Record<string, unknown>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const field of spec.fields) {
    const value = obj[field];
    if (value === undefined || value === null) {
      // Une colonne `not null` ne se laisse pas remplir par son `default` quand
      // on lui passe null : elle rejette la ligne entière. On écrit donc le
      // défaut nous-mêmes, et la clé reste présente — un envoi groupé exige
      // que toutes les lignes portent exactement les mêmes colonnes.
      const fallback = spec.notNull?.[field];
      row[toColumn(field, spec)] = fallback === undefined ? null : fallback;
      continue;
    }
    row[toColumn(field, spec)] = value;
  }
  return row;
}

/** Row -> object. `null` becomes `undefined`, which is what the types expect. */
export function fromRow(spec: TableSpec, row: Record<string, unknown>): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const [column, value] of Object.entries(row)) {
    if (value === null) continue;
    obj[toField(column, spec)] = value;
  }
  return obj;
}

/** The primary key of a row, as the store spells it. */
export function pkOf(spec: TableSpec, obj: Record<string, unknown>): string {
  return String(obj[spec.pkField]);
}
