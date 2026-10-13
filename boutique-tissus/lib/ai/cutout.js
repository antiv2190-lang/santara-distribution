// Détourage local du tissu (sans IA générative, sans service externe).
//
// Principe : sur ces photos, le tissu est posé sur un sol uni (moquette, table). On estime la couleur du sol
// d'après les bords de la photo, on garde tout ce qui s'en écarte, on comble les trous (broderies de la
// couleur du sol), on prend la plus grande forme, et on l'utilise comme masque.
// Les pixels du tissu ne sont JAMAIS modifiés : seul le fond est remplacé.
// Si la photo ne s'y prête pas (tissu empilé avec d'autres, fond chargé...), on renvoie null et
// l'appelant garde la photo entière (cadrage simple).
const sharp = require('sharp');
const { srgbToLab } = require('./color');

const WORK = 320; // taille de travail (rapide ; le masque est ensuite agrandi)
// Poids de la luminosité dans l'écart de couleur. Volontairement modéré : une valeur plus faible ignore mieux les
// ombres du sol mais mange les tissus sombres ou bruns (testé) ; un tissu abîmé est pire qu'un reste de sol.
const LW = 0.6;


function percentile(arr, p) {
  const s = Float32Array.from(arr).sort();
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

// Vote de majorité 3x3 : lisse la forme et supprime les petits points isolés.
function majority(mask, w, h) {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      n += xx >= 0 && yy >= 0 && xx < w && yy < h ? mask[yy * w + xx] : 0;
    }
    out[y * w + x] = n >= 5 ? 1 : 0;
  }
  return out;
}

// Érosion puis dilatation (« ouverture ») : coupe les ponts et excroissances plus étroits que 2*r pixels.
function open(mask, w, h, r) {
  const pass = (src, wantAll) => {
    const out = new Uint8Array(src.length);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let hit = wantAll ? 1 : 0;
      for (let dy = -r; dy <= r && (wantAll ? hit : !hit); dy++) for (let dx = -r; dx <= r; dx++) {
        const xx = x + dx, yy = y + dy;
        const v = xx >= 0 && yy >= 0 && xx < w && yy < h ? src[yy * w + xx] : (wantAll ? 1 : 0);
        if (wantAll ? !v : v) { hit = wantAll ? 0 : 1; break; }
      }
      out[y * w + x] = hit;
    }
    return out;
  };
  return pass(pass(mask, true), false);
}

// Parcours en largeur : renvoie les indices atteints depuis `seeds` à travers les pixels où mask === value.
function flood(mask, w, h, seeds, value) {
  const seen = new Uint8Array(mask.length);
  const q = [];
  for (const s of seeds) if (mask[s] === value && !seen[s]) { seen[s] = 1; q.push(s); }
  for (let i = 0; i < q.length; i++) {
    const p = q[i], x = p % w, y = (p / w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const n = yy * w + xx;
      if (!seen[n] && mask[n] === value) { seen[n] = 1; q.push(n); }
    }
  }
  return seen;
}

