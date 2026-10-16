// Personnes autorisées à gérer une boutique : le propriétaire principal (colonnes admin_phone / admin_pin_hash)
// + d'éventuelles autres personnes (colonne shops.admins : [{ name, phone, pin_hash }]).
// Chacune se connecte avec SON numéro de téléphone (code reçu ou code secret personnel).
const { loginKey } = require('./util');

function listAdmins(shop) {
  return [
    { name: shop.admin_name || null, phone: shop.admin_phone, pin_hash: shop.admin_pin_hash, main: true },
    ...(Array.isArray(shop.admins) ? shop.admins : []).map((a) => ({ ...a, main: false })),
  ];
}

// Retrouve la personne dont le numéro correspond (on compare les 8 derniers chiffres, sans l'indicatif).
function findAdmin(shop, phone) {
  const k = loginKey(phone);
  if (k.length < 8) return null;
  return listAdmins(shop).find((a) => loginKey(a.phone) === k) || null;
}

module.exports = { listAdmins, findAdmin };
