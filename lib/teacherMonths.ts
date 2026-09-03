/**
 * La paie de l'enseignant, MOIS PAR MOIS et EMPLOI DU TEMPS PAR EMPLOI DU TEMPS.
 *
 * Les mois de l'école ne sont pas des mois du calendrier : chaque emploi du
 * temps compte les siens (voir `enrollmentCycles`). M1 s'ouvre à la PREMIÈRE
 * présence et se ferme sur la séance qui complète le pack (`monthlySeances`) ;
 * la présence suivante ouvre M2.
 *
 * L'enseignant est réglé sur exactement la même horloge : la part qu'une
 * présence lui rapporte appartient au mois où cette présence tombe. Un mois
 * n'est donc « à régler » qu'une fois SES séances tenues — le mois en cours,
 * lui, reste ouvert (3 séances sur 4) et n'est jamais proposé par défaut.
 *
 * ET LA PART D'UNE SÉANCE SE DÉBLOQUE AVEC CETTE SÉANCE-LÀ. L'argent qu'un
 * élève verse sur un mois paie ses séances dans l'ordre où elles ont été
 * tenues, le trop-versé passant au mois suivant comme le promet la feuille de
 * présence. Tant qu'une séance n'est pas couverte, la part qu'elle rapporte est
 * retenue ; dès qu'elle l'est, elle se règle — peu importe que l'élève doive
 * encore sur un AUTRE groupe ou des frais d'inscription : ces dettes-là ne
 * doivent rien à cet enseignant-ci, et les lui faire porter revenait à ne
 * jamais le payer pour un élève pourtant à jour chez lui.
 *
 * Ce module ne lit que le store : il ne décide rien, il rend lisible ce que les
 * présences, les soldes et les règlements ont déjà écrit.
 */

import type { Database } from "@/lib/store/data";
import type {
  AttendanceRecord,
  IndependentSession,
  ScheduleSession,
  Student,
  StudentCase,
  Subscription,
} from "@/lib/types";
import {
  consumesSeance,
  currentCycleCode,
  cycleCredits,

  cycleSizeOf,
  dayKeyOf,
  enrollmentCycles,
  enrollmentStart,
  formatDays,
  isFreeSub,
  isSchoolOnlySub,
  independentTotals,
  monthlyPriceOf,
  passagerLabel,
  netPriceFor,
  registrationNumberOf,
  salleName,
  seanceChargeOf,
  sessionGroupsLabel,
  sessionTitleOf,
  sessionTimeLabel,
  studentCaseLabel,
  studentDebtSummary,
  studentHasDebt,
  studentListPrice,
  studentName,
  studentSubscriptionHistory,
  subscriptionLabel,
  studentSchoolPerSeance,
  studentTeacherPerSeance,
  teacherPerSeanceOf,
} from "@/lib/helpers";
import { formatDA, money } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TeacherAlert {
  tone: "danger" | "warning" | "success" | "primary";
  text: string;
}

/** Une part due à l'enseignant sur UNE présence. */
export interface TeacherDue {
  id: string;
  studentId: string;
  studentName: string;
  registrationNumber: string;
  dateKey: string;
  /** ce que l'élève a payé pour cette séance (0 quand elle lui est offerte) */
  fee: number;
  /** ce que la séance rapporte à l'enseignant */
  amount: number;
  paid: boolean;
  monthCode: string;
  /**
   * LA SÉANCE QUI A PRODUIT CETTE PART N'EST PAS PAYÉE : elle reste en attente.
   *
   * Ce n'est pas « l'élève doit quelque chose quelque part » : c'est ce mois-ci,
   * sur cet emploi du temps, cette séance-là. Un élève à jour sur son mois
   * débloque la part de son enseignant même s'il doit encore sur un autre
   * groupe ou des frais d'inscription.
   */
  withheld: boolean;
}

/**
 * UN PASSAGER — une séance libre vendue à quelqu'un qui n'est pas inscrit.
 *
 * Il n'a ni fiche, ni solde, ni mois : il paie la séance sur place. Ce que
 * l'école garde est écrit noir sur blanc, et le reste appartient à
 * l'enseignant — c'est cette part-là que le mois où la séance tombe lui règle.
 */
export interface TeacherPassager {
  id: string;
  name: string;
  dateKey: string;
  /** ce que le passager a versé */
  price: number;
  /** ce que l'école garde dessus */
  schoolShare: number;
  /** price − schoolShare : ce que l'enseignant touche */
  teacherShare: number;
  /** la part de l'école n'a jamais été saisie (séance d'avant le découpage) */
  unsplit: boolean;
  startTime?: string;
  endTime?: string;
  label?: string;
  monthCode: string;
}

export type MonthPayState = "paid" | "partial" | "unpaid" | "pending" | "free";

/** Un élève, sur UN mois d'UN emploi du temps. */
export interface TeacherMonthStudent {
  studentId: string;
  name: string;
  registrationNumber: string;
  phone: string;
  caseLabel: string;
  /** CET emploi du temps lui est offert (la gratuité se coche module par
   *  module : il peut très bien payer les autres) */
  isFree: boolean;
  /** séances du mois déjà consommées */
  done: number;
  size: number;
  complete: boolean;
  presents: number;
  absents: number;
  cancelled: number;
  /** son cas de facturation, tel qu'il est stocké sur sa fiche */
  caseKind: StudentCase;
  /** l'enseignant est son père et sa scolarité sort de ce salaire */
  isTeacherChild: boolean;
  /** prix d'une séance pour lui, remise comprise */
  unitPrice: number;
  /** prix plein d'une séance de cet emploi, AVANT son cas et sa remise */
  listPrice: number;
  /** ce que l'école garde sur une de ses séances (cas appliqué) */
  schoolPerSeance: number;
  /** ce que l'enseignant gagne sur une de ses séances (cas appliqué) */
  teacherPerSeance: number;
  /** ce que le mois complet lui coûte */
  expected: number;
  /** ce que ses séances ont déjà mangé sur son solde */
  consumed: number;
  /** ce qu'il a versé sur ce mois */
  credited: number;
  balance: number;
  /** ce qu'il doit sur CE mois */
  debt: number;
  /** arriérés des mois PRÉCÉDENTS de cet emploi du temps */
  previousDebt: number;
  /** ce qu'il doit sur CET emploi du temps, tous ses mois confondus : le
   *  montant exact que l'école a à avancer pour débloquer la part retenue */
  emploiDebt: number;
  /** ce qu'il doit sur ses AUTRES emplois du temps */
  otherDebt: number;
  /** TOUT ce qu'il doit, restes et frais d'inscription compris : le montant
   *  exact que l'école doit avancer pour débloquer la part de l'enseignant */
  totalDebt: number;
  status: MonthPayState;
  /** part enseignant générée par cet élève sur ce mois */
  gross: number;
  settled: number;
  open: number;
  withheld: number;
  /** il doit encore quelque chose QUELQUE PART (autres emplois et frais
   *  d'inscription compris) — ce qui ne retient plus la paie, mais reste bon à
   *  savoir au guichet */
  hasDebt: boolean;
}

