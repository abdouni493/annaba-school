-- =============================================================================
--  MISE À JOUR — SÉANCES LIBRES SOLO + SÉANCES SUIVIES SANS ÊTRE FACTURÉES
--  Projet : https://jehpfbupmhbnbbkzhiwr.supabase.co
--
--  À exécuter dans le SQL Editor de Supabase. Le script est IDEMPOTENT :
--  chaque instruction est un « create … if not exists » ou un « add column if
--  not exists », et la partie réparation ne corrige que ce qui est faux. Le
--  relancer ne casse rien et ne double aucun chiffre.
--
--  ---------------------------------------------------------------------------
--  CE QU'IL Y A DEDANS
--  ---------------------------------------------------------------------------
--   1. NOUVELLE TABLE `public.solo_seances` — les « séances libres solo ».
--      C'est la seule chose du lot qui EXIGE d'être exécutée : sans cette
--      table, le nouvel écran « Séances libres solo » restera vide et rien ne
--      pourra s'y enregistrer.
--
--   2. RÉPARATION (facultative mais recommandée) des présences enregistrées
--      à 0 DA alors que rien ne les offrait, et des soldes qu'elles ont
--      faussés. C'est le « 3 séances · consommé 3 000 DA » d'un emploi du
--      temps à 1 500 DA la séance.
--
--  RIEN D'AUTRE NE DEMANDE DE COLONNE. Le nom de l'emploi du temps sur la
--  fiche de paie, la liste complète des élèves (payés ET non payés) sur le bon,
--  l'alerte « avancé par l'école » qui s'éteint, les bons de séance libre
--  imprimés un par un et le retrait de « Sujets & Exercices » de la barre
--  latérale sont entièrement côté application.
-- =============================================================================


-- =============================================================================
--  PARTIE 1 — LES SÉANCES LIBRES SOLO
--
--  Troisième forme de séance ponctuelle, et la seule qui ne dépende d'AUCUN
--  emploi du temps : la réception choisit l'enseignant, la salle et les
--  horaires, désigne les élèves un par un (une fiche de l'école, ou un simple
--  nom), puis fixe le prix payé par UN élève et la part que l'école garde.
--
--      part enseignant d'un élève = prix élève − part école
--
--  `teacher_paid` porte tout le sel de la table. Tant qu'il est FAUX, la part
--  de l'enseignant est DUE et se signale en alerte — sur le tableau de bord,
--  sur la carte de l'enseignant et en haut de sa fiche. Elle ne passe JAMAIS
--  par son écran de paie mensuelle : cette séance-là n'appartient à aucun mois.
-- =============================================================================

create table if not exists public.solo_seances (
  id                 text primary key,
  teacher_id         text not null references public.teachers (id) on delete cascade,
  salle_id           text references public.salles (id) on delete set null,
  title              text not null default '',
  description        text,
  date               text not null default '',
  start_time         text not null default '',
  end_time           text not null default '',
  attendees          jsonb not null default '[]'::jsonb,   -- [{studentId?, name}]
  price_per_student  numeric not null default 0,
  school_per_student numeric not null default 0,
  teacher_paid       boolean not null default false,       -- sa part est-elle versée ?
  teacher_paid_at    text,
  cash_in_id         text,
  cash_out_id        text,
  created_at         text,
  created_by         text,
  created_by_name    text,
  created_by_role    text
);

-- Filet de sécurité si la table existait déjà dans une version antérieure.
alter table public.solo_seances
  add column if not exists salle_id           text,
  add column if not exists description        text,
  add column if not exists attendees          jsonb not null default '[]'::jsonb,
  add column if not exists teacher_paid       boolean not null default false,
  add column if not exists teacher_paid_at    text,
  add column if not exists cash_in_id         text,
  add column if not exists cash_out_id        text,
  add column if not exists created_at         text,
  add column if not exists created_by         text,
  add column if not exists created_by_name    text,
  add column if not exists created_by_role    text;

