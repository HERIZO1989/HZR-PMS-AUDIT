# TASK 23 — Rapport Night Audit en PDF

## Ajoute
- `GET /api/night-audit/report?hotelId=...&date=AAAA-MM-JJ` : PDF A4 (pdf-lib 1.17.1, polices Helvetica standard, aucune dependance systeme).
  Controle de session identique a `GET /api/night-audit` (le hotelId doit etre celui de la session), date validee.
- Contenu : KPI du jour (occupation, ADR, RevPAR, revenu HT), nuitees postees (nombre, HT, TVA, TTC), clients en sejour,
  soldes a recouvrer (folios ouverts > 0), anomalies d'audit ouvertes regroupees par type (ex. "x17") pour rester lisible.
- Bouton "Rapport PDF de cette date" dans l'ecran Night Audit (lien direct, s'ouvre dans un nouvel onglet).
- Aucune migration : lecture seule.

## Verification
- `tests/night-audit-report.test.ts` : 4/4 passes (format des montants sans espace insecable, PDF valide, robustesse
  sans KPI / caracteres hors WinAnsi, pagination 1 page -> plusieurs pages).
- `tsc --noEmit` : aucune erreur.
- Rendu reel controle visuellement : PDF genere avec les chiffres reels d'Anjary du 03/10 (3 nuitees, 528 000 Ar TTC,
  4 soldes, 19 anomalies regroupees) tient sur 1 page, mise en page lisible.
- Les requetes de donnees ont ete validees via SQL equivalent sur la base reelle ; le constructeur Supabase-js lui-meme
  (`buildNightAuditReportData`) n'a pas ete execute ici (pas de cle service role).

## Limites
- Le PDF montre les anomalies ouvertes au moment de la generation, pas un instantane fige de la nuit.
- Les jointures embarquees (guests, rooms, reservations) suivent la convention du reste du code mais sont a confirmer au premier appel reel.
- `next build` ne peut pas etre execute ici (Google Fonts bloque) ; a verifier au deploiement.
