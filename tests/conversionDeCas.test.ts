import { describe, it, expect, beforeEach } from "vitest";
import { useData } from "@/lib/store/data";
import { buildSeed } from "@/tests/fixtures/seed";
import {
  schoolMonthShareOf,
  schoolPerSeanceOf,
  soldFor,
  studentDebtSummary,
} from "@/lib/helpers";
import type { CaseReduction, StudentCase } from "@/lib/types";

/**
 * BASCULER UN ÉLÈVE D'UN CAS À UN AUTRE, SANS MENTIR SUR SES DETTES.
 *
 * Un élève ordinaire qui devient « gratuit », « école seulement » ou « réduit »
 * traîne ce qu'il devait AU TARIF D'AVANT. L'école doit trancher — et c'est
 * elle qui tranche, jamais l'application :
 *
 *  - GARDER : ses dettes restent dues au tarif d'avant ;
 *  - RECALCULER : ses séances non encore réglées sont re-tarifées au nouveau
 *    cas, et la part due à son enseignant suit ;
 *  - EFFACER : il n'aura rien à payer — ses séances impayées passent en
 *    offertes, les restes d'anciens versements et les frais d'inscription
 *    tombent à zéro, et ce qu'il a déjà versé lui reste acquis.
 */
const SES = "ses-1";
const SUB = "sub-1";
const STU = "stu-1";
const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function board() {
  const db = buildSeed();
  db.attendance = [];
  db.payments = [];
  db.unpaidTeacher = [];
  db.freePeriods = [];
  const opened = new Date();
  opened.setDate(opened.getDate() - 400);
  const openedIso = opened.toLocaleDateString("fr-CA");
  db.students = db.students.map((st) =>
    st.id === STU
      ? {
          ...st,
          isFree: false,
          studentCase: "normal" as const,
          registrationDue: 1500,
          subscriptionIds: st.subscriptionIds.includes(SUB)
            ? st.subscriptionIds
            : [...st.subscriptionIds, SUB],
          subscriptionDates: {
            ...st.subscriptionDates,
            [SUB]: { subscribedAt: openedIso, startDate: openedIso },
          },
        }
      : st,
  );
  db.enrollments = db.enrollments.map((e) =>
    e.studentId === STU && e.subscriptionId === SUB
      ? { ...e, balance: 0, consumedSeances: 0 }
      : e,
  );
  useData.setState(db);
}

/** Pointe `count` présences sans jamais rien verser : l'élève part en dette. */
async function attend(count: number, back = 60) {
  const session = useData.getState().sessions.find((s) => s.id === SES)!;
  const d = new Date();
  d.setDate(d.getDate() - back);
  let done = 0;
  while (done < count) {
    if (session.days.includes(DAY_KEYS[d.getDay()] as never)) {
      await useData.getState().setPresence({
        studentId: STU,
        sessionId: SES,
        date: d.toLocaleDateString("fr-CA"),
        status: "present",
      });
      done += 1;
    }
    d.setDate(d.getDate() + 1);
  }
}

/** Écrit le nouveau cas sur la fiche, comme l'écran de modification le fait. */
function setCase(studentCase: StudentCase, extra: Record<string, unknown> = {}) {
  useData.getState().updateItem("students", STU, {
    studentCase,
    isFree: studentCase === "special",
    ...extra,
  });
}

