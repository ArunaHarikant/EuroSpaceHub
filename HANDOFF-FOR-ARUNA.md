# Getting the Research Hub live — step-by-step for Aruna

This puts the weekly-report tool online at a real web address that anyone in the
group can use. It's free, needs no credit card, and takes about 20 minutes.

You do **not** need to understand the code. Just follow the steps in order.

---

## What you're doing, in one sentence

The website is finished, but a website like this needs a "server" to run on.
GitHub Pages (where it was before) can't run a server, which is why it showed
"cannot reach its server." We'll put it on **Render**, a free service that can.

**Skip Backblaze / file uploads for now.** Everything works without it —
submitting weeklies, sharing, the professor's review queue, comments, the
library. Only *attaching PDF files* to a report needs an extra service, and we
can add that later. Don't let it block you.

---

## Before you start

- The code is already on GitHub at **github.com/ArunaHarikant/EuroSpaceHub**.
  You own it, so you're all set there.
- Have that GitHub login handy.

---

## Step 1 — Merge the deployment files (1 minute)

There's a pull request waiting that adds the files Render needs.

1. Go to **github.com/ArunaHarikant/EuroSpaceHub/pulls**
2. Open the one titled **"Add deployment config…"**
3. Click the green **Merge pull request**, then **Confirm merge**.

That's it — the `Dockerfile` and `render.yaml` are now in the project.

## Step 2 — Make a Render account (2 minutes)

1. Go to **render.com**.
2. Click **Get Started** / **Sign Up**, and choose **Sign in with GitHub** (use
   the same GitHub account that owns the repo). It will **not** ask for a card.
3. When GitHub asks, **authorize Render** to see your repositories.

## Step 3 — Deploy the app (5 minutes)

1. In Render, click **New +** (top right) → **Blueprint**.
2. Find and select the **EuroSpaceHub** repository, click **Connect**.
3. Render reads the project's `render.yaml` and shows a service called
   **eurospacehub**. It will ask you to fill in one value:
   - **SEED_SUPERVISOR_EMAIL** → type the professor's login email, e.g.
     `bernard.foing@eurospacehub.local` (this is just the username he'll sign in
     with — it does not send any email).
4. Click **Apply** / **Create**. Render now builds the app. This takes a few
   minutes — you'll see logs scroll by. Wait for it to say **Live**.

When it's live, Render shows a web address like
**https://eurospacehub.onrender.com** — that's your hub. Open it; you'll see the
sign-in screen.

## Step 4 — Create the professor's login (2 minutes)

Right now there are zero accounts. Create the first one (the supervisor):

1. In Render, open your **eurospacehub** service → click the **Shell** tab.
2. Type this and press Enter:
   ```
   node seed.js
   ```
3. It prints a line like `Password: A1b2C3...` — **copy that password and save
   it somewhere safe.** It's shown only once.

Now go to your hub's web address, click **Sign in**, and log in with the
professor's email (from Step 3) and that password.

## Step 5 — You're live

From the supervisor dashboard, use **Add researcher** to create an account for
each student. Each gets a one-time password you hand to them. Students sign in,
click **Quick-submit a weekly**, and you'll see their weeklies in your review
queue.

---

## Two things to know

**1. Data resets on the free plan.** Render's free tier wipes the database
whenever the app restarts or sleeps after inactivity. That means accounts and
reports can disappear, and you'd re-run `node seed.js` (Step 4). This is fine for
trying it out and showing people. **Before real use, ask the developer to turn on
permanent storage** — it can be done for free (a tool called Litestream) or with
a small paid disk (~a few dollars a month). One message to the dev and it's
handled.

**2. The free app "sleeps."** After ~15 minutes of no use it spins down, so the
very first visit after a quiet spell takes ~30 seconds to wake up. Normal for
free hosting.

---

## About the existing eurospacehub.com website

You asked whether this should live inside **eurospacehub.com/about**. Short
answer: **not yet, and it doesn't need to.**

- We don't know who controls that site or how it's built, and wiring a login-based
  tool into someone else's site is fiddly (it introduces cross-site cookie and
  security issues this standalone setup avoids).
- For now, the hub stands on its own at the Render address. That's a complete,
  usable tool.
- **Later**, if you want it under the eurospacehub.com brand, the clean options
  are: (a) put a link/button on eurospacehub.com pointing to the hub, or (b) give
  the hub a custom address like `hub.eurospacehub.com` (Render supports custom
  domains — whoever manages the eurospacehub.com domain adds one DNS record). Both
  are easy once someone with access to that domain is in the loop.

Get it running standalone first. Branding and integration are a later, separate
task.

---

## If something goes wrong

- **Build failed / red status:** open the service's **Logs** tab and send the
  last ~20 lines to the developer.
- **"cannot reach its server" on the page:** the app is still starting or
  asleep — wait a minute and click **Try again**. If it persists, check the
  service is **Live** in Render.
- **Forgot the supervisor password:** re-run `node seed.js` in the Shell (on the
  free tier it'll make a fresh one after a reset).
