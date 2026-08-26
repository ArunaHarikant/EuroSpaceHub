/* Headless smoke test for the Lunar & Mars Research Hub.
 *
 * Loads the real page in jsdom, served by the REAL Express server, against a
 * throwaway SQLite database seeded with placeholder content. It walks every
 * route as each role and asserts on both rendered output and the rules.
 *
 *   cd server && npm install     # express, needed to run the app
 *   npm install jsdom            # at the repo root, test-only
 *   node tests/smoke.mjs
 *
 * WHY THE REAL SERVER: the hub has no offline mode. Every role change here is
 * a genuine sign-in against a session cookie, every list is what /bootstrap
 * chose to send, and every refusal is the server's. A suite that stubbed the
 * API would assert that the browser agrees with itself — which is precisely
 * the failure this project spent two rounds of bugs on.
 *
 * TWO THINGS JSDOM LACKS, both supplied in beforeParse:
 *   - `fetch`. Without it every API call throws ReferenceError and the suite
 *     silently measures the harness rather than the application.
 *   - a cookie jar. The session is an httpOnly cookie and `credentials:
 *     'same-origin'` is what carries it; Node's fetch has nowhere to keep one,
 *     so the polyfill below keeps a jar per window.
 */
import { JSDOM, VirtualConsole } from 'jsdom';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const ROOT = normalize(join(dirname(fileURLToPath(import.meta.url)), '..'));
const require = createRequire(import.meta.url);

/* ---------------- a disposable server ---------------- */

const TMP = mkdtempSync(join(tmpdir(), 'esh-smoke-'));
process.env.DATA_DIR = TMP;
process.env.DB_PATH = join(TMP, 'smoke.db');
/* Storage is never contacted: no test attaches a file. These only satisfy the
   module's start-up check. */
process.env.B2_KEY_ID = process.env.B2_KEY_ID || 'test-key-id';
process.env.B2_APPLICATION_KEY = process.env.B2_APPLICATION_KEY || 'test-app-key';
process.env.B2_BUCKET_NAME = process.env.B2_BUCKET_NAME || 'test-bucket';
process.env.B2_ENDPOINT = process.env.B2_ENDPOINT || 'https://s3.eu-central-003.backblazeb2.com';
process.env.B2_REGION = process.env.B2_REGION || 'eu-central-003';

let app, db, session;
try {
  ({ app } = require(join(ROOT, 'server', 'index.js')));
  db = require(join(ROOT, 'server', 'db.js'));
  session = require(join(ROOT, 'server', 'session.js'));
} catch (e) {
  console.log('\n  FATAL: could not load the server.');
  console.log('  Run `npm install` in server/ first.\n  ' + e.message + '\n');
  process.exit(1);
}

const PW = 'smoke-test-password';
const httpServer = app.listen(0);
await new Promise((r) => httpServer.once('listening', r));
const BASE = 'http://127.0.0.1:' + httpServer.address().port + '/';

/* ---------------- seed ----------------
   Written straight through db.js rather than the HTTP API: the fixture is not
   what is under test, and going through the API would need an account to
   already exist to create the first one. */

function mkUser(u) {
  const { hash, salt } = session.hashPassword(PW);
  return db.insertUser(Object.assign({
    passwordHash: hash, passwordSalt: salt, standing: 'active', createdAt: db.nowISO()
  }, u));
}
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString();

mkUser({ id: 'u_sup', role: 'supervisor', fullName: 'Prof. Bernard Foing',
         email: 'sup@test.local', institution: 'ILEWG' });
mkUser({ id: 'u_cosup', role: 'supervisor', fullName: 'Co-Supervisor Name',
         email: 'cosup@test.local', institution: 'Partner Institution' });
mkUser({ id: 'u_a', role: 'intern', fullName: 'Intern Name A', email: 'a@test.local',
         institution: 'International Space University', programme: 'MSc Space Studies',
         supervisorId: 'u_sup', researchTopic: 'Lunar regolith geotechnics',
         startDate: '2026-01-05', endDate: '2026-09-30',
         internalNotes: 'Placeholder internal note about Intern A.' });
