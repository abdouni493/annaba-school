-- =============================================================================
--  MISE À JOUR — LES MÉTIERS, LES DROITS D'ACCÈS ET LA SIGNATURE DES OPÉRATIONS
--  Projet : https://jehpfbupmhbnbbkzhiwr.supabase.co
--
--  À exécuter TEL QUEL dans le SQL Editor de Supabase, UNE SEULE FOIS.
--  Le script est IDEMPOTENT : le relancer ne réécrit rien de ce qui existe.
--  Il n'AJOUTE que des tables et des colonnes facultatives, et n'ASSOUPLIT
--  qu'une seule contrainte. Rien n'est supprimé.
--
--  CE QUE ÇA RÈGLE
--  ---------------
--  1. LES MÉTIERS ÉTAIENT ÉCRITS DANS LE CODE. Un travailleur ne pouvait être
--     que « réception », « agent de sécurité » ou « ménage » — une contrainte
--     de la base l'imposait. L'école emploie pourtant un chauffeur, un
--     cuisinier, un surveillant. Les métiers deviennent des LIGNES, créées et
--     supprimées depuis l'écran de création d'un travailleur.
--
--  2. LES DROITS ÉTAIENT CONSTANTS. Tout compte « réception » voyait le même
--     menu et les mêmes boutons. Chaque fiche porte désormais SES écrans
--     (`nav_keys`) et SES boutons (`action_keys`) ; un travailleur créé
--     aujourd'hui n'a AUCUN droit tant que l'administration n'a rien coché.
--
--  3. LE COMPTE DE CONNEXION ÉTAIT DEVINÉ. Il existait dès qu'un email avait
--     été tapé. Il est maintenant activé explicitement, avec son nom
--     d'utilisateur.
--
--  4. LA PAIE DES TRAVAILLEURS SE DEVINAIT DANS LES LIBELLÉS DE LA CAISSE.
--     « Ce mois est-il payé ? » se répondait en cherchant le nom de famille et
--     « 08/2026 » dans la description d'un mouvement. Deux homonymes, un
--     libellé corrigé à la main, et un mois payé repassait pour impayé. Les
--     règlements sont désormais une table à part entière, et les acomptes
--     comme les absences ne sont plus EFFACÉS au paiement : ils sont marqués
--     payés, avec le numéro du règlement qui les a retenus.
--
--  5. PERSONNE NE SAVAIT QUI AVAIT FAIT QUOI. Chaque ligne créée par
--     l'application porte maintenant le compte qui l'a écrite, son nom et son
--     rôle. C'est ce qui permet à la direction de voir, sur son tableau de
--     bord, les encaissements saisis par les travailleurs.
-- =============================================================================


-- -----------------------------------------------------------------------------
--  1. LES MÉTIERS
-- -----------------------------------------------------------------------------
create table if not exists public.worker_roles (
  id         text primary key,
  name       text not null default '',
  created_at text
);

comment on table public.worker_roles is
  'Les métiers du personnel, nommés par l''école elle-même.';

-- Les trois métiers d'origine gardent leur identifiant : les fiches déjà en
-- base pointent donc le bon métier, sans reprise.
insert into public.worker_roles (id, name, created_at) values
  ('reception', 'Réception',          '2020-01-01T00:00:00.000Z'),
  ('security',  'Agent de sécurité',  '2020-01-01T00:00:01.000Z'),
  ('menage',    'Ménage',             '2020-01-01T00:00:02.000Z')
on conflict (id) do nothing;

-- Le métier n'est plus une énumération figée : la contrainte qui n'admettait
-- que les trois valeurs d'origine tombe.
alter table public.reception_staff
  drop constraint if exists reception_staff_role_check;


-- -----------------------------------------------------------------------------
--  2. LA FICHE DU TRAVAILLEUR — compte de connexion et droits d'accès
-- -----------------------------------------------------------------------------
alter table public.reception_staff
  add column if not exists has_account boolean not null default false,
  add column if not exists username    text,
  add column if not exists nav_keys    text[],
  add column if not exists action_keys text[],
  add column if not exists created_at  text;

comment on column public.reception_staff.has_account is
  'Ce travailleur peut-il se connecter ? Activé explicitement, jamais deviné.';
