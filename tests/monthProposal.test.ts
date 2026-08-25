import { describe, it, expect, beforeEach } from "vitest";
import { useData } from "@/lib/store/data";
import { buildSeed } from "@/tests/fixtures/seed";
import { cycleOf, monthProposal } from "@/lib/helpers";

/**
 * LA PROPOSITION D'ENCAISSEMENT DE LA FEUILLE DE PRÉSENCE.
 *
 * Elle part de la PREMIÈRE séance de l'élève sur le mois, jamais de son dernier
 * pointage : venir à une séance ne la paie pas. Un élève entré à la séance 1 et
 * pointé une fois en est à sa deuxième — et doit toujours les quatre.
 */

const SUB = "sub-1";
const SES = "ses-1";
const STU = "stu-1";

const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** Un emploi du temps à 4 séances de 500 DA — 2 000 DA le mois. */
function board() {
  const db = buildSeed();
  const sub = db.subscriptions.find((s) => s.id === SUB)!;
  sub.monthlySeances = 4;
  sub.monthlyPrice = 2000;
  sub.schoolMonthShare = 800;
  sub.teacherPerSeance = 300;
  sub.pricePerSession = 500;

  db.attendance = [];
  db.payments = [];
  db.unpaidTeacher = [];
  db.independent = [];
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
          registrationDue: 0,
          subscriptionIds: [SUB],
          subscriptionDates: { [SUB]: { subscribedAt: openedIso, startDate: openedIso } },
        }
      : { ...st, subscriptionIds: st.subscriptionIds.filter((id) => id !== SUB) },
  );

  useData.setState(db);
  return sub;
}

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

const attend = (date: string) =>
  useData.getState().setPresence({ studentId: STU, sessionId: SES, date, status: "present" });

const proposal = (code = "M1") => monthProposal(useData.getState(), STU, SUB, code);

beforeEach(() => {
  useData.setState(buildSeed());
});

describe("la proposition part de la première séance du mois", () => {
  it("avant tout pointage, elle vaut le mois entier", () => {
    board();
    expect(proposal()).toMatchObject({ unit: 500, mine: 4, billable: 4, total: 2000, current: 1 });
  });

  it("pointé une fois sans payer, elle vaut TOUJOURS le mois entier", async () => {
    board();
    const [d1] = scheduledDays(1);
    await attend(d1);

    const p = proposal();
    // Il en est à sa 2e séance — c'est une information, pas une base de calcul.
    expect(p.current).toBe(2);
    // Sa première séance n'est pas payée : les quatre restent dues.
    expect(p.billable).toBe(4);
    expect(p.total).toBe(2000);
  });

  it("les trois quarts du mois tenus sans payer se proposent toujours en entier", async () => {
    board();
    for (const day of scheduledDays(3)) await attend(day);

    const p = proposal();
    expect(p.current).toBe(4);
    expect(p.billable).toBe(4);
    expect(p.total).toBe(2000);
    expect(cycleOf(useData.getState(), STU, SUB, "M1").balance).toBe(-1500);
  });
});

describe("ce qui est déjà versé sort de la proposition", () => {
  it("deux séances payées : la proposition tombe aux deux dernières", async () => {
    board();
    await useData
      .getState()
      .addSold({ studentId: STU, subscriptionId: SUB, amount: 1000, monthCode: "M1" });
    for (const day of scheduledDays(2)) await attend(day);

    const p = proposal();
    expect(p.credited).toBe(1000);
    expect(p.covered).toBe(2);
    expect(p.billable).toBe(2);
    expect(p.total).toBe(1000);
  });

  it("le mois entièrement versé ne propose plus rien", async () => {
    board();
    await useData
      .getState()
      .addSold({ studentId: STU, subscriptionId: SUB, amount: 2000, monthCode: "M1" });
    for (const day of scheduledDays(4)) await attend(day);

    expect(proposal()).toMatchObject({ billable: 0, total: 0 });
  });
});

describe("un élève entré en cours de mois ne paie que ses séances à lui", () => {
  it("entré à la 3e séance du groupe, son mois n'en compte que deux", () => {
    board();
    useData.setState({
      students: useData.getState().students.map((st) =>
        st.id === STU
          ? {
              ...st,
              subscriptionDates: {
                ...st.subscriptionDates,
                [SUB]: {
                  ...st.subscriptionDates?.[SUB],
                  joinMonthCode: "M1",
                  joinSlotIndex: 2,
                },
              },
            }
          : st,
      ),
    });

    const p = proposal();
    expect(p.mine).toBe(2);
    expect(p.billable).toBe(2);
    expect(p.total).toBe(1000);
  });
});
