# ai.STARTUPJURY — Presenter Runbook (internal)

_For the presenter, not the audience. Audience-facing copy is `docs/DEMO-AUDIENCE.md`._

**Rewritten 2026-10-05.** The previous version was last refreshed 2026-08-12 and
described a database that was emptied **2026-09-30**. Every fixture it named —
FinStack, InsureFlow, PitchLoop, MedGrid, NimbusHR, CloudBridge, GreenRoute,
WealthOS, LearnLoop — is gone, and its two "no login" resubmit links were measured
live returning **404 `invalid_token`**. Do not work from a printed copy of the old
one.

What is actually there now: **23 real Global Carbon Warriors climate decks,
uploaded 1–3 October, under the "Climate Cohort" programme.** The demo is driven
against the customer's own live data. That makes it better — and it means a
careless tap is a careless tap in production.

- **Live URL:** `https://startup-jury.jay-komarraju.workers.dev`
  (`app.startupjury.ai` is not live yet — `docs/DEPLOY.md` §2–§3.)
- **Credentials:** yours. **There is no demo-logins card any more** — see §0.1.
- **The demo is driven on a PHONE, in PORTRAIT.** §3 is not optional reading.
- **One edition only.** The VC edition was descoped 2026-10-01. Do not mention it,
  do not frame this as "one platform, two editions", and do not open a VC screen.

---

## 0. Pre-flight — four hard gates, in order

Each of these has been measured failing. None takes more than a few minutes.

### 0.1 Deploy, if nobody has

Measured 2026-10-05: production serves `index-XffRqztI.js`, which is a build of
`main@ff62f12`. **`defbc76` is not deployed**, which means the production login
page still prints twelve working addresses and the shared password `demo1234` on
the projector, and none of the five phone fixes are live — including the one that
made the Evaluation Report print the startup name on top of the Deck versions card
at every realistic iPhone height.

```bash
export PATH="$HOME/.nvm/versions/node/v22.23.1/bin:$PATH"
npm run db:migrate:remote:list   # expect nothing pending; if something is, read it
npm run deploy
```

Then confirm, replacing `<hash>` with the hash the page now names:

```bash
curl -s https://startup-jury.jay-komarraju.workers.dev/ | grep -o 'assets/index-[^"]*'
curl -s https://…/assets/index-<hash>.js | grep -c -F demo1234   # expect 0
```

Full procedure and the reason migrations are a separate step: `docs/DEPLOY.md` §4.

### 0.2 Credits. Production is at ZERO.

Measured on production: `creditsBalance: 0`. **Any upload returns `402 no_credits`.**
The old runbook's "50 credits are seeded" was true of a fresh local migration and
has never been true of this database.

If Act 2 includes a live upload (§2.2), top up first:

**Settings → Core Parameters → the "Plan & credits" card → set the number → Save.**

**Not "Buy credits."** That nav item exists (`Settings → Buy credits`) and is a
simulated purchase flow with extra screens — wrong gesture under time pressure.
Core Parameters writes the balance directly and is scoped to your own workspace by
the server.

### 0.3 Know the three decks you are going to open, by name, off the screen

Do not trust this file for deck names — that is exactly how the last runbook died.
Open **All decks**, sort by score, and write down:

- **one deck with a strong score and a complete Evaluation Report** — the money shot;
- **one deck flagged incomplete that appears under Query** — the founder beat (§2.3);
- **one deck you will not touch.**

The decks the 1–3 October issues were about are **BiocharIND**, **NatureMark** and
**UshaKiran**; expect those names, confirm them anyway.

Two things to check while you are there:

- **Open the report you picked, on the phone, in portrait, before you go on.** A
  deck can have a score and an empty breakdown; find that out now.
- **Open Query and confirm the list is not empty.** Its own subtitle is "AI-flagged
  decks awaiting founder clarification". If no deck is flagged, §2.3 has nothing to
  show and you should cut it rather than discover that live.

### 0.4 Sign in before you walk on stage

The demo-logins card is gone from production after §0.1, so there is no one-tap
sign-in and no password on screen. Sign in on the phone you are presenting from,
confirm the Dashboard renders, and **leave the session open.** The cookie is
host-only and lasts 7 days.

If a sign-in does fail on stage: the login screen says "Invalid email or password"
for *every* failure, including a server 500 (`AuthProvider.tsx:77-78` →
`LoginPage.tsx:51-54`). So that message does not actually tell you it was the
password. Have a second signed-in device.

---

## 1. The narrative — ~10 minutes

