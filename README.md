# Prof. Bernard Foing — Lunar & Mars Research Hub

A self-contained research-output module for the [EuroSpaceHub](https://www.eurospacehub.com/)
platform. It gives Prof. Bernard Foing's interns and student researchers — across ISU, ILEWG
campaigns, VU Amsterdam and partner institutions — a place to hold a researcher profile, submit
lunar and Mars research reports, and have those reports reviewed, approved and published from a
single supervisor dashboard.

**This hub is closed.** It is a working tool for researchers already placed with Prof. Foing — not a
recruitment channel and not a public archive. There is no internship application or enquiry form,
and no submitted work is published outside the group. A signed-out visitor sees only the landing
page — which names the hub and offers a way in, nothing more — and the sign-in screen; reports, the
report library and every researcher profile require a session.

The module drops into the host platform's navigation (ABOUT / PARTNERS / ACADEMY / BLOG /
PUBLICATIONS) and also runs standalone.

---

## Read this first

**There is one build, and it needs its server.** The frontend is not a
standalone page with an optional backend: it has no offline mode, no local data
and no client-side authentication. Opened without the server it says it cannot
reach one, which is the honest answer — without the server there is no data, no
session and no access control, so there is nothing to show.

- Passwords are hashed with scrypt and never leave the server.
- The session is an **httpOnly cookie** backed by a `sessions` row — not a
  string the browser owns.
- `can()` runs **server-side** on every request, against the actor from the
  session row. A field the caller may not read is absent from the JSON rather
  than hidden by the page.
- Report files go **browser → B2 directly** through a short-lived presigned PUT;
  the bytes never pass through the app host, and object keys are never sent to
  the browser.
- There is no self-service registration and no self-service password reset. The
  hub is closed: accounts are **issued by the supervisor**, and so are
  replacement passwords.

