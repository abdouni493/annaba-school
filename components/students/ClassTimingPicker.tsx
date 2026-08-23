"use client";

import { useMemo, useState } from "react";
import { Clock, GraduationCap, MapPin, Search, Users, X } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Input, Select } from "@/components/ui/SearchInput";
import { useData } from "@/lib/store/data";
import {
  COURS_LEVELS,
  courseKeyOf,
  coursLevelLabel,
  formatDays,
  groupName,
  hasMonthlyPlan,
  isFreeSub,
  moduleName,
  monthlyPriceOf,
  salleName,
  sessionTimeLabel,
  soldFor,
  teacherName,
} from "@/lib/helpers";
import { formatDA } from "@/lib/utils";
import type { CoursLevel, Student } from "@/lib/types";

/**
 * One sellable timing of a class: the schedule row plus the tariff it is sold
 * with. A timing without a subscription carries no price, so it can never be
 * enrolled on — it is simply not offered.
 */
export interface ClassTimingOption {
  /** subscription id — this is what gets stored on the student */
  subId: string;
  /** identity of the cours: same class, same module, same teacher */
  courseKey: string;
  /** every timing of that cours, this one included */
  siblingSubIds: string[];
  className: string;
  classId: string;
  moduleName: string;
  groupName: string;
  salleName: string;
  teacherName: string;
  daysLabel: string;
  time: string;
  price: number;
  hasMonthly: boolean;
  monthlySeances: number;
  monthlyPrice: number;
  isOpen: boolean;
  isFormation: boolean;
  periodMonths?: number;
  enrolled: number;
}

/** Level filter values: the four school levels plus formations. */
type LevelValue = CoursLevel | "formation";

/** Year options per school level (kindergarten uses sections). */
export function timingYearOptions(level: LevelValue): string[] {
  switch (level) {
    case "maternelle":
      return ["Petite section", "Moyenne section", "Grande section"];
    case "primaire":
      return ["1AP", "2AP", "3AP", "4AP", "5AP"];
    case "moyen":
      return ["1AM", "2AM", "3AM", "4AM"];
    case "lycee":
      return ["1AS", "2AS", "3AS"];
    default:
      return [];
  }
}

/**
 * Ticking a timing, as every enrollment screen does it. A cours is followed
 * through exactly ONE of its groups, so ticking another group of a cours the
 * student is already on MOVES him to it instead of enrolling — and billing —
 * him twice for the same cours. Ticking the one he is on removes it.
 */
export function toggleTimingSelection(
  selected: string[],
  option: { subId: string; siblingSubIds: string[] },
): string[] {
  const withoutCourse = selected.filter((id) => !option.siblingSubIds.includes(id));
  return selected.includes(option.subId) ? withoutCourse : [...withoutCourse, option.subId];
}

/** Timings and classes, ready to be listed. Shared by every screen that
 *  enrolls a student, so they all read the same catalogue. */
