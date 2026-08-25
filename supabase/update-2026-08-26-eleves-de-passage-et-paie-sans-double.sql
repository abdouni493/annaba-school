-- =============================================================================
--  MISE À JOUR — ÉLÈVES DE PASSAGE (séances libres partagées école / enseignant)
--                et RÈGLEMENT D'UN MOIS SANS DOUBLON
--  Projet : https://jehpfbupmhbnbbkzhiwr.supabase.co
--
--  À exécuter TEL QUEL dans le SQL Editor de Supabase, UNE SEULE FOIS.
--  Le script est IDEMPOTENT : le relancer ne casse rien et ne modifie aucune
--  donnée existante. Il n'ajoute que DEUX COLONNES FACULTATIVES — rien n'est
--  supprimé, rien n'est réécrit, aucune contrainte n'est resserrée.
--
--  Ce qu'il change
--  ---------------
--   1. `independent_sessions.school_share`  — ce que l'école garde sur le prix
--                                             d'une séance libre ; le reste est
--                                             la part de l'enseignant.
--   2. `independent_sessions.teacher_id`    — l'enseignant qui a donné la
--                                             séance, figé à la création.
--
--  Rien à faire côté données : sans ces colonnes, chaque séance libre déjà en
--  base se lit exactement comme avant (l'école gardait tout, l'enseignant ne
--  touchait rien dessus). C'est le comportement voulu — inventer rétroactivement
--  une part d'enseignant sur des séances déjà encaissées serait faux.
--
--  Le reste de cette mise à jour est du CODE, pas du schéma : la correction du
--  règlement en double, les élèves de passage sur la feuille de présence et la
--  table « Retards de paiement & séances libres » de la paie n'ont besoin
--  d'aucune colonne — voir la section 3, « Ce qui NE change PAS en base ».
-- =============================================================================


-- -----------------------------------------------------------------------------
--  1. CE QUE L'ÉCOLE GARDE SUR UNE SÉANCE LIBRE
--
--  Une séance libre se vend désormais comme un mois d'emploi du temps : la
--  réception tape le PRIX TOTAL que la personne verse, puis la PART DE L'ÉCOLE.
--  Le reste appartient à l'enseignant :
--
--      part enseignant = price − school_share
--
--  Cette part n'est pas versée à la volée : elle rejoint le MOIS de l'emploi du
--  temps dans lequel la date de la séance tombe, et se règle avec lui, dans la
--  table « Retards de paiement & séances libres » de l'écran de paie. C'est ce
--  qui la rend traçable — on sait toujours quel règlement l'a soldée, parce que
--  `teacher_paid` passe à true avec ce règlement-là, et une seule fois.
--
--  POURQUOI LA COLONNE ACCEPTE NULL, ET POURQUOI ELLE N'EST PAS REMPLIE ICI.
--  Une séance enregistrée avant ce découpage n'a jamais eu de part d'école
--  écrite : l'école gardait tout. L'application lit donc NULL comme
--  « school_share = price », c'est-à-dire « part enseignant = 0 ». Poser un
--  DEFAULT, ou remplir les anciennes lignes, reviendrait à décider après coup
--  qu'un enseignant est créancier d'un argent que personne ne lui a promis, et
--  à faire bouger des totaux déjà encaissés, déjà imprimés, déjà clôturés.
--  Une ancienne séance peut toujours être rouverte depuis « Séances Libres » et
--  se voir attribuer une part : la colonne cesse alors d'être NULL, pour elle
--  seule.
-- -----------------------------------------------------------------------------
alter table public.independent_sessions
  add column if not exists school_share numeric;

comment on column public.independent_sessions.school_share is
  'Ce que l''école garde sur `price`. La part de l''enseignant vaut price − school_share et se règle avec le MOIS de l''emploi du temps où la date tombe (table « Retards de paiement & séances libres » de sa paie). NULL = séance antérieure au partage : l''école gardait tout, la part enseignant vaut 0.';


-- -----------------------------------------------------------------------------
--  2. L'ENSEIGNANT QUI A DONNÉ LA SÉANCE, FIGÉ À LA CRÉATION
--
--  La part se lit aujourd'hui à travers l'emploi du temps (`session_id` -> son
--  titulaire). Cela suffit tant que personne ne change, mais un créneau change
--  de titulaire — un remplaçant, une réaffectation en cours d'année — et toutes
--  les séances libres passées basculeraient alors sur le nouveau, y compris
--  celles que l'ancien a réellement assurées.
--
--  `teacher_id` fixe donc qui était là, au moment où la séance est saisie. C'est
--  une TRACE, pas une clé de calcul : la paie continue de passer par l'emploi du
--  temps, et cette colonne répond à la question « qui a donné cette séance ? »
--  même des mois plus tard.
--
--  `on delete set null` : supprimer un enseignant ne doit pas emporter la
--  recette d'une séance qui a bien eu lieu.
--
--  NULL = séance enregistrée avant cette colonne — le titulaire de l'emploi du
--  temps reste alors la seule réponse disponible, exactement comme avant.
-- -----------------------------------------------------------------------------
alter table public.independent_sessions
  add column if not exists teacher_id text;

do $$
begin
  if not exists (
    select 1
      from information_schema.table_constraints
     where table_schema = 'public'
       and table_name   = 'independent_sessions'
       and constraint_name = 'independent_sessions_teacher_id_fkey'
  ) then
    alter table public.independent_sessions
      add constraint independent_sessions_teacher_id_fkey
      foreign key (teacher_id) references public.teachers (id) on delete set null;
  end if;
