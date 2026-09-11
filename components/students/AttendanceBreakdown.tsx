"use client";

/**
 * CE QUE L'ÉLÈVE A VRAIMENT SUIVI — présences, absences et séances annulées,
 * rangées PAR EMPLOI DU TEMPS puis par mois de cet emploi.
 *
 * La question « il en est où ? » se pose emploi du temps par emploi du temps,
 * jamais en vrac : un élève peut être irréprochable en maths et absent une
 * séance sur deux en physique, et une liste chronologique mélangée ne le dit
 * pas. Ce bloc se lit donc comme sa scolarité est facturée :
 *
 *   un panneau par emploi du temps — son groupe, sa salle, son enseignant,
 *   ses jours et son horaire, puis ses compteurs :
 *      présences (dont retards) · absences · séances annulées · total débité ;
 *   à l'intérieur, un bandeau par MOIS de cet emploi (M1, M2 …), avec la
 *   pastille de chaque séance : son statut, sa date, et ce qu'elle a coûté.
 *
 * LES TROIS STATUTS NE SE VALENT PAS, ET L'ÉCRAN LE DIT :
 *  - PRÉSENT / RETARD : la séance est suivie et facturée ;
 *  - ABSENT : la place était tenue, l'enseignant est venu — la séance est due
 *    exactement comme une présence, et son prix est parti du solde ;
 *  - SÉANCE ANNULÉE : elle n'a pas eu lieu du tout — rien n'est consommé, rien
 *    n'est débité, et le mois n'avance pas.
 *
 * Il est utilisé tel quel par la fiche élève (page Élèves) et par « Situation
 * d'un élève » (tableau de bord) : une seule lecture des séances, donc jamais
 * deux écrans qui se contredisent.
 */

import { useMemo, useState } from "react";
import { useData } from "@/lib/store/data";
import { Badge } from "@/components/ui/Badge";
import { formatDA } from "@/lib/utils";
import {
  CalendarX2,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Slash,
  UserMinus,
  X,
} from "lucide-react";
import type { AttendanceRecord, AttendanceStatus, Student } from "@/lib/types";
import {
  DAY_LABELS_FR,
  cycleLead,
  cycleSizeOf,
  cycleSlots,
  dayKeyOf,
  enrollmentCycles,
  formatDateFr,
  formatDays,
  groupName,
  moduleName as moduleNameOf,
  monthCodeLabel,
  salleName,
  seanceChargeOf,
  sessionSalleOn,
  sessionTimeLabel,
  studentSubscriptionHistory,
  teacherName,
  unsubscribedAtOf,
} from "@/lib/helpers";
import type { Day } from "@/lib/types";

