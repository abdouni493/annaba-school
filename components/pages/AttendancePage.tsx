"use client";

/**
 * Présences — the roll-call screen.
 *
 * It runs on exactly the SAME sheet as the dashboard: pick a day, pick one of
 * the emplois du temps scheduled that day, and the shared `PresenceSheet` does
 * the rest — one column per séance of the month, the solde of each student,
 * the arriérés, the other emplois he owes on, and the pointage buttons that
 * write without ever asking for a confirmation.
 *
 * Months are the emploi's own (M1, M2 …), so the ⟨ ⟩ arrows walk back through
 * the months a group has already lived, whatever the calendar says.
 */

import { useEffect, useMemo, useState } from "react";
import { useData } from "@/lib/store/data";
import { useSettings } from "@/lib/store/settings";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/SearchInput";
import { PageHeader } from "@/components/layout/PageHeader";
import { PresenceSheet } from "@/components/attendance/PresenceSheet";
import { CreateStudentModal } from "@/components/students/CreateStudentModal";
import { formatDA } from "@/lib/utils";
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  Search,
  UserCheck,
} from "lucide-react";
import type { Day, ScheduleSession } from "@/lib/types";
import {
  DAY_LABELS_FR,
  dayKeyOf,
  formatDateFr,
  groupName,
  minutesOf,
  moduleName as moduleNameOf,
  salleName,
  sessionCurrentMonthCode,
  sessionTimesOn,
  studentName,
  teacherName,
} from "@/lib/helpers";

import { useCan } from "@/lib/usePermissions";
const JS_DAYS: Day[] = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

const STATUS_LABEL: Record<string, { label: string; tone: "success" | "warning" | "danger" | "primary" }> = {
  present: { label: "Présent", tone: "success" },
  late: { label: "Retard", tone: "warning" },
  absent: { label: "Absent", tone: "danger" },
  cancelled: { label: "Annulée", tone: "primary" },
};