**The spine: a real deck → its AI-scored report → move it through the real
pipeline → what the founder sees → the analytics.** Four acts. Each stands alone,
so you can drop any of them for time.

### Act 1 — Framing and the dashboard (~2 min)

Sign in as an **Admin** (or the Super User) in the incubator.

- **Say:** "This is Global Carbon Warriors' live workspace. Twenty-three climate
  decks came in over three days. The AI reads every one, scores it against GCW's
  own thirteen-parameter rubric, and runs it through GCW's real pipeline. Nothing
  here is a mock-up and nothing here is a screenshot."
- **Show:** the Dashboard — **KPI row**, **deck table**, **pipeline-progress rail**,
  **cohort-thresholds** panel.
- **Do:** toggle **dark/light** once (top-right) — "the whole design system, both
  themes." One tap, then move on.
- **Do not** say "two editions". There is one product.

### Act 2 — The evaluation report ⭐ the money shot (~3 min)

Two forms. **Pick one before you go on stage.** They are not equivalent.

#### 2.1 Form A — open a real scored GCW deck (default; recommended)

Dashboard or **All decks** → the deck from §0.3 → **Evaluation Report**.

No credit, no new row, no model latency, and it is the customer's own deck. Walk
one screen:

- **Extracted slides** — "it rebuilt the deck's structure from the PDF."
- **Per-parameter scores** — point at **Climate Impact & Integrity** (weight 10 of
  100) and **Traction & Validation** (also 10).
- **The AI's reasoning per parameter** — "not just a number; it says why."
- **Weighted total + verdict** — "above the gate, so it advanced."

#### 2.2 Form B — a live upload, if they must see the model called

Only with §0.2 done. **Upload & Evaluate** → **Single deck** →
`docs/demo-assets/gridbloom-sample-deck.pdf` → name it → submit.

- **Say while it runs:** "The PDF is going to Claude right now. It reads the slides,
  scores all thirteen rubric parameters nought to ten, weights them, and applies
  GCW's pass gate."
- **Use the seeded 14-page deck**, not a real customer deck. It is 6,891 bytes and
  it is the only PDF in this repo that has ever been rendered on a phone. A
  photographic 40-slide investor deck has never been exercised on any engine.
- **Do not double-submit.** Each submit spends a credit and creates a second deck.
- **It leaves a row in GCW's live workspace.** Clean it up afterwards: §6.
- **Choose the upload method deliberately.** The wizard offers **Upload from CRM**
  and it is a "coming soon" panel (`upload/CrmMethod.tsx:62`). Single or Bulk only.

Timing, so you are not surprised: the client gives a single upload **60 seconds plus
one second per 150 KB** (`api.ts:66-72`), and the server runs the Anthropic call
**inline in the request** at `max_tokens: 8192` with no abort. The old runbook's
"~10–20s" was measured in July at 4096 tokens. **If a rehearsal takes more than
about 45 seconds, switch Act 2 to Form A** or drive it through **Bulk**, which
queues and returns immediately.

### Act 3 — The pipeline and the roles (~3 min)

On an **AI Evaluated** deck:

1. **Assign** → pick a jury member → assign. Deck → **Assigned**.
   **Leave "Notify by email" alone.** It defaults ON, so the step completes
   untouched — and the JURYbuddy help launcher covers 79% of that switch on a
   phone, so reaching for it is a fumble for no gain. It would not send anything
   anyway (§4).
2. **Switch to the Jury Member** (second device, already signed in). **Say:** "The
   menu is trimmed to evaluation only — a juror sees the decks assigned to them and
   nothing else." Open the assigned deck → score on the rubric → **Shortlist**.
3. **Back as staff:** **Schedule intro call** → the deck moves to **Intro**.
   **Stop there.** Do not press **Send signup**: the transition is valid, but it
   lands on a screen whose primary action is disabled for every role including
   superuser (`StagePage.tsx:2068`, `signupComingSoon: true`), and the Admin
   console's whole Sign-up group is hidden behind it. There is nothing to show.
4. **Show the Activity log** on that deck. **Say:** "Every move is attributable and
   timestamped. Nothing happens off the record."

> Pass path, in order: **AI Evaluated → Assigned → Jury Evaluation → Shortlisted →
> Intro** → (Signup → Ready to Onboard, not demoed).

