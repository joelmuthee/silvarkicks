// Silvarkicks Store Admin
const ADMIN_PASSWORD = 'silvar123';
const API_BASE = 'https://silvarkicks-api.stawisystems.workers.dev';
const ADMIN_TOKEN = atob('b0Nxa3VCRTYybExnSnNseUtqVnZCSUtnZHRzZC1uU3RXNWtvNmQxajZJSQ==');
const SHOP_URL = 'https://silvarkicks.essenceautomations.com'; // public storefront — used in WhatsApp messages to clients
const SITE_URL = 'https://silvarkicks.essenceautomations.com';
const UK_SIZE_FIXED = ['UK4','UK5','UK6','UK7','UK8','UK9','UK10','UK11','UK12','UK13'];

let bags = [];
let settings = {};
let clients = []; // manually-added clients (server-synced); sale buyers are derived separately
let editingId = null;
let stagedImage = null;
let stagedExtras = [];
let pendingSaleId = null;

// ====== AUTH ======
const loginScreen = document.getElementById('loginScreen');
const dashboard = document.getElementById('dashboard');
const loginBtn = document.getElementById('loginBtn');
const loginPassword = document.getElementById('loginPassword');
const loginError = document.getElementById('loginError');

function checkAuth() {
  if (sessionStorage.getItem('silvar_auth') === '1') {
    loginScreen.style.display = 'none';
    dashboard.style.display = 'block';
    init();
  }
}
loginBtn.addEventListener('click', login);
loginPassword.addEventListener('keypress', e => { if (e.key === 'Enter') login(); });
async function login() {
  const pw = loginPassword.value;
  loginError.style.display = 'none';
  try {
    const res = await fetch(`${API_BASE}/api/check-password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw })
    });
    const j = await res.json();
    if (j.ok) { sessionStorage.setItem('silvar_auth', '1'); checkAuth(); }
    else { loginError.style.display = 'block'; }
  } catch (e) {
    if (pw === ADMIN_PASSWORD) { sessionStorage.setItem('silvar_auth', '1'); checkAuth(); }
    else { loginError.style.display = 'block'; }
  }
}
document.getElementById('logoutBtn').addEventListener('click', () => {
  sessionStorage.removeItem('silvar_auth');
  location.reload();
});

// ====== CHANGE PASSWORD ======
document.getElementById('changePasswordBtn')?.addEventListener('click', () => {
  const m = document.getElementById('changePasswordModal');
  if (!m) return;
  m.style.display = 'flex';
  ['cpCurrent','cpNew','cpConfirm'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('cpError').style.display = 'none';
  document.getElementById('cpCurrent')?.focus();
});
function _closeChangePassword() { const m = document.getElementById('changePasswordModal'); if (m) m.style.display = 'none'; }
document.getElementById('cpCancelBtn')?.addEventListener('click', _closeChangePassword);
document.getElementById('changePasswordModal')?.addEventListener('click', e => { if (e.target.id === 'changePasswordModal') _closeChangePassword(); });
document.getElementById('cpSaveBtn')?.addEventListener('click', async () => {
  const cur = document.getElementById('cpCurrent').value;
  const nw  = document.getElementById('cpNew').value;
  const cf  = document.getElementById('cpConfirm').value;
  const err = document.getElementById('cpError');
  err.style.display = 'none';
  if (!cur) { err.textContent = 'Enter your current password.'; err.style.display = 'block'; return; }
  if (nw.length < 8) { err.textContent = 'New password must be at least 8 characters.'; err.style.display = 'block'; return; }
  if (nw !== cf) { err.textContent = 'New password and confirmation do not match.'; err.style.display = 'block'; return; }
  const btn = document.getElementById('cpSaveBtn');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const res = await fetch(`${API_BASE}/api/set-password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current: cur, next: nw })
    });
    const j = await res.json();
    if (j.ok) {
      _closeChangePassword();
      showToast('Password changed. You stay signed in; the new password takes effect on next login.');
    } else {
      err.textContent = j.error || 'Could not change password.';
      err.style.display = 'block';
    }
  } catch (e) {
    err.textContent = 'Network error: ' + (e.message || e);
    err.style.display = 'block';
  } finally {
    btn.disabled = false; btn.textContent = 'Change password';
  }
});

// ====== API ======
// Billing kill-switch: when the store is suspended the owner can still VIEW the
// admin but every write is frozen. The worker is the real gate (403); these
// client guards surface a clean message instead of a raw error. `accountSuspended`
// is set by loadData() from /api/bags.
const SUSPENDED_MSG = 'Your store is offline. Contact Essence Automations to restore it before making changes.';

async function apiUploadImage(base64, ext) {
  if (accountSuspended) throw new Error(SUSPENDED_MSG);
  const res = await fetch(`${API_BASE}/api/image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ADMIN_TOKEN}` },
    body: JSON.stringify({ base64, ext }),
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `Upload failed: ${res.status}`); }
  const data = await res.json();
  return `${API_BASE}${data.path}`;
}

// Low-level publish of the current in-memory `bags`. Do NOT call directly for
// user-triggered writes — go through apiMutateAndPublish so a stale list can't
// clobber the live catalogue.
async function apiPublish() {
  const res = await fetch(`${API_BASE}/api/bulk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ADMIN_TOKEN}` },
    body: JSON.stringify({ bags, settings, clients }),
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `Save failed: ${res.status}`); }
}

// Every admin write MUST go through this. It refetches live KV, applies the
// caller's mutation against the FRESH list, then publishes — so a stale admin
// tab (or a second device/webview) can't silently resurrect deleted items or
// revert edits by republishing an old list. Mutators MUST look up bags by id
// INSIDE the callback — anything captured before the refetch is stale. A
// mutator may throw to abort the save.
async function apiMutateAndPublish(mutate) {
  if (accountSuspended) throw new Error(SUSPENDED_MSG);
  const res = await fetch(`${API_BASE}/api/bags?_=${Date.now()}`, { headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } });
  if (!res.ok) throw new Error(`Failed to load fresh data: ${res.status}`);
  const json = await res.json();
  bags = Array.isArray(json.bags) ? json.bags : [];
  settings = json.settings || {};
  clients = Array.isArray(json.clients) ? json.clients : [];
  await mutate();
  await apiPublish();
}

let accountSuspended = false;
async function loadData() {
  const res = await fetch(`${API_BASE}/api/bags?_=${Date.now()}`, { headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } });
  const json = await res.json();
  bags = json.bags || [];
  settings = json.settings || {};
  clients = Array.isArray(json.clients) ? json.clients : [];
  accountSuspended = !!json.suspended;
}

// Owner-facing notice when billing has suspended the store. The public site is
// dark; this tells the owner why and how to restore (they can't unflip it).
function renderSuspendedBanner() {
  let b = document.getElementById('suspendedBanner');
  if (!accountSuspended) { if (b) b.remove(); return; }
  if (!b) {
    b = document.createElement('div');
    b.id = 'suspendedBanner';
    b.style.cssText = 'position:sticky;top:0;z-index:9000;background:#b00020;color:#fff;padding:12px 16px;text-align:center;font-size:14px;font-weight:600;line-height:1.4;';
    document.body.prepend(b);
  }
  b.innerHTML = 'Your store is currently offline. You can still view your inventory and sales, but selling, adding stock, syncing from Instagram and other changes are paused until it\'s restored. Please contact Essence Automations to restore it. <a href="https://wa.me/254720615606" style="color:#fff;text-decoration:underline;">Message us</a>';
}

// ====== HELPERS ======
const toast = document.getElementById('toast');
function showToast(msg) { toast.textContent = msg; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 2800); }


function confirmAction(message, okLabel = 'Confirm') {
  return new Promise(resolve => {
    const modal = document.getElementById('confirmModal');
    const msgEl = document.getElementById('confirmModalMsg');
    const okBtn = document.getElementById('confirmModalOk');
    const cancelBtn = document.getElementById('confirmModalCancel');
    msgEl.textContent = message;
    okBtn.textContent = okLabel;
    modal.style.display = 'flex';
    const cleanup = result => {
      modal.style.display = 'none';
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      resolve(result);
    };
    const onOk = () => cleanup(true);
    const onCancel = () => cleanup(false);
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
  });
}

function chooseCategory() {
  return new Promise(resolve => {
    const modal = document.getElementById('categoryModal');
    const sel = document.getElementById('categoryModalSelect');
    const newWrap = document.getElementById('categoryModalNewWrap');
    const newInput = document.getElementById('categoryModalNew');
    const okBtn = document.getElementById('categoryModalOk');
    const cancelBtn = document.getElementById('categoryModalCancel');
    const cats = [...new Set(bags.map(b => b.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    sel.innerHTML = cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')
      + '<option value="__new__">+ New category…</option>';
    newWrap.style.display = 'none';
    newInput.value = '';
    modal.style.display = 'flex';
    const onSelChange = () => {
      const isNew = sel.value === '__new__';
      newWrap.style.display = isNew ? '' : 'none';
      if (isNew) newInput.focus();
    };
    const cleanup = result => {
      modal.style.display = 'none';
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      sel.removeEventListener('change', onSelChange);
      resolve(result);
    };
    const onOk = () => cleanup((sel.value === '__new__' ? newInput.value.trim() : sel.value) || null);
    const onCancel = () => cleanup(null);
    sel.addEventListener('change', onSelChange);
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
  });
}

function setSaving(on) {
  const btn = document.getElementById('saveBtn');
  btn.disabled = on;
  btn.textContent = on ? 'Publishing…' : 'Save item';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtKsh(n) { return 'Ksh ' + Number(n || 0).toLocaleString('en-KE'); }

function totalStock(item) {
  if (!item.stock) return 0;
  return Object.values(item.stock).reduce((s, q) => s + (Number(q) || 0), 0);
}

function isSoldOut(item) { return totalStock(item) === 0; }

function allSales(item) { return item.sales || []; }

function totalUnitsSold(item) {
  return allSales(item).reduce((s, r) => s + (Number(r.qty) || 1), 0);
}

function totalRevenue(item) {
  return allSales(item).reduce((s, r) => s + (Number(r.salePrice || item.price) * (Number(r.qty) || 1)), 0);
}

// ====== IMAGES ======
// Downscale + re-encode every picked/downloaded image to a compact JPEG before
// upload. WhatsApp link previews silently skip heavy images (a 2.3MB PNG won't
// render in the Enquire share card), so normalising covers to JPEG ~q82 at
// <=1280px keeps the preview working and the catalogue fast. Transparency is
// flattened onto white. All staged images become ext 'jpg'.
function blobToStagedJpeg(blob, maxDim = 1280, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let w = img.naturalWidth, h = img.naturalHeight;
      if (Math.max(w, h) > maxDim) { const s = maxDim / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      resolve({ base64: dataUrl.split(',')[1], ext: 'jpg', dataUrl });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not load image')); };
    img.src = url;
  });
}

const imageInput = document.getElementById('imageInput');
const imagePreview = document.getElementById('imagePreview');
const costInput = document.getElementById('costInput');
imageInput.addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    stagedImage = await blobToStagedJpeg(file);
    imagePreview.innerHTML = `<img src="${stagedImage.dataUrl}" style="max-width:180px;border-radius:8px;margin-top:4px;">`;
  } catch (_) { showToast('Could not read that image. Try another file.'); }
});

const extraImagesInput = document.getElementById('extraImagesInput');
const extraImagesPreview = document.getElementById('extraImagesPreview');

function readFileAsStaged(file) { return blobToStagedJpeg(file); }

extraImagesInput?.addEventListener('change', async e => {
  const files = [...e.target.files];
  for (const f of files) {
    if (stagedExtras.length >= 8) break;
    try {
      const staged = await readFileAsStaged(f);
      stagedExtras.push(staged);
    } catch (_) {}
  }
  renderExtraImagesPreview();
  e.target.value = '';
});

function renderExtraImagesPreview() {
  if (!extraImagesPreview) return;
  if (!stagedExtras.length) { extraImagesPreview.innerHTML = ''; return; }
  extraImagesPreview.innerHTML = stagedExtras.map((s, i) => `
    <div class="extra-img-thumb">
      <img src="${s.dataUrl || s.url}" alt="Additional image ${i + 1}">
      <button class="extra-img-remove" data-extra-remove="${i}" aria-label="Remove" title="Remove">×</button>
    </div>
  `).join('');
  extraImagesPreview.querySelectorAll('[data-extra-remove]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.extraRemove, 10);
      stagedExtras.splice(idx, 1);
      renderExtraImagesPreview();
    });
  });
}

// ====== IG QUICK-ADD ======
let stagedInstagramUrl = '';

document.getElementById('igQuickBtn')?.addEventListener('click', async () => {
  const url = document.getElementById('igQuickInput').value.trim();
  const status = document.getElementById('igQuickStatus');
  if (!url) { status.textContent = 'Paste an Instagram URL first.'; status.className = 'ig-quick-status err'; return; }
  if (!/instagram\.com\/(?:share\/)?(?:p|reel|reels|tv)\//i.test(url)) {
    status.textContent = "That doesn't look like an Instagram post URL.";
    status.className = 'ig-quick-status err'; return;
  }

  status.textContent = 'Fetching from Instagram…';
  status.className = 'ig-quick-status';

  try {
    const r = await fetch(`${API_BASE}/api/ig-fetch?url=${encodeURIComponent(url)}`);
    const data = await r.json();
    if (!r.ok || data.error) throw new Error(data.error || 'Fetch failed');

    async function downloadAndStage(imgUrl) {
      // IG CDN blocks browser CORS — route through worker proxy.
      const proxied = `${API_BASE}/api/ig-proxy?url=${encodeURIComponent(imgUrl)}`;
      const r = await fetch(proxied);
      if (!r.ok) throw new Error('Image download failed');
      return blobToStagedJpeg(await r.blob());
    }

    stagedImage = await downloadAndStage(data.imageUrl);
    imagePreview.innerHTML = `<img src="${stagedImage.dataUrl}" style="max-width:180px;border-radius:8px;margin-top:4px;">`;

    stagedExtras = [];
    const extras = (data.imageUrls || []).slice(1);
    if (extras.length) {
      status.textContent = `Downloading ${extras.length} more image${extras.length === 1 ? '' : 's'}…`;
      for (const u of extras) {
        try { stagedExtras.push(await downloadAndStage(u)); } catch (_) {}
      }
      renderExtraImagesPreview();
    }

    const cap = (data.caption || '').replace(/^[a-z0-9._]+\s+/i, '').trim();
    document.getElementById('descInput').value = cap;

    if (!document.getElementById('nameInput').value && cap) {
      const firstLine = cap.split(/[.!?\n]/)[0].trim().slice(0, 60);
      document.getElementById('nameInput').value = firstLine.charAt(0).toUpperCase() + firstLine.slice(1);
    }

    stagedInstagramUrl = data.postUrl;
    const reelEl = document.getElementById('reelInput');
    if (reelEl) reelEl.value = data.postUrl;
    status.textContent = '✓ Image and caption loaded. Review the name, category, price and sizes, then Save.';
    { const _me = document.getElementById('manualEntry'); if (_me) _me.open = true; }
    status.className = 'ig-quick-status ok';
  } catch (err) {
    status.textContent = '✗ ' + err.message + ' — paste image and write description manually instead.';
    status.className = 'ig-quick-status err';
  }
});

// ====== STOCK READ/WRITE ======
function getStockFromForm() {
  const stock = {};
  document.querySelectorAll('.stock-qty').forEach(inp => {
    const size = (inp.dataset.size || '').trim();
    if (!size) return;
    const val = parseInt(inp.value, 10);
    if (!isNaN(val) && val > 0) stock[size] = val;
  });
  // Also collect any free-typed custom-size rows
  document.querySelectorAll('.custom-size-row').forEach(row => {
    const nameEl = row.querySelector('.custom-size-name');
    const qtyEl = row.querySelector('.custom-size-qty');
    const name = (nameEl?.value || '').trim();
    const qty = parseInt(qtyEl?.value, 10);
    if (name && !isNaN(qty) && qty > 0) stock[name] = qty;
  });
  return stock;
}

function setStockToForm(stock) {
  document.querySelectorAll('.stock-qty').forEach(inp => {
    const size = inp.dataset.size;
    inp.value = stock && stock[size] > 0 ? stock[size] : '';
  });
  // Populate any sizes not in the UK grid as editable custom-size rows
  const customWrap = document.getElementById('stockCustom');
  if (customWrap) {
    customWrap.innerHTML = '';
    Object.entries(stock || {}).forEach(([sz, q]) => {
      if (!UK_SIZE_FIXED.includes(sz)) addCustomSizeRow(sz, q);
    });
  }
}

function clearStockForm() {
  document.querySelectorAll('.stock-qty').forEach(inp => { inp.value = ''; });
  const customWrap = document.getElementById('stockCustom');
  if (customWrap) customWrap.innerHTML = '';
}

function addCustomSizeRow(name = '', qty = '') {
  const wrap = document.getElementById('stockCustom');
  if (!wrap) return;
  const row = document.createElement('div');
  row.className = 'custom-size-row stock-entry-item';
  row.style.cssText = 'display:flex;gap:6px;align-items:center;margin:4px 6px 4px 0;';
  row.innerHTML = `
    <input type="text" class="custom-size-name" placeholder="e.g. EU 42" value="${escapeHtml(String(name))}" style="width:110px;padding:6px 8px;border:1px solid var(--line);border-radius:6px;font-size:13px;">
    <input type="number" min="0" step="1" class="custom-size-qty" placeholder="qty" value="${qty === '' ? '' : Number(qty) || ''}" style="width:70px;padding:6px 8px;border:1px solid var(--line);border-radius:6px;font-size:13px;">
    <button type="button" class="custom-size-remove" aria-label="Remove" style="background:transparent;border:0;font-size:18px;color:#999;cursor:pointer;line-height:1;padding:2px 6px;">&times;</button>
  `;
  row.querySelector('.custom-size-remove').addEventListener('click', () => row.remove());
  wrap.appendChild(row);
}

