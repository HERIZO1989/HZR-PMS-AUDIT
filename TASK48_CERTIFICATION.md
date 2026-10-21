# TASK 48 — Factures & CA (jour, mois, année), encaissements, créances

Source : export Odoo « Pièces comptables » (account_move), 7 893 lignes, 13/05/2025 → 19/10/2026.
Le module « Facturation » existant (`/billing`) est l'abonnement Stripe du PMS : il n'est pas touché. Nouvel écran : **Factures & CA** (`/invoices`).

## Ce qui est livré
- Table `invoices` (migration `20261025000000_invoices.sql`, RLS sans politique, accès par l'application, permission `finance.manage`).
- Import Excel ou CSV de l'export Odoo : factures **Comptabilisé** seulement ; Annulée et Brouillon écartées et comptées ; total vide refusé avec son numéro de ligne.
- **Le numéro de facture n'est pas unique** dans l'export (2 163 numéros portés chacun par deux factures différentes : clients, dates et montants différents). La facture est reconnue par numéro + client + date + montant. Aucune facture n'est perdue.
- Un nouvel export met à jour le paiement des factures déjà connues (Non payé → Payé) sans doublon ; les inchangées ne sont pas réécrites.
- CA du jour (avec choix de la date), du mois et de l'année, en TTC et HT (taux de TVA de l'hôtel), mois précédent, CA par mois, encaissé du jour / mois / année, créances et créances échues, liste filtrable (client, n°, état de paiement).
- Aucune modification des modules existants (KPI, folios, dépenses).

## Règles de calcul
- CA = factures comptabilisées à la date de facture ; **Extournée** exclue (1 facture, 47 000).
- Encaissé = « Payée » + « En paiement » à la date de paiement (« En paiement » = règlement enregistré dans Odoo, pas encore rapproché de la banque).
- Créances = « Non payée » + « Partiellement réglée », toutes années ; échue si l'échéance est passée.
- Total Odoo = TTC ; HT = TTC / (1 + taux de TVA de l'hôtel).

## Vérification sur le fichier réel
- 7 845 factures importables, 45 écartées (Annulée 34, Brouillon 11), 3 refusées (total vide : FAC/2026/03220, 02587, 00872), 0 doublon, 7 845 clés distinctes.
- Recoupement avec une lecture indépendante (pandas) : CA du 19/10 = 20 factures, 2 211 999,98 ; CA d'octobre = 595 factures ; CA 2026 = 2 271 448 072,80 TTC (= total comptabilisé − 1 217 300 émis en 2025 − 47 000 extournée).
- Au 19/10/2026 : encaissé du jour 4 185 000 (15) ; encaissé du mois 174 724 949,98 ; créances 323 883 682,40 (2 901 factures, dont 301 831 182,42 échues, 29 partielles).
- 15 tests nouveaux (import, doublons de numéro, mise à jour du paiement, CSV, synthèse CA/encaissements/créances) ; `tsc` propre ; 143 tests passent.
  Seul fichier en échec dans cet environnement : `reservation-lifecycle` (exige SUPABASE_URL ; tourne en CI).

## Limites
- « Partiellement réglée » : l'export ne donne pas le montant réglé ; ces 29 factures restent en créances pour leur montant complet.
- 3 factures « Payée » sans date de paiement : elles ne comptent dans aucun encaissé daté.
- 6 factures « 03 - Transfert Anjary Hotel » (72 000, non payées) sont des transferts internes : elles sont comptées comme les autres.
- Une facture annulée dans Odoo après un premier import n'est pas retirée (Odoo efface son numéro, donc elle ne peut pas être reliée).
- Ce CA est celui des factures ; il n'est pas additionné au revenu hébergement des KPI du PMS (il le recoupe en grande partie).
- Les acomptes ne sont pas dans cet export : ils font l'objet de la TASK 49.

## Mise en production
Appliquer la migration SQL **avant** de fusionner (le déploiement ne les applique pas), puis fusionner ; importer ensuite le fichier depuis **Factures & CA**.
