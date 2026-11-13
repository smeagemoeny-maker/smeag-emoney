/* INFORMATION tab — registers window.OfficeTabs['INFORMATION'] (see showPage() in office.js).
   Screen replica of InformationControl.cs (header FlowLayoutPanel + DataGridView). Wired to GET /api/office/people. */
(function () {
  'use strict';

  /* ---- small WinForms-control builders (scoped to this file) ---- */
  function controls(root, ctx) {
    function add(tag, cls, x, y, w, h) {
      var e = document.createElement(tag);
      if (cls) e.className = cls;
      e.style.left = x + 'px'; e.style.top = y + 'px';
      if (w != null) e.style.width = w + 'px';
      if (h != null) e.style.height = h + 'px';
      root.appendChild(e);
      return e;
    }
    function pad2(n) { return n; }
    function fmtDate(d) { return (d.getMonth() + 1) + '/' + pad2(d.getDate()) + '/' + d.getFullYear(); }
    function isoDate(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
    function parseDate(s) {
      var m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/.exec(s);
      if (!m) return null;
      var d = new Date(+m[3], +m[1] - 1, +m[2]);
      return d.getMonth() === +m[1] - 1 ? d : null;
    }
    var CAL_SVG = '<svg width="20" height="13" viewBox="0 0 20 13">' +
      '<rect x="0.5" y="0.5" width="10" height="11" fill="#E8E8EC" stroke="#606064"/>' +
      '<g fill="#9A9AA2"><rect x="2" y="3" width="2" height="2"/><rect x="4.5" y="3" width="2" height="2"/><rect x="7" y="3" width="2" height="2"/>' +
      '<rect x="2" y="5.5" width="2" height="2"/><rect x="4.5" y="5.5" width="2" height="2"/><rect x="7" y="5.5" width="2" height="2"/>' +
      '<rect x="2" y="8" width="2" height="2"/><rect x="4.5" y="8" width="2" height="2"/><rect x="7" y="8" width="2" height="2"/></g>' +
      '<path d="M1.5 12.5H11.5V1.5" fill="none" stroke="#B0B0B4"/>' +
      '<path d="M13 4.5H19.5L16.25 8z" fill="#3C4452"/></svg>';

    return {
      // Label: x = first glyph column, cap = cap-height top (both measured on the original)
      lbl: function (x, cap, text) { var e = add('span', 'g1-lbl', x - 1, cap - 4); e.textContent = text; return e; },
      // Bold gray section title (Segoe UI 9pt Bold, Color.Gray)
      title: function (x, cap, text) { var e = add('span', 'g1-title', x, cap - 3); e.textContent = text; return e; },
      txt: function (x, y, w, ph) {
        var e = add('input', 'g1-txt', x, y, w, 25);
        e.type = 'text'; e.placeholder = ph || ''; e.spellcheck = false; e.autocomplete = 'off';
        return e;
      },
      // ComboBox: edit=false -> DropDownList (<select>), edit=true -> DropDown (typable text + list on the arrow)
      cbo: function (x, y, w, opts, val, edit) {
        var box = add('div', 'g1-cbo' + (edit ? ' edit' : ''), x, y, w, 25);
        var s = document.createElement('select');
        if (edit) { var blank = document.createElement('option'); blank.value = ''; blank.textContent = ''; blank.hidden = true; s.appendChild(blank); }
        opts.forEach(function (o) { var op = document.createElement('option'); op.value = o; op.textContent = o; s.appendChild(op); });
        var chev = document.createElement('span'); chev.className = 'chev';
        if (!edit) { s.value = val; box.appendChild(s); box.appendChild(chev); return s; }
        var t = document.createElement('input');
        t.type = 'text'; t.spellcheck = false; t.autocomplete = 'off'; t.value = val || '';
        s.value = '';
        s.tabIndex = -1;
        s.addEventListener('change', function () { t.value = s.value; s.value = ''; t.focus(); t.select(); });
        box.appendChild(t); box.appendChild(s); box.appendChild(chev);
        return t;
      },
      dtp: function (x, y, w) {
        var box = add('div', 'g1-dtp', x, y, w, 25);
        var val = document.createElement('input');
        val.className = 'val'; val.type = 'text'; val.spellcheck = false; val.autocomplete = 'off';
        var btn = document.createElement('button');
        btn.className = 'btn'; btn.type = 'button'; btn.tabIndex = -1; btn.innerHTML = CAL_SVG;
        var nat = document.createElement('input');
        nat.type = 'date'; nat.tabIndex = -1;
        box.appendChild(val); box.appendChild(btn); box.appendChild(nat);
        var cur = new Date(); cur.setHours(0, 0, 0, 0);
        function set(d) { cur = d; val.value = fmtDate(d); nat.value = isoDate(d); }
        set(cur);
        val.addEventListener('blur', function () { var d = parseDate(val.value); set(d || cur); });
        val.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { val.blur(); return; }
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            var d = new Date(cur); d.setDate(d.getDate() + (e.key === 'ArrowUp' ? 1 : -1)); set(d);
          }
        });
        btn.addEventListener('click', function () {
          try { if (nat.showPicker) { nat.showPicker(); return; } } catch (err) { /* fall through */ }
          nat.style.pointerEvents = 'auto'; nat.focus(); nat.click();
        });
        nat.addEventListener('change', function () {
          var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(nat.value);
          if (m) set(new Date(+m[1], +m[2] - 1, +m[3]));
        });
        return { get: function () { return new Date(cur); }, set: set, input: val };
      },
      // CheckBox: (x, y) = top-left of the 13x13 box
      chk: function (x, y, text) {
        var l = add('label', 'g1-chk', x, y - 2);
        l.innerHTML = '<input type="checkbox"><span class="box"></span><span class="txt"></span>';
        l.querySelector('.txt').textContent = text;
        return l.querySelector('input');
      },
      btn: function (x, y, w, h, text, bg, bold) {
        var b = add('button', 'g1-btn' + (bold ? ' bold' : ''), x, y, w, h);
        b.type = 'button'; b.textContent = text; b.style.background = bg;
        return b;
      },
      // Panel (optional BorderStyle.FixedSingle)
      pnl: function (x, y, w, h, bg, single) {
        var p = add('div', 'g1-pnl' + (single ? ' single' : ''), x, y, w, h);
        if (bg) p.style.background = bg;
        return p;
      },
      // DataGridView: no columns -> plain white area; columns -> blue header row (+ row-header column), empty body
      dgv: function (x, y, w, h, cols) {
        var g = add('div', 'g1-dgv', x, y, w, h);
        if (!cols) return g;
        var html = '<table><colgroup><col style="width:41px">' + cols.map(function () { return '<col>'; }).join('') + '</colgroup>' +
          '<thead><tr><th class="rh"></th>' + cols.map(function (c) { return '<th>' + ctx.escapeHtml(c) + '</th>'; }).join('') + '</tr></thead>' +
          '<tbody></tbody></table>';
        g.innerHTML = html;
        return g;
      }
    };
  }

  var CAMPUSES = ['All', 'Capital', 'Encanto', 'Tarlac', 'Baydream1', 'Baydream2'];
  var NO_PHOTO = 'tabs/human.png';   // ResourceHelper.GetDefaultStudentPhotoPath()

  function photoCell(row) {
    var src = row.photoUrl || NO_PHOTO;
    return '<img class="og-photo" width="32" height="32" alt="" src="' + OfficeKit.esc(src) + '">';
  }

  var COLUMNS = [
    { key: 'photo', header: 'PHOTO', width: 60, align: 'center', render: photoCell },
    { key: 'id', header: 'id', width: 70, format: 'int', align: 'right' },
    { key: 'uid', header: 'uid', width: 130 },
    { key: 'studentId', header: 'studentid', width: 130 },
    { key: 'name', header: 'name', width: 380 },
    { key: 'age', header: 'age', width: 60, format: 'int', align: 'right' },
    { key: 'gender', header: 'gender', width: 90 },
    { key: 'campus', header: 'campus', width: 120 },
    { key: 'startDate', header: 's_date', width: 110 },
    { key: 'endDate', header: 'e_date', width: 110 },
    { key: 'totalMoney', header: 'totalmoney', width: 140, format: 'money', align: 'right' },
    { key: 'registerDate', header: 'register_date', width: 175 }
  ];

  window.OfficeTabs = window.OfficeTabs || {};
  window.OfficeTabs['INFORMATION'] = {
    mount: function (root, ctx) {
      root.classList.add('g1');
      var c = controls(root, ctx);

      // pnlHeader (Dock Top, 60) > FlowLayoutPanel: UID / Name / Campus / [ ] Date Filter / start ~ end / SEARCH
      c.lbl(34, 24, 'UID:');
      var txtUid = c.txt(73, 14, 120, 'NFC UID');
      c.lbl(211, 24, 'Name:');
      var txtName = c.txt(263, 14, 120, 'Name');
      c.lbl(400, 24, 'Campus:');
      var cbCampus = c.cbo(465, 14, 120, CAMPUSES, 'All');
      var chkUseDate = c.chk(598, 23, 'Date Filter');
      var dtpStart = c.dtp(697, 14, 120);
      c.lbl(836, 24, '~');
      var dtpEnd = c.dtp(857, 14, 120);
      var btnSearch = c.btn(995, 11, 120, 35, 'SEARCH', '#0078D7');

      // pnlGrid (Dock Fill, Padding 15) > dgvResults — plain white until the first search binds columns
      var box = c.dgv(19, 76, 1668, 785);
      var grid = null;
      function ensureGrid() {
        if (grid) return grid;
        box.className = '';
        grid = OfficeKit.grid(box, { columns: COLUMNS, rowHeight: 40, emptyText: 'No results.' });
        // missing / never-uploaded photo -> default photo (the original falls back to human.png)
        box.addEventListener('error', function (e) {
          var t = e.target;
          if (t && t.tagName === 'IMG' && t.getAttribute('src') !== NO_PHOTO) t.setAttribute('src', NO_PHOTO);
        }, true);
        return grid;
      }

      function search() {
        var q = [];
        function add(k, v) { if (v) q.push(k + '=' + encodeURIComponent(v)); }
        add('uid', txtUid.value);
        add('name', txtName.value);
        if (cbCampus.value !== 'All') add('campus', cbCampus.value);
        if (chkUseDate.checked) {
          add('startFrom', OfficeKit.iso(dtpStart.get()));
          add('endTo', OfficeKit.iso(dtpEnd.get()));
        }
        var p = ctx.api.request('GET', '/api/office/people' + (q.length ? '?' + q.join('&') : '')).then(function (res) {
          var people = res.people || [];
          ensureGrid().setRows(people);
          if (!people.length) return ctx.messageBox('No results.', 'SMEAG', 'OK', 'info');
          if (res.truncated) {
            return ctx.messageBox('Only the first ' + people.length + ' students are shown.\nAdd a filter to narrow the search.', 'SMEAG', 'OK', 'warning');
          }
        }).catch(OfficeKit.fail(ctx, 'Search Error'));
        return OfficeKit.busy(btnSearch, p);
      }

      btnSearch.addEventListener('click', function () { if (!btnSearch.disabled) search(); });
      [txtUid, txtName].forEach(function (t) {
        t.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { e.preventDefault(); if (!btnSearch.disabled) search(); }
        });
      });
    },
    show: function () {}
  };
})();
