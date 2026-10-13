// Connexion du propriétaire par CODE REÇU SUR SON TÉLÉPHONE (6 chiffres, valable 5 minutes).
//
// Envoi du code (OTP_PROVIDER) :
//   console          : affiche le code dans les logs (développement / démo uniquement)
//   twilio-sms       : SMS via Twilio                       (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM)
//   twilio-whatsapp  : message WhatsApp via Twilio          (idem ; TWILIO_FROM = numéro WhatsApp Twilio)
//   webhook          : n'importe quelle passerelle (Orange SMS, WhatsApp Cloud API, n8n, Zapier...) :
//                      POST JSON {to, message, code, shop} sur OTP_WEBHOOK_URL (+ en-tête Bearer OTP_WEBHOOK_TOKEN)
//
// Sécurité : le code n'est jamais stocké en clair (HMAC), 5 essais maximum, 1 envoi / 30 s, 5 envois / heure,
// et la réponse est identique que le numéro existe ou non (impossible de deviner quels numéros sont inscrits).
const crypto = require('crypto');
const config = require('./config');
const auth = require('./auth');

const TTL = 5 * 60 * 1000;
const RESEND_AFTER = 30 * 1000;
const MAX_PER_HOUR = 5;
const MAX_TRIES = 5;

const pending = new Map(); // clé -> { hash, exp, tries }
const sends = new Map();   // clé -> [horodatages d'envoi]
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pending) if (v.exp < now) pending.delete(k);
  for (const [k, v] of sends) if (!v.some((t) => now - t < 3600e3)) sends.delete(k);
}, 5 * 60 * 1000).unref();

const enabled = () => !!config.otp.provider;
const isDevProvider = () => config.otp.provider === 'console';

async function deliver(phone, code, shopName) {
  const message = `${code} est votre code de connexion ${shopName}. Ne le partagez avec personne.`;
  const o = config.otp;
  if (o.provider === 'console') { console.log(`[otp] code pour +${phone} : ${code}`); return; }
  if (o.provider === 'twilio-sms' || o.provider === 'twilio-whatsapp') {
    if (!o.twilioSid || !o.twilioToken || !o.twilioFrom) throw new Error('Twilio non configuré');
    const wa = o.provider === 'twilio-whatsapp';
    const body = new URLSearchParams({
      To: (wa ? 'whatsapp:+' : '+') + phone,
      From: wa && !o.twilioFrom.startsWith('whatsapp:') ? 'whatsapp:' + o.twilioFrom : o.twilioFrom,
      Body: message,
    });
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${o.twilioSid}/Messages.json`, {
      method: 'POST', body,
      headers: { Authorization: 'Basic ' + Buffer.from(`${o.twilioSid}:${o.twilioToken}`).toString('base64') },
    });
    if (!r.ok) throw new Error('Twilio ' + r.status);
    return;
  }
  if (o.provider === 'webhook') {
    if (!o.webhookUrl) throw new Error('OTP_WEBHOOK_URL manquant');
    const r = await fetch(o.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(o.webhookToken ? { Authorization: 'Bearer ' + o.webhookToken } : {}) },
      body: JSON.stringify({ to: '+' + phone, message, code, shop: shopName }),
    });
    if (!r.ok) throw new Error('webhook ' + r.status);
    return;
  }
  throw new Error('OTP_PROVIDER inconnu : ' + o.provider);
}

// Demande d'un code. `shop` peut être null (numéro inconnu) : on ne révèle rien.
// Retourne { wait?: secondes } si trop tôt ; { devCode? } en mode console.
async function request(key, shop, phone) {
  const now = Date.now();
  const hist = (sends.get(key) || []).filter((t) => now - t < 3600e3);
  if (hist.length && now - hist[hist.length - 1] < RESEND_AFTER) return { wait: Math.ceil((RESEND_AFTER - (now - hist[hist.length - 1])) / 1000) };
  if (hist.length >= MAX_PER_HOUR) return { wait: 600 };
  hist.push(now); sends.set(key, hist);
  if (!shop) return {}; // numéro inconnu : même réponse, rien n'est envoyé
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  pending.set(key, { hash: auth.hmac(key + ':' + code), exp: now + TTL, tries: 0 });
  await deliver(phone, code, shop.name);
  return isDevProvider() ? { devCode: code } : {};
}

function verify(key, code) {
  const p = pending.get(key);
  if (!p || p.exp < Date.now()) { pending.delete(key); return false; }
  if (++p.tries > MAX_TRIES) { pending.delete(key); return false; }
  const ok = auth.safeEqual(auth.hmac(key + ':' + String(code).replace(/\D/g, '')), p.hash);
  if (ok) pending.delete(key);
  return ok;
}

module.exports = { enabled, isDevProvider, request, verify };
