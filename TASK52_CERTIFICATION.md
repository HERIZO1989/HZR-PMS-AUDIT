# TASK 52 — Classer les dépenses par fournisseur

## Constat (Hôtel Anjary)
36,7 % des dépenses approuvées sont en « Autres dépenses » (« Autres Services » 236 lignes, « Autres achat » 301 lignes, STEP UP, PRAXI, Izzi Foam, Condor, S2PC…).
L'export Odoo des bons de commande n'a ni catégorie ni détail : la catégorie est déduite du nom du fournisseur par une table fixe du code.
Tant que ces postes ne sont pas classés, le GOP et les ratios de charges ne sont pas fiables (notamment le Personnel).

## Ce qui est livré
- Panneau **« Classer les fournisseurs en Autres dépenses »** (écran Dépenses) : les fournisseurs non classés, plus gros montants d'abord (40 affichés), avec une liste de catégories et un bouton Appliquer.
- Un clic reclasse **toutes** les dépenses du fournisseur (variantes de casse et d'espaces comprises, y compris en attente ou rejetées) et **mémorise la règle**.
- Les règles de l'hôtel priment sur la catégorie déduite à **chaque prochain import** ; la détection des doublons est faite avant le reclassement, donc changer une règle ne crée jamais de dépense en double au rechargement du même fichier.
- Migration `20261027000000_expense_supplier_rules.sql` : table `expense_supplier_rules` (RLS sans politique) et fonction `reclassify_supplier_expenses` (règle + reclassement en une transaction, inscrite au journal d'audit). Aucune fonction existante modifiée.
- Droit requis : `expenses.manage`. Les montants ne sont jamais modifiés, seulement la catégorie.

## Vérification
- 3 tests unitaires nouveaux (clé de fournisseur, regroupement, application des règles) ; `tsc` propre.
- 9 scénarios exécutés **sur la vraie base** (hôtel de démonstration, transaction annulée automatiquement) : reclassement de toutes les variantes d'un fournisseur, autres fournisseurs et autres catégories intacts, règle mémorisée, rejeu sans effet, changement de catégorie = une seule règle mise à jour, catégorie invalide / fournisseur vide / hôtel inconnu refusés, 0 ligne d'Anjary modifiée. Contrôle après coup : table et fonction absentes, 0 ligne de test, Anjary inchangé (1 972 dépenses approuvées, 645 962 991 HT).

## Limites
- Les catégories ne sont pas devinées : c'est l'hôtel qui classe. Tant que « Personnel » n'est pas renseigné, le GOP reste surévalué (avertissement affiché).
- Une règle est par fournisseur : « Autres achat » et « Autres Services » regroupent des achats divers qu'une seule catégorie ne décrit pas exactement.
- Les dépenses saisies à la main ou importées du journal ne sont pas reclassées automatiquement par les règles à la saisie (uniquement à l'import et via ce panneau).

## Mise en production
Appliquer la migration SQL **avant** de fusionner (le déploiement ne les applique pas), puis fusionner.
