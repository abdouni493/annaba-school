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
- **Supabase** — PostgreSQL (32 tables métier), Auth (email + mot de passe), Storage (logo, images)
- **Zustand** — le store `lib/store/data.ts` porte les règles métier et sert de cache de la base
- **Tailwind v4**, **framer-motion**, **lucide-react**

## Installation

### 1. Créer le schéma

Ouvrir le **SQL Editor** du projet Supabase et exécuter **`supabase/schema.sql`** en entier.
Le script est idempotent (relançable sans risque) et crée :

| Section | Contenu |
| ------- | ------- |
| 1–2 | extensions, `profiles`, et les fonctions de comptes (`admin_exists`, `bootstrap_admin`, `admin_create_user`, `admin_set_password`, `admin_set_email`, `admin_delete_user`) |
| 3–4 | les 32 tables métier, leurs clés étrangères et leurs index |
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
  (fin 10:00 / début 10:00) ne sont pas un conflit.

Le badge, la feuille de présence et le tableau de la semaine lisent tous l'horaire **du jour** :
un créneau déplacé un seul jour de la semaine est accepté à sa nouvelle heure, pas à l'ancienne.

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
- **Payer** — le règlement s'ouvre sur le **dernier mois CLOS non réglé**, jamais sur le mois en
  cours : si le groupe en est à la 3ᵉ séance d'un mois de 4, c'est le mois précédent qui est
  coché. Les mois sont regroupés par emploi du temps, chacun montrant qui a payé et qui n'a pas
  payé. La formule **par groupe** additionne les tarifs déjà écrits sur chaque présence (part
  enseignant du mois ÷ séances), le **pourcentage** s'applique au tarif de chaque élève, le
  **montant fixe** se répartit au prorata.

Un élève qui n'a pas payé **retient** la part correspondante : elle n'est pas versée, elle reste
ouverte et **réapparaît au règlement suivant** dès que sa dette est soldée. Les cas d'élèves sont
appliqués à la source : **cas spécial** (gratuit) et **école seule** ne rapportent rien à
l'enseignant concerné, et une **réduction** ne lui coûte que *sa* part de la remise.

### Alertes

Séances épuisées, inscription à 2 séances ou moins, abonnement mensuel ou formation bientôt expiré
(ou déjà expiré, avec les séances perdues), et reste à payer non réglé : signalés dans les toasts du
scan, sur la carte élève, dans le détail de la fiche, et dans les espaces étudiant et parent.

## Structure

| Domaine                          | Fichiers                                                              |
| -------------------------------- | --------------------------------------------------------------------- |
| Schéma de la base                | `supabase/schema.sql`                                                  |
| Accès Supabase                   | `lib/supabase/`, `lib/accounts/`                                       |
| Règles métier + cache            | `lib/store/data.ts`                                                    |
| Session / connexion              | `lib/store/session.ts`, `app/(auth)/login/`                            |
| Types & sélecteurs               | `lib/types.ts`, `lib/helpers.ts`                                       |
| Élèves (achat, dette, détail)    | `components/pages/StudentsPage.tsx`                                    |
| Présence / scan                  | `components/pages/AttendancePage.tsx`, `lib/useScanProcessor.ts`       |
| Mois d'emploi du temps (paie)    | `lib/teacherMonths.ts`, `components/teachers/`                          |
| Espaces étudiant / parent        | `components/pages/StudentPages.tsx`, `components/pages/ParentPages.tsx` |

L'application n'affiche **aucun favicon** : l'onglet du navigateur reste sans icône. Le logo
téléversé dans **Paramètres** ne sert que dans l'application et sur les documents imprimés.
