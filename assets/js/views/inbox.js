/* ==========================================================================
   views/inbox.js — the "waiting on you" notification inbox.

   MEMBERS ONLY — route-guarded to authenticated users. The list is derived on
   the fly by auth.notificationsFor(actor) from report history and comments
   (there is no separate notification store, and no email — this is stated on
   the page). Visiting the inbox marks everything seen; the header bell count
   then clears via the chrome re-render that the router runs after this view.
   ========================================================================== */
(function (global) {
  'use strict';

  var ESH = global.ESH, ui = ESH.ui, store = ESH.store, auth = ESH.auth, router = ESH.router;
  var esc = ui.esc;

  function render(ctx) {
    var u = auth.user();
    if (!u) { router.navigate('#/signin', true); return; }

    var items = auth.notificationsFor(u);   /* computed BEFORE marking seen */
    var sup = u.role === 'supervisor';

    ctx.el.innerHTML =
    '<div class="wrap wrap--680">' +
      '<p class="eyebrow">Notifications</p>' +
      '<h1>Your inbox</h1>' +
      '<p class="lede">Updates on ' +
        (sup ? 'your researchers’ submissions and replies' : 'your reports and their reviews') +
        '. This is derived from activity in the hub — nothing is emailed.</p>' +
      (items.length
        ? '<ul class="timeline">' + items.map(function (it) {
            return '<li>' +
              '<time datetime="' + esc(it.at) + '">' + esc(ui.fmtDateTime(it.at)) + '</time>' +
              '<strong>' +
                (it.unread ? '<span class="notif-dot" aria-label="unread"></span>' : '') +
                esc(it.text) +
              '</strong>' +
              '<div class="meta"><a href="#/report/' + esc(it.reportId) + '">Open the record &rarr;</a></div>' +
            '</li>';
          }).join('') + '</ul>'
        : ui.empty('Nothing new',
            sup ? 'When your researchers submit work or reply to a review, it appears here.'
                : 'When your reports are reviewed or commented on, it appears here.')) +
    '</div>';

    /* Mark seen now; the router's afterRender → renderChrome recomputes the bell. */
    store.markNotificationsSeen(u.id);
  }

  ESH.views = ESH.views || {};
  ESH.views.inbox = render;

})(window);
