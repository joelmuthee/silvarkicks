// Silvarkicks Store - frontend catalog
const IMG_VERSION = 'v1';
const API_BASE = 'https://silvarkicks-api.stawisystems.workers.dev';
(async function() {
  const gallery = document.getElementById('gallery');
  const filterMeta = document.getElementById('filterMeta');
  const availPills = document.getElementById('availPills');
  const catPills = document.getElementById('catPills');
  const sizePills = document.getElementById('sizePills');
  const searchInput = document.getElementById('searchInput');
  const searchClear = document.getElementById('searchClear');
  const sortSelect = document.getElementById('sortSelect');
  const PAGE_SIZE = 15;
  let items = [];
  let settings = {};
  let suspended = false;
  let currentAvail = 'all';
  let currentCat = 'all';
  let currentSize = 'all';
  let currentPage = 1;
  let currentSearch = '';
  let currentSort = 'featured';

  // Wishlist
  const WISHLIST_KEY = 'silvar_wishlist';
  function loadWishlist() {
    try { return new Set(JSON.parse(localStorage.getItem(WISHLIST_KEY) || '[]')); }
    catch { return new Set(); }
  }
  function saveWishlist(set) { localStorage.setItem(WISHLIST_KEY, JSON.stringify([...set])); }
  let wishlist = loadWishlist();

  // Per-item deterministic base count (7..20) + 1 if visitor wishlisted it.
  // Social-proof signal without inventing fake activity. Same pattern as
  // ThriftLux. Hash on item.id so the number is stable across reloads.
  function itemBaseLikes(id) {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
    return 7 + Math.abs(h) % 14;
  }
  function itemLikeCount(id) {
    return itemBaseLikes(id) + (wishlist.has(id) ? 1 : 0);
  }

  function toggleWishlist(id) {
    if (wishlist.has(id)) wishlist.delete(id); else wishlist.add(id);
    saveWishlist(wishlist);
    refreshWishlistUi();
  }
  function refreshWishlistUi() {
    const count = wishlist.size;
    const badge = document.getElementById('wishlistCount');
    if (badge) {
      badge.textContent = count;
      badge.hidden = count === 0;
    }
    document.querySelectorAll('[data-action="wishlist"]').forEach(btn => {
      const on = wishlist.has(btn.dataset.id);
      const wasOn = btn.classList.contains('on');
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      const countEl = btn.querySelector('.heart-count');
      if (countEl) countEl.textContent = itemLikeCount(btn.dataset.id);
      if (on && !wasOn) {
        btn.classList.add('pop');
        setTimeout(() => btn.classList.remove('pop'), 350);
      }
    });
  }

  async function loadData() {
    try {
      const res = await fetch(`${API_BASE}/api/bags?_=${Date.now()}`);
      const json = await res.json();
      items = json.bags || [];
      settings = json.settings || {};
      suspended = !!json.suspended;
    } catch(e) {
      try {
        const res = await fetch('data.json');
        const json = await res.json();
        items = json.bags || [];
        settings = json.settings || {};
      } catch(e2) { items = []; }
    }
  }

  function fmtPrice(n) {
    return 'Ksh ' + Number(n).toLocaleString('en-KE');
  }

  // Stock helpers - read the new schema (stock {} + sales []) with graceful fallback to legacy sizes[].
  function totalStock(item) {
    if (item.stock && Object.keys(item.stock).length) {
      return Object.values(item.stock).reduce((s, q) => s + (Number(q) || 0), 0);
    }
    // Legacy: assume 1 unit per listed size
    return (item.sizes || []).length;
  }
  function availSizes(item) {
    if (item.stock && Object.keys(item.stock).length) {
      const hasSales = (item.sales || []).length > 0;
      // Before any recorded sale, show every configured size. After sales begin, hide zero-stock sizes.
      const keys = hasSales
        ? Object.entries(item.stock).filter(([, q]) => q > 0).map(([s]) => s)
        : Object.keys(item.stock);
      return keys.filter(s => s !== 'One Size').sort(sortSize);
    }
    return (item.sizes || []).slice().sort(sortSize);
  }
  function isSoldOut(item) {
    // Legacy fallback
    if (typeof item.sold === 'boolean' && (!item.stock || !Object.keys(item.stock).length)) return item.sold;
    // New schema: every configured size at 0 AND at least one sale recorded
    if (!item.stock || !Object.keys(item.stock).length) return false;
    const allZero = Object.values(item.stock).every(q => (q || 0) === 0);
    if (!allZero) return false;
    return (item.sales || []).length > 0;
  }

  function enquireMessage(item) {
    const avail = availSizes(item);
    const sizePart = avail.length ? ` (size ${avail.join(', ')})` : '';
    const pricePart = (item.price > 0) ? ` (${fmtPrice(item.price)})` : '';
    return `Hi Silvarkicks! I'd like to enquire about the *${item.name}*${sizePart}${pricePart} from your catalog.`;
  }

  function whatsappLink(item) {
    const phone = (settings.whatsappNumber || '254746262400');
    const body = enquireMessage(item);
    // Append the item's share page — WhatsApp previews it as a card with the
    // product photo + name + price. Still opens straight to WhatsApp (no app picker).
    // (Do NOT reintroduce navigator.share here — it forces the OS app-picker, which the owner rejected.)
    const shareUrl = item.id ? `${API_BASE}/p/${encodeURIComponent(item.id)}` : '';
    const msg = shareUrl ? `${body}\n\n${shareUrl}` : body;
    return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
  }

  function whatsappLinkAll(itemList) {
    const phone = (settings.whatsappNumber || '254746262400');
    if (!itemList.length) return `https://wa.me/${phone}`;
    const lines = itemList.map((it, i) => {
      const pricePart = it.price > 0 ? ` (${fmtPrice(it.price)})` : '';
      return `${i + 1}. *${it.name}*${pricePart}`;
    }).join('\n');
    const msg = `Hi Silvarkicks! I'd like to enquire about these pairs from my wishlist:\n\n${lines}`;
    return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
  }
  function priceHtml(item) {
    return item.price > 0
      ? `<span class="card-price">${fmtPrice(item.price)}</span>`
      : `<span class="card-price card-price-onreq"><small>Price on request</small></span>`;
  }
  function isNew(item) {
    if (!item.createdAt) return false;
    const created = new Date(item.createdAt).getTime();
    if (!created) return false;
    return (Date.now() - created) < 7 * 24 * 60 * 60 * 1000;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function getCategories() {
    return [...new Set(items.map(i => i.category).filter(Boolean))].sort();
  }

  function sortSize(a, b) {
    // UK shoe sizes: "UK4", "UK10" → strip prefix, sort numerically
    const ukA = /^UK(\d+(?:\.\d+)?)$/i.exec(a);
    const ukB = /^UK(\d+(?:\.\d+)?)$/i.exec(b);
    if (ukA && ukB) return parseFloat(ukA[1]) - parseFloat(ukB[1]);
    if (ukA) return -1;
    if (ukB) return 1;
    const na = parseFloat(a), nb = parseFloat(b);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    if (!isNaN(na)) return -1;
    if (!isNaN(nb)) return 1;
    return a.localeCompare(b);
  }

  function getSizesForCurrentCat() {
    const pool = currentCat === 'all' ? items : items.filter(i => i.category === currentCat);
    const all = new Set();
    pool.forEach(i => availSizes(i).forEach(s => all.add(s)));
    return [...all].sort(sortSize);
  }

  function buildCatPills() {
    initDropdowns();
    const cats = getCategories();
    if (!cats.length) { catPills.innerHTML = ''; return; }
    const groups = [{ label: null, options: [{ val: 'all', text: 'All categories' }].concat(cats.map(c => ({ val: c, text: c }))) }];
    catPills.innerHTML = dropdownHTML({ kind: 'cat', value: currentCat, ariaLabel: 'Filter by category', groups });
  }

  // Custom filter dropdown — replaces the native <select> so the open list can
  // show a "scroll for more" cue (a native option popup is OS-drawn and can't be
  // styled; it gives no at-rest hint that more options sit below the fold).
  function dropdownHTML({ kind, value, ariaLabel, groups }) {
    let cur = null;
    groups.forEach(g => g.options.forEach(o => { if (o.val === value) cur = o; }));
    if (!cur) cur = groups[0].options[0];
    const body = groups.map(g =>
      (g.label ? `<div class="cdrop-group">${escapeHtml(g.label)}</div>` : '') +
      g.options.map(o => `<button type="button" role="option" class="cdrop-opt${o.val === value ? ' selected' : ''}" data-val="${escapeHtml(o.val)}"${o.val === value ? ' aria-selected="true"' : ''}>${escapeHtml(o.text)}</button>`).join('')
    ).join('');
    const active = value && value !== 'all';
    return `<div class="cdrop filter-select${active ? ' cdrop--active' : ''}" data-kind="${kind}" aria-label="${escapeHtml(ariaLabel)}">`
      + `<button type="button" class="cdrop-trigger sort-select" aria-haspopup="listbox" aria-expanded="false"><span class="cdrop-current">${escapeHtml(cur.text)}</span></button>`
      + `<div class="cdrop-panel" role="listbox" hidden><div class="cdrop-scroll">${body}</div><div class="cdrop-morehint" aria-hidden="true"></div></div>`
      + `</div>`;
  }

  function updateDropHint(sc) {
    const hint = sc.parentElement && sc.parentElement.querySelector('.cdrop-morehint');
    if (hint) hint.classList.toggle('show', sc.scrollHeight - sc.scrollTop - sc.clientHeight > 4);
  }
  function closeAllDropdowns() {
    document.querySelectorAll('.cdrop.open').forEach(d => {
      d.classList.remove('open');
      const p = d.querySelector('.cdrop-panel'); if (p) p.hidden = true;
      const t = d.querySelector('.cdrop-trigger'); if (t) t.setAttribute('aria-expanded', 'false');
    });
  }
  function openDropdown(drop) {
    drop.classList.add('open');
    drop.querySelector('.cdrop-panel').hidden = false;
    drop.querySelector('.cdrop-trigger').setAttribute('aria-expanded', 'true');
    const sc = drop.querySelector('.cdrop-scroll');
    const sel = sc.querySelector('.cdrop-opt.selected');
    if (sel) sc.scrollTop = Math.max(0, sel.offsetTop - 8);
    updateDropHint(sc);
  }
  // Bind all dropdown interaction ONCE via delegation — buildCatPills/buildSizePills
  // re-run on every render(), so per-element listeners would leak.
  let dropdownsBound = false;
  function initDropdowns() {
    if (dropdownsBound) return;
    dropdownsBound = true;
    document.addEventListener('click', (e) => {
      const trigger = e.target.closest('.cdrop-trigger');
      if (trigger) {
        e.stopPropagation();
        const drop = trigger.closest('.cdrop');
        const wasOpen = drop.classList.contains('open');
        closeAllDropdowns();
        if (!wasOpen) openDropdown(drop);
        return;
      }
      const opt = e.target.closest('.cdrop-opt');
      if (opt) {
        const drop = opt.closest('.cdrop');
        const val = opt.dataset.val, kind = drop.dataset.kind;
        closeAllDropdowns();
        if (kind === 'cat') { currentCat = val; currentSize = 'all'; }
        else if (kind === 'size') { currentSize = val; }
        currentPage = 1;
        render();
        return;
      }
      if (!e.target.closest('.cdrop-panel')) closeAllDropdowns();
    });
    // scroll doesn't bubble — listen in capture phase to catch the inner list scroll
    document.addEventListener('scroll', (e) => {
      if (e.target.classList && e.target.classList.contains('cdrop-scroll')) updateDropHint(e.target);
    }, true);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAllDropdowns(); });
  }

  // Group a size token for the size dropdown (apparel + footwear verticals).
  function sizeGroup(s) {
    const u = String(s).toUpperCase();
    if (u.startsWith('UK')) return 'Shoe size (UK)';
    if (u.startsWith('EU')) return 'Shoe size (EU)';
    if (/LARGE|MEDIUM|SMALL/.test(u) || /^(XS|S|M|L|XL|XXL|XXXL|\dXL)$/.test(u)) return 'Clothing (S-XL)';
    if (/\d/.test(u)) return 'Waist / number';
    return 'Other';
  }

  function buildSizePills() {
    const sizes = getSizesForCurrentCat();
    if (sizes.length < 2) { sizePills.innerHTML = ''; return; }
    const order = ['Clothing (S-XL)', 'Waist / number', 'Shoe size (UK)', 'Shoe size (EU)', 'Other'];
    const grouped = {};
    sizes.forEach(s => { (grouped[sizeGroup(s)] = grouped[sizeGroup(s)] || []).push(s); });
    const groups = [{ label: null, options: [{ val: 'all', text: 'All sizes' }] }];
    order.forEach(g => {
      if (!grouped[g] || !grouped[g].length) return;
      groups.push({ label: g, options: grouped[g].map(s => ({ val: s, text: s })) });
    });
    sizePills.innerHTML = dropdownHTML({ kind: 'size', value: currentSize, ariaLabel: 'Filter by size', groups });
  }

  function sizeMatch(item) {
    if (currentSize === 'all') return true;
    const sizes = availSizes(item);
    if (sizes.includes(currentSize)) return true;
    const target = parseFloat(currentSize);
    if (!isNaN(target)) {
      for (const s of sizes) {
        const range = s.match(/(\d+)\s*[-–]\s*(\d+)/);
        if (range && target >= parseFloat(range[1]) && target <= parseFloat(range[2])) return true;
      }
    }
    return false;
  }

  function searchMatch(item, q) {
    if (!q) return true;
    const hay = `${item.name || ''} ${item.description || ''} ${item.category || ''}`.toLowerCase();
    return q.split(/\s+/).every(tok => hay.includes(tok));
  }

  // Per-item activity tracking. Writes localStorage (offline echo) AND beacons
  // the worker so the admin sees site-wide totals across all visitors/devices.
  const INSIGHTS_KEY = 'silvar_analytics';
  function track(metric, key) {
    if (!key && key !== 0) return;
    try {
      const data = JSON.parse(localStorage.getItem(INSIGHTS_KEY) || '{}');
      data[metric] = data[metric] || {};
      data[metric][key] = (data[metric][key] || 0) + 1;
      localStorage.setItem(INSIGHTS_KEY, JSON.stringify(data));
    } catch {}
    try {
      const payload = JSON.stringify({ metric, key });
      const blob = new Blob([payload], { type: 'text/plain' });
      if (navigator.sendBeacon) navigator.sendBeacon(`${API_BASE}/api/track`, blob);
      else fetch(`${API_BASE}/api/track`, { method: 'POST', body: payload, keepalive: true }).catch(() => {});
    } catch {}
  }

  function render() {
    buildCatPills();
    buildSizePills();

    const q = currentSearch.trim().toLowerCase();
    let filtered = items.filter(item => {
      const soldOut = isSoldOut(item);
      const availOk = currentAvail === 'all' || (currentAvail === 'sold' ? soldOut : !soldOut);
      const catOk = currentCat === 'all' || item.category === currentCat;
      return availOk && catOk && sizeMatch(item) && searchMatch(item, q);
    });

    if (q && filtered.length === 0) track('searchNoResults', q);

    // Sort
    if (currentSort === 'newest') {
      filtered = [...filtered].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    } else if (currentSort === 'price-asc') {
      filtered = [...filtered].sort((a, b) => (a.price || 0) - (b.price || 0));
    } else if (currentSort === 'price-desc') {
      filtered = [...filtered].sort((a, b) => (b.price || 0) - (a.price || 0));
    } // featured = original IG-grid order, do nothing

    const availCount = items.filter(i => !isSoldOut(i)).length;
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;
    const start = (currentPage - 1) * PAGE_SIZE;
    const end = start + PAGE_SIZE;
    const visible = filtered.slice(start, end);
    const showing = visible.length ? `${start + 1}–${start + visible.length}` : '0';
    filterMeta.textContent = `Showing ${showing} of ${filtered.length} · ${availCount} available`;

    const WA_SVG = `<svg class="wa-icon" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.71.306 1.263.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413"/></svg>`;
    const IG_SVG = `<svg class="ig-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line></svg>`;

    gallery.innerHTML = visible.map(item => {
      const soldOut = isSoldOut(item);
      const avail = availSizes(item);
      const sizesHtml = avail.length
        ? `<div class="size-chips">${avail.map(s => `<span class="size-chip">${escapeHtml(s)}</span>`).join('')}</div>`
        : '';
      const catBadge = item.category
        ? `<span class="badge-cat">${escapeHtml(item.category)}</span>`
        : '';
      const heartOn = wishlist.has(item.id);
      const newBadge = isNew(item) ? '<span class="badge-new">NEW</span>' : '';
      return `
      <article class="card fade-up ${soldOut ? 'sold' : ''}" data-id="${item.id}">
        <div class="card-img-wrap" data-action="zoom" data-id="${item.id}">
          <img class="card-img" src="${item.image}?${IMG_VERSION}" alt="${escapeHtml(item.name)}" loading="lazy">
          ${newBadge}
          ${soldOut ? '<span class="badge-sold">Sold out</span>' : ''}
          ${catBadge}
          <button class="heart-btn ${heartOn ? 'on' : ''}" data-action="wishlist" data-id="${item.id}" aria-pressed="${heartOn}" aria-label="${heartOn ? 'Remove from wishlist' : 'Save to wishlist'}">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
            <span class="heart-count">${itemLikeCount(item.id)}</span>
          </button>
        </div>
        <div class="card-body">
          <h3 class="card-title">${escapeHtml(item.name)}</h3>
          <p class="card-desc">${escapeHtml(item.description || '')}</p>
          ${sizesHtml}
          <div class="card-price-row">
            ${priceHtml(item)}
          </div>
          <div class="card-actions">
            <a class="btn-card primary" href="${whatsappLink(item)}" target="_blank" rel="noopener" ${soldOut ? 'aria-disabled="true"' : ''}>
              ${WA_SVG} ${soldOut ? 'Sold out' : 'Check availability'}
            </a>
            ${item.instagramUrl ? `<a class="btn-card btn-ig" href="${escapeHtml(item.instagramUrl)}" target="_blank" rel="noopener" aria-label="View on Instagram">
              ${IG_SVG} View on IG
            </a>` : ''}
          </div>
        </div>
      </article>`;
    }).join('');

    // Re-observe new cards for fade-in
    observeFadeTargets();
    refreshWishlistUi();

    // Numbered pagination
    const oldPager = document.getElementById('pagerWrap');
    if (oldPager) oldPager.remove();
    if (totalPages > 1) {
      const wrap = document.createElement('div');
      wrap.id = 'pagerWrap';
      wrap.className = 'pager-wrap';
      const pages = pageRange(currentPage, totalPages);
      const btn = (label, page, opts = {}) => {
        const cls = ['pager-btn'];
        if (opts.active) cls.push('active');
        if (opts.disabled) cls.push('disabled');
        if (opts.ellipsis) cls.push('ellipsis');
        const dataPage = opts.disabled || opts.ellipsis ? '' : ` data-page="${page}"`;
        return `<button class="${cls.join(' ')}"${dataPage}${opts.disabled ? ' disabled' : ''}>${label}</button>`;
      };
      const html = [
        btn('‹', currentPage - 1, { disabled: currentPage === 1 }),
        ...pages.map(p => p === '…' ? btn('…', null, { ellipsis: true }) : btn(p, p, { active: p === currentPage })),
        btn('›', currentPage + 1, { disabled: currentPage === totalPages }),
      ].join('');
      wrap.innerHTML = html;
      gallery.parentNode.insertBefore(wrap, gallery.nextSibling);
      wrap.querySelectorAll('.pager-btn[data-page]').forEach(b => {
        b.addEventListener('click', () => {
          const p = parseInt(b.dataset.page, 10);
          if (!isNaN(p) && p >= 1 && p <= totalPages && p !== currentPage) {
            currentPage = p;
            render();
            document.getElementById('shop').scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        });
      });
    }
  }

  function pageRange(cur, total) {
    if (total <= 7) return Array.from({length: total}, (_, i) => i + 1);
    const pages = [1];
    if (cur > 3) pages.push('…');
    for (let p = Math.max(2, cur - 1); p <= Math.min(total - 1, cur + 1); p++) pages.push(p);
    if (cur < total - 2) pages.push('…');
    pages.push(total);
    return pages;
  }

  // Availability pills
  availPills.querySelectorAll('.pill').forEach(p => {
    p.addEventListener('click', () => {
      availPills.querySelectorAll('.pill').forEach(x => x.classList.remove('active'));
      p.classList.add('active');
      currentAvail = p.dataset.avail;
      currentSize = 'all';
      currentPage = 1;
      render();
    });
  });

  // Search input (debounced 180ms)
  if (searchInput) {
    let timer;
    searchInput.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        currentSearch = searchInput.value;
        currentPage = 1;
        if (searchClear) searchClear.hidden = !searchInput.value;
        render();
      }, 180);
    });
    searchClear?.addEventListener('click', () => {
      searchInput.value = '';
      currentSearch = '';
      searchClear.hidden = true;
      currentPage = 1;
      render();
      searchInput.focus();
    });
  }

  // Sort dropdown
  sortSelect?.addEventListener('change', () => {
    currentSort = sortSelect.value;
    currentPage = 1;
    render();
  });

  // Wishlist drawer
  const wishlistBtn = document.getElementById('wishlistBtn');
  const drawer = document.getElementById('wishlistDrawer');
  const wishlistListEl = document.getElementById('wishlistList');
  const wishlistFoot = document.getElementById('wishlistFoot');
  const wishlistEnquireAll = document.getElementById('wishlistEnquireAll');

  function openDrawer() {
    renderWishlistDrawer();
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }
  function closeDrawer() {
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }
  function renderWishlistDrawer() {
    const list = [...wishlist].map(id => items.find(i => i.id === id)).filter(Boolean);
    if (!list.length) {
      wishlistListEl.innerHTML = '<p class="drawer-empty">No saved items yet. Tap the heart on any item to save it.</p>';
      wishlistFoot.hidden = true;
      return;
    }
    wishlistListEl.innerHTML = list.map(it => `
      <div class="wishlist-row">
        <img src="${it.image}" alt="${escapeHtml(it.name)}">
        <div class="wishlist-row-body">
          <div class="wishlist-row-name">${escapeHtml(it.name)}</div>
          <div class="wishlist-row-meta">${it.price > 0 ? fmtPrice(it.price) : 'Price on request'}</div>
        </div>
        <button class="wishlist-remove" data-action="wishlist-remove" data-id="${it.id}" aria-label="Remove">&times;</button>
      </div>`).join('');
    wishlistFoot.hidden = false;
    wishlistEnquireAll.href = whatsappLinkAll(list);
  }
  wishlistBtn?.addEventListener('click', openDrawer);
  drawer?.addEventListener('click', e => {
    if (e.target.dataset.action === 'close-drawer') closeDrawer();
    if (e.target.dataset.action === 'wishlist-remove') {
      toggleWishlist(e.target.dataset.id);
      renderWishlistDrawer();
    }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && drawer?.classList.contains('open')) closeDrawer();
  });

  // Gallery delegated click for heart buttons.
  // Enquire just follows its wa.me href (target=_blank) — opens straight to
  // WhatsApp with the /p/<id> share page previewing as a photo card. No app picker.
  gallery.addEventListener('click', e => {
    const heart = e.target.closest('[data-action="wishlist"]');
    if (heart) {
      e.stopPropagation();
      const id = heart.dataset.id;
      const wasOn = wishlist.has(id);
      toggleWishlist(id);
      if (!wasOn && wishlist.has(id)) track('itemWishlist', id);
      return;
    }
    const enquire = e.target.closest('.btn-card.primary');
    if (enquire) { const card = enquire.closest('[data-id]'); if (card) track('itemEnquiries', card.dataset.id); return; }
    const ig = e.target.closest('.btn-ig');
    if (ig) { const card = ig.closest('[data-id]'); if (card) track('itemIgClicks', card.dataset.id); return; }
  });

  // Fade-in-up on scroll (respects prefers-reduced-motion)
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let fadeObserver = null;
  if (!reducedMotion && 'IntersectionObserver' in window) {
    fadeObserver = new IntersectionObserver(entries => {
      entries.forEach(en => {
        if (en.isIntersecting) {
          en.target.classList.add('in-view');
          fadeObserver.unobserve(en.target);
        }
      });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.05 });
  }
  function observeFadeTargets() {
    if (!fadeObserver) {
      document.querySelectorAll('.fade-up:not(.in-view)').forEach(el => el.classList.add('in-view'));
      return;
    }
    document.querySelectorAll('.fade-up:not(.in-view)').forEach(el => fadeObserver.observe(el));
  }

  // Lightbox
  const lightbox = document.getElementById('lightbox');
  const lightboxImg = document.getElementById('lightboxImg');
  const lightboxCap = document.getElementById('lightboxCaption');
  const lightboxClose = document.getElementById('lightboxClose');

  gallery.addEventListener('click', e => {
    const wrap = e.target.closest('[data-action="zoom"]');
    if (!wrap) return;
    const id = wrap.dataset.id;
    const item = items.find(i => i.id === id);
    if (!item) return;
    track('itemViews', id);
    lightboxImg.src = item.image + '?' + IMG_VERSION;
    lightboxImg.alt = item.name;
    lightboxCap.textContent = `${item.name} · ${fmtPrice(item.price)}${isSoldOut(item) ? ' · SOLD' : ''}`;
    lightbox.classList.add('open');
    lightbox.setAttribute('aria-hidden', 'false');
  });
  function closeLightbox() {
    lightbox.classList.remove('open');
    lightbox.setAttribute('aria-hidden', 'true');
  }
  lightboxClose.addEventListener('click', closeLightbox);
  lightbox.addEventListener('click', e => { if (e.target === lightbox) closeLightbox(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLightbox(); });

  // Mobile nav
  const navToggle = document.getElementById('navToggle');
  const navLinks = document.getElementById('navLinks');
  const navClose = document.getElementById('navClose');
  function closeNav() { navLinks?.classList.remove('open'); document.body.style.overflow = ''; }
  function openNav() { navLinks?.classList.add('open'); document.body.style.overflow = 'hidden'; }
  navToggle?.addEventListener('click', () => navLinks.classList.contains('open') ? closeNav() : openNav());
  navClose?.addEventListener('click', closeNav);
  navLinks?.querySelectorAll('a').forEach(a => a.addEventListener('click', closeNav));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && navLinks?.classList.contains('open')) closeNav(); });

  document.getElementById('year').textContent = new Date().getFullYear();

  // Billing kill-switch: when suspended, replace the whole page with a neutral
  // "offline" notice instead of the catalog. Buyers never see a payment reason.
  function showSuspended() {
    document.documentElement.style.overflow = 'hidden';
    const shopName = settings.shopName || 'Silvarkicks';
    document.title = shopName + ' · Offline';

    const tagline = settings.tagline || 'Pre-loved Sneakers & Boots';
    const igHandle = (settings.instagramHandle || 'silvarkicks_store1').replace(/^@/, '');
    const igLink = igHandle ? ('https://www.instagram.com/' + igHandle + '/') : '';
    const waLink = 'https://wa.me/254720615606?text=' + encodeURIComponent('Hi Essence, I\'d like to bring ' + shopName + ' back online. Tell me about the one-off option.');
    const WA_SVG = '<svg viewBox="0 0 32 32" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M16.003 3C9.38 3 4 8.38 4 15.003c0 2.117.553 4.184 1.604 6.005L4 29l8.184-1.57a11.94 11.94 0 0 0 3.819.626h.003C22.626 28.056 28 22.676 28 16.053 28 9.43 22.626 3 16.003 3zm0 21.94h-.002a9.93 9.93 0 0 1-3.4-.62l-.244-.088-4.857.932.94-4.735-.16-.244a9.91 9.91 0 0 1-1.52-5.27c0-5.49 4.47-9.96 9.96-9.96 2.66 0 5.16 1.04 7.04 2.92a9.9 9.9 0 0 1 2.92 7.04c0 5.49-4.47 9.96-9.96 9.96zm5.46-7.46c-.3-.15-1.77-.873-2.044-.973-.274-.1-.474-.15-.673.15-.2.3-.773.973-.948 1.173-.174.2-.349.224-.648.075-.3-.15-1.265-.466-2.41-1.487-.89-.794-1.49-1.774-1.665-2.074-.174-.3-.018-.462.13-.611.134-.133.3-.349.449-.523.15-.174.2-.3.3-.498.1-.2.05-.374-.025-.524-.075-.15-.673-1.622-.922-2.222-.243-.583-.49-.504-.673-.513l-.573-.01c-.2 0-.524.075-.798.374-.274.3-1.047 1.023-1.047 2.495 0 1.472 1.072 2.894 1.222 3.094.15.2 2.11 3.222 5.11 4.516.714.308 1.272.492 1.706.63.717.228 1.37.196 1.886.119.575-.086 1.77-.724 2.02-1.423.25-.7.25-1.298.175-1.423-.074-.124-.274-.199-.573-.349z"></path></svg>';
    const logoUrl = 'images/logo.jpg';

    const IG_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line></svg>';

    const css = ('@keyframes skSusFade{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}'
      + '#suspendedOverlay{position:fixed;inset:0;z-index:99999;background:radial-gradient(ellipse at top,#13210a 0%,#0a0a0a 65%);color:#f5f5f7;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:40px 24px;font-family:Inter,system-ui,-apple-system,sans-serif;animation:skSusFade 0.65s ease both;}'
      + '#suspendedOverlay .sk-logo{width:140px;height:140px;border-radius:50%;object-fit:cover;background:#fff;border:2px solid #6ef407;box-shadow:0 0 36px rgba(110,244,7,0.4),inset 0 0 0 1px rgba(255,255,255,0.04);margin-bottom:26px;}'
      + '#suspendedOverlay .sk-name{font-family:\'Cormorant Garamond\',Georgia,serif;font-size:34px;color:#b6f76b;letter-spacing:2.5px;font-weight:500;line-height:1;margin-bottom:8px;}'
      + '#suspendedOverlay .sk-tag{font-size:12px;color:#6ef407;letter-spacing:2px;text-transform:uppercase;margin-bottom:30px;opacity:0.9;}'
      + '#suspendedOverlay .sk-rule{width:54px;height:1px;background:linear-gradient(90deg,transparent,#6ef407,transparent);margin-bottom:30px;}'
      + '#suspendedOverlay .sk-head{font-family:\'Cormorant Garamond\',Georgia,serif;font-weight:500;font-size:clamp(30px,5vw,44px);margin:0 0 16px;color:#f5f5f7;line-height:1.15;}'
      + '#suspendedOverlay .sk-body{font-size:16px;max-width:460px;line-height:1.65;opacity:0.82;margin:0 0 14px;}'
      + '#suspendedOverlay .sk-offer{font-size:16px;max-width:460px;line-height:1.6;margin:0 0 30px;color:#b6f76b;}'
      + '#suspendedOverlay .sk-offer b{color:#f5f5f7;font-weight:700;}'
      + '#suspendedOverlay .sk-ig{display:inline-flex;align-items:center;gap:10px;background:#6ef407;color:#0d0d0d;padding:14px 30px;border-radius:999px;text-decoration:none;font-weight:600;font-size:15px;letter-spacing:0.3px;box-shadow:0 6px 24px rgba(110,244,7,0.3);transition:transform 0.2s ease,box-shadow 0.2s ease,background 0.2s ease;}'
      + '#suspendedOverlay .sk-ig:hover{background:#b6f76b;transform:translateY(-1px);box-shadow:0 8px 28px rgba(110,244,7,0.42);}'
      + '@media (max-width:480px){#suspendedOverlay .sk-logo{width:118px;height:118px;margin-bottom:22px;}#suspendedOverlay .sk-name{font-size:28px;letter-spacing:2px;}#suspendedOverlay .sk-tag{font-size:11px;margin-bottom:24px;}}'
    );
    const styleTag = document.createElement('style');
    styleTag.textContent = css;
    document.head.appendChild(styleTag);

    const o = document.createElement('div');
    o.id = 'suspendedOverlay';
    o.innerHTML = (
      '<img class="sk-logo" src="' + logoUrl + '" alt="' + shopName + '">'
      + '<div class="sk-name">' + shopName + '</div>'
      + (tagline ? '<div class="sk-tag">' + tagline + '</div>' : '<div style="height:30px"></div>')
      + '<div class="sk-rule"></div>'
      + '<h1 class="sk-head">This shop is paused</h1>'
      + '<p class="sk-body">Not ready for a monthly plan? You don\'t need one.</p>'
      + '<p class="sk-offer">Now you can <b>own this shop outright for a one-time Ksh 20,000</b>, no monthly fees. New stock you post on Instagram pulls straight into your shop.</p>'
      + '<a class="sk-ig" href="' + waLink + '" target="_blank" rel="noopener">' + WA_SVG + ' Bring my shop back</a>'
    );
    document.body.appendChild(o);
  }

  await loadData();
  if (suspended) { showSuspended(); return; }
  render();
  observeFadeTargets();
  refreshWishlistUi();
})();
