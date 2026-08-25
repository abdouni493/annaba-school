import { describe, it, expect, beforeEach } from "vitest";
import { useData } from "@/lib/store/data";
import { buildSeed } from "@/tests/fixtures/seed";
import {
  isMultiLevelSession,
  sessionClassIds,
  sessionClassesLabel,
  sessionGroupIds,
  sessionGroupsOfClass,
  sessionHasClass,
  studentMatches,
} from "@/lib/helpers";
import type { ScheduleSession } from "@/lib/types";

/**
 * UN EMPLOI DU TEMPS SUR PLUSIEURS NIVEAUX.
 *
 * Le même créneau réunit la 4e année moyenne et la 3e année secondaire — même
 * heure, même salle, même enseignant — mais chaque niveau amène SES groupes.
 * Ce que ces tests vérifient, c'est que la nouveauté reste INVISIBLE pour tout
 * le reste : `classId` garde la première classe, `groupIds` l'union de tous les
 * groupes, et les écrans qui ne connaissent qu'un groupe continuent de lire ce
 * qu'ils lisaient.
 */

beforeEach(() => {
  useData.setState(buildSeed());
});

/** L'emploi du temps `ses-1`, transformé en créneau à deux niveaux. */
function multiLevel(): ScheduleSession {
  const db = useData.getState();
  const base = db.sessions.find((s) => s.id === "ses-1")!;
  const [c1, c2] = db.classes;
  const [g1, g2, g3] = db.groups;
  const session: ScheduleSession = {
    ...base,
    classId: c1.id,
    classIds: [c1.id, c2.id],
    classGroups: { [c1.id]: [g1.id, g2.id], [c2.id]: [g3.id] },
    groupId: g1.id,
    groupIds: [g1.id, g2.id, g3.id],
  };
  useData.setState({
    sessions: db.sessions.map((s) => (s.id === "ses-1" ? session : s)),
  });
  return session;
}

describe("les niveaux d'un emploi du temps", () => {
  it("un emploi ordinaire n'a qu'un niveau, et ce niveau est sa classe", () => {
    const s = useData.getState().sessions.find((x) => x.id === "ses-1")!;
    expect(sessionClassIds(s)).toEqual([s.classId]);
    expect(isMultiLevelSession(s)).toBe(false);
    // Sans découpage par classe, « les groupes de cette classe » sont
    // simplement tous les groupes du créneau.
    expect(sessionGroupsOfClass(s, s.classId)).toEqual(sessionGroupIds(s));
  });

  it("un emploi multi-niveaux porte tous ses niveaux, chacun avec ses groupes", () => {
    const s = multiLevel();
    const db = useData.getState();
    const [c1, c2] = db.classes;
    const [g1, g2, g3] = db.groups;

    expect(isMultiLevelSession(s)).toBe(true);
    expect(sessionClassIds(s)).toEqual([c1.id, c2.id]);
    expect(sessionHasClass(s, c2.id)).toBe(true);

    // Chaque niveau amène les siens, et rien que les siens.
    expect(sessionGroupsOfClass(s, c1.id)).toEqual([g1.id, g2.id]);
    expect(sessionGroupsOfClass(s, c2.id)).toEqual([g3.id]);

    // Et l'union est ce que lisent les écrans qui ne connaissent pas la
    // nouveauté : le scan, la feuille de présence, la paie.
    expect(sessionGroupIds(s)).toEqual([g1.id, g2.id, g3.id]);
    expect(sessionClassesLabel(db, s)).toBe(`${c1.name} · ${c2.name}`);
  });

  it("les groupes se déduisent de classGroups même si groupIds est vide", () => {
    const db = useData.getState();
    const [c1, c2] = db.classes;
    const [g1, g2] = db.groups;
    const s = {
      ...db.sessions.find((x) => x.id === "ses-1")!,
      classGroups: { [c1.id]: [g1.id], [c2.id]: [g2.id] },
      groupIds: [],
    } as ScheduleSession;
    expect(sessionGroupIds(s)).toEqual([g1.id, g2.id]);
    expect(sessionClassIds(s)).toEqual([c1.id, c2.id]);
  });
});

describe("le deuxième numéro de téléphone d'un élève", () => {
  it("se cherche exactement comme le premier", () => {
    const db = useData.getState();
    const student = { ...db.students[0], phone: "0555111222", phone2: "0661998877" };
    useData.setState({
      students: db.students.map((s) => (s.id === student.id ? student : s)),
    });
    const fresh = useData.getState();

    expect(studentMatches(fresh, student, "0555")).toBe(true);
    // Une famille qui appelle depuis l'AUTRE ligne doit se retrouver aussi.
    expect(studentMatches(fresh, student, "998877")).toBe(true);
    expect(studentMatches(fresh, student, "0700000")).toBe(false);
  });

  it("reste facultatif — une fiche sans second numéro se cherche normalement", () => {
    const db = useData.getState();
    const student = { ...db.students[0], phone: "0555111222", phone2: undefined };
    expect(studentMatches(db, student, "0555")).toBe(true);
    expect(studentMatches(db, student, "0661")).toBe(false);
  });
});
