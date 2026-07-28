/* ==========================================================================
   views/account.js — sign-in, registration and the access-denied page.

   REMINDER: authentication here is a stub. Passwords are stored in plain text
   in localStorage and compared in the browser. Nothing on this page should be
   read as a security control; it exists to demonstrate the role model.
   ========================================================================== */
(function (global) {
  'use strict';

  var ESH = global.ESH, ui = ESH.ui, store = ESH.store, auth = ESH.auth, router = ESH.router;
  var esc = ui.esc;

  function nextFrom(query) {
    var n = query.next ? decodeURIComponent(query.next) : '';
    return (n && n.charAt(0) === '/') ? '#' + n : '#/';
  }

  /* ---------------- sign in ---------------- */

  function signin(ctx) {
    var target = nextFrom(ctx.query);
    var demoAccounts = [
      { id: store.SUPERVISOR_ID, label: 'Prof. Bernard Foing', sub: 'Supervisor — full access' },
      { id: 'u_cosup',           label: 'Co-Supervisor Name',  sub: 'Supervisor — designated co-supervisor' },
      { id: 'u_i1',              label: 'Intern Name A',       sub: 'Intern — own profile and reports only' },
      { id: 'u_i2',              label: 'Intern Name B',       sub: 'Intern — own profile and reports only' }
    ];

    ctx.el.innerHTML =
    '<div class="wrap" style="max-width:900px">' +
      '<h1>Sign in</h1>' +
      '<p class="lede">Access your researcher profile, submissions and — for supervisors — the review dashboard.</p>' +

      ui.notice('warn', 'Demonstration authentication',
        'This build has no server. Credentials are checked in the browser against records in ' +
        '<code>localStorage</code>, and the resulting "session" is a user id in the same store. ' +
        'It demonstrates the role model; it is not a security control. ' +
        '<a href="#/about-demo">Read the access-control notes</a>.') +

      '<div class="split">' +
        '<form class="card" id="signinForm" novalidate>' +
          '<h3>Sign in with credentials</h3>' +
          '<div class="field"><label for="siEmail">Email address <span class="req">*</span></label>' +
            '<input type="email" id="siEmail" name="email" autocomplete="username" required></div>' +
          '<div class="field"><label for="siPass">Password <span class="req">*</span></label>' +
            '<input type="password" id="siPass" name="password" autocomplete="current-password" required>' +
            '<p class="field__hint">Every seeded demo account uses the password <code>demo</code>.</p></div>' +
          '<div class="btn-row"><button class="btn btn--primary" type="submit">Sign in</button>' +
            '<a class="btn btn--ghost" href="#/register">Register instead</a></div>' +
          '<p id="siErr" class="field__err" hidden></p>' +
        '</form>' +

        '<div class="card">' +
          '<h3>Demo role switcher</h3>' +
          '<p class="meta">Assume a role without credentials to explore what each one can see. ' +
            'This bypass exists only because the build is a demonstration.</p>' +
          '<div style="display:grid;gap:8px;margin-top:12px">' +
            demoAccounts.map(function (a) {
              var u = store.userById(a.id);
              if (!u) return '';
              return '<button class="btn" type="button" data-assume="' + esc(a.id) + '" ' +
                'style="justify-content:flex-start;text-align:left;height:auto;padding:10px 12px">' +
                '<span style="display:block"><span style="display:block;color:var(--ink)">' + esc(a.label) + '</span>' +
                '<span class="meta">' + esc(a.sub) + '</span></span></button>';
            }).join('') +
          '</div>' +
          '<hr>' +
          '<p class="meta" style="margin-bottom:0">Signed out you see only Prof. Foing\'s profile ' +
            'page and this sign-in screen — no reports, no library, no researcher profiles.</p>' +
        '</div>' +
      '</div>' +
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

      var res = auth.signIn(email, pass);
      if (!res.ok) { errEl.hidden = false; errEl.textContent = res.error; return; }
      ui.toast('Signed in as ' + res.user.fullName + '.', 'good');
      router.navigate(res.user.role === 'supervisor' && target === '#/' ? '#/dashboard' : target);
    });

    ctx.el.querySelectorAll('[data-assume]').forEach(function (b) {
      b.addEventListener('click', function () {
        var res = auth.assume(b.getAttribute('data-assume'));
        if (!res.ok) { ui.toast(res.error, 'err'); return; }
        ui.toast('Now acting as ' + res.user.fullName + ' (' + res.user.role + ').', 'good');
        router.navigate(res.user.role === 'supervisor' ? '#/dashboard' : '#/me');
      });
    });
  }

  /* ---------------- register ---------------- */

  function register(ctx) {
    if (auth.isAuthenticated()) {
      ctx.el.innerHTML = '<div class="wrap">' +
        ui.notice('info', 'You are already signed in',
          'Sign out first if you need to create a different account. <a href="#/me">Go to your profile</a>.') +
        '</div>';
      return;
    }

    var sup = store.userById(store.SUPERVISOR_ID);

    ctx.el.innerHTML =
    '<div class="wrap" style="max-width:840px">' +
      '<p class="eyebrow">Researcher registration</p>' +
      '<h1>Create a researcher profile</h1>' +
      '<p class="lede">For interns and student researchers undertaking a supervised research period ' +
        'with Prof. Bernard Foing. Fields marked <span class="req">*</span> are required.</p>' +

      ui.notice('warn', 'Demonstration registration',
        'The account you create is stored in this browser only and is visible to anyone using this browser. ' +
        'Do not enter real personal data.') +

      '<form id="regForm" novalidate>' +
        '<fieldset><legend>Identity</legend>' +
          '<div class="field"><label for="rName">Full name <span class="req">*</span></label>' +
            '<input type="text" id="rName" name="fullName" autocomplete="name" required></div>' +
          '<div class="field"><label for="rEmail">Institutional email address <span class="req">*</span></label>' +
            '<input type="email" id="rEmail" name="email" autocomplete="email" required>' +
            '<p class="field__hint">Used as your sign-in identifier. Never shown to other researchers.</p></div>' +
          '<div class="field"><label for="rPass">Password <span class="req">*</span></label>' +
            '<input type="password" id="rPass" name="password" autocomplete="new-password" required>' +
            '<p class="field__hint">Minimum 4 characters. Stored in plain text in this demonstration build.</p></div>' +
        '</fieldset>' +

        '<fieldset><legend>Affiliation &amp; research period</legend>' +
          '<div class="field-row">' +
            '<div class="field"><label for="rInst">Home university or institution <span class="req">*</span></label>' +
              '<input type="text" id="rInst" name="institution" list="instList" required ' +
              'placeholder="e.g. International Space University">' +
              '<datalist id="instList">' +
                '<option value="International Space University"></option>' +
                '<option value="Vrije Universiteit Amsterdam"></option>' +
                '<option value="Florida Institute of Technology"></option>' +
              '</datalist>' +
              '<p class="field__hint">Free text — any institution.</p></div>' +
            '<div class="field"><label for="rProg">Programme or course</label>' +
              '<input type="text" id="rProg" name="programme" placeholder="e.g. MSc Space Studies"></div>' +
          '</div>' +
          '<div class="field"><label for="rSup">Supervisor</label>' +
            '<select id="rSup" disabled><option>' + esc(sup ? sup.fullName : 'Prof. Bernard Foing') + '</option></select>' +
            '<p class="field__hint">This hub instance is dedicated to Prof. Foing\'s research group, so the ' +
              'supervisor is fixed. Co-supervisors are designated by the supervisor after registration.</p></div>' +
          '<div class="field-row">' +
            '<div class="field"><label for="rStart">Research period — start <span class="req">*</span></label>' +
              '<input type="date" id="rStart" name="startDate" required></div>' +
            '<div class="field"><label for="rEnd">Research period — end</label>' +
              '<input type="date" id="rEnd" name="endDate">' +
              '<p class="field__hint">Leave blank if open-ended.</p></div>' +
          '</div>' +
        '</fieldset>' +

        '<fieldset><legend>Research</legend>' +
          '<div class="field"><label for="rTopic">Research topic <span class="req">*</span></label>' +
            '<input type="text" id="rTopic" name="researchTopic" required ' +
            'placeholder="e.g. Lunar regolith geotechnics"></div>' +
          '<div class="field"><label for="rKw">Keywords</label>' +
            '<input type="text" id="rKw" name="keywords" placeholder="regolith, ISRU, south pole">' +
            '<p class="field__hint">Comma-separated.</p></div>' +
          '<div class="field"><label for="rBio">Short biography</label>' +
            '<textarea id="rBio" name="bio" rows="4" ' +
            'placeholder="A few sentences on your background and what you are working on."></textarea></div>' +
        '</fieldset>' +

        '<fieldset><legend>Optional</legend>' +
          '<div class="field"><label for="rPhoto">Photograph URL</label>' +
            '<input type="url" id="rPhoto" name="photoUrl" placeholder="https://…">' +
            '<p class="field__hint">A link is used rather than an upload so that images are not written to browser storage.</p></div>' +
          '<div class="field-row">' +
            '<div class="field"><label for="rLi">LinkedIn</label><input type="url" id="rLi" name="linkedin" placeholder="https://www.linkedin.com/in/…"></div>' +
            '<div class="field"><label for="rOr">ORCID</label><input type="text" id="rOr" name="orcid" placeholder="0000-0000-0000-0000"></div>' +
            '<div class="field"><label for="rWeb">Personal site or portfolio</label><input type="url" id="rWeb" name="website" placeholder="https://…"></div>' +
          '</div>' +
          ui.notice('info', 'Who can see this',
            'This hub is closed. Your profile and your reports are visible only to you and to ' +
            'Prof. Foing until he approves a report — approved work is then shared with the rest ' +
            'of the research group. Your email address and research-period dates are never shown ' +
            'to other researchers, and nothing here is published publicly.') +
        '</fieldset>' +

        '<div class="btn-row"><button class="btn btn--primary" type="submit">Create profile</button>' +
          '<a class="btn btn--ghost" href="#/signin">I already have an account</a></div>' +
      '</form>' +
    '</div>';

    var form = document.getElementById('regForm');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      ui.clearAllErrors(form);
      var ok = true;
      function req(name, msg) {
        var el = form.elements[name];
        if (!el.value.trim()) { ui.fieldError(el, msg); ok = false; }
        return el;
      }
      req('fullName', 'Enter your full name.');
      var emailEl = req('email', 'Enter your institutional email address.');
      if (emailEl.value.trim() && !ui.isEmail(emailEl.value)) { ui.fieldError(emailEl, 'That does not look like a valid email address.'); ok = false; }
      else if (emailEl.value.trim() && store.userByEmail(emailEl.value)) { ui.fieldError(emailEl, 'An account already exists for that email address.'); ok = false; }
      if (form.elements.password.value.length < 4) { ui.fieldError(form.elements.password, 'Use at least 4 characters.'); ok = false; }
      req('institution', 'Enter your home university or institution.');
      req('startDate', 'Enter the start date of your research period.');
      req('researchTopic', 'Enter your research topic.');
      if (form.elements.startDate.value && form.elements.endDate.value && form.elements.endDate.value < form.elements.startDate.value) {
        ui.fieldError(form.elements.endDate, 'The end date cannot precede the start date.'); ok = false;
      }
      if (!ok) { ui.focusFirstError(form); return; }

      var u = store.addUser({
        role: 'intern',
        fullName: form.elements.fullName.value.trim(),
        email: form.elements.email.value.trim(),
        password: form.elements.password.value,
        institution: form.elements.institution.value.trim(),
        programme: form.elements.programme.value.trim(),
        supervisorId: store.SUPERVISOR_ID,
        startDate: form.elements.startDate.value,
        endDate: form.elements.endDate.value,
        researchTopic: form.elements.researchTopic.value.trim(),
        keywords: ui.parseList(form.elements.keywords.value),
        bio: form.elements.bio.value.trim(),
        photoUrl: ui.safeUrl(form.elements.photoUrl.value),
        links: {
          linkedin: ui.safeUrl(form.elements.linkedin.value),
          orcid: form.elements.orcid.value.trim(),
          website: ui.safeUrl(form.elements.website.value)
        },
        standing: 'active'
      });

      auth.assume(u.id);
      ui.toast('Profile created. You can now submit reports.', 'good');
      router.navigate('#/me');
    });
  }

  /* ---------------- denied ---------------- */

  function denied(ctx) {
    var u = auth.user();
    ctx.el.innerHTML = '<div class="wrap" style="max-width:680px">' +
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
      '<a href="#/about-demo">access-control page</a>.</p>' +
    '</div>';
  }

  ESH.views = ESH.views || {};
  ESH.views.signin = signin;
  ESH.views.register = register;
  ESH.views.denied = denied;

})(window);
