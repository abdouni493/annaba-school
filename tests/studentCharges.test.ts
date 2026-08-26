import { describe, it, expect, beforeEach } from "vitest";
import { useData } from "@/lib/store/data";
import { buildSeed } from "@/tests/fixtures/seed";
import {
  chargePayments,
  chargeRemaining,
  schoolAdvancedRows,
  studentAdvanceDebt,
  studentChargeDebt,
  studentChargesOf,
  studentDebt,
  studentHasDebt,
  studentOpenCharges,
  studentTotalDue,
  totalStudentChargeDebt,
} from "@/lib/helpers";
import { teacherEmplois } from "@/lib/teacherMonths";

/**
 * LES FRAIS D'UN ÉLÈVE — la dette qui n'est pas de la scolarité.
 *
 * Quatre promesses que la réception doit pouvoir tenir au comptoir :
 *
 *  1. ON PORTE UN FRAIS AU COMPTE D'UN ÉLÈVE en tapant un nom, un montant et
 *     une date — la description reste facultative.
 *  2. IL SE RÈGLE EN PLUSIEURS FOIS : ce qui n'est pas versé RESTE DÛ, et
 *     l'alerte le dit encore. Chaque versement laisse sa trace dans
 *     l'historique de l'élève et une entrée en caisse.
 *  3. IL NE RETIENT JAMAIS LA PAIE D'UN ENSEIGNANT. Un livre impayé ne regarde
 *     pas le professeur de mathématiques : seule la scolarité bloque sa part.
 *  4. CE QUE L'ÉCOLE AVANCE DE SA CAISSE devient un frais que la famille lui
 *     doit — sans quoi la dette s'évaporait à la seconde où l'école la
 *     couvrait, et plus personne au guichet ne savait qu'il fallait la
 *     réclamer.
 */

const SUB = "sub-1";
const SES = "ses-1";
const STU = "stu-1";
const TEACHER = "tea-1";

const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** Un mois de 4 séances à 2000 DA dont l'école garde 800 : séance = 500. */
function board() {
  const db = buildSeed();
  const sub = db.subscriptions.find((s) => s.id === SUB)!;
  sub.monthlySeances = 4;
  sub.monthlyPrice = 2000;
  sub.pricePerSession = 500;
  sub.schoolMonthShare = 800;
  sub.teacherPerSeance = 300;

  db.attendance = [];
  db.payments = [];
  db.studentCharges = [];
  db.unpaidTeacher = [];
  db.independent = [];
  db.freePeriods = [];
  db.cash = [];
  db.enrollments = db.enrollments.filter((e) => e.subscriptionId !== SUB);

  const opened = new Date();
  opened.setDate(opened.getDate() - 400);
  const openedIso = opened.toLocaleDateString("fr-CA");
  db.students = db.students.map((st) =>
    st.id === STU
      ? {
          ...st,
          isFree: false,
          studentCase: "normal" as const,
          registrationDue: 0,
          subscriptionIds: [SUB],
          subscriptionDates: { [SUB]: { subscribedAt: openedIso, startDate: openedIso } },
        }
      : { ...st, subscriptionIds: st.subscriptionIds.filter((id) => id !== SUB) },
  );
  db.sessions.find((s) => s.id === SES)!.teacherId = TEACHER;

  useData.setState(db);
  return sub;
}

