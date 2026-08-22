"use client";

/**
 * "Payer & recharger" — the ONE money action of a student's card.
 *
 * It replaces the old "Inscriptions" + "Renouvellement" pair: everything a
 * cashier needs is here. For each emploi du temps the student follows it shows
 * where his SOLDE stands (positive, empty, or in the red), how far into the
 * current month he is, and it flags what needs attention — dette, solde à zéro,
 * ou solde qui ne couvre plus que la ou les dernières séances.
 *
 * The months listed are the emploi's OWN (M1, M2 …): M1 opens on the student's
 * first présence and closes on the last séance of the pack. The filter walks
 * through them, and any of them can be topped up — with its receipt.
 */

import { useMemo, useState } from "react";
import { useData } from "@/lib/store/data";
import { useSettings } from "@/lib/store/settings";
import { useToast } from "@/lib/store/toast";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input, Select } from "@/components/ui/SearchInput";
import { PrintAsk } from "@/components/attendance/PresenceSheet";
import { formatDA } from "@/lib/utils";
import { soldReceiptHtml } from "@/lib/reports/documents";
import {
  ClassTimingPicker,
  toggleTimingSelection,
} from "@/components/students/ClassTimingPicker";
import { AlertTriangle, CheckCircle2, Clock, Gift, Plus, Wallet } from "lucide-react";
import type { Student } from "@/lib/types";
import {
  cycleOf,
  cycleSizeOf,
  currentCycleIndex,
  enrollmentCycles,
  formatDays,
  groupName,
  isFreeSub,
  monthCodeLabel,
  moduleName as moduleNameOf,
  registrationNumberOf,
  salleName,
  soldFor,
  soldStatus,
  studentListPrice,
  studentMonthPrice,
  studentName,
  teacherName,
  todayIso,
} from "@/lib/helpers";

const ALERTS: Record<string, { label: string; tone: "danger" | "warning" | "success"; icon: typeof AlertTriangle }> = {
  debt: { label: "En dette", tone: "danger", icon: AlertTriangle },
  empty: { label: "Solde épuisé", tone: "warning", icon: AlertTriangle },
  low: { label: "Bientôt épuisé", tone: "warning", icon: Clock },
  ok: { label: "À jour", tone: "success", icon: CheckCircle2 },
  /** la gratuité se coche emploi par emploi : celui-ci est offert */
  offered: { label: "Offert", tone: "success", icon: Gift },
};

