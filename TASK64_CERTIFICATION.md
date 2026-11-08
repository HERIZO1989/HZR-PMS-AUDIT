# TASK 64 — Retrouver et enregistrer les arrivées : vues de la liste et choix de chambre dans les listes

## Constat (Hôtel Anjary, 08/11/2026)
« Le check-in manuel ne marche pas, il n'y a pas de sélection de chambre. » La logique de check-in et le sélecteur de chambre (TASK 62) étaient corrects, mais l'écran Réservations **ne chargeait que les 100 réservations dont la date d'arrivée est la plus lointaine** :
ces 100 lignes couvraient du 07/11/2026 au 29/07/2027, dont seulement 18 au plus à la date du jour. Les arrivées du jour et les séjours en cours n'apparaissaient donc pas, et il n'y avait aucune ligne sur laquelle cliquer « Check-in » ni choisir une chambre.
Dans la fenêtre « Arrivées en retard », les lignes « à faire à la main » n'avaient qu'un texte d'aide, sans bouton.

## Ce qui est livré (aucune migration)
- **Vues de la liste** (onglets) : *Arrivées du jour* (par défaut), *En séjour*, *En retard* (confirmés, arrivés avant aujourd'hui, départ à venir), *À venir*, *Toutes* (ancien comportement). Jusqu'à 300 lignes par vue, dans l'ordre chronologique.
- **Recherche par numéro de confirmation** (sur toutes les réservations).
- **« Choisir une chambre »** directement sur les lignes « à faire à la main » de la fenêtre « Arrivées en retard » et sur les lignes en échec du résultat du check-in automatique : le sélecteur de chambres propres s'ouvre, la liste se met à jour après l'enregistrement.
- API `GET /api/reservations?view=today|inhouse|late|upcoming|all&q=…` (la date du jour est celle de l'hôtel).

## Vérification
- 5 tests unitaires (vue par défaut, reconnaissance des vues, filtres de chaque vue, ancien comportement de « Toutes », nettoyage de la recherche) ; `tsc` propre.
- Recoupement SQL sur la base réelle au 08/11/2026 : 17 arrivées du jour, 78 en séjour, 14 en retard, 78 à venir ; l'ancienne liste de 100 lignes allait du 07/11/2026 au 29/07/2027.

## Limites
- Les vues sont limitées à 300 lignes ; la recherche par numéro permet de retrouver n'importe quelle réservation.
- La recherche porte sur le numéro de confirmation (pas encore sur le nom du client).
