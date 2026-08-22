import { describe, it, expect, beforeEach } from "vitest";
import { useData } from "@/lib/store/data";
import { buildSeed } from "@/tests/fixtures/seed";
import {
  cycleCredits,
  isFreeSub,
  studentDebtSummary,
  studentFullyFree,
  studentHasDebt,
  studentListPrice,
  studentMonthPrice,
  studentSchoolPerSeance,
  studentTeacherPerSeance,
} from "@/lib/helpers";
import { teacherEmplois } from "@/lib/teacherMonths";

/**
 * Trois règles que la réception vit tous les jours :
 *
 *  1. LA GRATUITÉ SE COCHE EMPLOI PAR EMPLOI. Un « cas spécial » peut suivre
 *     trois modules dont deux offerts et un payant : les offerts ne coûtent
 *     rien et ne rapportent rien, le payant est facturé comme pour n'importe
 *     quel élève, et l'enseignant y touche sa part.
 *
 *  2. UN FILS D'ENSEIGNANT PEUT PAYER AVANT SON PÈRE. Le versement de la
 *     famille passe par la caisse comme n'importe quel autre, et le mois n'est
 *     plus retenu sur le salaire.
 *
 *  3. L'ÉCOLE PEUT AVANCER LA DETTE D'UN ÉLÈVE pour ne pas faire attendre
 *     l'enseignant. La caisse porte alors DEUX mouvements qui s'annulent : le
 *     paiement porté au crédit de l'élève et la sortie qui l'a financé.
 */

const SUB = "sub-1";
const SUB2 = "sub-2";
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
  const session = db.sessions.find((s) => s.id === SES)!;
  session.teacherId = TEACHER;

  useData.setState(db);
  return sub;
}

function patch(id: string, fields: Record<string, unknown>) {
  useData.setState((s) => ({
    students: s.students.map((st) => (st.id === id ? { ...st, ...fields } : st)),
  }));
}

const studentOf = (id: string) => useData.getState().students.find((s) => s.id === id)!;
const subOf = (id: string) => useData.getState().subscriptions.find((s) => s.id === id)!;

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

const attend = (studentId: string, date: string) =>
  useData.getState().setPresence({ studentId, sessionId: SES, date, status: "present" });

beforeEach(() => {
  useData.setState(buildSeed());
});

// ---------------------------------------------------------------------------

describe("la gratuité, emploi du temps par emploi du temps", () => {
  it("une fiche sans liste reste entièrement offerte — rien ne change pour l'existant", () => {
    board();
    patch(STU, { studentCase: "special", isFree: true });
    const st = studentOf(STU);
    expect(isFreeSub(st, SUB)).toBe(true);
    expect(isFreeSub(st, SUB2)).toBe(true);
    expect(studentFullyFree(st)).toBe(true);
    expect(studentListPrice(st, subOf(SUB))).toBe(0);
    expect(studentTeacherPerSeance(st, subOf(SUB), TEACHER)).toBe(0);
  });

  it("un emploi coché « offert » ne coûte rien et ne rapporte rien", () => {
    board();
    patch(STU, { studentCase: "special", isFree: true, freeSubscriptionIds: [SUB] });
    const st = studentOf(STU);
    expect(isFreeSub(st, SUB)).toBe(true);
    expect(studentListPrice(st, subOf(SUB))).toBe(0);
    expect(studentMonthPrice(st, subOf(SUB))).toBe(0);
    expect(studentSchoolPerSeance(st, subOf(SUB))).toBe(0);
    expect(studentTeacherPerSeance(st, subOf(SUB), TEACHER)).toBe(0);
  });

  it("un emploi DÉCOCHÉ est facturé au tarif ordinaire, part enseignant comprise", () => {
    board();
    // Cas spécial, mais cet emploi-là n'est PAS dans la liste des offerts.
    patch(STU, { studentCase: "special", isFree: true, freeSubscriptionIds: [] });
    const st = studentOf(STU);
    expect(isFreeSub(st, SUB)).toBe(false);
    expect(studentFullyFree(st)).toBe(false);
    expect(studentListPrice(st, subOf(SUB))).toBe(500);
    expect(studentSchoolPerSeance(st, subOf(SUB))).toBe(200);
    expect(studentTeacherPerSeance(st, subOf(SUB), TEACHER)).toBe(300);
  });

  it("la présence suit la case cochée : offerte débite 0, décochée débite le prix", async () => {
    board();
    const [d1, d2] = scheduledDays(2);

    patch(STU, { studentCase: "special", isFree: true, freeSubscriptionIds: [SUB] });
    await attend(STU, d1);
    const offered = useData.getState().attendance.find((a) => a.studentId === STU)!;
    expect(offered.amountDeducted).toBe(0);
    expect(useData.getState().unpaidTeacher.filter((u) => u.studentId === STU)).toHaveLength(0);

    // La réception décoche « Offert » : l'emploi redevient payant.
    patch(STU, { freeSubscriptionIds: [] });
    await attend(STU, d2);
    const billed = useData
      .getState()
      .attendance.filter((a) => a.studentId === STU)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp))[1];
    expect(billed.amountDeducted).toBe(500);
    expect(
      useData.getState().unpaidTeacher.find((u) => u.studentId === STU)!.amount,
    ).toBe(300);
  });
});

