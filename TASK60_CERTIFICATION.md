# TASK 60 — Check-in automatique des arrivées du jour et annulation d'un check-in

## Constat (Hôtel Anjary, 28/10/2026)
Le bouton « Check-in » était refusé pour toutes les arrivées : la fonction `check_in_reservation` exige une chambre assignée (« Aucune chambre assignée : fournir room_id »), l'écran n'en envoie jamais, et les réservations importées d'Odoo n'en ont aucune (16 arrivées du jour, 0 chambre assignée).
Par ailleurs `cancel_reservation` n'accepte que « provisoire » ou « confirmée » : une fois enregistré, un client absent ne pouvait plus être annulé.

## Ce qui est livré
- **Le bouton « Check-in » fonctionne** sans chambre choisie : une chambre libre du type réservé est attribuée (propre, non occupée, sans chevauchement ; la première par numéro). Les acomptes sont déduits comme avant.
- **« Check-in automatique du jour »** (écran Réservations) : enregistre en un clic toutes les arrivées confirmées du jour, avec le détail par réservation (chambre attribuée ou raison).
  Ignorées avec leur raison : les provisoires (à confirmer), les « blocs entiers » dont les lignes par chambre existent déjà (doublons), les check-in annulés ; à faire à la main : type de chambre manquant, plus de chambre libre du type.
- **Automatique chaque jour** : case « Automatique chaque jour à partir de 12 h » (réglage réservé à l'administrateur), exécutée par la routine déjà planifiée toutes les 2 h (heure locale de l'hôtel, idempotente). Désactivée par défaut.
- **« Annuler le check-in »** sur une réservation enregistrée : *No-show*, *Annulation*, ou *Remettre en attente* (la routine ne la ré-enregistrera pas). Libère la chambre, supprime le séjour ouvert, remet les acomptes « en attente », ferme le folio vide. **Refusé** dès qu'une nuitée ou un frais est facturé (la facturation de nuit passe vers 03:00 le lendemain) ou qu'un paiement autre qu'un acompte est encaissé.
- Migration `20261028000000_auto_check_in.sql` : colonnes `hotels.auto_check_in_enabled` et `reservations.skip_auto_check_in`, fonctions `auto_check_in_reservation`, `auto_check_in_arrivals`, `revert_check_in`. Aucune fonction existante n'est modifiée.

## Vérification
- 5 tests unitaires (heure locale de Madagascar et d'autres fuseaux, minuit, fenêtre d'exécution à partir de 12 h, créneau de la routine toutes les 2 h, résumé) ; `tsc` propre.
- Scénarios exécutés **sur la vraie base** (hôtel de démonstration, transaction annulée automatiquement, 0 ligne d'Anjary touchée) :
  attribution d'une chambre du bon type (occupée, séjour et folio ouverts) ; retour en attente (chambre libérée, séjour supprimé, verrou posé) ; acompte reporté puis restauré « en attente » avec 0 paiement et solde nul ; refus après facturation d'une nuitée ; no-show (folio fermé, motif conservé) ;
  refus d'un statut non « enregistré » et d'un statut cible invalide ; lot : 2 enregistrées dans 2 chambres différentes, provisoire et doublon ignorés, type manquant signalé ; plus de chambre libre du type signalé ; la routine ignore un check-in annulé à la main.

## Limites
- Les chambres ne sont attribuées que par type (pas de préférence d'étage ou de vue) ; une chambre « sale » n'est jamais attribuée (seules les chambres « propres » le sont).
- La routine tourne toutes les 2 h : une arrivée est enregistrée au premier passage après 12 h (13 h 20 environ).
- Un client absent doit être annulé **avant la facturation de nuit** ; après, la correction passe par le folio.
- Découverte à traiter à part (aucune modification faite) : 23 réservations existent à la fois en « bloc entier » et en lignes par chambre (doublons d'anciens imports) ; le check-in automatique ignore ces blocs.
