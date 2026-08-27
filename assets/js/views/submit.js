/* ==========================================================================
   views/submit.js — the research report submission form, used both to create
   a new record and to edit an existing one.

   Editing is gated on auth.can('report:edit'): an intern may edit only their
   own record, and only before the supervisor opens it for review (Draft or
   Submitted) or after revisions are requested. The
   supervisor may correct metadata in any state.

   FILE HANDLING: the chosen file is held in an in-memory blob for this tab
   session; only its metadata is persisted. localStorage cannot hold PDFs, and
   silently truncating or dropping uploads would be worse than saying so.
   ========================================================================== */
(function (global) {
  'use strict';

  var ESH = global.ESH, ui = ESH.ui, store = ESH.store, auth = ESH.auth, router = ESH.router;
  var esc = ui.esc;

  var ABSTRACT_TARGET = 250;
  var ABSTRACT_MAX = 400;

  function coAuthorPicker(selectedIds, viewerId) {
    var candidates = store.interns().filter(function (u) { return u.id !== viewerId; });
    if (!candidates.length) return '<p class="field__hint">No other researcher accounts exist on the platform yet.</p>';
    return '<div class="pickbox">' +
      candidates.map(function (u) {
        var on = selectedIds.indexOf(u.id) !== -1;
        return '<label class="checkline"><input type="checkbox" name="coauthorId" value="' + esc(u.id) + '"' +
          (on ? ' checked' : '') + '><span>' + esc(u.fullName) +
          ' <span class="meta">— ' + esc(u.institution) + '</span></span></label>';
      }).join('') + '</div>';
  }

  function supplementaryRows(list) {
    var rows = (list && list.length) ? list : [{ label: '', url: '' }];
    return rows.map(function (s, i) { return suppRow(s, i); }).join('');
  }
  function suppRow(s, i) {
    return '<div class="field-row mb-10" data-supprow>' +
      '<div class="field m-0"><label class="sr-only" for="suppLabel' + i + '">Label</label>' +
        '<input type="text" id="suppLabel' + i + '" name="suppLabel" placeholder="Label (e.g. Supporting dataset)" value="' + esc(s.label || '') + '"></div>' +
      '<div class="field m-0"><label class="sr-only" for="suppUrl' + i + '">URL</label>' +
        '<input type="url" id="suppUrl' + i + '" name="suppUrl" placeholder="https://…" value="' + esc(s.url || '') + '"></div>' +
    '</div>';
  }

  function form(ctx, existing) {
    var viewer = auth.user();
    var isEdit = !!existing;
    var r = existing || {
      title: '', missionArea: 'Lunar', reportType: 'Research paper', abstract: '',
      keywords: [], coAuthors: [], supplementary: [], dataAvailability: '',
      status: 'draft', file: null
    };
    var owner = isEdit ? store.userById(r.ownerId) : viewer;
    var selectedIds = (r.coAuthors || []).map(function (c) { return c.userId; }).filter(Boolean);
    var freeCoAuthors = (r.coAuthors || []).filter(function (c) { return !c.userId; })
      .map(function (c) { return c.name; }).join(', ');
    var st = store.STATUSES[r.status];

    ctx.el.innerHTML =
    '<div class="wrap wrap--880">' +
      '<p class="meta mb-10">' +
        (isEdit ? '<a href="#/report/' + esc(r.id) + '">&larr; Back to the record</a>'
                : '<a href="#/me">&larr; Back to my profile</a>') + '</p>' +
      '<p class="eyebrow">' + (isEdit ? 'Edit submission' : 'New submission') + '</p>' +
      '<h1>' + (isEdit ? 'Edit research report' : 'Submit a research report') + '</h1>' +
      '<p class="lede">Records are reviewed by Prof. Bernard Foing. Only approved records are ' +
        'shared with the rest of the research group.</p>' +

      (isEdit
        ? ui.notice(r.status === 'revisions' ? 'warn' : 'info',
            'Current state: ' + st.label,
            r.status === 'revisions'
              ? 'The supervisor has requested revisions. Update the record and resubmit when ready — ' +
                'the review comments are on the <a href="#/report/' + esc(r.id) + '#review-thread">record page</a>.'
              : 'Saving does not change the workflow state.')
        : '') +

      (isEdit && owner && viewer.id !== owner.id
        ? ui.notice('info', 'Editing as supervisor', 'This record belongs to <strong>' + esc(owner.fullName) + '</strong>.')
        : '') +

      '<form id="repForm" novalidate>' +
        '<fieldset><legend>Record</legend>' +
          '<div class="field"><label for="sTitle">Title <span class="req">*</span></label>' +
            '<input type="text" id="sTitle" name="title" value="' + esc(r.title) + '" required></div>' +
          '<div class="field-row">' +
            '<div class="field"><label for="sArea">Mission / topic area <span class="req">*</span></label>' +
              '<select id="sArea" name="missionArea">' + ui.selectOptions(store.MISSION_AREAS, r.missionArea) + '</select></div>' +
            '<div class="field"><label for="sType">Report type <span class="req">*</span></label>' +
              '<select id="sType" name="reportType">' + ui.selectOptions(store.REPORT_TYPES, r.reportType) + '</select></div>' +
          '</div>' +
          '<div class="field"><label for="sAbs">Abstract <span class="req">*</span></label>' +
            '<textarea id="sAbs" name="abstract" rows="9" required>' + esc(r.abstract) + '</textarea>' +
            '<p class="field__hint">Target approximately ' + ABSTRACT_TARGET + ' words; hard limit ' + ABSTRACT_MAX + '. ' +
              '<span id="absCount" class="tnum"></span></p></div>' +
          '<div class="field"><label for="sKw">Keywords</label>' +
            '<input type="text" id="sKw" name="keywords" value="' + esc((r.keywords || []).join(', ')) + '" ' +
            'placeholder="regolith, ISRU, south pole"><p class="field__hint">Comma-separated. Used by the library filters.</p>' +
            ui.keywordChips(store.suggestedKeywords()) + '</div>' +
          '<div class="field"><label for="sCampaign">Campaign / programme</label>' +
            '<input type="text" id="sCampaign" name="campaign" list="campaignList" value="' + esc(r.campaign || '') + '" ' +
            'placeholder="Optional — e.g. EuroMoonMars">' +
            '<datalist id="campaignList">' +
              store.CAMPAIGNS.map(function (c) { return '<option value="' + esc(c) + '"></option>'; }).join('') +
            '</datalist>' +
            '<p class="field__hint">Optional. Groups related work in the library.</p></div>' +
        '</fieldset>' +

        '<fieldset><legend>Authorship</legend>' +
          '<div class="field"><span class="field__label">Lead author</span>' +
            '<p class="m-0">' + esc(owner ? owner.fullName : '—') +
            (owner && owner.institution ? ' <span class="meta">— ' + esc(owner.institution) + '</span>' : '') + '</p></div>' +
          '<div class="field"><label for="sCoFree">Co-authors not on the platform</label>' +
            '<input type="text" id="sCoFree" name="coAuthorsFree" value="' + esc(freeCoAuthors) + '" ' +
            'placeholder="Comma-separated names"></div>' +
          '<div class="field"><span class="field__label">Tag co-authors with platform accounts</span>' +
            coAuthorPicker(selectedIds, owner ? owner.id : null) + '</div>' +
        '</fieldset>' +

        '<fieldset><legend>Files &amp; data</legend>' +
          '<div class="field"><label for="sFile">Main file</label>' +
            '<input type="file" id="sFile" name="file" accept="' + esc(store.ACCEPTED_FILES) + '">' +
            '<p class="field__hint">PDF is preferred; DOCX and PPTX are also accepted. Maximum 25 MB.</p>' +
            (r.file
              ? '<p class="field__hint">Currently attached: <strong>' + esc(r.file.name) + '</strong>' +
                (r.file.size ? ' (' + esc(ui.fmtBytes(r.file.size)) + ')' : '') +
                ' — choose a new file to replace it.</p>'
              : '') +
            '<p class="field__hint">The file uploads straight to encrypted Backblaze B2 storage. ' +
              'The bucket is private: downloads are issued as short-lived signed links, and only to ' +
              'people the access rules allow.</p>' +
            '<p class="field__hint" id="uploadProgress" hidden ' +
              'role="status" style="font-variant-numeric:tabular-nums"></p></div>' +
          '<div class="field"><span class="field__label">Supplementary material (links)</span>' +
            '<div id="suppRows">' + supplementaryRows(r.supplementary) + '</div>' +
            '<button class="btn btn--sm btn--ghost" type="button" id="addSupp">+ Add another link</button></div>' +
          '<div class="field"><label for="sData">Data availability statement</label>' +
            '<textarea id="sData" name="dataAvailability" rows="3" ' +
            'placeholder="Where the underlying data are held, and under what terms.">' + esc(r.dataAvailability) + '</textarea>' +
            '<p class="field__hint">Optional.</p></div>' +
        '</fieldset>' +

        '<div class="card bg-1">' +
          '<h3>' + (isEdit ? 'Save' : 'Submit') + '</h3>' +
          '<p class="meta">Submission date is recorded automatically when the record moves to Submitted.</p>' +
          '<div class="btn-row mt-12">' +
            '<button class="btn" type="submit" name="intent" value="save">' +
              (isEdit ? 'Save changes' : 'Save as draft') + '</button>' +
            (canSubmitNow(r, isEdit)
              ? '<button class="btn btn--primary" type="submit" name="intent" value="submit">' +
                (r.status === 'revisions' ? 'Save and resubmit for review' : 'Save and submit for review') + '</button>'
              : '') +
            (isEdit ? '<a class="btn btn--ghost" href="#/report/' + esc(r.id) + '">Cancel</a>'
                    : '<a class="btn btn--ghost" href="#/me">Cancel</a>') +
          '</div>' +
        '</div>' +
      '</form>' +
    '</div>';

    wire(ctx, r, isEdit, owner);
  }

  function canSubmitNow(r, isEdit) {
    if (!isEdit) return true;
    return auth.canTransition(r, 'submitted');
  }

  function wire(ctx, r, isEdit, owner) {
    var viewer = auth.user();
    var f = document.getElementById('repForm');
    ui.wireKeywordChips(f, f.elements.keywords);
    var abs = document.getElementById('sAbs');
    var count = document.getElementById('absCount');
    var pendingFile = null;
    var intent = 'save';

    function updateCount() {
      var n = ui.wordCount(abs.value);
      count.textContent = n + ' word' + (n === 1 ? '' : 's');
      count.style.color = n > ABSTRACT_MAX ? '#ff9b9b' : 'var(--ink-3)';
    }
    abs.addEventListener('input', updateCount);
    updateCount();

    document.getElementById('sFile').addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) { pendingFile = null; return; }
      var okExt = /\.(pdf|docx|pptx)$/i.test(file.name);
      if (!okExt) { ui.fieldError(e.target, 'Accepted formats are PDF, DOCX and PPTX.'); e.target.value = ''; pendingFile = null; return; }
      if (file.size > 25 * 1024 * 1024) { ui.fieldError(e.target, 'The file exceeds the 25 MB limit.'); e.target.value = ''; pendingFile = null; return; }
      ui.clearFieldError(e.target);
      pendingFile = file;
    });

    var suppIdx = document.querySelectorAll('[data-supprow]').length;
    document.getElementById('addSupp').addEventListener('click', function () {
      document.getElementById('suppRows').insertAdjacentHTML('beforeend', suppRow({ label: '', url: '' }, suppIdx++));
    });

    f.querySelectorAll('button[type=submit]').forEach(function (b) {
      b.addEventListener('click', function () { intent = b.value; });
    });

    f.addEventListener('submit', function (e) {
      e.preventDefault();
      ui.clearAllErrors(f);
      var ok = true;

      if (!f.elements.title.value.trim()) { ui.fieldError(f.elements.title, 'Enter a title.'); ok = false; }
      var absText = abs.value.trim();
      if (!absText) { ui.fieldError(abs, 'An abstract is required.'); ok = false; }
      else if (ui.wordCount(absText) > ABSTRACT_MAX) { ui.fieldError(abs, 'The abstract exceeds ' + ABSTRACT_MAX + ' words.'); ok = false; }
      else if (intent === 'submit' && ui.wordCount(absText) < 40) {
        ui.fieldError(abs, 'Expand the abstract before submitting for review (at least 40 words).'); ok = false;
      }

      var suppLabels = [].slice.call(f.querySelectorAll('input[name=suppLabel]'));
      var suppUrls = [].slice.call(f.querySelectorAll('input[name=suppUrl]'));
      var supplementary = [];
      suppUrls.forEach(function (el, i) {
        var url = el.value.trim();
        if (!url) return;
        if (!ui.safeUrl(url)) { ui.fieldError(el, 'Enter a valid http(s) URL.'); ok = false; return; }
        supplementary.push({ label: suppLabels[i].value.trim() || url, url: ui.safeUrl(url) });
      });

      if (!ok) { ui.focusFirstError(f); return; }

      /* co-authors: tagged accounts + free-text names */
      var coAuthors = [].slice.call(f.querySelectorAll('input[name=coauthorId]:checked')).map(function (cb) {
        var u = store.userById(cb.value);
        return { name: u ? u.fullName : 'Unknown', userId: cb.value };
      });
      ui.parseList(f.elements.coAuthorsFree.value).forEach(function (n) { coAuthors.push({ name: n, userId: null }); });

      var patch = {
        title: f.elements.title.value.trim(),
        missionArea: f.elements.missionArea.value,
        reportType: f.elements.reportType.value,
        campaign: store.canonicalCampaign(f.elements.campaign.value),
        abstract: absText,
        keywords: store.canonicalKeywords(ui.parseList(f.elements.keywords.value)),
        coAuthors: coAuthors,
        supplementary: supplementary,
        dataAvailability: f.elements.dataAvailability.value.trim()
      };
      /* ---------------- API mode: save, then upload to B2 ----------------
         The record is saved FIRST so the file has a report to belong to. The
         server keys every object under its report id and will not sign a PUT
         for a report you cannot edit, so there is no such thing as an orphan
         upload floating free of a permission check. */
      saveViaApi(patch, r, isEdit, intent, pendingFile, f);
    });
  }

  /* ==========================================================================
     saveViaApi — the real path: server save, then a direct browser→B2 upload.

       1. POST/PATCH the record          server checks can('report:create'/'report:edit')
       2. POST …/upload-url              server checks can('file:upload'), mints the key,
                                         returns a presigned PUT
       3. PUT straight to Backblaze      the bytes never touch our server
       4. POST …/file                    server HEADs the object, records the real size
       5. optional status transition     server checks canTransition()

     Every step is refused server-side if the policy says no, so a tampered
     page can at worst make requests that get rejected.
     ========================================================================== */
  function saveViaApi(patch, existing, isEdit, intent, pendingFile, formEl) {
    var api = ESH.api;
    var buttons = [].slice.call(formEl.querySelectorAll('button[type=submit]'));
    var progress = document.getElementById('uploadProgress');

    function busy(on, label) {
      buttons.forEach(function (b) { b.disabled = on; });
      if (progress) {
        progress.hidden = !on;
        if (label) progress.textContent = label;
      }
    }

    function fail(err) {
      busy(false);
      ui.toast(err && err.message ? err.message : 'Could not save the record.', 'err');
    }

    busy(true, 'Saving record…');

    var saved = isEdit
      ? api.reports.update(existing.id, patch).then(function (d) { return d.report; })
      : api.reports.create(patch).then(function (d) { return d.report; });

    saved.then(function (rec) {
      if (!pendingFile) return rec;
      busy(true, 'Uploading ' + pendingFile.name + '… 0%');
      return api.uploadFile(rec.id, pendingFile, function (fraction) {
        busy(true, 'Uploading ' + pendingFile.name + '… ' + Math.round(fraction * 100) + '%');
      }).then(function (d) {
        return d.report || rec;
      });
    }).then(function (rec) {
      if (intent !== 'submit') return rec;
      busy(true, 'Submitting for review…');
      return api.reports.status(rec.id, 'submitted', 'Submitted for supervisor review.')
        .then(function (d) { return d.report; });
    }).then(function (rec) {
      /* Re-pull so every other view sees the server's version, not ours. */
      return store.hydrate().then(function () { return rec; });
    }).then(function (rec) {
      busy(false);
      ui.toast(intent === 'submit' ? 'Submitted for review.'
             : isEdit ? 'Changes saved.' : 'Draft saved.', 'good');
      router.navigate('#/report/' + rec.id);
    }).catch(fail);
  }

  /* ---------------- entry points ---------------- */

  function create(ctx) {
    var viewer = auth.user();
    if (!auth.can('report:create', null, viewer)) { router.navigate('#/denied', true); return; }
    form(ctx, null);
  }

  function editReport(ctx) {
    var r = store.reportById(ctx.params.id);
    var viewer = auth.user();
    if (!r) { router.navigate('#/', true); return; }
    if (!auth.can('report:read', r, viewer)) { router.navigate('#/denied', true); return; }
    if (!auth.can('report:edit', r, viewer)) {
      ctx.el.innerHTML = '<div class="wrap wrap--680">' +
        '<h1>Editing is locked</h1>' +
        ui.notice('locked', 'This record cannot be edited in its current state',
          'The record is in <strong>' + esc(store.STATUSES[r.status].label) + '</strong>. Interns can edit only ' +
          'until the supervisor opens it for review, and again once revisions ' +
          'are requested. ' +
          '<a href="#/report/' + esc(r.id) + '">Return to the record</a>.') + '</div>';
      return;
    }
    form(ctx, r);
  }

  ESH.views = ESH.views || {};
  ESH.views.submit = create;
  ESH.views.reportEdit = editReport;

})(window);
