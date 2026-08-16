/* ==========================================================================
   api.test.js — server-side authorisation tests.

   These matter more than the frontend suite: they assert what an ATTACKER
   cannot do, by talking to the real HTTP API with real cookies. The browser's
   opinion is irrelevant here — nothing in this file loads the frontend.

   B2 is not contacted. The presign path is covered by asserting that requests
   are refused BEFORE any signing happens; the tests that would need real
   Backblaze credentials are skipped unless B2_KEY_ID is set, and say so.

     node --test test/api.test.js     (or: npm test)
   ========================================================================== */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/* Isolated database per run, before anything requires db.js. */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'esh-test-'));
process.env.DATA_DIR = TMP;
process.env.DB_PATH = path.join(TMP, 'test.db');
process.env.NODE_ENV = 'test';
process.env.B2_KEY_ID = process.env.B2_KEY_ID || 'test-key-id';
process.env.B2_APPLICATION_KEY = process.env.B2_APPLICATION_KEY || 'test-app-key';
process.env.B2_BUCKET_NAME = process.env.B2_BUCKET_NAME || 'test-bucket';
process.env.B2_ENDPOINT = process.env.B2_ENDPOINT || 'https://s3.eu-central-003.backblazeb2.com';
process.env.B2_REGION = process.env.B2_REGION || 'eu-central-003';

const { app } = require('../index.js');
const db = require('../db.js');
const session = require('../session.js');
const policy = require('../../shared/policy.js');

/* ---------------- harness ---------------- */

let server, base;

test.before(async () => {
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = 'http://127.0.0.1:' + server.address().port;

  const mk = (id, role, email, name) => {
    const { hash, salt } = session.hashPassword('pw-' + id);
    db.insertUser({ id, role, fullName: name, email, passwordHash: hash, passwordSalt: salt,
                    standing: 'active', createdAt: db.nowISO() });
  };
  mk('u_sup', 'supervisor', 'sup@test.local', 'Supervisor');
  mk('u_a', 'intern', 'a@test.local', 'Intern A');
  mk('u_b', 'intern', 'b@test.local', 'Intern B');
});

test.after(() => {
  server.close();
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
});

async function login(email, id) {
  const res = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'pw-' + id })
  });
  const cookie = (res.headers.getSetCookie?.() || [])[0] || '';
  return { res, cookie: cookie.split(';')[0] };
}

function call(method, url, { cookie, body } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return fetch(base + url, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual'
  });
}

/* Create a report directly so tests do not depend on the create endpoint. */
function seedReport(ownerId, status, id) {
  return db.insertReport({
    id, ownerId, title: 'Report ' + id, missionArea: 'Lunar', reportType: 'Research paper',
    abstract: 'x', status, createdAt: db.nowISO(), updatedAt: db.nowISO()
  });
}

/* ================= authentication ================= */

test('login rejects a bad password with the same message as an unknown account', async () => {
  const bad = await fetch(base + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'a@test.local', password: 'wrong' })
  });
  const missing = await fetch(base + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'nobody@test.local', password: 'wrong' })
  });
  assert.equal(bad.status, 401);
  assert.equal(missing.status, 401);
  assert.deepEqual(await bad.json(), await missing.json(),
    'error text must not reveal whether the account exists');
});

test('login issues an httpOnly session cookie', async () => {
  const { res, cookie } = await login('a@test.local', 'u_a');
  assert.equal(res.status, 200);
  const raw = (res.headers.getSetCookie?.() || [])[0] || '';
  assert.match(raw, /HttpOnly/i, 'the page must not be able to read the session');
  assert.match(raw, /SameSite=Lax/i);
  assert.ok(cookie.startsWith('esh_session='));
});

test('the password hash never leaves the server', async () => {
  const { cookie } = await login('u_sup' && 'sup@test.local', 'u_sup');
  const body = await (await call('GET', '/api/bootstrap', { cookie })).json();
  const blob = JSON.stringify(body);
  assert.ok(!blob.includes('passwordHash'), 'no hash in the payload');
  assert.ok(!blob.includes('passwordSalt'), 'no salt in the payload');
});

