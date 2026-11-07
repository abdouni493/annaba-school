# ALTECH SCHOOL — Mesures avant / après

> Date : 2026-11-07. Ce fichier suit la consigne : **ne pas inventer de gains**.
> Les mesures que je ne pouvais pas obtenir sont marquées **INDISPONIBLE** avec
> la raison. Les sections à remplir après application du SQL et déploiement sont
> laissées en gabarit reproductible.

## Ce qui a pu être exécuté dans cet environnement

| Vérification | Commande | Résultat |
|---|---|---|
| Types | `npx tsc --noEmit` | ✅ 0 erreur |
| Lint des fichiers modifiés | `npx eslint lib/supabase/load.ts lib/store/data.ts` | ✅ 0 erreur (2 warnings préexistants, lignes non touchées) |
| Build prod | `npm run build` | ✅ succès (30 routes générées) |
| Tests unitaires | `npm test` | 538 passés / 4 échecs **préexistants** (voir ci-dessous) + 7 nouveaux tests passés |

### Échecs de tests préexistants (NON causés par ce lot)
Vérifié par `git stash` sur la base de départ : les mêmes **4 tests**
échouaient AVANT toute modification (ex. `tests/teacherPayroll.test.ts` —
arithmétique de paie, sans rapport avec les fichiers touchés). Conformément à la
consigne « corriger les échecs *causés par le travail* », ils ne sont pas
modifiés ici et sont signalés tels quels.

## Mesures live (prod) — INDISPONIBLE

| Scénario | Métrique visée | Statut | Raison |
|---|---|---|---|
| Login → interactif | p50/p95 ms | **INDISPONIBLE** | Pas d'identifiants autorisés ; ne jamais contourner la connexion |
| Navigation entre écrans | p50/p95 ms | **INDISPONIBLE** | idem (écrans derrière auth) |
| Recherche/liste élèves | ms, octets | **INDISPONIBLE** | idem |
| Sauvegarde présence | clic → commit durable | **INDISPONIBLE** | idem |
| Sauvegarde versement | clic → commit durable | **INDISPONIBLE** | idem |
| Octets/requêtes au démarrage | count/bytes | **INDISPONIBLE en live**, mais **borné analytiquement** ci-dessous |

## Estimation analytique de l'empreinte de démarrage (vérifiable par SQL)

Le code lit **toutes** les tables (`lib/supabase/load.ts`). Le volume
téléchargé au login = Σ (lignes × taille_ligne) sur les 42 tables. Pour le
chiffrer **sur vos données réelles**, lancer les blocs 1 et 2 de
`supabase/performance/01_diagnostics_read_only.sql` :

- Bloc 1 → taille par table (octets).
- Bloc 2 → nombre de lignes des tables lourdes.

Nombre de requêtes de démarrage (modèle actuel) ≈
`1 (school) + Σ ceil(rows_table / 1000)` sur les 42 tables.
Exemple : 15 000 présences → 15 requêtes rien que pour cette table. À 50 000
lignes cumulées sur 3 tables lourdes → ~50 requêtes de première charge.

> Après passage en lecture scoper par écran (feuille de route P1), la cible est
> **> 50 % d'octets/requêtes en moins au démarrage** (seuls les résumés de
> tableau de bord + la 1ʳᵉ page de chaque liste sont chargés). À confirmer par
> l'onglet Réseau (DevTools) avant/après, procédure ci-dessous.

## Procédure reproductible (à exécuter après déploiement)

1. **Jeux de données synthétiques** (ne pas utiliser de données réelles d'élèves
   inutilement) : peupler une base de staging à 1 k / 10 k / 50 k lignes
   d'historique (présences, versements, caisse).
2. **Réseau** : DevTools → Réseau, cocher « Disable cache », recharger le login,
   relever *requests* et *transferred* jusqu'à « interactif ».
3. **Latence** : DevTools → Performance, ou `performance.now()` autour de
   `fetchAll()` ; relever p50/p95 sur 10 essais.
4. **Rendu React** : React DevTools Profiler, compter les *commits* en tapant
   dans la recherche élève (avant/après sélecteurs granulaires).
5. **Bundle** : `ANALYZE=1 npm run build` (après ajout de
   `@next/bundle-analyzer`) ou inspecter la sortie de build (tailles de chunks).
6. **SQL** : relancer les blocs 4 et 6 des diagnostics ; vérifier que
   `seq_scan` recule au profit d'`idx_scan` sur les tables passées en lecture
   filtrée.

| Scénario | Avant (à remplir) | Après (à remplir) | Δ |
|---|---|---|---|
| Login → interactif (p95) | | | |
| Octets démarrage | | | |
| Requêtes démarrage | | | |
| Sauvegarde présence (clic→commit) | | | |
| Commits React / frappe recherche | | | |
