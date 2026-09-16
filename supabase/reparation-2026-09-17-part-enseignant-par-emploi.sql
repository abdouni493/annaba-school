-- =============================================================================
--  RÉPARATION / VÉRIFICATION — 17/09/2026
--  Projet : https://jehpfbupmhbnbbkzhiwr.supabase.co
--
--  LE SYMPTÔME
--  -----------
--  L'emploi du temps « فرنسية · Secondaire (Lycée) - 3AS » affiche :
--
--      PRIX DU MOIS   2 000 DA
--      PART ÉCOLE       600 DA
--      PART ENSEIGNANT 1 400 DA        →  350 DA la séance (4 séances)
--
--  Sur l'écran de paie de l'enseignant, le MÊME mois, pour un élève présent aux
--  QUATRE séances et à jour de ses 2 000 DA :
--
--      SÉANCES  3  (4/4)   ·   PART / SÉANCE  350 DA   ·   PART ENSEIGNANT  1 050 DA
--
--  Trois séances payées sur quatre tenues : 350 DA de perdus par élève et par
--  mois, sur tous les emplois du temps concernés.
--
--  D'OÙ ÇA VIENT
--  -------------
--  La part d'une séance n'existait que si le POINTAGE l'avait écrite dans
--  `unpaid_teacher_sessions`, et le pointage ne lisait qu'UNE des deux façons
--  dont le partage s'écrit : la colonne `subscriptions.teacher_per_seance`.
--
--  Or un emploi du temps dont la PART ÉCOLE est saisie APRÈS coup ne portait
--  pas cette colonne le jour où ses premières séances ont été pointées : elles
--  n'ont donc laissé AUCUNE ligne. Et rien n'en créait jamais — re-tarifer ne
--  faisait que relire les lignes existantes. L'enseignant perdait ces
--  séances-là pour de bon, alors que l'écran du tarif, lui, affichait bien
--  350 DA la séance (2 000 − 600, divisé par 4).
--
--  CÔTÉ APPLICATION, C'EST CORRIGÉ :
--    · un seul calcul (`teacherSeanceRate`) répond partout — le tarif de
--      l'emploi du temps d'abord, le contrat au pourcentage à défaut, et le cas
--      de l'élève a le dernier mot ;
--    · les écrans de paie lisent les PRÉSENCES et reconstituent à ce tarif la
--      part des séances qu'aucune ligne ne porte ; le règlement les écrit alors
--      pour de bon, sous un identifiant déterministe qui interdit le doublon ;
--    · re-tarifer un emploi du temps crée les lignes manquantes.
--
--  CE SCRIPT ne fait que rattraper ce qui est DÉJÀ en base, pour que les
--  rapports et les exports lisent la même chose que les écrans de paie.
--
--  ⚠️ IL NE COUVRE QUE LES ENSEIGNANTS PAYÉS PAR L'EMPLOI DU TEMPS (un mois
--     avec une part école saisie). Les contrats AU POURCENTAGE ne sont pas
--     touchés : leur part se calcule sur ce que l'élève a payé ce jour-là, et
--     elle n'a jamais manqué.
--
--  Les identifiants créés ont la forme  utpv|<session_id>|<student_id>|<jour> —
--  exactement ceux que l'application donne à ces parts-là. Le script est donc
--  IDEMPOTENT : le relancer ne crée jamais de doublon, et l'application ne
--  reconstituera plus une part que ce script a écrite.
--
--  ⚠️ IL N'ÉCRIT RIEN POUR UN ENSEIGNANT SUPPRIMÉ. `schedule_sessions.teacher_id`
--     n'est qu'un texte : un emploi du temps peut désigner une fiche effacée
--     depuis, et la table des parts a, elle, une vraie clé étrangère. L'ÉTAPE 0
--     BIS liste ces emplois du temps — rendez-leur un enseignant, puis relancez
--     le script, et leurs séances rentreront dans le rattrapage.
--
--  Exécutez-le dans le SQL Editor de Supabase, ÉTAPE PAR ÉTAPE, en LISANT le
--  résultat des étapes 0, 0 bis et 1 avant d'écrire quoi que ce soit.
--
--  NOTE SUR LES DATES : un jour d'école est un jour d'Algérie (UTC+1). Toutes
--  les comparaisons de date passent donc par `at time zone 'Africa/Algiers'`,
--  exactement comme l'application le fait dans le navigateur.
-- =============================================================================


