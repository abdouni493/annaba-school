import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  COLLECTION_ORDER,
  SCHOOL_SPEC,
  TABLES,
  fromRow,
  toColumn,
  toRow,
  type TableSpec,
} from "@/lib/supabase/tables";

/**
 * The store talks to Postgres through the column map in `lib/supabase/tables.ts`.
 * A single misspelt column there would only surface at runtime, as a write that
 * silently fails, so the map is checked against the real DDL here.
 */

const sql = fs.readFileSync(
  path.join(process.cwd(), "supabase", "schema.sql"),
  "utf8",
);

/** Column names of one `create table` block of the schema. */
function columnsOf(table: string): string[] {
  const header = new RegExp(`create table if not exists public\\.${table}\\s*\\(`, "i");
  const start = sql.search(header);
  expect(start, `table ${table} is missing from supabase/schema.sql`).toBeGreaterThan(-1);

  const open = sql.indexOf("(", start);
  let depth = 0;
  let end = open;
  for (let i = open; i < sql.length; i++) {
    if (sql[i] === "(") depth++;
    else if (sql[i] === ")") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }

  return sql
    .slice(open + 1, end)
    .split("\n")
    .map((line) => line.replace(/--.*$/, "").trim())
    .filter(Boolean)
    .map((line) => line.split(/\s+/)[0])
    .filter((word) => /^[a-z_][a-z0-9_]*$/.test(word))
    // table-level clauses, not columns
    .filter((word) => !["unique", "primary", "foreign", "check", "constraint"].includes(word));
}

const specs: [string, TableSpec][] = [
  ["school", SCHOOL_SPEC],
  ...COLLECTION_ORDER.map((key) => [key, TABLES[key]] as [string, TableSpec]),
];

describe("the column map matches supabase/schema.sql", () => {
  it("covers every collection of the store exactly once", () => {
    const tables = specs.map(([, spec]) => spec.table);
    expect(new Set(tables).size).toBe(tables.length);
    expect(COLLECTION_ORDER.length).toBe(40);
  });

  for (const [key, spec] of specs) {
    it(`${key} -> ${spec.table}`, () => {
      const columns = columnsOf(spec.table);

      for (const field of spec.fields) {
        expect(columns, `${spec.table}.${toColumn(field, spec)} (from "${field}")`).toContain(
          toColumn(field, spec),
        );
      }

      // The other way round too: a column the map forgot would never be read.
      for (const column of columns) {
        expect(spec.fields.map((f) => toColumn(f, spec)), `${spec.table}.${column}`).toContain(
          column,
        );
      }

      expect(columns).toContain(spec.pk);
      expect(spec.fields).toContain(spec.pkField);
      expect(toColumn(spec.pkField, spec)).toBe(spec.pk);
    });
  }
});

describe("row codec", () => {
  it("round-trips an object, and turns undefined into an explicit null", () => {
    const spec = TABLES.teachers;
    const teacher = {
      id: "tea-1",
      firstName: "Karim",
      lastName: "Bensalah",
      phone: "0550",
      email: "k@example.dz",
      paymentType: "percentage",
      percentage: 40,
      monthlyAmount: undefined,
    };

    const row = toRow(spec, teacher);
    expect(row).toMatchObject({
      id: "tea-1",
      first_name: "Karim",
      payment_type: "percentage",
      percentage: 40,
    });
    // Not merely absent: clearing a field has to reach the database.
    expect(row).toHaveProperty("monthly_amount", null);
    expect(row).toHaveProperty("start_date", null);

    const back = fromRow(spec, row);
    expect(back).toEqual({
      id: "tea-1",
      firstName: "Karim",
      lastName: "Bensalah",
      phone: "0550",
      email: "k@example.dz",
      paymentType: "percentage",
      percentage: 40,
    });
  });

  it("keeps the aliased attendance timestamp on both legs", () => {
    const spec = TABLES.attendance;
    const row = toRow(spec, {
      id: "att-1",
      studentId: "stu-1",
      sessionId: "ses-1",
      timestamp: "2026-08-19T10:00:00.000Z",
      amountDeducted: 600,
      status: "present",
    });
    expect(row.occurred_at).toBe("2026-08-19T10:00:00.000Z");
    expect(row).not.toHaveProperty("timestamp");
    expect(fromRow(spec, row).timestamp).toBe("2026-08-19T10:00:00.000Z");
  });
});

/**
 * LES COLONNES « NOT NULL » QUI PEUVENT RECEVOIR UN CHAMP ABSENT.
 *
 * `toRow` transforme un champ non renseigné en `null` EXPLICITE — il le faut,
 * sans quoi effacer une valeur ne l'effacerait jamais en base. Mais Postgres
 * n'applique pas le `default` d'une colonne à qui on passe null : il refuse la
 * ligne entière, et l'écriture est perdue sans que l'écran s'en aperçoive.
 *
 * C'est exactement ce qui arrivait aux versements des élèves : personne ne
 * renseigne `alertRead` à la création, `alert_read` est `not null`, et CHAQUE
 * versement était rejeté. La caisse gardait son mouvement — elle n'a pas de
 * contrainte — mais le versement disparaissait au rechargement, et plus rien ne
 * pouvait dire sur quel emploi du temps l'argent était passé.
 *
 * Ce test croise donc les trois sources : le DDL (la colonne est-elle `not
 * null` ?), `lib/types.ts` (la propriété est-elle facultative ?) et la carte
 * des colonnes (une valeur de repli est-elle déclarée ?).
 */

