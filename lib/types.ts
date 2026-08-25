import type { Role } from "@/lib/store/session";

export type { Role };

export type Day =
  | "sunday"
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday";

export const DAYS: Day[] = [
  "saturday",
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
];

export interface School {
  id: string;
  name: string;
  description: string;
  phone: string;
  email: string;
  logo?: string;
  address: string;
  articleFiscal?: string;
  registreCommerce?: string;
  nif?: string;
  nis?: string;
  /** one-time registration fee charged once per student on first enrollment */
  registrationFee?: number;
  /**
   * QUI DOIT LES FRAIS D'INSCRIPTION.
   *
   * Tout le monde ne les paie pas forcément : l'école peut n'en réclamer qu'aux
   * classes du secondaire, à trois classes précises, ou seulement aux élèves
   * inscrits sur certains emplois du temps.
   *
   *  - `all`      : tous les élèves (le comportement d'origine),
   *  - `levels`   : tous les élèves des NIVEAUX listés (`registrationFeeLevels`),
   *  - `classes`  : uniquement les classes listées (`registrationFeeClassIds`),
   *  - `sessions` : uniquement les emplois du temps listés
   *                 (`registrationFeeSessionIds`).
   *
   * Absent = `all`, pour que les écoles déjà en base ne changent pas de règle.
   */
  registrationFeeScope?: RegistrationFeeScope;
  /** `levels` : les niveaux concernés ("lycee", "moyen", …, "formation") */
  registrationFeeLevels?: string[];
  /** `classes` : les classes concernées */
  registrationFeeClassIds?: string[];
  /** `sessions` : les emplois du temps concernés */
  registrationFeeSessionIds?: string[];
  /** master switch for the automatic weekly-absence billing */
  absencePenaltyEnabled?: boolean;
  /** floor date (YYYY-MM-DD): absences are only billed for weeks ending on/after
   *  this day, so enabling the feature never retro-bills old history */
  absencePenaltySince?: string;
  /** weekday the absence week opens on (0 = sunday … 5 = friday, the default):
   *  a week runs from that day to the same day of the next week */
  absenceWeekStartDay?: number;
}

/** Sur QUI portent les frais d'inscription — voir `School.registrationFeeScope`. */
export type RegistrationFeeScope = "all" | "levels" | "classes" | "sessions";

export type ClassType = "cours" | "formation";
/** School levels — "maternelle" (kindergarten) is the newest one. In the UI
 *  they read: Maternelle, Primaire, Moyen, Secondaire (Lycée). */
export type CoursLevel = "maternelle" | "primaire" | "moyen" | "lycee";
export type FormationLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";

export interface SchoolClass {
  id: string;
  type: ClassType;
  name: string;
  description: string;
  // cours
  coursLevel?: CoursLevel;
  year?: string;
  /** kindergarten only: optional category (e.g. "Petite section"), free-form
   *  and created on the fly from the class screen */
  categoryId?: string;
  // formation
  formationLevel?: FormationLevel;
}

/** Optional grouping for kindergarten classes (e.g. "Petite / Moyenne / Grande
 *  section"). Created inline from the class creation screen. */
export interface ClassCategory {
  id: string;
  name: string;
}
export interface Module {
  id: string;
  name: string;
}
export interface Group {
  id: string;
  name: string;
}
export interface Salle {
  id: string;
  name: string;
}

/**
 * How a teacher is paid:
 *  - `monthly`: a fixed salary, independent of the séances,
 *  - `percentage`: a % of what each présent student generated,
 *  - `per_group`: the pay is defined GROUPE PAR GROUPE on the emploi du temps
 *    itself (abonnement -> part de l'école / part de l'enseignant), so each
 *    séance earns him that emploi's `teacherPerSeance` and nothing else.
 */
export type TeacherPaymentType = "monthly" | "percentage" | "per_group";
export interface Teacher {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  paymentType: TeacherPaymentType;
  monthlyAmount?: number;
  startDate?: string;
  percentage?: number;
  /** "enseignant passager": intervenant sans compte de connexion, réglé
   *  créneau par créneau depuis la fiche enseignant */
  isPassager?: boolean;
}

