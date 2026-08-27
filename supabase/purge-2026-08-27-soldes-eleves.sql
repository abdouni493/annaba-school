-- =============================================================================
--  PURGE : TOUS LES SOLDES VERSÉS PAR LES ÉLÈVES, SUR TOUS LES EMPLOIS DU TEMPS
-- =============================================================================
--
--  CE N'EST PAS UNE MISE À JOUR DE SCHÉMA. C'est un EFFACEMENT DE DONNÉES, et
--  il est IRRÉVERSIBLE. Aucune structure n'est touchée : seules des lignes
--  disparaissent. Prenez une sauvegarde avant (Supabase → Database → Backups),
--  ou au minimum lancez la PARTIE A et regardez ce qu'elle annonce.
--
--  APRÈS CE SCRIPT, chaque élève redevient redevable de la TOTALITÉ de sa
--  scolarité, sur chacun de ses emplois du temps : plus un dinar versé, plus
--  une séance payée d'avance, plus un solde créditeur.
--
--  ---------------------------------------------------------------------------
--  CE QUI EST EFFACÉ
--  ---------------------------------------------------------------------------
--   1. `payments` rattachés à un emploi du temps — les soldes de scolarité.
--   2. Leur reflet en caisse (`student_payment` / `student_debt`).
--   3. Les compteurs d'argent de `enrollments` : solde remis à zéro, et plus
--      aucune séance payée d'avance.
--   4. Les FRAIS nés d'une avance de l'école (`origin = 'school_advance'`) :
--      le versement qu'ils remboursaient n'existe plus.
--   5. Les scolarités PORTÉES sur le salaire d'un père et pas encore retenues
--      (`teacher_child_debts` non payées) : l'enfant les redoit lui-même.
--
--  ---------------------------------------------------------------------------
--  CE QUI N'EST PAS TOUCHÉ — ET POURQUOI
--  ---------------------------------------------------------------------------
--   * LES PRÉSENCES (`attendance_records`). L'élève est bien venu au cours ;
--     effacer sa présence effacerait aussi le travail de l'enseignant.
--   * LES FRAIS ORDINAIRES (livre, tenue, sortie) et les versements qui les
--     règlent. Un frais ne touche AUCUN emploi du temps — ce n'est pas un solde.
--   * LES SÉANCES LIBRES, de groupe comme de passage, et leurs deux mouvements
--     de caisse. Elles ne se rattachent à aucun emploi du temps non plus.
--   * TOUTE LA PAIE DES ENSEIGNANTS ET DES TRAVAILLEURS : règlements, acomptes,
--     dépenses, absences. Ce qui a été versé l'a été.
--   * `students.registration_due`. Les frais d'inscription qu'une avance de
--     l'école avait soldés ne se relèvent pas d'eux-mêmes : si vous voulez les
--     redemander, la PARTIE C en bas le fait, élève par élève.
--
-- =============================================================================


