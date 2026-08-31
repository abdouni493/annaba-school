-- =============================================================================
--  MISE À JOUR — L'ENSEIGNANT SAIT POUR QUEL COURS DE SON FILS ON LE RETIENT
--  Projet : https://jehpfbupmhbnbbkzhiwr.supabase.co
--
--  À exécuter TEL QUEL dans le SQL Editor de Supabase, UNE SEULE FOIS.
--  Le script est IDEMPOTENT : le relancer ne change rien de plus.
--  Il n'AJOUTE qu'une colonne facultative. Rien n'est supprimé, aucune
--  contrainte n'est resserrée, aucune ligne existante n'est réécrite, aucun
--  montant n'est touché.
--
--  CE QUE ÇA RÈGLE
--  ---------------
--  Quand la réception solde la scolarité d'un fils d'enseignant en la portant
--  sur le salaire de son père, la ligne écrite ne retenait que l'IDENTIFIANT de
--  l'emploi du temps crédité. Sur sa paie, le père lisait donc « Scolarité —
--  Yacine · M2 · −1 500 DA » : le montant, mais jamais LEQUEL des cours de son
--  fils il venait de payer. Un enfant inscrit à trois modules rendait la
--  retenue impossible à vérifier.
--
--  Le NOM de l'emploi du temps est désormais recopié sur la ligne, au moment où
--  elle est écrite — exactement comme un arriéré garde le nom de l'emploi qui
--  l'a produit. Un emploi du temps archivé, renommé ou repris par un autre
--  enseignant ne peut donc plus transformer la ligne de sa fiche de paie en
--  tiret.
-- =============================================================================


-- -----------------------------------------------------------------------------
--  1. LA COLONNE
-- -----------------------------------------------------------------------------
alter table public.teacher_child_debts
  add column if not exists emploi text;

comment on column public.teacher_child_debts.emploi is
  'Le NOM de l''emploi du temps crédité, recopié le jour où la somme est portée sur le père : c''est ce qu''il lit sur sa paie. NULL = ligne écrite avant cette colonne ; l''application le relit alors depuis subscription_id (teacherChildDebtEmploi).';


-- -----------------------------------------------------------------------------
--  2. LES LIGNES DÉJÀ EN BASE — VOLONTAIREMENT LAISSÉES À NULL
--
--     Elles ne perdent rien : elles portent leur `subscription_id`, et un
--     emploi du temps supprimé est ARCHIVÉ, jamais effacé. L'application relit
--     donc leur nom à l'affichage, avec exactement la même règle que partout
--     ailleurs — la classe, le module, la salle et l'enseignant assemblés
--     (`subscriptionLabel`).
--
--     Rejouer cet assemblage en SQL, avec les emplois multi-niveaux et leurs
--     groupes en jsonb, donnerait un intitulé légèrement différent de celui de
--     l'écran : deux noms pour la même chose, ce qui est pire que pas de nom du
--     tout. Le calcul reste donc du côté de l'application, à un seul endroit.
-- -----------------------------------------------------------------------------
