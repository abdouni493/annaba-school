# ALTECH SCHOOL — Runbook SQL Phase 2 (exécution MANUELLE)

> Destiné à l'administrateur. **Rien n'est exécuté automatiquement.** Tous les
> scripts vivent dans `supabase/phase2/`. Chaque changement est idempotent et
> fourni avec vérification + rollback.

## Règle d'or de l'ordre de déploiement

La sécurité (RLS par rôle) et les lectures ciblées sont **couplées** :
restreindre la RLS **avant** que les portails ne lisent de façon ciblée
viderait les écrans élève/parent/enseignant (aucune perte en base, mais
affichage cassé). D'où cet ordre :

| Étape | Quoi | Où | Risque prod |
|---|---|---|---|
| 0 | Sauvegarde complète | Supabase → Database → Backups | — |
| 1 | **Diagnostics** (lecture seule) | `00_read_only_diagnostics.sql` | Nul |
| 2 | **Index** ciblés | `03_targeted_indexes.sql` | Faible (en ligne) |
| 3 | **RPC atomiques** (installés, non activés) | `02_atomic_operations.sql` | Faible |
| 4 | **Transition identifiants** (fonction seule) | `04_credentials_transition.sql` | Faible |
| 5 | Déployer le code de lecture scoper derrière drapeaux + tester avec de **vrais JWT** par rôle | app | Moyen |
| 6 | **RLS par rôle** | `01_access_policies.sql` | **Élevé** — seulement après 5 |

> Les RPC (étape 3) ne s'exécutent que lorsque les drapeaux
> `NEXT_PUBLIC_FF_ATOMIC_*` sont activés **et** après que le code appelant est
> déployé. Tant que les drapeaux sont `false`, l'ancien miroir écrit : **jamais
> de double écriture**.

---

## Étape 1 — Diagnostics (`00_read_only_diagnostics.sql`)
- **Prérequis** : aucun. **Backup** : inutile (lecture seule).
- Exécuter bloc par bloc, conserver les sorties (bloc 1 = policies ouvertes,
  bloc 5 = mots de passe en clair, etc.).
- **Résultat attendu** : liste des `using (true)` sensibles, tables sans RLS,
  fonctions SECURITY DEFINER, tailles.
- **Rollback** : sans objet.

## Étape 2 — Index (`03_targeted_indexes.sql`)
- **⚠️ `CREATE INDEX CONCURRENTLY` ne peut PAS tourner dans une transaction.**
  Lancer **chaque instruction séparément** dans SQL Editor.
- **Backup** : recommandé (prudence). **Risque** : faible, en ligne.
- **Vérification** : bloc « VÉRIFICATION » du fichier (6 index attendus, 0 invalide).
- **Rollback** : `drop index concurrently if exists …` (fourni, une par une).
- Base petite / staging : variante **sans** CONCURRENTLY (tout d'un bloc).

## Étape 3 — RPC atomiques (`02_atomic_operations.sql`)
- **Prérequis** : aucun schéma modifié ; crée `operation_log` + 2 fonctions.
- **Backup** : recommandé. **Risque** : faible (rien n'appelle les RPC tant que
  les drapeaux sont off).
- Peut tourner **d'un bloc** (transactions `begin/commit` incluses).
- **Vérification** : `prosecdef=true`, `search_path=public` (bloc fourni) ; test
  d'idempotence **sur staging uniquement**.
- **Rollback** : `drop function …` (fourni). Ne pas supprimer `operation_log`
  s'il sert déjà.

## Étape 4 — Transition identifiants (`04_credentials_transition.sql`)
- Installe `reset_student_password` (réinitialise via Supabase Auth, aucun clair).
- **Ne vide PAS** la colonne en clair (étape destructrice commentée, décision admin).
- **Risque** : faible. **Rollback** : `drop function …`.

## Étape 5 — Déploiement du code scoper (hors SQL)
- Activer `NEXT_PUBLIC_FF_SCOPED_STUDENT_READS` sur un environnement de test.
- Vérifier la liste/recherche/fiche élève via le repository.
- **Tester les portails avec de vrais JWT** (élève, parent, enseignant), pas
  l'éditeur SQL (service_role contourne la RLS).

## Étape 6 — RLS par rôle (`01_access_policies.sql`)
- **⚠️ NE PAS appliquer avant l'étape 5 validée.**
- **Backup obligatoire.** Peut tourner d'un bloc (transaction incluse).
- **Vérification** : bloc (a) du fichier (plus aucun `true` sur tables sensibles)
  + bloc (b) **tests JWT par rôle**.
- **Rollback** : bloc commenté en fin de fichier (rouvre les lectures phase 1).
- **Risque : ÉLEVÉ** — une erreur masque des données aux portails (réversible via
  rollback, aucune donnée détruite).

---

## Tableau récapitulatif « à exécuter »

```
supabase/phase2/00_read_only_diagnostics.sql   -> diagnostics (lecture seule)
supabase/phase2/03_targeted_indexes.sql        -> index (CONCURRENTLY, 1 par 1)
supabase/phase2/02_atomic_operations.sql       -> RPC + operation_log (bloc)
supabase/phase2/04_credentials_transition.sql  -> reset_student_password (bloc)
-- (déployer + tester le code scoper, drapeaux) --
supabase/phase2/01_access_policies.sql         -> RLS par rôle (bloc) — EN DERNIER
```

## État d'application

| Script | Appliqué en PROD ? |
|---|---|
| 00_read_only_diagnostics.sql | ❌ (à lancer par vous) |
| 01_access_policies.sql | ❌ **NON** (en dernier, après code scoper) |
| 02_atomic_operations.sql | ❌ **NON** |
| 03_targeted_indexes.sql | ❌ **NON** |
| 04_credentials_transition.sql | ❌ **NON** |
