"use client";

import { useEffect } from "react";
import { useSession } from "@/lib/store/session";
import { setCurrentActor, useData } from "@/lib/store/data";
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

  /**
   * QUI SIGNE LES OPÉRATIONS.
   *
   * Le magasin pose son nom sur chaque ligne créée, mais ses actions sont des
   * fonctions ordinaires : elles ne peuvent pas lire un hook. Le compte connecté
   * leur est donc DÉPOSÉ ici, dès qu'il est connu, et retiré à la déconnexion.
   *
   * La signature porte l'identifiant de la FICHE (`entityId`), pas celui du
   * compte : c'est la fiche que l'historique doit désigner. Les deux ne
   * diffèrent que pour un travailleur à qui l'accès a été ouvert APRÈS sa
   * création — son compte est né plus tard, sa fiche existait déjà, et c'est
   * sous elle que vivent ses pointages, ses acomptes et ses règlements.
   */
  useEffect(() => {
    setCurrentActor(
      user ? { id: user.entityId ?? user.id, name: user.name, role: user.role } : null,
    );
  }, [user]);

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
