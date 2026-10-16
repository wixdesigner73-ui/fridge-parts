/* Fridge Parts – single-page app with hash routing.
   Flow: Home → Brand → Model → Part → Cart → Checkout → Order confirmation.
   Cart, orders and reserved stock persist in localStorage (no backend). */

'use strict';

/* ---------- helpers ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => '$' + Number(n).toFixed(2);
const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

const store = {
  get(key, fallback) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; } },
  set(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* storage unavailable */ } },
};

/* ---------- data indexes ---------- */
const modelById = Object.fromEntries(MODELS.map(m => [m.id, m]));
const partById = Object.fromEntries(PARTS.map(p => [p.id, p]));
const BRANDS = [...new Set(MODELS.map(m => m.brand))].sort();
const CATEGORIES = [...new Set(PARTS.map(p => p.category))].sort();
const catIcon = Object.fromEntries([...CATEGORY_RULES, OTHER_CATEGORY].map(c => [c.name, c.icon]));
const partsOfModel = id => PARTS.filter(p => p.modelId === id);
const modelsOfBrand = b => MODELS.filter(m => m.brand === b);
const modelLabel = m => `${m.brand} ${m.model}`;
const brandSlug = b => encodeURIComponent(b);

/* ---------- persistent state ---------- */
let cart = store.get('fp_cart', {});          // { partId: qty }
let sold = store.get('fp_sold', {});          // { partId: qty already ordered }
let orders = store.get('fp_orders', []);      // [{ id, ... }]
const saveCart = () => { store.set('fp_cart', cart); updateCartBadge(); };
const available = p => Math.max(0, p.qty - (sold[p.id] || 0));

/* ---------- cart ops ---------- */
function addToCart(id, qty = 1) {
  const p = partById[id];
  if (!p) return false;
  const have = cart[id] || 0;
  const next = Math.min(available(p), have + qty);
  if (next === have) { toast(`Only ${available(p)} in stock for ${p.partNo}`); return false; }
  cart[id] = next;
  saveCart();
  return true;
}
function setQty(id, qty) {
  const p = partById[id];
  if (!p) return;
  qty = Math.max(0, Math.min(available(p), qty | 0));
  if (qty === 0) delete cart[id]; else cart[id] = qty;
  saveCart();
}
const cartLines = () => Object.entries(cart).map(([id, qty]) => ({ part: partById[id], qty })).filter(l => l.part);
const cartCount = () => cartLines().reduce((n, l) => n + l.qty, 0);
function cartTotals() {
  const lines = cartLines();
  const priced = lines.filter(l => l.part.price != null);
  return {
    lines,
    subtotal: priced.reduce((s, l) => s + l.part.price * l.qty, 0),
    quoteLines: lines.filter(l => l.part.price == null).length,
  };
}
function updateCartBadge() {
  const n = cartCount();
  const b = $('#cartBadge');
  b.textContent = n;
  b.hidden = n === 0;
}

