/* ==========================================================================
   auth.js — the browser's session, plus a thin wrapper over the shared gate.

   ┌──────────────────────────────────────────────────────────────────────┐
   │  THE RULES NO LONGER LIVE HERE.                                      │
   │  Every authorisation decision is made by shared/policy.js, which the │
   │  Node server requires from the same file. This module only supplies  │
   │  the current actor so views can call can('x', y) without threading   │
   │  the session through every call site.                                │
   │                                                                      │
   │  What the browser decides is which controls to RENDER. What the      │
   │  server decides is what actually happens. A client-side `true` here  │
   │  buys nothing: the API re-evaluates the same policy against its own  │
   │  session row and its own report row before it acts.                  │
   └──────────────────────────────────────────────────────────────────────┘

   Two session modes:
     API mode  (ESH_CONFIG.apiBase set) — the session is an httpOnly cookie the
                page cannot read; `current` is whatever /api/auth/me returned.
                Sign-in and sign-out are server round trips.
     Demo mode (no apiBase) — the original localStorage stub, kept so the hub
                still runs from file:// and so tests/smoke.mjs works offline.
                Clearly labelled in the UI as a demonstration.
   ========================================================================== */
(function (global) {
  'use strict';

  var store = global.ESH.store;
  var P = global.ESHPolicy;

  if (!P) throw new Error('shared/policy.js must load before assets/js/auth.js');

  function apiMode() { return !!(global.ESH.api && global.ESH.api.enabled()); }

  /* ---------------- session ---------------- */

  var current = null;   /* null === unauthenticated visitor */

  function restore() {
    if (apiMode()) { current = global.ESH.api.session(); return current; }
    var id = null;
    try { id = global.localStorage.getItem(store.SESSION_KEY); } catch (e) {}
    current = id ? store.userById(id) : null;
    return current;
  }

  function persist() {
    if (apiMode()) return;                 /* the cookie is the session */
    try {
      if (current) global.localStorage.setItem(store.SESSION_KEY, current.id);
      else global.localStorage.removeItem(store.SESSION_KEY);
    } catch (e) {}
  }

  function setCurrent(u) { current = u || null; persist(); return current; }

  function user() { return current; }
  function role() { return current ? current.role : 'public'; }
  function isSupervisor() { return role() === 'supervisor'; }
  function isIntern() { return role() === 'intern'; }
  function isAuthenticated() { return !!current; }

  /**
   * signIn(email, password)
   *   API mode  — async, returns a Promise<{ok, user|error}>.
   *   Demo mode — synchronous, returns {ok, user|error} as it always did.
   * Callers that must work in both await the result; awaiting a plain object
   * is harmless, so `var res = await auth.signIn(...)` is correct either way.
   */
  function signIn(email, password) {
    if (apiMode()) {
      return global.ESH.api.login(email, password).then(function (res) {
        if (res.ok) setCurrent(res.user);
        return res;
      });
    }
    var u = store.userByEmail(email);
    if (!u) return { ok: false, error: 'No account found for that email address.' };
    if (String(u.password) !== String(password)) return { ok: false, error: 'Incorrect password.' };
    setCurrent(u);
    return { ok: true, user: u };
  }

  /* Demo-mode shortcut: assume a role without credentials. Refused outright
     when a real backend is present — it would be an authentication bypass. */
  function assume(userId) {
    if (apiMode()) {
      return { ok: false, error: 'The demo role switcher is disabled when a real backend is configured.' };
    }
    var u = store.userById(userId);
    if (!u) return { ok: false, error: 'Unknown demo account.' };
    setCurrent(u);
    return { ok: true, user: u };
  }

  function signOut() {
    if (apiMode()) {
      var p = global.ESH.api.logout();
      setCurrent(null);
      return p;
    }
    setCurrent(null);
  }

  function refresh() {
    if (apiMode()) { current = global.ESH.api.session(); return current; }
    if (current) current = store.userById(current.id);
    return current;
  }

  /* ---------------- the gate (delegated) ----------------
     Identical signatures to before, so every existing call site is unchanged.
     Each one fills in the current actor and hands off to shared/policy.js. */

  function actorOr(u) { return (u === undefined) ? current : u; }

  function can(action, resource, u) {
    return P.can(action, resource, actorOr(u));
  }
  function allowedTransitions(report, u) {
    return P.allowedTransitions(report, actorOr(u));
  }
  function canTransition(report, to, u) {
    return P.canTransition(report, to, actorOr(u));
  }
  function visibleReports(u) {
    return P.visibleReports(store.reports(), actorOr(u));
  }
  function visibleComments(report, u) {
    return P.visibleComments(report, actorOr(u));
  }
  function projectUser(target, u) {
    return P.projectUser(target, actorOr(u));
  }

  /* Route-level guard used by the router. Returns true, or a redirect route.
     A convenience, never the boundary: views re-check can() before writing,
     and the server re-checks everything again. */
  function guard(requirement) {
    switch (requirement) {
      case 'auth':       return isAuthenticated() ? true : '#/signin';
      case 'intern':     return isIntern() ? true : (isAuthenticated() ? '#/denied' : '#/signin');
      case 'supervisor': return isSupervisor() ? true : (isAuthenticated() ? '#/denied' : '#/signin');
      default:           return true;
    }
  }

  global.ESH.auth = {
    restore: restore, user: user, role: role, refresh: refresh, setCurrent: setCurrent,
    isSupervisor: isSupervisor, isIntern: isIntern, isAuthenticated: isAuthenticated,
    apiMode: apiMode,
    signIn: signIn, signOut: signOut, assume: assume,
    can: can, guard: guard,
    allowedTransitions: allowedTransitions, canTransition: canTransition,
    visibleReports: visibleReports, visibleComments: visibleComments,
    projectUser: projectUser,
    SHARED_USER_FIELDS: P.SHARED_USER_FIELDS
  };

})(window);
