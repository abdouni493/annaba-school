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

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export interface RefreshResult {
  ok: boolean;
  /** lignes ajoutées / mises à jour / retirées */
  changes: number;
  /** lignes lues sur le serveur */
  read: number;
  error?: string;
}

/** Attend la fin d'une relecture complète en cours (au plus `maxMs`). */
function untilNotRevalidating(maxMs: number): Promise<boolean> {
  if (!useData.getState().revalidating) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      unsub();
      resolve(false);
    }, maxMs);
    const unsub = useData.subscribe((st) => {
      if (st.revalidating) return;
      clearTimeout(timer);
      unsub();
      resolve(true);
    });
  });
}

async function refreshAttendance(
  where: { column: string; op: "eq" | "gte"; value: string }[],
  inScope: (r: Row) => boolean,
): Promise<RefreshResult> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { ok: false, changes: 0, read: 0, error: "Pas de connexion Internet" };
  }
  // Une relecture complète en cours : on la laisse finir, PUIS on relit — la
  // feuille ouverte pendant le démarrage reçoit quand même ses présences.
  if (!(await untilNotRevalidating(90_000))) {
    return { ok: false, changes: 0, read: 0, error: "Chargement de la base encore en cours" };
  }
  if (!useData.getState().loaded) return { ok: false, changes: 0, read: 0, error: "Base non chargée" };
  // Laisser partir les écritures en vol AVANT de lire : la lecture les inclut.
  if (syncRunning()) await syncSettled();
  const before = useData.getState().attendance as unknown as Row[];
  const idleAtStart = syncIdle();
  let rows: Row[];
  try {
    const raw = await loadRowsWhere("attendance", where, { timeoutMs: 20_000 });
    rows = raw.map((r) => fromRow(TABLES.attendance, r));
  } catch (err) {
    if (err instanceof LoadCancelledError) return { ok: false, changes: 0, read: 0 };
    console.warn("[supabase] rafraîchissement des présences", err);
    return { ok: false, changes: 0, read: 0, error: err instanceof Error ? err.message : String(err) };
  }
  // Une relecture complète a démarré pendant la nôtre : elle fait foi.
  if (useData.getState().revalidating) return { ok: true, changes: 0, read: rows.length };
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
  const run = (inFlight ?? Promise.resolve(null))
    .catch(() => null)
    .then(task);
  inFlight = run.finally(() => {
    if (inFlight === run) inFlight = null;
  });
  return run;
}

/** Relit toutes les présences d'un groupe (emploi du temps). `force` ignore
 *  la limite de fréquence (bouton « Actualiser »). */
export async function refreshSessionAttendance(sessionId: string, force = false): Promise<RefreshResult> {
  const now = Date.now();
  if (!force && now - (lastBySession.get(sessionId) ?? 0) < SESSION_THROTTLE_MS) {
    return { ok: true, changes: 0, read: 0 };
  }
  const res = await serialize(() =>
    refreshAttendance([{ column: "session_id", op: "eq", value: sessionId }], (r) => r.sessionId === sessionId),
  );
  // Seule une relecture RÉUSSIE compte pour la limite : un échec se retente.
  if (res.ok) lastBySession.set(sessionId, Date.now());
  return res;
}

/** Relit les présences des `days` derniers jours, tous groupes confondus. */
export function refreshRecentAttendance(days = 7): Promise<RefreshResult> {
  // Pas de relecture de fond pendant qu'une autre lecture tourne déjà.
  if (inFlight || useData.getState().revalidating) return Promise.resolve({ ok: true, changes: 0, read: 0 });
  const since = isoDaysAgo(days);
  // Marge d'un jour pour les retraits : une ligne tout au bord de la fenêtre
  // (fuseau, format d'heure) n'est jamais retirée sur un doute de comparaison.
  const safe = isoDaysAgo(Math.max(0, days - 1));
  return serialize(() =>
    refreshAttendance([{ column: "occurred_at", op: "gte", value: since }], (r) =>
      typeof r.timestamp === "string" ? r.timestamp >= safe : false,
    ),
  );
}
