"use client";

/**
 * « Situation d'un élève » — la question que la réception pose vingt fois par
 * jour, en trois clics et sans quitter son écran.
 *
 *   on cherche l'élève (nom, n° d'inscription ou téléphone)
 *      -> UN SEUL GRAND TABLEAU, lu comme la feuille de présence d'un groupe :
 *         TOUS ses emplois du temps d'abord — ceux qu'il suit ET ceux qu'il a
 *         quittés — avec ses séances du mois, ce qu'il a versé, ce qui reste dû,
 *         ce qu'il traîne des mois précédents et le solde de cet emploi ;
 *      -> deux filtres au-dessus du tableau resserrent la lecture : UN emploi
 *         du temps précis, et UN mois précis ;
 *      -> on encaisse sur place, sur la ligne concernée, avec son reçu.
 *
 * LES DEUX FAÇONS DE CHOISIR UN MOIS, parce que les deux sont vraies.
 *
 * Deux emplois du temps ne vivent pas le même mois au même moment : l'un en est
 * à son M5, l'autre à son M2. Le filtre propose donc :
 *  - un DÉCALAGE (« mois en cours », « 1 mois avant » …), qui recule d'un cran
 *    sur CHAQUE ligne et reste juste quand on les lit toutes ensemble ;
 *  - un MOIS PRÉCIS (M1, M2 …), qui est ce qu'on veut dès qu'on a isolé un seul
 *    emploi du temps : « montre-moi son M3 ».
 * Les flèches ‹ › déplacent celui des deux qui est actif.
 */

import { useMemo, useState } from "react";
import { useData } from "@/lib/store/data";
import { useSettings } from "@/lib/store/settings";
import { useToast } from "@/lib/store/toast";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input, Select } from "@/components/ui/SearchInput";
import { PrintAsk } from "@/components/attendance/PresenceSheet";
import { SeanceStepper } from "@/components/students/SeanceStepper";
import { soldReceiptHtml } from "@/lib/reports/documents";
import { formatDA, money, positiveMoney } from "@/lib/utils";
import {
  BookOpen,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  History,
  Layers,
  Search,
  Ticket,
  UserMinus,
  Wallet,
} from "lucide-react";
import type { AttendanceRecord, AttendanceStatus, Student } from "@/lib/types";
import {
  currentCycleIndex,
  cycleLead,
  cycleOf,
  cycleSizeOf,
  cycleSlots,
  formatDateFr,
  formatDays,
  groupName,
  independentTotals,
  moduleName as moduleNameOf,
  monthCodeLabel,
  registrationNumberOf,
  salleName,
  sessionSalleOn,
  sessionTimeLabel,
  soldFor,
  studentCaseLabel,
  studentCaseTone,
  isFreeSub,
  studentIsMaternelle,
  studentListPrice,
  studentMatches,
  studentName,
  studentPassagerVisits,
  studentSubscriptionHistory,
  teacherName,
  todayIso,
  unsubscribedAtOf,
} from "@/lib/helpers";

const STATUS_LABEL: Record<AttendanceStatus, { short: string; label: string; cls: string }> = {
  present: { short: "P", label: "Présent", cls: "bg-success/15 text-success border-success/40" },
  late: { short: "R", label: "Retard", cls: "bg-warning/15 text-warning border-warning/40" },
  absent: { short: "A", label: "Absent", cls: "bg-danger/15 text-danger border-danger/40" },
  cancelled: { short: "×", label: "Annulée", cls: "bg-primary/15 text-primary border-primary/40" },
};

/** Une ligne du tableau : UN emploi du temps de l'élève, sur le mois affiché. */
interface SituationRow {
  subId: string;
  sessionId: string;
  label: string;
  groupName: string;
  salleName: string;
  teacherName: string;
  daysLabel: string;
  timeLabel: string;
  active: boolean;
  leftOn?: string;
  /** le mois de CET emploi qui correspond au décalage choisi */
  code: string;
  index: number;
  currentIndex: number;
  size: number;
  lead: number;
  slots: AttendanceRecord[];
  unitPrice: number;
  /** cet emploi du temps lui est OFFERT (la gratuité se coche module par
   *  module : les autres restent payants) */
  offered: boolean;
  done: number;
  presents: number;
  absents: number;
  cancelled: number;
  consumed: number;
  credited: number;
  /** ce qu'il doit encore sur CE mois */
  due: number;
  /** ce qu'il a d'avance sur ce mois */
  advance: number;
  complete: boolean;
  /** ce que les mois PRÉCÉDENTS de cet emploi doivent encore */
  previousDue: number;
  /** le solde de l'emploi, tous mois confondus */
  balance: number;
}

/** Ce que la modale d'encaissement porte le temps de la saisie. */
interface PayTarget {
  subId: string;
  label: string;
  monthCode: string;
  amount: number;
  suggestion: number;
  description?: string;
  /**
   * LE JOUR DE L'ENCAISSEMENT. La réception règle parfois pour la veille — le
   * versement, son reçu et la caisse portent alors cette date-là, et non celle
   * de la saisie. Absent = aujourd'hui.
   */
  date?: string;
}

/**
 * LE FILTRE DE MOIS, dans les deux langues que cet écran doit parler :
 *  - `{ kind: "back", offset }` : un DÉCALAGE appliqué à chaque emploi du temps
 *    (0 = le mois en cours de chacun) ;
 *  - `{ kind: "fixed", index }` : LE mois M(index+1), le même pour tous.
 */
type MonthFilter = { kind: "back"; offset: number } | { kind: "fixed"; index: number };

const MONTH_FILTER_CURRENT: MonthFilter = { kind: "back", offset: 0 };

/** La valeur du <select> — « current », « back:2 » ou « M3 ». */
function monthFilterValue(f: MonthFilter): string {
  if (f.kind === "fixed") return `M${f.index + 1}`;
  return f.offset === 0 ? "current" : `back:${f.offset}`;
}