document.getElementById('addCustomSizeBtn')?.addEventListener('click', () => addCustomSizeRow());

// ====== AI DESCRIPTION ======
document.getElementById('aiBtn').addEventListener('click', () => {
  const name = document.getElementById('nameInput').value.trim();
  const cat = getCategoryValue();
  if (!name) { showToast('Enter the item name first.'); return; }
  document.getElementById('descInput').value = generateDescription(name, cat);
});

function generateDescription(name, cat) {
  const lower = name.toLowerCase();
  const colors = { black: 'sleek black', white: 'crisp white', navy: 'deep navy', grey: 'cool grey', gray: 'cool grey', blue: 'rich blue', brown: 'warm brown', tan: 'warm tan', beige: 'soft beige', cream: 'soft cream', olive: 'olive green', red: 'bold red', green: 'fresh green' };
  let color = '';
  for (const c in colors) if (lower.includes(c)) { color = colors[c]; break; }

  const catMap = {
    Sneakers: 'sneakers', 'Sports/Athletic': 'athletic kicks', Boots: 'boots',
    Loafers: 'loafers', Formal: 'formal shoes', Slides: 'slides',
  };
  const type = catMap[cat] || 'pair';

  const openers = [
    `Quality ${color || 'hand-picked'} ${type}. Checked over before listing, so what you see is what you get.`,
    `A clean ${color || 'classic'} pair of ${type}. Ready to wear.`,
    `${color ? color.charAt(0).toUpperCase() + color.slice(1) : 'Fresh'} ${type}, just in.`,
  ];
  const mids = [
    `Pre-loved with care. Photographed exactly as they are.`,
    `Inspected before listing. No surprises.`,
    `One of one pair. Once they walk out, they walk out.`,
  ];
  const closes = [
    `Tap Enquire to chat with Silvarkicks on WhatsApp.`,
    `Worldwide delivery. Tap Enquire to confirm size and pay.`,
    `Available size shown above. Tap Enquire to grab them.`,
  ];
  return [openers[Math.floor(Math.random() * openers.length)], mids[Math.floor(Math.random() * mids.length)], closes[Math.floor(Math.random() * closes.length)]].join(' ');
}

// ====== SAVE ITEM ======
document.getElementById('saveBtn').addEventListener('click', saveItem);
document.getElementById('cancelBtn').addEventListener('click', resetForm);

async function saveItem() {
  const name = document.getElementById('nameInput').value.trim();
  const priceRaw = document.getElementById('priceInput').value.trim();
  const priceParsed = parseInt(priceRaw, 10);
  const price = priceRaw === '' ? 0 : priceParsed;
  const desc = document.getElementById('descInput').value.trim();
  const category = getCategoryValue();
  const reel = document.getElementById('reelInput')?.value.trim() || '';
  const stock = getStockFromForm();

  if (!name) { showToast('Item name is required.'); return; }
  if (priceRaw !== '' && (isNaN(priceParsed) || priceParsed < 0)) { showToast('Enter a valid price (or leave blank).'); return; }

  // Buying price (cost) — admin-only, optional, never rejected. Blank/0 = not recorded.
  const costRaw = costInput.value.trim();
  const cost = costRaw === '' ? 0 : Math.max(0, parseInt(costRaw, 10) || 0);

  setSaving(true);
  try {
    let imagePath = null;
    if (stagedImage) {
      showToast('Uploading image…');
      imagePath = await apiUploadImage(stagedImage.base64, stagedImage.ext);
    }

    let extraUrls = [];
    if (stagedExtras.length) {
      showToast(`Uploading ${stagedExtras.length} additional image${stagedExtras.length === 1 ? '' : 's'}…`);
      for (const s of stagedExtras) {
        if (s.url) { extraUrls.push(s.url); continue; }
        const p = await apiUploadImage(s.base64, s.ext);
        extraUrls.push(p);
      }
    }

    if (editingId) {
      const targetId = editingId;
      await apiMutateAndPublish(() => {
        const bag = bags.find(b => b.id === targetId);
        if (!bag) throw new Error('Item no longer exists — refresh admin');
        bag.name = name;
        bag.category = category;
        bag.description = desc;
        bag.price = price;
        if (reel) bag.reel = reel; else delete bag.reel;
        bag.stock = stock;
        bag.images = extraUrls.length ? [imagePath || bag.image, ...extraUrls] : (imagePath ? [imagePath] : (bag.images || []));
        if (bag.images.length) bag.images = bag.images.filter((u, i, a) => u && a.indexOf(u) === i);
        if (imagePath) bag.image = imagePath;
        if (cost) bag.cost = cost; else delete bag.cost;
      });
      showToast('Item updated and live.');
    } else {
      if (!stagedImage) { showToast('Add an item image.'); setSaving(false); return; }
      const id = 'item_' + Date.now();
      const newBag = { id, name, category, description: desc, price, stock, sales: [], image: imagePath, createdAt: new Date().toISOString() };
      if (extraUrls.length) newBag.images = [imagePath, ...extraUrls];
      if (reel) newBag.reel = reel;
      if (cost) newBag.cost = cost;
      await apiMutateAndPublish(() => { bags.unshift(newBag); });
      showToast('Item added and live.');
    }
    resetForm();
    renderList();
    renderDashboard();
    renderInventory();
  } catch (err) {
    showToast('Error: ' + err.message);
    console.error(err);
  } finally {
    setSaving(false);
  }
}

// ===== Category field helpers =====
// The form category <select> is a fixed list, but the shop owner can add their
// own. Picking "+ Add new category…" reveals a free-text box; any category that
// already exists on an item is auto-injected so it shows up for everyone after.
function toggleNewCategoryInput() {
  const sel = document.getElementById('categoryInput');
  const box = document.getElementById('categoryNewInput');
  if (!sel || !box) return;
  if (sel.value === '__new__') {
    box.style.display = '';
    box.focus();
  } else {
    box.style.display = 'none';
    box.value = '';
  }
}

// Read the chosen category, resolving the "+ Add new…" free-text path.
function getCategoryValue() {
  const sel = document.getElementById('categoryInput');
  if (!sel) return '';
  if (sel.value === '__new__') {
    return document.getElementById('categoryNewInput').value.trim();
  }
  return sel.value || '';
}

// Set the select to a category, injecting it as an option if it isn't a
// built-in one (so editing a custom-category item shows it selected).
function setCategoryValue(cat) {
  const sel = document.getElementById('categoryInput');
  const box = document.getElementById('categoryNewInput');
  if (!sel) return;
  if (box) { box.style.display = 'none'; box.value = ''; }
  const c = cat || '';
  if (!c) { sel.value = ''; return; }
  const exists = [...sel.options].some(o => o.value === c);
  if (!exists) ensureCategoryOption(c);
  sel.value = c;
}

// Ensure a category exists as a <option> in the select. Custom (owner-added)
// categories land in a dedicated "Your categories" group above "+ Add new…".
function ensureCategoryOption(cat) {
  const sel = document.getElementById('categoryInput');
  if (!sel || !cat) return;
  if ([...sel.options].some(o => o.value === cat)) return;
  let group = document.getElementById('customCatGroup');
  if (!group) {
    group = document.createElement('optgroup');
    group.id = 'customCatGroup';
    group.label = 'Your categories';
    const newOpt = [...sel.options].find(o => o.value === '__new__');
    sel.insertBefore(group, newOpt || null);
  }
  const opt = document.createElement('option');
  opt.value = cat;
  opt.textContent = cat;
  group.appendChild(opt);
}

// Sweep every category already used on an item into the dropdown, so an
// owner-added category becomes a permanent choice for all future items.
// Works for flat OR optgroup selects: the built-in option values are
// snapshotted once (before any custom injection) so we never re-classify
// a built-in as custom.
let _builtinCatValues = null;
function syncCustomCategories() {
  const sel = document.getElementById('categoryInput');
  if (!sel) return;
  if (!_builtinCatValues) {
    _builtinCatValues = new Set([...sel.options].map(o => o.value).filter(v => v && v !== '__new__'));
  }
  [...new Set(bags.map(b => b.category).filter(Boolean))]
    .filter(c => !_builtinCatValues.has(c))
    .sort((a, b) => a.localeCompare(b))
    .forEach(ensureCategoryOption);
}

function resetForm() {
  editingId = null;
  document.getElementById('editingId').value = '';
  document.getElementById('nameInput').value = '';
  setCategoryValue('');
  document.getElementById('descInput').value = '';
  document.getElementById('priceInput').value = '';
  costInput.value = '';
  const reelEl = document.getElementById('reelInput');
  if (reelEl) reelEl.value = '';
  clearStockForm();
  imageInput.value = '';
  imagePreview.innerHTML = '';
  stagedImage = null;
  stagedExtras = [];
  renderExtraImagesPreview();
  stagedInstagramUrl = '';
  const igInput = document.getElementById('igQuickInput');
  if (igInput) igInput.value = '';
  const igStatus = document.getElementById('igQuickStatus');
  if (igStatus) { igStatus.textContent = ''; igStatus.className = 'ig-quick-status'; }
  document.getElementById('formTitle').textContent = 'Add a new item';
  document.getElementById('cancelBtn').style.display = 'none';
  // Restore IG quick-add panel + divider (hidden during edit mode).
  const igPanel = document.getElementById('igQuickPanel');
  const manualDivider = document.getElementById('manualEntryDivider');
  if (igPanel) igPanel.style.display = '';
  if (manualDivider) manualDivider.style.display = '';
  { const _me = document.getElementById('manualEntry'); if (_me) _me.open = false; }
}

function editItem(id) {
  const bag = bags.find(b => b.id === id);
  if (!bag) return;
  editingId = id;
  document.getElementById('editingId').value = id;
  document.getElementById('nameInput').value = bag.name;
  setCategoryValue(bag.category || '');
  document.getElementById('descInput').value = bag.description || '';
  document.getElementById('priceInput').value = bag.price;
  costInput.value = bag.cost || '';
  const reelEl = document.getElementById('reelInput');
  if (reelEl) reelEl.value = bag.reel || '';
  setStockToForm(bag.stock || {});
  stagedImage = null;
  imagePreview.innerHTML = `<img src="${bag.image}" style="max-width:180px;border-radius:8px;">`;
  stagedExtras = ((bag.images && bag.images.length > 1) ? bag.images.slice(1) : []).map(url => ({ url }));
  renderExtraImagesPreview();
  document.getElementById('formTitle').textContent = 'Edit item';
  document.getElementById('cancelBtn').style.display = 'inline-block';
  // CATALOG-STANDARDS edit-mode UX: hide IG quick-add + divider, scroll to formTitle (auto, not smooth).
  const igPanel = document.getElementById('igQuickPanel');
  const manualDivider = document.getElementById('manualEntryDivider');
  if (igPanel) igPanel.style.display = 'none';
  if (manualDivider) manualDivider.style.display = 'none';
  { const _me = document.getElementById('manualEntry'); if (_me) _me.open = true; }
  document.getElementById('formTitle').scrollIntoView({ behavior: 'auto', block: 'start' });
}

async function deleteItem(id) {
  if (!await confirmAction('Delete this item? This cannot be undone.', 'Delete')) return;
  let removed = null, removedIdx = -1;
  try {
    await apiMutateAndPublish(() => {
      removedIdx = bags.findIndex(b => b.id === id);
      removed = removedIdx === -1 ? null : bags[removedIdx];
      bags = bags.filter(b => b.id !== id);
    });
    renderList();
    renderDashboard();
    renderInventory();
    showToast('Item deleted.');
  } catch (err) { showToast('Error: ' + err.message); }
}

// ====== SALE MODAL ======
const saleModal = document.getElementById('saleModal');
const saleSizeInput = document.getElementById('saleSizeInput');
const saleQtyInput = document.getElementById('saleQtyInput');
const salePriceInput = document.getElementById('salePriceInput');
const buyerName = document.getElementById('buyerName');
const buyerPhone = document.getElementById('buyerPhone');
const buyerNotes = document.getElementById('buyerNotes');

function openSaleModal(id) {
  const bag = bags.find(b => b.id === id);
  if (!bag) return;
  // If 2+ items are multi-selected and this is one of them, she means the batch.
  if (bulkSelected.size >= 2 && bulkSelected.has(id)) { bulkSell(); return; }
  pendingSaleId = id;
  document.getElementById('saleModalTitle').textContent = `Sell: ${bag.name}`;
  saleSizeInput.innerHTML = '';
  const stock = bag.stock || {};
  const hasSizes = Object.keys(stock).length > 0;
  if (hasSizes) {
    Object.entries(stock).filter(([, q]) => q > 0).forEach(([sz, q]) => {
      const opt = document.createElement('option');
      opt.value = sz;
      opt.textContent = `${sz} (${q} in stock)`;
      saleSizeInput.appendChild(opt);
    });
    if (!saleSizeInput.options.length) {
      showToast('All sizes are out of stock.'); return;
    }
  } else {
    const opt = document.createElement('option'); opt.value = 'One size'; opt.textContent = 'One size'; saleSizeInput.appendChild(opt);
  }
  saleQtyInput.value = 1;
  salePriceInput.value = bag.price;
  document.getElementById('salePaidInput').value = '';
  document.getElementById('salePaidHint').style.display = 'none';
  document.getElementById('salePaidNone').classList.remove('active');
  document.getElementById('saleDateInput').value = todayInputValue();
  buyerName.value = '';
  buyerPhone.value = '';
  buyerNotes.value = '';
  document.querySelectorAll('#saleModalPay .pos-pay-btn').forEach(b => b.classList.toggle('active', b.dataset.pay === 'mpesa'));
  saleModal.style.display = 'flex';
  buyerName.focus();
}

function closeSaleModal() { saleModal.style.display = 'none'; pendingSaleId = null; }

document.getElementById('saleSaveBtn').addEventListener('click', async () => {
  const targetId = pendingSaleId;
  const curBag = bags.find(b => b.id === targetId);
  if (!curBag) return;
  const size = saleSizeInput.value;
  const qty = parseInt(saleQtyInput.value, 10) || 1;
  const salePrice = parseInt(salePriceInput.value, 10) || curBag.price;
  const payMethod = document.querySelector('#saleModalPay .pos-pay-btn.active')?.dataset.pay || 'mpesa';
  const total = salePrice * qty;
  const paidRaw = (document.getElementById('salePaidInput').value || '').trim();
  const amountPaid = paidRaw === '' ? total : Math.min(total, Math.max(0, parseInt(paidRaw, 10) || 0));
  const balance = total - amountPaid;
  if (balance > 0 && buyerPhone.value.replace(/[^0-9]/g, '').length < 9) {
    if (!await confirmAction("No phone saved for this customer. Without a phone you can't track or collect this balance under their name. Save the sale anyway?", 'Save anyway')) return;
  }
  const sale = {
    size, qty, salePrice, amountPaid,
    paymentMethod: payMethod,
    channel: 'shop',
    buyerName: buyerName.value.trim(),
    buyerPhone: buyerPhone.value.trim(),
    notes: buyerNotes.value.trim(),
    soldAt: soldAtFromDateInput(document.getElementById('saleDateInput').value),
  };
  closeSaleModal();
  try {
    let soldBag = null;
    await apiMutateAndPublish(() => {
      const bag = bags.find(b => b.id === targetId);
      if (!bag) throw new Error('Item no longer exists — refresh admin');
      // Thrift: a sold piece is gone. Zero the stock for that size; no restock.
      if (bag.stock && bag.stock[size] !== undefined) {
        bag.stock[size] = Math.max(0, bag.stock[size] - qty);
      }
      if (!bag.sales) bag.sales = [];
      bag.sales.push(sale);
      soldBag = bag;
    });
    renderList();
    renderDashboard();
    renderInventory();
    showToast(`Sale recorded: ${qty}× ${size}.`);
    if (sale.buyerName || sale.buyerPhone) sendBuyerToGHL(soldBag, sale);
    lastPosCart = {
      lines: [{ name: soldBag ? soldBag.name : '', size, qty, price: sale.salePrice || (soldBag ? soldBag.price : 0), amountPaid }],
      buyerName: sale.buyerName, buyerPhone: sale.buyerPhone, paymentMethod: sale.paymentMethod, soldAt: sale.soldAt,
      total, paid: amountPaid, balance,
    };
    showPosReceipt(lastPosCart);
    document.getElementById('posDash').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) { showToast('Error: ' + err.message); }
});

