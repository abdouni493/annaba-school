# ALTECH SCHOOL — Gestion d'école privée

Application de gestion d'école privée (Next.js App Router + TypeScript + Tailwind) :
abonnements (cours & formations) **facturés à la séance ou au mois**, présence par carte RFID,
achats de séances et règlement des restes à payer, paie des enseignants, caisse, dépenses, rapports
financiers, annonces, 5 rôles (admin / réception / enseignant / étudiant / parent), thèmes
clair (par défaut) / sombre et FR/AR (RTL).

> **Toutes les données vivent dans Supabase.** Aucune donnée constante n'est embarquée :
> l'application démarre sur une base vide et tout ce qui est créé depuis les écrans
> (élèves, enseignants, présences, paiements…) est écrit dans PostgreSQL et rechargé au démarrage.

## Stack

- **Next.js 16** (App Router) — pages dans `app/`, contenu des modules dans `components/pages/`
- **Supabase** — PostgreSQL (39 tables métier), Auth (email + mot de passe), Storage (logo, images)
- **Zustand** — le store `lib/store/data.ts` porte les règles métier et sert de cache de la base
- **Tailwind v4**, **framer-motion**, **lucide-react**

## Installation

### 1. Créer le schéma

Ouvrir le **SQL Editor** du projet Supabase et exécuter **`supabase/schema.sql`** en entier.
Le script est idempotent (relançable sans risque) et crée :

| Section | Contenu |
| ------- | ------- |
| 1–2 | extensions, `profiles`, et les fonctions de comptes (`admin_exists`, `bootstrap_admin`, `admin_create_user`, `admin_set_password`, `admin_set_email`, `admin_delete_user`) |
| 3–4 | les 39 tables métier, leurs clés étrangères et leurs index |
| 5 | la RLS : lecture pour tout compte connecté, écriture pour le personnel, présences pour les enseignants, sa propre fiche pour chacun |
| 6 | les buckets Storage `logos` et `subjects` |
| 7–8 | la ligne unique de configuration de l'école, et les droits PostgREST |

Aucune donnée de démonstration n'est insérée.

