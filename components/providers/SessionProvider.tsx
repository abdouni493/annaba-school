"use client";

import { useEffect } from "react";
import { useSession } from "@/lib/store/session";
import { useData } from "@/lib/store/data";

/** Marks the session as hydrated once at the root of the app, before the login
 *  page or AppShell's auth guard read `hydrated`/`user`. The demo database is
 *  already in memory, so the "fetch" calls are no-ops kept for symmetry. */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const initSession = useSession((s) => s.initSession);
  const user = useSession((s) => s.user);
  const hydrated = useSession((s) => s.hydrated);
  const fetchSchool = useData((s) => s.fetchSchool);
  const fetchAll = useData((s) => s.fetchAll);
  const processWeeklyAbsences = useData((s) => s.processWeeklyAbsences);

  useEffect(() => {
    fetchSchool();
    initSession();
  }, [initSession, fetchSchool]);

  useEffect(() => {
    if (!hydrated || !user) return;
    fetchAll();
    // Staff load is the safety-net trigger for the automatic weekly-absence
    // billing (idempotent, throttled to once/day).
    if (user.role === "admin" || user.role === "reception") {
      processWeeklyAbsences();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, user?.id]);

  return <>{children}</>;
}