-- -----------------------------------------------------------------------------
--  ÉTAPE 0 — COMBIEN ÇA REPRÉSENTE ? (lecture seule)
--
--  Par emploi du temps : les séances tenues qui doivent quelque chose à
--  l'enseignant et qu'AUCUNE ligne ne porte, et ce qu'elles valent.
--  Une liste vide = rien à réparer, nulle part.
-- -----------------------------------------------------------------------------
with seance as (
  select a.id                                                  as record_id,
         a.student_id,
         a.session_id,
         a.occurred_at,
         to_char(a.occurred_at::timestamptz at time zone 'Africa/Algiers',
                 'YYYY-MM-DD')                                 as jour,
         ses.teacher_id,
         ses.title                                             as emploi,
         sub.id                                                as subscription_id,
         s.registration_number,
         s.first_name || ' ' || s.last_name                    as eleve,
         -- LA PART D'UNE SÉANCE, telle que l'écran du tarif l'affiche :
         -- la colonne si elle existe, sinon (prix du mois − part école) ÷ séances.
         round(
           case when coalesce(sub.monthly_seances, 0) > 0 then
             case when sub.teacher_per_seance is not null
                  then greatest(sub.teacher_per_seance, 0)
                  else greatest(0, coalesce(sub.monthly_price, 0)
                                 - least(coalesce(sub.school_month_share, sub.monthly_price, 0),
                                         coalesce(sub.monthly_price, 0)))::numeric
                       / sub.monthly_seances
             end
           else 0 end::numeric, 2)                             as part_emploi,
         s.is_free, s.student_case, s.free_subscription_ids,
         s.school_only_subscription_ids, s.unpaid_teacher_ids, s.case_reduction
    from public.attendance_records a
    join public.schedule_sessions  ses on ses.id = a.session_id
    join public.students           s   on s.id   = a.student_id
    join public.subscriptions      sub on sub.session_id = a.session_id
    -- L'ENSEIGNANT DOIT EXISTER ENCORE. `schedule_sessions.teacher_id` est un
    -- simple texte : un emploi du temps peut donc pointer vers une fiche
    -- SUPPRIMÉE depuis. `unpaid_teacher_sessions.teacher_id`, lui, a une vraie
    -- clé étrangère — écrire une part pour un enseignant qui n'existe plus
    -- échouerait sur toute la transaction. Ces emplois-là sont listés par
    -- l'étape 0 bis : rendez-leur un enseignant, puis relancez le script.
    join public.teachers           tea on tea.id = ses.teacher_id
   where a.status <> 'cancelled'
     and coalesce(a.no_charge, false) = false
     and a.occurred_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
     and coalesce(ses.teacher_id, '') <> ''
     -- Une période portes ouvertes a pu être réglée sur « enseignants NON payés ».
     and not exists (select 1 from public.free_periods fp
                      where fp.id = a.free_period_id and fp.pay_teachers = false)
),
part as (
  -- LE CAS DE L'ÉLÈVE A LE DERNIER MOT : offert et « école seule » ne
  -- rapportent rien, une « réduction » retire au professeur SA moitié à lui.
  select v.*,
         round(case
           when (coalesce(v.is_free, false) or v.student_case = 'special')
                and (v.free_subscription_ids is null
                     or v.free_subscription_ids ? v.subscription_id) then 0
           when v.student_case = 'school_only'
                and (case when v.school_only_subscription_ids is not null
                          then v.school_only_subscription_ids ? v.subscription_id
                          else coalesce(v.unpaid_teacher_ids ? v.teacher_id, false) end) then 0
           when v.student_case = 'reduction' then
             greatest(0, v.part_emploi - least(v.part_emploi, case
               when v.case_reduction is null then 0
               when v.case_reduction ->> 'type' = 'percent'
                 then v.part_emploi
                      * least(greatest(coalesce((v.case_reduction ->> 'teacherValue')::numeric, 0), 0), 100)
                      / 100
               else greatest(coalesce((v.case_reduction ->> 'teacherValue')::numeric, 0), 0)
             end))
           else v.part_emploi
         end::numeric, 2) as part_due
    from seance v
),
manquantes as (
  select p.*
    from part p
   where p.part_due > 0
     and not exists (
           select 1
             from public.unpaid_teacher_sessions u
            where u.session_id = p.session_id
              and u.student_id = p.student_id
              and (case when u.date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
                        then to_char(u.date::timestamptz at time zone 'Africa/Algiers', 'YYYY-MM-DD')
                        else substring(u.date, 1, 10) end) = p.jour)
)
select m.emploi,
       t.first_name || ' ' || t.last_name as enseignant,
       count(*)                           as seances_sans_part,
       count(distinct m.student_id)       as eleves_concernes,
       min(m.jour)                        as premiere,
       max(m.jour)                        as derniere,
       round(sum(m.part_due), 2)          as a_rattraper
  from manquantes m
  join public.teachers t on t.id = m.teacher_id
 group by m.emploi, enseignant
 order by a_rattraper desc;


