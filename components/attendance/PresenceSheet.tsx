"use client";

/**
 * THE présence sheet. One single component, used identically by the dashboard
 * (when a créneau of the day is opened) and by the Présences screen.
 *
 * Only the students the month actually concerns are listed: a child registered
 * while the group lived its M2 is on M2 and on nothing before it, and the
 * séances of M2 held before he arrived stay blank on his row rather than
 * reading "pas encore pointé".
 *
 * One row per student of the emploi du temps, and per row:
 *  - his number, name and phone,
 *  - one column per séance of the month, each showing présent / absent /
 *    annulée / rien encore,
 *  - the state of the CURRENT month: his solde on that emploi, his billing case,
 *    and a button to cash a new solde in (with its receipt),
 *  - the state of the PREVIOUS month: ✔ when settled, the amount owed otherwise
 *    (clickable, payable on the spot),
 *  - what he owes on his OTHER emplois du temps, same treatment,
 *  - the présence buttons for the day: présent / absent / annulée / retour,
 *  - and the button that takes him OFF the group, his history kept.
 *
 * Every button writes straight away — no confirmation dialog anywhere — and
 * "Retour" undoes a mis-click, giving the solde back.
 */

import { useMemo, useState } from "react";
import { useData } from "@/lib/store/data";
import { useSettings } from "@/lib/store/settings";
import { useToast } from "@/lib/store/toast";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input, Select } from "@/components/ui/SearchInput";
import { formatDA } from "@/lib/utils";
import { printHtmlDocument } from "@/lib/print";
import { presenceSheetHtml, soldReceiptHtml } from "@/lib/reports/documents";
import {
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Clock,
  History,
  Pencil,
  Printer,
  RotateCcw,
  Search,
  Slash,
  Trash2,
  UserMinus,
  UserPlus,
  UserRoundPlus,
  Wallet,
  X,
} from "lucide-react";
import type {
  AttendanceRecord,
  AttendanceStatus,
  Payment,
  ScheduleSession,
  Student,
} from "@/lib/types";
import {
  DAY_LABELS_FR,
  attendanceOn,
  cycleLead,
  cycleOf,
  cycleSizeOf,
  cycleSlots,
  dayKeyOf,
  enrolledInMonth,
  enrollmentCycles,
  formatDateFr,
  groupName,
  joinPointFor,
  moduleName as moduleNameOf,
  monthCodeLabel,
  monthOrder,
  registrationNumberOf,
  schoolPerSeanceOf,
  salleName,
  sessionTimesOn,
  slotCountFor,
  soldFor,
  soldStatus,
  studentCaseLabel,
  studentCaseTone,
  studentListPrice,
  studentMatches,
  studentName,
  studentSoldDebtRows,
  teacherName,
} from "@/lib/helpers";
import type { Day } from "@/lib/types";

const JS_DAYS: Day[] = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

const STATUS_STYLE: Record<AttendanceStatus, { label: string; short: string; cls: string }> = {
  present: { label: "Présent", short: "P", cls: "bg-success/15 text-success border-success/40" },
  late: { label: "Retard", short: "R", cls: "bg-warning/15 text-warning border-warning/40" },
  absent: { label: "Absent", short: "A", cls: "bg-danger/15 text-danger border-danger/40" },
  cancelled: { label: "Annulée", short: "×", cls: "bg-primary/15 text-primary border-primary/40" },
};

export interface PresenceSheetProps {
  session: ScheduleSession;
  /** the day the présence buttons write on (YYYY-MM-DD) */
  date: string;
  monthCode: string;
  onMonthChange: (code: string) => void;
  /** opens the create-student screen with this emploi already ticked */
  onCreateStudent?: () => void;
}

