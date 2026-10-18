import { describe, it, expect, beforeEach } from "vitest";
import { useData } from "@/lib/store/data";
import { buildSeed } from "@/tests/fixtures/seed";
import {
  cycleLead,
  cycleOf,
  cycleSlots,
  joinPointFor,
  studentMonthPrice,
  studentMonthPriceFrom,
} from "@/lib/helpers";

/**
 * AJOUTÉ EN COURS DE ROUTE, IL DÉMARRE À LA SÉANCE OÙ EN EST LE GROUPE.
 *
 * La réception ne pointe souvent que les PRÉSENTS : un élève absent n'a pas de
 * ligne ce jour-là. Le point d'entrée se lisait sur un vote des élèves du
 * groupe, que ces trous faisaient paraître en retard — le nouvel élève entrait
 * alors à la séance 1 ou 2 alors que le groupe était à la 3, et les séances
 * d'avant s'ouvraient sur sa ligne. Il se lit désormais sur les séances que
 * l'emploi du temps a réellement tenues, et le nouvel élève est EXEMPTÉ de
 * celles d'avant : son mois d'entrée ne lui coûte que ce qu'il suit.
 *
 * Un mois de 4 séances à 4 000 DA : 1 000 DA la séance.
 */

const SUB = "sub-1";
const SES = "ses-1";
const A = "stu-1";
const B = "stu-2";
const C = "stu-3";
/** l'élève existant qu'on ajoute au groupe depuis le tableau de bord */
const LATE = "stu-4";

const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function board() {
  const db = buildSeed();
  const sub = db.subscriptions.find((s) => s.id === SUB)!;
  sub.monthlySeances = 4;
  sub.monthlyPrice = 4000;
  sub.pricePerSession = 1000;
  db.attendance = db.attendance.filter((a) => a.sessionId !== SES);
  db.payments = db.payments.filter((p) => p.subscriptionId !== SUB);
  db.enrollments = db.enrollments.filter((e) => e.subscriptionId !== SUB);
  db.freePeriods = [];
  const opened = new Date();
  opened.setDate(opened.getDate() - 400);
  const openedIso = opened.toLocaleDateString("fr-CA");
  db.students = db.students.map((st) =>
    [A, B, C].includes(st.id)
      ? {
          ...st,
          isFree: false,
          studentCase: "normal" as const,
          subscriptionIds: [SUB],
          subscriptionDates: { [SUB]: { subscribedAt: openedIso, startDate: openedIso } },
        }
      : {
          ...st,
          isFree: false,
          studentCase: "normal" as const,
          subscriptionIds: st.subscriptionIds.filter((id) => id !== SUB),
        },
  );
  useData.setState(db);
}

/** Les N prochains jours où l'emploi tourne, en partant de loin dans le passé. */
function seanceDays(count: number): string[] {
  const session = useData.getState().sessions.find((s) => s.id === SES)!;
  const out: string[] = [];
  const d = new Date();
  d.setDate(d.getDate() - 90);
  while (out.length < count) {
    if (session.days.includes(DAY_KEYS[d.getDay()] as never)) out.push(d.toLocaleDateString("fr-CA"));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

const present = (studentId: string, date: string) =>
  useData.getState().setPresence({ studentId, sessionId: SES, date, status: "present" });

/** Le groupe tient `held` séances, mais la réception n'y pointe que les présents. */
async function groupHeld(days: string[], held: number) {
  // Séance 1 : A et C ; séance 2 : A et B ; séance 3 : B seul. Chaque élève a
  // donc des trous — exactement ce qu'une feuille « présents seulement » donne.
  const who = [[A, C], [A, B], [B]];
  for (let i = 0; i < held; i++) for (const id of who[i % who.length]) await present(id, days[i]);
}

beforeEach(board);

describe("il entre à la séance OÙ EN EST le groupe", () => {
  it("un élève existant ajouté au groupe à la séance 3 démarre à la séance 3", async () => {
    const days = seanceDays(4);
    await groupHeld(days, 2);

    const res = await useData.getState().subscribeStudent({
      studentId: LATE,
      subscriptionId: SUB,
      date: days[2],
    });
    expect(res).toMatchObject({ ok: true, monthCode: "M1", slotIndex: 2 });

    const db = useData.getState();
    // Les séances 1 et 2 ne sont pas les siennes : elles restent vides sur sa
    // ligne au lieu de s'y ouvrir.
    expect(cycleLead(db, LATE, SUB, "M1")).toBe(2);
    expect(cycleSlots(db, LATE, SUB, "M1")).toHaveLength(0);
    expect(cycleOf(db, LATE, SUB, "M1").balance).toBe(0);
  });

  it("un élève créé à la séance 4 démarre à la séance 4", async () => {
    const days = seanceDays(4);
    await groupHeld(days, 3);
    // La création lit le même point d'entrée (l'élève n'existe pas encore).
    expect(joinPointFor(useData.getState(), SUB, days[3])).toEqual({ monthCode: "M1", slotIndex: 3 });
  });

  it("la séance du jour déjà pointée pour le groupe est la sienne", async () => {
    const days = seanceDays(4);
    await groupHeld(days, 2);
    await present(A, days[2]);
    expect(joinPointFor(useData.getState(), SUB, days[2])).toEqual({ monthCode: "M1", slotIndex: 2 });
  });

  it("au mois suivant, il entre au bon mois et à la bonne séance", async () => {
    const days = seanceDays(6);
    for (let i = 0; i < 5; i++) await present(A, days[i]);
    expect(joinPointFor(useData.getState(), SUB, days[5])).toEqual({ monthCode: "M2", slotIndex: 1 });
  });
});

describe("il est exempté des séances tenues avant lui", () => {
  it("son mois d'entrée ne lui coûte que les séances qui restent", () => {
    const db = useData.getState();
    const st = db.students.find((s) => s.id === LATE)!;
    const sub = db.subscriptions.find((s) => s.id === SUB)!;
    expect(studentMonthPrice(st, sub)).toBe(4000);
    expect(studentMonthPriceFrom(st, sub, 0)).toBe(4000);
    expect(studentMonthPriceFrom(st, sub, 2)).toBe(2000);
    expect(studentMonthPriceFrom(st, sub, 3)).toBe(1000);
  });

  it("ce qu'il verse pour ses séances règle son mois, sans dette pour les séances d'avant", async () => {
    const days = seanceDays(4);
    await groupHeld(days, 2);
    await useData.getState().subscribeStudent({ studentId: LATE, subscriptionId: SUB, date: days[2] });

    const db = useData.getState();
    const st = db.students.find((s) => s.id === LATE)!;
    const sub = db.subscriptions.find((s) => s.id === SUB)!;
    const owed = studentMonthPriceFrom(st, sub, cycleLead(db, LATE, SUB, "M1"));
    expect(owed).toBe(2000);

    await useData.getState().addSold({ studentId: LATE, subscriptionId: SUB, amount: owed, monthCode: "M1" });
    await present(LATE, days[2]);
    await present(LATE, days[3]);

    const m1 = cycleOf(useData.getState(), LATE, SUB, "M1");
    expect(m1.done).toBe(2);
    expect(m1.complete).toBe(true);
    expect(m1.consumed).toBe(2000);
    expect(m1.balance).toBe(0);
  });
});
