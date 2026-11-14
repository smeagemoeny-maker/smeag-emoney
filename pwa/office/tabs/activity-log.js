/* LOG tab — registers window.OfficeTabs['LOG'] (see showPage() in office.js).
   Staff activity log: every API request made from the POS / Mart / Cafe / Office screens (who, when, what, result).
   API: GET /api/office/activity-log?from&to&loginId&action&writes=1 -> {rows, truncated}. Admin accounts only
   (a campus Admin sees only its own campus). DOWNLOAD CSV saves the rows shown as a log file. */
(function () {
  'use strict';

  /* ---- small WinForms control kit (same in every group-3 tab file) ---- */
  // All coordinates are relative to `base` (the 1698x875 WinForms UserControl area).
  function kit(base) {
    function px(v) { return typeof v === 'number' ? v + 'px' : v; }
    function place(node, x, y, w, h) {
      node.style.left = px(x); node.style.top = px(y);
      if (w != null) node.style.width = px(w);
      if (h != null) node.style.height = px(h);
      return node;
    }
    function make(tag, cls, parent) {
      var n = document.createElement(tag);
      if (cls) n.className = cls;
      (parent || base).appendChild(n);
      return n;
    }
    function box(cls, x, y, w, h, parent) { return place(make('div', cls + ' g3-abs', parent), x, y, w, h); }
    // label: x = text left, cy = vertical centre of the text
    function lbl(text, x, cy, cls, parent) {
      var n = place(make('span', 'g3-lbl g3-abs' + (cls ? ' ' + cls : ''), parent), x, cy - 10);
      n.textContent = text;
      return n;
    }
    function txt(x, y, w, h, placeholder, cls, parent) {
      var n = place(make('input', 'g3-txt g3-abs' + (cls ? ' ' + cls : ''), parent), x, y, w, h);
      n.type = 'text'; n.spellcheck = false; n.autocomplete = 'off';
      if (placeholder) n.placeholder = placeholder;
      return n;
    }
    function combo(x, y, w, h, options, value, parent) {
      var c = box('g3-combo', x, y, w, h, parent);
      var s = make('select', '', c);
      options.forEach(function (o) {
        var opt = document.createElement('option');
        opt.value = o; opt.textContent = o;
        s.appendChild(opt);
      });
      s.value = value != null ? value : options[0];
      make('span', 'g3-chev', c);
      return s;
    }
    function pad2(n) { return (n < 10 ? '0' : '') + n; }
    function fmt(d) { return (d.getMonth() + 1) + '/' + (d.getDate() < 10 ? ' ' : '') + d.getDate() + '/' + d.getFullYear(); }
    function parse(t) {
      var m = /^\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})\s*$/.exec(t);
      if (!m) return null;
      var d = new Date(+m[3], +m[1] - 1, +m[2]);
      return d.getMonth() === +m[1] - 1 && d.getDate() === +m[2] ? d : null;
    }
    var CAL_SVG = '<svg width="24" height="14" viewBox="0 0 24 14">' +
      '<rect x="0.5" y="1.5" width="10" height="11" fill="#E8E8E8" stroke="#6E6E6E"/>' +
      '<path d="M2 4h2v2H2zM5 4h2v2H5zM8 4h1.5v2H8zM2 7h2v2H2zM5 7h2v2H5zM8 7h1.5v2H8zM2 10h2v1.5H2zM5 10h2v1.5H5z" fill="#A8A8A8"/>' +
      '<path d="M13 6h7l-3.5 4z" fill="#404040"/></svg>';
    // DateTimePicker (Format = Short): typable "M/d/yyyy" text + calendar button backed by a native date input
    function dtp(x, y, w, h, date, parent) {
      var c = box('g3-dtp', x, y, w, h, parent);
      var t = make('input', 'g3-dtp-text', c);
      t.type = 'text'; t.spellcheck = false; t.autocomplete = 'off';
      var b = make('span', 'g3-dtp-btn', c);
      b.innerHTML = CAL_SVG;
      var nat = make('input', 'g3-dtp-native', c);
      nat.type = 'date'; nat.tabIndex = -1;
      var cur = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      var enabled = true;
      function set(d) {
        cur = d; t.value = fmt(d);
        nat.value = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
      }
      set(cur);
      t.addEventListener('blur', function () { var d = parse(t.value); set(d || cur); });
      t.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); t.blur(); } });
      nat.addEventListener('change', function () {
        var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(nat.value);
        if (m) set(new Date(+m[1], +m[2] - 1, +m[3]));
      });
      b.addEventListener('mousedown', function (e) {
        e.preventDefault();
        if (!enabled) return;
        try { if (nat.showPicker) { nat.showPicker(); return; } } catch (err) { /* fall through */ }
        nat.focus();
      });
      return {
        el: c,
        value: function () { return cur; },
        setValue: set,
        setEnabled: function (on) { enabled = !!on; c.classList.toggle('dis', !on); t.disabled = !on; }
      };
    }
    function chk(text, x, y, parent) {
      var l = place(make('label', 'g3-chk g3-abs', parent), x, y);
      var i = make('input', '', l);
      i.type = 'checkbox';
      l.appendChild(document.createTextNode(text));
      return i;
    }
    function btn(text, x, y, w, h, bg, cls, parent) {
      var n = place(make('button', 'g3-btn g3-abs' + (cls ? ' ' + cls : ''), parent), x, y, w, h);
      n.type = 'button'; n.textContent = text; n.style.background = bg;
      return n;
    }
    return { box: box, lbl: lbl, txt: txt, combo: combo, dtp: dtp, chk: chk, btn: btn };
  }

  // The WinForms UserControl sits in the tab content at (4,1), 1698 x 875.
  function makePage(root) {
    root.classList.add('g3');
    var page = document.createElement('div');
    page.className = 'g3-page';
    root.appendChild(page);
    return page;
  }
  // WinForms AutoSize Label at Location (x, y): glyphs start ~5px right and are centred ~10px below.
  function wlbl(k, text, x, y, cls, parent) { return k.lbl(text, x + 4, y + 10, cls, parent); }


  var COLUMNS = [
    { key: 'time', header: 'TIME (PH)', width: 150 },
    { key: 'loginId', header: 'LOGIN ID', width: 120 },
    { key: 'name', header: 'NAME', width: 120 },
    { key: 'position', header: 'POSITION', width: 85 },
    { key: 'campus', header: 'CAMPUS', width: 100 },
    { key: 'action', header: 'ACTION', width: 210 },
    { key: 'result', header: 'RESULT', width: 80 },
    { key: 'error', header: 'ERROR', width: 170 },
    { key: 'detail', header: 'DETAIL', width: 360 },
    { key: 'ip', header: 'IP', width: 115 },
    { key: 'device', header: 'DEVICE', width: 300 }
  ];

  window.OfficeTabs = window.OfficeTabs || {};
  window.OfficeTabs['LOG'] = {
    mount: function (root, ctx) {
      var k = kit(makePage(root));
      var today = new Date();
      var api = ctx.api;

      /* ---- filters (top 70, white) ---- */
      k.box('g3-top', 0, 0, 1698, 70);
      wlbl(k, 'Start Date:', 20, 23);
      var dtpStart = k.dtp(100, 20, 120, 25, today);
      wlbl(k, 'End Date:', 240, 23);
      var dtpEnd = k.dtp(315, 20, 120, 25, today);
      wlbl(k, 'Login ID:', 460, 23);
      var txtLogin = k.txt(530, 20, 140, 25, 'all staff');
      wlbl(k, 'Action:', 690, 23);
      var txtAction = k.txt(745, 20, 170, 25, 'e.g. checkout, delete');
      var chkWrites = k.chk('Changes only (no views)', 935, 24);
      var btnSearch = k.btn('SEARCH', 1150, 15, 120, 40, '#007ACC');
      var btnCsv = k.btn('DOWNLOAD CSV', 1290, 15, 150, 40, '#2E7D32');

      /* ---- title band ---- */
      var band = k.box('g3-band', 0, 70, 1698, 60);
      band.textContent = 'STAFF ACTIVITY LOG';
      band.style.lineHeight = '60px';
      band.style.fontSize = '23px';

      var bar = k.box('g3-body', 0, 130, 1698, 36);
      var cnt = wlbl(k, 'Press SEARCH to load the log.', 20, 9, '', bar);
      cnt.style.color = '#696969';

      var gridBox = k.box('g3-white a2-dark', 20, 166, 1658, 689);
      var grid = OfficeKit.grid(gridBox, { rowHeader: true, columns: COLUMNS });
      var rows = [];

      function search() {
        var qs = 'from=' + OfficeKit.iso(dtpStart.value()) + '&to=' + OfficeKit.iso(dtpEnd.value());
        if (txtLogin.value.trim()) qs += '&loginId=' + encodeURIComponent(txtLogin.value.trim());
        if (txtAction.value.trim()) qs += '&action=' + encodeURIComponent(txtAction.value.trim());
        if (chkWrites.checked) qs += '&writes=1';
        return OfficeKit.busy(btnSearch, api.request('GET', '/api/office/activity-log?' + qs).then(function (res) {
          rows = res.rows || [];
          grid.setRows(rows);
          var fails = rows.filter(function (r) { return r.result !== 'OK'; }).length;
          cnt.textContent = rows.length + ' entr' + (rows.length === 1 ? 'y' : 'ies') + (fails ? ', ' + fails + ' failed' : '');
          if (res.truncated) ctx.warn('Only the newest ' + rows.length + ' entries are shown. Narrow the date range to see the rest.');
        }).catch(OfficeKit.fail(ctx, 'Error loading the activity log')));
      }
      btnSearch.addEventListener('click', search);
      [txtLogin, txtAction].forEach(function (t) {
        t.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); search(); } });
      });

      btnCsv.addEventListener('click', function () {
        if (!rows.length) {
          ctx.messageBox('Press SEARCH first: the CSV contains the rows shown.', 'LOG', 'OK', 'info');
          return;
        }
        var name = 'activity-log_' + OfficeKit.iso(dtpStart.value()) + '_' + OfficeKit.iso(dtpEnd.value()) + '.csv';
        OfficeKit.downloadCsv(name, COLUMNS, rows);
      });
    },
    show: function () {}
  };
})();
