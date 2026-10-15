// Tableau de bord super-admin : créer et gérer les boutiques.
const express = require('express');
const sharp = require('sharp');
const store = require('../store');
const auth = require('../auth');
const config = require('../config');
const { superShop } = require('../views');
const util = require('../util');

const router = express.Router();
const COOKIE = 'tissus_super';

router.post('/login', express.json({ limit: '5kb' }), (req, res) => {
  const key = `${req.ip}|super`;
  const wait = auth.lockedFor(key);
  if (wait) return res.status(429).json({ error: `Trop d'essais. Réessayez dans ${wait} min.` });
  if (!config.superCode || !auth.safeEqual(req.body.code || '', config.superCode)) {
    auth.registerFail(key);
    return res.status(401).json({ error: config.superCode ? 'Code incorrect.' : 'SUPERADMIN_CODE non configuré sur le serveur.' });
  }
  auth.clearFails(key);
  auth.setCookie(req, res, COOKIE, auth.sign({ role: 'super' }, 7 * 86400), 7 * 86400);
  res.json({ ok: true });
});
router.post('/logout', (req, res) => { auth.clearCookie(req, res, COOKIE); res.json({ ok: true }); });

router.use((req, res, next) => {
  const s = auth.verify(auth.readCookie(req, COOKIE));
  if (!s || s.role !== 'super') return res.status(401).json({ error: 'Connexion requise.' });
  next();
});

router.get('/me', (req, res) => res.json({ ok: true, defaultShop: config.defaultShop }));

router.get('/shops', async (req, res, next) => {
  try {
    const shops = await store.listShops();
    const counts = await Promise.all(shops.map((s) => store.countProducts(s.id)));
    res.json(shops.map((s, i) => superShop(s, counts[i])));
  } catch (e) { next(e); }
});

// Validation commune création / modification
function readShopFields(b, partial) {
  const out = {};
  const err = (m) => { const e = new Error(m); e.status = 400; throw e; };
  if (!partial || 'name' in b) { out.name = util.clampStr(b.name, 60); if (!out.name) err('Le nom de la boutique est obligatoire.'); }
  if (!partial || 'slug' in b) { out.slug = String(b.slug || '').toLowerCase().trim(); if (!util.isSlug(out.slug)) err("Adresse invalide (lettres minuscules, chiffres et tirets, 2 à 30 caractères)."); }
  if (!partial || 'whatsapp' in b) { out.whatsapp = util.normalizePhone(b.whatsapp); if (!util.isPhone(out.whatsapp)) err('Numéro WhatsApp invalide.'); }
  if (!partial || 'city' in b) out.city = util.clampStr(b.city, 60);
  if ('tagline' in b) out.tagline = util.clampStr(b.tagline, 100);
  if (!partial || 'sale_unit' in b) { out.sale_unit = b.sale_unit; if (!util.SALE_UNITS.includes(out.sale_unit)) err('Mode de vente invalide.'); }
  if (!partial || 'color_primary' in b) { out.color_primary = b.color_primary; if (!util.isHexColor(out.color_primary)) err('Couleur principale invalide.'); }
  if (!partial || 'color_accent' in b) { out.color_accent = b.color_accent; if (!util.isHexColor(out.color_accent)) err("Couleur d'accent invalide."); }
  if ('require_review' in b) out.require_review = !!b.require_review;
  if ('ai_auto' in b) out.ai_auto = !!b.ai_auto;
  if ('active' in b) out.active = !!b.active;
  return out;
}

router.post('/shops', express.json({ limit: '20kb' }), async (req, res, next) => {
  try {
    const f = readShopFields(req.body, false);
    const phone = util.normalizePhone(req.body.admin_phone);
    const pin = String(req.body.admin_pin || '');
    if (!util.isPhone(phone)) return res.status(400).json({ error: 'Numéro du propriétaire invalide.' });
    if (!/^\d{4,8}$/.test(pin)) return res.status(400).json({ error: 'Le code doit avoir 4 à 8 chiffres.' });
    const shop = await store.createShop({ ...f, admin_phone: phone, admin_pin_hash: auth.hashPin(pin) });
    res.status(201).json(superShop(shop, 0));
  } catch (e) {
    if (e.code === 'slug_taken') return res.status(409).json({ error: 'Cette adresse est déjà utilisée.' });
    next(e);
  }
});

