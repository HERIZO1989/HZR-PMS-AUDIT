# TASK 15 — Restrictions de vente du calendrier dans create_reservation

`rate_calendar` portait deja `stop_sell`, `closed_to_arrival`, `closed_to_departure`, `min_stay`, `max_stay`
mais `create_reservation` ne les consultait pas : une chambre fermee a la vente pouvait etre reservee.

## Regles (plan retenu, par type de chambre)
- stop_sell : refus si l'une des nuits du sejour est fermee ;
- closed_to_arrival : refus si la date d'arrivee est fermee a l'arrivee ;
- closed_to_departure : refus si la date de depart est fermee au depart ;
- min_stay / max_stay : evalues sur la date d'arrivee, par rapport au nombre de nuits ;
- pas de ligne de calendrier pour la date = pas de restriction.
Migration `20261002000000_reservation_sales_restrictions.sql` (patch de la fonction courante, signature
inchangee, 1 seule fonction). Appliquee a la base.

## Verification (transaction annulee d'office sur la base reelle, avant application)
A sans restriction OK | B stop-sell refuse / depart la veille accepte | C ferme a l'arrivee refuse /
arrivee la veille accepte | D ferme au depart refuse | E min_stay refuse puis accepte | F max_stay refuse |
G hors calendrier accepte | 1 seule fonction create_reservation.
Etat des donnees d'Anjary : aucune restriction posee (valeurs par defaut) -> comportement inchange.

## Non gere
- `allotment` (nombre de chambres vendables par plan et par nuit) : demande un comptage des ventes.
- Pas de droit de depassement (override) pour un responsable : a ajouter si besoin.
