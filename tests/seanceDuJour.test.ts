import { describe, it, expect, beforeEach } from "vitest";
import { useData } from "@/lib/store/data";
import { buildSeed } from "@/tests/fixtures/seed";
import {
  cycleLead,
  cycleOf,
  cycleSlots,
  dayKeyOf,
  enrolledInMonth,
  joinPointFor,
  sessionMonthCodeOn,
  sessionSeanceDays,
  soldFor,
} from "@/lib/helpers";
import type { Student } from "@/lib/types";

/**
 * LA SÉANCE DU JOUR EST À L'ÉLÈVE INSCRIT CE JOUR-LÀ — LE JOUR, JAMAIS L'HEURE.
 *
 * Le symptôme, relevé au comptoir : l'emploi du temps tourne le mardi de 8 h à
 * 10 h, la réception pointe le groupe le matin, puis crée un élève et l'inscrit
 * dessus — et la séance du jour lui était REFUSÉE. Le point d'entrée se lisait
 * sur « le mois que vit la majorité du groupe », or ce mois venait de basculer
 * avec le pointage du matin : le nouvel élève était poussé au mois suivant, et
 * la colonne du jour n'existait plus pour lui.
 *
 * La règle est le CALENDRIER de l'emploi du temps, à la JOURNÉE : la séance
 * tenue ce jour-là est la n-ième depuis son ouverture, et c'est celle-là qu'il
 * prend. Peu importe qu'il soit inscrit à 8 h 05 ou à 17 h : l'heure de saisie
 * n'entre nulle part dans le calcul, et la séance du jour tombe dans son
 * historique, sur le tableau de bord et dans la paie de l'enseignant.
 */

