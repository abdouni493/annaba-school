import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * `fetchAll()` ne doit JAMAIS faire passer un échec de lecture pour un succès.
 *
 * Avant correctif, une erreur de chargement posait quand même `loaded = true` :
 * l'application affichait une base VIDE comme si tout allait bien, et l'école
 * croyait ses élèves disparus. On vérifie ici la machine d'état explicite
 * (idle → loading → success | error) et le fait que `loaded` ne vaut `true`
 * qu'après un vrai succès.
 */

let shouldFail = false;
const emptyDb = {
  school: { id: "school", name: "École", description: "", phone: "", email: "", address: "" },
};

vi.mock("@/lib/supabase/load", async () => {
  const actual = await vi.importActual<typeof import("@/lib/supabase/load")>(
    "@/lib/supabase/load",
  );
  return {
    ...actual,
    loadDatabase: async () => {
      if (shouldFail) throw new Error("permission denied");
      return { ...actual.emptyDatabase() };
    },
    loadSchool: async () => emptyDb.school,
  };
});

// Le store de toast est inoffensif en environnement node ; on le laisse réel.
import { useData } from "@/lib/store/data";

beforeEach(() => {
  shouldFail = false;
  useData.getState().reset();
});

describe("fetchAll — état de chargement", () => {
  it("part de 'idle' et n'est pas marqué chargé", () => {
    expect(useData.getState().loadStatus).toBe("idle");
    expect(useData.getState().loaded).toBe(false);
  });

  it("passe à 'success' et loaded=true après une lecture réussie", async () => {
    await useData.getState().fetchAll();
    expect(useData.getState().loadStatus).toBe("success");
    expect(useData.getState().loaded).toBe(true);
  });

  it("passe à 'error' et NE marque PAS loaded après un échec", async () => {
    shouldFail = true;
    await useData.getState().fetchAll();
    expect(useData.getState().loadStatus).toBe("error");
    // Le point crucial : un échec ne doit jamais ressembler à une base vide chargée.
    expect(useData.getState().loaded).toBe(false);
  });
});
