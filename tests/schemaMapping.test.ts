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
    expect(COLLECTION_ORDER.length).toBe(35);
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
