import { describe, it, expect, beforeEach } from "vitest";
import { toggleTimingSelection } from "@/components/students/ClassTimingPicker";
import { useData } from "@/lib/store/data";
import { buildSeed } from "@/lib/store/seed";
import {
  attendedSeances,
  courseKeyOf,
  remainingSeances,
  studentDebt,
  totalRemainingSeances,
} from "@/lib/helpers";

/**
 * The inscription screens (creation and "Inscriptions") both run on the class
 * picker: search a class, open it, tick its timings. These cover the rules the
 * picker enforces and the figures the student cards print.
 */

beforeEach(() => {
  useData.setState(buildSeed());
});

/** In the demo data ses-1 and ses-2 are the SAME cours (3ème AS · Maths ·
 *  Karim) taught to two groups; ses-3 is another cours of the same class. */
const mathsGroupA = { subId: "sub-1", siblingSubIds: ["sub-1", "sub-2"] };
const mathsGroupB = { subId: "sub-2", siblingSubIds: ["sub-1", "sub-2"] };
const physique = { subId: "sub-3", siblingSubIds: ["sub-3"] };

describe("cocher des créneaux — plusieurs inscriptions, un seul groupe par cours", () => {
  it("des créneaux de cours différents s'ajoutent les uns aux autres", () => {
    let selection: string[] = [];
    selection = toggleTimingSelection(selection, mathsGroupA);
    selection = toggleTimingSelection(selection, physique);
    expect(selection).toEqual(["sub-1", "sub-3"]);
  });

  it("cocher un autre groupe du même cours DÉPLACE l'élève au lieu de le facturer deux fois", () => {
    let selection = toggleTimingSelection([], mathsGroupA);
    selection = toggleTimingSelection(selection, mathsGroupB);
    expect(selection).toEqual(["sub-2"]);
  });

  it("le déplacement de groupe ne touche pas aux autres inscriptions", () => {
    let selection = toggleTimingSelection(["sub-3"], mathsGroupA);
    selection = toggleTimingSelection(selection, mathsGroupB);
    expect(selection).toEqual(["sub-3", "sub-2"]);
  });

  it("recocher le créneau suivi le retire", () => {
    const selection = toggleTimingSelection(["sub-3", "sub-1"], mathsGroupA);
    expect(selection).toEqual(["sub-3"]);
  });

  it("les groupes d'un même cours partagent bien leur identité de cours", () => {
    const db = useData.getState();
    const ses = (id: string) => db.sessions.find((s) => s.id === id)!;
    expect(courseKeyOf(ses("ses-1"))).toBe(courseKeyOf(ses("ses-2")));
    expect(courseKeyOf(ses("ses-1"))).not.toBe(courseKeyOf(ses("ses-3")));
    // Une séance libre est un produit à part : elle ne fusionne avec rien.
    expect(courseKeyOf(ses("ses-6"))).toBe("open-ses-6");
  });
});

describe("chiffres affichés sur la carte élève", () => {
  it("les présences comptent les séances suivies, jamais les absences", () => {
    const db = useData.getState();
    const stu = db.students[0];
    const before = attendedSeances(db, stu.id);

    useData.setState((s) => ({
      attendance: [
        ...s.attendance,
        {
          id: "att-present",
          studentId: stu.id,
          sessionId: "ses-1",
          timestamp: new Date().toISOString(),
          amountDeducted: 600,
          status: "present" as const,
        },
        {
          id: "att-late",
          studentId: stu.id,
          sessionId: "ses-2",
          timestamp: new Date().toISOString(),
          amountDeducted: 600,
          status: "late" as const,
        },
        {
          id: "att-absent",
          studentId: stu.id,
          sessionId: "ses-3",
          timestamp: new Date().toISOString(),
          amountDeducted: 0,
          status: "absent" as const,
        },
      ],
    }));

    // Le retard est une présence, l'absence n'en est pas une.
    expect(attendedSeances(useData.getState(), stu.id)).toBe(before + 2);
  });

  it("les présences sont comptées élève par élève", () => {
    const db = useData.getState();
    // Chaque compteur ne retient que les lignes de SON élève…
    for (const stu of db.students) {
      expect(attendedSeances(db, stu.id)).toBe(
        db.attendance.filter((a) => a.studentId === stu.id && a.status !== "absent").length,
      );
    }
    // …et la somme des compteurs couvre toutes les présences de l'école.
    expect(db.students.reduce((n, s) => n + attendedSeances(db, s.id), 0)).toBe(
      db.attendance.filter((a) => a.status !== "absent").length,
    );
  });

  it("la dette affichée est la somme des restes impayés", async () => {
    const db = useData.getState();
    const stu = db.students[0];
    const before = studentDebt(db, stu.id);

    await useData.getState().createEnrollmentPayment({
      studentId: stu.id,
      subscriptionId: "sub-1",
      seances: 2,
      plan: "seance",
      amountPaid: 200, // 2 × 600 = 1200 dus, 200 versés
      description: "Paiement partiel",
    });

    expect(studentDebt(useData.getState(), stu.id)).toBe(before + 1000);
  });
});

