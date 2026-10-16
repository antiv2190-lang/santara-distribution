// Choisit le stockage : Supabase si les clés sont présentes, sinon mode démo sur disque.
const config = require('../config');

let store;
if (config.supabase.url && config.supabase.key) {
  store = require('./supabase');
} else {
  if (config.isProd) {
    console.error('ERREUR : SUPABASE_URL et SUPABASE_SERVICE_KEY sont obligatoires en production.');
    process.exit(1);
  }
  console.warn('[store] Supabase non configuré -> MODE DÉMO (données dans .data/, non adapté à la production).');
  store = require('./memory');
}
module.exports = store;
