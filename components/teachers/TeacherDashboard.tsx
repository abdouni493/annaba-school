"use client";

/**
 * LE TABLEAU DE BORD D'UN ENSEIGNANT — sa journée, son argent, ses retardataires.
 *
 * L'écran répond à trois questions, dans l'ordre où un enseignant se les pose
 * en arrivant le matin :
 *
 *  1. **QUE FAIS-JE AUJOURD'HUI ?** — la journée se lit créneau par créneau,
 *     avec l'heure, la salle, le groupe, le mois que ce groupe vit et où en est
 *     son pointage. Le jour est NAVIGABLE : hier, avant-hier, n'importe quelle
 *     date — un enseignant doit pouvoir vérifier ce qu'il a fait la semaine
 *     passée. Un clic sur un créneau ouvre la LISTE DE SES ÉLÈVES, en lecture
 *     seule : c'est la seule action que son compte lui donne sur un groupe.
 *  2. **OÙ EN EST MA PAIE ?** — ce qui est payable, ce qui est retenu, ce qui
 *     a déjà été versé. Les chiffres sortent du même modèle que l'écran de
 *     règlement du guichet (`teacherMonths`), donc ce qu'il lit ici et ce que
 *     la réception lit là-bas sont, au centime, la même chose.
 *  3. **QUI ME RETIENT MON ARGENT ?** — les élèves en retard de paiement,
 *     nommés, avec leur groupe, leur mois, ce qu'ils doivent et la part que
 *     cela retient. C'est l'information qu'un enseignant réclame en premier et
 *     que personne ne lui donnait.
 *
 * Rien ne s'écrit depuis cet écran : ni pointage, ni encaissement, ni
 * correction. Ces gestes appartiennent au guichet.
 */

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useData } from "@/lib/store/data";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/layout/PageHeader";
import { Input } from "@/components/ui/SearchInput";
import { TeacherGroupRoster } from "@/components/teachers/TeacherGroupRoster";
import { formatDA, money } from "@/lib/utils";
import {
  DAY_LABELS_FR,
  dayKeyOf,
  formatDateFr,
  minutesOf,
  monthCodeLabel,
  sessionSalleOn,
  sessionTimesOn,
} from "@/lib/helpers";
import { payEmplois } from "@/lib/teacherPayBoard";
import type { TeacherEmploi } from "@/lib/teacherMonths";
import type { Day, Teacher } from "@/lib/types";
import {
  AlertTriangle,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Eye,
  Lock,
  MapPin,
  Sparkles,
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

/**
 * UNE COULEUR PAR EMPLOI DU TEMPS, tirée de son identifiant — elle ne bouge
 * donc jamais d'un rendu à l'autre, ni d'un jour à l'autre : le groupe du mardi
 * a la même couleur que le même groupe le jeudi.
 */
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

const isoOf = (d: Date) => d.toLocaleDateString("fr-CA");

/** Un élève en retard de paiement, rattaché au groupe et au mois qui le doivent. */
interface LateRow {
  key: string;
  studentId: string;
  name: string;
  registrationNumber: string;
  phone: string;
  emploi: TeacherEmploi;
  monthCode: string;
  done: number;
  size: number;
  debt: number;
  withheld: number;
  status: string;
}

export function TeacherDashboard({ teacher }: { teacher: Teacher }) {
  const db = useData();
  const todayIso = isoOf(new Date());

  const [date, setDate] = useState(todayIso);
  const [openEmploi, setOpenEmploi] = useState<TeacherEmploi | null>(null);
  const [showAllLate, setShowAllLate] = useState(false);

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

  const emploiOf = useMemo(
    () => new Map(emplois.map((e) => [e.sessionId, e])),
    [emplois],
  );

  const settlements = useMemo(
    () => db.teacherPayments.filter((p) => p.teacherId === teacher.id),
    [db.teacherPayments, teacher.id],
  );

  // ---- l'argent, en un coup d'œil -----------------------------------------
  const payable = money(emplois.reduce((s, e) => s + e.payable, 0));
  const withheld = money(emplois.reduce((s, e) => s + e.withheld, 0));
  const settled = money(emplois.reduce((s, e) => s + e.settled, 0));
  const received = money(settlements.reduce((s, p) => s + p.amount, 0));
  const rosterTotal = emplois.reduce((s, e) => s + e.rosterCount, 0);
  const closedUnpaid = emplois.flatMap((e) =>
    e.months.filter((m) => m.state === "done" && m.payable > 0).map((m) => ({ e, m })),
  );

  // ---- LA JOURNÉE AFFICHÉE -------------------------------------------------
  const dow = JS_DAYS[new Date(`${date}T12:00:00`).getDay()];
  const isToday = date === todayIso;
  const isPast = date < todayIso;

  const shiftDay = (days: number) => {
    const d = new Date(`${date}T12:00:00`);
    d.setDate(d.getDate() + days);
    setDate(isoOf(d));
  };

  /** Les créneaux que l'enseignant tient ce jour-là, dans l'ordre des heures. */
  const daySlots = useMemo(() => {
    const marks = new Map<string, number>();
    for (const a of db.attendance) {
      if (dayKeyOf(a.timestamp) !== date) continue;
      marks.set(a.sessionId, (marks.get(a.sessionId) ?? 0) + 1);
    }
    return db.sessions
      .filter(
        (s) =>
          s.teacherId === teacher.id &&
          !s.archivedAt &&
          s.days.includes(dow) &&
          (!s.periodStart || s.periodStart <= date) &&
          (!s.periodEnd || s.periodEnd >= date),
      )
      .map((s) => {
        const times = sessionTimesOn(s, dow);
        const emploi = emploiOf.get(s.id);
        return {
          session: s,
          emploi,
          startTime: times.startTime,
          endTime: times.endTime,
          salle: sessionSalleOn(s, dow),
          marked: marks.get(s.id) ?? 0,
          roster: emploi?.rosterCount ?? 0,
        };
      })
      .sort((a, b) => minutesOf(a.startTime) - minutesOf(b.startTime));
  }, [db.sessions, db.attendance, teacher.id, dow, date, emploiOf]);

  const dayDone = daySlots.filter((r) => r.roster > 0 && r.marked >= r.roster).length;
  const dayStarted = daySlots.filter((r) => r.marked > 0 && !(r.roster > 0 && r.marked >= r.roster)).length;

  /** Ce que la journée affichée rapporte, séance pointée par séance pointée. */
  const dayEarned = money(
    daySlots.reduce((s, r) => s + (r.emploi ? r.emploi.perSeance * r.marked : 0), 0),
  );

  // ---- LA SEMAINE, en une ligne -------------------------------------------
  const weekCounts = useMemo(() => {
    const out = new Map<Day, number>();
    for (const d of WEEK_ORDER) {
      out.set(
        d,
        db.sessions.filter((s) => s.teacherId === teacher.id && !s.archivedAt && s.days.includes(d))
          .length,
      );
    }
    return out;
  }, [db.sessions, teacher.id]);

  // ---- LES ÉLÈVES EN RETARD DE PAIEMENT ------------------------------------
  const lateRows = useMemo(() => {
    const out: LateRow[] = [];
    for (const e of emplois) {
      for (const m of e.months) {
        for (const st of m.students) {
          if (st.debt <= 0) continue;
          out.push({
            key: `${e.sessionId}|${m.code}|${st.studentId}`,
            studentId: st.studentId,
            name: st.name,
            registrationNumber: st.registrationNumber,
            phone: st.phone,
            emploi: e,
            monthCode: m.code,
            done: st.done,
            size: st.size,
            debt: st.debt,
            withheld: st.withheld,
            status: st.status,
          });
        }
      }
    }
    return out.sort((a, b) => b.debt - a.debt || a.name.localeCompare(b.name));
  }, [emplois]);

  const lateStudents = new Set(lateRows.map((r) => r.studentId)).size;
  const lateTotal = money(lateRows.reduce((s, r) => s + r.debt, 0));
  const visibleLate = showAllLate ? lateRows : lateRows.slice(0, 8);

  // ---- LES ALERTES ---------------------------------------------------------
  const alerts: { tone: "danger" | "warning" | "primary" | "success"; text: string }[] = [];
  if (closedUnpaid.length > 0) {
    alerts.push({
      tone: "primary",
      text: `${closedUnpaid.length} mois clos vous restent à régler — ${formatDA(
        money(closedUnpaid.reduce((s, x) => s + x.m.payable, 0)),
      )} en attente de versement par l'administration.`,
    });
  }
  if (withheld > 0) {
    alerts.push({
      tone: "warning",
      text: `${formatDA(withheld)} sont retenus : ${lateStudents} élève(s) n'ont pas payé leurs séances. Cette part vous revient dès qu'ils s'acquittent.`,
    });
  }
  if (lateRows.length > 0) {
    alerts.push({
      tone: "danger",
      text: `${lateStudents} élève(s) sont en retard de paiement sur vos groupes, pour ${formatDA(lateTotal)} au total.`,
    });
  }
  for (const e of emplois) {
    if (!e.priced && teacher.paymentType === "per_group") {
      alerts.push({
        tone: "warning",
        text: `« ${e.title} · ${e.groupName} » ne porte aucune part enseignant — ses séances ne vous rapportent rien tant que le tarif n'est pas saisi.`,
      });
    }
  }
  if (alerts.length === 0 && emplois.length > 0) {
    alerts.push({
      tone: "success",
      text: "Aucune alerte : tous vos élèves sont à jour et rien n'est retenu sur votre paie.",
    });
  }

  return (
    <div className="space-y-5 text-xs">
      <PageHeader
        emoji="🏠"
        title={`Bonjour, ${teacher.firstName} ${teacher.lastName}`}
        subtitle="Votre journée, vos groupes, votre paie et les élèves en retard de paiement"
      />

      {/* ================= LES CHIFFRES DU COMPTE ========================== */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <HeroStat
          emoji="📚"
          label="Mes groupes"
          value={String(emplois.length)}
          hint={`${rosterTotal} élève(s) suivis`}
          tone="primary"
          index={0}
        />
        <HeroStat
          emoji="🗓️"
          label={isToday ? "Séances aujourd'hui" : "Séances ce jour-là"}
          value={String(daySlots.length)}
          hint={`${dayDone} pointée(s) · ${dayStarted} en cours`}
          tone="primary"
          index={1}
        />
        <HeroStat
          emoji="💰"
          label="Payable maintenant"
          value={formatDA(payable)}
          hint="ce que l'école vous doit"
          tone="success"
          index={2}
        />
        <HeroStat
          emoji="🔒"
          label="Retenu"
          value={formatDA(withheld)}
          hint={`${lateStudents} élève(s) en retard`}
          tone={withheld > 0 ? "danger" : "neutral"}
          index={3}
        />
        <HeroStat
          emoji="✅"
          label="Déjà gagné et soldé"
          value={formatDA(settled)}
          hint="parts déjà réglées"
          tone="primary"
          index={4}
        />
        <HeroStat
          emoji="🏦"
          label="Net reçu à ce jour"
          value={formatDA(received)}
          hint={`${settlements.length} règlement(s)`}
          tone="success"
          index={5}
        />
      </div>

      {/* ================= LES ALERTES ===================================== */}
      <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
        {alerts.map((a, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: Math.min(i * 0.05, 0.3) }}
            className={`flex items-start gap-2 rounded-2xl border p-3 text-[11px] leading-relaxed ${
              a.tone === "danger"
                ? "border-danger/40 bg-danger/10 text-danger"
                : a.tone === "warning"
                  ? "border-warning/40 bg-warning/10 text-warning"
                  : a.tone === "success"
                    ? "border-success/40 bg-success/10 text-success"
                    : "border-primary/40 bg-primary-50/60 text-primary"
            }`}
          >
            {a.tone === "success" ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            ) : a.tone === "primary" ? (
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            <span>{a.text}</span>
          </motion.div>
        ))}
      </div>

      {/* ================= MA JOURNÉE ====================================== */}
      <section className="overflow-hidden rounded-2xl border border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-gradient-to-r from-primary-50 to-transparent p-4">
          <div className="min-w-0">
            <strong className="flex items-center gap-2 text-sm text-ink">
              <CalendarDays className="h-4.5 w-4.5 text-primary" /> Ma journée —{" "}
              <span className="capitalize">{DAY_LABELS_FR[dow]}</span> {formatDateFr(date)}
              {isToday && (
                <Badge tone="success" className="text-[9px]">
                  aujourd&apos;hui
                </Badge>
              )}
              {isPast && (
                <Badge tone="neutral" className="text-[9px]">
                  jour passé
                </Badge>
              )}
            </strong>
            <span className="block text-[11px] text-muted">
              {daySlots.length === 0
                ? "Aucun cours programmé ce jour-là."
                : `${daySlots.length} créneau(x) · ${dayDone} entièrement pointé(s) · ${dayStarted} en cours · ${formatDA(dayEarned)} produits par les présences du jour`}
            </span>
          </div>

          {/* Le jour se navigue : hier, demain, ou n'importe quelle date. */}
          <div className="flex flex-wrap items-center gap-1.5">
            <Button size="sm" variant="outline" onClick={() => shiftDay(-1)} className="gap-1">
              <ChevronLeft className="h-3.5 w-3.5" /> Jour précédent
            </Button>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value || todayIso)}
              className="h-8 w-[9.5rem] text-xs"
            />
            <Button size="sm" variant="outline" onClick={() => shiftDay(1)} className="gap-1">
              Jour suivant <ChevronRight className="h-3.5 w-3.5" />
            </Button>
            {!isToday && (
              <Button size="sm" variant="secondary" onClick={() => setDate(todayIso)}>
                Aujourd&apos;hui
              </Button>
            )}
          </div>
        </div>

        <div className="p-4">
          {daySlots.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-line py-12 text-center text-xs font-bold text-muted">
              Aucun cours ce {DAY_LABELS_FR[dow].toLowerCase()} — profitez-en, ou revenez sur un
              autre jour avec les flèches ci-dessus.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {daySlots.map((row, i) => {
                const e = row.emploi;
                const color = colorOf(row.session.id);
                const pct =
                  row.roster > 0 ? Math.min(100, Math.round((row.marked / row.roster) * 100)) : 0;
                const complete = row.roster > 0 && row.marked >= row.roster;
                return (
                  <motion.button
                    key={row.session.id}
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i * 0.05, 0.3) }}
                    whileHover={{ y: -2 }}
                    onClick={() => e && setOpenEmploi(e)}
                    disabled={!e}
                    className="group overflow-hidden rounded-2xl border border-line bg-surface text-start transition-all hover:shadow-md disabled:opacity-60"
                    style={{ borderInlineStartWidth: 5, borderInlineStartColor: color }}
                    title={
                      e
                        ? "Voir la liste des élèves de ce groupe"
                        : "Ce créneau n'a pas encore d'abonnement — aucune liste à afficher"
                    }
                  >
                    <div className="flex items-start justify-between gap-2 p-3.5">
                      <div className="min-w-0">
                        <strong className="block truncate text-sm text-ink">
                          {e?.title ?? row.session.title ?? "Emploi du temps"}
                        </strong>
                        <span className="block truncate text-[10px] text-muted">
                          Groupe {e?.groupName ?? "—"} · {e?.className ?? "—"}
                        </span>
                      </div>
                      <span
                        className="shrink-0 rounded-lg px-2 py-1 font-mono text-[11px] font-black text-white"
                        style={{ backgroundColor: color }}
                      >
                        {row.startTime}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 text-[10px] text-muted">
                      <span className="inline-flex items-center gap-1 font-mono">
                        <Clock className="h-3 w-3" /> {row.startTime} → {row.endTime}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3 w-3" /> {row.salle || "—"}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Users className="h-3 w-3" /> {row.roster} élève(s)
                      </span>
                    </div>

                    {e && (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 px-3.5">
                        <Badge tone="primary" className="font-mono text-[9px]">
                          {monthCodeLabel(e.currentCode)} · séance{" "}
                          {Math.min(Math.max(e.currentHeld, 0), e.size)}/{e.size}
                        </Badge>
                        {e.priced ? (
                          <Badge tone="neutral" className="font-mono text-[9px]">
                            {formatDA(e.perSeance)} / élève présent
                          </Badge>
                        ) : (
                          <Badge tone="warning" className="text-[9px]">
                            part non définie
                          </Badge>
                        )}
                        {e.studentsInDebt > 0 && (
                          <Badge tone="danger" className="gap-1 text-[9px]">
                            <AlertTriangle className="h-2.5 w-2.5" /> {e.studentsInDebt} en retard
                          </Badge>
                        )}
                      </div>
                    )}

                    {/* Où en est le pointage de ce créneau, ce jour-là. */}
                    <div className="mt-2.5 px-3.5">
                      <div className="flex items-center justify-between text-[9px] font-bold uppercase tracking-wider text-muted">
                        <span>Pointage du jour</span>
                        <span className={complete ? "text-success" : row.marked > 0 ? "text-warning" : ""}>
                          {row.marked}/{row.roster}
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line/60">
                        <div
                          className={`h-full ${complete ? "bg-success" : "bg-warning"}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>

                    <div className="mt-3 flex items-center justify-between border-t border-line bg-canvas/40 px-3.5 py-2 text-[10px] font-bold text-primary">
                      <span className="inline-flex items-center gap-1">
                        <Eye className="h-3 w-3" /> Voir la liste des élèves
                      </span>
                      <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
                    </div>
                  </motion.button>
                );
              })}
            </div>
          )}

          {/* La semaine, pour sauter directement au bon jour. */}
          <div className="mt-4 grid grid-cols-7 gap-1.5">
            {WEEK_ORDER.map((d) => {
              const count = weekCounts.get(d) ?? 0;
              const active = d === dow;
              return (
                <button
                  key={d}
                  onClick={() => {
                    // Le jour de la semaine affichée, à partir du jour courant.
                    const cur = new Date(`${date}T12:00:00`);
                    const delta = JS_DAYS.indexOf(d) - cur.getDay();
                    cur.setDate(cur.getDate() + delta);
                    setDate(isoOf(cur));
                  }}
                  className={`rounded-xl border p-2 text-center transition-all ${
                    active
                      ? "border-primary bg-primary text-white"
                      : count > 0
                        ? "border-line bg-canvas/50 text-ink hover:border-primary/50"
                        : "border-dashed border-line text-muted"
                  }`}
                >
                  <span className="block text-[9px] font-bold uppercase tracking-wide">
                    {DAY_LABELS_FR[d].slice(0, 3)}
                  </span>
                  <strong className="block font-mono text-sm font-black">{count}</strong>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* ================= LES ÉLÈVES EN RETARD DE PAIEMENT ================ */}
      <section className="overflow-hidden rounded-2xl border-2 border-danger/30 bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 bg-gradient-to-r from-danger/15 to-transparent p-4">
          <div className="min-w-0">
            <strong className="flex items-center gap-2 text-sm text-danger">
              <AlertTriangle className="h-4.5 w-4.5" /> Élèves en retard de paiement (
              {lateStudents})
            </strong>
            <span className="block text-[11px] leading-relaxed text-muted">
              {lateRows.length === 0
                ? "Aucun élève ne doit quoi que ce soit sur vos groupes — rien ne retient votre paie."
                : `${formatDA(lateTotal)} manquants sur ${lateRows.length} mois d'élève. Tant qu'une séance n'est pas payée, la part qu'elle vous rapporte reste retenue — elle vous revient automatiquement le jour où l'élève s'acquitte. L'encaissement se fait au guichet.`}
            </span>
          </div>
          <div className="flex shrink-0 gap-2">
            <SmallStat label="Élèves" value={String(lateStudents)} tone="text-danger" />
            <SmallStat label="Total dû" value={formatDA(lateTotal)} tone="text-danger" />
            <SmallStat
              label="Part retenue"
              value={formatDA(withheld)}
              tone={withheld > 0 ? "text-warning" : "text-muted"}
            />
          </div>
        </div>

        {lateRows.length === 0 ? (
          <p className="px-3 py-10 text-center text-xs italic text-muted">
            Tous vos élèves sont à jour. 🎉
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-[11px]">
                <thead className="bg-canvas/70">
                  <tr className="text-left text-[9px] uppercase tracking-wide text-muted">
                    <th className="px-3 py-2.5">N°</th>
                    <th className="px-3 py-2.5">Élève</th>
                    <th className="px-3 py-2.5">Groupe concerné</th>
                    <th className="px-3 py-2.5 text-center">Mois</th>
                    <th className="px-3 py-2.5 text-center">Séances</th>
                    <th className="px-3 py-2.5 text-center">Statut</th>
                    <th className="px-3 py-2.5 text-right">Doit</th>
                    <th className="px-3 py-2.5 text-right">Part retenue</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleLate.map((r, i) => (
                    <motion.tr
                      key={r.key}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(i * 0.02, 0.25) }}
                      onClick={() => setOpenEmploi(r.emploi)}
                      className="cursor-pointer border-t border-line/60 transition-colors hover:bg-danger/5"
                      title="Ouvrir la liste des élèves de ce groupe"
                    >
                      <td className="px-3 py-2.5 font-mono text-[10px] text-muted">
                        {r.registrationNumber || "—"}
                      </td>
                      <td className="px-3 py-2.5">
                        <strong className="block text-ink">{r.name}</strong>
                        {r.phone && (
                          <span className="block font-mono text-[9px] text-muted">{r.phone}</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="block text-ink">{r.emploi.title}</span>
                        <span className="block text-[9px] text-muted">
                          Groupe {r.emploi.groupName} · {r.emploi.className}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <Badge tone="primary" className="font-mono text-[9px]">
                          {r.monthCode}
                        </Badge>
                      </td>
                      <td className="px-3 py-2.5 text-center font-mono">
                        {r.done}/{r.size}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <Badge
                          tone={r.status === "partial" ? "warning" : "danger"}
                          className="text-[9px]"
                        >
                          {r.status === "partial" ? "Partiel" : "Impayé"}
                        </Badge>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono font-bold text-danger">
                        {formatDA(r.debt)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono">
                        {r.withheld > 0 ? (
                          <span className="inline-flex items-center gap-1 font-bold text-warning">
                            <Lock className="h-3 w-3" /> {formatDA(r.withheld)}
                          </span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>

            {lateRows.length > 8 && (
              <div className="border-t border-line bg-canvas/40 p-2.5 text-center">
                <Button size="sm" variant="ghost" onClick={() => setShowAllLate((v) => !v)}>
                  {showAllLate
                    ? "Réduire la liste"
                    : `Voir les ${lateRows.length - 8} autres lignes`}
                </Button>
              </div>
            )}
          </>
        )}
      </section>

      {/* ================= MES GROUPES ===================================== */}
      <section className="space-y-3">
        <strong className="flex items-center gap-2 text-sm text-ink">
          <BookOpen className="h-4.5 w-4.5 text-primary" /> Mes groupes ({emplois.length})
        </strong>
        {emplois.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line py-12 text-center text-xs font-bold text-muted">
            Aucun emploi du temps ne vous est encore assigné.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {emplois.map((e, i) => {
              const color = colorOf(e.sessionId);
              return (
                <motion.button
                  key={e.sessionId}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.04, 0.3) }}
                  whileHover={{ y: -2 }}
                  onClick={() => setOpenEmploi(e)}
                  className="group overflow-hidden rounded-2xl border border-line bg-surface text-start transition-all hover:shadow-md"
                  style={{ borderInlineStartWidth: 5, borderInlineStartColor: color }}
                >
                  <div className="p-3.5">
                    <strong className="block truncate text-sm text-ink">{e.title}</strong>
                    <span className="block truncate text-[10px] text-muted">
                      Groupe {e.groupName} · {e.className} · Salle {e.salleName}
                    </span>
                    <span className="block truncate text-[10px] text-muted">
                      {e.daysLabel} · <span className="font-mono">{e.timeLabel}</span>
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 px-3.5">
                    <MiniStat label="Élèves" value={String(e.rosterCount)} tone="text-ink" />
                    <MiniStat label="Payable" value={formatDA(e.payable)} tone="text-success" />
                    <MiniStat
                      label="Retenu"
                      value={formatDA(e.withheld)}
                      tone={e.withheld > 0 ? "text-danger" : "text-muted"}
                    />
                  </div>

                  <div className="mt-3 flex items-center justify-between border-t border-line bg-canvas/40 px-3.5 py-2 text-[10px] font-bold text-primary">
                    <span className="inline-flex items-center gap-1">
                      <Users className="h-3 w-3" /> Liste des élèves
                    </span>
                    <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
                  </div>
                </motion.button>
              );
            })}
          </div>
        )}
      </section>

      {/* La liste d'un groupe : le seul geste qu'un enseignant a sur un groupe. */}
      {openEmploi && (
        <TeacherGroupRoster
          emploi={openEmploi}
          date={date}
          onClose={() => setOpenEmploi(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

const HERO_TONE = {
  primary: "from-primary/15 to-primary/5 border-primary/30 text-primary",
  success: "from-success/15 to-success/5 border-success/30 text-success",
  danger: "from-danger/15 to-danger/5 border-danger/30 text-danger",
  neutral: "from-canvas to-transparent border-line text-muted",
} as const;

function HeroStat({
  emoji,
  label,
  value,
  hint,
  tone,
  index,
}: {
  emoji: string;
  label: string;
  value: string;
  hint: string;
  tone: keyof typeof HERO_TONE;
  index: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04, duration: 0.3 }}
      className={`relative overflow-hidden rounded-2xl border bg-gradient-to-br p-3.5 ${HERO_TONE[tone]}`}
    >
      <span className="absolute -end-2 -top-2 text-4xl opacity-20">{emoji}</span>
      <span className="block text-[9px] font-bold uppercase tracking-wider opacity-80">{label}</span>
      <strong className="mt-0.5 block font-mono text-base font-black text-ink">{value}</strong>
      <span className="block text-[9px] text-muted">{hint}</span>
    </motion.div>
  );
}

function SmallStat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2 text-center">
      <span className="block text-[8px] font-bold uppercase tracking-wider text-muted">{label}</span>
      <strong className={`block font-mono text-[11px] font-black ${tone}`}>{value}</strong>
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-xl bg-canvas/60 p-2 text-center">
      <span className="block text-[8px] font-bold uppercase tracking-wider text-muted">{label}</span>
      <strong className={`block font-mono text-[11px] font-black ${tone}`}>{value}</strong>
    </div>
  );
}
