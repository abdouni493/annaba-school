-- =============================================================================
--  MISE À JOUR — Deuxième téléphone de l'élève, emploi du temps MULTI-NIVEAUX,
--                et règlement de l'enseignant MOIS PAR MOIS (trois tables)
--  Projet : https://jehpfbupmhbnbbkzhiwr.supabase.co
--
--  À exécuter TEL QUEL dans le SQL Editor de Supabase, UNE SEULE FOIS.
--  Le script est IDEMPOTENT : le relancer ne casse rien et ne modifie aucune
--  donnée existante. Il n'ajoute que TROIS COLONNES FACULTATIVES — rien n'est
--  supprimé, rien n'est réécrit, aucune contrainte n'est resserrée.
--
--  Ce qu'il change
--  ---------------
--   1. `students.phone2`                  — le second numéro de la famille.
--   2. `schedule_sessions.class_groups`   — un créneau qui réunit PLUSIEURS
--                                           niveaux, chacun avec SES groupes.
--   3. `teacher_payments.board`           — la photographie des trois tables du
--                                           règlement d'un mois, figée.
--
--  Rien à faire côté données : sans ces colonnes, chaque fiche déjà en base se
--  lit exactement comme avant (un seul numéro, un seul niveau, l'ancien détail
--  de règlement). C'est le comportement voulu.
-- =============================================================================


-- -----------------------------------------------------------------------------
--  1. LE DEUXIÈME NUMÉRO DE TÉLÉPHONE D'UN ÉLÈVE
--
--  Le premier numéro est celui qu'on compose ; le second est celui qu'on
--  compose quand le premier ne répond pas — la mère, l'oncle, le voisin. La
--  réception le connaît presque toujours, et jusqu'ici elle n'avait nulle part
--  où l'écrire : il finissait dans la description, où aucune recherche ne le
--  trouvait.
--
--  Il est FACULTATIF, et le restera : une fiche sans second numéro est une
--  fiche complète. La colonne accepte donc NULL, et la valeur par défaut est la
--  chaîne vide plutôt qu'un refus — exactement comme `phone`.
--
--  Côté application, il s'affiche partout où le premier s'affiche (création,
--  modification, fiche détaillée, feuille de présence, listes imprimées) et la
--  recherche d'élève le balaie comme le premier : une famille qui appelle
--  depuis l'autre ligne doit se retrouver du premier coup.
-- -----------------------------------------------------------------------------
alter table public.students
  add column if not exists phone2 text;

comment on column public.students.phone2 is
  'Second numéro de téléphone de la famille (facultatif) : celui qu''on compose quand le premier ne répond pas. Recherché comme le premier depuis toutes les listes d''élèves.';


-- -----------------------------------------------------------------------------
--  2. UN EMPLOI DU TEMPS QUI RÉUNIT PLUSIEURS NIVEAUX
--
--  Le cas est courant et n'avait pas de place en base : un même créneau réunit
--  la 4e année moyenne et la 3e année secondaire — même heure, même salle, même
--  enseignant — mais chaque niveau amène SES PROPRES GROUPES. Une seule colonne
--  `class_id` obligeait alors à créer deux emplois du temps qui se marchent sur
--  les pieds : deux fois la même salle au même moment, deux tarifs à tenir en
--  phase, deux feuilles de présence pour une seule séance.
--
--  `class_groups` porte l'association, classe par classe :
--
--      {
--        "cls-4am": ["grp-a", "grp-b"],
--        "cls-3as": ["grp-c"]
--      }
--
--  Les colonnes existantes gardent leur sens et continuent d'être remplies :
--
--      class_id   = la PREMIÈRE classe   (ce que le scan et la base lisent)
--      class_ids  = toutes les classes   (déjà là pour les séances libres)
--      group_id   = le PREMIER groupe
--      group_ids  = l'UNION de tous les groupes de tous les niveaux
--
--  C'est ce qui rend la nouveauté invisible pour tout le reste : la feuille de
--  présence, le scan de badge, les tarifs, la paie de l'enseignant et les
--  rapports lisent les mêmes colonnes qu'avant, sans une ligne de changement.
--
--  NULL = emploi du temps à un seul niveau, c'est-à-dire tous ceux déjà en base.
-- -----------------------------------------------------------------------------
alter table public.schedule_sessions
  add column if not exists class_groups jsonb;

comment on column public.schedule_sessions.class_groups is
  'Emploi du temps MULTI-NIVEAUX : les groupes de CHAQUE classe, {"classId": ["groupId", …]}. class_id garde la première classe et group_ids l''union de tous les groupes, pour que le scan, les présences et la paie lisent les mêmes colonnes qu''avant. NULL = un seul niveau.';