> **This used to be two builds.** A `localStorage` demo mode ran alongside the
> real one, selected at load time. It was removed, because every write needed two
> correct code paths and the wrong one failed *silently* — several features were
> discarded by the server for months with no error anywhere. To show the hub
> without a real research group behind it, seed a scratch database with
> placeholder content instead (see [Showing it to someone](#showing-it-to-someone)).
> The demo is now data, not a second implementation.

---

## Running it

Node 22.13+ — the database uses the built-in `node:sqlite`, so there is no native
module to compile and no database service to stand up. (The module arrived in
22.5 but behind `--experimental-sqlite`; 22.13 is where it works unflagged.)

```bash
cd server
npm install
cp .env.example .env      # fill in the B2 keys
npm run seed              # creates the supervisor account, prints its password once
npm start                 # http://localhost:3000
```

The server also serves the frontend, so the session cookie is first-party and
there is no CORS to configure between them. `GET /api/health` reports whether B2
is actually reachable with the configured credentials.

The **frontend** itself has no build step, no dependencies and no framework.
Scripts are classic `<script>` tags rather than ES modules, which keeps the
whole thing debuggable with nothing but devtools.

Full backend notes — B2 bucket CORS, deployment, why one Express process rather
than serverless — are in [`server/README.md`](server/README.md).

### Showing it to someone

To demonstrate the hub without a real research group, seed a **scratch database**
with placeholder people and placeholder reports:

```bash
cd server
DB_PATH=./data/demo.db ALLOW_DEMO_SEED=1 npm run seed:demo
DB_PATH=./data/demo.db npm start
```

Every seeded account uses the password `demo-password`, and they are the only
accounts in that database:

| Email | Role |
|---|---|
| `supervisor@demo.eurospacehub.local` | Supervisor — full access |
| `cosupervisor@demo.eurospacehub.local` | Supervisor — a second one |
| `intern.a@…` · `intern.b@…` · `intern.c@…` | Researchers |

Six reports spread across the workflow, so every state, badge and dashboard
figure has something behind it.

`seed:demo` **refuses** to run without `ALLOW_DEMO_SEED=1`, and refuses outright
against a database holding any account it did not create. Placeholder people
turning up in a real supervisor's roster is the accident it has to be incapable
of causing — point `DB_PATH` at a scratch file, never at a live one.

---

## Access control

Three roles. The rules below are enforced through one gate — `can(action, resource, actor)` in
[`shared/policy.js`](shared/policy.js) — plus three derived helpers. That same gate runs again on the
server for every request; the server's answer is the one that counts.

### Signed-out visitor

**Nothing.** This hub is closed. A signed-out visitor gets exactly two surfaces: the landing page —
a gateway carrying no biography, no report titles, no researcher names and no counts — and the
sign-in screen. No reports, no report library, no researcher profiles, not even a count of how much
work exists. `visibleReports()` returns an **empty list** for them, not a filtered one, and in API
mode `/bootstrap` returns empty arrays to an unauthenticated caller rather than relying on the
browser to filter.

### Researcher (intern / student)

Authenticated access to **their own** profile and **their own** reports in every state. They may
create reports, and edit them while in `Draft` or `Submitted` — that is, up until the supervisor
opens the record for review — and again in `Revisions Requested`. They may submit and withdraw
their own work, and reply to review comments on it. They may also read reports the supervisor has
**released** (Approved or Published) through the shared library, and the redacted profile of
whoever wrote them. They **cannot** see another intern's unreleased records, another intern's
contact details or research-period dates, internal supervisor comments, the internal notes on their
own profile, or the dashboard.

### Supervisor

Everything: all researcher profiles including email and internal notes, all reports in all states,
all comments including internal ones, every workflow transition, featuring records, setting a
researcher's standing, bulk actions, analytics, creating accounts and issuing replacement passwords.
The role is not tied to one account: co-supervisors are peers, and nothing in the code singles out a
particular id.

### How it is enforced

The rules live in **one file that both sides load**: [`shared/policy.js`](shared/policy.js) is a
`<script>` tag in the browser and a `require()` in the server. There is no client copy to drift out
of sync — a test asserts the two are literally the same module instance.

| Mechanism | Where |
|---|---|
| `can(action, resource, actor)` — the single authorisation gate | `shared/policy.js` |
| `visibleReports(actor)` — every list view derives from this, never from the raw store | `shared/policy.js` |
| `visibleComments(report, actor)` — strips internal comments for non-supervisors | `shared/policy.js` |
| `projectUser(target, actor)` — returns only the fields the actor may read | `shared/policy.js` |
| `guard(requirement)` — route-level gate, applied in the route table | `auth.js` / `app.js` |
| The same gate, re-run server-side on every request | `server/routes/*.js` |

`actor` is a required, explicit argument — there is deliberately no ambient session in the policy
module. On the server the actor comes from the session row; the request body is never consulted.

Two deliberate choices worth noting:

1. **Guards are not the only check.** Every mutating control re-calls `can()` immediately before it
   writes, so a routing mistake cannot become a permission bug.
2. **The library does not filter a privileged query.** `views/library.js` builds from
   `store.releasedReports()` (the Approved + Published set) directly, so an unapproved record cannot
   leak into the shared archive through a permission bug — it was never in the result set.
3. **"Public" was renamed out of the model.** The status flag is `released`, the query is
   `releasedReports()`, the predicate is `isReleased()`. Nothing here is public, so calling the
   Approved/Published set "public" would actively mislead the next person reading the code. The
   per-profile `publicProfile` opt-in was deleted outright rather than left as a setting that does
   nothing.

### The client copy is an affordance, not a control

The browser's `can()` calls do exactly what they should: hide controls the user cannot use, so the
interface does not offer actions that will be refused. The authority is the identical check on the
server. If the two ever disagree the server wins, and the optimistic local change is rolled back by
re-hydrating from `/bootstrap` — see § talking to the server in [`store.js`](assets/js/store.js).

---

## Workflow

```
Draft ──► Submitted ──► Under Review ──► Approved ──► Published
  │           │              │              │            │
  │           │              ▼              │            ▼
  │           │      Revisions Requested ───┘        (unpublish)
  │           │              │
  └───────────┴──────────────┴──► Withdrawn (terminal) / Rejected (terminal)
```

- **Interns** may edit in `Draft`, `Submitted` and `Revisions Requested` — editing locks only once
  the supervisor opens the record (`Under Review`). They may withdraw at any point before approval.
  Edit and Withdraw controls sit on each row of their profile's submissions table.
- **Supervisors** drive every other transition, comment (publicly or internally), and feature records.
- `Approved` and `Published` are the two **released** states — visible to the group through the
  shared library. Nothing here is public; see the naming note above.
- Moving a record out of a public state **automatically clears its featured flag**, so the curated
  feed on the Foing page cannot retain a withdrawn or rejected item.

The exact transition table is in `shared/policy.js` and is rendered live at `#/access`.

---

## Pages

| Route | Who | What |
|---|---|---|
| `#/` | public | Prof. Foing's profile, biography, research focus, external links — plus members' entry points once signed in. Signed-out visitors see no reports and no researcher names |
| `#/library` | members | Searchable/filterable library of Approved + Published records shared with the group (mission area, type, author, year, keyword, sort) |
| `#/report/:id` | members | Record detail. A colleague gets abstract, metadata, file and citation for a released record. Author and supervisor additionally get workflow state, review thread and status history |
| `#/researcher/:id` | members | Researcher profile with progressive disclosure (see above) |
| `#/signin` | public | Sign-in. No role switcher and no way in without a password |
| `#/register` · `#/reset` | public | Both explain that the supervisor issues accounts and passwords |
| `#/inbox` | authenticated | Derived "waiting on you" list; its read-marker is per account and server-persisted |
| `#/me` · `#/researcher/:id/edit` | authenticated | Own profile and profile editing |
| `#/submit` · `#/report/:id/edit` | intern/supervisor | Report submission and editing |
| `#/dashboard` | supervisor | Analytics, full report table, researcher roster, account creation |
| `#/access` | public | The access-control model, rendered from the live rules |

---

## Accounts, passwords and files

### Accounts

Accounts are **issued by the supervisor** from the dashboard (Researchers →
*Add researcher*), never applied for. The server generates the initial password,
returns it exactly once, and stores only its scrypt hash — so it is displayed in
a dialog that says it will not be shown again. A password supplied in the
request body is ignored rather than honoured.

`#/register` renders an explanation instead of a form. That is a decision, not a
missing feature: an open registration form on a closed hub is a way in for anyone
who has the URL. `can('user:create')` is supervisor-only and enforced
server-side, so the absent form is a convenience rather than the control.

### Passwords

scrypt via `node:crypto`, salted per account, and never leaving the server.
Everyone can **change their own password** from their profile-edit page, which
requires the current one; doing so deletes every other session on that account
and re-issues only the calling tab's. The minimum length lives in
`shared/policy.js`, so the form and the server cannot drift apart.

There is **no self-service reset**. A reset link has to be emailed to prove
control of the mailbox, and no mail service is configured; a form that printed
its own token on the page would be an account-takeover hole rather than a
password reset. `#/reset` says so and points at the supervisor.

**Supervisor-issued replacement.** From any researcher profile, the supervisor
issues a temporary password, shown once, which replaces the account password
immediately and drops that user's sessions. It needs no email at all, and for a
closed group of this size it is arguably the right mechanism to keep even after
email works. Supervisors cannot reset each other.

### Files

Report files live in a **private Backblaze B2 bucket**. Uploads go browser → B2
directly through a presigned PUT that this server minted, against a single-use
`uploads` row binding the key to one report and one user; the server then HEADs
the object before recording it. Downloads are short-lived signed GETs issued
only after `can('file:download')` passes.

The bytes never touch the app host, and B2 object keys are never sent to the
browser — the page asks for a file by report id and the server resolves the key
itself. PDF, DOCX and PPTX, 25 MB.

---

## What the hub deliberately does not offer

Some things are absent by decision rather than omission, and each is enforced on
the server rather than merely left out of the page.

| Absent | Why |
|---|---|
| Self-service registration | An open form on a closed hub admits anyone with the URL. `can('user:create')` is supervisor-only. |
| Self-service password reset | A reset link must be emailed to prove control of the mailbox; no mail service is configured. A form that prints its own token is account takeover, not recovery. |
| Any way to assume a role | There is no impersonation path. Signing in as somebody requires their password. |
| Importing a data file | The server owns the data; a file could only overwrite a cache the next page load refills. Export stays — a dump of what you can see is a useful backup. |
| Anything public | A signed-out visitor gets the landing page and the sign-in screen. `visibleReports()` returns an empty list, and `/bootstrap` returns empty arrays rather than trusting the browser to filter. |

`#/register` and `#/reset` still resolve — to an explanation of who issues
accounts and passwords, so an old bookmark lands somewhere useful rather than on
a 404.

---

## Mission backdrop

The page sits on a decorative SVG layer showing real European (ESA) and United States (NASA)
lunar and Mars missions — orbiters riding orbit rings around the Moon and Mars, surface missions
marked on the discs. **SMART-1** and **Mars Express** are drawn emphasised: they are the two
missions Prof. Foing is personally associated with, as Principal Project Scientist and
co-investigator respectively.

| Body | Orbiters | Surface |
|---|---|---|
| Moon | SMART-1 (ESA) · LRO (NASA) · GRAIL (NASA) | Apollo (NASA) · Artemis (NASA, planned) |
| Mars | Mars Express (ESA) · ExoMars TGO (ESA) · MRO (NASA) · MAVEN (NASA) | Viking · Mars Pathfinder · Curiosity · Perseverance (NASA) · Rosalind Franklin (ESA, planned) |

Every mission named is real and publicly documented; planned missions are drawn in a dimmer
weight with a dashed orbit. ESA is keyed blue and NASA warm sand, but colour is never the only
channel — each mission is labelled in the artwork, and the hero carries a visible caption naming
what the backdrop shows, since the layer itself is `aria-hidden`.

Two variants, swapped on route change in [`backdrop.js`](assets/js/backdrop.js): the **full**
scene on the landing page, and a quiet **ambient** starfield everywhere else so dense views
(dashboard tables, long forms) stay uncluttered. The layer is fixed behind all content, has
`pointer-events: none`, and every card, table and form surface above it stays fully opaque. It is
hidden entirely in print, under `forced-colors`, and under `prefers-reduced-transparency`. There
is no animation.

---

## Design notes

Dark institutional palette (deep navy `#070b16` plane, `#0e1524` card surface, `#3987e5` accent),
system UI sans throughout, no display face, no animation beyond a toast fade.

The two dashboard charts are inline SVG with no library. Both answer a single-series
"compare these categories" question, so both are horizontal bars with one hue each, direct value
labels, hover tooltips and a table view — colour carries no information beyond identifying the
chart, so it is not varied per bar. The two hues (`--series-1` blue, `--series-2` orange) were
validated against the actual `#0e1524` chart surface: lightness band, chroma floor, CVD separation
(ΔE 26.8), normal-vision separation (ΔE 31.8) and ≥3:1 contrast all pass.

Status colours never carry meaning alone — every badge pairs a colour with a dot and a text label.

---

## File layout

```
index.html                    page shell, host-platform nav, script tags
config.js                     fallback API base; the server overrides /config.js
shared/
  policy.js                   THE authorisation gate + vocabularies — loaded by BOTH sides
assets/css/styles.css         design system (single stylesheet)
assets/js/
  api.js                      the client for the server; the only source of data
  store.js                    the read model over /bootstrap; no local data
  auth.js                     session handling; delegates every rule to shared/policy.js
  ui.js                       escaping, formatters, badges, modal, toasts
  export.js                   BibTeX / RIS / CSV citations, JSON backup
  charts.js                   inline-SVG bar charts
  backdrop.js                 decorative ESA/NASA mission backdrop
  router.js                   hash router with route guards
  app.js                      route table, chrome, bootstrap
  views/
    foing.js                  landing page (a gateway — no biography, no data)
    library.js                shared report library (Approved + Published)
    report.js                 report detail (all roles)
    account.js                sign-in, access-denied, and the two explanations
    profile.js                researcher profile + editing
    submit.js                 report submission + editing
    dashboard.js              supervisor dashboard + account creation
    inbox.js                  derived "waiting on you" notifications
    misc.js                   access-control page (from the live rules), 404
server/
  index.js                    Express app, static hosting, /config.js override
  db.js                       SQLite schema, additive migrations, row mapping
  session.js                  scrypt hashing, httpOnly cookie sessions, requireAuth
  storage.js                  Backblaze B2 (S3-compatible) presigning
  seed.js                     creates the first supervisor account
  seed-demo.js                placeholder data for a scratch database
  routes/auth.js              login, logout, password change, temporary passwords
  routes/data.js              reports, comments, profiles, account creation
  routes/files.js             presigned upload / download / delete
  test/api.test.js            server-side authorisation tests
tests/
  smoke.mjs                   route + permission suite, against the REAL server
  boot-failure.mjs            what happens when the server does not answer
.github/workflows/ci.yml      runs all three suites on every pull request
```

### Tests

Three suites, and they test different things. All of them run on every pull
request — see [`.github/workflows/ci.yml`](.github/workflows/ci.yml). That matters more here than
usual: every bug this project has shipped in the server path failed *silently*, with the request
succeeding and the value simply gone on the next read. A round-trip assertion is the only thing
that catches that.

**`tests/smoke.mjs`** — boots the **real server** in-process against a throwaway SQLite database,
loads the real page in jsdom, and walks every route as each role. Every role change is a genuine
sign-in against a real session cookie; every list is what `/bootstrap` chose to send; every refusal
is the server's. It asserts that drafts never reach the shared library, that a researcher cannot
read internal comments *or receive them in the payload*, that redaction happens server-side rather
than in CSS, that the workflow transition table holds, and that user content is escaped.
**80 assertions.**

```bash
cd server && npm install     # express, to run the app
cd .. && npm install jsdom   # test-only
node tests/smoke.mjs
```

**`server/test/api.test.js`** — asserts what an **attacker** cannot do, against the real HTTP API
with real cookies. Nothing in it loads the frontend; the browser's opinion is irrelevant. It also
covers field round-trips, since a dropped column produces no error anywhere. **38 tests.** B2 is not
contacted: the presign path is covered by asserting requests are refused *before* any signing
happens, and the tests needing real Backblaze credentials skip unless `B2_KEY_ID` is set.

```bash
cd server && npm test
```

**`tests/boot-failure.mjs`** — the boot path when the server does **not** answer: the one case with
no happy result available, where the temptation is to render something anyway. An unreachable server
must not be dressed up as an empty hub, and a healthy server with an anonymous visitor — which looks
identical if you only count records — must not be dressed up as a failure. Both are asserted side by
side, because confusing them *is* the bug. Needs no database. **12 assertions.**

```bash
node tests/boot-failure.mjs
```

> jsdom ships neither `fetch` nor a cookie jar, and the app needs both. Both suites supply them in
> `beforeParse`. Without the `fetch` polyfill every API call throws `ReferenceError` and the suite
> measures the harness rather than the application — a trap that produced a wrong reading of this
> code once already.

---

## Content provenance

The landing page carries **no biographical content** about Prof. Foing — no titles, no publication
figures, no portrait. It names the hub, states its purpose in a sentence, and offers sign-in.
Earlier versions carried a full profile built from the publicly documented record; that was removed
once the hub became a closed working tool rather than a public showcase.

A production database starts with exactly one account — the supervisor `npm run seed` creates — and
nothing else. The placeholder people and reports in [`server/seed-demo.js`](server/seed-demo.js) are
explicit placeholders ("Intern Name A", "Sample Lunar Regolith Report"), they go only into a scratch
database you point `DB_PATH` at, and the script refuses to touch a database holding any account it
did not create. No real people and no real unpublished research are represented anywhere in this
repository.
