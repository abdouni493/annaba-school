-- =============================================================================
--  MISE À JOUR — LA SÉANCE LIBRE REMONTE À LA DIRECTION, ET PEUT ÊTRE NOMINATIVE
--  Projet : https://jehpfbupmhbnbbkzhiwr.supabase.co
--
--  À exécuter TEL QUEL dans le SQL Editor de Supabase, UNE SEULE FOIS.
--  Le script est IDEMPOTENT : le relancer ne change rien de plus.
--  Il n'AJOUTE qu'une colonne facultative. Rien n'est supprimé, aucune
--  contrainte n'est resserrée, aucune ligne existante n'est réécrite.
--
--  CE QUE ÇA RÈGLE
--  ---------------
--  Une séance libre saisie depuis la feuille de présence d'un groupe faisait
--  entrer de l'argent en caisse sans que personne ne le voie passer : aucun
--  reçu ne partait, et la cloche du tableau de bord ne connaissait que les
--  versements. Elle porte donc désormais, comme un versement, la marque « lue
--  par la direction » — et tant qu'elle ne l'est pas, elle remonte dans la
--  cloche, où elle s'imprime et se classe.
-- =============================================================================


-- -----------------------------------------------------------------------------
--  1. LA COLONNE
-- -----------------------------------------------------------------------------
alter table public.independent_sessions
  add column if not exists alert_read boolean not null default false;

comment on column public.independent_sessions.alert_read is
  'La direction a vu passer cette séance libre (cloche du tableau de bord). Les séances déjà en base sont considérées comme lues : elles datent d''avant l''alerte.';


-- -----------------------------------------------------------------------------
--  2. LA REPRISE — ce qui existait déjà ne réveille pas la cloche
--
--     Sans cette ligne, toutes les séances libres jamais saisies remonteraient
--     d'un coup comme « non lues » le jour du déploiement. Elles sont classées.
-- -----------------------------------------------------------------------------
update public.independent_sessions
   set alert_read = true
 where alert_read = false
   and created_at is not null
   and created_at < to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
