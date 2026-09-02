import { describe, it, expect } from "vitest";
import { buildSeed } from "@/tests/fixtures/seed";
import { enrollmentLabel, paymentName, subscriptionLabel } from "@/lib/helpers";
import type { Payment } from "@/lib/types";

/**
 * LE NOM D'UN VERSEMENT — celui que la liste « Ancien paiement » affiche au
 * guichet et celui que le reçu réimprimé porte.
 *
 * Trois promesses, une par cas que la réception rencontre vraiment :
 *
 *  1. UN ACHAT DE SÉANCES porte le nom de l'emploi du temps qu'il crédite,
 *     jamais un « Versement » anonyme ;
 *  2. IL LE PORTE ENCORE quand l'inscription a été supprimée depuis : l'emploi
 *     du temps reste écrit sur le versement, on le lit là ;
 *  3. UN RÈGLEMENT DE FRAIS porte le nom du frais (« Livre de maths »), pas le
 *     mot « dette » — c'est ce livre-là que le parent vient réclamer.
 */

const STU = "stu-1";

function payment(over: Partial<Payment> = {}): Payment {
  return {
    id: "pay-x",
    studentId: STU,
    seancesPurchased: 0,
    unitPrice: 0,
    grossTotal: 0,
    netTotal: 0,
    amountPaid: 1000,
    rest: 0,
    type: "subscription_payment",
    date: new Date().toISOString(),
    ...over,
  };
}

describe("Le nom d'un versement", () => {
  it("nomme un achat de séances par l'emploi du temps de son inscription", () => {
    const db = buildSeed();
    const enrollment = db.enrollments.find((e) => e.id === "enr-1")!;
    const p = payment({ enrollmentId: "enr-1", subscriptionId: "sub-1" });

    const name = paymentName(db, p);
    expect(name).toBe(enrollmentLabel(db, enrollment));
    expect(name).toContain("Mathématiques");
  });

  it("retombe sur l'emploi du temps quand l'inscription a été supprimée", () => {
    const db = buildSeed();
    db.enrollments = db.enrollments.filter((e) => e.id !== "enr-1");
    const sub = db.subscriptions.find((s) => s.id === "sub-1")!;
    const p = payment({
      enrollmentId: "enr-1",
      subscriptionId: "sub-1",
      description: "Pack 12 séances — Mathématiques",
    });

    // Ni « — », ni la description brute : l'emploi du temps, lu sur le
    // versement lui-même.
    expect(paymentName(db, p)).toBe(subscriptionLabel(db, sub));
    expect(paymentName(db, p)).not.toBe("—");
  });

  it("nomme un règlement de frais par le frais qu'il solde", () => {
    const db = buildSeed();
    db.studentCharges = [
      ...db.studentCharges,
      {
        id: "chg-test",
        studentId: STU,
        name: "Livre de maths",
        amount: 1500,
        date: new Date().toISOString().substring(0, 10),
      },
    ];
    const p = payment({
      chargeId: "chg-test",
      type: "debt_payment",
      description: "Frais — Livre de maths",
    });

    expect(paymentName(db, p)).toBe("Livre de maths");
  });

  it("dit ce que la saisie a écrit, et à défaut le nom du cas", () => {
    const db = buildSeed();

    expect(paymentName(db, payment({ type: "debt_payment", description: "Règlement dette M2" }))).toBe(
      "Règlement dette M2",
    );
    expect(paymentName(db, payment({ type: "debt_payment" }))).toBe("Règlement de dette");
    expect(paymentName(db, payment())).toBe("Versement");
  });
});
