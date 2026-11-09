'use strict';
const now = () => new Date().toISOString();
const P = (id, name, category, garment, colors, sizes, retail, wholesale, min, desc, extra = {}) => ({
  id, name, category, garment, colors, sizes, priceRetail: retail, priceWholesale: wholesale, wholesaleMin: min,
  description: desc, image: null, stock: 'in', featured: false, visible: true, createdAt: now(), updatedAt: now(), ...extra
});
// Prix d'exemple : à ajuster par le commerçant depuis l'espace administrateur.
module.exports = () => ({
  settings: {
    shopName: 'Kamissoko & Frères',
    tagline: 'Vendeur grossiste et détaillant de prêt-à-porter',
    place: 'Commerçant au Grand Marché de Bamako',
    address: 'Chez Oumar Kamissoko, Immeuble Simaga, Grand Marché de Bamako, près du Marché Rose',
    whatsapp: '22376271472',
    phone2: '22366271472',
    phone3: '22376631436',
    announcement: 'Prix de gros dès la quantité minimale indiquée sur chaque article — commandez directement sur WhatsApp.',
    hours: '',
    faq: [
      { q: 'À partir de combien de pièces ai-je le prix de gros ?', a: "Chaque article affiche sa quantité minimale (par exemple « dès 6 pièces »). Dès que vous atteignez ce nombre pour un même modèle, le prix de gros s'applique automatiquement dans votre panier." },
      { q: 'Comment passer commande ?', a: "Ajoutez vos articles au panier, renseignez votre nom et votre téléphone, puis appuyez sur « Commander sur WhatsApp ». Votre commande arrive toute prête dans notre conversation WhatsApp : nous confirmons la disponibilité et le total avec vous." },
      { q: 'Comment se fait le paiement ?', a: "Le paiement se règle directement avec nous après confirmation de votre commande sur WhatsApp (espèces ou autre moyen convenu ensemble). Aucun paiement n'est demandé sur ce site." },
      { q: 'Livrez-vous en dehors de Bamako ?', a: "Contactez-nous sur WhatsApp avec votre ville : nous vous indiquons les possibilités d'expédition et les délais pour votre commande." },
      { q: 'Puis-je échanger une taille ?', a: "Oui, contactez-nous rapidement après réception : les échanges sont étudiés selon la disponibilité des tailles et l'état de l'article." },
      { q: 'Les prix affichés sont-ils définitifs ?', a: "Les prix sont en francs CFA (FCFA). Ils peuvent évoluer selon les arrivages : le total confirmé sur WhatsApp fait foi." },
      { q: 'Que fait ce site de mes données ?', a: "Uniquement ce qui est nécessaire pour traiter votre commande : nom, téléphone, ville et contenu du panier. Aucun traceur publicitaire, aucune revente de données. Voir la rubrique « Cookies & confidentialité »." }
    ]
  },
  products: [
    P('p01', 'Jean slim stretch homme', 'jeans', 'jeans', ['Bleu jean', 'Noir'], ['38', '40', '42', '44', '46'], 8500, 6000, 12, 'Jean coupe slim avec une touche de stretch pour un confort toute la journée. Coutures renforcées.', { featured: true }),
    P('p02', 'Jean droit classique', 'jeans', 'jeans', ['Bleu marine', 'Gris'], ['40', '42', '44', '46', '48'], 9000, 6500, 12, 'Le jean droit intemporel, solide et facile à porter, pour tous les jours.'),
    P('p03', 'Jean déchiré tendance', 'jeans', 'jeans', ['Bleu ciel'], ['38', '40', '42', '44'], 9500, 7000, 10, 'Jean délavé avec déchirures aux genoux, très demandé par les jeunes.', { stock: 'low' }),
    P('p04', 'T-shirt col rond coton', 'tshirts', 'tshirt', ['Blanc', 'Noir', 'Rouge', 'Bleu ciel'], ['S', 'M', 'L', 'XL', 'XXL'], 3000, 1800, 24, 'T-shirt 100 % coton, doux et résistant au lavage. Idéal pour la revente en lot.', { featured: true }),
    P('p05', 'T-shirt imprimé homme', 'tshirts', 'tshirt', ['Gris', 'Jaune', 'Vert'], ['M', 'L', 'XL', 'XXL'], 3500, 2200, 18, 'T-shirt avec motif imprimé tendance, plusieurs coloris disponibles.'),
    P('p06', 'Chemise manches longues', 'chemises', 'shirt', ['Blanc', 'Bleu ciel', 'Beige'], ['M', 'L', 'XL', 'XXL'], 6000, 4200, 12, 'Chemise élégante pour le bureau ou les cérémonies, tissu léger et agréable.', { featured: true }),
    P('p07', 'Chemise carreaux casual', 'chemises', 'shirt', ['Rouge', 'Bleu marine'], ['M', 'L', 'XL'], 5500, 3800, 12, 'Chemise à carreaux décontractée, coupe confortable.'),
    P('p08', 'Pantalon chino homme', 'pantalons', 'pants', ['Beige', 'Kaki', 'Noir'], ['38', '40', '42', '44', '46'], 7500, 5200, 12, 'Pantalon chino coupe droite, ni trop chic ni trop décontracté.'),
    P('p09', 'Pantalon tissu costume', 'pantalons', 'pants', ['Noir', 'Gris'], ['40', '42', '44', '46'], 8000, 5800, 10, 'Pantalon habillé à pli, parfait pour les occasions et le travail.'),
    P('p10', 'Robe d’été femme', 'robes', 'dress', ['Rose', 'Jaune', 'Violet'], ['S', 'M', 'L', 'XL'], 7000, 4800, 10, 'Robe légère et fluide, motifs délicats. Très appréciée en saison chaude.', { featured: true }),
    P('p11', 'Grand boubou brodé', 'robes', 'boubou', ['Bleu marine', 'Bordeaux', 'Blanc'], ['L', 'XL', 'XXL'], 18000, 13500, 6, 'Boubou ample avec broderie dorée au col, pour les fêtes et les grandes occasions.'),
    P('p12', 'Sweat à capuche', 'vestes', 'hoodie', ['Gris', 'Noir', 'Bleu marine'], ['M', 'L', 'XL', 'XXL'], 9000, 6500, 12, 'Sweat épais et chaud avec grande poche kangourou et cordon de serrage.'),
    P('p13', 'Veste légère zippée', 'vestes', 'jacket', ['Kaki', 'Noir'], ['M', 'L', 'XL', 'XXL'], 11000, 8000, 10, 'Veste légère zippée avec poches, parfaite pour la mi-saison.', { stock: 'low' }),
    P('p14', 'Short en coton homme', 'shorts', 'shorts', ['Beige', 'Bleu marine', 'Kaki'], ['M', 'L', 'XL'], 4000, 2800, 18, 'Short confortable à poches latérales, idéal pour la chaleur.'),
    P('p15', 'T-shirt enfant coloré', 'enfants', 'kids', ['Orange', 'Bleu ciel', 'Vert'], ['4 ans', '6 ans', '8 ans', '10 ans', '12 ans'], 2500, 1500, 24, 'T-shirt enfant en coton doux, motif étoile. Parfait pour la rentrée.'),
    P('p16', 'Jean enfant garçon', 'enfants', 'jeans', ['Bleu jean'], ['4 ans', '6 ans', '8 ans', '10 ans', '12 ans'], 5000, 3500, 12, 'Jean souple pour enfant avec taille ajustable.', { stock: 'out' })
  ],
  orders: [],
  users: [],
  audit: []
});
