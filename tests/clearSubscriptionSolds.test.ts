import { describe, it, expect, beforeEach } from "vitest";
import { useData } from "@/lib/store/data";
import { buildSeed } from "@/tests/fixtures/seed";
import { soldFor } from "@/lib/helpers";

/**
 * « EFFACER LES SOLDES DE CET EMPLOI DU TEMPS » — le bouton de la direction, sur
 * la feuille du groupe ouverte depuis le tableau de bord.
 *
 * C'est le pendant, pour UN SEUL emploi, du script de purge livré dans
 * `supabase/purge-2026-08-27-soldes-eleves.sql`. Ce que les tests vérifient est
 * exactement ce que l'écran de confirmation promet :
 *
 *  - les versements de CET emploi partent, avec leur reflet en caisse ;
 *  - les cagnottes retombent à zéro, sans séance réglée d'avance, mais les
 *    séances déjà suivies restent comptées comme suivies ;
 *  - les PRÉSENCES ne bougent pas — l'élève est venu, l'enseignant a travaillé ;
 *  - les autres emplois du temps, les frais ordinaires et les séances libres ne
 *    sont pas concernés.
 */

const SUB = "sub-1";
const OTHER = "sub-2";
const STU = "stu-1";
const STU_OTHER = "stu-2";

const cashIn = () => useData.getState().cash.filter((c) => c.type === "student_payment");

