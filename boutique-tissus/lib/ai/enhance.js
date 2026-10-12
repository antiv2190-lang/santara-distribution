// Amélioration de la photo : « style publicité » SANS jamais toucher aux couleurs, motifs ou broderies.
//
// RÈGLE ABSOLUE respectée ici :
//  - on n'utilise AUCUNE IA générative d'image (elles peuvent inventer/modifier des motifs) ;
//  - les pixels du tissu ne subissent que : étirement de la LUMINANCE (lumière) et netteté ;
//  - fond + ombre sont dessinés AUTOUR du tissu ;
//  - un garde-fou mesure la dérive de couleur (plan a*b* de Lab, indépendant de la luminosité) :
//    si elle dépasse le seuil, on renonce à la correction de lumière.
const sharp = require('sharp');
const config = require('../config');
const { colorSignature, colorDrift } = require('./color');

const CANVAS = 1200;       // photo finale carrée
const MARGIN = 0.07;       // marge autour du tissu (7 %)
const MAX_COLOR_DRIFT = 4; // écart a*b* maximal toléré (unités Lab) avant de renoncer à la correction de lumière

// Fond élégant : dégradé radial neutre chaud + vignettage léger.
function backgroundSvg() {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${CANVAS}">
    <defs><radialGradient id="g" cx="50%" cy="42%" r="75%">
      <stop offset="0" stop-color="#fbf8f2"/><stop offset="0.65" stop-color="#ece6da"/><stop offset="1" stop-color="#d9d0bf"/>
    </radialGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/></svg>`);
}
function roundedMask(w, h, r) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${r}" ry="${r}" fill="#fff"/></svg>`);
}

// Option : détourage du fond par un service externe (les pixels du tissu restent identiques).
async function cutoutRemoveBg(buf) {
  const form = new FormData();
  form.append('image_file', new Blob([buf], { type: 'image/jpeg' }), 'tissu.jpg');
  form.append('size', 'auto');
  const r = await fetch('https://api.remove.bg/v1.0/removebg', { method: 'POST', headers: { 'X-Api-Key': config.removebgKey }, body: form });
  if (!r.ok) throw new Error('remove.bg ' + r.status);
  return Buffer.from(await r.arrayBuffer());
}

// Retourne { enhanced: Buffer(jpeg), thumb: Buffer(webp), toneCorrected: boolean }
async function enhancePhoto(originalBuffer) {
  // 1) Orientation correcte + taille raisonnable
  const base = await sharp(originalBuffer).rotate().resize(1800, 1800, { fit: 'inside', withoutEnlargement: true })
    .removeAlpha().toBuffer();

  // 2) Lumière : étirement de la luminance uniquement (la teinte n'est pas modifiée) + netteté douce
  const sharpOnly = await sharp(base).sharpen({ sigma: 0.8, m1: 0.6, m2: 1.6 }).toBuffer();
  let fabric = await sharp(base).normalise({ lower: 1, upper: 99 }).sharpen({ sigma: 0.8, m1: 0.6, m2: 1.6 }).toBuffer();
  let toneCorrected = true;

  // 3) Garde-fou couleurs : si la teinte moyenne a bougé, on garde la version « netteté seule »
  if (colorDrift(await colorSignature(base), await colorSignature(fabric)) > MAX_COLOR_DRIFT) { fabric = sharpOnly; toneCorrected = false; }

  // 4) Mise en scène : tissu centré sur le fond élégant, ombre portée douce
  const inner = Math.round(CANVAS * (1 - 2 * MARGIN));
  let layer, lw, lh;
  if (config.imageProvider === 'removebg' && config.removebgKey) {
    try {
      const cut = await cutoutRemoveBg(fabric);
      const resized = await sharp(cut).resize(inner, inner, { fit: 'inside' }).png().toBuffer();
      const m = await sharp(resized).metadata();
      layer = resized; lw = m.width; lh = m.height;
    } catch (e) { console.warn('[enhance] détourage indisponible, mode local :', e.message); }
  }
  if (!layer) {
    const resized = await sharp(fabric).resize(inner, inner, { fit: 'inside' }).toBuffer();
    const m = await sharp(resized).metadata();
    lw = m.width; lh = m.height;
    layer = await sharp(resized).composite([{ input: roundedMask(lw, lh, 14), blend: 'dest-in' }]).png().toBuffer();
  }
  const shadow = await sharp({ create: { width: lw, height: lh, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0.38 } } })
    .composite([{ input: roundedMask(lw, lh, 14), blend: 'dest-in' }]).blur(18).png().toBuffer();
  const left = Math.round((CANVAS - lw) / 2);
  const top = Math.round((CANVAS - lh) / 2);

  const enhanced = await sharp(backgroundSvg())
    .composite([{ input: shadow, left, top: top + 14 }, { input: layer, left, top }])
    .jpeg({ quality: 86, mozjpeg: true }).toBuffer();
  const thumb = await sharp(enhanced).resize(600, 600).webp({ quality: 74 }).toBuffer();
  return { enhanced, thumb, toneCorrected };
}

module.exports = { enhancePhoto };
