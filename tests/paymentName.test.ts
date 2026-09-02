import { describe, it, expect } from "vitest";
import { buildSeed } from "@/tests/fixtures/seed";
import { enrollmentLabel, paymentName, sessionName } from "@/lib/helpers";
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
    const withEnrollment = paymentName(db, payment({ enrollmentId: "enr-1", subscriptionId: "sub-1" }));

    db.enrollments = db.enrollments.filter((e) => e.id !== "enr-1");
    const p = payment({
      enrollmentId: "enr-1",
      subscriptionId: "sub-1",
      description: "Pack 12 séances — Mathématiques",
    });

    // Ni « — », ni la description brute : le MÊME emploi du temps, lu cette
    // fois sur le versement lui-même.
    expect(paymentName(db, p)).toBe(withEnrollment);
    expect(paymentName(db, p)).toContain("Mathématiques");
  });

  it("porte le nom écrit à la main d'un emploi sans module ni groupe", () => {
    // Un emploi du temps n'existe que par ses jours : classe, module et groupe
    // se remplissent plus tard. Tant qu'ils sont vides, seul le nom tapé à la
    // main dit de quoi il s'agit — et il ne doit JAMAIS se lire « — · — ».
    const db = buildSeed();
    const session = db.sessions.find((s) => s.id === "ses-1")!;
    session.title = "Soutien du samedi";
    session.moduleId = "";
    session.groupId = "";
    session.groupIds = [];
    session.classGroups = undefined;

    expect(sessionName(db, session)).toBe("Soutien du samedi");
    expect(paymentName(db, payment({ enrollmentId: "enr-1", subscriptionId: "sub-1" }))).toBe(
      "Soutien du samedi",
    );
  });

  it("ne rend jamais un assemblage de tirets", () => {
    const db = buildSeed();
    const session = db.sessions.find((s) => s.id === "ses-1")!;
    session.title = undefined;
    session.moduleId = "mod-inconnu";
    session.groupId = "grp-inconnu";
    session.groupIds = [];
    session.classGroups = undefined;
    session.classId = "";
    session.classIds = [];

    // Plus rien n'est connu du créneau : on retombe sur ce que la saisie a
    // écrit, jamais sur « — · — ».
    expect(sessionName(db, session)).toBe("");
    expect(
      paymentName(
        db,
        payment({
          enrollmentId: "enr-1",
          subscriptionId: "sub-1",
          description: "Pack 12 séances — Mathématiques",
        }),
      ),
    ).toBe("Pack 12 séances — Mathématiques");
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
