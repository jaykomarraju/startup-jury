# ai.STARTUPJURY — Presenter Runbook (internal)

_For me, not the audience._ A step-by-step script for demoing the live product.
Verified against the live Worker (real uploads scored, transitions driven, cleaned
up), and refreshed at the end of the **finish track (Session 8, 2026-08-12)** for
the screens that landed in Sessions 1–7. Audience-facing copy is in
`docs/DEMO-AUDIENCE.md`.

- **Live URL:** https://startup-jury.jay-komarraju.workers.dev
- **Password (all logins):** `demo1234`
- **Sample deck to upload:** `docs/demo-assets/gridbloom-sample-deck.pdf` (a
  13-slide climate-tech deck built to clear the AI gate — see _Which PDF_ below).
- **Credits:** 50 per edition, seeded. **Each single upload spends 1 credit.**

---

## 0. Before you present (2-minute pre-flight)

1. **Confirm the app is up + AI scoring is on.** From the repo:
   ```bash
   nvm use 22 && npm run smoke        # expect "0 failed"
   ```
   `smoke` is read-only — safe against the live seed. It does **not** test upload;
   to confirm live scoring specifically, do one throwaway upload (Section 2) a few
   minutes early, then reset it (Section 7).
2. **Have the sample deck handy** on your desktop:
   `docs/demo-assets/gridbloom-sample-deck.pdf`. Or use a real, well-rounded deck.
3. **Two browser windows / profiles** help for the role-switch moments (staff in
   one, jury/IC in the other) so you're not logging in and out on stage.
4. Pick **light or dark** and know where the **sun/moon toggle** is (top-right).
5. **Know your two "no login" URLs** — the resubmit links in Act 3b. Open one in a
   private window before you present so you're not fumbling for it on stage.
6. **Decks you should not touch on stage:** **PitchLoop** (a seeded AI-failure
   fixture — Re-run just fails again) and the seeded **calls** on GreenRoute /
   WealthOS / LearnLoop (rescheduling them mutates the demo). Schedule on a deck
   you uploaded instead.

---

## Recommended narrative (~12 min, tight path)

Total runs ~12 min at the tight path; the **[+]** deep-dives push it to ~15–18.
The spine is: **one deck → AI score → open report → move it through the pipeline
→ analytics**, shown once for the **Incubator** edition and once for **VC**.

### Act 1 — Framing + the dashboard (~2 min)

**Login:** Incubator **Super User** — `priya.sharma@demo.startupjury.ai`.

- **Say:** "One platform, two editions on the same engine — an accelerator
  edition and a VC edition. AI reads every deck, scores it against your rubric,
  and runs it through your real pipeline. Everything you'll see is live on
  Cloudflare's edge."
- **Show:** the dashboard — **KPI row**, **deck table**, **pipeline-progress
  rail**, **cohort-thresholds** panel.
- **Do:** toggle **dark/light** once (top-right) — "full design system, both
  themes."
- **[+]** Click an existing seeded row to preview an **Evaluation Report** so they
  see the format before you generate a fresh one.

### Act 2 — Live AI scoring (~3 min) ⭐ the money shot

- **Go to:** **Upload** (left nav).
- **Do:** choose **single deck**, pick `gridbloom-sample-deck.pdf`, add a name
  ("GridBloom"), submit.
- **Say (while it runs ~10–20s):** "This isn't a lookup — the PDF is going to
  Claude right now. It reads the slides, scores all 13 rubric parameters 0–10,
  weights them, and applies our pass gate."
- **Result:** the deck lands at **AI Evaluated** (it scored ~7.8 / signal
  _moderate_ in testing — comfortably above the gate).
- **Do:** open the new deck → **Evaluation Report**. Walk one screen:
  - **Extracted slides** — "it rebuilt the deck's structure."
  - **Per-parameter scores** — point at **Climate Impact** and **Traction**.
  - **Weighted total + verdict** — "Advanced — AI gate passed."

### Act 3 — Pipeline + real roles (~3 min)

Still on that GridBloom deck (now at **AI Evaluated**):

1. **Assign to jury** — open the deck's actions / **Assign** screen, pick a jury
   member (e.g. **Rajesh Kumar**), assign. Deck → **Assigned**.
2. **Switch role → Jury Member** (`rajesh.kumar@demo.startupjury.ai`, second
   window). **Say:** "Notice the menu is trimmed to evaluation only." Open the
   **assigned** deck → score it on the rubric sliders → **Shortlist**.
   Deck → **Jury Evaluation → Shortlisted**.
3. **Back to staff** (Super User / Associate): **Schedule intro call**
   (→ **Intro**), then **Send signup** (→ **Signup**).
