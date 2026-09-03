import { describe, it, expect, beforeEach } from "vitest";
import { useData } from "@/lib/store/data";
import { buildSeed } from "@/tests/fixtures/seed";
import { cycleOf, seanceChargeOf, soldFor, unbilledSeanceTotal } from "@/lib/helpers";

/**
 * UNE SÉANCE SUIVIE MAIS JAMAIS FACTURÉE.
 *
 * Le symptôme, relevé au comptoir : « 3 séances · consommé 3 000 DA » sur un
 * emploi du temps à 1 500 DA la séance. Trois séances à 1 500 en valent 4 500 :
 * la ligne se contredisait elle-même, et le solde affiché juste en dessous
 * répétait le mauvais chiffre.
 *
 * L'origine est toujours la même — une présence écrite à 0 DA alors que rien ne
 * l'offrait : le créneau a été pointé avant que son tarif ne soit saisi, ou la
 * ligne a été corrigée à la main sans que son montant suive.
 *
 * La règle : une séance ne vaut zéro que si quelque chose l'a OFFERTE (séance
 * annulée, première absence de courtoisie, période gratuite, séance tenue avant
 * l'inscription, emploi du temps offert). Hors de ces cas, elle vaut le tarif
 * de l'élève — et le solde suit la même arithmétique, si bien que « consommé »
 * et « Solde de l'emploi » disent enfin la même chose.
 */

const SUB = "sub-1";
const SES = "ses-1";
const STU = "stu-1";

const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** L'emploi du temps de l'énoncé : 4 séances par mois, 1 500 DA la séance. */
function board() {
  const db = buildSeed();
  const sub = db.subscriptions.find((s) => s.id === SUB)!;
  sub.monthlySeances = 4;
  sub.pricePerSession = 1500;
  sub.monthlyPrice = 6000;
  sub.schoolMonthShare = 2000; // école 500 / séance, enseignant 1 000
  sub.teacherPerSeance = 1000;
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
}

function scheduledDay(offsetBack: number): string {
  const session = useData.getState().sessions.find((s) => s.id === SES)!;
  const d = new Date();
  d.setDate(d.getDate() - offsetBack);
  while (!session.days.includes(DAY_KEYS[d.getDay()] as never)) d.setDate(d.getDate() + 1);
  return d.toLocaleDateString("fr-CA");
}

/** Trois présences ordinaires, la première ayant perdu son prix en route. */
async function threeSeancesOneUnpriced() {
  const days: string[] = [];
  for (let back = 40; days.length < 3; back -= 3) {
    const day = scheduledDay(back);
    if (!days.includes(day)) days.push(day);
  }
  for (const day of days) {
    // eslint-disable-next-line no-await-in-loop
    await useData.getState().setPresence({
      studentId: STU,
      sessionId: SES,
      date: day,
      status: "present",
    });
  }
  // La première séance a été écrite à 0 DA — le tarif n'existait pas encore.
  const first = useData
    .getState()
    .attendance.filter((a) => a.studentId === STU && a.sessionId === SES)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))[0];
  useData.setState((state) => ({
    attendance: state.attendance.map((a) =>
      a.id === first.id ? { ...a, amountDeducted: 0 } : a,
    ),
    enrollments: state.enrollments.map((e) =>
      e.studentId === STU && e.subscriptionId === SUB
        ? { ...e, balance: (e.balance ?? 0) + 1500 }
        : e,
    ),
  }));
  return days;
}

describe("une séance suivie sans être facturée", () => {
  beforeEach(() => {
    board();
  });

  it("est reprise au tarif de l'élève dans le consommé du mois", async () => {
    await threeSeancesOneUnpriced();
    const db = useData.getState();
    const cycle = cycleOf(db, STU, SUB, "M1");

    expect(cycle.done).toBe(3);
    // 3 séances à 1 500 : 4 500 — et non 3 000, comme la ligne l'affichait.
    expect(cycle.consumed).toBe(4500);
    expect(cycle.balance).toBe(-4500);
  });

  it("met le solde de l'emploi d'accord avec ce consommé", async () => {
    await threeSeancesOneUnpriced();
    const db = useData.getState();
    expect(unbilledSeanceTotal(db, STU, SUB)).toBe(1500);
    expect(soldFor(db, STU, SUB)).toBe(-4500);
  });

  it("ne touche à rien quand toutes les séances portent leur prix", async () => {
    for (let back = 40; back > 28; back -= 4) {
      // eslint-disable-next-line no-await-in-loop
      await useData.getState().setPresence({
        studentId: STU,
        sessionId: SES,
        date: scheduledDay(back),
        status: "present",
      });
    }
    const db = useData.getState();
    expect(unbilledSeanceTotal(db, STU, SUB)).toBe(0);
    expect(soldFor(db, STU, SUB)).toBe(
      db.enrollments.find((e) => e.studentId === STU && e.subscriptionId === SUB)!.balance,
    );
  });

  it("laisse à zéro ce qui a VRAIMENT été offert", async () => {
    const day = scheduledDay(40);
    await useData
      .getState()
      .setPresence({ studentId: STU, sessionId: SES, date: day, status: "present" });
    const db0 = useData.getState();
    const row = db0.attendance.find((a) => a.studentId === STU && a.sessionId === SES)!;

    // Séance tenue avant son inscription : le prix est « waived », pas perdu.
    const offered = { ...row, amountDeducted: 0, preStart: true, waivedAmount: 1500 };
    expect(seanceChargeOf(db0, offered)).toBe(0);

    // Séance annulée : elle n'a pas eu lieu.
    expect(seanceChargeOf(db0, { ...row, amountDeducted: 0, status: "cancelled" as const })).toBe(0);

    // Première absence de courtoisie : son mois n'a pas commencé.
    expect(seanceChargeOf(db0, { ...row, amountDeducted: 0, status: "absent" as const, noCharge: true })).toBe(0);
  });
});
