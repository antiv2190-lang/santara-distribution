// Configuration centrale — tout vient des variables d'environnement (.env).
// Pour une nouvelle boutique : rien à modifier dans le code, seulement le .env
// (ou créer la boutique depuis /super-admin).
const path = require('path');
require('dotenv').config();

const env = process.env;
const isProd = env.NODE_ENV === 'production';

module.exports = {
  isProd,
  port: Number(env.PORT) || 3000,
  publicUrl: (env.PUBLIC_URL || '').replace(/\/$/, ''),
  defaultShop: (env.DEFAULT_SHOP || '').trim().toLowerCase(),
  superCode: env.SUPERADMIN_CODE || '',
  sessionSecret: env.SESSION_SECRET || '',
  supabase: {
    url: (env.SUPABASE_URL || '').replace(/\/$/, ''),
    key: env.SUPABASE_SERVICE_KEY || '',
    bucket: env.SUPABASE_BUCKET || 'tissus',
  },
  ai: {
    key: env.ANTHROPIC_API_KEY || '',
    model: env.AI_MODEL || 'claude-opus-5-5',
  },
  imageProvider: (env.IMAGE_PROVIDER || 'local').toLowerCase(),
  removebgKey: env.REMOVEBG_API_KEY || '',
  dataDir: env.DATA_DIR || path.join(__dirname, '..', '.data'),
  publicDir: path.join(__dirname, '..', 'public'),
};
