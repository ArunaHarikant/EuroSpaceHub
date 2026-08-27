/* ==========================================================================
   routes/auth.js — sign in, sign out, and "who am I".

   Registration is deliberately absent. The hub is closed and, per the agreed
   model, accounts are created by invitation from the supervisor. Until the
   invite flow lands, `npm run seed` and the supervisor's temporary-password
   control are the two ways an account comes into existence — both of which
   require someone who already has access.
   ========================================================================== */
'use strict';

const express = require('express');
const db = require('../db.js');
const session = require('../session.js');
const policy = require('../../shared/policy.js');

const router = express.Router();

/* Crude but effective throttle on credential stuffing: per-IP+email, memory
   only, resets on restart. A real deployment fronts this with something
   sturdier, but leaving login completely unthrottled would be careless. */
const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

function throttleKey(req, email) {
  return (req.ip || 'unknown') + '|' + String(email || '').toLowerCase();
}
function tooManyAttempts(key) {
  const rec = attempts.get(key);
  if (!rec) return false;
  if (Date.now() - rec.first > WINDOW_MS) { attempts.delete(key); return false; }
  return rec.count >= MAX_ATTEMPTS;
}
function noteFailure(key) {
  const rec = attempts.get(key);
  if (!rec || Date.now() - rec.first > WINDOW_MS) attempts.set(key, { first: Date.now(), count: 1 });
  else rec.count += 1;
}

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  const key = throttleKey(req, email);

  if (tooManyAttempts(key)) {
    return res.status(429).json({ error: 'Too many sign-in attempts. Try again in a few minutes.' });
  }

  const user = db.userByEmail(email);
  const creds = user ? db.credentialsFor(user.id) : null;

  /* One message for "no such account" and "wrong password" alike — the login
     form should not double as a way to discover who has an account. */
  const reject = () => {
    noteFailure(key);
    return res.status(401).json({ error: 'Incorrect email address or password.' });
  };

  if (!user || !creds) return reject();
  if (!session.verifyPassword(String(password || ''), creds.passwordHash, creds.passwordSalt)) {
    return reject();
  }
  if (user.standing === 'inactive') {
    return res.status(403).json({ error: 'This account is inactive. Contact your supervisor.' });
  }

  attempts.delete(key);
  session.login(res, user.id);
  res.json({ user });
});

router.post('/logout', (req, res) => {
  session.logout(req, res);
  res.json({ ok: true });
});

/* The page calls this on boot to learn who it is. Returns the full record for
   yourself — projectUser would strip your own email, which is not the intent. */
router.get('/me', (req, res) => {
  if (!req.actor) return res.json({ user: null });
  res.json({ user: req.actor });
});

/* Change your own password while signed in. */
router.post('/password', session.requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (String(newPassword || '').length < policy.MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: 'Use at least ' + policy.MIN_PASSWORD_LENGTH + ' characters.' });
  }
  const creds = db.credentialsFor(req.actor.id);
  if (!session.verifyPassword(String(currentPassword || ''), creds.passwordHash, creds.passwordSalt)) {
    return res.status(403).json({ error: 'Your current password is incorrect.' });
  }
  const { hash, salt } = session.hashPassword(newPassword);
  db.setPassword(req.actor.id, hash, salt);   /* also drops every session */
  session.login(res, req.actor.id);           /* …then re-issues this one */
  res.json({ ok: true });
});

/* Supervisor issues a temporary password for someone else. Same rule the
   browser uses to decide whether to show the button. */
router.post('/users/:id/temporary-password', session.requireAuth, (req, res) => {
  const target = db.userById(req.params.id);
  if (!target) return res.status(404).json({ error: 'No such researcher.' });
  if (!policy.can('user:resetPassword', target, req.actor)) {
    return res.status(403).json({ error: 'Not permitted.' });
  }
  const temp = require('node:crypto').randomBytes(9).toString('base64url');
  const { hash, salt } = session.hashPassword(temp);
  db.setPassword(target.id, hash, salt);
  res.json({ temporaryPassword: temp });      /* shown once, to the supervisor */
});

module.exports = router;
