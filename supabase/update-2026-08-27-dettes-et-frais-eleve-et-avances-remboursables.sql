-- =============================================================================
--  MISE À JOUR — DETTES & FRAIS DIVERS D'UN ÉLÈVE,
--                et les AVANCES DE L'ÉCOLE enfin remboursables
--  Projet : https://jehpfbupmhbnbbkzhiwr.supabase.co
--
--  À exécuter TEL QUEL dans le SQL Editor de Supabase, UNE SEULE FOIS.
--  Le script est IDEMPOTENT : le relancer ne casse rien et ne compte jamais
--  deux fois la même avance. Il n'AJOUTE que des choses — une table, une
--  colonne facultative, deux index, une policy. Rien n'est supprimé, aucune
--  contrainte n'est resserrée, aucune ligne existante n'est réécrite.
--
--  Ce qu'il change
--  ---------------
--   1. `student_charges`      — LA TABLE DES FRAIS : tout ce qu'un élève doit à
--                               l'école SANS que ce soit de la scolarité.
--   2. `payments.charge_id`   — le frais qu'un versement règle, quand c'en est
--                               un. C'est ce qui fait apparaître le règlement
--                               dans l'historique de l'élève, comme n'importe
--                               quel autre mouvement.
--   3. Reprise des avances    — chaque dette déjà couverte par la caisse de
--                               l'école reçoit son frais à rembourser. Sans
--                               cette reprise, les avances d'avant aujourd'hui
--                               resteraient affichées sans jamais pouvoir être
--                               encaissées.
--
--  LE PROBLÈME QUE ÇA RÈGLE
--  ------------------------
--  Une famille ne doit pas que des séances. Elle doit un livre, une tenue de
--  sport, une sortie, un transport, une vitre cassée — et la réception n'avait
--  nulle part où l'écrire. Ces sommes-là finissaient sur un carnet, ou dans la
--  description d'un paiement, où aucune alerte ne les retrouvait le jour où
--  l'élève repassait au comptoir.
--
--  Pire : quand l'école réglait une dette de scolarité DE SA PROPRE CAISSE pour
--  ne pas faire attendre un enseignant, la dette disparaissait de toutes les
--  fiches à la seconde même. L'élève était « à jour », l'enseignant était payé…
--  et l'argent sorti du tiroir n'était plus réclamé à personne.
--
--  Désormais : le frais vit dans sa propre table, il alerte partout où l'élève
--  apparaît (sa fiche, l'écran « Payer & recharger », la feuille de présence de
--  ses groupes), et il s'encaisse EN UNE OU PLUSIEURS FOIS depuis chacun de ces
--  écrans, à la date que la réception choisit.
--
--  CE QU'UN FRAIS NE FAIT PAS — et c'est volontaire
--  -----------------------------------------------
--  Il ne retient PAS la paie d'un enseignant. Seule la scolarité le fait : les
--  soldes dans le rouge, les restes d'anciens paiements et les frais
--  d'inscription. Un livre impayé ne regarde pas le professeur de
--  mathématiques, et une avance faite POUR débloquer sa part ne peut évidemment
--  pas la rebloquer en devenant un frais.
--
--  C'est pourquoi un règlement de frais porte toujours `rest = 0` : ce qui
--  reste dû vit sur le frais lui-même (`amount − paid_amount`), jamais sur le
--  versement, où il se lirait comme une scolarité impayée.
-- =============================================================================


-- -----------------------------------------------------------------------------
--  1. LA TABLE DES FRAIS
--
--  Trois champs suffisent à en créer un — un nom, un montant, une date — parce
--  que c'est exactement ce que la réception sait au moment où elle le saisit.
--  La description est facultative : « Livre de mathématiques » se suffit à
--  lui-même.
--
--  `paid_amount` cumule ce qui a été versé dessus, et `amount − paid_amount`
--  est ce qui reste dû. Un versement partiel est le cas NORMAL, pas
--  l'exception : la famille donne ce qu'elle a, le frais reste ouvert pour la
--  différence, et l'alerte continue de le dire.
--
--  DEUX ORIGINES, et la différence se lit à l'écran :
--    * `manual`         — la réception l'a saisi (livre, tenue, sortie…) ;
--    * `school_advance` — l'école a réglé une dette de SCOLARITÉ de sa propre
--                         caisse. La scolarité est soldée, la part de
--                         l'enseignant se débloque, mais l'argent est sorti sans
--                         jamais entrer : la FAMILLE le doit maintenant à
--                         l'école. `source_payment_id` pointe le versement qui
--                         l'a fait naître, `subscription_id` et `month_code`
--                         disent ce qui a été couvert.
--
--  La clé étrangère est `on delete cascade` : un élève effacé emporte ses frais.
-- -----------------------------------------------------------------------------
create table if not exists public.student_charges (
  id                text primary key,
  student_id        text not null references public.students (id) on delete cascade,
  name              text not null default '',
  amount            numeric not null default 0,
  description       text,
  date              text not null default '',      -- YYYY-MM-DD : le jour du frais
  origin            text not null default 'manual'
                      check (origin in ('manual','school_advance')),
  source_payment_id text,                          -- avance : le versement d'origine
  subscription_id   text,                          -- avance : l'emploi du temps couvert
  month_code        text,                          -- avance : le mois couvert
  paid_amount       numeric not null default 0,    -- ce qui a DÉJÀ été versé dessus
  paid              boolean not null default false,
  payment_id        text,                          -- le dernier versement qui l'a soldé
  created_at        text
);

