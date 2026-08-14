/* ==========================================================================
   ui.js — shared rendering helpers, formatters and small components.
   Everything user-supplied is escaped before it reaches innerHTML.
   ========================================================================== */
(function (global) {
  'use strict';

  var store = global.ESH.store;

  /* ---------------- escaping ---------------- */

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  /* Attribute-safe URL: only permit http(s), mailto and in-app hashes. */
  function safeUrl(u) {
    var s = String(u || '').trim();
    if (!s) return '';
    if (/^(https?:|mailto:|#)/i.test(s)) return s;
    if (/^www\./i.test(s)) return 'https://' + s;
    if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(s)) return 'https://' + s;
    return '';
  }

  /* ---------------- formatters ---------------- */

  var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  function fmtDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d)) return '—';
    return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  }
  function fmtDateTime(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d)) return '—';
    var hh = String(d.getHours()).padStart(2, '0');
    var mm = String(d.getMinutes()).padStart(2, '0');
    return fmtDate(iso) + ', ' + hh + ':' + mm;
  }
  function year(iso) { var d = new Date(iso); return isNaN(d) ? '' : String(d.getFullYear()); }
  function fmtBytes(n) {
    if (!n && n !== 0) return '';
    if (n === 0) return '—';
    var u = ['B','KB','MB','GB'], i = 0, v = n;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return (i === 0 ? v : v.toFixed(1)) + ' ' + u[i];
  }
  function snippet(text, words) {
    var w = String(text || '').trim().split(/\s+/);
    if (w.length <= words) return w.join(' ');
    return w.slice(0, words).join(' ') + '…';
  }
  function wordCount(text) {
    var t = String(text || '').trim();
    return t ? t.split(/\s+/).length : 0;
  }
  function initials(name) {
    var parts = String(name || '?').replace(/^(Prof\.|Dr\.|Mr\.|Ms\.|Mrs\.)\s*/i, '').trim().split(/\s+/);
    var a = (parts[0] || '?')[0] || '?';
    var b = parts.length > 1 ? (parts[parts.length - 1][0] || '') : '';
    return (a + b).toUpperCase();
  }
  function parseList(s) {
    return String(s || '').split(/[,;\n]/).map(function (x) { return x.trim(); })
      .filter(function (x) { return x.length; });
  }

  /* ---------------- components ---------------- */

  function statusBadge(statusKey) {
    var st = store.STATUSES[statusKey];
    if (!st) return '';
    return '<span class="badge badge--' + st.badge + '">' +
             '<span class="badge__dot" aria-hidden="true"></span>' + esc(st.label) +
           '</span>';
  }
  function standingBadge(standing) {
    var label = { active: 'Active', inactive: 'Inactive', alumnus: 'Alumnus' }[standing] || standing;
    return '<span class="badge badge--' + esc(standing) + '"><span class="badge__dot" aria-hidden="true"></span>' + esc(label) + '</span>';
  }
  function featuredBadge() {
    return '<span class="badge badge--featured" title="Pinned to the top of the report library">★ Featured</span>';
  }
  function tagList(tags, linkPrefix) {
    if (!tags || !tags.length) return '';
    return '<div class="tags">' + tags.map(function (t) {
      return linkPrefix
        ? '<a class="tag" href="' + esc(linkPrefix) + encodeURIComponent(t) + '">' + esc(t) + '</a>'
        : '<span class="tag">' + esc(t) + '</span>';
    }).join('') + '</div>';
  }
  function avatar(user, size) {
    var cls = 'avatar' + (size ? ' avatar--' + size : '');
    if (user && user.photoUrl && safeUrl(user.photoUrl)) {
      return '<span class="' + cls + '"><img src="' + esc(safeUrl(user.photoUrl)) + '" alt=""></span>';
    }
    return '<span class="' + cls + '" aria-hidden="true">' + esc(initials(user ? user.fullName : '?')) + '</span>';
  }
  function empty(title, body) {
    return '<div class="empty"><h3>' + esc(title) + '</h3><p>' + esc(body || '') + '</p></div>';
  }
  function notice(kind, title, bodyHtml) {
    return '<div class="notice notice--' + esc(kind) + '">' +
      (title ? '<h4>' + esc(title) + '</h4>' : '') +
      (bodyHtml ? '<p>' + bodyHtml + '</p>' : '') + '</div>';
  }

  /* Report card used on the Foing feed, the library and intern profiles. */
  function reportCard(r, opts) {
    opts = opts || {};
    var owner = store.userById(r.ownerId);
    var showStatus = !!opts.showStatus;
    return '' +
      '<article class="reportcard' + (r.featured ? ' reportcard--featured' : '') + '">' +
        '<div class="reportcard__top">' +
          '<span class="badge">' + esc(r.missionArea) + '</span>' +
          '<span class="badge">' + esc(r.reportType) + '</span>' +
          (r.featured ? featuredBadge() : '') +
          (showStatus ? statusBadge(r.status) : '') +
        '</div>' +
        '<h3><a href="#/report/' + esc(r.id) + '">' + esc(r.title) + '</a></h3>' +
        '<p class="reportcard__authors">' + esc(store.authorLine(r)) + '</p>' +
        '<p class="reportcard__abs">' + esc(snippet(r.abstract, 34)) + '</p>' +
        (r.keywords && r.keywords.length ? tagList(r.keywords.slice(0, 4)) : '') +
        '<div class="reportcard__foot">' +
          '<span class="meta">' + esc(fmtDate(r.submittedAt || r.createdAt)) +
            (owner ? ' · <a href="#/researcher/' + esc(owner.id) + '">' + esc(owner.fullName) + '</a>' : '') +
          '</span>' +
          '<a class="btn btn--sm" href="#/report/' + esc(r.id) + '">View record</a>' +
        '</div>' +
      '</article>';
  }

  /* ---------------- toasts ---------------- */

  function toast(msg, kind) {
    var host = document.getElementById('toasts');
    if (!host) return;
    var el = document.createElement('div');
    el.className = 'toast' + (kind ? ' toast--' + kind : '');
    el.setAttribute('role', kind === 'err' ? 'alert' : 'status');
    el.textContent = msg;
    host.appendChild(el);
    setTimeout(function () {
      el.style.transition = 'opacity .25s';
      el.style.opacity = '0';
      setTimeout(function () { el.remove(); }, 260);
    }, kind === 'err' ? 6000 : 3800);
  }

  /* ---------------- modal ---------------- */

  var lastFocus = null;

  function modal(opts) {
    closeModal();
    lastFocus = document.activeElement;
    var root = document.getElementById('modalRoot');
    var back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML =
      '<div class="modal" role="dialog" aria-modal="true" aria-label="' + esc(opts.title || 'Dialog') + '">' +
        '<div class="modal__head"><h3>' + esc(opts.title || '') + '</h3>' +
          '<button class="btn btn--sm btn--ghost" data-close type="button" aria-label="Close">&times;</button></div>' +
        '<div class="modal__body">' + (opts.body || '') + '</div>' +
        '<div class="modal__foot">' +
          '<button class="btn" data-close type="button">' + esc(opts.cancelLabel || 'Cancel') + '</button>' +
          (opts.confirmLabel
            ? '<button class="btn ' + (opts.danger ? 'btn--danger' : 'btn--primary') + '" data-confirm type="button">' + esc(opts.confirmLabel) + '</button>'
            : '') +
        '</div>' +
      '</div>';
    root.appendChild(back);

    function onKey(e) {
      if (e.key === 'Escape') closeModal();
      if (e.key === 'Tab') trap(e, back);
    }
    back.__onKey = onKey;
    document.addEventListener('keydown', onKey);

    back.addEventListener('click', function (e) {
      if (e.target === back || e.target.hasAttribute('data-close')) { closeModal(); return; }
      if (e.target.hasAttribute('data-confirm')) {
        var keep = opts.onConfirm && opts.onConfirm(back);
        if (!keep) closeModal();
      }
    });

    var first = back.querySelector('input, textarea, select, [data-confirm]') || back.querySelector('[data-close]');
    if (first) first.focus();
    return back;
  }

  function trap(e, container) {
    var f = container.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function closeModal() {
    var root = document.getElementById('modalRoot');
    if (!root) return;
    var back = root.firstElementChild;
    if (back && back.__onKey) document.removeEventListener('keydown', back.__onKey);
    root.innerHTML = '';
    if (lastFocus && lastFocus.focus) { lastFocus.focus(); lastFocus = null; }
  }

  function confirmDialog(title, message, confirmLabel, onYes, danger) {
    modal({
      title: title,
      body: '<p>' + esc(message) + '</p>',
      confirmLabel: confirmLabel || 'Confirm',
      danger: !!danger,
      onConfirm: function () { onYes(); }
    });
  }

  /* ---------------- forms ---------------- */

  function fieldError(inputEl, message) {
    clearFieldError(inputEl);
    inputEl.setAttribute('aria-invalid', 'true');
    var p = document.createElement('p');
    p.className = 'field__err';
    p.setAttribute('data-fielderr', '1');
    p.textContent = message;
    (inputEl.closest('.field') || inputEl.parentNode).appendChild(p);
  }
  function clearFieldError(inputEl) {
    inputEl.removeAttribute('aria-invalid');
    var wrap = inputEl.closest('.field') || inputEl.parentNode;
    var old = wrap.querySelector('[data-fielderr]');
    if (old) old.remove();
  }
  function clearAllErrors(form) {
    form.querySelectorAll('[data-fielderr]').forEach(function (n) { n.remove(); });
    form.querySelectorAll('[aria-invalid]').forEach(function (n) { n.removeAttribute('aria-invalid'); });
  }
  function focusFirstError(form) {
    var el = form.querySelector('[aria-invalid="true"]');
    if (!el) return;
    el.focus();
    /* Guarded: scrollIntoView is absent in some non-browser DOM environments,
       and it must never abort the validation handler that called us. */
    if (typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }
  function isEmail(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(s || '').trim()); }

  function selectOptions(values, selected) {
    return values.map(function (v) {
      var val = typeof v === 'string' ? v : v.value;
      var lab = typeof v === 'string' ? v : v.label;
      return '<option value="' + esc(val) + '"' + (val === selected ? ' selected' : '') + '>' + esc(lab) + '</option>';
    }).join('');
  }

  /* Download control for a report file.

     With a backend, the button carries no URL: clicking it asks the server for
     a short-lived presigned GET, which the server only issues after checking
     can('report:read') against its own session and its own report row. There
     is deliberately no B2 key in this markup — a key is not a capability, and
     one sitting in page source is a key in someone's browser history.

     Wire the click with bindFileControl() after inserting this. */
  function fileControl(r) {
    if (!r.file) {
      return '<p class="meta">No file attached to this record.</p>';
    }
    var label = esc(r.file.name) +
      (r.file.size ? ' <span class="meta">(' + esc(fmtBytes(r.file.size)) + ')</span>' : '');

    if (store.apiMode && store.apiMode()) {
      return '<p><button class="btn btn--primary" type="button" data-download="' + esc(r.id) + '">' +
               'Download file</button></p>' +
             '<p class="meta">' + label + '</p>' +
             '<p class="field__hint" data-download-status="' + esc(r.id) + '" hidden></p>';
    }

    /* Demo mode: the binary only ever existed in this tab. */
    var handle = store.fileHandle(r.file);
    if (handle && handle.available) {
      return '<p><a class="btn btn--primary" href="' + esc(handle.url) + '" download="' + esc(r.file.name) + '">Download file</a></p>' +
             '<p class="meta">' + label + '</p>';
    }
    return '<p><span class="btn" aria-disabled="true" title="Not available in this demo build">Download file</span></p>' +
           '<p class="meta">' + label + ' — <em>the binary is not stored in this demonstration build; ' +
           'only file metadata is persisted. See the access-control notes.</em></p>';
  }

  /** Attach the gated-download handler to any file controls inside `root`. */
  function bindFileControl(root) {
    if (!store.apiMode || !store.apiMode()) return;
    (root || document).querySelectorAll('[data-download]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-download');
        var status = (root || document).querySelector('[data-download-status="' + id + '"]');
        btn.disabled = true;
        if (status) { status.hidden = false; status.textContent = 'Preparing a secure link…'; }

        global.ESH.api.downloadUrl(id).then(function (d) {
          if (status) {
            status.textContent = 'Link issued — it expires in ' + Math.round(d.expiresIn / 60) + ' minutes.';
          }
          /* Navigate rather than window.open: no popup blocker, and the
             Content-Disposition the server signed makes it a download. */
          global.location.href = d.url;
        }).catch(function (err) {
          if (status) status.textContent = '';
          toast(err.message || 'Could not prepare the download.', 'err');
        }).then(function () {
          btn.disabled = false;
        });
      });
    });
  }

  global.ESH.ui = {
    esc: esc, safeUrl: safeUrl,
    fmtDate: fmtDate, fmtDateTime: fmtDateTime, year: year, fmtBytes: fmtBytes,
    snippet: snippet, wordCount: wordCount, initials: initials, parseList: parseList,
    statusBadge: statusBadge, standingBadge: standingBadge, featuredBadge: featuredBadge,
    tagList: tagList, avatar: avatar, empty: empty, notice: notice, reportCard: reportCard,
    toast: toast, modal: modal, closeModal: closeModal, confirmDialog: confirmDialog,
    fieldError: fieldError, clearFieldError: clearFieldError, clearAllErrors: clearAllErrors,
    focusFirstError: focusFirstError, isEmail: isEmail, selectOptions: selectOptions,
    fileControl: fileControl, bindFileControl: bindFileControl
  };

})(window);
