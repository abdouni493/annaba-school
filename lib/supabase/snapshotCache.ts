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
/** Une ligne par COLLECTION (voir « ÉCRIRE SEULEMENT CE QUI A CHANGÉ »). */
const CHUNKS = "chunks";
const DB_VERSION = 2;

/**
 * Version de la FORME de l'instantané. À incrémenter si la structure de
 * `Database` change de façon incompatible — un ancien instantané est alors
 * ignoré (la lecture réseau le remplacera), plutôt que peint avec des champs
 * manquants. (La relecture tolère déjà les collections absentes, mais ce numéro
 * reste le filet de sécurité explicite.)
 *
 * La version 2 (instantané d'un seul bloc) reste LISIBLE : elle peut porter des
 * saisies hors-ligne pas encore envoyées, qu'il ne faut surtout pas perdre.
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
  /** Ancien format : l'état VIVANT entier (absent du format découpé). */
  db?: Database;
  /** Ancien format : la référence confirmée en base. */
  synced?: Database;
  /** Vrai s'il reste des écritures locales non confirmées en base. */
  dirty?: boolean;
  /** Format découpé : chaque collection vit dans `CHUNKS`. */
  chunked?: boolean;
  school?: Database["school"];
  syncedSchool?: Database["school"];
  hasSynced?: boolean;
  /** Collections du vivant (format découpé). */
  keys?: string[];
  /** Collections dont la référence confirmée a son propre bloc (sinon : identique au vivant). */
  syncedKeys?: string[];
}

