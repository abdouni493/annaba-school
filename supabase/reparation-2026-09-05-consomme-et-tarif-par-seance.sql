-- =============================================================================
--  RÉPARATION / VÉRIFICATION — 05/09/2026
--  Projet : https://jehpfbupmhbnbbkzhiwr.supabase.co
--
--  LE SYMPTÔME
--  -----------
--  Sur l'emploi du temps « عبادي » (8 séances / mois, 437,50 DA la séance),
--  deux élèves ayant le MÊME nombre de séances affichaient des chiffres
--  différents :
--
--      عبد النور عريوة (00050) : 2/7 séance(s) · consommé 875 DA     (= 2 × 437,50)
--      كوثر فضاوي      (00104) : 2/7 séance(s) · consommé 437,50 DA  (= 1 × 437,50)
--
--  D'OÙ ÇA VIENT
--  -------------
--  Une des deux séances de كوثر a été enregistrée à 0 DA. Une séance ne vaut
--  zéro QUE si quelque chose l'a offerte, et la ligne le dit elle-même :
--     · status = 'cancelled'            — la séance n'a pas eu lieu ;
--     · no_charge                       — première absence de courtoisie ;
--     · free_period_id                  — période portes ouvertes ;
--     · pre_start / waived_amount       — pointée AVANT la date de début de
--                                         l'inscription (le cas le plus fréquent) ;
--     · élève « cas spécial » offert    — scolarité offerte.
--  Hors de ces cas, elle vaut le tarif de l'élève.
--
--  ⚠️ ATTENTION — une différence peut aussi être TOTALEMENT NORMALE :
--     · une REMISE sur cet emploi (2 séances à 218,75 = 437,50) ;
--     · un élève « école seule » (il ne paie que la part de l'école).
--  L'ÉTAPE 0 tient compte des deux : ce qu'elle liste est réellement anormal.
--
--  Les élèves « cas réduction » sont ÉCARTÉS de tout ce script : leur tarif se
--  calcule à deux mains (part école + part enseignant) et se vérifie à la main.
--
--  CÔTÉ APPLICATION, c'est déjà corrigé : une présence pointée sur la feuille se
--  facture désormais toujours, même datée avant le début de l'inscription. Ce
--  script ne fait que rattraper ce qui est DÉJÀ en base.
--
--  Le script est IDEMPOTENT. Exécutez-le dans le SQL Editor de Supabase, étape
--  par étape, en LISANT le résultat de l'étape 0 et de l'étape 1 avant d'écrire.
-- =============================================================================


-- -----------------------------------------------------------------------------
--  ÉTAPE 0 — QUI EST CONCERNÉ ? (lecture seule — « vérifier tous les autres »)
--
--  Pour CHAQUE élève et CHAQUE emploi du temps : ce que les séances ont débité,
--  et ce qu'elles auraient dû débiter (tarif de l'élève, remise et « école
--  seule » comprises). Seuls les ÉCARTS sont listés. Une liste vide = tout va
--  bien, partout.
-- -----------------------------------------------------------------------------
with base as (
  select e.id                                  as enrollment_id,
         s.id                                  as student_id,
         sub.id                                as subscription_id,
         sub.session_id                        as session_id,
         ses.title                             as emploi,
         s.registration_number,
         s.first_name || ' ' || s.last_name    as eleve,
         coalesce(s.student_case, 'normal')    as student_case,
         coalesce(s.is_free, false)            as is_free,
         -- Prix catalogue d'UNE séance : la part école pour un « école seule »,
         -- sinon le prix / séance — repris de la formule mensuelle quand la
         -- colonne price_per_session est restée à 0.
         case
           when s.student_case = 'school_only'
            and (s.school_only_subscription_ids is null
                 or s.school_only_subscription_ids ? sub.id)
            and coalesce(sub.monthly_seances, 0) > 0
           then round(coalesce(sub.school_month_share, sub.monthly_price, 0)::numeric
                      / sub.monthly_seances, 2)
           else round(coalesce(
                  nullif(sub.price_per_session, 0),
                  case when coalesce(sub.monthly_seances, 0) > 0
                       then sub.monthly_price::numeric / sub.monthly_seances end,
                  0)::numeric, 2)
         end                                   as prix_catalogue,
         coalesce(e.discount ->> 'type',
                  s.subscription_discounts -> sub.id ->> 'type')            as remise_type,
         coalesce((e.discount ->> 'value')::numeric,
                  (s.subscription_discounts -> sub.id ->> 'value')::numeric, 0) as remise_valeur
    from public.enrollments       e
    join public.students          s   on s.id  = e.student_id
    join public.subscriptions     sub on sub.id = e.subscription_id
    join public.schedule_sessions ses on ses.id = sub.session_id
),
tarif as (
  select b.*,
         greatest(0, round(
           b.prix_catalogue
           - (case when b.remise_type = 'percent'
                   then b.prix_catalogue * least(greatest(b.remise_valeur, 0), 100) / 100
                   else greatest(b.remise_valeur, 0) end), 2)) as tarif_net
    from base b
),
seances as (
  select a.student_id,
         sub.id as subscription_id,
         count(*)                        filter (where a.status <> 'cancelled'
                                              and coalesce(a.no_charge, false) = false) as seances_comptees,
         coalesce(sum(a.amount_deducted) filter (where a.status <> 'cancelled'
                                              and coalesce(a.no_charge, false) = false), 0) as consomme_reel
    from public.attendance_records a
    join public.subscriptions sub on sub.session_id = a.session_id
   group by a.student_id, sub.id
)
select t.registration_number                                   as n_inscription,
       t.eleve,
       t.emploi,
       sc.seances_comptees                                     as seances,
       t.tarif_net                                             as tarif_seance,
       sc.consomme_reel                                        as consomme_actuel,
       round(sc.seances_comptees * t.tarif_net, 2)             as consomme_attendu,
       round(sc.consomme_reel - sc.seances_comptees * t.tarif_net, 2) as ecart
  from tarif t
  join seances sc on sc.student_id = t.student_id and sc.subscription_id = t.subscription_id
 where not t.is_free
   and t.student_case not in ('special', 'reduction')
   and sc.seances_comptees > 0
   and round(sc.consomme_reel - sc.seances_comptees * t.tarif_net, 2) <> 0
 order by t.emploi, t.eleve;