describe("effacer les soldes d'un emploi du temps", () => {
  beforeEach(() => {
    const db = buildSeed();
    db.payments = [];
    db.cash = [];
    db.studentCharges = [];
    db.teacherChildDebts = [];
    db.enrollments = db.enrollments.map((e) => ({
      ...e,
      balance: 0,
      paidSeances: e.consumedSeances,
    }));
    useData.setState(db);
  });

  it("efface les versements de l'emploi, leur caisse, et vide les cagnottes", async () => {
    await useData.getState().addSold({ studentId: STU, subscriptionId: SUB, amount: 4000 });
    await useData.getState().addSold({ studentId: STU, subscriptionId: SUB, amount: 1000 });
    await useData.getState().addSold({ studentId: STU_OTHER, subscriptionId: OTHER, amount: 3000 });
    expect(soldFor(useData.getState(), STU, SUB)).toBe(5000);

    const res = await useData.getState().clearSubscriptionSolds(SUB);
    expect(res).toMatchObject({ ok: true, payments: 2, amount: 5000 });

    const db = useData.getState();
    expect(db.payments.filter((p) => p.subscriptionId === SUB)).toHaveLength(0);
    expect(soldFor(db, STU, SUB)).toBe(0);
    // L'autre emploi du temps n'a rien senti passer.
    expect(db.payments.filter((p) => p.subscriptionId === OTHER)).toHaveLength(1);
    expect(soldFor(db, STU_OTHER, OTHER)).toBe(3000);
    expect(cashIn()).toHaveLength(1);
    expect(cashIn()[0].amount).toBe(3000);
  });

  it("une dette de l'emploi s'efface aussi : l'élève repart à zéro, pas dans le rouge", async () => {
    useData.setState({
      enrollments: useData
        .getState()
        .enrollments.map((e) =>
          e.subscriptionId === SUB && e.studentId === STU ? { ...e, balance: -2500 } : e,
        ),
    });

    await useData.getState().clearSubscriptionSolds(SUB);
    expect(soldFor(useData.getState(), STU, SUB)).toBe(0);
  });

  it("les séances suivies restent suivies : « payées » retombe sur « consommées »", async () => {
    useData.setState({
      enrollments: useData
        .getState()
        .enrollments.map((e) =>
          e.subscriptionId === SUB && e.studentId === STU
            ? { ...e, consumedSeances: 6, paidSeances: 6 }
            : e,
        ),
    });
    await useData.getState().addSold({ studentId: STU, subscriptionId: SUB, amount: 4000 });

    const before = useData.getState().attendance.length;
    await useData.getState().clearSubscriptionSolds(SUB);

    const db = useData.getState();
    const enr = db.enrollments.find((e) => e.subscriptionId === SUB && e.studentId === STU)!;
    expect(enr.consumedSeances).toBe(6);
    expect(enr.paidSeances).toBe(6);
    expect(enr.balance).toBe(0);
    // Les présences sont intactes : effacer le pointage effacerait aussi le
    // travail de l'enseignant.
    expect(db.attendance).toHaveLength(before);
  });

  it("l'avance de l'école sur cet emploi cesse d'être réclamée à la famille", async () => {
    useData.setState({
      enrollments: useData
        .getState()
        .enrollments.map((e) =>
          e.subscriptionId === SUB && e.studentId === STU ? { ...e, balance: -3000 } : e,
        ),
    });

    const covered = await useData
      .getState()
      .coverStudentDebt({ studentId: STU, subscriptionId: SUB });
    expect(covered.ok).toBe(true);
    expect(
      useData.getState().studentCharges.filter((c) => c.origin === "school_advance"),
    ).not.toHaveLength(0);

    await useData.getState().clearSubscriptionSolds(SUB);

    const db = useData.getState();
    // Le versement qu'elle remboursait n'existe plus : réclamer les deux
    // ferait payer deux fois la même scolarité.
    expect(db.studentCharges.filter((c) => c.origin === "school_advance")).toHaveLength(0);
    // La caisse ne garde ni l'entrée portée au crédit de l'élève, ni la sortie
    // qui l'a financée.
    expect(db.cash.filter((c) => c.type === "student_payment")).toHaveLength(0);
    expect(db.cash.filter((c) => c.type === "student_debt")).toHaveLength(0);
    expect(soldFor(db, STU, SUB)).toBe(0);
  });

  it("la scolarité portée sur le salaire du père, pas encore retenue, est rendue à l'enfant", async () => {
    // Porter une scolarité sur un salaire suppose un père enseignant.
    useData.setState({
      students: useData
        .getState()
        .students.map((st) => (st.id === STU ? { ...st, teacherFatherId: "tea-1" } : st)),
    });
    const borne = await useData.getState().payTeacherChild({
      studentId: STU,
      subscriptionId: SUB,
      monthCode: "M1",
      amount: 2000,
      source: "teacher_debt",
    });
    expect(borne.ok).toBe(true);
    expect(useData.getState().teacherChildDebts).toHaveLength(1);

    await useData.getState().clearSubscriptionSolds(SUB);
    expect(useData.getState().teacherChildDebts).toHaveLength(0);
    // Rien n'avait traversé le tiroir : il n'y a rien à retirer de la caisse.
    expect(cashIn()).toHaveLength(0);
  });

  it("garde ce qu'une retenue DÉJÀ passée sur une paie a réellement coûté", async () => {
    useData.setState({
      students: useData
        .getState()
        .students.map((st) => (st.id === STU ? { ...st, teacherFatherId: "tea-1" } : st)),
    });
    await useData.getState().payTeacherChild({
      studentId: STU,
      subscriptionId: SUB,
      monthCode: "M1",
      amount: 2000,
      source: "teacher_debt",
    });
    useData.setState({
      teacherChildDebts: useData.getState().teacherChildDebts.map((d) => ({ ...d, paid: true })),
    });

    await useData.getState().clearSubscriptionSolds(SUB);
    expect(useData.getState().teacherChildDebts).toHaveLength(1);
  });

  it("ne touche ni aux frais ordinaires ni à leur règlement", async () => {
    await useData.getState().saveStudentCharge({
      studentId: STU,
      name: "Livre de maths",
      amount: 1200,
    });
    const charge = useData.getState().studentCharges[0];
    await useData
      .getState()
      .payStudentCharges({ studentId: STU, lines: [{ chargeId: charge.id, amount: 1200 }] });
    await useData.getState().addSold({ studentId: STU, subscriptionId: SUB, amount: 4000 });

    await useData.getState().clearSubscriptionSolds(SUB);

    const db = useData.getState();
    // Un frais ne touche AUCUN emploi du temps : ce n'est pas un solde.
    expect(db.studentCharges).toHaveLength(1);
    expect(db.payments.filter((p) => p.chargeId === charge.id)).toHaveLength(1);
    expect(cashIn()).toHaveLength(1);
    expect(cashIn()[0].amount).toBe(1200);
  });

  it("ignore un emploi du temps inconnu", async () => {
    expect(await useData.getState().clearSubscriptionSolds("sub-inconnu")).toEqual({ ok: false });
  });
});
