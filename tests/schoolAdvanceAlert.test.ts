import { describe, it, expect, beforeEach } from "vitest";
import { useData } from "@/lib/store/data";
import { buildSeed } from "@/tests/fixtures/seed";
import { buildPayBoard, payEmplois } from "@/lib/teacherPayBoard";

/**
 * « AVANCÉ PAR L'ÉCOLE » — une alerte qui doit S'ÉTEINDRE.
 *
 * Quand une famille ne paie pas, l'école peut avancer la dette de sa propre
 * caisse pour débloquer la part de l'enseignant. La ligne de l'élève passe
 * alors en rouge sur l'écran de paie, avec la mention « avancé par l'école » :
 * c'est une information que la direction a le droit de lire.
 *
 * Elle restait pourtant collée à l'élève POUR TOUJOURS, et sur TOUS ses mois —
 * y compris le mois suivant, qu'il avait réglé lui-même, et y compris une fois
 * l'avance remboursée. Deux corrections :
 *
 *   1. l'avance appartient AU MOIS qu'elle a débloqué ;
 *   2. une avance remboursée n'est plus une avance — le frais que la caisse a
 *      inscrit au compte de l'élève dit exactement quand elle l'est.
 */

const SUB = "sub-1";
const SES = "ses-1";
const STU = "stu-1";
const TEACHER = "tea-1";

const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function board() {
  const db = buildSeed();
  const sub = db.subscriptions.find((s) => s.id === SUB)!;
  sub.monthlySeances = 2;
  sub.pricePerSession = 500;
  sub.monthlyPrice = 1000;
  sub.schoolMonthShare = 400;
  sub.teacherPerSeance = 300;
  db.attendance = [];
  db.payments = [];
  db.studentCharges = [];
  db.unpaidTeacher = [];
  db.freePeriods = [];
  db.teacherPayments = [];
  db.enrollments = db.enrollments.filter((e) => e.subscriptionId !== SUB);
  db.sessions = db.sessions.map((s) => (s.id === SES ? { ...s, teacherId: TEACHER } : s));

  const opened = new Date();
  opened.setDate(opened.getDate() - 400);
  const openedIso = opened.toLocaleDateString("fr-CA");
  db.students = db.students.map((st) =>
    st.id === STU
      ? {
          ...st,
          isFree: false,
          studentCase: "normal" as const,
          subscriptionIds: [SUB],
          subscriptionDates: { [SUB]: { subscribedAt: openedIso, startDate: openedIso } },
        }
      : { ...st, subscriptionIds: st.subscriptionIds.filter((id) => id !== SUB) },
  );
  useData.setState(db);
}

function scheduledDay(offsetBack: number): string {
  const session = useData.getState().sessions.find((s) => s.id === SES)!;
  const d = new Date();
  d.setDate(d.getDate() - offsetBack);
  while (!session.days.includes(DAY_KEYS[d.getDay()] as never)) d.setDate(d.getDate() + 1);
  return d.toLocaleDateString("fr-CA");
}

/** Quatre séances : M1 (impayé, avancé par l'école) puis M2 (payé au guichet). */
async function twoMonths() {
  const days: string[] = [];
  for (let back = 60; days.length < 4; back -= 3) {
    const day = scheduledDay(back);
    if (!days.includes(day)) days.push(day);
  }
  for (const day of days) {
    // eslint-disable-next-line no-await-in-loop
    await useData
      .getState()
      .setPresence({ studentId: STU, sessionId: SES, date: day, status: "present" });
  }
  return days;
}

const boardOf = (code: string) => {
  const db = useData.getState();
  const teacher = db.teachers.find((t) => t.id === TEACHER)!;
  const emploi = payEmplois(db, TEACHER).find((e) => e.sessionId === SES)!;
  return buildPayBoard(db, teacher, emploi, code);
};

describe("l'alerte « avancé par l'école »", () => {
  beforeEach(() => {
    board();
  });

  it("ne marque QUE le mois que l'avance a débloqué", async () => {
    await twoMonths();
    // L'école avance le M1 seulement.
    await useData.getState().coverStudentDebt({
      studentId: STU,
      subscriptionId: SUB,
      monthCode: "M1",
      description: "Avance de l'école",
    });

    const m1 = boardOf("M1").students.find((r) => r.studentId === STU)!;
    const m2 = boardOf("M2").students.find((r) => r.studentId === STU)!;
    expect(m1.schoolCovered).toBe(true);
    // M2 n'a jamais été avancé : il ne porte pas l'alerte du mois d'avant.
    expect(m2.schoolCovered).toBe(false);
  });

  it("s'éteint dès que la famille rembourse l'avance", async () => {
    await twoMonths();
    await useData.getState().coverStudentDebt({
      studentId: STU,
      subscriptionId: SUB,
      monthCode: "M1",
      description: "Avance de l'école",
    });
    expect(boardOf("M1").students.find((r) => r.studentId === STU)!.schoolCovered).toBe(true);

    // La famille passe au guichet et rembourse ce que l'école avait avancé :
    // le frais « avance de l'école » se solde, l'alerte n'a plus lieu d'être.
    const charge = useData
      .getState()
      .studentCharges.find((c) => c.studentId === STU && c.origin === "school_advance")!;
    expect(charge).toBeTruthy();
    await useData.getState().payStudentCharges({
      studentId: STU,
      lines: [{ chargeId: charge.id, amount: charge.amount }],
      description: "Remboursement de l'avance",
    });

    expect(boardOf("M1").students.find((r) => r.studentId === STU)!.schoolCovered).toBe(false);
  });
});
