-- =============================================================================
-- ALTECH SCHOOL — OPTIMISATION RLS « InitPlan » (RÉÉCRITURE DE POLICIES)
-- Date : 2026-11-07
-- =============================================================================
-- ⚠️ NE PAS EXÉCUTER AUTOMATIQUEMENT EN PRODUCTION. Application MANUELLE après
--    sauvegarde, en suivant SUPABASE_SQL_RUNBOOK.md.
--
-- CE QUE ÇA CHANGE (et ce que ça NE change PAS)
-- ---------------------------------------------
-- Les policies d'ÉCRITURE actuelles ont la forme :
--     ... using (public.is_staff()) with check (public.is_staff())
-- `is_staff()` est STABLE : sans sous-requête, le planificateur l'évalue
-- potentiellement UNE FOIS PAR LIGNE touchée. En l'enveloppant dans un
-- sous-SELECT scalaire :
--     ... using ((select public.is_staff())) with check ((select public.is_staff()))
-- Postgres le remonte en « InitPlan », évalué UNE SEULE FOIS par instruction.
-- Sur un upsert/delete groupé (ce que fait lib/supabase/sync.ts avec `.in(...)`),
-- le gain est net et sans effet de bord.
--
-- LES DROITS SONT STRICTEMENT IDENTIQUES : même fonction, même résultat
-- booléen. On ne change QUE le moment où Postgres l'évalue. Aucune policy de
-- LECTURE n'est modifiée ici (voir la note de confidentialité dans l'audit :
-- les `using (true)` en SELECT sont un sujet distinct, à traiter à part).
--
-- IDEMPOTENT : réexécutable sans risque (CREATE OR REPLACE / DROP IF EXISTS).
-- =============================================================================

do $$
declare
  t text;
  -- Doit refléter EXACTEMENT les listes de supabase/schema.sql §5.
  staff_write text[] := array[
    'schools','class_categories','modules','class_groups','salles','classes',
    'teachers','teacher_payments','teacher_acomptes','teacher_expenses','teacher_absences',
    'teacher_child_debts',
    'worker_roles','reception_staff','worker_shifts',
    'worker_acomptes','worker_absences','worker_payments',
    'schedule_sessions','subscriptions','free_periods',
    'module_absence_rules','students','payments','student_charges','absence_penalties',
    'announcements','expense_categories','expenses',
    'cash_transactions','parents','notifications','coursework','group_seances',
    'solo_seances'
  ];
  teacher_write text[] := array[
    'attendance_records','enrollments','unpaid_teacher_sessions',
    'subjects','independent_sessions'
  ];
begin
  -- Personnel : réécrit la policy d'écriture avec InitPlan.
  foreach t in array staff_write
  loop
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format(
      'create policy %I on public.%I for all to authenticated '
      || 'using ((select public.is_staff())) with check ((select public.is_staff()))',
      t || '_write', t);
  end loop;

  -- Personnel OU enseignant.
  foreach t in array teacher_write
  loop
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format(
      'create policy %I on public.%I for all to authenticated '
      || 'using ((select public.is_staff_or_teacher())) with check ((select public.is_staff_or_teacher()))',
      t || '_write', t);
  end loop;

  -- Mots de passe du portail : personnel uniquement (même optimisation).
  drop policy if exists student_credentials_staff on public.student_credentials;
  create policy student_credentials_staff on public.student_credentials
    for all to authenticated
    using ((select public.is_staff())) with check ((select public.is_staff()));
end $$;


-- =============================================================================
-- VALIDATION (lecture seule) — vérifier que les prédicats sont bien enveloppés
-- =============================================================================
-- Après exécution, les expressions doivent contenir « (SELECT ... ) ».
select tablename, policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and policyname like '%\_write'
order by tablename;


-- =============================================================================
-- ROLLBACK — restaurer la forme d'origine (appel direct, sans sous-SELECT)
-- =============================================================================
-- Rejoue exactement les policies telles que définies dans schema.sql §5.
--
-- do $$
-- declare
--   t text;
--   staff_write text[] := array[
--     'schools','class_categories','modules','class_groups','salles','classes',
--     'teachers','teacher_payments','teacher_acomptes','teacher_expenses','teacher_absences',
--     'teacher_child_debts','worker_roles','reception_staff','worker_shifts',
--     'worker_acomptes','worker_absences','worker_payments','schedule_sessions',
--     'subscriptions','free_periods','module_absence_rules','students','payments',
--     'student_charges','absence_penalties','announcements','expense_categories',
--     'expenses','cash_transactions','parents','notifications','coursework',
--     'group_seances','solo_seances'
--   ];
--   teacher_write text[] := array[
--     'attendance_records','enrollments','unpaid_teacher_sessions','subjects','independent_sessions'
--   ];
-- begin
--   foreach t in array staff_write loop
--     execute format('drop policy if exists %I on public.%I', t || '_write', t);
--     execute format('create policy %I on public.%I for all to authenticated using (public.is_staff()) with check (public.is_staff())', t || '_write', t);
--   end loop;
--   foreach t in array teacher_write loop
--     execute format('drop policy if exists %I on public.%I', t || '_write', t);
--     execute format('create policy %I on public.%I for all to authenticated using (public.is_staff_or_teacher()) with check (public.is_staff_or_teacher())', t || '_write', t);
--   end loop;
--   drop policy if exists student_credentials_staff on public.student_credentials;
--   create policy student_credentials_staff on public.student_credentials
--     for all to authenticated using (public.is_staff()) with check (public.is_staff());
-- end $$;
