# TASK 18 — Night audit : posting des nuitees + devise des messages d'anomalie

## Constat
`compute_kpi_snapshots` calcule ADR/RevPAR a partir des `folio_lines` `room_charge` (posted_at::date = jour
d'exploitation), mais aucune fonction ne postait ces nuitees : a Anjary ADR et RevPAR restaient a 0 tant que le
personnel ne saisissait pas chaque nuitee. Les messages d'anomalie ADR/RevPAR de `run_hotel_audit` affichaient
un symbole euro en dur (hotel en MGA).

## Correctif (migration 20261004000000_post_room_charges.sql, appliquee a la base)
- `post_room_charges(hotel, date_exploitation, staff)` : pour chaque reservation `checked_in` couvrant la nuit
  (arrivee <= date < depart) avec folio ouvert, poste 1 ligne `room_charge` = tarif du calendrier du plan de la
  reservation (sinon tarif de base) + supplements d'occupation ; recalcule le solde du folio et les KPI du jour ;
  journalise l'operation. Idempotent (index unique partiel sur (folio_id, reference 'NIGHT:AAAA-MM-JJ')).
  Execution reservee a service_role.
- `run_hotel_audit` : devise de l'hotel dans les messages (plus aucun symbole euro en dur).
- API `POST /api/night-audit` avec `action: 'post_room_charges'` + `businessDate` (permission night_audit.run,
  plage : 31 jours passes a lendemain) ; page Night Audit : section « Poster les nuitees ».

## Verification (transaction annulee d'office sur la base reelle, avant application)
Nuit des fetes 24/12 : 191 000 MGA postes ; relance : 0 poste / 1 ignore ; solde 191 000 ; ADR 191 000, CA chambres
191 000 ; 2e nuit postee ; jour du depart : rien ; solde apres 2 nuits 382 000. Plus aucun euro dans run_hotel_audit.

## Non inclus
- Taxes de sejour et TVA (taux non definis).
- Posting automatique planifie (cron) : le posting est declenche par le bouton / l'API.
- No-show et reconciliation des statuts chambres (checks du Night Audit) non traites ici.
