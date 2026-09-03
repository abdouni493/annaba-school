import { describe, it, expect, beforeEach } from "vitest";
import { useData } from "@/lib/store/data";
import { buildSeed } from "@/tests/fixtures/seed";
import { freezeBoard, buildPayBoard, payEmplois } from "@/lib/teacherPayBoard";
import { sessionTitleOf } from "@/lib/helpers";

/**
 * LA FICHE DE PAIE DOIT NOMMER L'EMPLOI DU TEMPS, ET LISTER TOUT LE MONDE.
 *
 * Deux reproches, tous deux vérifiés ici :
 *
 *  1. LE NOM DE L'EMPLOI DU TEMPS n'apparaissait pas. L'écran de création le
 *     demande pourtant (« Nom de l'emploi du temps ») et promet qu'il « apparaît
 *     partout où l'emploi du temps est listé » — la paie retombait sur le nom du
 *     module, si bien qu'un enseignant qui donne le même module à trois groupes
 *     lisait trois fois la même ligne.
 *
 *  2. LA LISTE DES ÉLÈVES était amputée : seuls ceux dont la part était versée
 *     y figuraient. L'enseignant recevait un bon qui ne disait pas POURQUOI son
 *     net était plus petit que son mois. Le mois est désormais figé en entier,
 *     chaque ligne disant si elle a été réglée par ce bon-là — et les totaux ne
 *     comptant, eux, que les lignes réglées.
 */

const SUB = "sub-1";
const SES = "ses-1";
const TEACHER = "tea-1";
const A = "stu-1";
const B = "stu-2";

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
  db.sessions = db.sessions.map((s) =>
    s.id === SES ? { ...s, teacherId: TEACHER, title: "Maths — Groupe A (samedi matin)" } : s,
  );

  const opened = new Date();
  opened.setDate(opened.getDate() - 400);
  const openedIso = opened.toLocaleDateString("fr-CA");
  db.students = db.students.map((st) =>
    st.id === A || st.id === B
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

/** Le mois M1 : les deux élèves viennent, un seul paie. */
async function runMonth() {
  const days: string[] = [];
  for (let back = 40; days.length < 2; back -= 3) {
    const day = scheduledDay(back);
    if (!days.includes(day)) days.push(day);
  }
  for (const day of days) {
    for (const id of [A, B]) {
      // eslint-disable-next-line no-await-in-loop
      await useData
        .getState()
        .setPresence({ studentId: id, sessionId: SES, date: day, status: "present" });
    }
  }
  // Seul A règle son mois : la part de B reste retenue.
  await useData
    .getState()
    .addSold({ studentId: A, subscriptionId: SUB, amount: 1000, monthCode: "M1" });
}

const live = () => {
  const db = useData.getState();
  const teacher = db.teachers.find((t) => t.id === TEACHER)!;
  const emploi = payEmplois(db, TEACHER).find((e) => e.sessionId === SES)!;
  return { db, emploi, board: buildPayBoard(db, teacher, emploi, "M1") };
};

describe("la fiche de paie d'un mois", () => {
  beforeEach(() => {
    board();
  });

  it("porte le NOM de l'emploi du temps, pas celui du module", async () => {
    await runMonth();
    const { db, emploi } = live();
    const session = db.sessions.find((s) => s.id === SES)!;

    expect(sessionTitleOf(db, session)).toBe("Maths — Groupe A (samedi matin)");
    expect(emploi.title).toBe("Maths — Groupe A (samedi matin)");
  });

  it("fige TOUT le mois — élèves réglés et élèves non réglés", async () => {
    await runMonth();
    const { db, board: live1 } = live();

    // La réception ne coche que l'élève à jour.
    const frozen = freezeBoard(db, live1, {
      studentIds: [A],
      arrearKeys: [],
      passagerIds: [],
      deductionIds: [],
    });

    expect(frozen.emploi).toBe("Maths — Groupe A (samedi matin)");
    // Les DEUX élèves du mois sont sur le bon…
    expect(frozen.students.map((r) => r.studentId).sort()).toEqual([A, B].sort());
    // …mais un seul y est réglé.
    expect(frozen.students.find((r) => r.studentId === A)!.settledHere).toBe(true);
    expect(frozen.students.find((r) => r.studentId === B)!.settledHere).toBe(false);
    // Et le total ne compte que celui-là.
    expect(frozen.studentsTotal).toBe(live1.students.find((r) => r.studentId === A)!.amount);
  });

  it("ne compte pas dans son total les parts retenues", async () => {
    await runMonth();
    const { db, board: live1 } = live();
    const frozen = freezeBoard(db, live1, {
      studentIds: [A, B],
      arrearKeys: [],
      passagerIds: [],
      deductionIds: [],
    });

    const withheld = frozen.students.find((r) => r.studentId === B)!;
    expect(withheld.withheld).toBe(true);
    // Coché ou non, une part retenue n'est pas versée par ce bon.
    expect(withheld.settledHere).toBe(false);
    expect(frozen.studentsTotal).toBe(live1.studentsTotal);
  });
});
