/* ==========================================================================
   routes/files.js — presigned upload and download against Backblaze B2.

   THE DESIGN RULE, stated once because everything here follows from it:

       A B2 object key is NOT a capability. Holding one grants nothing.

   So no endpoint here ever accepts a key from the client. Every request names
   a REPORT; the server loads that report from its own database, evaluates the
   shared policy against its own session actor, and only then reaches for the
   key it stored itself. Guessing or leaking a key gets you exactly nowhere,
   because there is no route that will sign one on request.

   Three endpoints:

     POST /api/reports/:id/upload-url   can('file:upload')   → presigned PUT
     POST /api/reports/:id/file         can('file:upload')   → confirm + record
     GET  /api/reports/:id/file-url     can('file:download') → presigned GET
     DELETE /api/reports/:id/file       can('file:delete')   → detach + purge

   can('file:upload')   is defined as can('report:edit', report, actor)
   can('file:download') is defined as can('report:read', report, actor)
   …both in shared/policy.js, the same file the browser loads. There is no
   second copy of these rules to drift.
   ========================================================================== */
'use strict';

const express = require('express');
const policy = require('../../shared/policy.js');
const db = require('../db.js');
const storage = require('../storage.js');
const { requireAuth } = require('../session.js');

const router = express.Router();

/* Load the report from OUR database and gate it. `action` is a policy action,
   so the rule lives in shared/policy.js rather than being restated here. */
function loadAndGate(action) {
  return (req, res, next) => {
    const report = db.reportById(req.params.id);
    if (!report) return res.status(404).json({ error: 'Report not found.' });

    if (!policy.can(action, report, req.actor)) {
      /* 404, not 403: telling an unauthorised caller that a record exists is
         itself a disclosure. Someone probing ids learns nothing either way. */
      return res.status(404).json({ error: 'Report not found.' });
    }
    req.report = report;
    next();
  };
}

/* --------------------------------------------------------------------------
   POST /api/reports/:id/upload-url
   Body: { filename, contentType, size }
   → { uploadId, url, expiresIn, headers }

   The browser then PUTs the bytes straight to B2. They never touch this
   server, which is the whole point of presigning.
   -------------------------------------------------------------------------- */
router.post('/:id/upload-url', requireAuth, loadAndGate('file:upload'), async (req, res, next) => {
  try {
    const { filename, contentType, size } = req.body || {};

    /* Same validator the submission form runs — shared/policy.js again. The
       browser's copy saves a round trip; this one is the rule. */
    const check = policy.validateUpload({ filename, contentType, size });
    if (!check.ok) return res.status(400).json({ error: check.error });

    /* The SERVER mints the key. Nothing client-supplied reaches it except the
       extension, which validateUpload has already constrained to pdf/docx/pptx. */
    const objectKey = storage.buildKey(req.report.id, filename);
    const cfg = storage.config();
    const expiresAt = new Date(Date.now() + cfg.uploadTtl * 1000).toISOString();

    const uploadId = db.createUpload({
      reportId: req.report.id,
      userId: req.actor.id,
      objectKey,
      filename: String(filename).slice(0, 200),
      contentType: check.contentType,
      declaredSize: Number(size),
      expiresAt
    });

    const signed = await storage.presignUpload({ key: objectKey, contentType: check.contentType });

    res.json({
      uploadId,
      url: signed.url,
      expiresIn: signed.expiresIn,
      /* The PUT must send exactly this Content-Type or the signature fails. */
      headers: signed.headers,
      maxBytes: policy.MAX_UPLOAD_BYTES
    });
  } catch (err) { next(err); }
});

/* --------------------------------------------------------------------------
   POST /api/reports/:id/file
   Body: { uploadId }
   → { file }

   Called after the PUT succeeds. This is where the claim "I uploaded it" gets
   checked against B2 rather than believed: HeadObject confirms the object
   exists, and its REAL size is used, not the size the browser declared.
   -------------------------------------------------------------------------- */
