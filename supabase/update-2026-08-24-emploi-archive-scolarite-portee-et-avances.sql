-- =============================================================================
--  MISE À JOUR — Emploi du temps supprimé mais CONSERVÉ dans l'historique,
--                scolarité d'un fils d'enseignant PORTÉE sur le salaire du père,
--                et avances d'inscription lisibles dans la caisse
--  Projet : https://jehpfbupmhbnbbkzhiwr.supabase.co
--
--  À exécuter TEL QUEL dans le SQL Editor de Supabase, UNE SEULE FOIS.
--  Le script est IDEMPOTENT : le relancer ne casse rien et ne modifie aucune
--  donnée existante. Il n'ajoute que des colonnes facultatives et une table,
--  et élargit une contrainte — rien n'est supprimé, rien n'est réécrit.
--
--  Ce qu'il change
--  ---------------
--   1. `schedule_sessions.archived_at` — supprimer un emploi du temps
--      l'ARCHIVE désormais : sa ligne reste, donc les présences, les paiements
--      et les parts d'enseignant qu'il porte restent nommés dans l'historique.
--   2. `subscriptions.archived_at` — le tarif est archivé avec son emploi (ou
--      seul, quand on retire le tarif d'un cours), pour la même raison : un
--      tarif effacé emporte les inscriptions, et avec elles les SOLDES.
--   3. `payments.paid_from` accepte `teacher_debt` — la scolarité d'un fils
--      d'enseignant réglée d'avance au guichet et portée sur le salaire du père.
--   4. Nouvelle table `teacher_child_debts` — ces scolarités portées, en
--      attente d'être retenues sur le prochain règlement du père, une fois.
--
--  Rien à faire côté données : sans `archived_at`, tout emploi du temps déjà en
--  base est vivant, ce qui est exactement son état actuel.
-- =============================================================================


-- -----------------------------------------------------------------------------
--  1. UN EMPLOI DU TEMPS SUPPRIMÉ N'EST PLUS EFFACÉ, IL EST ARCHIVÉ
--
--  Le problème que cela règle est simple à énoncer et coûteux à découvrir trop
--  tard : `subscriptions.session_id` casse en cascade sur `schedule_sessions`,
--  et `enrollments.subscription_id` casse en cascade sur `subscriptions`.
--  Effacer une ligne d'emploi du temps emportait donc, sans un mot :
--
--      schedule_sessions -> subscriptions -> enrollments (LES SOLDES)
--
--  Les présences (`attendance_records.session_id`) et les paiements
--  (`payments.subscription_id`) survivaient, eux, faute de clé étrangère — mais
--  ORPHELINS : plus de module, plus de groupe, plus de salle à afficher. Un
--  historique de paiements se lisait alors « — · — · 4 000 DA », ce qui ne vaut
--  guère mieux que rien.
--
--  Désormais, la réception « supprime » et l'application écrit simplement la
--  date ici. L'emploi disparaît de la grille, de la feuille de présence et du
--  catalogue d'inscription — les écrans qui servent à organiser demain — et
--  reste entier partout où l'on relit hier. Ses élèves en sont désinscrits à la
--  date du jour, exactement comme une désinscription ordinaire : leur fiche
--  garde le module, ses présences, ses paiements et son solde.
-- -----------------------------------------------------------------------------
alter table public.schedule_sessions
  add column if not exists archived_at text;

comment on column public.schedule_sessions.archived_at is
  'Jour de suppression (YYYY-MM-DD). NULL = emploi du temps vivant. Archivé, il quitte la grille, la feuille de présence et le catalogue d''inscription, mais sa ligne reste pour que présences, paiements et parts d''enseignant gardent un nom dans l''historique.';


-- -----------------------------------------------------------------------------
--  2. LE TARIF SUIT SON EMPLOI DU TEMPS — ou s'archive seul
--
--  Deux chemins mènent ici :
--   * l'emploi du temps est supprimé : son tarif est archivé avec lui ;
--   * la réception retire le tarif d'un cours (écran Abonnements) : le tarif
--     s'archive seul, l'emploi du temps continue d'exister sans prix.
--
--  Dans les deux cas la ligne SURVIT, et c'est tout l'intérêt : `enrollments`
--  cascade sur elle, donc l'effacer effacerait les soldes de tous les élèves du
--  cours, y compris ceux qui sont en dette. Redéfinir le tarif du cours plus
--  tard remet simplement `archived_at` à NULL.
-- -----------------------------------------------------------------------------
alter table public.subscriptions
  add column if not exists archived_at text;

comment on column public.subscriptions.archived_at is
  'Jour de retrait du tarif (YYYY-MM-DD). NULL = tarif en service. Archivé plutôt qu''effacé : enrollments cascade sur cette ligne, donc l''effacer effacerait les SOLDES des élèves du cours.';


-- -----------------------------------------------------------------------------
--  3. UNE QUATRIÈME PROVENANCE POUR L'ARGENT D'UN VERSEMENT : `teacher_debt`
--
--  Un fils d'enseignant n'a pas à attendre la paie de son père pour être en
--  règle, et la réception n'a pas à ouvrir un écran de règlement pour l'y
--  mettre. Depuis la feuille de présence du groupe, elle solde son mois et
--  choisit d'où vient l'argent :
--
--   * `cash` — LA FAMILLE PAIE MAINTENANT. Versement d'élève ordinaire : une
--     entrée en caisse, et le salaire du père n'est PAS amputé. L'écran de paie
--     affiche le mois « payé par la famille », pour que personne ne le retienne
--     une seconde fois.
--
--   * `teacher_debt` — À PORTER SUR LE SALAIRE DU PÈRE. Le solde de l'enfant est
--     crédité tout de suite (donc ses mois sortent du rouge, et la part que ses
--     séances rapportent à l'enseignant se débloque), AUCUN mouvement de caisse
--     n'est écrit — l'école n'a rien reçu — et le montant part en attente dans
--     `teacher_child_debts`. Le prochain règlement du père le retient sur son
--     net : l'école est payée en versant moins, comme pour `teacher_salary`.
--
--  La différence avec `teacher_salary` tient en un mot : le MOMENT. Avec
--  `teacher_salary`, l'enfant est soldé PENDANT la paie du père, les deux
--  écritures étant simultanées. Avec `teacher_debt`, l'enfant est soldé
--  AUJOURD'HUI et le père paiera le jour de sa paie — d'où la table du point 4,
--  qui porte la promesse entre les deux dates.
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
    check (paid_from is null or paid_from in
           ('cash','teacher_salary','teacher_debt','school_cash'));
end $$;

comment on column public.payments.paid_from is
  'Provenance de l''argent : cash = la famille au guichet (NULL se lit ainsi), teacher_salary = retenu PENDANT la paie du père, teacher_debt = crédité d''avance et porté sur sa PROCHAINE paie (voir teacher_child_debts), school_cash = dette avancée par la caisse de l''école';


-- -----------------------------------------------------------------------------
--  4. LES SCOLARITÉS PORTÉES SUR LE SALAIRE D'UN PÈRE
--
--  Une ligne par mois d'enfant réglé d'avance au guichet et mis à la charge de
--  son père. Elle vit exactement le temps qui sépare les deux gestes :
--
--      jour J  : la réception solde le mois de l'enfant  -> la ligne naît
--      paie du père : le règlement la retient sur son net -> paid = true
--
--  Le drapeau `paid` est ce qui garantit qu'elle n'est retenue QU'UNE FOIS : un
--  règlement ne lit que les lignes ouvertes, et les marque au passage avec son
--  propre `payment_id`. La fiche de paie l'imprime comme une retenue ordinaire,
--  au même titre qu'une dépense avancée par l'école.
--
--  À ne pas confondre avec ce que l'écran de paie appelle « ses enfants » : là,
--  on décide de retenir ce qui est ENCORE DÛ. Ici, on honore ce qui a DÉJÀ été
--  crédité à l'enfant en le promettant à ce salaire. Les deux ne peuvent pas se
--  chevaucher, puisqu'un mois crédité n'est plus dû.
-- -----------------------------------------------------------------------------
create table if not exists public.teacher_child_debts (
  id              text primary key,
  teacher_id      text not null references public.teachers (id) on delete cascade,
  student_id      text not null references public.students (id) on delete cascade,
  subscription_id text,                          -- l'emploi du temps crédité
  month_code      text,                          -- le mois de cet emploi (M1, M2 …)
  label           text not null default '',      -- ce que la fiche de paie affiche
  amount          numeric not null default 0,
  date            text not null default '',
  paid            boolean not null default false,
  payment_id      text references public.teacher_payments (id) on delete set null,
  created_at      text
);

create index if not exists teacher_child_debts_open_key
  on public.teacher_child_debts (teacher_id) where paid = false;

comment on table public.teacher_child_debts is
  'Scolarités d''enfants réglées d''avance au guichet et portées sur le salaire de leur père enseignant. paid = false tant que la retenue n''a pas été prise sur un règlement ; paid = true + payment_id une fois prise, ce qui interdit de la retenir deux fois.';

-- Row Level Security : exactement la règle des autres tables du personnel —
-- lecture pour tout compte connecté (les portails recalculent leurs vues à
-- partir de la base complète), écriture réservée à l'administration et à la
-- réception. Les policies sont reposées à l'identique, donc relancer le script
-- ne les double pas.
alter table public.teacher_child_debts enable row level security;

drop policy if exists teacher_child_debts_read  on public.teacher_child_debts;
drop policy if exists teacher_child_debts_write on public.teacher_child_debts;

create policy teacher_child_debts_read on public.teacher_child_debts
  for select to authenticated using (true);

create policy teacher_child_debts_write on public.teacher_child_debts
  for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());


-- -----------------------------------------------------------------------------
--  5. Ce qui NE change PAS — et n'a donc besoin d'aucune colonne
--
--  * L'AVANCE versée à l'inscription n'est pas un objet nouveau : c'est un
--    `payments` ordinaire (`paid_from = 'cash'`), écrit sur l'emploi du temps et
--    sur le mois où l'élève ENTRE. Le reçu d'avance proposé après la création,
--    et l'historique des paiements de l'écran Caisse, ne font que LIRE ces
--    lignes-là — jointes aux élèves et aux emplois du temps. Aucune écriture
--    supplémentaire, donc aucune colonne.
--  * Le RETRAIT d'une présence depuis la feuille de présence supprime la ligne
--    `attendance_records` et recrédite `enrollments.balance` : deux tables déjà
--    en place, aucune trace nouvelle à stocker.
--  * Les mois (M1, M2 …) restent PROPRES à chaque emploi du temps et se
--    déduisent des présences.
--  * Le blocage de la part de l'enseignant tant qu'un élève doit de l'argent est
--    inchangé. « Payer de la caisse » permet simplement, désormais, de choisir
--    les mois et de corriger les montants : un règlement PARTIEL laisse la part
--    retenue, puisque la dette n'est pas à zéro — l'écran le dit avant de valider.
-- -----------------------------------------------------------------------------


-- -----------------------------------------------------------------------------
--  Vérification — à lire dans la sortie du SQL Editor
-- -----------------------------------------------------------------------------
select
  (select count(*) from information_schema.columns
     where table_schema = 'public'
       and table_name = 'schedule_sessions'
       and column_name = 'archived_at')                     as colonne_emploi_archive_ok,   -- 1 attendue
  (select count(*) from information_schema.columns
     where table_schema = 'public'
       and table_name = 'subscriptions'
       and column_name = 'archived_at')                     as colonne_tarif_archive_ok,    -- 1 attendue
  (select count(*) from information_schema.tables
     where table_schema = 'public'
       and table_name = 'teacher_child_debts')              as table_scolarites_portees_ok, -- 1 attendue
  (select count(*) from public.schedule_sessions
     where archived_at is null)                             as emplois_du_temps_vivants,
  (select count(*) from public.schedule_sessions
     where archived_at is not null)                         as emplois_du_temps_archives,
  (select count(*) from public.students
     where student_case = 'teacher_child')                  as enfants_d_enseignants,
  (select coalesce(sum(amount), 0) from public.teacher_child_debts
     where paid = false)                                    as scolarites_en_attente_de_retenue;

-- Les deux contraintes élargies sont-elles bien en place ?
select conname, pg_get_constraintdef(oid) as definition
  from pg_constraint
 where conname in ('payments_paid_from_check', 'cash_transactions_type_check')
 order by conname;
