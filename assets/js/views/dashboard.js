/* ==========================================================================
   views/dashboard.js — the supervisor's private area.

   Route guard: 'supervisor'. Everything below assumes the actor is a
   supervisor, but each mutating control re-checks auth.can() before acting so
   that the guard is not the only thing standing between a role and a write.

   Single view: analytics summary → researcher roster → the full report table
   with search, filters, column sorting, bulk status actions, and a per-report
   feedback panel that opens inline.
   ========================================================================== */
(function (global) {
  'use strict';

  var ESH = global.ESH, ui = ESH.ui, store = ESH.store, auth = ESH.auth,
      router = ESH.router, charts = ESH.charts;
  var esc = ui.esc;

  var openPanel = null;    /* report id whose feedback panel is expanded */
  var selected = {};       /* report id -> true */

  /* ---------------- analytics ---------------- */

  function analytics(reports, interns) {
    var byStatus = {};
    store.STATUS_ORDER.forEach(function (k) { byStatus[k] = 0; });
    var byArea = {};
    store.MISSION_AREAS.forEach(function (a) { byArea[a] = 0; });

    reports.forEach(function (r) {
      byStatus[r.status] = (byStatus[r.status] || 0) + 1;
      byArea[r.missionArea] = (byArea[r.missionArea] || 0) + 1;
    });

    var awaiting = byStatus.submitted + byStatus.review;
    var live = byStatus.approved + byStatus.published;
    var activeInterns = interns.filter(function (u) { return u.standing === 'active'; }).length;
    var featured = reports.filter(function (r) { return r.featured; }).length;

    var statusData = store.STATUS_ORDER.map(function (k) {
      return { label: store.STATUSES[k].label, value: byStatus[k] };
    });
    var areaData = store.MISSION_AREAS.map(function (a) { return { label: a, value: byArea[a] }; });

    /* Review turnaround: days from a record being Submitted to the supervisor's
       first decision on it (opening for review, requesting revisions, approving
       or rejecting). Answers "how long is work sitting with me?". */
    var DECISIONS = ['review', 'revisions', 'approved', 'rejected'];
    var turns = [];
    reports.forEach(function (r) {
      if (!r.submittedAt) return;
      var sub = new Date(r.submittedAt).getTime();
      var decided = null;
      (r.history || []).forEach(function (h) {
        if (decided !== null) return;
        if (DECISIONS.indexOf(h.to) === -1) return;
        var by = store.userById(h.by);
        var at = new Date(h.at).getTime();
        if (by && by.role === 'supervisor' && at >= sub) decided = at;
      });
      if (decided !== null) turns.push((decided - sub) / 86400000);
    });
    var avgTurn = turns.length
      ? (turns.reduce(function (a, b) { return a + b; }, 0) / turns.length).toFixed(1) + ' days'
      : '—';

    /* Submissions over the last six calendar months (by submittedAt). */
    var MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var now = new Date(), months = [];
    for (var m = 5; m >= 0; m--) {
      var dt = new Date(now.getFullYear(), now.getMonth() - m, 1);
      months.push({ key: dt.getFullYear() + '-' + (dt.getMonth() + 1), label: MON[dt.getMonth()], value: 0 });
    }
    reports.forEach(function (r) {
      if (!r.submittedAt) return;
      var d = new Date(r.submittedAt);
      var key = d.getFullYear() + '-' + (d.getMonth() + 1);
      months.forEach(function (mm) { if (mm.key === key) mm.value++; });
    });

    return '' +
    '<section class="section">' +
      '<div class="section__head"><h2>Summary</h2>' +
        '<span class="meta">Across all researchers and all workflow states.</span></div>' +
      '<div class="stats mb-20">' +
        charts.statTile('Researchers', String(interns.length), activeInterns + ' currently active') +
        charts.statTile('Reports', String(reports.length), featured + ' featured in the library') +
        charts.statTile('Awaiting your action', String(awaiting), 'Submitted or under review') +
        charts.statTile('Shared records', String(live), 'Approved or published') +
        charts.statTile('Avg. review turnaround', avgTurn, 'Submitted → your first decision') +
      '</div>' +
      '<div class="grid grid--2 mb-20">' +
        charts.horizontalBars({
          title: 'Reports by workflow state',
          subtitle: 'Every record currently in the hub.',
          data: statusData, color: 'var(--series-1)', unit: 'reports'
        }) +
        charts.horizontalBars({
          title: 'Reports by mission area',
          subtitle: 'Lunar, Mars, both, or other.',
          data: areaData, color: 'var(--series-2)', unit: 'reports'
        }) +
      '</div>' +
      charts.columnChart({
        title: 'Submissions over time',
        subtitle: 'Records submitted for review, by month (last six months).',
        data: months, color: 'var(--series-1)', unit: 'submissions'
      }) +
    '</section>';
  }

  /* ---------------- researcher roster ---------------- */

  function roster(interns, reports) {
    var counts = {};
    reports.forEach(function (r) {
      counts[r.ownerId] = counts[r.ownerId] || { total: 0, open: 0, pub: 0 };
      counts[r.ownerId].total++;
      if (r.status === 'submitted' || r.status === 'review' || r.status === 'revisions') counts[r.ownerId].open++;
      if (store.isReleased(r)) counts[r.ownerId].pub++;
    });

    return '' +
    '<section class="section">' +
      '<div class="section__head"><h2>Researchers</h2>' +
        '<span class="meta">' + interns.length + ' registered</span>' +
        /* With a backend there is no public registration form, so this is the
           only way an account comes into existence. In demo mode researchers
           self-register at #/register and this would be an odd second path. */
        (store.apiMode()
          ? '<button class="btn btn--sm btn--ghost" type="button" id="dAddUser">Add researcher</button>'
          : '') +
      '</div>' +
      '<div class="tablewrap"><table class="data"><thead><tr>' +
        '<th scope="col">Researcher</th><th scope="col">Institution</th><th scope="col">Programme</th>' +
        '<th scope="col">Period</th><th scope="col">Standing</th>' +
        '<th scope="col" class="num">Reports</th><th scope="col" class="num">In review</th>' +
        '<th scope="col" class="num">Shared</th><th scope="col">Notes</th>' +
      '</tr></thead><tbody>' +
      (interns.length ? interns.map(function (u) {
        var c = counts[u.id] || { total: 0, open: 0, pub: 0 };
        return '<tr>' +
          '<td><a class="rowtitle" href="#/researcher/' + esc(u.id) + '">' + esc(u.fullName) + '</a>' +
            '<div class="meta">' + esc(u.email) + '</div></td>' +
          '<td>' + esc(u.institution) + '</td>' +
          '<td>' + esc(u.programme || '—') + '</td>' +
          '<td class="nowrap meta">' + esc(ui.fmtDate(u.startDate)) + '<br>' +
            esc(u.endDate ? ui.fmtDate(u.endDate) : 'open-ended') + '</td>' +
          '<td>' + ui.standingBadge(u.standing) + '</td>' +
          '<td class="num">' + c.total + '</td>' +
          '<td class="num">' + c.open + '</td>' +
          '<td class="num">' + c.pub + '</td>' +
          '<td>' + (u.internalNotes ? '<span class="badge badge--featured" title="' + esc(u.internalNotes) + '">Note</span>' : '<span class="muted">—</span>') + '</td>' +
        '</tr>';
      }).join('') : '<tr><td colspan="9" class="muted">No researchers registered yet.</td></tr>') +
      '</tbody></table></div>' +
    '</section>';
  }

  /* ---------------- create a researcher account ----------------
     API mode only. The server generates the initial password and returns it
     once; it is never stored anywhere it can be read back, so the dialog has
     to surface it before it closes. */

  function openCreateUser() {
    ui.modal({
      title: 'Add a researcher',
      confirmLabel: 'Create account',
      body:
        '<form id="cuForm" novalidate>' +
          '<div class="field"><label for="cuName">Full name <span class="req">*</span></label>' +
            '<input type="text" id="cuName" name="fullName" autocomplete="off" required></div>' +
          '<div class="field"><label for="cuEmail">Email address <span class="req">*</span></label>' +
            '<input type="email" id="cuEmail" name="email" autocomplete="off" required></div>' +
          '<div class="field"><label for="cuInst">Institution</label>' +
            '<input type="text" id="cuInst" name="institution" list="cuInstList" autocomplete="off">' +
            '<datalist id="cuInstList">' +
              (store.INSTITUTIONS || []).map(function (i) {
                return '<option value="' + esc(i) + '"></option>';
              }).join('') +
            '</datalist></div>' +
          '<div class="field"><label for="cuProg">Programme</label>' +
            '<input type="text" id="cuProg" name="programme" autocomplete="off"></div>' +
          '<div class="field"><label for="cuStart">Research period start</label>' +
            '<input type="date" id="cuStart" name="startDate"></div>' +
          '<div class="field"><label for="cuEnd">Research period end</label>' +
            '<input type="date" id="cuEnd" name="endDate"></div>' +
          '<div class="field"><label for="cuTopic">Research topic</label>' +
            '<input type="text" id="cuTopic" name="researchTopic" autocomplete="off"></div>' +
          '<p class="field__hint">An initial password is generated and shown to you once. Hand it ' +
            'over directly; they can change it from their account page.</p>' +
          '<p id="cuErr" class="field__err" hidden></p>' +
        '</form>',
      /* Returning truthy keeps the dialog open — the request is in flight and
         may still be refused, so the form must survive to show the error. */
      onConfirm: function (back) { submitCreateUser(back); return true; }
    });
  }

  function submitCreateUser(back) {
    var form = document.getElementById('cuForm');
    var errEl = document.getElementById('cuErr');
    errEl.hidden = true;
    ui.clearAllErrors(form);

    var name = form.elements.fullName.value.trim();
    var email = form.elements.email.value.trim();
    if (!name) { ui.fieldError(form.elements.fullName, 'A full name is required.'); ui.focusFirstError(form); return; }
    if (!ui.isEmail(email)) { ui.fieldError(form.elements.email, 'Enter a valid email address.'); ui.focusFirstError(form); return; }

    var confirmBtn = back.querySelector('[data-confirm]');
    if (confirmBtn) confirmBtn.disabled = true;

    store.createUser({
      fullName: name,
      email: email,
      role: 'intern',
      institution: form.elements.institution.value.trim(),
      programme: form.elements.programme.value.trim(),
      startDate: form.elements.startDate.value,
      endDate: form.elements.endDate.value,
      researchTopic: form.elements.researchTopic.value.trim()
    }).then(function (res) {
      ui.closeModal();
      /* A modal rather than a toast: a toast dismisses itself, and this is the
         only moment the password exists in readable form. */
      ui.modal({
        title: 'Account created',
        cancelLabel: 'Done',
        body:
          '<p>An account for <strong>' + esc(res.user.fullName) + '</strong> is ready.</p>' +
          '<div class="notice notice--warn mt-12"><h4>Initial password</h4>' +
            '<p class="mb-0"><code class="fs-105">' + esc(res.initialPassword) + '</code></p>' +
            '<p class="meta mt-8 mb-0">Copy it now — it is not shown again. Hand it over ' +
              'directly rather than emailing it, and ask them to change it once signed in.</p>' +
          '</div>'
      });
      router.resolve();
    })['catch'](function (err) {
      if (confirmBtn) confirmBtn.disabled = false;
      errEl.hidden = false;
      errEl.textContent = err.message || 'The account could not be created.';
    });
  }

  /* ---------------- report table ---------------- */

  function matches(r, f) {
    if (f.status !== 'all' && r.status !== f.status) return false;
    if (f.status === 'all' && f.bucket === 'action' && !(r.status === 'submitted' || r.status === 'review')) return false;
    if (f.area !== 'all' && r.missionArea !== f.area) return false;
    if (f.type !== 'all' && r.reportType !== f.type) return false;
    if (f.intern !== 'all' && r.ownerId !== f.intern) return false;
    if (f.q) {
      var owner = store.userById(r.ownerId);
      var hay = [r.title, r.abstract, (r.keywords || []).join(' '), store.authorLine(r),
                 owner ? owner.institution : '', r.reportType, r.missionArea].join(' ').toLowerCase();
      var terms = f.q.toLowerCase().split(/\s+/).filter(Boolean);
      for (var i = 0; i < terms.length; i++) if (hay.indexOf(terms[i]) === -1) return false;
    }
    return true;
  }

  var SORTS = {
    title:   function (a, b) { return a.title.localeCompare(b.title); },
    intern:  function (a, b) { return store.authorLine(a).localeCompare(store.authorLine(b)); },
    status:  function (a, b) { return store.STATUSES[a.status].order - store.STATUSES[b.status].order; },
    area:    function (a, b) { return a.missionArea.localeCompare(b.missionArea); },
    type:    function (a, b) { return a.reportType.localeCompare(b.reportType); },
    date:    function (a, b) { return new Date(a.submittedAt || a.createdAt) - new Date(b.submittedAt || b.createdAt); },
    updated: function (a, b) { return new Date(a.updatedAt || a.createdAt) - new Date(b.updatedAt || b.createdAt); }
  };

  function sortIndicator(key, f) {
    if (f.sort !== key) return '';
    return '<span class="sortbtn__ind" aria-hidden="true">' + (f.dir === 'asc' ? '▲' : '▼') + '</span>';
  }
  function th(key, label, f) {
    var nextDir = (f.sort === key && f.dir === 'asc') ? 'desc' : 'asc';
    return '<th scope="col"><button class="sortbtn" type="button" data-sort="' + esc(key) + '" data-dir="' + nextDir + '" ' +
      'aria-label="Sort by ' + esc(label) + '">' + esc(label) + sortIndicator(key, f) + '</button></th>';
  }

  /* Inline feedback panel — the per-report comment thread plus quick actions. */
  function feedbackPanel(r, viewer, colspan) {
    var comments = auth.visibleComments(r, viewer);
    var transitions = auth.allowedTransitions(r, viewer);

    var thread = comments.length
      ? comments.filter(function (c) { return !c.parentId; }).map(function (c) {
          var a = store.userById(c.authorId);
          var replies = comments.filter(function (x) { return x.parentId === c.id; });
          return '<div class="comment' + (c.internal ? ' comment--internal' : '') + '">' +
            '<div class="comment__head"><span class="comment__who">' + esc(a ? a.fullName : 'Unknown') + '</span>' +
            (c.internal ? '<span class="badge badge--featured">Internal</span>' : '') +
            '<span class="comment__when">' + esc(ui.fmtDateTime(c.at)) + '</span></div>' +
            '<p class="comment__body">' + esc(c.body) + '</p>' +
            (replies.length ? '<div class="comment__replies">' + replies.map(function (x) {
              var ra = store.userById(x.authorId);
              return '<div class="comment"><div class="comment__head"><span class="comment__who">' +
                esc(ra ? ra.fullName : 'Unknown') + '</span><span class="comment__when">' +
                esc(ui.fmtDateTime(x.at)) + '</span></div><p class="comment__body">' + esc(x.body) + '</p></div>';
            }).join('') + '</div>' : '') +
          '</div>';
        }).join('')
      : '<p class="meta">No comments on this record yet.</p>';

    return '<tr data-panelrow="' + esc(r.id) + '"><td class="bg-1" colspan="' + colspan + '">' +
      '<div class="split panelsplit">' +
        '<div>' +
          '<h4 class="mb-10">Review correspondence</h4>' + thread +
          '<form data-quickcomment="' + esc(r.id) + '" class="mt-14">' +
            '<div class="field mb-10">' +
              '<label class="sr-only" for="qc_' + esc(r.id) + '">Comment</label>' +
              '<textarea id="qc_' + esc(r.id) + '" name="body" rows="3" placeholder="Feedback for the author…"></textarea></div>' +
            '<label class="checkline mb-10"><input type="checkbox" name="internal">' +
              '<span>Internal note — supervisors only.</span></label>' +
            '<button class="btn btn--sm btn--primary" type="submit">Post comment</button>' +
          '</form>' +
        '</div>' +
        '<div>' +
          '<h4 class="mb-10">Record</h4>' +
          '<dl class="dl dl--compact">' +
            '<dt>Author</dt><dd>' + esc(store.authorLine(r)) + '</dd>' +
            '<dt>State</dt><dd>' + ui.statusBadge(r.status) + '</dd>' +
            '<dt>Submitted</dt><dd>' + esc(ui.fmtDate(r.submittedAt)) + '</dd>' +
            '<dt>Updated</dt><dd>' + esc(ui.fmtDate(r.updatedAt)) + '</dd>' +
            '<dt>File</dt><dd>' + (r.file ? esc(r.file.name) : '<span class="muted">none</span>') + '</dd>' +
          '</dl>' +
          '<p class="meta mt-10">' + esc(ui.snippet(r.abstract, 40)) + '</p>' +
          '<hr>' +
          (transitions.length
            ? '<div class="field mb-10"><label for="qs_' + esc(r.id) + '">Move to</label>' +
              '<select id="qs_' + esc(r.id) + '" data-quickstatus="' + esc(r.id) + '">' +
                transitions.map(function (k) { return '<option value="' + esc(k) + '">' + esc(store.STATUSES[k].label) + '</option>'; }).join('') +
              '</select></div>' +
              '<button class="btn btn--sm btn--primary" type="button" data-applystatus="' + esc(r.id) + '">Apply</button> '
            : '<p class="meta">No transitions available from this state.</p>') +
          (auth.can('report:feature', r, viewer)
            ? '<label class="checkline mt-12"><input type="checkbox" data-quickfeature="' + esc(r.id) + '"' +
              (r.featured ? ' checked' : '') + '><span>Featured in the report library</span></label>'
            : '') +
          '<p class="mt-12 mb-0"><a class="btn btn--sm" href="#/report/' + esc(r.id) + '">Open full record</a></p>' +
        '</div>' +
      '</div>' +
    '</td></tr>';
  }

  /* How long a record has waited in the review queue. Shown only for the two
     states that are waiting on the supervisor; emphasised past two weeks. The
     duration is always spelled out in text, so colour is never the only cue. */
  function queueAge(r) {
    if (r.status !== 'submitted' && r.status !== 'review') return '';
    var d = ui.daysSince(r.submittedAt || r.updatedAt);
    if (d === null) return '';
    var text = d === 0 ? 'in queue today' : 'waiting ' + d + ' day' + (d === 1 ? '' : 's');
    var stale = d >= 14;
    return '<div class="queueage' + (stale ? ' queueage--stale' : '') + '">' +
      (stale ? '<strong>' + text + '</strong>' : text) + '</div>';
  }

  function reportTable(reports, interns, f, viewer) {
    var rows = reports.filter(function (r) { return matches(r, f); });
    var hlTerms = f.q ? f.q.split(/\s+/).filter(Boolean) : null;
    var cmp = SORTS[f.sort] || SORTS.updated;
    rows.sort(function (a, b) { return f.dir === 'asc' ? cmp(a, b) : -cmp(a, b); });

    /* pagination */
    var PAGE_SIZE = 25;
    var totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    var page = Math.min(totalPages, Math.max(1, parseInt(f.page, 10) || 1));
    var pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    var makeHref = function (n) {
      return '#/dashboard' + router.buildQuery({
        q: f.q, status: f.status, area: f.area, type: f.type, intern: f.intern,
        sort: f.sort, dir: f.dir, bucket: f.bucket, page: n > 1 ? n : ''
      });
    };

    var COLS = 9;
    var selCount = Object.keys(selected).filter(function (k) { return selected[k]; }).length;

    var bulkTargets = ['review','revisions','approved','published','rejected'];

    return '' +
    '<section class="section" id="reports">' +
      '<div class="section__head"><h2>All reports</h2>' +
        '<span class="meta">Every record, in every state, from every researcher.</span></div>' +

      '<form class="filters" id="dashFilters" role="search" aria-label="Filter reports">' +
        '<div class="field filters__search"><label for="dq">Search</label>' +
          '<input type="search" id="dq" name="q" value="' + esc(f.q) + '" placeholder="Title, abstract, author, keyword, institution…"></div>' +
        '<div class="field"><label for="dstatus">Status</label><select id="dstatus" name="status">' +
          '<option value="all">All states</option>' +
          store.STATUS_ORDER.map(function (k) {
            return '<option value="' + esc(k) + '"' + (f.status === k ? ' selected' : '') + '>' + esc(store.STATUSES[k].label) + '</option>';
          }).join('') + '</select></div>' +
        '<div class="field"><label for="dintern">Researcher</label><select id="dintern" name="intern">' +
          '<option value="all">All researchers</option>' +
          ui.selectOptions(interns.map(function (u) { return { value: u.id, label: u.fullName }; }), f.intern) + '</select></div>' +
        '<div class="field"><label for="darea">Mission area</label><select id="darea" name="area">' +
          '<option value="all">All areas</option>' + ui.selectOptions(store.MISSION_AREAS, f.area) + '</select></div>' +
        '<div class="field"><label for="dtype">Report type</label><select id="dtype" name="type">' +
          '<option value="all">All types</option>' + ui.selectOptions(store.REPORT_TYPES, f.type) + '</select></div>' +
        '<div class="filters__reset btn-row">' +
          '<button class="btn btn--sm' + (f.bucket === 'action' ? ' btn--primary' : ' btn--ghost') + '" type="button" id="dNeedsAction">' +
            'Needs my action</button>' +
          '<button class="btn btn--sm btn--ghost" type="button" id="dReset">Clear</button>' +
        '</div>' +
      '</form>' +

      '<div class="card toolbar mb-14">' +
        '<strong class="toolbar__label">Bulk actions</strong>' +
        '<span class="meta" id="selCount">' + selCount + ' selected</span>' +
        '<select id="bulkStatus" class="minw-190" aria-label="Bulk status target">' +
          '<option value="">Move selected to…</option>' +
          bulkTargets.map(function (k) { return '<option value="' + esc(k) + '">' + esc(store.STATUSES[k].label) + '</option>'; }).join('') +
        '</select>' +
        '<button class="btn btn--sm" type="button" id="bulkApply"' + (selCount ? '' : ' disabled') + '>Apply</button>' +
        '<button class="btn btn--sm" type="button" id="bulkFeature"' + (selCount ? '' : ' disabled') + '>Feature selected</button>' +
        '<button class="btn btn--sm" type="button" id="bulkUnfeature"' + (selCount ? '' : ' disabled') + '>Remove featured</button>' +
        '<button class="btn btn--sm btn--ghost" type="button" id="bulkClear"' + (selCount ? '' : ' disabled') + '>Clear selection</button>' +
        '<span class="meta fb-100">Transitions that are not legal for a selected record are skipped and reported.</span>' +
      '</div>' +

      '<p class="meta mb-10" role="status">' +
        (rows.length
          ? 'Showing <strong>' + ((page - 1) * PAGE_SIZE + 1) + '–' + Math.min(page * PAGE_SIZE, rows.length) +
            '</strong> of ' + rows.length + ' matching' +
            (rows.length !== reports.length ? ' (of ' + reports.length + ' total)' : '') + '.'
          : '0 of ' + reports.length + ' records match these filters.') +
      '</p>' +

      '<div class="tablewrap"><table class="data"><thead><tr>' +
        '<th scope="col" class="rowcheck"><input type="checkbox" id="checkAll" aria-label="Select all shown"></th>' +
        th('title', 'Title', f) +
        th('intern', 'Researcher', f) +
        th('status', 'Status', f) +
        th('area', 'Area', f) +
        th('type', 'Type', f) +
        th('date', 'Submitted', f) +
        th('updated', 'Updated', f) +
        '<th scope="col">Review</th>' +
      '</tr></thead><tbody>' +
      (rows.length ? pageRows.map(function (r) {
        var owner = store.userById(r.ownerId);
        var open = openPanel === r.id;
        return '<tr>' +
          '<td class="rowcheck"><input type="checkbox" data-select="' + esc(r.id) + '"' + (selected[r.id] ? ' checked' : '') +
            ' aria-label="Select ' + esc(r.title) + '"></td>' +
          '<td><a class="rowtitle" href="#/report/' + esc(r.id) + '">' + ui.highlight(ui.snippet(r.title, 12), hlTerms) + '</a>' +
            (r.featured ? ' ' + ui.featuredBadge() : '') +
            ((r.comments || []).length ? ' <span class="meta">· ' + r.comments.length + ' comment' + (r.comments.length === 1 ? '' : 's') + '</span>' : '') + '</td>' +
          '<td class="nowrap">' + (owner ? '<a href="#/researcher/' + esc(owner.id) + '">' + esc(owner.fullName) + '</a>' : '<span class="muted">—</span>') + '</td>' +
          '<td class="nowrap">' + ui.statusBadge(r.status) + queueAge(r) + '</td>' +
          '<td class="nowrap">' + esc(r.missionArea) + '</td>' +
          '<td class="nowrap">' + esc(r.reportType) + '</td>' +
          '<td class="nowrap meta">' + esc(r.submittedAt ? ui.fmtDate(r.submittedAt) : '—') + '</td>' +
          '<td class="nowrap meta">' + esc(ui.fmtDate(r.updatedAt)) + '</td>' +
          '<td class="nowrap"><button class="btn btn--sm" type="button" data-panel="' + esc(r.id) + '" aria-expanded="' + open + '">' +
            (open ? 'Close' : 'Review') + '</button></td>' +
        '</tr>' + (open ? feedbackPanel(r, viewer, COLS) : '');
      }).join('') : '<tr><td colspan="' + COLS + '" class="muted">No records match these filters.</td></tr>') +
      '</tbody></table></div>' +
      ui.pager(page, totalPages, makeHref) +
    '</section>';
  }

  /* ---------------- main ---------------- */

  function render(ctx) {
    var viewer = auth.user();
    if (!auth.can('dashboard:view', null, viewer)) { router.navigate('#/denied', true); return; }

    var reports = auth.visibleReports(viewer);          /* supervisor → everything */
    var interns = store.interns();

    var f = {
      q:      ctx.query.q      || '',
      status: ctx.query.status || 'all',
      area:   ctx.query.area   || 'all',
      type:   ctx.query.type   || 'all',
      intern: ctx.query.intern || 'all',
      sort:   ctx.query.sort   || 'updated',
      dir:    ctx.query.dir    || 'desc',
      bucket: ctx.query.bucket || '',
      page:   ctx.query.page   || '1'
    };

    ctx.el.innerHTML =
    '<div class="wrap">' +
      '<p class="eyebrow">Supervisor dashboard — private</p>' +
      '<h1>Research supervision dashboard</h1>' +
      '<p class="lede">Signed in as <strong>' + esc(viewer.fullName) + '</strong>. This area is restricted to the ' +
        'supervisor role and is not reachable by researchers.</p>' +
      analytics(reports, interns) +
      reportTable(reports, interns, f, viewer) +
      roster(interns, reports) +
    '</div>';

    charts.bindTips(ctx.el);
    wire(ctx, f, viewer, reports);
  }

  function wire(ctx, f, viewer, reports) {
    function go(patch) {
      var q = {
        q: f.q, status: f.status, area: f.area, type: f.type, intern: f.intern,
        sort: f.sort, dir: f.dir, bucket: f.bucket
      };
      Object.keys(patch).forEach(function (k) { q[k] = patch[k]; });
      router.navigate('#/dashboard' + router.buildQuery(q));
    }

    /* Re-render the current view in place while keeping the scroll position —
       the router otherwise jumps to the top after every resolve(). Used for
       in-page actions (status, bulk, opening a panel) rather than navigation. */
    function resolveKeepScroll() {
      var y = global.scrollY || 0;
      router.resolve();
      if (typeof global.scrollTo === 'function') global.scrollTo(0, y);
    }

    var addUserBtn = document.getElementById('dAddUser');
    if (addUserBtn) addUserBtn.addEventListener('click', openCreateUser);

    var form = document.getElementById('dashFilters');
    function apply() {
      go({ q: form.elements.q.value.trim(), status: form.elements.status.value, area: form.elements.area.value,
           type: form.elements.type.value, intern: form.elements.intern.value });
    }
    form.addEventListener('submit', function (e) { e.preventDefault(); apply(); });
    ['status','area','type','intern'].forEach(function (n) { form.elements[n].addEventListener('change', apply); });
    var t;
    form.elements.q.addEventListener('input', function () { clearTimeout(t); t = setTimeout(apply, 320); });
    document.getElementById('dReset').addEventListener('click', function () {
      selected = {}; router.navigate('#/dashboard');
    });
    document.getElementById('dNeedsAction').addEventListener('click', function () {
      go({ bucket: f.bucket === 'action' ? '' : 'action', status: 'all' });
    });

    /* column sorting */
    ctx.el.querySelectorAll('[data-sort]').forEach(function (b) {
      b.addEventListener('click', function () {
        go({ sort: b.getAttribute('data-sort'), dir: b.getAttribute('data-dir') });
      });
    });

    /* selection */
    ctx.el.querySelectorAll('[data-select]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var id = cb.getAttribute('data-select');
        if (cb.checked) selected[id] = true; else delete selected[id];
        refreshSelUI(ctx);
      });
    });
    var all = document.getElementById('checkAll');
    if (all) all.addEventListener('change', function () {
      ctx.el.querySelectorAll('[data-select]').forEach(function (cb) {
        cb.checked = all.checked;
        var id = cb.getAttribute('data-select');
        if (all.checked) selected[id] = true; else delete selected[id];
      });
      refreshSelUI(ctx);
    });
    document.getElementById('bulkClear').addEventListener('click', function () {
      selected = {}; resolveKeepScroll();
    });

    /* bulk status */
    document.getElementById('bulkApply').addEventListener('click', function () {
      if (!auth.can('report:bulkAction', null, viewer)) { ui.toast('Not permitted.', 'err'); return; }
      var to = document.getElementById('bulkStatus').value;
      if (!to) { ui.toast('Choose a target state first.', 'err'); return; }
      var ids = Object.keys(selected).filter(function (k) { return selected[k]; });
      if (!ids.length) return;
      var legal = ids.filter(function (id) {
        var r = store.reportById(id);
        return r && auth.canTransition(r, to, viewer);
      });
      var skipped = ids.length - legal.length;
      ui.confirmDialog('Bulk status change',
        'Move ' + legal.length + ' record' + (legal.length === 1 ? '' : 's') + ' to "' +
        store.STATUSES[to].label + '"' + (skipped ? '. ' + skipped + ' selected record' +
        (skipped === 1 ? ' has' : 's have') + ' no legal transition to that state and will be skipped.' : '.'),
        'Apply to ' + legal.length, function () {
          legal.forEach(function (id) { store.setStatus(id, to, viewer.id, 'Bulk status change.'); });
          selected = {};
          ui.toast(legal.length + ' record' + (legal.length === 1 ? '' : 's') + ' updated' +
                   (skipped ? '; ' + skipped + ' skipped.' : '.'), 'good');
          resolveKeepScroll();
        });
    });

    function bulkFeature(on) {
      if (!auth.can('report:bulkAction', null, viewer)) { ui.toast('Not permitted.', 'err'); return; }
      var ids = Object.keys(selected).filter(function (k) { return selected[k]; });
      var done = 0, skipped = 0;
      ids.forEach(function (id) {
        var r = store.reportById(id);
        if (!r) return;
        if (on && !auth.can('report:feature', r, viewer)) { skipped++; return; }
        store.updateReport(id, { featured: on });
        done++;
      });
      selected = {};
      ui.toast(done + ' record' + (done === 1 ? '' : 's') + (on ? ' featured' : ' unfeatured') +
        (skipped ? '; ' + skipped + ' skipped (only approved or published records can be featured).' : '.'),
        skipped ? 'err' : 'good');
      resolveKeepScroll();
    }
    document.getElementById('bulkFeature').addEventListener('click', function () { bulkFeature(true); });
    document.getElementById('bulkUnfeature').addEventListener('click', function () { bulkFeature(false); });

    /* per-report feedback panel */
    ctx.el.querySelectorAll('[data-panel]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-panel');
        openPanel = (openPanel === id) ? null : id;
        resolveKeepScroll();
      });
    });

    ctx.el.querySelectorAll('[data-quickcomment]').forEach(function (fm) {
      fm.addEventListener('submit', function (e) {
        e.preventDefault();
        var id = fm.getAttribute('data-quickcomment');
        var body = fm.elements.body.value.trim();
        if (!body) { ui.fieldError(fm.elements.body, 'Enter a comment.'); return; }
        var r = store.reportById(id);
        if (!auth.can('comment:write', r, viewer)) { ui.toast('Not permitted.', 'err'); return; }
        var internal = fm.elements.internal.checked;
        store.addComment(id, viewer.id, body, null, internal);
        /* Append the new comment in place — no full re-render, so the open panel
           and the scroll position are preserved. */
        var container = fm.parentNode;
        var placeholder = container.querySelector(':scope > p.meta');
        if (placeholder) placeholder.remove();
        fm.insertAdjacentHTML('beforebegin',
          '<div class="comment' + (internal ? ' comment--internal' : '') + '">' +
            '<div class="comment__head"><span class="comment__who">' + esc(viewer.fullName) + '</span>' +
            (internal ? '<span class="badge badge--featured">Internal</span>' : '') +
            '<span class="comment__when">' + esc(ui.fmtDateTime(store.nowISO())) + '</span></div>' +
            '<p class="comment__body">' + esc(body) + '</p>' +
          '</div>');
        fm.reset();
        ui.toast(internal ? 'Internal note added.' : 'Comment posted.', 'good');
      });
    });

    ctx.el.querySelectorAll('[data-applystatus]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-applystatus');
        var sel = ctx.el.querySelector('[data-quickstatus="' + id + '"]');
        var r = store.reportById(id);
        if (!sel || !r) return;
        if (!auth.canTransition(r, sel.value, viewer)) { ui.toast('That transition is not permitted.', 'err'); return; }
        store.setStatus(id, sel.value, viewer.id, 'Changed from the dashboard.');
        ui.toast('Moved to ' + store.STATUSES[sel.value].label + '.', 'good');
        resolveKeepScroll();
      });
    });

    ctx.el.querySelectorAll('[data-quickfeature]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var id = cb.getAttribute('data-quickfeature');
        var r = store.reportById(id);
        if (!auth.can('report:feature', r, viewer)) { cb.checked = r.featured; return; }
        store.updateReport(id, { featured: cb.checked });
        ui.toast(cb.checked ? 'Featured in the library.' : 'Removed from featured.', 'good');
      });
    });
  }

  function refreshSelUI(ctx) {
    var n = Object.keys(selected).filter(function (k) { return selected[k]; }).length;
    var lbl = document.getElementById('selCount');
    if (lbl) lbl.textContent = n + ' selected';
    ['bulkApply','bulkFeature','bulkUnfeature','bulkClear'].forEach(function (id) {
      var b = document.getElementById(id);
      if (b) b.disabled = !n;
    });
  }

  ESH.views = ESH.views || {};
  ESH.views.dashboard = render;

})(window);