document.getElementById('saleSkipBtn')?.addEventListener('click', async () => {
  // One-click thrift sale: no buyer info, qty 1, first available size.
  const targetId = pendingSaleId;
  const curBag = bags.find(b => b.id === targetId);
  if (!curBag) return;
  const size = saleSizeInput.value || 'One size';
  const sale = {
    size, qty: 1, salePrice: curBag.price,
    paymentMethod: (document.querySelector('#saleModalPay .pos-pay-btn.active')?.dataset.pay || 'mpesa'),
    channel: 'shop',
    buyerName: '', buyerPhone: '', notes: '',
    soldAt: new Date().toISOString(),
  };
  closeSaleModal();
  try {
    await apiMutateAndPublish(() => {
      const bag = bags.find(b => b.id === targetId);
      if (!bag) throw new Error('Item no longer exists — refresh admin');
      if (bag.stock && bag.stock[size] !== undefined) {
        bag.stock[size] = Math.max(0, bag.stock[size] - 1);
      }
      if (!bag.sales) bag.sales = [];
      bag.sales.push(sale);
    });
    renderList();
    renderDashboard();
    renderInventory();
    showToast(`Marked sold.`);
  } catch (err) { showToast('Error: ' + err.message); }
});

document.getElementById('saleCancelBtn').addEventListener('click', closeSaleModal);
// "Add to basket" from the per-item modal → drops the item into the Sell-in-store basket.
document.getElementById('saleAddBasketBtn')?.addEventListener('click', () => {
  const bag = bags.find(b => b.id === pendingSaleId); if (!bag) { showToast('Pick an item first.'); return; }
  const size = saleSizeInput.value;
  const qty = parseInt(saleQtyInput.value, 10) || 1;
  const price = parseInt(salePriceInput.value, 10) || bag.price || 0;
  const total = price * qty;
  const paidRaw = (document.getElementById('salePaidInput').value || '').trim();
  const amountPaid = paidRaw === '' ? total : Math.min(total, Math.max(0, parseInt(paidRaw, 10) || 0));
  posAddLine({ bagId: bag.id, name: bag.name, image: bag.image, size, qty, price, amountPaid });
  closeSaleModal();
  showToast('Added to basket. Finish in Sell in store.');
  document.getElementById('posDash').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
document.getElementById('saleModalPay')?.addEventListener('click', e => {
  const b = e.target.closest('.pos-pay-btn'); if (!b) return;
  document.querySelectorAll('#saleModalPay .pos-pay-btn').forEach(x => x.classList.toggle('active', x === b));
});
saleModal.addEventListener('click', e => { if (e.target === saleModal) closeSaleModal(); });

// ====== EDIT / UNDO A RECORDED SALE ======
let editingSale = null; // { bagId, soldAt }

async function undoSale(bagId, soldAt) {
  if (!await confirmAction('Undo this sale? The quantity goes back into stock.', 'Undo sale')) return;
  try {
    await apiMutateAndPublish(() => {
      const bag = bags.find(b => b.id === bagId);
      if (!bag) throw new Error('Item no longer exists — refresh admin');
      const idx = (bag.sales || []).findIndex(x => x.soldAt === soldAt);
      if (idx === -1) throw new Error('Sale not found — refresh admin');
      const s = bag.sales[idx];
      if (bag.stock && bag.stock[s.size] !== undefined) {
        bag.stock[s.size] = (Number(bag.stock[s.size]) || 0) + (Number(s.qty) || 1);
      }
      bag.sales.splice(idx, 1);
    });
    renderList();
    renderDashboard();
    renderInventory();
    showToast('Sale undone, stock restored.');
  } catch (err) { showToast('Error: ' + err.message); }
}

function openEditSale(bagId, soldAt) {
  const bag = bags.find(b => b.id === bagId);
  if (!bag) return;
  const s = (bag.sales || []).find(x => x.soldAt === soldAt);
  if (!s) return;
  editingSale = { bagId, soldAt };
  document.getElementById('editSaleTitle').textContent = `Edit sale: ${bag.name}`;
  document.getElementById('editSaleSize').value = s.size || '';
  document.getElementById('editSaleQty').value = s.qty || 1;
  document.getElementById('editSalePrice').value = (s.salePrice != null ? s.salePrice : bag.price) || 0;
  document.getElementById('editSaleDate').value = s.soldAt ? new Date(s.soldAt).toISOString().slice(0, 10) : todayInputValue();
  document.getElementById('editBuyerName').value = s.buyerName || '';
  document.getElementById('editBuyerPhone').value = s.buyerPhone || '';
  document.getElementById('editBuyerNotes').value = s.notes || '';
  document.getElementById('editSaleModal').style.display = 'flex';
}

function closeEditSale() { document.getElementById('editSaleModal').style.display = 'none'; editingSale = null; }

document.getElementById('editSaleSaveBtn').addEventListener('click', async () => {
  if (!editingSale) return;
  const { bagId, soldAt } = editingSale;
  // Read form values now (DOM); apply against the FRESH sale record in the mutator.
  const formSize = document.getElementById('editSaleSize').value.trim();
  const newQty = parseInt(document.getElementById('editSaleQty').value, 10) || 1;
  const formPrice = parseInt(document.getElementById('editSalePrice').value, 10);
  const newBuyerName = document.getElementById('editBuyerName').value.trim();
  const newBuyerPhone = document.getElementById('editBuyerPhone').value.trim();
  const newNotes = document.getElementById('editBuyerNotes').value.trim();
  const formDate = document.getElementById('editSaleDate').value;
  closeEditSale();
  try {
    await apiMutateAndPublish(() => {
      const bag = bags.find(b => b.id === bagId);
      if (!bag) throw new Error('Item no longer exists — refresh admin');
      const s = (bag.sales || []).find(x => x.soldAt === soldAt);
      if (!s) throw new Error('Sale not found — refresh admin');
      const newSize = formSize || s.size;
      const newPrice = isNaN(formPrice) ? (s.salePrice != null ? s.salePrice : bag.price) : formPrice;
      // Correct stock: put the old quantity back, then take the new quantity out
      if (bag.stock) {
        if (bag.stock[s.size] !== undefined) bag.stock[s.size] = (Number(bag.stock[s.size]) || 0) + (Number(s.qty) || 1);
        if (bag.stock[newSize] !== undefined) bag.stock[newSize] = Math.max(0, (Number(bag.stock[newSize]) || 0) - newQty);
      }
      s.size = newSize;
      s.qty = newQty;
      s.salePrice = newPrice;
      s.buyerName = newBuyerName;
      s.buyerPhone = newBuyerPhone;
      s.notes = newNotes;
      // Only restamp the date if the owner actually changed the day.
      const curDateStr = s.soldAt ? new Date(s.soldAt).toISOString().slice(0, 10) : '';
      if (formDate && formDate !== curDateStr) s.soldAt = new Date(formDate + 'T12:00:00').toISOString();
    });
    renderList();
    renderDashboard();
    renderInventory();
    showToast('Sale updated.');
  } catch (err) { showToast('Error: ' + err.message); }
});
document.getElementById('editSaleCancelBtn').addEventListener('click', closeEditSale);

// ====== GHL INTEGRATION ======
const GHL_RECAPTCHA_KEY = '6LeDBFwpAAAAAJe8ux9-imrqZ2ueRsEtdiWoDDpX';
async function getCaptchaToken() {
  if (!window.grecaptcha?.enterprise) return '';
  return new Promise(resolve => {
    grecaptcha.enterprise.ready(async () => {
      try { resolve(await grecaptcha.enterprise.execute(GHL_RECAPTCHA_KEY, { action: 'submit' })); }
      catch (e) { resolve(''); }
    });
  });
}
async function sendBuyerToGHL(bag, sale) {
  try {
    const captchaV3 = await getCaptchaToken();
    await fetch(`${API_BASE}/api/buyer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: sale.buyerName, phone: sale.buyerPhone,
        notes: sale.notes,
        bag_name: `${bag.name} (${sale.size})`,
        bag_price: sale.salePrice || bag.price,
        captchaV3,
      }),
    });
  } catch (err) { console.warn('GHL submit failed:', err); }
}

// ====== DASHBOARD ======
function startOfDay(d) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function startOfWeek(d) { const x = startOfDay(d); const dow = (x.getDay() + 6) % 7; x.setDate(x.getDate() - dow); return x; }
function startOfMonth(d) { const x = new Date(d.getFullYear(), d.getMonth(), 1); x.setHours(0,0,0,0); return x; }
function relTime(iso) {
  const sec = (Date.now() - new Date(iso).getTime()) / 1000;
  if (sec < 60) return 'just now';
  if (sec < 3600) return Math.floor(sec/60) + 'm ago';
  if (sec < 86400) return Math.floor(sec/3600) + 'h ago';
  const days = Math.floor(sec/86400);
  if (days === 1) return 'yesterday';
  if (days < 30) return days + 'd ago';
  return new Date(iso).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' });
}

// Sale-date helpers — let the owner back-date a credit sale (shoes taken weeks ago).
function todayInputValue() { const d = new Date(); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }
function soldAtFromDateInput(val) {
  if (!val || val === todayInputValue()) return new Date().toISOString(); // today → keep the real time
  return new Date(val + 'T12:00:00').toISOString();                       // back-dated → local noon avoids a day shift
}
function fmtDate(iso) { return new Date(iso).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }); }

// Best-effort "added to the website" timestamp: explicit createdAt, else the IG
// post date (takenAt; epoch-seconds or ISO), else the millis baked into a manual id.
// Returns an ISO string, or null if nothing usable.
function itemAddedAt(bag) {
  if (bag.createdAt) return bag.createdAt;
  if (bag.takenAt != null) {
    const t = bag.takenAt;
    if (typeof t === 'number') return new Date(t < 1e12 ? t * 1000 : t).toISOString();
    return t;
  }
  const m = String(bag.id || '').match(/_(\d{10,})/);
  return m ? new Date(parseInt(m[1], 10)).toISOString() : null;
}

function renderDashboard() {
  const now = new Date();
  const buckets = [
    { label: 'Today',      since: startOfDay(now) },
    { label: 'This week',  since: startOfWeek(now) },
    { label: 'This month', since: startOfMonth(now) },
    { label: 'All time',   since: null },
  ].map(b => {
    let count = 0, revenue = 0;
    bags.forEach(bag => {
      (bag.sales || []).forEach(s => {
        if (!b.since || new Date(s.soldAt) >= b.since) {
          count += Number(s.qty) || 1;
          revenue += (Number(s.salePrice || bag.price)) * (Number(s.qty) || 1);
        }
      });
    });
    return { ...b, count, revenue };
  });

  // All-time profit (admin-only) — sums realised − cost×unitsSold over ONLY the
  // sold items that have a buying price recorded. costKnown = how many sold items
  // carry a cost; soldItemsCount = all items with at least one sale (for the
  // coverage note, so a partial figure isn't mistaken for total profit).
  let profitAll = 0, costKnown = 0, soldItemsCount = 0;
  bags.forEach(bag => {
    const sold = totalUnitsSold(bag);
    if (sold <= 0) return;
    soldItemsCount++;
    if (bag.cost) {
      profitAll += totalRevenue(bag) - bag.cost * sold;
      costKnown++;
    }
  });

  document.getElementById('kpiGrid').innerHTML = buckets.map(b => {
    let profitSub = '';
    if (b.label === 'All time' && costKnown > 0) {
      const note = costKnown < soldItemsCount
        ? `<span id="statAllProfitNote" style="color:#999;font-weight:400;"> · from ${costKnown}/${soldItemsCount} with cost</span>`
        : '';
      profitSub = `<div id="statAllProfitSub" class="kpi-profit" style="font-size:12px;color:#2e7d32;font-weight:600;margin-top:2px;">Profit <span id="statAllProfit">${fmtKsh(profitAll)}</span>${note}</div>`;
    }
    return `
    <div class="kpi-card">
      <div class="kpi-label">${b.label}</div>
      <div class="kpi-count">${b.count} <span class="kpi-unit">units</span></div>
      <div class="kpi-revenue">${fmtKsh(b.revenue)}</div>${profitSub}
    </div>`;
  }).join('');

  const splitEl = document.getElementById('posTodaySplit');
  if (splitEl) {
    const todayStart = startOfDay(now);
    let cashT = 0, mpesaT = 0, soldToday = 0, owedToday = 0;
    bags.forEach(bag => (bag.sales || []).forEach(s => {
      if (new Date(s.soldAt) >= todayStart) {
        soldToday += Number(s.qty) || 1;
        const total = saleTotal(bag, s);
        // cash actually taken at the till today (old sales without amountPaid = paid in full)
        const initial = (s.amountPaid != null) ? Math.min(total, Math.max(0, Number(s.amountPaid) || 0)) : total;
        if (s.paymentMethod === 'mpesa') mpesaT += initial; else cashT += initial;
        owedToday += Math.max(0, total - initial);
      }
      // part-payments received today against any earlier balance
      (s.payments || []).forEach(p => {
        if (new Date(p.at) >= todayStart) {
          const amt = Number(p.amount) || 0;
          if (p.method === 'mpesa') mpesaT += amt; else cashT += amt;
        }
      });
    }));
    splitEl.innerHTML = `<span class="pos-today-label">Today's takings</span>`
      + `<span class="pos-chip cash">💵 Cash ${fmtKsh(cashT)}</span>`
      + `<span class="pos-chip mpesa">📱 M-Pesa ${fmtKsh(mpesaT)}</span>`
      + `<span class="pos-chip total">${soldToday} sold</span>`
      + (owedToday > 0 ? `<span class="pos-chip owed">📝 On credit ${fmtKsh(owedToday)}</span>` : '');
  }

  const catUnits = {}, catRev = {};
  bags.forEach(bag => {
    const cat = bag.category || 'Other';
    (bag.sales || []).forEach(s => {
      catUnits[cat] = (catUnits[cat] || 0) + (Number(s.qty) || 1);
      catRev[cat] = (catRev[cat] || 0) + (Number(s.salePrice || bag.price)) * (Number(s.qty) || 1);
    });
  });
  const cats = Object.entries(catUnits).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxU = cats[0]?.[1] || 1;
  document.getElementById('topCats').innerHTML = cats.length
    ? cats.map(([cat, n]) => `
        <div class="cat-bar">
          <div class="cat-bar-row"><span class="cat-bar-name">${escapeHtml(cat)}</span><span class="cat-bar-meta">${n} sold · ${fmtKsh(catRev[cat])}</span></div>
          <div class="cat-bar-track"><div class="cat-bar-fill" style="width:${(n/maxU)*100}%"></div></div>
        </div>`).join('')
    : '<p style="color:#999;font-size:13px;">No sales yet. Record your first sale to populate.</p>';

  const allSaleRecords = [];
  bags.forEach(bag => (bag.sales || []).forEach(s => allSaleRecords.push({ bag, s })));
  const recent = allSaleRecords.sort((a, b) => new Date(b.s.soldAt) - new Date(a.s.soldAt)).slice(0, 20);
  document.getElementById('recentSales').innerHTML = recent.length
    ? recent.map(({ bag, s }) => `
        <div class="recent-row">
          <div class="recent-main">
            <img src="${bag.image}" alt="${escapeHtml(bag.name)}">
            <div>
              <div class="recent-name">${escapeHtml(bag.name)} · ${escapeHtml(s.size || '')} × ${s.qty || 1}${saleBalance(bag, s) > 0 ? ` <span class="owed-tag">owes ${fmtKsh(saleBalance(bag, s))}</span>` : ''}</div>
              <div class="recent-meta">${fmtKsh(s.salePrice || bag.price)} · ${s.buyerName ? escapeHtml(s.buyerName) : 'No buyer saved'} · ${relTime(s.soldAt)}</div>
            </div>
          </div>
          <div class="recent-actions">
            <button onclick="openEditSale('${bag.id}','${s.soldAt}')">Edit</button>
            <button class="danger" onclick="undoSale('${bag.id}','${s.soldAt}')">Undo</button>
          </div>
        </div>`).join('')
    : '<p style="color:#999;font-size:13px;">No sales recorded yet.</p>';

  if (typeof renderOwed === 'function') renderOwed();
}

// ====== INVENTORY ======
let invFilter = 'attention';
let invShowAll = false;
const INV_PAGE_SIZE = 15;

function renderInventory() {
  let totalItems = bags.length;
  let totalValue = 0, available = 0, soldCount = 0;

  bags.forEach(bag => {
    const units = totalStock(bag);
    totalValue += units * (bag.price || 0);
    if (units === 0) soldCount++; else available++;
  });

  document.getElementById('invKpiGrid').innerHTML = [
    { label: 'Total pairs', val: totalItems, sub: 'listings in catalog', cls: '' },
    { label: 'Available', val: available, sub: 'pairs still on the shelf', cls: 'success' },
    { label: 'Catalog value', val: fmtKsh(totalValue), sub: 'at listed prices', cls: '' },
    { label: 'Sold', val: soldCount, sub: 'walked out', cls: soldCount > 0 ? 'danger' : '' },
  ].map(k => `
    <div class="inv-kpi ${k.cls}">
      <div class="inv-kpi-label">${k.label}</div>
      <div class="inv-kpi-val">${k.val}</div>
      <div class="inv-kpi-sub">${k.sub}</div>
    </div>`).join('');

  const soldBags = bags.filter(b => totalStock(b) === 0);
  const filterBar = document.getElementById('invFilterBar');
  if (filterBar) {
    filterBar.innerHTML = `
      <button class="pill ${invFilter==='attention'?'active':''}" data-inv-filter="attention">
        Sold <span class="admin-nav-count">${soldBags.length}</span>
      </button>
      <button class="pill ${invFilter==='all'?'active':''}" data-inv-filter="all">
        All items <span class="admin-nav-count">${bags.length}</span>
      </button>
    `;
    filterBar.querySelectorAll('[data-inv-filter]').forEach(b => {
      b.addEventListener('click', () => {
        invFilter = b.dataset.invFilter;
        invShowAll = false;
        renderInventory();
      });
    });
  }

  const filtered = (invFilter === 'attention' ? soldBags : bags)
    .slice()
    .sort((a, b) => totalStock(a) - totalStock(b));

  const cap = invShowAll ? filtered.length : Math.min(INV_PAGE_SIZE, filtered.length);
  const sorted = filtered.slice(0, cap);

  const lbl = document.getElementById('invSortLabel');
  if (lbl) lbl.textContent = `showing ${sorted.length} of ${filtered.length}, sorted low to high`;

  const invBody = document.getElementById('invTableBody');
  if (invBody) invBody.innerHTML = sorted.map(bag => {
    const units = totalStock(bag);
    const soldUnits = totalUnitsSold(bag);
    const stockEntries = Object.entries(bag.stock || {});
    const stockCells = stockEntries.length
      ? stockEntries.map(([sz, q]) => {
          const cls = q === 0 ? 'zero' : 'ok';
          return `<span class="stock-cell ${cls}">${escapeHtml(sz)}: ${q}</span>`;
        }).join('')
      : '<span style="color:#999;font-size:12px;">No sizes set</span>';

    const statusCls = units === 0 ? 'zero' : 'ok';
    const statusLabel = units === 0 ? 'Sold' : 'Available';

    // Admin-only cost/profit subline — shown only when a buying price is recorded.
    let costLine = '';
    if (bag.cost) {
      if (soldUnits > 0) {
        const profit = totalRevenue(bag) - bag.cost * soldUnits;
        costLine = `<div style="font-size:11px;color:#2e7d32;">cost ${fmtKsh(bag.cost)} · profit ${fmtKsh(profit)}</div>`;
      } else {
        const margin = (bag.price || 0) - bag.cost;
        costLine = `<div style="font-size:11px;color:#2e7d32;">cost ${fmtKsh(bag.cost)} · margin ${fmtKsh(margin)}</div>`;
      }
    }

    return `
    <tr>
      <td><img class="item-img" src="${bag.image}" alt="${escapeHtml(bag.name)}"></td>
      <td>
        <div style="font-weight:600;font-size:13px;">${escapeHtml(bag.name)}</div>
        <div style="font-size:11px;color:#999;margin-top:2px;">${soldUnits} sold, ${fmtKsh(totalRevenue(bag))} revenue</div>
      </td>
      <td style="font-size:13px;">${escapeHtml(bag.category || '-')}</td>
      <td style="font-size:13px;font-weight:600;">${fmtKsh(bag.price)}${costLine}</td>
      <td><div class="stock-cells">${stockCells}</div></td>
      <td style="font-weight:700;font-size:14px;">${units}</td>
      <td><span class="stock-pill ${statusCls}">${statusLabel}</span></td>
      <td>
        <button class="restock-btn" onclick="editItem('${bag.id}')">Edit sizes</button>
      </td>
    </tr>`;
  }).join('') || `<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--ink-faint);">${invFilter === 'attention' ? 'No pairs sold yet.' : 'No pairs in catalog yet.'}</td></tr>`;

  const toggle = document.getElementById('invShowMore');
  if (toggle) {
    if (filtered.length <= INV_PAGE_SIZE) {
      toggle.style.display = 'none';
    } else {
      toggle.style.display = 'block';
      toggle.textContent = invShowAll ? `Show fewer (top ${INV_PAGE_SIZE})` : `Show all ${filtered.length} items ↓`;
      toggle.onclick = () => { invShowAll = !invShowAll; renderInventory(); };
    }
  }
}

// ====== ITEM LIST ======
let bulkSelected = new Set();
let adminSearchQuery = '';

function matchesSearch(bag, q) {
  if (!q) return true;
  const hay = `${bag.name || ''} ${bag.category || ''}`.toLowerCase();
  return q.split(/\s+/).every(tok => hay.includes(tok));
}

function renderList() {
  syncCustomCategories();
  const list = document.getElementById('adminList');
  document.getElementById('bagCount').textContent = bags.length;
  const navCount = document.getElementById('navItemCount');
  if (navCount) navCount.textContent = bags.length;
  renderBulkBar();

  const q = adminSearchQuery.trim().toLowerCase();
  const filtered = q ? bags.filter(b => matchesSearch(b, q)) : bags;
  const countEl = document.getElementById('adminSearchCount');
  if (countEl) countEl.textContent = q ? `${filtered.length} ${filtered.length === 1 ? 'match' : 'matches'}` : '';

  list.innerHTML = filtered.map(bag => {
    const units = totalStock(bag);
    const sold = totalUnitsSold(bag);
    const stockSummary = Object.entries(bag.stock || {}).map(([sz, q]) => `${sz}:${q}`).join(' · ') || 'No stock set';
    const stockShort = units === 0 ? 'Sold' : `${units} left`;
    const checked = bulkSelected.has(bag.id);
    const addedIso = itemAddedAt(bag);
    return `
    <div class="admin-card ${checked ? 'bulk-selected' : ''}">
      <label class="bulk-check" title="Select for bulk actions">
        <input type="checkbox" data-bulk="${escapeHtml(bag.id)}" ${checked ? 'checked' : ''}>
      </label>
      <img src="${bag.image}" alt="${escapeHtml(bag.name)}">
      <div class="admin-card-body">
        <div class="admin-card-name">${escapeHtml(bag.name)}</div>
        ${bag.category ? `<div class="admin-card-cat"><span>${escapeHtml(bag.category)}</span></div>` : ''}
        <div class="admin-card-pricerow">
          <span class="admin-card-price">${fmtKsh(bag.price)}</span>
          <span class="admin-card-stockshort ${units === 0 ? 'sold' : ''}">${stockShort}</span>
        </div>
        <div class="admin-card-stock">${units} in stock · ${sold} sold | ${stockSummary}</div>
        ${addedIso ? `<div class="admin-card-added" title="Added ${new Date(addedIso).toLocaleString('en-KE')}">Added ${relTime(addedIso)}</div>` : ''}
        <div class="admin-card-actions">
          <button onclick="editItem('${bag.id}')">Edit</button>
          <button onclick="openSaleModal('${bag.id}')" style="background:#f0faf4;border-color:#b0d8c0;color:#1a7a40;">Sell</button>
          <button class="danger" onclick="deleteItem('${bag.id}')">Delete</button>
        </div>
      </div>
    </div>`;
  }).join('');

  list.querySelectorAll('input[data-bulk]').forEach(cb => {
    cb.addEventListener('change', () => {
      if (cb.checked) bulkSelected.add(cb.dataset.bulk);
      else bulkSelected.delete(cb.dataset.bulk);
      cb.closest('.admin-card').classList.toggle('bulk-selected', cb.checked);
      renderBulkBar();
    });
  });
}

function renderBulkBar() {
  const bar = document.getElementById('bulkActions');
  if (!bar) return;
  if (bulkSelected.size === 0) { bar.style.display = 'none'; return; }
  bar.style.display = 'flex';
  document.getElementById('bulkCount').textContent = bulkSelected.size;
}

function bulkClear() { bulkSelected.clear(); renderList(); }
function bulkSelectAll() { bags.forEach(b => bulkSelected.add(b.id)); renderList(); }

async function bulkDelete() {
  if (!await confirmAction(`Delete ${bulkSelected.size} item(s)? This cannot be undone.`, 'Delete')) return;
  const ids = new Set(bulkSelected);
  bulkSelected.clear();
  let removed = [];
  try {
    await apiMutateAndPublish(() => {
      removed = [];
      bags.forEach((b, i) => { if (ids.has(b.id)) removed.push({ item: b, index: i }); });
      bags = bags.filter(b => !ids.has(b.id));
    });
    renderList(); renderInventory(); renderDashboard();
    showToast(`Deleted.`);
  } catch (err) { showToast('Sync failed: ' + err.message); }
}

async function bulkSetCategory() {
  const cat = await chooseCategory();
  if (!cat) return;
  const ids = new Set(bulkSelected);
  const n = ids.size;
  try {
    await apiMutateAndPublish(() => {
      bags.forEach(b => { if (ids.has(b.id)) b.category = cat; });
    });
    bulkSelected.clear();
    renderList(); renderInventory();
    showToast(`Set ${n} item(s) to "${cat}".`);
  } catch (err) { showToast('Sync failed: ' + err.message); }
}

// Debounced search input
(function wireAdminSearch() {
  const input = document.getElementById('adminSearch');
  if (!input) return;
  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      adminSearchQuery = input.value;
      renderList();
    }, 160);
  });
})();

