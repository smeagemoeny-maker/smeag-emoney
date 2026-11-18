// ===== SMEAG CAFE (cafe POS) - app logic, backed by the e-money API (data.js) =====
var $ = function (id) { return document.getElementById(id); };
var money = function (n) { return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
var uniq = function (arr) { return Array.from(new Set(arr.filter(Boolean))).sort(); };
var round2 = function (n) { return Math.round(Number(n || 0) * 100) / 100; };
var upper = function (s) { return String(s || '').toUpperCase(); };

// In-memory cache of what the API returned.
var db = {
  products: [],       // products of every campus this account may use (deduped by id)
  campusIds: {},      // campus -> Set of product ids the API lists for that campus
  buyers: [],         // last Buyer Info search result
  sales: [],          // POS sale lines for the history/report range
};
// cart: [{id, qty}]; confirm: tapped card {uid, loading, person, error} waiting for Pay / Cancel
var state = { discount: 0, discountLabel: 'No Discount', cart: [], confirm: null, awaitingTap: false, paying: false, error: '' };

function toast(msg, isError) {
  var t = $('toast');
  t.textContent = msg;
  t.className = 'toast show' + (isError ? ' error' : '');
  clearTimeout(toast._t);
  toast._t = setTimeout(function () { t.className = 'toast'; }, isError ? 4000 : 2200);
}
function showDialog(html) { $('dialogBody').innerHTML = html; $('dialog').showModal(); }
function fail(e) { console.error(e); toast(e && e.message ? e.message : String(e), true); }

// Disable a button while an API call runs (no double checkout / double save).
async function busy(btn, fn) {
  if (btn && btn.disabled) return;
  if (btn) btn.disabled = true;
  try { return await fn(); }
  catch (e) { fail(e); }
  finally { if (btn) btn.disabled = false; }
}

function todayStr(offsetDays) {
  var d = new Date();
  d.setDate(d.getDate() + (offsetDays || 0));
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
function fmtDate(s) { // bank dates are "YYYY-MM-DD HH:MM:SS" (Philippine wall-clock)
  var d = new Date(String(s).replace(' ', 'T'));
  return isNaN(d) ? String(s) : d.toLocaleString();
}

// ===== Session / campuses =====
function session() { return API.session; }
function manager() { return (session() && session().manager) || {}; }
function access() { return (session() && session().access) || { cafeCampuses: [] }; }
function campuses() { return access().cafeCampuses || []; }
function normCampus(c) { // 'CAPITAL' / 'Talrac' -> 'Capital' / 'Tarlac' when it is a cafe campus
  var u = upper(c) === 'TALRAC' ? 'TARLAC' : upper(c);
  var hit = ['Capital', 'Encanto', 'Tarlac'].concat(campuses()).find(function (x) { return upper(x) === u; });
  return hit || c || '-';
}
function sellCampus() { return $('fCampus').value || campuses()[0]; }
// Every tab (Sales, Product Registration, History, Report) shows only the logged-in store's data.
function storeCampuses() { var c = sellCampus(); return c ? [c] : []; }

// ===== Header / theme / tabs =====
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $('themeToggle').textContent = theme === 'dark' ? 'Light' : 'Dark';
  try { localStorage.setItem('smeag-theme', theme); } catch (e) { /* ignore */ }
}
var savedTheme = 'dark';
try { savedTheme = localStorage.getItem('smeag-theme') || 'dark'; } catch (e) { /* ignore */ }
applyTheme(savedTheme);
$('themeToggle').onclick = function () { applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); };

function activeTab() { var b = document.querySelector('.tab.active'); return b ? b.dataset.tab : 'sales'; }
document.querySelectorAll('.tab').forEach(function (btn) {
  btn.onclick = function () {
    document.querySelectorAll('.tab').forEach(function (b) { b.classList.toggle('active', b === btn); });
    document.querySelectorAll('.tab-page').forEach(function (p) { p.classList.toggle('active', p.id === 'tab-' + btn.dataset.tab); });
    renderTab(btn.dataset.tab, true);
  };
});

// ===================================================================
// LOGIN / LOGOUT
// ===================================================================
function showLogin(message) {
  document.body.classList.add('logged-out');
  $('loginError').textContent = message || '';
  $('loginId').focus();
}

$('loginForm').onsubmit = function (e) {
  e.preventDefault();
  var btn = $('loginBtn');
  busy(btn, async function () {
    $('loginError').textContent = '';
    var res;
    try {
      res = await API.login($('loginId').value.trim());
    } catch (err) {
      $('loginError').textContent = err.message;
      return;
    }
    if (!res || !res.manager) { $('loginError').textContent = 'Unknown login ID.'; return; }
    var acc = res.access || {};
    if (!(acc.stores || []).includes('cafe') || !(acc.cafeCampuses || []).length) {
      $('loginError').textContent = 'This account cannot use the cafe POS. Use the Pusan Mart program instead.';
      return;
    }
    API.saveSession({ token: res.token, manager: res.manager, access: acc });
    startApp();
  });
};

$('logoutBtn').onclick = function () {
  if (state.cart.length && !confirm('The cart is not empty. Log out anyway?')) return;
  API.saveSession(null);
  $('fCampus').innerHTML = ''; $('fCategory').value = ''; $('fSub').value = '';
  resetSale();
  db.products = []; db.campusIds = {}; db.buyers = []; db.sales = []; salesCache.key = '';
  renderProducts(); renderProductTab(); drawBuyers();
  $('historyTable').innerHTML = ''; $('reportStats').innerHTML = '';
  showLogin('');
};

