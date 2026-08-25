/**
 * LE TABLEAU DE PAIE D'UN MOIS — trois tables, un net.
 *
 * On ne règle plus « des créneaux » ni « tout ce qu'un enseignant a fait » : on
 * règle UN MOIS D'UN EMPLOI DU TEMPS. L'écran s'ouvre donc sur la liste de ses
 * emplois, chaque emploi déroule ses mois M1 → M12, et chaque mois affiche
 * exactement trois tables :
 *
 *   1. LES ÉLÈVES DU MOIS — qui est venu, qui a payé, et ce que chacun rapporte
 *      à l'enseignant. Une part n'est RETENUE que si la séance qui l'a produite
 *      n'est pas payée sur ce mois de cet emploi du temps : un élève à jour ici
 *      débloque la paie même s'il doit encore ailleurs. L'école peut aussi
 *      avancer la dette de sa caisse, auquel cas la ligne passe en rouge et se
 *      signale comme telle.
 *   2. LES ARRIÉRÉS — les élèves qui ont payé EN RETARD. Leur part appartient à
 *      un mois DÉJÀ réglé : elle se rattrape ici, avec son mois d'origine, sans
 *      jamais se mélanger au mois courant.
 *   3. LES RETENUES — dépenses avancées par l'école, acomptes, scolarité de ses
 *      enfants encore due, et scolarités déjà créditées au guichet et portées
 *      sur ce salaire.
 *
 * Le module ne décide rien : il lit ce que les présences, les soldes et les
 * règlements ont déjà écrit, et le range dans la forme que l'écran, la fiche de
 * paie imprimée et l'historique partagent — d'où `freezeBoard`, qui en fait la
 * photographie stockée sur le règlement.
 */

import type { Database } from "@/lib/store/data";
import type {
  Teacher,
  TeacherPayArrearLine,
  TeacherPayBoard,
  TeacherPayDeductionLine,
  TeacherPayPassagerLine,
  TeacherPayStudentLine,
  TeacherPayment,
} from "@/lib/types";
import {
  cycleLead,
  cycleOf,
  cycleSlots,
  monthlyPriceOf,
  teacherMonthShareOf,
} from "@/lib/helpers";
import { money } from "@/lib/utils";
import {
  teacherChildRows,
  teacherEmplois,
  type TeacherEmploi,
  type TeacherMonth,
  type TeacherMonthStudent,
  type TeacherPassager,
} from "@/lib/teacherMonths";

/** Combien de mois la liste M1 → M12 affiche toujours. */
export const PAY_MONTHS = 12;

// ---------------------------------------------------------------------------
// L'état d'un mois dans la liste M1 → M12
// ---------------------------------------------------------------------------

/**
 * CE QU'UNE PASTILLE DE MOIS DIT, D'UN COUP D'ŒIL :
 *  - `paid`     : l'enseignant a déjà été réglé pour ce mois ;
 *  - `payable`  : le mois est clos (ses séances sont tenues) et doit encore ;
 *  - `running`  : le mois court — 3 séances sur 4 — il n'est pas encore à régler ;
 *  - `blocked`  : tout ce qu'il doit est RETENU (des élèves n'ont pas payé) ;
 *  - `empty`    : rien ne s'y est encore passé.
 */
export type MonthTileState = "paid" | "payable" | "running" | "blocked" | "empty";

export interface MonthTile {
  code: string;
  index: number;
  /** séances tenues sur ce mois */
  held: number;
  /** séances que le mois contient */
  size: number;
  /** le mois a donné toutes ses séances */
  complete: boolean;
  /** le mois que le groupe est en train de vivre */
  isCurrent: boolean;
  state: MonthTileState;
  /** un règlement a déjà soldé ce mois */
  settled: boolean;
  /** le règlement qui l'a soldé, quand il y en a un */
  paymentId?: string;
  /** ce que ce mois peut encore rapporter à l'enseignant, maintenant */
  payable: number;
  /** ce qui reste retenu faute de paiement des élèves */
  withheld: number;
  /** ce qu'il a déjà rapporté */
  paid: number;
  students: number;
  /** ce que les séances libres tombées dans ce mois doivent à l'enseignant */
  passagers: number;
  /** combien de séances libres ce mois porte */
  passagerCount: number;
}

