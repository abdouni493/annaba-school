import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * DURABILITÉ DES ÉCRITURES HORS-LIGNE — le versement et la présence saisis sans
 * réseau NE DOIVENT JAMAIS disparaître.
 *
 * Le symptôme signalé : hors-ligne, l'utilisateur crée un versement (la facture
 * s'imprime), ou pointe des présences. Plus tard, à la vérification, la ligne
 * n'existait pas — ni en base, ni à l'écran après rechargement. Cause : la
 * saisie vivait en mémoire seule (miroir en pause, copie locale non mise à
 * jour), et au retour du réseau le serveur — qui l'ignorait — écrasait l'écran.
 *
 * Ces tests figent la correction :
 *  - la copie locale rangée hors-ligne porte le drapeau « reste à envoyer »
 *    ET la référence confirmée en base, pour reconnaître la saisie non envoyée ;
 *  - au redémarrage, réseau revenu, la saisie hors-ligne est CONSERVÉE à l'écran
 *    et renvoyée (keep-local) au lieu d'être perdue ;
 *  - l'ajout d'un autre poste (présent côté serveur, absent de la copie locale)
 *    est tout de même adopté : la fusion ne supprime jamais rien.
 */

interface WriteCall {
  userId: string;
  dirty: boolean;
  liveStudents: string[];
  syncedStudents: string[] | null;
}

let cached: { db: Record<string, unknown>; synced?: Record<string, unknown>; dirty: boolean } | null =
  null;
let networkDb: Record<string, unknown> | null = null;
let failNetwork = false;
const writes: WriteCall[] = [];

vi.mock("@/lib/supabase/snapshotCache", () => ({
  readSnapshot: async () => cached,
  writeSnapshot: (
    userId: string,
    db: Record<string, unknown>,
    opts: { synced?: Record<string, unknown>; dirty?: boolean } = {},
  ) => {
    writes.push({
      userId,
      dirty: opts.dirty === true,
      liveStudents: ((db.students as { id: string }[]) ?? []).map((s) => s.id),
      syncedStudents: opts.synced
        ? ((opts.synced.students as { id: string }[]) ?? []).map((s) => s.id)
        : null,
    });
  },
  clearSnapshot: async () => {},
}));

vi.mock("@/lib/supabase/load", async () => {
  const actual = await vi.importActual<typeof import("@/lib/supabase/load")>("@/lib/supabase/load");
  return {
    ...actual,
    loadDatabase: async () => {
      if (failNetwork) throw new Error("réseau indisponible");
      return networkDb ?? actual.emptyDatabase();
    },
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

import { useData, setCurrentActor } from "@/lib/store/data";
import { emptyDatabase } from "@/lib/supabase/load";

function dbWithStudents(ids: string[]): Record<string, unknown> {
  const db = emptyDatabase() as unknown as Record<string, unknown>;
  db.students = ids.map((id) => ({ id, name: id }));
  return db;
}
function studentIds(): string[] {
  return (useData.getState().students as { id: string }[]).map((s) => s.id).sort();
}

beforeEach(() => {
  cached = null;
  networkDb = null;
  failNetwork = false;
  writes.length = 0;
  useData.getState().reset();
  // En production, le compte connecté est déposé avant le démarrage : la copie
  // locale est rangée sous son identifiant.
  setCurrentActor({ id: "user-1", name: "Réception", role: "reception" });
});

describe("durabilité hors-ligne — aucune saisie perdue", () => {
  it("une saisie hors-ligne présente dans la copie locale (dirty) est CONSERVÉE et renvoyée au retour du réseau", async () => {
    // Copie locale rangée hors-ligne : elle contient le versement/l'élève "p-offline"
    // que la base NE CONNAÎT PAS encore ; la référence confirmée était ["a"].
    cached = {
      db: dbWithStudents(["a", "p-offline"]),
      synced: dbWithStudents(["a"]),
      dirty: true,
    };
    // Réseau revenu, mais le serveur ignore toujours la saisie hors-ligne.
    networkDb = dbWithStudents(["a"]);

    const res = await useData.getState().boot("user-1");

    // La saisie hors-ligne n'est PAS écrasée par le serveur : on garde le local
    // et on le renvoie (keep-local), la référence d'écriture étant la donnée fraîche.
    expect(res.kind).toBe("keep-local");
    expect(studentIds()).toEqual(["a", "p-offline"]);
    if (res.kind === "keep-local") {
      expect((res.baseline.students as { id: string }[]).map((s) => s.id)).toEqual(["a"]);
    }
    expect(useData.getState().offline).toBe(false);
  });

  it("fusionne l'ajout d'un AUTRE poste (serveur) avec la saisie hors-ligne locale, sans rien supprimer", async () => {
    cached = {
      db: dbWithStudents(["a", "p-offline"]),
      synced: dbWithStudents(["a"]),
      dirty: true,
    };
    // Entre-temps, un autre poste a créé "b" côté serveur.
    networkDb = dbWithStudents(["a", "b"]);

    const res = await useData.getState().boot("user-1");

    expect(res.kind).toBe("keep-local");
    // Les deux coexistent : l'ajout distant "b" ET la saisie hors-ligne "p-offline".
    expect(studentIds()).toEqual(["a", "b", "p-offline"]);
  });

  it("copie locale PROPRE (rien en attente) : on adopte simplement le frais du serveur", async () => {
    cached = {
      db: dbWithStudents(["a", "b"]),
      synced: dbWithStudents(["a", "b"]),
      dirty: false,
    };
    networkDb = dbWithStudents(["a", "b", "c"]);

    const res = await useData.getState().boot("user-1");

    expect(res.kind).toBe("fresh");
    expect(studentIds()).toEqual(["a", "b", "c"]);
  });

  it("hors-ligne : une saisie faite après un boot cache-only est rangée dans la copie locale AVEC le drapeau « reste à envoyer »", async () => {
    cached = { db: dbWithStudents(["a"]), synced: dbWithStudents(["a"]), dirty: false };
    failNetwork = true; // base injoignable → boot cache-only, offline
    const res = await useData.getState().boot("user-1");
    expect(res.kind).toBe("cache-only");
    expect(useData.getState().offline).toBe(true);

    writes.length = 0;
    // L'utilisateur crée un élève/versement hors-ligne.
    useData.setState({
      students: [...(useData.getState().students as object[]), { id: "p-offline", name: "p" }],
    } as never);
    // La persistance est différée (~350 ms) : on la laisse courir.
    await new Promise((r) => setTimeout(r, 450));

    const persisted = writes.find((w) => w.liveStudents.includes("p-offline"));
    expect(persisted).toBeTruthy();
    // Rangée « à envoyer », avec la référence confirmée d'avant la saisie.
    expect(persisted!.dirty).toBe(true);
    expect(persisted!.syncedStudents).toEqual(["a"]);
  });
});
