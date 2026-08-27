/* ==========================================================================
   views/account.js — sign-in, the access-denied page, and the two explanations
   that stand where a registration form and a reset form used to be.

   This hub is closed. Accounts are ISSUED by the supervisor, not applied for,
   and replacement passwords are handed over directly. Both of those are
   deliberate:

   - An open registration form on a closed hub is a way in for anyone with the
     URL. `can('user:create')` is supervisor-only and enforced server-side, so
     the missing form is a convenience rather than the control.
   - A reset link has to be emailed to prove control of the mailbox. There is
     no mail service, and a form that prints its own token on the page is an
     account-takeover hole rather than a password reset.

   Both routes still exist so that an old link or a bookmark lands on an
   explanation instead of a 404.
   ========================================================================== */
(function (global) {
  'use strict';

  var ESH = global.ESH, ui = ESH.ui, auth = ESH.auth, router = ESH.router;
  var esc = ui.esc;

  function nextFrom(query) {
    var n = query.next ? decodeURIComponent(query.next) : '';
    return (n && n.charAt(0) === '/') ? '#' + n : '#/';
  }

  /* ---------------- sign in ---------------- */

  function signin(ctx) {
    var target = nextFrom(ctx.query);

    ctx.el.innerHTML =
    '<div class="wrap wrap--680">' +
      '<h1>Sign in</h1>' +
      '<p class="lede">Access your researcher profile, submissions and — for supervisors — the ' +
        'review dashboard.</p>' +

      '<form class="card" id="signinForm" novalidate>' +
        '<div class="field"><label for="siEmail">Email address <span class="req">*</span></label>' +
          '<input type="email" id="siEmail" name="email" autocomplete="username" required></div>' +
        '<div class="field"><label for="siPass">Password <span class="req">*</span></label>' +
          '<input type="password" id="siPass" name="password" autocomplete="current-password" required></div>' +
        '<div class="btn-row"><button class="btn btn--primary" type="submit">Sign in</button></div>' +
        '<p id="siErr" class="field__err" hidden></p>' +
        '<p class="field__hint mt-14">No account, or lost your password? ' +
          '<a href="#/access">Prof. Foing issues both directly.</a></p>' +
      '</form>' +

      '<p class="meta mt-20">Signed out you see only this page and the hub\'s front door — ' +
        'no reports, no library, no researcher names.</p>' +
    '</div>';

    var form = document.getElementById('signinForm');
    var errEl = document.getElementById('siErr');

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      errEl.hidden = true;
      ui.clearAllErrors(form);
      var email = form.elements.email.value.trim(), pass = form.elements.password.value;
      if (!ui.isEmail(email)) { ui.fieldError(form.elements.email, 'Enter a valid email address.'); ui.focusFirstError(form); return; }
      if (!pass) { ui.fieldError(form.elements.password, 'Enter your password.'); ui.focusFirstError(form); return; }

      var btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      auth.signIn(email, pass).then(function (res) {
        btn.disabled = false;
        if (!res || !res.ok) {
          errEl.hidden = false;
          errEl.textContent = (res && res.error) || 'Sign-in failed. Please try again.';
          return;
        }
        /* The cache was filled for the anonymous actor; refill it as this one. */
        return ESH.store.hydrate().then(function () {
          ui.toast('Signed in as ' + res.user.fullName + '.', 'good');
          router.navigate(res.user.role === 'supervisor' && target === '#/' ? '#/dashboard' : target);
        });
      })['catch'](function (err) {
        btn.disabled = false;
        errEl.hidden = false;
        errEl.textContent = err.message || 'Sign-in failed. Please try again.';
      });
    });
  }

  /* ---------------- where registration used to be ---------------- */

  function register(ctx) {
    ctx.el.innerHTML =
    '<div class="wrap wrap--680">' +
      '<p class="eyebrow">Researcher registration</p>' +
      '<h1>Accounts are issued, not applied for</h1>' +
      ui.notice('info', 'This hub is closed',
        'It is a working tool for researchers already placed with Prof. Foing — not a ' +
        'recruitment channel. Prof. Foing creates your account from the supervisor dashboard ' +
        'and gives you the password directly. If you are expecting access and have not ' +
        'received it, contact your supervisor.') +
      '<div class="btn-row mt-20">' +
        '<a class="btn btn--primary" href="#/signin">Back to sign in</a>' +
        '<a class="btn btn--ghost" href="#/access">How access works</a>' +
      '</div>' +
    '</div>';
  }

  /* ---------------- where self-service reset used to be ---------------- */

  function reset(ctx) {
    ctx.el.innerHTML =
    '<div class="wrap wrap--680">' +
      '<p class="eyebrow">Password reset</p>' +
      '<h1>Ask Prof. Foing for a new password</h1>' +
      ui.notice('info', 'There is no self-service reset',
        'A reset link has to be emailed to prove you control the mailbox, and this deployment ' +
        'has no mail service. Prof. Foing can issue a replacement from your researcher profile ' +
        'and hand it over directly. Change it from your own profile page once you are signed in.') +
      '<div class="btn-row mt-20">' +
        '<a class="btn btn--primary" href="#/signin">Back to sign in</a>' +
      '</div>' +
    '</div>';
  }

  /* ---------------- access denied ---------------- */

  function denied(ctx) {
    var u = auth.user();
    ctx.el.innerHTML = '<div class="wrap wrap--680">' +
      '<h1>Access denied</h1>' +
      ui.notice('danger', 'You do not have permission to view that page',
        u ? 'You are signed in as <strong>' + esc(u.fullName) + '</strong> (' + esc(u.role) + '). ' +
            'That area is restricted to another role.'
          : 'Sign in to continue.') +
      '<div class="btn-row">' +
        '<a class="btn btn--primary" href="#/">Return to the hub</a>' +
        (u ? '<a class="btn" href="#/me">My profile</a>' : '<a class="btn" href="#/signin">Sign in</a>') +
      '</div>' +
      '<hr><p class="meta">The rules that produced this decision are listed on the ' +
      '<a href="#/access">access-control page</a>.</p>' +
    '</div>';
  }

  ESH.views = ESH.views || {};
  ESH.views.signin = signin;
  ESH.views.reset = reset;
  ESH.views.register = register;
  ESH.views.denied = denied;

})(window);