window.editItem = editItem;
window.deleteItem = deleteItem;
window.openSaleModal = openSaleModal;
window.undoSale = undoSale;
window.openEditSale = openEditSale;
window.bulkClear = bulkClear;
window.bulkSelectAll = bulkSelectAll;
window.bulkDelete = bulkDelete;
window.bulkSetCategory = bulkSetCategory;

// ====== BULK SELL TO ONE CUSTOMER (new-stock: each selected item → its own sale, qty 1) ======
// Sells every selected in-stock item to the same buyer in one go. Per item the
// owner picks a size only when the item has more than one in-stock size; qty is
// 1 each (a multi-item bundle). An optional part-payment for the whole lot is
// allocated across items oldest-first so the Owed ledger works. Buyer details
// (and the existing-customer picker) are entered once.
function bsEffPrice(b) { return (b.salePrice > 0 && b.salePrice < b.price) ? b.salePrice : (Number(b.price) || 0); }
function bsInStockSizes(b) {
  const stock = b.stock || {};
  const keys = Object.keys(stock);
  if (!keys.length) return ['One size'];
  return keys.filter(k => Number(stock[k]) > 0);
}
function bulkSellableSelected() { return bags.filter(b => bulkSelected.has(b.id) && bsInStockSizes(b).length > 0); }
let bulkSellTotalAmt = 0;
window.bulkSell = () => {
  const list = bulkSellableSelected();
  if (!list.length) { showToast('Select at least one in-stock item to sell.'); return; }
  bulkSellTotalAmt = list.reduce((s, b) => s + bsEffPrice(b), 0);
  document.getElementById('bulkSellTitle').textContent = `Sell ${list.length} item${list.length === 1 ? '' : 's'} to one customer`;
  document.getElementById('bulkSellRows').innerHTML = list.map(b => {
    const sizes = bsInStockSizes(b);
    const ctl = sizes.length > 1
      ? `<select class="bsr-size" data-id="${b.id}">${sizes.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('')}</select>`
      : `<span class="bsr-onesize" data-id="${b.id}" data-size="${escapeHtml(sizes[0])}">${escapeHtml(sizes[0])}</span>`;
    return `<div class="bulksell-row"><span class="bulksell-row-name">${escapeHtml(b.name)} · ${fmtKsh(bsEffPrice(b))}</span>${ctl}</div>`;
  }).join('');
  document.getElementById('bulkSellTotal').textContent = `Total: ${fmtKsh(bulkSellTotalAmt)} · ${list.length} item${list.length === 1 ? '' : 's'}`;
  ['bulkSellName', 'bulkSellPhone', 'bulkSellNotes', 'bulkSellPaid', 'bulkSellCustSearch'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('bulkSellPaid').placeholder = 'Paid in full';
  document.getElementById('bulkSellPaidHint').style.display = 'none';
  document.getElementById('bulkSellPaidNone').classList.remove('active');
  const cr = document.getElementById('bulkSellCustResults'); if (cr) { cr.style.display = 'none'; cr.innerHTML = ''; }
  document.querySelectorAll('#bulkSellPay .pos-pay-btn').forEach(b => b.classList.toggle('active', b.dataset.pay === 'mpesa'));
  document.getElementById('bulkSellModal').style.display = 'flex';
};
function closeBulkSell() { document.getElementById('bulkSellModal').style.display = 'none'; }
function updateBulkSellHint() {
  const raw = (document.getElementById('bulkSellPaid').value || '').trim();
  document.getElementById('bulkSellPaidNone').classList.toggle('active', raw === '0');
  const hint = document.getElementById('bulkSellPaidHint');
  if (raw === '') { hint.style.display = 'none'; return; }
  const bal = bulkSellTotalAmt - Math.min(bulkSellTotalAmt, Math.max(0, parseInt(raw, 10) || 0));
  hint.style.display = bal > 0 ? '' : 'none';
  if (bal > 0) hint.textContent = `Balance owing: ${fmtKsh(bal)}`;
}
async function commitBulkSold(withBuyer) {
  const initial = bulkSellableSelected();
  if (!initial.length) { closeBulkSell(); return; }
  // Read the chosen size per item from the DOM before we close the modal.
  const chosen = initial.map(b => {
    const sel = document.querySelector(`.bsr-size[data-id="${b.id}"]`);
    const one = document.querySelector(`.bsr-onesize[data-id="${b.id}"]`);
    return { id: b.id, size: sel ? sel.value : (one ? one.dataset.size : 'One size'), price: bsEffPrice(b) };
  });
  const payMethod = document.querySelector('#bulkSellPay .pos-pay-btn.active')?.dataset.pay || 'mpesa';
  const buyer = { name: '', phone: '', notes: '' };
  if (withBuyer) {
    buyer.name = document.getElementById('bulkSellName').value.trim();
    buyer.phone = document.getElementById('bulkSellPhone').value.trim().replace(/[^0-9+]/g, '');
    buyer.notes = document.getElementById('bulkSellNotes').value.trim();
    if (!buyer.name && !buyer.phone) { showToast('Add a name or phone, or hit Skip.'); return; }
  }
  const paidRaw = (document.getElementById('bulkSellPaid').value || '').trim();
  const hasPartial = withBuyer && paidRaw !== '';
  closeBulkSell();
  const soldAt = new Date().toISOString();
  let soldList = [];
  try {
    await apiMutateAndPublish(() => {
      let remaining = hasPartial ? Math.max(0, parseInt(paidRaw, 10) || 0) : Infinity;
      soldList = [];
      for (const ch of chosen) {
        const bag = bags.find(b => b.id === ch.id);
        if (!bag) continue;
        const stock = bag.stock || {};
        const hasStockObj = Object.keys(stock).length > 0;
        if (hasStockObj && !(Number(stock[ch.size]) > 0)) continue; // size sold out since the modal opened
        const total = ch.price; // qty 1
        const amountPaid = hasPartial ? Math.min(remaining, total) : total;
        if (hasPartial) remaining = Math.max(0, remaining - amountPaid);
        const sale = {
          size: ch.size, qty: 1, salePrice: ch.price, amountPaid,
          paymentMethod: payMethod, channel: 'shop',
          buyerName: withBuyer ? buyer.name : '', buyerPhone: withBuyer ? buyer.phone : '',
          notes: withBuyer ? buyer.notes : '', soldAt,
        };
        if (hasStockObj && stock[ch.size] !== undefined) stock[ch.size] = Math.max(0, Number(stock[ch.size]) - 1);
        if (!bag.sales) bag.sales = [];
        bag.sales.push(sale);
        soldList.push({ bag, sale });
      }
    });
    bulkSelected.clear();
    renderList(); renderDashboard(); renderInventory();
    if (typeof renderClients === 'function') renderClients();
    const total = soldList.reduce((s, x) => s + (Number(x.sale.salePrice) || 0), 0);
    const owed = hasPartial ? Math.max(0, total - Math.max(0, parseInt(paidRaw, 10) || 0)) : 0;
    showToast(`Sold ${soldList.length} item${soldList.length === 1 ? '' : 's'}${withBuyer && buyer.name ? ' to ' + buyer.name : ''} · ${fmtKsh(total)}${owed > 0 ? ` · ${fmtKsh(owed)} owed` : ''}`);
    if (withBuyer && buyer.phone && soldList[0]) sendBuyerToGHL(soldList[0].bag, soldList[0].sale);
  } catch (err) { showToast('Error: ' + err.message); }
}
// Existing-customer picker.
function wireCustomerPicker({ searchId, resultsId, nameId, phoneId }) {
  const search = document.getElementById(searchId);
  const box = document.getElementById(resultsId);
  if (!search || !box) return;
  search.addEventListener('input', () => {
    const term = search.value.trim().toLowerCase();
    if (!term) { box.style.display = 'none'; box.innerHTML = ''; return; }
    const digits = term.replace(/[^0-9+]/g, '');
    const matches = clientsLedger()
      .filter(c => (c.name || '').toLowerCase().includes(term) || (digits && (c.phone || '').includes(digits)))
      .sort((a, b) => b.lastAt - a.lastAt)
      .slice(0, 8);
    box.innerHTML = matches.length
      ? matches.map(c => {
          const meta = `${escapeHtml(c.phone || '')}${c.purchases.length ? ` · ${c.purchases.length} bought` : ''}`;
          return `<button type="button" class="client-item-opt" data-name="${escapeHtml(c.name || '')}" data-phone="${escapeHtml(c.phone || '')}">${escapeHtml(c.name || '(no name)')}<span>${meta}</span></button>`;
        }).join('')
      : '<div class="client-item-empty">No saved customer matches. Type the details below to add a new one.</div>';
    box.style.display = '';
  });
  box.addEventListener('click', e => {
    const opt = e.target.closest('.client-item-opt');
    if (!opt) return;
    document.getElementById(nameId).value = opt.dataset.name || '';
    document.getElementById(phoneId).value = opt.dataset.phone || '';
    search.value = opt.dataset.name || opt.dataset.phone || '';
    box.style.display = 'none';
    showToast('Customer selected — edit if needed.');
  });
}
wireCustomerPicker({ searchId: 'bulkSellCustSearch', resultsId: 'bulkSellCustResults', nameId: 'bulkSellName', phoneId: 'bulkSellPhone' });
document.getElementById('bulkSellSaveBtn')?.addEventListener('click', () => commitBulkSold(true));
document.getElementById('bulkSellSkipBtn')?.addEventListener('click', () => commitBulkSold(false));
document.getElementById('bulkSellCancelBtn')?.addEventListener('click', closeBulkSell);
document.getElementById('bulkSellModal')?.addEventListener('click', e => { if (e.target.id === 'bulkSellModal') closeBulkSell(); });
document.querySelectorAll('#bulkSellPay .pos-pay-btn').forEach(btn => btn.addEventListener('click', () => {
  document.querySelectorAll('#bulkSellPay .pos-pay-btn').forEach(b => b.classList.toggle('active', b === btn));
}));
document.getElementById('bulkSellPaid')?.addEventListener('input', updateBulkSellHint);
document.getElementById('bulkSellPaidNone')?.addEventListener('click', () => {
  document.getElementById('bulkSellPaid').value = '0';
  updateBulkSellHint();
});

// ====== CLIENTS (free CRM roster) ======
// Who has bought, with what they bought, total spend, and one-tap WhatsApp.
// New-stock model: buyers live in each bag's sales[] (deduped by phone).
let clientsQuery = '';
let clientsSort = 'recent';
function clientsLedger() {
  const map = new Map();
  for (const bag of bags) {
    for (const s of (bag.sales || [])) {
      if (!s || !s.buyerPhone) continue;
      const phone = String(s.buyerPhone).replace(/[^0-9]/g, '');
      if (phone.length < 9) continue;
      const at = new Date(s.soldAt || 0).getTime();
      const amount = Number(s.salePrice || bag.price || 0) * (Number(s.qty) || 1);
      let c = map.get(phone);
      if (!c) { c = { phone, name: '', purchases: [], spend: 0, lastAt: 0 }; map.set(phone, c); }
      c.purchases.push({ bagName: bag.name, size: s.size || '', qty: Number(s.qty) || 1, amount, at: s.soldAt });
      c.spend += amount;
      if (at >= c.lastAt) { c.lastAt = at; if (s.buyerName) c.name = s.buyerName; }
      else if (!c.name && s.buyerName) c.name = s.buyerName;
    }
  }
  // Overlay manually-added clients (may have zero purchases yet).
  for (const mc of (clients || [])) {
    if (!mc || !mc.phone) continue;
    const phone = String(mc.phone).replace(/[^0-9]/g, '');
    if (phone.length < 9) continue;
    let c = map.get(phone);
    if (!c) { c = { phone, name: '', purchases: [], spend: 0, lastAt: 0 }; map.set(phone, c); }
    c.manualId = mc.id;
    if (mc.note) c.note = mc.note;
    if (!c.name && mc.name) c.name = mc.name;
    if (mc.createdAt) c.addedAt = mc.createdAt;
  }
  return [...map.values()];
}
// Normalise a Kenyan number to wa.me international form (254…, no +).
function clientWaPhone(p) {
  let d = String(p).replace(/[^0-9]/g, '');
  if (d.startsWith('0')) d = '254' + d.slice(1);
  else if (d.length === 9) d = '254' + d;
  return d;
}
function renderClients() {
  const listEl = document.getElementById('clientsList');
  if (!listEl) return;
  const ledger = clientsLedger();
  const totalSpend = ledger.reduce((s, c) => s + c.spend, 0);
  const repeat = ledger.filter(c => c.purchases.length >= 2).length;
  const avg = ledger.length ? Math.round(totalSpend / ledger.length) : 0;

  const nav = document.getElementById('navClientsCount'); if (nav) nav.textContent = ledger.length || '';

  const kpi = document.getElementById('clientsKpiGrid');
  if (kpi) kpi.innerHTML = `
    <div class="inv-kpi"><div class="inv-kpi-label">Clients</div><div class="inv-kpi-val">${ledger.length}</div><div class="inv-kpi-sub">${repeat} repeat buyer${repeat === 1 ? '' : 's'}</div></div>
    <div class="inv-kpi success"><div class="inv-kpi-label">Total spent</div><div class="inv-kpi-val">${fmtKsh(totalSpend)}</div><div class="inv-kpi-sub">across all clients</div></div>
    <div class="inv-kpi"><div class="inv-kpi-label">Avg per client</div><div class="inv-kpi-val">${fmtKsh(avg)}</div><div class="inv-kpi-sub">lifetime value</div></div>
    <div class="inv-kpi"><div class="inv-kpi-label">Repeat rate</div><div class="inv-kpi-val">${ledger.length ? Math.round(repeat / ledger.length * 100) : 0}%</div><div class="inv-kpi-sub">bought 2+ times</div></div>
  `;

  if (!ledger.length) {
    listEl.innerHTML = '<p style="font-size:13px;color:#999;padding:14px;">No clients yet. When you record a sale and save the buyer\'s name and phone, they show up here so you can message them again.</p>';
    return;
  }
  const owedMap = owedByPhone();
  const q = clientsQuery.toLowerCase();
  const rows = ledger
    .filter(c => !q || (c.name || '').toLowerCase().includes(q) || c.phone.includes(q))
    .sort((a, b) =>
      clientsSort === 'spend' ? b.spend - a.spend :
      clientsSort === 'purchases' ? b.purchases.length - a.purchases.length :
      b.lastAt - a.lastAt);
  if (!rows.length) { listEl.innerHTML = '<p style="font-size:13px;color:#999;padding:14px;">No clients match your search.</p>'; return; }
  listEl.innerHTML = rows.map(c => {
    const items = c.purchases.slice()
      .sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0))
      .map(p => `<span class="client-item">${escapeHtml(p.bagName)}${p.size ? ' · ' + escapeHtml(p.size) : ''} × ${p.qty} · ${fmtKsh(p.amount)}</span>`).join('');
    const has = c.purchases.length;
    const when = has ? `last ${relTime(new Date(c.lastAt).toISOString())}`
                     : (c.addedAt ? `added ${relTime(c.addedAt)}` : 'no purchases yet');
    const manualTag = c.manualId ? '<span class="client-tag">Added manually</span>' : '';
    const noteLine = c.note ? `<div class="client-note">${escapeHtml(c.note)}</div>` : '';
    const removeBtn = (c.manualId && !has) ? `<button class="btn-admin danger" onclick="removeClient('${c.manualId}')">Remove</button>` : '';
    return `
      <div class="client-row">
        <div class="client-row-main">
          <div class="client-row-name">${escapeHtml(c.name || 'Unnamed buyer')}${manualTag}</div>
          <div class="client-row-sub">${escapeHtml(c.phone)} · ${has} purchase${has === 1 ? '' : 's'} · ${fmtKsh(c.spend)} spent · ${when}${owedMap[c.phone] > 0 ? ` · <span class="owed-amount">owes ${fmtKsh(owedMap[c.phone])}</span>` : ''}</div>
          ${noteLine}
          <div class="client-items">${items}</div>
        </div>
        <div class="client-row-actions">
          <button class="btn-admin gold" onclick="clientMessage('${c.phone}')">WhatsApp</button>
          ${removeBtn}
        </div>
      </div>`;
  }).join('');
}
window.clientMessage = phone => {
  const c = clientsLedger().find(x => x.phone === phone);
  const first = (c && c.name ? c.name : 'there').split(' ')[0];
  const msg = `Hi ${first}! Thanks for shopping with Silvarkicks. Fresh pieces just landed. Browse what's new here: ${SHOP_URL}\n\nSilvarkicks 👟`;
  window.open(`https://wa.me/${clientWaPhone(phone)}?text=${encodeURIComponent(msg)}`, '_blank');
};
// Manually add / remove a client (server-synced via the clients[] list).
// Shared search-result row: thumbnail + name + category/sizes + stock/price.
// Used by the POS item picker and the Clients "item bought" autocomplete so
// look-alike items (two "Nike Air Force") can be told apart by their photo.
function itemOptHTML(b) {
  const stockKeys = Object.keys(b.stock || {});
  const units = Object.values(b.stock || {}).reduce((s, n) => s + (Number(n) || 0), 0);
  const meta = stockKeys.length ? `${units} in stock` : fmtKsh(b.price);
  const sizesIn = Object.entries(b.stock || {}).filter(([, q]) => q > 0).map(([s]) => s);
  const sub = [b.category, sizesIn.length ? 'sizes ' + sizesIn.join(', ') : ''].filter(Boolean).join(' · ');
  const thumb = b.image
    ? `<img class="opt-thumb" src="${escapeHtml(b.image)}" alt="" loading="lazy">`
    : `<span class="opt-thumb opt-thumb-none">👟</span>`;
  return `<button type="button" class="client-item-opt" data-id="${b.id}">${thumb}<span class="opt-main"><span class="opt-name">${escapeHtml(b.name)}</span>${sub ? `<span class="opt-sub">${escapeHtml(sub)}</span>` : ''}</span><span class="opt-meta">${meta}</span></button>`;
}
// ----- "Item bought" autocomplete: type → tappable matches → select one -----
let acItemId = ''; // selected item id ('' = none / contact-only)
function acRenderResults(q) {
  const box = document.getElementById('addClientItemResults');
  const query = (q || '').toLowerCase();
  if (!query) { box.style.display = 'none'; box.innerHTML = ''; return; }
  const matches = bags.filter(b => (b.name || '').toLowerCase().includes(query)).slice(0, 12);
  box.innerHTML = matches.length
    ? matches.map(itemOptHTML).join('')
    : '<div class="client-item-empty">No items match.</div>';
  box.style.display = '';
}
function acSelectItem(id) {
  const bag = bags.find(b => b.id === id);
  if (!bag) return;
  acItemId = id;
  document.getElementById('addClientItemSearch').value = bag.name;
  document.getElementById('addClientItemResults').style.display = 'none';
  const sizeSel = document.getElementById('addClientSize');
  sizeSel.innerHTML = '';
  const inStock = Object.entries(bag.stock || {}).filter(([, q]) => q > 0);
  if (inStock.length) {
    inStock.forEach(([sz, q]) => { const o = document.createElement('option'); o.value = sz; o.textContent = `${sz} (${q} in stock)`; sizeSel.appendChild(o); });
  } else {
    const o = document.createElement('option'); o.value = 'One size'; o.textContent = 'One size'; sizeSel.appendChild(o);
  }
  document.getElementById('addClientQty').value = 1;
  document.getElementById('addClientPrice').value = (bag.salePrice > 0 && bag.salePrice < bag.price) ? bag.salePrice : bag.price;
  document.getElementById('addClientChosen').innerHTML = `Recording a sale for <strong>${escapeHtml(bag.name)}</strong> · <button type="button" id="addClientClearItem">clear</button>`;
  document.getElementById('addClientChosen').style.display = '';
  document.getElementById('addClientSaleFields').style.display = '';
}
function acClearItem() {
  acItemId = '';
  document.getElementById('addClientItemSearch').value = '';
  document.getElementById('addClientItemResults').style.display = 'none';
  document.getElementById('addClientChosen').style.display = 'none';
  document.getElementById('addClientSaleFields').style.display = 'none';
}
function openAddClient() {
  document.getElementById('addClientName').value = '';
  document.getElementById('addClientPhone').value = '';
  document.getElementById('addClientNote').value = '';
  acClearItem();
  document.getElementById('addClientModal').style.display = 'flex';
  document.getElementById('addClientName').focus();
}
function closeAddClient() { document.getElementById('addClientModal').style.display = 'none'; }
document.getElementById('clientsAddBtn')?.addEventListener('click', openAddClient);
document.getElementById('addClientCancelBtn')?.addEventListener('click', closeAddClient);
document.getElementById('addClientModal')?.addEventListener('click', e => { if (e.target.id === 'addClientModal') closeAddClient(); });
document.getElementById('addClientItemSearch')?.addEventListener('input', e => {
  acItemId = '';
  document.getElementById('addClientChosen').style.display = 'none';
  document.getElementById('addClientSaleFields').style.display = 'none';
  acRenderResults(e.target.value.trim());
});
document.getElementById('addClientItemResults')?.addEventListener('click', e => {
  const opt = e.target.closest('.client-item-opt');
  if (opt) acSelectItem(opt.dataset.id);
});
document.getElementById('addClientChosen')?.addEventListener('click', e => {
  if (e.target.id === 'addClientClearItem') acClearItem();
});
document.getElementById('addClientSaveBtn')?.addEventListener('click', async () => {
  const name = document.getElementById('addClientName').value.trim();
  const phone = document.getElementById('addClientPhone').value.trim().replace(/[^0-9+]/g, '');
  const note = document.getElementById('addClientNote').value.trim();
  if (!name) { showToast('Enter a name.'); return; }
  if (phone.replace(/[^0-9]/g, '').length < 9) { showToast('Enter a valid phone number.'); return; }
  const itemId = acItemId;
  let size, qty, salePrice;
  if (itemId) {
    size = document.getElementById('addClientSize').value;
    qty = parseInt(document.getElementById('addClientQty').value, 10) || 1;
    salePrice = parseInt(document.getElementById('addClientPrice').value, 10);
  }
  const btn = document.getElementById('addClientSaveBtn');
  btn.disabled = true;
  try {
    await apiMutateAndPublish(() => {
      if (!Array.isArray(clients)) clients = [];
      const norm = phone.replace(/[^0-9]/g, '');
      const existing = clients.find(c => String(c.phone).replace(/[^0-9]/g, '') === norm);
      if (existing) { existing.name = name; existing.note = note; }
      else clients.push({ id: 'c_' + Date.now(), name, phone, note, createdAt: new Date().toISOString() });
      if (itemId) {
        const bag = bags.find(b => b.id === itemId);
        if (!bag) throw new Error('Item no longer exists — refresh admin');
        if (bag.stock && bag.stock[size] !== undefined) bag.stock[size] = Math.max(0, bag.stock[size] - qty);
        if (!bag.sales) bag.sales = [];
        bag.sales.push({ size, qty, salePrice: salePrice || bag.price, buyerName: name, buyerPhone: phone, notes: note, soldAt: new Date().toISOString() });
      }
    });
    closeAddClient();
    renderClients(); renderDashboard(); renderInventory(); renderList();
    showToast(itemId ? 'Client saved + sale recorded.' : 'Client saved.');
  } catch (e) { showToast('Save failed: ' + e.message); }
  finally { btn.disabled = false; }
});
window.removeClient = async (id) => {
  if (!await confirmAction('Remove this client from your list? Their past sales (if any) stay in your records.', 'Remove')) return;
  try {
    await apiMutateAndPublish(() => { clients = (clients || []).filter(c => c.id !== id); });
    renderClients();
    showToast('Client removed.');
  } catch (e) { showToast('Remove failed: ' + e.message); }
};
document.getElementById('clientsSearch')?.addEventListener('input', e => { clientsQuery = e.target.value.trim(); renderClients(); });
document.getElementById('clientsSort')?.addEventListener('change', e => { clientsSort = e.target.value; renderClients(); });
// "NEW" badge on the Clients nav link — kept permanently visible (owner asked
// for it to always show). No auto-dismiss; the badge renders from the HTML/CSS.