/** One settlement written for a teacher (fixed amount or percentage-based). */
export interface TeacherPayment {
  id: string;
  teacherId: string;
  /** what he actually took home: gross − dépenses − acomptes − frais des enfants */
  amount: number;
  /** "group" = the emplois du temps priced the séances themselves */
  method: "fixed" | "percent" | "group";
  percentage?: number;
  studentsCount: number;
  sessionsCount: number;
  description: string;
  /** frozen snapshot of the settled timings, so the receipt can be reprinted */
  details: TeacherPaymentDetail[];
  /** what the séances earned him, BEFORE anything was taken off */
  gross?: number;
  /** the dépenses this settlement cleared — never deducted twice */
  expenses?: TeacherPaymentDeduction[];
  /** the acomptes it cleared */
  acomptes?: TeacherPaymentDeduction[];
  /** his children's inscriptions, settled out of his pay */
  childCharges?: TeacherChildCharge[];
  /** the child schoolings that had ALREADY been credited and booked on him
   *  (`TeacherChildDebt`), cleared by this settlement */
  childDebts?: TeacherPaymentDeduction[];
  /** the emploi-du-temps MONTHS this settlement closed (M1, M2 …) — frozen so
   *  the payslip and the month table still read right once the dues are paid */
  months?: TeacherPaymentMonth[];
  /**
   * LES ARRIÉRÉS DÉBLOQUÉS que ce règlement a payés.
   *
   * Un mois déjà réglé peut encore devoir quelque chose : l'élève n'avait pas
   * payé, la part de l'enseignant a donc été retenue. Quand l'élève s'acquitte,
   * cette part revient — sur le règlement SUIVANT, jamais dans le mois en cours.
   * Elle est figée ici pour que la fiche de paie et l'historique la montrent
   * pour ce qu'elle est : un rattrapage, pas le mois du jour.
   */
  arrears?: TeacherPaymentArrear[];
  /** le mouvement de caisse que ce règlement a écrit — annulé avec lui */
  cashId?: string;
  /**
   * L'ÉCRAN DE PAIE, FIGÉ TEL QUEL.
   *
   * Le règlement se fait désormais MOIS PAR MOIS sur UN emploi du temps, et
   * l'écran qui le prépare montre trois tableaux : les élèves du mois, les
   * arriérés rattrapés, et les retenues. `board` en garde la photographie
   * exacte, si bien que « voir le détail » d'un vieux règlement et la fiche de
   * paie réimprimée affichent les mêmes lignes qu'au moment du versement —
   * même si un élève a changé de groupe ou de tarif depuis.
   *
   * Absent = règlement enregistré avant cet écran (l'ancien détail suffit).
   */
  board?: TeacherPayBoard;
  paidAt: string;
}

/**
 * LA PHOTOGRAPHIE D'UN RÈGLEMENT DE MOIS, TABLEAU PAR TABLEAU.
 *
 * Elle est écrite au moment du versement et ne bouge plus : c'est ce que
 * l'écran de détail réaffiche et ce que la fiche de paie imprime.
 */
export interface TeacherPayBoard {
  sessionId: string;
  subscriptionId?: string;
  emploi: string;
  className: string;
  groupName: string;
  salleName: string;
  daysLabel: string;
  timeLabel: string;
  monthCode: string;
  /** séances que le mois contient */
  size: number;
  /** séances effectivement tenues */
  held: number;
  /** prix du mois complet pour un élève */
  monthPrice: number;
  /** ce que le mois complet rapporte à l'enseignant */
  teacherMonthShare: number;
  /** part enseignant d'UNE séance (teacherMonthShare ÷ size) */
  perSeance: number;
  /** tableau 1 — les élèves du mois */
  students: TeacherPayStudentLine[];
  /** tableau 2 — les élèves qui ont payé en retard (mois déjà réglés) */
  arrears: TeacherPayArrearLine[];
  /** tableau 3 — ce qui est retenu sur la paie */
  deductions: TeacherPayDeductionLine[];
  studentsTotal: number;
  arrearsTotal: number;
  deductionsTotal: number;
  /** studentsTotal + arrearsTotal */
  gross: number;
  /** gross − deductionsTotal */
  net: number;
}

/** Une ligne du tableau des élèves d'un mois, sur la paie de l'enseignant. */
export interface TeacherPayStudentLine {
  studentId: string;
  name: string;
  registrationNumber?: string;
  phone?: string;
  caseLabel?: string;
  /** payé · partiel · impayé · rien encore · gratuit */
  payState: string;
  presents: number;
  absents: number;
  cancelled: number;
  /** séances de ce mois qui rapportent quelque chose à l'enseignant */
  seances: number;
  /**
   * LE MOIS SÉANCE PAR SÉANCE, comme la feuille de présence l'affiche :
   * `"present" | "late" | "absent" | "cancelled"`, `null` pour une séance pas
   * encore pointée, et `"before"` pour une séance tenue AVANT son inscription
   * — celle-là n'a jamais été la sienne, elle reste vide sur sa ligne.
   */
  slots?: (string | null)[];
  /** ce qu'une de ses séances rapporte à l'enseignant */
  perSeance: number;
  /** ce que le mois lui coûte */
  expected: number;
  /** ce qu'il a versé sur ce mois */
  credited: number;
  /** ce qu'il doit encore */
  debt: number;
  /** ce que ses séances rapportent à l'enseignant sur ce mois */
  amount: number;
  /** sa part est RETENUE : il doit encore de l'argent */
  withheld: boolean;
  /** l'école a avancé sa dette de sa propre caisse pour débloquer la part */
  schoolCovered: boolean;
}

