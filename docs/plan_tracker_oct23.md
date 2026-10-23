# The 23-Oct tracker — triage and session prompts

_Written 2026-10-23 against `main` @ `58412ae`. Every status below was checked against
the code, not inferred from the row's wording. Four rows turned out to be already
built, and three others are "finish it" rather than "build it" — which changes what
each session is for._

---

## 1. Triage

| # | Row | Status |
|---|---|---|
| 1 | "Move to dashboard" re-enables all actions | **S2** — the bar exists (`AppShell.tsx:62`); the re-enabling does not |
| 2 | "Re-evaluate" action + alert | **S2** |
| 3 | Multiple jurors + scores on Jury Pipeline | **S4** — scoped; the payload already carries `assigneeIds` |
| 4 | Shortlisted → Signup pipeline, no manual shortlisting | **S5** |
| 5 | Change password / Forgot / Out of office | ✅ **DONE** — shipped, reachable. Close the row. |
| 6 | "My Account" | ❓ **Needs one line from the client** — §3 |
| 7 | Buy Credits aligned with My Account plans & prices | **S7** |
| 8 | Drift Score report | **S6** — the report EXISTS (`scoredrift`); the row is about the console |
| 9 | Client signing up for 3 decks free | **S7** |
| 10 | Admin console → Sign up section | **S5** — one line hides it today (`HIDDEN_ADMIN_GROUPS`) |
| 11 | AISJ Admin dashboard (accounts, payments, credits) | **S8** — the biggest; needs the platform tier |
| 12 | Payment gateway | **S7** — `ADAPTERS` is still `{}` |
| 13 | Tickets raise → close with status + notifications | **S6** — raise and status exist; close and notifications do not |
| 14 | "I will do deep dive UAT" | — not a work item |
| 15 | Blank screenshots to stop competitors copying | ⚠️ **Not possible as asked** — §3 |
| 16 | Update Open/Close on previous trackers | ⚠️ **§3** — I can draft it, you confirm |
| 17 | Pending invites — nobody receives the email | 🚫 **BLOCKED** — `EMAIL_FROM` is still `""`; needs the zone move |
| 18 | AI score not legible | ✅ **DONE** this session — and it was 14 screens, not one |
| 19 | Complete decks auto-appear in Assign | **S3** |
| 20 | Other programmes' decks appear in Assign | ✅ **DONE** — S1, `2cced45` |
| 21 | Remove AI+ score and "AI base" dropdown | ✅ **DONE** this session |
| 22 | Email query — which address does the founder reply to? | **S9**, blocked behind #17 |
| 23 | Other programmes' decks in Query; context should follow the dashboard | ✅ **DONE** — S1, `2cced45` |
| 24 | Sort on all tables (City, AI score, Status) + export | **S6** |

---

## 2. Done

**#18 — the AI score was unreadable in dark mode, on 14 screens.** `ScoreChip` is
`bg-olive-lt` + `text-olive-dk`: 6.13:1 in light, and **2.10:1 in dark** because
`--olive-lt` drops to `#1f2a1c` while `--olive-dk` is deliberately left alone to keep
the brand ribbon olive. The client's suggested white text would have fixed dark and
wrecked light. New token `--olive-ink` (`#4a5e3a` light, `#a8c493` dark); measured
after the change at 6.13:1 and **7.81:1**. Only `ScoreChip` is converted — the same
pairing is on 13 more files and that sweep is **S6**.

**#21 — the AI+ badge and "AI base" dropdown are gone from Assign**, along with the
six declarations that existed only to serve them. The AI score itself stays.

**#5 — change password, forgot password and out-of-office are already built**,
routed and linked from My Account, with out-of-office in both My Account and Team &
roles. If the client could not find them, that is a discoverability problem worth one
screenshot in reply, not a build.

---

## 3. Needs you, not a session

**#17 invites don't arrive — and nothing in code will fix it.** `EMAIL_FROM` is `""`,
so every message is recorded and nothing is sent. It needs the `startupjury.ai` zone
on Cloudflare first (`docs/DEPLOY.md` §2–§3). Until then the honest workaround is the
one the product already has: Team & roles shows the one-time password on screen for an
administrator to pass on. **#22 is stuck behind the same thing.**

