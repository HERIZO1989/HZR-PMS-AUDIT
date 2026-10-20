# TASK 47 — Import des dépenses : export Odoo « Bons de commande fournisseur »

## Constat
L'import des dépenses (TASK 46) ne lisait que le classeur « Journal des dépenses » (Date, Catégorie, Montant TTC…).
L'export Odoo des bons de commande fournisseur (Référence de commande, Fournisseur, Acheteur, Échéance de commande, Arrivée, Total, Statut) était refusé
(« Aucune ligne de dépense trouvée »).

## Ce qui est livré
- Reconnaissance automatique du format Odoo (Excel ou CSV) dans l'import existant ; le format « Journal des dépenses » est inchangé.
- Statuts : « Bon de commande fournisseur » et « Verrouillé » sont importés ; « Annulé », « Demande de prix » et tout autre statut sont écartés et comptés par statut.
- Date de la dépense = « Échéance de commande » (jour affiché, sans décalage de fuseau, y compris tard le soir) ; « Arrivée » n'est pas utilisée.
- Catégorie déduite du fournisseur (table `SUPPLIER_CATEGORY_RULES`, modifiable) ; fournisseur non reconnu → « Autres dépenses ». Variantes de noms unifiées (ex. « AUTRE ACHAT » / « Autres achat »).
- Clé anti-doublon = référence Odoo : recharger le fichier, ou changer les règles de catégorie, ne crée jamais de doublon.
- Montants inférieurs à 1 000 (devise douteuse : Booking.com, Expedia, Air Austral…) : importés **en attente**, sans conversion, avec la mention « À vérifier » ; ils ne comptent dans aucun total tant qu'ils ne sont pas approuvés.
- Total vide sur un bon valide : ligne refusée avec son numéro de ligne Excel.
- Écran : texte d'aide mis à jour, statuts ignorés et nombre de lignes à vérifier affichés après l'import.
- Aucune migration de base.

## Vérification (fichier réel, 2 002 lignes, 18/11/2025 → 19/10/2026)
- 1 987 dépenses lues (1 972 approuvables + 15 à vérifier), 13 écartées (Annulé 11, Demande de prix 2), 2 refusées (P01422, P01375 : total vide), 0 doublon.
- Recoupement avec une lecture indépendante (pandas) : 1 989 bons valides, total 645 966 966,24 = 645 962 991,41 (importés) + 3 974,83 (à vérifier). Totaux mensuels identiques.
- 8 tests unitaires nouveaux (format, jour tardif, statuts, total vide, devise douteuse, idempotence, alias fournisseurs, CSV) ; `tsc` propre ; 134 tests passent.
  Seul test en échec dans cet environnement : `reservation-lifecycle` (exige SUPABASE_URL ; tourne en CI).

## Limites
- Les totaux Odoo sont traités comme TTC, TVA déductible = 0 (HT = TTC) : les fournisseurs informels n'ont pas de facture avec TVA. À ajuster si des factures TVA existent.
- Ce sont des bons de commande (engagements), pas des décaissements ; mode de paiement = Espèces par défaut.
- Environ 37 % des montants (« Autres achat », « Autres Services », STEP UP, Condor…) tombent en « Autres dépenses » faute d'information dans l'export.
- Une modification d'un bon dans Odoo après un premier import n'est pas répercutée (la référence existe déjà).
- Ne pas charger en plus le journal manuel pour les mêmes achats : les deux formats n'ont pas la même clé et feraient un double comptage.
