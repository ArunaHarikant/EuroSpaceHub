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

/* ================= field persistence =================
   These are regression tests for fields the client wrote and the server
   silently discarded. A dropped field produces no error anywhere — the request
   succeeds, the value is simply gone on the next read — so nothing but an
   explicit round-trip assertion catches it. */

test('campaign survives a create/read round trip', async () => {
  const { cookie } = await login('a@test.local', 'u_a');
  const created = await call('POST', '/api/reports', {
    cookie,
    body: { title: 'Campaign round trip', abstract: 'x', missionArea: 'Lunar',
            reportType: 'Research paper', campaign: 'EuroMoonMars' }
  });
  assert.equal(created.status, 201);
  const { report } = await created.json();
  assert.equal(report.campaign, 'EuroMoonMars', 'campaign must not be dropped on create');

  const read = await call('GET', '/api/reports/' + report.id, { cookie });
  assert.equal((await read.json()).report.campaign, 'EuroMoonMars',
    'campaign must survive being written to the database and read back');
});

test('campaign can be edited and cleared', async () => {
  const { cookie } = await login('a@test.local', 'u_a');
  const { report } = await (await call('POST', '/api/reports', {
    cookie,
    body: { title: 'Campaign edit', abstract: 'x', campaign: 'ExoGeoLab' }
  })).json();

  const patched = await call('PATCH', '/api/reports/' + report.id, {
    cookie, body: { campaign: 'Lunar south-pole study' }
  });
  assert.equal((await patched.json()).report.campaign, 'Lunar south-pole study');

  const cleared = await call('PATCH', '/api/reports/' + report.id, { cookie, body: { campaign: '' } });
  assert.equal((await cleared.json()).report.campaign, '', 'an empty campaign must clear the grouping');
});

test('an over-long campaign is rejected rather than truncated', async () => {
  const { cookie } = await login('a@test.local', 'u_a');
  const res = await call('POST', '/api/reports', {
    cookie, body: { title: 'Too long', abstract: 'x', campaign: 'z'.repeat(121) }
  });
  assert.equal(res.status, 400);
});

test('the notification read-marker persists and is not another account\'s to set', async () => {
  const a = await login('a@test.local', 'u_a');
  /* The supervisor, deliberately: the marker is owned by its account and by
     nobody else, so even full supervisory access must not reach it. (u_b is
     unusable here — an earlier test rotates its password for good.) */
  const sup = await login('sup@test.local', 'u_sup');

  const mine = await call('POST', '/api/users/u_a/notifications-seen', { cookie: a.cookie });
  assert.equal(mine.status, 200);
  const seenAt = (await mine.json()).user.notificationsSeenAt;
  assert.ok(seenAt, 'the marker must come back set, not undefined');

  /* Read it back through a fresh request: the column has to exist, not just
     the response object. */
  const reread = await call('GET', '/api/users/u_a', { cookie: a.cookie });
  assert.equal((await reread.json()).user.notificationsSeenAt, seenAt);

  const theirs = await call('POST', '/api/users/u_a/notifications-seen', { cookie: sup.cookie });
  assert.equal(theirs.status, 403, 'no other account, supervisor included, may clear an inbox');
});

/* ================= account creation ================= */

test('only a supervisor may create an account', async () => {
  const { cookie } = await login('a@test.local', 'u_a');
  const res = await call('POST', '/api/users', {
    cookie, body: { fullName: 'Sneaky', email: 'sneaky@test.local' }
  });
  assert.equal(res.status, 403);
  assert.equal(db.userByEmail('sneaky@test.local'), null, 'nothing may be written on a refusal');
});

test('an unauthenticated visitor cannot create an account', async () => {
  const res = await call('POST', '/api/users', {
    body: { fullName: 'Anon', email: 'anon@test.local' }
  });
  assert.equal(res.status, 401);
  assert.equal(db.userByEmail('anon@test.local'), null);
});

test('a supervisor creates an account and gets the password exactly once', async () => {
  const { cookie } = await login('sup@test.local', 'u_sup');
  const res = await call('POST', '/api/users', {
    cookie,
    body: { fullName: 'Intern C', email: 'c@test.local', institution: 'ISU', programme: 'MSc' }
  });
  assert.equal(res.status, 201);
  const { user, initialPassword } = await res.json();
  assert.ok(initialPassword && initialPassword.length >= 8);
  assert.equal(user.role, 'intern');
  assert.equal(user.supervisorId, 'u_sup');
  assert.ok(!('passwordHash' in user) && !('passwordSalt' in user),
    'credentials must never appear in the response');

  /* The password must actually work — the point of the whole flow. */
  const signedIn = await fetch(base + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'c@test.local', password: initialPassword })
  });
  assert.equal(signedIn.status, 200);

  /* Re-reading the profile must not surface the password again. */
  const reread = await call('GET', '/api/users/' + user.id, { cookie });
  assert.ok(!('initialPassword' in (await reread.json()).user));
});

