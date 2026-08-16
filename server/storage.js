/* ==========================================================================
   storage.js — Backblaze B2 via its S3-compatible API (AWS SDK v3).

   The bucket is PRIVATE. Nothing is ever made public and no object URL is
   ever handed out unsigned. Both directions are presigned:

     upload    presigned PUT   — the browser sends the bytes straight to B2,
                                 so report files never transit this server
     download  presigned GET   — short-lived (default 300s), issued only after
                                 the caller has passed the shared policy gate

   TWO THINGS THAT BITE PEOPLE WITH B2 AND SDK v3
   ----------------------------------------------
   1. CHECKSUMS. Since ~v3.729 the SDK adds `x-amz-sdk-checksum-algorithm` and
      `x-amz-checksum-crc32` to PutObject by default. B2 does not implement
      those headers the way S3 does, so a presigned PUT signed with them fails
      with a signature mismatch or 501 the moment the browser sends the body.
      Both flags below must stay `WHEN_REQUIRED`. This is the single most
      common reason "it works against S3 but not B2".

   2. BUCKET NAME CASE. B2 bucket names are lowercase-only, and virtual-hosted
      addressing needs a DNS-safe name. The configured name is used verbatim;
      if it contains uppercase, set B2_FORCE_PATH_STYLE=true or rename the
      bucket. verifyBucket() below fails loudly at boot rather than at the
      first upload.
   ========================================================================== */
'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { S3Client, PutObjectCommand, GetObjectCommand,
        HeadObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const policy = require('../shared/policy.js');

const REQUIRED = ['B2_KEY_ID', 'B2_APPLICATION_KEY', 'B2_BUCKET_NAME', 'B2_ENDPOINT', 'B2_REGION'];

function config() {
  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error('Missing B2 configuration: ' + missing.join(', ') +
                    '. Copy server/.env.example to server/.env and fill it in.');
  }
  return {
    bucket: process.env.B2_BUCKET_NAME,
    endpoint: process.env.B2_ENDPOINT,
    region: process.env.B2_REGION,
    forcePathStyle: String(process.env.B2_FORCE_PATH_STYLE || 'false') === 'true',
    uploadTtl: Number(process.env.UPLOAD_URL_TTL_SECONDS || 900),     /* 15 min */
    downloadTtl: Number(process.env.DOWNLOAD_URL_TTL_SECONDS || 300)  /* 5 min  */
  };
}

let _client = null;
function client() {
  if (_client) return _client;
  const cfg = config();
  _client = new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    forcePathStyle: cfg.forcePathStyle,
    credentials: {
      accessKeyId: process.env.B2_KEY_ID,
      secretAccessKey: process.env.B2_APPLICATION_KEY
    },
    /* See note 1 in the header — do not remove. */
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED'
  });
  return _client;
}

/* ---------------- keys ----------------
   The SERVER decides the key. A client-supplied key would let a caller write
   over another report's file or read outside its own prefix, so the only
   client input is the original filename, and only its extension survives. */

function buildKey(reportId, filename) {
  const ext = policy.extensionOf(filename);
  const safeReport = String(reportId).replace(/[^A-Za-z0-9_-]/g, '');
  if (!safeReport) throw new Error('buildKey: unusable report id');
  return `reports/${safeReport}/${crypto.randomUUID()}.${ext}`;
}

/* Belt and braces: a key must look like one we minted before we sign it. */
function isOwnedKey(key, reportId) {
  const safeReport = String(reportId).replace(/[^A-Za-z0-9_-]/g, '');
  return typeof key === 'string' &&
         new RegExp('^reports/' + safeReport + '/[0-9a-f-]{36}\\.[a-z0-9]{1,8}$').test(key);
}

/* Keep the download filename readable without letting it break the header. */
function safeDownloadName(name) {
  const base = path.basename(String(name || 'report'));
  const cleaned = base.replace(/[^A-Za-z0-9 ._-]/g, '_').slice(0, 120);
  return cleaned || 'report';
}

