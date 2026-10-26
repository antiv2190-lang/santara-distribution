// =====================================================================
//  PHASES 2 ET 3 — STRUCTURE PRÉVUE, NON ACTIVÉE
//  Rien ici ne s'exécute tant que l'interrupteur de la boutique
//  (shops.features.*) ET les clés d'API du .env ne sont pas renseignés.
//  Chaque fonction lance « not_enabled » : aucun effet de bord possible.
// =====================================================================

const notEnabled = (what) => {
  const e = new Error(`${what} n'est pas activé (phase ultérieure).`);
  e.code = 'not_enabled';
  return e;
};
const flag = (shop, name) => !!(shop && shop.features && shop.features[name]);

// ---------- PHASE 2 : paiement mobile ----------
// À implémenter : initier un paiement, recevoir la confirmation (webhook), mettre à jour `orders`.
const payments = {
  providers: ['orange_money', 'moov_money'],
  enabled: (shop, provider) => flag(shop, provider),
  async createPayment(/* shop, order, provider */) { throw notEnabled('Le paiement mobile'); },
  async handleWebhook(/* provider, req */) { throw notEnabled('Le paiement mobile'); },
};

// ---------- PHASE 3 : publication automatique sur les réseaux ----------
// Appelé par le pipeline quand un produit est prêt. Ne fait RIEN tant que désactivé.
const social = {
  networks: ['facebook', 'tiktok'],
  enabled: (shop, network) => flag(shop, `${network}_autopost`),
  async publish(/* shop, product, network */) { throw notEnabled('La publication automatique'); },
  async onProductReady(shop, product) {
    for (const n of social.networks) {
      if (!social.enabled(shop, n)) continue;
      // Phase 3 : insérer une ligne dans `social_posts` (status 'queued') puis publier.
      // await social.publish(shop, product, n);
    }
  },
};

module.exports = { payments, social };
