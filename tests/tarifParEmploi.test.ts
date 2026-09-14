import { describe, it, expect, beforeEach } from "vitest";
import { useData } from "@/lib/store/data";
import { buildSeed } from "@/tests/fixtures/seed";
import {
  monthlyPriceOf,
  schoolMonthShareOf,
  seancePriceOf,
  soldFor,
  studentListPrice,
  teacherPerSeanceOf,
} from "@/lib/helpers";
import { money } from "@/lib/utils";

/**
 * LE TARIF D'UN EMPLOI DU TEMPS S'ENREGISTRE, ET IL SE CALCULE.
 *
 * Deux pannes se répondaient, et la réception les lisait comme une seule :
 * « je change le prix, je rouvre, il n'a pas bougé ».
 *
 *  1. L'écran « Emploi du temps » écrivait sur TOUS les groupes du même cours.
 *     Corriger le prix d'un groupe réécrivait celui de son jumeau — et rouvrir
 *     le premier y montrait le prix du second.
 *  2. Le prix d'une séance vivait dans sa propre colonne, sans lien avec le
 *     mois : un mois porté de 4 800 à 6 000 DA laissait la séance à l'ancien
 *     tarif, si bien que la feuille de présence facturait un prix et l'écran du
 *     mois en affichait un autre.
 *
 * Et une fois le tarif juste, il fallait encore que le MOIS EN COURS le suive :
 * les séances déjà pointées mais non réglées se re-tarifent sur demande.
 */
const SES = "ses-1";
const SIBLING = "ses-2";
const SUB = "sub-1";
const STU = "stu-1";
const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function board() {
  const db = buildSeed();
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
  db.enrollments = db.enrollments.map((e) =>
    e.studentId === STU && e.subscriptionId === SUB
      ? { ...e, balance: 0, consumedSeances: 0 }
      : e,
  );
  useData.setState(db);
}

/** Pointe `count` présences sur les jours ouvrés de l'emploi, en remontant. */
async function attend(count: number, back = 60) {
  const session = useData.getState().sessions.find((s) => s.id === SES)!;
  const d = new Date();
  d.setDate(d.getDate() - back);
  let done = 0;
  while (done < count) {
    if (session.days.includes(DAY_KEYS[d.getDay()] as never)) {
      await useData.getState().setPresence({
        studentId: STU,
        sessionId: SES,
        date: d.toLocaleDateString("fr-CA"),
        status: "present",
      });
      done += 1;
    }
    d.setDate(d.getDate() + 1);
  }
}

/** Ce que l'écran « Emploi du temps » envoie quand on enregistre son tarif. */
function savePlannerTariff(
  sessionId: string,
  seances: number,
  monthPrice: number,
  schoolShare: number,
  repriceUnsettled = false,
) {
  return useData.getState().setSubscriptionPrice(sessionId, money(monthPrice / seances), {
    scope: "session",
    monthlySeances: seances,
    monthlyPrice: monthPrice,
    schoolMonthShare: schoolShare,
    teacherPerSeance: money((monthPrice - schoolShare) / seances),
    repriceUnsettled,
  });
}

