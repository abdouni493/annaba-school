import { describe, it, expect, beforeEach } from "vitest";
import { useData } from "@/lib/store/data";
import { buildSeed } from "@/tests/fixtures/seed";
import {
  settlementChildLabel,
  settlementChildLines,
  soldFor,
  subscriptionLabel,
  teacherChildDebtEmploi,
} from "@/lib/helpers";
import { buildPayBoard, freezeBoard, payEmplois } from "@/lib/teacherPayBoard";

/**
 * POUR QUEL COURS DE SON FILS L'ENSEIGNANT EST-IL RETENU ?
 *
 * Quand la réception solde la scolarité d'un fils d'enseignant en la portant
 * sur le salaire de son père, celui-ci lisait « Scolarité — Yacine · −1 500 DA »
 * et rien de plus : ni le module, ni la classe, ni la salle. Un enfant inscrit
 * à trois emplois du temps rendait la retenue invérifiable — laquelle des trois
 * scolarités venait-il de payer ?
 *
 * L'emploi du temps voyage donc désormais avec la somme, de bout en bout :
 *
 *   la feuille de présence  →  la ligne portée sur le père
 *                           →  la table des retenues de son écran de paie
 *                           →  la photographie figée du règlement
 *                           →  « voir le détail » et la fiche de paie réimprimée
 *
 * Et il ne se perd à aucune de ces étapes, même des mois plus tard, même si
 * l'emploi du temps a été archivé entre-temps.
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
          studentCase: "teacher_child" as const,
          teacherFatherId: TEACHER,
          registrationDue: 0,
          subscriptionIds: [SUB],
          subscriptionDates: { [SUB]: { subscribedAt: openedIso, startDate: openedIso } },
        }
      : { ...st, subscriptionIds: st.subscriptionIds.filter((id) => id !== SUB) },
  );
  db.sessions.find((s) => s.id === SES)!.teacherId = TEACHER;

  useData.setState(db);
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

/** Le fils suit son mois entier sans rien verser : il doit sa scolarité. */
async function childInDebt(): Promise<number> {
  board();
  for (const day of scheduledDays(4)) {
    await useData
      .getState()
      .setPresence({ studentId: STU, sessionId: SES, date: day, status: "present" });
  }
  return -soldFor(useData.getState(), STU, SUB);
}

/** Le nom que l'écran de paie donne à cet emploi du temps. */
function emploiName(): string {
  const db = useData.getState();
  return subscriptionLabel(db, db.subscriptions.find((s) => s.id === SUB)!);
}

beforeEach(() => {
  useData.setState(buildSeed());
});

