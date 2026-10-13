# Boutique Tissus — vitrine + espace propriétaire (PWA), multi-boutiques

Application web **mobile-first, en français**, pour boutiques de tissus haut de gamme (basin, broderies, wax, bazin).
Un seul code, **autant de boutiques que vous voulez** : chaque boutique a son nom, logo, couleurs, numéro WhatsApp,
ville, ses produits et sa propre connexion propriétaire.

| Qui | Adresse | À quoi ça sert |
|---|---|---|
| Clients | `/<boutique>` | Vitrine : grille, filtres, recherche, fiche produit, « Commander sur WhatsApp », partage |
| Propriétaire | `/<boutique>/admin` (ou `/admin`) | Photo → prix → Publier (mode rafale), « À vérifier », épuisé / prix / supprimer |
| Vous (super-admin) | `/super-admin` | Créer et gérer les boutiques en quelques clics |

> Ce dossier vit dans le dépôt à côté de l'ancienne application « Santara » (gestion de stock) sans la modifier.

---

## Essayer tout de suite (sans compte, 1 minute)

```bash
cd boutique-tissus
npm install
npm run seed      # crée « Nogoya Boutique » (tél. +223 76 23 27 21, code 1234)
npm start         # http://localhost:3000/nogoya   et   http://localhost:3000/nogoya/admin
```
Sans Supabase, l'application tourne en **mode démo** (données dans `.data/`). Sans clé IA, les produits reçoivent le nom
« Nouveau tissu » (à corriger dans « À vérifier ») ; la photo est quand même améliorée.
Pour la caméra : `localhost` fonctionne ; sur un vrai téléphone il faut **HTTPS** (fourni par Render, voir plus bas).

`npm test` lance 56 vérifications de bout en bout (création de boutique, connexion, publication, IA simulée, règle des couleurs,
isolation entre boutiques, sécurité).

---

## Mise en ligne (≈ 20 minutes)

### 1. Supabase (base de données + photos)
1. Créez un projet sur **supabase.com**.
2. **SQL Editor → New query** : collez le contenu de `supabase/schema.sql` → **Run**. Cela crée les tables, la sécurité et le bucket de photos `tissus`.
3. **Project Settings → API** : copiez l'**URL** du projet et la clé **`service_role`** (secrète : uniquement sur le serveur, jamais dans le navigateur).

### 2. Hébergement (Render, Railway, Fly… n'importe quel hébergeur Node ≥ 18)
Exemple Render : *New → Web Service* → ce dépôt → **Root Directory : `boutique-tissus`** → Build `npm install` → Start `npm start`.
Variables d'environnement (voir `.env.example`) :

| Variable | Rôle |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | Connexion Supabase (obligatoires) |
| `SESSION_SECRET` | Longue phrase au hasard (signe les connexions) — obligatoire |
| `SUPERADMIN_CODE` | Votre code d'accès à `/super-admin` — gardez-le pour vous |
| `ANTHROPIC_API_KEY` | Active l'IA (nom, catégorie, description). `AI_MODEL` pour changer de modèle (défaut `claude-opus-5-5`) |
| `DEFAULT_SHOP` | Facultatif : « slug » de la boutique servie sur `/` et `/admin` |
| `PUBLIC_URL` | Facultatif : adresse publique (liens partagés) |
| `NODE_ENV=production` | Refuse de démarrer sans Supabase / secret |
| `OTP_PROVIDER` | Comment le code de connexion arrive sur le téléphone : `twilio-whatsapp`, `twilio-sms` ou `webhook` (voir plus bas). Sans lui, le propriétaire utilise son code secret |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | Si Twilio |
| `OTP_WEBHOOK_URL`, `OTP_WEBHOOK_TOKEN` | Si `webhook` : n'importe quelle passerelle SMS/WhatsApp (Orange, WhatsApp Cloud API, n8n, Zapier…) |

### 3. Créer la boutique
Ouvrez `https://votre-site/super-admin` → **➕ Nouvelle boutique** : nom, ville, WhatsApp, mode de vente
(au mètre / à la pièce / au lot), couleurs (palettes prêtes : or & noir, vert & or…), logo, téléphone + code du propriétaire.
À la fin, un bouton **envoie par WhatsApp** au propriétaire son lien et son code.

**Pour cette boutique** : nom `Nogoya Boutique`, WhatsApp `+223 76 23 27 21`, ville Bamako. Restent à choisir dans le formulaire : le mode de vente (mètre / pièce / lot, « mètre » par défaut) et les couleurs (or et noir par défaut).

