"use client";

/**
 * « Mois & emplois du temps » — l'état de la paie d'un enseignant, sans rien
 * régler.
 *
 * Il répond aux trois questions que le bureau pose devant sa fiche :
 *   1. sur quel MOIS est-il en ce moment, et à quelle SÉANCE de ce mois ?
 *   2. les mois précédents sont-ils réglés — par les élèves ET à l'enseignant ?
 *   3. qui n'a pas payé, combien, et sur quel mois ?
 *
 * Les mois sont ceux de l'emploi du temps (M1, M2 …) : M1 s'ouvre à la première
 * présence et se ferme sur la séance qui complète le pack. Tout ce qu'un mois
 * n'a pas encaissé est reporté — et se lit sur le mois suivant.
 */

import { useMemo, useState } from "react";
import { useData } from "@/lib/store/data";
import { Badge, type Tone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/SearchInput";
import { formatDA } from "@/lib/utils";
import { formatDateFr } from "@/lib/helpers";
import {
  teacherEmplois,
  unpaidStudents,
  type MonthPayState,
  type MonthState,
  type TeacherEmploi,
  type TeacherMonth,
} from "@/lib/teacherMonths";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Search,
  Users,
  Wallet,
} from "lucide-react";
import type { Teacher } from "@/lib/types";

const MONTH_STATE: Record<MonthState, { label: string; tone: Tone }> = {
  done: { label: "Mois clos", tone: "primary" },
  running: { label: "En cours", tone: "warning" },
  upcoming: { label: "À venir", tone: "neutral" },
};

const PAY_STATE: Record<MonthPayState, { label: string; tone: Tone }> = {
  paid: { label: "Payé", tone: "success" },
  partial: { label: "Partiel", tone: "warning" },
  unpaid: { label: "Impayé", tone: "danger" },
  pending: { label: "Rien encore", tone: "neutral" },
  free: { label: "Gratuit", tone: "primary" },
};