4. **Show the audit trail** — the deck's **Activity log** lists every transition
   with who did it and when. **Say:** "Every move is attributable — nothing
   happens off the record."

> Incubator pass path in order: **AI Evaluated → Assigned → Jury Evaluation →
> Shortlisted → Intro → Signup → Ready to Onboard.**

### Act 3b — The finish-track screens (~4 min) ⭐ new

Pick the two or three that fit the room; each stands alone.

**The evaluator workbench** (Jury Member → **Assigned**, or staff → **Evaluate**).
The single densest screen in the product:
- The **actual PDF rendered in-app** — click a slide to enlarge, next/prev.
- **AI · My · Average** per parameter. **Do:** drag one slider and let them watch
  the Average recompute live. _"AI said 9, the juror says 5, the number of record
  is 7."_
- The AI's **reasoning per parameter**, not just a number.
- **Deck 3 of 5** — walk the assigned queue with next/prev.
- **Research** (top-right) — opens the juror's **own** ChatGPT / Claude /
  Perplexity / Gemini. _"Their AI, their account. We never spend platform tokens
  on a juror's side research."_
- **Do:** click **Re-run AI score** on an already-scored, unchanged deck →
  _"already scored — nothing has changed."_ _"The AI is non-deterministic, so we
  simply refuse to re-roll a score for no reason."_

**Guardrails** (Program Manager or Jury). On a deck below its program's floor the
Shortlist button carries **"Shortlist minimum 5.5 · this deck 4.30"** and the
action is refused. _"Per-program, uniform — a superuser is held to it too. The
escape hatch is an admin lowering the floor, which is an auditable change."_

**Incomplete → resubmit loop** — the best 60 seconds in the demo:
1. As staff, open **NimbusHR** (incubator, Incomplete) — it's missing a phone
   number, so it never reached the panel.
2. Open a **private window** and go to
   **`/resubmit/aisj-demo-nimbushr-resubmit-2026`** — **no login**. The founder
   sees only what to fix; no scores, no evaluator names, no other deck.
3. _"They update those sections in the deck and re-upload. It's saved as a new
   version, re-scored automatically, and it's back in front of the panel. No
   separate questionnaire — the deck stays the single artifact."_
   (**Don't actually re-upload on stage unless you mean to** — it spends a credit
   and mutates the demo deck. Section 7 resets it.)

**Scheduling + `.ics`** (PM → **Intro calls**, or VC Partner → **Alignment call**).
Open **Schedule call**, pick participants across roles, add the founder at
**their own domain**, save, then **download the `.ics`**. _"One universal invite —
Outlook, Gmail, Apple Calendar. Reschedule keeps the same UID and bumps the
sequence, so calendars update the entry rather than creating a second one."_
MedGrid's partner call is seeded already rescheduled (sequence 1) if you want to
point at one.

**AI health** (Admin → **All decks**). The banner names **PitchLoop** as failed
with the real reason and offers **Re-run AI**. _"A deck used to be able to sit at
'Pending' forever with no reason recorded anywhere. Now the cause is captured, a
sweep re-drives it, the credit is refunded once, and a human can re-drive it by
hand."_ **Don't click Re-run on PitchLoop** — it's a fixture with no stored PDF,
so it will just fail again. Demo the recovery on a deck you uploaded.

**Admin console** (Admin → **Admin console**). Create a juror. _"They're emailed a
sign-in link and a one-time password."_ (Until the sending domain is verified the
screen shows the password for you to relay instead — it says which.)

**Issue log** (Support → **Issue log**). _"The team logs testing issues in the
product itself rather than in five chat threads."_

### Act 4 — Analytics, incubator (~1.5 min)

- **Show:** **Cohort summary** and **Pipeline funnel**. **[+]** **Evaluator
  scores** and **Score drift** (AI vs human) if the room is analytical.
- **Say:** "Charts are always paired with a table — identity is never
  colour-alone."

### Act 5 — The VC edition, same spine (~2.5 min)

- **Login:** VC **Managing Partner** — `aarav.khanna@demo.startupjury.ai`.
- **Say:** "Same engine, a fund's workflow." Upload the same deck (or reuse the
  narrative) → it lands at **Analyst Scoring**.
- **Advance the deal** (superuser can drive all of it): **Submit core scores →
  Associate Review → Shortlist to partner → Partner Review → Advance to partner
  call → Sponsor to IC → IC Review.**
- **[+] IC vote:** switch to **IC Member** (`rajesh.kumar.vc@demo.startupjury.ai`)
  → **IC pipeline** → cast a vote with a rationale; show the **live tally +
  recommendation**. Back as MP: **Close IC vote → Invest → Issue term sheet**
  (enter a valuation/ownership) **→ Start legal DD → Complete legal DD →
  Onboard.**
