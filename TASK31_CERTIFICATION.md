# TASK 31 — Refonte visuelle professionnelle du PMS

## Direction
Encre marine pour l'ossature, acier pour les actions, laiton pour l'unique accent de prestige (marque, onglet actif,
bandeau des indicateurs, plan actuel). Panneaux blancs a filet fin sur fond gris clair (l'ancien fond blanc sur blanc
aplatissait tout). IBM Plex Sans pour l'interface, Fraunces reserve aux titres de page et aux chiffres clefs.

## Ce qui change
- Navigation : une seule barre (marque, sections, utilisateur avec initiales) au lieu de deux barres + une bande vide ; seconde ligne defilante sur mobile.
- Systeme commun (`globals.css`, `tailwind.config.ts`) : `.panel`, `.btn-primary/secondary`, `.field`, `.data-table`, `.page-title`, `.row-action` ; rayons 3/4/6 px ; ombres discretes.
- Pastilles teintees (statut, VIP, gravite, controles d'audit, abonnement) au lieu de simples contours.
- Tableau de bord : indicateurs en bandeau unique, graphiques en panneaux, constats avec actions en boutons et recommandations en encart.
  Correction d'un defaut : les etiquettes de l'axe ADR/RevPAR etaient tronquees (valeurs compactes « 148 k »).
- Reservations, Clients, Housekeeping (colonnes adaptatives), Night Audit, Imports, Facturation, Folio (fenetre modale accessible) : meme langage.
- Connexion : panneau de marque + formulaire sobre ; libelles relies aux champs (accessibilite).
- Ancien nom de couleur `brass` (qui designait en fait un bleu) renomme `steel` ; `brass` designe maintenant le vrai laiton.

## Securite : retrait volontaire
La page de connexion affichait publiquement un compte de demonstration avec son mot de passe et pre-remplissait l'e-mail.
Les deux sont retires (aucun test ni workflow n'en depend).

## Verification
- Rendu controle en image (Chromium, polices reelles, donnees fictives) : connexion, tableau de bord, reservations, folio, night audit,
  housekeeping, imports (avec resultat d'analyse), facturation, et vues mobiles. Un defaut d'alignement d'en-tete de tableau a ete trouve et corrige.
- `tsc --noEmit` propre ; 22 tests unitaires passent. Aucune logique metier ni appel d'API modifie.

## Limites
- `next build` complet non execute ici (Google Fonts bloque) : a verifier au deploiement.
- Le correctif d'alignement de l'en-tete « Montant » a ete verifie par le calcul de specificite CSS, pas par une derniere capture.
- Ecran Clients non capture ; ecrans reels non vus avec les vraies donnees d'Anjary.
- Contraste et clavier : focus visible et mouvement reduit respectes ; pas d'audit d'accessibilite complet.
