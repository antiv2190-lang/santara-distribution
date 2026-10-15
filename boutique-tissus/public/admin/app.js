// Espace propriétaire — conçu pour publier un tissu en moins de 15 secondes :
//   1) photo  ->  2) prix (clavier géant)  ->  3) « Publier »  ->  la caméra se rouvre (mode rafale).
// L'envoi des photos et le traitement IA se font en arrière-plan.
(() => {
  const { h, fmt, api: rawApi, toast, sheet, confirmBox, UNIT, CAT } = T;
  const { base, shop } = window.__BOOT__;
  const app = document.getElementById('app');
  const unit = UNIT[shop.sale_unit] || '';
  const shopUrl = () => location.origin + base;
  let cleanup = null;
  let installEvt = null;

  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; });

  // Appel API : si la session a expiré, on revient à l'écran de connexion.
  async function api(url, opts) {
    try { return await rawApi(url, opts); }
    catch (e) { if (e.status === 401) loginScreen(); throw e; }
  }

  // ---------- Navigation : le bouton « retour » du téléphone fonctionne ----------
  const screens = {};
  function show(name) { cleanup?.(); cleanup = (screens[name] || screens.home)() || null; }
  function nav(name) { history.pushState({ s: name }, ''); show(name); }
  window.addEventListener('popstate', (e) => show(e.state?.s || 'home'));

  // ---------- Connexion : numéro de téléphone -> code reçu -> c'est tout ----------
  // (le code secret reste possible en repli)
  function loginScreen(message) {
    cleanup?.(); cleanup = null;
    const root = h('div', { class: 'scr' });
    app.replaceChildren(root);
    let phone = '';
    let timer = null;
    const head = () => [
      h('div', { class: 'logo' }, shop.logo_url ? h('img', { src: shop.logo_url, alt: '' }) : (shop.name[0] || 'T').toUpperCase()),
      h('h1', {}, shop.name), h('p', { class: 'sub' }, 'Espace propriétaire'),
    ];
    const finish = () => { clearInterval(timer); Q.resume(); history.replaceState({ s: 'home' }, ''); show('home'); };

    // Étape 1 : le numéro
    function phoneStep(msg) {
      clearInterval(timer);
      const err = h('div', { class: 'err' }, msg || '');
      const input = h('input', { type: 'tel', inputmode: 'tel', autocomplete: 'tel', placeholder: 'Ex. 76 23 27 21', value: phone, style: 'font-size:1.5rem;text-align:center' });
      const go = h('button', { class: 'btn block green', style: 'min-height:72px;font-size:1.35rem', onclick: async () => {
        phone = input.value; err.textContent = ''; go.disabled = true;
        try {
          const r = await rawApi('/api/admin/otp/request', { method: 'POST', json: { slug: shop.slug, phone } });
          codeStep(r.dev_code);
        } catch (e) { err.textContent = e.message; go.disabled = false; }
      } }, '📲 Recevoir mon code');
      input.addEventListener('keydown', (e) => e.key === 'Enter' && go.click());
      root.replaceChildren(h('div', { class: 'login' }, ...head(),
        h('label', { class: 'field' }, h('span', {}, 'Votre numéro de téléphone'), input), err, go,
        h('div', { class: 'links' }, h('button', { onclick: () => pinStep() }, 'J\'ai un code secret'))));
    }

    // Étape 2 : le code à 6 chiffres, sur un clavier géant (validation automatique)
    function codeStep(devCode) {
      let digits = '';
      const err = h('div', { class: 'err' });
      const boxes = h('div', { class: 'codeboxes' }, Array.from({ length: 6 }, () => h('div', { class: 'codebox' })));
      const draw = () => [...boxes.children].forEach((b, i) => { b.textContent = digits[i] || ''; b.classList.toggle('on', i === digits.length); });
      async function submit() {
        try { await rawApi('/api/admin/otp/verify', { method: 'POST', json: { slug: shop.slug, phone, code: digits } }); finish(); }
        catch (e) { err.textContent = e.message; digits = ''; draw(); }
      }
      const press = (k) => {
        navigator.vibrate?.(8); err.textContent = '';
        if (k === 'del') digits = digits.slice(0, -1); else if (digits.length < 6) digits += k;
        draw(); if (digits.length === 6) submit();
      };
      const keys = h('div', { class: 'keys', style: 'height:44vh;flex:none' }, ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'].map((k) =>
        k === '' ? h('span') : h('button', { class: 'key' + (k === 'del' ? ' del' : ''), onclick: () => press(k) }, k === 'del' ? '⌫' : k)));
      const resend = h('button', { disabled: true }, '');
      let left = 30;
      const tick = () => { resend.disabled = left > 0; resend.textContent = left > 0 ? `Renvoyer le code (${left} s)` : '↻ Renvoyer le code'; left--; };
      tick(); timer = setInterval(tick, 1000);
      resend.onclick = async () => { try { const r = await rawApi('/api/admin/otp/request', { method: 'POST', json: { slug: shop.slug, phone } }); left = 30; toast('Nouveau code envoyé ✓'); if (r.dev_code) codeStep(r.dev_code); } catch (e) { err.textContent = e.message; } };
      root.replaceChildren(h('div', { class: 'login' },
        h('h1', {}, 'Entrez votre code'), h('p', { class: 'sub' }, `Envoyé au +${phone.replace(/\D/g, '')}`),
        devCode ? h('div', { class: 'banner' }, `🧪 Mode démo : votre code est ${devCode}`) : null,
        boxes, err, keys,
        h('div', { class: 'links' }, resend, h('button', { onclick: () => phoneStep() }, 'Changer de numéro'))));
      draw();
    }

    // Repli : code secret
    function pinStep() {
      clearInterval(timer);
      const err = h('div', { class: 'err' });
      const input = h('input', { type: 'tel', inputmode: 'tel', placeholder: 'Votre numéro', value: phone });
      const pin = h('input', { type: 'password', inputmode: 'numeric', autocomplete: 'current-password', placeholder: '••••', maxlength: 8 });
      const go = h('button', { class: 'btn block', style: 'min-height:68px;font-size:1.3rem', onclick: async () => {
        err.textContent = ''; go.disabled = true;
        try { await rawApi('/api/admin/login', { method: 'POST', json: { slug: shop.slug, phone: input.value, pin: pin.value } }); finish(); }
        catch (e) { err.textContent = e.message; go.disabled = false; }
      } }, 'Se connecter');
      pin.addEventListener('keydown', (e) => e.key === 'Enter' && go.click());
      root.replaceChildren(h('div', { class: 'login' }, ...head(),
        h('label', { class: 'field' }, h('span', {}, 'Votre numéro de téléphone'), input),
        h('label', { class: 'field' }, h('span', {}, 'Votre code secret'), pin), err, go,
        h('div', { class: 'links' }, h('button', { onclick: () => phoneStep() }, '← Recevoir un code par message'))));
    }
    phoneStep(message);
  }

  // ---------- Clavier numérique géant (partagé : ajout et changement de prix) ----------
  function keypad(initial, onChange) {
    let digits = String(initial || '').replace(/\D/g, '');
    const num = h('b', {});
    const draw = () => { num.textContent = digits ? fmt(digits) : '0'; onChange?.(Number(digits) || 0); };
    const press = (k) => {
      navigator.vibrate?.(8);
      if (k === 'del') digits = digits.slice(0, -1);
      else if (k === '000' && !digits) return;
      else if (digits.length + k.length <= 9) digits = (digits + k).replace(/^0+/, '');
      draw();
    };
    const keys = h('div', { class: 'keys' }, ['1', '2', '3', '4', '5', '6', '7', '8', '9', '000', '0', 'del'].map((k) =>
      h('button', { class: 'key' + (k === 'del' ? ' del' : ''), 'aria-label': k === 'del' ? 'Effacer' : k, onclick: () => press(k) }, k === 'del' ? '⌫' : k)));
    draw();
    return { amount: h('div', { class: 'amount' }, num, h('small', {}, 'FCFA' + (unit ? ' / ' + unit : ''))), keys, get value() { return Number(digits) || 0; } };
  }

  // ---------- Accueil ----------
  screens.home = () => {
    const banner = h('div', { class: 'banner hidden' });
    const revBadge = h('span', { class: 'dot hidden' });
    const totalNum = h('b', {}, '–');
    const installBtn = h('button', { class: 'hidden', onclick: install }, '📲 Installer sur mon téléphone');

    async function refresh() {
      try {
        const s = await api('/api/admin/stats');
        revBadge.textContent = s.review; revBadge.classList.toggle('hidden', !s.review);
        totalNum.textContent = s.total;
      } catch { /* hors ligne : on garde l'affichage */ }
      const q = await Q.list();
      banner.classList.toggle('hidden', !q.length);
      banner.textContent = q.length ? `📤 ${q.length} photo${q.length > 1 ? 's' : ''} en cours d'envoi…` : '';
      installBtn.classList.toggle('hidden', !installEvt);
    }
    const off = Q.on((type) => { if (type === 'offline') { banner.classList.remove('hidden'); banner.textContent = '📡 Pas de réseau : vos photos partiront dès que possible.'; } else refresh(); });
    const timer = setInterval(refresh, 6000);

    app.replaceChildren(h('div', { class: 'scr' },
      h('div', { class: 'bar' }, h('h1', {}, shop.name), h('button', { class: 'icon-btn', 'aria-label': 'Réglages', onclick: settings }, '⚙️')),
      banner,
      h('button', { class: 'big-add', onclick: () => nav('capture') }, h('span', { class: 'cam' }, '📷'), 'Ajouter un tissu'),
      h('div', { class: 'row2' },
        h('button', { class: 'tile', onclick: () => nav('review') }, '✅ À vérifier', revBadge),
        h('button', { class: 'tile', onclick: () => nav('list') }, '📋 Mes tissus', totalNum)),
      h('div', { class: 'links' },
        h('a', { href: base, target: '_blank', rel: 'noopener' }, '👁 Voir ma boutique'),
        h('a', { href: `https://wa.me/?text=${encodeURIComponent(`Découvrez ${shop.name} : ${shopUrl()}`)}`, target: '_blank', rel: 'noopener' }, '↗ Partager ma boutique'),
        installBtn)));
    refresh();
    return () => { clearInterval(timer); off(); };
  };

  async function install() {
    if (!installEvt) return;
    installEvt.prompt(); await installEvt.userChoice.catch(() => {}); installEvt = null;
  }

  async function settings() {
    let ai = true;
    try { ai = (await api('/api/admin/me')).settings.ai_auto; } catch { /* hors ligne : valeur par défaut */ }
    const aiBtn = h('button', { class: 'switch' + (ai ? ' on' : ''), role: 'switch', 'aria-checked': String(ai) });
    const drawAi = () => { aiBtn.className = 'switch' + (ai ? ' on' : ''); aiBtn.setAttribute('aria-checked', String(ai)); aiBtn.textContent = ai ? '✨ L\'IA est ACTIVÉE' : 'L\'IA est désactivée'; };
    aiBtn.onclick = async () => {
      const next = !ai;
      try { const r = await api('/api/admin/settings', { method: 'PATCH', json: { ai_auto: next } }); ai = r.settings.ai_auto; drawAi(); toast(ai ? 'L\'IA embellira vos prochaines photos ✨' : 'Vos photos seront publiées telles quelles'); }
      catch (e) { toast(e.message, true); }
    };
    drawAi();
    const old = h('input', { type: 'password', inputmode: 'numeric', placeholder: 'Code actuel' });
    const nw = h('input', { type: 'password', inputmode: 'numeric', placeholder: 'Nouveau code (4 à 8 chiffres)', maxlength: 8 });
    const s = sheet([
      h('h2', {}, 'Réglages'),
      h('div', { class: 'field' }, h('span', {}, 'Embellissement automatique des photos'), aiBtn,
        h('p', { style: 'color:var(--muted);font-size:.9rem;margin:6px 0 0' }, 'Fond propre, lumière corrigée, nom et description. Les couleurs et les broderies ne sont jamais modifiées, et votre photo d\'origine est toujours gardée.')),
      installEvt ? h('button', { class: 'btn block accent', onclick: () => { s.close(); install(); } }, '📲 Installer sur mon téléphone')
        : h('p', { style: 'color:var(--muted)' }, 'Pour installer : menu du navigateur → « Ajouter à l\'écran d\'accueil ».'),
      h('h3', { style: 'margin-top:14px' }, 'Changer mon code secret'),
      h('label', { class: 'field' }, old), h('label', { class: 'field' }, nw),
      h('button', { class: 'btn block', onclick: async () => {
        try { await api('/api/admin/pin', { method: 'POST', json: { old: old.value, pin: nw.value } }); toast('Code changé ✓'); s.close(); }
        catch (e) { toast(e.message, true); }
      } }, 'Enregistrer le nouveau code'),
      h('button', { class: 'btn block ghost', onclick: async () => { await rawApi('/api/admin/logout', { method: 'POST' }).catch(() => {}); s.close(); loginScreen(); } }, 'Me déconnecter'),
      h('button', { class: 'btn block ghost', onclick: () => s.close() }, 'Fermer'),
    ]);
  }

  // ---------- Capture (photo -> prix -> publier -> photo suivante) ----------
  // Dessine l'image (vidéo ou fichier) dans un canvas réduit -> JPEG léger pour les connexions lentes.
  const MAX_EDGE = 1800;
  function toJpeg(src, w, hgt) {
    const k = Math.min(1, MAX_EDGE / Math.max(w, hgt));
    const c = document.createElement('canvas');
    c.width = Math.round(w * k); c.height = Math.round(hgt * k);
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('photo'))), 'image/jpeg', 0.86));
  }
  async function fileToJpeg(file) {
    let bmp;
    try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch {
      const url = URL.createObjectURL(file);
      bmp = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      URL.revokeObjectURL(url);
    }
    return toJpeg(bmp, bmp.width || bmp.naturalWidth, bmp.height || bmp.naturalHeight);
  }

  screens.capture = () => {
    let stream = null, blob = null, previewUrl = null, published = 0, kp = null, closed = false;
    const video = h('video', { autoplay: true, playsinline: true, muted: true });
    video.muted = true;
    const counter = h('span', { class: 'pill' });
    const camLayer = h('div', { class: 'cap' });
    const priceLayer = h('div', { class: 'price-scr hidden' });
    // Repli : appareil photo natif du téléphone (si la caméra intégrée à la page est refusée)
    const nativeInput = h('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'hidden' });
    const galleryInput = h('input', { type: 'file', accept: 'image/*', class: 'hidden' });
    let hasLive = false;

    const updateCounter = () => { counter.textContent = published ? `✅ ${published} publié${published > 1 ? 's' : ''}` : 'Photo 1/3'; };

    function drawCam() {
      updateCounter();
      camLayer.replaceChildren(
        video,
        h('div', { class: 'cap-top' },
          h('button', { class: 'pill', style: 'background:#000a;color:#fff', onclick: () => history.back() }, '✕ Fermer'), counter),
        hasLive ? null : h('div', { class: 'nocam' },
          h('div', { style: 'font-size:4rem' }, '📷'),
          h('button', { class: 'btn accent', style: 'min-height:80px;font-size:1.5rem;padding:0 30px', onclick: () => nativeInput.click() }, 'Prendre la photo')),
        h('div', { class: 'cap-bottom' },
          h('button', { class: 'side-btn', 'aria-label': 'Choisir dans la galerie', onclick: () => galleryInput.click() }, '🖼'),
          hasLive ? h('button', { class: 'shutter', 'aria-label': 'Prendre la photo', onclick: snap }) : h('span', { style: 'width:96px' }),
          h('span', { style: 'width:64px' })));
    }

    async function startCamera() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('no');
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1440 } }, audio: false });
        if (closed) { stream.getTracks().forEach((t) => t.stop()); return; }
        video.srcObject = stream; await video.play();
        hasLive = true;
      } catch { hasLive = false; }
      drawCam();
    }

    async function snap() {
      if (!video.videoWidth) return;
      navigator.vibrate?.(15);
      camLayer.append(h('div', { class: 'flash' }));
      try { gotPhoto(await toJpeg(video, video.videoWidth, video.videoHeight)); } catch { toast('Photo impossible, réessayez.', true); }
    }
    async function fromFile(file) {
      if (!file) return;
      try { gotPhoto(await fileToJpeg(file)); } catch { toast('Photo illisible, réessayez.', true); }
    }
    nativeInput.addEventListener('change', () => { fromFile(nativeInput.files[0]); nativeInput.value = ''; });
    galleryInput.addEventListener('change', () => { fromFile(galleryInput.files[0]); galleryInput.value = ''; });

    // Étape 2 + 3 : prix puis « Publier »
    function gotPhoto(b) {
      blob = b;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(b);
      const pub = h('button', { class: 'btn block green pub', disabled: true, onclick: () => publish() }, '✅ Publier');
      const noPrice = h('button', { style: 'background:none;font-weight:700;color:var(--muted);padding:8px 0 0;text-decoration:underline', onclick: () => publish(true) }, 'Publier sans prix pour l\'instant');
      kp = keypad('', (v) => { pub.disabled = !v; });
      priceLayer.replaceChildren(
        h('div', { class: 'steps' }, h('span', { class: 'done' }, '① Photo ✓'), h('span', { class: 'on' }, '② Prix'), h('span', {}, '③ Publier')),
        h('div', { class: 'prev' },
          h('img', { src: previewUrl, alt: 'Votre photo' }),
          kp.amount),
        h('button', { style: 'align-self:flex-start;background:none;font-weight:700;color:var(--muted);padding:4px 0 8px;text-decoration:underline', onclick: retake }, '↺ Reprendre la photo'),
        kp.keys, pub, noPrice);
      priceLayer.classList.remove('hidden');
    }
    function retake() { priceLayer.classList.add('hidden'); blob = null; }

    function publish(withoutPrice) {
      if (!blob || (!kp.value && withoutPrice !== true)) return;
      Q.add({ blob, price: withoutPrice === true ? 0 : kp.value }); // 0 = prix sur demande (à compléter plus tard) // sans attendre : l'envoi se fait en arrière-plan
      published++;
      blob = null;
      toast('✅ Publié !', false, 1100);
      priceLayer.classList.add('hidden');
      updateCounter();
      // Mode rafale : la caméra est déjà ouverte. Sans caméra intégrée, on rouvre celle du téléphone
      // immédiatement (ce clic doit rester dans le geste de l'utilisateur, donc sans « await »).
      if (!hasLive) nativeInput.click();
    }

    document.body.append(camLayer, priceLayer, nativeInput, galleryInput);
    drawCam();
    startCamera();
    return () => {
      closed = true;
      stream?.getTracks().forEach((t) => t.stop());
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      [camLayer, priceLayer, nativeInput, galleryInput].forEach((n) => n.remove());
    };
  };

  // ---------- Cartes produit ----------
  const statusTag = (p) => {
    if (p.ai_status === 'pending' || p.ai_status === 'processing') return h('span', { class: 'tag warn' }, '⏳ L\'IA prépare la fiche…');
    if (p.ai_status === 'failed') return h('span', { class: 'tag bad' }, '⚠ IA incomplète');
    return p.sold_out ? h('span', { class: 'tag out' }, 'Épuisé') : h('span', { class: 'tag ok' }, 'Disponible');
  };
  const busy = (p) => p.ai_status === 'pending' || p.ai_status === 'processing';

  function productCard(p, mode, refresh) {
    const patch = async (data, okMsg) => {
      try { await api(`/api/admin/products/${p.id}`, { method: 'PATCH', json: data }); if (okMsg) toast(okMsg); refresh(); }
      catch (e) { toast(e.message, true); }
    };
    const top = h('div', { class: 'card-top' },
      p.thumb ? h('img', { src: p.thumb, alt: '', width: 96, height: 96, onclick: () => details(p, refresh) }) : h('div', { class: 'noimg' }),
      h('div', { class: 'meta' },
        h('h3', {}, p.name),
        p.price > 0 ? h('div', { class: 'p' }, `${fmt(p.price)} FCFA`) : h('div', { class: 'p', style: 'color:var(--danger)' }, 'Prix à définir'),
        h('span', { class: 'tag' }, CAT[p.category] || ''), ' ', statusTag(p)));
    let btns;
    if (mode === 'review') {
      btns = [
        h('button', { class: 'btn green', disabled: busy(p), onclick: () => patch({ reviewed: true }, 'Validé ✓') }, '✅ Valider'),
        h('button', { class: 'btn ghost', onclick: () => editSheet(p, refresh) }, '✏️ Corriger'),
        embellish(p, refresh),
      ];
    } else {
      btns = [
        h('button', { class: 'btn ' + (p.sold_out ? 'green' : 'ghost'), onclick: () => patch({ sold_out: !p.sold_out }) }, p.sold_out ? '✅ Disponible' : '🚫 Épuisé'),
        h('button', { class: 'btn ' + (p.price > 0 ? 'ghost' : 'accent'), onclick: () => priceSheet(p, refresh) }, p.price > 0 ? '💰 Prix' : '💰 Mettre le prix'),
        h('button', { class: 'btn ghost', style: 'color:var(--danger)', onclick: () => remove(p, refresh) }, '🗑 Supprimer'),
        embellish(p, refresh),
      ];
    }
    return h('div', { class: 'card-a' }, top, h('div', { class: 'btns' }, btns));
  }

  // Photo pas encore embellie (IA désactivée ou en échec) : bouton pour la traiter à la demande
  function embellish(p, refresh) {
    if (p.ai_done || busy(p)) return null;
    return h('button', { class: 'btn accent', onclick: async () => {
      try { await api(`/api/admin/products/${p.id}/reprocess`, { method: 'POST' }); toast('✨ L\'IA s\'en occupe…'); refresh(); } catch (e) { toast(e.message, true); }
    } }, p.ai_status === 'failed' ? '🔄 Relancer l\'IA' : '✨ Embellir avec l\'IA');
  }

  async function remove(p, refresh) {
    if (!(await confirmBox(`Supprimer « ${p.name} » ?`, '🗑 Oui, supprimer'))) return;
    try { await api(`/api/admin/products/${p.id}`, { method: 'DELETE' }); toast('Supprimé'); refresh(); } catch (e) { toast(e.message, true); }
  }

  function priceSheet(p, refresh) {
    const kp = keypad(p.price);
    const save = h('button', { class: 'btn block green', style: 'min-height:70px;font-size:1.4rem', onclick: async () => {
      try { await api(`/api/admin/products/${p.id}`, { method: 'PATCH', json: { price: kp.value } }); s.close(); toast('Prix modifié ✓'); refresh(); } catch (e) { toast(e.message, true); }
    } }, '💾 Enregistrer');
    const s = sheet([h('h2', {}, 'Nouveau prix'), kp.amount, kp.keys, save]);
  }

  function editSheet(p, refresh) {
    let cat = p.category;
    const name = h('input', { type: 'text', value: p.name, maxlength: 80 });
    const price = h('input', { type: 'tel', inputmode: 'numeric', value: String(p.price) });
    const desc = h('textarea', { rows: 4, maxlength: 600 }, p.description || '');
    const cats = h('div', { class: 'cats' });
    const drawCats = () => cats.replaceChildren(...Object.entries(CAT).map(([k, l]) => h('button', { class: cat === k ? 'on' : '', onclick: () => { cat = k; drawCats(); } }, l)));
    drawCats();
    const s = sheet([
      h('h2', {}, 'Corriger'),
      h('label', { class: 'field' }, h('span', {}, 'Nom'), name),
      h('label', { class: 'field' }, h('span', {}, 'Prix (FCFA)'), price),
      h('div', { class: 'field' }, h('span', {}, 'Catégorie'), cats),
      h('label', { class: 'field' }, h('span', {}, 'Description'), desc),
      h('button', { class: 'btn block green', style: 'min-height:66px', onclick: async () => {
        try {
          await api(`/api/admin/products/${p.id}`, { method: 'PATCH', json: { name: name.value, price: price.value.replace(/\D/g, ''), category: cat, description: desc.value, reviewed: true } });
          s.close(); toast('Enregistré ✓'); refresh();
        } catch (e) { toast(e.message, true); }
      } }, '💾 Enregistrer'),
      h('button', { class: 'btn block ghost', onclick: () => s.close() }, 'Annuler'),
    ]);
  }

  // Détail : photo améliorée + photo d'origine (toujours conservée)
  function details(p, refresh) {
    const s = sheet([
      h('h2', {}, p.name),
      h('div', { class: 'photo-view' },
        p.image !== p.original ? [h('p', {}, h('b', {}, 'Photo améliorée')), h('img', { src: p.image, alt: '' })] : null,
        h('p', {}, h('b', {}, 'Photo d\'origine')), h('img', { src: p.original, alt: '' })),
      p.description ? h('p', {}, p.description) : null,
      h('button', { class: 'btn block', onclick: () => { s.close(); editSheet(p, refresh); } }, '✏️ Modifier'),
      h('button', { class: 'btn block ghost', onclick: async () => { await api(`/api/admin/products/${p.id}/reprocess`, { method: 'POST' }).catch(() => {}); s.close(); toast('Traitement relancé'); refresh(); } }, '🔄 Relancer l\'IA'),
      h('button', { class: 'btn block ghost', onclick: () => s.close() }, 'Fermer'),
    ]);
  }

  // ---------- Liste « À vérifier » ----------
  screens.review = () => {
    const list = h('div');
    const head = h('div', { class: 'bar' }, h('button', { class: 'icon-btn back-btn', onclick: () => history.back() }, '← Retour'), h('h1', {}, 'À vérifier'));
    const validateAll = h('button', { class: 'btn block green hidden', style: 'margin-bottom:14px' }, '✅ Tout valider');
    app.replaceChildren(h('div', { class: 'scr' }, head, validateAll, list));
    let timer, items = [];
    async function load() {
      try {
        const r = await api('/api/admin/products?filter=review&limit=100');
        items = r.items;
        list.replaceChildren(...(items.length ? items.map((p) => productCard(p, 'review', load)) : [h('div', { class: 'empty-a' }, '🎉 Tout est vérifié !')]));
        const ready = items.filter((p) => !busy(p));
        validateAll.classList.toggle('hidden', ready.length < 2);
        validateAll.textContent = `✅ Tout valider (${ready.length})`;
        clearTimeout(timer);
        if (items.some(busy)) timer = setTimeout(load, 4000); // l'IA travaille : on actualise toute seule
      } catch (e) { if (e.status !== 401) list.replaceChildren(h('div', { class: 'empty-a' }, e.message, h('br'), h('button', { class: 'btn', onclick: load }, 'Réessayer'))); }
    }
    validateAll.onclick = async () => {
      const ready = items.filter((p) => !busy(p));
      if (!(await confirmBox(`Valider ${ready.length} tissus ?`, '✅ Oui, tout valider', 'green'))) return;
      await Promise.all(ready.map((p) => api(`/api/admin/products/${p.id}`, { method: 'PATCH', json: { reviewed: true } }).catch(() => {})));
      toast('Tout est validé ✓'); load();
    };
    load();
    return () => clearTimeout(timer);
  };

  // ---------- Liste « Mes tissus » ----------
  screens.list = () => {
    let filter = '', offset = 0, total = 0;
    const list = h('div');
    const seg = h('div', { class: 'seg' });
    const more = h('button', { class: 'btn block ghost hidden' }, 'Voir plus');
    app.replaceChildren(h('div', { class: 'scr' },
      h('div', { class: 'bar' }, h('button', { class: 'icon-btn back-btn', onclick: () => history.back() }, '← Retour'), h('h1', {}, 'Mes tissus')), seg, list, more));
    const drawSeg = () => seg.replaceChildren(...[['', 'Tous'], ['available', 'Disponibles'], ['soldout', 'Épuisés']].map(([k, l]) =>
      h('button', { class: filter === k ? 'on' : '', onclick: () => { filter = k; drawSeg(); load(true); } }, l)));
    let timer;
    async function load(reset) {
      if (reset) offset = 0;
      try {
        const r = await api(`/api/admin/products?filter=${filter}&limit=40&offset=${offset}`);
        total = r.total;
        // Rechargement complet jusqu'à la page courante pour garder la liste à jour après une action
        const nodes = r.items.map((p) => productCard(p, 'list', () => load(true)));
        if (reset) list.replaceChildren(...(nodes.length ? nodes : [h('div', { class: 'empty-a' }, 'Aucun tissu ici.')])); else list.append(...nodes);
        offset += r.items.length;
        more.classList.toggle('hidden', offset >= total);
        clearTimeout(timer);
        if (r.items.some(busy)) timer = setTimeout(() => load(true), 4000);
      } catch (e) { if (e.status !== 401) toast(e.message, true); }
    }
    more.onclick = () => load(false);
    drawSeg(); load(true);
    return () => clearTimeout(timer);
  };

  // ---------- Démarrage ----------
  // La caméra s'ouvre PAR-DESSUS l'accueil (qui reste affiché dessous).
  Q.on((type, data) => {
    if (type === 'auth') loginScreen('Session expirée : reconnectez-vous. Vos photos sont gardées.');
    if (type === 'rejected') toast(`Une photo a été refusée : ${data.message}`, true, 4000);
  });
  T.registerSW();

  (async () => {
    history.replaceState({ s: 'home' }, '');
    try { await rawApi('/api/admin/me'); show('home'); Q.run(); }
    catch (e) { if (e.status === 401) loginScreen(); else { show('home'); } }
  })();

})();
