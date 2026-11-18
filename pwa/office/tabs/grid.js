/* OfficeKit — shared helpers for the /office/ tabs (tabs/*.js). Load before the tab files.

   OfficeKit.grid(container, opts) -> DataGridView-like table inside `container` (an absolutely placed div).
     opts.columns: [{ key, header, width (px), align: 'left'|'right'|'center',
                      format: 'money' (#,##0.00, also in CSV) | 'int' | 'text' (default),
                      editable: bool, options: [..] (editable as a drop-down),
                      render: function (row) -> HTML string (overrides format; not editable) }]
     opts.select:  'row' (single current row, default) | 'multi' (check-box column + header "select all")
     opts.rowHeader: true -> grey WinForms row-header column (default true unless select = 'multi')
     opts.font: CSS font-size for cells (default 12px) ; opts.rowHeight (default 30)
     opts.onCurrent(row), opts.onCheck(checkedRows), opts.onDblClick(row)
   Returns {
     setRows(rows), rows(), current(), checked(), setAllChecked(bool),
     edited()   -> [{ row, changes: { key: newValue } }] (cells changed since setRows),
     clearEdits(), count(), el
   }
   Editing: double-click a cell (or F2 / start typing on the current row) -> text box / drop-down; Enter or blur commits,
   Esc cancels. Edited cells are shown in bold dark-red until setRows() / clearEdits().

   OfficeKit.money(n) "#,##0.00" ; OfficeKit.iso(date) "YYYY-MM-DD" ; OfficeKit.esc(s)
   OfficeKit.busy(button, promise) disables the button until the promise settles; returns the promise.
   OfficeKit.fail(ctx, title) -> function (err) shows err.message in an error MessageBox.
   OfficeKit.printDoc(title, bodyHtml, { landscape }) -> browser print dialog ("Save as PDF" = DOWNLOAD PDF).
   OfficeKit.tableHtml(columns, rows) -> plain <table> HTML for printDoc (same column spec as grid).
   OfficeKit.downloadCsv(fileName, columns, rows)
   OfficeKit.downloadXlsx(fileName, [{ name, columns, rows, title }]) -> Promise (real .xlsx, SheetJS lazy-loaded)
   OfficeKit.readImage(file, maxSide) -> Promise<dataUrl> (JPEG, resized so the longer side <= maxSide). */