const types = fs.readFileSync(path.join(process.cwd(), "lib", "types.ts"), "utf8");

/** Les colonnes `not null` d'une table, la clé primaire comprise. */
function notNullColumnsOf(table: string): Set<string> {
  const start = sql.indexOf(`create table if not exists public.${table} (`);
  expect(start, `table ${table} is missing from supabase/schema.sql`).toBeGreaterThan(-1);
  const open = sql.indexOf("(", start);
  let depth = 0;
  let end = open;
  for (let i = open; i < sql.length; i++) {
    if (sql[i] === "(") depth++;
    else if (sql[i] === ")") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const out = new Set<string>();
  for (const raw of sql.slice(open + 1, end).split("\n")) {
    const line = raw.replace(/--.*$/, "").trim();
    if (!line || !/\bnot null\b/i.test(line)) continue;
    const name = line.split(/\s+/)[0];
    if (/^[a-z_][a-z0-9_]*$/.test(name)) out.add(name);
  }
  return out;
}

/** Les propriétés facultatives d'une interface de `lib/types.ts`. */
function optionalFieldsOf(iface: string): Set<string> {
  const m = new RegExp(`export interface ${iface}\\b[^{]*\\{([\\s\\S]*?)\\n\\}`).exec(types);
  expect(m, `interface ${iface} is missing from lib/types.ts`).not.toBeNull();
  return new Set([...m![1].matchAll(/^\s*(\w+)\?:/gm)].map((x) => x[1]));
}

/** La collection du store -> l'interface qui la décrit. */
const INTERFACES: Record<string, string> = {
  classCategories: "ClassCategory", modules: "Module", groups: "Group",
  salles: "Salle", classes: "SchoolClass", teachers: "Teacher",
  workerRoles: "WorkerJobRole", reception: "ReceptionStaff", parents: "Parent",
  sessions: "ScheduleSession", subscriptions: "Subscription", students: "Student",
  studentCredentials: "StudentCredential", enrollments: "Enrollment",
  payments: "Payment", studentCharges: "StudentCharge",
  attendance: "AttendanceRecord", absencePenalties: "AbsencePenalty",
  teacherPayments: "TeacherPayment", acomptes: "TeacherAcompte",
  teacherExpenses: "TeacherExpense", teacherChildDebts: "TeacherChildDebt",
  absences: "TeacherAbsence", unpaidTeacher: "UnpaidTeacherSession",
  workerShifts: "WorkerShift", workerAcomptes: "WorkerAcompte",
  workerAbsences: "WorkerAbsence", workerPayments: "WorkerPayment",
  freePeriods: "FreePeriod", moduleAbsenceRules: "ModuleAbsenceRule",
  subjects: "Subject", announcements: "Announcement",
  categories: "ExpenseCategory", expenses: "Expense", cash: "CashTransaction",
  notifications: "Notification", coursework: "Coursework",
  independent: "IndependentSession", groupSeances: "GroupSeance",
  soloSeances: "SoloSeance",
};

describe("no write can be refused for a not-null column", () => {
  it("names an interface for every collection", () => {
    expect(Object.keys(INTERFACES).sort()).toEqual([...COLLECTION_ORDER].sort());
  });

  for (const key of COLLECTION_ORDER) {
    it(`${key} declares a fallback for every optional not-null column`, () => {
      const spec = TABLES[key];
      const notNull = notNullColumnsOf(spec.table);
      const optional = optionalFieldsOf(INTERFACES[key]);

      for (const field of spec.fields) {
        const column = toColumn(field, spec);
        if (!notNull.has(column) || column === spec.pk) continue;
        if (!optional.has(field)) continue;
        expect(
          spec.notNull ?? {},
          `${spec.table}.${column} is NOT NULL but "${field}" is optional — ` +
            `toRow would send an explicit null and Postgres would refuse the row. ` +
            `Declare its default in TABLES.${key}.notNull.`,
        ).toHaveProperty(field);
      }
    });
  }

  it("writes the default instead of a null, and keeps the column present", () => {
    // Un versement tel que `addSold` l'écrit : `alertRead` n'y est pas.
    const row = toRow(TABLES.payments, {
      id: "pay-1",
      studentId: "stu-1",
      subscriptionId: "sub-1",
      monthCode: "M1",
      amountPaid: 2000,
      date: "2026-08-27T09:19:00.000Z",
      type: "subscription_payment",
    });
    expect(row.alert_read).toBe(false);
    // Les colonnes facultatives, elles, gardent bien leur null.
    expect(row).toHaveProperty("charge_id", null);
  });

  it("still writes a null for a nullable column that was cleared", () => {
    const row = toRow(TABLES.payments, { id: "pay-2", alertRead: undefined, description: undefined });
    expect(row).toHaveProperty("description", null);
    expect(row.alert_read).toBe(false);
  });
});