export type MonthState = "done" | "running" | "upcoming";

/** Un mois (M1, M2 …) d'UN emploi du temps, vu depuis la paie. */
export interface TeacherMonth {
  key: string; // "sessionId|M2"
  sessionId: string;
  code: string;
  index: number;
  size: number;
  /** séances effectivement tenues sur ce mois (dates distinctes) */
  held: number;
  dates: string[];
  startDate?: string;
  endDate?: string;
  state: MonthState;
  isCurrent: boolean;
  students: TeacherMonthStudent[];
  studentsPaid: number;
  studentsUnpaid: number;
  studentsPending: number;
  /** ce que les élèves doivent encore sur ce mois */
  studentsDebt: number;
  /** ce que le mois complet doit rapporter à l'école */
  expected: number;
  /** ce qu'il a rapporté */
  collected: number;
  dues: TeacherDue[];
  passagers: TeacherPassager[];
  /** part enseignant générée par le mois (réglée ou non) */
  gross: number;
  settled: number;
  /** encore dû à l'enseignant */
  open: number;
  /** retenu tant que l'élève n'a pas payé */
  withheld: number;
  /** ce qui peut être réglé maintenant (open − withheld) */
  payable: number;
  /**
   * CE MOIS A DÉJÀ ÉTÉ RÉGLÉ à l'enseignant (`settled > 0`).
   *
   * Ce qu'il doit encore n'est alors pas « le mois » : ce sont des ARRIÉRÉS,
   * des parts retenues à l'époque parce que l'élève n'avait pas payé et
   * libérées depuis. L'écran de paie les sort du tableau du mois et leur donne
   * leur propre table, pour que chaque mois reste indépendant.
   */
  alreadySettled: boolean;
  /** ce que les arriérés de ce mois représentent (0 si le mois n'est pas réglé) */
  arrearPayable: number;
  payableDueIds: string[];
  withheldDueIds: string[];
  openPassagerIds: string[];
  /** ce que les séances libres du mois ont encaissé */
  passagerRevenue: number;
  /** ce que ces mêmes séances doivent ENCORE à l'enseignant */
  passagerPayable: number;
  alerts: TeacherAlert[];
}

