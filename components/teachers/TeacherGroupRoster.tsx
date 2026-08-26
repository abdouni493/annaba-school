"use client";

/**
 * LA LISTE DES ÉLÈVES D'UN GROUPE, VUE PAR SON ENSEIGNANT.
 *
 * C'est la seule chose qu'un enseignant a le droit de faire sur un groupe :
 * LE LIRE. Il ouvre un créneau de sa journée, il voit qui le compose, où en est
 * chacun dans son mois, et qui traîne une dette — et rien d'autre. Aucun
 * bouton, aucune case à cocher, aucun encaissement : ces gestes-là appartiennent
 * au guichet, et l'écran ne les propose donc jamais ici.
 *
 * Les chiffres ne sont pas recalculés à part : ils sortent du MÊME modèle que
 * la paie de l'administration (`teacherMonths`), si bien que ce que l'enseignant
 * lit sur sa liste et ce que la réception lit sur l'écran de règlement sont, au
 * centime, la même chose.
 */

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useData } from "@/lib/store/data";
import { Badge, type Tone } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/SearchInput";
import { formatDA, money } from "@/lib/utils";
import {
  attendanceOn,
  formatDateFr,
  monthCodeLabel,
  registrationNumberOf,
  studentName,
} from "@/lib/helpers";
import type { TeacherEmploi, TeacherMonthStudent } from "@/lib/teacherMonths";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock,
  DoorOpen,
  GraduationCap,
  MapPin,
  Search,
  Users,
  Wallet,
} from "lucide-react";

/** Le statut de paiement d'un élève sur son mois, dit d'un mot. */
const PAY_STATE: Record<string, { label: string; tone: Tone }> = {
  paid: { label: "À jour", tone: "success" },
  partial: { label: "Partiel", tone: "warning" },
  unpaid: { label: "Impayé", tone: "danger" },
  pending: { label: "Rien encore", tone: "neutral" },
  free: { label: "Gratuit", tone: "primary" },
};

/** Le pointage du jour, pour la colonne « ce jour » de la liste. */
const MARK_STYLE: Record<string, { short: string; label: string; cls: string }> = {
  present: { short: "P", label: "Présent", cls: "bg-success/15 text-success border-success/40" },
  late: { short: "R", label: "En retard", cls: "bg-warning/15 text-warning border-warning/40" },
  absent: { short: "A", label: "Absent", cls: "bg-danger/15 text-danger border-danger/40" },
  cancelled: {
    short: "×",
    label: "Séance annulée",
    cls: "bg-primary/15 text-primary border-primary/40",
  },
};

