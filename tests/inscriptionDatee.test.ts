import { describe, it, expect, beforeEach } from "vitest";
import { useData } from "@/lib/store/data";
import { buildSeed } from "@/tests/fixtures/seed";
import {
  cycleLead,
  cycleOf,
  cycleSlots,
  enrolledInMonth,
  inscriptionMomentOf,
  joinPointFor,
  sessionMonthCodeOn,
  sessionSeanceDays,
  soldFor,
} from "@/lib/helpers";
import type { Student } from "@/lib/types";

/**
 * L'ÉLÈVE INSCRIT LE JOUR MÊME PREND LA SÉANCE DU JOUR.
 *
 * Le symptôme, relevé au comptoir : l'emploi du temps tourne le mardi, la
 * réception pointe le groupe le matin, puis crée un élève et l'inscrit dessus —
 * et la séance du jour lui était REFUSÉE. Le point d'entrée se lisait sur « le
 * mois que vit la majorité du groupe », or ce mois venait de basculer avec le
 * pointage du matin : le nouvel élève était poussé au mois suivant, et la
 * colonne du jour n'existait plus pour lui.
 *
 * La règle est désormais le CALENDRIER de l'emploi du temps : la séance tenue
 * ce jour-là est la n-ième depuis son ouverture, et c'est celle-là qu'il prend —
 * que le groupe ait déjà été pointé ou non.
 */

