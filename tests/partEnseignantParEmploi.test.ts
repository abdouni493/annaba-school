import { describe, it, expect, beforeEach } from "vitest";
import { useData } from "@/lib/store/data";
import { buildSeed } from "@/tests/fixtures/seed";
import { teacherDueRows, teacherEmplois } from "@/lib/teacherMonths";
import { buildPayBoard } from "@/lib/teacherPayBoard";
import { teacherMonthShareOf, teacherPerSeanceOf } from "@/lib/helpers";
import { money } from "@/lib/utils";

/**
 * LA PART DE L'ENSEIGNANT EST CELLE QUE L'EMPLOI DU TEMPS PORTE — toujours.
 *
 * LE SYMPTÔME. Un emploi du temps à 2 000 DA le mois sur 4 séances, dont
 * l'école garde 600 : l'écran du tarif annonce 1 400 DA pour l'enseignant et
 * 350 DA la séance. Son écran de paie, lui, affichait « 3 séances · 1 050 DA »
 * pour un élève pourtant présent aux quatre.
 *
 * LA CAUSE. La part n'existait que si le POINTAGE l'avait écrite, et le
 * pointage ne lisait qu'une seule des deux façons dont le partage s'écrit : la
 * colonne `teacherPerSeance`. Un emploi dont la part école est saisie APRÈS
 * coup n'en avait pas ce jour-là — les séances déjà tenues n'ont donc laissé
 * AUCUNE ligne, et rien n'en créait jamais. L'enseignant les perdait pour de
 * bon.
 *
 * LA RÈGLE MAINTENANT. Un seul calcul, `teacherSeanceRate`, répond partout :
 * le tarif de l'emploi du temps d'abord, le contrat au pourcentage à défaut, et
 * le cas de l'élève a le dernier mot. Les écrans de paie lisent les PRÉSENCES
 * et reconstituent à ce tarif-là la part des séances qu'aucune ligne ne porte ;
 * le règlement les écrit alors pour de bon, sous un identifiant déterministe
 * qui interdit le doublon.
 */
const SES = "ses-1";
const SUB = "sub-1";
const STU = "stu-1";
const TEA = "tea-1";
const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function board() {
  const db = buildSeed();
  db.attendance = [];
  db.payments = [];
  db.unpaidTeacher = [];
  db.freePeriods = [];
  db.teacherPayments = [];
  db.independent = [];
  const opened = new Date();
  opened.setDate(opened.getDate() - 400);
  const openedIso = opened.toLocaleDateString("fr-CA");
  // L'enseignant du symptôme : aucun taux sur sa fiche, chaque emploi du temps
  // le rémunère au tarif qu'il porte.
  db.teachers = db.teachers.map((t) =>
    t.id === TEA ? { ...t, paymentType: "per_group" as const, percentage: 0 } : t,
  );
  // Un seul élève sur l'emploi, pour que le mois se lise d'un coup d'œil.
  db.students = db.students.map((st) =>
    st.id === STU
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
      : { ...st, subscriptionIds: st.subscriptionIds.filter((id) => id !== SUB) },
  );
  db.enrollments = db.enrollments.map((e) =>
    e.studentId === STU && e.subscriptionId === SUB ? { ...e, balance: 0, consumedSeances: 0 } : e,
  );
  useData.setState(db);
}

/** Pointe `count` présences sur les jours ouvrés de l'emploi, en remontant. */
async function attend(count: number, back = 60, studentId = STU) {
  const session = useData.getState().sessions.find((s) => s.id === SES)!;
  const d = new Date();
  d.setDate(d.getDate() - back);
  let done = 0;
  while (done < count) {
    if (session.days.includes(DAY_KEYS[d.getDay()] as never)) {
      await useData.getState().setPresence({
        studentId,
        sessionId: SES,
        date: d.toLocaleDateString("fr-CA"),
        status: "present",
      });
      done += 1;
    }
    d.setDate(d.getDate() + 1);
  }
}

/** Ce que l'écran « Emploi du temps » envoie. Sans `schoolShare`, le tarif est
 *  celui d'un mois dont la part école n'a pas encore été saisie. */
function tariff(seances: number, monthPrice: number, schoolShare?: number, reprice = false) {
  return useData.getState().setSubscriptionPrice(SES, money(monthPrice / seances), {
    scope: "session",
    monthlySeances: seances,
    monthlyPrice: monthPrice,
    repriceUnsettled: reprice,
    ...(schoolShare === undefined
      ? {}
      : {
          schoolMonthShare: schoolShare,
          teacherPerSeance: money((monthPrice - schoolShare) / seances),
        }),
  });
}

