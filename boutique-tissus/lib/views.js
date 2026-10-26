// Ce que l'on renvoie au navigateur : jamais de champ interne (hash du code, chemins, erreurs IA...) côté public.
const store = require('./store');

function publicShop(s) {
  return {
    slug: s.slug, name: s.name, tagline: s.tagline || '', city: s.city || '', whatsapp: s.whatsapp,
    owner: s.owner_name || '', address: s.address || '', phone2: s.phone2 || '', about: s.about || '',
    sale_unit: s.sale_unit, color_primary: s.color_primary, color_accent: s.color_accent,
    logo_url: store.fileUrl(s.logo_path),
  };
}

function publicProduct(p) {
  const original = store.fileUrl(p.original_path);
  const enhanced = store.fileUrl(p.enhanced_path);
  return {
    id: p.id, name: p.name || 'Nouveau tissu', category: p.category, description: p.description || '',
    price: p.price, sold_out: !!p.sold_out,
    image: enhanced || original,           // photo améliorée si disponible
    thumb: store.fileUrl(p.thumb_path) || enhanced || original,
    original,                              // la photo d'origine reste toujours accessible
    // Photos supplémentaires du même tissu (autres angles, détails) : { image, original }
    gallery: (Array.isArray(p.gallery) ? p.gallery : []).map((g) => ({ image: store.fileUrl(g.e) || store.fileUrl(g.o), original: store.fileUrl(g.o) })),
    created_at: p.created_at,
  };
}

function adminProduct(p) {
  return {
    ...publicProduct(p),
    ai_status: p.ai_status, ai_error: p.ai_error, reviewed: !!p.reviewed,
    ai_done: !!p.enhanced_path, // la photo a-t-elle été embellie ?
    // Pendant le traitement, le propriétaire voit sa photo d'origine.
    thumb: store.fileUrl(p.thumb_path) || store.fileUrl(p.enhanced_path) || store.fileUrl(p.original_path),
  };
}

function superShop(s, productCount) {
  return {
    ...publicShop(s), id: s.id, admin_phone: s.admin_phone, active: s.active,
    admins: (Array.isArray(s.admins) ? s.admins : []).map((a) => ({ name: a.name || '', phone: a.phone })),
    require_review: s.require_review, ai_auto: s.ai_auto !== false, features: s.features, product_count: productCount, created_at: s.created_at,
  };
}

module.exports = { publicShop, publicProduct, adminProduct, superShop };
