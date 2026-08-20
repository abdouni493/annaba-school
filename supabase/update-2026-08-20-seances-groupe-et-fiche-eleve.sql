-- =============================================================================
--  MISE À JOUR — Séances libres de GROUPE, désinscription datée,
--                tarif « école seule » et correction des encaissements
--  Projet : https://jehpfbupmhbnbbkzhiwr.supabase.co
--
--  À exécuter TEL QUEL dans le SQL Editor de Supabase, UNE SEULE FOIS.
--  Le script est idempotent : le relancer ne casse rien, et AUCUNE donnée
--  existante n'est modifiée ou supprimée.
--
--  Ce qu'il change
--  ---------------
--   1. NOUVELLE TABLE `public.group_seances` — la séance libre vendue à un
--      GROUPE entier, sans nommer un seul élève. La réception saisit trois
--      nombres et tout le reste se déduit :
--
--        part enseignant / élève = prix élève − part école
--        total encaissé          = élèves × prix élève
--        total école             = élèves × part école
--        total enseignant        = élèves × part enseignant
--
--      Les deux mouvements de caisse (la recette qui entre, la paie de
--      l'enseignant qui sort) sont référencés par `cash_in_id` / `cash_out_id`,
--      donc modifier ou supprimer la séance les emporte avec elle — la caisse,
--      la fiche de l'enseignant et les rapports ne peuvent pas diverger.
--
--   2. `students.subscription_dates` (jsonb, déjà présent) accueille UNE clé de
--      plus par abonnement :
--
--        "sub-1": { "subscribedAt": "2026-05-14",
--                   "startDate":    "2026-05-14",
--                   "joinMonthCode": "M2",
--                   "joinSlotIndex": 2,
--                   "unsubscribedAt": "2026-08-20" }   <-- le jour de la sortie
--
--      Désinscrire un élève d'un groupe ne retire plus que son abonnement de
--      `subscription_ids` : le bloc de dates est CONSERVÉ et daté, donc ses
--      présences, ses paiements et son solde restent lisibles sur sa fiche.
--      Le réinscrire réécrit son point d'entrée et efface cette date.
--      AUCUNE colonne à créer : le jsonb accueille la clé telle quelle, et une
--      inscription qui ne la porte pas se lit comme avant.
--
--   3. Rien d'autre. Le tarif d'un élève « école seule » (part de l'école ÷
--      séances du mois) se calcule à partir de `subscriptions.school_month_share`
--      et `subscriptions.monthly_seances`, déjà en place ; corriger ou supprimer
--      un encaissement réécrit `payments`, `enrollments` et `cash_transactions`,
--      toutes trois déjà en place elles aussi.
-- =============================================================================


-- -----------------------------------------------------------------------------
--  1. La séance libre de groupe
-- -----------------------------------------------------------------------------
create table if not exists public.group_seances (
  id                 text primary key,
  teacher_id         text not null references public.teachers (id) on delete cascade,
  title              text not null default '',
  description        text,
  date               text not null default '',
  start_time         text not null default '',
  end_time           text not null default '',
  students_count     integer not null default 0,
  price_per_student  numeric not null default 0,
  school_per_student numeric not null default 0,
  cash_in_id         text,
  cash_out_id        text,
  created_at         text
);

comment on table public.group_seances is
  'Séance libre vendue à un GROUPE d''élèves : on saisit le nombre d''élèves, le prix par élève et la part de l''école ; la part de l''enseignant et les totaux s''en déduisent';
comment on column public.group_seances.cash_in_id is
  'Mouvement de caisse de la recette — réécrit à chaque modification, supprimé avec la séance';
comment on column public.group_seances.cash_out_id is
  'Mouvement de caisse de la paie de l''enseignant — idem';

create index if not exists idx_group_seances_teacher on public.group_seances (teacher_id);
create index if not exists idx_group_seances_date    on public.group_seances (date);


-- -----------------------------------------------------------------------------
--  2. RLS — lecture pour tout compte connecté, écriture pour le personnel,
--     exactement comme les autres tables d'argent.
-- -----------------------------------------------------------------------------
alter table public.group_seances enable row level security;

drop policy if exists group_seances_read  on public.group_seances;
drop policy if exists group_seances_write on public.group_seances;

create policy group_seances_read on public.group_seances
  for select to authenticated using (true);

create policy group_seances_write on public.group_seances
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

grant all on public.group_seances to authenticated;


-- -----------------------------------------------------------------------------
--  3. Ce que porte désormais le bloc des dates d'abonnement
-- -----------------------------------------------------------------------------
comment on column public.students.subscription_dates is
  'Par abonnement : {subscribedAt,startDate,expiryDate,plan,joinMonthCode,joinSlotIndex,unsubscribedAt} — joinMonthCode/joinSlotIndex = le mois et la séance où l''élève entre dans le groupe ; unsubscribedAt = le jour où il en est sorti (son historique reste)';


-- -----------------------------------------------------------------------------
--  Vérification — à lire dans la sortie du SQL Editor
-- -----------------------------------------------------------------------------
select
  (select count(*) from information_schema.tables
     where table_schema = 'public'
       and table_name = 'group_seances')                      as table_seances_groupe_ok,
  (select count(*) from information_schema.columns
     where table_schema = 'public'
       and table_name = 'group_seances')                      as colonnes_seances_groupe,   -- 13 attendues
  (select count(*) from pg_policies
     where schemaname = 'public'
       and tablename = 'group_seances')                       as policies_seances_groupe,   -- 2 attendues
  (select count(*) from information_schema.columns
     where table_schema = 'public'
       and table_name = 'students'
       and column_name = 'subscription_dates')                as colonne_dates_ok,
  (select count(*) from public.students
     where subscription_dates::text like '%unsubscribedAt%')  as eleves_desinscrits_dates;