/** Une ligne du tableau des arriérés — une part d'un mois DÉJÀ réglé. */
export interface TeacherPayArrearLine extends TeacherPayStudentLine {
  /** le mois d'origine de la part */
  monthCode: string;
  emploi: string;
  /** les jours concernés */
  dates: string[];
}

/** Une ligne du tableau des retenues (dépenses, acomptes, enfants). */
export interface TeacherPayDeductionLine {
  id: string;
  /**
   *  - `expense`     : une dépense que l'école a avancée pour lui,
   *  - `acompte`     : une avance sur salaire,
   *  - `child`       : la scolarité ENCORE DUE d'un de ses enfants,
   *  - `child_debt`  : une scolarité d'enfant déjà créditée au guichet et
   *                    portée sur ce salaire.
   */
  kind: "expense" | "acompte" | "child" | "child_debt";
  label: string;
  description?: string;
  date: string;
  amount: number;
  /** déjà réglée par ce versement (elle ne revient pas sur le suivant) */
  paid: boolean;
}

/** Un arriéré débloqué, réglé par un versement postérieur au mois concerné. */
export interface TeacherPaymentArrear {
  studentId: string;
  studentName: string;
  registrationNumber?: string;
  sessionId: string;
  emploi: string;
  monthCode: string;
  seances: number;
  amount: number;
}

/** One emploi-du-temps month closed by a settlement. */
export interface TeacherPaymentMonth {
  sessionId: string;
  title: string;
  groupName: string;
  /** the emploi's own month code — "M2" means "the 2nd month OF THAT emploi" */
  monthCode: string;
  /** séances the month held */
  seances: number;
  presents: number;
  students: number;
  /** what those séances earned him */
  gross: number;
}

/** One line taken off a settlement: a dépense or an acompte. */
export interface TeacherPaymentDeduction {
  id: string;
  kind: "expense" | "acompte";
  label: string;
  description?: string;
  amount: number;
  date: string;
}

/**
 * A student whose schooling is settled from his teacher-father's pay
 * (`Student.studentCase === "teacher_child"`): what he owed, and on which
 * emplois du temps, at the moment the salary was paid.
 */
export interface TeacherChildCharge {
  studentId: string;
  studentName: string;
  registrationNumber?: string;
  /** what he owes, emploi by emploi */
  lines: { subscriptionId: string; label: string; monthCode: string; amount: number }[];
  amount: number;
}

/**
 * UNE SCOLARITÉ D'ENFANT PORTÉE EN DETTE SUR SON PÈRE ENSEIGNANT.
 *
 * Un fils d'enseignant n'a pas à attendre la paie de son père pour être en
 * règle : la réception peut solder son mois depuis la feuille de présence du
 * groupe, sans ouvrir le moindre écran de paie. Deux chemins s'offrent alors,
 * et l'un d'eux écrit cette ligne :
 *
 *  - « la famille paie maintenant » : l'argent entre en caisse comme n'importe
 *    quel versement, et RIEN n'est retenu au père (aucune ligne ici) ;
 *  - « à porter sur le salaire du père » : le solde de l'enfant est crédité
 *    tout de suite — ses mois cessent d'être en dette, la part que ses séances
 *    rapportent à l'enseignant se débloque — et le montant est inscrit ICI, en
 *    attente. Le prochain règlement du père le lit, le retient sur son net et
 *    le passe à `paid` : il ne peut donc être retenu qu'UNE fois.
 */
export interface TeacherChildDebt {
  id: string;
  /** l'enseignant père sur qui la somme est portée */
  teacherId: string;
  studentId: string;
  /** l'emploi du temps crédité (absent = une dette hors emploi : restes, frais) */
  subscriptionId?: string;
  /** le mois de cet emploi qui a été soldé (M1, M2 …) */
  monthCode?: string;
  /** ce que la ligne dit sur la fiche de paie */
  label: string;
  amount: number;
  date: string; // YYYY-MM-DD
  /** déjà retenu sur un règlement — il ne revient jamais sur le suivant */
  paid?: boolean;
  paymentId?: string;
  createdAt?: string;
}

export interface TeacherPaymentDetail {
  dateKey: string;
  sessionId: string;
  title: string;
  moduleName: string;
  groupName: string;
  startTime: string;
  endTime: string;
  presents: number;
  passagers: number;
  gross: number;
  share: number;
}