export function PresenceSheet({
  session,
  date,
  monthCode,
  onMonthChange,
  onCreateStudent,
}: PresenceSheetProps) {
  const db = useData();
  const { setPresence, addSold, unsubscribeStudent, subscribeStudent } = db;
  const { language } = useSettings();
  const { addToast } = useToast();

  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pay, setPay] = useState<PayTarget | null>(null);
  const [drill, setDrill] = useState<{ student: Student; kind: "previous" | "other" } | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  /** the student the desk is about to take off the group */
  const [leaving, setLeaving] = useState<Student | null>(null);
  /** inscrire un élève DÉJÀ dans la base sur cet emploi du temps */
  const [addOpen, setAddOpen] = useState(false);
  /** pointer tout le monde présent d'un coup */
  const [allPresentOpen, setAllPresentOpen] = useState(false);
  /** l'historique des paiements d'un élève sur cet emploi — modifiable */
  const [history, setHistory] = useState<Student | null>(null);

  const sub = db.subscriptions.find((s) => s.sessionId === session.id);
  const unitPrice = sub?.pricePerSession ?? session.openPrice ?? 0;
  const schoolOnlyPrice = schoolPerSeanceOf(sub);
  const monthIndex = Math.max(0, monthOrder(monthCode));

  /**
   * Students enrolled on THIS emploi du temps — and on the month being read.
   * A child registered during M2 is simply not part of M1: showing him there
   * would invent séances he was never offered.
   */
  const roster: Student[] = !sub
    ? []
    : db.students
        .filter((st) => st.subscriptionIds.includes(sub.id))
        .filter((st) => enrolledInMonth(db, st.id, sub.id, monthCode))
        .sort((a, b) =>
          `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`),
        );

  /** Enrolled on the emploi, month aside — what the month filter hides. */
  const fullRoster = sub ? db.students.filter((st) => st.subscriptionIds.includes(sub.id)) : [];
  const notYetHere = fullRoster.length - roster.length;

  const shown = roster.filter((st) => studentMatches(db, st, search));

  const slotCount = sub ? slotCountFor(db, sub.id, roster.map((s) => s.id), monthCode) : cycleSizeOf(sub);

  const scheduledDay = session.days.includes(JS_DAYS[new Date(`${date}T12:00:00`).getDay()]);

  // ---- writing ------------------------------------------------------------
  const write = async (student: Student, status: AttendanceStatus | null) => {
    setBusyId(student.id);
    const res = await setPresence({
      studentId: student.id,
      sessionId: session.id,
      date,
      status,
    });
    setBusyId(null);
    if (!res.ok) {
      addToast({
        type: "danger",
        title: "Pointage refusé",
        message:
          res.messageKey === "scan.wrongGroup"
            ? "L'élève ne peut être pointé que dans SON groupe."
            : "Impossible d'enregistrer ce pointage.",
        studentName: studentName(student),
      });
      return;
    }
    const bits: string[] = [];
    if (res.charged) bits.push(`−${formatDA(res.charged)} sur son solde`);
    if (res.refunded) bits.push(`+${formatDA(res.refunded)} rendus`);
    if (res.noCharge && status) bits.push("séance non facturée");
    addToast({
      type: (res.balance ?? 0) < 0 ? "warning" : "success",
      title:
        status === null
          ? "Pointage annulé"
          : `${STATUS_STYLE[status].label} enregistré`,
      message: `${bits.join(" · ") || "Aucun mouvement"} — solde : ${formatDA(res.balance ?? 0)}`,
      studentName: studentName(student),
    });
  };

  // ---- taking a student off the group -------------------------------------
  const confirmLeave = async () => {
    if (!leaving || !sub) return;
    const student = leaving;
    setBusyId(student.id);
    const res = await unsubscribeStudent(student.id, sub.id);
    setBusyId(null);
    setLeaving(null);
    if (!res.ok) {
      addToast({
        type: "danger",
        title: "Désinscription refusée",
        message: "Cet élève n'est pas inscrit sur cet emploi du temps.",
        studentName: studentName(student),
      });
      return;
    }
    addToast({
      type: "success",
      title: "Élève désinscrit",
      message: `Retiré de ${title} le ${formatDateFr(res.leftOn ?? date)}. Ses présences, ses paiements et son solde de ${formatDA(
        res.balance ?? 0,
      )} restent sur sa fiche, datés de cette sortie.`,
      studentName: studentName(student),
    });
  };

  // ---- bringing an EXISTING student onto the group ------------------------
  const addExisting = async (student: Student) => {
    if (!sub) return;
    setBusyId(student.id);
    const res = await subscribeStudent({
      studentId: student.id,
      subscriptionId: sub.id,
      date,
    });
    setBusyId(null);
    if (!res.ok) {
      addToast({
        type: "danger",
        title: "Inscription refusée",
        message: "Impossible d'inscrire cet élève sur cet emploi du temps.",
        studentName: studentName(student),
      });
      return;
    }
    // Il entre LÀ OÙ EN EST LE GROUPE, comme un élève créé depuis la feuille :
    // les séances tenues avant lui ne sont pas les siennes.
    onMonthChange(res.monthCode ?? monthCode);
    addToast({
      type: "success",
      title: "Élève inscrit sur le groupe",
      message: `Entre en ${res.monthCode ?? monthCode} · séance ${(res.slotIndex ?? 0) + 1} — aucune fiche à ressaisir.`,
      studentName: studentName(student),
    });
  };

  // ---- marking the WHOLE list présent ------------------------------------
  const markAllPresent = async (ids: string[]) => {
    for (const id of ids) {
      const student = db.students.find((s) => s.id === id);
      if (!student) continue;
      // Un élève déjà pointé ce jour-là n'est pas réécrit : son statut reste
      // celui que la réception a choisi (absent, annulée…).
      if (attendanceOn(db, id, session.id, date)) continue;
      await setPresence({ studentId: id, sessionId: session.id, date, status: "present" });
    }
    setAllPresentOpen(false);
    addToast({
      type: "success",
      title: "Présences enregistrées",
      message: `${ids.length} élève(s) marqué(s) présents le ${formatDateFr(date)}.`,
    });
  };

  // ---- cashing a solde in -------------------------------------------------
  const submitPay = async () => {
    if (!pay || !sub) return;
    const amount = Math.max(0, Math.round(pay.amount || 0));
    if (amount <= 0) {
      addToast({ type: "danger", title: "Montant invalide", message: "Saisissez un montant." });
      return;
    }
    setBusyId(pay.student.id);
    const res = await addSold({
      studentId: pay.student.id,
      subscriptionId: pay.subscriptionId,
      amount,
      monthCode: pay.monthCode,
      description: pay.description,
    });
    setBusyId(null);
    if (!res.ok) {
      addToast({ type: "danger", title: "Échec", message: "Le paiement n'a pas pu être enregistré." });
      return;
    }
    addToast({
      type: "success",
      title: "Paiement encaissé",
      message: `${formatDA(amount)} sur ${pay.label} (${pay.monthCode}) — nouveau solde ${formatDA(res.balance ?? 0)}`,
      studentName: studentName(pay.student),
    });
    setReceipt(
      soldReceiptHtml(db, {
        student: pay.student,
        language,
        lines: [
          {
            label: pay.label,
            monthCode: res.monthCode ?? pay.monthCode,
            amount,
            balanceAfter: res.balance ?? 0,
          },
        ],
        note: pay.description,
      }),
    );
    setPay(null);
    setDrill(null);
  };

  const printSheet = () => {
    if (!sub) return;
    printHtmlDocument(
      presenceSheetHtml(db, {
        session,
        monthCode,
        slotCount,
        date,
        language,
        rows: shown.map((st) => {
          const slots = cycleSlots(db, st.id, sub.id, monthCode);
          const lead = cycleLead(db, st.id, sub.id, monthCode);
          const prevDebt =
            monthIndex > 0 ? Math.max(0, -cycleOf(db, st.id, sub.id, `M${monthIndex}`).balance) : 0;
          return {
            number: registrationNumberOf(db, st),
            name: studentName(st),
            phone: st.phone,
            slots: Array.from({ length: slotCount }, (_, i) =>
              i < lead ? null : (slots[i - lead]?.status ?? null),
            ),
            sold: soldFor(db, st.id, sub.id),
            caseLabel: studentCaseLabel(st),
            previousDebt: prevDebt,
            otherDebt: studentSoldDebtRows(db, st.id)
              .filter((r) => r.subscriptionId !== sub.id)
              .reduce((s, r) => s + r.debt, 0),
          };
        }),
      }),
    );
  };

  const title = session.title || moduleNameOf(db, session.moduleId) || "Séance";

  if (!sub) {
    return (
      <div className="rounded-2xl border border-warning/40 bg-warning/5 p-6 text-center text-sm text-warning">
        Cet emploi du temps n&apos;a pas encore de tarif. Définissez-le depuis la page{" "}
        <strong>Emploi du temps</strong> avant de pointer les présences.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ---- header ------------------------------------------------------- */}
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl bg-primary-50/60 p-4">
        <div className="min-w-0">
          <h3 className="text-base font-black text-ink sm:text-lg">{title}</h3>
          <p className="text-[11px] text-muted sm:text-xs">
            Groupe {groupName(db, session.groupId)} · Salle {salleName(db, session.salleId)} ·{" "}
            {sessionTimesOn(session, JS_DAYS[new Date(`${date}T12:00:00`).getDay()]).startTime}–
            {sessionTimesOn(session, JS_DAYS[new Date(`${date}T12:00:00`).getDay()]).endTime}
          </p>
          <p className="text-[10px] text-muted sm:text-[11px]">
            Enseignant : {teacherName(db, session.teacherId)} · {cycleSizeOf(sub)} séances / mois ·
            séance à {formatDA(unitPrice)}
            {schoolOnlyPrice > 0 && schoolOnlyPrice !== unitPrice && (
              <> · « école seule » : {formatDA(schoolOnlyPrice)} / séance</>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-xl border border-line bg-surface p-1">
            <button
              onClick={() => onMonthChange(`M${Math.max(1, monthIndex)}`)}
              disabled={monthIndex === 0}
              className="rounded-lg p-1 text-muted hover:bg-primary-50 hover:text-ink disabled:opacity-30"
              title="Mois précédent"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-[92px] text-center text-[11px] font-bold text-ink">
              {monthCodeLabel(monthCode)}
            </span>
            <button
              onClick={() => onMonthChange(`M${monthIndex + 2}`)}
              className="rounded-lg p-1 text-muted hover:bg-primary-50 hover:text-ink"
              title="Mois suivant"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          {onCreateStudent && (
            <Button size="sm" variant="outline" onClick={onCreateStudent} className="gap-1.5">
              <UserPlus className="h-3.5 w-3.5" /> Nouvel élève
            </Button>
          )}
          {/* Déjà dans la base : on l'ajoute au groupe sans ressaisir sa fiche. */}
          <Button size="sm" variant="outline" onClick={() => setAddOpen(true)} className="gap-1.5">
            <UserRoundPlus className="h-3.5 w-3.5" /> Élève existant
          </Button>
          <Button size="sm" variant="success" onClick={() => setAllPresentOpen(true)} className="gap-1.5">
            <CheckCheck className="h-3.5 w-3.5" /> Tout présent
          </Button>
          <Button size="sm" variant="outline" onClick={printSheet} className="gap-1.5">
            <Printer className="h-3.5 w-3.5" /> Feuille de présence
          </Button>
        </div>
      </div>

      {/* ---- search + day -------------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un élève — nom ou n° d'inscription (00001)…"
            className="pl-9"
          />
        </div>
        <Badge tone={scheduledDay ? "primary" : "warning"} className="gap-1">
          <Clock className="h-3 w-3" />
          {DAY_LABELS_FR[JS_DAYS[new Date(`${date}T12:00:00`).getDay()]]} {formatDateFr(date)}
        </Badge>
        <Badge tone="neutral">{shown.length} élève(s)</Badge>
        {notYetHere > 0 && (
          <Badge tone="warning" title="Inscrits après ce mois-là — ils apparaissent sur le leur">
            {notYetHere} pas encore inscrit(s) en {monthCode}
          </Badge>
        )}
      </div>

      {!scheduledDay && (
        <p className="rounded-xl border border-warning/40 bg-warning/10 p-2.5 text-[11px] text-warning">
          Ce créneau n&apos;est pas programmé ce jour-là — le pointage reste possible mais vérifiez la
          date.
        </p>
      )}

      {/* ---- the table ----------------------------------------------------- */}
      <div className="overflow-x-auto rounded-2xl border border-line">
        <table className="w-full min-w-[1000px] text-xs">
          <thead className="bg-canvas/60">
            <tr className="text-left text-[10px] uppercase tracking-wide text-muted">
              <th className="px-2 py-2.5">N°</th>
              <th className="px-2 py-2.5">Élève</th>
              <th className="px-2 py-2.5">Téléphone</th>
              {Array.from({ length: slotCount }, (_, i) => (
                <th key={i} className="px-1 py-2.5 text-center" title={`Séance ${i + 1} du mois`}>
                  S{i + 1}
                </th>
              ))}
              <th className="px-2 py-2.5">Versé / Reste {monthCode}</th>
              <th className="px-2 py-2.5">Mois préc.</th>
              <th className="px-2 py-2.5">Autres dettes</th>
              <th className="px-2 py-2.5 text-center">Pointage du jour</th>
              <th className="px-2 py-2.5 text-center">Groupe</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr>
                <td colSpan={slotCount + 8} className="px-3 py-10 text-center text-xs italic text-muted">
                  {roster.length === 0
                    ? notYetHere > 0
                      ? `Aucun élève sur ${monthCode} — les ${notYetHere} inscrit(s) de cet emploi sont arrivés plus tard.`
                      : "Aucun élève inscrit sur cet emploi du temps."
                    : "Aucun élève ne correspond à la recherche."}
                </td>
              </tr>
            ) : (
              shown.map((st) => (
                <StudentRow
                  key={st.id}
                  student={st}
                  session={session}
                  subscriptionId={sub.id}
                  monthCode={monthCode}
                  monthIndex={monthIndex}
                  slotCount={slotCount}
                  date={date}
                  busy={busyId === st.id}
                  onWrite={write}
                  onPay={setPay}
                  onDrill={(kind) => setDrill({ student: st, kind })}
                  onLeave={() => setLeaving(st)}
                  onHistory={() => setHistory(st)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted">
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded border border-success/40 bg-success/15" /> Présent
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded border border-danger/40 bg-danger/15" /> Absent
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded border border-primary/40 bg-primary/15" /> Annulée
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded border border-line bg-canvas" /> Pas encore pointé
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded border border-dashed border-line bg-canvas/40" />{" "}
          Séance tenue avant son inscription
        </span>
        <span>· Une absence marquée avant toute présence sur cet emploi ne coûte rien.</span>
      </div>

      {/* ---- drill-down: previous month / other emplois --------------------- */}
      {drill && (
        <DebtDrill
          student={drill.student}
          kind={drill.kind}
          subscriptionId={sub.id}
          monthIndex={monthIndex}
          onClose={() => setDrill(null)}
          onPay={setPay}
        />
      )}

      {/* ---- cashing a solde in --------------------------------------------- */}
      {pay && (
        <Modal open onClose={() => setPay(null)} title="Encaisser un solde">
          <div className="space-y-3">
            <div className="rounded-xl bg-primary-50/60 p-3">
              <strong className="block text-sm text-ink">{studentName(pay.student)}</strong>
              <span className="text-[11px] text-muted">
                N° {registrationNumberOf(db, pay.student)} · {pay.label}
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
                  {Array.from({ length: Math.max(6, monthIndex + 3) }, (_, i) => `M${i + 1}`).map((c) => (
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
                  min={0}
                  autoFocus
                  value={pay.amount || ""}
                  onChange={(e) => setPay({ ...pay, amount: Number(e.target.value) || 0 })}
                  placeholder="Ex: 4000"
                />
              </div>
            </div>
            {pay.suggestion > 0 && (
              <button
                onClick={() => setPay({ ...pay, amount: pay.suggestion })}
                className="text-[11px] font-bold text-primary hover:underline"
              >
                Régler la totalité ({formatDA(pay.suggestion)})
              </button>
            )}
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
              <Button onClick={submitPay} disabled={busyId === pay.student.id}>
                Encaisser
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* ---- taking a student off the group --------------------------------- */}
      {leaving && (
        <Modal open onClose={() => setLeaving(null)} title="Désinscrire de ce groupe">
          <div className="space-y-3">
            <div className="rounded-xl bg-primary-50/60 p-3">
              <strong className="block text-sm text-ink">{studentName(leaving)}</strong>
              <span className="text-[11px] text-muted">
                N° {registrationNumberOf(db, leaving)} · {title} — groupe{" "}
                {groupName(db, session.groupId)}
              </span>
            </div>
            <p className="text-xs text-ink">
              Il sort de la liste de ce groupe et n&apos;y sera plus pointé. Ses présences, ses
              paiements et son solde restent visibles sur sa fiche, avec la{" "}
              <strong>date de désinscription</strong> — le réinscrire plus tard le remet là où en
              sera le groupe à ce moment-là.
            </p>
            {(() => {
              const balance = soldFor(db, leaving.id, sub.id);
              if (balance < 0)
                return (
                  <p className="rounded-xl border border-danger/40 bg-danger/10 p-2.5 text-[11px] font-semibold text-danger">
                    Attention : il doit encore {formatDA(-balance)} sur cet emploi du temps. Une
                    fois désinscrit, cette dette ne sera plus lue sur ses fiches.
                  </p>
                );
              if (balance > 0)
                return (
                  <p className="rounded-xl border border-warning/40 bg-warning/10 p-2.5 text-[11px] text-warning">
                    Il lui reste {formatDA(balance)} de solde sur cet emploi du temps : cet argent
                    est gardé et le retrouvera s&apos;il y revient.
                  </p>
                );
              return null;
            })()}
            <div className="flex justify-end gap-2 border-t border-line pt-3">
              <Button variant="outline" onClick={() => setLeaving(null)}>
                Annuler
              </Button>
              <Button
                variant="danger"
                onClick={confirmLeave}
                disabled={busyId === leaving.id}
                className="gap-1.5"
              >
                <UserMinus className="h-4 w-4" /> Désinscrire
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* ---- inscrire un élève DÉJÀ créé ------------------------------------ */}
      {addOpen && (
        <AddExistingStudentModal
          subscriptionId={sub.id}
          title={title}
          date={date}
          busyId={busyId}
          onAdd={addExisting}
          onClose={() => setAddOpen(false)}
        />
      )}

      {/* ---- tout le monde présent ------------------------------------------ */}
      {allPresentOpen && (
        <MarkAllPresentModal
          students={roster}
          session={session}
          date={date}
          onConfirm={markAllPresent}
          onClose={() => setAllPresentOpen(false)}
        />
      )}

      {/* ---- l'historique des paiements, modifiable sur place --------------- */}
      {history && (
        <PaymentHistoryModal
          student={history}
          subscriptionId={sub.id}
          label={title}
          onClose={() => setHistory(null)}
        />
      )}

      {receipt && <PrintAsk html={receipt} onClose={() => setReceipt(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * « Élève existant » — il est déjà dans la base, on l'ajoute simplement à cet
 * emploi du temps : aucune fiche à ressaisir, et il entre là où en est le
 * groupe à la date affichée.
 */
function AddExistingStudentModal({
  subscriptionId,
  title,
  date,
  busyId,
  onAdd,
  onClose,
}: {
  subscriptionId: string;
  title: string;
  date: string;
  busyId: string | null;
  onAdd: (student: Student) => void;
  onClose: () => void;
}) {
  const db = useData();
  const [query, setQuery] = useState("");

  const point = joinPointFor(db, subscriptionId, date);
  const candidates = useMemo(() => {
    const q = query.trim();
    return db.students
      .filter((st) => !st.subscriptionIds.includes(subscriptionId))
      .filter((st) => (q ? studentMatches(db, st, q) : true))
      .sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`))
      .slice(0, 60);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db.students, subscriptionId, query]);

  return (
    <Modal open onClose={onClose} title="Ajouter un élève existant au groupe">
      <div className="space-y-3">
        <div className="rounded-xl bg-primary-50/60 p-3 text-[11px] text-muted">
          <strong className="block text-sm text-ink">{title}</strong>
          Il entrera en <strong className="text-primary">{point.monthCode}</strong> · séance{" "}
          <strong className="text-primary">{point.slotIndex + 1}</strong> — là où en est le groupe
          le {formatDateFr(date)}. Les séances tenues avant lui resteront vides sur sa ligne.
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Nom, n° d'inscription (00001) ou téléphone…"
            className="pl-9"
          />
        </div>
        <div className="max-h-[45vh] space-y-1.5 overflow-y-auto pr-1">
          {candidates.length === 0 ? (
            <p className="py-8 text-center text-xs italic text-muted">
              {query.trim()
                ? "Aucun élève ne correspond — il est peut-être déjà inscrit sur ce groupe."
                : "Aucun élève à ajouter."}
            </p>
          ) : (
            candidates.map((st) => (
              <div
                key={st.id}
                className="flex items-center justify-between gap-2 rounded-xl border border-line bg-surface p-2.5"
              >
                <div className="min-w-0">
                  <strong className="block text-xs text-ink">{studentName(st)}</strong>
                  <span className="text-[10px] text-muted">
                    N° {registrationNumberOf(db, st)}
                    {st.phone ? ` · ${st.phone}` : ""} · {st.subscriptionIds.length} emploi(s) du
                    temps
                  </span>
                </div>
                <Button
                  size="sm"
                  disabled={busyId === st.id}
                  onClick={() => onAdd(st)}
                  className="gap-1.5"
                >
                  <UserRoundPlus className="h-3.5 w-3.5" /> Inscrire
                </Button>
              </div>
            ))
          )}
        </div>
        <div className="flex justify-end border-t border-line pt-3">
          <Button variant="outline" onClick={onClose}>
            Fermer
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * « Tout présent » — le raccourci du matin. La liste s'ouvre entièrement cochée,
 * la recherche permet d'en décocher un ou deux, et les élèves déjà pointés ce
 * jour-là sont laissés tels quels.
 */
function MarkAllPresentModal({
  students,
  session,
  date,
  onConfirm,
  onClose,
}: {
  students: Student[];
  session: ScheduleSession;
  date: string;
  onConfirm: (ids: string[]) => Promise<void> | void;
  onClose: () => void;
}) {
  const db = useData();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string[]>(() =>
    students.filter((st) => !attendanceOn(db, st.id, session.id, date)).map((st) => st.id),
  );
  const [busy, setBusy] = useState(false);

  const shown = students.filter((st) => studentMatches(db, st, query));
  const toggle = (id: string) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <Modal open onClose={onClose} title="Marquer tout le groupe présent">
      <div className="space-y-3">
        <div className="rounded-xl bg-success/10 p-3 text-[11px] text-muted">
          Tous les élèves cochés seront pointés <strong className="text-success">présents</strong>{" "}
          le {formatDateFr(date)}. Ceux qui portent déjà un pointage ce jour-là ne sont pas
          réécrits — corrigez-les depuis leur ligne.
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher un élève…"
              className="pl-9"
            />
          </div>
          <Button size="sm" variant="outline" onClick={() => setPicked(shown.map((x) => x.id))}>
            Tout cocher
          </Button>
          <Button size="sm" variant="outline" onClick={() => setPicked([])}>
            Tout décocher
          </Button>
        </div>
        <div className="max-h-[42vh] space-y-1 overflow-y-auto pr-1">
          {shown.length === 0 ? (
            <p className="py-8 text-center text-xs italic text-muted">Aucun élève.</p>
          ) : (
            shown.map((st) => {
              const already = attendanceOn(db, st.id, session.id, date);
              return (
                <label
                  key={st.id}
                  className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-line bg-surface p-2.5 hover:bg-primary-50/40"
                >
                  <input
                    type="checkbox"
                    checked={picked.includes(st.id)}
                    onChange={() => toggle(st.id)}
                    className="h-4 w-4 shrink-0"
                  />
                  <span className="min-w-0 flex-1">
                    <strong className="block text-xs text-ink">{studentName(st)}</strong>
                    <span className="text-[10px] text-muted">
                      N° {registrationNumberOf(db, st)}
                    </span>
                  </span>
                  {already && (
                    <Badge
                      tone={already.status === "present" ? "success" : "warning"}
                      className="text-[9px]"
                    >
                      déjà {STATUS_STYLE[already.status].label.toLowerCase()}
                    </Badge>
                  )}
                </label>
              );
            })
          )}
        </div>
        <div className="flex items-center justify-between border-t border-line pt-3">
          <span className="text-[11px] font-semibold text-muted">
            {picked.length} élève(s) sélectionné(s)
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>
              Annuler
            </Button>
            <Button
              variant="success"
              disabled={busy || picked.length === 0}
              onClick={async () => {
                setBusy(true);
                await onConfirm(picked);
                setBusy(false);
              }}
              className="gap-1.5"
            >
              <CheckCheck className="h-4 w-4" />
              {busy ? "Enregistrement…" : `Marquer ${picked.length} présent(s)`}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/**
 * L'historique des encaissements d'un élève SUR CET EMPLOI DU TEMPS, corrigeable
 * sur place : un montant mal tapé se modifie, un paiement saisi en double se
 * supprime — et le solde comme la caisse suivent le mouvement.
 */
export function PaymentHistoryModal({
  student,
  subscriptionId,
  label,
  onClose,
}: {
  student: Student;
  subscriptionId: string;
  label: string;
  onClose: () => void;
}) {
  const db = useData();
  const { deleteStudentPayment, updateStudentPayment } = db;
  const { addToast } = useToast();
  const [editing, setEditing] = useState<Payment | null>(null);
  const [amount, setAmount] = useState(0);
  const [code, setCode] = useState("M1");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const rows = db.payments
    .filter((p) => p.studentId === student.id && p.subscriptionId === subscriptionId)
    .sort((a, b) => b.date.localeCompare(a.date));
  const total = rows.reduce((t, p) => t + p.amountPaid, 0);

  const openEdit = (p: Payment) => {
    setEditing(p);
    setAmount(p.amountPaid);
    setCode(p.monthCode || "M1");
    setNote(p.description ?? "");
  };

  const saveEdit = async () => {
    if (!editing) return;
    setBusy(true);
    const res = await updateStudentPayment(editing.id, {
      amount,
      monthCode: code,
      description: note,
    });
    setBusy(false);
    setEditing(null);
    addToast({
      type: res.ok ? "success" : "danger",
      title: res.ok ? "Paiement corrigé" : "Correction impossible",
      message: res.ok
        ? `${formatDA(amount)} sur ${code} — le solde et la caisse ont suivi.`
        : "Le paiement n'a pas pu être modifié.",
      studentName: studentName(student),
    });
  };

  const remove = async (p: Payment) => {
    if (
      !confirm(`Supprimer ce paiement de ${formatDA(p.amountPaid)} ? Le solde sera repris d'autant.`)
    )
      return;
    setBusy(true);
    const res = await deleteStudentPayment(p.id);
    setBusy(false);
    addToast({
      type: res.ok ? "success" : "danger",
      title: res.ok ? "Paiement supprimé" : "Suppression impossible",
      message: res.ok
        ? `${formatDA(res.amount ?? 0)} retirés du solde et de la caisse.`
        : "Le paiement n'a pas pu être supprimé.",
      studentName: studentName(student),
    });
  };

  return (
    <Modal open onClose={onClose} title="Paiements de cet emploi du temps" wide>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-primary-50/60 p-3">
          <div className="min-w-0">
            <strong className="block text-sm text-ink">{studentName(student)}</strong>
            <span className="text-[11px] text-muted">
              N° {registrationNumberOf(db, student)} · {label}
            </span>
          </div>
          <Badge tone="success" className="font-mono font-bold">
            {formatDA(total)} versés
          </Badge>
        </div>

        {rows.length === 0 ? (
          <p className="py-8 text-center text-xs italic text-muted">
            Aucun paiement enregistré sur cet emploi du temps.
          </p>
        ) : (
          <div className="max-h-[45vh] space-y-1.5 overflow-y-auto pr-1">
            {rows.map((p) => (
              <div
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface p-3"
              >
                <div className="min-w-0">
                  <strong className="block text-xs text-ink">
                    {formatDA(p.amountPaid)}
                    <Badge tone="primary" className="ml-1.5 font-mono text-[9px]">
                      {p.monthCode || "M1"}
                    </Badge>
                  </strong>
                  <span className="block text-[10px] text-muted">
                    {formatDateFr(dayKeyOf(p.date))}
                    {p.description ? ` · ${p.description}` : ""}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    onClick={() => openEdit(p)}
                    title="Modifier ce paiement"
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-line text-primary hover:bg-primary-50"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => remove(p)}
                    title="Supprimer ce paiement"
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-line text-danger hover:bg-danger/10 disabled:opacity-40"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {editing && (
          <div className="space-y-3 rounded-xl border border-primary/30 bg-primary-50/40 p-3">
            <span className="text-[10px] font-bold uppercase tracking-wider text-primary">
              Corriger le paiement
            </span>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-muted">
                  Montant versé (DA)
                </label>
                <Input
                  type="number"
                  min={0}
                  value={amount || ""}
                  onChange={(e) => setAmount(Math.max(0, Number(e.target.value) || 0))}
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-muted">
                  Mois concerné
                </label>
                <Select value={code} onChange={(e) => setCode(e.target.value)} className="w-full">
                  {Array.from({ length: 12 }, (_, i) => `M${i + 1}`).map((c) => (
                    <option key={c} value={c}>
                      {monthCodeLabel(c)}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase text-muted">
                Description
              </label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setEditing(null)}>
                Annuler
              </Button>
              <Button size="sm" onClick={saveEdit} disabled={busy}>
                Enregistrer
              </Button>
            </div>
          </div>
        )}

        <div className="flex justify-end border-t border-line pt-3">
          <Button variant="outline" onClick={onClose}>
            Fermer
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

interface PayTarget {
  student: Student;
  subscriptionId: string;
  label: string;
  monthCode: string;
  amount: number;
  /** what would clear the debt in one go */
  suggestion: number;
  description?: string;
}

/** "Imprimer le reçu ?" — asked after every cash-in, never forced. */
export function PrintAsk({
  html,
  onClose,
  question = "Imprimer le reçu du paiement ?",
}: {
  html: string;
  onClose: () => void;
  question?: string;
}) {
  return (
    <Modal open onClose={onClose} title="Impression">
      <div className="space-y-4">
        <p className="text-sm text-ink">{question}</p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Non, merci
          </Button>
          <Button
            onClick={() => {
              printHtmlDocument(html);
              onClose();
            }}
            className="gap-1.5"
          >
            <Printer className="h-4 w-4" /> Imprimer
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function StudentRow({
  student,
  session,
  subscriptionId,
  monthCode,
  monthIndex,
  slotCount,
  date,
  busy,
  onWrite,
  onPay,
  onDrill,
  onLeave,
  onHistory,
}: {
  student: Student;
  session: ScheduleSession;
  subscriptionId: string;
  monthCode: string;
  monthIndex: number;
  slotCount: number;
  date: string;
  busy: boolean;
  onWrite: (student: Student, status: AttendanceStatus | null) => void;
  onPay: (t: PayTarget) => void;
  onDrill: (kind: "previous" | "other") => void;
  onLeave: () => void;
  onHistory: () => void;
}) {
  const db = useData();
  const sub = db.subscriptions.find((s) => s.id === subscriptionId)!;
  const label = session.title || moduleNameOf(db, session.moduleId);

  const slots = cycleSlots(db, student.id, subscriptionId, monthCode);
  /** séances of this month held before he was registered — never his */
  const lead = cycleLead(db, student.id, subscriptionId, monthCode);
  const cycle = cycleOf(db, student.id, subscriptionId, monthCode);
  const sold = soldFor(db, student.id, subscriptionId);
  // « École seule » paie la part de l'école, pas le prix complet.
  const unit = studentListPrice(student, sub);
  const status = soldStatus(sold, unit);
  const today = attendanceOn(db, student.id, session.id, date);

  /** Ce qu'il doit ENCORE sur le mois affiché — jamais un nombre négatif. */
  const monthDue = Math.max(0, -cycle.balance);
  const prevDebt =
    monthIndex > 0 ? Math.max(0, -cycleOf(db, student.id, subscriptionId, `M${monthIndex}`).balance) : 0;
  const otherDebt = studentSoldDebtRows(db, student.id)
    .filter((r) => r.subscriptionId !== subscriptionId)
    .reduce((s, r) => s + r.debt, 0);

  const caseLabel = studentCaseLabel(student);

  const soldTone =
    status === "debt" ? "danger" : status === "empty" ? "warning" : status === "low" ? "warning" : "success";

  return (
    <tr className="border-t border-line/60 align-middle hover:bg-primary-50/30">
      <td className="px-2 py-2 font-mono text-[11px] text-muted">
        {registrationNumberOf(db, student)}
      </td>
      <td className="px-2 py-2">
        <strong className="block text-ink">{studentName(student)}</strong>
        {caseLabel && (
          <Badge tone={studentCaseTone(student)} className="mt-0.5 text-[9px]">
            {caseLabel}
          </Badge>
        )}
      </td>
      <td className="px-2 py-2 text-muted">{student.phone || "—"}</td>

      {Array.from({ length: slotCount }, (_, i) => {
        // Before his arrival the séance simply is not his: the box stays empty
        // instead of reading like a pointage still to do.
        const before = i < lead;
        const rec: AttendanceRecord | undefined = before ? undefined : slots[i - lead];
        return (
          <td key={i} className="px-1 py-2 text-center">
            <span
              title={
                before
                  ? `Séance tenue avant son inscription (inscrit à la séance ${lead + 1})`
                  : rec
                    ? `${STATUS_STYLE[rec.status].label} — ${formatDateFr(rec.timestamp.slice(0, 10))}`
                    : "Pas encore pointé"
              }
              className={`inline-flex h-6 w-6 items-center justify-center rounded-lg border text-[11px] font-black ${
                before
                  ? "border-dashed border-line bg-canvas/40 text-muted/40"
                  : rec
                    ? STATUS_STYLE[rec.status].cls
                    : "border-line bg-canvas text-muted/50"
              }`}
            >
              {before ? "" : rec ? STATUS_STYLE[rec.status].short : "–"}
            </span>
          </td>
        );
      })}

      {/* current month — jamais un solde signé : ce qui est VERSÉ d'un côté,
          ce qui RESTE DÛ de l'autre. Un montant payé ne s'affiche donc plus
          avec un moins devant. */}
      <td className="px-2 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="success" className="font-mono" title={`Versé sur ${monthCode}`}>
            {formatDA(cycle.credited)}
          </Badge>
          {monthDue > 0 ? (
            <Badge tone="danger" className="font-mono" title={`Reste dû sur ${monthCode}`}>
              reste {formatDA(monthDue)}
            </Badge>
          ) : (
            <Badge tone="success" title={`${monthCode} réglé`}>✅</Badge>
          )}
          <button
            onClick={() =>
              onPay({
                student,
                subscriptionId,
                label,
                monthCode,
                amount: monthDue || 0,
                suggestion: monthDue,
              })
            }
            title="Encaisser un solde sur ce mois"
            className="flex h-6 w-6 items-center justify-center rounded-lg bg-primary text-white transition-colors hover:brightness-110"
          >
            <Wallet className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onHistory}
            title="Historique des paiements — modifier ou supprimer"
            className="flex h-6 w-6 items-center justify-center rounded-lg border border-line text-muted transition-colors hover:bg-primary-50 hover:text-ink"
          >
            <History className="h-3.5 w-3.5" />
          </button>
        </div>
        <span className="mt-0.5 block text-[9px] text-muted">
          {cycle.done}/{Math.max(0, cycle.size - cycle.lead)} séance(s) · consommé{" "}
          {formatDA(cycle.consumed)}
          {cycle.complete ? " · mois clos" : ""}
          {cycle.lead > 0 ? ` · entré à la séance ${cycle.lead + 1}` : ""}
        </span>
        <span className={`block text-[9px] font-semibold ${soldTone === "danger" ? "text-danger" : "text-muted"}`}>
          Solde de l&apos;emploi :{" "}
          {sold < 0 ? `${formatDA(-sold)} dus` : `${formatDA(sold)} d'avance`}
        </span>
      </td>

      {/* previous month */}
      <td className="px-2 py-2">
        {monthIndex === 0 ? (
          <span className="text-[10px] text-muted">—</span>
        ) : prevDebt > 0 ? (
          <button
            onClick={() => onDrill("previous")}
            className="rounded-lg border border-danger/40 bg-danger/10 px-2 py-1 text-[10px] font-bold text-danger hover:bg-danger/20"
          >
            {formatDA(prevDebt)}
          </button>
        ) : (
          <span className="text-sm" title="Mois précédent réglé">
            ✅
          </span>
        )}
      </td>

      {/* other emplois */}
      <td className="px-2 py-2">
        {otherDebt > 0 ? (
          <button
            onClick={() => onDrill("other")}
            className="rounded-lg border border-warning/40 bg-warning/10 px-2 py-1 text-[10px] font-bold text-warning hover:bg-warning/20"
          >
            {formatDA(otherDebt)}
          </button>
        ) : (
          <span className="text-sm" title="Aucune autre dette">
            ✅
          </span>
        )}
      </td>

      {/* today's marking */}
      <td className="px-2 py-2">
        <div className="flex items-center justify-center gap-1">
          <MarkButton
            active={today?.status === "present"}
            disabled={busy}
            tone="success"
            title="Présent"
            onClick={() => onWrite(student, "present")}
          >
            <Check className="h-3.5 w-3.5" />
          </MarkButton>
          <MarkButton
            active={today?.status === "absent"}
            disabled={busy}
            tone="danger"
            title="Absent"
            onClick={() => onWrite(student, "absent")}
          >
            <X className="h-3.5 w-3.5" />
          </MarkButton>
          <MarkButton
            active={today?.status === "cancelled"}
            disabled={busy}
            tone="primary"
            title="Séance annulée"
            onClick={() => onWrite(student, "cancelled")}
          >
            <Slash className="h-3.5 w-3.5" />
          </MarkButton>
          <MarkButton
            active={false}
            disabled={busy || !today}
            tone="neutral"
            title="Retour — annuler ce pointage et rendre le solde"
            onClick={() => onWrite(student, null)}
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </MarkButton>
        </div>
      </td>

      {/* off the group — his présences, ses paiements et son solde restent */}
      <td className="px-2 py-2">
        <div className="flex items-center justify-center">
          <button
            disabled={busy}
            onClick={onLeave}
            title="Désinscrire cet élève de ce groupe"
            className="flex h-7 items-center gap-1 rounded-lg border border-line px-2 text-[10px] font-bold text-danger transition-colors hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <UserMinus className="h-3.5 w-3.5" /> Désinscrire
          </button>
        </div>
      </td>
    </tr>
  );
}

function MarkButton({
  active,
  disabled,
  tone,
  title,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  tone: "success" | "danger" | "primary" | "neutral";
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const tones: Record<string, string> = {
    success: active ? "bg-success text-white border-success" : "border-line text-success hover:bg-success/10",
    danger: active ? "bg-danger text-white border-danger" : "border-line text-danger hover:bg-danger/10",
    primary: active ? "bg-primary text-white border-primary" : "border-line text-primary hover:bg-primary/10",
    neutral: "border-line text-muted hover:bg-primary-50",
  };
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-7 w-7 items-center justify-center rounded-lg border transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${tones[tone]}`}
    >
      {children}
    </button>
  );
}

/** The debt behind a "mois précédent" / "autres dettes" chip, payable here. */
function DebtDrill({
  student,
  kind,
  subscriptionId,
  monthIndex,
  onClose,
  onPay,
}: {
  student: Student;
  kind: "previous" | "other";
  subscriptionId: string;
  monthIndex: number;
  onClose: () => void;
  onPay: (t: PayTarget) => void;
}) {
  const db = useData();

  const rows =
    kind === "previous"
      ? enrollmentCycles(db, student.id, subscriptionId)
          .filter((c) => c.index < monthIndex && c.balance < 0)
          .map((c) => ({
            subscriptionId,
            label:
              db.sessions.find((s) => s.id === db.subscriptions.find((x) => x.id === subscriptionId)?.sessionId)
                ?.title ?? "Emploi du temps",
            code: c.code,
            debt: -c.balance,
            done: c.done,
            size: c.size,
          }))
      : studentSoldDebtRows(db, student.id)
          .filter((r) => r.subscriptionId !== subscriptionId)
          .map((r) => ({ ...r, done: 0, size: 0 }));

  return (
    <Modal
      open
      onClose={onClose}
      title={kind === "previous" ? "Dettes des mois précédents" : "Dettes sur les autres emplois du temps"}
    >
      <div className="space-y-3">
        <div className="rounded-xl bg-primary-50/60 p-3">
          <strong className="block text-sm text-ink">{studentName(student)}</strong>
          <span className="text-[11px] text-muted">N° {registrationNumberOf(db, student)}</span>
        </div>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-xs italic text-muted">Aucune dette. ✅</p>
        ) : (
          <div className="space-y-2">
            {rows.map((r) => (
              <div
                key={`${r.subscriptionId}-${r.code}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface p-3"
              >
                <div className="min-w-0">
                  <strong className="block text-xs text-ink">{r.label}</strong>
                  <span className="text-[10px] text-muted">
                    {monthCodeLabel(r.code)}
                    {r.size ? ` · ${r.done}/${r.size} séances` : ""}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone="danger" className="font-mono">
                    {formatDA(r.debt)}
                  </Badge>
                  <Button
                    size="sm"
                    onClick={() =>
                      onPay({
                        student,
                        subscriptionId: r.subscriptionId,
                        label: r.label,
                        monthCode: r.code,
                        amount: r.debt,
                        suggestion: r.debt,
                        description: `Règlement ${r.code} — ${r.label}`,
                      })
                    }
                  >
                    Payer
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="flex justify-end border-t border-line pt-3">
          <Button variant="outline" onClick={onClose}>
            Fermer
          </Button>
        </div>
      </div>
    </Modal>
  );
}
