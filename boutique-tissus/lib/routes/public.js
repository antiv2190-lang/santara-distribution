// API publique (vitrine) : lecture seule, uniquement les produits visibles.
const express = require('express');
const store = require('../store');
const { publicShop, publicProduct } = require('../views');
const { CATEGORIES } = require('../util');

const router = express.Router();

async function activeShop(req, res, next) {
  try {
    const shop = await store.getShopBySlug(String(req.params.slug).toLowerCase());
    if (!shop || !shop.active) return res.status(404).json({ error: 'Boutique introuvable.' });
    req.shop = shop;
    next();
  } catch (e) { next(e); }
}

router.get('/shops/:slug', activeShop, (req, res) => {
  res.set('Cache-Control', 'public, max-age=60');
  res.json(publicShop(req.shop));
});

// Nombre de tissus par rubrique (la vitrine n'affiche que les rubriques qui ont des produits)
router.get('/shops/:slug/categories', activeShop, async (req, res, next) => {
  try {
    const opts = { publicOnly: true, requireReview: req.shop.require_review, limit: 1 };
    const [all, ...per] = await Promise.all([store.listProducts(req.shop.id, opts), ...CATEGORIES.map((c) => store.listProducts(req.shop.id, { ...opts, category: c }))]);
    res.set('Cache-Control', 'public, max-age=15');
    res.json({ total: all.total, counts: Object.fromEntries(CATEGORIES.map((c, i) => [c, per[i].total])) });
  } catch (e) { next(e); }
});

router.get('/shops/:slug/products', activeShop, async (req, res, next) => {
  try {
    const category = CATEGORIES.includes(req.query.cat) ? req.query.cat : undefined;
    const q = String(req.query.q || '').trim().slice(0, 60) || undefined;
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 24, 1), 60);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);
    const { items, total } = await store.listProducts(req.shop.id, {
      publicOnly: true, requireReview: req.shop.require_review, category, q, limit, offset,
    });
    res.set('Cache-Control', 'public, max-age=15');
    res.json({ total, items: items.map(publicProduct) });
  } catch (e) { next(e); }
});

router.get('/shops/:slug/products/:id', activeShop, async (req, res, next) => {
  try {
    const p = await store.getProduct(req.params.id);
    if (!p || p.shop_id !== req.shop.id || !['done', 'failed'].includes(p.ai_status) || (req.shop.require_review && !p.reviewed)) {
      return res.status(404).json({ error: 'Produit introuvable.' });
    }
    res.set('Cache-Control', 'public, max-age=15');
    res.json(publicProduct(p));
  } catch (e) { next(e); }
});

module.exports = router;
