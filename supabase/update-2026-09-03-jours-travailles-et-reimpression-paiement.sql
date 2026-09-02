-- =============================================================================
--  MISE À JOUR — JOURS DE TRAVAIL DES TRAVAILLEURS + FIABILITÉ DES ÉLÈVES
--  Projet : https://github.com/abdouni493/annaba-school
--
--  À exécuter TEL QUEL dans le SQL Editor de Supabase, UNE SEULE FOIS.
--  Le script est ENTIÈREMENT IDEMPOTENT : chaque instruction est un
--  « add column IF NOT EXISTS ». Le relancer ne réécrit rien, ne supprime rien.
--
--  CE QUE ÇA RÈGLE
--  ---------------
--   1. LES JOURS DE TRAVAIL D'UN TRAVAILLEUR. Un mensuel, un journalier ou un
--      demi-journalier peut désormais dire QUELS JOURS de la semaine il vient.
--      L'écran de règlement ne compte alors QUE ces journées-là : un jour de
--      repos (un vendredi, par exemple) n'est plus une journée « non payée ».
--      -> nouvelle colonne `reception_staff.work_days`.
--
--      ⚠️ IMPORTANT : sans cette colonne, l'ENREGISTREMENT D'UN TRAVAILLEUR
--      échouerait désormais (le code écrit `work_days`). Exécutez donc ce script
--      avant d'utiliser la nouvelle version.
--
--   2. LES ÉLÈVES QUI « DISPARAISSAIENT ». Un élève créé (depuis l'écran Élèves
--      ou depuis l'ouverture d'un groupe au tableau de bord) s'écrit dans des
--      colonnes que la base de production n'avait pas toujours — la ligne était
--      alors rejetée par PostgREST (« Could not find the '…' column ») et
--      l'élève disparaissait au rechargement. On remet donc, par sécurité,
--      toutes les colonnes récentes de `students` (le code réessaie désormais
--      d'écrire ce qui a échoué, mais la colonne doit exister pour aboutir).
--
--  La RÉIMPRESSION D'UN ANCIEN PAIEMENT (nouveau bouton du tableau de bord) et
--  la CORRECTION de la modification d'un enseignant n'ont besoin d'AUCUNE
--  colonne nouvelle : rien à faire en base pour elles.
-- =============================================================================


-- -----------------------------------------------------------------------------
--  1. TRAVAILLEURS — les jours de la semaine réellement travaillés.
-- -----------------------------------------------------------------------------
alter table public.reception_staff
  add column if not exists work_days text[];


-- -----------------------------------------------------------------------------
--  2. ÉLÈVES — filet de sécurité : toutes les colonnes que le code écrit.
--     (Sans effet si elles sont déjà là ; c'est ce qui garantit qu'un élève
--     créé atteint bien la base et se réaffiche correctement depuis elle.)
-- -----------------------------------------------------------------------------
alter table public.students
  add column if not exists registration_number          text,
  add column if not exists phone2                        text,
  add column if not exists is_free                       boolean not null default false,
  add column if not exists student_case                  text,
  add column if not exists free_subscription_ids         jsonb,
  add column if not exists teacher_father_id             text,
  add column if not exists case_reduction                jsonb,
  add column if not exists unpaid_teacher_ids            jsonb,
  add column if not exists school_only_subscription_ids  jsonb,
  add column if not exists enrollment_level              text,
  add column if not exists enrollment_year               text,
  add column if not exists parent_id                     text,
  add column if not exists subscription_ids              jsonb not null default '[]'::jsonb,
  add column if not exists subscription_dates            jsonb,
  add column if not exists subscription_discounts        jsonb,
  add column if not exists registration_due              numeric,
  add column if not exists created_by                    text,
  add column if not exists created_by_name               text,
  add column if not exists created_by_role               text;


-- -----------------------------------------------------------------------------
--  3. RELIRE LE SCHÉMA — pour que le cache de PostgREST cesse aussitôt de
--     chercher les colonnes qu'on vient de lui ajouter (sinon l'erreur « … in
--     the schema cache » persiste quelques minutes).
-- -----------------------------------------------------------------------------
notify pgrst, 'reload schema';
