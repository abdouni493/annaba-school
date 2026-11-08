-- =============================================================================
-- ALTECH SCHOOL — PHASE 2 — INDEX CIBLÉS (ADDITIFS)
-- =============================================================================
-- Application MANUELLE. Chaque `CREATE INDEX CONCURRENTLY` doit être lancé
-- SÉPARÉMENT (hors transaction) — voir SQL_RUNBOOK_PHASE2.md. Tous `IF NOT
-- EXISTS` : réexécutables sans risque. N'INDEXE QUE des accès réellement
-- introduits par la phase 2 ; on ne double aucun index existant.
--
-- INDEX DÉJÀ PRÉSENTS ET SUFFISANTS (NE PAS recréer) :
--   • students(parent_id)                 -> RLS parent, can_read_student
--   • enrollments(student_id)             -> teacher_teaches_student
--   • subscriptions(session_id)           -> teacher_teaches_student
--   • schedule_sessions(teacher_id)       -> teacher_teaches_student
--   • payments(student_id), student_charges(student_id, paid) -> finances élève
--   • profiles(entity_id)                 -> my_entity_id / jointures de rôle
--   • idx_payments_date_desc, idx_cash_date_desc, idx_attendance_occurred_desc,
--     idx_students_lastname_lower, idx_students_firstname_lower (phase 1)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A. LISTE D'ÉLÈVES PAR CLÉ (keyset) — ordre (last_name, first_name, id)
-- -----------------------------------------------------------------------------
-- Justification : lib/repo/students.ts lit la liste triée exactement sur
-- (last_name, first_name, id) avec pagination par curseur. Un index composite
-- sur ces trois colonnes sert à la fois l'ORDER BY et la condition keyset
-- `WHERE (last_name,first_name,id) > curseur`, sans tri en mémoire.
create index concurrently if not exists idx_students_name_keyset
  on public.students (last_name, first_name, id);

-- -----------------------------------------------------------------------------
-- B. PRÉSENCES PAR SÉANCE + ÉLÈVE (écran présence d'une classe/date)
-- -----------------------------------------------------------------------------
-- Justification : l'écran de présence charge les présences d'une séance donnée.
-- idx_attendance_session existe (session_id) ; ce composite ajoute student_id
-- pour les recherches « cette séance, cet élève » sans relire toute la séance.
-- (À ne créer que si le bloc 4 des diagnostics montre un besoin réel ; sinon
--  idx_attendance_session suffit — décommenter au besoin.)
-- create index concurrently if not exists idx_attendance_session_student
--   on public.attendance_records (session_id, student_id);

-- -----------------------------------------------------------------------------
-- C. JOURNAL D'IDEMPOTENCE — recherche par opération/date (maintenance)
-- -----------------------------------------------------------------------------
-- La PK (idempotency_key) sert les lookups de rejeu. Cet index secondaire aide
-- seulement le nettoyage/audit par date ; optionnel.
create index concurrently if not exists idx_operation_log_created
  on public.operation_log (created_at desc);


-- =============================================================================
-- VARIANTE NON CONCURRENTE (staging / base petite / fenêtre de maintenance)
-- =============================================================================
-- create index if not exists idx_students_name_keyset   on public.students (last_name, first_name, id);
-- create index if not exists idx_operation_log_created   on public.operation_log (created_at desc);


-- =============================================================================
-- VÉRIFICATION
-- =============================================================================
-- select indexname, indexdef from pg_indexes
--  where schemaname='public' and indexname in ('idx_students_name_keyset','idx_operation_log_created');
-- select indexrelid::regclass, indisvalid from pg_index where not indisvalid;  -- attendu : 0

-- =============================================================================
-- ROLLBACK
-- =============================================================================
-- drop index concurrently if exists public.idx_students_name_keyset;
-- drop index concurrently if exists public.idx_operation_log_created;
