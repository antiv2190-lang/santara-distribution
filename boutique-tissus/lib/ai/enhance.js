// Amélioration de la photo : « style publicité » SANS jamais toucher aux couleurs, motifs ou broderies.
//
// RÈGLE ABSOLUE respectée ici :
//  - aucune IA générative d'image (elle pourrait inventer ou modifier des motifs) ;
//  - les pixels du tissu ne subissent que : étirement de la LUMINANCE (lumière) et netteté ;
//  - le sol est détouré (cutout.js) et remplacé par un fond élégant + ombre douce, DEHORS du tissu ;
//  - un garde-fou mesure la dérive de couleur (plan a*b* de Lab, indépendant de la luminosité) :
//    si elle dépasse le seuil, on renonce à la correction de lumière.
const sharp = require('sharp');
const config = require('../config');
const { colorSignature, colorDrift } = require('./color');
const { fabricMask, cutout } = require('./cutout');

const CANVAS = 1200;        // photo finale carrée
const MAX_COLOR_DRIFT = 4;  // écart a*b* maximal toléré (unités Lab)
const SHARPEN = { sigma: 0.8, m1: 0.6, m2: 1.6 };

// Fond élégant : dégradé radial chaud + léger vignettage.
function backgroundSvg() {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${CANVAS}">
    <defs><radialGradient id="g" cx="50%" cy="40%" r="80%">
      <stop offset="0" stop-color="#fdfbf6"/><stop offset="0.6" stop-color="#efe9dc"/><stop offset="1" stop-color="#d6ccb9"/>
    </radialGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/></svg>`);
}
const roundedMask = (w, h, r) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${r}" ry="${r}" fill="#fff"/></svg>`);

// Lumière + netteté sur une zone (avec garde-fou couleurs). Renvoie { buf, toneCorrected }.
async function tone(buf) {
  const HQ = { quality: 95, chromaSubsampling: '4:4:4' };
  const sharpOnly = await sharp(buf).sharpen(SHARPEN).jpeg(HQ).toBuffer();
  const corrected = await sharp(buf).normalise({ lower: 1, upper: 99 }).sharpen(SHARPEN).jpeg(HQ).toBuffer();
  if (colorDrift(await colorSignature(buf), await colorSignature(corrected)) > MAX_COLOR_DRIFT) return { buf: sharpOnly, toneCorrected: false };
  return { buf: corrected, toneCorrected: true };
}

// Option : détourage par un service externe (les pixels du tissu restent identiques).
async function cutoutRemoveBg(buf) {
  const form = new FormData();
  form.append('image_file', new Blob([buf], { type: 'image/jpeg' }), 'tissu.jpg');
  form.append('size', 'auto');
  const r = await fetch('https://api.remove.bg/v1.0/removebg', { method: 'POST', headers: { 'X-Api-Key': config.removebgKey }, body: form });
  if (!r.ok) throw new Error('remove.bg ' + r.status);
  return Buffer.from(await r.arrayBuffer());
}

// Pose un calque RGBA (png) sur le fond, avec ombre portée dérivée de sa transparence.
async function compose(layerPng, inner, shadowStrength) {
  const layer = await sharp(layerPng).resize(inner, inner, { fit: 'inside' }).png().toBuffer();
  const { width: lw, height: lh } = await sharp(layer).metadata();
  const left = Math.round((CANVAS - lw) / 2), top = Math.round((CANVAS - lh) / 2) - 10;
  // Ombre : la transparence du calque, assombrie, floutée, décalée vers le bas
  const pad = 50;
  const alpha = await sharp(layer).extractChannel(3).linear(shadowStrength, 0).raw().toBuffer();
  const shadow = await sharp({ create: { width: lw, height: lh, channels: 3, background: '#000000' } })
    .joinChannel(alpha, { raw: { width: lw, height: lh, channels: 1 } })
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .blur(18).png().toBuffer();
  return sharp(backgroundSvg())
    .composite([{ input: shadow, left: left - pad, top: top - pad + 22 }, { input: layer, left, top }])
    .jpeg({ quality: 86, mozjpeg: true }).toBuffer();
}

// Retourne { enhanced: Buffer(jpeg), thumb: Buffer(webp), toneCorrected, mode: 'cutout'|'removebg'|'frame' }
// options.cutout = false : ne pas détourer le sol (photo entière, cadrée) — utile quand le détourage automatique est imparfait.
async function enhancePhoto(originalBuffer, options = {}) {
  const base = await sharp(originalBuffer).rotate().resize(1800, 1800, { fit: 'inside', withoutEnlargement: true })
    .removeAlpha().jpeg({ quality: 95, chromaSubsampling: '4:4:4' }).toBuffer();
  let toneCorrected = true;
  const prepare = async (b) => { const t = await tone(b); toneCorrected = t.toneCorrected; return t.buf; };

  let enhanced, mode = 'frame';
  // 1) service externe (option)
  if (config.imageProvider === 'removebg' && config.removebgKey) {
    try {
      const t = await tone(base); toneCorrected = t.toneCorrected;
      enhanced = await compose(await cutoutRemoveBg(t.buf), Math.round(CANVAS * 0.84), 0.42); mode = 'removebg';
    } catch (e) { console.warn('[enhance] remove.bg indisponible :', e.message); }
  }
  // 2) détourage local
  if (!enhanced && options.cutout !== false) {
    try {
      const m = await fabricMask(base);
      if (m) {
        const cut = await cutout(base, m, prepare);
        enhanced = await compose(cut.png, Math.round(CANVAS * 0.84), 0.42); mode = 'cutout';
      }
    } catch (e) { console.warn('[enhance] détourage local impossible :', e.message); }
  }
  // 3) repli : photo entière, cadrée sur le fond, coins arrondis
  if (!enhanced) {
    const t = await tone(base); toneCorrected = t.toneCorrected;
    const { width, height } = await sharp(t.buf).metadata();
    const framed = await sharp(t.buf).composite([{ input: roundedMask(width, height, Math.round(Math.min(width, height) * 0.02)), blend: 'dest-in' }]).png().toBuffer();
    enhanced = await compose(framed, Math.round(CANVAS * 0.86), 0.38);
  }
  const thumb = await sharp(enhanced).resize(600, 600).webp({ quality: 74 }).toBuffer();
  return { enhanced, thumb, toneCorrected, mode };
}

module.exports = { enhancePhoto };
