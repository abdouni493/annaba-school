import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Robustesse du chargement initial (`lib/supabase/load.ts`) :
 *  - une requête qui ne répond jamais est ABANDONNÉE au bout d'un délai, et
 *    remonte en `LoadTimeoutError` au lieu de laisser le login tourner à vide ;
 *  - une annulation (déconnexion / changement de compte) arrête les requêtes en
 *    vol et remonte en `LoadCancelledError`, jamais comme un échec affiché ;
 *  - une panne transitoire est RÉESSAYÉE puis finit par réussir ;
 *  - chaque table lue est MESURÉE (durée, lignes, octets) — le diagnostic qui
 *    dit si le démarrage est lent, bloqué, ou jamais lancé.
 */

interface RunCtx {
  from: number;
  to: number;
  signal?: AbortSignal;
  attempt: number;
}
type Behavior = (ctx: RunCtx) => Promise<{ data: unknown; error: unknown; count?: number | null }>;

let behaviors: Record<string, Behavior>;
const callCounts: Record<string, number> = {};

function defaultResult() {
  return { data: [], error: null, count: 0 };
}

/** A hung request that only ever settles by rejecting when its signal aborts —
 *  exactly how a real fetch behaves when the socket is cancelled. */
function hangUntilAbort(signal?: AbortSignal): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    const fail = () => reject(new DOMException("aborted", "AbortError"));
    if (signal?.aborted) return fail();
    signal?.addEventListener("abort", fail, { once: true });
  });
}

function makeBuilder(table: string) {
  let signal: AbortSignal | undefined;
  let from = 0;
  let to = 0;
  const exec = () => {
    const attempt = (callCounts[table] = (callCounts[table] ?? 0) + 1);
    const behavior = behaviors[table];
    return Promise.resolve(behavior ? behavior({ from, to, signal, attempt }) : defaultResult());
  };
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    abortSignal: (s: AbortSignal) => {
      signal = s;
      return builder;
    },
    range: (f: number, t: number) => {
      from = f;
      to = t;
      return exec();
    },
    maybeSingle: () => exec(),
  };
  return builder;
}

vi.mock("@/lib/supabase/client", () => ({
  supabase: () => ({ from: (table: string) => makeBuilder(table) }),
}));

import {
  loadDatabase,
  getLastLoadDiagnostics,
  LoadTimeoutError,
  LoadCancelledError,
} from "@/lib/supabase/load";
import { TABLES, COLLECTION_ORDER } from "@/lib/supabase/tables";

beforeEach(() => {
  behaviors = {};
  for (const k of Object.keys(callCounts)) delete callCounts[k];
  // Keep the diagnostics console output out of the test log.
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  // console.table may be undefined in some runtimes.
  if (typeof console.table === "function") {
    vi.spyOn(console, "table").mockImplementation(() => {});
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("chargement initial — robustesse", () => {
  it("abandonne une requête qui ne répond jamais et remonte un LoadTimeoutError", async () => {
    behaviors = { [TABLES.attendance.table]: ({ signal }) => hangUntilAbort(signal) };
    await expect(loadDatabase({ timeoutMs: 20 })).rejects.toBeInstanceOf(LoadTimeoutError);
    // La table bloquée a bien été retentée plusieurs fois avant d'abandonner.
    expect(callCounts[TABLES.attendance.table]).toBeGreaterThan(1);
  });

  it("annule proprement les requêtes en vol (LoadCancelledError), sans les traiter comme un échec", async () => {
    behaviors = { [TABLES.attendance.table]: ({ signal }) => hangUntilAbort(signal) };
    const ac = new AbortController();
    const pending = loadDatabase({ signal: ac.signal, timeoutMs: 5000 });
    setTimeout(() => ac.abort(), 20);
    await expect(pending).rejects.toBeInstanceOf(LoadCancelledError);
  });

  it("n'initie aucune requête si le chargement est déjà annulé", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(loadDatabase({ signal: ac.signal })).rejects.toBeInstanceOf(LoadCancelledError);
    // Rien n'a été lu : l'annulation est vérifiée avant toute requête.
    expect(Object.keys(callCounts)).toHaveLength(0);
  });

  it("réessaie une panne transitoire puis réussit", async () => {
    behaviors = {
      [TABLES.students.table]: ({ attempt }) =>
        attempt < 2
          ? Promise.reject(new Error("Failed to fetch"))
          : Promise.resolve({ data: [{ id: "s1" }], error: null, count: 1 }),
    };
    const db = await loadDatabase({ timeoutMs: 1000 });
    expect(db.students).toEqual([{ id: "s1" }]);
    expect(callCounts[TABLES.students.table]).toBe(2); // 1 échec + 1 réussite
    const diag = getLastLoadDiagnostics();
    const students = diag?.tables.find((t) => t.table === TABLES.students.table);
    expect(students?.status).toBe("success");
    expect(students?.rows).toBe(1);
  });

  it("mesure chaque table lue : lignes, statut et total", async () => {
    behaviors = {
      [TABLES.students.table]: () =>
        Promise.resolve({ data: [{ id: "s1" }, { id: "s2" }], error: null, count: 2 }),
      [TABLES.teachers.table]: () => Promise.resolve({ data: [{ id: "t1" }], error: null, count: 1 }),
    };
    const db = await loadDatabase();
    expect(db.students).toHaveLength(2);

    const diag = getLastLoadDiagnostics();
    expect(diag).not.toBeNull();
    // Toutes les collections sont mesurées (une entrée par collection).
    expect(diag?.tables).toHaveLength(COLLECTION_ORDER.length);
    expect(diag?.totalRows).toBe(3);
    const students = diag?.tables.find((t) => t.table === TABLES.students.table);
    expect(students?.rows).toBe(2);
    expect(students?.status).toBe("success");
    expect(typeof students?.ms).toBe("number");
  });

  it("une table absente est mesurée comme 'missing' sans faire échouer le chargement", async () => {
    behaviors = {
      [TABLES.students.table]: () =>
        Promise.resolve({ data: null, error: { code: "PGRST205", message: "not found" } }),
    };
    const db = await loadDatabase();
    expect(db.students).toEqual([]);
    const diag = getLastLoadDiagnostics();
    const students = diag?.tables.find((t) => t.table === TABLES.students.table);
    expect(students?.status).toBe("missing");
  });
});
