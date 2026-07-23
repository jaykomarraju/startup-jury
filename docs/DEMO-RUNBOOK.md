# ai.STARTUPJURY — Presenter Runbook (internal)

_For me, not the audience._ A step-by-step script for demoing the live product.
Everything here was **verified against the live Worker on 2026-07-23** (real
uploads scored, transitions driven, cleaned up). Audience-facing copy is in
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
   nvm use 22 && npm run smoke        # expect "26 passed, 0 failed"
   ```
   `smoke` is read-only — safe against the live seed. It does **not** test upload;
   to confirm live scoring specifically, do one throwaway upload (Section 2) a few
   minutes early, then reset it (Section 7).
2. **Have the sample deck handy** on your desktop:
   `docs/demo-assets/gridbloom-sample-deck.pdf`. Or use a real, well-rounded deck.
3. **Two browser windows / profiles** help for the role-switch moments (staff in
   one, jury/IC in the other) so you're not logging in and out on stage.
4. Pick **light or dark** and know where the **sun/moon toggle** is (top-right).

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

**Upload returns but the deck shows "Pending" (not scored).** The API returned
`202 evaluated:false` — the Claude call failed and the deck is parked at
**Pending AI** (graceful degradation, not a crash). Almost always the **Anthropic
account is out of credits.** Check with the repo owner; balance is the usual
cause. Nothing to fix in the app.

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

**Out of credits mid-demo.** Log in as an **Admin**, go to **Config → Core
params**, and set the credit balance back up. 50 is the seeded value.

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
5. **Verify:** the `SELECT` in step 1 returns nothing and both editions read
   `credits_balance = 50`.

> A ready-made cleanup pattern (explicit child deletes + credit refund) lives in
> the HANDOFF verification notes if you prefer belt-and-braces over cascade.