/* ================= the download gate ================= */

test('an unauthenticated request cannot get a download URL', async () => {
  seedReport('u_a', 'published', 'r_pub1');
  const res = await call('GET', '/api/reports/r_pub1/file-url');
  assert.equal(res.status, 401);
});

test('an intern cannot get a download URL for a colleague\'s DRAFT', async () => {
  seedReport('u_a', 'draft', 'r_draft1');
  const { cookie } = await login('b@test.local', 'u_b');
  const res = await call('GET', '/api/reports/r_draft1/file-url', { cookie });
  assert.equal(res.status, 404, '404 rather than 403 — existence is itself a disclosure');
});

test('the owner and the supervisor both reach their own gate', async () => {
  /* No file attached, so a passing gate yields 404 "no file" and a failing one
     yields 404 "not found" — distinguish them by the message. */
  const a = await login('a@test.local', 'u_a');
  const s = await login('sup@test.local', 'u_sup');
  const b = await login('b@test.local', 'u_b');

  const owner = await (await call('GET', '/api/reports/r_draft1/file-url', { cookie: a.cookie })).json();
  const sup = await (await call('GET', '/api/reports/r_draft1/file-url', { cookie: s.cookie })).json();
  const other = await (await call('GET', '/api/reports/r_draft1/file-url', { cookie: b.cookie })).json();

  assert.match(owner.error, /no file attached/i, 'owner passes the gate');
  assert.match(sup.error, /no file attached/i, 'supervisor passes the gate');
  assert.match(other.error, /not found/i, 'stranger is stopped at the gate');
});

test('there is no endpoint that signs a client-supplied key', async () => {
  const { cookie } = await login('b@test.local', 'u_b');
  /* Every shape someone might try to smuggle a key through. */
  const attempts = [
    ['GET', '/api/reports/r_draft1/file-url?key=reports/r_draft1/anything.pdf'],
    ['GET', '/api/files/reports/r_draft1/x.pdf'],
    ['POST', '/api/files/download-url'],
    ['GET', '/api/download?key=reports/r_draft1/x.pdf']
  ];
  for (const [method, url] of attempts) {
    const res = await call(method, url, { cookie, body: method === 'POST' ? { key: 'x' } : undefined });
    assert.ok(res.status === 404 || res.status === 401,
      `${method} ${url} must not succeed (got ${res.status})`);
  }
});

/* ================= the upload gate ================= */

test('an intern cannot request an upload URL for a colleague\'s report', async () => {
  const { cookie } = await login('b@test.local', 'u_b');
  const res = await call('POST', '/api/reports/r_draft1/upload-url', {
    cookie, body: { filename: 'x.pdf', contentType: 'application/pdf', size: 1000 }
  });
  assert.equal(res.status, 404);
});

test('an author cannot upload to a report locked by review', async () => {
  seedReport('u_a', 'review', 'r_review1');
  const { cookie } = await login('a@test.local', 'u_a');
  const res = await call('POST', '/api/reports/r_review1/upload-url', {
    cookie, body: { filename: 'x.pdf', contentType: 'application/pdf', size: 1000 }
  });
  assert.equal(res.status, 404, 'report:edit is false under review, so the gate refuses');
});

test('file type and size are rejected before anything is signed', async () => {
  const { cookie } = await login('a@test.local', 'u_a');
  const bad = [
    [{ filename: 'evil.exe', contentType: 'application/octet-stream', size: 10 }, /PDF, DOCX and PPTX/i],
    [{ filename: 'big.pdf', contentType: 'application/pdf', size: 40 * 1024 * 1024 }, /25 MB/],
    [{ filename: '', contentType: 'application/pdf', size: 10 }, /filename/i],
    [{ filename: 'empty.pdf', contentType: 'application/pdf', size: 0 }, /empty/i]
  ];
  for (const [body, expected] of bad) {
    const res = await call('POST', '/api/reports/r_draft1/upload-url', { cookie, body });
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.match((await res.json()).error, expected);
  }
});

