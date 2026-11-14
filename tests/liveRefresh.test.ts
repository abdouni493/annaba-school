import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * PRÉSENCES SAISIES SUR UN AUTRE POSTE — adoptées sans recharger, sans jamais
 * écraser ni perdre une saisie locale (`absorbServerRows`).
 */

vi.mock("@/lib/supabase/snapshotCache", () => ({
  readSnapshot: async () => null,
  writeSnapshot: () => {},
  clearSnapshot: async () => {},
}));

import { absorbServerRows, useData } from "@/lib/store/data";

type Row = Record<string, unknown>;
const att = (id: string, status = "present", sessionId = "s1"): Row => ({
  id,
  studentId: "st",
  sessionId,
  timestamp: "2026-11-13T14:00:00.000Z",
  amountDeducted: 0,
  status,
});
const ids = () => (useData.getState().attendance as unknown as Row[]).map((r) => r.id).sort();
const inS1 = (r: Row) => r.sessionId === "s1";

beforeEach(() => {
  useData.getState().reset();
});

describe("absorbServerRows", () => {
  it("ajoute les présences pointées ailleurs", () => {
    useData.setState({ attendance: [att("a")] } as never);
    const before = useData.getState().attendance as unknown as Row[];
    const n = absorbServerRows("attendance", [att("a"), att("b"), att("c")], {
      before,
      inScope: inS1,
      allowDeletes: true,
    });
    expect(n).toBe(2);
    expect(ids()).toEqual(["a", "b", "c"]);
  });

  it("met à jour une ligne intacte, mais GARDE une ligne modifiée ici pendant la lecture", () => {
    const a = att("a");
    const b = att("b");
    useData.setState({ attendance: [a, b] } as never);
    const before = useData.getState().attendance as unknown as Row[];
    // L'utilisateur modifie « b » pendant la lecture.
    useData.setState({ attendance: [a, { ...b, status: "absent" }] } as never);
    absorbServerRows("attendance", [att("a", "late"), att("b", "cancelled")], {
      before,
      inScope: inS1,
      allowDeletes: true,
    });
    const rows = useData.getState().attendance as unknown as Row[];
    expect(rows.find((r) => r.id === "a")?.status).toBe("late");
    expect(rows.find((r) => r.id === "b")?.status).toBe("absent");
  });

  it("ne réajoute pas une ligne retirée ici pendant la lecture", () => {
    useData.setState({ attendance: [att("a"), att("b")] } as never);
    const before = useData.getState().attendance as unknown as Row[];
    useData.setState({ attendance: [before[0]] } as never);
    absorbServerRows("attendance", [att("a"), att("b")], { before, inScope: inS1, allowDeletes: true });
    expect(ids()).toEqual(["a"]);
  });

  it("retire une ligne supprimée ailleurs SEULEMENT si permis et dans le périmètre", () => {
    useData.setState({ attendance: [att("a"), att("x", "present", "s2")] } as never);
    let before = useData.getState().attendance as unknown as Row[];
    absorbServerRows("attendance", [], { before, inScope: inS1, allowDeletes: false });
    expect(ids()).toEqual(["a", "x"]);
    before = useData.getState().attendance as unknown as Row[];
    absorbServerRows("attendance", [], { before, inScope: inS1, allowDeletes: true });
    // « x » appartient à un autre groupe : hors du périmètre relu, il reste.
    expect(ids()).toEqual(["x"]);
  });

  it("rien de neuf : aucun changement d'état", () => {
    useData.setState({ attendance: [att("a")] } as never);
    const before = useData.getState().attendance;
    const n = absorbServerRows("attendance", [att("a")], {
      before: before as unknown as Row[],
      inScope: inS1,
      allowDeletes: true,
    });
    expect(n).toBe(0);
    expect(useData.getState().attendance).toBe(before);
  });
});
