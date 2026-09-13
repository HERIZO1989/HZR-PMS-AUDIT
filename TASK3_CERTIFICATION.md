# RAPPORT DE CERTIFICATION — TASK 3
## Fiabiliser l'isolation multi-tenant (BUG-07)

**Projet** : Riviera Suite PMS · **Repository** : `HERIZO1989/HZR-PMS-AUDIT`
**Périmètre** : BUG-07 uniquement — décider et documenter le modèle réel d'isolation, prouver par des tests réels qu'un hôtel ne peut jamais accéder aux données d'un autre.

Aucune donnée existante supprimée. Aucune modification destructive. Aucun déploiement effectué sans instruction explicite.

---

## 1. Décision d'architecture

Le modèle "RLS + variables de session PostgreSQL" documenté à l'origine n'est pas réalisable avec l'architecture actuelle (client supabase-js via PostgREST, sans connexion PostgreSQL persistante permettant SET LOCAL par requête). Le migrer nécessiterait de remplacer le client Supabase REST par une connexion pg directe — hors périmètre.

Décision retenue : formaliser le modèle réellement en place (isolation applicative explicite, RLS comme filet fail-closed) comme architecture officielle, documentée dans SECURITY_MODEL.md.

---

## 2. Modifications effectuées

| Fichier | Nature |
|---|---|
| SECURITY_MODEL.md | Nouveau — documentation du modèle d'isolation reel, checklist de non-regression |

Aucune modification de code — TASK 3 est une tâche de vérification et de documentation, pas de développement.

---

## 3. Tests exécutés — résultats réels

Nouveaux tests d'exécution directe (non couverts par TASK 1) :

- add_folio_line avec hotel_id invalide sur un folio réel -> rejeté ("Folio ... introuvable pour cet hotel")
- add_payment avec hotel_id invalide sur le même folio -> rejeté, même message

Audit d'intégrité des données existantes (recherche de fuites déjà présentes) :

- Réservations dont le client appartient à un autre tenant : 0
- Réservations dont la chambre assignée appartient à un autre hôtel : 0
- Folios dont le tenant/hôtel diffère de la réservation liée : 0
- Rôles du staff appartenant à un autre tenant que le compte staff : 0

Ces requêtes ont été exécutées sur l'intégralité des données réelles de la base.

Test HTTP réel (nouveau) : l'application a été démarrée en local (build + start) et testée avec de vraies requêtes HTTP :
- Accès à une route API protégée sans cookie de session -> 401 réel obtenu
- Accès à une page protégée (/dashboard) sans session -> redirection 307 réelle vers /login

Limite découverte : le serveur Next.js s'exécute dans le même sandbox que moi, donc ses appels sortants vers Supabase sont aussi bloqués par la restriction réseau. La chaîne complète (login réel -> cookie -> accès cross-hôtel -> 403) n'a donc pas pu être testée de bout en bout en HTTP ; seule la couche middleware (avant tout appel Supabase) a été vérifiée en HTTP réel.

---

## 4. Problèmes restants

- Les routes sans fonction SQL dédiée (housekeeping PATCH, audit-findings PATCH, imports/apply) ont leur vérification d'appartenance hôtel codée uniquement en TypeScript — vérifiée par lecture de code dans l'audit initial, pas par exécution réelle comme les fonctions testées ici.
- Impossible de tester la chaîne HTTP complète de bout en bout dans mon environnement.
- Le modèle repose sur la discipline du code plutôt qu'une garantie automatique de la base — accepté comme compromis documenté.

---

## 5. Certification

| Élément | Statut |
|---|---|
| Documentation du modèle réel | CERTIFIÉ |
| Isolation add_folio_line/add_payment (hôtel invalide) | CERTIFIÉ — testé réellement |
| Isolation create_reservation/check_in/check_out/cancel (hôtel invalide) | CERTIFIÉ — testé réellement (TASK 1) |
| Absence de fuite historique dans les données existantes | CERTIFIÉ — audité sur 100% des données réelles |
| Middleware — gating HTTP réel sans session | CERTIFIÉ — testé en HTTP réel (nouveau) |
| Isolation des routes sans fonction SQL dédiée | NON VÉRIFIÉ par exécution réelle — certifié uniquement par lecture de code |
| Chaîne HTTP complète login->IDOR | NON VÉRIFIÉ — réseau sandbox restreint |

---

## 6. GO / NO-GO TASK 3

# GO TASK 3 SOUS CONDITIONS

Justification : le modèle d'isolation est désormais documenté honnêtement. Les fonctions critiques (réservation, folio, paiement) rejettent systématiquement un hotel_id falsifié, vérifié par exécution réelle. Aucune fuite n'existe dans les données réelles actuelles. Un vrai test HTTP a été obtenu pour la première fois sur la couche middleware.

Conditions avant GO complet :
1. Tester la chaîne HTTP complète dans un environnement avec accès réseau normal
2. Étendre la couverture de test réel aux routes sans fonction SQL dédiée

Je n'ai déployé aucun code (TASK 3 ne modifie aucune route applicative) et n'ai commencé aucune autre tâche.
