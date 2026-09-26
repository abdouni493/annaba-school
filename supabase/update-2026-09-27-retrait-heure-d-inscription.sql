-- =============================================================================
--  MISE À JOUR — 27/09/2026
--  Retrait de l'HEURE d'inscription. Seul le JOUR compte, et il n'est plus
--  saisi à la main.
--
--  ------------------------------------------------------------------------
--  CE QUI CHANGE DANS L'APPLICATION (pour mémoire)
--  ------------------------------------------------------------------------
--  · Les deux champs « Date d'inscription » / « Heure » de la fiche de création
--    sont RETIRÉS, ainsi que le bouton « Modifier la date » de la fiche de
--    l'élève (Voir détails ▸ Emplois du temps). La réception n'a plus rien à
--    saisir : elle coche l'emploi du temps, et c'est tout.
--  · La règle qui les remplace : le JOUR de l'inscription, et JAMAIS l'heure.
--    Un emploi du temps qui tourne de 8 h à 10 h, un élève créé à 10 h 30 et
--    coché dessus : il a suivi la séance, donc elle est à lui. Elle entre dans
--    son historique, s'affiche sur le tableau de bord et compte dans la paie de
--    l'enseignant exactement comme s'il avait été inscrit avant la sonnerie.
--    Ni l'heure de début, ni l'heure de fin du créneau n'entrent dans le calcul.
--  · Le point d'entrée continue de se lire sur le CALENDRIER de l'emploi du
--    temps (mise à jour du 23/09) : la séance tenue ce jour-là est la n-ième
--    depuis son ouverture, pointée ou non.
--  · La recherche du tableau de bord garde son curseur pendant la frappe (le
--    1er résultat portait un `autoFocus` qui le volait à chaque lettre).
--    « Entrée » ouvre le premier résultat.
--
--  ------------------------------------------------------------------------
--  CE QUE CE SCRIPT FAIT
--  ------------------------------------------------------------------------
--  L'heure vivait dans le JSONB `students.subscription_dates`, sous la clé
--  `subscribedTime` — il n'y a donc aucune colonne à supprimer, seulement cette
--  clé à retirer des fiches qui la portent.
--
--  · ÉTAPE 1 : LECTURE SEULE — combien de fiches portent encore une heure.
--  · ÉTAPE 2 : retire la clé `subscribedTime` de chaque inscription.
--  · ÉTAPE 3 : remet le commentaire de la colonne à jour.
--  · ÉTAPE 4 : LECTURE SEULE — vérifie qu'il n'en reste aucune.
--
--  Rien d'autre n'est touché : ni `subscribedAt`, ni `startDate`, ni le point
--  d'entrée (`joinMonthCode` / `joinSlotIndex`), ni les présences, ni les
--  paiements. Le script est IDEMPOTENT.
--
--  ⚠️ Si vous n'avez jamais exécuté la mise à jour du 23/09, ce script ne
--     trouvera rien à faire (aucune fiche ne porte d'heure) — et c'est normal.
-- =============================================================================


-- -----------------------------------------------------------------------------
--  ÉTAPE 1 — QUI PORTE ENCORE UNE HEURE ? (lecture seule)
-- -----------------------------------------------------------------------------
select s.registration_number                as n_inscription,
       s.first_name || ' ' || s.last_name   as eleve,
       d.key                                as subscription_id,
       d.value ->> 'subscribedAt'           as jour_d_inscription,
       d.value ->> 'subscribedTime'         as heure_a_retirer
  from public.students s
  cross join lateral jsonb_each(coalesce(s.subscription_dates, '{}'::jsonb)) as d(key, value)
 where d.value ? 'subscribedTime'
 order by s.registration_number, d.key;


-- -----------------------------------------------------------------------------
--  ÉTAPE 2 — RETIRER LA CLÉ `subscribedTime`
--
--  Chaque bloc d'inscription est reconstruit sans elle, les autres clés
--  (subscribedAt, startDate, expiryDate, plan, joinMonthCode, joinSlotIndex,
--  unsubscribedAt) restant intactes. Une fiche sans heure n'est pas réécrite.
-- -----------------------------------------------------------------------------
update public.students s
   set subscription_dates = (
         select jsonb_object_agg(d.key, d.value - 'subscribedTime')
           from jsonb_each(s.subscription_dates) as d(key, value)
       )
 where s.subscription_dates is not null
   and exists (
         select 1
           from jsonb_each(s.subscription_dates) as d(key, value)
          where d.value ? 'subscribedTime'
       );


-- -----------------------------------------------------------------------------
--  ÉTAPE 3 — REMETTRE LE COMMENTAIRE DE LA COLONNE À JOUR
-- -----------------------------------------------------------------------------
comment on column public.students.subscription_dates is
  'Par abonnement : {subscribedAt,startDate,expiryDate,plan,joinMonthCode,joinSlotIndex} — subscribedAt = le JOUR de l''inscription, jamais l''heure (il décide de la séance rejointe) ; joinMonthCode/joinSlotIndex = le mois et la séance où l''élève entre dans le groupe';


-- -----------------------------------------------------------------------------
--  ÉTAPE 4 — VÉRIFICATION (lecture seule) : doit renvoyer 0.
-- -----------------------------------------------------------------------------
select count(*) as inscriptions_portant_encore_une_heure
  from public.students s
  cross join lateral jsonb_each(coalesce(s.subscription_dates, '{}'::jsonb)) as d(key, value)
 where d.value ? 'subscribedTime';