// ====== MONEY OWED — customer balances (buying on credit / pay later) ======
// A sale's amountPaid is the cash taken at the time of sale; later part-payments
// are appended to sale.payments[]. Any sale recorded before this feature has no
// amountPaid, so it reads as paid in full — old data is never shown as owing.
function saleTotal(bag, s) { return (Number(s.salePrice != null ? s.salePrice : bag.price) || 0) * (Number(s.qty) || 1); }
function salePaid(bag, s) {
  const total = saleTotal(bag, s);
  const initial = (s.amountPaid != null) ? Math.max(0, Number(s.amountPaid) || 0) : total;
  const extra = (s.payments || []).reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  return Math.min(total, initial + extra);
}
function saleBalance(bag, s) { return Math.max(0, saleTotal(bag, s) - salePaid(bag, s)); }

// Map of phone (digits only, ≥9) → total still owed. Used by the Clients tab too.
function owedByPhone() {
  const m = {};
  for (const bag of bags) for (const s of (bag.sales || [])) {
    const bal = saleBalance(bag, s);
    if (bal <= 0) continue;
    const phone = String(s.buyerPhone || '').replace(/[^0-9]/g, '');
    if (phone.length < 9) continue;
    m[phone] = (m[phone] || 0) + bal;
  }
  return m;
}

// Group every outstanding balance by customer. Balances on a sale with no usable
// phone fall into one "not saved" bucket so the money is still visible to the owner.
function owedLedger() {
  const map = new Map();
  for (const bag of bags) {
    for (const s of (bag.sales || [])) {
      const bal = saleBalance(bag, s);
      if (bal <= 0) continue;
      const phone = String(s.buyerPhone || '').replace(/[^0-9]/g, '');
      const hasPhone = phone.length >= 9;
      const key = hasPhone ? phone : '__nophone__';
      let c = map.get(key);
      if (!c) { c = { phone: hasPhone ? phone : '', name: '', owed: 0, lines: [], _lastAt: 0 }; map.set(key, c); }
      c.owed += bal;
      c.lines.push({ bagId: bag.id, soldAt: s.soldAt, bagName: bag.name, size: s.size || '', total: saleTotal(bag, s), balance: bal, at: s.soldAt, notes: s.notes || '' });
      const at = new Date(s.soldAt || 0).getTime();
      if (s.buyerName && at >= c._lastAt) { c.name = s.buyerName; c._lastAt = at; }
      else if (!c.name && s.buyerName) c.name = s.buyerName;
    }
  }
  return [...map.values()];
}

