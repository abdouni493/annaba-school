"use client";

import { useData, type Database } from "@/lib/store/data";
import { useToast } from "@/lib/store/toast";
import { supabase } from "@/lib/supabase/client";
import {
  COLLECTION_ORDER,
  SCHOOL_SPEC,
  TABLES,
  pkOf,
  toRow,
  type TableSpec,
} from "@/lib/supabase/tables";

/**
 * Write-through persistence.
 *
 * Every screen of the app mutates the same Zustand store, whether through the
 * plain `push` / `updateItem` / `deleteFrom` helpers or through the big domain
 * actions (`scanCard`, `setPresence`, `payTeacherSessions`, …) that rewrite six
 * collections at once. Rather than teaching each of those ~35 actions to talk
 * to Postgres, this module watches the store and mirrors whatever changed.
 *
 * That means a button only has to do what it already did — the row it added,
 * edited or removed reaches Supabase by itself, and no action can be forgotten.
 *
 * Writes are queued, so they reach the database in the order the user produced
 * them. Deletes run child-table-first and inserts parent-table-first, so a
 * foreign key is never left dangling mid-flush.
 */

type Row = Record<string, unknown>;

let started = false;
let unsubscribe: (() => void) | null = null;
/** While paused, store changes are absorbed into the baseline instead of being
 *  written back — used when the store is being FILLED from the database. */
let paused = true;
let previous: Database | null = null;
/** Serialises the flushes so they land in the order they were produced. */
let queue: Promise<void> = Promise.resolve();
/** A pending background retry of the tables that failed to write. */
let retryTimer: ReturnType<typeof setTimeout> | null = null;
/** How many background retries have run since the last full success. */
let retryAttempts = 0;
/** Backoff between background retries (ms). The last delay repeats. */
const RETRY_DELAYS = [3000, 6000, 12000, 20000, 30000];

function snapshot(db: Database): Database {
  const copy = { school: db.school } as Database;
  for (const key of COLLECTION_ORDER) {
    (copy as unknown as Record<string, unknown>)[key] = (db as unknown as Record<string, unknown>)[key];
  }
  return copy;
}

interface Change {
  /** the store collection key (or "__school__") — what a failure rolls back */
  key: string;
  spec: TableSpec;
  upserts: Row[];
  deletes: string[];
}

/** What changed in one collection between two store states. */
function diffCollection(key: string, spec: TableSpec, before: Row[], after: Row[]): Change | null {
  const prevById = new Map<string, Row>();
  for (const item of before) prevById.set(pkOf(spec, item), item);

  const upserts: Row[] = [];
  const seen = new Set<string>();

  for (const item of after) {
    const id = pkOf(spec, item);
    seen.add(id);
    const prev = prevById.get(id);
    // Mutations always rebuild the object, so a shared reference means
    // "untouched" — the JSON compare below only guards the rebuild-in-place
    // cases and keeps identical writes off the wire.
    if (prev === item) continue;
    if (prev && JSON.stringify(toRow(spec, prev)) === JSON.stringify(toRow(spec, item))) continue;
    upserts.push(toRow(spec, item));
  }

  const deletes: string[] = [];
  for (const id of prevById.keys()) if (!seen.has(id)) deletes.push(id);

  if (!upserts.length && !deletes.length) return null;
  return { key, spec, upserts, deletes };
}

/** Marker key for the establishment singleton, which has no collection. */
const SCHOOL_KEY = "__school__";

/**
 * NE PRÉVENIR QU'UNE FOIS PAR TABLE.
 *
 * Une écriture qui échoue est réessayée en boucle (voir le miroir plus bas).
 * Sans garde-fou, chaque tentative afficherait une bulle d'erreur : on ne
 * prévient donc qu'à la PREMIÈRE défaillance d'une table, et on efface la marque
 * dès qu'elle repasse — la réussite suivante sait alors qu'elle a rattrapé.
 */
const notified = new Set<string>();

function report(key: string, label: string, message: string) {
  console.error(`[supabase] ${label}: ${message}`);
  if (notified.has(key)) return;
  notified.add(key);
  useToast.getState().addToast({
    type: "danger",
    title: "Enregistrement en attente",
    message: `${label} — ${message}. Nouvelle tentative automatique…`,
  });
}

/**
 * ÉCRIRE UN LOT, ET NE PAS TOUT PERDRE POUR UNE SEULE LIGNE.
 *
 * Un `upsert` groupé échoue EN ENTIER si une seule de ses lignes cloche. On
 * réessaie alors ligne par ligne : les bonnes passent, seule la mauvaise reste
 * en échec — au lieu de perdre tout le lot (et les élèves qu'il contenait).
 */
async function upsertRows(spec: TableSpec, rows: Row[]): Promise<string | null> {
  const first = await supabase().from(spec.table).upsert(rows, { onConflict: spec.pk });
  if (!first.error) return null;
  if (rows.length <= 1) return first.error.message;

  let lastError: string | null = null;
  for (const row of rows) {
    const { error } = await supabase().from(spec.table).upsert([row], { onConflict: spec.pk });
    if (error) lastError = error.message;
  }
  return lastError; // null quand toutes les lignes sont finalement passées
}

