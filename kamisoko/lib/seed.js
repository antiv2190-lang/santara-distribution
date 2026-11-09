'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const SEED_DIR = path.join(__dirname, '..', 'seed-images');
const now = () => new Date().toISOString();
// Les photos du catalogue de départ sont copiées dans le dossier d'envois avec un nom aléatoire-stable (hash du contenu).
const imgName = slug => crypto.createHash('sha1').update(fs.readFileSync(path.join(SEED_DIR, slug + '.jpg'))).digest('hex').slice(0, 24) + '.jpg';
const installImages = uploadsDir => { for (const f of fs.readdirSync(SEED_DIR)) if (f.endsWith('.jpg')) fs.copyFileSync(path.join(SEED_DIR, f), path.join(uploadsDir, imgName(f.slice(0, -4)))); };
const G = (slug, color = null) => ({ file: imgName(slug), color });
const P = (id, name, category, garment, colors, sizes, retail, wholesale, min, desc, extra = {}) => {
  const gallery = extra.gallery || [];
  return { id, name, category, garment, colors, sizes, priceRetail: retail, priceWholesale: wholesale, wholesaleMin: min, description: desc,
    image: gallery[0] ? gallery[0].file : null, gallery, stock: 'in', featured: false, visible: true, createdAt: now(), updatedAt: now(), ...extra };
};
const L = (id, name, products, description, collection = 'COLLECTION 2026') => ({ id, name, collection, description, products, image: null });
const J = '30,31,32,33,34,35,36'.split(',');
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
      { q: 'À partir de combien de pièces ai-je le prix de gros ?', a: "Chaque article affiche sa quantité minimale (par exemple « dès 12 pièces »). Dès que vous atteignez ce nombre pour un même modèle, le prix de gros s'applique automatiquement dans votre panier." },
      { q: 'Comment passer commande ?', a: "Ajoutez vos articles au panier, renseignez votre nom et votre téléphone, puis appuyez sur « Commander sur WhatsApp ». Votre commande arrive toute prête dans notre conversation WhatsApp : nous confirmons la disponibilité et le total avec vous." },
      { q: 'Comment se fait le paiement ?', a: "Le paiement se règle directement avec nous après confirmation de votre commande sur WhatsApp (espèces ou autre moyen convenu ensemble). Aucun paiement n'est demandé sur ce site." },
      { q: 'Livrez-vous en dehors de Bamako ?', a: "Contactez-nous sur WhatsApp avec votre ville : nous vous indiquons les possibilités d'expédition et les délais pour votre commande." },
      { q: 'Puis-je échanger une taille ?', a: "Oui, contactez-nous rapidement après réception : les échanges sont étudiés selon la disponibilité des tailles et l'état de l'article." },
      { q: 'Les prix affichés sont-ils définitifs ?', a: "Les prix sont en francs CFA (FCFA). Ils peuvent évoluer selon les arrivages : le total confirmé sur WhatsApp fait foi." },
      { q: 'Que fait ce site de mes données ?', a: "Uniquement ce qui est nécessaire pour traiter votre commande : nom, téléphone, ville et contenu du panier. Aucun traceur publicitaire, aucune revente de données. Voir la rubrique « Cookies & confidentialité »." }
    ]
  },
  products: [
    P('p01', 'Polo flamants brodés', 'polos', 'tshirt', ['Blanc', 'Orange', 'Bleu jean', 'Beige', 'Marron'], ['M', 'L', 'XL', 'XXL'], 4500, 3000, 12,
      'Polo en maille piquée, col contrasté et petits flamants brodés. 5 coloris : blanc, orange, bleu, beige, marron.',
      { featured: true, gallery: [G('polo-flamant-blanc', 'Blanc'), G('polo-flamant-orange', 'Orange'), G('polo-flamant-bleu', 'Bleu jean'), G('polo-flamant-beige', 'Beige'), G('polo-flamant-marron', 'Marron')] }),
    P('p02', 'Polo bloc marin à l’ancre', 'polos', 'tshirt', ['Beige', 'Blanc', 'Noir', 'Bleu jean', 'Bordeaux'], ['M', 'L', 'XL', 'XXL'], 5000, 3400, 12,
      'Polo colorblock avec bande contrastée et ancre marine brodée. Col et poignets bicolores, très stylé.',
      { featured: true, gallery: [G('polo-ancre-beige', 'Beige'), G('polo-ancre-blanc', 'Blanc'), G('polo-ancre-noir', 'Noir'), G('polo-ancre-bleu', 'Bleu jean'), G('polo-ancre-rouge', 'Bordeaux')] }),
    P('p03', 'Maillot Real Madrid domicile (version joueur)', 'maillots', 'tshirt', ['Blanc'], ['S', 'M', 'L', 'XL'], 8000, 5500, 10,
      'Maillot blanc à col vert foncé et bandes roses, tissu respirant en micro-alvéoles. Version joueur.',
      { featured: true, gallery: [G('maillot-real-madrid', 'Blanc')] }),
    P('p04', 'Jean stretch vert-noir réf. 35009', 'jeans', 'jeans', ['Noir'], J, 9500, 7000, 12, 'Jean stretch délavé vert-noir, doublure douce, coupe ajustée. Tailles 30 à 36.', { featured: true, gallery: [G('jean-35009')] }),
    P('p05', 'Jean stretch moutarde réf. 6306', 'jeans', 'jeans', ['Jaune'], J, 9500, 7000, 12, 'Jean stretch coloris moutarde, très tendance, coutures contrastées. Tailles 30 à 36.', { gallery: [G('jean-6306')] }),
    P('p06', 'Jean stretch noir réf. D6961', 'jeans', 'jeans', ['Noir'], J, 9500, 7000, 12, 'Le noir intégral, indémodable : jean stretch confortable. Tailles 30 à 36.', { gallery: [G('jean-d6961')] }),
    P('p07', 'Jean stretch kaki réf. B2913', 'jeans', 'jeans', ['Kaki'], J, 9500, 7000, 12, 'Jean coloris kaki olive, étiquette cuir, finitions soignées. Tailles 30 à 36.', { stock: 'low', gallery: [G('jean-b2913')] }),
    P('p08', 'Jean stretch bleu marine réf. 6307', 'jeans', 'jeans', ['Bleu marine'], J, 9500, 7000, 12, 'Jean bleu marine profond, stretch et doux. Un classique de toute garde-robe. Tailles 30 à 36.', { gallery: [G('jean-6307')] }),
    P('p09', 'Ensemble jogging sweat + pantalon', 'ensembles', 'hoodie', ['Beige', 'Gris', 'Noir'], ['S', 'M', 'L', 'XL', 'XXL'], 14000, 10500, 6, 'Ensemble molletonné sweat à capuche et jogging assortis, ton sur ton. Pour homme et femme.', { featured: true }),
    P('p10', 'T-shirt col rond coton', 'tshirts', 'tshirt', ['Blanc', 'Noir', 'Rouge', 'Bleu ciel'], ['S', 'M', 'L', 'XL', 'XXL'], 3000, 1800, 24, 'T-shirt 100 % coton, doux et résistant au lavage. Idéal pour la revente en lot.'),
    P('p11', 'Chemise manches longues', 'chemises', 'shirt', ['Blanc', 'Bleu ciel', 'Beige'], ['M', 'L', 'XL', 'XXL'], 6000, 4200, 12, 'Chemise élégante pour le bureau ou les cérémonies, tissu léger et agréable.'),
    P('p12', 'Robe d’été femme', 'robes', 'dress', ['Rose', 'Jaune', 'Violet'], ['S', 'M', 'L', 'XL'], 7000, 4800, 10, 'Robe légère et fluide, motifs délicats. Très appréciée en saison chaude.'),
    P('p13', 'Grand boubou brodé', 'robes', 'boubou', ['Bleu marine', 'Bordeaux', 'Blanc'], ['L', 'XL', 'XXL'], 18000, 13500, 6, 'Boubou ample avec broderie dorée au col, pour les fêtes et les grandes occasions.'),
    P('p14', 'T-shirt enfant coloré', 'enfants', 'kids', ['Orange', 'Bleu ciel', 'Vert'], ['4 ans', '6 ans', '8 ans', '10 ans', '12 ans'], 2500, 1500, 24, 'T-shirt enfant en coton doux, motif étoile. Parfait pour la rentrée.')
  ],
  looks: [
    L('l1', 'Polos flamants', ['p01'], 'Cinq coloris pour un même polo brodé : le best-seller de la saison.'),
    L('l2', 'Bloc marin', ['p02'], 'Colorblock et ancre brodée : le polo qui se remarque.'),
    L('l3', 'Maillot de légende', ['p03'], 'Le maillot blanc version joueur, très demandé des supporters.'),
    L('l4', 'Denim sombre', ['p04', 'p06'], 'Noir et vert-noir : des jeans stretch faciles à porter toute l’année.'),
    L('l5', 'Terre & kaki', ['p05', 'p07'], 'Moutarde et kaki, les coloris tendance du moment.'),
    L('l6', 'Bleu profond', ['p08'], 'Le jean bleu marine, valeur sûre pour tous les clients.'),
    L('l7', 'Confort ton sur ton', ['p09'], 'Sweat et jogging assortis, doux et chauds.'),
    L('l8', 'Grande cérémonie', ['p13'], 'Le grand boubou brodé, incontournable des fêtes.'),
    L('l9', 'Été léger', ['p12'], 'Une robe fluide et colorée pour les jours de chaleur.')
  ],
  orders: [],
  users: [],
  audit: []
});
module.exports.installImages = installImages;
