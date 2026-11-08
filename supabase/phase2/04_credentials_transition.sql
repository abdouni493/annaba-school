-- =============================================================================
-- ALTECH SCHOOL — PHASE 2 — TRANSITION DES IDENTIFIANTS PORTAIL ÉLÈVE
-- =============================================================================
-- ⚠️  AUCUNE commande destructrice n'est exécutée telle quelle : les étapes qui
--     effacent des données sont COMMENTÉES et à décider par l'administrateur.
--
-- CONSTAT (vérifié)
-- -----------------
-- `public.student_credentials.password` stocke un mot de passe EN CLAIR. Or la
-- connexion réelle passe par Supabase Auth (RPC `admin_create_user` /
-- `admin_create_user_for`, email + mot de passe gérés par GoTrue, hachés côté
-- Auth). Cette colonne en clair est donc une COPIE redondante, affichée au
-- personnel (components/pages/StudentsPage.tsx:1384) — un risque de sécurité
-- sans être le mécanisme d'authentification.
--
-- STRATÉGIE COMPATIBLE (ne casse aucune connexion existante)
-- ----------------------------------------------------------
-- 1. La source de vérité des connexions reste Supabase Auth — on n'y touche pas.
-- 2. L'accès en LECTURE à la colonne est déjà restreint au personnel
--    (voir 01_access_policies.sql : student_credentials_read = is_staff()).
-- 3. La RÉINITIALISATION d'un mot de passe doit passer par Supabase Auth
--    (fonction ci-dessous), pas par une réécriture du clair.
-- 4. Une fois le personnel habitué à « réinitialiser » plutôt qu'« afficher »,
--    la colonne en clair peut être vidée (étape commentée, au choix de l'admin).
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. RÉINITIALISATION D'UN MOT DE PASSE ÉLÈVE VIA SUPABASE AUTH (admin only)
-- -----------------------------------------------------------------------------
-- Met à jour le mot de passe dans auth.users (haché par GoTrue) pour le compte
-- lié à une fiche élève (profiles.entity_id = student_id, role = 'student').
-- Ne stocke RIEN en clair. Réservé à l'administrateur.
create or replace function public.reset_student_password(
  p_student_id text,
  p_new_password text
)
returns void
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_uid uuid;
begin
  if not public.is_admin() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if p_new_password is null or length(p_new_password) < 6 then
    raise exception 'PASSWORD_TOO_SHORT' using errcode = '22000';
  end if;

  select id into v_uid
  from public.profiles
  where entity_id = p_student_id and role = 'student'
  limit 1;

  if v_uid is null then
    raise exception 'NO_ACCOUNT' using errcode = 'P0002';
  end if;

  -- GoTrue : crypt() avec sel bcrypt (extension pgcrypto, schéma extensions).
  update auth.users
     set encrypted_password = extensions.crypt(p_new_password, extensions.gen_salt('bf')),
         updated_at = now()
   where id = v_uid;

  -- On NE réécrit PAS student_credentials.password (plus de clair).
end;
$$;

revoke all on function public.reset_student_password(text, text) from public;
grant execute on function public.reset_student_password(text, text) to authenticated;

commit;


-- =============================================================================
-- 2. (OPTIONNEL, DÉCISION ADMIN) — VIDER LES MOTS DE PASSE EN CLAIR
-- =============================================================================
-- À n'exécuter qu'APRÈS avoir :
--   • confirmé que les connexions élève fonctionnent via Supabase Auth,
--   • adapté l'écran personnel pour « réinitialiser » au lieu d'« afficher »,
--   • fait une sauvegarde.
-- Cette commande EFFACE le clair (irréversible). Laissée commentée exprès.
--
-- begin;
--   update public.student_credentials set password = '' where password <> '';
-- commit;
--
-- Vérification (compte seulement, n'affiche aucune valeur) :
-- select count(*) filter (where coalesce(password,'') <> '') as reste_en_clair
--   from public.student_credentials;   -- objectif après scrub : 0


-- =============================================================================
-- VÉRIFICATION / ROLLBACK
-- =============================================================================
-- Fonction présente :
-- select proname, prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--   where n.nspname='public' and proname='reset_student_password';
--
-- Rollback de la fonction (n'affecte pas les comptes déjà réinitialisés) :
-- drop function if exists public.reset_student_password(text, text);
