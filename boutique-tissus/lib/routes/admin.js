// API du propriétaire d'une boutique. Connexion par numéro de téléphone + code secret.
const express = require('express');
const crypto = require('crypto');
const sharp = require('sharp');
const store = require('../store');
const auth = require('../auth');
const pipeline = require('../ai/pipeline');
const { adminProduct, publicShop } = require('../views');
const { CATEGORIES, loginKey, clampStr } = require('../util');

const router = express.Router();
const COOKIE = 'tissus_admin';
const SESSION_DAYS = 60; // le propriétaire reste connecté longtemps sur son téléphone

// ---------- Connexion ----------
router.post('/login', express.json({ limit: '5kb' }), async (req, res, next) => {
  try {
    const slug = String(req.body.slug || '').toLowerCase();
    const key = `${req.ip}|${slug}`;
    const wait = auth.lockedFor(key);
    if (wait) return res.status(429).json({ error: `Trop d'essais. Réessayez dans ${wait} min.` });

    const shop = await store.getShopBySlug(slug);
    const ok = shop && shop.active && loginKey(req.body.phone) === loginKey(shop.admin_phone)
      && auth.verifyPin(String(req.body.pin || ''), shop.admin_pin_hash);
    if (!ok) {
      auth.registerFail(key);
      return res.status(401).json({ error: 'Numéro ou code incorrect.' });
    }
    auth.clearFails(key);
    auth.setCookie(req, res, COOKIE, auth.sign({ sid: shop.id, role: 'admin' }, SESSION_DAYS * 86400), SESSION_DAYS * 86400);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/logout', (req, res) => { auth.clearCookie(req, res, COOKIE); res.json({ ok: true }); });

// ---------- Tout ce qui suit exige d'être connecté ----------
async function requireAdmin(req, res, next) {
  try {
    const s = auth.verify(auth.readCookie(req, COOKIE));
    const shop = s && s.role === 'admin' ? await store.getShopById(s.sid) : null;
    if (!shop || !shop.active) return res.status(401).json({ error: 'Veuillez vous connecter.' });
    req.shop = shop;
    next();
  } catch (e) { next(e); }
}
router.use(requireAdmin);

router.get('/me', (req, res) => res.json({ shop: publicShop(req.shop) }));

router.post('/pin', express.json({ limit: '5kb' }), async (req, res, next) => {
  try {
    const { old: oldPin, pin } = req.body;
    if (!auth.verifyPin(String(oldPin || ''), req.shop.admin_pin_hash)) return res.status(400).json({ error: 'Ancien code incorrect.' });
    if (!/^\d{4,8}$/.test(String(pin || ''))) return res.status(400).json({ error: 'Le nouveau code doit avoir 4 à 8 chiffres.' });
    await store.updateShop(req.shop.id, { admin_pin_hash: auth.hashPin(pin) });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------- Produits ----------
router.get('/products', async (req, res, next) => {
  try {
    const filter = ['review', 'available', 'soldout'].includes(req.query.filter) ? req.query.filter : undefined;
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 40, 1), 100);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);
    const { items, total } = await store.listProducts(req.shop.id, { filter, limit, offset });
    res.set('Cache-Control', 'no-store');
    res.json({ total, items: items.map(adminProduct) });
  } catch (e) { next(e); }
});

// Compteurs pour l'écran d'accueil
router.get('/stats', async (req, res, next) => {
  try {
    const [all, review] = await Promise.all([
      store.listProducts(req.shop.id, { limit: 1 }),
      store.listProducts(req.shop.id, { filter: 'review', limit: 1 }),
    ]);
    res.set('Cache-Control', 'no-store');
    res.json({ total: all.total, review: review.total });
  } catch (e) { next(e); }
});

router.get('/products/:id', async (req, res, next) => {
  try {
    const p = await store.getProduct(req.params.id);
    if (!p || p.shop_id !== req.shop.id) return res.status(404).json({ error: 'Introuvable.' });
    res.set('Cache-Control', 'no-store');
    res.json(adminProduct(p));
  } catch (e) { next(e); }
});

// Création : le corps de la requête EST la photo (JPEG). Prix et identifiant dans l'URL.
// Réponse immédiate : l'IA travaille ensuite en arrière-plan.
router.post('/products', express.raw({ type: ['image/*', 'application/octet-stream'], limit: '12mb' }), async (req, res, next) => {
  try {
    const price = parseInt(req.query.price, 10);
    if (!Number.isInteger(price) || price <= 0 || price > 100000000) return res.status(400).json({ error: 'Prix invalide.' });
    if (!Buffer.isBuffer(req.body) || req.body.length < 500) return res.status(400).json({ error: 'Photo manquante.' });

    const cid = clampStr(req.query.cid, 64) || null;
    if (cid) {
      // Renvoi après une coupure réseau : on ne crée pas de doublon.
      const existing = await store.findProductByClientId(req.shop.id, cid);
      if (existing) return res.json(adminProduct(existing));
    }
    let meta;
    try { meta = await sharp(req.body).metadata(); } catch { meta = null; }
    if (!meta || !['jpeg', 'png', 'webp'].includes(meta.format)) return res.status(400).json({ error: 'Format de photo non pris en charge.' });

    const id = crypto.randomUUID();
    const originalPath = `${req.shop.id}/${id}/original.${meta.format === 'jpeg' ? 'jpg' : meta.format}`;
    await store.putFile(originalPath, req.body, `image/${meta.format}`);
    const p = await store.createProduct({ id, shop_id: req.shop.id, client_id: cid, price, original_path: originalPath });
    pipeline.enqueue(p.id);
    res.status(201).json(adminProduct(p));
  } catch (e) { next(e); }
});

router.patch('/products/:id', express.json({ limit: '20kb' }), async (req, res, next) => {
  try {
    const p = await store.getProduct(req.params.id);
    if (!p || p.shop_id !== req.shop.id) return res.status(404).json({ error: 'Introuvable.' });
    const b = req.body || {};
    const patch = {};
    if ('name' in b) { patch.name = clampStr(b.name, 80); if (!patch.name) return res.status(400).json({ error: 'Le nom est vide.' }); }
    if ('description' in b) patch.description = clampStr(b.description, 600);
    if ('category' in b) { if (!CATEGORIES.includes(b.category)) return res.status(400).json({ error: 'Catégorie invalide.' }); patch.category = b.category; }
    if ('price' in b) {
      const price = parseInt(b.price, 10);
      if (!Number.isInteger(price) || price <= 0 || price > 100000000) return res.status(400).json({ error: 'Prix invalide.' });
      patch.price = price;
    }
    if ('sold_out' in b) patch.sold_out = !!b.sold_out;
    if ('reviewed' in b) patch.reviewed = !!b.reviewed;
    const updated = await store.updateProduct(p.id, patch);
    res.json(adminProduct(updated));
  } catch (e) { next(e); }
});

router.post('/products/:id/reprocess', async (req, res, next) => {
  try {
    const p = await store.getProduct(req.params.id);
    if (!p || p.shop_id !== req.shop.id) return res.status(404).json({ error: 'Introuvable.' });
    await pipeline.reprocess(p.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.delete('/products/:id', async (req, res, next) => {
  try {
    const p = await store.getProduct(req.params.id);
    if (!p || p.shop_id !== req.shop.id) return res.status(404).json({ error: 'Introuvable.' });
    await store.deleteProduct(p.id);
    await store.deleteFiles([p.original_path, p.enhanced_path, p.thumb_path]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