// ===== Store info / switch store (opened by tapping "SMEAG CAFE") =====
// Each login ID belongs to a store. To move to another store, pick it and enter that store's ID.
var CAFE_STORES = ['Capital', 'Encanto', 'Tarlac'];
function storeDialog(pick, error) {
  var m = manager(), cur = sellCampus();
  var rows = CAFE_STORES.map(function (c) {
    var isCur = c === cur, isPick = c === pick;
    return '<button type="button" class="store-row' + (isCur ? ' current' : '') + (isPick ? ' picked' : '') + '" data-store="' + esc(c) + '">' +
      '<span class="store-name">' + esc(c) + ' Cafe</span>' +
      '<span class="store-tag">' + (isCur ? '● Current' : isPick ? 'Selected' : 'Switch') + '</span></button>';
  }).join('');
  var switchForm = pick && pick !== cur
    ? '<form id="storeSwitch" class="form store-switch">' +
        '<label>Login ID for ' + esc(pick) + ' Cafe<input id="storeLoginId" class="input" autocomplete="username" required /></label>' +
        '<div id="storeError" class="login-error">' + esc(error || '') + '</div>' +
        '<button type="submit" class="btn btn-green full">Switch to ' + esc(pick) + ' Cafe</button>' +
      '</form>'
    : '';
  showDialog(
    '<div class="label">Store</div>' +
    '<div class="store-line">' + esc(cur) + ' Cafe · ' + esc(m.name || m.login_id || '-') + ' · ' + esc(m.position || '-') + '</div>' +
    '<div class="store-list">' + rows + '</div>' + switchForm
  );
  document.querySelectorAll('#dialogBody [data-store]').forEach(function (b) {
    b.onclick = function () { storeDialog(b.dataset.store === cur ? null : b.dataset.store); };
  });
  var form = $('storeSwitch');
  if (form) {
    $('storeLoginId').focus();
    form.onsubmit = function (e) {
      e.preventDefault();
      busy(form.querySelector('button[type=submit]'), function () { return switchStore(pick, $('storeLoginId').value.trim()); });
    };
  }
}

async function switchStore(campus, loginId) {
  var showErr = function (msg) { $('storeError').textContent = msg; };
  var res;
  try { res = await API.login(loginId); } catch (err) { showErr(err.message); return; }
  if (!res || !res.manager) { showErr('Unknown login ID.'); return; }
  var acc = res.access || {};
  if (!(acc.stores || []).includes('cafe') || !(acc.cafeCampuses || []).includes(campus)) {
    showErr('This ID is not registered for ' + campus + ' Cafe.');
    return;
  }
  if (state.cart.length && !confirm('Switching store clears the cart. Continue?')) return;
  API.saveSession({ token: res.token, manager: res.manager, access: acc, campus: campus });
  resetSale();
  db.products = []; db.campusIds = {}; db.buyers = []; db.sales = []; salesCache.key = '';
  $('fCategory').value = ''; $('fSub').value = '';
  $('dialog').close();
  startApp();
  toast('Switched to ' + campus + ' Cafe (' + (res.manager.name || res.manager.login_id) + ')');
}
$('storeBtn').onclick = function () { if (session()) storeDialog(null); };

API.onUnauthorized = function (msg) { showLogin(msg || 'Please log in again.'); };

function startApp() {
  var m = manager();
  document.body.classList.remove('logged-out');
  // The store is fixed by the login ID: the account's own campus, or the store picked when the
  // ID was entered in the store dialog (session.campus). The (hidden) fCampus select keeps it.
  // Never reuse the previous login's fCampus value (logout -> login with another store's ID).
  var allowed = campuses();
  var mine = normCampus(session().campus || m.campus);
  var store = allowed.includes(mine) ? mine : allowed[0];
  $('fCampus').innerHTML = store ? '<option>' + esc(store) + '</option>' : '';
  $('fCampus').value = store || '';
  $('fCampus').dataset.prev = $('fCampus').value;
  renderDiscountChips();
  // History / report default range: last 30 days.
  if (!$('hFrom').value) $('hFrom').value = todayStr(-30);
  if (!$('hTo').value) $('hTo').value = todayStr(0);
  if (!$('rFrom').value) $('rFrom').value = todayStr(-30);
  if (!$('rTo').value) $('rTo').value = todayStr(0);
  renderCart();
  renderTab(activeTab(), true);
}

// ===================================================================
// PRODUCTS (shared by Sales / Product Registration / Report)
// ===================================================================
var productsLoading = null;
function loadProducts() {
  if (productsLoading) return productsLoading;
  productsLoading = (async function () {
    var list = storeCampuses();
    var results = await Promise.all(list.map(function (c) { return API.products(c); }));
    var byId = new Map();
    var ids = {};
    results.forEach(function (rows, i) {
      ids[list[i]] = new Set(rows.map(function (p) { return p.id; }));
      rows.forEach(function (p) { byId.set(p.id, p); });
    });
    db.products = Array.from(byId.values());
    db.campusIds = ids;
    // drop cart lines whose product disappeared
    state.cart = state.cart.filter(function (l) { return byId.has(l.id); });
  })();
  return productsLoading.finally(function () { productsLoading = null; });
}
function findProduct(id) { return db.products.find(function (x) { return x.id === id; }); }
function campusProducts(c) {
  var set = db.campusIds[c];
  return set ? db.products.filter(function (p) { return set.has(p.id); }) : [];
}

// ===================================================================
// SALES  (same flow as the PUSAN Mart screen: pick products → tap card → check student info → Pay)
// ===================================================================
function fillSelect(sel, values, keep) {
  if (keep === undefined) keep = true;
  var prev = sel.value;
  sel.innerHTML = '<option value="">All</option>' + values.map(function (v) { return '<option>' + esc(v) + '</option>'; }).join('');
  if (keep && values.includes(prev)) sel.value = prev;
}

