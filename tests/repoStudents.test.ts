import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Couche d'accès « élèves » (lib/repo/students.ts) — fondation de la lecture à
 * la demande. On vérifie :
 *   • projection de colonnes (pas de SELECT *) ;
 *   • tri stable (last_name, first_name, id) ;
 *   • PAS de count exact ;
 *   • pagination par clé (demande pageSize+1, renvoie un curseur tant qu'il reste) ;
 *   • propagation d'erreur.
 */

interface Captured {
  table?: string;
  select?: string;
  countOpt?: unknown;
  orders: string[];
  limit?: number;
  filters: string[];
}

let captured: Captured;
let resultRows: Record<string, unknown>[];
let resultError: { message: string } | null;

function makeBuilder() {
  const b: Record<string, unknown> = {};
  Object.assign(b, {
    select: (cols: string, opts?: unknown) => {
      captured.select = cols;
      captured.countOpt = opts;
      return b;
    },
    order: (col: string) => {
      captured.orders.push(col);
      return b;
    },
    limit: (n: number) => {
      captured.limit = n;
      return b;
    },
    eq: (col: string, v: unknown) => {
      captured.filters.push(`eq:${col}=${v}`);
      return b;
    },
    or: (expr: string) => {
      captured.filters.push(`or:${expr}`);
      return b;
    },
    abortSignal: () => b,
    maybeSingle: async () => ({ data: resultRows[0] ?? null, error: resultError }),
    then: (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: resultRows, error: resultError }).then(resolve),
  });
  return b;
}

vi.mock("@/lib/supabase/client", () => ({
  supabase: () => ({
    from: (table: string) => {
      captured.table = table;
      return makeBuilder();
    },
  }),
}));

import { listStudents, getStudent } from "@/lib/repo/students";

beforeEach(() => {
  captured = { orders: [], filters: [] };
  resultRows = [];
  resultError = null;
});

function makeRows(n: number): Record<string, unknown>[] {
  return Array.from({ length: n }, (_, i) => ({
    id: String(i).padStart(4, "0"),
    first_name: `Prenom${i}`,
    last_name: `Nom${String(i).padStart(4, "0")}`,
    phone: "",
    rfid: "",
    enrollment_level: "1AP",
    enrollment_year: "2026",
    parent_id: null,
    registration_number: null,
  }));
}

describe("repo/students — listStudents", () => {
  it("projette des colonnes précises et NE compte PAS la table", async () => {
    resultRows = makeRows(5);
    await listStudents({ pageSize: 30 });
    expect(captured.table).toBe("students");
    expect(captured.select).not.toContain("*");
    expect(captured.select).toContain("first_name");
    expect(captured.select).toContain("last_name");
    // Aucun count demandé (pas de 2e argument { count }).
    expect(captured.countOpt).toBeUndefined();
  });

  it("trie de façon stable sur (last_name, first_name, id)", async () => {
    resultRows = makeRows(3);
    await listStudents();
    expect(captured.orders).toEqual(["last_name", "first_name", "id"]);
  });

  it("demande pageSize+1 et renvoie un curseur tant qu'il reste des pages", async () => {
    // 31 lignes pour pageSize 30 => il reste une page.
    resultRows = makeRows(31);
    const page = await listStudents({ pageSize: 30 });
    expect(captured.limit).toBe(31);
    expect(page.items).toHaveLength(30); // la ligne « sentinelle » est retirée
    expect(page.nextCursor).not.toBeNull();
    expect(page.nextCursor).toMatchObject({ id: expect.any(String) });
  });

  it("renvoie nextCursor=null quand la dernière page est atteinte", async () => {
    resultRows = makeRows(10); // < pageSize+1
    const page = await listStudents({ pageSize: 30 });
    expect(page.items).toHaveLength(10);
    expect(page.nextCursor).toBeNull();
  });

  it("applique un filtre de recherche par préfixe (OR nom/prénom)", async () => {
    resultRows = makeRows(2);
    await listStudents({ search: "dup" });
    expect(captured.filters.some((f) => f.startsWith("or:") && /ilike/.test(f))).toBe(true);
  });

  it("ajoute la condition keyset quand un curseur est fourni", async () => {
    resultRows = makeRows(2);
    await listStudents({ cursor: { lastName: "Nom0005", firstName: "Prenom5", id: "0005" } });
    const keyset = captured.filters.find((f) => f.includes("last_name.gt"));
    expect(keyset).toBeTruthy();
  });

  it("propage une erreur de lecture", async () => {
    resultError = { message: "permission denied" };
    await expect(listStudents()).rejects.toThrow(/permission denied/);
  });
});

describe("repo/students — getStudent", () => {
  it("lit une fiche par id et renvoie null si absente", async () => {
    resultRows = [];
    const s = await getStudent("x");
    expect(s).toBeNull();
    expect(captured.filters).toContain("eq:id=x");
  });
});
