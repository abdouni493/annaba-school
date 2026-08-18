import { describe, it, expect, beforeEach } from "vitest";
import { useData } from "@/lib/store/data";
import { buildSeed } from "@/tests/fixtures/seed";
import {
  monthlyExpiry,
  monthlyPriceOf,
  remainingSeances,
  studentDebt,
  studentPayments,
  todayIso,
  totalRemainingSeances,
} from "@/lib/helpers";
import type { Student, SubscriptionDates } from "@/lib/types";

/**
 * The "Ajouter un étudiant" screen now takes the inscriptions AND the first
 * recharge in one go. These tests drive the very store calls that form makes,
 * in the same order, so the flow keeps writing the inscriptions on the student
 * and the purchase in his payment history.
 */

/** Timings ticked on the creation screen -> what the form stores. */
function enrollOnCreation(
  student: Omit<Student, "subscriptionIds" | "subscriptionDates">,
  picks: Array<{ subId: string; plan: "seance" | "month"; startDate: string }>,
  registrationFee = 0,
) {
  const subscriptionDates: Record<string, SubscriptionDates> = {};
  for (const p of picks) {
    subscriptionDates[p.subId] = {
      subscribedAt: todayIso(),
      startDate: p.startDate,
      expiryDate: p.plan === "month" ? monthlyExpiry(p.startDate) : undefined,
      plan: p.plan,
    };
  }
  const full: Student = {
    ...student,
    subscriptionIds: picks.map((p) => p.subId),
    subscriptionDates,
    registrationDue: picks.length > 0 && !student.isFree ? registrationFee : 0,
  };
  useData.getState().push("students", full);
  return full;
}

const baseStudent = {
  id: "stu-new",
  firstName: "Lina",
  lastName: "Kaci",
  birthDate: "2010-04-02",
  phone: "0555 00 11 22",
  email: "lina.kaci@elilm.com",
  rfid: "RFID-NEW",
  isFree: false,
};

beforeEach(() => {
  // Every test starts on a pristine copy of the demo database.
  useData.setState(buildSeed());
});

describe("création d'un étudiant avec ses inscriptions", () => {
  it("les créneaux cochés sont enregistrés sur sa fiche, avec leurs dates", () => {
    const start = todayIso();
    enrollOnCreation(baseStudent, [
      { subId: "sub-1", plan: "seance", startDate: start },
      { subId: "sub-3", plan: "seance", startDate: start },
    ]);

    const saved = useData.getState().students.find((s) => s.id === "stu-new")!;
    expect(saved.subscriptionIds).toEqual(["sub-1", "sub-3"]);
    expect(saved.subscriptionDates?.["sub-1"]).toMatchObject({
      subscribedAt: start,
      startDate: start,
      plan: "seance",
    });
    expect(saved.subscriptionDates?.["sub-3"]?.startDate).toBe(start);
  });

  it("plusieurs créneaux de classes différentes tiennent sur la même fiche", () => {
    const start = todayIso();
    enrollOnCreation(baseStudent, [
      { subId: "sub-1", plan: "seance", startDate: start }, // 3ème AS
      { subId: "sub-4", plan: "seance", startDate: start }, // 4ème AM
      { subId: "sub-5", plan: "seance", startDate: start }, // formation
    ]);

    const saved = useData.getState().students.find((s) => s.id === "stu-new")!;
    expect(saved.subscriptionIds).toHaveLength(3);
  });

  it("un mois coché fixe la date de fin de l'inscription", () => {
    const start = "2026-08-16";
    enrollOnCreation(baseStudent, [{ subId: "sub-1", plan: "month", startDate: start }]);

    const saved = useData.getState().students.find((s) => s.id === "stu-new")!;
    expect(saved.subscriptionDates?.["sub-1"]?.expiryDate).toBe("2026-09-15");
  });

  it("les frais d'inscription uniques sont dus dès la première inscription", () => {
    enrollOnCreation(baseStudent, [{ subId: "sub-1", plan: "seance", startDate: todayIso() }], 2000);
    expect(useData.getState().students.find((s) => s.id === "stu-new")!.registrationDue).toBe(2000);

    useData.setState(buildSeed());
    enrollOnCreation({ ...baseStudent, isFree: true }, [
      { subId: "sub-1", plan: "seance", startDate: todayIso() },
    ], 2000);
    expect(useData.getState().students.find((s) => s.id === "stu-new")!.registrationDue).toBe(0);
  });
});

