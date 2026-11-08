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
/** Limit simultaneous table hydrations too: each table can request 6 pages. */
const TABLE_CONCURRENCY = 6;

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
function isMissingTable(error: { code?: string; message?: string }): boolean {
  return (
    error.code === "42P01" ||           // Postgres : relation inexistante
    error.code === "PGRST205" ||        // PostgREST : table absente du schéma
    /does not exist|schema cache/i.test(error.message ?? "")
  );
}

async function readAll(spec: (typeof TABLES)[CollectionKey]): Promise<Record<string, unknown>[]> {
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
  const first = await supabase()
    .from(spec.table)
    .select("*", { count: "exact" })
    .order(spec.pk, { ascending: true })
    .range(0, PAGE - 1);
  if (first.error) {
    if (isMissingTable(first.error)) {
      console.warn(
        `[supabase] ${spec.table} est absente de la base — le script SQL de mise à jour ` +
          `n'a pas encore été exécuté. Cet écran restera vide en attendant.`,
      );
      return [];
    }
    throw new Error(`${spec.table}: ${first.error.message}`);
  }

  const firstRows = (first.data ?? []) as Record<string, unknown>[];
  const out = firstRows.map((r) => fromRow(spec, r));
  const total = first.count ?? firstRows.length;
  // Table qui tient sur une page : rien de plus à aller chercher.
  if (firstRows.length < PAGE || total <= PAGE) return out;

  const starts: number[] = [];
  for (let from = PAGE; from < total; from += PAGE) starts.push(from);
  const pages = await mapWithConcurrency(starts, PAGE_CONCURRENCY, async (from) =>
    supabase()
      .from(spec.table)
      .select("*")
      .order(spec.pk, { ascending: true })
      .range(from, from + PAGE - 1),
  );
  for (const page of pages) {
    if (page.error) throw new Error(`${spec.table}: ${page.error.message}`);
    const rows = (page.data ?? []) as Record<string, unknown>[];
    for (const r of rows) out.push(fromRow(spec, r));
  }
  return out;
}

/** The establishment row. Falls back to a blank one so the login screen renders
 *  even before the SQL script has been run. */
export async function loadSchool(): Promise<School> {
  const { data, error } = await supabase()
    .from(SCHOOL_SPEC.table)
    .select("*")
    .eq("id", SCHOOL_ID)
    .maybeSingle();
  if (error) throw new Error(`schools: ${error.message}`);
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
export async function loadDatabase(): Promise<Database> {
  const [school, lists] = await Promise.all([
    loadSchool(),
    mapWithConcurrency(COLLECTION_ORDER, TABLE_CONCURRENCY, (key) => readAll(TABLES[key])),
  ]);

  const db = { school } as Database;
  COLLECTION_ORDER.forEach((key, i) => {
    (db as unknown as Record<string, unknown>)[key] = lists[i];
  });
  return db;
}

/** A database with an establishment and no rows at all. */
export function emptyDatabase(): Database {
  const db = { school: emptySchool() } as Database;
  for (const key of COLLECTION_ORDER) {
    (db as unknown as Record<string, unknown>)[key] = [];
  }
  return db;
}