// ---------------------------------------------------------------------------

describe("l'école avance la dette d'un élève", () => {
  /** Quatre séances jamais payées : 2000 DA de dette, la part prof est bloquée. */
  async function indebted() {
    board();
    for (const day of scheduledDays(4)) await attend(STU, day);
  }

  it("la dette bloque la part de l'enseignant tant qu'elle n'est pas réglée", async () => {
    await indebted();
    expect(studentHasDebt(useData.getState(), STU)).toBe(true);
    const emploi = teacherEmplois(useData.getState(), TEACHER).find((e) => e.sessionId === SES)!;
    expect(emploi.withheld).toBe(4 * 300);
    expect(emploi.payable).toBe(0);
  });

  it("la couvrir débloque la part et écrit DEUX mouvements de caisse qui s'annulent", async () => {
    await indebted();
    const before = useData.getState().cash.length;

    const res = await useData.getState().coverStudentDebt({ studentId: STU });
    expect(res.ok).toBe(true);
    expect(res.amount).toBe(2000);

    // La dette est soldée : la part de l'enseignant redevient payable.
    expect(studentHasDebt(useData.getState(), STU)).toBe(false);
    const emploi = teacherEmplois(useData.getState(), TEACHER).find((e) => e.sessionId === SES)!;
    expect(emploi.withheld).toBe(0);
    expect(emploi.payable).toBe(4 * 300);

    // Deux lignes dans l'historique, et un solde de caisse inchangé : l'école
    // n'a pas encaissé 2000 DA, elle les a avancés.
    const posted = useData.getState().cash.slice(before);
    expect(posted).toHaveLength(2);
    expect(posted.filter((c) => c.type === "student_payment")).toHaveLength(1);
    expect(posted.filter((c) => c.type === "student_debt")).toHaveLength(1);
    expect(posted.reduce((s, c) => s + c.amount, 0)).toBe(0);

    // Et le versement porte bien sa provenance.
    expect(cycleCredits(useData.getState(), STU, SUB, "M1")).toMatchObject({
      family: 0,
      school: 2000,
      salary: 0,
    });
  });

  it("elle couvre AUSSI les frais d'inscription, sans quoi la part resterait bloquée", async () => {
    await indebted();
    patch(STU, { registrationDue: 700 });
    expect(studentDebtSummary(useData.getState(), STU).total).toBe(2700);

    const res = await useData.getState().coverStudentDebt({ studentId: STU });
    expect(res.amount).toBe(2700);
    expect(studentOf(STU).registrationDue).toBe(0);
    expect(studentHasDebt(useData.getState(), STU)).toBe(false);
  });

  it("restreinte à un emploi du temps, elle ne touche que ses mois", async () => {
    await indebted();
    patch(STU, { registrationDue: 700 });

    await useData.getState().coverStudentDebt({ studentId: STU, subscriptionId: SUB });
    // Le solde de l'emploi est à zéro…
    expect(studentDebtSummary(useData.getState(), STU).soldDebt).toBe(0);
    // …mais les frais d'inscription restent dus, donc la part reste bloquée.
    expect(studentOf(STU).registrationDue).toBe(700);
    expect(studentHasDebt(useData.getState(), STU)).toBe(true);
  });

  it("ne fait rien quand il n'y a rien à couvrir", async () => {
    board();
    const res = await useData.getState().coverStudentDebt({ studentId: STU });
    expect(res.ok).toBe(false);
    expect(res.amount).toBe(0);
  });
});
