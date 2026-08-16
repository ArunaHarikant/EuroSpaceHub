# Prof. Bernard Foing — Lunar & Mars Research Hub

A self-contained research-output module for the [EuroSpaceHub](https://www.eurospacehub.com/)
platform. It gives Prof. Bernard Foing's interns and student researchers — across ISU, ILEWG
campaigns, VU Amsterdam and partner institutions — a place to hold a researcher profile, submit
lunar and Mars research reports, and have those reports reviewed, approved and published from a
single supervisor dashboard.

**This hub is closed.** It is a working tool for researchers already placed with Prof. Foing — not a
recruitment channel and not a public archive. There is no internship application or enquiry form,
and no submitted work is published outside the group. The only surface a signed-out visitor sees is
Prof. Foing's own profile page and the sign-in screen; reports, the report library and every
researcher profile require a session.

The module drops into the host platform's navigation (ABOUT / PARTNERS / ACADEMY / BLOG /
PUBLICATIONS) and also runs standalone.

---

## ⚠️ Read this first: authentication in this build is a stub

**There is no server, no session token, no password hashing and no server-side enforcement.**

- Sign-in compares a **plaintext password** held in `localStorage`.
- The "session" is a **user id string** in `localStorage`, which any visitor can edit from devtools.
- All data — accounts, reports, comments, internal notes — is stored **in the visitor's own browser**
  and is readable by anyone using that browser.
- A **demo role switcher** on the sign-in page lets you assume any role with no credentials at all.

This is stated on-screen too: a persistent DEMO MODE banner sits above the header, the sign-in and
registration pages carry explicit warnings, and `#/about-demo` documents the whole model.

