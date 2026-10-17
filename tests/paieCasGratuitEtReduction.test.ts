import { describe, it, expect, beforeEach } from "vitest";
import { useData } from "@/lib/store/data";
import { buildSeed } from "@/tests/fixtures/seed";
import {
  cycleOf,
  studentCaseLabelFor,
  studentListPrice,
  studentMonthPrice,
  studentSchoolPerSeance,
  studentTeacherPerSeance,
} from "@/lib/helpers";
import { teacherEmplois } from "@/lib/teacherMonths";
import { buildPayBoard } from "@/lib/teacherPayBoard";
import type { AttendanceRecord, Teacher } from "@/lib/types";

/**
 * LA PAIE DE L'ENSEIGNANT FACE AUX DEUX CAS QUI LA FAISAIENT MENTIR.
 *
 *  1. UN EMPLOI OFFERT APRÈS COUP. L'élève passait « gratuit » sur l'emploi du
 *     temps, mais les parts écrites au cas d'avant restaient : l'écran de paie
 *     l'affichait « offert » et réglait quand même sa part entière, comme pour
 *     un élève ordinaire. Il reste listé, à ZÉRO — l'enseignant n'est pas payé
 *     pour lui sur cet emploi-là.
 *
 *  2. UNE RÉDUCTION EN MONTANT FIXE. Le montant était retiré de CHAQUE séance :
 *     600 DA de remise enseignant sur une part de 600 DA la séance laissaient
 *     l'enseignant à zéro (et la famille aussi). Le montant est celui du MOIS
 *     et se répartit sur ses séances.
 *
 * L'emploi du temps de ce tableau : 4 séances, mois à 4 000 DA dont 1 600 pour
 * l'école — séance à 1 000 DA, partagée 400 école / 600 enseignant.
 */

const SUB = "sub-1";
const SES = "ses-1";
/** l'autre emploi du même enseignant */
const SUB2 = "sub-2";
const SES2 = "ses-2";
const STU = "stu-1";
const OTHER = "stu-2";
const TEACHER = "tea-1";

const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function board() {
  const db = buildSeed();
  const sub = db.subscriptions.find((s) => s.id === SUB)!;
  sub.monthlySeances = 4;
  sub.monthlyPrice = 4000;
  sub.pricePerSession = 1000;
  sub.schoolMonthShare = 1600;
  sub.teacherPerSeance = 600;

  db.attendance = [];
  db.payments = [];
  db.unpaidTeacher = [];
  db.independent = [];
  db.freePeriods = [];
  db.teacherPayments = [];
  db.teacherExpenses = [];
  db.acomptes = [];
  db.teacherChildDebts = [];
  db.enrollments = db.enrollments.filter((e) => e.subscriptionId !== SUB && e.subscriptionId !== SUB2);

  const opened = new Date();
  opened.setDate(opened.getDate() - 400);
  const openedIso = opened.toLocaleDateString("fr-CA");
  const dates = { subscribedAt: openedIso, startDate: openedIso };
  db.students = db.students.map((st) =>
    st.id === STU
      ? {
          ...st,
          isFree: false,
          studentCase: "normal" as const,
          registrationDue: 0,
          subscriptionIds: [SUB, SUB2],
          subscriptionDates: { [SUB]: dates, [SUB2]: dates },
        }
      : st.id === OTHER
        ? {
            ...st,
            isFree: false,
            studentCase: "normal" as const,
            registrationDue: 0,
            subscriptionIds: [SUB],
            subscriptionDates: { [SUB]: dates },
          }
        : {
            ...st,
            subscriptionIds: st.subscriptionIds.filter((id) => id !== SUB && id !== SUB2),
          },
  );
  for (const id of [SES, SES2]) db.sessions.find((s) => s.id === id)!.teacherId = TEACHER;
  useData.setState(db);
}