/** Un emploi du temps de l'enseignant, avec toute son histoire de mois. */
export interface TeacherEmploi {
  sessionId: string;
  subscriptionId?: string;
  title: string;
  className: string;
  groupName: string;
  salleName: string;
  daysLabel: string;
  timeLabel: string;
  isOpen: boolean;
  /** l'emploi du temps a été SUPPRIMÉ : il ne tient plus séance, mais ce qu'il
   *  doit encore à l'enseignant reste dû et se règle ici comme avant */
  archived: boolean;
  size: number;
  unitPrice: number;
  /** tarif enseignant d'une séance, quand l'abonnement le porte */
  perSeance: number;
  monthPrice: number;
  /** l'abonnement porte bien une part enseignant */
  priced: boolean;
  rosterCount: number;
  currentIndex: number;
  currentCode: string;
  /** séances déjà tenues sur le mois en cours */
  currentHeld: number;
  months: TeacherMonth[];
  gross: number;
  settled: number;
  open: number;
  withheld: number;
  payable: number;
  studentsInDebt: number;
  alerts: TeacherAlert[];
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

const byDate = (a: AttendanceRecord, b: AttendanceRecord) => a.timestamp.localeCompare(b.timestamp);

/**
 * Le mois de CHAQUE ligne de présence d'un emploi du temps.
 *
 * Les lignes qui ne coûtent rien (séance annulée, première absence de
 * courtoisie) n'avancent pas le compteur : elles sont simplement rattachées au
 * mois en cours, exactement comme la feuille de présence les affiche.
 *
 * `offset` est le point d'entrée de l'élève : inscrit en M2 sur la 3e séance,
 * ses présences sont comptées à partir de là — sa première séance appartient à
 * M2, pas à M1.
 */
function recordMonths(
  records: AttendanceRecord[],
  size: number,
  offset = 0,
): Map<string, number> {
  const out = new Map<string, number>();
  let billable = offset;
  for (const rec of records) {
    out.set(rec.id, Math.floor(billable / Math.max(1, size)));
    if (consumesSeance(rec)) billable += 1;
  }
  return out;
}

/**
 * Les élèves inscrits sur l'emploi, plus ceux qui y ont été pointés.
 *
 * Un élève « école seule » SUR CET EMPLOI DU TEMPS n'y figure pas : l'école est
 * payée pour lui, l'enseignant ne l'est délibérément pas, donc l'afficher sur
 * une feuille de paie qui ne lui rapportera jamais rien ne ferait qu'inviter
 * une erreur de calcul.
 *
 * L'option se coche emploi par emploi : le MÊME élève reste donc listé, et
 * compté, sur les emplois où elle n'est pas activée — l'enseignant y touche sa
 * part comme pour n'importe qui d'autre.
 */
function rosterOf(
  db: Database,
  session: ScheduleSession,
  teacherId: string,
  sub?: Subscription,
): Student[] {
  const ids = new Set<string>();
  if (sub) {
    for (const st of db.students) if (st.subscriptionIds.includes(sub.id)) ids.add(st.id);
  }
  for (const a of db.attendance) if (a.sessionId === session.id) ids.add(a.studentId);
  return db.students
    .filter((st) => ids.has(st.id))
    .filter((st) => !isSchoolOnlySub(st, sub?.id, teacherId))
    .sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`));
}

function emptyMonthStudent(
  db: Database,
  student: Student,
  size: number,
  unitPrice: number,
  rates: { listPrice: number; schoolPerSeance: number; teacherPerSeance: number },
  /** CET emploi du temps lui est-il offert ? */
  free: boolean,
): TeacherMonthStudent {
  return {
    studentId: student.id,
    name: studentName(student),
    registrationNumber: registrationNumberOf(db, student),
    phone: student.phone,
    caseLabel: studentCaseLabel(student),
    caseKind: student.studentCase ?? "normal",
    isTeacherChild: student.studentCase === "teacher_child",
    isFree: free,
    done: 0,
    size,
    complete: false,
    presents: 0,
    absents: 0,
    cancelled: 0,
    unitPrice,
    listPrice: rates.listPrice,
    schoolPerSeance: rates.schoolPerSeance,
    teacherPerSeance: rates.teacherPerSeance,
    expected: size * unitPrice,
    consumed: 0,
    credited: 0,
    balance: 0,
    debt: 0,
    previousDebt: 0,
    emploiDebt: 0,
    otherDebt: 0,
    totalDebt: 0,
    status: free ? "free" : "pending",
    gross: 0,
    settled: 0,
    open: 0,
    withheld: 0,
    hasDebt: false,
  };
}

/**
 * Tout ce qu'un enseignant a enseigné, emploi du temps par emploi du temps et
 * mois par mois — avec, pour chaque mois, l'état de paiement de chaque élève et
 * la part qui reste due à l'enseignant.
 *
 * Les emplois SUPPRIMÉS y figurent toujours, marqués comme tels : un cours qui
 * s'arrête n'efface pas ce qu'il devait encore à celui qui l'a donné. C'est
 * précisément parce qu'une suppression archive au lieu d'effacer que ces mois-là
 * restent réglables, avec le nom du module et du groupe sous les yeux.
 */
export function teacherEmplois(db: Database, teacherId: string): TeacherEmploi[] {
  return db.sessions
    .filter((s) => s.teacherId === teacherId)
    .map((session) => buildEmploi(db, teacherId, session))
    .sort((a, b) => b.payable - a.payable || a.title.localeCompare(b.title));
}

function buildEmploi(db: Database, teacherId: string, session: ScheduleSession): TeacherEmploi {
  const sub = db.subscriptions.find((s) => s.sessionId === session.id);
  const size = cycleSizeOf(sub);
  const perSeance = teacherPerSeanceOf(sub);
  const listPrice = sub?.pricePerSession ?? session.openPrice ?? 0;
  const roster = rosterOf(db, session, teacherId, sub);

  // ---- le mois de chaque présence, élève par élève -------------------------
  const recordsByStudent = new Map<string, AttendanceRecord[]>();
  for (const a of db.attendance) {
    if (a.sessionId !== session.id) continue;
    const list = recordsByStudent.get(a.studentId);
    if (list) list.push(a);
    else recordsByStudent.set(a.studentId, [a]);
  }
  const monthOfRecord = new Map<string, number>();
  const currentIndexOf = new Map<string, number>();
  // Où chaque élève est ENTRÉ sur l'emploi : celui qui a été inscrit en cours
  // de mois ne commence pas à la séance 1 du M1.
  const startOf = new Map<string, number>();
  for (const st of roster) {
    startOf.set(st.id, sub ? enrollmentStart(db, st.id, sub.id).offset : 0);
  }
  for (const [studentId, rows] of recordsByStudent) {
    rows.sort(byDate);
    const offset = startOf.get(studentId) ?? (sub ? enrollmentStart(db, studentId, sub.id).offset : 0);
    for (const [id, idx] of recordMonths(rows, size, offset)) monthOfRecord.set(id, idx);
    currentIndexOf.set(
      studentId,
      Math.floor((offset + rows.filter(consumesSeance).length) / size),
    );
  }
  // Un élève inscrit et pas encore pointé vit déjà le mois de son entrée.
  for (const st of roster) {
    if (!currentIndexOf.has(st.id)) {
      currentIndexOf.set(st.id, Math.floor((startOf.get(st.id) ?? 0) / size));
    }
  }

  // ---- les mois de chaque élève, avec l'argent porté sur chacun ------------
  const cyclesOf = new Map<string, ReturnType<typeof enrollmentCycles>>();
  const startIndexOf = new Map<string, number>();
  for (const st of roster) {
    cyclesOf.set(st.id, sub ? enrollmentCycles(db, st.id, sub.id) : []);
    startIndexOf.set(st.id, Math.floor((startOf.get(st.id) ?? 0) / size));
  }

  /**
   * LES SÉANCES QUE L'ÉLÈVE A DÉJÀ PAYÉES — c'est ce qui débloque la paie.
   *
   * Une part n'est plus retenue parce que l'élève « doit quelque chose, quelque
   * part » : elle l'est séance par séance, et seulement quand LA SÉANCE QUI L'A
   * PRODUITE n'est pas couverte sur CE mois de CET emploi du temps. Un élève à
   * jour sur son mois débloque donc la part de son enseignant, même s'il traîne
   * une dette sur un autre groupe ou des frais d'inscription : cette dette-là ne
   * doit rien à cet enseignant-ci.
   *
   * L'argent versé sur un mois couvre ses séances DANS L'ORDRE où elles ont été
   * tenues — payer deux séances sur quatre libère les deux premières, et laisse
   * les deux suivantes en attente.
   */
  const paidRecords = new Set<string>();
  /** `studentId|index` des mois entièrement couverts — pour les parts dont la
   *  ligne de présence a disparu (une part reste due, la ligne non). */
  const paidMonths = new Set<string>();
  for (const st of roster) {
    const cycles = cyclesOf.get(st.id) ?? [];
    const byMonth = new Map<number, AttendanceRecord[]>();
    let lastMonth = 0;
    for (const rec of (recordsByStudent.get(st.id) ?? []).filter(consumesSeance)) {
      const idx = monthOfRecord.get(rec.id) ?? 0;
      lastMonth = Math.max(lastMonth, idx);
      const list = byMonth.get(idx);
      if (list) list.push(rec);
      else byMonth.set(idx, [rec]);
    }

    // La bourse de l'élève sur CET emploi du temps : elle se remplit du mois
    // qu'on crédite et se vide des séances qu'il tient. Ce qui reste passe au
    // mois suivant — c'est exactement ce que la feuille de présence promet
    // quand elle dit que le trop-versé « paiera ses prochaines séances ».
    let purse = 0;
    // Dès qu'une séance n'est plus couverte, celles d'après ne le sont pas non
    // plus : l'argent paie les séances dans l'ordre où elles ont été tenues.
    let short = false;
    for (let idx = 0; idx <= Math.max(lastMonth, cycles.length - 1, 0); idx++) {
      purse = money(purse + (cycles[idx]?.credited ?? 0));
      for (const rec of byMonth.get(idx) ?? []) {
        // Ce que la séance coûte VRAIMENT à l'élève — une séance suivie mais
        // enregistrée sans prix est reprise au tarif du jour, exactement comme
        // la feuille de présence l'affiche. Sans cela, une séance à 0 DA se
        // serait « payée » toute seule et aurait débloqué une part que l'élève
        // doit pourtant encore.
        const cost = seanceChargeOf(db, rec, st, sub);
        // Une tolérance d'un centime : la part d'un mois divisé en trois ne
        // tombe pas juste, et un solde à 0,004 près est un solde réglé.
        if (!short && cost <= purse + 0.01) {
          purse = money(purse - cost);
          paidRecords.add(rec.id);
        } else short = true;
      }
      if (!short) paidMonths.add(`${st.id}|${idx}`);
    }
  }

  /** La part de cette séance est-elle retenue ? */
  const isWithheld = (studentId: string, rec: AttendanceRecord | undefined, idx: number) => {
    // Un élève supprimé ne retient plus rien : il n'y a plus de dette à réclamer.
    if (!db.students.some((s) => s.id === studentId)) return false;
    return rec ? !paidRecords.has(rec.id) : !paidMonths.has(`${studentId}|${idx}`);
  };

  // ---- ce que l'enseignant a gagné, présence par présence ------------------
  const recordOn = (studentId: string, day: string) =>
    recordsByStudent.get(studentId)?.find((a) => dayKeyOf(a.timestamp) === day);

  const duesByMonth = new Map<number, TeacherDue[]>();
  const rosterIds = new Set(roster.map((st) => st.id));
  for (const u of db.unpaidTeacher) {
    if (u.teacherId !== teacherId || u.sessionId !== session.id) continue;
    // Un élève « école seule » SUR CET EMPLOI n'a rien à faire ici : il est
    // délibérément hors de la paie de cet enseignant, et une ligne à 0 DA le
    // remettrait sur sa fiche de paie sans rien lui rapporter. Les lignes déjà
    // écrites en base sont donc écartées comme les futures.
    if (!rosterIds.has(u.studentId) && db.students.some((st) => st.id === u.studentId)) continue;
    const day = dayKeyOf(u.date);
    const rec = recordOn(u.studentId, day);
    const idx =
      (rec ? monthOfRecord.get(rec.id) : undefined) ?? currentIndexOf.get(u.studentId) ?? 0;
    const student = db.students.find((s) => s.id === u.studentId);
    const due: TeacherDue = {
      id: u.id,
      studentId: u.studentId,
      studentName: student ? studentName(student) : "Élève supprimé",
      registrationNumber: student ? registrationNumberOf(db, student) : "—",
      dateKey: day,
      fee: rec ? rec.amountDeducted || rec.waivedAmount || 0 : 0,
      amount: u.amount,
      paid: !!u.paid,
      monthCode: `M${idx + 1}`,
      withheld: !u.paid && isWithheld(u.studentId, rec, idx),
    };
    const list = duesByMonth.get(idx);
    if (list) list.push(due);
    else duesByMonth.set(idx, [due]);
  }

  // ---- combien de mois faut-il rendre ? ------------------------------------
  let maxIndex = 0;
  for (const st of roster) {
    const cycles = cyclesOf.get(st.id) ?? [];
    maxIndex = Math.max(maxIndex, cycles.length - 1, currentIndexOf.get(st.id) ?? 0);
  }
  for (const idx of duesByMonth.keys()) maxIndex = Math.max(maxIndex, idx);
  for (const idx of monthOfRecord.values()) maxIndex = Math.max(maxIndex, idx);

  // Le mois du GROUPE : celui que la majorité des élèves est en train de vivre.
  const tally = new Map<number, number>();
  for (const st of roster) {
    const i = currentIndexOf.get(st.id) ?? 0;
    tally.set(i, (tally.get(i) ?? 0) + 1);
  }
  let currentIndex = 0;
  let best = -1;
  for (const [i, n] of tally) {
    if (n > best || (n === best && i < currentIndex)) {
      currentIndex = i;
      best = n;
    }
  }

  // ---- les dates tenues, mois par mois -------------------------------------
  const datesByMonth = new Map<number, Set<string>>();
  for (const rows of recordsByStudent.values()) {
    for (const rec of rows) {
      const idx = monthOfRecord.get(rec.id) ?? 0;
      const set = datesByMonth.get(idx) ?? new Set<string>();
      set.add(dayKeyOf(rec.timestamp));
      datesByMonth.set(idx, set);
    }
  }

  const months: TeacherMonth[] = [];
  for (let i = 0; i <= maxIndex; i++) {
    months.push(
      buildMonth(db, {
        session,
        sub,
        size,
        listPrice,
        roster,
        cyclesOf,
        currentIndexOf,
        startIndexOf,
        monthOfRecord,
        recordsByStudent,
        dues: duesByMonth.get(i) ?? [],
        dates: [...(datesByMonth.get(i) ?? [])].sort(),
        index: i,
        currentIndex,
      }),
    );
  }

  // ---- les passagers, rattachés au mois dont ils occupent la fenêtre -------
  attachPassagers(db, session, months, currentIndex);

  const gross = months.reduce((s, m) => s + m.gross, 0);
  const settled = months.reduce((s, m) => s + m.settled, 0);
  const open = months.reduce((s, m) => s + m.open, 0);
  const withheld = months.reduce((s, m) => s + m.withheld, 0);
  const payable = months.reduce((s, m) => s + m.payable, 0);
  const studentsInDebt = new Set(
    months.flatMap((m) => m.students.filter((st) => st.debt > 0).map((st) => st.studentId)),
  ).size;

  const alerts: TeacherAlert[] = [];
  const teacher = db.teachers.find((t) => t.id === teacherId);
  if (perSeance <= 0 && teacher?.paymentType === "per_group") {
    alerts.push({
      tone: "warning",
      text: "Aucune part enseignant sur cet abonnement — les séances de ce groupe ne rapportent rien.",
    });
  }
  const closedUnpaid = months.filter((m) => m.state === "done" && m.payable > 0);
  if (closedUnpaid.length > 0) {
    alerts.push({
      tone: "danger",
      text: `${closedUnpaid.length} mois clos non réglé(s) : ${closedUnpaid.map((m) => m.code).join(", ")}.`,
    });
  }
  if (withheld > 0) {
    alerts.push({
      tone: "warning",
      text: `${formatDA(withheld)} en attente — des élèves n'ont pas payé, la part revient au règlement suivant.`,
    });
  }

  return {
    sessionId: session.id,
    subscriptionId: sub?.id,
    title: sessionTitleOf(db, session),
    className: db.classes.find((c) => c.id === session.classId)?.name ?? "—",
    // Un emploi du temps peut réunir PLUSIEURS groupes : la paie les nomme tous.
    groupName: sessionGroupsLabel(db, session),
    salleName: salleName(db, session.salleId),
    daysLabel: formatDays(session.days) || "—",
    timeLabel: sessionTimeLabel(session),
    isOpen: !!session.isOpen,
    archived: !!session.archivedAt,
    size,
    unitPrice: listPrice,
    perSeance,
    monthPrice: monthlyPriceOf(sub),
    priced: perSeance > 0,
    rosterCount: roster.length,
    currentIndex,
    currentCode: `M${currentIndex + 1}`,
    currentHeld: months[currentIndex]?.held ?? 0,
    months,
    gross,
    settled,
    open,
    withheld,
    payable,
    studentsInDebt,
    alerts,
  };
}

