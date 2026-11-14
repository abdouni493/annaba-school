"use client";

import { supabase } from "@/lib/supabase/client";
import {
  COLLECTION_ORDER,
  SCHOOL_ID,
  SCHOOL_SPEC,
  TABLES,
  fromRow,
  type CollectionKey,
} from "@/lib/supabase/tables";
import type { Database } from "@/lib/store/data";
import type { School } from "@/lib/types";

/** PostgREST caps a response at 1000 rows; big tables are read page by page. */
const PAGE = 1000;
/** Taille d'une page lue par curseur (reprise après une page profonde en échec). */
const KEYSET_PAGE = 1000;

/**
 * Nombre maximum de pages réclamées EN MÊME TEMPS sur une grosse table.
 *
 * `Promise.all` sans borne ouvrait autant de connexions que de pages restantes
 * (50 000 présences = 50 requêtes d'un coup) : le navigateur plafonne les
 * connexions par domaine, le pool PostgREST sature, et les requêtes excédentaires
 * attendent en file de toute façon. Une fenêtre bornée garde le parallélisme utile
 * sans saturer ni le navigateur ni la base.
 */
const PAGE_CONCURRENCY = 6;
/** Limit simultaneous table hydrations too. Supabase sert en HTTP/2 (flux
 *  multiplexés sur une seule connexion), donc ouvrir plus de lectures en même
 *  temps recouvre les allers-retours au lieu de les mettre en file — net gain
 *  sur un réseau mobile à latence élevée, sans saturer le navigateur. */
const TABLE_CONCURRENCY = 10;

/**
 * A single PostgREST request is given this long before it is aborted.
 *
 * Without a ceiling, a hung socket (flaky mobile network, a server that accepts
 * the connection but never answers) left the whole login spinning for ever —
 * the exact "stuck on « Chargement des données… »" symptom. A bounded request
 * fails cleanly, is retried, and ultimately surfaces as a `timeout` state the
 * user can retry, instead of an infinite spinner.
 */
const REQUEST_TIMEOUT_MS = 20_000;
/** Transient failures (timeout, network blip) are retried a few times with a
 *  short growing delay before the table — and thus the whole load — is failed. */
const MAX_ATTEMPTS = 4;
const RETRY_BASE_MS = 500;

/** Exécute les tâches par vagues de `limit`, en préservant l'ordre des résultats. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await task(items[i]);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// Timeout, cancellation, retry and per-request diagnostics.
// ---------------------------------------------------------------------------

/** A read that exceeded REQUEST_TIMEOUT_MS. Distinct from a generic failure so
 *  the store can show a precise "timeout" state and offer an immediate retry. */
export class LoadTimeoutError extends Error {
  constructor(table: string, ms: number) {
    super(`${table} : délai de réponse dépassé (${ms} ms)`);
    this.name = "LoadTimeoutError";
  }
}

/** The load was cancelled on purpose (logout / account switch). Never shown to
 *  the user as a failure — the caller simply drops the result. */
export class LoadCancelledError extends Error {
  constructor() {
    super("Chargement annulé");
    this.name = "LoadCancelledError";
  }
}

export type TableLoadStatus = "success" | "missing" | "timeout" | "error" | "cancelled";

/** One table's measured cost during a load — the per-request diagnostics the
 *  audit asked for: is startup slow (which table), stuck, or never initiated. */
export interface TableDiagnostic {
  table: string;
  status: TableLoadStatus;
  /** Wall-clock time this table took, in ms. */
  ms: number;
  /** Number of PostgREST round-trips (1 + extra pages). */
  pages: number;
  rows: number;
  /** Approximate transferred size, estimated from a JSON sample × row count. */
  approxBytes: number;
}

export interface LoadDiagnostics {
  tables: TableDiagnostic[];
  totalMs: number;
  totalRows: number;
  totalApproxBytes: number;
  slowestTable: string | null;
  startedAt: number;
}

export interface LoadOptions {
  /** External cancellation — aborted on logout / account switch so in-flight
   *  reads stop holding connections instead of merely being ignored. */
  signal?: AbortSignal;
  /** Called once per table with its measured cost. */
  onTableDiagnostic?: (d: TableDiagnostic) => void;
  /** Per-request timeout override (ms); mainly for tests. */
  timeoutMs?: number;
  /** Nombre de tentatives par requête (défaut : MAX_ATTEMPTS). */
  maxAttempts?: number;
}

