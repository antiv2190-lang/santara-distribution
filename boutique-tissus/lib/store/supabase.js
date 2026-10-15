// Stockage Supabase : Postgres (tables shops / products) + Storage (bucket de photos).
// Le serveur utilise la clé "service_role" : elle ne doit JAMAIS être envoyée au navigateur.
const { createClient } = require('@supabase/supabase-js');
const config = require('../config');

const sb = createClient(config.supabase.url, config.supabase.key, { auth: { persistSession: false } });
const bucket = config.supabase.bucket;

// Lance l'erreur Supabase telle quelle (avec un code lisible pour les doublons).
function check({ data, error }) {
  if (error) {
    const e = new Error(error.message);
    e.code = error.code === '23505' ? 'slug_taken' : error.code;
    throw e;
  }
  return data;
}
// Échappe les caractères spéciaux d'un motif ILIKE / filtre PostgREST.
const likeSafe = (s) => s.replace(/[\\%_,()]/g, ' ');

module.exports = {
  name: 'supabase',

  // ---- Boutiques ----
  async listShops() { return check(await sb.from('shops').select('*').order('created_at')); },
  async getShopBySlug(slug) { return check(await sb.from('shops').select('*').eq('slug', slug).maybeSingle()); },
  async getShopById(id) { return check(await sb.from('shops').select('*').eq('id', id).maybeSingle()); },
  async createShop(data) { return check(await sb.from('shops').insert(data).select().single()); },
  async updateShop(id, patch) { return check(await sb.from('shops').update(patch).eq('id', id).select().maybeSingle()); },
  async countProducts(shopId) {
    const { count, error } = await sb.from('products').select('id', { count: 'exact', head: true }).eq('shop_id', shopId);
    if (error) throw new Error(error.message);
    return count || 0;
  },

  // ---- Produits ----
  async createProduct(data) { return check(await sb.from('products').insert(data).select().single()); },
  async getProduct(id) { return check(await sb.from('products').select('*').eq('id', id).maybeSingle()); },
  async findProductByClientId(shopId, cid) {
    return check(await sb.from('products').select('*').eq('shop_id', shopId).eq('client_id', cid).maybeSingle());
  },
  async listProducts(shopId, { publicOnly, requireReview, filter, category, q, limit = 24, offset = 0 } = {}) {
    let query = sb.from('products').select('*', { count: 'exact' }).eq('shop_id', shopId);
    if (publicOnly) {
      query = query.in('ai_status', ['done', 'failed']);
      if (requireReview) query = query.eq('reviewed', true);
    }
    if (filter === 'review') query = query.eq('reviewed', false);
    if (filter === 'available') query = query.eq('sold_out', false);
    if (filter === 'soldout') query = query.eq('sold_out', true);
    if (category) query = query.eq('category', category);
    if (q) query = query.ilike('name', `%${likeSafe(q)}%`);
    const { data, count, error } = await query.order('created_at', { ascending: false }).range(offset, offset + limit - 1);
    if (error) throw new Error(error.message);
    return { total: count || 0, items: data || [] };
  },
  async updateProduct(id, patch) {
    return check(await sb.from('products').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select().maybeSingle());
  },
  async deleteProduct(id) { check(await sb.from('products').delete().eq('id', id)); },
  async listStuckProducts(olderThanMs) {
    const limit = new Date(Date.now() - olderThanMs).toISOString();
    return check(await sb.from('products').select('*').in('ai_status', ['pending', 'processing']).lt('updated_at', limit).limit(50));
  },

  // ---- Codes de connexion (OTP) : en base, car les instances serverless ne partagent pas leur mémoire ----
  async getOtp(key) { return check(await sb.from('otp_state').select('*').eq('key', key).maybeSingle()); },
  async setOtp(key, v) { check(await sb.from('otp_state').upsert({ key, hash: v.hash || null, exp: v.exp || 0, tries: v.tries || 0, sends: v.sends || [] })); },
  async deleteOtp(key) { check(await sb.from('otp_state').delete().eq('key', key)); },

  // ---- Fichiers ----
  async putFile(path, buffer, contentType) {
    const { error } = await sb.storage.from(bucket).upload(path, buffer, { contentType, upsert: true, cacheControl: '31536000' });
    if (error) throw new Error('Stockage : ' + error.message);
  },
  async getFile(path) {
    // Fichier livré avec l'application (voir public/demo) : lu sur place, pas dans le stockage
    if (path.startsWith('/static/')) return require('fs').promises.readFile(require('path').join(config.publicDir, path.slice('/static/'.length)));
    const { data, error } = await sb.storage.from(bucket).download(path);
    if (error) throw new Error('Stockage : ' + error.message);
    return Buffer.from(await data.arrayBuffer());
  },
  async deleteFiles(paths) {
    const list = paths.filter(Boolean);
    if (list.length) await sb.storage.from(bucket).remove(list);
  },
  fileUrl(p) { if (p && p.startsWith('/static/')) return p; return p ? `${config.supabase.url}/storage/v1/object/public/${bucket}/${p}` : null; },
};