**#15 blank screenshots — this cannot be done as asked.** There is no web API that
blocks a screenshot; the operating system owns that, and any browser-side trick is
defeated by a phone camera pointed at the monitor. What IS possible, in rising order of
effort: a per-viewer watermark (name, email, timestamp) across every screen, so a leaked
screenshot identifies who took it; disabling right-click and print; and a short legal
notice on sign-in. Those deter and attribute rather than prevent. Worth a decision
before anyone spends a session on it — say the word and it is half a day for the
watermark.

**#16 Open/Close columns.** I can produce a status for every row of the earlier
trackers from the commit history and the code, but the client should confirm the
closes — my saying a row is closed is not the same as his having tested it. Ask me and
I will draft the full list for him to tick.

**#6 "My Account" — one line needed.** The row says only "My Account". Three different
things have been called that in this project: the account screen, the plans-and-prices
purchase wizard, and the billing identity from V6. Ask which.

---

## 4. Sessions

Each is a complete prompt. They own disjoint files and can run in parallel unless the
prompt says otherwise. Every one ends with: `npm run typecheck && npm run lint &&
npm test` green — **check the exit codes, not a piped tail**.

---

### S1 — Programme context, everywhere ✅ LANDED (`2cced45`, merged 2026-10-23)

**What shipped.** The storage key is now
`sj_active_context:<tenantId>:<userId>:<edition>` — tenant because that is the
organisation, user because this is one person's working view and two people sharing a
device is the same failure with a smaller blast radius. The old edition-only value is
**discarded, not migrated**: it cannot be attributed to an organisation, so carrying it
across would deliberately re-apply the filter that hid the CEO's decks.

Assign, Query and the five incubator stage screens now follow the context, and each
draws a strip naming the programme in force with a Clear — on the same condition that
narrows the request, so the two cannot disagree. When it cannot name what is in force it
says what is true ("one program" while loading, "a program that is no longer active" for
a retired one) rather than going blank, which is the shape of the original incident.

`?programId=` stays a caller-supplied FILTER and `decks.ts` is unchanged, which was the
right call: it runs inside the tenant scope, so a foreign id returns zero rows.

Gate: typecheck, lint, build, tests all exit 0 — **3220 passed, 1 skipped** (+25).
The incident is pinned as a regression test, as are the old-key discard, a colleague on
a shared device, the VC out-of-scope guards, and that the strip cannot be hidden by the
phone rule that hides `.tbb` in `.tbr` below 900px.

**Follow-ups it surfaced, in files it did not own:**

1. `auth/AuthProvider.tsx` — `AuthUser` should declare `tenantId?: string`. The wire
   already carries it (`routes/auth.ts:351`, `:462`), the type just hides it; S1 worked
   around it with an optional field and no cast. Small, and it belongs to whoever next
   owns that file.
2. **S2 inherits one:** a retired programme still filters the **Dashboard** silently —
   the same class as the incident, on the one screen S1 did not own.
3. Intro calls (`CallsPage.tsx:601`), Evaluate and the jury's Assigned
   (`EvaluatePage.tsx:211`) and the Reports still ignore the context. Decide whether
   they should; the client's wording ("any screen of the item on the sidebar") suggests
   yes.
4. `ProgrammeContextBar` lives in `QueryPage.tsx` only because that was the one S1 file
   no parallel session edits. It belongs in `components/`.

---

### S1 — original brief (kept for the record)

**Owns:** `src/client/activeContext.ts`, `src/client/routes/AssignPage.tsx`,
`src/client/routes/QueryPage.tsx`, `src/client/routes/StagePage.tsx`,
`src/server/routes/decks.ts` (the `?programId=` arm only)

Two tracker rows, one cause. The client: *"The decks of other programs are also
appearing when I am processing decks related to 'Climate24'. Only decks relevant to the
program of context must appear. On any screen of the item on the sidebar, the context of
the program will be same as what is selected on the dashboard page."*

Measure first, and report what you find before changing anything:

1. `activeContext.ts` stores the selected programme/cohort in `localStorage` under
   `sj_active_context_${edition}`. **It is namespaced by EDITION, not by tenant** — a
   known live bug: a programme selected in one organisation is applied in another, and
   it has already hidden a customer's entire deck list from them with no way to tell
   why. Fix the key to include the tenant. The tenant is on the session principal.
2. `DashboardPage.tsx:1207` passes `programId`/`cohortId` into `listDecks`. Find every
   OTHER screen that lists decks and establish which of them read the context and which
   ignore it. Assign and Query are the two the client named; check the stage screens too.
3. `routes/decks.ts:653` is `if (programId) qy.and("d.program_id = ?", programId)` — a
   **caller-supplied** filter, not a boundary. That is correct for a filter and worth
   stating plainly in your report, because it means this row is about defaults and not
   about security.

Then make the context apply consistently on every sidebar screen that lists decks, and
make it visible — a screen silently filtered to a programme with no on-screen indication
is the bug that started this. Show which programme is in force, and let it be cleared.

**Acceptance:** with a programme selected on the Dashboard, Assign and Query show only
that programme's decks; clearing it shows all; the indicator is visible on each screen;
and signing into a second organisation in the same browser does not inherit the first's
selection.

---

### S2 — Move to dashboard, and Re-evaluate

**Owns:** `src/client/components/AppShell.tsx`, `src/client/routes/DashboardPage.tsx`,
`src/server/routes/decks.ts` (the re-evaluate route), `src/server/routes/pipeline.ts`

Two rows:

1. *"'Move to dashboard' feature should work properly. Once any deck is moved to the
   dashboard, all the action buttons must be active to enable the user to use any
   action. This helps the user to undo any action done by mistake."*
   `MoveToDashboardBar` exists at `AppShell.tsx:62`. Find what it does today, and what
   state a deck is left in afterwards. The client's point is about UNDO: a deck moved
   back must be fully actionable again, not stuck with half its actions greyed out.
   Read `V3_ACTIVE_ACTIONS` and the status→action whitelist before changing it — the
   greying is deliberate per status, so the fix is probably about which status the move
   lands the deck in, not about ungating the buttons.
2. *"'Re-evaluate' action should be added. Any deck that's being re-evaluated by
   mistake, an alert should pop showing this is being re-evaluated."*
   There is already `retry-ai` and `rescore`, and both refuse in states the client will
   hit: `retry-ai` is `409 not_pending` unless the deck is at `pending_ai`, and `rescore`
   is `409 already_scored` when the criteria and content versions match. Establish what
   "re-evaluate" should mean given those two, whether it spends a credit (it should —
   `reserveCredits` is the one place every spend passes through), and put a confirmation
   in front of it that names the cost.

**Acceptance:** a deck moved back to the dashboard can be acted on exactly as a fresh
deck of that status can; re-evaluate works from the states a user actually has decks in,
warns before spending, and the resulting score replaces the old one visibly.

---

### S3 — Decks reach Assign only when sent there

**Owns:** `src/server/routes/decks.ts` (the `?list=assign` arm), `src/client/routes/AssignPage.tsx`

The client: *"The complete decks automatically appear in Assign column. They should
appear only after 'Send to Assign'."*

This is the same shape as the 3-Oct work: `SCREENING_NARROWS_LISTS` and the `screened()`
post-filter already exist for the `?list=` arms, and `POST /decks/:id/send-to-assign`
already records the click. Read that commit (`be6239b`) before starting — the lesson it
records is that membership on these screens is a RECORDED ACTION, and the routes that
record it once shipped with no caller at all.

Establish whether Assign currently lists by status (every complete deck) or by
membership (decks actually sent), and move it to membership. Keep the audit property the
3-Oct wave preserved: the send is an event with a real from/to, not a status rewrite.

**Acceptance:** a freshly completed deck does NOT appear in Assign; it appears the moment
Send to Assign is clicked; and a deck already assigned stays visible.

---

### S4 — Multiple jurors and their scores on the Jury Pipeline

**Owns:** `src/server/routes/decks.ts` (the deck payload), `src/client/routes/StagePage.tsx`

The client, twice now, with a prototype reference: each startup may be assigned to
several jurors, and the screen should show each juror and their score.

This is smaller than it looks and the groundwork is done:

