"use client";

/**
 * LA RELECTURE D'UN RÈGLEMENT — les trois mêmes tables, en lecture seule.
 *
 * Un règlement enregistré fige ce qu'il a payé (`TeacherPayment.board`). Cet
 * écran le réaffiche tel quel : les élèves du mois, les arriérés rattrapés, les
 * retenues, et le net. C'est volontairement le même découpage, les mêmes
 * colonnes et les mêmes totaux que l'écran de règlement — la personne qui a
 * versé et celle qui vérifie six mois plus tard doivent lire la même page.
 *
 * Rien n'est recalculé : un élève qui a changé de groupe, un tarif corrigé
 * depuis, n'ont aucune prise sur ce qui a été payé ce jour-là.
 */

import { Badge, type Tone } from "@/components/ui/Badge";
import { DeductionLabel } from "@/components/teachers/DeductionLabel";
import { formatDA } from "@/lib/utils";
import { formatDateFr, monthCodeLabel } from "@/lib/helpers";
import type { TeacherPayBoard, TeacherPayDeductionLine } from "@/lib/types";
import { AlertTriangle, GraduationCap, HandCoins, Lock, Receipt, Users, Wallet } from "lucide-react";


/**
 * LES MÊMES PASTILLES QUE LA FEUILLE DE PRÉSENCE — même écran, même langage.
 *
 * `"before"` marque une séance tenue avant l'inscription de l'élève : elle
 * n'a jamais été la sienne, donc elle reste vide plutôt que de se lire comme
 * un pointage oublié.
 */
const SLOT_STYLE: Record<string, { short: string; cls: string; label: string }> = {
  present: { short: "P", cls: "bg-success/15 text-success border-success/40", label: "Présent" },
  late: { short: "R", cls: "bg-warning/15 text-warning border-warning/40", label: "Retard" },
  absent: { short: "A", cls: "bg-danger/15 text-danger border-danger/40", label: "Absent" },
  cancelled: { short: "\u00d7", cls: "bg-primary/15 text-primary border-primary/40", label: "Annulée" },
  before: {
    short: "",
    cls: "border-dashed border-line bg-canvas/40 text-muted/40",
    label: "Séance tenue avant son inscription",
  },
};

function SlotCells({ slots }: { slots: (string | null)[] }) {
  return (
    <>
      {slots.map((v, i) => {
        const style = v ? SLOT_STYLE[v] : undefined;
        return (
          <td key={i} className="px-1 py-2 text-center">
            <span
              title={style ? `Séance ${i + 1} — ${style.label}` : `Séance ${i + 1} — pas encore pointée`}
              className={`inline-flex h-6 w-6 items-center justify-center rounded-lg border text-[11px] font-black ${
                style?.cls ?? "border-line bg-canvas text-muted/50"
              }`}
            >
              {style ? style.short : "\u2013"}
            </span>
          </td>
        );
      })}
    </>
  );
}

const DED_KIND: Record<
  TeacherPayDeductionLine["kind"],
  { label: string; tone: Tone; icon: React.ReactNode }
> = {
  expense: { label: "Dépense", tone: "warning", icon: <Receipt className="h-3 w-3" /> },
  acompte: { label: "Acompte", tone: "primary", icon: <Wallet className="h-3 w-3" /> },
  child: { label: "Scolarité enfant", tone: "danger", icon: <GraduationCap className="h-3 w-3" /> },
  child_debt: {
    label: "Scolarité avancée",
    tone: "danger",
    icon: <GraduationCap className="h-3 w-3" />,
  },
};

