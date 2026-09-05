-- =============================================================================
--  RÉPARATION — 05/09/2026
--  Projet : https://jehpfbupmhbnbbkzhiwr.supabase.co
--
--  DEUX ÉLÈVES de l'emploi du temps « لكحل(خاص) » (فيزياء, 1 500 DA la séance)
--  affichaient une dette trop BASSE, parce qu'UNE séance réellement suivie avait
--  été laissée à 0 DA : elle était datée AVANT la date de début enregistrée sur
--  leur inscription, et le pointage la traitait alors comme « offerte » tout en
--  la comptant pour une séance du mois.
--
--      نرجس تلي   (00087) : 2 séances suivies → « consommé 1 500 » au lieu de 3 000
--      رتاج حمودة (00088) : 3 séances suivies → « consommé 3 000 » au lieu de 4 500
--
--  Ce script REFACTURE ces séances au tarif de l'emploi, efface le drapeau
--  « avant inscription », et remet les deux soldes d'accord avec le consommé.
--
--  Il est IDEMPOTENT (le relancer ne double aucun chiffre) et STRICTEMENT limité
--  à ces DEUX élèves sur CET emploi : les autres emplois de ces élèves (dont
--  l'« école seule » de رتاج), les autres élèves, les périodes gratuites et les
--  cas spéciaux ne sont PAS touchés.
--
--  Le côté APPLICATION est déjà corrigé : une présence pointée sur la feuille se
--  facture désormais toujours, même datée avant le début de l'inscription — donc
--  le problème ne reviendra plus. Ce script ne fait que rattraper l'existant.
--
--  À exécuter dans le SQL Editor de Supabase, de haut en bas.
-- =============================================================================


-- -----------------------------------------------------------------------------
--  ÉTAPE 0 — DIAGNOSTIC (lecture seule : rien n'est modifié)
--
--  Montre, pour les deux élèves sur cet emploi, chaque séance pointée à 0 DA et
--  le tarif qu'elle aurait dû porter. VÉRIFIEZ que la liste correspond bien à
--  نرجس et رتاج avant de lancer la suite. Si elle est vide, remplacez le nom de
--  l'emploi ci-dessous (ligne « ses.title = … ») par « %لكحل% » avec l'opérateur
--  `like`, ou ajustez le numéro d'inscription.
-- -----------------------------------------------------------------------------
select s.registration_number                          as n_inscription,
       s.first_name || ' ' || s.last_name             as eleve,
       ses.title                                      as emploi,
       a.occurred_at                                  as date,
       a.status,
       a.amount_deducted                              as montant_actuel,
       coalesce(a.pre_start, false)                   as avant_inscription,
       coalesce(a.waived_amount, 0)                   as prix_non_facture,
       a.free_period_id                               as periode_gratuite,
       round(coalesce(
               nullif(sub.price_per_session, 0),
               case when coalesce(sub.monthly_seances, 0) > 0
                    then sub.monthly_price::numeric / sub.monthly_seances end,
               0)::numeric, 2)                        as tarif_attendu
  from public.attendance_records a
  join public.schedule_sessions ses on ses.id = a.session_id
  join public.subscriptions     sub on sub.session_id = a.session_id
  join public.students          s   on s.id = a.student_id
 where ses.title = 'لكحل(خاص)'
   and nullif(regexp_replace(coalesce(s.registration_number, ''), '[^0-9]', '', 'g'), '')::int
         in (87, 88)
 order by eleve, a.occurred_at;


-- -----------------------------------------------------------------------------
--  ÉTAPE 1 — REFACTURER LES SÉANCES SUIVIES LAISSÉES À 0 DA
--
--  Le même filtre, en écriture : une PRÉSENCE (présent / en retard) laissée à
--  0 DA sans gratuité explicite (période gratuite, cas spécial offert) reprend
--  le tarif de l'emploi, et cesse d'être marquée « avant inscription ».
-- -----------------------------------------------------------------------------
with fix as (
  select a.id as attendance_id,
         round(coalesce(
                 nullif(sub.price_per_session, 0),
                 case when coalesce(sub.monthly_seances, 0) > 0
                      then sub.monthly_price::numeric / sub.monthly_seances end,
                 0)::numeric, 2) as seance_price
    from public.attendance_records a
    join public.schedule_sessions ses on ses.id = a.session_id
    join public.subscriptions     sub on sub.session_id = a.session_id
    join public.students          s   on s.id = a.student_id
   where ses.title = 'لكحل(خاص)'
     and nullif(regexp_replace(coalesce(s.registration_number, ''), '[^0-9]', '', 'g'), '')::int
           in (87, 88)
     and a.status in ('present', 'late')
     and coalesce(a.amount_deducted, 0) = 0
     and coalesce(a.no_charge, false) = false
     and a.free_period_id is null
     and not (coalesce(s.is_free, false) or s.student_case = 'special')
)
update public.attendance_records a
   set amount_deducted = f.seance_price,
       pre_start       = false,
       waived_amount   = 0
  from fix f
 where a.id = f.attendance_id
   and f.seance_price > 0;


-- -----------------------------------------------------------------------------
--  ÉTAPE 2 — REMETTRE LES DEUX SOLDES D'ACCORD AVEC LE CONSOMMÉ
--
--      solde de l'inscription = tout ce qui a été VERSÉ − tout ce qui a été DÉBITÉ
--
--  On le repose à partir de ce qui est réellement écrit en base. Seule
--  l'inscription des deux élèves sur CET emploi est concernée.
-- -----------------------------------------------------------------------------
with verse as (
  select p.student_id, p.subscription_id, sum(coalesce(p.amount_paid, 0)) as total
    from public.payments p
   where p.subscription_id is not null
   group by p.student_id, p.subscription_id
),
consomme as (
  select a.student_id, sub.id as subscription_id, sum(coalesce(a.amount_deducted, 0)) as total
    from public.attendance_records a
    join public.subscriptions sub on sub.session_id = a.session_id
   where a.status <> 'cancelled'
     and coalesce(a.no_charge, false) = false
   group by a.student_id, sub.id
),
cible as (
  select e.id,
         coalesce(v.total, 0) - coalesce(c.total, 0) as solde_juste
    from public.enrollments       e
    join public.students          s   on s.id  = e.student_id
    join public.subscriptions     sub on sub.id = e.subscription_id
    join public.schedule_sessions ses on ses.id = sub.session_id
    left join verse    v on v.student_id = e.student_id and v.subscription_id = e.subscription_id
    left join consomme c on c.student_id = e.student_id and c.subscription_id = e.subscription_id
   where ses.title = 'لكحل(خاص)'
     and nullif(regexp_replace(coalesce(s.registration_number, ''), '[^0-9]', '', 'g'), '')::int
           in (87, 88)
)
update public.enrollments e
   set balance = cible.solde_juste
  from cible
 where e.id = cible.id
   and e.balance is distinct from cible.solde_juste;


-- -----------------------------------------------------------------------------
--  ÉTAPE 3 — VÉRIFICATION (lecture seule)
--
--  Attendu après réparation :
--      نرجس تلي   (00087) : 2 séances · consommé 3 000 · solde −3 000
--      رتاج حمودة (00088) : 3 séances · consommé 4 500 · solde −4 500
-- -----------------------------------------------------------------------------
select s.registration_number                                              as n_inscription,
       s.first_name || ' ' || s.last_name                                 as eleve,
       count(*) filter (where a.status in ('present', 'late'))            as seances_suivies,
       coalesce(sum(a.amount_deducted) filter (
         where a.status <> 'cancelled' and coalesce(a.no_charge, false) = false), 0) as consomme,
       e.balance                                                          as solde
  from public.enrollments       e
  join public.students          s   on s.id  = e.student_id
  join public.subscriptions     sub on sub.id = e.subscription_id
  join public.schedule_sessions ses on ses.id = sub.session_id
  left join public.attendance_records a on a.student_id = e.student_id and a.session_id = sub.session_id
 where ses.title = 'لكحل(خاص)'
   and nullif(regexp_replace(coalesce(s.registration_number, ''), '[^0-9]', '', 'g'), '')::int
         in (87, 88)
 group by s.registration_number, eleve, e.balance
 order by eleve;
