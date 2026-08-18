import { describe, it, expect, beforeEach } from "vitest";
import { useData } from "@/lib/store/data";
import { buildSeed } from "@/tests/fixtures/seed";
import {
  currentCycleCode,
  cycleOf,
  cycleSizeOf,
  enrollmentCycles,
  monthCodeLabel,
  monthOrder,
  registrationNumberOf,
  soldFor,
  soldStatus,
  studentMatches,
  studentSoldDebt,
} from "@/lib/helpers";

/**
 * Months are no longer calendar months. Each emploi du temps counts its OWN:
 * M1 opens on the student's first présence on it and closes on the séance that
 * completes the pack; the next présence opens M2. These tests drive the very
 * store action the présence sheet calls, one click at a time.
 */

const SUB = "sub-1"; // Maths · Groupe A — 8 séances / mois, 600 DA la séance
const STU = "stu-1";

/** A clean store with ONE student on ONE emploi, nothing attended yet. */
function freshBoard(monthSeances = 4) {
  const db = buildSeed();
  const sub = db.subscriptions.find((s) => s.id === SUB)!;
  sub.monthlySeances = monthSeances;
  sub.monthlyPrice = monthSeances * sub.pricePerSession;
  sub.schoolMonthShare = Math.round(sub.monthlyPrice / 2);
  sub.teacherPerSeance = Math.round(sub.monthlyPrice / 2 / monthSeances);
  db.attendance = [];
  db.payments = [];
  db.enrollments = db.enrollments.filter((e) => e.subscriptionId !== SUB);
  // Billing must be open on every day the tests point on, and no "période
  // gratuite" may be offering the séances away underneath them.
  db.freePeriods = [];
  const opened = new Date();
  opened.setDate(opened.getDate() - 400);
  const student = db.students.find((st) => st.id === STU)!;
  student.subscriptionDates = {
    ...student.subscriptionDates,
    [SUB]: { subscribedAt: opened.toLocaleDateString("fr-CA"), startDate: opened.toLocaleDateString("fr-CA") },
  };
  useData.setState(db);
  return sub;
}

