import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * PAGES PROFONDES EN ÉCHEC → REPRISE PAR CURSEUR.
 *
 * Sur un gros historique de présences, une page lue par décalage profond peut
 * dépasser le délai de la base. Avant, TOUTE la table était abandonnée et
 * l'écran gardait une copie ancienne : les présences des semaines passées
 * n'apparaissaient plus. La lecture reprend désormais par clé (`id > dernier`)
 * et rend la table COMPLÈTE, sans doublon.
 */

let rows: { id: string }[] = [];
let failOffsetFrom = Infinity;
const calls: string[] = [];

function makeBuilder(table: string) {
  let gt: string | null = null;
  const builder: Record<string, unknown> = {};
  const sorted = () => [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  Object.assign(builder, {
    select: () => builder,
    eq: () => builder,
    abortSignal: () => builder,
    order: () => builder,
    gt: (_c: string, v: string) => {
      gt = v;
      return builder;
    },
    limit: (n: number) => {
      if (table !== "attendance_records") return Promise.resolve({ data: [], error: null });
      calls.push(`keyset>${gt}`);
      const after = sorted().filter((r) => gt === null || r.id > gt);
      return Promise.resolve({ data: after.slice(0, n), error: null, status: 200 });
    },
    range: (from: number, to: number) => {
      if (table !== "attendance_records") return Promise.resolve({ data: [], error: null, count: 0 });
      calls.push(`offset@${from}`);
      if (from >= failOffsetFrom) {
        return Promise.resolve({
          data: null,
          error: { code: "57014", message: "canceling statement due to statement timeout" },
          status: 500,
        });
      }
      return Promise.resolve({ data: sorted().slice(from, to + 1), error: null, count: rows.length, status: 200 });
    },
    maybeSingle: async () => ({ data: null, error: null }),
  });
  return builder;
}

vi.mock("@/lib/supabase/client", () => ({
  supabase: () => ({ from: (table: string) => makeBuilder(table) }),
}));

import { loadRowsWhere } from "@/lib/supabase/load";

beforeEach(() => {
  calls.length = 0;
  rows = Array.from({ length: 4500 }, (_, i) => ({ id: `att-${String(i).padStart(6, "0")}` }));
  failOffsetFrom = Infinity;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

describe("lecture d'une grosse table", () => {
  it("sans incident : pagination parallèle, table complète", async () => {
    const out = await loadRowsWhere("attendance", []);
    expect(out).toHaveLength(4500);
    expect(calls.some((c) => c.startsWith("keyset"))).toBe(false);
  });

  it("une page profonde en échec : reprise par curseur, table COMPLÈTE, sans doublon", async () => {
    failOffsetFrom = 2000;
    const out = await loadRowsWhere("attendance", [], { timeoutMs: 1000 });
    const ids = out.map((r) => r.id as string);
    expect(ids).toHaveLength(4500);
    expect(new Set(ids).size).toBe(4500);
    expect(ids[0]).toBe("att-000000");
    expect(ids[4499]).toBe("att-004499");
    expect(calls).toContain("keyset>att-001999");
  });
});