/* ---------- toast ---------- */
let toastTimer;
function toast(msg, href, label = 'View cart') {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>${href ? `<a href="${href}">${esc(label)}</a>` : ''}`;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
}

/* ---------- small UI pieces ---------- */
const hue = s => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
const tile = (p, big) => `<div class="tile ${big ? 'big' : ''}" style="--h:${hue(p.category)}" aria-hidden="true"><span>${p.icon}</span></div>`;
const stockBadge = p => {
  const a = available(p);
  return a === 0 ? '<span class="badge out">Sold out</span>'
    : a <= 1 ? '<span class="badge low">Last one</span>'
    : `<span class="badge ok">${a} in stock</span>`;
};
const priceHtml = p => p.price == null ? '<span class="price quote">Request quote</span>' : `<span class="price">${money(p.price)}</span>`;

function breadcrumb(items) {
  return `<nav class="crumbs" aria-label="Breadcrumb">${items.map((it, i) =>
    it.href && i < items.length - 1 ? `<a href="${it.href}">${esc(it.label)}</a>` : `<span aria-current="page">${esc(it.label)}</span>`
  ).join('<i>›</i>')}</nav>`;
}

const STEPS = ['Brand', 'Model', 'Part', 'Cart', 'Checkout'];
function stepper(active) {
  return `<ol class="stepper" aria-label="Progress">${STEPS.map((s, i) =>
    `<li class="${i < active ? 'done' : i === active ? 'active' : ''}"><b>${i + 1}</b><span>${s}</span></li>`).join('')}</ol>`;
}

function partCard(p, { showModel = false } = {}) {
  const m = modelById[p.modelId];
  const a = available(p);
  return `
  <article class="card part">
    <a class="part-link" href="#/part/${encodeURIComponent(p.id)}" aria-label="${esc(p.name)}">
      ${tile(p)}
      <div class="part-body">
        <div class="cat">${esc(p.category)}</div>
        <h3>${esc(p.name)}</h3>
        <div class="pn">${esc(p.partNo)}${showModel ? ` · ${esc(modelLabel(m))}` : ''}</div>
      </div>
    </a>
    <div class="part-foot">
      <div>${priceHtml(p)}<div>${stockBadge(p)}</div></div>
      <button class="btn small" data-add="${esc(p.id)}" ${a === 0 ? 'disabled' : ''}>${p.price == null ? 'Add to quote' : 'Add to cart'}</button>
    </div>
  </article>`;
}

/* ---------- search ---------- */
function searchParts(q, cat) {
  const tokens = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  return PARTS.filter(p => {
    if (cat && p.category !== cat) return false;
    const m = modelById[p.modelId];
    const hay = `${p.name} ${p.partNo} ${norm(p.partNo)} ${p.category} ${m.brand} ${m.model} ${m.fullModel} ${p.note}`.toLowerCase();
    return tokens.every(t => hay.includes(t) || hay.includes(norm(t)));
  });
}
function searchModels(q) {
  const tokens = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  return MODELS.filter(m => {
    const hay = `${m.brand} ${m.model} ${m.fullModel} ${m.compat.join(' ')}`.toLowerCase();
    return tokens.every(t => hay.includes(t) || hay.includes(norm(t)));
  });
}
function findModelExact(input) {
  const n = norm(input);
  if (!n) return null;
  return MODELS.find(m => norm(m.model) === n || norm(m.fullModel) === n || norm(modelLabel(m)) === n)
    || MODELS.find(m => norm(m.model).startsWith(n) && n.length >= 5) || null;
}

/* ---------- pages ---------- */
const pages = {};

pages.home = () => {
  const totalParts = PARTS.length;
  const topCats = CATEGORIES.map(c => ({ c, n: PARTS.filter(p => p.category === c).length })).sort((a, b) => b.n - a.n);
  return `
  ${stepper(0)}
  <section class="hero">
    <h1>Find the right refrigerator part, fast.</h1>
    <p>Pick your brand, enter your model number, and see exactly which used parts we have in stock.</p>
    <form id="finder" class="finder" autocomplete="off">
      <label for="modelInput" class="sr">Model number</label>
      <input id="modelInput" list="modelList" placeholder="Enter your model number, e.g. RF28MEDBSR" />
      <datalist id="modelList">${MODELS.map(m => `<option value="${esc(m.fullModel)}">${esc(modelLabel(m))}</option>`).join('')}</datalist>
      <button class="btn" type="submit">Find my model</button>
    </form>
    <div id="finderMsg" class="form-error" role="alert"></div>
    <div class="stats">
      <div><b>${MODELS.length}</b> models</div><div><b>${BRANDS.length}</b> brands</div><div><b>${totalParts}</b> parts listed</div>
    </div>
  </section>

  <h2 class="section">Shop by brand</h2>
  <div class="grid brands">
    ${BRANDS.map(b => {
      const ms = modelsOfBrand(b);
      const n = PARTS.filter(p => modelById[p.modelId].brand === b).length;
      return `<a class="card brand" href="#/brand/${brandSlug(b)}"><div class="brand-mark">${esc(b[0])}</div>
        <h3>${esc(b)}</h3><p>${plural(ms.length, 'model')} · ${plural(n, 'part')}</p></a>`;
    }).join('')}
  </div>

  <h2 class="section">Shop by part type</h2>
  <div class="chips">
    ${topCats.map(({ c, n }) => `<a class="chip" href="#/search?cat=${encodeURIComponent(c)}">${catIcon[c]} ${esc(c)} <small>${n}</small></a>`).join('')}
  </div>

  <h2 class="section">All models</h2>
  <div class="grid models">${MODELS.map(modelCard).join('')}</div>`;
};

function modelCard(m) {
  const n = partsOfModel(m.id).length;
  return `<a class="card model" href="#/model/${m.id}">
    <div class="model-top"><span class="tag">${esc(m.brand)}</span><span class="muted">Serial ${esc(m.serial)}</span></div>
    <h3>${esc(m.fullModel)}</h3>
    <p class="muted">${plural(n, 'part')} available</p>
    <span class="go">View parts →</span></a>`;
}

pages.brand = ([name]) => {
  const b = decodeURIComponent(name || '');
  const ms = modelsOfBrand(b);
  if (!ms.length) return notFound(`We don't have any ${esc(b)} models yet.`);
  return `
  ${stepper(1)}
  ${breadcrumb([{ label: 'Home', href: '#/' }, { label: b }])}
  <h1>${esc(b)} refrigerators</h1>
  <p class="lead">Choose your model. The model number is on the label inside the fridge compartment.</p>
  <div class="grid models">${ms.map(modelCard).join('')}</div>
  <div class="note">Don't see your model? <a href="#/search">Search by part number</a> — many parts are shared across models.</div>`;
};

