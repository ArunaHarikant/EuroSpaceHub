/* ==========================================================================
   views/misc.js — the access-control explainer and the 404 page.
   ========================================================================== */
(function (global) {
  'use strict';

  var ESH = global.ESH, ui = ESH.ui, store = ESH.store, auth = ESH.auth, router = ESH.router;
  var esc = ui.esc;

  /* ---------------- access-control explainer ---------------- */

  function aboutDemo(ctx) {
    var matrix = [
      ['Prof. Foing\'s profile page (bio + sign-in)','Read', 'Read', 'Read'],
      ['Any research report, in any state',         '—', 'Own + released', 'All'],
      ['Report library (Approved / Published)',     '—', 'Read', 'Read'],
      ['Any researcher profile',                    '—', 'Colleagues, redacted', 'All, in full'],
      ['A report in Draft / Submitted / Under Review / Revisions', '—', 'Own only', 'All'],
      ['Rejected or Withdrawn records',             '—', 'Own only', 'All'],
      ['Review comments on a report',               '—', 'Own reports', 'All'],
      ['Internal supervisor comments',              '—', '—', 'Read + write'],
      ['Intern email address and research-period dates', '—', 'Own only', 'All'],
      ['Internal notes on an intern profile',       '—', '—', 'Read + write'],
      ['Create / edit a report',                    '—', 'Own, until review begins; and on revisions', 'Any'],
      ['Change workflow status',                    '—', 'Submit / withdraw own', 'All transitions'],
      ['Feature a report in the library',           '—', '—', 'Yes'],
      ['Set an intern\'s standing (active / inactive / alumnus)', '—', '—', 'Yes'],
      ['Supervisor dashboard and analytics',        '—', '—', 'Yes']
    ];

    ctx.el.innerHTML =
    '<div class="wrap" style="max-width:900px">' +
      '<p class="eyebrow">Build notes</p>' +
      '<h1>Access control in this build</h1>' +

      ui.notice('danger', 'This build does not implement real authentication',
        'There is no server, no session token, no password hashing and no server-side enforcement. ' +
        'Sign-in compares a plaintext password held in <code>localStorage</code>, and the "session" is a ' +
        'user id in the same store — anyone with the browser devtools open can change it. ' +
        'Treat every rule below as a <em>specification</em> that a real backend would enforce, not as a ' +
        'security boundary that this page enforces.') +

      '<h2>What is real here</h2>' +
      '<p>The authorisation model is written once, in <code>assets/js/auth.js</code>, as a single ' +
        '<code>can(action, resource, actor)</code> function plus three derived helpers: ' +
        '<code>visibleReports()</code>, <code>visibleComments()</code> and <code>projectUser()</code>. ' +
        'No view queries the data store directly for anything privileged — list views derive from ' +
        '<code>visibleReports()</code>, comment threads from <code>visibleComments()</code>, and intern ' +
        'records are projected through <code>projectUser()</code> before rendering. Route access is gated ' +
        'by <code>guard()</code>, and every mutating control re-checks <code>can()</code> before it writes, ' +
        'so the route guard is never the only thing standing between a role and a change.</p>' +
      '<p>That means porting to a real backend is a substitution rather than a rewrite: replace the stub ' +
        'session with a real one, and re-implement <code>can()</code> server-side against the same action ' +
        'names. The library view is deliberately built from the Approved/Published set directly ' +
        'rather than from a filtered privileged query, so a permission bug cannot leak an unapproved ' +
        'record into the shared archive; and <code>visibleReports()</code> returns an ' +
        '<em>empty</em> list for a signed-out visitor rather than a filtered one.</p>' +

      ui.notice('warn', 'This hub is closed',
        'Nothing in it is public. A signed-out visitor gets Prof. Foing\'s profile page and the ' +
        'sign-in screen — no reports, no report library, no researcher profiles, no names and ' +
        'no counts. Approved work is shared with the research group, not published outside it.') +

      '<h2>The three roles</h2>' +
      '<div class="tablewrap"><table class="data"><thead><tr>' +
        '<th scope="col">Capability</th><th scope="col">Signed-out visitor</th>' +
        '<th scope="col">Intern / student researcher</th><th scope="col">Supervisor</th>' +
      '</tr></thead><tbody>' +
      matrix.map(function (row) {
        return '<tr><td>' + esc(row[0]) + '</td>' + row.slice(1).map(function (c) {
          return '<td class="nowrap' + (c === '—' ? ' muted' : '') + '">' + esc(c) + '</td>';
        }).join('') + '</tr>';
      }).join('') +
      '</tbody></table></div>' +

      '<h2>Workflow states</h2>' +
      '<p>Draft → Submitted → Under Review → Revisions Requested → Approved → Published, with Rejected ' +
        'and Withdrawn as terminal states. Interns may edit a record in <strong>Draft</strong> and ' +
        '<strong>Submitted</strong> — up until the supervisor opens it for review — and again in ' +
        '<strong>Revisions Requested</strong>; they may withdraw it at any point before approval. ' +
        'Only <strong>Approved</strong> and <strong>Published</strong> records reach the shared ' +
        'report library, which is itself members-only. A record that leaves those states is ' +
        'automatically unfeatured.</p>' +
      '<div class="tablewrap"><table class="data"><thead><tr>' +
        '<th scope="col">State</th><th scope="col">Shared?</th><th scope="col">Intern may transition to</th>' +
        '<th scope="col">Supervisor may transition to</th></tr></thead><tbody>' +
      store.STATUS_ORDER.map(function (k) {
        var t = store.TRANSITIONS[k];
        var lab = function (arr) {
          return arr.length ? arr.map(function (x) { return store.STATUSES[x].label; }).join(', ') : '—';
        };
        return '<tr><td class="nowrap">' + ui.statusBadge(k) + '</td>' +
          '<td class="nowrap">' + (store.STATUSES[k].released ? 'Yes' : 'No') + '</td>' +
          '<td>' + esc(lab(t.intern)) + '</td><td>' + esc(lab(t.supervisor)) + '</td></tr>';
      }).join('') + '</tbody></table></div>' +

      '<h2>Data and files</h2>' +
      '<p>All records live in <code>localStorage</code> under the key <code>' + esc(store.KEY) + '</code>. ' +
        'Uploaded files are <strong>not</strong> persisted: browser storage cannot hold PDFs, so only a ' +
        'file\'s name, size and type are saved and the binary is kept in memory for the current tab. ' +
        'Downloads work until you reload, after which the record shows the metadata and says the file is ' +
        'unavailable — silently dropping the upload would have been the worse choice.</p>' +
      '<p>Use <em>Reset demo data</em> in the footer to restore the seeded state at any time.</p>' +

      '<h2>Placeholder content</h2>' +
      '<p>Prof. Foing\'s biography, titles and publication figures are limited to the publicly documented ' +
        'record. Every intern, report, abstract and comment in the seed data is an explicit placeholder — ' +
        'no real people and no real unpublished research are represented.</p>' +

      '<div class="btn-row"><a class="btn btn--primary" href="#/">Return to the hub</a>' +
        '<a class="btn" href="#/signin">Try the role switcher</a></div>' +
    '</div>';
  }

  /* ---------------- 404 ---------------- */

  function notFound(ctx) {
    ctx.el.innerHTML = '<div class="wrap" style="max-width:640px">' +
      '<h1>Page not found</h1>' +
      '<p class="lede">No section of the Research Hub matches <code>' + esc(router.parse().raw) + '</code>.</p>' +
      '<div class="btn-row"><a class="btn btn--primary" href="#/">Hub home</a>' +
      '<a class="btn" href="#/library">Report library</a></div></div>';
  }

  ESH.views = ESH.views || {};
  ESH.views.aboutDemo = aboutDemo;
  ESH.views.notFound = notFound;

})(window);
