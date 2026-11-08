import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * REPRISE DU MIROIR APRÈS UN AFFICHAGE « CACHE D'ABORD » (`resumeSyncFrom`).
 *
 * Quand l'utilisateur a modifié le magasin pendant la revalidation réseau, on
 * reprend l'écriture en prenant le CACHE peint pour référence, puis on écrit
 * aussitôt la différence. Ce test fige la sûreté :
 *  - rien à écrire si l'affiché est identique au cache (aucune réécriture des
 *    lignes simplement LUES) ;
 *  - un ajout local part en upsert ;
 *  - une suppression RÉELLE part en delete ;
 *  - les modifications ultérieures continuent d'être mirroir-ées normalement.
 */

interface DeleteCall {
  table: string;
  ids: string[];
}
interface UpsertCall {
  table: string;
  rows: Record<string, unknown>[];
}

const deletes: DeleteCall[] = [];
const upserts: UpsertCall[] = [];

vi.mock("@/lib/supabase/client", () => ({
  supabase: () => ({
    from: (table: string) => ({
      upsert: (rows: Record<string, unknown>[]) => {
        upserts.push({ table, rows });
        return Promise.resolve({ error: null });
      },
      delete: () => ({
        in: (_col: string, ids: string[]) => {
          deletes.push({ table, ids });
          return Promise.resolve({ error: null });
        },
      }),
    }),
  }),
}));

import { useData } from "@/lib/store/data";
import { startSync, stopSync, resumeSyncFrom, syncSettled } from "@/lib/supabase/sync";
import { emptyDatabase } from "@/lib/supabase/load";
import type { Database } from "@/lib/store/data";

function cacheWith(ids: string[]): Database {
  const db = emptyDatabase();
  (db as unknown as Record<string, unknown>).students = ids.map((id) => ({ id, name: id }));
  return db;
}

beforeEach(() => {
  stopSync();
  useData.getState().reset();
  deletes.length = 0;
  upserts.length = 0;
});

afterEach(() => {
  stopSync();
});

describe("resumeSyncFrom — reprise cache d'abord", () => {
  it("n'écrit RIEN quand l'affiché est identique au cache (lignes seulement lues)", async () => {
    const cache = cacheWith(["c1"]);
    // Le magasin montre le même contenu. En production, la référence est TOUJOURS
    // celle du magasin (le cache peint) : on l'aligne ici (même `school`, contenu
    // identique) pour refléter ce cas réel.
    useData.setState({ school: cache.school, students: [{ id: "c1", name: "c1" }] } as never);
    startSync();
    resumeSyncFrom(cache);
    await syncSettled();
    expect(upserts).toHaveLength(0);
    expect(deletes).toHaveLength(0);
  });

  it("écrit (upsert) un ajout local fait pendant la revalidation, sans aucune suppression", async () => {
    const cache = cacheWith(["c1"]);
    useData.setState({
      students: [
        { id: "c1", name: "c1" },
        { id: "c2", name: "c2" },
      ],
    } as never);
    startSync();
    resumeSyncFrom(cache);
    await syncSettled();
    expect(upserts.some((u) => u.table === "students" && u.rows.some((r) => r.id === "c2"))).toBe(
      true,
    );
    expect(deletes).toHaveLength(0);
  });

  it("supprime (delete) une ligne RÉELLEMENT retirée par l'utilisateur", async () => {
    const cache = cacheWith(["c1", "c2"]);
    useData.setState({ students: [{ id: "c1", name: "c1" }] } as never); // c2 retiré sciemment
    startSync();
    resumeSyncFrom(cache);
    await syncSettled();
    expect(deletes.some((d) => d.table === "students" && d.ids.includes("c2"))).toBe(true);
  });

  it("après la reprise, une modification ultérieure est mirroir-ée normalement", async () => {
    const cache = cacheWith(["c1"]);
    useData.setState({ students: [{ id: "c1", name: "c1" }] } as never);
    startSync();
    resumeSyncFrom(cache);
    await syncSettled();
    upserts.length = 0;

    useData.setState({
      students: [
        { id: "c1", name: "c1" },
        { id: "c9", name: "c9" },
      ],
    } as never);
    await syncSettled();
    expect(upserts.some((u) => u.rows.some((r) => r.id === "c9"))).toBe(true);
  });
});
