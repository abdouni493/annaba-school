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
    /** Vrai tant que l'écran est resté sur la copie locale (base injoignable) :
     *  on retente alors immédiatement dès que le navigateur se dit « en ligne ». */
    let awaitingReconnect = false;
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
      // billing (idempotent, throttled to once/day) and the void-dues cleanup.
      if (user.role !== "admin" && user.role !== "reception") return;
      // NE PAS FAIRE ATTENDRE L'UTILISATEUR DERRIÈRE CES TÂCHES.
      //
      // Ce sont des travaux de fond (facturation d'absences, nettoyage) qui
      // parcourent toute la base. Les lancer en ligne gelait l'interface juste
      // après l'affichage. On les diffère au premier temps mort : l'écran est
      // déjà peint et manipulable, le travail se fait ensuite, sans bloquer.
      const run = () => {
        if (cancelled) return;
        processWeeklyAbsences();
        // Les parts d'enseignant restées sur un emploi coché offert après coup
        // quittent la base (idempotent) : la paie ne les lit déjà plus, les
        // rapports non plus désormais.
        dropVoidTeacherDues();
      };
      const w = window as unknown as {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      };
      if (typeof w.requestIdleCallback === "function") {
        w.requestIdleCallback(run, { timeout: 3000 });
      } else {
        setTimeout(run, 400);
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
          awaitingReconnect = false;
          retries = 0;
          resumeSync();
          runPostLoadJobs();
          break;
        case "keep-local":
          // Des écritures locales (dont des saisies faites hors-ligne) ne sont pas
          // encore en base : on reprend EN LES ÉCRIVANT (référence = la donnée
          // fraîche du serveur), pour ne rien perdre et ne rien écraser.
          awaitingReconnect = false;
          retries = 0;
          resumeSyncFrom(result.baseline);
          runPostLoadJobs();
          break;
        case "cache-only":
          // Cache affiché mais base injoignable : lecture seule (miroir en pause).
          // On retente SANS JAMAIS ABANDONNER (délai croissant, plafonné à 30 s) —
          // sinon un versement ou une présence saisis hors-ligne n'atteindraient
          // jamais la base après une coupure un peu longue. Une reconnexion
          // détectée par le navigateur relance aussi immédiatement (voir plus bas).
          awaitingReconnect = true;
          {
            const delay = Math.min(3000 * 2 ** Math.min(retries, 4), 30000);
            retries += 1;
            if (retryTimer) clearTimeout(retryTimer);
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

    // RECONNEXION IMMÉDIATE. Dès que le navigateur retrouve le réseau (ou que
    // l'onglet redevient visible), on relance tout de suite une revalidation si
    // l'on était resté sur la copie locale — les écritures hors-ligne en attente
    // partent alors sans attendre la fin du délai de la prochaine tentative.
    const kick = () => {
      if (cancelled || !awaitingReconnect) return;
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      retries = 0;
      void revalidate().then(apply);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") kick();
    };
    window.addEventListener("online", kick);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      window.removeEventListener("online", kick);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, user?.id]);

  return <>{children}</>;
}
