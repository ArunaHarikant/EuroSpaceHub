/* ==========================================================================
   views/misc.js — the access-control explainer and the 404 page.

   The explainer is rendered FROM THE LIVE RULES: the workflow table below is
   built by walking store.TRANSITIONS, which is shared/policy.js, which is the
   same module the server enforces. It cannot drift from the behaviour it
   describes without the tests noticing.
   ========================================================================== */
(function (global) {
  'use strict';

  var ESH = global.ESH, ui = ESH.ui, store = ESH.store, router = ESH.router;
  var esc = ui.esc;

  /* ---------------- access-control explainer ---------------- */

  function accessModel(ctx) {
    var matrix = [
      ['The landing page and sign-in screen',       'Read', 'Read', 'Read'],
      ['Any research report, in any state',         '—', 'Own + released', 'All'],
      ['Report library (Approved / Published)',     '—', 'Read', 'Read'],
      ['Any researcher profile',                    '—', 'Colleagues, redacted', 'All, in full'],
      ['A report in Draft / Submitted / Under Review / Revisions', '—', 'Own only', 'All'],
      ['Rejected or Withdrawn records',             '—', 'Own only', 'All'],
      ['Review comments on a report',               '—', 'Own reports', 'All'],
      ['Internal supervisor comments',              '—', '—', 'Read + write'],
      ['Researcher email address and research-period dates', '—', 'Own only', 'All'],
      ['Internal notes on a researcher profile',    '—', '—', 'Read + write'],
      ['Create / edit a report',                    '—', 'Own, until review begins; and on revisions', 'Any'],
      ['Change workflow status',                    '—', 'Submit / withdraw own', 'All transitions'],
      ['Feature a report in the library',           '—', '—', 'Yes'],
      ['Delete a record permanently',               '—', '—', 'Yes'],
      ['Change own password',                       '—', 'Yes', 'Yes'],
      ['Create a researcher account',               '—', '—', 'Yes'],
      ['Issue another user a temporary password',   '—', '—', 'Yes'],
      ['Set a researcher\'s standing (active / inactive / alumnus)', '—', '—', 'Yes'],
      ['Supervisor dashboard and analytics',        '—', '—', 'Yes']
    ];

    ctx.el.innerHTML =
    '<div class="wrap wrap--900">' +
      '<p class="eyebrow">How access works</p>' +
      '<h1>Access control</h1>' +

      '<h2>One gate, enforced on the server</h2>' +
      '<p>The authorisation model is written once, in <code>shared/policy.js</code>, as a single ' +
        '<code>can(action, resource, actor)</code> function plus three derived helpers: ' +
        '<code>visibleReports()</code>, <code>visibleComments()</code> and <code>projectUser()</code>. ' +
        'That file is a <code>&lt;script&gt;</code> tag in the browser and a <code>require()</code> in ' +
        'the server — one module, one set of rules, with no client copy to drift out of sync.</p>' +
      '<p>The authority is the server. Every request loads the resource from the database, asks the ' +
        'gate whether this session\'s actor may do the thing, and only then does it; a field the ' +
        'caller may not read is <strong>absent from the response</strong> rather than hidden by the ' +
        'page. The browser runs the same checks purely as an affordance, so the interface does not ' +
        'offer actions that would be refused. If the two ever disagree, the server wins and the ' +
        'optimistic change is rolled back.</p>' +
      '<p>Two details worth naming. The library is built from the Approved/Published set directly ' +
        'rather than by filtering a privileged query, so an unapproved record cannot leak into the ' +
        'shared archive through a permission bug — it was never in the result set. And ' +
        '<code>visibleReports()</code> returns an <em>empty</em> list for a signed-out visitor rather ' +
        'than a filtered one; the server\'s <code>/bootstrap</code> likewise returns empty arrays ' +
        'rather than relying on the browser to filter.</p>' +

      ui.notice('warn', 'This hub is closed',
        'Nothing in it is public. A signed-out visitor gets the landing page and the sign-in ' +
        'screen — no reports, no report library, no researcher profiles, no names and no counts. ' +
        'Approved work is shared with the research group, not published outside it. Accounts are ' +
        'issued by the supervisor rather than applied for.') +

      '<h2>The three roles</h2>' +
      '<div class="tablewrap"><table class="data"><thead><tr>' +
        '<th scope="col">Capability</th><th scope="col">Signed-out visitor</th>' +
        '<th scope="col">Researcher</th><th scope="col">Supervisor</th>' +
      '</tr></thead><tbody>' +
      matrix.map(function (row) {
        return '<tr><td>' + esc(row[0]) + '</td>' + row.slice(1).map(function (c) {
          return '<td class="nowrap' + (c === '—' ? ' muted' : '') + '">' + esc(c) + '</td>';
        }).join('') + '</tr>';
      }).join('') +
      '</tbody></table></div>' +

      '<h2>Workflow states</h2>' +
      '<p>Draft → Submitted → Under Review → Revisions Requested → Approved → Published, with Rejected ' +
        'and Withdrawn as terminal states. Researchers may edit a record in <strong>Draft</strong> and ' +
        '<strong>Submitted</strong> — up until the supervisor opens it for review — and again in ' +
        '<strong>Revisions Requested</strong>; they may withdraw it at any point before approval. ' +
        'Only <strong>Approved</strong> and <strong>Published</strong> records reach the shared ' +
        'report library, which is itself members-only. A record that leaves those states is ' +
        'automatically unfeatured.</p>' +
      '<p class="meta">The table below is generated from the live transition rules, not written out ' +
        'by hand.</p>' +
      '<div class="tablewrap"><table class="data"><thead><tr>' +
        '<th scope="col">State</th><th scope="col">Shared?</th><th scope="col">Researcher may transition to</th>' +
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

      '<h2>Sessions and passwords</h2>' +
      '<p>The session is an <strong>httpOnly cookie</strong> backed by a row in the database. The ' +
        'browser cannot read it, and nothing in the page treats it as a credential — the client only ' +
        'ever holds a note of who the server last said you are. Passwords are hashed with scrypt and ' +
        'never leave the server; changing yours deletes every other session on your account.</p>' +
      '<p>There is <strong>no self-service reset</strong>. A reset link has to be emailed to prove you ' +
        'control the mailbox, and no mail service is configured; a form that printed its own token on ' +
        'the page would be an account-takeover hole rather than a password reset. The supervisor ' +
        'issues a replacement from your profile and hands it over directly, which is an auditable act. ' +
        'For a closed group of this size that is arguably the right mechanism to keep even once email ' +
        'works.</p>' +

      '<h2>Files</h2>' +
      '<p>Report files live in a <strong>private Backblaze B2 bucket</strong>. Uploads go from your ' +
        'browser to B2 directly, through a short-lived signed PUT that this server minted against a ' +
        'single-use record binding the key to one report and one user; the server then confirms the ' +
        'object before recording it. Downloads are signed GETs issued only after the gate passes. ' +
        'The bytes never touch the application host, and B2 object keys are never sent to the ' +
        'browser — the page asks for a file by report id and the server resolves the key itself.</p>' +

      '<div class="btn-row"><a class="btn btn--primary" href="#/">Return to the hub</a></div>' +
    '</div>';
  }

  /* ---------------- 404 ---------------- */

  function notFound(ctx) {
    ctx.el.innerHTML = '<div class="wrap wrap--640">' +
      '<h1>Page not found</h1>' +
      '<p class="lede">No section of the Research Hub matches <code>' + esc(router.parse().raw) + '</code>.</p>' +
      '<div class="btn-row"><a class="btn btn--primary" href="#/">Hub home</a>' +
      '<a class="btn" href="#/library">Report library</a></div></div>';
  }

  ESH.views = ESH.views || {};
  ESH.views.accessModel = accessModel;
  ESH.views.notFound = notFound;

})(window);