function refreshFilters() {
  var byCampus = campusProducts(sellCampus());
  fillSelect($('fCategory'), uniq(byCampus.map(function (p) { return p.category; })));
  var byCat = byCampus.filter(function (p) { return !$('fCategory').value || p.category === $('fCategory').value; });
  fillSelect($('fSub'), uniq(byCat.map(function (p) { return p.sub; })));
}

// Search matches the product name or its category (like PUSAN Mart). Sold-out items go last.
function filteredProducts() {
  var cat = $('fCategory').value, sub = $('fSub').value;
  var q = $('fName').value.trim().toLowerCase();
  return campusProducts(sellCampus()).filter(function (p) {
    return (!cat || p.category === cat) && (!sub || p.sub === sub) &&
      (!q || p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q));
  }).sort(function (a, b) {
    return (a.stock <= 0) - (b.stock <= 0) || a.category.localeCompare(b.category) || a.name.localeCompare(b.name);
  });
}

function renderProducts() {
  var list = filteredProducts();
  $('productCount').textContent = list.length;
  $('productGrid').innerHTML = list.length ? list.map(function (p) {
    var out = p.stock <= 0;
    var badge = out ? '<span class="badge out">Sold out</span>' : '<span class="badge ' + (p.stock <= 10 ? 'low' : '') + '">' + p.stock + '</span>';
    return '<div class="product-card ' + (out ? 'out' : '') + '" data-id="' + p.id + '" title="' + esc(p.category) + ' / ' + esc(p.sub) + '">' +
      badge +
      '<div class="name">' + esc(p.name) + '</div>' +
      '<div class="campus">' + esc(p.category || p.campus) + '</div>' +
      '<div class="price">₱' + money(p.price) + '</div>' +
    '</div>';
  }).join('') : '<div class="empty">' + (productsLoading ? 'Loading…' : 'No products match the selected filters.') + '</div>';
}

$('productGrid').onclick = function (e) {
  var card = e.target.closest('.product-card');
  if (card) addToCart(Number(card.dataset.id));
};

$('fCampus').onchange = function () {
  // A sale belongs to one campus: switching campus starts a new cart.
  if (state.cart.length) {
    if (!confirm('Switching campus clears the cart. Continue?')) { $('fCampus').value = $('fCampus').dataset.prev; return; }
    state.cart = []; renderCart();
  }
  $('fCampus').dataset.prev = $('fCampus').value;
  $('fCategory').value = ''; $('fSub').value = '';
  renderDiscountChips();
  refreshFilters(); renderProducts(); renderCart();
};
['fCategory', 'fSub'].forEach(function (id) { $(id).onchange = function () { refreshFilters(); renderProducts(); }; });
$('fName').oninput = renderProducts;
// Enter in the search box adds the product when the name matches exactly (or only one product is left).
$('fName').onkeydown = function (e) {
  if (e.key !== 'Enter') return;
  var q = $('fName').value.trim().toLowerCase();
  if (!q) return;
  var list = filteredProducts().filter(function (x) { return x.stock > 0; });
  var p = list.find(function (x) { return x.name.toLowerCase() === q; }) || (list.length === 1 ? list[0] : null);
  if (p) { addToCart(p.id); $('fName').value = ''; renderProducts(); }
};

// Short UI sounds (Web Audio, no files). ok = two rising notes, error = one low buzz.
var audioCtx = null;
function beep(kind) {
  try {
    var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    audioCtx = audioCtx || new AC();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    var notes = kind === 'error' ? [[220, 0, 0.22, 'square']] : [[880, 0, 0.08, 'sine'], [1320, 0.07, 0.1, 'sine']];
    notes.forEach(function (n) {
      var o = audioCtx.createOscillator(), g = audioCtx.createGain(), t = audioCtx.currentTime + n[1];
      o.type = n[3]; o.frequency.value = n[0];
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + n[2]);
      o.connect(g); g.connect(audioCtx.destination); o.start(t); o.stop(t + n[2] + 0.02);
    });
  } catch (e) { /* sound is optional */ }
}

function addToCart(id) {
  var p = findProduct(id);
  if (!p) return;
  var line = state.cart.find(function (l) { return l.id === id; });
  var inCart = line ? line.qty : 0;
  if (p.stock <= 0) { beep('error'); return toast('Out of stock', true); }
  if (inCart + 1 > p.stock) { beep('error'); return toast('Not enough stock: ' + p.name + ' (in stock: ' + p.stock + ')', true); }
  if (line) line.qty++; else state.cart.push({ id: id, qty: 1 });
  state.error = '';
  renderCart();
}

function changeQty(id, delta) {
  var line = state.cart.find(function (l) { return l.id === id; });
  var p = findProduct(id);
  if (!line || !p) return;
  if (delta > 0 && line.qty + 1 > p.stock) { beep('error'); return toast('Not enough stock: ' + p.name + ' (in stock: ' + p.stock + ')', true); }
  line.qty += delta;
  if (line.qty <= 0) state.cart = state.cart.filter(function (l) { return l.id !== id; });
  renderCart();
}

// Same rounding as the server: each line is discounted and rounded separately.
function totals() {
  var subtotal = 0, items = 0, total = 0;
  var rate = state.discount / 100;
  state.cart.forEach(function (l) {
    var p = findProduct(l.id);
    if (!p) return;
    var line = p.price * l.qty;
    subtotal += line; items += l.qty;
    total = round2(total + round2(line - line * rate));
  });
  subtotal = round2(subtotal);
  return { subtotal: subtotal, items: items, discount: round2(subtotal - total), total: total };
}

