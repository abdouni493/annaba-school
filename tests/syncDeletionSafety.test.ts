import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Garde-fou de synchronisation : UNE LIGNE ABSENTE N'EST PAS TOUJOURS UNE
 * SUPPRESSION.
 *
 * Le miroir (`lib/supabase/sync.ts`) déduit normalement qu'une ligne présente à
 * la base de référence mais absente du magasin a été supprimée, et l'efface de
 * Postgres. C'est correct quand le magasin contient la table ENTIÈRE — ce qui
 * est le cas aujourd'hui. Mais c'est le verrou à lever AVANT tout chargement
 * partiel : une collection déclarée « incomplète » ne doit JAMAIS être
 * supprimée par simple absence, sinon lire une partie des données effacerait le
 * reste. Ce test fige les deux comportements.
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
import {
  startSync,
  stopSync,
  resumeSync,
  syncSettled,
  setCollectionComplete,
  isCollectionComplete,
} from "@/lib/supabase/sync";

function seedCategory() {
  useData.setState({ classCategories: [{ id: "c1", name: "Cat" }] } as never);
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

describe("miroir — suppression par absence", () => {
  it("par défaut (collection complète), retirer une ligne du magasin la supprime en base", async () => {
    seedCategory();
    startSync();
    resumeSync(); // base de référence = magasin actuel (contient c1), writes actives
    useData.setState({ classCategories: [] } as never); // suppression réelle
    await syncSettled();
    expect(deletes.some((d) => d.table === "class_categories" && d.ids.includes("c1"))).toBe(true);
  });

  it("une collection déclarée INCOMPLÈTE n'est jamais supprimée par absence", async () => {
    seedCategory();
    startSync();
    resumeSync();
    setCollectionComplete("classCategories", false); // chargement partiel simulé
    useData.setState({ classCategories: [] } as never); // la ligne quitte la vue
    await syncSettled();
    expect(deletes.some((d) => d.table === "class_categories")).toBe(false);
  });

  it("une collection incomplète écrit quand même ses modifications (upsert), sans suppression", async () => {
    seedCategory();
    startSync();
    resumeSync();
    setCollectionComplete("classCategories", false);
    useData.setState({ classCategories: [{ id: "c1", name: "Renommé" }] } as never); // édition
    await syncSettled();
    expect(upserts.some((u) => u.table === "class_categories")).toBe(true);
    expect(deletes).toHaveLength(0);
  });

  it("toutes les collections sont complètes par défaut, et stopSync réinitialise l'état", () => {
    expect(isCollectionComplete("students")).toBe(true);
    setCollectionComplete("students", false);
    expect(isCollectionComplete("students")).toBe(false);
    stopSync();
    expect(isCollectionComplete("students")).toBe(true);
  });
});