mkUser({ id: 'u_b', role: 'intern', fullName: 'Intern Name B', email: 'b@test.local',
         institution: 'Vrije Universiteit Amsterdam', programme: 'MSc Earth Sciences',
         supervisorId: 'u_sup', researchTopic: 'Mars surface spectroscopy',
         startDate: '2026-02-01', endDate: '2026-10-31',
         internalNotes: 'Placeholder internal note about Intern B.' });

function mkReport(o) {
  return db.insertReport(Object.assign({
    missionArea: 'Lunar', reportType: 'Research paper', abstract: 'Placeholder abstract.',
    keywords: [], coAuthors: [], file: null, supplementary: [], dataAvailability: '',
    featured: false, createdAt: daysAgo(30), submittedAt: null, updatedAt: daysAgo(30),
    history: [], comments: []
  }, o));
}
mkReport({ id: 'r_pub', ownerId: 'u_a', title: 'Published Lunar Record',
           status: 'published', featured: true, campaign: 'EuroMoonMars',
           keywords: ['regolith', 'ISRU'], submittedAt: daysAgo(60),
           comments: [
             { id: 'c_open', authorId: 'u_sup', at: daysAgo(50),
               body: 'Visible review comment.', parentId: null, internal: false },
             { id: 'c_secret', authorId: 'u_sup', at: daysAgo(50),
               body: 'INTERNAL-ONLY-MARKER supervisor note.', parentId: null, internal: true }
           ] });
mkReport({ id: 'r_appr', ownerId: 'u_b', title: 'Approved Mars Record',
           missionArea: 'Mars', status: 'approved', submittedAt: daysAgo(40) });
mkReport({ id: 'r_draft_a', ownerId: 'u_a', title: 'DRAFT-MARKER Private Draft', status: 'draft' });
mkReport({ id: 'r_sub_a', ownerId: 'u_a', title: 'Submitted Record A',
           status: 'submitted', submittedAt: daysAgo(5) });
mkReport({ id: 'r_rev_b', ownerId: 'u_b', title: 'REVIEW-MARKER Under Review B',
           status: 'review', submittedAt: daysAgo(8) });
mkReport({ id: 'r_revis_a', ownerId: 'u_a', title: 'Revisions Requested A',
           status: 'revisions', submittedAt: daysAgo(9) });
mkReport({ id: 'r_xss', ownerId: 'u_a', title: '<img src=x onerror=alert(1)>XSSTITLE',
           status: 'published' });

/* ---------------- harness ---------------- */

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  → ' + extra : '')); }
}
function section(name) { console.log('\n— ' + name); }

async function waitFor(pred, timeoutMs = 8000, stepMs = 20) {
  const start = Date.now();
  for (;;) {
    try { if (pred()) return true; } catch { /* not ready */ }
    if (Date.now() - start >= timeoutMs) return false;
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

const IGNORED = /Not implemented: Window's (scrollTo|scroll|scrollBy)/;
const REQUIRED_VIEWS = ['foing', 'library', 'report', 'reportEdit', 'submit', 'profile',
                        'profileEdit', 'me', 'inbox', 'dashboard', 'signin', 'register',
                        'reset', 'accessModel', 'denied', 'notFound'];

/* One jar for the whole run: signing in as somebody else replaces the cookie,
   exactly as it would in a browser. */
const jar = new Map();
function applySetCookie(res) {
  for (const line of (res.headers.getSetCookie?.() || [])) {
    const [pair] = line.split(';');
    const i = pair.indexOf('=');
    const name = pair.slice(0, i).trim(), value = pair.slice(i + 1).trim();
    if (/Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(line) || value === '') jar.delete(name);
    else jar.set(name, value);
  }
}
function cookieHeader() {
  return [...jar].map(([k, v]) => k + '=' + v).join('; ');
}

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => { const m = e.stack || e.message; if (!IGNORED.test(m)) errors.push('jsdomError: ' + m); });
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

const dom = await JSDOM.fromURL(BASE, {
  runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
  beforeParse(w) {
    w.fetch = async (input, init = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url, BASE);
      const headers = Object.assign({}, init.headers);
      const c = cookieHeader();
      if (c) headers.Cookie = c;
      const res = await fetch(url, Object.assign({}, init, { headers, redirect: 'manual' }));
      applySetCookie(res);
      return res;
    };
  }
});
const { window } = dom;
await new Promise((res) => {
  if (window.document.readyState === 'complete') return res();
  window.addEventListener('load', res);
});

