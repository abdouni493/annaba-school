-- =============================================================================
--  ALTECH SCHOOL — schéma complet (Supabase / PostgreSQL)
--  Projet : https://jehpfbupmhbnbbkzhiwr.supabase.co
--
--  À exécuter TEL QUEL dans le SQL Editor de Supabase (une seule fois).
--  Le script est idempotent : il peut être relancé sans casser les données.
--
--  Contenu :
--    1. Extensions, table `profiles` et helpers de rôle
--    2. Fonctions d'authentification (création de comptes)
--         - public.admin_exists()        -> le bouton "créer un admin" se cache
--         - public.bootstrap_admin(...)  -> création de l'admin depuis /login
--         - public.admin_create_user(...)-> enseignants / travailleurs / élèves
--         - public.admin_set_password(...)
--       Toutes écrivent dans auth.users + auth.identities : les comptes créés
--       se connectent directement avec email + mot de passe, sans confirmation.
--    3. Les 32 tables métier (une par collection de l'application)
--    4. Index
--    5. RLS : lecture pour tout compte connecté, écriture pour le personnel
--    6. Storage : buckets "logos" et "subjects"
--    7. La ligne unique de configuration de l'école
--
--  CONVENTION IMPORTANTE
--  --------------------
--  Toutes les clés primaires sont en `text` : l'application génère ses propres
--  identifiants ("cls-…", "ses-…") et, pour les personnes, réutilise l'UUID du
--  compte auth. Toutes les dates/horodatages sont eux aussi en `text`
--  (YYYY-MM-DD ou ISO 8601) : l'application les compare en chaînes, ce typage
--  garantit un aller-retour sans perte. Les champs tableaux/objets sont `jsonb`.
-- =============================================================================


-- =============================================================================
--  1. EXTENSIONS, PROFILS ET HELPERS DE RÔLE
-- =============================================================================

-- pgcrypto fournit crypt()/gen_salt() pour hacher les mots de passe. Sur un
-- projet Supabase il est déjà présent dans le schéma `extensions` ; les
-- fonctions qui s'en servent l'ont sur leur search_path, donc l'appel non
-- qualifié le trouve quel que soit le schéma où il est installé.
create extension if not exists pgcrypto with schema extensions;

-- La table des profils vient en PREMIER : les fonctions ci-dessous sont en
-- `language sql`, donc PostgreSQL analyse leur corps dès leur création et
-- exige que la table qu'elles lisent existe déjà.
-- Un profil par compte auth. `entity_id` pointe la ligne métier correspondante
-- (teachers / students / parents / reception_staff) — l'application crée ces
-- lignes avec le MÊME identifiant que le compte, donc entity_id = id.
create table if not exists public.profiles (
  id          text primary key,
  role        text not null check (role in ('admin','reception','teacher','student','parent')),
  full_name   text not null default '',
  username    text,
  email       text not null,
  entity_id   text,
  created_at  timestamptz not null default now()
);

create unique index if not exists profiles_email_key on public.profiles (lower(email));

-- Rôle du compte connecté (lu depuis profiles, sans déclencher la RLS).
create or replace function public.my_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.role from public.profiles p where p.id = auth.uid()::text
$$;

-- Personnel : administration + réception. Ce sont les seuls comptes autorisés
-- à écrire dans la quasi-totalité des tables.
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.my_role() in ('admin', 'reception'), false)
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.my_role() = 'admin', false)
$$;

-- Personnel OU enseignant : présences, matières, séances libres.
create or replace function public.is_staff_or_teacher()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.my_role() in ('admin', 'reception', 'teacher'), false)
$$;


-- =============================================================================
--  2. COMPTES — création dans la table d'authentification
-- =============================================================================

-- ---------------------------------------------------------------------------
--  Création d'un utilisateur directement dans la table d'authentification.
--
--  Écrit auth.users + auth.identities avec un mot de passe bcrypt et un email
--  déjà confirmé : le compte peut se connecter immédiatement via
--  supabase.auth.signInWithPassword(), sans email de confirmation.
--
--  Interne : les fonctions publiques ci-dessous l'appellent après leurs propres
--  contrôles d'autorisation.
-- ---------------------------------------------------------------------------
create or replace function public._create_auth_user(
  p_email     text,
  p_password  text,
  p_role      text,
  p_full_name text,
  p_username  text default null,
  p_entity_id text default null
)
returns text
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_id    uuid := gen_random_uuid();
  v_email text := lower(trim(p_email));
begin
  if v_email is null or v_email = '' then
    raise exception 'EMAIL_REQUIRED';
  end if;
  if p_password is null or length(p_password) < 6 then
    raise exception 'PASSWORD_TOO_SHORT';
  end if;
  if p_role not in ('admin','reception','teacher','student','parent') then
    raise exception 'INVALID_ROLE';
  end if;
  if exists (select 1 from auth.users u where lower(u.email) = v_email) then
    raise exception 'EMAIL_ALREADY_EXISTS';
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token,
    email_change, email_change_token_new, email_change_token_current
  ) values (
    '00000000-0000-0000-0000-000000000000',
    v_id,
    'authenticated',
    'authenticated',
    v_email,
    crypt(p_password, gen_salt('bf')),
    now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    jsonb_build_object('role', p_role, 'full_name', coalesce(p_full_name, ''), 'username', p_username),
    now(),
    now(),
    '', '', '', '', ''
  );

  -- GoTrue exige une identité "email" pour autoriser la connexion par mot de passe.
  insert into auth.identities (
    id, provider_id, user_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(),
    v_id::text,
    v_id,
    jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
    'email',
    now(), now(), now()
  );

  insert into public.profiles (id, role, full_name, username, email, entity_id)
  values (v_id::text, p_role, coalesce(p_full_name, ''), p_username, v_email,
          coalesce(p_entity_id, v_id::text));

  return v_id::text;
