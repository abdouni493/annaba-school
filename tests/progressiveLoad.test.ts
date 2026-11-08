import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * PREMIER CHARGEMENT EN DEUX TEMPS (aucune copie locale).
 *
 * `attendance_records` pèse ~80 % du temps de chargement. Sans cache, `boot()`
 * peint donc l'écran avec TOUT SAUF les présences (passe 1), puis complète les
 * présences en arrière-plan (passe 2). Ce test fige :
 *  - l'écran est « chargé » dès la passe 1, présences encore vides ;
 *  - la passe 2 remplit les présences, résultat final « fresh » ;
 *  - un échec de la passe 2 garde l'écran lisible (cache-only, hors-ligne) ;
 *  - un échec de la passe 1 donne l'écran d'erreur (failed).
 */

let phase1Students: { id: string }[] = [];
let attendanceRows: { id: string }[] = [];
let deferredAttendance: Promise<void> | null = null;
let failPhase: "1" | "2" | null = null;

vi.mock("@/lib/supabase/snapshotCache", () => ({
  // Aucune copie locale -> `boot()` emprunte le chemin progressif.
  readSnapshot: async () => null,
  writeSnapshot: () => {},
  clearSnapshot: async () => {},
}));

vi.mock("@/lib/supabase/load", async () => {
  const actual = await vi.importActual<typeof import("@/lib/supabase/load")>("@/lib/supabase/load");
  return {
    ...actual,
    loadSome: async (
      keys: string[],
      opts?: { withSchool?: boolean },
    ) => {
      const isAttendancePass = keys.includes("attendance");
      if (isAttendancePass) {
        if (failPhase === "2") throw new Error("échec passe 2");
        if (deferredAttendance) await deferredAttendance;
        return { collections: { attendance: attendanceRows } };
      }
      if (failPhase === "1") throw new Error("échec passe 1");
      const base = actual.emptyDatabase() as unknown as Record<string, unknown[]>;
      const collections: Record<string, unknown[]> = {};
      for (const k of keys) collections[k] = k === "students" ? phase1Students : base[k] ?? [];
      return { school: opts?.withSchool ? actual.emptySchool() : undefined, collections };
    },
  };
});

import { useData } from "@/lib/store/data";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const studentIds = () => (useData.getState().students as { id: string }[]).map((s) => s.id);
const attCount = () => (useData.getState().attendance as unknown[]).length;

beforeEach(() => {
  phase1Students = [];
  attendanceRows = [];
  deferredAttendance = null;
  failPhase = null;
  useData.getState().reset();
});

describe("boot progressif — premier chargement sans cache", () => {
  it("peint l'écran en passe 1 (présences vides), puis les remplit en passe 2", async () => {
    phase1Students = [{ id: "s1" }, { id: "s2" }];
    attendanceRows = [{ id: "a1" }, { id: "a2" }, { id: "a3" }];
    let release!: () => void;
    deferredAttendance = new Promise((r) => (release = r));

    const pending = useData.getState().boot("user-1");

    // Passe 1 : l'écran est chargé et montre les élèves, SANS attendre les présences.
    await wait(10);
    expect(useData.getState().loaded).toBe(true);
    expect(useData.getState().loadStatus).toBe("success");
    expect(useData.getState().revalidating).toBe(true);
    expect(studentIds()).toEqual(["s1", "s2"]);
    expect(attCount()).toBe(0); // présences encore en route

    // Passe 2 : les présences arrivent.
    release();
    const res = await pending;
    expect(res.kind).toBe("fresh");
    expect(attCount()).toBe(3);
    expect(useData.getState().revalidating).toBe(false);
    expect(studentIds()).toEqual(["s1", "s2"]); // la passe 2 n'écrase pas la passe 1
  });

  it("échec de la passe 2 : écran gardé lisible, hors-ligne (cache-only)", async () => {
    phase1Students = [{ id: "s1" }];
    failPhase = "2";
    const res = await useData.getState().boot("user-1");
    expect(res.kind).toBe("cache-only");
    expect(useData.getState().loaded).toBe(true); // la passe 1 reste affichée
    expect(studentIds()).toEqual(["s1"]);
    expect(useData.getState().offline).toBe(true);
    expect(useData.getState().revalidating).toBe(false);
  });

  it("échec de la passe 1 : écran d'erreur (failed)", async () => {
    failPhase = "1";
    const res = await useData.getState().boot("user-1");
    expect(res.kind).toBe("failed");
    expect(useData.getState().loaded).toBe(false);
    expect(useData.getState().loadStatus).toBe("error");
  });
});
