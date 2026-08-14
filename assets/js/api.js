/* ==========================================================================
   api.js — the browser's client for the real backend.

   Enabled only when window.ESH_CONFIG.apiBase is set, which the server serves
   from /config.js. Opened from disk with no server, the file is inert and the
   hub falls back to its localStorage demo mode.

   The session is an httpOnly cookie: nothing here reads or writes it, and
   `credentials: 'same-origin'` is what carries it. `session()` returns the
   user the server told us about at boot — an answer, not an assertion.

   FILE UPLOADS go browser → B2 directly. This module asks the server to sign
   a PUT, sends the bytes to Backblaze, then tells the server to confirm. The
   report file never passes through our own host.
   ========================================================================== */
(function (global) {
  'use strict';

  var CFG = global.ESH_CONFIG || {};
  var BASE = CFG.apiBase || null;

  var sessionUser = null;      /* filled by bootstrap() */

  function enabled() { return !!BASE; }
  function session() { return sessionUser; }

  /* ---------------- transport ---------------- */

  function request(method, path, body, opts) {
    opts = opts || {};
    var init = {
      method: method,
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }
    };
    if (body !== undefined && body !== null) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    return fetch(BASE + path, init).then(function (res) {
      /* 204 and friends have no body to parse. */
      if (res.status === 204) return { ok: true };
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.ok) return data;
        var err = new Error(data.error || ('Request failed (' + res.status + ')'));
        err.status = res.status;
        err.data = data;
        /* A 401 means the session is gone — usually an expiry mid-session. */
        if (res.status === 401 && !opts.quiet) sessionUser = null;
        throw err;
      });
    });
  }

  var get = function (p, o) { return request('GET', p, null, o); };
  var post = function (p, b, o) { return request('POST', p, b, o); };
  var patch = function (p, b, o) { return request('PATCH', p, b, o); };
  var del = function (p, b, o) { return request('DELETE', p, b, o); };

  /* ---------------- session ---------------- */

  /** One round trip on load: who am I, and everything I may see. */
  function bootstrap() {
    return get('/bootstrap', { quiet: true }).then(function (data) {
      sessionUser = data.user || null;
      return data;
    }).catch(function () {
      sessionUser = null;
      return { user: null, reports: [], users: [] };
    });
  }

  function login(email, password) {
    return post('/auth/login', { email: email, password: password })
      .then(function (data) { sessionUser = data.user; return { ok: true, user: data.user }; })
      .catch(function (err) { return { ok: false, error: err.message }; });
  }

  function logout() {
    return post('/auth/logout', {}).catch(function () {})
      .then(function () { sessionUser = null; });
  }

  function changePassword(currentPassword, newPassword) {
    return post('/auth/password', { currentPassword: currentPassword, newPassword: newPassword })
      .then(function () { return { ok: true }; })
      .catch(function (err) { return { ok: false, error: err.message }; });
  }

  function issueTemporaryPassword(userId) {
    return post('/auth/users/' + encodeURIComponent(userId) + '/temporary-password', {})
      .then(function (d) { return { ok: true, temporaryPassword: d.temporaryPassword }; })
      .catch(function (err) { return { ok: false, error: err.message }; });
  }

  /* ---------------- reports ---------------- */

  var reports = {
    list:    function ()          { return get('/reports'); },
    get:     function (id)        { return get('/reports/' + encodeURIComponent(id)); },
    create:  function (body)      { return post('/reports', body); },
    update:  function (id, body)  { return patch('/reports/' + encodeURIComponent(id), body); },
    status:  function (id, to, n) { return post('/reports/' + encodeURIComponent(id) + '/status', { status: to, note: n || '' }); },
    feature: function (id, on)    { return post('/reports/' + encodeURIComponent(id) + '/featured', { featured: !!on }); },
    comment: function (id, body, parentId, internal) {
      return post('/reports/' + encodeURIComponent(id) + '/comments',
                  { body: body, parentId: parentId || null, internal: !!internal });
    },
    remove:  function (id)        { return del('/reports/' + encodeURIComponent(id)); }
  };

  var users = {
    list:   function ()         { return get('/users'); },
    get:    function (id)       { return get('/users/' + encodeURIComponent(id)); },
    update: function (id, body) { return patch('/users/' + encodeURIComponent(id), body); }
  };

  /* ---------------- files ---------------- */

  /**
   * uploadFile(reportId, file, onProgress) → Promise<{file}>
   *
   *   1. ask our server to sign a PUT  (it checks can('file:upload'))
   *   2. PUT the bytes straight to B2  (never through our server)
   *   3. ask our server to confirm     (it HEADs the object and records it)
   *
   * XMLHttpRequest rather than fetch, purely because it reports upload
   * progress and fetch still cannot.
   */
  function uploadFile(reportId, file, onProgress) {
    return post('/reports/' + encodeURIComponent(reportId) + '/upload-url', {
      filename: file.name,
      contentType: file.type || '',
      size: file.size
    }).then(function (ticket) {
      return new Promise(function (resolve, reject) {
        var xhr = new XMLHttpRequest();
        xhr.open('PUT', ticket.url, true);

        /* Exactly the headers the URL was signed with. Adding any others —
           or omitting Content-Type — invalidates the signature. */
        Object.keys(ticket.headers || {}).forEach(function (h) {
          xhr.setRequestHeader(h, ticket.headers[h]);
        });

        if (onProgress && xhr.upload) {
          xhr.upload.onprogress = function (e) {
            if (e.lengthComputable) onProgress(e.loaded / e.total, e.loaded, e.total);
          };
        }
        xhr.onload = function () {
          if (xhr.status >= 200 && xhr.status < 300) return resolve(ticket);
          reject(new Error('Backblaze rejected the upload (HTTP ' + xhr.status + '). ' +
                           'If this is a CORS error, check the bucket CORS rules.'));
        };
        xhr.onerror = function () {
          reject(new Error('The upload could not reach Backblaze. This is usually a missing ' +
                           'CORS rule on the bucket for this origin.'));
        };
        xhr.onabort = function () { reject(new Error('Upload cancelled.')); };
        xhr.send(file);
      });
    }).then(function (ticket) {
      return post('/reports/' + encodeURIComponent(reportId) + '/file', { uploadId: ticket.uploadId });
    });
  }

  /**
   * downloadUrl(reportId) → Promise<{url, expiresIn, name, size, type}>
   * Note there is no key parameter, by design: the server resolves the key
   * itself after checking can('report:read').
   */
  function downloadUrl(reportId, inline) {
    return get('/reports/' + encodeURIComponent(reportId) + '/file-url' + (inline ? '?inline=1' : ''));
  }

  function deleteFile(reportId) {
    return del('/reports/' + encodeURIComponent(reportId) + '/file');
  }

  global.ESH = global.ESH || {};
  global.ESH.api = {
    enabled: enabled, session: session, bootstrap: bootstrap,
    login: login, logout: logout, changePassword: changePassword,
    issueTemporaryPassword: issueTemporaryPassword,
    reports: reports, users: users,
    uploadFile: uploadFile, downloadUrl: downloadUrl, deleteFile: deleteFile,
    request: request
  };

})(window);
