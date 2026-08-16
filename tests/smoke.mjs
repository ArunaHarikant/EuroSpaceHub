/* Headless smoke test for the Lunar & Mars Research Hub.
 *
 * Loads the real page over HTTP in jsdom, walks every route as each role, and
 * asserts on both rendered output and the permission rules.
 *
 *   npm install jsdom              # one dependency, test-only
 *   node tests/smoke.mjs           # self-hosts its own server; nothing else needed
 *
 * The suite starts its own Node HTTP server (keep-alive, so jsdom's ~17
 * concurrent script fetches reuse a handful of sockets) instead of relying on
 * `python -m http.server`, whose HTTP/1.0 socket-per-request behaviour made the
 * loader drop scripts under repeated runs.
 */
import { JSDOM, VirtualConsole } from 'jsdom';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize } from 'node:path';

const ROOT = normalize(join(dirname(fileURLToPath(import.meta.url)), '..'));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const full = normalize(join(ROOT, p));
    if (!full.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    const buf = await readFile(full);
    res.writeHead(200, { 'Content-Type': MIME[full.slice(full.lastIndexOf('.'))] || 'application/octet-stream' });
    res.end(buf);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + server.address().port + '/';
let pass = 0, fail = 0;

/* jsdom does not implement window.scrollTo; the router calls it after every
   render. That is a harness limitation, not an application error. */
const IGNORED = /Not implemented: Window's (scrollTo|scroll|scrollBy)/;

function ok(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  → ' + extra : '')); }
}

async function waitFor(pred, timeoutMs = 6000, stepMs = 15) {
  const start = Date.now();
  for (;;) {
    try { if (pred()) return true; } catch { /* not ready yet */ }
    if (Date.now() - start >= timeoutMs) return false;
    await new Promise(r => setTimeout(r, stepMs));
  }
}

/* Every view module must have registered its renderer before the walk begins.
   The page pulls in 15 classic scripts over HTTP; if jsdom's resource loader
   drops any one of them, that view's `ESH.views.*` is missing and every route
   using it throws "r.render is not a function" mid-suite. We therefore gate on
   ALL views being present, and if a script failed to load we retry the whole
   boot with a fresh jsdom rather than run against a half-loaded page. */
const REQUIRED_VIEWS = ['foing','library','report','reportEdit','submit','profile',
  'profileEdit','me','inbox','dashboard','signin','register','reset','aboutDemo','denied','notFound'];

async function bootOnce() {
  const errs = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => { const m = e.stack || e.message; if (!IGNORED.test(m)) errs.push('jsdomError: ' + m); });
  vc.on('error', (...a) => errs.push('console.error: ' + a.join(' ')));

  const dom = await JSDOM.fromURL(BASE, {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
  });
  const { window } = dom;
  await new Promise(res => {
    if (window.document.readyState === 'complete') return res();
    window.addEventListener('load', res);
  });
  window.URL.createObjectURL = () => 'blob:stub';   // jsdom lacks it; store uses it on upload

  const ready = await waitFor(() => {
    const E = window.ESH;
    return E && E.store && E.auth && E.router && E.exporter &&
      E.charts && typeof E.charts.columnChart === 'function' && E.views &&
      REQUIRED_VIEWS.every(v => typeof E.views[v] === 'function') &&
      window.document.getElementById('view').children.length > 0;
  });
  return { dom, window, errs, ready };
}

let dom, window, errors;
{
  const MAX_ATTEMPTS = 5;
  let attempt = 0, res;
  do {
    res = await bootOnce();
    attempt++;
    if (res.ready) break;
    console.log('  (boot attempt ' + attempt + ' incomplete — a script resource failed to load; retrying)');
    res.dom.window.close();
  } while (attempt < MAX_ATTEMPTS);

  if (!res.ready) {
    console.log('  FATAL: app did not finish booting after ' + attempt + ' attempts');
    console.log('    captured: ' + (res.errs.slice(0, 8).join(' | ') || 'none'));
    process.exit(1);
  }
  dom = res.dom; window = res.window; errors = res.errs;
}

const { ESH } = window;
ok('ESH namespace present', !!ESH);
ok('store/auth/router/views loaded', !!(ESH.store && ESH.auth && ESH.router && ESH.views));

const view = () => window.document.getElementById('view');
const text = () => view().textContent.replace(/\s+/g, ' ');
const html = () => view().innerHTML;

function goto(hash) {
  window.location.hash = hash;
  ESH.router.resolve();
}

function section(name) { console.log('\n— ' + name); }

/* ================= SIGNED-OUT VISITOR =================
   The hub is closed. The ONLY things reachable without a session are Prof.
   Foing's profile page and the sign-in / registration screens. */
section('Signed-out visitor');
ESH.auth.signOut();
goto('#/');
ok('landing renders Foing hub', /Lunar & Mars Research Hub/.test(text()));
/* The landing page is a gateway now: no biography, no titles, no figures. */
ok('no role titles on the landing page',
   !/Executive Director/.test(text()) && !/Principal Project Scientist/.test(text()) &&
   !/Co-Investigator/.test(text()) && !/Research Professor/.test(text()));
ok('no biography section', !/Biography/.test(text()) && !/CNRS/.test(text()));
ok('no publication figures',
   !/400/.test(text()) && !/refereed/.test(text()) && !/Record at a glance/.test(text()));
ok('no research-focus tags', !/Research focus/.test(text()) && !/Astrobiology/.test(text()));
ok('no portrait placeholder', !/Portrait placeholder/.test(text()));
ok('the hub is still named', /Lunar & Mars Research Hub/.test(text()));
ok('landing says the hub is private', /This research hub is private/.test(text()));

/* --- nothing about the work leaks onto the only public page --- */
ok('no report titles on the landing page',
   !ESH.store.reports().some(r => text().includes(r.title)));
ok('no researcher names on the landing page',
   !ESH.store.interns().some(u => text().includes(u.fullName)));
