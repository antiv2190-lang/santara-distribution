// Authentification : codes secrets hachés (scrypt) + sessions signées (HMAC) dans un cookie.
// Aucune dépendance externe.
const crypto = require('crypto');
const config = require('./config');

// --- Secret de signature -------------------------------------------------
let SECRET = config.sessionSecret;
if (!SECRET) {
  if (config.isProd) {
    console.error('ERREUR : SESSION_SECRET est obligatoire en production.');
    process.exit(1);
  }
  SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('[auth] SESSION_SECRET absent : secret temporaire (les connexions sautent à chaque redémarrage).');
}

// --- Codes secrets -------------------------------------------------------
function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pin), salt, 32).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPin(pin, stored) {
  try {
    const [salt, hash] = String(stored).split(':');
    const test = crypto.scryptSync(String(pin), salt, 32);
    const ref = Buffer.from(hash, 'hex');
    return ref.length === test.length && crypto.timingSafeEqual(test, ref);
  } catch { return false; }
}
function safeEqual(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

// --- Jetons signés -------------------------------------------------------
const b64 = (buf) => Buffer.from(buf).toString('base64url');
function sign(payload, ttlSeconds) {
  const body = b64(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds }));
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function verify(token) {
  if (!token || typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const good = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.exp > Date.now() / 1000 ? p : null;
  } catch { return null; }
}

// --- Cookies -------------------------------------------------------------
function readCookie(req, name) {
  const h = req.headers.cookie || '';
  for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
function setCookie(req, res, name, value, maxAgeSec) {
  const secure = req.secure ? '; Secure' : '';
  res.append('Set-Cookie', `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSec}; HttpOnly; SameSite=Lax${secure}`);
}
const clearCookie = (req, res, name) => setCookie(req, res, name, '', 0);

// --- Limiteur de tentatives (anti-devinette du code) ----------------------
const fails = new Map(); // clé -> { n, until }
function lockedFor(key) {
  const f = fails.get(key);
  return f && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 60000) : 0;
}
function registerFail(key) {
  const f = fails.get(key) || { n: 0, until: 0 };
  f.n += 1;
  if (f.n >= 5) { f.until = Date.now() + 15 * 60 * 1000; f.n = 0; }
  fails.set(key, f);
}
const clearFails = (key) => fails.delete(key);

const hmac = (s) => crypto.createHmac('sha256', SECRET).update(String(s)).digest('hex');

module.exports = { hmac, hashPin, verifyPin, safeEqual, sign, verify, readCookie, setCookie, clearCookie, lockedFor, registerFail, clearFails };
