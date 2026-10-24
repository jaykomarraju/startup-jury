# A-P4 — Shortlisting by the criteria only, and the admin Sign-up sections. Handoff.

Wave A (`docs/wave_oct23_a.md`), session **P4**. Closes 23-Oct tracker rows **4** and
**10** (`docs/plan_tracker_oct23.md` §1). Branch `wave-a/P4-SHORTLIST`, worktree
`../sj-A-P4`, cut from `main` @ `f77bc29`. No migration.

> **Read §3 before integrating.** The server half of the permission change is on this
> branch. The half that stops screens OFFERING the action lives in files this session
> does not own, and ships as **patch 1** below. Integrating the branch without patch 1
> leaves a Shortlist button that 403s — the inverse of this repo's usual leak, and still
> a defect. They must land together.
>
> **And read §5.1 before DEPLOYING.** With patch 3, the first ten-minute cron tick
> after deploy shortlists every incubator deck — in BOTH organisations, GCW's included —
> that is waiting at Jury Evaluation with a finished panel and a score over its floor.
> That is the rule the client asked for, applied to the backlog. GCW are building demo
> scenarios against production; they should hear it before it happens, not after.

---

## 1. Measured before changing anything

**Exactly one request could put an incubator deck at `shortlisted`:**
`POST /api/decks/:id/transition {"action":"shortlist"}`, open to the programme
manager, admin and superuser. Every other writer of `decks.status` was read:

| Writer | Lands at | Reaches `shortlisted`? |
|---|---|---|
| `send_to_assign`, `details_completed` (`routes/decks.ts`) | `ai_evaluated` | no |
| `schedule_intro` (`routes/calls.ts:781`) | leaves FROM `shortlisted` | no |
| `restore` | `ai_evaluated` | no |
| no-response sweep (`scheduled.ts:288`) | `archived` | no |
| AI path (`ai/evaluate.ts`) | `ai_evaluated` / `incomplete` | no |
| `PUT /decks/:id/recommendation` | moves nothing (0057) | no |
| VC `shortlist_to_partner` | `partner_review`, out-of-scope edition | n/a — left manual |

The UI offered it in three places: `EvaluatePage`'s workbench (role-gated, not
action-gated), every screen drawing `deck.actions` from `allowedTransitions`
(`routes/decks.ts:293`), and the Jury Pipeline's "Send to intro calls" (the same
transition, relabelled, `StagePage.tsx:1782`).

**"The criteria set in the admin console" already existed:** the Scoring framework's
org-wide Shortlist threshold, the programme's own floor winning where set
(`shortlistFloor`), judged on the AI · jury decision score by `checkShortlistFloor`.
It was a guard on a click; it is now the decision.

**The Sign-up group was one string from reachable — but it was two.**
`HIDDEN_ADMIN_GROUPS` said un-hiding was "deleting one string from this array".
`ADMIN_SECTION_GROUPS` ALSO omitted "Sign-up", and the rail draws group by group
(`AdminConsole.tsx:269-277`), so deleting the one string would have made the four
sections open by `?section=` and appear nowhere in the rail.

**The sections work.** Before un-hiding: their component and route suites pass
unchanged (`signupConfig`, `agreements`, `signupWorkspace`, `adminConsole` client
tests; `signup-config`, `esign`, `signups`, `seats` worker tests). After: the eleven browser walks
row 11 skipped — `signup-config.spec.ts` ×5, `agreements.spec.ts` ×5,
`signup-workspace.spec.ts` ×1 — run green un-skipped, unchanged.

## 2. What this branch does

### 2.1 The Sign-up group is back — in the incubator only

`src/client/routes/admin/sections.ts`. `HIDDEN_ADMIN_GROUPS` is now per edition —
`{ incubator: [], vc: ["Sign-up"] }` — and `ADMIN_SECTION_GROUPS` carries "Sign-up"
between Organisation and System, with `adminGroupsFor` dropping it wherever nothing
in it is visible. **The VC rail is unchanged** (out of scope, client 2026-10-01): the
group would have handed the VC admin four sections nobody asked for. `ADMIN_ONLY_GROUPS`
— kept alive through the hidden month "for the day it is un-hidden" — is what makes the
group come back admin + superuser only; negative control: emptying it reddens three
tests in `test/client/adminConsole.test.tsx`.