function now(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new LoadCancelledError();
}

/** A cancellable delay — rejects immediately if the load is aborted mid-wait. */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new LoadCancelledError());
    const onAbort = () => {
      clearTimeout(timer);
      reject(new LoadCancelledError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Only transient faults are worth retrying; a permission error or a bad query
 *  will fail identically every time, so it is surfaced at once. */
function isTransient(err: unknown): boolean {
  if (err instanceof LoadTimeoutError) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /Failed to fetch|NetworkError|fetch failed|ECONNRESET|ETIMEDOUT|network|timeout|socket hang up/i.test(
    msg,
  );
}

interface QueryResult {
  data: unknown;
  error: { code?: string; message?: string } | null;
  count: number | null;
}

/**
 * LES ERREURS RENVOYÉES (ET NON LEVÉES) PAR SUPABASE.
 *
 * `supabase-js` ne LÈVE PAS d'exception sur une réponse HTTP en erreur : il rend
 * `{ error, status }`. Avant, seules les exceptions étaient réessayées — un 502
 * passager, un « statement timeout » ou un jeton de session expiré (onglet resté
 * ouvert, ordinateur sorti de veille) faisaient donc échouer AUSSITÔT la table,
 * puis toute la relecture, et l'application restait bloquée sur « Hors-ligne »
 * alors que le réseau allait très bien.
 */
function isTransientResult(status: number | undefined, error: { code?: string; message?: string }): boolean {
  if (status === 0) return true; // réponse coupée en route
  if (status === 408 || status === 425 || status === 429) return true;
  if (status !== undefined && status >= 500) return true;
  if (error.code === "57014") return true; // statement timeout
  return isAuthExpired(status, error);
}

/** Jeton d'accès expiré / invalide : un rafraîchissement de session suffit. */
function isAuthExpired(status: number | undefined, error: { code?: string; message?: string }): boolean {
  return (
    status === 401 ||
    error.code === "PGRST301" ||
    error.code === "PGRST303" ||
    /JWT|token.*expired/i.test(error.message ?? "")
  );
}

/** Rafraîchit la session (une seule fois à la fois, partagée entre requêtes). */
let refreshing: Promise<void> | null = null;
function refreshAuthSession(): Promise<void> {
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const auth = (supabase() as unknown as { auth?: { refreshSession?: () => Promise<unknown> } }).auth;
        await auth?.refreshSession?.();
      } catch {
        // Pas de session à rafraîchir : la tentative suivante dira ce qu'il en est.
      }
    })().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

/**
 * Runs ONE PostgREST request with a timeout, real cancellation and bounded
 * retry of transient failures. `build` receives the request's AbortSignal and
 * must return the configured PostgREST builder (a thenable) with
 * `.abortSignal(signal)` applied, so a timeout actually cancels the socket.
 */
async function runRequest(
  table: string,
  build: (signal: AbortSignal) => PromiseLike<{ data: unknown; error: unknown; count?: number | null }>,
  opts: LoadOptions,
): Promise<QueryResult> {
  const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;
  let attempt = 0;
  for (;;) {
    throwIfAborted(opts.signal);
    attempt += 1;
    const ac = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ac.abort();
    }, timeoutMs);
    const relayAbort = () => ac.abort();
    opts.signal?.addEventListener("abort", relayAbort, { once: true });
    try {
      const res = await build(ac.signal);
      const error = (res.error as { code?: string; message?: string } | null) ?? null;
      const status = (res as { status?: number }).status;
      if (error && attempt < (opts.maxAttempts ?? MAX_ATTEMPTS) && isTransientResult(status, error) && !isMissingTableError(error)) {
        if (isAuthExpired(status, error)) await refreshAuthSession();
        await delay(RETRY_BASE_MS * attempt, opts.signal);
        continue;
      }
      return {
        data: res.data ?? null,
        error,
        count: (res.count ?? null) as number | null,
      };
    } catch (err) {
      if (err instanceof LoadCancelledError) throw err;
      // A deliberate cancellation always wins over a coincident timeout.
      if (opts.signal?.aborted) throw new LoadCancelledError();
      const fault = timedOut ? new LoadTimeoutError(table, timeoutMs) : err;
      if (isTransient(fault) && attempt < (opts.maxAttempts ?? MAX_ATTEMPTS)) {
        await delay(RETRY_BASE_MS * attempt, opts.signal);
        continue;
      }
      throw fault;
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", relayAbort);
    }
  }
}

