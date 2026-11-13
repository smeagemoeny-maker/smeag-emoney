/* Default tab — registers window.OfficeTabs['Default'] (see showPage() in office.js).
   Replica of DefaultControl.cs: NFC UID box, DEFAULT button (releases a card: person.uid gets the "G" prefix)
   and the result grid. Wired to GET /api/office/people/for-default and POST /api/office/people/:id/default. */
(function () {
  'use strict';

  window.OfficeTabs = window.OfficeTabs || {};
  window.OfficeTabs['Default'] = {
    mount: function (root, ctx) {
      root.classList.add('g2-page');
      root.innerHTML =
        '<span class="g2-lbl f10" style="left:33px;top:32px">NFC UID:</span>' +
        '<input class="g2-txt f10" data-k="uid" type="text" maxlength="20" spellcheck="false" autocomplete="off" style="left:104px;top:24px;width:250px;height:29px">' +
        '<button class="flat g2-btn b" data-k="default" style="left:377px;top:21px;width:120px;height:35px;background:#DC3545">DEFAULT</button>' +
        '<div class="g2-panel" data-k="grid" style="left:20px;top:96px;width:1666px;height:767px"></div>';

      var uid = root.querySelector('[data-k="uid"]');
      uid.addEventListener('input', function () {
        var pos = uid.selectionStart;
        var v = uid.value.toUpperCase();
        if (v !== uid.value) { uid.value = v; try { uid.setSelectionRange(pos, pos); } catch (e) { /* ignore */ } }
      });

      var COLUMNS = [
        { key: 'id', header: 'id', width: 80, format: 'int', align: 'right' },
        { key: 'uid', header: 'uid', width: 200 },
        { key: 'studentId', header: 'studentid', width: 180 },
        { key: 'name', header: 'name', width: 430 },
        { key: 'campus', header: 'campus', width: 150 },
        { key: 'startDate', header: 's_date', width: 150 },
        { key: 'endDate', header: 'e_date', width: 150 },
        { key: 'totalMoney', header: 'totalmoney', width: 284, format: 'money', align: 'right' }
      ];
      var box = root.querySelector('[data-k="grid"]');
      var btnDefault = root.querySelector('[data-k="default"]');
      var grid = null;
      var lastUid = '';

      // SearchStudentByUid: exact uid, else the released "G"+uid card
      function search(u) {
        lastUid = u;
        return ctx.api.request('GET', '/api/office/people/for-default?uid=' + encodeURIComponent(u)).then(function (res) {
          if (!grid) {
            box.className = '';
            grid = OfficeKit.grid(box, { columns: COLUMNS, rowHeight: 35, emptyText: 'No student found for this card.' });
          }
          grid.setRows(res.people || []);
        }).catch(OfficeKit.fail(ctx, 'Error searching student'));
      }

      function initialize() {
        var row = grid && grid.current();
        if (!row) return ctx.messageBox('Please select a student from the list.', 'SMEAG', 'OK', 'warning');
        var currentUid = String(row.uid || '');
        if (/^g/i.test(currentUid)) return ctx.messageBox('This card is already initialized (Defaulted).', 'SMEAG', 'OK', 'info');
        return ctx.messageBox('Are you sure you want to initialize (Default) student ' + (row.name || '') + '?\nUID will be changed from ' +
          currentUid + ' to G' + currentUid, 'Confirm Initialization', 'YesNo', 'warning').then(function (ans) {
          if (ans !== 'Yes') return;
          return ctx.api.request('POST', '/api/office/people/' + row.id + '/default', {}).then(function () {
            return ctx.messageBox('Student initialized successfully.', 'SMEAG', 'OK', 'info').then(function () {
              return search(lastUid || currentUid);   // refresh list
            });
          }, OfficeKit.fail(ctx, 'Initialization Error'));
        });
      }

      uid.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        var u = uid.value.trim();
        if (u) search(u);
      });
      btnDefault.addEventListener('click', function () { if (!btnDefault.disabled) OfficeKit.busy(btnDefault, initialize()); });

      // NFC tap: fill the UID box and search (same as typing it + Enter)
      return {
        onNfc: function (u) {
          if (btnDefault.disabled) return;
          uid.value = u;
          search(u);
        }
      };
    },
    show: function () {}
  };
})();