-- -----------------------------------------------------------------------------
--  ÉTAPE 1 — POURQUOI ? (lecture seule)
--
--  Le détail, séance par séance, des présences enregistrées à 0 DA : la colonne
--  qui porte un « true » ou un montant vous dit ce qui l'a offerte.
-- -----------------------------------------------------------------------------
select s.registration_number                as n_inscription,
       s.first_name || ' ' || s.last_name   as eleve,
       ses.title                            as emploi,
       a.occurred_at                        as date,
       a.status,
       a.amount_deducted                    as montant,
       coalesce(a.pre_start, false)         as avant_inscription,
       coalesce(a.waived_amount, 0)         as prix_non_facture,
       a.free_period_id                     as periode_gratuite,
       coalesce(a.no_charge, false)         as sans_frais
  from public.attendance_records a
  join public.schedule_sessions ses on ses.id = a.session_id
  join public.students          s   on s.id = a.student_id
 where a.status in ('present', 'late')
   and coalesce(a.amount_deducted, 0) = 0
   and coalesce(a.no_charge, false) = false
   and not (coalesce(s.is_free, false) or s.student_case = 'special')
   and coalesce(s.student_case, 'normal') <> 'reduction'
 order by ses.title, eleve, a.occurred_at;


-- -----------------------------------------------------------------------------
--  ÉTAPE 2 — REFACTURER LES PRÉSENCES À 0 DA QUE RIEN N'OFFRAIT
--
--  Cas sûr : la ligne ne porte AUCUNE justification (ni période gratuite, ni
--  « avant inscription »). Elle reprend le tarif de l'élève.
-- -----------------------------------------------------------------------------
with base as (
  select s.id as student_id, sub.session_id as session_id,
         coalesce(s.student_case, 'normal') as student_case,
         coalesce(s.is_free, false)         as is_free,
         case
           when s.student_case = 'school_only'
            and (s.school_only_subscription_ids is null
                 or s.school_only_subscription_ids ? sub.id)
            and coalesce(sub.monthly_seances, 0) > 0
           then round(coalesce(sub.school_month_share, sub.monthly_price, 0)::numeric
                      / sub.monthly_seances, 2)
           else round(coalesce(
                  nullif(sub.price_per_session, 0),
                  case when coalesce(sub.monthly_seances, 0) > 0
                       then sub.monthly_price::numeric / sub.monthly_seances end,
                  0)::numeric, 2)
         end as prix_catalogue,
         coalesce(e.discount ->> 'type',
                  s.subscription_discounts -> sub.id ->> 'type') as remise_type,
         coalesce((e.discount ->> 'value')::numeric,
                  (s.subscription_discounts -> sub.id ->> 'value')::numeric, 0) as remise_valeur
    from public.enrollments   e
    join public.students      s   on s.id  = e.student_id
    join public.subscriptions sub on sub.id = e.subscription_id
),
tarif as (
  select b.student_id, b.session_id, b.student_case, b.is_free,
         greatest(0, round(
           b.prix_catalogue
           - (case when b.remise_type = 'percent'
                   then b.prix_catalogue * least(greatest(b.remise_valeur, 0), 100) / 100
                   else greatest(b.remise_valeur, 0) end), 2)) as tarif_net
    from base b
)
update public.attendance_records a
   set amount_deducted = t.tarif_net
  from tarif t
 where t.student_id = a.student_id
   and t.session_id = a.session_id
   and a.status in ('present', 'late')
   and coalesce(a.amount_deducted, 0) = 0
   and coalesce(a.no_charge, false)   = false
   and coalesce(a.pre_start, false)   = false
   and coalesce(a.waived_amount, 0)   = 0
   and a.free_period_id is null
   and not t.is_free
   and t.student_case not in ('special', 'reduction')
   and t.tarif_net > 0;


