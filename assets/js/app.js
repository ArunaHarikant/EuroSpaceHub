/* ==========================================================================
   app.js — bootstrap: route table, page chrome (sub-navigation + session
   chip), and the global controls in the header/footer.
   ========================================================================== */
(function (global) {
  'use strict';

  var ESH = global.ESH, ui = ESH.ui, store = ESH.store, auth = ESH.auth,
      router = ESH.router, V = ESH.views;
  var esc = ui.esc;

  /* ---------------- theme ----------------
     Dark is the default (the :root tokens). Light is opt-in via this toggle and
     remembered in localStorage; there is no prefers-color-scheme auto-switch. */
  var THEME_KEY = 'esh.theme';
  var ICON_SUN = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/>' +
    '<path d="M12 2.5v2.2M12 19.3v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.5 12h2.2M19.3 12h2.2' +
    'M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6"/></svg>';
  var ICON_MOON = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.2A8 8 0 1 1 9.8 4 ' +
    '6.4 6.4 0 0 0 20 14.2z"/></svg>';
  var ICON_BELL = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M18 8.5a6 6 0 1 0-12 0c0 6-2.2 7.5-2.2 7.5h16.4S18 14.5 18 8.5z"/>' +
    '<path d="M13.7 20a2 2 0 0 1-3.4 0"/></svg>';

  function currentTheme() {
    try { return global.localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'; }
    catch (e) { return 'dark'; }
  }
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try { global.localStorage.setItem(THEME_KEY, theme); } catch (e) {}
    var btn = document.getElementById('themeToggle');
    if (btn) {
      var toLight = theme === 'dark';
      btn.innerHTML = toLight ? ICON_SUN : ICON_MOON;
      var label = toLight ? 'Switch to light theme' : 'Switch to dark theme';
      btn.setAttribute('aria-label', label);
      btn.setAttribute('title', label);
    }
  }
  function toggleTheme() { applyTheme(currentTheme() === 'dark' ? 'light' : 'dark'); }

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
  router.register('/inbox',                 V.inbox,       'auth');
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
    var themeBtn = '<button class="btn btn--sm btn--ghost themetoggle" type="button" id="themeToggle"></button>';
    if (!u) {
      host.innerHTML = themeBtn +
        '<a class="btn btn--sm btn--ghost" href="#/signin">Sign in</a>' +
        '<a class="btn btn--sm btn--primary" href="#/register">Register</a>';
    } else {
      var roleLabel = u.role === 'supervisor'
        ? (u.id === store.SUPERVISOR_ID ? 'Supervisor' : 'Co-supervisor')
        : 'Researcher';
      var unread = auth.notificationsFor(u).filter(function (n) { return n.unread; }).length;
      var bell = '<a class="notifbell" href="#/inbox" title="Notifications" aria-label="Notifications' +
        (unread ? ' (' + unread + ' unread)' : '') + '">' + ICON_BELL +
        (unread ? '<span class="notif-count" aria-hidden="true">' + (unread > 9 ? '9+' : unread) + '</span>' : '') +
        '</a>';
      host.innerHTML = bell + themeBtn +
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
    document.getElementById('themeToggle').addEventListener('click', toggleTheme);
    applyTheme(currentTheme());   /* sync the button icon/label with the active theme */
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
    applyTheme(currentTheme());   /* set <html data-theme> before the first paint */
    wireGlobal();
    renderChrome();
    router.start();
  }

  ESH.app = { renderChrome: renderChrome };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

})(window);