end;
$$;

revoke all on function public._create_auth_user(text, text, text, text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
--  A-t-on déjà un administrateur ? La page de connexion appelle cette fonction
--  pour AFFICHER ou CACHER le bouton "Créer un compte administrateur".
-- ---------------------------------------------------------------------------
create or replace function public.admin_exists()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles p where p.role = 'admin')
$$;

grant execute on function public.admin_exists() to anon, authenticated;

-- ---------------------------------------------------------------------------
--  Création du TOUT PREMIER administrateur, depuis la page de connexion.
--  Refusée dès qu'un administrateur existe — le bouton disparaît alors côté UI.
-- ---------------------------------------------------------------------------
create or replace function public.bootstrap_admin(
  p_full_name text,
  p_username  text,
  p_email     text,
  p_password  text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text;
begin
  if public.admin_exists() then
    raise exception 'ADMIN_ALREADY_EXISTS';
  end if;

  v_id := public._create_auth_user(p_email, p_password, 'admin', p_full_name, p_username, null);
  return v_id;
end;
$$;

grant execute on function public.bootstrap_admin(text, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
--  Création d'un compte enseignant / travailleur / élève / parent par le
--  personnel. Renvoie l'identifiant du compte : l'application l'utilise comme
--  clé primaire de la ligne métier qu'elle crée juste après.
-- ---------------------------------------------------------------------------
create or replace function public.admin_create_user(
  p_email     text,
  p_password  text,
  p_role      text,
  p_full_name text default '',
  p_username  text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_role = 'admin' and not public.is_admin() then
    raise exception 'NOT_ALLOWED';
  end if;

  return public._create_auth_user(p_email, p_password, p_role, p_full_name, p_username, null);
end;
$$;

grant execute on function public.admin_create_user(text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
--  Réinitialisation du mot de passe de quelqu'un d'autre, par le personnel.
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_password(
  p_user_id  text,
  p_password text
)
returns void
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
begin
  if not public.is_staff() then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_password is null or length(p_password) < 6 then
    raise exception 'PASSWORD_TOO_SHORT';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_user_id::uuid) then
    raise exception 'NO_ACCOUNT';
  end if;

  update auth.users
     set encrypted_password = crypt(p_password, gen_salt('bf')),
         updated_at = now()
   where id = p_user_id::uuid;
end;
$$;

grant execute on function public.admin_set_password(text, text) to authenticated;

-- ---------------------------------------------------------------------------
--  Mise à jour de l'email de connexion quand le personnel modifie une fiche.
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_email(
  p_user_id text,
  p_email   text
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_email text := lower(trim(p_email));
begin
  if not public.is_staff() then
    raise exception 'NOT_ALLOWED';
  end if;
  if v_email is null or v_email = '' then
    raise exception 'EMAIL_REQUIRED';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_user_id::uuid) then
    return; -- fiche sans compte de connexion : rien à faire
  end if;
  if exists (select 1 from auth.users u where lower(u.email) = v_email and u.id <> p_user_id::uuid) then
    raise exception 'EMAIL_ALREADY_EXISTS';
  end if;

  update auth.users set email = v_email, updated_at = now() where id = p_user_id::uuid;
  update auth.identities
     set identity_data = identity_data || jsonb_build_object('email', v_email),
         updated_at = now()
   where user_id = p_user_id::uuid and provider = 'email';
  update public.profiles set email = v_email where id = p_user_id;
end;
$$;

grant execute on function public.admin_set_email(text, text) to authenticated;

-- ---------------------------------------------------------------------------
--  Suppression d'un compte quand le personnel supprime la fiche associée.
-- ---------------------------------------------------------------------------
create or replace function public.admin_delete_user(p_user_id text)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.is_staff() then
    raise exception 'NOT_ALLOWED';
  end if;
  delete from public.profiles where id = p_user_id;
  delete from auth.users where id = p_user_id::uuid;
exception
  when invalid_text_representation then
    return; -- identifiant non-UUID : la fiche n'avait pas de compte
end;
$$;

grant execute on function public.admin_delete_user(text) to authenticated;


-- =============================================================================
--  3. TABLES MÉTIER
--     Une table par collection du store (lib/store/data.ts -> Database).
-- =============================================================================

-- --- Établissement (ligne unique) -------------------------------------------
-- Écran : Paramètres. Actions : enregistrer les informations, téléverser le
-- logo, activer la facturation automatique des absences.
create table if not exists public.schools (
  id                        text primary key,
  name                      text not null default '',
  description               text not null default '',
  phone                     text not null default '',
  email                     text not null default '',
  logo                      text,
  address                   text not null default '',
  article_fiscal            text,
  registre_commerce         text,
  nif                       text,
  nis                       text,
  registration_fee          numeric,          -- frais d'inscription, une seule fois par élève
  -- QUI doit les frais d'inscription : 'all' (tout le monde, le défaut),
  -- 'levels' (tout un niveau : « tout le secondaire »), 'classes' (des classes
  -- précises) ou 'sessions' (des emplois du temps précis).
  registration_fee_scope       text check (registration_fee_scope in ('all','levels','classes','sessions')),
  registration_fee_levels      jsonb,         -- scope 'levels'   : les niveaux concernés
  registration_fee_class_ids   jsonb,         -- scope 'classes'  : les classes concernées
  registration_fee_session_ids jsonb,         -- scope 'sessions' : les emplois du temps concernés
  absence_penalty_enabled   boolean,          -- interrupteur général de la facturation des absences
  absence_penalty_since     text,             -- plancher YYYY-MM-DD : jamais de rattrapage rétroactif
  absence_week_start_day    integer           -- 0 = dimanche … 5 = vendredi
);

-- --- Référentiels pédagogiques ----------------------------------------------
-- Écran : Classes. Actions : créer / modifier / supprimer.
create table if not exists public.class_categories (
  id    text primary key,
  name  text not null default ''
);

create table if not exists public.modules (
  id    text primary key,
  name  text not null default ''
);

create table if not exists public.class_groups (          -- collection `groups`
  id    text primary key,
  name  text not null default ''
);

create table if not exists public.salles (
  id    text primary key,
  -- Deux salles ne peuvent pas porter le même nom : l'écran Emploi du temps
  -- choisit une salle par son nom, et deux « Salle 3 » rendraient ce choix
  -- indécidable. L'unicité ignore la casse et les espaces de bord.
  name  text not null default ''
);
create unique index if not exists idx_salles_name_unique
  on public.salles (lower(btrim(name)));

create table if not exists public.classes (
  id              text primary key,
  type            text not null default 'cours' check (type in ('cours','formation')),
  name            text not null default '',
  description     text not null default '',
  cours_level     text check (cours_level in ('maternelle','primaire','moyen','lycee')),
  year            text,
  category_id     text references public.class_categories (id) on delete set null,
  formation_level text check (formation_level in ('A1','A2','B1','B2','C1','C2'))
);

-- --- Enseignants -------------------------------------------------------------
-- Écran : Enseignants. Actions : créer (avec compte), créer un passager (sans
-- compte), modifier, supprimer, régler, avances, dépenses, absences.
create table if not exists public.teachers (
  id             text primary key,
  first_name     text not null default '',
  last_name      text not null default '',
  phone          text not null default '',
  email          text not null default '',
  -- 'per_group' : la paie n'est PAS sur la fiche, chaque emploi du temps porte
  -- son tarif (part de l'enseignant du mois ÷ séances) via subscriptions.
  payment_type   text not null default 'percentage'
                 check (payment_type in ('monthly','percentage','per_group')),
  monthly_amount numeric,
  start_date     text,
  percentage     numeric,
  is_passager    boolean                       -- intervenant sans compte de connexion
);

-- Règlement d'un enseignant : ce qu'il a touché, et tout ce qui a été déduit.
create table if not exists public.teacher_payments (
  id             text primary key,
  teacher_id     text not null references public.teachers (id) on delete cascade,
  amount         numeric not null default 0,   -- net réellement versé
  -- 'group' : le règlement a simplement additionné les tarifs des emplois du temps
  method         text not null default 'percent'
                 check (method in ('fixed','percent','group')),
  percentage     numeric,
  students_count integer not null default 0,
  sessions_count integer not null default 0,
  description    text not null default '',
  details        jsonb not null default '[]'::jsonb,  -- créneaux figés, pour réimprimer le reçu
  gross          numeric,                              -- brut, avant déductions
  expenses       jsonb,                                -- dépenses soldées par ce règlement
  acomptes       jsonb,                                -- acomptes soldés par ce règlement
  child_charges  jsonb,                                -- enfants réglés sur le salaire du père
  -- Scolarités déjà créditées aux enfants et PORTÉES sur ce salaire, retenues
  -- par ce règlement (voir teacher_child_debts) : elles ne reviennent jamais
  -- sur le suivant.
  child_debts    jsonb,
  -- Mois d'emploi du temps soldés par ce règlement (M1, M2 …) : la paie se fait
  -- mois par mois, un mois se ferme sur la séance qui complète le pack.
  months         jsonb,
  -- LES ARRIÉRÉS DÉBLOQUÉS payés par ce règlement : des parts d'un mois DÉJÀ
  -- réglé, retenues à l'époque parce que l'élève n'avait pas payé, et libérées
  -- depuis. Figées ici pour que la fiche de paie les imprime avec leur mois
  -- d'origine, sans les confondre avec le mois courant.
  arrears        jsonb,
  -- Le mouvement de caisse écrit par ce règlement : annuler l'un annule l'autre.
  cash_id        text,
  paid_at        text not null default ''
);

-- Avance versée à un enseignant, déduite une seule fois du règlement suivant.
create table if not exists public.teacher_acomptes (
  id          text primary key,
  teacher_id  text not null references public.teachers (id) on delete cascade,
  amount      numeric not null default 0,
  description text not null default '',
  date        text not null default '',
  paid        boolean not null default false,
  payment_id  text references public.teacher_payments (id) on delete set null
);

-- Frais avancés par l'école pour un enseignant, déduits une seule fois.
create table if not exists public.teacher_expenses (
  id          text primary key,
  teacher_id  text not null references public.teachers (id) on delete cascade,
  name        text not null default '',
  amount      numeric not null default 0,
  description text,
  date        text not null default '',
  paid        boolean not null default false,
  payment_id  text references public.teacher_payments (id) on delete set null,
  created_at  text
);

-- --- Scolarités d'enfants portées sur le salaire de leur père -----------------
-- Écran : feuille de présence d'un groupe (bouton « Fils d'enseignant »).
--
-- Un fils d'enseignant n'a pas à attendre la paie de son père pour être en
-- règle. La réception solde son mois depuis la feuille du groupe et choisit
-- comment :
--   * la FAMILLE paie au guichet  -> un versement ordinaire (`payments`,
--     paid_from = 'cash'), une entrée en caisse, et RIEN n'est retenu au père ;
--   * à PORTER sur le SALAIRE du père -> le solde de l'enfant est crédité tout
--     de suite (paid_from = 'teacher_debt', aucun mouvement de caisse) et le
--     montant est inscrit ICI, en attente. Le prochain règlement du père le
--     retient sur son net et le passe à `paid` : jamais deux fois.
--
-- La différence est capitale à la lecture : dans les deux cas l'enfant est en
-- règle et la part que ses séances rapportent à l'enseignant se débloque, mais
-- seul le second ampute le salaire.
create table if not exists public.teacher_child_debts (
  id              text primary key,
  teacher_id      text not null references public.teachers (id) on delete cascade,
  student_id      text not null references public.students (id) on delete cascade,
  subscription_id text,                          -- l'emploi du temps crédité
  month_code      text,                          -- le mois de cet emploi (M1, M2 …)
  label           text not null default '',      -- ce que la fiche de paie affiche
  amount          numeric not null default 0,
  date            text not null default '',
  paid            boolean not null default false,
  payment_id      text references public.teacher_payments (id) on delete set null,
  created_at      text
);

create index if not exists teacher_child_debts_open_key
  on public.teacher_child_debts (teacher_id) where paid = false;

create table if not exists public.teacher_absences (
  id          text primary key,
  teacher_id  text not null references public.teachers (id) on delete cascade,
  cost        numeric not null default 0,
  description text not null default '',
  date        text not null default ''
);

-- --- Travailleurs (réception / sécurité / ménage) ----------------------------
-- Écran : Travailleurs. Actions : créer (avec ou sans compte), modifier,
-- supprimer, badger, geler les journées ouvertes, payer les journées.
create table if not exists public.reception_staff (
  id           text primary key,
  first_name   text not null default '',
  last_name    text not null default '',
  phone        text not null default '',
  email        text not null default '',
  payment_type text not null default 'monthly' check (payment_type in ('daily','monthly','half_day','hourly')),
  start_date   text not null default '',
  salary       numeric not null default 0,
  role         text check (role in ('reception','security','menage')),
  rfid         text,                            -- badge du pointage
  hourly_rate  numeric                          -- contrat horaire : prix d'une heure
);

-- Une journée travaillée (pointage entrée / sortie).
create table if not exists public.worker_shifts (
  id         text primary key,
  worker_id  text not null references public.reception_staff (id) on delete cascade,
  work_date  text not null default '',
  start_at   text,
  end_at     text,
  minutes    integer not null default 0,
  frozen     boolean not null default false,    -- journée close sans sortie
  paid       boolean not null default false,
  payment_id text,
  created_at text not null default ''
);

-- --- Emplois du temps ---------------------------------------------------------
-- Écran : Planning. Actions : créer / modifier / supprimer un créneau,
-- créer une séance libre.
create table if not exists public.schedule_sessions (
  id           text primary key,
  class_id     text not null default '',
  module_id    text not null default '',
  group_id     text not null default '',
  salle_id     text not null default '',
  teacher_id   text not null default '',
  days         jsonb not null default '[]'::jsonb,
  start_time   text not null default '',        -- horaire par défaut de l'emploi
  end_time     text not null default '',
  day_times    jsonb,                            -- horaires jour par jour : {"saturday":{"startTime":"08:00","endTime":"10:00"}}
  day_salles   jsonb,                            -- salle jour par jour : {"saturday":"salle-1","tuesday":"salle-2"}
  is_open      boolean,                          -- séance libre
  title        text,
  period_start text,
  period_end   text,
  class_ids    jsonb,
  group_ids    jsonb,
  salle_ids    jsonb,
  open_price   numeric,
  archived_at  text                              -- emploi SUPPRIMÉ : archivé, jamais effacé
);

-- Supprimer un emploi du temps l'ARCHIVE : `archived_at` porte le jour où la
-- réception l'a retiré, et la ligne reste en base avec son tarif. Tout ce qui
-- s'y rattache — présences pointées, soldes et paiements des élèves, parts dues
-- à l'enseignant — garde donc un nom sur les écrans d'historique, au lieu de se
-- réduire à un tiret. L'emploi disparaît seulement des écrans de travail
-- (grille, feuille de présence, catalogue d'inscription, tarifs).
comment on column public.schedule_sessions.archived_at is
  'Jour de suppression (YYYY-MM-DD). NULL = emploi du temps vivant. Archivé, la ligne reste lisible par tout l''historique.';

-- --- Tarifs (abonnements) ------------------------------------------------------
-- Écran : Abonnements. Actions : fixer le tarif d'un cours (tous groupes),
-- définir la formule au mois, supprimer le tarif.
create table if not exists public.subscriptions (
  id                 text primary key,
  session_id         text not null references public.schedule_sessions (id) on delete cascade,
  price_per_session  numeric not null default 0,
  level_price        numeric,                    -- formations : prix du niveau
  period_months      integer,                    -- formations : durée, pilote l'expiration
  monthly_seances    integer,                    -- formule mensuelle : séances comprises
  monthly_price      numeric,                    -- prix du pack mensuel
  school_month_share numeric,                    -- part que l'école garde sur le mois
  teacher_per_seance numeric,                    -- part enseignant pour UNE séance
  archived_at        text                        -- archivé avec son emploi du temps
);

-- Périodes gratuites : la présence est écrite, le solde n'est pas débité.
-- Écran : Abonnements / Périodes gratuites.
create table if not exists public.free_periods (
  id           text primary key,
  name         text not null default '',
  description  text not null default '',
  start_date   text not null default '',
  end_date     text not null default '',
  all_classes  boolean not null default true,
  class_ids    jsonb not null default '[]'::jsonb,
  pay_teachers boolean not null default true,    -- l'enseignant est payé quand même
  active       boolean not null default true,
  created_at   text
);

-- Facturation automatique des absences, module par module.
create table if not exists public.module_absence_rules (
  module_id   text primary key references public.modules (id) on delete cascade,
  enabled     boolean not null default false,
  days_window integer not null default 7
);

-- --- Élèves --------------------------------------------------------------------
-- Écran : Élèves. Actions : créer, modifier, supprimer, inscrire aux modules,
-- remises, cas particuliers, recharger le solde, régler la dette, imprimer.
create table if not exists public.students (
  id                     text primary key,
  registration_number    text,                  -- numéro d'inscription imprimé sur la carte
  first_name             text not null default '',
  last_name              text not null default '',
  birth_date             text not null default '',
  phone                  text not null default '',
  email                  text not null default '',
  rfid                   text not null default '',
  is_free                boolean not null default false,
  student_case           text check (student_case in ('normal','special','teacher_child','reduction','school_only')),
  free_subscription_ids  jsonb,                 -- cas spécial : les abonnements OFFERTS (null = tous)
  teacher_father_id      text references public.teachers (id) on delete set null,
  case_reduction         jsonb,                 -- remise partagée école / enseignant
  unpaid_teacher_ids     jsonb,                 -- school_only : enseignants NON payés
  -- « École seulement », EMPLOI PAR EMPLOI : les abonnements sur lesquels
  -- l'option est ACTIVE (la famille n'y verse que la part de l'école,
  -- l'enseignant n'est pas payé et l'élève ne figure pas sur sa fiche de paie).
  -- NULL = fiche d'avant, pilotée par `unpaid_teacher_ids` seul.
  school_only_subscription_ids jsonb,
  -- Où la réception en était dans le catalogue quand elle a créé la fiche :
  -- un élève peut être inscrit « 4AP » SANS emploi du temps, et l'écran de
  -- modification doit rouvrir là plutôt que sur un primaire/1AP arbitraire.
  enrollment_level       text,
  enrollment_year        text,
  parent_id              text,
  subscription_ids       jsonb not null default '[]'::jsonb,
  subscription_dates     jsonb,                 -- dates + point d'entrée par abonnement
  subscription_discounts jsonb,                 -- remises par abonnement
  registration_due       numeric                -- frais d'inscription encore dus
);

create index if not exists students_rfid_key
  on public.students (rfid) where rfid <> '';

-- `free_subscription_ids` est la GRATUITÉ, emploi du temps par emploi du temps :
-- un « cas spécial » liste ici les abonnements qui lui sont offerts (ni l'école
-- ni l'enseignant ne sont payés pour eux), les autres étant facturés au tarif
-- ordinaire. NULL = toute la scolarité est offerte, ce qui est exactement la
-- façon dont le cas se lisait avant d'être détaillé.

-- Le bloc `subscription_dates` porte, abonnement par abonnement :
--   {subscribedAt, startDate, expiryDate, plan,
--    joinMonthCode, joinSlotIndex}
-- `joinMonthCode` / `joinSlotIndex` sont le POINT D'ENTRÉE de l'élève sur cet
-- emploi du temps : « M2 » + 2 = inscrit au 2e mois de l'emploi, sur sa 3e
-- séance (index 0). Les séances tenues avant lui ne sont pas les siennes, et
-- les mois précédents ne le comptent pas. Absent = M1 · séance 1.
comment on column public.students.subscription_dates is
  'Par abonnement : {subscribedAt,startDate,expiryDate,plan,joinMonthCode,joinSlotIndex} — joinMonthCode/joinSlotIndex = le mois et la séance où l''élève entre dans le groupe';

-- Mot de passe du portail, imprimé sur le reçu. Table réservée au personnel.
create table if not exists public.student_credentials (
  student_id text primary key references public.students (id) on delete cascade,
  password   text not null default '',
  updated_at text not null default ''
);

-- Une inscription : UN élève sur UN emploi du temps. Compte les séances ET
-- porte le SOLDE en dinars (il peut devenir négatif = la dette sur ce module).
create table if not exists public.enrollments (
  id                text primary key,
  student_id        text not null references public.students (id) on delete cascade,
  subscription_id   text not null references public.subscriptions (id) on delete cascade,
  paid_seances      integer not null default 0,
  consumed_seances  integer not null default 0,
  discount          jsonb,
  start_date        text,
  expiry_date       text,
  plan              text check (plan in ('seance','month')),
  month_seances     integer,
  balance           numeric not null default 0,
  created_at        text not null default '',
  unique (student_id, subscription_id)
);

-- Mouvement d'argent d'un élève : achat de séances, recharge de solde, ou
-- règlement d'une dette antérieure.
create table if not exists public.payments (
  id                 text primary key,
  student_id         text not null references public.students (id) on delete cascade,
  enrollment_id      text,
  subscription_id    text,
  month_code         text,                      -- mois PROPRE à l'emploi du temps : M1, M2 …
  seances_purchased  integer not null default 0,
  unit_price         numeric not null default 0,
  gross_total        numeric not null default 0,
  plan               text check (plan in ('seance','month')),
  discount_type      text check (discount_type in ('percent','amount')),
  discount_value     numeric,
  net_total          numeric not null default 0,
  amount_paid        numeric not null default 0,
  rest               numeric not null default 0, -- net − payé : la dette laissée
  type               text not null default 'subscription_payment'
                       check (type in ('subscription_payment','debt_payment')),
  paid_from          text                       -- d'où vient l'argent (null = la famille)
                       check (paid_from is null or paid_from in
                              ('cash','teacher_salary','teacher_debt','school_cash')),
  date               text not null default '',
  description        text
);

-- `paid_from` distingue trois provenances qui ne se lisent pas de la même façon
-- dans la caisse :
--   * `cash` / null       — la famille a payé au guichet : une entrée en caisse.
--   * `teacher_salary`    — retenu sur la paie d'un enseignant père : AUCUN
--                           mouvement de caisse, l'école est payée en versant
--                           moins à l'enseignant.
--   * `teacher_debt`      — la scolarité de l'enfant a été SOLDÉE D'AVANCE au
--                           guichet et PORTÉE sur le salaire du père : aucun
--                           mouvement de caisse non plus, l'école sera payée le
--                           jour de la paie. La retenue en attente vit dans
--                           `teacher_child_debts`, et le prochain règlement du
--                           père la prend — une fois et une seule.
--   * `school_cash`       — l'école a avancé la dette de l'élève sur sa propre
--                           caisse pour ne pas faire attendre l'enseignant : la
--                           caisse porte le `student_payment` porté au crédit de
--                           l'élève ET le `student_debt` qui l'a financé.
-- C'est elle qui permet de distinguer, sur la paie, un mois qu'un fils
-- d'enseignant a réglé LUI-MÊME avant la paie de son père d'un mois retenu sur
-- le salaire : le premier reste affiché avec son statut mais n'est plus retenu.

-- --- Présence ------------------------------------------------------------------
-- Écrans : Présence (feuille partagée), scan RFID, fiche élève.
create table if not exists public.attendance_records (
  id               text primary key,
  student_id       text not null references public.students (id) on delete cascade,
  session_id       text not null,
  occurred_at      text not null default '',    -- champ `timestamp` côté application
  amount_deducted  numeric not null default 0,
  status           text not null default 'present'
                     check (status in ('present','late','absent','cancelled')),
  substitute_group boolean,                     -- rattrapage dans un autre groupe
  free_period_id   text,
  pre_start        boolean,                     -- séance avant la date de début
  waived_amount    numeric,                     -- prix NON facturé
  no_charge        boolean                      -- ne consomme rien, n'avance pas le mois
);

create index if not exists attendance_day_key
  on public.attendance_records (student_id, session_id, occurred_at);

-- Facturation automatique d'une semaine d'absence sur un module.
create table if not exists public.absence_penalties (
  id              text primary key,
  student_id      text not null references public.students (id) on delete cascade,
  subscription_id text,
  session_id      text,
  module_id       text,
  period_start    text not null default '',
  period_end      text not null default '',
  amount          numeric not null default 0,
  remaining_after integer not null default 0,
  created_at      text not null default ''
);

-- Part enseignant due sur la présence d'un élève, tant qu'elle n'est pas réglée.
create table if not exists public.unpaid_teacher_sessions (
  id         text primary key,
  teacher_id text not null references public.teachers (id) on delete cascade,
  session_id text not null default '',
  student_id text not null default '',
  amount     numeric not null default 0,
  date       text not null default '',
  paid       boolean not null default false,
  -- LE RÈGLEMENT QUI L'A SOLDÉE. Annuler ce règlement rend la part à nouveau
  -- due : sans ce lien, une annulation ne saurait pas quoi rouvrir.
  payment_id text references public.teacher_payments (id) on delete set null
);

-- --- Contenus ------------------------------------------------------------------
-- Écran : Matières (cours déposés). Actions : créer, modifier, supprimer, image.
create table if not exists public.subjects (
  id          text primary key,
  title       text not null default '',
  description text not null default '',
  image       text,
  session_id  text not null default '',
  date        text not null default ''
);

-- Écran : Annonces. Actions : publier, cibler des groupes, inclure les parents.
create table if not exists public.announcements (
  id               text primary key,
  title            text not null default '',
  description      text not null default '',
  audience         text not null default 'all' check (audience in ('students','teachers','parents','all')),
  end_date         text not null default '',
  date             text not null default '',
  target_group_ids jsonb,
  include_parents  boolean
);

-- --- Finances --------------------------------------------------------------------
-- Écran : Dépenses. Actions : créer une catégorie, enregistrer une dépense.
create table if not exists public.expense_categories (
  id   text primary key,
  name text not null default ''
);

create table if not exists public.expenses (
  id          text primary key,
  name        text not null default '',
  category_id text references public.expense_categories (id) on delete set null,
  amount      numeric not null default 0,
  date        text not null default ''
);

-- Écran : Caisse. Actions : entrée, sortie ; alimentée automatiquement par les
-- paiements élèves, les règlements enseignants et les acomptes.
create table if not exists public.cash_transactions (
  id          text primary key,
  type        text not null check (type in ('deposit','withdraw','expense','student_payment','teacher_payment','acompte','student_debt')),
  amount      numeric not null default 0,       -- signé
  date        text not null default '',
  description text not null default ''
);

-- --- Parents ---------------------------------------------------------------------
-- Écran : Parents. Actions : créer (avec compte), rattacher des enfants,
-- modifier, supprimer, notifier.
create table if not exists public.parents (
  id         text primary key,
  first_name text not null default '',
  last_name  text not null default '',
  phone      text not null default '',
  email      text not null default '',
  child_ids  jsonb not null default '[]'::jsonb
);

alter table public.students
  drop constraint if exists students_parent_id_fkey;
alter table public.students
  add constraint students_parent_id_fkey
  foreign key (parent_id) references public.parents (id) on delete set null;

create table if not exists public.notifications (
  id          text primary key,
  parent_id   text not null references public.parents (id) on delete cascade,
  title       text not null default '',
  description text not null default '',
  date        text not null default '',
  read        boolean not null default false,
  auto        boolean not null default false
);

-- --- Travaux et séances libres -----------------------------------------------------
-- Écran : Indépendant. Actions : créer un stage, enregistrer un passager.
create table if not exists public.coursework (
  id                text primary key,
  name              text not null default '',
  type              text not null default 'single' check (type in ('single','period')),
  dates             jsonb not null default '[]'::jsonb,
  price_per_session numeric not null default 0,
  total             numeric not null default 0,
  teacher_id        text references public.teachers (id) on delete set null
);

create table if not exists public.independent_sessions (
  id            text primary key,
  student_id    text references public.students (id) on delete set null,
  passager_name text,
  item_label    text not null default '',
  price         numeric not null default 0,
  date          text not null default '',
  session_id    text,
  start_time    text,
  end_time      text,
  created_at    text,
  teacher_paid  boolean not null default false
);

-- Séance libre vendue à un GROUPE d'élèves : personne n'est nommé, on saisit
-- le nombre d'élèves, le prix par élève et la part de l'école ; la part de
-- l'enseignant et les totaux s'en déduisent. Les deux mouvements de caisse
-- (recette et paie de l'enseignant) sont référencés ici, pour que modifier ou
-- supprimer la séance les emporte avec elle.
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


-- =============================================================================
--  4. INDEX
-- =============================================================================

create index if not exists idx_classes_category         on public.classes (category_id);
create index if not exists idx_sessions_class           on public.schedule_sessions (class_id);
create index if not exists idx_sessions_teacher         on public.schedule_sessions (teacher_id);
create index if not exists idx_sessions_module          on public.schedule_sessions (module_id);
create index if not exists idx_subscriptions_session    on public.subscriptions (session_id);
create index if not exists idx_students_parent          on public.students (parent_id);
create index if not exists idx_students_teacher_father  on public.students (teacher_father_id);
create index if not exists idx_enrollments_student      on public.enrollments (student_id);
create index if not exists idx_enrollments_subscription on public.enrollments (subscription_id);
create index if not exists idx_payments_student         on public.payments (student_id);
create index if not exists idx_payments_subscription    on public.payments (subscription_id);
create index if not exists idx_attendance_student       on public.attendance_records (student_id);
create index if not exists idx_attendance_session       on public.attendance_records (session_id);
create index if not exists idx_penalties_student        on public.absence_penalties (student_id);
create index if not exists idx_unpaid_teacher           on public.unpaid_teacher_sessions (teacher_id, paid);
create index if not exists idx_acomptes_teacher         on public.teacher_acomptes (teacher_id, paid);
create index if not exists idx_texpenses_teacher        on public.teacher_expenses (teacher_id, paid);
create index if not exists idx_tpayments_teacher        on public.teacher_payments (teacher_id);
create index if not exists idx_shifts_worker            on public.worker_shifts (worker_id, paid);
create index if not exists idx_notifications_parent     on public.notifications (parent_id, read);
create index if not exists idx_independent_session      on public.independent_sessions (session_id);
create index if not exists idx_group_seances_teacher     on public.group_seances (teacher_id);
create index if not exists idx_group_seances_date        on public.group_seances (date);
create index if not exists idx_profiles_entity          on public.profiles (entity_id);


-- =============================================================================
--  5. RLS
--     Lecture : tout compte connecté (les portails élève / parent / enseignant
--               recalculent leurs vues à partir de la base complète).
--     Écriture : administration + réception ; enseignants sur la présence, les
--               matières et les séances libres.
--     Exceptions : `schools` est lisible sans compte (la page de connexion
--               affiche le nom et le logo), `student_credentials` est réservée
--               au personnel, et chacun peut corriger SA propre fiche depuis
--               son espace (nom, prénom, téléphone) — jamais celle d'un autre.
-- =============================================================================

do $$
declare
  t text;
  staff_write text[] := array[
    'schools','class_categories','modules','class_groups','salles','classes',
    'teachers','teacher_payments','teacher_acomptes','teacher_expenses','teacher_absences',
    'teacher_child_debts',
    'reception_staff','worker_shifts','schedule_sessions','subscriptions','free_periods',
    'module_absence_rules','students','payments','absence_penalties',
    'announcements','expense_categories','expenses',
    'cash_transactions','parents','notifications','coursework','group_seances'
  ];
  -- L'enseignant remplit la feuille de présence : cela écrit la présence, mais
  -- aussi le solde de l'inscription et sa propre part à payer.
  teacher_write text[] := array[
    'attendance_records','enrollments','unpaid_teacher_sessions',
    'subjects','independent_sessions'
  ];
begin
  -- Toutes les tables : RLS active + lecture pour les comptes connectés.
  foreach t in array staff_write || teacher_write || array['profiles','student_credentials']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
  end loop;

  foreach t in array staff_write
  loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (true)',
      t || '_read', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_staff()) with check (public.is_staff())',
      t || '_write', t);
  end loop;

  foreach t in array teacher_write
  loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (true)',
      t || '_read', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_staff_or_teacher()) with check (public.is_staff_or_teacher())',
      t || '_write', t);
  end loop;
end;
$$;

-- Mots de passe du portail : personnel uniquement, en lecture comme en écriture.
drop policy if exists student_credentials_staff on public.student_credentials;
create policy student_credentials_staff on public.student_credentials
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- Profils : lisibles par tout compte connecté. Cette policy ne DOIT PAS
-- appeler is_staff(), qui lit lui-même profiles : la policy se rappellerait
-- elle-même. Les écrans du personnel listent de toute façon déjà les fiches
-- correspondantes, profiles n'expose rien de plus.
create policy profiles_read on public.profiles
  for select to authenticated
  using (true);

create policy profiles_write on public.profiles
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Chacun peut corriger son propre nom depuis son espace. Le déclencheur
-- ci-dessous empêche d'en profiter pour se changer de rôle.
drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles
  for update to authenticated
  using (id = auth.uid()::text) with check (id = auth.uid()::text);

create or replace function public.profiles_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if not public.is_admin() then
    new.role      := old.role;
    new.entity_id := old.entity_id;
  end if;
  return new;
end;
$fn$;

drop trigger if exists profiles_guard_trg on public.profiles;
create trigger profiles_guard_trg
  before update on public.profiles
  for each row execute function public.profiles_guard();

-- Espaces enseignant / élève / parent : chacun corrige son nom et son
-- téléphone sur SA fiche. L'identifiant de la fiche est celui du compte, donc
-- la comparaison suffit à interdire de toucher celle d'un autre.
do $$
declare
  t text;
begin
  foreach t in array array['teachers','students','parents']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_self_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_self_insert', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using (id = auth.uid()::text) with check (id = auth.uid()::text)',
      t || '_self_update', t);
    -- L'application enregistre une ligne modifiée par UPSERT ; PostgreSQL
    -- vérifie alors AUSSI la policy d'insertion, même quand c'est la branche
    -- "mise à jour" qui s'exécute. La ligne existant déjà, cette policy
    -- n'ouvre rien de plus que la précédente.
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (id = auth.uid()::text)',
      t || '_self_insert', t);
  end loop;
