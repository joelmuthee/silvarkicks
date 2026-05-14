// Silvarkicks Store Admin
const ADMIN_PASSWORD = 'silvar123';
const API_BASE = 'https://silvarkicks-api.stawisystems.workers.dev';
const ADMIN_TOKEN = atob('b0Nxa3VCRTYybExnSnNseUtqVnZCSUtnZHRzZC1uU3RXNWtvNmQxajZJSQ==');
const SITE_URL = 'https://silvarkicks.essenceautomations.com';
const UK_SIZE_FIXED = ['UK4','UK5','UK6','UK7','UK8','UK9','UK10','UK11','UK12','UK13'];

let bags = [];
let settings = {};
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
function login() {
  if (loginPassword.value === ADMIN_PASSWORD) {
    sessionStorage.setItem('silvar_auth', '1');
    loginError.style.display = 'none';
    checkAuth();
  } else {
    loginError.style.display = 'block';
  }
}
document.getElementById('logoutBtn').addEventListener('click', () => {
  sessionStorage.removeItem('silvar_auth');
  location.reload();
});

// ====== API ======
async function apiUploadImage(base64, ext) {
  const res = await fetch(`${API_BASE}/api/image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ADMIN_TOKEN}` },
    body: JSON.stringify({ base64, ext }),
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `Upload failed: ${res.status}`); }
  const data = await res.json();
  return `${API_BASE}${data.path}`;
}

async function apiPublish() {
  const res = await fetch(`${API_BASE}/api/bulk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ADMIN_TOKEN}` },
    body: JSON.stringify({ bags, settings }),
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `Save failed: ${res.status}`); }
}

async function loadData() {
  const res = await fetch(`${API_BASE}/api/bags?_=${Date.now()}`);
  const json = await res.json();
  bags = json.bags || [];
  settings = json.settings || {};
}

// ====== HELPERS ======
const toast = document.getElementById('toast');
function showToast(msg) { toast.textContent = msg; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 2800); }

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
const imageInput = document.getElementById('imageInput');
const imagePreview = document.getElementById('imagePreview');
imageInput.addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = reader.result;
    stagedImage = { base64: dataUrl.split(',')[1], ext, dataUrl };
    imagePreview.innerHTML = `<img src="${dataUrl}" style="max-width:180px;border-radius:8px;margin-top:4px;">`;
  };
  reader.readAsDataURL(file);
});

const extraImagesInput = document.getElementById('extraImagesInput');
const extraImagesPreview = document.getElementById('extraImagesPreview');

