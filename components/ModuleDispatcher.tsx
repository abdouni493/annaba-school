"use client";

import dynamic from "next/dynamic";
import { useSession } from "@/lib/store/session";
import { ModulePlaceholder } from "@/components/ModulePlaceholder";
import { AccessDenied } from "@/components/layout/AccessDenied";
import { useAccessRights } from "@/lib/usePermissions";
import { canSeePage } from "@/lib/permissions";

/** Screen chunks are loaded on navigation. Do not schedule every staff module
 * together: that competes with the active screen's reads and hydration. */
// Les chargeurs, référencés à la fois par `dynamic()` et par le préchargement
// en temps mort — appeler `import()` deux fois ne charge qu'une fois (le cache
// de modules dédoublonne), donc précharger « réchauffe » le même morceau.
const loaders = {
  classes: () => import("@/components/pages/ClassesPage").then((m) => m.ClassesPage),
  planner: () => import("@/components/pages/PlannerPage").then((m) => m.PlannerPage),
  subscriptions: () => import("@/components/pages/SubscriptionsPage").then((m) => m.SubscriptionsPage),
  students: () => import("@/components/pages/StudentsPage").then((m) => m.StudentsPage),
  attendance: () => import("@/components/pages/AttendancePage").then((m) => m.AttendancePage),
  teachers: () => import("@/components/pages/TeachersPage").then((m) => m.TeachersPage),
  subjects: () => import("@/components/pages/SubjectsPage").then((m) => m.SubjectsPage),
  administration: () => import("@/components/pages/AdministrationPage").then((m) => m.AdministrationPage),
  independent: () => import("@/components/pages/IndependentPage").then((m) => m.IndependentPage),
  soloSeances: () => import("@/components/pages/SoloSeancePage").then((m) => m.SoloSeancePage),
  parents: () => import("@/components/pages/ParentsPage").then((m) => m.ParentsPage),
  announcements: () => import("@/components/pages/AnnouncementsPage").then((m) => m.AnnouncementsPage),
  expenses: () => import("@/components/pages/ExpensesPage").then((m) => m.ExpensesPage),
  analytics: () => import("@/components/pages/AnalyticsPage").then((m) => m.AnalyticsPage),
  cash: () => import("@/components/pages/CashPage").then((m) => m.CashPage),
  reports: () => import("@/components/pages/ReportsPage").then((m) => m.ReportsPage),
  settings: () => import("@/components/pages/SettingsPage").then((m) => m.SettingsPage),
  studentPortal: () => import("@/components/pages/StudentPages").then((m) => m.StudentPages),
  teacherPortal: () => import("@/components/pages/TeacherPages").then((m) => m.TeacherPages),
  parentPortal: () => import("@/components/pages/ParentPages").then((m) => m.ParentPages),
} as const;

/** Esquisse affichée le temps (bref, souvent nul grâce au préchargement) qu'un
 *  morceau d'écran arrive. Discrète : pas de spinner qui saute aux yeux. */
function PageFallback() {
  return (
    <div className="skeleton-pulse space-y-6" aria-busy="true" aria-label="Chargement de l'écran">
      <div className="h-8 w-56 rounded-lg bg-line/70" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-24 rounded-xl border border-line bg-card" />
        ))}
      </div>
      <div className="space-y-3 rounded-xl border border-line bg-card p-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4">
            <div className="h-9 w-9 shrink-0 rounded-full bg-line/70" />
            <div className="h-4 flex-1 rounded bg-line/60" />
            <div className="h-4 w-16 rounded bg-line/50" />
          </div>
        ))}
      </div>
    </div>
  );
}

const dyn = (loader: () => Promise<React.ComponentType<Record<string, never>>>) =>
  dynamic(loader, { ssr: false, loading: () => <PageFallback /> });

