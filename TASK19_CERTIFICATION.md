# TASK 19 — TVA sur les nuitees postees

`hotels.vat_rate` (0 a 1, defaut 0) et `hotels.prices_include_vat` (defaut true). Anjary : TVA 20 %, tarifs TTC.

`post_room_charges` :
- taux 0 : inchange ; prix TTC : ligne `room_charge` = HT (TTC / (1 + taux)) + ligne `tax` = TTC - HT ;
  prix HT : ligne `room_charge` = tarif + ligne `tax` = tarif x taux ;
- le solde du folio (room_charge + tax) reste le montant TTC ; ADR / RevPAR (room_charge seul) sont HORS TVA ;
- idempotent : index unique partiel pour les lignes `tax` (en plus de celui des `room_charge`).
Migration `20261005000000_vat_room_charges.sql` appliquee a la base.

## Verification (transaction annulee d'office sur la base reelle)
Nuit des fetes 191 000 TTC : chambre 159 166,67 + TVA 31 833,33 ; solde 191 000 ; ADR 159 166,67 (HT) ;
relance sans doublon ; TVA 0 : pas de ligne de taxe ; prix HT : 191 000 + 38 200 = 229 200.

## Non inclus
- Taxe de sejour (montant non communique), frais de service.
- Le montant des reservations (`reservations.total_amount`) reste exprime comme les tarifs saisis (TTC a Anjary).
