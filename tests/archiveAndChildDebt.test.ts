import { describe, it, expect, beforeEach } from "vitest";
import { useData } from "@/lib/store/data";
import { buildSeed } from "@/tests/fixtures/seed";
import {
  activeSessions,
  cycleCredits,
  isArchivedSub,
  soldFor,
  studentHasDebt,
  studentInscriptionRows,
  teacherChildDebtTotal,
} from "@/lib/helpers";
import { teacherChildRows, teacherEmplois } from "@/lib/teacherMonths";

/**
 * Quatre règles que la réception vient d'obtenir, et qui touchent toutes à la
 * même chose : ce que l'application a le droit de PERDRE.
 *
 *  1. SUPPRIMER UN EMPLOI DU TEMPS N'EFFACE RIEN. La ligne est archivée : elle
 *     quitte les écrans de travail, mais ses présences, ses paiements et les
 *     parts qu'elle doit à l'enseignant restent lisibles et nommés.
 *
 *  2. UN FILS D'ENSEIGNANT PEUT ÊTRE MIS EN RÈGLE AU GUICHET, sans ouvrir la
 *     moindre paie, de deux façons qui ne font PAS la même chose au salaire de
 *     son père : la famille paie (rien n'est retenu) ou le montant est porté sur
 *     le père (retenu une fois, à sa prochaine paie).
 *
 *  3. RETIRER UN POINTAGE REND CE QU'IL AVAIT PRIS, au dinar près, y compris
 *     celui d'un autre jour que celui affiché.
 *
 *  4. L'ÉCOLE CHOISIT CE QU'ELLE AVANCE : mois par mois, montant par montant —
 *     et un règlement partiel ne débloque pas la part de l'enseignant.
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
  db.unpaidTeacher = [];
  db.independent = [];
  db.freePeriods = [];
  db.cash = [];
  db.teacherChildDebts = [];
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

function patch(id: string, fields: Record<string, unknown>) {
  useData.setState((s) => ({
    students: s.students.map((st) => (st.id === id ? { ...st, ...fields } : st)),
  }));
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

const attend = (date: string, studentId = STU) =>
  useData.getState().setPresence({ studentId, sessionId: SES, date, status: "present" });

beforeEach(() => {
  useData.setState(buildSeed());
});

// ---------------------------------------------------------------------------

describe("supprimer un emploi du temps l'archive, sans rien perdre", () => {
  it("l'emploi quitte les écrans de travail mais sa ligne et son tarif restent", async () => {
    board();
    await attend(scheduledDays(1)[0]);

    await useData.getState().archiveSession(SES);
    const db = useData.getState();

    // La ligne survit — c'est elle qui donne un nom à tout l'historique.
    expect(db.sessions.find((s) => s.id === SES)?.archivedAt).toBeTruthy();
    expect(db.subscriptions.find((s) => s.id === SUB)?.archivedAt).toBeTruthy();
    // …mais elle a quitté les écrans qui servent à travailler.
    expect(activeSessions(db).some((s) => s.id === SES)).toBe(false);
    expect(isArchivedSub(db, SUB)).toBe(true);
  });

  it("les présences, les paiements et le solde de l'élève survivent à la suppression", async () => {
    board();
    const [day] = scheduledDays(1);
    await attend(day);
    await useData
      .getState()
      .addSold({ studentId: STU, subscriptionId: SUB, amount: 2000, monthCode: "M1" });

    const soldBefore = soldFor(useData.getState(), STU, SUB);
    await useData.getState().archiveSession(SES);
    const db = useData.getState();

    expect(db.attendance.filter((a) => a.sessionId === SES && a.studentId === STU)).toHaveLength(1);
    expect(db.payments.filter((p) => p.studentId === STU && p.subscriptionId === SUB)).toHaveLength(1);
    expect(soldFor(db, STU, SUB)).toBe(soldBefore);
    // L'élève en est sorti — comme d'une désinscription — mais sa fiche garde
    // le module, daté de la sortie.
    const student = db.students.find((s) => s.id === STU)!;
    expect(student.subscriptionIds).not.toContain(SUB);
    expect(student.subscriptionDates?.[SUB]?.unsubscribedAt).toBeTruthy();
  });

  it("ce que l'emploi supprimé doit encore à l'enseignant reste réglable, et se dit", async () => {
    board();
    await attend(scheduledDays(1)[0]);
    await useData
      .getState()
      .addSold({ studentId: STU, subscriptionId: SUB, amount: 2000, monthCode: "M1" });

    await useData.getState().archiveSession(SES);

    const emploi = teacherEmplois(useData.getState(), TEACHER).find((e) => e.sessionId === SES);
    expect(emploi).toBeDefined();
    expect(emploi!.archived).toBe(true);
    expect(emploi!.payable).toBeGreaterThan(0);
  });

  it("retirer le tarif d'un cours l'archive aussi : les soldes ne partent pas avec", async () => {
    board();
    await useData
      .getState()
      .addSold({ studentId: STU, subscriptionId: SUB, amount: 2000, monthCode: "M1" });

    await useData.getState().deleteSubscriptionPrice(SES);
    const db = useData.getState();

    expect(db.subscriptions.find((s) => s.id === SUB)?.archivedAt).toBeTruthy();
    expect(db.enrollments.some((e) => e.studentId === STU && e.subscriptionId === SUB)).toBe(true);
    expect(soldFor(db, STU, SUB)).toBe(2000);
  });
});

// ---------------------------------------------------------------------------

describe("la scolarité d'un fils d'enseignant, réglée au guichet", () => {
  /** Un fils d'enseignant qui a consommé un mois entier et n'a rien versé. */
  async function childInDebt() {
    board();
    patch(STU, { studentCase: "teacher_child", teacherFatherId: TEACHER });
    for (const day of scheduledDays(4)) await attend(day);
    return -soldFor(useData.getState(), STU, SUB);
  }

  it("« la famille paie » encaisse en caisse et ne retient RIEN sur le salaire du père", async () => {
    const due = await childInDebt();
    expect(due).toBeGreaterThan(0);

    const res = await useData.getState().payTeacherChild({
      studentId: STU,
      subscriptionId: SUB,
      monthCode: "M1",
      amount: due,
      source: "cash",
    });
    expect(res.ok).toBe(true);

    const db = useData.getState();
    expect(soldFor(db, STU, SUB)).toBe(0);
    // L'argent est entré dans le tiroir…
    expect(db.cash.filter((c) => c.type === "student_payment")).toHaveLength(1);
    // …et rien n'attend d'être retenu au père.
    expect(teacherChildDebtTotal(db, TEACHER)).toBe(0);
    expect(cycleCredits(db, STU, SUB, "M1").family).toBe(due);
  });

  it("« porter sur le salaire du père » solde l'enfant sans caisse, et met la retenue en attente", async () => {
    const due = await childInDebt();

    const res = await useData.getState().payTeacherChild({
      studentId: STU,
      subscriptionId: SUB,
      monthCode: "M1",
      amount: due,
      source: "teacher_debt",
    });
    expect(res.ok).toBe(true);

    const db = useData.getState();
    // L'enfant est en règle : sa dette ne retient plus la part de l'enseignant.
    expect(soldFor(db, STU, SUB)).toBe(0);
    expect(studentHasDebt(db, STU)).toBe(false);
    // Aucun argent n'a traversé la caisse : l'école sera payée le jour de la paie.
    expect(db.cash.filter((c) => c.type === "student_payment")).toHaveLength(0);
    expect(cycleCredits(db, STU, SUB, "M1").charged).toBe(due);
    // …et la retenue attend, nommée, sur la fiche du père.
    expect(teacherChildDebtTotal(db, TEACHER)).toBe(due);
    expect(teacherChildRows(db, TEACHER)[0].lines[0].state).toBe("charged");
  });

  it("la retenue portée ne peut être prise qu'UNE fois", async () => {
    const due = await childInDebt();
    await useData.getState().payTeacherChild({
      studentId: STU,
      subscriptionId: SUB,
      monthCode: "M1",
      amount: due,
      source: "teacher_debt",
    });
    const debtId = useData.getState().teacherChildDebts[0].id;

    await useData.getState().payTeacherSessions({
      teacherId: TEACHER,
      dueIds: [],
      amount: 1000,
      method: "group",
      childDebtIds: [debtId],
    });

    const db = useData.getState();
    expect(db.teacherChildDebts[0].paid).toBe(true);
    // Elle a disparu des retenues ouvertes : la prochaine paie ne la reverra pas.
    expect(teacherChildDebtTotal(db, TEACHER)).toBe(0);
    expect(db.teacherPayments.at(-1)?.childDebts?.[0]?.amount).toBe(due);
  });

  it("un versement au guichet refusé sans père désigné", async () => {
    board();
    patch(STU, { studentCase: "teacher_child", teacherFatherId: undefined });
    const res = await useData.getState().payTeacherChild({
      studentId: STU,
      subscriptionId: SUB,
      monthCode: "M1",
      amount: 500,
      source: "teacher_debt",
    });
    expect(res.ok).toBe(false);
    expect(res.messageKey).toBe("student.noTeacherFather");
  });
});

