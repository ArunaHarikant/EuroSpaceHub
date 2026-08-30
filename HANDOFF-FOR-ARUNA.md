# Getting the Research Hub online — a detailed guide for Aruna

This puts the weekly-report tool on a real web address the whole group can use.
It's free and needs no coding. Total time: about 20 minutes for the basic
version, plus 10 more if you do the "make it permanent" part.

**You do not need to understand the code.** Follow the steps in order. Each step
says what to click and what you'll see.

---

## Background (read once, then forget)

- A website like this has two halves: the **pages** you see, and a **server**
  running behind them that stores the accounts and reports.
- It used to be on **GitHub Pages**, which can only host the pages — not a
  server. That's why it showed *"The hub cannot reach its server."* Nothing is
  broken; it just needs somewhere that can run the server half.
- We'll use **Render** (render.com) — a free service that runs the whole thing.
- **You can ignore file uploads at first.** Everything works without them —
  submitting weeklies, sharing them, the professor's review queue, comments, the
  library. Only *attaching a PDF to a report* needs an extra service (covered at
  the end). Don't let it hold you up.

You'll create **one free account (Render)** for the basic version. That's it.

---

# PART A — Get it live (≈20 min, no credit card)

## Step 1 — Merge the deployment files on GitHub

A change is waiting that adds the files Render needs to run the app.

1. Go to **https://github.com/ArunaHarikant/EuroSpaceHub/pulls**
2. You'll see a list of "Pull requests." Click the one titled something like
   **"Add deployment config"** (there may be a couple of deploy-related ones —
   open the newest **Deploy** one).
3. Scroll down and click the green **Merge pull request** button, then
   **Confirm merge**.
4. It'll show "Merged" in purple. Done — the `Dockerfile` and `render.yaml`
   files are now part of the project.

*(If the green button is greyed out and says checks are running, wait a couple
minutes for the tests to finish, then it goes green.)*

## Step 2 — Create a Render account

1. Open **https://render.com**
2. Click **Get Started for Free** (or **Sign In**).
3. Choose **GitHub** as the sign-in method, and use the **same GitHub account
   that owns the EuroSpaceHub repository**.
4. GitHub will ask you to authorize Render — click **Authorize Render**.
5. If it asks which repositories Render may access, either allow all, or pick
   **EuroSpaceHub** specifically.

You will **not** be asked for a credit card for the free plan.

## Step 3 — Deploy the app

