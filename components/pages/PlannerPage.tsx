"use client";

import { useMemo, useState } from "react";
import { useData, uid } from "@/lib/store/data";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { Input, Select } from "@/components/ui/SearchInput";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  Trash2,
  Edit,
  Eye,
  Plus,
  Calendar as CalendarIcon,
  User,
  MapPin,
  Users,
  Clock,
  Filter,
  Printer,
  Search,
  Sparkles,
  X
} from "lucide-react";
import type { DayTime, ScheduleSession, Day, Subscription, Teacher } from "@/lib/types";
import {
  activeSessions,
  clashingDays,
  formatDays,
  isFreeSub,
  minutesOf,
  monthlyPriceOf,
  schoolMonthShareOf,
  schoolPerSeanceOf,
  isMultiLevelSession,
  sessionClassIds,
  sessionGroupIds,
  sessionGroupsOfClass,
  sessionSalleIds,
  sessionSalleOn,
  sessionTimeLabel,
  sessionTimesOn,
  soldFor,
  teacherMonthShareOf,
  teacherPerSeanceOf,
} from "@/lib/helpers";
import { formatDA, money, positiveMoney } from "@/lib/utils";
import { formatDateFr } from "@/lib/helpers";
import { printHtmlDocument } from "@/lib/print";
import {
  bannerHtml,
  letterheadHtml,
  metaFooterHtml,
  printDocument,
  signaturesHtml,
} from "@/lib/printTemplates";
import { useSettings } from "@/lib/store/settings";

import { useCan } from "@/lib/usePermissions";
const PRINT_LABELS = {
  fr: {
    docTitle: "Emploi du Temps — Fiche de Séance",
    printedOn: (d: string) => `Imprimé le ${d}`,
    infoTitle: "Informations de la Séance",
    tableTitle: "Horaires Détaillés",
    day: "Jour",
    time: "Horaire (début – fin)",
    module: "Module / Matière",
    group: "Groupe",
    classLevel: "Classe / Niveau",
    teacher: "Enseignant",
    salle: "Salle",
    enrolled: "Élèves inscrits",
    signDirection: "La Direction",
    signTeacher: "L'Enseignant",
    days: {
      saturday: "Samedi", sunday: "Dimanche", monday: "Lundi", tuesday: "Mardi",
      wednesday: "Mercredi", thursday: "Jeudi", friday: "Vendredi",
    } as Record<Day, string>,
  },
  ar: {
    docTitle: "جدول التوقيت — بطاقة الحصة",
    printedOn: (d: string) => `طُبع بتاريخ ${d}`,
    infoTitle: "معلومات الحصة",
    tableTitle: "التوقيت المفصّل",
    day: "اليوم",
    time: "التوقيت (البداية – النهاية)",
    module: "المادة",
    group: "الفوج",
    classLevel: "القسم / المستوى",
    teacher: "الأستاذ",
    salle: "القاعة",
    enrolled: "التلاميذ المسجلون",
    signDirection: "الإدارة",
    signTeacher: "الأستاذ",
    days: {
      saturday: "السبت", sunday: "الأحد", monday: "الإثنين", tuesday: "الثلاثاء",
      wednesday: "الأربعاء", thursday: "الخميس", friday: "الجمعة",
    } as Record<Day, string>,
  },
} as const;

const WEEKDAYS: { key: Day; label: string }[] = [
  { key: "saturday", label: "Samedi" },
  { key: "sunday", label: "Dimanche" },
  { key: "monday", label: "Lundi" },
  { key: "tuesday", label: "Mardi" },
  { key: "wednesday", label: "Mercredi" },
  { key: "thursday", label: "Jeudi" },
  { key: "friday", label: "Vendredi" },
];