function renderCart() {
  $('cartList').innerHTML = state.cart.length ? state.cart.map(function (l) {
    var p = findProduct(l.id);
    if (!p) return '';
    return '<div class="cart-item">' +
      '<div><div class="ci-name">' + esc(p.name) + '</div><div class="ci-sub">' + money(p.price) + ' × ' + l.qty + ' = ' + money(p.price * l.qty) + '</div></div>' +
      '<div class="qty">' +
        '<button class="btn" data-q="-1" data-id="' + p.id + '">−</button><span>' + l.qty + '</span>' +
        '<button class="btn" data-q="1" data-id="' + p.id + '">+</button>' +
        '<button class="btn btn-danger btn-sm" data-q="x" data-id="' + p.id + '">✕</button>' +
      '</div>' +
    '</div>';
  }).join('') : '<div class="muted cart-empty">Your cart is empty. Select a product.</div>';

  var t = totals();
  $('sSubtotal').textContent = money(t.subtotal);
  $('sItems').textContent = t.items;
  $('discountRow').hidden = !state.discount;
  $('sDiscLabel').textContent = state.discountLabel;
  $('sDiscount').textContent = '-' + money(t.discount);
  $('sTotal').textContent = money(t.total) + ' PHP';
  document.querySelectorAll('[data-discount]').forEach(function (b) { b.classList.toggle('sel', b.dataset.label === state.discountLabel); });
  // A card tapped with an empty cart stays selected: as soon as products are added, Pay is ready
  // (no second tap). The ✕ on the student chip or Cancel clears it.
  renderPay();
}

$('cartList').onclick = function (e) {
  var b = e.target.closest('button[data-q]');
  if (!b) return;
  var id = Number(b.dataset.id);
  if (b.dataset.q === 'x') { state.cart = state.cart.filter(function (l) { return l.id !== id; }); renderCart(); }
  else changeQty(id, Number(b.dataset.q));
};

// Discount chips depend on the campus: Capital Cafe offers Student 10% / Staff 30%;
// the other campuses offer plain 10 / 15 %. The 30% rate is accepted only for the Capital Cafe
// (pos_checkout in the DB and validateCheckoutInput check the same). Rebuilt whenever the campus changes.
function discountOptions() {
  if (upper(sellCampus()) === 'CAPITAL') {
    return [{ pct: 0, label: 'No Discount' }, { pct: 10, label: 'Student 10%' }, { pct: 30, label: 'Staff 30%' }];
  }
  return [{ pct: 0, label: 'No Discount' }, { pct: 10, label: '10%' }, { pct: 15, label: '15%' }];
}
function renderDiscountChips() {
  var opts = discountOptions();
  // Keep the chosen discount only if it still exists for this campus; otherwise reset to No Discount.
  if (!opts.some(function (o) { return o.label === state.discountLabel; })) {
    state.discount = 0; state.discountLabel = 'No Discount';
  }
  $('discountChips').innerHTML = opts.map(function (o) {
    return '<button type="button" class="chip" data-discount="' + o.pct + '" data-label="' + esc(o.label) + '">' + esc(o.label) + '</button>';
  }).join('');
}
$('discountChips').onclick = function (e) {
  var btn = e.target.closest('[data-discount]');
  if (!btn) return;
  state.discount = Number(btn.dataset.discount);
  state.discountLabel = btn.dataset.label;
  renderCart();
};

function resetSale() {
  state.cart = []; state.discount = 0; state.discountLabel = 'No Discount';
  state.confirm = null; state.awaitingTap = false; state.error = '';
  renderCart();
}

// ----- Card tap → student info → Pay (PUSAN Mart flow) -----
function isPhone() { return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || ''); }

function buyerChip() {
  var c = state.confirm; if (!c) return '';
  var x = '<button type="button" class="bx" data-pay="clear" title="Clear">✕</button>';
  if (c.loading) return '<div class="buyerchip"><div class="bi"><b>Looking up card...</b></div>' + x + '</div>';
  if (c.error) return '<div class="buyerchip err"><div class="bi"><b>' + esc(c.error) + '</b><span>' + esc(c.uid) + '</span></div>' + x + '</div>';
  var p = c.person;
  return '<div class="buyerchip"><div class="bi"><b>' + esc(p.name || '-') + '</b><span>' + esc(p.sid || '-') + '</span></div>' +
    '<div class="bm">₱' + money(p.balance) + '</div>' + x + '</div>';
}

function renderPay() {
  var row = $('buyerRow');
  row.innerHTML = buyerChip();
  row.hidden = !state.confirm;
  var c = state.confirm, total = totals().total, h;
  if (c && !c.loading && c.person && state.cart.length && !state.paying) {
    // Card tapped: the student's info is under "Sales"; the staff checks it and confirms here.
    var after = round2(c.person.balance - total), short = after < 0;
    h = '<div class="paybox">' +
      '<div class="sum-row"><span>' + esc(c.person.name || '-') + ' · ' + esc(c.person.sid || '-') + '</span><span>Balance ₱' + money(c.person.balance) + '</span></div>' +
      '<div class="sum-row"><span>After payment</span><b' + (short ? ' class="neg"' : '') + '>₱' + money(after) + '</b></div>' +
      (short ? '<div class="pay-error">Insufficient balance.</div>' : '') +
      '<div class="payacts"><button type="button" class="btn" data-pay="cancel">Cancel</button>' +
      '<button type="button" class="btn btn-green" data-pay="pay"' + (short ? ' disabled' : '') + '>Pay ₱' + money(total) + '</button></div></div>';
  } else {
    var enabled = !state.paying, wait = state.awaitingTap || state.paying;
    var where = isPhone() ? 'on the back of the phone' : 'on the card reader';
    h = '<div class="nfcbox' + (wait ? ' wait' : '') + (enabled ? ' enabled' : '') + '"' + (enabled ? ' data-pay="wait"' : '') + '>' +
      '<div class="ic">📶</div>' +
      '<div class="nfc-main">' + (state.paying ? 'Processing payment...' : state.awaitingTap ? 'Please tap your NFC card...' : 'Tap your NFC card ' + where) + '</div>' +
      '<div class="nfc-sub">' + (c && c.person && !state.cart.length ? 'Student selected: add products, then press Pay' : state.cart.length ? 'Check the student info, then confirm payment' : 'Empty cart: tap to check student info and balance') + '</div></div>';
  }
  $('payArea').innerHTML = h;
  $('checkoutError').textContent = state.error || '';
}

