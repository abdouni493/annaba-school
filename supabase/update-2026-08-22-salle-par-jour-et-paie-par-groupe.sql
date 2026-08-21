-- =============================================================================
--  MISE À JOUR — Salle jour par jour, noms de salles uniques,
--                paie de l'enseignant groupe par groupe
--  Projet : https://jehpfbupmhbnbbkzhiwr.supabase.co
--
--  À exécuter TEL QUEL dans le SQL Editor de Supabase, UNE SEULE FOIS.
--  Le script est idempotent : le relancer ne casse rien. La SEULE donnée qu'il
--  puisse modifier est le NOM d'une salle en doublon (voir le point 2), et il
--  affiche alors exactement ce qu'il a renommé.
--
--  Ce qu'il change
--  ---------------
--   1. `schedule_sessions.day_salles` (jsonb) — la salle de CHAQUE jour.
--   2. Une salle par nom : index unique sur `salles`, doublons renommés avant.
--   3. Rien d'autre. La paie « groupe par groupe », les cas d'élèves
--      (fils d'enseignant, réduction, école seule) et la « situation d'un
--      élève » se calculent entièrement à partir de tables déjà en place —
--      `unpaid_teacher_sessions`, `payments`, `enrollments`, `students`,
--      `teacher_payments` (qui porte déjà `months` et `child_charges`).
-- =============================================================================


-- -----------------------------------------------------------------------------
--  1. La salle de chaque jour
--
--  Un emploi du temps qui tourne Samedi 08:00–10:00 en Salle A et Mardi
--  14:00–16:00 en Salle B est UN SEUL emploi du temps, pas deux. `salle_id`
--  reste la salle PAR DÉFAUT — celle du premier jour, que lisent tous les écrans
--  qui n'ont besoin que d'un « où, à peu près » — et `day_salles` porte les
--  exceptions :
--
--      {"saturday": "salle-1", "tuesday": "salle-2"}
--
--  Un emploi qui garde la même salle toute la semaine n'écrit RIEN ici : la
--  colonne reste nulle et se lit comme avant. Les emplois existants ne sont donc
--  pas touchés.
--
--  La disponibilité d'une salle se vérifie désormais jour par jour : une salle
--  prise le samedi reste proposée le mardi.
-- -----------------------------------------------------------------------------
alter table public.schedule_sessions
  add column if not exists day_salles jsonb;

comment on column public.schedule_sessions.day_salles is
  'Salle jour par jour : {"saturday":"salle-1","tuesday":"salle-2"} — un jour absent retombe sur salle_id (la salle du premier jour)';


-- -----------------------------------------------------------------------------
--  2. Deux salles ne peuvent plus porter le même nom
--
--  L'écran Emploi du temps choisit une salle PAR SON NOM et affiche, à côté,
--  si elle est libre ou occupée. Deux « Salle 3 » y afficheraient deux lignes
--  identiques dont une seule est libre : le choix devient indécidable.
--
--  Les doublons éventuellement déjà en base sont RENOMMÉS (jamais supprimés,
--  jamais fusionnés) : la plus ancienne garde son nom, les suivantes reçoivent
--  « (2) », « (3) »… Aucun emploi du temps ne perd sa salle, seul le libellé
--  change, et la requête de vérification en fin de script les liste.
-- -----------------------------------------------------------------------------
do $$
declare
  dup   record;
  tries integer;
  cand  text;
begin
  -- Chaque doublon, la plus ancienne mise à part, reçoit le premier suffixe
  -- « (n) » encore libre : renommer « Salle 3 » en « Salle 3 (2) » alors qu'une
  -- « Salle 3 (2) » existe déjà ne ferait que déplacer le conflit.
  for dup in
    select id, name
      from (
        select id,
               name,
               row_number() over (partition by lower(btrim(name)) order by id) as rank
          from public.salles
      ) r
     where r.rank > 1
     order by id
  loop
    tries := 2;
    loop
      cand := dup.name || ' (' || tries || ')';
      exit when not exists (
        select 1 from public.salles
         where lower(btrim(name)) = lower(btrim(cand))
      );
      tries := tries + 1;
    end loop;
    update public.salles set name = cand where id = dup.id;
    raise notice 'Salle renommée : % -> %', dup.name, cand;
  end loop;
end $$;

create unique index if not exists idx_salles_name_unique
  on public.salles (lower(btrim(name)));

comment on index public.idx_salles_name_unique is
  'Une salle par nom (casse et espaces de bord ignorés) : l''écran Emploi du temps choisit une salle par son nom';


-- -----------------------------------------------------------------------------
--  3. Ce que la paie de l'enseignant lit déjà — aucune colonne à créer
--
--  Le nouvel écran de règlement (un grand tableau PAR GROUPE, une ligne par
--  élève, ses séances S1…Sn, ce qu'il a versé, ses arriérés et la part qui
--  revient à l'enseignant) ne fait que RELIRE ce qui est déjà écrit :
--
--   * `unpaid_teacher_sessions` — une ligne par présence, avec la part qu'elle
--     rapporte. Une part reste « retenue » tant que l'élève doit de l'argent,
--     et redevient payable dès qu'il s'acquitte : c'est ainsi qu'une part de M2
--     réapparaît au règlement du M3, ce que la colonne « arriérés débloqués »
--     affiche maintenant en clair.
--   * `payments` + `enrollments` — ce que chaque élève a versé, mois par mois,
--     et le solde qui lui reste sur l'emploi du temps.
--   * `teacher_expenses` / `teacher_acomptes` — les retenues, tabulées et
--     totalisées sur l'écran comme sur la fiche de paie.
--   * `teacher_payments.months` / `.child_charges` — le figé du règlement.
--
--  Les CAS D'ÉLÈVES se lisent tous sur `students`, déjà en place :
--   * `student_case = 'teacher_child'` + `teacher_father_id` — sa scolarité sort
--     du salaire du père (l'argent ne passe pas par la caisse) ;
--   * `student_case = 'school_only'` + `unpaid_teacher_ids` — l'école encaisse,
--     l'enseignant listé n'est pas payé : cet élève n'apparaît plus du tout sur
--     la paie de cet enseignant-là ;
--   * `student_case = 'reduction'` + `case_reduction` — la remise se partage :
--     l'école en accorde sa moitié sur SA part, l'enseignant la sienne sur LA
--     SIENNE, et l'élève ne paie donc que ce que les deux lui laissent.
--
--     ATTENTION — c'est le seul changement de MONTANT de cette mise à jour :
--     un élève « réduction » était jusqu'ici facturé au prix plein alors que
--     seul l'enseignant supportait la remise. Il paie désormais le prix
--     diminué des deux parts. Les présences DÉJÀ enregistrées gardent le
--     montant qu'elles portaient (`attendance_records.amount_deducted`) : rien
--     n'est refacturé rétroactivement, ni dans un sens ni dans l'autre.
-- -----------------------------------------------------------------------------
comment on column public.students.case_reduction is
  'Cas « réduction » : {type, schoolValue, teacherValue} — l''école retire schoolValue de SA part de la séance, l''enseignant teacherValue de la sienne ; l''élève paie la somme des deux parts restantes';


-- -----------------------------------------------------------------------------
--  Vérification — à lire dans la sortie du SQL Editor
-- -----------------------------------------------------------------------------
select
  (select count(*) from information_schema.columns
     where table_schema = 'public'
       and table_name = 'schedule_sessions'
       and column_name = 'day_salles')                      as colonne_day_salles_ok,     -- 1 attendue
  (select count(*) from public.schedule_sessions
     where day_salles is not null)                          as emplois_multi_salles,
  (select count(*) from pg_indexes
     where schemaname = 'public'
       and indexname = 'idx_salles_name_unique')            as index_salles_unique_ok,    -- 1 attendu
  (select count(*) from public.salles)                      as salles_total,
  (select count(*) from public.students
     where student_case = 'reduction')                      as eleves_a_reduction,
  (select count(*) from public.students
     where student_case = 'school_only')                    as eleves_ecole_seule,
  (select count(*) from public.students
     where student_case = 'teacher_child')                  as enfants_d_enseignants,
  (select count(*) from public.unpaid_teacher_sessions
     where paid = false)                                    as parts_enseignant_ouvertes;

-- Les salles renommées par le point 2, s'il y en a eu :
select id, name
  from public.salles
 where name ~ ' \([0-9]+\)$'
 order by name;
