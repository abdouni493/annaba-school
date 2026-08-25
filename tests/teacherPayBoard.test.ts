import { describe, it, expect, beforeEach } from "vitest";
import { useData } from "@/lib/store/data";
import { buildSeed } from "@/tests/fixtures/seed";
import { teacherEmplois } from "@/lib/teacherMonths";
import {
  boardTotals,
  buildPayBoard,
  freezeBoard,
  monthTiles,
  PAY_MONTHS,
} from "@/lib/teacherPayBoard";
import type { Teacher } from "@/lib/types";

/**
 * L'ÉCRAN DE PAIE MOIS PAR MOIS.
 *
 * On règle UN mois d'UN emploi du temps, et cet écran montre trois tables :
 * les élèves du mois, les arriérés rattrapés, les retenues. Ces tests pilotent
 * les vraies actions du store — présence, solde, avance de l'école, règlement —
 * et relisent exactement ce que l'écran affiche.
 */

const SUB = "sub-1";
const SES = "ses-1";
const TEACHER = "tea-1";
const STU = "stu-1";
const STU2 = "stu-3";

const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** Un emploi du temps propre, tarifé au mois, avec les élèves demandés. */
function board(monthSeances = 4, studentIds: string[] = [STU]) {
  const db = buildSeed();
  const sub = db.subscriptions.find((s) => s.id === SUB)!;
  sub.monthlySeances = monthSeances;
  sub.monthlyPrice = 1800;
  sub.schoolMonthShare = 650;
  // 1 800 le mois, 650 pour l'école, 1 150 pour l'enseignant : sa séance vaut
  // 1 150 ÷ 4 = 287,50 DA — une division qui ne tombe PAS juste, exprès.
  sub.teacherPerSeance = (1800 - 650) / monthSeances;
  sub.pricePerSession = 1800 / monthSeances;

  db.attendance = [];
  db.payments = [];
  db.unpaidTeacher = [];
  db.independent = [];
  db.freePeriods = [];
  db.teacherPayments = [];
  db.teacherExpenses = [];
  db.acomptes = [];
  db.teacherChildDebts = [];
  db.enrollments = db.enrollments.filter((e) => e.subscriptionId !== SUB);

  const opened = new Date();
  opened.setDate(opened.getDate() - 400);
  const openedIso = opened.toLocaleDateString("fr-CA");
  db.students = db.students.map((st) =>
    studentIds.includes(st.id)
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

  useData.setState(db);
  return sub;
}

/** N jours consécutifs où l'emploi du temps tourne réellement. */
function scheduledDays(count: number): string[] {
  const session = useData.getState().sessions.find((s) => s.id === SES)!;
  const out: string[] = [];
  const d = new Date();
  d.setDate(d.getDate() - 120);
  while (out.length < count) {
    if (session.days.includes(DAY_KEYS[d.getDay()] as never)) out.push(d.toLocaleDateString("fr-CA"));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

const attend = (studentId: string, date: string, status: "present" | "absent" = "present") =>
  useData.getState().setPresence({ studentId, sessionId: SES, date, status });

const teacherOf = (): Teacher => useData.getState().teachers.find((t) => t.id === TEACHER)!;
const emploi = () => teacherEmplois(useData.getState(), TEACHER).find((e) => e.sessionId === SES)!;
const openBoard = (code: string) =>
  buildPayBoard(useData.getState(), teacherOf(), emploi(), code);

beforeEach(() => {
  useData.setState(buildSeed());
});

describe("la part de l'enseignant se calcule au centime", () => {
  it("part du mois ÷ séances × présences payables, décimales comprises", async () => {
    const sub = board(4);
    const days = scheduledDays(4);
    // Il paie son mois d'avance : rien n'est retenu.
    await useData
      .getState()
      .addSold({ studentId: STU, subscriptionId: SUB, amount: 1800, monthCode: "M1" });
    for (const day of days) await attend(STU, day);

    const b = openBoard("M1");
    expect(b.perSeance).toBeCloseTo(287.5, 2);
    expect(b.teacherMonthShare).toBe(1150);
    expect(b.monthPrice).toBe(1800);

    const row = b.students.find((r) => r.studentId === STU)!;
    expect(row.seances).toBe(4);
    expect(row.perSeance).toBeCloseTo(287.5, 2);
    // 4 × 287,50 = 1 150 — exactement la part enseignant du mois.
    expect(row.amount).toBeCloseTo(1150, 2);
    expect(row.withheld).toBe(false);
    expect(b.studentsTotal).toBeCloseTo(1150, 2);
    expect(sub.teacherPerSeance).toBeCloseTo(287.5, 2);
  });

  it("un élève qui n'a pas payé RETIENT sa part — elle n'entre pas dans le total", async () => {
    board(4, [STU, STU2]);
    const days = scheduledDays(4);
    // Le premier paie, le second non.
    await useData
      .getState()
      .addSold({ studentId: STU, subscriptionId: SUB, amount: 1800, monthCode: "M1" });
    for (const day of days) {
      await attend(STU, day);
      await attend(STU2, day);
    }

    const b = openBoard("M1");
    const payer = b.students.find((r) => r.studentId === STU)!;
    const debtor = b.students.find((r) => r.studentId === STU2)!;

    expect(payer.withheld).toBe(false);
    expect(debtor.withheld).toBe(true);
    expect(debtor.debt).toBeGreaterThan(0);
    // Seule la part du payeur est réglable aujourd'hui.
    expect(b.studentsTotal).toBeCloseTo(1150, 2);
    expect(b.withheldTotal).toBeCloseTo(1150, 2);
  });
});

describe("l'école avance la dette : la part se débloque et l'élève passe en rouge", () => {
  it("après l'avance, la part devient payable et la ligne est signalée", async () => {
    board(4, [STU2]);
    const days = scheduledDays(4);
    for (const day of days) await attend(STU2, day);

    const before = openBoard("M1").students.find((r) => r.studentId === STU2)!;
    expect(before.withheld).toBe(true);
    expect(before.schoolCovered).toBe(false);
    expect(before.totalDebt).toBeGreaterThan(0);

    const res = await useData.getState().coverStudentDebt({ studentId: STU2 });
    expect(res.ok).toBe(true);

    const after = openBoard("M1").students.find((r) => r.studentId === STU2)!;
    expect(after.withheld).toBe(false);
    // C'est ce drapeau que la table affiche en rouge, et que le filtre lit.
    expect(after.schoolCovered).toBe(true);
    expect(after.amount).toBeCloseTo(1150, 2);
  });
});

describe("les arriérés appartiennent à leur mois d'origine", () => {
  it("un élève qui paie en retard réapparaît sur le mois SUIVANT, jamais dans le mois courant", async () => {
    board(4, [STU, STU2]);
    const days = scheduledDays(8);

    // --- M1 : le premier paie, le second non ----------------------------
    await useData
      .getState()
      .addSold({ studentId: STU, subscriptionId: SUB, amount: 1800, monthCode: "M1" });
    for (const day of days.slice(0, 4)) {
      await attend(STU, day);
      await attend(STU2, day);
    }

    const m1 = openBoard("M1");
    const picked = {
      studentIds: m1.students.filter((r) => !r.withheld).map((r) => r.studentId),
      arrearKeys: [],
      deductionIds: [],
    };
    const totals = boardTotals(m1, picked);
    const frozen = freezeBoard(useData.getState(), m1, picked);

    const paid = await useData.getState().payTeacherSessions({
      teacherId: TEACHER,
      dueIds: m1.students.filter((r) => !r.withheld).flatMap((r) => r.dueIds),
      amount: totals.net,
      gross: totals.gross,
      method: "group",
      months: [
        {
          sessionId: SES,
          title: "Emploi",
          groupName: "Groupe",
          monthCode: "M1",
          seances: m1.held,
          presents: 4,
          students: 1,
          gross: totals.students,
        },
      ],
      board: frozen,
    });
    expect(paid.ok).toBe(true);

    // --- M2 : le retardataire s'acquitte de son M1 ------------------------
    // Il paie aussi son M2 : tant qu'il doit QUOI QUE CE SOIT, sa part reste
    // retenue — c'est la dette entière qui bloque, pas seulement le mois.
    await useData
      .getState()
      .addSold({ studentId: STU2, subscriptionId: SUB, amount: 1800, monthCode: "M1" });
    for (const day of days.slice(4, 8)) {
      await attend(STU, day);
      await attend(STU2, day);
    }
    await useData
      .getState()
      .addSold({ studentId: STU2, subscriptionId: SUB, amount: 1800, monthCode: "M2" });

    const m2 = openBoard("M2");
    // Sa part de M1 est due maintenant — mais elle est dans la TABLE 2, avec
    // son mois d'origine, pas mélangée aux élèves du M2.
    expect(m2.arrears).toHaveLength(1);
    expect(m2.arrears[0].studentId).toBe(STU2);
    expect(m2.arrears[0].monthCode).toBe("M1");
    expect(m2.arrears[0].seances).toBe(4);
    expect(m2.arrearsTotal).toBeCloseTo(1150, 2);
    // Et le M1, lui, est bien marqué comme réglé.
    const tiles = monthTiles(useData.getState(), emploi(), TEACHER);
    expect(tiles[0].state).toBe("paid");
    expect(tiles[0].settled).toBe(true);
  });
});

describe("la liste des mois va toujours de M1 à M12", () => {
  it("douze pastilles, avec l'état de chacune", async () => {
    board(4);
    const days = scheduledDays(3);
    for (const day of days) await attend(STU, day);

    const tiles = monthTiles(useData.getState(), emploi(), TEACHER);
    expect(tiles).toHaveLength(PAY_MONTHS);
    expect(tiles.map((t) => t.code)).toEqual(
      Array.from({ length: 12 }, (_, i) => `M${i + 1}`),
    );
    // « 3/4 » : le mois court encore, il n'est pas à régler.
    expect(tiles[0].held).toBe(3);
    expect(tiles[0].size).toBe(4);
    expect(tiles[0].complete).toBe(false);
    expect(tiles[0].state).not.toBe("payable");
    // Les mois jamais atteints existent quand même, vides.
    expect(tiles[11].held).toBe(0);
    expect(tiles[11].state).toBe("empty");
  });
});

describe("le règlement fige ses trois tables", () => {
  it("la photographie garde les lignes, les totaux et le net", async () => {
    board(4);
    const days = scheduledDays(4);
    await useData
      .getState()
      .addSold({ studentId: STU, subscriptionId: SUB, amount: 1800, monthCode: "M1" });
    for (const day of days) await attend(STU, day);

    // Une dépense avancée par l'école, retenue sur cette paie.
    useData.setState({
      teacherExpenses: [
        {
          id: "tex-1",
          teacherId: TEACHER,
          name: "Photocopies",
          amount: 150,
          date: days[0],
          paid: false,
        },
      ],
    });

    const b = openBoard("M1");
    const picked = {
      studentIds: b.students.map((r) => r.studentId),
      arrearKeys: [],
      deductionIds: b.deductions.filter((d) => d.selectable).map((d) => d.id),
    };
    const frozen = freezeBoard(useData.getState(), b, picked);

    expect(frozen.monthCode).toBe("M1");
    expect(frozen.students).toHaveLength(1);
    expect(frozen.studentsTotal).toBeCloseTo(1150, 2);
    expect(frozen.deductions).toHaveLength(1);
    expect(frozen.deductionsTotal).toBe(150);
    expect(frozen.gross).toBeCloseTo(1150, 2);
    expect(frozen.net).toBeCloseTo(1000, 2);
    // Le détail imprimé porte de quoi refaire la division à la main.
    expect(frozen.perSeance).toBeCloseTo(287.5, 2);
    expect(frozen.size).toBe(4);
  });
});