> **Base déjà en place ?** Exécuter en plus, **dans cet ordre** :
>
> 1. **`supabase/update-2026-08-19-teacher-per-group.sql`** — ouvre la formule « par groupe »
>    (`teachers.payment_type = 'per_group'`, règlements `teacher_payments.method = 'group'`).
> 2. **`supabase/update-2026-08-19-emploi-horaires-par-jour.sql`** — ajoute
>    `schedule_sessions.day_times`, les horaires jour par jour d'un emploi du temps.
> 3. **`supabase/update-2026-08-20-paie-enseignant-par-mois.sql`** — ajoute
>    `teacher_payments.months` (les mois d'emploi du temps soldés par un règlement) et les
>    index qui font tourner la paie mois par mois.
> 4. **`supabase/update-2026-08-20-seances-groupe-et-fiche-eleve.sql`** — crée la table
>    `group_seances` (les **séances libres de groupe**, avec leurs deux mouvements de caisse) et
>    documente `students.subscription_dates.unsubscribedAt`, le jour où un élève quitte un groupe.
> 5. **`supabase/update-2026-08-22-salle-par-jour-et-paie-par-groupe.sql`** — ajoute
>    `schedule_sessions.day_salles` (la **salle de chaque jour**) et rend les **noms de salles
>    uniques** (les doublons déjà en base sont renommés, jamais supprimés). La paie « groupe par
>    groupe » et la « situation d'un élève » n'ont besoin d'aucune colonne de plus.
> 6. **`supabase/update-2026-08-23-gratuite-par-emploi-et-dettes-avancees.sql`** — ajoute
>    `students.free_subscription_ids` (la **gratuité emploi du temps par emploi du temps**),
>    `payments.paid_from` (d'où vient l'argent : la famille, le salaire du père, ou la caisse de
>    l'école) et le type de mouvement `cash_transactions.type = 'student_debt'` (les **dettes
>    d'élèves avancées par l'école**). Aucune donnée existante n'est modifiée : une fiche sans
>    liste reste entièrement offerte, exactement comme avant.
> 7. **`supabase/update-2026-08-24-emploi-archive-scolarite-portee-et-avances.sql`** — ajoute
>    `schedule_sessions.archived_at` et `subscriptions.archived_at` (**supprimer un emploi du temps
>    l'archive** au lieu de l'effacer, pour que ses présences, ses paiements et ses parts
>    d'enseignant restent nommés dans l'historique), élargit `payments.paid_from` à
>    `teacher_debt`, et crée la table **`teacher_child_debts`** (les scolarités d'enfants réglées
>    d'avance au guichet et portées sur le salaire du père). Sans `archived_at`, tout emploi du
>    temps déjà en base reste vivant : rien à reprendre.
> 8. **`supabase/update-2026-08-24-decimales-ecole-seule-arrieres-et-frais.sql`** — ajoute
>    `students.school_only_subscription_ids` (le cas **« école seulement » emploi par emploi**),
>    `students.enrollment_level` / `.enrollment_year` (la **classe et l'année retenues même sans
>    emploi du temps**), `schools.registration_fee_scope` et ses trois listes (**qui doit les
>    frais d'inscription** : tout le monde, un niveau, des classes, des emplois du temps),
>    `teacher_payments.arrears` / `.child_debts` / `.cash_id` (les **arriérés débloqués**, les
>    scolarités retenues, et le mouvement de caisse à annuler avec le règlement) et
>    `unpaid_teacher_sessions.payment_id` (**quelle paie a soldé cette part**). Aucune donnée
>    n'est réécrite : sans ces colonnes, tout garde le sens qu'il a aujourd'hui.
> 9. **`supabase/update-2026-08-26-second-telephone-emploi-multi-niveaux-et-paie-par-mois.sql`** —
>    ajoute `students.phone2` (le **second numéro** de la famille), `schedule_sessions.class_groups`
>    (un créneau qui réunit **plusieurs niveaux**, chacun avec ses groupes) et
>    `teacher_payments.board` (la **photographie figée** des tables d'un règlement de mois).
> 10. **`supabase/update-2026-08-26-eleves-de-passage-et-paie-sans-double.sql`** — ajoute
>    `independent_sessions.school_share` (ce que **l'école garde** sur une séance libre ; le reste
>    est la part de l'enseignant) et `independent_sessions.teacher_id` (**qui a donné la séance**,
>    figé à la création, pour qu'un changement de titulaire ne réattribue pas les séances passées).
>    Les séances déjà en base gardent leur sens exact : sans part écrite, l'école gardait tout.
>    La correction du **règlement en double**, les **élèves de passage** sur la feuille de présence
>    et la table « Retards de paiement & séances libres » sont du code, pas du schéma.
> 11. **`supabase/update-2026-08-27-dettes-et-frais-eleve-et-avances-remboursables.sql`** — crée la
>    table **`student_charges`** (les **dettes & frais divers** d'un élève : livre, tenue, sortie,
>    transport, dégât) et ajoute `payments.charge_id` (le **frais qu'un versement règle**, pour que
>    le règlement apparaisse dans l'historique de l'élève). Il **reprend aussi les avances déjà
>    faites** : chaque dette réglée par la caisse de l'école reçoit son frais à rembourser, si bien
>    qu'une avance d'avant aujourd'hui devient encaissable au guichet au lieu d'être seulement
>    signalée. La reprise est rejouable — relancer le script ne crée jamais deux fois la même
>    créance. Aucun calcul de scolarité, aucune paie et aucun solde de caisse ne bouge.
> 12. **`supabase/update-2026-08-27-enseignants-du-dernier-au-plus-ancien.sql`** — ajoute
>    `teachers.created_at`, pour que la liste des enseignants se lise **du dernier arrivé au plus
>    ancien** au lieu de suivre l'ordre physique des lignes. Les fiches déjà en base reçoivent une
>    date dans l'ordre où la table les rend aujourd'hui.
> 13. **`supabase/update-2026-08-27-travailleurs-metiers-droits-et-tracabilite.sql`** — crée la
>    table **`worker_roles`** (les **métiers**, que l'école nomme elle-même au lieu des trois
>    valeurs figées dans le code), ajoute à `reception_staff` son **compte de connexion**
>    (`has_account`, `username`) et ses **droits d'accès** (`nav_keys`, `action_keys`), crée
>    **`worker_acomptes`**, **`worker_absences`** et **`worker_payments`** (les acomptes et les
>    absences des travailleurs, qui n'ont **jamais pu être écrits** tant qu'ils visaient les
>    tables des enseignants, et les règlements, qui se devinaient jusqu'ici dans les **libellés de
>    la caisse**), ajoute `payments.alert_read` (la **cloche du tableau de bord**) et pose sur
>    toutes les tables les trois colonnes **`created_by` / `created_by_name` / `created_by_role`**
>    — qui a fait l'opération. Les fiches déjà en base gardent l'ancien menu de la réception : la
>    mise à jour ne verrouille personne du jour au lendemain.
>
> Les deux premiers garantissent aussi qu'une fiche créée avec le seul nom s'enregistre sans
> erreur.

### 2. Lancer l'application

```bash
npm install
npm run dev     # http://localhost:3000
```

La connexion Supabase est déjà câblée. Pour viser un autre projet, renseigner `.env.local` :

```bash
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

Autres scripts : `npm run build`, `npm run test` (vitest), `npm run lint`.

## Comptes et connexion

L'application démarre déconnectée sur `/login`, avec un simple formulaire **email + mot de passe**.

### Le premier administrateur

Tant qu'aucun administrateur n'existe, la page de connexion affiche le bouton
**« Créer un compte administrateur »** (nom, nom d'utilisateur, email, mot de passe). Il appelle
`bootstrap_admin()`, qui crée le compte dans la table d'authentification et connecte
immédiatement la personne. **Dès que ce compte existe, le bouton disparaît définitivement** :
`admin_exists()` ne répond `false` que sur une base neuve.

### Les autres comptes

Ils sont créés depuis l'application, et chacun est un vrai compte d'authentification Supabase
qui se connecte directement, sans email de confirmation :

| Écran | Rôle créé |
| ----- | --------- |
| Enseignants → *Nouvel enseignant* | `teacher` (un « passager » n'a volontairement pas de compte) |
| Travailleurs → *Nouveau travailleur* | `reception` (le ménage peut être créé sans compte) |
| Élèves → *Nouvel élève* | `student` (identifiants générés à partir du nom) |
| Parents → *Nouveau parent* | `parent` |

La création passe par la fonction SQL `admin_create_user()`, exécutée côté serveur avec les droits
de l'appelant : **la personne connectée reste connectée** — créer un compte ne vole jamais sa
session. L'identifiant du compte devient la clé primaire de la fiche, ce qui relie une session à
ses données.

Modifier une fiche met aussi à jour l'email de connexion, changer le mot de passe passe par
`admin_set_password()`, et supprimer une fiche supprime le compte.

## Comment les écrans écrivent dans la base

Les écrans continuent de travailler sur le store Zustand. `lib/supabase/sync.ts` observe ce store et
**réplique dans Supabase tout ce qui change** : les ajouts, les modifications et les suppressions,
qu'ils viennent d'un simple bouton ou d'une action qui réécrit six collections d'un coup (règlement
d'un enseignant, feuille de présence, achat de séances…).

Aucune action ne peut donc être oubliée, et l'ordre d'écriture respecte les clés étrangères :
suppressions des tables les plus profondes d'abord, insertions des tables parentes d'abord.

| Fichier | Rôle |
| ------- | ---- |
| `lib/supabase/client.ts` | la connexion (URL, clé anon, messages d'erreur lisibles) |
| `lib/supabase/tables.ts` | la carte collection → table → colonnes, en ordre de dépendance |
| `lib/supabase/load.ts` | lecture de toute la base au démarrage (pagination incluse) |
| `lib/supabase/sync.ts` | réplication des changements du store vers PostgreSQL |
| `lib/accounts/users.ts` | création / mot de passe / email / suppression des comptes |
| `lib/accounts/uploadImage.ts` | téléversement du logo et des images de matières |

`tests/schemaMapping.test.ts` vérifie que cette carte correspond colonne par colonne au SQL.

## Le système de séances

Le solde en dinars a disparu. Un élève **achète des séances**, module par module, et chaque
présence en consomme une.

### Abonnements

Le prix se règle **par séance** dans **Abonnements** (`pricePerSession`). Un cours peut en plus être
vendu **au mois** : on saisit le nombre de séances comprises dans le mois (`monthlySeances`) et le
prix de ce mois (`monthlyPrice`, pré-rempli avec le total calculé `séances × prix unitaire` et
librement modifiable — un pack est souvent moins cher que ses séances à l'unité). Les formations
gardent leur prix de niveau et leur durée en mois, qui pilote la date d'expiration.

### Deux formules, choisies à l'inscription

Fiche élève → **Inscriptions** : pour chaque module coché, la réception choisit la formule.

| Formule       | Ce qui est vendu                    | Expiration                                                       |
| ------------- | ----------------------------------- | ---------------------------------------------------------------- |
| **À la séance** | N séances à l'unité               | aucune — les séances restent acquises                            |
| **Au mois**     | le pack du mois, à son prix       | **un mois pile** après la date de début (aujourd'hui par défaut, modifiable) |

Un abonnement mensuel **expire à sa date de fin quoi qu'il arrive** : les séances non consommées
sont perdues, la carte est refusée sur ce module et il faut renouveler le mois. Un renouvellement
**remet le compteur à zéro** sur le nouveau pack (`plan`, `monthSeances` et `expiryDate` de
l'inscription).

### Acheter des séances ou un mois (réception)

Depuis la fiche élève → **Payer des séances ou un mois** :

```
module d'inscription  →  à la séance : N séances  →  brut = N × prix unitaire
                      →  au mois     : date de début  →  brut = prix du mois, fin = +1 mois
                      →  remise (% ou montant fixe)  →  net
                      →  montant payé  →  reste à payer = net − payé
```

L'achat crédite `paidSeances` sur l'inscription (ou la réinitialise pour un mois) et écrit un
`Payment`. Le **reste à payer** de tous les paiements constitue la **dette** de l'élève : la carte
affiche une alerte rouge et l'action **Régler Dette** solde les restes du plus ancien au plus récent.

### Présence

Scan RFID et feuille de présence manuelle appliquent la même règle :

- élève gratuit, période gratuite ou abonnement pas encore commencé → présence enregistrée,
  **aucune séance décomptée** ;
- sinon → **séances restantes − 1**, jamais d'argent ;
- l'enseignant payé au **pourcentage** touche sa part du prix net de la séance, comme avant ;
- l'enseignant payé **par groupe** touche le tarif fixé sur l'emploi du temps lui-même
  (part enseignant du mois ÷ séances du mois), quel que soit le nombre d'élèves présents ;
- plus aucune séance restante → l'élève est **quand même accepté**, la présence est signalée comme
  « à régulariser » ;
- abonnement **expiré** (mois écoulé ou formation terminée) → carte refusée, et les séances qui
  restaient sur l'inscription ne sont plus décomptables : elles sont perdues.

Annuler une présence ou marquer un élève absent **rend** la séance et retire la part enseignant.

### Emploi du temps

- un emploi du temps se crée avec les seuls **jours** : classe, module, groupe, salle et enseignant
  se complètent plus tard ;
- dès qu'il tourne sur **plusieurs jours**, chaque jour porte son propre **début** et sa propre
  **fin** — Samedi 08:00–10:00 et Mardi 14:00–16:00 sont le même emploi, pas deux ;
- la **salle se choisit en dernier** : elle reste verrouillée tant que les jours et leurs horaires
  ne sont pas fixés, puis chaque salle indique si elle est **disponible** sur ces créneaux ou
  **occupée**, avec l'emploi du temps qui la retient déjà. Deux créneaux qui se touchent
  (fin 10:00 / début 10:00) ne sont pas un conflit ;
- dès qu'il tourne sur plusieurs jours, **chaque jour porte aussi sa propre salle** — Samedi en
  Salle A, Mardi en Salle B est un seul emploi du temps — et la disponibilité se vérifie jour par
  jour : une salle prise le samedi reste proposée le mardi. Un bouton copie la salle du premier
  jour sur tous les autres quand elle ne change pas ;
- **deux salles ne peuvent pas porter le même nom** : la création refuse un doublon, casse et
  espaces de bord ignorés ;
- l'**enseignant se cherche par son nom** au lieu de se dérouler dans une liste : on tape deux
  lettres (ou son téléphone) et on clique.

Le badge, la feuille de présence et le tableau de la semaine lisent tous l'horaire **du jour** :
un créneau déplacé un seul jour de la semaine est accepté à sa nouvelle heure, pas à l'ancienne.

### Tableau de bord — la grille de la journée

Le tableau de bord se lit comme un vrai emploi du temps : **une ligne par créneau horaire, une
colonne par salle**, et chaque emploi du temps porte **sa** couleur, stable d'un jour à l'autre.
Un clic sur une case ouvre la feuille de présence de cette date. Au-dessus, l'avancement de la
journée : combien de créneaux sont **pointés**, combien **restent**, et combien de pointages ont
été écrits.

Une **recherche** et quatre **filtres** (classe, année, module, enseignant) balaient *tous* les
emplois du temps, pas seulement ceux du jour : le premier résultat est mis en avant et s'ouvre
d'un clic.

Trois raccourcis de **caisse** — dépôt, dépense, retrait — saisissent au même endroit ce que
l'écran Caisse saisit, sans quitter le tableau de bord. À côté d'eux, **Situation d'un élève**
ouvre le tableau de toute sa scolarité (voir plus bas).

La grille lit la **salle du jour** : un emploi qui tourne samedi en Salle A et mardi en Salle B se
range dans la bonne colonne chaque jour.

### Tableau de bord — n'importe quelle journée

Le tableau de bord n'est plus figé sur aujourd'hui : **jour précédent / jour suivant**, un
sélecteur de date et un bouton **Aujourd'hui**. Il liste alors les emplois du temps **de ce
jour-là**, à l'horaire de ce jour-là, avec l'avancement du pointage (`3/12`), et chaque ligne
ouvre la **feuille de présence de cette date** : une séance oubliée hier se pointe encore, et
demain se prépare la veille. Un élève créé depuis cette feuille entre sur le créneau **à la date
affichée**, pas à celle du jour.

### Un élève entre là où en est le groupe

Un enfant inscrit en cours de route ne commence pas l'emploi du temps à sa séance 1 : il arrive
**là où en est le groupe**. La fiche de création (tableau de bord, feuille de présence ou écran
Élèves) lit le mois que vit le groupe et la séance tenue ce jour-là, puis l'écrit sur son
inscription :

```
Groupe sur M2, 2 séances déjà tenues, on crée un élève aujourd'hui
   -> il entre en M2 · séance 3
   -> son solde d'inscription est versé sur M2 (jamais sur M1)
   -> sa première présence tombe sur M2 · séance 3
   -> S1 et S2 de M2 restent vides sur sa ligne (elles ne sont pas les siennes)
   -> M1 ne le liste pas du tout
```

Son mois se ferme **avec celui du groupe** : deux séances lui suffisent alors à clore un pack de
quatre, et la suivante ouvre M3 pour lui comme pour les autres. La paie de l'enseignant lit la
même horloge — aucune part n'est due sur les mois d'avant son arrivée.

Le point d'entrée est stocké sur l'inscription (`joinMonthCode`, `joinSlotIndex` dans
`students.subscription_dates`). Une inscription qui ne le porte pas — toutes celles d'avant — se
lit comme avant : **M1 · séance 1**.

### Désinscrire un élève d'un groupe

La feuille de présence porte, sur chaque ligne, un bouton **Désinscrire** : l'élève sort de la
liste du groupe et n'y est plus pointé. Son **historique reste intact** — présences, paiements et
solde — et l'écran prévient avant d'écrire si son solde est dans le rouge ou s'il lui reste de
l'argent dessus. Le réinscrire plus tard le fait entrer **là où en sera le groupe à ce
moment-là**.

Sortir d'un groupe ne fait donc rien disparaître : le bloc d'inscription est **conservé et daté**
(`unsubscribedAt`). La fiche de l'élève continue de lister cet emploi du temps, marqué
« Désinscrit le … », avec ses mois, ses présences, ses versements et son solde — et un bouton
**Réinscrire** juste à côté.

### Le tarif d'un élève « école seule »

Un élève **école seule** ne paie que ce que l'école garde : l'enseignant n'est délibérément pas
payé pour lui, donc lui facturer le prix complet encaisserait une part que personne ne versera.
Sa séance vaut **part de l'école du mois ÷ séances du mois** :

```
mois à 2000 DA, 4 séances, l'école garde 800
   -> élève ordinaire  : 500 DA la séance, 2000 DA le mois
   -> élève école seule: 200 DA la séance,  800 DA le mois
```

Ce tarif est celui que la présence retire de son solde, celui que la feuille de présence, la
fiche élève et la paie de l'enseignant affichent, et celui que la création d'élève propose comme
solde d'ouverture.

### Corriger un encaissement

Un versement se **modifie** (montant, mois, description) et se **supprime** là où il a été
saisi : depuis la feuille de présence du groupe (bouton *historique* sur la ligne de l'élève) et
depuis l'onglet **Paiements** de sa fiche. Le solde de l'emploi du temps et la caisse bougent
exactement du même écart — un montant mal tapé ou une ligne saisie deux fois se rattrapent sans
passer par la base.

### Séances libres de GROUPE

Écran **Séances libres**. Une séance ponctuelle vendue à un groupe entier, sans nommer un seul
élève : on choisit l'enseignant, la date, les horaires, on nomme la séance, puis on tape trois
nombres — combien d'élèves, combien paie un élève, combien l'école garde sur ce prix.

```
part enseignant / élève = prix élève − part école
total encaissé          = élèves × prix élève
total école             = élèves × part école
total enseignant        = élèves × part enseignant
```

À la création, l'écran propose d'imprimer la **fiche de paie** de l'enseignant — qui n'affiche
**jamais** la part de l'école. La séance se **modifie**, se **supprime** et s'ouvre en **détail**,
et ces trois actions déplacent avec elle ses deux mouvements de caisse, sa ligne dans
l'historique de l'enseignant, son bloc dans la **caisse** et son tableau dans les **rapports**.

### Les élèves de passage

Quelqu'un vient à **une** séance et repart. Lui créer une fiche, l'inscrire sur l'emploi du temps,
lui ouvrir un solde, puis l'en retirer — c'est cinq écrans pour une personne qu'on ne reverra
peut-être jamais. Deux boutons suffisent désormais, l'un sur la **feuille de présence du groupe**
(donc depuis le tableau de bord, en ouvrant le créneau du jour), l'autre sur l'écran **Séances
libres**.

On saisit trois choses, et il n'y en a pas quatre à savoir au comptoir :

- **qui est venu** — un nom par ligne, et **une ligne vide reste valide** : elle s'enregistre sous
  « Passager ». Six élèves d'un coup se saisissent en réglant le compteur sur 6, puis en nommant
  ceux qu'on connaît ;
- **combien un passager paie** pour la séance ;
- **ce que l'école garde** dessus. Le reste est la part de l'enseignant, affichée pendant la saisie.

```
part enseignant / passager = prix payé − part école
total encaissé             = passagers × prix payé
total enseignant           = passagers × part enseignant
```

L'argent entre en caisse tout de suite, en **un** mouvement pour toute la fournée. Les passagers
apparaissent sous la feuille de **cette séance-là** — avec leur prix, la part de l'école et celle de
l'enseignant — et **sur aucune autre** : la séance suivante repart sans eux, et s'ils reviennent on
les ressaisit, ce qui est exactement ce qui se passe au comptoir.

La part de l'enseignant, elle, rejoint le **mois de l'emploi du temps** dans lequel la date tombe et
se règle avec lui, dans la table **« Retards de paiement & séances libres »** de sa paie. Une fois
réglée, elle ne revient jamais.

Depuis l'écran **Séances libres**, le même formulaire sert aussi à un **élève inscrit** : on le
cherche par nom, n° d'inscription ou carte, et la séance est enregistrée à son nom — elle se règle
en espèces et ne touche **aucun** de ses soldes. Laisser ce champ vide bascule sur les passagers.
La liste et le détail affichent, pour chaque séance, le prix, la part de l'école, la part de
l'enseignant et si elle a déjà été réglée.

Une séance enregistrée **avant** ce partage n'a pas de part d'école écrite : l'école gardait tout,
la part de l'enseignant vaut donc zéro et aucun ancien total ne bouge. Elle peut être rouverte et se
voir attribuer une part.

### La feuille de présence du groupe

Quatre raccourcis en tête de la feuille, en plus du **Nouvel élève** :

- **Élève existant** — il est déjà dans la base : on le cherche par nom, n° d'inscription ou
  téléphone et on l'ajoute au groupe, sans ressaisir une seule information. Il entre **là où en
  est le groupe** ce jour-là.
- **Élève passager** — il vient **une fois** : aucune fiche n'est créée, aucun solde n'ouvert. Voir
  « Les élèves de passage » ci-dessous.
- **Tout présent** — la liste s'ouvre entièrement cochée (les élèves déjà pointés ce jour-là ne
  sont pas réécrits), une recherche permet d'en décocher un ou deux, et un clic écrit tout.
- **Séance annulée pour tous** — la séance n'a pas eu lieu : toute la liste s'ouvre cochée, y
  compris les élèves déjà pointés, parce qu'une présence notée sur une séance qui n'a pas eu lieu
  doit être reprise. Rien n'est consommé, aucun solde n'est débité, aucune part enseignant n'est
  due, et le mois du groupe n'avance pas.
- **Historique** (sur chaque ligne) — les encaissements de cet élève sur cet emploi du temps,
  corrigeables et supprimables sur place.

La colonne d'argent ne montre plus un solde signé : elle affiche ce qui a été **versé** d'un côté
et ce qui **reste dû** de l'autre, jamais un montant payé précédé d'un moins.

Un élève qui donne **plus** que ce que le mois coûte ne perd rien : la différence reste sur le
**solde de cet emploi du temps** et paiera ses prochaines séances. L'écran d'encaissement l'annonce
avant d'écrire — « M3 est soldé et 200 DA restent d'avance » — et la ligne de l'élève affiche
ensuite ce solde d'avance. La fenêtre d'encaissement porte aussi une **date** : la réception règle
parfois pour la veille, et c'est alors CETTE date que portent le reçu, l'historique de l'élève et le
mouvement de caisse.

**En tête de la feuille : qui doit de l'argent dans ce groupe.** Un bandeau rouge nomme les élèves
en dette — un par ligne, avec son numéro, son téléphone et le détail de ce qu'il doit :

| Ce que le bandeau distingue | Ce que c'est | Ce que fait le bouton |
| --------------------------- | ------------ | --------------------- |
| **Scolarité** | ses mois dans le rouge (cet emploi et les autres), les restes d'anciens paiements, les frais d'inscription | ouvre **tout** ce qu'il doit, mois par mois, et l'encaisse ligne par ligne |
| **Frais** | livre, tenue, sortie, transport — tout ce qui n'est pas de la scolarité | coche, corrige le montant, encaisse : ce qui n'est pas versé reste dû |
| **Avancé par l'école** | ce que la caisse a réglé À SA PLACE pour ne pas faire attendre l'enseignant | se rembourse comme n'importe quel frais |

Le bandeau existe parce que c'est le **seul moment où la famille est joignable** : l'élève est là,
devant le comptoir. Chaque ligne du tableau porte en plus une colonne **« Frais & avances »** — le
montant dû d'un clic à encaisser, et un bouton pour lui **porter un nouveau frais** sans quitter la
feuille.

### La fiche élève

**Nouvel élève** et **Modifier** sont le **même écran** : identité, cas de facturation, emplois du
temps et soldes. En modification s'y ajoutent l'email de connexion, le mot de passe et la carte
RFID, que seule une fiche existante possède. Cocher un emploi du temps l'inscrit là où en est le
groupe, en décocher un l'en désinscrit — historique conservé.

En modification, le choix des emplois du temps **s'ouvre sur le niveau et l'année de l'élève**, pas
sur un primaire/1AP qui ne le concerne pas : ses inscriptions sont donc visibles et décochables
immédiatement. Celles qui appartiennent à un autre niveau restent listées en pastilles, chacune
avec une croix pour la retirer sans avoir à retrouver son niveau dans la liste.

Le bouton **Situation d'un élève** — sur l'écran Élèves **et sur le tableau de bord** — répond à
la question du parent au comptoir. On cherche l'élève par son nom, son n° d'inscription ou son
téléphone, et **un seul grand tableau** s'ouvre, lu exactement comme la feuille de présence d'un
groupe : **une ligne par emploi du temps** — ceux qu'il suit et ceux qu'il a quittés — avec ses
séances du mois S1…Sn, ce qu'il a **versé**, ce qui **reste dû**, ses **arriérés** des mois
précédents et le **solde** de cet emploi.

On y **encaisse sur place**, sur la ligne concernée, avec son reçu. Le navigateur de mois travaille
en **décalage** et non en numéro — « mois en cours », puis « 1 mois avant » — parce que deux
emplois du temps ne vivent pas le même mois au même moment : l'un en est à son M5 quand l'autre en
est à son M2. Reculer d'un cran permet de lire **et de régler** un mois passé.

### Paie de l'enseignant — mois par mois

L'enseignant est réglé sur la **même horloge que les élèves** : le mois d'un emploi du temps
s'ouvre à la première présence et se ferme sur la séance qui complète le pack (`M1`, `M2` …,
jamais un mois du calendrier). La part qu'une présence lui rapporte appartient donc au mois où
cette présence tombe.

Deux écrans, sur sa fiche :

- **Mois & emplois du temps** — pour chaque emploi : le **mois en cours** et la **séance en
  cours** de ce mois (`M2 · séance 3/4`), puis le tableau de **tous les mois** : clos ou en cours,
  séances tenues, période, élèves payés / impayés, dette des élèves, part enseignant générée,
  déjà réglée, restante. Chaque mois se déplie sur le détail élève par élève (séances,
  présences / absences, versé, reste dû, arriérés des mois précédents, part bloquée), et un
  onglet **Élèves impayés** rassemble tout, avec alertes.
- **Payer** — **un grand tableau par GROUPE**, lu comme la feuille de présence de ce groupe : une
  ligne par élève, ses séances du mois S1…Sn, puis les colonnes qui décident du règlement —
  **payé ce mois ?**, **mois précédents impayés**, **arriérés débloqués** et **part enseignant**.
  Le règlement s'ouvre sur le **dernier mois CLOS non réglé**, jamais sur le mois en cours : si le
  groupe en est à la 3ᵉ séance d'un mois de 4, c'est le mois précédent qui est coché. La formule
  **par groupe** additionne les tarifs déjà écrits sur chaque présence (part enseignant du mois ÷
  séances), le **pourcentage** s'applique au tarif de chaque élève, le **montant fixe** se répartit
  au prorata. En bas de l'écran : les **cas particuliers**, la table des **dépenses**, celle des
  **acomptes**, et le récapitulatif *total des élèves − dépenses − acomptes − scolarité des enfants
  = net à verser*. Enregistrer propose d'imprimer la **fiche de paie**.

L'écran de règlement s'ouvre sur **ce que l'enseignant doit toucher** : généré non réglé, payable
maintenant, retenu, déjà réglé — et il ne liste que les mois qui doivent encore quelque chose.
Chaque élève y est lu **à son tarif**, celui de son cas : un « école seule » à la part de l'école,
un « cas spécial » à zéro. Sur sa fiche, l'onglet **Historique financier** montre les règlements
réels, les mois que chacun a soldés, et réimprime la fiche de paie d'un clic.

### Ce qu'un élève retient, et ce qui revient plus tard

Un élève qui n'a pas payé **retient** la part correspondante : elle n'est pas versée, elle reste
ouverte et **réapparaît au règlement suivant** dès que sa dette est soldée. C'est exactement le cas
que la colonne **« arriérés débloqués »** rend enfin lisible :

```
M2 — l'élève ne paie pas       -> la part de l'enseignant est RETENUE
      l'enseignant est réglé du M2 sans elle
      l'élève s'acquitte de son M2
M3 — au règlement suivant      -> la part de M2 réapparaît, débloquée,
                                  à côté de celle du M3
```

### Les cas d'élèves, appliqués à la source

| Cas | L'élève paie | L'école garde | L'enseignant touche |
| --- | ------------ | ------------- | ------------------- |
| **Normal** | le prix de la séance | sa part du mois ÷ séances | la sienne |
| **Cas spécial** (gratuit) | rien **sur les emplois du temps offerts**, le prix plein sur les autres | rien sur les offerts | rien sur les offerts |
| **École seule** | la seule part de l'école | tout ce qu'il verse | rien — et il **n'apparaît pas** sur la paie de cet enseignant |
| **Réduction** | prix − les deux remises | sa part − sa remise | la sienne − sa remise |
| **Fils d'enseignant** | rien au comptoir | oui | sa scolarité est **retenue sur le salaire du père** |

Une **réduction** se partage : l'école en accorde sa moitié sur *sa* part, l'enseignant la sienne
sur *la sienne*, et l'élève ne paie donc que ce que les deux lui laissent.

```
mois à 2000 DA, 4 séances, l'école garde 800   ->  séance 500 = école 200 + enseignant 300
réduction 50% école / 10% enseignant           ->  séance 370 = école 100 + enseignant 270
```

### La gratuité se coche emploi du temps par emploi du temps

Un « cas spécial » n'est plus tout-ou-rien. La réception coche l'élève en cas spécial, puis, pour
**chaque** emploi du temps qu'il suit, laisse la case **« Offert »** cochée ou la décoche :

| La case | L'élève paie | L'école garde | L'enseignant touche |
| ------- | ------------ | ------------- | ------------------- |
| **Offert** (coché, par défaut) | rien | rien | rien |
| **Payant** (décoché) | le prix de la séance | sa part du mois | la sienne |

Un même enfant peut donc suivre l'anglais gratuitement et payer les maths, sans qu'il faille lui
créer deux fiches. Le choix se lit partout où l'argent se lit : sur sa fiche, sur sa carte, sur la
« situation d'un élève », et sur la paie de l'enseignant — où le module offert ne rapporte rien et
le module payant lui rapporte sa part comme pour n'importe quel élève.

> Une fiche **déjà en base** n'a pas de liste : elle est **entièrement offerte**, exactement comme
> le cas se lisait avant. Rien à reprendre. La liste n'est écrite que le jour où la réception
> rouvre la fiche.

Un cas spécial dont **au moins un** emploi du temps reste payant doit les **frais d'inscription** ;
celui dont tout est offert n'en doit aucun.

### Le fils d'enseignant peut payer AVANT son père

Le **fils d'enseignant** apparaît en bas du règlement de son père : ce qu'il a **étudié ce mois-ci**
(séances et montant), ce qu'il traîne des **mois précédents**, et le **total retenu** sur le
salaire. Cet argent ne passe jamais par la caisse — l'école est payée en versant *moins*.

Mais rien ne l'oblige à attendre : sa famille peut **régler au guichet quand elle veut**, depuis sa
fiche ou directement depuis le règlement du père (bouton **« Encaisser »** sur sa ligne). L'argent
passe alors par la caisse comme n'importe quel versement d'élève, et le mois **cesse d'être retenu
sur le salaire**. Chaque mois porte donc son propre statut :

| Statut | Ce qu'il veut dire | Retenu sur le salaire ? |
| ------ | ------------------ | ----------------------- |
| **À retenir** | rien n'a été versé | oui |
| **Payé par la famille** | la famille a réglé elle-même, **avant** la paie | **non** |
| **Retenu sur le salaire** | déjà pris sur un règlement précédent | c'est fait |
| **Avancé par l'école** | l'école a couvert ce mois sur sa caisse | non |

Un mois déjà payé par la famille **reste affiché** — sinon personne ne saurait qu'il a été soldé —
mais sa case « Retenir » est verrouillée : le retenir une seconde fois ferait payer la scolarité
deux fois.

### L'école peut avancer les séances impayées d'un élève

Une part est **retenue** tant que **la séance qui l'a produite n'est pas payée**, sur ce mois de cet
emploi du temps. Ce n'est pas « l'élève doit quelque chose, quelque part » : une dette sur un autre
groupe, un reste d'ancien paiement ou des frais d'inscription impayés ne doivent rien à CET
enseignant, et les lui faire porter revenait à ne jamais le payer pour un élève pourtant à jour chez
lui.

L'argent versé sur un mois paie ses séances **dans l'ordre où elles ont été tenues**, et le
trop-versé passe au mois suivant — exactement ce que la feuille de présence promet quand elle dit
qu'une avance « paiera ses prochaines séances ». Payer deux séances sur quatre libère donc les deux
premières parts, et laisse les deux autres en attente.

Le bouton **« Payer de la caisse »** n'apparaît que sur les lignes **effectivement bloquées** : un
élève à jour sur son mois n'a rien à faire avancer. L'école avance alors, sur sa propre caisse, ce
que l'élève doit **sur cet emploi du temps** — ni ses autres groupes ni ses frais d'inscription, qui
restent à la charge de la famille et se règlent au guichet — et la part redevient payable dans la
seconde.

La caisse enregistre **deux** mouvements, et c'est voulu :

```
+ 2000 DA   Paiement élève        « Dette M2 de Amine Benali réglée par l'école »
− 2000 DA   Dette élève avancée   « Caisse école → dette M2 de Amine Benali »
────────────────────────────────────────────────────────────────────────────────
      0     le solde de la caisse ne bouge pas : l'école n'a rien encaissé,
            elle a avancé. Seul le règlement de l'enseignant le fera bouger.
```

N'écrire que l'entrée ferait croire à un versement qui n'a pas eu lieu ; n'écrire que la sortie
ferait croire à un décaissement qui n'a pas eu lieu non plus. Les deux ensemble, le solde reste
juste — et l'écran **Caisse** affiche les deux lignes, dans l'onglet « Paiements Élèves », avec le
total avancé rappelé sous le compteur.

**L'alerte, elle, vit sur l'écran « Étudiants ».** Cet argent est sorti de la caisse sans jamais y
entrer : c'est l'**élève** qui le doit à l'école, pas l'enseignant, qui est réglé depuis longtemps
et n'a plus rien à réclamer. Un bandeau **« Dettes avancées par l'école »** en tête de la liste des
étudiants les nomme un par un — numéro, élève, emploi du temps, mois, date, montant avancé et ce
qu'il doit encore — avec le total **à récupérer**. La ligne de l'élève reste signalée **en rouge**
dans le tableau du mois de son enseignant, mais rien ne s'y pilote plus.

**Et l'avance se rembourse.** Elle ne se contentait plus d'être affichée : chaque avance est portée
au compte de l'élève comme un **frais** (voir « Dettes & frais divers d'un élève » plus bas), avec
un bouton **« Rembourser »** sur son bandeau. La famille rend ce qu'elle veut, quand elle passe ; ce
qui n'est pas rendu **reste dû** et l'alerte le dit encore ; une avance entièrement remboursée
**quitte la liste**. Rembourser une avance ne **rebloque jamais** la part de l'enseignant : elle a
été faite pour la débloquer, elle ne peut pas la reprendre.

### Régler la scolarité d'un fils d'enseignant depuis la feuille du groupe

Sa ligne de la feuille de présence porte une pastille **« Fils d'ens. »**. Elle ouvre la seule
question qui compte au guichet : **d'où vient l'argent ?** — et les deux réponses ne font pas la
même chose au salaire de son père.

| Le bouton choisi | Ce qui se passe à la caisse | Ce qui arrive au salaire du père |
| ---------------- | --------------------------- | -------------------------------- |
| **La famille paie maintenant** | une entrée, comme n'importe quel versement d'élève | **rien n'est retenu** — sa paie affiche le mois « payé par la famille » |
| **À porter sur le salaire du père** | **aucun mouvement** : l'école n'a rien reçu | la somme part **en attente** et son **prochain règlement la retient**, une fois |

Dans les deux cas l'enfant est **en règle immédiatement** : ses mois sortent du rouge, donc la part
que ses séances rapportent à l'enseignant **se débloque**. La fenêtre liste ses mois en dette sur
l'emploi du temps affiché, propose le montant qui les solde, et laisse le corriger. Un versement de
la famille imprime son reçu ; une somme portée n'en imprime pas, puisque personne n'a payé.

Côté **règlement de l'enseignant**, les deux se lisent, mais jamais au même endroit :

- **« Ses enfants, scolarisés sur son salaire »** — ce qui est **encore dû** et qu'on décide de
  retenir maintenant ;
- **« Scolarités d'enfants déjà réglées au guichet et portées sur ce salaire »** — un bloc de
  retenues à part, coché d'office, qui **honore** ce que la réception a déjà crédité à l'enfant.

Les deux ne peuvent pas se chevaucher : un mois crédité n'est plus dû. Un mois porté au père
apparaît d'ailleurs **« Porté sur le salaire »** dans le tableau de ses enfants, avec un renvoi vers
la retenue du bas — pour qu'on ne la compte pas deux fois en la voyant deux fois.

### Retirer une présence ou une absence, et récupérer l'argent

Sur la feuille de présence, **chaque case déjà pointée se clique** — S1, S2, … peu importe le jour
où elle a été saisie. La fenêtre annonce ce qu'elle va faire avant de le faire : quelle séance part,
de quel jour, et **combien revient sur le solde de cet emploi du temps**.

Retirer un pointage, c'est l'exact inverse de l'écrire :

- la ligne s'efface et la séance **cesse d'être consommée** ;
- le prix qu'elle avait pris est **rendu au dinar près** ;
- la part qu'elle devait à l'enseignant **s'en va avec elle**, tant qu'elle n'a pas été réglée.

Une séance **annulée**, une séance **offerte** ou une **première absence** n'ayant rien coûté, la
fenêtre le dit plutôt que d'annoncer un remboursement de 0 DA. Le pointage du **jour affiché** garde
en plus son bouton de retrait sous les boutons présent / absent / annulée, avec le montant rendu
écrit dessus — la réception n'a pas à deviner si le clic rendra de l'argent.

### Supprimer un emploi du temps sans perdre son histoire

Supprimer un emploi du temps ne l'efface plus : cela l'**archive**. La différence n'est pas
cosmétique — les clés étrangères cascadaient :

```
schedule_sessions  ──►  subscriptions  ──►  enrollments   (LES SOLDES)
```

…tandis que les présences et les paiements, eux, survivaient **orphelins**, sans module, sans groupe
ni salle à afficher. Un historique se lisait alors « — · — · 4 000 DA ».

Désormais, l'emploi du temps quitte les écrans qui servent à **organiser demain** — la grille, la
feuille de présence, le catalogue d'inscription, les tarifs — et reste entier partout où l'on
**relit hier** :

- les **présences** pointées, avec le nom du module et du groupe ;
- les **paiements** et les **soldes** des élèves ;
- ce qu'il doit encore à l'**enseignant**, toujours réglable depuis sa paie, où l'emploi porte la
  mention *« Emploi supprimé »*.

Ses élèves en sont **désinscrits à la date du jour**, exactement comme une désinscription ordinaire :
leur fiche garde le module, daté de la sortie. Retirer le **tarif** d'un cours (écran Abonnements)
suit la même règle, et pour la même raison : l'effacer emporterait les soldes de tous ses élèves.
Redéfinir le tarif plus tard le remet simplement en service.

### L'école choisit ce qu'elle avance, mois par mois

Le bouton **« Payer de la caisse »** ne solde plus aveuglément toute la dette. Il ouvre la liste des
**mois impayés** de l'élève — emploi du temps, mois, montant dû — et laisse la réception cocher ceux
que l'école prend en charge et **corriger chaque montant à la main**. Les restes d'anciens paiements
et les frais d'inscription, qui ne relèvent d'aucun emploi, se règlent sur une ligne à part.

Un avertissement s'affiche tant que la sélection ne couvre pas **toute** la dette, parce que c'est
la règle qui compte pour l'enseignant : sa part ne se débloque **qu'à zéro**. Un règlement partiel
soulage la famille, il ne débloque rien — et il vaut mieux le savoir avant de valider qu'après.

### L'historique des paiements des élèves, dans la caisse

Le journal de caisse ne dit qu'une chose : *« + 4 000 DA, Solde M2 — Amine Benali »*. Assez pour
compter l'argent, jamais pour répondre à la question qu'on pose six mois plus tard.

L'écran **Caisse** affiche donc, au-dessus du journal, l'**historique des versements eux-mêmes** :
l'élève et son **numéro d'inscription**, le **montant**, la **date et l'heure**, le **mois** crédité,
et l'**emploi du temps** avec son groupe, ses jours et ses heures. La **provenance** est dite en
clair, car trois d'entre elles ne font entrer aucun argent dans le tiroir :

| Provenance | Le tiroir bouge ? |
| ---------- | ----------------- |
| **Famille (caisse)** | oui — c'est le seul cas |
| **Retenu sur un salaire** | non : l'école est payée en versant moins au père |
| **Porté sur un salaire** | non : elle le sera à la prochaine paie du père |
| **Avancé par l'école** | non : l'entrée et la sortie qui la finance s'annulent |

Le compteur du haut distingue donc **ce qui a été encaissé** de **ce qui a été porté au crédit des
élèves**, et la liste se filtre par provenance.

### Voir où en est un élève avant de le déplacer

Les deux écrans qui inscrivent — **« Inscrire sur un autre emploi du temps »** (fiche *Payer &
recharger*) et **« Modifier l'élève »** — rappellent maintenant, **au-dessus du catalogue**, ce que
l'élève suit déjà : sa **classe**, son **niveau et son année**, chaque **emploi du temps** avec son
groupe, ses jours, ses heures, sa salle, son enseignant, le prix de la séance et son **solde**.

Sans ce rappel, cocher un créneau dans la liste du dessous relève du pari — c'est ainsi qu'on
inscrit un élève de 4AP sur un créneau de 3AP sans s'en apercevoir. Le tableau lit la **sélection en
cours**, pas seulement ce qui est enregistré : dans l'écran de modification, une ligne ajoutée y
apparaît aussitôt, marquée *« à enregistrer »*, et chaque ligne se retire d'un clic. Cocher un autre
groupe du **même cours** y **déplace** l'élève au lieu de le facturer deux fois.

### L'avance versée à l'inscription

À la création d'un élève, la réception saisit, emploi du temps par emploi du temps, l'**avance** que
la famille verse aujourd'hui : cet argent devient le **solde d'ouverture** de cet emploi, crédité
sur le mois où l'élève **entre** (un enfant inscrit en M2 paie pour M2, jamais pour un mois qu'il a
manqué).

L'enregistrement propose alors **deux documents, dans cet ordre** :

1. le **reçu de l'avance**, dès qu'un dinar a été versé — c'est une entrée d'argent, elle mérite sa
   propre pièce, avec le mois crédité et le solde qui en résulte emploi par emploi ;
2. le **bon d'inscription**, qui récapitule l'identité, les emplois du temps et ce qui a été versé.

Refuser le premier n'empêche jamais d'imprimer le second. L'avance part en même temps dans la
**caisse** et dans l'**historique des paiements** de l'élève, emploi du temps et mois compris.

### Alertes

Séances épuisées, inscription à 2 séances ou moins, abonnement mensuel ou formation bientôt expiré
(ou déjà expiré, avec les séances perdues), et reste à payer non réglé : signalés dans les toasts du
scan, sur la carte élève, dans le détail de la fiche, et dans les espaces étudiant et parent.

## Ce que coûte une séance — au centime, jamais au dinar

Le prix d'une séance ne se saisit pas : il se **déduit du mois**, et cette division ne tombe
presque jamais juste.

```
prix d'une séance        = prix du mois        ÷ séances du mois
part de l'école / séance = part école du mois  ÷ séances du mois
part du prof   / séance  = (mois − part école) ÷ séances du mois
```

Un mois à **4 000 DA sur 3 séances** vaut **1 333,33 DA** la séance — pas 1 333. Si l'école en
garde 2 500, il reste 1 500 DA à l'enseignant, soit **500 DA** par séance ; sur un mois de 7
séances, ce serait **214,29 DA**. L'application arrondissait chaque division à l'entier : trois
dinars perdus par séance, quatre séances, vingt élèves — et surtout la somme des lignes cessait
d'égaler le total affiché, le pire défaut qu'un écran d'argent puisse avoir.

Tout l'argent passe donc par `money()` (`lib/utils.ts`) : **deux décimales**, ni plus (le dinar n'a
pas de millimes) ni moins. `formatDA()` n'affiche la virgule que lorsqu'il y a des décimales, si
bien que « 4 000 DA » reste « 4 000 DA » et que « 1 333,33 DA » ne se lit plus « 1 333 DA ». Les
colonnes d'argent étaient déjà en `numeric` : rien à migrer côté base.

Le calcul se lit en toutes lettres, avec sa division, sur **l'emploi du temps** (à la création),
sur les **Abonnements**, sur le **tableau de bord** (bloc « Coût d'une séance — emplois du temps du
jour ») et sur l'**écran de règlement** de l'enseignant.

## « École seulement », emploi du temps par emploi du temps

Le cas était tout ou rien : on listait les enseignants qui ne seraient pas payés pour cet élève, et
cela valait pour tous leurs cours. Il se coche désormais **emploi par emploi**, exactement comme la
gratuité (`students.school_only_subscription_ids`) :

| Emploi du temps | Ce que la famille paie | L'enseignant | L'élève sur l'écran de paie |
| --------------- | ---------------------- | ------------ | --------------------------- |
| option **ACTIVE**    | la seule part de l'école | pas payé pour lui | **absent** — une ligne à 0 DA n'invite qu'à l'erreur |
| option **inactive**  | le tarif entier          | payé normalement  | listé comme n'importe qui |

Une fiche sans liste garde le comportement d'avant, piloté par `unpaid_teacher_ids`.

## Les retards de paiement — chaque mois reste indépendant

Le cas se produit tous les mois. Au moment de régler le **M1**, deux élèves n'avaient rien versé :
leur part est **retenue**, et l'enseignant touche le M1 sans elle. Ils s'acquittent ensuite **de
leur M1** — c'est ce mois-là, et lui seul, qui libère ces parts-là — et quand vient le tour du
**M2**, ces parts de M1 sont de nouveau dues.

Elles n'appartiennent pas au M2. L'écran de règlement leur donne donc **leur propre tableau** —
« **Retards de paiement & séances libres** », dont la première moitié liste l'élève, l'emploi du
temps, le **mois d'origine**, les dates des séances et le montant — cochées d'office, réglées par le
même versement, et **imprimées à part** sur la fiche de paie. Le mois déjà réglé n'est plus jamais
recoché comme s'il restait à payer, et son écran ne propose même plus de bouton pour le faire.

La seconde moitié du même tableau porte les **séances libres** du mois : les élèves de passage
n'ont ni fiche, ni solde, ni mois, mais ce qu'ils ont payé se partage comme le reste, et la part de
l'enseignant se règle avec le mois où leur séance est tombée. Les deux moitiés ont la même nature :
ce que ce règlement doit à l'enseignant **en dehors des élèves inscrits du mois**.

Le règlement fige ce qu'il a rattrapé (`teacher_payments.arrears`), si bien que l'historique le
relit des mois plus tard. Depuis la fiche de l'enseignant, chaque règlement se **voit**, se
**corrige** (le net, la date, le libellé — la caisse suit) et s'**annule** : tout ce qu'il avait
soldé redevient alors dû, présences comprises.

## Qui doit les frais d'inscription

Ils étaient réclamés à tous les élèves payants. L'écran **Abonnements** choisit désormais le
périmètre : **tout le monde**, un **niveau** entier (« tout le secondaire »), des **classes**
nommées, ou des **emplois du temps** cherchés par leur nom. L'écran « Nouvel élève » interroge
exactement ce périmètre : un enfant qui ne coche que des emplois hors périmètre ne se voit rien
réclamer ; pour les autres, l'écran propose de les **encaisser tout de suite** ou de **créer la
fiche avec la dette**, qui reste visible jusqu'à son règlement.

## Dettes & frais divers d'un élève

Une famille ne doit pas que des séances. Elle doit un **livre**, une **tenue de sport**, une
**sortie**, un **transport**, une **vitre cassée** — et la réception n'avait nulle part où l'écrire.
Ces sommes finissaient sur un carnet, ou dans la description d'un paiement, où aucune alerte ne les
retrouvait le jour où l'élève repassait au comptoir.

**Créer un frais** demande trois choses, parce que c'est tout ce qu'on sait au moment de le saisir :
un **nom**, un **montant**, une **date**. La description est facultative — « Livre de mathématiques »
se suffit à lui-même. Le bouton **« Nouveau frais »** est sur la carte de l'élève (menu ⋮), dans sa
fiche détaillée, sur l'écran « Payer & recharger », et sur chaque ligne de la feuille de présence de
ses groupes.

**Il se règle en une ou plusieurs fois.** On coche les frais que la famille paie, on **corrige
chaque montant** si elle ne donne qu'une partie, et l'écran annonce **avant d'écrire** ce qui
restera dû. Un versement partiel est le cas normal : le frais reste ouvert pour la différence, et
l'alerte continue de le dire. Chaque versement écrit sa ligne dans l'**historique de l'élève** et
son **entrée en caisse**, à la date choisie, avec son reçu imprimable.

**Où l'alerte apparaît :**

| Écran | Ce qu'on y voit |
| ----- | --------------- |
| Carte de l'élève (**Étudiants**) | un bandeau rouge **« Dettes & frais divers »** avec le total dû, cliquable pour encaisser ; le filtre **« En dette »** compte ces frais comme le reste |
| **Fiche détaillée** → onglet Paiements | chaque frais avec ce qu'il a coûté, ce qui a été versé dessus, ce qui reste dû et le détail de ses règlements |
| **Payer & recharger les soldes** | la liste des frais ouverts, à cocher et à encaisser, sous les soldes des emplois du temps |
| **Feuille de présence** d'un groupe | le bandeau du groupe et une colonne **« Frais & avances »** par ligne |

**Deux origines**, et la différence se lit à l'écran. Un frais **saisi** par la réception, et un
frais **avancé par l'école** — la dette de scolarité que la caisse a réglée à la place de la famille
pour débloquer la part d'un enseignant. Le second porte une pastille **« Avancé par l'école »** et se
rembourse exactement comme le premier.

**Ce qu'un frais ne fait pas — et c'est voulu : il ne retient PAS la paie d'un enseignant.** Seule
la scolarité le fait (les soldes dans le rouge, les restes d'anciens paiements, les frais
d'inscription). Un livre impayé ne regarde pas le professeur de mathématiques, et une avance faite
POUR débloquer sa part ne peut évidemment pas la rebloquer en devenant un frais. C'est pourquoi un
règlement de frais porte toujours `rest = 0` : ce qui reste dû vit **sur le frais**
(`amount − paid_amount`), jamais sur le versement, où il se lirait comme une scolarité impayée.

**Créer un frais ne bouge pas un dinar** : c'est une créance, pas un encaissement. Seul son
règlement écrit une entrée en caisse. Le supprimer retire ses règlements **et** leurs entrées, donc
la recette du jour ne compte jamais de l'argent qui n'est pas dans le tiroir. Un élève effacé
emporte ses frais.

## Le deuxième téléphone d'un élève

Le premier numéro est celui qu'on compose ; le second est celui qu'on compose quand le premier ne
répond pas — la mère, l'oncle, le voisin. Il se saisit à la création comme à la modification
(`students.phone2`, facultatif), s'affiche partout où le premier s'affiche — fiche détaillée,
feuille de présence, listes imprimées — et **la recherche d'élève le balaie comme le premier** :
une famille qui appelle depuis l'autre ligne se retrouve du premier coup.

## Un emploi du temps sur PLUSIEURS niveaux

Le cas est courant : un même créneau réunit la **4ᵉ année moyenne** et la **3ᵉ année secondaire** —
même heure, même salle, même enseignant — mais chaque niveau amène **ses propres groupes**. Il
fallait jusqu'ici créer deux emplois du temps qui se marchent sur les pieds : deux fois la même
salle au même moment, deux tarifs à tenir en phase, deux feuilles de présence pour une seule séance.

L'écran de création bascule désormais entre **« Un seul niveau »** et **« Plusieurs niveaux »** :
on coche les classes, puis les groupes **de chaque classe**. Ce découpage est enregistré dans
`schedule_sessions.class_groups` :

```json
{ "cls-4am": ["grp-a", "grp-b"], "cls-3as": ["grp-c"] }
```

Les colonnes existantes gardent leur sens et continuent d'être remplies — `class_id` la première
classe, `group_ids` **l'union** de tous les groupes — si bien que le scan, la feuille de présence,
les tarifs, la paie et les rapports lisent exactement ce qu'ils lisaient avant.

## Encaisser un solde : « + 1 séance », compté depuis sa PREMIÈRE séance du mois

La réception connaissait le prix d'une séance, le nombre de séances que l'élève avait à payer, et
refaisait la multiplication de tête. La fenêtre « Encaisser un solde » propose désormais deux
boutons :

- **« + 1 séance »** ajoute le prix d'une séance au montant saisi ;
- **« Proposition »** pose directement le total, d'un seul clic.

**Le calcul part de sa première séance du mois, jamais de son dernier pointage** — parce que *venir
à une séance ne la paie pas*. Un élève entré à la séance 1 et pointé une fois en est à sa
**deuxième**, et il doit toujours les **quatre** : lui proposer les trois qui restent laisserait la
première impayée, et le mois se terminerait avec un trou que personne ne verrait passer.

Le plafond vaut donc **son mois entier moins ce qu'il a déjà versé dessus** : rien de versé sur un
mois à quatre séances de 450 DA → 1 800 DA proposés, quatre clics possibles ; deux séances déjà
payées → 900 DA proposés, deux clics. Passé ce plafond, le bouton se verrouille — on ne facture pas
plus que le mois.

Un élève entré en cours de mois n'a jamais à payer les séances tenues avant lui : elles ne furent
jamais les siennes, et son mois ne compte que les autres. Le champ reste **libre** — ces boutons
écrivent dedans, ils ne le remplacent pas.

## La feuille de présence compte sa journée

Cinq cartes, en tête de la feuille du groupe : **élèves du groupe**, **présents**, **absents**,
**séance annulée**, **à pointer**. Elles lisent les mêmes lignes que le tableau, donc chaque clic
sur « présent » ou « absent » les déplace dans la seconde — il n'y a rien à rafraîchir.

## La paie de l'enseignant — un mois à la fois, trois tables, un net

On ne règle plus « tout ce qu'un enseignant a fait » d'un bloc. L'écran suit trois temps, dans
l'ordre où la réception pense :

1. **Ses emplois du temps**, un par carte, avec ce que chacun lui doit encore.
2. **Ses mois, de M1 à M12**, chacun disant deux choses d'un coup d'œil : où en sont ses séances
   (« **4/4** » = le mois est clos et peut être réglé, « **3/4** » = il court encore) et **s'il a
   déjà été réglé**. Les douze sont toujours là, même vides : c'est un calendrier, pas un journal.
3. **Le mois ouvert**, et ses trois tables :

| Table | Ce qu'elle contient | Ce qu'elle totalise |
| ----- | ------------------- | ------------------- |
| **1. Élèves du mois** | une ligne par élève, ses séances S1…Sn comme sur la feuille de présence, ce qu'il a versé, ce qu'il doit, et la part qu'il rapporte : **part du mois ÷ séances × ses séances payables**, au centime | ce que le mois rapporte |
| **2a. Retards de paiement** | les élèves qui ont payé **en retard** un mois DÉJÀ réglé — avec leur **mois d'origine** et les dates concernées. Les élèves qui n'ont toujours pas payé n'y figurent pas | ce qui est rattrapé |
| **2b. Séances libres** | les **élèves de passage** venus sur ce mois : prix payé, part de l'école, et ce qui revient à l'enseignant | ce que les passagers lui rapportent |
| **3. Retenues** | dépenses avancées par l'école, acomptes, scolarité **encore due** de ses enfants, et scolarités **déjà créditées au guichet** et portées sur ce salaire — les lignes déjà réglées restent affichées, marquées comme telles | ce qui est repris |

Et le net : **table 1 + table 2a + table 2b − table 3**. Le résumé détaille chaque ligne — combien
d'élèves sont réglés sur combien, ce qui reste retenu, ce que les passagers ont encaissé et ce que
l'école en garde, et les retenues **nature par nature** — pour qu'une paie qu'on ne comprend pas ne
soit jamais une paie qu'on refait.

Exemple : un mois à **1 800 DA** dont l'école garde 650 laisse **1 150 DA** à l'enseignant, soit
**287,50 DA** la séance sur quatre. Un élève présent aux quatre lui rapporte exactement 1 150 DA —
la division garde ses décimales, sinon la somme des lignes cesse d'égaler le total versé.

**Une séance non payée RETIENT sa part** : la case de l'élève ne se coche pas, et le montant est
affiché comme retenu. Ce qui bloque, c'est **ce mois-ci, sur cet emploi du temps** — un élève à jour
ici débloque la paie même s'il doit encore ailleurs, et un élève qui a payé deux séances sur quatre
en débloque deux.

**Les élèves qui n'ont pas payé sont listés en tête d'écran**, avant les tables : leur nom, leurs
séances, ce qu'ils doivent sur le mois et la part qu'ils retiennent. Deux issues s'écrivent sur
place, sans quitter la paie :

- **Encaisser** — la famille paie **maintenant**, au guichet : l'argent entre en caisse, son solde
  est crédité sur ce mois de cet emploi, et la part se débloque dans la seconde. Le montant dû est
  proposé, avec les raccourcis « + 1 séance » et « le mois entier ».
- **Payer de la caisse** — l'école **avance** ce que l'élève doit sur cet emploi du temps pour ne
  pas faire attendre l'enseignant : la part se débloque et l'élève passe **en rouge**. L'alerte des
  sommes ainsi avancées est portée par l'écran **« Étudiants »**, à qui elles sont réclamées.

Un élève laissé tel quel n'empêche rien : sa part reviendra d'elle-même dans les **retards de
paiement** du mois suivant, le jour où il s'acquittera.

Le règlement fige ses trois tables dans `teacher_payments.board` : « voir le détail », la
réimpression de la fiche de paie et les rapports relisent cette photographie **sans jamais la
recalculer** — un tarif corrigé six mois plus tard ne peut pas contredire ce qui a été versé. Le
mois passe alors à « Réglé », et se **corrige** (le net, la date, le libellé — la caisse suit) ou
s'**annule** : tout ce qu'il avait soldé redevient dû et le mois redevient réglable.

**Un mois réglé ne se repaie pas.** Le bouton d'enregistrement **disparaît**, les cases des trois
tables se figent, et il ne reste que « Modifier » et « Supprimer ». Si des parts se libèrent après
coup — un élève paie en retard, une séance libre tombe sur ce mois — l'écran le **dit**, et renvoie
au règlement **suivant** : c'est là, dans sa table « Retards de paiement & séances libres », qu'elles
se rattrapent. Jamais en repayant le mois.

Une part que le règlement **nomme** est marquée réglée, sans second filtre. C'est ce qui a corrigé le
« double » que la réception voyait : la part était cochée, le net sortait de la caisse, la fiche
s'imprimait — mais un contrôle global (« cet élève doit-il quelque chose, **quelque part** ? »)
empêchait la ligne de passer à « payée », si bien qu'elle revenait au mois suivant et que le mois
lui-même s'affichait encore « à régler ». Deux cas le déclenchaient tous les mois : un élève à jour
sur son groupe mais devant encore des **frais d'inscription**, et un **retardataire** qui a soldé son
M1 alors qu'il vit déjà son M2.

L'historique de la fiche enseignant filtre par **emploi du temps** et par **mois**. La **caisse**
déplie chaque règlement (emploi, mois, élèves, arriérés, retenues, net) et les **rapports** ajoutent
un filtre « Mois (paie) » plus deux tableaux détaillés : les élèves réglés ligne à ligne, et les
retenues ligne à ligne.

## Ce que chaque emploi du temps a encaissé

Le tableau de bord porte, sur chaque créneau de la grille et dans le tableau des tarifs du jour, le
**total encaissé depuis le premier jour** : la somme de tous les versements de ses élèves, tous mois
confondus — à ne pas confondre avec la recette du jour, qui ne compte que les séances pointées
aujourd'hui.

## Les travailleurs — métiers, comptes, droits, et qui a fait quoi

L'écran **Travailleurs** gère le personnel qui n'enseigne pas : la réception, la sécurité, le
ménage — et tout autre métier que l'école emploie.

### Le métier se crée dans le formulaire

Il n'y avait que trois métiers, écrits dans le code et imposés par une contrainte de la base. Le
chauffeur, le cuisinier et le surveillant n'existaient pas. Les métiers sont désormais des lignes
de `worker_roles` : on les **ajoute et on les retire depuis le formulaire de création**, sans
quitter l'écran. Supprimer un métier laisse les fiches qui le portaient **sans métier** — leur
paie et leur historique ne bougent pas.

### Le compte de connexion s'active, il ne se devine plus

Un travailleur avait un compte dès qu'un email avait été tapé sur sa fiche. On répond maintenant
**oui ou non**, et l'email, le nom d'utilisateur et le mot de passe ne sont demandés que si la
réponse est oui. Retirer l'accès supprime le compte ; la fiche, les pointages et l'historique
restent intacts.

Un accès ouvert **après coup** ne déplace pas la fiche : elle garde son identifiant, et c'est le
profil du compte qui pointe vers elle (`profiles.entity_id`). Ses pointages, ses acomptes et ses
règlements restent donc là où ils sont.

### Aucun droit n'est donné d'office

Un travailleur créé aujourd'hui **ne voit rien** : sa barre latérale ne porte que « Déconnexion ».
C'est le bouton **Droits d'accès** de sa carte qui ouvre ses écrans et ses boutons, un par un :

- à gauche, **tous les écrans de l'application**, dans l'ordre de la barre latérale ;
- à droite, **les boutons de l'écran sélectionné**, nommés comme ils s'affichent au comptoir.

Cocher un écran n'ouvre aucun bouton : un travailleur peut consulter les élèves sans pouvoir en
créer un. Cocher un bouton sur un écran resté fermé l'ouvre du même geste, sans quoi le droit
serait accordé et invisible.

Le filtre s'applique à trois endroits, pas seulement au menu : la **barre latérale** ne montre que
les écrans cochés, chaque **écran** ne montre que ses boutons cochés, et la **route elle-même**
refuse une adresse tapée à la main. Les fiches antérieures à cette mise à jour (`nav_keys` absent)
gardent l'ancien menu de la réception : personne n'est verrouillé du jour au lendemain.

### Acomptes, absences et paie

| Geste | Ce qui se passe |
| ----- | --------------- |
| **Acompte** — date, description, montant | Sort de la caisse le jour même, puis **retenu une fois** sur le prochain règlement |
| **Absence** — date, description, coût | Ne sort **aucun** argent : le coût sera **retenu une fois** sur le prochain règlement |
| **Payer** | Coche ce qui est dû, coche ce qu'on retient, et verse |

L'écran de règlement pose la question dans l'ordre où elle se pose au comptoir : les **mois** non
payés (contrat mensuel), les **journées** non payées (journalier, demi-journée) ou les **journées
pointées** avec leurs heures réelles (contrat horaire) ; puis les **acomptes** et les **absences**
qui n'ont pas encore été déduits ; puis le net, **modifiable à la main**. La date du versement se
corrige (on règle parfois pour la veille) et la description est facultative.

« Ce mois est-il payé ? » se répondait autrefois en cherchant le nom de famille et « 08/2026 »
dans la **description** d'un mouvement de caisse. Deux homonymes, un libellé corrigé à la main, et
un mois payé repassait pour impayé. Un règlement est maintenant une ligne de `worker_payments` qui
nomme ce qu'elle solde. Les règlements d'AVANT la mise à jour continuent d'être relus dans les
libellés, pour qu'aucun mois déjà payé ne redevienne dû.

Acomptes et absences ne sont plus **effacés** au règlement : ils sont marqués payés, avec le
numéro du règlement qui les a pris. L'historique du travailleur garde donc trace de chaque avance
consentie. Supprimer un règlement rend l'argent à la caisse et **remet tout ce qu'il avait soldé**
— journées, acomptes, absences — en attente.

### La fiche, et l'historique de travail

La fiche se lit en deux parties : **qui il est** (identité, métier, contrat, badge, compte, date de
début de travail, ce qu'on lui doit), puis **ce qui s'est passé** — ses règlements, ses acomptes et
ses absences dans un seul journal daté, chacun avec ses trois boutons : modifier, supprimer,
imprimer. Le papier imprimé est celui de l'école, le même que le reçu d'un élève.

Un travailleur **qui a un compte** porte en plus un bouton **Historique de travail** : ce qu'il a
fait depuis son compte, jour par jour, à la minute près — les présences qu'il a pointées, les
paiements d'élèves qu'il a encaissés, les frais qu'il a portés, les élèves qu'il a inscrits, les
mouvements de caisse qu'il a saisis.

## Qui a fait l'opération

Chaque ligne que quelqu'un crée porte désormais trois colonnes : `created_by` (l'identifiant de sa
**fiche**), `created_by_name` (son nom, **recopié** au moment de l'écriture) et `created_by_role`.

Le nom est recopié plutôt que relu plus tard : un travailleur qui quitte l'école, et dont la fiche
disparaît, laisse quand même un historique lisible. La signature est posée au seul point de
passage commun à tous les écrans — un bouton n'a rien à savoir de la traçabilité, et aucune
création ne peut l'oublier.

### La cloche du tableau de bord

Un travailleur ouvre la feuille de présence d'un groupe, pointe les élèves et encaisse au passage.
L'argent entre bien en caisse, mais la direction ne le voyait qu'en dépouillant la caisse le soir.

Le tableau de bord de **l'administration seule** porte donc un bouton **« Paiements des
travailleurs »**, avec le nombre d'encaissements non lus. Chacun montre l'élève, le montant,
l'emploi du temps, **le travailleur qui l'a saisi** et l'heure. Deux boutons par ligne :
**imprimer** le reçu — celui de l'école, le même qu'au guichet — et **marquer lu**. Imprimer
propose ensuite de retirer la ligne de la liste : c'est le geste normal, il est proposé, jamais
imposé.

Ce que l'administration saisit elle-même ne remonte jamais : elle le sait déjà.

### Réimprimer le reçu d'un paiement

Dans la fiche d'un élève, onglet **Paiements**, chaque versement porte un bouton d'impression. La
famille perd son reçu, l'école en veut un double : il se rejoue depuis la ligne elle-même, sur le
même modèle qu'au guichet.

## Structure

| Domaine                          | Fichiers                                                              |
| -------------------------------- | --------------------------------------------------------------------- |
| Schéma de la base                | `supabase/schema.sql`                                                  |
| Accès Supabase                   | `lib/supabase/`, `lib/accounts/`                                       |
| Règles métier + cache            | `lib/store/data.ts`                                                    |
| Session / connexion              | `lib/store/session.ts`, `app/(auth)/login/`                            |
| Types & sélecteurs               | `lib/types.ts`, `lib/helpers.ts`                                       |
| Élèves (achat, dette, détail)    | `components/pages/StudentsPage.tsx`                                    |
| Dettes & frais divers d'un élève | `components/students/StudentCharges.tsx`                               |
| Présence / scan                  | `components/pages/AttendancePage.tsx`, `lib/useScanProcessor.ts`       |
| Mois d'emploi du temps (paie)    | `lib/teacherMonths.ts`, `components/teachers/`                          |
| Règlement d'un mois (3 tables)   | `lib/teacherPayBoard.ts`, `components/teachers/TeacherPayCenter.tsx`, `components/teachers/PayBoardView.tsx`, `lib/reports/teacherMonthPayslip.ts` |
| Espaces étudiant / parent        | `components/pages/StudentPages.tsx`, `components/pages/ParentPages.tsx` |
| Séances libres de groupe         | `components/independent/GroupSeanceSection.tsx`, `lib/reports/groupSeance.ts` |
| Feuille de présence (partagée)   | `components/attendance/PresenceSheet.tsx`                              |
| Caisse & historique des paiements| `components/pages/CashPage.tsx`                                        |
| Travailleurs (métiers, paie)     | `components/pages/AdministrationPage.tsx`, `components/workers/`, `lib/workers.ts` |
| Droits d'accès (catalogue)       | `lib/permissions.ts`, `lib/usePermissions.ts`, `components/workers/WorkerPermissionsModal.tsx` |
| Papiers des travailleurs         | `lib/reports/workerDocuments.ts`                                       |
| Cloche des paiements travailleurs| `components/dashboard/WorkerPaymentsAlert.tsx`                          |

L'application n'affiche **aucun favicon** : l'onglet du navigateur reste sans icône. Le logo
téléversé dans **Paramètres** ne sert que dans l'application et sur les documents imprimés.
