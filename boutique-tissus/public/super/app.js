// Tableau de bord super-admin : créer une nouvelle boutique en quelques clics.
(() => {
  const { h, api, toast, sheet, confirmBox, UNIT } = T;
  const app = document.getElementById('app');
  const PRESETS = [
    ['Or & noir', '#0b0b0b', '#c9a227'], ['Vert & or', '#0f3d2e', '#d4af37'], ['Bordeaux & or', '#5b1020', '#d4af37'],
    ['Bleu nuit & argent', '#0d1b3d', '#c0c8d6'], ['Ivoire & or', '#f7f1e3', '#b8912f'],
  ];
  const slugify = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
  const randomPin = () => String(Math.floor(1000 + Math.random() * 9000));
  const origin = location.origin;

  // ---------- Connexion ----------
  function login(msg) {
    const code = h('input', { type: 'password', placeholder: 'Code super-admin', autocomplete: 'current-password' });
    const err = h('div', { class: 'err' }, msg || '');
    const go = async () => {
      try { await api('/api/super/login', { method: 'POST', json: { code: code.value } }); dashboard(); }
      catch (e) { err.textContent = e.message; }
    };
    code.addEventListener('keydown', (e) => e.key === 'Enter' && go());
    app.replaceChildren(h('div', { class: 'wrap', style: 'max-width:420px;padding-top:12vh' },
      h('h1', {}, 'Super-admin'), h('p', { style: 'color:var(--muted)' }, 'Gestion des boutiques'),
      h('label', { class: 'field' }, code), err, h('button', { class: 'btn block', onclick: go }, 'Entrer')));
  }

  // ---------- Formulaire boutique (création et modification) ----------
  function shopForm(initial, onSubmit, submitLabel) {
    const create = !initial;
    const v = initial || { name: '', city: 'Bamako', whatsapp: '', slug: '', sale_unit: 'metre', color_primary: PRESETS[0][1], color_accent: PRESETS[0][2], tagline: '', require_review: false };
    const f = {
      name: h('input', { value: v.name, placeholder: 'Ex. Tissus Diarra', maxlength: 60 }),
      city: h('input', { value: v.city, maxlength: 60 }),
      whatsapp: h('input', { type: 'tel', value: v.whatsapp ? '+' + v.whatsapp : '', placeholder: '+223 70 00 00 00' }),
      slug: h('input', { value: v.slug, placeholder: 'tissus-diarra', maxlength: 30, ...(create ? {} : { disabled: true }) }),
      tagline: h('input', { value: v.tagline || '', maxlength: 100, placeholder: 'Facultatif' }),
      primary: h('input', { type: 'color', value: v.color_primary }),
      accent: h('input', { type: 'color', value: v.color_accent }),
      logo: h('input', { type: 'file', accept: 'image/*' }),
      aphone: h('input', { type: 'tel', placeholder: '+223 76 00 00 00' }),
      apin: h('input', { value: create ? randomPin() : '', inputmode: 'numeric', maxlength: 8, placeholder: create ? '' : 'Laisser vide = inchangé' }),
      review: h('input', { type: 'checkbox', ...(v.require_review ? { checked: true } : {}) }),
      ai: h('input', { type: 'checkbox', ...(v.ai_auto === false ? {} : { checked: true }) }),
    };
    let unit = v.sale_unit, slugTouched = !create;
    f.name.addEventListener('input', () => { if (!slugTouched) f.slug.value = slugify(f.name.value); });
    f.slug.addEventListener('input', () => { slugTouched = true; });
    if (!create) f.aphone.value = '+' + v.admin_phone;

    const units = h('div', { class: 'units' });
    const UNIT_LABEL = { metre: 'Au mètre', piece: 'À la pièce', lot: 'Au lot' };
    const drawUnits = () => units.replaceChildren(...Object.keys(UNIT).map((k) => h('button', { type: 'button', class: unit === k ? 'on' : '', onclick: () => { unit = k; drawUnits(); } }, UNIT_LABEL[k])));
    drawUnits();
    const presets = h('div', { class: 'presets' }, PRESETS.map(([label, p, a]) => h('button', { type: 'button', onclick: () => { f.primary.value = p; f.accent.value = a; } },
      h('span', { class: 'dotc', style: `background:${p};border-color:${a}` }), label)));
    const err = h('div', { class: 'err' });
    const submit = h('button', { class: 'btn block', onclick: async () => {
      err.textContent = ''; submit.disabled = true;
      try {
        const body = { name: f.name.value, city: f.city.value, whatsapp: f.whatsapp.value, sale_unit: unit, tagline: f.tagline.value,
          color_primary: f.primary.value, color_accent: f.accent.value, require_review: f.review.checked, ai_auto: f.ai.checked };
        if (create) { body.slug = f.slug.value; body.admin_phone = f.aphone.value; body.admin_pin = f.apin.value; }
        else { body.admin_phone = f.aphone.value; if (f.apin.value) body.admin_pin = f.apin.value; }
        await onSubmit(body, f.logo.files[0], f.apin.value);
      } catch (e) { err.textContent = e.message; }
      submit.disabled = false;
    } }, submitLabel);

    const L = (t, el) => h('label', { class: 'field' }, h('span', {}, t), el);
    return h('div', {},
      L('Nom de la boutique', f.name),
      h('div', { class: 'grid2' }, L('Ville', f.city), L('Numéro WhatsApp', f.whatsapp)),
      L('Adresse du site (/…)', f.slug),
      h('div', { class: 'field' }, h('span', {}, 'Vente'), units),
      h('div', { class: 'field' }, h('span', {}, 'Couleurs'), presets),
      h('div', { class: 'grid2' }, L('Couleur principale', f.primary), L('Couleur d\'accent', f.accent)),
      L('Logo (facultatif)', f.logo), L('Petite phrase sous le nom', f.tagline),
      h('h3', { style: 'margin:14px 0 4px' }, 'Connexion du propriétaire'),
      h('div', { class: 'grid2' }, L('Son téléphone', f.aphone), L('Son code (4 à 8 chiffres)', f.apin)),
      h('label', { style: 'display:flex;gap:10px;align-items:center;margin:10px 0' }, f.ai, '✨ L\'IA embellit les photos automatiquement (le propriétaire peut le changer)'),
      h('label', { style: 'display:flex;gap:10px;align-items:center;margin:10px 0' }, f.review, 'Publier seulement après validation du propriétaire'),
      err, submit);
  }

  async function uploadLogo(id, file) {
    if (!file) return;
    await api(`/api/super/shops/${id}/logo`, { method: 'POST', headers: { 'Content-Type': file.type || 'image/png' }, body: file });
  }

  // ---------- Tableau de bord ----------
  async function dashboard(freshResult) {
    let shops, defaultShop = '';
    try { shops = await api('/api/super/shops'); defaultShop = (await api('/api/super/me')).defaultShop; }
    catch (e) { return login(e.status === 401 ? '' : e.message); }

    const list = shops.length ? shops.map((s) => card(s)) : [h('p', { style: 'color:var(--muted)' }, 'Aucune boutique. Créez la première !')];
    app.replaceChildren(h('div', { class: 'wrap' },
      h('div', { class: 'bar' }, h('h1', {}, 'Mes boutiques'),
        h('button', { class: 'btn accent', onclick: createSheet }, '➕ Nouvelle boutique'),
        h('button', { class: 'btn ghost', onclick: async () => { await api('/api/super/logout', { method: 'POST' }); login(); } }, 'Sortir')),
      freshResult || null, ...list));

    function card(s) {
      const vit = `${origin}/${s.slug}`, adm = `${origin}/${s.slug}/admin`;
      return h('div', { class: 'shop' },
        h('div', { class: 'head' },
          h('div', { class: 'sw', style: `background:${s.color_primary};color:${s.color_accent};border-color:${s.color_accent}` }, s.logo_url ? h('img', { src: s.logo_url, alt: '' }) : (s.name[0] || 'T').toUpperCase()),
          h('div', { style: 'flex:1;min-width:0' }, h('h3', {}, s.name), h('small', {}, `/${s.slug} · ${s.city || ''} · ${s.product_count} tissu(s) · +${s.whatsapp}`)),
          h('span', { class: 'pill' + (s.active ? '' : ' off') }, s.active ? 'Active' : 'Désactivée')),
        h('div', { class: 'row' },
          h('a', { class: 'btn ghost', href: vit, target: '_blank', rel: 'noopener' }, 'Voir la vitrine'),
          h('a', { class: 'btn ghost', href: adm, target: '_blank', rel: 'noopener' }, 'Espace propriétaire'),
          h('button', { class: 'btn ghost', onclick: () => editSheet(s) }, 'Modifier'),
          h('button', { class: 'btn ghost', onclick: async () => {
            const on = !s.active;
            if (!on && !(await confirmBox(`Désactiver « ${s.name} » ? La vitrine ne sera plus visible.`, 'Désactiver'))) return;
            await api(`/api/super/shops/${s.id}`, { method: 'PATCH', json: { active: on } }); dashboard();
          } }, s.active ? 'Désactiver' : 'Réactiver')));
    }
    if (defaultShop && !shops.some((s) => s.slug === defaultShop)) toast(`DEFAULT_SHOP="${defaultShop}" ne correspond à aucune boutique.`, true, 4500);
  }

  function createSheet() {
    const s = sheet([h('h2', {}, 'Nouvelle boutique'), shopForm(null, async (body, logo, pin) => {
      const shop = await api('/api/super/shops', { method: 'POST', json: body });
      try { await uploadLogo(shop.id, logo); } catch { toast('Boutique créée, mais le logo n\'a pas pu être envoyé.', true, 4000); }
      s.close();
      const vit = `${origin}/${shop.slug}`, adm = `${origin}/${shop.slug}/admin`;
      const msg = `Bonjour ! Votre boutique en ligne est prête 🎉\nVitrine : ${vit}\nVotre espace : ${adm}\nTéléphone : +${shop.admin_phone}\nCode secret : ${pin}`;
      dashboard(h('div', { class: 'result' },
        h('strong', {}, `✅ « ${shop.name} » est créée !`),
        h('code', {}, 'Vitrine : ' + vit), h('code', {}, 'Espace propriétaire : ' + adm),
        h('code', {}, `Téléphone : +${shop.admin_phone}  ·  Code : ${pin}`),
        h('div', { class: 'row' },
          h('a', { class: 'btn wa', target: '_blank', rel: 'noopener', href: `https://wa.me/${shop.admin_phone}?text=${encodeURIComponent(msg)}` }, 'Envoyer au propriétaire (WhatsApp)'),
          h('button', { class: 'btn ghost', style: 'color:#fff;border-color:#555', onclick: () => navigator.clipboard?.writeText(msg).then(() => toast('Copié ✓')) }, 'Copier'))));
    }, 'Créer la boutique')]);
  }

  // Autres personnes autorisées à gérer la boutique (chacune avec son numéro et son code)
  function peopleBlock(shop) {
    const box = h('div', { style: 'margin-top:18px;border-top:2px solid var(--line);padding-top:12px' });
    const draw = (sh) => {
      const name = h('input', { placeholder: 'Nom (ex. Fodé Sacko)', maxlength: 60 });
      const phone = h('input', { type: 'tel', placeholder: '+223 66 00 00 00' });
      const pin = h('input', { value: randomPin(), inputmode: 'numeric', maxlength: 8 });
      const err = h('div', { class: 'err' });
      box.replaceChildren(
        h('h3', {}, 'Autres personnes autorisées'),
        ...(sh.admins.length ? sh.admins.map((a) => h('div', { class: 'row', style: 'align-items:center;justify-content:space-between' },
          h('span', {}, h('strong', {}, a.name), ` · +${a.phone}`),
          h('button', { class: 'btn ghost', onclick: async () => {
            if (!(await confirmBox(`Retirer ${a.name} ? Sa connexion cessera aussitôt.`, 'Retirer'))) return;
            draw(await api(`/api/super/shops/${sh.id}/admins/${a.phone}`, { method: 'DELETE' }));
          } }, 'Retirer'))) : [h('p', { style: 'color:var(--muted)' }, 'Aucune pour le moment.')]),
        h('div', { class: 'grid2', style: 'margin-top:10px' }, h('label', { class: 'field' }, h('span', {}, 'Nom'), name), h('label', { class: 'field' }, h('span', {}, 'Téléphone'), phone)),
        h('label', { class: 'field' }, h('span', {}, 'Code secret (4 à 8 chiffres) — à lui transmettre'), pin), err,
        h('button', { class: 'btn', onclick: async () => {
          err.textContent = '';
          try {
            const updated = await api(`/api/super/shops/${sh.id}/admins`, { method: 'POST', json: { name: name.value, phone: phone.value, pin: pin.value } });
            const msg = `Bonjour ${name.value} ! Vous pouvez gérer ${sh.name} :\n${origin}/${sh.slug}/admin\nTéléphone : ${phone.value}\nCode secret : ${pin.value}`;
            toast('Ajouté ✓');
            draw(updated);
            box.append(h('a', { class: 'btn wa', style: 'margin-top:10px', target: '_blank', rel: 'noopener', href: `https://wa.me/${updated.admins.find((x) => x.name === name.value.trim())?.phone || ''}?text=${encodeURIComponent(msg)}` }, 'Envoyer ses accès par WhatsApp'));
          } catch (e) { err.textContent = e.message; }
        } }, '➕ Ajouter cette personne'));
    };
    draw(shop);
    return box;
  }

  function editSheet(shop) {
    const s = sheet([h('h2', {}, 'Modifier ' + shop.name), shopForm(shop, async (body, logo) => {
      await api(`/api/super/shops/${shop.id}`, { method: 'PATCH', json: body });
      await uploadLogo(shop.id, logo);
      s.close(); toast('Enregistré ✓'); dashboard();
    }, 'Enregistrer'), peopleBlock(shop)]);
  }

  dashboard();
})();
