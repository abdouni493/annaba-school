-- =============================================================================
--  MISE À JOUR — Paie de l'enseignant MOIS PAR MOIS + tableau de bord navigable
--  Projet : https://jehpfbupmhbnbbkzhiwr.supabase.co
--
--  À exécuter TEL QUEL dans le SQL Editor de Supabase, UNE SEULE FOIS.
--  Le script est idempotent : le relancer ne casse rien, et AUCUNE donnée
--  existante n'est modifiée ou supprimée.
--
--  Ce qu'il change
--  ---------------
--   1. `teacher_payments.months` (jsonb) : un règlement d'enseignant note
--      désormais LES MOIS qu'il solde, emploi du temps par emploi du temps
--      (« M2 » = le 2e mois DE CET emploi, ouvert par la première présence et
--      fermé par la séance qui complète le pack — jamais un mois du calendrier).
--      La fiche de paie et le tableau des mois relisent ce bloc figé.
--
--   2. Deux index sur `unpaid_teacher_sessions` : l'écran de paie lit désormais
--      les parts dues présence par présence pour les regrouper par mois, et le
--      règlement ne solde plus « tout le créneau » mais exactement les lignes
--      cochées (deux élèves d'une même séance peuvent être sur deux mois
--      différents).
--
--   3. Un index sur `attendance_records (session_id, occurred_at)` : le mois de
--      chaque présence est recalculé emploi par emploi, et le tableau de bord
--      lit maintenant n'importe quelle journée (hier, demain, une date choisie).
--
--  Rien d'autre n'est requis : le reste de la mise à jour est côté application.
-- =============================================================================


-- -----------------------------------------------------------------------------
--  1. Les mois soldés par un règlement d'enseignant
-- -----------------------------------------------------------------------------
alter table public.teacher_payments
  add column if not exists months jsonb;

comment on column public.teacher_payments.months is
  'Mois d''emploi du temps soldés par ce règlement : [{sessionId,title,groupName,monthCode,seances,presents,students,gross}]';


-- -----------------------------------------------------------------------------
--  2. Les parts dues à l'enseignant, lues par mois et soldées ligne par ligne
-- -----------------------------------------------------------------------------
create index if not exists unpaid_teacher_open
  on public.unpaid_teacher_sessions (teacher_id, paid);

create index if not exists unpaid_teacher_session_day
  on public.unpaid_teacher_sessions (session_id, student_id, date);


-- -----------------------------------------------------------------------------
--  3. Les présences d'un emploi du temps, jour par jour
-- -----------------------------------------------------------------------------
create index if not exists attendance_session_day
  on public.attendance_records (session_id, occurred_at);


-- -----------------------------------------------------------------------------
--  Vérification — à lire dans la sortie du SQL Editor
-- -----------------------------------------------------------------------------
select
  (select count(*) from information_schema.columns
     where table_schema = 'public'
       and table_name = 'teacher_payments'
       and column_name = 'months')                       as colonne_months_ok,
  (select count(*) from pg_indexes
     where schemaname = 'public'
       and indexname in ('unpaid_teacher_open',
                         'unpaid_teacher_session_day',
                         'attendance_session_day'))      as index_crees;
