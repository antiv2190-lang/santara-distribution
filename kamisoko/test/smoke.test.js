'use strict';
// Tests de bout en bout : sécurité de l'authentification, validation, prix, uploads, en-têtes.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { createApp } = require('../server');
const sec = require('../lib/security');

let server, base, jar = '', csrf = '';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-'));
const TEMP_PW = 'Temp-Passw0rd-Test!', NEW_PW = 'Une phrase tres longue 2026!';

async function call(method, url, body, { cookie = jar, token = csrf, headers = {} } = {}) {
  const r = await fetch(base + url, { method, redirect: 'manual', headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(token ? { 'X-CSRF-Token': token } : {}), ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* pas du JSON */ }
  return { status: r.status, json, text, headers: r.headers };
}
const grabCookie = r => (r.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ');

test.before(async () => {
  const { app } = createApp({ dataDir: dir, adminUser: 'boss', adminPassword: TEMP_PW, quiet: true, loginMax: 1000, orderMax: 1000, globalMax: 100000 });
  await new Promise(r => { server = app.listen(0, '127.0.0.1', r); }); base = 'http://127.0.0.1:' + server.address().port;
});
test.after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('en-têtes de sécurité et fichiers sensibles inaccessibles', async () => {
  const r = await call('GET', '/'); assert.equal(r.status, 200);
  const csp = r.headers.get('content-security-policy'); assert.match(csp, /script-src 'self'/); assert.match(csp, /frame-ancestors 'none'/); assert.doesNotMatch(csp, /unsafe-inline/);
  assert.equal(r.headers.get('x-powered-by'), null); assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  for (const p of ['/data/db.json', '/db.json', '/../server.js', '/%2e%2e/server.js', '/uploads/../db.json', '/lib/security.js', '/.env', '/package.json']) { const x = await call('GET', p); assert.ok([404, 400].includes(x.status), p + ' => ' + x.status); assert.doesNotMatch(x.text, /scrypt|hash/); }
});

test('catalogue public : produits visibles, aucun secret', async () => {
  const r = await call('GET', '/api/catalog'); assert.equal(r.status, 200); assert.ok(r.json.products.length >= 10);
  assert.doesNotMatch(r.text, /hash|totp|password/i); assert.ok(r.json.products.every(p => p.img.startsWith('/img/garment/') || p.img.startsWith('/uploads/')));
  const svg = await call('GET', r.json.products[0].img); assert.match(svg.headers.get('content-type'), /svg/); assert.match(svg.text, /<svg/);
  assert.equal((await call('GET', '/img/garment/evil.svg')).status, 404);
  assert.doesNotMatch((await call('GET', '/img/garment/jeans.svg?c=%22onload=alert(1)')).text, /onload/);
});

test('API admin refusée sans session', async () => {
  for (const [m, u] of [['GET', '/api/admin/products'], ['GET', '/api/admin/orders'], ['PUT', '/api/admin/settings'], ['POST', '/api/admin/upload'], ['GET', '/api/admin/audit']]) assert.equal((await call(m, u, m === 'GET' ? undefined : {}, { cookie: '', token: '' })).status, 401, u);
});

test('connexion : mauvais mot de passe, verrouillage après 5 essais', async () => {
  for (let i = 0; i < 5; i++) { const r = await call('POST', '/api/admin/login', { username: 'boss', password: 'mauvais' + i }, { cookie: '', token: '' }); assert.equal(r.status, 401); assert.equal(r.json.error.includes('boss'), false); }
  const locked = await call('POST', '/api/admin/login', { username: 'boss', password: TEMP_PW }, { cookie: '', token: '' });
  assert.equal(locked.status, 401, 'le bon mot de passe est refusé pendant le verrouillage');
  const unknown = await call('POST', '/api/admin/login', { username: 'inconnu', password: 'x' }, { cookie: '', token: '' });
  assert.equal(unknown.json.error, locked.json.error, 'même message : pas de fuite sur l’existence du compte');
});

test('première connexion → changement obligatoire → accès', async () => {
  // le verrouillage ci-dessus concerne "boss" : on le lève en redémarrant l'app sur les mêmes données
  server.close(); const { app } = createApp({ dataDir: dir, quiet: true, loginMax: 1000, orderMax: 1000, globalMax: 100000 });
  await new Promise(r => { server = app.listen(0, '127.0.0.1', r); }); base = 'http://127.0.0.1:' + server.address().port;
  const l = await call('POST', '/api/admin/login', { username: 'Boss ', password: TEMP_PW }, { cookie: '', token: '' }); assert.equal(l.status, 200);
  assert.equal(l.json.user.mustChange, true); jar = grabCookie(l); csrf = l.json.csrf;
  const sc = l.headers.getSetCookie().join(';'); assert.match(sc, /HttpOnly/i); assert.match(sc, /SameSite=Strict/i);
  const blocked = await call('GET', '/api/admin/products'); assert.equal(blocked.status, 403); assert.equal(blocked.json.mustChange, true);
  assert.equal((await call('POST', '/api/admin/password', { current: TEMP_PW, next: 'court' })).status, 400);
  assert.equal((await call('POST', '/api/admin/password', { current: TEMP_PW, next: 'boss-Boss-1234' })).status, 400, 'contient l’identifiant');
  assert.equal((await call('POST', '/api/admin/password', { current: 'faux', next: NEW_PW })).status, 400);
  const ch = await call('POST', '/api/admin/password', { current: TEMP_PW, next: NEW_PW }); assert.equal(ch.status, 200);
  const old = jar; jar = grabCookie(ch) || jar; csrf = ch.json.csrf;
  assert.equal((await call('GET', '/api/admin/products', undefined, { cookie: old })).status, 401, 'l’ancienne session est coupée');
  assert.equal((await call('GET', '/api/admin/products')).status, 200);
});

test('CSRF, origine et type de contenu', async () => {
  assert.equal((await call('POST', '/api/admin/products', {}, { token: '' })).status, 403);
  assert.equal((await call('POST', '/api/admin/products', {}, { token: 'faux' })).status, 403);
  assert.equal((await call('POST', '/api/admin/products', {}, { headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await call('POST', '/api/admin/products', {}, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  const r = await fetch(base + '/api/admin/products', { method: 'POST', headers: { Cookie: jar, 'X-CSRF-Token': csrf, 'Content-Type': 'text/plain' }, body: '{}' }); assert.equal(r.status, 415);
});

const prod = o => ({ name: 'Jean test', category: 'jeans', garment: 'jeans', priceRetail: 10000, priceWholesale: 7000, wholesaleMin: 5, colors: ['Noir'], sizes: ['40', '42'], description: 'ok', stock: 'in', featured: false, visible: true, ...o });
let pid;
test('produits : création, validation, XSS neutralisé', async () => {
  const x = await call('POST', '/api/admin/products', prod({ name: '<img src=x onerror=alert(1)>Jean', description: '<script>alert(1)</script>' })); assert.equal(x.status, 201);
  assert.doesNotMatch(JSON.stringify(x.json), /[<>]/); pid = x.json.id;
  for (const bad of [{ priceWholesale: 20000 }, { priceRetail: -5 }, { wholesaleMin: 1 }, { category: 'hack' }, { name: '' }, { stock: 'x' }, { image: '../../etc/passwd' }])
    assert.equal((await call('POST', '/api/admin/products', prod(bad))).status, 400, JSON.stringify(bad));
  const cat = await call('GET', '/api/catalog'); assert.ok(cat.json.products.some(p => p.id === pid));
  assert.equal((await call('PUT', '/api/admin/products/' + pid, prod({ visible: false }))).status, 200);
  assert.ok(!(await call('GET', '/api/catalog')).json.products.some(p => p.id === pid), 'produit masqué absent du catalogue');
});

test('upload photo : magic bytes vérifiés', async () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(64)]);
  const ok = await call('POST', '/api/admin/upload', { data: 'data:image/png;base64,' + png.toString('base64') }); assert.equal(ok.status, 201); assert.match(ok.json.file, /^[a-f0-9]{24}\.png$/);
  const served = await call('GET', ok.json.url); assert.equal(served.status, 200); assert.equal(served.headers.get('content-type'), 'image/png'); assert.match(served.headers.get('content-security-policy'), /sandbox/);
  const fake = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  assert.equal((await call('POST', '/api/admin/upload', { data: 'data:image/png;base64,' + fake.toString('base64') })).status, 400, 'SVG déguisé en PNG refusé');
  assert.equal((await call('POST', '/api/admin/upload', { data: 'data:image/svg+xml;base64,' + fake.toString('base64') })).status, 400);
  assert.equal((await call('GET', '/uploads/..%2fdb.json')).status, 404);
});

test('commandes : prix recalculés côté serveur, validation, WhatsApp', async () => {
  await call('PUT', '/api/admin/products/' + pid, prod({ visible: true }));
  const o = (qty, extra = {}) => ({ name: 'Awa Traoré', phone: '76 00 11 22', city: 'Bamako', items: [{ id: pid, qty, size: '40', color: 'Noir', price: 1 }], ...extra });
  const retail = await call('POST', '/api/orders', o(2), { cookie: '', token: '' }); assert.equal(retail.status, 200); assert.equal(retail.json.total, 20000, 'prix client ignoré');
  const gros = await call('POST', '/api/orders', o(5), { cookie: '', token: '' }); assert.equal(gros.json.total, 35000);
  const url = new URL(gros.json.whatsappUrl); assert.equal(url.host, 'wa.me'); assert.equal(url.pathname, '/22376271472');
  assert.match(url.searchParams.get('text'), /prix de gros/); assert.match(url.searchParams.get('text'), /\+22376001122/);
  for (const bad of [o(0), o(-3), o(1.5), o(2, { phone: '12' }), o(2, { name: '' }), { ...o(1), items: [] }, { ...o(1), items: [{ id: 'nope', qty: 1 }] }, { ...o(1), items: [{ id: pid, qty: 1, size: '99', color: 'Noir' }] }, { ...o(1), items: [{ id: pid, qty: 1, size: '40', color: 'Rouge' }] }])
    assert.equal((await call('POST', '/api/orders', bad, { cookie: '', token: '' })).status, 400, JSON.stringify(bad).slice(0, 80));
  const bot = await call('POST', '/api/orders', o(2, { website: 'http://spam' }), { cookie: '', token: '' }); assert.equal(bot.json.whatsappUrl, null);
  const orders = await call('GET', '/api/admin/orders'); assert.equal(orders.json.length, 2, 'le pot de miel n’enregistre rien');
  assert.equal((await call('PATCH', '/api/admin/orders/' + orders.json[0].id, { status: 'livré' })).status, 200);
  assert.equal((await call('PATCH', '/api/admin/orders/' + orders.json[0].id, { status: 'hack' })).status, 400);
});

test('limiteur de commandes', async () => {
  const { RateLimiter } = sec; const rl = new RateLimiter(3, 1000); assert.ok([1, 2, 3].every(() => rl.take('a').ok)); assert.equal(rl.take('a').ok, false); assert.ok(rl.take('b').ok);
});

test('TOTP : vecteur RFC 6238 et double authentification de bout en bout', async () => {
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'; // "12345678901234567890"
  assert.notEqual(sec.totpVerify(secret, '287082', 59000), null, 'vecteur RFC 6238 (t=59s)'); assert.equal(sec.totpVerify(secret, '000000', 59000), null);
  const setup = await call('POST', '/api/admin/2fa/setup', {}); assert.equal(setup.status, 200);
  // on calcule le code courant avec la même fonction interne que le serveur
  const step = Math.floor(Date.now() / 30000);
  const mk = s => { const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(s)); const B = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = ''; for (const ch of setup.json.secret) bits += B.indexOf(ch).toString(2).padStart(5, '0'); const key = Buffer.from(bits.match(/.{8}/g).map(b => parseInt(b, 2))); const hh = crypto.createHmac('sha1', key).update(msg).digest(); const o = hh[19] & 15; return String(((hh[o] & 0x7f) << 24 | hh[o + 1] << 16 | hh[o + 2] << 8 | hh[o + 3]) % 1e6).padStart(6, '0'); };
  assert.equal((await call('POST', '/api/admin/2fa/enable', { code: '000000' })).status, 400);
  assert.equal((await call('POST', '/api/admin/2fa/enable', { code: mk(step) })).status, 200);
  const need = await call('POST', '/api/admin/login', { username: 'boss', password: NEW_PW }, { cookie: '', token: '' }); assert.equal(need.json.needOtp, true); assert.equal(grabCookie(need), '', 'pas de session sans code');
  assert.equal((await call('POST', '/api/admin/login', { username: 'boss', password: NEW_PW, otp: mk(step) }, { cookie: '', token: '' })).status, 401, 'code déjà utilisé : rejeu refusé');
  const ok = await call('POST', '/api/admin/login', { username: 'boss', password: NEW_PW, otp: mk(step + 1) }, { cookie: '', token: '' }); assert.equal(ok.status, 200);
});

test('déconnexion détruit la session', async () => {
  assert.equal((await call('POST', '/api/admin/logout', {})).status, 200); assert.equal((await call('GET', '/api/admin/products')).status, 401);
});

test('le mot de passe n’est jamais stocké en clair', () => {
  const raw = fs.readFileSync(path.join(dir, 'db.json'), 'utf8'); assert.doesNotMatch(raw, new RegExp(NEW_PW.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))); assert.doesNotMatch(raw, new RegExp(TEMP_PW)); assert.match(raw, /scrypt\$/);
  assert.equal(fs.statSync(path.join(dir, 'db.json')).mode & 0o077, 0, 'db.json non lisible par les autres');
});
