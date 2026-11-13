/* TransData tab — registers window.OfficeTabs['TransData'] (see showPage() in office.js).
   Port of TransDataControl.cs: SEARCH bank rows by date, tick rows, move them to beforebank.
   API: GET /api/office/transdata?from&to, POST /api/office/transdata {ids} -> {moved}. */
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

  window.OfficeTabs = window.OfficeTabs || {};
  window.OfficeTabs['TransData'] = {
    // No screenshot of this tab exists: layout follows TransDataControl.cs (Dock order: pnlFilters, title,
    // then the toolbar drawn over the top 36px of the Fill content panel, pnlBottom).
    mount: function (root, ctx) {
      var k = kit(makePage(root));
      var today = new Date();
      var weekAgo = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 7);
      var api = ctx.api;

      /* ---- pnlFilters (Dock Top, 70, white) ---- */
      k.box('g3-top', 0, 0, 1698, 70);
      wlbl(k, 'Start Date:', 20, 23);
      var dtpStart = k.dtp(100, 20, 120, 25, weekAgo);
      wlbl(k, 'End Date:', 240, 23);
      var dtpEnd = k.dtp(315, 20, 120, 25, today);
      var btnSearch = k.btn('SEARCH', 460, 15, 120, 40, '#007ACC');

      /* ---- lblMainTitle (Dock Top, 60) ---- */
      var band = k.box('g3-band', 0, 70, 1698, 60);
      band.textContent = 'TRANS DATA (bank → beforebank)';
      band.style.lineHeight = '60px';
      band.style.fontSize = '23px';

      /* ---- pnlToolbar (Dock Top, 36) ---- */
      var bar = k.box('g3-body', 0, 130, 1698, 36);
      var chkAll = k.chk('Select All', 20, 8, bar);
      var cnt = wlbl(k, '0 row(s) loaded, 0 selected', 140, 9, '', bar);
      cnt.style.color = '#696969';

      /* ---- pnlContent (Fill, padding 20/0/20/20): dgvList below the toolbar ---- */
      var gridBox = k.box('g3-white a2-dark', 20, 166, 1658, 619);
      var grid = OfficeKit.grid(gridBox, {
        select: 'multi', rowHeader: true,
        columns: [
          { key: 'id', header: 'ID', width: 60, format: 'int', align: 'right' },
          { key: 'uid', header: 'UID', width: 95 },
          { key: 'studentId', header: 'STUDENT ID', width: 105 },
          { key: 'name', header: 'NAME', width: 130 },
          { key: 'campus', header: 'CAMPUS', width: 90 },
          { key: 'category', header: 'CATEGORY', width: 110 },
          { key: 'subcategory', header: 'SUB CATEGORY', width: 130 },
          { key: 'type', header: 'TYPE', width: 85 },
          { key: 'beforeAmount', header: 'BEFORE AMOUNT', width: 135, format: 'money', align: 'right' },
          { key: 'payment', header: 'PAYMENT', width: 100, format: 'money', align: 'right' },
          { key: 'totalMoney', header: 'TOTAL MONEY', width: 115, format: 'money', align: 'right' },
          { key: 'quantity', header: 'QTY', width: 55, format: 'int', align: 'right' },
          { key: 'remark', header: 'REMARK', width: 105 },
          { key: 'source', header: 'SOURCE', width: 110 },
          { key: 'date', header: 'TRANSACTION DATE', width: 155 }
        ],
        onCheck: function (rows) { updateCount(rows.length); }
      });

      // UpdateCountLabel()
      function updateCount(selected) {
        var total = grid ? grid.count() : 0;
        cnt.textContent = total + ' row(s) loaded, ' + selected + ' selected';
        chkAll.checked = total > 0 && selected === total;
      }
      chkAll.addEventListener('change', function () { grid.setAllChecked(chkAll.checked); });

      // BtnSearch_Click: transaction_date between Start 00:00 and End 23:59:59, newest first
      function search() {
        var qs = 'from=' + OfficeKit.iso(dtpStart.value()) + '&to=' + OfficeKit.iso(dtpEnd.value());
        return OfficeKit.busy(btnSearch, api.request('GET', '/api/office/transdata?' + qs).then(function (res) {
          chkAll.checked = false;
          grid.setRows(res.rows || []);
          if (res.truncated) ctx.warn('Only the newest ' + (res.rows || []).length + ' rows are shown. Narrow the date range to see the rest.');
        }).catch(OfficeKit.fail(ctx, 'Error searching')));
      }
      btnSearch.addEventListener('click', search);

      /* ---- pnlBottom (Dock Bottom, 70) ---- */
      k.box('g3-bar', 0, 805, 1698, 70);
      var go = k.btn('TransData → beforebank', 20, 820, 220, 40, '#C43E2E');
      go.style.fontSize = '14.67px';

      // BtnTransData_Click
      go.addEventListener('click', function () {
        var ids = grid.checked().map(function (r) { return r.id; }).filter(function (id) { return id != null; });
        if (!ids.length) {
          ctx.messageBox('Please check the rows to move first.', 'TransData', 'OK', 'info');
          return;
        }
        ctx.messageBox('Move the selected ' + ids.length + ' row(s) from the bank table to the beforebank table.\n' +
          'This cannot be undone. Continue?', 'TransData Confirm', 'YesNo', 'warning').then(function (r) {
          if (r !== 'Yes') return;
          return OfficeKit.busy(go, api.request('POST', '/api/office/transdata', { ids: ids })).then(function (res) {
            var moved = res && res.moved != null ? res.moved : ids.length;
            return ctx.messageBox(moved + ' row(s) moved to beforebank.', 'TransData', 'OK', 'info').then(search);
          }, function (err) {
            return ctx.messageBox('An error occurred during TransData: ' + (err && err.message ? err.message : String(err)), 'Error', 'OK', 'error');
          });
        });
      });
    },
    show: function () {}
  };
})();
