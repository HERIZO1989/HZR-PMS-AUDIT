# TASK 56 — Créances « à rapprocher » (restaurant, buanderie)

## Constat (Hôtel Anjary, au 24/10/2026)
Une seconde série de petites factures (médiane 20 000 Ar : restaurant et buanderie, confirmé par l'hôtel) porte des numéros déjà utilisés par les factures de séjour.
2 268 de ces factures sont « Non payées » alors que 91 % de leurs clients ont payé une autre facture à ± 60 jours : elles ont très probablement été réglées avec le séjour sans que le paiement soit rapproché dans Odoo.
Elles gonflaient les créances (et auraient pu être relancées à tort).

## Ce qui est livré (lecture seule : aucune migration, aucune écriture en base)
- Étiquette **« à rapprocher »** : facture « Non payée » dont le numéro est porté par une autre facture ET dont le client a payé (ou a un règlement en cours sur) une autre facture à ± 60 jours.
  Étiquette **« n° en double »** : même numéro en double mais aucun paiement proche : reste une créance, à vérifier.
- Page Créances : cartes **Créances fiables** et **À rapprocher**, colonne « À rapprocher » par client, filtre « Avec à rapprocher », badges dans le détail d'un client, explication de la règle, export CSV avec la colonne.
- **Message de relance** : les factures « à rapprocher » n'y figurent jamais ; le bouton est désactivé quand il n'y a rien à relancer, avec le nombre de factures exclues.
- Contrôles d'audit : nouveau contrôle **Consommations à rapprocher** (nombre, montant, part des créances, 10 principaux clients, action à faire).
- Les créances totales et les autres écrans ne changent pas : on sépare, on ne supprime rien.

## Vérification
- 6 tests nouveaux (étiquetage, créances fiables et à rapprocher par client et au total, exclusion du message de relance, fenêtre de ± 60 jours symétrique et bornes, factures partielles et sans numéro jamais étiquetées, contrôle d'audit) ; `tsc` propre.
- Recoupement SQL sur la base réelle : 2 076 factures « à rapprocher » (105 760 372,28 Ar TTC), 191 « n° en double » sans paiement proche (12 779 199,97), créances totales 323 883 682,40, **créances fiables 218 123 310,12 (67 %)**.

## Limites
- « À rapprocher » est une présomption, pas une preuve : seul Odoo (ou le client) peut confirmer le règlement. Rien n'est marqué payé ni annulé.
- La règle suppose que le règlement du séjour couvre les consommations : une consommation réellement impayée d'un client qui a payé son séjour serait masquée tant qu'elle n'est pas vérifiée.
- Le montant déjà réglé des factures « Partiellement réglées » reste inconnu.
