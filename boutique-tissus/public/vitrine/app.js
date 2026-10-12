// Vitrine client : accueil (grille + filtres + recherche) et fiche produit.
// Les données de la boutique (nom, couleurs, WhatsApp...) viennent de window.__BOOT__.
(() => {
  const { h, fmt, api, toast, sheet, waIcon, UNIT, CAT } = T;
  const { base, shop } = window.__BOOT__;
  const app = document.getElementById('app');
  const unit = UNIT[shop.sale_unit] || '';
  const PAGE = 24;

  // ---------- WhatsApp ----------
  const waLink = (text) => `https://wa.me/${shop.whatsapp}?text=${encodeURIComponent(text)}`;
  // Message exact demandé : « Bonjour, je souhaite commander : [nom] à [prix] FCFA. Lien : [lien] »
  const orderLink = (p) =>
    waLink(`Bonjour, je souhaite commander : ${p.name} à ${fmt(p.price, ' ')} FCFA. Lien : ${location.origin}${base}/p/${p.id}`);

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
        h('small', {}, [shop.city, shop.tagline].filter(Boolean).join(' · ')))));
  }
  function fab(text) {
    return h('a', { class: 'fab', href: waLink(text || 'Bonjour, j\'ai une question sur vos tissus.'), target: '_blank', rel: 'noopener', 'aria-label': 'Écrire sur WhatsApp' }, waIcon(32));
  }
  function footer() {
    return h('footer', { class: 'foot' },
      h('strong', {}, shop.name), shop.city ? ` — ${shop.city}` : '',
      h('div', {}, h('a', { href: `https://wa.me/${shop.whatsapp}`, target: '_blank', rel: 'noopener' }, `WhatsApp : +${shop.whatsapp}`)));
  }
  const priceNode = (p) => h('div', { class: 'pr' }, `${fmt(p.price)} FCFA`, unit ? h('small', {}, ` / ${unit}`) : null);

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
    const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Catégories' });

    function drawChips() {
      chips.replaceChildren(...[['', 'Tous'], ...Object.entries(CAT)].map(([k, label]) =>
        h('button', { class: 'chip', 'aria-pressed': String(st.cat === k), onclick: () => { st.cat = k; sync(); load(true); drawChips(); } }, label)));
    }
    function sync() { // garde les filtres dans l'adresse (partage possible)
      const p = new URLSearchParams(); if (st.cat) p.set('cat', st.cat); if (st.q) p.set('q', st.q);
      history.replaceState({}, '', base + (p.size ? '?' + p : ''));
    }
    function card(p) {
      return h('a', { class: 'card', href: `${base}/p/${p.id}`, onclick: (e) => { e.preventDefault(); go(`${base}/p/${p.id}`); } },
        h('div', { class: 'ph' }, h('img', { src: p.thumb, alt: p.name, loading: 'lazy', width: 600, height: 600 }), p.sold_out ? h('span', { class: 'badge' }, 'Épuisé') : null),
        h('div', { class: 'body' }, h('div', { class: 'nm' }, p.name), priceNode(p)));
    }
    async function load(reset) {
      if (st.busy) return;
      st.busy = true;
      if (reset) { st.offset = 0; grid.replaceChildren(...Array.from({ length: 6 }, () => h('div', { class: 'sk' }))); }
      more.disabled = true;
      try {
        const u = new URLSearchParams({ limit: PAGE, offset: st.offset });
        if (st.cat) u.set('cat', st.cat); if (st.q) u.set('q', st.q);
        const r = await api(`/api/shops/${shop.slug}/products?${u}`);
        if (reset) grid.replaceChildren();
        r.items.forEach((p) => grid.append(card(p)));
        st.offset += r.items.length; st.total = r.total;
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

    app.replaceChildren(
      header(),
      h('section', { class: 'hero' }, h('h2', {}, 'Tissus d\'exception'), h('p', {}, 'Basin, broderies, wax et bazin — commandez en un message WhatsApp.'), h('div', { class: 'rule' })),
      h('main', { class: 'wrap' }, h('div', { class: 'tools' }, search, chips), grid, more),
      footer(), fab());
    drawChips(); load(true);
  }

  // ---------- Fiche produit ----------
  async function productPage(id) {
    app.replaceChildren(header(), h('main', { class: 'wrap' }, h('a', { class: 'back', href: base, onclick: (e) => { e.preventDefault(); go(base); } }, '← Tous les tissus'),
      h('div', { class: 'sk', style: 'aspect-ratio:1;max-width:560px' })), fab());
    let p;
    try { p = await api(`/api/shops/${shop.slug}/products/${id}`); }
    catch (e) {
      app.replaceChildren(header(), h('main', { class: 'wrap' }, h('div', { class: 'empty' }, e.status === 404 ? 'Ce tissu n\'est plus disponible.' : e.message, h('br'),
        h('button', { class: 'btn', onclick: () => go(base) }, 'Voir tous les tissus'))), fab());
      return;
    }
    document.title = `${p.name} — ${shop.name}`;

    // Galerie : photo améliorée + photo d'origine (couleurs réelles du tissu)
    const slides = [{ src: p.image, cap: null }];
    if (p.original && p.original !== p.image) slides.push({ src: p.original, cap: 'Photo d\'origine' });
    const dots = h('div', { class: 'dots' }, slides.map((_, i) => h('i', { class: i ? '' : 'on' })));
    const gal = h('div', { class: 'gal' }, slides.map((s, i) =>
      h('div', { class: 'slide' }, h('img', { src: s.src, alt: p.name, width: 900, height: 900, ...(i ? { loading: 'lazy' } : {}) }), s.cap ? h('span', { class: 'cap' }, s.cap) : null)));
    gal.addEventListener('scroll', () => {
      const i = Math.round(gal.scrollLeft / gal.clientWidth);
      [...dots.children].forEach((d, j) => d.classList.toggle('on', i === j));
    }, { passive: true });

    const order = p.sold_out
      ? h('button', { class: 'btn block', disabled: true }, 'Épuisé pour le moment')
      : h('a', { class: 'btn block wa', href: orderLink(p), target: '_blank', rel: 'noopener' }, waIcon(24), 'Commander sur WhatsApp');

    app.replaceChildren(
      header(),
      h('main', { class: 'wrap' },
        h('a', { class: 'back', href: base, onclick: (e) => { e.preventDefault(); go(base); } }, '← Tous les tissus'),
        h('article', { class: 'pdp' },
          h('div', {}, gal, slides.length > 1 ? dots : null),
          h('div', { class: 'info' },
            h('div', { class: 'cat' }, CAT[p.category] || ''),
            h('h1', {}, p.name),
            h('div', { class: 'price' }, `${fmt(p.price)} FCFA`, unit ? h('small', {}, ` / ${unit}`) : null),
            h('span', { class: 'avail' + (p.sold_out ? ' out' : '') }, p.sold_out ? 'Épuisé' : '● Disponible'),
            p.description ? h('p', { class: 'desc' }, p.description) : null,
            h('div', { class: 'actions' }, order, h('button', { class: 'btn block ghost', onclick: () => share(p) }, '↗  Partager'))))),
      footer(), fab(`Bonjour, j'ai une question sur : ${p.name}`));
  }

  // ---------- Partage (WhatsApp / Facebook / lien) ----------
  function share(p) {
    const url = `${location.origin}${base}/p/${p.id}`;
    const text = `${p.name} — ${fmt(p.price, ' ')} FCFA · ${shop.name}`;
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