-- -----------------------------------------------------------------------------
--  ÉTAPE 0 BIS — LES EMPLOIS DU TEMPS SANS ENSEIGNANT VALIDE (lecture seule)
--
--  `schedule_sessions.teacher_id` n'est qu'un texte : rien n'empêche un emploi
--  du temps de désigner une fiche d'enseignant SUPPRIMÉE depuis. La table des
--  parts, elle, a une vraie clé étrangère — une part ne peut donc pas exister
--  pour un enseignant qui n'existe plus.
--
--  Le script ÉCARTE ces emplois du temps (il ne peut rien y écrire), et
--  l'application fait déjà pareil : leurs séances n'apparaissent sur l'écran de
--  paie de personne, puisqu'il n'y a personne à payer.
--
--  Une liste vide = rien à faire. Sinon : ouvrez chacun de ces emplois du temps
--  dans « Emploi du temps », rendez-lui son enseignant, puis RELANCEZ le script
--  depuis l'étape 0 — ses séances rentreront alors dans le rattrapage.
-- -----------------------------------------------------------------------------
select ses.id                                as emploi_id,
       ses.title                             as emploi,
       ses.teacher_id                        as enseignant_introuvable,
       ses.archived_at is not null           as emploi_archive,
       (select count(*) from public.attendance_records a
         where a.session_id = ses.id
           and a.status <> 'cancelled'
           and coalesce(a.no_charge, false) = false) as seances_tenues
  from public.schedule_sessions ses
 where coalesce(ses.teacher_id, '') <> ''
   and not exists (select 1 from public.teachers t where t.id = ses.teacher_id)
 order by seances_tenues desc;