/** N jours consécutifs où l'emploi tourne réellement, du plus ancien. */
function scheduledDays(count: number): string[] {
  const session = useData.getState().sessions.find((s) => s.id === SES)!;
  const out: string[] = [];
  const d = new Date();
  d.setDate(d.getDate() - 200);
  while (out.length < count) {
    if (session.days.includes(DAY_KEYS[d.getDay()] as never)) out.push(d.toLocaleDateString("fr-CA"));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

/** Quatre séances suivies sans rien payer : 2000 DA de scolarité dus. */
async function indebted() {
  board();
  for (const day of scheduledDays(4)) {
    await useData.getState().setPresence({ studentId: STU, sessionId: SES, date: day, status: "present" });
  }
}

const charge = async (name: string, amount: number, date = "2026-08-20") => {
  const res = await useData.getState().saveStudentCharge({ studentId: STU, name, amount, date });
  expect(res.ok).toBe(true);
  return res.id!;
};

const db = () => useData.getState();

beforeEach(() => {
  useData.setState(buildSeed());
});

// ---------------------------------------------------------------------------

describe("porter un frais au compte d'un élève", () => {
  it("un nom, un montant, une date — et la description reste facultative", async () => {
    board();
    const id = await charge("Livre de mathématiques", 1200, "2026-08-20");

    const row = db().studentCharges.find((c) => c.id === id)!;
    expect(row).toMatchObject({
      studentId: STU,
      name: "Livre de mathématiques",
      amount: 1200,
      date: "2026-08-20",
      origin: "manual",
      paidAmount: 0,
      paid: false,
    });
    expect(row.description).toBeUndefined();
    expect(studentChargeDebt(db(), STU)).toBe(1200);
    expect(studentOpenCharges(db(), STU)).toHaveLength(1);
  });

  it("refuse un frais sans nom ou sans montant", async () => {
    board();
    expect(await db().saveStudentCharge({ studentId: STU, name: "   ", amount: 500 })).toMatchObject({
      ok: false,
      messageKey: "charge.nameRequired",
    });
    expect(await db().saveStudentCharge({ studentId: STU, name: "Tenue", amount: 0 })).toMatchObject({
      ok: false,
      messageKey: "charge.amountRequired",
    });
    expect(db().studentCharges).toHaveLength(0);
  });

  it("le corriger ne crée pas un second frais et ne reprend rien à la famille", async () => {
    board();
    const id = await charge("Tenu de sport", 900);
    await db().payStudentCharges({ studentId: STU, lines: [{ chargeId: id, amount: 400 }] });

    await db().saveStudentCharge({
      id,
      studentId: STU,
      name: "Tenue de sport",
      amount: 1000,
      date: "2026-08-21",
    });

    expect(db().studentCharges).toHaveLength(1);
    const row = db().studentCharges[0];
    expect(row).toMatchObject({ name: "Tenue de sport", amount: 1000, paidAmount: 400, paid: false });
    expect(chargeRemaining(row)).toBe(600);
  });

  it("baisser le montant sous ce qui est encaissé solde le frais", async () => {
    board();
    const id = await charge("Sortie", 2000);
    await db().payStudentCharges({ studentId: STU, lines: [{ chargeId: id, amount: 800 }] });
    await db().saveStudentCharge({ id, studentId: STU, name: "Sortie", amount: 700 });

    expect(db().studentCharges[0].paid).toBe(true);
    expect(studentChargeDebt(db(), STU)).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe("régler un frais, en une ou plusieurs fois", () => {
  it("un versement partiel laisse le reste dû et l'alerte affichée", async () => {
    board();
    const id = await charge("Livre de mathématiques", 1200);

    const res = await db().payStudentCharges({
      studentId: STU,
      lines: [{ chargeId: id, amount: 500 }],
      date: "2026-08-25",
    });

    expect(res).toMatchObject({ ok: true, paid: 500, rest: 700 });
    const row = db().studentCharges[0];
    expect(row).toMatchObject({ paidAmount: 500, paid: false });
    expect(chargeRemaining(row)).toBe(700);
    expect(studentChargeDebt(db(), STU)).toBe(700);
  });

  it("le solder l'éteint : il ne compte plus dans ce qui est dû", async () => {
    board();
    const id = await charge("Livre de mathématiques", 1200);
    await db().payStudentCharges({ studentId: STU, lines: [{ chargeId: id, amount: 700 }] });
    await db().payStudentCharges({ studentId: STU, lines: [{ chargeId: id, amount: 500 }] });

    expect(db().studentCharges[0]).toMatchObject({ paidAmount: 1200, paid: true });
    expect(studentChargeDebt(db(), STU)).toBe(0);
    expect(studentOpenCharges(db(), STU)).toHaveLength(0);
    // Les deux versements restent dans l'historique de l'élève.
    expect(chargePayments(db(), id)).toHaveLength(2);
  });

  it("n'encaisse jamais plus que ce qui reste dû", async () => {
    board();
    const id = await charge("Transport", 600);
    const res = await db().payStudentCharges({
      studentId: STU,
      lines: [{ chargeId: id, amount: 5000 }],
    });
    expect(res.paid).toBe(600);
    expect(db().studentCharges[0].paidAmount).toBe(600);
  });

  it("chaque ligne écrit son versement ET son entrée en caisse, à la date choisie", async () => {
    board();
    const book = await charge("Livre", 1000);
    const kit = await charge("Tenue", 500);
    const cashBefore = db().cash.length;

    await db().payStudentCharges({
      studentId: STU,
      lines: [
        { chargeId: book, amount: 1000 },
        { chargeId: kit, amount: 200 },
      ],
      date: "2026-08-24",
    });

    const settlements = db().payments.filter((p) => p.chargeId);
    expect(settlements).toHaveLength(2);
    for (const p of settlements) {
      expect(p.type).toBe("debt_payment");
      expect(p.paidFrom).toBe("cash");
      // Le reste vit sur le frais, JAMAIS sur le versement : sans quoi il se
      // lirait comme une scolarité impayée et retiendrait la part d'un
      // enseignant qui n'a rien à voir avec un livre.
      expect(p.rest).toBe(0);
      expect(p.date.startsWith("2026-08-24")).toBe(true);
      expect(p.subscriptionId).toBeUndefined();
    }

    const posted = db().cash.slice(cashBefore);
    expect(posted).toHaveLength(2);
    expect(posted.every((c) => c.type === "student_payment")).toBe(true);
    expect(posted.reduce((s, c) => s + c.amount, 0)).toBe(1200);
  });

  it("ne fait rien quand aucune ligne n'a de montant", async () => {
    board();
    const id = await charge("Livre", 1000);
    const res = await db().payStudentCharges({ studentId: STU, lines: [{ chargeId: id, amount: 0 }] });
    expect(res).toMatchObject({ ok: false, messageKey: "debt.nothingDue" });
    expect(db().payments.filter((p) => p.chargeId)).toHaveLength(0);
  });

  it("supprimer un frais emporte ses règlements et recule la caisse", async () => {
    board();
    const id = await charge("Livre", 1000);
    const cashBefore = db().cash.length;
    await db().payStudentCharges({ studentId: STU, lines: [{ chargeId: id, amount: 400 }] });
    expect(db().cash).toHaveLength(cashBefore + 1);

    await db().deleteStudentCharge(id);
    expect(db().studentCharges).toHaveLength(0);
    expect(db().payments.filter((p) => p.chargeId === id)).toHaveLength(0);
    expect(db().cash).toHaveLength(cashBefore);
  });
});

// ---------------------------------------------------------------------------

describe("un frais ne retient pas la paie d'un enseignant", () => {
  it("un livre impayé laisse la part de l'enseignant payable", async () => {
    board();
    // Quatre séances, entièrement payées : la scolarité est à jour.
    await db().addSold({ studentId: STU, subscriptionId: SUB, amount: 2000, monthCode: "M1" });
    for (const day of scheduledDays(4)) {
      await db().setPresence({ studentId: STU, sessionId: SES, date: day, status: "present" });
    }
    expect(studentHasDebt(db(), STU)).toBe(false);

    await charge("Livre de mathématiques", 1200);

    // Le frais est bien dû…
    expect(studentChargeDebt(db(), STU)).toBe(1200);
    expect(studentTotalDue(db(), STU)).toBe(1200);
    // …mais la scolarité, elle, reste à jour et la part se paie.
    expect(studentDebt(db(), STU)).toBe(0);
    expect(studentHasDebt(db(), STU)).toBe(false);
    const emploi = teacherEmplois(db(), TEACHER).find((e) => e.sessionId === SES)!;
    expect(emploi.withheld).toBe(0);
    expect(emploi.payable).toBe(4 * 300);
  });
});

// ---------------------------------------------------------------------------

describe("ce que l'école avance devient une dette de la famille", () => {
  it("couvrir une dette porte un frais « avancé par l'école » au compte de l'élève", async () => {
    await indebted();
    expect(studentHasDebt(db(), STU)).toBe(true);

    const res = await db().coverStudentDebt({ studentId: STU });
    expect(res.ok).toBe(true);
    expect(res.amount).toBe(2000);

    // La scolarité est soldée et la part de l'enseignant se débloque…
    expect(studentHasDebt(db(), STU)).toBe(false);
    expect(teacherEmplois(db(), TEACHER).find((e) => e.sessionId === SES)!.payable).toBe(4 * 300);

    // …mais l'argent est sorti sans jamais entrer : la famille le doit.
    const charges = studentChargesOf(db(), STU);
    expect(charges).toHaveLength(1);
    expect(charges[0]).toMatchObject({ origin: "school_advance", amount: 2000, paid: false });
    expect(charges[0].sourcePaymentId).toBeTruthy();
    expect(studentAdvanceDebt(db(), STU)).toBe(2000);
    expect(totalStudentChargeDebt(db())).toBe(2000);
  });

  it("l'alerte des avances dit ce qui reste à récupérer et disparaît une fois remboursée", async () => {
    await indebted();
    await db().coverStudentDebt({ studentId: STU });

    let rows = schoolAdvancedRows(db());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ amount: 2000, remaining: 2000 });

    const id = rows[0].chargeId!;
    await db().payStudentCharges({ studentId: STU, lines: [{ chargeId: id, amount: 1200 }] });
    rows = schoolAdvancedRows(db());
    expect(rows[0].remaining).toBe(800);

    await db().payStudentCharges({ studentId: STU, lines: [{ chargeId: id, amount: 800 }] });
    // Remboursée, elle quitte la liste des choses à réclamer.
    expect(schoolAdvancedRows(db())).toHaveLength(0);
    expect(studentAdvanceDebt(db(), STU)).toBe(0);
  });

  it("rembourser l'avance ne rebloque PAS la part de l'enseignant", async () => {
    await indebted();
    await db().coverStudentDebt({ studentId: STU });
    expect(studentHasDebt(db(), STU)).toBe(false);

    // Tant que l'avance n'est pas remboursée, la scolarité reste à jour : la
    // paie ne peut pas se rebloquer sur une dette qu'elle a elle-même servi à
    // débloquer.
    expect(studentAdvanceDebt(db(), STU)).toBe(2000);
    expect(studentHasDebt(db(), STU)).toBe(false);
    expect(teacherEmplois(db(), TEACHER).find((e) => e.sessionId === SES)!.withheld).toBe(0);
  });

  it("les frais d'inscription avancés donnent eux aussi leur frais à rembourser", async () => {
    await indebted();
    useData.setState((s) => ({
      students: s.students.map((st) => (st.id === STU ? { ...st, registrationDue: 700 } : st)),
    }));

    await db().coverStudentDebt({ studentId: STU });

    const charges = studentChargesOf(db(), STU);
    // Un frais pour le mois avancé, un autre pour les frais d'inscription.
    expect(charges).toHaveLength(2);
    expect(studentAdvanceDebt(db(), STU)).toBe(2700);
  });
});

// ---------------------------------------------------------------------------

describe("un élève effacé emporte ses frais", () => {
  it("la suppression nettoie le magasin comme la cascade le fait en base", async () => {
    board();
    await charge("Livre", 1000);
    expect(db().studentCharges).toHaveLength(1);

    db().deleteFrom("students", STU);
    expect(db().studentCharges).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------

describe("un versement de solde peut être daté d'un autre jour", () => {
  it("le versement et son mouvement de caisse portent la date choisie", async () => {
    board();
    const cashBefore = db().cash.length;
    const res = await db().addSold({
      studentId: STU,
      subscriptionId: SUB,
      amount: 2000,
      monthCode: "M1",
      date: "2026-08-19",
    });
    expect(res.ok).toBe(true);

    const payment = db().payments.find((p) => p.id === res.paymentId)!;
    expect(payment.date.startsWith("2026-08-19")).toBe(true);
    expect(db().cash.slice(cashBefore)[0].date.startsWith("2026-08-19")).toBe(true);
  });

  it("sans date, c'est aujourd'hui — le comportement de toujours", async () => {
    board();
    const res = await db().addSold({ studentId: STU, subscriptionId: SUB, amount: 500 });
    const payment = db().payments.find((p) => p.id === res.paymentId)!;
    expect(payment.date.startsWith(new Date().toISOString().slice(0, 10))).toBe(true);
  });
});
