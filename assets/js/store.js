/* ==========================================================================
   store.js — the client's read model.

   THE SERVER OWNS THE DATA. This module holds what /bootstrap returned for the
   current actor and nothing else: no seed content, no localStorage, no second
   source of truth to drift. Views read it synchronously; writes go to the
   server and the cache is updated optimistically, then rolled back by
   re-hydrating if the server refuses.

   That refusal is expected, not exceptional — it is what happens when the
   browser's copy of the policy disagrees with the real one, and the server is
   the one that counts.

   Uploaded files never live here. The binary goes browser → B2 directly; this
   keeps only the metadata the server reports.
   ========================================================================== */
(function (global) {
  'use strict';

  /* ---------------- controlled vocabulary ----------------
     Defined once in shared/policy.js, which the Node server requires from the
     same file. Re-exported here so existing call sites (store.STATUSES, …)
     keep working, but this module is no longer a second source of truth. */

  var P = global.ESHPolicy;
  if (!P) throw new Error('shared/policy.js must load before assets/js/store.js');

  var MISSION_AREAS  = P.MISSION_AREAS;
  var REPORT_TYPES   = P.REPORT_TYPES;
  var STATUSES       = P.STATUSES;
  var STATUS_ORDER   = P.STATUS_ORDER;
  var TRANSITIONS    = P.TRANSITIONS;
  var STANDING       = P.STANDING;
  var ACCEPTED_FILES = P.ACCEPTED_FILES;
  /* Suggested (not enforced) canonical institutions. Free text is still
     accepted; these drive the datalists and canonicalInstitution() so the same
     place isn't spelled three ways across the roster and filters. */
  var INSTITUTIONS = [
    'International Space University',
    'Vrije Universiteit Amsterdam',
    'Florida Institute of Technology',
    'ISAE-SUPAERO',
    'Delft University of Technology',
    'Technical University of Munich',
    'University of Strathclyde'
  ];
  var INSTITUTION_ALIASES = {
    'isu': 'International Space University',
    'vu': 'Vrije Universiteit Amsterdam',
    'vu amsterdam': 'Vrije Universiteit Amsterdam',
    'fit': 'Florida Institute of Technology',
    'florida tech': 'Florida Institute of Technology',
    'tu delft': 'Delft University of Technology',
    'tum': 'Technical University of Munich'
  };

  /* Optional campaign / programme a report belongs to — a lightweight grouping,
     not a first-class entity. Example labels drawn from Prof. Foing's real
     ILEWG context; the field is free text and never enforced. */
  var CAMPAIGNS = [
    'EuroMoonMars',
    'ILEWG analogue field campaign',
    'ExoGeoLab',
    'Lunar south-pole study',
    'Mars analogue programme'
  ];

  /* ---------------- ids, dates, misc ---------------- */

  var seq = 0;
  function uid(prefix) {
    seq += 1;
    return (prefix || 'id') + '_' + Date.now().toString(36) + '_' + seq.toString(36) +
           Math.random().toString(36).slice(2, 6);
  }
  function nowISO() { return new Date().toISOString(); }
  function isoDate(iso) { return (iso || '').slice(0, 10); }


  /* ---------------- the cache ---------------- */

  /* Null until hydrate() has spoken to the server. Nothing may read it before
     then: there is no offline answer to fall back on, and inventing one is the
     bug this module was rewritten to remove. */
  var state = null;

  function getState() {
    if (!state) throw new Error('store.getState() before hydrate(); the server has not answered yet.');
    return state;
  }

  /* Views mutate the cache optimistically and call this. It exists so those
     call sites read the same as they did when there was something to persist;
     the server is what actually records a change. */
  function save() { /* the cache is not persisted — the server is */ }

  /* ---------------- queries ---------------- */

  function users()   { return getState().users.slice(); }
  function reports() { return getState().reports.slice(); }

  function userById(id) {
    var list = getState().users;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function userByEmail(email) {
    var e = String(email || '').trim().toLowerCase();
    var list = getState().users;
    for (var i = 0; i < list.length; i++) if (list[i].email.toLowerCase() === e) return list[i];
    return null;
  }
  function reportById(id) {
    var list = getState().reports;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function interns() { return getState().users.filter(function (u) { return u.role === 'intern'; }); }
  function supervisors() { return getState().users.filter(function (u) { return u.role === 'supervisor'; }); }
  function reportsByOwner(id) { return getState().reports.filter(function (r) { return r.ownerId === id; }); }

  /* "Released" = Approved or Published: cleared by the supervisor for sharing
     with the rest of the group. Nothing in this hub is visible without a
     session, so this is NOT a public flag. */
  var isReleased = P.isReleased;
  function releasedReports() { return getState().reports.filter(isReleased); }

  /* ---------------- controlled-vocabulary helpers ----------------
     None of these ENFORCE a closed list — unknown values pass through as free
     text. They just fold obvious variants together (aliases, casing, spacing)
     so the roster, filters and library facets don't fragment. */

  function canonicalInstitution(s) {
    var t = String(s || '').trim();
    if (!t) return '';
    var key = t.toLowerCase();
    if (INSTITUTION_ALIASES[key]) return INSTITUTION_ALIASES[key];
    for (var i = 0; i < INSTITUTIONS.length; i++) {
      if (INSTITUTIONS[i].toLowerCase() === key) return INSTITUTIONS[i];
    }
    return t;
  }

  /* Fold a campaign onto a canonical spelling when it matches one, else keep the
     free text. */
  function canonicalCampaign(s) {
    var t = String(s || '').replace(/\s+/g, ' ').trim();
    if (!t) return '';
    var key = t.toLowerCase();
    for (var i = 0; i < CAMPAIGNS.length; i++) {
      if (CAMPAIGNS[i].toLowerCase() === key) return CAMPAIGNS[i];
    }
    return t;
  }

  /* Distinct campaigns actually present on reports — drives the library filter. */
  function campaignsInUse() {
    var set = {};
    getState().reports.forEach(function (r) { if (r.campaign) set[r.campaign] = true; });
    return Object.keys(set).sort();
  }

  /* Trim, collapse inner whitespace, and drop case-insensitive duplicates
     (keeping the first spelling seen). */
  function canonicalKeywords(list) {
    var seen = {}, out = [];
    (list || []).forEach(function (k) {
      var t = String(k || '').replace(/\s+/g, ' ').trim();
      if (!t) return;
      var key = t.toLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      out.push(t);
    });
    return out;
  }

  /* Existing keywords across all reports, most-used first — for suggestions. */
  function suggestedKeywords() {
    var freq = {};
    getState().reports.forEach(function (r) {
      (r.keywords || []).forEach(function (k) {
        var t = String(k || '').trim();
        if (!t) return;
        var key = t.toLowerCase();
        if (!freq[key]) freq[key] = { label: t, n: 0 };
        freq[key].n++;
      });
    });
    return Object.keys(freq).map(function (key) { return freq[key]; })
      .sort(function (a, b) { return b.n - a.n || a.label.localeCompare(b.label); })
      .map(function (x) { return x.label; });
  }

  /* Display name for a report's author line. */
  function authorLine(r) {
    var owner = userById(r.ownerId);
    var names = [owner ? owner.fullName : 'Unknown author'];
    (r.coAuthors || []).forEach(function (ca) { if (ca && ca.name) names.push(ca.name); });
    return names.join(', ');
  }

  /* ---------------- mutations ---------------- */

  function updateUser(id, patch) {
    var u = userById(id);
    if (!u) return null;
    sync(global.ESH.api.users.update(id, patch), 'Saving profile');
    Object.keys(patch).forEach(function (k) { u[k] = patch[k]; });
    save();
    return u;
  }

  /* Marks the point up to which a user has seen their notifications. Anything
     that happened after this timestamp is "unread". A missing value (never
     visited) means everything is unread. */
  function markNotificationsSeen(userId) {
    var u = userById(userId);
    if (!u) return null;
    sync(global.ESH.api.users.markNotificationsSeen(userId), 'Marking notifications read');
    u.notificationsSeenAt = nowISO();
    save();
    return u;
  }

  function updateReport(id, patch) {
    var r = reportById(id);
    if (!r) return null;
    sync(global.ESH.api.reports.update(id, patch), 'Saving changes');
    Object.keys(patch).forEach(function (k) { r[k] = patch[k]; });
    r.updatedAt = nowISO();
    save();
    return r;
  }

  /* Featuring has its OWN endpoint and is NOT a patchable report field: the
     server's PATCH whitelist deliberately excludes `featured`, because pinning
     a record is a supervisor act gated on can('report:feature'), not an edit.
     Routing it through updateReport() therefore looked like it worked and was
     silently discarded server-side. */
  /* Featuring has its own endpoint and is NOT a patchable report field: the
     server's PATCH whitelist excludes `featured`, because pinning a record is
     a supervisory act gated on can('report:feature'), not an edit. The server
     writes the history entry, so none is added here. */
  function setFeatured(reportId, on) {
    var r = reportById(reportId);
    if (!r) return null;
    sync(global.ESH.api.reports.feature(reportId, on), 'Updating featured');
    r.featured = !!on;
    r.updatedAt = nowISO();
    save();
    return r;
  }

  /* Hard delete. In API mode the server also removes the B2 object, which the
     browser cannot do — dropping the row from the local cache alone left the
     record on the server (it returned on the next reload) and the file orphaned
     in the bucket. Async so callers can navigate only once it is really gone. */
  function deleteReport(reportId) {
    var r = reportById(reportId);
    if (!r) return Promise.resolve(false);

    function dropLocal() {
      var st = getState();
      st.reports = st.reports.filter(function (x) { return x.id !== reportId; });
      save();
      return true;
    }

    /* Server first: a refusal must not leave the record missing from the view
       while it still exists. */
    return global.ESH.api.reports.remove(reportId).then(dropLocal);
  }

  function setStatus(reportId, to, byUserId, note) {
    var r = reportById(reportId);
    if (!r) return null;
    var from = r.status;
    if (from === to) return r;
    sync(global.ESH.api.reports.status(reportId, to, note), 'Changing status');
    r.status = to;
    r.updatedAt = nowISO();
    if (to === 'submitted') r.submittedAt = nowISO();
    if (!STATUSES[to].released) r.featured = false;   /* never feature an unreleased record */
    r.history.push({ at: nowISO(), by: byUserId, from: from, to: to, note: note || '' });
    save();
    return r;
  }

  function addComment(reportId, authorId, body, parentId, internal) {
    var r = reportById(reportId);
    if (!r) return null;
    sync(global.ESH.api.reports.comment(reportId, body, parentId, internal), 'Posting comment');
    var rec = { id: uid('c'), authorId: authorId, at: nowISO(), body: body,
                parentId: parentId || null, internal: !!internal };
    r.comments.push(rec);
    r.updatedAt = nowISO();
    save();
    return rec;
  }

  /* ---------------- supervisor-issued password ----------------
     The only password-recovery route. A reset link has to be emailed to prove
     control of the mailbox and there is no mail service; a form that prints
     its own token would be account takeover. The supervisor hands the password
     over directly instead, which is an auditable act. */

  function issueTemporaryPassword(userId) {
    return global.ESH.api.issueTemporaryPassword(userId).then(function (res) {
      if (!res.ok) throw new Error(res.error || 'The password could not be issued.');
      return res.temporaryPassword;
    });
  }

  /* ---------------- talking to the server ----------------

     Writes are applied to the cache immediately and sent in the background. If
     the server refuses, the optimistic change is rolled back by re-hydrating
     and the user is told. The alternative — waiting for a round trip before
     showing anything — makes every click feel broken on a slow link, for a
     refusal that should be rare.
     ---------------------------------------------------------------------- */

  var onSyncError = null;   /* set by app.js so the store need not know about the UI */
  function setSyncErrorHandler(fn) { onSyncError = fn; }

  /** Replace the whole cache from the server. Returns a promise. */
  function hydrate() {
    return global.ESH.api.bootstrap().then(function (data) {
      state = {
        version: 1,
        seededAt: nowISO(),
        users: (data.users || []).slice(),
        reports: (data.reports || []).slice()
      };
      return state;
    });
  }

  /* Fire a server call for an optimistic local change. On failure, re-sync
     and hand the error to the UI. */
  function sync(promise, what) {
    if (!promise || !promise.then) return promise;
    return promise['catch'](function (err) {
      /* Re-sync so the optimistic change is rolled back. If that ALSO fails —
         the server has gone away entirely — the rollback is what is lost, not
         the report: swallow the second failure so the first one still reaches
         the user, who would otherwise be told nothing at all. */
      return hydrate()['catch'](function () {})
        .then(function () {
          if (onSyncError) onSyncError(err, what);
          else console.error('[store] ' + what + ' failed:', err);
          throw err;
        });
    });
  }

  /* Async, server-first account creation. Supervisor-only on the server side.
     Resolves with { user, initialPassword } — the password is shown once and
     is not retrievable afterwards, so the caller must display it immediately.
     In demo mode it falls back to the local table and reports the seeded
     password, keeping one call signature for both builds. */
  function createUser(patch) {
    return global.ESH.api.users.create(patch).then(function (d) {
      getState().users.push(d.user);
      return { user: d.user, initialPassword: d.initialPassword };
    });
  }

  /* Async, server-first creation. Used by the submission form, which must
     have a real report id before it can upload a file against it. */
  function createReport(patch) {
    return global.ESH.api.reports.create(patch).then(function (d) {
      getState().reports.push(d.report);
      return d.report;
    });
  }

  /* ---------------- exports ---------------- */

  global.ESH = global.ESH || {};
  global.ESH.store = {
    MISSION_AREAS: MISSION_AREAS, REPORT_TYPES: REPORT_TYPES,
    STATUSES: STATUSES, STATUS_ORDER: STATUS_ORDER, TRANSITIONS: TRANSITIONS,
    STANDING: STANDING, ACCEPTED_FILES: ACCEPTED_FILES, INSTITUTIONS: INSTITUTIONS,
    CAMPAIGNS: CAMPAIGNS,
    canonicalInstitution: canonicalInstitution, canonicalKeywords: canonicalKeywords,
    suggestedKeywords: suggestedKeywords, canonicalCampaign: canonicalCampaign,
    campaignsInUse: campaignsInUse,

    save: save, getState: getState, uid: uid, nowISO: nowISO,
    hydrate: hydrate, createReport: createReport,
    setSyncErrorHandler: setSyncErrorHandler,

    users: users, interns: interns, supervisors: supervisors,
    userById: userById, userByEmail: userByEmail,
    reports: reports, reportById: reportById, reportsByOwner: reportsByOwner,
    releasedReports: releasedReports, isReleased: isReleased, authorLine: authorLine,

    createUser: createUser, updateUser: updateUser, markNotificationsSeen: markNotificationsSeen,
    setFeatured: setFeatured, deleteReport: deleteReport, updateReport: updateReport,
    setStatus: setStatus, addComment: addComment,

    issueTemporaryPassword: issueTemporaryPassword
  };

})(window);
