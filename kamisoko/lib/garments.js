'use strict';
// Illustrations vectorielles de vêtements, générées côté serveur (aucune image externe, aucun script).
const HEX = /^#[0-9a-fA-F]{6}$/;
const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const toHex = a => '#' + a.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const mix = (h, t, to) => toHex(rgb(h).map((v, i) => v + (to[i] - v) * t));
const dark = (h, t) => mix(h, t, [0, 0, 0]);
const light = (h, t) => mix(h, t, [255, 255, 255]);

const SHAPES = {
  tshirt: (c, d, l) => `
    <path d="M140 72 L98 92 L48 152 L90 188 L120 162 L120 336 Q120 346 130 346 L270 346 Q280 346 280 336 L280 162 L310 188 L352 152 L302 92 L260 72 Q200 118 140 72 Z" fill="${c}" stroke="${d}" stroke-width="3" stroke-linejoin="round"/>
    <path d="M120 162 L138 78 M280 162 L262 78" stroke="${d}" stroke-width="2" stroke-dasharray="5 4" fill="none" opacity=".55"/>
    <path d="M140 72 Q200 124 260 72" fill="none" stroke="${d}" stroke-width="9" stroke-linecap="round"/>
    <path d="M128 326 H272" stroke="${d}" stroke-width="2" stroke-dasharray="5 4" opacity=".55"/>
    <path d="M150 140 Q165 230 150 320 L175 320 Q185 230 175 140 Z" fill="${l}" opacity=".18"/>`,
  kids: (c, d, l) => `
    <g transform="translate(200 215) scale(.78) translate(-200 -215)">
    <path d="M140 72 L98 92 L48 152 L90 188 L120 162 L120 336 Q120 346 130 346 L270 346 Q280 346 280 336 L280 162 L310 188 L352 152 L302 92 L260 72 Q200 118 140 72 Z" fill="${c}" stroke="${d}" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M140 72 Q200 124 260 72" fill="none" stroke="${d}" stroke-width="10" stroke-linecap="round"/>
    <circle cx="200" cy="225" r="34" fill="${l}" opacity=".85"/><path d="M200 205 l7 14 15 2 -11 10 3 15 -14 -8 -14 8 3 -15 -11 -10 15 -2 z" fill="${d}"/></g>`,
  jeans: (c, d, l) => `
    <path d="M118 58 H282 L296 336 L214 336 L200 160 L186 336 L104 336 Z" fill="${c}" stroke="${d}" stroke-width="3" stroke-linejoin="round"/>
    <rect x="118" y="58" width="164" height="30" fill="${d}" opacity=".35"/>
    <rect x="118" y="58" width="164" height="30" fill="none" stroke="${d}" stroke-width="3"/>
    <rect x="140" y="52" width="8" height="40" rx="2" fill="${d}"/><rect x="252" y="52" width="8" height="40" rx="2" fill="${d}"/><rect x="196" y="52" width="8" height="40" rx="2" fill="${d}"/>
    <circle cx="200" cy="104" r="6" fill="#e3b23c" stroke="${d}"/>
    <path d="M200 88 V160 Q200 168 192 168" fill="none" stroke="#e8a33d" stroke-width="2.5" stroke-dasharray="5 4"/>
    <path d="M122 90 Q130 150 186 112 M278 90 Q270 150 214 112" fill="none" stroke="#e8a33d" stroke-width="2.5" stroke-dasharray="5 4"/>
    <ellipse cx="150" cy="220" rx="18" ry="50" fill="${l}" opacity=".22"/><ellipse cx="250" cy="220" rx="18" ry="50" fill="${l}" opacity=".22"/>
    <path d="M106 322 H184 M216 322 H294" stroke="#e8a33d" stroke-width="2.5" stroke-dasharray="5 4"/>`,
  pants: (c, d, l) => `
    <path d="M122 58 H278 L290 338 L212 338 L200 150 L188 338 L110 338 Z" fill="${c}" stroke="${d}" stroke-width="3" stroke-linejoin="round"/>
    <rect x="122" y="58" width="156" height="26" fill="${d}" opacity=".3"/><rect x="122" y="58" width="156" height="26" fill="none" stroke="${d}" stroke-width="3"/>
    <path d="M200 84 V150" stroke="${d}" stroke-width="2.5"/><circle cx="200" cy="71" r="5" fill="${l}" stroke="${d}"/>
    <path d="M126 84 Q150 120 168 130 M274 84 Q250 120 232 130" fill="none" stroke="${d}" stroke-width="2.5"/>
    <path d="M150 170 L140 336 M250 170 L260 336" stroke="${d}" stroke-width="2" opacity=".5"/>
    <path d="M112 326 H186 M214 326 H288" stroke="${d}" stroke-width="2" stroke-dasharray="5 4" opacity=".6"/>`,
  shorts: (c, d, l) => `
    <path d="M120 80 H280 L300 270 L212 270 L200 160 L188 270 L100 270 Z" fill="${c}" stroke="${d}" stroke-width="3" stroke-linejoin="round"/>
    <rect x="120" y="80" width="160" height="26" fill="${d}" opacity=".3"/><rect x="120" y="80" width="160" height="26" fill="none" stroke="${d}" stroke-width="3"/>
    <path d="M200 106 V160" stroke="${d}" stroke-width="2.5"/>
    <path d="M124 106 Q148 140 168 148 M276 106 Q252 140 232 148" fill="none" stroke="${d}" stroke-width="2.5"/>
    <path d="M178 80 Q200 118 222 80" fill="none" stroke="${l}" stroke-width="3" stroke-linecap="round"/>
    <path d="M102 256 H186 M214 256 H298" stroke="${d}" stroke-width="2" stroke-dasharray="5 4" opacity=".6"/>`,
  shirt: (c, d, l) => `
    <path d="M152 74 L104 96 L58 274 L96 286 L126 176 L126 338 L274 338 L274 176 L304 286 L342 274 L296 96 L248 74 L200 108 Z" fill="${c}" stroke="${d}" stroke-width="3" stroke-linejoin="round"/>
    <path d="M152 74 L200 108 L176 134 L138 98 Z M248 74 L200 108 L224 134 L262 98 Z" fill="${l}" stroke="${d}" stroke-width="3" stroke-linejoin="round"/>
    <path d="M200 108 V338" stroke="${d}" stroke-width="2.5"/>
    <g fill="${l}" stroke="${d}" stroke-width="1.5"><circle cx="200" cy="158" r="4.5"/><circle cx="200" cy="198" r="4.5"/><circle cx="200" cy="238" r="4.5"/><circle cx="200" cy="278" r="4.5"/><circle cx="200" cy="318" r="4.5"/></g>
    <rect x="144" y="168" width="38" height="42" rx="3" fill="none" stroke="${d}" stroke-width="2.5"/>
    <path d="M70 252 L100 262 M330 252 L300 262" stroke="${d}" stroke-width="2.5"/>
    <path d="M126 176 L108 100 M274 176 L292 100" stroke="${d}" stroke-width="2" stroke-dasharray="5 4" opacity=".5"/>`,
  jacket: (c, d, l) => `
    <path d="M150 70 L102 94 L56 280 L96 290 L126 182 L126 338 L274 338 L274 182 L304 290 L344 280 L298 94 L250 70 L226 92 L200 82 L174 92 Z" fill="${c}" stroke="${d}" stroke-width="3" stroke-linejoin="round"/>
    <path d="M174 92 L200 82 L226 92 L214 112 L200 100 L186 112 Z" fill="${d}" opacity=".55"/>
    <path d="M200 100 V338" stroke="${l}" stroke-width="4"/><path d="M200 100 V338" stroke="${d}" stroke-width="1.5" stroke-dasharray="3 3"/>
    <path d="M142 250 H182 M218 250 H258" stroke="${d}" stroke-width="3" stroke-linecap="round"/>
    <path d="M142 250 V300 H182 V250 M218 250 V300 H258 V250" fill="none" stroke="${d}" stroke-width="2" opacity=".6"/>
    <path d="M70 262 L100 272 M330 262 L300 272" stroke="${d}" stroke-width="2.5"/>`,
  hoodie: (c, d, l) => `
    <path d="M150 78 L100 100 L54 284 L94 294 L124 184 L124 338 L276 338 L276 184 L306 294 L346 284 L300 100 L250 78 Q200 120 150 78 Z" fill="${c}" stroke="${d}" stroke-width="3" stroke-linejoin="round"/>
    <path d="M150 78 Q150 36 200 34 Q250 36 250 78 Q200 124 150 78 Z" fill="${d}" opacity=".5" stroke="${d}" stroke-width="3"/>
    <path d="M178 112 V168 M222 112 V168" stroke="${l}" stroke-width="3" stroke-linecap="round"/>
    <path d="M148 262 H252 L262 322 H138 Z" fill="${d}" opacity=".25" stroke="${d}" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M124 326 H276" stroke="${d}" stroke-width="7" opacity=".4"/>
    <path d="M70 272 L100 282 M330 272 L300 282" stroke="${d}" stroke-width="2.5"/>`,
  dress: (c, d, l) => `
    <path d="M150 58 L132 134 L96 344 Q200 366 304 344 L268 134 L250 58 Q200 108 150 58 Z" fill="${c}" stroke="${d}" stroke-width="3" stroke-linejoin="round"/>
    <path d="M150 58 Q200 108 250 58" fill="none" stroke="${d}" stroke-width="3"/>
    <path d="M130 150 Q200 170 270 150" fill="none" stroke="${d}" stroke-width="3"/>
    <path d="M130 150 Q200 170 270 150 L275 164 Q200 184 125 164 Z" fill="${d}" opacity=".35"/>
    <g fill="${l}" opacity=".75"><circle cx="150" cy="230" r="5"/><circle cx="200" cy="250" r="5"/><circle cx="250" cy="230" r="5"/><circle cx="125" cy="300" r="5"/><circle cx="175" cy="310" r="5"/><circle cx="225" cy="310" r="5"/><circle cx="275" cy="300" r="5"/></g>
    <path d="M100 330 Q200 352 300 330" fill="none" stroke="${d}" stroke-width="2" stroke-dasharray="5 4" opacity=".6"/>`,
  boubou: (c, d, l) => `
    <path d="M152 52 L48 118 L56 206 L130 166 L110 348 L290 348 L270 166 L344 206 L352 118 L248 52 Q200 94 152 52 Z" fill="${c}" stroke="${d}" stroke-width="3" stroke-linejoin="round"/>
    <path d="M152 52 Q200 94 248 52" fill="none" stroke="#e3b23c" stroke-width="7" stroke-linecap="round"/>
    <path d="M200 90 V150 M176 112 L200 150 L224 112 M170 132 L200 170 L230 132" fill="none" stroke="#e3b23c" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M60 196 L128 160 M340 196 L272 160" stroke="#e3b23c" stroke-width="3.5" stroke-dasharray="2 6" stroke-linecap="round"/>
    <path d="M112 330 H288" stroke="#e3b23c" stroke-width="3.5" stroke-dasharray="2 6" stroke-linecap="round"/>
    <path d="M150 190 Q160 270 140 340 L172 340 Q184 270 176 190 Z" fill="${l}" opacity=".16"/>`
};

function render(type, color) {
  const shape = SHAPES[type] || SHAPES.tshirt;
  const c = HEX.test(color || '') ? color.toLowerCase() : '#3f6a9e';
  const lum = (0.299 * rgb(c)[0] + 0.587 * rgb(c)[1] + 0.114 * rgb(c)[2]) / 255;
  // Vêtement clair : fond bleuté pour qu'il reste bien visible
  const bg1 = lum > 0.62 ? '#dfe8f5' : light(c, 0.88), bg2 = lum > 0.62 ? '#c4d5ec' : light(c, 0.72);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400" role="img">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg1}"/><stop offset="1" stop-color="${bg2}"/></linearGradient></defs>
<rect width="400" height="400" fill="url(#g)"/>
<circle cx="330" cy="70" r="90" fill="#ffffff" opacity=".35"/>
<ellipse cx="200" cy="372" rx="110" ry="10" fill="#000" opacity=".12"/>
${shape(c, dark(c, lum > 0.62 ? 0.55 : 0.38), light(c, 0.35))}
</svg>`;
}
module.exports = { render, TYPES: Object.keys(SHAPES), HEX };