(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) {
    if (typeof n === 'string') n = n.replace(/,/g, '').trim();
    if (n === null || n === undefined || n === '' || isNaN(Number(n))) return '';
    var v = Number(n);
    var abs = Math.abs(v);
    // 55.555 -> 55.56 like decimal rounding (toFixed alone gives 55.55); tiny values (1e-7) would break the 'e2' trick.
    abs = abs < 1e-6 ? 0 : Number(Math.round(Number(abs + 'e2')) + 'e-2');
    v = v < 0 ? -abs : abs;
    var neg = v < 0;
    var s = Math.abs(v).toFixed(2).split('.');
    return (neg ? '-' : '') + s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + s[1];
  }
  function iso(d) {
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  function cellText(col, row) {
    var v = row[col.key];
    if (col.format === 'money' || col.format === 'dec2') return money(v); // every amount: #,##0.00
    if (col.format === 'int') return v === null || v === undefined || v === '' ? '' : String(v);
    return v === null || v === undefined ? '' : String(v);
  }

  var CSS = [
    '.og-grid{position:absolute;overflow:auto;background:#FFF;font-family:"Segoe UI",Tahoma,Arial,sans-serif;}',
    '.og-grid table{border-collapse:separate;border-spacing:0;table-layout:fixed;min-width:100%;}',
    '.og-grid thead th{position:sticky;top:0;z-index:2;height:36px;padding:0 6px;background:#0078D7;color:#FFF;font-weight:400;',
    ' text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-right:1px solid #646464;border-bottom:1px solid #646464;',
    ' border-top:1px solid #646464;box-shadow:inset 1px 1px 0 rgba(255,255,255,.6);user-select:none;cursor:default;}',
    '.og-grid thead th:first-child{border-left:1px solid #646464;}',
    '.og-grid tbody td{padding:0 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-right:1px solid #E3E3E8;',
    ' border-bottom:1px solid #E3E3E8;cursor:default;color:#000;background:#FFF;}',
    '.og-grid tbody tr:nth-child(even) td{background:#FAFAFC;}',
    '.og-grid td.r,.og-grid th.r{text-align:right;} .og-grid td.c,.og-grid th.c{text-align:center;}',
    '.og-grid td.rh,.og-grid th.rh{padding:0;background:#F0F0F0;border-left:1px solid #646464;border-right:1px solid #646464;text-align:center;}',
    '.og-grid thead th.rh{background:#0078D7;}',
    '.og-grid td.ck,.og-grid th.ck{padding:0;text-align:center;}',
    '.og-grid tbody tr.cur td{background:#0078D7 !important;color:#FFF;}',
    '.og-grid tbody tr.cur td.rh{background:#D8E6F2 !important;color:#000;}',
    '.og-grid tbody tr.cur td.rh::before{content:"\\25B6";font-size:9px;color:#000;}',
    '.og-grid tbody tr.chk td{background:#CCE4F7;}',
    '.og-grid td.ed{font-weight:700;color:#A0001C;} .og-grid tr.cur td.ed{color:#FFE08A;}',
    '.og-grid td.editing{padding:0;} .og-grid td.editing input,.og-grid td.editing select{width:100%;height:100%;box-sizing:border-box;',
    ' border:1px solid #0078D7;font:inherit;padding:0 5px;color:#000;background:#FFF;outline:none;}',
    '.og-grid .og-empty{padding:18px;color:#8A8A90;font-size:13px;}',
    '.og-grid img.og-photo{display:block;margin:2px auto;object-fit:cover;border:1px solid #DDD;background:#F3F3F3;}'
  ].join('\n');
  var cssDone = false;
  function injectCss() {
    if (cssDone) return;
    cssDone = true;
    var s = document.createElement('style');
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function grid(container, opts) {
    injectCss();
    opts = opts || {};
    var cols = opts.columns || [];
    var multi = opts.select === 'multi';
    var rowHeader = opts.rowHeader !== undefined ? opts.rowHeader : !multi;
    var rowH = opts.rowHeight || 30;
    var data = [];
    var edits = [];          // per row index: { key: value }
    var checkedSet = [];     // per row index: bool
    var cur = -1;
    var editing = null;      // { td, input, ri, col, done }

    container.classList.add('og-grid');
    container.style.fontSize = opts.font || '12px';
    container.tabIndex = 0;
    container.innerHTML = '';
    var table = document.createElement('table');
    container.appendChild(table);

    var lead = (rowHeader ? 1 : 0) + (multi ? 1 : 0);
    var headAll = null;

    function totalWidth() {
      var w = (rowHeader ? 41 : 0) + (multi ? 34 : 0);
      cols.forEach(function (c) { w += c.width || 120; });
      return w;
    }

    function renderHead() {
      var html = '<colgroup>' + (rowHeader ? '<col style="width:41px">' : '') + (multi ? '<col style="width:34px">' : '') +
        cols.map(function (c) { return '<col style="width:' + (c.width || 120) + 'px">'; }).join('') + '</colgroup>' +
        '<thead><tr>' + (rowHeader ? '<th class="rh"></th>' : '') + (multi ? '<th class="ck"><input type="checkbox" data-all></th>' : '') +
        cols.map(function (c) {
          return '<th class="' + (c.align === 'right' ? 'r' : c.align === 'center' ? 'c' : '') + '">' + esc(c.header || c.key) + '</th>';
        }).join('') + '</tr></thead><tbody></tbody>';
      table.innerHTML = html;
      table.style.width = totalWidth() + 'px';
      headAll = table.querySelector('[data-all]');
      if (headAll) headAll.addEventListener('change', function () { setAllChecked(headAll.checked); });
    }

    function value(ri, c) {
      var e = edits[ri];
      return e && Object.prototype.hasOwnProperty.call(e, c.key) ? e[c.key] : data[ri][c.key];
    }

    function cellHtml(ri, c) {
      var row = data[ri];
      if (c.render) return c.render(row);
      var shown = {};
      shown[c.key] = value(ri, c);
      return esc(cellText(c, shown));
    }

    function rowHtml(ri) {
      var e = edits[ri] || {};
      return '<tr data-ri="' + ri + '" style="height:' + rowH + 'px"' + (ri === cur ? ' class="cur"' : '') + '>' +
        (rowHeader ? '<td class="rh"></td>' : '') +
        (multi ? '<td class="ck"><input type="checkbox" data-ck' + (checkedSet[ri] ? ' checked' : '') + '></td>' : '') +
        cols.map(function (c, ci) {
          var cls = (c.align === 'right' ? 'r' : c.align === 'center' ? 'c' : '') + (Object.prototype.hasOwnProperty.call(e, c.key) ? ' ed' : '');
          return '<td data-ci="' + ci + '" class="' + cls + '">' + cellHtml(ri, c) + '</td>';
        }).join('') + '</tr>';
    }

    function renderBody() {
      var tb = table.tBodies[0];
      if (!data.length) {
        tb.innerHTML = '<tr><td class="og-empty" colspan="' + (cols.length + lead) + '">' + esc(opts.emptyText || '') + '</td></tr>';
        return;
      }
      var parts = new Array(data.length);
      for (var i = 0; i < data.length; i++) parts[i] = rowHtml(i);
      tb.innerHTML = parts.join('');
      syncChecked();
    }

    function trOf(ri) { return table.tBodies[0].querySelector('tr[data-ri="' + ri + '"]'); }

    function refreshRow(ri) {
      var tr = trOf(ri);
      if (!tr) return;
      var tmp = document.createElement('tbody');
      tmp.innerHTML = rowHtml(ri);
      var nr = tmp.firstChild;
      if (checkedSet[ri]) nr.classList.add('chk');
      tr.parentNode.replaceChild(nr, tr);
    }

    function setCurrent(ri, scroll) {
      if (ri === cur) return;
      var old = trOf(cur);
      if (old) old.classList.remove('cur');
      cur = ri;
      var tr = trOf(ri);
      if (tr) {
        tr.classList.add('cur');
        if (scroll) tr.scrollIntoView({ block: 'nearest' });
      }
      if (opts.onCurrent) opts.onCurrent(ri >= 0 ? data[ri] : null);
    }

    function syncChecked() {
      if (!multi) return;
      var n = 0;
      table.tBodies[0].querySelectorAll('tr[data-ri]').forEach(function (tr) {
        var ri = +tr.getAttribute('data-ri');
        tr.classList.toggle('chk', !!checkedSet[ri]);
        var cb = tr.querySelector('[data-ck]');
        if (cb) cb.checked = !!checkedSet[ri];
        if (checkedSet[ri]) n++;
      });
      if (headAll) { headAll.checked = data.length > 0 && n === data.length; headAll.indeterminate = n > 0 && n < data.length; }
    }

    function setAllChecked(on) {
      for (var i = 0; i < data.length; i++) checkedSet[i] = !!on;
      syncChecked();
      if (opts.onCheck) opts.onCheck(checked());
    }

    function checked() {
      var out = [];
      for (var i = 0; i < data.length; i++) if (checkedSet[i]) out.push(data[i]);
      return out;
    }

    /* ---- in-cell editing ---- */
    function beginEdit(ri, ci, initial) {
      var c = cols[ci];
      if (!c || !c.editable || c.render) return;
      finishEdit(true);
      var tr = trOf(ri);
      var td = tr && tr.querySelector('td[data-ci="' + ci + '"]');
      if (!td) return;
      var v = value(ri, c);
      var input;
      if (c.options) {
        input = document.createElement('select');
        var opts2 = c.options.slice();
        if (v != null && v !== '' && opts2.indexOf(String(v)) < 0) opts2.unshift(String(v));
        opts2.forEach(function (o) { var op = document.createElement('option'); op.value = o; op.textContent = o; input.appendChild(op); });
        input.value = v == null ? '' : String(v);
      } else {
        input = document.createElement('input');
        input.type = 'text'; input.spellcheck = false; input.autocomplete = 'off';
        input.value = initial != null ? initial : (v == null ? '' : String(v));
      }
      td.classList.add('editing');
      td.innerHTML = '';
      td.appendChild(input);
      editing = { td: td, input: input, ri: ri, col: c };
      input.focus();
      if (input.select && initial == null) input.select();
      input.addEventListener('keydown', function (e) {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); finishEdit(true); container.focus(); }
        else if (e.key === 'Escape') { e.preventDefault(); finishEdit(false); container.focus(); }
        else if (e.key === 'Tab') { e.preventDefault(); var next = nextEditable(ci, e.shiftKey ? -1 : 1); finishEdit(true); if (next >= 0) beginEdit(ri, next); }
      });
      input.addEventListener('blur', function () { finishEdit(true); });
    }

    function nextEditable(ci, dir) {
      for (var i = ci + dir; i >= 0 && i < cols.length; i += dir) if (cols[i].editable && !cols[i].render) return i;
      return -1;
    }

    function finishEdit(commit) {
      if (!editing) return;
      var ed = editing;
      editing = null;
      if (commit) {
        var nv = ed.input.value;
        var orig = data[ed.ri][ed.col.key];
        var origS = orig == null ? '' : String(orig);
        var e = edits[ed.ri] || (edits[ed.ri] = {});
        if (nv === origS || (ed.col.format === 'money' && origS !== '' && Number(nv.replace(/,/g, '')) === Number(orig))) {
          delete e[ed.col.key];
        } else {
          e[ed.col.key] = nv;
        }
        if (!Object.keys(e).length) delete edits[ed.ri];
      }
      refreshRow(ed.ri);
      if (ed.ri === cur) { var tr = trOf(cur); if (tr) tr.classList.add('cur'); }
    }

    /* ---- events ---- */
    table.addEventListener('mousedown', function (e) {
      var tr = e.target.closest('tr[data-ri]');
      if (!tr) return;
      if (e.target.closest('td.editing')) return;
      setCurrent(+tr.getAttribute('data-ri'));
    });
    table.addEventListener('click', function (e) {
      var cb = e.target.closest('[data-ck]');
      if (cb) {
        var ri = +cb.closest('tr').getAttribute('data-ri');
        checkedSet[ri] = cb.checked;
        syncChecked();
        if (opts.onCheck) opts.onCheck(checked());
      }
    });
    table.addEventListener('dblclick', function (e) {
      var td = e.target.closest('td[data-ci]');
      var tr = e.target.closest('tr[data-ri]');
      if (!tr) return;
      var ri = +tr.getAttribute('data-ri');
      if (td && cols[+td.getAttribute('data-ci')].editable) { beginEdit(ri, +td.getAttribute('data-ci')); return; }
      if (opts.onDblClick) opts.onDblClick(data[ri]);
    });
    container.addEventListener('keydown', function (e) {
      if (editing || !data.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setCurrent(Math.max(0, Math.min(data.length - 1, (cur < 0 ? -1 : cur) + (e.key === 'ArrowDown' ? 1 : -1))), true);
      } else if (cur >= 0 && (e.key === 'F2' || (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey))) {
        var first = nextEditable(-1, 1);
        if (first < 0) return;
        if (e.key === ' ' && multi) return;
        e.preventDefault();
        beginEdit(cur, first, e.key === 'F2' ? null : e.key);
      }
    });

    renderHead();
    renderBody();

    return {
      el: container,
      setRows: function (rows) {
        editing = null;
        data = rows ? rows.slice() : [];
        edits = []; checkedSet = []; cur = -1;
        if (headAll) headAll.checked = false;
        renderBody();
        container.scrollTop = 0;
        if (data.length && !multi) setCurrent(0); else if (opts.onCurrent) opts.onCurrent(null);
        if (opts.onCheck) opts.onCheck([]);
      },
      rows: function () { return data.slice(); },
      count: function () { return data.length; },
      current: function () { finishEdit(true); return cur >= 0 ? data[cur] : null; },
      checked: checked,
      setAllChecked: setAllChecked,
      edited: function () {
        finishEdit(true);
        var out = [];
        for (var i = 0; i < data.length; i++) if (edits[i]) out.push({ row: data[i], changes: Object.assign({}, edits[i]) });
        return out;
      },
      // Row values with the pending edits applied (for rows the user changed).
      merged: function (row) {
        finishEdit(true);
        var i = data.indexOf(row);
        return Object.assign({}, row, i >= 0 ? edits[i] || {} : {});
      },
      clearEdits: function () { editing = null; edits = []; renderBody(); }
    };
  }

  function busy(button, promise) {
    if (button) button.disabled = true;
    return Promise.resolve(promise).then(function (v) {
      if (button) button.disabled = false;
      return v;
    }, function (err) {
      if (button) button.disabled = false;
      throw err;
    });
  }

  function fail(ctx, title) {
    return function (err) {
      return ctx.messageBox((title ? title + '\n\n' : '') + (err && err.message ? err.message : String(err)), 'SMEAG', 'OK', 'error');
    };
  }

  function tableHtml(columns, rows) {
    return '<table class="pt"><thead><tr>' + columns.map(function (c) {
      return '<th class="' + (c.align === 'right' ? 'r' : c.align === 'center' ? 'c' : '') + '">' + esc(c.header || c.key) + '</th>';
    }).join('') + '</tr></thead><tbody>' + rows.map(function (r) {
      return '<tr>' + columns.map(function (c) {
        return '<td class="' + (c.align === 'right' ? 'r' : c.align === 'center' ? 'c' : '') + '">' + esc(cellText(c, r)) + '</td>';
      }).join('') + '</tr>';
    }).join('') + '</tbody></table>';
  }

  var PRINT_CSS = '@page{size:A4 %ORIENT%;margin:12mm;}' +
    'body{font-family:"Segoe UI",Arial,sans-serif;font-size:10px;color:#000;margin:0;}' +
    'h1{font-size:18px;margin:0 0 4px;} .meta{color:#444;margin:0 0 10px;font-size:11px;}' +
    'h2{font-size:13px;margin:14px 0 6px;}' +
    'table.pt{border-collapse:collapse;width:100%;margin-bottom:8px;} table.pt th,table.pt td{border:1px solid #888;padding:3px 4px;}' +
    'table.pt th{background:#E8EEF7;text-align:left;} .r{text-align:right;} .c{text-align:center;}' +
    'table.pt tr{page-break-inside:avoid;} thead{display:table-header-group;}';

  function printDoc(title, bodyHtml, o) {
    o = o || {};
    var frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    document.body.appendChild(frame);
    var doc = frame.contentDocument;
    doc.open();
    doc.write('<!doctype html><html><head><meta charset="utf-8"><title>' + esc(title) + '</title><style>' +
      PRINT_CSS.replace('%ORIENT%', o.landscape ? 'landscape' : 'portrait') + (o.css || '') + '</style></head><body>' + bodyHtml + '</body></html>');
    doc.close();
    var go = function () {
      try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch (e) { /* ignore */ }
      setTimeout(function () { if (frame.parentNode) frame.parentNode.removeChild(frame); }, 60000);
    };
    var imgs = doc.images;
    var pending = 0;
    for (var i = 0; i < imgs.length; i++) {
      if (!imgs[i].complete) { pending++; imgs[i].addEventListener('load', done); imgs[i].addEventListener('error', done); }
    }
    function done() { if (--pending === 0) setTimeout(go, 50); }
    if (!pending) setTimeout(go, 50);
  }

  function downloadCsv(fileName, columns, rows) {
    function cell(s) { s = String(s == null ? '' : s); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
    var lines = [columns.map(function (c) { return cell(c.header || c.key); }).join(',')];
    rows.forEach(function (r) { lines.push(columns.map(function (c) { return cell(c.format === 'money' || c.format === 'dec2' ? cellText(c, r) : r[c.key]); }).join(',')); });
    var blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function readImage(file, maxSide) {
    maxSide = maxSide || 800;
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var s = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
        var c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.88));
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('This file is not an image.')); };
      img.src = url;
    });
  }

  /* ---------- Excel (.xlsx) export via xlsx-js-style (SheetJS 0.18.5 + cell styles; lazy-loaded) ---------- */
  // The plain SheetJS build cannot write colours, so the export uses the styled fork. It is a drop-in
  // replacement (it also sets window.XLSX), so a plain copy loaded by another tab is simply superseded.
  var SHEETJS = 'https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js';
  var sheetJsPromise = null, styledXlsx = null;
  function loadSheetJs() {
    if (styledXlsx) return Promise.resolve(styledXlsx);
    if (sheetJsPromise) return sheetJsPromise;
    sheetJsPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = SHEETJS;
      s.onload = function () { if (window.XLSX) { styledXlsx = window.XLSX; resolve(styledXlsx); } else { sheetJsPromise = null; reject(new Error('Cannot load the Excel library.')); } };
      s.onerror = function () { sheetJsPromise = null; s.remove(); reject(new Error('Cannot load the Excel library (check the internet connection).')); };
      document.head.appendChild(s);
    });
    return sheetJsPromise;
  }

  /* the same colours as the on-screen grid (.og-grid): blue header, white / #FAFAFC striped rows, light grid lines */
  var XS = (function () {
    function side(rgb) { return { style: 'thin', color: { rgb: rgb } }; }
    function box(rgb) { return { top: side(rgb), bottom: side(rgb), left: side(rgb), right: side(rgb) }; }
    function fill(rgb) { return { patternType: 'solid', fgColor: { rgb: rgb } }; }
    var font = { name: 'Segoe UI', sz: 10, color: { rgb: '000000' } };
    return {
      fill: fill, box: box,
      font: function (o) { return Object.assign({}, font, o || {}); },
      title0: { font: { name: 'Segoe UI', sz: 16, bold: true, color: { rgb: '000080' } } },
      title: { font: { name: 'Segoe UI', sz: 10, color: { rgb: '000000' } } },
      head: { fill: fill('0078D7'), font: { name: 'Segoe UI', sz: 10, color: { rgb: 'FFFFFF' } }, border: box('646464'),
              alignment: { vertical: 'center', wrapText: true } },
      even: 'FFFFFF', odd: 'FAFAFC', line: 'E3E3E8',
      total: { fill: fill('DCDCE1'), font: { name: 'Segoe UI', sz: 10, bold: true, color: { rgb: '000000' } }, border: box('C8C8CD') }
    };
  })();

  // sheets: [{ name, columns (grid column spec; format 'money' -> number cell #,##0.00), rows, title?: [lines above the table],
  //            totalRows?: n last rows styled as the grey TOTAL row, cellFill?: function (row, col) -> 'RRGGBB' | null }]
  function downloadXlsx(fileName, sheets) {
    return loadSheetJs().then(function (XLSX) {
      var wb = XLSX.utils.book_new();
      sheets.forEach(function (sh) {
        var aoa = (sh.title || []).map(function (t) { return [t]; });
        var nTitle = aoa.length;
        if (aoa.length) aoa.push([]);
        var headRow = aoa.length;
        aoa.push(sh.columns.map(function (c) { return c.header || c.key; }));
        sh.rows.forEach(function (r) {
          aoa.push(sh.columns.map(function (c) {
            var v = r[c.key];
            if (c.format === 'money' || c.format === 'dec2' || c.format === 'int') {
              if (v === null || v === undefined || v === '') return null;
              var n = Number(String(v).replace(/,/g, ''));
              return isNaN(n) ? v : n;
            }
            return v === null || v === undefined ? '' : String(v);
          }));
        });
        var ws = XLSX.utils.aoa_to_sheet(aoa);
        function cellAt(ri, ci) {
          var a = XLSX.utils.encode_cell({ r: ri, c: ci });
          return ws[a] || (ws[a] = { t: 's', v: '' });
        }
        for (var ti = 0; ti < nTitle; ti++) cellAt(ti, 0).s = ti === 0 ? XS.title0 : XS.title;
        var nTot = sh.totalRows || 0, last = aoa.length - 1;
        sh.columns.forEach(function (c, ci) {
          var h = { horizontal: c.align === 'right' ? 'right' : c.align === 'center' ? 'center' : 'left' };
          cellAt(headRow, ci).s = Object.assign({}, XS.head, { alignment: Object.assign({}, XS.head.alignment, h) });
          for (var ri = headRow + 1; ri <= last; ri++) {
            var cell = cellAt(ri, ci), di = ri - headRow - 1;
            if ((c.format === 'money' || c.format === 'dec2') && cell.t === 'n') cell.z = '#,##0.00';
            if (ri > last - nTot) {
              cell.s = Object.assign({}, XS.total, { alignment: h });
            } else {
              var bg = (sh.cellFill && sh.cellFill(sh.rows[di], c)) || (di % 2 ? XS.odd : XS.even);
              cell.s = { fill: XS.fill(bg), font: XS.font(), border: XS.box(XS.line), alignment: h };
            }
            if (cell.z) cell.s.numFmt = cell.z;
          }
        });
        ws['!cols'] = sh.columns.map(function (c) { return { wch: Math.max(8, Math.round((c.width || 100) / 7)) }; });
        ws['!rows'] = []; ws['!rows'][headRow] = { hpt: 24 };
        ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: headRow, c: 0 }, e: { r: Math.max(headRow, last - nTot), c: sh.columns.length - 1 } }) };
        XLSX.utils.book_append_sheet(wb, ws, String(sh.name || 'Sheet').replace(/[\\/?*\[\]:]/g, ' ').slice(0, 31));
      });
      XLSX.writeFile(wb, fileName);
    });
  }

  window.OfficeKit = {
    grid: grid, money: money, iso: iso, esc: esc, busy: busy, fail: fail,
    printDoc: printDoc, tableHtml: tableHtml, downloadCsv: downloadCsv, readImage: readImage,
    loadSheetJs: loadSheetJs, downloadXlsx: downloadXlsx
  };
})();
