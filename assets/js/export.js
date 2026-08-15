/* ==========================================================================
   export.js — portable citations, CSV, and file downloads.

   All functions return plain text (never HTML). When any of it is placed into
   the DOM it is set as a textarea `.value` or passed through ui.esc() by the
   caller, so nothing here needs to escape for markup. Downloads use the same
   URL.createObjectURL blob API the store uses for uploaded files — no library.
   ========================================================================== */
(function (global) {
  'use strict';

  var ESH = global.ESH, store = ESH.store, ui = ESH.ui;

  function authorNames(r) {
    var owner = store.userById(r.ownerId);
    var names = [owner ? owner.fullName : 'Unknown author'];
    (r.coAuthors || []).forEach(function (ca) { if (ca && ca.name) names.push(ca.name); });
    return names;
  }

  var PUBLISHER = 'EuroSpaceHub — Prof. Bernard Foing Research Hub';

  /* citation(report, format) → 'apa' | 'bibtex' | 'ris'. Plain text. */
  function citation(r, fmt) {
    var y = ui.year(r.submittedAt || r.createdAt);
    var names = authorNames(r);

    if (fmt === 'bibtex') {
      return '@techreport{eshub_' + r.id + ',\n' +
        '  title       = {' + r.title + '},\n' +
        '  author      = {' + names.join(' and ') + '},\n' +
        '  year        = {' + y + '},\n' +
        '  type        = {' + r.reportType + '},\n' +
        '  institution = {' + PUBLISHER + '},\n' +
        '  note        = {Internal record}\n' +
        '}';
    }
    if (fmt === 'ris') {
      return ['TY  - RPRT', 'TI  - ' + r.title]
        .concat(names.map(function (n) { return 'AU  - ' + n; }))
        .concat(['PY  - ' + y, 'PB  - ' + PUBLISHER])
        .concat((r.keywords || []).map(function (k) { return 'KW  - ' + k; }))
        .concat(['ER  - ']).join('\n');
    }
    /* apa — matches the plain citation shown on the record page */
    return names.join(', ') + ' (' + y + '). ' + r.title +
      '. EuroSpaceHub Lunar & Mars Research Hub (internal), supervised by Prof. Bernard Foing.';
  }

  /* RFC-4180 CSV. header: [String]; rows: [[cell]]. */
  function csvCell(v) {
    var s = String(v === null || v === undefined ? '' : v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCSV(header, rows) {
    return [header].concat(rows).map(function (row) {
      return row.map(csvCell).join(',');
    }).join('\r\n');
  }

  /* Build the export rows for a set of reports (used by the library). */
  function reportsCSV(list) {
    var header = ['Title', 'Authors', 'Mission area', 'Report type', 'Year', 'Keywords', 'Status', 'Record ID'];
    var rows = list.map(function (r) {
      return [
        r.title, authorNames(r).join('; '), r.missionArea, r.reportType,
        ui.year(r.submittedAt || r.createdAt), (r.keywords || []).join('; '),
        (store.STATUSES[r.status] || {}).label || r.status, r.id
      ];
    });
    return toCSV(header, rows);
  }
  function reportsBibtex(list) {
    return list.map(function (r) { return citation(r, 'bibtex'); }).join('\n\n');
  }

  /* Trigger a client-side download of some text. */
  function download(name, mime, text) {
    var blob = new Blob([text], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) {} }, 1000);
  }

  global.ESH.exporter = {
    citation: citation, toCSV: toCSV, reportsCSV: reportsCSV, reportsBibtex: reportsBibtex,
    download: download
  };

})(window);