function parseMonthFilter(value: string): MonthFilter {
  if (value === "current") return MONTH_FILTER_CURRENT;
  if (value.startsWith("back:")) return { kind: "back", offset: Number(value.slice(5)) || 0 };
  const n = Number(value.replace(/^M/, ""));
  return Number.isFinite(n) && n > 0 ? { kind: "fixed", index: n - 1 } : MONTH_FILTER_CURRENT;
}

/** Ce que le navigateur affiche entre ses deux flèches. */
function monthFilterLabel(f: MonthFilter): string {
  if (f.kind === "fixed") return monthCodeLabel(`M${f.index + 1}`);
  if (f.offset === 0) return "Mois en cours";
  return f.offset === 1 ? "1 mois avant" : `${f.offset} mois avant`;
}

/**
 * CONSULTER N'EST PAS ENCAISSER.
 *
 * « Situation d'un élève » est un écran de LECTURE : on y répond à « il en est
 * où ? ». Prendre de l'argent est un geste distinct, et l'administration le
 * coche séparément sur la fiche du travailleur. L'écran s'ouvrait pourtant avec
 * son bouton « Encaisser » pour tout le monde : un compte autorisé à consulter
 * pouvait encaisser sans que ce droit lui ait jamais été donné.
 *
 * `canCollect` absent = l'appelant ne filtre pas (l'administration).
 */