describe("renouvellement — ce que la fenêtre séances / mois donne à voir", () => {
  it("à la séance, payer recharge le compteur existant sans toucher au consommé", async () => {
    const db = useData.getState();
    const stu = db.students[0];
    const enrollmentOf = () =>
      useData
        .getState()
        .enrollments.find((e) => e.studentId === stu.id && e.subscriptionId === "sub-3");
    const before = enrollmentOf();
    const paidBefore = before?.paidSeances ?? 0;
    const consumedBefore = before?.consumedSeances ?? 0;
    const leftBefore = before ? remainingSeances(before) : 0;

    await useData.getState().createEnrollmentPayment({
      studentId: stu.id,
      subscriptionId: "sub-3",
      seances: 5,
      plan: "seance",
      amountPaid: 3500,
      description: "Recharge",
    });

    const after = enrollmentOf()!;
    expect(after.paidSeances).toBe(paidBefore + 5);
    expect(after.consumedSeances).toBe(consumedBefore);
    // Les 5 séances achetées viennent s'ajouter à ce qui restait.
    expect(remainingSeances(after)).toBe(leftBefore + 5);
    expect(totalRemainingSeances(useData.getState(), stu.id)).toBeGreaterThanOrEqual(
      remainingSeances(after),
    );
  });

  it("renouveler un mois repart du pack complet, sans reporter l'ancien", async () => {
    const db = useData.getState();
    const stu = db.students[0];
    const tariff = db.subscriptions.find((s) => s.id === "sub-1")!;

    // Premier mois, à moitié consommé.
    await useData.getState().createEnrollmentPayment({
      studentId: stu.id,
      subscriptionId: "sub-1",
      seances: 0,
      plan: "month",
      monthSeances: tariff.monthlySeances,
      packagePrice: tariff.monthlyPrice,
      amountPaid: tariff.monthlyPrice ?? 0,
      description: "Mois 1",
    });
    useData.setState((s) => ({
      enrollments: s.enrollments.map((e) =>
        e.studentId === stu.id && e.subscriptionId === "sub-1"
          ? { ...e, consumedSeances: 4 }
          : e,
      ),
    }));

    // Renouvellement : le compteur repart à 8, les 4 non utilisées sont perdues.
    await useData.getState().createEnrollmentPayment({
      studentId: stu.id,
      subscriptionId: "sub-1",
      seances: 0,
      plan: "month",
      monthSeances: tariff.monthlySeances,
      packagePrice: tariff.monthlyPrice,
      amountPaid: tariff.monthlyPrice ?? 0,
      description: "Mois 2",
    });

    const enrollment = useData
      .getState()
      .enrollments.find((e) => e.studentId === stu.id && e.subscriptionId === "sub-1")!;
    expect(enrollment.paidSeances).toBe(8);
    expect(enrollment.consumedSeances).toBe(0);
    expect(remainingSeances(enrollment)).toBe(8);
  });
});
