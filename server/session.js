/* ==========================================================================
   session.js — password hashing, cookie sessions, and the request actor.

   Passwords: scrypt from node:crypto. Not a native dependency, memory-hard,
   and entirely adequate here. Comparison is constant-time.

   Sessions: an opaque 256-bit token in an httpOnly cookie. The page cannot
   read it, so an XSS bug cannot exfiltrate the session, and — unlike the old
   stub — the visitor cannot edit their own role with devtools.

   THE IMPORTANT RULE: req.actor is derived from the session cookie and the
   users table, never from the request body. Every policy decision downstream
   depends on that being true.
   ========================================================================== */
'use strict';

const crypto = require('node:crypto');
const db = require('./db.js');

const COOKIE = 'esh_session';
const TTL_MS = Number(process.env.SESSION_TTL_HOURS || 12) * 60 * 60 * 1000;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

/* ---------------- passwords ---------------- */

function hashPassword(password, salt) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), s, SCRYPT.keylen, {
    N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p
  }).toString('hex');
  return { hash, salt: s };
}

function verifyPassword(password, hash, salt) {
  if (!hash || !salt) return false;
  const candidate = hashPassword(password, salt).hash;
  const a = Buffer.from(candidate, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/* ---------------- cookies ---------------- */

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setSessionCookie(res, token) {
  const secure = String(process.env.COOKIE_SECURE || 'auto');
  const isSecure = secure === 'auto'
    ? process.env.NODE_ENV === 'production'
    : secure === 'true';
  const attrs = [
    `${COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',                       /* the SPA is same-origin; Lax is enough */
    `Max-Age=${Math.floor(TTL_MS / 1000)}`
  ];
  if (isSecure) attrs.push('Secure');
  res.append('Set-Cookie', attrs.join('; '));
}

function clearSessionCookie(res) {
  res.append('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

/* ---------------- middleware ---------------- */

/** Attaches req.actor (a user object) or null. Never throws. */
function attachActor(req, _res, next) {
  const token = parseCookies(req)[COOKIE];
  req.sessionToken = token || null;
  req.actor = token ? db.sessionUser(token) : null;
  next();
}

/** 401 for anyone without a session. */
function requireAuth(req, res, next) {
  if (!req.actor) return res.status(401).json({ error: 'Authentication required.' });
  next();
}

function login(res, userId) {
  const token = db.createSession(userId, TTL_MS);
  setSessionCookie(res, token);
  return token;
}

function logout(req, res) {
  db.destroySession(req.sessionToken);
  clearSessionCookie(res);
}

module.exports = {
  COOKIE, TTL_MS,
  hashPassword, verifyPassword,
  parseCookies, setSessionCookie, clearSessionCookie,
  attachActor, requireAuth, login, logout
};
