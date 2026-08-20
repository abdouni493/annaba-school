import { describe, it, expect, beforeEach } from "vitest";
import { useData } from "@/lib/store/data";
import { buildSeed } from "@/tests/fixtures/seed";
import { groupSeanceTotals, teacherGroupSeanceTotal } from "@/lib/helpers";
import type { GroupSeance } from "@/lib/types";

/**
 * La séance libre de GROUPE : une séance ponctuelle vendue à un groupe entier,
 * sans nommer un seul élève. Trois nombres suffisent — élèves, prix par élève,
 * part de l'école — et tout le reste se déduit.
 *
 * Elle écrit DEUX mouvements de caisse : la recette qui entre et la paie de
 * l'enseignant qui sort. La modifier réécrit ces deux-là, la supprimer les
 * emporte : la caisse, la fiche de l'enseignant et les rapports ne peuvent donc
 * pas diverger de ce que l'écran affiche.
 */

const TEACHER = "tea-1";

const draft = (over: Partial<GroupSeance> = {}): GroupSeance => ({
  id: "gsl-1",
  teacherId: TEACHER,
  title: "Révision générale",
  description: "3e AS",
  date: "2026-08-18",
  startTime: "08:00",
  endTime: "10:00",
  studentsCount: 25,
  pricePerStudent: 500,
  schoolPerStudent: 200,
  createdAt: "2026-08-18T08:00:00.000Z",
  ...over,
});

describe("le calcul d'une séance libre de groupe", () => {
  it("déduit la part de l'enseignant et les trois totaux", () => {
    const t = groupSeanceTotals({ studentsCount: 25, pricePerStudent: 500, schoolPerStudent: 200 });
    expect(t.teacherPerStudent).toBe(300);
    expect(t.total).toBe(12500);
    expect(t.schoolTotal).toBe(5000);
    expect(t.teacherTotal).toBe(7500);
    expect(t.schoolTotal + t.teacherTotal).toBe(t.total);
  });

  it("ne laisse jamais l'école prendre plus que le prix payé", () => {
    const t = groupSeanceTotals({ studentsCount: 10, pricePerStudent: 400, schoolPerStudent: 900 });
    expect(t.schoolPerStudent).toBe(400);
    expect(t.teacherPerStudent).toBe(0);
    expect(t.teacherTotal).toBe(0);
    expect(t.schoolTotal).toBe(4000);
  });

  it("traite les nombres vides comme des zéros", () => {
    const t = groupSeanceTotals({ studentsCount: 0, pricePerStudent: 0, schoolPerStudent: 0 });
    expect(t).toMatchObject({ total: 0, schoolTotal: 0, teacherTotal: 0 });
  });
});

describe("la séance libre de groupe et la caisse", () => {
  beforeEach(() => {
    useData.setState(buildSeed());
  });

  it("écrit la recette ET la paie de l'enseignant", async () => {
    const before = useData.getState().cash.length;
    const res = await useData.getState().saveGroupSeance(draft());
    expect(res.ok).toBe(true);

    const db = useData.getState();
    const row = db.groupSeances.find((g) => g.id === "gsl-1")!;
    expect(row.cashInId).toBeTruthy();
    expect(row.cashOutId).toBeTruthy();
    expect(db.cash).toHaveLength(before + 2);

    const cashIn = db.cash.find((c) => c.id === row.cashInId)!;
    const cashOut = db.cash.find((c) => c.id === row.cashOutId)!;
    expect(cashIn.amount).toBe(12500);
    expect(cashIn.type).toBe("student_payment");
    expect(cashOut.amount).toBe(-7500);
    expect(cashOut.type).toBe("teacher_payment");
  });

  it("apparaît dans ce que la séance a rapporté à l'enseignant", async () => {
    await useData.getState().saveGroupSeance(draft());
    await useData
      .getState()
      .saveGroupSeance(draft({ id: "gsl-2", studentsCount: 10, pricePerStudent: 1000, schoolPerStudent: 400 }));
    expect(teacherGroupSeanceTotal(useData.getState(), TEACHER)).toBe(7500 + 6000);
  });

  it("réécrit ses deux mouvements quand on la modifie, sans en créer d'autres", async () => {
    await useData.getState().saveGroupSeance(draft());
    const created = useData.getState().groupSeances.find((g) => g.id === "gsl-1")!;
    const cashCount = useData.getState().cash.length;

    await useData.getState().saveGroupSeance({ ...created, studentsCount: 30 });

    const db = useData.getState();
    expect(db.cash).toHaveLength(cashCount);
    expect(db.groupSeances).toHaveLength(1);
    const row = db.groupSeances[0];
    expect(row.cashInId).toBe(created.cashInId);
    expect(db.cash.find((c) => c.id === row.cashInId)!.amount).toBe(15000);
    expect(db.cash.find((c) => c.id === row.cashOutId)!.amount).toBe(-9000);
  });

  it("emporte ses deux mouvements quand on la supprime", async () => {
    const before = useData.getState().cash.length;
    await useData.getState().saveGroupSeance(draft());
    const row = useData.getState().groupSeances[0];

    await useData.getState().deleteGroupSeance(row.id);

    const db = useData.getState();
    expect(db.groupSeances).toHaveLength(0);
    expect(db.cash).toHaveLength(before);
    expect(db.cash.some((c) => c.id === row.cashInId || c.id === row.cashOutId)).toBe(false);
    expect(teacherGroupSeanceTotal(db, TEACHER)).toBe(0);
  });

  it("refuse un enseignant qui n'existe pas", async () => {
    const res = await useData.getState().saveGroupSeance(draft({ teacherId: "tea-inconnu" }));
    expect(res.ok).toBe(false);
    expect(useData.getState().groupSeances).toHaveLength(0);
  });

  it("ne sort rien de la caisse quand l'école garde tout", async () => {
    await useData.getState().saveGroupSeance(draft({ schoolPerStudent: 500 }));
    const db = useData.getState();
    const row = db.groupSeances[0];
    expect(db.cash.find((c) => c.id === row.cashInId)!.amount).toBe(12500);
    expect(db.cash.some((c) => c.id === row.cashOutId)).toBe(false);
  });
});
