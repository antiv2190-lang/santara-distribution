// Boutique Tissus — serveur unique : vitrine publique, espace propriétaire, super-admin, API.
//
// Adresses :
//   /                       -> boutique par défaut (DEFAULT_SHOP) si définie
//   /<boutique>             -> vitrine client            /<boutique>/p/<id> -> fiche produit
//   /<boutique>/admin       -> espace propriétaire (PWA)  /admin -> idem pour la boutique par défaut
//   /super-admin            -> création et gestion des boutiques
const express = require('express');
const path = require('path');
const config = require('./lib/config');
const store = require('./lib/store');
const render = require('./lib/render');
const pipeline = require('./lib/ai/pipeline');
const { isSlug, escapeHtml } = require('./lib/util');

const app = express();
app.set('trust proxy', 1); // Render / Railway / Fly : HTTPS géré par la plateforme
app.disable('x-powered-by');

// ---- En-têtes de sécurité ----
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    // La caméra n'est autorisée que pour notre propre site (espace propriétaire).
    'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
  });
  next();
});

// ---- Fichiers statiques ----
app.use('/static', express.static(config.publicDir, { maxAge: config.isProd ? '1h' : 0, index: false }));
if (store.name === 'memory') app.use('/files', express.static(store.filesDir, { maxAge: '7d' })); // mode démo
app.get('/sw.js', (req, res) => {
  res.set({ 'Service-Worker-Allowed': '/', 'Cache-Control': 'no-cache', 'Content-Type': 'application/javascript' });
  res.sendFile(path.join(config.publicDir, 'sw.js'));
});
app.get('/robots.txt', (req, res) => res.type('text').send('User-agent: *\nDisallow: /admin\nDisallow: /super-admin\nDisallow: /api/\n'));

// ---- Protection CSRF simple : une requête qui modifie des données doit venir de notre site ----
app.use('/api', (req, res, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const o = req.get('origin');
    if (o && new URL(o).host !== req.get('host')) return res.status(403).json({ error: 'Origine refusée.' });
  }
  next();
});

// ---- API ----
app.use('/api/super', require('./lib/routes/super'));
app.use('/api/admin', require('./lib/routes/admin'));
app.use('/api', require('./lib/routes/public'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Introuvable.' }));

// ---- Pages ----
const html = (res, body) => res.set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' }).send(body);

app.get('/super-admin', (req, res) => html(res, render.page(req, 'super', { title: 'Super-admin', noindex: true })));

// Boutique par défaut : « / » et « /admin »
app.get('/', async (req, res, next) => {
  try {
    if (config.defaultShop) return res.redirect(302, '/' + config.defaultShop);
    const shops = (await store.listShops()).filter((s) => s.active);
    if (shops.length === 1) return res.redirect(302, '/' + shops[0].slug);
    const items = shops.map((s) => `<li><a href="/${escapeHtml(s.slug)}">${escapeHtml(s.name)}</a> <small>${escapeHtml(s.city || '')}</small></li>`).join('');
    html(res, `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Boutiques</title>
<body style="font-family:Georgia,serif;max-width:480px;margin:40px auto;padding:0 16px"><h1>Nos boutiques</h1><ul style="line-height:2">${items || '<li>Aucune boutique pour le moment.</li>'}</ul>`);
  } catch (e) { next(e); }
});
app.get('/admin', (req, res) => {
  if (!config.defaultShop) return res.status(404).send('Aucune boutique par défaut. Utilisez /<boutique>/admin.');
  res.redirect(302, `/${config.defaultShop}/admin`);
});

// Résout la boutique d'après l'adresse
async function shopParam(req, res, next) {
  try {
    const slug = String(req.params.slug).toLowerCase();
    const shop = isSlug(slug) ? await store.getShopBySlug(slug) : null;
    if (!shop || !shop.active) return res.status(404).type('html').send('<h1>Boutique introuvable</h1>');
    req.shop = shop;
    next();
  } catch (e) { next(e); }
}

app.get('/:slug/manifest.webmanifest', shopParam, (req, res) =>
  res.type('application/manifest+json').json(render.manifest(req.shop, 'vitrine')));
app.get('/:slug/admin/manifest.webmanifest', shopParam, (req, res) =>
  res.type('application/manifest+json').json(render.manifest(req.shop, 'admin')));
app.get('/:slug/icon-:size.png', shopParam, async (req, res, next) => {
  try {
    const size = req.params.size === '512' ? 512 : 192;
    res.set('Cache-Control', 'public, max-age=3600').type('png').send(await render.icon(req.shop, size));
  } catch (e) { next(e); }
});

app.get('/:slug/admin', shopParam, (req, res) => html(res, render.page(req, 'admin', { shop: req.shop, title: `${req.shop.name} — Propriétaire`, noindex: true })));
app.get('/:slug', shopParam, (req, res) => html(res, render.page(req, 'vitrine', { shop: req.shop })));
app.get('/:slug/p/:id', shopParam, async (req, res, next) => {
  try {
    const p = await store.getProduct(req.params.id).catch(() => null);
    const ok = p && p.shop_id === req.shop.id && ['done', 'failed'].includes(p.ai_status) && (!req.shop.require_review || p.reviewed);
    // Balises de partage (aperçu WhatsApp / Facebook) propres à ce produit
    html(res, render.page(req, 'vitrine', { shop: req.shop, product: ok ? p : null, title: ok ? `${p.name} — ${req.shop.name}` : req.shop.name }));
  } catch (e) { next(e); }
});

// ---- Erreurs ----
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Fichier trop volumineux.' });
  if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Erreur du serveur. Réessayez.' });
});

// Lancement classique (npm start, Render...) : on écoute un port. Sur Vercel, api/index.js importe simplement `app`.
if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`Boutique Tissus prêt : http://localhost:${config.port}  (stockage : ${store.name})`);
    pipeline.start();
  });
}

module.exports = app;
