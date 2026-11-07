import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Garde-fous du chargement initial (`lib/supabase/load.ts`) :
 *  - la pagination par offset demande un ORDRE STABLE (sur la clé primaire),
 *    sans quoi une insertion concurrente duplique ou escamote des lignes ;
 *  - une grosse table est bien reconstituée page par page, dans l'ordre ;
 *  - une table encore absente (script SQL non exécuté) rend une liste vide au
 *    lieu de faire tomber tout le chargement ;
 *  - une vraie erreur de lecture (droits, réseau) remonte, elle, en exception.
 */

/** Jeu de données simulé par table, et journal des requêtes observées. */
interface Scenario {
  rows: Record<string, Record<string, unknown>[]>;
  /** code d'erreur à renvoyer pour une table donnée, le cas échéant */
  errorFor?: Record<string, { code?: string; message: string }>;
}

let scenario: Scenario;
const orderedColumns: string[] = [];

/** Fabrique un faux « query builder » PostgREST chaînable et thenable. */
function makeBuilder(table: string) {
  let orderCol: string | null = null;
  const builder: Record<string, unknown> = {};

  const run = (from: number, to: number) => {
    const err = scenario.errorFor?.[table];
    if (err) return { data: null, count: null, error: err };
    const all = scenario.rows[table] ?? [];
    // Le code trie sur la clé primaire ; on respecte l'ordre demandé.
    const sorted = orderCol
      ? [...all].sort((a, b) =>
          String(a[orderCol as string]).localeCompare(String(b[orderCol as string])),
        )
      : all;
    return { data: sorted.slice(from, to + 1), count: all.length, error: null };
  };

  Object.assign(builder, {
    select: () => builder,
    eq: () => builder,
    maybeSingle: async () => ({ data: null, error: null }),
    order: (col: string) => {
      orderCol = col;
      orderedColumns.push(`${table}:${col}`);
      return builder;
    },
    range: (from: number, to: number) => Promise.resolve(run(from, to)),
  });
  return builder;
}

vi.mock("@/lib/supabase/client", () => ({
  supabase: () => ({ from: (table: string) => makeBuilder(table) }),
}));

import { loadDatabase } from "@/lib/supabase/load";
import { COLLECTION_ORDER, TABLES } from "@/lib/supabase/tables";

beforeEach(() => {
  scenario = { rows: {} };
  orderedColumns.length = 0;
});

describe("chargement initial — pagination", () => {
  it("demande un ordre stable sur la clé primaire pour chaque table lue", async () => {
    await loadDatabase();
    // Chaque collection doit avoir été triée sur SA clé primaire.
    for (const key of COLLECTION_ORDER) {
      const spec = TABLES[key];
      expect(
        orderedColumns.includes(`${spec.table}:${spec.pk}`),
        `${spec.table} doit être lue avec .order(${spec.pk})`,
      ).toBe(true);
    }
  });

  it("reconstitue une grosse table page par page, dans l'ordre", async () => {
    const studentsSpec = TABLES.students;
    // 2500 lignes => 3 pages de 1000 ; identifiants volontairement mélangés.
    const n = 2500;
    const ids = Array.from({ length: n }, (_, i) => String(i).padStart(5, "0"));
    // On insère dans le désordre pour prouver que l'ordre vient du tri, pas de l'insertion.
    const shuffled = [...ids].reverse();
    scenario.rows[studentsSpec.table] = shuffled.map((id) => ({ id, name: `E${id}` }));

    const db = await loadDatabase();
    const loaded = db.students as Array<{ id: string }>;
    expect(loaded).toHaveLength(n);
    const loadedIds = loaded.map((s) => s.id);
    expect(loadedIds).toEqual(ids); // ordre stable, aucune perte, aucun doublon
    expect(new Set(loadedIds).size).toBe(n);
  });

  it("une table absente rend une liste vide sans faire échouer le reste", async () => {
    scenario.errorFor = {
      [TABLES.students.table]: { code: "42P01", message: "relation does not exist" },
    };
    scenario.rows[TABLES.teachers.table] = [{ id: "t1", name: "Prof" }];

    const db = await loadDatabase();
    expect(db.students).toEqual([]);
    // Les autres tables se chargent normalement.
    expect(db.teachers).toHaveLength(1);
  });

  it("une erreur de lecture réelle (droits/réseau) remonte en exception", async () => {
    scenario.errorFor = {
      [TABLES.students.table]: { code: "42501", message: "permission denied" },
    };
    await expect(loadDatabase()).rejects.toThrow(/permission denied/);
  });
});
