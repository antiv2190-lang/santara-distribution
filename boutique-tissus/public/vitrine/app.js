// Vitrine client : accueil (collection, rubriques, recherche) et fiche produit (zoom, commande WhatsApp, partage).
// Les données de la boutique (nom, couleurs, WhatsApp...) viennent de window.__BOOT__.
(() => {
  const { h, fmt, api, toast, sheet, waIcon, UNIT, CAT } = T;
  const { base, shop } = window.__BOOT__;
  const app = document.getElementById('app');
  const unit = UNIT[shop.sale_unit] || '';
  const PAGE = 24;
  const isNew = (p) => Date.now() - new Date(p.created_at).getTime() < 14 * 864e5;

  // ---------- WhatsApp ----------
  const waLink = (text) => `https://wa.me/${shop.whatsapp}?text=${encodeURIComponent(text)}`;
  // Message exact demandé : « Bonjour, je souhaite commander : [nom] à [prix] FCFA. Lien : [lien] »
  // Sans prix affiché : on demande le prix dans le message.
  const orderLink = (p) => waLink(p.price > 0
    ? `Bonjour, je souhaite commander : ${p.name} à ${fmt(p.price, ' ')} FCFA. Lien : ${location.origin}${base}/p/${p.id}`
    : `Bonjour, je souhaite connaître le prix de : ${p.name}. Lien : ${location.origin}${base}/p/${p.id}`);

  // ---------- Éléments communs ----------
  function logo() {
    return h('div', { class: 'logo' }, shop.logo_url
      ? h('img', { src: shop.logo_url, alt: '', width: 48, height: 48 })
      : (shop.name.trim()[0] || 'T').toUpperCase());
  }
  function header() {
    return h('header', { class: 'top' }, h('div', { class: 'wrap' },
      logo(),
      h('a', { class: 'brand', href: base, onclick: (e) => { e.preventDefault(); go(base); } },
        h('h1', {}, shop.name),
        h('small', {}, [shop.owner ? `Chez ${shop.owner}` : '', shop.city].filter(Boolean).join(' · '), shop.tagline ? h('span', { class: 'tg' }, ' · ' + shop.tagline) : null)),
      h('a', { class: 'top-wa', href: waLink('Bonjour, j\'ai une question sur vos tissus.'), target: '_blank', rel: 'noopener', 'aria-label': 'WhatsApp' }, waIcon(20), h('span', {}, 'WhatsApp'))));
  }
  function fab(text) {
    return h('a', { class: 'fab', href: waLink(text || 'Bonjour, j\'ai une question sur vos tissus.'), target: '_blank', rel: 'noopener', 'aria-label': 'Écrire sur WhatsApp' }, waIcon(32));
  }
  function footer() {
    const num = (n) => `+${n.slice(0, 3)} ${n.slice(3).replace(/(\d{2})(?=\d)/g, '$1 ')}`;
    return h('footer', { class: 'foot' },
      h('div', { class: 'foot-name' }, shop.name), shop.owner ? h('div', {}, `Chez ${shop.owner}`) : null,
      shop.tagline ? h('div', {}, shop.tagline) : null,
      h('div', {}, [shop.address, shop.city].filter(Boolean).join(' · ')),
      h('div', { class: 'foot-tel' },
        h('a', { href: `https://wa.me/${shop.whatsapp}`, target: '_blank', rel: 'noopener' }, `WhatsApp : ${num(shop.whatsapp)}`),
        shop.phone2 ? [' · ', h('a', { href: `tel:+${shop.phone2}` }, `Tél. : ${num(shop.phone2)}`)] : null));
  }
  // Prix à 0 = « prix sur demande »
  const priceParts = (p) => (p.price > 0 ? [`${fmt(p.price)} FCFA`, unit ? h('small', {}, ` / ${unit}`) : null] : [h('span', { class: 'ask' }, 'Prix sur demande')]);
  const priceNode = (p) => h('div', { class: 'pr' }, ...priceParts(p));
  function card(p) {
    return h('a', { class: 'card', href: `${base}/p/${p.id}`, onclick: (e) => { e.preventDefault(); go(`${base}/p/${p.id}`); } },
      h('div', { class: 'ph' }, h('img', { src: p.thumb, alt: p.name, loading: 'lazy', width: 600, height: 600 }),
        p.sold_out ? h('span', { class: 'badge' }, 'Épuisé') : isNew(p) ? h('span', { class: 'badge new' }, 'Nouveau') : null),
      h('div', { class: 'body' }, h('div', { class: 'cat-s' }, CAT[p.category] || ''), h('div', { class: 'nm' }, p.name), priceNode(p)));
  }

  // ---------- Navigation (sans rechargement) ----------
  function go(url) { history.pushState({}, '', url); route(); window.scrollTo(0, 0); }
  window.addEventListener('popstate', route);
  function route() {
    const path = location.pathname.replace(/\/$/, '');
    const m = path.match(/\/p\/([0-9a-f-]{36})$/i);
    m ? productPage(m[1]) : homePage();
  }

  // ---------- Accueil ----------
  function homePage() {
    document.title = shop.name;
    const qs = new URLSearchParams(location.search);
    const st = { cat: CAT[qs.get('cat')] ? qs.get('cat') : '', q: qs.get('q') || '', offset: 0, total: 0, busy: false };

    const grid = h('div', { class: 'grid' });
    const more = h('button', { class: 'btn ghost more hidden' }, 'Voir plus de tissus');
    const search = h('input', { class: 'search', type: 'search', placeholder: '🔍  Rechercher un tissu…', value: st.q, 'aria-label': 'Rechercher' });
    const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Rubriques' });
    const count = h('div', { class: 'count' });
    let counts = null;

    function drawChips() {
      // Seules les rubriques qui ont des tissus sont proposées
      const items = [['', 'Tous', counts?.total]].concat(Object.entries(CAT).filter(([k]) => !counts || counts.counts[k] > 0).map(([k, l]) => [k, l, counts?.counts[k]]));
      chips.replaceChildren(...items.map(([k, label, n]) =>
        h('button', { class: 'chip', 'aria-pressed': String(st.cat === k), onclick: () => { st.cat = k; sync(); load(true); drawChips(); } }, label, n != null ? h('em', {}, n) : null)));
    }
    function sync() { // garde les filtres dans l'adresse (partage possible)
      const p = new URLSearchParams(); if (st.cat) p.set('cat', st.cat); if (st.q) p.set('q', st.q);
      history.replaceState({}, '', base + (p.toString() ? '?' + p : ''));
    }
    async function load(reset) {
      if (st.busy) return;
      st.busy = true;
      if (reset) { st.offset = 0; grid.replaceChildren(...Array.from({ length: 6 }, () => h('div', { class: 'sk' }))); }
      more.disabled = true;
      try {
        const u = new URLSearchParams({ limit: PAGE, offset: st.offset });
        if (st.cat) u.set('cat', st.cat);
        if (st.q) u.set('q', st.q);
        const r = await api(`/api/shops/${shop.slug}/products?${u}`);
        if (reset) grid.replaceChildren();
        r.items.forEach((p) => grid.append(card(p)));
        st.offset += r.items.length; st.total = r.total;
        count.textContent = r.total ? `${r.total} tissu${r.total > 1 ? 's' : ''}` : '';
        if (!r.total) grid.replaceChildren(h('div', { class: 'empty', style: 'grid-column:1/-1' }, st.q || st.cat ? 'Aucun tissu ne correspond à votre recherche.' : 'Les premiers tissus arrivent très bientôt.'));
      } catch (e) {
        grid.replaceChildren(h('div', { class: 'empty', style: 'grid-column:1/-1' }, e.message, h('br'), h('button', { class: 'btn ghost', onclick: () => load(true) }, 'Réessayer')));
      }
      st.busy = false; more.disabled = false;
      more.classList.toggle('hidden', st.offset >= st.total);
    }
    more.onclick = () => load(false);
    let timer;
    search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { st.q = search.value.trim(); sync(); load(true); }, 300); });

    const perks = [['📸', 'Photos fidèles', 'Les couleurs réelles du tissu'], ['💬', 'Commande simple', 'Un message WhatsApp suffit'], ['📍', shop.city || 'Boutique', shop.address || 'Venez voir sur place']];
    app.replaceChildren(
      header(),
      h('section', { class: 'hero' },
        h('div', { class: 'wrap' },
          h('div', { class: 'eyebrow' }, [shop.owner ? `Chez ${shop.owner}` : 'Boutique de tissus', shop.city].filter(Boolean).join(' · ')),
          h('h2', {}, 'Des tissus d\'exception pour vos plus belles cérémonies'),
          h('p', {}, shop.about || (shop.tagline ? `${shop.tagline}. ` : '') + 'Choisissez votre tissu en photos, commandez en un message WhatsApp.'),
          h('div', { class: 'hero-cta' },
            h('a', { class: 'btn accent', href: '#collection', onclick: (e) => { e.preventDefault(); document.getElementById('collection').scrollIntoView({ behavior: 'smooth' }); } }, 'Voir la collection'),
            h('a', { class: 'btn ghost-light', href: waLink('Bonjour, je cherche un tissu pour une cérémonie.'), target: '_blank', rel: 'noopener' }, waIcon(20), 'Parler sur WhatsApp')))),
      h('section', { class: 'perks' }, h('div', { class: 'wrap perks-in' }, perks.map(([i, t, d]) => h('div', { class: 'perk' }, h('span', {}, i), h('div', {}, h('strong', {}, t), h('small', {}, d)))))),
      h('main', { class: 'wrap', id: 'collection' }, h('div', { class: 'tools' }, search, chips, count), grid, more),
      footer(), fab());
    drawChips(); load(true);
    api(`/api/shops/${shop.slug}/categories`).then((c) => { counts = c; drawChips(); }).catch(() => {});
  }

  // ---------- Zoom plein écran (pincer pour agrandir) ----------
  function lightbox(src, alt) {
    const box = h('div', { class: 'lb', onclick: () => box.remove() },
      h('button', { class: 'lb-x', 'aria-label': 'Fermer' }, '✕'), h('img', { src, alt }));
    document.body.append(box);
  }

  // ---------- Fiche produit ----------
  async function productPage(id) {
    app.replaceChildren(header(), h('main', { class: 'wrap' }, h('a', { class: 'back', href: base, onclick: (e) => { e.preventDefault(); go(base); } }, '← Tous les tissus'),
      h('div', { class: 'sk', style: 'aspect-ratio:1;max-width:560px' })));
    let p;
    try { p = await api(`/api/shops/${shop.slug}/products/${id}`); }
    catch (e) {
      app.replaceChildren(header(), h('main', { class: 'wrap' }, h('div', { class: 'empty' }, e.status === 404 ? 'Ce tissu n\'est plus disponible.' : e.message, h('br'),
        h('button', { class: 'btn', onclick: () => go(base) }, 'Voir tous les tissus'))), fab());
      return;
    }
    document.title = `${p.name} — ${shop.name}`;

    // Galerie : photo mise en valeur + photo d'origine (les vraies couleurs du tissu)
    const slides = [{ src: p.image, cap: null }];
    if (p.original && p.original !== p.image) slides.push({ src: p.original, cap: 'Photo d\'origine' });
    const dots = h('div', { class: 'dots' }, slides.map((_, i) => h('i', { class: i ? '' : 'on' })));
    const gal = h('div', { class: 'gal' }, slides.map((s, i) =>
      h('div', { class: 'slide', onclick: () => lightbox(s.src, p.name) },
        h('img', { src: s.src, alt: p.name, width: 900, height: 900, ...(i ? { loading: 'lazy' } : {}) }),
        s.cap ? h('span', { class: 'cap' }, s.cap) : null, h('span', { class: 'zoom' }, '⤢ Agrandir'))));
    gal.addEventListener('scroll', () => {
      const i = Math.round(gal.scrollLeft / gal.clientWidth);
      [...dots.children].forEach((d, j) => d.classList.toggle('on', i === j));
    }, { passive: true });

    const orderBtn = (cls) => p.sold_out
      ? h('button', { class: `btn ${cls || ''} block`, disabled: true }, 'Épuisé pour le moment')
      : h('a', { class: `btn block wa ${cls || ''}`, href: orderLink(p), target: '_blank', rel: 'noopener' }, waIcon(24), p.price > 0 ? 'Commander sur WhatsApp' : 'Demander le prix sur WhatsApp');
    const similar = h('section', { class: 'similar hidden' }, h('h3', {}, 'Dans la même collection'));
    const simGrid = h('div', { class: 'grid' });
    similar.append(simGrid);

    app.replaceChildren(
      header(),
      h('main', { class: 'wrap' },
        h('a', { class: 'back', href: base, onclick: (e) => { e.preventDefault(); go(base); } }, '← Tous les tissus'),
        h('article', { class: 'pdp' },
          h('div', {}, gal, slides.length > 1 ? dots : null),
          h('div', { class: 'info' },
            h('div', { class: 'cat' }, CAT[p.category] || ''),
            h('h1', {}, p.name),
            h('div', { class: 'price' }, ...priceParts(p)),
            h('span', { class: 'avail' + (p.sold_out ? ' out' : '') }, p.sold_out ? 'Épuisé' : '● Disponible'),
            p.description ? h('p', { class: 'desc' }, p.description) : null,
            h('ul', { class: 'assure' }, h('li', {}, '📸 Photos fidèles aux couleurs du tissu'), h('li', {}, '💬 Réponse sur WhatsApp, commande en un message')),
            h('div', { class: 'actions' }, orderBtn(), h('button', { class: 'btn block ghost', onclick: () => share(p) }, '↗  Partager')))),
        similar),
      footer(),
      // Barre de commande toujours visible sur téléphone
      h('div', { class: 'buybar' }, h('div', {}, h('strong', {}, p.price > 0 ? `${fmt(p.price)} FCFA` : 'Prix sur demande'), p.price > 0 && unit ? h('small', {}, ` / ${unit}`) : null), orderBtn('compact')));

    // Tissus de la même rubrique
    api(`/api/shops/${shop.slug}/products?cat=${p.category}&limit=5`).then((r) => {
      const others = r.items.filter((x) => x.id !== p.id).slice(0, 4);
      if (others.length) { others.forEach((o) => simGrid.append(card(o))); similar.classList.remove('hidden'); }
    }).catch(() => {});
  }

  // ---------- Partage (WhatsApp / Facebook / lien) ----------
  function share(p) {
    const url = `${location.origin}${base}/p/${p.id}`;
    const text = `${p.name}${p.price > 0 ? ` — ${fmt(p.price, ' ')} FCFA` : ''} · ${shop.name}`;
    const s = sheet([
      h('h2', {}, 'Partager ce tissu'),
      h('div', { class: 'share-row' },
        h('a', { class: 'btn block wa', target: '_blank', rel: 'noopener', href: `https://wa.me/?text=${encodeURIComponent(text + '\n' + url)}` }, waIcon(22), 'WhatsApp'),
        h('a', { class: 'btn block', style: 'background:#1877f2;color:#fff', target: '_blank', rel: 'noopener', href: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}` }, 'Facebook'),
        navigator.share ? h('button', { class: 'btn block ghost', onclick: () => navigator.share({ title: p.name, text, url }).catch(() => {}) }, 'Autres applications…') : null,
        h('button', { class: 'btn block ghost', onclick: async () => {
          try { await navigator.clipboard.writeText(url); toast('Lien copié ✓'); } catch { toast('Copiez : ' + url, false, 5000); }
          s.close();
        } }, 'Copier le lien')),
      h('button', { class: 'btn block ghost', onclick: () => s.close() }, 'Fermer'),
    ]);
  }

  T.registerSW();
  route();
})();
