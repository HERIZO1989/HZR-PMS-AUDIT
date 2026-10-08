# TASK 32 — Import Odoo calé sur l'export réel d'Anjary

## Constat sur le fichier réel (« Réservations hôtels (hotel.booking) », 4 673 lignes)
- 11 colonnes : Référence, Nom du Client, Vendeur, Date d'entrée, Date de sortie, Montant total, Devise, Status, Statut de la facture, Statut du paiement, Acompte.
- L'ancien preset (colonnes « Client », « Email », « Arrivée »...) était une hypothèse : 0 ligne sur 4 673 n'aurait été importée (aucun e-mail dans l'export, colonnes différentes, statuts en français).
- Liste groupée par statut : 6 lignes de regroupement (« checkout (4219) »...) sans client ni date.
- La colonne « Référence » est réutilisée : 720 références pour 4 667 séjours, 439 références portent plusieurs clients et des dates différentes. Ce n'est pas un numéro de réservation unique.
- Réconciliation : pour chaque statut, nombre de lignes et total des montants lus = ceux annoncés par les lignes de regroupement (écart 0,00).

## Ce qui change
- `mappingPresets.ts` : preset Odoo sur les colonnes réelles ; synonymes « Date d'entrée », « Date de sortie », « Montant total ».
- `odoo.ts` (nouveau) : détection des lignes de regroupement (ignorées, non comptées en erreur), numéro de confirmation unique et reproductible
  `<réf>-<AAMMJJ>-<empreinte>` (les 4 391 lignes valides ont 4 391 numéros distincts ; réimporter le même fichier retrouve les mêmes numéros),
  séparation « NOM Prénom » (société / nom unique : tout dans le nom), correspondance des statuts.
- Statuts : Sortie→checked_out, Annulé→cancelled, Confirmé→confirmed, Attribué→confirmed, Brouillon→tentative, Verrouiller→confirmed (hypothèse, voir limites).
- Validation : l'e-mail n'est plus obligatoire si le nom du client est connu ; message distinct pour un séjour « à la journée ».
- Base (migrations 20261014 et 20261015, appliquées) : `apply_import_row` rattache une réservation sans e-mail au client de même prénom+nom (sinon le crée sans e-mail),
  recherche d'e-mail insensible à la casse, index dédié ; `apply_import_batch_chunk` applique un lot par tranches de 500.
- Écran Imports : compteur « ignorées » et statut « Ignorée ».

## Mesures (fichier réel passé dans le vrai pipeline, sans écrire en base)
- 4 673 lignes → 4 391 valides, 276 invalides, 6 ignorées ; lecture + mapping en 0,75 s.
- Invalides : 275 séjours à la journée (arrivée et départ le même jour, 40,7 M Ar) et 1 départ antérieur à l'arrivée (faute de saisie dans le fichier).
- Statuts des valides : 3 953 checked_out, 353 confirmed, 52 tentative, 33 cancelled. 46 valides sans montant (importées à 0). 2 lignes en EUR.
- Application en base (lot de la taille du fichier, transaction annulée) : 4 391 réservations en 9 appels, 2,2 s au total, plus long appel 0,29 s.
  Sans l'index : 14 s au total ; l'ancienne fonction en un seul appel aurait dépassé la limite de 8 s de l'API.
- `tsc` propre ; tests unitaires : 16 (Odoo) + 17 (autres) passent. Un test d'intégration est ajouté (import sans e-mail, tranches, réimport) : il tourne en CI contre la base,
  pas dans mon environnement (pas d'accès aux clés) ; le même scénario a été vérifié en SQL (transactions annulées).

## Limites et décisions à confirmer
1. « Verrouiller » (13 séjours, tous terminés) est mappé en confirmed par prudence ; checked_out est possible si Odoo l'utilise comme clôture.
2. La signification exacte de « Référence » est à confirmer côté Odoo : numéro de groupe, de chambre ou de séquence réutilisée.
3. Les 275 séjours à la journée ne sont pas importables (le PMS exige au moins une nuit) : décision produit (support « day use ») à prendre.
4. Rien n'a été importé dans la base d'Anjary. Importer l'historique créerait 4 391 réservations, ~2 270 clients sans e-mail, et ferait apparaître
   occupation sans revenu dans les KPI et l'audit (les folios ne sont pas importés) : à décider avant tout import réel.
5. Vendeur, statut de facture, statut de paiement et acompte ne sont pas repris (pas de champ équivalent).
6. Adultes/enfants absents du fichier : valeurs par défaut (1 adulte, 0 enfant).