export type ReceptionPaymentType = "daily" | "monthly" | "half_day" | "hourly";
/** Réception / Agent de sécurité / Ménage — Ménage never gets a login. */
export type WorkerRole = "reception" | "security" | "menage";
export interface ReceptionStaff {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  paymentType: ReceptionPaymentType;
  startDate: string;
  salary: number;
  role?: WorkerRole;
  /** badge used by the worker check-in scanner */
  rfid?: string;
  /** paymentType === "hourly": price of one worked hour */
  hourlyRate?: number;
}

/** One worked day of an hourly worker (clock-in / clock-out). */
export interface WorkerShift {
  id: string;
  workerId: string;
  workDate: string; // YYYY-MM-DD
  startAt?: string;
  endAt?: string;
  minutes: number;
  /** the day ended without a clock-out: hours frozen until reception fixes it */
  frozen: boolean;
  paid: boolean;
  paymentId?: string;
  createdAt: string;
}

/** The hours ONE day of an emploi du temps runs on. */
export interface DayTime {
  startTime: string; // HH:mm
  endTime: string; // HH:mm
}

export interface ScheduleSession {
  id: string;
  classId: string;
  moduleId: string;
  groupId: string;
  salleId: string;
  teacherId: string;
  days: Day[];
  /**
   * The emploi's DEFAULT hours — what every day runs on unless `dayTimes` says
   * otherwise. Always filled, so anything that only needs "roughly when" can
   * read them directly.
   */
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  /**
   * Per-day hours. An emploi that runs Samedi 08:00–10:00 and Mardi 14:00–16:00
   * carries both here; a day absent from the map simply runs on
   * `startTime`/`endTime`. Read it through `sessionTimesOn()` — never directly,
   * so the fallback stays in one place.
   */
  dayTimes?: Partial<Record<Day, DayTime>>;
  /**
   * Per-day salle. An emploi that runs Samedi in Salle A and Mardi in Salle B is
   * still ONE emploi: each day simply carries the room it occupies. A day absent
   * from the map falls back on `salleId`, which always holds the first day's
   * room so anything that only needs "roughly where" can read it directly.
   * Read it through `sessionSalleOn()` — never directly, so the fallback stays
   * in one place.
   */
  daySalles?: Partial<Record<Day, string>>;
  /**
   * UN EMPLOI DU TEMPS SUR PLUSIEURS NIVEAUX À LA FOIS.
   *
   * Un même créneau réunit parfois deux classes qui n'ont rien à voir : la 4e
   * année moyenne et la 3e année secondaire, chacune avec SES groupes. Ce
   * champ dit, classe par classe, quels groupes cette classe amène :
   *
   *     { "cls-4am": ["grp-a", "grp-b"], "cls-3as": ["grp-c"] }
   *
   * `classIds` porte la liste des classes, `classId` la PREMIÈRE (la colonne
   * historique que le scan et la base lisent), et `groupIds` l'union de tous
   * les groupes — de sorte que rien de ce qui existait n'a besoin de savoir
   * qu'un emploi peut désormais couvrir plusieurs niveaux.
   *
   * Absent = emploi du temps à un seul niveau, exactement comme avant.
   */
  classGroups?: Record<string, string[]>;
  /** "séance libre" timing: several classes/groups/salles over a date period */
  isOpen?: boolean;
  /** explicit, readable name — only set for séance libre timings */
  title?: string;
  periodStart?: string;
  periodEnd?: string;
  classIds?: string[];
  groupIds?: string[];
  salleIds?: string[];
  /** price of one séance libre (mirrored into the auto-created subscription) */
  openPrice?: number;
  /**
   * Le jour où la réception a SUPPRIMÉ cet emploi du temps (YYYY-MM-DD).
   *
   * Un emploi du temps n'est jamais effacé : le supprimer l'ARCHIVE. La ligne
   * reste en base, donc les présences qui y ont été pointées, les soldes et les
   * paiements des élèves, et les parts déjà dues à l'enseignant continuent de
   * s'afficher — avec le nom du module, du groupe et de la salle. Il disparaît
   * simplement des écrans qui servent à travailler aujourd'hui (grille, feuille
   * de présence, catalogue d'inscription).
   *
   * Absent = emploi du temps vivant.
   */
  archivedAt?: string;
}

/**
 * How ONE inscription is sold:
 *  - `seance`: the student buys séances one by one, they never expire,
 *  - `month`: he buys a whole month (a fixed pack of séances at a fixed price)
 *    which expires exactly one month after its start date — whatever is left
 *    unused on that day is lost.
 */
export type SubscriptionPlan = "seance" | "month";

