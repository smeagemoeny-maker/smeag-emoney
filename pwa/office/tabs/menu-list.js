/* MENU LIST tab — registers window.OfficeTabs['MENU LIST'] (see showPage() in office.js).
   Screen replica of MenuListControl.cs: ADD NEW MENU panel, SEARCH FILTERS panel, UPDATE/DELETE actions, office_menus grid.
   API: GET/POST /api/office/menu-list, PATCH/DELETE /api/office/menu-list/:id (campus filter on the server,
   Main / Sub filters applied here like the original WHERE m_menu = @main AND s_menu LIKE %sub%). */
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
      },
      // Plain absolutely placed box for OfficeKit.grid (no g1-dgv class so its table CSS does not interfere)
      box: function (x, y, w, h) { return add('div', '', x, y, w, h); }
    };
  }

  var MAIN_MENUS = ['Recharge', 'AGRecharge', 'EBILL', 'Records', 'Refund', 'Souvenir', 'Visa', 'Academic', 'Admin', 'Activities', 'Diving Shop'];
  var CAMPUSES = ['CAPITAL', 'ENCANTO', 'TARLAC', 'BAYDREAM'];

  window.OfficeTabs = window.OfficeTabs || {};
  var focusMain = null;   // WinForms: the editable "Main" filter shows with its text selected (SelectedIndex = 0)

  window.OfficeTabs['MENU LIST'] = {
    mount: function (root, ctx) {
      root.classList.add('g1');
      var c = controls(root, ctx);

      // 1. pnlTop: ADD NEW MENU (Dock Top, 85, white, FixedSingle)
      c.pnl(4, 1, 1698, 85, '#FFFFFF', true);
      c.title(23, 10, 'ADD NEW MENU');
      c.lbl(35, 40, 'Campus:');
      var cbAddCampus = c.cbo(97, 30, 110, CAMPUSES, 'CAPITAL');
      c.lbl(225, 40, 'Main:');
      var cbAddMain = c.cbo(268, 30, 140, MAIN_MENUS, '', true);
      c.lbl(426, 40, 'Sub:');
      var txtAddSub = c.txt(461, 30, 140, 'Sub Menu');
      c.lbl(619, 40, 'Price:');
      var txtAddPrice = c.txt(660, 30, 70, 'Price');
      var btnAdd = c.btn(743, 27, 80, 35, 'ADD', '#0078D7', true);

      // 2. pnlSearch: SEARCH FILTERS (Dock Top, 85, 240,240,245)
      c.pnl(4, 86, 1698, 85, '#F0F0F5');
      c.title(22, 94, 'SEARCH FILTERS');
      c.lbl(34, 124, 'Campus:');
      var cbSearchCampus = c.cbo(96, 114, 110, ['ALL'].concat(CAMPUSES), 'ALL');
      c.lbl(224, 124, 'Main:');
      var cbSearchMain = c.cbo(267, 114, 140, ['ALL'].concat(MAIN_MENUS), 'ALL', true);
      c.lbl(425, 124, 'Sub:');
      var txtSearchSub = c.txt(460, 114, 140, 'Sub Menu Search');
      var btnSearch = c.btn(613, 111, 90, 35, 'SEARCH', '#009688', true);
      var btnReset = c.btn(713, 111, 80, 35, 'RESET', '#808080', true);

      // 3. pnlActions (Dock Top, 55)
      var btnUpdate = c.btn(29, 181, 160, 35, 'UPDATE SELECTED', '#2E7D32', true);
      var btnDelete = c.btn(199, 181, 160, 35, 'DELETE SELECTED', '#C62828', true);

      // 4. pnlGrid (Dock Fill, Padding 15) > dgvMenus (SELECT id, Campus, m_menu, s_menu, payment FROM office_menus)
      var grid = OfficeKit.grid(c.box(19, 241, 1668, 620), {
        columns: [
          { key: 'id', header: 'id', width: 120, format: 'int' },
          { key: 'campus', header: 'Campus', width: 300, editable: true, options: ['All'].concat(CAMPUSES) },
          { key: 'mMenu', header: 'm_menu', width: 400, editable: true },
          { key: 'sMenu', header: 's_menu', width: 500, editable: true },
          { key: 'payment', header: 'payment', width: 300, format: 'money', align: 'right', editable: true }
        ]
      });

      // Price: digits and a single '.' (like the OFFICE MENU price box)
      txtAddPrice.addEventListener('keydown', function (e) {
        if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
        if (/[0-9]/.test(e.key) || (e.key === '.' && txtAddPrice.value.indexOf('.') < 0)) return;
        e.preventDefault();
      });

      var api = ctx.api;
      var fail = OfficeKit.fail;
      function num(v) {   // decimal.TryParse(...) ? p : 0
        var n = Number(String(v == null ? '' : v).replace(/,/g, '').trim());
        return isFinite(n) && String(v).trim() !== '' ? n : 0;
      }

      // LoadMenus(): campus on the server, Main (exact) and Sub (contains) here, case-insensitive like MySQL.
      function loadMenus() {
        var campus = cbSearchCampus.value || 'ALL';
        var main = (cbSearchMain.value || '').trim();
        var sub = txtSearchSub.value.trim().toLowerCase();
        return api.request('GET', '/api/office/menu-list?campus=' + encodeURIComponent(campus)).then(function (res) {
          var rows = (res.menus || []).filter(function (m) {
            if (main && main.toUpperCase() !== 'ALL' && String(m.mMenu || '').toLowerCase() !== main.toLowerCase()) return false;
            if (sub && String(m.sMenu || '').toLowerCase().indexOf(sub) < 0) return false;
            return true;
          });
          grid.setRows(rows);
        }).catch(fail(ctx, 'Load Error'));
      }
      function search() { return OfficeKit.busy(btnSearch, loadMenus()); }

      btnSearch.addEventListener('click', search);
      txtSearchSub.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); search(); } });
      cbSearchMain.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); search(); } });
      btnReset.addEventListener('click', function () {
        cbSearchCampus.value = 'ALL';
        cbSearchMain.value = 'ALL';
        txtSearchSub.value = '';
        OfficeKit.busy(btnReset, loadMenus());
      });

      // BtnAdd_Click: INSERT (Campus, m_menu, s_menu, payment); price falls back to 0; then reload + "Menu Added!"
      btnAdd.addEventListener('click', function () {
        var body = { campus: cbAddCampus.value, mMenu: cbAddMain.value.trim(), sMenu: txtAddSub.value.trim(), payment: num(txtAddPrice.value) };
        if (!body.mMenu) { ctx.messageBox('Add Error: Main menu is required.', 'SMEAG', 'OK', 'warning').then(function () { cbAddMain.focus(); }); return; }
        if (!body.sMenu) { ctx.messageBox('Add Error: Sub menu is required.', 'SMEAG', 'OK', 'warning').then(function () { txtAddSub.focus(); }); return; }
        OfficeKit.busy(btnAdd, api.request('POST', '/api/office/menu-list', body).then(function () {
          return loadMenus().then(function () { return ctx.messageBox('Menu Added!', 'SMEAG', 'OK', 'info'); });
        }, fail(ctx, 'Add Error')));
      });

      // BtnUpdate_Click: UPDATE the current row with its (edited) cell values; then "Menu Updated!" + reload
      btnUpdate.addEventListener('click', function () {
        var row = grid.current();
        if (!row) return;
        var m = grid.merged(row);
        var body = { campus: m.campus, mMenu: m.mMenu, sMenu: m.sMenu, payment: num(m.payment) };
        OfficeKit.busy(btnUpdate, api.request('PATCH', '/api/office/menu-list/' + row.id, body).then(function () {
          return ctx.messageBox('Menu Updated!', 'SMEAG', 'OK', 'info').then(loadMenus);
        }, fail(ctx, 'Update Error')));
      });

      // BtnDelete_Click: confirm, DELETE the current row, reload
      btnDelete.addEventListener('click', function () {
        var row = grid.current();
        if (!row) return;
        ctx.messageBox('Are you sure you want to delete this menu?', 'Confirm', 'YesNo', 'question').then(function (r) {
          if (r !== 'Yes') return;
          return OfficeKit.busy(btnDelete, api.request('DELETE', '/api/office/menu-list/' + row.id).then(loadMenus, fail(ctx, 'Delete Error')));
        });
      });

      focusMain = function () { try { cbSearchMain.focus(); cbSearchMain.select(); } catch (e) { /* ignore */ } };
      loadMenus();   // constructor: LoadMenus()
    },
    show: function () { if (focusMain) setTimeout(focusMain, 0); }
  };
})();
