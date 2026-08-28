import { describe, it, expect, beforeEach } from "vitest";
import { useData } from "@/lib/store/data";
import { buildSeed } from "@/tests/fixtures/seed";
import { teacherEmplois } from "@/lib/teacherMonths";
import { buildPayBoard, freezeBoard } from "@/lib/teacherPayBoard";

/**
 * UNE SÉANCE LIBRE AJOUTÉE APRÈS COUP SUR UN MOIS DÉJÀ RÉGLÉ.
 *
 * Le cas que le guichet vit régulièrement sur un « groupe ouvert » : le mois
 * est réglé, puis un élève déjà inscrit ailleurs vient suivre une séance
 * libre sur ce même emploi du temps, ce même mois. Sa part n'a pas à attendre
 * un mois suivant qui n'existe pas forcément (un groupe ouvert n'en ouvre
 * jamais d'autre tant que personne ne s'y inscrit) : elle doit rester
 * réglable EN PLUS du règlement déjà versé, sans jamais rouvrir les élèves
 * déjà payés.
 */

const SUB = "sub-1";
const SES = "ses-1";
const PAYER = "stu-1";
const TEACHER = "tea-1";

const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function board() {
  const db = buildSeed();
  const sub = db.subscriptions.find((s) => s.id === SUB)!;
  sub.monthlySeances = 2;
  sub.monthlyPrice = 1000;
  sub.pricePerSession = 500;
  sub.schoolMonthShare = 400;
  sub.teacherPerSeance = 300;
  db.attendance = [];
  db.payments = [];
  db.unpaidTeacher = [];
  db.freePeriods = [];
  db.enrollments = db.enrollments.filter((e) => e.subscriptionId !== SUB);
  db.teacherPayments = [];
  db.acomptes = [];
  db.absences = [];
  db.teacherExpenses = [];
  db.teacherChildDebts = [];
  db.independent = [];
  db.cash = [];

  db.sessions.find((s) => s.id === SES)!.teacherId = TEACHER;

  const opened = new Date();
  opened.setDate(opened.getDate() - 400);
  const openedIso = opened.toLocaleDateString("fr-CA");
  db.students = db.students.map((st) =>
    st.id === PAYER
      ? {
          ...st,
          isFree: false,
          studentCase: "normal" as const,
          registrationDue: 0,
          subscriptionIds: [SUB],
          subscriptionDates: { [SUB]: { subscribedAt: openedIso, startDate: openedIso } },
        }
      : st,
  );
  useData.setState(db);
}

function days(n: number, offsetBack = 90): string[] {
  const session = useData.getState().sessions.find((s) => s.id === SES)!;
  const out: string[] = [];
  const d = new Date();
  d.setDate(d.getDate() - offsetBack);
  while (out.length < n) {
    if (session.days.includes(DAY_KEYS[d.getDay()] as never)) {
      out.push(d.toLocaleDateString("fr-CA"));
    }
    d.setDate(d.getDate() + 1);
  }
  return out;
}

const present = (studentId: string, date: string) =>
  useData.getState().setPresence({ studentId, sessionId: SES, date, status: "present" });

const emploiOf = () => teacherEmplois(useData.getState(), TEACHER).find((e) => e.sessionId === SES)!;

describe("une séance libre tombée sur un mois déjà réglé", () => {
  beforeEach(board);

  it("reste réglable à part, sans rouvrir les élèves déjà payés", async () => {
    const [d1, d2] = days(2);
    await useData.getState().addSold({ studentId: PAYER, subscriptionId: SUB, amount: 1000 });
    await present(PAYER, d1);
    await present(PAYER, d2);

    // Le mois est réglé pour son seul élève.
    const db1 = useData.getState();
    let m1 = buildPayBoard(db1, db1.teachers.find((t) => t.id === TEACHER)!, emploiOf(), "M1");
    const firstPay = await useData.getState().payTeacherSessions({
      teacherId: TEACHER,
      dueIds: m1.students.flatMap((r) => r.dueIds),
      amount: m1.studentsTotal,
      gross: m1.studentsTotal,
      method: "group",
      months: [
        {
          sessionId: SES,
          title: m1.emploi.title,
          groupName: m1.emploi.groupName,
          monthCode: "M1",
          seances: m1.held,
          presents: m1.students.reduce((s, r) => s + r.seances, 0),
          students: m1.students.length,
          gross: m1.studentsTotal,
        },
      ],
    });
    expect(firstPay.ok).toBe(true);

    // Un élève de passage vient suivre une séance libre sur CE MÊME mois,
    // APRÈS que l'enseignant a déjà été réglé.
    await useData
      .getState()
      .createPassagerSeances({ sessionId: SES, date: d1, names: ["Sami"], price: 500, schoolShare: 200 });

    const db2 = useData.getState();
    const board2 = buildPayBoard(db2, db2.teachers.find((t) => t.id === TEACHER)!, emploiOf(), "M1");

    // La séance libre est bien là, sur le mois qui l'a vue passer — le mois
    // reste marqué réglé, mais elle est toujours ouverte.
    expect(board2.settlement?.id).toBe(firstPay.paymentId);
    expect(board2.passagers).toHaveLength(1);
    expect(board2.passagersTotal).toBe(300);
    // Rien à régler côté élèves : le premier règlement a tout couvert.
    expect(board2.studentsTotal).toBe(0);

    // Le complément se règle à part, sans toucher aux élèves déjà réglés —
    // exactement ce que le bouton « Régler le complément » envoie.
    const picked = { studentIds: [], arrearKeys: [], passagerIds: board2.passagers.map((r) => r.id), deductionIds: [] };
    const supplement = await useData.getState().payTeacherSessions({
      teacherId: TEACHER,
      dueIds: [],
      passagerIds: picked.passagerIds,
      amount: board2.passagersTotal,
      gross: board2.passagersTotal,
      method: "group",
      months: [],
      board: freezeBoard(db2, board2, picked),
    });
    expect(supplement.ok).toBe(true);
    expect(supplement.paymentId).not.toBe(firstPay.paymentId);

    // La séance libre est désormais soldée, et ne revient jamais.
    const after = useData.getState();
    expect(after.independent.every((i) => i.teacherPaid)).toBe(true);
    const board3 = buildPayBoard(after, after.teachers.find((t) => t.id === TEACHER)!, emploiOf(), "M1");
    expect(board3.passagers).toHaveLength(0);
    // Le mois reste marqué réglé — sur le complément désormais, le plus
    // récent des deux : c'est celui qu'une réouverture de M1 affichera.
    expect(board3.settlement?.id).toBe(supplement.paymentId);
    // Les deux règlements existent, distincts, l'un et l'autre — le premier
    // garde son montant intact, retrouvable dans l'historique des règlements.
    expect(after.teacherPayments).toHaveLength(2);
    expect(after.teacherPayments.find((p) => p.id === firstPay.paymentId)!.amount).toBe(
      m1.studentsTotal,
    );
    expect(after.teacherPayments.find((p) => p.id === supplement.paymentId)!.amount).toBe(
      board2.passagersTotal,
    );
  });
});