export function useClassTimings() {
  const { sessions, subscriptions, classes, modules, teachers, groups, salles, students } = useData();

  /** Every timing of ONE class, séances libres opened to it included. */
  const timingsOf = (classId: string): ClassTimingOption[] => {
    const cls0 = classes.find((c) => c.id === classId);
    const rows = sessions
      // Un emploi du temps supprimé n'est plus au catalogue : on ne peut plus y
      // inscrire personne, même si sa ligne reste en base pour l'historique.
      .filter((s) => !s.archivedAt)
      .filter((s) => s.classId === classId || s.classIds?.includes(classId))
      .flatMap((s) => {
        const sub = subscriptions.find((x) => x.sessionId === s.id);
        if (!sub || sub.archivedAt) return [];
        const cls = classes.find((c) => c.id === s.classId);
        const mod = modules.find((m) => m.id === s.moduleId)?.name ?? "Module";
        const t = teachers.find((te) => te.id === s.teacherId);
        const isFormation = cls?.type === "formation";
        return [
          {
            subId: sub.id,
            courseKey: courseKeyOf(s),
            siblingSubIds: [] as string[],
            className: cls0?.name ?? cls?.name ?? "-",
            classId,
            moduleName: s.isOpen && s.title ? s.title : s.title || mod,
            groupName: groups.find((g) => g.id === s.groupId)?.name ?? "-",
            salleName: salles.find((sl) => sl.id === s.salleId)?.name ?? "-",
            teacherName: t ? `${t.firstName} ${t.lastName}` : "-",
            daysLabel: formatDays(s.days) || "—",
            time: `${s.startTime}-${s.endTime}`,
            price: isFormation ? sub.levelPrice ?? 0 : sub.pricePerSession,
            hasMonthly: hasMonthlyPlan(sub),
            monthlySeances: sub.monthlySeances ?? 0,
            monthlyPrice: monthlyPriceOf(sub),
            isOpen: !!s.isOpen,
            isFormation: !!isFormation,
            periodMonths: sub.periodMonths,
            enrolled: students.filter((st) => st.subscriptionIds.includes(sub.id)).length,
          },
        ];
      });

    // A student follows a cours through exactly ONE of its groups: every timing
    // needs to know its siblings so ticking another one MOVES him instead of
    // enrolling (and billing) him twice on the same cours.
    return rows
      .map((row) => ({
        ...row,
        siblingSubIds: rows.filter((o) => o.courseKey === row.courseKey).map((o) => o.subId),
      }))
      .sort((a, b) => a.moduleName.localeCompare(b.moduleName) || a.time.localeCompare(b.time));
  };

  /** Every timing of every class of a given level (+ year), aggregated. This is
   *  the catalogue the enrollment picker lists once a level & year are chosen. */
  const timingsForLevelYear = (level: LevelValue, year: string): ClassTimingOption[] => {
    const matchingClasses = classes.filter((cls) => {
      if (level === "formation") return cls.type === "formation";
      return cls.type === "cours" && cls.coursLevel === level && (!year || cls.year === year);
    });
    const all = matchingClasses.flatMap((cls) => timingsOf(cls.id));
    // Re-derive siblings across the WHOLE aggregated set (two groups of the same
    // cours may sit in different classes of the same level).
    return all
      .map((row) => ({
        ...row,
        siblingSubIds: all.filter((o) => o.courseKey === row.courseKey).map((o) => o.subId),
      }))
      .sort(
        (a, b) =>
          a.className.localeCompare(b.className) ||
          a.moduleName.localeCompare(b.moduleName) ||
          a.time.localeCompare(b.time),
      );
  };

  /** Enrollment cost of ONE subscription: the month price for a monthly plan,
   *  the level price for a formation, otherwise the price of one séance. */
  const subCost = (subId: string): number => {
    const sub = subscriptions.find((s) => s.id === subId);
    if (!sub) return 0;
    if (hasMonthlyPlan(sub)) return monthlyPriceOf(sub);
    const session = sessions.find((se) => se.id === sub.sessionId);
    const cls = session && classes.find((c) => c.id === session.classId);
    if (cls?.type === "formation") return sub.levelPrice ?? 0;
    return sub.pricePerSession;
  };

  /**
   * The catalogue entry of ONE subscription — what the chips need to be able to
   * untick an emploi du temps without going back through its level and year.
   */
  const timingOf = (subId: string): ClassTimingOption | null => {
    const sub = subscriptions.find((s) => s.id === subId);
    const session = sub && sessions.find((se) => se.id === sub.sessionId);
    if (!session) return null;
    return timingsOf(session.classId).find((t) => t.subId === subId) ?? null;
  };

  /**
   * WHERE a subscription sits in the catalogue: the level and the year of its
   * class. The enrollment picker opens there when a student already follows it,
   * instead of on the default primaire/1AP where his emplois are invisible.
   */
  const levelYearOf = (subId: string): { level: LevelValue; year: string } | null => {
    const sub = subscriptions.find((s) => s.id === subId);
    const session = sub && sessions.find((se) => se.id === sub.sessionId);
    const cls = session && classes.find((c) => c.id === session.classId);
    if (!cls) return null;
    if (cls.type === "formation") return { level: "formation", year: "" };
    return { level: (cls.coursLevel ?? "primaire") as LevelValue, year: cls.year ?? "" };
  };

  /** Human label of a subscription (module · group), for the selected chips. */
  const subLabel = (subId: string): string => {
    const sub = subscriptions.find((s) => s.id === subId);
    if (!sub) return "—";
    const session = sessions.find((se) => se.id === sub.sessionId);
    if (!session) return "—";
    const mod = session.title || modules.find((m) => m.id === session.moduleId)?.name || "Module";
    const grp = groups.find((g) => g.id === session.groupId)?.name ?? "";
    return grp ? `${mod} · ${grp}` : mod;
  };

  return { timingsOf, timingsForLevelYear, timingOf, levelYearOf, subCost, subLabel };
}

