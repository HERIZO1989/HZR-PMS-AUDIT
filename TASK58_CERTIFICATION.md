# TASK 58 — Finance sur le tableau de bord, avec fraîcheur des données

## Constat
Le tableau de bord ne montrait que occupation, ADR et RevPAR. Le CA du jour, l'encaissé et les créances demandaient d'ouvrir d'autres écrans.
En contrôlant les chiffres, un piège est apparu : les factures sont importées à la main et s'arrêtent au 19/10/2026. Un « CA du jour » calculé pour aujourd'hui (25/10) afficherait **0**, ce qui est trompeur.

## Ce qui est livré (lecture seule : aucune migration, aucune écriture en base)
- Bandeau **Finance** sous les indicateurs clefs : CA du jour (TTC, HT, nombre de factures), CA du mois, encaissé du jour, créances fiables avec les créances « à rapprocher » et celles de plus de 90 jours ; liens vers « Factures & CA » et « Créances ».
- Il se charge après le reste de l'écran (sans le ralentir) et reste **masqué** pour les rôles sans droit `finance.manage`.
- **Fraîcheur** : si la dernière facture importée est antérieure à aujourd'hui, le bandeau affiche le dernier jour réel (« CA du 19/10/2026 ») avec la mention « dernière facture importée », et la page « Factures & CA » affiche un avertissement jaune. Plus de zéro trompeur.
- L'API `GET /api/invoices` gagne `summaryOnly=1` (synthèse seule : ni liste ni acomptes) et renvoie `lastInvoiceDate`.

## Vérification
- 3 tests unitaires nouveaux (dernière facture connue, choix du dernier jour réel sans reculer quand les données sont à jour, CA du dernier jour non nul alors que celui d'aujourd'hui est nul) ; `tsc` propre.
- Recoupement SQL sur la base réelle : dernière facture et dernier paiement au 19/10/2026 ; CA d'octobre (595 factures) 215 893 249,85 TTC ; 0 facture le 25/10 (cas du zéro trompeur évité).

## Limites
- Les chiffres restent aussi frais que le dernier import des pièces comptables Odoo : le bandeau le dit, il ne l'actualise pas.
- Le bandeau fait deux appels (factures de l'année, créances) : quelques secondes de chargement sur un gros historique, sans bloquer le reste du tableau de bord.
