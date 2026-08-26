"use client";

/**
 * LES DROITS D'ACCÈS D'UN TRAVAILLEUR.
 *
 * Un travailleur qui se connecte ne voit plus « l'écran de la réception » : il
 * voit EXACTEMENT ce que l'administration a coché pour lui, écran par écran et
 * bouton par bouton.
 *
 * Ce fichier est le catalogue de ce qui peut être coché :
 *
 *   - `PERMISSION_PAGES` liste TOUS les écrans de l'application, dans l'ordre
 *     où la barre latérale les présente ;
 *   - chaque écran porte la liste de SES actions — les boutons qu'on y trouve,
 *     nommés comme ils s'affichent au comptoir.
 *
 * Une action est identifiée par « écran:action » (« students:create »). C'est
 * cette chaîne-là qui est stockée sur la fiche du travailleur, donc renommer un
 * identifiant ici retire silencieusement le droit correspondant : les
 * identifiants ne bougent pas, seuls les libellés le font.
 *
 * L'administration (`role === "admin"`) n'est jamais filtrée : elle voit tout.
 */

import type { ReceptionStaff } from "@/lib/types";
import type { SessionUser } from "@/lib/store/session";

export interface PermissionAction {
  /** identifiant court, unique DANS son écran */
  id: string;
  label: string;
  /** ce que le bouton fait, dit en une ligne à celui qui coche */
  hint?: string;
}

export interface PermissionPage {
  /** la clé de navigation (`lib/nav.ts`) — c'est elle qui est stockée */
  key: string;
  emoji: string;
  label: string;
  href: string;
  /** à quoi sert l'écran, pour celui qui attribue les droits */
  hint: string;
  actions: PermissionAction[];
}

// ---------------------------------------------------------------------------
//  Le catalogue
// ---------------------------------------------------------------------------

