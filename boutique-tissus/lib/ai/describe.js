// Génère nom + catégorie + description marketing à partir de la photo (Claude, vision).
const Anthropic = require('@anthropic-ai/sdk');
const sharp = require('sharp');
const config = require('../config');
const { CATEGORIES, clampStr } = require('../util');

const client = config.ai.key ? new Anthropic({ apiKey: config.ai.key }) : null;

const SYSTEM = `Tu rédiges les fiches produits d'une boutique de tissus haut de gamme au Mali (Bamako).
À partir d'une photo de tissu, tu produis :
- "name" : un nom de produit attractif en français, 3 à 8 mots, sans guillemets (ex. « Basin riche brodé bleu royal », « Voile suisse brodé vert émeraude et fuchsia »).
- "category" : exactement une valeur parmi broderie, bazin, drap, rideau, dentelle, basin, wax, autre.
   broderie = tissu brodé (broderie visible, voile suisse brodé, bazin brodé) ; drap = drap de lit ou linge de maison ; rideau = tissu ou rideau d'ameublement ;
   dentelle = voile suisse / dentelle brodée à jours (coton ajouré, fleurs ou motifs brodés, strass, bordure en festons) ;
   basin = basin riche / brillant damassé ; bazin = bazin teint uni ou lustré ;
   wax = pagne imprimé (wax, super wax, hollandais) ; autre = tout le reste.
- "description" : 2 à 3 phrases marketing en français : texture et tombé, motif ou broderie visibles, occasions adaptées (mariage, baptême, Tabaski, cérémonies...).
Règles : décris uniquement ce que tu vois (couleurs, motifs, broderies). N'invente ni composition, ni marque, ni dimensions, ni prix.
Utilise un ton élégant et chaleureux, sans exagération ni emoji.`;

const SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    category: { type: 'string', enum: CATEGORIES },
    description: { type: 'string' },
  },
  required: ['name', 'category', 'description'],
  additionalProperties: false,
};

const smallJpeg = (buf) => sharp(buf).rotate().resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
  .jpeg({ quality: 82 }).toBuffer(); // suffisant pour décrire, et plus rapide / moins cher

// ---- Fournisseur 1 : Claude (payant, optionnel : ANTHROPIC_API_KEY) ----
async function describeWithClaude(originalBuffer, shop) {
  const small = await smallJpeg(originalBuffer);

  // Note : on ne force pas d'appel d'outil ; la sortie structurée (output_config.format) garantit le JSON.
  const res = await client.messages.create({
    model: config.ai.model,
    max_tokens: 4000, // large : la réflexion interne du modèle compte dans ce plafond
    system: SYSTEM,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: small.toString('base64') } },
        { type: 'text', text: `Boutique : ${shop.name}${shop.city ? ' (' + shop.city + ')' : ''}. Fiche produit pour ce tissu.` },
      ],
    }],
  });

  if (res.stop_reason === 'refusal') throw new Error('Le modèle a refusé de traiter cette image.');
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return clean(JSON.parse(text));
}

// ---- Fournisseur 2 : Gemini de Google (gratuit avec une clé d'aistudio.google.com, optionnel : GEMINI_API_KEY) ----
async function describeWithGemini(originalBuffer, shop) {
  const small = await smallJpeg(originalBuffer);
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: 'user', parts: [
      { inlineData: { mimeType: 'image/jpeg', data: small.toString('base64') } },
      { text: `Boutique : ${shop.name}${shop.city ? ' (' + shop.city + ')' : ''}. Fiche produit pour ce tissu. Réponds en JSON : {"name","category","description"}.` },
    ] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.4 },
  });
  // Modèle léger et rapide d'abord, puis un autre s'il est surchargé (503) ou limité (429)
  const models = [process.env.GEMINI_MODEL || 'gemini-flash-lite-latest', 'gemini-flash-latest'];
  let last;
  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
        body, signal: AbortSignal.timeout(20000),
      });
      if (r.ok) {
        const j = await r.json();
        const text = (j.candidates?.[0]?.content?.parts || []).filter((x) => !x.thought).map((x) => x.text || '').join('');
        return clean(JSON.parse(text));
      }
      last = new Error(`Gemini ${model} ${r.status} ${(await r.text()).slice(0, 120)}`);
      if (![429, 500, 503].includes(r.status)) break; // erreur définitive : inutile de réessayer ce modèle
      await new Promise((ok) => setTimeout(ok, 1500));
    }
  }
  throw last;
}

