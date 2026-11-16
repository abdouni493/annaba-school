"use client";

/**
 * Les droits du compte connecté, tels que les écrans les consultent.
 *
 *   const can = useCan("students");
 *   {can("create") && <Button …>Nouvel élève</Button>}
 *
 * L'administration renvoie toujours `true` : rien n'est masqué pour elle. Un
 * travailleur ne voit que ce que sa fiche autorise.
 */

import { useMemo } from "react";
import { useSession } from "@/lib/store/session";
import { useData } from "@/lib/store/data";
import { accessRightsOf, canDoAction, canSeePage, type AccessRights } from "@/lib/permissions";

/** Les droits complets — pour la barre latérale et le garde-fou des routes. */
export function useAccessRights(): AccessRights {
  const user = useSession((s) => s.user);
  const workers = useData((s) => s.reception);
  return useMemo(() => accessRightsOf(user, workers), [user, workers]);
}

/** `can("create")` sur UN écran. */
export function useCan(pageKey: string): (action: string) => boolean {
  const rights = useAccessRights();
  return useMemo(
    () => (action: string) => canDoAction(rights, pageKey, action),
    [rights, pageKey],
  );
}

/** Cet écran est-il ouvert à ce compte ? */
export function useCanSeePage(pageKey: string): boolean {
  const rights = useAccessRights();
  return canSeePage(rights, pageKey);
}