1. In the Render dashboard, click **New +** near the top right, then choose
   **Blueprint**.
   - *("Blueprint" means "read the settings file in the repo and set everything
     up for me" — that file is the `render.yaml` you just merged.)*
2. Find **EuroSpaceHub** in the list and click **Connect**.
3. Render reads the settings and shows a service named **eurospacehub**. It asks
   you to fill in **one** value, called **SEED_SUPERVISOR_EMAIL**:
   - Type the professor's sign-in email, for example
     **`bernard.foing@eurospacehub.local`**.
   - This is just the username he'll log in with. **No email is actually sent.**
     It can be any address-shaped text.
4. Click **Apply** (or **Create Services**).
5. Render now **builds** the app. You'll see logs scrolling. This takes roughly
   3–7 minutes. Wait until the status turns **Live** (green).

When it's live, near the top of the service page Render shows the web address,
like **`https://eurospacehub.onrender.com`**. Click it — you should see the hub's
**Sign in** screen. 🎉 The server half is now running.

## Step 4 — Create the professor's login

Right now there are **zero accounts**. Create the first one (the supervisor)
using Render's built-in command box:

1. On your **eurospacehub** service page in Render, click the **Shell** tab (left
   side or top, depending on layout).
2. A black command box appears. Type exactly:
   ```
   node seed.js
   ```
   and press **Enter**.
3. It prints a few lines, including one like:
   ```
   Password: 7Qx2Rf9kLmA
   ```
   **Copy that password and save it somewhere safe** (it is shown only once).

## Step 5 — Sign in and add your team

1. Go to your hub's web address and click **Sign in**.
2. Log in with the professor's email (Step 3) and the password (Step 4).
3. You land on the **Supervisor dashboard**. Use the **Add researcher** button to
   create an account for each student — each gets a one-time password you hand
   to them.
4. Students sign in, click **Quick-submit a weekly**, and their weeklies appear
   in your review queue with **Mark reviewed** / **Return to queue** buttons.

**You now have a working hub.** If you only want to try it out or demo it, you can
stop here — but read the one caveat below.

---

## ⚠️ Important caveat for Part A

On Render's **free** plan, the app's storage is temporary. Whenever the app
**restarts** (Render redeploys, or it goes to sleep after ~15 minutes of no use
and someone wakes it), the database is **wiped** — accounts and reports
disappear, and you'd redo Steps 4–5.

- **Totally fine** for: showing people, testing, a short demo.
- **Not fine** for: actually collecting weeklies you need to keep.

Also, because the free app sleeps, the **first visit after a quiet period takes
~30 seconds** to wake up. Normal for free hosting.

To fix the wipe permanently — for free — do Part B.

---

# PART B — Make it permanent (≈10 min, still free)

This adds free cloud storage that continuously backs up the database, so nothing
is lost when the free app restarts. **The same step also switches on file
attachments.** The backup tool is already built into the app; you just create the
storage and paste five values into Render.

> **One honest heads-up:** the storage service (Backblaze) usually asks for a
> **card on file** to switch on its B2 storage, even though you stay within the
> free 10 GB and won't be charged. If you refuse to put a card anywhere at all,
> skip Part B and live with the Part A caveat (or ask the developer about a small
> paid disk instead).

## Step 6 — Create Backblaze cloud storage

1. Go to **https://www.backblaze.com**, click **Sign Up**, and make a free
   account.
2. In the left menu, open **B2 Cloud Storage** (you may need to enable it; the
   first 10 GB are free).
3. Click **Buckets → Create a Bucket**:
   - **Bucket name:** something unique, e.g. `eurospacehub-yourname`
   - **Files in Bucket are:** **Private**
   - Create it.
4. On the bucket's page, note its **Endpoint** — it looks like
   `s3.us-west-004.backblazeb2.com`. The middle piece (`us-west-004`) is the
   **region**. Write both down.
5. In the left menu, open **Application Keys → Add a New Application Key**:
   - **Name:** `eurospacehub`
   - **Allow access to Bucket(s):** choose the bucket you just made
   - **Type of Access:** **Read and Write**
   - Create it. It now shows a **keyID** and an **applicationKey**.
     **Copy both immediately** — the applicationKey is shown only once.

You now have five pieces of information:
`keyID`, `applicationKey`, `bucket name`, `endpoint`, `region`.

## Step 7 — Paste the five values into Render

1. Back in Render, open your **eurospacehub** service → **Environment** tab.
2. Click **Add Environment Variable** and add these five (name on the left, your
   value on the right):

   | Name | Value (example) |
   |---|---|
   | `B2_KEY_ID` | your keyID |
   | `B2_APPLICATION_KEY` | your applicationKey |
   | `B2_BUCKET_NAME` | `eurospacehub-yourname` |
   | `B2_ENDPOINT` | `https://s3.us-west-004.backblazeb2.com` |
   | `B2_REGION` | `us-west-004` |

   *(Note the `https://` on the endpoint. Use YOUR values, not the examples.)*
3. Click **Save Changes**. Render redeploys automatically (a few minutes).

From now on the database is **backed up to Backblaze and restored on every
restart** — nothing is lost.

## Step 8 — Re-seed once, so the professor account is saved into the backup

Because the account you made in Step 4 was on the temporary storage, create it
once more now that permanent storage is on:

1. Render → your service → **Shell** tab.
2. Run `node seed.js` again, and save the new password.
3. Sign in with it. From here on, everything you and the students create
   persists.

## Step 9 (only for file attachments) — allow uploads from your address

Attaching PDFs to reports needs one more Backblaze setting:

1. In Backblaze, open your bucket → **CORS Rules** (or "Bucket Settings").
2. Paste the rule from the project file **`server/b2-cors.json`**, changing the
   example web address to your real Render one (e.g.
   `https://eurospacehub.onrender.com`).
3. Save.

Everything else already worked without this; only file **uploads** needed it.

---

## About putting this on eurospacehub.com

You asked whether it should live inside **eurospacehub.com/about**. **Not yet, and
it doesn't need to.**

- We don't know who controls that site or how it's built, and embedding a
  login-based tool into someone else's website is fiddly and introduces security
  issues this standalone setup avoids.
- For now the hub stands on its own at the Render address — a complete, usable
  tool.
- **Later**, to bring it under the brand, the clean options are:
  1. Add a **link/button** on eurospacehub.com that opens the hub, or
  2. Give the hub a nicer address like **`hub.eurospacehub.com`** — Render
     supports custom domains; whoever manages the eurospacehub.com domain adds one
     DNS record and Render walks you through it.
- Both are easy **once someone with access to that domain is involved.** Get it
  running standalone first; branding is a separate, later task.

---

## If something goes wrong

- **Green "Merge" button greyed out (Step 1):** tests are still running — wait a
  minute, it goes green.
- **Build failed / red status in Render:** open the **Logs** tab, copy the last
  ~20 lines, and send them to the developer.
- **Page says "cannot reach its server":** the app is starting or asleep — wait a
  minute and click **Try again**. If it persists, confirm the service shows
  **Live** in Render.
- **Forgot the supervisor password:** run `node seed.js` in the Shell again.
- **File upload fails but everything else works:** you haven't done Part B / Step
  9 (Backblaze + CORS) yet.

---

## Quick reference — what each account is for

| Service | Free? | What it does | Needed for |
|---|---|---|---|
| **GitHub** | yes | holds the code (you already have it) | everything |
| **Render** | yes, no card | runs the app, gives it a web address | Part A — the whole hub |
| **Backblaze B2** | yes under 10 GB (card on file) | permanent database backup + file storage | Part B — keeping data + file uploads |
