import { describe, it, expect, beforeEach } from "vitest";
import { useData } from "@/lib/store/data";
import { buildSeed } from "@/tests/fixtures/seed";
import { defaultPayableMonthKeys, teacherEmplois, unlockedArrears } from "@/lib/teacherMonths";

/**
 * CHAQUE MOIS EST INDÉPENDANT — ET LES RETARDATAIRES ONT LEUR PROPRE TABLE.
 *
 * Le cas que la réception vit tous les mois : au moment de régler le M1, un
 * élève n'avait rien versé. Sa part a donc été RETENUE, et l'enseignant a
 * touché le M1 sans elle. L'élève s'acquitte ensuite ; au moment de régler le
 * M2, cette part de M1 est de nouveau due.
 *
 * Elle n'a rien à faire dans le tableau du M2 : elle appartient au M1. Elle
 * apparaît donc comme ARRIÉRÉ DÉBLOQUÉ, avec son mois d'origine — sur l'écran
 * de paie comme sur la fiche imprimée — et le M1 n'est plus jamais recoché
 * comme s'il était à régler une seconde fois.
 */

const SUB = "sub-1";
const SES = "ses-1";
const PAYER = "stu-1"; // il paie à l'heure
const LATE = "stu-2"; // il paie en retard
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
  // La table rase : ni acompte ni absence à retenir, et une caisse vide, pour
  // que les assertions portent sur ce que le test écrit et rien d'autre.
  db.acomptes = [];
  db.absences = [];
  db.teacherExpenses = [];
  db.teacherChildDebts = [];
  db.cash = [];

  const session = db.sessions.find((s) => s.id === SES)!;
  session.teacherId = TEACHER;

  const opened = new Date();
  opened.setDate(opened.getDate() - 400);
  const openedIso = opened.toLocaleDateString("fr-CA");
  db.students = db.students.map((st) =>
    st.id === PAYER || st.id === LATE
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

/** Les `n` prochains jours où l'emploi tourne, à partir de `offsetBack`. */
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

async function present(studentId: string, date: string) {
  await useData.getState().setPresence({ studentId, sessionId: SES, date, status: "present" });
}

describe("les arriérés d'un mois déjà réglé", () => {
  beforeEach(board);

  it("réapparaissent dans leur propre table, avec leur mois d'origine", async () => {
    const [d1, d2, d3] = days(3);

    // M1 : les deux élèves viennent. Seul l'un des deux a payé son mois.
    await useData.getState().addSold({ studentId: PAYER, subscriptionId: SUB, amount: 1000 });
    await present(PAYER, d1);
    await present(LATE, d1);
    await present(PAYER, d2);
    await present(LATE, d2);

    // L'enseignant est réglé du M1 : la part du retardataire est RETENUE.
    let emplois = teacherEmplois(useData.getState(), TEACHER);
    let m1 = emplois[0].months[0];
    expect(m1.withheld).toBe(600); // 2 séances × 300 DA
    expect(m1.payable).toBe(600); // celle du bon payeur

    await useData.getState().payTeacherSessions({
      teacherId: TEACHER,
      dueIds: m1.payableDueIds,
      amount: m1.payable,
      gross: m1.payable,
      method: "group",
      months: [],
    });

    // Le retardataire s'acquitte APRÈS coup, sur son mois M1.
    await useData
      .getState()
      .addSold({ studentId: LATE, subscriptionId: SUB, amount: 1000, monthCode: "M1" });

    // Une séance du M2 est tenue : le mois courant s'ouvre.
    await present(PAYER, d3);

    emplois = teacherEmplois(useData.getState(), TEACHER);
    const arrears = unlockedArrears(emplois);

    expect(arrears).toHaveLength(1);
    expect(arrears[0].studentId).toBe(LATE);
    expect(arrears[0].monthCode).toBe("M1");
    expect(arrears[0].seances).toBe(2);
    expect(arrears[0].amount).toBe(600);
  });

  it("ne recoche jamais le mois déjà réglé comme s'il restait à payer", async () => {
    const [d1, d2] = days(2);
    await useData.getState().addSold({ studentId: PAYER, subscriptionId: SUB, amount: 1000 });
    await present(PAYER, d1);
    await present(LATE, d1);
    await present(PAYER, d2);
    await present(LATE, d2);

    const m1 = teacherEmplois(useData.getState(), TEACHER)[0].months[0];
    await useData.getState().payTeacherSessions({
      teacherId: TEACHER,
      dueIds: m1.payableDueIds,
      amount: m1.payable,
      gross: m1.payable,
      method: "group",
      months: [],
    });
    await useData
      .getState()
      .addSold({ studentId: LATE, subscriptionId: SUB, amount: 1000, monthCode: "M1" });

    const emplois = teacherEmplois(useData.getState(), TEACHER);
    const settled = emplois[0].months[0];
    expect(settled.alreadySettled).toBe(true);
    expect(settled.arrearPayable).toBe(600);
    // Le mois n'est plus proposé : ce qu'il doit encore est un arriéré.
    expect(defaultPayableMonthKeys(emplois)).not.toContain(settled.key);
  });

  it("se soldent avec le règlement suivant, et ne reviennent plus", async () => {
    const [d1, d2] = days(2);
    await useData.getState().addSold({ studentId: PAYER, subscriptionId: SUB, amount: 1000 });
    await present(PAYER, d1);
    await present(LATE, d1);
    await present(PAYER, d2);
    await present(LATE, d2);

    const m1 = teacherEmplois(useData.getState(), TEACHER)[0].months[0];
    await useData.getState().payTeacherSessions({
      teacherId: TEACHER,
      dueIds: m1.payableDueIds,
      amount: m1.payable,
      gross: m1.payable,
      method: "group",
      months: [],
    });
    await useData
      .getState()
      .addSold({ studentId: LATE, subscriptionId: SUB, amount: 1000, monthCode: "M1" });

    const arrears = unlockedArrears(teacherEmplois(useData.getState(), TEACHER));
    const res = await useData.getState().payTeacherSessions({
      teacherId: TEACHER,
      dueIds: [],
      arrearDueIds: arrears.flatMap((a) => a.dueIds),
      arrears: arrears.map((a) => ({
        studentId: a.studentId,
        studentName: a.name,
        registrationNumber: a.registrationNumber,
        sessionId: a.sessionId,
        emploi: a.emploi,
        monthCode: a.monthCode,
        seances: a.seances,
        amount: a.amount,
      })),
      amount: 600,
      gross: 600,
      method: "group",
      months: [],
    });

    expect(res.ok).toBe(true);
    // Le règlement garde la trace de ce qu'il a rattrapé…
    const pay = useData.getState().teacherPayments.find((p) => p.id === res.paymentId)!;
    expect(pay.arrears).toHaveLength(1);
    expect(pay.arrears![0].monthCode).toBe("M1");
    // …et il ne reste plus rien à rattraper.
    expect(unlockedArrears(teacherEmplois(useData.getState(), TEACHER))).toHaveLength(0);
  });
});

describe("l'historique des règlements d'un enseignant", () => {
  beforeEach(board);

  it("enregistre une ligne pour chaque règlement, avec sa date", async () => {
    const [d1] = days(1);
    await useData.getState().addSold({ studentId: PAYER, subscriptionId: SUB, amount: 1000 });
    await present(PAYER, d1);

    const m1 = teacherEmplois(useData.getState(), TEACHER)[0].months[0];
    const res = await useData.getState().payTeacherSessions({
      teacherId: TEACHER,
      dueIds: m1.payableDueIds,
      amount: 300,
      gross: 300,
      method: "group",
      months: [],
    });

    const pay = useData.getState().teacherPayments.find((p) => p.id === res.paymentId)!;
    expect(pay.teacherId).toBe(TEACHER);
    expect(pay.amount).toBe(300);
    expect(pay.paidAt).not.toBe("");
    // Le mouvement de caisse est nommé, pour pouvoir être annulé avec lui.
    expect(useData.getState().cash.some((c) => c.id === pay.cashId)).toBe(true);
  });

  it("laisse aussi une trace quand le règlement passe par le pourcentage", async () => {
    const [d1] = days(1);
    await useData.getState().addSold({ studentId: PAYER, subscriptionId: SUB, amount: 1000 });
    await present(PAYER, d1);

    const before = useData.getState().teacherPayments.length;
    const res = await useData.getState().settleTeacherPercentage(TEACHER);
    expect(res.ok).toBe(true);
    expect(useData.getState().teacherPayments.length).toBe(before + 1);
  });

  it("corrige un règlement sans rouvrir ce qu'il a soldé", async () => {
    const [d1] = days(1);
    await useData.getState().addSold({ studentId: PAYER, subscriptionId: SUB, amount: 1000 });
    await present(PAYER, d1);
    const m1 = teacherEmplois(useData.getState(), TEACHER)[0].months[0];
    const res = await useData.getState().payTeacherSessions({
      teacherId: TEACHER,
      dueIds: m1.payableDueIds,
      amount: 300,
      gross: 300,
      method: "group",
      months: [],
    });

    await useData.getState().updateTeacherPayment(res.paymentId!, { amount: 250 });
    const pay = useData.getState().teacherPayments.find((p) => p.id === res.paymentId)!;
    expect(pay.amount).toBe(250);
    // La caisse suit au dinar près.
    expect(useData.getState().cash.find((c) => c.id === pay.cashId)!.amount).toBe(-250);
    // Les présences restent soldées.
    expect(useData.getState().unpaidTeacher.every((u) => u.paid)).toBe(true);
  });

  it("annule un règlement : tout ce qu'il avait soldé redevient dû", async () => {
    const [d1] = days(1);
    await useData.getState().addSold({ studentId: PAYER, subscriptionId: SUB, amount: 1000 });
    await present(PAYER, d1);
    const m1 = teacherEmplois(useData.getState(), TEACHER)[0].months[0];
    const res = await useData.getState().payTeacherSessions({
      teacherId: TEACHER,
      dueIds: m1.payableDueIds,
      amount: 300,
      gross: 300,
      method: "group",
      months: [],
    });

    await useData.getState().deleteTeacherPayment(res.paymentId!);

    const db = useData.getState();
    expect(db.teacherPayments.find((p) => p.id === res.paymentId)).toBeUndefined();
    expect(db.unpaidTeacher.every((u) => !u.paid)).toBe(true);
    expect(db.cash.some((c) => c.type === "teacher_payment")).toBe(false);
  });
});
