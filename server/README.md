# EuroSpaceHub backend — sessions, reports, and B2 file storage

Node + Express + SQLite, with Backblaze B2 for files over its S3-compatible API.

---

## Why a small server rather than serverless

You asked me to recommend. **A single Express process fits this better**, for four
reasons specific to this app:

- **Presigning needs a long-lived credential.** On one server it lives in one process's
  environment. Spread across serverless functions it has to be replicated into every
  function's config — more places to leak from, more places to rotate.
- **Every file decision costs a session lookup and a report read.** With SQLite that is an
  in-process read. Serverless would need a hosted database plus pooling to avoid exhausting
  connections, for a workload that does not need it.
- **Same-origin means no CORS and no third-party cookie problem.** The server serves the
  frontend, so the session cookie is first-party and `SameSite=Lax` is enough. Split them
  and you are managing CORS, `SameSite=None`, and a preflight on every call.
- **One file to back up** (`data/hub.db`), one process to restart.

Serverless earns its keep on spiky, stateless traffic. A research group's report hub is
neither. If you later need it, the boundary is clean: `routes/files.js` has no Express
dependency beyond the router.

---

## Setup

```bash
cd server
npm install
cp .env.example .env      # fill in the B2 keys
npm run seed              # creates the supervisor account, prints its password once
npm start                 # http://localhost:3000
```

Node 22.5+ is required — the database uses the built-in `node:sqlite`, so there is no
native module to compile. Passwords use `node:crypto` scrypt for the same reason.

`GET /api/health` reports whether B2 is actually reachable with the configured credentials.

---

## B2 bucket CORS

The browser uploads **directly** to B2, so B2 itself must allow your origin. This is
separate from the app and cannot be set from code with the S3 API — paste it in the
B2 console.

**B2 Console → Buckets → EuroSpaceHub → CORS Rules → Custom.** The JSON is in
[`b2-cors.json`](b2-cors.json):

```json
[
  {
    "corsRuleName": "eurospacehub-local-dev",
    "allowedOrigins": ["http://localhost:3000"],
    "allowedOperations": ["s3_put", "s3_get", "s3_head"],
    "allowedHeaders": ["*"],
    "exposeHeaders": ["etag"],
    "maxAgeSeconds": 3600
  },
  {
    "corsRuleName": "eurospacehub-production",
    "allowedOrigins": ["https://hub.eurospacehub.com"],
    "allowedOperations": ["s3_put", "s3_get", "s3_head"],
    "allowedHeaders": ["*"],
    "exposeHeaders": ["etag"],
    "maxAgeSeconds": 3600
  }
]
```

Replace `hub.eurospacehub.com` with your real origin before pasting. Notes:

- **Origins are exact.** Scheme, host and port must match what the browser sends. Include
  every origin you serve from; `http://localhost:3000` and `http://127.0.0.1:3000` are
  different origins to a browser.
- `s3_put` covers upload, `s3_get` download, `s3_head` the preflight the SDK triggers.
  There is no `s3_delete` here on purpose — deletes happen server-side, never from a page.
- **Do not use `"*"`.** With presigned URLs a wildcard means any site can drive an upload
  with a URL it has managed to obtain.
- `corsRuleName` must be unique per bucket, alphanumeric and hyphens, ≤50 characters.
- Keep the bucket **Private**. Nothing here needs public read, and presigned GETs work fine
  against a private bucket.

---

## Two things that bite people with B2 + AWS SDK v3

**1. Checksum headers.** Since roughly SDK v3.729 the client adds
`x-amz-sdk-checksum-algorithm` and `x-amz-checksum-crc32` to `PutObject` by default. B2
does not implement those the way S3 does, so a presigned PUT signed with them fails with a
signature mismatch or a 501 the moment the browser sends the body. `storage.js` therefore
sets:

```js
requestChecksumCalculation: 'WHEN_REQUIRED',
responseChecksumValidation: 'WHEN_REQUIRED'
```

**Do not remove those.** This is the single most common reason "it works against S3 but not
B2".

