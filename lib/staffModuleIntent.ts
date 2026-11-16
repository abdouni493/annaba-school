"use client";

import { canSeePage, type AccessRights } from "@/lib/permissions";

const loaders = {
  students: () => import("@/components/pages/StudentsPage"),
  attendance: () => import("@/components/pages/AttendancePage"),
  cash: () => import("@/components/pages/CashPage"),
};
const pending = new Map<string, Promise<unknown>>();

/** Warm just the screen the user points at or focuses. No mounting, data
 * reads, idle burst across modules, or permission bypass. Navigation still
 * uses the normal route guard and Next's dynamic loader.
 */
export function prefetchStaffModule(href: string, role: string, rights: AccessRights): Promise<unknown> | undefined {
  if (role !== "admin" && role !== "reception") return;
  const key = href.slice(1);
  if (!Object.hasOwn(loaders, key) || !canSeePage(rights, key)) return;
  if (typeof navigator !== "undefined" && (navigator as Navigator & {
    connection?: { saveData?: boolean };
  }).connection?.saveData) return;
  let task = pending.get(key);
  if (!task) {
    task = loaders[key as keyof typeof loaders]().catch(() => {
      pending.delete(key);
      // A failed hint must not produce an unhandled rejection or block click.
    });
    pending.set(key, task);
  }
  return task;
}
