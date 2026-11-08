-- =============================================================================
-- ALTECH SCHOOL — PHASE 2 — POLITIQUES D'ACCÈS SÉCURISÉES (RLS PAR RÔLE)
-- =============================================================================
-- ⚠️⚠️  NE PAS EXÉCUTER AVANT QUE LES LECTURES SCOPER NE SOIENT DÉPLOYÉES.  ⚠️⚠️
--
-- Aujourd'hui, l'application télécharge TOUTE la base pour chaque compte
-- connecté (y compris élève/parent). Les policies SELECT sont donc `using (true)`.
-- Ce script REMPLACE ces lectures ouvertes par des lectures PAR RÔLE. Appliqué
-- AVANT que les portails ne lisent de façon ciblée, il ferait disparaître des
-- données côté élève/parent/enseignant (pas de perte en base, mais écrans vides).
--
-- ORDRE DE DÉPLOIEMENT (voir SQL_RUNBOOK_PHASE2.md) :
--   1. Déployer le code de lecture scoper (repository) derrière les drapeaux.
--   2. Vérifier les portails avec de VRAIS JWT de chaque rôle.
--   3. SEULEMENT ensuite, appliquer ce script.
--
-- Ce script NE MODIFIE AUCUNE DONNÉE. Il ne touche que des policies et crée une
-- vue annuaire. Idempotent (drop if exists + create). Rollback fourni en fin.
-- Les écritures restent inchangées (personnel / enseignant), en forme InitPlan.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 0. FONCTIONS D'AIDE (stable, security definer, search_path fixé)
-- -----------------------------------------------------------------------------
-- entity_id du compte connecté (fiche élève/parent/enseignant liée au compte).
create or replace function public.my_entity_id()
returns text language sql stable security definer set search_path = public as $$
  select entity_id from public.profiles where id = auth.uid()::text
$$;

create or replace function public.is_parent()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'parent', false)
$$;

create or replace function public.is_student()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'student', false)
$$;

create or replace function public.is_teacher()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'teacher', false)
$$;

-- Un enseignant « enseigne » un élève s'il existe une inscription de cet élève
-- sur un abonnement dont la séance lui est affectée.
create or replace function public.teacher_teaches_student(p_student text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.enrollments e
    join public.subscriptions sub on sub.id = e.subscription_id
    join public.schedule_sessions ss on ss.id = sub.session_id
    where e.student_id = p_student
      and ss.teacher_id = public.my_entity_id()
  )
$$;

-- Droit de LIRE la fiche/les présences d'un élève : personnel, l'élève lui-même,
-- son parent, ou un enseignant qui l'a en cours.
create or replace function public.can_read_student(p_student text)
returns boolean language sql stable security definer set search_path = public as $$
  select
    public.is_staff()
    or (public.is_student() and p_student = public.my_entity_id())
    or (public.is_parent()  and exists (
          select 1 from public.students s
          where s.id = p_student and s.parent_id = public.my_entity_id()))
    or (public.is_teacher() and public.teacher_teaches_student(p_student))
$$;

-- Droit de LIRE les FINANCES d'un élève : comme ci-dessus MAIS les enseignants
-- sont EXCLUS (la scolarité/les dettes ne les regardent pas).
create or replace function public.can_read_student_finance(p_student text)
returns boolean language sql stable security definer set search_path = public as $$
  select
    public.is_staff()
    or (public.is_student() and p_student = public.my_entity_id())
    or (public.is_parent()  and exists (
          select 1 from public.students s
          where s.id = p_student and s.parent_id = public.my_entity_id()))
$$;


-- -----------------------------------------------------------------------------
-- 1. VUE ANNUAIRE ENSEIGNANTS (noms seuls, sans montants de paie)
-- -----------------------------------------------------------------------------
-- Les portails ont besoin du NOM de l'enseignant pour afficher un emploi du
-- temps, jamais de son salaire. On expose donc une vue réduite, lisible par
-- tout compte connecté, et on restreint la TABLE `teachers` au personnel + à
-- l'enseignant lui-même.
create or replace view public.teacher_directory
with (security_invoker = true) as
  select id, first_name, last_name from public.teachers;

grant select on public.teacher_directory to authenticated;


-- -----------------------------------------------------------------------------
-- 2. REMPLACEMENT DES LECTURES OUVERTES PAR DES LECTURES PAR RÔLE
-- -----------------------------------------------------------------------------
-- Convention de nommage : on remplace la policy `<table>_read` existante.

-- 2.a — ÉLÈVES et données rattachées à un élève (fiche + présences).
drop policy if exists students_read on public.students;
create policy students_read on public.students
  for select to authenticated
  using ((select public.can_read_student(id)));

drop policy if exists attendance_records_read on public.attendance_records;
create policy attendance_records_read on public.attendance_records
  for select to authenticated
  using ((select public.can_read_student(student_id)));

drop policy if exists enrollments_read on public.enrollments;
create policy enrollments_read on public.enrollments
  for select to authenticated
  using ((select public.can_read_student(student_id)));

drop policy if exists absence_penalties_read on public.absence_penalties;
create policy absence_penalties_read on public.absence_penalties
  for select to authenticated
  using ((select public.can_read_student(student_id)));

-- 2.b — FINANCES ÉLÈVE (enseignants EXCLUS).
drop policy if exists payments_read on public.payments;
create policy payments_read on public.payments
  for select to authenticated
  using ((select public.can_read_student_finance(student_id)));

