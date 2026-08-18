"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useData } from "@/lib/store/data";
import { useSession } from "@/lib/store/session";
import { useSettings } from "@/lib/store/settings";
import { useToast } from "@/lib/store/toast";
import { Card, CardBody } from "@/components/ui/Card";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input, Select } from "@/components/ui/SearchInput";
import { TeacherPages } from "@/components/pages/TeacherPages";
import { formatDA } from "@/lib/utils";
import { printHtmlDocument } from "@/lib/print";
import { bannerHtml, letterheadHtml, metaFooterHtml, printDocument, signaturesHtml } from "@/lib/printTemplates";
import {
  SCHOOL_MONTHS,
  currentMonthCode,
  monthCodeLabel,
  schoolMonthByCode,
  enrollmentUnitPrice,
  presentSeancesInMonth,
  studentDebtByMonth,
  studentMonthDebt,
  studentPreviousMonthsDebt,
  sessionEnrolledStudents,
  studentName,
} from "@/lib/helpers";
import {
  Clock,
  UserPlus,
  CalendarPlus,
  Ticket,
  Receipt,
  Wallet,
  Printer,
  Users,
  Phone,
  ChevronDown,
  ChevronRight,
  X,
} from "lucide-react";
import type { Day, ScheduleSession } from "@/lib/types";

const JS_DAYS: Day[] = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export default function DashboardPage() {
  const { user } = useSession();
  if (user?.role === "teacher") return <TeacherPages slug="dashboard" />;
  return <AdminDashboard />;
}

/** Quick-access links to the creation screens. */
const QUICK_ACTIONS = [
  { href: "/students", label: "Nouvel étudiant", icon: UserPlus, tone: "bg-gradient-primary" },
  { href: "/planner", label: "Nouveau créneau", icon: CalendarPlus, tone: "bg-gradient-success" },
  { href: "/subscriptions", label: "Nouvel abonnement", icon: Ticket, tone: "bg-gradient-warning" },
  { href: "/expenses", label: "Nouvelle dépense", icon: Receipt, tone: "bg-gradient-danger" },
  { href: "/teachers", label: "Paiement enseignant", icon: Wallet, tone: "bg-gradient-primary" },
];