export interface Subscription {
  id: string;
  /** the schedule this subscription is priced against */
  sessionId: string;
  pricePerSession: number;
  /** formation classes: fixed price for the whole level (pricePerSession stays 0) */
  levelPrice?: number;
  /** formation classes: duration in months, drives the per-student expiry date */
  periodMonths?: number;
  /** monthly formula: how many séances one month of this cours includes.
   *  0 / undefined = the cours is only sold séance by séance. */
  monthlySeances?: number;
  /** what that month costs. Defaults to `monthlySeances × pricePerSession`, but
   *  the school may sell the pack for less than the sum of its séances. */
  monthlyPrice?: number;
  /** monthly formula: how much of `monthlyPrice` the SCHOOL keeps. The rest
   *  (monthlyPrice − schoolMonthShare) is the teacher's share for that month.
   *  Absent = the school keeps the whole month price. */
  schoolMonthShare?: number;
  /** monthly formula: the teacher's pay for ONE séance, derived at creation as
   *  teacherMonthShare / monthlySeances. Stored so every settlement reads it
   *  directly instead of recomputing. */
  teacherPerSeance?: number;
  /** l'emploi du temps de ce tarif a été supprimé : le tarif est archivé avec
   *  lui, pour que les soldes et les paiements qu'il porte restent lisibles */
  archivedAt?: string;
}

/**
 * Per-student enrollment dates (YYYY-MM-DD), kept for EVERY enrollment —
 * cours and formations alike:
 *  - `subscribedAt`: the day reception registered the student on that module
 *    (purely informative, it never drives a price),
 *  - `startDate`: the day billing starts. A séance attended BEFORE it is
 *    recorded as usual but never charged (see `AttendanceRecord.preStart`),
 *  - `expiryDate`: end of the enrollment — formations get one from the level's
 *    duration, monthly plans one month after their start date. Past it, the
 *    card is refused and the séances still on the counter are lost.
 */
export interface SubscriptionDates {
  subscribedAt?: string;
  startDate?: string;
  expiryDate?: string;
  /** how the module was sold to this student ("seance" when absent) */
  plan?: SubscriptionPlan;
  /**
   * WHERE on the emploi du temps the student came in. A child registered while
   * the group is living its 2nd month, on its 3rd séance, starts there and not
   * on M1 · séance 1: `joinMonthCode` is that month ("M2") and `joinSlotIndex`
   * that séance, 0-based (séance 3 -> 2).
   *
   * Every month calculation offsets his séances by that point, so his first
   * présence lands on M2 · séance 3, the séances held before him stay blank on
   * the sheet, and the months he was not part of never list him at all.
   *
   * Absent = M1 · séance 1, exactly how every inscription read before.
   */
  joinMonthCode?: string;
  joinSlotIndex?: number;
  /**
   * The day reception took the student OFF this emploi du temps. The block is
   * KEPT when he leaves — only `subscriptionIds` loses the module — so his
   * présences, ses paiements et son solde restent lisibles sur sa fiche, datés
   * de la sortie. Re-registering him clears it and rewrites the join point.
   */
  unsubscribedAt?: string;
}

/** Reduction granted to ONE student on ONE module, applied by every price
 *  calculation (scan, manual présence, weekly absence billing). */
export type DiscountType = "percent" | "amount";
export interface SubscriptionDiscount {
  type: DiscountType;
  value: number;
}

/**
 * "Période gratuite": a date window during which attending is offered. The card
 * is scanned and the presence is written exactly as usual, but the séance price
 * is NEVER taken off the student's balance — it is stored on the presence
 * (`waivedAmount`) so the school can see what the period cost it.
 */
export interface FreePeriod {
  id: string;
  /** short label shown on the card, e.g. "Semaine portes ouvertes" */
  name: string;
  description: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  /** covers every class (the default); otherwise only `classIds` */
  allClasses: boolean;
  classIds: string[];
  /** teachers still earn their percentage on an offered séance */
  payTeachers: boolean;
  /** suspends the period without losing its history */
  active: boolean;
  createdAt?: string;
}

/** Server-side totals of one free period (never truncated by a row limit). */
export interface FreePeriodStat {
  id: string;
  /** presences recorded during the period */
  presences: number;
  /** distinct students who benefited from it */
  students: number;
  /** what those presences would have cost the students = cost of the period */
  waived: number;
}

/** Weekly-absence billing switch for a single module. */
export interface ModuleAbsenceRule {
  moduleId: string;
  enabled: boolean;
  /** length of the absence window in days (7 = the default weekly rule) */
  daysWindow: number;
}

/**
 * How a student is billed. `normal` is the default; the four other cases are
 * ticked at creation:
 *  - `special`: free education, EMPLOI DU TEMPS PAR EMPLOI DU TEMPS — the
 *     modules listed in `freeSubscriptionIds` cost nothing (neither the school
 *     nor the teacher is paid for them) and the others are billed as usual,
 *  - `teacher_child`: the school is paid from the teacher-father's salary, not
 *     from the student directly (see `teacherFatherId`),
 *  - `reduction`: a reduction split between the school and the teacher (see
 *     `caseReduction`),
 *  - `school_only`: the school is paid, but the listed teachers are NOT paid for
 *     this student's presences (see `unpaidTeacherIds`).
 */
