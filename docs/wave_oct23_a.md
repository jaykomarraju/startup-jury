# Wave A — four sessions, in parallel

Cut from `main` @ `982403a`. Ownership is strictly disjoint, which is what let the
last wave apply nine patches with zero conflicts. **`src/server/routes/decks.ts` and
`src/client/routes/StagePage.tsx` are the two contended files** and each belongs to
exactly one session below; anyone else who needs them reports it instead of editing.

| | Session | Owns |
|---|---|---|
| **P1** | Jury Pipeline — multiple jurors and their scores | `routes/decks.ts`, `routes/StagePage.tsx` |
| **P2** | Commerce — free trial, Buy Credits, payment gateway | `billing/**`, `routes/account.ts`, `routes/billing.ts`, `BuyCreditsPage.tsx`, `routes/account/**`, `shared/plans.ts`, `shared/priceBook.ts` |
| **P3** | Tickets — raise to close, with notifications | `routes/support.ts`, `SupportPages.tsx`, `IssueLogPage.tsx`, `shared/notifications.ts` |
| **P4** | Shortlisting, and the admin Sign-up sections | `routes/pipeline.ts`, `routes/signups.ts`, `admin/sections.ts`, `SignupWorkspace.tsx` |

**Deliberately not in this wave:** the dark-mode contrast sweep (it touches 13 files
across every screen and would collide with all four — run it alone afterwards), S2
(wants `decks.ts` and `DashboardPage.tsx`), S3 (wants `decks.ts` and `AssignPage.tsx`),
and S8/S9.

---

## Shared preamble — paste at the top of each

```
/Users/jayanthkomarraju/Documents/GitHub/startup-jury — Cloudflare Workers + Hono +
D1 + KV + R2; React 19 + react-router-dom 7 + Tailwind 4. Branch from main @ 982403a.
Work in your own git worktree. Node 22 in every shell:

  export PATH="$HOME/.nvm/versions/node/v22.23.1/bin:$PATH"

CONTEXT: the product is LIVE with two organisations — t_default (our demo workspace)
and t_gcw (Global Carbon Warriors, the pilot customer, who are actively building demo
scenarios against production right now). Do NOT deploy. Do not run anything against
`--remote`. The integrator deploys.

RULES
- Own ONLY the files your brief lists. If you need another, say so in your report and
  work around it — a cross-lane edit is discarded at integration and your work with it.
- Read a file before you edit it and write like its neighbours: this repo's comments
  explain WHY, cite file:line, and record what was measured and what was rejected.
- No `any`, no `as` past a type, no @ts-expect-error, no eslint-disable.
- Tests are not optional. If you change a test's premise, RE-POINT it at what it is
  actually testing — never loosen an assertion.
- Client tests are `*.test.tsx` ONLY (the vitest client project matches nothing else).
- Finish with `npm run typecheck`, `npm run lint`, `npm test` each exiting 0.
  CHECK THE EXIT CODES, not a piped tail: `npm run lint | tail -2` takes the status of
  `tail`, and a deploy went out on a failing lint that way on 2026-10-06.
- VC edition is OUT OF SCOPE (client, 2026-10-01) and must keep working untouched.
  `e2e/vc-intake.spec.ts` is the tripwire.
- Mobile matters: the demo is driven on a phone in portrait. Anything you add must work
  at 393px. `index.css:478` hides non-primary `.tbb` inside `.tbr` below 900px, with one
  exception for `aria-haspopup="listbox"` — read that rule before putting a control there.
- Commit on your own branch. Do not merge.
```

---

## P1 — Jury Pipeline: multiple jurors and their scores

**Owns:** `src/server/routes/decks.ts`, `src/client/routes/StagePage.tsx`, new `test/client/*.test.tsx`, `test/worker/*.test.ts`

The client has asked for this twice, by email, with a prototype reference: *"On the
Jury pipeline screen, each startup may be assigned to multiple jurors. Therefore, it
should show multiple juror names and their respective scores next to each startup name.
Currently, it does not."*

**The groundwork is already there — do not rebuild it:**

- `JuryMembersCell` (`StagePage.tsx:1711`) renders `deck.assignedToName` — **a single
  name** — plus one Pending/Evaluated badge from `deck.assigneeSubmitted`.
- `decks.assigned_to` holds only the **FIRST** assignee. The full set is
  `deck_assignments`, one row per (deck, evaluator), since migration `0058`.
