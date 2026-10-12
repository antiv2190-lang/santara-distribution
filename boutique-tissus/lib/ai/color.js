// Mesure de couleur indépendante de la luminosité : moyenne (a*, b*) en espace CIE Lab.
// Éclaircir ou assombrir une photo change L* mais (presque) pas a*/b* ; changer la teinte les déplace.
// Sert de garde-fou à l'amélioration des photos (règle : ne jamais modifier les couleurs du tissu).
const sharp = require('sharp');

function srgbToLab(r, g, b) {
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [fx, fy, fz] = [f(X), f(Y), f(Z)];
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

// Signature d'une image (ou d'une zone) : a*, b* moyens sur une version 48x48.
async function colorSignature(input, region) {
  let img = sharp(input).removeAlpha();
  if (region) img = img.extract(region);
  const { data, info } = await img.resize(48, 48, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  let a = 0, b = 0, L = 0; const n = info.width * info.height;
  for (let i = 0; i < data.length; i += info.channels) {
    const lab = srgbToLab(data[i], data[i + 1], data[i + 2]);
    a += lab.a; b += lab.b; L += lab.L;
  }
  return { a: a / n, b: b / n, L: L / n };
}
// Écart de couleur (hors luminosité), en unités Lab : < 2 = invisible, > 5 = nettement visible.
const colorDrift = (x, y) => Math.hypot(x.a - y.a, x.b - y.b);

module.exports = { colorSignature, colorDrift };