interface StoredChunk {
  k: string;
  rows: unknown[];
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
 *  ou refusé — l'appelant retombe alors sur la lecture réseau. */
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
      if (!db.objectStoreNames.contains(CHUNKS)) {
        db.createObjectStore(CHUNKS, { keyPath: "k" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

/** La base locale, ouverte UNE fois et réutilisée (l'ouvrir à chaque écriture
 *  coûtait un aller-retour inutile). */
let dbPromise: Promise<IDBDatabase | null> | null = null;
function getDB(): Promise<IDBDatabase | null> {
  if (!dbPromise) {
    dbPromise = openDB().then((db) => {
      if (!db) {
        dbPromise = null;
        return null;
      }
      db.onclose = () => {
        dbPromise = null;
      };
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      return db;
    });
  }
  return dbPromise;
}

/** Ne garde dans l'objet rangé QUE les collections (tableaux) : jamais les
 *  actions du store, qui ne sont pas clonables. */
function collectionsOf(db: Database): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  const anyDb = db as unknown as Record<string, unknown>;
  for (const key of Object.keys(anyDb)) {
    if (key === "school") continue;
    const value = anyDb[key];
    if (Array.isArray(value)) out[key] = value;
  }
  return out;
}

const chunkKey = (userId: string, side: "live" | "synced", coll: string) => `${userId}|${side}|${coll}`;

function requestAsPromise<T>(req: IDBRequest<T>): Promise<T | null> {
  return new Promise((resolve) => {
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => resolve(null);
  });
}

/**
 * Relit l'instantané d'un compte. Résout `null` (jamais d'exception) s'il n'y
 * en a pas, s'il est trop vieux, d'un autre schéma, ou si IndexedDB est
 * indisponible.
 */
export async function readSnapshot(userId: string): Promise<CachedSnapshot | null> {
  if (!userId) return null;
  try {
    const idb = await getDB();
    if (!idb) return null;
    let tx: IDBTransaction;
    try {
      tx = idb.transaction([STORE, CHUNKS], "readonly");
    } catch {
      return null;
    }
    const manifest = await requestAsPromise(tx.objectStore(STORE).get(userId) as IDBRequest<StoredSnapshot>);
    if (!manifest) return null;
    if (manifest.schemaVersion !== SCHEMA_VERSION) return null;
    if (Date.now() - manifest.savedAt > MAX_AGE_MS) return null;

    if (!manifest.chunked) {
      // Ancien format d'un seul bloc.
      if (!manifest.db || typeof manifest.db !== "object") return null;
      return {
        db: manifest.db,
        synced: manifest.synced && typeof manifest.synced === "object" ? manifest.synced : undefined,
        dirty: manifest.dirty === true,
        savedAt: manifest.savedAt,
      };
    }

    const range = IDBKeyRange.bound(`${userId}|`, `${userId}|\uffff`);
    const chunks = (await requestAsPromise(tx.objectStore(CHUNKS).getAll(range) as IDBRequest<StoredChunk[]>)) ?? [];
    const byKey = new Map<string, unknown[]>();
    for (const c of chunks) byKey.set(c.k, c.rows);

    const db = { school: manifest.school } as unknown as Record<string, unknown>;
    for (const coll of manifest.keys ?? []) {
      const rows = byKey.get(chunkKey(userId, "live", coll));
      if (!rows) return null; // instantané incomplet : on préfère relire le réseau
      db[coll] = rows;
    }
    let synced: Record<string, unknown> | undefined;
    if (manifest.hasSynced) {
      synced = { school: manifest.syncedSchool ?? manifest.school };
      const own = new Set(manifest.syncedKeys ?? []);
      for (const coll of manifest.keys ?? []) {
        const rows = own.has(coll) ? byKey.get(chunkKey(userId, "synced", coll)) : db[coll];
        if (!rows) return null;
        synced[coll] = rows;
      }
    }
    // Ces tableaux vont être peints tels quels : tant que le magasin les garde,
    // inutile de les réécrire.
    if (lastWrittenUser !== userId) {
      lastWritten.clear();
      lastWrittenUser = userId;
    }
    for (const [k, rows] of byKey) lastWritten.set(k, rows);
    return {
      db: db as unknown as Database,
      synced: synced as unknown as Database | undefined,
      dirty: manifest.dirty === true,
      savedAt: manifest.savedAt,
    };
  } catch {
    return null;
  }
}

/**
 * ÉCRIRE SEULEMENT CE QUI A CHANGÉ.
 *
 * Avant, CHAQUE saisie (un versement, une présence, un clic) recopiait TOUTE la
 * base — des dizaines de milliers de présences — dans IndexedDB. Ce clonage se
 * fait sur le fil principal : l'application « ramait » après chaque action.
 *
 * L'instantané est désormais découpé par collection. Le magasin reconstruisant
 * toujours le tableau d'une collection modifiée, une référence inchangée veut
 * dire « intacte » : on ne réécrit QUE les collections dont la référence a
 * changé depuis la dernière écriture. Un versement ne recopie plus que la
 * caisse et les versements, pas l'historique des présences.
 */
const lastWritten = new Map<string, unknown[]>();
let lastWrittenUser: string | null = null;
let writeChain: Promise<void> = Promise.resolve();
let pendingWrite: { userId: string; db: Database; synced?: Database; dirty: boolean } | null = null;
let writeScheduled = false;

export function writeSnapshot(
  userId: string,
  db: Database,
  opts: { synced?: Database; dirty?: boolean } = {},
): void {
  if (!userId || !hasIndexedDB()) return;
  // Seule la DERNIÈRE demande compte : des écritures rapprochées fusionnent.
  pendingWrite = { userId, db, synced: opts.synced, dirty: opts.dirty === true };
  if (writeScheduled) return;
  writeScheduled = true;
  scheduleIdle(() => {
    writeScheduled = false;
    const job = pendingWrite;
    pendingWrite = null;
    if (!job) return;
    writeChain = writeChain.then(() => doWrite(job)).catch(() => {});
  });
}

async function doWrite(job: { userId: string; db: Database; synced?: Database; dirty: boolean }): Promise<void> {
  try {
    const idb = await getDB();
    if (!idb) return;
    if (lastWrittenUser !== job.userId) {
      lastWritten.clear();
      lastWrittenUser = job.userId;
    }
    const live = collectionsOf(job.db);
    const syncedColls = job.synced ? collectionsOf(job.synced) : null;
    const keys = Object.keys(live);
    const syncedKeys: string[] = [];
    const puts: StoredChunk[] = [];
    const written: [string, unknown[]][] = [];

    for (const coll of keys) {
      const k = chunkKey(job.userId, "live", coll);
      if (lastWritten.get(k) !== live[coll]) {
        puts.push({ k, rows: live[coll] });
        written.push([k, live[coll]]);
      }
      const srows = syncedColls?.[coll];
      if (syncedColls && srows && srows !== live[coll]) {
        syncedKeys.push(coll);
        const sk = chunkKey(job.userId, "synced", coll);
        if (lastWritten.get(sk) !== srows) {
          puts.push({ k: sk, rows: srows });
          written.push([sk, srows]);
        }
      }
    }

    const manifest: StoredSnapshot = {
      userId: job.userId,
      savedAt: Date.now(),
      schemaVersion: SCHEMA_VERSION,
      chunked: true,
      school: job.db.school,
      syncedSchool: job.synced?.school,
      hasSynced: !!job.synced,
      keys,
      syncedKeys,
      dirty: job.dirty,
    };

    await new Promise<void>((resolve) => {
      let tx: IDBTransaction;
      try {
        tx = idb.transaction([STORE, CHUNKS], "readwrite");
      } catch {
        return resolve();
      }
      tx.oncomplete = () => {
        for (const [k, rows] of written) lastWritten.set(k, rows);
        resolve();
      };
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
      try {
        const chunks = tx.objectStore(CHUNKS);
        for (const c of puts) chunks.put(c);
        tx.objectStore(STORE).put(manifest);
      } catch {
        try {
          tx.abort();
        } catch {
          // ignore
        }
        resolve();
      }
    });
  } catch {
    // Un échec d'écriture du cache ne doit jamais remonter : l'application
    // fonctionne sans, elle relira simplement le réseau au prochain départ.
  }
}

/** Efface l'instantané d'un compte (déconnexion sur un poste partagé). */
export async function clearSnapshot(userId: string): Promise<void> {
  if (!userId || !hasIndexedDB()) return;
  try {
    const idb = await getDB();
    if (!idb) return;
    for (const k of Array.from(lastWritten.keys())) if (k.startsWith(`${userId}|`)) lastWritten.delete(k);
    await new Promise<void>((resolve) => {
      let tx: IDBTransaction;
      try {
        tx = idb.transaction([STORE, CHUNKS], "readwrite");
      } catch {
        return resolve();
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
      try {
        tx.objectStore(STORE).delete(userId);
        tx.objectStore(CHUNKS).delete(IDBKeyRange.bound(`${userId}|`, `${userId}|\uffff`));
      } catch {
        resolve();
      }
    });
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
