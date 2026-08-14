/* ==========================================================================
   index.js — the Express app.

   WHY A SERVER AND NOT A SERVERLESS FUNCTION (you asked me to recommend):

   A single small Express process fits this best.

   · Presigning needs a long-lived credential. On a server it sits in one
     process's environment. Spread across serverless functions it has to be
     replicated into every function's config, which is more places to leak from
     and more places to rotate.
   · Every file decision depends on a session lookup and a report row. That is
     a database round trip per request; serverless would need a hosted database
     and connection pooling to avoid exhausting it, where SQLite here is an
     in-process read.
   · The frontend is served from this same origin, so the session cookie is
     first-party and the API needs no CORS at all. Split them and you are
     managing CORS plus SameSite=None cookies plus a preflight on every call.
   · It is one file to back up (data/hub.db) and one process to restart.

   Serverless earns its keep when traffic is spiky and stateless. A research
   group's report hub is neither.

   NOTE ON CORS: B2 still needs its own CORS rules, because the browser PUTs
   and GETs directly against B2's origin. That is separate from this app and is
   configured in the B2 console — see server/b2-cors.json.
   ========================================================================== */
'use strict';

require('dotenv').config({ path: require('node:path').join(__dirname, '.env') });

const express = require('express');
const path = require('node:path');

const db = require('./db.js');
const storage = require('./storage.js');
const session = require('./session.js');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT = path.join(__dirname, '..');

app.disable('x-powered-by');
app.set('trust proxy', Number(process.env.TRUST_PROXY || 0));

app.use(express.json({ limit: '256kb' }));   /* metadata only — files go to B2 */
app.use(session.attachActor);

/* A few headers worth having. The app uses inline event handlers nowhere, but
   it does build HTML strings, so a strict CSP is a follow-up rather than
   something to switch on blind. */
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'same-origin');
  res.set('X-Frame-Options', 'DENY');
  if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
  next();
});

/* ---------------- API ---------------- */

app.get('/api/health', async (_req, res) => {
  const bucket = await storage.verifyBucket().catch((e) => ({ ok: false, error: e.message }));
  res.json({ ok: true, storage: bucket, db: path.basename(db.DB_PATH) });
});

app.use('/api/auth', require('./routes/auth.js'));
app.use('/api', require('./routes/data.js'));
app.use('/api/reports', require('./routes/files.js'));

app.use('/api', (_req, res) => res.status(404).json({ error: 'No such endpoint.' }));

/* ---------------- frontend ----------------
   Served from the same origin so the session cookie is first-party. */

app.get('/config.js', (_req, res) => {
  res.type('application/javascript').set('Cache-Control', 'no-store');
  res.send('window.ESH_CONFIG = ' + JSON.stringify({ apiBase: '/api' }) + ';\n');
});

app.use(express.static(ROOT, {
  index: 'index.html',
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) res.set('Cache-Control', 'no-store');
  }
}));

/* The frontend is a hash router, so any non-API path is just index.html. */
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  res.sendFile(path.join(ROOT, 'index.html'));
});

/* ---------------- errors ---------------- */

app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  const status = err.status || 500;
  res.status(status).json({
    error: status === 500 ? 'Something went wrong on the server.' : err.message
  });
});

/* ---------------- housekeeping ----------------
   Sweep expired sessions, and delete B2 objects from presigns that were never
   confirmed — otherwise an abandoned upload is billable storage nobody can
   reach. */
async function sweep() {
  try {
    db.purgeExpiredSessions();
    for (const up of db.staleUploads()) {
      await storage.deleteObject(up.objectKey);
      db.dropUpload(up.id);
    }
  } catch (err) {
    console.warn('[sweep]', err.message);
  }
}

async function start() {
  const check = await storage.verifyBucket().catch((e) => ({ ok: false, error: e.message }));
  if (!check.ok) {
    console.error('\n  B2 storage is not usable: ' + check.error);
    console.error('  Uploads and downloads will fail until this is fixed.\n');
  } else {
    console.log('  B2 bucket "%s" reachable.', check.bucket);
  }

  await sweep();
  setInterval(sweep, 60 * 60 * 1000).unref();

  app.listen(PORT, () => {
    console.log('  EuroSpaceHub running on http://localhost:%d', PORT);
    console.log('  Database: %s', db.DB_PATH);
  });
}

if (require.main === module) start();

module.exports = { app, start };
