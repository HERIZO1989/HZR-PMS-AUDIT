# TASK 62 — Choisir la chambre à la main pour un check-in

## Constat (Hôtel Anjary, 02/11/2026)
Chaque jour, quelques arrivées n'ont pas de type de chambre (les imports Odoo n'en déduisent pas toujours un : tarif hors grille ou ambigu). Exemple du jour : B00162, B00316, B00440 sur 5 arrivées.
Le check-in automatique les ignore à juste titre (« Type de chambre manquant : choisir une chambre »), mais **l'écran n'offrait aucun moyen de choisir une chambre** : ces arrivées restaient bloquées.

## Ce qui est livré (aucune migration)
- Quand le système ne peut pas choisir seul (type manquant, plus de chambre libre du type, aucune chambre assignée), le clic sur **Check-in** ouvre un **sélecteur de chambre** : les chambres propres, groupées par type et triées par numéro ; un clic sur le numéro puis « Enregistrer l'arrivée ».
- Le check-in avec une chambre choisie renseigne aussi le **type de chambre** de la réservation quand il manquait (meilleure qualité des données, analyses par catégorie).
- API `GET /api/rooms/check-in-options` (droit `reservations.manage`) : chambres « propres » avec leur type.
- Les acomptes sont toujours déduits au check-in ; les garde-fous existants (chambre occupée, chevauchement, hors service) restent ceux de la base.

## Vérification
- 2 tests unitaires nouveaux (cas où le sélecteur est proposé / non proposé : 3 messages d'erreur reconnus, erreurs sans rapport, valeurs vides) en plus des 7 existants ; `tsc` propre.
- Les règles de choix de chambre n'ont pas changé : la fonction `check_in_reservation` testée en base (TASK 60) est celle appelée avec la chambre choisie.

## Limites
- Seules les chambres « propres » sont proposées ; une chambre à nettoyer ne l'est pas.
- Le sélecteur propose toutes les chambres propres, sans vérifier à l'avance le chevauchement : la base refuse un chevauchement avec un message clair.
- Le type de chambre est renseigné seulement quand il manquait (jamais modifié s'il existait).
