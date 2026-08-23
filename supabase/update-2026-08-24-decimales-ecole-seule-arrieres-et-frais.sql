-- =============================================================================
--  MISE À JOUR — Tarifs à la DÉCIMALE, « école seulement » emploi par emploi,
--                arriérés d'enseignant, périmètre des frais d'inscription,
--                emplois du temps à plusieurs groupes et règlements annulables
--  Projet : https://jehpfbupmhbnbbkzhiwr.supabase.co
--
--  À exécuter TEL QUEL dans le SQL Editor de Supabase, UNE SEULE FOIS.
--  Le script est IDEMPOTENT : le relancer ne casse rien et ne modifie aucune
--  donnée existante. Il n'ajoute que des colonnes FACULTATIVES — rien n'est
--  supprimé, rien n'est réécrit, et toutes les fiches déjà en base gardent
--  exactement le sens qu'elles ont aujourd'hui.
--
--  Ce qu'il change
--  ---------------
--   1. LES MONTANTS GARDENT LEURS DÉCIMALES. Rien à migrer : toutes les
--      colonnes d'argent sont déjà en `numeric`. C'est l'application qui
--      arrondissait chaque division à l'entier ; elle arrondit désormais au
--      centime. Le script se contente de le documenter (section 1).
--   2. `students.school_only_subscription_ids` — le cas « école seulement » se
--      coche EMPLOI DU TEMPS PAR EMPLOI DU TEMPS, exactement comme la gratuité.
--   3. `students.enrollment_level` / `.enrollment_year` — la classe et l'année
--      choisies à l'inscription, retenues MÊME SANS emploi du temps, pour que
--      l'écran de modification rouvre là où l'élève a été inscrit.
--   4. `schools.registration_fee_scope` (+ trois listes) — QUI doit les frais
--      d'inscription : tout le monde, un niveau, des classes, ou seulement
--      certains emplois du temps.
--   5. `teacher_payments.arrears` / `.child_debts` / `.cash_id` — un règlement
--      note les arriérés qu'il rattrape, les scolarités qu'il retient, et le
--      mouvement de caisse qu'il a écrit (pour pouvoir être ANNULÉ proprement).
--   6. `unpaid_teacher_sessions.payment_id` — quelle paie a soldé cette part.
--      Sans ce lien, annuler un règlement ne saurait pas quoi rouvrir.
--   7. `schedule_sessions.group_ids` — un emploi du temps peut réunir PLUSIEURS
--      groupes. La colonne existe déjà (elle servait aux séances libres) ; le
--      script ne fait que s'en assurer et documenter son nouvel usage.
-- =============================================================================


-- -----------------------------------------------------------------------------
--  1. LES MONTANTS GARDENT LEURS DÉCIMALES — RIEN À MIGRER, MAIS TOUT À SAVOIR
--
--  Le prix d'une séance se déduit du mois : prix du mois ÷ séances du mois. Et
--  cette division ne tombe presque jamais juste. Un mois à 4 000 DA sur 3
--  séances vaut 1 333,33 DA la séance, pas 1 333 ; si l'école en garde 2 500,
--  il reste 1 500 DA à l'enseignant, soit 500 DA par séance — mais 214,29 DA
--  dès que le mois compte 7 séances.
--
--  L'application arrondissait CHAQUE division à l'entier. Trois dinars perdus
--  par séance, quatre séances par mois, vingt élèves : l'écart devenait visible
--  sur la paie, et surtout la somme des lignes cessait d'égaler le total
--  affiché — le pire défaut qu'un écran d'argent puisse avoir.
--
--  Côté base, il n'y a heureusement rien à faire : `price_per_session`,
--  `monthly_price`, `school_month_share`, `teacher_per_seance`, `balance`,
--  `amount_deducted`, `amount`… sont toutes des colonnes `numeric`, donc sans
--  perte. La requête ci-dessous ne fait que le VÉRIFIER : elle doit ne rien
--  retourner. Si une ligne apparaît, une colonne d'argent a été passée en
--  `integer` à la main et tronquerait les centimes.
-- -----------------------------------------------------------------------------
select table_name, column_name, data_type
  from information_schema.columns
 where table_schema = 'public'
   and data_type in ('integer', 'bigint', 'smallint')
   and column_name in (
     'price_per_session', 'monthly_price', 'school_month_share', 'teacher_per_seance',
     'level_price', 'balance', 'amount', 'amount_deducted', 'amount_paid', 'net_total',
     'gross_total', 'rest', 'unit_price', 'waived_amount', 'registration_due',
     'registration_fee', 'monthly_amount', 'hourly_rate', 'salary', 'cost',
     'price', 'price_per_student', 'school_per_student', 'total'
   );
