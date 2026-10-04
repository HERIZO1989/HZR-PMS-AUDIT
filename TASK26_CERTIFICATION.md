# TASK 26 — Alertes e-mail sur les anomalies critiques d'audit

## Ajoute
- Migration `20261011000000_audit_alert_notifications.sql` (appliquee a la base) : table `audit_alert_notifications` (RLS activee,
  aucun droit anon/authenticated), fonctions `new_critical_findings` (critiques ouvertes jamais notifiees) et `alert_recipients`
  (OWNER/GM actifs). Deduplication par empreinte md5(titre|date|description), car l'audit recree les findings (ids neufs) a chaque passage.
- `src/lib/alerts/auditAlerts.ts` : par hotel actif, relance l'audit, envoie UN digest, memorise les empreintes seulement si l'envoi a reussi ;
  un hotel en erreur n'empeche pas les autres.
- `POST /api/cron/audit-alerts` : protege par `Authorization: Bearer CRON_SECRET` (comparaison a temps constant ; 503 si CRON_SECRET absent).
- `.github/workflows/audit-alerts.yml` : toutes les 2 h (+ lancement manuel).
- E-mail HTML echappe (descriptions issues de donnees saisies).

## Verification
- Base reelle (transaction annulee puis application) : 1 critique nouvelle a Anjary, 2 destinataires (OWNER + GM) ; apres marquage "envoye" et
  relance de l'audit : 0 nouvelle ; si la situation change (description differente) : nouvelle alerte ; anon sans droit sur la table ni les fonctions.
- `tests/audit-alerts.test.ts` : 6/6 (digest unique + empreintes, rien si rien de nouveau, rien memorise si l'envoi echoue,
  absence de destinataire, isolation entre hotels, echappement HTML). `tsc --noEmit` propre.

## A FAIRE PAR LE PROPRIETAIRE (sans cela aucune alerte ne part)
1. Render > service > Environment : ajouter `CRON_SECRET` (valeur aleatoire longue) et verifier que `RESEND_API_KEY` est bien definie.
2. GitHub > Settings > Secrets and variables > Actions : `CRON_SECRET` (meme valeur) et `APP_URL` (https://pms-riviera.onrender.com).
3. Lancer une fois le workflow "Audit Alerts" a la main (Actions > Audit Alerts > Run workflow) et lire le JSON retourne.

## Limites
- Resend en mode sandbox (domaine onboarding@resend.dev) n'envoie qu'a l'adresse du compte proprietaire Resend : tout autre destinataire echouera
  (rien n'est alors memorise, nouvelle tentative a chaque passage) tant qu'un domaine n'est pas verifie.
- Le chemin HTTP reel (route + Resend) n'a pas ete execute ici ; seules la logique (avec faux client) et la base l'ont ete.
- Le service Render gratuit peut dormir : le premier appel du workflow le reveille (delai de 150 s prevu).
