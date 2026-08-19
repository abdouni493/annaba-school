"use client";

/**
 * Tableau de bord — the desk's morning screen.
 *
 * Two things and two things only: create a new student without leaving the
 * page, and work through the emplois du temps of a DAY. The day is navigable —
 * hier, demain, ou n'importe quelle date — so a séance oubliée se pointe encore,
 * et le lendemain se prépare la veille.
 *
 * Each créneau opens the shared présence sheet (the very same one the Présences
 * screen runs on), where the roster is pointed, the soldes are cashed in and the
 * feuille de présence is printed — always on the day shown above it.
 */

import { useMemo, useState } from "react";
import { useData } from "@/lib/store/data";
import { useSession } from "@/lib/store/session";
import { Card, CardBody } from "@/components/ui/Card";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { TeacherPages } from "@/components/pages/TeacherPages";
import { PresenceSheet } from "@/components/attendance/PresenceSheet";
import { CreateStudentModal } from "@/components/students/CreateStudentModal";
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
  teacherName,
} from "@/lib/helpers";
import {
  Calendar,
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  Clock,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import type { Day, ScheduleSession } from "@/lib/types";

const JS_DAYS: Day[] = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export default function DashboardPage() {
  const { user } = useSession();
  if (user?.role === "teacher") return <TeacherPages slug="dashboard" />;
  return <AdminDashboard />;
}

function AdminDashboard() {
  const db = useData();
  const { sessions, attendance, students, subscriptions } = db;

  const isoOf = (d: Date) => d.toLocaleDateString("fr-CA");
  const todayIso = isoOf(new Date());

  /** The day the whole screen works on — today until the desk moves it. */
  const [date, setDate] = useState<string>(todayIso);
  const [openSessionId, setOpenSessionId] = useState<string | null>(null);
  const [month, setMonth] = useState<string>("M1");
  const [createOpen, setCreateOpen] = useState(false);
  /** the emploi the create screen arrives pre-ticked on */
  const [createSubIds, setCreateSubIds] = useState<string[]>([]);

  const dow = JS_DAYS[new Date(`${date}T12:00:00`).getDay()];
  const isToday = date === todayIso;
  const isPast = date < todayIso;

  const shiftDay = (days: number) => {
    const d = new Date(`${date}T12:00:00`);
    d.setDate(d.getDate() + days);
    setDate(isoOf(d));
  };

  const sessionTitle = (s: ScheduleSession) =>
    s.title || moduleNameOf(db, s.moduleId) || "Emploi du temps";

  /** The emplois du temps of the SELECTED day, ordered by the hour they run on
   *  that day (an emploi may start at 08:00 samedi and 14:00 mardi). */
  const dayTimings = useMemo(
    () =>
      sessions
        .filter(
          (s) =>
            s.days.includes(dow) &&
            (!s.periodStart || s.periodStart <= date) &&
            (!s.periodEnd || s.periodEnd >= date),
        )
        .sort(
          (a, b) =>
            minutesOf(sessionTimesOn(a, dow).startTime) -
            minutesOf(sessionTimesOn(b, dow).startTime),
        ),
    [sessions, dow, date],
  );

  /** How far the pointage of that day has gone, créneau by créneau. */
  const progressOf = (s: ScheduleSession) => {
    const sub = subscriptions.find((x) => x.sessionId === s.id);
    const roster = sub ? students.filter((st) => st.subscriptionIds.includes(sub.id)).length : 0;
    const marked = attendance.filter(
      (a) => a.sessionId === s.id && dayKeyOf(a.timestamp) === date,
    ).length;
    return { roster, marked, priced: !!sub };
  };

  const dayMarks = attendance.filter(
    (a) => dayKeyOf(a.timestamp) === date && dayTimings.some((s) => s.id === a.sessionId),
  ).length;

  const openSession = sessions.find((s) => s.id === openSessionId) ?? null;

  const openSheet = (s: ScheduleSession) => {
    setMonth(sessionCurrentMonthCode(db, s.id));
    setOpenSessionId(s.id);
  };

  const openCreateFor = (subIds: string[]) => {
    setCreateSubIds(subIds);
    setCreateOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <PageHeader
          emoji="🏠"
          title="Tableau de Bord"
          subtitle="Emplois du temps du jour et fiches de présence"
        />
        <Button onClick={() => openCreateFor([])} className="gap-2 self-start sm:self-auto">
          <UserPlus className="h-4 w-4" /> Nouvel élève
        </Button>
      </div>

      {/* ---- the day being worked on ------------------------------------- */}
      <Card className="border border-line card-shadow">
        <CardBody className="space-y-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => shiftDay(-1)}
                title="Jour précédent"
                className="rounded-lg border border-line p-1.5 text-muted transition-colors hover:bg-primary-50 hover:text-ink"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <div className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-1.5">
                <Calendar className="h-4 w-4 text-primary" />
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value || todayIso)}
                  className="bg-transparent text-sm font-bold text-ink outline-none"
                />
              </div>
              <button
                onClick={() => shiftDay(1)}
                title="Jour suivant"
                className="rounded-lg border border-line p-1.5 text-muted transition-colors hover:bg-primary-50 hover:text-ink"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <Button size="sm" variant="outline" onClick={() => setDate(todayIso)} disabled={isToday}>
                Aujourd&apos;hui
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={isToday ? "primary" : isPast ? "neutral" : "warning"} className="gap-1">
                <CalendarCheck className="h-3 w-3" />
                {DAY_LABELS_FR[dow]} {formatDateFr(date)}
                {isToday ? " · aujourd'hui" : isPast ? " · jour passé" : " · à venir"}
              </Badge>
              <Badge tone="neutral">{dayTimings.length} créneau(x)</Badge>
              <Badge tone="success">{dayMarks} pointage(s)</Badge>
            </div>
          </div>

          <h3 className="flex flex-wrap items-center gap-2 border-b border-line pb-3 font-bold text-ink">
            <Clock className="h-4.5 w-4.5 text-primary" /> Emplois du temps —{" "}
            {new Date(`${date}T12:00:00`).toLocaleDateString("fr-FR", {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </h3>

          {dayTimings.length === 0 ? (
            <p className="py-10 text-center text-xs italic text-muted">
              Aucun emploi du temps programmé ce jour-là. Utilisez les flèches pour changer de
              journée.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wide text-muted">
                    <th className="py-2">Heure</th>
                    <th className="py-2">Emploi du temps</th>
                    <th className="py-2">Groupe / Salle</th>
                    <th className="py-2">Enseignant</th>
                    <th className="py-2 text-center">Pointage</th>
                    <th className="py-2 text-right">Ouvrir</th>
                  </tr>
                </thead>
                <tbody>
                  {dayTimings.map((s) => {
                    const { startTime, endTime } = sessionTimesOn(s, dow);
                    const { roster, marked, priced } = progressOf(s);
                    const done = roster > 0 && marked >= roster;
                    return (
                      <tr
                        key={s.id}
                        onClick={() => openSheet(s)}
                        className="cursor-pointer border-t border-line/60 transition-colors hover:bg-primary-50/50"
                      >
                        <td className="py-3">
                          <Badge tone="primary" className="whitespace-nowrap font-mono">
                            {startTime} → {endTime}
                          </Badge>
                        </td>
                        <td className="py-3 font-bold text-ink">
                          {sessionTitle(s)}
                          {s.isOpen && (
                            <Badge tone="success" className="ml-1.5 text-[9px]">
                              Séance libre
                            </Badge>
                          )}
                          {!priced && (
                            <Badge tone="warning" className="ml-1.5 text-[9px]">
                              Sans tarif
                            </Badge>
                          )}
                        </td>
                        <td className="py-3 text-muted">
                          {groupName(db, s.groupId)}
                          <span className="block text-[10px]">{salleName(db, s.salleId)}</span>
                        </td>
                        <td className="py-3 text-[11px] text-muted">{teacherName(db, s.teacherId)}</td>
                        <td className="py-3 text-center">
                          <Badge
                            tone={done ? "success" : marked > 0 ? "warning" : "neutral"}
                            className="gap-1 font-mono text-[10px]"
                          >
                            <Users className="h-3 w-3" />
                            {marked}/{roster}
                          </Badge>
                        </td>
                        <td className="py-3 text-right">
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

      {/* The group's présence sheet, on the day shown above */}
      {openSession && (
        <Modal open onClose={() => setOpenSessionId(null)} title="" full>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Badge tone="primary" className="gap-1">
                <Calendar className="h-3 w-3" />
                {DAY_LABELS_FR[dow]} {formatDateFr(date)}
              </Badge>
              <button
                onClick={() => setOpenSessionId(null)}
                className="rounded-lg p-1.5 text-muted hover:bg-danger/10 hover:text-danger"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <PresenceSheet
              session={openSession}
              date={date}
              monthCode={month}
              onMonthChange={setMonth}
              onCreateStudent={() => {
                const sub = db.subscriptions.find((x) => x.sessionId === openSession.id);
                openCreateFor(sub ? [sub.id] : []);
              }}
            />
          </div>
        </Modal>
      )}

      <CreateStudentModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        defaultSubIds={createSubIds}
      />
    </div>
  );
}