// ---- Fournisseur 3 : local, GRATUIT, sans internet (toujours disponible) ----
// Nom = rubrique + couleur dominante de la photo ; texte standard. Le propriétaire peut tout corriger.
const COLOR_WORDS = [ // [teinte max (°), mot]
  [15, 'rouge'], [38, 'orange'], [66, 'doré'], [160, 'vert'], [195, 'turquoise'], [255, 'bleu'], [290, 'violet'], [335, 'rose'], [361, 'rouge'],
];
function colorName(r, g, b) {
  const mx = Math.max(r, g, b) / 255, mn = Math.min(r, g, b) / 255, l = (mx + mn) / 2, d = mx - mn;
  const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (l < 0.13) return 'noir';
  if (l > 0.9) return 'blanc';
  if (sat < 0.14) return l > 0.7 ? 'blanc cassé' : 'gris';
  let h;
  if (mx === r / 255) h = ((g - b) / 255 / d + 6) % 6; else if (mx === g / 255) h = (b - r) / 255 / d + 2; else h = (r - g) / 255 / d + 4;
  h *= 60;
  if (h >= 15 && h < 45 && l < 0.4) return 'marron';
  if (h >= 300 && h < 335 && sat > 0.5) return 'fuchsia';
  if (h >= 195 && h < 255 && l < 0.3) return 'bleu nuit';
  const [, word] = COLOR_WORDS.find(([max]) => h < max);
  return l > 0.72 && word === 'rose' ? 'rose pâle' : word;
}
const LOCAL_TEXT = {
  broderie: ['Tissu brodé', 'Tissu brodé aux motifs soignés, idéal pour vos tenues de cérémonie : mariage, baptême, Tabaski.'],
  bazin: ['Bazin', 'Bazin de belle qualité, au tombé agréable, parfait pour les grands boubous et tenues de fête.'],
  drap: ['Drap', 'Drap doux et résistant, pour un lit confortable au quotidien.'],
  rideau: ['Rideau', 'Tissu d’ameublement élégant, pour habiller vos fenêtres et décorer votre salon.'],
  dentelle: ['Dentelle', 'Dentelle fine et raffinée, pour sublimer vos tenues de cérémonie.'],
  basin: ['Basin riche', 'Basin riche brillant, au toucher soyeux, pour des tenues qui se remarquent.'],
  wax: ['Wax', 'Pagne wax aux couleurs vives, pour des tenues pleines de caractère.'],
  autre: ['Tissu', 'Tissu de qualité, disponible à la boutique. Contactez-nous sur WhatsApp pour plus de détails.'],
};
async function describeLocally(originalBuffer, hintCategory) {
  const cat = CATEGORIES.includes(hintCategory) ? hintCategory : 'autre';
  // Couleur moyenne du centre de la photo (là où se trouve le tissu)
  const meta = await sharp(originalBuffer).rotate().metadata();
  const w = meta.width || 1, h = meta.height || 1;
  const { data } = await sharp(originalBuffer).rotate()
    .extract({ left: Math.floor(w * 0.25), top: Math.floor(h * 0.25), width: Math.max(1, Math.floor(w * 0.5)), height: Math.max(1, Math.floor(h * 0.5)) })
    .resize(1, 1, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const color = colorName(data[0], data[1], data[2]);
  const [label, text] = LOCAL_TEXT[cat];
  return { name: `${label} ${color}`, category: cat, description: text };
}

function clean(out) {
  return {
    name: clampStr(out.name, 80).replace(/^["«\s]+|["»\s]+$/g, ''),
    category: CATEGORIES.includes(out.category) ? out.category : 'autre',
    description: clampStr(out.description, 600),
  };
}

// Essaie dans l'ordre : Claude (si clé), Gemini (si clé), puis local. Ne lance JAMAIS d'erreur :
// un produit a toujours un nom, même sans crédit ni connexion. hintCategory = rubrique choisie par le propriétaire.
async function describeFabric(originalBuffer, shop, hintCategory) {
  const providers = [];
  if (client) providers.push(describeWithClaude);
  if (process.env.GEMINI_API_KEY) providers.push(describeWithGemini);
  for (const fn of providers) {
    try {
      const out = await fn(originalBuffer, shop);
      // La rubrique choisie à la main par le propriétaire reste prioritaire
      if (hintCategory && hintCategory !== 'autre') out.category = hintCategory;
      return out;
    } catch (e) { console.error('[ia]', fn.name, e.message.slice(0, 120)); }
  }
  return describeLocally(originalBuffer, hintCategory);
}

module.exports = { describeFabric, aiEnabled: true };
