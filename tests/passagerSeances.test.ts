import { describe, it, expect, beforeEach } from "vitest";
import { useData } from "@/lib/store/data";
import { buildSeed } from "@/tests/fixtures/seed";
import { teacherEmplois } from "@/lib/teacherMonths";
import { boardTotals, buildPayBoard, freezeBoard, monthTiles } from "@/lib/teacherPayBoard";
import { independentTotals, passagersOn } from "@/lib/helpers";

/**
 * LES ÉLÈVES DE PASSAGE — une séance vendue à quelqu'un qui n'est pas inscrit.
 *
 * Ce que ces tests fixent, dans l'ordre où la réception le vit :
 *
 *  1. On en saisit PLUSIEURS d'un coup, et un nom vide reste valide : quelqu'un
 *     qui vient une fois n'a pas toujours de nom qu'on retienne.
 *  2. Le prix se partage : ce que l'école garde est écrit, le reste est la part
 *     de l'enseignant. Rien n'est deviné.
 *  3. Ils apparaissent sur la feuille de CETTE séance-là et sur AUCUNE autre —
 *     la séance suivante repart sans eux.
 *  4. Leur part se règle avec le MOIS où la séance tombe, dans la table des
 *     retards de paiement et des séances libres, et une fois réglée elle ne
 *     revient jamais.
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

/** Les `n` prochains jours où l'emploi tourne. */
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

describe("le partage d'une séance libre", () => {
  it("donne à l'enseignant ce que l'école ne garde pas", () => {
    expect(independentTotals({ price: 500, schoolShare: 200 })).toMatchObject({
      price: 500,
      school: 200,
      teacher: 300,
    });
  });

  it("borne la part de l'école au prix — elle ne peut pas manger plus que tout", () => {
    expect(independentTotals({ price: 500, schoolShare: 900 })).toMatchObject({
      school: 500,
      teacher: 0,
    });
  });

  it("laisse tout à l'école quand la part n'a jamais été saisie", () => {
    // Une séance enregistrée avant ce découpage ne doit RIEN inventer : aucun
    // ancien total ne bouge derrière le dos de personne.
    const t = independentTotals({ price: 800 });
    expect(t).toMatchObject({ school: 800, teacher: 0, unsplit: true });
  });
});

describe("créer des élèves de passage sur une séance", () => {
  beforeEach(board);

  it("en enregistre plusieurs d'un coup, nom vide compris", async () => {
    const [d1] = days(1);
    const res = await useData.getState().createPassagerSeances({
      sessionId: SES,
      date: d1,
      names: ["Sami", "", "Nadia"],
      price: 500,
      schoolShare: 200,
    });

    expect(res.ok).toBe(true);
    expect(res.ids).toHaveLength(3);

    const rows = passagersOn(useData.getState(), SES, d1);
    expect(rows.map((r) => r.passagerName)).toEqual(["Sami", "Passager", "Nadia"]);
    // Chacun paie 500, l'école garde 200, l'enseignant touche 300.
    expect(res.total).toBe(1500);
    expect(res.teacherTotal).toBe(900);
    expect(rows.every((r) => r.schoolShare === 200)).toBe(true);
  });

  it("encaisse la recette en caisse, une seule fois", async () => {
    const [d1] = days(1);
    await useData.getState().createPassagerSeances({
      sessionId: SES,
      date: d1,
      names: ["", "", ""],
      price: 400,
      schoolShare: 150,
    });
    const cash = useData.getState().cash.filter((c) => c.type === "student_payment");
    expect(cash).toHaveLength(1);
    expect(cash[0].amount).toBe(1200);
  });

  it("ne les montre que sur LA séance où ils sont venus", async () => {
    const [d1, d2] = days(2);
    await useData
      .getState()
      .createPassagerSeances({ sessionId: SES, date: d1, names: ["Sami"], price: 500, schoolShare: 200 });

    expect(passagersOn(useData.getState(), SES, d1)).toHaveLength(1);
    // La séance suivante repart sans eux : c'est tout l'intérêt du passager.
    expect(passagersOn(useData.getState(), SES, d2)).toHaveLength(0);
  });
});