export const PERMISSION_PAGES: PermissionPage[] = [
  {
    key: "dashboard",
    emoji: "📊",
    label: "Tableau de bord",
    href: "/dashboard",
    hint: "Les emplois du temps du jour, les feuilles de présence et la caisse.",
    actions: [
      { id: "open_presence", label: "Ouvrir une feuille de présence", hint: "Cliquer un créneau du jour pour l'ouvrir." },
      { id: "mark_presence", label: "Pointer les présences", hint: "Présent / absent / annulé, et corriger un pointage." },
      { id: "collect_payment", label: "Encaisser un paiement d'élève", hint: "Recharger un solde depuis la feuille de présence." },
      { id: "create_student", label: "Créer un élève", hint: "Le bouton « Nouvel élève »." },
      { id: "student_situation", label: "Situation d'un élève", hint: "Le tableau récapitulatif d'un élève." },
      { id: "cash_deposit", label: "Dépôt en caisse" },
      { id: "cash_expense", label: "Saisir une dépense" },
      { id: "cash_withdraw", label: "Retrait de caisse" },
    ],
  },
  {
    key: "classes",
    emoji: "🏫",
    label: "Classes",
    href: "/classes",
    hint: "Les niveaux, les classes et leurs catégories.",
    actions: [
      { id: "create", label: "Créer une classe" },
      { id: "view", label: "Voir le détail d'une classe" },
      { id: "edit", label: "Modifier une classe" },
      { id: "delete", label: "Supprimer une classe" },
    ],
  },
  {
    key: "planner",
    emoji: "📅",
    label: "Emplois du temps",
    href: "/planner",
    hint: "La grille des créneaux, les séances libres et les salles.",
    actions: [
      { id: "create", label: "Créer un emploi du temps" },
      { id: "create_open", label: "Créer un créneau de séance libre" },
      { id: "view", label: "Voir le détail d'un emploi du temps" },
      { id: "edit", label: "Modifier un emploi du temps" },
      { id: "delete", label: "Archiver un emploi du temps" },
      { id: "print", label: "Imprimer un horaire" },
    ],
  },
  {
    key: "subscriptions",
    emoji: "🎫",
    label: "Tarifs & abonnements",
    href: "/subscriptions",
    hint: "Le prix de la séance et du mois, emploi du temps par emploi du temps.",
    actions: [
      { id: "view", label: "Voir le détail d'un abonnement" },
      { id: "edit_price", label: "Créer / modifier un tarif" },
      { id: "archive", label: "Supprimer un abonnement" },
    ],
  },
  {
    key: "students",
    emoji: "🎓",
    label: "Élèves",
    href: "/students",
    hint: "Les fiches des élèves, leurs inscriptions, leurs paiements et leurs dettes.",
    actions: [
      { id: "create", label: "Créer un élève" },
      { id: "view", label: "Voir la fiche d'un élève" },
      { id: "edit", label: "Modifier un élève" },
      { id: "delete", label: "Supprimer un élève" },
      { id: "pay", label: "Payer & recharger les soldes" },
      { id: "charges", label: "Frais & dettes (créer, encaisser)" },
      { id: "edit_payment", label: "Corriger un paiement" },
      { id: "delete_payment", label: "Supprimer un paiement" },
      { id: "print_receipt", label: "Réimprimer le reçu d'un paiement" },
      { id: "print_file", label: "Imprimer la fiche de l'élève" },
      { id: "print_payments", label: "Imprimer le relevé des paiements" },
      { id: "scan", label: "Scanner une carte RFID" },
      { id: "situation", label: "Situation d'un élève" },
      { id: "whatsapp", label: "Envoyer un message WhatsApp" },
    ],
  },
  {
    key: "attendance",
    emoji: "✅",
    label: "Présences",
    href: "/attendance",
    hint: "Les feuilles de présence et l'historique des pointages.",
    actions: [
      { id: "mark", label: "Pointer les présences", hint: "Sans ce droit, l'écran se consulte sans s'écrire." },
      { id: "collect_payment", label: "Encaisser un paiement d'élève", hint: "Recharger un solde depuis la feuille de présence." },
    ],
  },
  {
    key: "teachers",
    emoji: "👨‍🏫",
    label: "Enseignants",
    href: "/teachers",
    hint: "Les fiches des enseignants, leurs parts et leur paie.",
    actions: [
      { id: "create", label: "Créer un enseignant" },
      { id: "create_passager", label: "Créer un enseignant de passage" },
      { id: "view", label: "Voir la fiche d'un enseignant" },
      { id: "edit", label: "Modifier un enseignant" },
      { id: "delete", label: "Supprimer un enseignant" },
      { id: "pay", label: "Régler la paie" },
      { id: "acompte", label: "Verser un acompte" },
      { id: "absence", label: "Enregistrer une absence" },
      { id: "expense", label: "Porter une dépense" },
      { id: "print", label: "Imprimer un rapport de paie" },
    ],
  },
  {
    key: "subjects",
    emoji: "📄",
    label: "Matières & cours",
    href: "/subjects",
    hint: "Les supports de cours publiés aux élèves.",
    actions: [
      { id: "create", label: "Publier un support" },
      { id: "view", label: "Voir un support" },
      { id: "delete", label: "Supprimer un support" },
      { id: "bulk_delete", label: "Suppression groupée" },
    ],
  },
  {
    key: "workers",
    emoji: "👥",
    label: "Travailleurs",
    href: "/workers",
    hint: "Le personnel : métiers, comptes, droits, acomptes, absences et paie.",
    actions: [
      { id: "create", label: "Créer un travailleur" },
      { id: "view", label: "Voir la fiche d'un travailleur" },
      { id: "edit", label: "Modifier un travailleur" },
      { id: "delete", label: "Supprimer un travailleur" },
      { id: "roles", label: "Créer / supprimer un métier" },
      { id: "account", label: "Activer un compte de connexion" },
      { id: "permissions", label: "Attribuer les droits d'accès" },
      { id: "acompte", label: "Verser un acompte" },
      { id: "absence", label: "Enregistrer une absence" },
      { id: "pay", label: "Régler la rémunération" },
      { id: "history", label: "Consulter l'historique de travail" },
      { id: "print", label: "Imprimer un reçu ou une fiche de paie" },
      { id: "scan", label: "Pointage par badge" },
    ],
  },
  {
    key: "independent",
    emoji: "🧩",
    label: "Séances libres",
    href: "/independent",
    hint: "Les séances vendues à l'unité et les séances de groupe.",
    actions: [
      { id: "create", label: "Créer une séance libre" },
      { id: "view", label: "Voir le détail d'une séance" },
      { id: "edit", label: "Modifier une séance" },
      { id: "delete", label: "Supprimer une séance" },
      { id: "print", label: "Réimprimer le reçu" },
    ],
  },
  {
    key: "parents",
    emoji: "👨‍👩‍👧",
    label: "Parents",
    href: "/parents",
    hint: "Les fiches des parents et leurs comptes.",
    actions: [
      { id: "create", label: "Créer un parent" },
      { id: "view", label: "Voir la fiche d'un parent" },
      { id: "edit", label: "Modifier un parent" },
      { id: "delete", label: "Supprimer un parent" },
      { id: "message", label: "Envoyer un message (WhatsApp, notification)" },
    ],
  },
  {
    key: "announcements",
    emoji: "📢",
    label: "Annonces",
    href: "/announcements",
    hint: "Les annonces publiées aux élèves et aux parents.",
    actions: [
      { id: "create", label: "Publier une annonce" },
      { id: "edit", label: "Modifier une annonce" },
      { id: "delete", label: "Supprimer une annonce" },
    ],
  },
  {
    key: "expenses",
    emoji: "🧾",
    label: "Dépenses",
    href: "/expenses",
    hint: "Les dépenses de l'école et leurs catégories.",
    actions: [
      { id: "create", label: "Saisir une dépense" },
      { id: "edit", label: "Modifier une dépense" },
      { id: "delete", label: "Supprimer une dépense" },
    ],
  },
  {
    key: "analytics",
    emoji: "📈",
    label: "Statistiques",
    href: "/analytics",
    hint: "L'affluence des élèves par classe et par enseignant.",
    actions: [{ id: "print", label: "Imprimer la vue" }],
  },
  {
    key: "cash",
    emoji: "💵",
    label: "Caisse",
    href: "/cash",
    hint: "Les mouvements de caisse : dépôts, retraits, dépenses.",
    actions: [
      { id: "deposit", label: "Dépôt en caisse" },
      { id: "withdraw", label: "Retrait de caisse" },
      { id: "edit", label: "Modifier un mouvement" },
      { id: "delete", label: "Supprimer un mouvement" },
    ],
  },
  {
    key: "reports",
    emoji: "💰",
    label: "Rapports",
    href: "/reports",
    hint: "Le bilan de l'école sur une période. Cet écran se consulte ; il n'écrit rien.",
    actions: [],
  },
  {
    key: "settings",
    emoji: "⚙️",
    label: "Paramètres",
    href: "/settings",
    hint: "L'établissement, la sécurité, WhatsApp et les sauvegardes.",
    actions: [
      { id: "school", label: "Établissement", hint: "Nom, logo, coordonnées, identifiants fiscaux." },
      { id: "security", label: "Identifiants & sécurité", hint: "Son propre mot de passe." },
      { id: "whatsapp", label: "Paramètres WhatsApp" },
      { id: "backup", label: "Sauvegarde & données" },
    ],
  },
];