let owedQuery = '';
function renderOwed() {
  const listEl = document.getElementById('owedList');
  if (!listEl) return;
  const ledger = owedLedger();
  const totalOwed = ledger.reduce((s, c) => s + c.owed, 0);
  const withPhone = ledger.filter(c => c.phone);
  let oldest = null;
  ledger.forEach(c => c.lines.forEach(l => { const t = new Date(l.at || 0).getTime(); if (t && (oldest === null || t < oldest)) oldest = t; }));

  const nav = document.getElementById('navOwedCount'); if (nav) nav.textContent = ledger.length || '';
  const navLink = document.getElementById('owedNavLink'); if (navLink) navLink.classList.toggle('admin-nav-owed-on', totalOwed > 0);

  const kpi = document.getElementById('owedKpiGrid');
  if (kpi) kpi.innerHTML = `
    <div class="inv-kpi danger"><div class="inv-kpi-label">Total owed to you</div><div class="inv-kpi-val">${fmtKsh(totalOwed)}</div><div class="inv-kpi-sub">across ${ledger.length} customer${ledger.length === 1 ? '' : 's'}</div></div>
    <div class="inv-kpi"><div class="inv-kpi-label">Customers owing</div><div class="inv-kpi-val">${ledger.length}</div><div class="inv-kpi-sub">${withPhone.length} with a phone saved</div></div>
    <div class="inv-kpi"><div class="inv-kpi-label">Oldest balance</div><div class="inv-kpi-val">${oldest ? relTime(new Date(oldest).toISOString()) : '—'}</div><div class="inv-kpi-sub">${oldest ? 'taken ' + fmtDate(new Date(oldest).toISOString()) : 'since the shoes were taken'}</div></div>
  `;

  if (!ledger.length) {
    listEl.innerHTML = '<p style="font-size:13px;color:#999;padding:14px;">No one owes you right now. When you record a sale and the customer pays less than the full price, the balance shows up here so you can chase it.</p>';
    return;
  }
  const q = owedQuery.toLowerCase();
  const rows = ledger
    .filter(c => !q || (c.name || '').toLowerCase().includes(q) || c.phone.includes(q))
    .sort((a, b) => b.owed - a.owed);
  if (!rows.length) { listEl.innerHTML = '<p style="font-size:13px;color:#999;padding:14px;">No customers match your search.</p>'; return; }
  listEl.innerHTML = rows.map(c => {
    const items = c.lines.slice().sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0))
      .map(l => `<span class="owed-line">${escapeHtml(l.bagName)}${l.size ? ' · ' + escapeHtml(l.size) : ''} · owes ${fmtKsh(l.balance)} of ${fmtKsh(l.total)} · taken ${fmtDate(l.at)} (${relTime(l.at)})${l.notes ? ` · <em>${escapeHtml(l.notes)}</em>` : ''}</span>`).join('');
    const noPhone = !c.phone;
    const title = noPhone ? 'Buyer not saved' : (c.name || 'Unnamed customer');
    const sub = noPhone
      ? `${c.lines.length} item${c.lines.length === 1 ? '' : 's'} on credit · no phone saved`
      : `${escapeHtml(c.phone)} · ${c.lines.length} item${c.lines.length === 1 ? '' : 's'} on credit`;
    const noteLine = noPhone ? '<div class="client-note">Add this customer\'s phone (Edit the sale in Recent sales) so you can track and collect it.</div>' : '';
    const actions = noPhone ? '' : `
          <button class="btn-admin gold" onclick="openPayDebt('${c.phone}')">Record payment</button>
          <button class="btn-admin" onclick="remindDebt('${c.phone}')">Remind</button>`;
    return `
      <div class="client-row owed-row">
        <div class="client-row-main">
          <div class="client-row-name">${escapeHtml(title)} <span class="owed-amount">owes ${fmtKsh(c.owed)}</span></div>
          <div class="client-row-sub">${sub}</div>
          ${noteLine}
          <div class="owed-lines">${items}</div>
          <div class="owed-total">Total owing: <span class="owed-amount">${fmtKsh(c.owed)}</span></div>
        </div>
        <div class="client-row-actions">${actions}</div>
      </div>`;
  }).join('');
}
document.getElementById('owedSearch')?.addEventListener('input', e => { owedQuery = e.target.value.trim(); renderOwed(); });

// ----- Record a payment against a customer's balance (oldest debt first) -----
let payingPhone = '';
function openPayDebt(phone) {
  const c = owedLedger().find(x => x.phone === phone);
  if (!c) return;
  payingPhone = phone;
  document.getElementById('payDebtName').textContent = c.name || c.phone;
  document.getElementById('payDebtOwed').textContent = fmtKsh(c.owed);
  document.getElementById('payDebtAmount').value = c.owed; // default = clear the whole balance
  document.querySelectorAll('#payDebtPay .pos-pay-btn').forEach(b => b.classList.toggle('active', b.dataset.pay === 'mpesa'));
  document.getElementById('payDebtModal').style.display = 'flex';
  document.getElementById('payDebtAmount').focus();
}
window.openPayDebt = openPayDebt;
function closePayDebt() { document.getElementById('payDebtModal').style.display = 'none'; payingPhone = ''; }
document.getElementById('payDebtCancelBtn')?.addEventListener('click', closePayDebt);
document.getElementById('payDebtModal')?.addEventListener('click', e => { if (e.target.id === 'payDebtModal') closePayDebt(); });
document.getElementById('payDebtPay')?.addEventListener('click', e => { const b = e.target.closest('.pos-pay-btn'); if (!b) return; document.querySelectorAll('#payDebtPay .pos-pay-btn').forEach(x => x.classList.toggle('active', x === b)); });
document.getElementById('payDebtSaveBtn')?.addEventListener('click', async () => {
  const phone = payingPhone;
  const amount = parseInt(document.getElementById('payDebtAmount').value, 10);
  const method = document.querySelector('#payDebtPay .pos-pay-btn.active')?.dataset.pay || 'mpesa';
  if (!phone) return;
  if (isNaN(amount) || amount <= 0) { showToast('Enter how much they paid.'); return; }
  closePayDebt();
  const at = new Date().toISOString();
  try {
    let applied = 0;
    await apiMutateAndPublish(() => {
      const lines = [];
      for (const bag of bags) for (const s of (bag.sales || [])) {
        if (String(s.buyerPhone || '').replace(/[^0-9]/g, '') !== phone) continue;
        if (saleBalance(bag, s) > 0) lines.push({ bag, s });
      }
      lines.sort((a, b) => new Date(a.s.soldAt || 0) - new Date(b.s.soldAt || 0)); // oldest first
      let remaining = amount;
      for (const { bag, s } of lines) {
        if (remaining <= 0) break;
        const pay = Math.min(saleBalance(bag, s), remaining);
        if (pay <= 0) continue;
        if (!s.payments) s.payments = [];
        s.payments.push({ amount: pay, at, method });
        remaining -= pay; applied += pay;
      }
    });
    renderOwed(); renderClients(); renderDashboard();
    showToast(applied > 0 ? `Payment of ${fmtKsh(applied)} recorded.` : 'That balance is already cleared.');
  } catch (e) { showToast('Error: ' + e.message); }
});
// WhatsApp a friendly balance reminder.
window.remindDebt = phone => {
  const c = owedLedger().find(x => x.phone === phone);
  if (!c) return;
  const first = (c.name || 'there').split(' ')[0];
  const n = c.lines.length;
  const list = c.lines.map((l, i) => `${i + 1}. *${l.bagName}*${l.size ? ' (' + l.size + ')' : ''}\n    Taken ${fmtDate(l.at)} · balance ${fmtKsh(l.balance)}`).join('\n');
  const intro = n === 1
    ? `A friendly reminder about your balance on the item you took from Silvarkicks:`
    : `A friendly reminder about the ${n} items you took from Silvarkicks that still have a balance:`;
  const msg = `Hi ${first}, hope you're doing well.\n\n${intro}\n\n${list}\n\n*Total still owing: ${fmtKsh(c.owed)}*\nYou can pay via M-Pesa whenever you're ready. Thank you!`;
  window.open(`https://wa.me/${clientWaPhone(phone)}?text=${encodeURIComponent(msg)}`, '_blank');
};

// Live "balance owing" hint as the owner types the amount paid (both sale paths).
function paidHint(priceEl, qtyEl, paidEl, hintEl) {
  const total = (parseInt(priceEl.value, 10) || 0) * (parseInt(qtyEl.value, 10) || 1);
  const raw = (paidEl.value || '').trim();
  if (raw === '') { hintEl.style.display = 'none'; return; }
  const bal = total - Math.min(total, Math.max(0, parseInt(raw, 10) || 0));
  hintEl.style.display = bal > 0 ? '' : 'none';
  if (bal > 0) hintEl.textContent = `Balance owing: ${fmtKsh(bal)}`;
}
// Keep the live balance hint and the "Not paid yet" pill in sync with the paid box.
function syncPaid(priceId, qtyId, paidId, hintId, btnId) {
  const paidEl = document.getElementById(paidId);
  paidHint(document.getElementById(priceId), document.getElementById(qtyId), paidEl, document.getElementById(hintId));
  const btn = document.getElementById(btnId);
  if (btn) btn.classList.toggle('active', (paidEl.value || '').trim() === '0');
}
['salePaidInput', 'salePriceInput', 'saleQtyInput'].forEach(id => document.getElementById(id)?.addEventListener('input',
  () => syncPaid('salePriceInput', 'saleQtyInput', 'salePaidInput', 'salePaidHint', 'salePaidNone')));
['posPaid', 'posPrice', 'posQty'].forEach(id => document.getElementById(id)?.addEventListener('input',
  () => syncPaid('posPrice', 'posQty', 'posPaid', 'posPaidHint', 'posPaidNone')));
document.getElementById('salePaidNone')?.addEventListener('click', () => {
  document.getElementById('salePaidInput').value = '0';
  syncPaid('salePriceInput', 'saleQtyInput', 'salePaidInput', 'salePaidHint', 'salePaidNone');
});
document.getElementById('posPaidNone')?.addEventListener('click', () => {
  document.getElementById('posPaid').value = '0';
  syncPaid('posPrice', 'posQty', 'posPaid', 'posPaidHint', 'posPaidNone');
});

// ====== WHATSAPP BROADCAST ======
let broadcastSelectedIds = [];
let broadcastRecipientsState = {};

function pastBuyers() {
  // Unique past buyers from sales history, carrying the (category, size) pairs each
  // one bought so the broadcast can be segmented (e.g. everyone who bought Jeans, or
  // size 34). Keeps the most-recent buyer name + last item for display.
  const map = new Map();
  for (const bag of bags) {
    for (const s of (bag.sales || [])) {
      if (!s.buyerPhone) continue;
      const phone = String(s.buyerPhone).replace(/[^0-9]/g, '');
      if (phone.length < 9) continue;
      const soldAt = new Date(s.soldAt || 0).getTime();
      let e = map.get(phone);
      if (!e) { e = { phone, name: '', soldAt: -1, lastBought: '', buys: [] }; map.set(phone, e); }
      e.buys.push({ cat: bag.category || '', size: s.size || '' });
      if (soldAt >= e.soldAt) { e.soldAt = soldAt; e.lastBought = bag.name; if (s.buyerName) e.name = s.buyerName; }
      else if (!e.name && s.buyerName) e.name = s.buyerName;
    }
  }
  return [...map.values()].sort((a, b) => b.soldAt - a.soldAt);
}

// ===== Broadcast segmentation: filter recipients by category + size =====
let broadcastFilterCat = 'all';
let broadcastFilterSize = 'all';

function broadcastSortSizes(arr) {
  return arr.sort((a, b) => {
    const na = parseFloat(a), nb = parseFloat(b);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    if (!isNaN(na)) return -1;
    if (!isNaN(nb)) return 1;
    return String(a).localeCompare(String(b));
  });
}
function buyerMatchesFilter(b) {
  return (b.buys || []).some(x =>
    (broadcastFilterCat === 'all' || x.cat === broadcastFilterCat) &&
    (broadcastFilterSize === 'all' || x.size === broadcastFilterSize));
}
function soldCategories() {
  const set = new Set();
  bags.forEach(b => { if (b.category && (b.sales || []).length) set.add(b.category); });
  return [...set].sort();
}
function soldSizes(cat) {
  const set = new Set();
  bags.forEach(b => { if (cat !== 'all' && b.category !== cat) return; (b.sales || []).forEach(s => { if (s.size) set.add(s.size); }); });
  return broadcastSortSizes([...set]);
}
function populateBroadcastFilters() {
  const catSel = document.getElementById('broadcastFilterCat');
  const sizeSel = document.getElementById('broadcastFilterSize');
  if (!catSel || !sizeSel) return;
  const cats = soldCategories();
  if (broadcastFilterCat !== 'all' && !cats.includes(broadcastFilterCat)) broadcastFilterCat = 'all';
  catSel.innerHTML = `<option value="all">Any category</option>` + cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  catSel.value = broadcastFilterCat;
  const sizes = soldSizes(broadcastFilterCat);
  if (broadcastFilterSize !== 'all' && !sizes.includes(broadcastFilterSize)) broadcastFilterSize = 'all';
  sizeSel.innerHTML = `<option value="all">Any size</option>` + sizes.map(s => `<option value="${escapeHtml(s)}">size ${escapeHtml(s)}</option>`).join('');
  sizeSel.value = broadcastFilterSize;
}
document.getElementById('broadcastFilterCat')?.addEventListener('change', e => {
  broadcastFilterCat = e.target.value;
  broadcastFilterSize = 'all'; // sizes are category-specific — reset when category changes
  populateBroadcastFilters();
  renderBroadcastRecipients();
});
document.getElementById('broadcastFilterSize')?.addEventListener('change', e => {
  broadcastFilterSize = e.target.value;
  renderBroadcastRecipients();
});

function renderBroadcastSelected() {
  const wrap = document.getElementById('broadcastSelectedItems');
  if (!wrap) return;
  if (!broadcastSelectedIds.length) { wrap.innerHTML = '<p style="color:var(--ink-faint);font-size:13px;margin:6px 0;">No items selected, message will be text-only.</p>'; return; }
  wrap.innerHTML = broadcastSelectedIds.map(id => {
    const b = bags.find(x => x.id === id);
    if (!b) return '';
    return `<div class="set-chip"><img src="${b.image}" alt=""><span>${escapeHtml(b.name)}</span><button data-bc-remove="${escapeHtml(id)}" aria-label="Remove">×</button></div>`;
  }).join('');
  wrap.querySelectorAll('[data-bc-remove]').forEach(btn => {
    btn.addEventListener('click', () => {
      broadcastSelectedIds = broadcastSelectedIds.filter(id => id !== btn.dataset.bcRemove);
      renderBroadcastSelected();
      renderBroadcastPicker();
      renderBroadcastPreview();
    });
  });
}

function renderBroadcastPicker() {
  const picker = document.getElementById('broadcastItemPicker');
  if (!picker) return;
  const q = (document.getElementById('broadcastItemSearch')?.value || '').toLowerCase().trim();
  const matches = bags
    .filter(b => !broadcastSelectedIds.includes(b.id))
    .filter(b => !q || `${b.name} ${b.category || ''}`.toLowerCase().includes(q))
    .slice(0, 40);
  picker.innerHTML = matches.length
    ? matches.map(b => `
        <button class="set-pick" data-bc-add="${escapeHtml(b.id)}" type="button">
          <img src="${b.image}" alt="">
          <div class="set-pick-body">
            <div class="set-pick-name">${escapeHtml(b.name)}</div>
            <div class="set-pick-meta">${escapeHtml(b.category || '')}${b.price > 0 ? ' · ' + fmtKsh(b.price) : ''}</div>
          </div>
        </button>`).join('')
    : '<p style="color:var(--ink-faint);font-size:13px;padding:8px 0;">No matches.</p>';
  picker.querySelectorAll('[data-bc-add]').forEach(b => {
    b.addEventListener('click', () => {
      broadcastSelectedIds.push(b.dataset.bcAdd);
      renderBroadcastSelected();
      renderBroadcastPicker();
      renderBroadcastPreview();
    });
  });
}

