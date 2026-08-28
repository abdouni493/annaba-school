import { describe, it, expect, beforeEach } from "vitest";
import { useData } from "@/lib/store/data";
import { buildSeed } from "@/tests/fixtures/seed";
import { teacherEmplois, unlockedArrears } from "@/lib/teacherMonths";

/**
 * LE TROU NOIR D'UN MOIS RÉGLÉ SANS AUCUNE PART D'ÉLÈVE.
 *
 * `alreadySettled` disait « au moins une part de la table 1 a été payée à
 * l'enseignant » — vrai la plupart du temps, faux dans un cas bien réel : un
 * mois où le SEUL élève n'avait pas payé (sa part reste RETENUE), et où le
 * règlement du mois n'a soldé qu'autre chose — une retenue, un arriéré d'un
 * autre emploi, une séance libre. Le règlement existe, la pastille du mois
 * affiche « Réglé », mais `alreadySettled` restait `false` pour toujours : la
 * part de cet élève, débloquée le jour où il paie enfin, ne devenait jamais
 * un arriéré. Elle disparaissait — c'est exactement ce que la réception a vu.
 */

const SUB = "sub-1";
const SES = "ses-1";
const LATE = "stu-2"; // le seul élève du mois : il n'a pas payé
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

  const session = db.sessions.find((s) => s.id === SES)!;
  session.teacherId = TEACHER;

  const opened = new Date();
  opened.setDate(opened.getDate() - 400);
  const openedIso = opened.toLocaleDateString("fr-CA");
  db.students = db.students.map((st) =>
    st.id === LATE
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

describe("un mois réglé sans qu'aucune part d'élève n'ait été payée", () => {
  beforeEach(board);

  it("reconnaît quand même le mois comme déjà réglé", async () => {
    const [d1, d2] = days(2);
    await present(LATE, d1);
    await present(LATE, d2);

    // Le seul élève du mois n'a rien payé : tout est retenu, rien n'est
    // payable — un règlement « normal » (dueIds) n'aurait rien à solder ici.
    let m1 = emploiOf().months[0];
    expect(m1.payable).toBe(0);
    expect(m1.withheld).toBe(600);
    expect(m1.alreadySettled).toBe(false);

    // Pourtant l'administration règle le mois — par exemple pour ne solder
    // qu'une retenue ou un acompte sans rapport avec cet élève. Le règlement
    // porte bien le mois dans `months`, sans avoir payé aucune part.
    await useData.getState().payTeacherSessions({
      teacherId: TEACHER,
      dueIds: [],
      amount: 0,
      gross: 0,
      method: "group",
      months: [
        {
          sessionId: SES,
          title: emploiOf().title,
          groupName: emploiOf().groupName,
          monthCode: "M1",
          seances: m1.held,
          presents: 0,
          students: 0,
          gross: 0,
        },
      ],
    });

    // La pastille du mois se sait réglée…
    m1 = emploiOf().months[0];
    expect(m1.alreadySettled).toBe(true);
  });

  it("laisse la part du retardataire réapparaître en arriéré, au lieu de disparaître", async () => {
    const [d1, d2] = days(2);
    await present(LATE, d1);
    await present(LATE, d2);

    const m1 = emploiOf().months[0];
    await useData.getState().payTeacherSessions({
      teacherId: TEACHER,
      dueIds: [],
      amount: 0,
      gross: 0,
      method: "group",
      months: [
        {
          sessionId: SES,
          title: emploiOf().title,
          groupName: emploiOf().groupName,
          monthCode: "M1",
          seances: m1.held,
          presents: 0,
          students: 0,
          gross: 0,
        },
      ],
    });

    // Le retardataire s'acquitte APRÈS coup, sur son M1.
    await useData
      .getState()
      .addSold({ studentId: LATE, subscriptionId: SUB, amount: 1000, monthCode: "M1" });

    // Le groupe entame son M2.
    const [, , d3] = days(3);
    await present(LATE, d3);

    const emplois = teacherEmplois(useData.getState(), TEACHER);
    const arrears = unlockedArrears(emplois);

    expect(arrears).toHaveLength(1);
    expect(arrears[0].studentId).toBe(LATE);
    expect(arrears[0].monthCode).toBe("M1");
    expect(arrears[0].amount).toBe(600);
  });
});
