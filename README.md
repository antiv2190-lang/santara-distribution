# Santara Distribution — Guide de mise en ligne

Ce dossier contient la version **serveur** de l'application : les données sont stockées dans une vraie base de données partagée, accessible depuis le PC et tous les téléphones en même temps, avec une adresse web unique (ex. `https://santara.onrender.com`).

Deux services **gratuits** suffisent : **MongoDB Atlas** (la base de données) et **Render** (l'hébergement du serveur). Comptez environ 20 minutes la première fois. Aucune carte bancaire n'est requise pour les deux.

---

## Étape 1 — Créer la base de données (MongoDB Atlas, gratuit)

1. Allez sur **cloud.mongodb.com** et créez un compte gratuit.
2. Créez un cluster : choisissez l'offre **M0 (Free)** — 512 Mo, largement suffisant, gratuit à vie.
3. Choisissez la région la plus proche (Europe si possible) et cliquez sur **Create**.
4. Dans **Security → Database Access** : créez un utilisateur (nom + mot de passe). Notez-les précieusement.
5. Dans **Security → Network Access** : cliquez sur **Allow access from anywhere** (0.0.0.0/0) — nécessaire car Render se connecte depuis une adresse variable.
6. Cliquez sur **Connect → Drivers**, copiez la **chaîne de connexion** ; elle ressemble à :
   ```
   mongodb+srv://votre_utilisateur:votre_motdepasse@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```
   Ajoutez `santara` comme nom de base juste après `.net/`, par exemple :
   ```
   mongodb+srv://votre_utilisateur:votre_motdepasse@cluster0.xxxxx.mongodb.net/santara?retryWrites=true&w=majority
   ```
   Gardez cette chaîne de côté, elle sert à l'étape 3.

## Étape 2 — Mettre le code sur GitHub

1. Créez un compte gratuit sur **github.com** si besoin.
2. Créez un nouveau dépôt (par exemple `santara-distribution`).
3. Envoyez-y tout le contenu de ce dossier (`server.js`, `package.json`, `public/`, etc.) — via l'interface web de GitHub (glisser-déposer les fichiers) ou avec `git` si vous êtes à l'aise avec.

## Étape 3 — Héberger le serveur (Render, gratuit)

1. Allez sur **render.com**, créez un compte (vous pouvez vous connecter avec GitHub).
2. Cliquez sur **New +** → **Web Service**, puis connectez le dépôt GitHub créé à l'étape 2.
3. Configurez :
   - **Environment** : Node
   - **Build command** : `npm install`
   - **Start command** : `npm start`
   - **Instance type** : Free
4. Dans l'onglet **Environment**, ajoutez ces variables :
   | Clé | Valeur |
   |---|---|
   | `MONGODB_URI` | la chaîne de connexion copiée à l'étape 1 |
   | `ANTHROPIC_API_KEY` | votre clé API Anthropic (voir étape 4 — facultatif si vous n'utilisez pas l'onglet Assistant IA tout de suite) |
5. Cliquez sur **Create Web Service**. Render installe et démarre l'application (2 à 3 minutes).
6. Une fois prêt, Render vous donne une adresse du type `https://santara-distribution.onrender.com` — c'est l'adresse à utiliser sur tous les appareils (PC, téléphone du DG, téléphone du comptable). Ajoutez-la à l'écran d'accueil du téléphone pour un accès en un clic.

**À savoir sur le plan gratuit de Render :** l'application se met en pause après 15 minutes sans visite, et met 30 à 60 secondes à redémarrer au premier accès suivant (le temps qu'une page se charge). Le reste du temps, une fois réveillée, elle fonctionne normalement. Si ce délai gêne l'équipe, un plan payant à partir de quelques dollars par mois supprime cette mise en veille.

## Étape 4 — Activer l'Assistant IA (facultatif)

L'onglet « Assistant IA » de l'application appelle Claude (Anthropic) pour répondre à des questions sur vos données (stock, ventes, impayés…).

1. Créez un compte sur **console.anthropic.com**.
2. Générez une clé API (Settings → API Keys).
3. Ajoutez-la dans Render sous la variable `ANTHROPIC_API_KEY` (voir étape 3.4), puis redéployez (Render le fait automatiquement après l'ajout d'une variable).
4. Cette clé est facturée à l'usage par Anthropic (quelques centimes par question typiquement) — surveillez votre consommation sur console.anthropic.com. Sans clé configurée, le reste de l'application fonctionne normalement ; seul l'onglet Assistant IA affichera un message d'erreur.

## Tester en local avant de déployer (facultatif, pour les plus techniques)

```bash
npm install
cp .env.example .env
# remplissez .env avec votre MONGODB_URI et éventuellement ANTHROPIC_API_KEY
npm start
```
Puis ouvrez `http://localhost:3000`.

## Après la mise en ligne

- Connectez-vous en Admin (`admin` / `admin123`) et **changez immédiatement les mots de passe** dans l'onglet Utilisateurs — l'application est maintenant accessible publiquement par son adresse web.
- Toutes les données (stock, ventes, clients…) sont désormais communes à tous les appareils connectés à cette adresse : plus besoin d'exporter/importer de sauvegarde entre le PC et les téléphones.
- Le bouton de sauvegarde (.json) reste disponible dans l'onglet Utilisateurs, à utiliser régulièrement par sécurité.

## Sécurité — à lire avant un usage réel

Cette application utilise une connexion simple par identifiant/mot de passe stockée en clair dans la base, adaptée à un usage interne restreint (quelques employés de confiance). Ce n'est pas une sécurité de niveau bancaire. Pour un usage plus exigeant, il faudrait ajouter : mots de passe chiffrés, connexion HTTPS forcée (Render l'active déjà par défaut), et une restriction d'accès par adresse IP ou VPN si nécessaire.