**2. Bucket name case.** B2 bucket names are lowercase-only. Your `.env` says
`B2_BUCKET_NAME=EuroSpaceHub`, but the actual bucket is almost certainly `eurospacehub` —
use exactly what the B2 console shows. A mismatch surfaces as `NoSuchBucket` at boot, which
`verifyBucket()` prints as a readable message rather than letting it fail on first upload.
If you genuinely have a non-DNS-safe name, set `B2_FORCE_PATH_STYLE=true`.

---

## How permissions are actually enforced

The gate is [`shared/policy.js`](../shared/policy.js) — one file, no DOM, no storage. The
browser loads it with a `<script>` tag; this server `require`s the same file. There is no
second copy to drift.

`assets/js/auth.js` is now a thin wrapper that supplies the current actor. It decides which
**controls to render**. The server decides what **happens**, re-evaluating the same policy
against its own session row and its own report row.

### The download rule, concretely

```
GET /api/reports/:id/file-url
  → load the report from OUR database (not from the request)
  → policy.can('file:download', report, req.actor)      // = can('report:read', …)
  → 404 if false — not 403, so probing ids reveals nothing
  → presign a GET for the key stored on that row, 300s
```

**No endpoint anywhere accepts an object key from the client.** A key is not a capability:
knowing or guessing one grants nothing, because there is no route that will sign one on
request. Keys are also stripped from every API response — `routes/data.js` projects
`report.file` down to name/size/type before it leaves.

The upload side mirrors it: the client sends a filename, the **server** mints the key
(`reports/<reportId>/<uuid>.<ext>`), and a row in `uploads` binds that key to one report and
one user, single-use with an expiry. Confirmation `HEAD`s the object and records B2's real
size rather than the size the browser claimed — anything over 25 MB is deleted and rejected.

---

## Endpoints

| Method | Path | Gate |
|---|---|---|
| `POST` | `/api/auth/login` | throttled, uniform error |
| `POST` | `/api/auth/logout` | — |
| `GET` | `/api/auth/me` | — |
| `POST` | `/api/auth/password` | own session |
| `POST` | `/api/auth/users/:id/temporary-password` | `user:resetPassword` |
| `GET` | `/api/bootstrap` | returns only what the actor may see |
| `GET` | `/api/reports` | `visibleReports()` |
| `GET` `PATCH` `DELETE` | `/api/reports/:id` | `report:read` / `report:edit` / `report:delete` |
| `POST` | `/api/reports` | `report:create` |
| `POST` | `/api/reports/:id/status` | `canTransition()` |
| `POST` | `/api/reports/:id/featured` | `report:feature` |
| `POST` | `/api/reports/:id/comments` | `comment:write` / `comment:writeInternal` |
| `POST` | `/api/reports/:id/upload-url` | `file:upload` → `report:edit` |
| `POST` | `/api/reports/:id/file` | `file:upload` (confirm) |
| `GET` | `/api/reports/:id/file-url` | `file:download` → `report:read` |
| `DELETE` | `/api/reports/:id/file` | `file:delete` → `report:edit` |
| `GET` `PATCH` | `/api/users/:id` | `user:read` / `user:edit` |

---

## Housekeeping

An hourly sweep drops expired sessions and deletes B2 objects from presigns that were never
confirmed — an abandoned upload is otherwise billable storage nobody can reach. Replacing a
file deletes the object it replaced.

---

## Still to do

- **Invite-only registration.** Agreed in the last round and not built yet: there is
  currently no public registration route on the server at all, which is the safe default
  but means accounts only come from `npm run seed` or a supervisor-issued password.
- **Reset emails.** `nodemailer` over SMTP, replacing the on-page token.
- **Frontend cutover.** Reads and file operations go through the API. Report and profile
  *writes* apply optimistically to the local cache and sync in the background; if the server
  refuses, the cache re-syncs and the user is told. That is honest but it is not the same as
  a fully server-driven UI — the remaining views should eventually await the server rather
  than assume success.
