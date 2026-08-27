/* ==========================================================================
   db.js — SQLite via node:sqlite (built into Node 22.13+, no native build).

   22.13 rather than 22.5: the module landed in 22.5 but behind
   --experimental-sqlite, and the flag was only dropped in 22.13. On anything
   older this require() throws ERR_UNKNOWN_BUILTIN_MODULE.

   The server is authoritative for users, sessions and reports. That is not
   architectural taste: the policy gate can only mean something if the actor
   and the resource both come from here rather than from the request body.

   Comments and history live as JSON columns on the report row. They are only
   ever read and written whole, alongside their report, so splitting them into
   tables would buy joins we never make.
   ========================================================================== */
'use strict';

const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'hub.db');

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  role           TEXT NOT NULL CHECK (role IN ('intern','supervisor')),
  fullName       TEXT NOT NULL,
  email          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  passwordHash   TEXT NOT NULL,
  passwordSalt   TEXT NOT NULL,
  institution    TEXT DEFAULT '',
  programme      TEXT DEFAULT '',
  supervisorId   TEXT,
  startDate      TEXT DEFAULT '',
  endDate        TEXT DEFAULT '',
  researchTopic  TEXT DEFAULT '',
  keywords       TEXT DEFAULT '[]',
  bio            TEXT DEFAULT '',
  photoUrl       TEXT DEFAULT '',
  links          TEXT DEFAULT '{}',
  standing       TEXT DEFAULT 'active',
  internalNotes  TEXT DEFAULT '',
  createdAt      TEXT NOT NULL,
  passwordChangedAt TEXT,
  notificationsSeenAt TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token     TEXT PRIMARY KEY,
  userId    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  createdAt TEXT NOT NULL,
  expiresAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(userId);

CREATE TABLE IF NOT EXISTS reports (
  id               TEXT PRIMARY KEY,
  ownerId          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  missionArea      TEXT NOT NULL,
  reportType       TEXT NOT NULL,
  campaign         TEXT DEFAULT '',
  abstract         TEXT NOT NULL,
  keywords         TEXT DEFAULT '[]',
  coAuthors        TEXT DEFAULT '[]',
  file             TEXT,
  supplementary    TEXT DEFAULT '[]',
  dataAvailability TEXT DEFAULT '',
  status           TEXT NOT NULL,
  featured         INTEGER NOT NULL DEFAULT 0,
  visibility       TEXT DEFAULT 'private',
  reviewedAt       TEXT,
  reviewedBy       TEXT,
  createdAt        TEXT NOT NULL,
  submittedAt      TEXT,
  updatedAt        TEXT NOT NULL,
  history          TEXT DEFAULT '[]',
  comments         TEXT DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_reports_owner ON reports(ownerId);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);

