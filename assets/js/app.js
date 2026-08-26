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

    /* Export the whole store as a JSON file the visitor can keep or move to
       another browser (the store otherwise lives only in this one). */
    document.getElementById('exportData').addEventListener('click', function () {
      ESH.exporter.download('eurospacehub-data.json', 'application/json',
        JSON.stringify(store.getState(), null, 2));
    });

    /* Import replaces everything, so it is gated behind a confirm and the shape
       is validated in store.importState(). */
    var importInput = document.getElementById('importData');
    /* Import replaces the whole store, which only means something when the
       store IS the data. With a backend it is a cache the server refills, so
       the control is withdrawn rather than left to fail quietly. Export stays:
       a dump of what you can see is still a useful backup. */
    if (store.apiMode()) {
      var importLabel = document.querySelector('label[for="importData"]');
      if (importLabel) importLabel.hidden = true;
    }
    importInput.addEventListener('change', function () {
      var file = importInput.files && importInput.files[0];
      if (!file) return;
      var reader = new global.FileReader();
      reader.onload = function () {
        var obj;
        try { obj = JSON.parse(reader.result); }
        catch (e) { ui.toast('That file is not valid JSON.', 'err'); importInput.value = ''; return; }
        ui.confirmDialog('Import data',
          'This replaces every account, report and comment in this browser with the contents of the file. ' +
          'This cannot be undone. Consider exporting first.',
          'Replace all data', function () {
            if (store.importState(obj)) {
              auth.signOut();
              ui.toast('Data imported.', 'good');
              router.navigate('#/');
            } else {
              ui.toast(store.apiMode()
                ? 'Import is unavailable when the hub is backed by a server.'
                : 'That file is not a valid hub export.', 'err');
            }
          }, true);
        importInput.value = '';
      };
      reader.readAsText(file);
    });
  }

  /* ---------------- boot ---------------- */

  function boot() {
    applyTheme(currentTheme());   /* set <html data-theme> before the first paint */
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
    store.hydrate().then(function () {
      auth.restore();
      renderChrome();
      router.start();
    })['catch'](function (err) {
      /* This used to call store.load(), which seeds placeholder content when
         localStorage is empty — six invented reports and seven invented
         accounts, under a banner reading "access is enforced on the server".
         There is nothing safe to show here: say so and stop. */
      console.error('[boot] could not reach the API.', err);
      showUnreachable();
    });
  }

  /* A dead end on purpose. Starting the router would paint an empty hub, which
     reads as "there is nothing here" rather than "we could not ask". */
  function showUnreachable() {
    var view = document.getElementById('view');
    if (!view) return;
    view.innerHTML =
      '<div class="wrap wrap--840">' +
        '<p class="eyebrow">EuroSpaceHub · Research Hub</p>' +
        '<h1>The hub cannot reach its server</h1>' +
        ui.notice('err', 'Nothing has been loaded',
          'Your work is safe — this is a connection problem, not a data problem. ' +
          'Nothing is shown because nothing could be fetched, and showing an empty ' +
          'hub would look like an empty hub rather than a failure.') +
        '<p class="mt-20"><button class="btn btn--primary" type="button" id="retryBoot">Try again</button></p>' +
        '<p class="meta mt-14">If this persists, the server may be restarting or down for ' +
          'maintenance. Contact your supervisor if it does not clear.</p>' +
      '</div>';
    var retry = document.getElementById('retryBoot');
    if (retry) retry.addEventListener('click', function () { global.location.reload(); });
  }

  ESH.app = { renderChrome: renderChrome };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

})(window);
