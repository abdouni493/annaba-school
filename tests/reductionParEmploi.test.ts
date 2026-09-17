import { describe, it, expect, beforeEach } from "vitest";
import { useData } from "@/lib/store/data";
import { buildSeed } from "@/tests/fixtures/seed";
import {
  hasReductionOnSub,
  reducedSubIdsOf,
  reductionForSub,
  studentCaseLabel,
  studentCaseLabelFor,
  studentListPrice,
  studentMonthPrice,
  studentSchoolPerSeance,
  studentTeacherPerSeance,
} from "@/lib/helpers";
import { teacherEmplois } from "@/lib/teacherMonths";

/**
 * LA RÉDUCTION SE COCHE EMPLOI DU TEMPS PAR EMPLOI DU TEMPS.
 *
 * Il n'y a plus de remise générale. À chaque emploi coché, la réception répond
 * « réduction sur celui-ci ? » :
 *
 *  - NON : tout s'y calcule NORMALEMENT — la famille paie le tarif entier et
 *    l'enseignant touche sa part entière, exactement comme pour un élève
 *    ordinaire ;
 *  - OUI : l'emploi porte SA remise, avec sa part école et sa part enseignant.
 *
 * Les deux emplois du temps de ce tableau sont identiques — 4 séances, mois à
 * 2 000 DA dont 800 pour l'école, soit 500 DA la séance partagée 200 / 300 —
 * et un seul porte une réduction. Tout ce que le fichier vérifie tient dans
 * cette différence-là.
 */

const SUB_ON = "sub-1"; // l'emploi du temps RÉDUIT
const SES_ON = "ses-1";
const SUB_OFF = "sub-2"; // celui que la réception n'a pas réduit
const SES_OFF = "ses-2";
const STU = "stu-1";
const TEACHER = "tea-1";

const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function board() {
  const db = buildSeed();
  for (const [id, ses] of [
    [SUB_ON, SES_ON],
    [SUB_OFF, SES_OFF],
  ] as const) {
    const sub = db.subscriptions.find((s) => s.id === id)!;
    sub.monthlySeances = 4;
    sub.monthlyPrice = 2000;
    sub.pricePerSession = 500;
    sub.schoolMonthShare = 800;
    sub.teacherPerSeance = 300;
    const session = db.sessions.find((s) => s.id === ses)!;
    session.teacherId = TEACHER;
  }
  db.attendance = [];
  db.payments = [];
  db.unpaidTeacher = [];
  db.freePeriods = [];

  const opened = new Date();
  opened.setDate(opened.getDate() - 400);
  const openedIso = opened.toLocaleDateString("fr-CA");
  db.students = db.students.map((st) =>
    st.id === STU
      ? {
          ...st,
          isFree: false,
          studentCase: "reduction" as const,
          registrationDue: 0,
          // L'école accorde 50% de SA part (200 -> 100), l'enseignant 10% de la
          // sienne (300 -> 270) — SUR LE PREMIER EMPLOI DU TEMPS SEULEMENT.
          subscriptionReductions: {
            [SUB_ON]: { type: "percent" as const, schoolValue: 50, teacherValue: 10 },
          },
          subscriptionIds: [SUB_ON, SUB_OFF],
          subscriptionDates: {
            [SUB_ON]: { subscribedAt: openedIso, startDate: openedIso },
            [SUB_OFF]: { subscribedAt: openedIso, startDate: openedIso },
          },
        }
      : { ...st, subscriptionIds: st.subscriptionIds.filter((id) => id !== SUB_ON && id !== SUB_OFF) },
  );
  useData.setState(db);
}

const studentOf = () => useData.getState().students.find((s) => s.id === STU)!;
const subOf = (id: string) => useData.getState().subscriptions.find((s) => s.id === id)!;

function patch(fields: Record<string, unknown>) {
  useData.setState((s) => ({
    students: s.students.map((st) => (st.id === STU ? { ...st, ...fields } : st)),
  }));
}

