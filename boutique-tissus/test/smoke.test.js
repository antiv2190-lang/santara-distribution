// Test de bout en bout (mode démo, sans Supabase) : lance le serveur, crée une boutique,
// publie un tissu, vérifie le traitement IA (API Claude simulée) et la RÈGLE ABSOLUE sur les couleurs.
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const PORT = 4100 + Math.floor(Math.random() * 500);
const FAKE = PORT + 1000;
const BASE = `http://localhost:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tissus-'));
let seenAiRequest = null;

// Faux serveur Anthropic : renvoie une réponse au bon format et mémorise la requête reçue.
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    seenAiRequest = { url: req.url, body: JSON.parse(body) };
    const out = { name: 'Basin riche brodé bleu royal', category: 'basin', description: 'Un basin riche à la texture soyeuse. Idéal pour le mariage et la Tabaski.' };
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_sequence: null,
      content: [{ type: 'text', text: JSON.stringify(out) }], usage: { input_tokens: 10, output_tokens: 10 } }));
  });
}).listen(FAKE);

const j = (cookie, extra = {}) => ({ headers: { ...(cookie ? { cookie } : {}), ...(extra.headers || {}) }, ...extra });
async function call(method, url, { cookie, json, body, headers } = {}) {
  const r = await fetch(BASE + url, { method, headers: { ...(json ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...(headers || {}) }, body: json ? JSON.stringify(json) : body, redirect: 'manual' });
  const text = await r.text();
  let data = null; try { data = JSON.parse(text); } catch { /* html */ }
  return { status: r.status, data, text, headers: r.headers };
}
const cookieOf = (r) => (r.headers.get('set-cookie') || '').split(';')[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (name) => console.log('  ✓ ' + name);

// Tissu de test : rayures saturées (bleu royal / or) — on vérifiera que leur teinte ne bouge pas.
async function fabricJpeg(dark) {
  const w = 900, h = 700;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${Array.from({ length: 18 }, (_, i) =>
    `<rect x="${i * 50}" width="50" height="${h}" fill="${i % 2 ? '#c9a227' : '#1f3fae'}"/>`).join('')}</svg>`;
  let img = sharp(Buffer.from(svg));
  if (dark) img = img.modulate({ brightness: 0.55 }); // photo sous-exposée -> la correction de lumière doit agir
  return img.jpeg({ quality: 92 }).toBuffer();
}
const { colorSignature, colorDrift } = require('../lib/ai/color');

