import { describe, it, expect, beforeEach } from "vitest";
import { useData } from "@/lib/store/data";
import { buildSeed } from "@/tests/fixtures/seed";
import {
  cycleOf,
  schoolPerSeanceOf,
  studentListPrice,
  studentMonthPrice,
  studentSchoolPerSeance,
  studentTeacherPerSeance,
  teacherPerSeanceOf,
} from "@/lib/helpers";
import {
  studentArrearsBefore,
  teacherChildRows,
  teacherEmplois,
} from "@/lib/teacherMonths";

/**
 * Les cas d'élèves, du côté de l'argent.
 *
 * Un mois de 2000 DA sur 4 séances dont l'école garde 800 se partage ainsi :
 *
 *     séance = 500 DA   ->   école 200 DA   +   enseignant 300 DA
 *
 * Une RÉDUCTION est accordée moitié-moitié, chacun sur SA part : l'élève ne
 * paie donc que ce que les deux côtés lui laissent, l'école n'encaisse que sa
 * part diminuée, et l'enseignant ne touche que la sienne. Un « cas spécial » ne
 * rapporte rien à personne, un « école seule » paie la seule part de l'école, et
 * un « fils d'enseignant » sort du salaire de son père.
 */

const SUB = "sub-1";
const SES = "ses-1";
const STU = "stu-1";
const OTHER = "stu-2";
const TEACHER = "tea-1";