interface MonthInput {
  session: ScheduleSession;
  sub?: Subscription;
  size: number;
  listPrice: number;
  roster: Student[];
  cyclesOf: Map<string, ReturnType<typeof enrollmentCycles>>;
  currentIndexOf: Map<string, number>;
  /** le mois d'ENTRÉE de chaque élève sur l'emploi (0 = M1) */
  startIndexOf: Map<string, number>;
  monthOfRecord: Map<string, number>;
  recordsByStudent: Map<string, AttendanceRecord[]>;
  dues: TeacherDue[];
  dates: string[];
  index: number;
  currentIndex: number;
}

/**
 * Un règlement existe-t-il déjà pour ce mois de cet emploi du temps ?
 *
 * C'est la même question que `settledMonthCodes` (l'écran de paie) pose pour
 * savoir si une pastille affiche « Réglé » — posée ici pour que `alreadySettled`
 * réponde pareil, au lieu de ne regarder que les parts individuellement payées.
 */
function monthHasSettlement(
  db: Database,
  teacherId: string | undefined,
  sessionId: string,
  code: string,
): boolean {
  if (!teacherId) return false;
  return db.teacherPayments.some((p) => {
    if (p.teacherId !== teacherId) return false;
    if ((p.months ?? []).some((m) => m.sessionId === sessionId && m.monthCode === code)) return true;
    return !!p.board && p.board.sessionId === sessionId && p.board.monthCode === code;
  });
}