const booted = await waitFor(() => {
  const E = window.ESH;
  return E && E.store && E.auth && E.router && E.views &&
    REQUIRED_VIEWS.every((v) => typeof E.views[v] === 'function') &&
    window.document.getElementById('view').children.length > 0;
});
if (!booted) {
  console.log('\n  FATAL: the app did not finish booting.');
  console.log('    captured: ' + (errors.slice(0, 8).join(' | ') || 'none') + '\n');
  process.exit(1);
}

const { ESH } = window;
const view = () => window.document.getElementById('view');
const text = () => view().textContent.replace(/\s+/g, ' ');
const html = () => view().innerHTML;

function goto(hash) {
  window.location.hash = hash;
  ESH.router.resolve();
  /* A guard redirects by setting the hash. In a browser that fires hashchange
     and the router runs again; driving resolve() directly, we follow it here. */
  for (let i = 0; i < 3 && window.location.hash !== hash; i++) {
    hash = window.location.hash;
    ESH.router.resolve();
  }
}

/* A real sign-in: cookie, then a fresh /bootstrap as the new actor. */
async function signInAs(email) {
  const res = await ESH.auth.signIn(email, PW);
  if (!res.ok) throw new Error('sign-in failed for ' + email + ': ' + res.error);
  await ESH.store.hydrate();
  ESH.auth.restore();
  ESH.app.renderChrome();
  return res.user;
}
async function signOut() {
  await ESH.auth.signOut();
  await ESH.store.hydrate();
  ESH.auth.restore();
  ESH.app.renderChrome();
}

/* ================= SIGNED-OUT VISITOR ================= */
section('Signed-out visitor');

ok('boots with no session', ESH.auth.user() === null);
ok('the banner says the hub is private',
  window.document.getElementById('statusBannerTag').textContent === 'PRIVATE');

goto('#/');
ok('the landing page renders', /Research Hub/i.test(text()));
ok('it carries no biography', !/Principal (Project )?Scientist|SMART-1 project scientist/i.test(text()));

/* Nothing about the work may leak onto the only page a visitor can reach. */
ok('no report titles leak', !/Published Lunar Record|Approved Mars Record/.test(text()));
ok('no researcher names leak', !/Intern Name [AB]/.test(text()));
ok('no counts leak', !/\b\d+ (reports?|researchers?|submissions?)\b/i.test(text()));

ok('the permission layer returns nothing, not a filtered list',
  ESH.auth.visibleReports(null).length === 0);
ok('/bootstrap sent no reports to an anonymous caller',
  ESH.store.getState().reports.length === 0);
ok('/bootstrap sent no users either',
  ESH.store.getState().users.length === 0);

for (const [route, label] of [['#/library', 'library'], ['#/submit', 'submit'],
                              ['#/dashboard', 'dashboard'], ['#/me', 'own profile'],
                              ['#/inbox', 'inbox'], ['#/report/r_pub', 'a published report'],
                              ['#/researcher/u_a', 'a researcher profile']]) {
  goto(route);
  const t = text();
  ok('signed out, ' + label + ' does not render its content',
    /Sign in|Access denied/i.test(t) && !/Published Lunar Record|Intern Name A/.test(t), t.slice(0, 90));
}

goto('#/register');
ok('registration explains that accounts are issued', /issued, not applied for/i.test(text()));
ok('there is no registration form', !window.document.getElementById('regForm'));

goto('#/reset');
ok('reset points at the supervisor', /no self-service reset/i.test(text()));
ok('there is no reset form', !window.document.getElementById('resetReqForm'));

