// File d'envoi des photos : le propriétaire publie, la photo part en arrière-plan.
// Stockée dans IndexedDB => rien n'est perdu si le réseau coupe ou si l'application est fermée.
// Chaque envoi porte un identifiant unique (cid) : un renvoi ne crée jamais de doublon côté serveur.
const Q = (() => {
  const listeners = [];
  let mem = [];            // repli si IndexedDB est indisponible
  let dbp = null;
  let running = false;
  let retryTimer = null;
  let paused = false;      // vrai si la session a expiré (il faut se reconnecter)

  function db() {
    if (dbp) return dbp;
    dbp = new Promise((resolve) => {
      try {
        const r = indexedDB.open('tissus-queue', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('items', { keyPath: 'id' });
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => resolve(null);
      } catch { resolve(null); }
    });
    return dbp;
  }
  const tx = async (mode, fn) => {
    const d = await db();
    if (!d) return null;
    return new Promise((resolve) => {
      const t = d.transaction('items', mode);
      const req = fn(t.objectStore('items'));
      t.oncomplete = () => resolve(req ? req.result : null);
      t.onerror = () => resolve(null);
    });
  };

  const emit = (type, data) => listeners.forEach((l) => l(type, data));
  const on = (fn) => { listeners.push(fn); return () => listeners.splice(listeners.indexOf(fn), 1); };

  async function list() {
    const d = await db();
    return d ? ((await tx('readonly', (s) => s.getAll())) || []) : mem.slice();
  }
  async function add({ blob, price, cat }) {
    const item = { cat: cat || '', id: (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(16).slice(2)), blob, price, ts: Date.now() };
    const d = await db();
    if (d) await tx('readwrite', (s) => s.put(item)); else mem.push(item);
    emit('change');
    run();
    return item.id;
  }
  async function remove(id) {
    const d = await db();
    if (d) await tx('readwrite', (s) => s.delete(id)); else mem = mem.filter((i) => i.id !== id);
  }

  async function run() {
    if (running || paused) return;
    running = true;
    clearTimeout(retryTimer);
    try {
      for (;;) {
        const items = (await list()).sort((a, b) => a.ts - b.ts);
        if (!items.length) break;
        const it = items[0];
        try {
          await T.api(`/api/admin/products?price=${it.price}&cat=${encodeURIComponent(it.cat || '')}&cid=${encodeURIComponent(it.id)}`, { method: 'POST', headers: { 'Content-Type': it.blob.type || 'image/jpeg' }, body: it.blob });
          await remove(it.id);
          emit('sent', it);
          emit('change');
        } catch (e) {
          if (e.status === 401) { paused = true; emit('auth'); break; }
          if (e.status && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429) {
            await remove(it.id); emit('rejected', { item: it, message: e.message }); emit('change'); continue; // photo refusée : on passe à la suivante
          }
          retryTimer = setTimeout(run, 8000); // réseau ou serveur indisponible : on réessaie
          emit('offline');
          break;
        }
      }
    } finally { running = false; }
  }
  window.addEventListener('online', run);
  const resume = () => { paused = false; run(); };

  return { on, list, add, run, resume };
})();