(async () => {
  const srv = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT, SESSION_SECRET: 'test-secret', SUPERADMIN_CODE: 'super-test', DATA_DIR: dataDir,
    ANTHROPIC_API_KEY: 'sk-test', ANTHROPIC_BASE_URL: `http://localhost:${FAKE}`, SUPABASE_URL: '', SUPABASE_SERVICE_KEY: '', DEFAULT_SHOP: 'demo' }, stdio: ['ignore', 'pipe', 'pipe'] });
  srv.stderr.on('data', (d) => process.stderr.write(d));
  let up = false; for (let i = 0; i < 60 && !up; i++) { await sleep(150); up = await fetch(BASE + '/robots.txt').then((r) => r.ok).catch(() => false); }
  assert(up, 'le serveur ne démarre pas');
  let failed = false;
  try {
    console.log('Super-admin');
    assert.strictEqual((await call('GET', '/api/super/shops')).status, 401); ok('refusé sans connexion');
    assert.strictEqual((await call('POST', '/api/super/login', { json: { code: 'faux' } })).status, 401); ok('mauvais code refusé');
    const sl = await call('POST', '/api/super/login', { json: { code: 'super-test' } });
    const sc = cookieOf(sl); assert(sc.startsWith('tissus_super=')); ok('connexion');
    const bad = await call('POST', '/api/super/shops', { cookie: sc, json: { name: 'X', slug: 'api', whatsapp: '70000000', sale_unit: 'metre', color_primary: '#000000', color_accent: '#c9a227', admin_phone: '70111111', admin_pin: '1234' } });
    assert.strictEqual(bad.status, 400); ok('adresse réservée refusée');
    const mk = (slug, phone) => call('POST', '/api/super/shops', { cookie: sc, json: { name: 'Tissus Démo', slug, city: 'Bamako', whatsapp: '+223 70 00 00 00', sale_unit: 'metre', color_primary: '#0b0b0b', color_accent: '#c9a227', admin_phone: phone, admin_pin: '4321' } });
    const s1 = await mk('demo', '+223 76 11 11 11'); assert.strictEqual(s1.status, 201, s1.text); assert.strictEqual(s1.data.whatsapp, '22370000000'); ok('boutique créée (numéro normalisé)');
    assert.strictEqual((await mk('demo', '76222222')).status, 409); ok('adresse en double refusée');
    const s2 = await mk('autre', '76333333'); assert.strictEqual(s2.status, 201);
    const logo = await sharp({ create: { width: 200, height: 200, channels: 4, background: '#c9a227' } }).png().toBuffer();
    const lg = await call('POST', `/api/super/shops/${s1.data.id}/logo`, { cookie: sc, body: logo, headers: { 'content-type': 'image/png' } });
    assert.strictEqual(lg.status, 200); assert(lg.data.logo_url); ok('logo envoyé');

    console.log('Pages & PWA');
    const home = await call('GET', '/demo'); assert(home.text.includes('manifest.webmanifest') && home.text.includes('--primary:#0b0b0b')); ok('vitrine avec thème de la boutique');
    assert.strictEqual((await call('GET', '/')).status, 302); ok('/ -> boutique par défaut');
    assert.strictEqual((await call('GET', '/admin')).headers.get('location'), '/demo/admin'); ok('/admin -> /demo/admin');
    assert.strictEqual((await call('GET', '/nimporte')).status, 404); ok('boutique inconnue = 404');
    const man = await call('GET', '/demo/admin/manifest.webmanifest'); assert.strictEqual(man.data.start_url, '/demo/admin'); assert.strictEqual(man.data.display, 'standalone'); ok('manifeste PWA admin');
    const ic = await fetch(BASE + '/demo/icon-192.png'); assert.strictEqual((await sharp(Buffer.from(await ic.arrayBuffer())).metadata()).width, 192); ok('icône PWA générée');
    assert((await call('GET', '/sw.js')).text.includes('fetch')); ok('service worker servi');
    assert.strictEqual((await call('GET', '/super-admin')).status, 200); ok('page super-admin');

    console.log('Espace propriétaire');
    assert.strictEqual((await call('GET', '/api/admin/products')).status, 401); ok('refusé sans connexion');
    assert.strictEqual((await call('POST', '/api/admin/login', { json: { slug: 'demo', phone: '76111111', pin: '0000' } })).status, 401); ok('mauvais code refusé');
    const al = await call('POST', '/api/admin/login', { json: { slug: 'demo', phone: '+223 76 11 11 11', pin: '4321' } });
    assert.strictEqual(al.status, 200); const ac = cookieOf(al); ok('connexion (téléphone + code)');
    assert((al.headers.get('set-cookie') || '').includes('HttpOnly')); ok('cookie HttpOnly');
    const al2 = await call('POST', '/api/admin/login', { json: { slug: 'autre', phone: '76333333', pin: '4321' } }); const ac2 = cookieOf(al2);

    console.log('Connexion par code reçu sur le téléphone');
    const unk = await call('POST', '/api/admin/otp/request', { json: { slug: 'demo', phone: '70 99 99 99' } });
    assert.strictEqual(unk.status, 200); assert(!unk.data.dev_code); ok('numéro inconnu : même réponse, aucun code (pas de fuite)');
    const rq = await call('POST', '/api/admin/otp/request', { json: { slug: 'demo', phone: '+223 76 11 11 11' } });
    assert.strictEqual(rq.status, 200); assert(/^\d{6}$/.test(rq.data.dev_code)); ok('code à 6 chiffres envoyé (affiché en mode démo)');
    assert.strictEqual((await call('POST', '/api/admin/otp/request', { json: { slug: 'demo', phone: '76111111' } })).status, 429); ok('2e envoi immédiat refusé (30 s)');
    assert.strictEqual((await call('POST', '/api/admin/otp/verify', { json: { slug: 'demo', phone: '76111111', code: rq.data.dev_code === '000000' ? '111111' : '000000' } })).status, 401); ok('mauvais code refusé');
    const vf = await call('POST', '/api/admin/otp/verify', { json: { slug: 'demo', phone: '76111111', code: rq.data.dev_code } });
    assert.strictEqual(vf.status, 200); const oc = cookieOf(vf);
    assert.strictEqual((await call('GET', '/api/admin/me', { cookie: oc })).status, 200); ok('bon code : connecté');
    assert.strictEqual((await call('POST', '/api/admin/otp/verify', { json: { slug: 'demo', phone: '76111111', code: rq.data.dev_code } })).status, 401); ok('un code ne sert qu\'une fois');

    const photo = await fabricJpeg(true);
    assert.strictEqual((await call('POST', '/api/admin/products?price=0', { cookie: ac, body: photo, headers: { 'content-type': 'image/jpeg' } })).status, 400); ok('prix 0 refusé');
    assert.strictEqual((await call('POST', '/api/admin/products?price=1000', { cookie: ac, body: Buffer.from('pas une image'.repeat(60)), headers: { 'content-type': 'image/jpeg' } })).status, 400); ok('fichier non-image refusé');
    const t0 = Date.now();
    const cr = await call('POST', '/api/admin/products?price=15000&cid=abc-123', { cookie: ac, body: photo, headers: { 'content-type': 'image/jpeg' } });
    assert.strictEqual(cr.status, 201, cr.text); const id = cr.data.id; ok(`publication immédiate (${Date.now() - t0} ms, IA en arrière-plan)`);
    const dup = await call('POST', '/api/admin/products?price=15000&cid=abc-123', { cookie: ac, body: photo, headers: { 'content-type': 'image/jpeg' } });
    assert.strictEqual(dup.data.id, id); ok('renvoi du même envoi = pas de doublon');

    let p; for (let i = 0; i < 60; i++) { await sleep(250); p = (await call('GET', `/api/admin/products/${id}`, { cookie: ac })).data; if (p.ai_status === 'done' || p.ai_status === 'failed') break; }
    assert.strictEqual(p.ai_status, 'done', JSON.stringify(p)); ok('traitement IA terminé en arrière-plan');
    assert.strictEqual(p.name, 'Basin riche brodé bleu royal'); assert.strictEqual(p.category, 'basin'); assert(p.description.length > 20); assert.strictEqual(p.reviewed, false); ok('nom + catégorie + description générés, produit « à vérifier »');
    const msg = seenAiRequest.body.messages[0].content;
    assert(msg.some((b) => b.type === 'image' && b.source.type === 'base64') && seenAiRequest.body.output_config.format.type === 'json_schema'); ok('requête Claude : image + sortie JSON structurée');

    console.log('Règle absolue : photo');
    assert(p.original && p.image && p.image !== p.original); ok('photo originale ET améliorée disponibles');
    const orig = Buffer.from(await (await fetch(BASE + p.original)).arrayBuffer());
    assert(orig.equals(photo)); ok('photo originale conservée octet pour octet');
    const enh = Buffer.from(await (await fetch(BASE + p.image)).arrayBuffer());
    const em = await sharp(enh).metadata(); assert.strictEqual(em.width, 1200);
    // Zones « tissu » : bande bleue puis bande or, avant/après (la photo améliorée centre le tissu sur un fond)
    const centerLeft = Math.round((1200 - 1032) / 2), centerTop = Math.round((1200 - 802) / 2);
    const stripe = (i) => ({ ref: { left: i * 50 + 10, top: 20, width: 30, height: 600 }, enh: { left: centerLeft + Math.round((i * 50 + 10) * 1.1467), top: centerTop + 40, width: 34, height: 600 } });
    for (const [name, i] of [['bleue', 0], ['or', 1]]) {
      const z = stripe(i);
      const d = colorDrift(await colorSignature(photo, z.ref), await colorSignature(enh, z.enh));
      assert(d < 4, `couleur ${name} modifiée : ΔE(ab)=${d.toFixed(2)}`); ok(`couleur ${name} du tissu inchangée (ΔE a*b* = ${d.toFixed(2)} < 4)`);
    }
    const lumRef = (await sharp(photo).stats()).channels[0].mean, lumEnh = (await sharp(enh).extract({ left: centerLeft + 10, top: centerTop + 30, width: 800, height: 600 }).stats()).channels[0].mean;
    assert(lumEnh > lumRef); ok(`lumière corrigée (photo sombre éclaircie : ${lumRef.toFixed(0)} -> ${lumEnh.toFixed(0)})`);

    console.log('Vitrine publique');
    const list = await call('GET', '/api/shops/demo/products'); assert.strictEqual(list.data.total, 1);
    assert(!('ai_error' in list.data.items[0]) && !('reviewed' in list.data.items[0])); ok('liste publique sans champs internes');
    assert.strictEqual((await call('GET', '/api/shops/demo/products?cat=wax')).data.total, 0); ok('filtre catégorie');
    const cats = (await call('GET', '/api/shops/demo/categories')).data; assert.strictEqual(cats.total, 1); assert.strictEqual(cats.counts.basin, 1); assert.strictEqual(cats.counts.wax, 0); ok('rubriques : seulement celles qui ont des tissus');
    assert.strictEqual((await call('GET', '/api/shops/demo/products?q=bleu')).data.total, 1); ok('recherche par nom');
    assert.strictEqual((await call('GET', '/api/shops/demo/products?q=zzz')).data.total, 0);
    assert.strictEqual((await call('GET', '/api/shops/autre/products')).data.total, 0); ok('isolation entre boutiques');
    const pg = await call('GET', `/demo/p/${id}`); assert(pg.text.includes('og:title') && pg.text.includes('Basin riche brodé bleu royal') && pg.text.includes('og:image')); ok('fiche produit : balises de partage (aperçu WhatsApp/Facebook)');
    assert.strictEqual((await call('GET', `/api/shops/autre/products/${id}`)).status, 404); ok('produit invisible depuis une autre boutique');

    console.log('Sécurité multi-boutiques');
    assert.strictEqual((await call('PATCH', `/api/admin/products/${id}`, { cookie: ac2, json: { price: 1 } })).status, 404);
    assert.strictEqual((await call('DELETE', `/api/admin/products/${id}`, { cookie: ac2 })).status, 404); ok('un propriétaire ne peut pas toucher une autre boutique');
    assert.strictEqual((await call('POST', '/api/admin/products?price=5', { cookie: ac, body: photo, headers: { 'content-type': 'image/jpeg', origin: 'http://evil.example' } })).status, 403); ok('requête venant d\'un autre site refusée');

    console.log('Actions du propriétaire');
    assert.strictEqual((await call('GET', '/api/admin/stats', { cookie: ac })).data.review, 1);
    assert.strictEqual((await call('PATCH', `/api/admin/products/${id}`, { cookie: ac, json: { reviewed: true } })).data.reviewed, true); ok('valider en un clic');
    assert.strictEqual((await call('GET', '/api/admin/stats', { cookie: ac })).data.review, 0);
    assert.strictEqual((await call('PATCH', `/api/admin/products/${id}`, { cookie: ac, json: { sold_out: true } })).data.sold_out, true);
    assert.strictEqual((await call('GET', '/api/shops/demo/products')).data.items[0].sold_out, true); ok('épuisé / disponible');
    assert.strictEqual((await call('PATCH', `/api/admin/products/${id}`, { cookie: ac, json: { price: 20000, name: 'Basin royal', category: 'bazin' } })).data.price, 20000); ok('modifier prix / nom / catégorie');
    assert.strictEqual((await call('PATCH', `/api/admin/products/${id}`, { cookie: ac, json: { price: -5 } })).status, 400); ok('prix invalide refusé');
    const oldImg = p.image;
    assert.strictEqual((await call('DELETE', `/api/admin/products/${id}`, { cookie: ac })).status, 200);
    assert.strictEqual((await call('GET', '/api/shops/demo/products')).data.total, 0);
    assert.strictEqual((await fetch(BASE + oldImg)).status, 404); ok('supprimer (fiche + photos)');

    console.log('Option « IA automatique »');
    const waitFor = async (pid, pred) => { let q; for (let i = 0; i < 60; i++) { await sleep(200); q = (await call('GET', `/api/admin/products/${pid}`, { cookie: ac })).data; if (pred(q)) return q; } throw new Error('délai dépassé : ' + JSON.stringify(q)); };
    assert.strictEqual((await call('GET', '/api/admin/me', { cookie: ac })).data.settings.ai_auto, true); ok('IA automatique activée par défaut');
    assert.strictEqual((await call('PATCH', '/api/admin/settings', { cookie: ac, json: { ai_auto: false } })).data.settings.ai_auto, false); ok('le propriétaire la désactive');
    seenAiRequest = null;
    const np = await call('POST', '/api/admin/products?price=9000&cid=sans-ia', { cookie: ac, body: await fabricJpeg(false), headers: { 'content-type': 'image/jpeg' } });
    const q1 = await waitFor(np.data.id, (q) => q.ai_status === 'done');
    assert.strictEqual(seenAiRequest, null); assert.strictEqual(q1.ai_done, false); assert.strictEqual(q1.name, 'Nouveau tissu'); assert.strictEqual(q1.image, q1.original); ok('IA désactivée : publié tel quel, aucun appel IA, photo d\'origine');
    assert.strictEqual((await call('GET', '/api/shops/demo/products')).data.total, 1); ok('le produit est quand même visible dans la vitrine');
    await call('POST', `/api/admin/products/${np.data.id}/reprocess`, { cookie: ac });
    const q2 = await waitFor(np.data.id, (q) => q.ai_done && q.ai_status === 'done');
    assert(seenAiRequest); assert.strictEqual(q2.name, 'Basin riche brodé bleu royal'); assert(q2.image !== q2.original); ok('« Embellir avec l\'IA » : traitement à la demande (nom + photo)');
    await call('PATCH', '/api/admin/settings', { cookie: ac, json: { ai_auto: true } });
    await call('DELETE', `/api/admin/products/${np.data.id}`, { cookie: ac });

    console.log('\nTOUS LES TESTS PASSENT');
  } catch (e) { failed = true; console.error('\nÉCHEC :', e.message); if (e.stack) console.error(e.stack.split('\n').slice(1, 4).join('\n')); }
  srv.kill(); fake.close(); fs.rmSync(dataDir, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
})();
