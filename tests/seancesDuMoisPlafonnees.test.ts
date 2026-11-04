import { describe, it, expect, beforeEach } from "vitest";
import { useData } from "@/lib/store/data";
import { buildSeed } from "@/tests/fixtures/seed";
import {
  cycleOf,
  cycleSlotGrid,
  dayPointageBySession,
  enrollmentCycles,
  soldFor,
} from "@/lib/helpers";
import type { AttendanceRecord } from "@/lib/types";

/**
 * « 5/4 » SUR LA FEUILLE DE PRÉSENCE D'UN EMPLOI DE 4 SÉANCES.
 *
 * La ligne d'un élève lit « séances suivies / séances du mois qui sont les
 * siennes ». Les deux nombres se comptaient sur deux bases différentes :
 * le dénominateur sur la grille (une case par séance DU GROUPE, moins celles
 * tenues avant son arrivée), le numérateur sur ses LIGNES. Deux lignes le même
 * jour (deux postes qui pointent en même temps), ou une ligne posée sur une
 * séance d'avant son point d'entrée, et la feuille affichait 5/4.
 */
const SUB = "sub-1";
const SES = "ses-1";
const A = "stu-1";
const B = "stu-2";
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
  db.unpaidTeacher = db.unpaidTeacher.filter((u) => u.sessionId !== SES);
  db.freePeriods = [];
  const opened = new Date();
  opened.setDate(opened.getDate() - 400);
  const openedIso = opened.toLocaleDateString("fr-CA");
  db.students = db.students.map((st) =>
    [A, B].includes(st.id)
      ? {
          ...st,
          isFree: false,
          studentCase: "normal" as const,
          subscriptionIds: [SUB],
          subscriptionDates: { [SUB]: { subscribedAt: openedIso, startDate: openedIso } },
        }
      : { ...st, subscriptionIds: st.subscriptionIds.filter((id) => id !== SUB) },
  );
  useData.setState(db);
}

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

const mark = (studentId: string, date: string) =>
  useData.getState().setPresence({ studentId, sessionId: SES, date, status: "present" });

/** ce que la ligne de l'élève affiche : « done / séances qui sont les siennes » */
function counter(studentId: string, code = "M1") {
  const c = cycleOf(useData.getState(), studentId, SUB, code);
  return { done: c.done, of: Math.max(0, c.size - c.lead) };
}

