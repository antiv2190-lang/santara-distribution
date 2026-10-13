// Traitement IA en arrière-plan : file d'attente en mémoire + reprise automatique après un redémarrage.
// Le propriétaire n'attend jamais : la photo est enregistrée tout de suite, le reste se fait ensuite.
const store = require('../store');
const { describeFabric } = require('./describe');
const { enhancePhoto } = require('./enhance');
const integrations = require('../integrations');

const PLACEHOLDER = 'Nouveau tissu'; // nom provisoire tant que l'IA n'est pas passée
const CONCURRENCY = 2;
const MAX_ATTEMPTS = 3;
const queue = [];
const inFlight = new Set(); // ids en file ou en cours
let running = 0;

// force = true : traiter même si le propriétaire a désactivé l'IA automatique (bouton « Embellir avec l'IA »)
function enqueue(productId, force = false) {
  if (inFlight.has(productId)) return;
  inFlight.add(productId);
  queue.push({ id: productId, force });
  pump();
}
function pump() {
  while (running < CONCURRENCY && queue.length) {
    const { id, force } = queue.shift();
    running++;
    processProduct(id, force)
      .catch((e) => console.error('[pipeline]', id, e.message))
      .finally(() => { running--; inFlight.delete(id); pump(); });
  }
}

async function processProduct(id, force) {
  let p = await store.getProduct(id);
  if (!p || (p.ai_status === 'done' && !force)) return;
  const shop = await store.getShopById(p.shop_id);
  if (!shop) return;

  // IA automatique désactivée par le propriétaire : on publie tel quel (photo d'origine), sans appel IA.
  if (shop.ai_auto === false && !force) {
    await store.updateProduct(id, { name: p.name || PLACEHOLDER, ai_status: 'done', ai_error: null });
    return;
  }

  p = await store.updateProduct(id, { ai_status: 'processing', ai_attempts: (p.ai_attempts || 0) + 1 });
  const original = await store.getFile(p.original_path);

  // Description et photo en parallèle : l'une peut échouer sans bloquer l'autre.
  const [desc, photo] = await Promise.allSettled([describeFabric(original, shop), enhancePhoto(original)]);

  const patch = {};
  const errors = [];
  const fresh = await store.getProduct(id);
  if (!fresh) return; // supprimé entre-temps

  if (photo.status === 'fulfilled') {
    const base = `${p.shop_id}/${id}`;
    await store.putFile(`${base}/enhanced.jpg`, photo.value.enhanced, 'image/jpeg');
    await store.putFile(`${base}/thumb.webp`, photo.value.thumb, 'image/webp');
    patch.enhanced_path = `${base}/enhanced.jpg`;
    patch.thumb_path = `${base}/thumb.webp`;
  } else errors.push('photo: ' + photo.reason.message);

  if (desc.status === 'fulfilled') {
    // Ne jamais écraser une correction faite à la main par le propriétaire entre-temps.
    if (!fresh.name || fresh.name === PLACEHOLDER) patch.name = desc.value.name;
    if (!fresh.description) patch.description = desc.value.description;
    if (fresh.category === 'autre' && !fresh.reviewed) patch.category = desc.value.category;
  } else errors.push('texte: ' + desc.reason.message);

  const noAi = desc.status === 'rejected' && desc.reason.code === 'no_ai';
  const retryable = errors.length && !noAi && (fresh.ai_attempts || 1) < MAX_ATTEMPTS;
  if (retryable) {
    await store.updateProduct(id, { ...patch, ai_status: 'pending', ai_error: errors.join(' | ').slice(0, 300) });
    const delay = 5000 * 2 ** ((fresh.ai_attempts || 1) - 1);
    setTimeout(() => enqueue(id, force), delay).unref();
    return;
  }
  // Repli : un produit est toujours publiable, même si l'IA est absente ou en panne.
  if (!fresh.name && !patch.name) patch.name = PLACEHOLDER;
  const done = await store.updateProduct(id, {
    ...patch,
    ai_status: errors.length ? 'failed' : 'done',
    ai_error: errors.length ? errors.join(' | ').slice(0, 300) : null,
  });
  integrations.social.onProductReady(shop, done).catch(() => {}); // phase 3 (désactivé)
}

// Relance les produits restés bloqués (redémarrage du serveur gratuit, coupure réseau...).
async function recoverStuck() {
  try {
    for (const p of await store.listStuckProducts(90 * 1000)) enqueue(p.id); // (les produits déjà « sautés » par l'option IA restent « done »)
  } catch (e) { console.error('[pipeline] reprise:', e.message); }
}
function start() {
  recoverStuck();
  setInterval(recoverStuck, 60 * 1000).unref();
}

// Remet un produit à zéro pour le retraiter (bouton « Relancer l'IA »).
async function reprocess(id) {
  await store.updateProduct(id, { ai_status: 'pending', ai_attempts: 0, ai_error: null });
  enqueue(id, true);
}

module.exports = { enqueue, start, reprocess };