describe("premier rechargement pris sur l'écran de création", () => {
  it("le paiement atterrit dans l'historique de l'élève et crédite ses séances", async () => {
    const start = todayIso();
    enrollOnCreation(baseStudent, [{ subId: "sub-1", plan: "seance", startDate: start }]);

    // sub-1 : 600 DA la séance.
    const res = await useData.getState().createEnrollmentPayment({
      studentId: "stu-new",
      subscriptionId: "sub-1",
      seances: 8,
      plan: "seance",
      amountPaid: 4800,
      startDate: start,
      description: "Premier rechargement de 8 séance(s) — Mathématiques",
    });
    expect(res.ok).toBe(true);
    expect(res.rest).toBe(0);

    const db = useData.getState();
    const history = studentPayments(db, "stu-new");
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      type: "subscription_payment",
      seancesPurchased: 8,
      unitPrice: 600,
      grossTotal: 4800,
      netTotal: 4800,
      amountPaid: 4800,
      rest: 0,
    });
    expect(totalRemainingSeances(db, "stu-new")).toBe(8);
    // …and the cash drawer saw the money.
    expect(db.cash.some((c) => c.type === "student_payment" && c.amount === 4800)).toBe(true);
  });

  it("un paiement partiel laisse une dette visible sur la fiche", async () => {
    const start = todayIso();
    enrollOnCreation(baseStudent, [{ subId: "sub-1", plan: "seance", startDate: start }]);

    const res = await useData.getState().createEnrollmentPayment({
      studentId: "stu-new",
      subscriptionId: "sub-1",
      seances: 4,
      plan: "seance",
      discountType: "percent",
      discountValue: 10,
      amountPaid: 1000,
      startDate: start,
      description: "Premier rechargement",
    });

    // 4 × 600 = 2400, remise 10% -> 2160, dont 1000 réglés.
    expect(res.ok).toBe(true);
    expect(res.rest).toBe(1160);
    expect(studentDebt(useData.getState(), "stu-new")).toBe(1160);
  });

  it("un premier mois ouvre la période et remplit le compteur du pack", async () => {
    const start = todayIso();
    enrollOnCreation(baseStudent, [{ subId: "sub-1", plan: "month", startDate: start }]);
    const tariff = useData.getState().subscriptions.find((s) => s.id === "sub-1")!;

    const res = await useData.getState().createEnrollmentPayment({
      studentId: "stu-new",
      subscriptionId: "sub-1",
      seances: 0,
      plan: "month",
      monthSeances: tariff.monthlySeances,
      packagePrice: monthlyPriceOf(tariff),
      amountPaid: monthlyPriceOf(tariff),
      startDate: start,
      expiryDate: monthlyExpiry(start),
      description: "Premier abonnement mensuel",
    });
    expect(res.ok).toBe(true);

    const db = useData.getState();
    const enrollment = db.enrollments.find(
      (e) => e.studentId === "stu-new" && e.subscriptionId === "sub-1",
    )!;
    expect(enrollment.plan).toBe("month");
    expect(enrollment.paidSeances).toBe(8);
    // Un mois, jamais un jour de plus — et les 8 séances du pack sont dessus.
    expect(enrollment.expiryDate).toBe(monthlyExpiry(start));
    expect(remainingSeances(enrollment)).toBe(8);
    // Le pack est vendu 4200 DA, moins cher que ses 8 séances à l'unité.
    expect(studentPayments(db, "stu-new")[0].grossTotal).toBe(4200);
  });

  it("le rechargement n'efface pas les autres inscriptions prises à la création", async () => {
    const start = todayIso();
    enrollOnCreation(baseStudent, [
      { subId: "sub-1", plan: "seance", startDate: start },
      { subId: "sub-3", plan: "seance", startDate: start },
    ]);

    await useData.getState().createEnrollmentPayment({
      studentId: "stu-new",
      subscriptionId: "sub-3",
      seances: 2,
      plan: "seance",
      amountPaid: 1400,
      startDate: start,
      description: "Premier rechargement",
    });

    const saved = useData.getState().students.find((s) => s.id === "stu-new")!;
    expect(saved.subscriptionIds).toEqual(["sub-1", "sub-3"]);
    expect(saved.subscriptionDates?.["sub-1"]?.startDate).toBe(start);
  });
});
