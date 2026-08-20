import { describe, it, expect, beforeEach } from "vitest";
import { useData } from "@/lib/store/data";
import { buildSeed } from "@/tests/fixtures/seed";
import {
  cycleOf,
  schoolPerSeanceOf,
  soldFor,
  studentListPrice,
  studentMonthPrice,
} from "@/lib/helpers";

/**
 * Un élève « école seule » ne paie QUE la part de l'école.
 *
 * L'enseignant n'est délibérément pas payé pour lui : lui facturer le prix
 * complet encaisserait une part enseignant que personne ne versera jamais. Sa
 * séance coûte donc `part école du mois ÷ séances du mois` — 800 DA gardés sur
 * un mois de 2000 réparti sur 4 séances, cela fait 200 DA la séance, là où un
 * élève ordinaire en paie 500.
 */

const SUB = "sub-1";
const SES = "ses-1";
const STU = "stu-1";
const TEACHER = "tea-1";

const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** L'emploi du temps de l'énoncé : 4 séances, mois à 2000, école 800. */
function board() {
  const db = buildSeed();
  const sub = db.subscriptions.find((s) => s.id === SUB)!;
  sub.monthlySeances = 4;
  sub.monthlyPrice = 2000;
  sub.pricePerSession = 500;
  sub.schoolMonthShare = 800;
  sub.teacherPerSeance = Math.round((2000 - 800) / 4); // 300
  db.attendance = [];
  db.payments = [];
  db.enrollments = db.enrollments.filter((e) => e.subscriptionId !== SUB);
  db.unpaidTeacher = [];
  db.freePeriods = [];
  const session = db.sessions.find((s) => s.id === SES)!;
  session.teacherId = TEACHER;
  // Les deux élèves suivent l'emploi depuis longtemps : l'un « école seule »,
  // l'autre ordinaire. La date de début est ancienne pour que les présences
  // des tests soient bien facturées.
  const opened = new Date();
  opened.setDate(opened.getDate() - 400);
  const openedIso = opened.toLocaleDateString("fr-CA");
  db.students = db.students.map((st) =>
    st.id === STU || st.id === "stu-2"
      ? {
          ...st,
          isFree: false,
          studentCase: "normal" as const,
          subscriptionIds: st.subscriptionIds.includes(SUB)
            ? st.subscriptionIds
            : [...st.subscriptionIds, SUB],
          subscriptionDates: {
            ...st.subscriptionDates,
            [SUB]: { subscribedAt: openedIso, startDate: openedIso },
          },
        }
      : st,
  );
  useData.setState(db);
  return sub;
}

function makeSchoolOnly() {
  useData.setState((state) => ({
    students: state.students.map((st) =>
      st.id === STU
        ? { ...st, studentCase: "school_only" as const, unpaidTeacherIds: [TEACHER], isFree: false }
        : st,
    ),
  }));
}

/** Un jour où l'emploi tourne vraiment. */
function scheduledDay(offsetBack = 30): string {
  const session = useData.getState().sessions.find((s) => s.id === SES)!;
  const d = new Date();
  d.setDate(d.getDate() - offsetBack);
  while (!session.days.includes(DAY_KEYS[d.getDay()] as never)) d.setDate(d.getDate() + 1);
  return d.toLocaleDateString("fr-CA");
}

const present = (date: string) =>
  useData.getState().setPresence({ studentId: STU, sessionId: SES, date, status: "present" });

describe("le tarif d'un élève « école seule »", () => {
  beforeEach(() => {
    board();
  });

  it("vaut la part de l'école divisée par les séances du mois", () => {
    const sub = useData.getState().subscriptions.find((s) => s.id === SUB)!;
    expect(schoolPerSeanceOf(sub)).toBe(200); // 800 / 4
  });

  it("s'applique à lui seul : les autres élèves paient le prix plein", () => {
    makeSchoolOnly();
    const db = useData.getState();
    const sub = db.subscriptions.find((s) => s.id === SUB)!;
    const schoolOnly = db.students.find((s) => s.id === STU)!;
    const ordinary = db.students.find((s) => s.id === "stu-2")!;

    expect(studentListPrice(schoolOnly, sub)).toBe(200);
    expect(studentListPrice(ordinary, sub)).toBe(500);
    expect(studentMonthPrice(schoolOnly, sub)).toBe(800);
    expect(studentMonthPrice(ordinary, sub)).toBe(2000);
  });

  it("est ce que la présence retire vraiment de son solde", async () => {
    makeSchoolOnly();
    await useData.getState().addSold({ studentId: STU, subscriptionId: SUB, amount: 800 });
    await present(scheduledDay());

    const db = useData.getState();
    expect(soldFor(db, STU, SUB)).toBe(600); // 800 − 200
    const row = db.attendance.find((a) => a.studentId === STU && a.sessionId === SES)!;
    expect(row.amountDeducted).toBe(200);
  });

  it("solde le mois entier avec la seule part de l'école", async () => {
    makeSchoolOnly();
    await useData.getState().addSold({ studentId: STU, subscriptionId: SUB, amount: 800 });
    const session = useData.getState().sessions.find((s) => s.id === SES)!;
    const d = new Date();
    d.setDate(d.getDate() - 60);
    let held = 0;
    while (held < 4) {
      if (session.days.includes(DAY_KEYS[d.getDay()] as never)) {
        // eslint-disable-next-line no-await-in-loop
        await present(d.toLocaleDateString("fr-CA"));
        held += 1;
      }
      d.setDate(d.getDate() + 1);
    }

    const db = useData.getState();
    const cycle = cycleOf(db, STU, SUB, "M1");
    expect(cycle.done).toBe(4);
    expect(cycle.consumed).toBe(800);
    expect(cycle.balance).toBe(0);
  });

  it("ne fait gagner NI à l'enseignant exclu, ni au reste", async () => {
    makeSchoolOnly();
    await present(scheduledDay());
    const dues = useData.getState().unpaidTeacher.filter((u) => u.teacherId === TEACHER);
    expect(dues).toHaveLength(0);
  });

  it("laisse l'élève ordinaire payer 500 et rapporter sa part", async () => {
    await useData.getState().addSold({ studentId: "stu-2", subscriptionId: SUB, amount: 2000 });
    await useData.getState().setPresence({
      studentId: "stu-2",
      sessionId: SES,
      date: scheduledDay(),
      status: "present",
    });
    const db = useData.getState();
    expect(soldFor(db, "stu-2", SUB)).toBe(1500);
    expect(
      db.unpaidTeacher.filter((u) => u.teacherId === TEACHER && u.studentId === "stu-2"),
    ).toHaveLength(1);
  });
});
