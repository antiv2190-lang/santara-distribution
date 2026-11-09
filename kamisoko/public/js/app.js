'use strict';
// Boutique Kamissoko & Frères — aucun innerHTML : tout le contenu passe par textContent (anti-XSS).
(() => {
  document.documentElement.classList.add('js');
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const EASE = 'cubic-bezier(.22,.8,.2,1)';
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

  let data = { settings: {}, categories: {}, palette: {}, products: [], looks: [] };
  const state = { cat: 'all', q: '', sort: 'featured', mode: store.get('kf_mode', 'detail') };
  let cart = store.get('kf_cart', []).filter(l => l && typeof l.id === 'string' && Number.isInteger(l.qty) && l.qty > 0).slice(0, 30);
  const hearts = new Set(store.get('kf_hearts', []).filter(x => typeof x === 'string'));
  const saveCart = () => store.set('kf_cart', cart);
  const byId = id => data.products.find(p => p.id === id);
  const unitPrice = (p, qty) => qty >= p.wholesaleMin ? p.priceWholesale : p.priceRetail;
  const imgsOf = p => p.gallery && p.gallery.length ? p.gallery : [{ url: p.img, color: null }];

  function toast(msg, kind = '') { const t = h('div', { class: 'toast ' + kind, text: msg }); $('#toasts').append(t); setTimeout(() => t.remove(), 3800); }
  async function api(path, opts) {
    const r = await fetch(path, { credentials: 'same-origin', ...opts, headers: { 'Content-Type': 'application/json' } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Une erreur est survenue. Réessayez.');
    return j;
  }

  // ---------- Mouvement : apparition au défilement, compteur, vol vers le panier ----------
  const io = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }) : null;
  function reveal(els) { els.forEach((el, i) => { el.classList.add('reveal'); el.style.setProperty('--i', String(Math.min(i % 12, 11))); io ? io.observe(el) : el.classList.add('in'); }); }
  function tween(el, to, from = 0) {
    if (REDUCED) { el.textContent = fmt(to); return; }
    const t0 = performance.now(), dur = 500;
    const step = t => { const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3); el.textContent = fmt(Math.round(from + (to - from) * e)); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }
  function fly(rect, url) {
    if (REDUCED || !rect) return;
    const t = $('#cartBtn').getBoundingClientRect();
    const d = h('img', { class: 'fly', src: url, alt: '' });
    Object.assign(d.style, { left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', height: rect.height + 'px' });
    document.body.append(d);
    const dx = t.left + t.width / 2 - (rect.left + rect.width / 2), dy = t.top + t.height / 2 - (rect.top + rect.height / 2);
    const a = d.animate([{ transform: 'translate(0,0) scale(1)', opacity: 1, borderRadius: '12px' }, { transform: `translate(${dx * .6}px,${dy * .5 - 40}px) scale(.5)`, opacity: .9, offset: .55 }, { transform: `translate(${dx}px,${dy}px) scale(.06)`, opacity: .3, borderRadius: '50%' }], { duration: 760, easing: 'cubic-bezier(.45,.05,.55,.95)' });
    a.onfinish = () => { d.remove(); const b = $('#cartBtn'); b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump'); };
  }

  // ---------- Réglages boutique ----------
  const waLink = text => `https://wa.me/${data.settings.whatsapp}${text ? '?text=' + encodeURIComponent(text) : ''}`;
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
    $('#kicker').textContent = s.tagline || '';
    const faq = $('#faqList'); faq.replaceChildren(...(s.faq || []).map(f => h('details', {}, h('summary', { text: f.q }), h('div', { text: f.a }))));
    reveal($$('.faq details'));
  }

  // ---------- Runway : file de looks ----------
  const SLOTS = [{ x: 12, s: 1, blur: 0, o: 1 }, { x: 46, s: .74, blur: 0, o: 1 }, { x: 59, s: .64, blur: 0, o: 1 }, { x: 70, s: .55, blur: 1.6, o: .85 }, { x: 79, s: .47, blur: 3, o: .6 }, { x: 87, s: .42, blur: 4.5, o: .38 }];
  const rw = { active: 0, figs: [], swiped: false, visible: false };
  function buildRunway() {
    const looks = data.looks; const sec = $('#runway'); sec.hidden = !looks.length; if (!looks.length) return;
    $('#ticks').replaceChildren(...looks.map(() => h('i')));
    rw.figs = looks.map((l, i) => h('button', { type: 'button', class: 'fig' + (l.photo ? ' photo' : ''), 'aria-label': `Look ${l.number} : ${l.name}`, onclick: () => { if (!rw.swiped && i !== rw.active) goLook(i); } },
      h('img', { src: l.img, alt: '', draggable: 'false', decoding: 'async', ...(i > 3 ? { loading: 'lazy' } : {}) })));
    $('#figures').replaceChildren(...rw.figs);
    rw.active = Math.min(rw.active, looks.length - 1);
    layoutRunway(); renderLook(true);
  }
  function layoutRunway() {
    const n = data.looks.length, W = $('#stage').clientWidth;
    rw.figs.forEach((f, i) => {
      const off = (i - rw.active + n) % n, slot = SLOTS[Math.min(off, SLOTS.length - 1)], hid = off >= SLOTS.length;
      f.style.transform = `translate3d(${(hid ? 100 : slot.x) / 100 * W}px,0,0) scale(${hid ? .3 : slot.s})`;
      f.style.filter = `blur(${hid ? 6 : slot.blur}px)`; f.style.opacity = hid ? 0 : slot.o;
      f.style.zIndex = 10 - Math.min(off, 9); f.style.pointerEvents = hid ? 'none' : 'auto'; f.style.cursor = off ? 'pointer' : 'default';
      f.tabIndex = off ? 0 : -1;
    });
  }
  function railCard(p) {
    const gros = false;
    const open = () => openProduct(p.id);
    return h('article', { class: 'rcard' },
      h('button', { class: 'heart' + (hearts.has(p.id) ? ' on' : ''), type: 'button', 'aria-pressed': hearts.has(p.id) ? 'true' : 'false', 'aria-label': 'Ajouter aux favoris : ' + p.name, text: hearts.has(p.id) ? '♥' : '♡',
        onclick: e => { hearts.has(p.id) ? hearts.delete(p.id) : hearts.add(p.id); store.set('kf_hearts', [...hearts]); const b = e.currentTarget; b.classList.toggle('on', hearts.has(p.id)); b.textContent = hearts.has(p.id) ? '♥' : '♡'; b.setAttribute('aria-pressed', hearts.has(p.id)); if (!REDUCED) b.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.5)' }, { transform: 'scale(1)' }], { duration: 380, easing: EASE }); } }),
      h('button', { class: 'open', type: 'button', onclick: open, 'aria-label': `${p.name}, choisir taille et couleur` }, h('img', { src: p.img, alt: p.name, loading: 'lazy' })),
      h('div', { class: 'row' }, h('div', {}, h('div', { class: 'nm', text: p.name }), h('div', { class: 'pr', text: fmt(p.priceRetail) }), h('div', { class: 'mq', text: `Gros dès ${p.wholesaleMin} pièces` })),
        h('button', { class: 'add', type: 'button', 'aria-label': 'Choisir ' + p.name, text: '+', onclick: open })));
  }
  function renderLook(first) {
    const l = data.looks[rw.active], st = $('#stage');
    const apply = () => {
      $('#title').textContent = l.collection; $('#desc').textContent = l.description || ''; $('#lookName').textContent = l.name;
      $('#lookNum').textContent = 'LOOK ' + String(l.number).padStart(2, '0');
      [...$('#ticks').children].forEach((t, i) => t.classList.toggle('on', i === rw.active));
      $('#rail').replaceChildren(...l.products.map(byId).filter(Boolean).map(railCard)); $('#rail').scrollTo(0, 0);
      st.classList.remove('swap');
    };
    if (first || REDUCED) return apply();
    st.classList.add('swap'); setTimeout(apply, 260);
  }
  function goLook(i) { const n = data.looks.length; rw.active = (i + n) % n; layoutRunway(); renderLook(); }
  function bindRunway() {
    const st = $('#stage');
    new IntersectionObserver(es => { rw.visible = es[0].isIntersecting; }, { threshold: 0.35 }).observe(st);
    addEventListener('keydown', e => {
      if (!rw.visible || document.querySelector('dialog[open]') || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
      if (e.key === 'ArrowRight') goLook(rw.active + 1); else if (e.key === 'ArrowLeft') goLook(rw.active - 1);
    });
    let lock = 0; // la molette ne détourne que le défilement horizontal : le défilement vertical de la page reste libre
    st.addEventListener('wheel', e => { if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return; e.preventDefault(); const t = Date.now(); if (t - lock < 650) return; lock = t; goLook(rw.active + (e.deltaX > 0 ? 1 : -1)); }, { passive: false });
    let sx = null, sy = 0;
    st.addEventListener('pointerdown', e => { sx = e.clientX; sy = e.clientY; rw.swiped = false; });
    addEventListener('pointerup', e => { if (sx == null) return; const dx = e.clientX - sx, dy = e.clientY - sy; sx = null; if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) { rw.swiped = true; setTimeout(() => { rw.swiped = false; }, 60); goLook(rw.active + (dx < 0 ? 1 : -1)); } });
    const cur = $('#cursor');
    st.addEventListener('pointermove', e => { const r = st.getBoundingClientRect(); cur.style.left = e.clientX - r.left + 'px'; cur.style.top = e.clientY - r.top + 'px'; });
    addEventListener('resize', layoutRunway);
    $('#prevLook').onclick = () => goLook(rw.active - 1); $('#nextLook').onclick = () => goLook(rw.active + 1);
    $('#shopLook').onclick = () => {
      const l = data.looks[rw.active]; if (l.products.length === 1) return openProduct(l.products[0]);
      const rail = $('#rail'); rail.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'nearest' });
      if (!REDUCED) $$('.rcard', rail).forEach((c, i) => c.animate([{ boxShadow: '0 0 0 0 #a0432a00' }, { boxShadow: 'inset 0 0 0 3px #a0432a' }, { boxShadow: '0 0 0 0 #a0432a00' }], { duration: 900, delay: i * 120, easing: EASE }));
    };
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
    const list = data.products.filter(p => (state.cat === 'all' || p.category === state.cat) && (!q || norm(p.name + ' ' + p.description + ' ' + (data.categories[p.category] || '')).includes(q)));
    const key = state.mode === 'gros' ? 'priceWholesale' : 'priceRetail';
    const sorts = { featured: (a, b) => (b.featured - a.featured) || (a.stock === 'out') - (b.stock === 'out'), new: (a, b) => b.createdAt.localeCompare(a.createdAt), asc: (a, b) => a[key] - b[key], desc: (a, b) => b[key] - a[key] };
    return list.sort(sorts[state.sort]);
  }
  function card(p) {
    const gros = state.mode === 'gros', imgs = imgsOf(p);
    const tags = h('div', { class: 'card-tags' }, p.featured && h('span', { class: 'badge gold', text: 'Vedette' }),
      p.stock === 'low' && h('span', { class: 'badge red', text: 'Peu de stock' }), p.stock === 'out' && h('span', { class: 'badge gray', text: 'Rupture' }));
    return h('button', { type: 'button', class: 'card' + (p.stock === 'out' ? ' out' : ''), 'aria-label': `${p.name}, voir le détail`, onclick: () => openProduct(p.id) },
      h('div', { class: 'card-img' }, h('img', { class: 'i1', src: p.img, alt: p.name, loading: 'lazy', width: 300, height: 375 }),
        imgs.length > 1 && h('img', { class: 'i2', src: imgs[1].url, alt: '', loading: 'lazy', width: 300, height: 375 }), tags),
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
    const cards = list.map(card); g.replaceChildren(...cards); reveal(cards);
  }

  // ---------- Fiche produit (galerie + couleurs liées aux photos) ----------
  const pd = { p: null };
  function showImg(url, instant) {
    const stage = $('#pStage'), cur = $$('.pimg', stage).pop();
    if (cur && cur.getAttribute('src') === url) return;
    const n = h('img', { class: 'pimg', src: url, alt: pd.p ? pd.p.name : '', width: 480, height: 600 }); stage.append(n);
    if (instant || REDUCED || !cur) { $$('.pimg', stage).filter(x => x !== n).forEach(x => x.remove()); return; }
    const a = n.animate([{ opacity: 0, transform: 'scale(1.06)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 520, easing: EASE });
    a.onfinish = () => $$('.pimg', stage).filter(x => x !== n).forEach(x => x.remove());
  }
  function syncThumbs(url) { $$('#pThumbs button').forEach(b => b.setAttribute('aria-current', b.dataset.url === url ? 'true' : 'false')); }
  function openProduct(id) {
    const p = byId(id); if (!p) return; pd.p = p; const imgs = imgsOf(p);
    $('#pTitle').textContent = p.name; $('#pDesc').textContent = p.description || '';
    $$('#pStage .pimg').forEach(x => x.remove()); showImg(imgs[0].url, true);
    $('#pThumbs').replaceChildren(...(imgs.length > 1 ? imgs.map((g, i) => h('button', { type: 'button', class: 'thumb', 'data-url': g.url, 'aria-label': `Photo ${i + 1}${g.color ? ' : ' + g.color : ''}`, 'aria-current': i === 0 ? 'true' : 'false',
      onclick: () => { showImg(g.url); syncThumbs(g.url); if (g.color) { const r = $(`#pColors input[value="${CSS.escape(g.color)}"]`); if (r) { r.checked = true; updateProduct(); } } } }, h('img', { src: g.url, alt: '', loading: 'lazy' }))) : []));
    const fillChips = (box, name, vals, labeler) => {
      const fs = $('#' + box); fs.hidden = !vals.length;
      $('.chips', fs).replaceChildren(...vals.map((v, i) => h('label', { class: 'chip' }, h('input', { type: 'radio', name, value: v, checked: vals.length === 1 || (name === 'color' && i === 0) }), h('span', {}, labeler(v)))));
    };
    fillChips('pSizes', 'size', p.sizes, v => v);
    fillChips('pColors', 'color', p.colors, v => { const d = h('span', { class: 'dot' }); d.style.background = data.palette[v]; return [d, v]; });
    const c0 = ($('input[name=color]:checked') || {}).value; const g0 = imgs.find(g => g.color === c0); if (g0) { showImg(g0.url, true); syncThumbs(g0.url); }
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
    const sz = $('input[name=size]:checked'), co = $('input[name=color]:checked');
    $('#pWa').href = waLink(`Bonjour ${data.settings.shopName} 👋 Je suis intéressé par : ${p.name}${sz ? ', taille ' + sz.value : ''}${co ? ', ' + co.value : ''}. Est-il disponible ?`);
  }
  $('#pQty').addEventListener('input', updateProduct);
  $('#pForm').addEventListener('change', e => {
    updateProduct();
    if (e.target.name === 'color' && pd.p) { const g = imgsOf(pd.p).find(x => x.color === e.target.value); if (g) { showImg(g.url); syncThumbs(g.url); } }
  });
  $$('[data-step]', $('#pForm')).forEach(b => b.addEventListener('click', () => { const i = $('#pQty'); i.value = Math.max(1, Math.min(5000, (parseInt(i.value, 10) || 1) + +b.dataset.step)); updateProduct(); }));
  $('#pForm').addEventListener('submit', e => {
    e.preventDefault(); const p = pd.p; const err = $('#pErr'); err.textContent = '';
    const size = ($('input[name=size]:checked') || {}).value || '', color = ($('input[name=color]:checked') || {}).value || '';
    if (p.sizes.length && !size) { err.textContent = 'Choisissez une taille.'; return; }
    const qty = Math.min(5000, Math.max(1, parseInt($('#pQty').value, 10) || 1));
    const ex = cart.find(l => l.id === p.id && l.size === size && l.color === color);
    if (ex) ex.qty = Math.min(5000, ex.qty + qty); else if (cart.length >= 30) { err.textContent = 'Panier plein (30 lignes max).'; return; } else cart.push({ id: p.id, size, color, qty });
    const rect = $$('#pStage .pimg').pop()?.getBoundingClientRect(), url = $$('#pStage .pimg').pop()?.getAttribute('src');
    saveCart(); renderCart(); $('#productDlg').close(); fly(rect, url); toast(`${p.name} ajouté au panier`, 'ok-t');
  });

  // ---------- Panier ----------
  let lastTotal = 0;
  function renderCart() {
    cart = cart.filter(l => byId(l.id));
    $('#cartCount').textContent = cart.reduce((s, l) => s + l.qty, 0);
    $('#cartEmpty').hidden = !!cart.length || !$('#cartDone').hidden; $('#cartFull').hidden = !cart.length;
    if (!cart.length) { lastTotal = 0; return; }
    let total = 0, saved = 0;
    const items = cart.map((l, i) => {
      const p = byId(l.id), u = unitPrice(p, l.qty), g = l.qty >= p.wholesaleMin; total += u * l.qty; saved += (p.priceRetail - u) * l.qty;
      const missing = p.wholesaleMin - l.qty;
      const set = q => { l.qty = Math.max(1, Math.min(5000, q)); saveCart(); renderCart(); };
      const gi = imgsOf(p).find(x => x.color === l.color) || imgsOf(p)[0];
      return h('li', { class: 'line' }, h('img', { src: gi.url, alt: '', width: 64, height: 64 }),
        h('div', {}, h('div', { class: 'nm', text: p.name }), h('div', { class: 'meta', text: [l.size && 'Taille ' + l.size, l.color].filter(Boolean).join(' · ') }),
          h('div', { class: 'stepper' }, h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Diminuer', onclick: () => set(l.qty - 1), text: '−' }),
            h('input', { class: 'input qty', type: 'number', min: 1, max: 5000, value: l.qty, 'aria-label': 'Quantité', onchange: e => set(parseInt(e.target.value, 10) || 1) }),
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Augmenter', onclick: () => set(l.qty + 1), text: '+' })),
          g ? h('span', { class: 'badge green', text: 'Prix de gros' }) : h('span', { class: 'badge gold', text: `+${missing} pour le gros` }),
          h('div', {}, h('button', { type: 'button', class: 'rm', onclick: () => { cart.splice(i, 1); saveCart(); renderCart(); }, text: 'Retirer' }))),
        h('div', { class: 'lp' }, fmt(u * l.qty), h('small', { text: `${fmt(u)} /pièce` })));
    });
    $('#cartLines').replaceChildren(...items); tween($('#cartTotal'), total, lastTotal); lastTotal = total;
    const sv = $('#cartSave'); sv.hidden = saved <= 0; sv.textContent = `Vous économisez ${fmt(saved)} grâce aux prix de gros`;
  }
  function openCart() { $('#cartDone').hidden = true; renderCart(); if (getConsent().remember) { const m = store.get('kf_me', {}); for (const k of ['name', 'phone', 'city']) { const el = $('#o' + k[0].toUpperCase() + k.slice(1)); if (m[k] && !el.value) el.value = m[k]; } } $('#cartDlg').showModal(); }
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

  $$('dialog').forEach(d => {
    d.addEventListener('click', e => { if (e.target === d || e.target.closest('[data-close]')) d.close(); });
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
  $('#prefClear').onclick = () => { ['kf_me', 'kf_consent', 'kf_cart', 'kf_mode', 'kf_hearts'].forEach(store.del); cart = []; hearts.clear(); renderCart(); if (data.looks.length) renderLook(true); $('#privacyDlg').close(); $('#cookieBar').hidden = false; toast('Données locales effacées'); };

  // ---------- Contrôles ----------
  let t; $('#q').addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => { state.q = e.target.value; renderGrid(); }, 150); });
  $('#sort').addEventListener('change', e => { state.sort = e.target.value; renderGrid(); });
  $$('input[name=mode]').forEach(r => { r.checked = r.value === state.mode; r.addEventListener('change', () => { state.mode = r.value; store.set('kf_mode', r.value); renderGrid(); }); });
  reveal($$('.steps li, .sec-head, .contact-grid > *'));

  // ---------- Démarrage ----------
  (async () => {
    try { data = await api('/api/catalog'); }
    catch { $('#grid').replaceChildren(h('p', { class: 'err', text: 'Impossible de charger le catalogue. Vérifiez votre connexion puis rechargez la page, ou écrivez-nous sur WhatsApp.' })); return; }
    applySettings(); buildRunway(); bindRunway(); renderCats(); renderGrid(); renderCart();
    if (!getConsent().v) $('#cookieBar').hidden = false;
  })();
})();