end $$;

comment on column public.independent_sessions.teacher_id is
  'L''enseignant qui a donné cette séance libre, figé à la création — pour qu''un changement de titulaire sur l''emploi du temps ne réattribue pas après coup les séances déjà assurées. Trace, pas clé de calcul : la paie passe toujours par l''emploi du temps. NULL = séance antérieure à cette colonne.';

create index if not exists idx_independent_teacher on public.independent_sessions (teacher_id);
create index if not exists idx_independent_date    on public.independent_sessions (date);


-- -----------------------------------------------------------------------------
--  3. CE QUI NE CHANGE PAS EN BASE — et qui change pourtant beaucoup à l'écran
--
--  * LE RÈGLEMENT EN DOUBLE EST CORRIGÉ, SANS UNE COLONNE.
--    L'écran de paie décide, séance par séance, ce qui est payable : une part
--    n'est retenue que si LA SÉANCE QUI L'A PRODUITE n'est pas payée sur CE mois
--    de CET emploi du temps. L'enregistrement, lui, superposait un second filtre
--    global (« cet élève doit-il quelque chose, quelque part ? »). Les deux ne
--    disaient pas la même chose : la part était cochée, le net sortait de la
--    caisse, la fiche s'imprimait — mais la ligne `unpaid_teacher_sessions`
--    n'était jamais passée à `paid = true`. Elle revenait donc au mois suivant,
--    et le mois lui-même continuait de s'afficher « à régler » alors qu'un
--    règlement existait : c'est le « double » que la réception voyait.
--    Désormais, quand le règlement NOMME les parts qu'il solde, ces parts font
--    foi. Deux cas cessent de boucler : un élève à jour sur son groupe mais
--    devant encore des frais d'inscription, et un retardataire qui a soldé son
--    M1 alors qu'il vit déjà son M2.
--
--  * UN MOIS DÉJÀ RÉGLÉ NE SE REPAIE PLUS.
--    Le bouton d'enregistrement disparaît, les cases se figent, et il ne reste
--    que « Modifier » (le net, la date, le libellé) et « Supprimer » (tout
--    redevient dû). C'est de l'affichage : le fait qu'un mois soit réglé se lit
--    déjà dans `teacher_payments.months` et `teacher_payments.board`.
--
--  * LES ÉLÈVES DE PASSAGE SUR LA FEUILLE DE PRÉSENCE sont, en base, de simples
--    `independent_sessions` portant `session_id` + `date` et aucun `student_id`.
--    C'est pourquoi ils n'apparaissent QUE sur la séance où ils sont venus : la
--    feuille du jour lit la date affichée, et la séance suivante ne les connaît
--    pas. S'ils reviennent, on les ressaisit — ce qui est exactement ce qui se
--    passe au comptoir.
--
--  * LA PART D'UNE SÉANCE LIBRE REJOINT SON MOIS par la date, comme avant : le
--    mois dont la fenêtre de séances contient ce jour-là. Aucun `month_code`
--    n'est stocké sur la séance ; le déduire garde les mois cohérents quand une
--    présence est corrigée.
--
--  * LA RECETTE ENTRE EN CAISSE À LA CRÉATION (`cash_transactions`, type
--    `student_payment`), en UN mouvement pour toute la fournée de passagers. La
--    sortie qui paie l'enseignant, elle, est écrite par le règlement du mois —
--    ce sont deux moments distincts, et la caisse les lit comme tels.
-- -----------------------------------------------------------------------------


-- -----------------------------------------------------------------------------
--  Vérification — à lire dans la sortie du SQL Editor
-- -----------------------------------------------------------------------------
select
  (select count(*) from information_schema.columns
     where table_schema = 'public'
       and table_name = 'independent_sessions'
       and column_name = 'school_share')                  as colonne_part_ecole_ok,        -- 1 attendue
  (select count(*) from information_schema.columns
     where table_schema = 'public'
       and table_name = 'independent_sessions'
       and column_name = 'teacher_id')                    as colonne_enseignant_ok,        -- 1 attendue
  (select count(*) from public.independent_sessions)      as seances_libres_total,
  (select count(*) from public.independent_sessions
     where school_share is not null)                      as seances_avec_part_ecole,
  (select count(*) from public.independent_sessions
     where student_id is null)                            as seances_de_passagers,
  (select count(*) from public.independent_sessions
     where coalesce(teacher_paid, false) = false)         as seances_restant_a_payer;

-- Les deux colonnes, telles que Postgres les voit désormais.
select table_name, column_name, data_type, is_nullable
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'independent_sessions'
   and column_name in ('school_share', 'teacher_id')
 order by column_name;

-- Ce que les séances libres non encore réglées doivent à chaque enseignant,
-- emploi du temps par emploi du temps — le même calcul que l'écran de paie.
select
  t.id                                                            as enseignant_id,
  t.first_name || ' ' || t.last_name                              as enseignant,
  count(*)                                                        as seances_libres,
  sum(i.price)                                                    as encaisse,
  sum(coalesce(i.school_share, i.price))                          as part_ecole,
  sum(i.price - coalesce(i.school_share, i.price))                as part_enseignant
  from public.independent_sessions i
  join public.schedule_sessions s on s.id = i.session_id
  join public.teachers          t on t.id = coalesce(i.teacher_id, s.teacher_id)
 where coalesce(i.teacher_paid, false) = false
 group by t.id, t.first_name, t.last_name
 order by part_enseignant desc;
