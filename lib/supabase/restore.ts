"use client";

/**
 * LA RESTAURATION D'UNE SAUVEGARDE — table par table, sous les yeux de celui
 * qui l'a lancée.
 *
 * Remettre un fichier de sauvegarde dans le magasin en une seule écriture
 * « marche » : le miroir de `sync.ts` finit par tout envoyer à Postgres. Mais
 * l'écran reste figé pendant que des milliers de lignes partent, personne ne
 * sait où ça en est, et une erreur au milieu ne dit pas SUR QUOI elle est
 * tombée. Une restauration, c'est justement le moment où l'on a besoin de
 * voir.
 *
 * Ce module rejoue donc la sauvegarde EN DEUX PASSES, exactement dans l'ordre
 * où les clés étrangères l'exigent — c'est le même ordre que le miroir, rendu
 * visible :
 *
 *   1. LES SUPPRESSIONS, de la table la plus profonde vers la plus haute. Une
 *      ligne s'en va toujours avant celle qu'elle désignait, donc aucune clé
 *      étrangère ne pend jamais.
 *   2. LES ÉCRITURES, des tables parents vers les tables enfants. Un élève
 *      existe avant son inscription, son inscription avant son versement.
 *
 * Entre chaque table, on attend que la base ait vraiment reçu ce qu'on vient
 * d'écrire (`syncSettled`) : la barre de progression avance sur du réel, pas
 * sur une file d'attente locale.
 *
 * UNE TABLE ABSENTE DU FICHIER N'EST PAS UNE TABLE VIDE. Elle est simplement
 * laissée telle quelle : une sauvegarde partielle ne doit pas effacer ce dont
 * elle ne parle pas. Une table présente et vide, elle, vide bien la table.
 */

import { useData, type Database } from "@/lib/store/data";
import { syncSettled } from "@/lib/supabase/sync";
import { COLLECTION_ORDER, TABLES, pkOf, type CollectionKey } from "@/lib/supabase/tables";
import type { School } from "@/lib/types";

/** Ce que l'écran affiche pendant que la restauration tourne. */
export interface RestoreProgress {
  /** l'étape en cours, de 1 à `total` */
  step: number;
  total: number;
  /** ce qui se passe, en une ligne */
  label: string;
  /** la phase, pour la couleur et le mot employé */
  phase: "read" | "clear" | "write" | "done";
  /** lignes déjà écrites depuis le début */
  rowsWritten: number;
}

export interface RestoreReport {
  ok: boolean;
  /** lignes écrites, toutes tables confondues */
  rows: number;
  /** tables effectivement reprises */
  collections: number;
  /** lignes supprimées parce que la sauvegarde ne les contenait pas */
  removed: number;
  /** table par table, ce que la sauvegarde apportait */
  detail: { key: string; label: string; rows: number; removed: number }[];
  error?: string;
}

/** Le nom que la sauvegarde donne à une table, pour l'écran. */
export const COLLECTION_LABELS: Partial<Record<CollectionKey, string>> = {
  classCategories: "Catégories de classes",
  modules: "Cours",
  groups: "Groupes",
  salles: "Salles",
  classes: "Classes",
  teachers: "Enseignants",
  workerRoles: "Métiers",
  reception: "Travailleurs",
  parents: "Parents",
  sessions: "Emplois du temps",
  subscriptions: "Tarifs",
  students: "Élèves",
  studentCredentials: "Accès élèves",
  enrollments: "Inscriptions",
  payments: "Versements",
  studentCharges: "Frais",
  attendance: "Présences",
  absencePenalties: "Pénalités d'absence",
  teacherPayments: "Règlements enseignants",
  acomptes: "Acomptes",
  teacherExpenses: "Dépenses enseignants",
  teacherChildDebts: "Scolarités portées",
  absences: "Absences",
  unpaidTeacher: "Parts enseignants dues",
  workerShifts: "Pointages travailleurs",
  workerAcomptes: "Acomptes travailleurs",
  workerAbsences: "Absences travailleurs",
  workerPayments: "Paies travailleurs",
  freePeriods: "Périodes gratuites",
  moduleAbsenceRules: "Règles d'absence",
  subjects: "Matières",
  announcements: "Annonces",
  categories: "Catégories de dépenses",
  expenses: "Dépenses",
  cash: "Caisse",
  notifications: "Notifications",
  coursework: "Travaux",
  independent: "Séances libres",
  groupSeances: "Séances libres de groupe",
  soloSeances: "Séances libres solo",
};