/** Cheap transfer-size estimate: measure a few rows and scale, so diagnostics
 *  never pay the cost of serialising 50 000 rows just to weigh them. */
function estimateBytes(rows: Record<string, unknown>[]): number {
  if (!rows.length) return 0;
  const sample = Math.min(rows.length, 20);
  let sampleBytes = 0;
  for (let i = 0; i < sample; i++) sampleBytes += JSON.stringify(rows[i]).length;
  return Math.round((sampleBytes / sample) * rows.length);
}

let lastDiagnostics: LoadDiagnostics | null = null;
/** The measured cost of the most recent `loadDatabase()` — exposed so the store
 *  and any debug screen can read "login took N ms, M rows, ~K Ko". */
export function getLastLoadDiagnostics(): LoadDiagnostics | null {
  return lastDiagnostics;
}

function logDiagnostics(d: LoadDiagnostics) {
  if (typeof console === "undefined") return;
  const kb = (n: number) => `${(n / 1024).toFixed(1)} Ko`;
  console.info(
    `[supabase] chargement: ${d.totalMs} ms · ${d.totalRows} lignes · ~${kb(d.totalApproxBytes)}` +
      (d.slowestTable ? ` · plus lente : ${d.slowestTable}` : ""),
  );
  if (typeof console.table === "function") {
    console.table(
      d.tables.map((t) => ({
        table: t.table,
        statut: t.status,
        ms: t.ms,
        pages: t.pages,
        lignes: t.rows,
        "~Ko": +(t.approxBytes / 1024).toFixed(1),
      })),
    );
  }
}

/**
 * LA TABLE N'EXISTE PAS ENCORE.
 *
 * Chaque mise à jour de l'application est livrée avec un script SQL que
 * l'école exécute elle-même. Entre le déploiement du code et l'exécution du
 * script, une table peut manquer — et une lecture qui échoue faisait tomber
 * TOUT le chargement : plus un élève, plus un emploi du temps, plus rien.
 *
 * Une table absente rend donc une liste vide, et le journal dit laquelle. Une
 * lecture refusée pour toute autre raison (droits, réseau) continue en revanche
 * de remonter : elle ne doit surtout pas passer pour « aucune donnée ».
 */
function isMissingTableError(error: { code?: string; message?: string }): boolean {
  return isMissingTable(error);
}

function isMissingTable(error: { code?: string; message?: string }): boolean {
  return (
    error.code === "42P01" ||           // Postgres : relation inexistante
    error.code === "PGRST205" ||        // PostgREST : table absente du schéma
    /does not exist|schema cache/i.test(error.message ?? "")
  );
}

