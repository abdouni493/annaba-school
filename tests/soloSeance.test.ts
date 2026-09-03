import { describe, it, expect, beforeEach } from "vitest";
import { useData } from "@/lib/store/data";
import { buildSeed } from "@/tests/fixtures/seed";
import {
  soloSeanceTotals,
  studentSoloSeances,
  unpaidSoloSeanceTotal,
  unpaidSoloSeances,
} from "@/lib/helpers";
import { payEmplois } from "@/lib/teacherPayBoard";
import type { SoloSeance } from "@/lib/types";

/**
 * LA SÉANCE LIBRE **SOLO** — des élèves nommés, hors de tout groupe.
 *
 * Elle se règle chez elle, et nulle part ailleurs :
 *  · l'argent des élèves entre en caisse à la création ;
 *  · la part de l'enseignant sort le jour où l'on dit qu'il l'a touchée ;
 *  · tant qu'il ne l'a pas touchée, la séance est en alerte ;
 *  · elle n'apparaît JAMAIS sur son écran de paie mensuelle.
 */

const TEACHER = "tea-1";
const STU = "stu-1";

const draft = (over: Partial<SoloSeance> = {}): SoloSeance => ({
  id: "sol-test",
  teacherId: TEACHER,
  salleId: undefined,
  title: "Rattrapage de maths",
  description: "Deux heures de révision",
  date: "2026-09-03",
  startTime: "08:00",
  endTime: "10:00",
  attendees: [{ studentId: STU, name: "Rania Bensalem" }, { name: "Un ami de passage" }],
  pricePerStudent: 1500,
  schoolPerStudent: 500,
  teacherPaid: false,
  createdAt: new Date().toISOString(),
  ...over,
});

describe("les séances libres solo", () => {
  beforeEach(() => {
    const db = buildSeed();
    db.soloSeances = [];
    useData.setState(db);
  });

  it("partage le prix entre l'école et l'enseignant, élève par élève", () => {
    const t = soloSeanceTotals(draft());
    expect(t.students).toBe(2);
    expect(t.teacherPerStudent).toBe(1000); // 1 500 − 500
    expect(t.total).toBe(3000);
    expect(t.schoolTotal).toBe(1000);
    expect(t.teacherTotal).toBe(2000);
  });

  it("ne compte pas une ligne vide comme un élève", () => {
    const t = soloSeanceTotals(draft({ attendees: [{ name: "  " }, { name: "Sami" }] }));
    expect(t.students).toBe(1);
    expect(t.total).toBe(1500);
  });

  it("encaisse les élèves sans payer l'enseignant tant qu'on ne l'a pas dit", async () => {
    await useData.getState().saveSoloSeance(draft());
    const db = useData.getState();
    const row = db.soloSeances.find((g) => g.id === "sol-test")!;

    expect(row.teacherPaid).toBe(false);
    expect(row.cashOutId).toBeUndefined();
    // L'entrée de caisse existe, la sortie non : c'est exactement ce que
    // l'alerte raconte.
    expect(db.cash.find((c) => c.id === row.cashInId)?.amount).toBe(3000);
    expect(db.cash.some((c) => c.type === "teacher_payment" && c.amount === -2000)).toBe(false);

    expect(unpaidSoloSeances(db, TEACHER)).toHaveLength(1);
    expect(unpaidSoloSeanceTotal(db, TEACHER)).toBe(2000);
  });

  it("écrit la sortie de caisse et éteint l'alerte quand il touche sa part", async () => {
    await useData.getState().saveSoloSeance(draft());
    const res = await useData.getState().setSoloSeanceTeacherPaid("sol-test", true);

    expect(res.ok).toBe(true);
    expect(res.amount).toBe(2000);
    const db = useData.getState();
    const row = db.soloSeances.find((g) => g.id === "sol-test")!;
    expect(row.teacherPaid).toBe(true);
    expect(row.teacherPaidAt).toBeTruthy();
    expect(db.cash.find((c) => c.id === row.cashOutId)?.amount).toBe(-2000);
    expect(unpaidSoloSeanceTotal(db)).toBe(0);
  });

  it("rend la part de nouveau due quand on annule le versement", async () => {
    await useData.getState().saveSoloSeance(draft({ teacherPaid: true }));
    expect(unpaidSoloSeanceTotal(useData.getState())).toBe(0);

    await useData.getState().setSoloSeanceTeacherPaid("sol-test", false);
    const db = useData.getState();
    expect(db.soloSeances.find((g) => g.id === "sol-test")!.cashOutId).toBeUndefined();
    expect(db.cash.some((c) => c.amount === -2000 && c.type === "teacher_payment")).toBe(false);
    expect(unpaidSoloSeanceTotal(db)).toBe(2000);
  });

  it("n'apparaît sur AUCUN mois de l'écran de paie de l'enseignant", async () => {
    await useData.getState().saveSoloSeance(draft());
    const db = useData.getState();
    const emplois = payEmplois(db, TEACHER);
    // Aucun emploi du temps ne porte cette séance : elle vit à part.
    for (const e of emplois) {
      for (const m of e.months) {
        expect(m.passagers.some((p) => p.id === "sol-test")).toBe(false);
      }
    }
  });

  it("suit l'élève inscrit dans son historique", async () => {
    await useData.getState().saveSoloSeance(draft());
    const rows = studentSoloSeances(useData.getState(), STU);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("Rattrapage de maths");
  });

  it("emporte ses mouvements de caisse quand on la supprime", async () => {
    await useData.getState().saveSoloSeance(draft({ teacherPaid: true }));
    const before = useData.getState().soloSeances.find((g) => g.id === "sol-test")!;
    await useData.getState().deleteSoloSeance("sol-test");

    const db = useData.getState();
    expect(db.soloSeances).toHaveLength(0);
    expect(db.cash.some((c) => c.id === before.cashInId || c.id === before.cashOutId)).toBe(false);
  });
});
