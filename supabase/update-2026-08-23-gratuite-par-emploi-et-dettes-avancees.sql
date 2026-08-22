-- =============================================================================
--  MISE À JOUR — Gratuité emploi par emploi, paiement d'un fils d'enseignant
--                AVANT la paie du père, et dettes d'élèves avancées par l'école
--  Projet : https://jehpfbupmhbnbbkzhiwr.supabase.co
--
--  À exécuter TEL QUEL dans le SQL Editor de Supabase, UNE SEULE FOIS.
--  Le script est IDEMPOTENT : le relancer ne casse rien et ne modifie aucune
--  donnée existante. Il n'ajoute que des colonnes facultatives et élargit une
--  contrainte — rien n'est supprimé, rien n'est réécrit.
--
--  Ce qu'il change
--  ---------------
--   1. `students.free_subscription_ids` (jsonb) — un « cas spécial (gratuit) »
--      choisit désormais QUELS emplois du temps lui sont offerts.
--   2. `payments.paid_from` (text) — d'où vient l'argent d'un versement :
--      la famille, le salaire d'un enseignant père, ou la caisse de l'école.
--   3. `cash_transactions.type` accepte `student_debt` — la sortie de caisse
--      qui finance une dette d'élève avancée par l'école.
-- =============================================================================


