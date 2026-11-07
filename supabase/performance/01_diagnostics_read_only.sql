-- =============================================================================
-- ALTECH SCHOOL — DIAGNOSTICS DE PERFORMANCE (LECTURE SEULE)
-- =============================================================================
-- À coller dans Supabase → SQL Editor. AUCUNE de ces requêtes ne modifie la
-- base : pas d'INSERT/UPDATE/DELETE, pas de DDL, pas d'ANALYZE. Elles sont donc
-- sûres à lancer en production, aux heures creuses de préférence (certaines
-- balaient des catalogues système).
--
-- Exécuter chaque bloc SÉPARÉMENT (sélectionner le bloc, « Run »), et conserver
-- les sorties : elles alimentent PERFORMANCE_BEFORE_AFTER.md et justifient
-- chaque index proposé dans supabase/migrations/.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. TAILLE DES TABLES ET DE LEURS INDEX
-- -----------------------------------------------------------------------------
-- But : savoir CE QUI est gros. La lenteur de connexion vient du téléchargement
-- intégral de ces tables dans le navigateur ; les plus volumineuses (présences,
-- versements, caisse) sont les premières à passer en lecture à la demande.
-- Lecture : total_bytes = table + index + TOAST. Un ratio index/table élevé sur
-- une table peu interrogée signale du sur-indexage (écritures ralenties).
select
  c.relname                                            as table_name,
  pg_size_pretty(pg_total_relation_size(c.oid))        as total_size,
  pg_size_pretty(pg_table_size(c.oid))                 as table_size,
  pg_size_pretty(pg_indexes_size(c.oid))               as indexes_size,
  c.reltuples::bigint                                  as est_rows
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by pg_total_relation_size(c.oid) desc;


-- -----------------------------------------------------------------------------
-- 2. NOMBRE DE LIGNES EXACT DES TABLES « LOURDES »
-- -----------------------------------------------------------------------------
-- But : mesurer combien de lignes chaque navigateur télécharge aujourd'hui au
-- démarrage (le code lit TOUT, page de 1000). Ajuster la liste au besoin.
select 'attendance_records' as t, count(*) from public.attendance_records
union all select 'payments',           count(*) from public.payments
union all select 'cash_transactions',  count(*) from public.cash_transactions
union all select 'students',           count(*) from public.students
union all select 'enrollments',        count(*) from public.enrollments
union all select 'student_charges',    count(*) from public.student_charges
union all select 'unpaid_teacher_sessions', count(*) from public.unpaid_teacher_sessions
order by 2 desc;


-- -----------------------------------------------------------------------------
-- 3. INDEX EXISTANTS (pour NE PAS en recréer un en double)
-- -----------------------------------------------------------------------------
-- But : inventaire avant toute proposition d'index. Comparer à
-- supabase/migrations/2026-11-07_performance_indexes.sql : tout index déjà
-- présent ici ne doit PAS être recréé.
select
  schemaname, tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
order by tablename, indexname;


-- -----------------------------------------------------------------------------
-- 4. UTILISATION DES INDEX — lesquels ne servent à RIEN
-- -----------------------------------------------------------------------------
-- But : un index jamais balayé (idx_scan = 0) coûte en écriture et en espace
-- sans rien rapporter : candidat à la suppression (à valider sur la durée).
-- idx_scan élevé = index utile, à conserver.
select
  relname        as table_name,
  indexrelname   as index_name,
  idx_scan       as times_used,
  pg_size_pretty(pg_relation_size(indexrelid)) as index_size
from pg_stat_user_indexes
where schemaname = 'public'
order by idx_scan asc, pg_relation_size(indexrelid) desc;


