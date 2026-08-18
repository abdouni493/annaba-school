# ALTECH SCHOOL — Gestion d'école privée (démo)

Application de gestion d'école privée (Next.js App Router + TypeScript + Tailwind) :
abonnements (cours & formations) **facturés à la séance ou au mois**, présence par carte RFID,
achats de séances et règlement des restes à payer, paie des enseignants, caisse, dépenses, rapports
financiers, annonces, 5 rôles (admin / réception / enseignant / étudiant / parent), thèmes
clair (par défaut) / sombre et FR/AR (RTL).

> **Mode démo — 100 % en mémoire.** Aucun backend, aucune base de données, aucun appel réseau.
> Toutes les données viennent d'un jeu de constantes (`lib/store/seed.ts`) chargé au démarrage ;
> les modifications vivent dans le store Zustand et disparaissent au rechargement de la page.

## Stack

- **Next.js 16** (App Router) — pages dans `app/`, contenu des modules dans `components/pages/`
- **Zustand** — le store `lib/store/data.ts` est **toute** la couche données + règles métier
- **Tailwind v4**, **framer-motion**, **lucide-react**

## Démarrage

```bash
npm install
npm run dev     # http://localhost:3000 — aucune variable d'environnement requise
```

Autres scripts : `npm run build` (build de production), `npm run test` (vitest), `npm run lint`.

## Connexion — 5 boutons de démo

L'application démarre déconnectée sur `/login`. Un bouton par rôle connecte instantanément à un
compte pré-rempli du jeu de données et redirige vers l'accueil correspondant :

| Bouton                    | Rôle        | Compte démo                                       |
| ------------------------- | ----------- | ------------------------------------------------- |
| Administrateur            | `admin`     | Direction Altech School                           |
| Réception (Travailleurs)  | `reception` | Amina Haddad                                      |
| Enseignant                | `teacher`   | Karim Bensalah (payé au pourcentage)              |
| Étudiant                  | `student`   | Yacine Meziane                                    |
| Parent                    | `parent`    | Nadia Meziane (parent de 2 élèves)                |

Le formulaire email/mot de passe accepte n'importe quel mot de passe pour l'une de ces adresses.

## Le système de séances

Le solde en dinars a disparu. Un élève **achète des séances**, module par module, et chaque
présence en consomme une.

### Abonnements

Le prix se règle **par séance** dans **Abonnements** (`pricePerSession`). Un cours peut en plus être
vendu **au mois** : on saisit le nombre de séances comprises dans le mois (`monthlySeances`) et le
prix de ce mois (`monthlyPrice`, pré-rempli avec le total calculé `séances × prix unitaire` et
librement modifiable — un pack est souvent moins cher que ses séances à l'unité). Les formations
gardent leur prix de niveau et leur durée en mois, qui pilote la date d'expiration.

### Deux formules, choisies à l'inscription

Fiche élève → **Inscriptions** : pour chaque module coché, la réception choisit la formule.

| Formule       | Ce qui est vendu                    | Expiration                                                       |
| ------------- | ----------------------------------- | ---------------------------------------------------------------- |
| **À la séance** | N séances à l'unité               | aucune — les séances restent acquises                            |
| **Au mois**     | le pack du mois, à son prix       | **un mois pile** après la date de début (aujourd'hui par défaut, modifiable) |

Un abonnement mensuel **expire à sa date de fin quoi qu'il arrive** : les séances non consommées
sont perdues, la carte est refusée sur ce module et il faut renouveler le mois. Un renouvellement
**remet le compteur à zéro** sur le nouveau pack (`plan`, `monthSeances` et `expiryDate` de
l'inscription).

### Acheter des séances ou un mois (réception)

Depuis la fiche élève → **Payer des séances ou un mois** :

```
module d'inscription  →  à la séance : N séances  →  brut = N × prix unitaire
                      →  au mois     : date de début  →  brut = prix du mois, fin = +1 mois
                      →  remise (% ou montant fixe)  →  net
                      →  montant payé  →  reste à payer = net − payé
```

L'achat crédite `paidSeances` sur l'inscription (ou la réinitialise pour un mois) et écrit un
`Payment`. Le **reste à payer** de tous les paiements constitue la **dette** de l'élève : la carte
affiche une alerte rouge et l'action **Régler Dette** solde les restes du plus ancien au plus récent.

### Présence

Scan RFID et feuille de présence manuelle appliquent la même règle :

- élève gratuit, période gratuite ou abonnement pas encore commencé → présence enregistrée,
  **aucune séance décomptée** ;
- sinon → **séances restantes − 1**, jamais d'argent ;
- l'enseignant payé au pourcentage touche sa part du prix net de la séance, comme avant ;
- plus aucune séance restante → l'élève est **quand même accepté**, la présence est signalée comme
  « à régulariser » ;
- abonnement **expiré** (mois écoulé ou formation terminée) → carte refusée, et les séances qui
  restaient sur l'inscription ne sont plus décomptables : elles sont perdues.

Annuler une présence ou marquer un élève absent **rend** la séance et retire la part enseignant.

### Alertes

Séances épuisées, inscription à 2 séances ou moins, abonnement mensuel ou formation bientôt expiré
(ou déjà expiré, avec les séances perdues), et reste à payer non réglé : signalés dans les toasts du
scan, sur la carte élève, dans le détail de la fiche, et dans les espaces étudiant et parent.

## Structure

| Domaine                          | Fichiers                                                              |
| -------------------------------- | --------------------------------------------------------------------- |
| Données + règles métier          | `lib/store/data.ts`, jeu de données `lib/store/seed.ts`                |
| Session / comptes démo           | `lib/store/session.ts`, `lib/demoAccounts.ts`, `app/(auth)/login/`     |
| Types & sélecteurs               | `lib/types.ts`, `lib/helpers.ts`                                       |
| Élèves (achat, dette, détail)    | `components/pages/StudentsPage.tsx`                                    |
| Présence / scan                  | `components/pages/AttendancePage.tsx`, `lib/useScanProcessor.ts`       |
| Espaces étudiant / parent        | `components/pages/StudentPages.tsx`, `components/pages/ParentPages.tsx` |

L'application n'affiche **aucun favicon** : l'onglet du navigateur reste sans icône. Le logo
téléversé dans **Paramètres** ne sert que dans l'application et sur les documents imprimés.