-- -----------------------------------------------------------------------------
--  3. LA PHOTOGRAPHIE D'UN RÈGLEMENT D'ENSEIGNANT — LES TROIS TABLES, FIGÉES
--
--  La paie ne se fait plus « en vrac » : on ouvre UN emploi du temps, on choisit
--  UN mois (M1 … M12), et cet écran montre exactement trois tables :
--
--    1. LES ÉLÈVES DU MOIS — présences, versements, et ce que chacun rapporte à
--       l'enseignant : part du mois ÷ séances du mois × ses séances payables,
--       au centime. Un élève qui doit encore de l'argent RETIENT sa part, sauf
--       si l'école avance sa dette de sa caisse — il passe alors en rouge, et un
--       filtre dédié ne montre plus qu'eux.
--    2. LES ARRIÉRÉS — les élèves qui ont payé EN RETARD un mois DÉJÀ réglé.
--       Leur part se rattrape sur le règlement suivant, avec son mois d'origine,
--       sans jamais se confondre avec le mois courant.
--    3. LES RETENUES — dépenses avancées par l'école, acomptes, scolarité encore
--       due de ses enfants, et scolarités que le guichet a déjà créditées en les
--       portant sur ce salaire.
--
--  Et le net : table 1 + table 2 − table 3.
--
--  POURQUOI FIGER PLUTÔT QUE RECALCULER. Un règlement est un fait daté. Six mois
--  plus tard, l'élève a changé de groupe, le tarif de l'emploi du temps a été
--  corrigé, une présence a été retirée : recalculer afficherait alors un montant
--  que personne n'a jamais versé, et la fiche de paie imprimée contredirait la
--  caisse. `board` conserve donc les lignes telles qu'elles ont été payées —
--  c'est ce que « voir le détail », la réimpression et les rapports relisent.
--
--  Forme (aucune contrainte n'est posée dessus : c'est un instantané, pas un
--  modèle relationnel) :
--
--      {
--        "sessionId": "...", "emploi": "Mathématiques", "groupName": "Groupe A",
--        "className": "4AM", "salleName": "Salle 2",
--        "daysLabel": "Samedi · Mardi", "timeLabel": "08:00–10:00",
--        "monthCode": "M2", "size": 4, "held": 4,
--        "monthPrice": 1800, "teacherMonthShare": 1150, "perSeance": 287.5,
--        "students":   [ { "studentId", "name", "seances", "perSeance",
--                          "credited", "debt", "amount", "withheld",
--                          "schoolCovered", … } ],
--        "arrears":    [ { …, "monthCode": "M1", "dates": ["2026-03-07", …] } ],
--        "deductions": [ { "kind": "expense|acompte|child|child_debt",
--                          "label", "amount", "date" } ],
--        "studentsTotal", "arrearsTotal", "deductionsTotal", "gross", "net"
--      }
--
--  NULL = règlement enregistré avant cet écran. Ceux-là restent parfaitement
--  lisibles : `months`, `arrears`, `expenses`, `acomptes`, `child_charges` et
--  `child_debts` continuent de les décrire, et l'ancienne fiche de paie les
--  réimprime. Aucune migration de données n'est nécessaire ni souhaitable.
-- -----------------------------------------------------------------------------
alter table public.teacher_payments
  add column if not exists board jsonb;

comment on column public.teacher_payments.board is
  'Photographie FIGÉE de l''écran de règlement d''un mois : les trois tables (élèves du mois, arriérés rattrapés, retenues) et leurs totaux. Relue telle quelle par « voir le détail », la réimpression de la fiche de paie et les rapports — jamais recalculée, pour qu''un tarif corrigé depuis ne puisse pas contredire ce qui a été versé. NULL = règlement antérieur à cet écran.';


-- -----------------------------------------------------------------------------
--  4. Ce qui NE change PAS — et n'a donc besoin d'aucune colonne
--
--  * LE RACCOURCI « + 1 SÉANCE » de l'encaissement d'un solde n'écrit rien de
--    nouveau : il calcule le montant proposé (prix d'une séance × séances qui
--    restent à l'élève sur son mois) et le pose dans la case. Le versement
--    enregistré reste un `payments` ordinaire.
--  * LES CARTES DE LA FEUILLE DE PRÉSENCE (inscrits / présents / absents /
--    annulées / à pointer) comptent les lignes `attendance_records` du jour
--    affiché. Rien n'est stocké : elles bougent parce que la feuille bouge.
--  * LE TOTAL ENCAISSÉ PAR EMPLOI DU TEMPS, sur le tableau de bord, est la somme
--    de `payments.amount_paid` des abonnements de cet emploi. Une lecture, pas
--    une écriture.
--  * L'AVANCE DE DETTE PAR L'ÉCOLE écrit, comme avant, deux mouvements de caisse
--    et un `payments` marqué `paid_from = 'school_cash'` : c'est précisément ce
--    marquage qui fait passer l'élève en rouge sur l'écran de paie et qui
--    alimente le filtre « dettes avancées par l'école ».
--  * LES MOIS (M1 … M12) restent PROPRES à chaque emploi du temps et se
--    déduisent des présences. La liste va toujours jusqu'à M12, même vide :
--    c'est un calendrier, pas un journal.
-- -----------------------------------------------------------------------------


-- -----------------------------------------------------------------------------
--  Vérification — à lire dans la sortie du SQL Editor
-- -----------------------------------------------------------------------------
select
  (select count(*) from information_schema.columns
     where table_schema = 'public'
       and table_name = 'students'
       and column_name = 'phone2')                          as colonne_second_telephone_ok,   -- 1 attendue
  (select count(*) from information_schema.columns
     where table_schema = 'public'
       and table_name = 'schedule_sessions'
       and column_name = 'class_groups')                    as colonne_multi_niveaux_ok,      -- 1 attendue
  (select count(*) from information_schema.columns
     where table_schema = 'public'
       and table_name = 'teacher_payments'
       and column_name = 'board')                           as colonne_paie_par_mois_ok,      -- 1 attendue
  (select count(*) from public.students
     where coalesce(phone2, '') <> '')                      as eleves_avec_second_numero,
  (select count(*) from public.schedule_sessions
     where class_groups is not null)                        as emplois_multi_niveaux,
  (select count(*) from public.teacher_payments
     where board is not null)                               as reglements_avec_detail_fige,
  (select count(*) from public.teacher_payments)            as reglements_total;

-- Les trois colonnes, telles que Postgres les voit désormais.
select table_name, column_name, data_type, is_nullable
  from information_schema.columns
 where table_schema = 'public'
   and (table_name, column_name) in (
     ('students', 'phone2'),
     ('schedule_sessions', 'class_groups'),
     ('teacher_payments', 'board')
   )
 order by table_name, column_name;