What *is* real is the **shape** of the access model — see [Access control](#access-control) below.
Porting to a real backend is a substitution, not a rewrite.

---

## Running it

No build step, no dependencies, no framework. Scripts are classic `<script>` tags (not ES modules)
specifically so the module also works when opened straight from disk.

**Any static server:**

```bash
python -m http.server 8000
# then open http://localhost:8000/
```

**Or just open `index.html`** in a browser. `file://` works; only the `localStorage` quota behaves
slightly differently between browsers.

**Demo accounts** — every seeded account uses the password `demo`:

| Email | Role |
|---|---|
| `supervisor@demo.eurospacehub.local` | Supervisor (Prof. Foing) — full access |
| `cosupervisor@demo.eurospacehub.local` | Supervisor (designated co-supervisor) |
| `intern.a@demo.eurospacehub.local` … `intern.e@…` | Interns |

Signed out, you are a public visitor. **Reset demo data** in the footer restores the seeded state.

---

## Access control

Three roles. The rules below are enforced through one gate — `can(action, resource, actor)` in
[`assets/js/auth.js`](assets/js/auth.js) — plus three derived helpers.

### Signed-out visitor

**Nothing.** This hub is closed. A signed-out visitor gets exactly two surfaces: Prof. Foing's own
profile page (bio, titles, research focus, outbound links) and the sign-in / registration screen.
No reports, no report library, no researcher profiles — not even researcher names or a count of how
much work exists. `visibleReports()` returns an **empty list** for them, not a filtered one.

### Intern / student researcher

Authenticated access to **their own** profile and **their own** reports in every state. They may
create reports, and edit them while in `Draft` or `Submitted` — that is, up until the supervisor
opens the record for review — and again in `Revisions Requested`. They may submit and withdraw
their own work, and reply to review comments on it. They may also read reports the supervisor has
**released** (Approved or Published) through the shared library, and the redacted profile of
whoever wrote them. They **cannot** see another intern's unreleased records, another intern's
contact details or research-period dates, internal supervisor comments, the internal notes on their
own profile, or the dashboard.

### Supervisor (Prof. Foing; extensible to co-supervisors)

Everything: all intern profiles including email and internal notes, all reports in all states, all
comments including internal ones, every workflow transition, featuring records on the public page,
setting an intern's standing, bulk actions, and analytics. The role is not
hard-coded to one account — `u_cosup` is a second supervisor demonstrating extensibility.

### How it is enforced

| Mechanism | Where |
|---|---|
| `can(action, resource, actor)` — the single authorisation gate | `auth.js` |
| `visibleReports(actor)` — every list view derives from this, never from the raw store | `auth.js` |
| `visibleComments(report, actor)` — strips internal comments for non-supervisors | `auth.js` |
| `projectUser(target, actor)` — returns only the fields the actor may read | `auth.js` |
| `guard(requirement)` — route-level gate, applied in the route table | `auth.js` / `app.js` |

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

### Porting to a real backend

Replace the stub session with a real one and re-implement `can()` server-side against the same
action names (`report:read`, `report:setStatus`, `comment:readInternal`, `user:readInternalNotes`, …).
The client-side copy then becomes what it should be: a UI affordance that hides controls the user
cannot use, backed by an authority that actually enforces them.

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
- `Approved` and `Published` are the two public states.
- Moving a record out of a public state **automatically clears its featured flag**, so the curated
  feed on the Foing page cannot retain a withdrawn or rejected item.

The exact transition table is in `store.TRANSITIONS` and is rendered live at `#/about-demo`.

---

## Pages

| Route | Who | What |
|---|---|---|
| `#/` | public | Prof. Foing's profile, biography, research focus, external links — plus members' entry points once signed in. Signed-out visitors see no reports and no researcher names |
| `#/library` | members | Searchable/filterable library of Approved + Published records shared with the group (mission area, type, author, year, keyword, sort) |
| `#/report/:id` | members | Record detail. A colleague gets abstract, metadata, file and citation for a released record. Author and supervisor additionally get workflow state, review thread and status history |
| `#/researcher/:id` | members | Researcher profile with progressive disclosure (see above) |
| `#/register` · `#/signin` | public | Registration and stubbed sign-in with the demo role switcher |
| `#/me` · `#/researcher/:id/edit` | authenticated | Own profile and profile editing |
| `#/submit` · `#/report/:id/edit` | intern/supervisor | Report submission and editing |
| `#/dashboard` | supervisor | Analytics, full report table, researcher roster |
| `#/about-demo` | public | The access-control model, rendered from the live rules |

---

## Known limitations of the demo build

**Uploaded files are not persisted.** `localStorage` holds a few megabytes; PDFs would exhaust it
immediately. The store therefore saves a file's **name, size and type** and keeps the binary in an
in-memory blob for the current tab. Downloads work until you reload, after which the record shows
the metadata and states plainly that the file is unavailable. Silently dropping the upload, or
pretending it had been stored, would have been worse.

Other consequences of having no backend: profile photographs are referenced by URL rather than
uploaded, and password reset cannot email you (see below).

### Password reset

Two routes, at `#/reset` and from the supervisor's view of any researcher profile.

**Self-service link.** A researcher enters their address and a single-use token with a 30-minute
expiry is issued. The token is invalidated the moment it is spent and re-checked at spend time —
that lifecycle is the real thing.

**The part that is not real: no email is sent, because there is nothing to send it with.** The link
is rendered on the page instead of going to the mailbox, which means **anyone who knows an address
can reset that account**. The page says exactly that, in red, above the form.

A real backend answers *"if an account exists, we have emailed it"* either way, so the form cannot
be used to discover which addresses are registered. This build does **not** claim that, for two
reasons: it would be a lie (nothing was emailed), and displaying the link reveals whether the
account exists regardless — anti-enumeration cannot survive putting the token on screen. So the UI
states what actually happened, and an unmatched address is told so plainly, along with the reason it
is the most likely outcome: accounts live in one browser's `localStorage` and do not travel between
browsers, devices or private windows. `store.requestPasswordReset()` still implements the neutral
code path a real backend keeps; only the message differs.

Swapping this one step for a genuine emailed token is the single most important change a production
build must make. **Until then, prefer the supervisor-issued route below** — it is secure as designed,
whereas a reset form that prints its own token is worse than no reset form at all.

**Supervisor-issued temporary password.** Prof. Foing can issue a temporary password from any
researcher profile and hand it over directly. It is displayed once and replaces the account password
immediately. This route needs no email at all, and for a closed group of this size it is arguably
the better mechanism to keep even after email works. Supervisors cannot reset each other.

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
assets/css/styles.css         design system (single stylesheet)
assets/js/
  store.js                    data model, seed content, localStorage persistence
  auth.js                     STUBBED auth + the authorisation layer
  ui.js                       escaping, formatters, badges, modal, toasts
  charts.js                   inline-SVG bar charts
  backdrop.js                 decorative ESA/NASA mission backdrop
  router.js                   hash router with route guards
  app.js                      route table, chrome, bootstrap
  views/
    foing.js                  public hub landing page
    library.js                public report archive
    report.js                 report detail (all roles)
    account.js                sign-in, registration, access-denied
    profile.js                researcher profile + editing
    submit.js                 report submission + editing
    dashboard.js              supervisor dashboard
    misc.js                   access-control page, 404
tests/smoke.mjs               headless route + permission test suite
```

### Tests

`tests/smoke.mjs` loads the real page in jsdom over HTTP, walks every route as each role, and
asserts on both rendered output and the permission rules — including that drafts never reach the
public library, that interns cannot read internal comments, that the workflow transition table
holds, and that user content is escaped. 137 assertions.

```bash
python -m http.server 8731          # serve the app in one terminal
npm install jsdom                   # one dependency, test-only
node tests/smoke.mjs                # in another
```

---

## Content provenance

The landing page carries **no biographical content** about Prof. Foing — no titles, no
publication figures, no portrait. It names the hub, states its purpose in a sentence, and offers
sign-in. Earlier versions carried a full profile built from the publicly documented record; that
was removed once the hub became a closed working tool rather than a public showcase.

Every intern, report, abstract, comment and internal note in
the seed data is an explicit placeholder ("Intern Name A", "Sample Lunar Regolith Report") — no real
people and no real unpublished research are represented.