function payBoard(monthCode = "M1") {
  const db = useData.getState();
  const emploi = teacherEmplois(db, TEA).find((e) => e.sessionId === SES)!;
  const teacher = db.teachers.find((t) => t.id === TEA)!;
  return buildPayBoard(db, teacher, emploi, monthCode);
}

describe("la part enseignant est celle de l'emploi du temps", () => {
  beforeEach(board);

  it("le mois affiche la part entière, séance comprise pointée avant le tarif", async () => {
    await tariff(4, 2000); // part école pas encore saisie
    await useData.getState().addSold({ studentId: STU, subscriptionId: SUB, amount: 2000 });
    await attend(1, 60);
    // La séance n'a laissé aucune ligne : l'emploi ne portait aucune part.
    expect(useData.getState().unpaidTeacher).toHaveLength(0);

    // L'école saisit la part école : 2 000 − 600 = 1 400 DA, soit 350 la séance.
    await tariff(4, 2000, 600);
    const sub = useData.getState().subscriptions.find((s) => s.id === SUB)!;
    expect(teacherMonthShareOf(sub)).toBe(1400);
    expect(teacherPerSeanceOf(sub)).toBe(350);

    await attend(3, 40);

    const b = payBoard();
    expect(b.teacherMonthShare).toBe(1400);
    expect(b.perSeance).toBe(350);
    const row = b.students.find((r) => r.studentId === STU)!;
    // Quatre présences, quatre séances payables, et le mois entier.
    expect(row.presents).toBe(4);
    expect(row.seances).toBe(4);
    expect(row.amount).toBe(1400);
    expect(b.studentsTotal).toBe(1400);
  });

  it("le règlement écrit vraiment la part reconstituée, et une seule fois", async () => {
    await tariff(4, 2000);
    await useData.getState().addSold({ studentId: STU, subscriptionId: SUB, amount: 2000 });
    await attend(1, 60);
    await tariff(4, 2000, 600);
    await attend(3, 40);

    const b = payBoard();
    const row = b.students.find((r) => r.studentId === STU)!;
    expect(row.dueIds).toHaveLength(4);

    const res = await useData.getState().payTeacherSessions({
      teacherId: TEA,
      dueIds: row.dueIds,
      amount: 1400,
      gross: 1400,
      method: "group",
    });
    expect(res.ok).toBe(true);

    const dues = useData.getState().unpaidTeacher.filter((u) => u.studentId === STU);
    expect(dues).toHaveLength(4);
    expect(dues.every((u) => u.paid)).toBe(true);
    expect(dues.reduce((s, u) => s + u.amount, 0)).toBe(1400);

    // Et le mois est soldé : plus rien n'est dû, ni en double ni en reste.
    const after = payBoard();
    expect(after.studentsTotal).toBe(0);
    expect(after.students.find((r) => r.studentId === STU)!.alreadyPaid).toBe(1400);
  });

  it("re-tarifer écrit les parts que personne n'avait portées", async () => {
    await tariff(4, 2000);
    await useData.getState().addSold({ studentId: STU, subscriptionId: SUB, amount: 2000 });
    await attend(2, 60);
    expect(useData.getState().unpaidTeacher).toHaveLength(0);

    const res = await tariff(4, 2000, 600, true);
    expect(res.repriced).toBe(2);
    const dues = useData.getState().unpaidTeacher.filter((u) => u.studentId === STU);
    expect(dues).toHaveLength(2);
    expect(dues.every((u) => u.amount === 350 && !u.paid)).toBe(true);

    // Relancer ne duplique rien : l'identifiant d'une part est celui de sa séance.
    await tariff(4, 2000, 600, true);
    expect(useData.getState().unpaidTeacher.filter((u) => u.studentId === STU)).toHaveLength(2);
  });

  it("le pointage écrit désormais la part que l'écran affiche", async () => {
    // Le tarif est saisi AVANT : la part s'écrit au pointage, sans reconstitution.
    await tariff(4, 2000, 600);
    await useData.getState().addSold({ studentId: STU, subscriptionId: SUB, amount: 2000 });
    await attend(4, 60);
    const dues = useData.getState().unpaidTeacher.filter((u) => u.studentId === STU);
    expect(dues).toHaveLength(4);
    expect(dues.every((u) => u.amount === 350)).toBe(true);
    expect(payBoard().students.find((r) => r.studentId === STU)!.amount).toBe(1400);
  });

  it("un mois sans part école ne rapporte toujours rien à l'enseignant", async () => {
    // L'école garde tout : il n'y a rien à reconstituer, et surtout pas le mois.
    await tariff(4, 2000);
    await useData.getState().addSold({ studentId: STU, subscriptionId: SUB, amount: 2000 });
    await attend(4, 60);
    const b = payBoard();
    expect(b.teacherMonthShare).toBe(0);
    expect(b.studentsTotal).toBe(0);
    expect(useData.getState().unpaidTeacher).toHaveLength(0);
  });

  it("un emploi du temps OFFERT à l'élève ne fait naître aucune part", async () => {
    await tariff(4, 2000);
    await useData.getState().addSold({ studentId: STU, subscriptionId: SUB, amount: 2000 });
    await attend(2, 60);
    useData.setState({
      students: useData
        .getState()
        .students.map((st) =>
          st.id === STU ? { ...st, studentCase: "special", freeSubscriptionIds: [SUB] } : st,
        ),
    });
    await tariff(4, 2000, 600);
    expect(payBoard().studentsTotal).toBe(0);
    expect(
      teacherDueRows(useData.getState(), TEA).filter((u) => u.studentId === STU),
    ).toHaveLength(0);
  });

  it("« école seule » sur cet emploi ne fait naître aucune part non plus", async () => {
    await tariff(4, 2000);
    await useData.getState().addSold({ studentId: STU, subscriptionId: SUB, amount: 2000 });
    await attend(2, 60);
    useData.setState({
      students: useData
        .getState()
        .students.map((st) =>
          st.id === STU
            ? { ...st, studentCase: "school_only", schoolOnlySubscriptionIds: [SUB] }
            : st,
        ),
    });
    await tariff(4, 2000, 600);
    expect(
      teacherDueRows(useData.getState(), TEA).filter((u) => u.studentId === STU),
    ).toHaveLength(0);
  });

  it("une période portes ouvertes qui ne paie personne ne paie personne", async () => {
    await tariff(4, 2000, 600);
    const from = new Date();
    from.setDate(from.getDate() - 70);
    const to = new Date();
    to.setDate(to.getDate() - 50);
    const session = useData.getState().sessions.find((s) => s.id === SES)!;
    useData.setState({
      freePeriods: [
        {
          id: "fp-test",
          name: "Portes ouvertes",
          startDate: from.toLocaleDateString("fr-CA"),
          endDate: to.toLocaleDateString("fr-CA"),
          allClasses: false,
          classIds: [session.classId],
          payTeachers: false,
          active: true,
          createdAt: new Date().toISOString(),
        },
      ],
    });
    await attend(2, 60);
    expect(useData.getState().unpaidTeacher).toHaveLength(0);
    expect(payBoard().studentsTotal).toBe(0);
  });

  it("un enseignant au pourcentage garde son pourcentage", async () => {
    useData.setState({
      teachers: useData
        .getState()
        .teachers.map((t) =>
          t.id === TEA ? { ...t, paymentType: "percentage" as const, percentage: 40 } : t,
        ),
    });
    // Aucun partage sur l'emploi : c'est le contrat de sa fiche qui s'applique.
    await tariff(4, 2000);
    await useData.getState().addSold({ studentId: STU, subscriptionId: SUB, amount: 2000 });
    await attend(2, 60);
    const dues = useData.getState().unpaidTeacher.filter((u) => u.studentId === STU);
    expect(dues).toHaveLength(2);
    // 2 000 ÷ 4 = 500 la séance, 40 % = 200.
    expect(dues.every((u) => u.amount === 200)).toBe(true);
  });

  it("la fiche de l'enseignant compte les mêmes présences que sa paie", async () => {
    await tariff(4, 2000);
    await useData.getState().addSold({ studentId: STU, subscriptionId: SUB, amount: 2000 });
    await attend(1, 60);
    await tariff(4, 2000, 600);
    await attend(3, 40);

    const rows = teacherDueRows(useData.getState(), TEA).filter((u) => u.studentId === STU);
    expect(rows).toHaveLength(4);
    expect(rows.reduce((s, u) => s + u.amount, 0)).toBe(1400);
  });
});