function onPayClick(e) {
  var b = e.target.closest('[data-pay]');
  if (!b || b.disabled) return;
  var a = b.dataset.pay;
  if (a === 'clear' || a === 'cancel') { state.confirm = null; renderPay(); }
  else if (a === 'wait') { state.error = ''; state.awaitingTap = true; renderPay(); }
  else if (a === 'pay' && state.confirm && state.confirm.person) {
    var uid = state.confirm.uid; state.confirm = null; payWithCard(uid);
  }
}
$('payArea').onclick = onPayClick;
$('buyerRow').onclick = onPayClick;

// Every NFC tap (phone NFC, USB keyboard reader, ACR122U bridge) lands here.
function onCardTap(uid) {
  uid = String(uid || '').trim();
  if (!uid || !session()) return;
  if ($('dialog').open) return;
  var tab = activeTab();
  if (tab === 'buyers') { $('bySearch').value = uid; renderBuyers(); return; }
  if (tab !== 'sales') return toast('Card read (' + uid + '). Open Sales or Buyer Info to use this card.');
  if (state.paying) return toast('Processing payment... please wait.');
  state.awaitingTap = false;
  showPayConfirm(uid); // empty cart: shows the student now; Pay appears as soon as products are added
}

async function showPayConfirm(uid) {
  var c = { uid: uid, loading: true, person: null, error: null };
  state.confirm = c; state.error = ''; beep('ok'); renderPay();
  try {
    c.person = await API.personByUid(uid);
    if (!c.person) c.error = 'This NFC card is not registered.';
  } catch (e) {
    c.error = 'An error occurred during lookup: ' + e.message;
  }
  c.loading = false;
  if (c.error) beep('error');
  if (state.confirm !== c) return; // cleared or replaced by a newer tap
  renderPay();
  if (!c.error) $('payArea').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); // bring Pay / Cancel into view
}

async function payWithCard(uid) {
  if (!state.cart.length || state.paying) return;
  var t = totals(), campus = sellCampus();
  var items = state.cart.map(function (l) {
    var p = findProduct(l.id);
    return { productId: p.id, name: p.name, category: p.category, price: p.price, qty: l.qty };
  });
  var label = state.discountLabel, pct = state.discount;
  state.paying = true; state.error = ''; renderPay();
  var res;
  try {
    res = await API.checkout({
      uid: uid, store: 'cafe', campus: campus,
      cart: items.map(function (i) { return { productId: i.productId, quantity: i.qty }; }),
      discountLabel: label, discountRate: pct / 100,
    });
  } catch (e) {
    state.paying = false;
    var msg = e.message;
    if (!e.status || e.status >= 500) msg = 'An error occurred during checkout: ' + e.message;
    else if (/insufficient balance/i.test(e.message)) {
      try {
        var p = await API.personByUid(uid);
        if (p) msg = 'Insufficient balance. (Current balance: ₱' + money(p.balance) + ', required: ₱' + money(t.total) + ')';
      } catch (e2) { /* keep the server message */ }
    } else if (/^Insufficient stock/i.test(e.message)) {
      await loadProducts().catch(function () {});
      refreshFilters(); renderProducts();
    }
    beep('error');
    state.error = msg; renderCart();
    return;
  }
  state.paying = false;
  showReceipt({
    no: receiptNo(res.orderId, null),
    date: new Date().toISOString(),
    buyerName: res.buyerName || uid,
    seller: manager().name || manager().login_id,
    items: items,
    subtotal: t.subtotal, discountPct: pct,
    discount: round2(t.subtotal - res.finalTotal), total: res.finalTotal,
    balanceAfter: res.remainingBalance,
  });
  resetSale();
  salesCache.key = ''; // history / report must reload
  await loadProducts().catch(fail); // fresh stock numbers
  refreshFilters(); renderProducts();
}

function receiptNo(order, id) {
  if (order) return 'R' + String(order).replace(/-/g, '').slice(0, 8).toUpperCase();
  return 'R' + String(id).padStart(6, '0');
}
function showReceipt(s) {
  var when = /^\d{4}-\d{2}-\d{2} /.test(s.date) ? fmtDate(s.date) : new Date(s.date).toLocaleString();
  showDialog('<div class="receipt">' +
    '<div style="text-align:center;font-weight:bold">SMEAG CAFE</div>' +
    '<div style="text-align:center">' + esc(s.no) + ' — ' + esc(when) + '</div><hr/>' +
    '<div>Buyer: ' + esc(s.buyerName) + '</div><div>Seller: ' + esc(s.seller) + '</div><hr/>' +
    s.items.map(function (i) { return '<div class="line"><span>' + esc(i.name) + ' ×' + i.qty + '</span><span>' + money(i.amount != null ? i.amount : i.price * i.qty) + '</span></div>'; }).join('') +
    '<hr/>' +
    '<div class="line"><span>Subtotal</span><span>' + money(s.subtotal) + '</span></div>' +
    (s.discountPct ? '<div class="line"><span>Discount ' + s.discountPct + '%</span><span>-' + money(s.discount) + '</span></div>' : '') +
    '<div class="line"><b>TOTAL</b><b>' + money(s.total) + ' PHP</b></div>' +
    '<div class="line"><span>Balance after</span><span>' + money(s.balanceAfter) + '</span></div>' +
  '</div>');
}

