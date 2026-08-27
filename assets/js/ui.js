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
  function daysSince(iso) {
    if (!iso) return null;
    var t = new Date(iso).getTime();
    if (isNaN(t)) return null;
    return Math.max(0, Math.floor((Date.now() - t) / 86400000));
  }

  /* Escape-safe search highlighting. The text is escaped FIRST, then matches
     are wrapped in <mark>; the search terms are only ever compiled into a
     regex (with specials escaped), never written into the HTML, so a hostile
     query cannot inject markup. */
  function highlight(text, terms) {
    var safeText = esc(text);
    var list = (terms || []).map(function (t) { return String(t || '').trim(); })
      .filter(Boolean)
      .sort(function (a, b) { return b.length - a.length; })
      .map(function (t) { return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); });
    if (!list.length) return safeText;
    var rx = new RegExp('(' + list.join('|') + ')', 'gi');
    return safeText.replace(rx, '<mark>$1</mark>');
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

  /* Clickable keyword suggestions that append to a comma-separated input.
     Render with keywordChips(); wire with wireKeywordChips() after insertion. */
  function keywordChips(terms, limit) {
    var list = (terms || []).slice(0, limit || 12);
    if (!list.length) return '';
    return '<div class="kwsuggest"><span class="kwsuggest__label">Suggestions:</span> ' +
      list.map(function (t) {
        return '<button type="button" class="tag kwsuggest__chip" data-kw="' + esc(t) + '">+ ' + esc(t) + '</button>';
      }).join(' ') + '</div>';
  }
  function wireKeywordChips(container, inputEl) {
    if (!container || !inputEl) return;
    container.querySelectorAll('[data-kw]').forEach(function (chip) {
      chip.addEventListener('click', function () {
        var kw = chip.getAttribute('data-kw');
        var cur = parseList(inputEl.value);
        if (cur.some(function (x) { return x.toLowerCase() === kw.toLowerCase(); })) return;
        cur.push(kw);
        inputEl.value = cur.join(', ');
        inputEl.focus();
      });
    });
  }

  /* Pager. `makeHref(n)` returns the URL for page n. Renders nothing for a
     single page. Prev/Next become non-links at the ends. */
  function pager(current, total, makeHref) {
    if (total <= 1) return '';
    var prev = current > 1
      ? '<a class="btn btn--sm" href="' + esc(makeHref(current - 1)) + '" rel="prev">‹ Prev</a>'
      : '<span class="btn btn--sm" aria-disabled="true">‹ Prev</span>';
    var next = current < total
      ? '<a class="btn btn--sm" href="' + esc(makeHref(current + 1)) + '" rel="next">Next ›</a>'
      : '<span class="btn btn--sm" aria-disabled="true">Next ›</span>';
    return '<nav class="pager" aria-label="Pagination">' + prev +
      '<span class="pager__status">Page ' + current + ' of ' + total + '</span>' + next + '</nav>';
  }

  /* Breadcrumb trail. items: [{ label, href? }]; the last item is the current
     page and is never a link. */
  function breadcrumbs(items) {
    return '<nav class="crumbs" aria-label="Breadcrumb"><ol>' +
      items.map(function (it, i) {
        var last = i === items.length - 1;
        var inner = (it.href && !last)
          ? '<a href="' + esc(it.href) + '">' + esc(it.label) + '</a>'
          : '<span' + (last ? ' aria-current="page"' : '') + '>' + esc(it.label) + '</span>';
        return '<li>' + inner + '</li>';
      }).join('') +
      '</ol></nav>';
  }

  /* Report card used on the Foing feed, the library and intern profiles. */
  function reportCard(r, opts) {
    opts = opts || {};
    var owner = store.userById(r.ownerId);
    var showStatus = !!opts.showStatus;
    var hl = opts.highlight;   /* optional [terms] to mark in the title/abstract */
    var title = hl ? highlight(r.title, hl) : esc(r.title);
    var abs = hl ? highlight(snippet(r.abstract, 34), hl) : esc(snippet(r.abstract, 34));
    return '' +
      '<article class="reportcard' + (r.featured ? ' reportcard--featured' : '') + '">' +
        '<div class="reportcard__top">' +
          '<span class="badge">' + esc(r.missionArea) + '</span>' +
          '<span class="badge">' + esc(r.reportType) + '</span>' +
          (r.campaign ? '<span class="badge badge--campaign" title="Campaign / programme">' + esc(r.campaign) + '</span>' : '') +
          (r.featured ? featuredBadge() : '') +
          (showStatus ? statusBadge(r.status) : '') +
        '</div>' +
        '<h3><a href="#/report/' + esc(r.id) + '">' + title + '</a></h3>' +
        '<p class="reportcard__authors">' + esc(store.authorLine(r)) + '</p>' +
        '<p class="reportcard__abs">' + abs + '</p>' +
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

    /* No direct href: the object key never reaches the browser, and the link
       is minted per click after the server re-checks can('file:download'). */
    return '<p><button class="btn btn--primary" type="button" data-download="' + esc(r.id) + '">' +
             'Download file</button></p>' +
           '<p class="meta">' + label + '</p>' +
           '<p class="field__hint" data-download-status="' + esc(r.id) + '" hidden></p>';
  }

  /** Attach the gated-download handler to any file controls inside `root`. */
  function bindFileControl(root) {
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
    daysSince: daysSince, highlight: highlight, breadcrumbs: breadcrumbs, pager: pager,
    keywordChips: keywordChips, wireKeywordChips: wireKeywordChips,
    statusBadge: statusBadge, standingBadge: standingBadge, featuredBadge: featuredBadge,
    tagList: tagList, avatar: avatar, empty: empty, notice: notice, reportCard: reportCard,
    toast: toast, modal: modal, closeModal: closeModal, confirmDialog: confirmDialog,
    fieldError: fieldError, clearFieldError: clearFieldError, clearAllErrors: clearAllErrors,
    focusFirstError: focusFirstError, isEmail: isEmail, selectOptions: selectOptions,
    fileControl: fileControl, bindFileControl: bindFileControl
  };

})(window);
