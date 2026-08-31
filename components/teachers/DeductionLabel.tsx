"use client";

/**
 * LE LIBELLÉ D'UNE RETENUE — et, quand c'est une scolarité d'enfant, POUR QUEL
 * COURS on retient.
 *
 * Trois écrans affichent la même table 3 : celui du guichet qui règle, celui de
 * l'enseignant qui vérifie, et la relecture d'un vieux règlement. Tous les
 * trois se contentaient d'un libellé — « Scolarité — Yacine » — qui ne dit rien
 * au père dont le fils suit trois modules : il voit qu'on lui reprend 1 500 DA,
 * pas de quel emploi du temps ils viennent.
 *
 * L'emploi du temps a donc sa propre pastille, à côté du mois, dans les trois
 * écrans à la fois — c'est le même composant, pour que les trois disent
 * exactement la même chose.
 */

import { Badge } from "@/components/ui/Badge";
import { CalendarRange, GraduationCap } from "lucide-react";
import type { TeacherPayDeductionLine } from "@/lib/types";

/** Vrai pour une scolarité d'enfant — les deux formes, due ou déjà avancée. */
export function isChildDeduction(kind: TeacherPayDeductionLine["kind"]): boolean {
  return kind === "child" || kind === "child_debt";
}

/**
 * Le sous-titre d'une retenue de scolarité, sans l'emploi ni le mois : ils sont
 * affichés en pastilles, les répéter dans la phrase ferait doublon.
 */
function restOfDescription(row: TeacherPayDeductionLine): string | undefined {
  if (!row.description) return undefined;
  const emploi = row.emploi?.trim();
  if (!isChildDeduction(row.kind) || !emploi) return row.description;
  const rest = row.description
    .split("·")
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part !== row.monthCode && part !== emploi);
  return rest.length > 0 ? rest.join(" · ") : undefined;
}

export function DeductionLabel({ row }: { row: TeacherPayDeductionLine }) {
  // UN RÈGLEMENT FIGÉ AVANT CETTE COLONNE ne porte pas d'`emploi` : son
  // intitulé vit encore dans la phrase, et rien ne permet de l'en extraire à
  // coup sûr. La pastille ne s'affiche donc que lorsqu'on SAIT — mieux vaut
  // l'ancienne phrase, complète, qu'une étiquette qui affirme au hasard.
  const named = isChildDeduction(row.kind) && !!row.emploi;
  const rest = restOfDescription(row);
  return (
    <>
      <strong className="block text-ink">{row.label}</strong>
      {named && (
        <span className="mt-0.5 flex flex-wrap items-center gap-1">
          <Badge
            tone="primary"
            className="gap-1 text-[9px]"
            title={`Scolarité de son enfant sur l'emploi du temps « ${row.emploi} »`}
          >
            <GraduationCap className="h-3 w-3" />
            {row.emploi}
          </Badge>
          {row.monthCode && (
            <Badge tone="neutral" className="gap-1 font-mono text-[9px]" title="Le mois de cet emploi du temps">
              <CalendarRange className="h-3 w-3" />
              {row.monthCode}
            </Badge>
          )}
        </span>
      )}
      {rest && <span className="block text-[9px] text-muted">{rest}</span>}
    </>
  );
}
