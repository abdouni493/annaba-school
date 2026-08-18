import { describe, it, expect, beforeEach } from "vitest";
import { useData } from "@/lib/store/data";
import { buildSeed } from "@/lib/store/seed";
import { soldFor, studentSoldDebtRows } from "@/lib/helpers";
import type { TeacherChildCharge } from "@/lib/types";

/**
 * A teacher's settlement takes three things off his gross: the dépenses the
 * school carried for him, the acomptes he has drawn, and the schooling of his
 * own children. Each of them is settled exactly ONCE — the point of these
 * tests is that nothing comes back on the next payment.
 */

const TEACHER = "tea-1";

/** The keys of everything tea-1 is still owed, as the payment screen builds them. */
function unpaidKeys(): string[] {
  const db = useData.getState();
  return [
    ...new Set(
      db.unpaidTeacher
        .filter((u) => u.teacherId === TEACHER && !u.paid)
        .map((u) => `${new Date(u.date).toLocaleDateString("fr-CA")}|${u.sessionId}`),
    ),
  ];
}

const unpaidExpenses = () =>
  useData.getState().teacherExpenses.filter((e) => e.teacherId === TEACHER && !e.paid);
const unpaidAcomptes = () =>
  useData.getState().acomptes.filter((a) => a.teacherId === TEACHER && !a.paid);

beforeEach(() => {
  useData.setState(buildSeed());
});

describe("dépenses de l'enseignant", () => {
  it("une dépense enregistrée attend le prochain règlement", () => {
    const before = unpaidExpenses().length;
    useData.getState().push("teacherExpenses", {
      id: "tex-test",
      teacherId: TEACHER,
      name: "Craie et marqueurs",
      amount: 900,
      description: "Réassort trimestriel",
      date: "2026-08-19",
      paid: false,
    });
    expect(unpaidExpenses()).toHaveLength(before + 1);
    expect(unpaidExpenses().some((e) => e.name === "Craie et marqueurs")).toBe(true);
  });

  it("est retenue UNE fois : après le règlement elle disparaît de l'écran de paie", async () => {
    const expenses = unpaidExpenses();
    const acomptesBefore = unpaidAcomptes();
    expect(expenses.length).toBeGreaterThan(0);
    expect(acomptesBefore.length).toBeGreaterThan(0);

    const expensesTotal = expenses.reduce((s, e) => s + e.amount, 0);
    const acomptesTotal = acomptesBefore.reduce((s, a) => s + a.amount, 0);
    const gross = 20000;

    const res = await useData.getState().payTeacherSessions({
      teacherId: TEACHER,
      keys: unpaidKeys(),
      amount: gross - expensesTotal - acomptesTotal,
      gross,
      method: "fixed",
      expenseIds: expenses.map((e) => e.id),
      acompteIds: acomptesBefore.map((a) => a.id),
    });
    expect(res.ok).toBe(true);

    // Nothing is left to deduct — the next settlement starts clean.
    expect(unpaidExpenses()).toHaveLength(0);
    expect(unpaidAcomptes()).toHaveLength(0);

    const payment = useData.getState().teacherPayments.find((p) => p.id === res.paymentId)!;
    expect(payment.gross).toBe(gross);
    expect(payment.amount).toBe(gross - expensesTotal - acomptesTotal);
    expect(payment.expenses).toHaveLength(expenses.length);
    expect(payment.acomptes).toHaveLength(acomptesBefore.length);
  });

  it("une dépense laissée de côté reste due au règlement suivant", async () => {
    const [first, ...rest] = unpaidExpenses();
    await useData.getState().payTeacherSessions({
      teacherId: TEACHER,
      keys: unpaidKeys(),
      amount: 5000,
      gross: 5000 + first.amount,
      method: "fixed",
      expenseIds: [first.id],
    });
    const left = unpaidExpenses();
    expect(left).toHaveLength(rest.length);
    expect(left.some((e) => e.id === first.id)).toBe(false);
  });

  it("le montant versé est bien le NET, et la caisse ne sort que ce net", async () => {
    const cashBefore = useData
      .getState()
      .cash.filter((c) => c.type === "teacher_payment")
      .reduce((s, c) => s + c.amount, 0);

    await useData.getState().payTeacherSessions({
      teacherId: TEACHER,
      keys: unpaidKeys(),
      amount: 7000,
      gross: 10000,
      method: "fixed",
      expenseIds: unpaidExpenses().map((e) => e.id),
    });

    const cashAfter = useData
      .getState()
      .cash.filter((c) => c.type === "teacher_payment")
      .reduce((s, c) => s + c.amount, 0);
    expect(cashAfter - cashBefore).toBe(-7000);
  });
});

