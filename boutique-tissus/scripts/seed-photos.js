// Charge des photos de tissus dans une boutique en passant par le VRAI traitement de photo (détourage, lumière,
// netteté). Sert à la démonstration : les noms/descriptions ci-dessous sont des TEXTES D'EXEMPLE écrits à la main
// (en production, c'est l'IA qui les rédige à partir de chaque photo) et les prix sont fictifs.
//
//   SEED_PHOTOS_DIR=/chemin/vers/photos SEED_SLUG=nogoya node scripts/seed-photos.js     (photos 1.jpg ... 6.jpg)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('../lib/store');
const { enhancePhoto } = require('../lib/ai/enhance');

const DEMO = [
  { name: 'Voile suisse brodé vert émeraude et fleurs fuchsia', price: 45000, reviewed: true,
    description: "Un voile suisse d'un vert profond relevé de grandes fleurs fuchsia brodées, ponctuées de petites pierres brillantes. Ajours délicats et bordure en festons soignée. Parfait pour un mariage, un baptême ou la Tabaski." },
  { name: 'Voile suisse bleu royal, volutes bleu ciel et or', price: 48000, reviewed: true,
    description: "Un bleu royal intense sur lequel s'enroulent de grandes volutes bleu ciel soulignées de fil doré. Strass discrets et bordure festonnée. Une pièce d'allure royale pour vos cérémonies." },
  { name: 'Voile suisse turquoise, fleurs rose poudré et feuilles dorées', price: 42000, reviewed: true,
    description: "Un voile turquoise lumineux, brodé de fleurs rose poudré, de feuillages vert sapin et de motifs dorés rehaussés de strass. Léger, aéré et très élégant pour les grandes occasions." },
  { name: 'Voile suisse bleu lagon, broderies roses et dorées', price: 42000, reviewed: true,
    description: "Un bleu lagon doux avec des fleurs roses et des feuilles vert foncé, relevées de motifs dorés et de pierres colorées. Une teinte fraîche et gaie pour un baptême ou une fête de famille." },
  { name: 'Voile suisse noir, motifs orange, turquoise et or', price: 46000, reviewed: false,
    description: "Un fond noir profond sur lequel ressortent des motifs orange et turquoise cerclés d'or, entourés de petites fleurs brodées. Un voile audacieux et raffiné, pour se démarquer lors des cérémonies." },
  { name: 'Voile suisse crème et chocolat, motifs cercles et fleurs', price: 44000, reviewed: false,
    description: "Une dentelle crème à ajours, ornée de cercles et de fleurs brodés en chocolat et en or, avec une belle bordure festonnée. Sobre, lumineuse et élégante pour mariage et baptême." },
];

(async () => {
  const dir = process.env.SEED_PHOTOS_DIR;
  const slug = process.env.SEED_SLUG || 'nogoya';
  if (!dir) throw new Error('SEED_PHOTOS_DIR manquant');
  const shop = await store.getShopBySlug(slug);
  if (!shop) throw new Error(`Boutique « ${slug} » introuvable (lancez d'abord npm run seed)`);
  for (let i = 0; i < DEMO.length; i++) {
    const file = path.join(dir, `${i + 1}.jpg`);
    if (!fs.existsSync(file)) continue;
    const d = DEMO[i], id = crypto.randomUUID(), base = `${shop.id}/${id}`;
    const original = fs.readFileSync(file);
    const t = Date.now();
    const out = await enhancePhoto(original);
    await store.putFile(`${base}/original.jpg`, original, 'image/jpeg');
    await store.putFile(`${base}/enhanced.jpg`, out.enhanced, 'image/jpeg');
    await store.putFile(`${base}/thumb.webp`, out.thumb, 'image/webp');
    await store.createProduct({
      id, shop_id: shop.id, name: d.name, description: d.description, category: 'dentelle', price: d.price,
      original_path: `${base}/original.jpg`, enhanced_path: `${base}/enhanced.jpg`, thumb_path: `${base}/thumb.webp`,
      ai_status: 'done', reviewed: d.reviewed, created_at: new Date(Date.now() - (DEMO.length - i) * 3600e3).toISOString(),
    });
    console.log(`✓ ${d.name}  (${out.mode}, ${Date.now() - t} ms)`);
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