export function PayBoardView({ board }: { board: TeacherPayBoard }) {
  return (
    <div className="space-y-4">
      {/* ---- l'emploi du temps et le mois réglés -------------------------- */}
      <div className="flex flex-wrap items-start justify-between gap-2 rounded-2xl border border-primary/30 bg-primary-50/40 p-3">
        <div className="min-w-0">
          <strong className="block text-sm text-ink">
            📚 {board.emploi || "Emploi du temps"}
          </strong>
          <span className="block text-[11px] font-semibold text-primary">
            Groupe {board.groupName}
          </span>
          <span className="block text-[11px] text-muted">
            {board.className} · Salle {board.salleName} · {board.daysLabel} ·{" "}
            <span className="font-mono">{board.timeLabel}</span>
          </span>
          <span className="block text-[11px] text-muted">
            Mois à {formatDA(board.monthPrice)} · part enseignant {formatDA(board.teacherMonthShare)}{" "}
            ÷ {board.size} séances = <strong className="text-primary">{formatDA(board.perSeance)}</strong>{" "}
            la séance
          </span>
        </div>
        <div className="flex shrink-0 flex-wrap gap-1.5">
          <Badge tone="primary" className="font-mono font-bold">
            {monthCodeLabel(board.monthCode)}
          </Badge>
          <Badge tone="neutral" className="font-mono">
            {board.held}/{board.size} séances
          </Badge>
        </div>
      </div>

      {/* =================== TABLE 1 =================== */}
      <section className="overflow-hidden rounded-2xl border border-line">
        <div className="bg-primary-50/60 p-2.5">
          <strong className="flex items-center gap-1.5 text-xs text-ink">
            <Users className="h-3.5 w-3.5 text-primary" /> 1. Élèves de {board.monthCode} (
            {board.students.length})
          </strong>
        </div>
        {board.students.length === 0 ? (
          <p className="bg-surface px-3 py-5 text-center text-[11px] italic text-muted">
            Aucun élève sur ce mois.
          </p>
        ) : (
          <div className="overflow-x-auto bg-surface">
            <table className="w-full min-w-[860px] text-[11px]">
              <thead className="bg-canvas/60">
                <tr className="text-left text-[9px] uppercase tracking-wide text-muted">
                  <th className="px-2 py-2">N°</th>
                  <th className="px-2 py-2">Élève</th>
                  {Array.from({ length: board.size }, (_, i) => (
                    <th key={i} className="px-1 py-2 text-center">
                      S{i + 1}
                    </th>
                  ))}
                  <th className="px-2 py-2 text-center">P / A / An.</th>
                  <th className="px-2 py-2 text-center">Séances payées</th>
                  <th className="px-2 py-2 text-right">Part / séance</th>
                  <th className="px-2 py-2 text-right">Versé</th>
                  <th className="px-2 py-2 text-right">Reste dû</th>
                  <th className="px-2 py-2 text-center">Réglé ici</th>
                  <th className="px-2 py-2 text-right">Part enseignant</th>
                </tr>
              </thead>
              <tbody>
                {board.students.map((r) => {
                  // Un règlement figé avant cette colonne ne portait QUE des
                  // lignes payées : l'absence de `settledHere` vaut « réglé ».
                  const settledHere = r.settledHere ?? !r.withheld;
                  return (
                  <tr
                    key={r.studentId}
                    className={`border-t border-line/60 ${
                      r.schoolCovered
                        ? "bg-danger/10"
                        : r.withheld
                          ? "bg-warning/5"
                          : settledHere
                            ? ""
                            : "bg-canvas/60 text-muted"
                    }`}
                  >
                    <td className="px-2 py-2 font-mono text-[10px] text-muted">
                      {r.registrationNumber || "—"}
                    </td>
                    <td className="px-2 py-2">
                      <strong className="block text-ink">{r.name}</strong>
                      <div className="mt-0.5 flex flex-wrap gap-1">
                        {r.caseLabel && (
                          <Badge tone="warning" className="text-[8px]">
                            {r.caseLabel}
                          </Badge>
                        )}
                        {r.schoolCovered && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-danger px-2 py-0.5 text-[8px] font-bold text-white">
                            <AlertTriangle className="h-2.5 w-2.5" /> avancé par l&apos;école
                          </span>
                        )}
                      </div>
                    </td>
                    <SlotCells
                      slots={r.slots ?? Array.from({ length: board.size }, () => null)}
                    />
                    <td className="px-2 py-2 text-center font-mono text-[10px]">
                      <span className="text-success">{r.presents}</span> /{" "}
                      <span className="text-danger">{r.absents}</span> /{" "}
                      <span className="text-primary">{r.cancelled}</span>
                    </td>
                    <td className="px-2 py-2 text-center font-mono">{r.seances}</td>
                    <td className="px-2 py-2 text-right font-mono text-muted">
                      {formatDA(r.perSeance)}
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-success">
                      {formatDA(r.credited)}
                    </td>
                    <td className="px-2 py-2 text-right font-mono">
                      {r.debt > 0 ? (
                        <span className="font-bold text-danger">{formatDA(r.debt)}</span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-center">
                      <Badge tone={settledHere ? "success" : r.withheld ? "warning" : "neutral"} className="text-[9px]">
                        {settledHere ? "Payé" : r.withheld ? "Retenu" : "Non réglé"}
                      </Badge>
                    </td>
                    <td className="px-2 py-2 text-right">
                      {settledHere ? (
                        <strong className="font-mono text-success">{formatDA(r.amount)}</strong>
                      ) : (
                        <span
                          className="inline-flex items-center gap-1 font-mono text-[10px] font-bold text-warning"
                          title={
                            r.withheld
                              ? "Part retenue : cet élève n'a pas payé les séances qui l'ont produite"
                              : "Part non versée par ce bon — elle reste à régler"
                          }
                        >
                          <Lock className="h-3 w-3" /> {formatDA(r.amount)}
                        </span>
                      )}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-line bg-canvas/60">
                  <td
                    colSpan={8 + board.size}
                    className="px-2 py-2 text-right text-[11px] font-bold text-ink"
                  >
                    Sous-total table 1
                  </td>
                  <td className="px-2 py-2 text-right font-mono text-sm font-black text-success">
                    {formatDA(board.studentsTotal)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      {/* =================== TABLE 2 =================== */}
      <section className="overflow-hidden rounded-2xl border-2 border-success/40">
        <div className="bg-success/10 p-2.5">
          <strong className="flex items-center gap-1.5 text-xs text-success">
            <HandCoins className="h-3.5 w-3.5" /> 2. Arriérés rattrapés ({board.arrears.length})
          </strong>
        </div>
        {board.arrears.length === 0 ? (
          <p className="bg-surface px-3 py-5 text-center text-[11px] italic text-muted">
            Aucun arriéré rattrapé par ce règlement.
          </p>
        ) : (
          <div className="overflow-x-auto bg-surface">
            <table className="w-full min-w-[760px] text-[11px]">
              <thead className="bg-canvas/60">
                <tr className="text-left text-[9px] uppercase tracking-wide text-muted">
                  <th className="px-2 py-2">N°</th>
                  <th className="px-2 py-2">Élève</th>
                  <th className="px-2 py-2 text-center">Mois d&apos;origine</th>
                  <th className="px-2 py-2 text-center">Séances</th>
                  <th className="px-2 py-2">Dates</th>
                  <th className="px-2 py-2 text-right">Part rattrapée</th>
                </tr>
              </thead>
              <tbody>
                {board.arrears.map((r, i) => (
                  <tr key={`${r.studentId}-${r.monthCode}-${i}`} className="border-t border-line/60">
                    <td className="px-2 py-2 font-mono text-[10px] text-muted">
                      {r.registrationNumber || "—"}
                    </td>
                    <td className="px-2 py-2">
                      <strong className="text-ink">{r.name}</strong>
                    </td>
                    <td className="px-2 py-2 text-center">
                      <Badge tone="success" className="font-mono text-[10px]">
                        {r.monthCode}
                      </Badge>
                    </td>
                    <td className="px-2 py-2 text-center font-mono">{r.seances}</td>
                    <td className="px-2 py-2 text-[10px] text-muted">
                      {r.dates.map(formatDateFr).join(" · ") || "—"}
                    </td>
                    <td className="px-2 py-2 text-right font-mono font-bold text-success">
                      {formatDA(r.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-line bg-canvas/60">
                  <td colSpan={5} className="px-2 py-2 text-right text-[11px] font-bold text-ink">
                    Sous-total table 2
                  </td>
                  <td className="px-2 py-2 text-right font-mono text-sm font-black text-success">
                    {formatDA(board.arrearsTotal)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      {/* =================== TABLE 3 =================== */}
      <section className="overflow-hidden rounded-2xl border-2 border-danger/30">
        <div className="bg-danger/10 p-2.5">
          <strong className="flex items-center gap-1.5 text-xs text-danger">
            <Receipt className="h-3.5 w-3.5" /> 3. Retenues ({board.deductions.length})
          </strong>
        </div>
        {board.deductions.length === 0 ? (
          <p className="bg-surface px-3 py-5 text-center text-[11px] italic text-muted">
            Aucune retenue sur ce règlement.
          </p>
        ) : (
          <div className="overflow-x-auto bg-surface">
            <table className="w-full min-w-[620px] text-[11px]">
              <thead className="bg-canvas/60">
                <tr className="text-left text-[9px] uppercase tracking-wide text-muted">
                  <th className="px-2 py-2">Date</th>
                  <th className="px-2 py-2">Nature</th>
                  <th className="px-2 py-2">Libellé</th>
                  <th className="px-2 py-2 text-right">Montant</th>
                </tr>
              </thead>
              <tbody>
                {board.deductions.map((d, i) => {
                  const kind = DED_KIND[d.kind] ?? DED_KIND.expense;
                  return (
                    <tr key={`${d.id}-${i}`} className="border-t border-line/60">
                      <td className="px-2 py-2 font-mono text-[10px] text-muted">
                        {d.date ? formatDateFr(d.date) : "—"}
                      </td>
                      <td className="px-2 py-2">
                        <Badge tone={kind.tone} className="gap-1 text-[9px]">
                          {kind.icon} {kind.label}
                        </Badge>
                      </td>
                      <td className="px-2 py-2">
                        <DeductionLabel row={d} />
                      </td>
                      <td className="px-2 py-2 text-right font-mono font-bold text-danger">
                        − {formatDA(d.amount)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-line bg-canvas/60">
                  <td colSpan={3} className="px-2 py-2 text-right text-[11px] font-bold text-ink">
                    Sous-total table 3
                  </td>
                  <td className="px-2 py-2 text-right font-mono text-sm font-black text-danger">
                    − {formatDA(board.deductionsTotal)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      {/* =================== LE NET =================== */}
      <div className="space-y-1.5 rounded-2xl border-2 border-primary/40 bg-primary-50/40 p-3.5">
        <Line label="Table 1 — élèves du mois" value={formatDA(board.studentsTotal)} tone="text-ink" />
        <Line label="Table 2 — arriérés rattrapés" value={formatDA(board.arrearsTotal)} tone="text-success" />
        <div className="border-t border-line pt-1.5">
          <Line label="TOTAL BRUT" value={formatDA(board.gross)} tone="text-primary" />
        </div>
        <Line
          label="Table 3 — retenues"
          value={`− ${formatDA(board.deductionsTotal)}`}
          tone="text-danger"
        />
        <div className="flex items-center justify-between border-t-2 border-primary/40 pt-2">
          <strong className="text-sm text-ink">NET VERSÉ À L&apos;ENSEIGNANT</strong>
          <strong className="font-mono text-xl font-black text-primary">{formatDA(board.net)}</strong>
        </div>
      </div>
    </div>
  );
}

function Line({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-muted">{label}</span>
      <strong className={`font-mono ${tone}`}>{value}</strong>
    </div>
  );
}
