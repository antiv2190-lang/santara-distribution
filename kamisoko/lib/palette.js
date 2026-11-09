'use strict';
// Palette fermée : le catalogue n'accepte que ces couleurs (aucune valeur libre => pas d'injection).
const PALETTE = {
  'Noir': '#1d1d21', 'Blanc': '#f5f3ee', 'Bleu jean': '#3f6a9e', 'Bleu marine': '#1f2f55',
  'Bleu ciel': '#7fb2de', 'Gris': '#8b8f97', 'Beige': '#d6bf9a', 'Rouge': '#c0392b',
  'Bordeaux': '#7a2336', 'Vert': '#2f8a5b', 'Kaki': '#7a7a4a', 'Marron': '#7b5233',
  'Jaune': '#e3b23c', 'Orange': '#e0762c', 'Rose': '#e58fae', 'Violet': '#6d4a9a'
};
const CATEGORIES = {
  jeans: 'Jeans', polos: 'Polos', maillots: 'Maillots', ensembles: 'Ensembles', tshirts: 'T-shirts', chemises: 'Chemises', pantalons: 'Pantalons',
  robes: 'Robes & boubous', vestes: 'Vestes & sweats', shorts: 'Shorts', enfants: 'Enfants'
};
const GARMENTS = {
  tshirt: 'T-shirt', jeans: 'Jean', shirt: 'Chemise', pants: 'Pantalon', dress: 'Robe',
  boubou: 'Boubou', jacket: 'Veste', hoodie: 'Sweat à capuche', shorts: 'Short', kids: 'T-shirt enfant'
};
module.exports = { PALETTE, CATEGORIES, GARMENTS };
