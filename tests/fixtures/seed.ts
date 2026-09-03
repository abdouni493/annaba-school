/**
 * Test fixture — a complete, self-consistent `Database` used by the unit tests
 * only. The application itself ships NO constant data: it reads everything from
 * Supabase (`supabase/schema.sql`).
 *
 * `buildSeed()` returns a brand-new `Database` on every call so a test can
 * reset the store without leaking mutations into the next one.
 *
 * Ids are stable, readable strings (`stu-1`, `ses-3`, …) so the seeded relations
 * are easy to follow. Dates and weekdays are computed relative to *today*, which
 * guarantees the planner, the attendance sheet and the scanner always have live
 * séances to work with.
 */
import { monthlyExpiry } from "@/lib/helpers";
import type { Database } from "@/lib/store/data";
import type { Day } from "@/lib/types";

// ---------------------------------------------------------------------------
// Small date helpers (local time, YYYY-MM-DD — same convention as lib/helpers)
// ---------------------------------------------------------------------------
const JS_DAYS: Day[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

function iso(d: Date): string {
  return d.toLocaleDateString("fr-CA");
}

function shiftDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return iso(d);
}

/** ISO timestamp at `hhmm` (HH:mm), `days` away from today. */
function stamp(days: number, hhmm: string): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const [h, m] = hhmm.split(":").map(Number);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

/** Weekday name `n` days from today — lets the seed guarantee live séances. */
function weekday(n = 0): Day {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return JS_DAYS[d.getDay()];
}

const TODAY = weekday(0);

export function buildSeed(): Database {
  return normalise(rawSeed());
}

/**
 * Brings the hand-written demo data in line with the current model, so the seed
 * itself stays readable:
 *  - every élève gets his sequential registration number (00001, 00002 …),
 *  - every emploi du temps gets a monthly pack (it is what opens and closes the
 *    M1 / M2 months of its students),
 *  - every inscription gets its money SOLDE, derived from the séances it was
 *    seeded with,
 *  - every purchase is attributed to its emploi and to the month it fell in.
 */
function normalise(db: Database): Database {
  db.students = db.students.map((s, i) => ({
    ...s,
    registrationNumber: s.registrationNumber ?? String(i + 1).padStart(5, "0"),
  }));

  db.subscriptions = db.subscriptions.map((sub) => {
    if ((sub.monthlySeances ?? 0) > 0) return sub;
    const seances = 8;
    const monthlyPrice = Math.round(sub.pricePerSession * seances * 0.9);
    const schoolMonthShare = Math.round(monthlyPrice * 0.55);
    return {
      ...sub,
      monthlySeances: seances,
      monthlyPrice,
      schoolMonthShare,
      teacherPerSeance: Math.round((monthlyPrice - schoolMonthShare) / seances),
    };
  });

  // A purchase belongs to the emploi it credited, on the month the student was
  // walking through when it was made.
  db.payments = db.payments.map((p) => {
    if (p.subscriptionId || !p.enrollmentId) return p;
    const enr = db.enrollments.find((e) => e.id === p.enrollmentId);
    if (!enr) return p;
    const sub = db.subscriptions.find((x) => x.id === enr.subscriptionId);
    const size = Math.max(1, sub?.monthlySeances ?? 4);
    const before = db.attendance.filter(
      (a) =>
        a.studentId === p.studentId &&
        a.sessionId === sub?.sessionId &&
        a.status !== "cancelled" &&
        !a.noCharge &&
        a.timestamp <= p.date,
    ).length;
    return {
      ...p,
      subscriptionId: enr.subscriptionId,
      monthCode: `M${Math.floor(before / size) + 1}`,
    };
  });

  // The SOLDE is what was handed over minus what the séances ate. It has to be
  // derived from the very rows the month ledger reads, or the card and the
  // month-by-month breakdown of the same inscription would disagree.
  db.enrollments = db.enrollments.map((e) => {
    const sub = db.subscriptions.find((x) => x.id === e.subscriptionId);
    const credited = db.payments
      .filter((p) => p.studentId === e.studentId && p.subscriptionId === e.subscriptionId)
      .reduce((t, p) => t + p.amountPaid, 0);
    const consumed = db.attendance
      .filter(
        (a) =>
          a.studentId === e.studentId &&
          a.sessionId === sub?.sessionId &&
          a.status !== "cancelled" &&
          !a.noCharge,
      )
      .reduce((t, a) => t + (a.amountDeducted || 0), 0);
    const balance = credited - consumed;
    const unit = Math.max(1, sub?.pricePerSession ?? 1);
    return {
      ...e,
      balance,
      // Keep the legacy séance counter in step with the money, so the screens
      // that still count séances read something coherent.
      paidSeances: e.consumedSeances + Math.max(0, Math.floor(balance / unit)),
    };
  });

  return db;
}

