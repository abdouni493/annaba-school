# ALTECH SCHOOL — Journal des changements de performance

> Date : 2026-11-07 · Branche : `claude/nifty-darwin-mkcepx`

## Changements de code appliqués (sûrs, testés, sans impact métier)

### 1. `lib/supabase/load.ts`
- **Ordre stable sur la clé primaire** pour chaque page lue
  (`.order(spec.pk, { ascending: true })`), sur la première page comme sur les
  suivantes. Rend la pagination par offset **déterministe** : sous insertions
  concurrentes, plus aucune ligne dupliquée ni escamotée. La PK étant déjà un
  index unique, aucun index supplémentaire n'est nécessaire.
- **Concurrence bornée** : les pages restantes d'une grosse table sont lues par
  vagues de `PAGE_CONCURRENCY = 6` via `mapWithConcurrency`, au lieu d'un
  `Promise.all` illimité qui pouvait ouvrir des dizaines de requêtes simultanées
  et saturer le navigateur / le pool PostgREST. L'ordre des résultats est
  préservé.
- **Compatibilité** : aucune signature publique modifiée (`loadDatabase`,
  `loadSchool`, `emptyDatabase` inchangées). Le format des données renvoyées est
  identique.

### 2. `lib/store/data.ts`
- **État de chargement explicite** `loadStatus: 'idle' | 'loading' | 'success' | 'error'`
  (nouveau type exporté `LoadStatus`).
- `fetchAll()` ne pose plus `loaded: true` en cas d'échec. Désormais :
  `loading` au départ, `success` + `loaded:true` **uniquement** après lecture
  réussie, `error` + `loaded:false` en cas d'échec, avec un **toast d'erreur**
  explicite. Fin du comportement dangereux où un échec s'affichait comme « base
  vide chargée avec succès ».
- `clear()` et `reset()` remettent `loadStatus` à `idle`.
- **Compatibilité** : `loaded` existe toujours et garde sa sémantique « prêt »
  pour les consommateurs existants (`components/layout/AppShell.tsx:25`), mais
  n'est plus vrai à tort. Aucune règle de calcul (paie, soldes, frais) touchée.

### 3. Tests ajoutés
- `tests/loadPagination.test.ts` — ordre stable exigé sur chaque table,
  reconstitution multi-pages dans l'ordre, table absente → liste vide, erreur
  réelle → exception.
- `tests/loadStatus.test.ts` — machine d'état `fetchAll` ; un échec ne marque
  jamais `loaded:true`.

## Changements SQL livrés (NON appliqués en prod — exécution manuelle)
- `supabase/performance/01_diagnostics_read_only.sql`
- `supabase/migrations/2026-11-07_performance_indexes.sql`
- `supabase/migrations/2026-11-07_rls_initplan_optimization.sql`
- Procédure dans `SUPABASE_SQL_RUNBOOK.md`.

---

## Étapes suivantes recommandées (conception, migration INCRÉMENTALE)

Ces chantiers sont volontairement **non** inclus dans ce lot car ils touchent
beaucoup de surface et exigent des mesures live pour être validés sans régression.

### A. Lecture scoper par rôle/écran (remplace l'hydratation totale)
- Introduire une **couche repository typée** (`lib/repo/*.ts`) exposant des
  lectures bornées : `listStudents({ query, page, pageSize })`,
  `recentPayments({ studentId, before, limit })`, résumés de tableau de bord
  agrégés côté serveur.
- Adopter **TanStack Query** (ou équivalent justifié) pour la déduplication, le
  `staleTime`, la revalidation en arrière-plan, les clés de requête et
  l'invalidation précise. **Garder Zustand** pour l'état UI local et le petit
  état partagé — pas pour répliquer la base.
- Migrer **écran par écran** derrière un *feature flag* : tant que le flag est
  off, l'app garde le miroir actuel ; aucun intervalle où ancien miroir et
  nouveau chemin écrivent la même opération.

### B. Durcir la RLS SELECT (confidentialité D2) — APRÈS A
Une fois les portails élève/parent passés en lecture scoper, remplacer les
`using (true)` par des prédicats par rôle/propriétaire (ex. un parent ne lit que
ses enfants). À ne faire qu'après A, sinon les portails actuels (qui lisent
tout) casseraient.

### C. Mutations transactionnelles via `rpc()`
Pour chaque opération multi-tables (versement + mouvement de caisse + solde
élève + part enseignant ; annulations ; règlement de salaire), écrire une
fonction PostgreSQL **une transaction ACID**, avec validation des entrées,
contrôle d'autorisation interne, **clé d'idempotence**, verrouillage anti
double-crédit, et retour des lignes à jour. Remplacer progressivement le miroir
pour ces chemins critiques, jamais en double écriture.

### D. Isolation des rerenders (C1)
Convertir les `useData()` sans sélecteur des pages chaudes
(`StudentsPage`, `AttendancePage`, `CashPage`, `PresenceSheet`, …) en sélecteurs
granulaires + `useShallow`, déplacer filtrage/tri/agrégation hors du rendu
(maps indexées), virtualiser les longues listes. Valider au React Profiler.
