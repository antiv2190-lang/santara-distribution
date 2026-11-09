'use strict';
// Kamissoko & Frères — boutique en ligne + espace administrateur sécurisé.
const path = require('path'), fs = require('fs'), crypto = require('crypto');
const express = require('express'), helmet = require('helmet');
const sec = require('./lib/security');
const Store = require('./lib/store');
const seed = require('./lib/seed');
const garments = require('./lib/garments');
const { PALETTE, CATEGORIES, GARMENTS } = require('./lib/palette');

const STATUSES = ['nouveau', 'confirmé', 'livré', 'annulé'];
const STOCKS = ['in', 'low', 'out'];
const IMG_RE = /^[a-f0-9]{24}\.(jpg|png|webp)$/;

// ---------- Nettoyage / validation (tout ce qui vient du client est considéré hostile) ----------
const clean = (v, max) => typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
const cleanMultiline = (v, max) => typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f<>]/g, '').trim().slice(0, max) : '';
const int = (v, min, max) => { const n = Number(v); return Number.isInteger(n) && n >= min && n <= max ? n : null; };
const digits = v => typeof v === 'string' ? v.replace(/[^\d]/g, '') : '';
const fcfa = n => n.toLocaleString('fr-FR').replace(/[  ]/g, ' ') + ' FCFA';
class HttpError extends Error { constructor(status, msg, extra) { super(msg); this.status = status; this.extra = extra; } }
const bad = (msg, extra) => new HttpError(400, msg, extra);

function normalizePhone(raw) {
  let d = digits(raw);
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 8) d = '223' + d; // numéro malien local
  return d.length >= 8 && d.length <= 15 ? d : null;
}

function cleanProduct(b, base = {}) {
  const name = clean(b.name, 80); if (name.length < 2) throw bad('Le nom du produit est obligatoire.');
  if (!CATEGORIES[b.category]) throw bad('Catégorie invalide.');
  if (!GARMENTS[b.garment]) throw bad('Type d’illustration invalide.');
  const priceRetail = int(b.priceRetail, 0, 50_000_000), priceWholesale = int(b.priceWholesale, 0, 50_000_000), wholesaleMin = int(b.wholesaleMin, 2, 10000);
  if (priceRetail === null || priceRetail < 1) throw bad('Prix de détail invalide.');
  if (priceWholesale === null || priceWholesale < 1) throw bad('Prix de gros invalide.');
  if (priceWholesale > priceRetail) throw bad('Le prix de gros doit être inférieur ou égal au prix de détail.');
  if (wholesaleMin === null) throw bad('Quantité minimale de gros invalide (minimum 2).');
  const colors = [...new Set((Array.isArray(b.colors) ? b.colors : []).filter(c => PALETTE[c]))].slice(0, 12);
  const sizes = [...new Set((Array.isArray(b.sizes) ? b.sizes : []).map(s => clean(String(s), 10)).filter(Boolean))].slice(0, 15);
  if (!STOCKS.includes(b.stock)) throw bad('Stock invalide.');
  let image = base.image || null;
  if ('image' in b) {
    if (b.image === null || b.image === '') image = null;
    else if (typeof b.image === 'string' && IMG_RE.test(b.image)) image = b.image;
    else throw bad('Image invalide.');
  }
  return { ...base, name, category: b.category, garment: b.garment, colors, sizes, priceRetail, priceWholesale, wholesaleMin,
    description: cleanMultiline(b.description, 600), image, stock: b.stock, featured: !!b.featured, visible: b.visible !== false,
    updatedAt: new Date().toISOString() };
}

function sniffImage(buf) {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 12 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 12 && buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'webp';
  return null;
}