export function StudentSituationModal({
  onClose,
  canCollect = true,
}: {
  onClose: () => void;
  canCollect?: boolean;
}) {
  const db = useData();
  const { addSold } = db;
  const { language } = useSettings();
  const { addToast } = useToast();

  const [query, setQuery] = useState("");
  const [student, setStudent] = useState<Student | null>(null);
  /** Décalage relatif OU mois précis — voir `MonthFilter`. */
  const [month, setMonth] = useState<MonthFilter>(MONTH_FILTER_CURRENT);
  /** « all » = tous ses emplois du temps, sinon l'id d'UN tarif. */
  const [emploi, setEmploi] = useState<string>("all");
  const [pay, setPay] = useState<PayTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<string | null>(null);

  /** encaissement groupé — réservé à la maternelle (voir plus bas). */
  const [groupOpen, setGroupOpen] = useState(false);
  const [groupDate, setGroupDate] = useState(todayIso());
  const [groupBusy, setGroupBusy] = useState(false);
  const [groupSel, setGroupSel] = useState<Record<string, boolean>>({});
  const [groupAmt, setGroupAmt] = useState<Record<string, number>>({});
  const [groupMonth, setGroupMonth] = useState<Record<string, string>>({});

  const matches = useMemo(() => {
    const q = query.trim();
    if (!q) return [] as Student[];
    return db.students
      .filter((st) => studentMatches(db, st, q))
      .sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`))
      .slice(0, 40);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db.students, query]);

  /** Tous ses emplois du temps — actuels ET quittés — sur le mois affiché. */
  const rows = useMemo<SituationRow[]>(() => {
    if (!student) return [];
    return studentSubscriptionHistory(db, student).map((subId) => {
      const sub = db.subscriptions.find((x) => x.id === subId)!;
      const session = db.sessions.find((x) => x.id === sub.sessionId);
      const currentIndex = currentCycleIndex(db, student.id, subId);
      // En DÉCALAGE, on ne descend jamais sous le premier mois de l'emploi ; en
      // MOIS PRÉCIS, on montre le mois demandé tel quel, même si cet emploi du
      // temps ne l'a pas encore atteint — la ligne dit alors qu'il est à venir
      // plutôt que d'afficher en douce un autre mois.
      const index =
        month.kind === "fixed" ? month.index : Math.max(0, currentIndex - month.offset);
      const code = `M${index + 1}`;
      const cycle = cycleOf(db, student.id, subId, code);
      const slots = cycleSlots(db, student.id, subId, code);
      const previousDue = Array.from({ length: index }, (_, i) =>
        Math.max(0, -cycleOf(db, student.id, subId, `M${i + 1}`).balance),
      ).reduce((s, v) => s + v, 0);

      return {
        subId,
        sessionId: sub.sessionId,
        label: session?.title || moduleNameOf(db, session?.moduleId ?? "") || "Emploi du temps",
        groupName: groupName(db, session?.groupId ?? ""),
        salleName: session ? salleName(db, sessionSalleOn(session, session.days[0])) : "—",
        teacherName: teacherName(db, session?.teacherId ?? ""),
        daysLabel: formatDays(session?.days ?? []) || "—",
        timeLabel: session ? sessionTimeLabel(session) : "—",
        active: student.subscriptionIds.includes(subId),
        leftOn: unsubscribedAtOf(db, student.id, subId),
        code,
        index,
        currentIndex,
        size: cycleSizeOf(sub),
        lead: cycleLead(db, student.id, subId, code),
        slots,
        unitPrice: studentListPrice(student, sub),
        offered: isFreeSub(student, subId),
        done: cycle.done,
        presents: slots.filter((a) => a.status === "present" || a.status === "late").length,
        absents: slots.filter((a) => a.status === "absent").length,
        cancelled: slots.filter((a) => a.status === "cancelled").length,
        consumed: cycle.consumed,
        credited: cycle.credited,
        due: Math.max(0, -cycle.balance),
        advance: Math.max(0, cycle.balance),
        complete: cycle.complete,
        previousDue,
        balance: soldFor(db, student.id, subId),
      } satisfies SituationRow;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [student, month, db.subscriptions, db.sessions, db.students, db.attendance, db.payments, db.enrollments]);

  /**
   * SES SÉANCES LIBRES — celles suivies SANS être inscrit sur l'emploi du
   * temps qui les portait. Elles n'ont ni solde ni mois, donc aucune ligne
   * du tableau ci-dessus ne les montre ; c'est ici, sur SA fiche, qu'elles
   * doivent rester lisibles.
   */
  const passagerVisits = useMemo(
    () => (student ? studentPassagerVisits(db, student.id) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [student, db.independent],
  );

  /**
   * CE QUE LE TABLEAU MONTRE VRAIMENT : tous ses emplois du temps par défaut,
   * un seul dès qu'on en choisit un. Les totaux, les colonnes de séances et le
   * navigateur de mois suivent CETTE liste — sans quoi l'écran annoncerait
   * « reste 6 000 DA » au-dessus d'un tableau qui n'en montre que 2 000.
   */
  const visibleRows = emploi === "all" ? rows : rows.filter((r) => r.subId === emploi);

  const slotCount = visibleRows.reduce(
    (mx, r) => Math.max(mx, r.size, r.lead + r.slots.length),
    0,
  );
  const totalDue = visibleRows.reduce((s, r) => s + r.due, 0);
  const totalPrevious = visibleRows.reduce((s, r) => s + r.previousDue, 0);
  const totalCredited = visibleRows.reduce((s, r) => s + r.credited, 0);
  /** Le décalage ne peut pas remonter plus haut que le plus vieux mois lisible. */
  const maxBack = rows.reduce((mx, r) => Math.max(mx, r.currentIndex), 0);
  /** Le mois le plus avancé qu'un de ses emplois du temps ait atteint. */
  const maxMonth = maxBack + 1;

  /** Reculer / avancer d'un cran, dans la langue du filtre actif. */
  const stepMonth = (delta: -1 | 1) =>
    setMonth((m) =>
      m.kind === "fixed"
        ? { kind: "fixed", index: Math.max(0, m.index + delta) }
        : { kind: "back", offset: Math.min(maxBack, Math.max(0, m.offset - delta)) },
    );

  const atOldest = month.kind === "fixed" ? month.index === 0 : month.offset >= maxBack;
  const atNewest = month.kind === "fixed" ? month.index >= maxBack : month.offset === 0;

  const pick = (st: Student) => {
    setStudent(st);
    setMonth(MONTH_FILTER_CURRENT);
    setEmploi("all");
  };

  const submitPay = async () => {
    if (!pay || !student) return;
    // Le bouton est masqué, mais c'est ICI que le refus doit vivre : un état
    // resté ouvert pendant qu'on retire le droit ne doit pas encaisser quand
    // même.
    if (!canCollect) {
      addToast({
        type: "danger",
        title: "Action non autorisée",
        message: "Votre compte n'a pas le droit d'encaisser un paiement.",
      });
      setPay(null);
      return;
    }
    const amount = positiveMoney(pay.amount || 0);
    if (amount <= 0) {
      addToast({ type: "danger", title: "Montant invalide", message: "Saisissez un montant." });
      return;
    }
    setBusy(true);
    const res = await addSold({
      studentId: student.id,
      subscriptionId: pay.subId,
      amount,
      monthCode: pay.monthCode,
      description: pay.description,
      date: pay.date,
    });
    setBusy(false);
    if (!res.ok) {
      addToast({ type: "danger", title: "Échec", message: "Le paiement n'a pas pu être enregistré." });
      return;
    }
    const left = res.balance ?? 0;
    addToast({
      type: "success",
      title: "Paiement encaissé",
      message:
        `${formatDA(amount)} sur ${pay.label} (${pay.monthCode}) — ` +
        (left < 0
          ? `il doit encore ${formatDA(-left)}`
          : `${formatDA(left)} d'avance conservés sur cet emploi du temps`),
      studentName: studentName(student),
    });
    setReceipt(
      soldReceiptHtml(db, {
        student,
        language,
        lines: [
          {
            label: pay.label,
            monthCode: res.monthCode ?? pay.monthCode,
            amount,
          },
        ],
        note: pay.description,
      }),
    );
    setPay(null);
  };

  /**
   * ENCAISSEMENT GROUPÉ — RÉSERVÉ À LA MATERNELLE.
   *
   * À la maternelle, une famille règle souvent tous les créneaux de l'enfant
   * d'un coup. On coche les emplois du temps, on ajuste chaque montant, et tout
   * part sur UN seul reçu qui liste chaque emploi du temps, son prix, et le
   * total. Les autres niveaux gardent l'encaissement ligne par ligne.
   */
  const isMaternelle = !!student && studentIsMaternelle(db, student);
  /** les emplois du temps qu'il suit ENCORE et qui sont payants */
  const payableRows = rows.filter((r) => r.active && !r.offered);

  const openGroupPay = () => {
    if (!student) return;
    const sel: Record<string, boolean> = {};
    const amt: Record<string, number> = {};
    const mon: Record<string, string> = {};
    for (const r of payableRows) {
      const code = `M${r.currentIndex + 1}`;
      const due = Math.max(0, -cycleOf(db, student.id, r.subId, code).balance);
      sel[r.subId] = due > 0;
      amt[r.subId] = due || 0;
      mon[r.subId] = code;
    }
    setGroupSel(sel);
    setGroupAmt(amt);
    setGroupMonth(mon);
    setGroupDate(todayIso());
    setGroupOpen(true);
  };

  const groupChosen = payableRows.filter(
    (r) => groupSel[r.subId] && money(groupAmt[r.subId] || 0) > 0,
  );
  const groupTotal = money(groupChosen.reduce((s, r) => s + money(groupAmt[r.subId] || 0), 0));

  const submitGroup = async () => {
    if (!student) return;
    if (!canCollect) {
      addToast({
        type: "danger",
        title: "Action non autorisée",
        message: "Votre compte n'a pas le droit d'encaisser un paiement.",
      });
      setGroupOpen(false);
      return;
    }
    if (groupChosen.length === 0) {
      addToast({
        type: "danger",
        title: "Rien à encaisser",
        message: "Cochez au moins un emploi du temps avec un montant.",
      });
      return;
    }
    setGroupBusy(true);
    const lines: { label: string; monthCode: string; amount: number; balanceAfter: number }[] = [];
    for (const r of groupChosen) {
      const amount = positiveMoney(groupAmt[r.subId] || 0);
      const res = await addSold({
        studentId: student.id,
        subscriptionId: r.subId,
        amount,
        monthCode: groupMonth[r.subId],
        date: groupDate,
      });
      if (res.ok) {
        lines.push({
          label: r.label,
          monthCode: res.monthCode ?? groupMonth[r.subId],
          amount,
          balanceAfter: res.balance ?? 0,
        });
      }
    }
    setGroupBusy(false);
    if (lines.length === 0) {
      addToast({ type: "danger", title: "Échec", message: "Aucun paiement n'a pu être enregistré." });
      return;
    }
    const total = lines.reduce((s, l) => s + l.amount, 0);
    addToast({
      type: "success",
      title: "Encaissement groupé",
      message: `${formatDA(total)} encaissés sur ${lines.length} emploi(s) du temps — un seul reçu.`,
      studentName: studentName(student),
    });
    setReceipt(
      soldReceiptHtml(db, {
        student,
        language,
        title: "Reçu — encaissement groupé",
        lines,
      }),
    );
    setGroupOpen(false);
  };

  return (
    <>
      <Modal open onClose={onClose} title="Situation d'un élève" full>
        <div className="space-y-4">
          {/* ---- 1. chercher l'élève -------------------------------------- */}
          <div className="space-y-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <Input
                autoFocus
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setStudent(null);
                }}
                placeholder="Nom, n° d'inscription (00001) ou numéro de téléphone…"
                className="pl-9"
              />
            </div>

            {!student && query.trim() && (
              <div className="max-h-52 space-y-1 overflow-y-auto rounded-xl border border-line p-1">
                {matches.length === 0 ? (
                  <p className="py-6 text-center text-xs italic text-muted">
                    Aucun élève ne correspond.
                  </p>
                ) : (
                  matches.map((st) => (
                    <button
                      key={st.id}
                      onClick={() => pick(st)}
                      className="flex w-full items-center justify-between gap-2 rounded-lg p-2.5 text-left hover:bg-primary-50/60"
                    >
                      <span className="min-w-0">
                        <strong className="block text-xs text-ink">{studentName(st)}</strong>
                        <span className="text-[10px] text-muted">
                          N° {registrationNumberOf(db, st)}
                          {st.phone ? ` · ${st.phone}` : ""}
                        </span>
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted" />
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {!student ? (
            <p className="rounded-2xl border border-dashed border-line py-12 text-center text-xs italic text-muted">
              Cherchez un élève par son nom, son n° d&apos;inscription ou son téléphone pour lire
              toute sa situation, emploi du temps par emploi du temps.
            </p>
          ) : (
            <>
              {/* ---- 2. l'élève et son mois ------------------------------ */}
              <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl bg-primary-50/60 p-4">
                <div className="min-w-0">
                  <h3 className="text-base font-black text-ink sm:text-lg">
                    {studentName(student)}
                    {studentCaseLabel(student) && (
                      <Badge tone={studentCaseTone(student)} className="ml-2 text-[9px]">
                        {studentCaseLabel(student)}
                      </Badge>
                    )}
                  </h3>
                  <p className="text-[11px] text-muted sm:text-xs">
                    N° {registrationNumberOf(db, student)}
                    {student.phone ? ` · ${student.phone}` : ""} · {rows.length} emploi(s) du temps
                    {rows.filter((r) => !r.active).length > 0 &&
                      ` (dont ${rows.filter((r) => !r.active).length} quitté(s))`}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-1 rounded-xl border border-line bg-surface p-1">
                    <button
                      onClick={() => stepMonth(-1)}
                      disabled={atOldest}
                      className="rounded-lg p-1 text-muted hover:bg-primary-50 hover:text-ink disabled:opacity-30"
                      title="Mois précédent"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <span className="min-w-[132px] text-center text-[11px] font-bold text-ink">
                      {monthFilterLabel(month)}
                    </span>
                    <button
                      onClick={() => stepMonth(1)}
                      disabled={atNewest}
                      className="rounded-lg p-1 text-muted hover:bg-primary-50 hover:text-ink disabled:opacity-30"
                      title="Mois suivant"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setStudent(null)}>
                    Changer d&apos;élève
                  </Button>
                </div>
              </div>

              {/* ---- 2 bis. LES DEUX FILTRES --------------------------------
                  On arrive sur TOUS ses emplois du temps ; ces deux listes
                  resserrent ensuite la lecture — un cours précis, un mois
                  précis — sans jamais changer ce que l'écran sait faire :
                  encaisser sur la ligne qu'on regarde. */}
              <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-line bg-canvas/40 p-3">
                <div className="min-w-[240px] flex-1">
                  <label className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted">
                    <BookOpen className="h-3.5 w-3.5 text-primary" /> Emploi du temps
                  </label>
                  <Select
                    value={emploi}
                    onChange={(e) => setEmploi(e.target.value)}
                    className="w-full"
                  >
                    <option value="all">
                      Tous ses emplois du temps ({rows.length})
                    </option>
                    {rows.map((r) => (
                      <option key={r.subId} value={r.subId}>
                        {r.label} — groupe {r.groupName}
                        {r.active ? "" : " (quitté)"}
                      </option>
                    ))}
                  </Select>
                </div>

                <div className="min-w-[240px] flex-1">
                  <label className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted">
                    <CalendarRange className="h-3.5 w-3.5 text-primary" /> Mois
                  </label>
                  <Select
                    value={monthFilterValue(month)}
                    onChange={(e) => setMonth(parseMonthFilter(e.target.value))}
                    className="w-full"
                  >
                    <optgroup label="Décalage — appliqué à chaque emploi du temps">
                      <option value="current">Mois en cours</option>
                      {Array.from({ length: maxBack }, (_, i) => i + 1).map((b) => (
                        <option key={b} value={`back:${b}`}>
                          {b === 1 ? "1 mois avant" : `${b} mois avant`}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Mois précis — le même pour tous">
                      {Array.from({ length: maxMonth }, (_, i) => `M${i + 1}`).map((c) => (
                        <option key={c} value={c}>
                          {monthCodeLabel(c)}
                        </option>
                      ))}
                    </optgroup>
                  </Select>
                </div>

                {(emploi !== "all" || month.kind === "fixed" || month.offset > 0) && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setEmploi("all");
                      setMonth(MONTH_FILTER_CURRENT);
                    }}
                  >
                    Tout réafficher
                  </Button>
                )}
              </div>

              {/* MATERNELLE — encaisser plusieurs emplois du temps sur un seul
                  reçu. Réservé à ce niveau. */}
              {isMaternelle && canCollect && payableRows.length > 0 && (
                <button
                  onClick={openGroupPay}
                  className="flex w-full flex-wrap items-center justify-between gap-2 rounded-2xl border-2 border-primary/40 bg-primary-50/50 p-3 text-left transition-colors hover:bg-primary-50"
                >
                  <span className="flex items-center gap-2">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
                      <Layers className="h-4.5 w-4.5" />
                    </span>
                    <span>
                      <strong className="block text-xs text-ink">
                        Encaisser plusieurs emplois du temps — un seul reçu
                      </strong>
                      <span className="block text-[10px] text-muted">
                        Réservé à la maternelle : cochez les créneaux, ajustez chaque montant, et
                        tout part sur un reçu unique avec le détail et le total.
                      </span>
                    </span>
                  </span>
                  <span className="flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1 text-[10px] font-bold text-white">
                    <Wallet className="h-3 w-3" /> Encaissement groupé
                  </span>
                </button>
              )}

              {/* ---- 3. ses totaux -------------------------------------- */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Tile
                  label="Emplois du temps"
                  value={
                    emploi === "all"
                      ? String(rows.length)
                      : `1 / ${rows.length}`
                  }
                  tone="text-ink"
                  hint={emploi === "all" ? undefined : "filtré"}
                />
                <Tile
                  label="Versé sur le mois affiché"
                  value={formatDA(totalCredited)}
                  tone="text-success"
                />
                <Tile
                  label="Reste à payer (mois affiché)"
                  value={formatDA(totalDue)}
                  tone={totalDue > 0 ? "text-danger" : "text-success"}
                  hint={totalDue > 0 ? "à encaisser" : "à jour ✅"}
                />
                <Tile
                  label="Arriérés (mois précédents)"
                  value={formatDA(totalPrevious)}
                  tone={totalPrevious > 0 ? "text-danger" : "text-success"}
                  hint={totalPrevious > 0 ? "remontez les mois pour régler" : "rien en retard"}
                />
              </div>

              {/* ---- 4. LE TABLEAU -------------------------------------- */}
              {visibleRows.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-line py-10 text-center text-xs italic text-muted">
                  {rows.length === 0
                    ? "Cet élève n'est inscrit sur aucun emploi du temps."
                    : "Aucun emploi du temps ne correspond au filtre."}
                </p>
              ) : (
                <div className="overflow-x-auto rounded-2xl border border-line">
                  <table className="w-full min-w-[1080px] text-xs">
                    <thead className="bg-canvas/60">
                      <tr className="text-left text-[10px] uppercase tracking-wide text-muted">
                        <th className="px-2 py-2.5">Emploi du temps</th>
                        <th className="px-2 py-2.5">Mois</th>
                        {Array.from({ length: slotCount }, (_, i) => (
                          <th
                            key={i}
                            className="px-1 py-2.5 text-center"
                            title={`Séance ${i + 1} du mois`}
                          >
                            S{i + 1}
                          </th>
                        ))}
                        <th className="px-2 py-2.5">Versé / Reste</th>
                        <th className="px-2 py-2.5">Mois préc.</th>
                        <th className="px-2 py-2.5">Solde emploi</th>
                        <th className="px-2 py-2.5 text-center">
                          {canCollect ? "Encaisser" : "—"}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRows.map((r) => (
                        <tr
                          key={r.subId}
                          className={`border-t border-line/60 align-middle hover:bg-primary-50/30 ${
                            r.due > 0 ? "bg-danger/5" : ""
                          }`}
                        >
                          <td className="px-2 py-2">
                            <strong className="block text-ink">{r.label}</strong>
                            <span className="block text-[10px] text-muted">
                              Groupe {r.groupName} · {r.salleName} · {r.teacherName}
                            </span>
                            <span className="block text-[10px] text-muted">
                              {r.daysLabel} · <span className="font-mono">{r.timeLabel}</span> ·{" "}
                              {r.offered ? (
                                <strong className="text-success">offert</strong>
                              ) : (
                                <>séance à {formatDA(r.unitPrice)}</>
                              )}
                            </span>
                            {!r.active && (
                              <Badge tone="warning" className="mt-0.5 gap-1 text-[9px]">
                                <UserMinus className="h-2.5 w-2.5" /> désinscrit
                                {r.leftOn ? ` le ${formatDateFr(r.leftOn)}` : ""}
                              </Badge>
                            )}
                          </td>

                          <td className="px-2 py-2">
                            <Badge
                              tone={r.index === r.currentIndex ? "primary" : "neutral"}
                              className="font-mono text-[10px]"
                            >
                              {monthCodeLabel(r.code)}
                            </Badge>
                            {r.index > r.currentIndex && (
                              <span className="mt-0.5 block text-[9px] font-bold text-warning">
                                à venir — cet emploi du temps en est à{" "}
                                {monthCodeLabel(`M${r.currentIndex + 1}`)}
                              </span>
                            )}
                            <span className="mt-0.5 block text-[9px] text-muted">
                              {r.done}/{Math.max(0, r.size - r.lead)} séance(s)
                              {r.complete ? " · mois clos" : ""}
                              {r.lead > 0 ? ` · entré à la séance ${r.lead + 1}` : ""}
                            </span>
                            <span className="block text-[9px] text-muted">
                              {r.presents} P / {r.absents} A
                              {r.cancelled > 0 ? ` / ${r.cancelled} ×` : ""}
                            </span>
                          </td>

                          {Array.from({ length: slotCount }, (_, i) => {
                            // Au-delà du pack de CET emploi, la colonne n'existe
                            // pas pour lui : elle reste vide plutôt que d'inventer
                            // une séance jamais programmée.
                            const beyond = i >= Math.max(r.size, r.lead + r.slots.length);
                            const before = !beyond && i < r.lead;
                            const rec = beyond || before ? undefined : r.slots[i - r.lead];
                            return (
                              <td key={i} className="px-1 py-2 text-center">
                                {beyond ? (
                                  <span className="text-[10px] text-muted/30">·</span>
                                ) : (
                                  <span
                                    title={
                                      before
                                        ? `Séance tenue avant son inscription (inscrit à la séance ${r.lead + 1})`
                                        : rec
                                          ? `${STATUS_LABEL[rec.status].label} — ${formatDateFr(rec.timestamp.slice(0, 10))}`
                                          : "Pas encore pointé"
                                    }
                                    className={`inline-flex h-6 w-6 items-center justify-center rounded-lg border text-[11px] font-black ${
                                      before
                                        ? "border-dashed border-line bg-canvas/40 text-muted/40"
                                        : rec
                                          ? STATUS_LABEL[rec.status].cls
                                          : "border-line bg-canvas text-muted/50"
                                    }`}
                                  >
                                    {before ? "" : rec ? STATUS_LABEL[rec.status].short : "–"}
                                  </span>
                                )}
                              </td>
                            );
                          })}

                          <td className="px-2 py-2">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <Badge tone="success" className="font-mono" title={`Versé sur ${r.code}`}>
                                {formatDA(r.credited)}
                              </Badge>
                              {r.due > 0 ? (
                                <Badge tone="danger" className="font-mono" title="Reste dû sur ce mois">
                                  reste {formatDA(r.due)}
                                </Badge>
                              ) : (
                                <Badge tone="success" title={`${r.code} réglé`}>
                                  ✅
                                </Badge>
                              )}
                            </div>
                            <span className="mt-0.5 block text-[9px] text-muted">
                              consommé {formatDA(r.consumed)}
                              {r.advance > 0 ? ` · ${formatDA(r.advance)} d'avance` : ""}
                            </span>
                          </td>

                          <td className="px-2 py-2">
                            {r.index === 0 ? (
                              <span className="text-[10px] text-muted">—</span>
                            ) : r.previousDue > 0 ? (
                              <button
                                onClick={() => stepMonth(-1)}
                                title="Remonter d'un mois pour le régler"
                                className="rounded-lg border border-danger/40 bg-danger/10 px-2 py-1 text-[10px] font-bold text-danger hover:bg-danger/20"
                              >
                                {formatDA(r.previousDue)}
                              </button>
                            ) : (
                              <span className="text-sm" title="Mois précédents réglés">
                                ✅
                              </span>
                            )}
                          </td>

                          <td className="px-2 py-2">
                            <span
                              className={`font-mono text-[11px] font-bold ${
                                r.balance < 0 ? "text-danger" : "text-success"
                              }`}
                            >
                              {r.balance < 0
                                ? `${formatDA(-r.balance)} dus`
                                : `${formatDA(r.balance)} d'avance`}
                            </span>
                          </td>

                          <td className="px-2 py-2">
                            <div className="flex items-center justify-center">
                              {!canCollect ? (
                                <span className="text-[10px] italic text-muted/60">—</span>
                              ) : (
                              <button
                                onClick={() =>
                                  setPay({
                                    subId: r.subId,
                                    label: r.label,
                                    monthCode: r.code,
                                    amount: r.due || 0,
                                    suggestion: r.due,
                                    date: todayIso(),
                                  })
                                }
                                title={`Encaisser un solde sur ${r.code}`}
                                className="flex h-7 items-center gap-1 rounded-lg bg-primary px-2 text-[10px] font-bold text-white transition-colors hover:brightness-110"
                              >
                                <Wallet className="h-3.5 w-3.5" /> Encaisser
                              </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted">
                <span className="flex items-center gap-1">
                  <span className="inline-block h-3 w-3 rounded border border-success/40 bg-success/15" />{" "}
                  Présent
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-3 w-3 rounded border border-danger/40 bg-danger/15" />{" "}
                  Absent
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-3 w-3 rounded border border-primary/40 bg-primary/15" />{" "}
                  Annulée
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-3 w-3 rounded border border-line bg-canvas" /> Pas
                  encore pointé
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-3 w-3 rounded border border-dashed border-line bg-canvas/40" />{" "}
                  Séance tenue avant son inscription
                </span>
                <span className="flex items-center gap-1">
                  <History className="h-3 w-3" /> Chaque emploi du temps compte SES propres mois :
                  « 1 mois avant » recule d&apos;un cran sur chaque ligne, pas sur un mois du
                  calendrier.
                </span>
              </div>

              {/* ---- ses séances libres : suivies sans y être inscrit ------
                  Elles n'ouvrent ni solde ni ligne dans le tableau ci-dessus —
                  c'est le prix d'être « juste venu une fois » — mais sa fiche
                  doit pouvoir les montrer, sinon elles n'apparaissent nulle
                  part pour qui cherche « qu'est-ce qu'il a suivi ce mois-ci ». */}
              {passagerVisits.length > 0 && (
                <div className="overflow-hidden rounded-2xl border border-primary/25">
                  <div className="flex items-center gap-1.5 bg-primary-50/60 p-3">
                    <Ticket className="h-4 w-4 text-primary" />
                    <strong className="text-xs text-ink">
                      Séances libres suivies ({passagerVisits.length})
                    </strong>
                    <span className="text-[10px] text-muted">
                      — suivies sans être inscrit sur l&apos;emploi du temps qui les portait :
                      aucun solde, aucune place sur la feuille du mois prochain.
                    </span>
                  </div>
                  <div className="overflow-x-auto bg-surface">
                    <table className="w-full min-w-[560px] text-[11px]">
                      <thead className="bg-canvas/60">
                        <tr className="text-left text-[9px] uppercase tracking-wide text-muted">
                          <th className="px-2 py-2">Date</th>
                          <th className="px-2 py-2">Emploi du temps</th>
                          <th className="px-2 py-2">Enseignant</th>
                          <th className="px-2 py-2 text-right">Prix payé</th>
                          <th className="px-2 py-2 text-center">Paie enseignant</th>
                        </tr>
                      </thead>
                      <tbody>
                        {passagerVisits.map((ind) => {
                          const session = db.sessions.find((s) => s.id === ind.sessionId);
                          const label =
                            session?.title || moduleNameOf(db, session?.moduleId ?? "") || "—";
                          const t = independentTotals(ind);
                          return (
                            <tr key={ind.id} className="border-t border-line/60">
                              <td className="px-2 py-2 text-ink">{formatDateFr(ind.date)}</td>
                              <td className="px-2 py-2 text-ink">{label}</td>
                              <td className="px-2 py-2 text-muted">
                                {teacherName(db, ind.teacherId ?? "")}
                              </td>
                              <td className="px-2 py-2 text-right font-mono">{formatDA(t.price)}</td>
                              <td className="px-2 py-2 text-center">
                                <Badge tone={ind.teacherPaid ? "success" : "warning"} className="text-[9px]">
                                  {ind.teacherPaid ? "réglée" : "en attente"}
                                </Badge>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}

          <div className="flex justify-end border-t border-line pt-3">
            <Button variant="outline" onClick={onClose}>
              Fermer
            </Button>
          </div>
        </div>
      </Modal>

      {/* ---- encaisser un solde, sur la ligne concernée ------------------- */}
      {pay && student && (
        <Modal open onClose={() => setPay(null)} title="Encaisser un solde">
          <div className="space-y-3">
            <div className="rounded-xl bg-primary-50/60 p-3">
              <strong className="block text-sm text-ink">{studentName(student)}</strong>
              <span className="text-[11px] text-muted">
                N° {registrationNumberOf(db, student)} · {pay.label}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted">
                  Mois concerné
                </label>
                <Select
                  value={pay.monthCode}
                  onChange={(e) => setPay({ ...pay, monthCode: e.target.value })}
                  className="w-full"
                >
                  {Array.from(
                    { length: Math.max(6, maxBack + 3) },
                    (_, i) => `M${i + 1}`,
                  ).map((c) => (
                    <option key={c} value={c}>
                      {monthCodeLabel(c)}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted">
                  Montant versé (DA)
                </label>
                <Input
                  type="number"
                  step="0.01"
                  min={0}
                  autoFocus
                  value={pay.amount || ""}
                  onChange={(e) => setPay({ ...pay, amount: Number(e.target.value) || 0 })}
                  placeholder="Ex: 4000"
                />
              </div>
            </div>
            {/* LE JOUR DU VERSEMENT — la veille se saisit encore aujourd'hui,
                et c'est cette date que porteront le reçu, l'historique de
                l'élève et le mouvement de caisse. */}
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted">
                Date du paiement
              </label>
              <Input
                type="date"
                value={pay.date ?? todayIso()}
                onChange={(e) => setPay({ ...pay, date: e.target.value })}
              />
            </div>
            {pay.suggestion > 0 && (
              <button
                onClick={() => setPay({ ...pay, amount: pay.suggestion })}
                className="text-[11px] font-bold text-primary hover:underline"
              >
                Régler ce qui est déjà dû ({formatDA(pay.suggestion)})
              </button>
            )}

            {/* ---- LE RACCOURCI « UNE SÉANCE DE PLUS » -----------------------
                Le même bloc, mot pour mot, que sur la feuille de présence du
                groupe : « + 1 séance » et la PROPOSITION du mois entier compté
                depuis SA première séance, moins ce qu'il a déjà versé. La
                réception ne doit pas calculer autrement selon l'écran par lequel
                elle est passée. */}
            <SeanceStepper
              student={student}
              subscriptionId={pay.subId}
              monthCode={pay.monthCode}
              amount={pay.amount || 0}
              onAmount={(next) => setPay({ ...pay, amount: next })}
            />

            {/* Ce que ce versement laisse derrière lui : un élève qui donne 2000
                sur un mois à 1800 garde 200 sur le solde de CET emploi. */}
            {(() => {
              const amount = positiveMoney(pay.amount || 0);
              if (amount <= 0) return null;
              const after = soldFor(db, student.id, pay.subId) + amount;
              const rest = Math.max(0, pay.suggestion - amount);
              const advance = Math.max(0, amount - pay.suggestion);
              return (
                <div
                  className={`rounded-xl border p-2.5 text-[11px] leading-relaxed ${
                    rest > 0
                      ? "border-warning/40 bg-warning/10 text-warning"
                      : "border-success/40 bg-success/10 text-success"
                  }`}
                >
                  {rest > 0 ? (
                    <>
                      Il restera <strong>{formatDA(rest)}</strong> à payer sur {pay.monthCode}.
                    </>
                  ) : advance > 0 ? (
                    <>
                      {pay.monthCode} est soldé et <strong>{formatDA(advance)}</strong> restent
                      d&apos;avance : cet argent est gardé sur le solde de cet emploi du temps et
                      paiera ses prochaines séances.
                    </>
                  ) : (
                    <>{pay.monthCode} sera exactement soldé.</>
                  )}
                  <span className="mt-0.5 block text-[10px] opacity-80">
                    Solde de l&apos;emploi après encaissement :{" "}
                    <strong>
                      {after < 0 ? `${formatDA(-after)} dus` : `${formatDA(after)} d'avance`}
                    </strong>
                  </span>
                </div>
              );
            })()}

            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted">
                Description (optionnel)
              </label>
              <Input
                value={pay.description ?? ""}
                onChange={(e) => setPay({ ...pay, description: e.target.value })}
                placeholder="Laisser vide pour la description automatique"
              />
            </div>
            <div className="flex justify-end gap-2 border-t border-line pt-3">
              <Button variant="outline" onClick={() => setPay(null)}>
                Annuler
              </Button>
              <Button onClick={submitPay} disabled={busy}>
                Encaisser
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* ---- ENCAISSEMENT GROUPÉ (maternelle) : plusieurs emplois, un reçu ---- */}
      {groupOpen && student && (
        <Modal
          open
          onClose={() => setGroupOpen(false)}
          title="Encaissement groupé — un seul reçu"
          wide
        >
          <div className="space-y-3">
            <div className="rounded-xl bg-primary-50/60 p-3">
              <strong className="block text-sm text-ink">{studentName(student)}</strong>
              <span className="text-[11px] text-muted">
                N° {registrationNumberOf(db, student)} · Maternelle — cochez les emplois du temps à
                régler, ajustez chaque montant, et tout part sur un reçu unique.
              </span>
            </div>

            <div className="space-y-2">
              {payableRows.length === 0 ? (
                <p className="rounded-xl border border-line bg-canvas/40 p-6 text-center text-xs italic text-muted">
                  Aucun emploi du temps à encaisser.
                </p>
              ) : (
                payableRows.map((r) => {
                  const code = groupMonth[r.subId] ?? `M${r.currentIndex + 1}`;
                  const due = Math.max(0, -cycleOf(db, student.id, r.subId, code).balance);
                  const checked = !!groupSel[r.subId];
                  return (
                    <div
                      key={r.subId}
                      className={`rounded-2xl border p-3 transition-colors ${
                        checked ? "border-primary/50 bg-primary-50/30" : "border-line bg-surface"
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <label className="flex min-w-0 cursor-pointer items-start gap-2">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) =>
                              setGroupSel((prev) => ({ ...prev, [r.subId]: e.target.checked }))
                            }
                            className="mt-0.5 h-4 w-4 accent-[var(--color-primary,#7c3aed)]"
                          />
                          <span className="min-w-0">
                            <strong className="block text-sm text-ink">{r.label}</strong>
                            <span className="block text-[10px] text-muted">
                              Groupe {r.groupName} · {r.teacherName} · séance à{" "}
                              {formatDA(r.unitPrice)}
                            </span>
                            <span className="block text-[10px] text-muted">
                              {due > 0 ? (
                                <span className="font-bold text-danger">Reste dû {formatDA(due)}</span>
                              ) : (
                                <span className="text-success">à jour</span>
                              )}
                            </span>
                          </span>
                        </label>
                        <div className="flex items-center gap-2">
                          <div>
                            <label className="mb-0.5 block text-[9px] font-bold uppercase tracking-wider text-muted">
                              Mois
                            </label>
                            <Select
                              value={code}
                              onChange={(e) =>
                                setGroupMonth((prev) => ({ ...prev, [r.subId]: e.target.value }))
                              }
                              className="w-[110px]"
                            >
                              {Array.from(
                                { length: Math.max(6, r.currentIndex + 3) },
                                (_, i) => `M${i + 1}`,
                              ).map((c) => (
                                <option key={c} value={c}>
                                  {monthCodeLabel(c)}
                                </option>
                              ))}
                            </Select>
                          </div>
                          <div>
                            <label className="mb-0.5 block text-[9px] font-bold uppercase tracking-wider text-muted">
                              Montant (DA)
                            </label>
                            <Input
                              type="number"
                              step="0.01"
                              min={0}
                              value={groupAmt[r.subId] || ""}
                              onChange={(e) =>
                                setGroupAmt((prev) => ({
                                  ...prev,
                                  [r.subId]: Number(e.target.value) || 0,
                                }))
                              }
                              className="w-[110px]"
                              placeholder="Ex: 2000"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted">
                Date du paiement
              </label>
              <Input
                type="date"
                value={groupDate}
                onChange={(e) => setGroupDate(e.target.value)}
                className="w-full sm:w-56"
              />
            </div>

            <div className="flex items-center justify-between rounded-xl border border-primary/30 bg-primary-50/40 p-3">
              <span className="text-[11px] text-muted">
                {groupChosen.length} emploi(s) du temps sélectionné(s) — un seul reçu
              </span>
              <strong className="font-mono text-base text-primary">{formatDA(groupTotal)}</strong>
            </div>

            <div className="flex justify-end gap-2 border-t border-line pt-3">
              <Button variant="outline" onClick={() => setGroupOpen(false)}>
                Annuler
              </Button>
              <Button
                onClick={submitGroup}
                disabled={groupBusy || groupChosen.length === 0}
                className="gap-1.5"
              >
                <Wallet className="h-4 w-4" /> Encaisser {formatDA(groupTotal)} — un seul reçu
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {receipt && <PrintAsk html={receipt} onClose={() => setReceipt(null)} />}
    </>
  );
}

function Tile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-2.5 text-center">
      <span className="block text-[9px] font-bold uppercase tracking-wider text-muted">{label}</span>
      <strong className={`block font-mono text-base ${tone}`}>{value}</strong>
      {hint && <span className="block text-[9px] text-muted">{hint}</span>}
    </div>
  );
}