// ===================================================================
// PRODUCT REGISTRATION
// ===================================================================
function campusOptions(extra) {
  var list = storeCampuses().map(function (c) { return { value: upper(c), label: c }; });
  if (extra && !list.some(function (o) { return o.value === upper(extra); })) list.push({ value: extra, label: extra });
  return list.map(function (o) { return '<option value="' + esc(o.value) + '">' + esc(o.label) + '</option>'; }).join('');
}
function renderProductTab() {
  if (!$('pId').value) {
    $('pCampus').innerHTML = campusOptions();
    $('pCampus').value = upper(sellCampus());
  }
  $('categoryList').innerHTML = uniq(db.products.map(function (p) { return p.category; })).map(function (c) { return '<option value="' + esc(c) + '">'; }).join('');
  $('subList').innerHTML = '';
  var q = $('pSearch').value.trim().toLowerCase();
  var rows = db.products
    .filter(function (p) { return !q || [p.name, p.campus, p.category, p.sub].join(' ').toLowerCase().includes(q); })
    .sort(function (a, b) { return a.campus.localeCompare(b.campus) || a.category.localeCompare(b.category) || a.name.localeCompare(b.name); });
  $('productTable').innerHTML = rows.map(function (p) {
    return '<tr>' +
      '<td>' + esc(p.name) + '</td><td>' + esc(p.campus) + '</td><td>' + esc(p.category) + '</td><td>' + esc(p.sub) + '</td>' +
      '<td class="num">' + money(p.price) + '</td><td class="num">' + p.stock + '</td>' +
      '<td><button class="btn btn-sm" data-edit="' + p.id + '">Edit</button><button class="btn btn-sm btn-danger" data-del="' + p.id + '">Delete</button></td>' +
    '</tr>';
  }).join('') || (productsLoading ? '<tr><td colspan="7" class="muted">Loading…</td></tr>' : '');
}
$('pSearch').oninput = renderProductTab;
function clearProductForm() { $('productForm').reset(); $('pId').value = ''; renderProductTab(); }
$('pClear').onclick = clearProductForm;
// No sub-category column in the DB: the sub-category is the product name (bank.subcategory).
$('pName').oninput = function () { $('pSub').value = $('pName').value; };

$('productForm').onsubmit = function (e) {
  e.preventDefault();
  var btn = $('productForm').querySelector('button[type=submit]');
  busy(btn, async function () {
    var id = Number($('pId').value);
    var data = {
      sMenu: $('pName').value.trim(), campus: $('pCampus').value, mMenu: $('pCategory').value.trim(),
      payment: Number($('pPrice').value), stock: Math.floor(Number($('pStock').value)),
    };
    if (id) {
      var cur = findProduct(id);
      if (cur && data.campus === cur.campus) delete data.campus; // unchanged campus is not re-checked
      await API.updateProduct(id, data);
    } else {
      await API.createProduct(data);
    }
    toast(id ? 'Product updated' : 'Product registered');
    $('productForm').reset(); $('pId').value = '';
    await loadProducts();
    renderProductTab(); refreshFilters(); renderProducts(); renderCart();
  });
};

$('productTable').onclick = function (e) {
  var edit = e.target.dataset.edit, del = e.target.dataset.del;
  if (edit) {
    var p = findProduct(Number(edit));
    if (!p) return;
    $('pId').value = p.id; $('pName').value = p.name;
    $('pCampus').innerHTML = campusOptions(p.campus); $('pCampus').value = campuses().some(function (c) { return upper(c) === upper(p.campus); }) ? upper(p.campus) : p.campus;
    $('pCategory').value = p.category; $('pSub').value = p.sub; $('pPrice').value = p.price;
    $('pStock').value = p.stock; $('pBarcode').value = '';
    $('pName').focus();
  }
  if (del && confirm('Delete this product?')) {
    busy(e.target, async function () {
      await API.deleteProduct(Number(del));
      state.cart = state.cart.filter(function (l) { return l.id !== Number(del); });
      if (Number($('pId').value) === Number(del)) { $('productForm').reset(); $('pId').value = ''; }
      toast('Product deleted');
      await loadProducts();
      renderProductTab(); refreshFilters(); renderProducts(); renderCart();
    });
  }
};

