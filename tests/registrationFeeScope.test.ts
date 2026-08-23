import { describe, it, expect, beforeEach } from "vitest";
import { useData } from "@/lib/store/data";
import { buildSeed } from "@/tests/fixtures/seed";
import {
  registrationFeeAppliesToSub,
  registrationFeeFor,
  registrationFeeScopeLabel,
} from "@/lib/helpers";

/**
 * TOUT LE MONDE NE DOIT PAS LES FRAIS D'INSCRIPTION.
 *
 * L'école choisit son périmètre : tous les élèves, tout un NIVEAU (« tout le
 * secondaire »), certaines CLASSES, ou seulement les élèves inscrits sur
 * certains EMPLOIS DU TEMPS. Un enfant qui ne coche que des emplois hors
 * périmètre ne se voit rien réclamer — et l'écran d'inscription cesse alors
 * d'afficher la moindre dette.
 */

const SUB_A = "sub-1";
const SUB_B = "sub-2";

function board() {
  const db = buildSeed();
  db.school = { ...db.school, registrationFee: 2000 };
  useData.setState(db);
  return useData.getState();
}

/** Les classes et emplois du temps des deux abonnements du test. */
function idsOf(subId: string) {
  const db = useData.getState();
  const sub = db.subscriptions.find((s) => s.id === subId)!;
  const session = db.sessions.find((s) => s.id === sub.sessionId)!;
  return { sessionId: session.id, classId: session.classId };
}

describe("le périmètre des frais d'inscription", () => {
  beforeEach(board);

  it("s'applique à tout le monde par défaut", () => {
    const db = useData.getState();
    expect(registrationFeeAppliesToSub(db, db.school, SUB_A)).toBe(true);
    expect(registrationFeeFor(db, db.school, [SUB_A, SUB_B])).toBe(2000);
    expect(registrationFeeScopeLabel(db, db.school)).toBe("Tous les élèves");
  });

  it("se restreint aux classes choisies", () => {
    const { classId } = idsOf(SUB_A);
    useData.getState().updateSchool({
      registrationFeeScope: "classes",
      registrationFeeClassIds: [classId],
    });
    const db = useData.getState();
    const other = idsOf(SUB_B);

    expect(registrationFeeAppliesToSub(db, db.school, SUB_A)).toBe(true);
    // Le second abonnement n'est concerné que s'il partage la même classe.
    expect(registrationFeeAppliesToSub(db, db.school, SUB_B)).toBe(other.classId === classId);
  });

  it("se restreint aux emplois du temps choisis", () => {
    const { sessionId } = idsOf(SUB_A);
    useData.getState().updateSchool({
      registrationFeeScope: "sessions",
      registrationFeeSessionIds: [sessionId],
    });
    const db = useData.getState();

    expect(registrationFeeAppliesToSub(db, db.school, SUB_A)).toBe(true);
    expect(registrationFeeAppliesToSub(db, db.school, SUB_B)).toBe(false);
    // Un élève inscrit UNIQUEMENT hors périmètre ne doit rien.
    expect(registrationFeeFor(db, db.school, [SUB_B])).toBe(0);
    // Dès qu'un seul de ses emplois y entre, les frais sont dus — une fois.
    expect(registrationFeeFor(db, db.school, [SUB_A, SUB_B])).toBe(2000);
  });

  it("se restreint à un niveau entier", () => {
    const db0 = useData.getState();
    const { classId } = idsOf(SUB_A);
    const level = db0.classes.find((c) => c.id === classId)!.coursLevel!;
    useData.getState().updateSchool({
      registrationFeeScope: "levels",
      registrationFeeLevels: [level],
    });
    const db = useData.getState();
    expect(registrationFeeAppliesToSub(db, db.school, SUB_A)).toBe(true);

    // Un niveau que personne ne suit ne réclame rien.
    useData.getState().updateSchool({ registrationFeeLevels: ["formation"] });
    const db2 = useData.getState();
    expect(registrationFeeAppliesToSub(db2, db2.school, SUB_A)).toBe(false);
  });

  it("ne réclame rien quand aucun emploi du temps n'est coché", () => {
    const db = useData.getState();
    expect(registrationFeeFor(db, db.school, [])).toBe(0);
  });

  it("ne réclame rien quand le montant est à zéro", () => {
    useData.getState().updateSchool({ registrationFee: 0 });
    const db = useData.getState();
    expect(registrationFeeFor(db, db.school, [SUB_A])).toBe(0);
  });
});
