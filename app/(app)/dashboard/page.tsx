"use client";

/**
 * Tableau de bord — the desk's morning screen.
 *
 * Two things and two things only: create a new student without leaving the
 * page, and work through the emplois du temps of the day. Each one opens the
 * shared présence sheet (the very same one the Présences screen runs on), where
 * the roster is pointed, the soldes are cashed in and the feuille de présence
 * is printed.
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
import { moduleName as moduleNameOf, salleName, sessionCurrentMonthCode } from "@/lib/helpers";
import { Clock, ChevronRight, UserPlus, X } from "lucide-react";
import type { Day, ScheduleSession } from "@/lib/types";

const JS_DAYS: Day[] = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export default function DashboardPage() {
  const { user } = useSession();
  if (user?.role === "teacher") return <TeacherPages slug="dashboard" />;
  return <AdminDashboard />;
}

function AdminDashboard() {
  const db = useData();
  const { sessions } = db;

  const [openSessionId, setOpenSessionId] = useState<string | null>(null);
  const [month, setMonth] = useState<string>("M1");
  const [createOpen, setCreateOpen] = useState(false);
  /** the emploi the create screen arrives pre-ticked on */
  const [createSubIds, setCreateSubIds] = useState<string[]>([]);

  const today = new Date();
  const todayDow = JS_DAYS[today.getDay()];
  const todayIso = today.toLocaleDateString("fr-CA");

  const sessionTitle = (s: ScheduleSession) =>
    s.title || moduleNameOf(db, s.moduleId) || "Emploi du temps";

  /** Today's emplois du temps, ordered by start hour. */
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

      {/* Emplois du temps du jour */}
      <Card className="border border-line card-shadow">
        <CardBody className="space-y-4 p-5">
          <h3 className="flex flex-wrap items-center gap-2 border-b border-line pb-3 font-bold text-ink">
            <Clock className="h-4.5 w-4.5 text-primary" /> Emplois du temps du jour —{" "}
            {today.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}
            <Badge tone="primary" className="ml-auto">
              {todaysTimings.length} créneau(x)
            </Badge>
          </h3>

          {todaysTimings.length === 0 ? (
            <p className="py-10 text-center text-xs italic text-muted">
              Aucun emploi du temps programmé aujourd&apos;hui.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wide text-muted">
                    <th className="py-2">Heure</th>
                    <th className="py-2">Emploi du temps</th>
                    <th className="py-2">Salle</th>
                    <th className="py-2 text-right">Ouvrir</th>
                  </tr>
                </thead>
                <tbody>
                  {todaysTimings.map((s) => (
                    <tr
                      key={s.id}
                      onClick={() => openSheet(s)}
                      className="cursor-pointer border-t border-line/60 transition-colors hover:bg-primary-50/50"
                    >
                      <td className="py-3">
                        <Badge tone="primary" className="font-mono whitespace-nowrap">
                          {s.startTime} → {s.endTime}
                        </Badge>
                      </td>
                      <td className="py-3 font-bold text-ink">
                        {sessionTitle(s)}
                        {s.isOpen && (
                          <Badge tone="success" className="ml-1.5 text-[9px]">
                            Séance libre
                          </Badge>
                        )}
                      </td>
                      <td className="py-3 text-muted">{salleName(db, s.salleId)}</td>
                      <td className="py-3 text-right">
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-primary">
                          Ouvrir <ChevronRight className="h-3.5 w-3.5" />
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {/* The group's présence sheet */}
      {openSession && (
        <Modal open onClose={() => setOpenSessionId(null)} title="" full>
          <div className="space-y-3">
            <div className="flex justify-end">
              <button
                onClick={() => setOpenSessionId(null)}
                className="rounded-lg p-1.5 text-muted hover:bg-danger/10 hover:text-danger"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <PresenceSheet
              session={openSession}
              date={todayIso}
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
