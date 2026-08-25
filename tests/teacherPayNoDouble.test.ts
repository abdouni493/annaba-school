import { describe, it, expect, beforeEach } from "vitest";
import { useData } from "@/lib/store/data";
import { buildSeed } from "@/tests/fixtures/seed";
import { teacherEmplois } from "@/lib/teacherMonths";
import { boardTotals, buildPayBoard, freezeBoard, settledMonthCodes } from "@/lib/teacherPayBoard";

/**
 * UNE PART RÉGLÉE NE REVIENT PAS — le bug du « double » et sa correction.
 *
 * L'écran de paie décide, SÉANCE PAR SÉANCE, ce qui est payable : une part
 * n'est retenue que si la séance qui l'a produite n'est pas payée sur CE mois
 * de CET emploi du temps. C'est la règle, et elle est juste — un élève à jour
 * ici débloque son enseignant même s'il doit ailleurs.
 *
 * L'enregistrement, lui, superposait un second filtre : « cet élève doit-il
 * quelque chose, QUELQUE PART ? ». Les deux ne disaient pas la même chose, et
 * l'écart se payait cher :
 *
 *   · la part était cochée, le net sortait de la caisse, la fiche s'imprimait…
 *   · mais la ligne n'était jamais marquée réglée,
 *   · donc elle réapparaissait au mois suivant, et le mois lui-même continuait
 *     de s'afficher « à régler » alors qu'un règlement existait.
 *
 * Deux cas le déclenchaient tous les mois : des frais d'inscription encore dus,
 * et un retardataire qui a soldé son M1 mais vit déjà son M2. Les deux sont
 * testés ici.
 */

const SUB = "sub-1";
const SES = "ses-1";
const PAYER = "stu-1";
const LATE = "stu-2";
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

function payMonth(code: string) {
  const db = useData.getState();
  const teacher = db.teachers.find((t) => t.id === TEACHER)!;
  const b = buildPayBoard(db, teacher, emploiOf(), code);
  const picked = {
    studentIds: b.students.filter((r) => !r.withheld && r.amount > 0).map((r) => r.studentId),
    arrearKeys: b.arrears.map((r) => r.key),
    passagerIds: b.passagers.map((r) => r.id),
    deductionIds: b.deductions.filter((d) => d.selectable).map((d) => d.id),
  };
  const totals = boardTotals(b, picked);
  const chosen = b.students.filter((r) => picked.studentIds.includes(r.studentId));
  const chosenArrears = b.arrears.filter((r) => picked.arrearKeys.includes(r.key));

  return useData.getState().payTeacherSessions({
    teacherId: TEACHER,
    dueIds: chosen.flatMap((r) => r.dueIds),
    arrearDueIds: chosenArrears.flatMap((r) => r.dueIds),
    passagerIds: picked.passagerIds,
    arrears: chosenArrears.map((r) => ({
      studentId: r.studentId,
      studentName: r.name,
      registrationNumber: r.registrationNumber,
      sessionId: SES,
      emploi: b.emploi.title,
      monthCode: r.monthCode,
      seances: r.seances,
      amount: r.amount,
    })),
    amount: totals.net,
    gross: totals.gross,
    method: "group",
    months: [
      {
        sessionId: SES,
        title: b.emploi.title,
        groupName: b.emploi.groupName,
        monthCode: code,
        seances: b.held,
        presents: chosen.reduce((s, r) => s + r.seances, 0),
        students: chosen.length,
        gross: totals.students,
      },
    ],
    board: freezeBoard(db, b, picked),
  });
}