- The payload **already carries every assignee**: `decks.ts:205` selects
  `GROUP_CONCAT(da.evaluator_id, '||') AS assignee_ids` through a **correlated
  subquery**, and `:467` exposes it as `assigneeIds: string[]`, deduplicated against
  `assigned_to`. `client/api.ts:339` declares it.

So what is missing is each juror's NAME, each one's submitted state, and each one's
score.

**THE TRAP, and it is a leak if you get it wrong.** Scores are not visible to everyone.
`canSeeEvaluatorScores(edition, viewer, target)` (`shared/roles.ts:196`) is rank-based:
a viewer sees a target's scores only if their evaluation rank is at least the target's.
The Jury Pipeline is readable by the **program associate** (granted 2026-10-02,
read-only), and an associate must NOT receive a jury member's numbers. The evaluation
report already enforces exactly this **server-side** and returns only a COUNT of what
was withheld — find it (`GET /api/decks/:id/report`) and route the per-juror scores on
this screen through the same rule, in the same place. A client-side filter is the bug
this repo keeps reproducing; the server must not send what the viewer may not see.

**THE OTHER RULE: no JOIN that multiplies rows.** Follow the shape already at
`decks.ts:205` — a correlated subquery per field — or fetch the set in a second query
keyed by deck id. A deck with three jurors becoming three rows would corrupt every count
on the screen, the footer tallies, and every other screen sharing the payload.

Two more things to decide and state:

- `ASSIGNEE_PAIRS_SQL` (`src/server/decks/assignments.ts`) now carries an out-of-office
  **delegation** UNION arm, so a delegate is an assignee for authorisation purposes.
  Decide whether a delegate appears in this cell and say why.
- The **VC** `jurypipeline` config (`StagePage.tsx:1383`) deliberately has NO evaluator
  column — its own comment says "no juror column". Do not touch it. The incubator config
  is at `:1984`.

Note `StagePage.tsx` was edited yesterday by S1, which added a `ProgrammeContextBar`
import and a context filter. Do not break either.

**Acceptance:** a deck with three jurors shows three names and three scores; a deck with
one is unchanged; a program associate sees the names but not the jury's numbers, proven
by a negative control; the row count on the screen is **identical** before and after,
asserted in a test; the footer tallies still agree; and it is readable at 393px.

---

## P2 — Commerce: the free trial, Buy Credits, and the payment gateway

**Owns:** `src/server/billing/**`, `src/server/routes/account.ts`,
`src/server/routes/billing.ts`, `src/client/routes/BuyCreditsPage.tsx`,
`src/client/routes/account/**`, `src/shared/plans.ts`, `src/shared/priceBook.ts`, tests

Three tracker rows that must be done together because today they contradict each other:
*"Buy Credits should align with 'My account plans & prices'"*, *"Client signing up for 3
decks free"*, and *"Payment gateway"*.

**The measured state. Do not re-derive it:**

- `ADAPTERS` in `billing/provider.ts` is **`{}`** — deliberately, because pricing was not
  final. The seam already matches a Razorpay Payment Link. Keys were secured in
  September; **confirm with the integrator that they still are before building against
  them**, and do not put a key in the repo.
- `POST /orders` grants **`creditsGranted: 0`** and returns "no credits have been added
  — our team will follow up". The paid path does not grant anything.
- `POST /api/config/credits` is the path that DOES work. It is capped at
  `MAX_CREDIT_BALANCE` (in `shared/plans.ts`, which you own) and is an **operator
  grant, not a sale**.
- The **billing address decides currency and tax** (`shared/plans.ts`,
  `billingCurrencyFor`, `gstApplies`), and `POST /orders` already refuses a currency that
  contradicts the billing country, before any row is written. Keep that invariant.
- "Take a 3-deck free trial" currently **decrements a client-side counter and grants
  nothing**.

**Do the free trial FIRST.** It is the smallest, and it is what a new customer meets on
day one.

**The one rule that is not negotiable:** `org_settings.credits_balance` is the
authority and `credit_ledger` EXPLAINS it (`billing/ledger.ts:7`). Any path that moves a
balance writes a ledger row in the same operation. Production's books were out of
balance for months — `0007` moved a balance with no movement behind it — and a migration
had to reconcile it. Do not reopen that.