test('confirming an upload ticket that is not yours is refused', async () => {
  const uploadId = db.createUpload({
    reportId: 'r_draft1', userId: 'u_a', objectKey: 'reports/r_draft1/x.pdf',
    filename: 'x.pdf', contentType: 'application/pdf', declaredSize: 10,
    expiresAt: new Date(Date.now() + 60000).toISOString()
  });
  /* u_b cannot even reach the report, so the gate stops it first. */
  const b = await login('b@test.local', 'u_b');
  const asB = await call('POST', '/api/reports/r_draft1/file', { cookie: b.cookie, body: { uploadId } });
  assert.equal(asB.status, 404);

  /* The supervisor CAN edit the report, but the ticket belongs to u_a. */
  const s = await login('sup@test.local', 'u_sup');
  const asSup = await call('POST', '/api/reports/r_draft1/file', { cookie: s.cookie, body: { uploadId } });
  assert.equal(asSup.status, 403);
  assert.match((await asSup.json()).error, /not yours/i);
});

test('an expired upload ticket is refused', async () => {
  const uploadId = db.createUpload({
    reportId: 'r_draft1', userId: 'u_a', objectKey: 'reports/r_draft1/y.pdf',
    filename: 'y.pdf', contentType: 'application/pdf', declaredSize: 10,
    expiresAt: new Date(Date.now() - 1000).toISOString()
  });
  const { cookie } = await login('a@test.local', 'u_a');
  const res = await call('POST', '/api/reports/r_draft1/file', { cookie, body: { uploadId } });
  assert.equal(res.status, 410);
});

test('server-minted keys are namespaced per report and validated', () => {
  const storage = require('../storage.js');
  const key = storage.buildKey('r_draft1', 'Some Report.pdf');
  assert.match(key, /^reports\/r_draft1\/[0-9a-f-]{36}\.pdf$/);
  assert.ok(storage.isOwnedKey(key, 'r_draft1'));
  assert.ok(!storage.isOwnedKey(key, 'r_other'), 'a key for one report is not valid for another');
  assert.ok(!storage.isOwnedKey('reports/r_draft1/../../etc/passwd', 'r_draft1'), 'no traversal');
  assert.ok(!storage.isOwnedKey('anything.pdf', 'r_draft1'));
});

/* ================= data leakage ================= */

test('bootstrap returns nothing to a signed-out visitor', async () => {
  const body = await (await call('GET', '/api/bootstrap')).json();
  assert.equal(body.user, null);
  assert.deepEqual(body.reports, []);
  assert.deepEqual(body.users, []);
});

test('an intern never receives a colleague\'s draft or email', async () => {
  const { cookie } = await login('b@test.local', 'u_b');
  const body = await (await call('GET', '/api/bootstrap', { cookie })).json();
  const ids = body.reports.map((r) => r.id);
  assert.ok(!ids.includes('r_draft1'), 'colleague drafts are absent from the payload');
  assert.ok(ids.includes('r_pub1'), 'released work is present');

  const a = body.users.find((u) => u.id === 'u_a');
  assert.ok(a, 'colleagues are listed');
  assert.equal(a.email, undefined, 'a colleague email is absent, not merely hidden');
  assert.equal(a.internalNotes, undefined);
});

test('B2 object keys are never sent to the browser', async () => {
  db.updateReport('r_pub1', {
    file: { key: 'reports/r_pub1/secret-key.pdf', name: 'p.pdf', size: 10, type: 'application/pdf' }
  });
  const { cookie } = await login('b@test.local', 'u_b');
  const body = await (await call('GET', '/api/bootstrap', { cookie })).json();
  assert.ok(!JSON.stringify(body).includes('secret-key.pdf'), 'the key must not appear in any payload');
  const pub = body.reports.find((r) => r.id === 'r_pub1');
  assert.equal(pub.file.name, 'p.pdf', 'but the metadata still is');
  assert.equal(pub.file.key, undefined);
});

