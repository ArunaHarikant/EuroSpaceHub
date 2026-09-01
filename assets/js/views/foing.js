/* ==========================================================================
   views/foing.js — the landing page.

   This is the only surface an unauthenticated visitor reaches, and it is now
   purely a gateway: what the hub is, and a way in. No biography, no titles,
   no publication figures, no portrait — nothing about Prof. Foing personally.

   It still carries no report titles, researcher names or counts, so a
   signed-out visitor learns nothing about the work either.
   ========================================================================== */
(function (global) {
  'use strict';

  var ESH = global.ESH, auth = ESH.auth;

  function hero() {
    return '' +
    '<section class="hero"><div class="wrap">' +
      '<p class="eyebrow">EuroSpaceHub · Research Hub</p>' +
      '<h1>EuroSpaceResearchHub</h1>' +
    '</div></section>';
  }

  /* Members get their entry points; everyone else gets the door. */
  function accessPanel() {
    if (auth.isSupervisor()) {
      return '' +
      '<section class="section"><div class="card">' +
        '<h2>Supervisor</h2>' +
        '<p class="lede">Every researcher, every submission and every review thread is in the dashboard.</p>' +
        '<div class="btn-row">' +
          '<a class="btn btn--primary" href="#/dashboard">Open the supervisor dashboard</a>' +
          '<a class="btn" href="#/library">Report library</a>' +
        '</div>' +
      '</div></section>';
    }
    if (auth.isIntern()) {
      return '' +
      '<section class="section"><div class="card">' +
        '<h2>Your work</h2>' +
        '<p class="lede">Post a weekly update, submit a full report, track it through review, and ' +
          'read the work your colleagues have shared.</p>' +
        '<div class="btn-row">' +
          '<a class="btn btn--primary" href="#/submit-weekly">Quick-submit a weekly</a>' +
          '<a class="btn" href="#/submit">Submit a report</a>' +
          '<a class="btn" href="#/me">My profile</a>' +
          '<a class="btn" href="#/library">Report library</a>' +
        '</div>' +
      '</div></section>';
    }
    return '' +
    '<section class="section">' +
      '<div class="card center">' +
        '<h2>This research hub is private</h2>' +
        '<p class="lede mi-auto">Research reports, the report library and ' +
          'researcher profiles are available only to interns currently working with ' +
          'Prof. Foing and to Prof. Foing himself. Nothing on this page is a public archive, ' +
          'and no submitted work is published outside the group.</p>' +
        '<p class="lede mi-auto">Already placed with Prof. Foing? Sign in with the account he ' +
          'issued you. This hub is not an application route — placements are arranged separately, ' +
          'and accounts are created by the supervisor rather than self-registered.</p>' +
        '<div class="btn-row jc-center">' +
          '<a class="btn btn--primary" href="#/signin">Sign in</a>' +
          '<a class="btn" href="#/access">How access works</a>' +
        '</div>' +
      '</div>' +
    '</section>';
  }

  function render(ctx) {
    ctx.el.innerHTML = hero() + '<div class="wrap">' + accessPanel() + '</div>';
  }

  ESH.views = ESH.views || {};
  ESH.views.foing = render;

})(window);