test('a password supplied by the client is ignored, not honoured', async () => {
  const { cookie } = await login('sup@test.local', 'u_sup');
  const res = await call('POST', '/api/users', {
    cookie,
    body: { fullName: 'Intern D', email: 'd@test.local', password: 'chosen-by-caller',
            role: 'supervisor', standing: 'alumnus' }
  });
  assert.equal(res.status, 201);
  const { initialPassword } = await res.json();
  assert.notEqual(initialPassword, 'chosen-by-caller');

  const withChosen = await fetch(base + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'd@test.local', password: 'chosen-by-caller' })
  });
  assert.equal(withChosen.status, 401, 'a client-supplied password must never be set');
});

test('account creation validates the address and refuses duplicates', async () => {
  const { cookie } = await login('sup@test.local', 'u_sup');

  const noName = await call('POST', '/api/users', { cookie, body: { fullName: '', email: 'e@test.local' } });
  assert.equal(noName.status, 400);

  const badEmail = await call('POST', '/api/users', { cookie, body: { fullName: 'E', email: 'not-an-address' } });
  assert.equal(badEmail.status, 400);

  const dupe = await call('POST', '/api/users', { cookie, body: { fullName: 'Clash', email: 'a@test.local' } });
  assert.equal(dupe.status, 409);
});

/* ================= featuring and deletion =================
   Both have dedicated endpoints. The browser previously routed featuring
   through PATCH /reports/:id, whose whitelist excludes `featured` — so the
   toggle appeared to work and was discarded. These assert the real routes. */

test('featured is not settable through the report PATCH whitelist', async () => {
  const { cookie } = await login('sup@test.local', 'u_sup');
  const r = seedReport('u_a', 'published', 'r_feat_patch');

  const res = await call('PATCH', '/api/reports/' + r.id, { cookie, body: { featured: true } });
  assert.equal(res.status, 200, 'the request itself is fine — it just must not set featured');
  assert.equal(db.reportById(r.id).featured, false,
    'featuring must go through its own gated route, not ride along in an edit');
});

test('the featured route pins and unpins a released record', async () => {
  const { cookie } = await login('sup@test.local', 'u_sup');
  const r = seedReport('u_a', 'published', 'r_feat_route');

  const on = await call('POST', '/api/reports/' + r.id + '/featured', { cookie, body: { featured: true } });
  assert.equal(on.status, 200);
  assert.equal((await on.json()).report.featured, true);
  assert.equal(db.reportById(r.id).featured, true, 'it must actually persist');

  const off = await call('POST', '/api/reports/' + r.id + '/featured', { cookie, body: { featured: false } });
  assert.equal((await off.json()).report.featured, false);
});

test('an unreleased record cannot be featured, and an intern cannot feature at all', async () => {
  const sup = await login('sup@test.local', 'u_sup');
  const a = await login('a@test.local', 'u_a');

  const draft = seedReport('u_a', 'draft', 'r_feat_draft');
  const refused = await call('POST', '/api/reports/' + draft.id + '/featured',
    { cookie: sup.cookie, body: { featured: true } });
  assert.equal(refused.status, 403, 'only released records can be pinned');
  assert.equal(db.reportById(draft.id).featured, false);

  const released = seedReport('u_a', 'published', 'r_feat_intern');
  const byIntern = await call('POST', '/api/reports/' + released.id + '/featured',
    { cookie: a.cookie, body: { featured: true } });
  assert.equal(byIntern.status, 403, 'featuring is a supervisory act even on your own record');
  assert.equal(db.reportById(released.id).featured, false);
});

test('delete is supervisor-only and actually removes the row', async () => {
  const sup = await login('sup@test.local', 'u_sup');
  const a = await login('a@test.local', 'u_a');
  const r = seedReport('u_a', 'draft', 'r_del');

  const byOwner = await call('DELETE', '/api/reports/' + r.id, { cookie: a.cookie });
  assert.equal(byOwner.status, 403, 'a hard delete is not the author\'s to make');
  assert.ok(db.reportById(r.id), 'a refused delete must leave the record intact');

  const bySup = await call('DELETE', '/api/reports/' + r.id, { cookie: sup.cookie });
  assert.equal(bySup.status, 200);
  assert.equal(db.reportById(r.id), null, 'the row must be gone, not just hidden');

  const again = await call('DELETE', '/api/reports/' + r.id, { cookie: sup.cookie });
  assert.equal(again.status, 404, 'deleting it twice is a 404, not a crash');
});