/* Model page keeps its filter state so going Back preserves the view. */
const filterState = {};
const fs = id => (filterState[id] ||= { q: '', cats: new Set(), sort: 'name', inStock: true, priced: false });

function filterParts(id) {
  const f = fs(id);
  let list = partsOfModel(id);
  if (f.q) { const ids = new Set(searchParts(f.q).map(p => p.id)); list = list.filter(p => ids.has(p.id)); }
  if (f.cats.size) list = list.filter(p => f.cats.has(p.category));
  if (f.inStock) list = list.filter(p => available(p) > 0);
  if (f.priced) list = list.filter(p => p.price != null);
  const by = {
    name: (a, b) => a.name.localeCompare(b.name),
    low: (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity),
    high: (a, b) => (b.price ?? -1) - (a.price ?? -1),
    cat: (a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name),
  }[f.sort];
  return list.sort(by);
}

pages.model = ([id]) => {
  const m = modelById[id];
  if (!m) return notFound('That model was not found.');
  const f = fs(id);
  const all = partsOfModel(id);
  const cats = [...new Set(all.map(p => p.category))].sort();
  return `
  ${stepper(2)}
  ${breadcrumb([{ label: 'Home', href: '#/' }, { label: m.brand, href: `#/brand/${brandSlug(m.brand)}` }, { label: m.fullModel }])}
  <div class="model-head card">
    <div>
      <span class="tag">${esc(m.brand)}</span>
      <h1>${esc(m.fullModel)}</h1>
      <p class="muted">Donor unit serial ${esc(m.serial)}</p>
      ${m.compat.length ? `<p class="muted">Also compatible with: ${m.compat.map(esc).join(', ')}</p>` : ''}
    </div>
    <div class="stat"><b>${all.length}</b><span>parts</span></div>
  </div>

  <div class="layout">
    <aside class="filters card" id="filters">
      <h3>Filter</h3>
      <label class="sr" for="fq">Search within this model</label>
      <input id="fq" type="search" placeholder="Search this model…" value="${esc(f.q)}" />
      <h4>Part type</h4>
      ${cats.map(c => `<label class="check"><input type="checkbox" data-cat="${esc(c)}" ${f.cats.has(c) ? 'checked' : ''}/> ${catIcon[c]} ${esc(c)} <small>${all.filter(p => p.category === c).length}</small></label>`).join('')}
      <h4>Availability</h4>
      <label class="check"><input type="checkbox" id="fStock" ${f.inStock ? 'checked' : ''}/> In stock only</label>
      <label class="check"><input type="checkbox" id="fPriced" ${f.priced ? 'checked' : ''}/> Show listed prices only</label>
      <button class="btn ghost small" id="fReset" type="button">Reset filters</button>
    </aside>
    <section>
      <div class="toolbar">
        <div id="count" class="muted"></div>
        <label>Sort <select id="fSort">
          <option value="name">Name A–Z</option><option value="low">Price: low to high</option>
          <option value="high">Price: high to low</option><option value="cat">Part type</option>
        </select></label>
      </div>
      <div id="grid" class="grid parts"></div>
    </section>
  </div>`;
};
pages.model.after = ([id]) => {
  const f = fs(id);
  const redraw = () => {
    const list = filterParts(id);
    $('#count').textContent = `${plural(list.length, 'part')} shown`;
    $('#grid').innerHTML = list.length ? list.map(p => partCard(p)).join('')
      : `<div class="empty">No parts match these filters. <button class="btn ghost small" id="emptyReset">Reset filters</button></div>`;
    const r = $('#emptyReset'); if (r) r.onclick = reset;
  };
  const reset = () => { filterState[id] = undefined; delete filterState[id]; render(); };
  $('#fSort').value = f.sort;
  $('#fq').oninput = e => { f.q = e.target.value; redraw(); };
  $$('[data-cat]').forEach(cb => cb.onchange = () => { cb.checked ? f.cats.add(cb.dataset.cat) : f.cats.delete(cb.dataset.cat); redraw(); });
  $('#fStock').onchange = e => { f.inStock = e.target.checked; redraw(); };
  $('#fPriced').onchange = e => { f.priced = e.target.checked; redraw(); };
  $('#fSort').onchange = e => { f.sort = e.target.value; redraw(); };
  $('#fReset').onclick = reset;
  redraw();
};

pages.part = ([rawId]) => {
  const p = partById[decodeURIComponent(rawId || '')];
  if (!p) return notFound('That part was not found.');
  const m = modelById[p.modelId];
  const a = available(p);
  const inCart = cart[p.id] || 0;
  const alsoFits = PARTS.filter(x => x.partNo === p.partNo && x.id !== p.id).map(x => modelById[x.modelId]);
  const related = partsOfModel(p.modelId).filter(x => x.id !== p.id)
    .sort((x, y) => (y.category === p.category) - (x.category === p.category)).slice(0, 4);
  return `
  ${stepper(2)}
  ${breadcrumb([{ label: 'Home', href: '#/' }, { label: m.brand, href: `#/brand/${brandSlug(m.brand)}` }, { label: m.model, href: `#/model/${m.id}` }, { label: p.name }])}
  <div class="detail">
    ${tile(p, true)}
    <div class="detail-main">
      <div class="cat">${esc(p.category)}</div>
      <h1>${esc(p.name)}</h1>
      <p class="pn big">Part # <b id="pnText">${esc(p.partNo)}</b> <button class="link" id="copyPn" type="button">Copy</button></p>
      <div class="buy">
        <div>${priceHtml(p)} ${stockBadge(p)}</div>
        <div class="qty-row">
          <div class="qty" role="group" aria-label="Quantity">
            <button type="button" id="qMinus" aria-label="Decrease">−</button>
            <input id="qVal" type="number" min="1" max="${a}" value="1" ${a === 0 ? 'disabled' : ''} aria-label="Quantity" />
            <button type="button" id="qPlus" aria-label="Increase">+</button>
          </div>
          <button class="btn" id="addBtn" ${a === 0 ? 'disabled' : ''}>${p.price == null ? 'Add to quote request' : 'Add to cart'}</button>
          <button class="btn ghost" id="buyNow" ${a === 0 ? 'disabled' : ''}>Buy now</button>
        </div>
        ${inCart ? `<p class="muted">You already have ${inCart} in your <a href="#/cart">cart</a>.</p>` : ''}
        ${p.price == null ? '<p class="note small">This part has no listed price yet. Add it and we\'ll send you a quote with your order request.</p>' : ''}
      </div>
      <dl class="specs">
        <dt>Fits model</dt><dd><a href="#/model/${m.id}">${esc(m.fullModel)}</a> (${esc(m.brand)})</dd>
        ${m.compat.length ? `<dt>Compatible models</dt><dd>${m.compat.map(esc).join(', ')} <small class="muted">(model-level list; check the note above for part-specific limits)</small></dd>` : ''}
        <dt>Condition</dt><dd>${esc(p.condition)}</dd>
        ${p.sourceCategory ? `<dt>Listed as</dt><dd>${esc(p.sourceCategory)}</dd>` : ''}
        <dt>Available</dt><dd>${a} of ${p.qty}</dd>
        ${p.note ? `<dt>Notes</dt><dd>${esc(p.note)}</dd>` : ''}
        ${alsoFits.length ? `<dt>Also fits</dt><dd>${alsoFits.map(x => `<a href="#/model/${x.id}">${esc(x.model)}</a>`).join(', ')}</dd>` : ''}
      </dl>
    </div>
  </div>
  <h2 class="section">More parts for ${esc(m.model)}</h2>
  <div class="grid parts">${related.map(r => partCard(r)).join('')}</div>`;
};
pages.part.after = ([rawId]) => {
  const p = partById[decodeURIComponent(rawId || '')];
  if (!p) return;
  const qv = $('#qVal');
  const clamp = () => { qv.value = Math.max(1, Math.min(available(p) || 1, parseInt(qv.value, 10) || 1)); return +qv.value; };
  $('#qMinus').onclick = () => { qv.value = (+qv.value || 1) - 1; clamp(); };
  $('#qPlus').onclick = () => { qv.value = (+qv.value || 1) + 1; clamp(); };
  qv.onchange = clamp;
  $('#addBtn').onclick = () => { if (addToCart(p.id, clamp())) { toast(`Added ${p.partNo} to your cart`, '#/cart'); render(); } };
  $('#buyNow').onclick = () => { if (addToCart(p.id, clamp()) || cart[p.id]) location.hash = '#/checkout'; };
  $('#copyPn').onclick = async () => {
    try { await navigator.clipboard.writeText(p.partNo); toast('Part number copied'); } catch { toast('Copy not available in this browser'); }
  };
};

pages.search = (_, query) => {
  const q = (query.get('q') || '').trim();
  const cat = query.get('cat') || '';
  const parts = searchParts(q, cat);
  const models = cat ? [] : searchModels(q);
  return `
  ${breadcrumb([{ label: 'Home', href: '#/' }, { label: 'Search' }])}
  <h1>${q ? `Results for “${esc(q)}”` : cat ? esc(cat) : 'Search all parts'}</h1>
  <form id="pageSearch" class="finder" autocomplete="off">
    <input name="q" value="${esc(q)}" placeholder="Part number, part name or model" aria-label="Search" />
    <select name="cat" aria-label="Part type"><option value="">All part types</option>
      ${CATEGORIES.map(c => `<option ${c === cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
    <button class="btn">Search</button>
  </form>
  ${models.length ? `<h2 class="section">Models</h2><div class="grid models">${models.map(modelCard).join('')}</div>` : ''}
  <h2 class="section">${plural(parts.length, 'part')}</h2>
  ${parts.length ? `<div class="grid parts">${parts.map(p => partCard(p, { showModel: true })).join('')}</div>`
    : '<div class="empty">No parts matched. Try a shorter search, or check the model number on your fridge label.</div>'}`;
};
pages.search.after = () => {
  $('#pageSearch').onsubmit = e => {
    e.preventDefault();
    const d = new FormData(e.target);
    const p = new URLSearchParams();
    if (d.get('q')) p.set('q', d.get('q'));
    if (d.get('cat')) p.set('cat', d.get('cat'));
    location.hash = '#/search?' + p;
  };
};

pages.cart = () => {
  const { lines, subtotal, quoteLines } = cartTotals();
  if (!lines.length) return `${stepper(3)}<h1>Your cart</h1>
    <div class="empty">Your cart is empty. <a class="btn small" href="#/">Start shopping</a></div>`;
  return `
  ${stepper(3)}
  <h1>Your cart</h1>
  <div class="layout cart">
    <section class="card lines">
      ${lines.map(({ part: p, qty }) => `
      <div class="line">
        ${tile(p)}
        <div class="line-info">
          <a href="#/part/${encodeURIComponent(p.id)}"><b>${esc(p.name)}</b></a>
          <div class="pn">${esc(p.partNo)} · ${esc(modelLabel(modelById[p.modelId]))}</div>
          <button class="link danger" data-remove="${esc(p.id)}">Remove</button>
        </div>
        <div class="qty" role="group" aria-label="Quantity for ${esc(p.name)}">
          <button data-dec="${esc(p.id)}" aria-label="Decrease">−</button>
          <input type="number" value="${qty}" min="1" max="${available(p)}" data-qty="${esc(p.id)}" aria-label="Quantity" />
          <button data-inc="${esc(p.id)}" aria-label="Increase">+</button>
        </div>
        <div class="line-price">${p.price == null ? '<span class="price quote">Quote</span>' : money(p.price * qty)}</div>
      </div>`).join('')}
    </section>
    <aside class="card summary">
      <h3>Order summary</h3>
      <div class="row"><span>Items</span><b>${cartCount()}</b></div>
      <div class="row"><span>Subtotal</span><b>${money(subtotal)}</b></div>
      ${quoteLines ? `<p class="note small">${plural(quoteLines, 'item')} need a quote and ${quoteLines === 1 ? 'is' : 'are'} not included in the subtotal.</p>` : ''}
      <p class="muted small">Shipping and tax are confirmed when we review your order.</p>
      <a class="btn block" href="#/checkout">Continue to checkout</a>
      <a class="btn ghost block" href="#/">Keep shopping</a>
      <button class="link danger" id="clearCart">Clear cart</button>
    </aside>
  </div>`;
};

pages.checkout = () => {
  const { lines, subtotal, quoteLines } = cartTotals();
  if (!lines.length) return `${stepper(4)}<h1>Checkout</h1><div class="empty">Your cart is empty. <a class="btn small" href="#/">Start shopping</a></div>`;
  const draft = store.get('fp_draft', {});
  const v = k => esc(draft[k] || '');
  return `
  ${stepper(4)}
  <h1>Checkout</h1>
  <div class="layout cart">
    <form id="checkoutForm" class="card form" novalidate>
      <h3>Your details</h3>
      <div class="field"><label for="name">Full name *</label><input id="name" name="name" autocomplete="name" value="${v('name')}" /><small class="err" data-for="name"></small></div>
      <div class="two">
        <div class="field"><label for="email">Email *</label><input id="email" name="email" type="email" autocomplete="email" value="${v('email')}" /><small class="err" data-for="email"></small></div>
        <div class="field"><label for="phone">Phone</label><input id="phone" name="phone" type="tel" autocomplete="tel" value="${v('phone')}" /></div>
      </div>
      <h3>Delivery</h3>
      <div class="radios">
        <label class="radio"><input type="radio" name="method" value="pickup" ${draft.method !== 'ship' ? 'checked' : ''}/> <b>Local pickup</b><small>We'll contact you to arrange a time</small></label>
        <label class="radio"><input type="radio" name="method" value="ship" ${draft.method === 'ship' ? 'checked' : ''}/> <b>Ship to me</b><small>Shipping cost confirmed after review</small></label>
      </div>
      <div id="shipFields" ${draft.method === 'ship' ? '' : 'hidden'}>
        <div class="field"><label for="address">Street address *</label><input id="address" name="address" autocomplete="street-address" value="${v('address')}" /><small class="err" data-for="address"></small></div>
        <div class="two">
          <div class="field"><label for="city">City *</label><input id="city" name="city" autocomplete="address-level2" value="${v('city')}" /><small class="err" data-for="city"></small></div>
          <div class="field"><label for="zip">ZIP / Postal code *</label><input id="zip" name="zip" autocomplete="postal-code" value="${v('zip')}" /><small class="err" data-for="zip"></small></div>
        </div>
      </div>
      <div class="field"><label for="notes">Notes (optional)</label><textarea id="notes" name="notes" rows="3" placeholder="Anything we should know about your fridge or order?">${v('notes')}</textarea></div>
      <button class="btn" type="submit">${quoteLines ? 'Submit order & quote request' : 'Place order'}</button>
    </form>
    <aside class="card summary">
      <h3>Your items</h3>
      ${lines.map(({ part: p, qty }) => `<div class="row"><span>${qty} × ${esc(p.name)}<br><small class="pn">${esc(p.partNo)}</small></span><b>${p.price == null ? 'Quote' : money(p.price * qty)}</b></div>`).join('')}
      <hr />
      <div class="row"><span>Subtotal</span><b>${money(subtotal)}</b></div>
      ${quoteLines ? `<p class="note small">${plural(quoteLines, 'item')} will be quoted separately.</p>` : ''}
      <p class="muted small">Payment is arranged after we confirm availability and shipping. No payment is taken on this page.</p>
      <a class="link" href="#/cart">← Edit cart</a>
    </aside>
  </div>`;
};
pages.checkout.after = () => {
  const form = $('#checkoutForm');
  if (!form) return;
  const data = () => Object.fromEntries(new FormData(form));
  const toggle = () => { $('#shipFields').hidden = data().method !== 'ship'; };
  form.addEventListener('input', () => { store.set('fp_draft', data()); toggle(); });
  form.addEventListener('change', toggle);
  form.onsubmit = e => {
    e.preventDefault();
    const d = data();
    const errs = {};
    if (!d.name?.trim()) errs.name = 'Please enter your name.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email || '')) errs.email = 'Please enter a valid email address.';
    if (d.method === 'ship') {
      if (!d.address?.trim()) errs.address = 'Street address is required for shipping.';
      if (!d.city?.trim()) errs.city = 'City is required.';
      if (!d.zip?.trim()) errs.zip = 'ZIP / postal code is required.';
    }
    $$('.err', form).forEach(el => el.textContent = errs[el.dataset.for] || '');
    const first = Object.keys(errs)[0];
    if (first) { $('#' + first).focus(); return; }

    const { lines, subtotal, quoteLines } = cartTotals();
    // Re-check stock at submit time.
    const short = lines.find(l => l.qty > available(l.part));
    if (short) { toast(`${short.part.partNo} is no longer available in that quantity`, '#/cart'); return; }
    const order = {
      id: 'FP-' + Date.now().toString(36).toUpperCase().slice(-6) + Math.random().toString(36).slice(2, 4).toUpperCase(),
      date: new Date().toISOString(),
      customer: { name: d.name.trim(), email: d.email.trim(), phone: (d.phone || '').trim() },
      method: d.method,
      address: d.method === 'ship' ? `${d.address.trim()}, ${d.city.trim()} ${d.zip.trim()}` : '',
      notes: (d.notes || '').trim(),
      items: lines.map(l => ({ id: l.part.id, name: l.part.name, partNo: l.part.partNo, model: modelLabel(modelById[l.part.modelId]), price: l.part.price, qty: l.qty })),
      subtotal, quoteLines,
    };
    lines.forEach(l => { sold[l.part.id] = (sold[l.part.id] || 0) + l.qty; });
    orders.unshift(order);
    store.set('fp_sold', sold); store.set('fp_orders', orders);
    cart = {}; saveCart();
    try { localStorage.removeItem('fp_draft'); } catch { /* ignore */ }
    location.hash = '#/order/' + order.id;
  };
};

pages.order = ([id]) => {
  const o = orders.find(x => x.id === id);
  if (!o) return notFound('We couldn\'t find that order on this device.');
  return `
  ${stepper(5)}
  <div class="success card">
    <div class="check-big">✓</div>
    <h1>${o.quoteLines ? 'Request received' : 'Order received'}</h1>
    <p>Thanks, ${esc(o.customer.name.split(' ')[0])}. Your reference is <b class="ref">${esc(o.id)}</b>.
    We'll email <b>${esc(o.customer.email)}</b> to confirm availability${o.quoteLines ? ', send your quote' : ''} and arrange ${o.method === 'ship' ? 'shipping' : 'pickup'}.</p>
    <ol class="timeline">
      <li class="done">Received</li><li>Confirmed</li><li>Packed</li><li>${o.method === 'ship' ? 'Shipped' : 'Ready for pickup'}</li>
    </ol>
  </div>
  <div class="card summary wide">
    <h3>Order details</h3>
    ${o.items.map(i => `<div class="row"><span>${i.qty} × ${esc(i.name)}<br><small class="pn">${esc(i.partNo)} · ${esc(i.model)}</small></span><b>${i.price == null ? 'Quote' : money(i.price * i.qty)}</b></div>`).join('')}
    <hr /><div class="row"><span>Subtotal</span><b>${money(o.subtotal)}</b></div>
    <p class="muted small">${o.method === 'ship' ? 'Ship to: ' + esc(o.address) : 'Local pickup'} · Placed ${new Date(o.date).toLocaleString()}</p>
    <div class="actions"><a class="btn" href="#/">Continue shopping</a><button class="btn ghost" onclick="window.print()">Print</button></div>
  </div>`;
};

pages.orders = () => `
  ${breadcrumb([{ label: 'Home', href: '#/' }, { label: 'My orders' }])}
  <h1>My orders</h1>
  ${orders.length ? `<div class="card lines">${orders.map(o => `
    <a class="line order-line" href="#/order/${esc(o.id)}">
      <div class="line-info"><b>${esc(o.id)}</b><div class="muted">${new Date(o.date).toLocaleDateString()} · ${plural(o.items.reduce((n, i) => n + i.qty, 0), 'item')}</div></div>
      <div class="line-price">${o.quoteLines ? 'Quote pending' : money(o.subtotal)}</div>
    </a>`).join('')}</div>`
  : '<div class="empty">No orders on this device yet.</div>'}`;

function notFound(msg) {
  return `<div class="empty"><h1>Not found</h1><p>${msg}</p><a class="btn" href="#/">Back to home</a></div>`;
}

/* ---------- router ---------- */
function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, qs = ''] = raw.split('?');
  const [name = '', ...rest] = path.split('/').filter(Boolean);
  return { name: name || 'home', args: rest, query: new URLSearchParams(qs) };
}

