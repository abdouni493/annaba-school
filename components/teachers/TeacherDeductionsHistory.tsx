"use client";

/**
 * FICHE ENSEIGNANT — L'HISTORIQUE DES ACOMPTES ET DES ABSENCES.
 *
 * Chaque ligne se modifie et se supprime sur place. Un acompte déjà retenu par
 * un règlement ne change plus de montant et ne se supprime pas : il faut
 * d'abord annuler ce règlement, sinon la paie ne se relirait plus.
 */

import { useState } from "react";
import { CalendarDays, Edit, Trash2, Wallet, UserX, CheckCircle2, AlertTriangle } from "lucide-react";
import { useData, uid } from "@/lib/store/data";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/SearchInput";
import { formatDA, money } from "@/lib/utils";
import { formatDateFr } from "@/lib/helpers";
import type { Teacher } from "@/lib/types";

interface Draft {
  kind: "acompte" | "absence";
  id: string;
  amount: number;
  description: string;
  date: string;
  /** acompte déjà retenu : seuls le libellé et la date se corrigent */
  amountLocked: boolean;
}

function StatTile({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-3 text-center shadow-sm">
      <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted">{label}</span>
      <strong className={`font-mono text-base ${tone}`}>{value}</strong>
    </div>
  );
}

export function TeacherDeductionsHistory({
  teacher,
  kind,
  onAdd,
}: {
  teacher: Teacher;
  kind: "acompte" | "absence";
  onAdd?: () => void;
}) {
  const { acomptes, absences, updateItem, deleteFrom, push, teacherPayments } = useData();
  const [draft, setDraft] = useState<Draft | null>(null);
  const name = `${teacher.firstName} ${teacher.lastName}`;

  const acRows = acomptes
    .filter((a) => a.teacherId === teacher.id)
    .sort((a, b) => b.date.localeCompare(a.date));
  const abRows = absences
    .filter((a) => a.teacherId === teacher.id)
    .sort((a, b) => b.date.localeCompare(a.date));

  const paymentDate = (paymentId?: string) => {
    const p = paymentId ? teacherPayments.find((x) => x.id === paymentId) : undefined;
    return p ? formatDateFr(p.paidAt.slice(0, 10)) : undefined;
  };

  const save = () => {
    if (!draft) return;
    const amount = money(Math.max(0, draft.amount));
    if (amount <= 0) return;
    if (draft.kind === "acompte") {
      const before = acomptes.find((a) => a.id === draft.id);
      if (!before) return;
      updateItem("acomptes", draft.id, {
        amount: draft.amountLocked ? before.amount : amount,
        description: draft.description || "Avance sur salaire",
        date: draft.date,
      });
      // La caisse suit la correction : l'acompte en était sorti.
      const diff = draft.amountLocked ? 0 : money(amount - before.amount);
      if (diff !== 0) {
        push("cash", {
          id: uid("csh"),
          type: "acompte",
          amount: -diff,
          date: new Date().toISOString(),
          description: `Correction de l'acompte de ${name} (${formatDA(before.amount)} → ${formatDA(amount)})`,
        });
      }
    } else {
      updateItem("absences", draft.id, {
        cost: amount,
        description: draft.description || "Absence non justifiée",
        date: draft.date,
      });
    }
    setDraft(null);
  };

  const removeAcompte = (id: string) => {
    const a = acomptes.find((x) => x.id === id);
    if (!a) return;
    if (a.paid) {
      alert(
        "Cet acompte a déjà été retenu par un règlement. Annulez d'abord ce règlement pour pouvoir le supprimer.",
      );
      return;
    }
    if (!confirm(`Supprimer l'acompte de ${formatDA(a.amount)} ? La somme est remise en caisse.`)) return;
    deleteFrom("acomptes", id);
    push("cash", {
      id: uid("csh"),
      type: "acompte",
      amount: a.amount,
      date: new Date().toISOString(),
      description: `Annulation de l'acompte de ${name} (${a.description || "Acompte"})`,
    });
  };

  const removeAbsence = (id: string) => {
    const a = absences.find((x) => x.id === id);
    if (!a) return;
    if (!confirm(`Supprimer cette absence (${formatDA(a.cost)}) ?`)) return;
    deleteFrom("absences", id);
  };

  const isAcompte = kind === "acompte";
  const total = isAcompte
    ? acRows.reduce((s, a) => s + a.amount, 0)
    : abRows.reduce((s, a) => s + a.cost, 0);
  const openTotal = acRows.filter((a) => !a.paid).reduce((s, a) => s + a.amount, 0);

  return (
    <div className="space-y-4">
      {/* En-tête coloré */}
      <div
        className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border-2 p-4 ${
          isAcompte
            ? "border-primary/30 bg-gradient-to-r from-primary-50/80 to-surface"
            : "border-danger/30 bg-gradient-to-r from-danger/10 to-surface"
        }`}
      >
        <div className="flex items-center gap-3">
          <span
            className={`flex h-10 w-10 items-center justify-center rounded-xl ${
              isAcompte ? "bg-primary text-white" : "bg-danger text-white"
            }`}
          >
            {isAcompte ? <Wallet className="h-5 w-5" /> : <UserX className="h-5 w-5" />}
          </span>
          <div>
            <strong className="block text-sm text-ink">
              {isAcompte ? "Historique des acomptes" : "Historique des absences"}
            </strong>
            <span className="text-[11px] text-muted">
              {isAcompte
                ? "Avances sur salaire — retenues sur le règlement de n'importe quel emploi du temps."
                : "Absences et retenues signalées pour cet enseignant."}
            </span>
          </div>
        </div>
        {onAdd && (
          <Button size="sm" onClick={onAdd} className="gap-1.5">
            {isAcompte ? <Wallet className="h-3.5 w-3.5" /> : <UserX className="h-3.5 w-3.5" />}
            {isAcompte ? "Nouvel acompte" : "Nouvelle absence"}
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile
          label={isAcompte ? "Acomptes" : "Absences"}
          value={String(isAcompte ? acRows.length : abRows.length)}
          tone="text-ink"
        />
        <StatTile label="Total" value={formatDA(total)} tone={isAcompte ? "text-primary" : "text-danger"} />
        {isAcompte && (
          <StatTile
            label="Reste à retenir"
            value={formatDA(openTotal)}
            tone={openTotal > 0 ? "text-warning" : "text-success"}
          />
        )}
      </div>

      {isAcompte && openTotal > 0 && (
        <p className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-[11px] leading-relaxed text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {formatDA(openTotal)} d&apos;acompte restent à retenir. Ils apparaissent en alerte sur
          l&apos;écran de paie, quel que soit l&apos;emploi du temps réglé.
        </p>
      )}

      <div className="overflow-hidden rounded-2xl border border-line bg-surface">
        <div className="max-h-80 overflow-auto">
          <table className="w-full min-w-[560px] text-xs">
            <thead className="sticky top-0 bg-canvas">
              <tr className="text-left text-[10px] font-bold uppercase tracking-wider text-muted">
                <th className="p-3">Date</th>
                <th className="p-3">Libellé</th>
                {isAcompte && <th className="p-3 text-center">Statut</th>}
                <th className="p-3 text-right">Montant</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(isAcompte ? acRows.length : abRows.length) === 0 && (
                <tr>
                  <td colSpan={5} className="p-8 text-center italic text-muted">
                    {isAcompte ? "Aucun acompte enregistré." : "Aucune absence enregistrée."}
                  </td>
                </tr>
              )}
              {isAcompte &&
                acRows.map((a) => (
                  <tr
                    key={a.id}
                    className={`border-t border-line/60 transition-colors hover:bg-canvas/40 ${
                      a.paid ? "" : "bg-warning/5"
                    }`}
                  >
                    <td className="p-3 font-mono text-[10px] text-ink">
                      <span className="flex items-center gap-1">
                        <CalendarDays className="h-3 w-3 text-muted" />
                        {formatDateFr(a.date.slice(0, 10))}
                      </span>
                    </td>
                    <td className="p-3">
                      <strong className="block text-ink">{a.description || "Acompte"}</strong>
                      {a.createdByName && (
                        <span className="text-[10px] text-muted">par {a.createdByName}</span>
                      )}
                    </td>
                    <td className="p-3 text-center">
                      {a.paid ? (
                        <Badge tone="success" className="gap-1 text-[9px]">
                          <CheckCircle2 className="h-3 w-3" /> Retenu
                          {paymentDate(a.paymentId) ? ` le ${paymentDate(a.paymentId)}` : ""}
                        </Badge>
                      ) : (
                        <Badge tone="warning" className="gap-1 text-[9px]">
                          <AlertTriangle className="h-3 w-3" /> À retenir
                        </Badge>
                      )}
                    </td>
                    <td className="p-3 text-right font-mono font-bold text-primary">{formatDA(a.amount)}</td>
                    <td className="p-3">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() =>
                            setDraft({
                              kind: "acompte",
                              id: a.id,
                              amount: a.amount,
                              description: a.description,
                              date: a.date.slice(0, 10),
                              amountLocked: !!a.paid,
                            })
                          }
                          className="rounded-lg p-1.5 text-warning hover:bg-warning/10"
                          title="Modifier"
                        >
                          <Edit className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => removeAcompte(a.id)}
                          className="rounded-lg p-1.5 text-danger hover:bg-danger/10"
                          title="Supprimer"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              {!isAcompte &&
                abRows.map((a) => (
                  <tr key={a.id} className="border-t border-line/60 transition-colors hover:bg-canvas/40">
                    <td className="p-3 font-mono text-[10px] text-ink">
                      <span className="flex items-center gap-1">
                        <CalendarDays className="h-3 w-3 text-muted" />
                        {formatDateFr(a.date.slice(0, 10))}
                      </span>
                    </td>
                    <td className="p-3">
                      <strong className="block text-ink">{a.description || "Absence"}</strong>
                      {a.createdByName && (
                        <span className="text-[10px] text-muted">par {a.createdByName}</span>
                      )}
                    </td>
                    <td className="p-3 text-right font-mono font-bold text-danger">− {formatDA(a.cost)}</td>
                    <td className="p-3">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() =>
                            setDraft({
                              kind: "absence",
                              id: a.id,
                              amount: a.cost,
                              description: a.description,
                              date: a.date.slice(0, 10),
                              amountLocked: false,
                            })
                          }
                          className="rounded-lg p-1.5 text-warning hover:bg-warning/10"
                          title="Modifier"
                        >
                          <Edit className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => removeAbsence(a.id)}
                          className="rounded-lg p-1.5 text-danger hover:bg-danger/10"
                          title="Supprimer"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal
        open={!!draft}
        onClose={() => setDraft(null)}
        title={draft?.kind === "acompte" ? "Modifier l'acompte" : "Modifier l'absence"}
      >
        {draft && (
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted">
                Montant (DA)
              </label>
              <Input
                type="number"
                min={0}
                value={draft.amount || ""}
                disabled={draft.amountLocked}
                onChange={(e) => setDraft({ ...draft, amount: Number(e.target.value) || 0 })}
              />
              {draft.amountLocked && (
                <span className="mt-1 block text-[10px] text-muted">
                  Déjà retenu par un règlement : le montant ne se modifie plus.
                </span>
              )}
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted">
                Libellé
              </label>
              <Input
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted">
                Date
              </label>
              <Input
                type="date"
                value={draft.date}
                onChange={(e) => setDraft({ ...draft, date: e.target.value })}
              />
            </div>
            <div className="flex justify-end gap-2 border-t border-line pt-3">
              <Button variant="outline" onClick={() => setDraft(null)}>
                Annuler
              </Button>
              <Button onClick={save}>Enregistrer</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

/** Une ligne de chiffre dans la carte d'un règlement. */
export function SettlementFigure({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: string;
}) {
  return (
    <div className="rounded-lg bg-surface/80 px-2.5 py-1.5 text-center">
      <span className="block text-[9px] font-semibold uppercase tracking-wider text-muted">{label}</span>
      <strong className={`font-mono text-xs ${tone}`}>{value}</strong>
    </div>
  );
}
