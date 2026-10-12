// Crée une boutique de démonstration (utile pour essayer l'application tout de suite).
//   npm run seed          -> boutique « demo », propriétaire : 70 00 00 00 / code 1234
const store = require('../lib/store');
const auth = require('../lib/auth');

(async () => {
  const slug = process.env.SEED_SLUG || 'demo';
  if (await store.getShopBySlug(slug)) return console.log(`La boutique « ${slug} » existe déjà.`);
  await store.createShop({
    slug, name: process.env.SEED_NAME || 'Boutique Démo', city: 'Bamako', tagline: 'Basin · Broderies · Wax · Bazin',
    whatsapp: '22370000000', sale_unit: 'metre', color_primary: '#0b0b0b', color_accent: '#c9a227',
    admin_phone: '22370000000', admin_pin_hash: auth.hashPin('1234'),
  });
  console.log(`Boutique « ${slug} » créée.\n  Vitrine : /${slug}\n  Propriétaire : /${slug}/admin  (téléphone 70 00 00 00, code 1234)`);
  // Pas de process.exit : on laisse l'écriture différée du mode démo se terminer.
})().catch((e) => { console.error(e.message); process.exit(1); });
