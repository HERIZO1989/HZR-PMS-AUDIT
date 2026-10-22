# TASK 49 — Acomptes sur réservation

## Principe
Un acompte est une **avance, pas du chiffre d'affaires** : il est encaissé sur la réservation avant l'arrivée, puis
- **reporté comme paiement sur le folio au check-in** (le client n'a plus que le solde à payer), ou
- **remboursé ou conservé** (pénalité) après une annulation ou un no-show.
Il apparaît dans les encaissements d'acomptes de l'écran Factures & CA, jamais dans le CA des factures.

## Ce qui est livré
- Migration `20261026000000_reservation_deposits.sql` : table `reservation_deposits` (RLS sans politique, accès par l'application) et trois fonctions **nouvelles** : `record_deposit`, `apply_reservation_deposits`, `resolve_deposit`.
  Aucune fonction existante n'est modifiée (`check_in_reservation`, `cancel_reservation`, `add_payment` inchangées).
- Réservations : bouton **Acompte** (réservations tentative/confirmée, annulées, no-show) → panneau pour encaisser (espèces, carte, virement, mobile money/en ligne, autre ; référence facultative), voir l'historique, et rembourser ou conserver après annulation.
- Check-in : l'acompte est reporté automatiquement sur le folio ouvert. Si le report échoue, **le check-in reste valide** et un message l'indique ; l'acompte reste « en attente ».
- Factures & CA : cartes Acomptes — reçus du jour/mois/année, en attente d'arrivée, à traiter (annulations), remboursés/conservés de l'année, et alerte « à reporter » si un client arrivé n'a pas eu son acompte reporté.
- Droits : encaisser = `reservations.manage` ; rembourser/conserver = `finance.manage` (sortie d'argent, réservée OWNER/GM/NIGHT_AUDIT).

## Garde-fous (en base, sous verrou)
- Acompte refusé si le montant est nul/négatif, le mode inconnu, la réservation n'est plus tentative/confirmée, ou si le total des acomptes dépasserait le montant du séjour.
- Même clé d'idempotence = même acompte (pas de doublon si le bouton est pressé deux fois).
- Report au check-in idempotent (un second appel ne reporte rien) ; le folio n'est pas clôturé par le report.
- Remboursement/conservation : une seule fois, et seulement après annulation ou no-show.
- Chaque action est inscrite au journal d'audit.

## Vérification
- Scénarios exécutés **sur la vraie base** (hôtel de démonstration, transaction annulée automatiquement, aucune donnée conservée) :
  enregistrement, rejeu idempotent, dépassement refusé, montant négatif refusé, mode invalide refusé, report avant check-in refusé,
  check-in puis report (200 reporté, 1 paiement « ACOMPTE », folio ouvert, solde −200), second report = 0, acompte après check-in refusé,
  résolution avant annulation refusée, conservation après annulation, seconde résolution refusée, action invalide refusée.
- 6 tests unitaires nouveaux (validation, synthèse, fuseau Madagascar) ; `tsc` propre.
  Seul fichier en échec dans cet environnement : `reservation-lifecycle` (exige SUPABASE_URL ; tourne en CI).

## Limites
- La **modification d'une réservation** (réduction du montant du séjour) n'est pas bloquée par les acomptes déjà encaissés.
- Le remboursement est un **enregistrement** : le décaissement réel (espèces, virement, mobile money) reste à faire par l'hôtel.
- Un acompte conservé n'est pas converti en CA : il est suivi dans « conservés (année) ».
- Les réservations importées d'Odoo n'ont pas d'acompte (l'export ne les contient pas).

## Mise en production
Appliquer la migration SQL **avant** de fusionner (le déploiement ne les applique pas), puis fusionner.
