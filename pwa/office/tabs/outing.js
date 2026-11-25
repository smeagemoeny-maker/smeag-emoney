/* OUTING tab — registers window.OfficeTabs['OUTING'] (see showPage() in office.js).
   Students tap the e-money card at the office when they go out (OUTING = same day, OVERNIGHT = sleep outside)
   and again when they come back. The list shows who is still out and who is LATE (past the expected return).
   API: GET /api/office/outings, GET .../by-uid/:uid, POST /api/office/outings, POST .../:id/return,
   POST .../:id/undo-return, POST .../:id/void (api/src/outing.mjs). */
(function () {
  'use strict';

  var STATUS = {
    out: { text: 'OUT', bg: '#DCEBFA', fg: '#0B4F8A' },
    late: { text: 'LATE · NOT BACK', bg: '#FBDDDB', fg: '#9B1C14' },
    returned: { text: 'BACK', bg: '#E3F2E5', fg: '#1B5E20' },
    returned_late: { text: 'BACK (LATE)', bg: '#FFF3D6', fg: '#8A4B00' },
    voided: { text: 'VOIDED', bg: '#EDEDED', fg: '#555' }
  };
  var KIND = { OUTING: 'OUTING 외출', OVERNIGHT: 'OVERNIGHT 외박' };
  var VIEWS = [
    ['out', 'Still out — all'],
    ['out_outing', 'Still out — OUTING 외출'],
    ['out_overnight', 'Still out — OVERNIGHT 외박'],
    ['overnight_noon', '외박 · not back by next day 12:00'],
    ['overnight_midnight', '외박 · not back by next day 24:00'],
    ['day', 'One day'],
    ['range', 'Date range']
  ];
  var TITLES = {
    out: 'Students still out', out_outing: 'OUTING (외출) — still out', out_overnight: 'OVERNIGHT (외박) — still out',
    overnight_noon: 'OVERNIGHT (외박) — NOT BACK by next day 12:00', overnight_midnight: 'OVERNIGHT (외박) — NOT BACK by next day 24:00'
  };
  function stageText(r) {
    return r.overnightStage === 2 ? 'NOT BACK 24:00' : r.overnightStage === 1 ? 'NOT BACK 12:00' : '';
  }

  function pill(st) {
    var s = STATUS[st] || { text: st, bg: '#EEE', fg: '#333' };
    return '<span class="ot-tint" style="display:inline-block;padding:1px 8px;border-radius:9px;font-size:11px;font-weight:700;background:' +
      s.bg + ';color:' + s.fg + '">' + OfficeKit.esc(s.text) + '</span>';
  }
  function two(n) { return ('0' + n).slice(-2); }
  // ISO -> "11-24 21:05" in the browser's (office) time
  function short(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return two(d.getMonth() + 1) + '-' + two(d.getDate()) + ' ' + two(d.getHours()) + ':' + two(d.getMinutes());
  }
  function localInput(d) { // value for <input type="datetime-local">
    return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()) + 'T' + two(d.getHours()) + ':' + two(d.getMinutes());
  }
  function duration(min) {
    if (!min) return '';
    var h = Math.floor(min / 60), m = min % 60;
    return (h ? h + 'h ' : '') + m + 'm';
  }
  function lsGet(k, d) { try { return localStorage.getItem(k) || d; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }

  window.OfficeTabs = window.OfficeTabs || {};
  window.OfficeTabs['OUTING'] = {
    mount: function (root, ctx) {
      root.classList.add('g3');
      if (!document.getElementById('outingCss')) {
        var st = document.createElement('style');
        st.id = 'outingCss';
        st.textContent =
          '[data-tab="OUTING"] tr.cur .ot-tint{color:#FFF !important;background:transparent !important;}' +
          '[data-tab="OUTING"] .ot-tile{position:absolute;top:76px;height:62px;width:186px;border-radius:6px;color:#FFF;padding:8px 14px;box-sizing:border-box;cursor:pointer;user-select:none}' +
          '[data-tab="OUTING"] .ot-tile.on{outline:3px solid #222;outline-offset:2px}' +
          '[data-tab="OUTING"] .ot-tile b{display:block;font-size:26px;line-height:30px}' +
          '[data-tab="OUTING"] .ot-tile span{font-size:11px;white-space:nowrap;font-weight:700;letter-spacing:.5px}' +
          '[data-tab="OUTING"] .ot-kind{position:absolute;height:46px;width:168px;border:2px solid #B8B8C0;background:#FFF;font-weight:700;font-size:15px;cursor:pointer;border-radius:4px}' +
          '[data-tab="OUTING"] .ot-kind.on{border-color:#0078D7;background:#0078D7;color:#FFF}' +
          '[data-tab="OUTING"] .ot-panel input[type=datetime-local]{font:inherit;font-size:14px;padding:3px 6px;border:1px solid #7A7A7A}' +
          '[data-tab="OUTING"] .ot-blink{animation:otBlink 1s step-start infinite}@keyframes otBlink{50%{opacity:.35}}' +
          // Phone (body.m, office.js flowPage): tapped student + CHECK OUT/IN first, the list last; form stacked.
          'body.m [data-tab="OUTING"] .ot-tile{flex:0 0 calc(50% - 4px) !important;width:auto !important;height:64px;padding:6px 10px}' +
          'body.m [data-tab="OUTING"] .ot-tile b{font-size:24px;line-height:28px}' +
          'body.m [data-tab="OUTING"] .ot-tile span{font-size:11px}' +
          'body.m [data-tab="OUTING"] [data-k="info"]{flex:0 0 100% !important;white-space:normal}' +
          'body.m [data-tab="OUTING"] [data-k="who"],body.m [data-tab="OUTING"] [data-k="form"],body.m [data-tab="OUTING"] [data-k="hist"]' +
          '{flex:0 0 100% !important;width:100% !important;height:auto !important;box-sizing:border-box;background:#FFF;border:1px solid #D8D8DE;padding:10px;scroll-margin-top:150px}' +
          'body.m [data-tab="OUTING"] [data-k="who"]{border-width:2px;border-color:#0078D7}' +
          'body.m [data-tab="OUTING"] [data-k="form"]>*{position:static !important;width:auto !important;margin:0 0 10px}' +
          'body.m [data-tab="OUTING"] [data-k="form"] .ot-kind{display:inline-block;width:calc(50% - 5px) !important;height:56px;margin:0 6px 10px 0}' +
          'body.m [data-tab="OUTING"] [data-k="form"] .ot-kind+.ot-kind{margin-right:0}' +
          'body.m [data-tab="OUTING"] [data-k="form"] input[type=datetime-local],body.m [data-tab="OUTING"] [data-k="form"] .g3-txt' +
          '{width:100% !important;height:40px !important;box-sizing:border-box}' +
          'body.m [data-tab="OUTING"] [data-k="form"] .flat.big{display:block;width:100% !important;height:60px !important;font-size:17px}' +
          'body.m [data-tab="OUTING"] [data-k="form"] button[data-f="rowBack"],body.m [data-tab="OUTING"] [data-k="form"] button[data-f="undo"],' +
          'body.m [data-tab="OUTING"] [data-k="form"] button[data-f="void"]{width:calc(33% - 6px) !important;height:40px !important}' +
          'body.m [data-tab="OUTING"] [data-k="grid"]{order:10000 !important}';
        document.head.appendChild(st);
      }
      var A = 'position:absolute;';
      function tile(k, v, i, bg, label) {
        return '<div class="ot-tile" data-k="' + k + '" data-view="' + v + '" style="left:' + (16 + i * 194) + 'px;background:' + bg + '"><span>' + label + '</span><b>0</b></div>';
      }
      root.innerHTML =
        '<div class="g3-page">' +
        '<div class="g3-top g3-abs" style="left:0;top:0;width:1698px;height:64px"></div>' +
        '<span class="g3-lbl g3-abs b" style="left:16px;top:22px">UID:</span>' +
        '<input class="g3-txt g3-abs" data-k="uid" type="text" maxlength="20" spellcheck="false" autocomplete="off" placeholder="tap card or type UID, Enter" style="left:52px;top:17px;width:220px;height:29px">' +
        '<span class="g3-lbl g3-abs b" style="left:300px;top:22px">SHOW:</span>' +
        '<div class="g3-combo g3-abs" style="left:352px;top:17px;width:200px;height:29px"><select data-k="view">' +
        VIEWS.map(function (v) { return '<option value="' + v[0] + '">' + v[1] + '</option>'; }).join('') +
        '</select><span class="g3-chev"></span></div>' +
        '<input class="g3-txt g3-abs" data-k="from" type="date" style="left:566px;top:17px;width:150px;height:29px">' +
        '<span class="g3-lbl g3-abs" data-k="tilde" style="left:724px;top:22px">~</span>' +
        '<input class="g3-txt g3-abs" data-k="to" type="date" style="left:740px;top:17px;width:150px;height:29px">' +
        '<span class="g3-lbl g3-abs b" style="left:910px;top:22px">NAME:</span>' +
        '<input class="g3-txt g3-abs" data-k="search" type="text" spellcheck="false" autocomplete="off" placeholder="filter list" style="left:962px;top:17px;width:170px;height:29px">' +
        '<button class="flat" data-k="refresh" style="' + A + 'left:1146px;top:13px;width:100px;height:38px;background:#0078D7">REFRESH</button>' +
        '<button class="flat" data-k="excel" style="' + A + 'left:1256px;top:13px;width:90px;height:38px;background:#2E7D32">EXCEL</button>' +
        '<button class="flat" data-k="print" style="' + A + 'left:1356px;top:13px;width:90px;height:38px;background:#6E6E78">PRINT</button>' +
        '<span class="g3-lbl g3-abs b" style="left:1470px;top:22px">CURFEW:</span>' +
        '<input class="g3-txt g3-abs" data-k="curfew" type="time" style="left:1540px;top:17px;width:140px;height:29px" title="Default return time for OUTING (today) and OVERNIGHT (next day)">' +

        tile('tOut', 'out_outing', 0, '#1976D2', '외출 OUTING · OUT') +
        tile('tOutLate', 'out_outing', 1, '#E65100', '외출 · PAST RETURN TIME') +
        tile('tNight', 'out_overnight', 2, '#6A1B9A', '외박 OVERNIGHT · OUT') +
        tile('tNoon', 'overnight_noon', 3, '#AD1457', '외박 · NOT BACK 다음날 12:00') +
        tile('tMid', 'overnight_midnight', 4, '#B71C1C', '외박 · NOT BACK 다음날 24:00') +
        tile('tBack', 'day', 5, '#2E7D32', 'BACK TODAY 오늘 복귀') +
        '<span class="g3-lbl g3-abs" data-k="info" style="left:16px;top:142px;color:#555"></span>' +

        '<div data-k="grid" style="' + A + 'left:16px;top:164px;width:1150px;height:698px"></div>' +

        '<div class="g3-white g3-abs ot-panel" style="left:1180px;top:76px;width:502px;height:786px;border:1px solid #D8D8DE"></div>' +
        '<div data-k="who" style="' + A + 'left:1196px;top:88px;width:470px;height:150px;font-size:13.33px;line-height:1.6"></div>' +
        '<div data-k="form" class="ot-panel" style="' + A + 'left:1196px;top:246px;width:470px;height:420px"></div>' +
        '<div data-k="hist" style="' + A + 'left:1196px;top:676px;width:470px;height:178px;overflow:auto;font-size:12px;line-height:1.5"></div>' +
        '</div>';

      function q(k) { return root.querySelector('[data-k="' + k + '"]'); }
      var view = q('view'), from = q('from'), to = q('to'), curfew = q('curfew');
      view.value = lsGet('outingView', 'out');
      if (!view.value) view.value = 'out';
      curfew.value = lsGet('outingCurfew', '22:00');
      from.value = to.value = OfficeKit.iso(new Date());

      var rows = [];
      var student = null;   // byUid() result of the last tapped card
      var kind = 'OUTING';
      var saving = false;

      var grid = OfficeKit.grid(q('grid'), {
        rowHeight: 32,
        emptyText: 'Nobody here. Tap a student card to record an outing.',
        onCurrent: function () { renderForm(); },
        onDblClick: function (r) { if (r && r.uid) lookup(r.uid); },
        columns: [
          { key: 'studentName', header: 'Student', width: 180 },
          { key: 'campus', header: 'Campus', width: 70 },
          { key: 'kind', header: 'Type', width: 120, render: function (r) {
            return '<b class="ot-tint" style="color:' + (r.kind === 'OVERNIGHT' ? '#6A1B9A' : '#1976D2') + '">' + OfficeKit.esc(KIND[r.kind] || r.kind) + '</b>';
          } },
          { key: 'outAt', header: 'Out', width: 90, render: function (r) { return OfficeKit.esc(short(r.outAt)); } },
          { key: 'expectedReturnAt', header: 'Return by', width: 90, render: function (r) { return OfficeKit.esc(short(r.expectedReturnAt)); } },
          { key: 'returnedAt', header: 'Back', width: 90, render: function (r) { return OfficeKit.esc(short(r.returnedAt)); } },
          { key: 'status', header: 'Status', width: 135, render: function (r) {
            return pill(r.status) + (r.lateMinutes ? ' <span class="ot-tint" style="color:#C62828;font-size:11px">+' + duration(r.lateMinutes) + '</span>' : '');
          } },
          { key: 'overnightStage', header: '외박 check', width: 125, render: function (r) {
            if (r.kind !== 'OVERNIGHT') return '';
            if (!r.overnightStage) return '<span class="ot-tint" style="color:#2E7D32;font-size:11px">OK</span>';
            var bg = r.overnightStage === 2 ? '#B71C1C' : '#AD1457';
            return '<span class="ot-tint" style="display:inline-block;padding:1px 6px;border-radius:9px;font-size:11px;font-weight:700;color:#FFF;background:' + bg + '">' +
              (r.returnedAt ? 'LATE ' : '') + stageText(r) + '</span>';
          } },
          { key: 'destination', header: 'Where', width: 100 },
          { key: 'outBy', header: 'Staff', width: 80, render: function (r) {
            return OfficeKit.esc((r.outBy || '') + (r.returnedBy && r.returnedBy !== r.outBy ? ' / ' + r.returnedBy : ''));
          } },
          { key: 'uid', header: 'UID', width: 80 }
        ]
      });

      /* ---------- list ---------- */
      function syncDateInputs() {
        var v = view.value;
        from.style.display = v === 'day' || v === 'range' ? '' : 'none';
        to.style.display = q('tilde').style.display = v === 'range' ? '' : 'none';
      }
      function filtered() {
        var s = q('search').value.trim().toUpperCase();
        if (!s) return rows;
        return rows.filter(function (r) { return (r.studentName + ' ' + (r.uid || '') + ' ' + (r.studentId || '')).toUpperCase().indexOf(s) >= 0; });
      }
      function load() {
        var v = view.value;
        var p = '/api/office/outings?view=' + v + (v === 'day' ? '&day=' + from.value : v === 'range' ? '&from=' + from.value + '&to=' + to.value : '');
        return ctx.api.request('GET', p).then(function (res) {
          rows = res.outings || [];
          var s = res.summary || {};
          [['tOut', s.outing], ['tOutLate', s.outingLate], ['tNight', s.overnight], ['tNoon', s.overnightNoon],
            ['tMid', s.overnightMidnight], ['tBack', s.returnedToday]].forEach(function (t) {
            q(t[0]).querySelector('b').textContent = t[1] || 0;
            q(t[0]).classList.toggle('on', t[0] !== 'tBack' && q(t[0]).getAttribute('data-view') === view.value);
          });
          q('tMid').classList.toggle('ot-blink', !!s.overnightMidnight);
          q('info').textContent = (TITLES[view.value] || title()) + ' · ' + rows.length + ' student(s) · updated ' + short(res.now).slice(6);
          grid.setRows(filtered());
          renderForm();
        }).catch(OfficeKit.fail(ctx, 'Cannot load the outing list'));
      }

      /* ---------- tapped student ---------- */
      function lookup(uid) {
        uid = String(uid || '').trim();
        if (!uid) return Promise.resolve();
        q('uid').value = uid.toUpperCase();
        return ctx.api.request('GET', '/api/office/outings/by-uid/' + encodeURIComponent(uid)).then(function (res) {
          student = res;
          kind = 'OUTING';
          renderWho();
          renderForm();
          // Phone: the student panel sits above the list; bring it (and CHECK OUT / CHECK IN) into view.
          if (document.body.classList.contains('m')) q('who').scrollIntoView({ block: 'start', behavior: 'smooth' });
          // Out now and the card is tapped again -> the student is back.
          if (res.open && autoReturn()) return checkIn(res.open, true);
        }).catch(function (e) {
          student = null; renderWho(); renderForm();
          return OfficeKit.fail(ctx, 'Card ' + uid.toUpperCase())(e);
        });
      }
      function autoReturn() { return lsGet('outingAutoReturn', '1') === '1'; }

      function renderWho() {
        var w = q('who');
        if (!student) {
          w.innerHTML = '<div style="font-size:18px;font-weight:700;color:#0078D7;margin-top:30px;text-align:center">TAP STUDENT CARD</div>' +
            '<div style="color:#777;text-align:center">Going out: tap → choose type → CHECK OUT.<br>Coming back: tap again.</div>';
          q('hist').innerHTML = '';
          return;
        }
        var p = student.person, o = student.open;
        w.innerHTML =
          '<div style="font-size:20px;font-weight:700">' + OfficeKit.esc(p.name) + '</div>' +
          '<div>UID ' + OfficeKit.esc(p.uid || '') + ' · ' + OfficeKit.esc(p.campus || '') + (p.studentId ? ' · ID ' + OfficeKit.esc(p.studentId) : '') + '</div>' +
          '<div>Course: ' + OfficeKit.esc(p.startDate || '?') + ' ~ ' + OfficeKit.esc(p.endDate || '?') + '</div>' +
          '<div style="margin-top:6px;font-size:15px">' + (o
            ? pill(o.status) + ' <b>' + o.kind + '</b> since ' + short(o.outAt) + ', return by <b>' + short(o.expectedReturnAt) + '</b>' +
              (o.lateMinutes ? ' <b style="color:#C62828">(' + duration(o.lateMinutes) + ' late)</b>' : '') +
              (o.kind === 'OVERNIGHT' ? '<br><span style="font-size:13px">외박 check: 다음날 12:00 = ' + short(o.nextNoon) + ' · 24:00 = ' + short(o.nextMidnight) +
                (o.overnightStage ? ' <b style="color:#B71C1C">' + stageText(o) + '</b>' : '') + '</span>' : '')
            : '<span style="color:#1B5E20;font-weight:700">ON CAMPUS</span>') + '</div>';
        var h = (student.recent || []).filter(function (r) { return !o || r.id !== o.id; });
        q('hist').innerHTML = '<b>Recent</b><br>' + (h.length ? h.map(function (r) {
          return OfficeKit.esc(short(r.outAt) + ' → ' + (short(r.returnedAt) || '—') + '  ' + r.kind + (r.destination ? '  · ' + r.destination : '')) +
            (r.status === 'returned_late' ? ' <b style="color:#8A4B00">late ' + duration(r.lateMinutes) + '</b>' : '');
        }).join('<br>') : '<span style="color:#888">No earlier outings.</span>');
      }

      function defaultReturn(k) {
        var t = (curfew.value || '22:00').split(':');
        var d = new Date();
        d.setSeconds(0, 0);
        d.setHours(Number(t[0]) || 22, Number(t[1]) || 0);
        if (k === 'OVERNIGHT') { d.setDate(d.getDate() + 1); d.setHours(12, 0); }
        else if (d.getTime() <= Date.now()) d = new Date(Date.now() + 2 * 3600000); // after curfew: 2 hours
        return d;
      }

      function renderForm() {
        var f = q('form');
        var sel = grid.current();
        var html = '';
        if (student && !student.open) {
          html +=
            '<div style="font-weight:700;margin-bottom:6px">GOING OUT</div>' +
            '<button type="button" class="ot-kind' + (kind === 'OUTING' ? ' on' : '') + '" data-kind="OUTING" style="left:0;top:26px">OUTING<br><small style="font-weight:400">외출 · same day</small></button>' +
            '<button type="button" class="ot-kind' + (kind === 'OVERNIGHT' ? ' on' : '') + '" data-kind="OVERNIGHT" style="left:182px;top:26px">OVERNIGHT<br><small style="font-weight:400">외박 · sleep outside</small></button>' +
            '<div style="position:absolute;left:0;top:86px">Return by<br><input type="datetime-local" data-f="ret" style="width:240px"></div>' +
            '<div style="position:absolute;left:0;top:140px">Where / with whom<br><input class="g3-txt" data-f="dest" maxlength="120" style="position:static;width:440px;height:28px" placeholder="e.g. SM Mall, Cebu City / friend\'s place"></div>' +
            '<div style="position:absolute;left:0;top:196px">Memo<br><input class="g3-txt" data-f="memo" maxlength="300" style="position:static;width:440px;height:28px" placeholder="phone no., permission, ..."></div>' +
            '<button class="flat big" data-f="out" style="position:absolute;left:0;top:258px;width:440px;height:58px;background:#C62828">CHECK OUT ' + kind + '</button>';
        } else if (student && student.open) {
          html +=
            '<div style="font-weight:700;margin-bottom:6px">COMING BACK</div>' +
            '<button class="flat big" data-f="back" style="position:absolute;left:0;top:30px;width:440px;height:58px;background:#2E7D32">CHECK IN · BACK ON CAMPUS</button>';
        }
        html += '<div style="position:absolute;left:0;top:330px;width:470px;border-top:1px solid #E3E3E8;padding-top:8px">' +
          '<label style="font-size:12px"><input type="checkbox" data-f="auto"' + (autoReturn() ? ' checked' : '') + '> Tap of a student who is out = CHECK IN at once</label><br>' +
          '<span style="font-size:12px;color:#555">Selected row' + (sel ? ': <b>' + OfficeKit.esc(sel.studentName) + '</b>' : ': none') + '</span><br>' +
          '<button class="flat" data-f="rowBack" style="position:static;width:112px;height:32px;margin-top:4px;background:#2E7D32">CHECK IN</button> ' +
          '<button class="flat" data-f="undo" style="position:static;width:112px;height:32px;background:#FF9800">UNDO BACK</button> ' +
          '<button class="flat" data-f="void" style="position:static;width:112px;height:32px;background:#6E6E78">VOID</button>' +
          '</div>';
        f.innerHTML = html;

        function g(k) { return f.querySelector('[data-f="' + k + '"]'); }
        var ret = g('ret');
        if (ret) ret.value = localInput(defaultReturn(kind));
        Array.prototype.forEach.call(f.querySelectorAll('.ot-kind'), function (b) {
          b.addEventListener('click', function () { kind = b.getAttribute('data-kind'); renderForm(); });
        });
        if (g('out')) g('out').addEventListener('click', function () { OfficeKit.busy(g('out'), checkOut(g('ret').value, g('dest').value, g('memo').value)); });
        if (g('back')) g('back').addEventListener('click', function () { OfficeKit.busy(g('back'), checkIn(student.open, false)); });
        g('auto').addEventListener('change', function () { lsSet('outingAutoReturn', g('auto').checked ? '1' : '0'); });
        var canBack = sel && (sel.status === 'out' || sel.status === 'late');
        var canUndo = sel && (sel.status === 'returned' || sel.status === 'returned_late');
        g('rowBack').disabled = !canBack;
        g('undo').disabled = !canUndo;
        g('void').disabled = !sel;
        g('rowBack').addEventListener('click', function () { if (canBack) OfficeKit.busy(g('rowBack'), checkIn(sel, false)); });
        g('undo').addEventListener('click', function () { if (canUndo) OfficeKit.busy(g('undo'), undo(sel)); });
        g('void').addEventListener('click', function () { if (sel) OfficeKit.busy(g('void'), voidRow(sel)); });
      }

      /* ---------- writes ---------- */
      function refreshStudent() {
        return student ? ctx.api.request('GET', '/api/office/outings/by-uid/' + encodeURIComponent(student.person.uid))
          .then(function (r) { student = r; renderWho(); }, function () { /* keep the old panel */ }) : Promise.resolve();
      }

      function checkOut(retValue, dest, memo) {
        if (saving || !student) return Promise.resolve();
        var at = new Date(retValue);
        if (!retValue || isNaN(at.getTime())) return ctx.messageBox('Set the return time.', 'SMEAG', 'OK', 'warning');
        if (at.getTime() <= Date.now()) return ctx.messageBox('The return time is already past.', 'SMEAG', 'OK', 'warning');
        saving = true;
        var key = 'out-' + student.person.id + '-' + Date.now();
        return ctx.api.request('POST', '/api/office/outings', {
          uid: student.person.uid, kind: kind, expectedReturnAt: at.toISOString(), destination: dest, memo: memo, clientKey: key
        }).then(function (res) {
          var o = res.outing;
          q('info').textContent = '✔ ' + o.studentName + ' — ' + o.kind + ' out, return by ' + short(o.expectedReturnAt);
        }, OfficeKit.fail(ctx, 'Check out failed')).then(function () {
          saving = false;
          return Promise.all([refreshStudent(), load()]);
        });
      }

      function checkIn(o, fromTap) {
        if (saving || !o) return Promise.resolve();
        saving = true;
        return ctx.api.request('POST', '/api/office/outings/' + o.id + '/return', {}).then(function (res) {
          var r = res.outing;
          q('info').textContent = '✔ ' + r.studentName + ' is back ' + short(r.returnedAt).slice(6) + (fromTap ? ' (card tap)' : '');
          if (r.status === 'returned_late') {
            return ctx.messageBox(r.studentName + ' came back LATE.\n\n' + r.kind + ': return by ' + short(r.expectedReturnAt) +
              '\nBack: ' + short(r.returnedAt) + '  (' + duration(r.lateMinutes) + ' late)', 'LATE RETURN', 'OK', 'warning');
          }
        }, OfficeKit.fail(ctx, 'Check in failed')).then(function () {
          saving = false;
          return Promise.all([refreshStudent(), load()]);
        });
      }

      function undo(r) {
        return ctx.messageBox('Undo the return of ' + r.studentName + '?\nThe student will be shown as OUT again.', 'UNDO BACK', 'YesNo', 'question').then(function (a) {
          if (a !== 'Yes') return;
          return ctx.api.request('POST', '/api/office/outings/' + r.id + '/undo-return', {})
            .catch(OfficeKit.fail(ctx, 'Undo failed')).then(function () { return Promise.all([refreshStudent(), load()]); });
        });
      }

      function voidRow(r) {
        return Promise.resolve(ctx.inputDialog('VOID OUTING', 'Why is this record of ' + r.studentName + ' wrong?')).then(function (reason) {
          if (reason == null || !String(reason).trim()) return;
          return ctx.api.request('POST', '/api/office/outings/' + r.id + '/void', { reason: String(reason).trim() })
            .catch(OfficeKit.fail(ctx, 'Void failed')).then(function () { return Promise.all([refreshStudent(), load()]); });
        });
      }

      /* ---------- export ---------- */
      var EXPORT_COLS = [
        { key: 'studentName', header: 'Student', width: 200 }, { key: 'campus', header: 'Campus', width: 80 },
        { key: 'kind', header: 'Type', width: 90 }, { key: 'outAtText', header: 'Out', width: 110 },
        { key: 'expText', header: 'Return by', width: 110 }, { key: 'backText', header: 'Back', width: 110 },
        { key: 'statusText', header: 'Status', width: 120 }, { key: 'lateText', header: 'Late', width: 70 },
        { key: 'checkText', header: '외박 check', width: 120 },
        { key: 'destination', header: 'Where', width: 160 }, { key: 'memo', header: 'Memo', width: 160 },
        { key: 'outBy', header: 'Out staff', width: 90 }, { key: 'returnedBy', header: 'Back staff', width: 90 }, { key: 'uid', header: 'UID', width: 110 }
      ];
      function exportRows() {
        return filtered().map(function (r) {
          return Object.assign({}, r, { outAtText: short(r.outAt), expText: short(r.expectedReturnAt), backText: short(r.returnedAt),
            statusText: (STATUS[r.status] || {}).text || r.status, lateText: duration(r.lateMinutes),
            checkText: r.kind === 'OVERNIGHT' ? (stageText(r) || 'OK') : '' });
        });
      }
      function title() {
        if (TITLES[view.value]) return TITLES[view.value] + ' (' + OfficeKit.iso(new Date()) + ' ' + short(new Date().toISOString()).slice(6) + ')';
        return view.value === 'day' ? 'Outings ' + from.value : 'Outings ' + from.value + ' ~ ' + to.value;
      }

      /* ---------- events ---------- */
      view.addEventListener('change', function () { lsSet('outingView', view.value); syncDateInputs(); load(); });
      from.addEventListener('change', load);
      to.addEventListener('change', load);
      curfew.addEventListener('change', function () { lsSet('outingCurfew', curfew.value || '22:00'); renderForm(); });
      q('search').addEventListener('input', function () { grid.setRows(filtered()); renderForm(); });
      q('refresh').addEventListener('click', function () { OfficeKit.busy(q('refresh'), load()); });
      q('excel').addEventListener('click', function () {
        OfficeKit.busy(q('excel'), OfficeKit.downloadXlsx('outing-' + OfficeKit.iso(new Date()) + '.xlsx',
          [{ name: 'Outing', title: title(), columns: EXPORT_COLS, rows: exportRows() }]));
      });
      q('print').addEventListener('click', function () {
        OfficeKit.printDoc(title(), '<h2>' + OfficeKit.esc(title()) + '</h2>' + OfficeKit.tableHtml(EXPORT_COLS, exportRows()), { landscape: true });
      });
      q('uid').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); lookup(q('uid').value); } });
      Array.prototype.forEach.call(root.querySelectorAll('.ot-tile'), function (t) {
        t.addEventListener('click', function () {
          view.value = t.getAttribute('data-view');
          if (view.value === 'day') from.value = OfficeKit.iso(new Date());
          lsSet('outingView', view.value); syncDateInputs(); load();
        });
      });

      // LATE changes with the clock: reload every minute while the tab is open
      setInterval(function () { if (!root.hidden && !saving) load(); }, 60000);

      syncDateInputs();
      renderWho();
      renderForm();
      var loaded = false;
      this._show = function () { if (!loaded) { loaded = true; load(); } };

      return { onNfc: function (uid) { lookup(uid); } };
    },
    show: function () { if (this._show) this._show(); }
  };
})();
