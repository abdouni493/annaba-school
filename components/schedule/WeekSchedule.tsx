"use client";

import { useData } from "@/lib/store/data";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { moduleName, teacherName, groupName, salleName, minutesOf, sessionTimesOn } from "@/lib/helpers";
import { DAYS, type Day, type ScheduleSession } from "@/lib/types";
import { todayDayKey } from "@/lib/utils";
import { cn } from "@/lib/utils";

export function WeekSchedule({ sessions }: { sessions: ScheduleSession[] }) {
  const db = useData();
  const { t } = useTranslation();
  const today = todayDayKey();

  // Each column is sorted by the hour the emploi runs ON THAT DAY — a timing
  // that starts at 08:00 on Samedi and 14:00 on Mardi sits in the right place
  // in both columns.
  const byDay = (day: Day) =>
    sessions
      .filter((s) => s.days.includes(day))
      .sort(
        (a, b) =>
          minutesOf(sessionTimesOn(a, day).startTime) - minutesOf(sessionTimesOn(b, day).startTime),
      );

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
      {DAYS.map((day) => {
        const items = byDay(day);
        const isToday = day === today;
        return (
          <div
            key={day}
            className={cn(
              "rounded-2xl border p-3",
              isToday ? "border-primary bg-primary-50/50" : "border-line bg-surface",
            )}
          >
            <p className={cn("mb-2 text-sm font-bold", isToday ? "text-primary" : "text-ink")}>
              {t(`days.${day}`)}
            </p>
            <div className="space-y-2">
              {items.length === 0 && (
                <p className="text-xs text-muted">—</p>
              )}
              {items.map((s) => {
                const { startTime, endTime } = sessionTimesOn(s, day);
                return (
                <div
                  key={s.id}
                  className="rounded-xl bg-gradient-card border border-line p-2.5 text-xs"
                >
                  <p className="font-semibold text-ink">{moduleName(db, s.moduleId)}</p>
                  <p className="text-muted">
                    {startTime}–{endTime}
                  </p>
                  <p className="mt-1 text-[11px] text-muted">
                    {groupName(db, s.groupId)} · {salleName(db, s.salleId)}
                  </p>
                  <p className="text-[11px] text-primary">{teacherName(db, s.teacherId)}</p>
                </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
