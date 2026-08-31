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
import { formatDA, money } from "@/lib/utils";
import { printHtmlDocument } from "@/lib/print";
import { PrintAsk } from "@/components/ui/PrintAsk";
import { SeanceStepper } from "@/components/students/SeanceStepper";
import {
  ChargeFormModal,
  StudentChargesModal,
} from "@/components/students/StudentCharges";
import {
  presenceSheetHtml,
  seanceLibreInvoiceHtml,
  soldReceiptHtml,
} from "@/lib/reports/documents";
import {
  AlertTriangle,
  Banknote,
  Check,
  CheckCheck,
  Landmark,
  ChevronLeft,
  ChevronRight,
  Clock,
  GraduationCap,
  HandCoins,
  History,
  Pencil,
  Printer,
  Receipt,
  RotateCcw,
  Search,
  Slash,
  Ticket,
  Trash2,
  UserMinus,
  UserPlus,
  UserRoundPlus,
  Users,
  Wallet,
  X,
} from "lucide-react";
import type {
  AttendanceRecord,
  AttendanceStatus,
  IndependentSession,
  Payment,
  ScheduleSession,
  Student,
} from "@/lib/types";
import type { Teacher } from "@/lib/types";
import {
  DAY_LABELS_FR,
  attendanceOn,
  cycleLead,
  cycleOf,
  cycleSizeOf,
  cycleSlots,
  currentCycleCode,
  dayKeyOf,
  enrolledInMonth,
  enrollmentCycles,
  formatDateFr,
  groupName,
  independentTotals,
  joinPointFor,
  passagerLabel,
  passagersOn,
  moduleName as moduleNameOf,
  monthCodeLabel,
  monthOrder,
  registrationNumberOf,
  schoolPerSeanceOf,
  salleName,
  sessionSalleOn,
  sessionTimesOn,
  slotCountFor,
  soldFor,
  soldStatus,
  studentCaseLabel,
  studentCaseTone,
  studentListPrice,
  studentMatches,
  studentMonthPrice,
  studentAdvanceDebt,
  studentChargeDebt,
  studentDebtSummary,
  studentName,
  studentSoldDebtRows,
  subscriptionLabel,
  teacherName,
  todayIso,
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
  /**
   * LES DROITS DE CELUI QUI OUVRE LA FEUILLE.
   *
   * La feuille sert deux écrans — le tableau de bord et « Présences » — qui
   * n'accordent pas les mêmes droits. Plutôt que de deviner d'où elle est
   * ouverte, elle reçoit la réponse : peut-il pointer ? peut-il encaisser ?
   *
   * Absent = oui, ce que voit l'administration.
   */
  canMark?: boolean;
  canCollect?: boolean;
}

