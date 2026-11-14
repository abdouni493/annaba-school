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

let inFlight: Promise<number> | null = null;
const lastBySession = new Map<string, number>();
/** Une même feuille n'est pas relue plus d'une fois toutes les N ms. */
const SESSION_THROTTLE_MS = 15_000;

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

async function refreshAttendance(
  where: { column: string; op: "eq" | "gte"; value: string }[],
  inScope: (r: Row) => boolean,
): Promise<number> {
  // Miroir arrêté (hors-ligne, relecture complète en cours) : la relecture
  // complète s'en chargera — on ne superpose pas deux lectures.
  if (!syncRunning() || useData.getState().revalidating || !useData.getState().loaded) return 0;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return 0;
  // Laisser partir les écritures en vol AVANT de lire : la lecture les inclut.
  await syncSettled();
  const before = useData.getState().attendance as unknown as Row[];
  const idleAtStart = syncIdle();
  let rows: Row[];
  try {
    const raw = await loadRowsWhere("attendance", where, { timeoutMs: 15_000 });
    rows = raw.map((r) => fromRow(TABLES.attendance, r));
  } catch (err) {
    if (!(err instanceof LoadCancelledError)) console.warn("[supabase] rafraîchissement des présences", err);
    return 0;
  }
  if (!syncRunning() || useData.getState().revalidating) return 0;
  let changes = 0;
  absorbExternal(() => {
    changes = absorbServerRows("attendance", rows, {
      before,
      inScope,
      // Ne retirer une ligne absente du serveur que si AUCUNE écriture n'était
      // en vol ni en attente, au début comme à la fin de la lecture.
      allowDeletes: idleAtStart && syncIdle(),
    });
  });
  return changes;
}

function serialize(task: () => Promise<number>): Promise<number> {
  const run = (inFlight ?? Promise.resolve(0)).catch(() => 0).then(task);
  inFlight = run.finally(() => {
    if (inFlight === run) inFlight = null;
  });
  return run;
}

/** Relit toutes les présences d'un groupe (emploi du temps). */
export function refreshSessionAttendance(sessionId: string, force = false): Promise<number> {
  const now = Date.now();
  if (!force && now - (lastBySession.get(sessionId) ?? 0) < SESSION_THROTTLE_MS) return Promise.resolve(0);
  lastBySession.set(sessionId, now);
  return serialize(() =>
    refreshAttendance([{ column: "session_id", op: "eq", value: sessionId }], (r) => r.sessionId === sessionId),
  );
}

/** Relit les présences des `days` derniers jours, tous groupes confondus. */
export function refreshRecentAttendance(days = 7): Promise<number> {
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
