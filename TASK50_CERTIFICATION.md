# TASK 50 — Import : rendre visible la période et proposer « tout le fichier »

## Constat
Avec la source Odoo, l'écran Imports se règle par défaut sur « Séjours en cours et à venir ». Les imports d'Anjary des 19/10, 20/10 et 22/10
ont donc écarté tous les séjours passés (4 725 lignes « hors période importée » le 22/10) et n'ont rien importé. L'écran affichait
seulement « N ignorées » sans dire pourquoi ni comment charger l'historique.

## Ce qui change
- L'analyse renvoie le nombre de séjours écartés uniquement à cause de la période, et la date de début de période.
- L'écran affiche un bandeau « N séjours terminés avant le JJ/MM/AAAA ne sont pas importés » avec un bouton **Analyser tout le fichier** qui relance l'analyse sans filtre de période (un seul geste).
- Aucune règle d'import, aucune donnée et aucune base ne sont modifiées.

## Vérification
- `tsc` propre ; test existant « Période importée » complété (3 séjours hors période comptés comme l'écran les compte) ; tests Odoo verts.
- Simulation sur le fichier réel (4 772 lignes Odoo) avec les 7 types de chambre d'Anjary : 5 972 séjours valides, 25 ignorés (6 regroupements, 19 locations de salle), 1 refusé.

## Limites
- Le défaut « en cours et à venir » est conservé (choix du projet) ; seul son effet est rendu visible.
