import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * DÉMARRAGE « CACHE D'ABORD » — le remplacement de l'écran « Chargement des
 * données… ».
 *
 * `boot()` peint le dernier instantané local (cache) AUSSITÔT, puis revalide par
 * une lecture réseau complète en arrière-plan. Ce test fige les quatre issues :
 *  - sans cache : lecture réseau classique (fresh) ;
 *  - avec cache : peinture instantanée, puis adoption du frais (fresh) ;
 *  - modification locale pendant la revalidation : on garde le travail de
 *    l'utilisateur (keep-local), jamais écrasé ;
 *  - réseau injoignable avec cache : lecture seule (cache-only), hors-ligne ;
 *  - réseau injoignable sans cache : écran d'erreur (failed).
 */

let cachedDb: Record<string, unknown> | null = null;
let networkDb: Record<string, unknown> | null = null;
let failNetwork = false;
let deferredNetwork: Promise<unknown> | null = null;

vi.mock("@/lib/supabase/snapshotCache", () => ({
  readSnapshot: async () => (cachedDb ? { db: cachedDb, savedAt: Date.now() } : null),
  writeSnapshot: () => {},
  clearSnapshot: async () => {},
}));

vi.mock("@/lib/supabase/load", async () => {
  const actual = await vi.importActual<typeof import("@/lib/supabase/load")>("@/lib/supabase/load");
  const loadDb = async (): Promise<unknown> => {
      if (deferredNetwork) return deferredNetwork;
      if (failNetwork) throw new Error("réseau indisponible");
      return networkDb ?? actual.emptyDatabase();
  };
  // La relecture passe par le chargeur TOLÉRANT : même donnée, et un échec
  // complet se traduit par « toutes les tables en échec ».
  const tolerant = (load: () => Promise<unknown>) => async () => {
    try {
      const { school, ...collections } = (await load()) as Record<string, unknown>;
      return { school, collections, failed: [] };
    } catch (err) {
      const keys = Object.keys(actual.emptyDatabase()).filter((k) => k !== "school");
      return {
        collections: {},
        failed: ["school", ...keys].map((key) => ({ key, message: String(err), timeout: false })),
      };
    }
  };
  return {
    ...actual,
    loadDatabase: loadDb,
    loadDatabaseTolerant: tolerant(loadDb),
    // Chemin progressif (démarrage sans cache) : passe 1 (tout sauf présences)
    // puis passe 2 (présences). On sert chaque sous-ensemble depuis networkDb.
    loadSome: async (keys: string[], opts?: { withSchool?: boolean }) => {
      if (failNetwork) throw new Error("réseau indisponible");
      const base = (networkDb ?? actual.emptyDatabase()) as unknown as Record<string, unknown[]>;
      const collections: Record<string, unknown[]> = {};
      for (const k of keys) collections[k] = base[k] ?? [];
      return { school: opts?.withSchool ? actual.emptySchool() : undefined, collections };
    },
    loadSchool: async () => actual.emptySchool(),
  };
});

import { useData } from "@/lib/store/data";
import { emptyDatabase } from "@/lib/supabase/load";

function dbWithStudents(ids: string[]): Record<string, unknown> {
  const db = emptyDatabase() as unknown as Record<string, unknown>;
  db.students = ids.map((id) => ({ id, name: id }));
  return db;
}

function studentIds(): string[] {
  return (useData.getState().students as { id: string }[]).map((s) => s.id);
}

beforeEach(() => {
  cachedDb = null;
  networkDb = null;
  failNetwork = false;
  deferredNetwork = null;
  useData.getState().reset();
});

