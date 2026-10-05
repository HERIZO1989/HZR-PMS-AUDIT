# TASK 27 — Audit RLS / RBAC multi-tenant et moindre privilege (anon / authenticated)

## Ce qui a ete teste sur la base reelle (transactions annulees d'office)
- Isolation RLS : en `anon` sans contexte, seules `permissions` (6) et `billing_plans` (3) sont lisibles (lecture publique voulue) ;
  en `authenticated` avec le contexte tenant Anjary : 0 ligne d'un autre tenant, sur toutes les tables a `tenant_id` ;
  ecritures croisees (deplacer une chambre vers l'hotel d'un autre tenant, ecrire un evenement d'audit pour un autre tenant) : refusees.
- Acces objet (IDOR) via les fonctions SQL, avec le hotel_id d'Anjary sur des objets de Riviera : add_payment, add_folio_line, check_in,
  cancel, update_reservation, advance_housekeeping_task -> tous refuses ("introuvable pour cet hotel"), donnees inchangees.
- Routes API (revue statique) : toutes les routes metier exigent une session ; seules login, webhook Stripe (signature) et health sont publiques ;
  `imports/[batchId]/apply` verifie que le lot appartient a l'hotel de la session.

## Faille corrigee (migration `20261012000000_least_privilege_anon_authenticated.sql`, appliquee a la base)
- anon et authenticated avaient TOUS les privileges sur toutes les tables, dont TRUNCATE, que le RLS ne filtre pas, et EXECUTE sur 28 fonctions.
  L'application n'utilise que service_role (verifie : src, importService, tests) : ces droits n'avaient aucun usage legitime.
- Apres correctif : anon ne lit plus que billing_plans et permissions ; plus de TRUNCATE/TRIGGER/REFERENCES ; authenticated ne peut plus ecrire dans
  les tables d'identite/securite/facturation (staff_users, roles, audit_events, subscriptions, tenants...), ne lit plus `password_hash`,
  n'a plus acces a login_attempts / revoked_sessions ; seules 4 fonctions restent ouvertes (helpers `app_current_*` / `app_has_permission`, necessaires aux policies) ;
  service_role garde tout ; les futurs objets ne sont plus attribues automatiquement a anon/authenticated.
- Verifie apres application : audit fonctionnel en service_role, RLS toujours evaluee pour authenticated, 0 fonction sans droit service_role.

## Limites / non couvert
- Cas "meme tenant, deux hotels" non teste : chaque tenant n'a qu'un hotel aujourd'hui. A tester des qu'un tenant multi-hotels existe.
- `apply_import_batch(p_batch_id)` ne recoit pas d'hotel : le controle d'appartenance repose sur la route API (present), pas sur la fonction.
- Pas de test de charge, de fuzzing d'API ni de revue du flux de session/JWT (SESSION_SECRET) dans ce passage.
- Si un jour le front utilise la cle anon/authenticated directement, il faudra accorder explicitement les droits necessaires table par table.