export type StudentCase = "normal" | "special" | "teacher_child" | "reduction" | "school_only";

/** A reduction split between the school and the teacher — each grants its own
 *  part, as a percentage or a fixed amount. */
export interface CaseReduction {
  type: DiscountType;
  /** the school's part of the reduction */
  schoolValue: number;
  /** the teacher's part of the reduction */
  teacherValue: number;
}

export interface Student {
  id: string;
  /** sequential registration number printed on the card and searchable from
   *  every roster ("00001", "00002" …). Assigned once, at creation. */
  registrationNumber?: string;
  firstName: string;
  lastName: string;
  birthDate: string;
  phone: string;
  /**
   * DEUXIÈME NUMÉRO DE LA FAMILLE — facultatif.
   *
   * Le premier numéro est celui qu'on compose, le second celui qu'on compose
   * quand le premier ne répond pas : la mère, l'oncle, le voisin. Il s'affiche
   * partout où le premier s'affiche (fiche, modification, listes) et n'est
   * jamais exigé — une fiche sans second numéro est une fiche complète.
   */
  phone2?: string;
  email: string;
  rfid: string;
  isFree: boolean;
  /** billing case — absent/"normal" means an ordinary paying student */
  studentCase?: StudentCase;
  /**
   * « Cas spécial (gratuit) »: WHICH emplois du temps are offered.
   *
   * La gratuité se coche emploi par emploi : un élève peut suivre trois modules
   * dont deux offerts et un payant. Les emplois listés ici ne coûtent rien —
   * ni à l'élève, ni à la charge de l'école, ni en part enseignant — et ceux
   * qui n'y sont pas sont facturés au tarif ordinaire.
   *
   * ABSENT = toute sa scolarité est offerte, exactement comme le cas se lisait
   * avant d'être détaillé : les fiches déjà en base ne changent pas de sens.
   */
  freeSubscriptionIds?: string[];
  /** teacher_child: the teacher whose salary settles this student */
  teacherFatherId?: string;
  /** reduction: how much the school and the teacher each knock off */
  caseReduction?: CaseReduction;
  /** school_only: teachers NOT paid for this student's presences */
  unpaidTeacherIds?: string[];
  /**
   * « École seulement » : SUR QUELS EMPLOIS DU TEMPS l'option est ACTIVE.
   *
   * Exactement comme la gratuité, l'option se coche emploi par emploi. Un élève
   * peut suivre trois modules dont un « école seule » et deux ordinaires : sur
   * l'emploi activé, la famille ne verse que la part de l'école, l'enseignant
   * n'est pas payé pour lui et il n'apparaît même pas sur l'écran de paie de cet
   * enseignant ; sur les deux autres, tout se calcule normalement.
   *
   * ABSENT = les fiches d'avant, pilotées par `unpaidTeacherIds` seul.
   */
  schoolOnlySubscriptionIds?: string[];
  /**
   * OÙ LA RÉCEPTION EN ÉTAIT quand elle a créé la fiche : le niveau (« classe »)
   * et l'année choisis dans le catalogue d'inscription.
   *
   * Un élève peut très bien être créé avec sa classe et son année SANS emploi du
   * temps — le créneau n'est pas encore ouvert, la famille hésite. Sans ces deux
   * champs, l'écran de modification rouvrait sur un primaire/1AP qui ne le
   * concernait pas et la réception devait retrouver la classe à la main.
   */
  enrollmentLevel?: string;
  enrollmentYear?: string;
  parentId?: string;
  subscriptionIds: string[];
  /** formation enrollments: start/expiry per subscription id */
  subscriptionDates?: Record<string, SubscriptionDates>;
  /** per-module reduction, keyed by subscription id */
  subscriptionDiscounts?: Record<string, SubscriptionDiscount>;
  /** outstanding one-time registration cost not yet settled */
  registrationDue?: number;
}

/**
 * ONE inscription of ONE student on ONE subscription (module), counted in
 * SÉANCES — not in money. Buying séances raises `paidSeances`; attending one
 * raises `consumedSeances`. What is left is simply the difference.
 */