export function TeacherGroupRoster({
  emploi,
  date,
  onClose,
}: {
  emploi: TeacherEmploi | null;
  /** le jour affiché, quand la liste s'ouvre depuis un créneau de la journée */
  date?: string;
  onClose: () => void;
}) {
  const db = useData();
  const [query, setQuery] = useState("");

  /**
   * LE MOIS QUE LE GROUPE VIT AUJOURD'HUI — c'est lui qui porte la liste.
   *
   * Un groupe qui n'a pas encore de mois (créneau tout neuf, séance libre sans
   * abonnement) retombe sur son effectif brut : mieux vaut une liste sans
   * chiffres qu'un écran vide.
   */
  const rows = useMemo(() => {
    if (!emploi) return [] as TeacherMonthStudent[];
    const month = emploi.months[emploi.currentIndex] ?? emploi.months[emploi.months.length - 1];
    if (month && month.students.length > 0) return month.students;
    const subIds = db.subscriptions
      .filter((s) => s.sessionId === emploi.sessionId)
      .map((s) => s.id);
    return db.students
      .filter((st) => st.subscriptionIds.some((id) => subIds.includes(id)))
      .map(
        (st) =>
          ({
            studentId: st.id,
            name: studentName(st),
            registrationNumber: registrationNumberOf(db, st),
            phone: st.phone ?? "",
            caseLabel: "",
            isFree: false,
            done: 0,
            size: emploi.size,
            complete: false,
            presents: 0,
            absents: 0,
            cancelled: 0,
            caseKind: "normal",
            isTeacherChild: false,
            unitPrice: 0,
            listPrice: 0,
            schoolPerSeance: 0,
            teacherPerSeance: emploi.perSeance,
            expected: 0,
            consumed: 0,
            credited: 0,
            balance: 0,
            debt: 0,
            previousDebt: 0,
            emploiDebt: 0,
            otherDebt: 0,
            totalDebt: 0,
            status: "pending",
            gross: 0,
            settled: 0,
            open: 0,
            withheld: 0,
            hasDebt: false,
          }) as TeacherMonthStudent,
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emploi, db.students, db.subscriptions]);

  if (!emploi) return null;

  const monthCode = emploi.currentCode;
  const q = query.trim().toLowerCase();
  const visible = q
    ? rows.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          (r.registrationNumber ?? "").toLowerCase().includes(q) ||
          (r.phone ?? "").includes(q),
      )
    : rows;

  const inDebt = rows.filter((r) => r.debt > 0);
  const upToDate = rows.length - inDebt.length;
  const debtTotal = money(inDebt.reduce((s, r) => s + r.debt, 0));

  return (
    <Modal
      open
      onClose={onClose}
      full
      title={`Liste des élèves — ${emploi.title} · ${emploi.groupName}`}
    >
      <div className="space-y-4">
        {/* ---- la carte d'identité du créneau ------------------------------ */}
        <div className="overflow-hidden rounded-2xl border border-primary/25 bg-gradient-to-br from-primary-50/80 to-transparent">
          <div className="flex flex-wrap items-start justify-between gap-3 p-4">
            <div className="min-w-0">
              <strong className="flex flex-wrap items-center gap-2 text-base text-ink">
                <GraduationCap className="h-5 w-5 text-primary" />
                {emploi.title}
                <Badge tone="primary" className="text-[10px]">
                  Groupe {emploi.groupName}
                </Badge>
                {emploi.isOpen && (
                  <Badge tone="success" className="text-[10px]">
                    Séance libre
                  </Badge>
                )}
              </strong>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
                <span className="inline-flex items-center gap-1">
                  <Users className="h-3 w-3" /> {emploi.className}
                </span>
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3 w-3" /> Salle {emploi.salleName}
                </span>
                <span className="inline-flex items-center gap-1">
                  <CalendarClock className="h-3 w-3" /> {emploi.daysLabel}
                </span>
                <span className="inline-flex items-center gap-1 font-mono">
                  <Clock className="h-3 w-3" /> {emploi.timeLabel}
                </span>
                {date && (
                  <Badge tone="neutral" className="text-[10px]">
                    <DoorOpen className="h-3 w-3" /> Séance du {formatDateFr(date)}
                  </Badge>
                )}
              </div>
            </div>
            <div className="shrink-0 rounded-2xl border border-primary/30 bg-surface px-4 py-2 text-center">
              <span className="block text-[9px] font-bold uppercase tracking-wider text-muted">
                Mois en cours
              </span>
              <strong className="block font-mono text-lg font-black text-primary">
                {monthCodeLabel(monthCode)}
              </strong>
              <span className="block font-mono text-[10px] text-muted">
                séance {Math.min(Math.max(emploi.currentHeld, 0), emploi.size)}/{emploi.size}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-px border-t border-primary/20 bg-primary/10 sm:grid-cols-4">
            <RosterStat
              label="Élèves inscrits"
              value={String(rows.length)}
              icon={<Users className="h-3.5 w-3.5" />}
            />
            <RosterStat
              label="À jour"
              value={String(upToDate)}
              tone="text-success"
              icon={<CheckCircle2 className="h-3.5 w-3.5" />}
            />
            <RosterStat
              label="En retard de paiement"
              value={String(inDebt.length)}
              tone={inDebt.length > 0 ? "text-danger" : "text-muted"}
              icon={<AlertTriangle className="h-3.5 w-3.5" />}
            />
            <RosterStat
              label="Total dû sur ce groupe"
              value={formatDA(debtTotal)}
              tone={debtTotal > 0 ? "text-danger" : "text-muted"}
              icon={<Wallet className="h-3.5 w-3.5" />}
            />
          </div>
        </div>

        {/* ---- ce que cet écran est, et ce qu'il n'est pas ----------------- */}
        <p className="rounded-2xl border border-line bg-canvas/50 p-3 text-[11px] leading-relaxed text-muted">
          Cette liste se <strong className="text-ink">consulte</strong>. Le pointage des présences,
          les encaissements et les corrections se font au guichet : rien de ce que vous lisez ici ne
          se modifie depuis votre compte. Un élève « en retard de paiement » n&apos;a pas soldé son
          mois sur <strong className="text-ink">ce groupe-ci</strong> — c&apos;est ce qui retient la
          part que ses séances vous rapportent, jusqu&apos;à ce qu&apos;il s&apos;acquitte.
        </p>

        {rows.length > 6 && (
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted ltr:left-3 rtl:right-3" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher un élève, un numéro, un téléphone…"
              className="text-xs ltr:pl-9 rtl:pr-9"
            />
          </div>
        )}

        {/* ---- la liste ---------------------------------------------------- */}
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full min-w-[860px] text-[11px]">
            <thead className="bg-canvas/70">
              <tr className="text-left text-[9px] uppercase tracking-wide text-muted">
                <th className="px-3 py-2.5">N°</th>
                <th className="px-3 py-2.5">Élève</th>
                <th className="px-3 py-2.5">Téléphone</th>
                <th className="px-3 py-2.5 text-center">Séances du mois</th>
                <th className="px-3 py-2.5 text-center">P / A / An.</th>
                {date && <th className="px-3 py-2.5 text-center">Ce jour</th>}
                <th className="px-3 py-2.5 text-center">Paiement du mois</th>
                <th className="px-3 py-2.5 text-right">Versé</th>
                <th className="px-3 py-2.5 text-right">Reste dû</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td
                    colSpan={date ? 9 : 8}
                    className="px-3 py-10 text-center text-xs italic text-muted"
                  >
                    {rows.length === 0
                      ? "Aucun élève inscrit sur ce groupe pour l'instant."
                      : "Aucun élève ne correspond à cette recherche."}
                  </td>
                </tr>
              ) : (
                visible.map((r, i) => {
                  const state = PAY_STATE[r.status] ?? PAY_STATE.pending;
                  const mark = date
                    ? attendanceOn(db, r.studentId, emploi.sessionId, date)?.status
                    : undefined;
                  const markStyle = mark ? MARK_STYLE[mark] : undefined;
                  return (
                    <motion.tr
                      key={r.studentId}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(i * 0.015, 0.3) }}
                      className={`border-t border-line/60 transition-colors hover:bg-primary-50/30 ${
                        r.debt > 0 ? "bg-danger/5" : ""
                      }`}
                    >
                      <td className="px-3 py-2.5 font-mono text-[10px] text-muted">
                        {r.registrationNumber || "—"}
                      </td>
                      <td className="px-3 py-2.5">
                        <strong className="block text-ink">{r.name}</strong>
                        <div className="mt-0.5 flex flex-wrap gap-1">
                          {r.caseLabel && (
                            <Badge tone="warning" className="text-[8px]">
                              {r.caseLabel}
                            </Badge>
                          )}
                          {r.isFree && (
                            <Badge tone="primary" className="text-[8px]">
                              gratuit sur ce groupe
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-[10px] text-muted">
                        {r.phone || "—"}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <span className="font-mono font-bold text-ink">
                          {r.done}/{r.size}
                        </span>
                        <span className="mx-auto mt-1 block h-1.5 w-16 overflow-hidden rounded-full bg-line/60">
                          <span
                            className={`block h-full ${r.complete ? "bg-success" : "bg-primary"}`}
                            style={{
                              width: `${Math.min(100, r.size > 0 ? (r.done / r.size) * 100 : 0)}%`,
                            }}
                          />
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-center font-mono text-[10px]">
                        <span className="text-success">{r.presents}</span> /{" "}
                        <span className="text-danger">{r.absents}</span> /{" "}
                        <span className="text-primary">{r.cancelled}</span>
                      </td>
                      {date && (
                        <td className="px-3 py-2.5 text-center">
                          <span
                            title={markStyle ? markStyle.label : "Pas encore pointé"}
                            className={`inline-flex h-6 w-6 items-center justify-center rounded-lg border text-[11px] font-black ${
                              markStyle?.cls ?? "border-dashed border-line bg-canvas text-muted/50"
                            }`}
                          >
                            {markStyle ? markStyle.short : "–"}
                          </span>
                        </td>
                      )}
                      <td className="px-3 py-2.5 text-center">
                        <Badge tone={state.tone} className="text-[9px]">
                          {state.label}
                        </Badge>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-success">
                        {formatDA(r.credited)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono">
                        {r.debt > 0 ? (
                          <strong className="text-danger">{formatDA(r.debt)}</strong>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                    </motion.tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}

function RosterStat({
  label,
  value,
  tone = "text-ink",
  icon,
}: {
  label: string;
  value: string;
  tone?: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="bg-surface px-3 py-2.5 text-center">
      <span className="flex items-center justify-center gap-1 text-[9px] font-bold uppercase tracking-wider text-muted">
        {icon} {label}
      </span>
      <strong className={`mt-0.5 block font-mono text-sm font-black ${tone}`}>{value}</strong>
    </div>
  );
}
