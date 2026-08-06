/* ==========================================================================
   auth.js — STUBBED authentication + the authorisation (permission) layer.

   ┌──────────────────────────────────────────────────────────────────────┐
   │  THIS IS NOT REAL SECURITY.                                          │
   │  There is no server, no session token, no password hashing and no    │
   │  server-side enforcement. "Sign-in" compares a plaintext demo        │
   │  password held in localStorage; the current role is a string in      │
   │  localStorage that the visitor can edit with devtools.               │
   │                                                                      │
   │  What IS real here is the *shape* of the access model: every read    │
   │  and every write in the UI goes through the `can()` gate below, so   │
   │  the rules are stated in one place and can be ported verbatim to a   │
   │  server-side policy when this module is wired to a backend.          │
   │  See README.md § Access control for the porting notes.               │
   └──────────────────────────────────────────────────────────────────────┘
   ========================================================================== */
(function (global) {
  'use strict';

  var store = global.ESH.store;

  /* ---------------- session (stub) ---------------- */

  var current = null;   /* null === public visitor */

  function restore() {
    var id = null;
    try { id = global.localStorage.getItem(store.SESSION_KEY); } catch (e) {}
    current = id ? store.userById(id) : null;
    return current;
  }

  function persist() {
    try {
      if (current) global.localStorage.setItem(store.SESSION_KEY, current.id);
      else global.localStorage.removeItem(store.SESSION_KEY);
    } catch (e) {}
  }

  function user() { return current; }
  function role() { return current ? current.role : 'public'; }
  function isSupervisor() { return role() === 'supervisor'; }
  function isIntern() { return role() === 'intern'; }
  function isAuthenticated() { return !!current; }

  /* Demo sign-in. Plaintext comparison — stubbed on purpose. */
  function signIn(email, password) {
    var u = store.userByEmail(email);
    if (!u) return { ok: false, error: 'No account found for that email address.' };
    if (String(u.password) !== String(password)) return { ok: false, error: 'Incorrect password.' };
    current = u;
    persist();
    return { ok: true, user: u };
  }

  /* Demo-mode shortcut: assume a role without credentials. Clearly labelled
     in the UI as a demonstration affordance, not an authentication path. */
  function assume(userId) {
    var u = store.userById(userId);
    if (!u) return { ok: false, error: 'Unknown demo account.' };
    current = u;
    persist();
    return { ok: true, user: u };
  }

  function signOut() { current = null; persist(); }

  function refresh() { if (current) current = store.userById(current.id); return current; }

  /* ==========================================================================
     AUTHORISATION — the single source of truth for who may see or do what.

     Roles
       public      unauthenticated visitor
       intern      authenticated student researcher
       supervisor  Prof. Foing (primary) and any designated co-supervisor

     Rules, stated plainly:
       · This hub is CLOSED. Unauthenticated visitors get Prof. Foing's own
         profile page and the sign-in screen — no reports, no report library,
         no researcher profiles, no names, no counts. Nothing else at all.
       · Interns may read and write their OWN profile and their OWN reports
         subject to the workflow state, and may read reports the supervisor has
         RELEASED (Approved or Published) plus the basic profile of whoever
         wrote them. They may not read other interns' unreleased work, other
         interns' contact details or research-period dates, any internal
         supervisor note, or any internal comment.
       · Supervisors may read everything and drive the workflow. Only
         supervisors may change status, feature a report, write internal
         comments or internal notes, or set an intern's standing.
     ========================================================================== */

  /* What one signed-in member may see of another. Email, research-period
     dates and internal notes are absent by construction. */
  var SHARED_USER_FIELDS = ['id','fullName','institution','programme','researchTopic','keywords','bio','photoUrl','links','standing','role'];

  function isOwner(u, resource) {
    if (!u || !resource) return false;
    if (resource.ownerId) return resource.ownerId === u.id;   /* report */
    if (resource.id) return resource.id === u.id;             /* user */
    return false;
  }

  /**
   * can(action, resource) — the authorisation gate.
   * @param {string} action  e.g. 'report:read', 'report:setStatus'
   * @param {object} [resource]
   * @param {object} [u] optional actor override (defaults to current session)
   * @returns {boolean}
   */
  function can(action, resource, u) {
    u = (u === undefined) ? current : u;
    var r = u ? u.role : 'public';
    var sup = (r === 'supervisor');
    var intern = (r === 'intern');
    var owner = isOwner(u, resource);

    switch (action) {

      /* ---- reports: read ---- */
      case 'report:read':
        if (!resource) return false;
        if (sup) return true;                            /* supervisor sees all states */
        if (!intern) return false;                       /* no session ⇒ no records */
        return owner || store.isReleased(resource);      /* own work, or released work */

      case 'report:readAny':                             /* the dashboard's "see everything" */
        return sup;

      /* ---- reports: write ---- */
      case 'report:create':
        return intern || sup;

      case 'report:edit': {
        if (!resource) return false;
        if (sup) return true;                            /* supervisor may correct metadata */
        if (!intern || !owner) return false;
        var st = store.STATUSES[resource.status];
        return !!(st && st.internEditable);              /* Draft or Revisions Requested */
      }

      case 'report:delete':                              /* hard delete is supervisor-only */
        return sup;

      case 'report:setStatus':
        if (!resource) return false;
        return allowedTransitions(resource, u).length > 0;

      case 'report:feature':                             /* pin to the top of the library */
        return sup && !!resource && store.isReleased(resource);

      case 'report:bulkAction':
        return sup;

      /* ---- comments ---- */
      case 'comment:readInternal':                       /* supervisor-only side-channel */
        return sup;

      case 'comment:read':
        if (!resource) return false;
        return can('report:read', resource, u);

      case 'comment:write':
        if (!resource) return false;
        if (sup) return true;
        return intern && owner;                          /* interns may reply on own reports */

      case 'comment:writeInternal':
        return sup;

      /* ---- intern profiles ---- */
      case 'user:read':                                  /* basic profile of a colleague */
        return !!u && !!resource;                        /* members only */

      case 'user:readFull':                              /* email, dates, all reports */
        if (!resource) return false;
        return sup || (!!u && resource.id === u.id);

      case 'user:edit':
        if (!resource) return false;
        return sup || (!!u && resource.id === u.id);

      case 'user:resetPassword':                         /* issue a temporary password */
        return sup && !!resource && resource.role !== 'supervisor';

      case 'user:readInternalNotes':
      case 'user:writeInternalNotes':
      case 'user:setStanding':
        return sup;

      case 'user:listAll':
        return sup;

      /* ---- areas ---- */
      case 'library:view':                               /* the shared report library */
        return !!u;

      case 'dashboard:view':
        return sup;

      default:
        return false;
    }
  }

  /**
   * allowedTransitions(report, actor) — legal next states for this actor.
   * Mirrors store.TRANSITIONS and is the only place the UI should consult.
   */
  function allowedTransitions(report, u) {
    u = (u === undefined) ? current : u;
    if (!u || !report) return [];
    var table = store.TRANSITIONS[report.status];
    if (!table) return [];
    if (u.role === 'supervisor') return table.supervisor.slice();
    if (u.role === 'intern' && report.ownerId === u.id) return table.intern.slice();
    return [];
  }

  function canTransition(report, to, u) {
    return allowedTransitions(report, u).indexOf(to) !== -1;
  }

  /**
   * visibleReports(actor) — the report list an actor is entitled to see.
   * Every list view derives from this; nothing queries store.reports() raw.
   * An unauthenticated visitor gets an empty list, not a filtered one.
   */
  function visibleReports(u) {
    u = (u === undefined) ? current : u;
    var all = store.reports();
    if (u && u.role === 'supervisor') return all;
    if (u && u.role === 'intern') {
      return all.filter(function (r) { return r.ownerId === u.id || store.isReleased(r); });
    }
    return [];                                    /* no session ⇒ no records at all */
  }

  /**
   * visibleComments(report, actor) — strips internal supervisor comments for
   * anyone who is not a supervisor.
   */
  function visibleComments(report, u) {
    u = (u === undefined) ? current : u;
    var list = (report.comments || []).slice();
    if (can('comment:readInternal', report, u)) return list;
    return list.filter(function (c) { return !c.internal; });
  }

  /**
   * projectUser(target, actor) — returns only the fields the actor may read.
   * Used anywhere an intern record is rendered for a non-privileged viewer.
   */
  function projectUser(target, u) {
    u = (u === undefined) ? current : u;
    if (!target) return null;
    if (can('user:readFull', target, u)) return target;
    var out = {};
    SHARED_USER_FIELDS.forEach(function (f) { out[f] = target[f]; });
    out.__redacted = true;   /* marker: email, dates and notes withheld */
    return out;
  }

  /* Route-level guard used by the router. Returns true, or a redirect route. */
  function guard(requirement) {
    switch (requirement) {
      case 'auth':       return isAuthenticated() ? true : '#/signin';
      case 'intern':     return isIntern() ? true : (isAuthenticated() ? '#/denied' : '#/signin');
      case 'supervisor': return isSupervisor() ? true : (isAuthenticated() ? '#/denied' : '#/signin');
      default:           return true;
    }
  }

  global.ESH.auth = {
    restore: restore, user: user, role: role, refresh: refresh,
    isSupervisor: isSupervisor, isIntern: isIntern, isAuthenticated: isAuthenticated,
    signIn: signIn, signOut: signOut, assume: assume,
    can: can, guard: guard,
    allowedTransitions: allowedTransitions, canTransition: canTransition,
    visibleReports: visibleReports, visibleComments: visibleComments,
    projectUser: projectUser,
    SHARED_USER_FIELDS: SHARED_USER_FIELDS
  };

})(window);