/** Restreint une lecture (filtres PostgREST : `.eq`, `.gte`…). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type QueryFilter = (q: any) => any;

async function readAll(
  spec: (typeof TABLES)[CollectionKey],
  opts: LoadOptions = {},
  filter: QueryFilter = (q) => q,
): Promise<Record<string, unknown>[]> {
  const started = now();
  let pages = 0;
  let approxBytes = 0;
  const emit = (status: TableLoadStatus, rows: number) =>
    opts.onTableDiagnostic?.({
      table: spec.table,
      status,
      ms: Math.round(now() - started),
      pages,
      rows,
      approxBytes,
    });

  // LIRE UNE GROSSE TABLE EN UN SEUL ALLER-RETOUR, PAS QUINZE.
  //
  // PostgREST plafonne une réponse à 1000 lignes. Avant, les pages suivantes
  // étaient lues l'une APRÈS l'autre : 15 000 présences = 16 allers-retours en
  // file, et l'écran attendait la somme de toutes les latences. La première
  // page demande désormais le total exact (`count: "exact"`), ce qui permet de
  // réclamer TOUTES les pages restantes d'un coup, en parallèle — le temps de
  // chargement retombe à celui d'un seul aller-retour, pas de leur addition.
  // ORDRE STABLE OBLIGATOIRE POUR LA PAGINATION PAR OFFSET.
  //
  // Sans `order`, PostgREST ne garantit AUCUN ordre entre deux requêtes. Pendant
  // qu'on lit la base page par page, une insertion concurrente (un autre poste
  // qui enregistre une présence, un versement…) peut décaler les lignes : une
  // même ligne apparaît alors sur deux pages, ou disparaît entre deux `range`.
  // Trier sur la clé primaire — déjà indexée, car PRIMARY KEY — rend les
  // fenêtres déterministes : chaque ligne tombe dans exactement une page.
  let first: QueryResult;
  try {
    first = await runRequest(
      spec.table,
      (signal) =>
        filter(supabase()
          .from(spec.table)
          // `count: "estimated"` est INSTANTANÉ (tiré des statistiques Postgres,
          // AUCUN scan de table), là où `count: "exact"` forçait un scan complet
          // de CHAQUE table à chaque chargement — très coûteux sur une petite
          // instance. L'estimation ne sert qu'à paralléliser ; l'exactitude du
          // nombre de lignes est garantie par la boucle « jusqu'à une page
          // incomplète » plus bas, jamais par ce compte.
          .select("*", { count: "estimated" }))
          .abortSignal(signal)
          .order(spec.pk, { ascending: true })
          .range(0, PAGE - 1),
      opts,
    );
  } catch (err) {
    if (err instanceof LoadCancelledError) {
      emit("cancelled", 0);
      throw err;
    }
    emit(err instanceof LoadTimeoutError ? "timeout" : "error", 0);
    throw err instanceof LoadTimeoutError
      ? err
      : new Error(`${spec.table}: ${err instanceof Error ? err.message : String(err)}`);
  }
  pages = 1;
  if (first.error) {
    if (isMissingTable(first.error)) {
      console.warn(
        `[supabase] ${spec.table} est absente de la base — le script SQL de mise à jour ` +
          `n'a pas encore été exécuté. Cet écran restera vide en attendant.`,
      );
      emit("missing", 0);
      return [];
    }
    emit("error", 0);
    throw new Error(`${spec.table}: ${first.error.message}`);
  }

  const firstRows = (first.data ?? []) as Record<string, unknown>[];
  approxBytes += estimateBytes(firstRows);
  const out = firstRows.map((r) => fromRow(spec, r));
  // Une première page INCOMPLÈTE est la table entière : rien de plus à lire.
  if (firstRows.length < PAGE) {
    emit("success", out.length);
    return out;
  }

  // PLUS D'UNE PAGE. On lit par vagues PARALLÈLES jusqu'à ce qu'une page revienne
  // incomplète — c'est elle, et elle seule, qui dit « fin de table ». Le compte
  // estimé ne sert qu'à dimensionner la première vague : trop bas, on fait
  // quelques rondes de plus ; trop haut, on tire quelques pages vides. Jamais une
  // ligne n'est oubliée, et aucune n'exige de scan de comptage.
  const estimate = first.count ?? 0;
  let nextFrom = PAGE;
  let done = false;
  while (!done) {
    const remainingByEstimate = Math.ceil(Math.max(0, estimate - nextFrom) / PAGE);
    const waveSize = Math.min(remainingByEstimate || PAGE_CONCURRENCY, PAGE_CONCURRENCY);
    const starts: number[] = [];
    for (let k = 0; k < waveSize; k += 1) {
      starts.push(nextFrom);
      nextFrom += PAGE;
    }
    let waveResults: QueryResult[];
    try {
      waveResults = await mapWithConcurrency(starts, PAGE_CONCURRENCY, (from) =>
        runRequest(
          spec.table,
          (signal) =>
            filter(supabase()
              .from(spec.table)
              .select("*"))
              .abortSignal(signal)
              .order(spec.pk, { ascending: true })
              .range(from, from + PAGE - 1),
          // Une page profonde qui échoue n'est retentée qu'une fois : la reprise
          // par curseur, plus sûre, prend le relais sans faire attendre.
          { ...opts, maxAttempts: Math.min(opts.maxAttempts ?? MAX_ATTEMPTS, 2) },
        ),
      );
    } catch (err) {
      if (err instanceof LoadCancelledError) {
        emit("cancelled", out.length);
        throw err;
      }
      // Une page profonde n'a pas abouti : on termine par curseur (ci-dessous).
      console.warn(`[supabase] ${spec.table} : pagination par décalage en échec, reprise par curseur`, err);
      break;
    }
    let waveFailed = false;
    for (const page of waveResults) {
      pages += 1;
      if (page.error) {
        console.warn(`[supabase] ${spec.table} : page en échec, reprise par curseur — ${page.error.message}`);
        waveFailed = true;
        break;
      }
      const rows = (page.data ?? []) as Record<string, unknown>[];
      approxBytes += estimateBytes(rows);
      for (const r of rows) out.push(fromRow(spec, r));
      // Une page non pleine est la dernière : la table est entièrement lue.
      if (rows.length < PAGE) {
        done = true;
        break;
      }
    }
    if (waveFailed) break;
  }

  // REPRISE PAR CURSEUR (« keyset »).
  //
  // Une page lue par DÉCALAGE (`range(40000, 40999)`) oblige Postgres à
  // parcourir — et à vérifier les droits de — toutes les lignes qui la
  // précèdent : sur un gros historique de présences, les pages profondes
  // dépassent le délai et la table entière était abandonnée, l'écran gardant
  // une copie ancienne (les présences des semaines passées « disparaissaient »).
  //
  // On reprend donc là où la lecture s'est arrêtée, par CLÉ : `id > dernier lu`,
  // via l'index de la clé primaire. Chaque page ne coûte que ses propres lignes,
  // quelle que soit sa profondeur. Les lignes déjà lues forment un préfixe
  // contigu dans l'ordre de la clé : rien n'est perdu, rien n'est doublé.
  while (!done) {
    const last = out.length ? String(out[out.length - 1][spec.pkField]) : null;
    let page: QueryResult;
    try {
      page = await runRequest(
        spec.table,
        (signal) => {
          let q = filter(supabase().from(spec.table).select("*"));
          if (last !== null) q = q.gt(spec.pk, last);
          return q.abortSignal(signal).order(spec.pk, { ascending: true }).limit(KEYSET_PAGE);
        },
        opts,
      );
    } catch (err) {
      if (err instanceof LoadCancelledError) {
        emit("cancelled", out.length);
        throw err;
      }
      emit(err instanceof LoadTimeoutError ? "timeout" : "error", out.length);
      throw err instanceof LoadTimeoutError
        ? err
        : new Error(`${spec.table}: ${err instanceof Error ? err.message : String(err)}`);
    }
    pages += 1;
    if (page.error) {
      emit("error", out.length);
      throw new Error(`${spec.table}: ${page.error.message}`);
    }
    const rows = (page.data ?? []) as Record<string, unknown>[];
    approxBytes += estimateBytes(rows);
    for (const r of rows) out.push(fromRow(spec, r));
    if (rows.length < KEYSET_PAGE) done = true;
  }
  emit("success", out.length);
  return out;
}

/** The establishment row. Falls back to a blank one so the login screen renders
 *  even before the SQL script has been run. */
