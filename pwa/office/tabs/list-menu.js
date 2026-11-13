/* LIST MENU tab — registers window.OfficeTabs['LIST MENU'] (see showPage() in office.js).
   Port of ListMenuControl.cs: filter bar (Campus / Name / Age / Cat / Sub / From / To), SEARCH, EXPORT CSV (Excel),
   UPDATE SELECTED / DELETE SELECTED and the bank grid (category, subcategory, type, payment, quantity, remark editable).
   API: GET /api/office/bank, PATCH / DELETE /api/office/bank/:id. */
(function () {
  'use strict';

  /* ---------- DateTimePicker (short format M/d/yyyy, day space-padded like WinForms) ---------- */
  var CAL_SVG = '<svg class="g2-dtp-btn" viewBox="0 0 20 12" width="20" height="12">' +
    '<rect x="0.5" y="0.5" width="10" height="11" fill="#F4F4F4" stroke="#8A8A8A"/>' +
    '<rect x="1" y="1" width="9" height="2" fill="#8A8A8A"/>' +
    '<path d="M2 5h1.5M4.75 5h1.5M7.5 5h1.5M2 7.25h1.5M4.75 7.25h1.5M7.5 7.25h1.5M2 9.5h1.5M4.75 9.5h1.5M7.5 9.5h1.5" stroke="#9A9A9A" stroke-width="1.2"/>' +
    '<path d="M13 4.5h6l-3 3.2z" fill="#202020"/></svg>';
  function fmtDate(d) { var day = d.getDate(); return (d.getMonth() + 1) + '/' + (day < 10 ? ' ' + day : day) + '/' + d.getFullYear(); }
  function isoDate(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function parseDate(s) {
    var m = /^\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})\s*$/.exec(s || '');
    if (!m) return null;
    var d = new Date(+m[3], +m[1] - 1, +m[2]);
    return d.getMonth() === +m[1] - 1 && d.getDate() === +m[2] ? d : null;
  }
  function dtpHtml(key, cls, style) {
    return '<div class="g2-dtp ' + cls + '" data-k="' + key + '" style="' + style + '">' +
      '<input class="g2-dtp-txt" type="text" spellcheck="false" autocomplete="off">' + CAL_SVG +
      '<input class="g2-dtp-native" type="date" tabindex="-1"></div>';
  }
  function wireDtp(box, initial) {
    var txt = box.querySelector('.g2-dtp-txt'), btn = box.querySelector('.g2-dtp-btn'), nat = box.querySelector('.g2-dtp-native');
    var value = initial;
    function set(d) { value = d; txt.value = fmtDate(d); }
    set(initial);
    btn.addEventListener('mousedown', function (e) {
      e.preventDefault();
      nat.value = isoDate(value);
      try { nat.showPicker(); } catch (err) { nat.focus(); }
    });
    nat.addEventListener('change', function () {
      var p = /^(\d{4})-(\d{2})-(\d{2})$/.exec(nat.value);
      if (p) set(new Date(+p[1], +p[2] - 1, +p[3]));
    });
    txt.addEventListener('blur', function () { set(parseDate(txt.value) || value); });
    txt.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); set(parseDate(txt.value) || value); } });
    return { get: function () { return value; }, set: set };
  }

  function comboHtml(key, style, options, selected) {
    return '<div class="g2-combo" style="' + style + '"><select data-k="' + key + '">' +
      options.map(function (o) { return '<option' + (o === selected ? ' selected' : '') + '>' + o + '</option>'; }).join('') +
      '</select><span class="g2-chev"></span></div>';
  }

  window.OfficeTabs = window.OfficeTabs || {};
  window.OfficeTabs['LIST MENU'] = {
    mount: function (root, ctx) {
      root.classList.add('g2-page');
      var LBL_TOP = 'top:17px;';
      var TB = 'top:14px;height:23px;';
      root.innerHTML =
        '<span class="g2-lbl" style="left:33px;' + LBL_TOP + '">Campus:</span>' +
        comboHtml('campus', 'left:92px;top:14px;width:110px;height:23px', ['All', 'Capital', 'Encanto', 'Tarlac', 'Baydream1', 'Baydream2'], 'All') +
        '<span class="g2-lbl" style="left:218px;' + LBL_TOP + '">Name:</span>' +
        '<input class="g2-txt" data-k="name" type="text" placeholder="Name" spellcheck="false" autocomplete="off" style="left:265px;' + TB + 'width:110px">' +
        '<span class="g2-lbl" style="left:392px;' + LBL_TOP + '">Age:</span>' +
        '<input class="g2-txt" data-k="age" type="text" placeholder="Age" spellcheck="false" autocomplete="off" style="left:427px;' + TB + 'width:50px">' +
        '<span class="g2-lbl" style="left:493px;' + LBL_TOP + '">Cat:</span>' +
        '<input class="g2-txt" data-k="cat" type="text" placeholder="Category" spellcheck="false" autocomplete="off" style="left:526px;' + TB + 'width:110px">' +
        '<span class="g2-lbl" style="left:652px;' + LBL_TOP + '">Sub:</span>' +
        '<input class="g2-txt" data-k="sub" type="text" placeholder="Sub" spellcheck="false" autocomplete="off" style="left:687px;' + TB + 'width:110px">' +
        '<span class="g2-lbl" style="left:813px;' + LBL_TOP + '">From:</span>' +
        dtpHtml('from', '', 'left:856px;' + TB + 'width:100px') +
        '<span class="g2-lbl" style="left:974px;' + LBL_TOP + '">To:</span>' +
        dtpHtml('to', '', 'left:1000px;' + TB + 'width:100px') +
        '<button class="flat g2-btn" data-k="search" style="left:1107px;top:15px;width:118px;height:30px;background:#0078D7;font-size:12px">SEARCH</button>' +
        '<button class="flat g2-btn" data-k="export" style="left:1240px;top:12px;width:118px;height:30px;background:#2E7D32;font-size:12px">EXPORT CSV (Excel)</button>' +
        '<button class="flat g2-btn" data-k="update" style="left:1368px;top:12px;width:138px;height:30px;background:#FF9800;font-size:12px">UPDATE SELECTED</button>' +
        '<button class="flat g2-btn" data-k="delete" style="left:1516px;top:12px;width:138px;height:30px;background:#C62828;font-size:12px">DELETE SELECTED</button>' +
        '<div class="g2-panel" data-k="grid" style="left:20px;top:116px;width:1666px;height:747px"></div>';

      function q(k) { return root.querySelector('[data-k="' + k + '"]'); }
      var today = new Date(); today.setHours(0, 0, 0, 0);
      var dtpFrom = wireDtp(q('from'), new Date(today));
      var dtpTo = wireDtp(q('to'), new Date(today));

      // Age: digits only
      q('age').addEventListener('input', function () {
        var v = this.value.replace(/\D/g, '');
        if (v !== this.value) this.value = v;
      });

      // SELECT b.id, b.uid, b.studentid, b.name, p.age, b.campus, b.beforeamount, b.category, b.subcategory,
      //        b.transaction_type as type, b.payment, b.totalmoney as balance, b.quantity, b.transaction_date, b.remark, b.order
      var COLUMNS = [
        { key: 'id', header: 'id', width: 60, format: 'int', align: 'right' },
        { key: 'uid', header: 'uid', width: 100 },
        { key: 'studentId', header: 'studentid', width: 90 },
        { key: 'name', header: 'name', width: 150 },
        { key: 'age', header: 'age', width: 45, format: 'int', align: 'right' },
        { key: 'campus', header: 'campus', width: 85 },
        { key: 'beforeAmount', header: 'beforeamount', width: 105, align: 'right', format: 'money' },
        { key: 'category', header: 'category', width: 110, editable: true },
        { key: 'subcategory', header: 'subcategory', width: 130, editable: true },
        { key: 'type', header: 'type', width: 85, editable: true, options: ['increase', 'decrease', 'exception'] },
        { key: 'payment', header: 'payment', width: 95, align: 'right', editable: true, format: 'money' },
        { key: 'totalMoney', header: 'balance', width: 105, align: 'right', format: 'money' },
        { key: 'quantity', header: 'quantity', width: 70, format: 'int', align: 'right', editable: true },
        { key: 'date', header: 'transaction_date', width: 150 },
        { key: 'remark', header: 'remark', width: 160, editable: true },
        { key: 'order', header: 'order', width: 80 }
      ];
      var EDITABLE = ['category', 'subcategory', 'type', 'payment', 'quantity', 'remark'];
      var grid = OfficeKit.grid(q('grid'), { columns: COLUMNS });
      var api = ctx.api;
      var lastQuery = null;

      function info(msg) { return ctx.messageBox(msg, 'SMEAG', 'OK', 'info'); }

      // BtnSearch_Click: filters + transaction_date between From 00:00 and To 23:59:59
      function search() {
        var params = [
          ['from', OfficeKit.iso(dtpFrom.get())], ['to', OfficeKit.iso(dtpTo.get())],
          ['campus', q('campus').value], ['name', q('name').value], ['age', q('age').value],
          ['category', q('cat').value], ['subcategory', q('sub').value]
        ].filter(function (p) { return p[1] !== ''; })
          .map(function (p) { return p[0] + '=' + encodeURIComponent(p[1]); }).join('&');
        lastQuery = params;
        return runSearch(params);
      }
      function runSearch(params) {
        return OfficeKit.busy(q('search'), api.request('GET', '/api/office/bank?' + params).then(function (res) {
          grid.setRows(res.rows || []);
          if (res.truncated) ctx.warn('Only the newest ' + (res.rows || []).length + ' rows are shown. Narrow the filters to see the rest.');
        }).catch(OfficeKit.fail(ctx, 'Search Error')));
      }
      // Refresh after UPDATE / DELETE with the filters of the last search (BtnSearch_Click(sender, e))
      function refresh() { return lastQuery === null ? search() : runSearch(lastQuery); }

      q('search').addEventListener('click', search);
      ['name', 'age', 'cat', 'sub'].forEach(function (k) {
        q(k).addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); search(); } });
      });

      // BtnExportCsv_Click
      q('export').addEventListener('click', function () {
        var rows = grid.rows();
        if (!rows.length) { info('No data to export.'); return; }
        OfficeKit.downloadCsv('Office_Transaction_History.csv', COLUMNS, rows);
      });

      // BtnUpdate_Click: only the editable columns; balance (totalmoney) is NOT recalculated
      q('update').addEventListener('click', function () {
        var row = grid.current();
        if (!row) { info('Please select a row to edit first.'); return; }
        if (row.id == null) { info('Cannot read the id of the selected row.'); return; }
        var edit = grid.edited().filter(function (e) { return e.row === row; })[0];
        if (!edit) { info('Nothing was changed in the selected row.\nEdit category, subcategory, type, payment, quantity or remark first (double-click a cell).'); return; }
        var body = {};
        EDITABLE.forEach(function (k) {
          if (!Object.prototype.hasOwnProperty.call(edit.changes, k)) return;
          var v = String(edit.changes[k]).trim();
          if (k === 'payment') v = v.replace(/,/g, '');
          body[k] = (k === 'payment' || k === 'quantity') && v === '' ? null : v;
        });
        ctx.messageBox('Do you want to modify the selected transaction?\nNote: totalmoney (balance) is NOT recalculated automatically.',
          'Confirm Update', 'YesNo', 'question').then(function (r) {
          if (r !== 'Yes') return;
          return OfficeKit.busy(q('update'), api.request('PATCH', '/api/office/bank/' + row.id, body).then(function () {
            return info('Updated.').then(refresh);
          }, OfficeKit.fail(ctx, 'Update Error')));
        });
      });

      // BtnDelete_Click
      q('delete').addEventListener('click', function () {
        var row = grid.current();
        if (!row) { info('Please select a row to delete first.'); return; }
        if (row.id == null) { info('Cannot read the id of the selected row.'); return; }
        ctx.messageBox('Delete the following transaction?\n\nName: ' + (row.name || '-') + '\nDate: ' + (row.date || '-') +
          '\n\nThis cannot be undone.', 'Confirm Delete', 'YesNo', 'warning').then(function (r) {
          if (r !== 'Yes') return;
          return OfficeKit.busy(q('delete'), api.request('DELETE', '/api/office/bank/' + row.id).then(function () {
            return info('Deleted.').then(refresh);
          }, OfficeKit.fail(ctx, 'Delete Error')));
        });
      });
    },
    show: function () {}
  };
})();
