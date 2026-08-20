import { describe, it, expect, beforeEach } from "vitest";
import { useData } from "@/lib/store/data";
import { buildSeed } from "@/tests/fixtures/seed";
import {
  currentCycleCode,
  cycleLead,
  cycleOf,
  cycleSlots,
  enrolledInMonth,
  enrollmentStart,
  joinPointFor,
  sessionMonthDays,
  soldFor,
} from "@/lib/helpers";
import type { Student } from "@/lib/types";

/**
 * Un élève n'entre pas sur un emploi du temps à sa séance 1 : il arrive LÀ OÙ
 * EN EST LE GROUPE. Inscrit pendant le 2e mois, sur la 3e séance, il est écrit
 * sur M2 · séance 3 — les séances tenues avant lui ne sont pas les siennes et
 * les mois précédents ne le listent pas du tout.
 */

const SUB = "sub-1";
const SES = "ses-1";
const OLD = "stu-1"; // l'élève qui suit le groupe depuis le début
const NEW = "stu-new"; // celui qui arrive en cours de route

/** Un tableau propre : UN seul élève sur l'emploi, rien de pointé. */
function board(monthSeances = 4) {
  const db = buildSeed();
  const sub = db.subscriptions.find((s) => s.id === SUB)!;
  sub.monthlySeances = monthSeances;
  sub.monthlyPrice = monthSeances * sub.pricePerSession;
  sub.schoolMonthShare = Math.round(sub.monthlyPrice / 2);
  sub.teacherPerSeance = Math.round(sub.monthlyPrice / 2 / monthSeances);
  db.attendance = [];
  db.payments = [];
  db.enrollments = db.enrollments.filter((e) => e.subscriptionId !== SUB);
  db.freePeriods = [];

  const opened = new Date();
  opened.setDate(opened.getDate() - 400);
  const openedIso = opened.toLocaleDateString("fr-CA");

  db.students = db.students.map((st) =>
    st.id === OLD
      ? {
          ...st,
          subscriptionDates: {
            ...st.subscriptionDates,
            [SUB]: { subscribedAt: openedIso, startDate: openedIso },
          },
        }
      : { ...st, subscriptionIds: st.subscriptionIds.filter((id) => id !== SUB) },
  );
  useData.setState(db);
  return sub;
}

const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** N jours consécutifs où l'emploi tourne vraiment, du plus ancien au plus récent. */
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

const present = (studentId: string, date: string) =>
  useData.getState().setPresence({ studentId, sessionId: SES, date, status: "present" });

/** Le groupe a vécu M1 en entier puis les 2 premières séances de M2. */
async function groupOnM2Seance3(): Promise<string[]> {
  const days = scheduledDays(7);
  for (const day of days.slice(0, 6)) await present(OLD, day);
  expect(currentCycleCode(useData.getState(), OLD, SUB)).toBe("M2");
  expect(cycleOf(useData.getState(), OLD, SUB, "M2").done).toBe(2);
  return days;
}

/** Le nouvel élève, tel que la fiche de création l'écrit. */
function registerNew(monthCode: string, slotIndex: number, day: string) {
  const student: Student = {
    id: NEW,
    registrationNumber: "00099",
    firstName: "Nadir",
    lastName: "Zerrouki",
    birthDate: "",
    phone: "",
    email: "nadir.zerrouki@eleve.test",
    rfid: "RFID-9099",
    isFree: false,
    subscriptionIds: [SUB],
    subscriptionDates: {
      [SUB]: {
        subscribedAt: day,
        startDate: day,
        joinMonthCode: monthCode,
        joinSlotIndex: slotIndex,
      },
    },
  };
  useData.setState({ students: [...useData.getState().students, student] });
  return student;
}

beforeEach(() => {
  useData.setState(buildSeed());
});

