/* REGISTRATION tab — registers window.OfficeTabs['REGISTRATION'] (see showPage() in office.js).
   Screen replica of RegistrationControl.cs (absolute layout: labels at x 20 / inputs at x 220, rows every 45px from y 40).
   No screenshot of this tab exists; everything comes from the source. Wired to POST /api/office/people and /api/office/photos; Excel import via SheetJS (lazy-loaded). */
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

  // WinForms page coords -> content coords (tab page sits at content (4, 1))
  var PX = 4, PY = 1;
  var START_X = 220, LABEL_X = 20, START_Y = 40, SPACING = 45, INPUT_W = 350, INPUT_H = 27; // 11pt single-line height

  window.OfficeTabs = window.OfficeTabs || {};
  window.OfficeTabs['REGISTRATION'] = {
    mount: function (root, ctx) {
      root.classList.add('g1', 'g1-reg');
      var c = controls(root, ctx);

      // AddInput(): Label 180x25 at (20, y + 2), MiddleRight, Segoe UI 11pt; input at (220, y) 350 wide
      function label(row, text) {
        var e = document.createElement('span');
        e.className = 'g1-rlbl';
        e.style.left = (PX + LABEL_X) + 'px';
        e.style.top = (PY + START_Y + SPACING * row + 2) + 'px';
        e.textContent = text;
        root.appendChild(e);
      }
      function rowY(row) { return PY + START_Y + SPACING * row; }
      function text(row, lbl, ro, val) {
        label(row, lbl);
        var t = c.txt(PX + START_X, rowY(row), INPUT_W, '');
        t.style.height = INPUT_H + 'px';
        if (ro) { t.readOnly = true; t.classList.add('ro'); }
        if (val != null) t.value = val;
        return t;
      }
      function combo(row, lbl, items) {
        label(row, lbl);
        var s = c.cbo(PX + START_X, rowY(row), INPUT_W, items, '');
        var blank = document.createElement('option');
        blank.value = ''; blank.hidden = true;
        s.insertBefore(blank, s.firstChild);
        s.value = '';                       // SelectedIndex = -1
        s.parentNode.style.height = INPUT_H + 'px';
        return s;
      }
      function date(row, lbl) {
        label(row, lbl);
        var d = c.dtp(PX + START_X, rowY(row), INPUT_W);
        d.input.parentNode.style.height = INPUT_H + 'px';
        return d;
      }

      var txtUid = text(0, 'NFC UID:', false);
      // The WinForms box is ReadOnly and filled by the NFC reader (HandleNfcUid); the browser has no reader hook,
      // so the card UID is typed (or entered by a keyboard-wedge reader) here.
      txtUid.placeholder = 'Tap card or type UID';
      var txtStudentId = text(1, 'Student ID:', true);
      var btnGenerateId = c.btn(PX + START_X + INPUT_W + 15, rowY(1), 120, 30, 'Generate ID', '#808080');
      btnGenerateId.classList.add('g1-rflat');
      var txtName = text(2, 'Name:', false);
      var txtAge = text(3, 'Age:', false);
      var cbGender = combo(4, 'Gender:', ['Male', 'Female']);
      var cbCampus = combo(5, 'Campus:', ['Capital', 'Encanto', 'Tarlac', 'Baydream1', 'Baydream2']);
      var dtpStart = date(6, 'Start Date:');
      var dtpEnd = date(7, 'End Date:');
      var txtTotalAmount = text(8, 'Total Amount:', true, '0.00');

      // Photo: PictureBox 150x150, FixedSingle, Zoom; default photo tabs/human.png (set in group1.css)
      var pb = document.createElement('div');
      pb.className = 'g1-photo';
      pb.style.left = (PX + START_X + INPUT_W + 15) + 'px';
      pb.style.top = rowY(2) + 'px';
      root.appendChild(pb);

      var btnUpload = c.btn(PX + START_X + INPUT_W + 15, rowY(5) + 10, 150, 40, 'UPLOAD PHOTO', '#808080', true);
      btnUpload.classList.add('g1-rflat');
      var btnRegister = c.btn(PX + START_X, rowY(9) + 20, INPUT_W, 60, 'REGISTER STUDENT', '#0078D7');
      btnRegister.style.fontSize = '18.67px';     // Segoe UI 14pt
      var btnImport = c.btn(PX + START_X + INPUT_W + 15, rowY(9) + 20, 150, 60, 'IMPORT FROM EXCEL', '#2ECC71', true);
      btnImport.style.fontSize = '13.33px';       // Segoe UI 10pt Bold
      btnImport.style.letterSpacing = '-0.3px';  // fallback font is wider than Segoe UI

      btnGenerateId.addEventListener('click', function () {
        var str = 'abcdefghijklmnopqrstuvwxyz0123456789', ran = '';
        for (var i = 0; i < 9; i++) ran += str[Math.floor(Math.random() * str.length)];
        txtStudentId.value = ran.toUpperCase();
      });

      /* ---- photo ---- */
      var file = document.createElement('input');
      file.type = 'file'; file.accept = '.jpg,.jpeg,.png,.bmp,image/jpeg,image/png,image/bmp';
      file.style.display = 'none';
      root.appendChild(file);
      var photoFile = null, photoUrl = null;
      function setPhoto(f) {
        if (photoUrl) URL.revokeObjectURL(photoUrl);
        photoFile = f || null;
        photoUrl = f ? URL.createObjectURL(f) : null;
        pb.style.backgroundImage = photoUrl ? 'url("' + photoUrl + '")' : '';   // '' -> default human.png from CSS
      }
      btnUpload.addEventListener('click', function () { file.value = ''; file.click(); });
      file.addEventListener('change', function () {
        var f = file.files && file.files[0];
        if (f) setPhoto(f);
      });
      txtAge.addEventListener('keydown', function (e) {
        if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
        if (!/[0-9]/.test(e.key)) e.preventDefault();
      });

      function clearForm() {
        txtUid.value = ''; txtStudentId.value = ''; txtName.value = ''; txtAge.value = '';
        cbGender.value = ''; cbCampus.value = '';
        var today = new Date(); today.setHours(0, 0, 0, 0);
        dtpStart.set(today); dtpEnd.set(new Date(today));
        setPhoto(null);
      }

      /* ---- REGISTER STUDENT ---- */
      function register() {
        var uid = txtUid.value.trim(), sid = txtStudentId.value.trim(), name = txtName.value.trim();
        if (!uid || !sid || !name) {
          return ctx.messageBox('Please fill required fields (UID, ID, Name)', 'SMEAG', 'OK', 'warning');
        }
        var age = parseInt(txtAge.value, 10);
        var total = parseFloat(String(txtTotalAmount.value).replace(/,/g, ''));
        var person = {
          uid: uid, studentId: sid, name: name,
          age: isNaN(age) ? 0 : age,
          gender: cbGender.value || 'Male',
          campus: cbCampus.value || 'Capital',
          startDate: OfficeKit.iso(dtpStart.get()),
          endDate: OfficeKit.iso(dtpEnd.get()),
          totalMoney: isNaN(total) ? 0 : total
        };
        var step = photoFile
          ? OfficeKit.readImage(photoFile, 800).then(function (dataUrl) {
            return ctx.api.request('POST', '/api/office/photos', { studentId: sid, dataUrl: dataUrl });
          }).then(function (up) { person.photo = up.photo; })
          : Promise.resolve();
        return step.then(function () {
          return ctx.api.request('POST', '/api/office/people', person);
        }).then(function () {
          return ctx.messageBox('Student Registered Successfully!', 'SMEAG', 'OK', 'info');
        }).then(clearForm, OfficeKit.fail(ctx, 'Registration Error'));
      }
      btnRegister.addEventListener('click', function () { if (!btnRegister.disabled) OfficeKit.busy(btnRegister, register()); });

      /* ---- IMPORT FROM EXCEL (ExcelImportService: first sheet, skip header, columns 1..10) ---- */
      var xls = document.createElement('input');
      xls.type = 'file'; xls.accept = '.xlsx,.xls,.csv';
      xls.style.display = 'none';
      root.appendChild(xls);
      btnImport.addEventListener('click', function () { if (!btnImport.disabled) { xls.value = ''; xls.click(); } });
      xls.addEventListener('change', function () {
        var f = xls.files && xls.files[0];
        if (f) OfficeKit.busy(btnImport, importExcel(f));
      });

      var btnImported = c.btn(PX + START_X + INPUT_W + 15, rowY(9) + 90, 150, 32, 'IMPORTED LIST', '#808080', true);
      btnImported.classList.add('g1-rflat');
      btnImported.addEventListener('click', function () { if (!btnImported.disabled) OfficeKit.busy(btnImported, showImported(ctx, {})); });

      function importExcel(f) {
        var students, setup;
        return loadSheetJs().then(function (XLSX) {
          return readFile(f).then(function (buf) {
            var wb = XLSX.read(buf, { type: 'array' });
            setup = parseSetup(XLSX, wb);              // setup schedule with a NEW section?
            if (setup) return;
            var ws = wb.Sheets[wb.SheetNames[0]];
            var rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '', blankrows: false });
            students = parseRows(XLSX, rows);
          });
        }).then(function () {
          if (setup) return importSetup(f, setup);
          if (!students.length) return ctx.messageBox('No data found in the Excel file.', 'SMEAG', 'OK', 'warning');
          return ctx.messageBox('Import ' + students.length + ' students from "' + f.name + '"?', 'Confirm Import', 'YesNo', 'question').then(function (ans) {
            if (ans !== 'Yes') return;
            return ctx.api.request('POST', '/api/office/people', { people: students }).then(function (res) {
              var n = res && res.people ? res.people.length : students.length;
              return ctx.messageBox('Successfully imported ' + n + ' students from Excel!', 'SMEAG', 'OK', 'info');
            });
          });
        }).catch(OfficeKit.fail(ctx, 'Excel Import Error'));
      }

      // Setup schedule: NEW section only -> server preview (duplicates marked) -> confirm -> create -> IMPORTED LIST
      function importSetup(f, setup) {
        var campus = cbCampus.value || campusFromText(f.name) ||
          campusFromText(setup.students.map(function (s) { return s.course; }).join(' '));
        if (!campus) return ctx.messageBox('Select the Campus first (the campus is not in the file name).', 'SMEAG', 'OK', 'warning');
        if (!setup.students.length) return ctx.messageBox('The NEW section has no students.', 'SMEAG', 'OK', 'warning');
        var body = { campus: campus, fileName: f.name, students: setup.students };
        return ctx.api.request('POST', '/api/office/people/import-new', Object.assign({ dryRun: true }, body)).then(function (pre) {
          return previewDialog(ctx, f.name, pre, setup.skipped).then(function (ok) {
            if (!ok) return;
            return ctx.api.request('POST', '/api/office/people/import-new', body).then(function (res) {
              var made = res.students.filter(function (s) { return s.status === 'created'; }).length;
              var dup = res.students.length - made;
              return ctx.messageBox('Created ' + made + ' new students (' + res.campus + ').' +
                (dup ? '\nSkipped ' + dup + ' duplicates.' : '') + '\n\nCard UID is empty: tap each card in MODIFY INFO.', 'SMEAG', 'OK', 'info')
                .then(function () { var d = OfficeKit.iso(new Date()); return showImported(ctx, { from: d, to: d }); });
            });
          });
        });
      }

      // NFC tap (HandleNfcUid): put the card UID in the box; warn when the card already belongs to a student
      return {
        onNfc: function (uid) {
          if (btnRegister.disabled) return;
          txtUid.value = uid;
          ctx.api.request('GET', '/api/office/people?uid=' + encodeURIComponent(uid)).then(function (res) {
            var p = res && res.people && res.people[0];
            if (!p) { txtName.focus(); return; }
            return ctx.messageBox('This card is already registered.\n\nName: ' + (p.name || '-') + '\nStudent ID: ' + (p.studentId || '-') +
              '\nCampus: ' + (p.campus || '-') + '\nBalance: ' + OfficeKit.money(p.totalMoney) + ' PHP', 'NFC UID', 'OK', 'warning');
          }, function () { /* lookup failed: the register step still checks duplicates */ });
        }
      };
    },
    show: function () {}
  };

  /* ---------- Excel helpers ---------- */
  var SHEETJS = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  var sheetJsPromise = null;
  function loadSheetJs() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (sheetJsPromise) return sheetJsPromise;
    sheetJsPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = SHEETJS;
      s.onload = function () { if (window.XLSX) resolve(window.XLSX); else { sheetJsPromise = null; reject(new Error('Cannot load the Excel reader.')); } };
      s.onerror = function () { sheetJsPromise = null; s.remove(); reject(new Error('Cannot load the Excel reader (check the internet connection).')); };
      document.head.appendChild(s);
    });
    return sheetJsPromise;
  }
  function readFile(f) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(new Uint8Array(r.result)); };
      r.onerror = function () { reject(new Error('Cannot read the file.')); };
      r.readAsArrayBuffer(f);
    });
  }
  function pad(n) { return ('0' + n).slice(-2); }
  // Excel serial number / Date / "YYYY-MM-DD" / "M/D/YYYY" -> "YYYY-MM-DD"
  function excelDate(XLSX, v, label, line) {
    if (v === '' || v == null) throw new Error('Row ' + line + ': ' + label + ' is empty.');
    if (v instanceof Date) return v.getFullYear() + '-' + pad(v.getMonth() + 1) + '-' + pad(v.getDate());
    if (typeof v === 'number') {
      var d = XLSX.SSF.parse_date_code(v);
      if (d && d.y) return d.y + '-' + pad(d.m) + '-' + pad(d.d);
    }
    var s = String(v).trim(), m;
    if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s))) return m[1] + '-' + pad(m[2]) + '-' + pad(m[3]);
    if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s))) return m[3] + '-' + pad(m[1]) + '-' + pad(m[2]);
    throw new Error('Row ' + line + ': ' + label + ' "' + s + '" is not a date.');
  }
  function str(v) { return v == null ? '' : String(v).trim(); }

  /* ---------- setup schedule ("Capital setup 2026Nov19.xlsx") ----------
     Sections are labelled in a column left of NAME: NEW / extend / transfer campus / room change.
     Only the NEW section is imported; its header row has NAT, NAME, age, sex, D-DAY, BEFORE (room), STUDY PERIOD, COURSE.
     Returns null when no sheet has a NEW section (-> old 10-column template). */
  var HEADS = {
    nat: /^nat/i, name: /^name$/i, age: /^age$/i, sex: /^(sex|gender)$/i, dday: /^d-?\s*day$/i,
    room: /^(before|room)$/i, period: /^study\s*peri/i, course: /^course/i
  };
  function parseSetup(XLSX, wb) {
    for (var s = 0; s < wb.SheetNames.length; s++) {
      var rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[s]], { header: 1, raw: true, defval: '', blankrows: true });
      var newAt = -1;
      for (var i = 0; i < rows.length && newAt < 0; i++) {
        for (var k = 0; k < (rows[i] || []).length; k++) if (/^new$/i.test(str(rows[i][k]))) { newAt = i; break; }
      }
      if (newAt < 0) continue;
      var col = null, headAt = -1;
      for (var h = newAt; h < Math.min(rows.length, newAt + 6) && !col; h++) col = headerMap(rows[h]), headAt = h;
      for (h = newAt - 1; h >= 0 && !col; h--) col = headerMap(rows[h]), headAt = newAt;
      if (!col) throw new Error('Sheet "' + wb.SheetNames[s] + '": the NEW section has no NAME header row.');
      var out = [], skipped = {}, section = 'NEW';
      for (i = headAt + 1; i < rows.length; i++) {
        var r = rows[i] || [], cells = [];
        for (k = 0; k < r.length; k++) if (str(r[k]) !== '') cells.push(k);
        if (!cells.length) continue;
        var name = str(r[col.name]);
        if (!name) {
          // a lone label left of the NAME column starts the next section (extend, transfer campus, room change ...)
          if (cells.length === 1 && cells[0] < col.name && /[a-z]/i.test(str(r[cells[0]]))) section = str(r[cells[0]]);
          continue;
        }
        if (section !== 'NEW') { skipped[section] = (skipped[section] || 0) + 1; continue; }
        if (/^name$/i.test(name)) continue;
        if (r.some(function (v) { return /extend|연장|room\s*change|방\s*변경/i.test(str(v)); })) { skipped.extend = (skipped.extend || 0) + 1; continue; }
        var line = i + 1;
        var dday = str(r[col.dday]) === '' ? null : excelDate(XLSX, r[col.dday], 'D-DAY', line);
        var per = periodDates(XLSX, r[col.period], dday, line);
        var age = str(r[col.age]);
        out.push({
          name: name, nat: str(r[col.nat]), age: age === '' || isNaN(Number(age)) ? null : Math.round(Number(age)),
          gender: str(r[col.sex]), room: str(r[col.room]), course: str(r[col.course]),
          startDate: per.start || dday, endDate: per.end, line: line
        });
        if (!out[out.length - 1].startDate || !out[out.length - 1].endDate) throw new Error('Row ' + line + ' (' + name + '): cannot read the study period.');
      }
      return { students: out, skipped: skipped, sheet: wb.SheetNames[s] };
    }
    return null;
  }
  function headerMap(r) {
    if (!r) return null;
    var m = {};
    for (var k = 0; k < r.length; k++) {
      var t = str(r[k]);
      Object.keys(HEADS).forEach(function (key) { if (m[key] == null && HEADS[key].test(t)) m[key] = k; });
    }
    return m.name != null ? m : null;
  }
  // "2026-11-22~2026-12-19" or "11-22~12-19" (year from D-DAY; end rolls into next year when needed)
  function periodDates(XLSX, v, dday, line) {
    var s = str(v);
    if (!s) return {};
    var parts = s.split(/\s*~\s*/);
    var year = dday ? +dday.slice(0, 4) : new Date().getFullYear();
    function one(p, prev) {
      var m;
      if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(p))) return m[1] + '-' + pad(m[2]) + '-' + pad(m[3]);
      if ((m = /^(\d{1,2})[-/.](\d{1,2})$/.exec(p))) {
        var d = year + '-' + pad(m[1]) + '-' + pad(m[2]);
        if (prev && d < prev) d = (year + 1) + '-' + pad(m[1]) + '-' + pad(m[2]);
        return d;
      }
      throw new Error('Row ' + line + ': study period "' + s + '" is not "start~end".');
    }
    var start = one(parts[0]);
    return { start: start, end: parts[1] ? one(parts[1], start) : null };
  }
  function campusFromText(t) {
    t = String(t || '');
    if (/baydream\s*-?\s*1/i.test(t)) return 'Baydream1';
    if (/baydream\s*-?\s*2/i.test(t)) return 'Baydream2';
    var m = /(capital|encanto|tarlac|talrac)/i.exec(t);
    if (!m) return '';
    return { capital: 'Capital', encanto: 'Encanto', tarlac: 'Tarlac', talrac: 'Tarlac' }[m[1].toLowerCase()];
  }

  var X_BTN = '<button class="dlg-x" tabindex="-1"><svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 0L10 10M10 0L0 10" stroke="currentColor" stroke-width="1.1"/></svg></button>';
  function statusCell(s) {
    var color = { 'new': '#0B7A2A', created: '#0B7A2A', duplicate: '#B00020' }[s] || '#000';
    var label = { 'new': 'NEW', created: 'CREATED', duplicate: 'DUPLICATE (skip)' }[s] || s;
    return '<b style="color:' + color + '">' + label + '</b>';
  }
  var PREVIEW_COLS = [
    { key: 'status', header: 'Status', width: 130, render: function (r) { return statusCell(r.status); } },
    { key: 'name', header: 'Name', width: 230 },
    { key: 'nat', header: 'Nat', width: 50 },
    { key: 'age', header: 'Age', width: 45, align: 'right' },
    { key: 'gender', header: 'Gender', width: 65 },
    { key: 'room', header: 'Room', width: 70 },
    { key: 'startDate', header: 'Start', width: 95 },
    { key: 'endDate', header: 'End', width: 95 },
    { key: 'course', header: 'Course', width: 230 },
    { key: 'note', header: 'Note', width: 420 }
  ];

  // resolves true when the user presses Import
  function previewDialog(ctx, fileName, pre, skipped) {
    var esc = OfficeKit.esc, list = pre.students || [];
    var fresh = list.filter(function (s) { return s.status === 'new'; }).length;
    var dup = list.length - fresh;
    var skip = Object.keys(skipped || {}).map(function (k) { return k + ' ' + skipped[k]; }).join(', ');
    var html = '<div class="dlg-title">IMPORT NEW STUDENTS — ' + esc(fileName) + ' — ' + esc(pre.campus) + X_BTN + '</div>' +
      '<div class="rdt-bar"><span class="rdt-sum">NEW section: ' + list.length + ' · to create ' + fresh + ' · duplicates ' + dup + '</span>' +
      (skip ? '<span>Not imported (other sections): ' + esc(skip) + '</span>' : '') + '</div>' +
      '<div class="rdt-grid reg-imp-grid" data-r="grid"></div>' +
      '<div class="mb-foot"><span class="rdt-note">Duplicates are skipped. New students get a Student ID and no card UID.</span>' +
      '<button class="w10btn def" data-r="ok"' + (fresh ? ' data-autofocus' : ' disabled') + '>Create ' + fresh + ' students</button>' +
      '<button class="w10btn" data-r="cancel"' + (fresh ? '' : ' data-autofocus') + '>Cancel</button></div>';
    return ctx.openDialog(html, function (dlg, close) {
      function r(k) { return dlg.querySelector('[data-r="' + k + '"]'); }
      OfficeKit.grid(r('grid'), { columns: PREVIEW_COLS, select: 'row', rowHeight: 26, font: '12px' }).setRows(list);
      r('ok').addEventListener('click', function () { close(true); });
      r('cancel').addEventListener('click', function () { close(false); });
      return { cancelValue: false };
    });
  }

  var IMPORTED_COLS = [
    { key: 'importedAt', header: 'Imported', width: 140 },
    { key: 'name', header: 'Name', width: 220 },
    { key: 'studentId', header: 'Student ID', width: 100 },
    { key: 'uid', header: 'Card UID', width: 120, render: function (r) {
      return r.removed ? '<i style="color:#888">deleted</i>' : r.uid ? OfficeKit.esc(r.uid) : '<b style="color:#B05A00">no card</b>';
    } },
    { key: 'campus', header: 'Campus', width: 80 },
    { key: 'nat', header: 'Nat', width: 50 },
    { key: 'age', header: 'Age', width: 45, align: 'right' },
    { key: 'gender', header: 'Gender', width: 65 },
    { key: 'room', header: 'Room', width: 70 },
    { key: 'startDate', header: 'Start', width: 95 },
    { key: 'endDate', header: 'End', width: 95 },
    { key: 'course', header: 'Course', width: 200 },
    { key: 'importedBy', header: 'By', width: 80 },
    { key: 'fileName', header: 'File', width: 220 }
  ];

  // IMPORTED LIST: students created by the setup import (person_import), by import day
  function showImported(ctx, opt) {
    var esc = OfficeKit.esc, today = OfficeKit.iso(new Date());
    var from0 = opt.from || OfficeKit.iso(new Date(Date.now() - 30 * 86400000)), to0 = opt.to || today;
    var html = '<div class="dlg-title">IMPORTED LIST — new students created by IMPORT FROM EXCEL' + X_BTN + '</div>' +
      '<div class="rdt-bar"><label>From <input type="date" data-r="from" value="' + esc(from0) + '"></label>' +
      '<label>To <input type="date" data-r="to" value="' + esc(to0) + '"></label>' +
      '<label>Campus <select data-r="campus"><option value="">All</option><option>Capital</option><option>Encanto</option>' +
      '<option>Tarlac</option><option>Baydream1</option><option>Baydream2</option></select></label>' +
      '<label><input type="checkbox" data-r="nocard"> No card only</label>' +
      '<button class="w10btn" data-r="search">Search</button><span class="rdt-sum" data-r="sum"></span></div>' +
      '<div class="rdt-grid reg-imp-grid" data-r="grid"></div>' +
      '<div class="mb-foot"><span class="rdt-note" data-r="note"></span>' +
      '<button class="w10btn" data-r="xls">Export Excel</button><button class="w10btn def" data-r="close" data-autofocus>Close</button></div>';
    return ctx.openDialog(html, function (dlg, close) {
      function r(k) { return dlg.querySelector('[data-r="' + k + '"]'); }
      var grid = OfficeKit.grid(r('grid'), { columns: IMPORTED_COLS, select: 'row', rowHeight: 26, font: '12px' });
      var all = [];
      function render() {
        var rows = r('nocard').checked ? all.filter(function (x) { return !x.uid && !x.removed; }) : all;
        grid.setRows(rows);
        var nocard = all.filter(function (x) { return !x.uid && !x.removed; }).length;
        r('sum').textContent = rows.length + ' students' + (nocard ? ' · ' + nocard + ' without card' : '');
      }
      function load() {
        var qs = '?from=' + encodeURIComponent(r('from').value || today) + '&to=' + encodeURIComponent(r('to').value || today) +
          (r('campus').value ? '&campus=' + encodeURIComponent(r('campus').value) : '');
        r('note').textContent = 'Loading...';
        return ctx.api.request('GET', '/api/office/people/imports' + qs).then(function (res) {
          all = res.imports || [];
          r('note').textContent = res.truncated ? 'List truncated.' : '';
          render();
        }, function (err) { r('note').textContent = ''; return OfficeKit.fail(ctx, 'IMPORTED LIST')(err); });
      }
      r('search').addEventListener('click', function () { OfficeKit.busy(r('search'), load()); });
      r('nocard').addEventListener('change', render);
      r('close').addEventListener('click', function () { close(); });
      r('xls').addEventListener('click', function () {
        OfficeKit.busy(r('xls'), OfficeKit.downloadXlsx('Imported_Students_' + r('from').value + '_' + r('to').value + '.xlsx', [{
          name: 'Imported', title: ['IMPORTED NEW STUDENTS', r('from').value + ' ~ ' + r('to').value],
          columns: IMPORTED_COLS.map(function (c) { return c.key === 'uid' ? { key: 'uid', header: 'Card UID', width: 120 } : c; }),
          rows: grid.rows()
        }])).catch(OfficeKit.fail(ctx, 'Export Excel'));
      });
      load();
      return {};
    });
  }

  function parseRows(XLSX, rows) {
    var out = [];
    for (var i = 1; i < rows.length; i++) {          // Skip(1): header row
      var r = rows[i] || [];
      var used = false;
      for (var k = 0; k < 10; k++) if (str(r[k]) !== '') used = true;
      if (!used) continue;                            // RowsUsed(): ignore blank lines
      var line = i + 1;
      var p = {
        uid: str(r[0]), studentId: str(r[1]), name: str(r[2]),
        // r[3] = photo column of the template: not used on import
        age: str(r[4]) === '' ? 0 : Number(str(r[4]).replace(/,/g, '')),
        gender: str(r[5]), campus: str(r[6]),
        startDate: excelDate(XLSX, r[7], 'Start date', line),
        endDate: excelDate(XLSX, r[8], 'End date', line),
        totalMoney: str(r[9]) === '' ? 0 : Number(str(r[9]).replace(/,/g, ''))
      };
      if (!p.uid || !p.studentId || !p.name) throw new Error('Row ' + line + ': Please fill required fields (UID, ID, Name)');
      if (!isFinite(p.age) || Math.floor(p.age) !== p.age) throw new Error('Row ' + line + ': Age "' + str(r[4]) + '" is not a whole number.');
      if (!isFinite(p.totalMoney)) throw new Error('Row ' + line + ': Total money "' + str(r[9]) + '" is not a number.');
      out.push(p);
    }
    return out;
  }
})();
