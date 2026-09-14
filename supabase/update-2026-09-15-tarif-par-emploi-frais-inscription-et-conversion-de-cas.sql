-- =============================================================================
--  MISE À JOUR — LE TARIF D'UN EMPLOI DU TEMPS, LES FRAIS D'INSCRIPTION
--  RÉCLAMÉS APRÈS COUP, ET LA BASCULE DE CAS D'UN ÉLÈVE
--  Projet : https://jehpfbupmhbnbbkzhiwr.supabase.co
--
--  À exécuter dans le SQL Editor de Supabase. Le script est IDEMPOTENT : chaque
--  instruction est un « add column if not exists » ou une réparation qui ne
--  corrige que ce qui est faux. Le relancer ne casse rien et ne double aucun
--  chiffre.
--
--  ---------------------------------------------------------------------------
--  CE QU'IL Y A DEDANS
--  ---------------------------------------------------------------------------
--   1. NOUVELLE COLONNE `students.registration_fee_assessed`.
--      C'est la seule chose du lot qui EXIGE d'être exécutée. Sans elle, un
--      élève créé sans emploi du temps ne se verra JAMAIS réclamer ses frais
--      d'inscription le jour où on lui en coche un.
--
--   2. RÉPARATION DES TARIFS INCOHÉRENTS : les emplois du temps dont le prix
--      d'une séance ne correspond plus au prix de leur mois. C'est ce qui
--      faisait facturer un prix à la feuille de présence pendant que l'écran du
--      mois en affichait un autre.
--
--   3. RÉPARATION DES PARTS ENSEIGNANT qui ne correspondent plus au partage du
--      mois (part enseignant d'une séance = (mois − part école) ÷ séances).
--
--  RIEN D'AUTRE NE DEMANDE DE COLONNE. Le tarif écrit sur UN SEUL emploi du
--  temps depuis la grille, la re-tarification des séances non encore réglées,
--  l'historique des frais supplémentaires sur la situation d'un élève, l'alerte
--  encaissable des frais d'inscription et la bascule de cas avec ses trois
--  réponses (garder / recalculer / effacer) sont entièrement côté application.
-- =============================================================================


-- =============================================================================
--  PARTIE 1 — « LES FRAIS D'INSCRIPTION LUI ONT-ILS DÉJÀ ÉTÉ RÉCLAMÉS ? »
--
--  Un élève se crée très bien SANS emploi du temps : le créneau n'est pas
--  encore ouvert, la famille hésite. Les frais d'inscription ne portent alors
--  sur rien, et l'écran de création ne réclame rien — ce qui est juste.
--
--  Mais le jour où la réception rouvre sa fiche pour lui cocher un emploi du
--  temps, ils deviennent dus. L'écran de modification restait pourtant muet :
--  la dette n'apparaissait nulle part, ni sur sa fiche, ni sur sa carte, et
--  personne ne la réclamait jamais.
--
--  Cette colonne dit si la question a DÉJÀ été posée. Tant qu'elle est fausse
--  et qu'un emploi coché entre dans le périmètre choisi par l'école, la fiche
--  réclame les frais — une fois, et une seule, puisque l'enregistrement la
--  passe à vrai.
-- =============================================================================

alter table public.students
  add column if not exists registration_fee_assessed boolean not null default false;

comment on column public.students.registration_fee_assessed is
  'Les frais d''inscription ont-ils déjà été réclamés à cet élève ? Faux = fiche créée sans emploi du temps : le premier emploi coché les déclenchera.';

-- LES FICHES DÉJÀ EN BASE. Un élève qui suit (ou a suivi) au moins un emploi du
-- temps est passé par l'écran de création AVEC ses emplois : la question lui a
-- donc été posée, et relever le tarif des frais plus tard ne doit pas le
-- rattraper. Idem pour celui qui porte déjà une dette d'inscription.
--
-- Ceux qui restent — créés sans aucun emploi du temps — gardent `false` : ce
-- sont exactement ceux pour qui la correction est faite.
update public.students
   set registration_fee_assessed = true
 where registration_fee_assessed = false
   and (
         jsonb_array_length(coalesce(subscription_ids, '[]'::jsonb)) > 0
      or coalesce(registration_due, 0) > 0
   );


-- =============================================================================
--  PARTIE 2 — LE PRIX D'UNE SÉANCE EST CELUI DU MOIS, DIVISÉ
--
--  Deux colonnes décrivaient le même tarif sans que rien ne les tienne
--  ensemble : `monthly_price` (le prix du mois) et `price_per_session` (le prix
--  d'une séance). Un mois porté de 4 800 à 6 000 DA laissait la seconde sur
--  l'ancien chiffre — la feuille de présence continuait donc de débiter
--  l'ancien prix pendant que l'écran du mois affichait le nouveau, et l'élève
--  finissait le mois en dette sans avoir manqué une seule séance.
--
--  Dès qu'un pack mensuel existe, c'est LUI qui fait foi. L'application écrit
--  désormais les deux ensemble ; cette réparation aligne ce qui est déjà en
--  base.
--
--  Les emplois du temps VENDUS À LA SÉANCE (sans pack mensuel) ne sont pas
--  concernés : leur `price_per_session` est le seul tarif qu'ils aient.
-- =============================================================================

update public.subscriptions
   set price_per_session = round((monthly_price / monthly_seances)::numeric, 2)
 where coalesce(monthly_seances, 0) > 0
   and monthly_price is not null
   and abs(
         coalesce(price_per_session, 0)
         - round((monthly_price / monthly_seances)::numeric, 2)
       ) >= 0.01;


-- =============================================================================
--  PARTIE 3 — LA PART DE L'ENSEIGNANT SUIT LE MÊME PARTAGE
--
--      part enseignant du mois   = prix du mois − part de l'école
--      part enseignant d'UNE séance = part enseignant du mois ÷ séances du mois
--
--  La colonne `teacher_per_seance` est figée à la création du tarif pour que
--  chaque règlement la lise sans rien recalculer. Un tarif corrigé sans elle la
--  laissait sur l'ancien partage : l'enseignant était payé au prix d'avant sur
--  des séances vendues au prix d'aujourd'hui.
--
--  On ne touche qu'aux lignes qui portent un partage explicite : sans
--  `school_month_share`, l'école garde tout le mois et la part enseignant vaut
--  légitimement zéro.
-- =============================================================================

update public.subscriptions
   set teacher_per_seance = round(
         (greatest(monthly_price - school_month_share, 0) / monthly_seances)::numeric, 2
       )
 where coalesce(monthly_seances, 0) > 0
   and monthly_price is not null
   and school_month_share is not null
   and abs(
         coalesce(teacher_per_seance, 0)
         - round(
             (greatest(monthly_price - school_month_share, 0) / monthly_seances)::numeric, 2
           )
       ) >= 0.01;


-- =============================================================================
--  VÉRIFICATION — à lancer après le script, pour lire ce qu'il a fait.
--
--  Les trois requêtes doivent rendre, dans l'ordre :
--   1. le nombre d'élèves à qui les frais d'inscription restent à réclamer
--      (ceux créés sans emploi du temps) ;
--   2. AUCUNE ligne : plus un seul tarif dont la séance contredit son mois ;
--   3. AUCUNE ligne : plus une seule part enseignant qui contredise le partage.
-- =============================================================================

-- 1.
-- select count(*) as eleves_sans_frais_reclames
--   from public.students
--  where registration_fee_assessed = false;

-- 2.
-- select id, session_id, price_per_session, monthly_price, monthly_seances
--   from public.subscriptions
--  where coalesce(monthly_seances, 0) > 0
--    and monthly_price is not null
--    and abs(coalesce(price_per_session, 0)
--            - round((monthly_price / monthly_seances)::numeric, 2)) >= 0.01;

-- 3.
-- select id, session_id, teacher_per_seance, monthly_price, school_month_share, monthly_seances
--   from public.subscriptions
--  where coalesce(monthly_seances, 0) > 0
--    and monthly_price is not null
--    and school_month_share is not null
--    and abs(coalesce(teacher_per_seance, 0)
--            - round((greatest(monthly_price - school_month_share, 0)
--                     / monthly_seances)::numeric, 2)) >= 0.01;
