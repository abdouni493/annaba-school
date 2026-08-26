"use client";

/**
 * MON EMPLOI DU TEMPS — la semaine telle qu'elle se vit, pas telle qu'elle se stocke.
 *
 * Sept colonnes, une par jour, du samedi au vendredi comme l'école les compte.
 * Chaque créneau porte LA COULEUR DE SON EMPLOI DU TEMPS, tirée de son
 * identifiant : le même groupe garde la même couleur du mardi au jeudi, et la
 * semaine se lit d'un coup d'œil au lieu de se déchiffrer ligne à ligne.
 *
 * Un créneau ne dit pas seulement « quand » : il dit AVEC QUI (le groupe, la
 * classe, l'effectif), OÙ (la salle du jour — un emploi peut changer de salle
 * selon le jour), et OÙ EN EST LE GROUPE (son mois, sa séance dans le mois).
 * Un clic ouvre la liste de ses élèves, en lecture seule.
 */

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useData } from "@/lib/store/data";
import { Badge } from "@/components/ui/Badge";
import { PageHeader } from "@/components/layout/PageHeader";
import { Select } from "@/components/ui/SearchInput";
import { TeacherGroupRoster } from "@/components/teachers/TeacherGroupRoster";
import { formatDA, money } from "@/lib/utils";
import {
  DAY_LABELS_FR,
  minutesOf,
  monthCodeLabel,
  sessionSalleOn,
  sessionTimesOn,
} from "@/lib/helpers";
import { payEmplois } from "@/lib/teacherPayBoard";
import type { TeacherEmploi } from "@/lib/teacherMonths";
import type { Day, ScheduleSession, Teacher } from "@/lib/types";
import {
  AlertTriangle,
  CalendarRange,
  Clock,
  Hourglass,
  Layers,
  MapPin,
  Users,
} from "lucide-react";