-- -----------------------------------------------------------------------------
--  ÉTAPE 3 — LES PRÉSENCES « AVANT INSCRIPTION »   ⚠️ FACULTATIVE
--
--  Ce sont celles du symptôme : l'élève ÉTAIT LÀ, mais la séance était datée
--  avant la date de début de son inscription, donc elle a été offerte.
--
--  N'exécutez cette étape QUE si votre règle est « toute séance suivie se
--  facture » — c'est celle que l'application applique désormais. Si vous vous
--  servez volontairement de séances d'essai gratuites avant inscription,
--  SAUTEZ cette étape (relisez l'étape 1 pour décider).
--
--  Les périodes gratuites (portes ouvertes) ne sont JAMAIS touchées.
-- -----------------------------------------------------------------------------
with base as (
  select s.id as student_id, sub.session_id as session_id,
         coalesce(s.student_case, 'normal') as student_case,
         coalesce(s.is_free, false)         as is_free,
         case
           when s.student_case = 'school_only'
            and (s.school_only_subscription_ids is null
                 or s.school_only_subscription_ids ? sub.id)
            and coalesce(sub.monthly_seances, 0) > 0
           then round(coalesce(sub.school_month_share, sub.monthly_price, 0)::numeric
                      / sub.monthly_seances, 2)
           else round(coalesce(
                  nullif(sub.price_per_session, 0),
                  case when coalesce(sub.monthly_seances, 0) > 0
                       then sub.monthly_price::numeric / sub.monthly_seances end,
                  0)::numeric, 2)
         end as prix_catalogue,
         coalesce(e.discount ->> 'type',
                  s.subscription_discounts -> sub.id ->> 'type') as remise_type,
         coalesce((e.discount ->> 'value')::numeric,
                  (s.subscription_discounts -> sub.id ->> 'value')::numeric, 0) as remise_valeur
    from public.enrollments   e
    join public.students      s   on s.id  = e.student_id
    join public.subscriptions sub on sub.id = e.subscription_id
),
tarif as (
  select b.student_id, b.session_id, b.student_case, b.is_free,
         greatest(0, round(
           b.prix_catalogue
           - (case when b.remise_type = 'percent'
                   then b.prix_catalogue * least(greatest(b.remise_valeur, 0), 100) / 100
                   else greatest(b.remise_valeur, 0) end), 2)) as tarif_net
    from base b
)
update public.attendance_records a
   set amount_deducted = t.tarif_net,
       pre_start       = false,
       waived_amount   = 0
  from tarif t
 where t.student_id = a.student_id
   and t.session_id = a.session_id
   and a.status in ('present', 'late')
   and coalesce(a.amount_deducted, 0) = 0
   and coalesce(a.no_charge, false)   = false
   and a.free_period_id is null
   and (coalesce(a.pre_start, false) = true or coalesce(a.waived_amount, 0) > 0)
   and not t.is_free
   and t.student_case not in ('special', 'reduction')
   and t.tarif_net > 0;


-- -----------------------------------------------------------------------------
--  ÉTAPE 4 — REMETTRE TOUS LES SOLDES D'ACCORD AVEC LE CONSOMMÉ
--
--      solde de l'inscription = tout ce qui a été VERSÉ − tout ce qui a été DÉBITÉ
--
--  Les inscriptions déjà justes ne bougent pas (le `where` les écarte).
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
  select e.id, coalesce(v.total, 0) - coalesce(c.total, 0) as solde_juste
    from public.enrollments e
    left join verse    v on v.student_id = e.student_id and v.subscription_id = e.subscription_id
    left join consomme c on c.student_id = e.student_id and c.subscription_id = e.subscription_id
)
update public.enrollments e
   set balance = cible.solde_juste
  from cible
 where e.id = cible.id
   and e.balance is distinct from cible.solde_juste;


-- -----------------------------------------------------------------------------
--  ÉTAPE 5 — VÉRIFICATION (lecture seule)
--
--  Relancez l'ÉTAPE 0 : la liste doit être VIDE (ou ne garder que des écarts que
--  vous avez volontairement laissés, par exemple des séances d'essai offertes).
--
--  Le compteur ci-dessous doit tomber à 0 pour les présences que rien n'offrait.
-- -----------------------------------------------------------------------------
select count(*) as presences_encore_a_0_da_sans_raison
  from public.attendance_records a
  join public.students s on s.id = a.student_id
 where a.status in ('present', 'late')
   and coalesce(a.amount_deducted, 0) = 0
   and coalesce(a.no_charge, false) = false
   and coalesce(a.pre_start, false) = false
   and coalesce(a.waived_amount, 0) = 0
   and a.free_period_id is null
   and not (coalesce(s.is_free, false) or s.student_case = 'special')
   and coalesce(s.student_case, 'normal') <> 'reduction';
