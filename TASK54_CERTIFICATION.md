# TASK 54 — Contrôles d'audit des données

## Constat
Les données réelles d'Hôtel Anjary contiennent des anomalies que personne ne voit : numéros de facture en double, créances très anciennes, séjours terminés jamais clôturés, charges non classées.
Elles sont découvertes une par une, à la main, au lieu d'être surveillées.

## Ce qui est livré (lecture seule : aucune migration, aucune écriture en base)
- Page **Contrôles d'audit** (menu latéral), API `GET /api/audit` (permission `finance.manage`), avec une synthèse par gravité (critique / à traiter / à surveiller / conforme).
- 10 contrôles, chacun avec le constat, le nombre, le montant, l'action à faire et les 10 principaux cas :
  numéros de facture en double ; créances de plus de 90 jours (part des créances, principaux débiteurs) ; séjours terminés restés « Confirmé » (nuits, montant) ; réservations sans type de chambre ; dépenses non classées (part, principaux fournisseurs) ;
  charges de personnel absentes ; dépenses en attente ; acomptes non reportés sur le folio ; acomptes d'annulations à traiter ; factures payées sans date de paiement.
- Bouton **Exporter en CSV** (séparateur point-virgule, UTF-8 avec BOM, lisible dans Excel) : la synthèse puis les cas de chaque contrôle.

## Vérification
- 8 tests unitaires (base saine, doublons de numéros avec exemples, créances et part, seuil critique/à traiter, séjours confirmés passés, dépenses non classées / personnel / attente, acomptes, tri par gravité) ; `tsc` propre.
- Recoupement SQL sur la base réelle (Hôtel Anjary, au 24/10/2026) : 2 158 numéros en double (4 316 factures, 886 233 955 Ar TTC) ; 1 838 créances de plus de 90 jours (179 110 283 Ar, 55 % des créances) ; 531 séjours confirmés terminés (1 395 nuits, 232 957 784 Ar) ;
  584 réservations actives sans type de chambre ; dépenses non classées 28,0 % ; 15 dépenses en attente ; personnel approuvé 200 000 000 HT ; 0 facture payée sans date.

## Limites
- Les contrôles constatent et listent : aucun ne modifie des données. La correction des séjours « Confirmé » passés fait l'objet de la tâche suivante.
- Les 10 cas affichés sont les plus gros montants ; l'export CSV reprend ces mêmes 10 cas, pas la liste complète.
- Les créances sont mesurées depuis la date de facture (pas la date d'échéance).
