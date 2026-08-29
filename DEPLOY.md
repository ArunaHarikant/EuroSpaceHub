# Deploying EuroSpaceHub

This app is **not** a static site — it needs a host that runs Node. **GitHub
Pages cannot host it** (Pages serves static files only; there is no server to
answer `/api`). One process serves both the frontend and the API from the same
origin, so the session cookie is first-party and there is no CORS to configure.

Node **22.13+** is required (the database uses the built-in `node:sqlite`).

## Free vs durable — read this first

The database is a **single SQLite file**. Free hosting tiers give an
**ephemeral filesystem**: the app runs, but that file is wiped on every restart,
redeploy, or idle spin-down. So:

- **Free and it just works (data resets):** any free host below. Perfect for
  showing the app live or a portfolio demo. **Real reports would not survive a
  restart** — do not use this to store work you care about keeping.
- **Free AND your data survives:** set the five `B2_*` env vars. **Litestream is
  already built into the image** and auto-activates when B2 is configured —
  `docker-entrypoint.sh` restores the SQLite file from B2 on boot and
  `litestream replicate` streams every change back to it (under the
  `litestream/` key prefix, alongside — but separate from — report files). The
  app runs SQLite in WAL mode, which Litestream requires. No extra service, no
  cost beyond B2's free tier. This is the recommended production setup.
- **Paid and simplest:** a small persistent disk (~a few $/month on Render/Fly),
  mounted at `/data`. With a disk, the local file persists and Litestream simply
  replicates it as an off-host backup.

The entrypoint decides automatically: **B2 set → durable (Litestream); B2 unset →
plain `node index.js` on the local disk.** One image, both modes.

## What you decide (I can't do these for you)

1. **A host account** — creating it is yours. None below require a card for the
   free tier, but confirm that when you sign up (terms change).
2. **A Backblaze B2 bucket + application key** — for report files. Yours to
   create; the keys are secrets I must never handle.

## Fastest free path — Render (uses `render.yaml`)

1. **B2 first.** Create a private bucket and an application key scoped to it
   (permissions: listBuckets, listFiles, readFiles, writeFiles, deleteFiles).
   Note the key id, key, bucket name, endpoint and region.
2. **Render → New → Blueprint**, connect this repo. It reads `render.yaml` and
   builds the `Dockerfile` on the **free** plan.
3. When prompted, fill the secret env vars (the `sync: false` ones):
   `B2_KEY_ID`, `B2_APPLICATION_KEY`, `B2_BUCKET_NAME`, `B2_ENDPOINT`,
   `B2_REGION`, and `SEED_SUPERVISOR_EMAIL` (the professor's login email).
4. Deploy. The first boot creates the database.
5. **Create the supervisor account** — open the Render **Shell** for the service
   and run:
   ```
   node seed.js
   ```
   It prints the supervisor's password **once** — save it. That is the only
   account that exists; everyone else is created from the dashboard in-app.
   (On the free ephemeral tier you will re-run this after a restart wipes the
   database — another reason to add Litestream once you want it permanent.)
6. **B2 bucket CORS** — in the B2 console, add your deployed origin (e.g.
   `https://eurospacehub.onrender.com`) to the bucket's CORS rules. The JSON is
   in [`server/b2-cors.json`](server/b2-cors.json). Uploads go browser → B2
   directly, so B2 must allow the origin. Without this, sign-in and browsing
   work but file **uploads** fail.

The app is then live at the host's URL. Sign in with the supervisor account.

Other free hosts that run this Dockerfile the same way: **Koyeb** (free nano
instance) and **Fly.io** (`fly launch` detects the Dockerfile). All are ephemeral
on the free tier unless you add a volume/Litestream.

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
