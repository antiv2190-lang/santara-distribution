# DES — Site institutionnel (Diawara Énergies S.A.S.)

Site vitrine Next.js pour DES, société d'énergie solaire, stockage lithium et
transformateurs électriques en région AES (Afrique de l'Ouest). Ce projet est
indépendant de l'application de gestion Santara Distribution présente à la
racine de ce dépôt.

## Stack

- **Next.js 14** (App Router, TypeScript)
- **Tailwind CSS** — palette énergie sur-mesure (graphite, or solaire, vert volt, cyan arc)
- **Framer Motion** — reveal on scroll, hero cinétique, compteurs animés, micro-interactions
- **Visuels** — direction artistique en SVG/gradient animés (voir note ci-dessous)

## Démarrer en local

```bash
cd des-website
npm install
npm run dev
```

Ouvrir [http://localhost:3000](http://localhost:3000).

## Structure

```
app/                 Layout, page principale, styles globaux
components/          Sections (Hero, Solutions, AesRegion, Method, Contact...)
components/ui/       Primitives d'animation (Reveal, AnimatedCounter, SolutionArt, HeroBackdrop)
lib/data.ts          Contenu (chiffres clés, solutions, pays AES, étapes, partenaires)
```

## Note sur les visuels Higgsfield

La génération d'images/vidéos via Higgsfield nécessite un abonnement payant
("Requires basic plan or higher") — le compte connecté à cette session est en
offre gratuite, donc les rendus photoréalistes (champs solaires, parcs de
batteries, postes de transformation) n'ont pas pu être générés ici.

À la place, la direction artistique s'appuie sur des illustrations SVG
animées (grille solaire, cellules de batterie, transformateur) dessinées à la
main et révélées au scroll avec Framer Motion — cohérent avec la charte de
couleurs, léger, et sans dépendance à des images externes.

**Pour intégrer les vrais rendus Higgsfield une fois le plan mis à niveau :**
remplacer le contenu de `components/ui/SolutionArt.tsx` (et ajouter un
composant `HeroMedia` dans `components/Hero.tsx`) par des balises
`next/image` pointant vers les fichiers générés, placés dans `public/images/`.
