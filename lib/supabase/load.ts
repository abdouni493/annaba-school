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
  const out: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase()
      .from(spec.table)
      .select("*")
      .range(from, from + PAGE - 1);
    if (error) {
      if (isMissingTable(error)) {
        console.warn(
          `[supabase] ${spec.table} est absente de la base — le script SQL de mise à jour ` +
            `n'a pas encore été exécuté. Cet écran restera vide en attendant.`,
        );
        return out;
      }
      throw new Error(`${spec.table}: ${error.message}`);
    }
    const rows = (data ?? []) as Record<string, unknown>[];
    out.push(...rows.map((r) => fromRow(spec, r)));
    if (rows.length < PAGE) return out;
  }
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
