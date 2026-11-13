// ===== Data layer: SMEAG e-money API (replaces the old localStorage store) =====
// Base URL: ?api=<url> (saved) > localStorage.pusanApiBase > same origin (hosted) / http://localhost:8787 (local)
var SESSION_KEY = 'smeag-cafe-session';

var API = (function () {
  var IS_LOCAL_PAGE = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) || location.protocol === 'file:';
  // Hosted (Vercel): the API is served from the same domain (/api). Local dev: the Node API on :8787.
  var DEFAULT_API = IS_LOCAL_PAGE ? 'http://localhost:8787' : location.origin;
  function savedApi(v) { return v && (IS_LOCAL_PAGE || !/\/\/(localhost|127\.0\.0\.1)[:/]?/.test(v)) ? v : ''; }
  try {
    var fromQuery = new URLSearchParams(location.search).get('api');
    if (fromQuery) localStorage.setItem('pusanApiBase', fromQuery.replace(/\/+$/, ''));
  } catch (e) { /* storage blocked */ }

  function base() {
    var b = '';
    try { b = localStorage.getItem('pusanApiBase') || ''; } catch (e) { /* ignore */ }
    return (savedApi(b) || DEFAULT_API).replace(/\/+$/, '');
  }

  // ----- session (sessionStorage: token + manager + access) -----
  var session = null;
  try { session = JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch (e) { session = null; }
  function saveSession(s) {
    session = s;
    try {
      if (s) sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
      else sessionStorage.removeItem(SESSION_KEY);
    } catch (e) { /* ignore */ }
  }

  var api = {
    onUnauthorized: null, // set by app.js
    base: base,
    get session() { return session; },
    saveSession: saveSession,
  };

  async function request(method, path, body) {
    var headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (session && session.token) headers.Authorization = 'Bearer ' + session.token;
    var res;
    try {
      res = await fetch(base() + path, { method: method, headers: headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (e) {
      throw new Error('Cannot reach the server (' + base() + ').');
    }
    var data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok) {
      var msg = (data && (data.error || data.message)) || ('Request failed (' + res.status + ')');
      var err = new Error(msg);
      err.status = res.status;
      if (res.status === 401 && path !== '/api/auth/login') {
        saveSession(null);
        if (api.onUnauthorized) api.onUnauthorized(msg);
      }
      throw err;
    }
    return data;
  }
  function qs(params) {
    var parts = [];
    Object.keys(params).forEach(function (k) {
      if (params[k] !== undefined && params[k] !== null && params[k] !== '') parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
    });
    return parts.length ? '?' + parts.join('&') : '';
  }

  // ----- mapping API rows -> the shapes app.js uses -----
  function mapProduct(p) {
    return {
      id: Number(p.id),
      name: String(p.sMenu || ''),
      campus: String(p.campus || ''),
      category: String(p.mMenu || ''),
      sub: String(p.sMenu || ''), // DB has no sub-category column: bank.subcategory is the product name
      price: Number(p.payment) || 0,
      stock: Math.floor(Number(p.stock) || 0),
      minStock: Number(p.minStock) || 0,
      imagePath: p.imagePath || '',
      salesNumber: Number(p.salesNumber) || 0,
    };
  }
  function mapPerson(p) {
    if (!p) return null;
    return {
      id: Number(p.id),
      name: p.name || '',
      uid: p.uid || '',
      sid: p.studentId || '',
      age: p.age === null || p.age === undefined || p.age === '' ? null : Number(p.age),
      campus: p.campus || '',
      balance: Number(p.totalMoney) || 0,
    };
  }

  api.login = function (loginId, password) { return request('POST', '/api/auth/login', { loginId: loginId, password: password }); };
  api.products = async function (campus) {
    var rows = await request('GET', '/api/products' + qs({ campus: campus }));
    return (Array.isArray(rows) ? rows : (rows && rows.products) || []).map(mapProduct);
  };
  api.createProduct = async function (data) { return mapProduct((await request('POST', '/api/products', data)).product); };
  api.updateProduct = async function (id, data) { return mapProduct((await request('PATCH', '/api/products/' + id, data)).product); };
  api.deleteProduct = function (id) { return request('DELETE', '/api/products/' + id); };
  api.personByUid = async function (uid) { return mapPerson((await request('GET', '/api/people/by-nfc/' + encodeURIComponent(uid))).person); };
  api.searchPeople = async function (search) { return ((await request('GET', '/api/people' + qs({ search: search }))).people || []).map(mapPerson); };
  api.updatePerson = async function (id, data) { return mapPerson((await request('PATCH', '/api/people/' + id, data)).person); };
  api.charge = async function (data) { return (await request('POST', '/api/charges', data)).charge; };
  api.checkout = async function (data) { return (await request('POST', '/api/checkouts', data)).checkout; };
  api.sales = async function (filter) { return (await request('GET', '/api/sales' + qs(filter))).sales || []; };
  api.salesReport = async function (filter) { return (await request('GET', '/api/reports/sales' + qs(filter))).report; };

  return api;
})();
