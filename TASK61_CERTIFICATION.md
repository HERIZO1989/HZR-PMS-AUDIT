# TASK 61 — Check-in automatique : déclenchement fiable

## Constat (Hôtel Anjary, 01/11/2026, 13 h 46 heure locale)
Le check-in automatique fonctionne (6 séjours du 31/10 enregistrés avec leur chambre), mais 7 arrivées du jour ayant une chambre disponible attendaient encore.
La routine qui les enregistre est lancée par GitHub Actions toutes les 2 heures dans le planning, mais GitHub retarde ou saute ces exécutions : environ 4 par jour en pratique (06 h, 12 h 30, 18 h 30, 23 h 30 UTC), soit une seule dans la fenêtre après 12 h locale.
Une fonction « automatique » ne peut pas dépendre d'un rythme aussi aléatoire.

## Ce qui est livré (aucune migration)
- **Déclenchement depuis le navigateur** : quand un utilisateur autorisé (droit `reservations.manage`) ouvre l'application, si l'hôtel a activé le check-in automatique et que l'heure locale a atteint 12 h, les arrivées du jour sont enregistrées aussitôt. Au plus une fois toutes les 30 minutes par navigateur ; traitement idempotent (ne touche que les réservations encore « confirmées », jamais celles dont le check-in a été annulé à la main).
- Un bandeau confirme « Check-in automatique : N enregistrée(s), … » avec un lien vers les réservations à traiter à la main.
- La routine planifiée reste en place comme filet de sécurité (hôtel ouvert la nuit ou personne connecté).
- `GET /api/settings/auto-check-in` renvoie `dueNow` ; `POST /api/reservations/auto-check-in` accepte `{ auto: true }` (sans effet si l'option est désactivée ou s'il est trop tôt).

## Vérification
- 2 tests unitaires nouveaux (cadence de 30 minutes, première exécution, valeur illisible) en plus des 5 existants ; `tsc` propre.
- Analyse des exécutions réelles de la routine sur GitHub (23 exécutions du 26/10 au 01/11) : jamais plus de 4 par jour.

## Limites
- Le déclenchement dépend qu'une personne ouvre l'application après 12 h ; sinon la routine planifiée (retardée) prend le relais.
- Les arrivées sans type de chambre ou sans chambre libre du type restent à faire à la main (le bandeau les signale).
