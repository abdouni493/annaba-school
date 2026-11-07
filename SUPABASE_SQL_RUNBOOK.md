# ALTECH SCHOOL — Runbook SQL (exécution MANUELLE dans Supabase)

> Date : 2026-11-07. Ce runbook est destiné à **VOUS**, administrateur. Rien
> ici n'est exécuté automatiquement. Les scripts sont séparés en
> **diagnostics (lecture seule)** et **changements (DDL/policies)**.
>
> **Préflight obligatoire avant tout changement :**
> 1. **Sauvegarde** : Supabase → Database → Backups (ou `pg_dump`). Vérifier
>    qu'une sauvegarde récente existe.
> 2. Exécuter d'abord **toute** la section 1 (diagnostics) et **conserver les
>    sorties**. Elles justifient les index et serviront de « avant ».
> 3. Appliquer les changements **aux heures creuses**.
> 4. Les scripts sont **idempotents** (`IF NOT EXISTS` / `OR REPLACE`) :
>    réexécutables sans dommage.

---

## Section 1 — DIAGNOSTICS (lecture seule, aucun risque)

Fichier : `supabase/performance/01_diagnostics_read_only.sql`

Coller le fichier dans **SQL Editor**, puis exécuter **bloc par bloc** (1→9).
Aucune de ces requêtes n'écrit dans la base.

| Bloc | Donne | À noter |
|---|---|---|
| 1 | Taille des tables + index | Tables les plus lourdes (cibles de la lecture à la demande) |
| 2 | Lignes des tables lourdes | Volume téléchargé aujourd'hui au login |
| 3 | Index existants | **Ne pas recréer** un index déjà listé |
| 4 | Usage des index | `idx_scan = 0` → index inutile |
| 5 | Bloat / autovacuum | `dead_pct` élevé → planifier un VACUUM (hors runbook) |
| 6 | seq_scan vs idx_scan | `seq_scan` élevé sur grosse table = plein scan |
| 7 | pg_stat_statements | Requêtes les plus coûteuses (si extension active) |
| 8 | Policies RLS | Repérer `using (true)` (confidentialité) |
| 9 | EXPLAIN (sans ANALYZE) | Plan d'une page de chargement |

**Résultat attendu** : vous obtenez les tailles réelles, le nombre de requêtes
de démarrage, et la liste des index déjà présents.

---

## Section 2 — INDEX ADDITIFS (changement, sûr en ligne)

Fichier : `supabase/migrations/2026-11-07_performance_indexes.sql`

> ⚠️ **Utilité différée** : ces index servent les lectures **filtrées/paginées**
> introduites côté app (feuille de route). Ils sont inoffensifs avant, mais
> n'accéléreront le **login** que lorsque le code scoper sera déployé.

> ⚠️ **`CREATE INDEX CONCURRENTLY` ne peut PAS tourner dans une transaction.**
> Dans SQL Editor, exécuter **chaque instruction séparément** (sélectionner une
> ligne `create index concurrently ...`, Run), pas tout le fichier d'un bloc.

Instructions à lancer **une par une** (section A/B/C du fichier) :

```sql
create index concurrently if not exists idx_payments_date_desc            on public.payments (date desc);
create index concurrently if not exists idx_cash_date_desc                on public.cash_transactions (date desc);
create index concurrently if not exists idx_attendance_occurred_desc      on public.attendance_records (occurred_at desc);
create index concurrently if not exists idx_attendance_student_occurred   on public.attendance_records (student_id, occurred_at desc);
create index concurrently if not exists idx_students_lastname_lower       on public.students (lower(last_name) text_pattern_ops);
create index concurrently if not exists idx_students_firstname_lower      on public.students (lower(first_name) text_pattern_ops);
```

**Validation** (lecture seule) :
```sql
select indexname, indexdef from pg_indexes
where schemaname='public' and indexname in (
  'idx_payments_date_desc','idx_cash_date_desc','idx_attendance_occurred_desc',
  'idx_attendance_student_occurred','idx_students_lastname_lower','idx_students_firstname_lower'
);
-- Attendu : 6 lignes. Un index resté « INVALID » (échec CONCURRENTLY) se voit via :
select indexrelid::regclass, indisvalid from pg_index where not indisvalid;
-- Attendu : 0 ligne. Si un index est invalide, le DROP puis recréer.
```

**Rollback** (une par une, hors transaction) :
```sql
drop index concurrently if exists public.idx_payments_date_desc;
drop index concurrently if exists public.idx_cash_date_desc;
drop index concurrently if exists public.idx_attendance_occurred_desc;
drop index concurrently if exists public.idx_attendance_student_occurred;
drop index concurrently if exists public.idx_students_lastname_lower;
drop index concurrently if exists public.idx_students_firstname_lower;
```

> Base encore petite / fenêtre de maintenance : utiliser la variante **sans**
> `CONCURRENTLY` (en commentaire dans le fichier) — tout le fichier passe alors
> d'un bloc, verrou bref.

---

## Section 3 — OPTIMISATION RLS « InitPlan » (changement de policies)

Fichier : `supabase/migrations/2026-11-07_rls_initplan_optimization.sql`

Ce script **ne change pas les droits** : il enveloppe `is_staff()` /
`is_staff_or_teacher()` dans un sous-SELECT pour qu'ils soient évalués **une
fois par instruction** au lieu d'une fois par ligne. Gain sur les upserts/deletes
groupés produits par `lib/supabase/sync.ts`.

1. Exécuter **tout le bloc `do $$ ... $$;`** (il peut tourner dans une
   transaction — ce n'est pas du CONCURRENTLY).
2. **Validation** (déjà incluse en fin de fichier) :
   ```sql
   select tablename, policyname, qual, with_check
   from pg_policies
   where schemaname='public' and policyname like '%\_write'
   order by tablename;
   ```
   Attendu : les expressions contiennent `(SELECT ...)`.
3. **Test fonctionnel** : se connecter en **réception** → créer/modifier un
   élève (doit réussir) ; en **enseignant** → remplir une présence (doit
   réussir) ; en **élève/parent** → aucune écriture possible (inchangé).
4. **Rollback** : bloc commenté en fin de fichier (restaure l'appel direct).

---

## Section 4 — NON inclus ici (étapes dédiées, voir CHANGELOG)

- **Durcissement RLS SELECT** (`using (true)` → par rôle/propriétaire) :
  à faire **seulement après** le passage des portails en lecture scoper, sinon
  les écrans élève/parent actuels (qui lisent tout) casseraient.
- **RPC transactionnels** pour versement/caisse/solde/part enseignant :
  migrations à écrire et tester sur staging avant tout apply prod.

---

## Ordre d'exécution recommandé

1. Préflight (sauvegarde).
2. Section 1 — diagnostics (lecture seule) → conserver les sorties.
3. Section 3 — RLS InitPlan (gain immédiat sur les écritures, sans risque de droits).
4. Section 2 — index additifs (après déploiement du code de lecture filtrée pour
   qu'ils servent ; sinon les poser quand même, ils sont inoffensifs).
5. Re-lancer les blocs 4 et 6 des diagnostics pour comparer (« après »).

## État d'application

| Script | Type | Appliqué en PROD ? |
|---|---|---|
| `01_diagnostics_read_only.sql` | Lecture seule | ❌ (à lancer par vous) |
| `2026-11-07_performance_indexes.sql` | DDL additif | ❌ NON appliqué |
| `2026-11-07_rls_initplan_optimization.sql` | Policies | ❌ NON appliqué |
