import { describe, it, expect, beforeEach } from "vitest";
import { useData } from "@/lib/store/data";
import { buildSeed } from "@/tests/fixtures/seed";
import {
  defaultPayableMonthKeys,
  teacherEmplois,
  unpaidStudents,
} from "@/lib/teacherMonths";
import { cycleOf, schoolPerSeanceOf } from "@/lib/helpers";

/**
 * La paie de l'enseignant suit EXACTEMENT l'horloge des élèves : un mois d'un
 * emploi du temps s'ouvre à la première présence et se ferme sur la séance qui
 * complète le pack. Ces tests pilotent les vraies actions du store — présence,
 * solde, règlement — et relisent ce que l'écran de paie affiche.
 */

const SUB = "sub-1";
const SES = "ses-1";
const TEACHER = "tea-1";
const STU = "stu-1";

const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** Un emploi du temps propre : un seul élève, rien d'attendu, rien de dû. */
function board(monthSeances = 4) {
  const db = buildSeed();
  const sub = db.subscriptions.find((s) => s.id === SUB)!;
  sub.monthlySeances = monthSeances;
  sub.monthlyPrice = monthSeances * sub.pricePerSession;
  sub.schoolMonthShare = Math.round(sub.monthlyPrice / 2);
  sub.teacherPerSeance = Math.round(sub.monthlyPrice / 2 / monthSeances);

  db.attendance = [];
  db.payments = [];
  db.unpaidTeacher = [];
  db.independent = [];
  db.freePeriods = [];
  db.enrollments = db.enrollments.filter((e) => e.studentId !== STU);

  // Un seul élève sur cet emploi, et un seul emploi pour lui : les mois du
  // groupe et ceux de l'élève ne peuvent pas diverger.
  const opened = new Date();
  opened.setDate(opened.getDate() - 400);
  const openedIso = opened.toLocaleDateString("fr-CA");
  db.students = db.students.map((st) =>
    st.id === STU
      ? {
          ...st,
          isFree: false,
          registrationDue: 0,
          subscriptionIds: [SUB],
          subscriptionDates: { [SUB]: { subscribedAt: openedIso, startDate: openedIso } },
        }
      : { ...st, subscriptionIds: st.subscriptionIds.filter((id) => id !== SUB) },
  );

  useData.setState(db);
  return sub;
}

/** N jours consécutifs où l'emploi du temps tourne réellement, du plus ancien. */
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

const attend = (date: string, status: "present" | "absent" = "present") =>
  useData.getState().setPresence({ studentId: STU, sessionId: SES, date, status });

/** L'emploi du temps `ses-1` tel que l'écran de paie le voit. */
const emploi = () => teacherEmplois(useData.getState(), TEACHER).find((e) => e.sessionId === SES)!;

beforeEach(() => {
  useData.setState(buildSeed());
});

describe("les mois de la paie sont ceux de l'emploi du temps", () => {
  it("un mois reste EN COURS jusqu'à la séance qui complète le pack", async () => {
    board(4);
    const days = scheduledDays(5);

    for (const day of days.slice(0, 3)) await attend(day);
    const running = emploi();
    expect(running.months[0].state).toBe("running");
    expect(running.months[0].held).toBe(3);
    expect(running.currentCode).toBe("M1");
    expect(running.currentHeld).toBe(3);

    await attend(days[3]);
    const closed = emploi();
    expect(closed.months[0].state).toBe("done");
    expect(closed.months[0].held).toBe(4);
    expect(closed.months[0].endDate).toBe(days[3]);
    // La séance suivante appartient déjà au mois d'après.
    expect(closed.currentCode).toBe("M2");

    await attend(days[4]);
    const next = emploi();
    expect(next.months).toHaveLength(2);
    expect(next.months[1].code).toBe("M2");
    expect(next.months[1].held).toBe(1);
    expect(next.months[1].state).toBe("running");
  });

  it("la part de l'enseignant est comptée mois par mois", async () => {
    const sub = board(4);
    const days = scheduledDays(7);
    // Il paie tout d'avance : aucune dette, donc rien n'est retenu.
    await useData.getState().addSold({ studentId: STU, subscriptionId: SUB, amount: sub.pricePerSession * 4, monthCode: "M1" });
    for (const day of days.slice(0, 4)) await attend(day);
    await useData.getState().addSold({ studentId: STU, subscriptionId: SUB, amount: sub.pricePerSession * 3, monthCode: "M2" });
    for (const day of days.slice(4, 7)) await attend(day);

    const e = emploi();
    expect(e.months[0].gross).toBe(4 * sub.teacherPerSeance!);
    expect(e.months[0].payable).toBe(4 * sub.teacherPerSeance!);
    expect(e.months[1].gross).toBe(3 * sub.teacherPerSeance!);
    expect(e.months[1].payable).toBe(3 * sub.teacherPerSeance!);
    expect(e.payable).toBe(7 * sub.teacherPerSeance!);
  });
});