-- -----------------------------------------------------------------------------
-- 5. SANTÉ DES TABLES — morts-vivants (bloat) et autovacuum
-- -----------------------------------------------------------------------------
-- But : un fort n_dead_tup ralentit les lectures séquentielles (exactement ce
-- que fait le chargement intégral). Si last_autovacuum est ancien et n_dead_tup
-- élevé, un VACUUM (hors de ce fichier, car il écrit) sera à planifier.
select
  relname                       as table_name,
  n_live_tup                    as live_rows,
  n_dead_tup                    as dead_rows,
  case when n_live_tup > 0
       then round(100.0 * n_dead_tup / n_live_tup, 1) else 0 end as dead_pct,
  last_autovacuum,
  last_autoanalyze
from pg_stat_user_tables
where schemaname = 'public'
order by n_dead_tup desc;


-- -----------------------------------------------------------------------------
-- 6. LECTURES SÉQUENTIELLES vs INDEX — qui se fait balayer en entier
-- -----------------------------------------------------------------------------
-- But : seq_scan >> idx_scan sur une grosse table confirme un accès « full
-- scan ». Le chargement intégral actuel en est la cause principale ; après
-- passage en lecture filtrée, ces compteurs doivent basculer vers idx_scan.
select
  relname      as table_name,
  seq_scan,
  seq_tup_read,
  idx_scan,
  n_live_tup
from pg_stat_user_tables
where schemaname = 'public'
order by seq_tup_read desc;


-- -----------------------------------------------------------------------------
-- 7. REQUÊTES LES PLUS COÛTEUSES — nécessite l'extension pg_stat_statements
-- -----------------------------------------------------------------------------
-- But : classer les requêtes par temps cumulé. Sur Supabase, l'extension est
-- souvent déjà activée (Dashboard → Database → Extensions). Le bloc est gardé :
-- s'il manque, il renvoie une ligne d'information au lieu d'échouer.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_stat_statements') then
    raise notice 'pg_stat_statements actif : lancer la requête ci-dessous.';
  else
    raise notice 'pg_stat_statements ABSENT : activez-le dans Database → Extensions, puis relancez.';
  end if;
end $$;

-- À lancer seulement si le NOTICE ci-dessus confirme l'extension :
select
  calls,
  round(total_exec_time::numeric, 1)                 as total_ms,
  round(mean_exec_time::numeric, 2)                  as mean_ms,
  rows,
  left(query, 140)                                   as query
from pg_stat_statements
where query not ilike '%pg_stat_statements%'
order by total_exec_time desc
limit 25;


-- -----------------------------------------------------------------------------
-- 8. POLITIQUES RLS EN PLACE — revue de confidentialité et de coût
-- -----------------------------------------------------------------------------
-- But : repérer les policies SELECT en `using (true)` (toute donnée visible de
-- tout compte connecté — à examiner pour les comptes élève/parent) et les
-- prédicats qui appellent une fonction par ligne (is_staff(), …), candidats à
-- l'optimisation InitPlan (voir le runbook).
select
  schemaname, tablename, policyname, cmd,
  qual        as using_expr,
  with_check  as check_expr
from pg_policies
where schemaname = 'public'
order by tablename, policyname;


-- -----------------------------------------------------------------------------
-- 9. PLAN D'EXÉCUTION D'UNE LECTURE REPRÉSENTATIVE (lecture seule)
-- -----------------------------------------------------------------------------
-- But : voir comment Postgres sert une page du chargement actuel (tri sur la
-- clé primaire + LIMIT 1000). EXPLAIN sur un SELECT ne modifie rien. Remplacer
-- la table par la plus grosse repérée au bloc 1.
-- NOTE : on n'utilise PAS « ANALYZE » ici pour rester strictement non exécutant
-- côté effets ; EXPLAIN (sans ANALYZE) donne déjà le plan et l'usage d'index.
explain
select * from public.attendance_records
order by id asc
limit 1000;

-- Lecture filtrée visée APRÈS migration (présences récentes d'un élève) :
explain
select * from public.attendance_records
where student_id = '00000000-0000-0000-0000-000000000000'
order by occurred_at desc
limit 100;
