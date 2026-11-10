"use client";

/**
 * SNAPSHOT LOCAL DE LA BASE — le secret des applications « instantanées ».
 *
 * Les meilleures applications pleines de données (Linear, Notion, Figma…) ne
 * font jamais attendre l'utilisateur devant un écran de chargement au
 * rafraîchissement : elles gardent une COPIE LOCALE de ce qu'elles ont lu la
 * dernière fois et la ré-affichent AUSSITÔT, puis vérifient en arrière-plan si
 * le serveur a du neuf. C'est le motif « stale-while-revalidate ».
 *
 * Ce module est cette copie locale. Il écrit le dernier instantané RÉUSSI de la
 * base dans IndexedDB (et non `localStorage` : l'instantané pèse plusieurs Mo,
 * ce que `localStorage` ne supporte pas, et son écriture bloquerait le fil
 * principal). Au démarrage suivant, l'instantané est relu en quelques
 * millisecondes et peint tout de suite — l'écran « Chargement des données… »
 * disparaît. La lecture réseau complète continue en fond et remplace la copie
 * dès qu'elle aboutit.
 *
 * GARDE-FOUS :
 *  - Tout est enveloppé dans des `try/catch` : IndexedDB peut être absent
 *    (navigation privée, SSR) ou refusé. Dans ce cas le module ne fait RIEN et
 *    l'application retombe proprement sur l'ancien comportement (lecture réseau
 *    bloquante). Jamais d'exception propagée.
 *  - Chaque instantané est rangé sous l'identifiant du COMPTE : un élève ne lit
 *    jamais la copie d'un administrateur.
 *  - Un numéro de schéma invalide tout instantané d'une version antérieure dont
 *    la forme aurait changé.
 */

import type { Database } from "@/lib/store/data";

const DB_NAME = "altech-school-cache";
const STORE = "snapshots";
const DB_VERSION = 1;

/**
 * Version de la FORME de l'instantané. À incrémenter si la structure de
 * `Database` change de façon incompatible — un ancien instantané est alors
 * ignoré (la lecture réseau le remplacera), plutôt que peint avec des champs
 * manquants. (La relecture tolère déjà les collections absentes, mais ce numéro
 * reste le filet de sécurité explicite.)
 */
const SCHEMA_VERSION = 2;

/**
 * Au-delà de cet âge, l'instantané n'est plus peint — non pour la fraîcheur (la
 * revalidation réseau s'en charge), mais pour ne pas garder indéfiniment toute
 * la base d'une école sur un poste qui ne sert plus ce compte.
 */
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000; // 14 jours

interface StoredSnapshot {
  userId: string;
  savedAt: number;
  schemaVersion: number;
  /** L'état VIVANT affiché (peut contenir des écritures faites hors-ligne qui ne
   *  sont pas encore arrivées dans Postgres). */
  db: Database;
  /**
   * LA RÉFÉRENCE « DÉJÀ DANS POSTGRES ».
   *
   * Dernier état dont on a la CERTITUDE qu'il a été écrit en base. Comparé à `db`,
   * il révèle exactement les lignes créées/modifiées hors-ligne qui restent à
   * envoyer. Sans lui, un rechargement laissait le serveur (qui ignore ces
   * écritures) écraser la copie locale — et le versement ou la présence saisis
   * hors-ligne disparaissaient.
   */
  synced?: Database;
  /** Vrai s'il reste des écritures locales non confirmées en base. */
  dirty?: boolean;
}

export interface CachedSnapshot {
  db: Database;
  /** La référence confirmée en base, si connue (voir `StoredSnapshot.synced`). */
  synced?: Database;
  /** Vrai s'il reste des écritures locales non envoyées à la base. */
  dirty: boolean;
  savedAt: number;
}

function hasIndexedDB(): boolean {
  return typeof indexedDB !== "undefined" && indexedDB !== null;
}

/** Ouvre (ou crée) la base locale. Résout `null` si IndexedDB est indisponible
 *  ou refuse l'ouverture — l'appelant retombe alors sur le réseau. */