**Acceptance:** a new workspace can take the 3-deck trial and the balance AND the ledger
both move by 3; Buy Credits shows the same plans and prices as My Account, from one
source; a real payment either completes and grants credits or is honestly refused — no
third state where money is taken and nothing is granted; and `SUM(credit_ledger.delta)`
equals `credits_balance` for every workspace afterwards, asserted in a test.

---

## P3 — Tickets, raise to close

**Owns:** `src/server/routes/support.ts`, `src/client/routes/SupportPages.tsx`,
`src/client/routes/IssueLogPage.tsx`, `src/shared/notifications.ts`, tests

*"Tickets module from raise to close with status and notifications."*

**Already there:** `support.ts` has `GET /` (admin), `POST /` (raise) and
`POST /:id/status`. **Missing:** a close path that records a resolution, and
notifications on status change.

Three constraints:

- `EmailKind` in `src/shared/notifications.ts` is a **CLOSED UNION** and you own that
  file, so widen it properly if a new kind is needed. Never cast past it — that is the
  dishonest shortcut this repo removed once already.
- `emitNotification` takes a **`scope`**, and two call sites once omitted it: the fallback
  wrote one customer's notification into another's workspace. Pass the scope.
- **Email does not deliver.** `EMAIL_FROM` is `""`, so `email/outbox.ts` records every
  message with `status='recorded'` and dispatches nothing. In-app notifications still
  work. **Do not let any screen claim a send that did not happen** — read the outbox's
  own status back, the way the 2-Oct work made the query screen do.

**And while you are in `support.ts`, close a measured security hole in it.** `:331` is
`messages.use("*", requireAuth)` and nothing more; `:355` sets
`sharedView = channel === "team" || isAdmin`, so the per-user predicate is skipped and
`scope=team` returns **every message in the workspace to every session** — measured, a
mentor whose `/api/decks` is 403 read the seeded team message. Gate the `team` channel
to the staff roles, and **lead with the FOUNDER exclusion**: founders are external and
will hold accounts in this pilot. Expect e2e specs that visit `/app/contactteam` as a
non-staff role to need per-test skips, never per-file.

**Acceptance:** a ticket goes raise → in progress → closed with a resolution; each
transition notifies the right people, scoped to their workspace; nothing claims an email
was sent; a founder and a mentor are both refused the team channel, proven by negative
controls.

---

## P4 — Shortlisting, and the admin Sign-up sections

**Owns:** `src/server/routes/pipeline.ts`, `src/server/routes/signups.ts`,
`src/client/routes/admin/sections.ts`, `src/client/routes/SignupWorkspace.tsx`, tests

Two tracker rows that are one flow:

*"Shortlisted startups should reflect in the 'Signup pipeline'. The startups are
shortlisted as per the criteria set in the admin console. **No manual shortlisting should
be allowed by the system.**"*

*"Shortlisted startups should be able to sign up as per prototype design. The signup
section of the admin console should be implemented."*

**Start with the cheap half.** `HIDDEN_ADMIN_GROUPS` (`admin/sections.ts:102`) is
`["Sign-up"]` — **four built sections are one line from being reachable**, and the header
there explains why they were hidden. Establish whether they actually work before
unhiding them. Note the recorded blast radius: hiding or unhiding a console group moves
`?section=` deep links in unrelated e2e specs, and skips go **per-test, never per-file**.

**Then the hard half: no manual shortlisting.** Find every path that can set
`shortlisted` today and establish which are manual. The criteria already exist —
`shortlistFloor` in `shared/scoring.ts` is per-programme with an organisation fallback,
and `routes/pipeline.ts:354` already computes `blocked` from it.

Removing a manual transition is a **permission change**, and this repo's standing lesson
is that hiding a button while leaving the transition reachable is the bug it keeps
reproducing — the 3-Oct wave removed the jury's shortlist/reject from BOTH the UI and
`pipeline/incubator.ts`'s role lists for exactly that reason. Do both or neither, and
prove the server refuses it with a negative control.

`StagePage.tsx` belongs to P1 this wave. If the sign-up stage screens need a change,
**report it precisely rather than editing** — the integrator will apply it.

**Acceptance:** a deck crossing its programme's configured floor appears in the Sign-up
pipeline without anyone clicking shortlist; no role can shortlist by hand, refused
server-side and proven by a negative control; the admin console's Sign-up sections open
and work; and no unrelated e2e spec is left red.
