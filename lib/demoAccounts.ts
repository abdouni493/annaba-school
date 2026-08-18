import type { Role, SessionUser } from "@/lib/store/session";

/**
 * The five one-tap demo logins of the login page. Each `entityId` points at a
 * real row of the seeded database (`lib/store/seed.ts`), so every portal opens
 * on consistent data: the teacher sees his own timings, the parent his own
 * children, the student his own inscriptions.
 *
 * "Travailleurs" is the `reception` role — that is what the app calls its
 * non-teaching staff.
 */
export const DEMO_ACCOUNTS: Record<Role, SessionUser> = {
  admin: {
    id: "adm-1",
    name: "Administrateur",
    username: "admin@altech-school.dz",
    email: "admin@altech-school.dz",
    role: "admin",
    // The admin is the only role without an entity row of its own.
    entityId: "adm-1",
  },
  reception: {
    id: "rec-1",
    name: "Yasmine Belkacem",
    username: "yasmine.belkacem@altech-school.dz",
    email: "yasmine.belkacem@altech-school.dz",
    role: "reception",
    entityId: "rec-1",
  },
  teacher: {
    id: "tea-1",
    name: "Karim Bensalah",
    username: "karim.bensalah@altech-school.dz",
    email: "karim.bensalah@altech-school.dz",
    role: "teacher",
    entityId: "tea-1",
  },
  student: {
    id: "stu-1",
    name: "Yacine Amrani",
    username: "yacine.amrani@eleve.altech-school.dz",
    email: "yacine.amrani@eleve.altech-school.dz",
    role: "student",
    entityId: "stu-1",
  },
  parent: {
    id: "par-1",
    name: "Rachid Amrani",
    username: "rachid.amrani@parent.altech-school.dz",
    email: "rachid.amrani@parent.altech-school.dz",
    role: "parent",
    entityId: "par-1",
  },
};

/** Order + labels of the buttons on the login page. */
export const DEMO_ROLES: Array<{ role: Role; label: string; emoji: string }> = [
  { role: "admin", label: "Admin", emoji: "🛡️" },
  { role: "reception", label: "Réception (Travailleurs)", emoji: "🧑‍💼" },
  { role: "teacher", label: "Enseignant", emoji: "👨‍🏫" },
  { role: "student", label: "Étudiant", emoji: "🎓" },
  { role: "parent", label: "Parent", emoji: "👨‍👩‍👧" },
];

/** Matches a typed email against the demo accounts (any password works). */
export function findDemoAccount(email: string): SessionUser | undefined {
  const needle = email.trim().toLowerCase();
  return Object.values(DEMO_ACCOUNTS).find(
    (a) => a.email.toLowerCase() === needle || a.role === needle,
  );
}