// ---------------------------------------------------------------------------

describe("retirer un pointage rend exactement ce qu'il avait pris", () => {
  it("une présence d'un autre jour se retire et recrédite le solde", async () => {
    board();
    const days = scheduledDays(3);
    for (const day of days) await attend(day);
    const afterThree = soldFor(useData.getState(), STU, SUB);

    // Le PREMIER jour, pas celui qui est affiché : c'est tout l'enjeu.
    const res = await useData
      .getState()
      .setPresence({ studentId: STU, sessionId: SES, date: days[0], status: null });

    expect(res.ok).toBe(true);
    expect(res.refunded).toBe(500);
    expect(soldFor(useData.getState(), STU, SUB)).toBe(afterThree + 500);
    expect(
      useData.getState().attendance.filter((a) => a.studentId === STU && a.sessionId === SES),
    ).toHaveLength(2);
  });

  it("retirer une séance annulée ne rend rien — elle n'avait rien pris", async () => {
    board();
    const [day] = scheduledDays(1);
    await useData.getState().setPresence({ studentId: STU, sessionId: SES, date: day, status: "cancelled" });
    const before = soldFor(useData.getState(), STU, SUB);

    const res = await useData
      .getState()
      .setPresence({ studentId: STU, sessionId: SES, date: day, status: null });

    expect(res.refunded).toBe(0);
    expect(soldFor(useData.getState(), STU, SUB)).toBe(before);
  });
});

