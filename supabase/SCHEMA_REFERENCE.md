# Référence du schéma — Riviera Suite PMS (état à TASK 8)

Document de référence obtenu par introspection directe de la base réelle. Voir
`README.md` dans ce dossier pour le contexte et les limites de cette documentation.

## Tables (29), toutes avec RLS activée

**Multi-tenant / RBAC** : tenants, hotels, staff_users, roles, permissions,
role_permissions, staff_user_roles, audit_events, security_events

**Opérations hôtel** : room_types, rooms, guests, rate_plans, rate_calendar,
reservations (+ colonne générée `stay_range` et contrainte `EXCLUDE USING gist`
anti-chevauchement), reservation_stays

**Finance** : folios, folio_lines, payments (+ `idempotency_key` unique par folio)

**Housekeeping / Conciergerie / Night Audit** : housekeeping_tasks,
concierge_requests, night_audit_runs, night_audit_checks

**Imports** : import_batches, import_rows

**Audit engine** : kpi_daily_snapshots, audit_findings

**Billing** : billing_plans, subscriptions

**Sécurité (TASK 2)** : login_attempts, revoked_sessions

Chaque table métier scoped par hôtel/tenant a une policy RLS `FOR ALL` basée sur
`app_current_tenant_id()`/`app_current_hotel_id()` — voir `SECURITY_MODEL.md` à la
racine du repo pour le modèle d'application réel (isolation applicative, RLS en
filet fail-closed).

## Extensions

- `pgcrypto` — hash bcrypt des mots de passe (`crypt()`)
- `btree_gist` — déplacée dans le schéma `extensions` (pas `public`) — nécessaire à
  la contrainte anti-double-réservation sur `reservations`

## Index

Chaque clé étrangère du schéma possède un index couvrant (vérifié par requête
croisant `pg_constraint`/`pg_index` — 0 FK non couverte à TASK 8). Index notables
ajoutés spécifiquement :
- `reservations_no_room_overlap` (EXCLUDE USING gist) — anti-double-réservation
- `payments_folio_idempotency_key` (UNIQUE partiel) — idempotence des paiements
- `guests_tenant_email_unique` (UNIQUE partiel, `lower(email)`) — déduplication clients
- `login_attempts_email_time_idx`, `login_attempts_ip_time_idx` — recherche rapide
  pour le rate limiting
- `revoked_sessions_expires_idx` — purge éventuelle des sessions révoquées expirées

## Fonctions

Voir `functions_baseline_part1.sql` pour un sous-ensemble (RBAC, auth, billing)
exporté tel quel depuis la base réelle. Les fonctions restantes (générateur de
démo, cycle réservation/folio/paiement, moteur d'audit, imports, housekeeping)
sont documentées par leur nom et leur rôle dans les rapports
`TASK*_CERTIFICATION.md` de ce repo — la base Supabase elle-même reste la source
de vérité exécutable pour leur code complet.

## Note — évolutions post-TASK 8

Ce document reflète l'état du schéma au moment de TASK 8. Des changements produit
ultérieurs (ex. onboarding de clients réels, ajustements de devise/branding par
hôtel) peuvent avoir fait évoluer certaines colonnes ou valeurs par défaut depuis —
se référer à la base Supabase elle-même pour l'état courant exact.
