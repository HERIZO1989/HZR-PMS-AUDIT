# TASK 24 — Alerte d'audit sur le posting automatique des nuitees

## Probleme
Si le job pg_cron `post-room-charges-nightly` tombe, est desactive, ou si un hotel echoue (la fonction nocturne avale l'erreur
par RAISE WARNING et le job reste "succeeded"), personne n'etait prevenu.

## Correctif (migration `20261008000000_nightly_posting_health_alert.sql`)
- `nightly_posting_health(hotel_id)` (SECURITY DEFINER, service_role uniquement) : pour un hotel avec `auto_post_room_charges`,
  retourne un diagnostic si : job absent/desactive ; executions en echec sur 24 h ; aucune execution reussie depuis 3 h ;
  ou, apres 04h locale, aucun evenement `post_room_charges` pour la date d'exploitation de la veille.
- `audit_nightly_posting_findings` : cree un finding `compliance` / critical "Posting automatique des nuitees en defaut".
- `run_hotel_audit` : appel ajoute avant le RETURN final (patch idempotent sur la definition existante).

## Verification (transaction annulee d'office sur la base reelle, puis application)
- Etat sain (Anjary) : aucun diagnostic, 0 finding ; Riviera (opt-out) : NULL.
- Evenement de posting de la veille supprime (dans la transaction) : diagnostic "aucun posting enregistre pour la date 2026-10-03" et 1 finding critique.
- Apres application : `run_hotel_audit` contient l'appel, `anon` sans droit d'execution, `service_role` avec.

## Limites
- Les cas "job desactive" et "execution en echec" ne sont pas simulables (pas de droit d'ecriture sur cron.job) : le code est revu mais non execute.
- L'alerte n'apparait qu'au prochain lancement de l'audit ; pas de notification email/WhatsApp.
