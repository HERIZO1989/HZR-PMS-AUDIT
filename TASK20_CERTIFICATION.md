# TASK 20 — Posting automatique des nuitees (pg_cron)

- `hotels.auto_post_room_charges` (defaut false, opt-in) ; Anjary actif ; la demo Riviera n'est pas modifiee.
- `post_room_charges_nightly(p_force)` : pour chaque hotel opt-in, a 03h locale, poste les nuitees de la veille
  locale via `post_room_charges` (TVA incluse). Un hotel en erreur n'empeche pas les autres (RAISE WARNING).
  Execution reservee a service_role / postgres.
- Planification pg_cron `post-room-charges-nightly` : minute 7 de chaque heure (UTC) ; seul le passage a 03h locale
  agit (multi-fuseaux sans job par hotel). Anjary (UTC+3) : 00h07 UTC. Idempotent.
- Migration `20261006000000_auto_post_room_charges.sql` appliquee a la base.

## Verification (transaction annulee d'office sur la base reelle, avant application)
Appel non force a 12h locale : 0 hotel traite ; force : 1 hotel (Anjary) ; nuitee de la veille postee a 159 000 TTC
(chambre HT + TVA) ; relance sans doublon ; aucune ligne posee sur la demo Riviera.
Apres application : job actif, aucune ecriture reelle (aucun client en sejour cette nuit-la a Anjary).

## Limites
- Pas de test automatise de la fonction nocturne : elle poserait des nuitees sur les reservations reelles d'Anjary.
- Pas d'alerte si le job echoue (consulter cron.job_run_details). Taxe de sejour toujours non incluse.
