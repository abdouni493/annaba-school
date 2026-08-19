-- =============================================================================
--  MISE À JOUR — L'élève entre LÀ OÙ EN EST LE GROUPE (mois + séance)
--                + désinscription d'un groupe depuis la feuille de présence
--  Projet : https://jehpfbupmhbnbbkzhiwr.supabase.co
--
--  À exécuter TEL QUEL dans le SQL Editor de Supabase, UNE SEULE FOIS.
--  Le script est idempotent : le relancer ne casse rien, et AUCUNE donnée
--  existante n'est modifiée ou supprimée.
--
--  Ce qu'il change
--  ---------------
--   1. Le bloc `students.subscription_dates` (jsonb, déjà présent) porte
--      désormais DEUX clés de plus par abonnement :
--
--        "sub-1": { "subscribedAt": "2026-08-20",
--                   "startDate":    "2026-08-20",
--                   "joinMonthCode": "M2",     <-- le mois de l'emploi
--                   "joinSlotIndex": 2 }       <-- la séance, 0-based (= la 3e)
--
--      C'est le POINT D'ENTRÉE de l'élève sur cet emploi du temps. Inscrit
--      pendant le 2e mois du groupe, sur sa 3e séance, il est écrit sur
--      M2 · séance 3 : sa première présence y tombe, son solde d'inscription y
--      est versé, les deux séances tenues avant lui restent vides sur sa ligne,
--      et M1 ne le liste pas du tout.
--
--      Aucune colonne à créer : le jsonb accueille les clés telles quelles, et
--      une inscription qui ne les porte pas se lit comme avant — M1 · séance 1.
--
--   2. Rien d'autre. Le mois de chaque élève se recalcule à partir de son point
--      d'entrée et de ses présences — l'index `attendance_day_key`
--      (student_id, session_id, occurred_at) du schéma les sert déjà.
--
--      Et rien à faire non plus pour la désinscription : retirer un élève d'un
--      groupe réécrit simplement `students.subscription_ids` (son inscription,
--      ses présences, ses paiements et son solde sont conservés).
-- =============================================================================


-- -----------------------------------------------------------------------------
--  1. Ce que porte le bloc des dates d'abonnement
-- -----------------------------------------------------------------------------
comment on column public.students.subscription_dates is
  'Par abonnement : {subscribedAt,startDate,expiryDate,plan,joinMonthCode,joinSlotIndex} — joinMonthCode/joinSlotIndex = le mois et la séance où l''élève entre dans le groupe';


-- -----------------------------------------------------------------------------
--  Vérification — à lire dans la sortie du SQL Editor
-- -----------------------------------------------------------------------------
select
  (select count(*) from information_schema.columns
     where table_schema = 'public'
       and table_name = 'students'
       and column_name = 'subscription_dates')              as colonne_dates_ok,
  (select count(*) from pg_indexes
     where schemaname = 'public'
       and indexname = 'attendance_day_key')                as index_presences_ok,
  (select count(*) from public.students
     where subscription_dates::text like '%joinMonthCode%') as eleves_avec_point_entree;
