/* ==========================================================================
   routes/data.js — reports, comments and researcher profiles.

   Every handler follows the same three steps: load the resource from OUR
   database, ask shared/policy.js whether this session's actor may do the
   thing, then do it. The client's opinion is never consulted.

   Responses are projected before they leave: reports through
   visibleReports/visibleComments, users through projectUser. A field the
   caller may not read is absent from the JSON, not merely hidden by the UI.
   ========================================================================== */
'use strict';

const express = require('express');
const policy = require('../../shared/policy.js');
const db = require('../db.js');
const storage = require('../storage.js');
const { requireAuth } = require('../session.js');

const router = express.Router();

/* Strip internal comments, and never ship the raw B2 key to the browser: it
   has no use for one (downloads go through /file-url) and leaking keys into
   page source is how they end up in logs and bug reports. */
function projectReport(report, actor) {
  const out = Object.assign({}, report);
  out.comments = policy.visibleComments(report, actor);
  if (out.file) {
    out.file = {
      name: report.file.name,
      size: report.file.size,
      type: report.file.type,
      uploadedAt: report.file.uploadedAt,
      hasFile: true
    };
  }
  return out;
}

/* ---------------- bootstrap ----------------
   One round trip on page load: who am I, what may I see. Views stay
   synchronous against this snapshot. */
router.get('/bootstrap', (req, res) => {
  if (!req.actor) return res.json({ user: null, reports: [], users: [] });

  const reports = policy.visibleReports(db.allReports(), req.actor)
    .map((r) => projectReport(r, req.actor));

  /* Colleagues are projected; the supervisor gets the full records. */
  const users = db.allUsers().map((u) => policy.projectUser(u, req.actor));

  res.json({ user: req.actor, reports, users });
});

/* ---------------- reports ---------------- */

router.get('/reports', requireAuth, (req, res) => {
  const reports = policy.visibleReports(db.allReports(), req.actor)
    .map((r) => projectReport(r, req.actor));
  res.json({ reports });
});

router.get('/reports/:id', requireAuth, (req, res) => {
  const report = db.reportById(req.params.id);
  if (!report || !policy.can('report:read', report, req.actor)) {
    return res.status(404).json({ error: 'Report not found.' });
  }
  res.json({ report: projectReport(report, req.actor) });
});

/* Fields a client may set. `status`, `featured`, `file` and `history` are
   absent on purpose — each has its own gated route. */
const WRITABLE = ['title','missionArea','reportType','abstract','keywords',
                  'coAuthors','supplementary','dataAvailability'];

function readBody(body) {
  const out = {};
  for (const k of WRITABLE) if (k in (body || {})) out[k] = body[k];
  return out;
}

function validate(patch, { partial }) {
  const need = (k) => partial ? (k in patch) : true;
  if (need('title') && !String(patch.title || '').trim()) return 'A title is required.';
  if (need('abstract') && !String(patch.abstract || '').trim()) return 'An abstract is required.';
  if ('abstract' in patch && String(patch.abstract).trim().split(/\s+/).length > 400) {
    return 'The abstract exceeds 400 words.';
  }
  if ('missionArea' in patch && !policy.MISSION_AREAS.includes(patch.missionArea)) {
    return 'Unknown mission area.';
  }
  if ('reportType' in patch && !policy.REPORT_TYPES.includes(patch.reportType)) {
    return 'Unknown report type.';
  }
  return null;
}

router.post('/reports', requireAuth, (req, res) => {
  if (!policy.can('report:create', null, req.actor)) {
    return res.status(403).json({ error: 'Not permitted.' });
  }
  const patch = readBody(req.body);
  const err = validate(patch, { partial: false });
  if (err) return res.status(400).json({ error: err });

  const at = db.nowISO();
  const report = db.insertReport(Object.assign({
    ownerId: req.actor.id,              /* never from the body */
    missionArea: 'Lunar',
    reportType: 'Research paper',
    status: 'draft',
    createdAt: at,
    updatedAt: at,
    history: [{ at, by: req.actor.id, from: null, to: 'draft', note: 'Record created.' }]
  }, patch));

  res.status(201).json({ report: projectReport(report, req.actor) });
});

router.patch('/reports/:id', requireAuth, (req, res) => {
  const report = db.reportById(req.params.id);
  if (!report || !policy.can('report:read', report, req.actor)) {
    return res.status(404).json({ error: 'Report not found.' });
  }
  if (!policy.can('report:edit', report, req.actor)) {
    return res.status(403).json({ error: 'This record cannot be edited in its current state.' });
  }
  const patch = readBody(req.body);
  const err = validate(patch, { partial: true });
  if (err) return res.status(400).json({ error: err });

  patch.history = (report.history || []).concat([{
    at: db.nowISO(), by: req.actor.id, from: report.status, to: report.status,
    note: 'Record details updated.'
  }]);

  res.json({ report: projectReport(db.updateReport(report.id, patch), req.actor) });
});

