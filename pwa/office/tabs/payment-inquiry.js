/* PAYMENT INQUIRY tab — registers window.OfficeTabs['PAYMENT INQUIRY'] (see showPage() in office.js).
   Screen only (phase 1): port of the WinForms PaymentInquiryControl.cs layout; no backend calls yet. */
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

  var CAMPUSES = ['All', 'CAPITAL', 'ENCANTO', 'TARLAC', 'BAYDREAM'];

  window.OfficeTabs = window.OfficeTabs || {};
  window.OfficeTabs['PAYMENT INQUIRY'] = {
    mount: function (root, ctx) {
      var k = kit(makePage(root));
      var api = ctx.api;
      function info(msg, cap) { return ctx.messageBox(msg, cap || 'Payment Inquiry', 'OK', 'info'); }
      function today0() { var t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()); }
      function weekAgo() { var t = today0(); t.setDate(t.getDate() - 7); return t; }

      /* ---- pnlFilters (Dock Top, 120, white) ---- */
      k.box('g3-top', 0, 0, 1698, 120);
      wlbl(k, 'NFC ID:', 20, 13);
      var chkNfc = k.chk('Use Card Reader', 85, 13);
      var txtNfc = k.txt(215, 10, 160, 25, 'Tap card on ACR122U...');
      txtNfc.disabled = true;
      wlbl(k, 'Name:', 400, 13);
      var txtName = k.txt(450, 10, 150, 25, 'Enter name');
      wlbl(k, 'Campus:', 625, 13);
      var cbCampus = k.combo(690, 10, 140, 25, CAMPUSES, 'All');
      var chkDate = k.chk('Use Date Range', 20, 58);
      wlbl(k, 'Start Date:', 150, 60);
      var dtpStart = k.dtp(230, 57, 120, 25, weekAgo());
      wlbl(k, 'End Date:', 365, 60);
      var dtpEnd = k.dtp(435, 57, 120, 25, today0());
      dtpStart.setEnabled(false); dtpEnd.setEnabled(false);
      chkNfc.addEventListener('change', function () {
        txtNfc.disabled = !chkNfc.checked;
        if (!chkNfc.checked) txtNfc.value = ''; else txtNfc.focus();
      });
      chkDate.addEventListener('change', function () {
        dtpStart.setEnabled(chkDate.checked); dtpEnd.setEnabled(chkDate.checked);
      });
      var btnSearch = k.btn('SEARCH', 690, 47, 120, 45, '#007ACC');
      var btnClear = k.btn('CLEAR', 820, 47, 90, 45, '#808080');

      /* ---- lblMainTitle (Dock Top, 60) ---- */
      var band = k.box('g3-band', 0, 120, 1698, 60);
      band.textContent = 'PAYMENT INQUIRY';
      band.style.lineHeight = '60px';
      band.style.fontSize = '23.8px';

      /* ---- pnlContent (Fill, padding 20) ---- */
      k.lbl('PAYMENT LIST (bank + beforebank)', 24, 211, 'b navy').style.fontSize = '15.8px';
      // DisplayColumns, table_source first (DisplayIndex = 0)
      var COLUMNS = [
        { key: 'table', header: 'TABLE', width: 95 },
        { key: 'uid', header: 'UID', width: 95 },
        { key: 'studentId', header: 'STUDENT ID', width: 100 },
        { key: 'name', header: 'NAME', width: 140 },
        { key: 'campus', header: 'CAMPUS', width: 85 },
        { key: 'category', header: 'CATEGORY', width: 110 },
        { key: 'subcategory', header: 'SUB CATEGORY', width: 120 },
        { key: 'type', header: 'TYPE', width: 80 },
        { key: 'beforeAmount', header: 'BEFORE AMOUNT', width: 135, format: 'money', align: 'right' },
        { key: 'payment', header: 'PAYMENT', width: 95, format: 'money', align: 'right' },
        { key: 'totalMoney', header: 'TOTAL MONEY', width: 115, format: 'money', align: 'right' },
        { key: 'quantity', header: 'QTY', width: 50, format: 'int', align: 'right' },
        { key: 'remark', header: 'REMARK', width: 110 },
        { key: 'source', header: 'SOURCE', width: 95 },
        { key: 'date', header: 'TRANSACTION DATE', width: 150 }
      ];
      var grid = OfficeKit.grid(k.box('g3-white a2-dark', 20, 230, 1658, 555), { columns: COLUMNS });

      function nfcMode() { return chkNfc.checked && txtNfc.value.trim() !== ''; }

      // BtnSearch_Click / BuildQuery: card -> full history (other filters ignored); else name / campus / dates
      function search() {
        if (chkNfc.checked && !txtNfc.value.trim()) { info('Please tap the card on the reader.', 'NFC ID').then(function () { txtNfc.focus(); }); return; }
        var qs;
        if (nfcMode()) {
          qs = 'uid=' + encodeURIComponent(txtNfc.value.trim());
        } else {
          var parts = [];
          if (txtName.value.trim()) parts.push('name=' + encodeURIComponent(txtName.value.trim()));
          if (cbCampus.value !== 'All') parts.push('campus=' + encodeURIComponent(cbCampus.value));
          if (chkDate.checked) parts.push('from=' + OfficeKit.iso(dtpStart.value()), 'to=' + OfficeKit.iso(dtpEnd.value()));
          // The web API refuses an unfiltered search over bank + beforebank.
          if (!parts.length) { info('Enter a card, a name, a campus or a date range first.'); return; }
          qs = parts.join('&');
        }
        return OfficeKit.busy(btnSearch, api.request('GET', '/api/office/payments?' + qs).then(function (res) {
          var rows = res.rows || [];
          grid.setRows(rows);
          if (!rows.length) return info('No results found.');
          if (res.truncated) return ctx.warn('Only the newest ' + rows.length + ' rows are shown. Narrow the filters to see the rest.');
        }).catch(OfficeKit.fail(ctx, 'Error searching')));
      }
      btnSearch.addEventListener('click', search);
      // A USB card reader types the UID followed by Enter (HandleNfcUid -> search)
      txtNfc.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); search(); } });
      txtName.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); search(); } });

      // BtnClear_Click
      btnClear.addEventListener('click', function () {
        chkNfc.checked = false; txtNfc.value = ''; txtNfc.disabled = true;
        txtName.value = ''; cbCampus.value = 'All';
        chkDate.checked = false; dtpStart.setEnabled(false); dtpEnd.setEnabled(false);
        dtpStart.setValue(weekAgo()); dtpEnd.setValue(today0());
        grid.setRows([]);
      });

      /* ---- pnlBottom (Dock Bottom, 70): FlowLayoutPanel docked left ---- */
      k.box('g3-bar', 0, 805, 1698, 70);
      var dl = k.btn('DOWNLOAD PDF', 20, 820, 160, 40, '#219653');
      dl.style.fontSize = '14.67px';
      var op = k.btn('OPEN PDF FOLDER', 190, 820, 170, 40, '#4682B4', 'reg');
      op.style.fontSize = '13.8px';

      function pad2(n) { return (n < 10 ? '0' : '') + n; }
      function stamp(d, sep) {
        return d.getFullYear() + sep + pad2(d.getMonth() + 1) + sep + pad2(d.getDate());
      }
      function hms(d, sep) { return pad2(d.getHours()) + sep + pad2(d.getMinutes()) + sep + pad2(d.getSeconds()); }

      // BtnDownloadPdf_Click: A4 landscape report (criteria line, generated time, row count, table)
      dl.addEventListener('click', function () {
        var rows = grid.rows();
        if (!rows.length) { ctx.messageBox('No data to export.', 'SMEAG', 'OK', 'info'); return; }
        var now = new Date();
        var criteria = nfcMode()
          ? 'NFC ID: ' + txtNfc.value.trim() + ' (all dates)'
          : 'Name: ' + (txtName.value.trim() || 'Any') + ' | Campus: ' + cbCampus.value + ' | ' +
            (chkDate.checked ? 'Period: ' + OfficeKit.iso(dtpStart.value()) + ' ~ ' + OfficeKit.iso(dtpEnd.value()) : 'Period: All');
        var esc = OfficeKit.esc;
        var html = '<div style="display:flex;justify-content:space-between;align-items:flex-start">' +
          '<div><h1 style="color:#2196F3">PAYMENT INQUIRY REPORT</h1><p class="meta">' + esc(criteria) + '</p></div>' +
          '<div class="meta">Generated: ' + stamp(now, '-') + ' ' + hms(now, ':') + '</div></div>' +
          '<h2 style="color:#2196F3">RESULTS (' + rows.length + ' rows, bank + beforebank)</h2>' +
          OfficeKit.tableHtml(COLUMNS, rows);
        OfficeKit.printDoc('Payment_Inquiry_' + stamp(now, '') + '_' + hms(now, ''), html, {
          landscape: true,
          css: 'body{font-size:8px;} table.pt th{background:#2196F3;color:#FFF;text-align:center;}'
        });
      });

      // BtnOpenPdfFolder_Click: a browser cannot open a folder; explain where the PDF goes.
      op.addEventListener('click', function () {
        info('DOWNLOAD PDF opens the browser print dialog. Choose "Save as PDF" as the printer;\n' +
          'the file is saved to your Downloads folder (or the folder you pick in that dialog).\n\n' +
          'Open it from the browser downloads list (Ctrl+J) or from the Downloads folder.', 'PDF Folder');
      });
    },
    show: function () {}
  };
})();
