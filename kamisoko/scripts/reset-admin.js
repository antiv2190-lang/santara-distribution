'use strict';
// Réinitialisation d'urgence (nécessite un accès au serveur) : nouveau mot de passe aléatoire, 2FA coupée.
const path = require('path'); const Store = require('../lib/store'); const sec = require('../lib/security');
const store = new Store(path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data')));
if (!store.db || !store.db.users.length) { console.error('Aucun compte à réinitialiser.'); process.exit(1); }
const u = store.db.users[0]; const pw = sec.randomPassword();
Object.assign(u, { hash: sec.hashPassword(pw), mustChange: true, totpEnabled: false, totpSecret: null, totpLast: 0 });
store.save();
console.log(`Compte « ${u.username} » réinitialisé.\nNouveau mot de passe temporaire : ${pw}\n(à changer dès la connexion ; redémarrez le serveur pour couper les sessions ouvertes)`);