const SUB = "sub-1";
const SES = "ses-1";
const OLD = "stu-1";
const NEW = "stu-new";
const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** Un emploi du temps qui ne tourne QU'aujourd'hui — « Mardi 13:00 → 15:00 ». */
function board(monthSeances = 4) {
  const db = buildSeed();
  const sub = db.subscriptions.find((s) => s.id === SUB)!;
  sub.monthlySeances = monthSeances;
  sub.monthlyPrice = monthSeances * sub.pricePerSession;
  sub.schoolMonthShare = Math.round(sub.monthlyPrice / 2);
  sub.teacherPerSeance = Math.round(sub.monthlyPrice / 2 / monthSeances);
  db.sessions.find((s) => s.id === SES)!.days = [DAY_KEYS[new Date().getDay()] as never];
  db.attendance = [];
  db.payments = [];
  db.freePeriods = [];
  db.enrollments = db.enrollments.filter((e) => e.subscriptionId !== SUB);
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

/** Les `count` derniers jours de séance, aujourd'hui en dernier. */
function weeks(count: number): string[] {
  const out: string[] = [];
  const d = new Date();
  for (let i = 0; i < count; i++) {
    out.unshift(d.toLocaleDateString("fr-CA"));
    d.setDate(d.getDate() - 7);
  }
  return out;
}

const present = (studentId: string, date: string) =>
  useData.getState().setPresence({ studentId, sessionId: SES, date, status: "present" });

/** L'élève tel que la fiche de création l'écrit, au point d'entrée du jour. */
function register(day: string): Student {
  const point = joinPointFor(useData.getState(), SUB, day);
  const student: Student = {
    id: NEW,
    registrationNumber: "00099",
    firstName: "Nadir",
    lastName: "Zerrouki",
    birthDate: "",
    phone: "",
    email: "nadir@eleve.test",
    rfid: "RFID-NEW",
    isFree: false,
    subscriptionIds: [SUB],
    subscriptionDates: {
      [SUB]: {
        subscribedAt: day,
        subscribedTime: "14:05",
        startDate: day,
        joinMonthCode: point.monthCode,
        joinSlotIndex: point.slotIndex,
      },
    },
  };
  useData.setState({ students: [...useData.getState().students, student] });
  return student;
}

beforeEach(() => {
  useData.setState(buildSeed());
});

describe("inscrit le jour d'une séance, il prend CETTE séance", () => {
  it("le groupe déjà pointé ce matin ne pousse plus le nouvel élève au mois suivant", async () => {
    board(4);
    const days = weeks(4); // 3 mardis passés + aujourd'hui
    const today = days[3];
    for (const d of days) await present(OLD, d);

    // Le groupe a bouclé son mois AUJOURD'HUI : il vit désormais M2…
    expect(cycleOf(useData.getState(), OLD, SUB, "M1").complete).toBe(true);
    // …mais la séance du jour, elle, est bien la 4e de M1.
    expect(sessionMonthCodeOn(useData.getState(), SES, today)).toBe("M1");
    expect(joinPointFor(useData.getState(), SUB, today)).toEqual({
      monthCode: "M1",
      slotIndex: 3,
    });

    register(today);
    const db = useData.getState();
    // Il est bien sur la feuille du jour, avec la 4e case libre.
    expect(enrolledInMonth(db, NEW, SUB, "M1")).toBe(true);
    expect(cycleLead(db, NEW, SUB, "M1")).toBe(3);

    await present(NEW, today);
    const after = useData.getState();
    expect(cycleSlots(after, NEW, SUB, "M1")).toHaveLength(1);
    expect(cycleOf(after, NEW, SUB, "M1").done).toBe(1);
    expect(cycleOf(after, NEW, SUB, "M2").done).toBe(0);
  });

  it("pointer le groupe AVANT ou APRÈS l'inscription donne le même point d'entrée", async () => {
    board(4);
    const days = weeks(3);
    const today = days[2];
    for (const d of days.slice(0, 2)) await present(OLD, d);

    const before = joinPointFor(useData.getState(), SUB, today);
    await present(OLD, today);
    const after = joinPointFor(useData.getState(), SUB, today);

    expect(before).toEqual({ monthCode: "M1", slotIndex: 2 });
    expect(after).toEqual(before);
  });

  it("la feuille s'ouvre sur le mois de la séance affichée, pas sur celui du groupe", async () => {
    board(4);
    const days = weeks(5);
    for (const d of days.slice(0, 4)) await present(OLD, d);
    // 4 séances tenues : la 5e ouvre M2, et la 4e reste sur M1.
    expect(sessionMonthCodeOn(useData.getState(), SES, days[3])).toBe("M1");
    expect(sessionMonthCodeOn(useData.getState(), SES, days[4])).toBe("M2");
    expect(sessionSeanceDays(useData.getState(), SUB)).toEqual(days.slice(0, 4));
  });

  it("une séance ANNULÉE ne compte pas comme une séance de l'emploi", async () => {
    board(4);
    const days = weeks(3);
    await present(OLD, days[0]);
    await useData
      .getState()
      .setPresence({ studentId: OLD, sessionId: SES, date: days[1], status: "cancelled" });
    // Une seule séance a eu lieu : celle d'aujourd'hui est la deuxième.
    expect(joinPointFor(useData.getState(), SUB, days[2])).toEqual({
      monthCode: "M1",
      slotIndex: 1,
    });
  });
});

describe("corriger la date et l'heure d'une inscription", () => {
  it("l'heure est gardée sur la fiche, le jour décide de la séance", async () => {
    board(4);
    const days = weeks(3);
    for (const d of days.slice(0, 2)) await present(OLD, d);
    register(days[2]);
    expect(inscriptionMomentOf(useData.getState(), NEW, SUB)).toEqual({
      date: days[2],
      time: "14:05",
    });
  });

  it("reculer la date range l'élève entre les séances déjà tenues", async () => {
    board(4);
    const days = weeks(4);
    for (const d of days.slice(0, 3)) await present(OLD, d);
    register(days[3]); // inscrit aujourd'hui : M1 · séance 4
    expect(cycleLead(useData.getState(), NEW, SUB, "M1")).toBe(3);

    // En réalité il était là dès la 2e séance.
    const res = await useData.getState().setInscriptionMoment({
      studentId: NEW,
      subscriptionId: SUB,
      date: days[1],
      time: "08:30",
    });
    expect(res).toMatchObject({ ok: true, monthCode: "M1", slotIndex: 1 });

    const db = useData.getState();
    expect(cycleLead(db, NEW, SUB, "M1")).toBe(1);
    expect(inscriptionMomentOf(db, NEW, SUB)).toEqual({ date: days[1], time: "08:30" });
    expect(db.students.find((s) => s.id === NEW)!.subscriptionDates![SUB].startDate).toBe(days[1]);
  });

  it("ses présences suivent la nouvelle date : elles changent de mois avec lui", async () => {
    board(2); // un pack court : 2 séances par mois
    const days = weeks(4);
    for (const d of days) await present(OLD, d);
    register(days[3]); // M2 · séance 2
    await present(NEW, days[3]);
    expect(cycleOf(useData.getState(), NEW, SUB, "M2").done).toBe(1);
    expect(cycleOf(useData.getState(), NEW, SUB, "M1").done).toBe(0);

    // Redaté au tout début : la même présence tombe désormais sur M1.
    await useData
      .getState()
      .setInscriptionMoment({ studentId: NEW, subscriptionId: SUB, date: days[0] });
    expect(cycleOf(useData.getState(), NEW, SUB, "M1").done).toBe(1);
    expect(cycleLead(useData.getState(), NEW, SUB, "M1")).toBe(0);
  });

  it("refuse une date qui n'en est pas une", async () => {
    board(4);
    register(weeks(1)[0]);
    expect(
      await useData
        .getState()
        .setInscriptionMoment({ studentId: NEW, subscriptionId: SUB, date: "" }),
    ).toEqual({ ok: false });
  });
});

describe("le solde d'un emploi du temps dit la même chose que ses mois", () => {
  it("4 séances suivies puis réglées : le mois est clos ET l'emploi est soldé", async () => {
    const sub = board(4);
    const days = weeks(4);
    for (const d of days) await present(OLD, d);
    const owed = sub.pricePerSession * 4;

    const m1 = cycleOf(useData.getState(), OLD, SUB, "M1");
    expect(m1.consumed).toBe(owed);
    expect(m1.complete).toBe(true);
    expect(soldFor(useData.getState(), OLD, SUB)).toBe(-owed);

    await useData
      .getState()
      .addSold({ studentId: OLD, subscriptionId: SUB, amount: owed, monthCode: "M1" });

    const db = useData.getState();
    expect(cycleOf(db, OLD, SUB, "M1").balance).toBe(0);
    // Le solde de l'emploi ne réclame plus un argent déjà versé.
    expect(soldFor(db, OLD, SUB)).toBe(0);
  });

  it("un compteur `balance` qui a dérivé ne crée plus de dette imaginaire", async () => {
    const sub = board(4);
    const days = weeks(4);
    for (const d of days) await present(OLD, d);
    const owed = sub.pricePerSession * 4;
    await useData
      .getState()
      .addSold({ studentId: OLD, subscriptionId: SUB, amount: owed, monthCode: "M1" });

    // Le compteur stocké part à la dérive (écriture manquée, ligne écrite deux
    // fois…) : le grand livre, lui, ne bouge pas.
    useData.setState((state) => ({
      enrollments: state.enrollments.map((e) =>
        e.studentId === OLD && e.subscriptionId === SUB ? { ...e, balance: -owed } : e,
      ),
    }));

    const db = useData.getState();
    expect(soldFor(db, OLD, SUB)).toBe(0);
    expect(cycleOf(db, OLD, SUB, "M1").balance).toBe(0);
  });

  it("le solde de l'emploi est exactement la somme des « reste » de ses mois", async () => {
    const sub = board(2);
    const days = weeks(3);
    for (const d of days) await present(OLD, d);
    await useData.getState().addSold({
      studentId: OLD,
      subscriptionId: SUB,
      amount: sub.pricePerSession,
      monthCode: "M2",
    });

    const db = useData.getState();
    const ledger = [1, 2, 3].reduce((t, i) => t + cycleOf(db, OLD, SUB, `M${i}`).balance, 0);
    expect(soldFor(db, OLD, SUB)).toBe(ledger);
  });
});
