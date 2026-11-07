# ALTECH SCHOOL — Audit de performance et de fiabilité

> Date : 2026-11-07 · Branche : `claude/nifty-darwin-mkcepx`
> Portée : audit du dépôt réel + corrections sûres implémentées + SQL à appliquer manuellement.

Ce document distingue explicitement **constats vérifiés** (lus dans le code / le
schéma), **causes probables** (cohérentes avec le code mais non mesurées sur la
prod) et **inconnues** (nécessitent un accès authentifié ou des métriques live
que je n'ai pas).

---

## 1. Architecture actuelle (vérifiée dans le code)

L'application est une SPA Next.js App Router où **tout l'état métier vit dans un
unique store Zustand** (`lib/store/data.ts`, ~5 050 lignes, 42 collections) et
où la persistance se fait par **miroir** :

| Étape | Fichier | Mécanisme |
|---|---|---|
| Connexion → init session | `components/providers/SessionProvider.tsx:60-66` | `startSync()` puis `fetchAll()` |
| Chargement | `lib/store/data.ts` → `fetchAll()` → `loadDatabase()` | lit **toutes** les tables |
| Lecture base | `lib/supabase/load.ts` | `select('*')` paginé par 1000, toutes tables en parallèle |
| Écriture | `lib/supabase/sync.ts` | s'abonne au store, **diffe** les collections et renvoie ce qui a changé |

**Conséquence structurelle** : chaque navigateur connecté (y compris un compte
**élève** ou **parent**) télécharge **la base entière** de l'école au démarrage,
puis la conserve en mémoire. Le temps de connexion et l'empreinte réseau
croissent donc **linéairement avec l'historique** (présences, versements,
caisse) — exactement le symptôme rapporté.

---

## 2. Matrice des causes racines (constats vérifiés, `fichier:ligne`)

| # | Constat (vérifié) | Preuve | Sévérité | Impact |
|---|---|---|---|---|
| A1 | **Hydratation de toute la base** au login | `load.ts` `loadDatabase()` lit `COLLECTION_ORDER` en entier ; `SessionProvider.tsx:63` appelle `fetchAll()` | 🔴 Critique | Login/octets/RAM croissent avec l'historique |
| A2 | `count: "exact"` sur chaque grosse table | `load.ts:87` | 🟠 Élevé | Count exact = scan ; coût par table |
| A3 | **Pagination par offset sans ordre stable** | `load.ts` (avant correctif) `select('*').range()` sans `order` | 🟠 Élevé | Lignes dupliquées/perdues sous insertions concurrentes |
| A4 | `Promise.all` **non borné** sur les pages restantes | `load.ts` (avant correctif) | 🟡 Moyen | Saturation connexions navigateur / pool PostgREST |
| A5 | `fetchAll()` posait `loaded:true` **même en cas d'échec** | `data.ts` `fetchAll` (avant correctif) | 🔴 Critique (fiabilité) | Un échec de lecture s'affichait comme « base vide chargée » |
| B1 | Écriture par **diff de tout le store** + `JSON.stringify` par ligne modifiée | `sync.ts:103` | 🟠 Élevé | Temps CPU sur le thread principal à chaque mutation |
| B2 | File **sérialisée** + retry **ligne par ligne séquentiel** | `sync.ts` `upsertRows`, `runFlush` | 🟠 Élevé | Latence « clic → commit durable » ; aucune garantie ACID multi-tables |
| B3 | Pas de distinction **« UI à jour » vs « persisté serveur »** | `sync.ts` (toast « en attente » seulement sur échec) | 🟠 Élevé | Risque de croire « enregistré » alors que l'écriture est en vol |
| C1 | **75 appels** `useData()` **sans sélecteur** dans **45 fichiers** | `grep useData()` (ex. `StudentsPage`, `AttendancePage`, `CashPage`, `PresenceSheet.tsx:201…`) | 🟠 Élevé | Chaque composant se réabonne à **tout** le store → rerenders massifs |
| D1 | RLS : prédicats d'écriture appellent `is_staff()` **par ligne** | `schema.sql` §5 (`using (public.is_staff())`) | 🟡 Moyen | Coût par ligne sur upsert/delete groupés |
| D2 | RLS : SELECT **`using (true)`** sur tables financières/élèves | `schema.sql:1475,1485` | 🔴 Critique (confidentialité) | Tout compte connecté peut lire toutes les lignes |
| E1 | Un seul chemin d'upload/sauvegarde indifférencié | miroir `sync.ts` (pas de flux fichiers séparé mesuré) | ⚪ À vérifier | « uploading » = save d'enregistrement, pas un upload fichier (probable) |

