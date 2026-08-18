"use client";

import { useEffect } from "react";
import { useSession } from "@/lib/store/session";
import { useData } from "@/lib/store/data";
import { pauseSync, resumeSync, startSync, stopSync } from "@/lib/supabase/sync";

/**
 * Boots the app: restores the Supabase session, loads the establishment (the
 * login screen shows its name and logo before anyone signs in), and — once
 * someone is signed in — reads the whole database and starts mirroring every
 * change back to Supabase.
 */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const initSession = useSession((s) => s.initSession);
  const user = useSession((s) => s.user);
  const hydrated = useSession((s) => s.hydrated);
  const fetchSchool = useData((s) => s.fetchSchool);
  const fetchAll = useData((s) => s.fetchAll);
  const clear = useData((s) => s.clear);
  const processWeeklyAbsences = useData((s) => s.processWeeklyAbsences);

  useEffect(() => {
    fetchSchool();
    initSession();
  }, [initSession, fetchSchool]);

  useEffect(() => {
    if (!hydrated) return;

    if (!user) {
      // Signed out: stop writing back and drop the data of the previous account.
      stopSync();
      clear();
      fetchSchool();
      return;
    }

    let cancelled = false;
    // Subscribe first but hold the writes: the rows we are about to READ must
    // not be written straight back to the database.
    startSync();
    pauseSync();

    void fetchAll().then(() => {
      if (cancelled) return;
      resumeSync();
      // Staff load is the safety-net trigger for the automatic weekly-absence
      // billing (idempotent, throttled to once/day).
      if (user.role === "admin" || user.role === "reception") {
        processWeeklyAbsences();
      }
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, user?.id]);

  return <>{children}</>;
}
