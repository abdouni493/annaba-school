import { describe, it, expect, beforeEach } from "vitest";
import { useData } from "@/lib/store/data";
import { buildSeed } from "@/tests/fixtures/seed";
import {
  isSchoolOnlySub,
  studentListPrice,
  studentTeacherPerSeance,
} from "@/lib/helpers";
import { teacherEmplois } from "@/lib/teacherMonths";

/**
 * « ÉCOLE SEULEMENT » SE COCHE EMPLOI DU TEMPS PAR EMPLOI DU TEMPS.
 *
 * Exactement comme la gratuité. Un élève peut suivre deux modules dont un seul
 * est « école seule » : sur celui-là, la famille ne verse que la part de
 * l'école, l'enseignant n'est pas payé pour lui — et l'élève ne figure même pas
 * sur l'écran de paie de cet enseignant, parce qu'une ligne qui ne rapportera
 * jamais rien n'invite qu'à des erreurs de calcul. Sur l'autre module, tout se
 * calcule normalement et l'élève apparaît comme n'importe qui.
 */

const SUB_ON = "sub-1"; // l'emploi où l'option est ACTIVE
const SES_ON = "ses-1";
const SUB_OFF = "sub-2"; // l'emploi où elle ne l'est PAS
const SES_OFF = "ses-2";
const STU = "stu-1";
const TEACHER = "tea-1";

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
          studentCase: "school_only" as const,
          // L'option n'est active que sur le PREMIER emploi du temps.
          schoolOnlySubscriptionIds: [SUB_ON],
          unpaidTeacherIds: [TEACHER],
          subscriptionIds: [SUB_ON, SUB_OFF],
          subscriptionDates: {
            [SUB_ON]: { subscribedAt: openedIso, startDate: openedIso },
            [SUB_OFF]: { subscribedAt: openedIso, startDate: openedIso },
          },
        }
      : st,
  );
  useData.setState(db);
}

describe("« école seulement », emploi par emploi", () => {
  beforeEach(board);

  it("ne s'applique qu'aux emplois du temps cochés", () => {
    const student = useData.getState().students.find((s) => s.id === STU)!;
    expect(isSchoolOnlySub(student, SUB_ON, TEACHER)).toBe(true);
    expect(isSchoolOnlySub(student, SUB_OFF, TEACHER)).toBe(false);
  });

  it("fait payer la seule part de l'école sur l'emploi coché, le prix plein sur l'autre", () => {
    const db = useData.getState();
    const student = db.students.find((s) => s.id === STU)!;
    const on = db.subscriptions.find((s) => s.id === SUB_ON)!;
    const off = db.subscriptions.find((s) => s.id === SUB_OFF)!;

    expect(studentListPrice(student, on)).toBe(200); // 800 ÷ 4
    expect(studentListPrice(student, off)).toBe(500); // le tarif ordinaire
  });

  it("ne paie pas l'enseignant sur l'emploi coché, le paie normalement sur l'autre", () => {
    const db = useData.getState();
    const student = db.students.find((s) => s.id === STU)!;
    const on = db.subscriptions.find((s) => s.id === SUB_ON)!;
    const off = db.subscriptions.find((s) => s.id === SUB_OFF)!;

    expect(studentTeacherPerSeance(student, on, TEACHER)).toBe(0);
    expect(studentTeacherPerSeance(student, off, TEACHER)).toBe(300);
  });

  it("retire l'élève de l'écran de paie du seul emploi coché", () => {
    const emplois = teacherEmplois(useData.getState(), TEACHER);
    const on = emplois.find((e) => e.sessionId === SES_ON)!;
    const off = emplois.find((e) => e.sessionId === SES_OFF)!;

    const listedOn = on.months.some((m) => m.students.some((s) => s.studentId === STU));
    const listedOff = off.months.some((m) => m.students.some((s) => s.studentId === STU));

    expect(listedOn).toBe(false);
    expect(listedOff).toBe(true);
  });

  it("garde le sens des anciennes fiches, qui ne listaient que des enseignants", () => {
    useData.setState((state) => ({
      students: state.students.map((st) =>
        st.id === STU ? { ...st, schoolOnlySubscriptionIds: undefined } : st,
      ),
    }));
    const student = useData.getState().students.find((s) => s.id === STU)!;
    // Sans liste d'emplois, c'est `unpaidTeacherIds` qui décide — comme avant.
    expect(isSchoolOnlySub(student, SUB_ON, TEACHER)).toBe(true);
    expect(isSchoolOnlySub(student, SUB_OFF, TEACHER)).toBe(true);
    expect(isSchoolOnlySub(student, SUB_ON, "tea-2")).toBe(false);
  });
});
