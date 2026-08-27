/* ==========================================================================
   shared/policy.js — THE authorisation gate. One file, two runtimes.

   This is the extracted, environment-free core of what used to live in
   assets/js/auth.js. It touches no DOM, no localStorage, no database and no
   session: every function takes the actor explicitly. That is what lets the
   browser load it with a <script> tag and the Node server `require` it, so
   there is exactly one definition of who may do what.

   The server is the one that matters. The browser copy only decides which
   controls to render; the server evaluates the same rules against its OWN
   session row and its OWN report row, and never against anything the client
   sends. If the two ever disagree, the server wins and the UI is the bug.

     browser:  <script src="shared/policy.js"></script>  → window.ESHPolicy
     node:     const policy = require('../shared/policy.js')

   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ESHPolicy = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------------- controlled vocabulary ----------------
     Owned here rather than in store.js so the server validates submissions
     against the same lists the form offers. */

  var MISSION_AREAS = ['Lunar', 'Mars', 'Both', 'Other'];

  var REPORT_TYPES = [
    'Research paper',
    'Technical report',
    'Poster',
    'Presentation slides',
    'Dataset + description',
    'Analogue mission report',
    'Weekly report'
  ];

  /* Weekly reports use a lightweight flow, not the eight-state workflow: the
     student owns visibility (private/shared) and the professor owns a single,
     reversible "reviewed" act. Formal report types keep the `released` model
     unchanged. isWeekly() is the one place that distinction is decided. */
  var WEEKLY_TYPE = 'Weekly report';
  function isWeekly(report) {
    return !!(report && report.reportType === WEEKLY_TYPE);
  }

  /* Who may see a weekly among peers. `private` hides it from other students
     but NEVER from the supervisor, who sees every report in every state. */
  var VISIBILITIES = ['private', 'shared'];

  var STANDING = ['active', 'inactive', 'alumnus'];

  /* Workflow states. `terminal` states admit no further transitions.
     `internEditable` marks the states in which the author may still change the
     record: up to and including Submitted (the supervisor has not opened it
     yet), and again when revisions are requested. Once it is Under Review the
     supervisor is reading it, so it locks.
     `released` = Approved or Published: cleared by the supervisor for sharing
     with the rest of the group. Nothing in this hub is public. */
  var STATUSES = {
    draft:      { key: 'draft',      label: 'Draft',              badge: 'draft',      order: 1, released: false, internEditable: true  },
    submitted:  { key: 'submitted',  label: 'Submitted',          badge: 'submitted',  order: 2, released: false, internEditable: true  },
    review:     { key: 'review',     label: 'Under Review',       badge: 'review',     order: 3, released: false, internEditable: false },
    revisions:  { key: 'revisions',  label: 'Revisions Requested',badge: 'revisions',  order: 4, released: false, internEditable: true  },
    approved:   { key: 'approved',   label: 'Approved',           badge: 'approved',   order: 5, released: true,  internEditable: false },
    published:  { key: 'published',  label: 'Published',          badge: 'published',  order: 6, released: true,  internEditable: false },
    rejected:   { key: 'rejected',   label: 'Rejected',           badge: 'rejected',   order: 7, released: false, internEditable: false, terminal: true },
    withdrawn:  { key: 'withdrawn',  label: 'Withdrawn',          badge: 'withdrawn',  order: 8, released: false, internEditable: false, terminal: true }
  };

  var STATUS_ORDER = ['draft','submitted','review','revisions','approved','published','rejected','withdrawn'];

  /* Legal transitions, by the role permitted to make them. */
  var TRANSITIONS = {
    draft:     { intern: ['submitted', 'withdrawn'],  supervisor: [] },
    submitted: { intern: ['withdrawn'],               supervisor: ['review','revisions','approved','rejected'] },
    review:    { intern: ['withdrawn'],               supervisor: ['revisions','approved','rejected','submitted'] },
    revisions: { intern: ['submitted','withdrawn'],   supervisor: ['review','rejected'] },
    approved:  { intern: [],                          supervisor: ['published','revisions','rejected'] },
    published: { intern: [],                          supervisor: ['approved'] },
    rejected:  { intern: [],                          supervisor: [] },
    withdrawn: { intern: [],                          supervisor: [] }
  };

  /* Uploads. Enforced client-side as a courtesy and server-side as the rule. */
  var ACCEPTED_EXTENSIONS = ['pdf', 'docx', 'pptx'];
  var ACCEPTED_MIME = {
    pdf:  'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  };
  var ACCEPTED_FILES = '.pdf,.docx,.pptx,' +
    ACCEPTED_MIME.pdf + ',' + ACCEPTED_MIME.docx + ',' + ACCEPTED_MIME.pptx;
  var MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

  /* Minimum length for a password a person chooses. Lives here so the form's
     validation and the server's rejection cannot drift apart — a client stricter
     than the server rejects passwords the server would accept, and a client
     looser than the server produces a confusing round trip. Generated passwords
     (seed.js, supervisor-issued, account creation) are longer than this. */
  var MIN_PASSWORD_LENGTH = 10;

  /* What one signed-in member may see of another. Email, research-period
     dates and internal notes are absent by construction. */
  var SHARED_USER_FIELDS = ['id','fullName','institution','programme','researchTopic',
                            'keywords','bio','photoUrl','links','standing','role'];

  /* ---------------- predicates ---------------- */

  function isReleased(report) {
    return !!(report && STATUSES[report.status] && STATUSES[report.status].released);
  }

  /* THE group-visibility predicate — decided in exactly one place so the
     library, /bootstrap and report:read can never disagree. A report reaches
     the signed-in group if it is a shared weekly, or any other type that the
     supervisor has released. Everything downstream reads from this, never from
     isReleased directly, so a private weekly cannot leak through a filter. */
  function isGroupVisible(report) {
    if (!report) return false;
    if (isWeekly(report)) return report.visibility === 'shared';
    return isReleased(report);
  }

  function isOwner(actor, resource) {
    if (!actor || !resource) return false;
    if (resource.ownerId) return resource.ownerId === actor.id;   /* report */
    if (resource.id) return resource.id === actor.id;             /* user */
    return false;
  }

  /**
   * can(action, resource, actor) — the authorisation gate.
   *
   * `actor` is REQUIRED and explicit. Pass null for an unauthenticated
   * visitor. There is deliberately no ambient session in this module: on the
   * server the actor comes from the session row, never from the request body.
   */
  function can(action, resource, actor) {
    var role = actor ? actor.role : 'public';
    var sup = (role === 'supervisor');
    var intern = (role === 'intern');
    var owner = isOwner(actor, resource);

    switch (action) {

      /* ---- reports: read ---- */
      case 'report:read':
        if (!resource) return false;
        if (sup) return true;                            /* supervisor sees all states */
        if (!intern) return false;                       /* no session ⇒ no records */
        return owner || isGroupVisible(resource);        /* own work, or group-visible work */

      case 'report:readAny':                             /* the dashboard's "see everything" */
        return sup;

      /* ---- reports: write ---- */
      case 'report:create':
        return intern || sup;

      case 'report:edit': {
        if (!resource) return false;
        if (sup) return true;                            /* supervisor may correct metadata */
        if (!intern || !owner) return false;
        if (isWeekly(resource)) return true;             /* weeklies never lock */
        var st = STATUSES[resource.status];
        return !!(st && st.internEditable);
      }

      /* Visibility is the STUDENT'S switch, changeable anytime with no
         supervisor gate, and it applies to weeklies only — a formal report's
         group visibility stays tied to `released`. Peers may not change it. */
      case 'report:setVisibility':
        if (!resource || !isWeekly(resource)) return false;
        return sup || (intern && owner);

      case 'report:delete':                              /* hard delete is supervisor-only */
        return sup;

      case 'report:setStatus':
        if (!resource) return false;
        return allowedTransitions(resource, actor).length > 0;

      case 'report:feature':                             /* pin to the top of the library */
        return sup && !!resource && isReleased(resource);

      case 'report:bulkAction':
        return sup;

      /* ---- files ----
         Deliberately defined in terms of the report, not the object key. A key
         is not a capability: holding one grants nothing. */
      case 'file:upload':
        return can('report:edit', resource, actor);

      case 'file:download':
        return can('report:read', resource, actor);

      case 'file:delete':
        return can('report:edit', resource, actor);

      /* ---- comments ---- */
      case 'comment:readInternal':                       /* supervisor-only side-channel */
        return sup;

      case 'comment:read':
        if (!resource) return false;
        return can('report:read', resource, actor);

      case 'comment:write':
        if (!resource) return false;
        if (sup) return true;
        return intern && owner;                          /* interns may reply on own reports */

      case 'comment:writeInternal':
        return sup;

      /* ---- researcher profiles ---- */
      case 'user:read':                                  /* basic profile of a colleague */
        return !!actor && !!resource;                    /* members only */

      case 'user:readFull':                              /* email, dates, all reports */
        if (!resource) return false;
        return sup || (!!actor && resource.id === actor.id);

      case 'user:edit':
        if (!resource) return false;
        return sup || (!!actor && resource.id === actor.id);

      case 'user:resetPassword':                         /* issue a temporary password */
        return sup && !!resource && resource.role !== 'supervisor';

      case 'user:readInternalNotes':
      case 'user:writeInternalNotes':
      case 'user:setStanding':
        return sup;

      case 'user:listAll':
        return sup;

      /* Accounts are created BY the supervisor, not applied for. The hub is
         closed: self-service registration would let any visitor with the URL
         into a group they were never placed with. The demo build keeps an open
         registration form because there is nothing behind it to protect. */
      case 'user:create':
        return sup;

      /* Everyone owns their own read-marker; nobody else touches it. */
      case 'user:markNotificationsSeen':
        return !!actor && !!resource && resource.id === actor.id;

      /* ---- areas ---- */
      case 'library:view':                               /* the shared report library */
        return !!actor;

      case 'dashboard:view':
        return sup;

      default:
        return false;
    }
  }

  /** allowedTransitions(report, actor) — legal next states for this actor. */
  function allowedTransitions(report, actor) {
    if (!actor || !report) return [];
    var table = TRANSITIONS[report.status];
    if (!table) return [];
    if (actor.role === 'supervisor') return table.supervisor.slice();
    if (actor.role === 'intern' && report.ownerId === actor.id) return table.intern.slice();
    return [];
  }

  function canTransition(report, to, actor) {
    return allowedTransitions(report, actor).indexOf(to) !== -1;
  }

  /**
   * visibleReports(allReports, actor) — the reports an actor is entitled to
   * see. An unauthenticated visitor gets an EMPTY list, not a filtered one.
   */
  function visibleReports(allReports, actor) {
    var all = allReports || [];
    if (actor && actor.role === 'supervisor') return all.slice();
    if (actor && actor.role === 'intern') {
      return all.filter(function (r) { return r.ownerId === actor.id || isGroupVisible(r); });
    }
    return [];
  }

  /** visibleComments(report, actor) — strips internal supervisor comments. */
  function visibleComments(report, actor) {
    var list = ((report && report.comments) || []).slice();
    if (can('comment:readInternal', report, actor)) return list;
    return list.filter(function (c) { return !c.internal; });
  }

  /** projectUser(target, actor) — only the fields the actor may read. */
  function projectUser(target, actor) {
    if (!target) return null;
    if (can('user:readFull', target, actor)) return target;
    var out = {};
    SHARED_USER_FIELDS.forEach(function (f) { out[f] = target[f]; });
    out.__redacted = true;   /* marker: email, dates and notes withheld */
    return out;
  }

  /* ---------------- upload validation (shared by form and server) ---------------- */

  function extensionOf(filename) {
    var m = String(filename || '').toLowerCase().match(/\.([a-z0-9]+)$/);
    return m ? m[1] : '';
  }

  /**
   * validateUpload({ filename, contentType, size }) → { ok, error, extension }
   * The server runs this too; the browser copy only saves a round trip.
   */
  function validateUpload(f) {
    var name = String((f && f.filename) || '').trim();
    if (!name) return { ok: false, error: 'A filename is required.' };
    if (name.length > 200) return { ok: false, error: 'That filename is too long.' };

    var ext = extensionOf(name);
    if (ACCEPTED_EXTENSIONS.indexOf(ext) === -1) {
      return { ok: false, error: 'Accepted formats are PDF, DOCX and PPTX.' };
    }
    var size = Number(f.size);
    if (!isFinite(size) || size <= 0) return { ok: false, error: 'The file appears to be empty.' };
    if (size > MAX_UPLOAD_BYTES) {
      return { ok: false, error: 'The file exceeds the 25 MB limit.' };
    }
    /* Browsers occasionally report an empty or odd type for Office files, so
       the extension is authoritative and the type must merely not contradict
       it when present. */
    var declared = String(f.contentType || '').toLowerCase().split(';')[0].trim();
    if (declared && declared !== ACCEPTED_MIME[ext] && declared !== 'application/octet-stream') {
      return { ok: false, error: 'The file type does not match its extension.' };
    }
    return { ok: true, extension: ext, contentType: ACCEPTED_MIME[ext] };
  }

  return {
    MISSION_AREAS: MISSION_AREAS,
    REPORT_TYPES: REPORT_TYPES,
    WEEKLY_TYPE: WEEKLY_TYPE,
    VISIBILITIES: VISIBILITIES,
    STANDING: STANDING,
    STATUSES: STATUSES,
    STATUS_ORDER: STATUS_ORDER,
    TRANSITIONS: TRANSITIONS,
    ACCEPTED_EXTENSIONS: ACCEPTED_EXTENSIONS,
    ACCEPTED_MIME: ACCEPTED_MIME,
    ACCEPTED_FILES: ACCEPTED_FILES,
    MAX_UPLOAD_BYTES: MAX_UPLOAD_BYTES,
    MIN_PASSWORD_LENGTH: MIN_PASSWORD_LENGTH,
    SHARED_USER_FIELDS: SHARED_USER_FIELDS,

    isReleased: isReleased,
    isWeekly: isWeekly,
    isGroupVisible: isGroupVisible,
    isOwner: isOwner,
    can: can,
    allowedTransitions: allowedTransitions,
    canTransition: canTransition,
    visibleReports: visibleReports,
    visibleComments: visibleComments,
    projectUser: projectUser,
    extensionOf: extensionOf,
    validateUpload: validateUpload
  };
}));