function render() {
  const { name, args, query } = parseHash();
  const page = pages[name] || (() => notFound('That page doesn\'t exist.'));
  const app = $('#app');
  app.innerHTML = page(args, query);
  page.after?.(args, query);
  $$('.nav a').forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#/' + (name === 'home' ? '' : name)));
  document.title = ({
    home: 'Fridge Parts – Find your refrigerator part', brand: `${decodeURIComponent(args[0] || '')} parts – Fridge Parts`,
    model: `${modelById[args[0]]?.fullModel || 'Model'} parts – Fridge Parts`, part: `${partById[decodeURIComponent(args[0] || '')]?.name || 'Part'} – Fridge Parts`,
    cart: 'Cart – Fridge Parts', checkout: 'Checkout – Fridge Parts', search: 'Search – Fridge Parts', order: 'Order – Fridge Parts', orders: 'My orders – Fridge Parts',
  })[name] || 'Fridge Parts';
  updateCartBadge();
}

let lastKey = '';
function onRoute() {
  const key = parseHash().name + '/' + parseHash().args.join('/');
  render();
  if (key !== lastKey) window.scrollTo(0, 0);
  lastKey = key;
}

/* ---------- global events ---------- */
document.addEventListener('click', e => {
  const add = e.target.closest('[data-add]');
  if (add) {
    const p = partById[add.dataset.add];
    if (addToCart(p.id)) toast(`Added ${p.partNo} to your cart`, '#/cart');
    return;
  }
  const t = e.target.closest('[data-remove],[data-inc],[data-dec],#clearCart');
  if (!t) return;
  if (t.id === 'clearCart') { cart = {}; saveCart(); }
  else if (t.dataset.remove) setQty(t.dataset.remove, 0);
  else if (t.dataset.inc) setQty(t.dataset.inc, (cart[t.dataset.inc] || 0) + 1);
  else if (t.dataset.dec) setQty(t.dataset.dec, (cart[t.dataset.dec] || 0) - 1);
  render();
});
document.addEventListener('change', e => {
  if (e.target.matches('[data-qty]')) { setQty(e.target.dataset.qty, parseInt(e.target.value, 10) || 1); render(); }
});
document.addEventListener('submit', e => {
  if (e.target.id !== 'finder') return;
  e.preventDefault();
  const val = $('#modelInput').value.trim();
  const m = findModelExact(val);
  if (m) { location.hash = '#/model/' + m.id; return; }
  const near = searchModels(val);
  $('#finderMsg').innerHTML = val
    ? `We couldn't find “${esc(val)}”. ${near.length ? 'Did you mean: ' + near.map(n => `<a href="#/model/${n.id}">${esc(n.fullModel)}</a>`).join(', ') + '?' : `Try <a href="#/search?q=${encodeURIComponent(val)}">searching parts</a> instead.`}`
    : 'Please enter a model number.';
});

