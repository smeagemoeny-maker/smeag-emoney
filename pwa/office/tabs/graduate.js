/* Graduate tab — registers window.OfficeTabs['Graduate'] (see showPage() in office.js).
   Replica of GraduateControl.cs: "Graduating Before" date, SEARCH, BACKUP SELECTED and the result grid
   (no columns until a search runs). Wired to GET /api/office/people?endBefore= and POST /api/office/graduates/backup. */
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

  window.OfficeTabs = window.OfficeTabs || {};
  window.OfficeTabs['Graduate'] = {
    mount: function (root, ctx) {
      root.classList.add('g2-page');
      root.innerHTML =
        '<span class="g2-lbl f10" style="left:33px;top:20px">Graduating Before:</span>' +
        dtpHtml('before', 'f10', 'left:162px;top:14px;width:120px;height:25px') +
        '<button class="flat g2-btn" data-k="search" style="left:300px;top:11px;width:110px;height:35px;background:#0078D7">SEARCH</button>' +
        '<button class="flat g2-btn" data-k="backup" style="left:420px;top:11px;width:160px;height:35px;background:#FF8C00">BACKUP SELECTED</button>' +
        '<div class="g2-panel" data-k="grid" style="left:20px;top:76px;width:1666px;height:787px"></div>';

      function q(k) { return root.querySelector('[data-k="' + k + '"]'); }
      var today = new Date(); today.setHours(0, 0, 0, 0);
      var dtp = wireDtp(q('before'), today);
      var btnSearch = q('search'), btnBackup = q('backup'), box = q('grid');
      var grid = null;
      var COLUMNS = [
        { key: 'id', header: 'id', width: 80, format: 'int', align: 'right' },
        { key: 'uid', header: 'uid', width: 170 },
        { key: 'studentId', header: 'studentid', width: 160 },
        { key: 'name', header: 'name', width: 400 },
        { key: 'campus', header: 'campus', width: 130 },
        { key: 'startDate', header: 's_date', width: 130 },
        { key: 'endDate', header: 'e_date', width: 130 },
        { key: 'totalMoney', header: 'totalmoney', width: 150, format: 'money', align: 'right' },
        { key: 'registerDate', header: 'register_date', width: 230 }
      ];

      // e_date <= Graduating Before
      function search() {
        var p = ctx.api.request('GET', '/api/office/people?endBefore=' + isoDate(dtp.get())).then(function (res) {
          if (!grid) {
            box.className = '';
            grid = OfficeKit.grid(box, { columns: COLUMNS, select: 'multi', rowHeight: 35, emptyText: 'No students found.' });
          }
          grid.setRows(res.people || []);
          if (res.truncated) {
            return ctx.messageBox('Only the first ' + (res.people || []).length + ' students are shown.\nChoose an earlier date to see the rest.', 'SMEAG', 'OK', 'warning');
          }
        }).catch(OfficeKit.fail(ctx, 'Search Error'));
        return OfficeKit.busy(btnSearch, p);
      }

      function backup() {
        var sel = grid ? grid.checked() : [];
        if (!sel.length && grid && grid.current()) sel = [grid.current()]; // row clicked (highlighted) but not ticked
        if (!sel.length) return ctx.messageBox('Please select students to backup.', 'SMEAG', 'OK', 'warning');
        return ctx.messageBox('Are you sure you want to backup and delete ' + sel.length + ' selected students?', 'Confirm Backup', 'YesNo', 'question').then(function (ans) {
          if (ans !== 'Yes') return;
          return ctx.api.request('POST', '/api/office/graduates/backup', { ids: sel.map(function (r) { return r.id; }) }).then(function (res) {
            var n = res && res.moved != null ? res.moved : sel.length;
            return ctx.messageBox(n + ' students backed up and removed from active list.', 'SMEAG', 'OK', 'info').then(search);
          }, OfficeKit.fail(ctx, 'Backup Error'));
        });
      }

      btnSearch.addEventListener('click', function () { if (!btnSearch.disabled) search(); });
      btnBackup.addEventListener('click', function () { if (!btnBackup.disabled) OfficeKit.busy(btnBackup, backup()); });
    },
    show: function () {}
  };
})();