export function PresenceSheet({
  session,
  date,
  monthCode,
  onMonthChange,
  onCreateStudent,
  canMark = true,
  canCollect = true,
}: PresenceSheetProps) {
  const db = useData();
  const {
    setPresence,
    addSold,
    unsubscribeStudent,
    subscribeStudent,
    createPassagerSeances,
    deleteFrom,
  } = db;
  const { language } = useSettings();
  const { addToast } = useToast();

  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pay, setPay] = useState<PayTarget | null>(null);
  const [drill, setDrill] = useState<{
    student: Student;
    /**
     * `previous` : ses mois passés SUR CET EMPLOI ;
     * `other`    : ses mois en dette sur les AUTRES emplois du temps ;
     * `all`      : TOUT ce qu'il doit en scolarité, celui-ci compris — ce que
     *              l'alerte du haut ouvre, parce qu'elle parle de la dette
     *              entière et non d'une moitié.
     */
    kind: "previous" | "other" | "all";
  } | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  /** the student the desk is about to take off the group */
  const [leaving, setLeaving] = useState<Student | null>(null);
  /** inscrire un élève DÉJÀ dans la base sur cet emploi du temps */
  const [addOpen, setAddOpen] = useState(false);
  /** pointer tout le monde d'un coup — présents, ou séance annulée pour tous */
  const [bulkStatus, setBulkStatus] = useState<"present" | "cancelled" | null>(null);
  /** l'historique des paiements d'un élève sur cet emploi — modifiable */
  const [history, setHistory] = useState<Student | null>(null);
  /** le pointage qu'on s'apprête à RETIRER, en rendant ce qu'il avait débité */
  const [removing, setRemoving] = useState<{ student: Student; record: AttendanceRecord } | null>(
    null,
  );
  /** l'enfant d'enseignant dont on règle la scolarité au guichet */
  const [childPay, setChildPay] = useState<Student | null>(null);
  /** « Dettes & frais » d'un élève, ouvert depuis sa ligne — encaissement compris */
  const [charges, setCharges] = useState<{ student: Student; tab: "list" | "pay" } | null>(null);
  /** porter un NOUVEAU frais à un élève, sans quitter la feuille */
  const [chargeForm, setChargeForm] = useState<Student | null>(null);
  /** la saisie des élèves de passage venus sur LA séance affichée */
  const [passagerOpen, setPassagerOpen] = useState(false);
  /** la séance libre d'un passager que l'on s'apprête à retirer */
  const [passagerToRemove, setPassagerToRemove] = useState<IndependentSession | null>(null);

  // Un tarif ARCHIVÉ (retiré du catalogue) ne pointe plus : la feuille demande
  // qu'on le redéfinisse, comme pour un emploi qui n'en a jamais eu.
  const sub = db.subscriptions.find((s) => s.sessionId === session.id && !s.archivedAt);
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

  /**
   * LE COMPTE DE LA JOURNÉE, EN CINQ NOMBRES.
   *
   * La question que la réception pose en ouvrant un groupe : combien sont
   * inscrits, combien sont là, combien manquent, pour combien la séance est
   * annulée, et combien restent à pointer. Le calcul lit les MÊMES lignes que
   * le tableau, donc chaque clic sur « présent » ou « absent » le déplace dans
   * la seconde — il n'y a rien à rafraîchir.
   */
  /**
   * QUI DOIT DE L'ARGENT DANS CE GROUPE — les trois dettes d'un élève, lues
   * ensemble, parce que la réception les réclame dans la même phrase :
   *
   *   * la SCOLARITÉ : ses mois dans le rouge, sur cet emploi et sur les
   *     autres, plus les restes d'anciens paiements et les frais d'inscription ;
   *   * les FRAIS : un livre, une tenue, une sortie — tout ce qui a été porté à
   *     son compte hors scolarité ;
   *   * les AVANCES DE L'ÉCOLE : ce que la caisse a réglé À SA PLACE pour ne
   *     pas faire attendre l'enseignant. Cet argent est sorti sans jamais
   *     entrer : la famille le doit à l'école, et c'est ici qu'on le lui
   *     rappelle, en face de son nom, le jour où elle est là.
   *
   * Les trois se règlent sur CET écran, sans jamais ouvrir la fiche de l'élève.
   */
  const alerts = useMemo(() => {
    const rows = roster
      .map((st) => {
        const summary = studentDebtSummary(db, st.id);
        const charges = studentChargeDebt(db, st.id);
        const advances = studentAdvanceDebt(db, st.id);
        return {
          student: st,
          school: summary.total,
          charges,
          advances,
          total: summary.total + charges,
        };
      })
      .filter((r) => r.total > 0)
      .sort((a, b) => b.total - a.total);
    return {
      rows,
      total: rows.reduce((t, r) => t + r.total, 0),
      advances: rows.reduce((t, r) => t + r.advances, 0),
      charges: rows.reduce((t, r) => t + r.charges, 0),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roster, db.payments, db.enrollments, db.attendance, db.studentCharges, db.students]);

  const dayTally = useMemo(() => {
    const tally = { total: roster.length, present: 0, absent: 0, cancelled: 0, pending: 0 };
    for (const st of roster) {
      const rec = attendanceOn(db, st.id, session.id, date);
      if (!rec) tally.pending += 1;
      else if (rec.status === "cancelled") tally.cancelled += 1;
      else if (rec.status === "absent") tally.absent += 1;
      else tally.present += 1;
    }
    return tally;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roster, db.attendance, session.id, date]);

  // ---- writing ------------------------------------------------------------
  /**
   * Le refus se dit une fois, ici : les boutons interdits ne s'affichent déjà
   * pas, mais la feuille se pilote aussi au clavier et au badge — l'écriture
   * elle-même doit donc savoir dire non.
   */
  const refuse = (what: string) => {
    addToast({
      type: "danger",
      title: "Action non autorisée",
      message: `Votre compte n'a pas le droit de ${what}.`,
    });
  };

  const write = async (student: Student, status: AttendanceStatus | null) => {
    if (!canMark) return refuse("pointer les présences");
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

  /**
   * RETIRER UN POINTAGE, quel que soit le jour où il a été saisi.
   *
   * C'est l'inverse exact de l'écriture : la ligne s'efface, la séance cesse
   * d'être consommée, et le prix qu'elle avait pris sur le solde de CET emploi
   * du temps y est RENDU au dinar près (une séance annulée ou non facturée
   * n'ayant rien coûté, il n'y a rien à rendre). La part que la séance devait à
   * l'enseignant s'en va avec elle, tant qu'elle n'a pas été réglée.
   */
  const removeRecord = async (student: Student, record: AttendanceRecord) => {
    if (!canMark) return refuse("corriger un pointage");
    const day = dayKeyOf(record.timestamp);
    setBusyId(student.id);
    const res = await setPresence({
      studentId: student.id,
      sessionId: session.id,
      date: day,
      status: null,
    });
    setBusyId(null);
    setRemoving(null);
    if (!res.ok) {
      addToast({
        type: "danger",
        title: "Retrait impossible",
        message: "Ce pointage n'a pas pu être retiré.",
        studentName: studentName(student),
      });
      return;
    }
    addToast({
      type: "success",
      title: `${STATUS_STYLE[record.status].label} retiré${
        record.status === "absent" ? "e" : ""
      }`,
      message:
        (res.refunded
          ? `${formatDA(res.refunded)} rendus sur le solde de cet emploi du temps`
          : "Cette séance n'avait rien débité") +
        ` — séance du ${formatDateFr(day)} · solde ${formatDA(res.balance ?? 0)}`,
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

  // ---- marking the WHOLE list at once ------------------------------------
  /**
   * « Tout présent » et « Séance annulée pour tous » écrivent la même chose sur
   * toute la liste, avec deux différences de fond : une présence consomme une
   * séance et débite le solde, une séance ANNULÉE ne coûte rien à personne — ni
   * séance, ni argent, ni part enseignant — et n'avance pas le mois du groupe.
   *
   * Une annulation, elle, RÉÉCRIT un pointage déjà saisi : la séance n'a pas eu
   * lieu, donc la présence notée par erreur doit être reprise (et le solde
   * rendu). Un « tout présent » respecte au contraire ce qui a déjà été choisi.
   */
  const markAll = async (ids: string[], status: "present" | "cancelled") => {
    if (!canMark) return refuse("pointer les présences");
    for (const id of ids) {
      const student = db.students.find((s) => s.id === id);
      if (!student) continue;
      const already = attendanceOn(db, id, session.id, date);
      if (status === "present" && already) continue;
      if (status === "cancelled" && already?.status === "cancelled") continue;
      await setPresence({ studentId: id, sessionId: session.id, date, status });
    }
    setBulkStatus(null);
    addToast({
      type: "success",
      title: status === "present" ? "Présences enregistrées" : "Séance annulée pour le groupe",
      message:
        status === "present"
          ? `${ids.length} élève(s) marqué(s) présents le ${formatDateFr(date)}.`
          : `${ids.length} élève(s) — séance du ${formatDateFr(date)} annulée : aucune séance consommée, aucun solde débité.`,
    });
  };

  // ---- cashing a solde in -------------------------------------------------
  const submitPay = async () => {
    if (!canCollect) return refuse("encaisser un paiement");
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
      date: pay.date,
    });
    setBusyId(null);
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

  // ---- les élèves de passage de CETTE séance ------------------------------
  /**
   * LES PASSAGERS D'UNE SÉANCE, ET D'ELLE SEULE.
   *
   * Un élève de passage n'est pas inscrit : il vient une fois, paie sa séance
   * et repart. Il n'a donc ni mois, ni solde, ni place sur la feuille du jour
   * suivant — sa ligne est attachée à LA DATE affichée. Ouvrir la séance
   * d'après ne le montre pas : si la même personne revient, la réception la
   * ressaisit, ce qui est exactement ce qui se passe au comptoir.
   *
   * Ce que sa séance rapporte à l'enseignant (prix − part de l'école) se règle
   * avec le MOIS où cette date tombe, dans la table « Retards de paiement &
   * séances libres » de sa paie.
   */
  const passagers = passagersOn(db, session.id, date);
  const passagerTotals = passagers.reduce(
    (acc, p) => {
      const t = independentTotals(p);
      acc.total = money(acc.total + t.price);
      acc.school = money(acc.school + t.school);
      acc.teacher = money(acc.teacher + t.teacher);
      return acc;
    },
    { total: 0, school: 0, teacher: 0 },
  );

  /**
   * AJOUTER À CETTE SÉANCE CEUX QUI NE SONT PAS INSCRITS DESSUS.
   *
   * Deux personnes très différentes passent par ici, et c'est volontaire :
   *
   *  - des PASSAGERS sans fiche, saisis en nombre, nommés ou non ;
   *  - un ÉLÈVE DÉJÀ INSCRIT à l'école, retrouvé par son nom ou son numéro,
   *    qui vient suivre UNE séance de cet emploi du temps sans s'y inscrire.
   *    Sa séance se rattache à sa fiche — donc à son historique — mais elle
   *    n'ouvre aucun solde et ne le met sur aucune liste du mois prochain.
   *
   * Dans les deux cas l'argent entre en caisse tout de suite, et le reçu est
   * proposé dans la foulée : c'est le ticket qu'on remet à la famille.
   */
  const addPassagers = async (input: {
    names: string[];
    price: number;
    schoolShare: number;
    label: string;
    /** l'élève inscrit qui suit la séance, quand c'en est un */
    student?: Student;
  }) => {
    const res = await createPassagerSeances({
      sessionId: session.id,
      date,
      names: input.names,
      price: input.price,
      schoolShare: input.schoolShare,
      itemLabel: input.label,
      studentId: input.student?.id,
    });
    if (!res.ok) {
      addToast({
        type: "danger",
        title: "Enregistrement impossible",
        message: "Ces séances libres n'ont pas pu être ajoutées.",
      });
      return;
    }
    setPassagerOpen(false);
    const who = input.student
      ? studentName(input.student)
      : `${input.names.length} élève(s) de passage`;
    addToast({
      type: "success",
      title: `${who} — séance libre enregistrée`,
      message: `${formatDA(res.total ?? 0)} encaissés sur la séance du ${formatDateFr(date)} · ${formatDA(
        res.teacherTotal ?? 0,
      )} pour ${teacherName(db, session.teacherId)} — réglés avec ${monthCodeLabel(monthCode)}.`,
    });
    // Le reçu de la séance libre, proposé aussitôt : sans lui, la famille
    // repartait sans ticket pour un argent bel et bien encaissé.
    setReceipt(
      seanceLibreInvoiceHtml(db, {
        payer: input.student
          ? studentName(input.student)
          : input.names.map((n) => n.trim()).filter(Boolean)[0] ||
            `${input.names.length} passager(s)`,
        registrationNumber: input.student
          ? registrationNumberOf(db, input.student)
          : undefined,
        classLabel: input.student ? studentCaseLabel(input.student) : undefined,
        itemLabel: input.label,
        price: res.total ?? 0,
        date,
        time: `${sessionTimesOn(session, JS_DAYS[new Date(`${date}T12:00:00`).getDay()]).startTime} - ${
          sessionTimesOn(session, JS_DAYS[new Date(`${date}T12:00:00`).getDay()]).endTime
        }`,
        language,
      }),
    );
  };

  const removePassager = (p: IndependentSession) => {
    deleteFrom("independent", p.id);
    setPassagerToRemove(null);
    addToast({
      type: "success",
      title: "Élève de passage retiré",
      message: `${passagerLabel(db, p)} — la séance et la part de l'enseignant s'en vont avec lui.`,
    });
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
            Groupe {groupName(db, session.groupId)} · Salle{" "}
            {salleName(db, sessionSalleOn(session, JS_DAYS[new Date(`${date}T12:00:00`).getDay()]))} ·{" "}
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
          {/* IL EST VENU UNE FOIS. On ne l'inscrit pas sur cet emploi du temps :
              il paie sa séance et il figure sur CETTE feuille-là. Que l'école
              le connaisse déjà ou non ne change rien à cela. */}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPassagerOpen(true)}
            className="gap-1.5"
            title="Ajouter à la séance du jour des passagers sans fiche, ou un élève déjà inscrit venu suivre une séance libre — sans l'inscrire sur cet emploi du temps"
          >
            <Ticket className="h-3.5 w-3.5 text-primary" /> Séance libre
          </Button>
          <Button size="sm" variant="success" onClick={() => setBulkStatus("present")} className="gap-1.5">
            <CheckCheck className="h-3.5 w-3.5" /> Tout présent
          </Button>
          {/* La séance n'a pas eu lieu : personne ne consomme rien. */}
          <Button size="sm" variant="outline" onClick={() => setBulkStatus("cancelled")} className="gap-1.5">
            <Slash className="h-3.5 w-3.5 text-primary" /> Séance annulée pour tous
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

      {/* ---- le compte de la journée, mis à jour à chaque clic ------------- */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <TallyCard
          label="Élèves du groupe"
          value={dayTally.total}
          tone="primary"
          icon={<Users className="h-4 w-4" />}
          hint={`Inscrits sur ${monthCode}`}
        />
        <TallyCard
          label="Présents"
          value={dayTally.present}
          tone="success"
          icon={<Check className="h-4 w-4" />}
          hint={pctOf(dayTally.present, dayTally.total)}
        />
        <TallyCard
          label="Absents"
          value={dayTally.absent}
          tone="danger"
          icon={<X className="h-4 w-4" />}
          hint={pctOf(dayTally.absent, dayTally.total)}
        />
        <TallyCard
          label="Séance annulée"
          value={dayTally.cancelled}
          tone="primary"
          icon={<Slash className="h-4 w-4" />}
          hint="Ne coûte rien"
        />
        <TallyCard
          label="À pointer"
          value={dayTally.pending}
          tone={dayTally.pending > 0 ? "warning" : "success"}
          icon={<Clock className="h-4 w-4" />}
          hint={dayTally.pending === 0 ? "Journée complète" : "Reste à saisir"}
        />
      </div>

      {!scheduledDay && (
        <p className="rounded-xl border border-warning/40 bg-warning/10 p-2.5 text-[11px] text-warning">
          Ce créneau n&apos;est pas programmé ce jour-là — le pointage reste possible mais vérifiez la
          date.
        </p>
      )}

      {/* ---- L'ALERTE DU GROUPE : QUI DOIT DE L'ARGENT ---------------------
          Elle est en haut de la feuille parce que c'est le seul moment où la
          famille est joignable : l'élève est là, devant le comptoir. Chaque
          ligne se règle d'un clic, sans quitter l'écran ni ouvrir de fiche. */}
      {alerts.rows.length > 0 && (
        <section className="overflow-hidden rounded-2xl border-2 border-danger/40">
          <div className="flex flex-wrap items-center justify-between gap-2 bg-danger/10 p-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="rounded-xl bg-danger/15 p-2 text-danger">
                <AlertTriangle className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <strong className="block text-xs text-ink">
                  {alerts.rows.length} élève(s) de ce groupe doivent de l&apos;argent
                </strong>
                <span className="block text-[10px] text-muted">
                  Scolarité, frais divers et dettes avancées par l&apos;école — encaissables ici
                  même, à la date de votre choix, en totalité ou en partie.
                </span>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-1.5">
              <Badge tone="danger" className="font-mono text-[11px]">
                {formatDA(alerts.total)} au total
              </Badge>
              {alerts.charges > 0 && (
                <Badge tone="warning" className="gap-1 font-mono text-[10px]">
                  <Receipt className="h-3 w-3" /> {formatDA(alerts.charges)} de frais
                </Badge>
              )}
              {alerts.advances > 0 && (
                <Badge tone="warning" className="gap-1 font-mono text-[10px]">
                  <Landmark className="h-3 w-3" /> {formatDA(alerts.advances)} avancés par
                  l&apos;école
                </Badge>
              )}
            </div>
          </div>

          <div className="max-h-56 space-y-1.5 overflow-y-auto p-2.5">
            {alerts.rows.map((r) => (
              <div
                key={r.student.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-danger/25 bg-danger/5 px-3 py-2"
              >
                <span className="min-w-0 text-xs">
                  <span className="font-mono text-[10px] text-muted">
                    {registrationNumberOf(db, r.student)}
                  </span>{" "}
                  <strong className="text-ink">{studentName(r.student)}</strong>
                  {r.student.phone && (
                    <span className="text-[10px] text-muted"> · {r.student.phone}</span>
                  )}
                  <span className="block text-[10px] text-muted">
                    {r.school > 0 ? `Scolarité ${formatDA(r.school)}` : "Scolarité à jour"}
                    {r.charges > 0 ? ` · Frais ${formatDA(r.charges)}` : ""}
                    {r.advances > 0
                      ? ` · dont ${formatDA(r.advances)} avancés par l'école`
                      : ""}
                  </span>
                </span>
                <span className="flex shrink-0 flex-wrap items-center gap-1.5">
                  <Badge tone="danger" className="font-mono text-[10px]">
                    {formatDA(r.total)}
                  </Badge>
                  {r.school > 0 && (
                    <button
                      onClick={() => setDrill({ student: r.student, kind: "all" })}
                      title="Voir et régler ses mois en dette, emploi par emploi"
                      className="flex h-7 items-center gap-1 rounded-lg border border-primary/40 bg-primary-50/70 px-2 text-[10px] font-bold text-primary hover:bg-primary hover:text-white"
                    >
                      <Wallet className="h-3 w-3" /> Régler la scolarité
                    </button>
                  )}
                  {r.charges > 0 && (
                    <button
                      onClick={() => setCharges({ student: r.student, tab: "pay" })}
                      title="Régler ses frais : livres, tenues, avances de l'école…"
                      className="flex h-7 items-center gap-1 rounded-lg border border-danger/40 bg-danger/10 px-2 text-[10px] font-bold text-danger hover:bg-danger hover:text-white"
                    >
                      <Receipt className="h-3 w-3" /> Régler les frais
                    </button>
                  )}
                </span>
              </div>
            ))}
          </div>
        </section>
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
              <th className="px-2 py-2.5">Frais &amp; avances</th>
              <th className="px-2 py-2.5 text-center">Pointage du jour</th>
              <th className="px-2 py-2.5 text-center">Groupe</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr>
                <td colSpan={slotCount + 9} className="px-3 py-10 text-center text-xs italic text-muted">
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
                  onPay={canCollect ? setPay : undefined}
                  onDrill={(kind) => setDrill({ student: st, kind })}
                  onLeave={() => setLeaving(st)}
                  onHistory={() => setHistory(st)}
                  onRemove={(record) => setRemoving({ student: st, record })}
                  onChildPay={() => setChildPay(st)}
                  onCharges={(tab) => setCharges({ student: st, tab })}
                  onNewCharge={() => setChargeForm(st)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ---- les élèves de passage de CETTE séance ------------------------- */}
      <section className="overflow-hidden rounded-2xl border border-primary/30">
        <div className="flex flex-wrap items-center justify-between gap-2 bg-primary-50/50 p-3">
          <div className="min-w-0">
            <strong className="flex items-center gap-1.5 text-sm text-ink">
              <Ticket className="h-4 w-4 text-primary" /> Séances libres — séance du{" "}
              {formatDateFr(date)} ({passagers.length})
            </strong>
            <span className="block text-[11px] leading-relaxed text-muted">
              Ils ne sont <strong className="text-ink">pas inscrits sur cet emploi du temps</strong>{" "}
              : ils paient la séance sur place et n&apos;apparaissent que sur cette feuille-ci — un
              passager sans fiche comme un élève déjà inscrit ailleurs. La séance suivante repart
              sans eux. Ce que l&apos;école ne garde pas revient à l&apos;enseignant et se règle
              avec {monthCodeLabel(monthCode)}.
            </span>
          </div>
          <Button size="sm" onClick={() => setPassagerOpen(true)} className="gap-1.5">
            <Ticket className="h-3.5 w-3.5" /> Ajouter une séance libre
          </Button>
        </div>

        {passagers.length === 0 ? (
          <p className="bg-surface px-3 py-5 text-center text-xs italic text-muted">
            Aucune séance libre sur le créneau du {formatDateFr(date)}.
          </p>
        ) : (
          <div className="overflow-x-auto bg-surface">
            <table className="w-full min-w-[640px] text-[11px]">
              <thead className="bg-canvas/60">
                <tr className="text-left text-[9px] uppercase tracking-wide text-muted">
                  <th className="px-2 py-2">Qui a suivi la séance</th>
                  <th className="px-2 py-2">Séance</th>
                  <th className="px-2 py-2 text-center">Horaire</th>
                  <th className="px-2 py-2 text-right">Prix payé</th>
                  <th className="px-2 py-2 text-right">Part école</th>
                  <th className="px-2 py-2 text-right">Part enseignant</th>
                  <th className="px-2 py-2 text-center">Retirer</th>
                </tr>
              </thead>
              <tbody>
                {passagers.map((p) => {
                  const t = independentTotals(p);
                  return (
                    <tr key={p.id} className="border-t border-line/60">
                      <td className="px-2 py-2">
                        <strong className="text-ink">{passagerLabel(db, p)}</strong>
                        {/* Un élève DÉJÀ INSCRIT venu suivre une séance libre se
                            distingue d'un passager sans fiche : il porte son
                            numéro d'inscription, et son nom vient de sa fiche. */}
                        {p.studentId ? (
                          <Badge tone="success" className="ms-1 text-[8px]">
                            élève inscrit
                            {(() => {
                              const st = db.students.find((x) => x.id === p.studentId);
                              return st ? ` · n° ${registrationNumberOf(db, st)}` : "";
                            })()}
                          </Badge>
                        ) : (
                          <Badge tone="primary" className="ms-1 text-[8px]">
                            passager
                          </Badge>
                        )}
                      </td>
                      <td className="px-2 py-2 text-[10px] text-muted">{p.itemLabel}</td>
                      <td className="px-2 py-2 text-center font-mono text-[10px] text-muted">
                        {p.startTime} → {p.endTime}
                      </td>
                      <td className="px-2 py-2 text-right font-mono">{formatDA(t.price)}</td>
                      <td className="px-2 py-2 text-right font-mono text-muted">
                        {formatDA(t.school)}
                      </td>
                      <td className="px-2 py-2 text-right font-mono font-bold text-primary">
                        {formatDA(t.teacher)}
                      </td>
                      <td className="px-2 py-2 text-center">
                        <button
                          onClick={() => setPassagerToRemove(p)}
                          disabled={!!p.teacherPaid}
                          title={
                            p.teacherPaid
                              ? "L'enseignant a déjà été réglé pour cette séance — annulez son règlement d'abord"
                              : "Retirer cet élève de passage de la séance"
                          }
                          className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-line text-danger transition-colors hover:bg-danger/10 disabled:opacity-30"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-line bg-canvas/60">
                  <td colSpan={3} className="px-2 py-2 text-right text-[11px] font-bold text-ink">
                    TOTAL DE LA SÉANCE
                  </td>
                  <td className="px-2 py-2 text-right font-mono font-black text-success">
                    {formatDA(passagerTotals.total)}
                  </td>
                  <td className="px-2 py-2 text-right font-mono font-bold text-muted">
                    {formatDA(passagerTotals.school)}
                  </td>
                  <td className="px-2 py-2 text-right font-mono font-black text-primary">
                    {formatDA(passagerTotals.teacher)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

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
          onPay={canCollect ? setPay : undefined}
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
                La réception ne calcule plus de tête. Un bouton ajoute le prix
                d'UNE séance, et il ne peut être cliqué qu'autant de fois qu'il
                reste de séances À PAYER à cet élève sur ce mois — comptées
                depuis SA première séance, pas depuis son dernier pointage : un
                enfant venu une fois sur quatre en est à sa 2e séance, mais il
                doit toujours les quatre. Le second bouton propose directement
                ce total, et le montant reste modifiable à la main. */}
            <SeanceStepper
              student={pay.student}
              subscriptionId={pay.subscriptionId}
              monthCode={pay.monthCode}
              amount={pay.amount || 0}
              onAmount={(next) => setPay({ ...pay, amount: next })}
            />

            {/* Ce que ce versement laisse derrière lui. Un élève qui donne 2000
                sur un mois à 1800 ne « perd » pas les 200 : ils restent sur le
                solde de CET emploi du temps et paieront ses séances suivantes. */}
            {(() => {
              const amount = Math.max(0, Math.round(pay.amount || 0));
              if (amount <= 0) return null;
              const balanceNow = soldFor(db, pay.student.id, pay.subscriptionId);
              const after = balanceNow + amount;
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

      {/* ---- tout le monde d'un coup : présent, ou séance annulée ----------- */}
      {bulkStatus && (
        <MarkAllModal
          status={bulkStatus}
          students={roster}
          session={session}
          date={date}
          onConfirm={(ids) => markAll(ids, bulkStatus)}
          onClose={() => setBulkStatus(null)}
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

      {/* ---- retirer un pointage, et rendre ce qu'il avait pris ------------- */}
      {removing && (
        <RemovePresenceModal
          student={removing.student}
          record={removing.record}
          subscriptionId={sub.id}
          label={title}
          busy={busyId === removing.student.id}
          onConfirm={() => removeRecord(removing.student, removing.record)}
          onClose={() => setRemoving(null)}
        />
      )}

      {/* ---- la scolarité d'un fils d'enseignant, réglée au guichet --------- */}
      {childPay && (
        <TeacherChildPayModal
          student={childPay}
          subscriptionId={sub.id}
          label={title}
          onClose={() => setChildPay(null)}
          onReceipt={setReceipt}
        />
      )}

      {/* ---- LES FRAIS D'UN ÉLÈVE, RÉGLÉS DEPUIS LA FEUILLE DU GROUPE ------
          La même liste que sur sa fiche : on coche ce que la famille paie, on
          corrige le montant, et ce qui n'est pas versé reste dû. */}
      {charges && (
        <StudentChargesModal
          student={charges.student}
          initialTab={charges.tab}
          onClose={() => setCharges(null)}
        />
      )}

      {/* ---- porter un nouveau frais, sans quitter la feuille ---------------- */}
      {chargeForm && (
        <ChargeFormModal student={chargeForm} onClose={() => setChargeForm(null)} />
      )}

      {/* ---- ajouter des élèves de passage à la séance du jour -------------- */}
      {passagerOpen && (
        <PassagerModal
          title={title}
          date={date}
          timeLabel={`${sessionTimesOn(session, JS_DAYS[new Date(`${date}T12:00:00`).getDay()]).startTime}–${
            sessionTimesOn(session, JS_DAYS[new Date(`${date}T12:00:00`).getDay()]).endTime
          }`}
          teacher={teacherName(db, session.teacherId)}
          monthLabel={monthCodeLabel(monthCode)}
          suggestedPrice={unitPrice}
          enrolledIds={fullRoster.map((st) => st.id)}
          onConfirm={addPassagers}
          onClose={() => setPassagerOpen(false)}
        />
      )}

      {/* ---- retirer un élève de passage ------------------------------------ */}
      {passagerToRemove && (
        <Modal open onClose={() => setPassagerToRemove(null)} title="Retirer cet élève de passage">
          <div className="space-y-3">
            <div className="rounded-xl bg-primary-50/60 p-3">
              <strong className="block text-sm text-ink">
                {passagerLabel(db, passagerToRemove)}
              </strong>
              <span className="text-[11px] text-muted">
                {passagerToRemove.itemLabel} · {formatDateFr(passagerToRemove.date)} ·{" "}
                {formatDA(independentTotals(passagerToRemove).price)}
              </span>
            </div>
            <p className="text-xs leading-relaxed text-ink">
              Sa séance disparaît de cette feuille, et la part qu&apos;elle rapportait à
              l&apos;enseignant s&apos;en va avec elle. Le mouvement de caisse déjà écrit,{" "}
              <strong>lui, reste</strong> : l&apos;argent a bien été encaissé — corrigez-le depuis
              la page <strong>Caisse</strong> si la séance n&apos;a jamais été payée.
            </p>
            <div className="flex justify-end gap-2 border-t border-line pt-3">
              <Button variant="outline" onClick={() => setPassagerToRemove(null)}>
                Annuler
              </Button>
              <Button
                variant="danger"
                onClick={() => removePassager(passagerToRemove)}
                className="gap-1.5"
              >
                <Trash2 className="h-4 w-4" /> Retirer
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {receipt && <PrintAsk html={receipt} onClose={() => setReceipt(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * AJOUTER À UNE SÉANCE CEUX QUI NE SONT PAS INSCRITS DESSUS.
 *
 * DEUX PERSONNES TRÈS DIFFÉRENTES passent par cet écran, et l'onglet du haut
 * dit laquelle :
 *
 *  · « PASSAGERS » — des gens sans fiche. Un nom par ligne, et **une ligne vide
 *    reste valide** : on ne retient pas toujours le nom de quelqu'un qui vient
 *    une fois, elle s'enregistre alors comme « Passager ». Six élèves d'un coup
 *    se saisissent donc en tapant « 6 », puis les noms qu'on connaît ;
 *  · « ÉLÈVE DÉJÀ INSCRIT » — quelqu'un que l'école connaît déjà, retrouvé par
 *    son nom, son numéro d'inscription ou son téléphone, qui vient suivre UNE
 *    séance de cet emploi du temps sans s'y inscrire. Sa séance se rattache à
 *    sa fiche, donc à son historique, mais elle n'ouvre AUCUN solde et ne le
 *    met sur aucune liste du mois prochain : il n'est pas inscrit pour autant.
 *
 * Le reste est commun aux deux, parce qu'il n'y a pas quatre choses à savoir
 * au comptoir : COMBIEN la séance est payée, et CE QUE L'ÉCOLE GARDE dessus.
 * Le reliquat est la part de l'enseignant — elle s'affiche pendant la saisie,
 * personne ne la calcule de tête.
 *
 * Tout est écrit à la seconde : l'argent entre en caisse, la ligne apparaît
 * sous la feuille de CETTE séance, la part de l'enseignant rejoint le mois où
 * la séance tombe, et le reçu est proposé dans la foulée.
 */
function PassagerModal({
  title,
  date,
  timeLabel,
  teacher,
  monthLabel,
  suggestedPrice,
  enrolledIds,
  onConfirm,
  onClose,
}: {
  title: string;
  date: string;
  timeLabel: string;
  teacher: string;
  monthLabel: string;
  /** le prix d'une séance de cet emploi, proposé par défaut */
  suggestedPrice: number;
  /**
   * LES ÉLÈVES DÉJÀ INSCRITS SUR CET EMPLOI DU TEMPS.
   *
   * Ils ne peuvent pas y venir « en séance libre » : ils y ont un solde, leurs
   * séances y sont déjà comptées, et les vendre une seconde fois les ferait
   * payer deux fois la même heure. La recherche les montre donc — pour qu'on
   * comprenne pourquoi ils ne sortent pas — mais elle refuse de les choisir.
   */
  enrolledIds: string[];
  onConfirm: (input: {
    names: string[];
    price: number;
    schoolShare: number;
    label: string;
    student?: Student;
  }) => void;
  onClose: () => void;
}) {
  const db = useData();
  /** « passagers sans fiche » ou « un élève que l'école connaît déjà » */
  const [mode, setMode] = useState<"passagers" | "student">("passagers");
  const [names, setNames] = useState<string[]>(["", ""]);
  const [price, setPrice] = useState(Math.round(suggestedPrice));
  const [schoolShare, setSchoolShare] = useState(Math.round(suggestedPrice));
  const [label, setLabel] = useState(title);
  const [busy, setBusy] = useState(false);

  // ---- la recherche d'un élève déjà inscrit --------------------------------
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Student | null>(null);

  /**
   * Ce que la recherche propose : TOUS les élèves de l'école, pas seulement
   * ceux de ce groupe — c'est bien quelqu'un qui n'est pas inscrit ici qu'on
   * cherche. La liste ne s'ouvre qu'une fois deux caractères tapés, sinon elle
   * afficherait mille fiches à la première frappe.
   */
  const enrolled = useMemo(() => new Set(enrolledIds), [enrolledIds]);
  const found = useMemo(() => {
    const q = query.trim();
    if (q.length < 2) return [] as Student[];
    return db.students.filter((st) => studentMatches(db, st, q)).slice(0, 30);
  }, [db, query]);

  const count = names.length;
  // Un élève nommé, c'est UNE séance : le compteur de passagers ne s'applique
  // pas à lui, et les totaux affichés doivent dire la même chose que la caisse.
  const seats = mode === "student" ? 1 : count;
  const unitSchool = money(Math.min(Math.max(0, schoolShare), Math.max(0, price)));
  const unitTeacher = money(Math.max(0, price) - unitSchool);
  const total = money(Math.max(0, price) * seats);
  const totalSchool = money(unitSchool * seats);
  const totalTeacher = money(unitTeacher * seats);

  const setCount = (n: number) => {
    const next = Math.max(1, Math.min(60, n));
    setNames((prev) =>
      next <= prev.length ? prev.slice(0, next) : [...prev, ...Array(next - prev.length).fill("")],
    );
  };

  return (
    <Modal open onClose={onClose} title="Séance libre sur ce créneau" wide>
      <div className="space-y-4">
        <div className="rounded-xl bg-primary-50/60 p-3">
          <strong className="block text-sm text-ink">{title}</strong>
          <span className="text-[11px] text-muted">
            Séance du {formatDateFr(date)} · <span className="font-mono">{timeLabel}</span> ·{" "}
            {teacher}
          </span>
          <span className="mt-1 block text-[11px] leading-relaxed text-muted">
            Personne n&apos;est{" "}
            <strong className="text-ink">inscrit sur cet emploi du temps</strong> en passant par
            ici : aucun solde n&apos;est ouvert, aucune liste du mois prochain ne change. La séance
            figure sur cette feuille et sur aucune autre, et la part de l&apos;enseignant se
            règlera avec <strong className="text-ink">{monthLabel}</strong>.
          </span>
        </div>

        {/* ---- QUI vient : des passagers sans fiche, ou un élève connu ----- */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setMode("passagers")}
            className={`rounded-xl border p-3 text-left transition-colors ${
              mode === "passagers"
                ? "border-primary bg-primary-50/60"
                : "border-line bg-canvas/30 hover:bg-primary-50/30"
            }`}
          >
            <strong className="flex items-center gap-1.5 text-[11px] text-ink">
              <Ticket className="h-3.5 w-3.5 text-primary" /> Passagers sans fiche
            </strong>
            <span className="mt-0.5 block text-[10px] leading-relaxed text-muted">
              Des gens que l&apos;école ne connaît pas. Un nom par ligne, ou rien du tout.
            </span>
          </button>
          <button
            type="button"
            onClick={() => setMode("student")}
            className={`rounded-xl border p-3 text-left transition-colors ${
              mode === "student"
                ? "border-primary bg-primary-50/60"
                : "border-line bg-canvas/30 hover:bg-primary-50/30"
            }`}
          >
            <strong className="flex items-center gap-1.5 text-[11px] text-ink">
              <GraduationCap className="h-3.5 w-3.5 text-primary" /> Élève déjà inscrit
            </strong>
            <span className="mt-0.5 block text-[10px] leading-relaxed text-muted">
              Un élève de l&apos;école qui vient suivre UNE séance de ce groupe.
            </span>
          </button>
        </div>

        {/* ---- retrouver l'élève par son nom ------------------------------- */}
        {mode === "student" && (
          <div className="space-y-2 rounded-xl border border-line bg-canvas/30 p-3">
            <span className="text-[10px] font-bold uppercase tracking-wider text-primary">
              🔎 L&apos;élève qui suit la séance
            </span>
            {picked ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-success/40 bg-success/10 p-3">
                <div className="min-w-0">
                  <strong className="block text-sm text-ink">{studentName(picked)}</strong>
                  <span className="text-[10px] text-muted">
                    N° {registrationNumberOf(db, picked)}
                    {picked.phone ? ` · ${picked.phone}` : ""} · {studentCaseLabel(picked)}
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setPicked(null);
                    setQuery("");
                  }}
                  className="gap-1.5"
                >
                  <X className="h-3.5 w-3.5" /> Changer
                </Button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                  <Input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Nom, n° d'inscription (00042) ou téléphone…"
                    className="pl-9"
                  />
                </div>
                {query.trim().length < 2 ? (
                  <p className="py-4 text-center text-[11px] italic text-muted">
                    Tapez au moins deux caractères pour chercher parmi tous les élèves de
                    l&apos;école.
                  </p>
                ) : found.length === 0 ? (
                  <p className="py-4 text-center text-[11px] italic text-muted">
                    Aucun élève ne correspond à « {query.trim()} ». S&apos;il n&apos;a pas de
                    fiche, enregistrez-le comme passager.
                  </p>
                ) : (
                  <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
                    {found.map((st) => {
                      const already = enrolled.has(st.id);
                      return (
                        <button
                          key={st.id}
                          type="button"
                          disabled={already}
                          onClick={() => setPicked(st)}
                          title={
                            already
                              ? "Il est déjà inscrit sur cet emploi du temps : sa séance y est comptée, il ne la paie pas une seconde fois."
                              : undefined
                          }
                          className={`flex w-full items-center justify-between gap-2 rounded-xl border p-2.5 text-left transition-colors ${
                            already
                              ? "cursor-not-allowed border-line bg-canvas/40 opacity-60"
                              : "border-line bg-surface hover:border-primary hover:bg-primary-50/50"
                          }`}
                        >
                          <span className="min-w-0">
                            <strong className="block truncate text-[11px] text-ink">
                              {studentName(st)}
                            </strong>
                            <span className="block text-[9px] text-muted">
                              N° {registrationNumberOf(db, st)}
                              {st.phone ? ` · ${st.phone}` : ""}
                            </span>
                          </span>
                          <Badge
                            tone={already ? "warning" : "neutral"}
                            className="shrink-0 text-[9px]"
                          >
                            {already ? "déjà dans ce groupe" : `${st.subscriptionIds.length} emploi(s)`}
                          </Badge>
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            )}
            <p className="text-[10px] leading-relaxed text-muted">
              Il paie <strong className="text-ink">cette séance-là</strong> et rien d&apos;autre :
              il n&apos;est pas inscrit sur cet emploi du temps, aucun solde ne s&apos;ouvre, et la
              séance reste rattachée à sa fiche pour son historique.
            </p>
          </div>
        )}

        {/* ---- combien, et qui ------------------------------------------- */}
        {mode === "passagers" && (
        <div className="space-y-2 rounded-xl border border-line bg-canvas/30 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-primary">
              👥 Les passagers ({count})
            </span>
            <div className="flex items-center gap-1 rounded-lg border border-line bg-surface p-1">
              <button
                type="button"
                onClick={() => setCount(count - 1)}
                disabled={count <= 1}
                className="h-6 w-6 rounded text-muted hover:bg-primary-50 hover:text-ink disabled:opacity-30"
              >
                −
              </button>
              <span className="min-w-[42px] text-center font-mono text-xs font-bold text-ink">
                {count}
              </span>
              <button
                type="button"
                onClick={() => setCount(count + 1)}
                className="h-6 w-6 rounded text-muted hover:bg-primary-50 hover:text-ink"
              >
                +
              </button>
            </div>
          </div>
          <p className="text-[10px] leading-relaxed text-muted">
            Un nom par ligne — <strong className="text-ink">laisser vide est permis</strong> : la
            ligne s&apos;enregistre alors sous « Passager ». Réglez d&apos;abord le nombre, puis
            nommez ceux que vous connaissez.
          </p>
          <div className="grid max-h-56 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
            {names.map((n, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <span className="w-5 shrink-0 text-center font-mono text-[10px] text-muted">
                  {i + 1}
                </span>
                <Input
                  value={n}
                  onChange={(e) =>
                    setNames((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))
                  }
                  placeholder={`Passager ${i + 1} — nom facultatif`}
                />
                {count > 1 && (
                  <button
                    type="button"
                    onClick={() => setNames((prev) => prev.filter((_, j) => j !== i))}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-line text-danger hover:bg-danger/10"
                    title="Retirer cette ligne"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
        )}

        {/* ---- l'argent --------------------------------------------------- */}
        <div className="space-y-3 rounded-xl border border-primary/25 bg-primary-50/40 p-3">
          <span className="text-[10px] font-bold uppercase tracking-wider text-primary">
            💰 Le prix de la séance
          </span>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-muted">
                Prix total / passager *
              </label>
              <Input
                type="number"
                min={0}
                value={price || ""}
                onChange={(e) => setPrice(Math.max(0, Number(e.target.value) || 0))}
                placeholder="Ex: 500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-muted">
                Part de l&apos;école / passager *
              </label>
              <Input
                type="number"
                min={0}
                value={schoolShare || ""}
                onChange={(e) => setSchoolShare(Math.max(0, Number(e.target.value) || 0))}
                placeholder="Ex: 200"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-muted">
                Part de l&apos;enseignant / passager
              </label>
              <div className="flex h-9 items-center rounded-xl border border-primary/40 bg-surface px-3 font-mono text-sm font-black text-primary">
                {formatDA(unitTeacher)}
              </div>
              <span className="mt-0.5 block text-[9px] text-muted">
                calculée : prix − part école
              </span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <MiniTotal label="Total encaissé" value={formatDA(total)} tone="text-success" />
            <MiniTotal label="Total école" value={formatDA(totalSchool)} tone="text-ink" />
            <MiniTotal label="Total enseignant" value={formatDA(totalTeacher)} tone="text-primary" />
          </div>

          {price > 0 && unitTeacher === 0 && (
            <p className="rounded-lg border border-warning/40 bg-warning/10 p-2 text-[11px] text-warning">
              L&apos;école garde tout : ces séances ne rapporteront rien à l&apos;enseignant.
            </p>
          )}
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-muted">
            Intitulé de la séance
          </label>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Ex: Révision — Mathématiques"
          />
        </div>

        <div className="flex justify-end gap-2 border-t border-line pt-3">
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm({
                  // Un élève nommé n'occupe qu'une place : son nom vient de sa
                  // fiche, pas des lignes de saisie des passagers.
                  names: mode === "student" ? [studentName(picked!)] : names,
                  price: Math.max(0, price),
                  schoolShare: unitSchool,
                  label: label.trim() || title,
                  student: mode === "student" ? picked ?? undefined : undefined,
                });
              } finally {
                setBusy(false);
              }
            }}
            disabled={
              busy ||
              price <= 0 ||
              (mode === "student" && (!picked || enrolled.has(picked.id)))
            }
            className="gap-1.5"
          >
            {mode === "student" ? (
              <>
                <GraduationCap className="h-4 w-4" />
                {picked ? `Inscrire ${studentName(picked)} sur la séance` : "Choisissez un élève"} —{" "}
                {formatDA(total)}
              </>
            ) : (
              <>
                <Ticket className="h-4 w-4" /> Ajouter {count} passager(s) — {formatDA(total)}
              </>
            )}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function MiniTotal({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-2 text-center">
      <span className="block text-[9px] font-bold uppercase tracking-wider text-muted">{label}</span>
      <strong className={`block font-mono text-sm ${tone}`}>{value}</strong>
    </div>
  );
}

/** « 12 / 18 » lu en pourcentage — vide quand il n'y a personne à rapporter. */
function pctOf(part: number, total: number): string {
  if (total <= 0) return "—";
  return `${Math.round((part / total) * 100)} % du groupe`;
}

const TALLY_TONE: Record<"primary" | "success" | "danger" | "warning", string> = {
  primary: "border-primary/30 bg-primary-50/50 text-primary",
  success: "border-success/30 bg-success/10 text-success",
  danger: "border-danger/30 bg-danger/10 text-danger",
  warning: "border-warning/40 bg-warning/10 text-warning",
};

/**
 * Une carte du compte de la journée.
 *
 * Elle ne détient aucun état : elle affiche ce que la feuille vient de
 * recalculer, donc elle se met à jour dans la même image que le pointage.
 */
function TallyCard({
  label,
  value,
  tone,
  icon,
  hint,
}: {
  label: string;
  value: number;
  tone: "primary" | "success" | "danger" | "warning";
  icon: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className={`rounded-2xl border p-3 transition-colors ${TALLY_TONE[tone]}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wider opacity-80">{label}</span>
        {icon}
      </div>
      <strong className="mt-0.5 block text-2xl font-black leading-none">{value}</strong>
      {hint && <span className="mt-1 block text-[10px] opacity-75">{hint}</span>}
    </div>
  );
}

/** Le raccourci « + une séance » / « Proposition » vit désormais dans
 *  `components/students/SeanceStepper`, partagé avec « Situation d'un élève ».
 *  Il se ré-exporte d'ici pour les écrans qui l'importaient de la feuille. */
export { SeanceStepper };

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
 * Le raccourci du matin, dans ses deux sens :
 *
 *  - « Tout présent » — la liste s'ouvre cochée sur ceux qui n'ont pas encore
 *    de pointage, et les élèves déjà pointés sont laissés tels quels ;
 *  - « Séance annulée pour tous » — la séance n'a pas eu lieu : TOUT LE MONDE
 *    est coché, y compris ceux déjà pointés, parce qu'une présence notée sur une
 *    séance qui n'a pas eu lieu doit être reprise. Rien n'est consommé, aucun
 *    solde n'est débité, aucune part enseignant n'est due, et le mois du groupe
 *    n'avance pas.
 */
function MarkAllModal({
  status,
  students,
  session,
  date,
  onConfirm,
  onClose,
}: {
  status: "present" | "cancelled";
  students: Student[];
  session: ScheduleSession;
  date: string;
  onConfirm: (ids: string[]) => Promise<void> | void;
  onClose: () => void;
}) {
  const db = useData();
  const cancelling = status === "cancelled";
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string[]>(() =>
    students
      .filter((st) => cancelling || !attendanceOn(db, st.id, session.id, date))
      .map((st) => st.id),
  );
  const [busy, setBusy] = useState(false);

  const shown = students.filter((st) => studentMatches(db, st, query));
  const toggle = (id: string) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <Modal
      open
      onClose={onClose}
      title={cancelling ? "Annuler la séance pour tout le groupe" : "Marquer tout le groupe présent"}
    >
      <div className="space-y-3">
        <div
          className={`rounded-xl p-3 text-[11px] text-muted ${cancelling ? "bg-primary-50/60" : "bg-success/10"}`}
        >
          {cancelling ? (
            <>
              La séance du {formatDateFr(date)} sera marquée{" "}
              <strong className="text-primary">annulée</strong> pour tous les élèves cochés :
              aucune séance consommée, aucun solde débité, aucune part enseignant due, et le mois du
              groupe n&apos;avance pas. Un pointage déjà saisi ce jour-là est{" "}
              <strong className="text-ink">repris</strong> et le solde rendu.
            </>
          ) : (
            <>
              Tous les élèves cochés seront pointés <strong className="text-success">présents</strong>{" "}
              le {formatDateFr(date)}. Ceux qui portent déjà un pointage ce jour-là ne sont pas
              réécrits — corrigez-les depuis leur ligne.
            </>
          )}
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
              variant={cancelling ? "primary" : "success"}
              disabled={busy || picked.length === 0}
              onClick={async () => {
                setBusy(true);
                await onConfirm(picked);
                setBusy(false);
              }}
              className="gap-1.5"
            >
              {cancelling ? <Slash className="h-4 w-4" /> : <CheckCheck className="h-4 w-4" />}
              {busy
                ? "Enregistrement…"
                : cancelling
                  ? `Annuler pour ${picked.length} élève(s)`
                  : `Marquer ${picked.length} présent(s)`}
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
  /**
   * LE JOUR DE L'ENCAISSEMENT. La réception règle parfois pour la veille — le
   * versement, son reçu et la caisse portent alors cette date-là, et non celle
   * de la saisie. Absent = aujourd'hui.
   */
  date?: string;
}

/** "Imprimer le reçu ?" — vit désormais dans `components/ui/PrintAsk`, et se
 *  ré-exporte d'ici : les écrans qui l'importaient de la feuille de présence
 *  n'ont rien à changer, et la feuille ne dépend plus d'eux. */
export { PrintAsk };

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
  onRemove,
  onChildPay,
  onCharges,
  onNewCharge,
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
  /** absent = ce compte n'encaisse pas : le bouton ne s'affiche pas */
  onPay?: (t: PayTarget) => void;
  onDrill: (kind: "previous" | "other" | "all") => void;
  onLeave: () => void;
  onHistory: () => void;
  /** retirer CE pointage-là — même s'il date d'un autre jour du mois */
  onRemove: (record: AttendanceRecord) => void;
  /** régler la scolarité d'un fils d'enseignant, au guichet */
  onChildPay: () => void;
  /** ouvrir ses frais — la liste, ou directement l'encaissement */
  onCharges: (tab: "list" | "pay") => void;
  /** lui porter un nouveau frais sans quitter la feuille */
  onNewCharge: () => void;
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
  /** ses frais : livres, tenues, sorties — et ce que l'école lui a avancé */
  const chargeDebt = studentChargeDebt(db, student.id);
  const advanceDebt = studentAdvanceDebt(db, student.id);

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
      <td className="px-2 py-2 text-muted">
        {student.phone || "—"}
        {/* Le second numéro : celui qu'on compose quand le premier ne répond
            pas. Il se lit sur la feuille, sans ouvrir la fiche. */}
        {student.phone2 && (
          <span className="block text-[10px] opacity-80">2<sup>e</sup> : {student.phone2}</span>
        )}
      </td>

      {Array.from({ length: slotCount }, (_, i) => {
        // Before his arrival the séance simply is not his: the box stays empty
        // instead of reading like a pointage still to do.
        const before = i < lead;
        const rec: AttendanceRecord | undefined = before ? undefined : slots[i - lead];
        // Une case DÉJÀ POINTÉE se clique : c'est là qu'on retire une présence
        // ou une absence saisie par erreur, fût-elle d'un autre jour du mois,
        // et qu'on récupère ce qu'elle avait pris sur le solde.
        const cls = `inline-flex h-6 w-6 items-center justify-center rounded-lg border text-[11px] font-black ${
          before
            ? "border-dashed border-line bg-canvas/40 text-muted/40"
            : rec
              ? `${STATUS_STYLE[rec.status].cls} cursor-pointer hover:ring-2 hover:ring-danger/40`
              : "border-line bg-canvas text-muted/50"
        }`;
        const label = before ? "" : rec ? STATUS_STYLE[rec.status].short : "–";
        return (
          <td key={i} className="px-1 py-2 text-center">
            {rec ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => onRemove(rec)}
                title={`${STATUS_STYLE[rec.status].label} — ${formatDateFr(
                  dayKeyOf(rec.timestamp),
                )} · cliquer pour retirer ce pointage et rendre ${formatDA(
                  rec.status === "cancelled" || rec.noCharge ? 0 : rec.amountDeducted || 0,
                )} au solde`}
                className={`${cls} disabled:cursor-not-allowed disabled:opacity-40`}
              >
                {label}
              </button>
            ) : (
              <span
                title={
                  before
                    ? `Séance tenue avant son inscription (inscrit à la séance ${lead + 1})`
                    : "Pas encore pointé"
                }
                className={cls}
              >
                {label}
              </span>
            )}
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
          {onPay && (
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
          )}
          <button
            onClick={onHistory}
            title="Historique des paiements — modifier ou supprimer"
            className="flex h-6 w-6 items-center justify-center rounded-lg border border-line text-muted transition-colors hover:bg-primary-50 hover:text-ink"
          >
            <History className="h-3.5 w-3.5" />
          </button>
          {/* Fils d'enseignant : il n'a pas à attendre la paie de son père. */}
          {student.studentCase === "teacher_child" && (
            <button
              onClick={onChildPay}
              title="Fils d'enseignant — régler sa scolarité ici : par sa famille, ou portée sur le salaire de son père"
              className="flex h-6 items-center gap-1 rounded-lg border border-primary/40 bg-primary-50/60 px-1.5 text-[9px] font-bold text-primary transition-colors hover:bg-primary hover:text-white"
            >
              <GraduationCap className="h-3 w-3" /> Fils d&apos;ens.
            </button>
          )}
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

      {/* FRAIS & AVANCES — ce qu'il doit hors scolarité : un livre, une tenue,
          une sortie, ou la dette que l'école a réglée de sa caisse pour
          débloquer la part de l'enseignant. Un clic l'encaisse, en totalité ou
          en partie, à la date choisie. */}
      <td className="px-2 py-2">
        <div className="flex flex-wrap items-center gap-1">
          {chargeDebt > 0 ? (
            <button
              onClick={() => onCharges("pay")}
              title={
                advanceDebt > 0
                  ? `${formatDA(chargeDebt)} de frais, dont ${formatDA(
                      advanceDebt,
                    )} avancés par l'école — cliquer pour encaisser`
                  : `${formatDA(chargeDebt)} de frais — cliquer pour encaisser`
              }
              className="flex items-center gap-1 rounded-lg border border-danger/40 bg-danger/10 px-2 py-1 text-[10px] font-bold text-danger hover:bg-danger hover:text-white"
            >
              {advanceDebt > 0 ? (
                <Landmark className="h-3 w-3" />
              ) : (
                <AlertTriangle className="h-3 w-3" />
              )}
              {formatDA(chargeDebt)}
            </button>
          ) : (
            <button
              onClick={() => onCharges("list")}
              title="Aucun frais dû — voir son historique de frais"
              className="text-sm"
            >
              ✅
            </button>
          )}
          <button
            onClick={onNewCharge}
            title="Porter un nouveau frais à cet élève (livre, tenue, sortie…)"
            className="flex h-6 w-6 items-center justify-center rounded-lg border border-line text-muted transition-colors hover:bg-primary-50 hover:text-ink"
          >
            <Receipt className="h-3.5 w-3.5" />
          </button>
        </div>
        {advanceDebt > 0 && (
          <span className="mt-0.5 block text-[9px] font-semibold text-warning">
            dont {formatDA(advanceDebt)} avancés par l&apos;école
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
            title={
              today
                ? `Retirer ${
                    today.status === "absent" ? "l'absence" : "la présence"
                  } du jour et rendre ${formatDA(
                    today.status === "cancelled" || today.noCharge ? 0 : today.amountDeducted || 0,
                  )} au solde`
                : "Rien à retirer ce jour-là"
            }
            onClick={() => onWrite(student, null)}
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </MarkButton>
        </div>
        {/* Ce que « Retour » va faire, écrit en clair : la réception n'a pas à
            deviner si le clic rendra de l'argent ou non. */}
        {today && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onRemove(today)}
            className="mt-1 block w-full text-center text-[9px] font-bold text-danger hover:underline disabled:opacity-40"
          >
            Retirer {today.status === "absent" ? "l'absence" : STATUS_STYLE[today.status].label.toLowerCase()}
            {today.status !== "cancelled" && !today.noCharge && today.amountDeducted > 0
              ? ` · +${formatDA(today.amountDeducted)}`
              : ""}
          </button>
        )}
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

/**
 * RETIRER UN POINTAGE — présence, retard ou absence — et RENDRE ce qu'il avait
 * pris sur le solde de cet emploi du temps.
 *
 * L'écran dit exactement ce qui va se passer avant de le faire, parce que c'est
 * de l'argent : quelle séance part, de quel jour, et combien revient sur le
 * solde. Une séance annulée ou une première absence n'ayant rien coûté, la
 * fenêtre le dit aussi plutôt que d'annoncer un remboursement de 0 DA.
 */
function RemovePresenceModal({
  student,
  record,
  subscriptionId,
  label,
  busy,
  onConfirm,
  onClose,
}: {
  student: Student;
  record: AttendanceRecord;
  subscriptionId: string;
  label: string;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const db = useData();
  const day = dayKeyOf(record.timestamp);
  const style = STATUS_STYLE[record.status];
  const refund =
    record.status === "cancelled" || record.noCharge ? 0 : Math.max(0, record.amountDeducted || 0);
  const balance = soldFor(db, student.id, subscriptionId);

  return (
    <Modal open onClose={onClose} title={`Retirer ce pointage — ${style.label.toLowerCase()}`}>
      <div className="space-y-3">
        <div className="rounded-xl bg-primary-50/60 p-3">
          <strong className="block text-sm text-ink">{studentName(student)}</strong>
          <span className="text-[11px] text-muted">
            N° {registrationNumberOf(db, student)} · {label}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-3">
          <Badge tone="neutral" className="gap-1">
            <Clock className="h-3 w-3" /> {formatDateFr(day)}
          </Badge>
          <span
            className={`inline-flex h-6 items-center justify-center rounded-lg border px-2 text-[11px] font-black ${style.cls}`}
          >
            {style.label}
          </span>
        </div>

        <p className="text-xs leading-relaxed text-ink">
          Cette séance sera <strong>effacée de sa ligne</strong> : elle cesse d&apos;être
          consommée, et la part qu&apos;elle devait à l&apos;enseignant s&apos;en va avec elle tant
          qu&apos;elle n&apos;a pas été réglée.
        </p>

        {refund > 0 ? (
          <p className="rounded-xl border border-success/40 bg-success/10 p-2.5 text-[11px] font-semibold text-success">
            {formatDA(refund)} seront <strong>rendus</strong> au solde de cet emploi du temps — il
            passera de {formatDA(balance)} à {formatDA(balance + refund)}.
          </p>
        ) : (
          <p className="rounded-xl border border-line bg-canvas/50 p-2.5 text-[11px] text-muted">
            Cette séance n&apos;avait rien débité (séance annulée, offerte, ou première absence sur
            cet emploi) : il n&apos;y a donc rien à rendre.
          </p>
        )}

        <div className="flex justify-end gap-2 border-t border-line pt-3">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={busy} className="gap-1.5">
            <RotateCcw className="h-4 w-4" />
            {busy ? "Retrait…" : refund > 0 ? `Retirer et rendre ${formatDA(refund)}` : "Retirer"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * LA SCOLARITÉ D'UN FILS D'ENSEIGNANT, RÉGLÉE DEPUIS LA FEUILLE DU GROUPE.
 *
 * Rien n'oblige un fils d'enseignant à attendre la paie de son père, et rien
 * n'oblige la réception à ouvrir un écran de règlement pour le mettre en règle.
 * Elle choisit ici, en deux clics, D'OÙ vient l'argent :
 *
 *  - « la famille paie maintenant » — un versement d'élève ordinaire : il entre
 *    en caisse, et le salaire du père n'est PAS amputé. L'écran de paie de
 *    l'enseignant l'affiche « payé par la famille » ;
 *  - « à porter sur le salaire du père » — l'enfant est soldé tout de suite,
 *    donc la part que ses séances rapportent se débloque, et le montant part en
 *    attente sur la fiche du père. Son prochain règlement le retient sur son
 *    net, une fois et une seule.
 *
 * Dans les deux cas le mois cesse d'être en dette : c'est la seule chose qui
 * bloquait la paie de l'enseignant.
 */
function TeacherChildPayModal({
  student,
  subscriptionId,
  label,
  onClose,
  onReceipt,
}: {
  student: Student;
  subscriptionId: string;
  label: string;
  onClose: () => void;
  onReceipt: (html: string) => void;
}) {
  const db = useData();
  const { payTeacherChild } = db;
  const { language } = useSettings();
  const { addToast } = useToast();

  const sub = db.subscriptions.find((x) => x.id === subscriptionId);
  const father: Teacher | undefined = db.teachers.find((t) => t.id === student.teacherFatherId);

  /**
   * L'EMPLOI DU TEMPS TEL QUE LE PÈRE LE LIRA SUR SA PAIE.
   *
   * `label` est l'intitulé court de la feuille de présence — celui du reçu de
   * la famille. L'écran de paie de l'enseignant, lui, nomme un emploi du temps
   * en entier (classe · module · salle · enseignant), et c'est CE nom-là qui
   * sera figé sur la retenue. Le guichet doit donc voir le même, sans quoi il
   * promet un intitulé que l'enseignant ne retrouvera pas.
   */
  const payslipEmploi = sub ? subscriptionLabel(db, sub) : label;

  /** Ses mois EN DETTE sur cet emploi du temps — ce qu'il y a à régler. */
  const owing = enrollmentCycles(db, student.id, subscriptionId).filter((c) => c.balance < 0);
  const current = currentCycleCode(db, student.id, subscriptionId);
  const monthPrice = sub ? studentMonthPrice(student, sub) : 0;

  const [monthCode, setMonthCode] = useState(owing[0]?.code ?? current);
  const [amount, setAmount] = useState(owing[0] ? -owing[0].balance : monthPrice);
  const [busy, setBusy] = useState(false);

  const dueOf = (code: string) =>
    Math.max(0, -cycleOf(db, student.id, subscriptionId, code).balance);
  const due = dueOf(monthCode);

  const pick = (code: string) => {
    setMonthCode(code);
    setAmount(dueOf(code) || monthPrice);
  };

  const submit = async (source: "cash" | "teacher_debt") => {
    const value = Math.max(0, Math.round(amount || 0));
    if (value <= 0) {
      addToast({ type: "danger", title: "Montant invalide", message: "Saisissez un montant." });
      return;
    }
    if (source === "teacher_debt" && !father) {
      addToast({
        type: "danger",
        title: "Aucun enseignant père",
        message: "Désignez l'enseignant père sur sa fiche avant de porter la somme sur un salaire.",
        studentName: studentName(student),
      });
      return;
    }
    setBusy(true);
    const res = await payTeacherChild({
      studentId: student.id,
      subscriptionId,
      monthCode,
      amount: value,
      source,
    });
    setBusy(false);
    if (!res.ok) {
      addToast({
        type: "danger",
        title: "Règlement impossible",
        message: "La scolarité n'a pas pu être enregistrée.",
        studentName: studentName(student),
      });
      return;
    }
    addToast({
      type: "success",
      title: source === "cash" ? "Encaissé auprès de la famille" : "Porté sur le salaire du père",
      message:
        source === "cash"
          ? `${formatDA(value)} sur ${label} · ${monthCode} — l'argent entre en caisse, rien n'est retenu sur le salaire de son père.`
          : `${formatDA(value)} sur ${monthCode} — retenus sur le prochain règlement de ${
              father ? `${father.firstName} ${father.lastName}` : "son père"
            }, et pas une fois de plus. Sa paie nommera « ${payslipEmploi} · ${monthCode} ».`,
      studentName: studentName(student),
    });
    // Le reçu ne s'imprime que quand de l'argent a vraiment changé de main.
    if (source === "cash") {
      onReceipt(
        soldReceiptHtml(db, {
          student,
          language,
          title: "Reçu de paiement",
          lines: [{ label, monthCode, amount: value, balanceAfter: res.balance ?? 0 }],
          note: "Versé par la famille, avant la paie de son père.",
        }),
      );
    }
    onClose();
  };

  return (
    <Modal open onClose={onClose} title="Fils d'enseignant — régler sa scolarité" wide>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-primary-50/60 p-3">
          <div className="min-w-0">
            <strong className="block text-sm text-ink">{studentName(student)}</strong>
            <span className="text-[11px] text-muted">
              N° {registrationNumberOf(db, student)}
              {father ? ` · père : ${father.firstName} ${father.lastName}` : ""}
            </span>
            {/* L'EMPLOI DU TEMPS QUE CE RÈGLEMENT PAIE, nommé sur sa propre
                ligne. C'est lui que le père retrouvera sur sa fiche de paie :
                le guichet doit voir exactement ce que l'enseignant lira. */}
            <span className="mt-1 flex flex-wrap items-center gap-1">
              <Badge
                tone="primary"
                className="gap-1 text-[9px]"
                title="L'emploi du temps réglé — c'est ce nom que son père lira sur sa fiche de paie"
              >
                <GraduationCap className="h-3 w-3" /> {payslipEmploi}
              </Badge>
              <Badge tone="neutral" className="font-mono text-[9px]">
                {monthCode}
              </Badge>
            </span>
          </div>
          <Badge
            tone={soldFor(db, student.id, subscriptionId) < 0 ? "danger" : "success"}
            className="font-mono"
          >
            solde {formatDA(soldFor(db, student.id, subscriptionId))}
          </Badge>
        </div>

        {!father && (
          <p className="rounded-xl border border-warning/40 bg-warning/10 p-2.5 text-[11px] font-semibold text-warning">
            Aucun enseignant père n&apos;est désigné sur sa fiche : seul l&apos;encaissement auprès
            de la famille est possible tant qu&apos;il n&apos;y en a pas.
          </p>
        )}

        {/* Ses mois en dette sur CET emploi du temps */}
        <div className="space-y-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted">
            Mois à régler
          </span>
          <div className="flex flex-wrap gap-1.5">
            {(owing.length > 0 ? owing.map((c) => c.code) : [current]).map((code) => {
              const picked = code === monthCode;
              const owed = dueOf(code);
              return (
                <button
                  key={code}
                  type="button"
                  onClick={() => pick(code)}
                  className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-bold transition-colors ${
                    picked
                      ? "border-primary bg-primary text-white"
                      : owed > 0
                        ? "border-danger/40 bg-danger/10 text-danger hover:bg-danger/20"
                        : "border-line bg-surface text-muted hover:bg-primary-50"
                  }`}
                >
                  {monthCodeLabel(code)}
                  <span className="ml-1.5 font-mono">{owed > 0 ? formatDA(owed) : "réglé"}</span>
                </button>
              );
            })}
          </div>
          {owing.length === 0 && (
            <p className="text-[10px] italic text-muted">
              Aucun mois en dette sur cet emploi du temps — un versement d&apos;avance reste
              possible sur {monthCodeLabel(current)}.
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted">
              Montant (DA)
            </label>
            <Input
              type="number"
              min={0}
              autoFocus
              value={amount || ""}
              onChange={(e) => setAmount(Math.max(0, Number(e.target.value) || 0))}
              placeholder="Ex: 2000"
            />
          </div>
          <div className="flex items-end">
            {due > 0 && (
              <button
                type="button"
                onClick={() => setAmount(due)}
                className="pb-2.5 text-[11px] font-bold text-primary hover:underline"
              >
                Régler la totalité de {monthCode} ({formatDA(due)})
              </button>
            )}
          </div>
        </div>

        {/* LES DEUX CHEMINS, côte à côte, avec ce que chacun fait au salaire */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col justify-between gap-2 rounded-xl border border-success/40 bg-success/5 p-3">
            <div>
              <strong className="flex items-center gap-1.5 text-xs text-success">
                <HandCoins className="h-4 w-4" /> La famille paie maintenant
              </strong>
              <p className="mt-1 text-[10px] leading-relaxed text-muted">
                Un versement d&apos;élève ordinaire : l&apos;argent <strong>entre en caisse</strong>{" "}
                et le salaire de son père n&apos;est <strong>pas amputé</strong>. Sa paie affichera
                le mois « payé par la famille », pour que personne ne le retienne une seconde fois.
              </p>
            </div>
            <Button
              variant="success"
              size="sm"
              disabled={busy}
              onClick={() => submit("cash")}
              className="gap-1.5"
            >
              <Wallet className="h-3.5 w-3.5" /> Encaisser {formatDA(Math.max(0, amount || 0))}
            </Button>
          </div>

          <div className="flex flex-col justify-between gap-2 rounded-xl border border-warning/40 bg-warning/5 p-3">
            <div>
              <strong className="flex items-center gap-1.5 text-xs text-warning">
                <Banknote className="h-4 w-4" /> À porter sur le salaire du père
              </strong>
              <p className="mt-1 text-[10px] leading-relaxed text-muted">
                L&apos;enfant est soldé <strong>tout de suite</strong> — la part que ses séances
                rapportent à l&apos;enseignant se débloque — et le montant part{" "}
                <strong>en attente sur la fiche de son père</strong> : aucun mouvement de caisse
                aujourd&apos;hui, et son prochain règlement le retient sur son net, une seule fois.
                Sa paie nommera <strong>« {payslipEmploi} · {monthCode} »</strong> : il saura pour
                quel cours de son fils on le retient.
              </p>
            </div>
            <Button
              size="sm"
              disabled={busy || !father}
              onClick={() => submit("teacher_debt")}
              className="gap-1.5"
            >
              <GraduationCap className="h-3.5 w-3.5" /> Porter {formatDA(Math.max(0, amount || 0))}{" "}
              en dette
            </Button>
          </div>
        </div>

        <div className="flex justify-end border-t border-line pt-3">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Fermer
          </Button>
        </div>
      </div>
    </Modal>
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
  kind: "previous" | "other" | "all";
  subscriptionId: string;
  monthIndex: number;
  onClose: () => void;
  /** absent = ce compte n'encaisse pas : le bouton ne s'affiche pas */
  onPay?: (t: PayTarget) => void;
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
          // « all » ne cache rien : le mois du groupe ouvert compte comme les
          // autres, sinon l'alerte annoncerait une somme qu'on ne pourrait pas
          // solder depuis l'écran qu'elle ouvre.
          .filter((r) => kind === "all" || r.subscriptionId !== subscriptionId)
          .map((r) => ({ ...r, done: 0, size: 0 }));

  // Les restes d'anciens paiements et les frais d'inscription ne relèvent
  // d'aucun mois : ils se rappellent à part, sous la liste.
  const summary = studentDebtSummary(db, student.id);
  const loose = kind === "all" ? summary.rests + summary.registrationDue : 0;

  return (
    <Modal
      open
      onClose={onClose}
      title={
        kind === "previous"
          ? "Dettes des mois précédents"
          : kind === "all"
            ? "Toute la scolarité qu'il doit"
            : "Dettes sur les autres emplois du temps"
      }
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
                  {onPay && (
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
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {loose > 0 && (
          <p className="rounded-xl border border-warning/40 bg-warning/10 p-2.5 text-[11px] text-warning">
            S&apos;ajoutent <strong>{formatDA(loose)}</strong> qui ne relèvent d&apos;aucun mois :
            {summary.rests > 0 ? ` ${formatDA(summary.rests)} de restes d'anciens paiements` : ""}
            {summary.rests > 0 && summary.registrationDue > 0 ? " et" : ""}
            {summary.registrationDue > 0
              ? ` ${formatDA(summary.registrationDue)} de frais d'inscription`
              : ""}
            . Ils se règlent depuis la fiche de l&apos;élève.
          </p>
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