export async function loadSchool(opts: LoadOptions = {}): Promise<School> {
  const res = await runRequest(
    SCHOOL_SPEC.table,
    (signal) =>
      supabase().from(SCHOOL_SPEC.table).select("*").eq("id", SCHOOL_ID).abortSignal(signal).maybeSingle(),
    opts,
  );
  if (res.error) throw new Error(`schools: ${res.error.message}`);
  const data = (res.data ?? null) as Record<string, unknown> | null;
  if (!data) return emptySchool();
  return { ...emptySchool(), ...(fromRow(SCHOOL_SPEC, data) as Partial<School>) } as School;
}

export function emptySchool(): School {
  return {
    id: SCHOOL_ID,
    name: "École",
    description: "",
    phone: "",
    email: "",
    address: "",
  };
}

/**
 * Reads the whole database into the shape the store works with. Tables are
 * fetched in parallel — the store only publishes them once every one has
 * landed, so no screen ever renders half a database.
 */
export async function loadDatabase(opts: LoadOptions = {}): Promise<Database> {
  throwIfAborted(opts.signal);
  const startedAt = Date.now();
  const t0 = now();
  const tables: TableDiagnostic[] = [];
  // Collect every table's cost while still forwarding to any caller-supplied
  // callback, so the aggregate summary below is always complete.
  const collect: LoadOptions = {
    ...opts,
    onTableDiagnostic: (d) => {
      tables.push(d);
      opts.onTableDiagnostic?.(d);
    },
  };

  const [school, lists] = await Promise.all([
    loadSchool(collect),
    mapWithConcurrency(COLLECTION_ORDER, TABLE_CONCURRENCY, (key) => readAll(TABLES[key], collect)),
  ]);

  const db = { school } as Database;
  COLLECTION_ORDER.forEach((key, i) => {
    (db as unknown as Record<string, unknown>)[key] = lists[i];
  });

  const totalRows = tables.reduce((s, d) => s + d.rows, 0);
  const totalApproxBytes = tables.reduce((s, d) => s + d.approxBytes, 0);
  const slowest = tables.reduce<TableDiagnostic | null>(
    (m, d) => (!m || d.ms > m.ms ? d : m),
    null,
  );
  lastDiagnostics = {
    tables,
    totalMs: Math.round(now() - t0),
    totalRows,
    totalApproxBytes,
    slowestTable: slowest ? `${slowest.table} (${slowest.ms} ms)` : null,
    startedAt,
  };
  logDiagnostics(lastDiagnostics);
  return db;
}

