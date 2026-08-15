/* ==========================================================================
   views/profile.js — researcher profile (colleague view, own view, supervisor view)
   and the profile edit form.

   One renderer, three progressive disclosures decided by auth.can():
     MEMBERS ONLY — route-guarded; there is no public view of any researcher.
     a colleague     → name, institution, topic, bio, links, released outputs
     the person      → + email, research-period dates, ALL own reports with
                        status, and an activity timeline
     supervisor      → + full submission history for that intern, the private
                        internal-notes field, and the standing control
   ========================================================================== */
(function (global) {
  'use strict';

  var ESH = global.ESH, ui = ESH.ui, store = ESH.store, auth = ESH.auth, router = ESH.router;
  var esc = ui.esc;

  /* Build an activity log for one researcher from report history + account events. */
  function activity(u, viewer) {
    var events = [{ at: u.createdAt, text: 'Researcher profile created.', kind: 'account' }];
    store.reportsByOwner(u.id).forEach(function (r) {
      if (!auth.can('report:read', r, viewer)) return;
      (r.history || []).forEach(function (h) {
        var who = store.userById(h.by);
        var label = h.from
          ? store.STATUSES[h.from].label + ' → ' + store.STATUSES[h.to].label
          : 'Record created';
        events.push({
          at: h.at,
          text: label,
          detail: r.title,
          reportId: r.id,
          by: who ? who.fullName : 'System',
          note: h.note
        });
      });
    });
    events.sort(function (a, b) { return new Date(b.at) - new Date(a.at); });
    return events;
  }

  function activityPanel(u, viewer) {
    var events = activity(u, viewer).slice(0, 25);
    if (!events.length) return '';
    return '<section class="card"><h3>Activity</h3><ul class="timeline">' +
      events.map(function (e) {
        return '<li><time datetime="' + esc(e.at) + '">' + esc(ui.fmtDateTime(e.at)) + '</time>' +
          '<strong>' + esc(e.text) + '</strong>' +
          (e.detail ? '<div class="meta"><a href="#/report/' + esc(e.reportId) + '">' + esc(ui.snippet(e.detail, 10)) + '</a></div>' : '') +
          (e.by ? '<div class="meta">' + esc(e.by) + (e.note ? ' — ' + esc(e.note) : '') + '</div>' : '') +
        '</li>';
      }).join('') + '</ul></section>';
  }

  function reportsPanel(u, viewer, canSeeAll) {
    var list = store.reportsByOwner(u.id).filter(function (r) {
      return auth.can('report:read', r, viewer);
    }).sort(function (a, b) {
      return new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt);
    });

    var heading = canSeeAll ? 'Submissions (all states)' : 'Shared research outputs';

    if (!list.length) {
      return '<section class="card"><h3>' + esc(heading) + '</h3>' +
        '<p class="meta mb-0">' +
        (canSeeAll ? 'No records yet.' : 'This researcher has no approved outputs shared with the group.') +
        '</p></section>';
    }

    return '<section class="card card--flush">' +
      '<div class="card__head"><h3>' + esc(heading) + '</h3><span class="meta">' + list.length + ' record' + (list.length === 1 ? '' : 's') + '</span></div>' +
      '<div class="tablewrap flush">' +
      '<table class="data"><thead><tr>' +
        '<th scope="col">Title</th><th scope="col">Area</th><th scope="col">Type</th>' +
        (canSeeAll ? '<th scope="col">Status</th>' : '') +
        '<th scope="col">Updated</th>' +
        (canSeeAll ? '<th scope="col">Actions</th>' : '') +
      '</tr></thead><tbody>' +
      list.map(function (r) {
        return '<tr>' +
          '<td><a class="rowtitle" href="#/report/' + esc(r.id) + '">' + esc(r.title) + '</a>' +
            (r.featured ? ' ' + ui.featuredBadge() : '') + '</td>' +
          '<td class="nowrap">' + esc(r.missionArea) + '</td>' +
          '<td class="nowrap">' + esc(r.reportType) + '</td>' +
          (canSeeAll ? '<td class="nowrap">' + ui.statusBadge(r.status) + '</td>' : '') +
          '<td class="nowrap">' + esc(ui.fmtDate(r.updatedAt || r.createdAt)) + '</td>' +
          (canSeeAll ? '<td class="nowrap">' + rowActions(r, viewer) + '</td>' : '') +
        '</tr>';
      }).join('') +
      '</tbody></table></div></section>';
  }

  /* Per-row controls. Both are gated on the same rules the record page uses —
     auth.can() for editing, auth.canTransition() for withdrawal — so the table
     can never offer an action the workflow would refuse. */
  function rowActions(r, viewer) {
    var out = '<div class="btn-row btn-row--tight">' +
      '<a class="btn btn--sm btn--ghost" href="#/report/' + esc(r.id) + '">Open</a>';
    if (auth.can('report:edit', r, viewer)) {
      out += '<a class="btn btn--sm" href="#/report/' + esc(r.id) + '/edit">Edit</a>';
    }
    if (auth.canTransition(r, 'withdrawn', viewer)) {
      out += '<button class="btn btn--sm btn--danger" type="button" data-withdraw="' + esc(r.id) + '">Withdraw</button>';
    }
    return out + '</div>';
  }

  function supervisorPanel(u, viewer) {
    if (!auth.can('user:readInternalNotes', u, viewer)) return '';
    return '' +
    '<section class="card card--flag">' +
      '<h3>Supervisor-only</h3>' +
      '<p class="meta">This panel is rendered only for the supervisor role. The researcher ' +
        'cannot reach it.</p>' +
      '<hr>' +
      '<div class="field"><label for="standingSel">Standing</label>' +
        '<select id="standingSel">' +
          store.STANDING.map(function (s) {
            var label = { active: 'Active', inactive: 'Inactive', alumnus: 'Alumnus' }[s];
            return '<option value="' + esc(s) + '"' + (u.standing === s ? ' selected' : '') + '>' + esc(label) + '</option>';
          }).join('') +
        '</select></div>' +
      '<div class="field"><label for="internalNotes">Internal notes</label>' +
        '<textarea id="internalNotes" rows="6" placeholder="Private notes on this researcher…">' + esc(u.internalNotes || '') + '</textarea>' +
        '<p class="field__hint">Visible to supervisors only. Never shown to the researcher.</p></div>' +
      '<button class="btn btn--primary btn--sm" type="button" id="saveSupervisor">Save supervisor fields</button>' +
      (auth.can('user:resetPassword', u, viewer)
        ? '<hr><h4>Password</h4>' +
          '<p class="field__hint mt-0">Issue a temporary password and pass it to the ' +
            'researcher yourself. It is shown once, here, and replaces their current password ' +
            'immediately. For a closed group this is usually simpler than an emailed reset link.</p>' +
          '<button class="btn btn--sm btn--danger" type="button" id="issueTempPw">Issue temporary password</button>' +
          '<div id="tempPwOut"></div>'
        : '') +
    '</section>';
  }

  /* ---------------- main profile view ---------------- */

  function render(ctx) {
    var target = store.userById(ctx.params.id);
    var viewer = auth.user();

    if (!target) {
      ctx.el.innerHTML = '<div class="wrap">' +
        ui.notice('warn', 'Researcher not found', 'No profile exists with that identifier. <a href="#/">Return to the hub</a>.') +
        '</div>';
      return;
    }

    /* Prof. Foing's own record is the hub landing page, not a generic profile. */
    if (target.id === store.SUPERVISOR_ID) { router.navigate('#/', true); return; }

    var full = auth.can('user:readFull', target, viewer);
    var isSelf = !!viewer && viewer.id === target.id;
    var isSup = auth.isSupervisor();

    if (!auth.can('user:read', target, viewer)) { router.navigate('#/signin', true); return; }

    /* Render from the PROJECTION, not the raw record: for a viewer without
       'user:readFull', projectUser() strips email, dates and internal notes,
       so a template mistake cannot leak a field the viewer may not read. */
    var view = auth.projectUser(target, viewer) || target;

    var links = view.links || {};
    var linkItems = [];
    if (ui.safeUrl(links.linkedin)) linkItems.push('<a href="' + esc(ui.safeUrl(links.linkedin)) + '" rel="noopener">LinkedIn</a>');
    if (links.orcid) linkItems.push('<a href="https://orcid.org/' + encodeURIComponent(links.orcid) + '" rel="noopener">ORCID ' + esc(links.orcid) + '</a>');
    if (ui.safeUrl(links.website)) linkItems.push('<a href="' + esc(ui.safeUrl(links.website)) + '" rel="noopener">Personal site</a>');

    ctx.el.innerHTML =
    '<div class="wrap">' +
      (isSelf
        ? '<p class="eyebrow">Your researcher profile</p>'
        : ui.breadcrumbs([{ label: 'Research Hub', href: '#/' }, { label: view.fullName }])) +

      '<div class="profilehead mb-8">' +
        ui.avatar(view, 'lg') +
        '<div class="profilehead__body">' +
          '<h1 class="mb-6">' + esc(view.fullName) + '</h1>' +
          '<p class="lede mb-10">' + esc(view.researchTopic || 'Researcher') + '</p>' +
          '<div class="reportcard__top">' +
            '<span class="badge badge--role">' + esc(view.role === 'supervisor' ? 'Supervisor' : 'Intern / student researcher') + '</span>' +
            (isSup || isSelf ? ui.standingBadge(view.standing) : '') +
          '</div>' +
        '</div>' +
        (auth.can('user:edit', target, viewer)
          ? '<a class="btn" href="#/researcher/' + esc(target.id) + '/edit">Edit profile</a>' : '') +
      '</div>' +

      '<div class="split mt-24">' +
        '<div>' +
          (view.bio
            ? '<section class="card mb-20"><h3>Biography</h3>' +
              '<p class="prewrap mb-0">' + esc(view.bio) + '</p></section>'
            : '') +
          '<div class="mb-20">' + reportsPanel(target, viewer, full) + '</div>' +
          (full ? activityPanel(target, viewer) : '') +
        '</div>' +

        '<div>' +
          '<section class="card mb-20">' +
            '<h3>Details</h3>' +
            '<dl class="dl dl--narrow">' +
              '<dt>Institution</dt><dd>' + esc(view.institution || '—') + '</dd>' +
              '<dt>Programme</dt><dd>' + esc(view.programme || '—') + '</dd>' +
              '<dt>Supervisor</dt><dd>Prof. Bernard Foing</dd>' +
              (full
                ? '<dt>Email</dt><dd><a href="mailto:' + esc(view.email) + '">' + esc(view.email) + '</a></dd>' +
                  '<dt>Period</dt><dd>' + esc(ui.fmtDate(view.startDate)) + ' — ' +
                    esc(view.endDate ? ui.fmtDate(view.endDate) : 'open-ended') + '</dd>'
                : '') +
            '</dl>' +
            ((view.keywords || []).length ? '<hr>' + ui.tagList(view.keywords, '#/library?q=') : '') +
            (linkItems.length ? '<hr><ul class="linklist">' + linkItems.map(function (l) { return '<li>' + l + '</li>'; }).join('') + '</ul>' : '') +
            (!full
              ? '<hr><p class="meta mb-0">Contact details and research-period dates are ' +
                'visible only to this researcher and to the supervisor.</p>'
              : '') +
          '</section>' +

          (isSelf
            ? '<section class="card mb-20"><h3>Actions</h3>' +
              '<div class="grid-9">' +
                '<a class="btn btn--primary" href="#/submit">Submit a new report</a>' +
                '<a class="btn" href="#/researcher/' + esc(target.id) + '/edit">Edit my profile</a>' +
              '</div></section>'
            : '') +

          supervisorPanel(target, viewer) +
        '</div>' +
      '</div>' +
    '</div>';

    /* withdraw, from the submissions table */
    ctx.el.querySelectorAll('[data-withdraw]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-withdraw');
        var r = store.reportById(id);
        if (!r || !auth.canTransition(r, 'withdrawn', viewer)) { ui.toast('Not permitted.', 'err'); return; }
        ui.confirmDialog('Withdraw submission',
          '“' + ui.snippet(r.title, 10) + '” will be withdrawn and will leave the review queue. ' +
          'Withdrawn is a terminal state: the record cannot be resubmitted afterwards. ' +
          'If you only want to change something, use Edit instead.',
          'Withdraw', function () {
            store.setStatus(id, 'withdrawn', viewer.id, 'Withdrawn by the author.');
            ui.toast('Submission withdrawn.', 'good');
            router.resolve();
          }, true);
      });
    });

    /* supervisor: issue a temporary password, shown once */
    var tempBtn = document.getElementById('issueTempPw');
    if (tempBtn) {
      tempBtn.addEventListener('click', function () {
        if (!auth.can('user:resetPassword', target, viewer)) { ui.toast('Not permitted.', 'err'); return; }
        ui.confirmDialog('Issue a temporary password',
          'This immediately replaces ' + target.fullName + '’s current password. They will not be ' +
          'able to sign in until you give them the new one. It is shown to you once.',
          'Issue password', function () {
            var temp = store.issueTemporaryPassword(target.id);
            document.getElementById('tempPwOut').innerHTML =
              '<div class="notice notice--warn mt-12"><h4>Temporary password</h4>' +
              '<p class="mb-0"><code class="fs-105">' + esc(temp) + '</code></p>' +
              '<p class="meta mt-8 mb-0">Give this to the researcher directly. It is not ' +
              'shown again — reissue if you lose it, and ask them to change it once signed in.</p></div>';
            ui.toast('Temporary password issued.', 'good');
          }, true);
      });
    }

    /* supervisor-only controls */
    var saveBtn = document.getElementById('saveSupervisor');
    if (saveBtn) {
      saveBtn.addEventListener('click', function () {
        if (!auth.can('user:writeInternalNotes', target, viewer)) { ui.toast('Not permitted.', 'err'); return; }
        store.updateUser(target.id, {
          standing: document.getElementById('standingSel').value,
          internalNotes: document.getElementById('internalNotes').value
        });
        ui.toast('Supervisor fields saved.', 'good');
        router.resolve();
      });
    }
  }

  /* ---------------- edit form ---------------- */

  function edit(ctx) {
    var target = store.userById(ctx.params.id);
    var viewer = auth.user();

    if (!target) { router.navigate('#/', true); return; }
    if (!auth.can('user:edit', target, viewer)) { router.navigate('#/denied', true); return; }

    var links = target.links || {};

    ctx.el.innerHTML =
    '<div class="wrap wrap--840">' +
      '<p class="meta mb-10"><a href="#/researcher/' + esc(target.id) + '">&larr; Back to profile</a></p>' +
      '<h1>Edit profile</h1>' +
      (viewer.id !== target.id
        ? ui.notice('info', 'Editing another researcher\'s profile',
            'You are editing <strong>' + esc(target.fullName) + '</strong> as the supervisor.')
        : '') +

      '<form id="profForm" novalidate>' +
        '<fieldset><legend>Identity</legend>' +
          '<div class="field"><label for="pName">Full name <span class="req">*</span></label>' +
            '<input type="text" id="pName" name="fullName" value="' + esc(target.fullName) + '" required></div>' +
          '<div class="field"><label for="pEmail">Institutional email <span class="req">*</span></label>' +
            '<input type="email" id="pEmail" name="email" value="' + esc(target.email) + '" required></div>' +
        '</fieldset>' +

        '<fieldset><legend>Affiliation &amp; research period</legend>' +
          '<div class="field-row">' +
            '<div class="field"><label for="pInst">Home university or institution</label>' +
              '<input type="text" id="pInst" name="institution" list="instList" value="' + esc(target.institution) + '">' +
              '<datalist id="instList">' +
                store.INSTITUTIONS.map(function (i) { return '<option value="' + esc(i) + '"></option>'; }).join('') +
              '</datalist></div>' +
            '<div class="field"><label for="pProg">Programme</label>' +
              '<input type="text" id="pProg" name="programme" value="' + esc(target.programme) + '"></div>' +
          '</div>' +
          '<div class="field-row">' +
            '<div class="field"><label for="pStart">Start</label>' +
              '<input type="date" id="pStart" name="startDate" value="' + esc(target.startDate) + '"></div>' +
            '<div class="field"><label for="pEnd">End</label>' +
              '<input type="date" id="pEnd" name="endDate" value="' + esc(target.endDate) + '"></div>' +
          '</div>' +
        '</fieldset>' +

        '<fieldset><legend>Research</legend>' +
          '<div class="field"><label for="pTopic">Research topic</label>' +
            '<input type="text" id="pTopic" name="researchTopic" value="' + esc(target.researchTopic) + '"></div>' +
          '<div class="field"><label for="pKw">Keywords</label>' +
            '<input type="text" id="pKw" name="keywords" value="' + esc((target.keywords || []).join(', ')) + '">' +
            '<p class="field__hint">Comma-separated.</p>' +
            ui.keywordChips(store.suggestedKeywords()) + '</div>' +
          '<div class="field"><label for="pBio">Short biography</label>' +
            '<textarea id="pBio" name="bio" rows="5">' + esc(target.bio) + '</textarea></div>' +
        '</fieldset>' +

        '<fieldset><legend>Optional</legend>' +
          '<div class="field"><label for="pPhoto">Photograph URL</label>' +
            '<input type="url" id="pPhoto" name="photoUrl" value="' + esc(target.photoUrl) + '"></div>' +
          '<div class="field-row">' +
            '<div class="field"><label for="pLi">LinkedIn</label><input type="url" id="pLi" name="linkedin" value="' + esc(links.linkedin || '') + '"></div>' +
            '<div class="field"><label for="pOr">ORCID</label><input type="text" id="pOr" name="orcid" value="' + esc(links.orcid || '') + '"></div>' +
            '<div class="field"><label for="pWeb">Personal site</label><input type="url" id="pWeb" name="website" value="' + esc(links.website || '') + '"></div>' +
          '</div>' +
        '</fieldset>' +

        '<div class="btn-row"><button class="btn btn--primary" type="submit">Save changes</button>' +
          '<a class="btn btn--ghost" href="#/researcher/' + esc(target.id) + '">Cancel</a></div>' +
      '</form>' +
    '</div>';

    var form = document.getElementById('profForm');
    ui.wireKeywordChips(form, form.elements.keywords);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      ui.clearAllErrors(form);
      var ok = true;
      if (!form.elements.fullName.value.trim()) { ui.fieldError(form.elements.fullName, 'Enter a name.'); ok = false; }
      if (!ui.isEmail(form.elements.email.value)) { ui.fieldError(form.elements.email, 'Enter a valid email address.'); ok = false; }
      else {
        var clash = store.userByEmail(form.elements.email.value);
        if (clash && clash.id !== target.id) { ui.fieldError(form.elements.email, 'Another account already uses that address.'); ok = false; }
      }
      if (form.elements.startDate.value && form.elements.endDate.value && form.elements.endDate.value < form.elements.startDate.value) {
        ui.fieldError(form.elements.endDate, 'The end date cannot precede the start date.'); ok = false;
      }
      if (!ok) { ui.focusFirstError(form); return; }

      store.updateUser(target.id, {
        fullName: form.elements.fullName.value.trim(),
        email: form.elements.email.value.trim(),
        institution: store.canonicalInstitution(form.elements.institution.value),
        programme: form.elements.programme.value.trim(),
        startDate: form.elements.startDate.value,
        endDate: form.elements.endDate.value,
        researchTopic: form.elements.researchTopic.value.trim(),
        keywords: store.canonicalKeywords(ui.parseList(form.elements.keywords.value)),
        bio: form.elements.bio.value.trim(),
        photoUrl: ui.safeUrl(form.elements.photoUrl.value),
        links: {
          linkedin: ui.safeUrl(form.elements.linkedin.value),
          orcid: form.elements.orcid.value.trim(),
          website: ui.safeUrl(form.elements.website.value)
        }
      });
      auth.refresh();
      ui.toast('Profile updated.', 'good');
      router.navigate('#/researcher/' + target.id);
    });
  }

  /* #/me → the signed-in user's own profile */
  function me(ctx) {
    var u = auth.user();
    if (!u) { router.navigate('#/signin', true); return; }
    if (u.role === 'supervisor') { router.navigate('#/dashboard', true); return; }
    render({ params: { id: u.id }, query: ctx.query, el: ctx.el });
  }

  ESH.views = ESH.views || {};
  ESH.views.profile = render;
  ESH.views.profileEdit = edit;
  ESH.views.me = me;

})(window);
