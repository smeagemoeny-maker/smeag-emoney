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
    return fetch(API_BASE + path, { method: method, headers: headers, body: body === undefined ? undefined : JSON.stringify(body) })
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
      salesNumber: Math.trunc(num(p.salesNumber)), minStock: Math.trunc(num(p.minStock))
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
    createPusanmartPayment: function (uid, amount) {
      return apiCall('POST', '/api/pusanmart/payments', { uid: uid, totalAmount: Math.round(amount * 100) / 100 }).then(function (r) { return r.payment; });
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
    pz: { store: 'Select Store', amount: '', label: 'No Discount', rate: 0, submitting: false, error: null, success: null }
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
  function cartSubtotal() { return vm.cart.reduce(function (a, i) { return a + i.product.payment * i.quantity; }, 0); }
  function cartTotalAfterDiscount() { var s = cartSubtotal(); return s - s * vm.discountRate; }

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
    ListAlt: 'M19 5v14H5V5h14m1.1-2H3.9c-.5 0-.9.4-.9.9v16.2c0 .4.4.9.9.9h16.2c.4 0 .9-.5.9-.9V3.9c0-.5-.5-.9-.9-.9zM11 7h6v2h-6V7zm0 4h6v2h-6v-2zm0 4h6v2h-6zM7 7h2v2H7zm0 4h2v2H7zm0 4h2v2H7z'
  };
  var TABS = [
    { route: 'register', label: 'Register', icon: 'AddBox' },
    { route: 'modify', label: 'Modify', icon: 'Edit' },
    { route: 'sales', label: 'Sales', icon: 'ShoppingCart' },
    { route: 'history', label: 'History', icon: 'Receipt' },
    { route: 'report', label: 'Report', icon: 'BarChart' },
    { route: 'buyer', label: 'Buyer Info', icon: 'Badge' },
    { route: 'pusanpay', label: 'Pusan Pay', icon: 'Payments' },
    { route: 'paylist', label: 'Pay List', icon: 'ListAlt' }
  ];
  var ROUTES = TABS.map(function (t) { return t.route; }).concat(['receipt']);

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
        S = { campus: campus, photo: null, name: '', price: '', qty: '', minStock: '5', desc: '', message: null, saving: false };
        break;
      case 'modify':
        S = { campus: campus, category: 'All', subcategory: 'All', selected: null, stock: '', minStock: '', price: '', message: null, pendingDelete: null };
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
        S = { store: vm.pz.store, amount: vm.pz.amount, awaitingTap: false }; break;
      case 'paylist':
        S = { start: ymd(weekAgo), end: ymd(today), results: [] };
        runPayList(); break;
      case 'receipt':
        S = {}; break;
      default: S = {};
    }
  }

  function navigate(r, replace) {
    if (ROUTES.indexOf(r) < 0) r = 'sales';
    if (r === 'receipt' && !vm.last) r = 'sales';
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
      if (!vm.cart.length) { toast('Card read (' + uidStr + '). Add items to the cart first.', 3000); return; }
      S.awaitingTap = false;
      showPayConfirm(uidStr);
    } else if (route === 'buyer') {
      lookupBuyer(uidStr);
    } else if (route === 'pusanpay') {
      if (vm.pz.submitting) { toast('Saving payment... please wait.'); return; }
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
    return !!(session.manager && (route === 'buyer' || ((route === 'sales' || route === 'pusanpay') && S.awaitingTap)));
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
      cart: cart.map(function (it) { return { productId: it.product.id, quantity: it.quantity }; }),
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
  function showPayConfirm(uidStr) {
    var s = S, c = { uid: uidStr, loading: true, person: null, error: null };
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
    vm.buyerLookupError = null; vm.buyerLoading = true; render();
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
  function submitPusanmartPayment(uidStr, amount) {
    vm.pz.error = null; vm.pz.success = null; vm.pz.submitting = true; render();
    repo.createPusanmartPayment(uidStr, amount).then(function (p) {
      vm.pz.success = 'Recorded ₱' + money(amount) + ' for ' + ((p && p.name) || uidStr) + '.';
      vm.pz.amount = '';
      if (route === 'pusanpay') S.amount = '';
    }, function (e) {
      vm.pz.error = e.status === 404 ? 'This NFC card is not registered.' : 'An error occurred while saving the payment: ' + e.message;
    }).then(function () { vm.pz.submitting = false; render(); });
  }

  // ------------------------------------------------------------------ screens
  function campusDropdown(key, onSelect) {
    return dropdown(key, S.campus, allowedCampuses(), onSelect);
  }
  function salesScreen() {
    var allLabel = 'All';
    var catOpts = [allLabel].concat(uniqSorted(vm.products.map(function (p) { return p.mMenu; })));
    var base = S.category === allLabel ? vm.products : vm.products.filter(function (p) { return p.mMenu === S.category; });
    var subOpts = [allLabel].concat(uniqSorted(base.map(function (p) { return p.sMenu; })));
    var q = (S.search || '').trim().toLowerCase();
    var filtered = vm.products.filter(function (p) {
      return (S.category === allLabel || p.mMenu === S.category) && (S.subcategory === allLabel || p.sMenu === S.subcategory) &&
        (!q || String(p.sMenu || '').toLowerCase().indexOf(q) >= 0 || String(p.mMenu || '').toLowerCase().indexOf(q) >= 0);
    });
    if (!vm.cart.length) S.awaitingTap = false;
    actions.in_s_search = function (v) { S.search = v; };

    // Campus / category / subcategory sit in one compact menu row so the products, cart and total stay visible.
    var h = '<div class="screen">' +
      '<div class="sb salesHead"><div class="title" style="padding:0">Sales</div>' +
      (S.confirm ? buyerChip() :
      '<input class="tf search" id="s_search" data-in="in_s_search" type="search" placeholder="🔍 Search product" value="' + esc(S.search || '') + '" autocomplete="off" spellcheck="false">') +
      '<button class="iconbtn" title="Find product by photo" data-act="' + act(notInBrowser) + '">📷</button></div>' +
      '<div class="filterbar">' +
      pillDropdown('s_campus', S.campus, allowedCampuses(), function (v) { S.campus = v; session.selectedCampus = v; saveSession(); vm.cart = []; loadProducts(v); S.category = 'All'; S.subcategory = 'All'; }, '📍') +
      pillDropdown('s_cat', S.category, catOpts, function (v) { if (v !== S.category) S.subcategory = allLabel; S.category = v; }, 'Cat') +
      pillDropdown('s_sub', S.subcategory, subOpts, function (v) { S.subcategory = v; }, 'Sub') +
      '</div>' +
      '<div class="vscroll fill" id="sales-scroll">';
    if (S.error) h += errorLine();
    else if (!filtered.length) h += loadingOr('No products match the selected filters.', 'font-size:12px;color:var(--ink3);padding:12px 0');
    h += '<div class="grid">';
    filtered.forEach(function (p) {
      h += '<div class="pcell" data-act="' + act(function () { addToCart(p); }) + '">' + thumb(p) + spacer(6) +
        '<div class="pname">' + esc(p.sMenu || '-') + '</div><div class="pprice">₱' + money(p.payment) + '</div></div>';
    });
    h += '</div>';
    h += '<div class="divider" style="margin:14px 0"></div>' + eyebrow('CART') + spacer(8);
    if (!vm.cart.length) h += txt('Your cart is empty. Select a product above.', 'font-size:12px;color:var(--ink3)');
    vm.cart.forEach(function (it) {
      h += '<div class="cartrow">' + thumb(it.product, 40) + '<div class="cartname">' + esc(it.product.sMenu || '-') + '</div>' +
        '<div class="stepper"><div class="stepbtn" data-act="' + act(function () { changeQty(it.product, -1); }) + '">−</div>' +
        '<div class="stepqty">' + it.quantity + '</div>' +
        '<div class="stepbtn" data-act="' + act(function () { changeQty(it.product, 1); }) + '">+</div></div></div>';
    });
    h += spacer(4) + '<div class="chips">';
    [['No Discount', 0], ['Manager 15%', 0.15], ['Teacher 10%', 0.10]].forEach(function (c) {
      h += '<div class="chip' + (vm.discountLabel === c[0] ? ' sel' : '') + '" data-act="' + act(function () { vm.discountLabel = c[0]; vm.discountRate = c[1]; }) + '">' + c[0] + '</div>';
    });
    h += '</div>' + spacer(10) +
      '<div class="sb" style="padding-top:10px"><span style="font-size:12px;color:var(--ink2)">Total</span>' +
      '<span style="font-size:13px;font-weight:700">₱' + money(cartTotalAfterDiscount()) + '</span></div>';
    if (vm.checkoutError) h += txt(vm.checkoutError, 'color:var(--out);font-size:12px;padding-top:8px');
    h += '</div>';
    if (!vm.cart.length) S.confirm = null;
    var c = S.confirm, total = cartTotalAfterDiscount();
    if (c && !c.loading && c.person && !S.paying) {
      // Card tapped: the student's info is next to "Sales"; the staff checks it and confirms here.
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
    var enabled = vm.cart.length > 0 && !S.paying;
    var wait = S.awaitingTap || S.paying;
    h += '<div class="nfcbox' + (wait ? ' wait' : '') + (enabled ? ' enabled' : '') + '"' +
      (enabled ? ' data-act="' + act(function () { vm.checkoutError = null; S.awaitingTap = true; }) + '"' : '') + '>' +
      '<div class="ic">📶</div>' +
      '<div style="font-size:12px;font-weight:700">' + (S.paying ? 'Processing payment...' : S.awaitingTap ? 'Please tap your NFC card...' : 'Tap your NFC card on the back of the phone') + '</div>' +
      '<div style="font-size:10.5px;color:var(--ink2)">Check the student info, then confirm payment</div></div>';
    }
    h += '</div>';
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
    if (idx >= 0) vm.cart[idx] = { product: vm.cart[idx].product, quantity: q };
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
    if (q2 <= 0) vm.cart.splice(idx, 1); else vm.cart[idx] = { product: vm.cart[idx].product, quantity: q2 };
  }

  function registerScreen() {
    var h = '<div class="screen"><div class="vscroll fill">' + eyebrow('Product Register') + title('Register Product') +
      campusDropdown('r_campus', function (v) { S.campus = v; }) +
      '<div class="photobox">' + (S.photo ? '<img src="' + esc(S.photo) + '" alt="">' :
        '<div style="font-size:24px;line-height:normal;letter-spacing:0">📷</div>' + spacer(6) +
        '<div style="font-size:11.5px;color:var(--ink3)">Select a photo</div>') + '</div>' +
      '<div class="row" style="padding:6px 0 8px"><div class="half l">' + secondaryBtn('📷 Take Photo', function () { pickImage(true, function (u) { S.photo = u; }); }) +
      '</div><div class="half r">' + secondaryBtn('🖼 Choose from Gallery', function () { pickImage(false, function (u) { S.photo = u; }); }) + '</div></div>' + spacer(14) +
      labeledField('r_name', 'Product Name', S.name, function (v) { S.name = v; }, 'e.g. Coke Zero 245ml') +
      half(
        labeledField('r_price', 'Product Price (PHP)', S.price, function (v) { S.price = v; }, '0.00', 'decimal'),
        labeledField('r_qty', 'Quantity', S.qty, function (v) { S.qty = v; }, '0', 'numeric')
      ) +
      labeledField('r_min', 'Minimum Stock Threshold (Warn≤)', S.minStock, function (v) { S.minStock = v; }, 'e.g. 6', 'numeric') +
      labeledField('r_desc', 'Description', S.desc, function (v) { S.desc = v; }, 'Optional');
    if (S.message) h += txt(S.message, 'color:var(--brand);font-size:12px;padding-bottom:8px');
    h += primaryBtn(S.saving ? 'Registering...' : 'REGISTER', doRegister, S.saving) + spacer(24) + '</div></div>';
    return h;
  }
  function doRegister() {
    var price = parseNum(S.price), qty = parseIntStrict(S.qty), min = parseIntStrict(S.minStock);
    if (min == null) min = 5;
    if (!S.name.trim() || price == null || qty == null) { S.message = 'Please enter a valid product name, price, and quantity.'; return; }
    var s = S, hadPhoto = !!S.photo;
    s.saving = true; s.message = null;
    // Same row as DbRepository.insertProduct: Campus upper-cased, m_menu = campus. The Android app
    // uploads the photo by SFTP first; a browser cannot, so the product is saved without an image.
    repo.createProduct({ campus: s.campus.toUpperCase(), mMenu: martMenuFor(s.campus), sMenu: s.name.trim(), payment: price, stock: qty, minStock: min })
      .then(function () {
        s.message = 'Registered successfully.';
        s.name = ''; s.price = ''; s.qty = ''; s.desc = ''; s.photo = null;
        if (hadPhoto && S === s) toast('Photo not uploaded: the browser cannot upload product photos. Product saved without an image.', 4000);
      }, function (e) { s.message = 'Registration failed: ' + e.message; })
      .then(function () { s.saving = false; render(); });
  }

  function modifyScreen() {
    var catOpts = ['All'].concat(uniqSorted(vm.products.map(function (p) { return p.mMenu; })));
    if (catOpts.indexOf(S.category) < 0) S.category = 'All';
    var base = S.category === 'All' ? vm.products : vm.products.filter(function (p) { return p.mMenu === S.category; });
    var subOpts = ['All'].concat(uniqSorted(base.map(function (p) { return p.sMenu; })));
    if (subOpts.indexOf(S.subcategory) < 0) S.subcategory = 'All';
    var filtered = vm.products.filter(function (p) {
      return (S.category === 'All' || p.mMenu === S.category) && (S.subcategory === 'All' || p.sMenu === S.subcategory);
    });
    var h = '<div class="screen"><div class="vscroll fill">' + eyebrow('Product Modify') + title('Edit Products') +
      campusDropdown('m_campus', function (v) { S.campus = v; S.selected = null; loadProducts(v); }) +
      dropdown('m_cat', S.category, catOpts, function (v) { S.category = v; S.subcategory = 'All'; }, 'Category') +
      dropdown('m_sub', S.subcategory, subOpts, function (v) { S.subcategory = v; }, 'Subcategory');
    if (S.error) h += errorLine();
    if (!filtered.length) h += loadingOr('No products match the selected filters.', 'font-size:12.5px;color:var(--ink2);padding:8px 0');
    if (S.message && !S.selected) h += txt(S.message, 'color:var(--brand);font-size:12px;padding-bottom:8px');
    filtered.forEach(function (p) {
      var st = stockStatus(p), isSel = S.selected === p.id;
      var bc = st === 'OK' ? 'var(--border)' : st === 'LOW' ? 'var(--low)' : 'var(--out)';
      h += '<div class="mitem ' + (isSel ? 'sel' : st.toLowerCase()) + '">' +
        '<div class="mhead" data-act="' + act(function () {
          if (isSel) S.selected = null;
          else { S.selected = p.id; S.stock = String(p.stock); S.minStock = String(p.minStock); S.price = String(p.payment); S.message = null; }
        }) + '">' + thumb(p, 40) + '<div class="info"><div style="font-size:12.5px;font-weight:700">' + esc(p.sMenu || '-') + '</div>' +
        '<div style="font-size:10.5px;color:var(--ink2)">Stock ' + p.stock + ' · Threshold ' + p.minStock + '</div></div>' + stockBadge(st) + '</div>';
      if (isSel) {
        h += '<div class="divider" style="background:' + bc + '"></div><div style="padding:10px">' +
          half(
            labeledField('m_stock', 'Stock Quantity', S.stock, function (v) { S.stock = v; }, '', 'numeric'),
            labeledField('m_min', 'Minimum Stock Threshold', S.minStock, function (v) { S.minStock = v; }, '', 'numeric')
          ) +
          labeledField('m_price', 'Price (PHP)', S.price, function (v) { S.price = v; }, '', 'decimal');
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
  function saveModify(p) {
    var ns = parseIntStrict(S.stock), nm = parseIntStrict(S.minStock), np = parseNum(S.price);
    if (ns == null || nm == null) { S.message = 'Please enter a valid stock quantity.'; return; }
    var s = S, changes = { stock: ns, minStock: nm };
    if (np != null) changes.payment = np;
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
    var h = '<div class="screen">' + eyebrow('Sales History') + title('Sales History') +
      campusDropdown('h_campus', function (v) { S.campus = v; runHistory(); }) +
      half(dateField('Start Date', S.start, function (v) { S.start = v; }), dateField('End Date', S.end, function (v) { S.end = v; })) +
      half(
        dropdown('h_cat', S.category, catOpts, function (v) { S.category = v; }, 'Category'),
        dropdown('h_sub', S.subcategory, subOpts, function (v) { S.subcategory = v; }, 'Subcategory')
      ) +
      secondaryBtn('Search', runHistory) + spacer(10) + '<div class="vscroll fill">' + errorLine();
    if (!results.length && !S.error) h += loadingOr('No sales history found.', 'font-size:12px;color:var(--ink3)');
    results.forEach(function (t) {
      var qty = num(t.quantity);
      h += '<div class="card sb" style="margin-bottom:8px;padding:10px"><div>' +
        '<div style="font-size:12.5px;font-weight:700">' + esc((t.subcategory || '-') + (qty > 1 ? ' × ' + qty : '')) + '</div>' +
        '<div style="font-size:10.5px;color:var(--ink2)">Buyer: ' + esc(t.name || '-') + '</div>' +
        '<div style="font-size:10.5px;color:var(--ink2)">' + esc((t.campus || '-') + ' · ' + (t.remark || t.source || 'office')) + '</div>' +
        '<div style="font-size:10px;color:var(--ink3)">' + esc(t.date || '') + '</div></div>' +
        '<div style="font-size:12px;font-weight:700">₱' + money(t.payment) + '</div></div>';
    });
    h += '</div></div>';
    return h;
  }

  function runReport() {
    screenLoad(repo.fetchWeeklyReport(S.campus, S.start, S.end), function (r) { S.report = r; },
      function (e) { S.error = 'Failed to load report: ' + e.message; });
  }
  function reportScreen() {
    var h = '<div class="screen"><div class="vscroll fill">' + eyebrow('Report') + title('Report') +
      campusDropdown('rp_campus', function (v) { S.campus = v; runReport(); }) +
      half(dateField('Start Date', S.start, function (v) { S.start = v; }), dateField('End Date', S.end, function (v) { S.end = v; })) +
      secondaryBtn('Search', runReport) + spacer(10) + errorLine();
    var r = S.report;
    if (!r && S.loading) h += txt('Loading...', 'font-size:12px;color:var(--ink3)');
    if (r) {
      var stat = function (label, value, color) {
        return '<div class="stat"><div class="lab">' + esc(label) + '</div><div class="val" style="color:' + (color || 'var(--ink)') + '">' + esc(value) + '</div></div>';
      };
      h += primaryBtn('⬇ Download Report PDF', notInBrowser) + spacer(14) +
        '<div class="row" style="gap:8px">' + stat('Total Revenue', '₱' + Math.round(r.totalRevenue)) + stat('Transactions', String(r.transactionCount)) + '</div>' + spacer(8) +
        '<div class="row" style="gap:8px">' + stat('Avg. Order Value', '₱' + r.avgOrderValue) + stat('Low Stock Alerts', String(r.lowStock.length), 'var(--low)') + '</div>' +
        spacer(16) + eyebrow('Daily Sales') + spacer(8);
      var maxVal = Math.max(1, r.dailyTotals.reduce(function (m, d) { return Math.max(m, d[1]); }, 0));
      h += '<div class="bars">';
      r.dailyTotals.forEach(function (d) {
        var f = Math.min(1, Math.max(0.04, d[1] / maxVal));
        h += '<div class="col"><div class="bar" style="height:' + (f * 100) + '%"></div></div>';
      });
      h += '</div><div class="barlabels">';
      r.dailyTotals.forEach(function (d) { h += '<div>' + esc(d[0].slice(-2)) + '</div>'; });
      h += '</div>' + spacer(16) + '<div class="divider"></div>' + spacer(12) + eyebrow('Top Sellers (by Quantity)') + spacer(8);
      r.topProducts.forEach(function (tp, idx) {
        h += '<div class="listrow"><div class="rank" style="background:' + (idx === 0 ? 'var(--brand)' : 'var(--ink)') + '">' + (idx + 1) + '</div>' +
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
      if (sub != null && finalTotal != null) {
        h += '<div class="sb" style="padding-bottom:10px"><span style="font-size:12px;color:var(--ink2)">Total after discount</span>' +
          '<span style="font-size:13px;font-weight:700">₱' + money(finalTotal) + '</span></div>';
      }
      if (vm.pz.success) h += txt(vm.pz.success, 'color:var(--ok);font-size:12px;padding-bottom:8px');
      if (vm.pz.error) h += txt(vm.pz.error, 'color:var(--out);font-size:12px;padding-bottom:8px');
      h += spacer(6);
      var label = vm.pz.submitting ? 'Saving payment...' : S.awaitingTap ? 'Please tap your NFC card...' : !canStart ? 'Enter a valid total amount first' : 'Tap your NFC card on the back of the phone';
      var en = canStart && !vm.pz.submitting;
      h += '<div class="nfcbox' + (S.awaitingTap ? ' wait' : '') + (en ? ' enabled' : '') + '"' +
        (en ? ' data-act="' + act(function () { vm.pz.error = null; vm.pz.success = null; S.awaitingTap = true; }) + '"' : '') + '>' +
        '<div class="ic">📶</div><div style="font-size:12px;font-weight:700">' + label + '</div>' +
        (canStart ? '<div style="font-size:10.5px;color:var(--ink2)">Payment logs as soon as you tap</div>' : '') + '</div>';
    }
    h += '</div>';
    return h;
  }

  function runPayList() {
    screenLoad(repo.fetchPusanmartPayments(S.start, S.end), function (rows) { S.results = rows; },
      function (e) { S.results = []; S.error = '조회에 실패했습니다: ' + e.message; });
  }
  function downloadPayListCsv() {
    var cell = function (v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var total = S.results.reduce(function (a, r) { return a + r.allPayments; }, 0);
    var rows = [['No', 'Name', 'NFCID', 'Date', 'Amount (PHP)']];
    S.results.forEach(function (r, i) { rows.push([i + 1, r.name || '-', r.nfcid, r.date || '-', money(r.allPayments)]); });
    rows.push([]);
    rows.push(['Search Range', S.start + ' ~ ' + S.end]);
    rows.push(['Transaction Count', S.results.length]);
    rows.push(['Total Amount Earned (PHP)', money(total)]);
    var name = 'pusanmart_paylist_' + Date.now() + '.csv';
    downloadFile(name, 'text/csv;charset=utf-8', '﻿' + rows.map(function (r) { return r.map(cell).join(','); }).join('\r\n'));
    toast('Downloads 폴더에 저장되었습니다: ' + name, 3500);
  }
  function payListScreen() {
    var total = S.results.reduce(function (a, r) { return a + r.allPayments; }, 0);
    var h = '<div class="screen">' + eyebrow('PusanMart') + title('Pay List') +
      half(dateField('Start Date', S.start, function (v) { S.start = v; }), dateField('End Date', S.end, function (v) { S.end = v; })) +
      secondaryBtn('Search', runPayList) + spacer(10) +
      '<div class="sb" style="padding-bottom:10px"><span style="font-size:12px;color:var(--ink2)">' + S.results.length + '건</span>' +
      '<span style="font-size:13px;font-weight:700">합계 ₱' + money(total) + '</span></div>' +
      primaryBtn('⬇ Download Excel', downloadPayListCsv, !S.results.length) + spacer(10) + '<div class="vscroll fill">' + errorLine();
    if (!S.results.length && !S.error) h += loadingOr('해당 기간의 PusanMart 결제 내역이 없습니다.', 'font-size:12px;color:var(--ink3)');
    S.results.forEach(function (r) {
      h += '<div class="card sb" style="margin-bottom:8px;padding:10px"><div>' +
        '<div style="font-size:12.5px;font-weight:700">' + esc(r.name || '-') + '</div>' +
        '<div style="font-size:10.5px;color:var(--ink2)">NFC ' + esc(r.nfcid) + '</div>' +
        '<div style="font-size:10px;color:var(--ink3)">' + esc(r.date || '') + '</div></div>' +
        '<div style="font-size:12px;font-weight:700">₱' + money(r.allPayments) + '</div></div>';
    });
    h += '</div></div>';
    return h;
  }

  function receiptText(L) {
    var sub = L.cart.reduce(function (a, i) { return a + i.product.payment * i.quantity; }, 0);
    var lines = ['SMEAG Mobile Mart - ' + L.campus, ''];
    L.cart.forEach(function (it) { lines.push(it.product.sMenu + ' × ' + it.quantity + '  ₱' + money(it.product.payment * it.quantity)); });
    lines.push(L.label + '  −₱' + money(sub * L.rate));
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
    var sub = L.cart.reduce(function (a, i) { return a + i.product.payment * i.quantity; }, 0);
    var disc = sub * L.rate;
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
      h += '<div class="sb" style="padding:5px 0"><span style="font-size:12px;color:var(--ink2)">' + esc(it.product.sMenu + ' × ' + it.quantity) + '</span>' +
        '<span style="font-size:12px;font-weight:700">₱' + money(it.product.payment * it.quantity) + '</span></div>';
    });
    h += '<div class="sb" style="padding:5px 0"><span style="font-size:12px;color:var(--ink2)">' + esc(L.label) + '</span>' +
      '<span style="font-size:12px;font-weight:700">−₱' + money(disc) + '</span></div>' +
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
      '<div style="font-size:19px;font-weight:800">SMEAG Mobile Mart</div>' +
      '<div style="font-size:12.5px;color:var(--ink2);padding-top:2px">Admin (Manager) Login Only</div>' + spacer(22) +
      // ID only: the campus comes from the account (only that campus is shown after login).
      labeledField('l_id', 'ID', L.id, function (v) { L.id = v; }, 'Manager account (staff ID / email)') +
      '<div style="display:flex;align-items:center;width:100%;padding-bottom:4px">' +
      '<div class="cbx' + (L.remember ? ' on' : '') + '" data-act="' + act(function () { L.remember = !L.remember; }) + '"><div class="box">' +
      (L.remember ? '<svg viewBox="0 0 24 24"><path d="M4.5 12.5l5 5 10-11"/></svg>' : '') + '</div></div>' +
      '<span style="font-size:12.5px;color:var(--ink2);padding-left:2px">Remember me</span></div>';
    if (L.error) h += spacer(6) + txt(L.error, 'color:var(--out);font-size:12px;align-self:flex-start');
    h += spacer(8) + primaryBtn(L.loading ? 'Logging in...' : 'Login', function () { doLogin(L); }, L.loading) + spacer(16) +
      '<div style="font-size:10.5px;color:var(--ink3);text-align:center;line-height:15px;letter-spacing:0.5px">※ Students / buyers can look up their info by tapping an<br>NFC card only, without logging in</div>' +
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
      navigate('sales', true);
    }, function (e) {
      L.error = e.status === 0 ? e.message : e.status === 403 ? e.message : 'Login failed: ' + e.message;
    }).then(function () { L.loading = false; render(); });
  }

  function navBar() {
    var h = '<nav class="navbar">';
    TABS.forEach(function (t) {
      var sel = route === t.route;
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
      if (nr !== route) navigate(nr);
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
    if (session.manager) { route = ROUTES.indexOf(hr) >= 0 && !(hr === 'receipt' && !vm.last) ? hr : 'sales'; ui.dropdown = null; initScreen(route); render(true); }
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
      window.addEventListener('nfc-error', function (e) { toast((e.detail && e.detail.message) || 'NFC read error', 3000); });
    }
    restoreSession();
    window.addEventListener('popstate', routeFromHash);
    window.addEventListener('hashchange', function () { if (location.hash === '#logout') logout(); });
    window.addEventListener('resize', function () { if (ui.dropdown) { ui.dropdown = null; render(); } });
    var initial = location.hash.replace('#', '');
    if (initial === 'logout') { logout(); return; }
    if (session.manager) navigate(ROUTES.indexOf(initial) >= 0 ? initial : 'sales', true);
    else { S = {}; render(true); }
    window.martApp = { tap: onNfc, navigate: navigate, apiBase: API_BASE };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