/**
 * Envoie à Postgres tout ce qui a changé, et RENVOIE LES CLÉS RESTÉES EN ÉCHEC.
 *
 * Le miroir se sert de ce retour pour ne PAS avancer sa base de référence sur
 * les tables qui n'ont pas abouti : leurs lignes seront donc renvoyées à la
 * prochaine occasion, et une création (un élève, par exemple) finit toujours
 * par atteindre la base au lieu de disparaître au rechargement.
 */
async function flush(before: Database, after: Database): Promise<Set<string>> {
  const failed = new Set<string>();
  const changes: Change[] = [];
  for (const key of COLLECTION_ORDER) {
    const spec = TABLES[key];
    const prevList = (before as unknown as Record<string, unknown>)[key] as Row[] | undefined;
    const nextList = (after as unknown as Record<string, unknown>)[key] as Row[] | undefined;
    if (!prevList || !nextList || prevList === nextList) continue;
    const change = diffCollection(key, spec, prevList, nextList);
    if (change) changes.push(change);
  }

  // Deletes first, deepest table first: a row is always gone before whatever
  // it pointed at.
  for (const change of [...changes].reverse()) {
    if (!change.deletes.length) continue;
    const { error } = await supabase()
      .from(change.spec.table)
      .delete()
      .in(change.spec.pk, change.deletes);
    if (error) {
      report(change.key, change.spec.table, error.message);
      failed.add(change.key);
    }
  }

  // Then the inserts and updates, parent tables first.
  for (const change of changes) {
    if (!change.upserts.length) continue;
    const message = await upsertRows(change.spec, change.upserts);
    if (message) {
      report(change.key, change.spec.table, message);
      failed.add(change.key);
    } else {
      notified.delete(change.key);
    }
  }

  // The establishment is a single row, not a collection.
  if (before.school !== after.school) {
    const { error } = await supabase()
      .from(SCHOOL_SPEC.table)
      .upsert(toRow(SCHOOL_SPEC, after.school as unknown as Row), { onConflict: "id" });
    if (error) {
      report(SCHOOL_KEY, "schools", error.message);
      failed.add(SCHOOL_KEY);
    } else {
      notified.delete(SCHOOL_KEY);
    }
  }

  return failed;
}

/**
 * ENQUEUE UN ENVOI, ET RATTRAPE CE QUI A ÉCHOUÉ.
 *
 * Après le flush, on RECULE la base de référence sur les tables restées en
 * échec (`previous[key] = before[key]`) : le prochain diff les renverra donc,
 * telles qu'elles sont dans le magasin. Et pour ne pas dépendre d'une action de
 * l'utilisateur, on programme aussi un rattrapage en arrière-plan. Une création
 * finit ainsi toujours par atteindre la base — au lieu de vivre dans l'écran
 * puis de disparaître au rechargement.
 */
function runFlush(before: Database, next: Database) {
  queue = queue
    .then(() => flush(before, next))
    .then((failed) => {
      if (!failed.size) {
        retryAttempts = 0;
        return;
      }
      // Ne pas avancer la référence sur ce qui n'a pas abouti : on rejoue depuis
      // l'état d'AVANT pour cette table, la prochaine fois. Les upserts étant
      // idempotents, réécrire une ligne déjà passée ne coûte rien.
      if (previous) {
        for (const key of failed) {
          if (key === SCHOOL_KEY) {
            previous.school = before.school;
          } else {
            (previous as unknown as Record<string, unknown>)[key] = (
              before as unknown as Record<string, unknown>
            )[key];
          }
        }
      }
      scheduleRetry();
    })
    .catch((err) => {
      report("synchronisation", "synchronisation", err instanceof Error ? err.message : String(err));
      scheduleRetry();
    });
}

/** Programme un rattrapage des tables en échec, avec un délai qui s'allonge. */
function scheduleRetry() {
  if (retryTimer || paused || !started) return;
  const delay = RETRY_DELAYS[Math.min(retryAttempts, RETRY_DELAYS.length - 1)];
  retryAttempts += 1;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (paused || !started) return;
    const before = previous;
    const next = snapshot(useData.getState());
    previous = next;
    if (!before) return;
    runFlush(before, next);
  }, delay);
}

/**
 * Starts mirroring the store to Supabase. Called once the user is signed in —
 * before that, row-level security would refuse every write anyway.
 */
export function startSync() {
  if (started) return;
  started = true;
  previous = snapshot(useData.getState());

  unsubscribe = useData.subscribe((state) => {
    const next = snapshot(state);
    const before = previous;
    previous = next;
    if (paused || !before) return;
    runFlush(before, next);
  });
}

export function stopSync() {
  unsubscribe?.();
  unsubscribe = null;
  started = false;
  paused = true;
  previous = null;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  retryAttempts = 0;
  notified.clear();
}

/** Suspends write-back while the store is being loaded or reset. */
export function pauseSync() {
  paused = true;
}

/** Resumes write-back, taking the current store state as the new baseline so
 *  the rows that were just READ are never written straight back. */
export function resumeSync() {
  previous = snapshot(useData.getState());
  paused = false;
}

/** Resolves once every queued write has reached the database. */
export function syncSettled(): Promise<void> {
  return queue;
}