### Détail D2 — confidentialité (constat vérifié, NON corrigé ici)
`schema.sql:1475` et `:1485` créent, pour **toutes** les tables de
`staff_write`/`teacher_write`, une policy `for select to authenticated using
(true)`. Combiné à l'hydratation complète (A1), **un compte élève ou parent
connecté télécharge l'intégralité des données financières de l'école**. C'est le
risque le plus grave de l'audit. Il n'est **pas** corrigé dans ce lot car le
durcir sans connaître précisément les requêtes des portails pourrait casser ces
écrans ; la correction est décrite comme étape dédiée dans le runbook et le
changelog (lecture scoper par rôle AVANT de restreindre la RLS).

---

## 3. Causes probables (cohérentes, non mesurées sur prod)

- La vérification `client.ts` vs en-tête `schema.sql` : `client.ts` embarque un
  projet par défaut (`vkdbinhvkswjoafcvhos`) ; l'en-tête de `schema.sql`
  mentionne une autre référence. **Non prouvé en live** : il faut confirmer que
  Vercel définit bien `NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY` vers le projet
  voulu (variables d'env Vercel). À vérifier manuellement — ne JAMAIS committer
  ces valeurs.
- Région Supabase vs région des fonctions Vercel : non mesurée. Le waterfall
  réseau dépend de la distance client↔Supabase.

## 4. Inconnues (nécessitent accès/métriques)

- p50/p95 réels en prod (pas d'accès authentifié) — voir `PERFORMANCE_BEFORE_AFTER.md`.
- `pg_stat_statements` / tailles réelles des tables — fournis en SQL à lancer (bloc 1/2/7 des diagnostics).
- Fréquence réelle des retries `sync.ts` en prod.

---

## 5. Corrections implémentées dans ce lot (sûres, testées)

Voir `PERFORMANCE_CHANGELOG.md` pour le détail fichier par fichier.

1. **A3 — Ordre stable** : `load.ts` trie désormais chaque page sur la clé
   primaire (`.order(spec.pk)`), ce qui rend la pagination déterministe sous
   insertions concurrentes (plus de perte/doublon). La PK étant déjà un index
   unique, aucun index supplémentaire n'est requis.
2. **A4 — Concurrence bornée** : les pages restantes sont lues par vagues de 6
   (`mapWithConcurrency`) au lieu d'un `Promise.all` illimité.
3. **A5 — État de chargement explicite** : `data.ts` expose `loadStatus`
   (`idle|loading|success|error`) ; `loaded` ne vaut `true` qu'en cas de succès
   réel, et un échec remonte un toast au lieu d'afficher une base vide.

Ces trois corrections **ne changent aucune règle métier** et sont couvertes par
de nouveaux tests (`tests/loadPagination.test.ts`, `tests/loadStatus.test.ts`).

## 6. Changements SQL proposés (à appliquer MANUELLEMENT)

- `supabase/performance/01_diagnostics_read_only.sql` — diagnostics lecture seule.
- `supabase/migrations/2026-11-07_performance_indexes.sql` — index additifs pour
  les lectures **filtrées/paginées** (sans effet tant que le code scoped n'est
  pas déployé ; sûrs en ligne via `CONCURRENTLY`).
- `supabase/migrations/2026-11-07_rls_initplan_optimization.sql` — enveloppe
  `is_staff()` en sous-SELECT (InitPlan) **sans changer les droits**.

> ⚠️ Les index de date n'accélèrent **pas** le chargement actuel (plein scan
> `SELECT *`). Ils ne deviennent utiles qu'avec le passage en lecture à la
> demande. **Ne pas** multiplier les index en espérant régler le login : le
> vrai correctif est architectural (ne plus tout télécharger).

---

## 7. Feuille de route recommandée (par impact/risque)

| Priorité | Action | Risque | Statut |
|---|---|---|---|
| P0 | Ne plus déclarer un échec comme succès (A5) | Faible | ✅ Fait |
| P0 | Ordre stable + concurrence bornée (A3/A4) | Faible | ✅ Fait |
| P1 | Lecture **scoper par rôle/écran**, paginée (A1) | Moyen | 🔜 Esquissé (repository + TanStack Query), migration incrémentale |
| P1 | Durcir la RLS SELECT après lecture scoper (D2) | Élevé | 🔜 Décrit, non appliqué |
| P2 | Mutations transactionnelles via `rpc()` pour les opérations multi-tables (B1/B2) | Moyen | 🔜 Décrit |
| P2 | Sélecteurs Zustand granulaires sur les pages chaudes (C1) | Moyen | 🔜 Décrit |
| P3 | Index additifs + InitPlan RLS (D1) | Faible | 🔜 SQL fourni, apply manuel |

Le détail de conception (couche repository typée, politique de cache, RPC ACID
avec clés d'idempotence, virtualisation des listes) est documenté dans
`PERFORMANCE_CHANGELOG.md` §« Étapes suivantes » pour une migration
**incrémentale** — pas une réécriture « big-bang » des 5 000 lignes de logique
métier.