export function labelOfCollection(key: CollectionKey): string {
  return COLLECTION_LABELS[key] ?? key;
}

/** Une sauvegarde utilisable dit au moins qui est l'école et qui sont ses
 *  élèves. Le reste peut manquer — il sera simplement laissé en place. */
export function isRestorableDump(value: unknown): value is Partial<Database> {
  if (!value || typeof value !== "object") return false;
  const dump = value as Record<string, unknown>;
  return !!dump.school && Array.isArray(dump.students);
}

type Row = Record<string, unknown>;

/** Les tables que ce fichier apporte, dans l'ordre des dépendances. */
function collectionsOf(dump: Partial<Database>): CollectionKey[] {
  return COLLECTION_ORDER.filter((key) =>
    Array.isArray((dump as unknown as Record<string, unknown>)[key]),
  );
}

/** Combien de lignes une sauvegarde contient en tout. */
export function countRows(dump: Partial<Database>): number {
  return collectionsOf(dump).reduce(
    (total, key) => total + ((dump as unknown as Record<string, Row[]>)[key]?.length ?? 0),
    0,
  );
}

/**
 * Rejoue la sauvegarde dans le magasin — et, par le miroir, dans Postgres.
 *
 * `onProgress` est appelé AVANT chaque table, puis une dernière fois à la fin :
 * l'écran affiche donc toujours ce qui est en train de partir, jamais ce qui
 * vient de finir.
 */
export async function restoreBackup(
  dump: Partial<Database>,
  onProgress?: (progress: RestoreProgress) => void,
): Promise<RestoreReport> {
  const keys = collectionsOf(dump);
  const hasSchool = !!dump.school;
  // Une passe de suppression + une passe d'écriture par table, plus l'école.
  const total = keys.length * 2 + (hasSchool ? 1 : 0);
  const detail: RestoreReport["detail"] = [];

  let step = 0;
  let rowsWritten = 0;
  let removed = 0;

  const say = (label: string, phase: RestoreProgress["phase"]) => {
    step += 1;
    onProgress?.({ step, total, label, phase, rowsWritten });
  };

  try {
    // ---- 1. LES SUPPRESSIONS, de la table la plus profonde vers la plus haute
    for (const key of [...keys].reverse()) {
      const spec = TABLES[key];
      const incoming = (dump as unknown as Record<string, Row[]>)[key] ?? [];
      const kept = new Set(incoming.map((row) => pkOf(spec, row)));
      const current = (useData.getState() as unknown as Record<string, Row[]>)[key] ?? [];
      const survivors = current.filter((row) => kept.has(pkOf(spec, row)));
      const gone = current.length - survivors.length;

      say(`Nettoyage — ${labelOfCollection(key)}`, "clear");
      if (gone > 0) {
        removed += gone;
        useData.setState({ [key]: survivors } as unknown as Partial<Database>);
        await syncSettled();
      }
    }

    // ---- 2. LES ÉCRITURES, des parents vers les enfants ---------------------
    if (hasSchool) {
      say("Établissement", "write");
      useData.setState({ school: dump.school as School } as unknown as Partial<Database>);
      await syncSettled();
    }

    for (const key of keys) {
      const incoming = (dump as unknown as Record<string, Row[]>)[key] ?? [];
      say(`${labelOfCollection(key)} — ${incoming.length} ligne(s)`, "write");
      if (incoming.length > 0) {
        useData.setState({ [key]: incoming } as unknown as Partial<Database>);
        await syncSettled();
        rowsWritten += incoming.length;
      }
      detail.push({
        key,
        label: labelOfCollection(key),
        rows: incoming.length,
        removed: 0,
      });
    }

    onProgress?.({
      step: total,
      total,
      label: "Restauration terminée",
      phase: "done",
      rowsWritten,
    });
    return { ok: true, rows: rowsWritten, collections: keys.length, removed, detail };
  } catch (err) {
    return {
      ok: false,
      rows: rowsWritten,
      collections: keys.length,
      removed,
      detail,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
