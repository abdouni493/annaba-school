"use client";

/**
 * L'ÉCRAN DES TRAVAILLEURS.
 *
 * Une carte par personne, et sur chaque carte tout ce qu'on fait d'elle :
 * la voir, la modifier, la supprimer, régler ses droits d'accès, lui verser un
 * acompte, retenir une absence, la payer, et — quand elle a un compte — lire
 * l'historique de son travail.
 *
 * Ce qui a changé par rapport à l'écran d'origine :
 *
 *  - LES MÉTIERS se créent et se suppriment depuis le formulaire, au lieu
 *    d'être les trois valeurs écrites dans le code ;
 *  - LE COMPTE DE CONNEXION s'active explicitement, avec son nom d'utilisateur,
 *    au lieu d'apparaître dès qu'un email avait été tapé ;
 *  - LES DROITS ne sont plus constants : un travailleur naît sans rien voir, et
 *    l'administration lui ouvre ses écrans et ses boutons un par un ;
 *  - LA PAIE ne se devine plus dans les libellés de la caisse : les règlements
 *    sont des lignes, les acomptes et les absences sont retenus une fois et une
 *    seule, et tout s'imprime sur le papier de l'école.
 */

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Briefcase,
  CalendarX,
  CreditCard,
  Edit,
  Eye,
  History,
  KeyRound,
  MoreVertical,
  Plus,
  Scan,
  Search,
  ShieldCheck,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
import { useData, uid } from "@/lib/store/data";
import { useToast } from "@/lib/store/toast";
import { useSettings } from "@/lib/store/settings";
import { useCan } from "@/lib/usePermissions";
import { accountIdForEntity, deleteRoleUser } from "@/lib/accounts/users";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { Input, Select } from "@/components/ui/SearchInput";
import { PageHeader } from "@/components/layout/PageHeader";
import { PrintAsk } from "@/components/ui/PrintAsk";
import { WorkerFormModal } from "@/components/workers/WorkerFormModal";
import { WorkerDetailsModal } from "@/components/workers/WorkerDetailsModal";
import { WorkerPermissionsModal } from "@/components/workers/WorkerPermissionsModal";
import { WorkerPayModal } from "@/components/workers/WorkerPayModal";
import { WorkerHistoryModal } from "@/components/workers/WorkerHistoryModal";
import {
  workerAbsenceNoticeHtml,
  workerAcompteReceiptHtml,
  workerPayslipHtml,
} from "@/lib/reports/workerDocuments";
import type { ReceptionStaff } from "@/lib/types";
import { formatDA } from "@/lib/utils";
import { formatDateFr } from "@/lib/helpers";
import {
  WORKER_PAYMENT_LABELS,
  WORKER_PAYMENT_UNITS,
  formatHours,
  frozenShiftsOf,
  minutesOf,
  payableShiftsOf,
  workerBalance,
  workerInitials,
  workerName,
  workerRoleName,
} from "@/lib/workers";

/** Ce que la petite fenêtre « acompte / absence » est en train de saisir. */
type MoneyForm = { kind: "acompte" | "absence"; worker: ReceptionStaff } | null;

