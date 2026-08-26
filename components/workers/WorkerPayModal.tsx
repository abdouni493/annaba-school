"use client";

/**
 * RÉGLER UN TRAVAILLEUR.
 *
 * L'écran pose la question dans l'ordre où elle se pose au comptoir :
 *
 *   1. QU'EST-CE QU'ON LUI DOIT ? Les mois non payés pour un mensuel, les
 *      journées non payées pour un journalier ou un demi-journalier, les
 *      journées POINTÉES pour un horaire — avec leurs heures réelles. On coche.
 *   2. QU'EST-CE QU'ON LUI RETIENT ? Les acomptes déjà versés et les absences
 *      retenues qui n'ont pas encore été déduits d'un règlement. On coche aussi :
 *      l'école peut n'en retenir qu'une partie ce mois-ci.
 *   3. COMBIEN ON VERSE ? Le net est calculé, et modifiable à la main.
 *
 * La date du versement se corrige (on encaisse parfois pour la veille) et la
 * description est facultative.
 */

import { useMemo, useState } from "react";
import { AlertTriangle, DollarSign, Wallet } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/SearchInput";
import { useData } from "@/lib/store/data";
import { useToast } from "@/lib/store/toast";
import { formatDA, money } from "@/lib/utils";
import { formatDateFr } from "@/lib/helpers";
import type { ReceptionStaff } from "@/lib/types";
import {
  WORKER_PAYMENT_LABELS,
  formatHours,
  frozenShiftsOf,
  openAbsencesOf,
  openAcomptesOf,
  unpaidPeriodsOf,
  workerName,
} from "@/lib/workers";