const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** Le tableau de l'énoncé : 4 séances, mois à 2000, l'école garde 800. */
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
  db.enrollments = db.enrollments.filter((e) => e.subscriptionId !== SUB);

  const opened = new Date();
  opened.setDate(opened.getDate() - 400);
  const openedIso = opened.toLocaleDateString("fr-CA");
  db.students = db.students.map((st) =>
    st.id === STU || st.id === OTHER
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
const subOf = () => useData.getState().subscriptions.find((s) => s.id === SUB)!;

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

const emploi = () => teacherEmplois(useData.getState(), TEACHER).find((e) => e.sessionId === SES)!;

beforeEach(() => {
  useData.setState(buildSeed());
});

// ---------------------------------------------------------------------------

describe("le partage école / enseignant d'une séance", () => {
  it("un élève ordinaire paie le prix plein, réparti 200 / 300", () => {
    board();
    const st = studentOf(STU);
    expect(studentListPrice(st, subOf())).toBe(500);
    expect(studentSchoolPerSeance(st, subOf())).toBe(200);
    expect(studentTeacherPerSeance(st, subOf(), TEACHER)).toBe(300);
    expect(schoolPerSeanceOf(subOf())).toBe(200);
    expect(teacherPerSeanceOf(subOf())).toBe(300);
  });

  it("une réduction en pourcentage s'applique à CHAQUE part, pas au total", () => {
    board();
    // L'école accorde 50% de SA part (200 -> 100), l'enseignant 10% de la
    // sienne (300 -> 270). L'élève paie donc 370 et non 500.
    patch(STU, {
      studentCase: "reduction",
      caseReduction: { type: "percent", schoolValue: 50, teacherValue: 10 },
    });
    const st = studentOf(STU);
    expect(studentSchoolPerSeance(st, subOf())).toBe(100);
    expect(studentTeacherPerSeance(st, subOf(), TEACHER)).toBe(270);
    expect(studentListPrice(st, subOf())).toBe(370);
    // Les deux parts se recomposent EXACTEMENT en ce que l'élève verse.
    expect(studentSchoolPerSeance(st, subOf()) + studentTeacherPerSeance(st, subOf(), TEACHER)).toBe(
      studentListPrice(st, subOf()),
    );
    expect(studentMonthPrice(st, subOf())).toBe(370 * 4);
  });

  it("une réduction en montant fixe se retire de chaque part, sans jamais passer sous zéro", () => {
    board();
    patch(STU, {
      studentCase: "reduction",
      caseReduction: { type: "amount", schoolValue: 500, teacherValue: 50 },
    });
    const st = studentOf(STU);
    // 500 DA de remise école sur une part de 200 : elle s'arrête à 200.
    expect(studentSchoolPerSeance(st, subOf())).toBe(0);
    expect(studentTeacherPerSeance(st, subOf(), TEACHER)).toBe(250);
    expect(studentListPrice(st, subOf())).toBe(250);
  });

  it("sans répartition mensuelle, seule la moitié « école » sort du prix", () => {
    board();
    // Un emploi sans formule au mois ne porte AUCUNE part enseignant : il n'y a
    // rien à réduire de ce côté-là ici, et la moitié « enseignant » de la remise
    // est retirée là où elle a un sens — sur le pourcentage que l'enseignant
    // touche. Elle ne doit donc pas être comptée deux fois.
    useData.setState((st) => ({
      subscriptions: st.subscriptions.map((x) =>
        x.id === SUB
          ? { ...x, monthlySeances: 0, monthlyPrice: 0, schoolMonthShare: undefined, teacherPerSeance: undefined }
          : x,
      ),
    }));
    patch(STU, {
      studentCase: "reduction",
      caseReduction: { type: "amount", schoolValue: 100, teacherValue: 50 },
    });
    expect(studentListPrice(studentOf(STU), subOf())).toBe(400);
    expect(studentTeacherPerSeance(studentOf(STU), subOf(), TEACHER)).toBe(0);
  });

  it("la présence facture bien le prix réduit et paie l'enseignant sa part réduite", async () => {
    board();
    patch(STU, {
      studentCase: "reduction",
      caseReduction: { type: "percent", schoolValue: 50, teacherValue: 10 },
    });
    const [day] = scheduledDays(1);
    await attend(STU, day);

    const record = useData.getState().attendance.find((a) => a.studentId === STU)!;
    expect(record.amountDeducted).toBe(370);
    const due = useData.getState().unpaidTeacher.find((u) => u.studentId === STU)!;
    expect(due.amount).toBe(270);
  });

  it("un « cas spécial » ne coûte rien et ne rapporte rien", async () => {
    board();
    patch(STU, { studentCase: "special", isFree: true });
    const [day] = scheduledDays(1);
    await attend(STU, day);

    expect(useData.getState().attendance.find((a) => a.studentId === STU)!.amountDeducted).toBe(0);
    expect(useData.getState().unpaidTeacher.filter((u) => u.studentId === STU)).toHaveLength(0);
    expect(studentTeacherPerSeance(studentOf(STU), subOf(), TEACHER)).toBe(0);
  });

  it("un « école seule » paie la part de l'école et n'est pas listé sur la paie", async () => {
    board();
    patch(STU, { studentCase: "school_only", unpaidTeacherIds: [TEACHER] });
    expect(studentListPrice(studentOf(STU), subOf())).toBe(200);
    expect(studentTeacherPerSeance(studentOf(STU), subOf(), TEACHER)).toBe(0);

    const [day] = scheduledDays(1);
    await attend(STU, day);
    await attend(OTHER, day);

    const ids = emploi().months[0].students.map((s) => s.studentId);
    expect(ids).not.toContain(STU);
    expect(ids).toContain(OTHER);
    // L'autre élève, lui, rapporte bien ses 300 DA.
    expect(emploi().months[0].gross).toBe(300);
  });

  it("un « école seule » reste listé pour un enseignant qui, lui, EST payé", async () => {
    board();
    patch(STU, { studentCase: "school_only", unpaidTeacherIds: ["tea-autre"] });
    const [day] = scheduledDays(1);
    await attend(STU, day);
    expect(emploi().months[0].students.map((s) => s.studentId)).toContain(STU);
  });
});

// ---------------------------------------------------------------------------

describe("les arriérés de part enseignant", () => {
  /**
   * Le cas que la réception vit tous les mois :
   *   M1 — l'élève ne paie pas, la part de l'enseignant est RETENUE ;
   *   l'enseignant est réglé du M1 sans cette part ;
   *   l'élève s'acquitte ensuite ;
   *   au règlement du M2, la part de M1 doit réapparaître.
   */
  it("une part retenue en M1 réapparaît au règlement du M2 une fois l'élève à jour", async () => {
    board();
    const days = scheduledDays(8);

    // ---- M1 : il vient à ses 4 séances sans rien payer --------------------
    for (const day of days.slice(0, 4)) await attend(STU, day);

    const m1 = emploi().months[0];
    expect(m1.state).toBe("done");
    expect(m1.gross).toBe(4 * 300);
    // Il doit 4 × 500 : toute la part de l'enseignant est bloquée.
    expect(m1.withheld).toBe(4 * 300);
    expect(m1.payable).toBe(0);
    expect(cycleOf(useData.getState(), STU, SUB, "M1").balance).toBe(-2000);

    // ---- M2 : il vient encore, toujours sans payer ------------------------
    for (const day of days.slice(4, 8)) await attend(STU, day);
    expect(emploi().months[1].withheld).toBe(4 * 300);

    // Vu du M2, le M1 doit toujours quelque chose, mais BLOQUÉ.
    const blocked = studentArrearsBefore(emploi(), STU, 1);
    expect(blocked.payable).toBe(0);
    expect(blocked.withheld).toBe(4 * 300);
    expect(blocked.months).toEqual(["M1"]);

    // ---- il solde enfin ses deux mois -------------------------------------
    await useData.getState().addSold({ studentId: STU, subscriptionId: SUB, amount: 2000, monthCode: "M1" });
    await useData.getState().addSold({ studentId: STU, subscriptionId: SUB, amount: 2000, monthCode: "M2" });

    // Vu du M2, le M1 est maintenant DÉBLOQUÉ : sa part est due.
    const freed = studentArrearsBefore(emploi(), STU, 1);
    expect(freed.withheld).toBe(0);
    expect(freed.payable).toBe(4 * 300);
    expect(freed.months).toEqual(["M1"]);
    expect(freed.dueIds).toHaveLength(4);

    // Et les deux mois sont désormais réglables d'un coup.
    expect(emploi().months[0].payable).toBe(4 * 300);
    expect(emploi().months[1].payable).toBe(4 * 300);
    expect(emploi().payable).toBe(8 * 300);
  });

  it("le premier mois ne peut porter aucun arriéré", () => {
    board();
    expect(studentArrearsBefore(emploi(), STU, 0)).toEqual({
      payable: 0,
      withheld: 0,
      months: [],
      dueIds: [],
    });
  });
});

// ---------------------------------------------------------------------------

describe("les enfants de l'enseignant, scolarisés sur son salaire", () => {
  it("listent ce qu'ils ont étudié, mois en cours et arriérés séparés", async () => {
    board();
    patch(STU, { studentCase: "teacher_child", teacherFatherId: TEACHER });
    const days = scheduledDays(6);

    // M1 complet, jamais payé -> arriéré. Puis 2 séances sur M2 -> mois en cours.
    for (const day of days.slice(0, 6)) await attend(STU, day);

    const rows = teacherChildRows(useData.getState(), TEACHER);
    expect(rows).toHaveLength(1);
    const child = rows[0];
    expect(child.studentId).toBe(STU);
    expect(child.lines.map((l) => l.monthCode)).toEqual(["M1", "M2"]);

    const m1 = child.lines.find((l) => l.monthCode === "M1")!;
    const m2 = child.lines.find((l) => l.monthCode === "M2")!;
    expect(m1.current).toBe(false);
    expect(m1.seances).toBe(4);
    expect(m1.amount).toBe(4 * 500);
    expect(m2.current).toBe(true);
    expect(m2.seances).toBe(2);
    expect(m2.amount).toBe(2 * 500);

    expect(child.previousAmount).toBe(2000);
    expect(child.currentAmount).toBe(1000);
    expect(child.currentSeances).toBe(2);
    expect(child.amount).toBe(3000);
  });

  it("un enfant à jour ne pèse plus sur le salaire", async () => {
    board();
    patch(STU, { studentCase: "teacher_child", teacherFatherId: TEACHER });
    const days = scheduledDays(4);
    for (const day of days) await attend(STU, day);
    await useData.getState().addSold({ studentId: STU, subscriptionId: SUB, amount: 2000, monthCode: "M1" });

    expect(teacherChildRows(useData.getState(), TEACHER)).toHaveLength(0);
  });
});
