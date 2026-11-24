/* MODIFY INFO tab — registers window.OfficeTabs['MODIFY INFO'] (see showPage() in office.js).
   Screen replica of ModifyInfoControl.cs (header FlowLayoutPanel + DataGridView). Wired to /api/office/people (GET, PATCH) and /api/office/photos. */
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
  var FIELDS = ['uid', 'studentId', 'name', 'photo', 'age', 'gender', 'campus', 'startDate', 'endDate'];

  function photoSrc(row) { return row.photoUrl || NO_PHOTO; }
  function photoCell(row) {
    return '<img class="og-photo" data-photo width="32" height="32" alt="" title="Click to change the photo" style="cursor:pointer" src="' +
      OfficeKit.esc(photoSrc(row)) + '">';
  }
  // Accept YYYY-MM-DD or M/D/YYYY (what Convert.ToDateTime took in the original); anything else goes to the API as typed.
  function normDate(v) {
    var s = String(v == null ? '' : v).trim();
    var m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
    if (m) return m[3] + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2);
    m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
    if (m) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
    return s;
  }

  var COLUMNS = [
    { key: 'photo', header: 'PHOTO', width: 60, align: 'center', render: photoCell },
    { key: 'id', header: 'id', width: 70, format: 'int', align: 'right' },
    { key: 'uid', header: 'uid', width: 150, editable: true },
    { key: 'studentId', header: 'studentid', width: 150, editable: true },
    { key: 'name', header: 'name', width: 420, editable: true },
    { key: 'age', header: 'age', width: 70, format: 'int', align: 'right', editable: true },
    { key: 'gender', header: 'gender', width: 110, editable: true, options: ['Male', 'Female'] },
    { key: 'campus', header: 'campus', width: 140, editable: true, options: CAMPUSES.slice(1) },
    { key: 'startDate', header: 's_date', width: 140, editable: true },
    { key: 'endDate', header: 'e_date', width: 140, editable: true },
    { key: 'totalMoney', header: 'totalmoney', width: 150, format: 'money', align: 'right' }
  ];

  window.OfficeTabs = window.OfficeTabs || {};
  window.OfficeTabs['MODIFY INFO'] = {
    mount: function (root, ctx) {
      root.classList.add('g1');
      var c = controls(root, ctx);

      // pnlHeader (Dock Top, 60) > FlowLayoutPanel: UID / Name / Campus / SEARCH / UPDATE SELECTED
      c.lbl(34, 24, 'UID:');
      var txtUid = c.txt(73, 14, 120, 'NFC UID');
      c.lbl(211, 24, 'Name:');
      var txtName = c.txt(263, 14, 120, 'Name');
      c.lbl(400, 24, 'Campus:');
      var cbCampus = c.cbo(465, 14, 120, CAMPUSES, 'All');
      var btnSearch = c.btn(603, 11, 110, 35, 'SEARCH', '#0078D7');
      var btnUpdate = c.btn(723, 11, 160, 35, 'UPDATE SELECTED', '#2E7D32');

      // pnlGrid (Dock Fill, Padding 15) > dgvResults (editable grid, plain white until searched)
      var box = c.dgv(19, 76, 1668, 785);
      var grid = null;
      var lastQuery = null;

      var file = document.createElement('input');
      file.type = 'file'; file.accept = '.jpg,.jpeg,.png,.bmp,image/jpeg,image/png,image/bmp';
      file.style.display = 'none';
      root.appendChild(file);
      var photoTarget = null;   // { row, img }

      function ensureGrid() {
        if (grid) return grid;
        box.className = '';
        grid = OfficeKit.grid(box, { columns: COLUMNS, rowHeight: 40, emptyText: 'No results.' });
        box.addEventListener('error', function (e) {
          var t = e.target;
          if (t && t.tagName === 'IMG' && t.getAttribute('src') !== NO_PHOTO) t.setAttribute('src', NO_PHOTO);
        }, true);
        // DgvResults_CellClick on img_photo -> OpenFileDialog -> save the photo for this student
        box.addEventListener('click', function (e) {
          var img = e.target.closest && e.target.closest('img[data-photo]');
          if (!img) return;
          var tr = img.closest('tr[data-ri]');
          var row = tr && grid.rows()[+tr.getAttribute('data-ri')];
          if (!row) return;
          photoTarget = { row: row, img: img };
          file.value = '';
          file.click();
        });
        return grid;
      }

      file.addEventListener('change', function () {
        var f = file.files && file.files[0];
        var t = photoTarget;
        photoTarget = null;
        if (!f || !t) return;
        var studentId = String(grid.merged(t.row).studentId || '').trim();
        if (!studentId) { ctx.messageBox('Student ID is missing.', 'SMEAG', 'OK', 'warning'); return; }
        t.img.style.opacity = '0.4';
        OfficeKit.readImage(f, 800).then(function (dataUrl) {
          return ctx.api.request('POST', '/api/office/photos', { studentId: studentId, dataUrl: dataUrl });
        }).then(function (up) {
          return ctx.api.request('PATCH', '/api/office/people/' + t.row.id, { photo: up.photo }).then(function (res) {
            var p = (res && res.person) || {};
            t.row.photo = p.photo || up.photo;
            t.row.photoUrl = p.photoUrl || up.photoUrl;
            // same file name per student id -> bust the browser cache
            var live = t.img.isConnected ? t.img : null;
            if (live) live.src = t.row.photoUrl + (t.row.photoUrl.indexOf('?') < 0 ? '?' : '&') + 't=' + Date.now();
            return ctx.messageBox('Photo updated for ' + (t.row.name || studentId) + '.', 'SMEAG', 'OK', 'info');
          });
        }).catch(OfficeKit.fail(ctx, 'Photo Error')).then(function () { t.img.style.opacity = ''; });
      });

      function load(qs) {
        lastQuery = qs;
        return ctx.api.request('GET', '/api/office/people' + qs).then(function (res) {
          var people = res.people || [];
          ensureGrid().setRows(people);
          if (!people.length) return ctx.messageBox('No results.', 'SMEAG', 'OK', 'info');
          if (res.truncated) {
            return ctx.messageBox('Only the first ' + people.length + ' students are shown.\nAdd a filter to narrow the search.', 'SMEAG', 'OK', 'warning');
          }
        });
      }

      function search() {
        var q = [];
        function add(k, v) { if (v) q.push(k + '=' + encodeURIComponent(v)); }
        add('uid', txtUid.value);
        add('name', txtName.value);
        if (cbCampus.value !== 'All') add('campus', cbCampus.value);
        return OfficeKit.busy(btnSearch, load(q.length ? '?' + q.join('&') : '').catch(OfficeKit.fail(ctx, 'Search Error')));
      }

      function update() {
        if (!grid) return;
        var edited = grid.edited();
        var jobs;
        if (edited.length) {
          jobs = edited.map(function (e) { return { row: e.row, changes: e.changes }; });
        } else {
          var cur = grid.current();
          if (!cur) return;                    // dgvResults.CurrentRow == null
          var all = {};
          FIELDS.forEach(function (k) { if (k !== 'photo') all[k] = cur[k]; });
          jobs = [{ row: cur, changes: all }];
        }
        jobs.forEach(function (j) {
          if ('startDate' in j.changes) j.changes.startDate = normDate(j.changes.startDate);
          if ('endDate' in j.changes) j.changes.endDate = normDate(j.changes.endDate);
          if ('age' in j.changes && j.changes.age != null) j.changes.age = String(j.changes.age).trim();
        });
        var what = jobs.length === 1 ? 'student ' + (jobs[0].row.name || jobs[0].row.id) : jobs.length + ' students';
        return ctx.messageBox('Update the information of ' + what + '?', 'Confirm Update', 'YesNo', 'question').then(function (ans) {
          if (ans !== 'Yes') return;
          var errors = [];
          var ok = 0;
          var chain = Promise.resolve();
          jobs.forEach(function (j) {
            chain = chain.then(function () {
              return ctx.api.request('PATCH', '/api/office/people/' + j.row.id, j.changes).then(function () { ok++; }, function (err) {
                errors.push('id ' + j.row.id + ' (' + (j.row.name || '') + '): ' + (err && err.message ? err.message : err));
              });
            });
          });
          return chain.then(function () {
            var msg = errors.length
              ? (ok ? ok + ' of ' + jobs.length + ' students updated.\n\n' : '') + 'Update Error:\n' + errors.join('\n')
              : 'Student Information Updated Successfully!';
            return ctx.messageBox(msg, 'SMEAG', 'OK', errors.length ? 'error' : 'info').then(function () {
              if (ok && lastQuery !== null) return load(lastQuery).catch(OfficeKit.fail(ctx, 'Search Error'));
            });
          });
        });
      }

      btnSearch.addEventListener('click', function () { if (!btnSearch.disabled) search(); });
      btnUpdate.addEventListener('click', function () { if (!btnUpdate.disabled) OfficeKit.busy(btnUpdate, Promise.resolve().then(update).catch(OfficeKit.fail(ctx, 'Update Error'))); });
      [txtUid, txtName].forEach(function (t) {
        t.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { e.preventDefault(); if (!btnSearch.disabled) search(); }
        });
      });

      // NFC tap: while a uid cell is being edited, the tapped card becomes that row's new uid (card reissue).
      // Otherwise load this card's student for editing (other filters cleared).
      return {
        onNfc: function (uid) {
          if (grid && grid.fillEditing('uid', uid)) return;
          if (btnSearch.disabled) return;
          txtUid.value = uid; txtName.value = ''; cbCampus.value = 'All';
          search();
        }
      };
    },
    show: function () {}
  };
})();