drop policy if exists student_charges_read on public.student_charges;
create policy student_charges_read on public.student_charges
  for select to authenticated
  using ((select public.can_read_student_finance(student_id)));

-- 2.c — PARENTS : personnel, ou le parent sur SA fiche ; + notifications.
drop policy if exists parents_read on public.parents;
create policy parents_read on public.parents
  for select to authenticated
  using ((select public.is_staff()) or (id = (select public.my_entity_id())));

drop policy if exists notifications_read on public.notifications;
create policy notifications_read on public.notifications
  for select to authenticated
  using ((select public.is_staff()) or (parent_id = (select public.my_entity_id())));

-- 2.d — IDENTIFIANTS PORTAIL : personnel uniquement (déjà le cas en écriture).
drop policy if exists student_credentials_read on public.student_credentials;
create policy student_credentials_read on public.student_credentials
  for select to authenticated
  using ((select public.is_staff()));

-- 2.e — ENSEIGNANTS : table complète réservée personnel + soi-même.
--        (les noms publics passent par la vue teacher_directory ci-dessus.)
drop policy if exists teachers_read on public.teachers;
create policy teachers_read on public.teachers
  for select to authenticated
  using ((select public.is_staff()) or (id = (select public.my_entity_id())));

-- 2.f — PAIE ENSEIGNANT : personnel + l'enseignant concerné.
do $$
declare t text;
  teacher_pay text[] := array[
    'teacher_payments','teacher_acomptes','teacher_expenses',
    'teacher_absences','teacher_child_debts','unpaid_teacher_sessions'
  ];
begin
  foreach t in array teacher_pay loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format(
      'create policy %I on public.%I for select to authenticated '
      || 'using ((select public.is_staff()) or (teacher_id = (select public.my_entity_id())))',
      t || '_read', t);
  end loop;
end $$;

-- 2.g — SÉANCES rémunérées (part enseignant) : personnel + enseignant concerné.
do $$
declare t text;
  tsess text[] := array['group_seances','solo_seances','independent_sessions'];
begin
  foreach t in array tsess loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format(
      'create policy %I on public.%I for select to authenticated '
      || 'using ((select public.is_staff()) or (teacher_id = (select public.my_entity_id())))',
      t || '_read', t);
  end loop;
end $$;

-- 2.h — CAISSE, DÉPENSES, TRAVAILLEURS : personnel uniquement.
do $$
declare t text;
  staff_only text[] := array[
    'cash_transactions','expenses','expense_categories',
    'reception_staff','worker_roles','worker_shifts','worker_acomptes',
    'worker_absences','worker_payments'
  ];
begin
  foreach t in array staff_only loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format(
      'create policy %I on public.%I for select to authenticated '
      || 'using ((select public.is_staff()))',
      t || '_read', t);
  end loop;
end $$;

-- 2.i — DONNÉES DE RÉFÉRENCE non sensibles : lecture ouverte CONSERVÉE.
--        (catalogue nécessaire au rendu des écrans ; aucune donnée privée.)
--        modules, classes, class_groups, salles, class_categories,
--        schedule_sessions, subscriptions, free_periods, module_absence_rules,
--        subjects, announcements, coursework, schools.
--        => on NE touche PAS leurs policies `_read` (restent `using (true)`).

commit;


-- =============================================================================
-- VÉRIFICATION (lecture seule) — à lancer APRÈS le commit
-- =============================================================================
-- (a) Plus aucune lecture ouverte sur les tables sensibles :
select tablename, policyname, qual
from pg_policies
where schemaname = 'public' and cmd in ('SELECT','ALL')
  and tablename in ('students','payments','student_charges','attendance_records',
                    'enrollments','parents','notifications','teachers',
                    'cash_transactions','student_credentials')
order by tablename, policyname;
-- Attendu : les expressions appellent can_read_student / is_staff / my_entity_id,
-- PLUS aucune `true` sur ces tables.

-- (b) TEST AVEC DE VRAIS JWT (obligatoire) : dans un client authentifié comme
--     élève puis comme parent (pas l'éditeur SQL en service_role), vérifier :
--       select count(*) from public.payments;         -- ne voit que les siens
--       select count(*) from public.students;         -- idem
--       select count(*) from public.cash_transactions;-- 0 pour élève/parent
--     L'éditeur SQL en service_role CONTOURNE la RLS : il ne teste rien.


-- =============================================================================
-- ROLLBACK — restaurer les lectures ouvertes de la phase 1 (état d'origine)
-- =============================================================================
-- À n'utiliser qu'en cas de régression des portails.
--
-- begin;
-- do $$
-- declare t text;
--   reopen text[] := array[
--     'students','attendance_records','enrollments','absence_penalties',
--     'payments','student_charges','parents','notifications','student_credentials',
--     'teachers','teacher_payments','teacher_acomptes','teacher_expenses',
--     'teacher_absences','teacher_child_debts','unpaid_teacher_sessions',
--     'group_seances','solo_seances','independent_sessions',
--     'cash_transactions','expenses','expense_categories','reception_staff',
--     'worker_roles','worker_shifts','worker_acomptes','worker_absences','worker_payments'
--   ];
-- begin
--   foreach t in array reopen loop
--     execute format('drop policy if exists %I on public.%I', t || '_read', t);
--     execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_read', t);
--   end loop;
-- end $$;
-- drop view if exists public.teacher_directory;
-- commit;
