/* IDCARD tab — registers window.OfficeTabs['IDCARD'] (see showPage() in office.js).
   Port of the WinForms IdCardControl.cs: SEARCH (GET /api/office/people) -> check rows -> ADD to the print list ->
   DOWNLOAD PDF renders the cards like Services/IdCardPdfService.cs (Big 3x3 / Small 2x3 per A4) via OfficeKit.printDoc. */
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

  var CAMPUSES = ['All', 'Capital', 'Encanto', 'Tarlac', 'Baydream1', 'Baydream2'];

  // absolute base URL of this script's folder (print iframe documents need absolute image URLs)
  var BASE = (function () {
    var src = document.currentScript && document.currentScript.src;
    return src ? src.replace(/[^\/]*$/, '') : new URL('tabs/', document.baseURI).href;
  })();
  var LOGO = BASE + 'idcard/smeag-logo.png';
  var DEFAULT_PHOTO = BASE + 'human.png';

  /* ---------- IdCardPdfService.cs ---------- */
  var DISCLAIMER = 'This card is an exclusive property\nof SMEAG. PLEASE return it\nfound. Must be surrendered upon\nseparation from the company.';
  function lc(s) { return String(s || '').toLowerCase(); }
  function bgColor(p) {
    var adult = Number(p.age) >= 19;
    if (lc(p.campus) === 'capital') return adult ? '#FF7F50' : '#FFFF00';
    if (lc(p.campus) === 'encanto') return adult ? '#C9C351' : '#FFFF00';
    return '#E6E6E6';
  }
  function campusName(c) {
    if (lc(c) === 'capital') return '1st CAMPUS CAPITAL';
    if (lc(c) === 'encanto') return '2nd CAMPUS ENCANTO';
    return String(c || '').toUpperCase();
  }
  function campusAddress(c) {
    if (lc(c) === 'capital') return 'Emillio Osmena cor., Bataan St,\nGuadalupe, Cebu City, Cebu 6000,\nPhilippines\nOffice: 032)520-9208\nGuard House: 032)412-4787';
    if (lc(c) === 'encanto') return 'Datang Baybayon,\nMaribago, Lapu-Lapu City,\n6015 Cebu SMEAG 2nd Campus.\nFront desk:\n09310700508';
    return '';
  }
  // resolves to the uploaded photo when it loads, else the default human.png (ResolvePhotoPath)
  function resolvePhoto(url) {
    return new Promise(function (resolve) {
      if (!url) { resolve(DEFAULT_PHOTO); return; }
      var img = new Image();
      var t = setTimeout(function () { resolve(DEFAULT_PHOTO); }, 8000);
      img.onload = function () { clearTimeout(t); resolve(url); };
      img.onerror = function () { clearTimeout(t); resolve(DEFAULT_PHOTO); };
      img.src = url;
    });
  }
  var CARD_CSS =
    '@page{size:A4 portrait;margin:15pt;}' +
    'body{margin:0;font-family:"Segoe UI",Arial,sans-serif;color:#000;-webkit-print-color-adjust:exact;print-color-adjust:exact;}' +
    '.pg{page-break-after:always;break-after:page;} .pg:last-child{page-break-after:auto;break-after:auto;}' +
    '.row{display:flex;gap:8pt;margin-bottom:8pt;}' +
    '.card{box-sizing:border-box;border:.75pt solid #000;overflow:hidden;display:flex;page-break-inside:avoid;}' +
    '.card.big{width:152.25pt;height:240.75pt;flex-direction:column;}' +
    '.card.small{width:243pt;height:188.25pt;flex-direction:row;}' +
    '.half{width:50%;display:flex;flex-direction:column;} .half.front{border-right:.375pt solid #000;}' +
    '.it{flex:none;display:flex;align-items:center;justify-content:center;text-align:center;overflow:hidden;white-space:nowrap;}' +
    '.blk{background:#000;color:#FFF;font-weight:700;} .wht{background:#FFF;font-weight:700;}' +
    '.b{font-weight:700;} .pre{white-space:pre-line;line-height:1.2;}' +
    '.photo{width:75pt;height:75pt;box-sizing:border-box;border:.75pt solid #000;background:#FFF;display:block;}' +
    '.photo img{width:100%;height:100%;display:block;object-fit:fill;}' +
    '.sp{flex:1 1 auto;}' +
    '.logo img{object-fit:contain;display:block;}';
  function it(h, cls, style, inner) {
    return '<div class="it ' + (cls || '') + '" style="height:' + h + 'pt;' + (style || '') + '">' + (inner || '') + '</div>';
  }
  // Long names ("CHEN I WEN(supporter)(Encanto campus)") used to be clipped on one line:
  // wrap onto at most 2 lines (never inside a "(...)" group) and shrink the font until the measured text fits.
  var measureCtx = null;
  function nameLines(tokens, fs, widthPt) {
    if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
    measureCtx.font = '700 ' + fs + 'pt "Segoe UI",Arial,sans-serif';
    var maxPx = widthPt * 4 / 3 * 0.96, lines = 1, cur = '';
    for (var i = 0; i < tokens.length; i++) {
      var next = cur + tokens[i];
      if (cur && measureCtx.measureText(next.trim()).width > maxPx) { lines++; cur = tokens[i].replace(/^\s+/, ''); }
      else cur = next;
      if (measureCtx.measureText(cur.trim()).width > maxPx) lines++; // a single token wider than the line
    }
    return lines;
  }
  function nameIt(name, base, minH, padPt, widthPt) {
    var n = String(name || ''), fs = base;
    // break points: before each "(...)" group and at spaces outside the groups
    var tokens = n.match(/\s*\([^()]*\)|\s*[^\s(]+/g) || [n];
    while (fs > base * 0.6 && nameLines(tokens, fs, widthPt - 2 * padPt) > 2) fs -= 0.25;
    var html = OfficeKit.esc(n).replace(/\([^()]*\)/g, function (g) { return '<wbr><span style="white-space:nowrap">' + g + '</span>'; });
    return '<div class="it b" style="height:auto;min-height:' + minH + 'pt;max-height:' + (fs * 2.3).toFixed(2) + 'pt;' +
      'white-space:normal;overflow-wrap:anywhere;line-height:1.1;padding:0 ' + padPt + 'pt;font-size:' + fs.toFixed(2) + 'pt"><div>' + html + '</div></div>';
  }
  function gap(h) { return '<div style="flex:none;height:' + h + 'pt"></div>'; }
  function photoBox(src) { return '<div class="photo"><img src="' + OfficeKit.esc(src) + '"></div>'; }
  function logo(w, h, boxH) {
    return it(boxH, 'logo', '', '<img src="' + LOGO + '" style="width:' + w + 'pt;height:' + h + 'pt">');
  }
  function bigCard(p) {
    var esc = OfficeKit.esc;
    return '<div class="card big" style="background:' + bgColor(p) + '">' +
      it(18, 'blk', 'font-size:8.25pt', 'SMEAG GLOBAL EDUCATION') +
      it(14, 'wht', 'font-size:7.5pt', '( ' + esc(campusName(p.campus)) + ' )') +
      gap(14) + it(75, '', '', photoBox(p.photoSrc)) + gap(8) +
      nameIt(p.name, 9.75, 12, 4, 150.75) + gap(4) +
      it(11, 'b', 'font-size:9pt', esc(p.studentId)) + gap(4) +
      it(36, 'b pre', 'font-size:7.5pt;padding:0 4pt', esc(DISCLAIMER)) +
      '<div class="sp"></div>' + logo(78.75, 18.75, 24.75) + '</div>';
  }
  function smallCard(p) {
    var esc = OfficeKit.esc;
    return '<div class="card small" style="background:' + bgColor(p) + '">' +
      '<div class="half front">' +
      it(16.5, 'blk', 'font-size:6.75pt', 'SMEAG GLOBAL EDUCATION') +
      it(12, 'wht', 'font-size:6pt', '( ' + esc(campusName(p.campus)) + ' )') +
      gap(12.5) + it(75, '', '', photoBox(p.photoSrc)) + gap(6) +
      nameIt(p.name, 8.25, 12, 3, 120.75) + gap(4.5) +
      it(10.5, 'b', 'font-size:7.5pt', esc(p.studentId)) +
      '<div class="sp"></div>' + logo(71.25, 15, 19.5) + '</div>' +
      '<div class="half">' +
      it(16.5, 'blk', 'font-size:6.75pt', 'SMEAG GLOBAL EDUCATION') + gap(7.5) +
      // half-card text wraps more than in QuestPDF (narrower Segoe UI there): let these blocks grow instead of clipping
      it(52, 'pre', 'height:auto;min-height:52pt;white-space:pre-line;font-size:7.5pt;padding:0 3pt', esc(campusAddress(p.campus))) + gap(6) +
      it(36, 'b pre', 'height:auto;min-height:36pt;font-size:7.5pt;padding:0 3.75pt', esc(DISCLAIMER)) +
      '<div class="sp"></div>' + logo(71.25, 15, 19.5) + '</div></div>';
  }
  function cardsHtml(list, big) {
    var perPage = big ? 9 : 6, cols = big ? 3 : 2, html = '';
    for (var p = 0; p < list.length; p += perPage) {
      var page = list.slice(p, p + perPage);
      html += '<div class="pg">';
      for (var r = 0; r < page.length; r += cols) {
        html += '<div class="row">' + page.slice(r, r + cols).map(big ? bigCard : smallCard).join('') + '</div>';
      }
      html += '</div>';
    }
    return html;
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function isoDate(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

  window.OfficeTabs = window.OfficeTabs || {};
  window.OfficeTabs['IDCARD'] = {
    mount: function (root, ctx) {
      var k = kit(makePage(root));

      /* ---- pnlHeader (Dock Top, 110, white): title + FlowLayoutPanel at (15,50) ---- */
      k.box('g3-top', 0, 0, 1698, 110);
      var title = k.lbl('ID CARD ISSUANCE', 21, 25.5, 'b navy');
      title.style.fontSize = '20.5px'; title.style.height = '28px'; title.style.lineHeight = '28px'; title.style.top = '11.5px';
      k.lbl('UID:', 29, 67.5);
      var txtUid = k.txt(70, 53, 110, 25, 'NFC UID');
      k.lbl('Name:', 196, 67.5);
      var txtName = k.txt(249, 53, 120, 25, 'Name');
      k.lbl('Campus:', 385, 67.5);
      var cbCampus = k.combo(451, 53, 110, 25, CAMPUSES, 'All');
      k.lbl('Age:', 578, 67.5);
      var txtAge = k.txt(619, 53, 60, 25, 'Age');
      var chkReg = k.chk('Reg. Date', 691, 58);
      var dtpReg = k.dtp(786, 53, 120, 25, new Date());
      var btnSearch = k.btn('SEARCH', 924, 50, 100, 32, '#0078D7');
      var btnAdd = k.btn('ADD', 1034, 50, 100, 32, '#0099BC');

      /* ---- pnlGrid (Fill, padding 15/0/15/15): TableLayoutPanel rows 28 / 50% / 28 / 50% ---- */
      k.lbl('SEARCH RESULTS', 22, 128.5, 'b navy').style.fontSize = '12.67px';
      var gStudents = OfficeKit.grid(k.box('g3-white', 18, 141, 1662, 308), {
        select: 'multi', rowHeight: 28, font: '12px',
        columns: [
          { key: 'id', header: 'ID', width: 60 },
          { key: 'studentId', header: 'STUDENT ID', width: 150 },
          { key: 'name', header: 'NAME', width: 300 },
          { key: 'age', header: 'AGE', width: 60, format: 'int' },
          { key: 'gender', header: 'GENDER', width: 80 },
          { key: 'campus', header: 'CAMPUS', width: 120 },
          { key: 'startDate', header: 'START DATE', width: 130 },
          { key: 'endDate', header: 'END DATE', width: 130 },
          { key: 'totalMoney', header: 'BALANCE', width: 120, align: 'right', format: 'money' },
          { key: 'registerDate', header: 'REG. DATE', width: 180 }
        ]
      });
      k.lbl('PRINT LIST', 22, 470.5, 'b navy').style.fontSize = '12.67px';
      // dgvAddedStudents is bound to a BindingList<StudentDto>, so its headers show from the start.
      var gAdded = OfficeKit.grid(k.box('g3-white', 18, 483, 1662, 309), {
        select: 'row', rowHeight: 28, font: '12px',
        columns: [
          { key: 'id', header: 'ID', width: 44 },
          { key: 'studentId', header: 'STUDENT ID', width: 395 },
          { key: 'name', header: 'NAME', width: 396 },
          { key: 'age', header: 'AGE', width: 53, format: 'int' },
          { key: 'campus', header: 'CAMPUS', width: 714 }
        ],
        onDblClick: function (row) { removeAdded(row); }
      });
      var added = [];

      /* ---- pnlBottom (Dock Bottom, 65) ---- */
      k.box('g3-bar', 0, 810, 1698, 65);
      wlbl(k, 'Card Size:', 20, 22 + 810, 'b');
      var cbSize = k.combo(105, 827, 110, 25, ['Big', 'Small'], 'Big');
      var dl = k.btn('DOWNLOAD PDF', 235, 824, 150, 36, '#008000');
      dl.style.fontSize = '13.75px';
      var btnFolder = k.btn('PDF FOLDER', 395, 824, 130, 36, '#0078D7');

      txtAge.addEventListener('input', function () { var v = this.value.replace(/\D/g, ''); if (v !== this.value) this.value = v; });
      [txtUid, txtName, txtAge].forEach(function (t) {
        t.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); search(); } });
      });

      function search() {
        var q = [];
        if (txtUid.value.trim()) q.push('uidLike=' + encodeURIComponent(txtUid.value.trim()));
        if (txtName.value.trim()) q.push('name=' + encodeURIComponent(txtName.value.trim()));
        if (cbCampus.selectedIndex > 0) q.push('campus=' + encodeURIComponent(cbCampus.value));
        if (/^\d+$/.test(txtAge.value.trim())) q.push('age=' + txtAge.value.trim());
        if (chkReg.checked) q.push('regDate=' + isoDate(dtpReg.value()));
        return OfficeKit.busy(btnSearch, ctx.api.request('GET', '/api/office/people' + (q.length ? '?' + q.join('&') : ''))).then(function (res) {
          gStudents.setRows(res.people || []);
          if (res.truncated) ctx.messageBox('Too many results: only the first rows are shown. Please narrow the search.', 'SMEAG', 'OK', 'warning');
        }).catch(OfficeKit.fail(ctx, 'Search Error'));
      }

      function uncheck(row) {
        var ri = gStudents.rows().indexOf(row);
        var cb = gStudents.el.querySelector('tr[data-ri="' + ri + '"] input[data-ck]');
        if (cb && cb.checked) cb.click();   // grid.js has no per-row setChecked(): toggle through the DOM
      }

      function add() {
        var rows = gStudents.checked();
        if (!rows.length) return ctx.messageBox('Please select at least one student using the checkboxes.', 'SMEAG', 'OK', 'info');
        var n = 0;
        rows.forEach(function (r) {
          if (r.id == null) return;
          if (added.some(function (a) { return a.id === r.id; })) return;
          added.push({ id: r.id, studentId: r.studentId || '', name: r.name || '', age: r.age == null ? 0 : r.age, campus: r.campus || '', photoUrl: r.photoUrl || '' });
          n++;
          uncheck(r);
        });
        if (!n) return ctx.messageBox('Selected students are already in the print list.', 'SMEAG', 'OK', 'info');
        gAdded.setRows(added);
        return null;
      }

      // not in the original (its print list is read-only with no way to remove): double-click a row to remove it
      function removeAdded(row) {
        if (!row) return;
        ctx.messageBox('Remove ' + row.name + ' from the print list?', 'SMEAG', 'YesNo', 'question').then(function (a) {
          if (a !== 'Yes') return;
          added = added.filter(function (x) { return x !== row; });
          gAdded.setRows(added);
        });
      }

      function print() {
        if (!added.length) return ctx.messageBox('Please add at least one student to the print list.', 'SMEAG', 'OK', 'info');
        var big = cbSize.value === 'Big';
        var list = added.slice();
        return OfficeKit.busy(dl, Promise.all(list.map(function (p) { return resolvePhoto(p.photoUrl); }))).then(function (srcs) {
          var cards = list.map(function (p, i) { return Object.assign({}, p, { photoSrc: srcs[i] }); });
          var d = new Date();
          var name = 'IdCard_Drafts_' + isoDate(d).replace(/-/g, '') + '_' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
          OfficeKit.printDoc(name, cardsHtml(cards, big), { landscape: false, css: CARD_CSS });
        }).catch(OfficeKit.fail(ctx, 'PDF generation error'));
      }

      btnSearch.addEventListener('click', search);
      btnAdd.addEventListener('click', add);
      dl.addEventListener('click', print);
      btnFolder.addEventListener('click', function () {
        ctx.messageBox('In the web version the PDF is saved by the browser.\n\nClick DOWNLOAD PDF and choose "Save as PDF" in the print dialog; ' +
          'the file goes to your Downloads folder (or the folder you pick).', 'SMEAG', 'OK', 'info');
      });

      // NFC tap: search this card only (other filters cleared)
      return {
        onNfc: function (uid) {
          if (btnSearch.disabled) return;
          txtUid.value = uid; txtName.value = ''; txtAge.value = ''; cbCampus.selectedIndex = 0; chkReg.checked = false;
          search();
        }
      };
    },
    show: function () {}
  };
})();