function buildMonth(db: Database, input: MonthInput): TeacherMonth {
  const { session, sub, size, listPrice, roster, index, currentIndex, dues, dates } = input;
  const code = `M${index + 1}`;

  const duesByStudent = new Map<string, TeacherDue[]>();
  for (const d of dues) {
    const list = duesByStudent.get(d.studentId);
    if (list) list.push(d);
    else duesByStudent.set(d.studentId, [d]);
  }

  const students: TeacherMonthStudent[] = [];
  for (const st of roster) {
    const cycles = input.cyclesOf.get(st.id) ?? [];
    const cursor = input.currentIndexOf.get(st.id) ?? 0;
    // L'élève n'est listé que s'il a atteint ce mois : celui qui n'y est pas
    // encore n'a rien à y payer, et l'afficher « impayé » serait faux.
    if (index > cursor && !cycles[index]) continue;
    // Ni s'il est arrivé APRÈS : les séances de ce mois-là ne sont pas les
    // siennes, l'enseignant n'a rien gagné sur lui.
    if (index < (input.startIndexOf.get(st.id) ?? 0)) continue;

    const enrollment = sub
      ? db.enrollments.find((e) => e.studentId === st.id && e.subscriptionId === sub.id)
      : undefined;
    const discount = enrollment?.discount ?? (sub ? st.subscriptionDiscounts?.[sub.id] : undefined);
    // Son tarif à LUI : un « école seule » ne paie que la part de l'école, donc
    // son mois ne coûte pas le prix affiché de l'emploi du temps.
    const own = studentListPrice(st, sub, listPrice);
    const row = emptyMonthStudent(
      db,
      st,
      size,
      netPriceFor(own, discount),
      {
        listPrice,
        schoolPerSeance: studentSchoolPerSeance(st, sub),
        teacherPerSeance: studentTeacherPerSeance(st, sub, session.teacherId),
      },
      isFreeSub(st, sub?.id),
    );

    const cycle = cycles[index];
    if (cycle) {
      row.done = cycle.done;
      row.complete = cycle.complete;
      row.consumed = cycle.consumed;
      row.credited = cycle.credited;
      row.balance = cycle.balance;
      row.debt = Math.max(0, -cycle.balance);
    }

    for (const rec of input.recordsByStudent.get(st.id) ?? []) {
      if ((input.monthOfRecord.get(rec.id) ?? 0) !== index) continue;
      if (rec.status === "cancelled") row.cancelled += 1;
      else if (rec.status === "absent") row.absents += 1;
      else row.presents += 1;
    }

    row.previousDebt = cycles.slice(0, index).reduce((s, c) => s + Math.max(0, -c.balance), 0);
    const summary = studentDebtSummary(db, st.id);
    row.otherDebt = summary.soldRows
      .filter((r) => r.subscriptionId !== sub?.id)
      .reduce((s, r) => s + r.debt, 0);
    // Ce que l'école a à avancer pour débloquer la part retenue : ce qu'il doit
    // SUR CET EMPLOI DU TEMPS, tous ses mois confondus. Ni ses autres groupes
    // ni ses frais d'inscription ne retiennent cet enseignant-ci, donc les
    // couvrir ne débloquerait rien qu'il n'ait déjà.
    row.emploiDebt = money(
      summary.soldRows
        .filter((r) => r.subscriptionId === sub?.id)
        .reduce((s, r) => s + r.debt, 0),
    );
    // Ce qu'il doit en tout, restes et frais d'inscription compris : la fiche
    // du guichet le lit, la paie de l'enseignant non.
    row.totalDebt = summary.total;
    row.hasDebt = studentHasDebt(db, st.id);

    for (const d of duesByStudent.get(st.id) ?? []) {
      row.gross += d.amount;
      if (d.paid) row.settled += d.amount;
      else {
        row.open += d.amount;
        if (d.withheld) row.withheld += d.amount;
      }
    }

    row.status = row.isFree
      ? "free"
      : row.debt > 0
        ? row.credited > 0
          ? "partial"
          : "unpaid"
        : row.credited > 0 || row.consumed > 0
          ? "paid"
          : "pending";

    students.push(row);
  }

  const started = students.filter((s) => s.done > 0);
  // Le mois est CLOS quand son pack de séances a été tenu. Tout le groupe l'a
  // terminé, ou bien l'emploi a bien donné ses `size` séances et au moins un
  // élève est allé au bout : un élève inscrit en retard ne fige pas la paie —
  // les séances qu'il lui reste rouvriront simplement le mois.
  const allDone = started.length > 0 && started.every((s) => s.complete);
  const packHeld = dates.length >= size && started.some((s) => s.complete);
  const state: MonthState =
    allDone || packHeld
      ? "done"
      : started.length > 0 || index <= currentIndex
        ? "running"
        : "upcoming";

  const settled = dues.filter((d) => d.paid).reduce((s, d) => s + d.amount, 0);
  const openDues = dues.filter((d) => !d.paid);
  const open = openDues.reduce((s, d) => s + d.amount, 0);
  const withheld = openDues.filter((d) => d.withheld).reduce((s, d) => s + d.amount, 0);

  // Un mois est « déjà réglé » soit parce qu'au moins une part de sa table 1 a
  // été cochée et payée (le cas courant), soit parce qu'un règlement existe
  // déjà pour lui SANS avoir payé aucune part — un mois où le seul élève
  // devait tout retenir, et où le règlement n'a soldé qu'une retenue, un
  // arriéré d'un autre mois, ou une séance libre. Sans ce second signal, un
  // tel mois reste « pas encore réglé » pour toujours à ses propres yeux, alors
  // que sa pastille affiche « Réglé » : la part qui s'y débloque ensuite ne
  // devient jamais un arriéré, elle disparaît.
  const alreadySettled = settled > 0 || monthHasSettlement(db, session.teacherId, session.id, code);
  const month: TeacherMonth = {
    key: `${session.id}|${code}`,
    sessionId: session.id,
    code,
    index,
    size,
    held: dates.length,
    dates,
    startDate: dates[0],
    endDate: state === "done" ? dates[dates.length - 1] : undefined,
    state,
    isCurrent: index === currentIndex,
    students,
    studentsPaid: students.filter((s) => s.status === "paid" || s.status === "free").length,
    studentsUnpaid: students.filter((s) => s.status === "unpaid" || s.status === "partial").length,
    studentsPending: students.filter((s) => s.status === "pending").length,
    studentsDebt: students.reduce((s, st) => s + st.debt, 0),
    expected: students.filter((s) => !s.isFree).reduce((s, st) => s + st.expected, 0),
    collected: students.reduce((s, st) => s + st.credited, 0),
    dues,
    passagers: [],
    gross: dues.reduce((s, d) => s + d.amount, 0),
    settled,
    open,
    withheld,
    payable: open - withheld,
    alreadySettled,
    arrearPayable: alreadySettled ? open - withheld : 0,
    payableDueIds: openDues.filter((d) => !d.withheld).map((d) => d.id),
    withheldDueIds: openDues.filter((d) => d.withheld).map((d) => d.id),
    openPassagerIds: [],
    passagerRevenue: 0,
    passagerPayable: 0,
    alerts: [],
  };

  month.alerts = monthAlerts(month);
  return month;
}