comment on column public.reception_staff.nav_keys is
  'Les écrans visibles dans SA barre latérale. NULL = fiche antérieure aux '
  'droits (elle garde l''ancien menu de la réception) ; tableau vide = aucun écran.';
comment on column public.reception_staff.action_keys is
  'Les boutons qu''il voit, sous la forme « écran:action » (« students:create »).';

-- Reprise des fiches existantes : celles qui portaient déjà un email avaient,
-- de fait, un compte. On le dit explicitement plutôt que de le redeviner.
update public.reception_staff
   set has_account = true
 where has_account = false
   and coalesce(email, '') <> '';

update public.reception_staff
   set username = email
 where coalesce(username, '') = ''
   and coalesce(email, '') <> '';

-- Une date de création pour les fiches qui n'en ont pas, dans l'ordre où la
-- table les rend aujourd'hui : la liste se lit du dernier arrivé au plus ancien.
with ordonnees as (
  select ctid,
         row_number() over (order by ctid) as rang,
         count(*)     over ()              as total
    from public.reception_staff
)
update public.reception_staff r
   set created_at = to_char(
         (now() at time zone 'utc') - ((o.total - o.rang) * interval '1 second'),
         'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  from ordonnees o
 where o.ctid = r.ctid
   and coalesce(r.created_at, '') = '';


-- -----------------------------------------------------------------------------
--  3. LES RÈGLEMENTS VERSÉS AUX TRAVAILLEURS
-- -----------------------------------------------------------------------------
create table if not exists public.worker_payments (
  id          text primary key,
  worker_id   text not null references public.reception_staff (id) on delete cascade,
  kind        text not null default 'monthly',
  period_keys text[] not null default '{}',   -- « 08/2026 », « 2026-08-14 », …
  shift_ids   text[],                         -- contrat horaire : journées réglées
  gross       numeric not null default 0,
  acomptes    numeric not null default 0,
  absences    numeric not null default 0,
  net         numeric not null default 0,
  amount      numeric not null default 0,     -- ce qui est réellement sorti
  date        text not null default '',       -- YYYY-MM-DD, corrigeable
  description text,
  cash_id     text,
  created_at  text
);

comment on table public.worker_payments is
  'Un règlement versé à un travailleur : ce qu''il solde, ce qui en a été '
  'retenu, et ce qui est sorti de la caisse.';

create index if not exists idx_worker_payments_worker
  on public.worker_payments (worker_id, date desc);


-- -----------------------------------------------------------------------------
--  4. LES ACOMPTES ET LES ABSENCES DES TRAVAILLEURS
--
--  Ils étaient écrits dans `teacher_acomptes` et `teacher_absences`, dont la
--  clé étrangère exige pourtant un ENSEIGNANT. La base refusait donc la ligne :
--  une avance versée à un agent de sécurité n'était JAMAIS enregistrée, et la
--  retenue n'apparaissait nulle part sur sa paie. Il n'y a rien à reprendre —
--  aucune de ces lignes n'a jamais pu être écrite.
--
--  Ils ont désormais leur table, avec la bonne clé étrangère, et ils ne sont
--  plus EFFACÉS au règlement : ils sont marqués payés, avec le numéro du
--  règlement qui les a retenus. L'historique du travailleur garde donc trace de
--  chaque avance consentie et de chaque absence retenue.
-- -----------------------------------------------------------------------------
create table if not exists public.worker_acomptes (
  id          text primary key,
  worker_id   text not null references public.reception_staff (id) on delete cascade,
  amount      numeric not null default 0,
  description text not null default '',
  date        text not null default '',
  paid        boolean not null default false,
  payment_id  text
);

create table if not exists public.worker_absences (
  id          text primary key,
  worker_id   text not null references public.reception_staff (id) on delete cascade,
  cost        numeric not null default 0,
  description text not null default '',
  date        text not null default '',
  paid        boolean not null default false,
  payment_id  text
);

comment on table public.worker_acomptes is
  'Avances sur salaire versées aux travailleurs, retenues une fois et une seule.';
comment on table public.worker_absences is
  'Absences retenues sur la paie des travailleurs, une fois et une seule.';

create index if not exists idx_worker_acomptes_open on public.worker_acomptes (worker_id, paid);
create index if not exists idx_worker_absences_open on public.worker_absences (worker_id, paid);


-- -----------------------------------------------------------------------------
--  5. L'ALERTE DES ENCAISSEMENTS SAISIS PAR LES TRAVAILLEURS
-- -----------------------------------------------------------------------------
alter table public.payments
  add column if not exists alert_read boolean not null default false;

comment on column public.payments.alert_read is
  'L''alerte du tableau de bord a-t-elle été lue par la direction ?';

-- Tout ce qui existe déjà a été saisi avant la traçabilité : rien ne doit
-- remonter d'un coup dans la cloche de l'administration.
update public.payments set alert_read = true where alert_read = false;


-- -----------------------------------------------------------------------------
--  6. QUI A FAIT L'OPÉRATION — trois colonnes sur toutes les tables
--
--  Le nom et le rôle sont RECOPIÉS au moment de l'écriture plutôt que relus
--  plus tard : un travailleur qui quitte l'école, et dont la fiche disparaît,
--  laisse quand même un historique lisible.
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
    execute format(
      'alter table public.%I
         add column if not exists created_by        text,
         add column if not exists created_by_name   text,
         add column if not exists created_by_role   text', t);
  end loop;
end;
$$;

-- Retrouver « tout ce qu'a fait ce compte » ne doit pas balayer la table.
create index if not exists idx_payments_author    on public.payments (created_by);
create index if not exists idx_attendance_author  on public.attendance_records (created_by);
create index if not exists idx_cash_author        on public.cash_transactions (created_by);
create index if not exists idx_charges_author     on public.student_charges (created_by);
-- La cloche du tableau de bord : les encaissements non lus, d'abord.
create index if not exists idx_payments_alert     on public.payments (alert_read, date desc);


-- -----------------------------------------------------------------------------
--  7. RLS — les deux nouvelles tables suivent la règle des autres
--     Lecture : tout compte connecté. Écriture : administration + réception.
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
  nouvelles text[] := array[
    'worker_roles','worker_acomptes','worker_absences','worker_payments'
  ];
begin
  foreach t in array nouvelles
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (true)',
      t || '_read', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_staff()) with check (public.is_staff())',
      t || '_write', t);
  end loop;
