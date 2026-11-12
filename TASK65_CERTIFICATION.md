# TASK 65 — Onglet « Paiements du jour » (temps réel)

## Besoin
Savoir le jour même quelles factures sont payées, non payées ou partiellement payées, avec les acomptes, en temps réel.

## Ce qui est livré (lecture seule : aucune migration, aucune écriture en base)
- Onglet **Paiements du jour** (menu latéral ; droit `reservations.manage` ou `finance.manage`) : choix du jour, **actualisation automatique toutes les 30 secondes** pour le jour courant (pause quand l'onglet du navigateur est masqué) et bouton Actualiser.
- Un séjour par ligne, regroupés en **Arrivées**, **En séjour**, **Départs** (filtres, recherche par client, n° de confirmation ou chambre) : à payer, encaissé, **acompte**, solde, et statut **Payé / Partiellement payé / Non payé / À facturer**.
- Cartes : **caisse du jour** (paiements captures ce jour + acomptes reçus ce jour, par mode de paiement), payés, partiels, non payés avec leur reste, reste à encaisser et acomptes versés.
- **Agir sans quitter l'onglet** : bouton *Paiement* (panneau Folio) pour un client enregistré, bouton *Acompte* pour une arrivée pas encore enregistrée ; l'onglet se met à jour aussitôt.
- Règles : avec folio, à payer = total facturé (solde + paiements), encaissé = paiements captures (acomptes reportés compris, comptés une seule fois) ; avant le check-in, à payer = montant du séjour et encaissé = acomptes reçus. Un reste inférieur à 1 Ar est un solde ; un trop-perçu n'est pas compté dans le reste à encaisser. Les acomptes reportés au check-in ne sont pas recomptés dans la caisse du jour.
- API `GET /api/payments/overview?hotelId&date`.

## Vérification
- 8 tests unitaires (payé / partiel / non payé, tolérance d'arrondi et trop-perçu, « à facturer », séjour avant check-in avec acompte, acompte reporté compté une fois, groupes arrivée / départ / séjour, synthèse, caisse du jour avec fuseau de Madagascar et exclusion des acomptes reportés) ; `tsc` propre.
- Règle du solde confirmée sur la base : pour les 98 folios, `solde = lignes facturées − paiements captures`, donc facturé = solde + paiements.
- Recoupement SQL sur la base réelle au 12/11/2026 : 111 séjours (15 arrivées, 8 départs, le reste en séjour), 0 payé, 0 partiel, 110 non payés, 1 à facturer, reste à encaisser 46 084 000 Ar, 0 acompte, **2 paiements enregistrés au total dans le PMS**.

## Limite essentielle
**L'onglet ne montre que ce qui est saisi dans le PMS.** Aujourd'hui presque rien n'y est saisi (2 paiements, 0 acompte) : tous les séjours apparaissent « non payés » et la caisse est à zéro, ce que l'écran explique par un bandeau. Les règlements faits dans Odoo ou en caisse hors PMS n'y figurent pas. Pour un suivi réel, chaque paiement doit être enregistré dans le Folio et chaque acompte via « Acompte ».
Les factures importées d'Odoo (statuts Payé / Non payé / Partiel) restent consultables dans « Factures & CA » ; elles ne valent que pour la date du dernier import.
