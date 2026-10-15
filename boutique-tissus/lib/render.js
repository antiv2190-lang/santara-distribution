// Pages HTML (coquille unique + balises de partage), manifestes PWA et icônes.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const config = require('./config');
const store = require('./store');
const { onColor, escapeHtml: h, safeJson } = require('./util');
const { publicShop, publicProduct } = require('./views');
const otp = require('./otp');

const read = (f) => fs.readFileSync(path.join(config.publicDir, f), 'utf8');
const templates = { vitrine: read('vitrine/index.html'), admin: read('admin/index.html'), super: read('super/index.html') };

function origin(req) {
  return config.publicUrl || `${req.protocol}://${req.get('host')}`;
}
const absolute = (req, url) => (!url ? '' : /^https?:/.test(url) ? url : origin(req) + url);

function themeCss(shop) {
  const p = shop?.color_primary || '#0b0b0b';
  const a = shop?.color_accent || '#c9a227';
  return `:root{--primary:${p};--accent:${a};--on-primary:${onColor(p)};--on-accent:${onColor(a)}}`;
}

function fill(tpl, vars) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in vars ? vars[k] : ''));
}

// kind : 'vitrine' | 'admin' | 'super'
function page(req, kind, { shop, product, title, noindex } = {}) {
  const base = shop ? `/${shop.slug}` : '';
  const url = origin(req) + req.originalUrl.split('?')[0];
  const t = title || shop?.name || 'Boutique de tissus';
  let desc = shop ? (shop.about || `${shop.name}${shop.owner_name ? ' chez ' + shop.owner_name : ''}${shop.city ? ' — ' + shop.city : ''}${shop.tagline ? ' : ' + shop.tagline : ''}.`) : '';
  let image = shop ? absolute(req, store.fileUrl(shop.logo_path)) : '';
  if (product) {
    const pp = publicProduct(product);
    desc = pp.description || desc;
    image = absolute(req, pp.image);
  }
  const meta = noindex
    ? '<meta name="robots" content="noindex,nofollow">'
    : `<meta name="description" content="${h(desc)}">
<meta property="og:type" content="${product ? 'product' : 'website'}">
<meta property="og:site_name" content="${h(shop?.name || '')}">
<meta property="og:title" content="${h(t)}">
<meta property="og:description" content="${h(desc)}">
<meta property="og:url" content="${h(url)}">
${image ? `<meta property="og:image" content="${h(image)}">` : ''}
<meta name="twitter:card" content="summary_large_image">`;
  const manifest = kind === 'admin' ? `${base}/admin/manifest.webmanifest` : kind === 'vitrine' ? `${base}/manifest.webmanifest` : '';
  const boot = shop ? { base, shop: publicShop(shop), ...(kind === 'admin' ? { otp: otp.enabled() } : {}) } : {};
  return fill(templates[kind], {
    TITLE: h(t),
    META: meta,
    THEME: themeCss(shop),
    THEME_COLOR: h(shop?.color_primary || '#0b0b0b'),
    MANIFEST: manifest ? `<link rel="manifest" href="${manifest}">` : '',
    ICON: shop ? `<link rel="icon" href="${base}/icon-192.png"><link rel="apple-touch-icon" href="${base}/icon-192.png">` : '',
    BOOT: safeJson(boot),
  });
}

function manifest(shop, kind) {
  const base = `/${shop.slug}`;
  const admin = kind === 'admin';
  return {
    name: admin ? `${shop.name} — Espace propriétaire` : shop.name,
    short_name: admin ? 'Mes tissus' : shop.name.slice(0, 12),
    description: admin ? 'Ajoutez vos tissus en 15 secondes' : `Boutique de tissus ${shop.city || ''}`.trim(),
    lang: 'fr',
    start_url: admin ? `${base}/admin` : base,
    scope: admin ? `${base}/admin` : `${base}/`,
    display: 'standalone',
    orientation: 'portrait',
    background_color: shop.color_primary,
    theme_color: shop.color_primary,
    icons: [
      { src: `${base}/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: `${base}/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: `${base}/icon-512.png?m=1`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

// Icône : logo de la boutique sur fond de sa couleur, ou initiale en doré.
async function icon(shop, size) {
  const bg = shop.color_primary;
  const pad = Math.round(size * 0.16);
  let layer;
  if (shop.logo_path) {
    try {
      const logo = await store.getFile(shop.logo_path);
      layer = await sharp(logo).resize(size - 2 * pad, size - 2 * pad, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    } catch { /* repli sur l'initiale */ }
  }
  if (!layer) {
    const letter = h((shop.name.trim()[0] || 'T').toUpperCase());
    layer = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
      <text x="50%" y="50%" dy=".35em" text-anchor="middle" font-family="Georgia,serif" font-size="${size * 0.52}" font-weight="700" fill="${shop.color_accent}">${letter}</text></svg>`);
  }
  return sharp({ create: { width: size, height: size, channels: 4, background: bg } })
    .composite([{ input: layer, gravity: 'centre' }]).png().toBuffer();
}

module.exports = { page, manifest, icon, origin };
