"use client";

/**
 * LES FRAIS D'UN ÉLÈVE — la dette qui n'est pas de la scolarité.
 *
 * Un livre, une tenue de sport, une sortie, un transport, un dégât, ou la
 * somme que l'école a avancée de sa caisse pour ne pas faire attendre un
 * enseignant : autant de dettes qui n'ont rien à voir avec le prix d'une
 * séance, et qui pourtant se réclament au même guichet, à la même famille.
 *
 * Ce fichier porte les trois pièces que TOUS les écrans réutilisent :
 *
 *   ChargeFormModal        — la saisie : un nom, un montant, une date, et une
 *                            description si elle sert à quelque chose ;
 *   ChargeSettlementPanel  — l'encaissement : on coche les frais à régler, on
 *                            corrige chaque montant, et ce qui n'est pas versé
 *                            RESTE DÛ, affiché avant même de valider ;
 *   StudentChargesModal    — les deux ensemble, plus l'historique, pour l'écran
 *                            des élèves et la feuille de présence d'un groupe.
 *
 * Un frais NE RETIENT JAMAIS la paie d'un enseignant. C'est la différence de
 * fond avec la scolarité : le professeur de mathématiques n'a pas à attendre
 * qu'un livre soit payé.
 */

import { useMemo, useState } from "react";
import { useData } from "@/lib/store/data";
import { useSettings } from "@/lib/store/settings";
import { useToast } from "@/lib/store/toast";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/SearchInput";
import { PrintAsk } from "@/components/ui/PrintAsk";
import { chargeReceiptHtml, type ChargeReceiptLine } from "@/lib/reports/documents";
import { formatDA } from "@/lib/utils";
import type { Student, StudentCharge } from "@/lib/types";
import {
  chargePayments,
  chargeRemaining,
  dayKeyOf,
  formatDateFr,
  registrationNumberOf,
  studentChargeDebt,
  studentChargesOf,
  studentName,
  todayIso,
} from "@/lib/helpers";
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  Landmark,
  Pencil,
  Plus,
  Receipt,
  Trash2,
} from "lucide-react";

// ---------------------------------------------------------------------------
// 1. La saisie d'un frais
// ---------------------------------------------------------------------------

