-- =============================================================================
--  MISE À JOUR — LES ENSEIGNANTS, DU DERNIER ARRIVÉ AU PLUS ANCIEN
--  Projet : https://jehpfbupmhbnbbkzhiwr.supabase.co
--
--  À exécuter TEL QUEL dans le SQL Editor de Supabase, UNE SEULE FOIS.
--  Le script est IDEMPOTENT : le relancer ne réécrit aucune date déjà posée.
--  Il n'AJOUTE qu'une colonne facultative et remplit celles qui sont vides.
--  Rien n'est supprimé, aucune contrainte n'est resserrée.
--
--  LE PROBLÈME QUE ÇA RÈGLE
--  ------------------------
--  L'écran « Enseignants » affichait les fiches dans l'ordre où la base les
--  rendait. Cet ordre-là n'est garanti par personne : il suit l'ordre physique
--  des lignes, celui d'une fiche MODIFIÉE change, et l'enseignant inscrit ce
--  matin pouvait donc se retrouver au milieu — ou à la fin — d'une liste de
--  cinquante cartes. La réception devait chercher celui qu'elle venait tout
--  juste de créer.
--
--  Désormais chaque fiche porte sa date de création, et la liste se lit du
--  dernier arrivé au plus ancien.
--
--  LA REPRISE DES FICHES EXISTANTES
--  --------------------------------
--  Les enseignants déjà en base n'ont jamais eu de date. On leur en pose une,
--  dans l'ordre où la table les rend AUJOURD'HUI : une seconde d'écart entre
--  deux fiches, la dernière lue recevant la plus récente. Ce n'est pas leur
--  vraie date d'inscription — elle n'a jamais été écrite nulle part — mais
--  c'est la seule ancienneté qu'on leur connaisse, et elle est désormais figée
--  au lieu de bouger à chaque modification.
-- =============================================================================


-- -----------------------------------------------------------------------------
--  1. LA COLONNE
-- -----------------------------------------------------------------------------
alter table public.teachers
  add column if not exists created_at text;

comment on column public.teachers.created_at is
  'Création de la fiche (ISO). Met les derniers arrivés en tête de la liste.';


-- -----------------------------------------------------------------------------
--  2. LA REPRISE — une date pour les fiches qui n'en ont pas
-- -----------------------------------------------------------------------------
with ordonnees as (
  select ctid,
         row_number() over (order by ctid) as rang,
         count(*)     over ()              as total
    from public.teachers
)
update public.teachers t
   set created_at = to_char(
         (now() at time zone 'utc') - ((o.total - o.rang) * interval '1 second'),
         'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  from ordonnees o
 where o.ctid = t.ctid
   and coalesce(t.created_at, '') = '';