export function AdministrationPage() {
  const db = useData();
  const { reception, workerRoles, push, deleteFrom, scanWorkerCard, freezeOpenWorkerShifts } = db;
  const { addToast } = useToast();
  const language = useSettings((s) => s.language);
  const can = useCan("workers");

  // ---- fenêtres -------------------------------------------------------------
  const [formFor, setFormFor] = useState<ReceptionStaff | null | undefined>(undefined);
  const [detailsFor, setDetailsFor] = useState<ReceptionStaff | null>(null);
  const [rightsFor, setRightsFor] = useState<ReceptionStaff | null>(null);
  const [payFor, setPayFor] = useState<ReceptionStaff | null>(null);
  const [historyFor, setHistoryFor] = useState<ReceptionStaff | null>(null);
  const [moneyForm, setMoneyForm] = useState<MoneyForm>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [receipt, setReceipt] = useState<{ html: string; question: string } | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);

  // ---- acompte / absence ----------------------------------------------------
  const [amount, setAmount] = useState<number>(0);
  const [note, setNote] = useState("");
  const [when, setWhen] = useState(new Date().toLocaleDateString("fr-CA"));

  // ---- badge ----------------------------------------------------------------
  const [scanCode, setScanCode] = useState("");
  const [scanFeedback, setScanFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  // ---- recherche ------------------------------------------------------------
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");

  // Une journée ouverte sans pointage de sortie se gèle dès que le jour est
  // passé — le rattrapage est idempotent, on le lance à l'ouverture de l'écran.
  useEffect(() => {
    freezeOpenWorkerShifts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Du dernier arrivé au plus ancien : on cherche celui qu'on vient de créer. */
  const workers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...reception]
      .filter((w) => {
        if (roleFilter !== "all" && (w.role ?? "") !== roleFilter) return false;
        if (!q) return true;
        return (
          workerName(w).toLowerCase().includes(q) ||
          w.phone.toLowerCase().includes(q) ||
          w.email.toLowerCase().includes(q) ||
          (w.rfid ?? "").toLowerCase().includes(q) ||
          workerRoleName(db, w.role).toLowerCase().includes(q)
        );
      })
      .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  }, [reception, search, roleFilter, db]);

  const withFrozenDays = useMemo(
    () => reception.filter((w) => frozenShiftsOf(db, w.id).length > 0),
    [reception, db],
  );

  // ---- actions --------------------------------------------------------------

  const remove = async (worker: ReceptionStaff) => {
    const ok = confirm(
      `Supprimer ${workerName(worker)} ? Sa fiche, ses pointages, ses acomptes et ses ` +
        `règlements seront effacés. Les opérations qu'il a saisies restent en place.`,
    );
    if (!ok) return;
    if (worker.hasAccount) {
      const accountId = await accountIdForEntity(worker.id);
      if (accountId) await deleteRoleUser(accountId);
    }
    deleteFrom("reception", worker.id);
    setMenuId(null);
    addToast({ type: "success", title: "Travailleur supprimé", message: workerName(worker) });
  };

  const openMoney = (kind: "acompte" | "absence", worker: ReceptionStaff) => {
    setMoneyForm({ kind, worker });
    setAmount(0);
    setNote(kind === "acompte" ? "Avance sur salaire" : "Retenue pour absence");
    setWhen(new Date().toLocaleDateString("fr-CA"));
    setMenuId(null);
  };

  const saveMoney = () => {
    if (!moneyForm) return;
    const value = Math.max(0, Math.round(amount));
    if (value <= 0) {
      addToast({
        type: "danger",
        title: "Montant invalide",
        message: "Saisissez un montant supérieur à 0 DA.",
      });
      return;
    }
    const { kind, worker } = moneyForm;

    if (kind === "acompte") {
      const id = uid("wac");
      push("workerAcomptes", {
        id,
        workerId: worker.id,
        amount: value,
        description: note.trim() || "Acompte",
        date: when,
        paid: false,
      });
      // Un acompte sort réellement de la caisse le jour où il est versé — la
      // retenue sur la paie ne fait ensuite que solder l'avance.
      push("cash", {
        id: uid("csh"),
        type: "acompte",
        amount: -value,
        date: `${when}T${new Date().toISOString().substring(11)}`,
        description: `Acompte versé à ${workerName(worker)}${note.trim() ? ` (${note.trim()})` : ""}`,
      });
      addToast({
        type: "success",
        title: "Acompte enregistré",
        message: `${formatDA(value)} versés à ${workerName(worker)}.`,
      });
      if (can("print")) {
        setReceipt({
          html: workerAcompteReceiptHtml(db, {
            worker,
            acompte: {
              id,
              workerId: worker.id,
              amount: value,
              description: note.trim() || "Acompte",
              date: when,
            },
            language,
          }),
          question: "Imprimer le reçu de cet acompte ?",
        });
      }
    } else {
      const id = uid("wab");
      // Une absence ne sort pas d'argent : elle sera RETENUE le jour de la paie.
      push("workerAbsences", {
        id,
        workerId: worker.id,
        cost: value,
        description: note.trim() || "Absence",
        date: when,
        paid: false,
      });
      addToast({
        type: "success",
        title: "Absence enregistrée",
        message: `${formatDA(value)} seront retenus sur la prochaine paie de ${workerName(worker)}.`,
      });
      if (can("print")) {
        setReceipt({
          html: workerAbsenceNoticeHtml(db, {
            worker,
            absence: {
              id,
              workerId: worker.id,
              cost: value,
              description: note.trim() || "Absence",
              date: when,
            },
            language,
          }),
          question: "Imprimer l'avis de retenue ?",
        });
      }
    }
    setMoneyForm(null);
  };

  const handleScan = async () => {
    if (!scanCode.trim()) return;
    const res = await scanWorkerCard(scanCode);
    const messages: Record<string, string> = {
      "worker.clockIn": "Arrivée pointée — badgez à nouveau en partant.",
      "worker.clockOut": `Départ pointé — ${formatHours(res.minutes ?? 0)} travaillées aujourd'hui.`,
      "worker.alreadyClosed": `Journée déjà clôturée (${formatHours(res.minutes ?? 0)}).`,
      "worker.frozen":
        "Journée gelée : une journée précédente n'a pas été clôturée. Corrigez-la depuis la fiche.",
      "worker.notFound": "Badge inconnu — aucun travailleur ne correspond à cette carte.",
    };
    setScanFeedback({
      ok: res.ok,
      text: `${res.workerName ? `${res.workerName} — ` : ""}${
        messages[res.messageKey] ?? "Pointage impossible."
      }`,
    });
    setScanCode("");
  };

  const afterPay = (worker: ReceptionStaff, paymentId: string) => {
    setPayFor(null);
    if (!can("print")) return;
    // La fiche de paie se lit sur l'état du magasin APRÈS le règlement : on la
    // construit donc à partir de ce qu'il vient d'écrire, jamais des états
    // locaux de la fenêtre qui se ferme.
    const payment = useData.getState().workerPayments.find((p) => p.id === paymentId);
    if (!payment) return;
    setReceipt({
      html: workerPayslipHtml(useData.getState(), { worker, payment, language }),
      question: "Imprimer la fiche de paie ?",
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <PageHeader
          emoji="👥"
          title="Travailleurs"
          subtitle="Le personnel : métiers, comptes, droits d'accès, acomptes, absences et paie"
        />
        <div className="flex flex-wrap items-center gap-2">
          {can("scan") && (
            <Button
              variant="secondary"
              onClick={() => {
                setScanFeedback(null);
                setScanOpen(true);
              }}
              className="gap-2"
            >
              <Scan className="h-4 w-4" /> Pointage badge
            </Button>
          )}
          {can("create") && (
            <Button onClick={() => setFormFor(null)} className="gap-2">
              <Plus className="h-4 w-4" /> Nouveau travailleur
            </Button>
          )}
        </div>
      </div>

      {/* ---- journées non clôturées ------------------------------------- */}
      {withFrozenDays.length > 0 && (
        <div className="rounded-2xl border border-danger/30 bg-danger/5 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
            <div className="min-w-0 flex-1">
              <strong className="block text-sm text-danger">
                {withFrozenDays.length} travailleur(s) avec des journées non clôturées
              </strong>
              <p className="mt-0.5 text-[11px] leading-relaxed text-muted">
                Une arrivée a été pointée sans pointage de sortie : le calcul des heures de ces
                journées est <strong>gelé</strong> et elles ne peuvent pas être payées. Cliquez pour
                saisir l&apos;heure de fin.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {withFrozenDays.map((w) => (
                  <button
                    key={w.id}
                    onClick={() => setDetailsFor(w)}
                    className="rounded-lg border border-danger/25 bg-danger/10 px-2.5 py-1 text-[10px] font-bold text-danger transition-colors hover:bg-danger/20"
                  >
                    {workerName(w)} · {frozenShiftsOf(db, w.id).length} jour(s)
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---- recherche --------------------------------------------------- */}
      <Card className="border border-line card-shadow">
        <CardBody className="flex flex-wrap items-center gap-2 p-3">
          <div className="relative min-w-[16rem] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher un travailleur — nom, téléphone, badge, métier…"
              className="pl-9"
            />
          </div>
          <Select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="min-w-[11rem]"
          >
            <option value="all">Tous les métiers</option>
            {workerRoles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
            <option value="">Sans métier</option>
          </Select>
          <span className="ms-auto font-mono text-[10px] text-muted">
            {workers.length} / {reception.length} travailleur(s)
          </span>
        </CardBody>
      </Card>

      {/* ---- les cartes -------------------------------------------------- */}
      {workers.length === 0 ? (
        <Card className="border border-dashed border-line">
          <CardBody className="py-12 text-center">
            <Briefcase className="mx-auto h-8 w-8 text-muted/50" />
            <p className="mt-3 text-xs text-muted">
              {reception.length === 0
                ? "Aucun travailleur n'a encore été créé."
                : "Aucun travailleur ne correspond à cette recherche."}
            </p>
          </CardBody>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {workers.map((worker) => (
            <WorkerCard
              key={worker.id}
              worker={worker}
              menuOpen={menuId === worker.id}
              can={can}
              onMenu={() => setMenuId(menuId === worker.id ? null : worker.id)}
              onCloseMenu={() => setMenuId(null)}
              onView={() => {
                setDetailsFor(worker);
                setMenuId(null);
              }}
              onEdit={() => {
                setFormFor(worker);
                setMenuId(null);
              }}
              onDelete={() => remove(worker)}
              onRights={() => {
                setRightsFor(worker);
                setMenuId(null);
              }}
              onPay={() => {
                setPayFor(worker);
                setMenuId(null);
              }}
              onAcompte={() => openMoney("acompte", worker)}
              onAbsence={() => openMoney("absence", worker)}
              onHistory={() => {
                setHistoryFor(worker);
                setMenuId(null);
              }}
            />
          ))}
        </div>
      )}

      {/* ================= fenêtres ===================================== */}

      {formFor !== undefined && (
        <WorkerFormModal
          worker={formFor}
          canManageRoles={can("roles")}
          canManageAccount={can("account")}
          onClose={() => setFormFor(undefined)}
          onSaved={(saved, created) => {
            setFormFor(undefined);
            addToast({
              type: "success",
              title: created ? "Travailleur créé" : "Fiche enregistrée",
              message: created
                ? `${workerName(saved)} — ouvrez « Droits d'accès » pour lui donner ses écrans.`
                : workerName(saved),
            });
            // Un travailleur tout neuf ne voit rien : la suite naturelle du geste
            // est de lui ouvrir ses écrans, alors on y mène directement.
            if (created && saved.hasAccount && can("permissions")) setRightsFor(saved);
          }}
        />
      )}

      {detailsFor && (
        <WorkerDetailsModal
          worker={reception.find((w) => w.id === detailsFor.id) ?? detailsFor}
          can={can}
          onClose={() => setDetailsFor(null)}
          onPay={() => {
            setPayFor(detailsFor);
            setDetailsFor(null);
          }}
        />
      )}

      {rightsFor && (
        <WorkerPermissionsModal
          key={rightsFor.id}
          worker={reception.find((w) => w.id === rightsFor.id) ?? rightsFor}
          onClose={() => setRightsFor(null)}
          onSave={(navKeys, actionKeys) => {
            useData.getState().updateItem("reception", rightsFor.id, { navKeys, actionKeys });
            setRightsFor(null);
            addToast({
              type: "success",
              title: "Droits enregistrés",
              message: `${workerName(rightsFor)} verra ${navKeys.length} écran(s) et ${actionKeys.length} bouton(s).`,
            });
          }}
        />
      )}

      {payFor && (
        <WorkerPayModal
          key={payFor.id}
          worker={payFor}
          onClose={() => setPayFor(null)}
          onPaid={(paymentId) => afterPay(payFor, paymentId)}
          onFixFrozen={() => {
            setDetailsFor(payFor);
            setPayFor(null);
          }}
        />
      )}

      {historyFor && (
        <WorkerHistoryModal worker={historyFor} onClose={() => setHistoryFor(null)} />
      )}

      {/* ---- acompte / absence ------------------------------------------- */}
      <Modal
        open={moneyForm !== null}
        onClose={() => setMoneyForm(null)}
        title={
          moneyForm?.kind === "absence"
            ? `Retenue pour absence — ${moneyForm ? workerName(moneyForm.worker) : ""}`
            : `Acompte — ${moneyForm ? workerName(moneyForm.worker) : ""}`
        }
        footer={
          <>
            <Button variant="outline" onClick={() => setMoneyForm(null)}>
              Annuler
            </Button>
            <Button onClick={saveMoney}>Confirmer</Button>
          </>
        }
      >
        {moneyForm && (
          <div className="space-y-4">
            <p className="rounded-xl border border-line bg-canvas/50 p-3 text-[11px] leading-relaxed text-muted">
              {moneyForm.kind === "acompte" ? (
                <>
                  L&apos;acompte <strong className="text-ink">sort de la caisse aujourd&apos;hui</strong>{" "}
                  et sera retenu sur son prochain règlement — une fois, et une seule.
                </>
              ) : (
                <>
                  L&apos;absence <strong className="text-ink">ne sort aucun argent</strong> : son coût
                  sera retenu sur son prochain règlement, une fois et une seule.
                </>
              )}
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-muted">
                  {moneyForm.kind === "acompte" ? "Montant de l'acompte (DA) *" : "Coût de la retenue (DA) *"}
                </label>
                <Input
                  type="number"
                  min={0}
                  value={amount || ""}
                  onChange={(e) => setAmount(Number(e.target.value))}
                  placeholder={moneyForm.kind === "acompte" ? "Ex : 3000" : "Ex : 1000"}
                  autoFocus
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-muted">
                  Date
                </label>
                <Input type="date" value={when} onChange={(e) => setWhen(e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-muted">
                  Description
                </label>
                <Input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={moneyForm.kind === "acompte" ? "Avance" : "Motif de l'absence"}
                />
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* ---- badge -------------------------------------------------------- */}
      <Modal
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        title="Pointage par badge RFID"
        footer={
          <>
            <Button variant="outline" onClick={() => setScanOpen(false)}>
              Fermer
            </Button>
            <Button onClick={handleScan}>Pointer</Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-[11px] leading-relaxed text-muted">
            Passez la carte du travailleur. Le <strong>premier passage de la journée</strong>{" "}
            enregistre l&apos;arrivée, le <strong>second</strong> la sortie et calcule les heures
            travaillées.
          </p>
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-muted">
              Code de la carte
            </label>
            <Input
              value={scanCode}
              onChange={(e) => setScanCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleScan();
              }}
              placeholder="Passez la carte ou saisissez le code…"
              autoFocus
            />
          </div>
          {scanFeedback && (
            <div
              className={`rounded-xl border p-3 text-xs ${
                scanFeedback.ok
                  ? "border-success/30 bg-success/10 text-success"
                  : "border-danger/30 bg-danger/10 text-danger"
              }`}
            >
              {scanFeedback.text}
            </div>
          )}
        </div>
      </Modal>

      {receipt && (
        <PrintAsk
          html={receipt.html}
          question={receipt.question}
          onClose={() => setReceipt(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
//  La carte d'un travailleur
// ---------------------------------------------------------------------------

function WorkerCard({
  worker,
  menuOpen,
  can,
  onMenu,
  onCloseMenu,
  onView,
  onEdit,
  onDelete,
  onRights,
  onPay,
  onAcompte,
  onAbsence,
  onHistory,
}: {
  worker: ReceptionStaff;
  menuOpen: boolean;
  can: (action: string) => boolean;
  onMenu: () => void;
  onCloseMenu: () => void;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onRights: () => void;
  onPay: () => void;
  onAcompte: () => void;
  onAbsence: () => void;
  onHistory: () => void;
}) {
  const db = useData();
  const isHourly = worker.paymentType === "hourly";
  const balance = workerBalance(db, worker);
  const frozen = frozenShiftsOf(db, worker.id);
  const payable = payableShiftsOf(db, worker.id);

  return (
    <Card
      className={`relative transition-all duration-300 ${
        menuOpen
          ? "z-30 scale-[1.02] shadow-2xl ring-2 ring-primary/45"
          : "z-10 border border-line hover:z-20 hover:-translate-y-0.5 hover:shadow-lg"
      }`}
    >
      <CardBody className="relative flex min-h-[15rem] flex-col justify-between p-5">
        {/* ---- panneau d'actions ---------------------------------------- */}
        {menuOpen && (
          <div className="absolute inset-0 z-20 flex animate-in flex-col rounded-2xl border border-primary/20 bg-surface/98 p-4 backdrop-blur-md duration-200 fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-line pb-2">
              <span className="truncate text-[10px] font-bold uppercase tracking-wider text-muted">
                Actions : {workerName(worker)}
              </span>
              <button
                onClick={onCloseMenu}
                className="rounded-lg p-1 text-muted transition-colors hover:bg-canvas hover:text-ink"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="my-2 grid flex-1 grid-cols-2 content-center gap-2 overflow-y-auto">
              {can("view") && (
                <Action onClick={onView} icon={<Eye className="h-3.5 w-3.5" />}>
                  Voir
                </Action>
              )}
              {can("edit") && (
                <Action onClick={onEdit} icon={<Edit className="h-3.5 w-3.5" />}>
                  Modifier
                </Action>
              )}
              {can("permissions") && (
                <Action
                  onClick={onRights}
                  icon={<ShieldCheck className="h-3.5 w-3.5" />}
                  tone="primary"
                >
                  Droits d&apos;accès
                </Action>
              )}
              {can("pay") && (
                <Action onClick={onPay} icon={<Wallet className="h-3.5 w-3.5" />} tone="success">
                  Payer
                </Action>
              )}
              {can("acompte") && (
                <Action onClick={onAcompte} icon={<CreditCard className="h-3.5 w-3.5" />}>
                  Acompte
                </Action>
              )}
              {can("absence") && (
                <Action onClick={onAbsence} icon={<CalendarX className="h-3.5 w-3.5" />} tone="danger">
                  Absence
                </Action>
              )}
              {/* L'historique de travail n'a de sens que pour un compte : sans
                  accès, rien n'est jamais signé de son nom. */}
              {can("history") && worker.hasAccount && (
                <Action
                  onClick={onHistory}
                  icon={<History className="h-3.5 w-3.5" />}
                  className="col-span-2"
                >
                  Historique de travail
                </Action>
              )}
            </div>

            {can("delete") && (
              <div className="border-t border-line pt-2">
                <button
                  onClick={onDelete}
                  className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-danger px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-danger/90"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Supprimer
                </button>
              </div>
            )}
          </div>
        )}

        {/* ---- identité --------------------------------------------------- */}
        <div>
          <div className="mb-3 flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-primary/10 text-xs font-bold tracking-wider text-primary">
                {workerInitials(worker)}
              </div>
              <div className="min-w-0">
                <h4 className="truncate text-sm font-bold text-ink">{workerName(worker)}</h4>
                <span className="block truncate font-mono text-[10px] text-muted">
                  {worker.phone || "—"}
                </span>
                <div className="mt-0.5 flex flex-wrap items-center gap-1">
                  <Badge tone="primary" className="px-1.5 py-0 text-[9px]">
                    {workerRoleName(db, worker.role)}
                  </Badge>
                  {worker.hasAccount && (
                    <Badge tone="success" className="px-1.5 py-0 text-[9px]">
                      <KeyRound className="mr-0.5 inline h-2.5 w-2.5" /> Compte
                    </Badge>
                  )}
                  {worker.rfid && (
                    <Badge tone="neutral" className="px-1.5 py-0 font-mono text-[9px]">
                      🎫 {worker.rfid}
                    </Badge>
                  )}
                </div>
              </div>
            </div>
            <button
              onClick={onMenu}
              className="shrink-0 rounded-lg p-1.5 text-muted transition-colors hover:bg-primary-50 hover:text-ink"
            >
              <MoreVertical className="h-4 w-4" />
            </button>
          </div>

          {frozen.length > 0 && (
            <button
              onClick={onView}
              className="mb-2.5 flex w-full items-center gap-2 rounded-xl border border-danger/30 bg-danger/10 px-2.5 py-2 text-[10px] font-bold text-danger transition-colors hover:bg-danger/20"
            >
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span className="text-start">
                {frozen.length} journée(s) sans pointage de sortie — heures gelées
              </span>
            </button>
          )}

          {/* ---- contrat -------------------------------------------------- */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between rounded-xl border border-line/60 bg-canvas/30 p-2.5 text-xs">
              <div>
                <span className="block text-[10px] font-semibold uppercase text-muted">Contrat</span>
                <span className="font-semibold text-ink">
                  {WORKER_PAYMENT_LABELS[worker.paymentType]}
                </span>
              </div>
              <div className="text-end">
                <span className="block text-[10px] font-semibold uppercase text-muted">
                  Rémunération
                </span>
                <span className="font-bold text-primary">
                  {isHourly ? worker.hourlyRate ?? 0 : worker.salary} DA /{" "}
                  {WORKER_PAYMENT_UNITS[worker.paymentType]}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <Tile
                label={isHourly ? "Jours non payés" : "Périodes dues"}
                value={String(isHourly ? payable.length : balance.periods.length)}
                tone="text-ink"
              />
              <Tile
                label={isHourly ? "Heures non payées" : "Depuis le"}
                value={
                  isHourly
                    ? formatHours(minutesOf(payable))
                    : worker.startDate
                      ? formatDateFr(worker.startDate)
                      : "—"
                }
                tone="text-primary"
              />
              <Tile
                label="Acomptes à retenir"
                value={formatDA(balance.acomptesTotal)}
                tone="text-warning"
              />
              <Tile
                label="Absences à retenir"
                value={formatDA(balance.absencesTotal)}
                tone="text-danger"
              />
            </div>
          </div>
        </div>

        {/* ---- pied ------------------------------------------------------- */}
        <div className="mt-4 flex items-center justify-between border-t border-line/60 pt-3">
          <span className="flex items-center gap-1.5 text-[10px] text-muted">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                balance.net > 0 ? "animate-pulse bg-warning" : "bg-success"
              }`}
            />
            {balance.net > 0 ? "À régler" : "À jour"}
          </span>
          <Badge
            tone={balance.net > 0 ? "warning" : "success"}
            className="font-mono text-[10px] font-bold"
          >
            {formatDA(Math.max(0, balance.net))}
          </Badge>
        </div>
      </CardBody>
    </Card>
  );
}

function Action({
  onClick,
  icon,
  tone = "neutral",
  className = "",
  children,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  tone?: "neutral" | "primary" | "success" | "danger";
  className?: string;
  children: React.ReactNode;
}) {
  const toneClass = {
    neutral: "bg-canvas border-line text-ink hover:bg-primary-50",
    primary: "bg-primary/10 border-primary/30 text-primary hover:bg-primary/20",
    success: "bg-success/15 border-success/30 text-success hover:bg-success/25",
    danger: "bg-danger/15 border-danger/30 text-danger hover:bg-danger/25",
  }[tone];
  return (
    <button
      onClick={onClick}
      className={`flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold transition-colors ${toneClass} ${className}`}
    >
      {icon} {children}
    </button>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-xl border border-line/50 bg-canvas/20 p-2">
      <span className="block text-[9px] uppercase text-muted">{label}</span>
      <strong className={`mt-0.5 block truncate ${tone}`}>{value}</strong>
    </div>
  );
}
