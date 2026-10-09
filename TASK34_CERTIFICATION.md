# TASK 34 — Générateur d'hôtels de démonstration en un clic

## Constat
Le générateur SQL `generate_demo_hotel` existait (groupe, hôtel, 5 types de chambres, chambres, 6 rôles et comptes, clients VIP, 3 plans tarifaires, calendrier,
réservations, séjours, housekeeping, folios, paiements, conciergerie, Night Audit) mais :
- aucun écran ni route ne l'appelait ;
- ses 6 comptes avaient le mot de passe « DEMO_PLACEHOLDER_HASH » : connexion impossible ;
- il échouait en bloc dès que deux séjours tombaient sur la même chambre (constaté : 40 réservations pour 30 chambres).

## Ce qui est livré
- Base (migration `20261017000000_demo_hotels.sql`, appliquée) : `tenants.is_demo` ; générateur fiabilisé (chaque réservation retentée jusqu'à 10 fois) ;
  `create_demo_hotel` (bornes 5-200 chambres, 5-500 clients, 0-2000 réservations ; plafond de 25 hôtels de démo ; mot de passe aléatoire de 12 caractères, haché bcrypt) ;
  `delete_demo_tenant` (suppression complète dans l'ordre des dépendances ; refuse tout tenant non marqué démo). Droits : service_role uniquement.
- API `GET/POST /api/demo-hotels`, `DELETE /api/demo-hotels/[tenantId]` : session obligatoire ET adresse listée dans `PLATFORM_ADMIN_EMAILS` (refus par défaut si la variable est absente).
- Écran « Démo » (visible seulement pour l'administrateur de la plateforme) : formulaire, identifiants affichés une seule fois (code établissement, mot de passe, 6 comptes), liste et suppression.

## Vérification
- Base réelle, transaction annulée : 60 réservations créées en 0,34 s sans erreur ; connexion réelle avec le mot de passe généré ; mauvais mot de passe refusé ;
  nom trop court, trop de chambres, trop de réservations refusés ; suppression d'Anjary refusée et Anjary intact ; suppression d'une démo : 0 reliquat, nombre de tenants inchangé ;
  anon sans droit d'exécution.
- 10 tests unitaires (accès administrateur, validation) ; 1 test d'intégration (création, connexion, protection d'un vrai tenant, suppression) qui tourne en CI.
- Écran contrôlé en image (création, liste, mobile). `tsc` propre ; 50 tests unitaires passent.

## Limites
- Montants en euros (l'hôtel généré est un établissement de la Côte d'Azur) ; pas de choix de devise.
- Les 6 comptes partagent un mot de passe ; les e-mails sont identiques d'un hôtel à l'autre (`gm@demo.local`...) : le code établissement est obligatoire à la connexion.
- Le mot de passe n'est pas conservé : perdu, il faut supprimer l'hôtel et en recréer un.
- Le générateur ne reproduit pas la TVA ni les nuitées postées automatiquement d'Anjary.
- Variable à définir côté serveur : `PLATFORM_ADMIN_EMAILS` (sans elle, l'écran Démo n'apparaît pour personne).