describe("l'élève entre là où en est le groupe", () => {
  it("le point d'entrée est le mois vécu par le groupe et la séance du jour", async () => {
    board(4);
    const days = await groupOnM2Seance3();

    // Deux séances de M2 tenues : le nouveau vient s'asseoir à la 3e.
    expect(sessionMonthDays(useData.getState(), SUB, "M2")).toEqual([days[4], days[5]]);
    expect(joinPointFor(useData.getState(), SUB, days[6])).toEqual({
      monthCode: "M2",
      slotIndex: 2,
    });
  });

  it("un groupe encore vierge fait entrer en M1 · séance 1", () => {
    board(4);
    const [day] = scheduledDays(1);
    expect(joinPointFor(useData.getState(), SUB, day)).toEqual({ monthCode: "M1", slotIndex: 0 });
  });

  it("inscrit le jour d'une séance déjà pointée, il rejoint CETTE séance", async () => {
    board(4);
    const days = await groupOnM2Seance3();
    // Le groupe a déjà été pointé aujourd'hui : le nouveau prend la même séance.
    await present(OLD, days[6]);
    expect(joinPointFor(useData.getState(), SUB, days[6])).toEqual({
      monthCode: "M2",
      slotIndex: 2,
    });
  });

  it("la séance qui déborde du pack ouvre le mois suivant", async () => {
    board(4);
    const days = scheduledDays(9);
    for (const day of days.slice(0, 8)) await present(OLD, day);
    // M1 et M2 sont clos : le nouveau entre en M3, séance 1.
    expect(joinPointFor(useData.getState(), SUB, days[8])).toEqual({
      monthCode: "M3",
      slotIndex: 0,
    });
  });

  it("l'action subscribeStudent écrit ce point d'entrée sur la fiche", async () => {
    board(4);
    const days = await groupOnM2Seance3();
    registerNew("M1", 0, days[6]); // fiche volontairement fausse…
    const res = await useData.getState().subscribeStudent({
      studentId: NEW,
      subscriptionId: SUB,
      date: days[6],
    });
    // …recalée sur l'état réel du groupe.
    expect(res).toMatchObject({ ok: true, monthCode: "M2", slotIndex: 2 });
    expect(enrollmentStart(useData.getState(), NEW, SUB)).toEqual({
      monthIndex: 1,
      slotIndex: 2,
      offset: 6,
    });
  });
});

describe("les mois et les séances d'avant ne sont pas les siens", () => {
  it("il n'est listé ni sur M1 ni sur les séances de M2 tenues avant lui", async () => {
    board(4);
    const days = await groupOnM2Seance3();
    registerNew("M2", 2, days[6]);
    const db = useData.getState();

    expect(enrolledInMonth(db, NEW, SUB, "M1")).toBe(false);
    expect(enrolledInMonth(db, NEW, SUB, "M2")).toBe(true);
    expect(enrolledInMonth(db, OLD, SUB, "M1")).toBe(true);

    // Sur M2, les deux premières colonnes ne sont pas à lui.
    expect(cycleLead(db, NEW, SUB, "M2")).toBe(2);
    expect(cycleLead(db, NEW, SUB, "M3")).toBe(0);
    expect(cycleLead(db, OLD, SUB, "M2")).toBe(0);
    expect(cycleSlots(db, NEW, SUB, "M1")).toEqual([]);
  });

  it("sans avoir été pointé une seule fois, il vit déjà le mois du groupe", async () => {
    board(4);
    const days = await groupOnM2Seance3();
    registerNew("M2", 2, days[6]);
    expect(currentCycleCode(useData.getState(), NEW, SUB)).toBe("M2");
    expect(cycleOf(useData.getState(), NEW, SUB, "M2").done).toBe(0);
    expect(cycleOf(useData.getState(), NEW, SUB, "M2").lead).toBe(2);
  });

  it("sa toute première présence tombe sur M2, jamais sur M1", async () => {
    board(4);
    const days = await groupOnM2Seance3();
    registerNew("M2", 2, days[6]);

    await present(NEW, days[6]);

    const m1 = cycleOf(useData.getState(), NEW, SUB, "M1");
    const m2 = cycleOf(useData.getState(), NEW, SUB, "M2");
    expect(m1.done).toBe(0);
    expect(m1.records).toEqual([]);
    expect(m2.done).toBe(1);
    expect(m2.records).toHaveLength(1);
    expect(m2.startDate).toBe(days[6]);
    expect(cycleSlots(useData.getState(), NEW, SUB, "M2")).toHaveLength(1);
  });

  it("son mois se termine avec celui du groupe : 2 séances suffisent à le clore", async () => {
    board(4);
    const days = scheduledDays(9);
    for (const day of days.slice(0, 6)) await present(OLD, day);
    registerNew("M2", 2, days[6]);

    await present(NEW, days[6]);
    expect(cycleOf(useData.getState(), NEW, SUB, "M2").complete).toBe(false);

    await present(NEW, days[7]);
    const m2 = cycleOf(useData.getState(), NEW, SUB, "M2");
    expect(m2.done).toBe(2); // 2 séances faites + 2 jamais siennes = le pack de 4
    expect(m2.complete).toBe(true);
    expect(currentCycleCode(useData.getState(), NEW, SUB)).toBe("M3");

    // Et la séance suivante ouvre bien M3 pour lui comme pour le groupe.
    await present(NEW, days[8]);
    expect(cycleOf(useData.getState(), NEW, SUB, "M3").done).toBe(1);
  });

  it("son solde est versé sur le mois de son entrée, pas sur M1", async () => {
    const sub = board(4);
    const days = await groupOnM2Seance3();
    registerNew("M2", 2, days[6]);

    // Le mois par défaut d'un versement est celui qu'il vit.
    await useData.getState().addSold({ studentId: NEW, subscriptionId: SUB, amount: 2400 });
    expect(cycleOf(useData.getState(), NEW, SUB, "M1").credited).toBe(0);
    expect(cycleOf(useData.getState(), NEW, SUB, "M2").credited).toBe(2400);

    await present(NEW, days[6]);
    expect(soldFor(useData.getState(), NEW, SUB)).toBe(2400 - sub.pricePerSession);
    expect(cycleOf(useData.getState(), NEW, SUB, "M2").balance).toBe(2400 - sub.pricePerSession);
    expect(cycleOf(useData.getState(), NEW, SUB, "M1").balance).toBe(0);
  });
});