end;
$$;


-- -----------------------------------------------------------------------------
--  8. LES COMPTES DES TRAVAILLEURS — activés APRÈS coup, sur une fiche existante
--
--  Un travailleur créé sans compte porte un identifiant à lui (« wrk-… »). Le
--  jour où l'administration lui ouvre un accès, l'ancienne fonction
--  `admin_create_user` rendait un identifiant TOUT NEUF : il aurait fallu
--  déplacer la fiche, ses pointages, ses acomptes et ses règlements sous ce
--  nouvel identifiant. On garde donc la fiche là où elle est, et c'est le PROFIL
--  qui pointe vers elle (`entity_id`) — exactement ce que l'application lit
--  pour retrouver les droits d'un compte.
-- -----------------------------------------------------------------------------

-- Crée le compte d'une fiche DÉJÀ EN BASE, sans déplacer la fiche.
create or replace function public.admin_create_user_for(
  p_entity_id text,
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

  return public._create_auth_user(
    p_email, p_password, p_role, p_full_name, p_username, p_entity_id);
end;
$$;

grant execute on function public.admin_create_user_for(text, text, text, text, text, text)
  to authenticated;

-- Le compte qui pilote une fiche, quand il en existe un. C'est lui qu'il faut
-- viser pour changer un mot de passe ou un email : l'identifiant de la fiche
-- n'est PAS forcément celui du compte.
create or replace function public.account_for_entity(p_entity_id text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.id from public.profiles p where p.entity_id = p_entity_id limit 1
$$;

grant execute on function public.account_for_entity(text) to authenticated;

-- Le nom d'utilisateur affiché sur un compte. `profiles` n'est modifiable que
-- par un administrateur ; la réception, qui gère pourtant les fiches, passe donc
-- par ici.
create or replace function public.admin_set_username(
  p_user_id  text,
  p_username text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'NOT_ALLOWED';
  end if;

  update public.profiles
     set username = nullif(trim(p_username), '')
   where id = p_user_id;
end;
$$;

grant execute on function public.admin_set_username(text, text) to authenticated;
