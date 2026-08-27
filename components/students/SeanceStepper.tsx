"use client";

/**
 * LE RACCOURCI DE SAISIE DU MONTANT, PARTAGÉ PAR TOUS LES GUICHETS.
 *
 * Il vivait dans la feuille de présence, donc « Encaisser un solde » ne
 * proposait rien depuis « Situation d'un élève » : la même caissière, le même
 * élève, le même mois — et deux écrans qui ne comptaient pas pareil. Il est
 * désormais ICI, et les deux écrans l'affichent tel quel.
 */

import { useData } from "@/lib/store/data";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Banknote, HandCoins } from "lucide-react";
import type { Student } from "@/lib/types";
import { cycleOf, monthProposal } from "@/lib/helpers";
import { formatDA, money } from "@/lib/utils";

/**
 * LE RACCOURCI DE SAISIE DU MONTANT : « + une séance ».
 *
 * Le problème qu'il résout est trivial et coûte pourtant vingt secondes à
 * chaque encaissement : la réception connaît le prix d'une séance, connaît le
 * nombre de séances que l'élève a à payer sur ce mois, et refait la
 * multiplication de tête. Ici, un bouton ajoute une séance, et un second pose
 * directement le total.
 *
 * LA PROPOSITION PART DE SA PREMIÈRE SÉANCE DU MOIS, PAS DE LÀ OÙ IL EN EST.
 *
 * C'est tout l'intérêt : venir à une séance ne la paie pas. Un élève qui entre
 * dans le mois à la séance 1 et qui a déjà été pointé une fois en est à sa
 * deuxième — mais il doit toujours les QUATRE, la première comprise. Proposer
 * les trois qui restent laisserait la première impayée, et le mois se
 * terminerait avec un trou que personne ne verrait passer.
 *
 * Le plafond vaut donc son mois entier — les séances tenues avant son
 * inscription en moins, puisqu'elles ne furent jamais les siennes — moins ce
 * qu'il a DÉJÀ versé sur ce mois. Un élève à jour de deux séances sur quatre ne
 * se voit proposer que les deux dernières ; celui qui n'a rien versé se voit
 * proposer les quatre. Passé ce plafond le bouton se verrouille : on ne fait
 * pas payer plus que le mois.
 *
 * Le champ reste libre : ces boutons écrivent dedans, ils ne le remplacent pas.
 */
export function SeanceStepper({
  student,
  subscriptionId,
  monthCode,
  amount,
  onAmount,
}: {
  student: Student;
  subscriptionId: string;
  monthCode: string;
  amount: number;
  onAmount: (next: number) => void;
}) {
  const db = useData();
  const cycle = cycleOf(db, student.id, subscriptionId, monthCode);
  // Le calcul vit dans `monthProposal` : la feuille de présence l'affiche, elle
  // ne le refait pas.
  const { unit, mine, credited, billable, total: cap, current } = monthProposal(
    db,
    student.id,
    subscriptionId,
    monthCode,
  );

  if (unit <= 0 || mine <= 0) return null;

  const steps = Math.round((amount || 0) / unit);
  const atCap = cap > 0 && (amount || 0) >= cap;

  return (
    <div className="space-y-2 rounded-xl border border-primary/30 bg-primary-50/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-primary">
          ⚡ Calcul rapide — {formatDA(unit)} la séance
        </span>
        <Badge tone="neutral" className="text-[9px]">
          Séance {current}/{mine} · {billable} à payer
        </Badge>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={cap <= 0 || atCap}
          onClick={() => onAmount(money(Math.min(cap, (amount || 0) + unit)))}
          className="gap-1.5"
          title={
            cap <= 0
              ? "Ce mois est déjà entièrement versé"
              : `Ajouter le prix d'une séance (${formatDA(unit)})`
          }
        >
          <Banknote className="h-3.5 w-3.5" /> + 1 séance ({formatDA(unit)})
        </Button>

        {/* La proposition toute faite : son mois entier, compté depuis SA
            première séance, moins ce qu'il a déjà versé — d'un seul clic. */}
        <Button
          size="sm"
          variant="success"
          disabled={cap <= 0}
          onClick={() => onAmount(cap)}
          className="gap-1.5"
          title={`Les ${billable} séance(s) qu'il doit sur ${monthCode}, depuis sa 1re séance du mois`}
        >
          <HandCoins className="h-3.5 w-3.5" /> Proposition : {formatDA(cap)}
        </Button>

        {(amount || 0) > 0 && (
          <Button size="sm" variant="ghost" onClick={() => onAmount(0)}>
            Effacer
          </Button>
        )}
      </div>

      <p className="text-[10px] leading-relaxed text-muted">
        {steps > 0 ? (
          <>
            <strong className="text-primary">
              {steps} séance(s) × {formatDA(unit)} = {formatDA(money(steps * unit))}
            </strong>{" "}
            —{" "}
          </>
        ) : null}
        {atCap ? (
          <span className="font-semibold text-warning">
            Plafond atteint : il ne reste plus que {formatDA(cap)} à payer sur ce mois, on ne peut
            pas lui en facturer davantage ici.
          </span>
        ) : (
          <>
            son mois compte <strong className="text-ink">{mine} séance(s)</strong> à partir de sa{" "}
            <strong className="text-ink">1re</strong>
            {cycle.lead > 0 ? ` (il est entré à la séance ${cycle.lead + 1} du groupe)` : ""} ;
            {credited > 0 ? (
              <>
                {" "}
                il en a déjà versé {formatDA(credited)}, il en reste donc{" "}
                <strong className="text-ink">{billable}</strong> à payer, soit {formatDA(cap)}.
              </>
            ) : (
              <>
                {" "}
                il n&apos;a encore rien versé dessus — les{" "}
                <strong className="text-ink">{billable}</strong> sont dues, soit {formatDA(cap)},
                pointage ou pas : venir à une séance ne la paie pas.
              </>
            )}{" "}
            Le montant reste modifiable à la main.
          </>
        )}
      </p>
    </div>
  );
}
