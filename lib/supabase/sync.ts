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

function snapshot(db: Database): Database {
  const copy = { school: db.school } as Database;
  for (const key of COLLECTION_ORDER) {
    (copy as unknown as Record<string, unknown>)[key] = (db as unknown as Record<string, unknown>)[key];
  }
  return copy;
}

interface Change {
  spec: TableSpec;
  upserts: Row[];
  deletes: string[];
}

/** What changed in one collection between two store states. */
function diffCollection(spec: TableSpec, before: Row[], after: Row[]): Change | null {
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
  return { spec, upserts, deletes };
}

function report(label: string, message: string) {
  console.error(`[supabase] ${label}: ${message}`);
  useToast.getState().addToast({
    type: "danger",
    title: "Enregistrement impossible",
    message: `${label} — ${message}`,
  });
}

async function flush(before: Database, after: Database): Promise<void> {
  const changes: Change[] = [];
  for (const key of COLLECTION_ORDER) {
    const spec = TABLES[key];
    const prevList = (before as unknown as Record<string, unknown>)[key] as Row[] | undefined;
    const nextList = (after as unknown as Record<string, unknown>)[key] as Row[] | undefined;
    if (!prevList || !nextList || prevList === nextList) continue;
    const change = diffCollection(spec, prevList, nextList);
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
    if (error) report(change.spec.table, error.message);
  }

  // Then the inserts and updates, parent tables first.
  for (const change of changes) {
    if (!change.upserts.length) continue;
    const { error } = await supabase()
      .from(change.spec.table)
      .upsert(change.upserts, { onConflict: change.spec.pk });
    if (error) report(change.spec.table, error.message);
  }

  // The establishment is a single row, not a collection.
  if (before.school !== after.school) {
    const { error } = await supabase()
      .from(SCHOOL_SPEC.table)
      .upsert(toRow(SCHOOL_SPEC, after.school as unknown as Row), { onConflict: "id" });
    if (error) report("schools", error.message);
  }
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
    queue = queue.then(() => flush(before, next)).catch((err) => {
      report("synchronisation", err instanceof Error ? err.message : String(err));
    });
  });
}

export function stopSync() {
  unsubscribe?.();
  unsubscribe = null;
  started = false;
  paused = true;
  previous = null;
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
