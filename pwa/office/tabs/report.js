/* REPORT tab — registers window.OfficeTabs['REPORT'] (see showPage() in office.js).
   Screen-only replica of the weekly report: Campus / start / end / week no. + SEARCH, five summary cards,
   WEEKLY REPORT grid + totals row, and DOWNLOAD PDF / UPDATE / OPEN PDF FOLDER / Back.
   Data: GET /api/office/report (port of ReportControl.cs BtnLoad_Click / RecalculateTotals).
   The numbers are read-only (UPDATE removed; PUT /api/office/report is refused by the server).
   Click a row -> the transactions of that day (GET /api/office/report/detail); EXPORT EXCEL -> .xlsx. */
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

  var CARDS = [['Recharge', '0.00'], ['Cash Out', '0.00'], ['Receipt', '0'], ['Store shop', '0.00'], ['Total amount of', '0.00']];
  /* hover tooltip of each card: what it counts (numbers are added after SEARCH, see cardTips()) */
  var CARD_TIPS = [
    'Recharge\nMoney loaded onto cards at the office.\n= sum of the Recharge column (AGRecharge not included).',
    'Cash Out\nCard balance paid back to students in cash.\n= sum of the CashOut column.',
    'Receipt\nAll office income of the period.\n= every office column except CashOut and Refund:\nRecharge + AGRecharge + EBILL + Records + Souvenir + Visa + Academic + Admin + Activities + Diving Shop + Massage + Car Service',
    'Store shop\nCard sales at the stores.\n= Mart + Cafe + Pusan Mart',
    'Total amount of\n= Recharge \u2212 Cash Out\n(net money added to cards; Receipt and Store shop are not part of it)'
  ];

  var PM_CARDS = ['\uCD1D\uB9E4\uCD9C Sales', '\uC6D0\uAC00 Cost', '\uC218\uC775 Profit', '\uBD80\uC0B0\uB9C8\uD2B8 50%', 'SMEAG 50%'];

  window.OfficeTabs = window.OfficeTabs || {};
  window.OfficeTabs['REPORT'] = {
    mount: function (root, ctx) {
      root.classList.add('g2-page');
      var html =
        '<div class="g2-panel" style="left:0;top:0;width:1706px;height:263px"></div>' +
        '<span class="g2-lbl f10" style="left:33px;top:26px">Campus:</span>' +
        comboHtml('campus', 'left:135px;top:21px;width:110px;height:25px', ['CAPITAL', 'ENCANTO', 'TARLAC', 'BAYDREAM', 'PUSAN MART'], 'CAPITAL') +
        dtpHtml('start', 'f10', 'left:310px;top:21px;width:110px;height:25px') +
        dtpHtml('end', 'f10', 'left:485px;top:21px;width:110px;height:25px') +
        '<input class="g2-txt" data-k="week" type="text" value="1" spellcheck="false" autocomplete="off" style="left:660px;top:21px;width:50px;height:25px">' +
        '<button class="flat g2-btn b" data-k="search" style="left:770px;top:21px;width:90px;height:30px;background:#000080;font-size:13.33px">SEARCH</button>' +
        '<span class="g2-lbl f10" style="left:885px;top:26px">Columns:</span>' +
        '<button class="g2-colpick" data-k="colpick" type="button" style="left:965px;top:21px;width:260px;height:27px"><span data-k="collbl">All columns</span><span class="g2-chev"></span></button>' +
        '<div class="g2-colpop" data-k="colpop" style="left:965px;top:50px" hidden></div>';
      CARDS.forEach(function (c, i) {
        html += '<div class="g2-card" data-tip="' + OfficeKit.esc(CARD_TIPS[i]) + '" style="left:' + (20 + i * 190) + 'px;top:76px">' +
          '<div class="g2-card-hd">' + c[0] + '</div>' +
          '<input class="g2-card-val" type="text" readonly tabindex="-1" value="' + c[1] + '"></div>';
      });
      /* Pusan Mart profit split (sales - cost = profit, 50% Pusan Mart / 50% SMEAG) */
      html += '<div class="g2-pm" data-k="pm" hidden><span class="g2-pm-ttl">PUSAN MART PROFIT (50 : 50)</span>' +
        '<span class="g2-pm-note" data-k="pmnote"></span>';
      PM_CARDS.forEach(function (c, i) {
        html += '<div class="g2-card g2-card-sm" style="left:' + (i * 140) + 'px;top:20px">' +
          '<div class="g2-card-hd">' + c + '</div><input class="g2-card-val" type="text" readonly tabindex="-1" value="0.00"></div>';
      });
      html += '</div>';
      html +=
        '<button class="flat g2-btn" data-k="pdf" style="left:20px;top:170px;width:160px;height:40px;background:#008000">DOWNLOAD PDF</button>' +
        '<button class="flat g2-btn b" data-k="excel" style="left:190px;top:170px;width:120px;height:40px;background:#1D6F42">EXPORT EXCEL</button>' +
        '<button class="flat g2-btn" data-k="folder" style="left:320px;top:170px;width:170px;height:40px;background:#4682B4">OPEN PDF FOLDER</button>' +
        '<span class="g2-lbl" style="left:510px;top:182px;font-size:12px;color:#555">Click a row to see its transactions.</span>' +
        '<button class="flat g2-btn" data-k="back" style="left:1567px;top:170px;width:120px;height:40px;background:#808080">Back</button>' +
        '<div class="g2-title" style="top:226px">WEEKLY REPORT</div>' +
        '<div class="g2-panel g2-rep-grid" data-k="grid" style="left:20px;top:278px;width:1666px;height:540px"></div>' +
        '<div class="g2-abs g2-rep-tot" data-k="totals" style="left:20px;top:818px;width:1666px;height:40px;background:#DDDCE1"></div>';
      root.innerHTML = html;

      function q(k) { return root.querySelector('[data-k="' + k + '"]'); }
      var today = new Date(); today.setHours(0, 0, 0, 0);
      var start = new Date(today); start.setDate(start.getDate() - 6);
      var dtpStart = wireDtp(q('start'), start);
      var dtpEnd = wireDtp(q('end'), new Date(today));
      var cardVals = root.querySelectorAll('.g2-card-val');   // Recharge, Cash Out, Receipt, Store shop, Total amount
      var cards = root.querySelectorAll('.g2-card:not(.g2-card-sm)');
      var pmCards = root.querySelectorAll('.g2-card-sm'), pmVals = root.querySelectorAll('.g2-card-sm .g2-card-val');
      var pm = null;            // pusanMart block of the last SEARCH (sales / cost / profit / shares)
      function pmOn() { return !!(pm && loaded && selCats().indexOf('Pusan Mart') >= 0); }
      // the profit cards: values + hover text with how each number is made
      function showPm() {
        q('pm').hidden = !pmOn();
        if (!pmOn()) return;
        var m = OfficeKit.money, t = pm.totals, pct = Math.round(pm.share * 100);
        [t.sales, t.cost, t.profit, t.pusanShare, t.smeagShare].forEach(function (v, i) { pmVals[i].value = m(v); });
        var miss = t.missingSales > 0
          ? '\n\n\u26A0 Sales without a cost yet: ' + m(t.missingSales) +
            (t.missingPayDays ? ' (' + t.missingPayDays + ' day(s) of Pusan Pay without the typed Bizmatech "Cost Exp.")' : '') +
            (t.uncosted.length ? '\nProducts without a unit cost: ' + t.uncosted.map(function (u) { return u.name; }).join(', ') : '') +
            '\nThey are left out of the profit until the cost is entered (MART > Daily Sales).'
          : '';
        var tips = [
          'Total sales (\uCD1D\uB9E4\uCD9C)\n= the Pusan Mart column total.\nBarcode sales ' + m(t.itemSales) + ' + Pusan Pay ' + m(t.paySales) + ' = ' + m(t.sales),
          'Cost (\uC6D0\uAC00)\nBarcode sales: quantity x unit cost (Bizmatech list) = ' + m(t.itemCost) +
            '\nPusan Pay: the typed daily "Cost Exp." = ' + m(t.payCost) + '\n= ' + m(t.cost),
          'Profit (\uC218\uC775)\n= sales with a known cost \u2212 cost\n= ' + m(t.costedSales) + ' \u2212 ' + m(t.cost) + ' = ' + m(t.profit),
          'Pusan Mart share (\uBD80\uC0B0\uB9C8\uD2B8 \uC218\uC775 ' + pct + '%)\n= profit x ' + pct + '% = ' + m(t.pusanShare) +
            '\n\nPaid to Pusan Mart = cost + its share\n= ' + m(t.cost) + ' + ' + m(t.pusanShare) + ' = ' + m(t.settlement),
          'SMEAG share (SMEAG \uC218\uC775 ' + (100 - pct) + '%)\n= profit \u2212 Pusan Mart share = ' + m(t.smeagShare)
        ];
        pmCards.forEach(function (el, i) { el.setAttribute('data-tip', tips[i] + miss); el.classList.toggle('g2-pm-warn', t.missingSales > 0); });
        q('pmnote').textContent = t.missingSales > 0 ? '\u26A0 ' + m(t.missingSales) + ' sales without cost (not in profit)' : '';
      }
      // tooltips with this search's numbers: the formula of each card filled in from the TOTAL row
      function cardTips(t, v) {
        var m = OfficeKit.money;
        function parts(list) { return list.filter(function (c) { return num(t[c]) !== 0; }).map(function (c) { return c + ' ' + m(t[c]); }); }
        var rcpt = parts(OFFICE.filter(function (c) { return c !== 'CashOut' && c !== 'Refund'; }));
        var shop = parts(STORE);
        var extra = [
          '\n\nThis search: ' + m(v.rech),
          '\n\nThis search: ' + m(v.cash),
          '\n\nThis search: ' + (rcpt.length ? rcpt.join(' + ') + ' = ' : '') + m(v.receipt),
          '\n\nThis search: ' + (shop.length ? shop.join(' + ') + ' = ' : '') + m(v.store),
          '\n\nThis search: ' + m(v.rech) + ' \u2212 ' + m(v.cash) + ' = ' + m(v.rech - v.cash)
        ];
        cards.forEach(function (el, i) { el.setAttribute('data-tip', CARD_TIPS[i] + extra[i]); });
      }
      // the TOTAL row sits right under the last data row: the grid shrinks to its rows (max 540px, then it scrolls)
      var GRID_TOP = 278, GRID_MAX = 540;
      function fitGrid() {
        var g = q('grid'), tb = g.querySelector('table');
        g.style.height = GRID_MAX + 'px';
        if (!tb || !g.offsetParent) { q('totals').style.top = (GRID_TOP + GRID_MAX) + 'px'; return; }
        var h = Math.min(GRID_MAX, tb.offsetHeight + (g.offsetHeight - g.clientHeight));
        g.style.height = h + 'px';
        q('totals').style.top = (GRID_TOP + h) + 'px';
      }

      q('week').addEventListener('input', function () {
        var v = this.value.replace(/\D/g, '');
        if (v !== this.value) this.value = v;
      });

      var OFFICE = ['Recharge', 'AGRecharge', 'EBILL', 'Records', 'Refund', 'CashOut', 'Souvenir', 'Visa', 'Academic', 'Admin', 'Activities', 'Diving Shop', 'Massage', 'Car Service'];
      var STORE = ['Mart', 'Cafe', 'Pusan Mart'];
      var loaded = null;        // { campus, from, to, ref } of the last SEARCH
      var weekly = null, totals = null, adjusted = {};   // adjusted[date] = { category: true }
      var lastRows = [];        // rows of the last SEARCH (every column), re-shown when the column choice changes

      /* ---------- column choice (Columns: picker) — the grid, TOTAL row, PDF and Excel show only these ---------- */
      var PICK_KEY = 'office.report.columns';
      var picked = null;        // null = all columns, else [names]
      try { picked = JSON.parse(localStorage.getItem(PICK_KEY) || 'null'); } catch (e) { picked = null; }
      function selCats() {
        var all = OFFICE.concat(STORE);
        if (!picked) return all;
        var v = all.filter(function (c) { return picked.indexOf(c) >= 0; });
        return v.length ? v : all;
      }
      function isFiltered() { return selCats().length < OFFICE.length + STORE.length; }
      function withSum() { return isFiltered() && selCats().length > 1; }
      function colsText() { return isFiltered() ? selCats().join(', ') : 'All columns'; }

      function columnsFor(editable) {
        var cols = [{ key: 'NO', header: 'NO', width: 50, align: 'center' }, { key: 'DATE', header: 'DATE', width: 100, align: 'center' }];
        selCats().forEach(function (c) {
          cols.push({ key: c, header: c, width: 100, align: 'right', format: 'money', editable: editable });
        });
        if (withSum()) cols.push({ key: 'SUM', header: 'SUM', width: 120, align: 'right', format: 'money' });
        return cols;
      }
      function makeGrids(cats) {
        if (cats) { OFFICE = cats.office; STORE = cats.store; buildPicker(); }
        weekly = OfficeKit.grid(q('grid'), { columns: columnsFor(false), select: 'row', rowHeight: 35, font: '12px' });
        weekly.el.classList.add('g2-rep-click');
        totals = OfficeKit.grid(q('totals'), { columns: columnsFor(false), select: 'row', rowHeight: 38, font: '12px' });
      }
      // listeners on the grid containers once (makeGrids re-creates the grids inside the same elements)
      q('grid').addEventListener('click', function (e) {
        var tr = e.target.closest('tbody tr[data-ri]');
        if (!tr) return;
        var row = weekly.rows()[+tr.getAttribute('data-ri')];
        var td = e.target.closest('td[data-ci]');
        var col = td ? columnsFor(false)[+td.getAttribute('data-ci')] : null;
        var cat = col && col.format === 'money' && col.key !== 'SUM' && num(row[col.key]) !== 0 ? col.key : '';
        if (row) showDetail(row.DATE, cat);
      });
      q('grid').addEventListener('scroll', function () { totals.el.scrollLeft = weekly.el.scrollLeft; });

      function buildPicker() {
        var esc = OfficeKit.esc, sel = selCats(), all = !isFiltered();
        function box(c) {
          return '<label><input type="checkbox" value="' + esc(c) + '"' + (all || sel.indexOf(c) >= 0 ? ' checked' : '') + '>' + esc(c) + '</label>';
        }
        q('colpop').innerHTML =
          '<div class="g2-colpop-pre"><button type="button" data-p="all">All</button><button type="button" data-p="office">Office</button>' +
          '<button type="button" data-p="store">Stores</button></div>' +
          '<div class="g2-colpop-hd">Stores</div><div class="g2-colpop-grp">' + STORE.map(box).join('') + '</div>' +
          '<div class="g2-colpop-hd">Office</div><div class="g2-colpop-grp">' + OFFICE.map(box).join('') + '</div>';
        q('collbl').textContent = colsText();
        q('colpick').title = colsText();
      }
      function setPicked(list) {
        var all = OFFICE.concat(STORE);
        picked = list && list.length && list.length < all.length ? list : null;
        try { if (picked) localStorage.setItem(PICK_KEY, JSON.stringify(picked)); else localStorage.removeItem(PICK_KEY); } catch (e) {}
        buildPicker();
        makeGrids();
        if (loaded) showRows();
      }
      q('colpick').addEventListener('click', function () { q('colpop').hidden = !q('colpop').hidden; });
      q('colpop').addEventListener('change', function () {
        var list = [].map.call(q('colpop').querySelectorAll('input:checked'), function (i) { return i.value; });
        if (!list.length) { buildPicker(); return; }   // at least one column stays on
        setPicked(list);
      });
      q('colpop').addEventListener('click', function (e) {
        var p = e.target.getAttribute && e.target.getAttribute('data-p');
        if (p) setPicked(p === 'office' ? OFFICE.slice() : p === 'store' ? STORE.slice() : null);
      });
      document.addEventListener('mousedown', function (e) {
        if (!q('colpop').hidden && !e.target.closest('.g2-colpop, .g2-colpick')) q('colpop').hidden = true;
      });
      buildPicker();
      makeGrids();

      function cellValue(cat, v) { return SIGNED[cat] ? num(v) : Math.abs(num(v)); }
      function showRows() {
        var cats = selCats();
        weekly.setRows(lastRows.map(function (r) {
          if (!withSum()) return r;
          var sum = 0;
          cats.forEach(function (c) { sum += cellValue(c, r[c]); });
          return Object.assign({}, r, { SUM: sum });
        }));
        fitGrid();
        markAdjusted();
        recalc();
      }

      function num(v) {
        if (v === null || v === undefined || v === '') return 0;
        var n = Number(String(v).replace(/,/g, '').trim());
        return isNaN(n) ? 0 : n;
      }
      // current values of every row, pending cell edits applied (no edit in progress when called)
      function currentRows() {
        var ed = weekly.edited();
        return weekly.rows().map(function (r) {
          for (var i = 0; i < ed.length; i++) if (ed[i].row === r) return Object.assign({}, r, ed[i].changes);
          return r;
        });
      }
      function markAdjusted() {
        var cols = columnsFor(false);
        weekly.el.querySelectorAll('tbody tr[data-ri]').forEach(function (tr) {
          var row = weekly.rows()[+tr.getAttribute('data-ri')];
          var adj = row && adjusted[row.DATE];
          if (!adj) return;
          tr.querySelectorAll('td[data-ci]').forEach(function (td) {
            var c = cols[+td.getAttribute('data-ci')];
            if (c && adj[c.key] && !td.classList.contains('g2-adj')) td.classList.add('g2-adj');
          });
        });
      }

      var SIGNED = { 'Massage': true, 'Car Service': true };
      /* RecalculateTotals(): column sums of |value|; Receipt = every office column except CashOut and Refund.
         Massage / Car Service are summed with their sign (a refund day is negative). */
      function recalc() {
        if (!loaded) return;
        var rows = currentRows();
        var t = { NO: 'TOTAL', DATE: '-' };
        var rech = 0, cash = 0, receipt = 0, store = 0;
        OFFICE.forEach(function (cat) {
          var s = 0;
          rows.forEach(function (r) { s += SIGNED[cat] ? num(r[cat]) : Math.abs(num(r[cat])); });
          t[cat] = s;
          if (cat === 'Recharge') rech += s;
          if (cat === 'CashOut') cash += s;
          else if (cat !== 'Refund') receipt += s;
        });
        STORE.forEach(function (cat) {
          var s = 0;
          rows.forEach(function (r) { s += Math.abs(num(r[cat])); });
          t[cat] = s;
          store += s;
        });
        if (withSum()) t.SUM = selCats().reduce(function (s, c) { return s + t[c]; }, 0);
        totals.setRows([t]);
        cardVals[0].value = OfficeKit.money(Math.abs(rech));
        cardVals[1].value = OfficeKit.money(Math.abs(cash));
        cardVals[2].value = OfficeKit.money(Math.abs(receipt));
        cardVals[3].value = OfficeKit.money(Math.abs(store));
        cardVals[4].value = OfficeKit.money(rech - cash);
        cardTips(t, { rech: Math.abs(rech), cash: Math.abs(cash), receipt: Math.abs(receipt), store: Math.abs(store) });
        showPm();
      }

      function load() {
        var campus = q('campus').value;
        var from = isoDate(dtpStart.get()), to = isoDate(dtpEnd.get());
        if (to < from) to = from;   // original: dayCount < 1 -> 1 day
        var maxTo = new Date(dtpStart.get()); maxTo.setDate(maxTo.getDate() + 99);
        if (to > isoDate(maxTo)) to = isoDate(maxTo); // original: dayCount > 100 -> 100 days
        var path = '/api/office/report?campus=' + encodeURIComponent(campus) + '&from=' + from + '&to=' + to;
        return OfficeKit.busy(q('search'), ctx.api.request('GET', path)).then(function (res) {
          var cats = { office: res.officeCategories || OFFICE, store: res.storeCategories || STORE };
          if (cats.office.join('|') !== OFFICE.join('|') || cats.store.join('|') !== STORE.join('|')) makeGrids(cats);
          adjusted = {};
          var rows = (res.days || []).map(function (d) {
            var r = { NO: String(d.no), DATE: d.date };
            OFFICE.concat(STORE).forEach(function (c) { r[c] = d.values && d.values[c] != null ? Number(d.values[c]) : 0; });
            if (d.adjusted && d.adjusted.length) {
              adjusted[d.date] = {};
              d.adjusted.forEach(function (c) { adjusted[d.date][c] = true; });
            }
            return r;
          });
          pm = res.pusanMart || null;
          loaded = { campus: campus, from: from, to: res.days && res.days.length ? res.days[res.days.length - 1].date : to };
          lastRows = rows;
          showRows();
        }).catch(OfficeKit.fail(ctx, 'Error loading report'));
      }

      function pad(n) { return (n < 10 ? '0' : '') + n; }
      function stamp(d) {
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
      }

      /* BtnDownloadPdf_Click: A4 landscape, header, summary box, table + totals row, "Page n" footer */
      function downloadPdf() {
        if (!loaded || !weekly.count()) return ctx.messageBox('No data to export.', 'SMEAG', 'OK', 'info');
        var esc = OfficeKit.esc, rows = currentRows(), cats = columnsFor(false).slice(2).map(function (c) { return c.key; });
        var t = totals.rows()[0] || {};
        var now = new Date();
        function stat(lbl, val, blue) {
          return '<td><div class="card"><div class="sl">' + esc(lbl) + '</div><div class="sv">' + esc(val) + '</div></div></td>';
        }
        var html =
          '<table class="hd"><tr><td>' +
          '<div class="ttl">WEEKLY REPORT</div>' +
          '<div class="m10">Period: ' + esc(isoDate(dtpStart.get())) + ' ~ ' + esc(isoDate(dtpEnd.get())) + '</div>' +
          '<div class="m10">Campus: ' + esc(q('campus').value) + '</div>' +
          (isFiltered() ? '<div class="m10">Columns: ' + esc(colsText()) + '</div>' : '') + '</td>' +
          '<td class="r"><div class="m9">Generated: ' + esc(stamp(now)) + '</div><div class="m9">Ref#: ' + esc(q('week').value) + '</div></td></tr></table>' +
          (isFiltered()
            ? '<table class="stats"><tr>' + selCats().map(function (c) { return stat(c, OfficeKit.money(t[c])); }).join('') +
              (withSum() ? stat('Total', OfficeKit.money(t.SUM)) : '') + '</tr></table>'
            : '<table class="stats"><tr>' +
              stat('Recharge', cardVals[0].value) + stat('Cash Out', cardVals[1].value) + stat('Receipt', cardVals[2].value) +
              stat('Store Shop', cardVals[3].value) + stat('Total Amount', cardVals[4].value, true) +
              '</tr></table>') +
          (pmOn()
            ? '<div class="pmt">PUSAN MART PROFIT (' + Math.round(pm.share * 100) + ' : ' + (100 - Math.round(pm.share * 100)) + ')</div><table class="stats"><tr>' +
              PM_CARDS.map(function (c, i) { return stat(c, pmVals[i].value); }).join('') + '</tr></table>' +
              (pm.totals.missingSales > 0 ? '<div class="m9">Sales without a cost yet: ' + esc(OfficeKit.money(pm.totals.missingSales)) + ' (not in the profit)</div>' : '')
            : '') +
          '<table class="wk"><colgroup><col style="width:30pt"><col style="width:80pt">' + cats.map(function () { return '<col>'; }).join('') + '</colgroup>' +
          '<thead><tr><th>NO</th><th>DATE</th>' + cats.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
          rows.map(function (r) {
            return '<tr><td class="c">' + esc(r.NO) + '</td><td class="c">' + esc(r.DATE) + '</td>' +
              cats.map(function (c) {
                var adj = adjusted[r.DATE] && adjusted[r.DATE][c];
                return '<td class="r' + (adj ? ' adj' : '') + (c === 'SUM' ? ' sum' : '') + '">' + esc(OfficeKit.money(num(r[c]))) + '</td>';
              }).join('') + '</tr>';
          }).join('') +
          '<tr class="tot"><td>TOTAL</td><td>-</td>' + cats.map(function (c) { return '<td>' + esc(OfficeKit.money(t[c])) + '</td>'; }).join('') + '</tr>' +
          '</tbody></table>';
        /* same colours as the screen: navy title, grey summary cards, blue grid header, striped rows, grey totals row */
        var css =
          '@page{margin:1cm;@bottom-center{content:"Page " counter(page);font:8pt "Segoe UI",Arial,sans-serif;}}' +
          'body{font-size:8pt;font-family:"Segoe UI",Arial,sans-serif;color:#000;-webkit-print-color-adjust:exact;print-color-adjust:exact;}' +
          'table.hd{width:100%;border-collapse:collapse;} table.hd td{vertical-align:top;padding:0;} table.hd td.r{text-align:right;}' +
          '.pmt{font-size:10pt;font-weight:600;color:#000080;margin-top:4pt;} .ttl{font-size:18pt;font-weight:600;color:#000080;} .m10{font-size:10pt;} .m9{font-size:9pt;}' +
          'table.stats{width:100%;border-collapse:separate;border-spacing:6pt 0;margin:10pt -6pt;} table.stats td{width:20%;padding:0;}' +
          '.card{border:1px solid #646464;background:#FFF;} .sl{background:#E6E6E6;text-align:center;font-size:9pt;padding:4pt 0;}' +
          '.sv{margin:5pt 6pt 6pt;border:1px solid #646464;text-align:center;font-size:12pt;padding:2pt 0;}' +
          'table.wk{width:100%;border-collapse:collapse;table-layout:fixed;}' +
          'table.wk th{background:#0078D7;color:#FFF;font-weight:400;padding:3pt 2pt;text-align:center;overflow-wrap:anywhere;border:1px solid #646464;}' +
          'table.wk td{background:#FFF;border:1px solid #E3E3E8;padding:2pt;white-space:nowrap;overflow:hidden;} table.wk tr{page-break-inside:avoid;}' +
          'table.wk td.sum{font-weight:600;}' +
          'table.wk tbody tr:nth-child(even) td{background:#FAFAFC;}' +
          'table.wk td.adj{background-image:linear-gradient(225deg,#F0A030 5px,transparent 5px);}' +
          'table.wk tr.tot td{background:#DCDCE1 !important;font-weight:600;text-align:center;border-color:#C8C8CD;}';
        OfficeKit.printDoc('Weekly_Report_' + fileTag() + stamp(now).replace(/[-: ]/g, '').replace(/^(\d{8})/, '$1_'), html, { landscape: true, css: css });
      }

      // file-name part for a column choice: "Cafe+Pusan Mart_" (nothing when every column is shown)
      function fileTag() { return isFiltered() ? selCats().join('+').replace(/[\\/:*?"<>|]/g, '') + '_' : ''; }

      function pdfFolder() {
        return ctx.messageBox('In the web version the PDF is saved by the browser.\n\nClick DOWNLOAD PDF and choose "Save as PDF" in the print dialog; ' +
          'the file goes to your Downloads folder (or the folder you pick).', 'SMEAG', 'OK', 'info');
      }

      /* ---------- transactions behind a row (one day) ---------- */
      var DETAIL_COLS = [
        { key: 'column', header: 'Report column', width: 110 },
        { key: 'date', header: 'Date / time', width: 150, align: 'center' },
        { key: 'studentId', header: 'Student ID', width: 90 },
        { key: 'name', header: 'Name', width: 170 },
        { key: 'uid', header: 'UID', width: 110 },
        { key: 'campus', header: 'Campus', width: 80 },
        { key: 'category', header: 'Category', width: 150 },
        { key: 'subcategory', header: 'Subcategory', width: 180 },
        { key: 'type', header: 'Type', width: 75, align: 'center' },
        { key: 'payment', header: 'Payment', width: 95, align: 'right', format: 'money' },
        { key: 'amount', header: 'Report amount', width: 105, align: 'right', format: 'money' },
        { key: 'balance', header: 'Balance after', width: 105, align: 'right', format: 'money' },
        { key: 'source', header: 'Source', width: 90 },
        { key: 'remark', header: 'Remark', width: 120 },
        { key: 'staff', header: 'Staff', width: 90 },
        { key: 'table', header: 'Table', width: 90 },
        { key: 'id', header: 'ID', width: 70, align: 'right', format: 'int' }
      ];
      function fetchDetail(from, to, cat) {
        return ctx.api.request('GET', '/api/office/report/detail?campus=' + encodeURIComponent(loaded.campus) +
          '&from=' + from + '&to=' + to + (cat ? '&category=' + encodeURIComponent(cat) : ''));
      }
      function sumBy(rows) {
        var m = {};
        rows.forEach(function (r) { m[r.column] = (m[r.column] || 0) + num(r.amount); });
        return m;
      }

      function showDetail(date, initialCat) {
        if (!loaded) return;
        var esc = OfficeKit.esc;
        return fetchDetail(date, date, '').then(function (res) {
          var sel = selCats();
          var all = (res.rows || []).filter(function (x) { return sel.indexOf(x.column) >= 0; });
          var sums = sumBy(all);
          var shown = weekly.rows().filter(function (r) { return r.DATE === date; })[0] || {};
          var cats = sel.filter(function (c) { return sums[c] !== undefined || num(shown[c]) !== 0; });
          var html = '<div class="dlg-title">TRANSACTIONS — ' + esc(loaded.campus) + ' — ' + esc(date) +
            '<button class="dlg-x" tabindex="-1"><svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 0L10 10M10 0L0 10" stroke="currentColor" stroke-width="1.1"/></svg></button></div>' +
            '<div class="rdt-bar"><label>Column: <select data-r="cat"><option value="">All (' + all.length + ')</option>' +
            cats.map(function (c) {
              var n = all.filter(function (r) { return r.column === c; }).length;
              return '<option value="' + esc(c) + '"' + (c === initialCat ? ' selected' : '') + '>' + esc(c) + ' (' + n + ')</option>';
            }).join('') + '</select></label><span class="rdt-sum" data-r="sum"></span></div>' +
            '<div class="rdt-grid" data-r="grid"></div>' +
            '<div class="mb-foot"><span class="rdt-note" data-r="note"></span>' +
            '<button class="w10btn" data-r="xls">Export Excel</button><button class="w10btn def" data-r="close" data-autofocus>Close</button></div>';
          return ctx.openDialog(html, function (dlg, close) {
            function r(k) { return dlg.querySelector('[data-r="' + k + '"]'); }
            var grid = OfficeKit.grid(r('grid'), { columns: DETAIL_COLS, select: 'row', rowHeight: 26, font: '12px' });
            function current() { var c = r('cat').value; return c ? all.filter(function (x) { return x.column === c; }) : all; }
            function render() {
              var c = r('cat').value, rows = current();
              grid.setRows(rows);
              var total = rows.reduce(function (s, x) { return s + num(x.amount); }, 0);
              r('sum').textContent = rows.length + ' rows' + (c ? ' · ' + c + ' total ' + OfficeKit.money(total) +
                ' · report shows ' + OfficeKit.money(num(shown[c])) : '');
              var notes = [];
              if (c && adjusted[date] && adjusted[date][c]) notes.push('This cell has a saved manual value, so it can differ from the transactions.');
              if (res.truncated) notes.push('List truncated.');
              r('note').textContent = notes.join(' ');
            }
            r('cat').addEventListener('change', render);
            render();
            r('close').addEventListener('click', function () { close(); });
            r('xls').addEventListener('click', function () {
              var c = r('cat').value;
              OfficeKit.busy(r('xls'), OfficeKit.downloadXlsx('Report_Transactions_' + loaded.campus + '_' + date + (c ? '_' + c : '') + '.xlsx', [{
                name: 'Transactions ' + date,
                title: ['TRANSACTIONS', 'Campus: ' + loaded.campus, 'Date: ' + date + (c ? '   Column: ' + c : '')],
                columns: DETAIL_COLS, rows: current()
              }])).catch(OfficeKit.fail(ctx, 'Excel export'));
            });
            return {};
          });
        }).catch(OfficeKit.fail(ctx, 'Error loading transactions'));
      }

      /* EXPORT EXCEL: sheet 1 = weekly report (+ TOTAL), sheet 2 = every transaction of the period */
      function exportExcel() {
        if (!loaded || !weekly.count()) return ctx.messageBox('No data to export. SEARCH first.', 'SMEAG', 'OK', 'info');
        var cols = columnsFor(false);
        var rows = currentRows().concat(totals.rows());
        var t = totals.rows()[0] || {}, sel = selCats();
        var title = ['WEEKLY REPORT', 'Campus: ' + loaded.campus, 'Period: ' + loaded.from + ' ~ ' + loaded.to]
          .concat(isFiltered()
            ? ['Columns: ' + colsText(), sel.map(function (c) { return c + ' ' + OfficeKit.money(t[c]); }).join(' · ') +
                (withSum() ? ' · Total ' + OfficeKit.money(t.SUM) : '')]
            : ['Recharge ' + cardVals[0].value + ' · Cash Out ' + cardVals[1].value + ' · Receipt ' + cardVals[2].value +
                ' · Store shop ' + cardVals[3].value + ' · Total ' + cardVals[4].value])
          .concat(pmOn()
            ? ['Pusan Mart profit: Sales ' + pmVals[0].value + ' · Cost ' + pmVals[1].value + ' · Profit ' + pmVals[2].value +
                ' · Pusan Mart ' + Math.round(pm.share * 100) + '% ' + pmVals[3].value + ' · SMEAG ' + (100 - Math.round(pm.share * 100)) + '% ' + pmVals[4].value +
                (pm.totals.missingSales > 0 ? ' · Sales without cost (not in profit) ' + OfficeKit.money(pm.totals.missingSales) : '')]
            : []);
        // same marks as the screen: a saved manual value gets an orange cell, the SUM column a light blue one
        function cellFill(r, c) {
          if (r && adjusted[r.DATE] && adjusted[r.DATE][c.key]) return 'FCE3C0';
          return c.key === 'SUM' ? 'EAF2FB' : null;
        }
        var job = fetchDetail(loaded.from, loaded.to, '').then(function (res) {
          var tx = (res.rows || []).filter(function (x) { return sel.indexOf(x.column) >= 0; });
          return OfficeKit.downloadXlsx('Weekly_Report_' + loaded.campus + '_' + fileTag() + loaded.from + '_' + loaded.to + '.xlsx', [
            { name: 'Weekly Report', title: title, columns: cols, rows: rows, totalRows: 1, cellFill: cellFill },
            { name: 'Transactions', title: ['TRANSACTIONS', 'Campus: ' + loaded.campus, 'Period: ' + loaded.from + ' ~ ' + loaded.to]
                .concat(isFiltered() ? ['Columns: ' + colsText()] : []),
              columns: DETAIL_COLS, rows: tx }
          ]);
        });
        return OfficeKit.busy(q('excel'), job).catch(OfficeKit.fail(ctx, 'Excel export'));
      }

      q('search').addEventListener('click', load);
      q('excel').addEventListener('click', exportExcel);
      q('pdf').addEventListener('click', downloadPdf);
      q('folder').addEventListener('click', pdfFolder);
      // Back: the original WinForms button has no Click handler (does nothing) — kept inert.
    },
    show: function () {}
  };
})();
