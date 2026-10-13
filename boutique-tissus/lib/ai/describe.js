// Génère nom + catégorie + description marketing à partir de la photo (Claude, vision).
const Anthropic = require('@anthropic-ai/sdk');
const sharp = require('sharp');
const config = require('../config');
const { CATEGORIES, clampStr } = require('../util');

const client = config.ai.key ? new Anthropic({ apiKey: config.ai.key }) : null;

const SYSTEM = `Tu rédiges les fiches produits d'une boutique de tissus haut de gamme au Mali (Bamako).
À partir d'une photo de tissu, tu produis :
- "name" : un nom de produit attractif en français, 3 à 8 mots, sans guillemets (ex. « Basin riche brodé bleu royal », « Voile suisse brodé vert émeraude et fuchsia »).
- "category" : exactement une valeur parmi dentelle, basin, broderie, wax, bazin, autre.
   dentelle = voile suisse / dentelle brodée à jours (coton ajouré, fleurs ou motifs brodés, strass, bordure en festons) ;
   basin = basin riche / brillant damassé ; bazin = bazin teint uni ou lustré ; broderie = tissu plein où la broderie est l'élément principal ;
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

// Retourne { name, category, description } ou lance une erreur (le pipeline gère les reprises).
async function describeFabric(originalBuffer, shop) {
  if (!client) {
    const e = new Error('IA non configurée (ANTHROPIC_API_KEY manquante).');
    e.code = 'no_ai';
    throw e;
  }
  // Image réduite : suffisant pour décrire, et beaucoup moins cher / rapide.
  const small = await sharp(originalBuffer).rotate().resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82 }).toBuffer();

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
  const out = JSON.parse(text);
  return {
    name: clampStr(out.name, 80).replace(/^["«\s]+|["»\s]+$/g, ''),
    category: CATEGORIES.includes(out.category) ? out.category : 'autre',
    description: clampStr(out.description, 600),
  };
}

module.exports = { describeFabric, aiEnabled: !!client };
