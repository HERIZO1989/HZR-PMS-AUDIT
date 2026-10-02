# TASK 17 — Capacite et tarification par occupation

- `room_types.extra_adult_fee` / `extra_child_fee` (par personne et par nuit, defaut 0 : aucun changement de prix
  tant que non configure).
- `create_reservation` : refuse adults < 1 et adults + children > max_occupancy ; supplement par nuit =
  adultes au-dela de base_occupancy x frais adulte + enfants au-dela des places restantes de la base x frais enfant.
- Migration `20261003000000_occupancy_pricing.sql` appliquee ; signature inchangee, 1 seule fonction.

## Verification (transaction annulee d'office sur la base reelle, avant application)
2 adultes inchange (318 000) | 3 adultes sur max 2 refuse | 2+1 sur max 2 refuse | 0 adulte refuse |
avec supplements (base 2, max 4, +30 000 / +10 000) : 3 adultes x 3 nuits = 567 000 ; 2+2 = 537 000 ;
1+2 = 507 000 ; 5 personnes refuse | 1 seule fonction.

## Etat d'Anjary
base_occupancy = max_occupancy sur ses 7 types (2/3/4 personnes) : aucun supplement possible tant qu'un type
n'accepte pas de personne en plus ; les supplements sont a renseigner si un lit d'appoint est propose.

## Attention
La capacite est desormais appliquee : les reservations de demonstration Riviera "Classic Double" (max 2) deja
au-dessus de la capacite (10 lignes de donnees d'exemple) restent en base mais ne peuvent plus etre recreees.