### 4. Installer sur le téléphone du propriétaire
Il ouvre `https://votre-site/<boutique>/admin` dans Chrome → **⋮ → Ajouter à l'écran d'accueil** (ou le bouton « 📲 Installer » dans l'appli).
Il tape son numéro, **reçoit un code à 6 chiffres sur son téléphone**, le tape sur le clavier géant : c'est fini. Il reste connecté 60 jours.
Le code secret (défini à la création de la boutique) reste possible en repli (« J'ai un code secret »).

### Connexion par code reçu sur le téléphone
- Le code (6 chiffres, valable 5 min, 5 essais, 1 envoi / 30 s, 5 envois / heure) n'est jamais stocké en clair.
- Un numéro inconnu reçoit la même réponse (impossible de savoir quels numéros sont inscrits).
- **Choisissez le canal** : au Mali, **WhatsApp** (`twilio-whatsapp` ou une passerelle en `webhook`) est généralement plus fiable et moins cher que le SMS international.
  Avec `webhook`, le serveur envoie `POST {to, message, code, shop}` à votre passerelle.
- En démo (`OTP_PROVIDER=console`, hors production) le code s'affiche à l'écran pour pouvoir essayer. **En production, l'envoi réel n'a pas été testé** (pas de compte Twilio ici).

---

## Le geste du propriétaire (< 15 secondes)

1. **📷 Ajouter un tissu** → la caméra s'ouvre. Un gros bouton rond prend la photo.
2. **Prix** au clavier géant (touches `000` et `⌫`), en FCFA.
3. **✅ Publier** → la caméra est déjà prête pour le tissu suivant (**mode rafale**). « ✕ Fermer » pour revenir.

Ce qui rend ça rapide, même avec une mauvaise connexion :
- la photo est réduite sur le téléphone (1800 px, JPEG) puis **envoyée en arrière-plan** ; on n'attend jamais ;
- les envois sont gardés sur le téléphone (IndexedDB) et **repartent tout seuls** au retour du réseau ; un identifiant unique évite les doublons ;
- l'IA travaille côté serveur ; les produits arrivent dans **✅ À vérifier** : *Valider* en un clic, *Corriger* (nom, prix, catégorie, description), *Tout valider* ;
- **Mes tissus** : *Épuisé / Disponible*, *Prix* (clavier géant), *Supprimer* (avec confirmation) ; toucher la photo montre l'amélioration **et l'original**.
Si la caméra intégrée est refusée, l'application bascule sur l'appareil photo du téléphone.

## Traitement IA de chaque photo

**Option « IA automatique »** : le propriétaire l'active ou la coupe lui-même dans ⚙️ (le super-admin peut aussi la régler à la création).
Activée : chaque photo est traitée en arrière-plan. Désactivée : le tissu est publié tel quel (photo d'origine, nom « Nouveau tissu »),
sans aucun appel IA, et chaque carte propose **✨ Embellir avec l'IA** pour traiter un tissu à la demande.

- **Texte** (`lib/ai/describe.js`) : Claude (vision) renvoie, en JSON garanti, un nom attractif, une catégorie
  (basin / broderie / wax / bazin / autre) et 2–3 phrases marketing (texture, motif, occasions : mariage, baptême, Tabaski…).
  Il ne doit rien inventer (composition, marque, dimensions).
- **Photo** (`lib/ai/enhance.js`, `lib/ai/cutout.js`) — **règle absolue : jamais de changement des couleurs, motifs ou broderies.**
  Pour cela, aucune IA *générative* d'image n'est utilisée (elle pourrait inventer des motifs). Le serveur applique seulement :
  correction de **lumière** (étirement de la luminance), **netteté** douce, puis place le tissu centré sur un fond clair élégant avec ombre douce.
  Un **garde-fou** mesure l'écart de couleur (plan a\*b\* de Lab, indépendant de la luminosité) ; au-delà de 4 il renonce à la correction de lumière.
  Les tests vérifient que la teinte reste identique alors que la luminosité passe de 57 à 131.
  Le **détourage du sol** (moquette, table) est fait en local, sans service externe : le sol est estimé d'après les bords de la photo,
  retiré, remplacé par le fond élégant ; si le résultat n'est pas fiable (tissu empilé avec d'autres, fond chargé), la photo reste entière, simplement cadrée.
  Option `IMAGE_PROVIDER=removebg` : détourage du fond via remove.bg (les pixels du tissu restent identiques) puis même mise en scène.
- **La photo originale est toujours conservée** octet pour octet et reste accessible (propriétaire, et « Photo d'origine » dans la galerie de la fiche produit — utile pour les couleurs réelles).
- En cas de panne de l'IA : 3 essais espacés, puis le produit reste publiable (nom « Nouveau tissu », bouton **🔄 Relancer l'IA**).
  Le traitement reprend automatiquement après un redémarrage du serveur.

> Coût : un appel Claude avec une image réduite à 1024 px par tissu. Pour réduire, mettez `AI_MODEL=claude-haiku-5-5` (ou `claude-sonnet-5-5`).

## Vitrine client
Logo + nom, grille (photo améliorée, nom, prix « / mètre »), filtres par catégorie, recherche par nom, fiche produit
(galerie, description, disponibilité), **Commander sur WhatsApp** avec le message
`Bonjour, je souhaite commander : [nom] à [prix] FCFA. Lien : [lien du produit]`,
bouton WhatsApp flottant partout, **Partager** (WhatsApp, Facebook, copier, applications du téléphone).
Chaque fiche a ses balises de partage (aperçu image + titre dans WhatsApp/Facebook).

## Réutiliser pour une autre boutique
Aucun code à modifier : **/super-admin → Nouvelle boutique**. Les couleurs, le logo, le mode de vente et le numéro sont des données.
Pour une installation séparée (autre Supabase), dupliquez le dépôt et changez uniquement les variables d'environnement.

## Sécurité
- Connexion propriétaire : téléphone + code (4–8 chiffres) haché (scrypt), session signée en cookie `HttpOnly`, blocage 15 min après 5 échecs.
- La clé `service_role` reste sur le serveur ; la base a la RLS activée **sans politique publique** : tout passe par le serveur.
- Chaque requête admin est limitée à la boutique de la session (testé).
- Rendu côté navigateur sans `innerHTML` (pas de XSS) ; requêtes modifiantes refusées si elles viennent d'un autre site.
- À faire avant un usage large : choisir des codes non devinables (le formulaire en propose un au hasard), `SUPERADMIN_CODE` long.

## Phases 2 et 3 (préparées, **désactivées**)
- Base : `orders` (paiement Orange Money / Moov Money), `social_accounts` et `social_posts` (Facebook / TikTok), `products.social`,
  et interrupteurs `shops.features` (`orange_money`, `moov_money`, `facebook_autopost`, `tiktok_autopost`) tous à `false`.
- Code : `lib/integrations/index.js` expose `payments` et `social` ; tout lance « non activé » et le pipeline appelle déjà
  `social.onProductReady` (sans effet tant que désactivé). Variables réservées dans `.env.example`.

## Structure
```
server.js              serveur Express (pages, API, sécurité)
lib/config.js          variables d'environnement
lib/auth.js            codes hachés, sessions signées
lib/store/             supabase.js (production) · memory.js (démo) · même interface
lib/ai/                describe.js (texte) · enhance.js (photo) · color.js (garde-fou) · pipeline.js (arrière-plan)
lib/routes/            public.js · admin.js · super.js
lib/integrations/      phases 2 et 3 (désactivées)
public/vitrine|admin|super   interfaces (JS sans framework, léger)
public/sw.js           service worker (installation + cache)
supabase/schema.sql    base de données
test/smoke.test.js     tests de bout en bout
```

## Limites connues
- **Détourage local imparfait** : testé sur 6 photos réelles (voile suisse sur moquette brune) : 4 propres, 2 avec un défaut visible (un reste de moquette, ou un tissu voisin resté collé).
  Il est volontairement prudent : il ne coupe jamais dans un tissu sombre ou brun. Pour un rendu parfait à chaque fois, activer `IMAGE_PROVIDER=removebg` (ou brancher un service de détourage pro). La photo d'origine reste toujours disponible.
- Les noms/descriptions de la démo « Nogoya Boutique » (`scripts/seed-photos.js`) sont des **textes d'exemple écrits à la main** et les prix sont fictifs ; en production c'est l'IA qui les rédige.
- L'appel à l'API Claude est vérifié contre une API **simulée** (le format de requête/réponse est testé, pas la réponse réelle du modèle) : faites un premier essai avec votre clé.
- Le détourage `removebg` n'a pas été testé (pas de clé).
- Le plan gratuit de Render se met en veille (30–60 s au réveil) ; le traitement IA en cours reprend ensuite.
- Un seul compte propriétaire par boutique pour l'instant.
