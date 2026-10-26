# Rentabiliser MaliBiz AI — plan à budget zéro

Les prix ci-dessous sont des **hypothèses à tester**, pas des données de marché vérifiées.

## Ce qu'on vend
Pas un logiciel, mais un résultat : « vos demandes clients sont reçues, suivies et relancées, même quand vous ne répondez pas ».
Cibles les plus proches : PME de construction, immobilier, boutiques, cliniques, écoles privées (Bamako).

## Offre en 3 niveaux (à ajuster après 5 vrais entretiens)
| Offre | Contenu | Prix indicatif |
|---|---|---|
| Démarrage | Page de demandes + suivi des prospects, 1 utilisateur | mise en place unique + petit abonnement mensuel |
| Pro | + assistant IA aux couleurs de l'entreprise, relances WhatsApp manuelles | abonnement mensuel moyen |
| Sur mesure | Intégration, formation, données de l'entreprise | devis |

## Encaissement sans frais fixes
- Orange Money / Moov Money / Wave : paiement manuel au début, facture simple (pas de passerelle à installer).
- Pas de carte bancaire à intégrer pour les premiers clients.

## Parcours des 30 premiers jours (zéro dépense)
1. Semaine 1 : 10 entreprises approchées (WhatsApp + visite). Démo = le site public déjà en ligne.
2. Semaine 2 : 3 pilotes gratuits de 14 jours, en échange d'un avis écrit et d'un cas chiffré (demandes reçues, relances faites).
3. Semaine 3 : transformer les pilotes en abonnements payants.
4. Semaine 4 : publier les résultats (avec accord) pour attirer les suivants.

## Prérequis techniques avant de vendre
- [ ] Rôle admin appliqué (db/README.md) pour lire les demandes.
- [ ] Clé IA ajoutée dans Vercel (coût variable : à surveiller, limite de 10 messages/minute déjà en place).
- [ ] Un espace par client : aujourd'hui les prospects sont privés par compte ; un vrai multi-entreprise (une entreprise, plusieurs employés, page de demande à son nom) reste à construire.
- [ ] Conditions d'utilisation et politique de confidentialité (données de prospects = données personnelles).
- [ ] Domaine personnalisé (payant, optionnel plus tard) pour la crédibilité.

## Coûts à prévoir
- Vercel Hobby et Lovable Cloud : gratuit aujourd'hui, mais Vercel Hobby est limité aux usages non commerciaux selon ses conditions ; **à vérifier avant d'encaisser** (passage en offre Pro payante probable).
- IA : facturation à l'usage (Anthropic) ou quota gratuit limité (Gemini).