/** Ce qu'il faut dire du mois, dans l'ordre de gravité. */
function monthAlerts(m: TeacherMonth): TeacherAlert[] {
  const out: TeacherAlert[] = [];
  const unpaid = m.students.filter((s) => s.status === "unpaid" || s.status === "partial");
  if (unpaid.length > 0) {
    out.push({
      tone: "danger",
      text: `${unpaid.length} élève(s) n'ont pas réglé ce mois — ${formatDA(m.studentsDebt)} reportés sur le mois suivant.`,
    });
  }
  if (m.withheld > 0) {
    out.push({
      tone: "warning",
      text: `${formatDA(m.withheld)} de part enseignant retenus : réglés dès que ces élèves auront payé.`,
    });
  }
  if (m.state === "done" && m.payable > 0) {
    out.push({ tone: "primary", text: `Mois clos : ${formatDA(m.payable)} à régler à l'enseignant.` });
  }
  if (m.state === "running" && m.held > 0) {
    out.push({
      tone: "warning",
      text: `Mois en cours — séance ${Math.min(m.held, m.size)} sur ${m.size}. Réglez d'abord le mois clos.`,
    });
  }
  if (m.state === "done" && m.open === 0 && m.gross > 0) {
    out.push({ tone: "success", text: "Mois entièrement réglé à l'enseignant." });
  }
  return out;
}

/** Les passagers d'une séance libre tombent dans le mois dont ils occupent la
 *  fenêtre de dates ; à défaut, dans le mois en cours. Un élève DÉJÀ INSCRIT
 *  venu suivre une séance libre de ce créneau compte comme les autres : sa
 *  séance a été payée, elle doit donc rapporter à l'enseignant. */
function attachPassagers(
  db: Database,
  session: ScheduleSession,
  months: TeacherMonth[],
  currentIndex: number,
): void {
  const rows: IndependentSession[] = db.independent.filter(
    (i) => i.sessionId === session.id && !i.teacherPaid,
  );
  for (const ind of rows) {
    const idx = months.findIndex(
      (m) => m.dates.length > 0 && ind.date >= m.dates[0] && ind.date <= m.dates[m.dates.length - 1],
    );
    const target = months[idx >= 0 ? idx : Math.min(currentIndex, months.length - 1)];
    if (!target) continue;
    const split = independentTotals(ind);
    target.passagers.push({
      id: ind.id,
      name: passagerLabel(db, ind),
      dateKey: ind.date,
      price: split.price,
      schoolShare: split.school,
      teacherShare: split.teacher,
      unsplit: split.unsplit,
      startTime: ind.startTime,
      endTime: ind.endTime,
      label: ind.itemLabel,
      monthCode: target.code,
    });
    target.openPassagerIds.push(ind.id);
    target.passagerRevenue = money(target.passagerRevenue + split.price);
    target.passagerPayable = money(target.passagerPayable + split.teacher);
    // Une séance libre se règle avec le mois où elle tombe : ce qu'elle doit
    // encore à l'enseignant grossit donc ce que ce mois-là peut lui verser.
    target.payable = money(target.payable + split.teacher);
  }
}

// ---------------------------------------------------------------------------
// Ce que l'écran de règlement propose
// ---------------------------------------------------------------------------

/**
 * Les mois que l'écran de paie coche tout seul : les mois CLOS qui doivent
 * encore quelque chose. Le mois en cours (3 séances sur 4) n'en fait jamais
 * partie — on règle le mois qui vient de se terminer, pas celui qui court.
 */
export function defaultPayableMonthKeys(emplois: TeacherEmploi[]): string[] {
  return emplois.flatMap((e) =>
    e.months
      // Un mois DÉJÀ réglé n'est jamais recoché : ce qu'il doit encore n'est
      // plus « le mois », ce sont des arriérés, et ils ont leur propre table.
      .filter((m) => m.state === "done" && m.payable > 0 && !m.alreadySettled)
      .map((m) => m.key),
  );
}

/** Les mois qui doivent encore quelque chose — ce que l'écran de paie liste. */
export function payableMonths(emplois: TeacherEmploi[]): TeacherMonth[] {
  return emplois.flatMap((e) => e.months.filter((m) => m.open > 0 || m.passagers.length > 0));
}

/** Total réglable maintenant, tous emplois du temps confondus. */
export function teacherPayableTotalOf(emplois: TeacherEmploi[]): number {
  return emplois.reduce((s, e) => s + e.payable, 0);
}

/** Un élève en retard de paiement, sur un mois d'un emploi du temps. */
export interface UnpaidStudentRow {
  studentId: string;
  name: string;
  registrationNumber: string;
  phone: string;
  sessionId: string;
  emploi: string;
  monthCode: string;
  monthState: MonthState;
  done: number;
  size: number;
  debt: number;
  credited: number;
  expected: number;
  /** part enseignant bloquée par cette dette */
  withheld: number;
}

