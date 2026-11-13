/* RECHARGE/CASHOUT tab — registers window.OfficeTabs['RECHARGE/CASHOUT'] (see showPage() in office.js).
   Port of the WinForms RechargeCashOutControl.cs: GET /api/office/bank-categories (category combos) and
   GET /api/office/recharge-cashout (SEARCH -> recharge / cash-out grids), DOWNLOAD PDF -> OfficeKit.printDoc. */
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

  var CAMPUSES = ['CAPITAL', 'ENCANTO', 'TARLAC', 'BAYDREAM'];

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function isoDate(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function stamp(d) { return isoDate(d) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); }

  // FormatGrid(): same columns / header texts as the original DataTable binding
  var COLUMNS = [
    { key: 'uid', header: 'UID', width: 160 },
    { key: 'name', header: 'NAME', width: 180 },
    { key: 'campus', header: 'CAMPUS', width: 120 },
    { key: 'beforeAmount', header: 'BEFORE AMOUNT', width: 150, align: 'right', format: 'money' },
    { key: 'category', header: 'CATEGORY', width: 170 },
    { key: 'type', header: 'TYPE', width: 110 },
    { key: 'payment', header: 'PAYMENT', width: 140, align: 'right', format: 'money' },
    { key: 'totalMoney', header: 'TOTALMONEY', width: 150, align: 'right', format: 'money' },
    { key: 'date', header: 'TRANSACTION DATE', width: 190 },
    { key: 'source', header: 'SOURCE', width: 210 }
  ];

  window.OfficeTabs = window.OfficeTabs || {};
  window.OfficeTabs['RECHARGE/CASHOUT'] = {
    mount: function (root, ctx) {
      var k = kit(makePage(root));
      var today = new Date();
      var weekAgo = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 7);

      /* ---- pnlFilters (Dock Top, 120, white) ---- */
      k.box('g3-top', 0, 0, 1698, 120);
      wlbl(k, 'Campus:', 20, 23);
      var cbCampus = k.combo(85, 20, 150, 25, CAMPUSES, 'CAPITAL');
      wlbl(k, 'Start Date:', 260, 23);
      var dtpStart = k.dtp(340, 20, 120, 25, weekAgo);
      wlbl(k, 'End Date:', 480, 23);
      var dtpEnd = k.dtp(555, 20, 120, 25, today);
      wlbl(k, 'Recharge Category:', 20, 68);
      var cbRecharge = k.combo(160, 65, 150, 25, ['All'], 'All');
      wlbl(k, 'CashOut Category:', 340, 68);
      var cbCashOut = k.combo(475, 65, 150, 25, ['All'], 'All');
      var btnSearch = k.btn('SEARCH', 710, 40, 120, 45, '#007ACC');

      /* ---- lblMainTitle (Dock Top, 60) ---- */
      var band = k.box('g3-band', 0, 120, 1698, 60);
      band.textContent = 'RECHARGE / CASH OUT REPORT';
      band.style.lineHeight = '60px';
      band.style.fontSize = '22.67px';

      /* ---- pnlContent (Fill, padding 20) ---- */
      k.lbl('RECHARGE LIST', 24, 211, 'b navy').style.fontSize = '14.67px';
      var gRecharge = OfficeKit.grid(k.box('g3-white g3-rc-grid', 20, 230, 1658, 330), { columns: COLUMNS, select: 'row', rowHeight: 30, font: '12px' });
      k.lbl('CASH OUT LIST', 24, 591, 'b maroon').style.fontSize = '14.67px';
      var gCashOut = OfficeKit.grid(k.box('g3-white g3-rc-grid', 20, 610, 1658, 175), { columns: COLUMNS, select: 'row', rowHeight: 30, font: '12px' });

      /* ---- pnlBottom (Dock Bottom, 70) ---- */
      k.box('g3-bar', 0, 805, 1698, 70);
      var dl = k.btn('DOWNLOAD PDF', 20, 820, 180, 40, '#219653');
      dl.style.fontSize = '14.67px';

      /* LoadCategories(): DISTINCT bank categories split by transaction type (errors ignored, like the original) */
      function fill(sel, list) {
        var keep = sel.value;
        sel.innerHTML = '';
        ['All'].concat(list || []).forEach(function (c) {
          var o = document.createElement('option');
          o.value = c; o.textContent = c;
          sel.appendChild(o);
        });
        sel.value = (list || []).indexOf(keep) >= 0 ? keep : 'All';
      }
      ctx.api.request('GET', '/api/office/bank-categories').then(function (res) {
        fill(cbRecharge, res.increase);
        fill(cbCashOut, res.decrease);
      }, function () { /* ignore errors during init */ });

      var searched = null;   // filters of the last SEARCH (for the PDF header)

      function search() {
        var from = isoDate(dtpStart.value()), to = isoDate(dtpEnd.value());
        var f = { campus: cbCampus.value, from: from, to: to, rc: cbRecharge.value, co: cbCashOut.value };
        var path = '/api/office/recharge-cashout?campus=' + encodeURIComponent(f.campus) + '&from=' + from + '&to=' + to +
          '&rechargeCategory=' + encodeURIComponent(f.rc) + '&cashoutCategory=' + encodeURIComponent(f.co);
        return OfficeKit.busy(btnSearch, ctx.api.request('GET', path)).then(function (res) {
          searched = f;
          gRecharge.setRows(res.recharge || []);
          gCashOut.setRows(res.cashout || []);
          if (res.truncated) ctx.messageBox('Too many transactions: only the first rows are shown. Please narrow the date range.', 'SMEAG', 'OK', 'warning');
        }).catch(OfficeKit.fail(ctx, 'Error searching'));
      }

      /* BtnDownloadPdf_Click: A4 landscape, title / period / campus, RECHARGE LIST (blue) + CASH OUT LIST (red) */
      function downloadPdf() {
        if (!gRecharge.count() && !gCashOut.count()) return ctx.messageBox('No data to export.', 'SMEAG', 'OK', 'info');
        var esc = OfficeKit.esc, now = new Date(), f = searched;
        function cell(c, r) {
          var v = r[c.key];
          if (c.format === 'money') return OfficeKit.money(v);
          if (c.key === 'date') return String(v || '').slice(0, 16);   // yyyy-MM-dd HH:mm
          return v == null ? '' : String(v);
        }
        function table(rows, cls) {
          return '<table class="lst ' + cls + '"><thead><tr>' + COLUMNS.map(function (c) { return '<th>' + esc(c.header) + '</th>'; }).join('') +
            '</tr></thead><tbody>' + rows.map(function (r) {
              return '<tr>' + COLUMNS.map(function (c) { return '<td>' + esc(cell(c, r)) + '</td>'; }).join('') + '</tr>';
            }).join('') + '</tbody></table>';
        }
        var html =
          '<table class="hd"><tr><td><div class="ttl">RECHARGE / CASH OUT REPORT</div>' +
          '<div class="m10">Period: ' + esc(isoDate(dtpStart.value())) + ' ~ ' + esc(isoDate(dtpEnd.value())) + '</div>' +
          '<div class="m10">Campus: ' + esc(cbCampus.value) + '</div></td>' +
          '<td class="r"><div class="m9">Generated: ' + esc(stamp(now)) + '</div></td></tr></table>' +
          '<div class="sec blue">RECHARGE LIST (Category: ' + esc(f ? f.rc : cbRecharge.value) + ')</div>' + table(gRecharge.rows(), 'blue') +
          '<div class="sec red" style="margin-top:15pt">CASH OUT LIST (Category: ' + esc(f ? f.co : cbCashOut.value) + ')</div>' + table(gCashOut.rows(), 'red');
        var css =
          '@page{margin:1cm;@bottom-center{content:"Page " counter(page);font:7pt "Segoe UI",Arial,sans-serif;}}' +
          'body{font-size:7pt;font-family:"Segoe UI",Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact;}' +
          'table.hd{width:100%;border-collapse:collapse;margin-bottom:10pt;} table.hd td{vertical-align:top;padding:0;} table.hd td.r{text-align:right;}' +
          '.ttl{font-size:18pt;font-weight:600;color:#2196F3;} .m10{font-size:10pt;} .m9{font-size:9pt;}' +
          '.sec{font-size:12pt;font-weight:600;margin-bottom:5pt;} .sec.blue{color:#2196F3;} .sec.red{color:#F44336;}' +
          'table.lst{width:100%;border-collapse:collapse;table-layout:fixed;} table.lst th{color:#FFF;font-weight:600;padding:2pt;text-align:center;overflow-wrap:anywhere;}' +
          'table.lst.blue th{background:#2196F3;} table.lst.red th{background:#F44336;}' +
          'table.lst td{border-bottom:1px solid #EEE;padding:2pt;text-align:center;overflow-wrap:anywhere;} table.lst tr{page-break-inside:avoid;}';
        OfficeKit.printDoc('Recharge_CashOut_' + stamp(now).replace(/[-:]/g, '').replace(' ', '_'), html, { landscape: true, css: css });
      }

      btnSearch.addEventListener('click', search);
      dl.addEventListener('click', downloadPdf);
    },
    show: function () {}
  };
})();