function readFileAsStaged(file) {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      resolve({ base64: dataUrl.split(',')[1], ext, dataUrl });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

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
      const blob = await r.blob();
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result;
          resolve({ base64: dataUrl.split(',')[1], ext: 'jpg', dataUrl });
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
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
  const cat = document.getElementById('categoryInput').value;
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
    Loafers: 'loafers', Formal: 'formal shoes', Heels: 'heels',
    Sandals: 'sandals', Slides: 'slides',
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
  const category = document.getElementById('categoryInput').value || '';
  const reel = document.getElementById('reelInput')?.value.trim() || '';
  const stock = getStockFromForm();

  if (!name) { showToast('Item name is required.'); return; }
  if (priceRaw !== '' && (isNaN(priceParsed) || priceParsed < 0)) { showToast('Enter a valid price (or leave blank).'); return; }

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
      const bag = bags.find(b => b.id === editingId);
      if (!bag) return;
      bag.name = name;
      bag.category = category;
      bag.description = desc;
      bag.price = price;
      if (reel) bag.reel = reel; else delete bag.reel;
      bag.stock = stock;
      bag.images = extraUrls.length ? [imagePath || bag.image, ...extraUrls] : (imagePath ? [imagePath] : (bag.images || []));
      if (bag.images.length) bag.images = bag.images.filter((u, i, a) => u && a.indexOf(u) === i);
      if (imagePath) bag.image = imagePath;
      await apiPublish();
      showToast('Item updated and live.');
    } else {
      if (!stagedImage) { showToast('Add an item image.'); setSaving(false); return; }
      const id = 'item_' + Date.now();
      const newBag = { id, name, category, description: desc, price, stock, sales: [], image: imagePath, createdAt: new Date().toISOString() };
      if (extraUrls.length) newBag.images = [imagePath, ...extraUrls];
      if (reel) newBag.reel = reel;
      bags.unshift(newBag);
      await apiPublish();
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

function resetForm() {
  editingId = null;
  document.getElementById('editingId').value = '';
  document.getElementById('nameInput').value = '';
  document.getElementById('categoryInput').value = '';
  document.getElementById('descInput').value = '';
  document.getElementById('priceInput').value = '';
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
}

function editItem(id) {
  const bag = bags.find(b => b.id === id);
  if (!bag) return;
  editingId = id;
  document.getElementById('editingId').value = id;
  document.getElementById('nameInput').value = bag.name;
  document.getElementById('categoryInput').value = bag.category || '';
  document.getElementById('descInput').value = bag.description || '';
  document.getElementById('priceInput').value = bag.price;
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
  document.getElementById('formTitle').scrollIntoView({ behavior: 'auto', block: 'start' });
}

async function deleteItem(id) {
  if (!confirm('Delete this item? This cannot be undone.')) return;
  bags = bags.filter(b => b.id !== id);
  try {
    await apiPublish();
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
  buyerName.value = '';
  buyerPhone.value = '';
  buyerNotes.value = '';
  saleModal.style.display = 'flex';
  buyerName.focus();
}

function closeSaleModal() { saleModal.style.display = 'none'; pendingSaleId = null; }

document.getElementById('saleSaveBtn').addEventListener('click', async () => {
  const bag = bags.find(b => b.id === pendingSaleId);
  if (!bag) return;
  const size = saleSizeInput.value;
  const qty = parseInt(saleQtyInput.value, 10) || 1;
  const salePrice = parseInt(salePriceInput.value, 10) || bag.price;

  // Thrift: a sold piece is gone. Zero the stock for that size; no restock.
  if (bag.stock && bag.stock[size] !== undefined) {
    bag.stock[size] = Math.max(0, bag.stock[size] - qty);
  }

  if (!bag.sales) bag.sales = [];
  bag.sales.push({
    size, qty, salePrice,
    buyerName: buyerName.value.trim(),
    buyerPhone: buyerPhone.value.trim(),
    notes: buyerNotes.value.trim(),
    soldAt: new Date().toISOString(),
  });

  closeSaleModal();
  try {
    await apiPublish();
    renderList();
    renderDashboard();
    renderInventory();
    showToast(`Sale recorded: ${qty}× ${size}.`);
    if (buyerName.value.trim() || buyerPhone.value.trim()) sendBuyerToGHL(bag, bag.sales[bag.sales.length - 1]);
  } catch (err) { showToast('Error: ' + err.message); }
});

document.getElementById('saleSkipBtn')?.addEventListener('click', async () => {
  // One-click thrift sale: no buyer info, qty 1, first available size.
  const bag = bags.find(b => b.id === pendingSaleId);
  if (!bag) return;
  const size = saleSizeInput.value || 'One size';

  if (bag.stock && bag.stock[size] !== undefined) {
    bag.stock[size] = Math.max(0, bag.stock[size] - 1);
  }
  if (!bag.sales) bag.sales = [];
  bag.sales.push({
    size, qty: 1, salePrice: bag.price,
    buyerName: '', buyerPhone: '', notes: '',
    soldAt: new Date().toISOString(),
  });

  closeSaleModal();
  try {
    await apiPublish();
    renderList();
    renderDashboard();
    renderInventory();
    showToast(`Marked sold.`);
  } catch (err) { showToast('Error: ' + err.message); }
});

document.getElementById('saleCancelBtn').addEventListener('click', closeSaleModal);
saleModal.addEventListener('click', e => { if (e.target === saleModal) closeSaleModal(); });

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

  document.getElementById('kpiGrid').innerHTML = buckets.map(b => `
    <div class="kpi-card">
      <div class="kpi-label">${b.label}</div>
      <div class="kpi-count">${b.count} <span class="kpi-unit">units</span></div>
      <div class="kpi-revenue">${fmtKsh(b.revenue)}</div>
    </div>`).join('');

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
  const recent = allSaleRecords.sort((a, b) => new Date(b.s.soldAt) - new Date(a.s.soldAt)).slice(0, 6);
  document.getElementById('recentSales').innerHTML = recent.length
    ? recent.map(({ bag, s }) => `
        <div class="recent-row">
          <img src="${bag.image}" alt="${escapeHtml(bag.name)}">
          <div>
            <div class="recent-name">${escapeHtml(bag.name)} · ${escapeHtml(s.size || '')} × ${s.qty || 1}</div>
            <div class="recent-meta">${fmtKsh(s.salePrice || bag.price)} · ${s.buyerName ? escapeHtml(s.buyerName) : 'No buyer saved'} · ${relTime(s.soldAt)}</div>
          </div>
        </div>`).join('')
    : '<p style="color:#999;font-size:13px;">No sales recorded yet.</p>';
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

  document.getElementById('invTableBody').innerHTML = sorted.map(bag => {
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

    return `
    <tr>
      <td><img class="item-img" src="${bag.image}" alt="${escapeHtml(bag.name)}"></td>
      <td>
        <div style="font-weight:600;font-size:13px;">${escapeHtml(bag.name)}</div>
        <div style="font-size:11px;color:#999;margin-top:2px;">${soldUnits} sold, ${fmtKsh(totalRevenue(bag))} revenue</div>
      </td>
      <td style="font-size:13px;">${escapeHtml(bag.category || '-')}</td>
      <td style="font-size:13px;font-weight:600;">${fmtKsh(bag.price)}</td>
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
  if (!confirm(`Delete ${bulkSelected.size} item(s)? This cannot be undone.`)) return;
  bags = bags.filter(b => !bulkSelected.has(b.id));
  bulkSelected.clear();
  try {
    await apiPublish();
    renderList(); renderInventory(); renderDashboard();
    showToast(`Deleted.`);
  } catch (err) { showToast('Sync failed: ' + err.message); }
}

async function bulkSetCategory() {
  const cat = prompt('Set category for selected items to:\n(use exact name e.g. Sneakers, Boots, Loafers, Sandals)');
  if (!cat) return;
  bags.forEach(b => { if (bulkSelected.has(b.id)) b.category = cat; });
  try {
    await apiPublish();
    renderList(); renderInventory();
    showToast(`Set ${bulkSelected.size} item(s) to "${cat}".`);
    bulkSelected.clear();
    renderList();
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
window.bulkClear = bulkClear;
window.bulkSelectAll = bulkSelectAll;
window.bulkDelete = bulkDelete;
window.bulkSetCategory = bulkSetCategory;

// ====== WHATSAPP BROADCAST ======
let broadcastSelectedIds = [];
let broadcastRecipientsState = {};

function pastBuyers() {
  const map = new Map();
  for (const bag of bags) {
    for (const s of (bag.sales || [])) {
      if (!s.buyerPhone) continue;
      const phone = String(s.buyerPhone).replace(/[^0-9]/g, '');
      if (phone.length < 9) continue;
      const existing = map.get(phone);
      const soldAt = new Date(s.soldAt || 0).getTime();
      if (!existing || soldAt > existing.soldAt) {
        map.set(phone, { phone, name: s.buyerName || '', soldAt, lastBought: bag.name });
      }
    }
  }
  return [...map.values()].sort((a, b) => b.soldAt - a.soldAt);
}

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
  const buyers = pastBuyers();
  for (const b of buyers) {
    if (!(b.phone in broadcastRecipientsState)) {
      broadcastRecipientsState[b.phone] = { name: b.name, included: true };
    }
  }
  if (!buyers.length) {
    wrap.innerHTML = '<p style="color:var(--ink-faint);font-size:13px;padding:8px 0;">No past buyers yet. Once you record sales with buyer phones, they\'ll show up here.</p>';
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
  return `${greet}It's Silvarkicks Store. ${subject || 'Fresh kicks just landed.'}${itemsBlock}\n\nTap to browse: ${SITE_URL}\n\nReply here to enquire.`;
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

document.getElementById('broadcastStartBtn')?.addEventListener('click', () => {
  const recipients = pastBuyers().filter(b => broadcastRecipientsState[b.phone]?.included);
  if (!recipients.length) { showToast('Pick at least one recipient.'); return; }
  if (!confirm(`Open ${recipients.length} WhatsApp window${recipients.length === 1 ? '' : 's'}, one per buyer. Send each one manually. OK?`)) return;
  let i = 0;
  function next() {
    if (i >= recipients.length) {
      document.getElementById('broadcastStatus').textContent = `Opened ${recipients.length} WhatsApp window${recipients.length === 1 ? '' : 's'}.`;
      return;
    }
    const r = recipients[i++];
    const msg = buildBroadcastMessage(r.name);
    window.open(`https://wa.me/${r.phone}?text=${encodeURIComponent(msg)}`, '_blank');
    document.getElementById('broadcastStatus').textContent = `Opening ${i} of ${recipients.length}…`;
    setTimeout(next, 700);
  }
  next();
});

async function init() {
  showToast('Loading…');
  await loadData();
  renderList();
  renderDashboard();
  renderInventory();
  renderBroadcastSelected();
  renderBroadcastPicker();
  renderBroadcastRecipients();
  renderBroadcastPreview();
}

checkAuth();
