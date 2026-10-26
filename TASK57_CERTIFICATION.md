# TASK 57 — Recalcul des indicateurs (KPI) sans intervention

## Constat
Les indicateurs journaliers (occupation, ADR, RevPAR, revenu) ne se recalculaient que par la routine de nuit.
Après l'import de l'historique ou une correction de statuts, le tableau de bord restait périmé : il a fallu lancer le calcul à la main, en base, à chaque fois.

## Ce qui est livré (aucune migration : la fonction `compute_kpi_snapshots` existe déjà)
- **Recalcul automatique en fin d'import** : après l'application d'un lot, la plage des séjours importés (première arrivée → dernier départ, sans dépasser aujourd'hui, 400 jours maximum) est recalculée. Le résumé de l'import indique les jours recalculés.
  Un échec du recalcul n'annule jamais l'import : le message l'indique et renvoie au bouton.
- **Bouton « Recalculer les indicateurs »** dans la section Performance de « Factures & CA » : recalcule du 1er janvier à la date choisie, puis recharge le tableau. API `POST /api/kpis/recompute` (permission `finance.manage`).
- Validation : dates réelles (le 30 février est refusé), fin ramenée à aujourd'hui, début ≤ fin, 400 jours maximum.
- Le recalcul n'écrit que dans `kpi_daily_snapshots` (mise à jour des lignes du même jour) ; il se refait à volonté.

## Vérification
- 6 tests unitaires (plage valide, fin ramenée à aujourd'hui, dates absentes / impossibles / inversées, bornes 400 et 401 jours, plage déduite des séjours importés, lignes sans dates, séjours entièrement à venir, historique trop long) ; `tsc` propre.
- Un test a révélé un défaut avant la livraison : une date impossible (30 février) levait une exception au lieu d'être refusée ; corrigé.
- La fonction appelée est celle déjà utilisée en production pour recalculer janvier → octobre (298 jours).

## Limites
- Le recalcul automatique suppose que l'import se termine : si l'application d'un lot est interrompue et relancée, il se fait à la fin de la relance.
- Les changements de statut faits à la main en base ne déclenchent rien : utiliser le bouton.