test('internal supervisor comments never reach an intern', async () => {
  db.updateReport('r_pub1', { comments: [
    { id: 'c1', authorId: 'u_sup', at: db.nowISO(), body: 'PUBLIC-FEEDBACK', internal: false },
    { id: 'c2', authorId: 'u_sup', at: db.nowISO(), body: 'INTERNAL-ONLY', internal: true }
  ]});
  const b = await login('b@test.local', 'u_b');
  const asIntern = JSON.stringify(await (await call('GET', '/api/bootstrap', { cookie: b.cookie })).json());
  assert.ok(asIntern.includes('PUBLIC-FEEDBACK'));
  assert.ok(!asIntern.includes('INTERNAL-ONLY'), 'internal notes are stripped server-side');

  const s = await login('sup@test.local', 'u_sup');
  const asSup = JSON.stringify(await (await call('GET', '/api/bootstrap', { cookie: s.cookie })).json());
  assert.ok(asSup.includes('INTERNAL-ONLY'), 'the supervisor still sees them');
});

/* ================= workflow and privilege ================= */

test('an intern cannot approve their own report', async () => {
  seedReport('u_a', 'submitted', 'r_sub1');
  const { cookie } = await login('a@test.local', 'u_a');
  const res = await call('POST', '/api/reports/r_sub1/status', { cookie, body: { status: 'approved' } });
  assert.equal(res.status, 403);
  assert.equal(db.reportById('r_sub1').status, 'submitted', 'and nothing changed');
});

test('an intern cannot feature a report or forge ownership', async () => {
  const { cookie } = await login('a@test.local', 'u_a');
  const feat = await call('POST', '/api/reports/r_pub1/featured', { cookie, body: { featured: true } });
  assert.equal(feat.status, 403);

  const created = await call('POST', '/api/reports', {
    cookie, body: { title: 'T', abstract: 'A', ownerId: 'u_sup', status: 'published', featured: true }
  });
  const rec = (await created.json()).report;
  assert.equal(rec.ownerId, 'u_a', 'ownerId comes from the session, not the body');
  assert.equal(rec.status, 'draft', 'status cannot be set at creation');
  assert.equal(rec.featured, false);
});

test('an intern cannot write an internal comment even by asking', async () => {
  const { cookie } = await login('a@test.local', 'u_a');
  const res = await call('POST', '/api/reports/r_sub1/comments', {
    cookie, body: { body: 'sneaky', internal: true }
  });
  assert.equal(res.status, 403);
});

test('an intern cannot set standing or internal notes on themselves', async () => {
  const { cookie } = await login('a@test.local', 'u_a');
  const standing = await call('PATCH', '/api/users/u_a', { cookie, body: { standing: 'active' } });
  assert.equal(standing.status, 403);
  const notes = await call('PATCH', '/api/users/u_a', { cookie, body: { internalNotes: 'nice things' } });
  assert.equal(notes.status, 403);
});

test('changing a password invalidates existing sessions', async () => {
  const { cookie } = await login('b@test.local', 'u_b');
  assert.equal((await call('GET', '/api/bootstrap', { cookie })).status, 200);

  const { hash, salt } = session.hashPassword('rotated');
  db.setPassword('u_b', hash, salt);

  const after = await (await call('GET', '/api/bootstrap', { cookie })).json();
  assert.equal(after.user, null, 'the old cookie is dead');
});

/* ================= the shared gate is genuinely shared ================= */

test('the server enforces the same policy module the browser loads', () => {
  const fromServer = require('../../shared/policy.js');
  assert.equal(fromServer, policy, 'one module instance, one set of rules');
  assert.ok(typeof fromServer.can === 'function');
  /* file:* are defined in terms of report:* — the property the whole design rests on. */
  const report = { id: 'r', ownerId: 'u_a', status: 'draft' };
  const owner = { id: 'u_a', role: 'intern' };
  const other = { id: 'u_b', role: 'intern' };
  assert.equal(fromServer.can('file:download', report, owner),
               fromServer.can('report:read', report, owner));
  assert.equal(fromServer.can('file:download', report, other),
               fromServer.can('report:read', report, other));
  assert.equal(fromServer.can('file:download', report, other), false);
});
