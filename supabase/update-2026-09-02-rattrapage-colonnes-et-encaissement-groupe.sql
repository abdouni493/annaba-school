-- =============================================================================
--  MISE À JOUR — RATTRAPAGE DES COLONNES MANQUANTES + ENCAISSEMENT GROUPÉ
--  Projet : https://github.com/abdouni493/annaba-school
--
--  À exécuter TEL QUEL dans le SQL Editor de Supabase, UNE SEULE FOIS.
--  Le script est ENTIÈREMENT IDEMPOTENT : chaque instruction est un
--  « add column IF NOT EXISTS » / « create … IF NOT EXISTS ». Le relancer ne
--  réécrit rien, ne supprime rien, ne resserre aucune contrainte.
--
--  CE QUE ÇA RÈGLE
--  ---------------
--  Plusieurs écrans écrivaient dans des colonnes que la base de production
--  n'avait pas encore — les migrations correspondantes n'ayant pas toutes été
--  jouées. PostgREST répondait alors « Could not find the '…' column … in the
--  schema cache », et la ligne n'atteignait jamais la base :
--
--   * la CRÉATION D'UN ENSEIGNANT échouait sur `teachers.created_at` ;
--   * une SÉANCE LIBRE (élève de passage OU élève déjà inscrit) semblait créée
--     mais disparaissait au rechargement, faute des colonnes `school_share`,
--     `teacher_id` et `alert_read` sur `independent_sessions` — l'argent entrait
--     en caisse, la séance, elle, ne se sauvegardait pas.
--
--  Ce script remet la base au niveau attendu par le code, table par table, puis
--  demande à PostgREST de relire son schéma (dernière ligne) pour que le cache
--  cesse de chercher des colonnes qu'il vient de recevoir.
--
--  L'ENCAISSEMENT GROUPÉ DE LA MATERNELLE n'a besoin d'AUCUNE colonne nouvelle :
--  il crée simplement un versement par emploi du temps (tables déjà en place) et
--  les réunit sur un seul reçu. Rien à faire côté base pour cette fonction.
-- =============================================================================


-- -----------------------------------------------------------------------------
--  1. ENSEIGNANTS — la date de création (met les derniers arrivés en tête).
-- -----------------------------------------------------------------------------
alter table public.teachers
  add column if not exists created_at text;


-- -----------------------------------------------------------------------------
--  2. SÉANCES LIBRES — la table et toutes ses colonnes.
--
--     `create table if not exists` ne crée la table que si elle manque ; les
--     `add column if not exists` en dessous complètent une table qui existe
--     déjà mais à qui il manque une colonne. Les deux sont donc nécessaires.
-- -----------------------------------------------------------------------------
create table if not exists public.independent_sessions (
  id            text primary key,
  student_id    text references public.students (id) on delete set null,
  passager_name text,
  item_label    text not null default '',
  price         numeric not null default 0,
  school_share  numeric,
  teacher_id    text,
  date          text not null default '',
  session_id    text,
  start_time    text,
  end_time      text,
  created_at    text,
  teacher_paid  boolean not null default false,
  alert_read    boolean not null default false,
  created_by         text,
  created_by_name    text,
  created_by_role    text
);

alter table public.independent_sessions
  add column if not exists student_id    text,
  add column if not exists passager_name text,
  add column if not exists item_label    text not null default '',
  add column if not exists price         numeric not null default 0,
  add column if not exists school_share  numeric,
  add column if not exists teacher_id    text,
  add column if not exists date          text not null default '',
  add column if not exists session_id    text,
  add column if not exists start_time    text,
  add column if not exists end_time      text,
  add column if not exists created_at    text,
  add column if not exists teacher_paid  boolean not null default false,
  add column if not exists alert_read    boolean not null default false;

-- La clé étrangère de l'enseignant, posée seulement si elle manque.
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
     where table_schema = 'public'
       and table_name   = 'independent_sessions'
       and constraint_name = 'independent_sessions_teacher_id_fkey'
  ) then
    alter table public.independent_sessions
      add constraint independent_sessions_teacher_id_fkey
      foreign key (teacher_id) references public.teachers (id) on delete set null;
  end if;
end $$;

create index if not exists idx_independent_session on public.independent_sessions (session_id);
create index if not exists idx_independent_teacher on public.independent_sessions (teacher_id);
create index if not exists idx_independent_date    on public.independent_sessions (date);