/**
 * Lit un SOUS-ENSEMBLE des collections (et, au choix, l'établissement), pour le
 * chargement en deux temps : d'abord tout SAUF l'historique lourd — l'écran se
 * peint vite — puis l'historique (présences) en arrière-plan. `label` n'apparaît
 * que dans le journal de diagnostic, pour distinguer les deux passes.
 */
export async function loadSome(
  keys: CollectionKey[],
  opts: LoadOptions & { withSchool?: boolean; label?: string } = {},
): Promise<{ school?: School; collections: Partial<Record<CollectionKey, Record<string, unknown>[]>> }> {
  throwIfAborted(opts.signal);
  const t0 = now();
  const startedAt = Date.now();
  const tables: TableDiagnostic[] = [];
  const collect: LoadOptions = {
    ...opts,
    onTableDiagnostic: (d) => {
      tables.push(d);
      opts.onTableDiagnostic?.(d);
    },
  };

  const [school, lists] = await Promise.all([
    opts.withSchool ? loadSchool(collect) : Promise.resolve(undefined),
    mapWithConcurrency(keys, TABLE_CONCURRENCY, (key) => readAll(TABLES[key], collect)),
  ]);

  const collections: Partial<Record<CollectionKey, Record<string, unknown>[]>> = {};
  keys.forEach((key, i) => {
    collections[key] = lists[i];
  });

  const totalRows = tables.reduce((s, d) => s + d.rows, 0);
  const totalApproxBytes = tables.reduce((s, d) => s + d.approxBytes, 0);
  const slowest = tables.reduce<TableDiagnostic | null>((m, d) => (!m || d.ms > m.ms ? d : m), null);
  lastDiagnostics = {
    tables,
    totalMs: Math.round(now() - t0),
    totalRows,
    totalApproxBytes,
    slowestTable: slowest ? `${slowest.table} (${slowest.ms} ms)` : null,
    startedAt,
  };
  if (typeof console !== "undefined" && opts.label) {
    console.info(
      `[supabase] ${opts.label}: ${lastDiagnostics.totalMs} ms · ${totalRows} lignes · ` +
        `~${(totalApproxBytes / 1024).toFixed(1)} Ko` +
        (lastDiagnostics.slowestTable ? ` · plus lente : ${lastDiagnostics.slowestTable}` : ""),
    );
  }
  return { school, collections };
}

