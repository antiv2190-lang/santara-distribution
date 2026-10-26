// Petits utilitaires partagés par le serveur.

// Mots qui ne peuvent pas servir d'adresse de boutique (routes du site).
const RESERVED_SLUGS = new Set([
  'admin', 'super-admin', 'api', 'static', 'files', 'sw.js', 'favicon.ico',
  'robots.txt', 'manifest.webmanifest', 's', 'p', 'img', 'assets', 'public',
]);

const CATEGORIES = ['broderie', 'bazin', 'drap', 'rideau', 'dentelle', 'basin', 'wax', 'autre'];
const SALE_UNITS = ['metre', 'piece', 'lot'];

const isSlug = (s) => typeof s === 'string' && /^[a-z0-9](?:[a-z0-9-]{0,28}[a-z0-9])?$/.test(s) && !RESERVED_SLUGS.has(s);
const isHexColor = (s) => typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s);

// « +223 70 12 34 56 » -> « 22370123456 » ; un numéro à 8 chiffres reçoit l'indicatif du Mali.
function normalizePhone(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 8) d = '223' + d;
  return d;
}
const isPhone = (d) => /^\d{8,15}$/.test(d);

// Numéro pour la connexion : on compare sur les 8 derniers chiffres (ignore l'indicatif).
const loginKey = (raw) => String(raw || '').replace(/\D/g, '').slice(-8);

const clampStr = (s, max) => String(s ?? '').trim().slice(0, max);

// Luminance relative -> couleur de texte lisible (noir/blanc) sur un fond donné.
function onColor(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? '#111111' : '#ffffff';
}

const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// JSON sûr à injecter dans une balise <script>.
const safeJson = (o) => JSON.stringify(o).replace(/</g, '\\u003c').replace(/\u2028|\u2029/g, '');

module.exports = {
  RESERVED_SLUGS, CATEGORIES, SALE_UNITS,
  isSlug, isHexColor, normalizePhone, isPhone, loginKey, clampStr, onColor, escapeHtml, safeJson,
};
