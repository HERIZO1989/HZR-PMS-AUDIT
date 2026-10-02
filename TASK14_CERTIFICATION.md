# TASK 14 — Tarification des reservations par calendrier + devise de l'hotel

## Defauts constates (Anjary)
1. `create_reservation` calculait `base_rate x nuits` : le calendrier tarifaire (`rate_calendar`) et le plan
   choisi (BAR/BB/NRF/CORP, saisons) etaient ignores. `p_rate_plan_id` n'etait pas verifie (plan d'un autre
   hotel/tenant accepte).
2. `currency_code` en dur a `'EUR'` (`create_reservation`, `apply_import_row`) : reservations et folios
   d'un hotel en MGA etiquetes EUR.

## Correctif (migration 20261001000000_reservation_pricing_currency.sql, appliquee a la base)
- Plan fourni : meme tenant/hotel, actif, applicable au type de chambre, sinon erreur.
- Plan absent : plan actif `BAR` de l'hotel s'il existe, sinon tarif de base.
- Montant = somme nuit par nuit du calendrier (plan, type, date) ; nuit sans ligne -> tarif de base.
- Devise = `hotels.currency_code` ; import : devise de la ligne sinon devise de l'hotel.
- Plan retenu enregistre sur la reservation ; audit enrichi (plan, montant, devise).
- Alignement des reservations/folios existants d'hotels MGA (4 reservations + 2 folios Anjary).
- Signature inchangee (pas de surcharge).

## Verification (transaction annulee d'office sur la base reelle, avant application)
BAR 573 000 / BB 648 000 / NRF 516 000 / CORP 486 000 Ar (3 nuits de fetes, = somme du calendrier) ;
sans plan -> BAR ; hors calendrier -> tarif de base ; plan d'un autre hotel et plan inactif refuses ;
devise MGA ; 1 seule fonction create_reservation. Post-application : reservations/folios Anjary en MGA.

## Limites connues (hors TASK 14)
- Le calendrier n'est pas encore consulte pour les restrictions de vente (fermeture, sejour minimum).
- Les tarifs par occupation (adultes/enfants) ne sont pas geres : tarif par chambre et par nuit.
