-- =============================================================================
--  RÉPARATION — UN SOLDE D'EMPLOI DU TEMPS QUE PLUS AUCUN VERSEMENT NE JUSTIFIE
--  Projet : https://jehpfbupmhbnbbkzhiwr.supabase.co
--
--  CE N'EST PAS UNE MISE À JOUR DE SCHÉMA : aucune colonne n'est ajoutée, aucune
--  table n'est touchée dans sa forme. Ce script CORRIGE DES CHIFFRES sur des
--  lignes existantes, et il est écrit pour être lancé morceau par morceau.
--
--  ---------------------------------------------------------------------------
--  LE SYMPTÔME
--  ---------------------------------------------------------------------------
--  Sur l'emploi du temps « حيدري باك » (وليد حيدري · salle 5 · 08:00–10:00 ·
--  500 DA la séance), deux élèves affichent :
--
--      M1 : 0 DA encaissé, reste 500 DA, 1/4 séance(s), consommé 500 DA
--      Solde de l'emploi : 1 500 DA d'avance          <-- CELUI-LÀ
--
--  Les deux lignes se contredisent. Le mois dit « il n'a rien versé et doit
--  500 DA » ; le solde dit « il a 1 500 DA d'avance ». Et l'historique des
--  paiements de l'élève est VIDE sur cet emploi : il n'y a donc rien à
--  supprimer depuis l'écran — c'est pour ça que le solde ne partait pas.
--
--  ---------------------------------------------------------------------------
--  D'OÙ ÇA VIENT
--  ---------------------------------------------------------------------------
--  Deux compteurs racontent la même histoire dans deux tables :
--
--    · `payments`             — CE QUI A ÉTÉ VERSÉ, ligne par ligne. C'est lui
--                               que lisent le mois M1 et l'historique.
--    · `enrollments.balance`  — LA CAGNOTTE, un simple nombre, que chaque
--                               versement crédite et chaque présence débite.
--                               C'est lui qu'affiche « Solde de l'emploi ».
--
--  Un versement saisi le 27/08 au matin a crédité la cagnotte À L'ÉCRAN, puis
--  sa ligne `payments` a été refusée par la base (la colonne `alert_read` était
--  `not null` et n'était pas renseignée — c'est corrigé dans l'application
--  depuis). La cagnotte, elle, était déjà partie et n'a jamais été reprise.
--
--  Résultat : une avance qui ne repose sur aucun versement, et qu'aucun bouton
--  ne sait défaire puisqu'il n'y a aucun versement à effacer.
--
--  ---------------------------------------------------------------------------
--  CE QUE LA RÉPARATION FAIT
--  ---------------------------------------------------------------------------
--  Elle ne « met pas le solde à zéro » : elle le RECALCULE à partir de ce qui
--  est réellement écrit dans la base, et rien d'autre —
--
--      solde = (tout ce qui a été versé sur cet emploi)
--            − (tout ce que les présences ont débité sur cet emploi)
--
--  Pour ces deux élèves : 0 versé − 500 débité par la séance qu'ils ont suivie
--  = **−500 DA**. L'écran dira donc « en dette de 500 DA », exactement ce que
--  la ligne du mois M1 annonce déjà (« reste 500 DA »). Les deux compteurs
--  diront enfin la même chose.
--
--  `paid_seances` retombe sur `consumed_seances` : plus rien n'est réglé
--  d'avance, mais la séance suivie reste comptée comme suivie.
--
--  LES PRÉSENCES NE SONT PAS TOUCHÉES. L'élève est bien venu au cours, et son
--  pointage paie l'enseignant.
-- =============================================================================