ok('no researcher profile links on the landing page', !/#\/researcher\//.test(html()));
ok('no report links on the landing page', !/#\/report\//.test(html()));
ok('no record counts on the landing page', !/\d+ records?\b/.test(text()));
ok('no "Featured" leaks', !/Featured/.test(text()));
ok('subnav hides the library when signed out',
   !/Report library/.test(window.document.getElementById('subnav').textContent));
ok('subnav hides the dashboard when signed out',
   !/Supervisor dashboard/.test(window.document.getElementById('subnav').textContent));

/* --- the permission layer itself returns nothing --- */
ok('visibleReports() is EMPTY for a signed-out visitor',
   ESH.auth.visibleReports().length === 0);
ok('no report is readable without a session',
   ESH.store.reports().every(r => !ESH.auth.can('report:read', r)));
ok('no profile is readable without a session',
   ESH.store.interns().every(u => !ESH.auth.can('user:read', u)));
ok('library:view denied without a session', !ESH.auth.can('library:view', null));

/* --- and every route bounces to sign-in --- */
for (const route of ['#/library', '#/report/r_1', '#/researcher/u_i1', '#/dashboard', '#/submit',
                     '#/me', '#/report/r_1/edit', '#/researcher/u_i1/edit']) {
  goto(route);
  ok('signed out is bounced from ' + route, window.location.hash.startsWith('#/signin'),
     'landed on ' + window.location.hash);
}

goto('#/about-demo');
ok('access-control page renders', /Access control in this build/.test(text()));
ok('access page states auth is not real', /does not implement real authentication/i.test(text()));
ok('access page states the hub is closed', /This hub is closed/.test(text()));

goto('#/totally-unknown');
ok('404 renders', /Page not found/.test(text()));

goto('#/contact');
ok('enquiry route removed (404s)', /Page not found/.test(text()));
ok('no enquiry link anywhere in the shell',
   !/#\/contact/.test(window.document.body.innerHTML));
ok('enquiry storage removed from the model',
   ESH.store.addEnquiry === undefined && ESH.store.enquiries === undefined);
ok('publicProfile removed from the model',
   ESH.store.users().every(u => u.publicProfile === undefined));
ok('the "public" vocabulary is gone from the store',
   ESH.store.isPublic === undefined && ESH.store.publicReports === undefined &&
   typeof ESH.store.isReleased === 'function' && typeof ESH.store.releasedReports === 'function');

/* ================= INTERN ================= */
section('Intern (Intern Name A / u_i1)');
ESH.auth.assume('u_i1');

/* the shared library, now members-only */
goto('#/library');
const relCount = ESH.store.releasedReports().length;
ok('library lists only released records (' + relCount + ')',
   view().querySelectorAll('article.reportcard').length === relCount);
ok('library excludes draft record', !/Sample Draft/.test(text()));
ok('library excludes withdrawn record', !/Sample Withdrawn/.test(text()));
ok('library excludes under-review record', !/Sample Dataset Description/.test(text()));
ok('library is labelled members-only', /Members only/i.test(text()));
goto('#/library?area=Mars');
ok('library area filter works', !/Regolith/.test(text()) && /Stereo-Derived/.test(text()));
goto('#/library?type=' + encodeURIComponent('Analogue mission report'));
ok('library type filter works', /Analogue Mission Report/i.test(text()));
goto('#/library?q=zzzznomatch');
ok('library empty state', /No records match/.test(text()));

goto('#/report/r_1');
ok('member can open a released report', /Geotechnical Characterisation/.test(text()));
ok('member sees no internal comment', !/suitable candidate for the next ILEWG/.test(text()));

goto('#/report/r_8');   // another intern's draft
ok('intern blocked from a colleague draft', /do not have access/i.test(text()));
goto('#/report/nope');
ok('unknown report id handled', /Record not found/.test(text()));

goto('#/researcher/u_i4');
ok('colleague profile renders for a member', /Intern Name D/.test(text()));
ok('colleague profile hides email', !/intern\.d@demo/.test(html()));
ok('colleague profile hides research period dates', !/Period/.test(text()));
ok('colleague profile shows only shared outputs', /Shared research outputs/.test(text()));

goto('#/me');
ok('own profile renders', /Intern Name A/.test(text()));
ok('own profile shows email', /intern\.a@demo/.test(html()));
ok('own profile shows research period', /Period/.test(text()));
ok('own profile shows all own submissions', /Submissions \(all states\)/.test(text()));
ok('own profile shows activity timeline', /Activity/.test(text()));
ok('intern cannot see own internal notes', !/strong analytical work/.test(text()));
ok('intern has no supervisor panel', !/Supervisor-only/.test(text()));

goto('#/researcher/u_i2');
ok('intern viewing another profile: no email', !/intern\.b@demo/.test(html()));
ok('intern viewing another profile: shared outputs only', /Shared research outputs/.test(text()));
ok('intern viewing another profile: no internal note', !/requested extension/.test(text()));

goto('#/report/r_5');   // u_i2's under-review record
ok('intern blocked from another intern\'s unreleased record', /do not have access/i.test(text()));

goto('#/report/r_6');   // own, revisions requested
ok('intern opens own revisions-requested record', /ISRU Trade Study/.test(text()));
ok('intern sees review comments on own record', /Review correspondence/.test(text()));
ok('intern sees the reviewer comment', /trade criteria need explicit weighting/.test(text()));
ok('intern sees workflow panel on own record', /Workflow/.test(text()));
ok('intern can edit in Revisions Requested', /Edit this record/.test(html()));
ok('intern transitions offered: submit + withdraw',
   /value="submitted"/.test(html()) && /value="withdrawn"/.test(html()));
ok('intern NOT offered approve/publish',
   !/value="approved"/.test(html()) && !/value="published"/.test(html()));
ok('intern has no feature control', !/featureToggle/.test(html()));
ok('intern has no delete control', !/deleteReport/.test(html()));
ok('intern has no internal-note checkbox', !/Internal note/.test(text()));

/* --- editing and withdrawing a Submitted record (Intern Name C owns r_7) --- */
ESH.auth.assume('u_i3');
goto('#/me');
ok('profile table has per-row actions', /Actions/.test(text()));
ok('Edit offered for a Submitted record', /#\/report\/r_7\/edit/.test(html()));
ok('Withdraw offered for a Submitted record', /data-withdraw="r_7"/.test(html()));
ok('no Withdraw on a terminal record', !/data-withdraw="r_9"/.test(html()));
{
  const r7 = ESH.store.reportById('r_7');
  ok('intern may edit own Submitted record', ESH.auth.can('report:edit', r7));
  ok('intern may withdraw own Submitted record', ESH.auth.canTransition(r7, 'withdrawn'));
}
goto('#/report/r_7/edit');
ok('edit form opens for a Submitted record', /Edit research report/.test(text()));
{
  const f = window.document.getElementById('repForm');
  /* keep the original title text: a later dashboard-filter assertion matches on it */
  f.elements.title.value = 'Sample Technical Note — Placeholder Dust Mitigation Concepts (edited after submission)';
  f.querySelector('button[value="save"]').click();
  if (ESH.store.reportById('r_7').title.indexOf('edited') === -1) {
    f.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  }
  const r7 = ESH.store.reportById('r_7');
  ok('edit saved', /edited after submission/.test(r7.title));
  ok('editing does not change the workflow state', r7.status === 'submitted');
  ok('the edit is recorded in the history',
     r7.history.some(h => /updated/i.test(h.note || '')));
}
ESH.store.setStatus('r_7', 'withdrawn', 'u_i3', 'test withdraw');
{
  const r7 = ESH.store.reportById('r_7');
  ok('withdrawn record is not released', !ESH.store.isReleased(r7));
  ok('withdrawn record is no longer editable', !ESH.auth.can('report:edit', r7));
  ok('withdrawn is terminal for the intern', ESH.auth.allowedTransitions(r7).length === 0);
}

/* --- but Under Review locks editing (Intern Name B owns r_5) --- */
ESH.auth.assume('u_i2');
{
  const r5 = ESH.store.reportById('r_5');
  ok('intern may NOT edit own Under Review record', !ESH.auth.can('report:edit', r5));
  ok('intern may still withdraw own Under Review record', ESH.auth.canTransition(r5, 'withdrawn'));
}
goto('#/report/r_5/edit');
ok('edit route blocked while Under Review', /Editing is locked/.test(text()));

ESH.auth.assume('u_i1');
goto('#/report/r_1');   // own, published
ok('intern cannot edit a published record', !/Edit this record/.test(html()));
ok('intern told editing is locked', /Editing is locked/.test(text()));
ok('intern cannot see internal comment on own record', !/suitable candidate for the next ILEWG/.test(text()));
ok('intern DOES see the non-internal review comment', /expand the discussion of simulant fidelity/.test(text()));

goto('#/report/r_1/edit');
ok('intern edit route blocked for published record', /Editing is locked/.test(text()));

goto('#/dashboard');
ok('intern denied the dashboard', window.location.hash.startsWith('#/denied'));
goto('#/denied');
ok('denied page renders', /Access denied/.test(text()));

goto('#/submit');
ok('submission form renders for intern', /Submit a research report/.test(text()));
ok('form has all required fields',
   ['sTitle','sArea','sType','sAbs','sKw','sCoFree','sFile','sData']
     .every(id => !!window.document.getElementById(id)));
ok('mission areas complete',
   ESH.store.MISSION_AREAS.every(a => html().includes('>' + a + '<')));
ok('report types complete',
   ESH.store.REPORT_TYPES.every(t => html().includes('>' + t + '<')));
ok('file input accepts pdf/docx/pptx',
   /accept="[^"]*\.pdf[^"]*\.docx[^"]*\.pptx/.test(html()));

/* submit a report end-to-end */
{
  const f = window.document.getElementById('repForm');
  f.elements.title.value = 'Verification Record — Placeholder';
  f.elements.missionArea.value = 'Mars';
  f.elements.reportType.value = 'Technical report';
  f.elements.abstract.value = Array(60).fill('placeholder').join(' ');
  f.elements.keywords.value = 'alpha, beta';
  f.elements.coAuthorsFree.value = 'External Person';
  const before = ESH.store.reports().length;
  f.querySelector('button[value="submit"]').click();      // sets intent + submits
  if (ESH.store.reports().length === before) {            // jsdom may not auto-submit
    f.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  }
  const after = ESH.store.reports();
  ok('report created (exactly one)', after.length === before + 1,
     'created ' + (after.length - before));
  const rec = after[after.length - 1];
  ok('report owned by the intern', rec.ownerId === 'u_i1');
  ok('report moved to Submitted', rec.status === 'submitted');
  ok('submittedAt stamped', !!rec.submittedAt);
  ok('history recorded', rec.history.length >= 2);
  ok('co-author captured', rec.coAuthors.some(c => c.name === 'External Person'));
  ok('not in the shared library yet', !ESH.store.isReleased(rec));
  window.__newId = rec.id;
}

/* abstract length validation */
goto('#/submit');
{
  const f = window.document.getElementById('repForm');
  f.elements.title.value = 'Too short';
  f.elements.abstract.value = 'five words only right here';
  f.querySelector('button[value="submit"]').click();
  f.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  ok('short abstract rejected on submit', /at least 40 words/.test(view().textContent));
}

/* ================= SUPERVISOR ================= */
section('Supervisor (Prof. Foing)');
ESH.auth.assume(ESH.store.SUPERVISOR_ID);
goto('#/dashboard');
ok('dashboard renders', /Research supervision dashboard/.test(text()));
ok('dashboard has both charts',
   /Reports by workflow state/.test(text()) && /Reports by mission area/.test(text()));
ok('charts use the two validated hues',
   html().includes('var(--series-1)') && html().includes('var(--series-2)'));
ok('charts expose a table view', (html().match(/View as table/g) || []).length === 3);
ok('stat tiles present',
   /Researchers/.test(text()) && /Awaiting your action/.test(text()) && /Shared records/.test(text()));
ok('dashboard lists every report',
   ESH.store.reports().every(r => html().includes('#/report/' + r.id)));
ok('dashboard shows the draft record', /Sample Draft/.test(text()));
ok('dashboard shows the withdrawn record', /Sample Withdrawn/.test(text()));
ok('sortable column headers', (html().match(/data-sort=/g) || []).length >= 7);
ok('bulk action controls', /Bulk actions/.test(text()) && !!window.document.getElementById('bulkApply'));
ok('search box present', !!window.document.getElementById('dq'));
ok('researcher roster present', /Researchers/.test(text()) && /Standing/.test(text()));
ok('roster shows intern emails to supervisor', /intern\.a@demo/.test(html()));

goto('#/dashboard?status=review');
ok('dashboard status filter works',
   /Sample Dataset Description/.test(text()) && !/Sample Draft/.test(text()));
goto('#/dashboard?intern=u_i3');
ok('dashboard researcher filter works', /Dust Mitigation/.test(text()) && !/Regolith/.test(text()));
goto('#/dashboard?q=volatiles');
ok('dashboard search works', /Polar Volatile/.test(text()));

goto('#/report/r_1');
ok('supervisor sees the internal comment', /suitable candidate for the next ILEWG/.test(text()));
ok('supervisor has the feature toggle', /featureToggle/.test(html()));
ok('supervisor has the delete control', /deleteReport/.test(html()));
ok('supervisor can write internal notes', /Internal note/.test(text()));
ok('supervisor sees status history', /Status history/.test(text()));

goto('#/researcher/u_i1');
ok('supervisor sees the supervisor-only panel', /Supervisor-only/.test(text()));
ok('supervisor sees internal notes', /strong analytical work/.test(html()));
ok('supervisor sees standing control', !!window.document.getElementById('standingSel'));
ok('supervisor sees full submission history', /Submissions \(all states\)/.test(text()));

/* drive a full workflow on the intern's new submission */
{
  const id = window.__newId;
  const sup = ESH.store.SUPERVISOR_ID;
  const r0 = ESH.store.reportById(id);
  ok('supervisor can move Submitted → Under Review', ESH.auth.canTransition(r0, 'review'));
  ESH.store.setStatus(id, 'review', sup, 'test');
  ok('supervisor can request revisions', ESH.auth.canTransition(ESH.store.reportById(id), 'revisions'));
  ESH.store.setStatus(id, 'revisions', sup, 'test');
  ESH.store.setStatus(id, 'review', sup, 'test');
  ESH.store.setStatus(id, 'approved', sup, 'test');
  ok('approved record is released', ESH.store.isReleased(ESH.store.reportById(id)));
  ESH.store.setStatus(id, 'published', sup, 'test');
  ok('published record is released', ESH.store.isReleased(ESH.store.reportById(id)));
  ESH.store.updateReport(id, { featured: true });
  ok('can feature a published record',
     ESH.auth.can('report:feature', ESH.store.reportById(id)));
  ESH.store.setStatus(id, 'approved', sup, 'unpublish');
  ESH.store.setStatus(id, 'rejected', sup, 'test');
  const rej = ESH.store.reportById(id);
  ok('rejected record is not released', !ESH.store.isReleased(rej));
  ok('rejecting auto-unfeatures the record', rej.featured === false);
  ok('rejected is terminal for supervisor', ESH.auth.allowedTransitions(rej).length === 0);
  ESH.auth.assume('u_i1');
  ok('rejected is terminal for the intern too', ESH.auth.allowedTransitions(rej).length === 0);
  ok('intern cannot edit a rejected record', !ESH.auth.can('report:edit', rej));
  ESH.auth.assume(ESH.store.SUPERVISOR_ID);
}

/* co-supervisor extensibility */
section('Co-supervisor');
ESH.auth.assume('u_cosup');
goto('#/dashboard');
ok('co-supervisor reaches the dashboard', /Research supervision dashboard/.test(text()));
goto('#/report/r_8');
ok('co-supervisor sees a draft record', /Placeholder Calibration Procedure/.test(text()));

/* registration */
section('Registration');
ESH.auth.signOut();
goto('#/register');
ok('registration form renders', /Create a researcher profile/.test(text()));
ok('supervisor field is locked to Foing',
   /id="rSup"[^>]*disabled/.test(html()) && /Prof\. Bernard Foing/.test(html()));
ok('institution is free text with suggestions',
   /<datalist id="instList"/.test(html()) &&
   ['International Space University','Vrije Universiteit Amsterdam','Florida Institute of Technology']
     .every(i => html().includes(i)));
ok('optional link fields present',
   ['rLi','rOr','rWeb','rPhoto'].every(id => !!window.document.getElementById(id)));
{
  const f = window.document.getElementById('regForm');
  f.elements.fullName.value = 'Verification Intern';
  f.elements.email.value = 'verify@demo.local';
  f.elements.password.value = 'demo';
  f.elements.institution.value = 'Partner University';
  f.elements.startDate.value = '2026-01-05';
  f.elements.endDate.value = '2025-01-05';     // invalid: before start
  f.elements.researchTopic.value = 'Testing';
  f.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  ok('end-before-start rejected', /cannot precede the start date/.test(view().textContent));
  f.elements.endDate.value = '2026-06-05';
  const before = ESH.store.users().length;
  f.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  ok('account created', ESH.store.users().length === before + 1);
  ok('new account is an intern supervised by Foing', (() => {
    const u = ESH.store.userByEmail('verify@demo.local');
    return u && u.role === 'intern' && u.supervisorId === ESH.store.SUPERVISOR_ID;
  })());
  ok('auto signed-in after registration', ESH.auth.user()?.email === 'verify@demo.local');
}

/* credential sign-in */
section('Sign-in');
ESH.auth.signOut();
ok('bad password rejected', ESH.auth.signIn('intern.a@demo.eurospacehub.local', 'wrong').ok === false);
ok('unknown email rejected', ESH.auth.signIn('nobody@example.com', 'demo').ok === false);
ok('valid credentials accepted', ESH.auth.signIn('intern.a@demo.eurospacehub.local', 'demo').ok === true);

/* the removed enquiry block used to leave the session as supervisor */
ESH.auth.signOut();

/* ================= PASSWORD RESET ================= */
section('Password reset');
ESH.auth.signOut();

goto('#/signin');
ok('sign-in offers a forgotten-password link', /#\/reset/.test(html()));

goto('#/reset');
ok('reset request form renders', /Reset your password/.test(text()));
ok('reset page states no email is sent', /No email is sent in this build/.test(text()));

/* unknown address: neutral response, no token, no account enumeration */
{
  const f = window.document.getElementById('resetReqForm');
  f.elements.email.value = 'nobody@example.com';
  f.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  const out = window.document.getElementById('resetOut');
  ok('unknown address is told so, honestly', /No account found for that address/.test(out.textContent));
  ok('unknown address explains per-browser storage', /localStorage/.test(out.textContent));
  ok('unknown address yields no reset link', !/#\/reset\?token=/.test(out.innerHTML));
}

/* known address: same neutral message, plus the demo link */
let resetToken = null;
{
  goto('#/reset');
  const f = window.document.getElementById('resetReqForm');
  f.elements.email.value = 'intern.a@demo.eurospacehub.local';
  f.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  const out = window.document.getElementById('resetOut');
  ok('known address is told no email was sent', /No email was sent/.test(out.textContent));
  ok('no message claims an email was delivered', !/has been sent to it/.test(out.textContent));
  const m = out.innerHTML.match(/#\/reset\?token=([a-z0-9]+)/);
  ok('a reset token was issued', !!m);
  resetToken = m && m[1];
  ok('token is long enough to be unguessable', !!resetToken && resetToken.length >= 20);
  ok('token is exactly 24 characters', !!resetToken && resetToken.length === 24);
  ok('token uses only the unambiguous alphabet (no l/o/0/1)',
     !!resetToken && /^[abcdefghijkmnpqrstuvwxyz23456789]+$/.test(resetToken));
  const u = ESH.store.userByEmail('intern.a@demo.eurospacehub.local');
  ok('token is stored against the account', u.resetToken === resetToken);
  ok('token carries an expiry', !!u.resetExpires && new Date(u.resetExpires) > new Date());
}

goto('#/reset?token=totallybogustoken');
ok('a bogus token is rejected', /not valid/i.test(text()));

/* spend the token */
goto('#/reset?token=' + resetToken);
ok('valid token opens the new-password form', /Choose a new password/.test(text()));
{
  const f = window.document.getElementById('resetSetForm');
  f.elements.password.value = 'abc';
  f.elements.confirm.value = 'abc';
  f.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  ok('short password rejected', /at least 4 characters/.test(view().textContent));
  f.elements.password.value = 'newpassword1';
  f.elements.confirm.value = 'mismatch';
  f.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  ok('mismatched confirmation rejected', /do not match/.test(view().textContent));
  f.elements.confirm.value = 'newpassword1';
  f.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
}
ok('password was changed', ESH.auth.signIn('intern.a@demo.eurospacehub.local', 'newpassword1').ok === true);
ok('old password no longer works',
   ESH.auth.signIn('intern.a@demo.eurospacehub.local', 'demo').ok === false);
{
  const u = ESH.store.userByEmail('intern.a@demo.eurospacehub.local');
  ok('token cleared after use', u.resetToken === undefined);
  ok('password change is timestamped', !!u.passwordChangedAt);
}
ESH.auth.signOut();
goto('#/reset?token=' + resetToken);
ok('a spent token cannot be reused', /not valid/i.test(text()));

/* expiry is enforced */
{
  const issued = ESH.store.requestPasswordReset('intern.b@demo.eurospacehub.local');
  const u = ESH.store.userByEmail('intern.b@demo.eurospacehub.local');
  u.resetExpires = new Date(Date.now() - 1000).toISOString();
  ESH.store.save();
  goto('#/reset?token=' + issued.token);
  ok('an expired token is rejected', /expired/i.test(text()));
  ok('expired token does not open the form', !window.document.getElementById('resetSetForm'));
}

/* signed-in users are sent elsewhere */
ESH.auth.assume('u_i3');
goto('#/reset');
ok('signed-in users are not shown the reset form', /already signed in/i.test(text()));
ESH.auth.signOut();

/* --- supervisor-issued temporary password --- */
section('Supervisor-issued password');
ESH.auth.assume('u_i3');
{
  const target = ESH.store.userById('u_i4');
  ok('an intern cannot reset anyone', !ESH.auth.can('user:resetPassword', target));
}
ESH.auth.assume(ESH.store.SUPERVISOR_ID);
{
  const target = ESH.store.userById('u_i4');
  ok('supervisor may reset an intern', ESH.auth.can('user:resetPassword', target));
  ok('supervisor may NOT reset another supervisor',
     !ESH.auth.can('user:resetPassword', ESH.store.userById('u_cosup')));
}
goto('#/researcher/u_i4');
ok('reset control appears on the supervisor panel', !!window.document.getElementById('issueTempPw'));
{
  const temp = ESH.store.issueTemporaryPassword('u_i4');
  ok('a temporary password is returned', typeof temp === 'string' && temp.length >= 8);
  ESH.auth.signOut();
  ok('the temporary password works', ESH.auth.signIn('intern.d@demo.eurospacehub.local', temp).ok === true);
  ok('the old password no longer works',
     ESH.auth.signIn('intern.d@demo.eurospacehub.local', 'demo').ok === false);
}
ESH.auth.assume('u_i1');
goto('#/researcher/u_i4');
ok('interns never see the reset control', !window.document.getElementById('issueTempPw'));
ESH.auth.signOut();

/* escaping */
section('Output escaping');
{
  ESH.auth.assume('u_i1');
  const r = ESH.store.addReport({
    ownerId: 'u_i1', title: '<img src=x onerror=alert(1)>XSSPROBE',
    abstract: '<script>alert(2)</script>', status: 'published',
    missionArea: 'Lunar', reportType: 'Poster', keywords: ['<b>k</b>']
  });
  goto('#/report/' + r.id);
  ok('title escaped in report view', !view().querySelector('img[onerror]'));
  ok('abstract script not injected', view().querySelectorAll('script').length === 0);
  ok('escaped title still displayed', /XSSPROBE/.test(text()));
  goto('#/library');
  ok('library escapes the title', !view().querySelector('img[onerror]'));
  const st = ESH.store.getState();
  st.reports = st.reports.filter(x => x.id !== r.id);
  ESH.store.save();
}

/* notifications: a derived "waiting on you" inbox from history + comments */
section('Notifications (B5)');
ESH.store.reset(); ESH.auth.restore();
{
  const iNotes = ESH.auth.notificationsFor(ESH.store.userById('u_i1'));
  ok('intern has notifications derived from activity', iNotes.length > 0);
  ok('intern sees a revisions-requested notification', iNotes.some(n => /Revisions requested/.test(n.text)));
  ok('intern notifications start unread', iNotes.some(n => n.unread));
  ok('intern is not notified about other researchers\' reports',
     iNotes.every(n => ESH.store.reportById(n.reportId).ownerId === 'u_i1'));

  const sNotes = ESH.auth.notificationsFor(ESH.store.userById('u_foing'));
  ok('supervisor sees new-submission notifications', sNotes.some(n => /submitted .* for review/.test(n.text)));

  const before = ESH.auth.notificationsFor(ESH.store.userById('u_i2')).length;
  ESH.store.addComment('r_5', 'u_foing', 'internal only', null, true);
  ok('internal notes do not notify the researcher',
     ESH.auth.notificationsFor(ESH.store.userById('u_i2')).length === before);
  ESH.store.addComment('r_5', 'u_foing', 'public feedback', null, false);
  ok('a public comment notifies the researcher',
     ESH.auth.notificationsFor(ESH.store.userById('u_i2')).length === before + 1);
}
{
  ESH.store.reset(); ESH.auth.restore(); ESH.auth.assume('u_i1');
  goto('#/inbox');
  ok('inbox route renders', /Your inbox/.test(text()));
  ok('visiting the inbox clears unread',
     ESH.auth.notificationsFor(ESH.store.userById('u_i1')).every(n => !n.unread));
  ok('signed-in header shows a notification bell', !!window.document.querySelector('.notifbell'));
}
{
  ESH.store.reset(); ESH.auth.restore();
  const r = ESH.store.reportById('r_6'); r.title = '<img src=x onerror=alert(1)>XSSN'; ESH.store.save();
  ESH.auth.assume('u_i1');
  goto('#/inbox');
  ok('inbox escapes report titles', view().querySelectorAll('img[onerror]').length === 0);
  ok('inbox shows the escaped probe text', /XSSN/.test(text()));
}
ESH.store.reset(); ESH.auth.restore();

/* export & citations */
section('Export & citations (B7)');
ESH.store.reset(); ESH.auth.restore();
{
  const r = ESH.store.reportById('r_1');
  const bib = ESH.exporter.citation(r, 'bibtex');
  ok('bibtex has an entry, title and year',
     /@techreport\{eshub_r_1/.test(bib) && bib.includes(r.title) && /year\s*=\s*\{\d{4}\}/.test(bib));
  const ris = ESH.exporter.citation(r, 'ris');
  ok('ris has type, author and terminator', /TY {2}- RPRT/.test(ris) && /AU {2}- /.test(ris) && /ER {2}- /.test(ris));
  const apa = ESH.exporter.citation(r, 'apa');
  ok('apa has the title and supervisor line', apa.includes(r.title) && /supervised by Prof\. Bernard Foing/.test(apa));

  const csv = ESH.exporter.toCSV(['A', 'B'], [['x,y', 'a"b'], ['plain', 'ok']]);
  ok('csv quotes commas and doubles quotes', /"x,y","a""b"/.test(csv) && /^A,B/.test(csv));
}
{
  const snapshot = JSON.parse(JSON.stringify(ESH.store.getState()));
  const before = ESH.store.reports().length;
  ESH.store.addReport({ ownerId: 'u_i1', title: 'temp import test', status: 'draft',
    missionArea: 'Lunar', reportType: 'Poster', abstract: 'x' });
  ok('store changed before import', ESH.store.reports().length === before + 1);
  ok('importState restores a snapshot',
     ESH.store.importState(snapshot) === true && ESH.store.reports().length === before);
  ok('importState rejects a bad shape', ESH.store.importState({ version: 2 }) === false);
}
{
  ESH.store.reset(); ESH.auth.restore(); ESH.auth.assume('u_i1');
  const rel = ESH.store.releasedReports()[0];
  goto('#/report/' + rel.id);
  const citeBtn = window.document.getElementById('citeBtn');
  ok('report page has a Cite control', !!citeBtn);
  citeBtn.click();
  const out = window.document.getElementById('citeOut');
  ok('cite modal opens with a citation', !!out && /supervised by/.test(out.value));
  const fmt = window.document.getElementById('citeFmt');
  fmt.value = 'bibtex'; fmt.dispatchEvent(new window.Event('change', { bubbles: true }));
  ok('cite modal switches to BibTeX', /@techreport/.test(out.value));
  ESH.ui.closeModal();

  goto('#/library');
  ok('library offers CSV export', !!window.document.getElementById('expCsv'));
  ok('library offers BibTeX export', !!window.document.getElementById('expBib'));
  ok('footer has an export-data control', !!window.document.getElementById('exportData'));
  ok('footer has an import-data control', !!window.document.getElementById('importData'));
}
ESH.store.reset(); ESH.auth.restore();

/* pagination + in-place dashboard updates */
section('Pagination & performance (B6)');
{
  const pg = ESH.ui.pager(2, 5, n => '#/library?page=' + n);
  ok('pager shows current/total', /Page 2 of 5/.test(pg));
  ok('pager links to adjacent pages', /page=1/.test(pg) && /page=3/.test(pg));
  ok('pager is empty for a single page', ESH.ui.pager(1, 1, () => '#') === '');
}
{
  ESH.store.reset(); ESH.auth.restore();
  for (let i = 0; i < 30; i++) {
    ESH.store.addReport({ ownerId: 'u_i1', title: 'Bulk paginate report ' + i, status: 'published',
      missionArea: 'Lunar', reportType: 'Poster', abstract: 'placeholder', keywords: [] });
  }
  ESH.auth.assume('u_i1');
  goto('#/library');
  ok('library caps a page at 24 cards', view().querySelectorAll('.reportcard').length === 24);
  ok('library shows a pager when overflowing', !!view().querySelector('.pager'));
  ok('library pager reports multiple pages', /Page 1 of 2/.test(text()));
  goto('#/library?page=2');
  const p2 = view().querySelectorAll('.reportcard').length;
  ok('library page 2 shows the remainder', p2 > 0 && p2 < 24);

  ESH.auth.assume('u_foing');
  goto('#/dashboard');
  ok('dashboard caps a page at 25 rows', view().querySelectorAll('tbody [data-panel]').length === 25);
  ok('dashboard shows a pager', !!view().querySelector('.pager'));
}
{
  ESH.store.reset(); ESH.auth.restore(); ESH.auth.assume('u_foing');
  goto('#/dashboard');
  view().querySelector('[data-panel]').click();          /* open a review panel */
  const qc = view().querySelector('[data-quickcomment]');
  ok('quick-comment form present with panel open', !!qc);
  const rid = qc.getAttribute('data-quickcomment');
  const before = ESH.store.reportById(rid).comments.length;
  qc.elements.body.value = 'Inline append PROBE';
  qc.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  ok('quick comment is persisted', ESH.store.reportById(rid).comments.length === before + 1);
  ok('panel stays open — appended in place, no navigation', !!view().querySelector('[data-quickcomment]'));
  ok('the new comment shows without a reload', /Inline append PROBE/.test(text()));
}
ESH.store.reset(); ESH.auth.restore();

/* light campaign grouping */
section('Campaign grouping (B10)');
ESH.store.reset(); ESH.auth.restore();
{
  ok('canonicalCampaign matches case-insensitively', ESH.store.canonicalCampaign('euromoonmars') === 'EuroMoonMars');
  ok('canonicalCampaign passes unknown through trimmed', ESH.store.canonicalCampaign('  My Field Trip  ') === 'My Field Trip');
  const inUse = ESH.store.campaignsInUse();
  ok('seed reports demonstrate at least two campaigns', inUse.indexOf('EuroMoonMars') !== -1 && inUse.length >= 2);
}
{
  ESH.auth.assume('u_i1');
  goto('#/library');
  ok('library offers a campaign filter', !!window.document.getElementById('fcampaign'));
  ok('library cards show a campaign badge', !!view().querySelector('.badge--campaign'));
  goto('#/library?campaign=' + encodeURIComponent('EuroMoonMars'));
  const cards = [...view().querySelectorAll('.reportcard')];
  ok('campaign filter narrows the library',
     cards.length > 0 && cards.every(c => /EuroMoonMars/.test(c.textContent)));
}
{
  goto('#/report/r_1');
  ok('report detail shows the campaign', /Campaign/.test(text()) && /EuroMoonMars/.test(text()));
}
{
  goto('#/submit');
  ok('submission form has a campaign field', !!window.document.getElementById('sCampaign'));
  const sf = window.document.getElementById('repForm');
  sf.elements.title.value = 'Campaign save test';
  sf.elements.abstract.value = 'placeholder abstract text';
  sf.elements.campaign.value = 'euromoonmars';
  sf.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  const mine = ESH.store.reportsByOwner('u_i1').filter(r => r.title === 'Campaign save test')[0];
  ok('saved report normalizes the campaign on submit', !!mine && mine.campaign === 'EuroMoonMars');
}
ESH.store.reset(); ESH.auth.restore();

/* dashboard analytics: turnaround + submissions over time */
section('Dashboard analytics (B9)');
{
  const c = ESH.charts.columnChart({ title: 'Test series', unit: 'submissions',
    data: [{ label: 'Jan', value: 3 }, { label: 'Feb', value: 1 }] });
  ok('columnChart renders an accessible svg', /role="img"/.test(c) && /aria-label="Test series/.test(c));
  ok('columnChart offers a table fallback', /View as table/.test(c) && />3<\/td>/.test(c));
}
{
  ESH.store.reset(); ESH.auth.restore(); ESH.auth.assume('u_foing');
  goto('#/dashboard');
  ok('dashboard shows a review-turnaround stat', /Avg\. review turnaround/.test(text()));
  ok('turnaround is computed to a day value', /\d+\.\d days/.test(text()));
  ok('dashboard shows a submissions-over-time chart', /Submissions over time/.test(text()));
  ok('all three analytics charts have a table fallback', view().querySelectorAll('.chart__table').length >= 3);
}
ESH.store.reset(); ESH.auth.restore();

/* controlled vocabularies: normalize institutions + keywords, suggest keywords */
section('Controlled vocabularies (B8)');
ESH.store.reset(); ESH.auth.restore();
{
  ok('institution alias isu → canonical',
     ESH.store.canonicalInstitution('isu') === 'International Space University');
  ok('institution alias VU Amsterdam → canonical',
     ESH.store.canonicalInstitution('VU Amsterdam') === 'Vrije Universiteit Amsterdam');
  ok('institution matches canonical case-insensitively',
     ESH.store.canonicalInstitution('florida institute of technology') === 'Florida Institute of Technology');
  ok('unknown institution passes through trimmed',
     ESH.store.canonicalInstitution('  Some Random Uni  ') === 'Some Random Uni');

  const kw = ESH.store.canonicalKeywords(['ISRU', 'isru', ' regolith ', 'Regolith', 'south  pole']);
  ok('keywords dedupe case-insensitively (first spelling kept)',
     kw.filter(k => k.toLowerCase() === 'isru').length === 1 && kw[0] === 'ISRU');
  ok('keywords collapse inner whitespace', kw.indexOf('south pole') !== -1);

  const sug = ESH.store.suggestedKeywords();
  ok('suggested keywords derive from existing reports', sug.length > 0 && sug.some(k => /isru/i.test(k)));
}
{
  ESH.store.reset(); ESH.auth.restore();
  goto('#/register');
  ok('register offers a canonical institution datalist', !!window.document.querySelector('#instList option'));
  ok('register shows keyword suggestion chips', !!window.document.querySelector('.kwsuggest__chip'));
  const rf = window.document.getElementById('regForm');
  rf.elements.fullName.value = 'Vocab Test';
  rf.elements.email.value = 'vocab@demo.eurospacehub.local';
  rf.elements.password.value = 'demo';
  rf.elements.institution.value = 'isu';
  rf.elements.startDate.value = '2026-01-01';
  rf.elements.researchTopic.value = 'testing vocab';
  rf.elements.keywords.value = 'ISRU, isru, regolith';
  rf.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  const created = ESH.store.userByEmail('vocab@demo.eurospacehub.local');
  ok('register normalizes the institution on save',
     !!created && created.institution === 'International Space University');
  ok('register de-duplicates keywords on save',
     !!created && created.keywords.filter(k => k.toLowerCase() === 'isru').length === 1);
}
{
  ESH.store.reset(); ESH.auth.restore(); ESH.auth.assume('u_i1');
  goto('#/submit');
  const chip = window.document.querySelector('.kwsuggest__chip');
  ok('submission form shows keyword chips', !!chip);
  const kwInput = window.document.getElementById('sKw');
  const kwText = chip.getAttribute('data-kw');
  chip.click();
  ok('clicking a chip appends the keyword', kwInput.value.toLowerCase().includes(kwText.toLowerCase()));
}
ESH.store.reset(); ESH.auth.restore();

/* theme toggle: dark is the default, light is opt-in and persisted */
section('Theme');
{
  const root = window.document.documentElement;
  const getBtn = () => window.document.getElementById('themeToggle');
  ESH.auth.signOut();
  goto('#/');
  ok('default theme is dark', root.getAttribute('data-theme') === 'dark');
  ok('theme toggle is present in the header', !!getBtn());
  getBtn().click();
  ok('toggling switches to light', root.getAttribute('data-theme') === 'light');
  ok('light choice is persisted', window.localStorage.getItem('esh.theme') === 'light');
  goto('#/about-demo');
  ok('a route still renders under the light theme', /Access control in this build/.test(text()));
  ok('toggle re-renders with the current theme', !!getBtn());
  getBtn().click();
  ok('toggling switches back to dark', root.getAttribute('data-theme') === 'dark');
  ok('dark choice is persisted', window.localStorage.getItem('esh.theme') === 'dark');
}

/* orientation & feedback: breadcrumbs, search highlighting, review-queue age */
section('Orientation & feedback (B4)');
ESH.store.reset(); ESH.auth.restore();
{
  ESH.auth.assume('u_i1');
  const rel = ESH.store.releasedReports()[0];
  goto('#/report/' + rel.id);
  const crumbs = view().querySelector('.crumbs');
  ok('report detail shows a breadcrumb trail', !!crumbs);
  ok('breadcrumb links back to the library', !!crumbs && /#\/library/.test(crumbs.innerHTML));

  ESH.auth.assume('u_foing');
  goto('#/researcher/u_i2');
  ok('researcher profile shows a breadcrumb', !!view().querySelector('.crumbs'));
}
{
  // highlight() must be escape-safe: text escaped first, terms only ever compiled
  const h = ESH.ui.highlight('<img src=x onerror=alert(1)> lunar regolith', ['lunar', '<img']);
  ok('highlight escapes HTML in the text', !/<img/.test(h) && /&lt;img/.test(h));
  ok('highlight wraps a matched term in <mark>', /<mark>lunar<\/mark>/i.test(h));
  const probe = window.document.createElement('div'); probe.innerHTML = h;
  ok('highlight injects no live nodes', probe.querySelectorAll('img,script').length === 0);
  ok('highlight produced a mark element', probe.querySelectorAll('mark').length >= 1);

  goto('#/library?q=lunar');
  ok('library marks the searched term', view().querySelectorAll('mark').length >= 1);
}
{
  goto('#/dashboard');
  ok('dashboard shows review-queue age', /waiting \d+ day|in queue today/.test(text()));
}

/* query-string parsing: a value may contain '=' and must survive intact */
section('Router query parsing');
{
  window.location.hash = '#/library?token=aGVsbG8=world&area=Lunar';
  const parsed = ESH.router.parse();
  ok('value keeps everything after the first =', parsed.query.token === 'aGVsbG8=world');
  ok('later params still parse', parsed.query.area === 'Lunar');
}

/* reset */
section('Reset');
ESH.store.reset();
ESH.auth.restore();
ok('reset restores seed report count', ESH.store.reports().length === 9);
ok('reset clears the session', ESH.auth.user() === null);

console.log('\n=====================================');
console.log('  passed: ' + pass + '   failed: ' + fail);
if (errors.length) {
  console.log('\n  runtime errors captured (' + errors.length + '):');
  [...new Set(errors)].slice(0, 15).forEach(e => console.log('   • ' + e.split('\n').slice(0, 3).join('\n     ')));
} else {
  console.log('  no runtime errors captured');
}
console.log('=====================================');
server.close();
process.exit(fail || errors.length ? 1 : 0);
