// Stockage "mode démo" : tout sur disque (.data/). Aucun compte nécessaire.
// Même interface que supabase.js — sert au développement et aux tests.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');

const DB_FILE = path.join(config.dataDir, 'db.json');
const FILES_DIR = path.join(config.dataDir, 'files');
fs.mkdirSync(FILES_DIR, { recursive: true });

let db = { shops: [], products: [] };
try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { /* première utilisation */ }

let timer = null;
function persist() {
  clearTimeout(timer);
  timer = setTimeout(() => fs.writeFile(DB_FILE, JSON.stringify(db), () => {}), 150);
}
const now = () => new Date().toISOString();
const clone = (o) => (o ? JSON.parse(JSON.stringify(o)) : o);

module.exports = {
  name: 'memory',
  filesDir: FILES_DIR,

  // ---- Boutiques ----
  async listShops() { return clone(db.shops).sort((a, b) => a.created_at.localeCompare(b.created_at)); },
  async getShopBySlug(slug) { return clone(db.shops.find((s) => s.slug === slug)); },
  async getShopById(id) { return clone(db.shops.find((s) => s.id === id)); },
  async createShop(data) {
    if (db.shops.some((s) => s.slug === data.slug)) { const e = new Error('slug_taken'); e.code = 'slug_taken'; throw e; }
    const shop = { id: crypto.randomUUID(), active: true, require_review: false, created_at: now(),
      features: { orange_money: false, moov_money: false, facebook_autopost: false, tiktok_autopost: false }, ...data };
    db.shops.push(shop); persist(); return clone(shop);
  },
  async updateShop(id, patch) {
    const s = db.shops.find((x) => x.id === id); if (!s) return null;
    Object.assign(s, patch); persist(); return clone(s);
  },
  async countProducts(shopId) { return db.products.filter((p) => p.shop_id === shopId).length; },

  // ---- Produits ----
  async createProduct(data) {
    const p = { id: crypto.randomUUID(), category: 'autre', ai_status: 'pending', ai_attempts: 0, reviewed: false,
      sold_out: false, social: {}, name: null, description: null, enhanced_path: null, thumb_path: null,
      ai_error: null, created_at: now(), updated_at: now(), ...data };
    db.products.push(p); persist(); return clone(p);
  },
  async getProduct(id) { return clone(db.products.find((p) => p.id === id)); },
  async findProductByClientId(shopId, cid) {
    return clone(db.products.find((p) => p.shop_id === shopId && p.client_id === cid));
  },
  async listProducts(shopId, { publicOnly, requireReview, filter, category, q, limit = 24, offset = 0 } = {}) {
    let items = db.products.filter((p) => p.shop_id === shopId);
    if (publicOnly) {
      items = items.filter((p) => ['done', 'failed'].includes(p.ai_status) && (!requireReview || p.reviewed));
    }
    if (filter === 'review') items = items.filter((p) => !p.reviewed);
    if (filter === 'available') items = items.filter((p) => !p.sold_out);
    if (filter === 'soldout') items = items.filter((p) => p.sold_out);
    if (category) items = items.filter((p) => p.category === category);
    if (q) { const n = q.toLowerCase(); items = items.filter((p) => (p.name || '').toLowerCase().includes(n)); }
    items.sort((a, b) => b.created_at.localeCompare(a.created_at));
    return { total: items.length, items: clone(items.slice(offset, offset + limit)) };
  },
  async updateProduct(id, patch) {
    const p = db.products.find((x) => x.id === id); if (!p) return null;
    Object.assign(p, patch, { updated_at: now() }); persist(); return clone(p);
  },
  async deleteProduct(id) { db.products = db.products.filter((p) => p.id !== id); persist(); },
  // Produits dont le traitement IA semble bloqué (redémarrage du serveur, etc.)
  async listStuckProducts(olderThanMs) {
    const limit = new Date(Date.now() - olderThanMs).toISOString();
    return clone(db.products.filter((p) => ['pending', 'processing'].includes(p.ai_status) && p.updated_at < limit));
  },

  // ---- Fichiers ----
  async putFile(p, buffer) {
    const full = path.join(FILES_DIR, p);
    await fs.promises.mkdir(path.dirname(full), { recursive: true });
    await fs.promises.writeFile(full, buffer);
  },
  async getFile(p) { return fs.promises.readFile(path.join(FILES_DIR, p)); },
  async deleteFiles(paths) {
    await Promise.all(paths.filter(Boolean).map((p) => fs.promises.rm(path.join(FILES_DIR, p), { force: true })));
  },
  fileUrl(p) { return p ? `/files/${p}` : null; },
};