const SUB = "sub-1";
const SES = "ses-1";
const OLD = "stu-1";
const NEW = "stu-new";
const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** Un emploi du temps qui ne tourne QU'aujourd'hui, de 8 h à 10 h. */
function board(monthSeances = 4) {
  const db = buildSeed();
  const sub = db.subscriptions.find((s) => s.id === SUB)!;
  sub.monthlySeances = monthSeances;
  sub.monthlyPrice = monthSeances * sub.pricePerSession;
  sub.schoolMonthShare = Math.round(sub.monthlyPrice / 2);
  sub.teacherPerSeance = Math.round(sub.monthlyPrice / 2 / monthSeances);
  const session = db.sessions.find((s) => s.id === SES)!;
  session.days = [DAY_KEYS[new Date().getDay()] as never];
  session.startTime = "08:00";
  session.endTime = "10:00";
  session.dayTimes = undefined;
  db.attendance = [];
  db.payments = [];
  db.unpaidTeacher = [];
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

const today = () => new Date().toLocaleDateString("fr-CA");

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
    const days = weeks(4); // 3 séances passées + celle d'aujourd'hui
    const day = days[3];
    for (const d of days) await present(OLD, d);

    // Le groupe a bouclé son mois AUJOURD'HUI : il vit désormais M2…
    expect(cycleOf(useData.getState(), OLD, SUB, "M1").complete).toBe(true);
    // …mais la séance du jour, elle, est bien la 4e de M1.
    expect(sessionMonthCodeOn(useData.getState(), SES, day)).toBe("M1");
    expect(joinPointFor(useData.getState(), SUB, day)).toEqual({
      monthCode: "M1",
      slotIndex: 3,
    });

    register(day);
    const db = useData.getState();
    // Il est bien sur la feuille du jour, avec la 4e case libre.
    expect(enrolledInMonth(db, NEW, SUB, "M1")).toBe(true);
    expect(cycleLead(db, NEW, SUB, "M1")).toBe(3);

    await present(NEW, day);
    const after = useData.getState();
    expect(cycleSlots(after, NEW, SUB, "M1")).toHaveLength(1);
    expect(cycleOf(after, NEW, SUB, "M1").done).toBe(1);
    expect(cycleOf(after, NEW, SUB, "M2").done).toBe(0);
  });

  it("pointer le groupe AVANT ou APRÈS l'inscription donne le même point d'entrée", async () => {
    board(4);
    const days = weeks(3);
    const day = days[2];
    for (const d of days.slice(0, 2)) await present(OLD, d);

    const before = joinPointFor(useData.getState(), SUB, day);
    await present(OLD, day);
    const after = joinPointFor(useData.getState(), SUB, day);

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

describe("le JOUR compte, jamais l'heure de la séance", () => {
  it("inscrit après la sonnerie, il suit quand même la séance du jour", async () => {
    const sub = board(4);
    const days = weeks(2);
    const day = days[1];
    // L'emploi tournait de 8 h à 10 h et le groupe a été pointé ce matin-là.
    await present(OLD, days[0]);
    await present(OLD, day);
    expect(useData.getState().sessions.find((s) => s.id === SES)!.endTime).toBe("10:00");

    // La fiche est créée bien après 10 h : rien, dans le calcul, ne lit l'heure.
    register(day);
    expect(cycleLead(useData.getState(), NEW, SUB, "M1")).toBe(1);

    const res = await present(NEW, day);
    expect(res.ok).toBe(true);
    expect(res.charged).toBe(sub.pricePerSession);

    const db = useData.getState();
    // Son historique porte la séance, datée du JOUR de la séance.
    const rows = db.attendance.filter((a) => a.studentId === NEW && a.sessionId === SES);
    expect(rows).toHaveLength(1);
    expect(dayKeyOf(rows[0].timestamp)).toBe(day);
    // Elle compte dans son mois, et son solde la lui a bien facturée.
    expect(cycleOf(db, NEW, SUB, "M1").done).toBe(1);
    expect(soldFor(db, NEW, SUB)).toBe(-sub.pricePerSession);
    // Et la part de l'enseignant est due dessus, comme pour n'importe qui.
    const due = db.unpaidTeacher.filter((u) => u.studentId === NEW && u.sessionId === SES);
    expect(due).toHaveLength(1);
    expect(due[0].amount).toBeGreaterThan(0);
    expect(dayKeyOf(due[0].date)).toBe(day);
  });

  it("changer les horaires de l'emploi ne déplace aucun point d'entrée", async () => {
    board(4);
    const days = weeks(3);
    for (const d of days.slice(0, 2)) await present(OLD, d);
    const before = joinPointFor(useData.getState(), SUB, days[2]);

    useData.setState((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === SES ? { ...s, startTime: "18:00", endTime: "20:00" } : s,
      ),
    }));

    expect(joinPointFor(useData.getState(), SUB, days[2])).toEqual(before);
    expect(sessionMonthCodeOn(useData.getState(), SES, days[2])).toBe("M1");
  });

  it("l'inscription du jour retient le JOUR, et lui seul", async () => {
    board(4);
    register(today());
    const dates = useData.getState().students.find((s) => s.id === NEW)!.subscriptionDates![SUB];
    expect(dates.subscribedAt).toBe(today());
    expect(dates.startDate).toBe(today());
    expect(Object.keys(dates).sort()).toEqual(
      ["joinMonthCode", "joinSlotIndex", "startDate", "subscribedAt"].sort(),
    );
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

describe("ajouté en cours de route, il démarre à la séance OÙ EN EST le groupe", () => {
  it("un pointage isolé un autre jour ne pousse pas le nouvel élève à la séance suivante", async () => {
    board(4);
    const days = weeks(3); // séances 1, 2 et 3 — la 3e aujourd'hui
    for (const d of days) await present(OLD, d);
    // Une ligne parasite, un jour sans séance pour le groupe : un élève
    // d'un autre groupe venu en remplacement.
    const stray = new Date();
    stray.setDate(stray.getDate() - 3);
    useData.setState({
      attendance: [
        ...useData.getState().attendance,
        {
          id: "att-stray",
          studentId: "stu-2",
          sessionId: SES,
          timestamp: stray.toISOString(),
          amountDeducted: 0,
          status: "present",
          substituteGroup: true,
        } as never,
      ],
    });
    expect(sessionSeanceDays(useData.getState(), SUB)).toHaveLength(4);

    // Le groupe est à la séance 3 : le nouvel élève prend la séance 3.
    expect(joinPointFor(useData.getState(), SUB, today())).toEqual({
      monthCode: "M1",
      slotIndex: 2,
    });
    register(today());
    await present(NEW, today());
    expect(cycleLead(useData.getState(), NEW, SUB, "M1")).toBe(2);
    expect(cycleSlots(useData.getState(), NEW, SUB, "M1")).toHaveLength(1);
  });
});