describe("désinscrire un élève du groupe", () => {
  it("il sort de la liste, son historique et son solde restent", async () => {
    const sub = board(4);
    const days = await groupOnM2Seance3();
    registerNew("M2", 2, days[6]);
    await useData.getState().addSold({ studentId: NEW, subscriptionId: SUB, amount: 2400 });
    await present(NEW, days[6]);

    const res = await useData.getState().unsubscribeStudent(NEW, SUB);
    expect(res.ok).toBe(true);
    expect(res.balance).toBe(2400 - sub.pricePerSession);

    const db = useData.getState();
    const student = db.students.find((s) => s.id === NEW)!;
    expect(student.subscriptionIds).not.toContain(SUB);
    // Le bloc d'inscription est CONSERVÉ et daté de la sortie : sa fiche
    // continue d'afficher cet emploi du temps, son historique et son solde.
    expect(student.subscriptionDates?.[SUB]?.unsubscribedAt).toBe(res.leftOn);
    expect(res.leftOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // L'argent et les présences ne sont pas effacés.
    expect(soldFor(db, NEW, SUB)).toBe(2400 - sub.pricePerSession);
    expect(db.attendance.filter((a) => a.studentId === NEW && a.sessionId === SES)).toHaveLength(1);
    expect(db.enrollments.some((e) => e.studentId === NEW && e.subscriptionId === SUB)).toBe(true);
  });

  it("désinscrire deux fois ne fait rien la seconde", async () => {
    board(4);
    const days = await groupOnM2Seance3();
    registerNew("M2", 2, days[6]);
    expect((await useData.getState().unsubscribeStudent(NEW, SUB)).ok).toBe(true);
    expect((await useData.getState().unsubscribeStudent(NEW, SUB)).ok).toBe(false);
  });

  it("réinscrit plus tard, il repart de là où en est le groupe À CE MOMENT-LÀ", async () => {
    board(4);
    const days = scheduledDays(9);
    for (const day of days.slice(0, 6)) await present(OLD, day);
    registerNew("M2", 2, days[6]);
    await useData.getState().unsubscribeStudent(NEW, SUB);

    // Le groupe continue sans lui : M2 est clos, M3 a commencé.
    for (const day of days.slice(6, 9)) await present(OLD, day);
    const back = await useData.getState().subscribeStudent({
      studentId: NEW,
      subscriptionId: SUB,
      date: scheduledDays(10)[9],
    });
    expect(back).toMatchObject({ ok: true, monthCode: "M3", slotIndex: 1 });
  });
});
