import { describe, it, expect, beforeEach } from "vitest";
import { useData } from "@/lib/store/data";
import { buildSeed } from "@/tests/fixtures/seed";
import { studentDebtSummary, studentEmploiDebt } from "@/lib/helpers";

/**
 * L'ALERTE D'UN GROUPE NE PARLE QUE DE CE GROUPE.
 *
 * LE SYMPTÔME. On ouvre un groupe depuis le tableau de bord ; en haut de sa
 * feuille de présence, l'alerte rouge annonce « N élèves de ce groupe doivent
 * de l'argent » et un total. Or elle lisait `studentDebtSummary`, c'est-à-dire
 * TOUT ce qu'un élève doit, PARTOUT. Un enfant parfaitement à jour sur ce
 * cours-ci y apparaissait donc en rouge parce qu'il devait sur un AUTRE emploi
 * du temps, et le total réclamé au comptoir n'était pas celui que cet écran
 * pouvait encaisser.
 *
 * LA RÈGLE MAINTENANT (`studentEmploiDebt`) : chaque dette appartient à
 * l'emploi du temps qui l'a produite — un mois dans le rouge à celui qui l'a
 * ouvert, un reste d'ancien paiement à celui qu'il a crédité, une avance de
 * l'école au mois qu'elle a débloqué. Ce qui ne nomme AUCUN emploi (un livre,
 * les frais d'inscription) n'appartient à aucun et reste réclamable partout.
 * Seul ce qui appartient à un AUTRE emploi sort du compte — et il n'est pas
 * caché pour autant : `other` le porte, à part, pour que la ligne de l'élève
 * le signale et que son bouton « Autres emplois » l'ouvre, à lui seul.
 */
const SES_A = "ses-1";
const SUB_A = "sub-1";
const SES_B = "ses-4";
const SUB_B = "sub-4";
const STU = "stu-1";
const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** L'élève suit LES DEUX emplois du temps, sans un dinar de solde sur aucun. */
function board() {
  const db = buildSeed();
  db.attendance = [];
  db.payments = [];
  db.studentCharges = [];
  db.unpaidTeacher = [];
  db.independent = [];
  db.freePeriods = [];
  db.cash = [];
  db.enrollments = db.enrollments.filter(
    (e) => e.subscriptionId !== SUB_A && e.subscriptionId !== SUB_B,
  );

  const opened = new Date();
  opened.setDate(opened.getDate() - 400);
  const openedIso = opened.toLocaleDateString("fr-CA");
  db.students = db.students.map((st) =>
    st.id === STU
      ? {
          ...st,
          isFree: false,
          studentCase: "normal" as const,
          registrationDue: 0,
          subscriptionIds: [SUB_A, SUB_B],
          subscriptionDates: {
            [SUB_A]: { subscribedAt: openedIso, startDate: openedIso },
            [SUB_B]: { subscribedAt: openedIso, startDate: openedIso },
          },
        }
      : {
          ...st,
          subscriptionIds: st.subscriptionIds.filter((id) => id !== SUB_A && id !== SUB_B),
        },
  );
  useData.setState(db);
}

/** `count` présences sur un emploi, sans solde : autant de scolarité due. */
async function attend(sessionId: string, count: number, back = 200) {
  const session = useData.getState().sessions.find((s) => s.id === sessionId)!;
  const d = new Date();
  d.setDate(d.getDate() - back);
  let done = 0;
  while (done < count) {
    if (session.days.includes(DAY_KEYS[d.getDay()] as never)) {
      await useData.getState().setPresence({
        studentId: STU,
        sessionId,
        date: d.toLocaleDateString("fr-CA"),
        status: "present",
      });
      done += 1;
    }
    d.setDate(d.getDate() + 1);
  }
}

const here = () => studentEmploiDebt(useData.getState(), STU, SUB_A);

beforeEach(board);