- `JuryMembersCell` (`StagePage.tsx:1711`) renders `deck.assignedToName` — **a single
  name** — with a Pending/Evaluated badge. `decks.assigned_to` only ever holds the FIRST
  assignee; the full set lives in `deck_assignments`.
- The payload **already carries every assignee**: `decks.ts:205` selects
  `GROUP_CONCAT(da.evaluator_id)` via a **correlated subquery**, and `:467` exposes it as
  `assigneeIds: string[]`.

So what is missing is the juror NAMES, each one's submitted state, and each one's score.

**The one rule: do not add a JOIN that multiplies rows.** Follow the existing shape at
`:205` — a correlated subquery per field — or fetch the set in a second query keyed by
deck id. A deck with three jurors becoming three rows would corrupt every count on the
screen and every screen that shares the payload.

**Acceptance:** a deck with three jurors shows three names with three scores; a deck with
one is unchanged; the row count on the screen is identical before and after, asserted in
a test; and the footer tallies still agree.

---

### S5 — Shortlisting, and the Sign-up pipeline

**Owns:** `src/server/routes/pipeline.ts`, `src/client/routes/StagePage.tsx` (the
sign-up stages), `src/client/routes/admin/sections.ts`, `src/client/routes/SignupWorkspace.tsx`

Two rows that are one flow:

- *"Shortlisted startups should reflect in the 'Signup pipeline'. The startups are
  shortlisted as per the criteria set in the admin console. No manual shortlisting
  should be allowed by the system."*
- *"Shortlisted startups should be able to sign up as per prototype design. The signup
  section of the admin console should be implemented."*

Start by reading `HIDDEN_ADMIN_GROUPS` in `admin/sections.ts:102` — it is
`["Sign-up"]`, so **four built sections are one line from being reachable**, and the
header there explains why they were hidden. Establish whether they work before unhiding
them; the earlier note about this says hiding a group breaks `?section=` deep links in
unrelated e2e specs, and that skips go per-test, never per-file.

Then the harder half: *no manual shortlisting*. Find every path that can set
`shortlisted` today and establish which are manual. The shortlist floor already exists
(`shortlistFloor` in `shared/scoring.ts`, per-programme with an org fallback). The
client wants the criteria to be the only route in. Be careful: removing a manual
transition is a permission change, and the 3-Oct wave's lesson is that hiding a button
while leaving the transition reachable is the bug this repo keeps reproducing — do both
or neither.

**Acceptance:** a deck crossing the configured floor appears in the Sign-up pipeline
without anyone clicking shortlist; no role can shortlist by hand, enforced server-side
with a negative control proving it; and the admin console's Sign-up sections open.

---

### S6 — Reports, tables and the dark-mode sweep

**Owns:** `src/client/routes/StageKit.tsx`, `src/client/components/DeckCard.tsx` and the
13 files pairing `bg-olive-lt` with `text-olive-dk`, `src/server/routes/support.ts`,
`src/client/routes/SupportPages.tsx`

Three rows that are all "finish what exists":