-- =============================================================================
--  PARTIE A — VÉRIFIER LE DIAGNOSTIC (lecture seule, rien n'est modifié)
--
--  Lancez cette partie SEULE d'abord. Elle montre, pour les deux élèves, ce que
--  chaque table raconte : ce qui est versé, ce que les présences ont débité, le
--  solde actuel, et le solde que la réparation posera.
-- =============================================================================

with cible as (
  select e.id                as enrollment_id,
         e.student_id,
         e.subscription_id,
         e.balance           as solde_actuel,
         e.paid_seances,
         e.consumed_seances,
         sub.session_id,
         s.registration_number,
         trim(coalesce(s.first_name, '') || ' ' || coalesce(s.last_name, '')) as eleve
    from public.enrollments e
    join public.students s        on s.id   = e.student_id
    join public.subscriptions sub on sub.id = e.subscription_id
   where e.subscription_id = 'sub-mtaufrrq-a080cac2'          -- « حيدري باك »
     and e.student_id in (
       '67276b8b-6fd1-4ac5-a6ea-51132baf290a',                -- 00072 تسنيم نواري
       '02927470-747f-4cb0-ba8e-dcedd55aaa68'                 -- 00045 بوبهزيز مصطفى
     )
)
select c.registration_number as n_inscription,
       c.eleve,
       c.solde_actuel,
       c.verse              as total_verse,
       c.debite             as debite_par_les_presences,
       c.verse - c.debite   as solde_apres_reparation,
       c.paid_seances,
       c.consumed_seances
  from (
    select c.*,
           coalesce((select sum(amount_paid)
                       from public.payments
                      where subscription_id = c.subscription_id
                        and student_id      = c.student_id), 0) as verse,
           coalesce((select sum(amount_deducted)
                       from public.attendance_records
                      where student_id = c.student_id
                        and session_id = c.session_id), 0)      as debite
      from cible c
  ) c;


-- =============================================================================
--  PARTIE B — LA RÉPARATION, POUR CES DEUX ÉLÈVES ET CET EMPLOI DU TEMPS SEULS
--
--  Tout se joue dans UNE transaction : si une étape échoue, aucune ne
--  s'applique. Rien n'est modifié tant que le `commit` n'est pas passé.
-- =============================================================================

begin;

with cible as (
  select e.id               as enrollment_id,
         e.student_id,
         e.subscription_id,
         e.consumed_seances,
         sub.session_id
    from public.enrollments e
    join public.subscriptions sub on sub.id = e.subscription_id
   where e.subscription_id = 'sub-mtaufrrq-a080cac2'
     and e.student_id in (
       '67276b8b-6fd1-4ac5-a6ea-51132baf290a',
       '02927470-747f-4cb0-ba8e-dcedd55aaa68'
     )
),
recalcul as (
  select c.enrollment_id,
         c.consumed_seances,
         coalesce((select sum(amount_paid)
                     from public.payments
                    where subscription_id = c.subscription_id
                      and student_id      = c.student_id), 0)
       - coalesce((select sum(amount_deducted)
                     from public.attendance_records
                    where student_id = c.student_id
                      and session_id = c.session_id), 0) as solde
    from cible c
)
update public.enrollments e
   set balance      = r.solde,
       -- Plus rien n'est réglé d'avance : « payées » retombe sur « suivies ».
       paid_seances = r.consumed_seances
  from recalcul r
 where e.id = r.enrollment_id;

commit;


-- =============================================================================
--  PARTIE C — VÉRIFICATION (lecture seule, après la PARTIE B)
--  Relancez simplement la PARTIE A : `solde_actuel` doit désormais être égal à
--  `solde_apres_reparation`, et `paid_seances` à `consumed_seances`.
-- =============================================================================


-- =============================================================================
--  PARTIE D — FACULTATIF : Y EN A-T-IL D'AUTRES ?
--
--  La même panne a pu frapper d'autres élèves le même jour. Cette requête est
--  en LECTURE SEULE : elle liste TOUTES les inscriptions dont la cagnotte ne
--  correspond pas à ce qui est écrit dans `payments` et `attendance_records`,
--  du plus gros écart au plus petit. Un écart de quelques dinars sur un tarif
--  à décimales est normal ; un écart de plusieurs centaines ne l'est pas.
--
--  Décommentez pour l'exécuter.
-- =============================================================================

-- select s.registration_number                                as n_inscription,
--        trim(coalesce(s.first_name,'') || ' ' || coalesce(s.last_name,'')) as eleve,
--        coalesce(ses.title, '')                              as emploi_du_temps,
--        e.balance                                            as solde_actuel,
--        coalesce(v.verse, 0) - coalesce(p.debite, 0)         as solde_recalcule,
--        e.balance - (coalesce(v.verse, 0) - coalesce(p.debite, 0)) as ecart
--   from public.enrollments e
--   join public.students s        on s.id  = e.student_id
--   join public.subscriptions sub on sub.id = e.subscription_id
--   left join public.sessions ses on ses.id = sub.session_id
--   left join lateral (
--     select sum(amount_paid) as verse
--       from public.payments
--      where subscription_id = e.subscription_id
--        and student_id      = e.student_id
--   ) v on true
--   left join lateral (
--     select sum(amount_deducted) as debite
--       from public.attendance_records
--      where student_id = e.student_id
--        and session_id = sub.session_id
--   ) p on true
--  where abs(e.balance - (coalesce(v.verse, 0) - coalesce(p.debite, 0))) > 1
--  order by abs(e.balance - (coalesce(v.verse, 0) - coalesce(p.debite, 0))) desc;