// ===================================================================
// SALES HISTORY / REPORT data: POS sale lines from the bank ledger
// ===================================================================
var salesCache = { key: '', promise: null, rows: [] };
function loadSales(from, to) {
  var key = from + '|' + to + '|' + storeCampuses().join(',');
  if (salesCache.key === key) return salesCache.promise;
  salesCache.key = key;
  salesCache.promise = (async function () {
    var list = storeCampuses();
    var results = await Promise.all(list.map(function (c) { return API.sales({ from: from, to: to, campus: c, store: 'cafe' }); }));
    var byId = new Map();
    results.forEach(function (rows) {
      rows.forEach(function (r) {
        // Only counter sales (POS / PWA POS decreases), not office transactions or charges.
        if (r.type === 'decrease' && /POS/i.test(String(r.source || ''))) byId.set(r.id, r);
      });
    });
    return Array.from(byId.values());
  })();
  salesCache.promise.catch(function () { salesCache.key = ''; });
  return salesCache.promise;
}
function discountPct(remark) {
  var m = /(\d+(?:\.\d+)?)\s*%/.exec(String(remark || ''));
  return m ? Number(m[1]) : 0;
}
// One receipt per checkout (rows sharing `order`); old rows without an order are their own receipt.
function groupReceipts(rows) {
  var groups = new Map();
  rows.forEach(function (r) {
    var k = r.order ? 'o:' + r.order : 'r:' + r.id;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  });
  return Array.from(groups.entries()).map(function (entry) {
    var lines = entry[1].sort(function (a, b) { return a.id - b.id; });
    var first = lines[0], last = lines[lines.length - 1];
    var pct = discountPct(first.remark);
    var items = lines.map(function (l) {
      var gross = pct && pct < 100 ? round2(l.payment / (1 - pct / 100)) : l.payment;
      return { name: l.subcategory || '-', category: l.category || '-', qty: l.quantity || 1, amount: gross, paid: l.payment };
    });
    var total = round2(lines.reduce(function (a, l) { return a + l.payment; }, 0));
    var subtotal = round2(items.reduce(function (a, i) { return a + i.amount; }, 0));
    return {
      key: entry[0], no: receiptNo(first.order, first.id), date: first.date,
      buyerName: first.name || first.uid || '-', seller: first.category || '-',
      items: items, subtotal: subtotal, discountPct: pct, discount: round2(subtotal - total), total: total,
      balanceAfter: last.totalMoney,
    };
  }).sort(function (a, b) { return b.date.localeCompare(a.date) || b.key.localeCompare(a.key); });
}

var historyReceipts = [];
async function renderHistory() {
  var from = $('hFrom').value, to = $('hTo').value, q = $('hSearch').value.trim().toLowerCase();
  if (!from || !to) { $('historyTable').innerHTML = '<tr><td colspan="8" class="muted">Choose a date range</td></tr>'; return; }
  if (salesCache.key !== from + '|' + to + '|' + storeCampuses().join(',')) $('historyTable').innerHTML = '<tr><td colspan="8" class="muted">Loading…</td></tr>';
  var rows;
  try { rows = await loadSales(from, to); } catch (e) { $('historyTable').innerHTML = '<tr><td colspan="8" class="muted">' + esc(e.message) + '</td></tr>'; return fail(e); }
  if ($('hFrom').value !== from || $('hTo').value !== to) return; // a newer render is on its way
  historyReceipts = groupReceipts(rows);
  var list = historyReceipts.filter(function (s) {
    return !q || String(s.buyerName).toLowerCase().includes(q) || s.no.toLowerCase().includes(q);
  });
  $('historyTable').innerHTML = list.slice(0, 1000).map(function (s) {
    return '<tr>' +
      '<td>' + esc(s.no) + '</td><td>' + esc(fmtDate(s.date)) + '</td><td>' + esc(s.buyerName) + '</td><td>' + esc(s.seller) + '</td>' +
      '<td>' + s.items.reduce(function (a, i) { return a + i.qty; }, 0) + '</td>' +
      '<td class="num">' + (s.discountPct ? s.discountPct + '%' : '-') + '</td><td class="num">' + money(s.total) + '</td>' +
      '<td><button class="btn btn-sm" data-view="' + esc(s.key) + '">View</button></td>' +
    '</tr>';
  }).join('') || '<tr><td colspan="8" class="muted">No sales yet</td></tr>';
}
['hFrom', 'hTo'].forEach(function (id) { $(id).onchange = renderHistory; });
$('hSearch').oninput = renderHistory;
$('historyTable').onclick = function (e) {
  var k = e.target.dataset.view;
  var s = k && historyReceipts.find(function (x) { return x.key === k; });
  if (s) showReceipt(s);
};

// ===================================================================
// REPORT
// ===================================================================
async function renderReport() {
  var from = $('rFrom').value, to = $('rTo').value;
  var none = '<tr><td colspan="3" class="muted">No data</td></tr>';
  if (!from || !to) return;
  var rows;
  try { rows = await loadSales(from, to); } catch (e) { return fail(e); }
  if ($('rFrom').value !== from || $('rTo').value !== to) return;
  var sales = groupReceipts(rows);
  var revenue = sales.reduce(function (a, s) { return a + s.total; }, 0);
  var disc = sales.reduce(function (a, s) { return a + s.discount; }, 0);
  var qty = sales.reduce(function (a, s) { return a + s.items.reduce(function (b, i) { return b + i.qty; }, 0); }, 0);
  $('reportStats').innerHTML = [
    ['Transactions', sales.length], ['Items sold', qty],
    ['Revenue (PHP)', money(revenue)], ['Discounts given (PHP)', money(disc)],
  ].map(function (x) { return '<div class="panel stat"><div class="label">' + x[0] + '</div><div class="big">' + x[1] + '</div></div>'; }).join('');

  var group = function (keyFn) {
    var m = {};
    sales.forEach(function (s) {
      s.items.forEach(function (i) {
        var k = keyFn(i);
        m[k] = m[k] || { qty: 0, amt: 0 };
        m[k].qty += i.qty; m[k].amt += i.amount;
      });
    });
    return Object.entries(m).sort(function (a, b) { return b[1].amt - a[1].amt; });
  };
  var row = function (x) { return '<tr><td>' + esc(x[0]) + '</td><td class="num">' + x[1].qty + '</td><td class="num">' + money(x[1].amt) + '</td></tr>'; };
  $('rCategory').innerHTML = group(function (i) { return i.category; }).map(row).join('') || none;
  $('rTop').innerHTML = group(function (i) { return i.name; }).slice(0, 10).map(row).join('') || none;
  renderLowStock();
}
function renderLowStock() {
  var none = '<tr><td colspan="3" class="muted">No data</td></tr>';
  $('rLow').innerHTML = db.products.filter(function (p) { return p.stock <= 10; })
    .sort(function (a, b) { return a.stock - b.stock || a.name.localeCompare(b.name); })
    .map(function (p) { return '<tr><td>' + esc(p.name) + '</td><td>' + esc(p.campus) + '</td><td class="num">' + p.stock + '</td></tr>'; }).join('') || none;
}
['rFrom', 'rTo'].forEach(function (id) { $(id).onchange = renderReport; });