function AdminDashboard() {
  const db = useData();
  const { sessions, teachers, modules, groups, salles, classes, students } = db;
  const { language } = useSettings();
  const { addToast } = useToast();
  const notify = (message: string, type: "success" | "error" = "success") =>
    addToast({
      type: type === "error" ? "danger" : "success",
      title: type === "error" ? "Erreur" : "Succès",
      message,
    });

  const [month, setMonth] = useState<string>(currentMonthCode());
  const [ficheSessionId, setFicheSessionId] = useState<string | null>(null);

  const today = new Date();
  const todayDow = JS_DAYS[today.getDay()];
  const todayIso = today.toLocaleDateString("fr-CA");

  const name = <T extends { id: string; name: string }>(list: T[], id: string) =>
    list.find((x) => x.id === id)?.name ?? "-";
  const teacherLabel = (id: string) => {
    const t = teachers.find((x) => x.id === id);
    return t ? `${t.firstName} ${t.lastName}` : "-";
  };
  const sessionTitle = (s: ScheduleSession) =>
    s.title || modules.find((m) => m.id === s.moduleId)?.name || "Séance";

  // Today's timings, ordered by start hour.
  const todaysTimings = useMemo(
    () =>
      sessions
        .filter(
          (s) =>
            s.days.includes(todayDow) &&
            (!s.periodStart || s.periodStart <= todayIso) &&
            (!s.periodEnd || s.periodEnd >= todayIso),
        )
        .sort((a, b) => a.startTime.localeCompare(b.startTime)),
    [sessions, todayDow, todayIso],
  );

  const ficheSession = sessions.find((s) => s.id === ficheSessionId) ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <PageHeader emoji="🏠" title="Tableau de Bord" subtitle="Séances du jour et fiches de présence" />
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold text-muted">Mois scolaire :</span>
          <Select value={month} onChange={(e) => setMonth(e.target.value)} className="min-w-[150px]">
            {SCHOOL_MONTHS.map((m) => (
              <option key={m.code} value={m.code}>
                {m.code} · {m.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {QUICK_ACTIONS.map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className={`${a.tone} flex items-center gap-2.5 rounded-2xl p-3.5 text-white shadow-sm transition-transform hover:scale-[1.02]`}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/15">
              <a.icon className="h-4.5 w-4.5" />
            </span>
            <span className="text-xs font-bold leading-tight">{a.label}</span>
          </Link>
        ))}
      </div>

      {/* Today's timings by hour */}
      <Card className="border border-line card-shadow">
        <CardBody className="space-y-4 p-5">
          <h3 className="flex items-center gap-2 border-b border-line pb-3 font-bold text-ink">
            <Clock className="h-4.5 w-4.5 text-primary" /> Séances du jour —{" "}
            {today.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}
            <Badge tone="primary" className="ml-auto">{monthCodeLabel(month)}</Badge>
          </h3>

          {todaysTimings.length === 0 ? (
            <p className="py-10 text-center text-xs italic text-muted">Aucune séance planifiée aujourd&apos;hui.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wide text-muted">
                    <th className="py-2">Heure</th>
                    <th className="py-2">Créneau</th>
                    <th className="py-2">Classe · Groupe</th>
                    <th className="py-2">Enseignant</th>
                    <th className="py-2">Salle</th>
                    <th className="py-2 text-center">Inscrits</th>
                    <th className="py-2 text-right">Fiche</th>
                  </tr>
                </thead>
                <tbody>
                  {todaysTimings.map((s) => {
                    const enrolled = sessionEnrolledStudents(db, s.id).length;
                    return (
                      <tr
                        key={s.id}
                        onClick={() => setFicheSessionId(s.id)}
                        className="cursor-pointer border-t border-line/60 transition-colors hover:bg-primary-50/50"
                      >
                        <td className="py-2.5">
                          <Badge tone="primary" className="font-mono">{s.startTime}–{s.endTime}</Badge>
                        </td>
                        <td className="py-2.5 font-bold text-ink">
                          {sessionTitle(s)}
                          {s.isOpen && <Badge tone="success" className="ml-1.5 text-[9px]">Séance libre</Badge>}
                        </td>
                        <td className="py-2.5 text-muted">
                          {name(classes, s.classId)} · {name(groups, s.groupId)}
                        </td>
                        <td className="py-2.5 text-muted">{teacherLabel(s.teacherId)}</td>
                        <td className="py-2.5 text-muted">{name(salles, s.salleId)}</td>
                        <td className="py-2.5 text-center font-mono">{enrolled}</td>
                        <td className="py-2.5 text-right">
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-primary">
                            Ouvrir <ChevronRight className="h-3.5 w-3.5" />
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {ficheSession && (
        <PresenceFiche
          session={ficheSession}
          month={month}
          onClose={() => setFicheSessionId(null)}
          onPrint={() => printFiche(ficheSession)}
        />
      )}
    </div>
  );

  function printFiche(session: ScheduleSession) {
    const roster = sessionEnrolledStudents(db, session.id);
    const rows = roster
      .map((stu) => {
        const seances = presentSeancesInMonth(db, stu.id, session.id, month);
        const monthDebt = studentMonthDebt(db, stu.id, month);
        const prevDebt = studentPreviousMonthsDebt(db, stu.id, month);
        return `<tr>
          <td>${studentName(stu)}</td>
          <td>${stu.phone || "-"}</td>
          <td class="ctr">${seances}</td>
          <td class="ctr"><span class="badge ${monthDebt > 0 ? "badge-danger" : "badge-success"}">${monthDebt > 0 ? "Dette" : "Payé"}</span></td>
          <td class="num">${monthDebt}</td>
          <td class="num">${prevDebt}</td>
        </tr>`;
      })
      .join("");

    const body = `
      ${letterheadHtml(db.school)}
      ${bannerHtml("Fiche de Présence", `${sessionTitle(session)} — ${name(classes, session.classId)} · ${name(groups, session.groupId)} — ${monthCodeLabel(month)}`)}
      <div class="frame">
        <h3>Séance du ${today.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · ${session.startTime}–${session.endTime} · Enseignant : ${teacherLabel(session.teacherId)} · Salle : ${name(salles, session.salleId)}</h3>
        <table>
          <thead>
            <tr><th>Élève</th><th>Téléphone</th><th class="ctr">Séances (${month})</th><th class="ctr">Statut</th><th class="num">Dette du mois</th><th class="num">Dette précédente</th></tr>
          </thead>
          <tbody>${rows || `<tr><td colspan="6" class="ctr">Aucun élève inscrit.</td></tr>`}</tbody>
        </table>
      </div>
      ${signaturesHtml("La Direction", "L'Enseignant")}
      ${metaFooterHtml(db.school.name, language)}
    `;
    printHtmlDocument(printDocument({ title: "Fiche de présence", lang: language, bodyHtml: body }));
    notify("Fiche de présence envoyée à l'impression", "success");
  }
}

/** The presence fiche of ONE group: the roster with per-student month séances,
 *  paid status, this-month debt (payable inline) and previous-months debt. */
function PresenceFiche({
  session,
  month,
  onClose,
  onPrint,
}: {
  session: ScheduleSession;
  month: string;
  onClose: () => void;
  onPrint: () => void;
}) {
  const db = useData();
  const { classes, groups, salles, teachers, modules } = db;
  const { payMonthDebt } = db;
  const { addToast } = useToast();
  const notify = (message: string, type: "success" | "error" = "success") =>
    addToast({
      type: type === "error" ? "danger" : "success",
      title: type === "error" ? "Erreur" : "Succès",
      message,
    });

  const [amounts, setAmounts] = useState<Record<string, number>>({});
  const [descs, setDescs] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const roster = sessionEnrolledStudents(db, session.id);
  const name = <T extends { id: string; name: string }>(list: T[], id: string) =>
    list.find((x) => x.id === id)?.name ?? "-";
  const teacherLabel = (id: string) => {
    const t = teachers.find((x) => x.id === id);
    return t ? `${t.firstName} ${t.lastName}` : "-";
  };
  const title = session.title || modules.find((m) => m.id === session.moduleId)?.name || "Séance";

  const pay = async (studentId: string, code: string) => {
    const amount = Math.max(0, Math.round(amounts[`${studentId}|${code}`] || 0));
    if (amount <= 0) {
      notify("Saisissez un montant à encaisser.", "error");
      return;
    }
    setBusy(true);
    const res = await payMonthDebt(studentId, code, amount, descs[`${studentId}|${code}`]);
    setBusy(false);
    if (res.ok) {
      notify(`${formatDA(res.settled ?? amount)} encaissés (${code}).`, "success");
      setAmounts((a) => ({ ...a, [`${studentId}|${code}`]: 0 }));
      setDescs((d) => ({ ...d, [`${studentId}|${code}`]: "" }));
    } else {
      notify("Aucune dette à encaisser pour ce mois.", "error");
    }
  };

  return (
    <Modal open onClose={onClose} title="" wide>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl bg-primary-50/50 p-4">
          <div>
            <h3 className="text-lg font-black text-ink">{title}</h3>
            <p className="text-xs text-muted">
              {name(classes, session.classId)} · Groupe {name(groups, session.groupId)} · {session.startTime}–{session.endTime}
            </p>
            <p className="text-[11px] text-muted">
              Enseignant : {teacherLabel(session.teacherId)} · Salle : {name(salles, session.salleId)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone="primary">{monthCodeLabel(month)}</Badge>
            <Button size="sm" variant="outline" onClick={onPrint} className="flex items-center gap-1.5">
              <Printer className="h-3.5 w-3.5" /> Imprimer la fiche
            </Button>
            <button onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-danger/10 hover:text-danger">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Roster */}
        <div className="flex items-center gap-2 text-xs font-semibold text-muted">
          <Users className="h-4 w-4" /> {roster.length} élève(s) inscrit(s) dans ce groupe
        </div>

        <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
          {roster.length === 0 ? (
            <p className="py-8 text-center text-xs italic text-muted">Aucun élève inscrit dans ce groupe.</p>
          ) : (
            roster.map((stu) => {
              const sub = db.subscriptions.find((s) => s.sessionId === session.id);
              const enr = db.enrollments.find((e) => e.studentId === stu.id && e.subscriptionId === sub?.id);
              const unitPrice = enr ? enrollmentUnitPrice(db, enr) : sub?.pricePerSession ?? 0;
              const seances = presentSeancesInMonth(db, stu.id, session.id, month);
              const monthCost = seances * unitPrice;
              const monthDebt = studentMonthDebt(db, stu.id, month);
              const prevDebt = studentPreviousMonthsDebt(db, stu.id, month);
              const byMonth = studentDebtByMonth(db, stu.id);
              const prevMonths = SCHOOL_MONTHS.filter(
                (m) =>
                  (byMonth[m.code] ?? 0) > 0 &&
                  (schoolMonthByCode(m.code)?.month ?? -1) !== (schoolMonthByCode(month)?.month ?? -2) &&
                  SCHOOL_MONTHS.findIndex((x) => x.code === m.code) < SCHOOL_MONTHS.findIndex((x) => x.code === month),
              );
              const isOpen = expanded === stu.id;
              const k = `${stu.id}|${month}`;
              const amt = amounts[k] || 0;
              const rest = Math.max(0, monthDebt - amt);

              return (
                <div key={stu.id} className="rounded-2xl border border-line bg-surface">
                  <div className="flex flex-wrap items-center justify-between gap-2 p-3">
                    <div className="min-w-0">
                      <strong className="block text-sm text-ink">{studentName(stu)}</strong>
                      <span className="flex items-center gap-1 text-[11px] text-muted">
                        <Phone className="h-3 w-3" /> {stu.phone || "—"}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      <Badge tone="primary" className="font-mono">{seances} séance(s) {month}</Badge>
                      <Badge tone={monthDebt > 0 ? "danger" : "success"}>
                        {monthDebt > 0 ? `Dette ${formatDA(monthDebt)}` : "Payé"}
                      </Badge>
                      <button
                        onClick={() => setExpanded(isOpen ? null : stu.id)}
                        className={`flex items-center gap-1 rounded-lg border px-2 py-1 font-bold transition-colors ${
                          prevDebt > 0 ? "border-warning/50 bg-warning/10 text-warning" : "border-line text-muted"
                        }`}
                      >
                        Arriérés : {formatDA(prevDebt)}
                        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                      </button>
                    </div>
                  </div>

                  {isOpen && (
                    <div className="space-y-3 border-t border-line bg-canvas/30 p-3">
                      {/* This month settlement */}
                      <div className="rounded-xl border border-line bg-surface p-3">
                        <div className="mb-2 flex items-center justify-between text-xs">
                          <span className="font-bold text-ink">Mois courant · {monthCodeLabel(month)}</span>
                          <span className="text-muted">
                            {seances} séance(s) × {formatDA(unitPrice)} = <strong className="text-ink">{formatDA(monthCost)}</strong>
                          </span>
                        </div>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
                          <div>
                            <label className="mb-1 block text-[10px] font-semibold text-muted">Dette du mois</label>
                            <div className="rounded-lg border border-line bg-canvas px-2 py-1.5 text-sm font-black text-danger">
                              {formatDA(monthDebt)}
                            </div>
                          </div>
                          <div>
                            <label className="mb-1 block text-[10px] font-semibold text-muted">Montant payé</label>
                            <Input
                              type="number"
                              min={0}
                              value={amt || ""}
                              onChange={(e) => setAmounts((a) => ({ ...a, [k]: Number(e.target.value) || 0 }))}
                              placeholder="0"
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-[10px] font-semibold text-muted">Reste</label>
                            <div className="rounded-lg border border-line bg-canvas px-2 py-1.5 text-sm font-black text-warning">
                              {formatDA(rest)}
                            </div>
                          </div>
                          <div className="flex items-end">
                            <Button
                              size="sm"
                              onClick={() => pay(stu.id, month)}
                              disabled={busy || monthDebt <= 0}
                              className="w-full"
                            >
                              Encaisser
                            </Button>
                          </div>
                        </div>
                        <Input
                          value={descs[k] || ""}
                          onChange={(e) => setDescs((d) => ({ ...d, [k]: e.target.value }))}
                          placeholder="Description (optionnel)"
                          className="mt-2"
                        />
                        <div className="mt-1 flex gap-2">
                          <button
                            onClick={() => setAmounts((a) => ({ ...a, [k]: monthDebt }))}
                            className="text-[10px] font-bold text-primary hover:underline"
                          >
                            Payer toute la dette du mois ({formatDA(monthDebt)})
                          </button>
                        </div>
                      </div>

                      {/* Previous months in debt */}
                      {prevMonths.length > 0 && (
                        <div className="rounded-xl border border-warning/40 bg-warning/5 p-3">
                          <span className="mb-2 block text-[10px] font-bold uppercase tracking-wider text-warning">
                            ⚠️ Mois précédents avec dette
                          </span>
                          <div className="space-y-2">
                            {prevMonths.map((m) => {
                              const pk = `${stu.id}|${m.code}`;
                              const pamt = amounts[pk] || 0;
                              const pdebt = byMonth[m.code] ?? 0;
                              return (
                                <div key={m.code} className="flex flex-wrap items-center gap-2 text-xs">
                                  <Badge tone="warning" className="font-mono">{m.code} · {m.label}</Badge>
                                  <span className="font-bold text-danger">{formatDA(pdebt)}</span>
                                  <Input
                                    type="number"
                                    min={0}
                                    value={pamt || ""}
                                    onChange={(e) => setAmounts((a) => ({ ...a, [pk]: Number(e.target.value) || 0 }))}
                                    placeholder="Montant"
                                    className="w-28"
                                  />
                                  <Button size="sm" variant="outline" onClick={() => pay(stu.id, m.code)} disabled={busy}>
                                    Payer
                                  </Button>
                                  <button
                                    onClick={() => setAmounts((a) => ({ ...a, [pk]: pdebt }))}
                                    className="text-[10px] font-bold text-primary hover:underline"
                                  >
                                    Tout
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </Modal>
  );
}