describe("l'alerte du groupe ouvert ne compte que ce groupe", () => {
  it("un élève à jour ICI n'est pas en dette, même s'il doit ailleurs", async () => {
    await attend(SES_B, 3); // 3 × 500 = 1 500 DA dus sur l'AUTRE emploi

    const debt = here();
    // Ce cours-ci ne lui réclame rien : il n'a pas à figurer dans l'alerte.
    expect(debt.school).toBe(0);
    expect(debt.total).toBe(0);
    // Mais sa dette n'est pas perdue : elle est comptée à part, et nommée.
    expect(debt.other).toBe(1500);
    expect(debt.otherRows).toHaveLength(1);
    expect(debt.otherRows[0].subscriptionId).toBe(SUB_B);
    // La fiche de l'élève, elle, continue de tout additionner.
    expect(studentDebtSummary(useData.getState(), STU).total).toBe(1500);
  });

  it("ne réclame QUE les mois de ce cours quand il doit des deux côtés", async () => {
    await attend(SES_A, 2); // 2 × 600 = 1 200 DA ici
    await attend(SES_B, 3); // 3 × 500 = 1 500 DA ailleurs

    const debt = here();
    expect(debt.school).toBe(1200);
    expect(debt.total).toBe(1200);
    expect(debt.other).toBe(1500);
    // Chaque dinar d'un seul côté : rien n'est compté deux fois, rien n'est perdu.
    expect(debt.total + debt.other).toBe(studentDebtSummary(useData.getState(), STU).total);
    // Et les mois listés sont ceux de CE cours, jamais ceux de l'autre.
    expect(debt.soldRows.every((r) => r.subscriptionId === SUB_A)).toBe(true);
    expect(debt.otherRows.every((r) => r.subscriptionId === SUB_B)).toBe(true);
  });

  it("l'avance faite pour un AUTRE emploi du temps ne se réclame pas ici", async () => {
    await attend(SES_A, 1);
    useData.setState({
      studentCharges: [
        {
          id: "chg-autre",
          studentId: STU,
          name: "Avance scolarité",
          amount: 900,
          date: "2026-09-01",
          origin: "school_advance",
          subscriptionId: SUB_B,
          monthCode: "M1",
          paidAmount: 0,
          paid: false,
        },
      ],
    });

    const debt = here();
    expect(debt.charges).toBe(0);
    expect(debt.advances).toBe(0);
    expect(debt.total).toBe(600); // la seule séance de CE cours
    expect(debt.other).toBe(900 + 0);
  });

  it("l'avance faite POUR CE cours, elle, se réclame bien ici", async () => {
    useData.setState({
      studentCharges: [
        {
          id: "chg-ici",
          studentId: STU,
          name: "Avance scolarité",
          amount: 900,
          date: "2026-09-01",
          origin: "school_advance",
          subscriptionId: SUB_A,
          monthCode: "M1",
          paidAmount: 0,
          paid: false,
        },
      ],
    });

    const debt = here();
    expect(debt.charges).toBe(900);
    expect(debt.advances).toBe(900);
    expect(debt.total).toBe(900);
    expect(debt.other).toBe(0);
  });

  it("un frais qui ne nomme aucun emploi reste réclamable partout", async () => {
    const res = await useData.getState().saveStudentCharge({
      studentId: STU,
      name: "Livre de maths",
      amount: 700,
      date: "2026-09-01",
    });
    expect(res.ok).toBe(true);

    // Un livre n'est le livre d'aucun cours : la famille est au comptoir, on le
    // lui réclame — ici comme sur la feuille de n'importe lequel de ses groupes.
    expect(here().charges).toBe(700);
    expect(here().total).toBe(700);
    expect(here().other).toBe(0);
    expect(studentEmploiDebt(useData.getState(), STU, SUB_B).charges).toBe(700);
  });

  it("les frais d'inscription ne relèvent d'aucun emploi et restent dits", async () => {
    useData.setState({
      students: useData
        .getState()
        .students.map((st) => (st.id === STU ? { ...st, registrationDue: 1000 } : st)),
    });
    const debt = here();
    expect(debt.registrationDue).toBe(1000);
    expect(debt.school).toBe(1000);
    expect(debt.other).toBe(0);
  });

  it("un élève sans rien ne figure nulle part", () => {
    const debt = here();
    expect(debt.total).toBe(0);
    expect(debt.other).toBe(0);
    expect(debt.soldRows).toHaveLength(0);
    expect(debt.otherRows).toHaveLength(0);
  });

  it("encaisser sur l'autre emploi vide `other` sans toucher à ce cours", async () => {
    await attend(SES_A, 2);
    await attend(SES_B, 3);
    expect(here().other).toBe(1500);

    await useData
      .getState()
      .addSold({ studentId: STU, subscriptionId: SUB_B, amount: 1500, monthCode: "M1" });

    const debt = here();
    expect(debt.other).toBe(0);
    // Ce cours-ci n'a pas bougé d'un dinar : l'argent est allé où on l'a mis.
    expect(debt.total).toBe(1200);
  });
});