-- -----------------------------------------------------------------------------
--  ÉTAPE 1 — LE DÉTAIL, SÉANCE PAR SÉANCE (lecture seule)
--
--  Exactement les mêmes lignes que l'étape 0, une par séance : c'est ce que
--  l'étape 2 va écrire, ni plus ni moins. Relisez-la avant d'écrire.
-- -----------------------------------------------------------------------------
with seance as (
  select a.id                                                  as record_id,
         a.student_id,
         a.session_id,
         a.occurred_at,
         to_char(a.occurred_at::timestamptz at time zone 'Africa/Algiers',
                 'YYYY-MM-DD')                                 as jour,
         ses.teacher_id,
         ses.title                                             as emploi,
         sub.id                                                as subscription_id,
         s.registration_number,
         s.first_name || ' ' || s.last_name                    as eleve,
         round(
           case when coalesce(sub.monthly_seances, 0) > 0 then
             case when sub.teacher_per_seance is not null
                  then greatest(sub.teacher_per_seance, 0)
                  else greatest(0, coalesce(sub.monthly_price, 0)
                                 - least(coalesce(sub.school_month_share, sub.monthly_price, 0),
                                         coalesce(sub.monthly_price, 0)))::numeric
                       / sub.monthly_seances
             end
           else 0 end::numeric, 2)                             as part_emploi,
         s.is_free, s.student_case, s.free_subscription_ids,
         s.school_only_subscription_ids, s.unpaid_teacher_ids, s.case_reduction
    from public.attendance_records a
    join public.schedule_sessions  ses on ses.id = a.session_id
    join public.students           s   on s.id   = a.student_id
    join public.subscriptions      sub on sub.session_id = a.session_id
    -- L'ENSEIGNANT DOIT EXISTER ENCORE. `schedule_sessions.teacher_id` est un
    -- simple texte : un emploi du temps peut donc pointer vers une fiche
    -- SUPPRIMÉE depuis. `unpaid_teacher_sessions.teacher_id`, lui, a une vraie
    -- clé étrangère — écrire une part pour un enseignant qui n'existe plus
    -- échouerait sur toute la transaction. Ces emplois-là sont listés par
    -- l'étape 0 bis : rendez-leur un enseignant, puis relancez le script.
    join public.teachers           tea on tea.id = ses.teacher_id
   where a.status <> 'cancelled'
     and coalesce(a.no_charge, false) = false
     and a.occurred_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
     and coalesce(ses.teacher_id, '') <> ''
     and not exists (select 1 from public.free_periods fp
                      where fp.id = a.free_period_id and fp.pay_teachers = false)
),
part as (
  select v.*,
         round(case
           when (coalesce(v.is_free, false) or v.student_case = 'special')
                and (v.free_subscription_ids is null
                     or v.free_subscription_ids ? v.subscription_id) then 0
           when v.student_case = 'school_only'
                and (case when v.school_only_subscription_ids is not null
                          then v.school_only_subscription_ids ? v.subscription_id
                          else coalesce(v.unpaid_teacher_ids ? v.teacher_id, false) end) then 0
           when v.student_case = 'reduction' then
             greatest(0, v.part_emploi - least(v.part_emploi, case
               when v.case_reduction is null then 0
               when v.case_reduction ->> 'type' = 'percent'
                 then v.part_emploi
                      * least(greatest(coalesce((v.case_reduction ->> 'teacherValue')::numeric, 0), 0), 100)
                      / 100
               else greatest(coalesce((v.case_reduction ->> 'teacherValue')::numeric, 0), 0)
             end))
           else v.part_emploi
         end::numeric, 2) as part_due
    from seance v
)
select p.emploi,
       p.registration_number as n_inscription,
       p.eleve,
       p.jour,
       p.part_emploi         as tarif_emploi,
       p.part_due            as part_a_ecrire,
       'utpv|' || p.session_id || '|' || p.student_id || '|' || p.jour as identifiant
  from part p
 where p.part_due > 0
   and not exists (
         select 1
           from public.unpaid_teacher_sessions u
          where u.session_id = p.session_id
            and u.student_id = p.student_id
            and (case when u.date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
                      then to_char(u.date::timestamptz at time zone 'Africa/Algiers', 'YYYY-MM-DD')
                      else substring(u.date, 1, 10) end) = p.jour)
 order by p.emploi, p.eleve, p.jour;


