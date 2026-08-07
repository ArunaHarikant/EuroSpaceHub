/* ==========================================================================
   router.js — hash router. Hash routing (rather than the History API) keeps
   the module deployable as a static drop-in on the host platform and also
   lets it run straight from the filesystem.
   ========================================================================== */
(function (global) {
  'use strict';

  var routes = [];      /* { pattern, keys, guard, render } */
  var notFound = null;
  var currentPath = '';

  function compile(pattern) {
    var keys = [];
    var rx = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/:([A-Za-z0-9_]+)/g, function (_, k) { keys.push(k); return '([^/]+)'; });
    return { rx: new RegExp('^' + rx + '$'), keys: keys };
  }

  /** register(pattern, render[, guardRequirement]) */
  function register(pattern, render, guardReq) {
    var c = compile(pattern);
    routes.push({ pattern: pattern, rx: c.rx, keys: c.keys, render: render, guard: guardReq || null });
  }
  function setNotFound(fn) { notFound = fn; }

  function parse() {
    var raw = global.location.hash.replace(/^#/, '') || '/';
    var qi = raw.indexOf('?');
    var path = qi === -1 ? raw : raw.slice(0, qi);
    var query = {};
    if (qi !== -1) {
      raw.slice(qi + 1).split('&').forEach(function (kv) {
        if (!kv) return;
        /* Split on the FIRST '=' only: a value may itself contain '=' (base64,
           tokens), and kv.split('=')[1] would silently drop everything after it. */
        var eq = kv.indexOf('=');
        var k = eq === -1 ? kv : kv.slice(0, eq);
        var v = eq === -1 ? '' : kv.slice(eq + 1);
        query[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' '));
      });
    }
    if (path.length > 1 && path.charAt(path.length - 1) === '/') path = path.slice(0, -1);
    return { path: path, query: query, raw: raw };
  }

  function navigate(hash, replace) {
    var target = hash.charAt(0) === '#' ? hash : '#' + hash;
    var same = (global.location.hash || '#/') === target;
    if (replace) global.location.replace(target);
    else global.location.hash = target.slice(1);
    /* Setting an identical hash fires no hashchange, so re-render explicitly. */
    if (same) resolve();
  }

  function buildQuery(obj) {
    var parts = [];
    Object.keys(obj).forEach(function (k) {
      var v = obj[k];
      if (v === '' || v === null || v === undefined || v === 'all') return;
      parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
    });
    return parts.length ? '?' + parts.join('&') : '';
  }

  function resolve() {
    var loc = parse();
    var view = document.getElementById('view');
    var auth = global.ESH.auth;

    for (var i = 0; i < routes.length; i++) {
      var m = loc.path.match(routes[i].rx);
      if (!m) continue;

      var r = routes[i];
      if (r.guard) {
        var g = auth.guard(r.guard);
        if (g !== true) {
          var back = encodeURIComponent(loc.raw);
          navigate(g + (g.indexOf('?') === -1 ? '?next=' + back : '&next=' + back), true);
          return;
        }
      }

      var params = {};
      r.keys.forEach(function (k, idx) { params[k] = decodeURIComponent(m[idx + 1]); });

      currentPath = loc.path;
      view.innerHTML = '';
      try {
        r.render({ params: params, query: loc.query, path: loc.path, el: view });
      } catch (err) {
        console.error('[router] render failed for ' + loc.path, err);
        view.innerHTML = '<div class="wrap">' +
          global.ESH.ui.notice('danger', 'Something went wrong rendering this view',
            'Open the browser console for details, or ' +
            '<a href="#/">return to the hub home page</a>.') + '</div>';
      }
      afterRender(loc);
      return;
    }

    currentPath = loc.path;
    view.innerHTML = '';
    if (notFound) notFound({ params: {}, query: loc.query, path: loc.path, el: view });
    afterRender(loc);
  }

  function afterRender(loc) {
    global.ESH.charts.hideTip();
    global.ESH.ui.closeModal();
    if (global.ESH.app && global.ESH.app.renderChrome) global.ESH.app.renderChrome();
    /* Preserve in-page anchors; otherwise return to the top for a new view. */
    if (!loc.query.keepScroll) global.scrollTo({ top: 0, behavior: 'auto' });
    var view = document.getElementById('view');
    var h1 = view.querySelector('h1');
    document.title = (h1 ? h1.textContent.trim() + ' — ' : '') +
      'Lunar & Mars Research Hub | EuroSpaceHub';
  }

  function start() {
    global.addEventListener('hashchange', resolve);
    resolve();
  }

  function path() { return currentPath; }

  global.ESH.router = {
    register: register, setNotFound: setNotFound, start: start,
    navigate: navigate, resolve: resolve, parse: parse,
    buildQuery: buildQuery, path: path
  };

})(window);
