"use client";

/**
 * L'HISTORIQUE DE TRAVAIL D'UN TRAVAILLEUR — ce qu'il a fait DEPUIS SON COMPTE.
 *
 * Pas ce qu'on lui a versé — cela vit sur sa fiche. Ici on lit son travail :
 * les présences qu'il a pointées, les paiements d'élèves qu'il a encaissés, les
 * frais qu'il a portés, les élèves qu'il a inscrits, les mouvements de caisse
 * qu'il a saisis. Chaque ligne porte son jour, son heure à la minute près, et
 * de qui il s'agissait.
 *
 * L'écran n'a de sens que pour un travailleur qui a un accès : sans compte,
 * rien n'est jamais signé de son nom.
 */

import { useMemo, useState } from "react";
import {
  Activity,
  BookUser,
  CalendarCheck,
  Clock,
  Receipt,
  Search,
  UserPlus,
  Wallet,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { Input, Select } from "@/components/ui/SearchInput";
import { useData } from "@/lib/store/data";
import { formatDA } from "@/lib/utils";
import {
  formatDateFr,
  groupName,
  moduleName,
  sessionTimeLabel,
  studentName,
} from "@/lib/helpers";
import type { ReceptionStaff } from "@/lib/types";
import { workerInitials, workerName, workerRoleName } from "@/lib/workers";

type Kind = "presence" | "payment" | "charge" | "student" | "cash";

const KIND_META: Record<
  Kind,
  { label: string; icon: React.ReactNode; tone: string; accent: string }
> = {
  presence: {
    label: "Présence pointée",
    icon: <CalendarCheck className="h-3.5 w-3.5" />,
    tone: "border-primary/30 bg-primary-50/40",
    accent: "text-primary",
  },
  payment: {
    label: "Paiement d'élève",
    icon: <Wallet className="h-3.5 w-3.5" />,
    tone: "border-success/30 bg-success/5",
    accent: "text-success",
  },
  charge: {
    label: "Frais porté au compte",
    icon: <Receipt className="h-3.5 w-3.5" />,
    tone: "border-warning/30 bg-warning/5",
    accent: "text-warning",
  },
  student: {
    label: "Élève inscrit",
    icon: <UserPlus className="h-3.5 w-3.5" />,
    tone: "border-line bg-canvas/40",
    accent: "text-ink",
  },
  cash: {
    label: "Mouvement de caisse",
    icon: <BookUser className="h-3.5 w-3.5" />,
    tone: "border-line bg-canvas/40",
    accent: "text-ink",
  },
};

interface Entry {
  id: string;
  kind: Kind;
  /** l'instant exact — c'est lui qui ordonne le journal */
  at: string;
  title: string;
  subject: string;
  detail: string;
  amount?: number;
  /** vue par le journal : l'argent est-il entré ? */
  incoming?: boolean;
}

export function WorkerHistoryModal({
  worker,
  onClose,
}: {
  worker: ReceptionStaff;
  onClose: () => void;
}) {
  const db = useData();
  const [kind, setKind] = useState<Kind | "all">("all");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const entries = useMemo<Entry[]>(() => {
    const mine = worker.id;
    const out: Entry[] = [];

    for (const a of db.attendance) {
      if (a.createdBy !== mine) continue;
      const session = db.sessions.find((s) => s.id === a.sessionId);
      const student = db.students.find((s) => s.id === a.studentId);
      const slot = session ? sessionTimeLabel(session) : "";
      out.push({
        id: a.id,
        kind: "presence",
        at: a.timestamp,
        title:
          a.status === "present"
            ? "Présent"
            : a.status === "absent"
              ? "Absent"
              : a.status === "late"
                ? "Retard"
                : "Séance annulée",
        subject: student ? studentName(student) : "Élève supprimé",
        detail: session
          ? `${moduleName(db, session.moduleId)} — ${groupName(db, session.groupId)}` +
            (slot ? ` · créneau ${slot}` : "")
          : "Emploi du temps supprimé",
        amount: a.amountDeducted || undefined,
      });
    }

    for (const p of db.payments) {
      if (p.createdBy !== mine) continue;
      const student = db.students.find((s) => s.id === p.studentId);
      out.push({
        id: p.id,
        kind: "payment",
        at: p.date,
        title: p.type === "debt_payment" ? "Règlement de dette" : "Encaissement de séances",
        subject: student ? studentName(student) : "Élève supprimé",
        detail:
          p.description ||
          (p.seancesPurchased ? `${p.seancesPurchased} séance(s)` : "Versement") +
            (p.monthCode ? ` · ${p.monthCode}` : ""),
        amount: p.amountPaid,
        incoming: true,
      });
    }

    for (const c of db.studentCharges) {
      if (c.createdBy !== mine) continue;
      const student = db.students.find((s) => s.id === c.studentId);
      out.push({
        id: c.id,
        kind: "charge",
        at: c.createdAt || `${c.date}T12:00:00`,
        title: c.name || "Frais",
        subject: student ? studentName(student) : "Élève supprimé",
        detail: c.description || "Frais porté au compte de l'élève",
        amount: c.amount,
      });
    }

    // Une fiche d'élève ne porte pas de date de création à elle. On la lit sur
    // sa PREMIÈRE inscription, faute de quoi sur son premier versement : c'est
    // le moment où le travailleur l'a réellement enregistré au comptoir.
    for (const s of db.students) {
      if (s.createdBy !== mine) continue;
      const firstEnr = db.enrollments
        .filter((e) => e.studentId === s.id && e.createdAt)
        .map((e) => e.createdAt as string)
        .sort()[0];
      const firstPay = db.payments
        .filter((p) => p.studentId === s.id)
        .map((p) => p.date)
        .sort()[0];
      const at = firstEnr || firstPay;
      if (!at) continue;
      out.push({
        id: s.id,
        kind: "student",
        at,
        title: "Nouvel élève inscrit",
        subject: studentName(s),
        detail: `${s.subscriptionIds.length} emploi(s) du temps souscrit(s)`,
      });
    }

    for (const c of db.cash) {
      if (c.createdBy !== mine) continue;
      // Les entrées de caisse d'un encaissement d'élève sont déjà racontées par
      // la ligne du paiement : les redire ferait double emploi.
      if (c.type === "student_payment") continue;
      out.push({
        id: c.id,
        kind: "cash",
        at: c.date,
        title:
          c.type === "deposit"
            ? "Dépôt en caisse"
            : c.type === "withdraw"
              ? "Retrait de caisse"
              : c.type === "expense"
                ? "Dépense"
                : "Mouvement de caisse",
        subject: "Caisse",
        detail: c.description,
        amount: Math.abs(c.amount),
        incoming: c.amount > 0,
      });
    }

    return out.sort((a, b) => b.at.localeCompare(a.at));
  }, [db, worker.id]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (kind !== "all" && e.kind !== kind) return false;
      const day = e.at.slice(0, 10);
      if (from && day < from) return false;
      if (to && day > to) return false;
      if (!q) return true;
      return (
        e.subject.toLowerCase().includes(q) ||
        e.title.toLowerCase().includes(q) ||
        e.detail.toLowerCase().includes(q)
      );
    });
  }, [entries, kind, search, from, to]);

  /** Les lignes regroupées par jour : un journal se lit jour par jour. */
  const byDay = useMemo(() => {
    const map = new Map<string, Entry[]>();
    for (const e of filtered) {
      const day = e.at.slice(0, 10);
      const list = map.get(day);
      if (list) list.push(e);
      else map.set(day, [e]);
    }
    return [...map.entries()];
  }, [filtered]);

  const counts = useMemo(() => {
    const c: Record<Kind, number> = { presence: 0, payment: 0, charge: 0, student: 0, cash: 0 };
    for (const e of entries) c[e.kind] += 1;
    return c;
  }, [entries]);

  const collected = entries
    .filter((e) => e.kind === "payment")
    .reduce((s, e) => s + (e.amount ?? 0), 0);

  const fmtClock = (iso: string) => {
    const d = new Date(iso);
    return isNaN(d.getTime())
      ? "—"
      : d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };

  return (
    <Modal open onClose={onClose} wide title={`Historique de travail — ${workerName(worker)}`}>
      <div className="space-y-4">
        {/* ---- en-tête ------------------------------------------------------ */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-canvas/40 p-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-primary/10 text-xs font-bold tracking-wider text-primary">
              {workerInitials(worker)}
            </div>
            <div className="min-w-0">
              <strong className="block truncate text-sm text-ink">{workerName(worker)}</strong>
              <span className="block text-[10px] text-muted">
                {workerRoleName(db, worker.role)} · {worker.email || "sans email"}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Badge tone="primary" className="font-mono text-[10px]">
              <Activity className="mr-1 inline h-3 w-3" /> {entries.length} opération(s)
            </Badge>
            <Badge tone="success" className="font-mono text-[10px]">
              {formatDA(collected)} encaissés
            </Badge>
          </div>
        </div>

        {/* ---- ce qu'il a fait, en un coup d'œil ---------------------------- */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {(Object.keys(KIND_META) as Kind[]).map((k) => (
            <button
              key={k}
              onClick={() => setKind(kind === k ? "all" : k)}
              className={`rounded-xl border p-2.5 text-center transition-colors ${
                kind === k ? "border-primary/40 bg-primary-50" : "border-line bg-surface hover:bg-canvas/50"
              }`}
            >
              <span className={`flex items-center justify-center gap-1 ${KIND_META[k].accent}`}>
                {KIND_META[k].icon}
              </span>
              <strong className="mt-1 block font-mono text-sm text-ink">{counts[k]}</strong>
              <span className="block text-[9px] font-bold uppercase leading-tight tracking-wide text-muted">
                {KIND_META[k].label}
              </span>
            </button>
          ))}
        </div>

        {/* ---- filtres ------------------------------------------------------ */}
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-canvas/30 p-2">
          <div className="relative min-w-[13rem] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Chercher un élève, un montant, un motif…"
              className="pl-9"
            />
          </div>
          <Select
            value={kind}
            onChange={(e) => setKind(e.target.value as Kind | "all")}
            className="min-w-[10rem]"
          >
            <option value="all">Toutes les opérations</option>
            {(Object.keys(KIND_META) as Kind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_META[k].label}
              </option>
            ))}
          </Select>
          <Input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="w-40"
            title="À partir du"
          />
          <Input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="w-40"
            title="Jusqu'au"
          />
          {(search || from || to || kind !== "all") && (
            <button
              onClick={() => {
                setSearch("");
                setFrom("");
                setTo("");
                setKind("all");
              }}
              className="text-[10px] font-bold text-primary hover:underline"
            >
              Réinitialiser
            </button>
          )}
        </div>

        {/* ---- le journal --------------------------------------------------- */}
        {!worker.hasAccount ? (
          <p className="rounded-2xl border border-dashed border-line py-10 text-center text-[11px] italic text-muted">
            Ce travailleur n&apos;a pas de compte de connexion — rien ne peut être signé de son nom.
          </p>
        ) : byDay.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line py-10 text-center text-[11px] italic text-muted">
            Aucune opération ne correspond — ou il n&apos;a encore rien fait depuis son compte.
          </p>
        ) : (
          <div className="max-h-[26rem] space-y-4 overflow-y-auto pr-1">
            {byDay.map(([day, rows]) => (
              <div key={day} className="space-y-1.5">
                <div className="sticky top-0 z-10 flex items-center gap-2 bg-surface/95 py-1 backdrop-blur">
                  <span className="rounded-lg bg-primary-50 px-2 py-0.5 text-[10px] font-bold text-primary">
                    {formatDateFr(day)}
                  </span>
                  <span className="text-[9px] font-bold uppercase tracking-wide text-muted">
                    {rows.length} opération(s)
                  </span>
                  <span className="h-px flex-1 bg-line" />
                </div>

                {rows.map((e) => {
                  const meta = KIND_META[e.kind];
                  return (
                    <div
                      key={`${e.kind}-${e.id}`}
                      className={`flex items-start gap-3 rounded-xl border p-2.5 ${meta.tone}`}
                    >
                      <span
                        className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-line bg-surface ${meta.accent}`}
                      >
                        {meta.icon}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <strong className="text-[11px] text-ink">{e.title}</strong>
                          <span className="text-[11px] font-semibold text-primary">{e.subject}</span>
                        </div>
                        <span className="mt-0.5 block text-[10px] leading-snug text-muted">
                          {e.detail}
                        </span>
                        <span className="mt-0.5 flex items-center gap-1 font-mono text-[9px] text-muted">
                          <Clock className="h-2.5 w-2.5" /> {fmtClock(e.at)}
                        </span>
                      </div>
                      {e.amount !== undefined && e.amount > 0 && (
                        <strong
                          className={`shrink-0 font-mono text-[11px] ${
                            e.incoming ? "text-success" : meta.accent
                          }`}
                        >
                          {e.incoming ? "+" : ""}
                          {formatDA(e.amount)}
                        </strong>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
