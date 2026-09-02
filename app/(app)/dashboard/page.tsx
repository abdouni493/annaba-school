"use client";

/**
 * Tableau de bord — the desk's morning screen.
 *
 * It answers three questions and opens every door the reception needs:
 *
 *  1. **Où en est la journée ?** — combien de créneaux sont pointés, combien
 *     restent, et à quelle heure. Le jour est navigable : hier, demain, ou
 *     n'importe quelle date, donc une séance oubliée se pointe encore et le
 *     lendemain se prépare la veille.
 *  2. **Quel groupe j'ouvre ?** — la grille de la journée se lit comme un vrai
 *     emploi du temps : une ligne par créneau horaire, une colonne par salle,
 *     et chaque emploi du temps porte SA couleur. Un clic ouvre sa feuille de
 *     présence. La recherche et les filtres (classe, année, module,
 *     enseignant) balaient TOUS les emplois du temps, pas seulement ceux du
 *     jour, et le premier résultat est mis en avant pour être ouvert d'un clic.
 *  3. **Et la caisse ?** — dépôt, dépense et retrait se saisissent ici, sans
 *     quitter l'écran, exactement comme sur la page Caisse.
 *
 * Un élève créé depuis cette page entre LÀ OÙ EN EST LE GROUPE à la date
 * affichée : le mois qu'il vit et la séance tenue ce jour-là, jamais la
 * séance 1 de l'emploi.
 */

import { useMemo, useState } from "react";
import { useData, uid } from "@/lib/store/data";
import { useSession } from "@/lib/store/session";
import { useToast } from "@/lib/store/toast";
import { Card, CardBody } from "@/components/ui/Card";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input, Select } from "@/components/ui/SearchInput";
import { TeacherPages } from "@/components/pages/TeacherPages";
import { PresenceSheet } from "@/components/attendance/PresenceSheet";
import { CreateStudentModal } from "@/components/students/CreateStudentModal";
import { StudentSituationModal } from "@/components/students/StudentSituationModal";
import { StudentPaymentsPrintModal } from "@/components/students/StudentPaymentsPrintModal";
import { WorkerPaymentsAlert } from "@/components/dashboard/WorkerPaymentsAlert";
import { AccessDenied } from "@/components/layout/AccessDenied";
import { useAccessRights, useCan } from "@/lib/usePermissions";
import { canSeePage } from "@/lib/permissions";
import { formatDA, money } from "@/lib/utils";
import {
  DAY_LABELS_FR,
  cycleSizeOf,
  monthlyPriceOf,
  schoolMonthShareOf,
  schoolPerSeanceOf,
  seancePriceOf,
  sessionGroupsLabel,
  teacherMonthShareOf,
  teacherPerSeanceOf,
  classLabel,
  dayKeyOf,
  formatDateFr,
  formatDays,
  groupName,
  minutesOf,
  moduleName as moduleNameOf,
  salleName,
  sessionCurrentMonthCode,
  sessionSalleIds,
  sessionSalleOn,
  sessionTimesOn,
  teacherName,
} from "@/lib/helpers";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Calendar,
  CalendarCheck,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Filter,
  Hourglass,
  Printer,
  Receipt,
  Search,
  UserPlus,
  UserSearch,
  Users,
  Wallet,
  X,
} from "lucide-react";
import type { Day, ScheduleSession } from "@/lib/types";

const JS_DAYS: Day[] = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/**
 * One colour per emploi du temps, picked from its id so it never moves between
 * two renders — the same groupe garde sa couleur d'un jour à l'autre.
 */
const PALETTE = [
  "#7c3aed", "#0ea5e9", "#16a34a", "#ea580c", "#db2777",
  "#0891b2", "#ca8a04", "#4f46e5", "#059669", "#e11d48",
  "#2563eb", "#9333ea",
];