- **Show:** VC analytics — **Capital deployment**, **Portfolio construction**,
  **Decision history**.

> VC pass path in order: **Analyst Scoring → Associate Review → Partner Review →
> Partner Call → Investment DD → IC Review → MP Decision → Alignment Call → Term
> Sheet → Legal DD → Onboard Ready.**

### Close (~30s)

"One rubric, one AI engine, two editions — from a raw PDF to a funded portfolio
company, every step scored and audited, running entirely on Cloudflare's edge."

---

## Talking points cheat-sheet (per screen)

| Screen | The one thing to say |
|---|---|
| **Login** | "The one-click logins are 12 real roles across two editions." |
| **Dashboard** | "KPIs, live deck list, and a pipeline rail — role-aware." |
| **Upload** | "The PDF goes to Claude live — this is a real model call, not a lookup." |
| **Evaluation Report** | "Extracted slides + a 0–10 score per rubric parameter + a weighted verdict." |
| **Assign / Jury scoring** | "Role-gated: a jury member can only score decks assigned to them." |
| **Activity log** | "Every transition is attributable and timestamped." |
| **Analytics** | "AI-vs-human drift, funnel conversion, cohort bands — decision intelligence." |
| **IC voting (VC)** | "Confidential ballots, live tally, plurality recommendation." |
| **Config (admin)** | "Change a weight and the whole cohort re-scores instantly." |
| **Evaluator workbench** | "The deck, the AI's reasoning, and the juror's own judgement on one screen — the average is the number of record." |
| **Research button** | "Their AI, their account — we never spend platform tokens on side research." |
| **Rescore guard** | "The AI is non-deterministic, so we refuse to re-roll a score when nothing has changed." |
| **Set up wizard** | "Sector → Program → Cohort. Everything — uploads, scoring, reports — happens inside a program." |
| **My Parameters** | "13 weighted core areas are the score. Each role adds up to 3 of its own, AI-assisted, with an editable prompt — shown separately, never folded into the 100%." |
| **Shortlist floor** | "A per-program minimum. Uniform — a superuser is held to it too." |
| **Resubmit link** | "The founder fixes the deck itself and re-uploads. One artifact, re-scored automatically." |
| **Intro calls / .ics** | "One universal invite for any email domain; a reschedule updates the entry instead of duplicating it." |
| **AI health banner** | "A failed evaluation names its cause, refunds its credit, and can be re-driven." |
| **Issue log** | "Testing issues live in the product, not in five chat threads." |

---

## Which PDF to upload (important)

Use **`docs/demo-assets/gridbloom-sample-deck.pdf`**, or any **well-rounded** real
deck. The rubric has **13 core parameters**, including a **weight-10 "Climate
Impact & Integrity"** parameter (weight 10 of 100 total). A deck that ignores a
heavy parameter — most obviously a startup with **no climate/impact angle** —
scores low on it, which can drag the weighted total under the **>5 gate** and land
the deck at **Incomplete** instead of the pass stage. Verified live:

- A thin fintech deck (no climate content) → **4.9 / Incomplete.** ✗ bad demo.
- The GridBloom climate-tech deck (covers all 13 params) → **7.8 / AI Evaluated.**
  ✓ good demo.

So: **demo with a climate-relevant, well-rounded deck.** If you want to show the
_Incomplete → founder query loop_, that's a deliberate second act — not an
accident to hit live.

## What consumes credits

- **1 credit per single upload** (the live-scored path). Bulk = 1 per file.
- 50 credits are seeded per edition — plenty for a demo, but every practice run
  spends one. If you rehearse a lot, top up in **Config** (admin, `Core params`
  screen) or reset test decks (Section 7).
- A `402 no_credits` only appears at a zero balance — you won't hit it on the
  seed.

---

## Fallback / troubleshooting

**Upload is slow / spinner hangs (~20–30s).** Normal — single upload runs the
Claude call **synchronously in the request** while it reads the whole PDF. **Do
not double-submit** (each submit spends a credit and creates a second deck). Give
it up to ~30s.

**Upload returns but the deck shows "Pending" (not scored).** You no longer have
to guess: the deck row and the dashboard banner now carry **the actual reason**
(billing, rate limit, bad key, missing PDF). A `*/10` cron re-drives it up to 3
times, then gives up and **refunds the credit**; an admin can also press **Re-run
AI**. If the reason says billing, the **Anthropic account is out of credits** —
check with the repo owner. Nothing to fix in the app.