comment on table public.solo_seances is
  'Séance libre SOLO : des élèves nommés, hors de tout groupe et de tout emploi du temps. La part de l''enseignant se règle ici (teacher_paid), jamais sur sa paie mensuelle.';
comment on column public.solo_seances.attendees is
  'Les élèves de la séance : [{studentId?, name}] — studentId quand l''école a une fiche, le nom seul sinon.';
comment on column public.solo_seances.teacher_paid is
  'Faux = la part de l''enseignant est DUE : elle s''affiche en alerte sur le tableau de bord, sur sa carte et sur sa fiche jusqu''à ce qu''elle soit versée.';

create index if not exists idx_solo_seances_teacher on public.solo_seances (teacher_id);
create index if not exists idx_solo_seances_date    on public.solo_seances (date);
create index if not exists idx_solo_seances_unpaid  on public.solo_seances (teacher_paid);


-- -----------------------------------------------------------------------------
--  RLS — lecture pour tout compte connecté, écriture pour le personnel,
--  exactement comme les autres tables d'argent.
-- -----------------------------------------------------------------------------
alter table public.solo_seances enable row level security;

drop policy if exists solo_seances_read  on public.solo_seances;
drop policy if exists solo_seances_write on public.solo_seances;

create policy solo_seances_read on public.solo_seances
  for select to authenticated using (true);

create policy solo_seances_write on public.solo_seances
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

grant all on public.solo_seances to authenticated;


