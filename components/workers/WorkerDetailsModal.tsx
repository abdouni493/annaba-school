"use client";

/**
 * LA FICHE D'UN TRAVAILLEUR — deux parties, comme on la lit.
 *
 *  EN HAUT : qui il est. Identité, métier, contrat, badge, compte de connexion,
 *  date de début de travail, et ce qu'on lui doit aujourd'hui.
 *
 *  EN BAS : ce qui s'est passé. Ses règlements, ses acomptes et ses absences,
 *  dans un seul journal daté, chacun avec ses trois boutons — modifier,
 *  supprimer, imprimer. Le papier imprimé est celui de l'école, le même que le
 *  reçu d'un élève.
 *
 * Les journées pointées d'un contrat horaire ont leur propre onglet : c'est là
 * qu'on débloque une journée où le travailleur a oublié de badger sa sortie.
 */

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Ban,
  Calendar,
  CreditCard,
  Edit,
  KeyRound,
  Printer,
  Trash2,
  Wallet,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/SearchInput";
import { useData } from "@/lib/store/data";
import { useToast } from "@/lib/store/toast";
import { useSettings } from "@/lib/store/settings";
import { printHtmlDocument } from "@/lib/print";
import { formatDA } from "@/lib/utils";
import { formatDateFr } from "@/lib/helpers";
import type { ReceptionStaff, WorkerPayment, WorkerShift } from "@/lib/types";
import {
  WORKER_PAYMENT_LABELS,
  absencesOf,
  acomptesOf,
  formatHours,
  frozenShiftsOf,
  payableShiftsOf,
  paymentsOf,
  shiftsOf,
  workerBalance,
  workerInitials,
  workerName,
  workerRoleName,
} from "@/lib/workers";
import {
  workerAbsenceNoticeHtml,
  workerAcompteReceiptHtml,
  workerPayslipHtml,
} from "@/lib/reports/workerDocuments";

type Tab = "history" | "hours";

/** Une ligne du journal, quelle que soit sa nature. */
interface LogEntry {
  id: string;
  kind: "payment" | "acompte" | "absence";
  date: string;
  title: string;
  detail: string;
  amount: number;
  /** l'argent est-il sorti (règlement, acompte) ou seulement retenu (absence) */
  outgoing: boolean;
  settled: boolean;
}

