-- =============================================================================
--  MISE À JOUR / RÉPARATION — 23/09/2026
--  « La séance du jour est à l'élève inscrit ce jour-là », et
--  « Le solde d'un emploi du temps, c'est ce qui y a été versé moins ce que
--    ses séances ont coûté ».
--
--  ------------------------------------------------------------------------
--  CE QUI CHANGE DANS L'APPLICATION (pour mémoire — rien à exécuter pour ça)
--  ------------------------------------------------------------------------
--  1. POINT D'ENTRÉE SUR UN EMPLOI DU TEMPS.
--     Un élève inscrit un mardi sur un emploi du temps du mardi prenait la
--     séance du jour… sauf si la réception avait DÉJÀ pointé le groupe ce
--     matin-là. Le point d'entrée se lisait alors sur « le mois que vit la
--     majorité du groupe » : ce mois venait de basculer avec le pointage, le
--     nouvel élève était poussé au mois suivant, et la séance du jour
--     n'existait plus pour lui.
--     Il se lit désormais sur le CALENDRIER de l'emploi du temps : la séance
--     tenue ce jour-là est la n-ième depuis son ouverture, et c'est celle-là
--     qu'il prend — que le groupe ait été pointé ou non.
--
--  2. DATE ET HEURE D'INSCRIPTION, saisissables et modifiables.
--     La fiche de création propose la date et l'heure du jour (facultatives,
--     déjà remplies), et la fiche de l'élève — « Voir détails » ▸ « Emplois du
--     temps » — permet de les corriger après coup. Reculer la date range
--     l'élève entre les séances déjà tenues : ses présences, ses mois et son
--     solde suivent.
--     L'heure est rangée dans `students.subscription_dates` (JSONB), sous la
--     clé `subscribedTime` — AUCUNE colonne à créer.
--
--  3. SOLDE D'UN EMPLOI DU TEMPS.
--     Il se lit maintenant dans le même grand livre que les mois : les
--     versements de cet emploi, moins ce que ses séances ont coûté. Le
--     compteur `enrollments.balance` reste tenu à jour, mais ne décide plus
--     de l'affichage — une écriture qui l'avait manqué faisait dire à la même
--     ligne « Versé 2 000 DA · consommé 2 000 DA · mois clos ✅ » ET « Solde de
--     l'emploi : 2 000 DA dus ».
--
--  ------------------------------------------------------------------------
--  CE QUE CE SCRIPT FAIT
--  ------------------------------------------------------------------------
--  · ÉTAPE 1 : documente la clé `subscribedTime` (commentaire de colonne).
--  · ÉTAPE 2 : LECTURE SEULE — la liste des inscriptions dont le compteur
--              `enrollments.balance` a dérivé du grand livre, et de combien.
--  · ÉTAPE 3 : remet ce compteur d'accord avec le grand livre.
--  · ÉTAPE 4 : LECTURE SEULE — vérifie qu'il ne reste plus un seul écart.
--
--  Rien n'est effacé : ni présence, ni paiement, ni inscription. Le script est
--  IDEMPOTENT — le relancer ne change plus rien une fois l'étape 3 passée.
--  Exécutez-le dans le SQL Editor de Supabase, étape par étape, en LISANT le
--  résultat de l'étape 2 avant d'écrire.
--
--  ⚠️ L'étape 3 n'est utile QUE si l'étape 2 renvoie des lignes. Une liste
--     vide = tout est déjà d'accord, il n'y a rien à réparer.
-- =============================================================================


-- -----------------------------------------------------------------------------
--  ÉTAPE 1 — DOCUMENTER L'HEURE D'INSCRIPTION
--
--  `subscription_dates` est du JSONB : la nouvelle clé y entre sans migration.
--  On met simplement le commentaire de la colonne à jour, pour que la base
--  dise elle-même ce qu'elle contient.
-- -----------------------------------------------------------------------------
comment on column public.students.subscription_dates is
  'Par abonnement : {subscribedAt,subscribedTime,startDate,expiryDate,plan,joinMonthCode,joinSlotIndex} — subscribedAt/subscribedTime = le JOUR et l''HEURE de l''inscription (le jour décide de la séance rejointe) ; joinMonthCode/joinSlotIndex = le mois et la séance où l''élève entre dans le groupe';


