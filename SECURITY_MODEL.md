# Modèle d'isolation multi-tenant — Riviera Suite PMS

Ce document remplace l'affirmation initialement incorrecte ("isolation via RLS + variables
de session PostgreSQL") par une description fidèle à ce qui est réellement en place, conformément
au BUG-07 du rapport d'audit.

## Pourquoi le modèle "RLS + variables de session" n'est pas utilisé

Le backend communique avec Supabase via `@supabase/supabase-js`, qui passe par l'API REST
PostgREST — pas par une connexion PostgreSQL directe et persistante. `SET LOCAL app.tenant_id`
nécessiterait d'exécuter cette commande *dans la même transaction* que la requête métier, ce que
PostgREST ne permet pas d'orchestrer depuis un client REST classique (chaque appel HTTP est une
requête indépendante, sans notion de session applicative côté PostgreSQL).

Migrer vers ce modèle exigerait de remplacer `supabase-js` par une connexion `pg` directe
(pool de connexions PostgreSQL), gérée manuellement dans chaque route API — un changement
d'architecture significatif, hors du périmètre minimal de correction.

## Le modèle réellement en place

1. **Toutes les requêtes serveur utilisent `SUPABASE_SERVICE_ROLE_KEY`**, qui contourne RLS par
   nature (comportement standard de Supabase pour les clés service role).
2. **L'isolation réelle est appliquée explicitement dans chaque route API** : la route lit la
   session (JWT signé serveur, `hotelId`/`tenantId` qui y sont inclus), puis :
   - compare le `hotelId`/`tenantId` demandé par le client à celui de la session (rejette avec 403 si différent) ;
   - filtre chaque requête Supabase avec `.eq('hotel_id', hotelId)` ou `.eq('tenant_id', tenantId)` ;
   - pour les routes mutatives, revérifie l'appartenance de la ressource ciblée (ex. une réservation)
     à l'hôtel de la session *avant* toute modification.
3. **Les policies RLS restent actives sur les 29 tables**, mais jouent aujourd'hui le rôle d'un
   filet de sécurité *fail-closed* : si une clé non-service-role venait un jour à être utilisée
   (ex. appel direct depuis le navigateur, erreur de configuration), les policies évaluent
   `app_current_tenant_id() = NULL` (jamais posé) et **refusent tout accès par défaut**, plutôt que
   d'exposer les données. Ce n'est pas une protection active aujourd'hui, mais un garde-fou en cas
   de mauvaise utilisation future de l'architecture.

## Conséquence assumée

La correction de l'isolation multi-tenant ne dépend d'aucun mécanisme automatique de la base de
données : **elle dépend entièrement de la rigueur du code de chaque route API**. C'est un choix
d'architecture désormais explicite (et non plus une lacune non documentée), compensé par :
- une convention systématique appliquée à toutes les routes existantes (vérifiée route par route
  dans le rapport d'audit et les rapports TASK 1/TASK 2) ;
- la checklist de non-régression ci-dessous, à exécuter à chaque ajout de route touchant une
  ressource multi-tenant.

## Checklist de non-régression (à exécuter pour toute nouvelle route)

Pour chaque nouvelle route lisant ou modifiant une ressource liée à `hotel_id`/`tenant_id` :

1. La route appelle `getSessionFromRequest`/`getSession` et rejette (401) si absente.
2. La route compare le `hotelId`/`tenantId` fourni par le client à celui de la session (403 si différent).
3. Toute requête Supabase inclut `.eq('hotel_id', ...)` ou `.eq('tenant_id', ...)`.
4. Pour les mutations sur une ressource existante (par id), la route relit la ressource et vérifie
   son `hotel_id` réel avant modification — ne pas se fier uniquement au `hotelId` de la session.
5. Test de régression : appeler la route avec l'id d'une ressource appartenant à un autre hôtel ;
   attendre un rejet (403/404), jamais un succès ni une fuite de données.

## Vérification réalisée (TASK 3)

Voir `TASK3_CERTIFICATION.md` pour le détail des tests exécutés route par route.