export interface Enrollment {
  id: string;
  studentId: string;
  /** -> Subscription, which carries the price of one séance */
  subscriptionId: string;
  /** cumulative séances bought */
  paidSeances: number;
  /** séances used up by attendance */
  consumedSeances: number;
  // remaining = paidSeances - consumedSeances
  /** reduction granted on this module, applied by every price calculation */
  discount?: SubscriptionDiscount;
  startDate?: string;
  /** formations and monthly plans: past it, the card is refused and whatever is
   *  left on the counter is lost */
  expiryDate?: string;
  /** how the running period was sold ("seance" when absent) */
  plan?: SubscriptionPlan;
  /** monthly plan: séances the paid month includes. A renewal RESETS the
   *  counters to it — the unused séances of the previous month are not carried
   *  over, they expired with it. */
  monthSeances?: number;
  /**
   * MONEY left on this emploi du temps — the "solde" reception recharges and
   * every présence eats into. Credited by a payment, debited by the price of
   * one séance each time a présence (or a billable absence) is written. It may
   * go NEGATIVE: that is exactly the student's debt on this emploi.
   */
  balance?: number;
  createdAt: string;
}

export type PaymentType = "subscription_payment" | "debt_payment";

/**
 * WHERE the money of a movement came from:
 *  - `cash`: the family handed it over at the desk (the default),
 *  - `teacher_salary`: it was taken off a teacher-father's pay — no cash moved,
 *  - `teacher_debt`: the school credited a teacher-father's child NOW and
 *     booked what it cost ON THE FATHER, to be taken off his NEXT settlement
 *     (see `TeacherChildDebt`). No cash moved either: the school will simply
 *     hand him less. It is the deferred twin of `teacher_salary` — the child is
 *     settled today, the father pays for it on payday,
 *  - `school_cash`: the SCHOOL covered the student's debt out of its own
 *     caisse, so the teacher could be settled today. The caisse then carries
 *     both movements: the payment booked on the student, and the outflow that
 *     paid for it.
 */
export type PaymentSource = "cash" | "teacher_salary" | "teacher_debt" | "school_cash";

/**
 * One cash movement of a student: either a purchase of séances (with its
 * remise and the part left unpaid) or a settlement of an earlier debt.
 */
export interface Payment {
  id: string;
  studentId: string;
  enrollmentId?: string;
  /** the emploi du temps (subscription) this movement credits */
  subscriptionId?: string;
  /**
   * The emploi's OWN month cycle this movement belongs to ("M1", "M2" …).
   * Months are no longer calendar months: each emploi du temps counts its own,
   * opened by the first présence and closed by the last séance of the pack.
   */
  monthCode?: string;
  seancesPurchased: number;
  /** price of one séance at the time of the purchase */
  unitPrice: number;
  /** seancesPurchased × unitPrice — except on a monthly plan, where it is the
   *  price of the month pack (which may be cheaper than its séances) */
  grossTotal: number;
  /** the formula this purchase was made on ("seance" when absent) */
  plan?: SubscriptionPlan;
  discountType?: DiscountType;
  discountValue?: number;
  /** after the remise */
  netTotal: number;
  /** what the student actually handed over */
  amountPaid: number;
  /** netTotal − amountPaid: the debt this payment leaves behind */
  rest: number;
  type: PaymentType;
  /** where the money came from — "cash" (the family) when absent */
  paidFrom?: PaymentSource;
  date: string;
  description?: string;
}

/** Portal password kept so the payment receipt can print the student's login.
 *  Stored in a staff-only table — never readable by the student/parent. */
export interface StudentCredential {
  studentId: string;
  password: string;
  updatedAt: string;
}

/** One automatic weekly-absence charge: a module the student was absent on for
 *  a full 7-day window. It costs ONE séance off that inscription — the same
 *  currency attendance is counted in. */
export interface AbsencePenalty {
  id: string;
  studentId: string;
  subscriptionId?: string;
  sessionId?: string;
  moduleId?: string;
  /** first/last day of the absent 7-day window (YYYY-MM-DD) */
  periodStart: string;
  periodEnd: string;
  /** money value of the séance that was burnt — kept for the reports only */
  amount: number;
  /** séances left on that inscription once the penalty was applied */
  remainingAfter: number;
  createdAt: string;
}

/**
 * `cancelled` is the séance that did not happen for this student: it is written
 * on the sheet like the others, but nothing is consumed and nothing is taken
 * off his solde.
 */
export type AttendanceStatus = "present" | "late" | "absent" | "cancelled";
export interface AttendanceRecord {
  id: string;
  studentId: string;
  sessionId: string;
  timestamp: string;
  amountDeducted: number;
  status: AttendanceStatus;
  /** the student attended ANOTHER group of the same course (same class + module)
   *  than the one he is enrolled in — a "rattrapage" */
  substituteGroup?: boolean;
  /** the séance was offered by this free period (nothing was deducted) */
  freePeriodId?: string;
  /** the séance happened BEFORE the enrollment's start date: presence kept,
   *  balance untouched (the price sits in `waivedAmount`) */
  preStart?: boolean;
  /** the price that was NOT charged (free period or pre-start séance) — 0 on
   *  every ordinary presence */
  waivedAmount?: number;
  /**
   * The row costs NOTHING: no séance consumed, no solde debited, and it does
   * NOT advance the emploi's month cycle. Set on a cancelled séance and on the
   * very first record of a student that happens to be an absence (he never
   * attended this emploi yet, so his month has not started).
   */
  noCharge?: boolean;
}