-- -----------------------------------------------------------------------------
--  ÉTAPE 2 — ÉCRIRE LES PARTS MANQUANTES     ⚠️ ÉCRITURE
--
--  Les séances de l'étape 1, et elles seules. Elles naissent NON PAYÉES : elles
--  se règleront au prochain règlement de l'enseignant, comme les autres.
-- -----------------------------------------------------------------------------
with seance as (
  select a.id                                                  as record_id,
         a.student_id,
         a.session_id,
         a.occurred_at,
         to_char(a.occurred_at::timestamptz at time zone 'Africa/Algiers',
                 'YYYY-MM-DD')                                 as jour,
         ses.teacher_id,
         sub.id                                                as subscription_id,
         round(
           case when coalesce(sub.monthly_seances, 0) > 0 then
             case when sub.teacher_per_seance is not null
                  then greatest(sub.teacher_per_seance, 0)
                  else greatest(0, coalesce(sub.monthly_price, 0)
                                 - least(coalesce(sub.school_month_share, sub.monthly_price, 0),
                                         coalesce(sub.monthly_price, 0)))::numeric
                       / sub.monthly_seances
             end
           else 0 end::numeric, 2)                             as part_emploi,
         s.is_free, s.student_case, s.free_subscription_ids,
         s.school_only_subscription_ids, s.unpaid_teacher_ids, s.case_reduction
    from public.attendance_records a
    join public.schedule_sessions  ses on ses.id = a.session_id
    join public.students           s   on s.id   = a.student_id
    join public.subscriptions      sub on sub.session_id = a.session_id
    -- L'ENSEIGNANT DOIT EXISTER ENCORE. `schedule_sessions.teacher_id` est un
    -- simple texte : un emploi du temps peut donc pointer vers une fiche
    -- SUPPRIMÉE depuis. `unpaid_teacher_sessions.teacher_id`, lui, a une vraie
    -- clé étrangère — écrire une part pour un enseignant qui n'existe plus
    -- échouerait sur toute la transaction. Ces emplois-là sont listés par
    -- l'étape 0 bis : rendez-leur un enseignant, puis relancez le script.
    join public.teachers           tea on tea.id = ses.teacher_id
   where a.status <> 'cancelled'
     and coalesce(a.no_charge, false) = false
     and a.occurred_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
     and coalesce(ses.teacher_id, '') <> ''
     and not exists (select 1 from public.free_periods fp
                      where fp.id = a.free_period_id and fp.pay_teachers = false)
),
part as (
  select v.*,
         round(case
           when (coalesce(v.is_free, false) or v.student_case = 'special')
                and (v.free_subscription_ids is null
                     or v.free_subscription_ids ? v.subscription_id) then 0
           when v.student_case = 'school_only'
                and (case when v.school_only_subscription_ids is not null
                          then v.school_only_subscription_ids ? v.subscription_id
                          else coalesce(v.unpaid_teacher_ids ? v.teacher_id, false) end) then 0
           when v.student_case = 'reduction' then
             greatest(0, v.part_emploi - least(v.part_emploi, case
               when v.case_reduction is null then 0
               when v.case_reduction ->> 'type' = 'percent'
                 then v.part_emploi
                      * least(greatest(coalesce((v.case_reduction ->> 'teacherValue')::numeric, 0), 0), 100)
                      / 100
               else greatest(coalesce((v.case_reduction ->> 'teacherValue')::numeric, 0), 0)
             end))
           else v.part_emploi
         end::numeric, 2) as part_due
    from seance v
),
a_ecrire as (
  select distinct on (p.session_id, p.student_id, p.jour)
         'utpv|' || p.session_id || '|' || p.student_id || '|' || p.jour as id,
         p.teacher_id, p.session_id, p.student_id, p.part_due, p.occurred_at
    from part p
   where p.part_due > 0
     and not exists (
           select 1
             from public.unpaid_teacher_sessions u
            where u.session_id = p.session_id
              and u.student_id = p.student_id
              and (case when u.date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
                        then to_char(u.date::timestamptz at time zone 'Africa/Algiers', 'YYYY-MM-DD')
                        else substring(u.date, 1, 10) end) = p.jour)
   order by p.session_id, p.student_id, p.jour, p.occurred_at
)
insert into public.unpaid_teacher_sessions
       (id, teacher_id, session_id, student_id, amount, date, paid,
        created_by_name, created_by_role)
select id, teacher_id, session_id, student_id, part_due, occurred_at, false,
       'Réparation 17/09/2026', 'system'
  from a_ecrire
on conflict (id) do nothing;


-- -----------------------------------------------------------------------------
--  ÉTAPE 3 — LES PARTS DÉJÀ ÉCRITES MAIS AU MAUVAIS TARIF   ⚠️ FACULTATIVE
--
--  3a est en LECTURE SEULE : elle liste les parts ENCORE DUES dont le montant
--  ne correspond plus au tarif de l'emploi du temps (un tarif corrigé depuis,
--  sans re-tarifer le mois en cours).
--
--  N'exécutez 3b QUE si votre règle est « toute séance non réglée suit le tarif
--  d'aujourd'hui ». Si vous avez délibérément répondu « Annuler » à la question
--  « appliquer le nouveau tarif aux séances déjà pointées ? », SAUTEZ 3b : ces
--  montants-là sont ceux que vous avez voulus.
--
--  Les parts DÉJÀ PAYÉES ne sont jamais touchées, par aucune des deux.
-- -----------------------------------------------------------------------------

