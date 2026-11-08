# ALTECH SCHOOL — Avant / Après — Phase 2

> Date : 2026-11-08. Consigne respectée : **aucun chiffre inventé**. Les mesures
> non disponibles sont marquées **INDISPONIBLE** avec la raison.

## Vérifications exécutées dans cet environnement

| Vérification | Commande | Résultat |
|---|---|---|
| Types | `npx tsc --noEmit` | ✅ 0 erreur |
| Lint (fichiers du lot) | `npx eslint lib/featureFlags.ts lib/repo/students.ts lib/store/data.ts components/providers/SessionProvider.tsx` | ✅ 0 erreur (2 warnings préexistants, lignes non touchées) |
| Build | `npm run build` | ✅ (voir ci-dessous) |
| Tests | `npm test` | 546 passés / 4 échecs **préexistants** + 16 nouveaux passés |

### Les 4 échecs de tests — investigués, NON modifiés
Pré-existants sur `main` (vérifié en phase 1 par `git stash`). Ils portent sur la
**logique métier attendue** :
- `absenceFacturee.test.ts` : `cycleSlots` attend `[present, absent, cancelled]`, reçoit `[present, absent]`.
- `teacherMonths.test.ts`, `teacherPayCases.test.ts`, `teacherPayroll.test.ts` : montants de dette/paie (ex. attendu 1500, reçu 750).

Les « réparer » reviendrait à **modifier des montants financiers / le cycle de
séances** — interdit sans votre accord explicite (exigence non négociable). Ils
sont donc signalés pour **décision métier** : soit le test encode le comportement
voulu (et un correctif de logique est à valider), soit le test est obsolète. Je
n'ai pas tranché à votre place.

## Build (tailles de chunks — référence « avant » câblage)
`npm run build` réussit (30 routes). Les tailles de bundles sont à relever via
la sortie de build / `ANALYZE` avant/après le câblage des lectures ciblées.

## Mesures live (production) — INDISPONIBLE

| Scénario | Statut | Raison |
|---|---|---|
| Login→interactif p50/p95 | INDISPONIBLE | Pas d'identifiants ; ne jamais contourner la connexion |
| Requêtes / octets au démarrage | INDISPONIBLE en live | **Borné analytiquement** (phase 1) ; à mesurer via DevTools |
| Latence navigation / recherche | INDISPONIBLE | Écrans derrière auth |
| Save durable présence / versement | INDISPONIBLE | idem |
| Plans SQL réels | INDISPONIBLE | Nécessite accès base + données |

## Impact attendu, à MESURER sur staging (procédure reproductible)

Ce lot pose les fondations ; les gains se mesurent **au câblage** (drapeaux on) :

1. **Lecture ciblée élèves** (drapeau `scopedStudentReads`) : l'écran liste
   charge **une page** (30 lignes projetées) au lieu de toute la table.
   - Mesure : DevTools → Réseau, octets/requêtes de l'écran Élèves, avant/après.
   - Cible : réduction majeure des octets de cet écran (ne charge plus N×colonnes
     complètes de tous les élèves).
2. **Pagination keyset** : coût constant quelle que soit la profondeur.
   - Mesure : temps de la requête page 1 vs page 100 sur 50k élèves synthétiques
     (staging) ; comparer offset vs keyset.
3. **Écriture atomique** (drapeaux `atomic*`) : un seul aller-retour RPC au lieu
   de 2+ écritures miroir ; « clic → commit durable » confirmé par le retour RPC.
   - Mesure : `performance.now()` autour de l'appel ; vérifier l'absence de
     « versement sans caisse » en coupant le réseau au milieu (staging).

### Jeux de données synthétiques (sans données réelles d'élèves)
Peupler une base **staging** à 1 000 / 10 000 / 50 000 lignes d'historique
(présences, versements) pour comparer :

| Scénario | Avant (à remplir) | Après (à remplir) | Δ |
|---|---|---|---|
| Octets écran Élèves | | | |
| Requêtes écran Élèves | | | |
| Requête liste page 100 (50k) | | | |
| Save versement (clic→commit) | | | |
| Intégrité versement+caisse sous coupure réseau | perte possible (miroir) | atomique (RPC) | |

## Correctif d'intégrité vérifié ici (sans prod)
`SessionProvider` ne reprend plus la synchronisation après un échec de
chargement. Couvert par `tests/loadStatus.test.ts` (le retour `false` de
`fetchAll` est le contrat utilisé pour bloquer `resumeSync`).
