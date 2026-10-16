// Crée la boutique « Nogoya Boutique » (ou une autre via SEED_SLUG / SEED_NAME / SEED_PHONE / SEED_PIN).
//   npm run seed
// Le propriétaire se connecte avec le numéro WhatsApp de la boutique et le code ci-dessous (à changer dans ⚙️).
// Les couleurs et le mode de vente se modifient ensuite dans /super-admin > Modifier.
const fs = require('fs');
const path = require('path');
const store = require('../lib/store');
const auth = require('../lib/auth');

(async () => {
  const slug = process.env.SEED_SLUG || 'nogoya';
  const phone = (process.env.SEED_PHONE || '22376232721').replace(/\D/g, '');
  const pin = process.env.SEED_PIN || '1234';
  if (await store.getShopBySlug(slug)) return console.log(`La boutique « ${slug} » existe déjà.`);
  const shop = await store.createShop({
    slug, name: process.env.SEED_NAME || 'Nogoya Boutique', city: 'Bamako', tagline: 'Voiles suisses · Dentelles · Basin · Wax',
    whatsapp: phone, sale_unit: process.env.SEED_UNIT || 'metre', color_primary: '#0b0b0b', color_accent: '#c9a227',
    admin_phone: phone, admin_pin_hash: auth.hashPin(pin),
  });
  // Logo : branding/<slug>/logo-emblème.png s'il existe (généré par `node branding/make-logo.js`)
  const logoFile = path.join(__dirname, '..', 'branding', slug, 'logo-emblème.png');
  if (fs.existsSync(logoFile)) {
    const p = `${shop.id}/logo-${Date.now()}.png`;
    await store.putFile(p, fs.readFileSync(logoFile), 'image/png');
    await store.updateShop(shop.id, { logo_path: p });
    console.log('Logo ajouté.');
  }
  console.log(`Boutique « ${slug} » créée.\n  Vitrine : /${slug}\n  Propriétaire : /${slug}/admin  (téléphone +${phone}, code ${pin})`);
  // Pas de process.exit : on laisse l'écriture différée du mode démo se terminer.
})().catch((e) => { console.error(e.message); process.exit(1); });
