import { describe, it, expect, beforeEach } from "vitest";
import { useData } from "@/lib/store/data";
import { buildSeed } from "@/tests/fixtures/seed";
import { cycleOf, cycleSlots, soldFor } from "@/lib/helpers";

/**
 * UNE ABSENCE EST UNE SÉANCE DUE.
 *
 * La place était réservée et l'enseignant est venu : que l'élève y soit ou non
 * ne change rien à ce que la séance coûte. Marquer « absent » prend donc le
 * prix d'une séance de CET emploi du temps sur le solde de CET emploi du temps,
 * exactement comme une présence — et fait avancer le mois d'un cran.
 *
 * Seule la séance ANNULÉE reste gratuite : elle n'a pas eu lieu.
 */

const SUB = "sub-1"; // Maths · Groupe A
const SES = "ses-1";
const STU = "stu-1";

function board(monthSeances = 4) {
  const db = buildSeed();
  const sub = db.subscriptions.find((s) => s.id === SUB)!;
  sub.monthlySeances = monthSeances;
  sub.monthlyPrice = monthSeances * sub.pricePerSession;
  db.attendance = [];
  db.payments = [];
  db.absencePenalties = [];
  db.enrollments = db.enrollments.filter((e) => e.subscriptionId !== SUB);
  db.freePeriods = [];
  const opened = new Date();
  opened.setDate(opened.getDate() - 400);
  const day = opened.toLocaleDateString("fr-CA");
  const student = db.students.find((st) => st.id === STU)!;
  student.subscriptionDates = {
    ...student.subscriptionDates,
    [SUB]: { subscribedAt: day, startDate: day },
  };
  useData.setState(db);
  return sub;
}

const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** N jours consécutifs où l'emploi du temps est bien programmé, du plus ancien. */
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

/** Le jour programmé le plus récent, à `daysBack` jours ou moins d'aujourd'hui. */
function recentScheduledDay(daysBack: number): string {
  const session = useData.getState().sessions.find((s) => s.id === SES)!;
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  for (let i = 0; i < 14; i += 1) {
    if (session.days.includes(DAY_KEYS[d.getDay()] as never)) return d.toLocaleDateString("fr-CA");
    d.setDate(d.getDate() + 1);
  }
  return d.toLocaleDateString("fr-CA");
}

beforeEach(() => {
  useData.setState(buildSeed());
});

describe("le bouton « absent » facture la séance", () => {
  it("prend le prix d'une séance sur le solde de CET emploi du temps", async () => {
    const sub = board(4);
    await useData.getState().addSold({ studentId: STU, subscriptionId: SUB, amount: 2400 });

    const [day] = scheduledDays(1);
    const res = await useData
      .getState()
      .setPresence({ studentId: STU, sessionId: SES, date: day, status: "absent" });

    expect(res.ok).toBe(true);
    expect(res.charged).toBe(sub.pricePerSession);
    expect(res.noCharge).toBeFalsy();
    expect(soldFor(useData.getState(), STU, SUB)).toBe(2400 - sub.pricePerSession);
  });

  it("creuse le solde en dette quand il n'a rien versé", async () => {
    const sub = board(4);
    const days = scheduledDays(2);
    for (const day of days) {
      await useData.getState().setPresence({ studentId: STU, sessionId: SES, date: day, status: "absent" });
    }
    expect(soldFor(useData.getState(), STU, SUB)).toBe(-2 * sub.pricePerSession);
  });

  it("fait avancer le mois comme une présence", async () => {
    const sub = board(4);
    const days = scheduledDays(4);
    await useData.getState().setPresence({ studentId: STU, sessionId: SES, date: days[0], status: "present" });
    await useData.getState().setPresence({ studentId: STU, sessionId: SES, date: days[1], status: "absent" });
    await useData.getState().setPresence({ studentId: STU, sessionId: SES, date: days[2], status: "absent" });

    const m1 = cycleOf(useData.getState(), STU, SUB, "M1");
    expect(m1.done).toBe(3);
    expect(m1.consumed).toBe(3 * sub.pricePerSession);
  });

  it("n'enlève RIEN quand la séance est annulée", async () => {
    board(4);
    await useData.getState().addSold({ studentId: STU, subscriptionId: SUB, amount: 2400 });
    const [day] = scheduledDays(1);

    const res = await useData
      .getState()
      .setPresence({ studentId: STU, sessionId: SES, date: day, status: "cancelled" });

    expect(res.noCharge).toBe(true);
    expect(res.charged).toBe(0);
    expect(soldFor(useData.getState(), STU, SUB)).toBe(2400);
    expect(cycleOf(useData.getState(), STU, SUB, "M1").done).toBe(0);
  });

  it("les trois statuts restent lisibles sur le mois, chacun pour lui-même", async () => {
    board(4);
    const days = scheduledDays(3);
    await useData.getState().setPresence({ studentId: STU, sessionId: SES, date: days[0], status: "present" });
    await useData.getState().setPresence({ studentId: STU, sessionId: SES, date: days[1], status: "absent" });
    await useData.getState().setPresence({ studentId: STU, sessionId: SES, date: days[2], status: "cancelled" });

    const slots = cycleSlots(useData.getState(), STU, SUB, "M1");
    expect(slots.map((a) => a.status)).toEqual(["present", "absent", "cancelled"]);
  });

  it("« marquer absent » par l'autre porte d'entrée facture pareil", async () => {
    const sub = board(4);
    await useData.getState().addSold({ studentId: STU, subscriptionId: SUB, amount: 2400 });
    const [day] = scheduledDays(1);

    const res = await useData.getState().markAttendance(STU, SES, "absent", { date: day });

    expect(res.ok).toBe(true);
    expect(res.cost).toBe(sub.pricePerSession);
    expect(soldFor(useData.getState(), STU, SUB)).toBe(2400 - sub.pricePerSession);
  });
});

describe("la facturation hebdomadaire ne repasse pas derrière une semaine pointée", () => {
  it("saute la semaine déjà notée absente, et facture les semaines muettes", async () => {
    board(4);
    // Il faut un solde ouvert sur l'emploi : la facturation automatique ne
    // touche que les inscriptions qui en ont un.
    await useData.getState().addSold({ studentId: STU, subscriptionId: SUB, amount: 10000 });

    const since = new Date();
    since.setDate(since.getDate() - 60);
    useData.setState({
      school: {
        ...useData.getState().school,
        absencePenaltyEnabled: true,
        absencePenaltySince: since.toLocaleDateString("fr-CA"),
      },
      moduleAbsenceRules: [],
    });

    // Une séance de la semaine dernière, notée ABSENTE : elle a déjà pris son
    // prix sur le solde.
    const marked = recentScheduledDay(9);
    await useData.getState().setPresence({ studentId: STU, sessionId: SES, date: marked, status: "absent" });

    await useData.getState().processWeeklyAbsences();

    const mine = useData.getState().absencePenalties.filter((p) => p.studentId === STU && p.subscriptionId === SUB);
    // Les semaines dont personne n'a rien dit sont bien facturées…
    expect(mine.length).toBeGreaterThan(0);
    // … mais jamais celle où l'absence a déjà été saisie à la main.
    expect(mine.some((p) => p.periodStart <= marked && p.periodEnd > marked)).toBe(false);
  });
});
