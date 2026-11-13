/* REPORT tab — registers window.OfficeTabs['REPORT'] (see showPage() in office.js).
   Screen-only replica of the weekly report: Campus / start / end / week no. + SEARCH, five summary cards,
   WEEKLY REPORT grid + totals row, and DOWNLOAD PDF / UPDATE / OPEN PDF FOLDER / Back.
   Data: GET/PUT /api/office/report (port of ReportControl.cs BtnLoad_Click / RecalculateTotals / BtnUpdate_Click). */
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

  window.OfficeTabs = window.OfficeTabs || {};
  window.OfficeTabs['REPORT'] = {
    mount: function (root, ctx) {
      root.classList.add('g2-page');
      var html =
        '<div class="g2-panel" style="left:0;top:0;width:1706px;height:231px"></div>' +
        '<span class="g2-lbl f10" style="left:33px;top:26px">Campus:</span>' +
        comboHtml('campus', 'left:135px;top:21px;width:110px;height:25px', ['CAPITAL', 'ENCANTO', 'TARLAC', 'BAYDREAM'], 'CAPITAL') +
        dtpHtml('start', 'f10', 'left:310px;top:21px;width:110px;height:25px') +
        dtpHtml('end', 'f10', 'left:485px;top:21px;width:110px;height:25px') +
        '<input class="g2-txt" data-k="week" type="text" value="1" spellcheck="false" autocomplete="off" style="left:660px;top:21px;width:50px;height:25px">' +
        '<button class="flat g2-btn b" data-k="search" style="left:770px;top:21px;width:90px;height:30px;background:#000080;font-size:13.33px">SEARCH</button>';
      CARDS.forEach(function (c, i) {
        html += '<div class="g2-card" style="left:' + (20 + i * 190) + 'px;top:76px">' +
          '<div class="g2-card-hd">' + c[0] + '</div>' +
          '<input class="g2-card-val" type="text" readonly tabindex="-1" value="' + c[1] + '"></div>';
      });
      html +=
        '<div class="g2-title" style="top:194px">WEEKLY REPORT</div>' +
        '<div class="g2-panel g2-rep-grid" data-k="grid" style="left:20px;top:246px;width:1666px;height:517px"></div>' +
        '<div class="g2-abs g2-rep-tot" data-k="totals" style="left:20px;top:763px;width:1666px;height:40px;background:#DDDCE1"></div>' +
        '<div class="g2-abs" style="left:0;top:818px;width:1706px;height:62px;background:#F0F0F0"></div>' +
        '<button class="flat g2-btn" data-k="pdf" style="left:20px;top:828px;width:160px;height:40px;background:#008000">DOWNLOAD PDF</button>' +
        '<button class="flat g2-btn b" data-k="update" style="left:190px;top:828px;width:120px;height:40px;background:#FF8C00">UPDATE</button>' +
        '<button class="flat g2-btn" data-k="folder" style="left:320px;top:828px;width:170px;height:40px;background:#4682B4">OPEN PDF FOLDER</button>' +
        '<button class="flat g2-btn" data-k="back" style="left:1567px;top:828px;width:120px;height:40px;background:#808080">Back</button>';
      root.innerHTML = html;

      function q(k) { return root.querySelector('[data-k="' + k + '"]'); }
      var today = new Date(); today.setHours(0, 0, 0, 0);
      var start = new Date(today); start.setDate(start.getDate() - 6);
      var dtpStart = wireDtp(q('start'), start);
      var dtpEnd = wireDtp(q('end'), new Date(today));
      var cardVals = root.querySelectorAll('.g2-card-val');   // Recharge, Cash Out, Receipt, Store shop, Total amount

      q('week').addEventListener('input', function () {
        var v = this.value.replace(/\D/g, '');
        if (v !== this.value) this.value = v;
      });

      var OFFICE = ['Recharge', 'AGRecharge', 'EBILL', 'Records', 'Refund', 'CashOut', 'Souvenir', 'Visa', 'Academic', 'Admin', 'Activities', 'Diving Shop'];
      var STORE = ['Mart', 'Cafe'];
      var loaded = null;        // { campus, from, to, ref } of the last SEARCH
      var weekly = null, totals = null, adjusted = {};   // adjusted[date] = { category: true }

      function columnsFor(editable) {
        var cols = [{ key: 'NO', header: 'NO', width: 50, align: 'center' }, { key: 'DATE', header: 'DATE', width: 100, align: 'center' }];
        OFFICE.concat(STORE).forEach(function (c) {
          cols.push({ key: c, header: c, width: 104, align: 'right', format: 'money', editable: editable });
        });
        return cols;
      }
      function makeGrids(cats) {
        if (cats) { OFFICE = cats.office; STORE = cats.store; }
        weekly = OfficeKit.grid(q('grid'), { columns: columnsFor(true), select: 'row', rowHeight: 35, font: '12px' });
        totals = OfficeKit.grid(q('totals'), { columns: columnsFor(false), select: 'row', rowHeight: 38, font: '12px' });
        weekly.el.addEventListener('scroll', function () { totals.el.scrollLeft = weekly.el.scrollLeft; });
        // grid.js has no "cell edited" callback: watch the body for re-rendered rows (an edit commit re-renders its row).
        new MutationObserver(function () {
          markAdjusted();
          if (!weekly.el.querySelector('td.editing')) recalc();
        }).observe(weekly.el, { childList: true, subtree: true });
      }
      makeGrids();

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
        var cols = columnsFor(true);
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

      /* RecalculateTotals(): column sums of |value|; Receipt = every office column except CashOut and Refund */
      function recalc() {
        if (!loaded) return;
        var rows = currentRows();
        var t = { NO: 'TOTAL', DATE: '-' };
        var rech = 0, cash = 0, receipt = 0, store = 0;
        OFFICE.forEach(function (cat) {
          var s = 0;
          rows.forEach(function (r) { s += Math.abs(num(r[cat])); });
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
        totals.setRows([t]);
        cardVals[0].value = OfficeKit.money(Math.abs(rech));
        cardVals[1].value = OfficeKit.money(Math.abs(cash));
        cardVals[2].value = OfficeKit.money(Math.abs(receipt));
        cardVals[3].value = OfficeKit.money(Math.abs(store));
        cardVals[4].value = OfficeKit.money(rech - cash);
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
          loaded = { campus: campus, from: from, to: res.days && res.days.length ? res.days[res.days.length - 1].date : to };
          weekly.setRows(rows);
          markAdjusted();
          recalc();
        }).catch(OfficeKit.fail(ctx, 'Error loading report'));
      }

      function update() {
        if (!loaded || !weekly.count()) {
          return ctx.messageBox('먼저 SEARCH로 데이터를 조회한 후 UPDATE 해주세요.\n(Please SEARCH first, then UPDATE.)', '알림', 'OK', 'info');
        }
        var rows = currentRows();
        return ctx.messageBox('현재 화면에 표시된 값으로 영구 저장하시겠습니까?\n저장 후에는 다시 조회해도 수정한 값이 유지됩니다.\n\n' +
          '(Save the values shown on screen permanently?)', 'UPDATE 확인', 'YesNo', 'question').then(function (ans) {
          if (ans !== 'Yes') return null;
          var body = {
            campus: loaded.campus,
            days: rows.map(function (r) {
              var v = {};
              OFFICE.concat(STORE).forEach(function (c) { v[c] = num(r[c]); });
              return { date: r.DATE, values: v };
            })
          };
          return OfficeKit.busy(q('update'), ctx.api.request('PUT', '/api/office/report', body)).then(function (res) {
            // every value on screen is now a saved correction
            var clean = rows.map(function (r) {
              var o = { NO: r.NO, DATE: r.DATE };
              adjusted[r.DATE] = {};
              OFFICE.concat(STORE).forEach(function (c) { o[c] = num(r[c]); adjusted[r.DATE][c] = true; });
              return o;
            });
            weekly.setRows(clean);
            markAdjusted();
            recalc();
            return ctx.messageBox('저장되었습니다. (' + (res && res.saved != null ? res.saved : body.days.length * 14) + '건 반영)\nSaved.', 'UPDATE 완료', 'OK', 'info');
          }, function (err) {
            return ctx.messageBox('UPDATE 중 오류가 발생했습니다: ' + (err && err.message ? err.message : err), '오류', 'OK', 'error');
          });
        });
      }

      function pad(n) { return (n < 10 ? '0' : '') + n; }
      function stamp(d) {
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
      }

      /* BtnDownloadPdf_Click: A4 landscape, header, summary box, table + totals row, "Page n" footer */
      function downloadPdf() {
        if (!loaded || !weekly.count()) return ctx.messageBox('No data to export.', 'SMEAG', 'OK', 'info');
        var esc = OfficeKit.esc, rows = currentRows(), cats = OFFICE.concat(STORE);
        var t = totals.rows()[0] || {};
        var now = new Date();
        function stat(lbl, val, blue) {
          return '<td><div class="sl">' + esc(lbl) + '</div><div class="sv' + (blue ? ' blue' : '') + '">' + esc(val) + '</div></td>';
        }
        var html =
          '<table class="hd"><tr><td>' +
          '<div class="ttl">WEEKLY REPORT</div>' +
          '<div class="m10">Period: ' + esc(isoDate(dtpStart.get())) + ' ~ ' + esc(isoDate(dtpEnd.get())) + '</div>' +
          '<div class="m10">Campus: ' + esc(q('campus').value) + '</div></td>' +
          '<td class="r"><div class="m9">Generated: ' + esc(stamp(now)) + '</div><div class="m9">Ref#: ' + esc(q('week').value) + '</div></td></tr></table>' +
          '<table class="stats"><tr>' +
          stat('Recharge', cardVals[0].value) + stat('Cash Out', cardVals[1].value) + stat('Receipt', cardVals[2].value) +
          stat('Store Shop', cardVals[3].value) + stat('Total Amount', cardVals[4].value, true) +
          '</tr></table>' +
          '<table class="wk"><colgroup><col style="width:30pt"><col style="width:80pt">' + cats.map(function () { return '<col>'; }).join('') + '</colgroup>' +
          '<thead><tr><th>NO</th><th>DATE</th>' + cats.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
          rows.map(function (r) {
            return '<tr><td class="c">' + esc(r.NO) + '</td><td class="c">' + esc(r.DATE) + '</td>' +
              cats.map(function (c) { return '<td class="r">' + esc(OfficeKit.money(num(r[c]))) + '</td>'; }).join('') + '</tr>';
          }).join('') +
          '<tr class="tot"><td>TOTAL</td><td>-</td>' + cats.map(function (c) { return '<td>' + esc(OfficeKit.money(t[c])) + '</td>'; }).join('') + '</tr>' +
          '</tbody></table>';
        var css =
          '@page{margin:1cm;@bottom-center{content:"Page " counter(page);font:8pt "Segoe UI",Arial,sans-serif;}}' +
          'body{font-size:8pt;font-family:"Segoe UI",Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact;}' +
          'table.hd{width:100%;border-collapse:collapse;} table.hd td{vertical-align:top;padding:0;} table.hd td.r{text-align:right;}' +
          '.ttl{font-size:18pt;font-weight:600;color:#2196F3;} .m10{font-size:10pt;} .m9{font-size:9pt;}' +
          'table.stats{width:100%;border:1px solid #E0E0E0;border-collapse:collapse;margin:10pt 0;} table.stats td{padding:10pt 0 10pt 10pt;width:20%;}' +
          '.sl{font-size:9pt;color:#9E9E9E;} .sv{font-size:12pt;font-weight:700;} .sv.blue{color:#2196F3;}' +
          'table.wk{width:100%;border-collapse:collapse;table-layout:fixed;} table.wk th{background:#2196F3;color:#FFF;font-weight:600;padding:2pt;text-align:center;overflow-wrap:anywhere;}' +
          'table.wk td{border-bottom:1px solid #EEE;padding:2pt;white-space:nowrap;overflow:hidden;} table.wk tr{page-break-inside:avoid;}' +
          'table.wk tr.tot td{background:#F5F5F5;font-weight:600;text-align:center;border-bottom:0;}';
        OfficeKit.printDoc('Weekly_Report_' + stamp(now).replace(/[-: ]/g, '').replace(/^(\d{8})/, '$1_'), html, { landscape: true, css: css });
      }

      function pdfFolder() {
        return ctx.messageBox('In the web version the PDF is saved by the browser.\n\nClick DOWNLOAD PDF and choose "Save as PDF" in the print dialog; ' +
          'the file goes to your Downloads folder (or the folder you pick).', 'SMEAG', 'OK', 'info');
      }

      q('search').addEventListener('click', load);
      q('update').addEventListener('click', update);
      q('pdf').addEventListener('click', downloadPdf);
      q('folder').addEventListener('click', pdfFolder);
      // Back: the original WinForms button has no Click handler (does nothing) — kept inert.
    },
    show: function () {}
  };
})();
