# ALTECH SCHOOL — Matrice d'accès (sécurité par rôle)

> Cible de sécurité implémentée dans `supabase/phase2/01_access_policies.sql`.
> **Statut : SQL livré, NON appliqué en production** (à déployer après les
> lectures ciblées — voir `SQL_RUNBOOK_PHASE2.md`).

## Constat corrigé

Aujourd'hui, toutes les tables sensibles ont une policy
`FOR SELECT TO authenticated USING (true)` (`supabase/schema.sql` §5). Combiné au
téléchargement intégral de la base au login, **tout compte connecté — y compris
un élève ou un parent — peut lire l'intégralité des données financières et
personnelles de l'école**. C'est le risque P0.

## Rôles et liaison compte → fiche

`profiles(id = auth.uid, role, entity_id)`. `entity_id` pointe la fiche métier
(élève, parent, enseignant). Fonctions d'aide : `my_role()`, `my_entity_id()`,
`is_staff()` (admin+reception), `is_admin()`, `is_teacher()`, `is_parent()`,
`is_student()`, `can_read_student()`, `can_read_student_finance()`,
`teacher_teaches_student()`.

## Matrice de LECTURE (SELECT)

| Donnée / table | Admin | Réception | Enseignant | Élève | Parent |
|---|:--:|:--:|:--:|:--:|:--:|
| Fiche élève (`students`) | ✅ tous | ✅ tous | ✅ ses élèves¹ | ✅ la sienne | ✅ ses enfants |
| Présences (`attendance_records`) | ✅ | ✅ | ✅ ses élèves | ✅ les siennes | ✅ ses enfants |
| Inscriptions (`enrollments`) | ✅ | ✅ | ✅ ses élèves | ✅ | ✅ ses enfants |
| Pénalités d'absence | ✅ | ✅ | ✅ ses élèves | ✅ | ✅ ses enfants |
| Versements / scolarité (`payments`) | ✅ | ✅ | ❌ | ✅ les siens | ✅ ses enfants |
| Frais / dettes (`student_charges`) | ✅ | ✅ | ❌ | ✅ | ✅ ses enfants |
| Caisse (`cash_transactions`) | ✅ | ✅ | ❌ | ❌ | ❌ |
| Dépenses (`expenses`, catégories) | ✅ | ✅ | ❌ | ❌ | ❌ |
| Fiche enseignant complète (`teachers`) | ✅ | ✅ | ✅ la sienne | ❌ | ❌ |
| Annuaire enseignant (noms) `teacher_directory` | ✅ | ✅ | ✅ | ✅ | ✅ |
| Paie enseignant (`teacher_payments`, acomptes, expenses, absences, child_debts, unpaid) | ✅ | ✅ | ✅ la sienne | ❌ | ❌ |
| Séances payées (`group/solo/independent_sessions`) | ✅ | ✅ | ✅ les siennes | ❌ | ❌ |
| Travailleurs (shifts, acomptes, absences, payments, roles) | ✅ | ✅ | ❌ | ❌ | ❌ |
| Réception (`reception_staff`) | ✅ | ✅ | ❌ | ❌ | ❌ |
| Parents (`parents`) | ✅ | ✅ | ❌ | ❌ | ✅ la sienne |
| Notifications | ✅ | ✅ | ❌ | ❌ | ✅ les siennes |
| Identifiants portail (`student_credentials`) | ✅ | ✅ | ❌ | ❌ | ❌ |
| Référentiel (modules, classes, salles, emplois du temps, abonnements, matières, annonces) | ✅ | ✅ | ✅ | ✅ | ✅ |

¹ « ses élèves » = élèves inscrits sur un abonnement d'une séance affectée à l'enseignant.

## Matrice d'ÉCRITURE (inchangée en phase 2)

| Domaine | Admin | Réception | Enseignant | Élève | Parent |
|---|:--:|:--:|:--:|:--:|:--:|
| Administration complète, finances, caisse, paie | ✅ | ✅ | ❌ | ❌ | ❌ |
| Présences, inscriptions, matières, séances libres | ✅ | ✅ | ✅ | ❌ | ❌ |
| Gestion des comptes / rôles | ✅ | ❌ | ❌ | ❌ | ❌ |
| Sa propre fiche (nom, téléphone) | ✅ | ✅ | ✅ | ✅ | ✅ |

Les policies d'écriture sont conservées (forme InitPlan de la phase 1 :
`using ((select public.is_staff()))`).

## Données de référence laissées ouvertes (justification)

modules, classes, class_groups, salles, class_categories, schedule_sessions,
subscriptions, free_periods, module_absence_rules, subjects, announcements,
coursework, schools : **catalogue non privé**, nécessaire au rendu des écrans de
tous les rôles. Les restreindre casserait les portails sans bénéfice de
confidentialité. Décision réévaluable si un besoin apparaît.

## Storage

Revoir les policies des buckets (bloc 7 des diagnostics) : les logos/avatars
publics peuvent rester en lecture publique ; tout document privé (bulletins,
pièces) doit être restreint au personnel et au propriétaire. SQL non inclus car
dépend des buckets réellement présents — à constater via le bloc 7.

## Mots de passe en clair

`student_credentials.password` (clair) est une copie redondante — la connexion
réelle passe par Supabase Auth. Lecture déjà restreinte au personnel (01) ;
réinitialisation sans clair via `reset_student_password` (04) ; purge du clair
laissée à décision admin (04, commentée).

## Test obligatoire

Vérifier avec de **vrais JWT** par rôle (client authentifié, pas l'éditeur SQL
qui tourne en service_role et contourne la RLS) : un élève/parent ne doit voir
ni la caisse, ni les autres élèves, ni les salaires.
