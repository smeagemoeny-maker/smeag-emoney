/* SME REFUND tab — registers window.OfficeTabs['SME REFUND'] (see showPage() in office.js).
   smeadmin.com refund requests (student allowance via Alipay etc.) -> e-money refund, matched by passport.
   API: GET /api/office/sme-refunds, POST .../sync, GET .../by-passport, POST .../:no/link, POST .../:no/pay
   (api/src/smeadminRefund.mjs). smeadmin itself is read-only from here: staff still set 환급완료 there. */
(function () {
  'use strict';

  var STATUS = {
    pending: { text: 'READY', bg: '#E3F2E5', fg: '#1B5E20' },
    mismatch: { text: 'CHECK AMOUNT', bg: '#FFF3D6', fg: '#8A4B00' },
    paid: { text: 'PAID', bg: '#DCEBFA', fg: '#0B4F8A' },
    paid_then_cancelled: { text: 'PAID → CANCELLED', bg: '#FBDDDB', fg: '#9B1C14' },
    cancelled: { text: 'CANCELLED', bg: '#EDEDED', fg: '#555' },
    closed: { text: 'DONE IN SMEADMIN', bg: '#EDEDED', fg: '#555' },
    other: { text: 'NOT E-MONEY', bg: '#F1EEF7', fg: '#4A3B6B' }
  };
  var FILTERS = [
    ['To pay (ready + check)', 'pending,mismatch,paid_then_cancelled'],
    ['Ready', 'pending'], ['Check amount', 'mismatch'], ['Paid', 'paid'],
    ['Paid then cancelled', 'paid_then_cancelled'], ['Not e-money', 'other'],
    ['Done in smeadmin', 'closed'], ['Cancelled', 'cancelled'], ['All', 'all']
  ];

  function pill(status) {
    var s = STATUS[status] || { text: status, bg: '#EEE', fg: '#333' };
    return '<span style="display:inline-block;padding:1px 8px;border-radius:9px;font-size:11px;font-weight:700;background:' +
      s.bg + ';color:' + s.fg + '">' + OfficeKit.esc(s.text) + '</span>';
  }
  function ago(iso) {
    if (!iso) return 'never';
    var m = Math.round((Date.now() - Date.parse(iso)) / 60000);
    return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : Math.round(m / 60) + ' h ago';
  }

  window.OfficeTabs = window.OfficeTabs || {};
  window.OfficeTabs['SME REFUND'] = {
    mount: function (root, ctx) {
      root.classList.add('g3');
      // coloured text inside the selected (blue) row: show it white so it stays readable
      if (!document.getElementById('smeRefundCss')) {
        var st = document.createElement('style');
        st.id = 'smeRefundCss';
        st.textContent = '[data-tab="SME REFUND"] tr.cur .sr-tint{color:#FFF !important;}';
        document.head.appendChild(st);
      }
      var A = 'position:absolute;';
      root.innerHTML =
        '<div class="g3-page">' +
        '<div class="g3-top g3-abs" style="left:0;top:0;width:1698px;height:64px"></div>' +
        '<button class="flat" data-k="sync" style="' + A + 'left:16px;top:13px;width:130px;height:38px;background:#0078D7">SYNC smeadmin</button>' +
        '<span class="g3-lbl g3-abs" data-k="syncInfo" style="left:160px;top:22px;color:#555"></span>' +
        '<span class="g3-lbl g3-abs b" style="left:560px;top:22px">SHOW:</span>' +
        '<div class="g3-combo g3-abs" style="left:615px;top:17px;width:230px;height:29px"><select data-k="filter"></select><span class="g3-chev"></span></div>' +
        '<span class="g3-lbl g3-abs b" style="left:880px;top:22px">PASSPORT:</span>' +
        '<input class="g3-txt g3-abs" data-k="passport" type="text" maxlength="20" spellcheck="false" autocomplete="off" placeholder="type passport no., Enter" style="left:965px;top:17px;width:230px;height:29px;text-transform:uppercase">' +
        '<button class="flat" data-k="find" style="' + A + 'left:1205px;top:13px;width:90px;height:38px;background:#6E6E78">FIND</button>' +
        '<button class="flat" data-k="clear" style="' + A + 'left:1305px;top:13px;width:90px;height:38px;background:#9A9AA2">CLEAR</button>' +
        '<span class="g3-lbl g3-abs" data-k="findInfo" style="left:1410px;top:22px;color:#0B4F8A;font-weight:700"></span>' +
        '<div data-k="grid" style="' + A + 'left:16px;top:76px;width:1666px;height:520px"></div>' +
        '<div class="g3-white g3-abs" style="left:16px;top:608px;width:1666px;height:255px;border:1px solid #D8D8DE"></div>' +
        '<div data-k="detail" style="' + A + 'left:32px;top:620px;width:1000px;height:232px;font-size:13.33px;line-height:1.55;overflow:auto"></div>' +
        '<div data-k="card" style="' + A + 'left:1050px;top:620px;width:380px;height:170px;font-size:13.33px;line-height:1.6"></div>' +
        '<button class="flat" data-k="link" style="' + A + 'left:1445px;top:624px;width:220px;height:44px;background:#6A1B9A">LINK TAPPED CARD</button>' +
        '<button class="flat big" data-k="pay" style="' + A + 'left:1445px;top:684px;width:220px;height:60px;background:#C62828">PAY REFUND</button>' +
        '<span class="g3-lbl g3-abs" data-k="tap" style="left:1050px;top:800px;width:615px;white-space:normal;height:auto;color:#6A1B9A;font-weight:700"></span>' +
        '</div>';

      function q(k) { return root.querySelector('[data-k="' + k + '"]'); }
      var filter = q('filter');
      FILTERS.forEach(function (f) { var o = document.createElement('option'); o.value = f[1]; o.textContent = f[0]; filter.appendChild(o); });
      try { var saved = localStorage.getItem('smeRefundFilter'); if (saved) filter.value = saved; } catch (e) { /* ignore */ }
      if (!filter.value) filter.value = FILTERS[0][1];

      var rows = [];
      var tolerance = 2;
      var item = 'Student allowance';
      var tappedUid = '';
      var passportMode = null;  // last passport search, or null for the list

      var grid = OfficeKit.grid(q('grid'), {
        rowHeight: 32,
        emptyText: 'No refund requests. Press SYNC to read smeadmin.',
        onCurrent: function () { tappedUid = ''; renderDetail(); },
        columns: [
          { key: 'changeNo', header: 'No.', width: 70, format: 'int', align: 'right' },
          { key: 'appliedAt', header: 'Applied', width: 160 },
          { key: 'name', header: 'Student (smeadmin)', width: 220 },
          { key: 'campus', header: 'Campus', width: 90 },
          { key: 'amountText', header: 'Amount', width: 100, align: 'right' },
          { key: 'rmb', header: 'RMB × rate', width: 140, align: 'right', render: function (r) {
            return r.rmb != null && r.rate != null ? OfficeKit.esc(r.rmb + ' × ' + r.rate) : '';
          } },
          { key: 'checkDiff', header: 'Diff', width: 80, align: 'right', render: function (r) {
            if (r.checkDiff == null) return '';
            var bad = Math.abs(r.checkDiff) > tolerance;
            return '<span class="sr-tint" style="color:' + (bad ? '#C62828;font-weight:700' : '#2E7D32') + '">' + OfficeKit.money(r.checkDiff) + '</span>';
          } },
          { key: 'status', header: 'Status', width: 170, render: function (r) { return pill(r.status); } },
          { key: 'passportLast4', header: 'Passport', width: 95, render: function (r) {
            return r.passportLast4 ? '•••' + OfficeKit.esc(r.passportLast4) : (r.kind === 'allowance' ? '<span class="sr-tint" style="color:#C62828">none</span>' : '');
          } },
          { key: 'card', header: 'E-money card', width: 330, render: function (r) {
            if (!r.card) return r.kind === 'allowance' && r.hasPassport ? '<span class="sr-tint" style="color:#6A1B9A">not linked — tap card</span>' : '';
            return OfficeKit.esc(r.card.uid + ' · ' + r.card.name) + (r.card.nameMatches ? '' : ' <b style="color:#C62828">(name differs)</b>');
          } },
          { key: 'paidAt', header: 'Paid', width: 180, render: function (r) {
            return r.paidAt ? OfficeKit.esc(String(r.paidAt).replace('T', ' ').slice(0, 16) + ' ' + (r.paidBy || '')) : '';
          } }
        ]
      });

      function current() { return grid.current(); }

      function renderDetail() {
        var r = current();
        var d = q('detail'), c = q('card'), btnPay = q('pay'), btnLink = q('link'), tap = q('tap');
        if (!r) {
          d.innerHTML = '<span style="color:#888">Select a request.</span>';
          c.innerHTML = ''; tap.textContent = '';
          btnPay.disabled = true; btnLink.disabled = true;
          return;
        }
        var check = r.checkDiff == null ? 'no RMB / rate in the note'
          : r.rmb + ' RMB × ' + r.rate + ' = ' + OfficeKit.money(r.rmb * r.rate) + ' P  (diff ' + OfficeKit.money(r.checkDiff) + ', allowed ±' + tolerance + ')';
        d.innerHTML =
          '<div style="font-size:16px;font-weight:700">#' + r.changeNo + ' · ' + OfficeKit.esc(r.name) + ' ' + pill(r.status) + '</div>' +
          '<div>Agency: ' + OfficeKit.esc(r.agency || '') + ' · Campus: ' + OfficeKit.esc(r.campus || '') + ' · Applied: ' + OfficeKit.esc(r.appliedAt || '') +
          (r.studentNo ? ' · smeadmin student no. ' + r.studentNo : '') + '</div>' +
          '<div>Amount: <b>' + OfficeKit.esc(r.amountText || '') + '</b>' + (r.currency && r.currency !== 'PHP' ? ' <b style="color:#C62828">(' + r.currency + ', not pesos)</b>' : '') +
          ' · Check: ' + OfficeKit.esc(check) + '</div>' +
          '<div style="white-space:pre-wrap;background:#F7F7FA;border:1px solid #E3E3E8;padding:6px 8px;margin-top:4px">' + OfficeKit.esc(r.note || '(no note)') + '</div>' +
          (r.status === 'paid_then_cancelled' ? '<div style="color:#9B1C14;font-weight:700;margin-top:4px">Paid here, then cancelled in smeadmin. Check with the manager whether the money must be put back (+ INCREASE in OFFICE MENU).</div>' : '') +
          (r.status === 'paid' ? '<div style="color:#0B4F8A;margin-top:4px">Now set this request to 환급완료(Refunded) in smeadmin.</div>' : '');

        if (r.card) {
          c.innerHTML = '<b>Linked card</b><br>UID: ' + OfficeKit.esc(r.card.uid) + '<br>Name: ' + OfficeKit.esc(r.card.name) +
            (r.card.nameMatches ? '' : ' <b style="color:#C62828">(differs from smeadmin)</b>') +
            '<br>Campus: ' + OfficeKit.esc(r.card.campus || '') + '<br>Balance: <b>' + OfficeKit.money(r.card.balance) + ' PHP</b>' +
            (r.amount ? '<br>After refund: ' + OfficeKit.money(r.card.balance - r.amount) + ' PHP' : '');
        } else {
          c.innerHTML = r.kind !== 'allowance' ? '<span style="color:#888">Not paid from the e-money card.</span>'
            : !r.hasPassport ? '<span style="color:#C62828">smeadmin has no passport for this registration. Fill PASSPORT NUMBER in smeadmin, then SYNC.</span>'
            : '<span style="color:#6A1B9A">No card linked to this passport yet.</span>';
        }
        var canLink = r.kind === 'allowance' && r.hasPassport && ['pending', 'mismatch'].indexOf(r.status) >= 0;
        btnLink.disabled = !(canLink && tappedUid);
        btnPay.disabled = !(r.status === 'pending' && r.card);
        btnPay.textContent = r.amount ? 'PAY ' + OfficeKit.money(r.amount) + ' P' : 'PAY REFUND';
        tap.textContent = tappedUid ? 'Card tapped: ' + tappedUid
          : canLink ? (r.card ? 'Tap the student\'s card to check it before paying.' : 'Tap the student\'s card, then LINK TAPPED CARD.') : '';
      }

      function setRows(list) {
        rows = list || [];
        grid.setRows(rows);
        renderDetail();
      }

      function load() {
        passportMode = null;
        q('findInfo').textContent = '';
        return ctx.api.request('GET', '/api/office/sme-refunds?status=' + encodeURIComponent(filter.value)).then(function (res) {
          tolerance = res.tolerance; item = res.item || item;
          var s = res.sync;
          q('syncInfo').textContent = s ? 'Last sync: ' + ago(s.lastOkAt) + (s.lastError ? '  ⚠ ' + s.lastError.slice(0, 60) : '') : 'Not synced yet';
          setRows(res.refunds);
        }).catch(OfficeKit.fail(ctx, 'Cannot load smeadmin refunds'));
      }

      function sync() {
        q('syncInfo').textContent = 'Reading smeadmin…';
        return ctx.api.request('POST', '/api/office/sme-refunds/sync', {}).then(function (r) {
          var msg = 'smeadmin read: ' + r.read + ' request(s) (' + r.created + ' new).';
          if (r.noPassport) msg += '\n' + r.noPassport + ' without a passport in smeadmin.';
          if (r.errors && r.errors.length) msg += '\n\nErrors:\n' + r.errors.slice(0, 5).join('\n');
          return load().then(function () { return ctx.messageBox(msg, 'SYNC', 'OK', r.errors && r.errors.length ? 'warning' : 'info'); });
        }).catch(function (e) { load(); return OfficeKit.fail(ctx, 'SYNC failed')(e); });
      }

      function findPassport() {
        var p = q('passport').value.trim();
        if (!p) return load();
        return ctx.api.request('GET', '/api/office/sme-refunds/by-passport?passport=' + encodeURIComponent(p)).then(function (res) {
          passportMode = res;
          q('findInfo').textContent = !res.known ? 'Passport •••' + res.passportLast4 + ': not in smeadmin refunds'
            : 'Passport •••' + res.passportLast4 + ' · ' + (res.name || '') + (res.card ? ' · card ' + res.card.uid + ' · ' + OfficeKit.money(res.card.balance) + ' P' : ' · no card linked');
          setRows(res.refunds);
        }).catch(OfficeKit.fail(ctx, 'Passport search failed'));
      }

      function link(confirmName) {
        var r = current();
        if (!r || !tappedUid) return;
        return ctx.api.request('POST', '/api/office/sme-refunds/' + r.changeNo + '/link', { uid: tappedUid, confirmName: !!confirmName }).then(function () {
          return ctx.messageBox('Card ' + tappedUid + ' is now linked to passport •••' + r.passportLast4 + '.', 'SMEAG', 'OK', 'info');
        }, function (e) {
          var m = String(e && e.message || '');
          if (/NAME_MISMATCH|CARD_CHANGE/.test(m)) {
            return ctx.messageBox(m.replace(/^[A-Z_]+: /, '') + '\n\nLink this card anyway?', 'Check the student', 'YesNo', 'warning').then(function (a) {
              if (a === 'Yes') return link(true);
            });
          }
          return OfficeKit.fail(ctx, 'Link failed')(e);
        }).then(function () { return passportMode ? findPassport() : load(); });
      }

      function pay() {
        var r = current();
        if (!r || !r.card) return;
        return ctx.messageBox('Pay this smeadmin refund from the e-money card?\n\n#' + r.changeNo + '  ' + r.name +
          '\nCard: ' + r.card.uid + ' (' + r.card.name + ')\nRefund / ' + item + ': ' + OfficeKit.money(r.amount) + ' PHP' +
          '\nBalance: ' + OfficeKit.money(r.card.balance) + ' → ' + OfficeKit.money(r.card.balance - r.amount) + ' PHP',
          'PAY REFUND', 'YesNo', 'warning').then(function (a) {
          if (a !== 'Yes') return;
          return ctx.api.request('POST', '/api/office/sme-refunds/' + r.changeNo + '/pay', { uid: tappedUid || undefined }).then(function (res) {
            var t = res.transaction;
            return ctx.messageBox((t.repeated ? 'Already paid before (not charged again).' : 'Refund paid.') + '\n\nNo. ' + t.id +
              '\nBalance: ' + OfficeKit.money(t.balanceAfter) + ' PHP\n\nNow set #' + r.changeNo + ' to 환급완료(Refunded) in smeadmin.', 'SMEAG', 'OK', 'info');
          }, OfficeKit.fail(ctx, 'Refund failed')).then(function () { return passportMode ? findPassport() : load(); });
        });
      }

      filter.addEventListener('change', function () {
        try { localStorage.setItem('smeRefundFilter', filter.value); } catch (e) { /* ignore */ }
        load();
      });
      q('sync').addEventListener('click', function () { OfficeKit.busy(q('sync'), sync()); });
      q('find').addEventListener('click', function () { OfficeKit.busy(q('find'), findPassport()); });
      q('clear').addEventListener('click', function () { q('passport').value = ''; load(); });
      q('passport').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); findPassport(); } });
      q('link').addEventListener('click', function () { if (!q('link').disabled) OfficeKit.busy(q('link'), link(false)); });
      q('pay').addEventListener('click', function () { if (!q('pay').disabled) OfficeKit.busy(q('pay'), pay()); });

      var loaded = false;
      this._show = function () { if (!loaded) { loaded = true; load(); } };
      renderDetail();

      return {
        onNfc: function (uid) {
          tappedUid = String(uid || '').trim().toUpperCase();
          var r = current();
          if (r && r.card && r.card.uid.toUpperCase() !== tappedUid) {
            ctx.messageBox('This card (' + tappedUid + ') is not the card linked to #' + r.changeNo + ' (' + r.card.uid + ').', 'SMEAG', 'OK', 'warning');
          }
          renderDetail();
        }
      };
    },
    show: function () { if (this._show) this._show(); }
  };
})();
