import { describe, it, expect, beforeEach } from "vitest";
import { useData } from "@/lib/store/data";
import { buildSeed } from "@/tests/fixtures/seed";
import { cycleOf, soldFor } from "@/lib/helpers";

/**
 * Un encaissement se corrige et se supprime là où il a été saisi — depuis la
 * feuille de présence du groupe comme depuis la fiche de l'élève.
 *
 * Ce qui compte : le SOLDE de l'emploi du temps et la CAISSE suivent
 * exactement le mouvement. Corriger 4000 en 2000 rend 2000 ; supprimer la ligne
 * reprend tout, et la recette disparaît de la caisse avec elle.
 */

const SUB = "sub-1";
const STU = "stu-1";

const cashOf = () => useData.getState().cash.filter((c) => c.type === "student_payment");

describe("corriger et supprimer un encaissement", () => {
  beforeEach(() => {
    const db = buildSeed();
    db.payments = [];
    db.cash = [];
    db.enrollments = db.enrollments.filter((e) => e.subscriptionId !== SUB);
    useData.setState(db);
  });

  it("supprime le paiement, reprend le solde et retire la recette", async () => {
    const res = await useData
      .getState()
      .addSold({ studentId: STU, subscriptionId: SUB, amount: 4000, monthCode: "M1" });
    expect(soldFor(useData.getState(), STU, SUB)).toBe(4000);
    expect(cashOf()).toHaveLength(1);

    const gone = await useData.getState().deleteStudentPayment(res.paymentId!);
    expect(gone).toMatchObject({ ok: true, amount: 4000, balance: 0 });

    const db = useData.getState();
    expect(db.payments.some((p) => p.id === res.paymentId)).toBe(false);
    expect(soldFor(db, STU, SUB)).toBe(0);
    expect(cycleOf(db, STU, SUB, "M1").credited).toBe(0);
    expect(cashOf()).toHaveLength(0);
  });

  it("corrige le montant : le solde et la caisse bougent du même écart", async () => {
    const res = await useData
      .getState()
      .addSold({ studentId: STU, subscriptionId: SUB, amount: 4000, monthCode: "M1" });

    await useData.getState().updateStudentPayment(res.paymentId!, { amount: 2000 });

    const db = useData.getState();
    expect(soldFor(db, STU, SUB)).toBe(2000);
    expect(cycleOf(db, STU, SUB, "M1").credited).toBe(2000);
    expect(cashOf()).toHaveLength(1);
    expect(cashOf()[0].amount).toBe(2000);
  });

  it("déplace un versement d'un mois à l'autre sans toucher au solde", async () => {
    const res = await useData
      .getState()
      .addSold({ studentId: STU, subscriptionId: SUB, amount: 3000, monthCode: "M1" });

    await useData.getState().updateStudentPayment(res.paymentId!, { monthCode: "M2" });

    const db = useData.getState();
    expect(soldFor(db, STU, SUB)).toBe(3000);
    expect(cycleOf(db, STU, SUB, "M1").credited).toBe(0);
    expect(cycleOf(db, STU, SUB, "M2").credited).toBe(3000);
  });

  it("réécrit la description sans rien déplacer d'autre", async () => {
    const res = await useData
      .getState()
      .addSold({ studentId: STU, subscriptionId: SUB, amount: 1500, monthCode: "M1" });

    await useData.getState().updateStudentPayment(res.paymentId!, { description: "Espèces — mère" });

    const db = useData.getState();
    const p = db.payments.find((x) => x.id === res.paymentId)!;
    expect(p.description).toBe("Espèces — mère");
    expect(p.amountPaid).toBe(1500);
    expect(soldFor(db, STU, SUB)).toBe(1500);
  });

  it("refuse de supprimer un règlement de dette : il a soldé des restes ailleurs", async () => {
    // Un achat qui laisse un reste, puis son règlement.
    await useData.getState().createEnrollmentPayment({
      studentId: STU,
      subscriptionId: SUB,
      seances: 4,
      amountPaid: 0,
    });
    const paid = await useData.getState().payStudentDebt(STU, 500);
    expect(paid.ok).toBe(true);
    const receipt = useData.getState().payments.find((p) => p.type === "debt_payment")!;

    expect(await useData.getState().deleteStudentPayment(receipt.id)).toMatchObject({ ok: false });
    expect(
      await useData.getState().updateStudentPayment(receipt.id, { amount: 100 }),
    ).toMatchObject({ ok: false });
    expect(useData.getState().payments.some((p) => p.id === receipt.id)).toBe(true);
  });

  it("ignore un identifiant inconnu", async () => {
    expect(await useData.getState().deleteStudentPayment("pay-inconnu")).toEqual({ ok: false });
    expect(await useData.getState().updateStudentPayment("pay-inconnu", { amount: 1 })).toEqual({
      ok: false,
    });
  });
});
