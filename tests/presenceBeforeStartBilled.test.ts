import { describe, it, expect, beforeEach } from "vitest";
import { useData } from "@/lib/store/data";
import { buildSeed } from "@/tests/fixtures/seed";
import { cycleOf, soldFor } from "@/lib/helpers";

/**
 * UNE PRÉSENCE SUIVIE, MAIS DATÉE AVANT LA DATE DE DÉBUT DE L'INSCRIPTION.
 *
 * Le symptôme, relevé au comptoir sur un emploi du temps à 1 500 DA la séance :
 *
 *     2/4 séance(s) · consommé 1 500 DA
 *     Solde de l'emploi : 1 500 DA dus
 *
 * …pour un élève venu à DEUX séances. Deux séances à 1 500 en valent 3 000 : la
 * ligne se contredisait. L'origine : la feuille de présence a pointé l'élève sur
 * un jour ANTÉRIEUR à la date de début enregistrée sur son inscription, si bien
 * que cette présence — pourtant réelle — était « offerte » (avant inscription) et
 * laissée à 0 DA, tout en comptant pour une séance du mois.
 *
 * La règle posée : une PRÉSENCE se facture toujours (l'élève est venu). « Avant
 * inscription » n'offre plus qu'une ABSENCE, jamais une séance suivie.
 */

const SUB = "sub-1";
const SES = "ses-1";
const STU = "stu-1";

const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** L'emploi du temps de l'énoncé : 4 séances par mois, 1 500 DA la séance, et
 *  une inscription dont la date de début tombe APRÈS la première séance suivie. */
function board(startBack: number) {
  const db = buildSeed();
  const sub = db.subscriptions.find((s) => s.id === SUB)!;
  sub.monthlySeances = 4;
  sub.pricePerSession = 1500;
  sub.monthlyPrice = 6000;
  sub.schoolMonthShare = 2000;
  sub.teacherPerSeance = 1000;
  db.attendance = [];
  db.payments = [];
  db.unpaidTeacher = [];
  db.freePeriods = [];
  db.enrollments = db.enrollments.filter((e) => e.subscriptionId !== SUB);

  const start = new Date();
  start.setDate(start.getDate() - startBack);
  const startIso = start.toLocaleDateString("fr-CA");
  db.students = db.students.map((st) =>
    st.id === STU
      ? {
          ...st,
          isFree: false,
          studentCase: "normal" as const,
          subscriptionIds: st.subscriptionIds.includes(SUB)
            ? st.subscriptionIds
            : [...st.subscriptionIds, SUB],
          // Inscription "commencée" il y a `startBack` jours seulement.
          subscriptionDates: {
            ...st.subscriptionDates,
            [SUB]: { subscribedAt: startIso, startDate: startIso },
          },
        }
      : st,
  );
  db.enrollments = [
    ...db.enrollments,
    {
      id: "enr-before-start",
      studentId: STU,
      subscriptionId: SUB,
      paidSeances: 0,
      consumedSeances: 0,
      balance: 0,
      startDate: startIso,
      monthSeances: 4,
      createdAt: new Date().toISOString(),
    },
  ];
  useData.setState(db);
}

/** Un jour PROGRAMMÉ de l'emploi, `offsetBack` jours avant aujourd'hui. */
function scheduledDay(offsetBack: number): string {
  const session = useData.getState().sessions.find((s) => s.id === SES)!;
  const d = new Date();
  d.setDate(d.getDate() - offsetBack);
  while (!session.days.includes(DAY_KEYS[d.getDay()] as never)) d.setDate(d.getDate() + 1);
  return d.toLocaleDateString("fr-CA");
}

const present = (date: string) =>
  useData.getState().setPresence({ studentId: STU, sessionId: SES, date, status: "present" });

describe("une présence datée avant le début de l'inscription", () => {
  beforeEach(() => {
    board(10); // inscription commencée il y a 10 jours
  });

  it("est facturée au tarif — l'élève est bien venu", async () => {
    // Une séance 30 jours avant aujourd'hui : bien AVANT le début (−10 j).
    const before = scheduledDay(30);
    expect(before < scheduledDay(10)).toBe(true);
    await present(before);

    const db = useData.getState();
    const row = db.attendance.find((a) => a.studentId === STU && a.sessionId === SES)!;
    // La séance suivie porte son prix, et n'est plus marquée « avant inscription ».
    expect(row.amountDeducted).toBe(1500);
    expect(row.preStart).toBeFalsy();
  });

  it("fait dire la même chose au consommé et au solde", async () => {
    await present(scheduledDay(30)); // avant le début
    await present(scheduledDay(6)); // après le début

    const db = useData.getState();
    const cycle = cycleOf(db, STU, SUB, "M1");
    // Deux séances suivies, deux séances facturées : 3 000, pas 1 500.
    expect(cycle.done).toBe(2);
    expect(cycle.consumed).toBe(3000);
    expect(soldFor(db, STU, SUB)).toBe(-3000);
  });

  it("laisse une ABSENCE antérieure au début sans frais", async () => {
    // Une absence avant le début reste offerte : son mois n'a pas commencé.
    const before = scheduledDay(30);
    await useData
      .getState()
      .setPresence({ studentId: STU, sessionId: SES, date: before, status: "absent" });

    const db = useData.getState();
    const row = db.attendance.find((a) => a.studentId === STU && a.sessionId === SES);
    // Une absence n'ouvre aucune dette (première absence de courtoisie, ou séance
    // avant inscription) : rien n'est débité.
    expect(row?.amountDeducted ?? 0).toBe(0);
    expect(soldFor(db, STU, SUB)).toBe(0);
  });
});
