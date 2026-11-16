import { describe, expect, it } from "vitest";
import { buildSeed } from "./fixtures/seed";
import { studentCardSummaries } from "@/lib/studentCardSummary";
import {
  currentCycleIndex, isFreeSub, soldFor, soldStatus, studentChargeDebt,
  studentDebt, studentEnrollments, studentListPrice, studentPayments,
} from "@/lib/helpers";

describe("original card financial semantics", () => {
  it("matches balances, counts, months and filters for every fixture student", () => {
    const db = buildSeed();
    const before = JSON.stringify(db);
    const summaries = studentCardSummaries(db);
    for (const student of db.students) {
      const row = summaries.get(student.id)!;
      const balances = student.subscriptionIds.map((id) => soldFor(db, student.id, id));
      expect(row.debt).toBe(studentDebt(db, student.id));
      expect(row.chargeDebt).toBe(studentChargeDebt(db, student.id));
      expect(row.remaining).toBe(balances.reduce((a, b) => a + b, 0));
      expect(row.soon).toBe(student.subscriptionIds.some((id) => !isFreeSub(student, id) &&
        soldStatus(soldFor(db, student.id, id), studentListPrice(student, db.subscriptions.find((s) => s.id === id))) !== "ok"));
      for (const id of student.subscriptionIds) {
        expect(row.sold.get(id)).toBe(soldFor(db, student.id, id));
        expect(row.months.get(id)).toBe(currentCycleIndex(db, student.id, id) + 1);
      }
    }
    expect(JSON.stringify(db)).toBe(before);
  });

  it("includes departed groups, fees and old payment rests; follows immutable edits", () => {
    const db = buildSeed();
    const student = db.students.find((s) => s.subscriptionIds.length > 0)!;
    const id = student.id;
    const subId = student.subscriptionIds[0];
    const first = studentCardSummaries(db).get(id)!;
    db.payments = [...db.payments, { ...db.payments[0], id: "extra-rest", studentId: id,
      subscriptionId: subId, amountPaid: 0, rest: 12.5 }];
    db.studentCharges = [...db.studentCharges, { id: "book", studentId: id, title: "Book",
      amount: 125.5, paidAmount: 25, date: "2026-01-01", origin: "manual" } as never];
    const updated = studentCardSummaries(db).get(id)!;
    expect(updated.debt).toBe(first.debt + 12.5);
    expect(updated.chargeDebt).toBe(first.chargeDebt + 100.5);
    db.students = db.students.map((s) => s.id === id ? { ...s, subscriptionIds: [],
      subscriptionDates: { ...s.subscriptionDates, [subId]: { startDate: "2026-01-01", unsubscribedAt: "2026-11-01" } } } : s);
    const departed = studentCardSummaries(db).get(id)!;
    expect(departed.debt).toBe(studentDebt(db, id));
    expect(departed.remaining).toBe(0);
    expect(departed.soon).toBe(false);
  });

  it("does not allow callers to sort or truncate cached ledger/enrollment lookups", () => {
    const db = buildSeed();
    const id = db.students[0].id;
    const payments = studentPayments(db, id);
    const enrollments = studentEnrollments(db, id);
    const originalPayments = [...payments];
    const originalEnrollments = [...enrollments];
    payments.length = 0;
    enrollments.length = 0;
    expect(studentPayments(db, id)).toEqual(originalPayments);
    expect(studentEnrollments(db, id)).toEqual(originalEnrollments);
  });
});
