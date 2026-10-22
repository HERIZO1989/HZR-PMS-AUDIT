# TASK 51 — TRevPAR, GOP et GOPPAR à partir du CA facturé

## Constat (Hôtel Anjary)
- Les indicateurs d'hébergement du PMS (occupation, ADR, RevPAR) sont **hors TVA** ; les factures Odoo sont **TTC**. Toute comparaison doit se faire en HT des deux côtés.
- Le revenu « total » des indicateurs ne contenait que l'hébergement : TRevPAR = RevPAR, et le GOP de l'écran Dépenses était sous-évalué.
- L'écran Dépenses lisait ses lignes avec `limit(2000)` : avec 1 987 dépenses importées, **les totaux et le GOP auraient été tronqués dès la 2 001e ligne**.

## Ce qui est livré (aucune migration, aucune écriture en base)
- Section **Performance** dans « Factures & CA » : par mois et en cumul (HT) — occupation, ADR, RevPAR (séjours), **TRevPAR**, CA facturé, dépenses, **GOP**, marge, **GOPPAR**. API `GET /api/performance` (permission `finance.manage`).
- Base du revenu total : **factures comptabilisées non extournées, ramenées HT** (TTC ÷ (1 + TVA de l'hôtel)). L'hébergement des séjours reste affiché à part (RevPAR).
- Écran Dépenses : les recettes (GOP, GOPPAR, marge) viennent maintenant des factures HT quand il y en a sur la période, sinon des indicateurs du PMS ; libellé de la source affiché.
- Dépenses : totaux, GOP et agrégats calculés sur **toutes** les lignes de la période (pages de 1 000) ; la liste affichée est limitée aux 500 dernières avec une mention du total.
- Avertissement visible quand aucune dépense « Personnel » n'est approuvée : le GOP est alors surévalué.

## Vérification
- 6 tests unitaires (regroupement par mois, exclusion de l'autre année et des dates futures, chambres-nuits, ADR/RevPAR/TRevPAR, GOP/GOPPAR/marge, cumul et écart facturé − hébergement, mois partiel, TVA nulle) ; `tsc` propre.
- Recoupement SQL sur la base réelle, du 01/01 au 22/10/2026 : 35 400 chambres-nuits disponibles, occupation 39,5 %, ADR 119 144, RevPAR 47 042, CA facturé HT 1 892 873 394, **TRevPAR 53 471**, dépenses approuvées HT 548 888 007, **GOP 1 343 985 387 (marge 71,0 %)**, **GOPPAR 37 966**, dépenses « Personnel » : 0.

## Limites
- **Le GOP est surévalué** : aucune charge de personnel n'est saisie (les 1 713 dépenses 2026 viennent des bons de commande fournisseurs). Une marge de 71 % n'est pas réaliste pour un hôtel.
- Les factures sont datées à leur date de facturation : sur un mois isolé, le CA facturé peut être décalé par rapport aux séjours (le premier trimestre est inférieur à l'hébergement, le cumul rattrape en juin). Le cumul est plus fiable que le mois.
- L'écart « CA facturé − hébergement » mélange revenus hors chambre et décalages de facturation : il n'est pas une mesure exacte du hors-chambre.
- Janvier est sous-estimé (export de réservations à partir du 10/01) et octobre est partiel.