// ===================================================================
// BUYER INFO (search + edit name / student ID / age; balance via Top up only)
// ===================================================================
var buyerSearchTimer = null;
var buyerSearchSeq = 0;
async function renderBuyers() {
  var q = $('bySearch').value.trim();
  var seq = ++buyerSearchSeq;
  try {
    var list = await API.searchPeople(q);
    if (seq !== buyerSearchSeq) return;
    db.buyers = list;
  } catch (e) { return fail(e); }
  drawBuyers();
}
function drawBuyers() {
  $('buyerTable').innerHTML = db.buyers.map(function (b) {
    return '<tr>' +
      '<td>' + esc(b.name) + '</td><td>' + esc(b.uid) + '</td><td>' + esc(b.sid) + '</td><td>' + (b.age == null ? '' : b.age) + '</td>' +
      '<td class="num">' + money(b.balance) + '</td>' +
      '<td><button class="btn btn-sm" data-topup="' + b.id + '">Top up</button><button class="btn btn-sm" data-edit="' + b.id + '">Edit</button><button class="btn btn-sm btn-danger" data-del="' + b.id + '">Delete</button></td>' +
    '</tr>';
  }).join('');
}
$('bySearch').oninput = function () { clearTimeout(buyerSearchTimer); buyerSearchTimer = setTimeout(renderBuyers, 300); };
function clearBuyerForm() { $('buyerForm').reset(); $('byId').value = ''; $('byUid').readOnly = false; }
$('byClear').onclick = clearBuyerForm;

$('buyerForm').onsubmit = function (e) {
  e.preventDefault();
  var id = Number($('byId').value);
  if (!id) return toast('Register new cards in the Office program.', true);
  var btn = $('buyerForm').querySelector('button[type=submit]');
  busy(btn, async function () {
    var updated = await API.updatePerson(id, {
      name: $('byName').value.trim(), studentId: $('bySid').value.trim(),
      age: $('byAge').value === '' ? null : Number($('byAge').value),
    });
    db.buyers = db.buyers.map(function (b) { return b.id === id ? updated : b; });
    toast('Buyer updated');
    clearBuyerForm(); drawBuyers();
  });
};

$('buyerTable').onclick = function (e) {
  var ds = e.target.dataset;
  var b;
  if (ds.edit) {
    b = db.buyers.find(function (x) { return x.id === Number(ds.edit); });
    if (!b) return;
    $('byId').value = b.id; $('byName').value = b.name; $('byUid').value = b.uid; $('byUid').readOnly = true;
    $('bySid').value = b.sid || ''; $('byAge').value = b.age == null ? '' : b.age; $('byBalance').value = b.balance;
  }
  // Same button as the legacy cafe, but e-money is charged only in the Office program.
  if (ds.topup) return toast('E-money can only be charged in the SMEAG Office program (OFFICE MENU > + INCREASE).', true);
  if (ds.del) toast('Buyers cannot be deleted here. Use the Office program.', true);
};

// ===== Rendering per tab =====
function renderTab(tab, reload) {
  if (!session()) return;
  if (tab === 'sales' || tab === 'products' || tab === 'report') {
    var draw = function () {
      if (tab === 'sales') { refreshFilters(); renderProducts(); renderCart(); }
      if (tab === 'products') renderProductTab();
      if (tab === 'report') renderLowStock();
    };
    draw();
    if (reload || !db.products.length) {
      loadProducts().then(draw, fail);
      draw(); // shows "Loading…" while the request runs
    }
  }
  if (tab === 'history') renderHistory();
  if (tab === 'report') renderReport();
  if (tab === 'buyers') renderBuyers();
}

// ===== Init =====
$('byBalance').readOnly = true;
$('byBalance').title = 'The balance changes only through sales and top-ups.';
$('pSub').readOnly = true;
$('pBarcode').disabled = true;
// NFC: phone NFC (Android app bridge / Web NFC), USB keyboard-mode reader and the ACR122U PC bridge,
// all through ../src/nfcService.js — the same reader code as the PUSAN Mart screen.
(function wireNfc() {
  var N = window.PusanNfc;
  if (!N) return;
  N.listenForNfc(function (d) { onCardTap(d.uid); });
  N.enableKeyboardReader(function () { return !!session() && !$('dialog').open; });
  window.addEventListener('nfc-error', function (e) { if (session()) toast((e.detail && e.detail.message) || 'NFC read error', true); });
  if (N.keepPhoneNfc) N.keepPhoneNfc(function () { return !!session(); });
  if (N.connectPcReader && !isPhone()) {
    var status = document.createElement('span');
    status.className = 'reader-status';
    document.querySelector('.header-actions').prepend(status);
    var setStatus = function (on) {
      status.classList.toggle('on', on);
      status.textContent = on ? '● Card reader' : '○ Card reader';
      status.title = on ? 'ACR122U bridge connected (127.0.0.1:47321)' : 'USB keyboard readers work without the bridge; start desktop-bridge for an ACR122U';
    };
    setStatus(false);
    N.connectPcReader(setStatus);
  }
})();
if (session() && session().token) startApp(); else showLogin('');
