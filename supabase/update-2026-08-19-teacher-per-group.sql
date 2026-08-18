-- =============================================================================
--  MISE À JOUR — Rémunération « par groupe » + fiches sans champs obligatoires
--  Projet : https://jehpfbupmhbnbbkzhiwr.supabase.co
--
--  À exécuter TEL QUEL dans le SQL Editor de Supabase, UNE SEULE FOIS.
--  Le script est idempotent : le relancer ne casse rien.
--
--  Ce qu'il change
--  ---------------
--   1. `teachers.payment_type` accepte une 3e formule : 'per_group'.
--      L'enseignant n'a alors AUCUN taux sur sa fiche — chaque emploi du temps
--      le rémunère au tarif défini dans son abonnement (prix du mois → part de
--      l'école → le reste pour l'enseignant, divisé par le nombre de séances).
--
--   2. `teacher_payments.method` accepte 'group' : un règlement qui a
--      simplement additionné les tarifs des emplois du temps réglés.
--
--   3. Les fiches (enseignants, élèves, travailleurs) se créent désormais avec
--      le seul nom. Le script vérifie donc que les colonnes facultatives
--      acceptent bien NULL, et que les colonnes obligatoires ont une valeur par
--      défaut ('') — une fiche incomplète s'enregistre sans erreur.
--
--  Aucune donnée existante n'est modifiée : les enseignants déjà créés gardent
--  leur formule ('monthly' ou 'percentage').
-- =============================================================================


-- -----------------------------------------------------------------------------
--  1. Enseignants — la formule « par groupe »
-- -----------------------------------------------------------------------------
alter table public.teachers
  drop constraint if exists teachers_payment_type_check;

alter table public.teachers
  add constraint teachers_payment_type_check
  check (payment_type in ('monthly', 'percentage', 'per_group'));

comment on column public.teachers.payment_type is
  'monthly = salaire fixe · percentage = % par élève présent · '
  'per_group = tarif porté par chaque emploi du temps (subscriptions.teacher_per_seance)';


-- -----------------------------------------------------------------------------
--  2. Règlements — le mode de calcul « par groupe »
-- -----------------------------------------------------------------------------
alter table public.teacher_payments
  drop constraint if exists teacher_payments_method_check;

alter table public.teacher_payments
  add constraint teacher_payments_method_check
  check (method in ('fixed', 'percent', 'group'));

comment on column public.teacher_payments.method is
  'fixed = montant saisi · percent = % du montant généré · '
  'group = somme des tarifs enseignant des emplois du temps réglés';


-- -----------------------------------------------------------------------------
--  3. Fiches incomplètes
--
--  Un enseignant « par groupe » n'a ni pourcentage ni salaire ni date de début,
--  et un enseignant créé sans compte n'a pas d'email : ces colonnes DOIVENT
--  rester facultatives. L'application y écrit NULL quand la formule ne les
--  utilise pas — un `not null` posé ici casserait toute création.
-- -----------------------------------------------------------------------------
alter table public.teachers        alter column monthly_amount drop not null;
alter table public.teachers        alter column start_date     drop not null;
alter table public.teachers        alter column percentage     drop not null;
alter table public.teachers        alter column is_passager    drop not null;
alter table public.reception_staff alter column role           drop not null;
alter table public.reception_staff alter column rfid           drop not null;
alter table public.reception_staff alter column hourly_rate    drop not null;

--  Les colonnes d'identité restent obligatoires côté base, mais avec une valeur
--  par défaut vide : une fiche sans téléphone ni email passe sans erreur.
do $$
declare
  t text;
  c text;
begin
  foreach t in array array['teachers', 'students', 'reception_staff', 'parents'] loop
    foreach c in array array['first_name', 'last_name', 'phone', 'email', 'birth_date'] loop
      -- toutes ces colonnes n'existent pas sur toutes ces tables
      if exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name   = t
          and column_name  = c
          and data_type    = 'text'
      ) then
        execute format('update public.%I set %I = %L where %I is null', t, c, '', c);
        execute format('alter table public.%I alter column %I set default %L', t, c, '');
        execute format('alter table public.%I alter column %I set not null', t, c);
      end if;
    end loop;
  end loop;
end $$;


-- -----------------------------------------------------------------------------
--  4. Vérification — ce que le script a posé
-- -----------------------------------------------------------------------------
select
  conrelid::regclass        as "table",
  conname                   as "contrainte",
  pg_get_constraintdef(oid) as "définition"
from pg_constraint
where conname in ('teachers_payment_type_check', 'teacher_payments_method_check')
order by 1;
