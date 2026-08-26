"use client";

import { useSession } from "@/lib/store/session";
import { ClassesPage } from "@/components/pages/ClassesPage";
import { PlannerPage } from "@/components/pages/PlannerPage";
import { SubscriptionsPage } from "@/components/pages/SubscriptionsPage";
import { StudentsPage } from "@/components/pages/StudentsPage";
import { AttendancePage } from "@/components/pages/AttendancePage";
import { TeachersPage } from "@/components/pages/TeachersPage";
import { SubjectsPage } from "@/components/pages/SubjectsPage";
import { AdministrationPage } from "@/components/pages/AdministrationPage";
import { IndependentPage } from "@/components/pages/IndependentPage";
import { ParentsPage } from "@/components/pages/ParentsPage";
import { AnnouncementsPage } from "@/components/pages/AnnouncementsPage";
import { ExpensesPage } from "@/components/pages/ExpensesPage";
import { AnalyticsPage } from "@/components/pages/AnalyticsPage";
import { CashPage } from "@/components/pages/CashPage";
import { ReportsPage } from "@/components/pages/ReportsPage";
import { SettingsPage } from "@/components/pages/SettingsPage";
import { StudentPages } from "@/components/pages/StudentPages";
import { TeacherPages } from "@/components/pages/TeacherPages";
import { ParentPages } from "@/components/pages/ParentPages";
import { ModulePlaceholder } from "@/components/ModulePlaceholder";
import { AccessDenied } from "@/components/layout/AccessDenied";
import { useAccessRights } from "@/lib/usePermissions";
import { canSeePage } from "@/lib/permissions";

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
  const guardKey = pageSlug === "administration" ? "workers" : pageSlug;
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
      return <StudentsPage />;
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