-- -----------------------------------------------------------------------------
--  ÉTAPE 2 — QUELS COMPTEURS ONT DÉRIVÉ ? (lecture seule)
--
--  Pour chaque inscription : ce que le grand livre dit (versé − consommé) et
--  ce que la colonne `balance` porte. Seuls les ÉCARTS sont listés.
--
--  Une séance vaut zéro UNIQUEMENT si quelque chose l'a offerte, et la ligne
--  le dit elle-même (annulée, sans frais, période gratuite, avant inscription,
--  emploi offert). Le « consommé » ci-dessous suit exactement cette règle —
--  la même que celle des écrans.
-- -----------------------------------------------------------------------------
with tarif as (
  select e.id                               as enrollment_id,
         e.student_id,
         e.subscription_id,
         sub.session_id,
         s.registration_number,
         s.first_name || ' ' || s.last_name as eleve,
         ses.title                          as emploi,
         coalesce(s.student_case, 'normal')  as student_case,
         coalesce(s.is_free, false)
           or (s.student_case = 'special'
               and (s.free_subscription_ids is null
                    or s.free_subscription_ids ? sub.id))  as emploi_offert,
         -- le tarif catalogue d'UNE séance pour CET élève, « école seule »
         -- comprise, puis la remise de cette inscription
         greatest(0, round(
           (case
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
            end)
           - (case
                when coalesce(e.discount ->> 'type',
                              s.subscription_discounts -> sub.id ->> 'type') = 'percent'
                then (case
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
                      end)
                     * least(greatest(coalesce((e.discount ->> 'value')::numeric,
                              (s.subscription_discounts -> sub.id ->> 'value')::numeric, 0), 0), 100) / 100
                else greatest(coalesce((e.discount ->> 'value')::numeric,
                              (s.subscription_discounts -> sub.id ->> 'value')::numeric, 0), 0)
              end), 2))                     as tarif_net
    from public.enrollments       e
    join public.students          s   on s.id   = e.student_id
    join public.subscriptions     sub on sub.id = e.subscription_id
    join public.schedule_sessions ses on ses.id = sub.session_id
),
consomme as (
  select t.enrollment_id,
         coalesce(sum(
           case
             -- la séance n'a pas eu lieu, ou elle a été délibérément offerte
             when a.status = 'cancelled'                    then 0
             when coalesce(a.no_charge, false)              then 0
             when coalesce(a.amount_deducted, 0) > 0        then a.amount_deducted
             when a.free_period_id is not null              then 0
             when coalesce(a.pre_start, false)              then 0
             when coalesce(a.waived_amount, 0) > 0          then 0
             when a.status not in ('present', 'late')       then 0
             when t.emploi_offert                           then 0
             -- un « cas réduction » se tarife à deux mains (part école + part
             -- enseignant) : on ne devine jamais son prix, on le laisse à 0
             when t.student_case = 'reduction'              then 0
             -- une présence billable restée à 0 DA vaut le tarif de l'élève
             else t.tarif_net
           end), 0) as consomme
    from tarif t
    left join public.attendance_records a
           on a.student_id = t.student_id
          and a.session_id = t.session_id
   group by t.enrollment_id
),
verse as (
  select t.enrollment_id,
         coalesce(sum(greatest(coalesce(p.amount_paid, 0), 0)), 0) as verse
    from tarif t
    left join public.payments p
           on p.student_id      = t.student_id
          and p.subscription_id = t.subscription_id
   group by t.enrollment_id
)
select t.registration_number          as n_inscription,
       t.eleve,
       t.emploi,
       v.verse                        as verse,
       c.consomme                     as consomme,
       round(v.verse - c.consomme, 2) as solde_grand_livre,
       e.balance                      as compteur_actuel,
       round(e.balance - (v.verse - c.consomme), 2) as ecart
  from tarif t
  join public.enrollments e on e.id = t.enrollment_id
  join consomme c on c.enrollment_id = t.enrollment_id
  join verse    v on v.enrollment_id = t.enrollment_id
 where round(e.balance - (v.verse - c.consomme), 2) <> 0
 order by abs(e.balance - (v.verse - c.consomme)) desc, t.emploi, t.eleve;


