/* 부산마트 주간보고 / Pusan Mart Weekly Report — one builder, Korean or English.
   Used by the office REPORT tab (office/tabs/report.js) and the Pusan Mart app Report › Pay List (mart/mart.js, /report/).

   PusanWeekly.build({ days: [{ date:'YYYY-MM-DD', sales, cost, missing }], share: 0.5, campus, from, to }) -> P | null
     net = sales - cost, SME = net x share, Pusan Mart = cost + SME; Mon–Sun week blocks + the month ledger.
   PusanWeekly.excel(P, lang)      -> Promise (downloads the .xlsx: sheet "주간보고"/"Weekly" + "DAILY", real formulas)
   PusanWeekly.html(P, lang)       -> HTML of the two tables (wrapped in .pmw; style with PusanWeekly.CSS)
   PusanWeekly.print(P, lang)      -> browser print dialog (A4 landscape; "Save as PDF")
   lang: 'ko' (default) | 'en' */
(function () {
  'use strict';

  var T = {
    ko: {
      title: '부산마트 (Pusan Mart Trading Inc.) 주간 수익 보고서',
      basis: function (p) { return '작성 기준: 매입가/수입 직접 입력 → 넷가·분배금 자동 계산 (수익 배분 ' + p + '%)'; },
      period: '기간', shareLbl: '수익 배분',
      legend: '[범례]',
      legIn: '파란 글씨 = 입력 칸 (DATE, 수입, 매입가)',
      legCalc: function (p) { return '검정 글씨 = 자동 계산 칸 (넷가 = 수입-매입가, sme넷가 = 넷가×' + p + '%)'; },
      item: '구분', weekTot: '주간 합계', periodTot: '기간 합계',
      wd: ['월MON', '화TUE', '수WED', '목Thu', '금Fri', '토Sat', '일Sun'],
      sales: 'SALE매출(수입)', cost: 'cost 매입가', net: 'net 넷가', sme: function (p) { return 'SME 넷가 (' + p + '%)'; },
      totHd: function (p) { return ['SALE', 'cost', 'net', 'SME ' + p + '%', 'Pusan Mart']; },
      missX: function (list) { return '⚠ 원가 미입력 (주황색 칸): ' + list + ' — Pusan Pay Cost Exp. 입력 후 다시 출력하세요.'; },
      missP: function (list) { return '⚠ 원가 미입력: ' + list; },
      sheet: '주간보고', file: '부산마트_주간보고_', font: '맑은 고딕'
    },
    en: {
      title: 'Pusan Mart Trading Inc. — Weekly Profit Report',
      basis: function (p) { return 'Basis: sales and cost are entered → net and shares are calculated (profit share ' + p + '%)'; },
      period: 'Period', shareLbl: 'Profit share',
      legend: '[Legend]',
      legIn: 'Blue text = input cells (DATE, sales, cost)',
      legCalc: function (p) { return 'Black text = calculated cells (net = sales − cost, SME net = net × ' + p + '%)'; },
      item: 'ITEM', weekTot: 'WEEK TOTAL', periodTot: 'PERIOD TOTAL',
      wd: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
      sales: 'SALES', cost: 'COST', net: 'NET', sme: function (p) { return 'SME NET (' + p + '%)'; },
      totHd: function (p) { return ['SALES', 'COST', 'NET', 'SME ' + p + '%', 'Pusan Mart']; },
      missX: function (list) { return '⚠ Cost not entered (orange cells): ' + list + ' — enter the Pusan Pay Cost Exp. and export again.'; },
      missP: function (list) { return '⚠ Cost not entered: ' + list; },
      sheet: 'Weekly', file: 'PusanMart_Weekly_Report_', font: 'Calibri'
    }
  };
  var MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];

  function L(lang) { return T[lang] || T.ko; }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function r2(n) { return Math.round(n * 100) / 100; }
  function ymd(s) { var p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function iso(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function mdy(dt) { return (dt.getMonth() + 1) + '/' + dt.getDate() + '/' + dt.getFullYear(); }
  function todayIso() { return iso(new Date()); }   // a day without sales before today = CLOSE
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function money(n) { return num(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  function build(o) {
    var share = o.share || 0.5;
    var src = (o.days || []).slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    if (!src.length) return null;
    var days = src.map(function (d) {
      var sales = num(d.sales), cost = num(d.cost), net = r2(sales - cost), sme = r2(net * share);
      return { date: d.date, dt: ymd(d.date), sales: sales, cost: cost, net: net, sme: sme, pusan: r2(cost + sme),
               missing: num(d.missing), has: sales !== 0 || cost !== 0 };
    });
    // Mon–Sun weeks covering the period
    var first = new Date(days[0].dt); first.setDate(first.getDate() - (first.getDay() + 6) % 7);
    var byIso = {}; days.forEach(function (d) { byIso[d.date] = d; });
    var weeks = [], cur = new Date(first), lastIso = days[days.length - 1].date;
    while (iso(cur) <= lastIso) {
      var wk = [];
      for (var i = 0; i < 7; i++) { var c = new Date(cur); c.setDate(c.getDate() + i); wk.push({ dt: c, d: byIso[iso(c)] || null }); }
      weeks.push(wk);
      cur.setDate(cur.getDate() + 7);
    }
    var months = [];
    days.forEach(function (d) { var m = MONTHS[d.dt.getMonth()]; if (months.indexOf(m) < 0) months.push(m); });
    var tot = { sales: 0, cost: 0, net: 0, sme: 0, pusan: 0 };
    days.forEach(function (d) { ['sales', 'cost', 'net', 'sme', 'pusan'].forEach(function (k) { tot[k] = r2(tot[k] + d[k]); }); });
    return { share: share, campus: o.campus || 'Pusan Mart', from: o.from || days[0].date, to: o.to || lastIso,
             days: days, weeks: weeks, months: months, tot: tot,
             missingDays: days.filter(function (d) { return d.missing > 0; }) };
  }

  /* ---------- Excel ---------- */
  var SHEETJS = 'https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js';
  var sheetJs = null;
  function loadSheetJs() {
    if (window.OfficeKit && window.OfficeKit.loadSheetJs) return window.OfficeKit.loadSheetJs();
    if (sheetJs) return sheetJs;
    sheetJs = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = SHEETJS;
      s.onload = function () { if (window.XLSX) resolve(window.XLSX); else { sheetJs = null; reject(new Error('Cannot load the Excel library.')); } };
      s.onerror = function () { sheetJs = null; s.remove(); reject(new Error('Cannot load the Excel library (check the internet connection).')); };
      document.head.appendChild(s);
    });
    return sheetJs;
  }

  function excel(P, lang) {
    var t = L(lang);
    return loadSheetJs().then(function (XLSX) {
      var wb = XLSX.utils.book_new(), pct = Math.round(P.share * 100);
      var PESO = '₱#,##0.00;[Red]"-₱"#,##0.00', NUM = '#,##0.00;[Red]#,##0.00';
      function side(st, rgb) { return { style: st || 'thin', color: { rgb: rgb || '000000' } }; }
      var BOX = { top: side(), bottom: side(), left: side(), right: side() };
      function fill(rgb) { return { patternType: 'solid', fgColor: { rgb: rgb } }; }
      function font(o) { return Object.assign({ name: t.font, sz: 11, color: { rgb: '000000' } }, o || {}); }
      function put(ws, ref, v, s, f) {
        var c = { t: typeof v === 'number' ? 'n' : 's', v: v == null ? '' : v };
        if (f) { c.f = f; c.t = 'n'; if (typeof v !== 'number') c.v = 0; }
        if (s) { c.s = s; if (s.numFmt) c.z = s.numFmt; }
        ws[ref] = c;
      }
      var mid = { horizontal: 'center', vertical: 'center' }, right = { horizontal: 'right', vertical: 'center' };

      /* ---- sheet 1: weekly blocks ---- */
      var ws = {}, merges = [], rows = [];
      put(ws, 'A1', t.title, { font: font({ sz: 16, bold: true, color: { rgb: 'FFFFFF' } }), fill: fill('1F4E78'), alignment: mid });
      put(ws, 'A2', t.basis(pct), { font: font({ sz: 9, color: { rgb: '595959' } }), alignment: mid });
      put(ws, 'A3', 'Campus: ' + P.campus + '   ·   ' + t.period + ': ' + P.from + ' ~ ' + P.to,
        { font: font({ sz: 9, color: { rgb: '595959' } }), alignment: mid });
      put(ws, 'J1', t.legend, { font: font({ sz: 10, bold: true }) });
      put(ws, 'J2', t.legIn, { font: font({ sz: 9, color: { rgb: '0000FF' } }) });
      put(ws, 'J3', t.legCalc(pct), { font: font({ sz: 9 }) });
      merges.push('A1:I1', 'A2:I2', 'A3:I3', 'J2:M2', 'J3:M3');
      rows[0] = { hpt: 27.75 }; rows[1] = { hpt: 14.25 };
      var COLS = 'BCDEFGH';
      var HEAD = { font: font({ bold: true, color: { rgb: 'FFFFFF' } }), fill: fill('2E75B6'), alignment: mid, border: BOX };
      var LBL = { font: font({ bold: true }), fill: fill('D9E1F2'), alignment: mid, border: BOX };
      var INDATE = { font: font({ color: { rgb: '0000FF' } }), fill: fill('FFFDE7'), alignment: mid, border: BOX };
      var IN = { font: font({ color: { rgb: '0000FF' } }), fill: fill('FFFDE7'), alignment: right, border: BOX, numFmt: PESO };
      var INMISS = Object.assign({}, IN, { fill: fill('FCE3C0') });
      var CALC = { font: font(), alignment: right, border: BOX, numFmt: PESO };
      var SUMC = { font: font({ bold: true }), fill: fill('E2EFDA'), alignment: right, border: BOX, numFmt: PESO };
      var PMLBL = { font: font({ bold: true }), fill: fill('B8CCE4'), alignment: mid, border: BOX };
      var PMV = { font: font(), fill: fill('B8CCE4'), alignment: right, border: BOX, numFmt: NUM };
      var PMT = { font: font({ bold: true, color: { rgb: 'FF0000' } }), fill: fill('B8CCE4'), alignment: right, border: BOX, numFmt: NUM };
      var r = 4;
      P.weeks.forEach(function (wk) {
        var h = r, dR = r + 1, sR = r + 2, cR = r + 3, nR = r + 4, mR = r + 5, pR = r + 6;
        put(ws, 'A' + h, t.item, HEAD);
        t.wd.forEach(function (w, i) { put(ws, COLS[i] + h, w, HEAD); });
        put(ws, 'I' + h, t.weekTot, HEAD);
        put(ws, 'A' + dR, 'DATE', LBL); put(ws, 'I' + dR, '', LBL);
        put(ws, 'A' + sR, t.sales, LBL);
        put(ws, 'A' + cR, t.cost, LBL);
        put(ws, 'A' + nR, t.net, LBL);
        put(ws, 'A' + mR, t.sme(pct), LBL);
        put(ws, 'A' + pR, 'Pusan Mart', PMLBL);
        var s = { s: 0, c: 0, n: 0, m: 0, p: 0 };
        wk.forEach(function (x, i) {
          var C = COLS[i], d = x.d, has = d && d.has;
          put(ws, C + dR, x.dt.getDate(), INDATE);
          if (has) { put(ws, C + sR, d.sales, IN); put(ws, C + cR, d.cost, d.missing > 0 ? INMISS : IN); }
          else { put(ws, C + sR, '', IN); put(ws, C + cR, '', IN); }
          var n = has ? d.net : 0, m = has ? d.sme : 0, p = has ? d.pusan : 0;
          put(ws, C + nR, n, CALC, C + sR + '-' + C + cR);
          put(ws, C + mR, m, CALC, C + nR + '*' + P.share);
          put(ws, C + pR, p, PMV, C + cR + '+' + C + mR);
          if (has) { s.s += d.sales; s.c += d.cost; } s.n += n; s.m += m; s.p += p;
        });
        [[sR, s.s, SUMC], [cR, s.c, SUMC], [nR, s.n, SUMC], [mR, s.m, SUMC], [pR, s.p, PMT]].forEach(function (a) {
          put(ws, 'I' + a[0], r2(a[1]), a[2], 'SUM(B' + a[0] + ':H' + a[0] + ')');
        });
        rows[h - 1] = { hpt: 16.5 }; rows[pR - 1] = { hpt: 19.5 };
        r += 7;
      });
      // period total under the last block
      var sumRefs = function (off) { var a = []; for (var k = 0; k < P.weeks.length; k++) a.push('I' + (4 + k * 7 + off)); return a.join('+'); };
      r += 1;
      put(ws, 'A' + r, t.periodTot, HEAD);
      t.totHd(pct).forEach(function (lbl, i) { put(ws, COLS[i] + r, lbl, HEAD); });
      [[2, P.tot.sales], [3, P.tot.cost], [4, P.tot.net], [5, P.tot.sme], [6, P.tot.pusan]].forEach(function (a, i) {
        put(ws, COLS[i] + (r + 1), a[1], i === 4 ? PMT : SUMC, sumRefs(a[0]));
      });
      put(ws, 'A' + (r + 1), P.from + ' ~ ' + P.to, LBL);
      var lastRow = r + 1;
      if (P.missingDays.length) {
        put(ws, 'A' + (r + 3), t.missX(P.missingDays.map(function (d) { return mdy(d.dt); }).join(', ')),
          { font: font({ sz: 9, color: { rgb: 'B05A00' } }) });
        lastRow = r + 3;
      }
      ws['!ref'] = 'A1:M' + lastRow;
      ws['!merges'] = merges.map(function (m) { return XLSX.utils.decode_range(m); });
      ws['!cols'] = [{ wch: lang === 'en' ? 18 : 16 }].concat([0, 1, 2, 3, 4, 5, 6, 7].map(function () { return { wch: 13 }; }), [{ wch: 8.75 }, { wch: 9 }, { wch: 14.4 }, { wch: 9 }]);
      ws['!rows'] = rows;
      XLSX.utils.book_append_sheet(wb, ws, t.sheet);

      /* ---- sheet 2: DAILY (month ledger) ---- */
      var ws2 = {};
      var BL = font({ bold: true, color: { rgb: '5B9BD5' } });
      put(ws2, 'A1', P.months.join(' - '), { font: font({ bold: true, sz: 12 }), alignment: mid });
      ws2['!merges'] = [XLSX.utils.decode_range('A1:F1')];
      put(ws2, 'A2', 'DATE', { font: font({ bold: true }), alignment: mid });
      ['COSTING', 'SME ' + pct + '%', 'NET', 'SALES', 'PUSAN'].forEach(function (hd, i) {
        put(ws2, 'BCDEF'[i] + '2', hd, { font: BL, alignment: mid });
      });
      var V = { font: font(), alignment: right, numFmt: '#,##0.00' };
      var VM = Object.assign({}, V, { fill: fill('FCE3C0') });
      var rr = 3;
      P.days.forEach(function (d) {
        put(ws2, 'A' + rr, mdy(d.dt), { font: font(), alignment: mid });
        if (d.has) {
          put(ws2, 'B' + rr, d.cost, d.missing > 0 ? VM : V);
          put(ws2, 'C' + rr, d.sme, V, 'D' + rr + '*' + P.share);
          put(ws2, 'D' + rr, d.net, V, 'E' + rr + '-B' + rr);
          put(ws2, 'E' + rr, d.sales, V);
        } else {
          put(ws2, 'E' + rr, 0, V);
          if (d.date < todayIso()) put(ws2, 'G' + rr, 'CLOSE', { font: font({ bold: true, color: { rgb: 'FF0000' } }), alignment: mid });
        }
        put(ws2, 'F' + rr, d.pusan, V, 'B' + rr + '+C' + rr);
        rr++;
      });
      rr++;   // blank row, then the thick line and the PUSAN total
      var TOTB = { top: side('medium'), bottom: side('double') };
      'ABCDEG'.split('').forEach(function (C) { put(ws2, C + rr, '', { border: TOTB }); });
      put(ws2, 'F' + rr, P.tot.pusan, { font: font({ bold: true, color: { rgb: '2E75B6' } }), fill: fill('E7E6E6'), alignment: right,
        numFmt: '#,##0.00', border: TOTB }, 'SUM(F3:F' + (rr - 2) + ')');
      ws2['!ref'] = 'A1:G' + rr;
      ws2['!cols'] = [{ wch: 13 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 10 }];
      XLSX.utils.book_append_sheet(wb, ws2, 'DAILY');

      XLSX.writeFile(wb, t.file + P.from + '_' + P.to + '.xlsx');
    });
  }

  /* ---------- HTML (screen + print) ---------- */
  function html(P, lang) {
    var t = L(lang), pct = Math.round(P.share * 100), m = money;
    function cell(v, cls) { return '<td class="' + (cls || '') + '">' + v + '</td>'; }
    var h = '<div class="pmw"><div class="ttl">' + esc(t.title) + '</div>' +
      '<div class="sub">Campus: ' + esc(P.campus) + ' · ' + t.period + ': ' + esc(P.from) + ' ~ ' + esc(P.to) +
      ' · ' + t.shareLbl + ' ' + pct + '%</div>';
    h += '<table class="wk">';
    P.weeks.forEach(function (wk) {
      var s = { s: 0, c: 0, n: 0, m: 0, p: 0 };
      wk.forEach(function (x) { var d = x.d; if (d && d.has) { s.s += d.sales; s.c += d.cost; s.n += d.net; s.m += d.sme; s.p += d.pusan; } });
      function line(lbl, k, key, cls) {
        return '<tr>' + cell(esc(lbl), 'lbl' + (cls ? ' ' + cls : '')) + wk.map(function (x) {
          var d = x.d, has = d && d.has;
          if (key === 'date') return cell(x.dt.getDate(), 'in c');
          var v = has ? d[key] : (key === 'sales' || key === 'cost' ? '' : 0);
          return cell(v === '' ? '' : m(v), (key === 'sales' || key === 'cost' ? 'in' : '') + (cls ? ' ' + cls : '') + (has && key === 'cost' && d.missing > 0 ? ' miss' : ''));
        }).join('') + cell(k == null ? '' : m(r2(s[k])), 'tot' + (cls ? ' ' + cls + ' red' : '')) + '</tr>';
      }
      h += '<tr class="hd"><th>' + esc(t.item) + '</th>' + t.wd.map(function (w) { return '<th>' + w + '</th>'; }).join('') + '<th>' + esc(t.weekTot) + '</th></tr>' +
        line('DATE', null, 'date') + line(t.sales, 's', 'sales') + line(t.cost, 'c', 'cost') +
        line(t.net, 'n', 'net') + line(t.sme(pct), 'm', 'sme') + line('Pusan Mart', 'p', 'pusan', 'pm') +
        '<tr class="gap"><td colspan="9"></td></tr>';
    });
    var th = t.totHd(pct);
    h += '<tr class="hd"><th>' + esc(t.periodTot) + '</th>' + th.map(function (x) { return '<th>' + esc(x) + '</th>'; }).join('') + '<th colspan="3" class="nob"></th></tr>' +
      '<tr>' + cell(esc(P.from) + '<br>~ ' + esc(P.to), 'lbl wrap') + [P.tot.sales, P.tot.cost, P.tot.net, P.tot.sme].map(function (v) { return cell(m(v), 'tot'); }).join('') +
      cell(m(P.tot.pusan), 'tot pm red') + '<td colspan="3" class="nob"></td></tr>';
    h += '</table>';
    h += '<div class="dl"><div class="mon">' + esc(P.months.join(' - ')) + '</div><table class="daily"><tr><th class="k">DATE</th><th>COSTING</th><th>SME ' + pct +
      '%</th><th>NET</th><th>SALES</th><th>PUSAN</th><th></th></tr>' +
      P.days.map(function (d) {
        return '<tr><td class="c">' + mdy(d.dt) + '</td>' +
          (d.has ? cell(m(d.cost), d.missing > 0 ? 'miss' : '') + cell(m(d.sme)) + cell(m(d.net)) + cell(m(d.sales))
                 : cell('') + cell('') + cell('') + cell('0')) +
          cell(d.has ? m(d.pusan) : '0') + cell(d.has || d.date >= todayIso() ? '' : 'CLOSE', 'close') + '</tr>';
      }).join('') +
      '<tr class="sum"><td></td><td></td><td></td><td></td><td></td><td class="pt">' + m(P.tot.pusan) + '</td><td></td></tr></table></div>';
    if (P.missingDays.length) h += '<div class="warn">' + esc(t.missP(P.missingDays.map(function (d) { return mdy(d.dt); }).join(', '))) + '</div>';
    return h + '</div>';
  }

  var CSS =
    '.pmw{font-family:"Malgun Gothic","Segoe UI",Arial,sans-serif;font-size:8.5pt;color:#000;-webkit-print-color-adjust:exact;print-color-adjust:exact;}' +
    '.pmw .ttl{background:#1F4E78;color:#fff;font-size:14pt;font-weight:700;text-align:center;padding:5pt;} .pmw .sub{text-align:center;color:#595959;font-size:8pt;margin:3pt 0 6pt;}' +
    '.pmw table{border-collapse:collapse;} .pmw table.wk{width:100%;table-layout:fixed;} .pmw table.wk td,.pmw table.wk th{border:1px solid #000;padding:2pt 4pt;text-align:right;white-space:nowrap;}' +
    '.pmw table.wk th{background:#2E75B6;color:#fff;text-align:center;} .pmw td.lbl{background:#D9E1F2;font-weight:700;text-align:center !important;}' +
    '.pmw td.in{background:#FFFDE7;color:#00F;} .pmw td.c{text-align:center !important;} .pmw td.tot{background:#E2EFDA;font-weight:700;} .pmw td.pm{background:#B8CCE4;}' +
    '.pmw td.red{color:#F00;} .pmw td.wrap{white-space:normal !important;font-size:7.5pt;line-height:1.15;} .pmw table.wk th.nob{background:none !important;border:0 !important;} .pmw td.miss{background:#FCE3C0;} .pmw tr.gap td,.pmw td.nob{border:0 !important;height:6pt;} .pmw tr{page-break-inside:avoid;}' +
    '.pmw .dl{margin-top:14pt;} .pmw .mon{font-weight:700;font-size:11pt;text-align:center;width:430pt;margin-bottom:4pt;}' +
    '.pmw table.daily td,.pmw table.daily th{padding:2pt 6pt;text-align:right;min-width:60pt;} .pmw table.daily th{color:#5B9BD5;text-align:center;} .pmw table.daily th.k{color:#000;}' +
    '.pmw td.close{color:#F00;font-weight:700;text-align:center !important;} .pmw tr.sum td{border-top:2px solid #000;border-bottom:3px double #000;}' +
    '.pmw td.pt{background:#E7E6E6;color:#2E75B6;font-weight:700;} .pmw .warn{color:#B05A00;margin-top:6pt;}' +
    '@media print{.pmw .dl{page-break-before:always;margin-top:0;}}';

  function print(P, lang) {
    var t = L(lang);
    var frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    document.body.appendChild(frame);
    var doc = frame.contentDocument;
    doc.open();
    doc.write('<!doctype html><html><head><meta charset="utf-8"><title>' + esc(t.file + P.from + '_' + P.to) + '</title><style>' +
      '@page{size:A4 landscape;margin:10mm;} body{margin:0;}' + CSS + '</style></head><body>' + html(P, lang) + '</body></html>');
    doc.close();
    setTimeout(function () {
      try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch (e) { /* ignore */ }
      setTimeout(function () { if (frame.parentNode) frame.parentNode.removeChild(frame); }, 60000);
    }, 50);
  }

  window.PusanWeekly = { build: build, excel: excel, html: html, print: print, CSS: CSS };
})();
