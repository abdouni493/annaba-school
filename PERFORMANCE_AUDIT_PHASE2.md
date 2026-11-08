# ALTECH SCHOOL — Audit de performance & sécurité — Phase 2

> Date : 2026-11-08 · Branche : `perf/phase2-scalable-data-and-secure-writes`
> Suite de PHASE 1 (PR #1, mergée). Distingue **vérifié**, **probable**, **inconnu**.

## 1. État après Phase 1

Phase 1 a corrigé la pagination (ordre stable, concurrence bornée) et le
signalement d'erreur de chargement. **Les causes architecturales majeures
restaient** : hydratation complète au login, écriture par miroir, RLS ouverte.

## 2. Matrice des causes racines (Phase 2, `fichier:ligne`)

| # | Constat vérifié | Preuve | Priorité | Sévérité |
|---|---|---|---|---|
| S1 | **Lecture ouverte** `using (true)` sur tables sensibles | `schema.sql` §5 (lignes 1475/1485) | P0 | 🔴 Critique (confidentialité) |
| S2 | Hydratation complète → élève/parent **téléchargent toute la base** | `load.ts loadDatabase()` + `SessionProvider.tsx:65` | P0/P1 | 🔴 Critique |
| S3 | Mot de passe **en clair** `student_credentials.password` | `schema.sql` (table), `StudentsPage.tsx:1384` | P0 | 🟠 Élevé |
| R1 | **Sync reprend après un chargement raté** | `SessionProvider.tsx` (avant correctif) : `resumeSync()` appelé même si `fetchAll` a échoué | P1 | 🔴 Critique (intégrité) |
| W1 | Écriture multi-tables **non atomique** (versement + caisse séparés) | `data.ts` (ex. `:2525/:2548` push payments puis cash) ; `sync.ts` miroir par table | P1 | 🟠 Élevé |
| W2 | Pas d'idempotence ni de verrou → risque double-crédit / rejeu | `sync.ts` (retry ligne par ligne) | P1 | 🟠 Élevé |
| C1 | **75** `useData()` sans sélecteur dans **45** fichiers | `grep useData()` | P2 | 🟠 Élevé |
| U1 | Upload « lent » = en réalité save d'enregistrement via miroir (probable) | pas de flux Storage dédié mesuré | P2 | ⚪ À vérifier |

### Détail R1 (corrigé dans ce lot)
`fetchAll()` attrape son erreur et **se résout quand même**. Avant ce lot,
`SessionProvider` appelait `resumeSync()` dans le `.then()` sans vérifier le
succès : sur un échec de lecture, le miroir reprenait sur un magasin vide et
pouvait **réécrire des suppressions** vers Supabase. Risque d'intégrité réel.

## 3. Ce qui est IMPLÉMENTÉ et testé dans ce lot

1. **R1 — Garde de synchronisation** : `fetchAll()` renvoie désormais un booléen
   de succès ; `SessionProvider` ne reprend le miroir que si la lecture a réussi
   (`components/providers/SessionProvider.tsx`). Tests :
   `tests/loadStatus.test.ts` (contrat de retour).
2. **S2/P1 — Fondation de lecture ciblée** : `lib/repo/students.ts` — liste
   paginée **par clé (keyset)**, **projection de colonnes**, recherche par
   préfixe, **sans count exact**, + `getStudent` à la demande. Tests :
   `tests/repoStudents.test.ts` (8 tests).
3. **Déploiement progressif** : `lib/featureFlags.ts` — drapeaux (tous `false`
   par défaut) pour activer lecture ciblée et RPC **sans double écriture** et
   avec retour arrière immédiat.

> Ces changements de code **ne modifient aucun comportement en production** tant
> que les drapeaux restent `false` ; ils fournissent la base vérifiable des
> prochaines étapes.

## 4. Ce qui est LIVRÉ en SQL (manuel, non appliqué)

- `01_access_policies.sql` — **RLS par rôle** (corrige S1/S3) + vue annuaire.
- `02_atomic_operations.sql` — **RPC transactionnels** idempotents (corrige W1/W2).
- `03_targeted_indexes.sql` — index keyset + RLS.
- `04_credentials_transition.sql` — reset via Supabase Auth, sans clair.
- `00_read_only_diagnostics.sql` — diagnostics sécurité (lecture seule).

## 5. Décisions et garde-fous

- **La RLS ne peut pas être resserrée avant** que les portails lisent de façon
  ciblée (sinon écrans vides). D'où la livraison SQL + ordre strict du runbook.
- **Aucune formule financière changée.** Les RPC committent des lignes **déjà
  calculées par le client**, ils ne recalculent rien.
- **Pas de double écriture** : drapeaux off = ancien miroir ; drapeaux on =
  RPC ; jamais les deux pour une même opération.

## 6. Problèmes non résolus (risque)

| Sujet | Risque | Prochaine étape |
|---|---|---|
| Hydratation complète encore active par défaut | 🔴 | Brancher le repository dans les écrans derrière le drapeau, écran par écran |
| RLS non appliquée | 🔴 | Étape 6 du runbook après code scoper + tests JWT |
| Écritures encore via miroir | 🟠 | Brancher `record_tuition_payment`/`reverse_payment` derrière drapeaux |
| Rerenders `useData()` | 🟠 | Sélecteurs granulaires + `useShallow` (mesure React Profiler) |
| 4 tests métier en échec (préexistants) | 🟡 | **Décision métier requise** (changent des montants) — voir before/after |
| Uploads/Storage | ⚪ | Mesurer séparément (bloc diagnostics + DevTools) |

## 7. Milestone atteint et suivant

**Milestone livré** : fondation sécurisée (SQL RLS/RPC prêts), fondation de
lecture ciblée (repository + drapeaux), et **correctif d'intégrité** (pas de sync
après échec), le tout testé, construit, poussé en branche de revue.

**Milestone suivant** : câbler le repository dans `StudentsPage` (liste) derrière
`scopedStudentReads`, mesurer avant/après sur staging 1k/10k/50k, puis appliquer
la RLS (runbook étape 6).
