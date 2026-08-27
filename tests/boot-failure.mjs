/* Boot-failure tests.
 *
 * The main suite (smoke.mjs) drives the app against a REAL server that works.
 * This file covers the boot path when the server does NOT — the case with no
 * happy answer available, where the temptation is to render something.
 *
 * It serves the static files itself and controls what /api answers, so it needs
 * no database and no express.
 *
 *   npm install jsdom              # same single test-only dependency
 *   node tests/boot-failure.mjs
 *
 * NOTE: jsdom ships no `fetch`, and the app requires one. Without the polyfill
 * in beforeParse below, every API call throws ReferenceError and the suite
 * measures the harness rather than the application — which is exactly the trap
 * that made an early reading of this behaviour wrong.
 */
import { JSDOM, VirtualConsole } from 'jsdom';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize } from 'node:path';

const ROOT = normalize(join(dirname(fileURLToPath(import.meta.url)), '..'));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
               '.json': 'application/json', '.svg': 'image/svg+xml' };

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  → ' + extra : '')); }
}

/* A static server for the repo, plus a programmable /api. */
function startServer(apiHandler) {
  const server = createServer(async (req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);

    /* Stand in for the route the real server registers ahead of its static
       handler. */
    if (url === '/config.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      return res.end('window.ESH_CONFIG = { apiBase: "/api" };');
    }
    if (url.startsWith('/api/')) return apiHandler(req, res);

    const p = url === '/' ? '/index.html' : url;
    const full = normalize(join(ROOT, p));
    if (!full.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    try {
      const buf = await readFile(full);
      const ext = p.slice(p.lastIndexOf('.'));
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(buf);
    } catch { res.writeHead(404); res.end('not found'); }
  });
  return new Promise((resolve) => {
    server.listen(0, () => resolve({ server, base: 'http://127.0.0.1:' + server.address().port }));
  });
}

async function load(base) {
  const vc = new VirtualConsole();
  vc.on('jsdomError', () => {});   /* asserted on explicitly below */
  const dom = await JSDOM.fromURL(base + '/', {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) { w.fetch = (u, o) => fetch(new URL(u, base), o); }
  });
  /* Boot is one round trip plus a render; give it room on a cold CI runner. */
  await new Promise((r) => setTimeout(r, 3000));
  return dom;
}

/* ==========================================================================
   An unreachable server must not be rendered as an empty hub.

   `api.bootstrap()` used to swallow the failure and resolve with empty arrays,
   so an outage was indistinguishable from a signed-out visitor looking at a
   hub that is empty by design — and the boot handler then fell back to a
   client-side seed. Both of those are gone; this is what holds them gone.
   ========================================================================== */
console.log('\n— The server is unreachable');
{
  const { server, base } = await startServer((req, res) => {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end('{"error":"down"}');
  });
  const dom = await load(base);
  const d = dom.window.document;
  const body = d.body.textContent.replace(/\s+/g, ' ');

  ok('the hub reports that it cannot reach the server',
    /cannot reach its server/i.test(body), body.slice(0, 160));

  ok('bootstrap() rejects rather than resolving empty', await (async () => {
    try { await dom.window.ESH.api.bootstrap(); return false; }
    catch (e) { return e.unreachable === true; }
  })());

  /* The real regression: no invented records may reach the screen. */
  ok('no placeholder researcher names are shown', !/Intern Name [A-E]/.test(body));
  ok('no placeholder report titles are shown', !/Sample (Lunar|Mars|Analogue)/i.test(body));
  ok('no report links are rendered', !d.querySelector('a[href^="#/report/"]'));

  /* Signed out is a claim about a session; this is a claim about the network. */
  ok('the failure is not presented as an empty library',
    !/no reports|nothing to show|empty/i.test(body) || /cannot reach/i.test(body));

  ok('a retry control is offered', !!d.getElementById('retryBoot'));

  dom.window.close();
  server.close();
}

/* ==========================================================================
   A healthy server with an anonymous visitor is a DIFFERENT state: the hub loads
   normally and shows the landing page, with no reports because none are
   visible to a signed-out caller. This is the case the outage must not be
   confused with, so it is asserted alongside.
   ========================================================================== */
console.log('\n— The server is healthy and the visitor is signed out');
{
  const { server, base } = await startServer((req, res) => {
    const url = req.url.split('?')[0];
    if (url === '/api/bootstrap') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ user: null, reports: [], users: [] }));
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{"error":"no route"}');
  });
  const dom = await load(base);
  const d = dom.window.document;
  const body = d.body.textContent.replace(/\s+/g, ' ');

  ok('the landing page renders', !!d.querySelector('h1'));
  ok('it does NOT claim the server is unreachable', !/cannot reach its server/i.test(body));
  ok('the banner reports a private hub',
    (d.getElementById('statusBannerTag') || {}).textContent === 'PRIVATE');
  ok('no placeholder content appears', !/Intern Name [A-E]/.test(body));
  ok('there is no demo role switcher', !d.querySelector('[data-assume]'));

  dom.window.close();
  server.close();
}

console.log('\n=====================================');
console.log('  passed: ' + pass + '   failed: ' + fail);
console.log('=====================================\n');
process.exit(fail ? 1 : 0);