end;
$$;

-- …mais rien d'autre : sans ce garde-fou, la policy ci-dessus laisserait un
-- élève réécrire ses propres frais dus ou un enseignant son pourcentage, car
-- l'application enregistre la ligne entière. Hors personnel, seuls le prénom,
-- le nom et le téléphone bougent ; tout le reste est remis à sa valeur d'avant.
create or replace function public.self_fiche_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_first text := new.first_name;
  v_last  text := new.last_name;
  v_phone text := new.phone;
begin
  if public.is_staff() then
    return new;
  end if;
  new := old;
  new.first_name := v_first;
  new.last_name  := v_last;
  new.phone      := v_phone;
  return new;
end;
$fn$;

do $$
declare
  t text;
begin
  foreach t in array array['teachers','students','parents']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_self_guard', t);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.self_fiche_guard()',
      t || '_self_guard', t);
  end loop;
end;
$$;

-- La page de connexion lit le nom et le logo de l'école avant toute connexion.
drop policy if exists schools_public_read on public.schools;
create policy schools_public_read on public.schools
  for select to anon using (true);


-- =============================================================================
--  6. STORAGE — logo de l'école et images des matières
-- =============================================================================

-- Selon le projet, storage.objects appartient à supabase_storage_admin et
-- refuse un CREATE POLICY lancé depuis l'éditeur SQL. Le bloc est donc protégé :
-- si les droits manquent, le script continue et il suffit de créer les deux
-- buckets publics "logos" et "subjects" depuis Dashboard > Storage.
do $$
begin
  insert into storage.buckets (id, name, public)
  values ('logos', 'logos', true), ('subjects', 'subjects', true)
  on conflict (id) do update set public = true;

  execute 'drop policy if exists "school assets public read"  on storage.objects';
  execute 'drop policy if exists "school assets staff write"  on storage.objects';
  execute 'drop policy if exists "school assets staff update" on storage.objects';
  execute 'drop policy if exists "school assets staff delete" on storage.objects';

  execute $p$create policy "school assets public read" on storage.objects
    for select to anon, authenticated
    using (bucket_id in ('logos', 'subjects'))$p$;

  execute $p$create policy "school assets staff write" on storage.objects
    for insert to authenticated
    with check (bucket_id in ('logos', 'subjects') and public.is_staff_or_teacher())$p$;

  execute $p$create policy "school assets staff update" on storage.objects
    for update to authenticated
    using (bucket_id in ('logos', 'subjects') and public.is_staff_or_teacher())$p$;

  execute $p$create policy "school assets staff delete" on storage.objects
    for delete to authenticated
    using (bucket_id in ('logos', 'subjects') and public.is_staff_or_teacher())$p$;
exception
  when others then
    raise notice 'Storage ignoré (%). Créez les buckets publics "logos" et "subjects" depuis Dashboard > Storage.', sqlerrm;
end;
$$;


-- =============================================================================
--  7. LA LIGNE DE CONFIGURATION DE L'ÉCOLE
--     Seule ligne créée par ce script : l'application a besoin d'un
--     établissement à afficher. Tout se remplit ensuite depuis Paramètres.
--     AUCUNE donnée de démonstration n'est insérée.
-- =============================================================================

insert into public.schools (id, name, description, phone, email, address, absence_week_start_day)
values ('school', 'École', '', '', '', '', 0)
on conflict (id) do nothing;


-- =============================================================================
--  8. DROITS
--     Les policies RLS ci-dessus restent le vrai filtre : ces GRANT ne font
--     qu'ouvrir les tables aux deux rôles PostgREST.
-- =============================================================================

grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to authenticated;
grant all on all sequences in schema public to authenticated;
grant select on public.schools to anon;
