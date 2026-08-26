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

  return (
    <div className="flex h-dvh overflow-hidden bg-canvas">
      <GlobalRFIDListener />
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
          <PageTransition>
            <div className="mx-auto w-full max-w-7xl p-4 md:p-6">{children}</div>
          </PageTransition>
        </main>
      </div>
    </div>
  );
}