router.patch('/shops/:id', express.json({ limit: '20kb' }), async (req, res, next) => {
  try {
    const shop = await store.getShopById(req.params.id);
    if (!shop) return res.status(404).json({ error: 'Boutique introuvable.' });
    const patch = readShopFields(req.body, true);
    if ('slug' in patch && patch.slug !== shop.slug) return res.status(400).json({ error: "L'adresse ne peut pas être modifiée." });
    delete patch.slug;
    if ('admin_phone' in req.body) {
      const phone = util.normalizePhone(req.body.admin_phone);
      if (!util.isPhone(phone)) return res.status(400).json({ error: 'Numéro du propriétaire invalide.' });
      patch.admin_phone = phone;
    }
    if (req.body.admin_pin) {
      if (!/^\d{4,8}$/.test(String(req.body.admin_pin))) return res.status(400).json({ error: 'Le code doit avoir 4 à 8 chiffres.' });
      patch.admin_pin_hash = auth.hashPin(req.body.admin_pin);
    }
    const updated = await store.updateShop(shop.id, patch);
    res.json(superShop(updated, await store.countProducts(shop.id)));
  } catch (e) { next(e); }
});

// Autres personnes autorisées à gérer la boutique (en plus du propriétaire principal)
router.post('/shops/:id/admins', express.json({ limit: '5kb' }), async (req, res, next) => {
  try {
    const shop = await store.getShopById(req.params.id);
    if (!shop) return res.status(404).json({ error: 'Boutique introuvable.' });
    const name = util.clampStr(req.body.name, 60);
    const phone = util.normalizePhone(req.body.phone);
    const pin = String(req.body.pin || '');
    if (!name) return res.status(400).json({ error: 'Le nom est obligatoire.' });
    if (!util.isPhone(phone)) return res.status(400).json({ error: 'Numéro invalide.' });
    if (!/^\d{4,8}$/.test(pin)) return res.status(400).json({ error: 'Le code doit avoir 4 à 8 chiffres.' });
    if (util.loginKey(phone) === util.loginKey(shop.admin_phone)) return res.status(409).json({ error: 'Ce numéro est déjà celui du propriétaire principal.' });
    const others = (shop.admins || []).filter((a) => util.loginKey(a.phone) !== util.loginKey(phone));
    const updated = await store.updateShop(shop.id, { admins: [...others, { name, phone, pin_hash: auth.hashPin(pin) }] });
    res.status(201).json(superShop(updated, await store.countProducts(shop.id)));
  } catch (e) { next(e); }
});
router.delete('/shops/:id/admins/:phone', async (req, res, next) => {
  try {
    const shop = await store.getShopById(req.params.id);
    if (!shop) return res.status(404).json({ error: 'Boutique introuvable.' });
    const k = util.loginKey(req.params.phone);
    const updated = await store.updateShop(shop.id, { admins: (shop.admins || []).filter((a) => util.loginKey(a.phone) !== k) });
    res.json(superShop(updated, await store.countProducts(shop.id)));
  } catch (e) { next(e); }
});

// Logo : le corps de la requête est l'image.
router.post('/shops/:id/logo', express.raw({ type: 'image/*', limit: '8mb' }), async (req, res, next) => {
  try {
    const shop = await store.getShopById(req.params.id);
    if (!shop) return res.status(404).json({ error: 'Boutique introuvable.' });
    let png;
    try { png = await sharp(req.body).rotate().resize(512, 512, { fit: 'inside', withoutEnlargement: true }).png().toBuffer(); }
    catch { return res.status(400).json({ error: 'Image invalide.' }); }
    const p = `${shop.id}/logo-${Date.now()}.png`;
    await store.putFile(p, png, 'image/png');
    const old = shop.logo_path;
    const updated = await store.updateShop(shop.id, { logo_path: p });
    if (old) store.deleteFiles([old]).catch(() => {});
    res.json(superShop(updated, await store.countProducts(shop.id)));
  } catch (e) { next(e); }
});

module.exports = router;
