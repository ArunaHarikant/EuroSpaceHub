/* ==========================================================================
   views/report.js — report detail record.

   MEMBERS ONLY — route-guarded, and every element re-checked with auth.can().
   A colleague who did not write the record sees the citation-style entry for a
   released report and nothing else: no history, no comments, no status
   controls. The author additionally gets workflow state, review comments and
   their own transitions. The supervisor additionally gets internal comments,
   every transition and the featuring control.
   ========================================================================== */
(function (global) {
  'use strict';

  var ESH = global.ESH, ui = ESH.ui, store = ESH.store, auth = ESH.auth, router = ESH.router;
  var esc = ui.esc;

  function denied(el, reportExists) {
    el.innerHTML = '<div class="wrap">' +
      ui.notice('warn', reportExists ? 'You do not have access to this record' : 'Record not found',
        reportExists
          ? 'This report has not been approved for sharing. It is visible only to its author and to the supervisor. ' +
            (auth.isAuthenticated() ? '' : '<a href="#/signin">Sign in</a> if you are the author or the supervisor.')
          : 'No report exists with that identifier. <a href="#/library">Return to the library</a>.') +
      '</div>';
  }

  /* ---------------- comments ---------------- */

  function commentNode(r, c, all, viewer) {
    var a = store.userById(c.authorId);
    var replies = all.filter(function (x) { return x.parentId === c.id; });
    var canReply = auth.can('comment:write', r, viewer);
    return '' +
    '<div class="comment' + (c.internal ? ' comment--internal' : '') + '" data-comment="' + esc(c.id) + '">' +
      '<div class="comment__head">' +
        ui.avatar(a, 'sm') +
        '<span class="comment__who">' + esc(a ? a.fullName : 'Unknown') + '</span>' +
        (a && a.role === 'supervisor' ? '<span class="badge badge--role">Supervisor</span>' : '') +
        (c.internal ? '<span class="badge badge--featured">Internal — supervisors only</span>' : '') +
        '<span class="comment__when">' + esc(ui.fmtDateTime(c.at)) + '</span>' +
      '</div>' +
      '<p class="comment__body">' + esc(c.body) + '</p>' +
      (canReply ? '<div class="comment__actions"><button class="linkbtn" type="button" data-reply="' + esc(c.id) + '">Reply</button></div>' : '') +
      (replies.length
        ? '<div class="comment__replies">' + replies.map(function (x) { return commentNode(r, x, all, viewer); }).join('') + '</div>'
        : '') +
    '</div>';
  }

  function commentsPanel(r, viewer) {
    var visible = auth.visibleComments(r, viewer);
    var roots = visible.filter(function (c) { return !c.parentId; });
    var canWrite = auth.can('comment:write', r, viewer);
    var canInternal = auth.can('comment:writeInternal', r, viewer);

    return '' +
    '<section class="card card--flush" id="review-thread">' +
      '<div class="card__head"><h3>Review correspondence</h3>' +
        '<span class="meta">' + visible.length + ' comment' + (visible.length === 1 ? '' : 's') + '</span></div>' +
      '<div class="card__body">' +
        (roots.length
          ? roots.map(function (c) { return commentNode(r, c, visible, viewer); }).join('')
          : '<p class="meta">No comments on this record yet.</p>') +
        (canWrite
          ? '<form id="commentForm" class="mt-18">' +
              '<input type="hidden" name="parentId" value="">' +
              '<div class="field">' +
                '<label for="cbody">Add a comment</label>' +
                '<textarea id="cbody" name="body" rows="3" placeholder="Feedback, questions or a response to the review…"></textarea>' +
                '<p class="field__hint" id="replyHint" hidden></p>' +
              '</div>' +
              (canInternal
                ? '<label class="checkline mb-12"><input type="checkbox" name="internal">' +
                  '<span>Internal note — visible to supervisors only. Not shown to the author or the public.</span></label>'
                : '') +
              '<div class="btn-row"><button class="btn btn--primary btn--sm" type="submit">Post comment</button>' +
              '<button class="btn btn--sm btn--ghost" type="button" id="cancelReply" hidden>Cancel reply</button></div>' +
            '</form>'
          : '<p class="meta mt-14">You do not have permission to comment on this record.</p>') +
      '</div>' +
    '</section>';
  }

  /* ---------------- workflow panel ---------------- */

  function workflowPanel(r, viewer) {
    var transitions = auth.allowedTransitions(r, viewer);
    var canEdit = auth.can('report:edit', r, viewer);
    var canFeature = auth.can('report:feature', r, viewer);
    var st = store.STATUSES[r.status];

    var body = '<div class="field"><span class="field__label">Current state</span>' +
      ui.statusBadge(r.status) + (r.featured ? ' ' + ui.featuredBadge() : '') + '</div>';

    if (st.terminal) {
      body += '<p class="meta">This is a terminal state; no further transitions are available.</p>';
    }

    if (transitions.length) {
      body += '<div class="field"><label for="nextStatus">Move to</label>' +
        '<select id="nextStatus">' +
          transitions.map(function (k) {
            return '<option value="' + esc(k) + '">' + esc(store.STATUSES[k].label) + '</option>';
          }).join('') +
        '</select></div>' +
        '<div class="field"><label for="statusNote">Note (recorded in the history)</label>' +
        '<input type="text" id="statusNote" placeholder="Optional"></div>' +
        '<button class="btn btn--primary btn--block" type="button" id="applyStatus">Apply change</button>';
    } else if (!st.terminal) {
      body += '<p class="meta">No transitions are available to you from this state.</p>';
    }

    if (canFeature) {
      body += '<hr><label class="checkline"><input type="checkbox" id="featureToggle"' + (r.featured ? ' checked' : '') + '>' +
        '<span><strong>Feature in the report library</strong><br>' +
        '<span class="meta">Featured records appear first for everyone in the group.</span></span></label>';
    }

    if (canEdit) {
      body += '<hr><a class="btn btn--block" href="#/report/' + esc(r.id) + '/edit">Edit this record</a>';
      if (!auth.isSupervisor()) {
        body += '<p class="field__hint">You can edit until the supervisor opens the record for review, ' +
          'and again if revisions are requested.</p>';
      }
    } else if (viewer && r.ownerId === viewer.id) {
      body += '<hr>' + ui.notice('locked', 'Editing is locked',
        'The record is in <strong>' + esc(st.label) + '</strong>. It becomes editable again if the ' +
        'supervisor requests revisions. You can still withdraw it from the list above.');
    }

    if (auth.can('report:delete', r, viewer)) {
      body += '<hr><button class="btn btn--danger btn--block btn--sm" type="button" id="deleteReport">Delete record permanently</button>';
    }

    return '<section class="card"><h3>Workflow</h3>' + body + '</section>';
  }

  function historyPanel(r) {
    if (!r.history || !r.history.length) return '';
    var items = r.history.slice().reverse().map(function (h) {
      var who = store.userById(h.by);
      var label = !h.from ? store.STATUSES[h.to].label
                : h.from === h.to ? 'Record updated'
                : store.STATUSES[h.from].label + ' → ' + store.STATUSES[h.to].label;
      return '<li><time datetime="' + esc(h.at) + '">' + esc(ui.fmtDateTime(h.at)) + '</time>' +
        '<strong>' + esc(label) + '</strong>' +
        '<div class="meta">' + esc(who ? who.fullName : 'System') + (h.note ? ' — ' + esc(h.note) : '') + '</div></li>';
    }).join('');
    return '<section class="card"><h3>Status history</h3><ul class="timeline">' + items + '</ul></section>';
  }

  /* ---------------- main ---------------- */

  function render(ctx) {
    var r = store.reportById(ctx.params.id);
    var viewer = auth.user();

    if (!r) { denied(ctx.el, false); return; }
    if (!auth.can('report:read', r, viewer)) { denied(ctx.el, true); return; }

    var owner = store.userById(r.ownerId);
    var isPrivileged = auth.isSupervisor() || (viewer && viewer.id === r.ownerId);
    var released = store.isReleased(r);

    var coAuthorHtml = (r.coAuthors || []).length
      ? r.coAuthors.map(function (ca) {
          return ca.userId && store.userById(ca.userId)
            ? '<a href="#/researcher/' + esc(ca.userId) + '">' + esc(ca.name) + '</a>'
            : esc(ca.name);
        }).join(', ')
      : '<span class="muted">None listed</span>';

    var supp = (r.supplementary || []).filter(function (s) { return ui.safeUrl(s.url); });

    ctx.el.innerHTML =
    '<div class="wrap">' +
      ui.breadcrumbs([
        { label: 'Research Hub', href: '#/' },
        { label: 'Report library', href: '#/library' },
        { label: ui.snippet(r.title, 8) }
      ]) +

      (!released && isPrivileged
        ? ui.notice('warn', 'Not shared with the group',
            'This record is in <strong>' + esc(store.STATUSES[r.status].label) + '</strong> and does not appear ' +
            'in the report library. Only you and the supervisor can open this page.')
        : '') +

      '<div class="reportcard__top mb-10">' +
        '<span class="badge">' + esc(r.missionArea) + '</span>' +
        '<span class="badge">' + esc(r.reportType) + '</span>' +
        (r.featured ? ui.featuredBadge() : '') +
        (isPrivileged ? ui.statusBadge(r.status) : '') +
      '</div>' +

      '<h1>' + esc(r.title) + '</h1>' +
      '<p class="lede fs-98">' + esc(store.authorLine(r)) + '</p>' +
      '<div class="btn-row"><button class="btn btn--sm" type="button" id="citeBtn">Cite this record</button></div>' +

      '<div class="split mt-26">' +
        '<div>' +
          '<section class="card mb-20">' +
            '<h3>Abstract</h3>' +
            '<p class="prewrap mb-0">' + esc(r.abstract) + '</p>' +
          '</section>' +

          '<section class="card mb-20">' +
            '<h3>Record metadata</h3>' +
            '<dl class="dl">' +
              '<dt>Lead author</dt><dd>' + (owner
                  ? '<a href="#/researcher/' + esc(owner.id) + '">' + esc(owner.fullName) + '</a>' +
                    (owner.institution ? ' <span class="meta">— ' + esc(owner.institution) + '</span>' : '')
                  : '<span class="muted">Unknown</span>') + '</dd>' +
              '<dt>Co-authors</dt><dd>' + coAuthorHtml + '</dd>' +
              '<dt>Mission area</dt><dd>' + esc(r.missionArea) + '</dd>' +
              '<dt>Report type</dt><dd>' + esc(r.reportType) + '</dd>' +
              '<dt>Keywords</dt><dd>' + ((r.keywords || []).length
                  ? r.keywords.map(function (k) {
                      return '<a class="tag" href="#/library?q=' + encodeURIComponent(k) + '">' + esc(k) + '</a>';
                    }).join(' ')
                  : '<span class="muted">None</span>') + '</dd>' +
              '<dt>Submitted</dt><dd>' + esc(ui.fmtDate(r.submittedAt)) + '</dd>' +
              '<dt>Last updated</dt><dd>' + esc(ui.fmtDate(r.updatedAt)) + '</dd>' +
              '<dt>Supervisor</dt><dd>Prof. Bernard Foing</dd>' +
              '<dt>Record identifier</dt><dd><code>' + esc(r.id) + '</code></dd>' +
            '</dl>' +
            (r.dataAvailability
              ? '<hr><h4>Data availability</h4><p class="mb-0">' + esc(r.dataAvailability) + '</p>'
              : '') +
          '</section>' +

          (isPrivileged ? commentsPanel(r, viewer) : '') +
        '</div>' +

        '<div>' +
          '<section class="card mb-20"><h3>File</h3>' + ui.fileControl(r) +
            (supp.length
              ? '<hr><h4>Supplementary material</h4><ul class="linklist">' +
                supp.map(function (s) {
                  return '<li><a href="' + esc(ui.safeUrl(s.url)) + '" rel="noopener">' +
                         esc(s.label || s.url) + '</a></li>';
                }).join('') + '</ul>'
              : '') +
          '</section>' +
          (isPrivileged ? workflowPanel(r, viewer) : '') +
          (isPrivileged ? '<div class="mt-20">' + historyPanel(r) + '</div>' : '') +
          (!isPrivileged
            ? '<section class="card"><h3>Citation</h3><p class="meta mb-0">' +
              esc(store.authorLine(r)) + ' (' + esc(ui.year(r.submittedAt || r.createdAt)) + '). ' +
              esc(r.title) + '. EuroSpaceHub Lunar &amp; Mars Research Hub (internal), ' +
              'supervised by Prof. Bernard Foing.' +
              '</p></section>'
            : '') +
        '</div>' +
      '</div>' +
    '</div>';

    document.getElementById('citeBtn').addEventListener('click', function () { openCiteModal(r); });
    if (isPrivileged) wire(r, viewer, ctx);
  }

  /* Cite modal — pick a format, copy or download. The citation text is set as a
     textarea .value (not innerHTML), so a hostile title cannot inject markup. */
  function openCiteModal(r) {
    ui.modal({
      title: 'Cite this record',
      cancelLabel: 'Close',
      body:
        '<div class="field"><label for="citeFmt">Format</label>' +
          '<select id="citeFmt">' +
            '<option value="apa">Plain (APA-style)</option>' +
            '<option value="bibtex">BibTeX</option>' +
            '<option value="ris">RIS</option>' +
          '</select></div>' +
        '<div class="field"><label class="sr-only" for="citeOut">Citation text</label>' +
          '<textarea id="citeOut" rows="7" readonly></textarea></div>' +
        '<div class="btn-row"><button class="btn btn--sm btn--primary" type="button" id="citeCopy">Copy</button>' +
          '<button class="btn btn--sm" type="button" id="citeDownload">Download</button></div>'
    });
    var sel = document.getElementById('citeFmt');
    var out = document.getElementById('citeOut');
    function refresh() { out.value = ESH.exporter.citation(r, sel.value); }
    sel.addEventListener('change', refresh);
    refresh();

    document.getElementById('citeCopy').addEventListener('click', function () {
      out.select();
      var done = false;
      try {
        if (global.navigator && navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(out.value); done = true;
        }
      } catch (e) {}
      if (!done) { try { done = document.execCommand('copy'); } catch (e) {} }
      ui.toast(done ? 'Citation copied.' : 'Select the text and copy manually.', done ? 'good' : 'err');
    });
    document.getElementById('citeDownload').addEventListener('click', function () {
      var ext = sel.value === 'bibtex' ? 'bib' : sel.value === 'ris' ? 'ris' : 'txt';
      var mime = sel.value === 'bibtex' ? 'application/x-bibtex'
               : sel.value === 'ris' ? 'application/x-research-info-systems' : 'text/plain';
      ESH.exporter.download('citation-' + r.id + '.' + ext, mime, out.value);
    });
  }

  function wire(r, viewer, ctx) {
    var reRender = function () { router.resolve(); };

    /* --- comments --- */
    var cForm = document.getElementById('commentForm');
    if (cForm) {
      var hint = document.getElementById('replyHint');
      var cancel = document.getElementById('cancelReply');

      ctx.el.querySelectorAll('[data-reply]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var id = btn.getAttribute('data-reply');
          var target = (r.comments || []).filter(function (c) { return c.id === id; })[0];
          var who = target ? store.userById(target.authorId) : null;
          cForm.elements.parentId.value = id;
          hint.hidden = false;
          hint.textContent = 'Replying to ' + (who ? who.fullName : 'a comment') + '.';
          cancel.hidden = false;
          cForm.elements.body.focus();
        });
      });
      cancel.addEventListener('click', function () {
        cForm.elements.parentId.value = ''; hint.hidden = true; cancel.hidden = true;
      });

      cForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var body = cForm.elements.body.value.trim();
        if (!body) { ui.fieldError(cForm.elements.body, 'Enter a comment before posting.'); return; }
        var internal = cForm.elements.internal ? cForm.elements.internal.checked : false;
        if (internal && !auth.can('comment:writeInternal', r, viewer)) {
          ui.toast('Only supervisors may write internal notes.', 'err'); return;
        }
        store.addComment(r.id, viewer.id, body, cForm.elements.parentId.value || null, internal);
        ui.toast(internal ? 'Internal note added.' : 'Comment posted.', 'good');
        reRender();
      });
    }

    /* --- status transition --- */
    var applyBtn = document.getElementById('applyStatus');
    if (applyBtn) {
      applyBtn.addEventListener('click', function () {
        var to = document.getElementById('nextStatus').value;
        var note = document.getElementById('statusNote').value.trim();
        if (!auth.canTransition(r, to, viewer)) { ui.toast('That transition is not permitted.', 'err'); return; }
        var label = store.STATUSES[to].label;
        ui.confirmDialog('Change status', 'Move this record to "' + label + '"?', 'Change status', function () {
          store.setStatus(r.id, to, viewer.id, note);
          ui.toast('Status changed to ' + label + '.', 'good');
          reRender();
        });
      });
    }

    /* --- feature toggle --- */
    var feat = document.getElementById('featureToggle');
    if (feat) {
      feat.addEventListener('change', function () {
        if (!auth.can('report:feature', r, viewer)) { feat.checked = r.featured; return; }
        store.updateReport(r.id, { featured: feat.checked });
        store.logHistory(r.id, viewer.id, r.status, r.status,
          feat.checked ? 'Marked as featured in the report library.' : 'Removed from featured.');
        ui.toast(feat.checked ? 'Record featured in the library.' : 'Record removed from featured.', 'good');
        reRender();
      });
    }

    /* --- delete --- */
    var del = document.getElementById('deleteReport');
    if (del) {
      del.addEventListener('click', function () {
        ui.confirmDialog('Delete record',
          'This permanently removes the record, its history and all comments. This cannot be undone.',
          'Delete permanently', function () {
            var s = store.getState();
            s.reports = s.reports.filter(function (x) { return x.id !== r.id; });
            store.save();
            ui.toast('Record deleted.', 'good');
            router.navigate('#/dashboard');
          }, true);
      });
    }
  }

  ESH.views = ESH.views || {};
  ESH.views.report = render;

})(window);