/** N jours où l'emploi tourne réellement, du plus ancien. */
function scheduledDays(sessionId: string, count: number): string[] {
  const session = useData.getState().sessions.find((s) => s.id === sessionId)!;
  const out: string[] = [];
  const d = new Date();
  d.setDate(d.getDate() - 120);
  while (out.length < count) {
    if (session.days.includes(DAY_KEYS[d.getDay()] as never)) out.push(d.toLocaleDateString("fr-CA"));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

const attend = (studentId: string, date: string, sessionId = SES) =>
  useData.getState().setPresence({ studentId, sessionId, date, status: "present" });

/** Écrit le cas sur la fiche, exactement comme l'écran de modification. */
const setCase = (fields: Record<string, unknown>) =>
  useData.getState().updateItem("students", STU, fields);

const makeFree = (subIds: string[] = [SUB]) =>
  setCase({ studentCase: "special", isFree: true, freeSubscriptionIds: subIds });

const pay = (studentId: string, amount: number, subscriptionId = SUB) =>
  useData.getState().addSold({ studentId, subscriptionId, amount, monthCode: "M1" });

const teacherOf = (): Teacher => useData.getState().teachers.find((t) => t.id === TEACHER)!;
const emploiOf = (sessionId: string) =>
  teacherEmplois(useData.getState(), TEACHER).find((e) => e.sessionId === sessionId)!;
const boardOf = (sessionId = SES) =>
  buildPayBoard(useData.getState(), teacherOf(), emploiOf(sessionId), "M1");
const rowOf = (studentId: string, sessionId = SES) =>
  boardOf(sessionId).students.find((r) => r.studentId === studentId)!;
const duesOf = (studentId: string) =>
  useData.getState().unpaidTeacher.filter((u) => u.studentId === studentId);

beforeEach(board);

// ---------------------------------------------------------------------------

describe("un emploi du temps offert ne paie plus l'enseignant", () => {
  it("l'élève reste listé, à zéro, même pour les séances pointées AVANT d'être offert", async () => {
    const days = scheduledDays(SES, 4);
    // Il paie son mois et suit deux séances comme un élève ordinaire…
    await pay(STU, 4000);
    await pay(OTHER, 4000);
    for (const day of days.slice(0, 2)) {
      await attend(STU, day);
      await attend(OTHER, day);
    }
    expect(duesOf(STU).map((u) => u.amount)).toEqual([600, 600]);

    // … puis la réception lui coche cet emploi OFFERT. Il n'a aucune dette :
    // l'écran ne pose même pas la question des dettes.
    makeFree();
    for (const day of days.slice(2)) {
      await attend(STU, day);
      await attend(OTHER, day);
    }

    const row = rowOf(STU);
    expect(row.payState).toBe("free");
    expect(row.perSeance).toBe(0);
    expect(row.amount).toBe(0);
    expect(row.seances).toBe(0);
    // L'autre élève du groupe, lui, rapporte ses quatre parts entières.
    expect(rowOf(OTHER).amount).toBe(4 * 600);
    expect(boardOf().studentsTotal).toBe(4 * 600);
    expect(emploiOf(SES).months[0].gross).toBe(4 * 600);
  });

  for (const mode of ["keep", "clear"] as const) {
    it(`vaut quelle que soit la réponse sur ses dettes (« ${mode} »)`, async () => {
      // Deux séances jamais payées : 2 000 DA de dette au tarif d'avant.
      for (const day of scheduledDays(SES, 2)) await attend(STU, day);
      makeFree();
      await useData.getState().convertStudentCase({ studentId: STU, mode });

      const row = rowOf(STU);
      expect(row.amount).toBe(0);
      expect(row.withheld).toBe(false);
      expect(boardOf().studentsTotal).toBe(0);
      // La réponse ne décide que de ce que la FAMILLE doit encore.
      expect(cycleOf(useData.getState(), STU, SUB, "M1").balance).toBe(mode === "keep" ? -2000 : 0);
    });
  }

  it("une part déjà RÉGLÉE reste dans l'historique, et elle seule", async () => {
    await pay(STU, 4000);
    for (const day of scheduledDays(SES, 2)) await attend(STU, day);
    // La première séance a déjà été versée à l'enseignant.
    const first = duesOf(STU)[0];
    useData.setState((s) => ({
      unpaidTeacher: s.unpaidTeacher.map((u) => (u.id === first.id ? { ...u, paid: true } : u)),
    }));

    makeFree();
    expect(useData.getState().dropVoidTeacherDues(STU)).toBe(1);
    expect(duesOf(STU).map((u) => ({ id: u.id, paid: u.paid }))).toEqual([
      { id: first.id, paid: true },
    ]);

    const row = rowOf(STU);
    expect(row.amount).toBe(0);
    expect(row.alreadyPaid).toBe(600);
  });

  it("retire de la base les seules parts des emplois offerts, et une seule fois", async () => {
    const days = scheduledDays(SES, 2);
    const days2 = scheduledDays(SES2, 2);
    await pay(STU, 4000);
    await pay(STU, 1200, SUB2);
    await pay(OTHER, 4000);
    for (const day of days) {
      await attend(STU, day);
      await attend(OTHER, day);
    }
    for (const day of days2) await attend(STU, day, SES2);
    const onSes2 = duesOf(STU).filter((u) => u.sessionId === SES2);
    expect(onSes2).toHaveLength(2);

    // Offert sur le premier emploi SEULEMENT : il paie toujours le second.
    makeFree([SUB]);
    // Sans élève désigné, la passe couvre toute l'école — c'est elle que le
    // chargement de l'application lance.
    expect(useData.getState().dropVoidTeacherDues()).toBe(2);
    expect(useData.getState().dropVoidTeacherDues()).toBe(0);

    expect(duesOf(STU).filter((u) => u.sessionId === SES)).toHaveLength(0);
    expect(duesOf(STU).filter((u) => u.sessionId === SES2)).toEqual(onSes2);
    // Ni l'autre élève, ni l'autre emploi ne perdent quoi que ce soit.
    expect(duesOf(OTHER)).toHaveLength(2);
    expect(rowOf(STU, SES2).amount).toBe(onSes2.reduce((s, u) => s + u.amount, 0));
  });
});

// ---------------------------------------------------------------------------

describe("une réduction en montant fixe se lit sur le MOIS", () => {
  const monthly = { type: "amount" as const, schoolValue: 400, teacherValue: 600 };

  it("400 DA école + 600 DA enseignant de remise sur le mois : l'enseignant touche 1 800 DA, pas zéro", async () => {
    setCase({ studentCase: "reduction", subscriptionReductions: { [SUB]: monthly } });
    const st = () => useData.getState().students.find((s) => s.id === STU)!;
    const sub = () => useData.getState().subscriptions.find((s) => s.id === SUB)!;

    // 1 600 − 400 = 1 200 pour l'école, 2 400 − 600 = 1 800 pour l'enseignant :
    // la famille paie 3 000 DA le mois, soit 750 DA la séance.
    expect(studentSchoolPerSeance(st(), sub())).toBe(300);
    expect(studentTeacherPerSeance(st(), sub(), TEACHER)).toBe(450);
    expect(studentListPrice(st(), sub())).toBe(750);
    expect(studentMonthPrice(st(), sub())).toBe(3000);
    expect(studentCaseLabelFor(st(), SUB)).toBe(
      "Réduction · école -400 DA/mois · enseignant -600 DA/mois",
    );

    await pay(STU, 3000);
    for (const day of scheduledDays(SES, 4)) await attend(STU, day);
    expect(
      useData.getState().attendance.filter((a) => a.studentId === STU).map((a) => a.amountDeducted),
    ).toEqual([750, 750, 750, 750]);
    expect(duesOf(STU).map((u) => u.amount)).toEqual([450, 450, 450, 450]);

    const row = rowOf(STU);
    expect(row.perSeance).toBe(450);
    expect(row.amount).toBe(1800);
    expect(row.withheld).toBe(false);
    expect(row.payState).toBe("paid");
    expect(boardOf().studentsTotal).toBe(1800);
  });

  it("les séances pointées à 0 DA par l'ancien calcul se relisent au bon tarif, sans script", async () => {
    setCase({ studentCase: "reduction", subscriptionReductions: { [SUB]: monthly } });
    // Exactement ce que l'ancien calcul écrivait : la séance à 0 DA et aucune
    // part pour l'enseignant, la remise ayant tout effacé.
    const records: AttendanceRecord[] = scheduledDays(SES, 4).map((day, i) => ({
      id: `att-ancien-${i}`,
      studentId: STU,
      sessionId: SES,
      timestamp: new Date(`${day}T08:00:00`).toISOString(),
      amountDeducted: 0,
      status: "present",
      waivedAmount: 0,
    }));
    useData.setState((s) => ({ attendance: [...s.attendance, ...records] }));
    await pay(STU, 3000);

    expect(cycleOf(useData.getState(), STU, SUB, "M1").consumed).toBe(3000);
    expect(cycleOf(useData.getState(), STU, SUB, "M1").balance).toBe(0);
    const row = rowOf(STU);
    expect(row.amount).toBe(1800);
    expect(row.withheld).toBe(false);
  });

  it("un enseignant au pourcentage, sur un emploi sans pack, ne supporte que sa remise du mois", async () => {
    // L'emploi n'a ni pack ni répartition : l'enseignant y touche 60 % de ce
    // que la séance coûte à l'élève.
    useData.setState((s) => ({
      subscriptions: s.subscriptions.map((x) =>
        x.id === SUB2
          ? {
              ...x,
              pricePerSession: 600,
              monthlySeances: 0,
              monthlyPrice: 0,
              schoolMonthShare: undefined,
              teacherPerSeance: undefined,
            }
          : x,
      ),
    }));
    // Sans pack, le mois de l'emploi compte 4 séances : 400 / 200 DA sur le
    // mois font 100 / 50 DA la séance.
    setCase({
      studentCase: "reduction",
      subscriptionReductions: { [SUB2]: { type: "amount", schoolValue: 400, teacherValue: 200 } },
    });
    const [day] = scheduledDays(SES2, 1);
    await attend(STU, day, SES2);

    // 600 − 100 = 500 pour la famille ; 60 % de 500 = 300, moins 50 = 250.
    const rec = useData.getState().attendance.find((a) => a.studentId === STU && a.sessionId === SES2)!;
    expect(rec.amountDeducted).toBe(500);
    expect(duesOf(STU).find((u) => u.sessionId === SES2)!.amount).toBe(250);
  });

  it("le pourcentage, lui, ne change pas", async () => {
    setCase({
      studentCase: "reduction",
      subscriptionReductions: { [SUB]: { type: "percent", schoolValue: 20, teacherValue: 20 } },
    });
    await pay(STU, 3200);
    for (const day of scheduledDays(SES, 4)) await attend(STU, day);
    const row = rowOf(STU);
    expect(row.perSeance).toBe(480);
    expect(row.amount).toBe(1920);
    expect(row.withheld).toBe(false);
  });
});