/**
 * RELIRE LA BASE SANS QU'UNE SEULE TABLE FASSE TOUT ÉCHOUER.
 *
 * `loadDatabase()` est « tout ou rien » : une seule page d'une seule des ~40
 * tables qui échoue, et TOUTE la relecture est jetée — l'écran restait alors
 * « Hors-ligne », miroir d'écriture en pause, pour une table sans importance.
 *
 * Ici chaque table est lue pour elle-même : celles qui aboutissent sont
 * rendues, celles qui échouent sont LISTÉES (avec leur erreur) pour que
 * l'appelant garde, pour elles seules, la copie déjà affichée. Une annulation
 * volontaire, elle, interrompt toujours tout.
 */
export interface TolerantLoad {
  school?: School;
  collections: Partial<Record<CollectionKey, Record<string, unknown>[]>>;
  failed: { key: CollectionKey | "school"; message: string; timeout: boolean }[];
}

export async function loadDatabaseTolerant(opts: LoadOptions = {}): Promise<TolerantLoad> {
  throwIfAborted(opts.signal);
  const t0 = now();
  const startedAt = Date.now();
  const tables: TableDiagnostic[] = [];
  const collect: LoadOptions = {
    ...opts,
    onTableDiagnostic: (d) => {
      tables.push(d);
      opts.onTableDiagnostic?.(d);
    },
  };
  const failed: TolerantLoad["failed"] = [];
  const describe = (err: unknown) => (err instanceof Error ? err.message : String(err));

  const [school, lists] = await Promise.all([
    loadSchool(collect).catch((err) => {
      if (err instanceof LoadCancelledError) throw err;
      failed.push({ key: "school", message: describe(err), timeout: err instanceof LoadTimeoutError });
      return undefined;
    }),
    mapWithConcurrency(COLLECTION_ORDER, TABLE_CONCURRENCY, (key) =>
      readAll(TABLES[key], collect).catch((err) => {
        if (err instanceof LoadCancelledError) throw err;
        failed.push({ key, message: describe(err), timeout: err instanceof LoadTimeoutError });
        return null;
      }),
    ),
  ]);
  throwIfAborted(opts.signal);

  const collections: TolerantLoad["collections"] = {};
  COLLECTION_ORDER.forEach((key, i) => {
    const list = lists[i];
    if (list) collections[key] = list;
  });

  const totalRows = tables.reduce((s, d) => s + d.rows, 0);
  const totalApproxBytes = tables.reduce((s, d) => s + d.approxBytes, 0);
  const slowest = tables.reduce<TableDiagnostic | null>((m, d) => (!m || d.ms > m.ms ? d : m), null);
  lastDiagnostics = {
    tables,
    totalMs: Math.round(now() - t0),
    totalRows,
    totalApproxBytes,
    slowestTable: slowest ? `${slowest.table} (${slowest.ms} ms)` : null,
    startedAt,
  };
  logDiagnostics(lastDiagnostics);
  if (failed.length && typeof console !== "undefined") {
    console.warn(
      `[supabase] relecture partielle — ${failed.length} table(s) en échec, copie locale conservée pour elles :`,
      failed.map((f) => `${f.key}: ${f.message}`),
    );
  }
  return { school, collections, failed };
}

/**
 * Lit les lignes d'UNE collection qui satisfont des filtres simples — la
 * lecture ciblée des rafraîchissements « en direct » (les présences d'un
 * groupe, celles des derniers jours), au lieu de relire toute la base.
 */
export async function loadRowsWhere(
  key: CollectionKey,
  where: { column: string; op: "eq" | "gte"; value: string }[],
  opts: LoadOptions = {},
): Promise<Record<string, unknown>[]> {
  throwIfAborted(opts.signal);
  return readAll(TABLES[key], opts, (q) => {
    let out = q;
    for (const w of where) out = w.op === "eq" ? out.eq(w.column, w.value) : out.gte(w.column, w.value);
    return out;
  });
}

/** A database with an establishment and no rows at all. */
export function emptyDatabase(): Database {
  const db = { school: emptySchool() } as Database;
  for (const key of COLLECTION_ORDER) {
    (db as unknown as Record<string, unknown>)[key] = [];
  }
  return db;
}
