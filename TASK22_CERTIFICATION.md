# TASK 22 — Import des exports Odoo (source "odoo")

## Ce qui est ajoute
- Source `odoo` : type `SourceSystem`, option "Export Odoo" dans l'ecran Imports, contrainte `import_batches_source_system_check`
  (migration `20261009000000_import_source_odoo.sql`, appliquee a la base).
- Preset Odoo (interface francaise) : Reference, Client, Email, Arrivee, Depart, Total, Statut, Adultes, Enfants, Devise.
- `resolveMapping` : un preset n'est retenu que si TOUS ses en-tetes requis existent dans le fichier ; sinon repli sur la
  suggestion par synonymes (ajout des libelles FR : Reference, Client, Courriel, Arrivee, Depart). Cela protege aussi Opera/Protel.
- Le reste de la chaine existante (parsing CSV/TXT/XLSX, validation, normalisation, traçabilite par import_batch) est inchange.

## Verification
- `tests/odoo-import.test.ts` : 5 tests purs, 5/5 passes (preset retenu, repli anglais, synonymes FR, dates-heures + Ariary, non-regression Opera).
- `tsc --noEmit` : aucune erreur.
- Contrainte appliquee a la base reelle.

## Limites (a lire)
- Les en-tetes du preset sont ceux d'un export Odoo francais standard, PAS valides sur un export reel d'Anjary :
  il faut un fichier reel pour confirmer. Sans correspondance exacte, le repli par synonymes s'applique et l'utilisateur confirme le mapping.
- `next build` echoue dans cet environnement (telechargement Google Fonts bloque), sans lien avec le code ; a verifier au deploiement.
- Pas de test de bout en bout de l'API d'upload (session + service role non disponibles ici).