**The guardrail, if the room is the kind that asks.** On a deck below its
programme's floor, the Shortlist button carries **"Shortlist minimum X · this deck
Y"** and refuses (`EvaluatePage.tsx:929-933`). _"Per-programme and uniform — a
superuser is held to it too. The escape hatch is an admin lowering the floor, which
is itself an audited change."_ `migrations/0016` set Climate Cohort's floor to
**5.5**; read the live value off **Set up → the programme → Shortlist minimum** at
pre-flight rather than quoting this line.

### Act 3b — Pick ONE, not three (~2 min)

Each stands alone. On a phone, one is enough.

**The founder's view** ⭐ _the best sixty seconds in the demo._
**Query** → the list is "AI-flagged decks awaiting founder clarification" → **tap
the startup's name** → **Founder clarification flow**. The screen's own words are
"This is what the founder sees when their pitchdeck is flagged as incomplete."

> _"The AI didn't just score it low — it identified what is missing. This is the
> founder's side: only what to fix. No scores, no evaluator names, no other
> company's deck. They update those sections and re-upload; it is saved as a new
> version, re-scored automatically, and it is back in front of the panel. No
> separate questionnaire — the deck stays the single artifact."_

This is built from live data, needs no token and no email, and replaces the old
runbook's `/resubmit/<token>` beat entirely. **Those tokens are dead** — measured
live, `/api/resubmit/aisj-demo-nimbushr-resubmit-2026` returns 404, and on a
projector in a private window the audience would read "This link can't be opened"
under our own wordmark.

**The evaluator workbench** (Jury → **Assigned**, or staff → **Evaluate**). The
densest screen in the product: the real PDF rendered in-app, **AI · My · Average**
per parameter, the AI's reasoning, **Deck 3 of 5** queue paging, and **Research** —
_"the juror's own ChatGPT or Claude account. We never spend platform tokens on a
juror's side research."_ Drag one slider and let them watch the Average recompute:
_"AI said 9, the juror says 5, the number of record is 7."_
*Note:* **Evaluate** is hidden in the nav for the superuser role
(`src/shared/nav.ts:134`, `hiddenFor: ["superuser"]`). Reach it as an admin or
through the jury's **Assigned**.

**The rescore guard.** Press **Re-run AI score** on an already-scored, unchanged
deck → _"already scored — nothing has changed."_ _"The model is
non-deterministic, so we refuse to re-roll a score for no reason."_

### Act 4 — Analytics, and close (~1.5 min)

- **Reports → Cohort summary**, then **Pipeline funnel**.
- **[+]** **Evaluator scores** and **Score drift** (AI vs human) if the room is
  analytical.
- **Say:** "Every chart is paired with a table. Identity is never colour alone."

**Close:** _"One rubric, one AI engine. From a raw PDF to a shortlisted company,
every step scored and audited, running entirely on Cloudflare's edge."_

---

## 2. Talking points, one line per screen

| Screen | The one thing to say |
|---|---|
| **Dashboard** | "KPIs, the live deck list and a pipeline rail — all role-aware." |
| **Upload & Evaluate** | "The PDF goes to Claude live. This is a real model call, not a lookup." |
| **Evaluation Report** | "Extracted slides, a 0–10 score per rubric parameter, the reasoning, and a weighted verdict." |
| **Core Parameters** | "Thirteen weighted core areas are the score. Change a weight and the cohort re-scores." |
| **My Parameters** | "Each role adds up to three of its own, AI-assisted, with an editable prompt — shown separately, never folded into the 100%." |
| **Assign / jury scoring** | "Role-gated: a juror can only score decks assigned to them." |
| **Evaluator workbench** | "The deck, the AI's reasoning and the juror's judgement on one screen. The average is the number of record." |
| **Research button** | "Their AI, their account. We never spend platform tokens on side research." |
| **Rescore guard** | "The model is non-deterministic, so we refuse to re-roll a score when nothing changed." |
| **Shortlist floor** | "A per-programme minimum. Uniform — a superuser is held to it too." |
| **Founder clarification flow** | "The founder fixes the deck itself and re-uploads. One artifact, re-scored automatically." |
| **Activity log** | "Every transition is attributable and timestamped." |
| **Intro calls / `.ics`** | "One universal invite for any email domain; a reschedule updates the entry instead of duplicating it." |
| **Analytics** | "AI-versus-human drift, funnel conversion, cohort bands — decision intelligence." |
| **Issue log** | "Testing issues live in the product, not in five chat threads." |

**Screens to stay off.** The role-parameter band descriptions are **45 of 110
blank** on the 9 role parameters — do not open that editor on the projector. GCW
also **cannot add a fourteenth weighted parameter**; they can rename the thirteen
and add up to three unweighted per role. If asked, say that plainly rather than
going looking.

