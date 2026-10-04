# TASK 21 — Check-out ferme le folio + regles d'audit "sejour depasse" / folios incoherents

## Constat (test A a Z sur Anjary, 04/10/2026)
- `check_out_reservation` laissait le folio `open` meme a solde 0 (RES-2026-07d30fdc19), sans signalement de l'audit.
- Une reservation `checked_in` dont la date de depart etait passee n'etait detectee par aucune regle (cas reel : depart du 30/09 toujours en sejour au 03/10).

## Correctif (migration `20261007000000_checkout_close_folio_and_stay_audit.sql`)
- `check_out_reservation` : recalcule le solde du folio ; s'il est a 0, le folio passe `closed` (`closed_at` renseigne).
  Solde > 0 (creance) ou < 0 (trop-percu) : folio laisse ouvert. Le check-out n'est jamais bloque. L'evenement d'audit
  contient `folio_balance_at_checkout` et `folio_closed`.
- `run_hotel_audit` (reste inchange) : deux regles ajoutees.
  - `data_integrity` / warning "Sejour depasse non cloture" : `checked_in` avec depart < date du jour dans le fuseau de l'hotel.
  - `financial` / warning "Folio reste ouvert apres depart" ou "Trop-percu sur folio apres depart" : `checked_out`, folio ouvert, solde <= 0.

## Verification (transaction annulee d'office sur la base reelle, avant application)
Bloc DO termine par une exception : migration executee puis tests sur les donnees reelles d'Anjary, tout annule.
- A : l'audit signale 1 folio ouvert a solde nul (RES-2026-07d30fdc19) et 0 sejour depasse.
- B : depart ramene au 02/10 sur une reservation en sejour -> 1 "Sejour depasse non cloture".
- C : check-out avec solde 176 000 -> folio reste `open` ; l'audit le classe "Facture non soldee apres depart" (critical).
- D : paiement integral puis check-out -> folio `closed`, solde 0, `closed_at` renseigne.
- Apres l'execution : fonctions de la base inchangees, statuts et dates des reservations inchanges (annulation confirmee).

## Limites
- Pas de test vitest : l'environnement de cette session n'a pas SUPABASE_SERVICE_ROLE_KEY, un test non execute n'aurait pas de valeur.
- Les folios deja `checked_out` + `open` a solde 0 ne sont pas fermes automatiquement : ils sont signales par l'audit.
- RES-2026-07d30fdc19 : nuitees du 20 au 29/09 non postees, decision metier en attente.
