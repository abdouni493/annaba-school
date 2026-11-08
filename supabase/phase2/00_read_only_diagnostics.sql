-- =============================================================================
-- ALTECH SCHOOL — PHASE 2 — DIAGNOSTICS (LECTURE SEULE)
-- =============================================================================
-- Aucune écriture, aucun DDL. Sûr en production. Exécuter bloc par bloc dans
-- Supabase → SQL Editor et conserver les sorties (base du « avant »).
-- Complète supabase/performance/01_diagnostics_read_only.sql (phase 1) avec les
-- vérifications spécifiques sécurité/RLS de la phase 2.
-- =============================================================================

-- 1. POLICIES RLS ACTUELLES + repérage des SELECT « using (true) »
select
  tablename,
  policyname,
  cmd,
  roles,
  qual        as using_expr,
  with_check  as check_expr,
  case when cmd in ('SELECT','ALL') and coalesce(qual,'') in ('true','(true)')
       then '⚠️ LECTURE OUVERTE À TOUT COMPTE CONNECTÉ'
       else '' end as alerte
from pg_policies
where schemaname = 'public'
order by (case when coalesce(qual,'') in ('true','(true)') then 0 else 1 end),
         tablename, policyname;

-- 2. TABLES SANS RLS ACTIVE (devraient toutes l'avoir, sauf cas voulu)
select n.nspname as schema, c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relrowsecurity asc, c.relname;

-- 3. POLICIES MULTIPLES SUR UNE MÊME TABLE/COMMANDE (risque de permissive OR)
--    Deux policies PERMISSIVE sur la même commande se cumulent en OU : une
--    policy large peut alors annuler une policy restrictive.
select tablename, cmd, count(*) as nb_policies,
       string_agg(policyname, ', ' order by policyname) as policies
from pg_policies
where schemaname = 'public'
group by tablename, cmd
having count(*) > 1
order by tablename, cmd;

-- 4. FONCTIONS SECURITY DEFINER (doivent avoir un search_path fixé)
select p.proname as function_name,
       p.prosecdef as security_definer,
       pg_get_function_identity_arguments(p.oid) as args,
       coalesce(array_to_string(p.proconfig, ', '), '(aucun)') as config
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef
order by p.proname;

-- 5. MOTS DE PASSE EN CLAIR — portail élève (constat de sécurité)
--    Ne PAS afficher les valeurs : on compte seulement.
select count(*) as credentials_rows,
       count(*) filter (where coalesce(password,'') <> '') as avec_mot_de_passe
from public.student_credentials;

-- 6. TAILLE/LIGNES DES TABLES LES PLUS LOURDES (empreinte de chargement)
select c.relname as table_name,
       pg_size_pretty(pg_total_relation_size(c.oid)) as total_size,
       c.reltuples::bigint as est_rows
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by pg_total_relation_size(c.oid) desc
limit 15;

-- 7. POLITIQUES STORAGE (buckets) — revue des accès fichiers
select name as policy_name, bucket_id, operation, definition
from storage.policies
order by bucket_id, operation;
-- NB : selon la version, la table peut être `storage.policies` ou se consulter
-- via pg_policies on 'storage'.'objects'. Si la requête ci-dessus échoue :
-- select policyname, cmd, qual, with_check from pg_policies
--   where schemaname='storage' and tablename='objects';

-- 8. EXPLAIN (sans ANALYZE) d'une lecture scoper type (fiche élève à la demande)
explain
select * from public.payments
where student_id = '00000000-0000-0000-0000-000000000000'
order by date desc
limit 50;
