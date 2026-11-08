"use client";

import { useEffect } from "react";
import { useSession } from "@/lib/store/session";
import { setCurrentActor, useData, type BootResult } from "@/lib/store/data";
import {
  pauseSync,
  resumeSync,
  resumeSyncFrom,
  startSync,
  stopSync,
} from "@/lib/supabase/sync";

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
  const boot = useData((s) => s.boot);
  const revalidate = useData((s) => s.revalidate);
  const clear = useData((s) => s.clear);
  const processWeeklyAbsences = useData((s) => s.processWeeklyAbsences);
  const dropVoidTeacherDues = useData((s) => s.dropVoidTeacherDues);

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
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retries = 0;
    // La copie locale est rangée sous l'identifiant de la FICHE (`entityId`),
    // comme la signature des opérations — ainsi la clé est identique d'une
    // session à l'autre pour un même compte.
    const cacheKey = user.entityId ?? user.id;

    // Subscribe first but hold the writes: the rows we are about to READ (and the
    // cache we are about to PAINT) must not be written straight back.
    pauseSync();
    // Never show a prior account's records while the next account is loading.
    // clear() also invalidates any in-flight read from the previous user.
    clear();
    startSync();

    const runPostLoadJobs = () => {
      // Staff load is the safety-net trigger for the automatic weekly-absence
      // billing (idempotent, throttled to once/day).
      if (user.role === "admin" || user.role === "reception") {
        processWeeklyAbsences();
        // Les parts d'enseignant restées sur un emploi coché offert après coup
        // quittent la base (idempotent) : la paie ne les lit déjà plus, les
        // rapports non plus désormais.
        dropVoidTeacherDues();
      }
    };

    /**
     * Traduit le verdict du démarrage « cache d'abord » en reprise du miroir.
     * La règle d'or reste : NE JAMAIS reprendre la synchronisation sans une
     * lecture complète fiable — sans quoi un magasin partiel pourrait réécrire
     * des suppressions dans Supabase.
     */
    const apply = (result: BootResult) => {
      if (cancelled) return;
      switch (result.kind) {
        case "fresh":
          // Donnée fraîche adoptée : reprise normale (référence = le frais lu).
          resumeSync();
          runPostLoadJobs();
          break;
        case "keep-local":
          // L'utilisateur a modifié le magasin pendant la revalidation : on
          // reprend EN ÉCRIVANT ses modifications (référence = le cache peint),
          // pour ne rien perdre de ce qu'il a fait.
          resumeSyncFrom(result.baseline);
          runPostLoadJobs();
          break;
        case "cache-only":
          // Cache affiché mais base injoignable : lecture seule (miroir en pause),
          // et on retente discrètement en arrière-plan avec un délai croissant.
          if (retries < 5) {
            const delay = Math.min(3000 * 2 ** retries, 30000);
            retries += 1;
            retryTimer = setTimeout(() => {
              if (cancelled) return;
              void revalidate().then(apply);
            }, delay);
          }
          break;
        case "failed":
        case "cancelled":
          // Aucun cache + échec, ou lecture supplantée : rien à reprendre. L'écran
          // d'erreur (failed) ou le nouveau démarrage (cancelled) prend le relais.
          break;
      }
    };

    void boot(cacheKey).then(apply);

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, user?.id]);

  return <>{children}</>;
}
