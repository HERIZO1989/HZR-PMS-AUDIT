# TASK 12 — Login non ambigu entre tenants

## Probleme
`verify_staff_login` cherchait le compte par email seul. La contrainte d'unicite est `(tenant_id, email)` :
un meme email peut exister dans plusieurs tenants (ex. `owner@demo.local` dans les tenants de demo). La base
retenait une ligne arbitraire -> login refuse alors que le mot de passe etait correct dans un autre tenant
(cause de l'echec E2E etape 4).

## Correctif (retrocompatible)
- `verify_staff_login(p_email, p_password, p_tenant_code DEFAULT NULL)` et
  `attempt_staff_login(..., p_tenant_code DEFAULT NULL)`.
- Sans code : tous les comptes actifs portant l'email sont evalues ; succes uniquement si **exactement un**
  compte correspond au mot de passe. 0 = invalide, plusieurs = ambigu -> refuse (preciser le code).
- Avec code (insensible a la casse) : recherche restreinte a ce tenant.
- Aucun acces inter-tenant : le mot de passe doit correspondre au compte retenu.
- API `/api/auth/login` : champ optionnel `tenantCode` ; formulaire : champ facultatif « Code etablissement ».
- Anciennes signatures supprimees (evite l'ambiguite de surcharge RPC). Rate limiting inchange (par email).

## Notes
- `verify_staff_login` garde `search_path = public, extensions, pg_temp` (pgcrypto est dans `extensions`).
  Le fichier baseline `20260918000000_functions_baseline_part1.sql` est en retard sur la base live sur ce point ;
  la migration `20260930000000_login_tenant_scope.sql` fait foi.
- Migration a appliquer a la base AVANT le deploiement du code (le code appelle `p_tenant_code`).

## Verification (transaction annulee d'office sur la base reelle)
B) 2 comptes valides sans code -> refuse | C/D) avec code -> tenant vise (casse indifferente) |
E) mauvais mot de passe -> refuse | F) code inexistant -> refuse | G/H) compte Anjary avec/sans code -> OK,
permissions `admin.full` | I) code d'un autre tenant -> refuse | K) appel 4 arguments (ancien style) -> OK |
L) 6e tentative -> verrouille | M) 2 fonctions restantes (pas de surcharge fantome).
Cas A (1 seul compte valide sans code) : 0 ligne car le tenant « Riviera Palace Group » porte aussi un
`owner@demo.local` avec `Demo1234!` -> ambiguite reelle, comportement attendu.