function openDB(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (!hasIndexedDB()) return resolve(null);
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      return resolve(null);
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "userId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

/** Ne garde dans l'objet rangé QUE les données (jamais les actions du store, qui
 *  ne sont pas clonables et feraient échouer l'écriture IndexedDB). */
function sanitizeForStore(db: Database): Database {
  const out = { school: db.school } as Database;
  const anyDb = db as unknown as Record<string, unknown>;
  for (const key of Object.keys(anyDb)) {
    if (key === "school") continue;
    const value = anyDb[key];
    if (Array.isArray(value)) {
      (out as unknown as Record<string, unknown>)[key] = value;
    }
  }
  return out;
}

/**
 * Lit l'instantané du compte, ou `null` si absent, trop vieux, de schéma
 * périmé, ou si IndexedDB est indisponible. Ne lève jamais.
 */
export async function readSnapshot(userId: string): Promise<CachedSnapshot | null> {
  if (!userId) return null;
  try {
    const db = await openDB();
    if (!db) return null;
    const snapshot = await new Promise<StoredSnapshot | null>((resolve) => {
      let tx: IDBTransaction;
      try {
        tx = db.transaction(STORE, "readonly");
      } catch {
        return resolve(null);
      }
      const req = tx.objectStore(STORE).get(userId);
      req.onsuccess = () => resolve((req.result as StoredSnapshot) ?? null);
      req.onerror = () => resolve(null);
    });
    db.close();
    if (!snapshot) return null;
    if (snapshot.schemaVersion !== SCHEMA_VERSION) return null;
    if (!snapshot.db || typeof snapshot.db !== "object") return null;
    if (Date.now() - snapshot.savedAt > MAX_AGE_MS) return null;
    return {
      db: snapshot.db,
      synced: snapshot.synced && typeof snapshot.synced === "object" ? snapshot.synced : undefined,
      dirty: snapshot.dirty === true,
      savedAt: snapshot.savedAt,
    };
  } catch {
    return null;
  }
}

/**
 * Range l'instantané du compte. Programmé en temps mort (`requestIdleCallback`)
 * pour ne jamais retarder un rendu : sérialiser plusieurs Mo n'a pas à peser sur
 * le clic qui vient de réussir. Ne lève jamais.
 */
export function writeSnapshot(
  userId: string,
  db: Database,
  opts: { synced?: Database; dirty?: boolean } = {},
): void {
  if (!userId || !hasIndexedDB()) return;
  const clean = sanitizeForStore(db);
  const syncedClean = opts.synced ? sanitizeForStore(opts.synced) : undefined;
  const dirty = opts.dirty === true;
  const run = () => {
    void (async () => {
      try {
        const idb = await openDB();
        if (!idb) return;
        const record: StoredSnapshot = {
          userId,
          savedAt: Date.now(),
          schemaVersion: SCHEMA_VERSION,
          db: clean,
          synced: syncedClean,
          dirty,
        };
        await new Promise<void>((resolve) => {
          let tx: IDBTransaction;
          try {
            tx = idb.transaction(STORE, "readwrite");
          } catch {
            return resolve();
          }
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
          tx.onabort = () => resolve();
          try {
            tx.objectStore(STORE).put(record);
          } catch {
            resolve();
          }
        });
        idb.close();
      } catch {
        // Un échec d'écriture du cache ne doit jamais remonter : l'application
        // fonctionne sans, elle relira simplement le réseau au prochain départ.
      }
    })();
  };
  scheduleIdle(run);
}

/** Efface l'instantané d'un compte (déconnexion sur un poste partagé). */
export async function clearSnapshot(userId: string): Promise<void> {
  if (!userId || !hasIndexedDB()) return;
  try {
    const idb = await openDB();
    if (!idb) return;
    await new Promise<void>((resolve) => {
      let tx: IDBTransaction;
      try {
        tx = idb.transaction(STORE, "readwrite");
      } catch {
        return resolve();
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
      try {
        tx.objectStore(STORE).delete(userId);
      } catch {
        resolve();
      }
    });
    idb.close();
  } catch {
    // ignore
  }
}

/** Exécute une tâche dès que le fil principal est libre, pour ne pas peser sur
 *  l'interaction en cours. */
function scheduleIdle(task: () => void): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  };
  if (typeof w.requestIdleCallback === "function") {
    w.requestIdleCallback(task, { timeout: 2000 });
  } else {
    setTimeout(task, 300);
  }
}
