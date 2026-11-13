import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * LA FIN DU « HORS-LIGNE » PERMANENT.
 *
 * Avant, une seule table en échec pendant la relecture de fond suffisait à
 * jeter TOUTE la relecture : l'écran restait « Hors-ligne », miroir d'écriture
 * en pause. Désormais la relecture est tolérante : les tables lues sont
 * adoptées, les autres gardent la copie affichée, et l'application repasse en
 * ligne (le miroir reprend). Seul un échec de TOUTES les tables reste un
 * passage hors-ligne.
 */

let cachedDb: Record<string, unknown> | null = null;
let failedKeys: string[] = [];
let networkDb: Record<string, unknown> | null = null;

vi.mock("@/lib/supabase/snapshotCache", () => ({
  readSnapshot: async () => (cachedDb ? { db: cachedDb, savedAt: Date.now(), dirty: false } : null),
  writeSnapshot: () => {},
  clearSnapshot: async () => {},
}));

vi.mock("@/lib/supabase/load", async () => {
  const actual = await vi.importActual<typeof import("@/lib/supabase/load")>("@/lib/supabase/load");
  return {
    ...actual,
    loadDatabaseTolerant: async () => {
      const { school, ...all } = (networkDb ?? actual.emptyDatabase()) as Record<string, unknown>;
      const collections: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(all)) if (!failedKeys.includes(k)) collections[k] = v;
      return {
        school,
        collections,
        failed: failedKeys.map((key) => ({ key, message: `${key}: boom`, timeout: false })),
      };
    },
  };
});

import { useData } from "@/lib/store/data";
import { emptyDatabase } from "@/lib/supabase/load";
import { COLLECTION_ORDER } from "@/lib/supabase/tables";

function db(students: string[], attendance: string[]): Record<string, unknown> {
  const d = emptyDatabase() as unknown as Record<string, unknown>;
  d.students = students.map((id) => ({ id, name: id }));
  d.attendance = attendance.map((id) => ({ id, studentId: "a", sessionId: "s" }));
  return d;
}
const ids = (k: "students" | "attendance") =>
  (useData.getState()[k] as { id: string }[]).map((r) => r.id);

beforeEach(() => {
  cachedDb = null;
  networkDb = null;
  failedKeys = [];
  useData.getState().reset();
});

describe("relecture partielle", () => {
  it("une table en échec : en ligne, frais adopté ailleurs, copie gardée pour elle", async () => {
    cachedDb = db(["a"], ["x1", "x2"]);
    networkDb = db(["a", "b"], []);
    failedKeys = ["attendance"];
    const res = await useData.getState().boot("u");
    expect(res.kind).toBe("fresh");
    expect(res.kind === "fresh" && res.stale).toEqual(["attendance"]);
    expect(useData.getState().offline).toBe(false);
    expect(ids("students")).toEqual(["a", "b"]);
    // Les présences n'ont PAS été vidées : la copie affichée est conservée.
    expect(ids("attendance")).toEqual(["x1", "x2"]);
  });

  it("toutes les tables en échec : hors-ligne avec la raison", async () => {
    cachedDb = db(["a"], ["x1"]);
    failedKeys = [...COLLECTION_ORDER];
    const res = await useData.getState().boot("u");
    expect(res.kind).toBe("cache-only");
    expect(useData.getState().offline).toBe(true);
    expect(useData.getState().offlineReason).toMatch(/boom/);
    expect(ids("attendance")).toEqual(["x1"]);
  });

  it("le bandeau hors-ligne ne clignote pas pendant une nouvelle tentative, et disparaît au succès", async () => {
    cachedDb = db(["a"], []);
    failedKeys = [...COLLECTION_ORDER];
    await useData.getState().boot("u");
    failedKeys = [];
    networkDb = db(["a", "c"], []);
    const pending = useData.getState().revalidate();
    expect(useData.getState().offline).toBe(true);
    const res = await pending;
    expect(res.kind).toBe("fresh");
    expect(useData.getState().offline).toBe(false);
    expect(ids("students")).toEqual(["a", "c"]);
  });

  it("sans copie affichée, une lecture partielle n'est pas adoptée (écran d'erreur, rien d'écrasé)", async () => {
    networkDb = db(["a"], []);
    failedKeys = ["students"];
    const res = await useData.getState().revalidate();
    expect(res.kind).toBe("failed");
  });
});