/* ================= password change ================= */

test('the password minimum comes from the shared policy, not a local constant', async () => {
  const { cookie } = await login('sup@test.local', 'u_sup');
  assert.equal(typeof policy.MIN_PASSWORD_LENGTH, 'number');

  const tooShort = 'x'.repeat(policy.MIN_PASSWORD_LENGTH - 1);
  const res = await call('POST', '/api/auth/password', {
    cookie, body: { currentPassword: 'pw-u_sup', newPassword: tooShort }
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, new RegExp(String(policy.MIN_PASSWORD_LENGTH)),
    'the message must quote the shared value so the form and the server agree');
});

test('changing a password requires the current one', async () => {
  /* A dedicated account: a successful change drops this user's sessions. */
  const { hash, salt } = session.hashPassword('pw-u_pwtest');
  db.insertUser({ id: 'u_pwtest', role: 'intern', fullName: 'PW Test', email: 'pw@test.local',
                  passwordHash: hash, passwordSalt: salt, standing: 'active', createdAt: db.nowISO() });
  const { cookie } = await login('pw@test.local', 'u_pwtest');

  const wrong = await call('POST', '/api/auth/password', {
    cookie, body: { currentPassword: 'not-it', newPassword: 'a-long-enough-one' }
  });
  assert.equal(wrong.status, 403);

  const right = await call('POST', '/api/auth/password', {
    cookie, body: { currentPassword: 'pw-u_pwtest', newPassword: 'a-long-enough-one' }
  });
  assert.equal(right.status, 200);

  /* The new password works and the old one does not. */
  const withNew = await fetch(base + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'pw@test.local', password: 'a-long-enough-one' })
  });
  assert.equal(withNew.status, 200);
  const withOld = await fetch(base + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'pw@test.local', password: 'pw-u_pwtest' })
  });
  assert.equal(withOld.status, 401);
});

/* ================= weekly reports: Phase 1 (data + vocabulary) =================
   The type exists, visibility persists with a private default, and an invalid
   visibility is refused server-side. No visibility behaviour yet — that is
   Phase 2. */

test('Weekly report is an accepted report type', async () => {
  const { cookie } = await login('a@test.local', 'u_a');
  const res = await call('POST', '/api/reports', {
    cookie,
    body: { title: 'Week 1', abstract: 'x', reportType: 'Weekly report' }
  });
  assert.equal(res.status, 201);
  assert.equal((await res.json()).report.reportType, 'Weekly report');
});

test('a new report defaults to private visibility and it round-trips', async () => {
  const { cookie } = await login('a@test.local', 'u_a');
  const created = await call('POST', '/api/reports', {
    cookie, body: { title: 'Week 2', abstract: 'x', reportType: 'Weekly report' }
  });
  assert.equal(created.status, 201);
  const { report } = await created.json();
  assert.equal(report.visibility, 'private', 'the default must be private');
  assert.equal(report.reviewedAt, null);
  assert.equal(report.reviewedBy, null);

  const read = await call('GET', '/api/reports/' + report.id, { cookie });
  assert.equal((await read.json()).report.visibility, 'private',
    'visibility must survive being written and read back');
});

test('an explicit shared visibility is accepted at creation', async () => {
  const { cookie } = await login('a@test.local', 'u_a');
  const res = await call('POST', '/api/reports', {
    cookie,
    body: { title: 'Week 3', abstract: 'x', reportType: 'Weekly report', visibility: 'shared' }
  });
  assert.equal(res.status, 201);
  assert.equal((await res.json()).report.visibility, 'shared');
});

test('an invalid visibility value is rejected at creation', async () => {
  const { cookie } = await login('a@test.local', 'u_a');
  const res = await call('POST', '/api/reports', {
    cookie,
    body: { title: 'Bad', abstract: 'x', reportType: 'Weekly report', visibility: 'world' }
  });
  assert.equal(res.status, 400);
});

test('visibility cannot be set through the report PATCH whitelist', async () => {
  const { cookie } = await login('a@test.local', 'u_a');
  const { report } = await (await call('POST', '/api/reports', {
    cookie, body: { title: 'Week 4', abstract: 'x', reportType: 'Weekly report' }
  })).json();

  const res = await call('PATCH', '/api/reports/' + report.id, { cookie, body: { visibility: 'shared' } });
  assert.equal(res.status, 200, 'the request itself is fine — it just must not set visibility');
  assert.equal(db.reportById(report.id).visibility, 'private',
    'visibility must change only through its own gated route, not a metadata edit');
});
