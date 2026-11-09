'use strict';
// Espace administrateur — aucun innerHTML, jeton CSRF sur chaque requête modifiante.
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === false || v == null) continue;
      if (k === 'class') el.className = v; else if (k === 'text') el.textContent = v; else if (k === 'value') el.value = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(String(k)));
    return el;
  };
  const fmt = n => new Intl.NumberFormat('fr-FR').format(n).replace(/[  ]/g, ' ') + ' FCFA';
  const dt = s => new Date(s).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
  const root = $('#app');
  let S = { csrf: '', user: null, meta: null, tab: 'dash', products: [], orders: [], settings: null };

  function toast(msg, kind = '') { const t = h('div', { class: 'toast ' + kind, text: msg }); $('#toasts').append(t); setTimeout(() => t.remove(), 4000); }
  async function api(path, method = 'GET', body) {
    const r = await fetch('/api/admin' + path, { method, credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(S.csrf ? { 'X-CSRF-Token': S.csrf } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { if (r.status === 401 && j.login && S.user) { S.user = null; S.csrf = ''; toast('Session expirée : reconnectez-vous.', 'err-t'); renderLogin(); }
      const e = new Error(j.error || 'Erreur.'); e.mustChange = j.mustChange; throw e; }
    return j;
  }
  const busy = async (btn, fn) => { btn.disabled = true; try { await fn(); } catch (e) { toast(e.message, 'err-t'); } finally { btn.disabled = false; } };

  // ---------- Connexion ----------
  function renderLogin(needOtp = false, creds = {}) {
    const err = h('p', { class: 'err', role: 'alert' });
    const user = h('input', { class: 'input', id: 'u', autocomplete: 'username', required: true, value: creds.username || '', maxlength: 60, autocapitalize: 'none' });
    const pass = h('input', { class: 'input', id: 'p', type: 'password', autocomplete: 'current-password', required: true, maxlength: 200, value: creds.password || '' });
    const otp = h('input', { class: 'input', id: 'o', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6, pattern: '[0-9]{6}', placeholder: '123456' });
    const btn = h('button', { class: 'btn btn-block', type: 'submit', text: needOtp ? 'Valider le code' : 'Se connecter' });
    const form = h('form', { novalidate: true, onsubmit: e => { e.preventDefault(); err.textContent = '';
      busy(btn, async () => {
        try {
          const r = await api('/login', 'POST', { username: user.value, password: pass.value, otp: needOtp ? otp.value : undefined });
          if (r.needOtp) return renderLogin(true, { username: user.value, password: pass.value });
          S.csrf = r.csrf; S.user = r.user; await boot();
        } catch (ex) { err.textContent = ex.message; }
      }); } },
      needOtp ? h('div', { class: 'field' }, h('label', { for: 'o', text: 'Code à 6 chiffres de votre application d’authentification' }), otp)
        : [h('div', { class: 'field' }, h('label', { for: 'u', text: 'Identifiant' }), user), h('div', { class: 'field' }, h('label', { for: 'p', text: 'Mot de passe' }), pass)],
      err, btn);
    root.replaceChildren(h('main', { class: 'login' }, h('div', { class: 'login-card' },
      h('img', { src: '/img/logo.svg', alt: '' }), h('h1', { text: 'Espace administrateur' }), h('p', { text: 'Kamissoko & Frères — accès réservé.' }), form,
      h('p', { class: 'muted', text: needOtp ? 'Double authentification activée sur ce compte.' : 'Trop d’essais incorrects verrouillent temporairement le compte.' }))));
    (needOtp ? otp : user).focus();
  }

  // ---------- Changement de mot de passe (obligatoire au 1er accès) ----------
  function passwordPanel(forced) {
    const cur = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', required: true, id: 'pc' });
    const nw = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', required: true, id: 'pn', minlength: 12 });
    const cf = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', required: true, id: 'pf' });
    const err = h('p', { class: 'err', role: 'alert' });
    const btn = h('button', { class: 'btn', type: 'submit', text: 'Changer le mot de passe' });
    return h('form', { class: 'panel', novalidate: true, onsubmit: e => { e.preventDefault(); err.textContent = '';
      if (nw.value !== cf.value) { err.textContent = 'Les deux mots de passe ne sont pas identiques.'; return; }
      busy(btn, async () => { try { const r = await api('/password', 'POST', { current: cur.value, next: nw.value }); S.csrf = r.csrf; S.user = r.user; toast('Mot de passe changé', 'ok-t'); cur.value = nw.value = cf.value = ''; if (forced) await boot(); } catch (ex) { err.textContent = ex.message; } }); } },
      h('h3', { text: forced ? 'Choisissez votre mot de passe personnel' : 'Changer le mot de passe' }),
      forced && h('p', { class: 'muted', text: 'Le mot de passe temporaire ne doit plus servir. Minimum 12 caractères, avec au moins 3 types : minuscules, MAJUSCULES, chiffres, symboles. Une phrase longue fonctionne très bien.' }),
      h('div', { class: 'field' }, h('label', { for: 'pc', text: 'Mot de passe actuel' }), cur),
      h('div', { class: 'field' }, h('label', { for: 'pn', text: 'Nouveau mot de passe' }), nw),
      h('div', { class: 'field' }, h('label', { for: 'pf', text: 'Confirmer le nouveau mot de passe' }), cf), err, btn);
  }

  // ---------- Structure ----------
  async function boot() {
    try {
      const me = await api('/me'); S.user = me.user; S.csrf = me.csrf; S.meta = me;
      if (me.user.mustChange) { shell(passwordPanel(true), true); return; }
      const [products, orders, settings] = await Promise.all([api('/products'), api('/orders'), api('/settings')]);
      Object.assign(S, { products, orders, settings }); render();
    } catch (e) { if (!S.user) renderLogin(); else toast(e.message, 'err-t'); }
  }
  function shell(content, forced) {
    const newCount = S.orders.filter(o => o.status === 'nouveau').length;
    const tab = (id, ico, label, badge) => h('button', { type: 'button', 'aria-current': S.tab === id ? 'page' : false, onclick: () => { S.tab = id; render(); } },
      h('span', { class: 'ico', 'aria-hidden': 'true', text: ico }), h('span', { text: label }), badge ? h('span', { class: 'dotn', text: badge }) : null);
    root.replaceChildren(h('div', { class: 'shell' },
      h('div', { class: 'bar' }, h('span', { class: 'brand' }, h('img', { src: '/img/logo.svg', alt: '' }), 'Administration'),
        h('a', { class: 'btn btn-ghost btn-sm', href: '/', target: '_blank', rel: 'noopener', text: 'Voir la boutique' }),
        h('button', { class: 'btn btn-sm', type: 'button', text: 'Déconnexion', onclick: async () => { try { await api('/logout', 'POST'); } catch { /* déjà déconnecté */ } S = { ...S, user: null, csrf: '' }; renderLogin(); } })),
      forced ? null : h('nav', { class: 'tabs', 'aria-label': 'Sections' }, tab('dash', '📊', 'Accueil'), tab('prod', '👕', 'Produits'), tab('ord', '🧾', 'Commandes', newCount || ''), tab('set', '⚙️', 'Boutique'), tab('sec', '🔒', 'Sécurité')),
      h('main', {}, content)));
  }
  function render() {
    const views = { dash: viewDash, prod: viewProducts, ord: viewOrders, set: viewSettings, sec: viewSecurity };
    shell(views[S.tab](), false);
  }

  // ---------- Accueil ----------
  function viewDash() {
    const box = h('div', {}, h('h2', { class: 'view', text: 'Tableau de bord' }), h('p', { class: 'muted', text: 'Chargement…' }));
    api('/stats').then(s => {
      const k = (v, l, cls = '') => h('div', { class: 'kpi ' + cls }, h('b', { text: v }), h('span', { text: l }));
      box.replaceChildren(h('h2', { class: 'view', text: 'Tableau de bord' }),
        h('div', { class: 'kpis' }, k(s.ordersNew, 'Nouvelles commandes', s.ordersNew ? 'alert' : ''), k(s.ordersWeek, 'Commandes (7 jours)'), k(`${s.visible}/${s.products}`, 'Produits en ligne'), k(fmt(s.revenue), 'Commandes confirmées')),
        (s.out || s.low) ? h('div', { class: 'panel' }, h('h3', { text: 'À surveiller' }), h('p', { text: `${s.out} article(s) en rupture, ${s.low} avec peu de stock. Mettez à jour le stock dans « Produits ».` })) : null,
        h('div', { class: 'panel' }, h('h3', { text: 'Actions rapides' }),
          h('div', { class: 'toolbar' }, h('button', { class: 'btn', type: 'button', text: '＋ Ajouter un produit', onclick: () => { S.tab = 'prod'; render(); productForm(); } }),
            h('button', { class: 'btn btn-ghost', type: 'button', text: 'Voir les commandes', onclick: () => { S.tab = 'ord'; render(); } }))));
    }).catch(e => toast(e.message, 'err-t'));
    return box;
  }

  // ---------- Produits ----------
  const STOCK = { in: 'En stock', low: 'Peu de stock', out: 'Rupture' };
  function viewProducts() {
    let q = '';
    const list = h('div', { class: 'plist' });
    const draw = () => list.replaceChildren(...S.products.filter(p => p.name.toLowerCase().includes(q)).map(p =>
      h('div', { class: 'prow' }, h('img', { src: p.img, alt: '', loading: 'lazy' }),
        h('div', {}, h('div', { class: 'nm', text: p.name }), h('div', { class: 'sub', text: `${S.meta.categories[p.category]} · Détail ${fmt(p.priceRetail)} · Gros ${fmt(p.priceWholesale)} dès ${p.wholesaleMin}` }),
          h('div', {}, h('span', { class: 'badge ' + (p.stock === 'out' ? 'gray' : p.stock === 'low' ? 'red' : 'green'), text: STOCK[p.stock] }), ' ', !p.visible && h('span', { class: 'badge gray', text: 'Masqué' }), ' ', p.featured && h('span', { class: 'badge gold', text: 'Vedette' }))),
        h('div', { class: 'acts' }, h('button', { class: 'btn btn-sm', type: 'button', text: 'Modifier', onclick: () => productForm(p) }),
          h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: p.visible ? 'Masquer' : 'Afficher', onclick: async e => busy(e.target, async () => { const u = await api('/products/' + p.id, 'PUT', { ...p, visible: !p.visible }); Object.assign(p, u); draw(); toast(p.visible ? 'Produit visible' : 'Produit masqué', 'ok-t'); }) }),
          h('button', { class: 'btn btn-sm btn-danger', type: 'button', text: 'Supprimer', onclick: async e => { if (!confirm(`Supprimer « ${p.name} » définitivement ?`)) return; busy(e.target, async () => { await api('/products/' + p.id, 'DELETE'); S.products = S.products.filter(x => x !== p); draw(); toast('Produit supprimé', 'ok-t'); }); } })))));
    draw();
    return h('div', {}, h('h2', { class: 'view', text: 'Produits' }),
      h('div', { class: 'toolbar' }, h('input', { class: 'input', type: 'search', placeholder: 'Rechercher un produit…', 'aria-label': 'Rechercher', oninput: e => { q = e.target.value.toLowerCase(); draw(); } }),
        h('button', { class: 'btn', type: 'button', text: '＋ Nouveau produit', onclick: () => productForm() })), list);
  }

  function productForm(p) {
    const edit = !!p; const d = p || { name: '', category: 'jeans', garment: 'jeans', colors: [], sizes: [], priceRetail: '', priceWholesale: '', wholesaleMin: 6, description: '', image: null, stock: 'in', featured: false, visible: true };
    const M = S.meta; let image = d.image;
    const err = h('p', { class: 'err', role: 'alert' });
    const f = {
      name: h('input', { class: 'input', id: 'f-name', value: d.name, maxlength: 80, required: true }),
      category: h('select', { class: 'input', id: 'f-cat' }, Object.entries(M.categories).map(([k, v]) => h('option', { value: k, text: v, selected: d.category === k }))),
      garment: h('select', { class: 'input', id: 'f-gar' }, Object.entries(M.garments).map(([k, v]) => h('option', { value: k, text: v, selected: d.garment === k }))),
      retail: h('input', { class: 'input', id: 'f-r', type: 'number', inputmode: 'numeric', min: 1, value: d.priceRetail, required: true }),
      whole: h('input', { class: 'input', id: 'f-w', type: 'number', inputmode: 'numeric', min: 1, value: d.priceWholesale, required: true }),
      min: h('input', { class: 'input', id: 'f-m', type: 'number', inputmode: 'numeric', min: 2, value: d.wholesaleMin, required: true }),
      sizes: h('input', { class: 'input', id: 'f-s', value: d.sizes.join(', '), placeholder: 'S, M, L, XL  ou  38, 40, 42', maxlength: 120 }),
      desc: h('textarea', { class: 'input', id: 'f-d', maxlength: 600, rows: 3, value: d.description }),
      stock: h('select', { class: 'input', id: 'f-st' }, Object.entries(STOCK).map(([k, v]) => h('option', { value: k, text: v, selected: d.stock === k }))),
      featured: h('input', { type: 'checkbox', checked: d.featured }), visible: h('input', { type: 'checkbox', checked: d.visible })
    };
    const colorBoxes = Object.entries(M.palette).map(([name, hex]) => { const i = h('input', { type: 'checkbox', value: name, checked: d.colors.includes(name) }); const dot = h('span', { class: 'dot' }); dot.style.background = hex; return h('label', { class: 'chip' }, i, h('span', {}, dot, name)); });
    const preview = h('img', { alt: 'Aperçu', width: 120, height: 120 });
    const setPreview = () => { const first = colorBoxes.map(l => l.firstChild).find(i => i.checked); preview.src = image ? (image.startsWith('data:') ? image : '/uploads/' + image) : `/img/garment/${f.garment.value}.svg?c=${encodeURIComponent(first ? M.palette[first.value] : '#3f6a9e')}`; };
    let pendingData = null;
    const fileIn = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', class: 'vh', id: 'f-file', onchange: async e => {
      const file = e.target.files[0]; if (!file) return;
      try { // redimensionnement + ré-encodage JPEG côté navigateur : allège la photo et élimine métadonnées/contenu piégé
        const bmp = await createImageBitmap(file); const sc = Math.min(1, 1000 / Math.max(bmp.width, bmp.height));
        const c = document.createElement('canvas'); c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
        c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); pendingData = c.toDataURL('image/jpeg', 0.82); image = pendingData; setPreview();
      } catch { toast('Image illisible. Essayez une autre photo.', 'err-t'); }
    } });
    const dlg = h('dialog', { 'aria-labelledby': 'pf-title' },
      h('div', { class: 'dlg-head' }, h('h2', { id: 'pf-title', text: edit ? 'Modifier le produit' : 'Nouveau produit' }), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Fermer', text: '✕', onclick: () => dlg.close() })),
      h('form', { class: 'dlg-body form-grid', novalidate: true, onsubmit: e => { e.preventDefault(); err.textContent = ''; const btn = $('button[type=submit]', e.target);
        busy(btn, async () => {
          try {
            if (pendingData) { const up = await api('/upload', 'POST', { data: pendingData }); image = up.file; }
            const body = { name: f.name.value, category: f.category.value, garment: f.garment.value, priceRetail: +f.retail.value, priceWholesale: +f.whole.value, wholesaleMin: +f.min.value,
              sizes: f.sizes.value.split(',').map(s => s.trim()).filter(Boolean), colors: colorBoxes.map(l => l.firstChild).filter(i => i.checked).map(i => i.value),
              description: f.desc.value, stock: f.stock.value, featured: f.featured.checked, visible: f.visible.checked, image };
            const saved = await api(edit ? '/products/' + p.id : '/products', edit ? 'PUT' : 'POST', body);
            if (edit) Object.assign(p, saved); else S.products.unshift(saved);
            dlg.close(); render(); toast(edit ? 'Produit modifié' : 'Produit ajouté — il est en ligne', 'ok-t');
          } catch (ex) { err.textContent = ex.message; }
        }); } },
      h('div', { class: 'field' }, h('label', { for: 'f-name', text: 'Nom du produit' }), f.name),
      h('div', { class: 'form-grid two' }, h('div', { class: 'field' }, h('label', { for: 'f-cat', text: 'Catégorie' }), f.category), h('div', { class: 'field' }, h('label', { for: 'f-gar', text: 'Type de vêtement (illustration)' }), f.garment)),
      h('div', { class: 'form-grid two' },
        h('div', { class: 'field' }, h('label', { for: 'f-r', text: 'Prix détail (FCFA / pièce)' }), f.retail),
        h('div', { class: 'field' }, h('label', { for: 'f-w', text: 'Prix de gros (FCFA / pièce)' }), f.whole)),
      h('div', { class: 'field' }, h('label', { for: 'f-m', text: 'Gros à partir de … pièces' }), f.min, h('small', { class: 'muted', text: 'Le prix de gros s’applique automatiquement à partir de cette quantité.' })),
      h('fieldset', { class: 'fs' }, h('legend', { text: 'Couleurs disponibles (la 1re coche colore l’illustration)' }), h('div', { class: 'chips' }, colorBoxes)),
      h('div', { class: 'field' }, h('label', { for: 'f-s', text: 'Tailles (séparées par des virgules)' }), f.sizes),
      h('div', { class: 'field' }, h('label', { for: 'f-d', text: 'Description' }), f.desc),
      h('div', { class: 'field' }, h('span', { text: 'Photo du produit' }), h('div', { class: 'photo-box' }, preview,
        h('div', { class: 'toolbar' }, fileIn, h('label', { class: 'btn btn-ghost btn-sm', for: 'f-file', text: '📷 Choisir une photo' }),
          h('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: 'Utiliser l’illustration', onclick: () => { image = null; pendingData = null; setPreview(); } }))),
        h('small', { class: 'muted', text: 'Sans photo, une illustration du vêtement est affichée. Les photos sont réduites automatiquement.' })),
      h('div', { class: 'form-grid two' }, h('div', { class: 'field' }, h('label', { for: 'f-st', text: 'Stock' }), f.stock),
        h('div', { class: 'field' }, h('label', { class: 'switch' }, f.featured, 'Mettre en vedette'), h('label', { class: 'switch' }, f.visible, 'Visible dans la boutique'))),
      err, h('button', { class: 'btn btn-lg', type: 'submit', text: edit ? 'Enregistrer' : 'Ajouter à la boutique' })));
    document.body.append(dlg); dlg.addEventListener('close', () => dlg.remove()); dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
    [f.garment, ...colorBoxes.map(l => l.firstChild)].forEach(i => i.addEventListener('change', setPreview)); setPreview(); dlg.showModal();
  }

  // ---------- Commandes ----------
  const ST = { 'nouveau': 'red', 'confirmé': 'gold', 'livré': 'green', 'annulé': 'gray' };
  function viewOrders() {
    const wrap = h('div', {}, h('h2', { class: 'view', text: 'Commandes' }));
    if (!S.orders.length) wrap.append(h('div', { class: 'panel' }, h('p', { text: 'Aucune commande pour le moment. Les commandes envoyées depuis la boutique apparaissent ici.' })));
    for (const o of S.orders) {
      wrap.append(h('article', { class: 'order' },
        h('div', { class: 'order-head' }, h('strong', { text: `#${o.id} — ${o.name}` }), h('span', { class: 'badge ' + ST[o.status], text: o.status })),
        h('div', { class: 'muted', text: `${dt(o.createdAt)} · +${o.phone}${o.city ? ' · ' + o.city : ''}` }),
        h('ul', {}, o.lines.map(l => h('li', { text: `${l.qty} × ${l.name}${l.size ? ' — ' + l.size : ''}${l.color ? ', ' + l.color : ''} — ${fmt(l.unit)}${l.wholesale ? ' (gros)' : ''}` }))),
        o.note && h('p', { text: 'Remarque : ' + o.note }), h('strong', { text: 'Total : ' + fmt(o.total) }),
        h('div', { class: 'acts' },
          h('select', { class: 'input', 'aria-label': 'Statut de la commande #' + o.id, onchange: e => busy(e.target, async () => { const u = await api('/orders/' + o.id, 'PATCH', { status: e.target.value }); Object.assign(o, u); render(); toast('Statut mis à jour', 'ok-t'); }) },
            Object.keys(ST).map(s => h('option', { value: s, text: s, selected: o.status === s }))),
          h('a', { class: 'btn btn-wa btn-sm', target: '_blank', rel: 'noopener noreferrer', href: `https://wa.me/${o.phone}?text=${encodeURIComponent(`Bonjour ${o.name}, c’est ${S.settings.shopName} au sujet de votre commande #${o.id} (${fmt(o.total)}).`)}`, text: 'Écrire au client' }),
          h('button', { class: 'btn btn-danger btn-sm', type: 'button', text: 'Supprimer', onclick: e => { if (confirm(`Supprimer la commande #${o.id} ?`)) busy(e.target, async () => { await api('/orders/' + o.id, 'DELETE'); S.orders = S.orders.filter(x => x !== o); render(); }); } }))));
    }
    return wrap;
  }

  // ---------- Réglages boutique ----------
  function viewSettings() {
    const s = S.settings; const err = h('p', { class: 'err', role: 'alert' });
    const fld = (id, label, val, max, hint) => { const i = h('input', { class: 'input', id, value: val || '', maxlength: max }); return [h('div', { class: 'field' }, h('label', { for: id, text: label }), i, hint && h('small', { class: 'muted', text: hint })), i]; };
    const [a1, shopName] = fld('s-n', 'Nom de la boutique', s.shopName, 60), [a2, tagline] = fld('s-t', 'Slogan', s.tagline, 120), [a3, place] = fld('s-p', 'Emplacement', s.place, 120), [a3b, address] = fld('s-ad', 'Adresse complète', s.address, 200),
      [a4, wa] = fld('s-w', 'Numéro WhatsApp (avec indicatif)', s.whatsapp, 20, 'Ex. 22376271472 — les commandes arrivent sur ce numéro.'), [a5, ph2] = fld('s-2', 'Second numéro (facultatif)', s.phone2, 20), [a5b, ph3] = fld('s-3', 'Troisième numéro (facultatif)', s.phone3, 20),
      [a6, ann] = fld('s-a', 'Bandeau d’annonce (en haut du site)', s.announcement, 220, 'Laissez vide pour le masquer.'), [a7, hours] = fld('s-h', 'Horaires (facultatif)', s.hours, 120);
    const faqBox = h('div', { class: 'form-grid' }); let faq = s.faq.map(x => ({ ...x }));
    const drawFaq = () => faqBox.replaceChildren(...faq.map((x, i) => h('div', { class: 'faq-edit' },
      h('div', { class: 'field' }, h('label', { for: 'fq' + i, text: 'Question' }), h('input', { class: 'input', id: 'fq' + i, value: x.q, maxlength: 200, oninput: e => x.q = e.target.value })),
      h('div', { class: 'field' }, h('label', { for: 'fa' + i, text: 'Réponse' }), h('textarea', { class: 'input', id: 'fa' + i, value: x.a, maxlength: 800, oninput: e => x.a = e.target.value })),
      h('button', { class: 'btn btn-danger btn-sm', type: 'button', text: 'Retirer cette question', onclick: () => { faq.splice(i, 1); drawFaq(); } }))));
    drawFaq(); const btn = h('button', { class: 'btn btn-lg', type: 'submit', text: 'Enregistrer' });
    return h('form', { novalidate: true, onsubmit: e => { e.preventDefault(); err.textContent = ''; busy(btn, async () => {
      try { S.settings = await api('/settings', 'PUT', { shopName: shopName.value, tagline: tagline.value, place: place.value, address: address.value, whatsapp: wa.value, phone2: ph2.value, phone3: ph3.value, announcement: ann.value, hours: hours.value, faq }); faq = S.settings.faq.map(x => ({ ...x })); toast('Boutique mise à jour', 'ok-t'); }
      catch (ex) { err.textContent = ex.message; } }); } },
      h('h2', { class: 'view', text: 'Réglages de la boutique' }),
      h('div', { class: 'panel' }, h('h3', { text: 'Identité & contact' }), a1, a2, a3, a3b, a4, a5, a5b, a6, a7),
      h('div', { class: 'panel' }, h('h3', { text: 'Questions fréquentes (FAQ)' }), faqBox, h('button', { class: 'btn btn-ghost', type: 'button', text: '＋ Ajouter une question', onclick: () => { if (faq.length < 20) { faq.push({ q: '', a: '' }); drawFaq(); } } })),
      err, btn);
  }

  // ---------- Sécurité ----------
  function viewSecurity() {
    const wrap = h('div', {}, h('h2', { class: 'view', text: 'Sécurité du compte' }), passwordPanel(false));
    const tf = h('div', { class: 'panel' }); wrap.append(tf);
    const drawTf = () => {
      if (S.user.totpEnabled) {
        const pw = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', id: 'dpw' }); const btn = h('button', { class: 'btn btn-danger', type: 'button', text: 'Désactiver la double authentification' });
        btn.onclick = () => busy(btn, async () => { const r = await api('/2fa/disable', 'POST', { password: pw.value }); S.user = r.user; toast('2FA désactivée'); drawTf(); });
        tf.replaceChildren(h('h3', { text: 'Double authentification : ACTIVE ✓' }), h('p', { class: 'muted', text: 'Un code de votre téléphone est demandé à chaque connexion.' }), h('div', { class: 'field' }, h('label', { for: 'dpw', text: 'Mot de passe (pour désactiver)' }), pw), btn);
      } else {
        const btn = h('button', { class: 'btn', type: 'button', text: 'Activer la double authentification' });
        btn.onclick = () => busy(btn, async () => {
          const r = await api('/2fa/setup', 'POST'); const code = h('input', { class: 'input', id: 'tc', inputmode: 'numeric', maxlength: 6, autocomplete: 'one-time-code', placeholder: '123456' }); const ok = h('button', { class: 'btn', type: 'button', text: 'Vérifier et activer' }); const er = h('p', { class: 'err', role: 'alert' });
          ok.onclick = () => busy(ok, async () => { try { const x = await api('/2fa/enable', 'POST', { code: code.value }); S.user = x.user; toast('Double authentification activée', 'ok-t'); drawTf(); } catch (ex) { er.textContent = ex.message; } });
          tf.replaceChildren(h('h3', { text: 'Configurer l’application' }), h('ol', {}, h('li', { text: 'Installez Google Authenticator, Microsoft Authenticator ou Authy sur votre téléphone.' }), h('li', { text: 'Ajoutez un compte → « saisir une clé de configuration » → collez la clé ci-dessous (type : basé sur l’heure).' }), h('li', { text: 'Entrez le code à 6 chiffres affiché.' })),
            h('div', { class: 'secret', text: r.secret }), h('div', { class: 'field' }, h('label', { for: 'tc', text: 'Code à 6 chiffres' }), code), er, ok);
        });
        tf.replaceChildren(h('h3', { text: 'Double authentification : inactive' }), h('p', { class: 'muted', text: 'Fortement recommandée : même si quelqu’un devine votre mot de passe, il ne pourra pas entrer sans votre téléphone.' }), btn);
      }
    }; drawTf();
    const audit = h('div', { class: 'panel' }, h('h3', { text: 'Journal d’activité récent' }), h('p', { class: 'muted', text: 'Chargement…' })); wrap.append(audit);
    api('/audit').then(rows => audit.replaceChildren(h('h3', { text: 'Journal d’activité récent' }), h('div', { class: 'scroll-x' }, h('table', { class: 'table' },
      h('thead', {}, h('tr', {}, ['Date', 'Qui', 'Action', 'Détail'].map(t => h('th', { text: t })))), h('tbody', {}, rows.slice(0, 40).map(r => h('tr', {}, h('td', { text: dt(r.t) }), h('td', { text: r.user }), h('td', { text: r.action }), h('td', { text: r.detail }))))))));
    wrap.append(h('div', { class: 'panel' }, h('h3', { text: 'Protections actives' }), h('ul', { class: 'checklist' },
      ['Mots de passe chiffrés (scrypt) — jamais stockés en clair', 'Verrouillage du compte après 5 essais ratés', 'Session coupée après 30 min d’inactivité', 'Cookie de session protégé (HttpOnly, SameSite, Secure)', 'Jeton anti-CSRF sur chaque modification', 'Politique CSP stricte : aucun script externe ne peut s’exécuter', 'Prix recalculés par le serveur : impossible de les falsifier', 'Photos vérifiées et ré-encodées avant publication'].map(t => h('li', { text: t })))));
    return wrap;
  }

  boot();
})();