Incubator console: 15 sections in four groups. VC: 11 in three. Non-admins: 11, as
before. `canSeeAdminGroup` takes the edition (the one signature change; its only
consumers are `sections.ts` and tests).

### 2.2 No manual shortlisting — the server half

`src/server/routes/pipeline.ts`:

- **The refusal.** `POST /decks/:id/transition` with the incubator `shortlist` →
  **403 `shortlist_automatic`** for every role, superuser included, asked before
  `performAction` so it does not depend on the transition table. The body carries the
  deck's `score` and `minimum`, so a screen can say what the deck still needs.
- **The criteria** (`applyShortlistCriteria`, exported). A deck at `jury_evaluation`
  is judged once its **panel is complete** (every assigned evaluator has scored —
  the same question that fires "All evaluations complete"); it is shortlisted iff it
  has a score and clears its floor. The move and its `pipeline_events` row are one
  batch: the UPDATE is conditional on the stage, and the event is inserted
  `WHERE changes() = 1`, so concurrent submits move it once and record it once
  (asserted: a second sweep writes no second event). Actor NULL, action
  `auto_shortlist`, note on the org's display scale ("Shortlisted by the criteria —
  4.6 clears the shortlist threshold of 3.8." on a 1–5 workspace).
- **When.** `POST /decks/:id/evaluate` applies them after the batch, so the last
  juror's submit shortlists the deck with nobody clicking. The response carries
  `shortlist` (the outcome) and the post-move `status`. The panel alert now says what
  the criteria did instead of "ready for review".
- **The sweep** (`sweepShortlistCriteria`, exported) re-applies them to every waiting
  deck in a workspace — for the writers this lane cannot touch (§3, patch 3).
- **Below the floor** a deck stays at `jury_evaluation`; Reject and Archive stay the
  programme's. The client took away the manual shortlist, not the final call.

One deliberate difference from the old guard: it waved an **unscored** deck through
the org threshold ("a score bar, and there is no score"). The system never shortlists
a deck with no score, under either floor.

### 2.3 Tests

New: `test/worker/shortlist-criteria.test.ts` — the role matrix, the two-juror panel,
the alert, the sweep's tenant isolation. Re-pointed (premise moved from "the click is
refused at the floor" to "the criteria decide at the floor"; what each asserts about
the FLOOR is unchanged): `automation.test.ts` ×7, `alldecks-shortlist-hint.test.ts`
×5, `pipeline.test.ts` ×2, `evaluate-w7d.test.ts` ×1, `audit.test.ts` ×1 (now uses
`reject` on its own fixture deck — it needed any person's transition, and the seeded
InsureFlow is shortlisted by patch 3's save hook earlier in that file; measured, the
`reject` answered 409), `test/client/adminConsole.test.tsx`.
E2E: the eleven un-skipped walks; `admin-console.spec.ts` re-pointed per edition;
`pipeline-stages.spec.ts` and `signup-workspace.spec.ts` fixtures now SCORE their deck
onto the shortlist instead of posting `shortlist` as the superuser.

**Negative controls, all run, all restored by file copy:**

| Control | Result |
|---|---|
| Refusal disabled | all six role rows red; superuser, admin, PM get **200 and the deck moves**; associate, jury, founder get `forbidden` from the role list |
| Sweep's SELECT unscoped | tenant probe stays **green** — `checkShortlistFloor` reads through the same scope and judges nothing |
| SELECT + guard + UPDATE unscoped | tenant probe **red** — three layers, any one holds; the probe is not vacuous |
| `ADMIN_ONLY_GROUPS` emptied | three admin-console client tests red |
| Patch 3's two save hooks removed | both save tests red |

## 3. Requested of other lanes — three patches, each `git apply --check`-clean

All three apply to this branch's tip separately and together, and **patch 2 also
applies on P1's committed `StagePage.tsx` (`9afe3b2`)**. The full gate was run with all
three applied; numbers in §4.

### Patch 1 — `A-P4-1-no-manual-shortlist.patch` · MUST land with this branch