describe("les enfants de l'enseignant, scolarisés sur son salaire", () => {
  /**
   * Puts stu-2 in the red on sub-4 the way the app does it: he attends séances
   * his solde does not cover. Nothing is hand-written on the enrollment, so the
   * card figure and the month-by-month ledger stay in agreement.
   */
  function childInDebt() {
    const db = buildSeed();
    const child = db.students.find((s) => s.id === "stu-2")!;
    child.studentCase = "teacher_child";
    child.teacherFatherId = TEACHER;
    // He starts from a clean slate on that emploi.
    db.payments = db.payments.filter((p) => p.subscriptionId !== "sub-4" || p.studentId !== "stu-2");
    db.attendance = db.attendance.filter((a) => a.studentId !== "stu-2");
    db.freePeriods = [];
    const opened = new Date();
    opened.setDate(opened.getDate() - 400);
    child.subscriptionDates = {
      ...child.subscriptionDates,
      "sub-4": {
        subscribedAt: opened.toLocaleDateString("fr-CA"),
        startDate: opened.toLocaleDateString("fr-CA"),
      },
    };
    db.enrollments = db.enrollments.filter(
      (e) => !(e.studentId === "stu-2" && e.subscriptionId === "sub-4"),
    );
    useData.setState(db);
    return { childId: "stu-2", subId: "sub-4" };
  }

  /** Marks him present on the given number of scheduled days of ses-4. */
  async function attend(count: number) {
    const session = useData.getState().sessions.find((s) => s.id === "ses-4")!;
    const keys = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const d = new Date();
    d.setDate(d.getDate() - 120);
    let done = 0;
    while (done < count) {
      if (session.days.includes(keys[d.getDay()] as never)) {
        await useData.getState().setPresence({
          studentId: "stu-2",
          sessionId: "ses-4",
          date: d.toLocaleDateString("fr-CA"),
          status: "present",
        });
        done += 1;
      }
      d.setDate(d.getDate() + 1);
    }
  }

  it("sa dette est listée emploi par emploi", async () => {
    const { childId, subId } = childInDebt();
    await attend(3);
    const unit = useData.getState().subscriptions.find((s) => s.id === subId)!.pricePerSession;
    const rows = studentSoldDebtRows(useData.getState(), childId);
    expect(rows).toHaveLength(1);
    expect(rows[0].debt).toBe(3 * unit);
    // The card figure and the month ledger tell the same story.
    expect(soldFor(useData.getState(), childId, subId)).toBe(-3 * unit);
  });

  it("le règlement du père remet le solde de l'enfant à zéro", async () => {
    const { childId, subId } = childInDebt();
    await attend(3);
    const rows = studentSoldDebtRows(useData.getState(), childId);
    const debt = rows.reduce((s, r) => s + r.debt, 0);
    const charge: TeacherChildCharge = {
      studentId: childId,
      studentName: "Lina Amrani",
      lines: rows.map((r) => ({
        subscriptionId: r.subscriptionId,
        label: r.label,
        monthCode: r.code,
        amount: r.debt,
      })),
      amount: debt,
    };

    expect(soldFor(useData.getState(), childId, subId)).toBe(-debt);

    await useData.getState().payTeacherSessions({
      teacherId: TEACHER,
      keys: unpaidKeys(),
      amount: 10000 - debt,
      gross: 10000,
      method: "fixed",
      childCharges: [charge],
    });

    expect(soldFor(useData.getState(), childId, subId)).toBe(0);
    const payment = useData.getState().teacherPayments.slice(-1)[0];
    expect(payment.childCharges).toHaveLength(1);
    expect(payment.childCharges![0].amount).toBe(debt);
  });

  it("cet argent ne passe PAS par la caisse : le père est simplement payé moins", async () => {
    const { childId } = childInDebt();
    await attend(3);
    const rows = studentSoldDebtRows(useData.getState(), childId);
    const debt = rows.reduce((s, r) => s + r.debt, 0);
    const inflowBefore = useData
      .getState()
      .cash.filter((c) => c.type === "student_payment")
      .reduce((s, c) => s + c.amount, 0);

    await useData.getState().payTeacherSessions({
      teacherId: TEACHER,
      keys: unpaidKeys(),
      amount: 10000 - debt,
      gross: 10000,
      method: "fixed",
      childCharges: [
        {
          studentId: childId,
          studentName: "Lina Amrani",
          lines: rows.map((r) => ({
            subscriptionId: r.subscriptionId,
            label: r.label,
            monthCode: r.code,
            amount: r.debt,
          })),
          amount: debt,
        },
      ],
    });

    const inflowAfter = useData
      .getState()
      .cash.filter((c) => c.type === "student_payment")
      .reduce((s, c) => s + c.amount, 0);
    // The school never received cash for it — it kept it out of his pay.
    expect(inflowAfter).toBe(inflowBefore);
  });
});
