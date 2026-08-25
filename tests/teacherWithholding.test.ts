import { describe, it, expect, beforeEach } from "vitest";
import { useData } from "@/lib/store/data";
import { buildSeed } from "@/tests/fixtures/seed";
import { teacherEmplois } from "@/lib/teacherMonths";
import { buildPayBoard } from "@/lib/teacherPayBoard";
import { cycleOf, studentHasDebt, schoolAdvancedRows } from "@/lib/helpers";
import type { Teacher } from "@/lib/types";

/**
 * CE QUI RETIENT LA PART DE L'ENSEIGNANT.
 *
 * La règle a changé : ce n'est plus « l'élève doit quelque chose, quelque part »
 * — ce qui gelait la paie d'un enseignant pour un élève pourtant à jour chez
 * lui, sur la foi de frais d'inscription ou d'un autre groupe. C'est désormais
 * LA SÉANCE : tant que la séance qui a produit la part n'est pas payée sur ce
 * mois de cet emploi du temps, la part attend ; dès qu'elle l'est, elle se
 * règle.
 */

const SUB = "sub-1";
const SES = "ses-1";
const TEACHER = "tea-1";
const STU = "stu-1";

const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** Un emploi du temps à 4 séances : 2 000 DA le mois, 1 200 pour l'enseignant. */
function board(studentIds: string[] = [STU]) {
  const db = buildSeed();
  const sub = db.subscriptions.find((s) => s.id === SUB)!;
  sub.monthlySeances = 4;
  sub.monthlyPrice = 2000;
  sub.schoolMonthShare = 800;
  sub.teacherPerSeance = 300;
  sub.pricePerSession = 500;

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

/** Les `n` prochains jours où l'emploi du temps tourne réellement. */
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

const attend = (date: string, studentId = STU) =>
  useData.getState().setPresence({ studentId, sessionId: SES, date, status: "present" });

const patch = (id: string, fields: Record<string, unknown>) =>
  useData.setState({
    students: useData.getState().students.map((s) => (s.id === id ? { ...s, ...fields } : s)),
  });

const teacherOf = (): Teacher => useData.getState().teachers.find((t) => t.id === TEACHER)!;
const emploi = () => teacherEmplois(useData.getState(), TEACHER).find((e) => e.sessionId === SES)!;
const openBoard = (code: string) =>
  buildPayBoard(useData.getState(), teacherOf(), emploi(), code);

beforeEach(() => {
  useData.setState(buildSeed());
});

describe("un élève à jour sur son mois débloque la part, même s'il doit ailleurs", () => {
  it("des frais d'inscription impayés ne retiennent plus l'enseignant", async () => {
    board();
    const days = scheduledDays(4);
    await useData
      .getState()
      .addSold({ studentId: STU, subscriptionId: SUB, amount: 2000, monthCode: "M1" });
    for (const day of days) await attend(day);
    // Il reste débiteur au guichet — mais pas d'une seule séance de ce groupe.
    patch(STU, { registrationDue: 700 });

    expect(studentHasDebt(useData.getState(), STU)).toBe(true);
    expect(cycleOf(useData.getState(), STU, SUB, "M1").balance).toBe(0);

    const row = openBoard("M1").students.find((r) => r.studentId === STU)!;
    expect(row.debt).toBe(0);
    expect(row.withheld).toBe(false);
    expect(row.amount).toBe(4 * 300);
    expect(openBoard("M1").withheldTotal).toBe(0);
  });

  it("une dette sur un AUTRE emploi du temps ne retient pas celui-ci", async () => {
    board();
    const days = scheduledDays(4);
    await useData
      .getState()
      .addSold({ studentId: STU, subscriptionId: SUB, amount: 2000, monthCode: "M1" });
    for (const day of days) await attend(day);

    // Un second emploi du temps, jamais réglé : son solde plonge dans le rouge.
    useData.setState({
      enrollments: [
        ...useData.getState().enrollments,
        {
          id: "enr-autre",
          studentId: STU,
          subscriptionId: "sub-2",
          paidSeances: 0,
          consumedSeances: 4,
          balance: -1600,
          startDate: days[0],
        },
      ],
    });
    expect(studentHasDebt(useData.getState(), STU)).toBe(true);

    const row = openBoard("M1").students.find((r) => r.studentId === STU)!;
    // Son mois est soldé ICI : la part se règle, la dette de l'autre groupe
    // reste à réclamer au guichet.
    expect(row.debt).toBe(0);
    expect(row.emploiDebt).toBe(0);
    expect(row.withheld).toBe(false);
    expect(row.amount).toBe(4 * 300);
  });
});

describe("la part suit la séance, pas le pointage", () => {
  it("venir sans payer retient la part ; payer la libère séance par séance", async () => {
    board();
    const days = scheduledDays(4);
    for (const day of days) await attend(day);

    // Rien de versé : les quatre parts attendent.
    expect(emploi().months[0].withheld).toBe(4 * 300);
    expect(emploi().months[0].payable).toBe(0);

    // Il paie DEUX séances : les deux premières se libèrent, pas les autres.
    await useData
      .getState()
      .addSold({ studentId: STU, subscriptionId: SUB, amount: 1000, monthCode: "M1" });
    expect(emploi().months[0].payable).toBe(2 * 300);
    expect(emploi().months[0].withheld).toBe(2 * 300);

    // Puis le reste : tout le mois devient réglable.
    await useData
      .getState()
      .addSold({ studentId: STU, subscriptionId: SUB, amount: 1000, monthCode: "M1" });
    expect(emploi().months[0].payable).toBe(4 * 300);
    expect(emploi().months[0].withheld).toBe(0);
  });

  it("le trop-versé d'un mois paie les séances du mois suivant", async () => {
    board();
    const days = scheduledDays(6);
    // Six séances payées d'avance, toutes portées sur M1.
    await useData
      .getState()
      .addSold({ studentId: STU, subscriptionId: SUB, amount: 3000, monthCode: "M1" });
    for (const day of days) await attend(day);

    // M2 n'a rien reçu à son nom, mais l'avance de M1 couvre ses deux séances.
    expect(cycleOf(useData.getState(), STU, SUB, "M2").credited).toBe(0);
    expect(emploi().months[1].withheld).toBe(0);
    expect(emploi().months[1].payable).toBe(2 * 300);
  });
});

describe("l'école n'avance que ce qui retient la paie", () => {
  it("l'avance cible l'emploi du temps et laisse le reste à la famille", async () => {
    board();
    for (const day of scheduledDays(4)) await attend(day);
    patch(STU, { registrationDue: 700 });

    const before = openBoard("M1").students.find((r) => r.studentId === STU)!;
    expect(before.withheld).toBe(true);
    // Ce que la caisse a à sortir : les 4 séances de CE groupe, pas les frais.
    expect(before.emploiDebt).toBe(2000);
    expect(before.totalDebt).toBe(2700);

    const res = await useData
      .getState()
      .coverStudentDebt({ studentId: STU, subscriptionId: SUB });
    expect(res.ok).toBe(true);
    expect(res.amount).toBe(2000);

    const after = openBoard("M1").students.find((r) => r.studentId === STU)!;
    expect(after.withheld).toBe(false);
    expect(after.schoolCovered).toBe(true);
    expect(after.amount).toBe(4 * 300);
    // Les frais d'inscription restent dus par la famille.
    expect(useData.getState().students.find((s) => s.id === STU)!.registrationDue).toBe(700);
  });

  it("l'avance se relit sur l'écran des étudiants, montant et mois compris", async () => {
    board();
    for (const day of scheduledDays(4)) await attend(day);
    await useData.getState().coverStudentDebt({ studentId: STU, subscriptionId: SUB });

    const rows = schoolAdvancedRows(useData.getState());
    expect(rows).toHaveLength(1);
    expect(rows[0].studentId).toBe(STU);
    expect(rows[0].monthCode).toBe("M1");
    expect(rows[0].amount).toBe(2000);
    expect(rows[0].stillOwed).toBe(0);
  });

  it("rien n'a été avancé : l'écran des étudiants n'affiche aucune alerte", async () => {
    board();
    await useData
      .getState()
      .addSold({ studentId: STU, subscriptionId: SUB, amount: 2000, monthCode: "M1" });
    for (const day of scheduledDays(4)) await attend(day);

    expect(schoolAdvancedRows(useData.getState())).toHaveLength(0);
  });
});
