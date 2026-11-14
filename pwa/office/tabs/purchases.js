/* PURCHASES tab — registers window.OfficeTabs['PURCHASES'] (see showPage() in office.js).
   Store purchase history of every campus cafe / mart (and Pusan Mart) as receipts with their item lines.
   API: GET /api/purchases?from&to&campus&store&search -> {receipts, summary, truncated, campuses}.
   An Admin sees every campus; a campus Admin / Manager only its own campus. Tapping a card fills the search box. */
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

  var CAMPUSES = ['All', 'Capital', 'Encanto', 'Tarlac', 'Pusan Mart'];
  var STORES = ['All', 'Cafe', 'Mart'];

  var RECEIPT_COLS = [
    { key: 'date', header: 'DATE (PH)', width: 140 },
    { key: 'campus', header: 'CAMPUS', width: 85 },
    { key: 'storeName', header: 'STORE', width: 115 },
    { key: 'studentId', header: 'STUDENT ID', width: 100 },
    { key: 'name', header: 'NAME', width: 175 },
    { key: 'itemsText', header: 'ITEMS', width: 225 },
    { key: 'itemCount', header: 'QTY', width: 45, align: 'right', format: 'int' },
    { key: 'total', header: 'TOTAL', width: 90, align: 'right', format: 'money' },
    { key: 'balanceAfter', header: 'BALANCE', width: 95, align: 'right', format: 'money' },
    { key: 'discount', header: 'DISCOUNT', width: 85 }
  ];
  var ITEM_COLS = [
    { key: 'name', header: 'ITEM', width: 200 },
    { key: 'quantity', header: 'QTY', width: 50, align: 'right', format: 'int' },
    { key: 'unitPrice', header: 'PRICE', width: 80, align: 'right', format: 'money' },
    { key: 'amount', header: 'AMOUNT', width: 90, align: 'right', format: 'money' }
  ];
  var CSV_COLS = [
    { key: 'date', header: 'DATE (PH)' }, { key: 'campus', header: 'CAMPUS' }, { key: 'storeName', header: 'STORE' },
    { key: 'studentId', header: 'STUDENT ID' }, { key: 'name', header: 'NAME' }, { key: 'item', header: 'ITEM' },
    { key: 'quantity', header: 'QTY', format: 'int' }, { key: 'unitPrice', header: 'PRICE', format: 'money' },
    { key: 'amount', header: 'AMOUNT', format: 'money' }, { key: 'total', header: 'RECEIPT TOTAL', format: 'money' },
    { key: 'balanceAfter', header: 'BALANCE AFTER', format: 'money' }, { key: 'discount', header: 'DISCOUNT' },
    { key: 'source', header: 'SOURCE' }
  ];

  function itemsText(r) {
    if (!r.items.length) return '(total only)';
    return r.items.map(function (i) { return i.name + (i.quantity > 1 ? ' x' + i.quantity : ''); }).join(', ');
  }

  window.OfficeTabs = window.OfficeTabs || {};
  window.OfficeTabs['PURCHASES'] = {
    mount: function (root, ctx) {
      var k = kit(makePage(root));
      var api = ctx.api;
      var today = new Date();
      var weekAgo = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6);

      /* ---- filters ---- */
      k.box('g3-top', 0, 0, 1698, 70);
      wlbl(k, 'Start Date:', 20, 23);
      var dtpStart = k.dtp(100, 20, 120, 25, weekAgo);
      wlbl(k, 'End Date:', 240, 23);
      var dtpEnd = k.dtp(315, 20, 120, 25, today);
      wlbl(k, 'Campus:', 455, 23);
      var cbCampus = k.combo(520, 20, 130, 25, CAMPUSES, 'All');
      wlbl(k, 'Store:', 670, 23);
      var cbStore = k.combo(720, 20, 100, 25, STORES, 'All');
      wlbl(k, 'Student:', 840, 23);
      var txtSearch = k.txt(910, 20, 220, 25, 'name / student ID / card UID');
      var btnSearch = k.btn('SEARCH', 1150, 15, 120, 40, '#007ACC');
      var btnCsv = k.btn('DOWNLOAD CSV', 1290, 15, 150, 40, '#2E7D32');

      /* ---- title band ---- */
      var band = k.box('g3-band', 0, 70, 1698, 60);
      band.textContent = 'STORE PURCHASE HISTORY';
      band.style.lineHeight = '60px';
      band.style.fontSize = '23px';

      var bar = k.box('g3-body', 0, 130, 1698, 36);
      var cnt = wlbl(k, 'Press SEARCH to load purchases (max 3 months at a time).', 20, 9, '', bar);
      cnt.style.color = '#696969';

      var gReceipts = OfficeKit.grid(k.box('g3-white a2-dark', 20, 166, 1225, 689), {
        rowHeader: true, columns: RECEIPT_COLS, emptyText: 'No purchases.',
        onCurrent: function (r) { showItems(r); }
      });
      var detailHead = k.box('g3-body', 1260, 166, 420, 96);
      detailHead.style.cssText += ';background:#F7F9FC;border:1px solid #B9C4D3;padding:8px 10px;font:13px/1.5 "Segoe UI",Tahoma,sans-serif;white-space:normal;overflow:hidden;';
      detailHead.textContent = 'Select a receipt to see its items.';
      var gItems = OfficeKit.grid(k.box('g3-white a2-dark', 1260, 270, 420, 585), {
        rowHeader: false, columns: ITEM_COLS, emptyText: 'No item lines (Pusan Mart payments record the total only).'
      });
      var receipts = [];

      function showItems(r) {
        if (!r) { detailHead.textContent = 'Select a receipt to see its items.'; gItems.setRows([]); return; }
        var esc = OfficeKit.esc;
        detailHead.innerHTML = '<b>' + esc(r.name || '') + '</b> ' + esc(r.studentId || '') + '<br>' +
          esc(r.date) + ' · ' + esc(r.campus) + ' · ' + esc(r.storeName) + '<br>' +
          'Total <b>' + OfficeKit.money(r.total) + '</b>' +
          (r.balanceBefore != null ? ' · Balance ' + OfficeKit.money(r.balanceBefore) + ' → ' + OfficeKit.money(r.balanceAfter) : '') +
          (r.discount ? ' · ' + esc(r.discount) : '');
        gItems.setRows(r.items);
      }

      function search() {
        var qs = 'from=' + OfficeKit.iso(dtpStart.value()) + '&to=' + OfficeKit.iso(dtpEnd.value());
        if (cbCampus.value !== 'All') qs += '&campus=' + encodeURIComponent(cbCampus.value);
        if (cbStore.value !== 'All') qs += '&store=' + cbStore.value.toLowerCase();
        if (txtSearch.value.trim()) qs += '&search=' + encodeURIComponent(txtSearch.value.trim());
        return OfficeKit.busy(btnSearch, api.request('GET', '/api/purchases?' + qs).then(function (res) {
          receipts = (res.receipts || []).map(function (r) { r.itemsText = itemsText(r); return r; });
          gReceipts.setRows(receipts);
          var s = res.summary || {};
          var stores = (s.byStore || []).map(function (x) { return x.store + ' ' + OfficeKit.money(x.total); }).join(' | ');
          cnt.textContent = receipts.length + ' receipt' + (receipts.length === 1 ? '' : 's') + ' · total ' + OfficeKit.money(s.total || 0) + (stores ? '   —   ' + stores : '');
          if (res.truncated) ctx.warn('Only part of the range could be loaded. Narrow the date range.');
        }).catch(OfficeKit.fail(ctx, 'Error loading purchases')));
      }
      btnSearch.addEventListener('click', search);
      txtSearch.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); search(); } });

      btnCsv.addEventListener('click', function () {
        if (!receipts.length) {
          ctx.messageBox('Press SEARCH first: the CSV contains the receipts shown (one line per item).', 'PURCHASES', 'OK', 'info');
          return;
        }
        var lines = [];
        receipts.forEach(function (r) {
          var base = { date: r.date, campus: r.campus, storeName: r.storeName, studentId: r.studentId, name: r.name,
            total: r.total, balanceAfter: r.balanceAfter, discount: r.discount, source: r.source };
          if (!r.items.length) lines.push(Object.assign({ item: '(total only)', amount: r.total }, base));
          r.items.forEach(function (i) {
            lines.push(Object.assign({ item: i.name, quantity: i.quantity, unitPrice: i.unitPrice, amount: i.amount }, base));
          });
        });
        OfficeKit.downloadCsv('purchases_' + OfficeKit.iso(dtpStart.value()) + '_' + OfficeKit.iso(dtpEnd.value()) + '.csv', CSV_COLS, lines);
      });

      // A tapped card: show that card's purchases for the chosen dates.
      return { onNfc: function (uid) { txtSearch.value = uid; search(); } };
    },
    show: function () {}
  };
})();
