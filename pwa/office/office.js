/* SMEAG OFFICE ONLINE PROGRAM — browser replica of the WinForms OFFICE MENU page.
   Port of MainForm.cs / TabStrip.cs / HeaderBanner.cs / OfficeMenuPage.cs / InputDialog.cs, backed by the PUSAN MART API
   (/api/auth/login, /api/people/by-nfc/:uid, /api/office/menus, /api/office/transactions).
   Everything runs from start() on DOMContentLoaded (no top-level references before declaration). */
(function () {
  'use strict';

  var WIN_W = 1708, WIN_H = 1030;
  var OFFICE_MENU_INDEX = 4;
  var TAB_NAMES = [
    'REGISTRATION', 'INFORMATION', 'MODIFY INFO', 'MENU LIST', 'OFFICE MENU',
    'LIST MENU', 'Graduate', 'Default', 'REPORT', 'RECHARGE/CASHOUT',
    'IDCARD', 'PAYMENT INQUIRY', 'TransData'
  ];
  var COLORS = { INCREASE: '#2E7D32', DECREASE: '#C62828', EXCEPTION: '#1976D2' };

  /* ================= backend API client ================= */
  function createApi() {
    var IS_LOCAL_PAGE = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) || location.protocol === 'file:';
    // Hosted (Vercel): the API is served from the same domain (/api). Local dev: the Node API on :8787.
    var DEFAULT_API = IS_LOCAL_PAGE ? 'http://localhost:8787' : location.origin;
    function savedApi(v) { return v && (IS_LOCAL_PAGE || !/\/\/(localhost|127\.0\.0\.1)[:/]?/.test(v)) ? v : ''; }
    var DEFAULT_BASE = DEFAULT_API;
    function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
    function ssGet(k) { try { return window.sessionStorage.getItem(k); } catch (e) { return null; } }
    function ssSet(k, v) { try { if (v == null) window.sessionStorage.removeItem(k); else window.sessionStorage.setItem(k, v); } catch (e) { /* ignore */ } }

    var qs = null;
    try { qs = new URLSearchParams(window.location.search).get('api'); } catch (e) { qs = null; }
    if (qs) lsSet('pusanApiBase', qs.replace(/\/+$/, ''));
    var base = (qs || savedApi(lsGet('pusanApiBase')) || DEFAULT_BASE).replace(/\/+$/, '');

    var session = null;
    try { session = JSON.parse(ssGet('officeSession') || 'null'); } catch (e) { session = null; }
    var onUnauthorized = null; // async () => void ; set by start()

    function request(method, path, body, retried) {
      var headers = { 'Accept': 'application/json' };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (session && session.token) headers['Authorization'] = 'Bearer ' + session.token;
      return fetch(base + path, { method: method, headers: headers, body: body === undefined ? undefined : JSON.stringify(body) })
        .catch(function () { throw apiError(0, 'Cannot connect to the server.\n' + base); })
        .then(function (res) {
          return res.text().then(function (t) {
            var data = null;
            try { data = t ? JSON.parse(t) : null; } catch (e) { data = null; }
            if (res.status === 401 && path !== '/api/auth/login' && !retried && onUnauthorized) {
              setSession(null);
              return onUnauthorized().then(function () { return request(method, path, body, true); });
            }
            if (!res.ok) throw apiError(res.status, (data && (data.error || data.message)) || ('HTTP ' + res.status));
            return data;
          });
        });
    }
    function apiError(status, msg) { var e = new Error(msg); e.status = status; return e; }
    function setSession(s) {
      session = s;
      ssSet('officeSession', s ? JSON.stringify(s) : null);
      if (s && s.manager) ssSet('officeLastLogin', s.manager.login_id);
    }

    return {
      base: base,
      session: function () { return session; },
      setSession: setSession,
      lastLoginId: function () { return ssGet('officeLastLogin') || ''; },
      setUnauthorizedHandler: function (fn) { onUnauthorized = fn; },
      login: function (loginId, password) { return request('POST', '/api/auth/login', { loginId: loginId, password: password }); },
      personByUid: function (uid) { return request('GET', '/api/people/by-nfc/' + encodeURIComponent(uid)); },
      menus: function (campus) { return request('GET', '/api/office/menus?campus=' + encodeURIComponent(campus || '')); },
      saveTransaction: function (uid, lines) { return request('POST', '/api/office/transactions', { uid: uid, lines: lines }); },
      // Generic call for the other tabs (tabs/*.js): request('GET', '/api/...', body?)
      request: function (method, path, body) { return request(method, path, body); }
    };
  }

  function toCents(v) { var n = parseFloat(v); return isNaN(n) ? 0 : Math.round(n * 100); }

  /* ================= formatting (amounts are integer cents) ================= */
  function money(cents) { // #,##0.00
    var neg = cents < 0; var v = Math.abs(cents);
    var s = Math.floor(v / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + String(v % 100).padStart(2, '0');
    return (neg ? '-' : '') + s;
  }
  function signedMoney(cents) { // +#,##0.00;-#,##0.00;+0.00
    return (cents < 0 ? '-' : '+') + money(Math.abs(cents));
  }
  function plain(cents) { // 0.00
    return (cents / 100).toFixed(2);
  }
  function parsePriceCents(text) {
    var t = String(text).replace(/,/g, '').trim();
    if (!/^\d*\.?\d*$/.test(t) || t === '' || t === '.') return null;
    return Math.round(parseFloat(t) * 100);
  }
  function el(id) { return document.getElementById(id); }

  /* ================= header logo (HeaderBanner.DrawFallbackLogo) ================= */
  function arcPath(cx, cy, r, startDeg, sweepDeg) {
    var a0 = startDeg * Math.PI / 180, a1 = (startDeg + sweepDeg) * Math.PI / 180;
    var x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
    var x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    return 'M' + x0.toFixed(2) + ' ' + y0.toFixed(2) + ' A' + r + ' ' + r + ' 0 ' + (sweepDeg > 180 ? 1 : 0) + ' 1 ' + x1.toFixed(2) + ' ' + y1.toFixed(2);
  }
  function drawLogo() {
    // globe rect (22,14,52,52) => center (48,40), r 26 ; ring inflated by 3 => r 29
    var gx = 22, gy = 14, gw = 52, gh = 52, cx = 48, cy = 40;
    var grid = '#5A5A5A';
    var svg = '';
    svg += '<defs><linearGradient id="smeagGrad" gradientUnits="userSpaceOnUse" x1="0" y1="14" x2="0" y2="48">' +
      '<stop offset="0" stop-color="#FFAA3C"/><stop offset="1" stop-color="#FF5000"/></linearGradient></defs>';
    svg += '<g fill="none" stroke="' + grid + '" stroke-width="2">' +
      '<ellipse cx="' + cx + '" cy="' + cy + '" rx="' + (gw / 2) + '" ry="' + (gh / 2) + '"/>' +
      '<ellipse cx="' + cx + '" cy="' + cy + '" rx="' + ((gw - 26) / 2) + '" ry="' + (gh / 2) + '"/>' +
      '<line x1="' + cx + '" y1="' + gy + '" x2="' + cx + '" y2="' + (gy + gh) + '"/>' +
      '<line x1="' + (gx + 3) + '" y1="' + (gy + 16) + '" x2="' + (gx + gw - 3) + '" y2="' + (gy + 16) + '"/>' +
      '<line x1="' + gx + '" y1="' + (gy + 26) + '" x2="' + (gx + gw) + '" y2="' + (gy + 26) + '"/>' +
      '<line x1="' + (gx + 3) + '" y1="' + (gy + 36) + '" x2="' + (gx + gw - 3) + '" y2="' + (gy + 36) + '"/>' +
      '</g>';
    svg += '<g fill="none" stroke-width="4">' +
      '<path stroke="#F7941D" d="' + arcPath(cx, cy, 29, 100, 150) + '"/>' +
      '<path stroke="#8DC63F" d="' + arcPath(cx, cy, 29, 250, 70) + '"/>' +
      '<path stroke="#0072BC" d="' + arcPath(cx, cy, 29, 320, 130) + '"/>' +
      '</g>';
    svg += '<text x="78" y="47" fill="url(#smeagGrad)" font-family="\'Arial Black\', \'Arial\', sans-serif" font-weight="900" ' +
      'font-style="italic" font-size="38" textLength="148" lengthAdjust="spacingAndGlyphs">SMEAG</text>';
    svg += '<text x="82" y="61" fill="#8C8C8C" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="11" ' +
      'letter-spacing="1.6" word-spacing="2">GLOBAL EDUCATION</text>';
    el('logo').innerHTML = svg;
  }

  /* ================= dialogs (MessageBox / InputDialog) ================= */
  var ICONS = {
    warning: '<svg class="mb-icon" viewBox="0 0 32 32"><path d="M16 2L31 29H1z" fill="#FFC83D" stroke="#C49000" stroke-width="1"/><rect x="14.5" y="10" width="3" height="11" fill="#000"/><rect x="14.5" y="23" width="3" height="3" fill="#000"/></svg>',
    question: '<svg class="mb-icon" viewBox="0 0 32 32"><circle cx="16" cy="16" r="15" fill="#1C6FD1"/><text x="16" y="23" text-anchor="middle" font-family="Arial" font-weight="700" font-size="20" fill="#fff">?</text></svg>',
    info: '<svg class="mb-icon" viewBox="0 0 32 32"><circle cx="16" cy="16" r="15" fill="#1C6FD1"/><rect x="14.5" y="13" width="3" height="11" fill="#fff"/><rect x="14.5" y="8" width="3" height="3" fill="#fff"/></svg>',
    error: '<svg class="mb-icon" viewBox="0 0 32 32"><circle cx="16" cy="16" r="15" fill="#E81123"/><path d="M10.5 10.5L21.5 21.5M21.5 10.5L10.5 21.5" stroke="#fff" stroke-width="2.6"/></svg>'
  };
  var X_SVG = '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 0L10 10M10 0L0 10" stroke="currentColor" stroke-width="1.1"/></svg>';

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }

  // Opens a dialog centered in the client area. build(dlg, close) wires it up; resolves with close(value).
  function openDialog(html, wire) {
    return new Promise(function (resolve) {
      var layer = el('modalLayer');
      var prevFocus = document.activeElement;
      var dlg = document.createElement('div');
      dlg.className = 'dlg';
      dlg.innerHTML = html;
      layer.appendChild(dlg);
      layer.hidden = false;
      var w = dlg.offsetWidth, h = dlg.offsetHeight;
      dlg.style.left = Math.round((1706 - w) / 2) + 'px';
      dlg.style.top = Math.round((998 - h) / 2) + 'px';
      var done = false;
      function close(value) {
        if (done) return; done = true;
        dlg.removeEventListener('keydown', onKey, true);
        layer.removeChild(dlg);
        if (!layer.children.length) layer.hidden = true;
        if (prevFocus && prevFocus.focus) { try { prevFocus.focus(); } catch (e) { /* ignore */ } }
        resolve(value);
      }
      var handlers = wire(dlg, close) || {};
      function onKey(e) {
        if (layer.lastElementChild !== dlg) return;   // a nested message box owns the keyboard
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (!handlers.noCancel) close(handlers.cancelValue); }
        else if (e.key === 'Enter' && handlers.onEnter) { e.preventDefault(); e.stopPropagation(); handlers.onEnter(); }
      }
      dlg.addEventListener('keydown', onKey, true);
      dlg.querySelector('.dlg-x').addEventListener('click', function () { if (!handlers.noCancel) close(handlers.cancelValue); });
      var f = dlg.querySelector('[data-autofocus]');
      if (f) f.focus();
    });
  }

  // buttons: 'OK' | 'YesNo' ; icon: warning|question|info|error ; resolves 'OK' | 'Yes' | 'No'
  function messageBox(text, caption, buttons, icon) {
    var btns = buttons === 'YesNo' ? ['Yes', 'No'] : ['OK'];
    var html = '<div class="dlg-title">' + escapeHtml(caption) + '<button class="dlg-x" tabindex="-1">' + X_SVG + '</button></div>' +
      '<div class="mb-body">' + (ICONS[icon] || '') + '<div class="mb-text">' + escapeHtml(text) + '</div></div>' +
      '<div class="mb-foot">' + btns.map(function (b, i) {
        return '<button class="w10btn' + (i === 0 ? ' def' : '') + '" data-v="' + b + '"' + (i === 0 ? ' data-autofocus' : '') + '>' + b + '</button>';
      }).join('') + '</div>';
    return openDialog(html, function (dlg, close) {
      dlg.style.minWidth = '262px';
      dlg.querySelectorAll('.w10btn').forEach(function (b) {
        b.addEventListener('click', function () { close(b.getAttribute('data-v')); });
      });
      return { cancelValue: buttons === 'YesNo' ? 'No' : 'OK' };
    });
  }

  function warn(msg) { return messageBox(msg, 'SMEAG', 'OK', 'warning'); }

  // InputDialog.Show — resolves trimmed text or null on cancel; re-prompts on empty input.
  function inputDialog(title, prompt) {
    var html = '<div class="dlg-title">' + escapeHtml(title) + '<button class="dlg-x" tabindex="-1">' + X_SVG + '</button></div>' +
      '<div class="idlg-body">' +
      '<label>' + escapeHtml(prompt) + '</label>' +
      '<input type="text" maxlength="255" data-autofocus>' +
      '<button class="flat" data-ok style="left:232px;top:90px;width:84px;height:32px;background:#0078D7">OK</button>' +
      '<button class="flat" data-cancel style="left:320px;top:90px;width:84px;height:32px;background:#6E6E78">Cancel</button>' +
      '</div>';
    return openDialog(html, function (dlg, close) {
      var input = dlg.querySelector('input');
      var busy = false;
      function ok() {
        if (busy) return;
        var v = input.value.trim();
        if (v.length > 0) { close(v); return; }
        busy = true;
        messageBox('Please enter a reason.', 'SMEAG', 'OK', 'warning').then(function () { busy = false; input.focus(); });
      }
      dlg.querySelector('[data-ok]').addEventListener('click', ok);
      dlg.querySelector('[data-cancel]').addEventListener('click', function () { close(null); });
      return { cancelValue: null, onEnter: ok };
    });
  }

  // Staff login (Win10 message-box style). Resolves the login response once a staff member with office access signs in.
  function loginDialog(api) {
    var html = '<div class="dlg-title">SMEAG OFFICE LOGIN<button class="dlg-x" tabindex="-1">' + X_SVG + '</button></div>' +
      '<div class="ldlg-body">' +
      '<label style="left:16px;top:20px">ID:</label>' +
      '<input type="text" data-id maxlength="50" spellcheck="false" autocomplete="username" data-autofocus style="left:100px;top:16px">' +
      '<label style="left:16px;top:56px">PASSWORD:</label>' +
      '<input type="password" data-pw maxlength="100" autocomplete="current-password" style="left:100px;top:52px">' +
      '</div>' +
      '<div class="mb-foot"><button class="w10btn def" data-ok>OK</button></div>';
    return openDialog(html, function (dlg, close) {
      var id = dlg.querySelector('[data-id]'), pw = dlg.querySelector('[data-pw]'), okBtn = dlg.querySelector('[data-ok]');
      var busy = false;
      id.value = api.lastLoginId();
      if (id.value) setTimeout(function () { pw.focus(); }, 0);
      function fail(msg, focusEl) {
        return messageBox(msg, 'SMEAG', 'OK', 'warning').then(function () { busy = false; okBtn.disabled = false; focusEl.focus(); focusEl.select(); });
      }
      function ok() {
        if (busy) return;
        var loginId = id.value.trim(), password = pw.value;
        if (!loginId) { busy = true; fail('Please enter ID.', id); return; }
        if (!password) { busy = true; fail('Please enter password.', pw); return; }
        busy = true; okBtn.disabled = true;
        api.login(loginId, password).then(function (res) {
          if (!res || !res.manager || !res.token) { pw.value = ''; return fail('Invalid ID or password.', pw); }
          if (!res.access || !res.access.office) { pw.value = ''; return fail('This account has no access to SMEAG OFFICE.', id); }
          close(res);
        }, function (err) {
          return fail(err.message || 'Login failed.', err.status === 403 ? id : pw);
        });
      }
      okBtn.addEventListener('click', ok);
      // The window cannot be used without a login: Esc / X do nothing.
      dlg.querySelector('.dlg-x').disabled = true;
      return { cancelValue: undefined, onEnter: ok, noCancel: true };
    });
  }

  /* ================= tab strip + pages (MainForm / TabStrip) ================= */
  /* ================= NFC card info popup (tabs without their own card handler) ================= */
  var NO_PHOTO = 'tabs/human.png';
  var cardDialogClose = null;   // close() of the open card popup: a new tap replaces it
  function showCardInfo(api, uid) {
    var U = String(uid || '').trim().toUpperCase();
    if (cardDialogClose) cardDialogClose();
    return api.request('GET', '/api/office/people?uid=' + encodeURIComponent(U)).then(function (res) {
      var people = (res && res.people) || [];
      if (!people.length) return warn('This NFC card is not registered.\nUID: ' + U);
      var p = people[0];
      function row(k, v) { return '<tr><th>' + k + '</th><td>' + escapeHtml(v == null || v === '' ? '-' : v) + '</td></tr>'; }
      var html = '<div class="dlg-title">NFC CARD<button class="dlg-x" tabindex="-1">' + X_SVG + '</button></div>' +
        '<div class="cdlg-body">' +
        '<img class="cdlg-photo" alt="" src="' + escapeHtml(p.photoUrl || NO_PHOTO) + '">' +
        '<table class="cdlg-info">' +
        row('UID', p.uid) + row('Student ID', p.studentId) + row('Name', p.name) +
        row('Campus', p.campus) + row('Age / Gender', [p.age, p.gender].filter(function (x) { return x != null && x !== ''; }).join(' / ')) +
        row('Period', (p.startDate || '-') + ' ~ ' + (p.endDate || '-')) +
        '<tr class="bal"><th>Balance</th><td>' + money(toCents(p.totalMoney)) + ' PHP</td></tr>' +
        '</table></div>' +
        (people.length > 1 ? '<div class="cdlg-note">' + people.length + ' students use this UID.</div>' : '') +
        '<div class="mb-foot"><button class="w10btn def" data-v="OK" data-autofocus>OK</button></div>';
      return openDialog(html, function (dlg, close) {
        cardDialogClose = function () { cardDialogClose = null; close(); };
        var img = dlg.querySelector('.cdlg-photo');
        img.addEventListener('error', function () { if (img.getAttribute('src') !== NO_PHOTO) img.setAttribute('src', NO_PHOTO); });
        dlg.querySelector('[data-v]').addEventListener('click', function () { close(); });
        return {};
      }).then(function () { cardDialogClose = null; });
    }, function (err) {
      return messageBox('Card lookup failed.\n' + (err && err.message ? err.message : err), 'SMEAG', 'OK', 'error');
    });
  }

  function buildTabs(onSelect) {
    var strip = el('tabstrip');
    TAB_NAMES.forEach(function (name, i) {
      var t = document.createElement('div');
      t.className = 'tab' + (i === OFFICE_MENU_INDEX ? ' sel' : '');
      t.style.left = (3 + i * 125) + 'px';
      var label = document.createElement('span');
      label.className = 'tab-text';
      label.textContent = name;
      t.appendChild(label);
      t.addEventListener('click', function () {
        if (t.classList.contains('sel')) return;
        strip.querySelectorAll('.tab').forEach(function (x) { x.classList.remove('sel'); });
        t.classList.add('sel');
        onSelect(i);
      });
      strip.appendChild(t);
    });
    // Fallback fonts (no Segoe UI on macOS/Linux) are wider: squeeze any label that would overflow its 125px tab.
    strip.querySelectorAll('.tab-text').forEach(function (s) {
      var w = s.getBoundingClientRect().width / (currentScale() || 1);
      if (w > 117) s.style.transform = 'scaleX(' + (117 / w).toFixed(3) + ')';
    });
  }

  function currentScale() {
    var m = /scale\(([\d.]+)\)/.exec(el('win').style.transform || '');
    return m ? parseFloat(m[1]) : 1;
  }

  // Other tabs register themselves from tabs/*.js:
  //   window.OfficeTabs['INFORMATION'] = { mount: function (root, ctx) {...}, show: function () {...} }
  // mount() runs once with an empty 1706x880 page div; show() (optional) runs every time the tab is opened.
  // mount() may return { onNfc: function (uid) {...} }: called when a card is tapped while that tab is open.
  // Tabs without onNfc show the card owner in a popup (showCardInfo).
  var tabCtx = null;      // set in start(): { api, messageBox, warn, inputDialog, escapeHtml, showCardInfo }
  var tabPages = {};
  var currentTab = TAB_NAMES[OFFICE_MENU_INDEX];
  function showPage(index) {
    var office = el('officePage'), ph = el('placeholder');
    Object.keys(tabPages).forEach(function (k) { tabPages[k].root.hidden = true; });
    office.hidden = index !== OFFICE_MENU_INDEX;
    ph.hidden = true;
    currentTab = TAB_NAMES[index];
    if (index === OFFICE_MENU_INDEX) return;
    var name = TAB_NAMES[index];
    var impl = window.OfficeTabs && window.OfficeTabs[name];
    if (!impl) {
      ph.hidden = false;
      ph.textContent = name + '\n(not implemented)';
      return;
    }
    var page = tabPages[name];
    if (!page) {
      var root = document.createElement('div');
      root.className = 'page tab-page';
      root.setAttribute('data-tab', name);
      el('content').appendChild(root);
      page = tabPages[name] = { root: root, impl: impl };
      var hooks = impl.mount(root, tabCtx);
      page.onNfc = hooks && typeof hooks.onNfc === 'function' ? hooks.onNfc : null;
    }
    page.root.hidden = false;
    if (impl.show) impl.show();
  }

  /* ================= OFFICE MENU page (OfficeMenuPage.cs) ================= */
  function createOfficeMenu(api) {
    var lines = [];
    var student = null;      // { uid, name, campus, balance (cents) }
    var currentIndex = -1;   // grid CurrentRow
    var itemsCache = [];
    var menus = [];          // office_menus rows for the staff campus
    var categories = [];     // distinct mMenu, in id order
    var lookupSeq = 0;
    var saving = false;

    var txtUid = el('txtUid'), lblName = el('lblName'), lblCampus = el('lblCampus'), lblBalance = el('lblBalance');
    var cboCategory = el('cboCategory'), cboItem = el('cboItem'), txtPrice = el('txtPrice'), numQty = el('numQty');
    var gridBody = el('gridBody'), lblNet = el('lblNet');

    // EXCEPTION lines are recorded but do not change the balance (production: transaction_type 'exception').
    function balanceEffect(l) { return l.type === 'EXCEPTION' ? 0 : l.amount; }
    function netChange() { return lines.reduce(function (a, l) { return a + balanceEffect(l); }, 0); }

    /* ---- student ---- */
    function loadStudent(uid) {
      uid = String(uid).trim().toUpperCase();
      txtUid.value = uid;
      var seq = ++lookupSeq;
      if (uid.length === 0) {
        student = null; lines = [];
        updateStudentLabels(); refreshGrid(false);
        return Promise.resolve();
      }
      return api.personByUid(uid).then(function (res) {
        if (seq !== lookupSeq) return;
        var p = res && res.person;
        if (!p) {
          student = null; lines = [];
          updateStudentLabels(); refreshGrid(false);
          return warn('Student not found: ' + uid);
        }
        var found = { uid: p.uid, name: p.name, campus: p.campus, balance: toCents(p.totalMoney) };
        if (!student || student.uid.toUpperCase() !== found.uid.toUpperCase()) lines = [];
        student = found;
        updateStudentLabels(); refreshGrid(false);
      }, function (err) {
        if (seq !== lookupSeq) return;
        return messageBox(err.message, 'SMEAG', 'OK', 'error');
      });
    }

    function updateStudentLabels() {
      if (!student) {
        lblName.textContent = 'Name: ';
        lblCampus.textContent = 'Campus: ';
        lblBalance.textContent = 'Balance: ' + money(0) + ' PHP';
        return;
      }
      lblName.textContent = 'Name: ' + student.name;
      lblCampus.textContent = 'Campus: ' + student.campus;
      lblBalance.textContent = 'Balance: ' + money(student.balance) + ' PHP';
    }

    /* ---- category / item / price ---- */
    function fillSelect(sel, list) {
      sel.innerHTML = '';
      var blank = document.createElement('option');
      blank.value = ''; blank.textContent = ''; blank.hidden = true;
      sel.appendChild(blank);
      list.forEach(function (x) {
        var o = document.createElement('option');
        o.value = String(x.id); o.textContent = x.name;
        sel.appendChild(o);
      });
      sel.value = '';
    }
    function selectedCategory() {
      var i = parseInt(cboCategory.value, 10);
      return isNaN(i) ? null : (categories[i] || null);
    }
    function selectedItem() {
      var id = parseInt(cboItem.value, 10);
      return itemsCache.filter(function (i) { return i.id === id; })[0] || null;
    }
    function loadCategories() {
      fillSelect(cboCategory, categories.map(function (c, i) { return { id: i, name: c }; }));
      itemsCache = [];
      fillSelect(cboItem, []);
    }
    function loadMenus(campus) {
      return api.menus(campus).then(function (res) {
        menus = ((res && res.menus) || []).slice().sort(function (a, b) { return a.id - b.id; });
        categories = [];
        menus.forEach(function (m) { if (categories.indexOf(m.mMenu) < 0) categories.push(m.mMenu); });
        loadCategories();
        txtPrice.value = '0.00';
      }, function (err) {
        return messageBox('Cannot load office menus.\n\n' + err.message, 'SMEAG', 'OK', 'error');
      });
    }
    function onCategoryChanged() {
      var cat = selectedCategory();
      itemsCache = cat === null ? [] : menus.filter(function (m) { return m.mMenu === cat; })
        .map(function (m) { return { id: m.id, name: m.sMenu, price: toCents(m.payment) }; });
      fillSelect(cboItem, itemsCache);
      txtPrice.value = '0.00';
    }
    function onItemChanged() {
      var it = selectedItem();
      txtPrice.value = it ? money(it.price) : '0.00';
    }

    cboCategory.addEventListener('change', onCategoryChanged);
    cboItem.addEventListener('change', onItemChanged);

    // Price: digits, control keys and a single '.' only
    txtPrice.addEventListener('keydown', function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.length !== 1) return;              // control keys
      if (/[0-9]/.test(e.key)) return;
      if (e.key === '.' && txtPrice.value.indexOf('.') < 0) return;
      e.preventDefault();
    });
    txtPrice.addEventListener('input', function () { // paste guard
      var v = txtPrice.value.replace(/[^0-9.,]/g, '');
      var i = v.indexOf('.');
      if (i >= 0) v = v.slice(0, i + 1) + v.slice(i + 1).replace(/\./g, '');
      if (v !== txtPrice.value) txtPrice.value = v;
    });
    txtPrice.addEventListener('blur', function () {
      var c = parsePriceCents(txtPrice.value);
      txtPrice.value = money(c === null ? 0 : c);
    });
    txtPrice.addEventListener('focus', function () { setTimeout(function () { txtPrice.select(); }, 0); });

    // Qty NumericUpDown 1..999
    function getQty() {
      var n = parseInt(numQty.value, 10);
      if (isNaN(n)) n = 1;
      return Math.min(999, Math.max(1, n));
    }
    function setQty(n) { numQty.value = String(Math.min(999, Math.max(1, n))); }
    numQty.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowUp') { e.preventDefault(); setQty(getQty() + 1); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setQty(getQty() - 1); return; }
      if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
      if (!/[0-9]/.test(e.key)) e.preventDefault();
    });
    numQty.addEventListener('blur', function () { setQty(getQty()); });
    numQty.addEventListener('wheel', function (e) {
      if (document.activeElement !== numQty) return;
      e.preventDefault(); setQty(getQty() + (e.deltaY < 0 ? 1 : -1));
    }, { passive: false });
    function repeatable(btn, delta) {
      var t1 = null, t2 = null;
      function stop() { clearTimeout(t1); clearInterval(t2); t1 = t2 = null; }
      btn.addEventListener('mousedown', function (e) {
        e.preventDefault();
        setQty(getQty() + delta);
        t1 = setTimeout(function () { t2 = setInterval(function () { setQty(getQty() + delta); }, 50); }, 400);
      });
      btn.addEventListener('mouseup', stop);
      btn.addEventListener('mouseleave', stop);
    }
    repeatable(el('qtyUp'), 1);
    repeatable(el('qtyDown'), -1);

    /* ---- add / remove ---- */
    function addLine(type) {
      if (!student) { warn('Please scan/enter UID first.').then(function () { txtUid.focus(); }); return; }
      var cat = selectedCategory(), item = selectedItem();
      if (cat === null || !item) { warn('Please select CATEGORY and ITEM.'); return; }
      var price = parsePriceCents(txtPrice.value);
      if (price === null || price <= 0) { warn('Invalid price.').then(function () { txtPrice.focus(); }); return; }

      var qty = getQty();
      var amount = price * qty * (type === 'INCREASE' ? 1 : -1);

      if (type === 'DECREASE' && student.balance + netChange() + amount < 0) { warn('Insufficient balance.'); return; }

      var p = type === 'EXCEPTION' ? inputDialog('! EXCEPTION', 'Reason for exception:') : Promise.resolve(undefined);
      p.then(function (memo) {
        if (type === 'EXCEPTION' && memo === null) return;   // cancelled
        lines.push({ type: type, mainMenu: cat, subMenu: item.name, unitPrice: price, qty: qty, amount: amount, memo: memo || null, afterBalance: 0 });
        refreshGrid(true);
        setQty(1);
      });
    }

    function removeSelected() {
      if (currentIndex < 0 || currentIndex >= lines.length) { warn('Select an item to remove.'); return; }
      lines.splice(currentIndex, 1);
      refreshGrid(true);
    }

    /* ---- grid ---- */
    function refreshGrid(selectLast) {
      var running = student ? student.balance : 0;
      var html = '';
      lines.forEach(function (l, i) {
        running += balanceEffect(l);
        l.afterBalance = running;
        var sign = l.amount >= 0 ? '+' : '-';
        var tip = l.memo ? ' title="' + escapeHtml('Reason: ' + l.memo) + '"' : '';
        html += '<tr data-i="' + i + '" class="t-' + l.type.toLowerCase() + '"' + tip + '>' +
          '<td class="rh"></td>' +
          '<td>' + l.type + '</td>' +
          '<td>' + escapeHtml(l.mainMenu) + '</td>' +
          '<td>' + escapeHtml(l.subMenu) + '</td>' +
          '<td class="r">' + sign + money(l.unitPrice) + '</td>' +
          '<td class="c">' + l.qty + '</td>' +
          '<td class="r">' + money(running) + '</td></tr>';
      });
      gridBody.innerHTML = html;
      currentIndex = -1;
      if (selectLast && lines.length > 0) {
        setCurrent(lines.length - 1);
        var last = gridBody.lastElementChild;
        if (last && last.scrollIntoView) last.scrollIntoView({ block: 'nearest' });
      }
      updateTotals();
    }

    function setCurrent(i) {
      currentIndex = i;
      Array.prototype.forEach.call(gridBody.children, function (tr, k) {
        tr.classList.toggle('sel', k === i);
        tr.classList.toggle('cur', k === i);
      });
    }
    gridBody.addEventListener('mousedown', function (e) {
      var tr = e.target.closest('tr');
      if (tr) setCurrent(parseInt(tr.getAttribute('data-i'), 10));
    });
    el('grid').tabIndex = 0;
    el('grid').addEventListener('keydown', function (e) {
      if (!lines.length) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); setCurrent(Math.min(lines.length - 1, currentIndex + 1)); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setCurrent(Math.max(0, currentIndex - 1)); }
    });

    function updateTotals() {
      lblNet.textContent = 'NET CHANGE: ' + signedMoney(netChange()) + ' PHP';
    }

    /* ---- confirm / reset ---- */
    function setSaving(on) {
      saving = on;
      ['btnConfirm', 'btnDefault', 'btnIncrease', 'btnDecrease', 'btnException', 'btnRemove'].forEach(function (id) { el(id).disabled = on; });
      txtUid.readOnly = on;
    }

    function confirmTransaction() {
      if (saving) return;
      if (!student) { warn('Please scan/enter UID first.'); return; }
      if (lines.length === 0) { warn('No items to confirm.'); return; }
      var net = signedMoney(netChange());
      setSaving(true);
      messageBox('Confirm transaction?\n\nName: ' + student.name + '\nNet change: ' + net + ' PHP',
        'CONFIRM TRANSACTION', 'YesNo', 'question').then(function (answer) {
        if (answer !== 'Yes') { setSaving(false); return; }
        var uid = student.uid;
        var payload = lines.map(function (l) {
          return { type: l.type, mMenu: l.mainMenu, sMenu: l.subMenu, unitPrice: l.unitPrice / 100, qty: l.qty };
        });
        return api.saveTransaction(uid, payload).then(function (res) {
          var txn = res.transaction;
          if (student && student.uid === uid) student.balance = toCents(txn.balanceAfter);
          updateStudentLabels();
          resetForm();
          setSaving(false);
          return messageBox('Transaction completed.\n\nNo. ' + txn.id + '\nBalance: ' + money(toCents(txn.balanceAfter)) + ' PHP', 'SMEAG', 'OK', 'info');
        }, function (ex) {
          setSaving(false);
          return messageBox('Transaction failed.\n\n' + ex.message, 'SMEAG', 'OK', 'error');
        });
      });
    }

    function resetForm() {
      lines = [];
      cboCategory.value = '';
      itemsCache = [];
      fillSelect(cboItem, []);
      txtPrice.value = '0.00';
      setQty(1);
      refreshGrid(false);
    }

    txtUid.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      loadStudent(txtUid.value);
    });
    txtUid.addEventListener('input', function () {
      var pos = txtUid.selectionStart;
      txtUid.value = txtUid.value.toUpperCase();
      try { txtUid.setSelectionRange(pos, pos); } catch (e) { /* ignore */ }
    });

    el('btnIncrease').addEventListener('click', function () { addLine('INCREASE'); });
    el('btnDecrease').addEventListener('click', function () { addLine('DECREASE'); });
    el('btnException').addEventListener('click', function () { addLine('EXCEPTION'); });
    el('btnRemove').addEventListener('click', removeSelected);
    el('btnConfirm').addEventListener('click', confirmTransaction);
    el('btnDefault').addEventListener('click', resetForm);

    loadCategories();
    updateStudentLabels();
    updateTotals();

    return { loadStudent: loadStudent, loadMenus: loadMenus, focusUid: function () { txtUid.focus(); } };
  }

  /* ================= fit-to-width scaling ================= */
  function fit() {
    var win = el('win'), stage = el('stage');
    var vw = document.documentElement.clientWidth || window.innerWidth;
    var scale = Math.min(1, vw / WIN_W);
    var left = Math.max(0, Math.floor((vw - WIN_W * scale) / 2));
    win.style.transform = 'scale(' + scale + ')';
    win.style.left = left + 'px';
    stage.style.height = Math.ceil(WIN_H * scale) + 'px';
  }

  /* ================= NFC: one reader for every tab ================= */
  // ../src/nfcService.js (window.PusanNfc) handles a USB/Bluetooth keyboard-mode reader on any tab
  // (even when no UID box has focus) and, on Android, the phone's NFC (native bridge / Web NFC).
  // Each tap goes to the open tab: its onNfc() hook, the OFFICE MENU student lookup, or the card popup.
  function wireNfc(api, officePage) {
    var N = window.PusanNfc;
    if (!N) return;
    var layer = el('modalLayer');
    function loggedIn() { var s = api.session(); return !!(s && s.token); }
    // Not while a dialog (login, confirm, ...) is open, except the card popup itself: a new tap replaces it.
    function canTap() { return loggedIn() && (layer.hidden || (!!cardDialogClose && layer.children.length === 1)); }
    N.enableKeyboardReader(canTap);
    N.listenForNfc(function (d) {
      if (!canTap()) return;
      if (cardDialogClose) cardDialogClose();
      var uid = String(d.uid || '').toUpperCase();
      if (!uid) return;
      if (currentTab === TAB_NAMES[OFFICE_MENU_INDEX]) {
        if (!el('txtUid').readOnly) officePage.loadStudent(uid);   // readOnly while a transaction is saving
        return;
      }
      var page = tabPages[currentTab];
      if (page && page.onNfc) page.onNfc(uid);
      else showCardInfo(api, uid);
    });
    window.addEventListener('nfc-error', function (e) {
      if (canTap()) warn((e.detail && e.detail.message) || 'Could not read the card. Please tap it again.');
    });
    // ACR122U (PC/SC) through desktop-bridge: status shown in the title bar.
    if (N.connectPcReader) {
      var status = document.createElement('span');
      status.className = 'tb-nfc';
      document.querySelector('.titlebar').appendChild(status);
      var setStatus = function (on) {
        status.classList.toggle('on', on);
        status.textContent = on ? '● Card reader connected' : '○ Card reader not connected';
        status.title = on ? 'ACR122U bridge (127.0.0.1:47321)' : 'Start the card reader bridge (desktop-bridge) on this PC';
      };
      setStatus(false);
      N.connectPcReader(setStatus);
    }
    // Phone NFC needs a user gesture to start: begin scanning on the first click/tap after load.
    var support = N.phoneNfcSupport();
    if (support === 'android-native' || support === 'web-nfc') {
      var startPhone = function () {
        document.removeEventListener('pointerdown', startPhone, true);
        N.startNfcScan().catch(function (e) { warn(e && e.message ? e.message : 'NFC is not available.'); });
      };
      document.addEventListener('pointerdown', startPhone, true);
    }
  }

  /* ================= startup ================= */
  function start() {
    var api = createApi();
    tabCtx = {
      api: api, messageBox: messageBox, warn: warn, inputDialog: inputDialog, escapeHtml: escapeHtml,
      showCardInfo: function (uid) { return showCardInfo(api, uid); }
    };
    drawLogo();
    buildTabs(showPage);
    var page = createOfficeMenu(api);
    wireNfc(api, page);
    showPage(OFFICE_MENU_INDEX);
    fit();
    window.addEventListener('resize', fit);

    var titleEl = document.querySelector('.tb-title');
    var baseTitle = titleEl.textContent;
    var pendingLogin = null;
    function applySession(s) {
      var who = s && s.manager ? s.manager.login_id : '';
      titleEl.textContent = who ? baseTitle + ' - ' + who : baseTitle;
      titleEl.title = s && s.manager ? (s.manager.name + ' / ' + s.manager.position + ' / ' + s.manager.campus) : '';
      document.title = titleEl.textContent;
    }
    function login() {
      if (pendingLogin) return pendingLogin;
      applySession(null);
      pendingLogin = loginDialog(api).then(function (res) {
        api.setSession({ token: res.token, manager: res.manager });
        applySession(api.session());
        pendingLogin = null;
        return page.loadMenus(res.manager.campus);
      });
      return pendingLogin;
    }
    api.setUnauthorizedHandler(login);

    // Layout preview for development: ?preview=1 on a localhost page skips the login and all API calls.
    var isLocal = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
    if (isLocal && /[?&]preview=1\b/.test(location.search)) {
      titleEl.textContent = baseTitle + ' - preview';
      tabCtx.preview = true;
      var m = /[?&]tab=([^&]+)/.exec(location.search);
      var want = m ? decodeURIComponent(m[1]).toUpperCase() : '';
      var idx = TAB_NAMES.map(function (n) { return n.toUpperCase(); }).indexOf(want);
      if (idx >= 0) document.querySelectorAll('#tabstrip .tab')[idx].click();
      return;
    }

    var s = api.session();
    var ready = s && s.token && s.manager ? (applySession(s), page.loadMenus(s.manager.campus)) : login();
    Promise.resolve(ready).then(function () { page.focusUid(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
