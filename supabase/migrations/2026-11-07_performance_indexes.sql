-- =============================================================================
-- ALTECH SCHOOL — INDEX DE PERFORMANCE (ADDITIFS, SÛRS EN LIGNE)
-- Date : 2026-11-07
-- =============================================================================
-- CE FICHIER NE DOIT PAS ÊTRE EXÉCUTÉ AUTOMATIQUEMENT EN PRODUCTION.
-- Il est appliqué MANUELLEMENT par l'administrateur, après sauvegarde, en
-- suivant SUPABASE_SQL_RUNBOOK.md.
--
-- PRINCIPE DE PRUDENCE
-- --------------------
-- Le schéma est DÉJÀ fortement indexé (voir pg_indexes, bloc 3 des
-- diagnostics). La lenteur du DÉMARRAGE ne vient PAS d'un manque d'index : le
-- code télécharge chaque table EN ENTIER (SELECT * sans WHERE), ce qu'aucun
-- index n'accélère. Ces index ne servent donc QU'AUX lectures filtrées et
-- paginées introduites côté application (recherche, historiques par date,
-- fiches élève à la demande). Tant que ce code n'est pas déployé, ils sont
-- inoffensifs mais inutiles — d'où l'option `CONCURRENTLY` ci-dessous pour les
-- poser sans bloquer les écritures.
--
-- TOUS les index sont `IF NOT EXISTS` : réexécuter ce fichier ne casse rien.
--
-- ⚠️ CREATE INDEX CONCURRENTLY NE PEUT PAS TOURNER DANS UNE TRANSACTION.
--    L'éditeur SQL de Supabase enveloppe parfois le script dans une
--    transaction. Lancer les instructions CONCURRENTLY UNE PAR UNE (voir le
--    runbook). Une variante NON concurrente (verrou bref) est fournie en
--    commentaire pour une base encore petite ou une fenêtre de maintenance.
--
-- RAPPELS SCHÉMA (vérifiés sur supabase/schema.sql) :
--   • payments.date, cash_transactions.date, attendance_records.occurred_at
--     sont de type TEXT au format ISO (tri lexicographique = tri chronologique).
--   • students a first_name / last_name (pas de colonne `name` unique).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- A. HISTORIQUES PAR DATE (pagination « plus récent d'abord »)
-- -----------------------------------------------------------------------------
-- Justification : les écrans Caisse, Versements et Présences doivent lister les
-- dernières lignes, page par page, au lieu de tout charger. Un index
-- descendant sur la date sert l'ORDER BY ... DESC LIMIT n sans tri en mémoire.

create index concurrently if not exists idx_payments_date_desc
  on public.payments (date desc);

create index concurrently if not exists idx_cash_date_desc
  on public.cash_transactions (date desc);

create index concurrently if not exists idx_attendance_occurred_desc
  on public.attendance_records (occurred_at desc);


-- -----------------------------------------------------------------------------
-- B. FICHE ÉLÈVE À LA DEMANDE (présences d'un élève, du plus récent)
-- -----------------------------------------------------------------------------
-- Justification : la fiche élève et les relevés affichent les présences d'UN
-- élève dans l'ordre chronologique inverse. L'index existant idx_attendance_student
-- ne porte que sur student_id ; ce composite évite le tri par occurred_at.
-- Non redondant avec idx_attendance_student (préfixe identique, mais ajoute
-- l'ordre de date, ce que le simple index ne couvre pas pour l'ORDER BY).

create index concurrently if not exists idx_attendance_student_occurred
  on public.attendance_records (student_id, occurred_at desc);


-- -----------------------------------------------------------------------------
-- C. RECHERCHE D'ÉLÈVE PAR NOM (préfixe, insensible à la casse)
-- -----------------------------------------------------------------------------
-- Justification : la recherche serveur (debounced) filtre par nom/prénom. Un
-- index fonctionnel sur lower(...) sert les requêtes
--   WHERE lower(last_name) LIKE lower('dupont%')
-- en recherche par PRÉFIXE. (La recherche « contient » (%terme%) exigerait
-- l'extension pg_trgm + un index GIN ; non incluse ici pour éviter une
-- dépendance d'extension non justifiée tant que le préfixe suffit.)

create index concurrently if not exists idx_students_lastname_lower
  on public.students (lower(last_name) text_pattern_ops);

create index concurrently if not exists idx_students_firstname_lower
  on public.students (lower(first_name) text_pattern_ops);


-- =============================================================================
-- VARIANTE NON CONCURRENTE (fenêtre de maintenance / base encore petite)
-- =============================================================================
-- Si la base est petite et qu'une brève pose de verrou est acceptable, les
-- mêmes index peuvent être créés sans CONCURRENTLY, et alors TOUT le fichier
-- peut tourner d'un bloc dans une transaction. Décommenter au besoin :
--
-- create index if not exists idx_payments_date_desc            on public.payments (date desc);
-- create index if not exists idx_cash_date_desc                on public.cash_transactions (date desc);
-- create index if not exists idx_attendance_occurred_desc      on public.attendance_records (occurred_at desc);
-- create index if not exists idx_attendance_student_occurred   on public.attendance_records (student_id, occurred_at desc);
-- create index if not exists idx_students_lastname_lower       on public.students (lower(last_name) text_pattern_ops);
-- create index if not exists idx_students_firstname_lower      on public.students (lower(first_name) text_pattern_ops);


-- =============================================================================
-- ROLLBACK (retrait des index ajoutés par ce fichier)
-- =============================================================================
-- DROP INDEX CONCURRENTLY ne peut pas non plus tourner en transaction ; lancer
-- une par une si besoin.
--
-- drop index concurrently if exists public.idx_payments_date_desc;
-- drop index concurrently if exists public.idx_cash_date_desc;
-- drop index concurrently if exists public.idx_attendance_occurred_desc;
-- drop index concurrently if exists public.idx_attendance_student_occurred;
-- drop index concurrently if exists public.idx_students_lastname_lower;
-- drop index concurrently if exists public.idx_students_firstname_lower;