comment on table public.student_charges is
  'Dettes d''un élève HORS scolarité : livres, tenues, sorties, dégâts, et les avances de l''école. Réglables en plusieurs fois ; ne retiennent jamais la paie d''un enseignant.';

comment on column public.student_charges.origin is
  '`manual` = saisi par la réception ; `school_advance` = dette de scolarité réglée par la caisse de l''école et que la famille lui doit désormais.';

comment on column public.student_charges.paid_amount is
  'Ce qui a déjà été versé sur ce frais, tous versements confondus. Ce qui reste dû = amount − paid_amount.';

-- Le script peut être relancé sur une base où la table existe déjà mais dans
-- une version plus ancienne : les colonnes sont donc (re)demandées une à une.
alter table public.student_charges
  add column if not exists description       text,
  add column if not exists origin            text not null default 'manual',
  add column if not exists source_payment_id text,
  add column if not exists subscription_id   text,
  add column if not exists month_code        text,
  add column if not exists paid_amount       numeric not null default 0,
  add column if not exists paid              boolean not null default false,
  add column if not exists payment_id        text,
  add column if not exists created_at        text;


-- -----------------------------------------------------------------------------
--  2. LE VERSEMENT SAIT QUEL FRAIS IL RÈGLE
--
--  `charge_id` est FACULTATIF : un achat de séances n'en a pas, et les millions
--  de lignes déjà en base se lisent exactement comme avant.
--
--  Il n'y a VOLONTAIREMENT pas de clé étrangère ici. `student_charges` pointe
--  déjà `payments` (source_payment_id, payment_id) : ajouter la contrainte en
--  sens inverse rendrait les deux tables mutuellement dépendantes, et la
--  suppression d'un élève — qui doit effacer les deux — tomberait sur un cycle.
--  L'application efface les règlements en même temps que le frais.
-- -----------------------------------------------------------------------------
alter table public.payments
  add column if not exists charge_id text;

comment on column public.payments.charge_id is
  'Le frais (student_charges) que ce versement règle. Un tel versement ne porte ni emploi du temps ni mois, et son `rest` reste à 0 : ce qui demeure dû se lit sur le frais.';


-- -----------------------------------------------------------------------------
--  3. INDEX
--
--  Les trois questions que l'application pose vingt fois par écran : « que doit
--  cet élève ? », « quelles avances restent à récupérer ? » et « quels
--  versements ont réglé ce frais ? ».
-- -----------------------------------------------------------------------------
create index if not exists idx_student_charges_student on public.student_charges (student_id, paid);
create index if not exists idx_student_charges_origin  on public.student_charges (origin, paid);
create index if not exists idx_payments_charge         on public.payments (charge_id);


-- -----------------------------------------------------------------------------
--  4. RLS — la même règle que les autres tables d'argent
--
--  Lecture pour tout compte connecté (les portails élève et parent recalculent
--  leurs vues à partir de la base complète, et une famille a le droit de savoir
--  ce qu'elle doit) ; écriture réservée au personnel.
-- -----------------------------------------------------------------------------
alter table public.student_charges enable row level security;

drop policy if exists student_charges_read  on public.student_charges;
drop policy if exists student_charges_write on public.student_charges;

create policy student_charges_read on public.student_charges
  for select to authenticated
  using (true);

create policy student_charges_write on public.student_charges
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());