-- -----------------------------------------------------------------------------
--  1. La gratuité se coche EMPLOI DU TEMPS PAR EMPLOI DU TEMPS
--
--  Un « cas spécial » n'est plus tout-ou-rien. La réception coche l'élève en cas
--  spécial, puis, pour CHAQUE emploi du temps qu'il suit, laisse la case
--  « Offert » cochée (l'élève ne paie rien, et l'enseignant n'est pas payé pour
--  ses séances) ou la décoche (l'emploi redevient payant, exactement comme pour
--  n'importe quel élève : l'école encaisse et l'enseignant touche sa part).
--
--      ["sub-anglais-a", "sub-maths-b"]
--
--  COLONNE NULLE = TOUTE LA SCOLARITÉ EST OFFERTE. C'est ainsi que le cas se
--  lisait avant d'être détaillé : les fiches déjà en base gardent donc très
--  exactement le comportement qu'elles avaient, sans aucune reprise de données.
--  La liste n'est écrite que le jour où la réception rouvre la fiche.
-- -----------------------------------------------------------------------------
alter table public.students
  add column if not exists free_subscription_ids jsonb;

comment on column public.students.free_subscription_ids is
  'Cas spécial : les abonnements OFFERTS, ex. ["sub-1","sub-2"]. NULL = toute la scolarité est offerte (comportement historique). Un emploi absent de la liste est facturé normalement — école ET part enseignant.';


-- -----------------------------------------------------------------------------
--  2. D'OÙ vient l'argent d'un versement
--
--  Trois provenances, et elles ne se lisent pas de la même façon dans la caisse :
--
--   * `cash` (ou NULL, la valeur historique) — la famille a payé au guichet :
--     une entrée dans la caisse, comme toujours.
--
--   * `teacher_salary` — la scolarité d'un « fils d'enseignant » a été retenue
--     sur le salaire de son père : AUCUN mouvement de caisse, l'école est payée
--     en versant simplement moins à l'enseignant.
--
--   * `school_cash` — l'école a AVANCÉ la dette de l'élève sur sa propre caisse,
--     pour ne pas faire attendre l'enseignant. La caisse porte alors DEUX
--     mouvements : le paiement porté au crédit de l'élève (`student_payment`) et
--     la sortie qui l'a financé (`student_debt`, point 3). Les deux s'annulent,
--     si bien que le solde de la caisse ne bouge que du jour où l'enseignant est
--     réglé — et l'historique montre noir sur blanc que l'école a avancé.
--
--  C'est cette colonne qui permet à l'écran de paie de distinguer un mois qu'un
--  fils d'enseignant a réglé LUI-MÊME, avant la paie de son père, d'un mois
--  retenu sur le salaire. Un mois déjà payé par la famille reste affiché, avec
--  son propre statut, mais n'est plus retenu : le retenir une seconde fois
--  ferait payer la scolarité deux fois.
-- -----------------------------------------------------------------------------
alter table public.payments
  add column if not exists paid_from text;

do $$
begin
  -- La contrainte est (re)posée à l'identique : relancer le script ne double
  -- jamais une règle et n'échoue pas si elle est déjà là.
  alter table public.payments drop constraint if exists payments_paid_from_check;
  alter table public.payments
    add constraint payments_paid_from_check
    check (paid_from is null or paid_from in ('cash','teacher_salary','school_cash'));
end $$;

comment on column public.payments.paid_from is
  'Provenance de l''argent : cash = la famille au guichet (NULL se lit ainsi), teacher_salary = retenu sur la paie du père (aucun mouvement de caisse), school_cash = dette avancée par la caisse de l''école';


-- -----------------------------------------------------------------------------
--  3. La caisse enregistre les dettes avancées par l'école
--
--  Un nouveau type de mouvement, `student_debt` : la SORTIE de caisse qui
--  finance la dette d'un élève que l'école a décidé de couvrir. Elle est
--  toujours négative et va toujours par paire avec le `student_payment` du même
--  montant porté au crédit de l'élève.
--
--  Pourquoi les deux ? Parce que l'école n'a jamais reçu cet argent de la
--  famille : si l'on ne notait que l'entrée, la caisse paraîtrait s'enrichir
--  d'un versement qui n'a pas eu lieu ; si l'on ne notait que la sortie, elle
--  paraîtrait perdre une somme qu'elle n'a pas réellement décaissée. Les deux
--  écrites ensemble, le solde reste juste — seul le règlement de l'enseignant
--  le fait bouger — et l'écran Caisse affiche les deux lignes, ce qui est
--  précisément ce qu'on veut pouvoir relire six mois plus tard.
-- -----------------------------------------------------------------------------
do $$
begin
  alter table public.cash_transactions drop constraint if exists cash_transactions_type_check;
  alter table public.cash_transactions
    add constraint cash_transactions_type_check
    check (type in (
      'deposit','withdraw','expense','student_payment','teacher_payment',
      'acompte','student_debt'
    ));
end $$;

comment on column public.cash_transactions.type is
  'deposit / withdraw (manuels), expense (dépense école), student_payment (versement d''un élève), teacher_payment, acompte, student_debt (sortie qui finance une dette d''élève avancée par l''école — toujours appariée au student_payment du même montant)';


-- -----------------------------------------------------------------------------
--  4. Ce qui NE change PAS — et n'a donc besoin d'aucune colonne
--
--  * Le blocage de la part de l'enseignant tant qu'un élève doit de l'argent se
--    calcule toujours à partir de `unpaid_teacher_sessions`, `payments`,
--    `enrollments` et `students.registration_due`. Le nouveau bouton
--    « Payer de la caisse » ne fait que solder cette dette-là : dès qu'elle est
--    à zéro, la part redevient payable, exactement comme si la famille avait
--    payé elle-même.
--  * Les mois (M1, M2 …) restent PROPRES à chaque emploi du temps et se
--    déduisent des présences ; rien n'est stocké de plus.
--  * Les autres cas d'élèves (`reduction`, `school_only`, `teacher_child`) sont
--    inchangés : mêmes colonnes, mêmes montants.
--
--  ATTENTION, un seul changement de MONTANT dans cette mise à jour, et il ne
--  touche que les élèves créés APRÈS : un « cas spécial » dont au moins un
--  emploi du temps reste payant doit désormais les frais d'inscription, alors
--  qu'un cas spécial en devait zéro. Les fiches existantes ne sont pas touchées
--  (leur `registration_due` n'est pas recalculé), et les présences déjà
--  enregistrées gardent le montant qu'elles portent.
-- -----------------------------------------------------------------------------


-- -----------------------------------------------------------------------------
--  Vérification — à lire dans la sortie du SQL Editor
-- -----------------------------------------------------------------------------
select
  (select count(*) from information_schema.columns
     where table_schema = 'public'
       and table_name = 'students'
       and column_name = 'free_subscription_ids')            as colonne_gratuite_par_emploi_ok,  -- 1 attendue
  (select count(*) from information_schema.columns
     where table_schema = 'public'
       and table_name = 'payments'
       and column_name = 'paid_from')                        as colonne_paid_from_ok,            -- 1 attendue
  (select count(*) from pg_constraint
     where conname = 'cash_transactions_type_check')         as contrainte_caisse_ok,            -- 1 attendue
  (select count(*) from public.students
     where student_case = 'special')                         as eleves_cas_special,
  (select count(*) from public.students
     where student_case = 'special'
       and free_subscription_ids is null)                    as cas_speciaux_entierement_offerts,
  (select count(*) from public.students
     where student_case = 'teacher_child')                   as enfants_d_enseignants,
  (select count(*) from public.unpaid_teacher_sessions
     where paid = false)                                     as parts_enseignant_ouvertes;

-- Le nouveau type de mouvement est-il bien accepté ?
select conname, pg_get_constraintdef(oid) as definition
  from pg_constraint
 where conname in ('cash_transactions_type_check', 'payments_paid_from_check')
 order by conname;