describe("un élève inscrit en retard ne fige pas la paie", () => {
  it("le mois se ferme dès que son pack de séances a été tenu", async () => {
    const sub = board(4);
    const days = scheduledDays(4);

    // Un deuxième élève arrive à la 3e séance du mois.
    const opened = new Date();
    opened.setDate(opened.getDate() - 400);
    const iso = opened.toLocaleDateString("fr-CA");
    useData.setState({
      students: useData.getState().students.map((st) =>
        st.id === "stu-3"
          ? {
              ...st,
              isFree: false,
              registrationDue: 0,
              subscriptionIds: [SUB],
              subscriptionDates: { [SUB]: { subscribedAt: iso, startDate: iso } },
            }
          : st,
      ),
    });
    for (const id of [STU, "stu-3"]) {
      await useData
        .getState()
        .addSold({ studentId: id, subscriptionId: SUB, amount: sub.pricePerSession * 4, monthCode: "M1" });
    }

    for (const day of days) await attend(day);
    for (const day of days.slice(2)) {
      await useData
        .getState()
        .setPresence({ studentId: "stu-3", sessionId: SES, date: day, status: "present" });
    }

    const m1 = emploi().months[0];
    expect(m1.state).toBe("done");
    expect(m1.students).toHaveLength(2);
    // Le retardataire est bien listé « en retard », sans bloquer le règlement.
    const late = m1.students.find((st) => st.studentId === "stu-3")!;
    expect(late.done).toBe(2);
    expect(late.complete).toBe(false);
    expect(late.debt).toBe(0);
    expect(m1.payable).toBe(6 * sub.teacherPerSeance!);
    expect(defaultPayableMonthKeys(teacherEmplois(useData.getState(), TEACHER))).toContain(
      `${SES}|M1`,
    );
  });
});

describe("l'écran de paie s'ouvre sur le mois CLOS, jamais sur le mois en cours", () => {
  it("un mois entamé (3 séances sur 4) n'est pas proposé", async () => {
    const sub = board(4);
    const days = scheduledDays(7);
    await useData.getState().addSold({ studentId: STU, subscriptionId: SUB, amount: sub.pricePerSession * 7, monthCode: "M1" });
    for (const day of days.slice(0, 4)) await attend(day);
    for (const day of days.slice(4, 7)) await attend(day);

    const emplois = teacherEmplois(useData.getState(), TEACHER);
    const suggested = defaultPayableMonthKeys(emplois);
    expect(suggested).toContain(`${SES}|M1`);
    expect(suggested).not.toContain(`${SES}|M2`);
  });

  it("tant qu'aucun mois n'est clos, rien n'est coché", async () => {
    const sub = board(4);
    await useData.getState().addSold({ studentId: STU, subscriptionId: SUB, amount: sub.pricePerSession * 2, monthCode: "M1" });
    for (const day of scheduledDays(2)) await attend(day);

    expect(defaultPayableMonthKeys(teacherEmplois(useData.getState(), TEACHER))).toHaveLength(0);
    expect(emploi().months[0].payable).toBeGreaterThan(0);
  });
});

describe("un élève qui n'a pas payé retient la part de l'enseignant", () => {
  it("le mois affiche l'impayé, la part est retenue et non versée", async () => {
    const sub = board(4);
    // Il ne verse rien : chaque séance creuse son solde.
    for (const day of scheduledDays(4)) await attend(day);

    const e = emploi();
    const m1 = e.months[0];
    expect(m1.state).toBe("done");
    expect(m1.studentsUnpaid).toBe(1);
    expect(m1.studentsDebt).toBe(4 * sub.pricePerSession);
    expect(m1.gross).toBe(4 * sub.teacherPerSeance!);
    expect(m1.withheld).toBe(4 * sub.teacherPerSeance!);
    expect(m1.payable).toBe(0);

    const rows = unpaidStudents([e]);
    expect(rows).toHaveLength(1);
    expect(rows[0].studentId).toBe(STU);
    expect(rows[0].monthCode).toBe("M1");
    expect(rows[0].debt).toBe(4 * sub.pricePerSession);
  });

  it("une fois la dette réglée, la part revient au paiement suivant", async () => {
    const sub = board(4);
    for (const day of scheduledDays(4)) await attend(day);
    expect(emploi().payable).toBe(0);

    await useData
      .getState()
      .addSold({ studentId: STU, subscriptionId: SUB, amount: sub.pricePerSession * 4, monthCode: "M1" });

    const e = emploi();
    expect(e.months[0].withheld).toBe(0);
    expect(e.months[0].payable).toBe(4 * sub.teacherPerSeance!);
    expect(e.months[0].studentsUnpaid).toBe(0);
  });
});

