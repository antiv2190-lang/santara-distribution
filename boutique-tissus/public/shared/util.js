// Petits outils communs (navigateur). Tout le rendu passe par h() : jamais de innerHTML => pas de faille XSS.
const T = (() => {
  const UNIT = { metre: 'mètre', piece: 'pièce', lot: 'lot' };
  const CAT = { dentelle: 'Dentelle', basin: 'Basin', broderie: 'Broderie', wax: 'Wax', bazin: 'Bazin', autre: 'Autre' };

  // 15000 -> « 15 000 » (espace insécable : le prix ne se coupe pas sur deux lignes)
  const fmt = (n, sep = ' ') => String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, sep);

  // h('div', {class:'x', onclick: fn}, 'texte', autreNoeud)
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else if (k === 'html') throw new Error('html interdit');
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
    return el;
  }

  // Appel API JSON ; lance une Error avec un message lisible en français.
  async function api(url, opts = {}) {
    let res;
    try {
      res = await fetch(url, { credentials: 'same-origin', ...opts,
        headers: { ...(opts.json ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) },
        body: opts.json ? JSON.stringify(opts.json) : opts.body });
    } catch { const e = new Error('Pas de connexion internet.'); e.offline = true; throw e; }
    let data = null;
    try { data = await res.json(); } catch { /* corps vide */ }
    if (!res.ok) { const e = new Error((data && data.error) || 'Erreur, réessayez.'); e.status = res.status; throw e; }
    return data;
  }

  let toastEl;
  function toast(msg, isErr, ms = 2200) {
    toastEl?.remove();
    toastEl = h('div', { class: 'toast' + (isErr ? ' err' : ''), role: 'status' }, msg);
    document.body.append(toastEl);
    setTimeout(() => toastEl?.remove(), ms);
  }

  // Feuille qui monte du bas ; renvoie { close, el }
  function sheet(content) {
    const back = h('div', { class: 'sheet-back', onclick: (e) => e.target === back && close() }, h('div', { class: 'sheet', role: 'dialog' }, content));
    const close = () => back.remove();
    document.body.append(back);
    return { close, el: back };
  }

  // Boîte de confirmation à gros boutons -> Promise<boolean>
  function confirmBox(title, yesLabel = 'Oui', yesClass = 'red') {
    return new Promise((resolve) => {
      const s = sheet([
        h('h2', {}, title),
        h('button', { class: `btn block ${yesClass}`, onclick: () => { s.close(); resolve(true); } }, yesLabel),
        h('button', { class: 'btn block ghost', onclick: () => { s.close(); resolve(false); } }, 'Annuler'),
      ]);
    });
  }

  const WA_ICON = 'M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z';
  function waIcon(size = 22) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', size); svg.setAttribute('height', size); svg.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(ns, 'path'); p.setAttribute('d', WA_ICON); p.setAttribute('fill', 'currentColor');
    svg.append(p); return svg;
  }

  // Service worker (PWA : installation + cache léger pour connexions lentes)
  function registerSW() {
    if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }

  return { UNIT, CAT, fmt, h, api, toast, sheet, confirmBox, waIcon, registerSW };
})();
