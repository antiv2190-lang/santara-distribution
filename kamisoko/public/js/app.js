'use strict';
// Boutique Kamissoko & Frères — aucun innerHTML : tout le contenu passe par textContent (anti-XSS).
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === false || v == null) continue;
      if (k === 'class') el.className = v; else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(String(k)));
    return el;
  };
  const fmt = n => new Intl.NumberFormat('fr-FR').format(n).replace(/[  ]/g, ' ') + ' FCFA';
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* stockage indisponible : on continue en mémoire */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* ignoré */ } }
  };

  let data = { settings: {}, categories: {}, palette: {}, products: [] };
  const state = { cat: 'all', q: '', sort: 'featured', mode: store.get('kf_mode', 'detail') };
  let cart = store.get('kf_cart', []).filter(l => l && typeof l.id === 'string' && Number.isInteger(l.qty) && l.qty > 0).slice(0, 30);
  const saveCart = () => store.set('kf_cart', cart);
  const byId = id => data.products.find(p => p.id === id);
  const unitPrice = (p, qty) => qty >= p.wholesaleMin ? p.priceWholesale : p.priceRetail;

  // ---------- Toasts ----------
  function toast(msg, kind = '') {
    const t = h('div', { class: 'toast ' + kind, text: msg }); $('#toasts').append(t); setTimeout(() => t.remove(), 3800);
  }
  async function api(path, opts) {
    const r = await fetch(path, { credentials: 'same-origin', ...opts, headers: { 'Content-Type': 'application/json' } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Une erreur est survenue. Réessayez.');
    return j;
  }

  // ---------- Réglages boutique ----------
  const waLink = (text) => `https://wa.me/${data.settings.whatsapp}${text ? '?text=' + encodeURIComponent(text) : ''}`;
  const display = n => { if (!n) return ''; const s = String(n); const l = s.startsWith('223') ? s.slice(3) : s; return (s.startsWith('223') ? '+223 ' : '+') + l.replace(/(\d{2})(?=\d)/g, '$1 ').trim(); };
  function applySettings() {
    const s = data.settings;
    $$('[data-bind="shopName"]').forEach(e => e.textContent = s.shopName);
    $$('[data-bind="place"]').forEach(e => e.textContent = s.place || '');
    $$('[data-bind="tagline"]').forEach(e => e.textContent = s.tagline || '');
    $$('[data-bind="waDisplay"]').forEach(e => e.textContent = display(s.whatsapp));
    $$('[data-bind="phone2Display"]').forEach(e => e.textContent = display(s.phone2));
    $$('[data-bind="phone3Display"]').forEach(e => e.textContent = display(s.phone3));
    $('#addr').textContent = s.address || ''; $('#addrBox').hidden = !s.address;
    $$('[data-wa]').forEach(a => a.href = waLink(`Bonjour ${s.shopName} 👋 Je souhaite des informations sur vos articles.`));
    $('#callBtn').href = 'tel:+' + s.whatsapp;
    if (s.phone2) { $('#call2Btn').hidden = false; $('#call2Btn').href = 'tel:+' + s.phone2; }
    if (s.phone3) { $('#call3Btn').hidden = false; $('#call3Btn').href = 'tel:+' + s.phone3; }
    const a = $('#announce'); a.textContent = s.announcement || ''; a.hidden = !s.announcement;
    const hr = $('#hours'); hr.textContent = s.hours ? 'Horaires : ' + s.hours : ''; hr.hidden = !s.hours;
    $('#year').textContent = new Date().getFullYear();
    const faq = $('#faqList'); faq.replaceChildren(...(s.faq || []).map(f => h('details', {}, h('summary', { text: f.q }), h('div', { text: f.a }))));
  }

  // ---------- Catalogue ----------
  function renderCats() {
    const counts = { all: data.products.length };
    for (const p of data.products) counts[p.category] = (counts[p.category] || 0) + 1;
    const mk = (key, label) => h('label', { class: 'chip' },
      h('input', { type: 'radio', name: 'cat', value: key, checked: state.cat === key, onchange: () => { state.cat = key; renderGrid(); } }),
      h('span', {}, label, h('small', { text: counts[key] || 0 })));
    $('#cats').replaceChildren(mk('all', 'Tout'), ...Object.entries(data.categories).filter(([k]) => counts[k]).map(([k, v]) => mk(k, v)));
  }
  const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  function filtered() {
    const q = norm(state.q.trim());
    let list = data.products.filter(p => (state.cat === 'all' || p.category === state.cat) &&
      (!q || norm(p.name + ' ' + p.description + ' ' + (data.categories[p.category] || '')).includes(q)));
    const key = state.mode === 'gros' ? 'priceWholesale' : 'priceRetail';
    const sorts = { featured: (a, b) => (b.featured - a.featured) || (a.stock === 'out') - (b.stock === 'out'), new: (a, b) => b.createdAt.localeCompare(a.createdAt), asc: (a, b) => a[key] - b[key], desc: (a, b) => b[key] - a[key] };
    return list.sort(sorts[state.sort]);
  }
  function card(p) {
    const gros = state.mode === 'gros';
    const tags = h('div', { class: 'card-tags' }, p.featured && h('span', { class: 'badge gold', text: 'Vedette' }),
      p.stock === 'low' && h('span', { class: 'badge red', text: 'Peu de stock' }), p.stock === 'out' && h('span', { class: 'badge gray', text: 'Rupture' }));
    return h('button', { type: 'button', class: 'card' + (p.stock === 'out' ? ' out' : ''), 'aria-label': `${p.name}, voir le détail`, onclick: () => openProduct(p.id) },
      h('div', { class: 'card-img' }, h('img', { src: p.img, alt: p.name, loading: 'lazy', width: 300, height: 300 }), tags),
      h('div', { class: 'card-body' },
        h('span', { class: 'card-cat', text: data.categories[p.category] || '' }),
        h('span', { class: 'card-name', text: p.name }),
        h('div', { class: 'dots' }, p.colors.slice(0, 6).map(c => { const d = h('span', { class: 'dot', title: c }); d.style.background = data.palette[c]; return d; })),
        h('span', { class: 'price' }, fmt(gros ? p.priceWholesale : p.priceRetail), h('small', { text: gros ? ` /pièce dès ${p.wholesaleMin}` : ' /pièce' })),
        h('span', { class: 'price2', text: gros ? `Détail : ${fmt(p.priceRetail)}` : `Gros : ${fmt(p.priceWholesale)} dès ${p.wholesaleMin}` })));
  }
  function renderGrid() {
    const list = filtered(); const g = $('#grid'); g.setAttribute('aria-busy', 'false');
    $('#resultCount').textContent = `${list.length} article${list.length > 1 ? 's' : ''}`;
    if (!list.length) { g.replaceChildren(h('div', { class: 'empty' }, h('p', { class: 'muted', text: 'Aucun article ne correspond à votre recherche.' }),
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => { state.q = ''; state.cat = 'all'; $('#q').value = ''; renderCats(); renderGrid(); }, text: 'Tout afficher' }))); return; }
    g.replaceChildren(...list.map(card));
  }

  // ---------- Fiche produit ----------
  const pd = { p: null };
  function openProduct(id) {
    const p = byId(id); if (!p) return; pd.p = p;
    $('#pTitle').textContent = p.name; $('#pImg').src = p.img; $('#pImg').alt = p.name; $('#pDesc').textContent = p.description || '';
    const fillChips = (box, name, vals, labeler) => {
      const fs = $('#' + box); fs.hidden = !vals.length;
      $('.chips', fs).replaceChildren(...vals.map((v, i) => h('label', { class: 'chip' }, h('input', { type: 'radio', name, value: v, checked: vals.length === 1 || (name === 'color' && i === 0) }), h('span', {}, labeler(v)))));
    };
    fillChips('pSizes', 'size', p.sizes, v => v);
    fillChips('pColors', 'color', p.colors, v => { const d = h('span', { class: 'dot' }); d.style.background = data.palette[v]; return [d, v]; });
    $('#pQty').value = state.mode === 'gros' ? p.wholesaleMin : 1; $('#pErr').textContent = '';
    const out = p.stock === 'out'; $('#pAdd').disabled = out; $('#pAdd').textContent = out ? 'En rupture de stock' : 'Ajouter au panier';
    updateProduct(); $('#productDlg').showModal();
  }
  function updateProduct() {
    const p = pd.p; if (!p) return;
    let q = parseInt($('#pQty').value, 10); if (!(q >= 1)) q = 1; q = Math.min(q, 5000);
    const g = q >= p.wholesaleMin;
    $('#pPrices').replaceChildren(
      h('div', { class: g ? '' : 'on' }, h('span', { text: 'Détail (1 à ' + (p.wholesaleMin - 1) + ')' }), h('b', { text: fmt(p.priceRetail) })),
      h('div', { class: g ? 'on' : '' }, h('span', { text: `Gros (dès ${p.wholesaleMin} pièces)` }), h('b', { text: fmt(p.priceWholesale) })));
    const n = $('#pNudge'); n.classList.toggle('good', g);
    n.textContent = g ? `✓ Prix de gros appliqué : vous économisez ${fmt((p.priceRetail - p.priceWholesale) * q)}` : `Plus que ${p.wholesaleMin - q} pièce${p.wholesaleMin - q > 1 ? 's' : ''} pour le prix de gros (−${fmt(p.priceRetail - p.priceWholesale)} /pièce)`;
    $('#pTotal').textContent = `${q} × ${fmt(unitPrice(p, q))} = ${fmt(unitPrice(p, q) * q)}`;
    $('#pWa').href = waLink(`Bonjour ${data.settings.shopName} 👋 Je suis intéressé par : ${p.name}${$('input[name=size]:checked') ? ', taille ' + $('input[name=size]:checked').value : ''}. Est-il disponible ?`);
  }
  $('#pQty').addEventListener('input', updateProduct);
  $('#pForm').addEventListener('change', updateProduct);
  $$('[data-step]', $('#pForm')).forEach(b => b.addEventListener('click', () => { const i = $('#pQty'); i.value = Math.max(1, Math.min(5000, (parseInt(i.value, 10) || 1) + +b.dataset.step)); updateProduct(); }));
  $('#pForm').addEventListener('submit', e => {
    e.preventDefault(); const p = pd.p; const err = $('#pErr'); err.textContent = '';
    const size = ($('input[name=size]:checked') || {}).value || '', color = ($('input[name=color]:checked') || {}).value || '';
    if (p.sizes.length && !size) { err.textContent = 'Choisissez une taille.'; return; }
    const qty = Math.min(5000, Math.max(1, parseInt($('#pQty').value, 10) || 1));
    const ex = cart.find(l => l.id === p.id && l.size === size && l.color === color);
    if (ex) ex.qty = Math.min(5000, ex.qty + qty); else if (cart.length >= 30) { err.textContent = 'Panier plein (30 lignes max).'; return; } else cart.push({ id: p.id, size, color, qty });
    saveCart(); renderCart(); $('#productDlg').close(); toast(`${p.name} ajouté au panier`, 'ok-t');
    const b = $('#cartBtn'); b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump');
  });

  // ---------- Panier ----------
  function renderCart() {
    cart = cart.filter(l => byId(l.id)); // retire les articles disparus du catalogue
    const n = cart.reduce((s, l) => s + l.qty, 0); const c = $('#cartCount'); c.textContent = n; c.hidden = !n;
    $('#cartEmpty').hidden = !!cart.length || !$('#cartDone').hidden; $('#cartFull').hidden = !cart.length;
    if (!cart.length) return;
    let total = 0, saved = 0;
    const items = cart.map((l, i) => {
      const p = byId(l.id), u = unitPrice(p, l.qty), g = l.qty >= p.wholesaleMin; total += u * l.qty; saved += (p.priceRetail - u) * l.qty;
      const missing = p.wholesaleMin - l.qty;
      const set = q => { l.qty = Math.max(1, Math.min(5000, q)); saveCart(); renderCart(); };
      return h('li', { class: 'line' }, h('img', { src: p.img, alt: '', width: 64, height: 64 }),
        h('div', {}, h('div', { class: 'nm', text: p.name }), h('div', { class: 'meta', text: [l.size && 'Taille ' + l.size, l.color].filter(Boolean).join(' · ') }),
          h('div', { class: 'stepper' }, h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Diminuer', onclick: () => set(l.qty - 1), text: '−' }),
            h('input', { class: 'input qty', type: 'number', min: 1, max: 5000, value: l.qty, 'aria-label': 'Quantité', onchange: e => set(parseInt(e.target.value, 10) || 1) }),
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Augmenter', onclick: () => set(l.qty + 1), text: '+' })),
          g ? h('span', { class: 'badge green', text: 'Prix de gros' }) : h('span', { class: 'badge gold', text: `+${missing} pour le gros` }),
          h('div', {}, h('button', { type: 'button', class: 'rm', onclick: () => { cart.splice(i, 1); saveCart(); renderCart(); }, text: 'Retirer' }))),
        h('div', { class: 'lp' }, fmt(u * l.qty), h('small', { text: `${fmt(u)} /pièce` })));
    });
    $('#cartLines').replaceChildren(...items); $('#cartTotal').textContent = fmt(total);
    const sv = $('#cartSave'); sv.hidden = saved <= 0; sv.textContent = `Vous économisez ${fmt(saved)} grâce aux prix de gros`;
  }
  function openCart() { $('#cartDone').hidden = true; renderCart(); const c = getConsent(); if (c.remember) { const m = store.get('kf_me', {}); for (const k of ['name', 'phone', 'city']) if (m[k] && !$('#o' + k[0].toUpperCase() + k.slice(1)).value) $('#o' + k[0].toUpperCase() + k.slice(1)).value = m[k]; } $('#cartDlg').showModal(); }
  $('#cartBtn').addEventListener('click', openCart);

  $('#orderForm').addEventListener('submit', async e => {
    e.preventDefault(); const f = e.target; const err = $('#oErr'); err.textContent = '';
    const body = { name: f.name.value, phone: f.phone.value, city: f.city.value, note: f.note.value, website: f.website.value,
      items: cart.map(l => ({ id: l.id, qty: l.qty, size: l.size, color: l.color })) };
    if (body.name.trim().length < 2) { err.textContent = 'Indiquez votre nom.'; f.name.focus(); return; }
    if (body.phone.replace(/\D/g, '').length < 8) { err.textContent = 'Indiquez un numéro de téléphone valide.'; f.phone.focus(); return; }
    const btn = $('#oSend'); btn.disabled = true; const old = btn.textContent; btn.replaceChildren(h('span', { class: 'spin' }), ' Envoi…');
    try {
      const r = await api('/api/orders', { method: 'POST', body: JSON.stringify(body) });
      if (getConsent().remember) store.set('kf_me', { name: body.name, phone: body.phone, city: body.city });
      cart = []; saveCart(); renderCart();
      $('#cartFull').hidden = true; $('#cartEmpty').hidden = true; $('#cartDone').hidden = false; $('#doneId').textContent = '#' + r.id;
      if (r.whatsappUrl) { $('#doneWa').href = r.whatsappUrl; window.location.assign(r.whatsappUrl); } else $('#doneWa').hidden = true;
    } catch (ex) { err.textContent = ex.message; } finally { btn.disabled = false; btn.textContent = old; }
  });

  // ---------- Fermeture des boîtes de dialogue ----------
  $$('dialog').forEach(d => {
    d.addEventListener('click', e => { if (e.target === d || e.target.closest('[data-close]')) d.close(); }); // clic sur le fond ou ✕
    d.addEventListener('close', () => { if (d.id === 'cartDlg') { $('#cartDone').hidden = true; renderCart(); } });
  });

  // ---------- Cookies / confidentialité ----------
  function getConsent() { return store.get('kf_consent', { v: 0, remember: false }); }
  function setConsent(remember) { store.set('kf_consent', { v: 1, remember }); if (!remember) store.del('kf_me'); $('#cookieBar').hidden = true; }
  $('#ckAll').onclick = () => { setConsent(true); toast('Préférence enregistrée', 'ok-t'); };
  $('#ckEss').onclick = () => { setConsent(false); toast('Seul le stockage indispensable est utilisé', 'ok-t'); };
  const openPrivacy = () => { $('#prefRemember').checked = getConsent().remember; $('#privacyDlg').showModal(); };
  $('#ckMore').onclick = openPrivacy; $('#privacyBtn').onclick = openPrivacy;
  $('#prefForm').addEventListener('submit', e => { e.preventDefault(); setConsent($('#prefRemember').checked); $('#privacyDlg').close(); toast('Préférence enregistrée', 'ok-t'); });
  $('#prefClear').onclick = () => { ['kf_me', 'kf_consent', 'kf_cart', 'kf_mode'].forEach(store.del); cart = []; renderCart(); $('#privacyDlg').close(); $('#cookieBar').hidden = false; toast('Données locales effacées'); };

  // ---------- Contrôles ----------
  let t; $('#q').addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => { state.q = e.target.value; renderGrid(); }, 150); });
  $('#sort').addEventListener('change', e => { state.sort = e.target.value; renderGrid(); });
  $$('input[name=mode]').forEach(r => { r.checked = r.value === state.mode; r.addEventListener('change', () => { state.mode = r.value; store.set('kf_mode', r.value); renderGrid(); }); });

  // ---------- Démarrage ----------
  (async () => {
    try { data = await api('/api/catalog'); }
    catch { $('#grid').replaceChildren(h('p', { class: 'err', text: 'Impossible de charger le catalogue. Vérifiez votre connexion puis rechargez la page, ou écrivez-nous sur WhatsApp.' })); return; }
    applySettings(); renderCats(); renderGrid(); renderCart();
    if (!getConsent().v) $('#cookieBar').hidden = false;
  })();
})();