1. **Sort on every table** (#24). *"Sort facility should enable easy selection of decks
   based on City, AI Score, Status wherever they are. It should help if I want to export
   the selected decks."* Find the shared table component and add sorting there once
   rather than per screen. Sorting must not change which rows are present, and it must
   survive the export — the client's reason for asking is export.
2. **The dark-mode contrast sweep** (#18's tail). `--olive-ink` already exists and
   `ScoreChip` uses it. `bg-olive-lt` appears 53 times across 14 files and the same
   2.10:1 pairing is on 13 of them. **Check each site** — `text-olive-dk` is also used on
   backgrounds that are not `olive-lt`, where it is correct. Measure contrast before and
   after in both themes; do not convert blind.
3. **Tickets, raise to close** (#13). `support.ts` already has `GET /`, `POST /` and
   `POST /:id/status`. Missing: a close path with a resolution, and notifications on
   status change. `emitNotification` exists and `EmailKind` is a CLOSED union — widen it
   properly in shared code if a new kind is needed, never cast past it.

Also check **#8**: the Score drift report already exists (`scoredrift` nav item,
`IncubatorReports.tsx`, `getScoreDrift`). The tracker files it under "Admin console", so
establish whether the ask is to surface it there or whether the report itself is wrong,
and report back rather than guessing.

---

### S7 — Commerce: credits, the free trial, and the payment gateway

**Owns:** `src/server/billing/**`, `src/server/routes/account.ts`,
`src/server/routes/billing.ts`, `src/client/routes/BuyCreditsPage.tsx`,
`src/client/routes/account/**`

Three rows, one subject, and they must be done together because they contradict each
other today:

- *"Buy Credits should align with 'My account plans & prices'"* (#7)
- *"Client signing up for 3 decks free"* (#9)
- *"Payment gateway"* (#12)

The measured state, which the session must not re-derive:

- `ADAPTERS` in `billing/provider.ts` is **`{}`**, by instruction, because pricing was
  not final. The seam already matches a Razorpay Payment Link. Keys were secured in
  September — confirm they still are before building.
- `POST /orders` grants **`creditsGranted: 0`** and says "our team will follow up" —
  the paid path does not grant credits.
- `POST /api/config/credits` is the path that DOES work, is capped at
  `MAX_CREDIT_BALANCE` (now in `shared/plans.ts`), and is an operator grant, not a sale.
- The V6 billing work means the **billing address decides currency and tax**
  (`shared/plans.ts`, `gstApplies`), and `POST /orders` already refuses a currency that
  contradicts the billing country.
- "Take a 3-deck free trial" currently **decrements a client-side counter and grants
  nothing**.

**Do the free trial first** — it is the smallest and it is the one a new customer hits
on day one. It must write a real `credit_ledger` row, because `credits_balance` is the
authority and the ledger explains it; production's books were out of balance for months
because a migration moved one without the other.

---

### S8 — The AISJ admin tier

**Owns:** new `src/server/routes/platform.ts`, new client screens, `wrangler.jsonc`

*"AISJ Admin dashboard to track accounts, payments, credits usage (to start with)."*

The biggest item on the tracker and the one with the least groundwork. What exists:
`isPlatformOwner` in `routes/pricing.ts:334`, used by exactly one route, gated on
`PLATFORM_OWNER_EMAILS` — which is **`""` in production, and the check fails CLOSED**.
There is no platform router and no platform middleware.

Read `docs/plan_multitenancy.md` §7 Q3 first: the recorded decision is that AISJ staff
live in their OWN table rather than in a customer's `users`, because an env-var principal
can hold no audit actor id, no notification preference and no ticket thread. The env-var
allowlist was always the Stage-0 stopgap.

**Set `PLATFORM_OWNER_EMAILS` and redeploy BEFORE gating anything new behind
`isPlatformOwner`**, or you lock yourself out of production.

Start with read-only: organisations, their credit balances and ledgers, their deck
counts. Writes come later. And it must be cross-tenant BY DESIGN, which makes it the one
place in this product where `scoped()` is deliberately not used — say so loudly in the
code, because every other reviewer will read it as the leak this codebase spent a wave
closing.

---

### S9 — The founder reply address

**Owns:** `src/server/email/outbox.ts`, `src/server/config/**`, the Notifications console section

**Blocked behind #17 — do not start until the sending domain is live.**

The client: the query email says *"Click the secure link below to respond"*, and asks
*"Which email id should the founder send the deck with complete details?"* He wants a
configurable default FROM address and a default reply-to for completed decks.

`EMAIL_FROM` and `EMAIL_REPLY_TO` are deployment vars today, not per-workspace settings.
This row is asking for them to be per-workspace, which means a settings row, a console
field, and a resolution order — workspace value, then deployment default. Note that
`EMAIL_FROM_NAME` is `"ai.STARTUPJURY"` globally, so a customer's founder currently sees
OUR name on their mail; that belongs in the same change.

---

## 5. Two standing notes for whoever runs these

**Check exit codes, not piped output.** `npm run lint | tail -2` takes the exit status of
`tail`. A deploy went out on a failing lint that way on 2026-10-06.

**`_tenancy_assert` is not the signal for a migration.** A failing assertion is refused by
its `CHECK (verdict='ok')`, so the table keeps the PREVIOUS run's `ok` row. The exit code
is the signal.
