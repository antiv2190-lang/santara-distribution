'use strict';
const crypto = require('crypto');

// ---------- Mots de passe : scrypt (mémoire-dur), sel unique, comparaison à temps constant ----------
const N = 1 << 15, R = 8, P = 1, KEYLEN = 64;
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, KEYLEN, { N, r: R, p: P, maxmem: 128 * 1024 * 1024 });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}
function verifyPassword(pw, stored) {
  try {
    const [alg, n, r, p, salt, hash] = stored.split('$');
    if (alg !== 'scrypt') return false;
    const expected = Buffer.from(hash, 'base64');
    const got = crypto.scryptSync(pw, Buffer.from(salt, 'base64'), expected.length,
      { N: +n, r: +r, p: +p, maxmem: 128 * 1024 * 1024 });
    return crypto.timingSafeEqual(got, expected);
  } catch { return false; }
}
// Hash factice : on fait le même travail même si l'utilisateur n'existe pas (évite de révéler les comptes par le temps de réponse).
const DUMMY_HASH = hashPassword(crypto.randomBytes(12).toString('hex'));

const COMMON = ['motdepasse', 'password', '123456', 'azerty', 'qwerty', 'kamissoko', 'kamisoko', 'bamako', 'mali2024', 'admin'];
function passwordProblem(pw, username) {
  if (typeof pw !== 'string') return 'Mot de passe invalide.';
  if (pw.length < 12) return 'Le mot de passe doit contenir au moins 12 caractères.';
  if (pw.length > 200) return 'Mot de passe trop long.';
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter(r => r.test(pw)).length;
  if (classes < 3) return 'Mélangez au moins 3 types de caractères : minuscules, MAJUSCULES, chiffres, symboles.';
  const low = pw.toLowerCase();
  if (COMMON.some(w => low.includes(w)) || (username && low.includes(String(username).toLowerCase())))
    return 'Mot de passe trop prévisible (nom de la boutique, « password », etc.).';
  if (/^(.)\1+$/.test(pw)) return 'Mot de passe trop prévisible.';
  return null;
}
function randomPassword() {
  const sets = ['abcdefghjkmnpqrstuvwxyz', 'ABCDEFGHJKLMNPQRSTUVWXYZ', '23456789', '!@#$%&*?-_'];
  const all = sets.join('');
  const out = sets.map(s => s[crypto.randomInt(s.length)]);
  while (out.length < 20) out.push(all[crypto.randomInt(all.length)]);
  for (let i = out.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [out[i], out[j]] = [out[j], out[i]]; }
  return out.join('');
}

// ---------- 2FA TOTP (RFC 6238) — compatible Google Authenticator, Microsoft Authenticator, Authy ----------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32(buf) {
  let bits = '', out = '';
  for (const b of buf) bits += b.toString(2).padStart(8, '0');
  for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  return out;
}
function unbase32(s) {
  let bits = '';
  for (const ch of s.replace(/=+$/, '')) bits += B32.indexOf(ch).toString(2).padStart(5, '0');
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
function totpAt(secret, counter) {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', unbase32(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const code = ((h[o] & 0x7f) << 24 | h[o + 1] << 16 | h[o + 2] << 8 | h[o + 3]) % 1e6;
  return String(code).padStart(6, '0');
}
function totpVerify(secret, code, now = Date.now()) {
  if (!/^\d{6}$/.test(String(code || ''))) return null;
  const step = Math.floor(now / 30000);
  for (const d of [-1, 0, 1]) {
    const exp = totpAt(secret, step + d);
    if (crypto.timingSafeEqual(Buffer.from(exp), Buffer.from(String(code)))) return step + d; // pas de rejeu : on renvoie le pas utilisé
  }
  return null;
}
const newTotpSecret = () => base32(crypto.randomBytes(20));

// ---------- Limiteur de débit (fenêtre glissante, en mémoire) ----------
class RateLimiter {
  constructor(max, windowMs) { this.max = max; this.win = windowMs; this.hits = new Map(); setInterval(() => this.gc(), 60000).unref(); }
  gc() { const now = Date.now(); for (const [k, v] of this.hits) { const f = v.filter(t => now - t < this.win); f.length ? this.hits.set(k, f) : this.hits.delete(k); } }
  take(key) {
    const now = Date.now(); const arr = (this.hits.get(key) || []).filter(t => now - t < this.win);
    if (arr.length >= this.max) { this.hits.set(key, arr); return { ok: false, retryMs: this.win - (now - arr[0]) }; }
    arr.push(now); this.hits.set(key, arr); return { ok: true };
  }
  middleware(name = 'trop de requêtes') {
    return (req, res, next) => {
      const r = this.take(req.ip);
      if (r.ok) return next();
      res.set('Retry-After', String(Math.ceil(r.retryMs / 1000)));
      res.status(429).json({ error: `Trop de tentatives (${name}). Réessayez dans quelques minutes.` });
    };
  }
}

// ---------- Sessions : jeton aléatoire 256 bits, seul son hash SHA-256 est gardé côté serveur ----------
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
class Sessions {
  constructor({ idleMs = 30 * 60 * 1000, absMs = 8 * 60 * 60 * 1000 } = {}) {
    this.map = new Map(); this.idleMs = idleMs; this.absMs = absMs;
    setInterval(() => { const n = Date.now(); for (const [k, s] of this.map) if (this.expired(s, n)) this.map.delete(k); }, 60000).unref();
  }
  expired(s, n = Date.now()) { return n - s.last > this.idleMs || n - s.created > this.absMs; }
  create(userId) {
    const token = crypto.randomBytes(32).toString('base64url');
    const csrf = crypto.randomBytes(24).toString('base64url');
    const now = Date.now();
    this.map.set(sha(token), { userId, csrf, created: now, last: now });
    return { token, csrf };
  }
  get(token) {
    if (!token || token.length > 100) return null;
    const k = sha(token); const s = this.map.get(k);
    if (!s) return null;
    if (this.expired(s)) { this.map.delete(k); return null; }
    s.last = Date.now(); return s;
  }
  destroy(token) { if (token) this.map.delete(sha(token)); }
  destroyUser(userId, exceptToken) {
    const keep = exceptToken ? sha(exceptToken) : null;
    for (const [k, s] of this.map) if (s.userId === userId && k !== keep) this.map.delete(k);
  }
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('='); if (i < 0) continue;
    const k = part.slice(0, i).trim(); const v = part.slice(i + 1).trim();
    try { out[k] = decodeURIComponent(v); } catch { /* cookie illisible : ignoré */ }
  }
  return out;
}

const safeEqual = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

module.exports = { hashPassword, verifyPassword, DUMMY_HASH, passwordProblem, randomPassword,
  newTotpSecret, totpVerify, RateLimiter, Sessions, parseCookies, safeEqual, sha };