function colorOf(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

export default function DashboardPage() {
  const { user } = useSession();
  const rights = useAccessRights();
  if (user?.role === "teacher") return <TeacherPages slug="dashboard" />;
  // Le tableau de bord n'est pas servi par le répartiteur de modules : c'est
  // une route à lui, et son garde-fou doit donc vivre ici. Un travailleur à qui
  // l'écran n'a pas été ouvert y arrive pourtant — c'est la page d'accueil par
  // défaut de son rôle.
  if (!canSeePage(rights, "dashboard")) return <AccessDenied />;
  return <AdminDashboard />;
}

type CashKind = "deposit" | "withdraw" | "expense";

function AdminDashboard() {
  const db = useData();
  const { sessions, attendance, students, subscriptions, classes, cashMove, push } = db;
  const { addToast } = useToast();
  const can = useCan("dashboard");
  const { user } = useSession();
  /** La cloche des encaissements des travailleurs ne regarde que la direction. */
  const isAdmin = user?.role === "admin";

  const isoOf = (d: Date) => d.toLocaleDateString("fr-CA");
  const todayIso = isoOf(new Date());

  /** The day the whole screen works on — today until the desk moves it. */
  const [date, setDate] = useState<string>(todayIso);
  const [openSessionId, setOpenSessionId] = useState<string | null>(null);
  const [openDate, setOpenDate] = useState<string>(todayIso);
  const [month, setMonth] = useState<string>("M1");
  const [createOpen, setCreateOpen] = useState(false);
  /** « Situation d'un élève » : le tableau de tous ses emplois du temps. */
  const [situationOpen, setSituationOpen] = useState(false);
  /** « Imprimer un ancien paiement » : chercher un élève, relire ses versements. */
  const [payPrintOpen, setPayPrintOpen] = useState(false);
  /** the emploi the create screen arrives pre-ticked on */
  const [createSubIds, setCreateSubIds] = useState<string[]>([]);

  // ---- search & filters (they sweep EVERY emploi du temps, not just today) --
  const [search, setSearch] = useState("");
  const [classFilter, setClassFilter] = useState("all");
  const [yearFilter, setYearFilter] = useState("all");
  const [moduleFilter, setModuleFilter] = useState("all");
  const [teacherFilter, setTeacherFilter] = useState("all");

  // ---- caisse shortcuts ----------------------------------------------------
  const [cashKind, setCashKind] = useState<CashKind | null>(null);
  const [cashAmount, setCashAmount] = useState<number>(0);
  const [cashLabel, setCashLabel] = useState("");
  const [cashDate, setCashDate] = useState(todayIso);

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
            // Un emploi supprimé ne se pointe plus : il a quitté la journée.
            !s.archivedAt &&
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

  /**
   * How far the pointage of that day has gone, créneau by créneau — built in
   * one pass over les présences du jour, pas un balayage par emploi.
   */
  const progress = useMemo(() => {
    const marks = new Map<string, number>();
    for (const a of attendance) {
      if (dayKeyOf(a.timestamp) !== date) continue;
      marks.set(a.sessionId, (marks.get(a.sessionId) ?? 0) + 1);
    }
    const rosterOf = new Map<string, number>();
    for (const st of students) {
      for (const id of st.subscriptionIds) rosterOf.set(id, (rosterOf.get(id) ?? 0) + 1);
    }
    const bySession = new Map<string, string>();
    for (const sub of subscriptions) bySession.set(sub.sessionId, sub.id);

    const out = new Map<string, { roster: number; marked: number; priced: boolean }>();
    for (const s of sessions) {
      const subId = bySession.get(s.id);
      out.set(s.id, {
        roster: subId ? rosterOf.get(subId) ?? 0 : 0,
        marked: marks.get(s.id) ?? 0,
        priced: !!subId,
      });
    }
    return out;
  }, [sessions, subscriptions, students, attendance, date]);

  const progressOf = (s: ScheduleSession) =>
    progress.get(s.id) ?? { roster: 0, marked: 0, priced: false };

  /** Done = every enrolled student of the créneau has a row that day. */
  const doneCount = dayTimings.filter((s) => {
    const { roster, marked } = progressOf(s);
    return roster > 0 && marked >= roster;
  }).length;
  const startedCount = dayTimings.filter((s) => {
    const { roster, marked } = progressOf(s);
    return marked > 0 && !(roster > 0 && marked >= roster);
  }).length;
  const remainingCount = dayTimings.length - doneCount;

  const dayMarks = attendance.filter(
    (a) => dayKeyOf(a.timestamp) === date && dayTimings.some((s) => s.id === a.sessionId),
  ).length;

  /**
   * LE TARIF DE CHAQUE EMPLOI DU TEMPS DU JOUR, DANS LE DÉTAIL.
   *
   * La question que la réception se pose vingt fois par jour : « ce créneau,
   * il coûte combien à l'élève, il rapporte combien à l'école, et combien à
   * l'enseignant ? » Les trois nombres sortent d'une seule division — le prix
   * du mois par le nombre de séances du mois — et cette division ne tombe
   * presque jamais juste : 4 000 DA sur 3 séances font 1 333,33 DA, pas 1 333.
   * Les montants sont donc affichés AVEC LEUR VIRGULE, exactement comme ils
   * sont facturés à l'élève et payés à l'enseignant.
   */
  /**
   * CE QUE CHAQUE EMPLOI DU TEMPS A ENCAISSÉ, DEPUIS LE PREMIER JOUR.
   *
   * La question que la direction pose en fin de mois : « ce groupe, il a
   * rapporté combien ? » Ce n'est pas la recette du jour — c'est la somme de
   * TOUT ce que ses élèves ont versé dessus, mois après mois, quelle qu'en soit
   * la provenance. Le calcul se fait en une passe sur les paiements, indexée
   * par abonnement, puis rapportée à l'emploi du temps qui le porte.
   */
  const collectedBySession = useMemo(() => {
    const bySub = new Map<string, { total: number; count: number; students: Set<string> }>();
    for (const pmt of db.payments) {
      if (!pmt.subscriptionId || pmt.amountPaid <= 0) continue;
      const row = bySub.get(pmt.subscriptionId) ?? { total: 0, count: 0, students: new Set<string>() };
      row.total = money(row.total + pmt.amountPaid);
      row.count += 1;
      row.students.add(pmt.studentId);
      bySub.set(pmt.subscriptionId, row);
    }
    const out = new Map<string, { total: number; count: number; students: number }>();
    for (const sub of subscriptions) {
      const row = bySub.get(sub.id);
      if (!row) continue;
      const prev = out.get(sub.sessionId);
      out.set(sub.sessionId, {
        total: money((prev?.total ?? 0) + row.total),
        count: (prev?.count ?? 0) + row.count,
        students: (prev?.students ?? 0) + row.students.size,
      });
    }
    return out;
  }, [db.payments, subscriptions]);

  const dayTariffs = useMemo(
    () =>
      dayTimings.map((s) => {
        const sub = subscriptions.find((x) => x.sessionId === s.id);
        const size = cycleSizeOf(sub);
        const seance = sub ? seancePriceOf(sub) : money(s.openPrice ?? 0);
        const school = sub ? schoolPerSeanceOf(sub) : seance;
        const teacher = sub ? teacherPerSeanceOf(sub) : 0;
        const { roster, marked } = progressOf(s);
        const collected = collectedBySession.get(s.id);
        return {
          session: s,
          sub,
          /** TOUT ce que cet emploi du temps a encaissé, depuis toujours. */
          collected: collected?.total ?? 0,
          collectedPayments: collected?.count ?? 0,
          priced: !!sub && (sub.monthlySeances ?? 0) > 0,
          size,
          monthPrice: monthlyPriceOf(sub),
          schoolMonth: sub ? schoolMonthShareOf(sub) : 0,
          teacherMonth: sub ? teacherMonthShareOf(sub) : 0,
          seance,
          school,
          teacher,
          roster,
          marked,
          // Ce que la journée a effectivement produit sur ce créneau.
          dayRevenue: money(marked * seance),
          daySchool: money(marked * school),
          dayTeacher: money(marked * teacher),
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dayTimings, subscriptions, progress, collectedBySession],
  );

  const dayTotals = dayTariffs.reduce(
    (acc, r) => ({
      revenue: money(acc.revenue + r.dayRevenue),
      school: money(acc.school + r.daySchool),
      teacher: money(acc.teacher + r.dayTeacher),
      collected: money(acc.collected + r.collected),
    }),
    { revenue: 0, school: 0, teacher: 0, collected: 0 },
  );

  const openSession = sessions.find((s) => s.id === openSessionId) ?? null;
  const openDow = JS_DAYS[new Date(`${openDate}T12:00:00`).getDay()];

  const openSheet = (s: ScheduleSession, on: string = date) => {
    // Un travailleur à qui l'on n'a pas ouvert la feuille de présence peut voir
    // la grille du jour sans pouvoir l'ouvrir : le clic ne fait alors rien.
    if (!can("open_presence")) {
      addToast({
        type: "danger",
        title: "Action non autorisée",
        message: "Votre compte n'a pas le droit d'ouvrir une feuille de présence.",
      });
      return;
    }
    setMonth(sessionCurrentMonthCode(db, s.id));
    setOpenDate(on);
    setOpenSessionId(s.id);
  };

  const openCreateFor = (subIds: string[]) => {
    setCreateSubIds(subIds);
    setCreateOpen(true);
  };

  // ---- the filter options, read off every emploi du temps -------------------
  const yearOptions = useMemo(
    () => [...new Set(classes.map((c) => c.year).filter(Boolean))].sort() as string[],
    [classes],
  );

  const filtersActive =
    search.trim().length > 0 ||
    classFilter !== "all" ||
    yearFilter !== "all" ||
    moduleFilter !== "all" ||
    teacherFilter !== "all";

  /** Every emploi du temps the search and the filters agree on — all days
   *  included, so a groupe se retrouve même s'il ne tourne pas aujourd'hui. */
  const matches = useMemo(() => {
    if (!filtersActive) return [] as ScheduleSession[];
    const q = search.trim().toLowerCase();
    return sessions
      .filter((s) => {
        if (s.archivedAt) return false;
        if (classFilter !== "all" && s.classId !== classFilter) return false;
        if (moduleFilter !== "all" && s.moduleId !== moduleFilter) return false;
        if (teacherFilter !== "all" && s.teacherId !== teacherFilter) return false;
        if (yearFilter !== "all") {
          const cls = classes.find((c) => c.id === s.classId);
          if ((cls?.year ?? "") !== yearFilter) return false;
        }
        if (!q) return true;
        const haystack = [
          sessionTitle(s),
          groupName(db, s.groupId),
          sessionSalleIds(s).map((id) => salleName(db, id)).join(" "),
          teacherName(db, s.teacherId),
          classes.find((c) => c.id === s.classId)?.name ?? "",
          formatDays(s.days),
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(q);
      })
      .sort((a, b) => {
        // Ce qui tourne le jour affiché passe devant : c'est ce que la
        // réception cherche neuf fois sur dix.
        const aToday = a.days.includes(dow) ? 0 : 1;
        const bToday = b.days.includes(dow) ? 0 : 1;
        if (aToday !== bToday) return aToday - bToday;
        return minutesOf(a.startTime) - minutesOf(b.startTime);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersActive, search, classFilter, yearFilter, moduleFilter, teacherFilter, sessions, classes, dow, db]);

  const clearFilters = () => {
    setSearch("");
    setClassFilter("all");
    setYearFilter("all");
    setModuleFilter("all");
    setTeacherFilter("all");
  };

  /** The day's grid: one row per créneau horaire, one column per salle. */
  const grid = useMemo(() => {
    const slotKeys = new Map<string, { start: string; end: string }>();
    const salleIds: string[] = [];
    const cells = new Map<string, ScheduleSession[]>();

    for (const s of dayTimings) {
      const { startTime, endTime } = sessionTimesOn(s, dow);
      const slot = `${startTime}|${endTime}`;
      if (!slotKeys.has(slot)) slotKeys.set(slot, { start: startTime, end: endTime });
      // La salle DU JOUR : un emploi qui tourne samedi en Salle A et mardi en
      // Salle B se range dans la bonne colonne chaque jour.
      const salleId = sessionSalleOn(s, dow) || "__none__";
      if (!salleIds.includes(salleId)) salleIds.push(salleId);
      const key = `${slot}::${salleId}`;
      const list = cells.get(key);
      if (list) list.push(s);
      else cells.set(key, [s]);
    }

    const slots = [...slotKeys.entries()]
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => minutesOf(a.start) - minutesOf(b.start));

    const salleLabel = (id: string) => (id === "__none__" ? "Sans salle" : salleName(db, id));
    const columns = salleIds
      .map((id) => ({ id, label: salleLabel(id) }))
      .sort((a, b) => (a.id === "__none__" ? 1 : b.id === "__none__" ? -1 : a.label.localeCompare(b.label)));

    return { slots, columns, cells };
  }, [dayTimings, dow, db]);

  // ---- caisse --------------------------------------------------------------
  const openCash = (kind: CashKind) => {
    setCashKind(kind);
    setCashAmount(0);
    setCashLabel("");
    setCashDate(todayIso);
  };

  const submitCash = () => {
    if (!cashKind) return;
    const amount = Math.max(0, Math.round(cashAmount || 0));
    if (amount <= 0 || !cashLabel.trim()) {
      addToast({
        type: "danger",
        title: "Saisie incomplète",
        message: "Indiquez un montant et une description.",
      });
      return;
    }
    if (cashKind === "expense") {
      // Une dépense est d'abord une dépense de l'école : elle est écrite dans
      // le registre des dépenses ET sortie de la caisse, exactement comme sur
      // l'écran Dépenses.
      push("expenses", {
        id: uid("exp"),
        name: cashLabel.trim(),
        categoryId: undefined,
        amount,
        date: cashDate,
      });
      push("cash", {
        id: uid("csh"),
        type: "expense",
        amount: -amount,
        date: `${cashDate}T${new Date().toISOString().slice(11)}`,
        description: `Dépense : ${cashLabel.trim()}`,
      });
    } else {
      cashMove(cashKind, amount, cashLabel.trim(), cashDate);
    }
    addToast({
      type: "success",
      title:
        cashKind === "deposit"
          ? "Dépôt enregistré"
          : cashKind === "withdraw"
            ? "Retrait enregistré"
            : "Dépense enregistrée",
      message: `${formatDA(amount)} — ${cashLabel.trim()}`,
    });
    setCashKind(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <PageHeader
          emoji="🏠"
          title="Tableau de Bord"
          subtitle="Emplois du temps du jour, fiches de présence et caisse"
        />
        <div className="flex flex-wrap gap-2">
          {isAdmin && <WorkerPaymentsAlert />}
          {can("create_student") && (
            <Button onClick={() => openCreateFor([])} className="gap-2">
              <UserPlus className="h-4 w-4" /> Nouvel élève
            </Button>
          )}
          {/* « Il en est où ? » — la question du parent au comptoir, tous ses
              emplois du temps dans un seul tableau, encaissement compris. */}
          {can("student_situation") && (
            <Button variant="outline" onClick={() => setSituationOpen(true)} className="gap-2">
              <UserSearch className="h-4 w-4 text-primary" /> Situation d&apos;un élève
            </Button>
          )}
          {/* Réimprimer le reçu d'un vieux versement : chercher l'élève, lire son
              historique du plus récent au plus ancien, et sortir le papier. */}
          {can("student_situation") && (
            <Button variant="outline" onClick={() => setPayPrintOpen(true)} className="gap-2">
              <Printer className="h-4 w-4 text-primary" /> Ancien paiement
            </Button>
          )}
          {can("cash_deposit") && (
            <Button variant="outline" onClick={() => openCash("deposit")} className="gap-2">
              <ArrowDownLeft className="h-4 w-4 text-success" /> Dépôt
            </Button>
          )}
          {can("cash_expense") && (
            <Button variant="outline" onClick={() => openCash("expense")} className="gap-2">
              <Receipt className="h-4 w-4 text-warning" /> Dépense
            </Button>
          )}
          {can("cash_withdraw") && (
            <Button variant="outline" onClick={() => openCash("withdraw")} className="gap-2">
              <ArrowUpRight className="h-4 w-4 text-danger" /> Retrait
            </Button>
          )}
        </div>
      </div>

      {/* L'argent encaissé par un travailleur barre l'écran de la direction
          tant qu'elle ne l'a pas lu : une cloche dans un coin se rate. */}
      {isAdmin && <WorkerPaymentsAlert variant="banner" />}

      {/* ---- search & filters ------------------------------------------- */}
      <Card className="border border-line card-shadow">
        <CardBody className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[240px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher un emploi du temps — module, groupe, salle, enseignant…"
                className="pl-9"
              />
            </div>
            <Select value={classFilter} onChange={(e) => setClassFilter(e.target.value)} className="min-w-[150px]">
              <option value="all">Toutes les classes</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {classLabel(db, c)}
                </option>
              ))}
            </Select>
            <Select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)} className="min-w-[120px]">
              <option value="all">Toutes les années</option>
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
            <Select value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)} className="min-w-[140px]">
              <option value="all">Tous les modules</option>
              {db.modules.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
            <Select value={teacherFilter} onChange={(e) => setTeacherFilter(e.target.value)} className="min-w-[160px]">
              <option value="all">Tous les enseignants</option>
              {db.teachers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.firstName} {t.lastName}
                </option>
              ))}
            </Select>
            {filtersActive && (
              <Button size="sm" variant="outline" onClick={clearFilters} className="gap-1.5">
                <X className="h-3.5 w-3.5" /> Effacer
              </Button>
            )}
          </div>

          {filtersActive && (
            <div className="space-y-2">
              <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-primary">
                <Filter className="h-3.5 w-3.5" /> {matches.length} emploi(s) du temps trouvé(s)
              </span>
              {matches.length === 0 ? (
                <p className="py-6 text-center text-xs italic text-muted">
                  Aucun emploi du temps ne correspond à cette recherche.
                </p>
              ) : (
                <div className="max-h-[320px] space-y-1.5 overflow-y-auto pr-1">
                  {matches.map((s, i) => {
                    const color = colorOf(s.id);
                    const runsToday = s.days.includes(dow);
                    const { startTime, endTime } = sessionTimesOn(s, runsToday ? dow : s.days[0]);
                    const { roster, marked } = runsToday
                      ? progressOf(s)
                      : { roster: 0, marked: 0 };
                    return (
                      <button
                        key={s.id}
                        autoFocus={i === 0}
                        onClick={() => openSheet(s)}
                        className={`flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-left transition-all hover:brightness-105 ${
                          i === 0 ? "ring-2 ring-primary/40" : ""
                        }`}
                        style={{ borderColor: `${color}66`, background: `${color}12` }}
                      >
                        <span className="min-w-0">
                          <strong className="block text-xs text-ink">
                            {i === 0 && (
                              <Badge tone="primary" className="mr-1.5 text-[9px]">
                                1er résultat
                              </Badge>
                            )}
                            {sessionTitle(s)}
                          </strong>
                          <span className="block text-[10px] text-muted">
                            Groupe {groupName(db, s.groupId)} ·{" "}
                            {salleName(db, sessionSalleOn(s, runsToday ? dow : s.days[0]))} ·{" "}
                            {teacherName(db, s.teacherId)}
                          </span>
                          <span className="block text-[10px] text-muted">
                            {formatDays(s.days) || "—"} ·{" "}
                            <span className="font-mono">
                              {startTime} → {endTime}
                            </span>
                            {!runsToday && " · pas programmé ce jour-là"}
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          {runsToday && (
                            <Badge tone={roster > 0 && marked >= roster ? "success" : "neutral"} className="font-mono text-[10px]">
                              <Users className="h-3 w-3" /> {marked}/{roster}
                            </Badge>
                          )}
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold" style={{ color }}>
                            Ouvrir <ChevronRight className="h-3.5 w-3.5" />
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </CardBody>
      </Card>

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

            <Badge tone={isToday ? "primary" : isPast ? "neutral" : "warning"} className="gap-1">
              <CalendarCheck className="h-3 w-3" />
              {DAY_LABELS_FR[dow]} {formatDateFr(date)}
              {isToday ? " · aujourd'hui" : isPast ? " · jour passé" : " · à venir"}
            </Badge>
          </div>

          {/* Avancement du pointage de la journée */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <ProgressTile
              icon={<Clock className="h-4 w-4" />}
              label="Créneaux du jour"
              value={String(dayTimings.length)}
              tone="text-ink"
            />
            <ProgressTile
              icon={<CheckCircle2 className="h-4 w-4" />}
              label="Présences faites"
              value={String(doneCount)}
              hint={startedCount > 0 ? `${startedCount} commencé(s)` : "emplois entièrement pointés"}
              tone="text-success"
            />
            <ProgressTile
              icon={<Hourglass className="h-4 w-4" />}
              label="Restent à pointer"
              value={String(remainingCount)}
              hint={remainingCount === 0 ? "journée terminée ✅" : "emplois du temps"}
              tone={remainingCount === 0 ? "text-success" : "text-warning"}
            />
            <ProgressTile
              icon={<Users className="h-4 w-4" />}
              label="Pointages écrits"
              value={String(dayMarks)}
              hint="élèves pointés ce jour-là"
              tone="text-primary"
            />
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
            <div className="overflow-x-auto rounded-2xl border border-line">
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <thead>
                  <tr className="bg-canvas/70">
                    <th className="w-[150px] border-b border-r border-line px-3 py-2.5 text-left text-[10px] uppercase tracking-wide text-muted">
                      Horaire
                    </th>
                    {grid.columns.map((col) => (
                      <th
                        key={col.id}
                        className="border-b border-r border-line px-3 py-2.5 text-center text-[10px] font-bold uppercase tracking-wide text-ink last:border-r-0"
                      >
                        🚪 {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {grid.slots.map((slot) => (
                    <tr key={slot.key} className="align-top">
                      <td className="border-b border-r border-line bg-canvas/40 px-3 py-3">
                        <span className="block font-mono text-xs font-bold text-ink">
                          {slot.start}
                        </span>
                        <span className="block text-[10px] text-muted">→ {slot.end}</span>
                      </td>
                      {grid.columns.map((col) => {
                        const list = grid.cells.get(`${slot.key}::${col.id}`) ?? [];
                        return (
                          <td
                            key={col.id}
                            className="border-b border-r border-line px-2 py-2 last:border-r-0"
                          >
                            {list.length === 0 ? (
                              <span className="block py-2 text-center text-[10px] text-muted/40">
                                —
                              </span>
                            ) : (
                              <div className="space-y-1.5">
                                {list.map((s) => {
                                  const color = colorOf(s.id);
                                  const { roster, marked, priced } = progressOf(s);
                                  const done = roster > 0 && marked >= roster;
                                  return (
                                    <button
                                      key={s.id}
                                      onClick={() => openSheet(s)}
                                      title={`${sessionTitle(s)} — ${teacherName(db, s.teacherId)}`}
                                      className="block w-full rounded-xl border-l-4 p-2 text-left transition-all hover:-translate-y-0.5 hover:shadow-md"
                                      style={{
                                        borderLeftColor: color,
                                        background: `${color}14`,
                                      }}
                                    >
                                      <strong
                                        className="block truncate text-[11px] font-bold"
                                        style={{ color }}
                                      >
                                        {sessionTitle(s)}
                                      </strong>
                                      <span className="block truncate text-[10px] text-muted">
                                        Gr. {sessionGroupsLabel(db, s)} ·{" "}
                                        {teacherName(db, s.teacherId)}
                                      </span>
                                      {/* Ce que ce groupe a rapporté depuis le
                                          premier jour : la question qui se pose
                                          en fin de mois, lisible sans ouvrir
                                          quoi que ce soit. */}
                                      <span className="block truncate font-mono text-[10px] font-bold text-success">
                                        {formatDA(collectedBySession.get(s.id)?.total ?? 0)} encaissés
                                      </span>
                                      <span className="mt-1 flex flex-wrap items-center gap-1">
                                        <Badge
                                          tone={done ? "success" : marked > 0 ? "warning" : "neutral"}
                                          className="gap-1 font-mono text-[9px]"
                                        >
                                          <Users className="h-2.5 w-2.5" />
                                          {marked}/{roster}
                                        </Badge>
                                        {s.isOpen && (
                                          <Badge tone="success" className="text-[9px]">
                                            Séance libre
                                          </Badge>
                                        )}
                                        {!priced && (
                                          <Badge tone="warning" className="text-[9px]">
                                            Sans tarif
                                          </Badge>
                                        )}
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="text-[10px] text-muted">
            Chaque emploi du temps porte sa couleur, la ligne donne son créneau horaire et la
            colonne sa salle. Un clic ouvre la feuille de présence de cette date.
          </p>

          {/* -------------------------------------------------------------
              LE COÛT D'UNE SÉANCE, EMPLOI PAR EMPLOI.

              Trois nombres sortent d'une seule division — le prix du mois par
              le nombre de séances qu'il contient : ce que l'élève paie, ce que
              l'école garde, ce qui revient à l'enseignant. Cette division ne
              tombe presque jamais juste (4 000 DA sur 3 séances = 1 333,33 DA),
              alors les montants gardent leur virgule : arrondis au dinar, ils
              faisaient dériver la paie de l'enseignant d'un mois sur l'autre.
              ------------------------------------------------------------- */}
          {dayTariffs.length > 0 && (
            <div className="space-y-2 rounded-2xl border border-primary/25 bg-primary-50/20 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-primary">
                  💰 Coût d&apos;une séance — emplois du temps du jour
                </span>
                <span className="flex flex-wrap gap-1.5">
                  <Badge tone="success" className="font-mono text-[10px]">
                    Encaissé aujourd&apos;hui {formatDA(dayTotals.revenue)}
                  </Badge>
                  <Badge tone="primary" className="font-mono text-[10px]">
                    Part école {formatDA(dayTotals.school)}
                  </Badge>
                  <Badge tone="warning" className="font-mono text-[10px]">
                    Part enseignants {formatDA(dayTotals.teacher)}
                  </Badge>
                  <Badge tone="primary" className="font-mono text-[10px]">
                    Total encaissé (tous mois) {formatDA(dayTotals.collected)}
                  </Badge>
                </span>
              </div>

              <div className="overflow-x-auto rounded-xl border border-line bg-surface">
                <table className="w-full min-w-[860px] text-[11px]">
                  <thead className="bg-canvas/60">
                    <tr className="text-left text-[9px] uppercase tracking-wide text-muted">
                      <th className="px-2 py-1.5">Emploi du temps</th>
                      <th className="px-2 py-1.5">Groupe(s)</th>
                      <th className="px-2 py-1.5 text-center">Mois</th>
                      <th className="px-2 py-1.5 text-right">Prix du mois</th>
                      <th className="px-2 py-1.5 text-right">Séance élève</th>
                      <th className="px-2 py-1.5 text-right">Part école / séance</th>
                      <th className="px-2 py-1.5 text-right">Part prof / séance</th>
                      <th className="px-2 py-1.5 text-center">Pointés</th>
                      <th className="px-2 py-1.5 text-right">Généré ce jour</th>
                      <th className="px-2 py-1.5 text-right">Total encaissé</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dayTariffs.map((r) => (
                      <tr key={r.session.id} className="border-t border-line/50">
                        <td className="px-2 py-1.5">
                          <strong className="text-ink">{sessionTitle(r.session)}</strong>
                          {!r.priced && (
                            <Badge tone="warning" className="ml-1.5 text-[8px]">
                              sans tarif mensuel
                            </Badge>
                          )}
                          <span className="block text-[9px] text-muted">
                            {teacherName(db, r.session.teacherId)}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 text-muted">
                          {sessionGroupsLabel(db, r.session)}
                        </td>
                        <td className="px-2 py-1.5 text-center font-mono text-muted">
                          {r.size} séance(s)
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono text-ink">
                          {formatDA(r.monthPrice)}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono font-bold text-primary">
                          {formatDA(r.seance)}
                          <span className="block text-[8px] font-normal text-muted">
                            {formatDA(r.monthPrice)} ÷ {r.size}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono text-ink">
                          {formatDA(r.school)}
                          <span className="block text-[8px] text-muted">
                            {formatDA(r.schoolMonth)} ÷ {r.size}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono font-bold text-warning">
                          {formatDA(r.teacher)}
                          <span className="block text-[8px] font-normal text-muted">
                            {formatDA(r.teacherMonth)} ÷ {r.size}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 text-center font-mono">
                          {r.marked}/{r.roster}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono font-black text-success">
                          {formatDA(r.dayRevenue)}
                          <span className="block text-[8px] font-normal text-muted">
                            dont {formatDA(r.dayTeacher)} au prof
                          </span>
                        </td>
                        {/* CE QUE CE GROUPE A RAPPORTÉ DEPUIS LE PREMIER JOUR —
                            tous mois confondus, tous versements confondus. */}
                        <td className="px-2 py-1.5 text-right font-mono font-black text-primary">
                          {formatDA(r.collected)}
                          <span className="block text-[8px] font-normal text-muted">
                            {r.collectedPayments} versement(s)
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-primary/30 bg-primary-50/40">
                      <td colSpan={8} className="px-2 py-2 text-right text-[10px] font-bold uppercase text-muted">
                        Total de la journée · total encaissé par ces emplois du temps
                      </td>
                      <td className="px-2 py-2 text-right font-mono text-sm font-black text-success">
                        {formatDA(dayTotals.revenue)}
                      </td>
                      <td className="px-2 py-2 text-right font-mono text-sm font-black text-primary">
                        {formatDA(dayTotals.collected)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <p className="text-[10px] leading-relaxed text-muted">
                <strong className="text-ink">« Total encaissé »</strong> est ce que cet emploi
                du temps a rapporté DEPUIS LE PREMIER JOUR : la somme de tous les versements de
                ses élèves, tous mois confondus — à ne pas confondre avec la recette du jour, qui
                ne compte que les séances pointées aujourd&apos;hui.
                <br />
                Prix d&apos;une séance = <strong className="text-ink">prix du mois ÷ séances du
                mois</strong>, décimales comprises. La part de l&apos;école et celle de
                l&apos;enseignant se divisent de la même façon : c&apos;est exactement ce que
                l&apos;élève paie et ce que l&apos;enseignant touche sur son écran de règlement.
              </p>
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
                {DAY_LABELS_FR[openDow]} {formatDateFr(openDate)}
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
              date={openDate}
              monthCode={month}
              onMonthChange={setMonth}
              canMark={can("mark_presence")}
              canCollect={can("collect_payment")}
              onCreateStudent={() => {
                const sub = db.subscriptions.find((x) => x.sessionId === openSession.id);
                openCreateFor(sub ? [sub.id] : []);
              }}
            />
          </div>
        </Modal>
      )}

      {/* Situation d'un élève : tous ses emplois du temps, mois par mois, avec
          l'encaissement sur place */}
      {situationOpen && (
        <StudentSituationModal
          onClose={() => setSituationOpen(false)}
          canCollect={can("collect_payment")}
        />
      )}

      {/* Imprimer un ancien paiement : recherche d'élève + historique + reçu */}
      {payPrintOpen && <StudentPaymentsPrintModal onClose={() => setPayPrintOpen(false)} />}

      {/* Caisse — dépôt / dépense / retrait, la même saisie que l'écran Caisse */}
      {cashKind && (
        <Modal
          open
          onClose={() => setCashKind(null)}
          title={
            cashKind === "deposit"
              ? "Nouveau dépôt en caisse"
              : cashKind === "withdraw"
                ? "Nouveau retrait de caisse"
                : "Nouvelle dépense"
          }
        >
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-semibold text-muted">
                Montant (DA) *
              </label>
              <Input
                type="number"
                min={0}
                autoFocus
                value={cashAmount || ""}
                onChange={(e) => setCashAmount(Number(e.target.value) || 0)}
                placeholder="Ex: 10000"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-muted">Description *</label>
              <Input
                value={cashLabel}
                onChange={(e) => setCashLabel(e.target.value)}
                placeholder={
                  cashKind === "deposit"
                    ? "Ex: Fonds de roulement"
                    : cashKind === "withdraw"
                      ? "Ex: Retrait pour banque"
                      : "Ex: Achat de fournitures"
                }
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-muted">Date *</label>
              <Input type="date" value={cashDate} onChange={(e) => setCashDate(e.target.value)} />
            </div>
            <div className="flex items-center justify-between rounded-xl border border-line bg-canvas/40 p-3">
              <span className="flex items-center gap-1.5 text-[11px] text-muted">
                <Wallet className="h-3.5 w-3.5" />
                {cashKind === "deposit"
                  ? "Entrée de caisse"
                  : cashKind === "withdraw"
                    ? "Sortie de caisse"
                    : "Sortie de caisse + ligne dans les dépenses"}
              </span>
              <strong
                className={`font-mono text-sm ${cashKind === "deposit" ? "text-success" : "text-danger"}`}
              >
                {cashKind === "deposit" ? "+" : "−"} {formatDA(Math.max(0, cashAmount || 0))}
              </strong>
            </div>
            <div className="flex justify-end gap-2 border-t border-line pt-3">
              <Button variant="outline" onClick={() => setCashKind(null)}>
                Annuler
              </Button>
              <Button onClick={submitCash} variant={cashKind === "deposit" ? "primary" : "danger"}>
                Confirmer
              </Button>
            </div>
          </div>
        </Modal>
      )}

      <CreateStudentModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        defaultSubIds={createSubIds}
        joinDate={date}
      />
    </div>
  );
}

function ProgressTile({
  icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  tone: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-canvas/50 p-3">
      <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted">
        <span className={tone}>{icon}</span>
        {label}
      </span>
      <strong className={`mt-0.5 block font-mono text-xl ${tone}`}>{value}</strong>
      {hint && <span className="block text-[10px] text-muted">{hint}</span>}
    </div>
  );
}