describe("le tarif d'un emploi du temps s'enregistre", () => {
  beforeEach(board);

  it("écrit sur CET emploi du temps, et pas sur le groupe voisin", async () => {
    const before = monthlyPriceOf(
      useData.getState().subscriptions.find((s) => s.sessionId === SIBLING),
    );

    await savePlannerTariff(SES, 6, 9000, 5000);

    const mine = useData.getState().subscriptions.find((s) => s.sessionId === SES)!;
    const sibling = useData.getState().subscriptions.find((s) => s.sessionId === SIBLING)!;
    expect(monthlyPriceOf(mine)).toBe(9000);
    expect(schoolMonthShareOf(mine)).toBe(5000);
    // Le jumeau n'a pas bougé : c'est ce qui faisait « revenir » l'ancien prix.
    expect(monthlyPriceOf(sibling)).toBe(before);
  });

  it("garde le prix d'une séance collé au prix du mois", async () => {
    await savePlannerTariff(SES, 6, 9000, 5000);
    const sub = useData.getState().subscriptions.find((s) => s.sessionId === SES)!;
    expect(sub.pricePerSession).toBe(1500);
    expect(seancePriceOf(sub)).toBe(1500);
    expect(teacherPerSeanceOf(sub)).toBe(money(4000 / 6));
    // Et c'est bien ce prix-là que la feuille de présence facture.
    const student = useData.getState().students.find((s) => s.id === STU)!;
    expect(studentListPrice(student, sub)).toBe(1500);
  });

  it("l'écran des abonnements, lui, garde tous les groupes du cours ensemble", async () => {
    await useData.getState().setSubscriptionPrice(SES, 1000, {
      monthlySeances: 4,
      monthlyPrice: 4000,
      schoolMonthShare: 2000,
    });
    const sibling = useData.getState().subscriptions.find((s) => s.sessionId === SIBLING)!;
    expect(monthlyPriceOf(sibling)).toBe(4000);
  });

  it("un emploi du temps sans classe ni enseignant n'impose son tarif à personne", async () => {
    useData.setState({
      sessions: useData
        .getState()
        .sessions.map((s) =>
          s.id === SES || s.id === SIBLING ? { ...s, classId: "", teacherId: "" } : s,
        ),
    });
    await useData.getState().setSubscriptionPrice(SES, 1000, {
      monthlySeances: 4,
      monthlyPrice: 4000,
      schoolMonthShare: 2000,
    });
    const sibling = useData.getState().subscriptions.find((s) => s.sessionId === SIBLING)!;
    expect(monthlyPriceOf(sibling)).not.toBe(4000);
  });
});

describe("le mois en cours suit le nouveau tarif", () => {
  beforeEach(board);

  it("ne compte que les séances dont le prix bougerait", async () => {
    await attend(3);
    // Tarif inchangé : rien à re-tarifer.
    expect(useData.getState().unsettledSeanceCount(SES, "session")).toBe(0);
    await savePlannerTariff(SES, 8, 8000, 4000);
    // Tarif changé, séances pas encore réglées : les trois sont à reprendre.
    expect(useData.getState().unsettledSeanceCount(SES, "session")).toBe(3);
  });

  it("re-tarife les séances non réglées, solde et part enseignant compris", async () => {
    await useData.getState().addSold({ studentId: STU, subscriptionId: SUB, amount: 4800 });
    await attend(3); // 3 × 600 = 1 800 DA débités
    expect(soldFor(useData.getState(), STU, SUB)).toBe(3000);

    const res = await savePlannerTariff(SES, 8, 8000, 4000, true);
    expect(res.repriced).toBe(3);

    // 3 séances à 1 000 DA : 4 800 − 3 000 = 1 800 DA restants.
    expect(soldFor(useData.getState(), STU, SUB)).toBe(1800);
    const rows = useData.getState().attendance.filter((a) => a.studentId === STU);
    expect(rows.every((a) => a.amountDeducted === 1000)).toBe(true);
    // La part de l'enseignant suit le même mouvement : 4 000 ÷ 8 = 500.
    const dues = useData.getState().unpaidTeacher.filter((u) => u.studentId === STU);
    expect(dues).toHaveLength(3);
    expect(dues.every((u) => u.amount === 500)).toBe(true);
  });

  it("ne touche pas à une séance déjà réglée à l'enseignant", async () => {
    await useData.getState().addSold({ studentId: STU, subscriptionId: SUB, amount: 4800 });
    await attend(2);
    // La première part est versée : cette séance-là est close.
    const first = useData.getState().unpaidTeacher.filter((u) => u.studentId === STU)[0];
    useData.setState({
      unpaidTeacher: useData
        .getState()
        .unpaidTeacher.map((u) => (u.id === first.id ? { ...u, paid: true } : u)),
    });

    const res = await savePlannerTariff(SES, 8, 8000, 4000, true);
    expect(res.repriced).toBe(1);
    const amounts = useData
      .getState()
      .attendance.filter((a) => a.studentId === STU)
      .map((a) => a.amountDeducted)
      .sort((a, b) => a - b);
    expect(amounts).toEqual([600, 1000]);
  });

  it("laisse le mois tel quel quand l'école ne le demande pas", async () => {
    await useData.getState().addSold({ studentId: STU, subscriptionId: SUB, amount: 4800 });
    await attend(3);
    const res = await savePlannerTariff(SES, 8, 8000, 4000, false);
    expect(res.repriced).toBe(0);
    expect(soldFor(useData.getState(), STU, SUB)).toBe(3000);
  });
});