-- =============================================================================
--  PARTIE 2 — LES SÉANCES SUIVIES MAIS JAMAIS FACTURÉES
--
--  LE SYMPTÔME
--  -----------
--  Sur la feuille de présence d'un groupe, la ligne d'un élève affichait :
--
--      3/4 séance(s) · consommé 3 000 DA
--      Solde de l'emploi : 3 000 DA dus
--
--  …sur un emploi du temps à 1 500 DA la séance. Trois séances à 1 500 en
--  valent 4 500 : la ligne se contredisait elle-même.
--
--  D'OÙ ÇA VIENT
--  -------------
--  Une des trois présences avait été écrite avec un montant NUL alors que rien
--  ne l'offrait. Cela arrive pour de vrai : le créneau a été pointé avant que
--  son tarif ne soit saisi (l'abonnement valait encore 0 DA), ou la ligne a été
--  corrigée à la main depuis l'historique sans que son montant suive. Le solde
--  de l'inscription, lui, a été débité du même zéro : les deux compteurs
--  étaient d'accord entre eux, et faux tous les deux.
--
--  Une séance ne vaut zéro QUE si quelque chose l'a offerte, et la ligne le dit
--  toujours elle-même :
--     · `status = 'cancelled'`  — la séance n'a pas eu lieu ;
--     · `no_charge`             — première absence de courtoisie ;
--     · `free_period_id`        — une période portes ouvertes la couvrait ;
--     · `pre_start` / `waived_amount` — tenue avant son inscription ;
--     · élève « cas spécial » offert sur cet emploi du temps.
--
--  L'APPLICATION AFFICHE DÉJÀ LE BON CHIFFRE : elle reprend une telle séance au
--  tarif du jour. Cette réparation remet la BASE d'accord avec elle, pour que
--  les deux racontent la même histoire à tout jamais.
--
--  CE QU'ELLE NE FAIT PAS : recréer la part que ces séances devaient à
--  l'enseignant (`unpaid_teacher_sessions`). Cette part existe déjà dans
--  l'immense majorité des cas — elle est calculée depuis l'abonnement, pas
--  depuis le montant débité à l'élève — et en fabriquer de nouvelles à
--  l'aveugle risquerait de le payer deux fois. Une part réellement manquante
--  se rattrape depuis l'écran de paie, mois par mois.
--
--  ⚠️ ELLE EST FACULTATIVE. Si vous préférez ne rien réécrire, sautez-la : les
--  écrans resteront justes. Lancez alors au moins la PARTIE 2.A, qui ne modifie
--  RIEN et vous montre ce qui est concerné.
-- =============================================================================


-- -----------------------------------------------------------------------------
--  2.A — LE DIAGNOSTIC (lecture seule : rien n'est modifié)
--
--  Les présences facturables enregistrées à 0 DA sans qu'aucune gratuité ne
--  l'explique, avec le tarif qu'elles auraient dû porter.
-- -----------------------------------------------------------------------------
with tarif as (
  select a.id                         as attendance_id,
         a.student_id,
         a.session_id,
         a.occurred_at,
         a.status,
         s.registration_number,
         s.first_name || ' ' || s.last_name             as eleve,
         sub.id                                          as subscription_id,
         sub.price_per_session,
         -- « École seule » sur CET emploi : la famille ne verse que la part de
         -- l'école, donc sa séance ne coûte pas le tarif affiché.
         case
           when s.student_case = 'school_only'
            and (s.school_only_subscription_ids is null
                 or s.school_only_subscription_ids ? sub.id)
            and coalesce(sub.monthly_seances, 0) > 0
           then round(coalesce(sub.school_month_share, sub.monthly_price, 0)::numeric
                      / sub.monthly_seances, 2)
           else sub.price_per_session
         end                                             as tarif_du
    from public.attendance_records a
    join public.students      s   on s.id  = a.student_id
    join public.subscriptions sub on sub.session_id = a.session_id
   where a.status in ('present','late')          -- une VRAIE présence
     and coalesce(a.amount_deducted, 0) = 0      -- …facturée zéro
     and coalesce(a.no_charge, false) = false
     and coalesce(a.pre_start, false) = false
     and coalesce(a.waived_amount, 0) = 0
     and a.free_period_id is null
     -- Une scolarité offerte reste offerte.
     and not (coalesce(s.is_free, false) or s.student_case = 'special')
     -- Un « cas réduction » se recalcule à deux mains (école + enseignant) :
     -- on ne le touche pas ici, l'écran l'affiche déjà correctement.
     and coalesce(s.student_case, 'normal') <> 'reduction'
)
select attendance_id,
       registration_number,
       eleve,
       session_id,
       occurred_at,
       status,
       0            as montant_actuel,
       tarif_du     as montant_attendu
  from tarif
 where tarif_du > 0
 order by eleve, occurred_at;


-- -----------------------------------------------------------------------------
--  2.B — LA CORRECTION DES PRÉSENCES
--
--  Le même filtre, exactement, mais en écriture. Une remise saisie sur
--  l'inscription (ou sur la fiche de l'élève) est appliquée, comme le fait le
--  pointage lui-même.
-- -----------------------------------------------------------------------------
with tarif as (
  select a.id  as attendance_id,
         greatest(
           0,
           (case
              when s.student_case = 'school_only'
               and (s.school_only_subscription_ids is null
                    or s.school_only_subscription_ids ? sub.id)
               and coalesce(sub.monthly_seances, 0) > 0
              then round(coalesce(sub.school_month_share, sub.monthly_price, 0)::numeric
                         / sub.monthly_seances, 2)
              else sub.price_per_session
            end)
           -- la remise de l'élève sur CET emploi du temps, s'il en a une
           - coalesce(
               case
                 when coalesce(e.discount ->> 'type',
                               s.subscription_discounts -> sub.id ->> 'type') = 'percent'
                 then (case
                         when s.student_case = 'school_only'
                          and (s.school_only_subscription_ids is null
                               or s.school_only_subscription_ids ? sub.id)
                          and coalesce(sub.monthly_seances, 0) > 0
                         then round(coalesce(sub.school_month_share, sub.monthly_price, 0)::numeric
                                    / sub.monthly_seances, 2)
                         else sub.price_per_session
                       end)
                      * least(greatest(coalesce(
                          (e.discount ->> 'value')::numeric,
                          (s.subscription_discounts -> sub.id ->> 'value')::numeric, 0), 0), 100) / 100
                 else greatest(coalesce(
                        (e.discount ->> 'value')::numeric,
                        (s.subscription_discounts -> sub.id ->> 'value')::numeric, 0), 0)
               end, 0)
         ) as tarif_du
    from public.attendance_records a
    join public.students      s   on s.id  = a.student_id
    join public.subscriptions sub on sub.session_id = a.session_id
    left join public.enrollments e
           on e.student_id = a.student_id and e.subscription_id = sub.id
   where a.status in ('present','late')
     and coalesce(a.amount_deducted, 0) = 0
     and coalesce(a.no_charge, false) = false
     and coalesce(a.pre_start, false) = false
     and coalesce(a.waived_amount, 0) = 0
     and a.free_period_id is null
     and not (coalesce(s.is_free, false) or s.student_case = 'special')
     and coalesce(s.student_case, 'normal') <> 'reduction'
)
update public.attendance_records a
   set amount_deducted = t.tarif_du
  from tarif t
 where a.id = t.attendance_id
   and t.tarif_du > 0;


-- -----------------------------------------------------------------------------
--  2.C — LE RECALCUL DES SOLDES
--
--  Le solde d'une inscription n'est pas une opinion : c'est
--
--      tout ce qui a été VERSÉ dessus  −  tout ce que les présences ont DÉBITÉ
--
--  On le repose donc à partir de ce qui est réellement écrit en base, et rien
--  d'autre. Les inscriptions déjà justes ne bougent pas (le `where` les écarte).
--  LES PRÉSENCES NE SONT PAS TOUCHÉES ICI : les élèves sont bien venus au cours.
-- -----------------------------------------------------------------------------
with verse as (
  select p.student_id, p.subscription_id, sum(coalesce(p.amount_paid, 0)) as total
    from public.payments p
   where p.subscription_id is not null
   group by p.student_id, p.subscription_id
),
consomme as (
  select a.student_id, sub.id as subscription_id,
         sum(coalesce(a.amount_deducted, 0)) as total
    from public.attendance_records a
    join public.subscriptions sub on sub.session_id = a.session_id
   where a.status <> 'cancelled'
     and coalesce(a.no_charge, false) = false
   group by a.student_id, sub.id
),
cible as (
  select e.id,
         coalesce(v.total, 0) - coalesce(c.total, 0) as solde_juste
    from public.enrollments e
    left join verse    v on v.student_id = e.student_id and v.subscription_id = e.subscription_id
    left join consomme c on c.student_id = e.student_id and c.subscription_id = e.subscription_id
)
update public.enrollments e
   set balance = cible.solde_juste
  from cible
 where e.id = cible.id
   and e.balance is distinct from cible.solde_juste;


-- =============================================================================
--  PARTIE 3 — RELIRE LE SCHÉMA
--
--  Sans cela, le cache de PostgREST continue quelques minutes de dire que
--  `solo_seances` n'existe pas, et l'écran reste vide.
-- =============================================================================
notify pgrst, 'reload schema';


-- =============================================================================
--  PARTIE 4 — VÉRIFICATION (lecture seule)
-- =============================================================================
select
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'solo_seances')      as table_solo_seances_ok,   -- 1 attendue
  (select count(*) from public.solo_seances)                           as seances_solo,
  (select count(*) from public.solo_seances where teacher_paid = false) as seances_solo_a_regler,
  (select count(*)
     from public.attendance_records a
     join public.students s on s.id = a.student_id
    where a.status in ('present','late')
      and coalesce(a.amount_deducted, 0) = 0
      and coalesce(a.no_charge, false) = false
      and coalesce(a.pre_start, false) = false
      and coalesce(a.waived_amount, 0) = 0
      and a.free_period_id is null
      and not (coalesce(s.is_free, false) or s.student_case = 'special')
      and coalesce(s.student_case, 'normal') <> 'reduction')            as presences_encore_a_0_da; -- 0 attendue