-- 3a — lecture seule
select ses.title                       as emploi,
       s.registration_number           as n_inscription,
       s.first_name || ' ' || s.last_name as eleve,
       substring(u.date, 1, 10)        as jour,
       u.amount                        as part_actuelle,
       round(
         case when coalesce(sub.monthly_seances, 0) > 0 then
           case when sub.teacher_per_seance is not null
                then greatest(sub.teacher_per_seance, 0)
                else greatest(0, coalesce(sub.monthly_price, 0)
                               - least(coalesce(sub.school_month_share, sub.monthly_price, 0),
                                       coalesce(sub.monthly_price, 0)))::numeric
                     / sub.monthly_seances
           end
         else 0 end::numeric, 2)       as tarif_emploi
  from public.unpaid_teacher_sessions u
  join public.schedule_sessions ses on ses.id = u.session_id
  join public.subscriptions     sub on sub.session_id = u.session_id
  join public.students          s   on s.id = u.student_id
 where u.paid = false
   and coalesce(sub.monthly_seances, 0) > 0
   and coalesce(s.student_case, 'normal') not in ('special', 'reduction', 'school_only')
   and not coalesce(s.is_free, false)
   and round(u.amount::numeric, 2) <> round(
         case when sub.teacher_per_seance is not null
              then greatest(sub.teacher_per_seance, 0)
              else greatest(0, coalesce(sub.monthly_price, 0)
                             - least(coalesce(sub.school_month_share, sub.monthly_price, 0),
                                     coalesce(sub.monthly_price, 0)))::numeric
                   / sub.monthly_seances
         end::numeric, 2)
 order by emploi, eleve, jour;

-- 3b — écriture, FACULTATIVE (voir l'avertissement ci-dessus)
-- update public.unpaid_teacher_sessions u
--    set amount = round(
--          case when sub.teacher_per_seance is not null
--               then greatest(sub.teacher_per_seance, 0)
--               else greatest(0, coalesce(sub.monthly_price, 0)
--                              - least(coalesce(sub.school_month_share, sub.monthly_price, 0),
--                                      coalesce(sub.monthly_price, 0)))::numeric
--                    / sub.monthly_seances
--          end::numeric, 2)
--   from public.subscriptions sub, public.students s
--  where sub.session_id = u.session_id
--    and s.id = u.student_id
--    and u.paid = false
--    and coalesce(sub.monthly_seances, 0) > 0
--    and coalesce(s.student_case, 'normal') not in ('special', 'reduction', 'school_only')
--    and not coalesce(s.is_free, false);


-- -----------------------------------------------------------------------------
--  ÉTAPE 4 — VÉRIFICATION (lecture seule)
--
--  Relancez l'ÉTAPE 0 : la liste doit être VIDE — sauf, éventuellement, les
--  emplois du temps de l'ÉTAPE 0 BIS, qui attendent encore un enseignant.
--
--  Et le tableau ci-dessous, emploi du temps par emploi du temps, doit se lire
--  comme l'écran du tarif : part enseignant du mois = tarif × séances du mois.
-- -----------------------------------------------------------------------------
select ses.title                              as emploi,
       t.first_name || ' ' || t.last_name     as enseignant,
       sub.monthly_seances                    as seances_du_mois,
       sub.monthly_price                      as prix_du_mois,
       coalesce(sub.school_month_share, sub.monthly_price) as part_ecole,
       greatest(0, coalesce(sub.monthly_price, 0)
                 - least(coalesce(sub.school_month_share, sub.monthly_price, 0),
                         coalesce(sub.monthly_price, 0)))   as part_enseignant,
       round(
         case when coalesce(sub.monthly_seances, 0) > 0
              then case when sub.teacher_per_seance is not null
                        then greatest(sub.teacher_per_seance, 0)
                        else greatest(0, coalesce(sub.monthly_price, 0)
                                       - least(coalesce(sub.school_month_share, sub.monthly_price, 0),
                                               coalesce(sub.monthly_price, 0)))::numeric
                             / sub.monthly_seances end
              else 0 end::numeric, 2)         as par_seance,
       (select count(*) from public.unpaid_teacher_sessions u
         where u.session_id = sub.session_id and u.paid = false) as parts_encore_dues,
       (select round(coalesce(sum(u.amount), 0), 2) from public.unpaid_teacher_sessions u
         where u.session_id = sub.session_id and u.paid = false) as montant_encore_du
  from public.subscriptions      sub
  join public.schedule_sessions  ses on ses.id = sub.session_id
  left join public.teachers      t   on t.id = ses.teacher_id
 where coalesce(sub.monthly_seances, 0) > 0
   and coalesce(ses.teacher_id, '') <> ''
 order by emploi;
