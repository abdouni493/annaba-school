"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { PageTransition } from "./PageTransition";
import { useSession } from "@/lib/store/session";
import { useSettings } from "@/lib/store/settings";
import { useSidebar } from "@/lib/store/ui";
import { useData } from "@/lib/store/data";
import { landingRoute, roleHome } from "@/lib/nav";
import { useAccessRights } from "@/lib/usePermissions";

import { GlobalRFIDListener } from "@/components/controls/GlobalRFIDListener";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const router = useRouter();
  const user = useSession((s) => s.user);
  const hydrated = useSession((s) => s.hydrated);
  const isRTL = useSettings((s) => s.language) === "ar";
  const sidebarHidden = useSidebar((s) => s.hidden);
  const pathname = usePathname();
  const loaded = useData((s) => s.loaded);
  const loadStatus = useData((s) => s.loadStatus);
  const revalidating = useData((s) => s.revalidating);
  const offline = useData((s) => s.offline);
  const offlineReason = useData((s) => s.offlineReason);
  const revalidate = useData((s) => s.revalidate);
  const rights = useAccessRights();

  useEffect(() => {
    if (hydrated && !user) router.replace("/login");
  }, [hydrated, user, router]);

  /**
   * L'ATTERRISSAGE D'UN TRAVAILLEUR DONT LE TABLEAU DE BORD N'EST PAS OUVERT.
   *
   * La connexion mène toujours à l'accueil du rôle, faute de mieux : les droits
   * vivent sur sa fiche, et la base n'est pas encore lue au moment où le
   * formulaire redirige. Une fois les données là, on le renvoie sur le premier
   * écran de SA barre latérale.
   *
   * Le renvoi ne vise QUE l'accueil du rôle : partout ailleurs, un écran
   * interdit affiche son refus plutôt que de déplacer l'utilisateur sans le
   * lui dire.
   */
  useEffect(() => {
    if (!loaded || !user || rights.unrestricted) return;
    const home = roleHome(user.role);
    if (pathname !== home) return;
    const target = landingRoute(user.role, rights);
    if (target !== home) router.replace(target);
  }, [loaded, user, rights, pathname, router]);

  // Don't render the shell (and thus every page below it) until the
  // Supabase session has actually resolved. Rendering early with a
  // momentarily-null user made pages that read the user/school once at
  // mount (e.g. Settings) latch onto empty defaults on every refresh.
  if (!hydrated || !user) return null;

  // LA FIN DE L'ÉCRAN « CHARGEMENT DES DONNÉES… » À CHAQUE RAFRAÎCHISSEMENT.
  //
  // Comme les meilleures applications pleines de données, on peint AUSSITÔT le
  // dernier instantané local de la base (cache IndexedDB) : `boot()` pose alors
  // `loaded = true` dès le premier rendu, donc `dbReady` est vrai sans attendre
  // le réseau et le contenu s'affiche sans transition d'attente. La lecture
  // réseau complète continue EN FOND (`revalidating`) et remplace la donnée dès
  // qu'elle aboutit — l'utilisateur ne voit qu'un fin trait de progression.
  //
  // L'écran d'attente plein cadre ne reste donc que pour la toute PREMIÈRE
  // visite d'un poste (aucun cache encore), et l'écran d'erreur pour un échec
  // sans cache. Le miroir d'écriture reste géré par `SessionProvider` : il ne
  // reprend qu'après une lecture complète fiable, donc rien d'affiché ici ne
  // peut être réécrit comme une suppression.
  const dbReady = loaded && loadStatus === "success";
  const dbTimedOut = loadStatus === "timeout";
  const dbFailed = loadStatus === "error" || dbTimedOut;

  return (
    <div className="flex h-dvh overflow-hidden bg-canvas">
      {dbReady && <GlobalRFIDListener />}
      {/* Desktop sidebar — hidden on demand from the navbar */}
      <div className={sidebarHidden ? "hidden" : "hidden lg:block"}>
        <Sidebar />
      </div>

      {/* Mobile drawer */}
      <div
        className={`fixed inset-0 z-40 bg-black/40 lg:hidden transition-opacity duration-300 ease-in-out ${
          mobileOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        onClick={() => setMobileOpen(false)}
      />
      <div
        className={`fixed inset-y-0 z-50 lg:hidden transition-transform duration-300 ease-out shadow-2xl ${
          isRTL ? "right-0" : "left-0"
        } ${
          mobileOpen 
            ? "translate-x-0" 
            : (isRTL ? "translate-x-full" : "-translate-x-full")
        }`}
      >
        <Sidebar onNavigate={() => setMobileOpen(false)} />
      </div>

      {/* Main column */}
      <div className="relative flex min-w-0 flex-1 flex-col">
        {/* Fin trait de progression pendant une revalidation en arrière-plan —
            discret, jamais bloquant : la donnée du cache reste pleinement
            utilisable pendant que le réseau la rafraîchit. */}
        {dbReady && revalidating && (
          <div className="pointer-events-none absolute inset-x-0 top-0 z-30 h-0.5 overflow-hidden">
            <div className="revalidate-bar h-full w-1/3 bg-gradient-primary" />
          </div>
        )}
        <Topbar onMenu={() => setMobileOpen(true)} />
        {/* Bandeau « lecture seule » quand la base est injoignable mais que le
            cache reste affiché : on est honnête sur le fait que les
            enregistrements n'atteignent pas encore le serveur. */}
        {dbReady && offline && (
          <div
            role="status"
            className="flex items-center justify-between gap-3 border-b border-amber-300/60 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-200"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-amber-500" />
              <span className="min-w-0">
                Hors-ligne — données affichées depuis la copie locale. Reconnexion en cours…
                {offlineReason && (
                  <span className="block truncate text-xs opacity-75" title={offlineReason}>
                    Détail : {offlineReason}
                  </span>
                )}
              </span>
            </span>
            <button
              type="button"
              onClick={() => void revalidate()}
              className="shrink-0 rounded-lg border border-amber-400/60 px-3 py-1 text-xs font-semibold hover:bg-amber-100 dark:hover:bg-amber-900/40"
            >
              Réessayer
            </button>
          </div>
        )}
        <main className="flex-1 overflow-y-auto">
          {dbReady ? (
            <PageTransition>
              <div className="mx-auto w-full max-w-7xl p-4 md:p-6">{children}</div>
            </PageTransition>
          ) : dbFailed ? (
            // Échec RÉEL sans copie locale (première visite d'un poste hors-ligne,
            // droits refusés…) : on reste honnête et on propose de réessayer.
            <div className="flex min-h-full items-center justify-center p-6">
              <div
                role="alert"
                className="w-full max-w-md rounded-xl border border-line bg-card p-6 text-center"
              >
                <h2 className="mb-2 text-base font-semibold text-ink">
                  {dbTimedOut ? "Base trop lente à répondre" : "Impossible de charger les données"}
                </h2>
                <p className="text-sm text-muted">
                  {dbTimedOut
                    ? "La base n'a pas répondu à temps. Aucun enregistrement n'a été supprimé. Vérifiez votre connexion, puis réessayez."
                    : "Les données de l'école n'ont pas pu être lues. Aucun enregistrement n'a été supprimé. Vérifiez votre connexion."}
                </p>
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white"
                >
                  Réessayer le chargement
                </button>
              </div>
            </div>
          ) : (
            // Toute PREMIÈRE visite, sans copie locale encore : une esquisse de
            // l'écran (skeleton) plutôt qu'un panneau « Chargement des données… »,
            // pour que l'application paraisse se peindre, pas attendre un serveur.
            <div className="mx-auto w-full max-w-7xl p-4 md:p-6" aria-busy="true" aria-label="Préparation de l'espace de travail">
              <div className="skeleton-pulse space-y-6">
                <div className="h-8 w-56 rounded-lg bg-line/70" />
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="h-24 rounded-xl border border-line bg-card" />
                  ))}
                </div>
                <div className="space-y-3 rounded-xl border border-line bg-card p-4">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-4">
                      <div className="h-10 w-10 shrink-0 rounded-full bg-line/70" />
                      <div className="h-4 flex-1 rounded bg-line/60" />
                      <div className="h-4 w-20 rounded bg-line/50" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