// Renvoie { mask (Uint8 0/1), w, h, coverage, bbox:{x0,y0,x1,y1} } ou null.
async function fabricMask(input) {
  const { data, info } = await sharp(input).rotate().resize(WORK, WORK, { fit: 'inside' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const n = w * h;
  const L = new Float32Array(n), A = new Float32Array(n), B = new Float32Array(n);
  for (let i = 0; i < n; i++) { const c = srgbToLab(data[i * 3], data[i * 3 + 1], data[i * 3 + 2]); L[i] = c.L; A[i] = c.a; B[i] = c.b; }

  // Couleur du sol : on regroupe les pixels du cadre extérieur en 3 familles de couleurs (k-means) et on
  // prend la plus UNIFORME (un sol est uni ; un tissu brodé est varié). Marche aussi quand le tissu touche les bords.
  const t = Math.max(3, Math.round(Math.min(w, h) * 0.05));
  const ring = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < t || y < t || x >= w - t || y >= h - t) ring.push(y * w + x);
  const K = 3;
  const byL = ring.slice().sort((p, q) => L[p] - L[q]);
  let cent = [1, 3, 5].map((k) => { const i = byL[Math.floor((k / 6) * byL.length)]; return [L[i], A[i], B[i]]; });
  let asg = new Int8Array(ring.length);
  for (let it = 0; it < 10; it++) {
    const sum = Array.from({ length: K }, () => [0, 0, 0, 0]);
    ring.forEach((i, r) => {
      let bk = 0, bd = Infinity;
      for (let k = 0; k < K; k++) { const d = (L[i] - cent[k][0]) ** 2 * 0.36 + (A[i] - cent[k][1]) ** 2 + (B[i] - cent[k][2]) ** 2; if (d < bd) { bd = d; bk = k; } }
      asg[r] = bk; sum[bk][0] += L[i]; sum[bk][1] += A[i]; sum[bk][2] += B[i]; sum[bk][3]++;
    });
    cent = cent.map((c, k) => (sum[k][3] ? [sum[k][0] / sum[k][3], sum[k][1] / sum[k][3], sum[k][2] / sum[k][3]] : c));
  }
  const spread = Array.from({ length: K }, () => ({ s: 0, n: 0, d: [] }));
  ring.forEach((i, r) => {
    const k = asg[r], d = Math.hypot((L[i] - cent[k][0]) * 0.6, A[i] - cent[k][1], B[i] - cent[k][2]);
    spread[k].s += d; spread[k].n++; spread[k].d.push(d);
  });
  let floor = -1, floorSpread = Infinity;
  spread.forEach((c, k) => { if (c.n >= ring.length * 0.1 && c.s / c.n < floorSpread) { floorSpread = c.s / c.n; floor = k; } });
  if (floor < 0) return null;
  const bg = { L: cent[floor][0], a: cent[floor][1], b: cent[floor][2] };
  const dist = (i) => Math.hypot((L[i] - bg.L) * 0.6, A[i] - bg.a, B[i] - bg.b);
  // Seuil adapté au sol : 95e centile de l'écart des pixels du sol, + marge
  const thr = Math.min(40, Math.max(15, percentile(spread[floor].d, 0.95) * 1.2 + 3));

  const build = (bg, thr) => {
    const dist = (i) => Math.hypot((L[i] - bg.L) * LW, A[i] - bg.a, B[i] - bg.b);
    let mask = new Uint8Array(n);
    for (let i = 0; i < n; i++) mask[i] = dist(i) > thr ? 1 : 0;
    mask = majority(majority(mask, w, h), w, h);

    // Combler les trous : tout ce qui n'est pas relié au bord par du « sol » appartient au tissu
    const borderSeeds = ring.filter((i) => mask[i] === 0);
    const reachedBg = flood(mask, w, h, borderSeeds, 0);
    // Un trou n'est comblé (broderie de la couleur du sol...) que s'il est petit ; un grand « trou » est du sol visible.
    const holeSeen = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (mask[i] !== 0 || reachedBg[i] || holeSeen[i]) continue;
      const comp = [i]; holeSeen[i] = 1;
      for (let k = 0; k < comp.length; k++) {
        const p = comp[k], x = p % w, y = (p / w) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const m = yy * w + xx;
          if (mask[m] === 0 && !reachedBg[m] && !holeSeen[m]) { holeSeen[m] = 1; comp.push(m); }
        }
      }
      if (comp.length < n * 0.012) for (const p of comp) mask[p] = 1;
    }
    return open(mask, w, h, 4); // coupe les ponts étroits (sol coincé entre deux plis, objets voisins)
  };

  const mask1 = build(bg, thr);

  const finish = (mask) => {
    const label = new Int32Array(n).fill(-1);
    let best = { id: -1, size: 0 }, id = 0;
    for (let i = 0; i < n; i++) {
      if (mask[i] !== 1 || label[i] !== -1) continue;
      const q = [i]; label[i] = id;
      for (let k = 0; k < q.length; k++) {
        const p = q[k], x = p % w, y = (p / w) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const m = yy * w + xx;
          if (mask[m] === 1 && label[m] === -1) { label[m] = id; q.push(m); }
        }
      }
      if (q.length > best.size) best = { id, size: q.length };
      id++;
    }
    if (best.id < 0) return null;
    const out = new Uint8Array(n);
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    for (let i = 0; i < n; i++) if (label[i] === best.id) {
      out[i] = 1; const x = i % w, y = (i / w) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    const coverage = best.size / n;
    // Garde-fous : une forme trop petite ou qui avale toute la photo = détourage non fiable
    // (jusqu'à 97 % : un tissu qui remplit presque le cadre a seulement un coin de sol à retirer)
    if (process.env.CUTOUT_DEBUG) console.log('  cov', coverage.toFixed(2), 'solidity', (best.size / ((x1 - x0 + 1) * (y1 - y0 + 1))).toFixed(2));
    if (coverage < 0.2 || coverage > 0.97) return null;
    // Remplissage de la boîte englobante : une forme très creuse (< 55 %) est suspecte
    const boxArea = (x1 - x0 + 1) * (y1 - y0 + 1);
    if (best.size / boxArea < 0.55) return null;
    return { mask: out, w, h, coverage, bbox: { x0, y0, x1, y1 } };

  };
  return finish(mask1);
}

// Applique le masque à l'image pleine taille -> { rgba: Buffer(png), width, height } rogné sur le tissu.
// `prepare(buf)` (facultatif) retouche la lumière / la netteté sur la zone rognée AVANT le masquage.
async function cutout(fullBuffer, m, prepare) {
  const meta = await sharp(fullBuffer).metadata();
  const W = meta.width, H = meta.height;
  const sx = W / m.w, sy = H / m.h;
  // Masque agrandi, adouci, puis resserré d'environ 1 px pour éviter un liseré de sol sur les bords
  const rawMask = Buffer.from(m.mask.map((v) => v * 255));
  const maskFull = await sharp(rawMask, { raw: { width: m.w, height: m.h, channels: 1 } })
    .resize(W, H, { kernel: 'cubic' }).blur(2.2).linear(3, 255 * (0.5 - 0.62 * 3)).extractChannel(0).raw().toBuffer(); // 1 seul canal (sharp en renvoie 3 après un flou)

  const pad = 4;
  const left = Math.max(0, Math.floor(m.bbox.x0 * sx) - pad), top = Math.max(0, Math.floor(m.bbox.y0 * sy) - pad);
  const right = Math.min(W, Math.ceil((m.bbox.x1 + 1) * sx) + pad), bottom = Math.min(H, Math.ceil((m.bbox.y1 + 1) * sy) + pad);
  const cw = right - left, ch = bottom - top;

  let rgb = await sharp(fullBuffer).extract({ left, top, width: cw, height: ch }).removeAlpha().jpeg({ quality: 95, chromaSubsampling: '4:4:4' }).toBuffer();
  if (prepare) rgb = await prepare(rgb);
  const alpha = await sharp(maskFull, { raw: { width: W, height: H, channels: 1 } }).extract({ left, top, width: cw, height: ch }).extractChannel(0).raw().toBuffer();
  const png = await sharp(rgb).joinChannel(alpha, { raw: { width: cw, height: ch, channels: 1 } }).png().toBuffer();
  return { png, width: cw, height: ch };
}

module.exports = { fabricMask, cutout };
