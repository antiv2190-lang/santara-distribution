'use strict';
// Stockage JSON simple et fiable pour une boutique : écriture atomique (fichier temporaire + renommage),
// données hors du dossier public (jamais servies directement).
const fs = require('fs'), path = require('path'), crypto = require('crypto');

class Store {
  constructor(dir) {
    this.dir = dir; this.file = path.join(dir, 'db.json'); this.uploads = path.join(dir, 'uploads');
    fs.mkdirSync(this.uploads, { recursive: true, mode: 0o700 });
    this.db = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : null;
  }
  get isNew() { return !this.db; }
  init(initial) { this.db = initial; this.save(); }
  save() {
    const tmp = this.file + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.db, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
  id() { return crypto.randomBytes(6).toString('hex'); }
  audit(user, action, ip, detail) {
    this.db.audit.unshift({ t: new Date().toISOString(), user: user || '-', action, ip: ip || '-', detail: detail || '' });
    this.db.audit.length = Math.min(this.db.audit.length, 300);
    this.save();
  }
}
module.exports = Store;