-- -----------------------------------------------------------------------------
--  5. REPRISE DES AVANCES DÉJÀ FAITES
--
--  Chaque dette que l'école a couverte de sa caisse a laissé un versement
--  `paid_from = 'school_cash'` — et rien d'autre. L'écran des élèves les
--  affichait, mais sans moyen de les encaisser : il n'existait aucune ligne à
--  créditer.
--
--  On leur crée donc leur frais, un par versement, avec :
--    * le NOM déjà écrit dans la description du versement, qui dit exactement
--      ce qui a été couvert (« Dette avancée par l'école — Maths (M2) ») ;
--    * la DATE du versement, pas celle d'aujourd'hui : l'avance a été faite ce
--      jour-là, et l'ancienneté d'une dette est une information ;
--    * `paid_amount = 0`, parce que personne n'a encore remboursé quoi que ce
--      soit — s'il en avait été autrement, il y aurait eu une trace.
--
--  `where not exists` rend la reprise REJOUABLE : relancer le script ne crée
--  jamais un second frais pour la même avance.
-- -----------------------------------------------------------------------------
insert into public.student_charges (
  id, student_id, name, amount, description, date, origin,
  source_payment_id, subscription_id, month_code, paid_amount, paid, created_at
)
select
  'chg-hist-' || p.id                                            as id,
  p.student_id,
  coalesce(nullif(trim(p.description), ''), 'Dette avancée par l''école') as name,
  p.amount_paid                                                  as amount,
  'Réglé par la caisse de l''école pour débloquer la part de l''enseignant : la famille doit cette somme à l''école.' as description,
  substr(coalesce(p.date, ''), 1, 10)                            as date,
  'school_advance'                                               as origin,
  p.id                                                           as source_payment_id,
  p.subscription_id,
  p.month_code,
  0                                                              as paid_amount,
  false                                                          as paid,
  p.date                                                         as created_at
  from public.payments p
 where p.paid_from = 'school_cash'
   and p.amount_paid > 0
   and not exists (
     select 1
       from public.student_charges c
      where c.origin = 'school_advance'
        and c.source_payment_id = p.id
   );


-- -----------------------------------------------------------------------------
--  CE QUI NE CHANGE PAS — à lire avant de s'inquiéter
--
--  * AUCUN calcul de scolarité ne bouge. Les soldes, les mois M1/M2…, les parts
--    d'enseignant et les retenues lisent exactement les mêmes colonnes qu'hier.
--    Un frais ne se mélange jamais à un solde d'emploi du temps.
--
--  * LA PAIE DES ENSEIGNANTS N'EST PAS TOUCHÉE. `student_charges` n'entre dans
--    aucune des règles qui retiennent une part. Une école qui reprend
--    aujourd'hui vingt avances ne verra donc AUCUNE paie se rebloquer.
--
--  * LA CAISSE RESTE JUSTE. Créer un frais ne bouge pas un dinar : c'est une
--    créance, pas un encaissement. Seul son RÈGLEMENT écrit une entrée en
--    caisse, du montant exact versé. Supprimer un frais retire ses règlements
--    ET leurs entrées, donc la recette du jour ne compte jamais de l'argent qui
--    n'est pas dans le tiroir.
--
--  * LES AVANCES REPRISES N'ONT RIEN ENCAISSÉ NON PLUS. Leur mouvement de
--    caisse (l'entrée portée au crédit de l'élève et la sortie qui l'a
--    financée) existe depuis le jour de l'avance et n'est pas rejoué ici : la
--    reprise ne crée qu'une créance à réclamer.
-- -----------------------------------------------------------------------------


-- -----------------------------------------------------------------------------
--  Vérification — à lire dans la sortie du SQL Editor
-- -----------------------------------------------------------------------------
select
  (select count(*) from information_schema.tables
     where table_schema = 'public'
       and table_name = 'student_charges')                    as table_frais_ok,          -- 1 attendue
  (select count(*) from information_schema.columns
     where table_schema = 'public'
       and table_name = 'payments'
       and column_name = 'charge_id')                         as colonne_charge_id_ok,    -- 1 attendue
  (select count(*) from pg_policies
     where schemaname = 'public'
       and tablename = 'student_charges')                     as policies_frais,          -- 2 attendues
  (select count(*) from public.student_charges)               as frais_total,
  (select count(*) from public.student_charges
     where origin = 'school_advance')                         as frais_avances_ecole,
  (select count(*) from public.payments
     where paid_from = 'school_cash' and amount_paid > 0)     as avances_en_base;
-- `frais_avances_ecole` doit être ÉGAL à `avances_en_base` : chaque avance a
-- désormais sa créance à réclamer.

-- Les colonnes de la nouvelle table, telles que Postgres les voit.
select column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'student_charges'
 order by ordinal_position;

-- CE QUE LES FAMILLES DOIVENT HORS SCOLARITÉ, élève par élève — exactement le
-- nombre que l'alerte affiche sur sa fiche et sur la feuille de son groupe.
select
  s.registration_number                                        as n_inscription,
  s.first_name || ' ' || s.last_name                           as eleve,
  s.phone                                                      as telephone,
  count(*)                                                     as frais_ouverts,
  sum(c.amount)                                                as total_des_frais,
  sum(c.paid_amount)                                           as deja_verse,
  sum(c.amount - c.paid_amount)                                as reste_du,
  sum(case when c.origin = 'school_advance'
           then c.amount - c.paid_amount else 0 end)           as dont_avance_par_ecole
  from public.student_charges c
  join public.students        s on s.id = c.student_id
 where c.amount - c.paid_amount > 0
 group by s.registration_number, s.first_name, s.last_name, s.phone
 order by reste_du desc;

-- CE QUE L'ÉCOLE A SORTI DE SA CAISSE ET N'A PAS ENCORE RÉCUPÉRÉ, avance par
-- avance, de la plus ancienne à la plus récente : la liste à réclamer.
select
  substr(c.date, 1, 10)                                        as jour_de_l_avance,
  s.first_name || ' ' || s.last_name                           as eleve,
  s.phone                                                      as telephone,
  c.name                                                       as avance,
  c.amount                                                     as montant_avance,
  c.paid_amount                                                as deja_rembourse,
  c.amount - c.paid_amount                                     as reste_a_recuperer
  from public.student_charges c
  join public.students        s on s.id = c.student_id
 where c.origin = 'school_advance'
   and c.amount - c.paid_amount > 0
 order by c.date;