goto('#/signin');
ok('the sign-in form is present', !!window.document.getElementById('signinForm'));
ok('there is no demo role switcher', !view().querySelector('[data-assume]'));
ok('no seeded password is advertised', !/password <code>demo<\/code>/i.test(html()));

goto('#/access');
ok('the access model page renders', /Access control/i.test(text()));
ok('it does not claim authentication is stubbed', !/no server|stub|simulated in the browser/i.test(text()));
ok('the workflow table is generated from the live rules', /Under Review/.test(text()));

goto('#/no-such-page');
ok('unknown routes 404', /Page not found/i.test(text()));

/* ================= RESEARCHER ================= */
section('Researcher (intern)');

await signInAs('a@test.local');
ok('signed in as Intern Name A', ESH.auth.user().fullName === 'Intern Name A');
ok('the role is intern', ESH.auth.isIntern());

goto('#/library');
const libText = text();
ok('the library shows released records', /Published Lunar Record/.test(libText));
ok('it includes a colleague\'s approved record', /Approved Mars Record/.test(libText));
ok('it never shows a draft', !/DRAFT-MARKER/.test(libText));
ok('it never shows a record under review', !/REVIEW-MARKER/.test(libText));

ok('visibleReports excludes a colleague\'s unreleased work',
  ESH.auth.visibleReports().every((r) => r.ownerId === 'u_a' || ESH.store.isReleased(r)));

goto('#/report/r_pub');
const pubText = text();
ok('a released record opens', /Published Lunar Record/.test(pubText));
ok('the public review comment is shown', /Visible review comment/.test(pubText));
ok('the internal comment is NOT shown', !/INTERNAL-ONLY-MARKER/.test(pubText));
ok('the internal comment is absent from the payload, not just hidden',
  !JSON.stringify(ESH.store.reportById('r_pub').comments).includes('INTERNAL-ONLY-MARKER'));

goto('#/report/r_rev_b');
ok('a colleague\'s record under review is unreachable',
  !/REVIEW-MARKER/.test(text()), text().slice(0, 90));

goto('#/researcher/u_b');
const colleague = text();
ok('a colleague profile renders', /Intern Name B/.test(colleague));
ok('their email is withheld', !/b@test\.local/.test(colleague));
ok('their internal notes are withheld', !/Placeholder internal note about Intern B/.test(colleague));
ok('the redaction is in the payload, not the page',
  ESH.store.userById('u_b').email === undefined);

goto('#/me');
ok('own profile shows own email', /a@test\.local/.test(text()));
ok('own internal notes stay hidden from their subject',
  !/Placeholder internal note about Intern A/.test(text()));

goto('#/dashboard');
ok('the dashboard is refused', /Access denied/i.test(text()));

goto('#/submit');
ok('the submission form renders', !!window.document.getElementById('repForm'));

goto('#/report/r_draft_a/edit');
ok('own draft is editable', !!window.document.getElementById('repForm'));

goto('#/report/r_sub_a/edit');
ok('own submitted record is still editable', !!window.document.getElementById('repForm'));

goto('#/report/r_rev_b/edit');
ok('a colleague\'s record cannot be edited',
  !window.document.getElementById('repForm'), text().slice(0, 80));

goto('#/inbox');
ok('the inbox renders', /waiting|inbox|notification/i.test(text()));

/* --- a real transition, refused and allowed --- */
ok('an intern may not approve their own record',
  !ESH.auth.canTransition(ESH.store.reportById('r_sub_a'), 'approved'));
ok('an intern may withdraw their own record',
  ESH.auth.canTransition(ESH.store.reportById('r_sub_a'), 'withdrawn'));

/* --- escaping --- */
goto('#/report/r_xss');
ok('user content is escaped, not injected',
  !view().querySelector('img[onerror]') && /XSSTITLE/.test(text()));

/* ================= SUPERVISOR ================= */
section('Supervisor');

await signInAs('sup@test.local');
ok('signed in as the supervisor', ESH.auth.isSupervisor());