/**
 * « OÙ EN EST-IL, LÀ, MAINTENANT ? » — les inscriptions en cours de l'élève,
 * écrites en toutes lettres au-dessus du catalogue.
 *
 * Avant de déplacer un enfant, la réception a besoin de voir ce qu'il suit
 * DÉJÀ : dans quelle classe, sur quelle année, sur quels emplois du temps, avec
 * quel enseignant et à quelles heures. Sans ce rappel, cocher un créneau dans la
 * liste du dessous relève du pari — c'est justement ainsi qu'on inscrit un élève
 * de 4AP sur un créneau de 3AP sans s'en apercevoir.
 *
 * Le tableau lit la SÉLECTION EN COURS, pas seulement ce qui est enregistré :
 * dans un écran de modification, il montre donc l'état dans lequel la fiche sera
 * sauvegardée, ligne ajoutée comprise. Chaque ligne se retire d'un clic.
 */
export function CurrentInscriptions({
  subIds,
  student,
  savedSubIds,
  onRemove,
  title = "Inscriptions actuelles de l'élève",
}: {
  /** les emplois du temps cochés — ce que la fiche portera une fois enregistrée */
  subIds: string[];
  /** la fiche, quand elle existe : elle apporte le solde et les cas de gratuité */
  student?: Student | null;
  /** ce que la fiche porte DÉJÀ en base, pour distinguer les ajouts en attente */
  savedSubIds?: string[];
  /** retirer cet emploi du temps de la sélection */
  onRemove?: (subId: string) => void;
  title?: string;
}) {
  const db = useData();
  const { subscriptions, sessions, classes } = db;

  const rows = subIds.flatMap((subId) => {
    const sub = subscriptions.find((s) => s.id === subId);
    if (!sub) return [];
    const session = sessions.find((s) => s.id === sub.sessionId);
    if (!session) return [];
    const cls = classes.find((c) => c.id === session.classId);
    return [
      {
        subId,
        label: session.title || moduleName(db, session.moduleId) || "Emploi du temps",
        className: cls?.name ?? "—",
        levelLabel:
          cls?.type === "formation"
            ? `Formation ${cls.formationLevel ?? ""}`.trim()
            : coursLevelLabel(cls?.coursLevel) || "—",
        year: cls?.type === "formation" ? "" : cls?.year ?? "",
        groupName: groupName(db, session.groupId),
        salleName: salleName(db, session.salleId),
        teacherName: teacherName(db, session.teacherId),
        daysLabel: formatDays(session.days) || "—",
        timeLabel: sessionTimeLabel(session),
        unitPrice: sub.pricePerSession,
        balance: student ? soldFor(db, student.id, subId) : 0,
        offered: student ? isFreeSub(student, subId) : false,
        archived: !!session.archivedAt,
        pending: savedSubIds ? !savedSubIds.includes(subId) : false,
      },
    ];
  });

  return (
    <div className="rounded-xl border border-primary/25 bg-primary-50/25 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-primary">
          <GraduationCap className="h-3.5 w-3.5" /> {title}
        </span>
        <span className="text-[10px] font-semibold text-muted">
          {rows.length} emploi(s) du temps
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="py-3 text-center text-[11px] italic text-muted">
          Aucun emploi du temps pour l&apos;instant — choisissez-en un dans la liste ci-dessous.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full min-w-[760px] text-[11px]">
            <thead className="bg-canvas/60">
              <tr className="text-left text-[9px] uppercase tracking-wide text-muted">
                <th className="px-2 py-1.5">Classe</th>
                <th className="px-2 py-1.5">Niveau / Année</th>
                <th className="px-2 py-1.5">Emploi du temps</th>
                <th className="px-2 py-1.5">Groupe</th>
                <th className="px-2 py-1.5">Jours &amp; heures</th>
                <th className="px-2 py-1.5">Enseignant</th>
                <th className="px-2 py-1.5 text-right">Séance</th>
                {student && <th className="px-2 py-1.5 text-right">Solde</th>}
                {onRemove && <th className="px-2 py-1.5 text-right">Action</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.subId} className="border-t border-line/50">
                  <td className="px-2 py-1.5 font-semibold text-ink">{r.className}</td>
                  <td className="px-2 py-1.5 text-muted">
                    {r.levelLabel}
                    {r.year ? ` · ${r.year}` : ""}
                  </td>
                  <td className="px-2 py-1.5">
                    <strong className="text-ink">{r.label}</strong>
                    <span className="flex flex-wrap gap-1">
                      {r.pending && (
                        <Badge tone="warning" className="text-[8px]">
                          à enregistrer
                        </Badge>
                      )}
                      {r.offered && (
                        <Badge tone="success" className="text-[8px]">
                          offert
                        </Badge>
                      )}
                      {r.archived && (
                        <Badge tone="neutral" className="text-[8px]">
                          emploi supprimé
                        </Badge>
                      )}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-muted">{r.groupName}</td>
                  <td className="px-2 py-1.5 text-muted">
                    {r.daysLabel}
                    <span className="block font-mono text-[9px]">{r.timeLabel}</span>
                    <span className="block text-[9px]">Salle {r.salleName}</span>
                  </td>
                  <td className="px-2 py-1.5 text-muted">{r.teacherName}</td>
                  <td className="px-2 py-1.5 text-right font-mono">{formatDA(r.unitPrice)}</td>
                  {student && (
                    <td className="px-2 py-1.5 text-right font-mono">
                      <span className={r.balance < 0 ? "text-danger" : "text-success"}>
                        {r.balance < 0
                          ? `${formatDA(-r.balance)} dus`
                          : `${formatDA(r.balance)} d'avance`}
                      </span>
                    </td>
                  )}
                  {onRemove && (
                    <td className="px-2 py-1.5 text-right">
                      <button
                        type="button"
                        onClick={() => onRemove(r.subId)}
                        title="Retirer cet emploi du temps — son historique reste sur sa fiche"
                        className="inline-flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-[9px] font-bold text-danger transition-colors hover:bg-danger/10"
                      >
                        <X className="h-3 w-3" /> Retirer
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * Enrollment picker following your flow: pick the class LEVEL, then the YEAR,
 * then every timing of that level/year is listed — searchable by name — and one
 * or several can be ticked. The running total cost of what is ticked is shown
 * so reception knows what to charge (or leave to pay after the séances).
 */
export function ClassTimingPicker({
  selectedSubIds,
  onToggle,
  showTotal = true,
  student,
  savedSubIds,
  showCurrent = false,
}: {
  selectedSubIds: string[];
  /** The option carries `siblingSubIds`: the other groups of the same cours,
   *  which the caller drops when the student is moved from one to another. */
  onToggle: (option: ClassTimingOption) => void;
  showTotal?: boolean;
  /** la fiche concernée : elle fait apparaître ses soldes sur le rappel du haut */
  student?: Student | null;
  /** ce que la fiche porte DÉJÀ en base, pour marquer les ajouts en attente */
  savedSubIds?: string[];
  /** rappeler EN HAUT la classe, l'année et les emplois du temps actuels */
  showCurrent?: boolean;
}) {
  const { timingsForLevelYear, timingOf, levelYearOf, subCost, subLabel } = useClassTimings();
  /**
   * L'écran s'ouvre LÀ OÙ L'ÉLÈVE EST DÉJÀ : le niveau et l'année de sa première
   * inscription. En modification, ses emplois du temps sont donc visibles et
   * décochables tout de suite, au lieu d'être cachés derrière un primaire/1AP
   * qui ne le concerne pas.
   */
  const start = useMemo(
    () => (selectedSubIds.length ? levelYearOf(selectedSubIds[0]) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [level, setLevel] = useState<LevelValue>(start?.level ?? "primaire");
  const [year, setYear] = useState<string>(
    start?.year || timingYearOptions(start?.level ?? "primaire")[0] || "",
  );
  const [search, setSearch] = useState("");

  const years = timingYearOptions(level);
  const timings = useMemo(
    () => timingsForLevelYear(level, level === "formation" ? "" : year),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [level, year],
  );

  const q = search.trim().toLowerCase();
  const shown = q
    ? timings.filter((t) =>
        `${t.moduleName} ${t.groupName} ${t.teacherName} ${t.salleName} ${t.className} ${t.daysLabel} ${t.time}`
          .toLowerCase()
          .includes(q),
      )
    : timings;

  const totalCost = selectedSubIds.reduce((s, id) => s + subCost(id), 0);

  return (
    <div className="space-y-3">
      {/* Ce qu'il suit DÉJÀ — classe, année, créneaux — avant de toucher à quoi
          que ce soit. Sans ce rappel, on coche à l'aveugle. */}
      {showCurrent && (
        <CurrentInscriptions
          subIds={selectedSubIds}
          student={student}
          savedSubIds={savedSubIds}
          onRemove={(subId) => {
            const option = timingOf(subId);
            if (option) onToggle(option);
          }}
        />
      )}

      {/* Step 1 + 2: level and year */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted">
            1. Niveau
          </label>
          <Select
            value={level}
            onChange={(e) => {
              const lv = e.target.value as LevelValue;
              setLevel(lv);
              setYear(timingYearOptions(lv)[0] ?? "");
            }}
            className="w-full"
          >
            {COURS_LEVELS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
            <option value="formation">Formation</option>
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted">
            2. {level === "maternelle" ? "Section" : "Année"}
          </label>
          <Select
            value={year}
            onChange={(e) => setYear(e.target.value)}
            className="w-full"
            disabled={level === "formation"}
          >
            {level === "formation" ? (
              <option value="">Toutes</option>
            ) : (
              years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))
            )}
          </Select>
        </div>
      </div>

      {/* Step 3: search the timings of that level/year */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher un créneau par nom (module, enseignant, groupe...)"
          className="pl-9"
        />
      </div>

      {/* Timings — tick one or several */}
      <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-xl border border-primary/25 bg-primary-50/20 p-2">
        {shown.length === 0 ? (
          <p className="p-2 text-[11px] italic text-muted">
            Aucun créneau tarifé pour ce niveau/cette année. Les créneaux et leurs tarifs se
            définissent sur les pages Emploi du temps et Abonnements.
          </p>
        ) : (
          shown.map((t) => {
            const picked = selectedSubIds.includes(t.subId);
            const moves =
              !picked && t.siblingSubIds.some((id) => id !== t.subId && selectedSubIds.includes(id));
            return (
              <button
                key={t.subId}
                type="button"
                onClick={() => onToggle(t)}
                className={`flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border p-2 text-start text-[11px] transition-colors ${
                  picked
                    ? "border-primary bg-primary text-white"
                    : "border-line bg-surface text-ink hover:bg-primary-50"
                }`}
              >
                <span className="min-w-0">
                  <strong className="block">
                    {t.moduleName} · {t.groupName}
                    <span className={`ml-1.5 text-[9px] ${picked ? "text-white/80" : "text-muted"}`}>
                      ({t.className})
                    </span>
                    {t.isOpen && (
                      <span
                        className={`ml-1.5 rounded px-1.5 py-0.5 text-[9px] font-bold ${
                          picked ? "bg-white/20 text-white" : "bg-success/15 text-success"
                        }`}
                      >
                        Séance libre
                      </span>
                    )}
                    {moves && (
                      <span className="ml-1.5 rounded bg-warning/15 px-1.5 py-0.5 text-[9px] font-bold text-warning">
                        Change de groupe
                      </span>
                    )}
                  </strong>
                  <span
                    className={`mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 ${
                      picked ? "text-white/85" : "text-muted"
                    }`}
                  >
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" /> {t.daysLabel} · {t.time}
                    </span>
                    <span className="flex items-center gap-1">
                      <MapPin className="h-3 w-3" /> {t.salleName}
                    </span>
                    <span className="flex items-center gap-1">
                      <Users className="h-3 w-3" /> {t.enrolled} inscrit(s)
                    </span>
                    <span>Ens: {t.teacherName}</span>
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-end">
                    <strong className="block">
                      {t.price} DA
                      {t.isFormation ? ` / ${t.periodMonths} mois` : " / séance"}
                    </strong>
                    {t.hasMonthly && (
                      <span className={picked ? "text-white/80" : "text-warning"}>
                        {t.monthlySeances} séances · {t.monthlyPrice} DA / mois
                      </span>
                    )}
                  </span>
                  <input type="checkbox" checked={picked} readOnly className="h-4 w-4" />
                </span>
              </button>
            );
          })
        )}
      </div>

      {/* Total cost of what is ticked */}
      {showTotal && (
        <div className="flex items-center justify-between rounded-xl border border-line bg-surface px-3 py-2 text-xs">
          <span className="font-semibold text-muted">
            {selectedSubIds.length} créneau(x) sélectionné(s)
          </span>
          <span className="text-sm font-black text-primary">Coût total : {formatDA(totalCost)}</span>
        </div>
      )}

      {/* Les créneaux cochés — y compris ceux d'un AUTRE niveau que celui affiché.
          Un clic sur la croix les décoche sans avoir à retrouver leur niveau et
          leur année dans la liste. */}
      {selectedSubIds.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedSubIds.map((id) => {
            const option = timingOf(id);
            return (
              <span
                key={id}
                className="flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary-50/50 px-2 py-1 text-[10px] font-semibold text-ink"
              >
                {subLabel(id)} · {formatDA(subCost(id))}
                {option && (
                  <button
                    type="button"
                    title="Retirer cet emploi du temps"
                    onClick={() => onToggle(option)}
                    className="flex h-4 w-4 items-center justify-center rounded text-muted transition-colors hover:bg-danger/15 hover:text-danger"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