describe("la scolarité portée sur le père dit POUR QUEL emploi du temps", () => {
  it("la ligne portée garde le nom de l'emploi du temps, pas seulement son identifiant", async () => {
    const due = await childInDebt();
    await useData.getState().payTeacherChild({
      studentId: STU,
      subscriptionId: SUB,
      monthCode: "M1",
      amount: due,
      source: "teacher_debt",
    });

    const db = useData.getState();
    const debt = db.teacherChildDebts[0];
    expect(debt.subscriptionId).toBe(SUB);
    expect(debt.monthCode).toBe("M1");
    // Le NOM, recopié : c'est ce que le père lit, pas un identifiant.
    expect(debt.emploi).toBe(emploiName());
    expect(teacherChildDebtEmploi(db, debt)).toBe(emploiName());
  });

  it("une ligne d'avant la colonne retrouve son emploi du temps par elle-même", async () => {
    const due = await childInDebt();
    await useData.getState().payTeacherChild({
      studentId: STU,
      subscriptionId: SUB,
      monthCode: "M1",
      amount: due,
      source: "teacher_debt",
    });

    // Une ligne écrite avant que le nom ne soit figé : elle ne porte que
    // l'identifiant de l'emploi du temps, comme celles déjà en base.
    useData.setState((s) => ({
      teacherChildDebts: s.teacherChildDebts.map((d) => ({ ...d, emploi: undefined })),
    }));

    const db = useData.getState();
    expect(teacherChildDebtEmploi(db, db.teacherChildDebts[0])).toBe(emploiName());
  });

  it("un emploi du temps archivé continue de nommer la retenue", async () => {
    const due = await childInDebt();
    await useData.getState().payTeacherChild({
      studentId: STU,
      subscriptionId: SUB,
      monthCode: "M1",
      amount: due,
      source: "teacher_debt",
    });
    const named = emploiName();

    await useData.getState().archiveSession(SES);

    const db = useData.getState();
    expect(teacherChildDebtEmploi(db, db.teacherChildDebts[0])).toBe(named);
  });

  it("la table des retenues de l'écran de paie nomme l'emploi du temps et son mois", async () => {
    const due = await childInDebt();
    await useData.getState().payTeacherChild({
      studentId: STU,
      subscriptionId: SUB,
      monthCode: "M1",
      amount: due,
      source: "teacher_debt",
    });

    const db = useData.getState();
    const emploi = payEmplois(db, TEACHER).find((e) => e.sessionId === SES)!;
    const father = db.teachers.find((t) => t.id === TEACHER)!;
    const pay = buildPayBoard(db, father, emploi, "M1")!;
    const line = pay.deductions.find((d) => d.kind === "child_debt")!;

    expect(line.emploi).toBe(emploiName());
    expect(line.monthCode).toBe("M1");
    expect(line.description).toContain(emploiName());
  });

  it("la photographie figée du règlement garde l'emploi du temps de la retenue", async () => {
    const due = await childInDebt();
    await useData.getState().payTeacherChild({
      studentId: STU,
      subscriptionId: SUB,
      monthCode: "M1",
      amount: due,
      source: "teacher_debt",
    });

    const db = useData.getState();
    const emploi = payEmplois(db, TEACHER).find((e) => e.sessionId === SES)!;
    const father = db.teachers.find((t) => t.id === TEACHER)!;
    const pay = buildPayBoard(db, father, emploi, "M1")!;
    const debtId = db.teacherChildDebts[0].id;

    const frozen = freezeBoard(db, pay, {
      studentIds: [],
      arrearKeys: [],
      passagerIds: [],
      deductionIds: [debtId],
    });
    const line = frozen.deductions.find((d) => d.kind === "child_debt")!;

    expect(line.emploi).toBe(emploiName());
    expect(line.monthCode).toBe("M1");
  });

  it("« voir le détail » du règlement nomme l'enfant, son emploi du temps et son mois", async () => {
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
    const payment = db.teacherPayments.at(-1)!;

    // Le règlement fige la retenue avec son emploi du temps…
    const snapshot = payment.childDebts![0];
    expect(snapshot.emploi).toBe(emploiName());
    expect(snapshot.monthCode).toBe("M1");
    expect(snapshot.description).toContain(emploiName());

    // …et l'écran la relit sans jamais avoir à deviner.
    const [line] = settlementChildLines(db, payment);
    expect(line.emploi).toBe(emploiName());
    expect(line.monthCode).toBe("M1");
    expect(line.origin).toBe("advanced");
    expect(line.amount).toBe(due);
    expect(settlementChildLabel(line)).toContain(emploiName());
  });

  it("un vieux règlement, muet sur l'emploi, le retrouve par sa ligne d'origine", async () => {
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

    // Un règlement enregistré avant que l'emploi soit figé sur la retenue.
    useData.setState((s) => ({
      teacherPayments: s.teacherPayments.map((p) => ({
        ...p,
        childDebts: (p.childDebts ?? []).map((d) => ({
          ...d,
          emploi: undefined,
          monthCode: undefined,
          studentName: undefined,
        })),
      })),
    }));

    const db = useData.getState();
    const [line] = settlementChildLines(db, db.teacherPayments.at(-1)!);
    // La ligne d'origine survit au règlement : elle sait encore quel cours a
    // été payé, et par qui.
    expect(line.emploi).toBe(emploiName());
    expect(line.monthCode).toBe("M1");
    expect(line.studentName).not.toContain("Scolarité");
  });
});