**Everything scores 0 / every upload fails at once.** Check the recorded reason
first. One historical cause is worth knowing: `claude-sonnet-5` **rejects a
`temperature` parameter with a 400**, and for a while every real upload failed
because of it. `temperature` / `top_p` / `top_k` must stay **absent** from the
Anthropic call — there is a test asserting exactly that. Don't "restore" them.

**A deck's report drawer is empty.** Every seeded deck with a score now has its
full 13-parameter breakdown (Session 8). The two decks that deliberately have
none are the **Incomplete** ones — PayRoute and NimbusHR never completed an
evaluation, so there is nothing to show. Extracted slide text only exists for
decks with a real uploaded PDF.

**The Export button downloads nothing.** It exports exactly the rows on screen —
if the filtered table is empty the button is disabled.

**An email "didn't arrive."** Expected until the sending domain is verified. The
app **records** every message rather than sending it, and reports `recorded`
rather than claiming a delivery. Everything else in the loop (tokens, links,
`.ics` attachments, the resubmit page) works regardless.

**The resubmit link 404s or says expired.** Two demo links are seeded and both
run to 2030: `/resubmit/aisj-demo-nimbushr-resubmit-2026` (NimbusHR) and
`/resubmit/aisj-demo-cloudbridge-resubmit-2026` (CloudBridge, a real uploaded
deck). A token is **superseded when a new one is minted for the same deck**, so
if you or a cron re-drove that deck, re-mint or use the other link.

**Deck lands at Incomplete / Rejected unexpectedly.** The deck didn't cover the
rubric well (see _Which PDF_ — usually the missing **Climate Impact** parameter),
or Claude marked it `complete:false`. Re-upload the **GridBloom** sample, which is
built to pass.

**Advancing a deck gives "unknown action" (409).** You're trying a transition
that isn't valid from the deck's current stage (e.g. assigning a jury before it's
at _AI Evaluated_, or advancing an _Incomplete_ deck). Check the stage; only the
actions shown for that stage/role are valid.

**A role can't see a screen ("Not available for your role").** That's the
permission model working, not a bug — switch to a role that has it (Super User /
Managing Partner see everything).

**Out of credits mid-demo.** Log in as an **Admin** and use **Buy credits**
(a simulated top-up — no payment is captured), or set the balance directly in
**Config → Core params**.

**A shortlist is refused ("below the program's shortlist minimum").** Working as
designed — the deck's decision score is under its program's floor. Either pick a
stronger deck or, as an admin, lower the floor in **Set up**. The seeded floors
are **Climate Cohort 5.5 · Deep Tech Fund 5.5 · Fund II 6.5**; Fintech Accelerator
and SaaS Accelerator have none.

**"Someone changed the demo data."** It's a shared environment — uploads persist
and are visible to everyone with the link. The seeded dashboard numbers are
illustrative. To wipe test uploads and restore the seed, see Section 7.

---

## 7. Reset after a rehearsal (keep the seed pristine)

Every practice upload leaves a deck + its R2 PDF + a spent credit. To restore the
demo to the seeded state (Node 22, from the repo root, `wrangler` already
authenticated):

1. **Find your test decks** (they'll be whatever you named them):
   ```bash
   npx wrangler d1 execute startup-jury-db --remote \
     --command "SELECT id, edition, name, status FROM decks WHERE name LIKE '%TEST%';"
   ```
2. **Delete each deck's R2 PDF** (repeat per id):
   ```bash
   npx wrangler r2 object delete "startup-jury-decks/decks/<DECK_ID>.pdf" --remote
   ```
3. **Delete the deck rows** — `deck_extractions`, `scores`, `evaluations`,
   `pipeline_events` (and any VC side-effect rows) **cascade** from `decks`:
   ```bash
   npx wrangler d1 execute startup-jury-db --remote \
     --command "DELETE FROM decks WHERE id IN ('<DECK_ID_1>','<DECK_ID_2>');"
   ```
4. **Refund the credits** you spent (1 per upload, per edition):
   ```bash
   npx wrangler d1 execute startup-jury-db --remote \
     --command "UPDATE org_settings SET credits_balance = 50 WHERE edition = 'incubator';"
   npx wrangler d1 execute startup-jury-db --remote \
     --command "UPDATE org_settings SET credits_balance = 50 WHERE edition = 'vc';"
   ```
   (The live balances at the end of the finish track were **42 / 49**, not 50 —
   earlier verification runs legitimately spent some. Set whatever you want the
   demo to read.)
5. **Verify:** the `SELECT` in step 1 returns nothing and both editions read
   `credits_balance = 50`.

> A ready-made cleanup pattern (explicit child deletes + credit refund) lives in
> the HANDOFF verification notes if you prefer belt-and-braces over cascade.