const JS_DAYS: Day[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

/** L'ordre où la semaine se lit à l'école : samedi ouvre, vendredi ferme. */
const WEEK_ORDER: Day[] = [
  "saturday",
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
];

const PALETTE = [
  "#7c3aed",
  "#0ea5e9",
  "#16a34a",
  "#ea580c",
  "#db2777",
  "#0891b2",
  "#ca8a04",
  "#4f46e5",
  "#059669",
  "#e11d48",
  "#2563eb",
  "#9333ea",
];

function colorOf(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

interface Slot {
  session: ScheduleSession;
  emploi?: TeacherEmploi;
  startTime: string;
  endTime: string;
  salle: string;
  minutes: number;
}

export function TeacherScheduleBoard({ teacher }: { teacher: Teacher }) {
  const db = useData();
  const [filter, setFilter] = useState("");
  const [openEmploi, setOpenEmploi] = useState<TeacherEmploi | null>(null);

  const todayDow = JS_DAYS[new Date().getDay()];

  const emplois = useMemo(
    () => payEmplois(db, teacher.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      teacher.id,
      db.sessions,
      db.attendance,
      db.unpaidTeacher,
      db.payments,
      db.enrollments,
      db.students,
      db.subscriptions,
      db.independent,
      db.teacherPayments,
    ],
  );

  const emploiOf = useMemo(() => new Map(emplois.map((e) => [e.sessionId, e])), [emplois]);

  const mySessions = useMemo(
    () => db.sessions.filter((s) => s.teacherId === teacher.id && !s.archivedAt),
    [db.sessions, teacher.id],
  );

  const shown = filter ? mySessions.filter((s) => s.id === filter) : mySessions;

  /** La semaine, jour par jour — chaque créneau lu AVEC L'HEURE DE CE JOUR-LÀ. */
  const week = useMemo(() => {
    const out = new Map<Day, Slot[]>();
    for (const day of WEEK_ORDER) {
      const rows: Slot[] = shown
        .filter((s) => s.days.includes(day))
        .map((s) => {
          const t = sessionTimesOn(s, day);
          return {
            session: s,
            emploi: emploiOf.get(s.id),
            startTime: t.startTime,
            endTime: t.endTime,
            salle: sessionSalleOn(s, day),
            minutes: Math.max(0, minutesOf(t.endTime) - minutesOf(t.startTime)),
          };
        })
        .sort((a, b) => minutesOf(a.startTime) - minutesOf(b.startTime));
      out.set(day, rows);
    }
    return out;
  }, [shown, emploiOf]);

  const allSlots = WEEK_ORDER.flatMap((d) => week.get(d) ?? []);
  const weekMinutes = allSlots.reduce((s, r) => s + r.minutes, 0);
  const weekStudents = shown.reduce((s, x) => s + (emploiOf.get(x.id)?.rosterCount ?? 0), 0);
  /** Ce qu'une semaine complète peut rapporter : une séance par créneau tenu. */
  const weekPotential = money(
    allSlots.reduce(
      (s, r) => s + (r.emploi ? r.emploi.perSeance * (r.emploi.rosterCount || 0) : 0),
      0,
    ),
  );

  return (
    <div className="space-y-5 text-xs">
      <PageHeader
        emoji="🗓️"
        title="Mon emploi du temps"
        subtitle="Votre semaine, groupe par groupe — cliquez un créneau pour voir sa liste d'élèves"
        actions={
          mySessions.length > 1 ? (
            <Select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="h-9 w-56 text-xs"
            >
              <option value="">Tous mes cours</option>
              {mySessions.map((s) => {
                const e = emploiOf.get(s.id);
                return (
                  <option key={s.id} value={s.id}>
                    {e ? `${e.title} (${e.groupName})` : (s.title ?? "Emploi du temps")}
                  </option>
                );
              })}
            </Select>
          ) : undefined
        }
      />

      {/* ---- la semaine en chiffres -------------------------------------- */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <WeekStat
          icon={<Layers className="h-3.5 w-3.5" />}
          label="Groupes"
          value={String(shown.length)}
          tone="text-primary"
        />
        <WeekStat
          icon={<CalendarRange className="h-3.5 w-3.5" />}
          label="Séances / semaine"
          value={String(allSlots.length)}
          tone="text-ink"
        />
        <WeekStat
          icon={<Hourglass className="h-3.5 w-3.5" />}
          label="Heures / semaine"
          value={`${Math.floor(weekMinutes / 60)} h ${String(weekMinutes % 60).padStart(2, "0")}`}
          tone="text-ink"
        />
        <WeekStat
          icon={<Users className="h-3.5 w-3.5" />}
          label="Élèves suivis"
          value={String(weekStudents)}
          tone="text-primary"
        />
        <WeekStat
          icon={<Clock className="h-3.5 w-3.5" />}
          label="Potentiel / semaine"
          value={formatDA(weekPotential)}
          tone="text-success"
        />
      </div>

      {/* ---- la grille de la semaine -------------------------------------- */}
      <div className="overflow-x-auto pb-2">
        <div className="grid min-w-[1080px] grid-cols-7 gap-2.5">
          {WEEK_ORDER.map((day) => {
            const rows = week.get(day) ?? [];
            const isToday = day === todayDow;
            return (
              <div
                key={day}
                className={`flex min-h-[26rem] flex-col overflow-hidden rounded-2xl border transition-colors ${
                  isToday
                    ? "border-primary/50 bg-primary-50/40 shadow-sm"
                    : "border-line bg-canvas/30"
                }`}
              >
                <div
                  className={`flex items-center justify-between px-3 py-2.5 ${
                    isToday
                      ? "bg-gradient-primary text-white"
                      : "border-b border-line bg-surface text-ink"
                  }`}
                >
                  <span className="text-[10px] font-extrabold uppercase tracking-wide">
                    {DAY_LABELS_FR[day]}
                  </span>
                  <span
                    className={`rounded-full px-1.5 py-0.5 font-mono text-[9px] font-black ${
                      isToday ? "bg-white/25" : rows.length > 0 ? "bg-primary/15 text-primary" : "bg-muted/15 text-muted"
                    }`}
                  >
                    {rows.length}
                  </span>
                </div>

                <div className="flex-1 space-y-2 p-2">
                  {rows.length === 0 ? (
                    <p className="mt-16 text-center text-[10px] font-semibold italic text-muted">
                      Aucun cours
                    </p>
                  ) : (
                    rows.map((r, i) => {
                      const e = r.emploi;
                      const color = colorOf(r.session.id);
                      return (
                        <motion.button
                          key={`${r.session.id}-${day}`}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: Math.min(i * 0.04, 0.3) }}
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          onClick={() => e && setOpenEmploi(e)}
                          disabled={!e}
                          className="w-full overflow-hidden rounded-xl border border-line bg-surface text-start shadow-sm transition-all hover:shadow-md disabled:opacity-60"
                          style={{ borderInlineStartWidth: 4, borderInlineStartColor: color }}
                          title={
                            e
                              ? `${e.title} · ${e.groupName} — voir la liste des élèves`
                              : "Créneau sans abonnement"
                          }
                        >
                          <div
                            className="flex items-center justify-between px-2 py-1 font-mono text-[9px] font-black text-white"
                            style={{ backgroundColor: color }}
                          >
                            <span>{r.startTime}</span>
                            <span className="opacity-80">{r.endTime}</span>
                          </div>

                          <div className="space-y-1 p-2">
                            <strong className="block truncate text-[11px] leading-tight text-ink">
                              {e?.title ?? r.session.title ?? "Emploi du temps"}
                            </strong>
                            <span className="block truncate text-[9px] font-bold text-muted">
                              {e?.groupName ?? "—"}
                            </span>
                            <div className="flex items-center gap-1 text-[9px] text-muted">
                              <MapPin className="h-2.5 w-2.5 shrink-0" />
                              <span className="truncate">{r.salle || "—"}</span>
                            </div>
                            <div className="flex flex-wrap items-center gap-1 border-t border-line/60 pt-1">
                              <Badge tone="neutral" className="px-1.5 py-0 text-[8px] font-bold">
                                <Users className="h-2.5 w-2.5" /> {e?.rosterCount ?? 0}
                              </Badge>
                              {e && (
                                <Badge tone="primary" className="px-1.5 py-0 font-mono text-[8px]">
                                  {e.currentCode} · {Math.min(Math.max(e.currentHeld, 0), e.size)}/
                                  {e.size}
                                </Badge>
                              )}
                              {e && e.studentsInDebt > 0 && (
                                <Badge tone="danger" className="px-1.5 py-0 text-[8px] font-bold">
                                  <AlertTriangle className="h-2.5 w-2.5" /> {e.studentsInDebt}
                                </Badge>
                              )}
                            </div>
                          </div>
                        </motion.button>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ---- la légende des couleurs -------------------------------------- */}
      {shown.length > 0 && (
        <div className="rounded-2xl border border-line bg-surface p-4">
          <strong className="mb-2.5 block text-[10px] font-bold uppercase tracking-wider text-muted">
            Mes groupes — une couleur, un emploi du temps
          </strong>
          <div className="flex flex-wrap gap-2">
            {shown.map((s) => {
              const e = emploiOf.get(s.id);
              const color = colorOf(s.id);
              return (
                <button
                  key={s.id}
                  onClick={() => e && setOpenEmploi(e)}
                  disabled={!e}
                  className="inline-flex items-center gap-2 rounded-xl border border-line bg-canvas/50 px-3 py-1.5 transition-colors hover:border-primary/50 hover:bg-primary-50/40 disabled:opacity-60"
                >
                  <span
                    className="h-3 w-3 shrink-0 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  <span className="text-[10px]">
                    <strong className="block text-ink">{e?.title ?? s.title}</strong>
                    <span className="block text-[9px] text-muted">
                      {e ? `${e.groupName} · ${e.daysLabel}` : ""}
                    </span>
                  </span>
                  {e && (
                    <span className="ms-1 shrink-0 font-mono text-[9px] text-muted">
                      {monthCodeLabel(e.currentCode)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {openEmploi && (
        <TeacherGroupRoster emploi={openEmploi} onClose={() => setOpenEmploi(null)} />
      )}
    </div>
  );
}

function WeekStat({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: string;
}) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-3 text-center">
      <span className="flex items-center justify-center gap-1 text-[9px] font-bold uppercase tracking-wider text-muted">
        {icon} {label}
      </span>
      <strong className={`mt-0.5 block font-mono text-base font-black ${tone}`}>{value}</strong>
    </div>
  );
}
