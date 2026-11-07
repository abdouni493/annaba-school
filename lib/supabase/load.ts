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
  const first = await supabase()
    .from(spec.table)
    .select("*", { count: "exact" })
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
  const pages = await Promise.all(
    starts.map((from) =>
      supabase()
        .from(spec.table)
        .select("*")
        .range(from, from + PAGE - 1),
    ),
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
  const [school, ...lists] = await Promise.all([
    loadSchool(),
    ...COLLECTION_ORDER.map((key) => readAll(TABLES[key])),
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