describe("la séance libre sur la paie de l'enseignant", () => {
  beforeEach(board);

  it("tombe dans le mois où elle a eu lieu, avec sa part", async () => {
    const [d1, d2] = days(2);
    await useData.getState().addSold({ studentId: PAYER, subscriptionId: SUB, amount: 1000 });
    await present(PAYER, d1);
    await present(PAYER, d2);

    await useData
      .getState()
      .createPassagerSeances({ sessionId: SES, date: d1, names: ["Sami", "Nadia"], price: 500, schoolShare: 200 });

    const m1 = emploiOf().months[0];
    expect(m1.passagers).toHaveLength(2);
    expect(m1.passagerRevenue).toBe(1000);
    expect(m1.passagerPayable).toBe(600);
    // Le mois doit désormais les 2 séances de l'élève (600) + les passagers.
    expect(m1.payable).toBe(600 + 600);
  });

  it("apparaît dans la table 2 du mois, jamais dans celle des élèves", async () => {
    const [d1, d2] = days(2);
    await useData.getState().addSold({ studentId: PAYER, subscriptionId: SUB, amount: 1000 });
    await present(PAYER, d1);
    await present(PAYER, d2);
    await useData
      .getState()
      .createPassagerSeances({ sessionId: SES, date: d2, names: ["Sami"], price: 500, schoolShare: 200 });

    const db = useData.getState();
    const teacher = db.teachers.find((t) => t.id === TEACHER)!;
    const b = buildPayBoard(db, teacher, emploiOf(), "M1");

    expect(b.passagers).toHaveLength(1);
    expect(b.passagersTotal).toBe(300);
    expect(b.passagersRevenue).toBe(500);
    // Il n'est pas un élève du mois : il n'a ni solde, ni dette, ni ligne là-bas.
    expect(b.students.some((r) => r.name === "Sami")).toBe(false);

    const totals = boardTotals(b, {
      studentIds: b.students.map((r) => r.studentId),
      arrearKeys: [],
      passagerIds: b.passagers.map((r) => r.id),
      deductionIds: [],
    });
    // 2 séances × 300 pour l'élève, + 300 pour le passager.
    expect(totals.students).toBe(600);
    expect(totals.passagers).toBe(300);
    expect(totals.gross).toBe(900);
  });

  it("se règle avec le mois, et ne revient jamais ensuite", async () => {
    const [d1, d2] = days(2);
    await useData.getState().addSold({ studentId: PAYER, subscriptionId: SUB, amount: 1000 });
    await present(PAYER, d1);
    await present(PAYER, d2);
    await useData
      .getState()
      .createPassagerSeances({ sessionId: SES, date: d1, names: ["Sami"], price: 500, schoolShare: 200 });

    const db = useData.getState();
    const teacher = db.teachers.find((t) => t.id === TEACHER)!;
    const b = buildPayBoard(db, teacher, emploiOf(), "M1");
    const picked = {
      studentIds: b.students.map((r) => r.studentId),
      arrearKeys: [],
      passagerIds: b.passagers.map((r) => r.id),
      deductionIds: [],
    };
    const totals = boardTotals(b, picked);

    const res = await useData.getState().payTeacherSessions({
      teacherId: TEACHER,
      dueIds: b.students.flatMap((r) => r.dueIds),
      passagerIds: picked.passagerIds,
      amount: totals.net,
      gross: totals.gross,
      method: "group",
      months: [],
      board: freezeBoard(db, b, picked),
    });
    expect(res.ok).toBe(true);

    // La séance libre est marquée réglée : elle sort des mois à venir.
    expect(useData.getState().independent.every((i) => i.teacherPaid)).toBe(true);
    const after = emploiOf();
    expect(after.months[0].passagers).toHaveLength(0);
    expect(after.payable).toBe(0);
  });

  it("garde la trace de la séance libre sur la fiche de paie figée", async () => {
    const [d1] = days(1);
    await useData.getState().addSold({ studentId: PAYER, subscriptionId: SUB, amount: 1000 });
    await present(PAYER, d1);
    await useData
      .getState()
      .createPassagerSeances({ sessionId: SES, date: d1, names: ["Sami"], price: 500, schoolShare: 200 });

    const db = useData.getState();
    const teacher = db.teachers.find((t) => t.id === TEACHER)!;
    const b = buildPayBoard(db, teacher, emploiOf(), "M1");
    const frozen = freezeBoard(db, b, {
      studentIds: b.students.map((r) => r.studentId),
      arrearKeys: [],
      passagerIds: b.passagers.map((r) => r.id),
      deductionIds: [],
    });

    expect(frozen.passagers).toHaveLength(1);
    expect(frozen.passagers![0]).toMatchObject({
      name: "Sami",
      price: 500,
      schoolShare: 200,
      teacherShare: 300,
    });
    expect(frozen.passagersTotal).toBe(300);
    // Le brut figé additionne bien les trois tables.
    expect(frozen.gross).toBe(frozen.studentsTotal + frozen.arrearsTotal + 300);
  });

  it("rend le mois réglable même avant qu'il soit clos", async () => {
    // Un passager paie d'avance : sa part n'attend pas la fin du mois.
    const [d1] = days(1);
    await useData.getState().addSold({ studentId: PAYER, subscriptionId: SUB, amount: 1000 });
    await present(PAYER, d1);
    await useData
      .getState()
      .createPassagerSeances({ sessionId: SES, date: d1, names: ["Sami"], price: 500, schoolShare: 500 });

    const db = useData.getState();
    const tiles = monthTiles(db, emploiOf(), TEACHER);
    expect(tiles[0].passagerCount).toBe(1);
    // L'école a tout gardé : la séance libre ne rapporte rien à l'enseignant.
    expect(tiles[0].passagers).toBe(0);
  });
});