--  ^ Aucune ligne attendue. Les montants sont en `numeric` : les centimes
--    passent, et c'est l'application qui décide d'arrondir à deux décimales.


-- -----------------------------------------------------------------------------
--  2. « ÉCOLE SEULEMENT » SE COCHE EMPLOI DU TEMPS PAR EMPLOI DU TEMPS
--
--  Le cas existait déjà, mais il était TOUT OU RIEN : on listait les
--  enseignants qui ne seraient pas payés pour cet élève, et cela valait pour
--  tous leurs cours. Or un même enfant peut suivre trois modules dont un seul
--  relève de cet arrangement — l'école est payée pour celui-là et l'enseignant
--  ne l'est pas, tandis que les deux autres se facturent tout à fait
--  normalement, enseignant compris.
--
--  La liste ci-dessous dit sur QUELS emplois du temps l'option est ACTIVE, très
--  exactement comme `free_subscription_ids` le fait pour la gratuité :
--
--    * emploi ACTIVÉ   : la famille ne verse que la part de l'école, la part de
--      l'enseignant n'est pas due, et l'élève n'apparaît même pas sur l'écran
--      de paie de cet enseignant pour cet emploi (une ligne à 0 DA n'invite
--      qu'à des erreurs de lecture) ;
--    * emploi NON activé : prix plein pour la famille, part enseignant due,
--      élève listé sur la feuille de paie comme n'importe qui d'autre.
--
--  NULL = la fiche d'avant, pilotée par `unpaid_teacher_ids` seul. Les élèves
--  déjà en base ne changent donc pas de comportement d'un iota.
-- -----------------------------------------------------------------------------
alter table public.students
  add column if not exists school_only_subscription_ids jsonb;

comment on column public.students.school_only_subscription_ids is
  'Cas « école seulement », emploi du temps par emploi du temps : les abonnements sur lesquels l''option est ACTIVE (la famille ne verse que la part de l''école, l''enseignant n''est pas payé et l''élève ne figure pas sur sa fiche de paie). NULL = fiche antérieure, pilotée par unpaid_teacher_ids seul.';


-- -----------------------------------------------------------------------------
--  3. LA CLASSE ET L'ANNÉE, RETENUES MÊME SANS EMPLOI DU TEMPS
--
--  On inscrit très souvent un élève avant de lui trouver un créneau : « il est
--  en 4AP, on verra le groupe la semaine prochaine ». La fiche était alors
--  enregistrée sans le moindre abonnement — et l'écran de modification, qui
--  déduisait la classe de la PREMIÈRE inscription, rouvrait sur un
--  primaire/1AP arbitraire. La réception devait retrouver la classe à la main
--  avant de pouvoir choisir l'emploi du temps.
--
--  Ces deux colonnes gardent simplement où la réception en était dans le
--  catalogue : le niveau (« primaire », « lycee », « formation »…) et l'année
--  ou la section (« 4AP », « Grande section »…). L'écran rouvre là, et la liste
--  des créneaux est déjà la bonne.
-- -----------------------------------------------------------------------------
alter table public.students
  add column if not exists enrollment_level text,
  add column if not exists enrollment_year  text;

comment on column public.students.enrollment_level is
  'Niveau choisi dans le catalogue à l''inscription (maternelle, primaire, moyen, lycee, formation). Retenu MÊME sans emploi du temps, pour que l''écran de modification rouvre au bon endroit.';
comment on column public.students.enrollment_year is
  'Année ou section choisie à l''inscription (4AP, 1AS, Grande section…). Voir enrollment_level.';


-- -----------------------------------------------------------------------------
--  4. QUI DOIT LES FRAIS D'INSCRIPTION
--
--  Ils étaient réclamés à TOUS les élèves payants, sans exception possible. En
--  pratique une école les réserve souvent à une partie de ses effectifs : tout
--  le secondaire, trois classes précises, ou seulement les élèves inscrits sur
--  certains créneaux.
--
--  `registration_fee_scope` dit lequel de ces quatre périmètres s'applique, et
--  la liste correspondante dit à qui :
--
--    'all'      : tout le monde (le comportement d'origine, et le défaut) ;
--    'levels'   : registration_fee_levels      — « tout le secondaire » ;
--    'classes'  : registration_fee_class_ids   — des classes nommées ;
--    'sessions' : registration_fee_session_ids — des emplois du temps nommés.
--
--  L'écran « Nouvel élève » interroge exactement ce périmètre : un enfant qui
--  ne coche que des emplois hors périmètre ne se voit rien réclamer, et pour
--  les autres l'écran propose d'encaisser tout de suite OU de créer la fiche
--  avec la dette, qui reste visible jusqu'à son règlement.
--
--  NULL = 'all' : les écoles déjà en base ne changent pas de règle.
-- -----------------------------------------------------------------------------
alter table public.schools
  add column if not exists registration_fee_scope       text,
  add column if not exists registration_fee_levels      jsonb,
  add column if not exists registration_fee_class_ids   jsonb,
  add column if not exists registration_fee_session_ids jsonb;

alter table public.schools
  drop constraint if exists schools_registration_fee_scope_check;

alter table public.schools
  add constraint schools_registration_fee_scope_check
  check (registration_fee_scope is null
         or registration_fee_scope in ('all', 'levels', 'classes', 'sessions'));

comment on column public.schools.registration_fee_scope is
  'Qui doit les frais d''inscription : all (tout le monde, NULL se lit ainsi), levels (les niveaux listés), classes (les classes listées), sessions (les emplois du temps listés).';
comment on column public.schools.registration_fee_levels is
  'Périmètre « levels » : les niveaux concernés (maternelle, primaire, moyen, lycee, formation).';
comment on column public.schools.registration_fee_class_ids is
  'Périmètre « classes » : les classes dont les élèves doivent les frais d''inscription.';
comment on column public.schools.registration_fee_session_ids is
  'Périmètre « sessions » : les emplois du temps dont les élèves doivent les frais d''inscription.';


-- -----------------------------------------------------------------------------
--  5. UN RÈGLEMENT D'ENSEIGNANT SE RELIT, SE CORRIGE ET S'ANNULE
--
--  Trois colonnes, trois manques différents :
--
--  * `arrears` — LES ARRIÉRÉS DÉBLOQUÉS. Le cas se produit tous les mois : au
--    moment de régler le M1, deux élèves n'avaient rien versé ; leur part a
--    donc été retenue et l'enseignant a touché le M1 sans elle. Ils
--    s'acquittent ensuite, et quand vient le tour du M2, ces parts de M1 sont
--    de nouveau dues. Elles n'appartiennent PAS au M2 : elles sont figées ici,
--    avec leur mois d'origine, leurs séances et leur montant, pour que l'écran
--    de paie et la fiche imprimée les montrent dans leur propre tableau. Chaque
--    mois reste ainsi indépendant.
--
--  * `child_debts` — les scolarités d'enfants déjà créditées au guichet et
--    portées sur ce salaire (voir `teacher_child_debts`), retenues par ce
--    règlement. L'application les écrivait déjà ; la colonne manquait, si bien
--    qu'elles disparaissaient de la fiche réimprimée.
--
--  * `cash_id` — le mouvement de caisse que le règlement a écrit. Sans lui,
--    corriger un montant laissait la caisse sur l'ancien, et annuler un
--    règlement laissait la sortie d'argent orpheline.
-- -----------------------------------------------------------------------------
alter table public.teacher_payments
  add column if not exists arrears     jsonb,
  add column if not exists child_debts jsonb,
  add column if not exists cash_id     text;

comment on column public.teacher_payments.arrears is
  'Arriérés débloqués réglés par ce versement : parts d''un mois DÉJÀ payé, retenues à l''époque parce que l''élève n''avait pas payé, libérées depuis. Figées avec leur mois d''origine pour ne jamais se confondre avec le mois courant.';
comment on column public.teacher_payments.child_debts is
  'Scolarités d''enfants déjà créditées au guichet et portées sur ce salaire (teacher_child_debts), retenues par ce règlement : elles ne reviennent jamais sur le suivant.';
comment on column public.teacher_payments.cash_id is
  'Le mouvement de caisse écrit par ce règlement. Corriger le net le suit, annuler le règlement le supprime.';


-- -----------------------------------------------------------------------------
--  6. QUELLE PAIE A SOLDÉ CETTE PART D'ENSEIGNANT
--
--  `unpaid_teacher_sessions.paid` disait qu'une part avait été réglée, mais pas
--  PAR QUOI. Annuler un règlement ne pouvait donc rien rouvrir : on ne savait
--  pas quelles présences il avait soldées.
--
--  La colonne est renseignée à partir de maintenant. Les lignes déjà payées
--  restent à NULL : elles appartiennent à des règlements antérieurs, qu'on
--  n'annule pas rétroactivement — et c'est très bien ainsi.
-- -----------------------------------------------------------------------------
alter table public.unpaid_teacher_sessions
  add column if not exists payment_id text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'unpaid_teacher_sessions_payment_id_fkey'
  ) then
    alter table public.unpaid_teacher_sessions
      add constraint unpaid_teacher_sessions_payment_id_fkey
      foreign key (payment_id) references public.teacher_payments (id) on delete set null;
  end if;
end $$;

comment on column public.unpaid_teacher_sessions.payment_id is
  'Le règlement qui a soldé cette part. Annuler ce règlement la rend à nouveau due. NULL sur les lignes soldées avant cette mise à jour.';


-- -----------------------------------------------------------------------------
--  7. UN EMPLOI DU TEMPS PEUT RÉUNIR PLUSIEURS GROUPES
--
--  Deux demi-groupes suivent souvent le même cours, à la même heure, dans la
--  même salle, avec le même enseignant. C'est UN emploi du temps, pas deux : le
--  dédoubler oblige à tout saisir en double et fait diverger les tarifs.
--
--  `group_ids` porte la liste complète et `group_id` — la colonne historique —
--  garde le PREMIER groupe, si bien que le scan, la feuille de présence et tout
--  ce qui ne lit qu'un groupe continuent de fonctionner sans rien savoir de la
--  nouveauté. La colonne existe déjà (elle servait aux séances libres) ; ce
--  bloc s'assure simplement qu'elle est là et documente son nouvel usage.
-- -----------------------------------------------------------------------------
alter table public.schedule_sessions
  add column if not exists group_ids jsonb;

comment on column public.schedule_sessions.group_ids is
  'Tous les groupes réunis par cet emploi du temps. group_id garde le PREMIER (colonne historique lue par le scan et la feuille de présence). Vide/NULL = un seul groupe, celui de group_id.';


-- -----------------------------------------------------------------------------
--  Ce que ce script NE change PAS
-- -----------------------------------------------------------------------------
--  * Aucune donnée existante n'est réécrite. Toutes les colonnes ajoutées sont
--    facultatives, et leur absence garde exactement le sens d'aujourd'hui :
--    « école seulement » reste piloté par la liste d'enseignants, les frais
--    d'inscription restent dus par tout le monde, un emploi du temps reste à un
--    seul groupe.
--  * Les mois (M1, M2 …) restent PROPRES à chaque emploi du temps et continuent
--    de se déduire des présences : rien n'est stocké de plus.
--  * La règle qui retient la part de l'enseignant tant qu'un élève doit de
--    l'argent est inchangée. Ce qui change, c'est qu'une fois l'élève à jour, la
--    part revient dans SA PROPRE TABLE — l'arriéré — au lieu de gonfler le mois
--    en cours.
-- -----------------------------------------------------------------------------


-- -----------------------------------------------------------------------------
--  Vérification — à lire dans la sortie du SQL Editor
-- -----------------------------------------------------------------------------
select
  (select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'students'
       and column_name = 'school_only_subscription_ids')      as col_ecole_seule_par_emploi_ok,   -- 1 attendue
  (select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'students'
       and column_name in ('enrollment_level', 'enrollment_year')) as col_classe_annee_retenues_ok, -- 2 attendues
  (select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'schools'
       and column_name like 'registration_fee%')              as col_frais_inscription_ok,       -- 5 attendues
  (select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'teacher_payments'
       and column_name in ('arrears', 'child_debts', 'cash_id')) as col_paie_enseignant_ok,      -- 3 attendues
  (select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'unpaid_teacher_sessions'
       and column_name = 'payment_id')                        as col_part_soldee_par_ok,         -- 1 attendue
  (select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'schedule_sessions'
       and column_name = 'group_ids')                         as col_groupes_multiples_ok,       -- 1 attendue
  (select count(*) from public.students
     where student_case = 'school_only')                      as eleves_ecole_seule,
  (select count(*) from public.schedule_sessions
     where group_ids is not null
       and jsonb_array_length(group_ids) > 1)                  as emplois_a_plusieurs_groupes,
  (select count(*) from public.teacher_payments)              as reglements_enseignants;

-- La contrainte du périmètre des frais est-elle bien en place ?
select conname, pg_get_constraintdef(oid) as definition
  from pg_constraint
 where conname = 'schools_registration_fee_scope_check';

-- Les tarifs qui ne tombent pas juste : ce que les décimales changent.
-- (Chaque ligne montre le prix d'une séance AVANT arrondi entier et APRÈS.)
select
  s.id,
  s.monthly_seances                                              as seances_du_mois,
  s.monthly_price                                                as prix_du_mois,
  round(s.monthly_price / nullif(s.monthly_seances, 0), 2)       as seance_au_centime,
  round(s.monthly_price / nullif(s.monthly_seances, 0))          as seance_arrondie_avant,
  round(coalesce(s.school_month_share, s.monthly_price)
        / nullif(s.monthly_seances, 0), 2)                       as part_ecole_au_centime,
  round((s.monthly_price - coalesce(s.school_month_share, s.monthly_price))
        / nullif(s.monthly_seances, 0), 2)                       as part_enseignant_au_centime
  from public.subscriptions s
 where coalesce(s.monthly_seances, 0) > 0
   and s.monthly_price is not null
   and (s.monthly_price % s.monthly_seances) <> 0
 order by s.id;
