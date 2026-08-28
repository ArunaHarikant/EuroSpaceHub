# Deploying EuroSpaceHub

This app is **not** a static site — it needs a host that runs Node. **GitHub
Pages cannot host it** (Pages serves static files only; there is no server to
answer `/api`). One process serves both the frontend and the API from the same
origin, so the session cookie is first-party and there is no CORS to configure.

Node **22.13+** is required (the database uses the built-in `node:sqlite`).

## What you decide (I can't do these for you)

1. **A host account** — Render, Fly.io, Railway, or a VPS. Creating the account
   is yours.
2. **A Backblaze B2 bucket + application key** — for report files. Yours to
   create; the keys are secrets I must never handle.
3. **The persistent-storage tradeoff** — the database is a SQLite file. It must
   live on a **persistent disk/volume**, or it is wiped on every restart. Free
   tiers with ephemeral filesystems will lose data. Budget for a small disk, or
   pick a host with a free volume (Fly.io).

## Fastest path — Render (uses `render.yaml`)

1. **B2 first.** Create a private bucket and an application key scoped to it
   (permissions: listBuckets, listFiles, readFiles, writeFiles, deleteFiles).
   Note the key id, key, bucket name, endpoint and region.
2. **Render → New → Blueprint**, connect this repo. It reads `render.yaml`,
   builds the `Dockerfile`, and attaches a 1 GB disk at `/data`.
3. When prompted, fill the secret env vars (the `sync: false` ones):
   `B2_KEY_ID`, `B2_APPLICATION_KEY`, `B2_BUCKET_NAME`, `B2_ENDPOINT`,
   `B2_REGION`, and `SEED_SUPERVISOR_EMAIL` (the professor's login email).
4. Deploy. The first boot creates the database on the disk.
5. **Create the supervisor account** — open the Render **Shell** for the service
   and run:
   ```
   node seed.js
   ```
   It prints the supervisor's password **once** — save it. That is the only
   account that exists; everyone else is created from the dashboard in-app.
6. **B2 bucket CORS** — in the B2 console, add your deployed origin (e.g.
   `https://eurospacehub.onrender.com`) to the bucket's CORS rules. The JSON is
   in [`server/b2-cors.json`](server/b2-cors.json). Uploads go browser → B2
   directly, so B2 must allow the origin. Without this, sign-in and browsing
   work but file **uploads** fail.

The app is then live at the host's URL. Sign in with the supervisor account.

## Any other host

The `Dockerfile` is host-agnostic. On Fly.io: `fly launch` (it detects the
Dockerfile), add a volume mounted at `/data`, and set the same env vars with
`fly secrets set`. On a VPS: `docker build -t eurospacehub . && docker run -p
80:3000 -v /srv/esh-data:/data --env-file server/.env eurospacehub`.

## About the old GitHub Pages URL

`arunaharikant.github.io/EuroSpaceHub` is static hosting and cannot run this
app — it shows the "cannot reach its server" screen by design. Once the real
deployment is live, either retire that URL or replace its content with a
redirect to the deployed app. Pointing the Pages frontend at a cross-origin API
is possible but reintroduces CORS and third-party-cookie problems the
same-origin deployment avoids; not recommended.

## What still works without B2

Everything except file upload/download: sign-in, submitting reports and
weeklies, visibility, the review queue, comments, the library. `GET /api/health`
reports whether B2 is actually reachable.