router.post('/reports/:id/status', requireAuth, (req, res) => {
  const report = db.reportById(req.params.id);
  if (!report || !policy.can('report:read', report, req.actor)) {
    return res.status(404).json({ error: 'Report not found.' });
  }
  const to = String((req.body || {}).status || '');
  if (!policy.canTransition(report, to, req.actor)) {
    return res.status(403).json({ error: 'That transition is not permitted from ' + report.status + '.' });
  }
  const at = db.nowISO();
  const patch = {
    status: to,
    history: (report.history || []).concat([{
      at, by: req.actor.id, from: report.status, to,
      note: String((req.body || {}).note || '')
    }])
  };
  if (to === 'submitted') patch.submittedAt = at;
  /* An unreleased record can never stay featured. */
  if (!policy.STATUSES[to].released) patch.featured = false;

  res.json({ report: projectReport(db.updateReport(report.id, patch), req.actor) });
});

router.post('/reports/:id/featured', requireAuth, (req, res) => {
  const report = db.reportById(req.params.id);
  if (!report) return res.status(404).json({ error: 'Report not found.' });
  if (!policy.can('report:feature', report, req.actor)) {
    return res.status(403).json({ error: 'Only released records can be featured, by a supervisor.' });
  }
  const featured = !!(req.body || {}).featured;
  const updated = db.updateReport(report.id, {
    featured,
    history: (report.history || []).concat([{
      at: db.nowISO(), by: req.actor.id, from: report.status, to: report.status,
      note: featured ? 'Featured in the report library.' : 'Removed from featured.'
    }])
  });
  res.json({ report: projectReport(updated, req.actor) });
});

router.post('/reports/:id/comments', requireAuth, (req, res) => {
  const report = db.reportById(req.params.id);
  if (!report || !policy.can('report:read', report, req.actor)) {
    return res.status(404).json({ error: 'Report not found.' });
  }
  if (!policy.can('comment:write', report, req.actor)) {
    return res.status(403).json({ error: 'Not permitted.' });
  }
  const body = String((req.body || {}).body || '').trim();
  if (!body) return res.status(400).json({ error: 'A comment cannot be empty.' });

  const internal = !!(req.body || {}).internal;
  if (internal && !policy.can('comment:writeInternal', report, req.actor)) {
    return res.status(403).json({ error: 'Only supervisors may write internal notes.' });
  }

  const comment = {
    id: db.uid('c'), authorId: req.actor.id, at: db.nowISO(),
    body: body.slice(0, 5000),
    parentId: (req.body || {}).parentId || null,
    internal
  };
  const updated = db.updateReport(report.id, {
    comments: (report.comments || []).concat([comment])
  });
  res.status(201).json({ report: projectReport(updated, req.actor) });
});

router.delete('/reports/:id', requireAuth, async (req, res, next) => {
  try {
    const report = db.reportById(req.params.id);
    if (!report) return res.status(404).json({ error: 'Report not found.' });
    if (!policy.can('report:delete', report, req.actor)) {
      return res.status(403).json({ error: 'Not permitted.' });
    }
    if (report.file && report.file.key) await storage.deleteObject(report.file.key);
    db.deleteReport(report.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/* ---------------- researchers ---------------- */

router.get('/users', requireAuth, (req, res) => {
  res.json({ users: db.allUsers().map((u) => policy.projectUser(u, req.actor)) });
});

router.get('/users/:id', requireAuth, (req, res) => {
  const target = db.userById(req.params.id);
  if (!target || !policy.can('user:read', target, req.actor)) {
    return res.status(404).json({ error: 'Researcher not found.' });
  }
  res.json({ user: policy.projectUser(target, req.actor) });
});

const USER_WRITABLE = ['fullName','email','institution','programme','startDate','endDate',
                       'researchTopic','keywords','bio','photoUrl','links'];

router.patch('/users/:id', requireAuth, (req, res) => {
  const target = db.userById(req.params.id);
  if (!target) return res.status(404).json({ error: 'Researcher not found.' });
  if (!policy.can('user:edit', target, req.actor)) {
    return res.status(403).json({ error: 'Not permitted.' });
  }

  const patch = {};
  for (const k of USER_WRITABLE) if (k in (req.body || {})) patch[k] = req.body[k];

  /* Standing and internal notes are supervisor-only, so they are gated
     separately rather than riding along in the same body. */
  if ('standing' in (req.body || {})) {
    if (!policy.can('user:setStanding', target, req.actor)) {
      return res.status(403).json({ error: 'Only a supervisor may set standing.' });
    }
    if (!policy.STANDING.includes(req.body.standing)) {
      return res.status(400).json({ error: 'Unknown standing.' });
    }
    patch.standing = req.body.standing;
  }
  if ('internalNotes' in (req.body || {})) {
    if (!policy.can('user:writeInternalNotes', target, req.actor)) {
      return res.status(403).json({ error: 'Only a supervisor may write internal notes.' });
    }
    patch.internalNotes = String(req.body.internalNotes).slice(0, 10000);
  }

  if (patch.email) {
    const clash = db.userByEmail(patch.email);
    if (clash && clash.id !== target.id) {
      return res.status(409).json({ error: 'Another account already uses that address.' });
    }
  }

  res.json({ user: policy.projectUser(db.updateUser(target.id, patch), req.actor) });
});

module.exports = router;