---

## 3. The phone rules

The device is a **phone**, and four lanes drove the real spine at 393px in Chromium
and WebKit. The whole incubator spine completes by tap with **zero horizontal
overflow on all 14 screens measured**. These are the things that will still bite.

- **Stay in portrait.** Landscape is the worst case: still under the 899px
  breakpoint so the toolbar is stripped, but not yet at `lg:` so the report is
  single-column — with only ~390px of height. Measured, Evaluate in landscape gives
  the deck list a 27px window over 73px rows.
- **Page the deck from the thumbnail strip, not the full-screen lightbox.** The
  lightbox's paging chevrons sit at x=−16 and x=409 in a 393px viewport, so 4px of
  each is on screen, and tapping the backdrop does not close it. The thumbnail strip
  is `overflow-x-auto` and swipes.
- **Tap deliberately.** The 28px **Log out** button sits 6px from the avatar and
  there is no confirmation.
- **Don't reach for "Notify by email" on Assign** (Act 3, step 1).
- **The sidebar is not a problem**: at 393px the rail is `display:none` and
  navigation is the drawer, which shows all 25 labels cleanly.
- **If you end up on a laptop instead: 100% zoom on a ≥1280px screen is the safest
  surface of all.** Zooming to 150% on a 1280px screen puts you at 853 CSS px —
  under both breakpoints — which strips the toolbar *and* single-columns the report.