export function AttendancePage() {
  const can = useCan("attendance");
  const db = useData();
  const { sessions, students, attendance } = db;
  useSettings();

  const [tab, setTab] = useState<"sheet" | "history">("sheet");
  const isoOf = (d: Date) => d.toLocaleDateString("fr-CA");
  const todayStr = isoOf(new Date());

  const [sheetDate, setSheetDate] = useState<string>(todayStr);
  const [activeSessionId, setActiveSessionId] = useState<string>("");
  const [month, setMonth] = useState<string>("M1");
  const [createOpen, setCreateOpen] = useState(false);
  const [createSubIds, setCreateSubIds] = useState<string[]>([]);

  // history filters
  const [histFrom, setHistFrom] = useState(isoOf(new Date(Date.now() - 30 * 86400000)));
  const [histTo, setHistTo] = useState(todayStr);
  const [histSearch, setHistSearch] = useState("");
  const [histStatus, setHistStatus] = useState<"all" | "present" | "late" | "absent" | "cancelled">("all");

  const sheetDow = JS_DAYS[new Date(`${sheetDate}T12:00:00`).getDay()];

  /** Emplois du temps that actually exist on the selected day. Un emploi
   *  SUPPRIMÉ n'y figure plus : on ne pointe pas un groupe qui n'existe plus —
   *  mais ses présences passées, elles, restent dans l'historique ci-dessous. */
  const daySessions = useMemo(
    () =>
      sessions
        .filter((s) => !s.archivedAt)
        .filter((s) => s.days.includes(sheetDow))
        .filter((s) => !s.periodStart || s.periodStart <= sheetDate)
        .filter((s) => !s.periodEnd || s.periodEnd >= sheetDate)
        // Sorted by the hour they run ON THAT DAY — an emploi may start at a
        // different hour depending on the weekday.
        .sort(
          (a, b) =>
            minutesOf(sessionTimesOn(a, sheetDow).startTime) -
            minutesOf(sessionTimesOn(b, sheetDow).startTime),
        ),
    [sessions, sheetDow, sheetDate],
  );

  // Never leave the sheet on a créneau that does not exist that day.
  useEffect(() => {
    if (daySessions.length === 0) {
      if (activeSessionId) setActiveSessionId("");
      return;
    }
    if (!daySessions.some((s) => s.id === activeSessionId)) {
      setActiveSessionId(daySessions[0].id);
    }
  }, [daySessions, activeSessionId]);

  const activeSession = daySessions.find((s) => s.id === activeSessionId);

  // The sheet opens on the month the group is collectively living.
  useEffect(() => {
    if (activeSession) setMonth(sessionCurrentMonthCode(db, activeSession.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId]);

  const shiftDay = (days: number) => {
    const d = new Date(`${sheetDate}T12:00:00`);
    d.setDate(d.getDate() + days);
    setSheetDate(isoOf(d));
  };

  const sessionTitle = (s: ScheduleSession) => s.title || moduleNameOf(db, s.moduleId) || "Créneau";

  const dayMarks = attendance.filter(
    (a) => dayKeyOf(a.timestamp) === sheetDate && daySessions.some((s) => s.id === a.sessionId),
  );

  // ---- history --------------------------------------------------------------
  const history = useMemo(
    () =>
      attendance
        .filter((a) => {
          const day = dayKeyOf(a.timestamp);
          if (day < histFrom || day > histTo) return false;
          if (histStatus !== "all" && a.status !== histStatus) return false;
          if (!histSearch.trim()) return true;
          const stu = students.find((s) => s.id === a.studentId);
          return stu ? studentName(stu).toLowerCase().includes(histSearch.toLowerCase()) : false;
        })
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
        .slice(0, 400),
    [attendance, histFrom, histTo, histStatus, histSearch, students],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        emoji="✅"
        title="Présences"
        subtitle="Pointage des emplois du temps, mois par mois"
      />

      <div className="flex gap-2">
        {(
          [
            { key: "sheet", label: "Feuille de présence", icon: UserCheck },
            { key: "history", label: "Historique", icon: Clock },
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

      {tab === "sheet" ? (
        <>
          {/* Day navigation */}
          <Card className="border border-line card-shadow">
            <CardBody className="space-y-4 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => shiftDay(-1)}
                    className="rounded-lg border border-line p-1.5 text-muted hover:bg-primary-50 hover:text-ink"
                    title="Jour précédent"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <div className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-1.5">
                    <Calendar className="h-4 w-4 text-primary" />
                    <input
                      type="date"
                      value={sheetDate}
                      onChange={(e) => setSheetDate(e.target.value || todayStr)}
                      className="bg-transparent text-sm font-bold text-ink outline-none"
                    />
                  </div>
                  <button
                    onClick={() => shiftDay(1)}
                    className="rounded-lg border border-line p-1.5 text-muted hover:bg-primary-50 hover:text-ink"
                    title="Jour suivant"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                  <Button size="sm" variant="outline" onClick={() => setSheetDate(todayStr)}>
                    Aujourd&apos;hui
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  <Badge tone="primary">
                    {DAY_LABELS_FR[sheetDow]} {formatDateFr(sheetDate)}
                  </Badge>
                  <Badge tone="neutral">{daySessions.length} créneau(x)</Badge>
                  <Badge tone="success">{dayMarks.length} pointage(s)</Badge>
                </div>
              </div>

              {/* Créneaux of that day */}
              {daySessions.length === 0 ? (
                <p className="py-6 text-center text-xs italic text-muted">
                  Aucun emploi du temps programmé ce jour-là.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {daySessions.map((s) => {
                    const active = s.id === activeSessionId;
                    return (
                      <button
                        key={s.id}
                        onClick={() => setActiveSessionId(s.id)}
                        className={`rounded-xl border px-3 py-2 text-start text-[11px] transition-colors ${
                          active
                            ? "border-primary bg-primary text-white"
                            : "border-line bg-surface text-ink hover:bg-primary-50"
                        }`}
                      >
                        <strong className="block">{sessionTitle(s)}</strong>
                        <span className={active ? "text-white/80" : "text-muted"}>
                          {sessionTimesOn(s, sheetDow).startTime}–{sessionTimesOn(s, sheetDow).endTime} ·{" "}
                          {groupName(db, s.groupId)} ·{" "}
                          {salleName(db, s.salleId)}
                        </span>
                        <span className={`block text-[9px] ${active ? "text-white/70" : "text-muted"}`}>
                          {teacherName(db, s.teacherId)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </CardBody>
          </Card>

          {/* The sheet itself */}
          {activeSession && (
            <Card className="border border-line card-shadow">
              <CardBody className="p-4">
                <PresenceSheet
                  session={activeSession}
                  date={sheetDate}
                  monthCode={month}
                  onMonthChange={setMonth}
                  canMark={can("mark")}
                  canCollect={can("collect_payment")}
                  onCreateStudent={() => {
                    const sub = db.subscriptions.find((x) => x.sessionId === activeSession.id);
                    setCreateSubIds(sub ? [sub.id] : []);
                    setCreateOpen(true);
                  }}
                />
              </CardBody>
            </Card>
          )}
        </>
      ) : (
        /* ---- history ---------------------------------------------------- */
        <Card className="border border-line card-shadow">
          <CardBody className="space-y-4 p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted">
                  Du
                </label>
                <Input type="date" value={histFrom} onChange={(e) => setHistFrom(e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted">
                  Au
                </label>
                <Input type="date" value={histTo} onChange={(e) => setHistTo(e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted">
                  Statut
                </label>
                <select
                  value={histStatus}
                  onChange={(e) => setHistStatus(e.target.value as typeof histStatus)}
                  className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-primary"
                >
                  <option value="all">Tous</option>
                  <option value="present">Présent</option>
                  <option value="late">Retard</option>
                  <option value="absent">Absent</option>
                  <option value="cancelled">Annulée</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted">
                  Élève
                </label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                  <Input
                    value={histSearch}
                    onChange={(e) => setHistSearch(e.target.value)}
                    placeholder="Nom…"
                    className="pl-9"
                  />
                </div>
              </div>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-line">
              <table className="w-full min-w-[640px] text-xs">
                <thead className="bg-canvas/60">
                  <tr className="text-left text-[10px] uppercase tracking-wide text-muted">
                    <th className="px-3 py-2.5">Date</th>
                    <th className="px-3 py-2.5">Élève</th>
                    <th className="px-3 py-2.5">Emploi du temps</th>
                    <th className="px-3 py-2.5">Statut</th>
                    <th className="px-3 py-2.5 text-right">Décompté</th>
                  </tr>
                </thead>
                <tbody>
                  {history.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-10 text-center text-xs italic text-muted">
                        Aucun pointage sur cette période.
                      </td>
                    </tr>
                  ) : (
                    history.map((a) => {
                      const stu = students.find((s) => s.id === a.studentId);
                      const ses = sessions.find((s) => s.id === a.sessionId);
                      const st = STATUS_LABEL[a.status] ?? STATUS_LABEL.present;
                      return (
                        <tr key={a.id} className="border-t border-line/60 hover:bg-primary-50/30">
                          <td className="px-3 py-2 font-mono text-muted">
                            {formatDateFr(dayKeyOf(a.timestamp))}
                          </td>
                          <td className="px-3 py-2 font-semibold text-ink">
                            {stu ? studentName(stu) : "—"}
                          </td>
                          <td className="px-3 py-2 text-muted">
                            {ses ? sessionTitle(ses) : "—"}
                            {ses && ` · ${groupName(db, ses.groupId)}`}
                          </td>
                          <td className="px-3 py-2">
                            <Badge tone={st.tone}>{st.label}</Badge>
                            {a.noCharge && (
                              <Badge tone="neutral" className="ml-1 text-[9px]">
                                non facturée
                              </Badge>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">
                            {a.amountDeducted > 0 ? formatDA(a.amountDeducted) : "—"}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      )}

      <CreateStudentModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        defaultSubIds={createSubIds}
        joinDate={sheetDate}
      />
    </div>
  );
}