-- An upload is only legitimate if THIS server issued the key. The row proves
-- it, binds the key to one report and one user, and is single-use.
CREATE TABLE IF NOT EXISTS uploads (
  id          TEXT PRIMARY KEY,
  reportId    TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  userId      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  objectKey   TEXT NOT NULL,
  filename    TEXT NOT NULL,
  contentType TEXT NOT NULL,
  declaredSize INTEGER NOT NULL,
  createdAt   TEXT NOT NULL,
  expiresAt   TEXT NOT NULL,
  consumedAt  TEXT
);
CREATE INDEX IF NOT EXISTS idx_uploads_report ON uploads(reportId);
`);

/* Additive migrations. `CREATE TABLE IF NOT EXISTS` leaves an existing database
   on its original schema, so a column added above never reaches a deployment
   that has already run. Each entry here is re-checked at every boot and applied
   only if missing — adding a nullable/defaulted column is the one kind of change
   that is safe to run unconditionally against live data. */
function addColumnIfMissing(table, column, decl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (cols.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
}
addColumnIfMissing('users', 'notificationsSeenAt', 'TEXT');
addColumnIfMissing('reports', 'campaign', "TEXT DEFAULT ''");
/* Weekly-report fields. visibility is student-owned (private/shared); the two
   reviewed* columns are supervisor-owned and set only via their own endpoint. */
addColumnIfMissing('reports', 'visibility', "TEXT DEFAULT 'private'");
addColumnIfMissing('reports', 'reviewedAt', 'TEXT');
addColumnIfMissing('reports', 'reviewedBy', 'TEXT');

/* ---------------- helpers ---------------- */

const nowISO = () => new Date().toISOString();
const uid = (p) => `${p}_${crypto.randomBytes(9).toString('base64url')}`;
const j = (v, fallback) => { try { return JSON.parse(v); } catch { return fallback; } };

/* ---------------- users ---------------- */

function rowToUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    role: row.role,
    fullName: row.fullName,
    email: row.email,
    institution: row.institution,
    programme: row.programme,
    supervisorId: row.supervisorId,
    startDate: row.startDate,
    endDate: row.endDate,
    researchTopic: row.researchTopic,
    keywords: j(row.keywords, []),
    bio: row.bio,
    photoUrl: row.photoUrl,
    links: j(row.links, {}),
    standing: row.standing,
    internalNotes: row.internalNotes,
    createdAt: row.createdAt,
    passwordChangedAt: row.passwordChangedAt,
    notificationsSeenAt: row.notificationsSeenAt
    /* passwordHash / passwordSalt deliberately never leave this module */
  };
}

const userById = (id) => rowToUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
const userByEmail = (email) =>
  rowToUser(db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(String(email || '').trim()));
const credentialsFor = (id) =>
  db.prepare('SELECT passwordHash, passwordSalt FROM users WHERE id = ?').get(id) || null;
const allUsers = () => db.prepare('SELECT * FROM users ORDER BY fullName').all().map(rowToUser);

function insertUser(u) {
  db.prepare(`INSERT INTO users
    (id, role, fullName, email, passwordHash, passwordSalt, institution, programme, supervisorId,
     startDate, endDate, researchTopic, keywords, bio, photoUrl, links, standing, internalNotes, createdAt)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    u.id, u.role, u.fullName, u.email, u.passwordHash, u.passwordSalt,
    u.institution || '', u.programme || '', u.supervisorId || null,
    u.startDate || '', u.endDate || '', u.researchTopic || '',
    JSON.stringify(u.keywords || []), u.bio || '', u.photoUrl || '',
    JSON.stringify(u.links || {}), u.standing || 'active', u.internalNotes || '',
    u.createdAt || nowISO());
  return userById(u.id);
}

const USER_PATCHABLE = ['fullName','email','institution','programme','startDate','endDate',
                        'researchTopic','keywords','bio','photoUrl','links','standing','internalNotes',
                        'notificationsSeenAt'];

function updateUser(id, patch) {
  const sets = [], vals = [];
  for (const k of USER_PATCHABLE) {
    if (!(k in patch)) continue;
    sets.push(`${k} = ?`);
    vals.push((k === 'keywords' || k === 'links') ? JSON.stringify(patch[k]) : patch[k]);
  }
  if (sets.length) {
    vals.push(id);
    db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  }
  return userById(id);
}

function setPassword(id, hash, salt) {
  db.prepare('UPDATE users SET passwordHash = ?, passwordSalt = ?, passwordChangedAt = ? WHERE id = ?')
    .run(hash, salt, nowISO(), id);
  /* Changing a password invalidates every existing session for that user. */
  db.prepare('DELETE FROM sessions WHERE userId = ?').run(id);
}

/* ---------------- sessions ---------------- */

function createSession(userId, ttlMs) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (token, userId, createdAt, expiresAt) VALUES (?,?,?,?)')
    .run(token, userId, nowISO(), new Date(Date.now() + ttlMs).toISOString());
  return token;
}

function sessionUser(token) {
  if (!token) return null;
  const row = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!row) return null;
  if (new Date(row.expiresAt).getTime() < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  return userById(row.userId);
}

const destroySession = (token) => { if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token); };
const purgeExpiredSessions = () =>
  db.prepare('DELETE FROM sessions WHERE expiresAt < ?').run(nowISO());

/* ---------------- reports ---------------- */