/* ---------------- presigning ---------------- */

/**
 * presignUpload({ key, contentType }) → { url, expiresIn, headers }
 * The browser must PUT with exactly the Content-Type it was signed for; any
 * other value invalidates the signature.
 */
async function presignUpload({ key, contentType }) {
  const cfg = config();
  const cmd = new PutObjectCommand({
    Bucket: cfg.bucket,
    Key: key,
    ContentType: contentType
  });
  const url = await getSignedUrl(client(), cmd, { expiresIn: cfg.uploadTtl });
  return { url, expiresIn: cfg.uploadTtl, headers: { 'Content-Type': contentType } };
}

/**
 * presignDownload({ key, filename, contentType, inline }) → { url, expiresIn }
 * Short-lived by design: the URL is a bearer capability, so it should outlive
 * the click and little else.
 */
async function presignDownload({ key, filename, contentType, inline }) {
  const cfg = config();
  const disposition = (inline ? 'inline' : 'attachment') +
                      '; filename="' + safeDownloadName(filename) + '"';
  const cmd = new GetObjectCommand({
    Bucket: cfg.bucket,
    Key: key,
    ResponseContentDisposition: disposition,
    ResponseContentType: contentType || 'application/octet-stream'
  });
  const url = await getSignedUrl(client(), cmd, { expiresIn: cfg.downloadTtl });
  return { url, expiresIn: cfg.downloadTtl };
}

/* ---------------- object operations ---------------- */

/** headObject(key) → { size, contentType, etag } | null */
async function headObject(key) {
  const cfg = config();
  try {
    const out = await client().send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }));
    return {
      size: Number(out.ContentLength || 0),
      contentType: out.ContentType || '',
      etag: out.ETag || ''
    };
  } catch (err) {
    const code = err && (err.name || err.Code);
    if (code === 'NotFound' || code === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404) return null;
    throw err;
  }
}

async function deleteObject(key) {
  if (!key) return;
  const cfg = config();
  try {
    await client().send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }));
  } catch (err) {
    /* A failed cleanup must never fail the request that triggered it; the
       object is orphaned, not dangerous — it is unreachable without a
       presigned URL and the key is gone from the database. */
    console.warn('[storage] could not delete %s: %s', key, err.message);
  }
}

/** Boot check: prove the credentials and bucket work before serving traffic. */
async function verifyBucket() {
  const cfg = config();
  try {
    /* HeadObject on a key that will not exist still exercises auth + bucket
       resolution, and unlike HeadBucket it needs no extra capability on the
       application key. */
    await client().send(new HeadObjectCommand({
      Bucket: cfg.bucket,
      Key: '__connectivity_check__/' + crypto.randomUUID()
    }));
    return { ok: true, bucket: cfg.bucket };
  } catch (err) {
    const status = err?.$metadata?.httpStatusCode;
    const name = err?.name || '';
    if (status === 404 || name === 'NotFound' || name === 'NoSuchKey') {
      return { ok: true, bucket: cfg.bucket };          /* reached the bucket */
    }
    if (status === 403 || name === 'AccessDenied' || name === 'InvalidAccessKeyId' ||
        name === 'SignatureDoesNotMatch') {
      return { ok: false, bucket: cfg.bucket,
               error: 'B2 rejected the credentials (' + name + '). Check B2_KEY_ID / ' +
                      'B2_APPLICATION_KEY, and that the key is scoped to this bucket.' };
    }
    if (name === 'NoSuchBucket') {
      return { ok: false, bucket: cfg.bucket,
               error: 'Bucket "' + cfg.bucket + '" not found. B2 bucket names are lowercase-only — ' +
                      'check the spelling, or set B2_FORCE_PATH_STYLE=true.' };
    }
    return { ok: false, bucket: cfg.bucket, error: name + ': ' + err.message };
  }
}

module.exports = {
  config, client, buildKey, isOwnedKey, safeDownloadName,
  presignUpload, presignDownload, headObject, deleteObject, verifyBucket
};
