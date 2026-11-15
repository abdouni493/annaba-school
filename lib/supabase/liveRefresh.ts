"use client";

import { absorbServerRows, useData } from "@/lib/store/data";
import { loadRowsWhere, LoadCancelledError } from "@/lib/supabase/load";
import { absorbExternal, syncIdle, syncRunning, syncSettled } from "@/lib/supabase/sync";
import { fromRow, TABLES } from "@/lib/supabase/tables";

/**
 * LES PRÉSENCES SAISIES SUR UN AUTRE POSTE, VUES ICI SANS RECHARGER.
 *
 * La base n'était lue qu'au démarrage. Une application restée ouverte depuis la
 * veille (le cas d'un poste d'accueil) ne voyait donc JAMAIS les présences
 * pointées depuis par l'enseignant ou un autre travailleur sur son téléphone :
 * la feuille du groupe affichait 0 présent alors que l'appel avait été fait.
 *
 * Ce module relit, de façon CIBLÉE et légère, les présences :
 *  - d'un groupe, à l'ouverture de sa feuille de présence ;
 *  - des derniers jours, régulièrement en arrière-plan.
 * Les lignes lues sont adoptées sans jamais écraser une saisie locale (voir
 * `absorbServerRows`) et sans être renvoyées au serveur (`absorbExternal`).
 */

type Row = Record<string, unknown>;

let inFlight: Promise<RefreshResult> | null = null;
const lastBySession = new Map<string, number>();
/** Une même feuille n'est pas relue plus d'une fois toutes les N ms. */
const SESSION_THROTTLE_MS = 15_000;

/** A local calendar day, converted to a half-open UTC interval (DST safe). */
function dayBounds(day: string): [string, string] {
  const start = new Date(`${day}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return [start.toISOString(), end.toISOString()];
}
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

let generation = 0;
let controller = new AbortController();
const requests = new Map<string, Promise<RefreshResult>>();
const interests = new Map<symbol, { sessionId?: string; day: string }>();

/** Account boundary: abort old reads and invalidate queued completions. */
export function resetAttendanceRefresh() {
  generation += 1;
  controller.abort();
  controller = new AbortController();
  inFlight = null;
  requests.clear();
  lastBySession.clear();
}

/** Only mounted attendance consumers request background freshness. */
export function watchAttendance(day: string, sessionId?: string): () => void {
  const key = Symbol();
  interests.set(key, { day, sessionId });
  return () => { interests.delete(key); };
}

export async function refreshActiveAttendance(): Promise<RefreshResult[]> {
  const scopes = [...interests.values()];
  const unique = new Map(scopes.map((scope) => [`${scope.day}|${scope.sessionId ?? "*"}`, scope]));
  return Promise.all([...unique.values()]
    .filter((s) => !s.sessionId || !unique.has(`${s.day}|*`))
    .map((s) => refreshDayAttendance(s.day, s.sessionId, true)));
}

export interface RefreshResult {
  ok: boolean;
  /** lignes ajoutées / mises à jour / retirées */
  changes: number;
  /** lignes lues sur le serveur */
  read: number;
  error?: string;
}

async function refreshAttendance(
  where: { column: string; op: "eq" | "gte" | "lt"; value: string }[],
  inScope: (r: Row) => boolean,
): Promise<RefreshResult> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { ok: false, changes: 0, read: 0, error: "Pas de connexion Internet" };
  }
  // Never park a focused screen behind a 90-second global load. The next
  // focus/poll retries the same scope. Failed/pending writes must not be adopted
  // as confirmed server rows, even if the write queue itself has settled.
  if (useData.getState().revalidating || !useData.getState().loaded || !syncRunning()) {
    return { ok: false, changes: 0, read: 0, error: "Chargement ou synchronisation en cours" };
  }
  const epoch = generation;
  const signal = controller.signal;
  if (!syncIdle()) await syncSettled();
  if (epoch !== generation || !syncIdle()) return { ok: false, changes: 0, read: 0 };
  const before = useData.getState().attendance as unknown as Row[];
  const idleAtStart = syncIdle();
  let rows: Row[];
  try {
    const raw = await loadRowsWhere("attendance", where, { timeoutMs: 20_000, signal });
    rows = raw.map((r) => fromRow(TABLES.attendance, r));
  } catch (err) {
    if (err instanceof LoadCancelledError) return { ok: false, changes: 0, read: 0 };
    console.warn("[supabase] rafraîchissement des présences", err);
    return { ok: false, changes: 0, read: 0, error: err instanceof Error ? err.message : String(err) };
  }
  // Une relecture complète a démarré pendant la nôtre : elle fait foi.
  if (epoch !== generation || useData.getState().revalidating || !syncIdle()) {
    return { ok: false, changes: 0, read: rows.length };
  }
  let changes = 0;
  absorbExternal(() => {
    changes = absorbServerRows("attendance", rows, {
      before,
      inScope,
      // Ne retirer une ligne absente du serveur que si le miroir tourne et
      // qu'AUCUNE écriture n'était en vol ni en attente, au début comme à la fin.
      allowDeletes: idleAtStart && syncIdle(),
    });
  });
  return { ok: true, changes, read: rows.length };
}

function serialize(task: () => Promise<RefreshResult>): Promise<RefreshResult> {
  const epoch = generation;
  const run = (inFlight ?? Promise.resolve(null))
    .catch(() => null)
    .then(() => epoch === generation ? task() : { ok: false, changes: 0, read: 0 });
  // The queue entry and the identity tested in cleanup MUST be the same promise.
  const entry = run.finally(() => {
    if (inFlight === entry) inFlight = null;
  });
  inFlight = entry;
  return entry;
}

function refreshDayAttendance(day: string, sessionId?: string, force = false): Promise<RefreshResult> {
  const key = `${day}|${sessionId ?? "*"}`;
  const pending = requests.get(key);
  if (pending) return pending;
  if (!force && Date.now() - (lastBySession.get(key) ?? 0) < SESSION_THROTTLE_MS) {
    return Promise.resolve({ ok: true, changes: 0, read: 0 });
  }
  const [start, end] = dayBounds(day);
  const where: { column: string; op: "eq" | "gte" | "lt"; value: string }[] = [
    { column: "occurred_at", op: "gte", value: start },
    { column: "occurred_at", op: "lt", value: end },
  ];
  if (sessionId) where.push({ column: "session_id", op: "eq", value: sessionId });
  const epoch = generation;
  const entry = serialize(() => refreshAttendance(where, (r) =>
    (!sessionId || r.sessionId === sessionId) && typeof r.timestamp === "string" &&
    r.timestamp >= start && r.timestamp < end,
  )).then((result) => {
    if (epoch === generation && result.ok) lastBySession.set(key, Date.now());
    return result;
  }).finally(() => {
    if (requests.get(key) === entry) requests.delete(key);
  });
  requests.set(key, entry);
  return entry;
}

/** Refresh the displayed day, never the session's entire history. */
export function refreshSessionAttendance(sessionId: string, force = false, day = today()): Promise<RefreshResult> {
  return refreshDayAttendance(day, sessionId, force);
}

/** Compatibility entry point: a background poll only needs today's marks. */
export function refreshRecentAttendance(): Promise<RefreshResult> {
  if (inFlight) return Promise.resolve({ ok: true, changes: 0, read: 0 });
  return refreshDayAttendance(today(), undefined, true);
}