export function PlannerPage() {
  const can = useCan("planner");
  const db = useData();
  const {
    school,
    classes,
    modules,
    groups,
    salles,
    teachers,
    students,
    subscriptions,
    push,
    updateItem,
    setSubscriptionPrice,
    archiveSession,
  } = db;
  /**
   * La grille ne montre QUE les emplois du temps vivants. Un emploi supprimé est
   * archivé, pas effacé : sa ligne reste en base pour que les présences, les
   * soldes, les paiements et les parts d'enseignant qu'il porte gardent un nom
   * sur les écrans d'historique — mais il n'a plus rien à faire sur un
   * calendrier qui sert à organiser la semaine à venir.
   */
  const sessions = useMemo(() => activeSessions(db), [db.sessions]);
  const { language } = useSettings();

  // View mode toggle
  const [viewMode, setViewMode] = useState<"calendar" | "cards">("calendar");

  // Filters
  const [filterSessionId, setFilterSessionId] = useState("");
  const [filterTeacherId, setFilterTeacherId] = useState("");
  const [filterSalleId, setFilterSalleId] = useState("");
  const [filterClassId, setFilterClassId] = useState("");

  // Modal states
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [selectedSession, setSelectedSession] = useState<ScheduleSession | null>(null);

  // Form states
  const [title, setTitle] = useState("");
  const [classId, setClassId] = useState("");
  const [moduleId, setModuleId] = useState("");
  /**
   * LES GROUPES DE L'EMPLOI DU TEMPS — plusieurs, pas un seul.
   *
   * Un même créneau réunit souvent deux demi-groupes : même module, même
   * enseignant, même salle, même heure. `groupIds` porte la liste complète et
   * `groupId` (la colonne historique) garde le PREMIER, pour que le scan, la
   * feuille de présence et la base continuent de lire un groupe sans rien
   * savoir de la nouveauté.
   */
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [groupSearch, setGroupSearch] = useState("");
  /**
   * UN EMPLOI DU TEMPS SUR PLUSIEURS NIVEAUX.
   *
   * Le même créneau réunit parfois deux classes qui n'ont rien à voir — la 4e
   * année moyenne et la 3e année secondaire — chacune avec SES groupes. Le
   * formulaire bascule alors : au lieu d'une classe et d'une liste de groupes,
   * il demande les classes, puis les groupes DE CHAQUE classe.
   *
   * `classGroupMap` porte cette association, et c'est elle qui est enregistrée.
   * Le reste de l'application n'a rien à savoir de la nouveauté : `classId`
   * garde la première classe, `groupIds` l'union de tous les groupes.
   */
  const [multiLevel, setMultiLevel] = useState(false);
  const [classGroupMap, setClassGroupMap] = useState<Record<string, string[]>>({});
  /** Les classes du créneau, dans l'ordre où elles ont été cochées. */
  const [multiClassIds, setMultiClassIds] = useState<string[]>([]);
  /** Tous les groupes du créneau : ceux des classes en multi-niveaux, sinon la
   *  liste simple. C'est ce que la base enregistre en `group_ids`. */
  const effectiveGroupIds = multiLevel
    ? [...new Set(multiClassIds.flatMap((cid) => classGroupMap[cid] ?? []))]
    : groupIds;
  const groupId = effectiveGroupIds[0] ?? "";
  /** Les classes du créneau — une seule hors multi-niveaux. */
  const effectiveClassIds = multiLevel ? multiClassIds : classId ? [classId] : [];
  const [salleId, setSalleId] = useState("");
  const [teacherId, setTeacherId] = useState("");
  const [selectedDays, setSelectedDays] = useState<Day[]>([]);
  /**
   * The hours of EACH selected day, keyed by day. An emploi may run Samedi
   * 08:00–10:00 and Mardi 14:00–16:00, so the desk sets a pair per day as soon
   * as it picks more than one. A single day still reads as one simple pair.
   */
  const [dayTimes, setDayTimes] = useState<Partial<Record<Day, DayTime>>>({});
  /**
   * The salle of EACH selected day. One day = one room, chosen in the ordinary
   * list. Several days = one room PER day, because a group is rarely given the
   * same room Samedi matin and Mardi après-midi.
   */
  const [daySalles, setDaySalles] = useState<Partial<Record<Day, string>>>({});
  /** Recherche de l'enseignant par son nom, plutôt qu'une liste déroulante. */
  const [teacherSearch, setTeacherSearch] = useState("");

  // ---- Tarification mensuelle de l'emploi du temps ------------------------
  // The desk gives TWO figures — the séances a month contains and what that
  // month costs — and everything else falls out of them: the price of one
  // séance, what the school keeps, what is left for the teacher, and what the
  // teacher earns per séance.
  const [monthSeances, setMonthSeances] = useState<number>(0);
  const [monthPrice, setMonthPrice] = useState<number>(0);
  const [schoolShare, setSchoolShare] = useState<number>(0);

  /**
   * LE PRIX D'UNE SÉANCE GARDE SES DÉCIMALES.
   *
   * Un mois à 4 000 DA sur 3 séances vaut 1 333,33 DA la séance — pas 1 333. Et
   * si l'école en garde 2 200, il reste 1 800 DA à l'enseignant, soit 600 DA
   * par séance sur 3, mais 257,14 DA sur 7. Arrondir chaque division à l'entier
   * faisait perdre ou gagner quelques dinars à chaque présence, et l'écart se
   * voyait sur la paie du mois.
   */
  const pricePerSeance = monthSeances > 0 ? money(monthPrice / monthSeances) : 0;
  const teacherShare = positiveMoney(monthPrice - schoolShare);
  const teacherPerSeance = monthSeances > 0 ? money(teacherShare / monthSeances) : 0;
  const schoolPerSeance =
    monthSeances > 0 ? money(Math.min(schoolShare, monthPrice) / monthSeances) : 0;

  const resetPricing = () => {
    setMonthSeances(0);
    setMonthPrice(0);
    setSchoolShare(0);
  };

  /** Un montant saisi à la main : les décimales sont acceptées (1 333,33). */
  const readMoney = (value: string) => positiveMoney(Number(value.replace(",", ".")) || 0);

  /** Writes the tariff of the emploi du temps (and of every group of the same
   *  cours) once the créneau itself is saved. */
  const savePricing = (sessionId: string) => {
    if (monthSeances <= 0 || monthPrice <= 0) return;
    void setSubscriptionPrice(sessionId, pricePerSeance, {
      monthlySeances: monthSeances,
      monthlyPrice: monthPrice,
      schoolMonthShare: Math.min(schoolShare, monthPrice),
      teacherPerSeance,
    });
  };

  // Inline creations
  const [newModuleName, setNewModuleName] = useState("");
  const [showAddModule, setShowAddModule] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [showAddGroup, setShowAddGroup] = useState(false);
  const [newSalleName, setNewSalleName] = useState("");
  const [showAddSalle, setShowAddSalle] = useState(false);

  // ---- Séance libre (créneau ouvert) --------------------------------------
  const [isOpenSeanceModalOpen, setIsOpenSeanceModalOpen] = useState(false);
  const [editingOpenSession, setEditingOpenSession] = useState<ScheduleSession | null>(null);
  const [openModuleId, setOpenModuleId] = useState("");
  const [openClassIds, setOpenClassIds] = useState<string[]>([]);
  const [openGroupIds, setOpenGroupIds] = useState<string[]>([]);
  const [openSalleIds, setOpenSalleIds] = useState<string[]>([]);
  const [openPeriodStart, setOpenPeriodStart] = useState("");
  const [openPeriodEnd, setOpenPeriodEnd] = useState("");
  const [openDays, setOpenDays] = useState<Day[]>([]);
  const [openStartHour, setOpenStartHour] = useState("08");
  const [openStartMin, setOpenStartMin] = useState("00");
  const [openEndHour, setOpenEndHour] = useState("10");
  const [openEndMin, setOpenEndMin] = useState("00");
  const [openPrice, setOpenPrice] = useState<number>(0);
  // teacher: pick an existing one, or type a "passager" who has no account
  const [openTeacherMode, setOpenTeacherMode] = useState<"existing" | "passager">("existing");
  const [openTeacherSearch, setOpenTeacherSearch] = useState("");
  const [openTeacherId, setOpenTeacherId] = useState("");
  const [openPassagerName, setOpenPassagerName] = useState("");
  const [openPassagerPhone, setOpenPassagerPhone] = useState("");
  const [openTitleOverride, setOpenTitleOverride] = useState("");
  const [savingOpenSeance, setSavingOpenSeance] = useState(false);
  // "Vue" filter: all timings / regular courses only / séances libres only
  const [kindFilter, setKindFilter] = useState<"all" | "cours" | "open">("all");

  // Helper: consistent coloring by module ID
  const getSessionColor = (modId: string) => {
    let hash = 0;
    for (let i = 0; i < modId.length; i++) {
      hash = modId.charCodeAt(i) + ((hash << 5) - hash);
    }
    const colors = [
      "border-l-4 border-l-blue-500 bg-blue-50/70 text-blue-900 dark:bg-blue-950/20 dark:text-blue-200 border-blue-100",
      "border-l-4 border-l-emerald-500 bg-emerald-50/70 text-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-200 border-emerald-100",
      "border-l-4 border-l-amber-500 bg-amber-50/70 text-amber-900 dark:bg-amber-950/20 dark:text-amber-200 border-amber-100",
      "border-l-4 border-l-rose-500 bg-rose-50/70 text-rose-900 dark:bg-rose-950/20 dark:text-rose-200 border-rose-100",
      "border-l-4 border-l-purple-500 bg-purple-50/70 text-purple-900 dark:bg-purple-950/20 dark:text-purple-200 border-purple-100",
      "border-l-4 border-l-cyan-500 bg-cyan-50/70 text-cyan-900 dark:bg-cyan-950/20 dark:text-cyan-200 border-cyan-100",
      "border-l-4 border-l-indigo-500 bg-indigo-50/70 text-indigo-900 dark:bg-indigo-950/20 dark:text-indigo-200 border-indigo-100",
    ];
    return colors[Math.abs(hash) % colors.length];
  };

  // Helpers
  const getClassName = (cid: string) => {
    const cls = classes.find((c) => c.id === cid);
    if (!cls) return "-";
    const lvl = cls.type === "cours" ? cls.coursLevel : cls.formationLevel;
    return `${cls.name} (${lvl})`;
  };

  const getModuleName = (mid: string) => modules.find((m) => m.id === mid)?.name ?? "-";
  const getGroupName = (gid: string) => groups.find((g) => g.id === gid)?.name ?? "-";
  const getSalleName = (sid: string) => salles.find((s) => s.id === sid)?.name ?? "-";
  const getTeacherName = (tid: string) => {
    const t = teachers.find((te) => te.id === tid);
    return t ? `${t.firstName} ${t.lastName}` : "-";
  };

  const DEFAULT_DAY_TIME: DayTime = { startTime: "08:00", endTime: "10:00" };

  /**
   * Picking a day opens its own pair of hours; unpicking it takes them away.
   * A new day starts from the hours already set (the previous day's, or the
   * default), so a week of identical créneaux is one click per day.
   */
  const toggleDay = (day: Day) => {
    if (selectedDays.includes(day)) {
      setSelectedDays(selectedDays.filter((d) => d !== day));
      setDayTimes((prev) => {
        const next = { ...prev };
        delete next[day];
        return next;
      });
      setDaySalles((prev) => {
        const next = { ...prev };
        delete next[day];
        return next;
      });
      return;
    }
    const template = selectedDays.length
      ? dayTimes[selectedDays[selectedDays.length - 1]] ?? DEFAULT_DAY_TIME
      : DEFAULT_DAY_TIME;
    setSelectedDays([...selectedDays, day]);
    setDayTimes((prev) => ({ ...prev, [day]: { ...template } }));
  };

  /** Sets one end of one day's créneau. */
  const setDayTime = (day: Day, key: keyof DayTime, value: string) =>
    setDayTimes((prev) => ({
      ...prev,
      [day]: { ...(prev[day] ?? DEFAULT_DAY_TIME), [key]: value },
    }));

  /** Copies the first day's hours onto every other selected day. */
  const applyFirstDayToAll = () => {
    const first = selectedDays[0];
    if (!first) return;
    const model = dayTimes[first] ?? DEFAULT_DAY_TIME;
    setDayTimes(Object.fromEntries(selectedDays.map((d) => [d, { ...model }])));
  };

  /** The selected days, in the school's week order rather than the click order. */
  const orderedDays = useMemo(
    () => WEEKDAYS.map((w) => w.key).filter((d) => selectedDays.includes(d)),
    [selectedDays],
  );

  /** A day is settled once its two hours are set and the end follows the start. */
  const dayTimeValid = (day: Day) => {
    const t = dayTimes[day];
    return !!t?.startTime && !!t?.endTime && minutesOf(t.endTime) > minutesOf(t.startTime);
  };

  /** Every selected day carries a coherent créneau — what unlocks the salle. */
  const timingReady = selectedDays.length > 0 && orderedDays.every(dayTimeValid);

  /** The days whose end hour does not follow their start — flagged inline. */
  const invalidDays = orderedDays.filter((d) => dayTimes[d] && !dayTimeValid(d));

  /** What the form currently describes, in the shape the clash check expects. */
  const draftTiming = useMemo(() => {
    const first = orderedDays[0];
    const base = (first && dayTimes[first]) || DEFAULT_DAY_TIME;
    return {
      days: orderedDays,
      startTime: base.startTime,
      endTime: base.endTime,
      dayTimes,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderedDays, dayTimes]);

  /**
   * Salle availability for the créneaux currently on screen.
   *
   * A salle is taken when another emploi du temps already occupies it on one of
   * the selected days at an overlapping hour. Ends that merely touch (10:00 /
   * 10:00) do not clash — the room frees exactly as the next cours starts.
   */
  interface SalleAvailability {
    id: string;
    name: string;
    free: boolean;
    /** the emplois already in that salle on those créneaux */
    clashes: { sessionId: string; label: string; days: Day[]; timeLabel: string }[];
  }

  /**
   * Availability of every salle, for ONE day or for the whole draft.
   *
   * Passing a day narrows the check twice over: only that day's créneau is
   * compared, and only against the emplois that hold that salle THAT day — an
   * emploi in Salle A on Samedi leaves Salle A free on Mardi.
   */
  const availabilityFor = (day?: Day): SalleAvailability[] => {
    const editingId = selectedSession?.id;
    const draft = day
      ? { ...draftTiming, days: draftTiming.days.filter((d) => d === day) }
      : draftTiming;
    return salles.map((salle) => {
      const clashes = sessions
        .filter((other) => other.id !== editingId)
        .filter((other) => sessionSalleIds(other).includes(salle.id))
        .map((other) => ({ other, days: clashingDays(draft, other, salle.id) }))
        .filter(({ days }) => days.length > 0)
        .map(({ other, days }) => ({
          sessionId: other.id,
          label: other.title || getModuleName(other.moduleId),
          days,
          timeLabel: days
            .map((d) => {
              const { startTime, endTime } = sessionTimesOn(other, d);
              return `${startTime}–${endTime}`;
            })
            .filter((v, i, a) => a.indexOf(v) === i)
            .join(" · "),
        }));
      return { id: salle.id, name: salle.name, free: clashes.length === 0, clashes };
    });
  };

  const salleAvailability = useMemo<SalleAvailability[]>(
    () => availabilityFor(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [salles, sessions, draftTiming, selectedSession],
  );

  const freeSalleCount = salleAvailability.filter((s) => s.free).length;

  /** Sets the room of ONE day; a single-day emploi keeps `salleId` in step. */
  const setDaySalle = (day: Day, id: string) =>
    setDaySalles((prev) => ({ ...prev, [day]: id }));

  /** Copies the first day's room onto every other selected day. */
  const applyFirstSalleToAll = () => {
    const first = orderedDays[0];
    if (!first) return;
    const model = daySalles[first] ?? salleId;
    if (!model) return;
    setDaySalles(Object.fromEntries(orderedDays.map((d) => [d, model])));
  };

  /** The days still waiting for a room — what the save button warns about. */
  const daysWithoutSalle = orderedDays.filter((d) => !(daySalles[d] || salleId));

  /**
   * LE CHOIX DES GROUPES — plusieurs cases à cocher, pas une liste déroulante.
   *
   * Un emploi du temps peut réunir deux demi-groupes sur le même créneau. Le
   * champ se cherche par le nom quand l'école en compte beaucoup, et le premier
   * groupe coché reste celui que la base garde en colonne `group_id`.
   */
  const renderGroupField = () => {
    const q = groupSearch.trim().toLowerCase();
    const shown = q ? groups.filter((g) => g.name.toLowerCase().includes(q)) : groups;
    return (
      <div>
        <div className="mb-1 flex items-center justify-between">
          <label className="block text-xs font-semibold text-muted font-sans">
            Groupe(s){" "}
            <span className="text-[10px] font-normal text-muted">
              — plusieurs groupes possibles
            </span>
          </label>
          <button
            onClick={() => setShowAddGroup(!showAddGroup)}
            className="text-xs text-primary hover:underline"
          >
            + Nouveau groupe
          </button>
        </div>

        {showAddGroup && (
          <div className="mb-2 flex gap-2">
            <Input
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              placeholder="Nom du groupe (ex: Groupe C)"
              className="flex-1"
            />
            <Button size="sm" onClick={handleCreateGroup}>
              Créer
            </Button>
          </div>
        )}

        {groups.length > 6 && (
          <div className="relative mb-2">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
            <Input
              value={groupSearch}
              onChange={(e) => setGroupSearch(e.target.value)}
              placeholder="Rechercher un groupe…"
              className="pl-9"
            />
          </div>
        )}

        <div className="max-h-40 space-y-1 overflow-y-auto rounded-xl border border-line bg-canvas/30 p-2">
          {shown.length === 0 ? (
            <p className="p-1.5 text-[11px] italic text-muted">
              Aucun groupe — créez-en un avec « + Nouveau groupe ».
            </p>
          ) : (
            shown.map((g) => {
              const picked = groupIds.includes(g.id);
              const first = groupIds[0] === g.id;
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => toggleGroup(g.id)}
                  className={`flex w-full items-center justify-between rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
                    picked
                      ? "border-primary bg-primary text-white"
                      : "border-line bg-surface text-ink hover:bg-primary-50"
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5" /> {g.name}
                    {first && groupIds.length > 1 && (
                      <span className="rounded bg-white/25 px-1 py-0.5 text-[8px] font-bold">
                        principal
                      </span>
                    )}
                  </span>
                  <input type="checkbox" checked={picked} readOnly className="h-3.5 w-3.5" />
                </button>
              );
            })
          )}
        </div>

        <p className="mt-1 text-[10px] text-muted">
          {groupIds.length === 0
            ? "Aucun groupe coché — l'emploi du temps peut être créé et complété plus tard."
            : `${groupIds.length} groupe(s) : ${groupIds.map(getGroupName).join(" · ")}.`}
        </p>
      </div>
    );
  };

  /**
   * LE CHOIX DES NIVEAUX ET DE LEURS GROUPES.
   *
   * Un emploi du temps ordinaire porte une classe et ses groupes. Celui-ci peut
   * en porter plusieurs : on coche « 4e année moyenne » et « 3e année
   * secondaire », et chaque niveau ouvre SA propre liste de groupes. Les deux
   * niveaux partagent l'heure, la salle et l'enseignant — c'est bien un seul
   * créneau — mais chacun amène les siens.
   */
  const toggleMultiClass = (id: string) =>
    setMultiClassIds((prev) => {
      if (prev.includes(id)) {
        setClassGroupMap((map) => {
          const next = { ...map };
          delete next[id];
          return next;
        });
        return prev.filter((c) => c !== id);
      }
      return [...prev, id];
    });

  /** Coche / décoche un groupe SUR UNE CLASSE précise. */
  const toggleClassGroup = (cid: string, gid: string) =>
    setClassGroupMap((prev) => {
      const current = prev[cid] ?? [];
      return {
        ...prev,
        [cid]: current.includes(gid)
          ? current.filter((g) => g !== gid)
          : [...current, gid],
      };
    });

  /** Crée un groupe et l'affecte tout de suite au niveau qui le demande. */
  const handleCreateGroupForClass = (cid: string) => {
    if (!newGroupName.trim()) return;
    const newId = uid("grp");
    push("groups", { id: newId, name: newGroupName });
    toggleClassGroup(cid, newId);
    setNewGroupName("");
    setShowAddGroup(false);
  };

  const renderLevelsField = () => {
    const q = groupSearch.trim().toLowerCase();
    const shownGroups = q ? groups.filter((g) => g.name.toLowerCase().includes(q)) : groups;
    return (
      <div className="space-y-3 rounded-xl border border-primary/25 bg-primary-50/25 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-primary">
            🎓 Niveaux &amp; groupes du créneau
          </span>
          <button
            type="button"
            onClick={() => setShowAddGroup(!showAddGroup)}
            className="text-xs text-primary hover:underline"
          >
            + Nouveau groupe
          </button>
        </div>

        <p className="text-[10px] leading-relaxed text-muted">
          Cochez chaque niveau réuni sur ce créneau, puis les groupes que ce niveau amène. Ils
          partagent l&apos;heure, la salle et l&apos;enseignant — c&apos;est un seul emploi du
          temps — mais chacun garde ses propres groupes.
        </p>

        {classes.length === 0 ? (
          <p className="text-[11px] italic text-muted">
            Aucune classe — créez-en depuis l&apos;écran Classes.
          </p>
        ) : (
          <div className="max-h-32 space-y-1 overflow-y-auto rounded-lg border border-line bg-surface p-2">
            {classes.map((c) => {
              const picked = multiClassIds.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggleMultiClass(c.id)}
                  className={`flex w-full items-center justify-between rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
                    picked
                      ? "border-primary bg-primary text-white"
                      : "border-line bg-surface text-ink hover:bg-primary-50"
                  }`}
                >
                  <span>
                    {c.name}{" "}
                    <span className="opacity-70">
                      ({c.type === "cours" ? c.coursLevel : c.formationLevel})
                    </span>
                  </span>
                  <input type="checkbox" checked={picked} readOnly className="h-3.5 w-3.5" />
                </button>
              );
            })}
          </div>
        )}

        {showAddGroup && multiClassIds.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <Input
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              placeholder="Nom du groupe (ex: Groupe C)"
              className="min-w-[160px] flex-1"
            />
            <Select
              value=""
              onChange={(e) => e.target.value && handleCreateGroupForClass(e.target.value)}
              className="w-44"
            >
              <option value="">Créer pour le niveau…</option>
              {multiClassIds.map((cid) => (
                <option key={cid} value={cid}>
                  {getClassName(cid)}
                </option>
              ))}
            </Select>
          </div>
        )}

        {groups.length > 6 && multiClassIds.length > 0 && (
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
            <Input
              value={groupSearch}
              onChange={(e) => setGroupSearch(e.target.value)}
              placeholder="Rechercher un groupe…"
              className="pl-9"
            />
          </div>
        )}

        {multiClassIds.length === 0 ? (
          <p className="rounded-lg border border-warning/40 bg-warning/10 p-2 text-[10px] text-warning">
            Aucun niveau coché — cochez-en au moins un, sinon le créneau ne concerne personne.
          </p>
        ) : (
          <div className="space-y-2">
            {multiClassIds.map((cid) => {
              const picked = classGroupMap[cid] ?? [];
              return (
                <div key={cid} className="rounded-xl border border-line bg-surface p-2.5">
                  <div className="mb-1.5 flex flex-wrap items-center justify-between gap-1.5">
                    <strong className="text-[11px] text-ink">{getClassName(cid)}</strong>
                    <Badge tone={picked.length > 0 ? "primary" : "warning"} className="text-[9px]">
                      {picked.length} groupe(s)
                    </Badge>
                  </div>
                  {shownGroups.length === 0 ? (
                    <p className="text-[10px] italic text-muted">
                      Aucun groupe — créez-en un avec « + Nouveau groupe ».
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {shownGroups.map((g) => {
                        const on = picked.includes(g.id);
                        return (
                          <button
                            key={g.id}
                            type="button"
                            onClick={() => toggleClassGroup(cid, g.id)}
                            className={`rounded-lg border px-2 py-1 text-[10px] font-semibold transition-colors ${
                              on
                                ? "border-primary bg-primary text-white"
                                : "border-line bg-canvas text-ink hover:bg-primary-50"
                            }`}
                          >
                            {g.name}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <p className="text-[10px] text-muted">
          {effectiveGroupIds.length === 0
            ? "Aucun groupe coché — l'emploi du temps peut être créé et complété plus tard."
            : `${multiClassIds.length} niveau(x) · ${effectiveGroupIds.length} groupe(s) : ${effectiveGroupIds
                .map(getGroupName)
                .join(" · ")}.`}
        </p>
      </div>
    );
  };

  /** Le bandeau qui bascule entre « un seul niveau » et « plusieurs niveaux ». */
  const renderLevelModeSwitch = () => (
    <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-line bg-canvas/40 p-1.5">
      <button
        type="button"
        onClick={() => setMultiLevel(false)}
        className={`flex-1 rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition-colors ${
          !multiLevel ? "bg-primary text-white" : "text-muted hover:bg-primary-50"
        }`}
      >
        Un seul niveau
      </button>
      <button
        type="button"
        onClick={() => {
          setMultiLevel(true);
          // On repart de ce qui est déjà saisi : la classe choisie devient le
          // premier niveau, avec ses groupes.
          setMultiClassIds((prev) => (prev.length > 0 ? prev : classId ? [classId] : []));
          setClassGroupMap((prev) =>
            Object.keys(prev).length > 0 || !classId ? prev : { [classId]: groupIds },
          );
        }}
        className={`flex-1 rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition-colors ${
          multiLevel ? "bg-primary text-white" : "text-muted hover:bg-primary-50"
        }`}
      >
        Plusieurs niveaux
      </button>
    </div>
  );

  const handleCreateModule = () => {
    if (!newModuleName.trim()) return;
    const newId = uid("mod");
    push("modules", { id: newId, name: newModuleName });
    setModuleId(newId);
    setNewModuleName("");
    setShowAddModule(false);
  };

  const handleCreateGroup = () => {
    if (!newGroupName.trim()) return;
    const newId = uid("grp");
    push("groups", { id: newId, name: newGroupName });
    setGroupIds((prev) => [...prev, newId]);
    setNewGroupName("");
    setShowAddGroup(false);
  };

  /** Cocher / décocher un groupe de l'emploi du temps. */
  const toggleGroup = (id: string) =>
    setGroupIds((prev) => (prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id]));

  /**
   * Deux salles ne peuvent pas porter le même nom : l'écran choisit une salle
   * PAR SON NOM, et deux « Salle 3 » rendraient ce choix indécidable — la
   * disponibilité afficherait deux lignes identiques dont une seule est libre.
   * La comparaison ignore la casse et les espaces de bord.
   */
  const salleNameTaken = (name: string, exceptId?: string) => {
    const key = name.trim().toLowerCase();
    return salles.some((s) => s.id !== exceptId && s.name.trim().toLowerCase() === key);
  };

  const handleCreateSalle = (day?: Day) => {
    const name = newSalleName.trim();
    if (!name) return;
    if (salleNameTaken(name)) {
      alert(`La salle « ${name} » existe déjà — choisissez-la dans la liste ou donnez un autre nom.`);
      return;
    }
    const newId = uid("salle");
    push("salles", { id: newId, name });
    if (day) setDaySalle(day, newId);
    else {
      setSalleId(newId);
      if (orderedDays.length === 1) setDaySalle(orderedDays[0], newId);
    }
    setNewSalleName("");
    setShowAddSalle(false);
  };

  // ---- Séance libre helpers ------------------------------------------------

  const toggleIn = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  const DOW_KEYS: Day[] = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

  /** Weekdays that actually occur at least once inside the selected period —
   *  the user can only pick study days that exist in that range. */
  const daysAvailableInPeriod = useMemo<Day[]>(() => {
    if (!openPeriodStart || !openPeriodEnd || openPeriodStart > openPeriodEnd) return [];
    const start = new Date(`${openPeriodStart}T12:00:00`);
    const end = new Date(`${openPeriodEnd}T12:00:00`);
    const found = new Set<Day>();
    const cursor = new Date(start);
    // A full week covers every weekday; stop early instead of walking months.
    while (cursor <= end && found.size < 7) {
      found.add(DOW_KEYS[cursor.getDay()]);
      cursor.setDate(cursor.getDate() + 1);
    }
    return WEEKDAYS.filter((w) => found.has(w.key)).map((w) => w.key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openPeriodStart, openPeriodEnd]);

  /** How many actual séances the period will contain (period × selected days). */
  const openSeanceCount = useMemo(() => {
    if (!openPeriodStart || !openPeriodEnd || openDays.length === 0) return 0;
    const start = new Date(`${openPeriodStart}T12:00:00`);
    const end = new Date(`${openPeriodEnd}T12:00:00`);
    let count = 0;
    const cursor = new Date(start);
    while (cursor <= end) {
      if (openDays.includes(DOW_KEYS[cursor.getDay()])) count += 1;
      cursor.setDate(cursor.getDate() + 1);
    }
    return count;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openPeriodStart, openPeriodEnd, openDays]);

  /** Readable, self-describing name for a séance libre timing — the format the
   *  Abonnements / Séances Libres screens display. */
  const buildOpenTitle = () => {
    const mod = openModuleId ? getModuleName(openModuleId) : "Module";
    const salleLabel = openSalleIds.length
      ? openSalleIds.map(getSalleName).join(" + ")
      : "Salle ?";
    const time = `${openStartHour}:${openStartMin}-${openEndHour}:${openEndMin}`;
    const period =
      openPeriodStart && openPeriodEnd
        ? ` · du ${formatDateFr(openPeriodStart)} au ${formatDateFr(openPeriodEnd)}`
        : "";
    return `Séance Libre — ${mod} · ${salleLabel} · ${time}${period}`;
  };

  const resetOpenForm = () => {
    setEditingOpenSession(null);
    setOpenModuleId("");
    setOpenClassIds([]);
    setOpenGroupIds([]);
    setOpenSalleIds([]);
    setOpenPeriodStart("");
    setOpenPeriodEnd("");
    setOpenDays([]);
    setOpenStartHour("08");
    setOpenStartMin("00");
    setOpenEndHour("10");
    setOpenEndMin("00");
    setOpenPrice(0);
    setOpenTeacherMode("existing");
    setOpenTeacherSearch("");
    setOpenTeacherId("");
    setOpenPassagerName("");
    setOpenPassagerPhone("");
    setOpenTitleOverride("");
  };

  const openEditOpenSeance = (s: ScheduleSession) => {
    setEditingOpenSession(s);
    setOpenModuleId(s.moduleId);
    setOpenClassIds(s.classIds?.length ? s.classIds : [s.classId]);
    setOpenGroupIds(s.groupIds?.length ? s.groupIds : [s.groupId]);
    setOpenSalleIds(s.salleIds?.length ? s.salleIds : [s.salleId]);
    setOpenPeriodStart(s.periodStart ?? "");
    setOpenPeriodEnd(s.periodEnd ?? "");
    setOpenDays(s.days);
    const [sh, sm] = s.startTime.split(":");
    const [eh, em] = s.endTime.split(":");
    setOpenStartHour(sh);
    setOpenStartMin(sm);
    setOpenEndHour(eh);
    setOpenEndMin(em);
    setOpenPrice(subscriptions.find((su) => su.sessionId === s.id)?.pricePerSession ?? s.openPrice ?? 0);
    const t = teachers.find((te) => te.id === s.teacherId);
    setOpenTeacherMode(t?.isPassager ? "passager" : "existing");
    setOpenTeacherId(s.teacherId ?? "");
    setOpenTeacherSearch(t ? `${t.firstName} ${t.lastName}` : "");
    setOpenPassagerName(t?.isPassager ? `${t.firstName} ${t.lastName}`.trim() : "");
    setOpenPassagerPhone(t?.isPassager ? t.phone : "");
    setOpenTitleOverride(s.title ?? "");
    setIsOpenSeanceModalOpen(true);
    setIsDetailsOpen(false);
  };

  /**
   * Creates (or updates) a séance libre timing.
   *
   * A timing is stored as a normal `sessions` row flagged `isOpen`, so the scan,
   * the présences and the teacher payout keep working unchanged. The single
   * class/group/salle columns hold the FIRST selection (the one the scanner
   * matches on) while the `*_ids` arrays hold the complete multi-selection.
   * A matching `subscriptions` row is created at the same time, which is what
   * makes the timing show up on the Abonnements screen exactly like a
   * hand-made subscription.
   */
  const handleSaveOpenSeance = async () => {
    // A séance libre only needs the period it runs over and the days inside it —
    // that is what makes it exist in the calendar. Module, classes, groupes,
    // salles, enseignant and prix can all be completed afterwards.
    if (!openPeriodStart || !openPeriodEnd) {
      return alert("Indiquez la période : une séance libre existe entre deux dates.");
    }
    if (openPeriodStart > openPeriodEnd) return alert("La date de début doit précéder la date de fin.");
    if (openDays.length === 0) {
      return alert("Sélectionnez au moins un jour d'étude dans cette période.");
    }

    setSavingOpenSeance(true);
    try {
      let teacherId = openTeacherId;

      // Teacher passager: no login, saved straight into the teachers table so
      // the Enseignants screen can pay him and show his history.
      if (openTeacherMode === "passager") {
        const existingPassager = teachers.find(
          (t) => t.isPassager && `${t.firstName} ${t.lastName}`.trim().toLowerCase() === openPassagerName.trim().toLowerCase(),
        );
        if (existingPassager) {
          teacherId = existingPassager.id;
          if (openPassagerPhone && openPassagerPhone !== existingPassager.phone) {
            updateItem("teachers", existingPassager.id, { phone: openPassagerPhone });
          }
        } else {
          const parts = openPassagerName.trim().split(/\s+/);
          const newTeacher: Teacher = {
            id: uid("tch"),
            firstName: parts[0] ?? openPassagerName.trim(),
            lastName: parts.slice(1).join(" "),
            phone: openPassagerPhone,
            email: "",
            paymentType: "percentage",
            isPassager: true,
            createdAt: new Date().toISOString(),
          };
          // A passager has no login: the row is simply added to the store.
          push("teachers", newTeacher);
          teacherId = newTeacher.id;
        }
      }

      const title = openTitleOverride.trim() || buildOpenTitle();
      const payload = {
        // The single-value columns mirror the first of each list. Those lists
        // may now be empty — the séance libre only needs its période and its
        // jours — so they fall back on "" rather than undefined, which the
        // database would refuse on these not-null columns.
        classId: openClassIds[0] ?? "",
        moduleId: openModuleId,
        groupId: openGroupIds[0] ?? "",
        salleId: openSalleIds[0] ?? "",
        teacherId: teacherId || "",
        days: openDays,
        startTime: `${openStartHour}:${openStartMin}`,
        endTime: `${openEndHour}:${openEndMin}`,
        isOpen: true,
        title,
        periodStart: openPeriodStart,
        periodEnd: openPeriodEnd,
        classIds: openClassIds,
        groupIds: openGroupIds,
        salleIds: openSalleIds,
        openPrice,
      };

      if (editingOpenSession) {
        updateItem("sessions", editingOpenSession.id, payload);
        const sub = subscriptions.find((su) => su.sessionId === editingOpenSession.id);
        if (sub) updateItem("subscriptions", sub.id, { pricePerSession: openPrice });
        else push("subscriptions", { id: uid("sub"), sessionId: editingOpenSession.id, pricePerSession: openPrice });
      } else {
        const sessionId = uid("ses");
        push("sessions", { id: sessionId, ...payload });
        // Auto-created subscription: this is what makes the timing appear on
        // the Abonnements page as if it had been created there by hand.
        push("subscriptions", { id: uid("sub"), sessionId, pricePerSession: openPrice } as Subscription);
      }

      setIsOpenSeanceModalOpen(false);
      resetOpenForm();
    } finally {
      setSavingOpenSeance(false);
    }
  };

  /**
   * What the form writes on the emploi du temps. `startTime`/`endTime` keep the
   * first day's hours as the default — everything that only needs "roughly
   * when" reads them — and `dayTimes` carries the per-day créneaux. A timing
   * that runs identical hours all week stores no override at all.
   */
  const timingPayload = () => {
    const first = orderedDays[0];
    const base = (first && dayTimes[first]) || DEFAULT_DAY_TIME;
    const perDay = Object.fromEntries(
      orderedDays.map((d) => [d, dayTimes[d] ?? base]),
    ) as Partial<Record<Day, DayTime>>;
    const uniform = orderedDays.every(
      (d) => perDay[d]!.startTime === base.startTime && perDay[d]!.endTime === base.endTime,
    );
    return {
      days: orderedDays,
      startTime: base.startTime,
      endTime: base.endTime,
      dayTimes: uniform ? undefined : perDay,
    };
  };

  /**
   * CE QUE LE FORMULAIRE ÉCRIT SUR LES NIVEAUX ET LES GROUPES.
   *
   * Un emploi du temps à un seul niveau écrit ce qu'il a toujours écrit :
   * `classId`, `groupId` et `groupIds`. Un emploi MULTI-NIVEAUX écrit en plus
   * `classIds` (tous ses niveaux) et `classGroups` (les groupes de chacun) — et
   * garde `classId`/`groupId` sur le premier de chaque liste, pour que le scan,
   * la feuille de présence et la base continuent de lire un emploi du temps
   * sans rien savoir de la nouveauté.
   */
  const levelPayload = () => {
    if (!multiLevel) {
      return {
        classId,
        classIds: undefined,
        classGroups: undefined,
        groupId: groupIds[0] ?? "",
        groupIds,
      };
    }
    // Un niveau coché sans aucun groupe est conservé tel quel : la réception
    // complètera plus tard, exactement comme un emploi sans groupe.
    const map = Object.fromEntries(
      multiClassIds.map((cid) => [cid, classGroupMap[cid] ?? []]),
    );
    return {
      classId: multiClassIds[0] ?? "",
      classIds: multiClassIds,
      classGroups: map,
      groupId: effectiveGroupIds[0] ?? "",
      groupIds: effectiveGroupIds,
    };
  };

  /**
   * What the form writes about the ROOMS. `salleId` keeps the first day's room —
   * everything that only needs "roughly where" reads it — and `daySalles`
   * carries the per-day override. An emploi that keeps the same room all week
   * stores no override at all.
   */
  const sallePayload = () => {
    const first = orderedDays[0];
    const base = (first && daySalles[first]) || salleId || "";
    const perDay = Object.fromEntries(
      orderedDays.map((d) => [d, daySalles[d] || base]),
    ) as Partial<Record<Day, string>>;
    const uniform = orderedDays.every((d) => perDay[d] === base);
    return { salleId: base, daySalles: uniform ? undefined : perDay };
  };

  /**
   * Only the days are required — an emploi du temps that runs on no day never
   * occurs, and the salle availability has nothing to check against. Classe,
   * module, groupe, salle and enseignant can all be filled in later.
   */
  const handleCreateSession = () => {
    if (selectedDays.length === 0) {
      alert("Sélectionnez au moins un jour : c'est ce qui fait exister l'emploi du temps.");
      return;
    }
    if (invalidDays.length > 0) {
      alert(`L'heure de fin doit suivre l'heure de début : ${formatDays(invalidDays)}.`);
      return;
    }
    const newSession: ScheduleSession = {
      id: uid("ses"),
      moduleId,
      teacherId,
      ...levelPayload(),
      ...sallePayload(),
      ...timingPayload(),
      title: title.trim() || undefined,
    };
    push("sessions", newSession);
    savePricing(newSession.id);
    setIsCreateOpen(false);
    resetForm();
  };

  const handleEditSession = () => {
    if (!selectedSession) return;
    if (selectedDays.length === 0) {
      alert("Sélectionnez au moins un jour : c'est ce qui fait exister l'emploi du temps.");
      return;
    }
    if (invalidDays.length > 0) {
      alert(`L'heure de fin doit suivre l'heure de début : ${formatDays(invalidDays)}.`);
      return;
    }
    const updated: Partial<ScheduleSession> = {
      moduleId,
      teacherId,
      ...levelPayload(),
      ...sallePayload(),
      ...timingPayload(),
      title: title.trim() || undefined,
    };
    updateItem("sessions", selectedSession.id, updated);
    savePricing(selectedSession.id);
    setIsEditOpen(false);
    resetForm();
  };

  /**
   * SUPPRIMER UN EMPLOI DU TEMPS SANS PERDRE SON HISTOIRE.
   *
   * Effacer la ligne effacerait aussi son tarif, et avec lui les inscriptions
   * qui s'y accrochent : les présences pointées, les soldes et les paiements des
   * élèves, les parts déjà dues à l'enseignant deviendraient orphelins et
   * s'afficheraient en tirets partout où on les relit. On l'ARCHIVE donc : il
   * sort de la grille, de la feuille de présence et du catalogue d'inscription,
   * ses élèves en sont désinscrits à la date du jour — et tout le reste demeure,
   * lisible et nommé, dans les historiques.
   */
  const handleDelete = async (id: string) => {
    const enrolled = subscriptions
      .filter((su) => su.sessionId === id)
      .reduce(
        (n, su) => n + students.filter((st) => st.subscriptionIds.includes(su.id)).length,
        0,
      );
    const warning =
      `Supprimer cet emploi du temps ?

${enrolled > 0 ? `${enrolled} élève(s) en seront désinscrits à la date du jour.
` : ""}Rien n'est perdu : les présences déjà pointées, les paiements et les soldes des élèves, ainsi que les parts dues à l'enseignant, restent visibles dans les historiques avec le nom de cet emploi du temps.`;
    if (!confirm(warning)) {
      return;
    }
    await archiveSession(id);
    setIsDetailsOpen(false);
  };

  const resetForm = () => {
    setTitle("");
    setClassId("");
    setModuleId("");
    setGroupIds([]);
    setGroupSearch("");
    setMultiLevel(false);
    setMultiClassIds([]);
    setClassGroupMap({});
    setSalleId("");
    setTeacherId("");
    setTeacherSearch("");
    setSelectedDays([]);
    setDayTimes({});
    setDaySalles({});
    setShowAddSalle(false);
    setNewSalleName("");
    setSelectedSession(null);
    resetPricing();
  };

  const openEdit = (s: ScheduleSession) => {
    setSelectedSession(s);
    setTitle(s.title || "");
    setClassId(s.classId);
    setModuleId(s.moduleId);
    setGroupIds(sessionGroupIds(s));
    setGroupSearch("");
    // Un emploi multi-niveaux rouvre en multi-niveaux, avec les groupes de
    // chaque classe là où la réception les avait mis.
    const levels = sessionClassIds(s);
    const multi = levels.length > 1 || !!s.classGroups;
    setMultiLevel(multi);
    setMultiClassIds(multi ? levels : []);
    setClassGroupMap(
      multi
        ? Object.fromEntries(levels.map((cid) => [cid, sessionGroupsOfClass(s, cid)]))
        : {},
    );
    setSalleId(s.salleId);
    setTeacherId(s.teacherId);
    setTeacherSearch("");
    setSelectedDays(s.days);
    // Un jour sans salle propre retombe sur celle de l'emploi : le formulaire
    // s'ouvre donc toujours avec une salle en face de chaque jour coché.
    setDaySalles(
      Object.fromEntries(s.days.map((d) => [d, sessionSalleOn(s, d)])) as Partial<
        Record<Day, string>
      >,
    );
    // Days that carry no override fall back on the emploi's default hours, so
    // the form always opens with a real pair in front of every selected day.
    setDayTimes(
      Object.fromEntries(s.days.map((d) => [d, sessionTimesOn(s, d)])) as Partial<Record<Day, DayTime>>,
    );
    const sub = subscriptions.find((x) => x.sessionId === s.id);
    setMonthSeances(sub?.monthlySeances ?? 0);
    setMonthPrice(monthlyPriceOf(sub));
    setSchoolShare(sub ? schoolMonthShareOf(sub) : 0);
    setIsEditOpen(true);
    setIsDetailsOpen(false);
  };

  const openDetails = (s: ScheduleSession) => {
    setSelectedSession(s);
    setIsDetailsOpen(true);
  };

  // Print one timing card: school letterhead + a detailed table (one row per
  // scheduled weekday) with module, group, class level, teacher and salle.
  const handlePrintSession = (s: ScheduleSession) => {
    const L = PRINT_LABELS[language];
    const enrolledCount = getSessionStudents(s.id).length;
    const orderedDays = WEEKDAYS.filter((wd) => s.days.includes(wd.key)).map((wd) => wd.key);
    const printDate = new Date().toLocaleDateString(language === "ar" ? "ar-DZ" : "fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });

    const rows = orderedDays
      .map(
        (day) => `
          <tr>
            <td style="font-weight:bold;">${L.days[day]}</td>
            <td style="font-family:monospace; font-weight:700;">${sessionTimesOn(s, day).startTime} – ${sessionTimesOn(s, day).endTime}</td>
            <td>${getModuleName(s.moduleId)}</td>
            <td>${sessionGroupIds(s).map(getGroupName).join(" · ")}</td>
            <td>${getClassName(s.classId)}</td>
            <td>${getTeacherName(s.teacherId)}</td>
            <td>${getSalleName(s.salleId)}</td>
          </tr>`,
      )
      .join("");

    const bodyHtml = `
      ${letterheadHtml(school)}
      ${bannerHtml(L.docTitle, L.printedOn(printDate))}

      <div class="frame frame-info" style="margin-bottom:20px;">
        <h3>${L.infoTitle}</h3>
        <table style="margin-top:0;">
          <tr>
            <td style="width:18%; font-weight:bold; color:#5c567a;">${L.module} :</td>
            <td style="width:32%; font-weight:bold; font-size:1.1em;">${getModuleName(s.moduleId)}</td>
            <td style="width:18%; font-weight:bold; color:#5c567a;">${L.group} :</td>
            <td style="width:32%;">${sessionGroupIds(s).map(getGroupName).join(" · ")}</td>
          </tr>
          <tr>
            <td style="font-weight:bold; color:#5c567a;">${L.classLevel} :</td>
            <td>${getClassName(s.classId)}</td>
            <td style="font-weight:bold; color:#5c567a;">${L.teacher} :</td>
            <td>${getTeacherName(s.teacherId)}</td>
          </tr>
          <tr>
            <td style="font-weight:bold; color:#5c567a;">${L.salle} :</td>
            <td>${getSalleName(s.salleId)}</td>
            <td style="font-weight:bold; color:#5c567a;">${L.enrolled} :</td>
            <td><span class="badge badge-primary">${enrolledCount}</span></td>
          </tr>
        </table>
      </div>

      <div class="frame">
        <h3>${L.tableTitle}</h3>
        <table>
          <thead>
            <tr>
              <th>${L.day}</th>
              <th>${L.time}</th>
              <th>${L.module}</th>
              <th>${L.group}</th>
              <th>${L.classLevel}</th>
              <th>${L.teacher}</th>
              <th>${L.salle}</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>

      ${signaturesHtml(L.signTeacher, L.signDirection)}
      ${metaFooterHtml(school.name, language)}
    `;

    printHtmlDocument(
      printDocument({
        title: `${L.docTitle} - ${getModuleName(s.moduleId)} ${getGroupName(s.groupId)}`,
        lang: language,
        bodyHtml,
      }),
    );
  };

  const getSessionStudents = (sessionId: string) => {
    const sub = subscriptions.find((su) => su.sessionId === sessionId);
    if (!sub) return [];
    return students.filter((stu) => stu.subscriptionIds.includes(sub.id));
  };

  const getHours = () => Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
  const getMinutes = () => ["00", "15", "30", "45"];

  /** One "HH:mm" picker, split into an hour and a minute select. */
  const renderTimePicker = (value: string, onChange: (next: string) => void) => {
    const [h = "08", m = "00"] = (value || "").split(":");
    return (
      <div className="flex gap-1.5">
        <Select value={h} onChange={(e) => onChange(`${e.target.value}:${m}`)} className="flex-1 !px-2">
          {getHours().map((x) => (
            <option key={x} value={x}>{x} H</option>
          ))}
        </Select>
        <Select value={m} onChange={(e) => onChange(`${h}:${e.target.value}`)} className="flex-1 !px-2">
          {getMinutes().map((x) => (
            <option key={x} value={x}>{x} Min</option>
          ))}
        </Select>
      </div>
    );
  };

  /**
   * Days, then the hours of EACH of them.
   *
   * One day reads as a single créneau. As soon as a second is picked, every day
   * gets its own start and end — an emploi that runs Samedi matin and Mardi
   * après-midi is one emploi, not two — with a shortcut to copy the first day's
   * hours onto the rest when they are in fact identical.
   */
  const renderDaysAndHours = () => (
    <div className="space-y-4">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <label className="block text-xs font-semibold text-muted font-sans">Jours de cours</label>
          <Badge tone={selectedDays.length ? "primary" : "warning"} className="text-[9px] font-bold">
            {selectedDays.length ? `${selectedDays.length} jour(s)` : "Aucun jour"}
          </Badge>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {WEEKDAYS.map((day) => {
            const active = selectedDays.includes(day.key);
            return (
              <Button
                key={day.key}
                variant={active ? "primary" : "outline"}
                onClick={() => toggleDay(day.key)}
                size="sm"
                className="w-full text-start py-2 justify-between"
              >
                <span>{day.label}</span>
                {active && <span className="text-[10px] bg-white/25 px-1.5 rounded">✔</span>}
              </Button>
            );
          })}
        </div>
      </div>

      {selectedDays.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-canvas/40 p-3 text-[11px] leading-relaxed text-muted">
          Choisissez d&apos;abord les jours. Vous fixerez ensuite l&apos;heure de début et de fin
          <strong className="text-ink"> de chaque jour</strong>, et les salles libres sur ces
          créneaux vous seront proposées.
        </div>
      ) : (
        <div className="rounded-2xl border border-primary/25 bg-primary-50/30 p-3 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-primary">
              {selectedDays.length > 1 ? "Horaire de chaque jour" : "Horaire du jour"}
            </span>
            {selectedDays.length > 1 && (
              <button
                type="button"
                onClick={applyFirstDayToAll}
                className="text-[10px] font-semibold text-primary hover:underline"
              >
                Appliquer l&apos;horaire du {WEEKDAYS.find((w) => w.key === orderedDays[0])?.label} à tous
              </button>
            )}
          </div>

          {orderedDays.map((day) => {
            const t = dayTimes[day] ?? DEFAULT_DAY_TIME;
            const bad = !dayTimeValid(day);
            return (
              <div
                key={day}
                className={`rounded-xl border p-2.5 ${bad ? "border-danger/40 bg-danger/5" : "border-line bg-surface"}`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] font-bold text-ink">
                    {WEEKDAYS.find((w) => w.key === day)?.label}
                  </span>
                  {bad && (
                    <span className="text-[9px] font-semibold text-danger">
                      La fin doit suivre le début
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="block text-[9px] uppercase font-semibold text-muted mb-1">Début</span>
                    {renderTimePicker(t.startTime, (v) => setDayTime(day, "startTime", v))}
                  </div>
                  <div>
                    <span className="block text-[9px] uppercase font-semibold text-muted mb-1">Fin</span>
                    {renderTimePicker(t.endTime, (v) => setDayTime(day, "endTime", v))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  /**
   * L'enseignant, CHERCHÉ PAR SON NOM.
   *
   * Une école qui compte quarante enseignants ne les retrouve pas dans une
   * liste déroulante : on tape deux lettres du nom (ou du téléphone) et on
   * clique. Celui qui est déjà choisi reste affiché en tête, avec de quoi le
   * retirer d'un clic.
   */
  const renderTeacherField = () => {
    const q = teacherSearch.trim().toLowerCase();
    const picked = teachers.find((t) => t.id === teacherId);
    const matches = teachers
      .filter((t) =>
        q ? `${t.firstName} ${t.lastName} ${t.phone ?? ""}`.toLowerCase().includes(q) : true,
      )
      .sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`))
      .slice(0, 40);

    return (
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
          <label className="block text-xs font-semibold text-muted font-sans">Enseignant</label>
          <Badge tone="neutral" className="text-[9px] font-bold">
            {teachers.length} enseignant(s)
          </Badge>
        </div>

        {picked && (
          <div className="mb-1.5 flex items-center justify-between gap-2 rounded-xl border border-primary bg-primary/10 p-2.5">
            <span className="min-w-0">
              <strong className="block text-xs text-ink truncate">
                {picked.firstName} {picked.lastName}
                {picked.isPassager && (
                  <Badge tone="warning" className="ml-1.5 text-[9px]">
                    passager
                  </Badge>
                )}
              </strong>
              <span className="block text-[10px] text-muted">{picked.phone || "—"}</span>
            </span>
            <button
              type="button"
              onClick={() => setTeacherId("")}
              className="shrink-0 rounded-lg border border-line px-2 py-1 text-[10px] font-bold text-danger hover:bg-danger/10"
            >
              Retirer
            </button>
          </div>
        )}

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input
            value={teacherSearch}
            onChange={(e) => setTeacherSearch(e.target.value)}
            placeholder="Rechercher un enseignant par son nom…"
            className="pl-9"
          />
        </div>

        {teachers.length === 0 ? (
          <p className="mt-1.5 rounded-xl border border-dashed border-line bg-canvas/40 p-3 text-[11px] text-muted">
            Aucun enseignant enregistré — créez-en un depuis l&apos;écran Enseignants.
          </p>
        ) : (
          <div className="mt-1.5 max-h-44 space-y-1 overflow-y-auto pr-0.5">
            {matches.length === 0 ? (
              <p className="p-2 text-[11px] italic text-muted">Aucun enseignant ne correspond.</p>
            ) : (
              matches.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTeacherId(teacherId === t.id ? "" : t.id)}
                  className={`flex w-full items-center justify-between gap-2 rounded-xl border p-2 text-start transition-colors ${
                    teacherId === t.id
                      ? "border-primary bg-primary/10 ring-2 ring-primary/25"
                      : "border-line bg-surface hover:bg-primary-50/40"
                  }`}
                >
                  <span className="min-w-0">
                    <strong className="block truncate text-xs text-ink">
                      {t.firstName} {t.lastName}
                    </strong>
                    <span className="block text-[10px] text-muted">{t.phone || "—"}</span>
                  </span>
                  {t.isPassager && (
                    <Badge tone="warning" className="shrink-0 text-[9px]">
                      passager
                    </Badge>
                  )}
                </button>
              ))
            )}
          </div>
        )}
      </div>
    );
  };

  /** Une salle dans la liste : son nom, son état et ce qui l'occupe déjà. */
  const renderSalleOption = (
    sa: SalleAvailability,
    picked: boolean,
    onPick: () => void,
  ) => (
    <button
      key={sa.id}
      type="button"
      onClick={onPick}
      className={`w-full text-start rounded-xl border p-2.5 transition-all ${
        picked
          ? "border-primary bg-primary/10 ring-2 ring-primary/25"
          : sa.free
            ? "border-line bg-surface hover:bg-primary-50/40"
            : "border-danger/30 bg-danger/5"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-ink truncate">{sa.name}</span>
        <Badge tone={sa.free ? "success" : "danger"} className="text-[9px] font-bold shrink-0">
          {sa.free ? "Disponible" : "Occupée"}
        </Badge>
      </div>
      {!sa.free && (
        <div className="mt-1 space-y-0.5">
          {sa.clashes.map((c) => (
            <span key={c.sessionId} className="block text-[10px] leading-snug text-danger">
              {c.label} · {formatDays(c.days)} · {c.timeLabel}
            </span>
          ))}
        </div>
      )}
    </button>
  );

  /** Le formulaire « + Nouvelle salle », partagé par les deux modes. */
  const renderAddSalle = (day?: Day) => (
    <div className="flex gap-2">
      <Input
        value={newSalleName}
        onChange={(e) => setNewSalleName(e.target.value)}
        placeholder="Nom de la salle"
        className="flex-1"
      />
      <Button size="sm" onClick={() => handleCreateSalle(day)}>Créer</Button>
      <Button size="sm" variant="outline" onClick={() => { setShowAddSalle(false); setNewSalleName(""); }}>
        Annuler
      </Button>
    </div>
  );

  /**
   * La salle, choisie EN DERNIER.
   *
   * Elle reste verrouillée tant que chaque jour coché ne porte pas un créneau
   * cohérent — sans cela il n'y a rien à confronter à une salle. Puis :
   *
   *  - UN seul jour  : la liste habituelle, chaque salle disant si elle est
   *    libre sur ce créneau ou quel emploi l'occupe déjà ;
   *  - PLUSIEURS jours : une salle PAR JOUR, chacune vérifiée sur le créneau de
   *    CE jour-là. Samedi en Salle A et Mardi en Salle B est un seul emploi du
   *    temps, et une salle occupée le samedi reste libre le mardi.
   */
  const renderSalleField = () => (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <label className="block text-xs font-semibold text-muted font-sans">
          {orderedDays.length > 1 ? "Salle de chaque jour" : "Salle"}
        </label>
        {timingReady && (
          <div className="flex items-center gap-2">
            {daysWithoutSalle.length > 0 && (
              <Badge tone="warning" className="text-[9px] font-bold">
                {formatDays(daysWithoutSalle)} sans salle
              </Badge>
            )}
            {orderedDays.length <= 1 && (
              <Badge tone={freeSalleCount ? "success" : "danger"} className="text-[9px] font-bold">
                {freeSalleCount} / {salles.length} libre(s)
              </Badge>
            )}
            {orderedDays.length > 1 && (
              <button
                type="button"
                onClick={applyFirstSalleToAll}
                className="text-[10px] font-semibold text-primary hover:underline"
              >
                Même salle tous les jours
              </button>
            )}
            <button
              onClick={() => setShowAddSalle(!showAddSalle)}
              className="text-xs text-primary hover:underline"
            >
              + Nouvelle salle
            </button>
          </div>
        )}
      </div>

      {!timingReady ? (
        <div className="rounded-xl border border-dashed border-line bg-canvas/40 p-3 text-[11px] leading-relaxed text-muted">
          🔒 Fixez d&apos;abord les <strong className="text-ink">jours</strong> et
          l&apos;<strong className="text-ink">heure de début et de fin de chaque jour</strong>. Les
          salles disponibles sur ces créneaux s&apos;afficheront ici.
        </div>
      ) : salles.length === 0 && !showAddSalle ? (
        <div className="rounded-xl border border-dashed border-line bg-canvas/40 p-3 text-[11px] text-muted">
          Aucune salle enregistrée — créez-en une avec « + Nouvelle salle ».
        </div>
      ) : showAddSalle && orderedDays.length <= 1 ? (
        renderAddSalle(orderedDays[0])
      ) : orderedDays.length <= 1 ? (
        <div className="space-y-1.5 max-h-64 overflow-y-auto pr-0.5">
          {salleAvailability.map((sa) =>
            renderSalleOption(sa, salleId === sa.id, () => {
              const next = salleId === sa.id ? "" : sa.id;
              setSalleId(next);
              if (orderedDays[0]) setDaySalle(orderedDays[0], next);
            }),
          )}
          <p className="pt-1 text-[10px] leading-relaxed text-muted">
            Une salle occupée reste sélectionnable — l&apos;école peut vouloir doubler un créneau —
            mais le conflit est affiché avant l&apos;enregistrement.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {showAddSalle && renderAddSalle()}
          {orderedDays.map((day) => {
            const rows = availabilityFor(day);
            const free = rows.filter((r) => r.free).length;
            const chosen = daySalles[day] || "";
            const t = dayTimes[day] ?? DEFAULT_DAY_TIME;
            return (
              <div key={day} className="rounded-xl border border-line bg-surface p-2.5">
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] font-bold text-ink">
                    {WEEKDAYS.find((w) => w.key === day)?.label}{" "}
                    <span className="font-mono font-normal text-muted">
                      {t.startTime}–{t.endTime}
                    </span>
                  </span>
                  <div className="flex items-center gap-1.5">
                    <Badge tone={free ? "success" : "danger"} className="text-[9px] font-bold">
                      {free} / {salles.length} libre(s)
                    </Badge>
                    <Badge tone={chosen ? "primary" : "warning"} className="text-[9px] font-bold">
                      {chosen ? getSalleName(chosen) : "Aucune salle"}
                    </Badge>
                  </div>
                </div>
                <div className="space-y-1.5 max-h-44 overflow-y-auto pr-0.5">
                  {rows.map((sa) =>
                    renderSalleOption(sa, chosen === sa.id, () =>
                      setDaySalle(day, chosen === sa.id ? "" : sa.id),
                    ),
                  )}
                </div>
              </div>
            );
          })}
          <p className="text-[10px] leading-relaxed text-muted">
            Chaque jour porte sa propre salle, vérifiée sur SON créneau : une salle prise le samedi
            reste proposée le mardi. Une salle occupée reste sélectionnable — le conflit est
            simplement affiché avant l&apos;enregistrement.
          </p>
        </div>
      )}
    </div>
  );

  const clearFilters = () => {
    setFilterSessionId("");
    setFilterTeacherId("");
    setFilterSalleId("");
    setFilterClassId("");
    setKindFilter("all");
  };

  /** A séance libre also "belongs" to every class / group / salle of its
   *  multi-selection, not only to the primary one stored in the columns. */
  const sessionCovers = (s: ScheduleSession, kind: "class" | "salle", id: string) => {
    if (kind === "class") return sessionClassIds(s).includes(id);
    return s.salleId === id || (s.salleIds ?? []).includes(id);
  };

  // Filter sessions
  const filteredSessions = sessions.filter((s) => {
    if (kindFilter === "cours" && s.isOpen) return false;
    if (kindFilter === "open" && !s.isOpen) return false;
    if (filterSessionId && s.id !== filterSessionId) return false;
    if (filterTeacherId && s.teacherId !== filterTeacherId) return false;
    if (filterSalleId && !sessionCovers(s, "salle", filterSalleId)) return false;
    if (filterClassId && !sessionCovers(s, "class", filterClassId)) return false;
    return true;
  });

  /** Label shown on the cards / calendar for any timing. A manually entered
   *  name always wins; otherwise we fall back to the module name. */
  const sessionTitle = (s: ScheduleSession) =>
    s.isOpen
      ? s.title || `Séance Libre — ${getModuleName(s.moduleId)}`
      : s.title || getModuleName(s.moduleId);

  const openSessionPrice = (s: ScheduleSession) =>
    subscriptions.find((su) => su.sessionId === s.id)?.pricePerSession ?? s.openPrice ?? 0;

  /** Is a séance libre still inside its date period? */
  const openSessionActive = (s: ScheduleSession) => {
    const today = new Date().toLocaleDateString("fr-CA");
    if (s.periodStart && today < s.periodStart) return false;
    if (s.periodEnd && today > s.periodEnd) return false;
    return true;
  };

  return (
    <div className="space-y-6 text-xs">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <PageHeader emoji="📅" title="Emploi du Temps" subtitle="Visualisation du calendrier hebdomadaire et planification" />
        <div className="flex flex-wrap items-center gap-2 self-start sm:self-center">
          {can("create_open") && (
            <Button
              variant="outline"
              onClick={() => { resetOpenForm(); setIsOpenSeanceModalOpen(true); }}
              className="flex items-center gap-2 border-primary/30 text-primary hover:bg-primary-50"
            >
              <Sparkles className="h-4 w-4" /> Créneau Séance Libre
            </Button>
          )}
          {can("create") && (
            <Button onClick={() => { resetForm(); setIsCreateOpen(true); }} className="flex items-center gap-2">
              <Plus className="h-4 w-4" /> Créer un emploi du temps
            </Button>
          )}
        </div>
      </div>

      {/* Advanced Filter Toolbar */}
      <Card className="border border-line shadow-sm">
        <CardBody className="p-4 space-y-3.5">
          <div className="flex items-center justify-between border-b border-line pb-2.5">
            <span className="font-bold text-ink uppercase tracking-wider text-[10px] flex items-center gap-1.5">
              <Filter className="h-4 w-4 text-primary" /> Filtrer le Calendrier
            </span>
            {(filterSessionId || filterTeacherId || filterClassId || filterSalleId || kindFilter !== "all") && (
              <button onClick={clearFilters} className="text-primary hover:underline font-bold text-[10px] flex items-center gap-1">
                <X className="h-3 w-3" /> Réinitialiser
              </button>
            )}
          </div>

          {/* Type of timing: regular courses vs séances libres */}
          <div className="flex flex-wrap gap-1.5">
            {([
              { key: "all", label: `Tous (${sessions.length})` },
              { key: "cours", label: `Cours (${sessions.filter((s) => !s.isOpen).length})` },
              { key: "open", label: `Séances Libres (${sessions.filter((s) => s.isOpen).length})` },
            ] as const).map((k) => (
              <button
                key={k.key}
                onClick={() => setKindFilter(k.key)}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
                  kindFilter === k.key ? "bg-primary text-white shadow-sm" : "bg-canvas text-muted hover:text-ink"
                }`}
              >
                {k.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Filter by specific emploi du temps */}
            <div>
              <label className="block text-[10px] font-bold text-muted uppercase mb-1 font-sans">Séance Spécifique</label>
              <Select value={filterSessionId} onChange={(e) => setFilterSessionId(e.target.value)} className="w-full">
                <option value="">Tous les cours</option>
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.isOpen
                      ? `🎯 ${sessionTitle(s)}`
                      : `${sessionTitle(s)} - ${sessionGroupIds(s).map(getGroupName).join(" · ")}`}
                  </option>
                ))}
              </Select>
            </div>

            {/* Filter by Teacher */}
            <div>
              <label className="block text-[10px] font-bold text-muted uppercase mb-1 font-sans">Enseignant</label>
              <Select value={filterTeacherId} onChange={(e) => setFilterTeacherId(e.target.value)} className="w-full">
                <option value="">Tous les enseignants</option>
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.firstName} {t.lastName}
                  </option>
                ))}
              </Select>
            </div>

            {/* Filter by Classroom */}
            <div>
              <label className="block text-[10px] font-bold text-muted uppercase mb-1 font-sans">Salle de Cours</label>
              <Select value={filterSalleId} onChange={(e) => setFilterSalleId(e.target.value)} className="w-full">
                <option value="">Toutes les salles</option>
                {salles.map((sa) => (
                  <option key={sa.id} value={sa.id}>
                    {sa.name}
                  </option>
                ))}
              </Select>
            </div>

            {/* Filter by Class */}
            <div>
              <label className="block text-[10px] font-bold text-muted uppercase mb-1 font-sans">Classe & Niveau</label>
              <Select value={filterClassId} onChange={(e) => setFilterClassId(e.target.value)} className="w-full">
                <option value="">Toutes les classes</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.type === "cours" ? c.coursLevel : c.formationLevel})
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Layout View Toggle */}
      <div className="flex justify-end items-center gap-2">
        <span className="text-[10px] uppercase font-bold text-muted font-sans mr-1">Affichage :</span>
        <div className="bg-canvas border border-line p-1 rounded-xl flex gap-1">
          <button
            onClick={() => setViewMode("calendar")}
            className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
              viewMode === "calendar"
                ? "bg-primary text-white shadow-sm"
                : "text-muted hover:text-ink hover:bg-canvas/50"
            }`}
          >
            Vue Calendrier
          </button>
          <button
            onClick={() => setViewMode("cards")}
            className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
              viewMode === "cards"
                ? "bg-primary text-white shadow-sm"
                : "text-muted hover:text-ink hover:bg-canvas/50"
            }`}
          >
            Vue Cartes
          </button>
        </div>
      </div>

      {viewMode === "calendar" ? (
        /* TIMETABLE BOARD COLUMN GRID */
        <div className="overflow-x-auto pb-4">
          <div className="grid grid-cols-1 md:grid-cols-7 gap-4 min-w-[900px] md:min-w-0">
            {WEEKDAYS.map((day) => {
              // Filter and sort sessions chronologically for this day
              const daySessions = filteredSessions
                .filter((s) => s.days.includes(day.key))
                .sort(
                  (a, b) =>
                    minutesOf(sessionTimesOn(a, day.key).startTime) -
                    minutesOf(sessionTimesOn(b, day.key).startTime),
                );

              return (
                <div key={day.key} className="flex flex-col bg-canvas/30 rounded-2xl border border-line p-3 min-h-[420px] space-y-3.5">
                  {/* Column Header */}
                  <div className="border-b border-line pb-2.5 text-center flex justify-between items-center px-1">
                    <span className="font-extrabold text-ink uppercase text-[10px] tracking-wider block capitalize">
                      {day.label}
                    </span>
                    <Badge tone={daySessions.length > 0 ? "primary" : "neutral"} className="text-[9px] font-bold px-1.5 py-0.5 rounded-full">
                      {daySessions.length}
                    </Badge>
                  </div>

                  {/* Day Timetable Cards list */}
                  <div className="flex-1 space-y-2.5 overflow-y-auto max-h-[500px] pr-0.5">
                    {daySessions.length === 0 ? (
                      <div className="h-full flex items-center justify-center py-16 text-center text-muted font-medium italic text-[10px]">
                        Libre
                      </div>
                    ) : (
                      daySessions.map((s) => {
                        const enrolledCount = getSessionStudents(s.id).length;
                        return (
                          <div
                            key={s.id}
                            onClick={() => openDetails(s)}
                            className={`p-3 rounded-xl border cursor-pointer hover:shadow-sm hover:scale-[1.01] transition-all duration-200 space-y-2 ${getSessionColor(
                              s.moduleId
                            )}`}
                          >
                            {/* Timings */}
                            <div className="flex items-center gap-1 text-[9px] font-bold font-mono">
                              <Clock className="h-3 w-3 shrink-0" />
                              <span>
                                {sessionTimesOn(s, day.key).startTime} -{" "}
                                {sessionTimesOn(s, day.key).endTime}
                              </span>
                            </div>

                            {/* Module & Class Info */}
                            <div className="space-y-0.5">
                              <strong className="block text-[11px] font-black leading-tight line-clamp-2">
                                {s.isOpen && <span className="mr-1">🎯</span>}
                                {sessionTitle(s)}
                              </strong>
                              <span className="block text-[9px] opacity-80 font-bold truncate">
                                {s.isOpen
                                  ? `Séance libre · ${formatDA(openSessionPrice(s))}`
                                  : getClassName(s.classId)}
                              </span>
                            </div>

                            {/* Room & Teacher */}
                            <div className="text-[9px] opacity-90 space-y-1 pt-1.5 border-t border-black/5 dark:border-white/5">
                              <div className="flex items-center gap-1">
                                <User className="h-3 w-3 shrink-0" />
                                <span className="truncate">{getTeacherName(s.teacherId)}</span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="flex items-center gap-1 truncate max-w-[65%]">
                                  <MapPin className="h-3 w-3 shrink-0" />
                                  <span className="truncate">{getSalleName(s.salleId)}</span>
                                </span>
                                <Badge tone="success" className="text-[8px] px-1 py-0 font-bold">
                                  {enrolledCount} él.
                                </Badge>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* DETAILED CARDS VIEW */
        <div>
          {filteredSessions.length === 0 ? (
            <div className="text-center p-12 bg-canvas/30 border border-line border-dashed rounded-2xl text-muted text-xs">
              Aucun emploi du temps ne correspond aux filtres actuels.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredSessions.map((s) => {
                const enrolledCount = getSessionStudents(s.id).length;
                return (
                  <Card key={s.id} className={`hover:shadow-md transition-all duration-200 ${getSessionColor(s.moduleId)}`}>
                    <CardBody className="p-4 space-y-3 flex flex-col justify-between h-full">
                      <div className="space-y-2">
                        {/* Header: Module + Group Badge */}
                        <div className="flex justify-between items-start">
                          <div className="min-w-0">
                            <strong className="block text-sm font-black text-ink leading-tight line-clamp-2">
                              {sessionTitle(s)}
                            </strong>
                            <span className="text-[10px] font-bold opacity-80 mt-0.5 block truncate">
                              {s.isOpen
                                ? (s.classIds ?? [s.classId]).map(getClassName).join(" · ")
                                : getClassName(s.classId)}
                            </span>
                          </div>
                          <div className="flex flex-col items-end gap-1 shrink-0">
                            {s.isOpen && (
                              <Badge tone={openSessionActive(s) ? "success" : "neutral"} className="font-bold text-[9px]">
                                {openSessionActive(s) ? "Séance Libre" : "Période terminée"}
                              </Badge>
                            )}
                            <Badge tone="primary" className="font-bold">
                              {s.isOpen
                                ? `${sessionGroupIds(s).length} groupe(s)`
                                : sessionGroupIds(s).map(getGroupName).join(" · ") || "—"}
                            </Badge>
                          </div>
                        </div>

                        {/* Room & Teacher & Schedule info */}
                        <div className="space-y-1.5 pt-2 border-t border-black/5 dark:border-white/5 text-[11px] text-ink/90">
                          <div className="flex items-center gap-2">
                            <User className="h-3.5 w-3.5 text-primary shrink-0" />
                            <span>
                              Enseignant: <strong>{getTeacherName(s.teacherId)}</strong>
                              {teachers.find((t) => t.id === s.teacherId)?.isPassager && (
                                <span className="ml-1 text-[9px] font-bold px-1 py-0.5 rounded bg-warning/15 text-warning">
                                  Passager
                                </span>
                              )}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <MapPin className="h-3.5 w-3.5 text-primary shrink-0" />
                            <span>
                              Salle:{" "}
                              <strong>
                                {s.isOpen
                                  ? (s.salleIds ?? [s.salleId]).map(getSalleName).join(" + ")
                                  : getSalleName(s.salleId)}
                              </strong>
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Clock className="h-3.5 w-3.5 text-primary shrink-0" />
                            <span>Horaires: <strong className="font-mono">{sessionTimeLabel(s)}</strong></span>
                          </div>
                          {s.isOpen && (
                            <>
                              <div className="flex items-center gap-2">
                                <CalendarIcon className="h-3.5 w-3.5 text-primary shrink-0" />
                                <span>
                                  Période:{" "}
                                  <strong className="font-mono">
                                    {formatDateFr(s.periodStart)} → {formatDateFr(s.periodEnd)}
                                  </strong>
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                <Users className="h-3.5 w-3.5 text-primary shrink-0" />
                                <span>Tarif séance: <strong className="text-primary">{formatDA(openSessionPrice(s))}</strong></span>
                              </div>
                            </>
                          )}
                        </div>

                        {/* Days list */}
                        <div className="pt-1 flex flex-wrap gap-1">
                          {s.days.map((dayKey) => (
                            <Badge key={dayKey} tone="neutral" className="text-[9px] font-bold uppercase">
                              {WEEKDAYS.find((wd) => wd.key === dayKey)?.label || dayKey}
                            </Badge>
                          ))}
                        </div>
                      </div>

                      {/* Footer Actions & Count */}
                      <div className="flex justify-between items-center pt-3 border-t border-black/5 dark:border-white/5 mt-auto">
                        <Badge tone="success" className="text-[10px] font-bold flex items-center gap-1">
                          <Users className="h-3 w-3" /> {enrolledCount} élève(s)
                        </Badge>

                        <div className="flex gap-1.5">
                          {can("view") && (
<button
                              onClick={() => openDetails(s)}
                              className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 text-ink/80 transition-colors"
                              title="Consulter les détails"
                            >
                              <Eye className="h-4 w-4" />
                            </button>
                          )}
                          {can("print") && (
<button
                              onClick={() => handlePrintSession(s)}
                              className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 text-ink/80 transition-colors"
                              title="Imprimer cet horaire"
                            >
                              <Printer className="h-4 w-4" />
                            </button>
                          )}
                          {can("edit") && (
<button
                              onClick={() => (s.isOpen ? openEditOpenSeance(s) : openEdit(s))}
                              className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 text-primary transition-colors"
                              title="Modifier"
                            >
                              <Edit className="h-4 w-4" />
                            </button>
                          )}
                          {can("delete") && (
<button
                              onClick={() => handleDelete(s.id)}
                              className="p-1.5 rounded-lg hover:bg-danger/10 text-danger transition-colors"
                              title="Supprimer"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    </CardBody>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Séance libre: create / edit a timing                             */}
      {/* ---------------------------------------------------------------- */}
      <Modal
        open={isOpenSeanceModalOpen}
        onClose={() => setIsOpenSeanceModalOpen(false)}
        title={editingOpenSession ? "Modifier le créneau de séance libre" : "Créer un créneau de séance libre"}
        wide
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* ---- Left: what & who -------------------------------------- */}
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-semibold text-muted font-sans">Module</label>
                <button onClick={() => setShowAddModule(!showAddModule)} className="text-xs text-primary hover:underline">
                  + Nouveau module
                </button>
              </div>
              {showAddModule ? (
                <div className="flex gap-2">
                  <Input
                    value={newModuleName}
                    onChange={(e) => setNewModuleName(e.target.value)}
                    placeholder="Nom du module"
                    className="flex-1"
                  />
                  <Button
                    size="sm"
                    onClick={() => {
                      if (!newModuleName.trim()) return;
                      const newId = uid("mod");
                      push("modules", { id: newId, name: newModuleName });
                      setOpenModuleId(newId);
                      setNewModuleName("");
                      setShowAddModule(false);
                    }}
                  >
                    Créer
                  </Button>
                </div>
              ) : (
                <Select value={openModuleId} onChange={(e) => setOpenModuleId(e.target.value)} className="w-full">
                  <option value="">Sélectionner un module</option>
                  {modules.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </Select>
              )}
            </div>

            {/* Multi-selects: classes / groupes / salles */}
            {([
              { label: "Classes concernées", items: classes.map((c) => ({ id: c.id, name: `${c.name} (${c.type === "cours" ? c.coursLevel : c.formationLevel})` })), selected: openClassIds, set: setOpenClassIds },
              { label: "Groupes concernés", items: groups, selected: openGroupIds, set: setOpenGroupIds },
              { label: "Salles", items: salles, selected: openSalleIds, set: setOpenSalleIds },
            ] as const).map((block) => (
              <div key={block.label}>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-muted font-sans">{block.label}</label>
                  <span className="text-[10px] font-bold text-primary">{block.selected.length} sélectionné(s)</span>
                </div>
                <div className="border border-line rounded-xl max-h-32 overflow-y-auto p-1.5 bg-canvas/30 space-y-1">
                  {block.items.length === 0 ? (
                    <p className="text-[10px] text-muted italic p-2">Aucun élément disponible.</p>
                  ) : (
                    block.items.map((it) => {
                      const active = block.selected.includes(it.id);
                      return (
                        <button
                          key={it.id}
                          type="button"
                          onClick={() => block.set(toggleIn(block.selected, it.id))}
                          className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                            active ? "bg-primary text-white font-bold" : "hover:bg-primary-50 text-ink"
                          }`}
                        >
                          <span className="truncate">{it.name}</span>
                          <input type="checkbox" checked={active} readOnly className="h-3.5 w-3.5 shrink-0" />
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            ))}

            {/* Teacher: existing or passager */}
            <div>
              <label className="block text-xs font-semibold text-muted mb-1.5 font-sans">Enseignant</label>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <button
                  type="button"
                  onClick={() => setOpenTeacherMode("existing")}
                  className={`p-2.5 rounded-xl border text-xs font-bold transition-all ${
                    openTeacherMode === "existing" ? "border-primary bg-primary/10 text-primary" : "border-line bg-surface text-muted"
                  }`}
                >
                  Enseignant existant
                </button>
                <button
                  type="button"
                  onClick={() => setOpenTeacherMode("passager")}
                  className={`p-2.5 rounded-xl border text-xs font-bold transition-all ${
                    openTeacherMode === "passager" ? "border-primary bg-primary/10 text-primary" : "border-line bg-surface text-muted"
                  }`}
                >
                  Enseignant passager
                </button>
              </div>

              {openTeacherMode === "existing" ? (
                <div className="space-y-2">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
                    <Input
                      value={openTeacherSearch}
                      onChange={(e) => setOpenTeacherSearch(e.target.value)}
                      placeholder="Rechercher un enseignant par nom..."
                      className="pl-9"
                    />
                  </div>
                  <div className="border border-line rounded-xl max-h-32 overflow-y-auto p-1.5 bg-canvas/30 space-y-1">
                    {teachers
                      .filter((t) =>
                        !openTeacherSearch ||
                        `${t.firstName} ${t.lastName} ${t.phone}`.toLowerCase().includes(openTeacherSearch.toLowerCase()),
                      )
                      .map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => { setOpenTeacherId(t.id); setOpenTeacherSearch(`${t.firstName} ${t.lastName}`); }}
                          className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                            openTeacherId === t.id ? "bg-primary text-white font-bold" : "hover:bg-primary-50 text-ink"
                          }`}
                        >
                          <span className="truncate">
                            {t.firstName} {t.lastName}
                            {t.isPassager && <span className="ml-1 opacity-70">(passager)</span>}
                          </span>
                          <span className={openTeacherId === t.id ? "text-white/80" : "text-muted"}>
                            {t.paymentType === "monthly"
                              ? "Mensuel"
                              : t.paymentType === "per_group"
                                ? "Par groupe"
                                : `${t.percentage ?? 0}%`}
                          </span>
                        </button>
                      ))}
                  </div>
                  <p className="text-[10px] text-muted leading-relaxed">
                    L&apos;enseignant est rémunéré sur cette séance libre exactement comme sur ses autres
                    séances (sa part est calculée à chaque présence selon son contrat).
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <Input
                    value={openPassagerName}
                    onChange={(e) => setOpenPassagerName(e.target.value)}
                    placeholder="Nom complet de l'enseignant passager"
                  />
                  <Input
                    value={openPassagerPhone}
                    onChange={(e) => setOpenPassagerPhone(e.target.value)}
                    placeholder="Téléphone (optionnel)"
                  />
                  <p className="text-[10px] text-muted leading-relaxed">
                    Il sera enregistré dans l&apos;interface <strong>Enseignants</strong> sans compte de connexion,
                    avec uniquement les actions <strong>Payer</strong> et <strong>Détails</strong>.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* ---- Right: when & how much -------------------------------- */}
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-semibold text-muted mb-1 font-sans">Début de la période *</label>
                <Input type="date" value={openPeriodStart} onChange={(e) => setOpenPeriodStart(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted mb-1 font-sans">Fin de la période *</label>
                <Input type="date" value={openPeriodEnd} onChange={(e) => setOpenPeriodEnd(e.target.value)} />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted mb-2 font-sans">
                Jours d&apos;étude dans cette période *
              </label>
              {daysAvailableInPeriod.length === 0 ? (
                <p className="text-[10px] text-muted italic border border-dashed border-line rounded-xl p-3">
                  Choisissez d&apos;abord la période : seuls les jours réellement présents dans cet
                  intervalle seront proposés.
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {WEEKDAYS.filter((d) => daysAvailableInPeriod.includes(d.key)).map((day) => {
                    const active = openDays.includes(day.key);
                    return (
                      <Button
                        key={day.key}
                        variant={active ? "primary" : "outline"}
                        onClick={() => setOpenDays(active ? openDays.filter((d) => d !== day.key) : [...openDays, day.key])}
                        size="sm"
                        className="w-full text-start py-2 justify-between"
                      >
                        <span>{day.label}</span>
                        {active && <span className="text-[10px] bg-white/25 px-1.5 rounded">✔</span>}
                      </Button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-semibold text-muted mb-1 font-sans">Heure de début</label>
                <div className="flex gap-1.5">
                  <Select value={openStartHour} onChange={(e) => setOpenStartHour(e.target.value)} className="flex-1">
                    {getHours().map((h) => <option key={h} value={h}>{h} H</option>)}
                  </Select>
                  <Select value={openStartMin} onChange={(e) => setOpenStartMin(e.target.value)} className="flex-1">
                    {getMinutes().map((m) => <option key={m} value={m}>{m} Min</option>)}
                  </Select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted mb-1 font-sans">Heure de fin</label>
                <div className="flex gap-1.5">
                  <Select value={openEndHour} onChange={(e) => setOpenEndHour(e.target.value)} className="flex-1">
                    {getHours().map((h) => <option key={h} value={h}>{h} H</option>)}
                  </Select>
                  <Select value={openEndMin} onChange={(e) => setOpenEndMin(e.target.value)} className="flex-1">
                    {getMinutes().map((m) => <option key={m} value={m}>{m} Min</option>)}
                  </Select>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted mb-1 font-sans">Prix d&apos;une séance (DA)</label>
              <Input
                type="number"
                min={0}
                value={openPrice || ""}
                onChange={(e) => setOpenPrice(Number(e.target.value))}
                placeholder="Ex: 800"
              />
              <p className="text-[10px] text-muted mt-1 leading-relaxed">
                Un abonnement est créé automatiquement à ce tarif : le créneau apparaîtra dans
                l&apos;interface <strong>Abonnements</strong> comme s&apos;il y avait été saisi à la main.
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted mb-1 font-sans">Nom du créneau</label>
              <Input
                value={openTitleOverride}
                onChange={(e) => setOpenTitleOverride(e.target.value)}
                placeholder={buildOpenTitle()}
              />
              <div className="bg-canvas/50 border border-line rounded-xl p-3 text-xs mt-2">
                <span className="text-[10px] text-muted block font-semibold mb-1 font-sans">Nom enregistré</span>
                <div className="font-bold text-ink break-words">{openTitleOverride.trim() || buildOpenTitle()}</div>
                {openSeanceCount > 0 && (
                  <div className="text-[10px] text-muted mt-1.5">
                    {openSeanceCount} séance(s) sur la période · {openClassIds.length} classe(s) ·{" "}
                    {openGroupIds.length} groupe(s) · {openSalleIds.length} salle(s)
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-6 mt-4 border-t border-line">
          <Button variant="outline" onClick={() => setIsOpenSeanceModalOpen(false)}>Annuler</Button>
          <Button onClick={handleSaveOpenSeance} disabled={savingOpenSeance}>
            {savingOpenSeance ? "Enregistrement..." : editingOpenSession ? "Enregistrer" : "Créer le créneau"}
          </Button>
        </div>
      </Modal>

      {/* Creation Modal */}
      <Modal open={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="Créer un nouvel emploi du temps" wide>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Left panel - core drop downs */}
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-muted mb-1 font-sans">Nom de l&apos;emploi du temps (optionnel)</label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex: Maths — Groupe A (Samedi matin)"
              />
              <p className="mt-1 text-[10px] text-muted">
                Laissez vide pour utiliser le nom du module. Ce nom apparaît partout où l&apos;emploi du temps est listé.
              </p>
            </div>
            {/* UN SEUL NIVEAU, OU PLUSIEURS.

                Le cas courant reste « une classe, ses groupes ». Mais un même
                créneau réunit parfois deux niveaux qui n'ont rien à voir — la
                4e année moyenne et la 3e année secondaire — chacun amenant SES
                groupes. Le second bouton ouvre ce mode. */}
            {renderLevelModeSwitch()}

            {!multiLevel && (
              <div>
                <label className="block text-xs font-semibold text-muted mb-1 font-sans">Classe</label>
                <Select value={classId} onChange={(e) => setClassId(e.target.value)} className="w-full">
                  <option value="">Sélectionner une classe</option>
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.type === "cours" ? c.coursLevel : c.formationLevel})
                    </option>
                  ))}
                </Select>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-semibold text-muted font-sans">Module</label>
                <button onClick={() => setShowAddModule(!showAddModule)} className="text-xs text-primary hover:underline">
                  + Nouveau module
                </button>
              </div>
              {showAddModule ? (
                <div className="flex gap-2">
                  <Input
                    value={newModuleName}
                    onChange={(e) => setNewModuleName(e.target.value)}
                    placeholder="Nom du module"
                    className="flex-1"
                  />
                  <Button size="sm" onClick={handleCreateModule}>Créer</Button>
                </div>
              ) : (
                <Select value={moduleId} onChange={(e) => setModuleId(e.target.value)} className="w-full">
                  <option value="">Sélectionner un module</option>
                  {modules.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </Select>
              )}
            </div>

            {multiLevel ? renderLevelsField() : renderGroupField()}

            {renderSalleField()}

            {renderTeacherField()}
          </div>

          {/* Right panel - days & times */}
          <div className="space-y-4">
            {renderDaysAndHours()}

            {/* Generated Name Preview */}
            <div className="bg-canvas/50 border border-line rounded-xl p-3 text-xs">
              <span className="text-[10px] text-muted block font-semibold mb-1 font-sans">Nom suggéré de l&apos;emploi du temps</span>
              <div className="font-bold text-ink line-clamp-2">
                {effectiveClassIds.length
                  ? effectiveClassIds
                      .map((cid) => classes.find((c) => c.id === cid)?.name ?? "?")
                      .join(" + ")
                  : "?"}{" "}
                -{" "}
                {moduleId ? getModuleName(moduleId) : "?"} (Gr:{" "}
                {effectiveGroupIds.length
                  ? effectiveGroupIds.map(getGroupName).join(" · ")
                  : "?"}{" "}
                / Salle: {salleId ? getSalleName(salleId) : "?"}) par{" "}
                {teacherId ? getTeacherName(teacherId) : "?"}
              </div>
            </div>
          </div>
        </div>


        {/* ---- Tarif de l'emploi du temps -----------------------------------
             Two figures are typed — the séances a month contains and what that
             month costs — and the rest is derived: the price of one séance,
             what the school keeps, what is left for the enseignant, and what he
             earns per séance. That last figure is what every règlement pays. */}
        <div className="mt-6 space-y-3 rounded-2xl border border-primary/25 bg-primary-50/25 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-primary">
              💰 Tarif de l&apos;emploi du temps
            </span>
            <span className="text-[10px] text-muted">
              Le mois d&apos;un élève s&apos;ouvre à sa 1<sup>re</sup> présence et se ferme à la
              dernière séance du pack.
            </span>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted">
                Nombre de séances du mois *
              </label>
              <Input
                type="number"
                min={0}
                value={monthSeances || ""}
                onChange={(e) => setMonthSeances(Math.max(0, Number(e.target.value) || 0))}
                placeholder="Ex: 8"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted">
                Prix total du mois (DA) *
              </label>
              <Input
                type="number"
                min={0}
                value={monthPrice || ""}
                onChange={(e) => setMonthPrice(readMoney(e.target.value))}
                step="0.01"
                placeholder="Ex: 4000"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted">
                Prix d&apos;une séance (calculé)
              </label>
              <div className="flex h-10 items-center rounded-xl border border-primary/40 bg-primary-50/60 px-3 text-sm font-black text-primary">
                {formatDA(pricePerSeance)}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted">
                Part de l&apos;école sur le mois (DA)
              </label>
              <Input
                type="number"
                min={0}
                max={monthPrice || undefined}
                value={schoolShare || ""}
                onChange={(e) => setSchoolShare(readMoney(e.target.value))}
                step="0.01"
                placeholder="Ex: 2200"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted">
                Reste pour l&apos;enseignant (calculé)
              </label>
              <div className="flex h-10 items-center rounded-xl border border-success/40 bg-success/10 px-3 text-sm font-black text-success">
                {formatDA(teacherShare)}
              </div>
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted">
                Séance payée à l&apos;enseignant (calculé)
              </label>
              <div className="flex h-10 items-center rounded-xl border border-success/40 bg-success/10 px-3 text-sm font-black text-success">
                {formatDA(teacherPerSeance)}
              </div>
            </div>
          </div>

          {monthSeances > 0 && monthPrice > 0 ? (
            <p className="rounded-xl border border-line bg-surface p-2.5 text-[10px] leading-relaxed text-muted">
              Un mois = <strong className="text-ink">{monthSeances} séances</strong> à{" "}
              <strong className="text-ink">{formatDA(monthPrice)}</strong> →{" "}
              <strong className="text-primary">{formatDA(pricePerSeance)} la séance</strong>. L&apos;école
              garde <strong className="text-ink">{formatDA(Math.min(schoolShare, monthPrice))}</strong>,
              l&apos;enseignant reçoit <strong className="text-success">{formatDA(teacherShare)}</strong>{" "}
              soit <strong className="text-success">{formatDA(teacherPerSeance)}</strong> par séance
              assurée — et l&apos;école <strong className="text-primary">{formatDA(schoolPerSeance)}</strong>{" "}
              par séance. Les divisions gardent leurs décimales : un mois qui ne tombe pas juste se
              répartit au centime, jamais arrondi au dinar.
            </p>
          ) : (
            <p className="rounded-xl border border-warning/40 bg-warning/10 p-2.5 text-[10px] text-warning">
              Sans nombre de séances ni prix du mois, l&apos;emploi du temps est créé sans tarif : aucun
              élève ne pourra y être inscrit tant qu&apos;il n&apos;en a pas un.
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-6 mt-4 border-t border-line">
          <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
            Annuler
          </Button>
          <Button onClick={handleCreateSession}>Créer</Button>
        </div>
      </Modal>

      {/* Edit Modal */}
      <Modal open={isEditOpen} onClose={() => setIsEditOpen(false)} title="Modifier l'emploi du temps" wide>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-muted mb-1 font-sans">Nom du créneau (optionnel)</label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex: Maths — Groupe A (Samedi matin)"
              />
              <p className="mt-1 text-[10px] text-muted">
                Laissez vide pour utiliser le nom du module.
              </p>
            </div>
            {/* UN SEUL NIVEAU, OU PLUSIEURS.

                Le cas courant reste « une classe, ses groupes ». Mais un même
                créneau réunit parfois deux niveaux qui n'ont rien à voir — la
                4e année moyenne et la 3e année secondaire — chacun amenant SES
                groupes. Le second bouton ouvre ce mode. */}
            {renderLevelModeSwitch()}

            {!multiLevel && (
              <div>
                <label className="block text-xs font-semibold text-muted mb-1 font-sans">Classe</label>
                <Select value={classId} onChange={(e) => setClassId(e.target.value)} className="w-full">
                  <option value="">Sélectionner une classe</option>
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.type === "cours" ? c.coursLevel : c.formationLevel})
                    </option>
                  ))}
                </Select>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-muted mb-1 font-sans">Module</label>
              <Select value={moduleId} onChange={(e) => setModuleId(e.target.value)} className="w-full">
                <option value="">Sélectionner un module</option>
                {modules.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </div>

            {multiLevel ? renderLevelsField() : renderGroupField()}

            {renderSalleField()}

            {renderTeacherField()}
          </div>

          <div className="space-y-4">
            {renderDaysAndHours()}
          </div>
        </div>


        {/* ---- Tarif de l'emploi du temps -----------------------------------
             Two figures are typed — the séances a month contains and what that
             month costs — and the rest is derived: the price of one séance,
             what the school keeps, what is left for the enseignant, and what he
             earns per séance. That last figure is what every règlement pays. */}
        <div className="mt-6 space-y-3 rounded-2xl border border-primary/25 bg-primary-50/25 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-primary">
              💰 Tarif de l&apos;emploi du temps
            </span>
            <span className="text-[10px] text-muted">
              Le mois d&apos;un élève s&apos;ouvre à sa 1<sup>re</sup> présence et se ferme à la
              dernière séance du pack.
            </span>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted">
                Nombre de séances du mois *
              </label>
              <Input
                type="number"
                min={0}
                value={monthSeances || ""}
                onChange={(e) => setMonthSeances(Math.max(0, Number(e.target.value) || 0))}
                placeholder="Ex: 8"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted">
                Prix total du mois (DA) *
              </label>
              <Input
                type="number"
                min={0}
                value={monthPrice || ""}
                onChange={(e) => setMonthPrice(readMoney(e.target.value))}
                step="0.01"
                placeholder="Ex: 4000"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted">
                Prix d&apos;une séance (calculé)
              </label>
              <div className="flex h-10 items-center rounded-xl border border-primary/40 bg-primary-50/60 px-3 text-sm font-black text-primary">
                {formatDA(pricePerSeance)}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted">
                Part de l&apos;école sur le mois (DA)
              </label>
              <Input
                type="number"
                min={0}
                max={monthPrice || undefined}
                value={schoolShare || ""}
                onChange={(e) => setSchoolShare(readMoney(e.target.value))}
                step="0.01"
                placeholder="Ex: 2200"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted">
                Reste pour l&apos;enseignant (calculé)
              </label>
              <div className="flex h-10 items-center rounded-xl border border-success/40 bg-success/10 px-3 text-sm font-black text-success">
                {formatDA(teacherShare)}
              </div>
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted">
                Séance payée à l&apos;enseignant (calculé)
              </label>
              <div className="flex h-10 items-center rounded-xl border border-success/40 bg-success/10 px-3 text-sm font-black text-success">
                {formatDA(teacherPerSeance)}
              </div>
            </div>
          </div>

          {monthSeances > 0 && monthPrice > 0 ? (
            <p className="rounded-xl border border-line bg-surface p-2.5 text-[10px] leading-relaxed text-muted">
              Un mois = <strong className="text-ink">{monthSeances} séances</strong> à{" "}
              <strong className="text-ink">{formatDA(monthPrice)}</strong> →{" "}
              <strong className="text-primary">{formatDA(pricePerSeance)} la séance</strong>. L&apos;école
              garde <strong className="text-ink">{formatDA(Math.min(schoolShare, monthPrice))}</strong>,
              l&apos;enseignant reçoit <strong className="text-success">{formatDA(teacherShare)}</strong>{" "}
              soit <strong className="text-success">{formatDA(teacherPerSeance)}</strong> par séance
              assurée — et l&apos;école <strong className="text-primary">{formatDA(schoolPerSeance)}</strong>{" "}
              par séance. Les divisions gardent leurs décimales : un mois qui ne tombe pas juste se
              répartit au centime, jamais arrondi au dinar.
            </p>
          ) : (
            <p className="rounded-xl border border-warning/40 bg-warning/10 p-2.5 text-[10px] text-warning">
              Sans nombre de séances ni prix du mois, l&apos;emploi du temps est créé sans tarif : aucun
              élève ne pourra y être inscrit tant qu&apos;il n&apos;en a pas un.
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-6 mt-4 border-t border-line">
          <Button variant="outline" onClick={() => setIsEditOpen(false)}>
            Annuler
          </Button>
          <Button onClick={handleEditSession}>Enregistrer</Button>
        </div>
      </Modal>

      {/* Details Modal */}
      <Modal open={isDetailsOpen} onClose={() => setIsDetailsOpen(false)} title="Détails de l'emploi du temps" wide>
        {selectedSession && (
          <div className="space-y-6">
            {selectedSession.isOpen && (
              <div className="rounded-xl border border-primary/25 bg-primary-50/40 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="text-[10px] text-primary block uppercase font-bold tracking-wider">
                      🎯 Créneau Séance Libre
                    </span>
                    <strong className="text-ink block text-sm break-words">{sessionTitle(selectedSession)}</strong>
                  </div>
                  <Badge tone={openSessionActive(selectedSession) ? "success" : "neutral"} className="font-bold">
                    {formatDateFr(selectedSession.periodStart)} → {formatDateFr(selectedSession.periodEnd)}
                  </Badge>
                </div>
                <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                  <div>
                    <span className="text-[10px] text-muted block uppercase">Tarif séance</span>
                    <strong className="text-primary">{formatDA(openSessionPrice(selectedSession))}</strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-muted block uppercase">Classes</span>
                    <strong className="text-ink">
                      {(selectedSession.classIds ?? [selectedSession.classId]).map(getClassName).join(" · ")}
                    </strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-muted block uppercase">Groupes</span>
                    <strong className="text-ink">
                      {sessionGroupIds(selectedSession).map(getGroupName).join(" · ")}
                    </strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-muted block uppercase">Salles</span>
                    <strong className="text-ink">
                      {(selectedSession.salleIds ?? [selectedSession.salleId]).map(getSalleName).join(" · ")}
                    </strong>
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-primary-50/50 rounded-xl p-4 border border-line">
              {selectedSession.title && (
                <div className="col-span-2 md:col-span-4">
                  <span className="text-[10px] text-muted block uppercase font-sans">Nom du créneau</span>
                  <span className="font-bold text-ink">{selectedSession.title}</span>
                </div>
              )}
              <div>
                <span className="text-[10px] text-muted block uppercase font-sans">Module / Matière</span>
                <span className="font-bold text-ink">{getModuleName(selectedSession.moduleId)}</span>
              </div>
              <div>
                <span className="text-[10px] text-muted block uppercase font-sans">Classe & Niveau</span>
                <span className="font-semibold text-ink">
                  {sessionClassIds(selectedSession).map(getClassName).join(" + ") || "—"}
                </span>
                {isMultiLevelSession(selectedSession) && (
                  <Badge tone="primary" className="mt-1 text-[9px]">
                    {sessionClassIds(selectedSession).length} niveaux réunis
                  </Badge>
                )}
              </div>
              <div>
                <span className="text-[10px] text-muted block uppercase font-sans">
                  Groupe(s) / Salle
                </span>
                <span className="font-semibold text-ink">
                  {sessionGroupIds(selectedSession).map(getGroupName).join(" · ") || "—"} -{" "}
                  {getSalleName(selectedSession.salleId)}
                </span>
                {/* Multi-niveaux : chaque niveau amène SES groupes, et c'est ce
                    découpage-là qu'il faut pouvoir relire. */}
                {isMultiLevelSession(selectedSession) && (
                  <span className="mt-1 block space-y-0.5">
                    {sessionClassIds(selectedSession).map((cid) => (
                      <span key={cid} className="block text-[10px] text-muted">
                        <strong className="text-ink">{getClassName(cid)}</strong> :{" "}
                        {sessionGroupsOfClass(selectedSession, cid).map(getGroupName).join(" · ") ||
                          "aucun groupe"}
                      </span>
                    ))}
                  </span>
                )}
              </div>
              <div>
                <span className="text-[10px] text-muted block uppercase font-sans">Enseignant</span>
                <span className="font-semibold text-ink">
                  {getTeacherName(selectedSession.teacherId)}
                  {teachers.find((t) => t.id === selectedSession.teacherId)?.isPassager && (
                    <Badge tone="warning" className="ml-1.5 text-[9px]">Passager</Badge>
                  )}
                </span>
              </div>
            </div>

            {/* Tarif — what the emploi costs, and how it is split. */}
            {(() => {
              const sub = subscriptions.find((x) => x.sessionId === selectedSession.id);
              if (!sub) {
                return (
                  <div className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-[11px] text-warning">
                    Aucun tarif défini pour cet emploi du temps — modifiez-le pour en fixer un.
                  </div>
                );
              }
              return (
                <div className="rounded-xl border border-primary/25 bg-primary-50/30 p-4">
                  <span className="mb-2 block text-[10px] font-bold uppercase tracking-wider text-primary">
                    💰 Tarif de l&apos;emploi du temps
                  </span>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                    <div>
                      <span className="block text-[10px] uppercase text-muted">Séances / mois</span>
                      <strong className="text-ink">{sub.monthlySeances ?? 0}</strong>
                    </div>
                    <div>
                      <span className="block text-[10px] uppercase text-muted">Prix du mois</span>
                      <strong className="text-ink">{formatDA(monthlyPriceOf(sub))}</strong>
                    </div>
                    <div>
                      <span className="block text-[10px] uppercase text-muted">Prix / séance</span>
                      <strong className="text-primary">{formatDA(sub.pricePerSession)}</strong>
                    </div>
                    <div>
                      <span className="block text-[10px] uppercase text-muted">Part école</span>
                      <strong className="text-ink">{formatDA(schoolMonthShareOf(sub))}</strong>
                    </div>
                    <div>
                      <span className="block text-[10px] uppercase text-muted">
                        Enseignant (mois / séance)
                      </span>
                      <strong className="text-success">
                        {formatDA(teacherMonthShareOf(sub))} · {formatDA(teacherPerSeanceOf(sub))}
                      </strong>
                    </div>
                  </div>
                </div>
              );
            })()}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h4 className="font-bold text-ink mb-2.5 flex items-center gap-1.5">
                  <Clock className="h-4 w-4 text-primary" /> Jours & Horaires
                </h4>
                <div className="bg-surface border border-line p-4 rounded-xl space-y-3">
                  {/* One line per day: an emploi may run at different hours
                      depending on the weekday. */}
                  <div>
                    <span className="text-[10px] text-muted block mb-1.5 font-sans">
                      Jours programmés et horaires:
                    </span>
                    <div className="space-y-1.5">
                      {WEEKDAYS.filter((wd) => selectedSession.days.includes(wd.key)).map((wd) => {
                        const { startTime, endTime } = sessionTimesOn(selectedSession, wd.key);
                        return (
                          <div
                            key={wd.key}
                            className="flex items-center justify-between gap-2 text-xs border-b border-line/60 pb-1.5 last:border-0 last:pb-0"
                          >
                            <Badge tone="primary" className="uppercase text-[9px] font-bold">
                              {wd.label}
                            </Badge>
                            <strong className="text-primary font-bold font-mono">
                              {startTime} – {endTime}
                            </strong>
                          </div>
                        );
                      })}
                      {selectedSession.days.length === 0 && (
                        <span className="text-xs text-muted">Aucun jour programmé.</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <h4 className="font-bold text-ink mb-2.5 flex items-center gap-1.5">
                  <Users className="h-4 w-4 text-primary" /> Étudiants Inscrits ({getSessionStudents(selectedSession.id).length})
                </h4>
                <div className="bg-surface border border-line p-3 rounded-xl max-h-48 overflow-y-auto space-y-2">
                  {getSessionStudents(selectedSession.id).length === 0 ? (
                    <p className="text-xs text-muted italic p-4 text-center">Aucun élève inscrit à cet emploi du temps.</p>
                  ) : (
                    getSessionStudents(selectedSession.id).map((stu) => (
                      <div key={stu.id} className="flex justify-between items-center text-xs bg-canvas/30 p-2.5 rounded-lg border border-line/50">
                        <div>
                          <span className="font-bold text-ink block">{stu.firstName} {stu.lastName}</span>
                          <span className="text-[10px] text-muted">{stu.phone}</span>
                        </div>
                        {(() => {
                          const sub = subscriptions.find((x) => x.sessionId === selectedSession.id);
                          const sold = sub ? soldFor(db, stu.id, sub.id) : 0;
                          // La gratuité se coche emploi par emploi : c'est CET
                          // emploi-là qui est offert, ou non.
                          const offered = isFreeSub(stu, sub?.id);
                          return (
                            <Badge
                              tone={offered ? "success" : sold < 0 ? "danger" : sold === 0 ? "warning" : "primary"}
                              className="font-bold"
                            >
                              {offered ? "Gratuit" : `Solde ${formatDA(sold)}`}
                            </Badge>
                          );
                        })()}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Admin actions block */}
            <div className="flex flex-col sm:flex-row justify-between items-center gap-4 pt-4 border-t border-line">
              <div className="flex gap-2">
                <Button variant="outline" className="flex items-center gap-1 text-xs text-ink" onClick={() => handlePrintSession(selectedSession)}>
                  <Printer className="h-4 w-4" /> Imprimer
                </Button>
                <Button
                  variant="outline"
                  className="flex items-center gap-1 text-xs text-ink"
                  onClick={() => (selectedSession.isOpen ? openEditOpenSeance(selectedSession) : openEdit(selectedSession))}
                >
                  <Edit className="h-4 w-4" /> Modifier
                </Button>
                <Button variant="outline" className="flex items-center gap-1 text-xs text-danger border-danger/20 hover:bg-danger/5" onClick={() => handleDelete(selectedSession.id)}>
                  <Trash2 className="h-4 w-4 text-danger" /> Supprimer l&apos;emploi du temps
                </Button>
              </div>
              <Button onClick={() => setIsDetailsOpen(false)}>Fermer</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
