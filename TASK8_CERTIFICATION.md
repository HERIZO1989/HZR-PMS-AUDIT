# RAPPORT DE CERTIFICATION — TASK 8
## Nettoyage final (BUG-12, BUG-17, BUG-19, BUG-20, BUG-22)

**Projet** : Riviera Suite PMS · **Repository** : HERIZO1989/HZR-PMS-AUDIT

Aucune donnee existante supprimee (hors residus de test, voir section 2). Migrations additives. Aucun deploiement sans instruction explicite.

**Note importante** : entre TASK 7 et TASK 8, `src/lib/supabaseAdmin.ts` a ete modifie par ailleurs (ajout d'une fonction `getHotelBrand`, hors de mon perimetre — travail produit reel, non touche). Mon edit de TASK 8 sur ce fichier a ete applique de maniere ciblee pour preserver ce changement, verifie par lecture du fichier avant modification.

---

## 1. Modifications effectuees

**Base de donnees** (deja appliquees et verifiees avant la redaction de ce rapport) :
- `task8_search_path_and_extension_schema` — `search_path` fixe explicitement sur les 28 fonctions PL/pgSQL du schema public ; extension `btree_gist` deplacee de `public` vers un schema dedie `extensions`

**Code** :
| Fichier | Nature |
|---|---|
| src/lib/supabaseAdmin.ts | Modifie — suppression ciblee de `getDemoHotelId()` (code mort, BUG-19), `getHotelBrand()` preserve |
| netlify.toml | Supprime — deploiement fait sur Render, pas Netlify (BUG-20) |
| package.json | Modifie — suppression dependance `@netlify/plugin-nextjs` |
| src/lib/stripe.ts | Modifie — garde-fou bloquant une cle `sk_live_` hors production explicite (BUG-22) |
| supabase/README.md, SCHEMA_REFERENCE.md, migrations/*.sql | Nouveau — documentation et export partiel des migrations (BUG-17) |

---

## 2. Decouverte importante en cours de tache : residus de test accumules

En verifiant l'etat de la base avant nettoyage, plusieurs tenants `VITEST Tenant` orphelins ont ete trouves, accumules par les executions CI (TASK 6/7) dont le nettoyage automatique (`afterAll`) n'avait pas pu s'executer a chaque fois. Ils ont ete identifies precisement (par nom, aucune ambiguite avec les donnees reelles) et supprimes. **Les hotels de production n'ont jamais ete touches.**

Point operationnel a surveiller : chaque push declenchant la CI cree de vraies donnees dans le projet Supabase de production. Recommandation pour l'avenir : pointer la CI vers un projet Supabase de test separe — non traite dans cette tache (changement d'infrastructure hors perimetre nettoyage).

---

## 3. Tests reels

- Apres deplacement de `btree_gist` : nouvelle tentative de double-reservation sur un hotel de test → toujours rejetee avec l'erreur 23P01 (la contrainte EXCLUDE fonctionne identiquement apres le changement de schema de l'extension)
- `Supabase:get_advisors(security)` relance apres correction : 0 lint restant (les alertes `search_path` ont disparu)
- Typecheck : 0 erreur
- Build : succes, toutes les routes generees, aucune regression
- Verification que `@netlify/plugin-nextjs` n'est plus installe : confirme

---

## 4. Limitation assumee — BUG-17 partiel

Pas de dump SQL complet et parfaitement rejouable des tables/fonctions restantes. Retranscrire manuellement plusieurs milliers de lignes de SQL depuis l'historique de conversation comporte un risque reel de divergence silencieuse avec la version reellement deployee. Livre a la place : un sous-ensemble de fonctions exporte tel quel (`pg_get_functiondef`, garanties exactes), une liste verifiee des tables/index/policies, et une recommandation explicite d'utiliser `supabase db pull` pour un dump exhaustif.

---

## 5. Certification

| Element | Statut |
|---|---|
| search_path corrige sur toutes les fonctions (BUG-12) | CERTIFIE — 0 lint restant |
| Extension btree_gist deplacee sans regression | CERTIFIE — contrainte retestee avec succes |
| Code mort supprime (BUG-19, BUG-20) | CERTIFIE — build confirme, changement recent externe preserve |
| Garde-fou cle Stripe live (BUG-22) | CERTIFIE (code + typecheck) / NON TESTE (aucune cle live disponible) |
| Migrations versionnees en Git (BUG-17) | PARTIEL — voir limitation section 4 |

---

## 6. GO / NO-GO TASK 8

# GO TASK 8 SOUS CONDITIONS

Justification : corrections de securite reelles completes et verifiees. Nettoyage de code complet et verifie par build, en preservant le travail produit realise entre-temps par ailleurs. Le point partiel (BUG-17) est documente honnetement.

Condition avant GO complet : executer `supabase db pull` depuis un environnement avec acces reseau complet.

Aucun code deploye sans instruction explicite. Ceci cloture les 8 taches du plan de correction issu de l'audit initial.