export function ChargeFormModal({
  student,
  charge,
  onClose,
}: {
  student: Student;
  /** un frais à corriger, ou rien pour en créer un */
  charge?: StudentCharge | null;
  onClose: () => void;
}) {
  const db = useData();
  const { addToast } = useToast();

  const [name, setName] = useState(charge?.name ?? "");
  const [amount, setAmount] = useState(charge?.amount ?? 0);
  const [description, setDescription] = useState(charge?.description ?? "");
  const [date, setDate] = useState(charge?.date || todayIso());
  const [busy, setBusy] = useState(false);

  const alreadyPaid = charge ? (charge.paidAmount ?? 0) : 0;

  const submit = async () => {
    if (!name.trim()) {
      addToast({ type: "danger", title: "Nom manquant", message: "Nommez ce frais." });
      return;
    }
    if (amount <= 0) {
      addToast({ type: "danger", title: "Montant invalide", message: "Saisissez un montant." });
      return;
    }
    setBusy(true);
    const res = await db.saveStudentCharge({
      id: charge?.id,
      studentId: student.id,
      name,
      amount,
      description,
      date,
    });
    setBusy(false);
    if (!res.ok) {
      addToast({ type: "danger", title: "Échec", message: "Ce frais n'a pas pu être enregistré." });
      return;
    }
    addToast({
      type: "success",
      title: charge ? "Frais corrigé" : "Frais enregistré",
      message: `${name.trim()} — ${formatDA(amount)} au ${formatDateFr(date)}`,
      studentName: studentName(student),
    });
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={charge ? "Corriger le frais" : "Nouvelle dette / nouveau frais"}
    >
      <div className="space-y-3">
        <div className="rounded-xl bg-primary-50/60 p-3">
          <strong className="block text-sm text-ink">{studentName(student)}</strong>
          <span className="text-[11px] text-muted">
            N° {registrationNumberOf(db, student)} · {student.phone || "—"}
          </span>
        </div>

        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted">
            Nom du frais
          </label>
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex : Livre de mathématiques, Tenue de sport, Sortie…"
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted">
              Montant (DA)
            </label>
            <Input
              type="number"
              min={0}
              value={amount || ""}
              onChange={(e) => setAmount(Math.max(0, Number(e.target.value) || 0))}
              placeholder="Ex : 1200"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted">
              Date
            </label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted">
            Description (optionnel)
          </label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Le nom suffit la plupart du temps — précisez si besoin"
          />
        </div>

        {charge && alreadyPaid > 0 && (
          <p className="rounded-xl border border-warning/40 bg-warning/10 p-2.5 text-[11px] text-warning">
            {formatDA(alreadyPaid)} ont déjà été versés sur ce frais. Corriger son montant ne
            reprend rien à la famille : il restera{" "}
            <strong>{formatDA(Math.max(0, amount - alreadyPaid))}</strong> à payer.
          </p>
        )}

        <p className="rounded-xl border border-line bg-canvas/50 p-2.5 text-[10px] leading-relaxed text-muted">
          Un frais s&apos;affiche en alerte sur la fiche de l&apos;élève et sur la feuille de
          présence de ses groupes, et se règle en une ou plusieurs fois. Il ne retient{" "}
          <strong className="text-ink">pas</strong> la paie de l&apos;enseignant : seule la
          scolarité le fait.
        </p>

        <div className="flex justify-end gap-2 border-t border-line pt-3">
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={submit} disabled={busy} className="gap-1.5">
            <Receipt className="h-4 w-4" /> {charge ? "Enregistrer" : "Créer le frais"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// 2. L'encaissement — le bloc que la feuille de présence et « Payer &
//    recharger » affichent tous les deux, à l'identique.
// ---------------------------------------------------------------------------

export function ChargeSettlementPanel({
  student,
  bare = false,
  onPaid,
}: {
  student: Student;
  /** rendu compact : sans le rappel d'identité, quand l'écran le porte déjà */
  bare?: boolean;
  onPaid?: () => void;
}) {
  const db = useData();
  const { language } = useSettings();
  const { addToast } = useToast();

  /** chargeId -> ce que la famille verse dessus (absent = non coché) */
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [date, setDate] = useState(todayIso());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<string | null>(null);

  const open = useMemo(
    () => studentChargesOf(db, student.id).filter((c) => chargeRemaining(c) > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [db.studentCharges, student.id],
  );

  const dueTotal = open.reduce((t, c) => t + chargeRemaining(c), 0);
  const picking = open.filter((c) => picked[c.id] !== undefined);
  const paying = picking.reduce((t, c) => t + Math.min(picked[c.id] || 0, chargeRemaining(c)), 0);
  const restAfter = Math.max(0, dueTotal - paying);

  const toggle = (charge: StudentCharge) =>
    setPicked((prev) => {
      const next = { ...prev };
      if (next[charge.id] !== undefined) delete next[charge.id];
      else next[charge.id] = chargeRemaining(charge);
      return next;
    });

  const pickAll = () => setPicked(Object.fromEntries(open.map((c) => [c.id, chargeRemaining(c)])));

  const submit = async () => {
    const lines = picking
      .map((c) => ({ chargeId: c.id, amount: Math.min(picked[c.id] || 0, chargeRemaining(c)) }))
      .filter((l) => l.amount > 0);
    if (lines.length === 0) {
      addToast({
        type: "danger",
        title: "Rien à encaisser",
        message: "Cochez au moins un frais et saisissez un montant.",
      });
      return;
    }

    // Ce que le reçu doit dire, capturé AVANT l'écriture : après, les frais
    // soldés ont quitté la liste.
    const receiptLines: ChargeReceiptLine[] = lines.map((l) => {
      const charge = open.find((c) => c.id === l.chargeId)!;
      return {
        label: charge.name,
        date: charge.date,
        total: charge.amount,
        amount: l.amount,
        remaining: Math.max(0, chargeRemaining(charge) - l.amount),
      };
    });

    setBusy(true);
    const res = await db.payStudentCharges({
      studentId: student.id,
      lines,
      date,
      description: note,
    });
    setBusy(false);

    if (!res.ok) {
      addToast({
        type: "danger",
        title: "Échec",
        message: "Le règlement n'a pas pu être enregistré.",
      });
      return;
    }

    addToast({
      type: "success",
      title: "Frais encaissés",
      message:
        `${formatDA(res.paid ?? 0)} encaissés le ${formatDateFr(date)} — ` +
        ((res.rest ?? 0) > 0
          ? `il doit encore ${formatDA(res.rest ?? 0)} de frais`
          : "plus aucun frais en attente"),
      studentName: studentName(student),
    });
    setReceipt(
      chargeReceiptHtml(db, {
        student,
        language,
        lines: receiptLines,
        note: note.trim() || undefined,
        restAfter: res.rest ?? 0,
      }),
    );
    setPicked({});
    setNote("");
    onPaid?.();
  };

  if (open.length === 0) {
    return (
      <>
        <div className="rounded-2xl border border-success/40 bg-success/10 p-4 text-center text-xs text-success">
          <CheckCircle2 className="mx-auto mb-1 h-5 w-5" />
          Aucun frais en attente : cet élève ne doit rien en dehors de sa scolarité.
        </div>
        {receipt && <PrintAsk html={receipt} onClose={() => setReceipt(null)} />}
      </>
    );
  }

  return (
    <>
      <div className="space-y-3">
        {!bare && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-primary-50/60 p-3">
            <div className="min-w-0">
              <strong className="block text-sm text-ink">{studentName(student)}</strong>
              <span className="text-[11px] text-muted">
                N° {registrationNumberOf(db, student)} · {student.phone || "—"}
              </span>
            </div>
            <Badge tone="danger" className="font-mono">
              {formatDA(dueTotal)} de frais dus
            </Badge>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-danger">
            <AlertTriangle className="h-3.5 w-3.5" /> {open.length} frais en attente ·{" "}
            {formatDA(dueTotal)}
          </span>
          <button onClick={pickAll} className="text-[11px] font-bold text-primary hover:underline">
            Tout cocher
          </button>
        </div>

        {/* Un frais par ligne : coché ou non, et pour combien. */}
        <div className="max-h-[38vh] space-y-1.5 overflow-y-auto pr-1">
          {open.map((c) => {
            const left = chargeRemaining(c);
            const isPicked = picked[c.id] !== undefined;
            const value = picked[c.id] ?? 0;
            const advance = c.origin === "school_advance";
            return (
              <div
                key={c.id}
                className={`rounded-xl border p-2.5 transition-colors ${
                  isPicked ? "border-primary bg-primary-50/50" : "border-line bg-surface"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2">
                    <input
                      type="checkbox"
                      checked={isPicked}
                      onChange={() => toggle(c)}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--primary)]"
                    />
                    <span className="min-w-0">
                      <strong className="block text-xs text-ink">{c.name}</strong>
                      <span className="block text-[10px] text-muted">
                        {formatDateFr(c.date)}
                        {c.description ? ` · ${c.description}` : ""}
                      </span>
                      {(c.paidAmount ?? 0) > 0 && (
                        <span className="block text-[10px] text-success">
                          déjà versé {formatDA(c.paidAmount ?? 0)} sur {formatDA(c.amount)}
                        </span>
                      )}
                    </span>
                  </label>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {advance && (
                      <Badge
                        tone="warning"
                        className="gap-1 text-[9px]"
                        title="L'école a réglé cette dette de sa propre caisse pour débloquer la part de l'enseignant — la famille la lui doit."
                      >
                        <Landmark className="h-3 w-3" /> Avancé par l&apos;école
                      </Badge>
                    )}
                    <Badge tone="danger" className="font-mono text-[10px]">
                      {formatDA(left)}
                    </Badge>
                  </span>
                </div>

                {isPicked && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line/60 pt-2">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-muted">
                      Montant versé
                    </label>
                    <Input
                      type="number"
                      min={0}
                      max={left}
                      value={value || ""}
                      onChange={(e) =>
                        setPicked((prev) => ({
                          ...prev,
                          [c.id]: Math.max(0, Math.min(left, Number(e.target.value) || 0)),
                        }))
                      }
                      className="h-8 w-32 text-xs"
                    />
                    <button
                      onClick={() => setPicked((prev) => ({ ...prev, [c.id]: left }))}
                      className="text-[10px] font-bold text-primary hover:underline"
                    >
                      Tout ({formatDA(left)})
                    </button>
                    {value < left && (
                      <span className="text-[10px] font-semibold text-warning">
                        il restera {formatDA(left - value)} dus sur ce frais
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Le jour de l'encaissement et la note du reçu */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted">
              Date du paiement
            </label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted">
              Description (optionnel)
            </label>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Laisser vide pour la description automatique"
            />
          </div>
        </div>

        {/* Ce que le versement laisse derrière lui, avant même de valider. */}
        <div
          className={`rounded-xl border p-2.5 text-[11px] leading-relaxed ${
            restAfter > 0
              ? "border-warning/40 bg-warning/10 text-warning"
              : "border-success/40 bg-success/10 text-success"
          }`}
        >
          <span className="block">
            À encaisser : <strong>{formatDA(paying)}</strong> sur {formatDA(dueTotal)} dus.
          </span>
          {restAfter > 0 ? (
            <span className="block">
              Il restera <strong>{formatDA(restAfter)}</strong> de frais à payer — l&apos;alerte
              reste affichée tant que ce reste n&apos;est pas réglé.
            </span>
          ) : paying > 0 ? (
            <span className="block">Tous ses frais seront soldés.</span>
          ) : (
            <span className="block">Cochez un frais pour l&apos;encaisser.</span>
          )}
        </div>

        <div className="flex justify-end border-t border-line pt-3">
          <Button onClick={submit} disabled={busy || paying <= 0} className="gap-1.5">
            <Banknote className="h-4 w-4" /> Encaisser {paying > 0 ? formatDA(paying) : ""}
          </Button>
        </div>
      </div>

      {receipt && <PrintAsk html={receipt} onClose={() => setReceipt(null)} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// 3. L'écran complet : créer, encaisser, relire.
// ---------------------------------------------------------------------------

export function StudentChargesModal({
  student,
  onClose,
  initialTab = "list",
}: {
  student: Student;
  onClose: () => void;
  /** ouvrir directement sur l'encaissement plutôt que sur la liste */
  initialTab?: "list" | "pay";
}) {
  const db = useData();
  const { addToast } = useToast();
  const [tab, setTab] = useState<"list" | "pay">(initialTab);
  const [form, setForm] = useState<{ charge?: StudentCharge } | null>(null);

  const rows = studentChargesOf(db, student.id);
  const due = studentChargeDebt(db, student.id);

  const remove = async (charge: StudentCharge) => {
    const paid = charge.paidAmount ?? 0;
    if (
      !confirm(
        paid > 0
          ? `Supprimer « ${charge.name} » ? Les ${formatDA(paid)} déjà encaissés seront eux aussi retirés de la caisse.`
          : `Supprimer « ${charge.name} » ?`,
      )
    )
      return;
    const res = await db.deleteStudentCharge(charge.id);
    addToast({
      type: res.ok ? "success" : "danger",
      title: res.ok ? "Frais supprimé" : "Suppression impossible",
      message: res.ok
        ? `« ${charge.name} » a été retiré du compte de l'élève.`
        : "Ce frais n'a pas pu être supprimé.",
      studentName: studentName(student),
    });
  };

  return (
    <>
      <Modal open onClose={onClose} title="Dettes & frais de l'élève" wide>
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-primary-50/60 p-4">
            <div className="min-w-0">
              <strong className="block text-sm text-ink">{studentName(student)}</strong>
              <span className="text-[11px] text-muted">
                N° {registrationNumberOf(db, student)} · {student.phone || "—"}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={due > 0 ? "danger" : "success"} className="font-mono">
                {due > 0 ? `${formatDA(due)} de frais dus` : "Aucun frais dû"}
              </Badge>
              <Button size="sm" onClick={() => setForm({})} className="gap-1.5">
                <Plus className="h-3.5 w-3.5" /> Nouveau frais
              </Button>
            </div>
          </div>

          <div className="flex gap-2 border-b border-line">
            <button
              onClick={() => setTab("list")}
              className={`flex items-center gap-1.5 border-b-2 px-4 pb-2.5 text-xs font-semibold transition-colors ${
                tab === "list"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted hover:text-ink"
              }`}
            >
              <Receipt className="h-4 w-4" /> Les frais ({rows.length})
            </button>
            <button
              onClick={() => setTab("pay")}
              className={`flex items-center gap-1.5 border-b-2 px-4 pb-2.5 text-xs font-semibold transition-colors ${
                tab === "pay"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted hover:text-ink"
              }`}
            >
              <Banknote className="h-4 w-4" /> Encaisser
            </button>
          </div>

          {tab === "pay" ? (
            <ChargeSettlementPanel student={student} bare />
          ) : rows.length === 0 ? (
            <p className="rounded-xl border border-line bg-canvas/40 p-6 text-center text-xs italic text-muted">
              Aucun frais n&apos;a été porté au compte de cet élève.
            </p>
          ) : (
            <div className="space-y-2">
              {rows.map((c) => (
                <ChargeCard
                  key={c.id}
                  charge={c}
                  onEdit={() => setForm({ charge: c })}
                  onDelete={() => remove(c)}
                />
              ))}
            </div>
          )}

          <div className="flex justify-end border-t border-line pt-3">
            <Button variant="outline" onClick={onClose}>
              Fermer
            </Button>
          </div>
        </div>
      </Modal>

      {form && (
        <ChargeFormModal student={student} charge={form.charge} onClose={() => setForm(null)} />
      )}
    </>
  );
}

/** Une ligne d'historique : le frais, ce qu'il a coûté, et chaque versement. */
export function ChargeCard({
  charge,
  onEdit,
  onDelete,
}: {
  charge: StudentCharge;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const db = useData();
  const left = chargeRemaining(charge);
  const settlements = chargePayments(db, charge.id);
  const advance = charge.origin === "school_advance";

  return (
    <div
      className={`rounded-2xl border p-3 ${
        left > 0 ? "border-danger/40 bg-danger/5" : "border-success/40 bg-success/5"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <strong className="block text-sm text-ink">{charge.name}</strong>
          <span className="block text-[10px] text-muted">
            {formatDateFr(charge.date)}
            {charge.description ? ` · ${charge.description}` : ""}
          </span>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {advance && (
            <Badge tone="warning" className="gap-1 text-[9px]">
              <Landmark className="h-3 w-3" /> Avancé par l&apos;école
            </Badge>
          )}
          <Badge tone={left > 0 ? "danger" : "success"} className="font-mono text-[10px]">
            {left > 0 ? `${formatDA(left)} dus` : "Soldé ✅"}
          </Badge>
          {onEdit && (
            <button
              onClick={onEdit}
              title="Corriger ce frais"
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-line text-primary hover:bg-primary-50"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
          {onDelete && (
            <button
              onClick={onDelete}
              title="Supprimer ce frais et ses règlements"
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-line text-danger hover:bg-danger/10"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="mt-2 grid grid-cols-3 gap-2 text-center">
        <Cell label="Montant" value={formatDA(charge.amount)} />
        <Cell label="Déjà versé" value={formatDA(charge.paidAmount ?? 0)} tone="success" />
        <Cell label="Reste dû" value={formatDA(left)} tone={left > 0 ? "danger" : "success"} />
      </div>

      {settlements.length > 0 && (
        <div className="mt-2 space-y-1 border-t border-line/60 pt-2">
          <span className="text-[9px] font-bold uppercase tracking-wider text-muted">
            Règlements ({settlements.length})
          </span>
          {settlements.map((p) => (
            <div key={p.id} className="flex items-center justify-between text-[10px]">
              <span className="text-muted">
                {formatDateFr(dayKeyOf(p.date))}
                {p.description ? ` · ${p.description}` : ""}
              </span>
              <strong className="font-mono text-success">{formatDA(p.amountPaid)}</strong>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Cell({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "danger" | "success" | "neutral";
}) {
  const tones: Record<string, string> = {
    danger: "border-danger/40 bg-danger/10 text-danger",
    success: "border-success/40 bg-success/10 text-success",
    neutral: "border-line bg-canvas/60 text-ink",
  };
  return (
    <div className={`rounded-xl border px-2 py-1.5 ${tones[tone]}`}>
      <span className="block text-[9px] font-semibold uppercase tracking-wide text-muted">
        {label}
      </span>
      <strong className="block text-xs">{value}</strong>
    </div>
  );
}
