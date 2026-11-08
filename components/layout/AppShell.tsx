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

  // The app chrome (sidebar + topbar) renders immediately so login feels
  // responsive even while the full database is still hydrating. Only the main
  // CONTENT area is gated: pages never render against an unloaded or failed
  // snapshot (which would flash wrong balances or empty lists). Write-sync
  // stays paused in SessionProvider until the load succeeds, so nothing shown
  // here — loading placeholder included — can be mirrored back as deletions.
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
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onMenu={() => setMobileOpen(true)} />
        <main className="flex-1 overflow-y-auto">
          {dbReady ? (
            <PageTransition>
              <div className="mx-auto w-full max-w-7xl p-4 md:p-6">{children}</div>
            </PageTransition>
          ) : (
            <div className="flex min-h-full items-center justify-center p-6">
              <div
                role={dbFailed ? "alert" : "status"}
                className="w-full max-w-md rounded-xl border border-line bg-card p-6 text-center"
              >
                <h2 className="mb-2 text-base font-semibold text-ink">
                  {dbTimedOut
                    ? "Base trop lente à répondre"
                    : dbFailed
                      ? "Impossible de charger les données"
                      : "Chargement des données…"}
                </h2>
                <p className="text-sm text-muted">
                  {dbTimedOut
                    ? "La base n'a pas répondu à temps. Aucun enregistrement n'a été supprimé. Vérifiez votre connexion, puis réessayez."
                    : dbFailed
                      ? "Les données de l'école n'ont pas pu être lues. Aucun enregistrement n'a été supprimé. Vérifiez votre connexion."
                      : "Connexion à la base de l'école en cours."}
                </p>
                {dbFailed && (
                  <button
                    type="button"
                    onClick={() => window.location.reload()}
                    className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white"
                  >
                    Réessayer le chargement
                  </button>
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
