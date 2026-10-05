# TASK 25 — Regles statistiques ADR / RevPAR : jours occupes uniquement, echantillon minimum

## Constat (investigation des "17 jours a ADR 0" d'Anjary, 4-19/09)
- Les chiffres etaient CORRECTS : ces jours n'avaient aucune chambre occupee (rooms_occupied = 0, aucune reservation),
  donc ADR = 0 par definition. Ma premiere hypothese (chambres occupees sans revenu) etait fausse.
- Le vrai defaut : `run_hotel_audit` calculait la moyenne ADR sur les jours occupes mais testait TOUS les jours,
  donc chaque jour vide etait signale "Anomalie tarifaire (ADR)" : 16 faux positifs qui noyaient les vraies alertes.

## Correctif (migration `20261010000000_audit_stat_rules_occupied_days.sql`, patch idempotent de la fonction existante)
- ADR et RevPAR : seuls les jours avec rooms_occupied > 0 sont juges ; la moyenne/ecart-type RevPAR est calculee sur ces jours.
- Regles actives seulement si la periode compte au moins 7 jours occupes (sinon l'ecart-type n'a pas de sens).
- Le reste de la fonction (dont l'appel TASK 24 et les regles TASK 21) est inchange et verifie present.

## Verification (transaction annulee d'office sur la base reelle, puis application)
- Anjary : alertes ADR 16 -> 0 ; l'alerte RevPAR du 03/10 (3 chambres contre 2 les jours precedents) reste detectee,
  la regle fonctionne donc toujours sur les jours occupes.
- Riviera (hotel de demo avec donnees) : 0 alerte ADR/RevPAR avant et apres, aucune alerte ADR sur jour vide.
- Apres application : audit d'Anjary = 1 critique (folio 07d30fdc19) + 1 avertissement (RevPAR).

## Limites
- Pas de cas positif ADR dedie (aucun hote de test n'a un vrai ecart tarifaire) ; la regle ADR partage la meme structure que RevPAR, qui est validee.
- Le seuil de 7 jours est un choix de ma part, ajustable.