const JS_DAYS: Day[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

const STATUS: Record<
  AttendanceStatus,
  { short: string; label: string; cls: string }
> = {
  present: {
    short: "P",
    label: "Présent",
    cls: "border-success/40 bg-success/10 text-success",
  },
  late: {
    short: "R",
    label: "En retard",
    cls: "border-warning/40 bg-warning/10 text-warning",
  },
  absent: {
    short: "A",
    label: "Absent",
    cls: "border-danger/40 bg-danger/10 text-danger",
  },
  cancelled: {
    short: "×",
    label: "Séance annulée",
    cls: "border-primary/40 bg-primary/10 text-primary",
  },
};

/** Les compteurs d'un emploi du temps, ou de toute la fiche. */
interface Tally {
  present: number;
  late: number;
  absent: number;
  cancelled: number;
  /** ce que ces séances ont réellement pris sur le solde */
  charged: number;
}

const emptyTally = (): Tally => ({ present: 0, late: 0, absent: 0, cancelled: 0, charged: 0 });

/** Une séance pointée, prête à être affichée. */
interface Slot {
  record: AttendanceRecord;
  /** son rang dans le mois (1-based), tel qu'il est imprimé sur la feuille */
  index: number;
  charged: number;
  day: string;
}

/** Un mois d'un emploi du temps, avec ses séances pointées. */
interface MonthBlock {
  code: string;
  size: number;
  lead: number;
  slots: Slot[];
  tally: Tally;
}

/** Un emploi du temps de l'élève, avec tout ce qu'il y a suivi. */
interface EmploiBlock {
  subId: string;
  label: string;
  group: string;
  salle: string;
  teacher: string;
  days: string;
  hours: string;
  active: boolean;
  leftOn?: string;
  months: MonthBlock[];
  tally: Tally;
  /** combien de séances ont été pointées, tous mois confondus */
  total: number;
}

function addRecord(tally: Tally, record: AttendanceRecord, charged: number) {
  if (record.status === "cancelled") tally.cancelled += 1;
  else if (record.status === "absent") tally.absent += 1;
  else {
    tally.present += 1;
    if (record.status === "late") tally.late += 1;
  }
  tally.charged += charged;
}

export function AttendanceBreakdown({
  student,
  subscriptionIds,
  emptyHint = "Aucune séance n'a encore été pointée pour cet élève.",
}: {
  student: Student;
  /** ne montrer que ces emplois du temps — absent = tous les siens */
  subscriptionIds?: string[];
  emptyHint?: string;
}) {
  const db = useData();
  /** les panneaux repliés à la main (tout est ouvert au départ) */
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  /** L'appelant passe souvent un tableau tout neuf à chaque rendu (`[emploi]`) :
   *  c'est SON contenu qui doit déclencher un recalcul, pas son identité. */
  const keepKey = subscriptionIds ? subscriptionIds.join("|") : "";

  const blocks = useMemo<EmploiBlock[]>(() => {
    const keep = keepKey ? new Set(keepKey.split("|")) : null;
    return studentSubscriptionHistory(db, student)
      .filter((subId) => !keep || keep.has(subId))
      .map((subId) => {
        const sub = db.subscriptions.find((x) => x.id === subId)!;
        const session = db.sessions.find((x) => x.id === sub.sessionId);
        const size = cycleSizeOf(sub);
        const tally = emptyTally();
        let total = 0;

        const months: MonthBlock[] = enrollmentCycles(db, student.id, subId).map((cycle) => {
          const lead = cycleLead(db, student.id, subId, cycle.code);
          const monthTally = emptyTally();
          const slots: Slot[] = cycleSlots(db, student.id, subId, cycle.code).map((record, i) => {
            const charged = seanceChargeOf(db, record, student, sub);
            addRecord(monthTally, record, charged);
            addRecord(tally, record, charged);
            total += 1;
            return { record, index: lead + i + 1, charged, day: dayKeyOf(record.timestamp) };
          });
          return { code: cycle.code, size, lead, slots, tally: monthTally };
        });

        const firstDay = session?.days?.[0];
        return {
          subId,
          label: session?.title || moduleNameOf(db, session?.moduleId ?? "") || "Emploi du temps",
          group: groupName(db, session?.groupId ?? ""),
          salle: session && firstDay ? salleName(db, sessionSalleOn(session, firstDay)) : "—",
          teacher: teacherName(db, session?.teacherId ?? ""),
          days: formatDays(session?.days ?? []) || "—",
          hours: session ? sessionTimeLabel(session) : "—",
          active: student.subscriptionIds.includes(subId),
          leftOn: unsubscribedAtOf(db, student.id, subId),
          months: months.filter((m) => m.slots.length > 0),
          tally,
          total,
        } satisfies EmploiBlock;
      })
      .sort((a, b) => Number(b.active) - Number(a.active) || b.total - a.total);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [student, keepKey, db.attendance, db.subscriptions, db.sessions, db.students]);

  /** Le total de la fiche — la somme de tous les panneaux affichés. */
  const grand = useMemo(() => {
    const t = emptyTally();
    for (const b of blocks) {
      t.present += b.tally.present;
      t.late += b.tally.late;
      t.absent += b.tally.absent;
      t.cancelled += b.tally.cancelled;
      t.charged += b.tally.charged;
    }
    return t;
  }, [blocks]);

  const pointed = grand.present + grand.absent + grand.cancelled;

  return (
    <div className="space-y-3">
      {/* ---- les cinq chiffres de la fiche, avant tout détail -------------- */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <Counter
          label="Présences"
          value={grand.present}
          tone="success"
          icon={<Check className="h-3.5 w-3.5" />}
          hint={pctOf(grand.present, pointed)}
        />
        <Counter
          label="Dont retards"
          value={grand.late}
          tone="warning"
          icon={<Clock className="h-3.5 w-3.5" />}
          hint="présent, mais en retard"
        />
        <Counter
          label="Absences"
          value={grand.absent}
          tone="danger"
          icon={<X className="h-3.5 w-3.5" />}
          hint={`${pctOf(grand.absent, pointed)} · séances dues`}
        />
        <Counter
          label="Séances annulées"
          value={grand.cancelled}
          tone="primary"
          icon={<Slash className="h-3.5 w-3.5" />}
          hint="n'ont rien coûté"
        />
        <Counter
          label="Total débité"
          value={formatDA(grand.charged)}
          tone="neutral"
          icon={<CalendarX2 className="h-3.5 w-3.5" />}
          hint="présences + absences"
        />
      </div>

      {/* ---- un panneau par emploi du temps -------------------------------- */}
      {blocks.length === 0 || pointed === 0 ? (
        <p className="rounded-2xl border border-dashed border-line py-8 text-center text-xs italic text-muted">
          {emptyHint}
        </p>
      ) : (
        blocks.map((b) => {
          const shut = !!collapsed[b.subId];
          return (
            <section
              key={b.subId}
              className="overflow-hidden rounded-2xl border border-line bg-surface"
            >
              <button
                type="button"
                onClick={() => setCollapsed((c) => ({ ...c, [b.subId]: !shut }))}
                className="flex w-full flex-wrap items-center justify-between gap-2 bg-canvas/50 p-3 text-left transition-colors hover:bg-primary-50/40"
              >
                <div className="flex min-w-0 items-start gap-2">
                  <span className="mt-0.5 text-muted">
                    {shut ? (
                      <ChevronRight className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                  </span>
                  <div className="min-w-0">
                    <strong className="block truncate text-xs text-ink">
                      {b.label}
                      <span className="font-semibold text-muted"> · groupe {b.group}</span>
                    </strong>
                    <span className="block text-[10px] text-muted">
                      {b.teacher} · Salle {b.salle} · {b.days} ·{" "}
                      <span className="font-mono">{b.hours}</span>
                    </span>
                    {!b.active && (
                      <Badge tone="warning" className="mt-1 gap-1 text-[9px]">
                        <UserMinus className="h-2.5 w-2.5" /> désinscrit
                        {b.leftOn ? ` le ${formatDateFr(b.leftOn)}` : ""} — ses séances restent
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                  <Badge tone="success" className="text-[10px]">
                    {b.tally.present} présence(s)
                    {b.tally.late > 0 ? ` · ${b.tally.late} retard(s)` : ""}
                  </Badge>
                  <Badge tone="danger" className="text-[10px]">
                    {b.tally.absent} absence(s)
                  </Badge>
                  <Badge tone="primary" className="text-[10px]">
                    {b.tally.cancelled} annulée(s)
                  </Badge>
                  <Badge tone="neutral" className="font-mono text-[10px]">
                    {formatDA(b.tally.charged)} débités
                  </Badge>
                </div>
              </button>

              {!shut && (
                <div className="space-y-2 p-3">
                  {b.months.length === 0 ? (
                    <p className="text-[11px] italic text-muted">
                      Aucune séance pointée sur cet emploi du temps.
                    </p>
                  ) : (
                    b.months.map((m) => (
                      <div key={m.code} className="rounded-xl border border-line/70 bg-canvas/30 p-2.5">
                        <div className="mb-2 flex flex-wrap items-center gap-1.5">
                          <Badge tone="primary" className="font-mono text-[10px]">
                            {monthCodeLabel(m.code)}
                          </Badge>
                          <span className="text-[10px] text-muted">
                            {m.slots.filter((s) => s.record.status !== "cancelled").length}/
                            {Math.max(0, m.size - m.lead)} séance(s) du mois
                            {m.lead > 0 ? ` · entré à la séance ${m.lead + 1}` : ""}
                          </span>
                          <span className="ms-auto flex flex-wrap items-center gap-1 text-[10px] font-bold">
                            <span className="text-success">{m.tally.present} P</span>
                            <span className="text-muted">/</span>
                            <span className="text-danger">{m.tally.absent} A</span>
                            <span className="text-muted">/</span>
                            <span className="text-primary">{m.tally.cancelled} ×</span>
                            <span className="text-muted">·</span>
                            <span className="font-mono text-ink">{formatDA(m.tally.charged)}</span>
                          </span>
                        </div>

                        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                          {m.slots.map((s) => (
                            <SlotPill key={s.record.id} slot={s} />
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </section>
          );
        })
      )}

      {/* ---- la légende, pour que personne n'ait à deviner ----------------- */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border border-line bg-canvas/30 p-2.5 text-[10px] text-muted">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-success" /> Présent — séance
          suivie et facturée
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-warning" /> En retard — présent
          quand même, facturé pareil
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-danger" /> Absent — la place
          était tenue : la séance est due
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-primary" /> Séance annulée —
          elle n&apos;a pas eu lieu : rien n&apos;est débité
        </span>
      </div>
    </div>
  );
}

/** Une séance, avec tout ce qu'elle dit : son rang, son jour, son prix. */
function SlotPill({ slot }: { slot: Slot }) {
  const { record, index, charged, day } = slot;
  const style = STATUS[record.status];
  const dow = DAY_LABELS_FR[JS_DAYS[new Date(`${day}T12:00:00`).getDay()]];
  const offered =
    record.status !== "cancelled" && charged === 0 && (record.waivedAmount ?? 0) > 0;

  return (
    <div
      className={`flex items-center justify-between gap-2 rounded-xl border px-2.5 py-1.5 ${style.cls}`}
      title={`Séance ${index} — ${style.label} le ${dow} ${formatDateFr(day)}`}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-current/30 bg-surface/60 text-[11px] font-black">
          {style.short}
        </span>
        <span className="min-w-0">
          <strong className="block truncate text-[11px] leading-tight">{style.label}</strong>
          <span className="block truncate text-[9px] opacity-80">
            Séance {index} · {dow} {formatDateFr(day)}
            {record.substituteGroup ? " · autre groupe" : ""}
          </span>
        </span>
      </span>
      <span className="shrink-0 text-right font-mono text-[10px] font-bold">
        {record.status === "cancelled" ? (
          <span className="opacity-80">0 DA</span>
        ) : charged > 0 ? (
          `−${formatDA(charged)}`
        ) : (
          <span className="opacity-80">{offered ? "offerte" : "0 DA"}</span>
        )}
      </span>
    </div>
  );
}

function pctOf(value: number, total: number): string {
  if (total <= 0) return "—";
  return `${Math.round((value / total) * 100)} % du pointé`;
}

function Counter({
  label,
  value,
  tone,
  icon,
  hint,
}: {
  label: string;
  value: number | string;
  tone: "success" | "warning" | "danger" | "primary" | "neutral";
  icon: React.ReactNode;
  hint?: string;
}) {
  const cls: Record<string, string> = {
    success: "border-success/30 bg-success/5 text-success",
    warning: "border-warning/30 bg-warning/5 text-warning",
    danger: "border-danger/30 bg-danger/5 text-danger",
    primary: "border-primary/30 bg-primary/5 text-primary",
    neutral: "border-line bg-canvas/40 text-ink",
  };
  return (
    <div className={`rounded-xl border p-2.5 ${cls[tone]}`}>
      <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider opacity-80">
        {icon} {label}
      </span>
      <strong className="mt-0.5 block text-lg font-black leading-none">{value}</strong>
      {hint && <span className="mt-1 block text-[9px] text-muted">{hint}</span>}
    </div>
  );
}
