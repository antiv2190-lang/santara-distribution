// Génère le logo de Nogoya Boutique (SVG vectoriel + PNG). Relancer : node branding/make-logo.js
// Motif : anneau en festons (comme la bordure d'un voile suisse), points de broderie, fleur brodée, monogramme « N ».
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const GOLD = '#d4af37', GOLD_LIGHT = '#f1d98a', GOLD_DEEP = '#a9801c', BLACK = '#0b0b0b';
const OUT = path.join(__dirname, 'nogoya');
const SERIF = "'Caladea','Bitstream Charter','FreeSerif','DejaVu Serif',Georgia,serif";

// Anneau en festons : n petits arcs vers l'extérieur autour d'un cercle de rayon R
function scallops(cx, cy, R, n, bulge) {
  let d = '';
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * 2 * Math.PI - Math.PI / 2, a1 = ((i + 1) / n) * 2 * Math.PI - Math.PI / 2;
    const [x0, y0] = [cx + R * Math.cos(a0), cy + R * Math.sin(a0)];
    const [x1, y1] = [cx + R * Math.cos(a1), cy + R * Math.sin(a1)];
    if (i === 0) d += `M${x0.toFixed(2)} ${y0.toFixed(2)}`;
    d += ` A${bulge} ${bulge} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  }
  return d + ' Z';
}

// Fleur brodée à 8 pétales
function flower(cx, cy, r) {
  const petals = Array.from({ length: 8 }, (_, i) =>
    `<ellipse cx="${cx}" cy="${cy - r * 0.62}" rx="${r * 0.2}" ry="${r * 0.46}" transform="rotate(${i * 45} ${cx} ${cy})" fill="url(#g)"/>`).join('');
  return `${petals}<circle cx="${cx}" cy="${cy}" r="${r * 0.2}" fill="${BLACK}" stroke="${GOLD_LIGHT}" stroke-width="3"/>`;
}

// Monogramme N (contraste fin/épais, empattements) ; dessiné, donc indépendant des polices
const N = `<g fill="url(#g)">
  <rect x="398" y="396" width="12" height="268"/><rect x="590" y="396" width="12" height="268"/>
  <polygon points="398,396 448,396 602,664 552,664"/>
  <rect x="368" y="387" width="84" height="10"/><rect x="368" y="663" width="84" height="10"/>
  <rect x="552" y="387" width="84" height="10"/><rect x="552" y="663" width="84" height="10"/></g>`;

const defs = `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="${GOLD_LIGHT}"/><stop offset="0.5" stop-color="${GOLD}"/><stop offset="1" stop-color="${GOLD_DEEP}"/></linearGradient></defs>`;

// Emblème rond (1000 x 1000), fond transparent autour du disque
function emblem(withBackground) {
  return `${withBackground ? `<rect width="1000" height="1000" fill="${BLACK}"/>` : ''}
  <circle cx="500" cy="500" r="488" fill="${BLACK}"/>
  <path d="${scallops(500, 500, 450, 40, 37)}" fill="none" stroke="url(#g)" stroke-width="7" stroke-linejoin="round"/>
  <circle cx="500" cy="500" r="418" fill="none" stroke="url(#g)" stroke-width="3"/>
  <circle cx="500" cy="500" r="392" fill="none" stroke="${GOLD}" stroke-width="5" stroke-linecap="round" stroke-dasharray="1 15"/>
  ${flower(500, 292, 74)}
  ${N}
  <g stroke="${GOLD}" stroke-width="3"><line x1="388" y1="742" x2="470" y2="742"/><line x1="530" y1="742" x2="612" y2="742"/></g>
  <rect x="493" y="735" width="14" height="14" transform="rotate(45 500 742)" fill="url(#g)"/>`;
}

const svgEmblem = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" width="1000" height="1000">${defs}${emblem(false)}</svg>`;

// Version horizontale : emblème + nom
const svgHorizontal = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2350 1000" width="2350" height="1000">${defs}
  <rect width="2350" height="1000" fill="${BLACK}"/>
  <g transform="translate(40 0)">${emblem(false)}</g>
  <text x="1090" y="520" font-family="${SERIF}" font-size="210" font-weight="700" letter-spacing="18" fill="url(#g)">NOGOYA</text>
  <g stroke="${GOLD}" stroke-width="3"><line x1="1096" y1="590" x2="1320" y2="590"/><line x1="1780" y1="590" x2="2010" y2="590"/></g>
  <text x="1550" y="608" text-anchor="middle" font-family="${SERIF}" font-size="62" letter-spacing="26" fill="${GOLD_LIGHT}">BOUTIQUE</text>
  <text x="1096" y="715" font-family="${SERIF}" font-size="58" letter-spacing="8" fill="${GOLD_LIGHT}">CHEZ FODÉ SACKO</text>
  <text x="1096" y="800" font-family="${SERIF}" font-size="40" letter-spacing="7" fill="#cfc7b2">DRAP · RIDEAU · BAZIN · BRODÉ &amp; DIVERS</text></svg>`;

// Version « profil » carrée : l'emblème sur fond noir (Google, WhatsApp et réseaux recadrent en rond)
const svgSquare = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" width="1000" height="1000">${defs}${emblem(true)}</svg>`;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'logo-emblème.svg'), svgEmblem);
  fs.writeFileSync(path.join(OUT, 'logo-horizontal.svg'), svgHorizontal);
  fs.writeFileSync(path.join(OUT, 'logo-profil.svg'), svgSquare);
  const png = (svg, w, f) => sharp(Buffer.from(svg), { density: 144 }).resize(w).png().toFile(path.join(OUT, f));
  await png(svgEmblem, 1024, 'logo-emblème.png');       // fond transparent : site, factures, tampon
  await png(svgSquare, 720, 'logo-profil-google-720.png'); // profil Google / WhatsApp Business / Facebook
  await png(svgHorizontal, 2350, 'logo-horizontal.png');   // en-têtes, affiches
  console.log('Logo généré dans', OUT);
})();
