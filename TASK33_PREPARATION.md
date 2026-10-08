# TASK 33 — Les trois décisions sur l'import Odoo : préparé, rien d'appliqué

Branche `task33-odoo-decisions` (non fusionnée dans `main`). La migration des séjours à la journée n'est PAS appliquée à la base.

## 1. « Verrouiller » → séjour parti (checked_out)
Preuves dans le fichier : les 13 séjours sont tous terminés, 9 sur 13 sont « Entièrement facturé » avec paiement en cours : le verrouillage intervient après la
facturation. Un seul réglage (`ODOO_STATUS_MAP` dans `src/lib/import/odoo.ts`) pour revenir à « confirmed ».

## 2. Période importée
Nouveau choix « Période à importer » sur l'écran Imports : « Tout le fichier » ou « Séjours en cours et à venir (départ à partir d'aujourd'hui) ».
Pour un export Odoo, la seconde option est présélectionnée. Les séjours hors période sont « ignorés » (même s'ils contenaient des erreurs) et comptés à part.

Résultat sur votre fichier (référence : 7 octobre 2026) :
| | Tout le fichier | En cours et à venir |
|---|---:|---:|
| Réservations importables | 4 666 | 112 |
| Ignorées (regroupements, hors période) | 6 | 4 561 |
| Invalides | 1 (départ avant arrivée) | 0 |
| Parti / confirmée / provisoire / annulée | 4 231 / 347 / 53 / 35 | 0 / 106 / 6 / 0 |
| Séjours à la journée | 275 | 1 |
| Montant total | 2 231 797 600 Ar | 104 570 250 Ar |
Le total « tout le fichier » + la seule ligne invalide (159 000 Ar) = 2 231 956 600 Ar, soit exactement le total des lignes du fichier.
Recommandation : importer « en cours et à venir » (112 réservations) ; l'historique n'a pas de factures dans le PMS et ferait apparaître de l'occupation sans revenu.
À savoir : environ 26 de ces 112 séjours sont déjà commencés ; ils arrivent « confirmée » et devront être passés en check-in dans le PMS pour que les nuitées se postent.

## 3. Séjours à la journée
Migration `20261016000000_day_use_stays.sql` : colonne `reservations.stay_type` ('overnight' par défaut, 'day_use'), et la contrainte devient
« départ > arrivée, ou séjour à la journée avec départ = arrivée ». Testée sur la base réelle (transaction annulée) :
- séjour à la journée importé avec le bon type ; le même jour sans type est toujours refusé ; départ avant arrivée toujours refusé ; type inconnu refusé ;
- aucun conflit de chambre (la plage de dates est vide, donc la contrainte anti-chevauchement ne peut pas se déclencher) ;
- occupation des nuits inchangée, calcul des KPI sans erreur ; réservations existantes toutes en 'overnight'.
Limites : la colonne n'est pas encore affichée dans l'écran Réservations (un séjour à la journée apparaît avec la même date d'arrivée et de départ) ;
le montant d'un séjour à la journée importé n'est pas dans les KPI (comme tout montant importé sans folio) ; le bouton Check-in n'est pas prévu pour ce type.

## Pour appliquer (dans cet ordre, sur votre accord)
1. Appliquer la migration `20261016000000_day_use_stays.sql` à la base (compatible avec le code actuel).
2. Fusionner la branche dans `main` et déployer.
3. Écran Imports > Export Odoo > fichier > « Analyser » : contrôler 112 valides, puis « Importer ». Rien n'est écrit avant ce clic.

## Vérification
`tsc` propre ; 23 tests Odoo (période, séjours à la journée, statut Verrouiller) + les autres tests unitaires passent.