Unowned this wave: `src/pipeline/incubator.ts`, `src/client/routes/EvaluatePage.tsx`,
`scripts/role-matrix.ts`, plus the tests that read them.

- **`incubator.ts`: the `jury_evaluation → shortlisted` entry is REMOVED**, not emptied.
  That is the repo's documented shape for a system move (`routes/decks.ts:1433` —
  `ai_evaluated`, `ai_skipped`, `send_to_assign`, `details_completed` have no entry),
  and it keeps the table's invariant that every transition is some role's
  (`test/unit/pipeline.test.ts` asserts it). `allowedTransitions` then offers Shortlist
  to no screen — the Jury Pipeline's "Send to intro calls" and every `deck.actions`
  consumer follow with no change of their own.
- **`EvaluatePage.tsx`:** the workbench's Shortlist button goes; Reject stays. Its
  gate was the viewer's role, not the action, so it would not have followed.
- **`role-matrix.ts`:** a new check that NO incubator role holds the shortlist; the PM's
  decision list loses it. Static run: 181/182, the one failure being the deliberate
  no-server runtime probe.
- Tests re-pointed: `test/unit/pipeline.test.ts`, `test/unit/jury-pipeline-readonly.test.ts`,
  one case in `test/worker/pipeline.test.ts` (the PM is no longer OFFERED shortlist —
  on this branch alone that case still passes, documenting the offered-but-refused
  state patch 1 closes), and a new workbench case in `test/client/evaluateScoring.test.tsx`.

### Patch 2 — `A-P4-2-signup-pipeline.patch` · `StagePage.tsx` is P1's

The acceptance line "a deck crossing its floor **appears in the Sign-up pipeline**"
needs this; without it the deck reaches Intro calls and the PM's pipeline but not
the Sign up Pipeline.

- `INCUBATOR_STAGE_CONFIG.incuration.statuses`: `["signup"]` →
  `["shortlisted", "intro", "signup"]`. The prototype's `cuData` carries a
  `shortlisted` row, and `suSignupBody`'s "Initiate & email founder" step is the
  active one exactly when `signup === 'shortlisted'`. `signupStatusLabel` already
  reads both pre-record stages as "Shortlisted".
- `signupComingSoon: true` removed from the same screen: Oct-3 issue 24 deactivated
  the row's Sign-up button because the client was holding sign-up back; row 10
  releases it. The flag stays on `StageConfig`.
- `test/client/stagePage.test.tsx`: the coming-soon case re-pointed to "live again";
  a new case lists shortlisted / intro / signup and not `jury_evaluation`.

### Patch 3 — `A-P4-3-sweep-wiring.patch` · `scheduled.ts`, `index.ts`, `config.ts`, `programs.ts`

Without it, a deck waiting below its floor is stranded when the floor is LOWERED —
nobody may click shortlist any more — and the decks already waiting at
`jury_evaluation` in production on deploy day are never judged.