/** N jours consécutifs où l'emploi tourne réellement, du plus ancien. */
function scheduledDays(sessionId: string, count: number): string[] {
  const session = useData.getState().sessions.find((s) => s.id === sessionId)!;
  const out: string[] = [];
  const d = new Date();
  d.setDate(d.getDate() - 200);
  while (out.length < count) {
    if (session.days.includes(DAY_KEYS[d.getDay()] as never)) out.push(d.toLocaleDateString("fr-CA"));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

const attend = (sessionId: string, date: string) =>
  useData.getState().setPresence({ studentId: STU, sessionId, date, status: "present" });

describe("« réduction », emploi du temps par emploi du temps", () => {
  beforeEach(board);

  it("ne s'applique qu'à l'emploi du temps coché", () => {
    const st = studentOf();
    expect(hasReductionOnSub(st, SUB_ON)).toBe(true);
    expect(hasReductionOnSub(st, SUB_OFF)).toBe(false);
    expect(reducedSubIdsOf(st)).toEqual([SUB_ON]);
    expect(reductionForSub(st, SUB_ON)).toEqual({
      type: "percent",
      schoolValue: 50,
      teacherValue: 10,
    });
    expect(reductionForSub(st, SUB_OFF)).toBeUndefined();
  });

  it("fait payer le tarif réduit sur l'emploi coché, le tarif plein sur l'autre", () => {
    const st = studentOf();
    // 200 -> 100 côté école, 300 -> 270 côté enseignant : 370 la séance.
    expect(studentSchoolPerSeance(st, subOf(SUB_ON))).toBe(100);
    expect(studentTeacherPerSeance(st, subOf(SUB_ON), TEACHER)).toBe(270);
    expect(studentListPrice(st, subOf(SUB_ON))).toBe(370);
    expect(studentMonthPrice(st, subOf(SUB_ON))).toBe(370 * 4);

    // L'autre emploi du temps ne bouge pas d'un dinar.
    expect(studentSchoolPerSeance(st, subOf(SUB_OFF))).toBe(200);
    expect(studentTeacherPerSeance(st, subOf(SUB_OFF), TEACHER)).toBe(300);
    expect(studentListPrice(st, subOf(SUB_OFF))).toBe(500);
    expect(studentMonthPrice(st, subOf(SUB_OFF))).toBe(2000);
  });

  it("facture la présence et paie l'enseignant au tarif de CHAQUE emploi du temps", async () => {
    const [dayOn] = scheduledDays(SES_ON, 1);
    const [dayOff] = scheduledDays(SES_OFF, 1);
    await attend(SES_ON, dayOn);
    await attend(SES_OFF, dayOff);

    const db = useData.getState();
    const on = db.attendance.find((a) => a.studentId === STU && a.sessionId === SES_ON)!;
    const off = db.attendance.find((a) => a.studentId === STU && a.sessionId === SES_OFF)!;
    expect(on.amountDeducted).toBe(370);
    expect(off.amountDeducted).toBe(500);

    const dueOn = db.unpaidTeacher.find((u) => u.studentId === STU && u.sessionId === SES_ON)!;
    const dueOff = db.unpaidTeacher.find((u) => u.studentId === STU && u.sessionId === SES_OFF)!;
    expect(dueOn.amount).toBe(270);
    expect(dueOff.amount).toBe(300);
  });

  it("annonce le bon tarif sur l'écran de paie de l'enseignant, emploi par emploi", () => {
    const emplois = teacherEmplois(useData.getState(), TEACHER);
    const rowOf = (sessionId: string) => {
      const emploi = emplois.find((e) => e.sessionId === sessionId)!;
      for (const month of emploi.months) {
        const row = month.students.find((s) => s.studentId === STU);
        if (row) return row;
      }
      throw new Error(`élève absent de l'emploi ${sessionId}`);
    };

    const on = rowOf(SES_ON);
    const off = rowOf(SES_OFF);
    expect(on.teacherPerSeance).toBe(270);
    expect(on.schoolPerSeance).toBe(100);
    expect(off.teacherPerSeance).toBe(300);
    expect(off.schoolPerSeance).toBe(200);
    // Le badge ne promet une remise que là où elle s'applique vraiment.
    expect(on.caseLabel).toContain("Réduction");
    expect(off.caseLabel).toBe("");
  });

  it("dit, sur chaque écran, ce qui vaut POUR CET emploi du temps", () => {
    const st = studentOf();
    expect(studentCaseLabelFor(st, SUB_ON)).toBe("Réduction · école -50% · enseignant -10%");
    expect(studentCaseLabelFor(st, SUB_OFF)).toBe("");
    // Sans emploi sous les yeux, la fiche dit combien d'emplois sont réduits.
    expect(studentCaseLabel(st)).toBe("Réduction · 1 emploi(s)");
  });

  it("une table VIDE veut dire « aucun emploi réduit », et non « tous »", () => {
    patch({ subscriptionReductions: {} });
    const st = studentOf();
    expect(hasReductionOnSub(st, SUB_ON)).toBe(false);
    expect(studentListPrice(st, subOf(SUB_ON))).toBe(500);
    expect(studentTeacherPerSeance(st, subOf(SUB_ON), TEACHER)).toBe(300);
    expect(studentCaseLabel(st)).toBe("Réduction · aucun emploi");
  });

  it("une remise à zéro ne retire rien, sur aucun des deux côtés", () => {
    patch({
      subscriptionReductions: {
        [SUB_ON]: { type: "percent", schoolValue: 0, teacherValue: 0 },
      },
    });
    const st = studentOf();
    expect(hasReductionOnSub(st, SUB_ON)).toBe(false);
    expect(studentListPrice(st, subOf(SUB_ON))).toBe(500);
  });

  it("garde le sens des fiches d'avant, qui ne portaient qu'une remise générale", () => {
    patch({
      subscriptionReductions: undefined,
      caseReduction: { type: "amount", schoolValue: 100, teacherValue: 50 },
    });
    const st = studentOf();
    // Sans table par emploi, la remise générale vaut PARTOUT — exactement comme
    // elle valait avant que la réduction ne se coche emploi par emploi.
    expect(studentListPrice(st, subOf(SUB_ON))).toBe(350);
    expect(studentListPrice(st, subOf(SUB_OFF))).toBe(350);
    expect(studentTeacherPerSeance(st, subOf(SUB_ON), TEACHER)).toBe(250);
    expect(reducedSubIdsOf(st)).toEqual([SUB_ON, SUB_OFF]);
    expect(studentCaseLabel(st)).toBe("Réduction");
  });

  it("la table par emploi l'emporte sur la remise générale d'une fiche rouverte", () => {
    patch({
      caseReduction: { type: "amount", schoolValue: 200, teacherValue: 300 },
      subscriptionReductions: {
        [SUB_ON]: { type: "percent", schoolValue: 50, teacherValue: 10 },
      },
    });
    const st = studentOf();
    expect(studentListPrice(st, subOf(SUB_ON))).toBe(370);
    // La remise générale ne « déborde » pas sur l'emploi non réduit.
    expect(studentListPrice(st, subOf(SUB_OFF))).toBe(500);
  });

  it("la remise en montant fixe s'arrête à la part, sans jamais passer sous zéro", () => {
    patch({
      subscriptionReductions: {
        [SUB_ON]: { type: "amount", schoolValue: 500, teacherValue: 50 },
      },
    });
    const st = studentOf();
    // 500 DA de remise école sur une part de 200 : elle s'arrête à 200.
    expect(studentSchoolPerSeance(st, subOf(SUB_ON))).toBe(0);
    expect(studentTeacherPerSeance(st, subOf(SUB_ON), TEACHER)).toBe(250);
    expect(studentListPrice(st, subOf(SUB_ON))).toBe(250);
  });

  it("recalcule les dettes au tarif de l'emploi du temps qui les porte", async () => {
    const [dayOn] = scheduledDays(SES_ON, 1);
    const [dayOff] = scheduledDays(SES_OFF, 1);
    // Il est d'abord un élève ordinaire : les deux séances coûtent 500.
    patch({ studentCase: "normal", subscriptionReductions: undefined });
    await attend(SES_ON, dayOn);
    await attend(SES_OFF, dayOff);
    expect(
      useData.getState().attendance.filter((a) => a.studentId === STU).map((a) => a.amountDeducted),
    ).toEqual([500, 500]);

    // La réception le passe en « réduction » sur le seul premier emploi, et
    // demande à recalculer ce qu'il devait déjà.
    patch({
      studentCase: "reduction",
      subscriptionReductions: {
        [SUB_ON]: { type: "percent", schoolValue: 50, teacherValue: 10 },
      },
    });
    await useData.getState().convertStudentCase({ studentId: STU, mode: "reprice" });

    const db = useData.getState();
    const on = db.attendance.find((a) => a.studentId === STU && a.sessionId === SES_ON)!;
    const off = db.attendance.find((a) => a.studentId === STU && a.sessionId === SES_OFF)!;
    expect(on.amountDeducted).toBe(370);
    expect(off.amountDeducted).toBe(500);
  });
});