/** The weekday key of a YYYY-MM-DD day, as the sessions store them. */
const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** N consecutive days the emploi is actually scheduled on, oldest first. */
function scheduledDays(count: number): string[] {
  const session = useData.getState().sessions.find((s) => s.id === "ses-1")!;
  const out: string[] = [];
  const d = new Date();
  d.setDate(d.getDate() - 120);
  while (out.length < count) {
    if (session.days.includes(DAY_KEYS[d.getDay()] as never)) out.push(d.toLocaleDateString("fr-CA"));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

beforeEach(() => {
  useData.setState(buildSeed());
});

describe("les mois appartiennent à l'emploi du temps, pas au calendrier", () => {
  it("M1 ne s'ouvre qu'à la PREMIÈRE présence, quelle que soit la date de création", async () => {
    freshBoard(4);
    expect(currentCycleCode(useData.getState(), STU, SUB)).toBe("M1");
    expect(cycleOf(useData.getState(), STU, SUB, "M1").done).toBe(0);
    expect(cycleOf(useData.getState(), STU, SUB, "M1").startDate).toBeUndefined();

    const [day] = scheduledDays(1);
    await useData.getState().setPresence({ studentId: STU, sessionId: "ses-1", date: day, status: "present" });

    const m1 = cycleOf(useData.getState(), STU, SUB, "M1");
    expect(m1.done).toBe(1);
    expect(m1.startDate).toBe(day);
    expect(currentCycleCode(useData.getState(), STU, SUB)).toBe("M1");
  });

  it("la 4e séance d'un pack de 4 clôt M1 et ouvre M2", async () => {
    freshBoard(4);
    const days = scheduledDays(5);

    for (const day of days.slice(0, 3)) {
      await useData.getState().setPresence({ studentId: STU, sessionId: "ses-1", date: day, status: "present" });
    }
    expect(currentCycleCode(useData.getState(), STU, SUB)).toBe("M1");
    expect(cycleOf(useData.getState(), STU, SUB, "M1").complete).toBe(false);

    await useData.getState().setPresence({ studentId: STU, sessionId: "ses-1", date: days[3], status: "present" });

    const m1 = cycleOf(useData.getState(), STU, SUB, "M1");
    expect(m1.done).toBe(4);
    expect(m1.complete).toBe(true);
    expect(m1.endDate).toBe(days[3]);
    // The month is closed: the next présence already belongs to M2.
    expect(currentCycleCode(useData.getState(), STU, SUB)).toBe("M2");

    await useData.getState().setPresence({ studentId: STU, sessionId: "ses-1", date: days[4], status: "present" });
    expect(cycleOf(useData.getState(), STU, SUB, "M2").done).toBe(1);
    expect(enrollmentCycles(useData.getState(), STU, SUB)).toHaveLength(2);
  });

  it("un pack de 8 séances tient 8 présences avant de passer à M2", async () => {
    const sub = freshBoard(8);
    expect(cycleSizeOf(sub)).toBe(8);
    for (const day of scheduledDays(8)) {
      await useData.getState().setPresence({ studentId: STU, sessionId: "ses-1", date: day, status: "present" });
    }
    expect(currentCycleCode(useData.getState(), STU, SUB)).toBe("M2");
  });
});

describe("le solde : de l'argent, débité séance par séance", () => {
  it("un versement crédite le solde du mois en cours, une présence le débite", async () => {
    const sub = freshBoard(4);
    await useData.getState().addSold({ studentId: STU, subscriptionId: SUB, amount: 2400 });
    expect(soldFor(useData.getState(), STU, SUB)).toBe(2400);
    expect(cycleOf(useData.getState(), STU, SUB, "M1").credited).toBe(2400);

    const [day] = scheduledDays(1);
    await useData.getState().setPresence({ studentId: STU, sessionId: "ses-1", date: day, status: "present" });

    expect(soldFor(useData.getState(), STU, SUB)).toBe(2400 - sub.pricePerSession);
    expect(cycleOf(useData.getState(), STU, SUB, "M1").consumed).toBe(sub.pricePerSession);
  });

  it("le solde passe en négatif : c'est exactement la dette de l'élève", async () => {
    const sub = freshBoard(4);
    await useData.getState().addSold({ studentId: STU, subscriptionId: SUB, amount: sub.pricePerSession });

    const days = scheduledDays(3);
    for (const day of days) {
      await useData.getState().setPresence({ studentId: STU, sessionId: "ses-1", date: day, status: "present" });
    }
    expect(soldFor(useData.getState(), STU, SUB)).toBe(-2 * sub.pricePerSession);
    expect(studentSoldDebt(useData.getState(), STU)).toBeGreaterThanOrEqual(2 * sub.pricePerSession);
    expect(soldStatus(soldFor(useData.getState(), STU, SUB), sub.pricePerSession)).toBe("debt");
  });

  it("une absence coûte une séance — sauf la toute première sur cet emploi", async () => {
    const sub = freshBoard(4);
    await useData.getState().addSold({ studentId: STU, subscriptionId: SUB, amount: 2400 });
    const days = scheduledDays(3);

    // He has never attended: his month has not started, the absence is free.
    await useData.getState().setPresence({ studentId: STU, sessionId: "ses-1", date: days[0], status: "absent" });
    expect(soldFor(useData.getState(), STU, SUB)).toBe(2400);
    expect(cycleOf(useData.getState(), STU, SUB, "M1").done).toBe(0);

    await useData.getState().setPresence({ studentId: STU, sessionId: "ses-1", date: days[1], status: "present" });
    // Now that he is a going student, an absence is billed like a séance.
    await useData.getState().setPresence({ studentId: STU, sessionId: "ses-1", date: days[2], status: "absent" });
    expect(soldFor(useData.getState(), STU, SUB)).toBe(2400 - 2 * sub.pricePerSession);
    expect(cycleOf(useData.getState(), STU, SUB, "M1").done).toBe(2);
  });

  it("une séance annulée ne coûte rien et ne fait pas avancer le mois", async () => {
    freshBoard(4);
    await useData.getState().addSold({ studentId: STU, subscriptionId: SUB, amount: 2400 });
    const days = scheduledDays(2);

    await useData.getState().setPresence({ studentId: STU, sessionId: "ses-1", date: days[0], status: "present" });
    await useData.getState().setPresence({ studentId: STU, sessionId: "ses-1", date: days[1], status: "cancelled" });

    expect(cycleOf(useData.getState(), STU, SUB, "M1").done).toBe(1);
    expect(soldFor(useData.getState(), STU, SUB)).toBe(2400 - 600);
  });

  it("« Retour » annule un pointage et rend l'argent", async () => {
    const sub = freshBoard(4);
    await useData.getState().addSold({ studentId: STU, subscriptionId: SUB, amount: 2400 });
    const [day] = scheduledDays(1);

    await useData.getState().setPresence({ studentId: STU, sessionId: "ses-1", date: day, status: "present" });
    expect(soldFor(useData.getState(), STU, SUB)).toBe(2400 - sub.pricePerSession);

    const res = await useData.getState().setPresence({ studentId: STU, sessionId: "ses-1", date: day, status: null });
    expect(res.ok).toBe(true);
    expect(res.refunded).toBe(sub.pricePerSession);
    expect(soldFor(useData.getState(), STU, SUB)).toBe(2400);
    expect(cycleOf(useData.getState(), STU, SUB, "M1").done).toBe(0);
  });

  it("corriger présent -> annulée rend la séance et l'argent en un seul clic", async () => {
    const sub = freshBoard(4);
    await useData.getState().addSold({ studentId: STU, subscriptionId: SUB, amount: 2400 });
    const days = scheduledDays(2);
    await useData.getState().setPresence({ studentId: STU, sessionId: "ses-1", date: days[0], status: "present" });
    await useData.getState().setPresence({ studentId: STU, sessionId: "ses-1", date: days[1], status: "present" });
    expect(soldFor(useData.getState(), STU, SUB)).toBe(2400 - 2 * sub.pricePerSession);

    await useData.getState().setPresence({ studentId: STU, sessionId: "ses-1", date: days[1], status: "cancelled" });
    expect(soldFor(useData.getState(), STU, SUB)).toBe(2400 - sub.pricePerSession);
    expect(cycleOf(useData.getState(), STU, SUB, "M1").done).toBe(1);
  });

  it("un versement peut viser un mois passé : il éponge la dette de CE mois", async () => {
    const sub = freshBoard(2);
    const days = scheduledDays(3);
    for (const day of days) {
      await useData.getState().setPresence({ studentId: STU, sessionId: "ses-1", date: day, status: "present" });
    }
    // M1 (2 séances) est en dette, M2 en cours avec une séance.
    expect(cycleOf(useData.getState(), STU, SUB, "M1").balance).toBe(-2 * sub.pricePerSession);

    await useData
      .getState()
      .addSold({ studentId: STU, subscriptionId: SUB, amount: 2 * sub.pricePerSession, monthCode: "M1" });

    expect(cycleOf(useData.getState(), STU, SUB, "M1").balance).toBe(0);
    expect(cycleOf(useData.getState(), STU, SUB, "M2").balance).toBe(-sub.pricePerSession);
  });
});

describe("numéros d'inscription", () => {
  it("chaque élève porte un numéro sur 5 chiffres, à partir de 00001", () => {
    const db = useData.getState();
    expect(registrationNumberOf(db, db.students[0])).toBe("00001");
    expect(registrationNumberOf(db, db.students[1])).toBe("00002");
  });

  it("la recherche accepte le numéro, avec ou sans ses zéros", () => {
    const db = useData.getState();
    const first = db.students[0];
    expect(studentMatches(db, first, "00001")).toBe(true);
    expect(studentMatches(db, first, "1")).toBe(true);
    expect(studentMatches(db, first, first.firstName.toLowerCase())).toBe(true);
    expect(studentMatches(db, first, "zzzz")).toBe(false);
  });
});

describe("codes de mois", () => {
  it("M1 est le premier mois, l'ordre suit le numéro", () => {
    expect(monthOrder("M1")).toBe(0);
    expect(monthOrder("M12")).toBe(11);
    expect(monthOrder("septembre")).toBe(-1);
  });

  it("le libellé ne parle plus de septembre", () => {
    expect(monthCodeLabel("M1")).toBe("M1 · Mois 1");
    expect(monthCodeLabel("M3")).not.toMatch(/Novembre/);
  });
});

describe("un élève sans le moindre versement", () => {
  it("est pointé quand même, et son solde plonge dans le rouge", async () => {
    const sub = freshBoard(4);
    // No addSold at all: he was created without paying anything.
    expect(soldFor(useData.getState(), STU, SUB)).toBe(0);

    const days = scheduledDays(2);
    for (const day of days) {
      await useData.getState().setPresence({ studentId: STU, sessionId: "ses-1", date: day, status: "present" });
    }

    expect(soldFor(useData.getState(), STU, SUB)).toBe(-2 * sub.pricePerSession);
    expect(cycleOf(useData.getState(), STU, SUB, "M1").done).toBe(2);
    expect(studentSoldDebt(useData.getState(), STU)).toBeGreaterThanOrEqual(2 * sub.pricePerSession);
  });
});

describe("le badge RFID et la feuille de présence parlent du même argent", () => {
  it("un scan débite le solde comme un clic, et l'annuler le rend", async () => {
    const sub = freshBoard(4);
    await useData.getState().addSold({ studentId: STU, subscriptionId: SUB, amount: 2400 });

    // Scanning is only accepted inside the séance's own window, so the test
    // drives the store at the exact hour ses-1 runs today.
    const session = useData.getState().sessions.find((s) => s.id === "ses-1")!;
    const now = new Date();
    if (!session.days.includes(DAY_KEYS[now.getDay()] as never)) return; // pas programmé aujourd'hui
    const [h, m] = session.startTime.split(":").map(Number);
    now.setHours(h, m + 5, 0, 0);

    const student = useData.getState().students.find((s) => s.id === STU)!;
    const res = await useData.getState().scanCard(student.rfid, now);
    expect(res.ok).toBe(true);
    expect(soldFor(useData.getState(), STU, SUB)).toBe(2400 - sub.pricePerSession);

    const att = useData.getState().attendance.find((a) => a.studentId === STU)!;
    await useData.getState().cancelAttendance(att.id);
    expect(soldFor(useData.getState(), STU, SUB)).toBe(2400);
  });
});