export function TeacherMonthsModal({
  open,
  teacher,
  onClose,
  onPay,
}: {
  open: boolean;
  teacher: Teacher | null;
  onClose: () => void;
  /** ouvre l'écran de règlement depuis un mois clos non payé */
  onPay?: () => void;
}) {
  const db = useData();
  const [openEmploi, setOpenEmploi] = useState<string | null>(null);
  const [openMonth, setOpenMonth] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"emplois" | "unpaid">("emplois");

  const emplois = useMemo(
    () => (teacher ? teacherEmplois(db, teacher.id) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [teacher, db.sessions, db.attendance, db.unpaidTeacher, db.payments, db.enrollments, db.students, db.subscriptions, db.independent],
  );

  const debtors = useMemo(() => unpaidStudents(emplois), [emplois]);
  const totalPayable = emplois.reduce((s, e) => s + e.payable, 0);
  const totalWithheld = emplois.reduce((s, e) => s + e.withheld, 0);
  const totalSettled = emplois.reduce((s, e) => s + e.settled, 0);
  const closedUnpaid = emplois.flatMap((e) =>
    e.months.filter((m) => m.state === "done" && m.payable > 0),
  );
  const studentsDebt = debtors.reduce((s, r) => s + r.debt, 0);

  if (!teacher) return null;

  return (
    <Modal open={open} onClose={onClose} title="Mois & emplois du temps de l'enseignant" full>
      <div className="space-y-4">
        {/* ---- en-tête ------------------------------------------------- */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-canvas p-4">
          <div>
            <strong className="block text-sm text-ink">
              {teacher.firstName} {teacher.lastName}
            </strong>
            <span className="text-[11px] text-muted">
              {teacher.paymentType === "monthly"
                ? `Fixe mensuel — ${formatDA(teacher.monthlyAmount ?? 0)}`
                : teacher.paymentType === "per_group"
                  ? "Par groupe — tarif défini sur chaque emploi du temps"
                  : `Pourcentage — ${teacher.percentage ?? 0}% par élève`}
              {" · "}
              {emplois.length} emploi(s) du temps
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="success" className="font-mono font-bold">
              À régler : {formatDA(totalPayable)}
            </Badge>
            {totalWithheld > 0 && (
              <Badge tone="warning" className="font-mono font-bold">
                En attente : {formatDA(totalWithheld)}
              </Badge>
            )}
            <Badge tone="neutral" className="font-mono">
              Déjà versé : {formatDA(totalSettled)}
            </Badge>
            {onPay && totalPayable > 0 && (
              <Button size="sm" onClick={onPay} className="gap-1.5">
                <Wallet className="h-3.5 w-3.5" /> Régler
              </Button>
            )}
          </div>
        </div>

        {/* ---- alertes globales ---------------------------------------- */}
        <div className="grid grid-cols-1 gap-2 lg:grid-cols-3">
          <AlertCard
            tone={closedUnpaid.length > 0 ? "danger" : "success"}
            icon={closedUnpaid.length > 0 ? AlertTriangle : CheckCircle2}
            title={
              closedUnpaid.length > 0
                ? `${closedUnpaid.length} mois clos non réglé(s)`
                : "Aucun mois clos en attente"
            }
            text={
              closedUnpaid.length > 0
                ? closedUnpaid.map((m) => `${m.code} (${formatDA(m.payable)})`).join(" · ")
                : "Tous les mois terminés ont été payés à l'enseignant."
            }
          />
          <AlertCard
            tone={debtors.length > 0 ? "warning" : "success"}
            icon={debtors.length > 0 ? AlertTriangle : CheckCircle2}
            title={
              debtors.length > 0
                ? `${debtors.length} impayé(s) élève — ${formatDA(studentsDebt)}`
                : "Tous les élèves sont à jour"
            }
            text={
              debtors.length > 0
                ? "Ces montants sont reportés sur le mois suivant et bloquent la part de l'enseignant."
                : "Aucune dette sur les mois de ces emplois du temps."
            }
          />
          <AlertCard
            tone={totalWithheld > 0 ? "warning" : "primary"}
            icon={Clock}
            title={`${formatDA(totalWithheld)} de part enseignant en attente`}
            text={
              totalWithheld > 0
                ? "Réglés automatiquement au prochain paiement, dès que ces élèves auront payé."
                : "Rien n'est bloqué : tout ce qui est dû est réglable."
            }
          />
        </div>

        {/* ---- onglets -------------------------------------------------- */}
        <div className="flex gap-2">
          {(
            [
              { key: "emplois", label: `Emplois du temps (${emplois.length})`, icon: CalendarClock },
              { key: "unpaid", label: `Élèves impayés (${debtors.length})`, icon: AlertTriangle },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 rounded-xl border px-4 py-2 text-xs font-bold transition-colors ${
                tab === t.key
                  ? "border-primary bg-primary text-white"
                  : "border-line bg-surface text-ink hover:bg-primary-50"
              }`}
            >
              <t.icon className="h-4 w-4" /> {t.label}
            </button>
          ))}
        </div>

        {tab === "emplois" ? (
          emplois.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-line py-10 text-center text-xs italic text-muted">
              Cet enseignant n&apos;est affecté à aucun emploi du temps.
            </p>
          ) : (
            <div className="space-y-3">
              {emplois.map((e) => (
                <EmploiCard
                  key={e.sessionId}
                  emploi={e}
                  expanded={openEmploi === e.sessionId}
                  onToggle={() => setOpenEmploi(openEmploi === e.sessionId ? null : e.sessionId)}
                  openMonth={openMonth}
                  onToggleMonth={(key) => setOpenMonth(openMonth === key ? null : key)}
                />
              ))}
            </div>
          )
        ) : (
          <UnpaidTable rows={debtors} search={search} onSearch={setSearch} />
        )}

        <div className="flex justify-end border-t border-line pt-3">
          <Button variant="outline" onClick={onClose}>
            Fermer
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function AlertCard({
  tone,
  icon: Icon,
  title,
  text,
}: {
  tone: Tone;
  icon: typeof AlertTriangle;
  title: string;
  text: string;
}) {
  const shell: Record<string, string> = {
    danger: "border-danger/40 bg-danger/5 text-danger",
    warning: "border-warning/40 bg-warning/5 text-warning",
    success: "border-success/40 bg-success/5 text-success",
    primary: "border-primary/30 bg-primary-50/50 text-primary",
    neutral: "border-line bg-canvas text-muted",
  };
  return (
    <div className={`rounded-2xl border p-3 ${shell[tone]}`}>
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 shrink-0" />
        <strong className="text-xs">{title}</strong>
      </div>
      <p className="mt-1 text-[10px] leading-relaxed text-muted">{text}</p>
    </div>
  );
}

function EmploiCard({
  emploi,
  expanded,
  onToggle,
  openMonth,
  onToggleMonth,
}: {
  emploi: TeacherEmploi;
  expanded: boolean;
  onToggle: () => void;
  openMonth: string | null;
  onToggleMonth: (key: string) => void;
}) {
  const current = emploi.months[emploi.currentIndex];
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface">
      <button
        onClick={onToggle}
        className="flex w-full flex-wrap items-center justify-between gap-3 p-4 text-left transition-colors hover:bg-primary-50/40"
      >
        <div className="min-w-0">
          <strong className="flex items-center gap-1.5 text-sm text-ink">
            {expanded ? (
              <ChevronDown className="h-4 w-4 text-primary" />
            ) : (
              <ChevronRight className="h-4 w-4 text-primary" />
            )}
            {emploi.title}
            {emploi.isOpen && (
              <Badge tone="success" className="text-[9px]">
                Séance libre
              </Badge>
            )}
          </strong>
          <span className="ms-5 block text-[10px] text-muted">
            {emploi.className} · Gr. {emploi.groupName} · {emploi.salleName} · {emploi.daysLabel} ·{" "}
            {emploi.timeLabel}
          </span>
          <span className="ms-5 block text-[10px] text-muted">
            {emploi.size} séances / mois · séance à {formatDA(emploi.unitPrice)} ·{" "}
            {emploi.priced ? (
              <>part enseignant {formatDA(emploi.perSeance)} / séance</>
            ) : (
              <span className="font-semibold text-warning">aucune part enseignant définie</span>
            )}{" "}
            · {emploi.rosterCount} élève(s)
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Où en est le groupe : mois courant et séance courante de ce mois */}
          <Badge tone="primary" className="gap-1 font-bold">
            <CalendarClock className="h-3 w-3" />
            {emploi.currentCode} · séance {Math.min(Math.max(emploi.currentHeld, 0), emploi.size)}/
            {emploi.size}
          </Badge>
          <Badge tone={emploi.payable > 0 ? "success" : "neutral"} className="font-mono font-bold">
            {formatDA(emploi.payable)} à régler
          </Badge>
          {emploi.withheld > 0 && (
            <Badge tone="warning" className="font-mono">
              {formatDA(emploi.withheld)} en attente
            </Badge>
          )}
        </div>
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-line bg-canvas/30 p-4">
          {emploi.alerts.map((a, i) => (
            <p
              key={i}
              className={`rounded-xl border p-2 text-[11px] font-semibold ${
                a.tone === "danger"
                  ? "border-danger/40 bg-danger/10 text-danger"
                  : a.tone === "warning"
                    ? "border-warning/40 bg-warning/10 text-warning"
                    : a.tone === "success"
                      ? "border-success/40 bg-success/10 text-success"
                      : "border-primary/30 bg-primary-50/60 text-primary"
              }`}
            >
              {a.text}
            </p>
          ))}

          {current && current.state === "running" && (
            <p className="rounded-xl border border-primary/30 bg-primary-50/60 p-2.5 text-[11px] text-primary">
              <strong>Mois en cours ({current.code})</strong> : {current.held} séance(s) tenue(s) sur{" "}
              {current.size}. Il se fermera à la {current.size}
              <sup>e</sup> séance — c&apos;est à ce moment-là qu&apos;il sera proposé au règlement.
            </p>
          )}

          <div className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full min-w-[860px] text-xs">
              <thead className="bg-canvas/60">
                <tr className="text-left text-[10px] uppercase tracking-wide text-muted">
                  <th className="px-2 py-2">Mois</th>
                  <th className="px-2 py-2">État</th>
                  <th className="px-2 py-2">Séances</th>
                  <th className="px-2 py-2">Période</th>
                  <th className="px-2 py-2 text-center">Élèves payés</th>
                  <th className="px-2 py-2 text-right">Dette élèves</th>
                  <th className="px-2 py-2 text-right">Part enseignant</th>
                  <th className="px-2 py-2 text-right">Réglé</th>
                  <th className="px-2 py-2 text-right">Reste</th>
                </tr>
              </thead>
              <tbody>
                {emploi.months.map((m) => (
                  <MonthRows
                    key={m.key}
                    month={m}
                    expanded={openMonth === m.key}
                    onToggle={() => onToggleMonth(m.key)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function MonthRows({
  month,
  expanded,
  onToggle,
}: {
  month: TeacherMonth;
  expanded: boolean;
  onToggle: () => void;
}) {
  const state = MONTH_STATE[month.state];
  return (
    <>
      <tr
        onClick={onToggle}
        className={`cursor-pointer border-t border-line/60 transition-colors hover:bg-primary-50/40 ${
          month.isCurrent ? "bg-primary-50/30" : ""
        }`}
      >
        <td className="px-2 py-2 font-bold text-ink">
          {expanded ? "▾ " : "▸ "}
          {month.code}
          {month.isCurrent && (
            <Badge tone="primary" className="ml-1.5 text-[9px]">
              en cours
            </Badge>
          )}
        </td>
        <td className="px-2 py-2">
          <Badge tone={state.tone} className="text-[9px]">
            {state.label}
          </Badge>
        </td>
        <td className="px-2 py-2 font-mono text-muted">
          {month.held}/{month.size}
        </td>
        <td className="px-2 py-2 text-[10px] text-muted">
          {month.startDate ? formatDateFr(month.startDate) : "—"}
          {month.endDate ? ` → ${formatDateFr(month.endDate)}` : month.startDate ? " → …" : ""}
        </td>
        <td className="px-2 py-2 text-center">
          <span className="font-mono text-success">{month.studentsPaid}</span>
          <span className="text-muted"> / </span>
          <span className="font-mono text-danger">{month.studentsUnpaid}</span>
          {month.studentsPending > 0 && (
            <span className="ms-1 text-[9px] text-muted">({month.studentsPending} sans séance)</span>
          )}
        </td>
        <td className="px-2 py-2 text-right font-mono">
          {month.studentsDebt > 0 ? (
            <span className="font-bold text-danger">{formatDA(month.studentsDebt)}</span>
          ) : (
            <span className="text-success">✓</span>
          )}
        </td>
        <td className="px-2 py-2 text-right font-mono text-ink">{formatDA(month.gross)}</td>
        <td className="px-2 py-2 text-right font-mono text-success">{formatDA(month.settled)}</td>
        <td className="px-2 py-2 text-right font-mono">
          {month.payable > 0 ? (
            <span className="font-bold text-primary">{formatDA(month.payable)}</span>
          ) : month.withheld > 0 ? (
            <span className="text-warning">{formatDA(month.withheld)} en attente</span>
          ) : (
            <span className="text-muted">—</span>
          )}
        </td>
      </tr>

      {expanded && (
        <tr className="border-t border-line/60 bg-canvas/40">
          <td colSpan={9} className="px-3 py-3">
            <div className="space-y-2">
              {month.alerts.map((a, i) => (
                <p
                  key={i}
                  className={`rounded-lg border px-2 py-1.5 text-[10px] font-semibold ${
                    a.tone === "danger"
                      ? "border-danger/40 bg-danger/10 text-danger"
                      : a.tone === "warning"
                        ? "border-warning/40 bg-warning/10 text-warning"
                        : a.tone === "success"
                          ? "border-success/40 bg-success/10 text-success"
                          : "border-primary/30 bg-primary-50/60 text-primary"
                  }`}
                >
                  {a.text}
                </p>
              ))}

              {month.dates.length > 0 && (
                <p className="text-[10px] text-muted">
                  <strong className="text-ink">Séances tenues :</strong>{" "}
                  {month.dates.map((d, i) => (
                    <span key={d} className="font-mono">
                      {i > 0 ? " · " : ""}S{i + 1} {formatDateFr(d)}
                    </span>
                  ))}
                </p>
              )}

              <div className="overflow-x-auto rounded-xl border border-line bg-surface">
                <table className="w-full min-w-[900px] text-[11px]">
                  <thead className="bg-canvas/60">
                    <tr className="text-left text-[9px] uppercase tracking-wide text-muted">
                      <th className="px-2 py-1.5">N°</th>
                      <th className="px-2 py-1.5">Élève</th>
                      <th className="px-2 py-1.5 text-center">Séances</th>
                      <th className="px-2 py-1.5 text-center">P / A / An.</th>
                      <th className="px-2 py-1.5 text-right">Dû (mois)</th>
                      <th className="px-2 py-1.5 text-right">Consommé</th>
                      <th className="px-2 py-1.5 text-right">Versé</th>
                      <th className="px-2 py-1.5 text-right">Reste dû</th>
                      <th className="px-2 py-1.5">Statut</th>
                      <th className="px-2 py-1.5 text-right">Part prof</th>
                    </tr>
                  </thead>
                  <tbody>
                    {month.students.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="px-2 py-4 text-center italic text-muted">
                          Aucun élève n&apos;a encore atteint ce mois.
                        </td>
                      </tr>
                    ) : (
                      month.students.map((st) => {
                        const badge = PAY_STATE[st.status];
                        return (
                          <tr
                            key={st.studentId}
                            className={`border-t border-line/50 ${st.debt > 0 ? "bg-danger/5" : ""}`}
                          >
                            <td className="px-2 py-1.5 font-mono text-muted">
                              {st.registrationNumber}
                            </td>
                            <td className="px-2 py-1.5">
                              <strong className="text-ink">{st.name}</strong>
                              {st.caseLabel && (
                                <Badge tone="warning" className="ml-1.5 text-[8px]">
                                  {st.caseLabel}
                                </Badge>
                              )}
                              {st.previousDebt > 0 && (
                                <span className="block text-[9px] text-danger">
                                  + {formatDA(st.previousDebt)} d&apos;arriérés des mois précédents
                                </span>
                              )}
                              {st.otherDebt > 0 && (
                                <span className="block text-[9px] text-warning">
                                  + {formatDA(st.otherDebt)} sur ses autres emplois du temps
                                </span>
                              )}
                            </td>
                            <td className="px-2 py-1.5 text-center font-mono">
                              {st.done}/{st.size}
                              {st.complete && <span className="ms-1 text-success">✓</span>}
                            </td>
                            <td className="px-2 py-1.5 text-center font-mono text-muted">
                              {st.presents} / {st.absents} / {st.cancelled}
                            </td>
                            <td className="px-2 py-1.5 text-right font-mono text-muted">
                              {st.isFree ? "—" : formatDA(st.expected)}
                            </td>
                            <td className="px-2 py-1.5 text-right font-mono text-muted">
                              {formatDA(st.consumed)}
                            </td>
                            <td className="px-2 py-1.5 text-right font-mono text-success">
                              {formatDA(st.credited)}
                            </td>
                            <td className="px-2 py-1.5 text-right font-mono">
                              {st.debt > 0 ? (
                                <strong className="text-danger">{formatDA(st.debt)}</strong>
                              ) : (
                                <span className="text-success">0</span>
                              )}
                            </td>
                            <td className="px-2 py-1.5">
                              <Badge tone={badge.tone} className="text-[9px]">
                                {badge.label}
                              </Badge>
                            </td>
                            <td className="px-2 py-1.5 text-right font-mono">
                              <span className="text-ink">{formatDA(st.gross)}</span>
                              {st.withheld > 0 && (
                                <span className="block text-[9px] text-warning">
                                  {formatDA(st.withheld)} retenus
                                </span>
                              )}
                              {st.settled > 0 && (
                                <span className="block text-[9px] text-success">
                                  {formatDA(st.settled)} réglés
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {month.passagers.length > 0 && (
                <p className="text-[10px] text-muted">
                  <strong className="text-ink">Passagers :</strong>{" "}
                  {month.passagers
                    .map((p) => `${p.name} (${formatDateFr(p.dateKey)} — ${formatDA(p.price)})`)
                    .join(" · ")}
                </p>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function UnpaidTable({
  rows,
  search,
  onSearch,
}: {
  rows: ReturnType<typeof unpaidStudents>;
  search: string;
  onSearch: (v: string) => void;
}) {
  const shown = rows.filter((r) =>
    `${r.name} ${r.registrationNumber} ${r.emploi} ${r.monthCode}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );
  const total = shown.reduce((s, r) => s + r.debt, 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Rechercher un élève, un emploi du temps ou un mois…"
            className="pl-9"
          />
        </div>
        <Badge tone="danger" className="font-mono font-bold">
          {shown.length} ligne(s) · {formatDA(total)}
        </Badge>
      </div>

      {shown.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line py-10 text-center text-xs italic text-success">
          Aucun impayé — tous les mois de cet enseignant sont réglés par les élèves. ✅
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line">
          <table className="w-full min-w-[860px] text-xs">
            <thead className="bg-canvas/60">
              <tr className="text-left text-[10px] uppercase tracking-wide text-muted">
                <th className="px-2 py-2">N°</th>
                <th className="px-2 py-2">Élève</th>
                <th className="px-2 py-2">Téléphone</th>
                <th className="px-2 py-2">Emploi du temps</th>
                <th className="px-2 py-2">Mois</th>
                <th className="px-2 py-2 text-center">Séances</th>
                <th className="px-2 py-2 text-right">Versé</th>
                <th className="px-2 py-2 text-right">Reste dû</th>
                <th className="px-2 py-2 text-right">Part prof bloquée</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr
                  key={`${r.studentId}-${r.sessionId}-${r.monthCode}`}
                  className="border-t border-line/60 hover:bg-danger/5"
                >
                  <td className="px-2 py-2 font-mono text-muted">{r.registrationNumber}</td>
                  <td className="px-2 py-2 font-bold text-ink">{r.name}</td>
                  <td className="px-2 py-2 text-muted">{r.phone || "—"}</td>
                  <td className="px-2 py-2 text-muted">{r.emploi}</td>
                  <td className="px-2 py-2">
                    <Badge tone={MONTH_STATE[r.monthState].tone} className="text-[9px]">
                      {r.monthCode} · {MONTH_STATE[r.monthState].label}
                    </Badge>
                  </td>
                  <td className="px-2 py-2 text-center font-mono text-muted">
                    {r.done}/{r.size}
                  </td>
                  <td className="px-2 py-2 text-right font-mono text-success">
                    {formatDA(r.credited)}
                  </td>
                  <td className="px-2 py-2 text-right font-mono font-bold text-danger">
                    {formatDA(r.debt)}
                  </td>
                  <td className="px-2 py-2 text-right font-mono text-warning">
                    {r.withheld > 0 ? formatDA(r.withheld) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="flex items-start gap-1.5 rounded-xl border border-warning/30 bg-warning/5 p-2.5 text-[10px] text-warning">
        <Users className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Ces montants sont <strong>reportés sur le mois suivant</strong> de l&apos;emploi du temps
        concerné : le solde de l&apos;élève reste négatif tant qu&apos;il n&apos;a pas payé, et la
        part de l&apos;enseignant correspondante reste en attente au lieu d&apos;être versée.
      </p>
    </div>
  );
}
