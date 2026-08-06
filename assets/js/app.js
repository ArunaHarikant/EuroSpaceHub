/* ==========================================================================
   app.js — bootstrap: route table, page chrome (sub-navigation + session
   chip), and the global controls in the header/footer.
   ========================================================================== */
(function (global) {
  'use strict';

  var ESH = global.ESH, ui = ESH.ui, store = ESH.store, auth = ESH.auth,
      router = ESH.router, V = ESH.views;
  var esc = ui.esc;

  /* ---------------- routes ----------------
     The third argument is the guard requirement enforced in router.resolve()
     via auth.guard(). Guards are a convenience, not the security boundary —
     each view re-checks auth.can() before rendering or writing anything. */

  router.register('/',                      V.foing);
  router.register('/library',               V.library,     'auth');
  router.register('/report/:id',            V.report,      'auth');
  router.register('/report/:id/edit',       V.reportEdit,  'auth');
  router.register('/submit',                V.submit,      'auth');
  router.register('/researcher/:id',        V.profile,     'auth');
  router.register('/researcher/:id/edit',   V.profileEdit, 'auth');
  router.register('/me',                    V.me,          'auth');
  router.register('/dashboard',             V.dashboard,   'supervisor');
  router.register('/signin',                V.signin);
  router.register('/register',              V.register);
  router.register('/reset',                 V.reset);
  router.register('/about-demo',            V.aboutDemo);
  router.register('/denied',                V.denied);
  router.setNotFound(V.notFound);

  /* ---------------- chrome ---------------- */

  function subnavItems() {
    var items = [
      { href: '#/',        label: 'Prof. Foing',    match: ['/'] },
    ];
    /* The library is members-only, so it is not advertised to signed-out visitors. */
    if (auth.isAuthenticated()) {
      items.push({ href: '#/library', label: 'Report library', match: ['/library', '/report'] });
    }
    if (auth.isIntern()) {
      items.push({ href: '#/me',     label: 'My profile',    match: ['/me', '/researcher'] });
      items.push({ href: '#/submit', label: 'Submit report', match: ['/submit'] });
    }
    if (auth.isSupervisor()) {
      items.push({ href: '#/dashboard', label: 'Supervisor dashboard', match: ['/dashboard'] });
    }
    items.push({ href: '#/about-demo', label: 'Access model', match: ['/about-demo'], spacer: true });
    return items;
  }

  function renderSubnav() {
    var path = router.path();
    var host = document.getElementById('subnav');
    host.innerHTML = subnavItems().map(function (it) {
      var active = it.match.some(function (m) {
        return m === '/' ? path === '/' : path.indexOf(m) === 0;
      });
      return '<a class="' + (it.spacer ? 'subnav__spacer ' : '') + (active ? 'is-active' : '') + '" href="' +
        esc(it.href) + '"' + (active ? ' aria-current="page"' : '') + '>' + esc(it.label) + '</a>';
    }).join('');
  }

  function renderSession() {
    var host = document.getElementById('sessionSlot');
    var u = auth.user();
    if (!u) {
      host.innerHTML =
        '<a class="btn btn--sm btn--ghost" href="#/signin">Sign in</a>' +
        '<a class="btn btn--sm btn--primary" href="#/register">Register</a>';
      return;
    }
    var roleLabel = u.role === 'supervisor'
      ? (u.id === store.SUPERVISOR_ID ? 'Supervisor' : 'Co-supervisor')
      : 'Researcher';
    host.innerHTML =
      '<span class="sessionchip">' +
        ui.avatar(u, 'sm') +
        '<span class="sessionchip__txt">' +
          '<span class="sessionchip__name">' + esc(u.fullName) + '</span>' +
          '<span class="sessionchip__role">' + esc(roleLabel) + '</span>' +
        '</span>' +
        '<button class="btn btn--sm btn--ghost" type="button" id="signOutBtn">Sign out</button>' +
      '</span>';
    document.getElementById('signOutBtn').addEventListener('click', function () {
      auth.signOut();
      ui.toast('Signed out. You are now a public visitor.', 'good');
      router.navigate('#/');
    });
  }

  function renderChrome() {
    renderSubnav();
    renderSession();
    /* Full mission backdrop on the landing page; a quiet starfield elsewhere,
       so dense views (dashboard tables, long forms) stay uncluttered. */
    ESH.backdrop.render(router.path() === '/' ? 'full' : 'ambient');
  }

  /* ---------------- global controls ---------------- */

  function wireGlobal() {
    document.getElementById('yr').textContent = new Date().getFullYear();

    var banner = document.getElementById('demoBanner');
    var closeBtn = document.getElementById('demoBannerClose');
    try {
      if (global.sessionStorage.getItem('esh.banner.dismissed') === '1') banner.hidden = true;
    } catch (e) {}
    closeBtn.addEventListener('click', function () {
      banner.hidden = true;
      try { global.sessionStorage.setItem('esh.banner.dismissed', '1'); } catch (e) {}
    });

    var toggle = document.getElementById('navToggle');
    var nav = document.getElementById('primaryNav');
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(open));
    });

    document.getElementById('resetData').addEventListener('click', function () {
      ui.confirmDialog('Reset demonstration data',
        'This discards every account, report and comment created in this browser and restores the seeded ' +
        'placeholder content. This cannot be undone.',
        'Reset everything', function () {
          store.reset();
          auth.restore();
          ui.toast('Demonstration data reset.', 'good');
          router.navigate('#/');
        }, true);
    });
  }

  /* ---------------- boot ---------------- */

  function boot() {
    store.load();
    auth.restore();
    wireGlobal();
    renderChrome();
    router.start();
  }

  ESH.app = { renderChrome: renderChrome };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

})(window);