/**
 * Les douze pastilles d'un emploi du temps.
 *
 * La liste va TOUJOURS de M1 à M12, même si le groupe n'en est qu'à son
 * deuxième mois : c'est un calendrier, pas un journal — on doit pouvoir ouvrir
 * M7 pour voir qu'il n'a rien, comme on ouvre une page blanche d'un agenda.
 */
export function monthTiles(
  db: Database,
  emploi: TeacherEmploi,
  teacherId: string,
): MonthTile[] {
  const paidMonths = settledMonthCodes(db, teacherId, emploi.sessionId);
  return Array.from({ length: PAY_MONTHS }, (_, i) => {
    const code = `M${i + 1}`;
    const month = emploi.months[i];
    const settlement = paidMonths.get(code);
    const held = month?.held ?? 0;
    const size = month?.size ?? emploi.size;
    const complete = held >= size && size > 0;
    const payable = month?.payable ?? 0;
    const withheld = month?.withheld ?? 0;
    const alreadyPaid = month?.settled ?? 0;
    const passagers = month?.passagerPayable ?? 0;
    const passagerCount = month?.passagers.length ?? 0;

    // Une séance libre est payée d'avance par le passager : elle n'attend pas
    // que le mois soit clos pour être due, contrairement aux parts des élèves.
    const state: MonthTileState = settlement
      ? "paid"
      : payable > 0 && (complete || passagers >= payable)
        ? "payable"
        : withheld > 0 && payable === 0
          ? "blocked"
          : held > 0 || passagerCount > 0
            ? "running"
            : "empty";

    return {
      code,
      index: i,
      held,
      size,
      complete,
      isCurrent: !!month?.isCurrent,
      state,
      settled: !!settlement,
      paymentId: settlement?.id,
      payable,
      withheld,
      paid: alreadyPaid,
      students: month?.students.length ?? 0,
      passagers,
      passagerCount,
    } satisfies MonthTile;
  });
}

