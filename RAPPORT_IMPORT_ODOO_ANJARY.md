# Export Odoo d'Anjary — lecture par le PMS (au 7 octobre 2026)

Fichier : « Réservations hôtels (hotel.booking) », 4 673 lignes, du 10/01/2026 au 21/01/2027. Aucune donnée n'a été importée en base.

## Lecture
| | Lignes |
|---|---:|
| Lignes du fichier | 4 673 |
| Lignes de regroupement Odoo (totaux par statut), ignorées | 6 |
| Réservations lues | 4 667 |
| Importables | 4 391 |
| Séjours à la journée (arrivée = départ), non importables | 275 (40,7 M Ar) |
| Erreur de saisie (départ le 02/04, arrivée le 30/04) | 1 |

Les totaux de chaque statut (nombre de lignes et montants) correspondent exactement à ceux annoncés par Odoo.

## Statuts importables
| Statut Odoo | Statut PMS | Lignes |
|---|---|---:|
| Sortie | Parti (checked_out) | 3 953 |
| Confirmé, Attribué, Verrouiller | Confirmée (confirmed) | 353 |
| Brouillon | Provisoire (tentative) | 52 |
| Annulé | Annulée (cancelled) | 33 |

## Points d'hygiène à regarder dans Odoo
- **301 réservations restées à un statut intermédiaire alors que leur séjour est terminé** (169 Confirmé, 72 Attribué, 47 Brouillon, 13 Verrouiller) : elles n'ont jamais été passées en « Sortie » ni « Annulé ». C'est le même défaut que le séjour test resté ouvert à Anjary.
- **La colonne « Référence » n'identifie pas une réservation** : 720 références pour 4 667 séjours, avec des clients différents. Le PMS construit donc son propre numéro (référence + date d'arrivée + empreinte).
- **46 réservations importables n'ont pas de montant** (importées à 0) et **2 sont en euros**.
- 275 séjours à la journée (275 lignes, dont 265 déjà sortis) représentent 40,7 M Ar de chiffre d'affaires que le PMS ne sait pas porter aujourd'hui.

## À décider
1. « Verrouiller » : séjour clôturé ou simplement confirmé ?
2. Importer l'historique dans le PMS, ou seulement les séjours à venir et en cours (111 réservations confirmées, attribuées ou provisoires dont le départ est à partir d'aujourd'hui : 90 Confirmé, 15 Attribué, 6 Brouillon) ?
3. Prendre en charge les séjours à la journée ?