function renderBroadcastRecipients() {
  const wrap = document.getElementById('broadcastRecipients');
  if (!wrap) return;
  populateBroadcastFilters();
  const all = pastBuyers();
  for (const b of all) {
    if (!(b.phone in broadcastRecipientsState)) {
      broadcastRecipientsState[b.phone] = { name: b.name, included: true };
    }
  }
  const buyers = all.filter(buyerMatchesFilter);
  const matchEl = document.getElementById('broadcastFilterMatch');
  if (matchEl) {
    const seg = (broadcastFilterCat === 'all' && broadcastFilterSize === 'all')
      ? 'all buyers'
      : [broadcastFilterCat === 'all' ? null : broadcastFilterCat, broadcastFilterSize === 'all' ? null : 'size ' + broadcastFilterSize].filter(Boolean).join(' · ');
    matchEl.textContent = `${buyers.length} ${buyers.length === 1 ? 'buyer' : 'buyers'}${seg === 'all buyers' ? '' : ' · ' + seg}`;
  }
  if (!all.length) {
    wrap.innerHTML = '<p style="color:var(--ink-faint);font-size:13px;padding:8px 0;">No past buyers yet. Once you record sales with buyer phones, they\'ll show up here.</p>';
    return;
  }
  if (!buyers.length) {
    wrap.innerHTML = '<p style="color:var(--ink-faint);font-size:13px;padding:8px 0;">No past buyers match this segment. Widen the category or size above.</p>';
    return;
  }
  wrap.innerHTML = `
    <div style="display:flex;gap:8px;margin-bottom:8px;">
      <button class="btn-admin" type="button" data-bc-recip="all" style="padding:4px 10px;font-size:11px;">Select all</button>
      <button class="btn-admin" type="button" data-bc-recip="none" style="padding:4px 10px;font-size:11px;">Deselect all</button>
      <span style="font-size:12px;color:var(--ink-faint);margin-left:auto;align-self:center;" id="broadcastSelectedCount"></span>
    </div>
    ${buyers.map(b => {
      const st = broadcastRecipientsState[b.phone];
      return `
        <label class="broadcast-recipient${st.included ? ' on' : ''}">
          <input type="checkbox" data-bc-toggle="${b.phone}" ${st.included ? 'checked' : ''}>
          <span class="broadcast-recipient-name">${escapeHtml(b.name || 'Unknown buyer')}</span>
          <span class="broadcast-recipient-phone">+${b.phone}</span>
          <span class="broadcast-recipient-meta">last: ${escapeHtml(b.lastBought)}</span>
        </label>`;
    }).join('')}
  `;
  wrap.querySelectorAll('[data-bc-toggle]').forEach(cb => {
    cb.addEventListener('change', () => {
      broadcastRecipientsState[cb.dataset.bcToggle].included = cb.checked;
      cb.closest('.broadcast-recipient').classList.toggle('on', cb.checked);
      updateBroadcastCount();
    });
  });
  wrap.querySelectorAll('[data-bc-recip]').forEach(btn => {
    btn.addEventListener('click', () => {
      const on = btn.dataset.bcRecip === 'all';
      buyers.forEach(b => { broadcastRecipientsState[b.phone].included = on; });
      renderBroadcastRecipients();
    });
  });
  updateBroadcastCount();
}

function updateBroadcastCount() {
  const el = document.getElementById('broadcastSelectedCount');
  if (!el) return;
  const n = Object.values(broadcastRecipientsState).filter(s => s.included).length;
  el.textContent = `${n} selected`;
}

function buildBroadcastMessage(recipientName) {
  const subject = (document.getElementById('broadcastSubject')?.value || '').trim();
  const items = broadcastSelectedIds.map(id => bags.find(b => b.id === id)).filter(Boolean);
  const itemsBlock = items.length
    ? '\n\n' + items.map((b, i) => `${i + 1}. *${b.name}*${b.price > 0 ? ' - ' + fmtKsh(b.price) : ''}`).join('\n')
    : '';
  const greet = recipientName ? `Hi ${recipientName.split(' ')[0]}! ` : 'Hi! ';
  return `${greet}It's Silvarkicks Store. ${subject || 'Fresh kicks just landed.'}${itemsBlock}\n\nTap to browse: ${SITE_URL}\n\nSilvarkicks 👟`;
}

function renderBroadcastPreview() {
  const preview = document.getElementById('broadcastPreview');
  if (!preview) return;
  preview.value = buildBroadcastMessage('{First name}');
}

document.getElementById('broadcastSubject')?.addEventListener('input', renderBroadcastPreview);
document.getElementById('broadcastItemSearch')?.addEventListener('input', renderBroadcastPicker);

document.getElementById('broadcastCopyBtn')?.addEventListener('click', () => {
  navigator.clipboard.writeText(buildBroadcastMessage(''));
  showToast('Message copied. Paste it into WhatsApp broadcast.');
});

// On phones the multi-window approach fails: only the first wa.me link fires before
// the browser is backgrounded by the WhatsApp app, and you can only be in one chat
// at a time. So mobile gets a one-at-a-time stepper; desktop keeps the multi-tab open.
const BC_PROG_KEY = 'silvar_bcprog';
let bcQueue = [];   // [{ phone, name }]
let bcIdx = 0;
function saveBcProgress() { try { localStorage.setItem(BC_PROG_KEY, JSON.stringify({ q: bcQueue, i: bcIdx })); } catch (_) {} }
function clearBcProgress() { try { localStorage.removeItem(BC_PROG_KEY); } catch (_) {} bcQueue = []; bcIdx = 0; }

function renderBroadcastStepper() {
  const el = document.getElementById('broadcastStepper');
  if (!el) return;
  if (!bcQueue.length) { el.style.display = 'none'; el.innerHTML = ''; return; }
  if (bcIdx >= bcQueue.length) {
    el.style.display = 'block';
    el.innerHTML = `<div class="bc-step-done">✓ Done — stepped through all ${bcQueue.length} buyer${bcQueue.length === 1 ? '' : 's'}. <button class="btn-admin" id="bcStepClose" type="button">Close</button></div>`;
    document.getElementById('bcStepClose').addEventListener('click', () => { clearBcProgress(); renderBroadcastStepper(); });
    return;
  }
  const r = bcQueue[bcIdx];
  const href = `https://wa.me/${clientWaPhone(r.phone)}?text=${encodeURIComponent(buildBroadcastMessage(r.name))}`;
  el.style.display = 'block';
  el.innerHTML = `
    <div class="bc-step-head">Sending ${bcIdx + 1} of ${bcQueue.length}</div>
    <div class="bc-step-name">${escapeHtml(r.name || 'Unknown buyer')} · +${escapeHtml(r.phone)}</div>
    <div class="bc-step-actions">
      <a class="btn-admin gold" id="bcStepOpen" href="${href}" target="_blank" rel="noopener">Open WhatsApp &amp; send →</a>
      <button class="btn-admin" id="bcStepNext" type="button">Sent ✓ · Next ▸</button>
      <button class="btn-admin" id="bcStepSkip" type="button">Skip</button>
      <button class="btn-admin danger" id="bcStepStop" type="button">Stop</button>
    </div>
    <div class="bc-step-hint">Tap <strong>Open WhatsApp</strong>, press send inside WhatsApp, come back here and tap <strong>Sent ✓ · Next</strong>. Your place is saved if you get interrupted.</div>`;
  document.getElementById('bcStepNext').addEventListener('click', () => { bcIdx++; saveBcProgress(); renderBroadcastStepper(); });
  document.getElementById('bcStepSkip').addEventListener('click', () => { bcIdx++; saveBcProgress(); renderBroadcastStepper(); });
  document.getElementById('bcStepStop').addEventListener('click', () => { clearBcProgress(); renderBroadcastStepper(); showToast('Sending stopped.'); });
}

function restoreBcProgress() {
  try {
    const p = JSON.parse(localStorage.getItem(BC_PROG_KEY) || 'null');
    if (p && Array.isArray(p.q) && p.q.length && p.i < p.q.length) { bcQueue = p.q; bcIdx = p.i; renderBroadcastStepper(); }
    else clearBcProgress();
  } catch (_) {}
}

const BC_IS_MOBILE = matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

document.getElementById('broadcastStartBtn')?.addEventListener('click', async () => {
  const recipients = pastBuyers().filter(b => buyerMatchesFilter(b) && broadcastRecipientsState[b.phone]?.included);
  if (!recipients.length) { showToast('Pick at least one recipient.'); return; }
  if (BC_IS_MOBILE) {
    if (!await confirmAction(`Send to ${recipients.length} buyer${recipients.length === 1 ? '' : 's'}, one at a time. For each: tap Open WhatsApp, send, come back, tap Next. OK?`, 'Start')) return;
    bcQueue = recipients.map(r => ({ phone: r.phone, name: r.name }));
    bcIdx = 0;
    saveBcProgress();
    renderBroadcastStepper();
    document.getElementById('broadcastStepper').scrollIntoView({ behavior: 'auto', block: 'center' });
    return;
  }
  if (!await confirmAction(`Open ${recipients.length} WhatsApp window${recipients.length === 1 ? '' : 's'}, one per buyer. Send each one manually. OK?`)) return;
  let i = 0;
  function next() {
    if (i >= recipients.length) {
      document.getElementById('broadcastStatus').textContent = `Opened ${recipients.length} WhatsApp window${recipients.length === 1 ? '' : 's'}.`;
      return;
    }
    const r = recipients[i++];
    const msg = buildBroadcastMessage(r.name);
    window.open(`https://wa.me/${clientWaPhone(r.phone)}?text=${encodeURIComponent(msg)}`, '_blank');
    document.getElementById('broadcastStatus').textContent = `Opening ${i} of ${recipients.length}…`;
    setTimeout(next, 700);
  }
  next();
});
restoreBcProgress();

// ====== INSTAGRAM SYNC ======
const IG_USER_ID = '21684819437';
let igSyncCandidates = [];

const igSyncCheckBtn = document.getElementById('igSyncCheckBtn');
const igSyncCommitBtn = document.getElementById('igSyncCommitBtn');
const igSyncCancelBtn = document.getElementById('igSyncCancelBtn');
const igSyncStatus = document.getElementById('igSyncStatus');
const igSyncListEl = document.getElementById('igSyncList');
const igSyncCommitRow = document.getElementById('igSyncCommitRow');

const SHOE_CATEGORIES = ['Sneakers', 'Sports/Athletic', 'Boots', 'Loafers', 'Formal', 'Slides', 'Other'];

igSyncCheckBtn?.addEventListener('click', checkForNewIgPosts);
igSyncCancelBtn?.addEventListener('click', resetIgSync);
igSyncCommitBtn?.addEventListener('click', commitIgSync);