describe("les séances d'un mois ne dépassent jamais le pack", () => {
  beforeEach(board);

  it("deux lignes le même jour (deux postes) comptent pour UNE séance", async () => {
    const days = seanceDays(5);
    for (const d of days.slice(0, 4)) {
      await mark(A, d);
      await mark(B, d);
    }
    // Un second poste avait pointé A le même jour : la ligne existe en double.
    const first = useData.getState().attendance.find((a) => a.studentId === A)!;
    const twin: AttendanceRecord = { ...first, id: "att-twin" };
    useData.setState((s) => ({ attendance: [...s.attendance, twin] }));

    const c = counter(A);
    expect(c.of).toBe(4);
    expect(c.done).toBe(4);
    expect(c.done).toBeLessThanOrEqual(c.of);
    // La grille et le compteur racontent la même histoire.
    const grid = cycleSlotGrid(useData.getState(), A, SUB, "M1");
    expect(grid.filter(Boolean)).toHaveLength(c.done);
    // La même séance ne se paie pas deux fois : 4 séances, 4 séances débitées.
    expect(cycleOf(useData.getState(), A, SUB, "M1").consumed).toBe(4000);
    expect(soldFor(useData.getState(), A, SUB)).toBe(-4000);
    // La séance du jour suivant ouvre bien le M2 — il n'a pas « pris » une
    // séance de trop au M1.
    await mark(A, days[4]);
    expect(counter(A, "M2").done).toBe(1);
  });

  it("une ligne posée sur une séance d'avant son point d'entrée devient la sienne", async () => {
    const days = seanceDays(4);
    // Le groupe a tenu la séance 1 ; B est inscrit à la séance 2…
    await mark(A, days[0]);
    useData.setState((s) => ({
      students: s.students.map((st) =>
        st.id === B
          ? {
              ...st,
              subscriptionDates: {
                [SUB]: { subscribedAt: days[1], startDate: days[1], joinMonthCode: "M1", joinSlotIndex: 1 },
              },
            }
          : st,
      ),
    }));
    // …mais il était bien venu à la séance 1, et la réception l'y a pointé
    // après coup. Il suit ensuite les trois autres.
    await mark(B, days[0]);
    for (const d of days.slice(1)) {
      await mark(A, d);
      await mark(B, d);
    }

    const c = counter(B);
    expect(c.done).toBe(4);
    expect(c.of).toBe(4);
    expect(c.done).toBeLessThanOrEqual(c.of);
    const grid = cycleSlotGrid(useData.getState(), B, SUB, "M1");
    expect(grid.filter(Boolean)).toHaveLength(4);
  });

  it("sans ligne sur les séances d'avant, il reste exempté de celles-ci", async () => {
    const days = seanceDays(4);
    await mark(A, days[0]);
    useData.setState((s) => ({
      students: s.students.map((st) =>
        st.id === B
          ? {
              ...st,
              subscriptionDates: {
                [SUB]: { subscribedAt: days[1], startDate: days[1], joinMonthCode: "M1", joinSlotIndex: 1 },
              },
            }
          : st,
      ),
    }));
    for (const d of days.slice(1)) {
      await mark(A, d);
      await mark(B, d);
    }
    const c = counter(B);
    expect(c).toEqual({ done: 3, of: 3 });
    expect(cycleOf(useData.getState(), B, SUB, "M1").complete).toBe(true);
  });

  it("aucun mois, d'aucun élève, n'affiche plus de séances que son pack", async () => {
    const days = seanceDays(9);
    for (const d of days) {
      await mark(A, d);
      await mark(B, d);
    }
    const twin = { ...useData.getState().attendance.find((a) => a.studentId === B)!, id: "att-twin-b" };
    useData.setState((s) => ({ attendance: [...s.attendance, twin] }));
    for (const id of [A, B]) {
      for (const m of enrollmentCycles(useData.getState(), id, SUB)) {
        expect(m.done).toBeLessThanOrEqual(Math.max(0, m.size - m.lead));
      }
    }
  });
});

describe("tableau de bord : « pointés / élèves » ne dépasse jamais le groupe", () => {
  beforeEach(board);

  it("une ligne en double et un élève parti ne font pas « 3/2 »", async () => {
    const [day] = seanceDays(1);
    await mark(A, day);
    await mark(B, day);
    // stu-3 est pointé ce jour-là, puis quitte le groupe…
    useData.setState((s) => ({
      students: s.students.map((st) =>
        st.id === "stu-3" ? { ...st, subscriptionIds: [...st.subscriptionIds, SUB] } : st,
      ),
    }));
    await mark("stu-3", day);
    useData.setState((s) => ({
      students: s.students.map((st) =>
        st.id === "stu-3"
          ? { ...st, subscriptionIds: st.subscriptionIds.filter((id) => id !== SUB) }
          : st,
      ),
    }));
    // …et un second poste avait pointé A une deuxième fois.
    const first = useData.getState().attendance.find((a) => a.studentId === A)!;
    useData.setState((s) => ({ attendance: [...s.attendance, { ...first, id: "att-twin" }] }));

    const p = dayPointageBySession(useData.getState(), day).get(SES)!;
    expect(p).toEqual({ roster: 2, marked: 2, priced: true });
  });

  it("le badge compte les élèves de la feuille : inscrit au mois suivant, il n'y est pas encore", async () => {
    const days = seanceDays(5);
    for (const d of days.slice(0, 4)) await mark(A, d);
    // B n'arrive qu'au M2 : la feuille de la 1re séance ne le liste pas.
    useData.setState((s) => ({
      students: s.students.map((st) =>
        st.id === B
          ? {
              ...st,
              subscriptionDates: {
                [SUB]: { subscribedAt: days[4], startDate: days[4], joinMonthCode: "M2", joinSlotIndex: 0 },
              },
            }
          : st,
      ),
    }));
    expect(dayPointageBySession(useData.getState(), days[0]).get(SES)).toEqual({
      roster: 1,
      marked: 1,
      priced: true,
    });
    await mark(B, days[4]);
    await mark(A, days[4]);
    expect(dayPointageBySession(useData.getState(), days[4]).get(SES)).toEqual({
      roster: 2,
      marked: 2,
      priced: true,
    });
  });
});