function rawSeed(): Database {
  return {
    // -----------------------------------------------------------------------
    school: {
      id: "sch-1",
      name: "ALTECH SCHOOL",
      description: "École privée — cours de soutien et formations",
      phone: "0550 12 34 56",
      email: "contact@altech-school.dz",
      address: "12 Rue des Frères Bouadou, Alger",
      articleFiscal: "16/2024/0012",
      registreCommerce: "16 B 0987654",
      nif: "000916098765432",
      nis: "000916098765400",
      registrationFee: 2000,
      // Off in the demo: the automatic weekly-absence billing would otherwise
      // rewrite the seeded figures on every staff login.
      absencePenaltyEnabled: false,
      absencePenaltySince: shiftDays(-60),
      absenceWeekStartDay: 5,
    },

    // -----------------------------------------------------------------------
    classCategories: [
      { id: "cat-1", name: "Groupe Matin" },
      { id: "cat-2", name: "Groupe Après-midi" },
      { id: "cat-3", name: "Bilingue" },
    ],

    modules: [
      { id: "mod-1", name: "Mathématiques" },
      { id: "mod-2", name: "Physique" },
      { id: "mod-3", name: "Anglais" },
      { id: "mod-4", name: "Français" },
    ],

    groups: [
      { id: "grp-1", name: "Groupe A" },
      { id: "grp-2", name: "Groupe B" },
      { id: "grp-3", name: "Groupe C" },
    ],

    salles: [
      { id: "sal-1", name: "Salle 1" },
      { id: "sal-2", name: "Salle 2" },
      { id: "sal-3", name: "Salle 3" },
    ],

    classes: [
      {
        id: "cls-1",
        type: "cours",
        name: "3ème AS",
        description: "Terminale — préparation au baccalauréat",
        coursLevel: "lycee",
        year: "3AS",
      },
      {
        id: "cls-2",
        type: "cours",
        name: "4ème AM",
        description: "Quatrième année moyenne — préparation au BEM",
        coursLevel: "moyen",
        year: "4AM",
      },
      {
        id: "cls-3",
        type: "formation",
        name: "Anglais Général",
        description: "Formation en anglais, niveau intermédiaire",
        formationLevel: "B1",
      },
      {
        id: "cls-4",
        type: "cours",
        name: "Maternelle · Grande section · Groupe Matin",
        description: "Éveil et préparation à la 1ère année primaire",
        coursLevel: "maternelle",
        year: "Grande section",
        categoryId: "cat-1",
      },
    ],

    // -----------------------------------------------------------------------
    teachers: [
      {
        id: "tea-1",
        firstName: "Karim",
        lastName: "Bensalah",
        phone: "0661 22 33 44",
        email: "karim.bensalah@altech-school.dz",
        paymentType: "percentage",
        percentage: 60,
        startDate: shiftDays(-400),
      },
      {
        id: "tea-2",
        firstName: "Amina",
        lastName: "Haddad",
        phone: "0770 55 66 77",
        email: "amina.haddad@altech-school.dz",
        paymentType: "percentage",
        percentage: 50,
        startDate: shiftDays(-240),
      },
      {
        id: "tea-3",
        firstName: "Sofiane",
        lastName: "Meziane",
        phone: "0555 88 99 00",
        email: "sofiane.meziane@altech-school.dz",
        paymentType: "monthly",
        monthlyAmount: 45000,
        startDate: shiftDays(-180),
      },
      {
        id: "tea-4",
        firstName: "Nadia",
        lastName: "Cherif",
        phone: "0699 11 22 33",
        email: "nadia.cherif@altech-school.dz",
        paymentType: "percentage",
        percentage: 55,
        isPassager: true,
        startDate: shiftDays(-45),
      },
    ],

    teacherPayments: [
      {
        id: "tpy-1",
        teacherId: "tea-1",
        amount: 18000,
        method: "percent",
        percentage: 60,
        studentsCount: 24,
        sessionsCount: 4,
        description: "Règlement séances Karim Bensalah",
        details: [
          {
            dateKey: shiftDays(-21),
            sessionId: "ses-1",
            title: "Mathématiques · Groupe A",
            moduleName: "Mathématiques",
            groupName: "Groupe A",
            startTime: "08:00",
            endTime: "10:00",
            presents: 6,
            passagers: 0,
            gross: 3600,
            share: 2160,
          },
        ],
        paidAt: stamp(-20, "17:00"),
      },
    ],

    reception: [
      {
        id: "rec-1",
        firstName: "Yasmine",
        lastName: "Belkacem",
        phone: "0771 44 55 66",
        email: "yasmine.belkacem@altech-school.dz",
        paymentType: "monthly",
        startDate: shiftDays(-300),
        salary: 35000,
        role: "reception",
      },
      {
        id: "rec-2",
        firstName: "Omar",
        lastName: "Slimani",
        phone: "0660 77 88 99",
        email: "omar.slimani@altech-school.dz",
        paymentType: "hourly",
        startDate: shiftDays(-90),
        salary: 0,
        role: "security",
        rfid: "WRK-001",
        hourlyRate: 400,
      },
    ],

    workerShifts: [
      {
        id: "wsh-1",
        workerId: "rec-2",
        workDate: shiftDays(-2),
        startAt: stamp(-2, "08:00"),
        endAt: stamp(-2, "16:00"),
        minutes: 480,
        frozen: false,
        paid: false,
        createdAt: stamp(-2, "08:00"),
      },
      {
        id: "wsh-2",
        workerId: "rec-2",
        workDate: shiftDays(-1),
        startAt: stamp(-1, "08:15"),
        endAt: stamp(-1, "15:45"),
        minutes: 450,
        frozen: false,
        paid: false,
        createdAt: stamp(-1, "08:15"),
      },
    ],

    // -----------------------------------------------------------------------
    // Timings — every one of them runs today or within the next three days.
    sessions: [
      {
        id: "ses-1",
        classId: "cls-1",
        moduleId: "mod-1",
        groupId: "grp-1",
        salleId: "sal-1",
        teacherId: "tea-1",
        days: [TODAY, weekday(2)],
        startTime: "08:00",
        endTime: "10:00",
      },
      {
        id: "ses-2",
        classId: "cls-1",
        moduleId: "mod-1",
        groupId: "grp-2",
        salleId: "sal-2",
        teacherId: "tea-1",
        days: [TODAY, weekday(3)],
        startTime: "10:00",
        endTime: "12:00",
      },
      {
        id: "ses-3",
        classId: "cls-1",
        moduleId: "mod-2",
        groupId: "grp-1",
        salleId: "sal-1",
        teacherId: "tea-2",
        days: [TODAY, weekday(2)],
        startTime: "14:00",
        endTime: "16:00",
      },
      {
        id: "ses-4",
        classId: "cls-2",
        moduleId: "mod-4",
        groupId: "grp-3",
        salleId: "sal-3",
        teacherId: "tea-3",
        days: [weekday(1), weekday(3)],
        startTime: "09:00",
        endTime: "11:00",
      },
      {
        id: "ses-5",
        classId: "cls-3",
        moduleId: "mod-3",
        groupId: "grp-1",
        salleId: "sal-2",
        teacherId: "tea-2",
        days: [TODAY, weekday(3)],
        startTime: "16:00",
        endTime: "18:00",
      },
      {
        id: "ses-6",
        classId: "cls-1",
        moduleId: "mod-2",
        groupId: "grp-3",
        salleId: "sal-3",
        teacherId: "tea-4",
        days: [TODAY, weekday(1), weekday(2)],
        startTime: "18:00",
        endTime: "20:00",
        isOpen: true,
        title: "Séance libre — Révision Physique",
        periodStart: shiftDays(-15),
        periodEnd: shiftDays(45),
        classIds: ["cls-1", "cls-2"],
        groupIds: ["grp-1", "grp-2", "grp-3"],
        salleIds: ["sal-3"],
        openPrice: 800,
      },
    ],

    // Prices are per SÉANCE; a cours may also be sold as a whole month (a fixed
    // pack of séances at a fixed price, usually cheaper than the same séances
    // bought one by one). The formation additionally carries its level price.
    subscriptions: [
      {
        id: "sub-1",
        sessionId: "ses-1",
        pricePerSession: 600,
        monthlySeances: 8,
        monthlyPrice: 4200, // au lieu de 4800 à l'unité
        schoolMonthShare: 2200, // école 2200, enseignant 2000
        teacherPerSeance: 250, // 2000 ÷ 8
      },
      { id: "sub-2", sessionId: "ses-2", pricePerSession: 600 },
      { id: "sub-3", sessionId: "ses-3", pricePerSession: 700 },
      {
        id: "sub-4",
        sessionId: "ses-4",
        pricePerSession: 500,
        monthlySeances: 8,
        monthlyPrice: 3600, // au lieu de 4000 à l'unité
        schoolMonthShare: 1600, // école 1600, enseignant 2000
        teacherPerSeance: 250, // 2000 ÷ 8
      },
      {
        id: "sub-5",
        sessionId: "ses-5",
        pricePerSession: 900,
        levelPrice: 36000,
        periodMonths: 6,
      },
      { id: "sub-6", sessionId: "ses-6", pricePerSession: 800 },
    ],

    freePeriods: [
      {
        id: "frp-1",
        name: "Semaine portes ouvertes",
        description: "Séances offertes à toutes les classes pendant la rentrée",
        startDate: shiftDays(-40),
        endDate: shiftDays(-34),
        allClasses: true,
        classIds: [],
        payTeachers: true,
        active: false,
        createdAt: stamp(-45, "09:00"),
      },
    ],

    // -----------------------------------------------------------------------
    students: [
      {
        id: "stu-1",
        firstName: "Yacine",
        lastName: "Amrani",
        birthDate: "2007-03-14",
        phone: "0550 10 10 10",
        email: "yacine.amrani@eleve.altech-school.dz",
        rfid: "RFID-1001",
        isFree: false,
        parentId: "par-1",
        subscriptionIds: ["sub-1", "sub-3"],
        subscriptionDates: {
          "sub-1": { subscribedAt: shiftDays(-70), startDate: shiftDays(-70) },
          "sub-3": { subscribedAt: shiftDays(-70), startDate: shiftDays(-70) },
        },
        registrationDue: 0,
      },
      {
        id: "stu-2",
        firstName: "Lina",
        lastName: "Amrani",
        birthDate: "2009-11-02",
        phone: "0550 10 10 11",
        email: "lina.amrani@eleve.altech-school.dz",
        rfid: "RFID-1002",
        isFree: false,
        parentId: "par-1",
        subscriptionIds: ["sub-4"],
        subscriptionDates: {
          "sub-4": { subscribedAt: shiftDays(-55), startDate: shiftDays(-55) },
        },
        registrationDue: 0,
      },
      {
        id: "stu-3",
        firstName: "Mehdi",
        lastName: "Bouzid",
        birthDate: "2006-06-21",
        phone: "0550 10 10 12",
        email: "mehdi.bouzid@eleve.altech-school.dz",
        rfid: "RFID-1003",
        isFree: false,
        parentId: "par-2",
        subscriptionIds: ["sub-2", "sub-5"],
        subscriptionDates: {
          "sub-2": { subscribedAt: shiftDays(-80), startDate: shiftDays(-80) },
          "sub-5": {
            subscribedAt: shiftDays(-170),
            startDate: shiftDays(-170),
            expiryDate: shiftDays(4),
          },
        },
        subscriptionDiscounts: { "sub-2": { type: "percent", value: 10 } },
        registrationDue: 0,
      },
      {
        id: "stu-4",
        firstName: "Sarah",
        lastName: "Khelifi",
        birthDate: "2008-01-30",
        phone: "0550 10 10 13",
        email: "sarah.khelifi@eleve.altech-school.dz",
        rfid: "RFID-1004",
        isFree: false,
        parentId: "par-2",
        subscriptionIds: ["sub-1", "sub-5"],
        subscriptionDates: {
          // Abonnement mensuel en cours : renouvelé il y a 6 jours.
          "sub-1": {
            subscribedAt: shiftDays(-30),
            startDate: shiftDays(-6),
            expiryDate: monthlyExpiry(shiftDays(-6)),
            plan: "month",
          },
          "sub-5": {
            subscribedAt: shiftDays(-200),
            startDate: shiftDays(-200),
            expiryDate: shiftDays(-5),
          },
        },
        registrationDue: 0,
      },
      {
        id: "stu-5",
        firstName: "Anis",
        lastName: "Ferhat",
        birthDate: "2007-09-09",
        phone: "0550 10 10 14",
        email: "anis.ferhat@eleve.altech-school.dz",
        rfid: "RFID-1005",
        isFree: true,
        parentId: "par-3",
        subscriptionIds: ["sub-3"],
        subscriptionDates: {
          "sub-3": { subscribedAt: shiftDays(-60), startDate: shiftDays(-60) },
        },
        registrationDue: 0,
      },
      {
        id: "stu-6",
        firstName: "Ines",
        lastName: "Boulahia",
        birthDate: "2009-04-17",
        phone: "0550 10 10 15",
        email: "ines.boulahia@eleve.altech-school.dz",
        rfid: "RFID-1006",
        isFree: false,
        subscriptionIds: ["sub-4", "sub-6"],
        subscriptionDates: {
          // Mois échu il y a quelques jours : ses séances restantes sont perdues
          // et sa carte est refusée sur ce module jusqu'au renouvellement.
          "sub-4": {
            subscribedAt: shiftDays(-40),
            startDate: shiftDays(-38),
            expiryDate: monthlyExpiry(shiftDays(-38)),
            plan: "month",
          },
          "sub-6": { subscribedAt: shiftDays(-12), startDate: shiftDays(-12) },
        },
        subscriptionDiscounts: { "sub-4": { type: "amount", value: 100 } },
        registrationDue: 0,
      },
      {
        id: "stu-7",
        firstName: "Rayan",
        lastName: "Ould Ali",
        birthDate: "2006-12-05",
        phone: "0550 10 10 16",
        email: "rayan.ouldali@eleve.altech-school.dz",
        rfid: "RFID-1007",
        isFree: false,
        parentId: "par-3",
        subscriptionIds: ["sub-2"],
        subscriptionDates: {
          "sub-2": { subscribedAt: shiftDays(-8), startDate: shiftDays(-8) },
        },
        registrationDue: 2000,
      },
      {
        id: "stu-8",
        firstName: "Malak",
        lastName: "Zerrouki",
        birthDate: "2008-08-23",
        phone: "0550 10 10 17",
        email: "malak.zerrouki@eleve.altech-school.dz",
        rfid: "RFID-1008",
        isFree: true,
        subscriptionIds: ["sub-5"],
        subscriptionDates: {
          "sub-5": {
            subscribedAt: shiftDays(-20),
            startDate: shiftDays(-20),
            expiryDate: shiftDays(160),
          },
        },
        registrationDue: 0,
      },
    ],

    studentCredentials: [
      { studentId: "stu-1", password: "demo1234", updatedAt: stamp(-70, "10:00") },
      { studentId: "stu-3", password: "demo1234", updatedAt: stamp(-80, "10:00") },
    ],

    moduleAbsenceRules: [
      { moduleId: "mod-1", enabled: true, daysWindow: 7 },
      { moduleId: "mod-3", enabled: false, daysWindow: 7 },
    ],

    // -----------------------------------------------------------------------
    // Inscriptions counted in SÉANCES. The set deliberately covers every state
    // the UI has to surface: comfortable, nearly exhausted, exhausted, expired,
    // about to expire, and a student who still owes money.
    enrollments: [
      // Yacine — well stocked on both his modules.
      {
        id: "enr-1",
        studentId: "stu-1",
        subscriptionId: "sub-1",
        paidSeances: 12,
        consumedSeances: 5,
        startDate: shiftDays(-70),
        createdAt: stamp(-70, "09:00"),
      },
      {
        id: "enr-2",
        studentId: "stu-1",
        subscriptionId: "sub-3",
        paidSeances: 8,
        consumedSeances: 7,
        startDate: shiftDays(-70),
        createdAt: stamp(-70, "09:05"),
      },
      // Lina — down to her last two séances.
      {
        id: "enr-3",
        studentId: "stu-2",
        subscriptionId: "sub-4",
        paidSeances: 10,
        consumedSeances: 8,
        discount: { type: "percent", value: 5 },
        startDate: shiftDays(-55),
        createdAt: stamp(-55, "10:00"),
      },
      // Mehdi — owes money, and his formation expires in a few days.
      {
        id: "enr-4",
        studentId: "stu-3",
        subscriptionId: "sub-2",
        paidSeances: 8,
        consumedSeances: 8,
        discount: { type: "percent", value: 10 },
        startDate: shiftDays(-80),
        createdAt: stamp(-80, "11:00"),
      },
      {
        id: "enr-5",
        studentId: "stu-3",
        subscriptionId: "sub-5",
        paidSeances: 24,
        consumedSeances: 19,
        startDate: shiftDays(-170),
        expiryDate: shiftDays(4),
        createdAt: stamp(-170, "11:05"),
      },
      // Sarah — un abonnement MENSUEL en cours, et une formation déjà expirée.
      {
        id: "enr-6",
        studentId: "stu-4",
        subscriptionId: "sub-1",
        paidSeances: 8,
        consumedSeances: 3,
        plan: "month",
        monthSeances: 8,
        startDate: shiftDays(-6),
        expiryDate: monthlyExpiry(shiftDays(-6)),
        createdAt: stamp(-30, "09:30"),
      },
      {
        id: "enr-7",
        studentId: "stu-4",
        subscriptionId: "sub-5",
        paidSeances: 24,
        consumedSeances: 24,
        startDate: shiftDays(-200),
        expiryDate: shiftDays(-5),
        createdAt: stamp(-200, "09:35"),
      },
      // Anis — élève gratuit: séances are recorded but never consumed.
      {
        id: "enr-8",
        studentId: "stu-5",
        subscriptionId: "sub-3",
        paidSeances: 0,
        consumedSeances: 0,
        startDate: shiftDays(-60),
        createdAt: stamp(-60, "14:00"),
      },
      // Ines — un mois ÉCHU avec des séances non consommées (elles sont perdues,
      // la carte est refusée) + un pack de séances libres.
      {
        id: "enr-9",
        studentId: "stu-6",
        subscriptionId: "sub-4",
        paidSeances: 8,
        consumedSeances: 6,
        plan: "month",
        monthSeances: 8,
        discount: { type: "amount", value: 100 },
        startDate: shiftDays(-38),
        expiryDate: monthlyExpiry(shiftDays(-38)),
        createdAt: stamp(-38, "09:00"),
      },
      {
        id: "enr-10",
        studentId: "stu-6",
        subscriptionId: "sub-6",
        paidSeances: 5,
        consumedSeances: 1,
        startDate: shiftDays(-12),
        createdAt: stamp(-12, "18:00"),
      },
      // Rayan — bought a small pack and left most of it unpaid.
      {
        id: "enr-11",
        studentId: "stu-7",
        subscriptionId: "sub-2",
        paidSeances: 4,
        consumedSeances: 1,
        startDate: shiftDays(-8),
        createdAt: stamp(-8, "10:00"),
      },
      // Malak — gratuite, formation valid for a long while yet.
      {
        id: "enr-12",
        studentId: "stu-8",
        subscriptionId: "sub-5",
        paidSeances: 0,
        consumedSeances: 0,
        startDate: shiftDays(-20),
        expiryDate: shiftDays(160),
        createdAt: stamp(-20, "16:00"),
      },
    ],

    payments: [
      {
        id: "pay-1",
        studentId: "stu-1",
        enrollmentId: "enr-1",
        seancesPurchased: 12,
        unitPrice: 600,
        grossTotal: 7200,
        netTotal: 7200,
        amountPaid: 7200,
        rest: 0,
        type: "subscription_payment",
        date: stamp(-70, "09:00"),
        description: "Pack 12 séances — Mathématiques",
      },
      {
        id: "pay-2",
        studentId: "stu-1",
        enrollmentId: "enr-2",
        seancesPurchased: 8,
        unitPrice: 700,
        grossTotal: 5600,
        netTotal: 5600,
        amountPaid: 5600,
        rest: 0,
        type: "subscription_payment",
        date: stamp(-70, "09:05"),
        description: "Pack 8 séances — Physique",
      },
      {
        id: "pay-3",
        studentId: "stu-2",
        enrollmentId: "enr-3",
        seancesPurchased: 10,
        unitPrice: 500,
        grossTotal: 5000,
        discountType: "percent",
        discountValue: 5,
        netTotal: 4750,
        amountPaid: 4750,
        rest: 0,
        type: "subscription_payment",
        date: stamp(-55, "10:00"),
        description: "Pack 10 séances — Français",
      },
      // Mehdi: 8 séances bought, only part of it paid -> outstanding debt.
      {
        id: "pay-4",
        studentId: "stu-3",
        enrollmentId: "enr-4",
        seancesPurchased: 8,
        unitPrice: 600,
        grossTotal: 4800,
        discountType: "percent",
        discountValue: 10,
        netTotal: 4320,
        amountPaid: 3420,
        rest: 900,
        type: "subscription_payment",
        date: stamp(-80, "11:00"),
        description: "Pack 8 séances — Mathématiques (Groupe B)",
      },
      {
        id: "pay-5",
        studentId: "stu-3",
        enrollmentId: "enr-5",
        seancesPurchased: 24,
        unitPrice: 900,
        grossTotal: 21600,
        discountType: "amount",
        discountValue: 1600,
        netTotal: 20000,
        amountPaid: 20000,
        rest: 0,
        type: "subscription_payment",
        date: stamp(-170, "11:05"),
        description: "Formation Anglais B1 — 24 séances",
      },
      {
        id: "pay-6",
        studentId: "stu-4",
        enrollmentId: "enr-6",
        seancesPurchased: 8,
        unitPrice: 600,
        grossTotal: 4200, // prix du mois, au lieu de 4800 à l'unité
        netTotal: 4200,
        amountPaid: 4200,
        rest: 0,
        type: "subscription_payment",
        plan: "month",
        date: stamp(-6, "09:30"),
        description: `Abonnement mensuel (8 séances) — Mathématiques — jusqu'au ${monthlyExpiry(shiftDays(-6))}`,
      },
      {
        id: "pay-7",
        studentId: "stu-4",
        enrollmentId: "enr-7",
        seancesPurchased: 24,
        unitPrice: 900,
        grossTotal: 21600,
        netTotal: 21600,
        amountPaid: 21600,
        rest: 0,
        type: "subscription_payment",
        date: stamp(-200, "09:35"),
        description: "Formation Anglais B1 — 24 séances",
      },
      {
        id: "pay-8",
        studentId: "stu-6",
        enrollmentId: "enr-9",
        seancesPurchased: 8,
        unitPrice: 500,
        grossTotal: 3600, // prix du mois, au lieu de 4000 à l'unité
        discountType: "amount",
        discountValue: 100,
        netTotal: 3500,
        amountPaid: 3500,
        rest: 0,
        type: "subscription_payment",
        plan: "month",
        date: stamp(-38, "09:00"),
        description: `Abonnement mensuel (8 séances) — Français — jusqu'au ${monthlyExpiry(shiftDays(-38))}`,
      },
      {
        id: "pay-9",
        studentId: "stu-6",
        enrollmentId: "enr-10",
        seancesPurchased: 5,
        unitPrice: 800,
        grossTotal: 4000,
        netTotal: 4000,
        amountPaid: 4000,
        rest: 0,
        type: "subscription_payment",
        date: stamp(-12, "18:00"),
        description: "Pack 5 séances libres — Révision Physique",
      },
      // Rayan: mostly unpaid -> the card shows a debt alert.
      {
        id: "pay-10",
        studentId: "stu-7",
        enrollmentId: "enr-11",
        seancesPurchased: 4,
        unitPrice: 600,
        grossTotal: 2400,
        netTotal: 2400,
        amountPaid: 700,
        rest: 1700,
        type: "subscription_payment",
        date: stamp(-8, "10:00"),
        description: "Pack 4 séances — Mathématiques (Groupe B)",
      },
    ],

    // Aucun frais au départ : les tests qui en ont besoin les créent eux-mêmes,
    // par l'action du magasin, comme le fait la réception.
    studentCharges: [],

    // -----------------------------------------------------------------------
    attendance: [
      {
        id: "att-1",
        studentId: "stu-1",
        sessionId: "ses-1",
        timestamp: stamp(-7, "08:05"),
        amountDeducted: 600,
        status: "present",
      },
      {
        id: "att-2",
        studentId: "stu-3",
        sessionId: "ses-2",
        timestamp: stamp(-6, "10:05"),
        amountDeducted: 540,
        status: "present",
      },
      {
        id: "att-3",
        studentId: "stu-4",
        sessionId: "ses-1",
        timestamp: stamp(-7, "08:40"),
        amountDeducted: 600,
        status: "late",
      },
      {
        id: "att-4",
        studentId: "stu-5",
        sessionId: "ses-3",
        timestamp: stamp(-5, "14:03"),
        amountDeducted: 0,
        status: "present",
      },
    ],

    absencePenalties: [],

    unpaidTeacher: [
      {
        id: "utp-1",
        teacherId: "tea-1",
        sessionId: "ses-1",
        studentId: "stu-1",
        amount: 360,
        date: stamp(-7, "08:05"),
        paid: false,
      },
      {
        id: "utp-2",
        teacherId: "tea-1",
        sessionId: "ses-1",
        studentId: "stu-4",
        amount: 360,
        date: stamp(-7, "08:40"),
        paid: false,
      },
      {
        id: "utp-3",
        teacherId: "tea-1",
        sessionId: "ses-2",
        studentId: "stu-3",
        amount: 324,
        date: stamp(-6, "10:05"),
        paid: false,
      },
      {
        id: "utp-4",
        teacherId: "tea-2",
        sessionId: "ses-3",
        studentId: "stu-5",
        amount: 0,
        date: stamp(-5, "14:03"),
        paid: false,
      },
    ],

    acomptes: [
      {
        id: "acp-1",
        teacherId: "tea-1",
        amount: 5000,
        description: "Acompte sur salaire",
        date: stamp(-10, "12:00"),
        paid: false,
      },
    ],

    // Costs the school carried FOR a teacher — taken off his next settlement.
    teacherExpenses: [
      {
        id: "tex-1",
        teacherId: "tea-1",
        name: "Photocopies de séries d'exercices",
        amount: 1800,
        description: "3 séries · 40 élèves",
        date: shiftDays(-8),
        paid: false,
        createdAt: stamp(-8, "10:30"),
      },
      {
        id: "tex-2",
        teacherId: "tea-1",
        name: "Transport (déplacement examen blanc)",
        amount: 1200,
        date: shiftDays(-4),
        paid: false,
        createdAt: stamp(-4, "17:00"),
      },
    ],

    absences: [
      {
        id: "tab-1",
        teacherId: "tea-2",
        cost: 1200,
        description: "Séance non assurée",
        date: stamp(-12, "14:00"),
      },
    ],

    // -----------------------------------------------------------------------
    subjects: [
      {
        id: "suj-1",
        title: "Série d'exercices — Suites numériques",
        description: "Exercices 1 à 12, à rendre pour la prochaine séance.",
        sessionId: "ses-1",
        date: stamp(-4, "18:00"),
      },
      {
        id: "suj-2",
        title: "TP — Lois de Newton",
        description: "Compte-rendu du TP réalisé en salle 1.",
        sessionId: "ses-3",
        date: stamp(-3, "17:00"),
      },
    ],

    announcements: [
      {
        id: "ann-1",
        title: "Reprise des cours",
        description: "Les cours reprennent normalement cette semaine.",
        audience: "all",
        endDate: shiftDays(14),
        date: stamp(-2, "09:00"),
        targetGroupIds: [],
        includeParents: true,
      },
      {
        id: "ann-2",
        title: "Réunion parents — 3ème AS",
        description: "Réunion avec les parents des élèves de 3ème AS samedi à 10h.",
        audience: "parents",
        endDate: shiftDays(7),
        date: stamp(-1, "16:00"),
        targetGroupIds: ["grp-1"],
        includeParents: true,
      },
    ],

    categories: [
      { id: "cat-1", name: "Loyer" },
      { id: "cat-2", name: "Électricité & Eau" },
      { id: "cat-3", name: "Fournitures" },
    ],

    expenses: [
      { id: "exp-1", name: "Loyer du mois", categoryId: "cat-1", amount: 60000, date: stamp(-18, "10:00") },
      { id: "exp-2", name: "Facture Sonelgaz", categoryId: "cat-2", amount: 9500, date: stamp(-11, "10:00") },
      { id: "exp-3", name: "Ramettes de papier", categoryId: "cat-3", amount: 3200, date: stamp(-5, "10:00") },
    ],

    cash: [
      { id: "csh-1", type: "deposit", amount: 50000, date: stamp(-45, "09:00"), description: "Fonds de caisse" },
      { id: "csh-2", type: "student_payment", amount: 6000, date: stamp(-30, "09:30"), description: "Versement Yacine Amrani" },
      { id: "csh-3", type: "student_payment", amount: 3000, date: stamp(-25, "11:00"), description: "Versement Mehdi Bouzid" },
      { id: "csh-4", type: "student_payment", amount: 9000, date: stamp(-15, "14:20"), description: "Versement Sarah Khelifi" },
      { id: "csh-5", type: "expense", amount: -60000, date: stamp(-18, "10:00"), description: "Loyer du mois" },
      { id: "csh-6", type: "expense", amount: -9500, date: stamp(-11, "10:00"), description: "Facture Sonelgaz" },
      { id: "csh-7", type: "teacher_payment", amount: -18000, date: stamp(-20, "17:00"), description: "Règlement séances Karim Bensalah" },
    ],

    // -----------------------------------------------------------------------
    parents: [
      {
        id: "par-1",
        firstName: "Rachid",
        lastName: "Amrani",
        phone: "0550 20 20 20",
        email: "rachid.amrani@parent.altech-school.dz",
        childIds: ["stu-1", "stu-2"],
      },
      {
        id: "par-2",
        firstName: "Fatima",
        lastName: "Bouzid",
        phone: "0550 20 20 21",
        email: "fatima.bouzid@parent.altech-school.dz",
        childIds: ["stu-3", "stu-4"],
      },
      {
        id: "par-3",
        firstName: "Djamel",
        lastName: "Ferhat",
        phone: "0550 20 20 22",
        email: "djamel.ferhat@parent.altech-school.dz",
        childIds: ["stu-5", "stu-7"],
      },
    ],

    notifications: [
      {
        id: "ntf-1",
        parentId: "par-2",
        title: "Alerte: reste à payer",
        description: "Un reste à payer est enregistré sur le compte de Mehdi Bouzid. Merci de régulariser à la réception.",
        date: stamp(-6, "10:10"),
        read: false,
        auto: true,
      },
    ],

    coursework: [
      {
        id: "cwk-1",
        name: "Stage intensif — Mathématiques",
        type: "period",
        dates: [shiftDays(10), shiftDays(11), shiftDays(12)],
        pricePerSession: 1200,
        total: 3600,
        teacherId: "tea-1",
      },
    ],

    independent: [
      {
        id: "ind-1",
        passagerName: "Walid Tounsi",
        itemLabel: "Séance libre — Révision Physique",
        price: 800,
        date: shiftDays(-3),
        sessionId: "ses-6",
        startTime: "18:00",
        endTime: "20:00",
        createdAt: stamp(-3, "18:05"),
        teacherPaid: false,
      },
    ],
    // Séances libres vendues à un groupe entier : la base démarre sans aucune.
    groupSeances: [],
    soloSeances: [],
  };
}
