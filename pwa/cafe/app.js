// ===== SMEAG MART (cafe POS) - app logic, backed by the e-money API (data.js) =====
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
var state = { buyer: null, discount: 0, cart: [] }; // cart: [{id, qty}]

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
  $('sellerInfo').textContent = 'Seller: - | Position: - | Campus: -';
  $('loginPassword').value = '';
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
      res = await API.login($('loginId').value.trim(), $('loginPassword').value);
    } catch (err) {
      $('loginError').textContent = err.message;
      return;
    }
    if (!res || !res.manager) { $('loginError').textContent = 'Wrong login ID or password.'; return; }
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
  resetSale();
  db.products = []; db.campusIds = {}; db.buyers = []; db.sales = []; salesCache.key = '';
  renderProducts(); renderProductTab(); drawBuyers();
  $('historyTable').innerHTML = ''; $('reportStats').innerHTML = '';
  showLogin('');
};

API.onUnauthorized = function (msg) { showLogin(msg || 'Please log in again.'); };

function startApp() {
  var m = manager();
  document.body.classList.remove('logged-out');
  $('sellerInfo').textContent = 'Seller: ' + (m.name || m.login_id || '-') + ' | Position: ' + (m.position || '-') + ' | Campus: ' + normCampus(m.campus);
  // Campus selector: only campuses this account may sell at; default = the account's own campus.
  var list = campuses();
  $('fCampus').innerHTML = list.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
  var mine = normCampus(m.campus);
  $('fCampus').value = list.includes(mine) ? mine : list[0];
  $('fCampus').dataset.prev = $('fCampus').value;
  // History / report default range: last 30 days.
  if (!$('hFrom').value) $('hFrom').value = todayStr(-30);
  if (!$('hTo').value) $('hTo').value = todayStr(0);
  if (!$('rFrom').value) $('rFrom').value = todayStr(-30);
  if (!$('rTo').value) $('rTo').value = todayStr(0);
  renderCart();
  renderTab(activeTab(), true);
  $('buyerInput').focus();
}