function rowToReport(row) {
  if (!row) return null;
  return {
    id: row.id,
    ownerId: row.ownerId,
    title: row.title,
    missionArea: row.missionArea,
    reportType: row.reportType,
    campaign: row.campaign || '',
    abstract: row.abstract,
    keywords: j(row.keywords, []),
    coAuthors: j(row.coAuthors, []),
    file: row.file ? j(row.file, null) : null,
    supplementary: j(row.supplementary, []),
    dataAvailability: row.dataAvailability,
    status: row.status,
    featured: !!row.featured,
    visibility: row.visibility || 'private',
    reviewedAt: row.reviewedAt || null,
    reviewedBy: row.reviewedBy || null,
    createdAt: row.createdAt,
    submittedAt: row.submittedAt,
    updatedAt: row.updatedAt,
    history: j(row.history, []),
    comments: j(row.comments, [])
  };
}

const reportById = (id) => rowToReport(db.prepare('SELECT * FROM reports WHERE id = ?').get(id));
const allReports = () =>
  db.prepare('SELECT * FROM reports ORDER BY updatedAt DESC').all().map(rowToReport);

function insertReport(r) {
  const id = r.id || uid('r');
  const at = nowISO();
  db.prepare(`INSERT INTO reports
    (id, ownerId, title, missionArea, reportType, campaign, abstract, keywords, coAuthors, file,
     supplementary, dataAvailability, status, featured, visibility, createdAt, submittedAt, updatedAt, history, comments)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, r.ownerId, r.title, r.missionArea, r.reportType, r.campaign || '', r.abstract,
    JSON.stringify(r.keywords || []), JSON.stringify(r.coAuthors || []),
    r.file ? JSON.stringify(r.file) : null,
    JSON.stringify(r.supplementary || []), r.dataAvailability || '',
    r.status || 'draft', r.featured ? 1 : 0, r.visibility || 'private',
    r.createdAt || at, r.submittedAt || null, r.updatedAt || at,
    JSON.stringify(r.history || []), JSON.stringify(r.comments || []));
  return reportById(id);
}

const REPORT_PATCHABLE = ['title','missionArea','reportType','campaign','abstract','keywords','coAuthors',
                          'file','supplementary','dataAvailability','status','featured','visibility',
                          'reviewedAt','reviewedBy','submittedAt','history','comments'];
const REPORT_JSON = new Set(['keywords','coAuthors','file','supplementary','history','comments']);

function updateReport(id, patch) {
  const sets = ['updatedAt = ?'], vals = [nowISO()];
  for (const k of REPORT_PATCHABLE) {
    if (!(k in patch)) continue;
    sets.push(`${k} = ?`);
    if (REPORT_JSON.has(k)) vals.push(patch[k] === null ? null : JSON.stringify(patch[k]));
    else if (k === 'featured') vals.push(patch[k] ? 1 : 0);
    else vals.push(patch[k]);
  }
  vals.push(id);
  db.prepare(`UPDATE reports SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  return reportById(id);
}

const deleteReport = (id) => db.prepare('DELETE FROM reports WHERE id = ?').run(id);

/* ---------------- uploads ---------------- */

function createUpload(u) {
  const id = uid('up');
  db.prepare(`INSERT INTO uploads
    (id, reportId, userId, objectKey, filename, contentType, declaredSize, createdAt, expiresAt)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    id, u.reportId, u.userId, u.objectKey, u.filename, u.contentType,
    u.declaredSize, nowISO(), u.expiresAt);
  return id;
}

const uploadById = (id) => db.prepare('SELECT * FROM uploads WHERE id = ?').get(id) || null;
const consumeUpload = (id) =>
  db.prepare('UPDATE uploads SET consumedAt = ? WHERE id = ?').run(nowISO(), id);

/** Keys from presigns that were never confirmed — safe to sweep from B2. */
const staleUploads = () =>
  db.prepare('SELECT * FROM uploads WHERE consumedAt IS NULL AND expiresAt < ?').all(nowISO());
const dropUpload = (id) => db.prepare('DELETE FROM uploads WHERE id = ?').run(id);

module.exports = {
  db, DB_PATH, nowISO, uid,
  rowToUser, userById, userByEmail, credentialsFor, allUsers, insertUser, updateUser, setPassword,
  createSession, sessionUser, destroySession, purgeExpiredSessions,
  rowToReport, reportById, allReports, insertReport, updateReport, deleteReport,
  createUpload, uploadById, consumeUpload, staleUploads, dropUpload
};