/* header search with suggestions */
const hq = $('#headerSearch'), sug = $('#suggest');
function drawSuggest() {
  const q = hq.value.trim();
  if (q.length < 2) { sug.hidden = true; return; }
  const ms = searchModels(q).slice(0, 3);
  const ps = searchParts(q).slice(0, 5);
  if (!ms.length && !ps.length) { sug.innerHTML = '<div class="s-empty">No matches</div>'; sug.hidden = false; return; }
  sug.innerHTML = ms.map(m => `<a href="#/model/${m.id}"><span>🧊</span><div><b>${esc(m.fullModel)}</b><small>${esc(m.brand)} model</small></div></a>`).join('')
    + ps.map(p => `<a href="#/part/${encodeURIComponent(p.id)}"><span>${p.icon}</span><div><b>${esc(p.name)}</b><small>${esc(p.partNo)} · ${esc(modelById[p.modelId].model)}</small></div></a>`).join('')
    + `<a class="all" href="#/search?q=${encodeURIComponent(q)}">See all results for “${esc(q)}”</a>`;
  sug.hidden = false;
}
hq.addEventListener('input', drawSuggest);
hq.addEventListener('focus', drawSuggest);
document.addEventListener('click', e => { if (!e.target.closest('.search')) sug.hidden = true; });
sug.addEventListener('click', () => { sug.hidden = true; hq.value = ''; });
$('#headerForm').addEventListener('submit', e => {
  e.preventDefault();
  const q = hq.value.trim();
  sug.hidden = true;
  if (q) location.hash = '#/search?q=' + encodeURIComponent(q);
});

/* theme toggle */
const root = document.documentElement;
const savedTheme = store.get('fp_theme', null);
if (savedTheme) root.dataset.theme = savedTheme;
$('#themeBtn').onclick = () => {
  const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  store.set('fp_theme', root.dataset.theme);
};

window.addEventListener('hashchange', onRoute);
onRoute();
