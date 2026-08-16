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
      '<h1>Prof. Bernard Foing — Lunar &amp; Mars Research Hub</h1>' +
      '<p class="lede">The working space for interns and student researchers <em>currently ' +
        'undertaking</em> a supervised research period with Prof. Bernard Foing, across ISU, ' +
        'ILEWG campaigns, VU Amsterdam and partner institutions. They hold a profile here, ' +
        'submit their lunar and Mars research outputs for review, and — once approved — share ' +
        'that work with the rest of the group. Access is restricted to members of the ' +
        'research group.</p>' +
      /* Textual equivalent for the aria-hidden decorative backdrop. */
      '<p class="hero__caption">Backdrop: selected lunar and Mars missions.<br>' +
        '<span class="key key--esa">European (ESA)</span>' +
        '<span class="key key--nasa">United States (NASA)</span></p>' +
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
        '<p class="lede">Submit a report, track it through review, and read the work your ' +
          'colleagues have had approved.</p>' +
        '<div class="btn-row">' +
          '<a class="btn btn--primary" href="#/submit">Submit a report</a>' +
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
        '<p class="lede mi-auto">Already placed with Prof. Foing? Sign in, or ' +
          'create your researcher account. This hub is not an application route — placements are ' +
          'arranged separately.</p>' +
        '<div class="btn-row jc-center">' +
          '<a class="btn btn--primary" href="#/signin">Sign in</a>' +
          '<a class="btn" href="#/register">Create a researcher account</a>' +
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