- `PUT /api/config/scoring-framework` and `PUT /api/programs/:id` call
  `sweepShortlistCriteria` after saving, **only when an input to the criteria moved**
  (the threshold, the AI / jury split, or a re-score; a programme's floor). Measured:
  an unconditional sweep on the framework save made `e2e/scoring-framework.spec.ts`'s
  show-AI-score flip shortlist the seeded InsureFlow out from under
  `e2e/incubator.spec.ts`. A worker case pins it: an unrelated toggle moves no deck
  (negative control: forcing the sweep reddens it).
- `runShortlistSweep` in `scheduled.ts`, every live workspace, incubator only, on the
  existing `*/10` cron: the catch-all for a cohort split change, an AI re-score, a
  panel shrunk by reassignment, and deploy-day's backlog.
- Four worker cases; removing either save hook reddens its test.

## 4. Gate

Measured on a box shared with the wave's other sessions (load average 16–67 throughout);
`main` itself was not re-measured.

| | this branch | branch + patches 1–3 |
|---|---|---|
| `npm run typecheck` | exit 0 | exit 0 |
| `npm run lint` | exit 0 | exit 0 |
| `npm test` | exit 0 — **3232 passed, 1 skipped** | exit 0 — **3240 passed, 1 skipped** |
| `npm run roles` (static half, no server) | — | 181/182; the one is the deliberate "runtime probe could not reach" |

`npm test` on the branch failed ONCE first, in `test/client/vcPipelines.test.tsx` — a
VC file this branch does not touch — at load average 63; it passed 13/13 alone and the
next full run was clean. Recorded, not hidden.

**E2E**, each on a private `E2E_PORT` with Playwright starting its own freshly seeded
server:

- **Branch** — `admin-console`, `signup-config`, `agreements`, `signup-workspace`,
  `pipeline-stages`, `incubator`, `vc-intake`: 57 passed, 2 skipped, 1 flaky, 1 failed
  with 4 serial followers not run. The failure was `agreements.spec.ts:188` — the page
  after `reload()` never rendered (no snapshot, 0 `fetch failed`); its retry then failed
  on a baseline its own first attempt had saved and not restored. The file alone, no
  retries: **8/8**. The flaky was `vc-intake.spec.ts:79`, a 30 s timeout; alone, no
  retries: **13/13**.
- **Branch + patches** — the same seven plus `scoring-framework`, `evaluate-stage-report`,
  `coverage`, `permissions`, `calls`, `audit-log`: 102 passed, 2 skipped, 1 flaky, 5
  failed. Every failure was `coverage.spec.ts`, every one a `page.goto` that never reached
  `load` — VC and founder screens included, which nothing here touches. `coverage` +
  `calls` alone, no retries: **27/27 in 1.3 min**. All 68 tests in the affected specs
  passed in the combined run.
- The two skips, both runs: `signup-config.spec.ts:225` (the VC `sufund` walk, kept
  skipped deliberately) and `incubator.spec.ts:109` (a pre-existing `test.fixme`). The
  `sudocs` lifecycle walk, which can skip itself, RAN.

**393 px.** The incubator admin's four Sign-up sections, the console rail as its
off-canvas drawer, and the Sign up Pipeline (with patch 2): `scrollWidth ===
clientWidth === 393` on every one — no page-level horizontal scroll. The pipeline's
table scrolls inside its own card, as every stage screen's does.

## 5. Open, and worth a decision

1. **Deploy day moves the backlog.** See the note at the top. The candidates can be
   listed read-only before deploying — incubator decks at `jury_evaluation`, per
   tenant, whose every assignee has an `evaluations` row; the ones whose decision
   score also clears their floor are the ones that will move. This session ran
   nothing against `--remote` and does not know the number. Locally, the seed has at
   least one: InsureFlow (AI 8.6, juror's evaluation seeded) — measured, it moves on
   the first sweep. If the client wants the backlog left alone, ship patch 3 without
   its `index.ts` hunk: the save hooks still work, and only decks whose criteria an
   admin moves will be judged — at the price that the backlog then waits for exactly
   that, since nobody can shortlist it by hand.
2. **Out-of-office cover can strand a deck.** `assigneeIdsOf` returns the absentee AND
   their delegate, and the panel is complete only when every one has scored. A deck
   scored by the delegate alone waits until the absentee scores too. This was the
   existing semantics of "All evaluations complete" (W3-B); it now also gates the
   shortlist. Reject and Archive remain available. Fix, if wanted: complete when each
   BASE assignee has scored or is covered by a delegate who has — in
   `allEvaluatorsHaveScored`, this lane's file, ~20 lines.
3. **The All-decks hint disagrees on one case.** `routes/decks.ts` (P1's) still says an
   unscored deck under the org threshold is "not blocked" — the transition-era rule.
   The criteria never shortlist an unscored deck. Pinned visibly in
   `alldecks-shortlist-hint.test.ts`; the hint should take the criteria's reading.
4. **The pipeline still requires the intro call before sign-up** (`send_signup` leaves
   from `intro`). The prototype's Sign up Pipeline offers "Initiate & email founder" on
   a shortlisted row. Not changed — it is the Jul-24 flow — but if the client means
   "sign up straight from the shortlist", that is a one-transition change.
5. **`AdminConsole.tsx`'s header comment** still says "three groups and eleven
   sections" (`:55-62`) — stale for the incubator, comment only, not this lane's file.
