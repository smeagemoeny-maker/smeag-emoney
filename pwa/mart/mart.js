/* SMEAG Mobile Mart - browser version of the Android Jetpack Compose app
 * (PUSAN MART/smeag_mart), running against the PUSAN MART backend API.
 *
 * API base: ?api=<url> (saved to localStorage.pusanApiBase), else localStorage.pusanApiBase,
 *           else http://localhost:8787.
 * NFC:      ../src/nfcService.js (window.PusanNfc) - Android WebView bridge, Chrome Web NFC
 *           (HTTPS) or a USB keyboard-mode reader. ?demo=1 adds a "📡 NFC" pill that feeds a
 *           typed UID through the same path as a real tap.
 * Routes:   #register #modify #sales #history #report #buyer #pusanpay #paylist #receipt #logout
 */
(function () {
  'use strict';

  // ------------------------------------------------------------------ helpers
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) { return (Math.round(Number(n) * 100) / 100).toFixed(2); }
  // Thousands separators: 12345.6 -> "12,345.60" (digits = decimal places).
  function comma(n, digits) { var d = digits || 0; return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function parseNum(s) { s = String(s).trim(); if (!s || !/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return null; return Number(s); }
  function parseIntStrict(s) { s = String(s).trim(); if (!/^[+-]?\d+$/.test(s)) return null; return parseInt(s, 10); }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function uniqSorted(arr) {
    var seen = {}, out = [];
    arr.forEach(function (v) { if (v != null && v !== '' && !seen[v]) { seen[v] = 1; out.push(v); } });
    return out.sort(function (a, b) { return a < b ? -1 : a > b ? 1 : 0; });
  }
  // DB DATE columns arrive as UTC ISO strings of Manila midnight ("2025-02-28T16:00:00.000Z" = 2025-03-01).
  function dateOnly(v) {
    if (!v) return null;
    var s = String(v);
    if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
      var t = Date.parse(s);
      if (!isNaN(t)) return new Date(t + 8 * 3600 * 1000).toISOString().slice(0, 10);
    }
    return s.slice(0, 10);
  }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } }
  function ssGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function ssSet(k, v) { try { if (v == null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } }

  // ------------------------------------------------------------------ config
  var CAMPUS_OPTIONS = ['Capital', 'Encanto', 'Tarlac', 'Baydream', 'Restobar', 'Pusan Mart'];
  var MART_CAMPUS = 'Pusan Mart';
  var PARAMS = new URLSearchParams(location.search);
  // /report/ sets window.MART_REPORT_ONLY: same app, only Summary / History / Pay List, no writes.
  var REPORT_ONLY = !!window.MART_REPORT_ONLY;
  var HOME = REPORT_ONLY ? 'report' : 'sales';

  var IS_LOCAL_PAGE = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) || location.protocol === 'file:';
  // Hosted (Vercel): the API is served from the same domain (/api). Local dev: the Node API on :8787.
  var DEFAULT_API = IS_LOCAL_PAGE ? 'http://localhost:8787' : location.origin;
  function savedApi(v) { return v && (IS_LOCAL_PAGE || !/\/\/(localhost|127\.0\.0\.1)[:/]?/.test(v)) ? v : ''; }
  var API_BASE = (function () {
    var p = PARAMS.get('api');
    if (p) lsSet('pusanApiBase', p);
    return (p || savedApi(lsGet('pusanApiBase')) || DEFAULT_API).replace(/\/+$/, '');
  })();
  // Same as ImageConfig.kt: DB image_path is relative to the old DB host's HTTP root.
  var IMAGE_BASE = (lsGet('pusanImageBase') || 'http://1.234.23.54/').replace(/\/+$/, '') + '/';
  function resolveImage(path) {
    if (path == null || !String(path).trim() || String(path).trim().toLowerCase() === 'null') return null;
    path = String(path);
    if (/^(https?:|content:|file:|blob:|data:)/.test(path)) return path;
    return IMAGE_BASE + path.replace(/^\/+/, '');
  }
  var failedImages = {};

  // ------------------------------------------------------------------ API
  function apiCall(method, path, body) {
    var headers = { 'Accept': 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (session.token) headers['Authorization'] = 'Bearer ' + session.token;
    return fetch(API_BASE + path, { method: method, headers: headers, cache: 'no-store', body: body === undefined ? undefined : JSON.stringify(body) })
      .catch(function (e) {
        var err = new Error('Unable to connect to the server: ' + (e && e.message || 'Unknown error'));
        err.status = 0; throw err;
      })
      .then(function (res) {
        return res.text().then(function (text) {
          var data = null;
          try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
          if (!res.ok) {
            var err = new Error((data && data.error) || ('HTTP ' + res.status));
            err.status = res.status;
            if (res.status === 401 && session.token) sessionExpired(err.message);
            throw err;
          }
          return data;
        });
      });
  }
  function q(params) {
    return '?' + Object.keys(params).filter(function (k) { return params[k] != null && params[k] !== ''; })
      .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&');
  }
  function normProduct(p) {
    return {
      id: Number(p.id), campus: p.campus || '', mMenu: p.mMenu, sMenu: p.sMenu, imagePath: p.imagePath,
      image: resolveImage(p.imagePath), payment: num(p.payment), stock: Math.trunc(num(p.stock)),
      salesNumber: Math.trunc(num(p.salesNumber)), minStock: Math.trunc(num(p.minStock)),
      barcode: p.barcode ? String(p.barcode).trim().toUpperCase() : '', itemCode: p.itemCode || '',
      cost: p.cost == null || p.cost === '' ? null : num(p.cost)
    };
  }
  function normPerson(p) {
    if (!p) return null;
    return {
      id: p.id, uid: p.uid, studentId: p.studentId, name: p.name, age: p.age, gender: p.gender, campus: p.campus,
      startDate: dateOnly(p.startDate), endDate: dateOnly(p.endDate), totalMoney: num(p.totalMoney)
    };
  }
  // This screen is the MART of the selected campus (each campus has its own mart; cafes use /cafe/).
  function storeFor() { return 'mart'; }
  // Pusan Mart keeps its campus-wide history/report; the other campuses only show their mart's sales.
  function storeParam(campus) { return String(campus).toUpperCase() === MART_CAMPUS.toUpperCase() ? undefined : 'mart'; }
  // m_menu for products registered here (same names as the campus store terminals) — api/src/stores.mjs.
  var MART_MENU = { CAPITAL: 'Capital Mart', ENCANTO: 'ENCANTO MART', TARLAC: 'Tarlac Store' };
  function martMenuFor(campus) { return MART_MENU[String(campus).toUpperCase()] || campus; }

  var repo = {
    login: function (loginId) { return apiCall('POST', '/api/auth/login', { loginId: loginId }); },
    fetchProducts: function (campus) {
      return apiCall('GET', '/api/products' + q({ campus: campus, store: 'mart' })).then(function (rows) { return (rows || []).map(normProduct); });
    },
    findPersonByUid: function (uid) {
      return apiCall('GET', '/api/people/by-nfc/' + encodeURIComponent(uid)).then(function (r) { return normPerson(r && r.person); });
    },
    checkout: function (body) { return apiCall('POST', '/api/checkouts', body).then(function (r) { return r.checkout; }); },
    createProduct: function (body) { return apiCall('POST', '/api/products', body).then(function (r) { return r.product; }); },
    updateProduct: function (id, body) { return apiCall('PATCH', '/api/products/' + id, body).then(function (r) { return r.product; }); },
    deleteProduct: function (id) { return apiCall('DELETE', '/api/products/' + id); },
    fetchHistory: function (campus, s, e) {
      return apiCall('GET', '/api/sales' + q({ from: s, to: e, campus: campus, store: storeParam(campus) })).then(function (r) { return (r && r.sales) || []; });
    },
    fetchWeeklyReport: function (campus, s, e) {
      return apiCall('GET', '/api/reports/sales' + q({ from: s, to: e, campus: campus, store: storeParam(campus) })).then(function (r) {
        var rep = r.report, total = num(rep.total), count = num(rep.orderCount);
        return {
          totalRevenue: total, transactionCount: count,
          avgOrderValue: count > 0 ? money(total / count) : '0',
          lowStock: (rep.lowStock || []).map(normProduct),
          dailyTotals: (rep.daily || []).map(function (d) { return [d.date, num(d.total)]; }),
          topProducts: (rep.topProducts || []).slice(0, 5).map(function (t) { return [t.name || '-', num(t.quantity)]; })
        };
      });
    },
    // Pays the amount from the card's e-money (bank row + PusanmartPayments row). clientKey: one per tap.
    createPusanmartPayment: function (uid, amount, discountLabel, clientKey, memo) {
      return apiCall('POST', '/api/pusanmart/payments', { uid: uid, totalAmount: Math.round(amount * 100) / 100,
        discountLabel: discountLabel, clientKey: clientKey, memo: memo || '' }).then(function (r) { return r.payment; });
    },
    fetchPusanmartDaily: function (s, e) {
      return apiCall('GET', '/api/pusanmart/daily' + q({ from: s, to: e }));
    },
    savePusanmartCost: function (date, cost) {
      return apiCall('PUT', '/api/pusanmart/daily/' + encodeURIComponent(date), { cost: cost }).then(function (r) { return r.day; });
    },
    fetchPusanmartPayments: function (s, e) {
      return apiCall('GET', '/api/pusanmart/payments' + q({ from: s, to: e })).then(function (r) {
        return ((r && r.payments) || []).map(function (p) { return Object.assign({}, p, { allPayments: num(p.allPayments) }); });
      });
    }
  };

  // ------------------------------------------------------------------ app state
  var session = { manager: null, access: null, token: null, selectedCampus: MART_CAMPUS };
  var vm = {
    products: [], cart: [],
    discountLabel: 'Manager 15%', discountRate: 0.15,
    checkoutError: null,
    last: null,
    buyerResult: null, buyerLookupError: null, buyerLoading: false,
    pz: { store: 'PUSANMART', amount: '', memo: '', label: 'No Discount', rate: 0, submitting: false, error: null, success: null }
  };
  var route = 'sales';
  var S = {};          // screen-local `remember` state; reset whenever a destination is (re)entered
  var ui = { dropdown: null, dialog: null, toast: null, demoOpen: false, loginNotice: null };
  var ddRegistry = {};
  var actions = {};
  var toastTimer = null;

  function saveSession() {
    ssSet('pusanMartSession', session.token ? JSON.stringify({
      manager: session.manager, access: session.access, token: session.token, selectedCampus: session.selectedCampus
    }) : null);
  }
  function restoreSession() {
    try {
      var s = JSON.parse(ssGet('pusanMartSession') || 'null');
      if (s && s.token && s.manager && s.access) {
        session.manager = s.manager; session.access = s.access; session.token = s.token;
        session.selectedCampus = s.selectedCampus || MART_CAMPUS;
        setDefaultDiscount();
      }
    } catch (e) { /* ignore broken session */ }
  }
  function logout(notice) {
    session.manager = null; session.access = null; session.token = null;
    saveSession();
    vm.cart = []; vm.last = null; vm.buyerResult = null; vm.buyerLookupError = null;
    ui.dropdown = null; ui.loginNotice = notice || null;
    S = {};
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    render(true);
  }
  function sessionExpired(msg) { setTimeout(function () { logout(msg || 'Login session expired. Please log in again.'); }, 0); }

  // Campuses whose mart this account may run (access.martCampuses from the API).
  function allowedCampuses() {
    var a = session.access || {}, stores = a.stores || [];
    if (stores.indexOf('mart') < 0) return [];
    var marts = (a.martCampuses || [MART_CAMPUS]).map(function (c) { return c.toUpperCase(); });
    return CAMPUS_OPTIONS.filter(function (c) { return marts.indexOf(c.toUpperCase()) >= 0; });
  }

  function setDefaultDiscount() {
    var pos = session.manager && session.manager.position;
    var mgr = pos === 'Manager' || pos === 'Admin';
    vm.discountLabel = mgr ? 'Manager 15%' : 'Teacher 10%';
    vm.discountRate = mgr ? 0.15 : 0.10;
  }
  // Runs `promise` for the current screen; results are dropped if the user has left that screen.
  function screenLoad(promise, apply, onError) {
    var s = S;
    s.loading = true; s.error = null;
    promise.then(function (v) { if (S === s) apply(v); }, function (e) {
      if (S !== s) return;
      if (onError) onError(e); else s.error = e.message;
    }).then(function () { if (S === s) { s.loading = false; render(); } });
  }
  function loadProducts(campus) {
    screenLoad(repo.fetchProducts(campus), function (rows) { vm.products = rows; }, function (e) {
      vm.products = []; S.error = 'Failed to load products: ' + e.message;
    });
  }
  // ----- barcode scanning (Pusan Mart counter only; products come from the POS import with barcodes)
  function isPusan(campus) { return String(campus || '').toUpperCase() === MART_CAMPUS.toUpperCase(); }
  function cleanCode(v) { return String(v == null ? '' : v).replace(/\s+/g, '').toUpperCase(); }
  // Exact barcode first; then the forms scanners send differently: Codabar start/stop letters
  // ("A4897001196414967A"), UPC-A (12) vs EAN-13 with a leading 0, and the POS item code ("000124").
  function findByCode(raw) {
    var code = cleanCode(raw);
    if (!code) return null;
    var tries = [code, code.replace(/^[A-D]|[A-D]$/g, ''), '0' + code, code.replace(/^0/, '')];
    for (var i = 0; i < tries.length; i++) {
      var t = tries[i];
      if (!t) continue;
      var hit = vm.products.filter(function (p) {
        return p.barcode && (p.barcode === t || p.barcode.replace(/^[A-D]|[A-D]$/g, '') === t);
      })[0];
      if (hit) return hit;
    }
    return vm.products.filter(function (p) { return p.itemCode && p.itemCode === code; })[0] || null;
  }
  // Register / Edit Products: a scan anywhere on the screen fills the Barcode box (no need to tap it first).
  // Register: an already-registered code is reported instead of filled. Edit: with no product open, the scan
  // opens that product; an unknown code offers to register it.
  function focusLater(id) { setTimeout(function () { var el = document.getElementById(id); if (el) el.focus(); }, 0); }
  function onProductScan(raw) {
    var code = cleanCode(raw);
    if (!code) return;
    var p = findByCode(code);
    // Edit: a scan while the search box has focus is a search, not a barcode change for the open product.
    if (route === 'modify' && document.activeElement && document.activeElement.id === 'm_search') S.selected = null;
    if (route === 'register') {
      if (p) {
        beep('error');
        S.message = 'Barcode ' + code + ' is already registered: "' + (p.sMenu || '-') + '" (stock ' + p.stock + '). Use Products › Edit to change it.';
      } else {
        beep('ok');
        S.barcode = code; S.message = null;
        focusLater(!S.name.trim() ? 'r_name' : !S.price ? 'r_price' : 'r_qty');
      }
    } else if (S.selected) {
      var mine = p && p.id === S.selected;
      if (p && !mine) { beep('error'); S.message = 'Barcode ' + code + ' is already used by "' + (p.sMenu || '-') + '".'; }
      else { beep('ok'); S.barcode = code; S.message = null; }
    } else if (p) {
      beep('ok');
      S.category = 'All'; S.subcategory = 'All'; S.q = p.barcode || code;
      S.selected = p.id; S.stock = String(p.stock); S.minStock = String(p.minStock); S.price = String(p.payment); S.cost = p.cost == null ? '' : String(p.cost); S.barcode = p.barcode || ''; S.message = null;
      focusLater('m_stock');
    } else {
      beep('error');
      render();
      if (window.confirm('Barcode ' + code + ' is not registered.\n\nRegister a new product with this barcode?')) {
        navigate('register');
        S.barcode = code;
        focusLater('r_name');
      }
    }
    render();
  }
  // Called by nfcService for every fast keyboard burst (scanner or keyboard-mode card reader) and by Enter in
  // the search box. Returns true when the code was handled as a product, false to let it be a card tap.
  function onBarcode(raw, fromSearch) {
    if (session.manager && isPusan(S.campus) && (route === 'register' || route === 'modify')) { onProductScan(raw); return true; }
    if (!session.manager || route !== 'sales' || !isPusan(S.campus)) return false;
    var code = cleanCode(raw);
    var p = findByCode(code);
    // 12/13-digit codes are retail barcodes, never a card UID: say it is unknown instead of "card not registered".
    if (!p && !fromSearch && !/^\d{12,13}$/.test(code)) return false;
    if (S.paying) { beep('error'); toast('Processing payment... please wait.', 1600); return true; }
    if (!p) { beep('error'); toast('Barcode not registered: ' + code, 2600); return true; }
    if (S.scanRemove) removeOne(p); else addToCart(p);
    S.lastScanId = p.id;
    render();
    return true;
  }
  function removeOne(p) {
    var line = vm.cart.filter(function (c) { return c.product.id === p.id; })[0];
    if (!line) { beep('error'); toast('Not in the list: ' + (p.sMenu || '-'), 1800); return; }
    changeQty(p, -1);
    beep('ok');
    toast('Removed: ' + (p.sMenu || '-') + (line.quantity > 1 ? ' (left ' + (line.quantity - 1) + ')' : ''), 1400);
  }
  function removeLine(p) { vm.cart = vm.cart.filter(function (c) { return c.product.id !== p.id; }); }
  function clearCart() {
    if (!vm.cart.length) return;
    if (!window.confirm('Remove all ' + vm.cart.length + ' items from the list?')) return;
    vm.cart = []; S.confirm = null; S.lastScanId = null;
  }

  function cartSubtotal() { return vm.cart.reduce(function (a, i) { return a + i.product.payment * i.quantity; }, 0); }
  // Per-item discount: it.disc = { rate: 0..1 } or { amount: pesos off the line }. It REPLACES the cart-wide
  // discount for that line (same rule as pos_checkout, supabase_pos_checkout_item_discount.sql).
  function r2(n) { return Math.round(n * 100) / 100; }
  function lineNet(it, cartRate) {
    var gross = it.product.payment * it.quantity, d = it.disc;
    if (d && d.amount != null) return r2(gross - Math.min(d.amount, gross));
    return r2(gross - gross * (d ? d.rate : (cartRate == null ? vm.discountRate : cartRate)));
  }
  function discTag(d) {
    if (!d) return '';
    if (d.amount != null) return '−₱' + money(d.amount);
    return d.rate === 0 ? 'No disc.' : '−' + Math.round(d.rate * 10000) / 100 + '%';
  }
  function cartTotalAfterDiscount() { return r2(vm.cart.reduce(function (a, it) { return a + lineNet(it); }, 0)); }
  function setLineDisc(p, d) {
    vm.cart.forEach(function (c, i) { if (c.product.id === p.id) vm.cart[i] = { product: c.product, quantity: c.quantity, disc: d }; });
  }

  function toast(msg, ms) {
    ui.toast = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { ui.toast = null; render(); }, ms || 2200);
    render();
  }
  function notInBrowser() { toast('Not available in the browser version'); }

  // ------------------------------------------------------------------ icons (Material filled)
  var ICONS = {
    AddBox: 'M19 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10h-4v4h-2v-4H7v-2h4V7h2v4h4v2z',
    Edit: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
    ShoppingCart: 'M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2zM1 2v2h2l3.6 7.59-1.35 2.45c-.16.28-.25.61-.25.96 0 1.1.9 2 2 2h12v-2H7.42c-.14 0-.25-.11-.25-.25l.03-.12.9-1.63h7.45c.75 0 1.41-.41 1.75-1.03l3.58-6.49A1.003 1.003 0 0 0 20 4H5.21l-.94-2H1zm16 16c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2z',
    Receipt: 'M18 17H6v-2h12v2zm0-4H6v-2h12v2zm0-4H6V7h12v2zM3 22l1.5-1.5L6 22l1.5-1.5L9 22l1.5-1.5L12 22l1.5-1.5L15 22l1.5-1.5L18 22l1.5-1.5L21 22V2l-1.5 1.5L18 2l-1.5 1.5L15 2l-1.5 1.5L12 2l-1.5 1.5L9 2 7.5 3.5 6 2 4.5 3.5 3 2v20z',
    BarChart: 'M4 9h4v11H4zM16 13h4v7h-4zM10 4h4v16h-4z',
    Badge: 'M20 7h-5V4c0-1.1-.9-2-2-2h-2c-1.1 0-2 .9-2 2v3H4c-1.1 0-2 .9-2 2v11c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V9c0-1.1-.9-2-2-2zM9 12c.83 0 1.5.67 1.5 1.5S9.83 15 9 15s-1.5-.67-1.5-1.5S8.17 12 9 12zm3 6H6v-.43c0-.6.36-1.15.92-1.39.64-.28 1.34-.43 2.08-.43s1.44.15 2.08.43c.55.24.92.78.92 1.39V18zm1-9h-2V4h2v5zm5 7.5h-4V15h4v1.5zm0-3h-4V12h4v1.5z',
    Payments: 'M19 14V6c0-1.1-.9-2-2-2H3c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zm-9-1c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm13-6v11c0 1.1-.9 2-2 2H4v-2h17V7h2z',
    Logout: 'M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z',
    ListAlt: 'M19 5v14H5V5h14m1.1-2H3.9c-.5 0-.9.4-.9.9v16.2c0 .4.4.9.9.9h16.2c.4 0 .9-.5.9-.9V3.9c0-.5-.5-.9-.9-.9zM11 7h6v2h-6V7zm0 4h6v2h-6v-2zm0 4h6v2h-6zM7 7h2v2H7zm0 4h2v2H7zm0 4h2v2H7z'
  };
  var TABS = [
    { route: 'modify', label: 'Products', icon: 'Edit' },
    { route: 'sales', label: 'Sales', icon: 'ShoppingCart' },
    { route: 'report', label: 'Report', icon: 'BarChart' },
    { route: 'buyer', label: 'Buyer Info', icon: 'Badge' },
    { route: 'pusanpay', label: 'Pusan Pay', icon: 'Payments' }
  ];
  // History and Pay List live inside the Report tab (chips at the top switch between them).
  var REPORT_GROUP = ['report', 'history', 'paylist'];
  // Edit and Register live inside the Products tab (same chip switch as Report).
  var PRODUCT_GROUP = ['modify', 'register'];
  var ROUTES = TABS.map(function (t) { return t.route; }).concat(['register', 'history', 'paylist', 'receipt']);
  // Pusan Pay and Pay List need access.canPusanPay; accounts without it never see those tabs.
  function canPusanPay() { return !!(session.access && session.access.canPusanPay); }
  function routeAllowed(r) {
    if (REPORT_ONLY && REPORT_GROUP.indexOf(r) < 0) return false;
    return (r !== 'pusanpay' && r !== 'paylist') || canPusanPay();
  }
  function navSelected(t) {
    return route === t || (t === 'report' && REPORT_GROUP.indexOf(route) >= 0) || (t === 'modify' && PRODUCT_GROUP.indexOf(route) >= 0);
  }
  function productTabs() {
    var h = '<div class="chips tabs" style="padding-bottom:8px">';
    [['modify', 'Edit'], ['register', 'Register']].forEach(function (c) {
      h += '<div class="chip' + (route === c[0] ? ' sel' : '') + '" data-act="' + act(function () {
        if (route !== c[0]) navigate(c[0], true);
      }) + '">' + c[1] + '</div>';
    });
    return h + '</div>';
  }
  function reportTabs() {
    if (REPORT_ONLY) return ''; // the nav bar already switches Summary / History / Pay List
    var h = '<div class="chips tabs" style="padding-bottom:8px">';
    [['report', 'Summary'], ['history', 'History'], ['paylist', 'Pay List']].filter(function (c) { return routeAllowed(c[0]); }).forEach(function (c) {
      h += '<div class="chip' + (route === c[0] ? ' sel' : '') + '" data-act="' + act(function () {
        if (route !== c[0]) navigate(c[0], true);
      }) + '">' + c[1] + '</div>';
    });
    return h + '</div>';
  }

  // ------------------------------------------------------------------ components
  var uid = 0;
  function act(fn) { var k = 'a' + (++uid); actions[k] = fn; return k; }
  function eyebrow(t) { return '<div class="eyebrow">' + esc(t) + '</div>'; }
  function title(t) { return '<div class="title">' + esc(t) + '</div>'; }
  function primaryBtn(text, fn, disabled, extra) {
    return '<button class="btn btn-primary"' + (disabled ? ' disabled' : ' data-act="' + act(fn) + '"') + (extra || '') + '><span>' + esc(text) + '</span></button>';
  }
  function secondaryBtn(text, fn, disabled, extra) {
    return '<button class="btn btn-secondary"' + (disabled ? ' disabled' : ' data-act="' + act(fn) + '"') + (extra || '') + '><span>' + esc(text) + '</span></button>';
  }
  function dropdown(key, selected, options, onSelect, label) {
    ddRegistry[key] = { options: options, onSelect: onSelect };
    return '<div class="field"><div class="field-label">' + esc(label || 'Campus') + '</div>' +
      '<button class="btn btn-secondary" data-dd="' + esc(key) + '"><span>' + esc(selected) + '</span></button></div>';
  }
  // Compact one-line selector (Sales header): same dropdown overlay as dropdown(), much less height.
  function pillDropdown(key, selected, options, onSelect, label) {
    ddRegistry[key] = { options: options, onSelect: onSelect };
    return '<button class="pill" data-dd="' + esc(key) + '"><span class="k">' + esc(label) + '</span> ' + esc(selected) + ' ▾</button>';
  }
  function labeledField(id, label, value, onChange, placeholder, mode, plain) {
    actions['in_' + id] = onChange;
    return '<div class="field"><div class="field-label">' + esc(label) + '</div>' +
      '<input class="tf' + (plain ? ' plain' : '') + '" id="' + id + '" data-in="in_' + id + '" value="' + esc(value) + '"' +
      ' placeholder="' + esc(placeholder || '') + '"' + (mode ? ' inputmode="' + mode + '"' : '') +
      (mode === 'password' ? ' type="password"' : ' type="text"') + ' autocomplete="off" spellcheck="false"></div>';
  }
  function dateField(label, value, onChange) {
    var k = act(function () { openDatePicker(value, onChange); });
    return '<div class="field"><div class="field-label">' + esc(label) + '</div>' +
      '<div class="datefield" data-act="' + k + '"><span style="color:' + (value ? 'var(--ink)' : 'var(--ink3)') + '">' +
      esc(value || 'Select date') + '</span><span>📅</span></div></div>';
  }
  function thumb(p, size, icon) {
    var st = size ? 'width:' + size + 'px;height:' + size + 'px;' : '';
    var src = p && p.image && !failedImages[p.image] ? p.image : null;
    var inner = src ? '<img src="' + esc(src) + '" alt="" data-img="' + esc(src) + '" data-icon="' + (icon || 20) + '">' :
      '<span style="font-size:' + (icon || 20) + 'px">📦</span>';
    return '<div class="thumb" style="' + st + '">' + inner + '</div>';
  }
  function stockStatus(p) { return p.stock <= 0 ? 'OUT' : (p.stock <= p.minStock ? 'LOW' : 'OK'); }
  function stockBadge(status) {
    return '<span class="badge ' + status.toLowerCase() + '">' + status + '</span>';
  }
  function datePill(label, value, onChange) {
    return '<button class="pill" data-act="' + act(function () { openDatePicker(value, onChange); }) + '"><span class="k">' + esc(label) + '</span> ' + esc(value || '-') + '</button>';
  }
  // From / To pills + Search on one line; picking a date re-runs the search.
  function rangeBar(run) {
    return '<div class="filterbar">' +
      datePill('From', S.start, function (v) { S.start = v; run(); }) +
      datePill('To', S.end, function (v) { S.end = v; run(); }) +
      '<button class="pill go" data-act="' + act(run) + '">Search</button></div>';
  }
  function half(l, r) { return '<div class="row"><div class="half l">' + l + '</div><div class="half r">' + r + '</div></div>'; }
  function spacer(h) { return '<div style="height:' + h + 'px;flex:none"></div>'; }
  function txt(t, css) { return '<div style="' + (css || '') + '">' + esc(t) + '</div>'; }
  function loadingOr(emptyText, css) { return txt(S.loading ? 'Loading...' : emptyText, css); }
  function errorLine() { return S.error ? txt(S.error, 'color:var(--out);font-size:12px;padding-bottom:8px') : ''; }

  function openDatePicker(value, onChange) {
    var inp = document.createElement('input');
    inp.type = 'date'; inp.value = value || '';
    inp.style.cssText = 'position:fixed;left:50%;top:40%;opacity:0;width:1px;height:1px;';
    document.body.appendChild(inp);
    var done = function () { if (inp.value) { onChange(inp.value); render(); } setTimeout(function () { inp.remove(); }, 0); };
    inp.addEventListener('change', done);
    inp.addEventListener('blur', function () { setTimeout(function () { if (inp.parentNode) inp.remove(); }, 300); });
    try { inp.focus(); inp.showPicker(); } catch (e) {
      var v = window.prompt('Select date (yyyy-MM-dd)', value || '');
      if (v && /^\d{4}-\d{2}-\d{2}$/.test(v)) { onChange(v); render(); }
      inp.remove();
    }
  }
  function pickImage(capture, onPicked) {
    var inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    if (capture) inp.setAttribute('capture', 'environment');
    inp.addEventListener('change', function () {
      var f = inp.files && inp.files[0];
      if (f) { onPicked(URL.createObjectURL(f)); render(); }
    });
    inp.click();
  }
  function downloadFile(name, mime, content) {
    var url = URL.createObjectURL(new Blob([content], { type: mime }));
    var a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
  }

  // ------------------------------------------------------------------ screen state init
  function initScreen(r) {
    var today = new Date();
    var weekAgo = new Date(today.getTime() - 6 * 24 * 3600 * 1000);
    var campuses = allowedCampuses();
    var campus = campuses.indexOf(session.selectedCampus) >= 0 ? session.selectedCampus : (campuses[0] || MART_CAMPUS);
    switch (r) {
      case 'sales':
        S = { campus: campus, awaitingTap: false, paying: false, confirm: null, category: 'All', subcategory: 'All' };
        loadProducts(S.campus); break;
      case 'register':
        S = { campus: campus, photo: null, name: '', barcode: '', price: '', cost: '', qty: '', minStock: '5', desc: '', message: null, saving: false, category: null };
        vm.products = []; loadProducts(S.campus); break;
      case 'modify':
        S = { campus: campus, q: '', category: 'All', subcategory: 'All', selected: null, stock: '', minStock: '', price: '', message: null, pendingDelete: null };
        loadProducts(S.campus); break;
      case 'history':
        S = { campus: campus, start: ymd(new Date(Date.now() - 16 * 24 * 3600 * 1000)), end: ymd(today), all: [], category: 'All', subcategory: 'All' };
        runHistory(); break;
      case 'report':
        S = { campus: campus, start: ymd(weekAgo), end: ymd(today), report: null };
        runReport(); break;
      case 'buyer':
        S = {}; break;
      case 'pusanpay':
        S = { store: vm.pz.store, amount: vm.pz.amount, memo: vm.pz.memo, awaitingTap: false }; break;
      case 'paylist':
        // campus: the sales drill-down reads the same Pusan Mart rows as the Report Summary
        S = { view: 'daily', campus: MART_CAMPUS, start: ymd(weekAgo), end: ymd(today), results: [], daily: null,
          costDate: ymd(today), costInput: '', costMsg: null, costSaving: false };
        runPayList(); break;
      case 'receipt':
        S = {}; break;
      default: S = {};
    }
  }

  function navigate(r, replace) {
    if (ROUTES.indexOf(r) < 0) r = HOME;
    if (!routeAllowed(r)) r = r === 'paylist' ? 'report' : HOME;
    if (r === 'receipt' && !vm.last) r = HOME;
    route = r;
    ui.dropdown = null; ui.dialog = null;
    initScreen(r);
    var h = '#' + r;
    if (location.hash !== h) {
      if (replace) history.replaceState(null, '', location.pathname + location.search + h);
      else history.pushState(null, '', location.pathname + location.search + h);
    }
    render(true);
  }

  // ------------------------------------------------------------------ NFC
  function onNfc(uidStr) {
    uidStr = String(uidStr || '').trim();
    if (!uidStr) return;
    if (!session.manager) { toast('NFC tag read: ' + uidStr); return; }
    // The phone reader is always on, so a tap can come before the NFC box was pressed: pay right away when
    // the screen is ready (the box says "Payment completes as soon as you tap"), otherwise say why not.
    if (route === 'sales') {
      if (S.paying) { toast('Processing payment... please wait.'); return; }
      S.awaitingTap = false;
      showPayConfirm(uidStr, !vm.cart.length); // empty cart: only show the student's info and balance
    } else if (route === 'buyer') {
      lookupBuyer(uidStr);
    } else if (route === 'pusanpay') {
      if (vm.pz.submitting) { toast('Processing payment... please wait.'); return; }
      var amt = pusanFinalTotal();
      var storeOk = S.store.trim().replace(/ /g, '').toUpperCase() === 'PUSANMART';
      if (!storeOk || amt == null || !(amt > 0)) { toast('Card read (' + uidStr + '). Select the store and enter the amount first.', 3000); return; }
      S.awaitingTap = false;
      submitPusanmartPayment(uidStr, amt);
    } else {
      toast('Card read (' + uidStr + '). Open Buyer Info to look up this card.', 3000);
    }
  }

  // The phone reader stays on for the whole login: if it stopped between screens, Android would read the
  // card itself and show "Empty tag". onNfc() ignores taps on screens that are not waiting for a card.
  var phoneNfc = null;
  function wantsNfc() {
    // Sales always listens (a tap with an empty cart shows the student's info and balance; with items it opens Pay).
    // Register / Modify listen too so the barcode scanner's burst is caught there (onBarcode keeps it off the card path).
    return !!(session.manager && (route === 'buyer' || route === 'sales' || (route === 'pusanpay' && S.awaitingTap) ||
      ((route === 'register' || route === 'modify') && isPusan(S.campus))));
  }
  function syncNfc() {
    var N = window.PusanNfc;
    if (!N || !N.keepPhoneNfc) return;
    if (!phoneNfc) phoneNfc = N.keepPhoneNfc(function () { return !!session.manager; });
    else phoneNfc.refresh();
  }

  function checkoutWithUid(uidStr, campus) {
    var cart = vm.cart.slice(), label = vm.discountLabel, rate = vm.discountRate;
    if (!cart.length) return;
    var s = S;
    s.paying = true; vm.checkoutError = null; render();
    repo.checkout({
      uid: uidStr, store: storeFor(), campus: campus,
      cart: cart.map(function (it) {
        var line = { productId: it.product.id, quantity: it.quantity };
        if (it.disc && it.disc.amount != null) line.discountAmount = it.disc.amount;
        else if (it.disc) line.discountRate = it.disc.rate;
        return line;
      }),
      discountLabel: label, discountRate: rate
    }).then(function (c) {
      vm.last = { cart: cart, label: label, rate: rate, finalTotal: num(c.finalTotal), remaining: num(c.remainingBalance),
        uid: uidStr, buyerName: c.buyerName, orderId: c.orderId, campus: campus };
      vm.cart = [];
      s.paying = false;
      if (S === s) navigate('receipt');
    }, function (e) {
      s.paying = false;
      if (e.status === 0 || !e.status || e.status >= 500) {
        vm.checkoutError = 'An error occurred during checkout: ' + e.message; render(); return;
      }
      if (/insufficient balance/i.test(e.message)) {
        // Same wording as the Android app, which checks the balance before paying.
        repo.findPersonByUid(uidStr).then(function (p) {
          vm.checkoutError = p ? 'Insufficient balance. (Current balance: ₱' + money(p.totalMoney) + ', required: ₱' + money(cartTotalAfterDiscount()) + ')' : e.message;
          render();
        }, function () { vm.checkoutError = e.message; render(); });
        return;
      }
      var m = /^Insufficient stock: (.*)$/.exec(e.message);
      if (m && S === s) {
        repo.fetchProducts(campus).then(function (rows) {
          if (S === s) vm.products = rows;
          var it = cart.filter(function (c) { return c.product.sMenu === m[1]; })[0];
          var fresh = it && rows.filter(function (p) { return p.id === it.product.id; })[0];
          vm.checkoutError = it && fresh ? 'Insufficient stock: ' + m[1] + ' (requested: ' + it.quantity + ', in stock: ' + fresh.stock + ')' : e.message;
          render();
        }, function () { vm.checkoutError = e.message; render(); });
        return;
      }
      vm.checkoutError = e.message; render();
    });
  }

  // Sales: a card tap first shows the student's info; the staff checks it and presses Pay.
  // lookupOnly (tap with an empty cart): just show name / student ID / balance; it cannot be paid with.
  function showPayConfirm(uidStr, lookupOnly) {
    var s = S, c = { uid: uidStr, loading: true, person: null, error: null, lookupOnly: !!lookupOnly };
    s.confirm = c; vm.checkoutError = null; beep('ok'); render();
    repo.findPersonByUid(uidStr).then(function (p) {
      c.person = p;
      if (!p) c.error = 'This NFC card is not registered.';
    }, function (e) {
      c.error = 'An error occurred during lookup: ' + e.message;
    }).then(function () {
      c.loading = false;
      if (c.error) beep('error');
      if (S === s && s.confirm === c) {
        render();
        var el = document.getElementById('sales-scroll'); // bring the Pay / Cancel box into view
        if (el && !c.error) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      }
    });
  }
  function buyerChip() {
    var c = S.confirm; if (!c) return '';
    var x = '<span class="bx" data-act="' + act(function () { S.confirm = null; }) + '">✕</span>';
    if (c.loading) return '<div class="buyerchip">Looking up card...' + x + '</div>';
    if (c.error) return '<div class="buyerchip err">' + esc(c.error) + x + '</div>';
    var p = c.person;
    return '<div class="buyerchip"><div class="bi"><b>' + esc(p.name || '-') + '</b><span>' + esc(p.studentId || '-') + '</span></div>' +
      '<div class="bm">₱' + money(p.totalMoney) + '</div>' + x + '</div>';
  }

  function lookupBuyer(uidStr) {
    // Every tap starts from a blank card so the screen visibly refreshes with the latest data.
    vm.buyerResult = null; vm.buyerLookupError = null; vm.buyerLoading = true; beep('ok'); render();
    repo.findPersonByUid(uidStr).then(function (p) {
      vm.buyerResult = p;
      if (!p) vm.buyerLookupError = 'This card is not registered.';
    }, function (e) {
      vm.buyerResult = null;
      vm.buyerLookupError = 'An error occurred during lookup: ' + e.message;
    }).then(function () { vm.buyerLoading = false; render(); });
  }

  function pusanFinalTotal() {
    var sub = parseNum(S.amount);
    return sub == null ? null : sub - sub * vm.pz.rate;
  }
  // Pusan Pay: amount typed by the cashier + card tap = paid from the student's e-money right away.
  // Before paying, look at the server's payments: the same card + same amount within 10 minutes is most likely
  // a second tap (e.g. the first answer was slow or lost), so ask before charging again.
  var PZ_DUP_WINDOW_MS = 10 * 60 * 1000;
  function submitPusanmartPayment(uidStr, amount) {
    vm.pz.error = null; vm.pz.success = null; vm.pz.submitting = true; render();
    var today = ymd(new Date()), card = String(uidStr).toLowerCase(), cents = Math.round(amount * 100);
    repo.fetchPusanmartPayments(today, today).then(function (rows) {
      var now = Date.now();
      return rows.filter(function (r) {
        var t = Date.parse(String(r.date || '').replace(' ', 'T') + '+08:00'); // Philippine time
        return String(r.nfcid || '').toLowerCase() === card && Math.round(r.allPayments * 100) === cents &&
          !(now - t > PZ_DUP_WINDOW_MS);
      })[0] || null;
    }, function () { return null; }).then(function (dup) {
      if (dup) {
        beep('error');
        var ok = window.confirm('This payment was already made.\n' + (dup.name || uidStr) + ' — ₱' + money(dup.allPayments) +
          ' (' + String(dup.date || '').slice(11, 19) + ')\n\nCharge this card again?');
        if (!ok) { vm.pz.submitting = false; vm.pz.error = 'Duplicate payment cancelled.'; render(); return; }
      }
      payPusanmart(uidStr, amount);
    });
  }
  function payPusanmart(uidStr, amount) {
    var key = 'pz-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    repo.createPusanmartPayment(uidStr, amount, vm.pz.label, key, vm.pz.memo).then(function (p) {
      beep('ok');
      vm.pz.success = 'Paid ₱' + money(p.allPayments) + ' — ' + ((p && p.name) || uidStr) +
        (p && p.studentId ? ' (' + p.studentId + ')' : '') + '. Remaining balance ₱' + money(p.remainingBalance) + '.' +
        (p && p.memo ? (p.memoSaved === false ? ' (Memo NOT saved — DB update needed)' : ' Memo: ' + p.memo) : '');
      vm.pz.amount = ''; vm.pz.memo = '';
      if (route === 'pusanpay') { S.amount = ''; S.memo = ''; }
    }, function (e) {
      beep('error');
      vm.pz.error = e.status === 404 ? 'This NFC card is not registered.' :
        e.status === 409 || e.status === 423 ? e.message : 'An error occurred during payment: ' + e.message;
    }).then(function () { vm.pz.submitting = false; render(); });
  }

  // ------------------------------------------------------------------ screens
  function campusDropdown(key, onSelect) {
    return dropdown(key, S.campus, allowedCampuses(), onSelect);
  }
  // Landscape tablet / POS / PC: two-column Sales. Re-rendered when the window crosses the line (see resize).
  function isWide() {
    var w = window.innerWidth || document.documentElement.clientWidth, hgt = window.innerHeight || 0;
    return w >= 960 && w > hgt;
  }
  function salesScreen() {
    var allLabel = 'All';
    var catOpts = [allLabel].concat(uniqSorted(vm.products.map(function (p) { return p.mMenu; })));
    var base = S.category === allLabel ? vm.products : vm.products.filter(function (p) { return p.mMenu === S.category; });
    var subOpts = [allLabel].concat(uniqSorted(base.map(function (p) { return p.sMenu; })));
    var q = (S.search || '').trim().toLowerCase();
    var filtered = vm.products.filter(function (p) {
      return (S.category === allLabel || p.mMenu === S.category) && (S.subcategory === allLabel || p.sMenu === S.subcategory) &&
        (!q || String(p.sMenu || '').toLowerCase().indexOf(q) >= 0 || String(p.mMenu || '').toLowerCase().indexOf(q) >= 0 ||
          (p.barcode && p.barcode.toLowerCase().indexOf(q) >= 0));
    });
    actions.in_s_search = function (v) { S.search = v; };

    // Campus / category / subcategory sit in one compact menu row so the products, cart and total stay visible.
    var wide = isWide();
    var h = '<div class="screen' + (wide ? ' wide' : '') + '">' +
      '<div class="sb salesHead"><div class="title" style="padding:0">Sales</div>' +
      '<input class="tf search" id="s_search" data-in="in_s_search" type="search" placeholder="' + (isPusan(S.campus) ? '🔍 Search or scan barcode' : '🔍 Search product') + '" value="' + esc(S.search || '') + '" autocomplete="off" spellcheck="false">' +
      '<button class="iconbtn" title="Find product by photo" data-act="' + act(notInBrowser) + '">📷</button></div>' +
      // Tapped card's student info gets its own row under "Sales" so product search stays available.
      (S.confirm ? '<div class="buyerrow">' + buyerChip() + '</div>' : '') +
      '<div class="filterbar">' +
      pillDropdown('s_campus', S.campus, allowedCampuses(), function (v) { S.campus = v; session.selectedCampus = v; saveSession(); vm.cart = []; loadProducts(v); S.category = 'All'; S.subcategory = 'All'; }, '📍') +
      pillDropdown('s_cat', S.category, catOpts, function (v) { if (v !== S.category) S.subcategory = allLabel; S.category = v; }, 'Cat') +
      pillDropdown('s_sub', S.subcategory, subOpts, function (v) { S.subcategory = v; }, 'Sub') +
      '</div>' +
      (wide ? '<div class="salesMain">' : '') +
      '<div class="vscroll fill" id="sales-scroll">';
    if (S.error) h += errorLine();
    else if (!filtered.length) h += loadingOr('No products match the selected filters.', 'font-size:12px;color:var(--ink3);padding:12px 0');
    h += '<div class="grid">';
    filtered.forEach(function (p) {
      var out = p.stock <= 0;
      h += '<div class="pcell' + (out ? ' soldout' : '') + '" data-act="' + act(function () { addToCart(p); }) + '">' + thumb(p) + spacer(6) +
        '<div class="pname">' + esc(p.sMenu || '-') + '</div><div class="pprice">₱' + money(p.payment) + (out ? ' · <span style="color:var(--out)">Sold out</span>' : '') + '</div></div>';
    });
    h += '</div>';
    // Wide screen: products scroll on the left, cart + pay stay visible in a right column.
    var scan = isPusan(S.campus);
    var cartHead = scan ? cartScanHeader() : eyebrow('CART');
    if (wide) h += '</div><div class="cartPane"><div class="vscroll fill">' + cartHead + spacer(8);
    else h += '<div class="divider" style="margin:14px 0"></div>' + cartHead + spacer(8);
    if (!vm.cart.length) h += txt(scan ? 'Scan a barcode or select a product ' + (wide ? 'on the left.' : 'above.') :
      'Your cart is empty. Select a product ' + (wide ? 'on the left.' : 'above.'), 'font-size:12px;color:var(--ink3)');
    vm.cart.forEach(function (it) {
      var p = it.product, gross = p.payment * it.quantity, net = lineNet(it);
      var editing = S.discEdit === p.id;
      h += '<div class="cartrow' + (scan && S.lastScanId === p.id ? ' scanned' : '') + '">' + thumb(p, 40) +
        '<div class="cartname">' + esc(p.sMenu || '-') +
        '<div class="cartsub">' + (scan ? '₱' + money(p.payment) + ' × ' + it.quantity + ' = ' : '') +
        (net !== r2(gross) ? '<s>₱' + money(gross) + '</s> <b>₱' + money(net) + '</b>' : '<b>₱' + money(gross) + '</b>') + '</div></div>' +
        '<div class="disctag' + (it.disc ? ' on' : '') + (editing ? ' open' : '') + '" title="Item discount" data-act="' + act(function () {
          S.discEdit = editing ? null : p.id; S.discInput = ''; S.discMode = (it.disc && it.disc.amount != null) ? 'amount' : 'rate';
        }) + '">' + (it.disc ? esc(discTag(it.disc)) : '%') + '</div>' +
        '<div class="stepper"><div class="stepbtn" data-act="' + act(function () { changeQty(p, -1); }) + '">−</div>' +
        '<div class="stepqty">' + it.quantity + '</div>' +
        '<div class="stepbtn" data-act="' + act(function () { changeQty(p, 1); }) + '">+</div></div>' +
        (scan ? '<div class="cartdel" title="Remove from list" data-act="' + act(function () { removeLine(p); }) + '">✕</div>' : '') + '</div>';
      if (editing) h += itemDiscEditor(it);
    });
    h += spacer(4) + '<div class="chips">';
    [['No Discount', 0], ['Manager 15%', 0.15], ['Teacher 10%', 0.10]].forEach(function (c) {
      h += '<div class="chip' + (vm.discountLabel === c[0] ? ' sel' : '') + '" data-act="' + act(function () { vm.discountLabel = c[0]; vm.discountRate = c[1]; }) + '">' + c[0] + '</div>';
    });
    h += '</div>' + spacer(10) +
      (vm.cart.some(function (it) { return it.disc; }) ? txt('Items with their own discount (%-tag) ignore the cart discount above.', 'font-size:10.5px;color:var(--ink3);padding-top:6px') : '') +
      '<div class="sb" style="padding-top:10px"><span style="font-size:12px;color:var(--ink2)">Total</span>' +
      '<span style="font-size:13px;font-weight:700">₱' + money(cartTotalAfterDiscount()) + '</span></div>';
    if (vm.checkoutError) h += txt(vm.checkoutError, 'color:var(--out);font-size:12px;padding-top:8px');
    h += '</div>';
    // A balance lookup (tap with an empty cart) stays shown but is never payable: tap again to pay,
    // so a payment never goes to a previously looked-up card by mistake.
    if (S.confirm && !S.confirm.lookupOnly && !vm.cart.length) S.confirm = null;
    var c = S.confirm, total = cartTotalAfterDiscount();
    if (c && !c.loading && c.person && !c.lookupOnly && !S.paying) {
      // Card tapped: the student's info is under "Sales"; the staff checks it and confirms here.
      var after = c.person.totalMoney - total, short = after < 0;
      h += '<div class="paybox">' +
        '<div class="sb"><span>' + esc(c.person.name || '-') + ' · ' + esc(c.person.studentId || '-') + '</span><span>Balance ₱' + money(c.person.totalMoney) + '</span></div>' +
        '<div class="sb"><span>After payment</span><span style="font-weight:700' + (short ? ';color:var(--out)' : '') + '">₱' + money(after) + '</span></div>' +
        (short ? '<div style="color:var(--out);font-size:12px;padding-top:6px">Insufficient balance.</div>' : '') +
        '<div class="payacts"><button class="btn btn-secondary" data-act="' + act(function () { S.confirm = null; }) + '">Cancel</button>' +
        '<button class="btn btn-primary"' + (short ? ' disabled' : ' data-act="' + act(function () {
          var uid = c.uid; S.confirm = null; checkoutWithUid(uid, S.campus);
        }) + '"') + '>Pay ₱' + money(total) + '</button></div></div>';
    } else {
    var enabled = !S.paying;
    var wait = S.awaitingTap || S.paying;
    h += '<div class="nfcbox' + (wait ? ' wait' : '') + (enabled ? ' enabled' : '') + '"' +
      (enabled ? ' data-act="' + act(function () { vm.checkoutError = null; S.awaitingTap = true; }) + '"' : '') + '>' +
      '<div class="ic">📶</div>' +
      '<div style="font-size:12px;font-weight:700">' + (S.paying ? 'Processing payment...' : S.awaitingTap ? 'Please tap your NFC card...' : 'Tap your NFC card on the back of the phone') + '</div>' +
      '<div style="font-size:10.5px;color:var(--ink2)">' + (vm.cart.length ? 'Check the student info, then confirm payment' : 'Empty cart: tap to check student info and balance') + '</div></div>';
    }
    h += '</div>';
    if (wide) { h += '</div></div>'; return h; }   // .salesMain, .screen (cart always visible: no scroll-to-cart button)
    h += '<button class="fab" data-act="' + act(function () {
      var el = document.getElementById('sales-scroll'); if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }) + '" data-norender="1">⬇</button>';
    return h;
  }
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
  function addToCart(p) {
    var idx = -1;
    vm.cart.forEach(function (c, i) { if (c.product.id === p.id) idx = i; });
    var q = (idx >= 0 ? vm.cart[idx].quantity : 0) + 1;
    if (q > p.stock) {
      beep('error');
      toast(p.stock <= 0 ? 'Out of stock: ' + (p.sMenu || '-') : 'Not enough stock: ' + (p.sMenu || '-') + ' (in stock: ' + p.stock + ')', 1600);
      return;
    }
    if (idx >= 0) vm.cart[idx] = { product: vm.cart[idx].product, quantity: q, disc: vm.cart[idx].disc };
    else vm.cart.push({ product: p, quantity: 1 });
    beep('ok');
    toast('Added: ' + (p.sMenu || '-') + (q > 1 ? ' ×' + q : ''), 1200);
  }
  function changeQty(p, d) {
    var idx = -1;
    vm.cart.forEach(function (c, i) { if (c.product.id === p.id) idx = i; });
    if (idx < 0) return;
    var q2 = vm.cart[idx].quantity + d;
    if (d > 0 && q2 > p.stock) { beep('error'); toast('Not enough stock: ' + (p.sMenu || '-') + ' (in stock: ' + p.stock + ')', 1600); return; }
    if (q2 <= 0) vm.cart.splice(idx, 1); else vm.cart[idx] = { product: vm.cart[idx].product, quantity: q2, disc: vm.cart[idx].disc };
  }

  // Item discount editor under a cart line: presets, or a custom % / ₱ amount. "Cart" = use the cart-wide discount.
  function itemDiscEditor(it) {
    var p = it.product, d = it.disc, mode = S.discMode || 'rate', gross = p.payment * it.quantity;
    function close() { S.discEdit = null; S.discInput = ''; }
    var h = '<div class="discedit"><div class="chips">';
    [['Cart', null], ['0%', 0], ['10%', 0.1], ['20%', 0.2], ['30%', 0.3], ['50%', 0.5]].forEach(function (c) {
      var sel = c[1] === null ? !d : (d && d.amount == null && d.rate === c[1]);
      h += '<div class="chip' + (sel ? ' sel' : '') + '" data-act="' + act(function () {
        setLineDisc(p, c[1] === null ? null : { rate: c[1] }); close();
      }) + '">' + c[0] + '</div>';
    });
    h += '</div><div class="discrow">' +
      '<div class="scanmode"><span class="' + (mode === 'rate' ? 'on' : '') + '" data-act="' + act(function () { S.discMode = 'rate'; S.discInput = ''; }) + '">%</span>' +
      '<span class="' + (mode === 'amount' ? 'on' : '') + '" data-act="' + act(function () { S.discMode = 'amount'; S.discInput = ''; }) + '">₱</span></div>';
    actions.in_discinput = function (v) { S.discInput = v; };
    var v = parseNum(S.discInput || ''), bad = S.discInput && (v == null || v < 0 || (mode === 'rate' ? v > 100 : v > gross));
    h += '<input class="tf discinput" id="discinput" data-in="in_discinput" value="' + esc(S.discInput || '') + '" placeholder="' +
      (mode === 'rate' ? 'e.g. 25 (%)' : 'e.g. 10 (₱ off this line)') + '" inputmode="decimal" type="text" autocomplete="off">' +
      '<button class="btn btn-primary discapply"' + (v == null || bad ? ' disabled' : ' data-act="' + act(function () {
        setLineDisc(p, mode === 'rate' ? { rate: Math.round(v * 100) / 10000 } : { amount: r2(v) }); close();
      }) + '"') + '>Apply</button></div>' +
      (bad ? '<div style="color:var(--out);font-size:11px;padding-top:4px">' + (mode === 'rate' ? 'Enter 0 – 100.' : 'Enter 0 – ₱' + money(gross) + '.') + '</div>' : '') +
      '</div>';
    return h;
  }

  // Pusan Mart cart header: item count, scan mode (Add / Remove) and Clear.
  function cartScanHeader() {
    var qty = vm.cart.reduce(function (a, i) { return a + i.quantity; }, 0);
    var rm = !!S.scanRemove;
    return '<div class="carthead' + (rm ? ' removing' : '') + '"><div class="eyebrow" style="padding:0">CART · ' + vm.cart.length + ' items / ' + qty + ' pcs</div>' +
      '<div class="scanmode"><span class="' + (rm ? '' : 'on') + '" data-act="' + act(function () { S.scanRemove = false; }) + '">＋ Scan adds</span>' +
      '<span class="' + (rm ? 'on rm' : '') + '" data-act="' + act(function () { S.scanRemove = true; }) + '">− Scan removes</span></div>' +
      (vm.cart.length ? '<span class="cartclear" data-act="' + act(clearCart) + '">Clear</span>' : '') + '</div>' +
      (rm ? '<div class="rmnote">Remove mode: each scan takes 1 off the list. Switch back to “Scan adds” when done.</div>' : '');
  }

  function registerScreen() {
    var h = '<div class="screen"><div class="vscroll fill">' + eyebrow('Products') + title('Register Product') + productTabs() +
      campusDropdown('r_campus', function (v) { S.campus = v; S.category = null; vm.products = []; loadProducts(v); }) +
      registerCategoryDropdown() +
      '<div class="photobox">' + (S.photo ? '<img src="' + esc(S.photo) + '" alt="">' :
        '<div style="font-size:24px;line-height:normal;letter-spacing:0">📷</div>' + spacer(6) +
        '<div style="font-size:11.5px;color:var(--ink3)">Select a photo</div>') + '</div>' +
      '<div class="row" style="padding:6px 0 8px"><div class="half l">' + secondaryBtn('📷 Take Photo', function () { pickImage(true, function (u) { S.photo = u; }); }) +
      '</div><div class="half r">' + secondaryBtn('🖼 Choose from Gallery', function () { pickImage(false, function (u) { S.photo = u; }); }) + '</div></div>' + spacer(14) +
      labeledField('r_name', 'Product Name', S.name, function (v) { S.name = v; }, 'e.g. Coke Zero 245ml') +
      (isPusan(S.campus) ? labeledField('r_barcode', 'Barcode (scan anywhere on this screen)', S.barcode, function (v) { S.barcode = v; }, 'Scan with the barcode scanner or type') : '') +
      half(
        labeledField('r_price', 'Selling Price (PHP)', S.price, function (v) { S.price = v; }, '0.00', 'decimal'),
        labeledField('r_cost', 'Cost Price (PHP)', S.cost, function (v) { S.cost = v; }, '0.00', 'decimal')
      ) + marginLine(S.price, S.cost) +
      labeledField('r_qty', 'Quantity', S.qty, function (v) { S.qty = v; }, '0', 'numeric') +
      labeledField('r_min', 'Minimum Stock Threshold (Warn≤)', S.minStock, function (v) { S.minStock = v; }, 'e.g. 6', 'numeric') +
      labeledField('r_desc', 'Description', S.desc, function (v) { S.desc = v; }, 'Optional');
    if (S.message) h += txt(S.message, 'color:var(--brand);font-size:12px;padding-bottom:8px');
    h += primaryBtn(S.saving ? 'Registering...' : 'REGISTER', doRegister, S.saving) + spacer(24) + '</div></div>';
    return h;
  }
  // Category (m_menu) for a new product: the categories this campus's mart already uses, e.g.
  // "Pusan Mart(Drink)", "Pusan Mart(Cookie)", "Capital Mart". "+ New category" asks for a name.
  var NEW_CATEGORY = '+ New category…';
  function registerCategories() {
    var cats = uniqSorted(vm.products.map(function (p) { return String(p.mMenu || '').trim(); }).filter(Boolean));
    if (S.category && cats.indexOf(S.category) < 0) cats.push(S.category);
    return cats;
  }
  function registerCategoryDropdown() {
    var cats = registerCategories();
    if (!S.category) {
      var def = martMenuFor(S.campus);
      S.category = cats.indexOf(def) >= 0 ? def : (cats[0] || null);
    }
    return dropdown('r_cat', S.category || (S.loading ? 'Loading…' : 'Select category'), cats.concat([NEW_CATEGORY]), function (v) {
      if (v !== NEW_CATEGORY) { S.category = v; return; }
      var name = window.prompt('New category name', S.category || '');
      if (name && name.trim()) S.category = name.trim();
    }, 'Category');
  }
  function doRegister() {
    var price = parseNum(S.price), qty = parseIntStrict(S.qty), min = parseIntStrict(S.minStock);
    if (min == null) min = 5;
    if (!S.category) { S.message = 'Please select a category.'; return; }
    if (!S.name.trim() || price == null || qty == null) { S.message = 'Please enter a valid product name, price, and quantity.'; return; }
    var cost = String(S.cost || '').trim() ? parseNum(S.cost) : null;
    if (String(S.cost || '').trim() && (cost == null || cost < 0)) { S.message = 'Please enter a valid cost price.'; return; }
    var wanted = S.name.trim().replace(/\s+/g, ' ').toUpperCase();
    var dup = vm.products.filter(function (p) { return String(p.sMenu || '').trim().replace(/\s+/g, ' ').toUpperCase() === wanted; })[0];
    if (dup && !window.confirm('"' + dup.sMenu + '" is already registered (' + (dup.mMenu || '-') + ', stock ' + dup.stock + ').\n' +
        'Use Products › Edit to change its stock or price.\n\nRegister it again anyway?')) return;
    var bc = isPusan(S.campus) ? cleanCode(S.barcode) : '';
    var bcDup = bc && vm.products.filter(function (p) { return p.barcode === bc; })[0];
    if (bcDup) { S.message = 'Barcode ' + bc + ' is already used by "' + (bcDup.sMenu || '-') + '".'; return; }
    var s = S, hadPhoto = !!S.photo;
    s.saving = true; s.message = null;
    // Same row as DbRepository.insertProduct: Campus upper-cased, m_menu = the chosen category. The Android app
    // uploads the photo by SFTP first; a browser cannot, so the product is saved without an image.
    var regName = s.name.trim();
    repo.createProduct({ campus: s.campus.toUpperCase(), mMenu: s.category, sMenu: regName, payment: price, cost: cost == null ? undefined : cost, stock: qty, minStock: min, barcode: bc || undefined })
      .then(function (product) {
        s.message = 'Registered: ' + regName + ' (' + s.category + ')';
        if (product) vm.products.push(normProduct(product));
        toast('✅ Registered: ' + regName, 2500);
        s.name = ''; s.price = ''; s.cost = ''; s.qty = ''; s.desc = ''; s.photo = null;
        if (hadPhoto && S === s) toast('✅ Registered: ' + regName + ' — photo not uploaded (the browser cannot upload product photos).', 4000);
      }, function (e) { s.message = 'Registration failed: ' + e.message; })
      .then(function () { s.saving = false; render(); });
  }

  function modifyScreen() {
    var catOpts = ['All'].concat(uniqSorted(vm.products.map(function (p) { return p.mMenu; })));
    if (catOpts.indexOf(S.category) < 0) S.category = 'All';
    var base = S.category === 'All' ? vm.products : vm.products.filter(function (p) { return p.mMenu === S.category; });
    var subOpts = ['All'].concat(uniqSorted(base.map(function (p) { return p.sMenu; })));
    if (subOpts.indexOf(S.subcategory) < 0) S.subcategory = 'All';
    // Search (name / category / barcode / item code) searches every product and ignores the Category filters.
    var q = String(S.q || '').trim().toLowerCase(), qc = cleanCode(S.q || '').toLowerCase();
    var filtered = vm.products.filter(function (p) {
      if (q) return String(p.sMenu || '').toLowerCase().indexOf(q) >= 0 || String(p.mMenu || '').toLowerCase().indexOf(q) >= 0 ||
        (qc && p.barcode && p.barcode.toLowerCase().indexOf(qc) >= 0) || (qc && p.itemCode && String(p.itemCode).toLowerCase().indexOf(qc) >= 0);
      return (S.category === 'All' || p.mMenu === S.category) && (S.subcategory === 'All' || p.sMenu === S.subcategory);
    });
    actions.in_m_search = function (v) { S.q = v; };
    var h = '<div class="screen"><div class="vscroll fill">' + eyebrow('Products') + title('Edit Products') + productTabs() +
      '<div class="sb" style="padding-bottom:8px"><input class="tf search" id="m_search" data-in="in_m_search" type="search" placeholder="' +
      (isPusan(S.campus) ? '🔍 Product name or scan barcode' : '🔍 Product name') + '" value="' + esc(S.q || '') + '" autocomplete="off" spellcheck="false">' +
      (S.q ? '<button class="pill" style="margin-left:6px" data-act="' + act(function () { S.q = ''; S.selected = null; focusLater('m_search'); }) + '">Clear</button>' : '') + '</div>' +
      campusDropdown('m_campus', function (v) { S.campus = v; S.selected = null; loadProducts(v); }) +
      dropdown('m_cat', S.category, catOpts, function (v) { S.category = v; S.subcategory = 'All'; }, 'Category') +
      dropdown('m_sub', S.subcategory, subOpts, function (v) { S.subcategory = v; }, 'Subcategory');
    if (S.error) h += errorLine();
    if (!filtered.length && q && vm.products.length) {
      // Not found: offer to register it as a new product (barcode-like input fills Barcode, anything else fills Name).
      var raw = String(S.q).trim(), isCode = /^[0-9A-Za-z-]{6,}$/.test(raw) && /\d/.test(raw) && !/\s/.test(raw);
      h += txt('No products found for "' + raw + '".', 'font-size:12.5px;color:var(--ink2);padding:8px 0') +
        primaryBtn('+ Register as new product', function () {
          navigate('register');
          if (isCode) { S.barcode = cleanCode(raw); focusLater('r_name'); } else { S.name = raw; focusLater('r_price'); }
        }) + spacer(8);
    } else if (!filtered.length) h += loadingOr('No products match the selected filters.', 'font-size:12.5px;color:var(--ink2);padding:8px 0');
    else if (q) h += txt(filtered.length + ' product' + (filtered.length > 1 ? 's' : '') + ' found', 'font-size:11.5px;color:var(--ink2);padding-bottom:6px');
    if (S.message && !S.selected) h += txt(S.message, 'color:var(--brand);font-size:12px;padding-bottom:8px');
    filtered.forEach(function (p) {
      var st = stockStatus(p), isSel = S.selected === p.id;
      var bc = st === 'OK' ? 'var(--border)' : st === 'LOW' ? 'var(--low)' : 'var(--out)';
      h += '<div class="mitem ' + (isSel ? 'sel' : st.toLowerCase()) + '">' +
        '<div class="mhead" data-act="' + act(function () {
          if (isSel) S.selected = null;
          else { S.selected = p.id; S.stock = String(p.stock); S.minStock = String(p.minStock); S.price = String(p.payment); S.cost = p.cost == null ? '' : String(p.cost); S.barcode = p.barcode || ''; S.message = null; }
        }) + '">' + thumb(p, 40) + '<div class="info"><div style="font-size:12.5px;font-weight:700">' + esc(p.sMenu || '-') + '</div>' +
        '<div style="font-size:10.5px;color:var(--ink2)">₱' + money(p.payment) + (p.cost != null ? ' (cost ₱' + money(p.cost) + ')' : '') + ' · Stock ' + p.stock + ' · Threshold ' + p.minStock + (p.barcode ? ' · ' + esc(p.barcode) : '') + '</div></div>' + stockBadge(st) + '</div>';
      if (isSel) {
        h += '<div class="divider" style="background:' + bc + '"></div><div style="padding:10px">' +
          half(
            labeledField('m_stock', 'Stock Quantity', S.stock, function (v) { S.stock = v; }, '', 'numeric'),
            labeledField('m_min', 'Minimum Stock Threshold', S.minStock, function (v) { S.minStock = v; }, '', 'numeric')
          ) +
          half(
            labeledField('m_price', 'Selling Price (PHP)', S.price, function (v) { S.price = v; }, '', 'decimal'),
            labeledField('m_cost', 'Cost Price (PHP)', S.cost, function (v) { S.cost = v; }, 'Not set', 'decimal')
          ) + marginLine(S.price, S.cost) +
          (isPusan(S.campus) ? labeledField('m_barcode', 'Barcode', S.barcode, function (v) { S.barcode = v; }, 'Scan or type') : '');
        if (S.message) h += txt(S.message, 'color:var(--brand);font-size:12px;padding-bottom:8px');
        h += primaryBtn(S.saving ? 'Saving...' : 'Save Changes', function () { saveModify(p); }, S.saving) + spacer(8) +
          '<button class="btn-text" style="color:var(--out)" data-act="' + act(function () { S.pendingDelete = p; }) + '">Delete Product</button></div>';
      }
      h += '</div>';
    });
    h += spacer(24) + '</div></div>';
    if (S.pendingDelete) {
      var d = S.pendingDelete;
      h += '<div class="dlgscrim" data-act="' + act(function () { S.pendingDelete = null; }) + '" data-self="1">' +
        '<div class="dialog"><div class="dt">Delete Product</div>' +
        '<div class="dx">Delete "' + esc(d.sMenu || 'this product') + '"? This cannot be undone.</div>' +
        '<div class="da"><button data-act="' + act(function () { S.pendingDelete = null; }) + '">Cancel</button>' +
        '<button style="color:var(--out);font-weight:700" data-act="' + act(function () { deleteProduct(d); }) + '">Delete</button></div></div></div>';
    }
    return h;
  }
  // Profit per unit and margin under the price fields, so a wrong cost (e.g. a box price) shows at once.
  function marginLine(price, cost) {
    var pr = parseNum(price), c = String(cost || '').trim() ? parseNum(cost) : null;
    if (pr == null || c == null) return '';
    var profit = pr - c, pct = pr > 0 ? Math.round(profit / pr * 1000) / 10 : 0;
    return txt('Profit ₱' + money(profit) + ' per unit · margin ' + pct + '%',
      'font-size:11.5px;padding:0 0 8px;color:' + (profit < 0 ? 'var(--out)' : 'var(--ink2)'));
  }
  function saveModify(p) {
    var ns = parseIntStrict(S.stock), nm = parseIntStrict(S.minStock), np = parseNum(S.price);
    if (ns == null || nm == null) { S.message = 'Please enter a valid stock quantity.'; return; }
    var s = S, changes = { stock: ns, minStock: nm };
    if (np != null) changes.payment = np;
    var rawCost = String(S.cost || '').trim(), nc = rawCost ? parseNum(rawCost) : null;
    if (rawCost && (nc == null || nc < 0)) { S.message = 'Please enter a valid cost price.'; return; }
    if (nc !== p.cost) changes.cost = nc;
    if (isPusan(S.campus) && cleanCode(S.barcode) !== (p.barcode || '')) {
      var nb = cleanCode(S.barcode);
      var used = nb && vm.products.filter(function (x) { return x.barcode === nb && x.id !== p.id; })[0];
      if (used) { S.message = 'Barcode ' + nb + ' is already used by "' + (used.sMenu || '-') + '".'; return; }
      changes.barcode = nb;
    }
    s.saving = true; s.message = null;
    repo.updateProduct(p.id, changes).then(function (row) {
      var np2 = normProduct(row);
      vm.products = vm.products.map(function (x) { return x.id === np2.id ? np2 : x; });
      s.message = 'Changes saved.';
    }, function (e) { s.message = 'Failed to save changes: ' + e.message; })
      .then(function () { s.saving = false; render(); });
  }
  function deleteProduct(d) {
    var s = S;
    s.pendingDelete = null;
    repo.deleteProduct(d.id).then(function () {
      if (s.selected === d.id) s.selected = null;
      s.message = 'Product deleted.';
      if (S === s) loadProducts(s.campus);
    }, function (e) { s.message = 'Failed to delete product: ' + e.message; render(); });
  }

  function runHistory() {
    screenLoad(repo.fetchHistory(S.campus, S.start, S.end), function (rows) { S.all = rows; },
      function (e) { S.all = []; S.error = 'Failed to load history: ' + e.message; });
  }
  function historyScreen() {
    var all = S.all;
    var catOpts = ['All'].concat(uniqSorted(all.map(function (t) { return t.category; })));
    if (catOpts.indexOf(S.category) < 0) S.category = 'All';
    var base = S.category === 'All' ? all : all.filter(function (t) { return t.category === S.category; });
    var subOpts = ['All'].concat(uniqSorted(base.map(function (t) { return t.subcategory; })));
    if (subOpts.indexOf(S.subcategory) < 0) S.subcategory = 'All';
    var results = all.filter(function (t) {
      return (S.category === 'All' || t.category === S.category) && (S.subcategory === 'All' || t.subcategory === S.subcategory);
    });
    // Compact filters (pills) so most of the screen is left for the transaction list.
    var total = results.reduce(function (a, t) { return a + num(t.payment); }, 0);
    var h = '<div class="screen"><div class="vscroll fill">' + eyebrow('Report') + title('Sales History') + reportTabs() +
      '<div class="filterbar">' +
      pillDropdown('h_campus', S.campus, allowedCampuses(), function (v) { S.campus = v; runHistory(); }, '📍') + '</div>' +
      rangeBar(runHistory) +
      '<div class="filterbar">' +
      pillDropdown('h_cat', S.category, catOpts, function (v) { if (v !== S.category) S.subcategory = 'All'; S.category = v; }, 'Cat') +
      pillDropdown('h_sub', S.subcategory, subOpts, function (v) { S.subcategory = v; }, 'Sub') + '</div>' +
      (results.length ? '<div class="sb histsum"><span>' + results.length + ' transactions</span><span>₱' + money(total) + '</span></div>' : '') +
      errorLine();
    if (!results.length && !S.error) h += loadingOr('No sales history found.', 'font-size:12px;color:var(--ink3)');
    results.forEach(function (t) {
      var qty = num(t.quantity);
      h += '<div class="card histrow">' +
        '<div class="sb"><b>' + esc((t.subcategory || '-') + (qty > 1 ? ' × ' + qty : '')) + '</b><b>₱' + money(t.payment) + '</b></div>' +
        '<div class="sb sub"><span>' + esc((t.name || '-') + ' · ' + (t.campus || '-') + ' · ' + (t.remark || t.source || 'office')) + '</span><span>' + esc(t.date || '') + '</span></div>' +
        '</div>';
    });
    h += '</div></div>';
    return h;
  }

  function runReport() {
    S.catView = null; S.itemView = false; S.sales = null;
    var sales = repo.fetchHistory(S.campus, S.start, S.end).then(function (rows) {
      return rows.filter(function (t) { return !t.type || t.type === 'decrease'; });
    }, function () { return null; });
    screenLoad(Promise.all([repo.fetchWeeklyReport(S.campus, S.start, S.end), sales]), function (v) { S.report = v[0]; S.sales = v[1]; },
      function (e) { S.error = 'Failed to load report: ' + e.message; });
  }
  // Sales rows grouped by key(t): [{ name, total, qty, count, rows }] sorted by revenue.
  function groupSales(rows, key) {
    var m = {}, out = [];
    rows.forEach(function (t) {
      var k = key(t) || '-';
      var g = m[k] || (m[k] = out[out.length] = { name: k, total: 0, qty: 0, count: 0, rows: [] });
      g.total += num(t.payment); g.qty += num(t.quantity) || 1; g.count++; g.rows.push(t);
    });
    return out.sort(function (a, b) { return b.total - a.total; });
  }
  function groupRow(g, sub, onTap) {
    return '<div class="listrow tap" style="justify-content:space-between"' + tapAttr(onTap) + '><div style="min-width:0;padding-right:8px">' +
      '<div style="font-size:12.5px;font-weight:700">' + esc(g.name) + '</div>' +
      '<div style="font-size:10.5px;color:var(--ink3)">' + esc(sub) + '</div></div>' +
      '<div style="font-size:12.5px;font-weight:700;flex:none">₱' + money(g.total) + ' <span style="color:var(--brand)">›</span></div></div>';
  }
  // Category → its products; tapping a product opens the transactions behind it.
  function categoryScreen() {
    var c = S.catView, from = S.start, to = S.end;
    var products = groupSales(c.rows, function (t) { return t.subcategory; });
    var h = '<div class="screen">' + eyebrow('Report · Category') + title(c.name) +
      '<div style="padding-bottom:10px">' + secondaryBtn('← Back', function () { S.catView = null; }) + '</div>' +
      '<div class="sb" style="padding-bottom:10px"><span style="font-size:12px;color:var(--ink2)">' + esc(rangeText(from, to)) + ' · ' +
      products.length + ' products · ' + c.count + ' transactions</span><span style="font-size:13px;font-weight:700">₱' + money(c.total) + '</span></div>' +
      '<div class="vscroll fill">';
    products.forEach(function (g) {
      h += groupRow(g, 'Qty ' + comma(g.qty) + ' · ' + g.count + ' transactions', function () { openRowsDetail(g.name, from, to, g.rows); });
    });
    h += '</div></div>';
    return h;
  }
  // Every item sold in the range with its quantity (most sold first); tapping an item opens its transactions.
  function itemsByQty(rows) {
    return groupSales(rows, function (t) { return t.subcategory; }).sort(function (a, b) { return b.qty - a.qty || b.total - a.total; });
  }
  function itemQtyRow(g, idx, from, to) {
    return '<div class="listrow tap" style="justify-content:space-between"' + tapAttr(function () { openRowsDetail(g.name, from, to, g.rows); }) + '>' +
      '<div style="display:flex;align-items:center;min-width:0;flex:1"><div class="rank" style="background:' + (idx === 0 ? 'var(--brand)' : 'var(--ink)') + '">' + (idx + 1) + '</div>' +
      '<div style="min-width:0;padding:0 8px"><div style="font-size:12.5px;font-weight:700">' + esc(g.name) + '</div>' +
      '<div style="font-size:10.5px;color:var(--ink3)">' + esc((g.rows[0].category || '-') + ' · ₱' + money(g.total)) + '</div></div></div>' +
      '<div style="font-size:13px;font-weight:800;flex:none">' + comma(g.qty) + ' <span style="font-size:10.5px;font-weight:600;color:var(--ink3)">pcs</span></div></div>';
  }
  function itemsScreen() {
    var from = S.start, to = S.end, items = itemsByQty(S.sales || []);
    var tQty = items.reduce(function (a, g) { return a + g.qty; }, 0), tAmt = items.reduce(function (a, g) { return a + g.total; }, 0);
    var h = '<div class="screen">' + eyebrow('Report · Items') + title('Sales by Item') +
      '<div style="padding-bottom:10px">' + secondaryBtn('← Back', function () { S.itemView = false; }) + '</div>' +
      '<div class="sb" style="padding-bottom:10px"><span style="font-size:12px;color:var(--ink2)">' + esc(rangeText(from, to) + ' · ' + S.campus) + ' · ' +
      items.length + ' items</span><span style="font-size:13px;font-weight:700">Qty ' + comma(tQty) + ' · ₱' + money(tAmt) + '</span></div>' +
      primaryBtn('⬇ Download Excel', function () { downloadItemsCsv(items, from, to); }, !items.length) + spacer(10) +
      '<div class="vscroll fill">';
    if (!items.length) h += txt('No sales in this period.', 'font-size:12px;color:var(--ink3)');
    items.forEach(function (g, i) { h += itemQtyRow(g, i, from, to); });
    h += '</div></div>';
    return h;
  }
  function downloadItemsCsv(items, from, to) {
    var tQty = 0, tAmt = 0;
    var rows = [['No', 'Category', 'Item', 'Qty', 'Amount (PHP)', 'Transactions']];
    items.forEach(function (g, i) {
      tQty += g.qty; tAmt += g.total;
      rows.push([i + 1, g.rows[0].category || '', g.name, g.qty, money(g.total), g.count]);
    });
    rows.push([]);
    rows.push(['', 'Total', items.length + ' items', tQty, money(tAmt)]);
    rows.push(['Search Range', rangeText(from, to)]);
    csvDownload('items_' + String(S.campus).replace(/\s+/g, '') + '_' + from + '_' + to + '.csv', rows);
  }
  function openRowsDetail(label, from, to, rows) {
    S.detail = { kind: 'sales', label: label, from: from, to: to, item: label, rows: rows, loading: false, error: null };
  }

  // ----- drill-down: tapping a sales number on Summary / Pay List opens the rows behind it
  // kind 'sales': bank sale rows (same rows /api/reports/sales sums: transaction_type decrease)
  // kind 'pay':   PusanmartPayments rows, with unit price (before discount) / discount / paid
  function openDetail(kind, label, from, to, item) {
    var s = S, d = { kind: kind, label: label, from: from, to: to, item: item || null, rows: null, loading: true, error: null };
    s.detail = d;
    var p = kind === 'pay' ? repo.fetchPusanmartPayments(from, to) : repo.fetchHistory(s.campus, from, to).then(function (rows) {
      return rows.filter(function (t) { return (!t.type || t.type === 'decrease') && (!d.item || t.subcategory === d.item); });
    });
    p.then(function (rows) { d.rows = rows; }, function (e) { d.rows = []; d.error = 'Failed to load details: ' + e.message; })
      .then(function () { d.loading = false; if (S === s && s.detail === d) render(); });
  }
  function rangeText(from, to) { return from === to ? from : from + ' ~ ' + to; }
  function csvDownload(name, rows) {
    var cell = function (v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    downloadFile(name, 'text/csv;charset=utf-8', '﻿' + rows.map(function (x) { return x.map(cell).join(','); }).join('\r\n'));
    toast('Saved to Downloads: ' + name, 3500);
  }
  function payUnit(r) { return r.unitPrice != null ? num(r.unitPrice) : r.allPayments; }
  // Pusan Pay export: unit price (amount typed before the discount), discount, paid amount per payment.
  function downloadPayCsv(list, from, to) {
    var tUnit = 0, tDisc = 0, tPaid = 0;
    var rows = [['No', 'Date', 'Name', 'NFC ID', 'Unit Price (PHP)', 'Discount', 'Discount Amount (PHP)', 'Paid Amount (PHP)', 'Memo', 'Staff']];
    list.forEach(function (r, i) {
      var unit = payUnit(r), disc = unit - r.allPayments;
      tUnit += unit; tDisc += disc; tPaid += r.allPayments;
      rows.push([i + 1, r.date || '-', r.name || '-', r.nfcid, money(unit), r.discountLabel || 'No Discount', money(disc), money(r.allPayments), r.memo || '', r.staff || '']);
    });
    rows.push([]);
    rows.push(['', 'Total', '', list.length + ' payments', money(tUnit), '', money(tDisc), money(tPaid)]);
    rows.push(['Search Range', rangeText(from, to)]);
    csvDownload('pusanpay_' + from + '_' + to + '.csv', rows);
  }
  function downloadSalesCsv(d) {
    var tQty = 0, tAmt = 0;
    var rows = [['No', 'Date', 'Buyer', 'Student ID', 'Campus', 'Category', 'Item', 'Qty', 'Unit Price (PHP)', 'Amount (PHP)', 'Discount / Remark', 'Source', 'Order']];
    d.rows.forEach(function (t, i) {
      var qty = num(t.quantity), amt = num(t.payment);
      tQty += qty; tAmt += amt;
      rows.push([i + 1, t.date || '', t.name || '', t.studentId || '', t.campus || '', t.category || '', t.subcategory || '', qty,
        qty ? money(amt / qty) : '', money(amt), t.remark || '', t.source || '', t.order || '']);
    });
    rows.push([]);
    rows.push(['', 'Total', '', '', '', '', d.rows.length + ' rows', tQty, '', money(tAmt)]);
    rows.push(['Search Range', rangeText(d.from, d.to)]);
    csvDownload('sales_' + String(S.campus).replace(/\s+/g, '') + '_' + d.from + '_' + d.to + '.csv', rows);
  }
  function payCard(r) {
    var unit = payUnit(r), disc = unit - r.allPayments;
    return '<div class="card sb" style="margin-bottom:8px;padding:10px"><div style="min-width:0">' +
      '<div style="font-size:12.5px;font-weight:700">' + esc(r.name || '-') + '</div>' +
      '<div style="font-size:10.5px;color:var(--ink2)">NFC ' + esc(r.nfcid) + '</div>' +
      '<div style="font-size:10px;color:var(--ink3)">' + esc(r.date || '') + '</div>' +
      (r.memo ? '<div style="font-size:10.5px;color:var(--ink2);padding-top:2px">📝 ' + esc(r.memo) + '</div>' : '') + '</div>' +
      '<div style="text-align:right;flex:none">' +
      (disc > 0.004 ? '<div style="font-size:10.5px;color:var(--ink3)">₱' + money(unit) + ' · ' + esc(r.discountLabel || '') + '</div>' : '') +
      '<div style="font-size:12px;font-weight:700">₱' + money(r.allPayments) + '</div></div></div>';
  }
  function detailScreen() {
    var d = S.detail, rows = d.rows || [];
    var total = rows.reduce(function (a, t) { return a + (d.kind === 'pay' ? t.allPayments : num(t.payment)); }, 0);
    var h = '<div class="screen">' + eyebrow('Report · Details') + title(d.label) +
      '<div style="padding-bottom:10px">' + secondaryBtn('← Back', function () { S.detail = null; }) + '</div>' +
      '<div class="sb" style="padding-bottom:10px"><span style="font-size:12px;color:var(--ink2)">' + esc(rangeText(d.from, d.to)) +
      (d.kind === 'sales' ? ' · ' + esc(S.campus) : '') + ' · ' + rows.length + (d.kind === 'pay' ? ' payments' : ' rows') + '</span>' +
      '<span style="font-size:13px;font-weight:700">Total ₱' + money(total) + '</span></div>';
    if (d.kind === 'pay') {
      var unitTotal = rows.reduce(function (a, r) { return a + payUnit(r); }, 0);
      if (unitTotal - total > 0.004) h += txt('Unit price total ₱' + money(unitTotal) + ' · discount ₱' + money(unitTotal - total), 'font-size:11.5px;color:var(--ink2);padding-bottom:8px');
    }
    h += primaryBtn('⬇ Download Excel', function () { if (d.kind === 'pay') downloadPayCsv(rows, d.from, d.to); else downloadSalesCsv(d); }, !rows.length) +
      spacer(10) + '<div class="vscroll fill">';
    if (d.error) h += txt(d.error, 'color:var(--out);font-size:12px;padding-bottom:8px');
    if (!rows.length && !d.error) h += txt(d.loading ? 'Loading...' : 'No sales in this period.', 'font-size:12px;color:var(--ink3)');
    rows.forEach(function (t) {
      if (d.kind === 'pay') { h += payCard(t); return; }
      var qty = num(t.quantity);
      h += '<div class="card sb" style="margin-bottom:8px;padding:10px"><div style="min-width:0">' +
        '<div style="font-size:12.5px;font-weight:700">' + esc((t.subcategory || '-') + (qty > 1 ? ' × ' + qty : '')) + '</div>' +
        '<div style="font-size:10.5px;color:var(--ink2)">Buyer: ' + esc(t.name || '-') + '</div>' +
        '<div style="font-size:10.5px;color:var(--ink2)">' + esc((t.campus || '-') + ' · ' + (t.remark || t.source || 'office')) + '</div>' +
        '<div style="font-size:10px;color:var(--ink3)">' + esc(t.date || '') + '</div></div>' +
        '<div style="text-align:right;flex:none">' + (qty > 1 ? '<div style="font-size:10.5px;color:var(--ink3)">₱' + money(num(t.payment) / qty) + ' ea</div>' : '') +
        '<div style="font-size:12px;font-weight:700">₱' + money(t.payment) + '</div></div></div>';
    });
    h += '</div></div>';
    return h;
  }
  function tapAttr(fn) { return ' data-act="' + act(fn) + '"'; }
  function reportScreen() {
    if (S.detail) return detailScreen();
    if (S.catView) return categoryScreen();
    if (S.itemView) return itemsScreen();
    var h = '<div class="screen"><div class="vscroll fill">' + eyebrow('Report') + title('Report') + reportTabs() +
      '<div class="filterbar">' + pillDropdown('rp_campus', S.campus, allowedCampuses(), function (v) { S.campus = v; runReport(); }, '📍') + '</div>' +
      rangeBar(runReport) + errorLine();
    var r = S.report;
    if (!r && S.loading) h += txt('Loading...', 'font-size:12px;color:var(--ink3)');
    if (r) {
      var stat = function (label, value, color, onTap) {
        return '<div class="stat' + (onTap ? ' tap' : '') + '"' + (onTap ? tapAttr(onTap) : '') + '><div class="lab">' + esc(label) + '</div><div class="val" style="color:' + (color || 'var(--ink)') + '">' + esc(value) + '</div></div>';
      };
      var from = S.start, to = S.end;
      var allSales = function () { openDetail('sales', 'Sales Details', from, to); };
      h += primaryBtn('⬇ Download Report PDF', notInBrowser, false, ' style="height:38px"') + spacer(10) +
        '<div class="row" style="gap:8px">' + stat('Total Revenue', '₱' + comma(Math.round(r.totalRevenue)), null, allSales) + stat('Transactions', comma(r.transactionCount), null, allSales) + '</div>' + spacer(8) +
        '<div class="row" style="gap:8px">' + stat('Avg. Order Value', '₱' + comma(r.avgOrderValue, 2)) + stat('Low Stock Alerts', String(r.lowStock.length), 'var(--low)') + '</div>' +
        spacer(16) + eyebrow('Daily Sales') + spacer(8);
      var maxVal = Math.max(1, r.dailyTotals.reduce(function (m, d) { return Math.max(m, d[1]); }, 0));
      h += '<div class="bars">';
      r.dailyTotals.forEach(function (d) {
        var f = Math.min(1, Math.max(0.04, d[1] / maxVal));
        h += '<div class="col tap" title="' + esc(d[0] + ' ₱' + money(d[1])) + '"' + tapAttr(function () { openDetail('sales', 'Sales ' + d[0], d[0], d[0]); }) +
          '><div class="bar" style="height:' + (f * 100) + '%"></div></div>';
      });
      h += '</div><div class="barlabels">';
      r.dailyTotals.forEach(function (d) { h += '<div class="tap"' + tapAttr(function () { openDetail('sales', 'Sales ' + d[0], d[0], d[0]); }) + '>' + esc(d[0].slice(-2)) + '</div>'; });
      h += '</div>' + spacer(16) + '<div class="divider"></div>' + spacer(12) + eyebrow('Sales by Item (Quantity)') + spacer(8);
      if (!S.sales) h += txt(S.loading ? 'Loading...' : 'Item breakdown unavailable.', 'font-size:12px;color:var(--ink3)');
      else if (!S.sales.length) h += txt('No sales in this period.', 'font-size:12px;color:var(--ink3)');
      else {
        var items = itemsByQty(S.sales);
        items.slice(0, 10).forEach(function (g, i) { h += itemQtyRow(g, i, from, to); });
        h += spacer(8) + secondaryBtn('View all ' + items.length + ' items ›', function () { S.itemView = true; });
      }
      h += spacer(16) + '<div class="divider"></div>' + spacer(12) + eyebrow('Sales by Category') + spacer(8);
      if (!S.sales) h += txt(S.loading ? 'Loading...' : 'Category breakdown unavailable.', 'font-size:12px;color:var(--ink3)');
      else if (!S.sales.length) h += txt('No sales in this period.', 'font-size:12px;color:var(--ink3)');
      else groupSales(S.sales, function (t) { return t.category; }).forEach(function (g) {
        var nProd = groupSales(g.rows, function (t) { return t.subcategory; }).length;
        h += groupRow(g, nProd + ' products · Qty ' + comma(g.qty) + ' · ' + g.count + ' transactions', function () { S.catView = g; });
      });
      h += spacer(12) + '<div class="divider"></div>' + spacer(12) + eyebrow('Top Sellers (by Quantity)') + spacer(8);
      r.topProducts.forEach(function (tp, idx) {
        h += '<div class="listrow tap"' + tapAttr(function () { openDetail('sales', tp[0], from, to, tp[0]); }) + '><div class="rank" style="background:' + (idx === 0 ? 'var(--brand)' : 'var(--ink)') + '">' + (idx + 1) + '</div>' +
          '<div style="font-size:12px;flex:1;min-width:0;padding-left:8px">' + esc(tp[0]) + '</div>' +
          '<div style="font-size:12px;font-weight:700">' + tp[1] + '</div></div>';
      });
      h += spacer(12) + '<div class="divider"></div>' + spacer(12) + eyebrow('Low Stock Items') + spacer(8);
      r.lowStock.forEach(function (p) {
        h += '<div class="listrow" style="justify-content:space-between;align-items:flex-start"><div style="font-size:12px">' + esc(p.sMenu || '-') + '</div>' + stockBadge(stockStatus(p)) + '</div>';
      });
    }
    h += spacer(24) + '</div></div>';
    return h;
  }

  function buyerScreen() {
    var h = '<div class="screen">' +
      '<div style="font-size:10.5px;font-weight:700;color:var(--ink3)">BUYER INFO</div>' +
      '<div style="font-size:19px;font-weight:800;padding:2px 0 14px">Buyer Info</div>' +
      '<div style="display:flex;flex-direction:column;align-items:center;padding:18px 0">' +
      '<div style="font-size:30px;line-height:normal;letter-spacing:0">📶</div>' + spacer(6) +
      '<div style="font-size:11.5px;color:var(--ink3)">' + (vm.buyerLoading ? 'Looking up card...' : 'Tap your NFC card on the back of the phone') + '</div></div>';
    if (vm.buyerLookupError) h += txt(vm.buyerLookupError, 'color:var(--out);font-size:12px;padding-bottom:10px');
    var p = vm.buyerResult;
    if (p) {
      var line = function (l, v, c) {
        return '<div class="sb" style="padding:7px 0"><span style="font-size:12px;color:var(--ink2)">' + esc(l) + '</span>' +
          '<span style="font-size:12px;font-weight:700;color:' + (c || 'var(--ink)') + '">' + esc(v) + '</span></div>';
      };
      h += '<div style="background:var(--surface2);border:1px solid var(--border);border-radius:14px;padding:16px">' +
        '<div style="font-size:16px;font-weight:800">' + esc(p.name || '-') + '</div>' +
        '<div style="font-size:10.5px;color:var(--ink3);padding-top:2px">CARD ID · ' + esc(p.uid) + '</div>' +
        line('Age', p.age != null ? String(p.age) : '-') + line('Campus', p.campus || '-') +
        line('Start Date', p.startDate || '-') + line('End Date', p.endDate || '-') +
        line('E-MONEY', '₱' + money(p.totalMoney), 'var(--brand)') + '</div>';
    }
    h += spacer(14) + secondaryBtn('RESET', function () { vm.buyerResult = null; vm.buyerLookupError = null; }) + '</div>';
    return h;
  }

  function pusanPayScreen() {
    var matched = S.store.trim().replace(/ /g, '').toUpperCase() === 'PUSANMART';
    var sub = parseNum(S.amount);
    var finalTotal = sub == null ? null : sub - sub * vm.pz.rate;
    var canStart = matched && finalTotal != null && finalTotal > 0;
    var h = '<div class="screen">' + eyebrow('PusanMart') + title('PusanMart Payment') +
      dropdown('pz_store', S.store, ['Select Store', 'PUSANMART'], function (v) {
        S.store = v; vm.pz.store = v; vm.pz.error = null; vm.pz.success = null;
      }, 'Search Store');
    if (!matched) {
      h += txt('Select "PUSANMART" to start a payment.', 'font-size:12px;color:var(--ink3);padding-top:4px');
    } else {
      h += labeledField('pz_amount', 'Total Amount (PHP)', S.amount, function (v) {
        S.amount = v; vm.pz.amount = v; vm.pz.error = null; vm.pz.success = null;
      }, '0.00', 'decimal');
      h += '<div class="field-label">Discount</div><div class="chips" style="padding-bottom:11px">';
      [['No Discount', 0], ['10% Discount', 0.10], ['15% Discount', 0.15]].forEach(function (c) {
        h += '<div class="chip' + (vm.pz.label === c[0] ? ' sel' : '') + '" data-act="' + act(function () { vm.pz.label = c[0]; vm.pz.rate = c[1]; }) + '">' + c[0] + '</div>';
      });
      h += '</div>';
      h += labeledField('pz_memo', 'Memo (optional)', S.memo || '', function (v) {
        S.memo = v.slice(0, 200); vm.pz.memo = S.memo;
      }, 'e.g. items, reason, note');
      if (sub != null && finalTotal != null) {
        h += '<div class="sb" style="padding-bottom:10px"><span style="font-size:12px;color:var(--ink2)">Total after discount</span>' +
          '<span style="font-size:13px;font-weight:700">₱' + money(finalTotal) + '</span></div>';
      }
      if (vm.pz.success) h += txt(vm.pz.success, 'color:var(--ok);font-size:12px;padding-bottom:8px');
      if (vm.pz.error) h += txt(vm.pz.error, 'color:var(--out);font-size:12px;padding-bottom:8px');
      h += spacer(6);
      var label = vm.pz.submitting ? 'Processing payment...' : S.awaitingTap ? 'Please tap your NFC card...' : !canStart ? 'Enter a valid total amount first' : 'Tap your NFC card on the back of the phone';
      var en = canStart && !vm.pz.submitting;
      h += '<div class="nfcbox' + (S.awaitingTap ? ' wait' : '') + (en ? ' enabled' : '') + '"' +
        (en ? ' data-act="' + act(function () { vm.pz.error = null; vm.pz.success = null; S.awaitingTap = true; }) + '"' : '') + '>' +
        '<div class="ic">📶</div><div style="font-size:12px;font-weight:700">' + label + '</div>' +
        (canStart ? '<div style="font-size:10.5px;color:var(--ink2)">₱' + money(finalTotal) + ' is paid from the card\'s e-money as soon as it is tapped</div>' : '') + '</div>';
    }
    h += '</div>';
    return h;
  }

  function runPayList() {
    if (S.view === 'daily') {
      screenLoad(repo.fetchPusanmartDaily(S.start, S.end), function (r) { S.daily = r; syncCostInput(); },
        function (e) { S.daily = null; S.error = 'Search failed: ' + e.message; });
      return;
    }
    screenLoad(repo.fetchPusanmartPayments(S.start, S.end), function (rows) { S.results = rows; },
      function (e) { S.results = []; S.error = 'Search failed: ' + e.message; });
  }

  // ----- daily closing (R1:SUMMARY): sales = Pusan Pay + barcode sales; cost = barcode items (automatic,
  // store_menus.cost) + Pusan Pay cost typed from the Bizmatech report; settlement = cost + 50% of profit.
  function dailyRow(date) {
    return S.daily && S.daily.days.filter(function (d) { return d.date === date; })[0] || null;
  }
  function syncCostInput() {
    var d = dailyRow(S.costDate);
    S.costInput = d && d.typedCost != null ? money(d.typedCost) : '';
  }
  function saveCost() {
    var raw = String(S.costInput || '').replace(/,/g, '').trim();
    if (raw !== '' && !(Number(raw) >= 0)) { S.costMsg = { err: true, text: 'Enter a cost of 0 or more.' }; return; }
    var s = S, date = S.costDate;
    s.costSaving = true; s.costMsg = null;
    repo.savePusanmartCost(date, raw === '' ? null : Number(raw)).then(function () {
      if (S !== s) return;
      s.costMsg = { err: false, text: date + (raw === '' ? ' Pusan Pay cost cleared.' : ' Pusan Pay cost ₱' + money(Number(raw)) + ' saved.') };
      if (date < s.start || date > s.end) { if (date < s.start) s.start = date; else s.end = date; }
      runPayList();
    }, function (e) {
      if (S === s) s.costMsg = { err: true, text: 'Save failed: ' + e.message };
    }).then(function () { if (S === s) { s.costSaving = false; render(); } });
  }
  function peso(n) { return comma(n, 2); } // 7,025.30
  function sharePct() { return Math.round(((S.daily && S.daily.settleShare) || 0.5) * 100); }
  function downloadDailyCsv() {
    var cell = function (v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var r = S.daily, pct = sharePct();
    var rows = [['Date', 'Trans.', 'Gross Sales (PHP)', 'Discount (PHP)', 'Net Sales (PHP)', 'Cost Exp. (PHP)', 'Barcode Cost (auto)', 'Pusan Pay Cost (typed)',
      'Rev | PFT (PHP)', 'Margin %', 'Settlement = Cost + ' + pct + '% PFT (PHP)']];
    r.days.slice().reverse().forEach(function (d) {
      rows.push([d.date, d.count, money(d.gross), money(d.discount), money(d.sales), d.cost == null ? '' : money(d.cost), money(d.items.cost),
        d.pay.cost == null ? '' : money(d.pay.cost), d.net == null ? '' : money(d.net),
        d.cost == null || !d.sales ? '' : (d.net / d.sales * 100).toFixed(1), d.settlement == null ? '' : money(d.settlement)]);
    });
    rows.push([]);
    rows.push(['Total', r.totals.count, money(r.totals.gross), money(r.totals.discount), money(r.totals.sales), money(r.totals.cost), money(r.totals.itemCost), '',
      money(r.totals.net), r.totals.salesWithCost ? (r.totals.net / r.totals.salesWithCost * 100).toFixed(1) : '', money(r.totals.settlement)]);
    rows.push(['Days without cost', r.totals.daysMissingCost]);
    var name = 'pusanmart_daily_' + S.start + '_' + S.end + '.csv';
    downloadFile(name, 'text/csv;charset=utf-8', '﻿' + rows.map(function (x) { return x.map(cell).join(','); }).join('\r\n'));
    toast('Saved to Downloads: ' + name, 3500);
  }
  // The closing report, laid out like the Bizmatech "Daily Sales Report  R1:SUMMARY". Used on screen and for printing.
  function closingReportHtml(d) {
    var pct = sharePct();
    var line = function (label, value, cls) {
      return '<div class="rl' + (cls ? ' ' + cls : '') + '"><span>' + label + '</span><span>' + value + '</span></div>';
    };
    var na = '<span class="rmiss">missing</span>';
    var share = d.net == null ? null : Math.round(d.net * pct) / 100;
    var by = session.manager ? (session.manager.login_id || session.manager.loginId || '') + ' ' + (session.manager.name || '') : '';
    var now = new Date();
    var h = '<div class="rpt">' +
      '<div class="rhead"><div><div class="rbrand">부산마트</div><div class="rsub">PUSAN MART · SMEAG</div></div>' +
      '<div style="text-align:right"><div class="rtitle">Daily Sales Report</div><div class="rsub">R1:SUMMARY · From: ' + esc(d.date) + '</div></div></div>' +
      '<div class="rsec">=== SALES DETAILS ===</div>' +
      line('<b>' + d.count + ' Trans.</b>', '') +
      line('Sys TL Sales', peso(d.gross)) +
      line('(-) OVL Discount', peso(d.discount), 'rul') +
      line('<b>Net Sales</b>', '<b>' + peso(d.sales) + '</b>') +
      line('(-) Cost Exp.', d.cost == null ? na : peso(d.cost)) +
      line('&nbsp;&nbsp;· Barcode items (auto)', peso(d.items.cost), 'rsm') +
      line('&nbsp;&nbsp;· Pusan Pay (Bizmatech)', d.pay.count ? (d.pay.cost == null ? na : peso(d.pay.cost)) : '0.00', 'rsm') +
      line('<b>Rev | PFT</b>', d.net == null ? na : '<b>' + peso(d.net) + '</b>', 'rtop') +
      '<div class="rsec">=== PAYMENT DETAILS ===</div>' +
      line('Pusan Pay (card) ' + d.pay.count + ' trans.', peso(d.pay.sales)) +
      line('Barcode sales (card) ' + d.items.count + ' trans. · ' + d.items.qty + ' pcs', peso(d.items.sales), 'rul') +
      line('<b>Net Payment Received</b>', '<b>' + peso(d.sales) + '</b>') +
      '<div class="rsec">=== SETTLEMENT ===</div>' +
      line('Cost', d.cost == null ? na : peso(d.cost)) +
      line('+ ' + pct + '% of PFT' + (d.net == null ? '' : ' (' + peso(d.net) + ')'), share == null ? na : peso(share), 'rul') +
      line('<b>Total</b>', d.settlement == null ? na : '<b class="rbig">' + peso(d.settlement) + '</b>');
    if (d.items.uncosted && d.items.uncosted.length) {
      h += '<div class="rwarn">No cost on file (counted as 0): ' + d.items.uncosted.map(function (u) { return esc(u.name) + ' ×' + u.qty; }).join(', ') + '</div>';
    }
    h += '<div class="rfoot">Printed By: ' + esc(by.trim() || '-') + ' | ' + esc(ymd(now) + ' ' + pad2(now.getHours()) + ':' + pad2(now.getMinutes())) + '</div>' +
      '<div class="rsign"><div><span></span>Cashier</div><div><span></span>Check By</div></div></div>';
    return h;
  }
  function printHtml(html) {
    var el = document.getElementById('printArea');
    if (!el) { el = document.createElement('div'); el.id = 'printArea'; document.body.appendChild(el); }
    el.innerHTML = html;
    window.print();
  }
  function printClosingReport(d) { printHtml(closingReportHtml(d)); }

  // X Reading Report (mid-day / shift check, no reset), laid out like the Bizmatech "X Reading Report  R1:SUMMARY":
  // SALES DETAILS | PAYMENT DETAILS | CASH DRAWER, then PAYMENT DENOM. Every Pusan Mart sale is an e-money card tap,
  // so it all goes under "E MONEY TAP" and the cash drawer stays 0.00.
  function mdy(date) { var p = String(date).split('-'); return p[1] + '/' + p[2] + '/' + p[0]; }
  function hm12(d) {
    var h = d.getHours(), ap = h < 12 ? 'AM' : 'PM';
    return pad2(h % 12 || 12) + ':' + pad2(d.getMinutes()) + ' ' + ap;
  }
  function xReadingHtml(d, asOf) {
    var line = function (label, value, cls) {
      return '<div class="rl' + (cls ? ' ' + cls : '') + '"><span>' + label + '</span><span>' + value + '</span></div>';
    };
    var zero = '0.00';
    var costKnown = d.cost != null;
    var cost = costKnown ? d.cost : d.knownCost;
    var pft = Math.round((d.sales - cost) * 100) / 100;
    var by = session.manager ? (session.manager.login_id || session.manager.loginId || '') + ' ' + (session.manager.name || '') : '';
    var now = new Date();
    var col = function (title, body) { return '<div class="xcol"><div class="rsec">== ' + title + ' ==</div>' + body + '</div>'; };
    var sales = '<div class="rl"><span><b>' + d.count + ' Trans.</b></span><span></span></div>' +
      line('Sys TL Sales', peso(d.gross)) +
      line('(-) Cancel &amp;', zero) +
      line('(-) Void', zero, 'rul') +
      line('<b>Gross TL Sales</b>', '<b>' + peso(d.gross) + '</b>') +
      line('(-) OVL Discount', peso(d.discount), 'rul') +
      line('<b>Net Sales</b>', '<b>' + peso(d.sales) + '</b>') +
      line('(-) Cost Exp.' + (costKnown ? '' : ' *'), peso(cost), 'rul') +
      line('<b>Rev | PFT</b>', '<b>' + peso(pft) + '</b>' + (costKnown ? '' : ' *'));
    var pay = line('<b>CS Sale Paid</b>', '<b>' + peso(d.sales) + '</b>') +
      line('(+) Prev. SPR', zero, 'rul') +
      '<div class="xnet"><b>Net Payment Received</b><div class="rbig"><b>' + peso(d.sales) + '</b></div></div>' +
      line('Pymt. Balance', zero) +
      line('Pymt Ex/Over', zero) + '<div style="height:10px"></div>' +
      line('TL Cont. Deposit', zero);
    var drawer = line('Prev. UR Sale', zero) +
      line('Start In*Cash', zero) +
      line('(+) Cash In', zero) +
      line('<b>(+) Cur Sales</b>', '<b>' + zero + '</b>') +
      line('(+) Prev CShift', zero, 'rul') +
      line('', '<b>' + zero + '</b>') +
      line('(-) Cash Out', zero) +
      line('(-) Refunds', zero, 'rul') +
      line('<b>End* Cash :</b>', '<b>' + zero + '</b>');
    var denom = '<div class="rsec">=== PAYMENT DENOM ===</div><div class="rsm" style="padding-bottom:2px">[ Current Payment Received ]</div>' +
      line('E MONEY TAP', peso(d.sales)) + line('CHECK', zero) + line('BANK2BANK', zero) + line('GCASH', zero) + line('CASH', zero);
    var h = '<div class="rpt xr">' +
      '<div class="rhead"><div><div class="rbrand">부산마트</div><div class="rsub">PUSAN MART · SMEAG</div></div>' +
      '<div style="text-align:center"><div class="rtitle">X Reading Report</div>' +
      '<div class="rsub">From: ' + esc(mdy(d.date)) + ' 12:00 AM&nbsp; To ' + esc(mdy(d.date)) + ' ' + esc(asOf) + '</div>' +
      '<div class="rsub">[F#]TID:ALL | CA:ALL | SA:ALL</div></div>' +
      '<div class="rtitle">R1:SUMMARY</div></div>' +
      '<div class="xgrid">' + col('SALES DETAILS', sales) + col('PAYMENT DETAILS', pay) + col('CASH DRAWER', drawer) + '</div>' +
      '<div class="xgrid"><div class="xcol">' + denom + '</div></div>';
    if (!costKnown && d.pay.count) {
      h += '<div class="rwarn">* Pusan Pay cost (Bizmatech Cost Exp.) not entered yet — cost shows barcode items only, so PFT is provisional.</div>';
    }
    h += '<div class="rfoot">Printed By: ' + esc(by.trim() || '-') + ' | ' + esc(mdy(ymd(now)) + ' ' + hm12(now)) + '</div>' +
      '<div class="rsign"><div><span></span>Cashier</div><div><span></span>Check By</div></div></div>';
    return h;
  }
  // Re-reads the day right before printing so the X Reading is current up to now.
  function printXReading(date) {
    if (!date) return;
    toast('Preparing X Reading...', 1500);
    repo.fetchPusanmartDaily(date, date).then(function (r) {
      var d = r && r.days && r.days.filter(function (x) { return x.date === date; })[0];
      if (!d) { toast('No data for ' + date, 3000); return; }
      var now = new Date();
      printHtml(xReadingHtml(d, date === ymd(now) ? hm12(now) : '11:59 PM'));
    }, function (e) { toast('X Reading failed: ' + e.message, 4000); });
  }
  function payListTabs() {
    var h = '<div class="chips tabs" style="padding-bottom:8px">';
    [['daily', 'Daily Closing / Cost'], ['list', 'Payments']].forEach(function (c) {
      h += '<div class="chip' + (S.view === c[0] ? ' sel' : '') + '" data-act="' + act(function () {
        if (S.view === c[0]) return; S.view = c[0]; S.error = null; runPayList();
      }) + '">' + c[1] + '</div>';
    });
    return h + '</div>';
  }
  function dailyScreen() {
    var r = S.daily;
    var stat = function (label, value, color, sub, onTap) {
      return '<div class="stat' + (onTap ? ' tap' : '') + '"' + (onTap ? tapAttr(onTap) : '') + '><div class="lab">' + esc(label) + '</div><div class="val" style="font-size:15px;color:' + (color || 'var(--ink)') + '">' + esc(value) + '</div>' +
        (sub ? '<div style="font-size:10px;color:var(--ink3);margin-top:2px">' + esc(sub) + '</div>' : '') + '</div>';
    };
    var h = '<div class="screen"><div class="vscroll fill">' + eyebrow('Report') + title('Pay List') + reportTabs() + payListTabs() +
      primaryBtn('🖨 X Reading — Today (up to now)', function () { printXReading(ymd(new Date())); }, false, ' style="height:38px"') + spacer(10) +
      rangeBar(runPayList) + errorLine();
    if (!r) { h += loadingOr('No results.', 'font-size:12px;color:var(--ink3)') + '</div></div>'; return h; }
    var t = r.totals, from = S.start, to = S.end, pct = sharePct();
    // Net Sales = Report Summary "Total Revenue" (same rows). Cost = barcode cost (auto) + Pusan Pay cost (typed);
    // while a day's Pusan Pay cost is missing, the cost found so far is shown and profit stays open for those days.
    var missing = t.daysMissingCost > 0;
    var margin = t.salesWithCost ? (t.net / t.salesWithCost * 100).toFixed(1) + '% (' + t.daysWithCost + ' days with cost)' : 'Enter Pusan Pay cost';
    // Provisional (days still missing their Pusan Pay cost): count only those days' barcode sales, whose cost is
    // automatic, and leave their Pusan Pay sales out until the cost is typed. Final figures replace it once saved.
    var prov = null;
    if (missing) {
      prov = { net: 0, settlement: 0, sales: 0 };
      (r.days || []).forEach(function (d) {
        if (d.cost !== null) { if (d.count > 0 || d.cost > 0) { prov.net += d.net; prov.settlement += d.settlement; prov.sales += d.sales; } return; }
        var n = d.items.sales - d.items.cost;
        prov.net += n; prov.settlement += d.items.cost + Math.round(n * (r.settleShare || 0.5) * 100) / 100; prov.sales += d.items.sales;
      });
      var provNote = 'Provisional · Pusan Pay ₱' + peso(t.paySalesMissingCost) + ' excluded until cost is entered';
      margin = (prov.sales ? (prov.net / prov.sales * 100).toFixed(1) + '% · ' : '') + provNote;
    }
    var costSub = 'Barcode ₱' + peso(t.itemCost) + (missing ? ' · Pusan Pay ₱' + peso(t.paySalesMissingCost) + ' sales: cost missing (' + t.daysMissingCost + ' days)' : ' · Pusan Pay typed');
    h += '<div class="row" style="gap:8px">' + stat('Net Sales', '₱' + peso(t.sales), null, t.count + ' trans. · = Summary', function () { openDetail('sales', 'Sales Details', from, to); }) +
      stat('Cost Exp.', '₱' + peso(t.knownCost != null ? t.knownCost : t.cost), 'var(--low)', costSub) + '</div>' + spacer(8) +
      '<div class="row" style="gap:8px">' + stat('Rev | PFT' + (prov ? ' (provisional)' : ''), prov ? '≈ ₱' + peso(prov.net) : t.daysWithCost ? '₱' + peso(t.net) : '—',
        (prov ? prov.net : t.net) < 0 ? 'var(--out)' : 'var(--ok)', margin) +
      stat('Settlement' + (prov ? ' (provisional)' : ''), prov ? '≈ ₱' + peso(prov.settlement) : t.daysWithCost ? '₱' + peso(t.settlement) : '—', null,
        'Cost + ' + pct + '% of PFT' + (prov ? ' · final after Pusan Pay cost is saved' : '')) + '</div>' + spacer(12);

    if (r.costTableMissing) h += txt('The cost table is not set up yet (admin: run supabase_pusanmart_daily_cost.sql).', 'font-size:11.5px;color:var(--out);padding-bottom:8px');

    // closing report of the selected day
    var cd = dailyRow(S.costDate);
    if (cd) {
      h += '<div class="card" style="padding:12px;margin-bottom:10px">' + closingReportHtml(cd) + spacer(10) +
        primaryBtn('🖨 Print Closing Report', function () { printClosingReport(cd); }, false, ' style="height:38px"') + spacer(8) +
        secondaryBtn('🖨 Print X Reading (' + cd.date + ')', function () { printXReading(cd.date); }) + '</div>';
    }

    // Pusan Pay cost: items rung up on the Bizmatech POS, so its "Cost Exp." is typed in. Barcode sales cost is automatic.
    if (!REPORT_ONLY) {
    h += '<div class="card" style="padding:12px;margin-bottom:10px">' +
      '<div style="font-size:12px;font-weight:800;padding-bottom:8px">Pusan Pay Cost <span style="font-weight:400;color:var(--ink3)">· Cost Exp. on the Bizmatech report</span></div>' +
      half(dateField('Date', S.costDate, function (v) { S.costDate = v; S.costMsg = null; syncCostInput(); }),
        labeledField('pl_cost', 'Cost (PHP)', S.costInput, function (v) { S.costInput = v; S.costMsg = null; }, '0.00', 'decimal'));
    if (cd) {
      h += txt('Pusan Pay ₱' + peso(cd.pay.sales) + ' (' + cd.pay.count + ' trans.) · Barcode sales ₱' + peso(cd.items.sales) +
        ' with cost ₱' + peso(cd.items.cost) + ' (automatic)', 'font-size:11.5px;color:var(--ink2);padding-bottom:8px');
    }
    if (S.costMsg) h += txt(S.costMsg.text, 'font-size:12px;padding-bottom:8px;color:' + (S.costMsg.err ? 'var(--out)' : 'var(--ok)'));
    h += primaryBtn(S.costSaving ? 'Saving...' : 'Save', saveCost, S.costSaving || !S.costDate) + '</div>';
    }

    h += primaryBtn('⬇ Download Excel', downloadDailyCsv, !r.days.length, ' style="height:38px"') + spacer(10);
    r.days.forEach(function (d) {
      var sel = d.date === S.costDate;
      h += '<div class="card" style="margin-bottom:8px;padding:10px;cursor:pointer' + (sel ? ';border-color:var(--brand)' : '') + '" data-act="' +
        act(function () { S.costDate = d.date; S.costMsg = null; syncCostInput(); }) + '">' +
        '<div class="sb"><span style="font-size:12.5px;font-weight:700">' + esc(d.date) + '</span>' +
        '<span style="font-size:10.5px;color:var(--ink3)">' + d.count + ' trans.' + (d.settlement == null ? '' : ' · Settle ₱' + peso(d.settlement)) + '</span></div>' +
        '<div class="sb" style="padding-top:4px;font-size:11.5px">' +
        '<span class="tap salesnum"' + tapAttr(function () { S.costDate = d.date; syncCostInput(); openDetail('sales', 'Sales ' + d.date, d.date, d.date); }) +
        '>Sales <b>₱' + peso(d.sales) + '</b> ›</span>' +
        '<span>Cost ' + (d.cost == null ? '<b>₱' + peso(d.knownCost) + '</b> <b style="color:var(--out)">+ Pusan Pay missing</b>' : '<b>₱' + peso(d.cost) + '</b>') + '</span>' +
        '<span>PFT ' + (d.net == null ? '-' : '<b style="color:' + (d.net < 0 ? 'var(--out)' : 'var(--ok)') + '">₱' + peso(d.net) + '</b>') + '</span>' +
        '</div></div>';
    });
    h += '</div></div>';
    return h;
  }
  function downloadPayListCsv() { downloadPayCsv(S.results, S.start, S.end); }
  function payListScreen() {
    if (S.detail) return detailScreen();
    if (S.view === 'daily') return dailyScreen();
    var total = S.results.reduce(function (a, r) { return a + r.allPayments; }, 0);
    var h = '<div class="screen"><div class="vscroll fill">' + eyebrow('Report') + title('Pay List') + reportTabs() + payListTabs() +
      rangeBar(runPayList) +
      '<div class="sb" style="padding-bottom:8px"><span style="font-size:12px;color:var(--ink2)">' + S.results.length + ' payments</span>' +
      '<span style="font-size:13px;font-weight:700">Total ₱' + money(total) + '</span></div>' +
      primaryBtn('⬇ Download Excel', downloadPayListCsv, !S.results.length, ' style="height:38px"') + spacer(10) + errorLine();
    if (!S.results.length && !S.error) h += loadingOr('No PusanMart payments in this period.', 'font-size:12px;color:var(--ink3)');
    S.results.forEach(function (r) { h += payCard(r); });
    h += '</div></div>';
    return h;
  }

  function receiptText(L) {
    var disc = 0, lines = ['SMEAG Mobile Mart - ' + L.campus, ''];
    L.cart.forEach(function (it) {
      var gross = it.product.payment * it.quantity;
      lines.push(it.product.sMenu + ' × ' + it.quantity + '  ₱' + money(gross));
      if (it.disc) lines.push('  Item discount ' + discTag(it.disc) + '  −₱' + money(gross - lineNet(it, L.rate)));
      else disc += gross - lineNet(it, L.rate);
    });
    if (L.cart.some(function (it) { return !it.disc; })) lines.push(L.label + '  −₱' + money(disc));
    lines.push('Final Total  ₱' + money(L.finalTotal));
    lines.push('Remaining NFC Balance  ₱' + money(L.remaining));
    return lines.join('\n');
  }
  function shareReceipt() {
    var L = vm.last;
    if (navigator.share) {
      navigator.share({ title: 'Receipt', text: receiptText(L) }).catch(function () { /* cancelled */ });
    } else notInBrowser();
  }
  function receiptScreen() {
    var L = vm.last;
    // Cart-wide discount only on lines without their own item discount.
    var disc = L.cart.reduce(function (a, i) { return i.disc ? a : a + (i.product.payment * i.quantity - lineNet(i, L.rate)); }, 0);
    var h = '<div class="screen" style="align-items:center">' +
      '<div style="width:56px;height:56px;border-radius:50%;background:var(--ok-bg);display:flex;align-items:center;justify-content:center;flex:none">' +
      '<span style="color:var(--ok);font-size:26px;line-height:normal">✓</span></div>' + spacer(12) +
      '<div style="font-size:17px;font-weight:800;text-align:center">Payment Complete</div>' +
      '<div style="font-size:11.5px;color:var(--ink2);padding:2px 0 14px">' + esc(L.campus || session.selectedCampus) + '</div>' +
      '<div style="width:100%;background:var(--surface2);border:1px solid var(--border);border-radius:14px;padding:12px;margin-bottom:10px">' +
      '<div class="eyebrow" style="padding-bottom:4px">Buyer</div>' +
      '<div class="sb" style="padding:3px 0"><span style="font-size:12px;color:var(--ink2)">Name</span><span style="font-size:13px;font-weight:700">' + esc(L.buyerName || '-') + '</span></div>' +
      '<div class="sb" style="padding:3px 0"><span style="font-size:12px;color:var(--ink2)">Card UID</span><span style="font-size:12px">' + esc(L.uid || '-') + '</span></div>' +
      (L.orderId != null ? '<div class="sb" style="padding:3px 0"><span style="font-size:12px;color:var(--ink2)">Order</span><span style="font-size:12px">#' + esc(L.orderId) + '</span></div>' : '') +
      '</div>' +
      '<div style="width:100%;background:var(--surface2);border:1px solid var(--border);border-radius:14px;padding:12px">' +
      '<div class="eyebrow" style="padding-bottom:4px">Purchase</div>';
    L.cart.forEach(function (it) {
      var gross = it.product.payment * it.quantity;
      h += '<div class="sb" style="padding:5px 0"><span style="font-size:12px;color:var(--ink2)">' + esc(it.product.sMenu + ' × ' + it.quantity) + '</span>' +
        '<span style="font-size:12px;font-weight:700">₱' + money(gross) + '</span></div>';
      if (it.disc) {
        h += '<div class="sb" style="padding:0 0 5px 10px"><span style="font-size:11px;color:var(--ink2)">Item discount ' + esc(discTag(it.disc)) + '</span>' +
          '<span style="font-size:11px">−₱' + money(gross - lineNet(it, L.rate)) + '</span></div>';
      }
    });
    if (L.cart.some(function (it) { return !it.disc; })) h += '<div class="sb" style="padding:5px 0"><span style="font-size:12px;color:var(--ink2)">' + esc(L.label) + '</span>' +
      '<span style="font-size:12px;font-weight:700">−₱' + money(disc) + '</span></div>';
    h +=
      '<div class="divider" style="margin:8px 0"></div>' +
      '<div class="sb"><span style="font-size:13px">Final Total</span><span style="font-size:15px;font-weight:700;color:var(--brand)">₱' + money(L.finalTotal) + '</span></div>' +
      '<div class="divider" style="margin:8px 0"></div>' +
      '<div class="sb"><span style="font-size:12px;color:var(--ink2)">Remaining NFC Balance</span><span style="font-size:13px;font-weight:700">₱' + money(L.remaining) + '</span></div></div>' +
      spacer(14) + primaryBtn('⬇ Download Receipt PDF', notInBrowser) +
      '<div style="font-size:10.5px;color:var(--ink3);text-align:center;padding:6px 0 10px">Automatically saved to the phone\'s Download folder</div>' +
      secondaryBtn('↗ Share / KakaoTalk', shareReceipt) + spacer(16) +
      secondaryBtn('Done', function () { navigate('sales'); }) + '</div>';
    return h;
  }

  function loginScreen() {
    if (!S.login) {
      var savedId = lsGet('pusanMartLoginId');
      S.login = { id: savedId || '', remember: !!savedId, error: ui.loginNotice, loading: false };
      ui.loginNotice = null;
    }
    var L = S.login;
    var h = '<div class="screen vscroll" style="padding:24px;justify-content:safe center;display:flex"><div style="display:flex;flex-direction:column;align-items:center;width:100%;margin:auto 0">' +
      '<div style="width:60px;height:60px;background:var(--brand);border-radius:16px;display:flex;align-items:center;justify-content:center;flex:none">' +
      '<span style="color:#fff;font-size:26px;font-weight:800">S</span></div>' + spacer(16) +
      '<div style="font-size:19px;font-weight:800">' + (REPORT_ONLY ? 'Pusan Mart Report' : 'SMEAG Mobile Mart') + '</div>' +
      '<div style="font-size:12.5px;color:var(--ink2);padding-top:2px">' + (REPORT_ONLY ? 'View-only sales reports · Manager login' : 'Admin (Manager) Login Only') + '</div>' + spacer(22) +
      // ID only: the campus comes from the account (only that campus is shown after login).
      labeledField('l_id', 'ID', L.id, function (v) { L.id = v; }, 'Manager account (staff ID / email)') +
      '<div style="display:flex;align-items:center;width:100%;padding-bottom:4px">' +
      '<div class="cbx' + (L.remember ? ' on' : '') + '" data-act="' + act(function () { L.remember = !L.remember; }) + '"><div class="box">' +
      (L.remember ? '<svg viewBox="0 0 24 24"><path d="M4.5 12.5l5 5 10-11"/></svg>' : '') + '</div></div>' +
      '<span style="font-size:12.5px;color:var(--ink2);padding-left:2px">Remember me</span></div>';
    if (L.error) h += spacer(6) + txt(L.error, 'color:var(--out);font-size:12px;align-self:flex-start');
    h += spacer(8) + primaryBtn(L.loading ? 'Logging in...' : 'Login', function () { doLogin(L); }, L.loading) + spacer(16) +
      (REPORT_ONLY ? '' : '<div style="font-size:10.5px;color:var(--ink3);text-align:center;line-height:15px;letter-spacing:0.5px">※ Students / buyers can look up their info by tapping an<br>NFC card only, without logging in</div>') +
      '</div></div>';
    return h;
  }
  function doLogin(L) {
    var id = L.id.trim();
    L.error = null;
    if (!id) { L.error = 'Please enter your ID.'; return; }
    L.loading = true;
    repo.login(id).then(function (r) {
      if (!r || !r.manager) { L.error = 'Unknown ID.'; return; }
      if (!r.access || (r.access.stores || []).indexOf('mart') < 0) {
        L.error = 'This account cannot use the mart. (' + (r.manager.position || '') + ' @ ' + (r.manager.campus || '') + ')';
        return;
      }
      // "Remember me" keeps only the login ID.
      lsSet('pusanMartLoginId', L.remember ? id : null);
      lsSet('pusanMartLoginCampus', null);
      session.manager = r.manager; session.access = r.access; session.token = r.token;
      // Start on the account's own campus (a campus account only gets that one).
      var campuses = allowedCampuses();
      var own = String(r.manager.campus || '').toUpperCase().replace('TALRAC', 'TARLAC');
      session.selectedCampus = campuses.filter(function (c) { return c.toUpperCase() === own; })[0] || campuses[0] || MART_CAMPUS;
      saveSession();
      setDefaultDiscount();
      navigate(HOME, true);
    }, function (e) {
      L.error = e.status === 0 ? e.message : e.status === 403 ? e.message : 'Login failed: ' + e.message;
    }).then(function () { L.loading = false; render(); });
  }

  var REPORT_TABS = [
    { route: 'report', label: 'Summary', icon: 'BarChart' },
    { route: 'history', label: 'History', icon: 'ListAlt' },
    { route: 'paylist', label: 'Pay List', icon: 'Payments' },
    { route: 'logout', label: 'Logout', icon: 'Logout' }
  ];
  function navBar() {
    var h = '<nav class="navbar">';
    (REPORT_ONLY ? REPORT_TABS : TABS).filter(function (t) { return routeAllowed(t.route); }).forEach(function (t) {
      var sel = REPORT_ONLY ? route === t.route : navSelected(t.route);
      h += '<div class="navitem' + (sel ? ' sel' : '') + '" data-nav="' + t.route + '" title="' + esc(t.label) + '">' +
        '<div class="ind"></div><svg viewBox="0 0 24 24" aria-label="' + esc(t.label) + '"><path d="' + ICONS[t.icon] + '"/></svg>' +
        '<span class="lab">' + esc(t.label) + '</span></div>';
    });
    return h + '</nav>';
  }

  // ------------------------------------------------------------------ render
  var root = null;
  function render(resetScroll) {
    if (!root) return;
    var scrolls = {};
    if (!resetScroll) root.querySelectorAll('.vscroll').forEach(function (el, i) { scrolls[i] = el.scrollTop; });
    var ae = document.activeElement, focusId = ae && ae.id && ae.tagName === 'INPUT' ? ae.id : null;
    var selS = focusId ? ae.selectionStart : 0, selE = focusId ? ae.selectionEnd : 0;

    actions = {}; ddRegistry = {}; uid = 0;
    var body;
    if (!session.manager) {
      body = '<div class="content">' + loginScreen() + '</div>';
    } else {
      var fn = { sales: salesScreen, register: registerScreen, modify: modifyScreen, history: historyScreen, report: reportScreen,
        buyer: buyerScreen, pusanpay: pusanPayScreen, paylist: payListScreen, receipt: receiptScreen }[route] || salesScreen;
      body = '<div class="content">' + fn() + '</div>' + navBar();
    }
    if (ui.dropdown) body += dropdownOverlay();
    if (ui.toast) body += '<div class="toast">' + esc(ui.toast) + '</div>';
    root.innerHTML = body;
    var dlg = root.querySelector('.dlgscrim'); if (dlg) root.appendChild(dlg); // dialogs cover the whole window incl. nav bar

    if (!resetScroll) root.querySelectorAll('.vscroll').forEach(function (el, i) { if (scrolls[i] != null) el.scrollTop = scrolls[i]; });
    if (focusId) {
      var el = document.getElementById(focusId);
      if (el) { el.focus(); try { el.setSelectionRange(selS, selE); } catch (e) { /* ignore */ } }
    }
    syncNfc();
    renderDemo();
  }
  // Product image failed to load -> 📦 tile (and remember, so re-renders don't retry it).
  function onImgError(e) {
    var img = e.target;
    if (!img || img.tagName !== 'IMG' || !img.getAttribute('data-img')) return;
    failedImages[img.getAttribute('data-img')] = 1;
    var span = document.createElement('span');
    span.style.fontSize = (img.getAttribute('data-icon') || 20) + 'px';
    span.textContent = '📦';
    img.replaceWith(span);
  }

  function dropdownOverlay() {
    var d = ui.dropdown, reg = ddRegistry[d.key];
    if (!reg) { ui.dropdown = null; return ''; }
    var frame = root.getBoundingClientRect(), a = d.rect;
    var itemsH = reg.options.length * 48 + 16;
    var below = frame.bottom - a.bottom - 8, above = a.top - frame.top - 8;
    var style, maxH;
    if (itemsH <= below || below >= above) { maxH = Math.max(120, below); style = 'top:' + (a.bottom - frame.top) + 'px;'; }
    else { maxH = above; style = 'bottom:' + (frame.bottom - a.top) + 'px;'; }
    var left = a.left - frame.left;
    style += 'left:' + left + 'px;max-height:' + maxH + 'px;';
    var h = '<div class="scrim" data-ddclose="1"></div><div class="ddmenu" style="' + style + '">';
    reg.options.forEach(function (o, i) { h += '<div class="dditem" data-ddopt="' + i + '">' + esc(o) + '</div>'; });
    return h + '</div>';
  }
  function fixDropdownPosition() {
    var m = root.querySelector('.ddmenu');
    if (!m) return;
    var frame = root.getBoundingClientRect(), r = m.getBoundingClientRect();
    if (r.right > frame.right - 8) m.style.left = Math.max(8, frame.width - r.width - 8) + 'px';
  }

  // ------------------------------------------------------------------ ?demo=1: simulated NFC tap (outside app UI)
  // Feeds a typed UID through PusanNfc exactly like a real reader, so the real API flow runs.
  var demoEl = null;
  function recentUids() { try { return JSON.parse(lsGet('pusanMartDemoUids') || '[]'); } catch (e) { return []; } }
  function renderDemo() {
    if (!demoEl) return;
    var waiting = wantsNfc() && route !== 'buyer';
    demoEl.className = 'demo' + (waiting ? ' pulse' : '');
    var keep = demoEl.querySelector('input');
    var typed = keep ? keep.value : '';
    var hadFocus = keep && document.activeElement === keep;
    var h = '<button data-demo="toggle" title="Simulate an NFC card tap with a real card UID">' + (waiting ? '📡 Tap card now' : '📡 NFC') + '</button>';
    if (ui.demoOpen) {
      h += '<div class="menu"><div class="h">Simulate NFC tap · card UID</div>' +
        '<div style="display:flex;gap:4px;padding:0 4px 4px"><input data-demo-in="1" placeholder="e.g. 04a1b2c3d4e5" value="' + esc(typed) + '" ' +
        'style="flex:1;min-width:0;font:400 12px Roboto,system-ui,sans-serif;padding:6px 8px;border:1px solid #ccc;border-radius:6px" autocomplete="off" spellcheck="false">' +
        '<button data-demo="tapinput" style="width:auto;flex:none;background:#1F8F57;color:#fff;text-align:center">Tap</button></div>';
      var recent = recentUids();
      if (recent.length) h += '<div class="h">Recent</div>';
      recent.forEach(function (u) { h += '<button data-demo="tap" data-uid="' + esc(u) + '">' + esc(u) + '</button>'; });
      h += '</div>';
    }
    demoEl.innerHTML = h;
    var inp = demoEl.querySelector('input');
    if (inp && (hadFocus || (ui.demoOpen && !typed && !recentUids().length))) inp.focus();
  }
  function demoTap(u) {
    u = String(u || '').trim();
    if (!u) return;
    var list = recentUids().filter(function (x) { return x !== u; });
    list.unshift(u);
    lsSet('pusanMartDemoUids', JSON.stringify(list.slice(0, 5)));
    ui.demoOpen = false;
    if (window.PusanNfc) window.PusanNfc.dispatchManualUid(u); else onNfc(u);
    renderDemo();
  }

  // ------------------------------------------------------------------ events
  function onClick(e) {
    var t = e.target;
    var ddOpt = t.closest('[data-ddopt]');
    if (ddOpt && ui.dropdown) {
      var reg = ddRegistry[ui.dropdown.key];
      var opt = reg.options[+ddOpt.getAttribute('data-ddopt')];
      ui.dropdown = null; reg.onSelect(opt); render(); return;
    }
    if (t.closest('[data-ddclose]')) { ui.dropdown = null; render(); return; }
    var dd = t.closest('[data-dd]');
    if (dd) {
      var r = dd.getBoundingClientRect();
      ui.dropdown = { key: dd.getAttribute('data-dd'), rect: { top: r.top, bottom: r.bottom, left: r.left, right: r.right } };
      render(); fixDropdownPosition(); return;
    }
    var nav = t.closest('[data-nav]');
    if (nav) {
      var nr = nav.getAttribute('data-nav');
      if (nr === 'logout') logout();
      else if (nr !== route) navigate(nr);
      return;
    }
    var a = t.closest('[data-act]');
    if (a) {
      if (a.getAttribute('data-self') && a !== t) return; // dialog scrim: only clicks on the scrim itself
      var fn = actions[a.getAttribute('data-act')];
      if (fn) { fn(); if (!a.getAttribute('data-norender')) render(); }
    }
  }
  function onInput(e) {
    var k = e.target.getAttribute && e.target.getAttribute('data-in');
    if (k && actions[k]) { actions[k](e.target.value); render(); }
  }
  function onKeyDown(e) {
    // Pusan Mart: a code typed (or a short code scanned) into the search box + Enter adds that product.
    if (e.key === 'Enter' && route === 'sales' && e.target && e.target.id === 's_search' && isPusan(S.campus)) {
      var typed = cleanCode(e.target.value);
      if (typed && findByCode(typed)) {
        e.preventDefault();
        S.search = '';
        onBarcode(typed, true);
        var box = document.getElementById('s_search'); if (box) box.value = '';
        return;
      }
    }
    // Edit Products: Enter in the search box opens the exact barcode / item code match, or the single result.
    if (e.key === 'Enter' && route === 'modify' && e.target && e.target.id === 'm_search') {
      e.preventDefault();
      var mq = String(e.target.value || '').trim(), mp = mq && findByCode(cleanCode(mq));
      if (!mp) {
        var ql = mq.toLowerCase();
        var hits = ql ? vm.products.filter(function (x) { return String(x.sMenu || '').toLowerCase().indexOf(ql) >= 0; }) : [];
        if (hits.length === 1) mp = hits[0];
      }
      if (mp) {
        S.selected = mp.id; S.stock = String(mp.stock); S.minStock = String(mp.minStock); S.price = String(mp.payment); S.barcode = mp.barcode || ''; S.message = null;
        render(); focusLater('m_stock');
      }
      return;
    }
    // Enter in the login form submits, like the IME action on the phone.
    if (e.key === 'Enter' && !session.manager && S.login && e.target && (e.target.id === 'l_id' || e.target.id === 'l_pw')) {
      if (!S.login.loading) { doLogin(S.login); render(); }
    }
  }
  function onDemoClick(e) {
    var b = e.target.closest('[data-demo]');
    if (!b) return;
    var kind = b.getAttribute('data-demo');
    if (kind === 'toggle') { ui.demoOpen = !ui.demoOpen; renderDemo(); return; }
    if (kind === 'tapinput') { var inp = demoEl.querySelector('input'); demoTap(inp && inp.value); return; }
    demoTap(b.getAttribute('data-uid'));
  }

  function routeFromHash() {
    var hr = location.hash.replace('#', '');
    if (hr === 'logout') { logout(); return; }
    if (session.manager) { route = ROUTES.indexOf(hr) >= 0 && routeAllowed(hr) && !(hr === 'receipt' && !vm.last) ? hr : HOME; ui.dropdown = null; initScreen(route); render(true); }
  }

  function start() {
    root = document.getElementById('app');
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    root.addEventListener('keydown', onKeyDown);
    root.addEventListener('error', onImgError, true);
    if (PARAMS.get('demo') === '1') {
      demoEl = document.createElement('div');
      demoEl.addEventListener('click', onDemoClick);
      demoEl.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && e.target.getAttribute('data-demo-in')) { e.preventDefault(); e.stopPropagation(); demoTap(e.target.value); }
      });
      document.body.appendChild(demoEl);
    }
    if (window.PusanNfc) {
      window.PusanNfc.listenForNfc(function (d) { onNfc(d.uid); });
      // USB keyboard-mode reader: only while a screen is waiting for a card.
      window.PusanNfc.enableKeyboardReader(wantsNfc);
      // Barcode scanner at the Pusan Mart counter: product codes go to the cart, everything else stays a card tap.
      if (window.PusanNfc.setScanInterceptor) window.PusanNfc.setScanInterceptor(function (raw) { return onBarcode(raw, false); });
      window.addEventListener('nfc-error', function (e) { toast((e.detail && e.detail.message) || 'NFC read error', 3000); });
      // ACR122U on a PC: taps come from desktop-bridge (127.0.0.1:47321), not as keystrokes.
      if (window.PusanNfc.connectPcReader && !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '')) {
        var pcOn = false;
        window.PusanNfc.connectPcReader(function (on) {
          if (on && !pcOn) toast('Card reader connected', 2000);
          pcOn = on;
        });
      }
    }
    restoreSession();
    window.addEventListener('popstate', routeFromHash);
    window.addEventListener('hashchange', function () { if (location.hash === '#logout') logout(); });
    var lastWide = isWide();
    window.addEventListener('resize', function () {
      var w = isWide();
      if (ui.dropdown || w !== lastWide) { lastWide = w; ui.dropdown = null; render(); }
    });
    var initial = location.hash.replace('#', '');
    if (initial === 'logout') { logout(); return; }
    if (session.manager) navigate(ROUTES.indexOf(initial) >= 0 ? initial : HOME, true);
    else { S = {}; render(true); }
    window.martApp = { tap: onNfc, navigate: navigate, apiBase: API_BASE };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