describe("une part réglée ne revient jamais", () => {
  beforeEach(board);

  it("solde la part d'un élève à jour ICI, même s'il doit des frais d'inscription", async () => {
    const [d1, d2] = days(2);
    // Il doit encore ses frais d'inscription — une dette réelle, mais qui ne
    // regarde pas cet enseignant : elle n'a rien à retenir de sa paie.
    useData.setState({
      students: useData
        .getState()
        .students.map((st) => (st.id === PAYER ? { ...st, registrationDue: 2000 } : st)),
    });

    await useData.getState().addSold({ studentId: PAYER, subscriptionId: SUB, amount: 1000 });
    await present(PAYER, d1);
    await present(PAYER, d2);

    const before = buildPayBoard(
      useData.getState(),
      useData.getState().teachers.find((t) => t.id === TEACHER)!,
      emploiOf(),
      "M1",
    );
    // L'écran l'annonce payable : ses deux séances de M1 sont payées.
    expect(before.studentsTotal).toBe(600);
    expect(before.withheldTotal).toBe(0);

    const res = await payMonth("M1");
    expect(res.ok).toBe(true);

    // …et l'enregistrement tient parole : la part est soldée, elle ne
    // réapparaît sur aucun écran suivant.
    expect(useData.getState().unpaidTeacher.every((u) => u.paid)).toBe(true);
    const after = emploiOf();
    expect(after.months[0].open).toBe(0);
    expect(after.payable).toBe(0);
  });

  it("solde un retard de paiement même si l'élève vit déjà son mois suivant", async () => {
    const [d1, d2, d3, d4] = days(4);

    // M1 : les deux viennent, seul PAYER a réglé.
    await useData.getState().addSold({ studentId: PAYER, subscriptionId: SUB, amount: 2000 });
    await present(PAYER, d1);
    await present(LATE, d1);
    await present(PAYER, d2);
    await present(LATE, d2);

    // L'enseignant touche M1 sans la part de LATE : elle est retenue.
    const m1Board = buildPayBoard(
      useData.getState(),
      useData.getState().teachers.find((t) => t.id === TEACHER)!,
      emploiOf(),
      "M1",
    );
    expect(m1Board.withheldTotal).toBe(600);
    await payMonth("M1");

    // LATE s'acquitte de son M1… puis le groupe entame son M2, où il n'a
    // encore rien versé. Sa dette d'aujourd'hui ne doit pas geler le
    // rattrapage d'hier.
    await useData
      .getState()
      .addSold({ studentId: LATE, subscriptionId: SUB, amount: 1000, monthCode: "M1" });
    await present(PAYER, d3);
    await present(LATE, d3);
    await present(PAYER, d4);
    await present(LATE, d4);

    const db = useData.getState();
    const m2 = buildPayBoard(db, db.teachers.find((t) => t.id === TEACHER)!, emploiOf(), "M2");
    // Le retard de M1 est là, dans SA table, avec son mois d'origine.
    expect(m2.arrears).toHaveLength(1);
    expect(m2.arrears[0].monthCode).toBe("M1");
    expect(m2.arrearsTotal).toBe(600);
    // Et LATE retient bien sa part du M2 : les deux faits cohabitent.
    expect(m2.withheldTotal).toBe(600);

    await payMonth("M2");

    // Le rattrapage est consommé : il ne revient pas une troisième fois.
    const after = useData.getState();
    const m3 = buildPayBoard(
      after,
      after.teachers.find((t) => t.id === TEACHER)!,
      teacherEmplois(after, TEACHER).find((e) => e.sessionId === SES)!,
      "M3",
    );
    expect(m3.arrears).toHaveLength(0);
  });

  it("marque le mois comme réglé, pour que l'écran ne repropose pas de le payer", async () => {
    const [d1, d2] = days(2);
    await useData.getState().addSold({ studentId: PAYER, subscriptionId: SUB, amount: 1000 });
    await present(PAYER, d1);
    await present(PAYER, d2);

    const res = await payMonth("M1");
    expect(res.ok).toBe(true);

    const db = useData.getState();
    const settled = settledMonthCodes(db, TEACHER, SES);
    expect(settled.get("M1")?.id).toBe(res.paymentId);

    // Le tableau du mois se sait réglé : l'écran verrouille alors ses cases et
    // retire le bouton d'enregistrement.
    const b = buildPayBoard(db, db.teachers.find((t) => t.id === TEACHER)!, emploiOf(), "M1");
    expect(b.settlement?.id).toBe(res.paymentId);
    // Plus rien à régler dessus : ni élève, ni retard, ni séance libre.
    expect(b.studentsTotal).toBe(0);
    expect(b.arrearsTotal).toBe(0);
    expect(b.passagersTotal).toBe(0);
  });

  it("rouvre tout — et rien de plus — quand le règlement est annulé", async () => {
    const [d1, d2] = days(2);
    await useData.getState().addSold({ studentId: PAYER, subscriptionId: SUB, amount: 1000 });
    await present(PAYER, d1);
    await present(PAYER, d2);
    await useData
      .getState()
      .createPassagerSeances({ sessionId: SES, date: d1, names: ["Sami"], price: 500, schoolShare: 200 });

    const res = await payMonth("M1");
    await useData.getState().deleteTeacherPayment(res.paymentId!);

    const after = emploiOf();
    // Les parts des élèves redeviennent dues…
    expect(after.months[0].open).toBe(600);
    // …et la caisse ne garde pas la sortie du règlement annulé.
    expect(useData.getState().cash.some((c) => c.type === "teacher_payment")).toBe(false);
  });
});