describe("les dettes du cas précédent", () => {
  beforeEach(board);

  it("restent dues quand l'école choisit de les garder", async () => {
    await attend(3);
    const before = studentDebtSummary(useData.getState(), STU).total;
    setCase("special", { freeSubscriptionIds: [SUB] });
    await useData.getState().convertStudentCase({ studentId: STU, mode: "keep" });
    expect(studentDebtSummary(useData.getState(), STU).total).toBe(before);
  });

  it("disparaissent quand l'école les efface — le versement déjà fait reste acquis", async () => {
    // Il a versé un mois, puis suivi 11 séances : 3 mois entamés, dont deux
    // entièrement impayés.
    await useData.getState().addSold({ studentId: STU, subscriptionId: SUB, amount: 4800 });
    await attend(11);
    const owed = studentDebtSummary(useData.getState(), STU);
    expect(owed.soldDebt).toBeGreaterThan(0);
    expect(owed.registrationDue).toBe(1500);

    setCase("special", { freeSubscriptionIds: [SUB] });
    const res = await useData.getState().convertStudentCase({ studentId: STU, mode: "clear" });
    expect(res.ok).toBe(true);
    expect(res.waived).toBe(owed.soldDebt);

    const after = studentDebtSummary(useData.getState(), STU);
    expect(after.soldDebt).toBe(0);
    expect(after.registrationDue).toBe(0);
    expect(after.total).toBe(0);
    // Ce qu'il a versé n'est pas rendu : son solde repart simplement de zéro.
    expect(soldFor(useData.getState(), STU, SUB)).toBe(0);
    // Et l'école lit ce que le geste lui a coûté, séance par séance.
    const waived = useData
      .getState()
      .attendance.filter((a) => a.studentId === STU)
      .reduce((sum, a) => sum + (a.waivedAmount ?? 0), 0);
    expect(waived).toBe(owed.soldDebt);
  });

  it("se recalculent à la part de l'école sur un passage en « école seulement »", async () => {
    await attend(3);
    const sub = useData.getState().subscriptions.find((s) => s.id === SUB)!;
    const schoolPart = schoolPerSeanceOf(sub);
    expect(schoolPart).toBeLessThan(sub.pricePerSession);

    setCase("school_only", { schoolOnlySubscriptionIds: [SUB] });
    const res = await useData.getState().convertStudentCase({ studentId: STU, mode: "reprice" });
    expect(res.repriced).toBe(3);

    const rows = useData.getState().attendance.filter((a) => a.studentId === STU);
    expect(rows.every((a) => a.amountDeducted === schoolPart)).toBe(true);
    // Sa dette de scolarité vaut désormais trois parts d'école, pas trois
    // séances entières.
    expect(studentDebtSummary(useData.getState(), STU).soldDebt).toBe(3 * schoolPart);
    // Et l'enseignant n'est plus payé pour lui sur cet emploi du temps.
    expect(useData.getState().unpaidTeacher.filter((u) => u.studentId === STU)).toHaveLength(0);
  });

  it("se recalculent à la réduction accordée sur un passage en « réduction »", async () => {
    await attend(2);
    const reduction: CaseReduction = { type: "percent", schoolValue: 50, teacherValue: 50 };
    setCase("reduction", { caseReduction: reduction });
    const res = await useData.getState().convertStudentCase({ studentId: STU, mode: "reprice" });
    expect(res.repriced).toBe(2);

    const sub = useData.getState().subscriptions.find((s) => s.id === SUB)!;
    // La moitié de la part de l'école + la moitié de celle de l'enseignant.
    const expected = sub.pricePerSession / 2;
    const rows = useData.getState().attendance.filter((a) => a.studentId === STU);
    expect(rows.every((a) => a.amountDeducted === expected)).toBe(true);
    // La part de l'enseignant est réduite de sa propre moitié, pas supprimée.
    const dues = useData.getState().unpaidTeacher.filter((u) => u.studentId === STU);
    expect(dues).toHaveLength(2);
    expect(dues.every((u) => u.amount === (sub.teacherPerSeance ?? 0) / 2)).toBe(true);
  });

  it("ne touche pas aux séances déjà réglées à l'enseignant", async () => {
    await attend(2);
    const sub = useData.getState().subscriptions.find((s) => s.id === SUB)!;
    const first = useData.getState().unpaidTeacher.filter((u) => u.studentId === STU)[0];
    useData.setState({
      unpaidTeacher: useData
        .getState()
        .unpaidTeacher.map((u) => (u.id === first.id ? { ...u, paid: true } : u)),
    });

    setCase("school_only", { schoolOnlySubscriptionIds: [SUB] });
    const res = await useData.getState().convertStudentCase({ studentId: STU, mode: "reprice" });
    expect(res.repriced).toBe(1);
    const amounts = useData
      .getState()
      .attendance.filter((a) => a.studentId === STU)
      .map((a) => a.amountDeducted)
      .sort((a, b) => a - b);
    expect(amounts).toEqual([schoolPerSeanceOf(sub), sub.pricePerSession].sort((a, b) => a - b));
  });

  it("le mois d'un « école seule » se lit à la part de l'école", () => {
    const sub = useData.getState().subscriptions.find((s) => s.id === SUB)!;
    expect(schoolMonthShareOf(sub)).toBe(2800);
  });
});
