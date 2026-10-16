// Charge un dossier de photos de tissus dans une boutique, SANS prix (affichés « Prix sur demande » ;
// le propriétaire met les prix ensuite avec le bouton 💰 de son espace).
//
//   node scripts/import-photos.js <dossier> [--shop nogoya] [--category dentelle] [--no-ai]
//
// - Utilise la base configurée dans .env (Supabase si les clés y sont, sinon le mode démo).
// - Chaque photo passe par le même traitement que dans l'application (détourage du sol, lumière, netteté).
// - Noms / rubriques / descriptions, par ordre de priorité :
//     1. un fichier <dossier>/manifest.json :  { "photo1.jpg": { "name": "...", "category": "dentelle", "description": "..." } }
//     2. l'IA (si ANTHROPIC_API_KEY est renseignée et sans --no-ai)
//     3. sinon « Nouveau tissu » + la rubrique donnée par --category (« dentelle » par défaut), à corriger dans « À vérifier ».
// - Relançable sans danger : une photo déjà importée (même contenu) est ignorée.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('../lib/store');
const { enhancePhoto } = require('../lib/ai/enhance');
const { describeFabric, aiEnabled } = require('../lib/ai/describe');
const { CATEGORIES } = require('../lib/util');

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const dir = args.find((a, i) => !a.startsWith('--') && !['--shop', '--category'].includes(args[i - 1]));
const slug = flag('--shop') || process.env.SEED_SLUG || 'nogoya';
const defaultCat = flag('--category') || 'dentelle';
const useAi = aiEnabled && !args.includes('--no-ai');

(async () => {
  if (!dir || !fs.existsSync(dir)) throw new Error('Usage : node scripts/import-photos.js <dossier> [--shop slug] [--category dentelle] [--no-ai]');
  if (!CATEGORIES.includes(defaultCat)) throw new Error(`Rubrique inconnue : ${defaultCat} (${CATEGORIES.join(', ')})`);
  const shop = await store.getShopBySlug(slug);
  if (!shop) throw new Error(`Boutique « ${slug} » introuvable.`);
  let manifest = {};
  const mf = path.join(dir, 'manifest.json');
  if (fs.existsSync(mf)) manifest = JSON.parse(fs.readFileSync(mf, 'utf8'));

  const files = fs.readdirSync(dir).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  console.log(`${files.length} photo(s) -> boutique « ${shop.name} » (${store.name}) · IA ${useAi ? 'activée' : 'non utilisée'}`);
  let done = 0, skipped = 0;
  for (const [i, f] of files.entries()) {
    const buf = fs.readFileSync(path.join(dir, f));
    const cid = 'import-' + crypto.createHash('sha1').update(buf).digest('hex').slice(0, 24);
    if (await store.findProductByClientId(shop.id, cid)) { skipped++; console.log(`· ${f} : déjà importée`); continue; }
    const id = crypto.randomUUID(), base = `${shop.id}/${id}`;
    const m = manifest[f] || {};
    let info = { name: m.name, category: m.category, description: m.description };
    const t = Date.now();
    const [photo, text] = await Promise.allSettled([
      enhancePhoto(buf),
      !info.name && useAi ? describeFabric(buf, shop) : Promise.resolve(null),
    ]);
    if (text.status === 'fulfilled' && text.value) info = { ...info, ...text.value };
    if (text.status === 'rejected') console.warn(`  ! ${f} : texte IA indisponible (${text.reason.message})`);
    const ext = /\.png$/i.test(f) ? 'png' : /\.webp$/i.test(f) ? 'webp' : 'jpg';
    await store.putFile(`${base}/original.${ext}`, buf, `image/${ext === 'jpg' ? 'jpeg' : ext}`);
    const row = {
      id, shop_id: shop.id, client_id: cid, price: 0, // prix sur demande
      name: info.name || 'Nouveau tissu', description: info.description || null,
      category: CATEGORIES.includes(info.category) ? info.category : defaultCat,
      original_path: `${base}/original.${ext}`, ai_status: 'done', reviewed: false,
      created_at: new Date(Date.now() - (files.length - i) * 1000).toISOString(), // garde l'ordre des fichiers
    };
    if (photo.status === 'fulfilled') {
      await store.putFile(`${base}/enhanced.jpg`, photo.value.enhanced, 'image/jpeg');
      await store.putFile(`${base}/thumb.webp`, photo.value.thumb, 'image/webp');
      row.enhanced_path = `${base}/enhanced.jpg`; row.thumb_path = `${base}/thumb.webp`;
    } else { row.ai_status = 'failed'; row.ai_error = 'photo: ' + photo.reason.message; }
    await store.createProduct(row);
    done++;
    console.log(`✓ ${f} -> « ${row.name} » [${row.category}] (${photo.status === 'fulfilled' ? photo.value.mode : 'photo non traitée'}, ${Date.now() - t} ms)`);
  }
  console.log(`\nTerminé : ${done} importée(s), ${skipped} ignorée(s). Les tissus sont dans « À vérifier » côté propriétaire.`);
})().catch((e) => { console.error(e.message); process.exit(1); });
