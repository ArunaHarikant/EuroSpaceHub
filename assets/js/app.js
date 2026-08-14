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

    /* The banner has to tell the truth about which build this is. With a
       backend answering, "no server, no real security" would be a lie. */
    var tag = document.getElementById('demoBannerTag');
    var text = document.getElementById('demoBannerText');
    if (store.apiMode()) {
      banner.classList.add('demo-banner--live');
      tag.textContent = 'PRIVATE';
      text.innerHTML = 'Access is enforced on the server. Report files are stored in ' +
        'private Backblaze B2 storage and reached only through short-lived signed links. ' +
        '<a href="#/about-demo">How the access model works &rsaquo;</a>';
    } else {
      tag.textContent = 'DEMO MODE';
      text.innerHTML = 'Authentication and access control in this build are ' +
        '<strong>simulated in the browser</strong> (no server, no real security). All data is ' +
        "stored in this browser's <code>localStorage</code>. " +
        '<a href="#/about-demo">How the access model works &rsaquo;</a>';
    }
    banner.hidden = false;
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

    var resetBtn = document.getElementById('resetData');
    if (store.apiMode()) resetBtn.hidden = true;   /* there is no demo data to reset */
    resetBtn.addEventListener('click', function () {
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
    wireGlobal();

    /* When the server refuses an optimistic write, the cache has already been
       re-synced; all that is left is to tell the user and repaint. */
    store.setSyncErrorHandler(function (err, what) {
      ui.toast((what || 'That change') + ' was rejected by the server: ' + err.message, 'err');
      router.resolve();
      renderChrome();
    });

    /* API mode does one /bootstrap round trip before the first render, so the
       first paint shows the server's truth rather than a guess. */
    store.hydrate().catch(function (err) {
      console.error('[boot] could not reach the API; falling back to local data.', err);
      store.load();
    }).then(function () {
      auth.restore();
      renderChrome();
      router.start();
    });
  }

  ESH.app = { renderChrome: renderChrome };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

})(window);