export interface UnpaidTeacherSession {
  id: string;
  teacherId: string;
  sessionId: string;
  studentId: string;
  amount: number;
  date: string;
  paid: boolean;
  /** le règlement qui l'a soldée — annuler ce règlement la rend à nouveau due */
  paymentId?: string;
}

export interface TeacherAcompte {
  id: string;
  teacherId: string;
  amount: number;
  description: string;
  date: string;
  /** taken off a settlement already — it never comes back on the next one */
  paid?: boolean;
  paymentId?: string;
}

/**
 * A cost the school carries FOR one teacher (matériel, transport, avance de
 * frais …). It is deducted from his next settlement, exactly once: reception
 * types a name, an amount, an optional description and a date.
 */
export interface TeacherExpense {
  id: string;
  teacherId: string;
  name: string;
  amount: number;
  description?: string;
  date: string; // YYYY-MM-DD
  /** already taken off a settlement — it never reappears on the next one */
  paid?: boolean;
  paymentId?: string;
  createdAt?: string;
}
export interface TeacherAbsence {
  id: string;
  teacherId: string;
  cost: number;
  description: string;
  date: string;
}

export interface Subject {
  id: string;
  title: string;
  description: string;
  image?: string;
  sessionId: string;
  date: string;
}

export type Audience = "students" | "teachers" | "parents" | "all";
export interface Announcement {
  id: string;
  title: string;
  description: string;
  audience: Audience;
  endDate: string;
  date: string;
  /** empty = whole school; otherwise only these groups (and, when
   *  includeParents is on, the parents of their students) */
  targetGroupIds?: string[];
  includeParents?: boolean;
}

export interface ExpenseCategory {
  id: string;
  name: string;
}
export interface Expense {
  id: string;
  name: string;
  /** absent = dépense non classée; the column is a foreign key, so it is left
   *  empty rather than pointing at a category that does not exist */
  categoryId?: string;
  amount: number;
  date: string;
}

export type CashTxType =
  | "deposit"
  | "withdraw"
  | "expense"
  | "student_payment"
  | "teacher_payment"
  | "acompte"
  /** the school covered a student's debt from its own money: the outflow that
   *  balances the `student_payment` booked on that student */
  | "student_debt";
export interface CashTransaction {
  id: string;
  type: CashTxType;
  amount: number; // signed
  date: string;
  description: string;
}

export interface Parent {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  childIds: string[];
}

export interface Notification {
  id: string;
  parentId: string;
  title: string;
  description: string;
  date: string;
  read: boolean;
  auto: boolean;
}

export type CourseworkType = "single" | "period";
export interface Coursework {
  id: string;
  name: string;
  type: CourseworkType;
  dates: string[];
  pricePerSession: number;
  total: number;
  teacherId: string;
}

export interface IndependentSession {
  id: string;
  studentId?: string;
  passagerName?: string;
  itemLabel: string;
  price: number;
  date: string;
  /** séance libre timing this attendance belongs to (drives the teacher payout) */
  sessionId?: string;
  startTime?: string;
  endTime?: string;
  createdAt?: string;
  /** the teacher has already been settled for this passager's séance — a
   *  créneau attended only by passagers has no unpaid_teacher_sessions row */
  teacherPaid?: boolean;
}

/**
 * A "séance libre de groupe": one ponctual séance sold to a WHOLE group of
 * students at once, without naming any of them.
 *
 * Reception picks the teacher, the day and the hours, names the séance, types
 * how many students came, what one of them pays and how much of that the
 * school keeps. Everything else is arithmetic:
 *
 *     part enseignant d'un élève = prix élève − part école
 *     total encaissé  = élèves × prix élève
 *     total école     = élèves × part école
 *     total enseignant= élèves × part enseignant
 *
 * Creating one posts BOTH cash movements (the money in, the teacher's pay out),
 * so the caisse and the rapports read it like any other séance — and editing or
 * deleting the row moves those two movements with it. The teacher's fiche de
 * paie prints the séance WITHOUT ever showing the school's share.
 */
export interface GroupSeance {
  id: string;
  teacherId: string;
  /** what the séance is called on every document */
  title: string;
  description?: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  /** how many students attended */
  studentsCount: number;
  /** what ONE student pays for the séance */
  pricePerStudent: number;
  /** how much of that ONE price the school keeps */
  schoolPerStudent: number;
  /** the cash movement that booked the money in — rewritten on every edit */
  cashInId?: string;
  /** the cash movement that paid the teacher */
  cashOutId?: string;
  createdAt: string;
}
