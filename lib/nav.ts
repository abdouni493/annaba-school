import type { Role } from "@/lib/store/session";
import { PERMISSION_PAGES, canSeePage, type AccessRights } from "@/lib/permissions";

export interface NavItem {
  /** i18n key under `nav.*` */
  key: string;
  emoji: string;
  href: string;
  /** logout is an action, not a route */
  action?: "logout";
}

/** La déconnexion : une action, pas un écran. Elle est toujours affichée. */
export const LOGOUT_ITEM: NavItem = {
  key: "logout",
  emoji: "🚪",
  href: "/login",
  action: "logout",
};

const logout = LOGOUT_ITEM;

/** Landing route after login, per role. */
export function roleHome(role: Role): string {
  return role === "student" || role === "parent" ? "/home" : "/dashboard";
}

/**
 * OÙ ATTERRIT-ON APRÈS S'ÊTRE CONNECTÉ ?
 *
 * Sur le tableau de bord, sauf pour un travailleur à qui on ne l'a pas ouvert :
 * il arriverait alors sur un écran qu'il n'a pas le droit de lire. On l'emmène
 * au premier écran de SA barre latérale — et à la page de connexion s'il n'en a
 * aucun, ce qui est le seul cas où il n'a rien à faire dans l'application.
 */
export function landingRoute(role: Role, rights: AccessRights): string {
  const home = roleHome(role);
  if (canSeePage(rights, home.replace(/^\//, ""))) return home;

  const first = PERMISSION_PAGES.find((p) => rights.pages.includes(p.key));
  return first?.href ?? home;
}

/** Resolve a route href to its nav metadata (emoji + i18n key), looking
 *  across every role's menu. Used by the generic module placeholder. */
export function navMetaForHref(href: string): { key: string; emoji: string } | null {
  for (const items of Object.values(NAV_BY_ROLE)) {
    const match = items.find((i) => i.href === href && i.action !== "logout");
    if (match) return { key: match.key, emoji: match.emoji };
  }
  return null;
}

export const NAV_BY_ROLE: Record<Role, NavItem[]> = {
  admin: [
    { key: "dashboard", emoji: "📊", href: "/dashboard" },
    { key: "classes", emoji: "🏫", href: "/classes" },
    { key: "planner", emoji: "📅", href: "/planner" },
    { key: "subscriptions", emoji: "🎫", href: "/subscriptions" },
    { key: "students", emoji: "🎓", href: "/students" },
    { key: "attendance", emoji: "✅", href: "/attendance" },
    { key: "teachers", emoji: "👨‍🏫", href: "/teachers" },
    { key: "subjects", emoji: "📄", href: "/subjects" },
    { key: "workers", emoji: "👥", href: "/workers" },
    { key: "independent", emoji: "🧩", href: "/independent" },
    { key: "parents", emoji: "👨‍👩‍👧", href: "/parents" },
    { key: "announcements", emoji: "📢", href: "/announcements" },
    { key: "expenses", emoji: "🧾", href: "/expenses" },
    { key: "analytics", emoji: "📈", href: "/analytics" },
    { key: "cash", emoji: "💵", href: "/cash" },
    { key: "reports", emoji: "💰", href: "/reports" },
    { key: "settings", emoji: "⚙️", href: "/settings" },
    logout,
  ],
  reception: [
    { key: "dashboard", emoji: "📊", href: "/dashboard" },
    { key: "classes", emoji: "🏫", href: "/classes" },
    { key: "planner", emoji: "📅", href: "/planner" },
    { key: "subscriptions", emoji: "🎫", href: "/subscriptions" },
    { key: "students", emoji: "🎓", href: "/students" },
    { key: "attendance", emoji: "✅", href: "/attendance" },
    { key: "subjects", emoji: "📄", href: "/subjects" },
    { key: "independent", emoji: "🧩", href: "/independent" },
    { key: "parents", emoji: "👨‍👩‍👧", href: "/parents" },
    { key: "announcements", emoji: "📢", href: "/announcements" },
    { key: "expenses", emoji: "🧾", href: "/expenses" },
    { key: "settings", emoji: "⚙️", href: "/settings" },
    logout,
  ],
  student: [
    { key: "home", emoji: "🏠", href: "/home" },
    { key: "schedule", emoji: "🗓️", href: "/schedule" },
    { key: "attendance", emoji: "✅", href: "/attendance" },
    { key: "subjects", emoji: "📄", href: "/subjects" },
    { key: "payments", emoji: "💵", href: "/payments" },
    { key: "announcements", emoji: "📣", href: "/announcements" },
    { key: "profile", emoji: "👤", href: "/profile" },
    logout,
  ],
  teacher: [
    { key: "dashboard", emoji: "🏠", href: "/dashboard" },
    { key: "schedule", emoji: "🗓️", href: "/schedule" },
    { key: "attendance", emoji: "✅", href: "/attendance" },
    { key: "subjects", emoji: "📄", href: "/subjects" },
    { key: "salary", emoji: "💵", href: "/salary" },
    { key: "myClasses", emoji: "👥", href: "/my-classes" },
    { key: "announcements", emoji: "📣", href: "/announcements" },
    { key: "profile", emoji: "👤", href: "/profile" },
    logout,
  ],
  parent: [
    { key: "home", emoji: "🏠", href: "/home" },
    { key: "myChildren", emoji: "👦", href: "/my-children" },
    { key: "schedule", emoji: "🗓️", href: "/schedule" },
    { key: "subjects", emoji: "📄", href: "/subjects" },
    { key: "payments", emoji: "💵", href: "/payments" },
    { key: "notifications", emoji: "🔔", href: "/notifications" },
    { key: "announcements", emoji: "📣", href: "/announcements" },
    { key: "account", emoji: "👤", href: "/account" },
    logout,
  ],
};