describe("régler un mois ne touche pas le suivant", () => {
  it("le règlement solde exactement les présences du mois coché", async () => {
    const sub = board(4);
    const days = scheduledDays(7);
    await useData.getState().addSold({ studentId: STU, subscriptionId: SUB, amount: sub.pricePerSession * 7, monthCode: "M1" });
    for (const day of days.slice(0, 7)) await attend(day);

    const before = emploi();
    const m1 = before.months[0];
    const m2 = before.months[1];
    expect(m1.state).toBe("done");
    expect(m2.state).toBe("running");

    const res = await useData.getState().payTeacherSessions({
      teacherId: TEACHER,
      dueIds: m1.payableDueIds,
      amount: m1.payable,
      gross: m1.payable,
      method: "group",
      months: [
        {
          sessionId: SES,
          title: before.title,
          groupName: before.groupName,
          monthCode: "M1",
          seances: m1.held,
          presents: m1.payableDueIds.length,
          students: 1,
          gross: m1.payable,
        },
      ],
    });
    expect(res.ok).toBe(true);

    const after = emploi();
    expect(after.months[0].open).toBe(0);
    expect(after.months[0].settled).toBe(4 * sub.teacherPerSeance!);
    // Le mois en cours est intact : il n'a pas été payé par ricochet.
    expect(after.months[1].open).toBe(3 * sub.teacherPerSeance!);
    expect(after.payable).toBe(3 * sub.teacherPerSeance!);

    const payment = useData.getState().teacherPayments.find((p) => p.id === res.paymentId)!;
    expect(payment.months).toHaveLength(1);
    expect(payment.months![0].monthCode).toBe("M1");
  });
});

describe("les cas particuliers des élèves", () => {
  it("un élève « cas spécial » (gratuit) ne rapporte rien à l'enseignant", async () => {
    board(4);
    useData.setState({
      students: useData
        .getState()
        .students.map((st) => (st.id === STU ? { ...st, isFree: true, studentCase: "special" } : st)),
    });
    for (const day of scheduledDays(4)) await attend(day);

    expect(useData.getState().unpaidTeacher.filter((u) => u.sessionId === SES)).toHaveLength(0);
    expect(emploi().months[0].gross).toBe(0);
  });

  it("« école seule » : l'école encaisse, l'enseignant listé n'est ni payé ni listé", async () => {
    const sub = board(4);
    useData.setState({
      students: useData.getState().students.map((st) =>
        st.id === STU
          ? { ...st, studentCase: "school_only" as const, unpaidTeacherIds: [TEACHER] }
          : st,
      ),
    });
    // Il ne paie que la part de l'école : 4 séances au tarif « école seule ».
    const owed = schoolPerSeanceOf(useData.getState().subscriptions.find((s) => s.id === SUB)) * 4;
    await useData.getState().addSold({ studentId: STU, subscriptionId: SUB, amount: owed, monthCode: "M1" });
    for (const day of scheduledDays(4)) await attend(day);

    // L'élève a bien payé ses séances : son solde est à jour sur SA fiche…
    expect(cycleOf(useData.getState(), STU, SUB, "M1").credited).toBe(owed);
    expect(cycleOf(useData.getState(), STU, SUB, "M1").balance).toBe(0);
    // … mais cet enseignant-là ne touche rien dessus, et l'écran de paie ne le
    // liste même pas : une ligne à 0 DA n'inviterait qu'à une erreur de calcul.
    expect(emploi().months[0].gross).toBe(0);
    expect(emploi().months[0].students.map((s) => s.studentId)).not.toContain(STU);
    expect(sub.pricePerSession).toBeGreaterThan(0);
  });

  it("« réduction » : l'enseignant ne supporte que SA part de la remise", async () => {
    const sub = board(4);
    useData.setState({
      students: useData.getState().students.map((st) =>
        st.id === STU
          ? {
              ...st,
              studentCase: "reduction" as const,
              caseReduction: { type: "amount" as const, schoolValue: 0, teacherValue: 50 },
            }
          : st,
      ),
    });
    await useData.getState().addSold({ studentId: STU, subscriptionId: SUB, amount: sub.pricePerSession * 4, monthCode: "M1" });
    for (const day of scheduledDays(4)) await attend(day);

    expect(emploi().months[0].gross).toBe(4 * (sub.teacherPerSeance! - 50));
  });
});
