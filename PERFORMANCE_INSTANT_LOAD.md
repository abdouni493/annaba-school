# ALTECH SCHOOL — Chargement instantané (local-first)

> Portée : suppression de l'écran « Chargement des données… » au
> rafraîchissement et à la navigation, et bascule d'écran fluide — **sans aucun
> changement du schéma de base de données**.

## Le problème

À chaque ouverture ou rafraîchissement, l'application téléchargeait **toute** la
base avant d'afficher le moindre écran : la zone de contenu restait bloquée sur
un panneau « Chargement des données… · Connexion à la base de l'école en
cours ». Plus l'historique grossissait (présences, versements, caisse), plus
l'attente s'allongeait. La bascule d'un écran à l'autre était lente parce qu'un
**seul paquet JavaScript de ~950 Ko** réunissait tous les écrans et devait être
analysé avant d'en afficher un.

## La solution (comme Linear / Notion : « stale-while-revalidate »)

Les meilleures applications pleines de données ne font jamais attendre devant un
écran de chargement : elles gardent une **copie locale** de ce qu'elles ont lu
et la ré-affichent **aussitôt**, puis vérifient le serveur **en arrière-plan**.

### 1. Instantané local de la base (`lib/supabase/snapshotCache.ts`)

Le dernier chargement **réussi** est rangé dans **IndexedDB** (et non
`localStorage`, trop petit et bloquant), sous l'identifiant du compte. Au
démarrage suivant, cet instantané est relu en quelques millisecondes et
**peint immédiatement** : l'écran « Chargement des données… » ne s'affiche plus
jamais pour un poste déjà venu. La lecture réseau complète continue **en fond**
et remplace la donnée dès qu'elle aboutit. Tout est enveloppé de `try/catch` :
sans IndexedDB (navigation privée…), l'application retombe proprement sur
l'ancien comportement.

### 2. Démarrage « cache d'abord » (`lib/store/data.ts` → `boot()`)

`boot()` peint le cache, puis revalide. Quatre issues, toutes sûres :

| Issue | Sens | Reprise du miroir d'écriture |
|---|---|---|
| `fresh` | donnée fraîche adoptée | normale (référence = le frais) |
| `keep-local` | l'utilisateur a modifié le magasin pendant la revalidation | on **garde son travail** et on l'écrit (référence = le cache) |
| `cache-only` | base injoignable, cache affiché | **lecture seule** (miroir en pause), bandeau « Hors-ligne » + nouvelles tentatives |
| `failed` | aucun cache + échec | écran d'erreur (comportement historique) |

**Sûreté des données.** Le miroir d'écriture (`lib/supabase/sync.ts`) ne reprend
jamais sans une lecture complète fiable — règle inchangée. Une saisie faite
pendant la brève revalidation n'est **jamais perdue** : `resumeSyncFrom()` prend
le cache pour référence et écrit la différence, sans suppression par absence.

### 3. Navigation instantanée (`components/ModuleDispatcher.tsx`)

Chaque écran est désormais chargé **à la demande** (`next/dynamic`) : le paquet
d'entrée de la route `[...slug]` passe de **~950 Ko à ~11 Ko**. Pour que la
bascule reste immédiate, tous les morceaux du rôle courant sont **préchargés en
temps mort** — au clic, le code est déjà là. Une esquisse (skeleton) discrète
remplace tout panneau d'attente.

## Résultats mesurés

- Paquet d'entrée `[...slug]` : **972 Ko → 11 Ko** (`npm run build`).
- Rafraîchissement d'un poste déjà venu : contenu peint en **~200 ms**, **sans
  jamais** afficher « Chargement des données… » (vérifié au navigateur réel,
  Playwright).
- Hors-ligne : la donnée du cache reste **lisible**, bandeau « Hors-ligne »
  honnête, reconnexion automatique.
- Tests : `tests/cacheBoot.test.ts` et `tests/cacheSyncResume.test.ts` figent la
  peinture instantanée, la préservation des saisies et la sûreté du miroir.

## Round 2 — la lenteur côté CPU et côté requêtes

Après le cache, deux coûts restaient et gelaient l'application sur un vrai jeu de
données (surtout sur téléphone + petite instance Supabase) :

### 4. Les travaux de fond gelaient l'interface après le chargement

`processWeeklyAbsences()` tournait à CHAQUE ouverture admin avec, au cœur, un
`db.attendance.filter()` contenant un `db.sessions.find()` IMBRIQUÉ, le tout dans
la double boucle élève × inscription — soit `O(élèves × inscriptions × présences
× séances)`, des centaines de millions d'opérations synchrones. On précalcule
désormais les index une fois (séance par id, présences groupées par élève, fin de
pénalité par élève+abonnement) : **mêmes résultats exacts**, mais le coût
s'effondre. Et `SessionProvider` **diffère** ces travaux (avec
`dropVoidTeacherDues`) au premier temps mort : l'écran est peint et manipulable
AVANT qu'ils ne tournent.

### 5. Chaque table forçait un scan de comptage

Le chargement demandait `count: "exact"` sur chaque table — un **scan complet**
par table, à chaque lecture. Passé en `count: "estimated"` (instantané, tiré des
statistiques, aucun scan). L'exactitude n'en souffre pas : la pagination lit
désormais par vagues parallèles **jusqu'à une page incomplète**, donc aucune
ligne n'est jamais manquée, quel que soit le compte estimé (deux tests le figent,
compte trop bas ET trop haut). La concurrence entre tables passe de 6 à 10
(HTTP/2 multiplexé) pour recouvrir les allers-retours sur réseau mobile.

## Ce qui n'a PAS changé

- **Aucune** modification du schéma de base (`supabase/schema.sql`).
- **Aucune** règle métier ni aucun calcul (paie, présences, caisse).
- La sûreté d'écriture : jamais de reprise du miroir sur une lecture ratée.