**Still unmeasured, so do not bet the demo on it:** real iOS Safari (everything
above used Playwright WebKit, which shares the CSS engine and emulates none of
Safari's UI layer), a large or image-heavy PDF on any engine, one timed upload all
the way to completion, and dark mode at phone width. If you intend to toggle dark
mode on the phone (Act 1), rehearse it on the phone.

---

## 4. Say this if "email" comes up

**Nothing is delivered yet, and the app does not pretend otherwise.**
`vars.EMAIL_FROM` is empty, so `emailDeliveryConfigured`
(`src/server/email/outbox.ts:257-259`) is false and every message is written to
`email_outbox` with `status='recorded'`. The screens that mention email say
`recorded` rather than claiming a send.

So: **any "email sent" you see on screen is a database row.** Everything around it
works regardless — the tokens, the links, the `.ics` attachment, the founder flow.

If asked, the honest answer is one sentence: _"Sending is one configuration change
away — the domain is being onboarded this week, and no code changes for it."_
(`docs/DEPLOY.md` §5 is the actual procedure. Do not promise a date you have not
read that section for: it needs the DNS cut-over first.)

Two corollaries for the call:
- **A new account's password is relayed by you, not emailed.** `POST /api/users`
  checks the gate and returns the temporary password to the operator precisely so a
  credential never goes to a transport that is not delivering. The screen says which.
- **There is no self-service forgot-password that can reach anyone yet.** An admin
  resetting a user's password in the console is the working path.

---

## 5. Fallbacks — each executable in about five seconds

| It happens | Do this |
|---|---|
| **`402 no_credits` on upload** | Settings → **Core Parameters** → Plan & credits → set a number → Save. **Not "Buy credits".** §0.2. |
| **Upload spinner past ~40s** | **Keep talking. Do not re-submit** — it spends another credit and creates a second deck. Have a second tab already open on a scored deck's report and cut to it. |
| **AI fails outright** | **There is no instant fix.** `Re-run AI` only enqueues, and the sweep needs `STUCK_AFTER_MINUTES = 10` × `MAX_AI_ATTEMPTS = 3` ≈ 30–40 minutes (`src/server/ai/health.ts:34,41`). Cut to Act 2 Form A. |
| **A deck sits at "Pending"** | The row and the dashboard banner carry **the real reason** (billing, rate limit, bad key, missing PDF). Read it aloud if it is interesting; otherwise move on. If it says billing, the Anthropic account is out of credit and nothing in the app will fix it. |
| **A deck's report drawer is empty** | Close it and open the one from §0.3. Only decks that completed an evaluation have a breakdown; extracted slide text needs a real stored PDF. |
| **A 0.00 deck opens** | Close it. Know which ones they are before you start. |
| **Query is empty** (no flagged deck) | Cut Act 3b's founder beat and do the evaluator workbench instead. |
| **A shortlist is refused** | Working as designed — the deck is under its programme's floor. Say so; it is a better story than a workaround. |
| **"Unknown action" (409)** | That transition is not valid from this deck's stage. Check the stage; only the actions shown for that stage and role are valid. |
| **"Not available for your role"** | The permission model working. Switch devices to the role that has it. |
| **Lightbox won't close** | Tap the X, not the backdrop. §3. |
| **The login fails on stage** | The message is the same for a wrong password and a server 500. Use the second signed-in device rather than debugging. |

**`npm run smoke` reports 6 failures and they are not regressions.** It defaults to
production (`scripts/smoke.mjs:14-18`) and six checks assert on fixtures the 30-Sep
clear deleted. Measured: **48 passed, 6 failed**, with nothing failing in the
authZ, security-header, auth-gate or cross-edition blocks. Read the failure names,
not the count.

---

## 6. After a rehearsal — clean up, carefully

**This is Global Carbon Warriors' live workspace, and tenancy is live.** Every
statement below is scoped to `tenant_id = 't_default'` on purpose. An unscoped
`UPDATE org_settings` is not hypothetical: `migrations/0007_config_plans_credits.sql:12`
is exactly that, `UPDATE org_settings SET credits_balance = 50` with no `WHERE`,
and re-running that pattern now would rewrite every customer's balance.
`org_settings`' primary key is `(tenant_id, edition)`
(`migrations/0089_org_settings_tenant_rebuild.sql:47-58`).

Take a restore point first. It costs nothing and the window is 30 days:

```bash
export PATH="$HOME/.nvm/versions/node/v22.23.1/bin:$PATH"
npx wrangler d1 time-travel info startup-jury-db     # write the bookmark down
```

1. **Find only your own test decks.** Use the name you actually typed; do not run a
   `LIKE '%'` against a live cohort.
   ```bash
   npx wrangler d1 execute startup-jury-db --remote \
     --command "SELECT id, name, status, created_at FROM decks
                WHERE tenant_id = 't_default' AND name = 'GridBloom';"
   ```
2. **Read the list before you delete anything.** If it returns a deck you did not
   upload, stop.
3. **Delete each deck's R2 PDF** (per id):
   ```bash
   npx wrangler r2 object delete "startup-jury-decks/decks/<DECK_ID>.pdf" --remote
   ```
4. **Delete the deck rows.** `deck_extractions`, `scores`, `evaluations` and
   `pipeline_events` cascade from `decks`:
   ```bash
   npx wrangler d1 execute startup-jury-db --remote \
     --command "DELETE FROM decks WHERE tenant_id = 't_default' AND id IN ('<ID_1>','<ID_2>');"
   ```
5. **Set the credit balance back to whatever GCW should read** — scoped, and to a
   number you have agreed, not to 50:
   ```bash
   npx wrangler d1 execute startup-jury-db --remote \
     --command "UPDATE org_settings SET credits_balance = <N>
                WHERE tenant_id = 't_default' AND edition = 'incubator';"
   ```
   Or do it in the UI (Core Parameters → Plan & credits), which scopes itself.
6. **Verify:** step 1 returns nothing, and the Dashboard still shows 23 decks.

---

## 7. What consumes credits

- **1 credit per single upload** — the live-scored path.
- **Bulk is 1 credit per file.**
- The balance is per `(tenant_id, edition)`. **Production reads 0**; `402 no_credits`
  is what you get at zero, and you will hit it. §0.2.

## 8. Which PDF, and why it matters

The rubric has **13 weighted core parameters**, among them **Climate Impact &
Integrity at weight 10** and **Traction & Validation at weight 10**
(`migrations/0002_seed.sql`). A deck that ignores a heavy parameter — most obviously
a startup with no climate angle — scores low on it, which can drag the weighted
total under the gate and land the deck at **Incomplete** instead of advancing.
Verified live, at the time it was measured:

- a thin fintech deck with no climate content → **4.9 / Incomplete** ✗
- `docs/demo-assets/gridbloom-sample-deck.pdf` (covers all 13) → **7.8 / AI Evaluated** ✓

So: a climate-relevant, well-rounded deck. Landing at Incomplete is a deliberate
second act (Act 3b), never an accident to hit live. And the seeded rubric is already
a climate rubric, which is why a straight copy was defensible for a carbon
accelerator in the first place.

## 9. One historical failure worth knowing

If **everything** scores 0 or every upload fails at once, check the recorded reason
first. One cause has happened before: `claude-sonnet-5` **rejects a `temperature`
parameter with a 400**, and for a while every real upload failed because of it.
`temperature`, `top_p` and `top_k` must stay **absent** from the Anthropic call —
there is a test asserting exactly that. Nobody should "restore" them.