export function WorkerDetailsModal({
  worker,
  can,
  onClose,
  onPay,
}: {
  worker: ReceptionStaff;
  can: (action: string) => boolean;
  onClose: () => void;
  onPay: () => void;
}) {
  const db = useData();
  const { updateItem, deleteFrom, updateWorkerPayment, deleteWorkerPayment } = db;
  const { addToast } = useToast();
  const language = useSettings((s) => s.language);

  const isHourly = worker.paymentType === "hourly";
  const [tab, setTab] = useState<Tab>(isHourly ? "hours" : "history");

  const balance = useMemo(() => workerBalance(db, worker), [db, worker]);
  const payments = useMemo(() => paymentsOf(db, worker.id), [db, worker.id]);
  const acomptes = useMemo(() => acomptesOf(db, worker.id), [db, worker.id]);
  const absences = useMemo(() => absencesOf(db, worker.id), [db, worker.id]);

  const log = useMemo<LogEntry[]>(() => {
    const rows: LogEntry[] = [
      ...payments.map((p) => ({
        id: p.id,
        kind: "payment" as const,
        date: p.date,
        title: "Règlement de rémunération",
        detail:
          p.description ||
          `${p.periodKeys.length} période(s) — brut ${formatDA(p.gross)}` +
            (p.acomptes ? `, acomptes -${formatDA(p.acomptes)}` : "") +
            (p.absences ? `, absences -${formatDA(p.absences)}` : ""),
        amount: p.amount,
        outgoing: true,
        settled: true,
      })),
      ...acomptes.map((a) => ({
        id: a.id,
        kind: "acompte" as const,
        date: a.date,
        title: "Acompte (avance sur salaire)",
        detail: a.description || "Avance",
        amount: a.amount,
        outgoing: true,
        settled: !!a.paid,
      })),
      ...absences.map((a) => ({
        id: a.id,
        kind: "absence" as const,
        date: a.date,
        title: "Retenue pour absence",
        detail: a.description || "Absence",
        amount: a.cost,
        outgoing: false,
        settled: !!a.paid,
      })),
    ];
    return rows.sort((x, y) => y.date.localeCompare(x.date));
  }, [payments, acomptes, absences]);

  // ---- corrections en place -------------------------------------------------
  const [editing, setEditing] = useState<LogEntry | null>(null);
  const [editAmount, setEditAmount] = useState(0);
  const [editDate, setEditDate] = useState("");
  const [editNote, setEditNote] = useState("");

  const openEdit = (entry: LogEntry) => {
    setEditing(entry);
    setEditAmount(entry.amount);
    setEditDate(entry.date.slice(0, 10));
    setEditNote(entry.kind === "payment" ? findPayment(entry.id)?.description ?? "" : entry.detail);
  };

  const findPayment = (id: string): WorkerPayment | undefined =>
    payments.find((p) => p.id === id);

  const saveEdit = async () => {
    if (!editing) return;
    if (editing.kind === "payment") {
      await updateWorkerPayment(editing.id, {
        amount: editAmount,
        date: editDate,
        description: editNote,
      });
    } else if (editing.kind === "acompte") {
      updateItem("workerAcomptes", editing.id, {
        amount: Math.max(0, editAmount),
        date: editDate,
        description: editNote,
      });
    } else {
      updateItem("workerAbsences", editing.id, {
        cost: Math.max(0, editAmount),
        date: editDate,
        description: editNote,
      });
    }
    addToast({ type: "success", title: "Correction enregistrée", message: editing.title });
    setEditing(null);
  };

  const remove = async (entry: LogEntry) => {
    if (entry.kind === "payment") {
      const ok = confirm(
        "Supprimer ce règlement ? L'argent revient en caisse, et tout ce qu'il avait soldé — " +
          "journées, acomptes, absences — redevient dû.",
      );
      if (!ok) return;
      await deleteWorkerPayment(entry.id);
    } else {
      const ok = confirm(`Supprimer « ${entry.title} » du ${formatDateFr(entry.date)} ?`);
      if (!ok) return;
      deleteFrom(entry.kind === "acompte" ? "workerAcomptes" : "workerAbsences", entry.id);
    }
    addToast({ type: "success", title: "Supprimé", message: entry.title });
  };

  const print = (entry: LogEntry) => {
    if (entry.kind === "payment") {
      const payment = findPayment(entry.id);
      if (!payment) return;
      printHtmlDocument(workerPayslipHtml(db, { worker, payment, language }));
      return;
    }
    if (entry.kind === "acompte") {
      const acompte = acomptes.find((a) => a.id === entry.id);
      if (!acompte) return;
      printHtmlDocument(workerAcompteReceiptHtml(db, { worker, acompte, language }));
      return;
    }
    const absence = absences.find((a) => a.id === entry.id);
    if (!absence) return;
    printHtmlDocument(workerAbsenceNoticeHtml(db, { worker, absence, language }));
  };

  return (
    <Modal open onClose={onClose} wide title="Fiche du travailleur">
      <div className="space-y-4">
        {/* ================= PARTIE 1 — QUI IL EST ======================== */}
        <section className="space-y-3 rounded-2xl border border-line bg-canvas/40 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-primary/10 text-sm font-bold tracking-wider text-primary">
                {workerInitials(worker)}
              </div>
              <div className="min-w-0">
                <h3 className="truncate text-base font-bold text-ink">{workerName(worker)}</h3>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <Badge tone="primary" className="text-[10px]">
                    {workerRoleName(db, worker.role)}
                  </Badge>
                  <Badge tone="neutral" className="text-[10px]">
                    {WORKER_PAYMENT_LABELS[worker.paymentType]}
                  </Badge>
                  {worker.hasAccount ? (
                    <Badge tone="success" className="text-[10px]">
                      <KeyRound className="mr-1 inline h-3 w-3" /> Compte actif
                    </Badge>
                  ) : (
                    <Badge tone="neutral" className="text-[10px]">
                      <Ban className="mr-1 inline h-3 w-3" /> Sans compte
                    </Badge>
                  )}
                </div>
              </div>
            </div>
            <div className="text-end">
              <span className="block text-[10px] font-bold uppercase tracking-wide text-muted">
                Reste à verser
              </span>
              <strong
                className={`font-mono text-xl font-black ${
                  balance.net > 0 ? "text-warning" : "text-success"
                }`}
              >
                {formatDA(Math.max(0, balance.net))}
              </strong>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 border-t border-line/60 pt-3 sm:grid-cols-4">
            <Info label="Début de travail" value={worker.startDate ? formatDateFr(worker.startDate) : "Non renseignée"} />
            <Info
              label="Rémunération"
              value={
                isHourly
                  ? `${worker.hourlyRate ?? 0} DA / heure`
                  : `${formatDA(worker.salary)} / ${WORKER_PAYMENT_LABELS[worker.paymentType].toLowerCase()}`
              }
            />
            <Info label="Téléphone" value={worker.phone || "—"} mono />
            <Info label="Badge RFID" value={worker.rfid || "Aucun badge"} mono />
            <Info label="Email de connexion" value={worker.hasAccount ? worker.email || "—" : "—"} mono />
            <Info label="Nom d'utilisateur" value={worker.hasAccount ? worker.username || "—" : "—"} mono />
            <Info
              label="Écrans autorisés"
              value={
                worker.navKeys === undefined
                  ? "Droits jamais réglés"
                  : `${worker.navKeys.length} écran(s)`
              }
            />
            <Info
              label="Boutons autorisés"
              value={`${worker.actionKeys?.length ?? 0} bouton(s)`}
            />
          </div>

          {/* Ce qu'on lui doit, décomposé — la même arithmétique que l'écran de
              règlement, pour qu'ils ne puissent pas se contredire. */}
          <div className="grid grid-cols-2 gap-2 border-t border-line/60 pt-3 sm:grid-cols-4">
            <Stat label="Périodes dues" value={String(balance.periods.length)} tone="ink" />
            <Stat label="Total des périodes" value={formatDA(balance.gross)} tone="primary" />
            <Stat label="Acomptes non retenus" value={formatDA(balance.acomptesTotal)} tone="warning" />
            <Stat label="Absences non retenues" value={formatDA(balance.absencesTotal)} tone="danger" />
          </div>

          {can("pay") && (
            <div className="flex justify-end border-t border-line/60 pt-3">
              <Button onClick={onPay} className="gap-1.5">
                <Wallet className="h-4 w-4" /> Régler la rémunération
              </Button>
            </div>
          )}
        </section>

        {/* ================= PARTIE 2 — CE QUI S'EST PASSÉ ================= */}
        <div className="flex gap-1.5 border-b border-line pb-0.5">
          <TabButton on={tab === "history"} onClick={() => setTab("history")}>
            🧾 Historique ({log.length})
          </TabButton>
          {isHourly && (
            <TabButton on={tab === "hours"} onClick={() => setTab("hours")}>
              ⏱️ Pointage &amp; heures ({shiftsOf(db, worker.id).length})
            </TabButton>
          )}
        </div>

        {tab === "history" && (
          <div className="space-y-2">
            {editing && (
              <div className="space-y-3 rounded-2xl border border-primary/30 bg-primary-50/40 p-3">
                <span className="text-[10px] font-bold uppercase tracking-wider text-primary">
                  Corriger — {editing.title} du {formatDateFr(editing.date)}
                </span>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <label className="mb-1 block text-[10px] font-bold uppercase text-muted">
                      {editing.kind === "absence" ? "Coût (DA)" : "Montant (DA)"}
                    </label>
                    <Input
                      type="number"
                      min={0}
                      value={editAmount || ""}
                      onChange={(e) => setEditAmount(Math.max(0, Number(e.target.value) || 0))}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-bold uppercase text-muted">Date</label>
                    <Input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-bold uppercase text-muted">
                      Description
                    </label>
                    <Input value={editNote} onChange={(e) => setEditNote(e.target.value)} />
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="outline" onClick={() => setEditing(null)}>
                    Annuler
                  </Button>
                  <Button size="sm" onClick={saveEdit}>
                    Enregistrer
                  </Button>
                </div>
              </div>
            )}

            {log.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-line py-8 text-center text-[11px] italic text-muted">
                Rien n&apos;a encore été versé ni retenu pour ce travailleur.
              </p>
            ) : (
              <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                {log.map((entry) => (
                  <LogRow
                    key={`${entry.kind}-${entry.id}`}
                    entry={entry}
                    canEdit={can(entry.kind === "payment" ? "pay" : entry.kind)}
                    canDelete={can(entry.kind === "payment" ? "pay" : entry.kind)}
                    canPrint={can("print")}
                    onEdit={() => openEdit(entry)}
                    onDelete={() => remove(entry)}
                    onPrint={() => print(entry)}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "hours" && isHourly && <HoursTab worker={worker} />}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
//  Le pointage d'un contrat horaire
// ---------------------------------------------------------------------------

function HoursTab({ worker }: { worker: ReceptionStaff }) {
  const db = useData();
  const updateItem = useData((s) => s.updateItem);
  const { addToast } = useToast();

  const all = shiftsOf(db, worker.id);
  const payable = payableShiftsOf(db, worker.id);
  const frozen = frozenShiftsOf(db, worker.id);

  const [fixing, setFixing] = useState<WorkerShift | null>(null);
  const [endAt, setEndAt] = useState("");

  const fmtTime = (iso?: string) => {
    if (!iso) return "—";
    const d = new Date(iso);
    return isNaN(d.getTime())
      ? "—"
      : d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  };

  const toLocalInput = (iso?: string) => {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const saveFix = () => {
    if (!fixing || !endAt) return;
    const end = new Date(endAt);
    const start = fixing.startAt ? new Date(fixing.startAt) : null;
    if (!start || isNaN(end.getTime()) || end <= start) {
      addToast({
        type: "danger",
        title: "Heure impossible",
        message: "L'heure de fin doit être postérieure à l'heure d'arrivée.",
      });
      return;
    }
    const minutes = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
    updateItem("workerShifts", fixing.id, { endAt: end.toISOString(), minutes, frozen: false });
    addToast({
      type: "success",
      title: "Journée débloquée",
      message: `${formatDateFr(fixing.workDate)} — ${formatHours(minutes)} enregistrées.`,
    });
    setFixing(null);
    setEndAt("");
  };

  const totalMinutes = payable.reduce((s, x) => s + x.minutes, 0);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Journées pointées" value={String(all.length)} tone="ink" />
        <Stat label="Non payées" value={String(payable.length)} tone="warning" />
        <Stat label="Heures dues" value={formatHours(totalMinutes)} tone="primary" />
        <Stat
          label="Montant dû"
          value={formatDA((totalMinutes / 60) * (worker.hourlyRate ?? 0))}
          tone="success"
        />
      </div>

      {frozen.length > 0 && (
        <div className="flex items-start gap-2 rounded-2xl border border-danger/30 bg-danger/5 p-3 text-[11px] leading-relaxed text-danger">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <strong>{frozen.length} journée(s) gelée(s)</strong> : le travailleur a pointé son
            arrivée sans pointer sa sortie. Les heures ne sont plus comptées pour ces journées —
            saisissez l&apos;heure de fin ci-dessous pour les débloquer.
          </span>
        </div>
      )}

      {fixing && (
        <div className="space-y-3 rounded-2xl border border-danger/30 bg-danger/5 p-3">
          <span className="text-[11px] leading-relaxed text-danger">
            Journée du <strong>{formatDateFr(fixing.workDate)}</strong>, ouverte à{" "}
            <strong className="font-mono">{fmtTime(fixing.startAt)}</strong> sans pointage de sortie.
          </span>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[14rem] flex-1">
              <label className="mb-1 block text-[10px] font-bold uppercase text-muted">
                Heure de fin réelle
              </label>
              <Input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
            </div>
            <Button size="sm" variant="outline" onClick={() => setFixing(null)}>
              Annuler
            </Button>
            <Button size="sm" onClick={saveFix}>
              Débloquer
            </Button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-line bg-surface">
        <div className="max-h-72 overflow-y-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-line bg-canvas text-[10px] font-bold uppercase tracking-wider text-muted">
                <th className="p-2.5">Jour</th>
                <th className="p-2.5">Arrivée</th>
                <th className="p-2.5">Sortie</th>
                <th className="p-2.5 text-right">Heures</th>
                <th className="p-2.5 text-right">Montant</th>
                <th className="p-2.5 text-right">Statut</th>
              </tr>
            </thead>
            <tbody>
              {all.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-6 text-center italic text-muted">
                    Aucun pointage enregistré.
                  </td>
                </tr>
              ) : (
                all.map((s) => (
                  <tr key={s.id} className="border-b border-line transition-colors last:border-0 hover:bg-canvas/30">
                    <td className="p-2.5 font-mono text-[10px] text-ink">{formatDateFr(s.workDate)}</td>
                    <td className="p-2.5 font-mono">{fmtTime(s.startAt)}</td>
                    <td className="p-2.5 font-mono">
                      {s.endAt ? fmtTime(s.endAt) : <span className="font-bold text-danger">Non pointée</span>}
                    </td>
                    <td className="p-2.5 text-right font-mono font-bold">
                      {s.frozen ? <span className="text-danger">gelée</span> : formatHours(s.minutes)}
                    </td>
                    <td className="p-2.5 text-right font-mono">
                      {s.frozen ? "—" : formatDA((s.minutes / 60) * (worker.hourlyRate ?? 0))}
                    </td>
                    <td className="p-2.5 text-right">
                      {s.frozen ? (
                        <button
                          onClick={() => {
                            setFixing(s);
                            setEndAt(toLocalInput(s.startAt));
                          }}
                          className="rounded-lg border border-danger/25 bg-danger/10 px-2 py-1 text-[10px] font-bold text-danger hover:bg-danger/20"
                        >
                          Corriger
                        </button>
                      ) : (
                        <Badge tone={s.paid ? "success" : "warning"} className="text-[9px]">
                          {s.paid ? "Payée" : "En attente"}
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Briques
// ---------------------------------------------------------------------------

function LogRow({
  entry,
  canEdit,
  canDelete,
  canPrint,
  onEdit,
  onDelete,
  onPrint,
}: {
  entry: LogEntry;
  canEdit: boolean;
  canDelete: boolean;
  canPrint: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onPrint: () => void;
}) {
  const tone =
    entry.kind === "payment"
      ? "border-success/30 bg-success/5"
      : entry.kind === "acompte"
        ? "border-warning/30 bg-warning/5"
        : "border-danger/30 bg-danger/5";
  const amountTone =
    entry.kind === "payment" ? "text-success" : entry.kind === "acompte" ? "text-warning" : "text-danger";
  const icon =
    entry.kind === "payment" ? (
      <Wallet className="h-3.5 w-3.5" />
    ) : entry.kind === "acompte" ? (
      <CreditCard className="h-3.5 w-3.5" />
    ) : (
      <Calendar className="h-3.5 w-3.5" />
    );

  return (
    <div className={`rounded-xl border p-3 ${tone}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <strong className="flex items-center gap-1.5 text-[11px] text-ink">
            <span className={amountTone}>{icon}</span>
            {entry.title}
            {entry.kind !== "payment" && (
              <Badge tone={entry.settled ? "success" : "warning"} className="text-[9px]">
                {entry.settled ? "Déjà retenu" : "En attente"}
              </Badge>
            )}
          </strong>
          <span className="mt-0.5 block truncate text-[10px] text-muted">{entry.detail}</span>
          <span className="mt-0.5 block font-mono text-[9px] text-muted">
            {formatDateFr(entry.date)}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <strong className={`font-mono text-sm font-bold ${amountTone}`}>
            {entry.outgoing ? "-" : ""}
            {formatDA(entry.amount)}
          </strong>
          {canEdit && (
            <IconButton title="Modifier" tone="primary" onClick={onEdit}>
              <Edit className="h-3.5 w-3.5" />
            </IconButton>
          )}
          {canPrint && (
            <IconButton title="Imprimer" tone="primary" onClick={onPrint}>
              <Printer className="h-3.5 w-3.5" />
            </IconButton>
          )}
          {canDelete && (
            <IconButton title="Supprimer" tone="danger" onClick={onDelete}>
              <Trash2 className="h-3.5 w-3.5" />
            </IconButton>
          )}
        </div>
      </div>
    </div>
  );
}

function IconButton({
  title,
  tone,
  onClick,
  children,
}: {
  title: string;
  tone: "primary" | "danger";
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`flex h-7 w-7 items-center justify-center rounded-lg border border-line bg-surface transition-colors ${
        tone === "danger" ? "text-danger hover:bg-danger/10" : "text-primary hover:bg-primary-50"
      }`}
    >
      {children}
    </button>
  );
}

function TabButton({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`-mb-0.5 whitespace-nowrap rounded-t-xl border-b-2 px-4 py-2 text-xs font-bold transition-colors ${
        on ? "border-primary text-primary" : "border-transparent text-muted hover:bg-canvas/50 hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function Info({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <span className="block text-[9px] font-bold uppercase tracking-wide text-muted">{label}</span>
      <strong className={`mt-0.5 block truncate text-[11px] text-ink ${mono ? "font-mono" : ""}`}>
        {value}
      </strong>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "ink" | "primary" | "warning" | "danger" | "success";
}) {
  const toneClass = {
    ink: "text-ink",
    primary: "text-primary",
    warning: "text-warning",
    danger: "text-danger",
    success: "text-success",
  }[tone];
  return (
    <div className="rounded-xl border border-line bg-surface p-2.5 text-center">
      <span className="block text-[9px] font-bold uppercase tracking-wide text-muted">{label}</span>
      <strong className={`mt-0.5 block font-mono text-sm ${toneClass}`}>{value}</strong>
    </div>
  );
}