-- -----------------------------------------------------------------------------
--  3. SÉANCES LIBRES DE GROUPE — au cas où la table manque encore.
-- -----------------------------------------------------------------------------
create table if not exists public.group_seances (
  id                text primary key,
  teacher_id        text references public.teachers (id) on delete set null,
  title             text not null default '',
  description       text,
  date              text not null default '',
  start_time        text,
  end_time          text,
  students_count    integer not null default 0,
  price_per_student numeric not null default 0,
  school_per_student numeric not null default 0,
  cash_in_id        text,
  cash_out_id       text,
  created_at        text,
  created_by         text,
  created_by_name    text,
  created_by_role    text
);


-- -----------------------------------------------------------------------------
--  4. RATTRAPAGE DES AUTRES COLONNES RÉCENTES — chacune facultative.
-- -----------------------------------------------------------------------------
alter table public.students
  add column if not exists phone2                       text,
  add column if not exists school_only_subscription_ids jsonb,
  add column if not exists enrollment_level             text,
  add column if not exists enrollment_year              text,
  add column if not exists registration_due             numeric;

alter table public.schools
  add column if not exists registration_fee_scope       text,
  add column if not exists registration_fee_levels      jsonb,
  add column if not exists registration_fee_class_ids   jsonb,
  add column if not exists registration_fee_session_ids jsonb,
  add column if not exists absence_penalty_enabled      boolean,
  add column if not exists absence_penalty_since        text,
  add column if not exists absence_week_start_day       text;

alter table public.schedule_sessions
  add column if not exists class_groups jsonb,
  add column if not exists group_ids    jsonb,
  add column if not exists class_ids    jsonb,
  add column if not exists salle_ids    jsonb,
  add column if not exists day_times    jsonb,
  add column if not exists day_salles   jsonb,
  add column if not exists open_price   numeric,
  add column if not exists period_start text,
  add column if not exists period_end   text,
  add column if not exists archived_at  text;

alter table public.subscriptions
  add column if not exists archived_at text;

alter table public.payments
  add column if not exists alert_read boolean not null default false,
  add column if not exists charge_id  text,
  add column if not exists paid_from  text;

alter table public.student_charges
  add column if not exists description       text,
  add column if not exists origin            text not null default 'manual',
  add column if not exists source_payment_id text,
  add column if not exists subscription_id   text,
  add column if not exists month_code        text,
  add column if not exists paid_amount       numeric not null default 0,
  add column if not exists paid              boolean not null default false,
  add column if not exists payment_id        text,
  add column if not exists created_at        text;

alter table public.teacher_payments
  add column if not exists arrears     jsonb,
  add column if not exists child_debts jsonb,
  add column if not exists board       jsonb,
  add column if not exists cash_id     text;

alter table public.teacher_child_debts
  add column if not exists emploi text;

alter table public.unpaid_teacher_sessions
  add column if not exists payment_id text;

alter table public.reception_staff
  add column if not exists has_account boolean not null default false,
  add column if not exists username    text,
  add column if not exists nav_keys    text[],
  add column if not exists action_keys text[],
  add column if not exists hourly_rate numeric,
  add column if not exists created_at  text;


-- -----------------------------------------------------------------------------
--  5. TRAÇABILITÉ — « qui a fait l'opération » sur toutes les tables.
--     Trois colonnes texte, recopiées à l'écriture.
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
  cibles text[] := array[
    'class_categories','modules','class_groups','salles','classes','teachers',
    'worker_roles','reception_staff','parents','schedule_sessions','subscriptions',
    'students','enrollments','payments','student_charges','attendance_records',
    'absence_penalties','teacher_payments','teacher_acomptes','teacher_expenses',
    'teacher_child_debts','teacher_absences','unpaid_teacher_sessions',
    'worker_shifts','worker_acomptes','worker_absences','worker_payments',
    'free_periods','subjects','announcements',
    'expense_categories','expenses','cash_transactions','notifications',
    'coursework','independent_sessions','group_seances'
  ];
begin
  foreach t in array cibles
  loop
    if exists (select 1 from information_schema.tables
                where table_schema = 'public' and table_name = t) then
      execute format(
        'alter table public.%I
           add column if not exists created_by        text,
           add column if not exists created_by_name   text,
           add column if not exists created_by_role   text', t);
    end if;
  end loop;
end;
$$;


-- -----------------------------------------------------------------------------
--  6. RELIRE LE SCHÉMA — pour que le cache de PostgREST cesse aussitôt de
--     chercher les colonnes qu'on vient de lui ajouter (sinon l'erreur « … in
--     the schema cache » persiste quelques minutes).
-- -----------------------------------------------------------------------------
notify pgrst, 'reload schema';