async function checkForNewIgPosts() {
  if (accountSuspended) { igSyncStatus.textContent = '✗ ' + SUSPENDED_MSG; return; }
  igSyncCheckBtn.disabled = true;
  igSyncStatus.textContent = 'Checking Instagram…';
  igSyncListEl.innerHTML = '';
  igSyncCommitRow.style.display = 'none';
  try {
    const res = await fetch(`${API_BASE}/api/ig-discover?user_id=${IG_USER_ID}&limit=20`, {
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
    igSyncCandidates = data.items || [];
    if (!igSyncCandidates.length) {
      igSyncStatus.textContent = '✓ Catalog is up to date. No new posts on Instagram.';
      igSyncCheckBtn.disabled = false;
      return;
    }
    igSyncStatus.textContent = `Found ${igSyncCandidates.length} new post${igSyncCandidates.length === 1 ? '' : 's'}. Review below, then add.`;
    renderIgSyncList();
    igSyncCommitRow.style.display = 'flex';
  } catch (err) {
    igSyncStatus.textContent = '✗ ' + err.message;
  } finally {
    igSyncCheckBtn.disabled = false;
  }
}

function renderIgSyncList() {
  igSyncListEl.innerHTML = igSyncCandidates.map((it, i) => {
    const s = it.suggested || {};
    const stockText = Object.entries(s.stock || {}).map(([k, v]) => `${k}×${v}`).join(' · ') || 'One Size';
    const captionShort = (it.caption || '').replace(/\s+/g, ' ').slice(0, 120);
    const catOpts = SHOE_CATEGORIES.map(c => `<option value="${c}" ${c === s.category ? 'selected' : ''}>${c}</option>`).join('');
    return `
      <div class="ig-sync-row" data-idx="${i}">
        <label class="ig-sync-check">
          <input type="checkbox" data-ig-pick="${i}" checked>
        </label>
        <img src="${escapeHtml(it.imageUrl)}" alt="" referrerpolicy="no-referrer">
        <div class="ig-sync-body">
          <div class="ig-sync-row-1">
            <input type="text" class="ig-sync-name" data-ig-name="${i}" value="${escapeHtml(s.name || '')}" placeholder="Name">
            <select class="ig-sync-cat" data-ig-cat="${i}">${catOpts}</select>
          </div>
          <div class="ig-sync-row-2">
            <span class="ig-sync-size">${escapeHtml(stockText)}</span>
            <a href="${escapeHtml(it.postUrl)}" target="_blank" rel="noopener" class="ig-sync-postlink">view on IG ↗</a>
          </div>
          <div class="ig-sync-caption">${escapeHtml(captionShort)}</div>
        </div>
      </div>`;
  }).join('');
}

function resetIgSync() {
  igSyncCandidates = [];
  igSyncListEl.innerHTML = '';
  igSyncCommitRow.style.display = 'none';
  igSyncStatus.textContent = '';
}

async function commitIgSync() {
  if (accountSuspended) { igSyncStatus.textContent = '✗ ' + SUSPENDED_MSG; return; }
  const picks = [];
  igSyncCandidates.forEach((it, i) => {
    const cb = igSyncListEl.querySelector(`[data-ig-pick="${i}"]`);
    if (!cb || !cb.checked) return;
    const nameEl = igSyncListEl.querySelector(`[data-ig-name="${i}"]`);
    const catEl = igSyncListEl.querySelector(`[data-ig-cat="${i}"]`);
    picks.push({
      shortcode: it.shortcode,
      name: (nameEl?.value || it.suggested?.name || '').trim() || 'Pre-loved Pair',
      category: catEl?.value || it.suggested?.category || 'Sneakers',
      stock: it.suggested?.stock || { 'One Size': 1 },
      description: it.suggested?.description || '',
      imageUrls: it.imageUrls || [it.imageUrl],
      takenAt: it.takenAt,
    });
  });
  if (!picks.length) { showToast('Tick at least one pair to add.'); return; }
  igSyncCommitBtn.disabled = true;
  igSyncCommitBtn.textContent = `Adding ${picks.length}…`;
  try {
    const res = await fetch(`${API_BASE}/api/ig-sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ADMIN_TOKEN}` },
      body: JSON.stringify({ items: picks }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
    showToast(`Added ${data.added} pair${data.added === 1 ? '' : 's'} from Instagram.`);
    igSyncStatus.textContent = `✓ Added ${data.added}. ${data.errors?.length ? `(${data.errors.length} failures)` : ''}`;
    resetIgSync();
    await loadData();
    renderList();
    renderDashboard();
    renderInventory();
  } catch (err) {
    showToast('Error: ' + err.message);
    igSyncStatus.textContent = '✗ ' + err.message;
  } finally {
    igSyncCommitBtn.disabled = false;
    igSyncCommitBtn.textContent = 'Add selected pairs';
  }
}

// ====== INSIGHTS (site-wide, aggregated on the worker) ======
const INSIGHTS_KEY = 'silvar_analytics';
function getInsights() {
  try { return JSON.parse(localStorage.getItem(INSIGHTS_KEY) || '{}'); } catch { return {}; }
}
// Pull the shop-wide aggregate from the worker. Falls back to this device's
// localStorage only if the worker is unreachable (offline / down).
async function fetchInsights() {
  try {
    const res = await fetch(`${API_BASE}/api/insights`, { headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } });
    if (res.ok) return await res.json();
  } catch {}
  return null;
}
async function renderInsights() {
  if (!document.getElementById('insightsKpiGrid')) return;
  const a = (await fetchInsights()) || getInsights();
  const views = a.itemViews || {};
  const enqs = a.itemEnquiries || {};
  const igClicks = a.itemIgClicks || {};
  const wishlist = a.itemWishlist || {};
  const searchNoResults = a.searchNoResults || {};

  const sum = m => Object.values(m).reduce((s, n) => s + (n || 0), 0);
  document.getElementById('insightsKpiGrid').innerHTML = `
    <div class="inv-kpi"><div class="inv-kpi-label">Item views</div><div class="inv-kpi-val">${sum(views)}</div></div>
    <div class="inv-kpi"><div class="inv-kpi-label">Enquiries</div><div class="inv-kpi-val">${sum(enqs)}</div></div>
    <div class="inv-kpi"><div class="inv-kpi-label">Saved</div><div class="inv-kpi-val">${sum(wishlist)}</div></div>
    <div class="inv-kpi"><div class="inv-kpi-label">IG clicks</div><div class="inv-kpi-val">${sum(igClicks)}</div></div>
  `;

  function topList(map, limit = 6) {
    const rows = Object.entries(map)
      .map(([id, n]) => ({ b: bags.find(b => b.id === id), n }))
      .filter(r => r.b)
      .sort((x, y) => y.n - x.n)
      .slice(0, limit);
    return rows.length
      ? rows.map(({ b, n }) => `
          <div class="recent-row">
            <img src="${b.image}" alt="">
            <div style="flex:1;min-width:0;"><div class="recent-name">${escapeHtml(b.name)}</div><div class="recent-meta">${n} ${n === 1 ? 'time' : 'times'}</div></div>
          </div>`).join('')
      : '<p class="insights-empty">No data yet.</p>';
  }
  document.getElementById('insightsTopViews').innerHTML = topList(views);
  document.getElementById('insightsTopEnquiries').innerHTML = topList(enqs);

  // ⭐ The killer feature: searches that returned nothing = unmet demand
  const gaps = Object.entries(searchNoResults).sort((x, y) => y[1] - x[1]).slice(0, 30);
  const pillsEl = document.getElementById('searchGapsPills');
  if (gaps.length) {
    pillsEl.innerHTML = gaps.map(([q, n]) =>
      `<span class="search-gap-pill">${escapeHtml(q)}<span class="count">${n}</span></span>`
    ).join('');
  } else {
    pillsEl.innerHTML = '<p class="insights-empty" style="margin:0;">No empty searches yet. Once visitors search for something the catalogue doesn\'t have, it shows up here as a sourcing hint.</p>';
  }
}

const insightsResetBtn = document.getElementById('insightsResetBtn');
if (insightsResetBtn) {
  insightsResetBtn.addEventListener('click', async () => {
    if (accountSuspended) { showToast(SUSPENDED_MSG); return; }
    if (!await confirmAction('Reset Insights for the whole shop? This clears the site-wide totals from every device and cannot be undone.', 'Reset')) return;
    try {
      await fetch(`${API_BASE}/api/insights-reset`, { method: 'POST', headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } });
    } catch {}
    localStorage.removeItem(INSIGHTS_KEY);
    await renderInsights();
    showToast('Insights reset for the whole shop.');
  });
}

async function init() {
  const catSel = document.getElementById('categoryInput');
  if (catSel) catSel.addEventListener('change', toggleNewCategoryInput);
  showToast('Loading…');
  await loadData();
  renderSuspendedBanner();
  renderList();
  renderDashboard();
  renderInventory();
  renderInsights();
  renderClients();
  renderOwed();
  renderBroadcastSelected();
  renderBroadcastPicker();
  renderBroadcastRecipients();
  renderBroadcastPreview();
  initNavScrollSpy();
}

/* ===== Nav scrollspy — highlight the section currently in view ===== */
function initNavScrollSpy() {
  const nav = document.getElementById('adminNav');
  if (!nav) return;
  const items = Array.from(nav.querySelectorAll('a[href^="#"]'))
    .map(a => ({ a, section: document.getElementById(a.getAttribute('href').slice(1)) }))
    .filter(x => x.section);
  if (!items.length) return;

  let ticking = false;
  function update() {
    ticking = false;
    const probe = nav.offsetHeight + 24; // line just below the sticky nav
    let current = items[0];
    for (const item of items) {
      if (item.section.getBoundingClientRect().top - probe <= 0) current = item;
    }
    // near the bottom of the page → activate the last section
    if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 4) {
      current = items[items.length - 1];
    }
    items.forEach(({ a }) => a.classList.toggle('active', a === current.a));
  }
  function onScroll() {
    if (!ticking) { ticking = true; requestAnimationFrame(update); }
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  update();
}

// ====== POS — SELL IN STORE (counter checkout) + RECEIPTS ======
let posItemId = '';
let posPayMethod = 'mpesa';
let posCart = [];        // [{ bagId, name, image, size, qty, price, amountPaid }]
let lastPosCart = null;  // the last completed basket, for the receipt
function posWaPhone(p) { let d = String(p || '').replace(/[^0-9]/g, ''); if (d.startsWith('0')) d = '254' + d.slice(1); else if (d.startsWith('7') || d.startsWith('1')) d = '254' + d; return d; }
function posRenderResults(q) {
  const box = document.getElementById('posItemResults');
  const query = (q || '').toLowerCase();
  if (!query) { box.style.display = 'none'; box.innerHTML = ''; return; }
  const matches = bags.filter(b => (b.name || '').toLowerCase().includes(query)).slice(0, 12);
  box.innerHTML = matches.length
    ? matches.map(itemOptHTML).join('')
    : '<div class="client-item-empty">No items match.</div>';
  box.style.display = '';
}
function posSelectItem(id) {
  const bag = bags.find(b => b.id === id); if (!bag) return;
  posItemId = id;
  document.getElementById('posItemSearch').value = bag.name;
  document.getElementById('posItemResults').style.display = 'none';
  const sizeSel = document.getElementById('posSize'); sizeSel.innerHTML = '';
  const inStock = Object.entries(bag.stock || {}).filter(([, q]) => q > 0);
  if (inStock.length) inStock.forEach(([sz, q]) => { const o = document.createElement('option'); o.value = sz; o.textContent = `${sz} (${q} in stock)`; sizeSel.appendChild(o); });
  else { const o = document.createElement('option'); o.value = 'One size'; o.textContent = 'One size'; sizeSel.appendChild(o); }
  document.getElementById('posQty').value = 1;
  document.getElementById('posPrice').value = (bag.salePrice > 0 && bag.salePrice < bag.price) ? bag.salePrice : (bag.price || '');
  document.getElementById('posPaid').value = '';
  document.getElementById('posPaidHint').style.display = 'none';
  document.getElementById('posPaidNone').classList.remove('active');
  document.getElementById('posChosen').innerHTML = `Adding <strong>${escapeHtml(bag.name)}</strong> · <button type="button" id="posClearItem">cancel</button>`;
  document.getElementById('posChosen').style.display = '';
  document.getElementById('posSaleFields').style.display = '';
  document.getElementById('posReceiptPanel').style.display = 'none';
}
// Clear the current item entry only — keeps whatever is already in the basket.
function posCancelItem() {
  posItemId = '';
  document.getElementById('posItemSearch').value = '';
  document.getElementById('posItemResults').style.display = 'none';
  document.getElementById('posChosen').style.display = 'none';
  document.getElementById('posSaleFields').style.display = 'none';
  document.getElementById('posPaid').value = '';
  document.getElementById('posPaidHint').style.display = 'none';
  document.getElementById('posPaidNone').classList.remove('active');
}
function posCartTotals() {
  let total = 0, paid = 0;
  posCart.forEach(l => { const lt = l.price * l.qty; total += lt; paid += Math.min(lt, l.amountPaid); });
  return { total, paid, balance: Math.max(0, total - paid) };
}
function renderPosCart() {
  const wrap = document.getElementById('posCart');
  const checkout = document.getElementById('posCheckout');
  const list = document.getElementById('posCartList');
  if (!wrap || !checkout || !list) return;
  if (!posCart.length) { wrap.style.display = 'none'; checkout.style.display = 'none'; return; }
  wrap.style.display = ''; checkout.style.display = '';
  if (!document.getElementById('posDate').value) document.getElementById('posDate').value = todayInputValue();
  list.innerHTML = posCart.map((l, i) => {
    const lt = l.price * l.qty, bal = Math.max(0, lt - l.amountPaid);
    return `<div class="pos-cart-line">
      <img class="opt-thumb" src="${escapeHtml(l.image || '')}" alt="">
      <div class="pos-cart-line-main">
        <div class="pos-cart-line-name">${escapeHtml(l.name)} · ${escapeHtml(l.size)} × ${l.qty}</div>
        <div class="pos-cart-line-meta">${fmtKsh(lt)}${bal > 0 ? ` · <span class="owed-amount">owes ${fmtKsh(bal)}</span>` : ' · paid'}</div>
      </div>
      <button type="button" class="pos-cart-rm" data-idx="${i}" title="Remove">×</button>
    </div>`;
  }).join('');
  const t = posCartTotals();
  document.getElementById('posCartTotals').innerHTML = `${posCart.length} item${posCart.length === 1 ? '' : 's'} · Total ${fmtKsh(t.total)}${t.balance > 0 ? ` · <span class="owed-amount">balance ${fmtKsh(t.balance)}</span>` : ''}`;
  document.getElementById('posRecordBtn').textContent = `Record sale (${posCart.length})`;
}
function posAddToBasket() {
  const id = posItemId; if (!id) { showToast('Pick an item first.'); return; }
  const bag = bags.find(b => b.id === id); if (!bag) { showToast('Item not found — refresh.'); return; }
  const size = document.getElementById('posSize').value;
  const qty = parseInt(document.getElementById('posQty').value, 10) || 1;
  const priceRaw = parseInt(document.getElementById('posPrice').value, 10);
  const price = isNaN(priceRaw) ? (bag.price || 0) : priceRaw;
  const total = price * qty;
  const paidRaw = (document.getElementById('posPaid').value || '').trim();
  const amountPaid = paidRaw === '' ? total : Math.min(total, Math.max(0, parseInt(paidRaw, 10) || 0));
  posCart.push({ bagId: id, name: bag.name, image: bag.image, size, qty, price, amountPaid });
  posCancelItem();
  renderPosCart();
  showToast('Added to basket.');
}
function posReset() {
  posItemId = ''; posPayMethod = 'mpesa'; posCart = [];
  ['posItemSearch', 'posBuyerName', 'posBuyerPhone', 'posPaid', 'posNotes'].forEach(i => { const el = document.getElementById(i); if (el) el.value = ''; });
  document.getElementById('posItemResults').style.display = 'none';
  document.getElementById('posChosen').style.display = 'none';
  document.getElementById('posSaleFields').style.display = 'none';
  document.getElementById('posReceiptPanel').style.display = 'none';
  document.getElementById('posCustomerFields').style.display = '';
  document.getElementById('posPaidHint').style.display = 'none';
  document.getElementById('posPaidNone').classList.remove('active');
  document.getElementById('posDate').value = todayInputValue();
  document.querySelectorAll('#posPay .pos-pay-btn').forEach(b => b.classList.toggle('active', b.dataset.pay === 'mpesa'));
  renderPosCart();
}
function posReceiptText(c) {
  const lines = [`*Silvarkicks* receipt`];
  c.lines.forEach(l => { lines.push(`${l.name} (${l.size}) x${l.qty}: ${fmtKsh(l.price * l.qty)}`); });
  lines.push(`Total: ${fmtKsh(c.total)}. Paid by ${c.paymentMethod === 'mpesa' ? 'M-Pesa' : 'Cash'}.`);
  if (c.balance > 0) lines.push(`Paid now: ${fmtKsh(c.paid)}. Balance owing: ${fmtKsh(c.balance)}.`);
  lines.push(`Thank you for shopping with us.`);
  return lines.join('\n');
}
function showPosReceipt(c) {
  document.getElementById('posSaleFields').style.display = 'none';
  document.getElementById('posChosen').style.display = 'none';
  document.getElementById('posCart').style.display = 'none';
  document.getElementById('posCheckout').style.display = 'none';
  document.getElementById('posItemSearch').value = '';
  const pay = c.paymentMethod === 'mpesa' ? 'M-Pesa' : 'Cash';
  const itemsHtml = c.lines.map(l => `${escapeHtml(l.name)} · ${escapeHtml(l.size)} × ${l.qty} · ${fmtKsh(l.price * l.qty)}`).join('<br>');
  const balLine = c.balance > 0 ? `<br><span class="owed-amount">Paid ${fmtKsh(c.paid)} · still owes ${fmtKsh(c.balance)}</span>` : '';
  document.getElementById('posReceiptSummary').innerHTML = `${itemsHtml}<br><strong>Total ${fmtKsh(c.total)}</strong> · paid by ${pay}${balLine}`;
  const wa = document.getElementById('posWaReceiptBtn');
  if (c.buyerPhone && c.buyerPhone.replace(/[^0-9]/g, '').length >= 9) { wa.href = `https://wa.me/${posWaPhone(c.buyerPhone)}?text=${encodeURIComponent(posReceiptText(c))}`; wa.style.display = ''; }
  else { wa.style.display = 'none'; }
  document.getElementById('posReceiptPanel').style.display = '';
}
function posPrintReceipt() {
  if (!lastPosCart) return;
  const c = lastPosCart, d = new Date(c.soldAt);
  const rows = c.lines.map(l => `<div class="rcpt-row"><span>${escapeHtml(l.name)} ${escapeHtml(l.size)} · ${l.qty} × ${fmtKsh(l.price)}</span><span>${fmtKsh(l.price * l.qty)}</span></div>`).join('');
  document.getElementById('posReceiptPrint').innerHTML = `
    <div class="rcpt">
      <div class="rcpt-head">Silvarkicks</div>
      <div class="rcpt-sub">0746 262 400</div>
      <hr>
      ${rows}
      <hr>
      <div class="rcpt-row rcpt-total"><span>TOTAL</span><span>${fmtKsh(c.total)}</span></div>
      <div class="rcpt-row"><span>Paid by</span><span>${c.paymentMethod === 'mpesa' ? 'M-Pesa' : 'Cash'}</span></div>
      ${c.balance > 0 ? `<div class="rcpt-row"><span>Paid now</span><span>${fmtKsh(c.paid)}</span></div><div class="rcpt-row rcpt-total"><span>BALANCE OWING</span><span>${fmtKsh(c.balance)}</span></div>` : ''}
      <div class="rcpt-date">${d.toLocaleString('en-GB')}</div>
      <div class="rcpt-foot">Thank you for shopping with us!</div>
    </div>`;
  window.print();
}
async function recordPosSale() {
  if (!posCart.length) { showToast('Add at least one item to the basket.'); return; }
  const name = document.getElementById('posBuyerName').value.trim();
  const phone = document.getElementById('posBuyerPhone').value.trim().replace(/[^0-9+]/g, '');
  const note = document.getElementById('posNotes').value.trim();
  const soldAt = soldAtFromDateInput(document.getElementById('posDate').value);
  const method = posPayMethod;
  const t = posCartTotals();
  if (t.balance > 0 && phone.replace(/[^0-9]/g, '').length < 9) {
    if (!await confirmAction("No phone saved for this customer. Without a phone you can't track or collect this balance under their name. Save the sale anyway?", 'Save anyway')) return;
  }
  const lines = posCart.slice();
  const btn = document.getElementById('posRecordBtn'); btn.disabled = true;
  try {
    await apiMutateAndPublish(() => {
      for (const l of lines) {
        const bag = bags.find(b => b.id === l.bagId); if (!bag) continue;
        if (bag.stock && bag.stock[l.size] !== undefined) bag.stock[l.size] = Math.max(0, bag.stock[l.size] - l.qty);
        if (!bag.sales) bag.sales = [];
        bag.sales.push({ size: l.size, qty: l.qty, salePrice: l.price, amountPaid: l.amountPaid, paymentMethod: method, channel: 'shop', buyerName: name, buyerPhone: phone, notes: note, soldAt });
      }
      if (phone.replace(/[^0-9]/g, '').length >= 9) {
        if (!Array.isArray(clients)) clients = [];
        const norm = phone.replace(/[^0-9]/g, '');
        const existing = clients.find(c => String(c.phone).replace(/[^0-9]/g, '') === norm);
        if (existing) { if (name) existing.name = name; }
        else clients.push({ id: 'c_' + Date.now(), name: name || '', phone, note, createdAt: soldAt });
      }
    });
    lastPosCart = { lines, buyerName: name, buyerPhone: phone, paymentMethod: method, soldAt, total: t.total, paid: t.paid, balance: t.balance };
    posCart = [];
    renderList(); renderDashboard(); renderInventory();
    if (typeof renderClients === 'function') renderClients();
    showPosReceipt(lastPosCart);
    showToast(t.balance > 0 ? `Sold ${lines.length} item(s) · ${fmtKsh(t.paid)} paid, ${fmtKsh(t.balance)} owed` : `Sold ${lines.length} item(s) · ${fmtKsh(t.total)}`);
  } catch (e) { showToast('Error: ' + e.message); }
  finally { btn.disabled = false; }
}
// Add an item to the POS basket from the per-item Sell modal, then jump to Sell-in-store.
function posAddLine(line) { posCart.push(line); renderPosCart(); }
document.getElementById('posItemSearch')?.addEventListener('input', e => { posItemId = ''; document.getElementById('posSaleFields').style.display = 'none'; document.getElementById('posChosen').style.display = 'none'; posRenderResults(e.target.value.trim()); });
document.getElementById('posItemResults')?.addEventListener('click', e => { const opt = e.target.closest('.client-item-opt'); if (opt) posSelectItem(opt.dataset.id); });
document.getElementById('posChosen')?.addEventListener('click', e => { if (e.target.id === 'posClearItem') posCancelItem(); });
document.getElementById('posAddBtn')?.addEventListener('click', posAddToBasket);
document.getElementById('posCancelItemBtn')?.addEventListener('click', posCancelItem);
document.getElementById('posCartList')?.addEventListener('click', e => { const b = e.target.closest('.pos-cart-rm'); if (!b) return; posCart.splice(parseInt(b.dataset.idx, 10), 1); renderPosCart(); });
document.getElementById('posPay')?.addEventListener('click', e => { const b = e.target.closest('.pos-pay-btn'); if (!b) return; posPayMethod = b.dataset.pay; document.querySelectorAll('#posPay .pos-pay-btn').forEach(x => x.classList.toggle('active', x === b)); });
document.getElementById('posRecordBtn')?.addEventListener('click', recordPosSale);
document.getElementById('posCancelBtn')?.addEventListener('click', posReset);
document.getElementById('posNewSaleBtn')?.addEventListener('click', posReset);
document.getElementById('posPrintReceiptBtn')?.addEventListener('click', posPrintReceipt);

checkAuth();

// ===== Mobile-safe collapsible toggles (fleet rollout 2026-06-11) =====
// Drive each <details> from JS (preventDefault + flip .open). A <summary> with
// display:flex breaks native <details> toggling in Safari / mobile WebKit; JS
// ownership sidesteps it. See CATALOG-STANDARDS.md.
(function () {
  var manualEntry = document.getElementById('manualEntry');
  var manualSummary = document.getElementById('manualEntryDivider');
  if (manualSummary) manualSummary.addEventListener('click', function (e) { e.preventDefault(); if (manualEntry) manualEntry.open = !manualEntry.open; });
  var addLink = document.querySelector('.admin-nav a[href="#addForm"]');
  if (addLink) addLink.addEventListener('click', function () { if (manualEntry) manualEntry.open = true; });

  var broadcastCollapse = document.getElementById('broadcastCollapse');
  var broadcastSummary = broadcastCollapse ? broadcastCollapse.querySelector('summary.dash-summary') : null;
  if (broadcastSummary) broadcastSummary.addEventListener('click', function (e) { e.preventDefault(); broadcastCollapse.open = !broadcastCollapse.open; });
  var bcLink = document.querySelector('.admin-nav a[href="#broadcastDash"]');
  if (bcLink) bcLink.addEventListener('click', function () { if (broadcastCollapse) broadcastCollapse.open = true; });
})();
