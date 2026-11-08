"use client";

import { supabase } from "@/lib/supabase/client";
import { TABLES, fromRow } from "@/lib/supabase/tables";
import type { Student } from "@/lib/types";

/**
 * COUCHE D'ACCÈS AUX DONNÉES — ÉLÈVES (fondation de la lecture à la demande).
 *
 * Contrairement à `lib/supabase/load.ts` qui télécharge TOUTE la table, ce
 * module lit par PAGES BORNÉES, avec PROJECTION DE COLONNES et PAGINATION PAR
 * CLÉ (keyset), sans `count` exact. Il est la brique de base pour sortir du
 * chargement intégral écran par écran, derrière le drapeau `scopedStudentReads`.
 *
 * Principes :
 *   • Ordre stable déterministe (last_name, first_name, id) : deux élèves
 *     homonymes sont départagés par l'id, donc le curseur ne saute ni ne
 *     duplique une ligne même pendant des insertions concurrentes.
 *   • Pagination par curseur (keyset) : `WHERE (clé) > curseur LIMIT n`, en O(1)
 *     quelle que soit la profondeur, là où l'offset se dégrade avec l'historique.
 *   • Pas de `count: exact` : on demande `pageSize + 1` lignes pour savoir s'il
 *     reste une page, sans faire scanner la table pour compter.
 */

const SPEC = TABLES.students;

/** Colonnes minimales d'une ligne de LISTE (ni soldes ni historique). */
const LIST_COLUMNS = [
  "id",
  "registration_number",
  "first_name",
  "last_name",
  "phone",
  "rfid",
  "enrollment_level",
  "enrollment_year",
  "parent_id",
] as const;

export interface StudentListItem {
  id: string;
  registrationNumber?: string;
  firstName: string;
  lastName: string;
  phone: string;
  rfid: string;
  enrollmentLevel?: string;
  enrollmentYear?: string;
  parentId?: string;
}

/** Curseur opaque de pagination par clé. */
export interface StudentCursor {
  lastName: string;
  firstName: string;
  id: string;
}

export interface StudentPage {
  items: StudentListItem[];
  /** Curseur à passer pour obtenir la page suivante, ou `null` s'il n'y en a plus. */
  nextCursor: StudentCursor | null;
}

export interface ListStudentsParams {
  pageSize?: number;
  cursor?: StudentCursor | null;
  /** Recherche par préfixe sur nom/prénom (insensible à la casse). */
  search?: string;
  /** Filtre optionnel par niveau. */
  level?: string;
  /** Signal d'annulation (changement d'écran, frappe suivante…). */
  signal?: AbortSignal;
}

const DEFAULT_PAGE = 30;
const MAX_PAGE = 100;

function rowToListItem(row: Record<string, unknown>): StudentListItem {
  return {
    id: String(row.id),
    registrationNumber: (row.registration_number as string | null) ?? undefined,
    firstName: (row.first_name as string | null) ?? "",
    lastName: (row.last_name as string | null) ?? "",
    phone: (row.phone as string | null) ?? "",
    rfid: (row.rfid as string | null) ?? "",
    enrollmentLevel: (row.enrollment_level as string | null) ?? undefined,
    enrollmentYear: (row.enrollment_year as string | null) ?? undefined,
    parentId: (row.parent_id as string | null) ?? undefined,
  };
}

/**
 * Lit UNE page d'élèves, triée (last_name, first_name, id), par curseur keyset.
 * N'interroge que les colonnes de liste. Ne compte jamais la table entière.
 */
export async function listStudents(params: ListStudentsParams = {}): Promise<StudentPage> {
  const pageSize = Math.min(Math.max(params.pageSize ?? DEFAULT_PAGE, 1), MAX_PAGE);

  let q = supabase()
    .from(SPEC.table)
    .select(LIST_COLUMNS.join(","))
    .order("last_name", { ascending: true })
    .order("first_name", { ascending: true })
    .order("id", { ascending: true })
    // On demande une ligne de plus pour savoir s'il reste une page, sans count.
    .limit(pageSize + 1);

  if (params.level) q = q.eq("enrollment_level", params.level);

  if (params.search && params.search.trim()) {
    const term = params.search.trim().replace(/[%,()]/g, " ");
    // Préfixe insensible à la casse sur nom OU prénom (sert les index
    // fonctionnels lower(last_name)/lower(first_name) de la migration).
    q = q.or(`last_name.ilike.${term}%,first_name.ilike.${term}%`);
  }

  // Pagination par clé : uniquement les lignes APRÈS le curseur.
  if (params.cursor) {
    const { lastName, firstName, id } = params.cursor;
    const esc = (v: string) => v.replace(/[(),]/g, " ");
    q = q.or(
      [
        `last_name.gt.${esc(lastName)}`,
        `and(last_name.eq.${esc(lastName)},first_name.gt.${esc(firstName)})`,
        `and(last_name.eq.${esc(lastName)},first_name.eq.${esc(firstName)},id.gt.${esc(id)})`,
      ].join(","),
    );
  }

  if (params.signal) q = q.abortSignal(params.signal);

  const { data, error } = await q;
  if (error) throw new Error(`students (list): ${error.message}`);

  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  const hasMore = rows.length > pageSize;
  const pageRows = hasMore ? rows.slice(0, pageSize) : rows;
  const items = pageRows.map(rowToListItem);

  const last = items[items.length - 1];
  const nextCursor =
    hasMore && last
      ? { lastName: last.lastName, firstName: last.firstName, id: last.id }
      : null;

  return { items, nextCursor };
}

/**
 * Lit UNE fiche élève complète (toutes les colonnes de la table), à la demande,
 * quand on ouvre son dossier — au lieu d'avoir tout préchargé.
 */
export async function getStudent(
  id: string,
  signal?: AbortSignal,
): Promise<Student | null> {
  let q = supabase().from(SPEC.table).select("*").eq("id", id);
  if (signal) q = q.abortSignal(signal);
  const { data, error } = await q.maybeSingle();
  if (error) throw new Error(`students (get): ${error.message}`);
  if (!data) return null;
  return fromRow(SPEC, data as Record<string, unknown>) as unknown as Student;
}
