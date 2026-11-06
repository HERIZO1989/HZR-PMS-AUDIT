# TASK 63 — Enregistrer les arrivées en retard

## Constat (Hôtel Anjary, 05/11/2026)
12 séjours en cours n'ont jamais été enregistrés : clients arrivés les jours précédents, restés « Confirmé ». Le check-in automatique ne traite que les arrivées du jour (il n'était pas activé à leur arrivée, ou ils n'avaient pas de type de chambre).
Un séjour « Confirmé » ne compte ni dans l'occupation ni dans le revenu hébergement : ces 12 séjours représentent environ 12 chambres occupées par nuit sur 120.

## Ce qui est livré (aucune migration : réutilise `auto_check_in_reservation` et `apply_reservation_deposits`)
- Bouton **« Arrivées en retard »** (écran Réservations) : liste les séjours en cours non enregistrés (statut « confirmée », arrivée passée, départ à venir), classés **Enregistrable** (une chambre propre du type réservé existe), **À faire à la main** (type manquant ou plus de chambre propre du type) ou **Non automatique** (check-in annulé à la main, bloc en doublon).
- **Enregistrement en un clic** de ceux qui sont enregistrables, après confirmation ; les acomptes sont déduits ; les indicateurs sont **recalculés** sur la période concernée, ce qui fait apparaître ces séjours dans l'occupation depuis leur arrivée.
- La classification est **refaite côté serveur** au moment de l'enregistrement : on n'enregistre jamais que ce qui est réellement enregistrable à cet instant. Les chambres propres sont comptées au fil de la liste (arrivées les plus anciennes d'abord) pour ne pas promettre deux fois la même chambre.
- API `GET/POST /api/reservations/overdue-arrivals` (droit `reservations.manage`).

## Vérification
- 7 tests unitaires (chambre propre ou à la main, consommation des chambres propres, ordre des arrivées, verrou et doublons jamais automatiques, liste vide, détection d'un bloc en doublon et pas d'un numéro proche) ; `tsc` propre.
- Cas réel : sur les 12 séjours, 2 sont enregistrables (B00261-343d66-1 en Supérieur, 41 chambres propres ; B00261-343d66-2 en Supérieur avec balcon, 7 chambres propres) et 10 sont à faire à la main (sans type de chambre).

## Limites
- Un client arrivé en retard puis jamais venu doit être enregistré puis passé en no-show (« Annuler le check-in ») : le bouton ne devine pas l'absence.
- Les séjours sans type de chambre restent à traiter un par un avec le sélecteur de chambre.
- L'enregistrement tardif ne refacture pas les nuits passées : la facturation de nuit ne pose que la nuit de la veille.