const ClassesPage = dyn(loaders.classes);
const PlannerPage = dyn(loaders.planner);
const SubscriptionsPage = dyn(loaders.subscriptions);
const StudentDirectoryPage = dynamic(() => import("@/components/pages/StudentDirectoryPage").then((m) => m.StudentDirectoryPage), { ssr: false, loading: () => <PageFallback /> });
const StudentsPage = dyn(loaders.students);
const AttendancePage = dyn(loaders.attendance);
const TeachersPage = dyn(loaders.teachers);
const SubjectsPage = dyn(loaders.subjects);
const AdministrationPage = dyn(loaders.administration);
const IndependentPage = dyn(loaders.independent);
const SoloSeancePage = dyn(loaders.soloSeances);
const ParentsPage = dyn(loaders.parents);
const AnnouncementsPage = dyn(loaders.announcements);
const ExpensesPage = dyn(loaders.expenses);
const AnalyticsPage = dyn(loaders.analytics);
const CashPage = dyn(loaders.cash);
const ReportsPage = dyn(loaders.reports);
const SettingsPage = dyn(loaders.settings);

const StudentPages = dynamic(loaders.studentPortal, { ssr: false, loading: () => <PageFallback /> });
const TeacherPages = dynamic(loaders.teacherPortal, { ssr: false, loading: () => <PageFallback /> });
const ParentPages = dynamic(loaders.parentPortal, { ssr: false, loading: () => <PageFallback /> });

/** Client-side role+slug dispatch for every module route. Kept separate from
 *  the route file so the page itself can stay a server component and export
 *  `generateStaticParams` (prerendered shells -> instant sidebar navigation). */
export function ModuleDispatcher({ slug }: { slug: string[] }) {
  const { user } = useSession();
  const rights = useAccessRights();
  const pageSlug = slug[0];

  const role = user?.role || "admin";

  // 1. Student Portal Routing
  if (role === "student") {
    return <StudentPages slug={pageSlug} />;
  }

  // 2. Teacher Portal Routing
  if (role === "teacher") {
    return <TeacherPages slug={pageSlug} />;
  }

  // 3. Parent Portal Routing
  if (role === "parent") {
    return <ParentPages slug={pageSlug} />;
  }

  // 4. Admin / Reception Portal Routing
  //
  // Un travailleur n'ouvre que les écrans qu'on lui a cochés. La barre latérale
  // ne lui montre déjà pas les autres, mais une adresse tapée à la main, un
  // signet ou un lien reçu contourneraient le menu : le garde-fou est ici, sur
  // la route elle-même.
  const guardKey =
    pageSlug === "administration"
      ? "workers"
      : pageSlug === "solo-seances"
        ? "soloSeances"
        : pageSlug;
  if (guardKey && !canSeePage(rights, guardKey)) {
    return <AccessDenied />;
  }

  switch (pageSlug) {
    case "classes":
      return <ClassesPage />;
    case "planner":
      return <PlannerPage />;
    case "subscriptions":
      return <SubscriptionsPage />;
    case "students":
      return slug[1] === "complete" ? <StudentsPage /> : <StudentDirectoryPage key={user?.id} />;
    case "attendance":
      return <AttendancePage />;
    case "teachers":
      return <TeachersPage />;
    case "subjects":
      return <SubjectsPage />;
    case "workers":
    case "administration": // legacy slug — kept so old bookmarks keep working
      return <AdministrationPage />;
    case "independent":
      return <IndependentPage />;
    case "solo-seances":
      return <SoloSeancePage />;
    case "parents":
      return <ParentsPage />;
    case "announcements":
      return <AnnouncementsPage />;
    case "expenses":
      return <ExpensesPage />;
    case "analytics":
      return <AnalyticsPage />;
    case "cash":
      return <CashPage />;
    case "reports":
      return <ReportsPage />;
    case "settings":
      return <SettingsPage />;
    default:
      return <ModulePlaceholder href={`/${slug.join("/")}`} />;
  }
}