// ===================================================================
// PRODUCTS (shared by Sales / Product Registration / Report)
// ===================================================================
var productsLoading = null;
function loadProducts() {
  if (productsLoading) return productsLoading;
  productsLoading = (async function () {
    var list = campuses();
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
// SALES
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

function filteredProducts() {
  var cat = $('fCategory').value, sub = $('fSub').value;
  var q = $('fName').value.trim().toLowerCase();
  return campusProducts(sellCampus()).filter(function (p) {
    return (!cat || p.category === cat) && (!sub || p.sub === sub) && (!q || p.name.toLowerCase().includes(q));
  }).sort(function (a, b) { return a.category.localeCompare(b.category) || a.name.localeCompare(b.name); });
}

function renderProducts() {
  var list = filteredProducts();
  $('productCount').textContent = list.length;
  $('productGrid').innerHTML = list.length ? list.map(function (p) {
    var badge = p.stock > 0 ? '<span class="badge ' + (p.stock <= 10 ? 'low' : '') + '">' + p.stock + '</span>' : '';
    return '<div class="product-card ' + (p.stock <= 0 ? 'out' : '') + '" data-id="' + p.id + '" title="' + esc(p.category) + ' / ' + esc(p.sub) + '">' +
      badge +
      '<div class="name">' + esc(p.name) + '</div>' +
      '<div class="campus">' + esc(p.campus) + '</div>' +
      '<div class="price">' + money(p.price) + '</div>' +
    '</div>';
  }).join('') : '<div class="empty">' + (productsLoading ? 'Loading…' : 'No products found') + '</div>';
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
  refreshFilters(); renderProducts();
};
['fCategory', 'fSub'].forEach(function (id) { $(id).onchange = function () { refreshFilters(); renderProducts(); }; });
$('fName').oninput = renderProducts;
// Enter in the name box adds the product when the name matches exactly (or only one product is left).
$('fName').onkeydown = function (e) {
  if (e.key !== 'Enter') return;
  var q = $('fName').value.trim().toLowerCase();
  if (!q) return;
  var list = filteredProducts();
  var p = list.find(function (x) { return x.name.toLowerCase() === q; }) || (list.length === 1 ? list[0] : null);
  if (p) { addToCart(p.id); $('fName').value = ''; renderProducts(); }
};

function addToCart(id) {
  var p = findProduct(id);
  if (!p) return;
  var line = state.cart.find(function (l) { return l.id === id; });
  var inCart = line ? line.qty : 0;
  if (inCart + 1 > p.stock) return toast('Not enough stock for ' + p.name, true);
  if (line) line.qty++; else state.cart.push({ id: id, qty: 1 });
  renderCart();
}

function changeQty(id, delta) {
  var line = state.cart.find(function (l) { return l.id === id; });
  var p = findProduct(id);
  if (!line || !p) return;
  if (delta > 0 && line.qty + 1 > p.stock) return toast('Not enough stock for ' + p.name, true);
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
  $('cartList').innerHTML = state.cart.map(function (l) {
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
  }).join('');

  var t = totals();
  $('sSubtotal').textContent = money(t.subtotal);
  $('sItems').textContent = t.items;
  $('discountRow').hidden = !state.discount;
  $('sDiscLabel').textContent = 'Discount (' + state.discount + '%)';
  $('sDiscount').textContent = '-' + money(t.discount);
  $('sTotal').textContent = money(t.total) + ' PHP';

  var bal = state.buyer ? state.buyer.balance : 0;
  $('bBalance').textContent = money(bal);
  var proj = bal - t.total;
  $('bProjected').textContent = money(proj);
  $('bProjected').style.color = state.buyer && proj < 0 ? 'var(--danger)' : '';
  document.querySelectorAll('[data-discount]').forEach(function (b) { b.classList.toggle('selected', Number(b.dataset.discount) === state.discount); });
}

$('cartList').onclick = function (e) {
  var b = e.target.closest('button[data-q]');
  if (!b) return;
  var id = Number(b.dataset.id);
  if (b.dataset.q === 'x') { state.cart = state.cart.filter(function (l) { return l.id !== id; }); renderCart(); }
  else changeQty(id, Number(b.dataset.q));
};

// ----- Buyer -----
function setBuyer(b) {
  state.buyer = b;
  $('bName').textContent = b ? b.name || '-' : '-';
  $('bUid').textContent = b ? b.uid : '-';
  $('bSid').textContent = b ? b.sid || '-' : '-';
  $('bAge').textContent = b ? (b.age == null ? '-' : b.age) : '-';
  renderCart();
}
// Card UID first (USB RFID readers type the UID + Enter), then an exact Student ID / UID match.
async function lookupBuyer(v) {
  var b = await API.personByUid(v);
  if (b) return b;
  var list = await API.searchPeople(v);
  var lv = v.toLowerCase();
  return list.find(function (x) { return x.sid && x.sid.toLowerCase() === lv; }) ||
         list.find(function (x) { return x.uid && x.uid.toLowerCase() === lv; }) || null;
}
function scanBuyer() {
  var v = $('buyerInput').value.trim();
  if (!v) return toast('Tap a card or type a UID / Student ID', true);
  busy($('scanBtn'), async function () {
    var b = await lookupBuyer(v);
    if (!b) { setBuyer(null); return toast('Buyer not found', true); }
    setBuyer(b);
    $('buyerInput').value = '';
    toast('Buyer: ' + (b.name || b.uid));
  });
}
$('scanBtn').onclick = scanBuyer;
$('buyerInput').onkeydown = function (e) { if (e.key === 'Enter') scanBuyer(); }; // RFID readers send Enter

document.querySelectorAll('[data-discount]').forEach(function (btn) {
  btn.onclick = function () {
    var d = Number(btn.dataset.discount);
    state.discount = state.discount === d ? 0 : d; // click again to remove
    renderCart();
  };
});

function resetSale() {
  state.cart = []; state.discount = 0; setBuyer(null); $('buyerInput').value = '';
}
$('resetBtn').onclick = resetSale;

// ----- Checkout -----
$('checkoutBtn').onclick = function () {
  if (!state.cart.length) return toast('Cart is empty', true);
  if (!state.buyer) return toast('Scan a buyer card first', true);
  var t = totals();
  if (state.buyer.balance < t.total) return toast('Insufficient balance', true);

  busy($('checkoutBtn'), async function () {
    var campus = sellCampus();
    var items = state.cart.map(function (l) {
      var p = findProduct(l.id);
      return { productId: p.id, name: p.name, category: p.category, price: p.price, qty: l.qty };
    });
    var label = state.discount ? state.discount + '% Discount' : 'No Discount';
    var res = await API.checkout({
      uid: state.buyer.uid, store: 'cafe', campus: campus,
      cart: items.map(function (i) { return { productId: i.productId, quantity: i.qty }; }),
      discountLabel: label, discountRate: state.discount / 100,
    });
    var sale = {
      no: receiptNo(res.orderId, null),
      date: new Date().toISOString(),
      buyerName: res.buyerName || state.buyer.name || state.buyer.uid,
      seller: manager().name || manager().login_id,
      items: items,
      subtotal: t.subtotal, discountPct: state.discount,
      discount: round2(t.subtotal - res.finalTotal), total: res.finalTotal,
      balanceAfter: res.remainingBalance,
    };
    showReceipt(sale);
    resetSale();
    salesCache.key = ''; // history / report must reload
    await loadProducts().catch(fail); // fresh stock numbers
    refreshFilters(); renderProducts();
  });
};

function receiptNo(order, id) {
  if (order) return 'R' + String(order).replace(/-/g, '').slice(0, 8).toUpperCase();
  return 'R' + String(id).padStart(6, '0');
}
function showReceipt(s) {
  var when = /^\d{4}-\d{2}-\d{2} /.test(s.date) ? fmtDate(s.date) : new Date(s.date).toLocaleString();
  showDialog('<div class="receipt">' +
    '<div style="text-align:center;font-weight:bold">SMEAG MART</div>' +
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
  var list = campuses().map(function (c) { return { value: upper(c), label: c }; });
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
  var key = from + '|' + to + '|' + campuses().join(',');
  if (salesCache.key === key) return salesCache.promise;
  salesCache.key = key;
  salesCache.promise = (async function () {
    var list = campuses();
    var results = await Promise.all(list.map(function (c) { return API.sales({ from: from, to: to, campus: c }); }));
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
  if (salesCache.key !== from + '|' + to + '|' + campuses().join(',')) $('historyTable').innerHTML = '<tr><td colspan="8" class="muted">Loading…</td></tr>';
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
    if (state.buyer && state.buyer.id === id) setBuyer(updated);
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
if (session() && session().token) startApp(); else showLogin('');