// ---------------------------------------------------------------------------

describe("l'école choisit ce qu'elle avance", () => {
  it("un montant explicite ne règle que ce qu'on a saisi, et ne débloque pas la part", async () => {
    board();
    for (const day of scheduledDays(4)) await attend(day);
    const due = -soldFor(useData.getState(), STU, SUB);
    expect(due).toBe(2000);

    const res = await useData.getState().coverStudentDebt({
      studentId: STU,
      lines: [{ subscriptionId: SUB, monthCode: "M1", amount: 500 }],
    });

    expect(res.ok).toBe(true);
    expect(res.amount).toBe(500);
    expect(soldFor(useData.getState(), STU, SUB)).toBe(-1500);
    // La dette n'est pas à zéro : la part de l'enseignant reste retenue.
    expect(studentHasDebt(useData.getState(), STU)).toBe(true);
  });

  it("avancer plus que le mois ne doit est plafonné au dû", async () => {
    board();
    for (const day of scheduledDays(4)) await attend(day);

    await useData.getState().coverStudentDebt({
      studentId: STU,
      lines: [{ subscriptionId: SUB, monthCode: "M1", amount: 99999 }],
    });

    // Le solde tombe à zéro, jamais au-dessus : l'école n'offre pas d'avance.
    expect(soldFor(useData.getState(), STU, SUB)).toBe(0);
    expect(studentHasDebt(useData.getState(), STU)).toBe(false);
  });

  it("sans liste, le bouton couvre toujours toute la dette", async () => {
    board();
    for (const day of scheduledDays(4)) await attend(day);

    await useData.getState().coverStudentDebt({ studentId: STU });

    expect(soldFor(useData.getState(), STU, SUB)).toBe(0);
    expect(studentHasDebt(useData.getState(), STU)).toBe(false);
    // Deux mouvements qui s'annulent : l'entrée portée à l'élève, la sortie
    // qui l'a financée.
    const cash = useData.getState().cash;
    expect(cash.filter((c) => c.type === "student_payment")).toHaveLength(1);
    expect(cash.filter((c) => c.type === "student_debt")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------

describe("les inscriptions d'un élève, lues en toutes lettres", () => {
  it("chaque ligne porte sa classe, son année et son emploi du temps", () => {
    board();
    const db = useData.getState();
    const rows = studentInscriptionRows(db, db.students.find((s) => s.id === STU)!);

    expect(rows).toHaveLength(1);
    expect(rows[0].subscriptionId).toBe(SUB);
    expect(rows[0].className).toBeTruthy();
    expect(rows[0].label).toBeTruthy();
    expect(rows[0].current).toBe(true);
    expect(rows[0].archived).toBe(false);
  });

  it("un emploi quitté reste lisible, daté de la sortie, quand on le demande", async () => {
    board();
    await useData.getState().unsubscribeStudent(STU, SUB);
    const db = useData.getState();
    const student = db.students.find((s) => s.id === STU)!;

    expect(studentInscriptionRows(db, student).some((r) => r.subscriptionId === SUB)).toBe(false);
    const left = studentInscriptionRows(db, student, { includePast: true }).find(
      (r) => r.subscriptionId === SUB,
    );
    expect(left).toBeDefined();
    expect(left!.current).toBe(false);
    expect(left!.leftOn).toBeTruthy();
  });
});
