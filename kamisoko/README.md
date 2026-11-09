# Kamissoko & Frères — boutique en ligne + espace administrateur

Vitrine de prêt-à-porter **en gros et en détail** (Grand Marché de Bamako), avec commande par **WhatsApp** (+223 76 27 14 72) et un **espace administrateur** pour que le commerçant gère lui-même ses produits.

## Démarrer

```bash
cd kamisoko
npm install
cp env.example .env      # puis éditer si besoin
npm start                # http://localhost:3000   (admin : /admin)
npm test                 # 13 tests de sécurité et de bon fonctionnement
```

Au **premier démarrage**, un compte administrateur est créé (identifiant `kamissoko` par défaut). Si `ADMIN_PASSWORD` est vide, un mot de passe aléatoire s'affiche **une seule fois** dans la console. Le changement du mot de passe est **obligatoire** à la première connexion.

Perte d'accès ? Sur le serveur : `npm run reset-admin` (nouveau mot de passe temporaire, 2FA coupée).

## Design « runway »
Page d'accueil en carrousel de **looks** (clavier ← →, glisser au doigt, molette horizontale, boutons Préc./Suiv.), colonne des pièces du look, favoris, tiroir panier. Mouvements : apparition au défilement, zoom doux et 2ᵉ photo en fondu au survol, galerie produit en fondu, photo qui « vole » vers le panier, total du panier animé. Tout se désactive avec le réglage système « réduire les animations ».
Les polices du modèle (Syncopate, Cormorant, Jost) ne sont pas chargées depuis Internet (CSP stricte) : des polices système de remplacement sont utilisées. Pour les avoir, hébergez les fichiers `.woff2` dans `public/fonts/` et ajoutez des `@font-face`.

## Côté client (boutique)
- Catalogue filtrable (catégories, recherche, tri), bascule **Prix détail / Prix de gros**.
- Fiche produit : taille, couleur, quantité — le **prix de gros s'applique automatiquement** dès la quantité minimale, avec un message qui incite à compléter ("plus que 3 pièces…").
- Panier mémorisé sur l'appareil → **« Commander sur WhatsApp »** : la commande est enregistrée puis un message prêt à envoyer s'ouvre vers le WhatsApp de la boutique.
- FAQ, bandeau d'annonce, bouton WhatsApp flottant, bandeau cookies/confidentialité (aucun traceur).
- **Photos réelles** : le catalogue de départ contient vos photos (5 jeans, maillot, 2 polos en 5 coloris). Chaque produit peut avoir jusqu'à 8 photos, chacune liée à une couleur : choisir la couleur affiche la bonne photo. Les fichiers sources sont dans `seed-images/`.
- Images sans photo : illustrations vectorielles générées (jeans, t-shirt, chemise, robe, boubou, veste, sweat, short…) ou **vraies photos** ajoutées par le commerçant.

## Côté commerçant (/admin)
Tableau de bord · Looks (carrousel de la page d'accueil) · Produits (ajout/modification/masquage/suppression, photo depuis le téléphone, stock) · Commandes (statuts, bouton « écrire au client » WhatsApp) · Réglages (numéros, slogan, annonce, FAQ) · Sécurité (mot de passe, **double authentification TOTP**, journal d'activité).

## Sécurité (ce qui est réellement en place)
| Menace | Protection |
|---|---|
| Vol de mot de passe en base | **scrypt** (N=2¹⁵) + sel unique ; jamais en clair |
| Devinettes / force brute | Limiteur de débit par IP + **verrouillage du compte** après 5 échecs (15 min, doublant jusqu'à 1 h) ; réponse identique que le compte existe ou non ; temps de calcul constant |
| Mot de passe faible | ≥ 12 caractères, 3 types de caractères, liste de mots interdits ; changement forcé au 1er accès |
| Vol de compte | **2FA TOTP** (Google/Microsoft Authenticator, Authy), codes non rejouables |
| Vol de session | Jeton aléatoire 256 bits (seul son hash est gardé), cookie `HttpOnly` + `SameSite=Strict` + `Secure` (`__Host-` en production), expiration 30 min d'inactivité / 8 h max, rotation au changement de mot de passe |
| CSRF | Jeton CSRF par session + contrôle `Origin` / `Sec-Fetch-Site` + JSON uniquement |
| XSS / injection de script | **CSP stricte** (`script-src 'self'`, aucun inline), rendu uniquement via `textContent`, nettoyage serveur des champs |
| Clickjacking, sniffing | `frame-ancestors 'none'`, `nosniff`, HSTS, Referrer/Permissions-Policy |
| Falsification des prix | Le serveur **recalcule** tout (prix, remises, totaux) ; le client n'envoie que id + quantité |
| Photos piégées | Vérification des octets magiques, ré-encodage JPEG côté navigateur, noms aléatoires, servies en `sandbox` ; SVG refusé |
| Spam de commandes | Limite de débit + champ piège anti-robots |
| Fuite de données | Données hors du dossier public, fichier en `chmod 600`, erreurs sans trace technique |

> Aucun système n'est « inhackable » : ces protections couvrent les attaques courantes. Pour rester sûr : activez la **2FA**, gardez Node et les dépendances à jour (`npm audit`), servez le site en **HTTPS** uniquement.

## Mise en ligne
Application Node classique (Render, Railway, Fly.io, VPS…).
- Variables : voir `env.example` (`NODE_ENV=production`, `TRUST_PROXY=1`, `DATA_DIR`).
- **Montez un disque persistant** sur `DATA_DIR` : produits, commandes et photos y sont stockés (sans disque, ils disparaissent à chaque redéploiement).
- Ne convient pas tel quel à un hébergement serverless sans disque (Vercel…) ; il faudrait remplacer `lib/store.js` par une base de données.
- Une sauvegarde = copier le dossier `DATA_DIR`.

## À personnaliser avant lancement
Les **prix, noms de produits, FAQ et conditions** fournis sont des **exemples** : le commerçant les remplace depuis `/admin`. Vérifier aussi les réponses de la FAQ (paiement, livraison, échanges) pour qu'elles reflètent sa pratique réelle.