goto('#/dashboard');
const dash = text();
ok('the dashboard renders', /dashboard/i.test(dash));
ok('it lists every researcher', /Intern Name A/.test(dash) && /Intern Name B/.test(dash));
ok('it reaches unreleased records', /DRAFT-MARKER/.test(dash) || /REVIEW-MARKER/.test(dash));
ok('the add-researcher control is present', !!window.document.getElementById('dAddUser'));

ok('the supervisor sees every report',
  ESH.auth.visibleReports().length === ESH.store.reports().length);
ok('the supervisor received the full set from the server',
  ESH.store.reports().length >= 7);

goto('#/report/r_pub');
ok('internal comments are visible to the supervisor', /INTERNAL-ONLY-MARKER/.test(text()));

goto('#/researcher/u_a');
const asSup = text();
ok('a researcher email is visible to the supervisor', /a@test\.local/.test(asSup));
ok('internal notes are visible to the supervisor',
  /Placeholder internal note about Intern A/.test(asSup));

ok('the supervisor may approve a submitted record',
  ESH.auth.canTransition(ESH.store.reportById('r_sub_a'), 'review'));
ok('featuring is allowed on a released record',
  ESH.auth.can('report:feature', ESH.store.reportById('r_pub')));
ok('featuring is refused on a draft',
  !ESH.auth.can('report:feature', ESH.store.reportById('r_draft_a')));
ok('deleting is a supervisor act',
  ESH.auth.can('report:delete', ESH.store.reportById('r_draft_a')));

/* --- a write that really goes to the server --- */
ESH.store.setStatus('r_sub_a', 'review', 'u_sup', 'Opened for review.');
await waitFor(() => true, 400);
const afterStatus = await (await window.fetch('/api/reports/r_sub_a')).json();
ok('a status change reached the database', afterStatus.report.status === 'review',
  JSON.stringify(afterStatus.report && afterStatus.report.status));

/* ================= CO-SUPERVISOR ================= */
section('Co-supervisor');

await signInAs('cosup@test.local');
ok('the supervisor role is not tied to one account', ESH.auth.isSupervisor());
goto('#/dashboard');
ok('a co-supervisor reaches the dashboard', /dashboard/i.test(text()));
ok('and sees internal notes too',
  ESH.auth.can('user:readInternalNotes', ESH.store.userById('u_a')));

/* ================= SIGNING OUT ================= */
section('Signing out');

await signOut();
ok('the session is cleared', ESH.auth.user() === null);
ok('the cache is emptied with it', ESH.store.getState().reports.length === 0);
goto('#/dashboard');
ok('the dashboard is unreachable again', !/Intern Name A/.test(text()));

/* ================= THE SHARED GATE ================= */
section('The shared policy module');

const policy = require(join(ROOT, 'shared', 'policy.js'));
ok('the browser loaded the same rules the server enforces',
  typeof window.ESHPolicy.can === 'function' &&
  window.ESHPolicy.STATUS_ORDER.join() === policy.STATUS_ORDER.join());
ok('the transition table matches',
  JSON.stringify(window.ESHPolicy.TRANSITIONS) === JSON.stringify(policy.TRANSITIONS));
ok('a signed-out actor is denied by default',
  !policy.can('report:read', { id: 'r', ownerId: 'u', status: 'published' }, null));
ok('the password minimum is shared', typeof policy.MIN_PASSWORD_LENGTH === 'number');

/* ================= WRAP UP ================= */

const realErrors = errors.filter((e) => !IGNORED.test(e));
console.log('\n=====================================');
console.log('  passed: ' + pass + '   failed: ' + fail);
if (realErrors.length) {
  console.log('  runtime errors captured:');
  realErrors.slice(0, 10).forEach((e) => console.log('    ' + e.slice(0, 200)));
} else {
  console.log('  no runtime errors captured');
}
console.log('=====================================\n');

dom.window.close();
httpServer.close();
try { rmSync(TMP, { recursive: true, force: true }); } catch { /* windows file lock */ }
process.exit(fail || realErrors.length ? 1 : 0);