-- -----------------------------------------------------------------------------
--  ÉTAPE 3 — REMETTRE LE COMPTEUR D'ACCORD AVEC LE GRAND LIVRE
--
--  Exactement le même calcul qu'à l'étape 2, écrit cette fois dans
--  `enrollments.balance`. Les présences et les paiements ne sont PAS touchés :
--  seul le compteur bouge, et il ne fait que rattraper ce que les écrans
--  affichent déjà.
-- -----------------------------------------------------------------------------
with tarif as (
  select e.id as enrollment_id,
         e.student_id,
         e.subscription_id,
         sub.session_id,
         coalesce(s.student_case, 'normal')  as student_case,
         coalesce(s.is_free, false)
           or (s.student_case = 'special'
               and (s.free_subscription_ids is null
                    or s.free_subscription_ids ? sub.id))  as emploi_offert,
         greatest(0, round(
           (case
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
            end)
           - (case
                when coalesce(e.discount ->> 'type',
                              s.subscription_discounts -> sub.id ->> 'type') = 'percent'
                then (case
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
                      end)
                     * least(greatest(coalesce((e.discount ->> 'value')::numeric,
                              (s.subscription_discounts -> sub.id ->> 'value')::numeric, 0), 0), 100) / 100
                else greatest(coalesce((e.discount ->> 'value')::numeric,
                              (s.subscription_discounts -> sub.id ->> 'value')::numeric, 0), 0)
              end), 2))                     as tarif_net
    from public.enrollments   e
    join public.students      s   on s.id   = e.student_id
    join public.subscriptions sub on sub.id = e.subscription_id
),
consomme as (
  select t.enrollment_id,
         coalesce(sum(
           case
             when a.status = 'cancelled'                    then 0
             when coalesce(a.no_charge, false)              then 0
             when coalesce(a.amount_deducted, 0) > 0        then a.amount_deducted
             when a.free_period_id is not null              then 0
             when coalesce(a.pre_start, false)              then 0
             when coalesce(a.waived_amount, 0) > 0          then 0
             when a.status not in ('present', 'late')       then 0
             when t.emploi_offert                           then 0
             when t.student_case = 'reduction'              then 0
             else t.tarif_net
           end), 0) as consomme
    from tarif t
    left join public.attendance_records a
           on a.student_id = t.student_id
          and a.session_id = t.session_id
   group by t.enrollment_id
),
verse as (
  select t.enrollment_id,
         coalesce(sum(greatest(coalesce(p.amount_paid, 0), 0)), 0) as verse
    from tarif t
    left join public.payments p
           on p.student_id      = t.student_id
          and p.subscription_id = t.subscription_id
   group by t.enrollment_id
),
cible as (
  select c.enrollment_id, round(v.verse - c.consomme, 2) as solde
    from consomme c
    join verse v on v.enrollment_id = c.enrollment_id
)
update public.enrollments e
   set balance = cible.solde
  from cible
 where cible.enrollment_id = e.id
   and round(e.balance - cible.solde, 2) <> 0;


-- -----------------------------------------------------------------------------
--  ÉTAPE 4 — VÉRIFICATION (lecture seule)
--
--  Relancez l'ÉTAPE 2 : elle doit désormais ne renvoyer AUCUNE ligne.
--  Le compte rapide ci-dessous dit la même chose en un chiffre.
-- -----------------------------------------------------------------------------
select count(*) as inscriptions,
       count(*) filter (where e.balance < 0) as en_dette,
       round(coalesce(sum(greatest(-e.balance, 0)), 0), 2) as total_du
  from public.enrollments e;
