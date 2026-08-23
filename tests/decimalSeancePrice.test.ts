import { describe, it, expect, beforeEach } from "vitest";
import { useData } from "@/lib/store/data";
import { buildSeed } from "@/tests/fixtures/seed";
import {
  schoolPerSeanceOf,
  seancePriceOf,
  soldFor,
  studentListPrice,
  teacherPerSeanceOf,
} from "@/lib/helpers";
import { formatDA, money } from "@/lib/utils";

/**
 * LE PRIX D'UNE SÉANCE GARDE SES DÉCIMALES.
 *
 * Un mois ne se divise presque jamais en un compte rond : 4 000 DA sur 3
 * séances font 1 333,33 DA la séance, pas 1 333. Arrondir chaque division à
 * l'entier faisait dériver l'addition de plusieurs dinars par mois — l'élève
 * payait un peu trop, l'enseignant touchait un peu moins, et la somme des
 * lignes cessait d'égaler le total affiché.
 *
 * Ces tests fixent la règle des deux côtés du partage : ce que l'élève paie, ce
 * que l'école garde, ce que l'enseignant touche.
 */

const SUB = "sub-1";
const SES = "ses-1";
const STU = "stu-1";

const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** Un mois de 4 000 DA sur 3 séances, dont l'école garde 2 500. */
function board() {
  const db = buildSeed();
  const sub = db.subscriptions.find((s) => s.id === SUB)!;
  sub.monthlySeances = 3;
  sub.monthlyPrice = 4000;
  sub.schoolMonthShare = 2500;
  sub.pricePerSession = money(4000 / 3);
  sub.teacherPerSeance = money((4000 - 2500) / 3);
  db.attendance = [];
  db.payments = [];
  db.unpaidTeacher = [];
  db.freePeriods = [];
  db.enrollments = db.enrollments.filter((e) => e.subscriptionId !== SUB);

  const opened = new Date();
  opened.setDate(opened.getDate() - 400);
  const openedIso = opened.toLocaleDateString("fr-CA");
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
      : st,
  );
  useData.setState(db);
  return sub;
}

function scheduledDay(offsetBack = 30): string {
  const session = useData.getState().sessions.find((s) => s.id === SES)!;
  const d = new Date();
  d.setDate(d.getDate() - offsetBack);
  while (!session.days.includes(DAY_KEYS[d.getDay()] as never)) d.setDate(d.getDate() + 1);
  return d.toLocaleDateString("fr-CA");
}

describe("le prix d'une séance, en décimales", () => {
  beforeEach(() => {
    board();
  });

  it("divise le mois sans arrondir au dinar", () => {
    const sub = useData.getState().subscriptions.find((s) => s.id === SUB)!;
    expect(seancePriceOf(sub)).toBe(1333.33);
    expect(schoolPerSeanceOf(sub)).toBe(833.33);
    expect(teacherPerSeanceOf(sub)).toBe(500);
  });

  it("écrit le tarif décimal sur l'abonnement au moment de la création", async () => {
    await useData.getState().setSubscriptionPrice(SES, money(2500 / 7), {
      monthlySeances: 7,
      monthlyPrice: 2500,
      schoolMonthShare: 1000,
    });
    const sub = useData.getState().subscriptions.find((s) => s.id === SUB)!;
    expect(sub.monthlyPrice).toBe(2500);
    expect(sub.schoolMonthShare).toBe(1000);
    // 1 500 DA de part enseignant sur 7 séances = 214,29 DA — jamais 214.
    expect(teacherPerSeanceOf(sub)).toBe(214.29);
    expect(schoolPerSeanceOf(sub)).toBe(142.86);
  });

  it("débite le solde de l'élève au centime près", async () => {
    await useData.getState().addSold({ studentId: STU, subscriptionId: SUB, amount: 4000 });
    await useData
      .getState()
      .setPresence({ studentId: STU, sessionId: SES, date: scheduledDay(), status: "present" });

    const db = useData.getState();
    const row = db.attendance.find((a) => a.studentId === STU && a.sessionId === SES)!;
    expect(row.amountDeducted).toBe(1333.33);
    expect(soldFor(db, STU, SUB)).toBe(2666.67);
  });

  it("paie l'enseignant au centime près sur chaque présence", async () => {
    await useData.getState().addSold({ studentId: STU, subscriptionId: SUB, amount: 4000 });
    await useData
      .getState()
      .setPresence({ studentId: STU, sessionId: SES, date: scheduledDay(), status: "present" });

    const due = useData.getState().unpaidTeacher.find((u) => u.studentId === STU)!;
    expect(due.amount).toBe(500);
  });

  it("garde le prix affiché identique au prix facturé", () => {
    const db = useData.getState();
    const sub = db.subscriptions.find((s) => s.id === SUB)!;
    const student = db.students.find((s) => s.id === STU)!;
    expect(studentListPrice(student, sub)).toBe(1333.33);
  });
});

describe("l'affichage des montants", () => {
  it("montre la virgule quand il y a des décimales, et rien quand il n'y en a pas", () => {
    // `Intl` sépare les milliers par une espace fine insécable : on ne compare
    // donc que ce qui compte ici, la partie décimale et l'unité.
    expect(formatDA(1333.33)).toContain(",33");
    expect(formatDA(1333.33)).toContain("DA");
    expect(formatDA(4000)).not.toContain(",");
  });

  it("n'invente jamais de troisième décimale", () => {
    expect(money(1000 / 3)).toBe(333.33);
    expect(money(2 / 3)).toBe(0.67);
  });

  it("écrit le signe devant un montant négatif", () => {
    expect(formatDA(-1333.33).startsWith("-")).toBe(true);
  });
});
