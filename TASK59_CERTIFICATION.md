# TASK 59 — Rapport mensuel de performance (PDF et Excel)

## Constat
Chaque mois, les chiffres à remettre au client (ou à la direction) étaient dispersés dans plusieurs écrans : indicateurs, CA, dépenses, créances.
Aucun document ne les réunissait avec leur comparaison et leurs réserves.

## Ce qui est livré (lecture seule : aucune migration, aucune écriture en base)
- Page **Rapport mensuel** (menu latéral, permission `finance.manage`) : choix du mois (par défaut le mois précédent).
- Contenu : indicateurs clés (occupation, ADR, RevPAR, TRevPAR, CA facturé HT, hébergement HT, dépenses HT, GOP, marge, GOPPAR) pour le mois, le mois précédent, l'évolution (points pour l'occupation, % pour le reste) et le cumul de l'année ;
  dépenses du mois par catégorie avec leur part ; créances actuelles (total, fiables, à rapprocher, plus de 90 jours) et 10 principaux débiteurs ; **points d'attention** ; date de la dernière facture importée et des derniers indicateurs.
- **Imprimer / PDF** : mise en page propre (menu masqué, fond blanc, tableaux sans coupure) via l'impression du navigateur.
- **Télécharger Excel** : classeur de 4 feuilles (Synthèse, Dépenses, Créances, Points d'attention) avec de vrais nombres formatés. API `GET /api/report?hotelId&month=AAAA-MM[&format=xlsx]`.
- Points d'attention automatiques : mois incomplet, factures importées seulement jusqu'à une date antérieure à la fin de période, absence de charges de personnel, dépenses non classées au-delà de 20 %, créances « à rapprocher », créances de plus de 90 jours au-delà de 25 %.

## Vérification
- 10 tests unitaires (indicateurs du mois / mois précédent / cumul, exclusion des factures extournées et des dépenses postérieures, évolutions, dépenses par catégorie, créances, points d'attention, mois incomplet, mois sans donnée, libellés, contenu du classeur Excel relu avec la bibliothèque) ; `tsc` propre.
- Recoupement SQL sur la base réelle, septembre 2026 : occupation 44,3 %, ADR 120 758, RevPAR 53 436, TRevPAR 62 868, CA facturé HT 226 324 958, dépenses 54 556 127, GOP 171 768 831 (75,9 %), GOPPAR 47 714 ; août 2026 : 46,3 %, 114 515, 53 071, 61 518.

## Limites
- Le PDF passe par l'impression du navigateur : l'application ne génère pas de fichier PDF elle-même.
- Les créances sont celles d'aujourd'hui, pas celles de la fin du mois choisi (l'historique des paiements n'est pas conservé).
- Un mois sans facture ni dépense importée affichera des zéros : le point d'attention le signale.
- Le GOP reste surévalué tant que les charges de personnel ne sont pas saisies pour tous les mois.
