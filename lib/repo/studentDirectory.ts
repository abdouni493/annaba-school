"use client";

import { hasPendingSnapshot } from "@/lib/supabase/snapshotCache";
import { create } from "zustand";
import { supabase } from "@/lib/supabase/client";
import { accessRightsOf, type AccessRights } from "@/lib/permissions";
import type { SessionUser } from "@/lib/store/session";
import type { ReceptionStaff } from "@/lib/types";

/** Separate read model. Nothing here is subscribed to by the array-diff mirror
 * or written to the legacy whole-database IndexedDB snapshot. */
interface DirectoryAccess {
  account: string | null;
  rights: AccessRights | null;
  error: string | null;
}
export const useDirectoryAccess = create<DirectoryAccess>(() => ({ account: null, rights: null, error: null }));
let epoch = 0;
let abort: AbortController | null = null;
export function clearDirectoryAccess() {
  epoch += 1;
  abort?.abort();
  useDirectoryAccess.setState({ account: null, rights: null, error: null });
}
export async function prepareDirectory(user: SessionUser) {
  clearDirectoryAccess();
  const version = epoch;
  abort = new AbortController();
  useDirectoryAccess.setState({ account: user.id });
  try {
    let workers: ReceptionStaff[] = [];
    if (user.role === "reception") {
      const ids = [...new Set([user.entityId ?? user.id, user.id])];
      const { data, error } = await supabase().from("reception_staff")
        .select("id,nav_keys,action_keys").in("id", ids).abortSignal(abort.signal);
      if (error) throw new Error(error.message);
      workers = (data ?? []).map((r) => ({ id: r.id,
        navKeys: r.nav_keys ?? undefined, actionKeys: r.action_keys ?? undefined,
      } as ReceptionStaff));
    }
    if (version === epoch) useDirectoryAccess.setState({ rights: accessRightsOf(user, workers) });
    const pending = await hasPendingSnapshot(user.entityId ?? user.id);
    return version === epoch && pending;
  } catch {
    if (version === epoch) useDirectoryAccess.setState({ error: "Impossible de vérifier les droits / تعذر التحقق من الصلاحيات" });
  }
}

export function isDirectoryRoute(pathname: string, user: SessionUser | null) {
  return pathname === "/students" && (user?.role === "admin" || user?.role === "reception");
}
