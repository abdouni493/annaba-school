import { describe, it, expect, beforeEach } from "vitest";
import { useData } from "@/lib/store/data";
import { buildSeed } from "@/tests/fixtures/seed";
import { teacherPerSeanceOf, todayIso } from "@/lib/helpers";

/**
 * Rémunération « par groupe ».
 *
 * Le tarif de l'enseignant n'est pas sur sa fiche : il est fixé emploi du temps
 * par emploi du temps, sur l'abonnement (prix du mois → part de l'école → le
 * reste pour l'enseignant ÷ séances du mois). Chaque présence lui rapporte
 * exactement ce tarif, quel que soit le nombre d'élèves ou le prix payé.
 *
 * Dans le seed, ses-1 / sub-1 vaut 600 DA la séance et reverse 250 DA à
 * l'enseignant ; tea-1 l'assure, au pourcentage (60 %). Sans le tarif du
 * groupe il toucherait donc 360 DA — c'est ce chiffre qui trahit une régression.
 */

const TEACHER = "tea-1";

/** Les dettes enseignant ouvertes sur un couple (emploi, élève). */
const duesOf = (sessionId: string, studentId: string) =>
  useData.getState().unpaidTeacher.filter((u) => u.sessionId === sessionId && u.studentId === studentId);

/** Bascule un enseignant sur la formule « par groupe » : plus aucun taux à lui. */
function makePerGroup(teacherId: string) {
  useData.setState((s) => ({
    teachers: s.teachers.map((t) =>
      t.id === teacherId
        ? { ...t, paymentType: "per_group" as const, percentage: undefined, monthlyAmount: undefined }
        : t,
    ),
  }));
}

/** Retire tout partage école / enseignant d'un abonnement : le groupe n'est plus tarifé. */
function stripTeacherShare(subscriptionId: string) {
  useData.setState((s) => ({
    subscriptions: s.subscriptions.map((sub) =>
      sub.id === subscriptionId
        ? {
            ...sub,
            monthlySeances: 0,
            monthlyPrice: undefined,
            schoolMonthShare: undefined,
            teacherPerSeance: undefined,
          }
        : sub,
    ),
  }));
}

beforeEach(() => {
  useData.setState(buildSeed());
});

describe("tarif porté par l'emploi du temps", () => {
  it("sub-1 reverse 250 DA par séance à l'enseignant", () => {
    const sub = useData.getState().subscriptions.find((s) => s.id === "sub-1");
    expect(teacherPerSeanceOf(sub)).toBe(250);
  });

  it("la feuille de présence paie le tarif du groupe, pas le pourcentage", async () => {
    const before = duesOf("ses-1", "stu-1").length;
    await useData
      .getState()
      .setPresence({ studentId: "stu-1", sessionId: "ses-1", date: "2026-08-10", status: "present" });

    const dues = duesOf("ses-1", "stu-1");
    expect(dues.length).toBe(before + 1);
    expect(dues.at(-1)!.amount).toBe(250); // et surtout pas 360
  });

  it("le pointage manuel paie lui aussi le tarif du groupe", async () => {
    // Même règle par l'autre porte d'entrée. `markAttendance` refuse un jour où
    // le créneau ne tourne pas : ses-1 tourne aujourd'hui, on pointe aujourd'hui.
    const before = duesOf("ses-1", "stu-1").length;
    const res = await useData
      .getState()
      .markAttendance("stu-1", "ses-1", "present", { date: todayIso() });

    expect(res.ok).toBe(true);
    const dues = duesOf("ses-1", "stu-1");
    expect(dues.length).toBe(before + 1);
    expect(dues.at(-1)!.amount).toBe(250);
  });
});

describe("enseignant payé par groupe", () => {
  it("touche le tarif de l'emploi du temps sur une présence", async () => {
    makePerGroup(TEACHER);
    await useData
      .getState()
      .setPresence({ studentId: "stu-1", sessionId: "ses-1", date: "2026-08-12", status: "present" });

    expect(duesOf("ses-1", "stu-1").at(-1)!.amount).toBe(250);
  });

  it("ne touche RIEN sur un emploi du temps dont l'abonnement n'a pas de part enseignant", async () => {
    makePerGroup(TEACHER);
    stripTeacherShare("sub-2"); // ses-2 n'est plus tarifé
    const before = duesOf("ses-2", "stu-3").length;

    await useData
      .getState()
      .setPresence({ studentId: "stu-3", sessionId: "ses-2", date: "2026-08-12", status: "present" });

    // Aucune dette enseignant n'est ouverte : le groupe n'est pas encore tarifé,
    // et sa fiche ne porte aucun taux de repli.
    expect(duesOf("ses-2", "stu-3").length).toBe(before);
  });

  it("là où un enseignant au pourcentage, lui, aurait été payé", async () => {
    // Même emploi non tarifé, mais tea-1 reste au pourcentage : sa fiche prend
    // le relais et il touche ses 60 % du prix réellement facturé à l'élève.
    stripTeacherShare("sub-2");
    const before = duesOf("ses-2", "stu-3").length;

    const res = await useData
      .getState()
      .setPresence({ studentId: "stu-3", sessionId: "ses-2", date: "2026-08-12", status: "present" });

    const dues = duesOf("ses-2", "stu-3");
    expect(dues.length).toBe(before + 1);
    expect(dues.at(-1)!.amount).toBe(Math.round((res.charged ?? 0) * 0.6));
    expect(dues.at(-1)!.amount).toBeGreaterThan(0);
  });

  it("garde son tarif quel que soit le prix payé par l'élève", async () => {
    makePerGroup(TEACHER);
    await useData
      .getState()
      .setPresence({ studentId: "stu-1", sessionId: "ses-1", date: "2026-08-13", status: "present" });

    // Le tarif ne dépend ni du prix de la séance ni du solde de l'élève : il est
    // fixé une fois pour toutes sur l'abonnement de l'emploi du temps.
    const sub = useData.getState().subscriptions.find((s) => s.id === "sub-1");
    expect(duesOf("ses-1", "stu-1").at(-1)!.amount).toBe(teacherPerSeanceOf(sub));
  });
});