export function SoldManagerModal({
  student,
  open,
  onClose,
}: {
  student: Student;
  open: boolean;
  onClose: () => void;
}) {
  const db = useData();
  const { addSold, subscriptions, sessions, subscribeStudent, unsubscribeStudent } = db;
  const { language } = useSettings();
  const { addToast } = useToast();

  const [monthFilter, setMonthFilter] = useState<string>("current");
  const [target, setTarget] = useState<{
    subscriptionId: string;
    label: string;
    monthCode: string;
    amount: number;
    suggestion: number;
    description: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [receipt, setReceipt] = useState<string | null>(null);

  /** Everything the student follows, with where his money stands on each. */
  const rows = useMemo(
    () =>
      student.subscriptionIds.flatMap((subId) => {
        const sub = subscriptions.find((s) => s.id === subId);
        if (!sub) return [];
        const session = sessions.find((s) => s.id === sub.sessionId);
        if (!session) return [];
        const sold = soldFor(db, student.id, subId);
        const curIdx = currentCycleIndex(db, student.id, subId);
        const code = monthFilter === "current" ? `M${curIdx + 1}` : monthFilter;
        const cycle = cycleOf(db, student.id, subId, code);
        // Son tarif à LUI : « école seule » ne paie que la part de l'école.
        const unit = studentListPrice(student, sub);
        const monthPrice = studentMonthPrice(student, sub);
        // Un emploi du temps OFFERT n'a rien à recharger : son solde est « à
        // jour » par construction, quoi qu'il porte.
        const offered = isFreeSub(student, subId);
        const status = offered ? "ok" : soldStatus(sold, unit);
        return [
          {
            subId,
            sub,
            session,
            unit,
            monthPrice,
            label: session.title || moduleNameOf(db, session.moduleId) || "Emploi du temps",
            sold,
            code,
            cycle,
            status,
            offered,
            monthsInDebt: enrollmentCycles(db, student.id, subId).filter((c) => c.balance < 0),
          },
        ];
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [student, subscriptions, sessions, monthFilter, db.enrollments, db.payments, db.attendance],
  );

  /** Deepest month any of his emplois has reached — sizes the filter. */
  const maxMonth = rows.reduce(
    (mx, r) => Math.max(mx, currentCycleIndex(db, student.id, r.subId) + 1),
    1,
  );

  const totalSold = rows.reduce((s, r) => s + r.sold, 0);
  const totalDebt = rows.reduce((s, r) => s + Math.max(0, -r.sold), 0);

  const submit = async () => {
    if (!target) return;
    const amount = Math.max(0, Math.round(target.amount || 0));
    if (amount <= 0) {
      addToast({ type: "danger", title: "Montant invalide", message: "Saisissez un montant." });
      return;
    }
    setBusy(true);
    const res = await addSold({
      studentId: student.id,
      subscriptionId: target.subscriptionId,
      amount,
      monthCode: target.monthCode,
      description: target.description || undefined,
    });
    setBusy(false);
    if (!res.ok) {
      addToast({ type: "danger", title: "Échec", message: "Le paiement n'a pas pu être enregistré." });
      return;
    }
    addToast({
      type: "success",
      title: "Solde rechargé",
      message: `${formatDA(amount)} sur ${target.label} (${target.monthCode}) — nouveau solde ${formatDA(res.balance ?? 0)}`,
      studentName: studentName(student),
    });
    setReceipt(
      soldReceiptHtml(db, {
        student,
        language,
        title: "Reçu de rechargement",
        lines: [
          {
            label: target.label,
            monthCode: res.monthCode ?? target.monthCode,
            amount,
            balanceAfter: res.balance ?? 0,
          },
        ],
        note: target.description || undefined,
      }),
    );
    setTarget(null);
  };

  return (
    <>
      <Modal open={open} onClose={onClose} title="Payer & recharger les soldes" wide>
        <div className="space-y-4">
          {/* Who, and where he stands overall */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-primary-50/60 p-4">
            <div>
              <strong className="block text-sm text-ink">{studentName(student)}</strong>
              <span className="text-[11px] text-muted">
                N° {registrationNumberOf(db, student)} · {student.phone || "—"}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={totalSold < 0 ? "danger" : totalSold === 0 ? "warning" : "success"}>
                Solde total {formatDA(totalSold)}
              </Badge>
              {totalDebt > 0 && <Badge tone="danger">Dette {formatDA(totalDebt)}</Badge>}
            </div>
          </div>

          {/* Month filter — the emploi's own months */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted">
              Mois affiché
            </span>
            <Select
              value={monthFilter}
              onChange={(e) => setMonthFilter(e.target.value)}
              className="min-w-[170px]"
            >
              <option value="current">Mois en cours</option>
              {Array.from({ length: Math.max(6, maxMonth + 2) }, (_, i) => `M${i + 1}`).map((c) => (
                <option key={c} value={c}>
                  {monthCodeLabel(c)}
                </option>
              ))}
            </Select>
            <span className="text-[10px] text-muted">
              Chaque emploi du temps compte ses propres mois : M1 s&apos;ouvre à la 1<sup>re</sup>{" "}
              présence et se ferme à la dernière séance du pack.
            </span>
          </div>

          {/* One card per emploi du temps */}
          {rows.length === 0 ? (
            <p className="rounded-xl border border-line bg-canvas/40 p-6 text-center text-xs italic text-muted">
              Cet élève n&apos;est inscrit sur aucun emploi du temps.
            </p>
          ) : (
            <div className="space-y-2">
              {rows.map((r) => {
                const alert = ALERTS[r.offered ? "offered" : r.status];
                const AlertIcon = alert.icon;
                const monthDebt = Math.max(0, -r.cycle.balance);
                return (
                  <div key={r.subId} className="rounded-2xl border border-line bg-surface p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <strong className="block text-sm text-ink">{r.label}</strong>
                        <span className="block text-[10px] text-muted">
                          Groupe {groupName(db, r.session.groupId)} ·{" "}
                          {formatDays(r.session.days) || "—"} · {r.session.startTime}–
                          {r.session.endTime} · {salleName(db, r.session.salleId)}
                        </span>
                        <span className="block text-[10px] text-muted">
                          {teacherName(db, r.session.teacherId)} · {cycleSizeOf(r.sub)} séances /
                          mois ·{" "}
                          {r.offered ? (
                            <strong className="text-success">
                              offert — rien à encaisser sur cet emploi du temps
                            </strong>
                          ) : (
                            <>
                              séance à {formatDA(r.unit)}
                              {r.monthPrice > 0 ? ` · mois à ${formatDA(r.monthPrice)}` : ""}
                            </>
                          )}
                        </span>
                      </div>
                      <Badge tone={alert.tone} className="gap-1 shrink-0">
                        <AlertIcon className="h-3 w-3" /> {alert.label}
                      </Badge>
                    </div>

                    <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <Tile label="Solde actuel" value={formatDA(r.sold)} tone={r.sold < 0 ? "danger" : r.sold === 0 ? "warning" : "success"} />
                      <Tile
                        label={`Avancement ${r.code}`}
                        value={`${r.cycle.done}/${r.cycle.size}`}
                        hint={r.cycle.complete ? "mois clos" : "séances faites"}
                      />
                      <Tile
                        label={`Versé sur ${r.code}`}
                        value={formatDA(r.cycle.credited)}
                        tone="neutral"
                      />
                      <Tile
                        label={`Reste ${r.code}`}
                        value={monthDebt > 0 ? `− ${formatDA(monthDebt)}` : formatDA(r.cycle.balance)}
                        tone={monthDebt > 0 ? "danger" : "success"}
                      />
                    </div>

                    {r.monthsInDebt.length > 0 && (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-xl border border-danger/30 bg-danger/5 p-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-danger">
                          Mois en dette
                        </span>
                        {r.monthsInDebt.map((c) => (
                          <button
                            key={c.code}
                            onClick={() =>
                              setTarget({
                                subscriptionId: r.subId,
                                label: r.label,
                                monthCode: c.code,
                                amount: -c.balance,
                                suggestion: -c.balance,
                                description: `Règlement ${c.code} — ${r.label}`,
                              })
                            }
                            className="rounded-lg border border-danger/40 bg-danger/10 px-2 py-1 text-[10px] font-bold text-danger hover:bg-danger/20"
                          >
                            {c.code} · {formatDA(-c.balance)}
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="mt-2.5 flex justify-end">
                      <Button
                        size="sm"
                        onClick={() =>
                          setTarget({
                            subscriptionId: r.subId,
                            label: r.label,
                            monthCode: r.code,
                            amount: monthDebt || r.monthPrice || 0,
                            suggestion: monthDebt || r.monthPrice || 0,
                            description: "",
                          })
                        }
                        className="gap-1.5"
                      >
                        <Wallet className="h-3.5 w-3.5" /> Nouveau solde
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Enrolling him on ANOTHER emploi du temps — the only other thing a
              cashier ever needs on this screen, so it lives here rather than
              behind a second button on the card. */}
          <div className="rounded-2xl border border-line bg-canvas/30 p-3">
            <button
              onClick={() => setAdding((v) => !v)}
              className="flex w-full items-center justify-between text-[10px] font-bold uppercase tracking-wider text-primary"
            >
              <span className="flex items-center gap-1.5">
                <Plus className="h-3.5 w-3.5" /> Inscrire sur un autre emploi du temps
              </span>
              <span className="text-muted">{adding ? "Masquer" : "Afficher"}</span>
            </button>
            {adding && (
              <div className="mt-3 space-y-3">
                <ClassTimingPicker
                  selectedSubIds={student.subscriptionIds}
                  onToggle={async (opt) => {
                    // The tick may swap one group of a course for another, so
                    // what LEAVES is unsubscribed and what ARRIVES is written
                    // where the group stands today.
                    const next = toggleTimingSelection(student.subscriptionIds, opt);
                    for (const subId of student.subscriptionIds) {
                      if (!next.includes(subId)) await unsubscribeStudent(student.id, subId);
                    }
                    for (const subId of next) {
                      if (!student.subscriptionIds.includes(subId)) {
                        const res = await subscribeStudent({
                          studentId: student.id,
                          subscriptionId: subId,
                          date: todayIso(),
                        });
                        if (res.ok) {
                          addToast({
                            type: "success",
                            title: "Inscrit sur l'emploi du temps",
                            message: `Il entre en ${res.monthCode} · séance ${
                              (res.slotIndex ?? 0) + 1
                            } — là où en est le groupe.`,
                            studentName: studentName(student),
                          });
                        }
                      }
                    }
                  }}
                  showTotal={false}
                />
                <p className="text-[10px] text-muted">
                  Cochez un créneau pour l&apos;ajouter à sa fiche : il entre LÀ OÙ EN EST LE
                  GROUPE (mois et séance en cours), son solde s&apos;ouvre à 0 et se recharge
                  ci-dessus.
                </p>
              </div>
            )}
          </div>

          <div className="flex justify-end border-t border-line pt-3">
            <Button variant="outline" onClick={onClose}>
              Fermer
            </Button>
          </div>
        </div>
      </Modal>

      {/* The cash-in itself */}
      {target && (
        <Modal open onClose={() => setTarget(null)} title="Nouveau solde">
          <div className="space-y-3">
            <div className="rounded-xl bg-primary-50/60 p-3">
              <strong className="block text-sm text-ink">{target.label}</strong>
              <span className="text-[11px] text-muted">
                {studentName(student)} · N° {registrationNumberOf(db, student)}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted">
                  Mois crédité
                </label>
                <Select
                  value={target.monthCode}
                  onChange={(e) => setTarget({ ...target, monthCode: e.target.value })}
                  className="w-full"
                >
                  {Array.from({ length: Math.max(6, maxMonth + 2) }, (_, i) => `M${i + 1}`).map((c) => (
                    <option key={c} value={c}>
                      {monthCodeLabel(c)}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted">
                  Montant versé (DA)
                </label>
                <Input
                  type="number"
                  min={0}
                  autoFocus
                  value={target.amount || ""}
                  onChange={(e) => setTarget({ ...target, amount: Number(e.target.value) || 0 })}
                  placeholder="Ex: 4000"
                />
              </div>
            </div>
            {target.suggestion > 0 && (
              <button
                onClick={() => setTarget({ ...target, amount: target.suggestion })}
                className="text-[11px] font-bold text-primary hover:underline"
              >
                Proposer {formatDA(target.suggestion)}
              </button>
            )}
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted">
                Description (optionnel)
              </label>
              <Input
                value={target.description}
                onChange={(e) => setTarget({ ...target, description: e.target.value })}
                placeholder="Laisser vide pour la description automatique"
              />
            </div>
            <div className="flex justify-end gap-2 border-t border-line pt-3">
              <Button variant="outline" onClick={() => setTarget(null)}>
                Annuler
              </Button>
              <Button onClick={submit} disabled={busy}>
                Encaisser
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {receipt && <PrintAsk html={receipt} onClose={() => setReceipt(null)} />}
    </>
  );
}

function Tile({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "danger" | "warning" | "success" | "neutral";
}) {
  const tones: Record<string, string> = {
    danger: "border-danger/40 bg-danger/10 text-danger",
    warning: "border-warning/40 bg-warning/10 text-warning",
    success: "border-success/40 bg-success/10 text-success",
    neutral: "border-line bg-canvas/60 text-ink",
  };
  return (
    <div className={`rounded-xl border px-2 py-1.5 ${tones[tone]}`}>
      <span className="block text-[9px] font-semibold uppercase tracking-wide text-muted">{label}</span>
      <strong className="block text-sm">{value}</strong>
      {hint && <span className="block text-[9px] text-muted">{hint}</span>}
    </div>
  );
}