describe("boot — démarrage cache d'abord", () => {
  it("sans cache : lit le réseau et adopte la donnée (fresh)", async () => {
    networkDb = dbWithStudents(["a", "b"]);
    const res = await useData.getState().boot("user-1");
    expect(res.kind).toBe("fresh");
    expect(studentIds()).toEqual(["a", "b"]);
    expect(useData.getState().loaded).toBe(true);
    expect(useData.getState().loadStatus).toBe("success");
    expect(useData.getState().revalidating).toBe(false);
    expect(useData.getState().offline).toBe(false);
  });

  it("avec cache : peint INSTANTANÉMENT avant la réponse réseau, puis adopte le frais", async () => {
    cachedDb = dbWithStudents(["c1"]);
    let finish!: (value: unknown) => void;
    deferredNetwork = new Promise((resolve) => {
      finish = resolve;
    });
    const pending = useData.getState().boot("user-1");

    // Peinture du cache en quelques millisecondes (lecture IndexedDB), SANS
    // attendre le réseau (encore en vol, deferredNetwork non résolu).
    await new Promise((r) => setTimeout(r, 10));
    expect(useData.getState().loaded).toBe(true);
    expect(useData.getState().loadStatus).toBe("success");
    expect(useData.getState().revalidating).toBe(true);
    expect(studentIds()).toEqual(["c1"]);

    finish(dbWithStudents(["c1", "c2"]));
    const res = await pending;
    expect(res.kind).toBe("fresh");
    expect(studentIds()).toEqual(["c1", "c2"]);
    expect(useData.getState().revalidating).toBe(false);
  });

  it("modification locale pendant la revalidation : GARDE le travail (keep-local)", async () => {
    cachedDb = dbWithStudents(["c1"]);
    let finish!: (value: unknown) => void;
    deferredNetwork = new Promise((resolve) => {
      finish = resolve;
    });
    const pending = useData.getState().boot("user-1");

    // Laisser le cache se peindre (lecture du snapshot + rendu) AVANT d'éditer,
    // pour simuler une saisie faite pendant que la revalidation réseau est en vol.
    await new Promise((r) => setTimeout(r, 10));
    expect(studentIds()).toEqual(["c1"]);

    // L'utilisateur ajoute c2 PENDANT que le réseau répond encore.
    useData.setState({
      students: [...(useData.getState().students as object[]), { id: "c2", name: "c2" }],
    } as never);

    // Le réseau ne connaît encore que c1 (l'écriture n'a pas abouti côté serveur).
    finish(dbWithStudents(["c1"]));
    const res = await pending;

    expect(res.kind).toBe("keep-local");
    // Le c2 ajouté n'est PAS perdu au remplacement.
    expect(studentIds().sort()).toEqual(["c1", "c2"]);
    if (res.kind === "keep-local") {
      // La référence renvoyée est le cache peint (sans c2) : c'est contre elle que
      // le miroir écrira l'ajout de l'utilisateur.
      expect((res.baseline.students as { id: string }[]).map((s) => s.id)).toEqual(["c1"]);
    }
    expect(useData.getState().revalidating).toBe(false);
  });

  it("réseau injoignable AVEC cache : lecture seule (cache-only), hors-ligne", async () => {
    cachedDb = dbWithStudents(["c1"]);
    failNetwork = true;
    const res = await useData.getState().boot("user-1");
    expect(res.kind).toBe("cache-only");
    // Le cache reste affiché et lisible.
    expect(useData.getState().loaded).toBe(true);
    expect(studentIds()).toEqual(["c1"]);
    expect(useData.getState().offline).toBe(true);
    expect(useData.getState().revalidating).toBe(false);
  });

  it("réseau injoignable SANS cache : écran d'erreur (failed)", async () => {
    failNetwork = true;
    const res = await useData.getState().boot("user-1");
    expect(res.kind).toBe("failed");
    expect(useData.getState().loaded).toBe(false);
    expect(useData.getState().loadStatus).toBe("error");
  });

  it("revalidate() retente sur la donnée affichée et adopte le frais quand il revient", async () => {
    cachedDb = dbWithStudents(["c1"]);
    failNetwork = true;
    const first = await useData.getState().boot("user-1");
    expect(first.kind).toBe("cache-only");

    // Le réseau revient.
    failNetwork = false;
    networkDb = dbWithStudents(["c1", "c2", "c3"]);
    const retry = await useData.getState().revalidate();
    expect(retry.kind).toBe("fresh");
    expect(studentIds()).toEqual(["c1", "c2", "c3"]);
    expect(useData.getState().offline).toBe(false);
  });
});