export function WorkerPayModal({
  worker,
  onClose,
  onPaid,
  onFixFrozen,
}: {
  worker: ReceptionStaff;
  onClose: () => void;
  onPaid: (paymentId: string) => void;
  /** l'écran des heures, pour débloquer une journée non clôturée */
  onFixFrozen: () => void;
}) {
  const db = useData();
  const payWorker = useData((s) => s.payWorker);
  const { addToast } = useToast();

  const periods = useMemo(() => unpaidPeriodsOf(db, worker), [db, worker]);
  const acomptes = useMemo(() => openAcomptesOf(db, worker.id), [db, worker.id]);
  const absences = useMemo(() => openAbsencesOf(db, worker.id), [db, worker.id]);
  const frozen = useMemo(() => frozenShiftsOf(db, worker.id), [db, worker.id]);

  // Tout est coché à l'ouverture : le cas courant est « on solde tout ». La
  // fenêtre est montée AVEC LA CLÉ du travailleur, donc en ouvrir un autre la
  // remonte et les cases repartent des siennes.
  const [periodKeys, setPeriodKeys] = useState<string[]>(() => periods.map((p) => p.key));
  const [acompteIds, setAcompteIds] = useState<string[]>(() => acomptes.map((a) => a.id));
  const [absenceIds, setAbsenceIds] = useState<string[]>(() => absences.map((a) => a.id));
  const [date, setDate] = useState(new Date().toLocaleDateString("fr-CA"));
  const [description, setDescription] = useState("");
  /** null = « suis le calcul » ; un nombre = la main de l'administration */
  const [override, setOverride] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const gross = money(
    periods.filter((p) => periodKeys.includes(p.key)).reduce((s, p) => s + p.amount, 0),
  );
  const acomptesTotal = money(
    acomptes.filter((a) => acompteIds.includes(a.id)).reduce((s, a) => s + a.amount, 0),
  );
  const absencesTotal = money(
    absences.filter((a) => absenceIds.includes(a.id)).reduce((s, a) => s + a.cost, 0),
  );
  const net = money(gross - acomptesTotal - absencesTotal);
  const toPay = override ?? Math.max(0, net);

  const isHourly = worker.paymentType === "hourly";
  const shiftIds = isHourly ? periodKeys : [];
  const chosenMinutes = periods
    .filter((p) => periodKeys.includes(p.key))
    .reduce((s, p) => s + (p.shift?.minutes ?? 0), 0);

  const toggle = (list: string[], set: (v: string[]) => void, id: string) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const submit = async () => {
    if (periodKeys.length === 0 && acompteIds.length === 0 && absenceIds.length === 0 && toPay <= 0) {
      addToast({
        type: "danger",
        title: "Rien à régler",
        message: "Cochez au moins une période, une retenue, ou saisissez un montant.",
      });
      return;
    }
    setBusy(true);
    const res = await payWorker({
      workerId: worker.id,
      // Un contrat horaire solde des JOURNÉES POINTÉES : leurs identifiants
      // servent des deux côtés — ils disent ce qui est réglé, et ils marquent
      // les journées payées.
      periodKeys,
      shiftIds,
      gross,
      acompteIds,
      absenceIds,
      amount: toPay,
      date,
      description,
    });
    setBusy(false);

    if (!res.ok || !res.paymentId) {
      addToast({
        type: "danger",
        title: "Règlement impossible",
        message: "Le versement n'a pas pu être enregistré — veuillez réessayer.",
      });
      return;
    }
    addToast({
      type: "success",
      title: "Rémunération versée",
      message: `${formatDA(toPay)} versés à ${workerName(worker)} le ${formatDateFr(date)}.`,
    });
    onPaid(res.paymentId);
  };

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={`Régler ${workerName(worker)}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button onClick={submit} disabled={busy} className="gap-1.5">
            <DollarSign className="h-4 w-4" />
            {busy ? "Enregistrement…" : `Verser ${formatDA(toPay)}`}
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-xs">
        {/* ---- rappel du contrat ------------------------------------------ */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-line bg-canvas/40 p-3">
          <div>
            <strong className="block text-sm text-ink">{workerName(worker)}</strong>
            <span className="text-[11px] text-muted">
              {WORKER_PAYMENT_LABELS[worker.paymentType]} ·{" "}
              {isHourly
                ? `${worker.hourlyRate ?? 0} DA / heure`
                : `${formatDA(worker.salary)} / ${WORKER_PAYMENT_LABELS[worker.paymentType].toLowerCase()}`}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Badge tone={periods.length ? "warning" : "success"} className="font-bold">
              {periods.length} période(s) due(s)
            </Badge>
            {isHourly && (
              <Badge tone="primary" className="font-bold">
                {formatHours(chosenMinutes)} cochées
              </Badge>
            )}
          </div>
        </div>

        {/* ---- journées bloquées ------------------------------------------ */}
        {isHourly && frozen.length > 0 && (
          <button
            onClick={onFixFrozen}
            className="flex w-full items-start gap-2 rounded-2xl border border-danger/30 bg-danger/5 p-3 text-start transition-colors hover:bg-danger/10"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
            <span className="text-[11px] leading-relaxed text-danger">
              <strong>{frozen.length} journée(s) non clôturée(s)</strong> ne peuvent pas être
              réglées : le pointage de sortie manque. Cliquez ici pour saisir l&apos;heure de fin.
            </span>
          </button>
        )}

        {/* ---- 1. les périodes dues --------------------------------------- */}
        <Section
          title={isHourly ? "1. Les journées pointées à régler" : "1. Les périodes non payées"}
          count={`${periodKeys.length}/${periods.length}`}
          onAll={() => setPeriodKeys(periods.map((p) => p.key))}
          onNone={() => setPeriodKeys([])}
          empty={periods.length === 0}
          emptyText={
            worker.startDate
              ? "Tout est à jour : aucune période ne reste due."
              : "Aucune date de début de travail n'est renseignée — les périodes dues partent de ce jour-là."
          }
        >
          {periods.map((p) => {
            const on = periodKeys.includes(p.key);
            return (
              <Row
                key={p.key}
                on={on}
                onToggle={() => toggle(periodKeys, setPeriodKeys, p.key)}
                title={p.label}
                meta={p.shift ? formatDateFr(p.shift.workDate) : p.key}
                amount={formatDA(p.amount)}
                tone="primary"
              />
            );
          })}
        </Section>

        {/* ---- 2. les retenues -------------------------------------------- */}
        <Section
          title="2. Les acomptes déjà versés"
          count={`${acompteIds.length}/${acomptes.length}`}
          onAll={() => setAcompteIds(acomptes.map((a) => a.id))}
          onNone={() => setAcompteIds([])}
          empty={acomptes.length === 0}
          emptyText="Aucun acompte en attente de retenue."
        >
          {acomptes.map((a) => (
            <Row
              key={a.id}
              on={acompteIds.includes(a.id)}
              onToggle={() => toggle(acompteIds, setAcompteIds, a.id)}
              title={a.description || "Acompte"}
              meta={formatDateFr(a.date)}
              amount={`- ${formatDA(a.amount)}`}
              tone="warning"
            />
          ))}
        </Section>

        <Section
          title="3. Les absences retenues"
          count={`${absenceIds.length}/${absences.length}`}
          onAll={() => setAbsenceIds(absences.map((a) => a.id))}
          onNone={() => setAbsenceIds([])}
          empty={absences.length === 0}
          emptyText="Aucune absence en attente de retenue."
        >
          {absences.map((a) => (
            <Row
              key={a.id}
              on={absenceIds.includes(a.id)}
              onToggle={() => toggle(absenceIds, setAbsenceIds, a.id)}
              title={a.description || "Absence"}
              meta={formatDateFr(a.date)}
              amount={`- ${formatDA(a.cost)}`}
              tone="danger"
            />
          ))}
        </Section>

        {/* ---- 4. le calcul ----------------------------------------------- */}
        <div className="space-y-3 rounded-2xl border-2 border-success/40 bg-success/5 p-4">
          <h4 className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted">
            <Wallet className="h-3.5 w-3.5" /> 4. Ce qu&apos;on lui verse
          </h4>

          <div className="space-y-1.5 border-b border-success/25 pb-3">
            <Line label="Total des périodes cochées" value={formatDA(gross)} />
            {acomptesTotal > 0 && (
              <Line label="Acomptes retenus" value={`- ${formatDA(acomptesTotal)}`} tone="warning" />
            )}
            {absencesTotal > 0 && (
              <Line label="Absences retenues" value={`- ${formatDA(absencesTotal)}`} tone="danger" />
            )}
            <Line label="Net calculé" value={formatDA(net)} strong />
            {net < 0 && (
              <p className="text-[10px] leading-relaxed text-danger">
                Les retenues dépassent ce qui est dû. Décochez-en, ou versez 0 : celles que vous
                laissez cochées seront soldées et ne reviendront pas sur le prochain règlement.
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-muted">
                Montant versé (DA)
              </label>
              <Input
                type="number"
                min={0}
                value={override ?? Math.max(0, net)}
                onChange={(e) => setOverride(Math.max(0, Number(e.target.value) || 0))}
              />
              <p className="mt-1 text-[9px] leading-snug text-muted">
                Pré-rempli avec le net calculé. Corrigez-le librement.
              </p>
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-muted">
                Date du versement
              </label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              <p className="mt-1 text-[9px] leading-snug text-muted">
                On règle parfois pour la veille.
              </p>
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-muted">
                Description (facultative)
              </label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Ex : salaire août"
              />
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
//  Briques
// ---------------------------------------------------------------------------

function Section({
  title,
  count,
  onAll,
  onNone,
  empty,
  emptyText,
  children,
}: {
  title: string;
  count: string;
  onAll: () => void;
  onNone: () => void;
  empty: boolean;
  emptyText: string;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-canvas px-3 py-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted">
          {title} <span className="font-mono text-primary">({count})</span>
        </span>
        {!empty && (
          <div className="flex gap-2">
            <button onClick={onAll} className="text-[10px] font-bold text-primary hover:underline">
              Tout cocher
            </button>
            <button onClick={onNone} className="text-[10px] font-bold text-danger hover:underline">
              Tout décocher
            </button>
          </div>
        )}
      </div>
      {empty ? (
        <p className="px-3 py-4 text-center text-[11px] italic text-muted">{emptyText}</p>
      ) : (
        <div className="max-h-52 space-y-1 overflow-y-auto p-2">{children}</div>
      )}
    </div>
  );
}

function Row({
  on,
  onToggle,
  title,
  meta,
  amount,
  tone,
}: {
  on: boolean;
  onToggle: () => void;
  title: string;
  meta: string;
  amount: string;
  tone: "primary" | "warning" | "danger";
}) {
  const toneClass =
    tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : "text-primary";
  return (
    <button
      onClick={onToggle}
      className={`flex w-full items-center gap-2.5 rounded-xl border p-2.5 text-start transition-colors ${
        on ? "border-primary/35 bg-primary-50/40" : "border-line bg-canvas/30 hover:bg-canvas/60"
      }`}
    >
      <input type="checkbox" checked={on} readOnly className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11px] font-bold text-ink first-letter:uppercase">
          {title}
        </span>
        <span className="block font-mono text-[9px] text-muted">{meta}</span>
      </span>
      <strong className={`shrink-0 font-mono text-[11px] ${toneClass}`}>{amount}</strong>
    </button>
  );
}

function Line({
  label,
  value,
  tone,
  strong,
}: {
  label: string;
  value: string;
  tone?: "warning" | "danger";
  strong?: boolean;
}) {
  const toneClass = tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : "text-ink";
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className={strong ? "text-[11px] font-bold text-ink" : "text-[11px] text-muted"}>
        {label}
      </span>
      <strong className={`font-mono ${strong ? "text-sm" : "text-[11px]"} ${toneClass}`}>
        {value}
      </strong>
    </div>
  );
}
