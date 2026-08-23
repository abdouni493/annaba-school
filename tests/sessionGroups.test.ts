import { describe, it, expect, beforeEach } from "vitest";
import { useData } from "@/lib/store/data";
import { buildSeed } from "@/tests/fixtures/seed";
import { sessionGroupIds, sessionGroupsLabel, sessionHasGroup } from "@/lib/helpers";

/**
 * UN EMPLOI DU TEMPS PEUT RÉUNIR PLUSIEURS GROUPES.
 *
 * Deux demi-groupes suivent souvent le même cours, à la même heure, dans la
 * même salle, avec le même enseignant : c'est UN emploi du temps, pas deux.
 * `groupIds` porte la liste complète et `groupId` — la colonne historique —
 * garde le PREMIER, pour que le scan, la feuille de présence et la base
 * continuent de lire un groupe sans rien savoir de la nouveauté.
 */

const SES = "ses-1";

function board() {
  useData.setState(buildSeed());
}

describe("les groupes d'un emploi du temps", () => {
  beforeEach(board);

  it("retombe sur le groupe unique quand la liste est absente", () => {
    const session = useData.getState().sessions.find((s) => s.id === SES)!;
    expect(sessionGroupIds({ ...session, groupIds: undefined })).toEqual([session.groupId]);
  });

  it("rend tous les groupes quand la liste est renseignée", () => {
    const db = useData.getState();
    const session = db.sessions.find((s) => s.id === SES)!;
    const [g1, g2] = db.groups;
    const multi = { ...session, groupId: g1.id, groupIds: [g1.id, g2.id] };

    expect(sessionGroupIds(multi)).toEqual([g1.id, g2.id]);
    expect(sessionHasGroup(multi, g2.id)).toBe(true);
    expect(sessionGroupsLabel(db, multi)).toBe(`${g1.name} · ${g2.name}`);
  });

  it("ne compte jamais deux fois le même groupe", () => {
    const db = useData.getState();
    const session = db.sessions.find((s) => s.id === SES)!;
    const g = db.groups[0];
    expect(sessionGroupIds({ ...session, groupIds: [g.id, g.id] })).toEqual([g.id]);
  });

  it("garde le premier groupe en colonne historique après une modification", () => {
    const db = useData.getState();
    const [g1, g2] = db.groups;
    useData.getState().updateItem("sessions", SES, { groupId: g1.id, groupIds: [g1.id, g2.id] });

    const saved = useData.getState().sessions.find((s) => s.id === SES)!;
    expect(saved.groupId).toBe(g1.id);
    expect(sessionGroupIds(saved)).toHaveLength(2);
  });
});