/** Les mois d'un emploi qu'un règlement a déjà soldés, par code. */
export function settledMonthCodes(
  db: Database,
  teacherId: string,
  sessionId: string,
): Map<string, TeacherPayment> {
  const out = new Map<string, TeacherPayment>();
  for (const pay of db.teacherPayments) {
    if (pay.teacherId !== teacherId) continue;
    for (const m of pay.months ?? []) {
      if (m.sessionId !== sessionId) continue;
      out.set(m.monthCode, pay);
    }
    // Les règlements écrits par le nouvel écran portent leur mois dans `board`,
    // même quand `months` est vide (un mois qui ne réglait que des arriérés).
    if (pay.board && pay.board.sessionId === sessionId) {
      out.set(pay.board.monthCode, pay);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Le tableau vivant d'un mois
// ---------------------------------------------------------------------------

/** Une ligne d'élève, enrichie de ce dont l'écran a besoin pour agir. */
export interface BoardStudent extends TeacherPayStudentLine {
  /** les parts encore dues, à joindre au règlement */
  dueIds: string[];
  /** ce que des règlements précédents ont déjà payé sur ce mois */
  alreadyPaid: number;
  /** tout ce que l'élève doit, restes et frais d'inscription compris — ce que
   *  le guichet lui réclame, PAS ce qui retient l'enseignant */
  totalDebt: number;
  /** ce qu'il doit sur CET emploi du temps : le montant que l'école a à avancer
   *  pour débloquer la part retenue, et rien de plus */
  emploiDebt: number;
  /** ses dettes sur les AUTRES emplois du temps */
  otherDebt: number;
  /** ce que le mois lui a coûté en séances */
  consumed: number;
  size: number;
  done: number;
}

export interface BoardArrear extends TeacherPayArrearLine {
  key: string;
  dueIds: string[];
  monthIndex: number;
}

/**
 * UNE SÉANCE LIBRE DU MOIS — un élève de passage, une séance, une part.
 *
 * Elle se règle avec le mois où elle est tombée, dans la même table que les
 * retards de paiement : ce sont les deux choses qu'un mois doit à
 * l'enseignant SANS venir de ses élèves inscrits.
 */
export interface BoardPassager extends TeacherPayPassagerLine {
  /** la part de l'école n'a jamais été saisie (séance d'avant le découpage) */
  unsplit: boolean;
}

export interface BoardDeduction extends TeacherPayDeductionLine {
  /** cochée par la réception (donc réellement retenue par ce règlement) */
  selectable: boolean;
  /** scolarité d'enfant : l'emploi et le mois concernés, pour la recréditer */
  studentId?: string;
  subscriptionId?: string;
  monthCode?: string;
}

/** Tout ce que l'écran d'un mois affiche, avant que la réception ne coche. */
export interface PayBoard {
  emploi: TeacherEmploi;
  month?: TeacherMonth;
  monthCode: string;
  monthIndex: number;
  size: number;
  held: number;
  monthPrice: number;
  teacherMonthShare: number;
  perSeance: number;
  /** table 1 */
  students: BoardStudent[];
  /** table 2 */
  arrears: BoardArrear[];
  /** table 2 bis — les séances libres tombées dans ce mois */
  passagers: BoardPassager[];
  /** table 3 */
  deductions: BoardDeduction[];
  /** ce que la table 1 peut rapporter maintenant */
  studentsTotal: number;
  /** ce qu'elle rapporterait si tout le monde avait payé */
  studentsPotential: number;
  /** ce qui reste retenu */
  withheldTotal: number;
  /** ce que la table 2 rattrape */
  arrearsTotal: number;
  /** ce que les séances libres du mois rapportent à l'enseignant */
  passagersTotal: number;
  /** ce que ces mêmes séances ont encaissé, part de l'école comprise */
  passagersRevenue: number;
  /** ce que la table 3 retient */
  deductionsTotal: number;
  /** déjà réglé sur ce mois par un versement antérieur */
  alreadyPaid: number;
  /** un règlement a déjà soldé ce mois */
  settlement?: TeacherPayment;
}

/**
 * Un élève dont l'école a avancé la dette de sa propre caisse.
 *
 * C'est ce que la table 1 signale en rouge : l'enseignant est payé pour lui
 * alors que la famille n'a rien versé — l'école a fait l'avance pour ne pas le
 * faire attendre, et elle a le droit de le voir écrit.
 */
function schoolCoveredIds(db: Database, subscriptionId?: string): Set<string> {
  const out = new Set<string>();
  for (const p of db.payments) {
    if (p.paidFrom !== "school_cash") continue;
    if (subscriptionId && p.subscriptionId !== subscriptionId) continue;
    out.add(p.studentId);
  }
  return out;
}

/** Le mois `code` d'un emploi du temps, prêt à être affiché et réglé. */
export function buildPayBoard(
  db: Database,
  teacher: Teacher,
  emploi: TeacherEmploi,
  monthCode: string,
): PayBoard {
  const monthIndex = Math.max(0, Number(monthCode.replace(/\D/g, "")) - 1);
  const month = emploi.months[monthIndex];
  const sub = db.subscriptions.find((s) => s.id === emploi.subscriptionId);
  const monthPrice = monthlyPriceOf(sub);
  const teacherMonthShare = teacherMonthShareOf(sub);
  const covered = schoolCoveredIds(db, emploi.subscriptionId);
  const settlement = settledMonthCodes(db, teacher.id, emploi.sessionId).get(monthCode);

  // ---- table 1 : les élèves du mois ---------------------------------------
  const students: BoardStudent[] = (month?.students ?? []).map((st) =>
    boardStudent(month!, st, covered.has(st.studentId), monthSlots(db, emploi, st.studentId, monthCode)),
  );

  // ---- table 2 : les arriérés des mois DÉJÀ réglés -------------------------
  const arrears: BoardArrear[] = [];
  for (const m of emploi.months) {
    // Un arriéré appartient au passé : le mois courant n'en produit pas, et un
    // mois jamais réglé n'a rien « rattrapé » — il est simplement impayé.
    if (m.index >= monthIndex || !m.alreadySettled) continue;
    const byStudent = new Map<string, BoardArrear>();
    for (const d of m.dues) {
      if (d.paid || d.withheld) continue;
      const st = m.students.find((x) => x.studentId === d.studentId);
      const row =
        byStudent.get(d.studentId) ??
        ({
          key: `${emploi.sessionId}|${m.code}|${d.studentId}`,
          studentId: d.studentId,
          name: d.studentName,
          registrationNumber: d.registrationNumber,
          phone: st?.phone,
          caseLabel: st?.caseLabel,
          payState: "payé en retard",
          presents: 0,
          absents: 0,
          cancelled: 0,
          seances: 0,
          perSeance: st?.teacherPerSeance ?? 0,
          expected: st?.expected ?? 0,
          credited: st?.credited ?? 0,
          debt: st?.debt ?? 0,
          amount: 0,
          withheld: false,
          schoolCovered: covered.has(d.studentId),
          monthCode: m.code,
          monthIndex: m.index,
          emploi: emploi.title,
          dates: [],
          dueIds: [],
        } satisfies BoardArrear);
      row.seances += 1;
      row.presents += 1;
      row.amount = money(row.amount + d.amount);
      row.dueIds.push(d.id);
      if (!row.dates.includes(d.dateKey)) row.dates.push(d.dateKey);
      byStudent.set(d.studentId, row);
    }
    for (const row of byStudent.values()) {
      row.dates.sort();
      arrears.push(row);
    }
  }
  arrears.sort((a, b) => a.monthIndex - b.monthIndex || a.name.localeCompare(b.name));

  // ---- table 2 bis : les séances libres tombées dans ce mois --------------
  // Un passager n'est ni inscrit ni endetté : sa séance est payée d'avance, la
  // part de l'enseignant est donc due dès que le mois se règle.
  const passagers: BoardPassager[] = (month?.passagers ?? []).map(passagerLine);

  // ---- table 3 : ce qui est retenu sur la paie ----------------------------
  const deductions = buildDeductions(db, teacher);

  const studentsTotal = students.reduce((s, r) => s + (r.withheld ? 0 : r.amount), 0);
  const studentsPotential = students.reduce((s, r) => s + r.amount, 0);
  const withheldTotal = students.reduce((s, r) => s + (r.withheld ? r.amount : 0), 0);
  const arrearsTotal = arrears.reduce((s, r) => s + r.amount, 0);
  const passagersTotal = passagers.reduce((s, r) => s + r.teacherShare, 0);
  const passagersRevenue = passagers.reduce((s, r) => s + r.price, 0);
  const deductionsTotal = deductions
    .filter((d) => d.selectable)
    .reduce((s, d) => s + d.amount, 0);

  return {
    emploi,
    month,
    monthCode,
    monthIndex,
    size: month?.size ?? emploi.size,
    held: month?.held ?? 0,
    monthPrice,
    teacherMonthShare,
    perSeance: emploi.perSeance,
    students,
    arrears,
    passagers,
    deductions,
    studentsTotal: money(studentsTotal),
    studentsPotential: money(studentsPotential),
    withheldTotal: money(withheldTotal),
    arrearsTotal: money(arrearsTotal),
    passagersTotal: money(passagersTotal),
    passagersRevenue: money(passagersRevenue),
    deductionsTotal: money(deductionsTotal),
    alreadyPaid: month?.settled ?? 0,
    settlement,
  };
}

/**
 * LE MOIS D'UN ÉLÈVE, SÉANCE PAR SÉANCE — la même lecture que la feuille de
 * présence du groupe, parce que c'est la même question posée à l'envers.
 *
 * Les séances tenues AVANT son inscription ne sont pas les siennes : elles
 * portent `"before"` et restent vides sur sa ligne, au lieu de se lire comme un
 * pointage qu'on aurait oublié.
 */
function monthSlots(
  db: Database,
  emploi: TeacherEmploi,
  studentId: string,
  monthCode: string,
): (string | null)[] {
  if (!emploi.subscriptionId) return [];
  const rows = cycleSlots(db, studentId, emploi.subscriptionId, monthCode);
  const lead = cycleLead(db, studentId, emploi.subscriptionId, monthCode);
  const size = cycleOf(db, studentId, emploi.subscriptionId, monthCode).size;
  return Array.from({ length: size }, (_, i) =>
    i < lead ? "before" : (rows[i - lead]?.status ?? null),
  );
}

/** Une séance libre du mois, telle que la table 2 bis l'affiche. */
function passagerLine(p: TeacherPassager): BoardPassager {
  return {
    id: p.id,
    name: p.name,
    date: p.dateKey,
    startTime: p.startTime,
    endTime: p.endTime,
    label: p.label,
    price: p.price,
    schoolShare: p.schoolShare,
    teacherShare: p.teacherShare,
    unsplit: p.unsplit,
  };
}

/** Une ligne d'élève de la table 1, tirée du mois que `teacherMonths` a calculé. */
function boardStudent(
  month: TeacherMonth,
  st: TeacherMonthStudent,
  schoolCovered: boolean,
  slots: (string | null)[],
): BoardStudent {
  const dues = month.dues.filter((d) => d.studentId === st.studentId);
  const open = dues.filter((d) => !d.paid);
  // Une part n'est retenue que tant que l'élève doit quelque chose. L'avance de
  // l'école remet sa dette à zéro : la part se débloque, et `withheld` tombe.
  const withheld = open.some((d) => d.withheld);
  return {
    studentId: st.studentId,
    name: st.name,
    registrationNumber: st.registrationNumber,
    phone: st.phone,
    caseLabel: st.caseLabel || undefined,
    payState: st.status,
    presents: st.presents,
    absents: st.absents,
    cancelled: st.cancelled,
    seances: open.length,
    slots,
    perSeance: st.teacherPerSeance,
    expected: st.expected,
    credited: st.credited,
    debt: st.debt,
    amount: money(open.reduce((s, d) => s + d.amount, 0)),
    withheld,
    schoolCovered,
    dueIds: open.filter((d) => !d.withheld).map((d) => d.id),
    alreadyPaid: money(dues.filter((d) => d.paid).reduce((s, d) => s + d.amount, 0)),
    totalDebt: st.totalDebt,
    emploiDebt: st.emploiDebt,
    otherDebt: st.otherDebt,
    consumed: st.consumed,
    size: st.size,
    done: st.done,
  };
}

/**
 * LA TABLE DES RETENUES — ce que l'école reprend sur cette paie.
 *
 * Quatre natures, et la distinction compte :
 *  - une DÉPENSE que l'école a avancée pour lui (matériel, transport…),
 *  - un ACOMPTE déjà versé,
 *  - la scolarité ENCORE DUE d'un de ses enfants : il paie pour son fils comme
 *    n'importe quel parent, simplement le règlement passe par son salaire,
 *  - une scolarité d'enfant DÉJÀ CRÉDITÉE au guichet et portée sur lui : la
 *    réception a mis l'enfant en règle avant la paie, en promettant la somme à
 *    ce salaire — elle est donc retenue ici, une fois et une seule.
 *
 * Les lignes déjà réglées restent affichées, marquées comme telles : c'est ce
 * qui permet de vérifier qu'une dépense n'a pas été retenue deux fois.
 */
function buildDeductions(db: Database, teacher: Teacher): BoardDeduction[] {
  const out: BoardDeduction[] = [];

  for (const e of db.teacherExpenses.filter((x) => x.teacherId === teacher.id)) {
    out.push({
      id: e.id,
      kind: "expense",
      label: e.name,
      description: e.description,
      date: e.date,
      amount: e.amount,
      paid: !!e.paid,
      selectable: !e.paid,
    });
  }

  for (const a of db.acomptes.filter((x) => x.teacherId === teacher.id)) {
    out.push({
      id: a.id,
      kind: "acompte",
      label: "Acompte sur salaire",
      description: a.description,
      date: a.date.slice(0, 10),
      amount: a.amount,
      paid: !!a.paid,
      selectable: !a.paid,
    });
  }

  // Ses enfants : ce que leurs mois coûtent ENCORE. Un mois que la famille a
  // réglé elle-même n'est plus dû, donc il n'apparaît pas ici — le retenir
  // ferait payer la scolarité deux fois.
  for (const child of teacherChildRows(db, teacher.id)) {
    for (const line of child.dueLines) {
      if (line.amount <= 0) continue;
      out.push({
        id: `child:${child.studentId}:${line.subscriptionId}:${line.monthCode}`,
        kind: "child",
        label: `Scolarité — ${child.studentName}`,
        description: `${line.label} · ${line.monthCode} · ${line.seances} séance(s)`,
        date: "",
        amount: line.amount,
        paid: false,
        selectable: true,
        studentId: child.studentId,
        subscriptionId: line.subscriptionId,
        monthCode: line.monthCode,
      });
    }
  }

  // Les scolarités déjà créditées au guichet et portées sur ce salaire : elles
  // ont été promises à la caisse, ce règlement les honore.
  for (const d of db.teacherChildDebts.filter((x) => x.teacherId === teacher.id)) {
    out.push({
      id: d.id,
      kind: "child_debt",
      label: `Scolarité avancée — ${d.label}`,
      description: [d.monthCode, "réglée d'avance au guichet"].filter(Boolean).join(" · "),
      date: d.date,
      amount: d.amount,
      paid: !!d.paid,
      selectable: !d.paid,
      studentId: d.studentId,
      subscriptionId: d.subscriptionId,
      monthCode: d.monthCode,
    });
  }

  return out.sort((a, b) => Number(a.paid) - Number(b.paid) || b.date.localeCompare(a.date));
}

/** Ce que la réception a coché, table par table. */
export interface BoardPicked {
  studentIds: string[];
  arrearKeys: string[];
  /** les séances libres du mois retenues sur ce règlement */
  passagerIds: string[];
  deductionIds: string[];
}

export interface BoardSums {
  /** table 1 — les élèves du mois */
  students: number;
  /** table 2 — les retards de paiement rattrapés */
  arrears: number;
  /** table 2 bis — la part des séances libres */
  passagers: number;
  /** ce que les séances libres ont encaissé (part de l'école comprise) */
  passagersRevenue: number;
  /** students + arrears + passagers */
  gross: number;
  /** table 3 */
  deductions: number;
  /** gross − deductions */
  net: number;
}

/** Ce qui reste à l'enseignant : les tables qui rapportent, moins celle qui retient. */
export function boardTotals(board: PayBoard, picked: BoardPicked): BoardSums {
  const students = money(
    board.students
      .filter((r) => picked.studentIds.includes(r.studentId) && !r.withheld)
      .reduce((s, r) => s + r.amount, 0),
  );
  const arrears = money(
    board.arrears
      .filter((r) => picked.arrearKeys.includes(r.key))
      .reduce((s, r) => s + r.amount, 0),
  );
  const chosenPassagers = board.passagers.filter((r) => picked.passagerIds.includes(r.id));
  const passagers = money(chosenPassagers.reduce((s, r) => s + r.teacherShare, 0));
  const passagersRevenue = money(chosenPassagers.reduce((s, r) => s + r.price, 0));
  const deductions = money(
    board.deductions
      .filter((d) => d.selectable && picked.deductionIds.includes(d.id))
      .reduce((s, d) => s + d.amount, 0),
  );
  const gross = money(students + arrears + passagers);
  return {
    students,
    arrears,
    passagers,
    passagersRevenue,
    gross,
    deductions,
    net: money(gross - deductions),
  };
}

/**
 * LA PHOTOGRAPHIE DU RÈGLEMENT, telle qu'elle est stockée.
 *
 * Une fois le versement fait, plus rien ne doit pouvoir la changer : un élève
 * qui change de groupe, un tarif qu'on corrige, un mois qu'on rouvre — la fiche
 * de paie imprimée doit continuer d'afficher ce qui a été payé ce jour-là.
 */
export function freezeBoard(
  db: Database,
  board: PayBoard,
  picked: BoardPicked,
): TeacherPayBoard {
  const totals = boardTotals(board, picked);
  const e = board.emploi;
  const strip = <T extends TeacherPayStudentLine>(r: T): TeacherPayStudentLine => ({
    studentId: r.studentId,
    name: r.name,
    registrationNumber: r.registrationNumber,
    phone: r.phone,
    caseLabel: r.caseLabel,
    payState: r.payState,
    presents: r.presents,
    absents: r.absents,
    cancelled: r.cancelled,
    seances: r.seances,
    slots: r.slots,
    perSeance: r.perSeance,
    expected: r.expected,
    credited: r.credited,
    debt: r.debt,
    amount: r.amount,
    withheld: r.withheld,
    schoolCovered: r.schoolCovered,
  });

  return {
    sessionId: e.sessionId,
    subscriptionId: e.subscriptionId,
    emploi: e.title,
    className: e.className,
    groupName: e.groupName,
    salleName: e.salleName,
    daysLabel: e.daysLabel,
    timeLabel: e.timeLabel,
    monthCode: board.monthCode,
    size: board.size,
    held: board.held,
    monthPrice: board.monthPrice,
    teacherMonthShare: board.teacherMonthShare,
    perSeance: board.perSeance,
    students: board.students
      .filter((r) => picked.studentIds.includes(r.studentId))
      .map(strip),
    arrears: board.arrears
      .filter((r) => picked.arrearKeys.includes(r.key))
      .map((r) => ({
        ...strip(r),
        monthCode: r.monthCode,
        emploi: r.emploi,
        dates: r.dates,
      })),
    passagers: board.passagers
      .filter((r) => picked.passagerIds.includes(r.id))
      .map((r) => ({
        id: r.id,
        name: r.name,
        date: r.date,
        startTime: r.startTime,
        endTime: r.endTime,
        label: r.label,
        price: r.price,
        schoolShare: r.schoolShare,
        teacherShare: r.teacherShare,
      })),
    deductions: board.deductions
      .filter((d) => d.selectable && picked.deductionIds.includes(d.id))
      .map((d) => ({
        id: d.id,
        kind: d.kind,
        label: d.label,
        description: d.description,
        date: d.date,
        amount: d.amount,
        paid: true,
      })),
    studentsTotal: totals.students,
    arrearsTotal: totals.arrears,
    passagersTotal: totals.passagers,
    deductionsTotal: totals.deductions,
    gross: totals.gross,
    // Le net peut être NÉGATIF (les retenues dépassent le brut) : c'est un cas
    // réel — un enseignant qui a pris plus d'acomptes qu'il n'a gagné ce mois —
    // et l'écrire tel quel est la seule façon honnête de le lire ensuite.
    net: totals.net,
  };
}

/** Tous les emplois du temps d'un enseignant — l'entrée de l'écran de paie. */
export function payEmplois(db: Database, teacherId: string): TeacherEmploi[] {
  return teacherEmplois(db, teacherId);
}
