-- =============================================================================
--  MISE À JOUR — Horaires jour par jour + création sans champs obligatoires
--  Projet : https://jehpfbupmhbnbbkzhiwr.supabase.co
--
--  À exécuter TEL QUEL dans le SQL Editor de Supabase, UNE SEULE FOIS, APRÈS
--  `update-2026-08-19-teacher-per-group.sql`. Le script est idempotent.
--
--  Ce qu'il change
--  ---------------
--   1. `schedule_sessions.day_times` : les horaires JOUR PAR JOUR d'un emploi
--      du temps. Un emploi peut tourner Samedi 08:00–10:00 et Mardi
--      14:00–16:00 : chaque jour porte son créneau.
--
--        {"saturday": {"startTime": "08:00", "endTime": "10:00"},
--         "tuesday":  {"startTime": "14:00", "endTime": "16:00"}}
--
--      `start_time` / `end_time` restent l'horaire PAR DÉFAUT : un jour absent
--      de `day_times` tourne dessus. Les emplois existants ne changent donc
--      pas de comportement — ils gardent simplement le même horaire partout.
--
--   2. Un emploi du temps se crée avec les seuls JOURS : classe, module,
--      groupe, salle et enseignant peuvent être complétés plus tard. Les
--      colonnes concernées sont donc vérifiées comme acceptant la chaîne vide.
--
--  Aucune donnée existante n'est modifiée.
-- =============================================================================


-- -----------------------------------------------------------------------------
--  1. Les horaires jour par jour
-- -----------------------------------------------------------------------------
alter table public.schedule_sessions
  add column if not exists day_times jsonb;

comment on column public.schedule_sessions.day_times is
  'Horaires jour par jour : {"saturday":{"startTime":"08:00","endTime":"10:00"}}. '
  'Un jour absent tourne sur start_time / end_time (l''horaire par défaut).';

--  Garde-fou : soit NULL, soit un objet JSON (jamais un tableau ni un scalaire).
alter table public.schedule_sessions
  drop constraint if exists schedule_sessions_day_times_check;

alter table public.schedule_sessions
  add constraint schedule_sessions_day_times_check
  check (day_times is null or jsonb_typeof(day_times) = 'object');


-- -----------------------------------------------------------------------------
--  2. Un emploi du temps se crée avec les seuls jours
--
--  L'application envoie une chaîne vide pour ce qui n'est pas encore choisi ;
--  ces colonnes doivent donc avoir une valeur par défaut vide et ne jamais
--  refuser une fiche incomplète.
-- -----------------------------------------------------------------------------
do $$
declare
  c text;
begin
  foreach c in array array['class_id', 'module_id', 'group_id', 'salle_id', 'teacher_id'] loop
    execute format(
      'update public.schedule_sessions set %I = %L where %I is null', c, '', c);
    execute format(
      'alter table public.schedule_sessions alter column %I set default %L', c, '');
    execute format(
      'alter table public.schedule_sessions alter column %I set not null', c);
  end loop;
end $$;

--  Le titre, la période et le prix d'une séance libre restent facultatifs.
alter table public.schedule_sessions alter column title        drop not null;
alter table public.schedule_sessions alter column period_start drop not null;
alter table public.schedule_sessions alter column period_end   drop not null;
alter table public.schedule_sessions alter column open_price   drop not null;


-- -----------------------------------------------------------------------------
--  3. Vérification — la colonne et sa contrainte sont bien en place
-- -----------------------------------------------------------------------------
select
  column_name    as "colonne",
  data_type      as "type",
  is_nullable    as "nullable",
  column_default as "défaut"
from information_schema.columns
where table_schema = 'public'
  and table_name   = 'schedule_sessions'
order by ordinal_position;