-- =============================================================================
--  PARTIE A — CE QUE LA PURGE VA FAIRE (lecture seule, rien n'est effacé)
--  Lancez cette partie SEULE d'abord, et lisez la ligne obtenue.
-- =============================================================================

select
  (select count(*) from public.payments
     where subscription_id is not null)                        as soldes_a_effacer,
  (select coalesce(sum(amount_paid), 0) from public.payments
     where subscription_id is not null)                        as montant_total_efface,
  (select count(*) from public.cash_transactions
     where type in ('student_payment', 'student_debt')
       and id not in (select cash_in_id from public.group_seances
                        where cash_in_id is not null)
       and description not like 'Séance libre%'
       and description not like 'Frais «%')                    as mouvements_caisse_a_effacer,
  (select count(*) from public.enrollments
     where balance <> 0 or paid_seances <> consumed_seances)   as inscriptions_a_remettre_a_zero,
  (select count(*) from public.student_charges
     where origin = 'school_advance')                          as avances_ecole_a_effacer,
  (select count(*) from public.teacher_child_debts
     where paid = false)                                       as scolarites_portees_a_effacer;


-- =============================================================================
--  PARTIE B — LA PURGE
--  Tout se joue dans UNE transaction : si une seule étape échoue, aucune ne
--  s'applique. Rien n'est effacé tant que le `commit` n'est pas passé.
-- =============================================================================

begin;

-- 1. LE REFLET EN CAISSE, EFFACÉ EN PREMIER.
--
--    Il part avant les versements parce qu'il se repère à ce qu'il n'est PAS :
--    ni l'entrée d'une séance libre de groupe (elle porte son identifiant dans
--    `group_seances.cash_in_id`), ni celle d'une séance de passage, ni le
--    règlement d'un frais. Tout le reste est le reflet d'un solde de scolarité,
--    y compris les dettes que l'école s'est avancées à elle-même.
delete from public.cash_transactions
where type in ('student_payment', 'student_debt')
  and id not in (
    select cash_in_id from public.group_seances where cash_in_id is not null
  )
  and description not like 'Séance libre%'
  and description not like 'Frais «%';

-- 2. LES SOLDES EUX-MÊMES.
--
--    `subscription_id is not null` est ce qui fait d'un versement une
--    SCOLARITÉ : c'est l'emploi du temps qu'il crédite. Un règlement de frais
--    porte un `charge_id` et aucun emploi du temps — il reste où il est.
delete from public.payments
where subscription_id is not null;

-- 3. LES COMPTEURS D'ARGENT DES INSCRIPTIONS.
--
--    `balance` est ce qui reste dans la cagnotte de l'élève sur cet emploi du
--    temps, et `paid_seances` le nombre de séances que cette cagnotte a payées.
--    Sans versement, la cagnotte est vide — et « séances payées » retombe donc
--    exactement sur « séances consommées » : plus rien n'est réglé d'avance,
--    mais les séances déjà suivies restent comptées comme suivies.
update public.enrollments
set balance      = 0,
    paid_seances = consumed_seances;

-- 4. LES AVANCES DE L'ÉCOLE.
--
--    Un frais `school_advance` dit « la famille doit à l'école la scolarité que
--    la caisse a réglée à sa place ». Cette scolarité vient d'être remise à
--    devoir : réclamer les deux ferait payer deux fois la même somme.
delete from public.student_charges
where origin = 'school_advance';

-- 5. LES SCOLARITÉS PORTÉES SUR UN SALAIRE, PAS ENCORE RETENUES.
--
--    Elles attendaient la prochaine paie du père pour être déduites. Le
--    versement qu'elles remboursaient n'existe plus, donc l'enfant redoit sa
--    scolarité lui-même, au guichet. Celles DÉJÀ retenues sur une paie versée
--    (`paid = true`) restent : cet argent-là est réellement sorti.
delete from public.teacher_child_debts
where paid = false;

commit;


-- =============================================================================
--  PARTIE C — FACULTATIF : REDEMANDER LES FRAIS D'INSCRIPTION SOLDÉS PAR UNE
--  AVANCE DE L'ÉCOLE
--
--  À ne lancer QUE si vous voulez aussi que ces élèves redoivent leur
--  inscription. `registration_fee` est le tarif de l'établissement : la ligne
--  ci-dessous le repose sur les élèves dont l'inscription avait été soldée par
--  la caisse de l'école. Vérifiez d'abord le montant avec le `select`.
-- =============================================================================

-- select registration_fee from public.schools where id = 'school';
--
-- update public.students
-- set registration_due = (select registration_fee from public.schools where id = 'school')
-- where registration_due = 0;


-- =============================================================================
--  PARTIE D — VÉRIFICATION (lecture seule, après la PARTIE B)
--  Les trois premiers nombres doivent être à zéro.
-- =============================================================================

-- select
--   (select count(*) from public.payments where subscription_id is not null)     as soldes_restants,
--   (select count(*) from public.student_charges where origin = 'school_advance') as avances_restantes,
--   (select count(*) from public.enrollments where balance <> 0)                  as cagnottes_restantes,
--   (select count(*) from public.payments where charge_id is not null)            as reglements_de_frais_conserves,
--   (select count(*) from public.attendance_records)                              as presences_conservees,
--   (select count(*) from public.teacher_payments)                                as paies_enseignants_conservees;
