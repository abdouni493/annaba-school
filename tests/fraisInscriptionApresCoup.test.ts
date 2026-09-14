import { describe, it, expect, beforeEach } from "vitest";
import { useData } from "@/lib/store/data";
import { buildSeed } from "@/tests/fixtures/seed";
import { registrationFeeFor, studentDebtSummary } from "@/lib/helpers";

/**
 * LES FRAIS D'INSCRIPTION D'UN ÉLÈVE INSCRIT APRÈS COUP.
 *
 * Un élève se crée très bien SANS emploi du temps : le créneau n'est pas encore
 * ouvert, la famille hésite. Les frais d'inscription ne portent alors sur rien,
 * et l'écran ne réclame rien — ce qui est juste.
 *
 * Mais le jour où la réception rouvre sa fiche pour lui cocher un emploi du
 * temps, ils deviennent dus. L'écran de modification restait pourtant muet : la
 * dette n'apparaissait nulle part, ni sur sa fiche, ni sur sa carte, et
 * personne ne la réclamait jamais.
 *
 * La fiche porte donc une marque — `registrationFeeAssessed` — qui dit si la
 * question a déjà été posée. Tant qu'elle est absente et qu'un emploi coché
 * entre dans le périmètre choisi par l'école, les frais sont réclamés ; une
 * fois posée, elle ne se repose plus.
 */
const SUB = "sub-1";
const NEW_STUDENT = "stu-nouveau";

function board() {
  const db = buildSeed();
  db.school = { ...db.school, registrationFee: 2000, registrationFeeScope: "all" };
  // Un élève créé SANS emploi du temps : rien ne lui a été réclamé.
  db.students = [
    ...db.students,
    {
      id: NEW_STUDENT,
      registrationNumber: "09999",
      firstName: "Nadir",
      lastName: "Sahraoui",
      birthDate: "2010-01-01",
      phone: "",
      email: "nadir@eleve.test",
      rfid: "rfid-nadir",
      isFree: false,
      studentCase: "normal",
      subscriptionIds: [],
      registrationDue: 0,
      registrationFeeAssessed: false,
    },
  ];
  useData.setState(db);
}

describe("les frais d'inscription naissent avec le premier emploi du temps", () => {
  beforeEach(board);

  it("ne réclame rien tant qu'aucun emploi du temps n'est coché", () => {
    const db = useData.getState();
    expect(registrationFeeFor(db, db.school, [])).toBe(0);
  });

  it("les réclame dès qu'un emploi du temps entre dans le périmètre", () => {
    const db = useData.getState();
    expect(registrationFeeFor(db, db.school, [SUB])).toBe(2000);
  });

  it("la marque dit si la question a déjà été posée", () => {
    const fresh = useData.getState().students.find((s) => s.id === NEW_STUDENT)!;
    expect(fresh.registrationFeeAssessed).toBe(false);

    // Ce que l'écran de modification écrit en cochant son premier emploi.
    useData.getState().updateItem("students", NEW_STUDENT, {
      subscriptionIds: [SUB],
      registrationDue: 2000,
      registrationFeeAssessed: true,
    });

    const after = useData.getState().students.find((s) => s.id === NEW_STUDENT)!;
    expect(after.registrationDue).toBe(2000);
    expect(after.registrationFeeAssessed).toBe(true);
    // Et la dette est visible partout où l'on lit ce que l'élève doit.
    expect(studentDebtSummary(useData.getState(), NEW_STUDENT).registrationDue).toBe(2000);
  });
});

describe("l'alerte de la carte s'encaisse, et expire", () => {
  beforeEach(() => {
    board();
    useData.getState().updateItem("students", NEW_STUDENT, {
      subscriptionIds: [SUB],
      registrationDue: 2000,
      registrationFeeAssessed: true,
    });
  });

  it("encaisse une partie et laisse le reste dû", async () => {
    const res = await useData
      .getState()
      .payRegistrationFee({ studentId: NEW_STUDENT, amount: 800 });
    expect(res.ok).toBe(true);
    expect(res.paid).toBe(800);
    expect(res.left).toBe(1200);

    const db = useData.getState();
    expect(db.students.find((s) => s.id === NEW_STUDENT)!.registrationDue).toBe(1200);
    // L'argent entre en caisse et la ligne part dans son historique.
    expect(db.cash.some((c) => c.amount === 800 && c.type === "student_payment")).toBe(true);
    expect(db.payments.some((p) => p.studentId === NEW_STUDENT && p.amountPaid === 800)).toBe(true);
  });

  it("le solde éteint l'alerte", async () => {
    await useData.getState().payRegistrationFee({ studentId: NEW_STUDENT, amount: 800 });
    const res = await useData
      .getState()
      .payRegistrationFee({ studentId: NEW_STUDENT, amount: 5000 });
    // Jamais plus que ce qui reste dû.
    expect(res.paid).toBe(1200);
    expect(res.left).toBe(0);
    expect(useData.getState().students.find((s) => s.id === NEW_STUDENT)!.registrationDue).toBe(0);
    expect(studentDebtSummary(useData.getState(), NEW_STUDENT).registrationDue).toBe(0);
  });

  it("refuse d'encaisser quand plus rien n'est dû", async () => {
    await useData.getState().payRegistrationFee({ studentId: NEW_STUDENT, amount: 2000 });
    const res = await useData
      .getState()
      .payRegistrationFee({ studentId: NEW_STUDENT, amount: 500 });
    expect(res.ok).toBe(false);
  });
});
