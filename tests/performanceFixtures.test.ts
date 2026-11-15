import { it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { buildSeed } from "./fixtures/seed";
import { TABLES, COLLECTION_ORDER, SCHOOL_SPEC, toRow } from "@/lib/supabase/tables";

it("generates exclusively synthetic, fixed-roster history scaling fixtures", () => {
  const db = buildSeed();
  const student = db.students[0];
  db.students.push(...Array.from({ length: 500 }, (_, i) => ({ ...student,
    id: `synthetic-${String(i).padStart(5, "0")}`, firstName: `Prénom${i}`, lastName: `Nom${i}`,
    registrationNumber: String(i + 100).padStart(5, "0"), phone: "", phone2: "", email: "",
    rfid: `SYNTHETIC-${i}`, subscriptionIds: [], subscriptionDates: {}, parentId: undefined,
  })));
  const tables: Record<string, unknown[]> = { schools: [toRow(SCHOOL_SPEC, db.school as never)] };
  for (const key of COLLECTION_ORDER) tables[TABLES[key].table] = (db[key] ?? []).map((r) => toRow(TABLES[key], r as never));
  expect(tables.students).toHaveLength(db.students.length);
  if (process.env.ANNABA_FIXTURE_PATH) writeFileSync(process.env.ANNABA_FIXTURE_PATH, JSON.stringify(tables));
});
