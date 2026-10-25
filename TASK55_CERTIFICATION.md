# TASK 55 — Suivi des créances clients

## Constat (Hôtel Anjary, au 24/10/2026)
2 901 factures non soldées pour 323 883 682 Ar TTC, 655 clients ; 55 % des créances ont plus de 90 jours ; les 20 premiers clients pèsent 62 % du total
(à lui seul, la Société du Port de Toamasina : 114 factures, 55,5 M Ar). Aucun outil ne permettait de voir cette concentration ni de relancer.

## Ce qui est livré (lecture seule : aucune migration, aucune écriture en base)
- Page **Créances** (menu latéral) et API `GET /api/receivables` (permission `finance.manage`).
- Synthèse : total, échu, plus de 90 jours, concentration sur les 20 premiers clients ; ancienneté depuis la date de facture en 5 tranches (0-30, 31-60, 61-90, 91-180, + de 180 jours).
- Liste des clients débiteurs (recherche, filtre « plus de 90 jours »), détail des factures d'un client en un clic.
- **Message de relance prêt à copier** (WhatsApp ou e-mail) : factures impayées les plus anciennes d'abord, total à régler, demande de preuve de paiement ou de date prévue.
- Export CSV de tous les clients (séparateur point-virgule, UTF-8 avec BOM).

## Règles
- Créance = facture « Non payée » ou « Partiellement réglée » (« En paiement » est considérée comme réglée). Ancienneté = jours depuis la date de facture ; échue = échéance dépassée (à défaut, date de facture).
- Les factures dont la date est postérieure à aujourd'hui sont ignorées.

## Vérification
- 7 tests unitaires (bornes des tranches, totaux, échues, plus de 90 jours, classement des clients, base vide, message de relance : ordre, total, exclusion des factures payées, résumé au-delà de 15 lignes, singulier) ; `tsc` propre.
- Recoupement SQL sur la base réelle : 2 901 factures, 323 883 682,40 TTC, 655 clients, échues 2 868 (302 521 182,40), plus de 90 jours 179 110 282,78, top 20 = 62,1 %, tranches 368 / 332 / 363 / 1 159 / 679 factures (60,6 / 40,9 / 43,2 / 118,5 / 60,6 M Ar).

## Limites
- « Partiellement réglée » : le montant déjà réglé n'est pas dans l'export Odoo ; ces factures comptent pour leur montant complet.
- L'outil ne connaît pas les coordonnées des clients (téléphone, e-mail) : le message se copie, il ne s'envoie pas.
- Aucune relance n'est historisée (pas de suivi « relancé le … »).
- La liste affiche les 200 plus gros débiteurs ; la recherche et l'export CSV couvrent les 655.