/** Tous les impayés de l'enseignant, mois par mois — le détail que l'écran
 *  « Mois & emplois du temps » affiche et que la paie met en alerte. */
export function unpaidStudents(emplois: TeacherEmploi[]): UnpaidStudentRow[] {
  const out: UnpaidStudentRow[] = [];
  for (const e of emplois) {
    for (const m of e.months) {
      for (const st of m.students) {
        if (st.debt <= 0) continue;
        out.push({
          studentId: st.studentId,
          name: st.name,
          registrationNumber: st.registrationNumber,
          phone: st.phone,
          sessionId: e.sessionId,
          emploi: e.title,
          monthCode: m.code,
          monthState: m.state,
          done: st.done,
          size: st.size,
          debt: st.debt,
          credited: st.credited,
          expected: st.expected,
          withheld: st.withheld,
        });
      }
    }
  }
  return out.sort((a, b) => b.debt - a.debt || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// LES ARRIÉRÉS DÉBLOQUÉS — les élèves qui ont payé EN RETARD
// ---------------------------------------------------------------------------

/**
 * Un élève qui a payé APRÈS que l'enseignant a été réglé pour son mois.
 *
 * C'est le cas que la réception vit tous les mois : au moment de régler le M1,
 * trois élèves n'avaient rien versé, leur part a donc été RETENUE et
 * l'enseignant a touché le M1 sans elle. Ces élèves s'acquittent ensuite, et
 * quand vient le tour du M2, cette part de M1 est de nouveau due.
 *
 * Elle n'a rien à faire dans le tableau du M2 : elle appartient au M1 et se
 * lit avec son mois d'origine. L'écran de paie lui donne donc SA PROPRE TABLE,
 * et la fiche de paie une section à part.
 */
export interface UnlockedArrearRow {
  key: string;
  studentId: string;
  name: string;
  registrationNumber: string;
  phone: string;
  caseLabel: string;
  sessionId: string;
  emploi: string;
  groupName: string;
  monthCode: string;
  monthIndex: number;
  /** les séances de ce mois qui n'ont jamais été payées à l'enseignant */
  seances: number;
  /** les jours concernés, du plus ancien au plus récent */
  dates: string[];
  /** ce que l'élève a versé sur ce mois (ce qui a débloqué la part) */
  credited: number;
  /** ce que ces séances rapportent à l'enseignant */
  amount: number;
  dueIds: string[];
}

/**
 * Tous les arriérés débloqués d'un enseignant : les parts encore dues sur des
 * mois DÉJÀ réglés, une ligne par élève et par mois.
 */
export function unlockedArrears(emplois: TeacherEmploi[]): UnlockedArrearRow[] {
  const out: UnlockedArrearRow[] = [];
  for (const e of emplois) {
    for (const m of e.months) {
      if (!m.alreadySettled) continue;
      const byStudent = new Map<string, UnlockedArrearRow>();
      for (const d of m.dues) {
        if (d.paid || d.withheld) continue;
        const student = m.students.find((st) => st.studentId === d.studentId);
        const row =
          byStudent.get(d.studentId) ??
          ({
            key: `${e.sessionId}|${m.code}|${d.studentId}`,
            studentId: d.studentId,
            name: d.studentName,
            registrationNumber: d.registrationNumber,
            phone: student?.phone ?? "",
            caseLabel: student?.caseLabel ?? "",
            sessionId: e.sessionId,
            emploi: e.title,
            groupName: e.groupName,
            monthCode: m.code,
            monthIndex: m.index,
            seances: 0,
            dates: [],
            credited: student?.credited ?? 0,
            amount: 0,
            dueIds: [],
          } satisfies UnlockedArrearRow);
        row.seances += 1;
        row.amount += d.amount;
        row.dueIds.push(d.id);
        if (!row.dates.includes(d.dateKey)) row.dates.push(d.dateKey);
        byStudent.set(d.studentId, row);
      }
      for (const row of byStudent.values()) {
        row.dates.sort();
        out.push(row);
      }
    }
  }
  return out.sort(
    (a, b) =>
      a.emploi.localeCompare(b.emploi) ||
      a.monthIndex - b.monthIndex ||
      a.name.localeCompare(b.name),
  );
}

/** Ce que les arriérés débloqués totalisent. */
export function unlockedArrearsTotal(rows: UnlockedArrearRow[]): number {
  return rows.reduce((s, r) => s + r.amount, 0);
}

// ---------------------------------------------------------------------------
// Les arriérés d'un élève SUR UN EMPLOI — ce que le règlement précédent a laissé
// ---------------------------------------------------------------------------

/** Ce que les mois PRÉCÉDENTS doivent encore à l'enseignant pour un élève. */
export interface StudentArrears {
  /** débloqué : l'élève a payé depuis, la part est due maintenant */
  payable: number;
  /** encore retenu : il doit toujours de l'argent */
  withheld: number;
  /** les mois concernés, dans l'ordre ("M1", "M2" …) */
  months: string[];
  /** les identifiants des parts débloquées, à joindre au règlement */
  dueIds: string[];
}

const NO_ARREARS: StudentArrears = { payable: 0, withheld: 0, months: [], dueIds: [] };

/**
 * Les parts que les mois d'AVANT `index` doivent encore à l'enseignant pour cet
 * élève.
 *
 * C'est le cas que la réception vit tous les mois : l'élève n'avait pas payé
 * son M2, l'enseignant a donc été réglé du M2 sans sa part à lui ; l'élève
 * s'acquitte ensuite, et au moment de régler le M3 cette part de M2 doit
 * réapparaître. Elle est ici, `payable`, avec le mois qui l'a générée.
 */
export function studentArrearsBefore(
  emploi: TeacherEmploi,
  studentId: string,
  index: number,
): StudentArrears {
  if (index <= 0) return NO_ARREARS;
  const out: StudentArrears = { payable: 0, withheld: 0, months: [], dueIds: [] };
  for (const m of emploi.months) {
    if (m.index >= index) continue;
    let touched = false;
    for (const d of m.dues) {
      if (d.studentId !== studentId || d.paid) continue;
      touched = true;
      if (d.withheld) out.withheld += d.amount;
      else {
        out.payable += d.amount;
        out.dueIds.push(d.id);
      }
    }
    if (touched) out.months.push(m.code);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Les enfants de l'enseignant, scolarisés sur son salaire
// ---------------------------------------------------------------------------

/**
 * L'ÉTAT d'un mois d'un enfant d'enseignant :
 *  - `due`      : rien n'a été versé, le montant sort du salaire du père ;
 *  - `family`   : LA FAMILLE A PAYÉ ELLE-MÊME, avant que le père ne soit réglé —
 *                 il n'y a plus rien à retenir sur son salaire ;
 *  - `charged`  : le mois a été SOLDÉ D'AVANCE au guichet et porté sur le
 *                 salaire du père : l'enfant est en règle, la part que ses
 *                 séances rapportent est débloquée, et la retenue attend en bas
 *                 de cette paie (elle n'est donc pas retenue deux fois) ;
 *  - `salary`   : déjà retenu sur un règlement précédent ;
 *  - `school`   : l'école a avancé la dette de sa caisse ;
 *  - `pending`  : le mois n'a rien consommé encore.
 */
export type ChildLineState = "due" | "family" | "charged" | "salary" | "school" | "pending";

/** Un mois d'un emploi du temps d'un enfant d'enseignant. */
export interface TeacherChildLine {
  subscriptionId: string;
  label: string;
  monthCode: string;
  /** séances qu'il a suivies sur ce mois */
  seances: number;
  /** prix d'une de ses séances */
  unitPrice: number;
  /** ce que le mois lui coûte (ce que ses séances ont mangé) */
  expected: number;
  /** ce que la FAMILLE a versé d'elle-même sur ce mois */
  paidByFamily: number;
  /** ce qui a été crédité d'avance et PORTÉ sur le salaire du père : la retenue
   *  est en attente, elle sera prise sur son prochain règlement */
  chargedToFather: number;
  /** ce qu'un règlement du père a déjà retenu */
  paidFromSalary: number;
  /** ce que la caisse de l'école a avancé */
  paidBySchool: number;
  /** ce qui reste à retenir sur le salaire (0 dès que le mois est soldé) */
  amount: number;
  state: ChildLineState;
  /** ce mois-ci, par opposition à un arriéré */
  current: boolean;
}

/** Un enfant de l'enseignant : ce qu'il a étudié, et ce qui sort du salaire. */
export interface TeacherChildRow {
  studentId: string;
  studentName: string;
  registrationNumber: string;
  caseLabel: string;
  /** tous ses mois, réglés ou non — l'écran les montre avec leur statut */
  lines: TeacherChildLine[];
  /** ceux qui doivent encore quelque chose : la seule retenue possible */
  dueLines: TeacherChildLine[];
  /** ce que le mois EN COURS de chaque emploi lui coûte encore */
  currentAmount: number;
  /** ce que les mois d'avant ont laissé impayé */
  previousAmount: number;
  /** séances suivies sur les mois en cours */
  currentSeances: number;
  /** total retenu sur le salaire du père */
  amount: number;
  /** ce que la famille a déjà versé elle-même, AVANT le règlement du père */
  paidByFamily: number;
  /** ce qui a été soldé d'avance au guichet et porté sur le salaire du père —
   *  la retenue est en attente, listée à part sur la paie */
  chargedToFather: number;
  /** ce que des règlements précédents ont déjà retenu */
  paidFromSalary: number;
  /** l'enfant a payé d'avance : il ne reste rien à retenir sur ce salaire */
  settledBeforePay: boolean;
}

/**
 * Les enfants d'un enseignant et ce que leur scolarité prend sur son salaire.
 *
 * Un enfant d'enseignant N'EST PAS obligé d'attendre la paie de son père : sa
 * famille peut très bien régler au guichet avant. Ce module lit donc TOUS ses
 * mois — pas seulement ceux qui sont dans le rouge — et dit, pour chacun, d'où
 * l'argent est venu. Un mois payé par la famille reste affiché, avec son propre
 * statut, et n'est plus retenu sur le salaire : le retenir une seconde fois
 * ferait payer la scolarité deux fois.
 */
export function teacherChildRows(db: Database, teacherId: string): TeacherChildRow[] {
  return db.students
    .filter((st) => st.studentCase === "teacher_child" && st.teacherFatherId === teacherId)
    .map((st) => {
      const lines: TeacherChildLine[] = [];

      for (const subId of studentSubscriptionHistory(db, st)) {
        const sub = db.subscriptions.find((x) => x.id === subId);
        if (!sub) continue;
        const label = subscriptionLabel(db, sub);
        const currentCode = currentCycleCode(db, st.id, subId);
        const unitPrice = netPriceFor(
          studentListPrice(st, sub),
          db.enrollments.find((e) => e.studentId === st.id && e.subscriptionId === subId)
            ?.discount ?? st.subscriptionDiscounts?.[subId],
        );

        for (const cycle of enrollmentCycles(db, st.id, subId)) {
          // Un mois qui n'a ni séance ni versement n'a rien à raconter.
          if (cycle.consumed <= 0 && cycle.credited <= 0) continue;
          const credits = cycleCredits(db, st.id, subId, cycle.code);
          const debt = Math.max(0, -cycle.balance);
          const state: ChildLineState =
            debt > 0
              ? "due"
              : credits.charged > 0
                ? "charged"
                : credits.family > 0
                  ? "family"
                  : credits.school > 0
                    ? "school"
                    : credits.salary > 0
                      ? "salary"
                      : "pending";
          lines.push({
            subscriptionId: subId,
            label,
            monthCode: cycle.code,
            seances: cycle.done,
            unitPrice,
            expected: cycle.consumed,
            paidByFamily: credits.family,
            chargedToFather: credits.charged,
            paidFromSalary: credits.salary,
            paidBySchool: credits.school,
            amount: debt,
            state,
            current: currentCode === cycle.code,
          });
        }
      }

      lines.sort(
        (a, b) =>
          a.label.localeCompare(b.label) || a.monthCode.localeCompare(b.monthCode),
      );
      const dueLines = lines.filter((l) => l.amount > 0);
      const currentDue = dueLines.filter((l) => l.current);
      const amount = dueLines.reduce((s, l) => s + l.amount, 0);
      return {
        studentId: st.id,
        studentName: studentName(st),
        registrationNumber: registrationNumberOf(db, st),
        caseLabel: studentCaseLabel(st),
        lines,
        dueLines,
        currentAmount: currentDue.reduce((s, l) => s + l.amount, 0),
        previousAmount: dueLines.filter((l) => !l.current).reduce((s, l) => s + l.amount, 0),
        currentSeances: lines.filter((l) => l.current).reduce((s, l) => s + l.seances, 0),
        amount,
        paidByFamily: lines.reduce((s, l) => s + l.paidByFamily, 0),
        chargedToFather: lines.reduce((s, l) => s + l.chargedToFather, 0),
        paidFromSalary: lines.reduce((s, l) => s + l.paidFromSalary, 0),
        settledBeforePay: amount === 0 && lines.some((l) => l.paidByFamily > 0),
      } satisfies TeacherChildRow;
    })
    .filter((c) => c.lines.length > 0)
    .sort((a, b) => b.amount - a.amount || a.studentName.localeCompare(b.studentName));
}