/** L'écran, retrouvé par sa clé. */
export function permissionPage(key: string): PermissionPage | undefined {
  return PERMISSION_PAGES.find((p) => p.key === key);
}

/** « students:create » — la forme sous laquelle un droit d'action est stocké. */
export function actionKey(page: string, action: string): string {
  return `${page}:${action}`;
}

/** Toutes les actions de l'application, cochées d'un coup. */
export function allActionKeys(): string[] {
  return PERMISSION_PAGES.flatMap((p) => p.actions.map((a) => actionKey(p.key, a.id)));
}

export function allPageKeys(): string[] {
  return PERMISSION_PAGES.map((p) => p.key);
}

// ---------------------------------------------------------------------------
//  La lecture des droits
// ---------------------------------------------------------------------------

/**
 * LE MENU QU'AVAIENT LES COMPTES « RÉCEPTION » AVANT LES DROITS D'ACCÈS.
 *
 * Une fiche dont les droits n'ont JAMAIS été réglés (`navKeys` absent, et non
 * vide) garde ce menu-là : la mise à jour ne verrouille personne du jour au
 * lendemain. Dès que l'administration ouvre « Droits d'accès » et enregistre,
 * la fiche porte une liste explicite — fût-elle vide — et c'est elle qui parle.
 */
const LEGACY_RECEPTION_PAGES = [
  "dashboard", "classes", "planner", "subscriptions", "students", "attendance",
  "subjects", "independent", "parents", "announcements", "expenses", "settings",
];

export interface AccessRights {
  /** `true` quand rien n'est filtré (administration, enseignant, élève, parent) */
  unrestricted: boolean;
  /** les écrans autorisés, quand il y a un filtre */
  pages: string[];
  /** les actions autorisées, sous la forme « écran:action » */
  actions: Set<string>;
  /** la fiche du travailleur, quand le compte en est un */
  worker: ReceptionStaff | null;
}

const UNRESTRICTED: AccessRights = {
  unrestricted: true,
  pages: allPageKeys(),
  actions: new Set(),
  worker: null,
};

/**
 * Les droits d'un compte, lus sur sa fiche de travailleur.
 *
 * Seuls les comptes de rôle « reception » — c'est-à-dire les travailleurs — sont
 * filtrés. Un compte sans fiche (créé à la main en base, par exemple) garde
 * l'ancien menu plutôt que de se retrouver devant un écran vide.
 */
export function accessRightsOf(
  user: Pick<SessionUser, "id" | "role" | "entityId"> | null | undefined,
  workers: ReceptionStaff[],
): AccessRights {
  if (!user || user.role !== "reception") return UNRESTRICTED;

  const worker =
    workers.find((w) => w.id === user.entityId) ?? workers.find((w) => w.id === user.id) ?? null;

  // Fiche inconnue, ou fiche dont les droits n'ont JAMAIS été réglés : elle
  // garde l'ancien menu de la réception, tous boutons ouverts. La mise à jour ne
  // verrouille personne du jour au lendemain.
  if (!worker || worker.navKeys === undefined) {
    return {
      unrestricted: false,
      pages: LEGACY_RECEPTION_PAGES,
      actions: new Set(allActionKeys()),
      worker,
    };
  }

  return {
    unrestricted: false,
    pages: worker.navKeys,
    actions: new Set(worker.actionKeys ?? []),
    worker,
  };
}

/** Cet écran est-il visible ? */
export function canSeePage(rights: AccessRights, pageKey: string): boolean {
  return rights.unrestricted || rights.pages.includes(pageKey);
}

/** Ce bouton est-il visible ? Un écran interdit interdit tous ses boutons. */
export function canDoAction(rights: AccessRights, pageKey: string, action: string): boolean {
  if (rights.unrestricted) return true;
  if (!rights.pages.includes(pageKey)) return false;
  return rights.actions.has(actionKey(pageKey, action));
}
