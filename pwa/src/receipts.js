/* PurchaseView — renders store purchase receipts (from /api/purchases and /api/student/purchases).
   Used by /student/ and /admin/. Each receipt is a <details> card: header = date, store, total; body = item lines.
     PurchaseView.css()                          -> inject the shared styles once
     PurchaseView.list(receipts, { showBuyer })  -> HTML string (newest first, grouped by PH day)
     PurchaseView.money(n)                       -> "1,234.50"                                                   */
(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) {
    var v = Number(n || 0);
    return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function dayLabel(date) {
    var d = String(date || '').slice(0, 10);
    var t = new Date(d + 'T00:00:00Z');
    return isNaN(t) ? d : d.replace(/-/g, '.') + ' (' + DAYS[t.getUTCDay()] + ')';
  }

  var STYLE = [
    '.pv-day{margin:18px 0 6px;font-size:12px;font-weight:600;color:var(--pv-ink2,#6b655c);letter-spacing:.02em}',
    '.pv-r{background:var(--pv-card,#fff);border:1px solid var(--pv-line,#dedad1);border-radius:12px;margin:0 0 8px;overflow:hidden}',
    '.pv-r>summary{list-style:none;cursor:pointer;display:grid;grid-template-columns:auto 1fr auto;gap:4px 12px;align-items:center;padding:12px 14px}',
    '.pv-r>summary::-webkit-details-marker{display:none}',
    '.pv-r[open]>summary{border-bottom:1px solid var(--pv-line,#dedad1);background:var(--pv-soft,#faf9f6)}',
    '.pv-badge{font-size:11px;font-weight:700;padding:3px 8px;border-radius:999px;white-space:nowrap}',
    '.pv-badge.cafe{background:#fdeee6;color:#b2431a}.pv-badge.mart{background:#e7f1ea;color:#2e6b3a}.pv-badge.store{background:#eceaf6;color:#4b3f8f}',
    '.pv-main{min-width:0}',
    '.pv-store{font-weight:600;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.pv-sub{font-size:12px;color:var(--pv-ink2,#6b655c);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.pv-total{font-weight:700;font-size:15px;font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}',
    '.pv-total small{display:block;font-weight:400;font-size:11px;color:var(--pv-ink2,#6b655c)}',
    '.pv-items{width:100%;border-collapse:collapse;font-size:13px}',
    '.pv-items td{padding:7px 14px;border-bottom:1px solid var(--pv-line2,#f0ede6);vertical-align:top}',
    '.pv-items td.n{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}',
    '.pv-items td.q{color:var(--pv-ink2,#6b655c);white-space:nowrap}',
    '.pv-items tr.pv-sum td{font-weight:700;border-bottom:0}',
    '.pv-meta{display:flex;flex-wrap:wrap;gap:4px 16px;padding:10px 14px 12px;font-size:12px;color:var(--pv-ink2,#6b655c)}',
    '.pv-meta b{color:var(--pv-ink,#1d1d1b);font-weight:600}',
    '.pv-none{padding:12px 14px;font-size:13px;color:var(--pv-ink2,#6b655c)}',
    '@media (max-width:520px){.pv-r>summary{padding:11px 12px;gap:3px 10px}.pv-items td{padding:7px 12px}}'
  ].join('\n');

  var injected = false;
  function css() {
    if (injected) return;
    injected = true;
    var s = document.createElement('style');
    s.textContent = STYLE;
    document.head.appendChild(s);
  }

  // "Tarlac · Tarlac Store" -> "Tarlac Store"; "Encanto · WATER" stays (the category does not name the campus).
  function storeTitle(r) {
    var name = String(r.storeName || '');
    var campus = String(r.campus || '');
    if (!campus || name.toUpperCase().indexOf(campus.toUpperCase()) === 0) return name || campus;
    return campus + ' · ' + name;
  }

  function receiptHtml(r, opts) {
    var store = r.store === 'cafe' ? 'cafe' : r.store === 'mart' ? 'mart' : 'store';
    var label = store === 'cafe' ? 'CAFE' : store === 'mart' ? 'MART' : 'STORE';
    var time = String(r.date || '').slice(11, 16);
    var who = opts.showBuyer ? (r.name || '') + (r.studentId ? ' · ' + r.studentId : '') : '';
    var first = r.items.length ? r.items[0].name + (r.items.length > 1 ? ' +' + (r.items.length - 1) + ' more' : '') : 'Amount only';
    var sub = [time, opts.showBuyer ? who : first].filter(Boolean).join(' · ');
    var body;
    if (r.items.length) {
      body = '<table class="pv-items">' + r.items.map(function (i) {
        return '<tr><td>' + esc(i.name) + '</td><td class="q">' + money(i.unitPrice) + ' × ' + i.quantity + '</td><td class="n">' + money(i.amount) + '</td></tr>';
      }).join('') + '<tr class="pv-sum"><td>Total</td><td class="q">' + (r.itemCount || '') + '</td><td class="n">₱' + money(r.total) + '</td></tr></table>';
    } else {
      body = '<div class="pv-none">This store (Pusan Mart payment) records only the amount, not the items.</div>';
    }
    var meta = [
      ['Date', r.date],
      ['Campus', r.campus],
      ['Store', r.storeName],
      opts.showBuyer ? ['Buyer', who] : null,
      r.discount ? ['Discount', r.discount] : null,
      r.balanceBefore != null ? ['Balance', '₱' + money(r.balanceBefore) + ' → ₱' + money(r.balanceAfter)] : null,
      opts.showBuyer && r.source ? ['Terminal', r.source] : null
    ].filter(Boolean).map(function (m) { return '<span>' + m[0] + ' <b>' + esc(m[1]) + '</b></span>'; }).join('');
    return '<details class="pv-r"><summary>' +
      '<span class="pv-badge ' + store + '">' + label + '</span>' +
      '<span class="pv-main"><div class="pv-store">' + esc(storeTitle(r)) + '</div><div class="pv-sub">' + esc(sub) + '</div></span>' +
      '<span class="pv-total">₱' + money(r.total) + (r.itemCount ? '<small>' + r.itemCount + ' items</small>' : '') + '</span>' +
      '</summary>' + body + '<div class="pv-meta">' + meta + '</div></details>';
  }

  function list(receipts, opts) {
    opts = opts || {};
    var out = [];
    var day = null;
    (receipts || []).forEach(function (r) {
      var d = String(r.date || '').slice(0, 10);
      if (d !== day) { day = d; out.push('<div class="pv-day">' + esc(dayLabel(d)) + '</div>'); }
      out.push(receiptHtml(r, opts));
    });
    return out.join('');
  }

  window.PurchaseView = { css: css, list: list, money: money, esc: esc, storeTitle: storeTitle };
})();
