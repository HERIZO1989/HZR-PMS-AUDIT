# TASK 53 — Nom « PMS Audit » dans les documents et commentaires

## Constat
L'application affiche déjà « PMS Audit » (titre de l'onglet, page de connexion, menu latéral, expéditeur des e-mails). Restaient « Riviera Suite PMS » dans trois titres de documents,
un exemple de domaine dans un commentaire d'e-mail et deux textes du script de déploiement.

## Ce qui change (texte uniquement, aucun comportement)
- Titres de `supabase/README.md`, `supabase/SCHEMA_REFERENCE.md`, `SECURITY_MODEL.md` : « PMS Audit ».
- `src/lib/email.ts` : l'exemple de domaine du commentaire devient `mail.pms-audit.com`.
- `deploy-to-github.sh` : message de commit et exemple d'adresse de dépôt.
- `tsc` propre ; aucune règle, donnée, base ou interface modifiée.

## Ce qui ne change pas (volontairement)
- L'**adresse web** `pms-riviera.onrender.com` reste dans `ci.yml`, `deploy.yml`, `e2e-production.yml` et le secret `APP_URL` : c'est l'adresse réelle du service Render, qui ne se renomme pas. La changer demande un domaine personnalisé ou un nouveau service Render (choix en attente).
- Les fiches historiques TASK 1 à 52 et le nom de l'hôtel de démonstration « Grand Hotel Riviera Cannes » (données).
