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
let deferredLoad: Promise<unknown> | null = null;
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
      if (deferredLoad) return deferredLoad;
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
  deferredLoad = null;
  useData.getState().reset();
});

describe("fetchAll — état de chargement", () => {
  it("part de 'idle' et n'est pas marqué chargé", () => {
    expect(useData.getState().loadStatus).toBe("idle");
    expect(useData.getState().loaded).toBe(false);
  });

  it("passe à 'success', loaded=true et renvoie true après une lecture réussie", async () => {
    const ok = await useData.getState().fetchAll();
    expect(ok).toBe(true);
    expect(useData.getState().loadStatus).toBe("success");
    expect(useData.getState().loaded).toBe(true);
  });

  it("ignore la réponse d'un ancien compte après déconnexion", async () => {
    let finish!: (value: unknown) => void;
    deferredLoad = new Promise((resolve) => { finish = resolve; });
    const pending = useData.getState().fetchAll();
    expect(useData.getState().loadStatus).toBe("loading");
    useData.getState().clear(); // simulated logout while request is in flight
    finish({ school: { id: "school", name: "Other account" }, students: [{ id: "other" }] });
    expect(await pending).toBe(false);
    expect(useData.getState().loaded).toBe(false);
    expect(useData.getState().loadStatus).toBe("idle");
    expect(useData.getState().students).toEqual([]);
  });

  it("ignore une ancienne réponse après le démarrage d'une nouvelle lecture", async () => {
    let finish!: (value: unknown) => void;
    deferredLoad = new Promise((resolve) => { finish = resolve; });
    const first = useData.getState().fetchAll();
    deferredLoad = null;
    const second = useData.getState().fetchAll();
    expect(await second).toBe(true);
    finish({ school: { id: "school", name: "Old account" }, students: [{ id: "old" }] });
    expect(await first).toBe(false);
    expect(useData.getState().loadStatus).toBe("success");
    expect(useData.getState().students).toEqual([]);
  });

  it("passe à 'error', NE marque PAS loaded et renvoie false après un échec", async () => {
    shouldFail = true;
    const ok = await useData.getState().fetchAll();
    // Contrat sur lequel SessionProvider s'appuie pour NE PAS reprendre la
    // synchronisation après un chargement raté (sinon le miroir écrirait un
    // état vide par-dessus la base).
    expect(ok).toBe(false);
    expect(useData.getState().loadStatus).toBe("error");
    // Le point crucial : un échec ne doit jamais ressembler à une base vide chargée.
    expect(useData.getState().loaded).toBe(false);
  });
});