function createApp(opts = {}) {
  const prod = (opts.env || process.env.NODE_ENV) === 'production';
  const dataDir = path.resolve(opts.dataDir || process.env.DATA_DIR || path.join(__dirname, 'data'));
  const store = new Store(dataDir);
  const log = opts.quiet ? () => {} : console.log;
  let bootstrapNote = null;

  if (store.isNew) store.init(seed());
  if (!store.db.users.length) {
    const username = clean(opts.adminUser || process.env.ADMIN_USERNAME || 'kamissoko', 40).toLowerCase() || 'kamissoko';
    let pw = opts.adminPassword || process.env.ADMIN_PASSWORD, generated = false;
    if (!pw || sec.passwordProblem(pw, username)) { pw = sec.randomPassword(); generated = true; }
    store.db.users.push({ id: store.id(), username, hash: sec.hashPassword(pw), mustChange: true, totpEnabled: false, totpSecret: null, totpLast: 0, createdAt: new Date().toISOString() });
    store.save();
    bootstrapNote = { username, password: generated ? pw : null };
    log('\n==================== COMPTE ADMINISTRATEUR CRÉÉ ====================');
    log(` Identifiant : ${username}`);
    log(generated ? ` Mot de passe : ${pw}   (affiché UNE SEULE FOIS — il faudra le changer à la 1re connexion)` : ' Mot de passe : celui de la variable ADMIN_PASSWORD (changement obligatoire à la 1re connexion)');
    log('=====================================================================\n');
  }

  const sessions = new sec.Sessions();
  const limits = {
    global: new sec.RateLimiter(opts.globalMax || 300, 60_000),
    login: new sec.RateLimiter(opts.loginMax || 10, 15 * 60_000),
    order: new sec.RateLimiter(opts.orderMax || 6, 10 * 60_000),
    upload: new sec.RateLimiter(40, 60 * 60_000)
  };
  const locks = new Map(); // identifiant -> { fails, until, strikes }

  const app = express();
  app.disable('x-powered-by');
  const tp = opts.trustProxy ?? process.env.TRUST_PROXY ?? (prod ? '1' : 'false');
  app.set('trust proxy', tp === 'false' ? false : /^\d+$/.test(String(tp)) ? Number(tp) : tp);

  // ---------- En-têtes de sécurité ----------
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        'default-src': ["'self'"], 'script-src': ["'self'"], 'style-src': ["'self'"], 'img-src': ["'self'", 'data:'],
        'font-src': ["'self'"], 'connect-src': ["'self'"], 'object-src': ["'none'"], 'base-uri': ["'none'"],
        'form-action': ["'self'"], 'frame-ancestors': ["'none'"], 'manifest-src': ["'self'"],
        ...(prod ? { 'upgrade-insecure-requests': [] } : {})
      }
    },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    hsts: prod ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-origin' }
  }));
  app.use((req, res, next) => {
    res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
    if (req.path.startsWith('/admin') || req.path.startsWith('/api/admin')) { res.set('X-Robots-Tag', 'noindex, nofollow'); res.set('Cache-Control', 'no-store'); }
    next();
  });
  app.use(limits.global.middleware('trafic anormal'));

  // Protection CSRF en profondeur : requêtes modifiantes uniquement depuis notre propre origine.
  app.use((req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const site = req.get('sec-fetch-site');
    if (site && !['same-origin', 'none'].includes(site)) return next(new HttpError(403, 'Origine refusée.'));
    const origin = req.get('origin');
    if (origin) { try { if (new URL(origin).host !== req.get('host')) return next(new HttpError(403, 'Origine refusée.')); } catch { return next(new HttpError(403, 'Origine refusée.')); } }
    next();
  });
  app.use((req, res, next) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !req.is('application/json')) return next(new HttpError(415, 'Contenu non supporté.'));
    next();
  });

  const uploadParser = express.json({ limit: '2.2mb' });
  app.post('/api/admin/upload', uploadParser);
  app.use(express.json({ limit: '20kb' }));

  // ---------- Fichiers publics ----------
  app.get('/img/garment/:type.svg', (req, res) => {
    const type = req.params.type; if (!GARMENTS[type]) return res.status(404).end();
    const c = typeof req.query.c === 'string' && garments.HEX.test(req.query.c) ? req.query.c : '#3f6a9e';
    res.set({ 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'public, max-age=86400', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" });
    res.send(garments.render(type, c));
  });
  app.get('/uploads/:file', (req, res) => {
    const f = req.params.file; if (!IMG_RE.test(f)) return res.status(404).end();
    const p = path.join(store.uploads, f); if (!fs.existsSync(p)) return res.status(404).end();
    const ext = f.split('.').pop();
    res.set({ 'Content-Type': { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[ext], 'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" });
    fs.createReadStream(p).pipe(res);
  });
  app.get('/robots.txt', (req, res) => res.type('text/plain').send('User-agent: *\nDisallow: /admin\nDisallow: /api/\n'));
  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.use(express.static(path.join(__dirname, 'public'), { dotfiles: 'deny', index: 'index.html', maxAge: prod ? '1h' : 0, redirect: true }));

  // ---------- API publique ----------
  const imgUrl = p => p.image ? `/uploads/${p.image}` : `/img/garment/${p.garment}.svg?c=${encodeURIComponent(PALETTE[p.colors[0]] || '#3f6a9e')}`;
  const pub = p => ({ id: p.id, name: p.name, category: p.category, garment: p.garment, colors: p.colors, sizes: p.sizes,
    priceRetail: p.priceRetail, priceWholesale: p.priceWholesale, wholesaleMin: p.wholesaleMin, description: p.description,
    stock: p.stock, featured: p.featured, img: imgUrl(p), createdAt: p.createdAt });
  app.get('/api/catalog', (req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.json({ settings: store.db.settings, categories: CATEGORIES, palette: PALETTE,
      products: store.db.products.filter(p => p.visible).map(pub) });
  });

  app.post('/api/orders', limits.order.middleware('commandes'), (req, res) => {
    const b = req.body || {};
    if (b.website) return res.json({ ok: true, id: 'X000', whatsappUrl: null }); // pot de miel anti-robots
    const name = clean(b.name, 60), city = clean(b.city, 60), note = cleanMultiline(b.note, 300);
    const phone = normalizePhone(b.phone);
    if (name.length < 2) throw bad('Indiquez votre nom.');
    if (!phone) throw bad('Numéro de téléphone invalide.');
    if (!Array.isArray(b.items) || !b.items.length || b.items.length > 30) throw bad('Votre panier est vide.');
    const lines = []; let total = 0;
    for (const it of b.items) {
      const p = store.db.products.find(x => x.id === it?.id && x.visible);
      if (!p) throw bad('Un article de votre panier n’est plus disponible.');
      if (p.stock === 'out') throw bad(`« ${p.name} » est en rupture de stock.`);
      const qty = int(it.qty, 1, 5000); if (qty === null) throw bad('Quantité invalide.');
      const size = it.size ? clean(String(it.size), 10) : ''; const color = it.color ? clean(String(it.color), 20) : '';
      if (p.sizes.length && !p.sizes.includes(size)) throw bad(`Choisissez une taille pour « ${p.name} ».`);
      if (p.colors.length && !p.colors.includes(color)) throw bad(`Choisissez une couleur pour « ${p.name} ».`);
      const wholesale = qty >= p.wholesaleMin; const unit = wholesale ? p.priceWholesale : p.priceRetail; // prix recalculés côté serveur
      lines.push({ id: p.id, name: p.name, qty, size, color, unit, wholesale, sub: unit * qty }); total += unit * qty;
    }
    const id = store.id().slice(0, 6).toUpperCase();
    const order = { id, createdAt: new Date().toISOString(), status: 'nouveau', name, phone, city, note, lines, total };
    store.db.orders.unshift(order); store.db.orders.length = Math.min(store.db.orders.length, 2000); store.save();
    const s = store.db.settings;
    const text = [`Bonjour ${s.shopName} 👋`, `Je souhaite commander (réf. ${id}) :`,
      ...lines.map(l => `• ${l.qty} × ${l.name}${l.size ? ' — taille ' + l.size : ''}${l.color ? ', ' + l.color : ''} — ${fcfa(l.unit)}${l.wholesale ? ' (prix de gros)' : ''} = ${fcfa(l.sub)}`),
      `Total : ${fcfa(total)}`, '', `Nom : ${name}`, `Téléphone : +${phone}`, city ? `Ville / quartier : ${city}` : null, note ? `Remarque : ${note}` : null]
      .filter(x => x !== null).join('\n');
    res.json({ ok: true, id, total, whatsappUrl: `https://wa.me/${s.whatsapp}?text=${encodeURIComponent(text)}` });
  });

  // ---------- Authentification administrateur ----------
  const cookieName = secure => secure ? '__Host-ksid' : 'ksid';
  const setSessionCookie = (req, res, token) => {
    const secure = prod || req.secure;
    res.cookie(cookieName(secure), token, { httpOnly: true, secure, sameSite: 'strict', path: '/', maxAge: 8 * 3600 * 1000 });
  };
  const clearCookie = (req, res) => { for (const n of ['__Host-ksid', 'ksid']) res.clearCookie(n, { path: '/', httpOnly: true, sameSite: 'strict', secure: n.startsWith('__Host') }); };
  const readToken = req => { const c = sec.parseCookies(req.headers.cookie); return prod ? c['__Host-ksid'] : (c['__Host-ksid'] || c['ksid']); };

  const findUser = u => store.db.users.find(x => x.username === String(u || '').trim().toLowerCase());
  const userView = u => ({ username: u.username, mustChange: !!u.mustChange, totpEnabled: !!u.totpEnabled });

  app.post('/api/admin/login', limits.login.middleware('connexion'), (req, res) => {
    const { username, password, otp } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string' || password.length > 200 || username.length > 60) throw bad('Identifiants incorrects.');
    const key = username.trim().toLowerCase();
    const lock = locks.get(key) || { fails: 0, until: 0, strikes: 0 };
    const user = findUser(key);
    const locked = Date.now() < lock.until;
    const ok = sec.verifyPassword(password, user && !locked ? user.hash : sec.DUMMY_HASH) && !!user && !locked;
    const fail = () => {
      lock.fails++;
      if (lock.fails >= 5) { lock.strikes++; lock.until = Date.now() + Math.min(60, 15 * 2 ** (lock.strikes - 1)) * 60_000; lock.fails = 0; }
      locks.set(key, lock);
      store.audit(key, 'connexion échouée', req.ip, locked ? 'compte verrouillé' : '');
      throw new HttpError(401, 'Identifiants incorrects, ou compte temporairement verrouillé après trop d’essais.');
    };
    if (!ok) return fail();
    if (user.totpEnabled) {
      if (!otp) return res.json({ needOtp: true });
      const step = sec.totpVerify(user.totpSecret, otp);
      if (step === null || step <= user.totpLast) return fail();
      user.totpLast = step; store.save();
    }
    locks.delete(key);
    const { token, csrf } = sessions.create(user.id);
    setSessionCookie(req, res, token);
    store.audit(user.username, 'connexion réussie', req.ip);
    res.json({ csrf, user: userView(user) });
  });

  const auth = (req, res, next) => {
    const token = readToken(req); const s = sessions.get(token);
    const user = s && store.db.users.find(u => u.id === s.userId);
    if (!user) return next(new HttpError(401, 'Session expirée. Reconnectez-vous.', { login: true }));
    if (!['GET', 'HEAD'].includes(req.method) && !sec.safeEqual(req.get('x-csrf-token') || '', s.csrf)) return next(new HttpError(403, 'Jeton de sécurité invalide. Rechargez la page.'));
    req.user = user; req.session = s; req.token = token;
    const free = ['/me', '/logout', '/password'];
    if (user.mustChange && !free.includes(req.path)) return next(new HttpError(403, 'Vous devez d’abord changer votre mot de passe.', { mustChange: true }));
    next();
  };
  const admin = express.Router(); admin.use(auth); app.use('/api/admin', admin);

  admin.get('/me', (req, res) => res.json({ user: userView(req.user), csrf: req.session.csrf, categories: CATEGORIES, garments: GARMENTS, palette: PALETTE }));
  admin.post('/logout', (req, res) => { sessions.destroy(req.token); clearCookie(req, res); store.audit(req.user.username, 'déconnexion', req.ip); res.json({ ok: true }); });

  admin.post('/password', (req, res) => {
    const { current, next: np } = req.body || {};
    if (typeof current !== 'string' || !sec.verifyPassword(current, req.user.hash)) { store.audit(req.user.username, 'changement mot de passe refusé', req.ip); throw bad('Mot de passe actuel incorrect.'); }
    const problem = sec.passwordProblem(np, req.user.username); if (problem) throw bad(problem);
    if (np === current) throw bad('Le nouveau mot de passe doit être différent de l’ancien.');
    req.user.hash = sec.hashPassword(np); req.user.mustChange = false; store.save();
    sessions.destroyUser(req.user.id); // toutes les autres sessions sont coupées
    const { token, csrf } = sessions.create(req.user.id); setSessionCookie(req, res, token);
    store.audit(req.user.username, 'mot de passe changé', req.ip);
    res.json({ ok: true, csrf, user: userView(req.user) });
  });

  admin.post('/2fa/setup', (req, res) => {
    if (req.user.totpEnabled) throw bad('La double authentification est déjà active.');
    req.user.totpPending = sec.newTotpSecret(); store.save();
    const label = encodeURIComponent(`${store.db.settings.shopName}:${req.user.username}`);
    res.json({ secret: req.user.totpPending, uri: `otpauth://totp/${label}?secret=${req.user.totpPending}&issuer=${encodeURIComponent(store.db.settings.shopName)}&digits=6&period=30` });
  });
  admin.post('/2fa/enable', (req, res) => {
    if (!req.user.totpPending) throw bad('Lancez d’abord la configuration.');
    const step = sec.totpVerify(req.user.totpPending, req.body?.code); if (step === null) throw bad('Code incorrect. Vérifiez l’heure de votre téléphone.');
    Object.assign(req.user, { totpSecret: req.user.totpPending, totpEnabled: true, totpLast: step }); delete req.user.totpPending; store.save();
    store.audit(req.user.username, '2FA activée', req.ip); res.json({ ok: true, user: userView(req.user) });
  });
  admin.post('/2fa/disable', (req, res) => {
    if (!sec.verifyPassword(String(req.body?.password || ''), req.user.hash)) throw bad('Mot de passe incorrect.');
    Object.assign(req.user, { totpEnabled: false, totpSecret: null, totpLast: 0 }); store.save();
    store.audit(req.user.username, '2FA désactivée', req.ip); res.json({ ok: true, user: userView(req.user) });
  });

  admin.get('/stats', (req, res) => {
    const d = store.db, week = Date.now() - 7 * 864e5;
    res.json({ products: d.products.length, visible: d.products.filter(p => p.visible).length,
      out: d.products.filter(p => p.stock === 'out').length, low: d.products.filter(p => p.stock === 'low').length,
      ordersNew: d.orders.filter(o => o.status === 'nouveau').length, ordersWeek: d.orders.filter(o => Date.parse(o.createdAt) > week).length,
      revenue: d.orders.filter(o => ['confirmé', 'livré'].includes(o.status)).reduce((s, o) => s + o.total, 0) });
  });

  const adminProduct = p => ({ ...p, img: imgUrl(p) });
  admin.get('/products', (req, res) => res.json(store.db.products.map(adminProduct)));
  admin.post('/products', (req, res) => {
    if (store.db.products.length >= 1000) throw bad('Limite de produits atteinte.');
    const p = cleanProduct(req.body || {}, { id: store.id(), createdAt: new Date().toISOString() });
    store.db.products.unshift(p); store.save(); store.audit(req.user.username, 'produit ajouté', req.ip, p.name); res.status(201).json(adminProduct(p));
  });
  const gc = () => { // supprime les photos plus utilisées par aucun produit
    const used = new Set(store.db.products.map(p => p.image).filter(Boolean));
    for (const f of fs.readdirSync(store.uploads)) if (IMG_RE.test(f) && !used.has(f)) fs.rmSync(path.join(store.uploads, f), { force: true });
  };
  admin.put('/products/:id', (req, res) => {
    const i = store.db.products.findIndex(p => p.id === req.params.id); if (i < 0) throw new HttpError(404, 'Produit introuvable.');
    const body = req.body || {}; if (body.image && !fs.existsSync(path.join(store.uploads, String(body.image)))) throw bad('Photo introuvable : renvoyez-la.');
    store.db.products[i] = cleanProduct(body, store.db.products[i]); store.save(); gc();
    store.audit(req.user.username, 'produit modifié', req.ip, store.db.products[i].name); res.json(adminProduct(store.db.products[i]));
  });
  admin.delete('/products/:id', (req, res) => {
    const i = store.db.products.findIndex(p => p.id === req.params.id); if (i < 0) throw new HttpError(404, 'Produit introuvable.');
    const [p] = store.db.products.splice(i, 1); store.save(); gc(); store.audit(req.user.username, 'produit supprimé', req.ip, p.name); res.json({ ok: true });
  });
  admin.post('/upload', limits.upload.middleware('envois de photos'), (req, res) => {
    const m = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.data || ''));
    if (!m) throw bad('Fichier image invalide.');
    const buf = Buffer.from(m[1], 'base64'); if (buf.length > 1_600_000) throw bad('Image trop lourde (max 1,5 Mo).');
    const ext = sniffImage(buf); if (!ext) throw bad('Format non reconnu (JPEG, PNG ou WebP uniquement).');
    const file = crypto.randomBytes(12).toString('hex') + '.' + ext;
    fs.writeFileSync(path.join(store.uploads, file), buf, { mode: 0o600 });
    res.status(201).json({ file, url: `/uploads/${file}` });
  });

  admin.get('/orders', (req, res) => res.json(store.db.orders));
  admin.patch('/orders/:id', (req, res) => {
    const o = store.db.orders.find(x => x.id === req.params.id); if (!o) throw new HttpError(404, 'Commande introuvable.');
    if (!STATUSES.includes(req.body?.status)) throw bad('Statut invalide.');
    o.status = req.body.status; store.save(); store.audit(req.user.username, 'commande ' + o.id, req.ip, o.status); res.json(o);
  });
  admin.delete('/orders/:id', (req, res) => {
    const i = store.db.orders.findIndex(x => x.id === req.params.id); if (i < 0) throw new HttpError(404, 'Commande introuvable.');
    store.db.orders.splice(i, 1); store.save(); store.audit(req.user.username, 'commande supprimée', req.ip, req.params.id); res.json({ ok: true });
  });

  admin.get('/settings', (req, res) => res.json(store.db.settings));
  admin.put('/settings', (req, res) => {
    const b = req.body || {}; const whatsapp = normalizePhone(b.whatsapp); if (!whatsapp) throw bad('Numéro WhatsApp invalide.');
    const phone2 = b.phone2 ? normalizePhone(b.phone2) : ''; if (b.phone2 && !phone2) throw bad('Second numéro invalide.');
    const phone3 = b.phone3 ? normalizePhone(b.phone3) : ''; if (b.phone3 && !phone3) throw bad('Troisième numéro invalide.');
    const faq = (Array.isArray(b.faq) ? b.faq : []).slice(0, 20).map(f => ({ q: clean(f?.q, 200), a: cleanMultiline(f?.a, 800) })).filter(f => f.q && f.a);
    const shopName = clean(b.shopName, 60); if (shopName.length < 2) throw bad('Nom de la boutique obligatoire.');
    store.db.settings = { shopName, tagline: clean(b.tagline, 120), place: clean(b.place, 120), address: clean(b.address, 200), whatsapp, phone2, phone3,
      announcement: clean(b.announcement, 220), hours: clean(b.hours, 120), faq };
    store.save(); store.audit(req.user.username, 'réglages modifiés', req.ip); res.json(store.db.settings);
  });
  admin.get('/audit', (req, res) => res.json(store.db.audit.slice(0, 100)));
  admin.use((req, res, next) => next(new HttpError(404, 'Introuvable.')));

  // ---------- Erreurs : jamais de trace technique côté client ----------
  app.use('/api', (req, res, next) => next(new HttpError(404, 'Introuvable.')));
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    const status = err.status && err.status < 600 ? err.status : (err.type === 'entity.too.large' ? 413 : 500);
    if (status >= 500) console.error('[erreur]', err);
    const msg = status === 413 ? 'Données trop volumineuses.' : status === 400 && err.type ? 'Requête illisible.' : status >= 500 ? 'Erreur du serveur.' : err.message;
    if (req.path.startsWith('/api')) return res.status(status).json({ error: msg, ...(err.extra || {}) });
    res.status(status).type('text/plain').send(status === 404 ? 'Page introuvable.' : msg);
  });
  app.use((req, res) => res.status(404).type('text/plain').send('Page introuvable.'));

  return { app, store, bootstrapNote };
}

module.exports = { createApp };
if (require.main === module) {
  const { app } = createApp();
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Kamissoko & Frères — boutique en ligne sur le port ${port}`));
}
