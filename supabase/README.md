# Migrations Supabase — Riviera Suite PMS

## Contexte (BUG-17 de l'audit)

Jusqu'a TASK 8, tout le schema a ete construit via des appels directs a l'outil
Supabase MCP (`apply_migration`), qui les enregistre dans l'historique de migration
interne de Supabase (25+ migrations trackees, consultables via
`Supabase:list_migrations` ou le Dashboard Supabase -> Database -> Migrations) —
mais ce texte SQL n'etait jamais commite dans ce repository Git.

## Etat reel de ce dossier (honnete, pas un dump complet pretendu)

- `20260918000000_functions_baseline_part1.sql` — 10 fonctions (contexte RBAC/session,
  authentification TASK 2, facturation) extraites **directement de la base reelle**
  via `pg_get_functiondef()` : garanties identiques a la production, pas retapees de
  memoire.

- Les fonctions restantes (generateur de demo, cycle de vie reservation/folio/
  paiement de TASK 1, moteur d'audit, pipeline d'import, synchronisation housekeeping
  de TASK 4) ne sont **pas** dupliquees ici. Certaines depassent 150 lignes chacune ;
  les retranscrire manuellement dans ce rapport aurait un risque reel de divergence
  silencieuse avec la version reellement deployee — un dump qui a l'air complet mais
  contient une erreur de transcription est pire qu'une absence de dump. La source
  fiable pour ces fonctions reste la base Supabase elle-meme et son historique de
  migrations natif.

- `SCHEMA_REFERENCE.md` — liste verifiee des tables/index/policies RLS telle
  qu'observee au moment de TASK 8 (obtenue par introspection directe
  `information_schema`/`pg_indexes`/`pg_policies`), a titre de documentation de
  reference.

## Recommandation pour combler l'ecart restant

Utiliser `supabase db pull` (CLI officielle Supabase, avec le mot de passe de la
base) depuis un poste ayant acces reseau complet au projet, ce qui genere un dump
exact et complet de tout le schema en un run — plus fiable qu'une reconstruction
manuelle. Cette commande n'a pas pu etre executee dans mon environnement (CLI non
installee, et acces reseau direct a la base Postgres non disponible depuis mon
sandbox).

## Regle a partir de maintenant

Toute nouvelle migration doit etre ajoutee ici comme un nouveau fichier
`YYYYMMDDHHMMSS_description.sql` en plus d'etre appliquee via Supabase.