router.post('/:id/file', requireAuth, loadAndGate('file:upload'), async (req, res, next) => {
  try {
    const { uploadId } = req.body || {};
    const up = db.uploadById(uploadId);

    /* Every one of these is a real attack path, not defensive noise:
       unknown id, someone else's upload, a ticket for a different report,
       replay of a spent ticket, or one that has aged out. */
    if (!up) return res.status(400).json({ error: 'Unknown upload.' });
    if (up.userId !== req.actor.id) return res.status(403).json({ error: 'That upload is not yours.' });
    if (up.reportId !== req.report.id) return res.status(400).json({ error: 'Upload does not belong to this report.' });
    if (up.consumedAt) return res.status(409).json({ error: 'That upload has already been recorded.' });
    if (new Date(up.expiresAt).getTime() < Date.now()) {
      return res.status(410).json({ error: 'That upload expired before it was confirmed.' });
    }
    if (!storage.isOwnedKey(up.objectKey, req.report.id)) {
      return res.status(400).json({ error: 'Malformed object key.' });
    }

    const head = await storage.headObject(up.objectKey);
    if (!head) return res.status(400).json({ error: 'No object was uploaded for that ticket.' });

    /* Presigned PUT cannot cap the body length, so the ceiling is enforced
       here, after the fact, by deleting anything oversized. */
    if (head.size > policy.MAX_UPLOAD_BYTES) {
      await storage.deleteObject(up.objectKey);
      db.consumeUpload(up.id);
      return res.status(413).json({ error: 'The file exceeds the 25 MB limit and was discarded.' });
    }

    const previous = req.report.file;
    const file = {
      key: up.objectKey,
      name: up.filename,
      size: head.size,                       /* B2's number, not the browser's */
      type: up.contentType,
      etag: head.etag,
      uploadedAt: db.nowISO(),
      uploadedBy: req.actor.id
    };

    const history = (req.report.history || []).concat([{
      at: db.nowISO(), by: req.actor.id,
      from: req.report.status, to: req.report.status,
      note: (previous ? 'File replaced: ' : 'File attached: ') + file.name
    }]);

    const updated = db.updateReport(req.report.id, { file, history });
    db.consumeUpload(up.id);

    /* Replacing a file leaves the old object unreachable — remove it. */
    if (previous && previous.key && previous.key !== file.key) {
      await storage.deleteObject(previous.key);
    }

    res.json({ file: updated.file, report: updated });
  } catch (err) { next(err); }
});

/* --------------------------------------------------------------------------
   GET /api/reports/:id/file-url
   → { url, expiresIn, name, size, type }

   The download gate. Note what is absent: any way to name a key. The caller
   names a report; can('file:download') → can('report:read') decides; the key
   comes from the row.
   -------------------------------------------------------------------------- */
router.get('/:id/file-url', requireAuth, loadAndGate('file:download'), async (req, res, next) => {
  try {
    const file = req.report.file;
    if (!file || !file.key) return res.status(404).json({ error: 'This record has no file attached.' });

    const signed = await storage.presignDownload({
      key: file.key,
      filename: file.name,
      contentType: file.type,
      inline: String(req.query.inline || '') === '1'
    });

    res.set('Cache-Control', 'no-store');   /* never let a signed URL be cached */
    res.json({
      url: signed.url,
      expiresIn: signed.expiresIn,
      name: file.name,
      size: file.size,
      type: file.type
    });
  } catch (err) { next(err); }
});

/* --------------------------------------------------------------------------
   DELETE /api/reports/:id/file — detach and purge from B2.
   -------------------------------------------------------------------------- */
router.delete('/:id/file', requireAuth, loadAndGate('file:delete'), async (req, res, next) => {
  try {
    const file = req.report.file;
    if (!file) return res.status(404).json({ error: 'This record has no file attached.' });

    const history = (req.report.history || []).concat([{
      at: db.nowISO(), by: req.actor.id,
      from: req.report.status, to: req.report.status,
      note: 'File removed: ' + file.name
    }]);

    const updated = db.updateReport(req.report.id, { file: null, history });
    await storage.deleteObject(file.key);
    res.json({ report: updated });
  } catch (err) { next(err); }
});

module.exports = router;
