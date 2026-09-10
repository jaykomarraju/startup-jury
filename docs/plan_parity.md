# plan_parity.md — the parity & production-readiness programme

**Goal.** Close all **1,107 audited parity findings** between the ai.STARTUPJURY prototypes and this
application, and leave the product **launch-ready**.

**Shape.** ~61 sessions in **15 waves**. Sessions inside a wave run **in parallel**, each in its own git
worktree. Every wave ends with a short **integration session** that merges the wave, re-runs the full
green gate on the merged result, and writes the next wave's prompts.

**Status:** **Wave 0 complete and merged to `main`** (`a761703`, 2026-09-09) — the baseline is green
and the parity harness is live (§2.5). Wave 1 is ready: three parallel sessions, prompts in §10.
Baseline on `main`: typecheck ✓ · lint ✓ · 453 unit ✓ · build ✓ · 84 e2e ✓ · roles 526/526 ✓ ·
`parity:nav` 208/278 ✓ · `parity:tokens` 4/27 ✓.

---

## 0. How to use this document

You are probably a fresh session that was handed a prompt. Do this, in order:

1. Read **§1 Ground rules** and **§2 Session protocol**. Do not skip them.
2. Read **only your own session's entry** in §6. Ignore the others.
3. Pull your worklist with `docs/prototype/tools/findings.py` (§3). **Never read
   `docs/PARITY-FINDINGS.md` whole — it is 1.4 MB and will bury your context.**
4. Do the work. Test it (§4).
5. Complete the **exit checklist** (§2.4): update §7 Progress, and write the next prompt(s) using the
   template in §5.

### Context budget

Every session is scoped so its *necessary* reading fits comfortably. The rule is: read your session
entry, your findings worklist, the specific prototype pieces named in your entry, and the repo files
you own. Nothing else. Do not read this whole file end to end; do not read the whole findings file;
do not read a prototype HTML whole (they are 760–1000 KB — use the splitter, §3).

---

## 1. Ground rules

### 1.1 Source of truth, and how conflicts resolve

Precedence, highest first:

1. **The two written product specs** — `docs/prototype/source/specs/{incubator,vc}.html`. They say so
   themselves: *"where a prototype's seed data disagrees with this doc, this doc wins."*
2. **The tester's issue log** (`docs/issue-log-2026-08.csv`, closed 2026-08-25). Where a closed issue
   contradicts the prototype, **the issue text wins and the prototype supplies the visual detail.**
   This rule is already established — do not relitigate it.
3. **The eleven role prototypes** — `docs/prototype/source/{incubator,vc}/`. These are the visual
   contract: layout, columns, copy, colour, density, states.
4. This plan and `docs/PARITY-FINDINGS.md`.

If you find a genuine conflict none of the above settles, **do not guess**: record it in §8 Open
questions, implement the reading you judge best, and say so in your handoff.

### 1.2 Do not build these as drawn

Three prototype behaviours are wrong to reproduce. Anyone who "closes" them by copying the prototype
has made the product worse.

| | What the prototype shows | What to build instead |
|---|---|---|
| **Admin → User access** | Every user's stored password with a reveal control | **Reset only.** Issue a temporary credential, force a change at next sign-in, never display an existing one. Passwords are PBKDF2-hashed and must stay that way. |
| **Seat / plan purchase** | Raw card number and CVV fields in-app | A **provider-hosted redirect or iframed element**. Card data must never reach this application. Already a recorded scope decision (`docs/FINISH-PLAN.md:457`). |
| **Scoring framework** | A "Mentor can adjust composite" toggle | **Omit it.** It contradicts the shipped decision that `mentor` is a directory record with no pipeline authority (commit `8822db2`). |

### 1.3 Vendor-dependent work

Payments, e-signature and CRM sync are built **interface-complete, provider-stubbed** — exactly how
`src/server/email/outbox.ts` already works: the full admin UI, schema, API and application flow ship,
the outbound call sits behind an interface, and the stub records instead of sending. Going live is a
later configuration step, not a code change. Never add a vendor SDK or credential to the critical path.

### 1.4 Standing scope decisions (already locked — do not re-ask)

- Target is **full parity plus every meeting ask**, not a demo subset.
- The **marketing website is out of scope** and is not in this repo.
- **Program Manager holds decision authority** (shortlist/advance, assign jury, manage cohorts for
  programmes they lead) — this overrides the older role-matrix image.
- **Email**: the sending domain is still not onboarded. Sending is gated on `vars.EMAIL_FROM`; every
  message is recorded in `email_outbox` with `status='recorded'`. This is an external DNS step for the
  user, tracked in Wave 14 — do not treat it as a code defect.
- Commit **directly to `main`** after integration; no PRs.

### 1.5 Known defects to fix (not parity gaps)

These are live bugs the audit surfaced. Each is assigned to a session below.

- **`W1-A`** — `BrandingSection.save()` (`src/client/routes/ConfigPage.tsx:402`) posts only
  `{wordmark, tagline, accent}` while `PUT /api/config/branding` (`src/server/routes/config.ts:351`)
  replaces `branding_json` wholesale, so saving branding **silently wipes `orgName`/`orgType`** written
  by the Set up wizard, breaking the org name on the account screen and in founder resubmit emails.
  `SetupWizard.tsx:106-114` already guards this by re-reading and merging; `ConfigPage` does not.
- **`W2-B`** — `src/shared/analytics.ts:181-187` uses the spec's five scoring bands while
  `src/shared/scoring.ts:21-26` uses four, so reports and scoring can label the same score differently.
- **`W4-B`** — branding is persisted and round-trips through the API but is **never applied**:
  nothing reads it and `src/client/components/Logo.tsx` hardcodes the wordmark.

---

## 2. Session protocol

### 2.1 Worktree isolation

> **Prerequisite — this plan and its tools must be committed to `main` before the first worktree is
> created.** A new worktree checks out a commit; anything still untracked in the main working
> directory simply will not exist there, and the session will find no plan, no findings and no tools.
> Verify with `git log --oneline -1 -- docs/plan_parity.md` before starting Wave 0.

Every work session runs in its own worktree on its own branch, so parallel sessions never collide.

```bash
cd /Users/jayanthkomarraju/Documents/GitHub/startup-jury
nvm use                                    # Node 22 — required
git worktree add ../sj-<SESSION-ID> -b parity/<SESSION-ID> main
cd ../sj-<SESSION-ID>
npm ci
```

Work only inside that worktree. Commit as often as is useful; the branch is yours. Never rebase onto,
merge from, or push to another session's branch — integration does that.

The integration session merges the wave and removes the worktrees:

```bash
git worktree remove ../sj-<SESSION-ID>
git branch -d parity/<SESSION-ID>
```

### 2.2 File ownership

Each session entry names the paths it **owns**. Within a wave, ownership is disjoint — that is what
makes the wave safe to parallelise.

- **Only edit files you own.** If you need a change in someone else's file, do not make it. Record it
  in your handoff as a *cross-session request* and the integration session will place it.
- Four files are **serialisation hazards** because everything touches them. They are owned by exactly
  one session per wave, named explicitly in the entry: `src/shared/nav.ts`, `src/shared/roles.ts`,
  `src/client/App.tsx`, `src/client/index.css`.
- **`migrations/` was `W1-B`'s through Wave 1 (`0025`–`0037`); from Wave 2 each session is
  allotted its own migration NUMBER in its prompt, so two sessions can never write the same file.** Every table the plan needs is created
  there, in one numbered block, in Wave 1. If a later session finds it needs a column that does not
  exist, it adds a migration with a number above any in flight **and says so loudly in its handoff** —
  a colliding migration number is the one merge conflict that is genuinely painful.

### 2.3 Definition of green

No session ends without this passing in its worktree:

```bash
npm run typecheck && npm run lint && npm test && npm run build
npm run test:e2e          # required for any UI change
npm run roles             # required for any authZ / nav change — SEE BELOW
```

**`npm run roles` needs a running server.** It is a runtime probe against
`http://localhost:5173` (override with `ROLES_BASE`), and it exits **0 even when it cannot connect** —
it just reports `runtime probe could not reach …` in its findings. A session that runs it without a
server will believe it passed. Start `npm run e2e:serve` in that worktree first, on a port unique to
your session, and pass `ROLES_BASE`. Note `e2e:serve` begins with `rm -rf .wrangler/state`, so run it
only inside your own worktree.

> **A neighbour's server is the same false pass wearing a better disguise.** `W1-C` scored a
> confident 526/526 against port 5183 — which was **`sj-W1-B`'s** dev server, three worktrees away,
> serving that session's code. When waves run in parallel there are several servers up at once, and
> `ROLES_BASE` will happily point at any of them. Pick a port from your session id (`W1-A` → 5171,
> `W2-B` → 5222, and so on), and **prove you own it before you believe the number**:
>
> ```bash
> PORT=51xx
> lsof -nP -iTCP:$PORT -sTCP:LISTEN            # must be empty BEFORE you start
> E2E_PORT=$PORT npm run e2e:serve &            # then, once it is up:
> lsof -nP -iTCP:$PORT -sTCP:LISTEN            # must be your worktree's node
> ROLES_BASE=http://localhost:$PORT npm run roles
> ```
>
> Kill your server when the session ends, and do not leave `until …; do sleep; done` watcher shells
> behind — Wave 1 left several still polling `/tmp` logs after its sessions had finished.

**The e2e suite must run on a freshly seeded database.** `e2e:serve` wipes and re-migrates local
D1 on start, and Playwright's `reuseExistingServer` means a server you left running from an earlier
command is reused *as it is* — carrying every mutation the last run made. Six specs mutate seeded
rows and fail on a second pass over the same state. Let Playwright start its own server (just run
`npx playwright test`), or restart `e2e:serve` before each full run. W0 lost half an hour to this.

Baselines, measured on `main` @ `437e78b` (2026-09-09, W0):

| | |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| `npm test` | **453 passed / 1 skipped** (34 files passed, 1 skipped) |
| `npm run build` | clean |
| `npm run test:e2e` | **72 passed** → **84** with W0's `e2e/parity.spec.ts` (+12) |
| `npm run roles` | **526 / 526**, confirmed against a live server on a private port |
| `npm run parity:nav` | 208 / 278 · **70 known gaps** (W0 baseline) |
| `npm run parity:tokens` | 4 / 27 · **23 known gaps** (W0 baseline) |

If your change moves a count, the new count is the baseline — record it in §7. A red gate is never
"someone else's problem": if you broke it, fix it; if you inherited it, say so in your handoff and
stop.

### 2.5 The parity harness

Two commands W0 added. Both compare the application against the **split prototypes**, so run
`split-prototypes.py` first. Both are green today and carry a frozen baseline of the gaps that exist,
each with a reason and an owning session:

```bash
npm run parity:nav        # every prototype sidebar item → a route that role can reach
npm run parity:tokens     # src/client/index.css vs the prototype :root palette
npm run parity:tokens -- --strict    # known gaps fail too — drive your area to zero
```

They exit **1** on an unexpected failure *and* on a baseline gap that has started passing. The second
case is the un-skip mechanic: close a gap and you must delete its `EXPECTED_GAPS` entry in the same
commit, so the baseline can never drift out of date. Exit **2** means the harness could not run at
all (no split, wrong cwd, prototypes disagreeing) — not a finding.

`e2e/parity.spec.ts` is the third piece: a per-role walk over all 243 reachable screens asserting the
page title and every table's header set against a snapshot. **Change a screen's columns and you
re-capture its rows** (`PARITY_CAPTURE=1 npx playwright test e2e/parity.spec.ts`, then union the new
rows into `EXPECTED`) in the same commit. That diff is the reviewable record of which columns moved.
The snapshot is what the application renders **today**, not what the prototype specifies — it stops
accidental drift; closing the real column gaps is Waves 7–9.

### 2.4 Exit checklist

1. Green gate passes (§2.3), with the new counts noted.
2. Every finding id you claimed is genuinely closed. Spot-check three against the prototype itself.
3. `docs/PARITY-FINDINGS.md` untouched — it is the audit record, not a worklist to edit.
4. **Update §7 Progress** in this file: your row, the counts, anything you could not close and why.
5. **Update §8 Open questions** if you hit a conflict, and §9 Cross-session requests if you needed a
   file you did not own.
6. Write the next prompt(s) using §5, into §10 Next prompts.
7. Commit. Do **not** merge to `main` — integration does that.

---

## 3. The prototypes: how to read them without drowning

Run this once, at the top of your session:

```bash
python3 docs/prototype/tools/split-prototypes.py
# -> ${TMPDIR:-/tmp}/sj-prototype-split/<PROTOTYPE>/…
```

It produces, per prototype: `panel-<slug>.html` (one screen each), `_sidebar.html`, `_topnav.html`,
`_rest.html` (the Set up / My account / founder overlays), `_style.css`, `_scripts.js`, and —
critically — `_ADMIN-CONSOLE.html` plus `admin/s-<id>.html` for each console section.

> **Read this even if you think you know the prototypes.** Three sidebar items — *Set up*, *My
> account* and *Admin console* — do **not** call `showPanel()`. They call `openSetup()`,
> `openAccount()` and `openAdmin()`, and the Admin console is a separate ~170 KB document base64-encoded
> into `var ADMIN_B64`. Any survey that enumerates `panel-*` ids misses it entirely. That is precisely
> how this application came to ship without an admin console.

Prototype directories: `AISJ_IC_SuserV15`, `AISJ_ICAdmin_V6`, `AISJ_IC_PM_V5`, `AISJ_IC_PA_V3`,
`AISJ_IC_Jury_V4`, `AISJ_VC_Superuser_V8`, `AISJ_VC_Admin_V4`, `AISJ_VC_Partner_V1`,
`AISJ_VC_IC_member_V2`, `AISJ_VC_Associate_V1`, `AISJ_VC_Analyst_V1`.
The Super User builds are the feature supersets; the others are role-trimmed.

Panels are thin because their tables and charts are **rendered in JavaScript**. If a panel looks
empty, grep `_scripts.js` for its renderer before concluding anything is missing.

**Your worklist** comes from the query tool, never from reading the findings file:

```bash
python3 docs/prototype/tools/findings.py --areas                      # what exists
python3 docs/prototype/tools/findings.py --area "Admin console" --screen "s-fw|s-wt"
python3 docs/prototype/tools/findings.py --id F0042 --full            # one finding in full
python3 docs/prototype/tools/findings.py --area "Reports" --sev P0,P1 --full
```

---

## 4. Testing standard

Parity work is easy to fake — a screen can look right and do nothing. Every session must add tests at
whichever of these levels apply, and a session that adds no test is presumed incomplete.

| Level | Where | What parity work must prove |
|---|---|---|
| **Unit** | `test/unit` | Pure logic: scoring, permissions, aggregation, formatting, state transitions. |
| **Worker** | `test/worker` | Every new or changed route: happy path, authZ (allowed role **and** a forbidden one → 403), validation, persistence. |
| **Client** | `test/client` | Component rendering, the states the prototype shows (empty, loading, error, populated), and interactions. |
| **E2E** | `e2e/` | The user-visible journey the prototype depicts, walked end to end for at least one role. |
| **Roles** | `npm run roles` | Any change to nav or authZ. 526/526 must hold. |

Three parity-specific rules:

- **Column and copy parity is testable — test it.** When a prototype table specifies columns, assert
  the exact header set in an e2e or client test. This is what stops the same finding reopening.
- **Test the negative.** If a role must *not* see something, assert that it does not.
- **Never weaken a test to make it pass.** If an existing assertion contradicts the prototype, the
  assertion may be the thing that is wrong — but say so explicitly in your handoff rather than quietly
  editing it.

---

## 5. Prompt template

Every session ends by writing the next session's prompt(s) in this shape. Keep prompts **self-contained
but lean** — a prompt that pastes context the session can look up is wasting the budget it is meant to
protect.

```markdown
You are running session <ID> — <one-line goal> — of the ai.STARTUPJURY parity programme.
You have no prior context. Everything you need is in the repo.

SETUP
  cd /Users/jayanthkomarraju/Documents/GitHub/startup-jury && nvm use
  git worktree add ../sj-<ID> -b parity/<ID> <BASE-BRANCH>
  cd ../sj-<ID> && npm ci
  python3 docs/prototype/tools/split-prototypes.py

READ FIRST (in this order, and nothing else)
  1. docs/plan_parity.md — §1 Ground rules, §2 Session protocol, §4 Testing, then ONLY your
     entry for <ID> in §6.
  2. Your worklist:
     python3 docs/prototype/tools/findings.py <FILTER> --full
  3. The prototype pieces named in your entry, from ${TMPDIR:-/tmp}/sj-prototype-split/…
  4. The repo files your entry says you own.
  Do NOT read docs/PARITY-FINDINGS.md whole (1.4 MB). Do NOT read a prototype HTML whole.

BUILD
  <3–8 concrete deliverables, each independently checkable>

CONSTRAINTS
  - Own only: <explicit path list>. Need something else changed? Record it as a cross-session
    request in §9; do not edit it.
  - <any do-not-build item from §1.2 that touches this session>
  - <the precedence rule if this session has a known spec-vs-prototype conflict>

TEST
  <the specific assertions this session must add, per §4>
  Green gate: npm run typecheck && npm run lint && npm test && npm run build
  <plus test:e2e / roles if applicable>

FINISH
  Complete the §2.4 exit checklist: update §7 Progress, §8 Open questions and §9 Cross-session
  requests in docs/plan_parity.md, then write the next prompt(s) into §10 using this template.
  Commit to your branch. Do not merge to main.
```

**Integration prompts** follow the same shape with a fixed body: merge each branch in the wave into an
integration branch, resolve conflicts in favour of the owning session, run the full green gate on the
merged result, fix what the merge broke, place any cross-session requests from §9, merge to `main`,
remove the worktrees, then write the next wave's prompts.

---

## 6. The waves

Dependencies are between *waves*, not within them. Everything inside a wave is safe to run at once.

| Wave | Sessions | Theme | Gate to enter |
|---|---|---|---|
| **0** | 1 | Baseline, guardrails, parity test harness | — |
| **1** | 3 | Foundations: design tokens · all schema · console shell | W0 |
| **2** | 3 | Admin console — evaluation configuration | W1 |
| **3** | 4 | Runtime permissions · notifications · audit · CRM | W1 |
| **4** | 4 | Admin console — organisation | W3 (permissions) |
| **5** | 2 | Admin console — sign-up configuration | W1 |
| **6** | 3 | Sign-up workspace · account purchase · seats | W5 |
| **7** | 6 | Incubator screen parity | W1 |
| **8** | 2 | Incubator reports · parameters | W1 |
| **9** | 5 | VC screen parity | W1 |
| **10** | 3 | Profile & self-service · founder portal · support | W3 |
| **11** | 3 | Written-spec conformance · wiring · inventory | W7–W9 |
| **12** | 2 | Zero-remaining sweep · full regression | W11 |
| **13** | 3 | Production hardening | W12 |
| **14** | 1 | Launch | W13 |

---

### Wave 0 — Baseline & guardrails

#### `W0` · Baseline, harness, guardrails *(solo)*
- **Goal.** Prove the baseline is green, then build the shared harness every later session leans on.
- **Owns.** `scripts/`, `e2e/parity.spec.ts` (new), `package.json` scripts, `docs/plan_parity.md`.
- **Build.**
  1. Run the full green gate on clean `main`; record the real counts in §7. If anything is already
     red, stop and report — do not start the programme on a red baseline.
  2. `npm run parity:nav` — asserts every sidebar item in all 11 prototype `_sidebar.html` files maps
     to a reachable route for that role, comparing against `navForUser`. It will fail today; commit it
     **skipped with the expected failures listed**, and later sessions un-skip their part.
  3. `npm run parity:tokens` — asserts the CSS custom properties in `src/client/index.css` match the
     prototype `:root` block for the tokens the prototype actually uses. Same treatment.
  4. `e2e/parity.spec.ts` — a per-role smoke walk that visits every nav item and asserts the page
     title and the table header set. Seed it with the roles that pass today.
  5. Confirm `docs/prototype/tools/split-prototypes.py` and `findings.py` run clean from a fresh
     worktree.
- **Test.** The harness must be green (with documented skips) and must genuinely fail when pointed at
  a deliberately wrong token — prove it.
- **Done when.** Baseline recorded, three harness commands exist, Wave 1 prompts written.

---

### Wave 1 — Foundations · 3 parallel

#### `W1-A` · Design system & chrome
- **Findings.** `--area "Design system"` (38) — plus the §1.5 branding-wipe defect.
- **Owns.** `src/client/index.css`, `src/client/components/**`, `src/client/theme/**`,
  `src/client/routes/ConfigPage.tsx` *(branding save fix only)*.
- **Build.** Add the olive family (`--olive #6B8454`, `--olive-dk #4A5E3A`, `--olive-lt #EBF0E4`,
  `--olive-md #8FA67A`) with dark-mode counterparts, and re-point the top bar, sidebar active state,
  primary button, progress fills, selected-tile outline and tab underline at it — gold stays for the
  logo and sparse accents. Correct drifted values (`--navy` → `#1A1E2E`, `--offwht` → `#F7F6F2`). Move
  to the prototype's 9–13.5 px density with a fixed-height shell and independently scrolling panes.
  Add the `.tb` surface-toolbar primitive that replaces the in-flow `h1` on every screen. Add sidebar
  item badges/counts, section dividers, and the toast primitive (the prototype has 36 `showToast`
  sites). Fix the branding-wipe defect by merging before save.
- **Test.** `parity:tokens` green and un-skipped. Client tests for the toolbar and toast primitives.
  A worker test proving a branding save preserves `orgName`.
- **Note.** Do this wave, not later: every subsequent screen inherits it, and doing it afterwards means
  re-touching every file twice.

#### `W1-B` · Schema — every migration the programme needs
- **Findings.** None directly; this unblocks Waves 2–6.
- **Owns.** `migrations/**` *(for the whole programme)*, `src/server/db.ts`, `src/shared/types.ts`.
- **Build.** One numbered block of migrations creating everything later waves need, with no UI:
  org scoring settings (the ~15 Scoring-framework controls); per-area rubric anchors across five bands
  plus a per-area AI guidance prompt; a question bank (13 areas × 5, Climate Impact 8);
  `role_permissions(edition, role, task_id, granted)` seeded from the prototype defaults; a real
  `audit_log` with a nullable `deck_id` and a category, so config/team/billing events are storable;
  notification preferences per event × channel × recipient; a credit ledger; price configuration;
  `signups`, `signup_documents`, `agreements`, `signatures` per spec §12; seat capacity on cohorts and
  the `seatless` flag; CRM connection settings. Also correct the nine role-parameter names to the
  spec §6.2 canonical set.
- **Test.** A worker test per table: it exists, its constraints reject bad rows, and its seed matches
  the prototype defaults. Migrations must apply cleanly to a fresh local D1 **and** be idempotent on
  re-run.
- **Note.** Ship types and seeds only. No routes, no UI — those belong to the sessions that own them.

#### `W1-C` · Admin console shell
- **Findings.** `--area "Admin console" --screen "shell|chrome|whole|title.bar|overlay|nav|section"` (19).
- **Owns.** `src/client/routes/admin/**` (new), the `admin` branch of `src/client/App.tsx`.
- **Build.** The full-screen overlay with its 46 px header and Escape-to-close; the 210 px olive section
  rail with the four groups (Evaluation · Organisation · Sign-up · System) and 16 items; the section
  title bar with the program/cohort context chip and the global **Save changes** button; the pending-
  invite badge; the off-canvas drawer under 760 px. Every section renders a placeholder that names what
  will fill it. Sign-up group visible to admin/superuser only. Keep the existing user-CRUD page
  reachable as the Team & roles placeholder until `W4-A` replaces it.
- **Test.** E2E: an admin walks all 16 sections; a non-admin cannot reach the console at all; the
  Sign-up group is absent for non-admin roles that could otherwise reach it. `npm run roles` green.
- **Note.** Do **not** build a read-only console for non-admin roles. The 12-section payload inside the
  seven non-admin prototypes is dead code carrying a stale role taxonomy — only Admin and Super User
  sidebars call `openAdmin()`.

---

### Wave 2 — Admin console: evaluation configuration · 3 parallel

#### `W2-A` · Scoring framework + Area weights
- **Findings.** `--area "Admin console" --screen "s-fw|s-wt|Scoring framework|Area weights"` (28).
- **Owns.** `src/client/routes/admin/ScoringFramework.tsx`, `AreaWeights.tsx`,
  `src/server/routes/config.ts`, `src/shared/scoring.ts`.
- **Build.** The five AI-engine toggles (pre-scoring, auto-clarification, show-AI-before-scoring,
  override rationale, jury peer visibility) and the five transparency/report toggles, each actually
  honoured by the evaluation path — a toggle that renders but changes nothing is not closed. Score
  scale, composite formula and the AI/Jury weight split re-cut `shared/scoring.ts` rather than being
  cosmetic. Org shortlist threshold. Area weights with bars, a live 100 % total and the
  *Permit configuration* control per role.
- **Test.** Unit tests for each composite formula and scale. Worker tests that the AI path reads the
  settings. An e2e proving blind scoring actually withholds the AI score server-side, not just visually.
- **Note.** Omit "Mentor can adjust composite" (§1.2).

#### `W2-B` · Rubric anchors
- **Findings.** `--area "Admin console" --screen "rubric|s-rb"` (12) — plus the §1.5 band mismatch.
- **Owns.** `src/client/routes/admin/RubricAnchors.tsx`, the anchors routes in
  `src/server/routes/config.ts`, `src/shared/analytics.ts` *(band constant only)*.
- **Build.** Per-area anchors across the spec's five bands (9–10 / 7–8 / 5–6 / 3–4 / 0–2) — 16 areas ×
  5 editable strings, 65 pre-seeded — plus a per-area AI guidance prompt, save and revert. Reconcile
  the four-band/five-band split so scoring and analytics agree.
- **Test.** Unit test that one band table drives both scoring and analytics. Worker test for save,
  revert and authZ.

#### `W2-C` · Question bank
- **Findings.** `--area "Admin console" --screen "question|s-qb"` (8).
- **Owns.** `src/client/routes/admin/QuestionBank.tsx`, `src/shared/queries.ts`, the question-bank
  routes in `src/server/routes/config.ts`.
- **Build.** The 68 curated clarification questions across the 13 areas (Climate Impact & Integrity
  has 8, the rest 5) as an editable per-area accordion with add / edit / delete / reorder. Wire the
  bank into clarification generation so a triggered query draws real questions instead of today's
  bullet list of area labels.
- **Test.** Unit test that a weak-signal area selects the right questions. E2E: an admin edits a
  question and it appears in a generated query.

---

### Wave 3 — Permissions & system sections · 4 parallel

#### `W3-A` · Runtime permission engine *(owns the authZ hazard files)*
- **Findings.** `--area "Roles" --sev P0,P1` and the permission subset of the Admin console area.
- **Owns.** `src/shared/nav.ts`, `src/shared/roles.ts`, `src/server/auth/middleware.ts`,
  `src/client/routes/guards.tsx`, `scripts/role-matrix.ts`.
- **Build.** Replace compile-time role literals with a runtime permission set: read
  `role_permissions`, expose `GET`/`PUT /api/permissions`, add a `can(task)` helper used by `nav.ts`
  and by every `requireRole` call site, and carry the resolved permission set on the session. Defaults
  must reproduce today's matrix exactly, so `npm run roles` stays 526/526 before any permission is
  changed. Add the task vocabulary the prototype names but the product lacks: *Out of office
  delegation*, *Remind*, *Reassign / Resubmit*, *Activate / Deactivate / Delete user*, *Access to
  admin console*, *Permit to add team members*.
- **Test.** `npm run roles` 526/526 unchanged with default permissions; then a test that flipping one
  permission changes exactly one capability. Worker tests for the 403 path on every newly gated route.
- **Note.** The single highest-risk session in the programme. Nothing else in this wave touches these
  files.

#### `W3-B` · Notifications
- **Findings.** `--area "Admin console" --screen "notification|s-nt"` (9).
- **Owns.** `src/client/routes/admin/Notifications.tsx`, `src/server/email/outbox.ts`,
  `src/server/scheduled.ts`, `src/client/components/NotificationBell.tsx` (new).
- **Build.** The preference model over event × channel × recipient, and **producers for the nine of ten
  events that currently have none**. The in-app bell and notification centre the prototype's top bar
  shows. Respect `EMAIL_FROM` gating — recorded-not-sent stays correct until the domain is onboarded.
- **Test.** Worker tests that each event produces exactly one outbox row when enabled and none when
  disabled. Client test for the bell's unread state.

#### `W3-C` · Audit log
- **Findings.** `--area "Admin console" --screen "audit|s-al"` (12).
- **Owns.** `src/client/routes/admin/AuditLog.tsx`, `src/server/routes/audit.ts` (new), the audit
  writer helper.
- **Build.** A real org-wide audit trail with category badges, filters and retention, writing on
  config, scoring, team and billing events — not only deck transitions. Keep the existing All-decks
  Activity card working; it becomes a filtered view over the same store.
- **Test.** Worker tests that a config change, a permission change and a credit grant each write an
  audit row with the right category and actor.

#### `W3-D` · CRM sync
- **Findings.** `--area "Admin console" --screen "crm"` (6).
- **Owns.** `src/client/routes/admin/CrmSync.tsx`, `src/server/crm/**` (new).
- **Build.** Provider selection, connection settings, field mapping, sync direction and schedule —
  full UI and persistence, with the provider call behind an interface and a recording stub (§1.3).
  Replace the Upload screen's "raise a support ticket" placeholder with a link to this section.
- **Test.** Worker tests for mapping validation and for the stub recording a sync attempt.

---

### Wave 4 — Admin console: organisation · 4 parallel

#### `W4-A` · Team & roles + user lifecycle
- **Findings.** `--area "Admin console" --screen "team|permission|user.access|s-tm|s-uc"` (37, less
  what `W3-A` closed).
- **Owns.** `src/client/routes/admin/TeamRoles.tsx`, `UserAccess.tsx`,
  `src/server/routes/users.ts`.
- **Build.** The workspace-type switch (Incubator/Accelerator vs Investor), the member roster with the
  full invite lifecycle (pending / resend / cancel), the role legend, and the **task-permission matrix**
  — 21 × 5 incubator, 24 × 6 VC — with grouped rows and click-to-toggle cells writing through
  `W3-A`'s API. Add the missing user verbs: activate, deactivate, delete. The VC build adds a free-text
  *Designation* field on both add-member rows.
- **Test.** E2E: an admin revokes a permission and the target role loses exactly that capability.
  Worker tests for each user verb including authZ and the self-demotion guard.
- **Note.** *User access* is **reset-only** — never render a stored password (§1.2).

#### `W4-B` · Branding, applied
- **Findings.** `--area "Admin console" --screen "brand|s-br"` (12) — plus the §1.5 never-applied defect.
- **Owns.** `src/client/routes/admin/Branding.tsx`, `src/client/components/Logo.tsx`, the branding
  applier.
- **Build.** The 10 brand plus 4 status colour tokens, logo image, two-part wordmark, tagline and
  reset-to-defaults — **applied live** by writing CSS custom properties, which nothing does today.
  Treat `s-br` as the contract; `panel-branding.html` is a stale richer draft that is unreachable in
  all 11 prototypes.
- **Test.** Client test that a saved accent changes the computed property. E2E that a branded wordmark
  survives reload and appears in the top bar.

#### `W4-C` · Credits & billing
- **Findings.** `--area "Admin console" --screen "credit|billing|s-bl"` (16).
- **Owns.** `src/client/routes/admin/CreditsBilling.tsx`, `src/server/routes/billing.ts` (new),
  `src/shared/plans.ts`.
- **Build.** Current-plan tile, usage history, the credit ledger, billing cycle, GST handling, and
  invoice/receipt generation. Keep the existing 1-credit-per-deck metering and its atomic
  reserve/refund — extend it to write ledger rows.
- **Test.** Unit tests for ledger arithmetic and GST. Worker test that an evaluation writes exactly one
  debit and a refund reverses it.

#### `W4-D` · Price configuration
- **Findings.** `--area "Admin console" --screen "price|s-pc"` (13).
- **Owns.** `src/client/routes/admin/PriceConfiguration.tsx`, the pricing routes in
  `src/server/routes/billing.ts`.
- **Build.** The ~50 editable price fields, 14 toggles, seven currencies with editable FX, the 18 % GST
  rate, the plan / pack / enterprise catalogues, preview and publish. **Implement one canonical pricing
  model** and record the alternatives in §8 — the prototype contradicts itself with three per-deck base
  rates, two pay-as-you-go catalogues and four enterprise vocabularies, and only the user can settle it.
- **Test.** Unit tests for FX conversion, per-deck derivation and saving percentages. Worker test that
  publish is atomic.

---

### Wave 5 — Admin console: sign-up configuration · 2 parallel

#### `W5-A` · Required documents + Seat capacity / Fund deployment
- **Findings.** `--area "Admin console" --screen "document|seat|fund|sudocs|suseat|sufund"` (13).
- **Owns.** `src/client/routes/admin/RequiredDocuments.tsx`, `SeatCapacity.tsx`,
  `src/server/routes/signup-config.ts` (new).
- **Build.** The per-programme required-document checklist over the four-state lifecycle
  `not_requested → awaiting → submitted → verified` with a bulk verify. Seat capacity per
  programme/cohort with filled count and utilisation, and the **seatless** flag when a sign-up completes
  without one. The VC edition swaps this section for **Fund deployment** — build both.
- **Test.** Worker tests for the document state machine including illegal transitions, and for the
  seatless flag firing.

#### `W5-B` · Agreements library + Authorised signatories
- **Findings.** `--area "Admin console" --screen "agreement|signator|signing|suagr|susign"` (7).
- **Owns.** `src/client/routes/admin/AgreementsLibrary.tsx`, `AuthorisedSignatories.tsx`,
  `src/server/esign/**` (new).
- **Build.** Agreement templates with a merge-field editor, stage and programme mapping, and a
  signing-workflow builder. Authorised signatories by role or named individual, with countersign gated
  until one is assigned. The signing-method model — provider ∈ {SignDesk, DocuSign, Adobe, Zoho,
  eMudhra}, type ∈ {standard e-signature, certificate}, `inApp` / `wetInk` flags — locked once the
  founder signs. One provider interface, stubbed (§1.3).
- **Test.** Worker tests for merge-field substitution, the countersign gate, and the lock-on-signature.

---

### Wave 6 — Sign-up & commercial surfaces · 3 parallel

#### `W6-A` · The three-tab sign-up workspace
- **Findings.** `--grep "three-tab|Documents tab|Agreement tab|Founder tab|8\.3|signup workspace"` (14).
- **Owns.** `src/client/routes/SignupWorkspace.tsx` (new), `src/server/routes/signups.ts` (new), the
  founder-facing sign-up path in `src/client/routes/FounderPortal.tsx`.
- **Build.** Spec §8.3 in full: **Documents**, **Agreement** and **Founder** tabs sharing one document
  set; the assignment gate that keeps a Programme Manager read-only until a Super User assigns them;
  the founder view for submitting documents, choosing a signing method and signing. Replace today's
  single "Complete sign-up" button.
- **Test.** E2E of the whole loop: admin configures → founder submits → staff verifies → agreement
  countersigned → onboarded. Worker tests for the read-only gate.

#### `W6-B` · My account — the purchase wizard
- **Findings.** `--area "Set up" --screen "acs-|My account|BuyCredits|credits bar"` (28).
- **Owns.** `src/client/routes/AccountPage.tsx`, `src/client/routes/BuyCreditsPage.tsx`.
- **Build.** The eight-screen overlay: individual and organisation branches, the eleven-field org form,
  enterprise plans, fixed packs, credit packs, payment method selection, the GST order summary, the
  transaction receipt and invoice download. Present it as a **full-screen overlay**, not a
  sidebar-framed page — the prototype's stepper and receipt layout depend on the full-bleed column, and
  an account-creation flow inside the app shell reads as a settings screen.
- **Test.** E2E through both branches to a receipt. Worker tests for order totals and GST.
- **Note.** Payment goes through a hosted provider surface. No card fields in this application (§1.2).

#### `W6-C` · Set up wizard — Team & seats
- **Findings.** `--area "Set up" --screen "sus-|Set up"` (24).
- **Owns.** `src/client/routes/SetupWizard.tsx`, the seat routes in `src/server/routes/programs.ts`.
- **Build.** Replace the step-4 empty state with the real team step: owner card, super-user nomination
  gate, per-member plan toggles, seat-capacity bar, the "View all members" roster, and the
  buy-seats → payment → receipt sub-flow with its seat-cap increment. Correct the role gating —
  the prototype hides *Set up* from the incubator Programme Associate and Jury, and hides *My account*
  from everyone except Super User and Admin; the VC edition shows *Set up* to Partner, Associate and
  Analyst.
- **Test.** E2E of the seat purchase raising capacity. `npm run roles` for the corrected gating.

---

### Wave 7 — Incubator screen parity · 6 parallel

Each session owns one screen family. Common pattern: read the prototype panel **and its JS renderer**,
reproduce the toolbar, filters, exact column set and headers, status vocabulary, legends, row actions,
drawer and empty state, then assert the header set in a test.

| Session | Screen family | Findings filter | Owns |
|---|---|---|---|
| `W7-A` | All decks + deck drawer | `--area "Deck intake" --grep "alldecks\|All decks" --edition incubator` (25) | `DashboardPage.tsx`, `DeckCard.tsx`, `EvaluationDrawer.tsx` |
| `W7-B` | Upload | `--area "Deck intake" --grep "upload" --edition incubator` (42) | `UploadPage.tsx`, `src/server/intake.ts` |
| `W7-C` | Query | `--area "Deck intake" --grep "query"` (36) | `QueryPage.tsx`, `src/shared/queries.ts` |
| `W7-D` | Evaluate + the evaluation report | `--area "Evaluation workbench"` (26) | `EvaluatePage.tsx`, `EvalScorecard.tsx`, `EvaluationReport.tsx`, `DeckPdfViewer.tsx` |
| `W7-E` | Assign | `--area "Deck intake" --grep "assign" --edition incubator` (46) | `AssignPage.tsx` |
| `W7-F` | Pipeline stage screens | `--area "Pipeline" --edition incubator` (29) | `StagePage.tsx` *(incubator configs)*, `CallsPage.tsx` *(incubator)* |

Two notes that apply across the wave:

- **`W7-D` must implement spec §8.4 stage-awareness** — which role sections appear in the evaluation
  report depends on the screen it was opened from (Assign → PA + PM; Intro calls → PA + PM + Jury
  read-only; otherwise single-role). The report is not stage-aware today.
- **`W7-F` should extend `StagePage`'s config** to carry a toolbar, sub-tabs and a legend, so the
  generic stage screens can reach parity without being rewritten as bespoke pages. `W9-B` and `W9-C`
  depend on that extension, so land it early in the session and note it in §9.

---

### Wave 8 — Incubator reports & parameters · 2 parallel

#### `W8-A` · Incubator reports
- **Findings.** `--area "Reports" --edition incubator` (69).
- **Owns.** `src/client/routes/analytics/IncubatorReports.tsx`, `JuryReports.tsx`,
  `AnalyticsKit.tsx`, `src/shared/analytics.ts`.
- **Build.** Cohort summary, Evaluator scores, Score drift, Pipeline funnel, and the three jury-scoped
  reports — every KPI tile, chart type with its axes and series, and **exact table column headers**.
  Report format is what the client named specifically; grep `_scripts.js` for each renderer and its
  seed data to recover the intended shape.
- **Test.** Client tests asserting each report's exact column header set and chart series names.

#### `W8-B` · Parameters & scoring configuration
- **Findings.** `--area "Parameters"` (50).
- **Owns.** `src/client/routes/ConfigPage.tsx`, `MyParamsPage.tsx`.
- **Build.** Core Parameters and My Parameters to parity, including the role tabs and the per-parameter
  label / weight / scoring description / AI-extraction prompt. Surface the canonical role-parameter
  names `W1-B` seeded. Note the VC prototype has **four** additional-parameter owner roles (12 params)
  where the application has three (9) — reconcile against spec §6.2.
- **Test.** Client tests for each role's tab set. Worker test that a renamed parameter flows into the
  evaluation report.

---

### Wave 9 — VC screen parity · 5 parallel

| Session | Scope | Findings filter | Owns |
|---|---|---|---|
| `W9-A` | All decks · Upload · Query · Evaluate | `--area "Deck intake" --edition vc` (68) | `VcEvaluatePage.tsx`, the VC branches of `DashboardPage/UploadPage/QueryPage` |
| `W9-B` | Submit · Associate pipeline · Partner pipeline | `--area "Pipeline" --edition vc --screen "assign\|jurypipeline\|partnerpipeline"` (26) | `StagePage.tsx` *(VC assoc/partner configs)* |
| `W9-C` | IC pipeline · Investment DD · term sheet · Legal DD · onboard · archive | `--area "Pipeline" --edition vc --screen "icpipeline\|investmentdd\|incuration\|legaldd\|curation\|archive\|DD"` (22) | `IcVotePage.tsx`, `StagePage.tsx` *(VC DD configs)* |
| `W9-D` | The six VC reports | `--area "Reports" --edition vc` (49) | `analytics/VcReports.tsx` |
| `W9-E` | VC calls — intro · partner · alignment | `--area "Pipeline" --edition vc --screen "introcalls\|partnercall\|alignmentcall\|call modal"` (37) | `CallsPage.tsx` *(VC configs)*, `src/server/routes/calls.ts` |

`W9-C` carries the largest single VC gap: the term-sheet and diligence workspace with its per-item
document state, signatory and signing method, and the renameable DD checklist items in the newer build.
Cross-check the flow against `docs/prototype/source/vc/` and the role-flow diagram in the handed-over
prototype folder.

---

### Wave 10 — Cross-cutting surfaces · 3 parallel

#### `W10-A` · Profile menu & account self-service
- **Findings.** `--screen "Profile menu|out.of.office|password"` (17).
- **Owns.** `src/client/components/Topbar.tsx`, `src/client/auth/**`, `src/server/routes/auth.ts`.
- **Build.** The profile dropdown: username row, locked plan pill, dark-theme switch, **set / change
  password**, **forgot password with a real reset transport**, **out-of-office with delegation to a
  named colleague**, log out, and the inline signed-out login card. This closes a live functional hole
  — a user issued a temporary password currently has no way to change it and no way to recover a lost
  one.
- **Test.** Worker tests for the reset-token lifecycle including expiry and single use. E2E for the
  delegation actually re-routing an assignment.

#### `W10-B` · Founder portal & sign-in
- **Findings.** `--area "Founder portal"` (43).
- **Owns.** `src/client/routes/FounderPortal.tsx`, `ResubmitPage.tsx`, `LoginPage.tsx`.
- **Build.** Founder sign-in as the prototype specifies (email + code), the deck-submission form,
  the clarification-answering UI, the progress indicator and the completion state. Bring the login
  screen to visual parity. Decide and record whether the workspace launcher has any place in the
  product — it is a prototype navigation device, not necessarily a feature.

#### `W10-C` · Support, contact & tickets
- **Findings.** `--area "Support"` (26).
- **Owns.** `src/client/routes/SupportPages.tsx`, `IssueLogPage.tsx`, `src/server/routes/support.ts`.
- **Build.** The ticket queue with its columns, statuses, priorities, assignment, reply threads and
  filters, plus the billing-approval chain. Establish whether *Contact Admin* and *Contact team* are
  genuinely two different forms in the prototype — the application maps both to one component — and
  split them if they differ.

---

### Wave 11 — Written-spec conformance · 3 parallel

#### `W11-A` · Incubator spec conformance
- **Findings.** `--area "Product spec" --edition incubator`.
- **Build.** Walk `docs/prototype/source/specs/incubator.html` chapter by chapter against the code:
  the entity model (§5), parameter taxonomy (§6), scoring and aggregation (§7), state machines (§8),
  screen inventory (§9), cross-cutting behaviours (§10), the suggested schema (§12) and API (§13).
  Two known P0s live here: **`Assignment` is a single FK so a deck can carry only one evaluator**, and
  the evaluation lifecycle has **no pending/draft/submitted state** and no all-parameters-scored gate.

#### `W11-B` · VC spec conformance
- **Findings.** `--area "Product spec" --edition vc`.
- **Build.** The same walk over the VC spec. Known P0s: the IC member cannot score their three role
  parameters anywhere, and VC has no assignment surface — the assign route rejects every VC role.

#### `W11-C` · Wiring, inventory & version drift
- **Findings.** `--area "End-to-end"` (46) · `--area "Screen inventory"` (25) ·
  `--area "Prototype version"` (25).
- **Build.** Close every partially-wired or cosmetic screen the wiring audit flagged; reconcile the nav
  inventory including the `forsignup` → *Prog manager pipeline* slug rename; un-skip `parity:nav`
  entirely.

---

### Wave 12 — Zero remaining · 2 parallel

#### `W12-A` · Sweep
- **Build.** Query every finding not yet marked closed in §7, work it, and drive the open count to
  **zero**. Anything genuinely rejected (for example the three §1.2 items) is recorded as
  *closed — deliberately not built*, with the reason.
- **Done when.** `findings.py --count` for open findings returns 0.

#### `W12-B` · Full regression
- **Build.** Whole-suite run; a responsive pass at the prototype's three breakpoints (900 px rail,
  760 px console drawer, 640 px sidebar drawer); a dark-mode pass over every screen; an accessibility
  pass (focus states, roles, labels, contrast); and a cross-edition, cross-role authZ sweep.
- **Test.** `parity:nav`, `parity:tokens` and `e2e/parity.spec.ts` fully un-skipped and green.

---

### Wave 13 — Production hardening · 3 parallel

#### `W13-A` · Security
- Rate limiting on auth and upload; a real Content-Security-Policy review; **demo seed logins gated or
  removed**; a secrets audit; upload validation hardening; the PBKDF2 and session-cookie posture
  re-checked; dependency audit.

#### `W13-B` · Resilience & observability
- Error monitoring and structured logging; a backup and restore path for D1 with a **rehearsed
  restore**; a migration rollback drill; queue and cron failure handling with retry/dead-letter
  behaviour; health and readiness checks.

#### `W13-C` · Performance & documentation
- Bundle analysis and code-splitting; query and index review on the hot paths; image and PDF handling;
  then rewrite `HANDOFF.md` for the new architecture, refresh `docs/DEMO.md`, and write the
  **operations runbook** — deploy, rollback, restore, rotate, on-call.

---

### Wave 14 — Launch *(solo)*

#### `W14` · Ship
- Apply migrations `--remote` first; `npm run build && npx wrangler deploy`; `npm run smoke` green
  against the live URL; custom domain; and the **user-only steps**, which this session must present as
  a checklist rather than attempt: onboarding the email sending domain and setting `vars.EMAIL_FROM`,
  the payment provider account, and the e-signature provider account.
- Write release notes, update §7 to complete, and close the programme.

---

## 7. Progress

One row per session. The integration session fills the wave row.

| Session | Status | Findings closed | Gate (unit · e2e · roles) | Notes |
|---|---|---|---|---|
| *(pre-flight)* | done | — | typecheck ✓ · lint ✓ · 453 passed / 1 skipped ✓ · build ✓ | Baseline measured on `main` @ `5592a4d`. Lint was red with 318 errors — all from the stale nested worktree `.claude/worktrees/determined-tu-6abd99`, none from application code; fixed by ignoring `.claude/worktrees/**` in `eslint.config.js`. `npm run roles` needs a dev server and exits 0 without one — see §2.3. E2E and roles not yet run; that is `W0`. |
| `W0` | **done** | — (harness session; closes no findings) | typecheck ✓ · lint ✓ · **453 passed / 1 skipped** ✓ · build ✓ · **e2e 84** (72 inherited + 12 new) ✓ · **roles 526/526** ✓ · `parity:nav` 208/278 ✓ · `parity:tokens` 4/27 ✓ | Baseline re-confirmed on `main` @ `437e78b` and **it is green** — the programme may start. E2E and roles were the two unmeasured legs: **72 e2e** and **526/526** both landed exactly where the previous track left them (roles run against a real server on port 5199, not a bare `npm run roles`). Added `npm run parity:nav`, `npm run parity:tokens` and `e2e/parity.spec.ts` (§2.5), each with a frozen, reasoned baseline. Proved all three fail loudly: a bad token, a fixed-but-unclaimed gap, a role removed from `nav.ts`, and a renamed column each exit 1; every temporary break was reverted and the app code is untouched. |

| `W1-B` | **done** | — (schema session; closes no findings, unblocks Waves 2–6) | typecheck ✓ · lint ✓ · **527 passed / 1 skipped** ✓ (453 baseline + 74 new) · build ✓ · **e2e 82 / 84** ⚠ (see note) · **roles 526/526** ✓ (live server, port 5183) | **Migrations `0025`–`0037` — one contiguous block, thirteen files.** `0025` parameters (specs §6.2 canonical names + `description` + `config_permitted`) · `0026` org_scoring_settings · `0027` parameter_rubric_bands + per-area AI guidance prompts · `0028` question_bank · `0029` role_permissions · `0030` audit_log · `0031` notification_preferences · `0032` credit_ledger · `0033` price configuration (currencies · fx_rates · price_plans · price_amounts · pricing_settings) · `0034` signups + required_documents + signup_documents · `0035` agreement templates/fields/programs/flow_steps + agreements + signatures + authorised_signatories · `0036` seat capacity on cohorts · `0037` crm_connections. **Any later session that needs a column starts at `0038`.** New `src/shared/types.ts` carries the row types and seed vocabularies; `src/server/db.ts` gains `ParameterRow` / `getParameters`. Migrations apply to a fresh D1 **and** re-applying the whole set changes nothing — both proved, the second inside `test/worker/migrations-w1b.test.ts`. Three test files edited that I do not own, each because `0025` renamed a parameter and the literal moved, never the assertion: `test/worker/pipeline.test.ts` (3 keys), `e2e/incubator.spec.ts` and `e2e/config.spec.ts` (one label each). **E2E: 82 of 84 pass; the two `coverage.spec.ts` nav sweeps fail — and they fail identically on unmodified `main`**, which I checked in a throwaway worktree at `218658c` under the same conditions. Each walks ~28 slugs sequentially inside one 30-second test budget, which a machine running three parity worktrees at load 20–60 cannot meet. Not caused by this branch; see the §9 row. |
| `W1-A` | **done** | 19 closed · 6 partial · 13 not this session's | typecheck ✓ · lint ✓ · **474 passed / 1 skipped** (453 + 21) ✓ · build ✓ · **e2e 88 (84 + 4 new chrome specs)** ✓ · **roles 526/526** ✓ · `parity:tokens` **27/27, EXPECTED_GAPS now EMPTY** ✓ · `parity:nav` 208/278 ✓ (untouched) | **The olive family is in and the chrome is re-pointed at it.** `src/client/index.css` now declares the prototype's whole 27-token `:root` block verbatim, a semantic layer expressed in terms of it, and the prototype's `body.dark` overrides — so `parity:tokens` is 27/27 with an **empty** baseline map, and `--strict` and the default run are now the same command. Top bar, sidebar active state, primary button, KPI progress fill, selected-tile outline and the report tab underline are olive; gold is the logo and accent numerals. Shell is a fixed frame at the prototype's 9–13.5px density, with the 52px icon-rail tier at 900px and the drawer at 640px. New primitives: `.tb` / `<PageToolbar>` / `<PanelFrame>` (toolbar + pinned footer + 278px rail) and `<ToastProvider>` / `useToast()` (the prototype's 2.4s bottom-centre pill, stacking). Sidebar gained `.bx` badges, section rules, the ruled Settings block, the drawer's Menu header, force-expand-the-active-section and the icon-rail's force-open-every-group. §1.5 branding wipe fixed in `ConfigPage` by re-reading and merging. **Closed:** F0352 F0353 F0358 F0360 F0361 F0364 F0367 F0369 F0372 F0375 F0376 F0377 F0381 F0382 F0384 F0385 F0386, plus the §1.5 defect. **Partial, deliberately:** F0357 / F0374 — the density landed in the shell, the rail, the ribbon and every shared component, but the 24 in-flow `text-xl` `<h1>`s live in routes this session does not own. F0362 — the `.tb` primitive ships and is tested, adoption is Waves 7–9 (§9). F0365 / F0366 — the toast ships and is mounted in the shell, but has no call sites yet and there is still no notification bell. F0368 — badge primitive + tests, no live counts (§9, with the measurement that killed the obvious wiring). F0373 — the role pill is now a translucent ribbon pill, but the edition is still printed beside it because `e2e/nav.spec.ts:42` asserts it (§9). F0380 — table header tint/rule tokens exist, the table markup is the screens'. **Not this session's:** F0349 F0355 F0363 (auth + profile menu), F0351 F0359 (branding application — `W4-B`), F0354 (Export actions), F0356 (For Sign up screen), F0378 F0379 (icon set, custom dropdown), and F0350's per-screen conversions. **One regression found and fixed inside the session:** a blanket `body{overflow:hidden}` — which is literally what the prototype does — clipped the two standalone public pages (`/login`, `/resubmit/:token`) that are `min-h-screen` and legitimately outgrow the viewport, making their lower half unreachable. It is now scoped to `body[data-app-shell]`, set by `<AppShell>` while mounted. `e2e/chrome.spec.ts` pins both halves. **Not a regression:** `e2e/coverage.spec.ts`'s two nav walks fail under machine load. Run alone they are 15.5s and 24.2s against a 30s budget — the same marginality W0 recorded when it gave `e2e/parity.spec.ts` its own 180s timeout. See §9. |
| `W1-C` | **done** | **F0039, F0131, F0133, F0152** closed outright; **F0001, F0006, F0176** closed for the shell they name, with their section bodies handed to Waves 2–5; **F0038, F0151** deferred to §8 Q7 (a client decision, not a build) | typecheck ✓ · lint ✓ · **475 passed / 1 skipped** ✓ (453 → +22 client) · build ✓ · **e2e 103** ✓ (84 → +19, `e2e/admin-console.spec.ts`) · **roles 526/526** ✓ · `parity:nav` 208/278 ✓ **unchanged** · `parity:tokens` 4/27 ✓ unchanged | Built `src/client/routes/admin/**`: the full-screen overlay (46 px `#4A6644` header, Close, body scroll lock, Escape), the 210 px olive rail with four groups and sixteen sections, the title bar (section label + program/cohort chip + global **Save changes**), the pending-invite badge, and the off-canvas drawer below 760 px. Sections switch through `?section=`, so `nav.ts` is untouched and the `admin` slug did not move — `parity:nav` is byte-identical. **Section bodies are placeholders that name their contents and their owning session**, so Waves 2–5 land in a slot rather than inventing one; `saveContext.tsx` is the wire from a section to the title-bar button (disabled today, since nothing owns state yet). **Edition split:** the VC console's fourth Sign-up section is `sufund` *Fund Deployment*, not `suseat` *Seat capacity* — the registry resolves per edition and both e2e walks assert it. **§1.2:** *User access* is titled and described reset-only; a client test asserts its copy never says reveal/show/stored password. **Two files nobody owned this wave were touched, deliberately:** `src/client/routes/AdminConsolePage.tsx` was `git mv`d to `src/client/routes/admin/TeamRoles.tsx` (the path `W4-A`'s entry already names) and kept working verbatim as the Team & roles section; and `e2e/roles.spec.ts` had two `goto("/app/admin")` calls re-pointed at `?section=tm` — **route only, no assertion weakened** (§4). **`e2e/parity.spec.ts` unchanged:** the four `/admin` rows were re-captured (`PARITY_CAPTURE=1`); the title is still `Admin console` and the union of the old header set with the new `tables: []` is the old row, so there was nothing to write. The console now opens on Scoring framework, so the walk no longer *sees* the roster — its exact header set is pinned in `e2e/admin-console.spec.ts` instead, at `?section=tm`. **Trap hit, for the record:** the first `npm run roles` scored 526/526 against port 5183 — which turned out to be **`sj-W1-B`'s** dev server, not this worktree's. §2.3's warning is about a *missing* server; a *neighbour's* server is the same false pass wearing a better disguise. Re-run on 5193 and verified by `ps` before believing it. Pick a port and check who owns it. |

| **Wave 1 integration** | **done** | — (integration closes no findings) | typecheck ✓ · lint ✓ · **570 passed / 1 skipped** ✓ (453 + 21 + 74 + 22, exact) · build ✓ · **e2e 107** ✓ · `parity:tokens` **0 gaps** ✓ · `parity:nav` 70 known gaps ✓ | Merged `W1-B` → `W1-A` → `W1-C`. **Ownership held**: `docs/plan_parity.md` was the only file two branches both touched. Placed both requests addressed here — `tsconfig.node.json` now includes `scripts/`, and the two `coverage.spec.ts` nav sweeps got a 120 s budget. **Two merge defects found and fixed.** (1) §10 was mangled: `W1-B` and `W1-C` both drafted Wave 2 prompts and the union left a headless fragment — which carried the only copy of the `config.ts` ownership arbitration. All three Wave 2 prompts claimed `src/server/routes/config.ts`; arbitrated in §10 (W2-A sole owner; W2-B/W2-C get their own modules). (2) The console declared `aria-modal` while the whole app shell stayed keyboard-reachable behind it — invisible to `W1-C`, whose client tests mount the console in a bare router and whose e2e never presses Tab. The console is now portalled to `<body>`, the shell is `inert` while it is open, and focus returns to the opener. **One e2e flake diagnosed, not papered over:** `parity.spec.ts › vc/superuser` failed once and passes clean — Playwright runs `fullyParallel` at 2 workers against one D1, so the read-only parity walk races the specs that mutate deals. Recorded as Q17. A five-lane adversarial review of the merge produced the §9 rows above and Q17–Q19. |
| `W2-A` | **done** | **F0027, F0041, F0042, F0044, F0077, F0079, F0103, F0104, F0105, F0106, F0107, F0108, F0109, F0153, F0154, F0155, F0165, F0166, F0167, F0168, F0187** closed (21); **F0078, F0110** PARTIAL (see notes); **F0080, F0081, F0156, F0169** deferred with reasons in §8; **F0082** was already closed by `W1-B`'s `0025` | typecheck ✓ · lint ✓ · **654 passed / 1 skipped** ✓ (570 → +84) · build ✓ · **e2e 110** ✓ (107 → +3) · **roles 526/526** ✓ (own server, port 5211, `ps`-verified) · `parity:nav` 208/278 ✓ unchanged · `parity:tokens` 27/27 ✓ unchanged | **The two Evaluation sections, and the behaviour behind them.** `ScoringFramework.tsx` renders all thirteen `s-fw` controls plus the override delta; `AreaWeights.tsx` renders the `s-wt` table (five columns, Core pill, mono zero-padded index, ×3.3 bar, the three footer strings verbatim from `_scripts.js:256-259`) with the role cards, `/ 10` column, `Set total: max 30` footer and the *Permit configuration* pill in the same section. **Every toggle is honoured in the evaluation path, and each has a test that fails if the wiring is removed:** `ai_pre_scoring_enabled` off skips the model call entirely and lands the deck at the edition's first human stage with an `ai_skipped` audit row; `auto_clarification` fires (or does not fire) a real query + outbox mail from `evaluateDeck`; `show_ai_score_to_jury` off **withholds the AI scores, composite, verdict and signal from `GET /api/decks/:id`** — asserted on the API response in `e2e/scoring-framework.spec.ts`, not on the DOM; `require_override_rationale` refuses a submit at `override_rationale_delta` and names every offending parameter; `jury_sees_peer_scores` (off by default) restricts the report matrix to AI + own, with `EVALUATION_RANK` still applied on top when it is on; `show_three_score_view` drops the AI and Average columns; `show_score_drift` empties the drift report; `include_ai_evidence` strips the AI justification from report cells; `intro_call_ai_prompts` drives a new `GET /api/calls/:id/prompts` derived from the deck's own evaluation. **`shared/scoring.ts` re-cut, not decorated:** `composite()` implements all three formulas (the two unweighted ones count only `weight > 0`, so a weight-0 informational parameter cannot drag a median), `decisionScore()` blends at `ai_weight_pct`, and `score_scale` is a display/input scale over canonical 0–10 storage — a 1–5 org's `4` is stored as `7.5`, which is what keeps a 7.0 threshold meaningful. **F0153 is enforced server-side** (`invalid_total`, computed over the resulting full core set), which made three existing fixtures illegal payloads — see §9. **Migration `0038`** does the three §9 fix-ups: the `criteria_version` bump that unblocks re-score, the duplicate-`(edition, key)` delete plus a partial unique index, and all eighteen `0014` AI comments re-seeded against the post-`0025` parameters. **Four new modules, all new files so nothing collides:** `server/config/scoringSettings.ts`, `server/config/autoQuery.ts`, `server/config/callPrompts.ts`, `client/routes/admin/scoringApi.ts`. **Partial:** F0078's AI+/AI++/AI+++ badges ship on the role cards but the *dropdown beside every AI score chip* does not — it is a deck-table change across Waves 7–9 (§9). F0110's intro-call prompts ship; the *verbatim deck excerpt* per parameter does not — it needs a tool-schema field and a `scores` column (§9). **Two readings recorded in §8:** how far the org-wide shortlist threshold reaches (Q20) and whether a role parameter may be promoted to a 5 %/10 % weight against the shipped core-13 = 100 % invariant (Q21). |

<!-- Append a row per session. Do not rewrite history; add. -->

---

## 8. Open questions

Record anything you could not settle. The user answers these; do not block on them — implement your
best reading and note it.

| # | Raised by | Question | Working assumption |
|---|---|---|---|
| Q1 | audit | Pricing contradicts itself: three per-deck base rates (₹500 / ₹999 / ₹500–700), two pay-as-you-go catalogues (20/35/50 vs 10/50/100) and four enterprise vocabularies. | `W4-D` implements one canonical model and records the alternatives here. |
| Q2 | audit | Does the workspace **launcher** belong in the product, or is it only a prototype navigation device? | Not a product feature. `W10-B` to confirm. |
| Q3 | audit | VC has **four** additional-parameter owner roles (12 params) in the prototype; the app has three (9). | Follow spec §6.2. `W8-B` to reconcile. |
| Q4 | `W0` (`parity:nav`) | `AISJ_ICAdmin_V6` is the only incubator prototype whose sidebar drops **both** Collaborate items (Contact Admin, Contact team); Super User, PM, PA and Jury all keep them. Prototype inconsistency, or a deliberate "the admin *is* who you contact" trim? | Keep both for admin (the app's current behaviour). `W3-A` confirms when it owns `nav.ts`. |
| Q5 | `W0` (`parity:nav`) | The PM prototype offers **Sign up Pipeline** and **Onboard ready**; the app reserves both for admin + program associate. §1.4 gives the PM decision authority, which points the other way. | Likely a real gap. `W3-A` settles it with the runtime permission set. |
| Q6 | `W0` (`parity:nav`) | **Core Parameters** (6 roles) and **Set up** (3 VC roles) appear in non-admin prototype sidebars but are admin-only in the app, and `PUT /api/config/parameters` is admin+superuser at 526/526. Read-only visibility, or no visibility? | No visibility, as today. `W3-A` decides; read-only is the likelier prototype intent. |
| Q7 | `W1-B` | The prototype's **task-permission matrix disagrees with the shipped app for the `admin` role**: its "Client admin" column has no Upload, Evaluate, Assign or Query (the section even says "Admins are read-only on evaluation … by default"), while this application's `admin` has had all four since Phase 1 and the roles harness asserts it. | Today's app wins (plan §1.1 puts the prototype below the shipped contract here, and narrowing would break 526/526). The seed grants `admin` those four; `W4-A` can offer the prototype's narrower default as a *reset* if the user wants it. |
| Q8 | `W1-B` | `role_permissions` is seeded as a **gate, not a grant**: `granted = 0` removes a capability, `granted = 1` leaves the app's finer rules (pipeline transition role lists, `requireRole`, stage gating) in place. A single boolean cannot express the prototype's real distinction between *seeing* the Archive screen and *performing* an archive. | `W3-A` must AND the permission with the existing rule rather than replacing it — that is what keeps `npm run roles` at 526/526 on the default seed while still making every cell meaningful. If the user wants view/act as separate cells, that is a second column and a wider matrix. |
| Q9 | `W1-B` | Two VC tasks have **no nav slug of their own**: *MP approval* is seeded from the `mp_approve_dd` transition (partner + superuser), and *Open checklist* from the union of the Investment DD and Legal DD screens. Both readings are judgement calls. | As seeded. `W3-A` / `W4-A` confirm when they render the grid; `PERMISSION_TASKS` in `src/shared/types.ts` records the mapping per task so changing it is a one-line edit plus a seed migration. |
| Q10 | `W1-B` | The **Rubric anchors** screen still shows the stale three-parameter taxonomy (P1 Super User · P2 Program Manager · P3 Jury Member) while the shipped model — and spec §6.2 — has nine role parameters per edition. | Seeded five band rows for all nine (text NULL, exactly as the prototype renders P1–P3 blank), so the screen has somewhere to write. `W2-B` renders nine sections, not three. |
| Q11 | `W1-B` | The notification event **"All jury complete — ready for mentor review"** names a mentor review step that §1.2 says does not exist — `mentor` is a directory record with no pipeline authority. | Kept the prototype's label verbatim on the seeded row (`event_key` is the neutral `all_evaluations_complete`), so nothing is lost. `W3-B` should reword the label when it builds the producer; only the user can say whether the *step* was ever meant to exist. |
| Q12 | `W1-B` | The **agreement templates' programme mapping** uses the prototype's own demo programme names (`Accelerator · Cohort 8`, `Seed Fund II`), none of which exist in this workspace. | Linked the two active templates per edition to real seeded programmes (Fintech Accelerator / SaaS Accelerator; Fund II / Deep Tech Fund) so the mapping is live rather than dangling. A programme that is absent simply inserts no row. `W5-B` re-points them if the user's real programmes differ. |
| Q13 | `W1-A` (`parity:tokens`) | The application's deck-signal ramp has no prototype counterpart. `--color-signal-strong` was `#4a6644`, which the token harness flagged as a possible olive/green conflation. It is neither: the prototype paints scores from `asScoreCol` (`_scripts.js:898` — `#3A7D44` / `#BA7517` / `#B42318`, **three** bands, hardcoded, no token), while `--green #16A34A` is the status-pill hue (`.sp-d`, `.bx-g`). The application has **four** bands. Retune the four onto the prototype's three, or keep four and choose tokens for them? | Kept the four-band ramp under its own `--signal-*` tokens, distinct from `--green`, and declared `--green` at the prototype value. Repointing the ramp recolours scores on every screen in Waves 7–9, so it is theirs to settle. |
| Q14 | `W1-A` | The prototype **inverts `--navy`** in dark mode (`#1A1E2E` → `#EDEFF5`) because it uses navy as an inverted surface (`.prof-btn{background:var(--navy);color:var(--surface)}`). This application uses navy as fixed ink on a gold chip (`bg-accent text-navy`, in routes W1-A does not own) and as a modal scrim — both must stay dark. | `--navy` is declared at the prototype's light value and deliberately **not** inverted in dark; `index.css` says so at the point of declaration. A later session needing the inverting-surface role should add a token for it rather than flip this one. |
| Q15 | `W1-A` | The prototype **abandons the fixed frame on mobile**: `@media (max-width:640px){body{overflow:auto} .view{height:auto;min-height:100vh;overflow:visible}}`. The application's shell stays `h-screen` at every width. | Left as-is — it is what the application already did, so it is an unclosed parity detail rather than a regression, and it interacts with `<PanelFrame>`'s `position:absolute` frame, which no screen has adopted yet. Whichever wave adopts `PanelFrame` should close it. |
| Q16 | `W1-C` (F0038, F0151) | **Who reaches the Admin console, and to do what?** All eleven prototypes ship a console; the seven non-admin ones carry a 12-section variant (`crm`, `nt`, `al` included) that is fully editable — jury and analyst get live CRM Connect/Disconnect buttons and the same ten writable toggles. That is almost certainly a prototype oversight for CRM and billing, but it is clearly deliberate for **Notifications**: `s-nt`'s own sub-line scopes it per person ("…for your account"), so a jury member has no reachable screen on which to switch off their own mail. Two decisions the client must make: (a) does every internal role get a console entry, and (b) is the non-admin console read-only? | Console stays admin + superuser only, as today — `W1-C` built no read-only variant (its §6 note forbids one) and `parity:nav` did not move. The shell is nevertheless ready for a widening: `canSeeAdminGroup()` gates the **Sign-up** group independently of console reachability, so opening `nt`/`al` to every role cannot leak Required documents, Agreements, Signatories or Seats/Fund with it. `W3-A` (permissions) and `W3-B` (notifications) both need the answer; `W3-B` is where it bites. |
| Q17 | Wave 1 integration | `e2e/parity.spec.ts` is read-only but shares one local D1 with specs that mutate deals, under `fullyParallel` + 2 workers. It failed once on a screen that gained rows it did not have at capture time, and passes on a clean run. Union the capture, or give the walk its own serial project? | Left as-is for now — it passes clean and the harness's own docstring anticipates unioning. `W12-B` decides during the regression pass. |
| Q18 | Wave 1 integration | `W1-A`'s §7 disposition does not reconcile: **F0370, F0371 and F0383 are dispositioned nowhere**, and F0380 is listed PARTIAL but received no work. | `W12-A`'s sweep picks up anything unclaimed; no finding is lost, but the wave's closure count is 3 lower than it reads. |
| Q19 | Wave 1 integration | Six of `W1-A`'s closed findings have **no test that fails if the change is reverted** — they are closed by inspection, not by assertion, which is what §4 warns against. | Acceptable for token-level changes that `parity:tokens` now pins wholesale; `W12-B` to confirm coverage during the regression pass. |
| Q20 | `W2-A` (F0187) | **How far does the org-wide `Shortlist threshold` reach?** The prototype puts one on the Scoring framework (default 7.0) and F0187's fix says `checkShortlistFloor` should fall back to it when `programs.shortlist_min` is null. Applied literally that also means an **unscored** deck can never be shortlisted anywhere, because the shipped per-programme guardrail blocks unscored decks — and on a fresh workspace that stops the pipeline before anyone has scored anything. | Implemented as the fallback floor for decks that HAVE a score, and left silent about decks that have none: the org value is a bar a score is measured against, while a programme floor is an explicit opt-in guardrail whose "no score can clear it" rule an admin chose. One condition in `checkShortlistFloor` (`score === null ? source === "program" : …`) is the whole difference; a client who wants the stricter reading flips it. Two `automation.test.ts` fixtures moved with this — see §9. |
| Q21 | `W2-A` (F0081) | **Both specs say a role parameter may be promoted to a 5 % or 10 % weight; the build's stated invariant is "composite stays core-13 = 100 %".** W2-A has now made that invariant enforceable (`PUT /api/config/parameters` refuses a rubric that does not total 100, F0153), which makes the conflict concrete rather than latent: promoting an informational parameter to 5 % either takes that 5 % from the core areas or produces a documented 105 % denominator. | **Not built.** The finding itself says the denominator question has to be decided explicitly, and it is a client decision about what a composite means, not an implementation detail. Nothing about the 100 % enforcement forecloses either answer. Whoever settles it needs `config.ts` (the weight route already refuses `informational = 1`), `MyParamsPage` and a line in `shared/scoring.ts`. |
| Q22 | `W2-A` | **`score_scale` is implemented as a display/input scale over canonical 0–10 storage**, not as a change of what is stored: a 1–5 organisation types a `4` and `7.5` is persisted. The alternative — storing on the chosen scale — would re-base every seeded score, both cohort thresholds, the shortlist threshold and the five rubric bands the moment an admin changed the select. | Canonical 0–10, converted at the edges (`toDisplayScale` / `fromDisplayScale`). It is the only reading under which a threshold of 7.0 keeps meaning the same thing across a scale change, and it leaves the AI tool schema on 0–10 so scoring granularity is never lost. Recorded because it is a decision, not an obvious consequence of the prototype. |

---

## 9. Cross-session requests

When you need a change in a file you do not own, write it here instead of making it. The integration
session places it.

| From | File needed | Change | Placed by |
|---|---|---|---|
| `W0` | `tsconfig.node.json` | Add `"scripts"` to `include`. `scripts/*.ts` is not typechecked by `npm run typecheck` today — `role-matrix.ts` never was, and W0's three new scripts inherit that hole. All four compile clean under exactly the options already in that file, verified with a throwaway config; the change is one line and green. | Wave 1 integration |
| `W1-B` | `src/server/ai/evaluate.ts:562`, `src/server/routes/pipeline.ts:948` | Both still read the **global four-band `rubric_anchors`** table from `0001` (0–1 / 2–4 / 5–7 / 8–10). The specs' five-band scale now lives per parameter in `parameter_rubric_bands` (`0027`), with `band_name` carrying the spec §7 labels. **`W2-B` owns this reconciliation** (it is the §1.5 defect); I have not touched either file, and `0027` deliberately leaves `rubric_anchors` in place so nothing breaks before W2-B lands. | `W2-B` |
| `W1-B` | `test/worker/pipeline.test.ts`, `e2e/incubator.spec.ts`, `e2e/config.spec.ts` | **Already placed, flagged per §4.** `0025` renamed the nine role parameters to the specs' §6.2 canonical set, and these three files named the old labels. I changed only the literals — `add_jury_resilience` → `add_barriers_of_entry`, `add_pm_program_fit` → `add_trl_stage`, `add_pa_mandate_fit` → `add_program_fit`, and "Founder Resilience & Coachability" → "Barriers of entry" — never the assertion. Parameter **ids** are untouched, so no seeded score or FK moved. | placed by `W1-B` |
| `W1-B` | `e2e/coverage.spec.ts` (or `playwright.config.ts`) | **The two nav-sweep tests have no timeout budget for the work they do.** Each logs in and then walks ~28 slugs sequentially inside the default 30 s per-test budget — about 1 s per navigation with nothing to spare. They pass on a quiet machine and fail on a busy one, on `main` as well as on any branch, which makes every session's e2e leg look red for reasons that have nothing to do with its work. Fix by giving those two tests their own `test.setTimeout(120_000)`, or by splitting the sweep per section. I did not touch either file — neither is mine, and a timeout is exactly the kind of test change §4 says to raise rather than make. | Wave 1 integration |
| `W1-A` | `src/shared/nav.ts` *(`W3-A`)* + a new counts route | The sidebar renders `.bx` count badges from a `badges` prop (`<Sidebar badges={…}>`), but nothing supplies it, so the prototype's blue **All decks** count and red open-**Tickets** count do not appear. Two things are needed: an optional `badge` key on `NavItem` so the manifest says which items carry one, and a **cheap** counts endpoint. The obvious wiring (`listDecks()` + `listTickets()` from `AppShell`) was built and **measured**: it pushed `e2e/coverage.spec.ts`'s 30-slug VC walk from 22.7s past its 30s budget — two full list queries on every page load. It was reverted. Do not re-add it without a counts route. | Wave 3 (`W3-A`) |
| `W1-A` | every routed screen under `src/client/routes/**` *(Waves 7–9)* | Adopt `<PanelFrame>` / `<PageToolbar>`. The `.tb` primitive and the fixed frame ship and are tested — including a real-browser geometry test in `e2e/chrome.spec.ts` — but **no screen uses them yet**: 24 screens still render an in-flow `text-xl <h1>` on the page background, which is F0362 and half of F0357/F0374. `<PanelFrame title subtitle actions footer rail>` is a drop-in: it absolutely fills the shell's content pane, scrolls only its body, and pins the toolbar and the count+legend footer. Adopting it moves no page title text, so `e2e/parity.spec.ts` stays green. | Waves 7–9 |
| `W1-A` | `e2e/nav.spec.ts:42` | The ribbon still prints the **edition** beside the role pill because this assertion requires it for all eleven role walks. The prototype's ribbon (`_topnav.html`) shows name + role pill only — that is F0373. Per §4 the assertion was not weakened; the session that closes F0373 changes it in the same commit and says so. | whichever session closes F0373 |
| `W1-A` | `e2e/coverage.spec.ts:42,56` | Both nav walks run at the default 30s test timeout while taking 15.5s and 24.2s on an idle machine — they fail whenever anything else is using the CPU, and did so repeatedly during this session while the sibling W1 worktrees were running their own suites. `e2e/parity.spec.ts:113` already carries `test.setTimeout(180_000)` with a comment saying exactly this. Give these two the same. Not touched here: it is a test-robustness change in a file this session does not own. | Wave 1 integration |
| `W1-A` | `src/client/routes/QueryPage.tsx` | Its tab strip still underlines the active tab in amber. `EvaluationReport.tsx` (owned here) is now `border-olive` / `text-olive-dk`; QueryPage should match. One line, no behaviour change. | Wave 7 |
| `W1-A` | screens using `bg-surface-2` as a **card** on the page ground | `--surface-2` is now the warm inset neutral `#F2F0EA` (was `#FBFCFA`), a half-step between the prototype's `--offwht` ground and its `--stone` rule. Anything using it as a card should be `bg-surface` (white), which is what the prototype draws. Nothing is broken today — this is a legibility improvement to make while converting each screen. | Waves 7–9 |
| `W1-C` | `migrations/**` (owner `W1-B`) + `src/server/routes/users.ts` and `src/client/api.ts` (owner `W4-A`) | **An invite-acceptance state on `users`.** The console rail's red `.nb` badge on Team & roles counts members whose invite is still pending (prototype `tmMembers[].pending`, `admin/_style.css:26`). The repo has no such state — `users` carries `active` only, and `InviteResult` reports *email delivery*, not acceptance. `W1-C` shipped the badge and `pendingInviteCount()`, which reads an optional `invitePending` defensively and is therefore 0 today, so nothing renders. Add the column, return it on `GET /api/users`, and the badge lights up with no client change. | `W1-B` (column) + `W4-A` (route + type) |
| `W1-C` | `src/client/index.css` (owner `W1-A`) — **no edit needed, read this instead** | The prototype's Admin console is a **separate document with its own palette**: `--olive:#4A6644` / `--olive-lt:#EEF3EA`, materially darker than the app shell's `--olive:#6B8454` / `--olive-lt:#EBF0E4` that `W1-A` is adding. `W1-C` did not declare a global token — the console's two values are scoped to the overlay as `--ac-olive` / `--ac-olive-lt` in `AdminConsole.tsx`, where they cannot collide with W1-A's family. If the client would rather the console adopt the app hue, it is a two-value edit in that one file. | nobody — informational |
| `W1-C` | `src/client/routes/admin/TeamRoles.tsx` (owner `W4-A`) | **The file `W4-A`'s entry names already exists.** `W1-C` moved `src/client/routes/AdminConsolePage.tsx` there verbatim (`git mv`, imports re-pointed, page-level `<h1>` dropped because the console title bar supplies it) and exported it as `TeamRolesSection`. `W4-A` replaces its body; the console needs nothing else. | `W4-A` |
| Wave 1 integration | `migrations/0038*` + `src/server/routes/config.ts` *(`W2-A`)* | **`0025` rewrote all 18 AI scoring prompts but never bumped `org_settings.criteria_version`.** The re-score guard (`src/server/routes/decks.ts:918-949`) compares a deck's `scored_criteria_version` against the current one, so every seeded AI evaluation now reads as current against a rubric that changed underneath it and **re-score returns 409**. Verified at integration: `criteria_version` appears nowhere in `0025`. `W2-A` owns the scoring config and is the natural place — bump it in a `0038` migration in the same commit as the framework settings. | `W2-A` |
| Wave 1 integration | `migrations/0038*` *(`W2-A`)* | **`0025` left two duplicate `(edition, key)` parameter rows.** `0007` created `add_program_fit` (incubator) and `add_thesis_fit` (vc); `0025` renamed two *different* rows onto the same keys. `parameters` has no UNIQUE on `(edition, key)`, so both persist. Verified NOT live: `0013` sets `active = 0` on every informational row, so the `0007` pair is inactive, and nothing in `src/` looks a parameter up by `key`. It is a latent trap for the first `WHERE key = ?` that forgets `active = 1`. Fix by deleting the retired rows and adding `CREATE UNIQUE INDEX … ON parameters(edition, key) WHERE active = 1`. | `W2-A` |
| Wave 1 integration | `migrations/0014_seed_role_param_scores.sql` *(`W2-A`)* | **Twelve of eighteen seeded AI comments now contradict the labels above them** — `0014` wrote them against the pre-`0025` parameter names, so the demo data explains "Founder Resilience & Coachability" under a heading that now reads "Barriers of entry". Cosmetic in production, but it is what a client sees in the demo. Re-seed the comments alongside the `0038` work. | `W2-A` |
| Wave 1 integration | `test/worker/migrations-w1b.test.ts` *(`W2-A` or `W12-B`)* | **The idempotence test proves nothing.** `applyD1Migrations` skips migrations already recorded as applied, so the second call executes zero SQL and the assertion passes regardless. Re-point it at re-running the migration *bodies* against a populated database, or drop the claim. | `W12-B` |
| Wave 1 integration | `src/client/routes/admin/AdminConsole.tsx:181` *(Waves 2–5)* | **The console overlay is `z-50`, tied with every other app modal** (`EvaluationDrawer`, `EvaluationReport`, `CallsPage`, `EvaluatePage`) and *below* `DeckPdfViewer`'s `z-[60]`. Harmless today because every section body is a placeholder, but the first section that opens a deck preview or an evaluation report inside the console will paint it over the console chrome. Give the console its own tier — `z-[2000]`, between the app modals and the toast viewport's `z-[3000]`. | first Wave 2–5 session to open a modal inside a section |
| Wave 1 integration | `src/client/routes/admin/sections.ts:122` *(`W2-B`)* | The Rubric anchors placeholder tells `W2-B` there are **16 areas**; the specs and `0027` have **22** (13 core + 9 role), and the "16 × 5 = 65" arithmetic in the same string is wrong either way. Correct the copy when you build the section. | `W2-B` |
| `W2-A` | `test/worker/automation.test.ts`, `test/worker/config.test.ts`, `test/worker/issuelog-aug2026.test.ts`, `test/client/workbench.test.tsx`, `test/client/adminConsole.test.tsx`, `e2e/config.spec.ts`, `e2e/evaluate-workbench.spec.ts`, `e2e/admin-console.spec.ts` | **Already placed, flagged per §4 — eight files, and in every one the assertion was preserved and only what it asserted the ABSENCE of moved.** (1) `automation.test.ts` — the decision score is now blended at the org's `ai_weight_pct`, whose shipped default is 40/60, so `6.5` became `6.2`; and "does not block when the program has no floor" asserted the absence of F0187's org threshold, so it now asserts the fallback, plus a new test pinning the unscored-deck reading (§8 Q20). (2) `config.test.ts` — two fixtures were single-parameter weight payloads that no longer total 100 % (F0153); both now send a legal whole-rubric save and test exactly what they did before, and a new test pins the refusal. (3) `issuelog-aug2026.test.ts` — issue 21's hierarchy walk now switches peer visibility ON explicitly (it is seeded OFF, F0109), and a new test pins the OFF behaviour, so **both contracts are asserted** rather than one silently replacing the other. (4) `workbench.test.tsx` — the Average tile's `6` became `5.6` for the same 40/60 reason, with new tests for the split, the 3-score view, the score scale, blind scoring and the rationale field. (5) `adminConsole.test.tsx` and (6) `admin-console.spec.ts` — both pinned the registry to the sections built at the time (`toEqual(["tm"])`, `if (section.id !== "tm")`); they now assert that the roster is reachable and that an *unbuilt* section names its owner, which is what they meant and needs no edit next wave. (7) `config.spec.ts` — the weights walk filled one input and left the rubric at 101 %; it now moves two and additionally asserts Save is disabled off-100. (8) `evaluate-workbench.spec.ts` — asserted `Already scored`, which is the **bug** `0038` fixes; it now asserts the guard lets the request past its version check and refuses for the seeded deck's missing PDF instead. | placed by `W2-A` |
| `W2-A` | `src/client/routes/ConfigPage.tsx` (unowned this wave) | **Already placed, three lines.** The standalone `coreparams` screen's Save button was gated only on `busy \|\| locked`, so with F0153 enforced server-side it offered a save that could only 400, under an error line that said the wrong thing. It is now disabled off-100 with the prototype's own remaining/over-by copy in the footer and the tooltip. F0168 keeps that screen's per-card saves, so nothing else there moved. | placed by `W2-A` |
| `W2-A` | `src/client/routes/admin/registry.tsx` (the slot W1-C built for exactly this) | **Already placed, three lines** — one import and the `fw:` / `wt:` entries, in `secs` order, as that file's own docstring instructs. Nothing else in the console shell was touched. | placed by `W2-A` |
| `W2-A` | `src/server/ai/evaluate.ts`, `src/server/routes/pipeline.ts` — **overlaps `W2-B`** | **Read this before merging Wave 2.** `W2-B` was assigned the rubric-band reconciliation in these two files (`evaluate.ts:562`, `pipeline.ts:948` in the pre-wave numbering) and `W2-A` had to touch both as well, in different places: in `evaluate.ts` the pre-scoring switch and the `skipAiEvaluation` helper near the top of `evaluateDeck`, the `composite_formula` argument to `computeResult`, and the `maybeAutoClarify` call after the persist batch; in `pipeline.ts` the jury-submit handler (scale conversion, the override-rationale rule, the composite formula) and `checkShortlistFloor`. Neither session touches the anchor rows or `buildUserPrompt`. The merge should be clean but it is the one place in Wave 2 where two sessions edited the same file, so diff it rather than trusting it. | Wave 2 integration |
| `W2-A` | `src/client/api.ts` (owner `W4-A` for the invite field) | **Already placed, two additive type changes**, needed because the feature spans server → client: `DeckReport` gains an optional `aiScoreWithheld`, and `getMyScores` returns the per-parameter `comment` (the override rationale, which must round-trip or the next submit is refused for a rationale the evaluator already wrote). No existing field changed shape. The four W2-A routes deliberately live in `src/client/routes/admin/scoringApi.ts` instead, so three parallel Wave 2 sessions could not collide in `api.ts`; folding that module back in is a tidy-up for `W12-A`, not a behaviour change. | placed by `W2-A` |
| `W2-A` | `src/client/components/DeckCard.tsx` / the deck tables *(Waves 7–9)* | **F0078 is half closed.** The AI+ / AI++ / AI+++ tier badges now label the role cards in Area weights, and the section's copy names which role owns which tier. The other half — *"viewable from the dropdown beside any AI score"* — is a control on every `ScoreChip` across All decks, the pipelines and the report, which is a Waves 7–9 change to screens W2-A does not own. The score itself is already derivable: each owning role's three parameters are scored out of 10 for a set total of 30. | Waves 7–9 |
| `W2-A` | `src/server/ai/evaluate.ts` (tool schema) + a `scores` column *(whoever closes F0110 in full)* | **F0110 is half closed.** *Intro call AI question prompts* now exist (`GET /api/calls/:id/prompts`, derived from the deck's own weakest areas, missing slides and absent intake fields, and gated on `intro_call_ai_prompts`). *AI evidence quotes* are only half there: the toggle gates the AI's per-parameter **justification** in the report, which is what this build stores, but the prototype's copy — "Show which deck text drove each area's AI score" — asks for a **verbatim deck excerpt**, which needs an `evidence_quote` field in the AI tool schema, a column to hold it and a render in `EvaluationReport.tsx`. Not attempted here: it is an AI-contract change, and W2-B is already in that file this wave. | `W12-A` (or whichever wave re-opens the AI tool schema) |
| `W2-A` | `src/client/routes/CallsPage.tsx` *(Wave 7 / `W3-B`)* | **`GET /api/calls/:id/prompts` has no screen yet.** The route returns `{enabled, prompts:[{topic, because, question}]}` for anyone who can see the call, and `enabled: false` with an empty list when the admin has the toggle off — so the call screen can drop the block rather than render an unexplained blank. Rendering it is a few lines in whichever session owns the call detail. | Wave 7 |

---

## 10. Next prompts

The prompts to paste into the next wave's sessions. Each session appends here; each integration
session replaces this list with the following wave's.

> **Wave 1 — three sessions, run in parallel, all branching from `main`.** `W0` is merged
> (`a761703`), so `npm run parity:nav`, `npm run parity:tokens` and `e2e/parity.spec.ts` are all on
> `main` and every worktree cut from it inherits them. Nothing gates this wave.

### `W1-A` — design system & chrome

```
You are running session W1-A — the design system and app chrome — of the ai.STARTUPJURY parity
programme. You have no prior context. Everything you need is in the repo.

SETUP
  nvm use
  git worktree add ../sj-W1-A -b parity/W1-A main
  cd ../sj-W1-A && npm ci
  python3 docs/prototype/tools/split-prototypes.py

READ FIRST (in this order, and nothing else)
  1. docs/plan_parity.md — §1 Ground rules, §2 Session protocol (§2.5 is the harness you will
     live in), §4 Testing, then ONLY your entry for W1-A in §6.
  2. Your worklist:
     python3 docs/prototype/tools/findings.py --area "Design system" --full
  3. The prototype chrome, from ${TMPDIR:-/tmp}/sj-prototype-split/AISJ_IC_SuserV15/:
     _style.css (the :root block and the .tb / .si / .sgrp / toast rules), _sidebar.html,
     _topnav.html. Cross-check one VC build (AISJ_VC_Superuser_V8) — the palette is identical
     across all eleven, so read it once.
  4. The repo files your entry says you own.
  Do NOT read docs/PARITY-FINDINGS.md whole (1.4 MB). Do NOT read a prototype HTML whole.

BUILD
  1. Add the OLIVE family and re-point the chrome at it. The prototype's primary hue is olive,
     not gold: --olive #6B8454, --olive-dk #4A5E3A, --olive-lt #EBF0E4, --olive-md #8FA67A. The
     application has no olive token and paints every one of those states amber. Re-point the top
     bar, sidebar active state, primary button, progress fills, selected-tile outline and tab
     underline; gold stays for the logo and sparse accents. Add dark-mode counterparts.
  2. Close the other 22 token gaps `npm run parity:tokens` lists — the drifted values
     (--navy → #1A1E2E, --offwht → #F7F6F2, --text-3 → #9A9488, --stone-dk → #D4D0C8) and the
     tokens with no counterpart at all (--gold-dk, --stone, --text-2, the four *-lt tints,
     --purple, --ink). Read each EXPECTED_GAPS reason in scripts/parity-tokens.ts before you
     move a value — two carry warnings. In particular --green: the app's #4a6644 is close to the
     olive family, so check you are not looking at an olive/green conflation before repointing it
     at the prototype's #16A34A.
  3. Move to the prototype's 9–13.5 px density, with a fixed-height shell and independently
     scrolling panes.
  4. Add the `.tb` surface-toolbar primitive that replaces the in-flow `h1` on every screen, plus
     sidebar item badges/counts and section dividers.
  5. Add the toast primitive — the prototype has 36 `showToast` call sites.
  6. Fix the branding-wipe defect (§1.5): `BrandingSection.save()` in
     src/client/routes/ConfigPage.tsx:402 posts only {wordmark, tagline, accent} while
     PUT /api/config/branding replaces branding_json wholesale, silently wiping orgName/orgType.
     SetupWizard.tsx:106-114 already re-reads and merges — do the same here. Client-side only:
     the server route is not yours.

CONSTRAINTS
  - Own only: src/client/index.css, src/client/components/**, src/client/theme/**,
    src/client/routes/ConfigPage.tsx (the branding save fix ONLY). src/client/index.css is a
    serialisation hazard and you are its sole owner this wave. Need something else changed?
    Record it in §9; do not edit it.
  - Do not touch src/shared/nav.ts (W3-A owns it) or src/server/** (nobody this wave).
  - If a screen's markup must change to adopt `.tb`, and that file is not yours, add the
    primitive and record the adoption as a cross-session request — the screen sessions
    (Waves 7–9) apply it.

TEST
  - `npm run parity:tokens` must reach 27/27. Delete each EXPECTED_GAPS entry as you close it —
    the check FAILS on a gap that passes while still listed. When the map is empty, `--strict`
    and the default run are the same thing.
  - Client tests for the toolbar and the toast primitives, covering the states the prototype
    draws (a toast appears, auto-dismisses, and stacks).
  - A worker test proving a branding save preserves orgName. (Read-only on the route; assert
    through the API.)
  - `e2e/parity.spec.ts`: chrome changes must not move any page title or table header. If one
    moves deliberately, re-capture that row and say why in your handoff.
  Green gate: npm run typecheck && npm run lint && npm test && npm run build
  Plus: npm run test:e2e (let Playwright start its own server — see §2.3) and
        npm run parity:tokens

FINISH
  Complete the §2.4 exit checklist: update §7 Progress, §8 Open questions and §9 Cross-session
  requests in docs/plan_parity.md, then write the next prompt(s) into §10 using the §5 template.
  Commit to parity/W1-A. Do not merge to main.
```

### `W1-B` — schema

```
You are running session W1-B — every migration the programme needs — of the ai.STARTUPJURY parity
programme. You have no prior context. Everything you need is in the repo.

SETUP
  cd /Users/jayanthkomarraju/Documents/GitHub/startup-jury && nvm use
  git worktree add ../sj-W1-B -b parity/W1-B main
  cd ../sj-W1-B && npm ci
  python3 docs/prototype/tools/split-prototypes.py

READ FIRST (in this order, and nothing else)
  1. docs/plan_parity.md — §1 Ground rules (§1.2 and §1.3 both bind you), §2 Session protocol,
     §4 Testing, then ONLY your entry for W1-B in §6.
  2. The written specs are your primary source, not the prototypes:
     docs/prototype/source/specs/incubator.html and vc.html — §6.2 (role parameters) and §12
     (sign-up, agreements, signatures). §1.1: where seed data disagrees with these, these win.
  3. For the defaults each table seeds, the admin console sections, from
     ${TMPDIR:-/tmp}/sj-prototype-split/AISJ_IC_SuserV15/admin/ and
     .../AISJ_VC_Superuser_V8/admin/ — read the s-*.html for the areas you are modelling, not
     the whole _ADMIN-CONSOLE.html.
  4. migrations/, src/server/db.ts, src/shared/types.ts.
  Do NOT read docs/PARITY-FINDINGS.md whole (1.4 MB). Do NOT read a prototype HTML whole.

BUILD
  One numbered block of migrations creating everything Waves 2–6 need, with NO UI and NO routes:
  1. Org scoring settings — the ~15 Scoring-framework controls.
  2. Per-area rubric anchors across five bands, plus a per-area AI guidance prompt.
  3. A question bank: 13 areas × 5 questions, Climate Impact 8.
  4. role_permissions(edition, role, task_id, granted), seeded to reproduce TODAY'S matrix
     exactly — W3-A depends on `npm run roles` staying 526/526 when it reads this table.
  5. A real audit_log with a NULLABLE deck_id and a category, so config/team/billing events are
     storable, not just deck events.
  6. Notification preferences per event × channel × recipient.
  7. A credit ledger and price configuration.
  8. signups, signup_documents, agreements, signatures — per spec §12.
  9. Seat capacity on cohorts, and the `seatless` flag.
 10. CRM connection settings.
 11. Correct the nine role-parameter names to the spec §6.2 canonical set.

CONSTRAINTS
  - Own only: migrations/** (yours for the WHOLE programme), src/server/db.ts,
    src/shared/types.ts. Ship types and seeds only — no routes, no UI. Those belong to the
    sessions that own them.
  - Number your migrations in one contiguous block above anything already in the tree, and state
    the range loudly in your handoff. A colliding migration number is the one merge conflict that
    is genuinely painful.
  - §1.2 binds the schema: store NO password reveal field (PBKDF2 hashes only, reset-only flow),
    and NO card number / CVV columns anywhere — payment goes through a provider-hosted surface.
    Omit any "mentor adjusts composite" flag; `mentor` is a directory record with no pipeline
    authority (commit 8822db2).
  - §1.3: payments, e-signature and CRM are interface-complete, provider-stubbed. Model the
    tables; add no vendor SDK and no credential.

TEST
  - A worker test per table: it exists, its constraints reject a bad row, and its seed matches
    the prototype default.
  - Migrations apply cleanly to a fresh local D1 AND are idempotent on re-run — prove both.
  - `npm run roles` stays 526/526 with the seeded role_permissions (start `npm run e2e:serve` on
    a port unique to this session and pass ROLES_BASE — a bare `npm run roles` exits 0 with no
    server and is a false pass; §2.3).
  Green gate: npm run typecheck && npm run lint && npm test && npm run build

FINISH
  Complete the §2.4 exit checklist: update §7 Progress, §8 Open questions and §9 Cross-session
  requests in docs/plan_parity.md, then write the next prompt(s) into §10 using the §5 template.
  Commit to parity/W1-B. Do not merge to main.
```

### `W1-C` — admin console shell

```
You are running session W1-C — the admin console shell — of the ai.STARTUPJURY parity programme.
You have no prior context. Everything you need is in the repo.

SETUP
  cd /Users/jayanthkomarraju/Documents/GitHub/startup-jury && nvm use
  git worktree add ../sj-W1-C -b parity/W1-C main
  cd ../sj-W1-C && npm ci
  python3 docs/prototype/tools/split-prototypes.py

READ FIRST (in this order, and nothing else)
  1. docs/plan_parity.md — §1 Ground rules, §2 Session protocol, §3 Prototypes (read the callout
     about openAdmin() and ADMIN_B64 — it is why this console does not exist yet), §4 Testing,
     then ONLY your entry for W1-C in §6.
  2. Your worklist:
     python3 docs/prototype/tools/findings.py --area "Admin console" \
       --screen "shell|chrome|whole|title.bar|overlay|nav|section" --full
  3. ${TMPDIR:-/tmp}/sj-prototype-split/AISJ_IC_SuserV15/_ADMIN-CONSOLE.html for the shell —
     the header, the section rail and the title bar. Do NOT read the 16 admin/s-*.html section
     bodies; they belong to Waves 2–5. Cross-check AISJ_VC_Superuser_V8/_ADMIN-CONSOLE.html,
     which also carries 16 sections.
  4. src/client/App.tsx (the `admin` branch only) and the existing user-CRUD page.
  Do NOT read docs/PARITY-FINDINGS.md whole (1.4 MB). Do NOT read a prototype HTML whole.

BUILD
  1. The full-screen overlay: a 46 px header, Escape closes it.
  2. The 210 px olive section rail — four groups (Evaluation · Organisation · Sign-up · System)
     and all 16 items.
  3. The section title bar: the program/cohort context chip and the global Save changes button.
  4. The pending-invite badge.
  5. The off-canvas drawer below 760 px.
  6. Every section renders a placeholder that NAMES what will fill it, so Waves 2–5 have a slot
     to land in. Keep the existing user-CRUD page reachable as the Team & roles placeholder until
     W4-A replaces it.
  7. The Sign-up group is visible to admin/superuser only.

CONSTRAINTS
  - Own only: src/client/routes/admin/** (new) and the `admin` branch of src/client/App.tsx.
    App.tsx is a serialisation hazard and you are its sole owner this wave — touch only the admin
    branch. Need something else changed? Record it in §9; do not edit it.
  - Do NOT touch src/shared/nav.ts (W3-A owns it) or src/client/index.css (W1-A owns it). If you
    need an olive token, W1-A is adding the family this wave — coordinate through §9 rather than
    declaring your own.
  - Do NOT build a read-only console for non-admin roles. The 12-section payload inside the seven
    non-admin prototypes is dead code carrying a stale role taxonomy; only the Admin and Super
    User sidebars call openAdmin().
  - §1.2: the User access section must never display a stored password. Reset only — issue a
    temporary credential and force a change at next sign-in. If your placeholder names the
    section, name it that way.

TEST
  - E2E: an admin walks all 16 sections; a non-admin cannot reach the console at all; the Sign-up
    group is absent for the non-admin roles that could otherwise reach it (test the negative, §4).
  - `npm run roles` green at 526/526 — start `npm run e2e:serve` on a port unique to this session
    and pass ROLES_BASE. A bare `npm run roles` exits 0 with no server and is a false pass (§2.3).
  - `npm run parity:nav` stays green. The `admin` slug already resolves for admin and superuser in
    both editions, so it should not move; if it does, you changed reachability and must say so.
  - `e2e/parity.spec.ts` records `/app/admin` as titled "Admin console" with the current
    user-CRUD table. If your shell changes either, re-capture those four rows
    (`PARITY_CAPTURE=1 npx playwright test e2e/parity.spec.ts`) and union them in — see §2.5.
  Green gate: npm run typecheck && npm run lint && npm test && npm run build
  Plus: npm run test:e2e · npm run roles · npm run parity:nav

FINISH
  Complete the §2.4 exit checklist: update §7 Progress, §8 Open questions and §9 Cross-session
  requests in docs/plan_parity.md, then write the next prompt(s) into §10 using the §5 template.
  Commit to parity/W1-C. Do not merge to main.
```

---

### Wave 2 — written by `W1-B` (the schema these three consume)

> These three branch from `main` **after Wave 1 integration**, not from `parity/W1-B`. They are the
> direct consumers of migrations `0025`–`0037`; `W1-B` wrote them because it knows what those tables
> hold. If `W1-A` or `W1-C` also drafted Wave 2 prompts, the integration session keeps one copy.
>
> All three share one rule: **the schema already exists and is seeded** — `W1-B` shipped
> `0025`–`0037` for exactly this wave, so reach for a migration only if something is genuinely
> missing. Each of you is allotted **one migration number** so you cannot collide: `W2-A` → `0038`
> (which it must write — see the §9 fix-ups in its prompt), `W2-B` → `0039`, `W2-C` → `0040`.

> **Server-route ownership for this wave — read before you write a handler.** All three Wave 2
> drafts originally claimed `src/server/routes/config.ts`. Three sessions cannot own one file; that
> is the collision §2.2 exists to prevent, and in application code it is far more expensive to
> unpick than in this document. Arbitrated at Wave 1 integration:
>
> | Session | Server routes live in | Mount |
> |---|---|---|
> | `W2-A` | `src/server/routes/config.ts` *(sole owner this wave)* | already mounted at `/api/config` |
> | `W2-B` | **new** `src/server/routes/anchors.ts` | add `app.route("/api/anchors", anchors)` |
> | `W2-C` | **new** `src/server/routes/questions.ts` | add `app.route("/api/questions", questions)` |
>
> `src/server/index.ts` is the one shared file: `W2-B` and `W2-C` each add **one import and one
> `app.route(...)` line**, and nothing else, so the two appends land in different places and merge
> cleanly. Declare the line you added in §9 so integration can verify it. If you find yourself
> wanting a second line in `index.ts`, stop and record it instead.

### `W2-A` — scoring framework & area weights

```
You are running session W2-A — the Scoring framework and Area weights admin sections — of the
ai.STARTUPJURY parity programme. You have no prior context. Everything you need is in the repo.

SETUP
  nvm use
  git worktree add ../sj-W2-A -b parity/W2-A main
  cd ../sj-W2-A && npm ci
  python3 docs/prototype/tools/split-prototypes.py

READ FIRST (in this order, and nothing else)
  1. docs/plan_parity.md — §1 Ground rules (§1.2 binds you), §2 Session protocol, §4 Testing,
     then ONLY your entry for W2-A in §6, and §7 row `W1-B` for what the schema already holds.
  2. Your worklist:
       python3 docs/prototype/tools/findings.py --area "Admin console" \
         --screen "s-fw|s-wt|Scoring framework|Area weights" --full
  3. ${TMPDIR:-/tmp}/sj-prototype-split/AISJ_IC_SuserV15/admin/s-fw.html and s-wt.html, and
     `updWt` / `permitTog` in that directory's _scripts.js. The VC build's s-fw is byte-identical.
  4. migrations/0026_org_scoring_settings.sql and the `OrgScoringSettingsRow` /
     `ScoreScale` / `CompositeFormula` / `AI_WEIGHT_CHOICES` exports in src/shared/types.ts.
  Do NOT read docs/PARITY-FINDINGS.md whole (1.4 MB). Do NOT read a prototype HTML whole.

BUILD
  The schema is done and seeded — `org_scoring_settings` holds one row per edition at the
  prototype's exact defaults. Your job is the UI, the API and, above all, the BEHAVIOUR:
  1. The five AI-engine toggles and the four transparency toggles, each actually honoured by the
     evaluation path. A toggle that renders but changes nothing is not closed.
       - ai_pre_scoring_enabled     — no AI pass at all when off
       - auto_clarification         — no auto-triggered query when off
       - show_ai_score_to_jury      — WITHHELD SERVER-SIDE, not hidden in CSS
       - require_override_rationale — enforce at `override_rationale_delta` (default 2.0)
       - jury_sees_peer_scores      — off by default; respect EVALUATION_RANK either way
       - show_three_score_view · show_score_drift · include_ai_evidence · intro_call_ai_prompts
  2. Score composition: `score_scale`, `composite_formula` and `ai_weight_pct` re-cut
     src/shared/scoring.ts. Not cosmetic — a median composite must actually compute a median.
  3. `shortlist_threshold` (org_scoring_settings) and the Best/Poor cohort bands
     (org_settings.threshold_best / .threshold_mediocre — they stay where they are).
  4. Area weights: bars, a live 100 % total, and the per-parameter *Permit configuration* control,
     which is `parameters.config_permitted` (seeded: parameter 1 of each owning role is permitted).
  5. **Migration 0038 — three fix-ups Wave 1 integration assigned you (see §9).** These are small,
     but the first one breaks a shipped feature today:
       a. `0025` rewrote all 18 AI scoring prompts and never bumped
          `org_settings.criteria_version`. The re-score guard (src/server/routes/decks.ts:918-949)
          therefore reads every seeded evaluation as current against a rubric that changed
          underneath it, and **re-score returns 409**. Bump it.
       b. `0025` left two duplicate `(edition, key)` parameter rows — `0007` created
          `add_program_fit` / `add_thesis_fit` and `0025` renamed two different rows onto the same
          keys. Latent, not live (the `0007` pair is `active = 0` and nothing looks a parameter up
          by key), but delete the retired rows and add
          `CREATE UNIQUE INDEX … ON parameters(edition, key) WHERE active = 1` so it cannot recur.
       c. Twelve of eighteen seeded AI comments in `0014` still describe the pre-`0025` parameters,
          so the demo explains "Founder Resilience & Coachability" under a heading that now reads
          "Barriers of entry". Re-seed them.

CONSTRAINTS
  - Own only: src/client/routes/admin/ScoringFramework.tsx, AreaWeights.tsx,
    src/server/routes/config.ts, src/shared/scoring.ts. You are the sole owner of config.ts this
    wave (see the ownership note above).
  - §1.2: OMIT "Mentor can adjust composite after all jury complete". The column does not exist
    and must not be added — `mentor` has no pipeline authority (commit 8822db2).
  - Do not touch src/shared/analytics.ts — the four-vs-five band defect is W2-B's.
  - You own migration **0038** (and only 0038). W2-B is reserved 0039, W2-C 0040, so the three of
    you cannot collide. Do not touch any existing migration file.

TEST
  - Unit: each composite formula and each score scale, including the 0 % AI (jury-only) split.
  - Worker: the AI path reads the settings; authZ (admin/superuser allowed, a non-admin 403s).
  - E2E: blind scoring genuinely withholds the AI score — assert the API response, not the DOM.
  Green gate: npm run typecheck && npm run lint && npm test && npm run build && npm run test:e2e
  Plus `npm run roles` (start `npm run e2e:serve` on a port unique to this session and pass
  ROLES_BASE — a bare `npm run roles` exits 0 with no server and is a false pass; §2.3).

FINISH
  Complete the §2.4 exit checklist: update §7 Progress, §8 Open questions and §9 Cross-session
  requests in docs/plan_parity.md, then write the next prompt(s) into §10 using the §5 template.
  Commit to parity/W2-A. Do not merge to main.
```

### `W2-B` — rubric anchors

```
You are running session W2-B — the Rubric anchors admin section, and the four-vs-five band defect —
of the ai.STARTUPJURY parity programme. You have no prior context. Everything you need is in the repo.

SETUP
  cd /Users/jayanthkomarraju/Documents/GitHub/startup-jury && nvm use
  git worktree add ../sj-W2-B -b parity/W2-B main
  cd ../sj-W2-B && npm ci
  python3 docs/prototype/tools/split-prototypes.py

READ FIRST (in this order, and nothing else)
  1. docs/plan_parity.md — §1 Ground rules, §1.5 (your defect), §2, §4, then ONLY your entry for
     W2-B in §6, plus §8 Q10 and the §9 row addressed to you.
  2. Your worklist:
       python3 docs/prototype/tools/findings.py --area "Admin console" --screen "rubric|s-rb" --full
  3. The specs' §7 "Scoring & Aggregation" band mapping in
     docs/prototype/source/specs/incubator.html — it is the authority over both prototypes.
  4. migrations/0027_rubric_anchors.sql and the `RUBRIC_BANDS` / `ParameterRubricBandRow` exports
     in src/shared/types.ts.
  Do NOT read docs/PARITY-FINDINGS.md whole (1.4 MB). Do NOT read a prototype HTML whole.

BUILD
  The schema is done and seeded: `parameter_rubric_bands` holds five rows for EVERY active
  parameter in both editions — 65 anchor strings per edition already written from the prototype's
  RUBRICS literal, and the nine role parameters scaffolded with NULL text. `parameters.prompt` now
  carries the per-area AI guidance prompt for all 13 core areas as well as the nine role ones.
  1. The section: an area picker (13 core + 9 role parameters — NOT the prototype's stale P1/P2/P3
     trio, see §8 Q10), the AI guidance prompt textarea, five band textareas, Save and Revert.
  2. **Reconcile the bands.** src/shared/analytics.ts:181-187 uses five bands, src/shared/scoring.ts
     :21-26 uses four, and `src/server/ai/evaluate.ts:562` + `src/server/routes/pipeline.ts:948`
     still read the global four-band `rubric_anchors` table from 0001. Drive all of it onto the
     spec's five bands, which `parameter_rubric_bands.band_name` already carries (Exceptional ·
     Strong · Moderate · Weak · Insufficient, band_index 0…4). One source, one set of labels.

CONSTRAINTS
  - Own only: src/client/routes/admin/RubricAnchors.tsx, a NEW module
    src/server/routes/anchors.ts (see the ownership note above — W2-A owns config.ts),
    src/shared/analytics.ts (band constant only), and — for the
    reconciliation, agreed in §9 — the anchor reads in src/server/ai/evaluate.ts and
    src/server/routes/pipeline.ts.
  - Do not touch src/shared/scoring.ts's composite maths; that is W2-A's. Coordinate on the band
    constant only, and say in your handoff which of you moved it.
  - Add no migration unless you must; **0039 is reserved for you** (W2-A owns 0038, W2-C 0040).
    Dropping the legacy `rubric_anchors` table IS a migration — say so loudly in your handoff.

TEST
  - Unit: one band table drives both scoring and analytics — the same score gets the same label
    from both, which is the defect.
  - Worker: save, revert and authZ (a non-admin 403s), and an anchor edit surviving a round trip.
  - Client: the picker renders 22 parameters per edition, and a scaffolded role parameter shows
    five empty bands rather than nothing.
  Green gate: npm run typecheck && npm run lint && npm test && npm run build && npm run test:e2e

FINISH
  Complete the §2.4 exit checklist: update §7 Progress, §8 Open questions and §9 Cross-session
  requests in docs/plan_parity.md, then write the next prompt(s) into §10 using the §5 template.
  Commit to parity/W2-B. Do not merge to main.
```

### `W2-C` — question bank

```
You are running session W2-C — the clarification question bank — of the ai.STARTUPJURY parity
programme. You have no prior context. Everything you need is in the repo.

SETUP
  cd /Users/jayanthkomarraju/Documents/GitHub/startup-jury && nvm use
  git worktree add ../sj-W2-C -b parity/W2-C main
  cd ../sj-W2-C && npm ci
  python3 docs/prototype/tools/split-prototypes.py

READ FIRST (in this order, and nothing else)
  1. docs/plan_parity.md — §1 Ground rules, §2 Session protocol, §4 Testing, then ONLY your entry
     for W2-C in §6.
  2. Your worklist:
       python3 docs/prototype/tools/findings.py --area "Admin console" --screen "question|s-qb" --full
  3. ${TMPDIR:-/tmp}/sj-prototype-split/AISJ_IC_SuserV15/admin/s-qb.html — the accordion's shape.
     The question TEXT is already in the database; you do not need to transcribe it.
  4. migrations/0028_question_bank.sql, src/shared/queries.ts, and the `QuestionBankRow` export in
     src/shared/types.ts.
  Do NOT read docs/PARITY-FINDINGS.md whole (1.4 MB). Do NOT read a prototype HTML whole.

BUILD
  The schema is done and seeded: `question_bank` holds 68 questions per edition, keyed to
  `parameters.id` — five per area, eight for Climate Impact & Integrity, in the prototype's own
  words and order.
  1. The per-area accordion with the question count chip, and add / edit / delete / reorder.
     Reorder writes `seq`; delete is a soft `active = 0` so a query already sent still reads back.
  2. **Wire the bank into clarification generation.** src/shared/queries.ts today emits a bullet
     list of area LABELS; a triggered query must draw the real questions for the weak-signal areas.
     Respect `org_scoring_settings.auto_clarification` (W2-A owns that toggle's UI; you own the
     producer honouring it — if it is not merged yet, read the column directly).

CONSTRAINTS
  - Own only: src/client/routes/admin/QuestionBank.tsx, src/shared/queries.ts, and a NEW module
    src/server/routes/questions.ts (see the ownership note above — W2-A owns config.ts).
  - Add no migration unless you must; **0040 is reserved for you** (W2-A owns 0038, W2-B 0039).

TEST
  - Unit: a weak-signal area selects that area's questions, in `seq` order, skipping inactive ones;
    Climate Impact returns eight.
  - Worker: add / edit / delete / reorder, plus authZ (a non-admin 403s).
  - E2E: an admin edits a question and the edited text appears in a generated query.
  Green gate: npm run typecheck && npm run lint && npm test && npm run build && npm run test:e2e

FINISH
  Complete the §2.4 exit checklist: update §7 Progress, §8 Open questions and §9 Cross-session
  requests in docs/plan_parity.md, then write the next prompt(s) into §10 using the §5 template.
  Commit to parity/W2-C. Do not merge to main.
```

### Wave 3 — `W3-A` written by `W2-A`

> **Who writes which Wave 3 prompt.** Wave 1 lost time to two sessions independently drafting the
> same wave's prompts and the union leaving a headless fragment (§7). To avoid the repeat: **`W2-A`
> writes `W3-A` only** — the permissions engine is the session that inherits W2-A's open questions
> (Q6 on the default editor set, Q16 on console reachability) and the `config_permitted` grant it
> shipped. `W2-B` should write `W3-B` and `W3-C`; `W2-C` should write `W3-D`. If two copies of a
> prompt still turn up, integration keeps one.
>
> All four branch from `main` **after Wave 2 integration**. Migration numbers `0038`–`0040` are spent
> (`W2-A`/`W2-B`/`W2-C`); Wave 3 starts at `0041`, one number per session, allotted in each prompt.

### `W3-A` — runtime permission engine

```
You are running session W3-A — the runtime permission engine — of the ai.STARTUPJURY parity
programme. You have no prior context. Everything you need is in the repo.

This is the single highest-risk session in the programme: you own the four files every other
session has been told not to touch, and `npm run roles` (526 checks) is the contract you must not
break. Nothing else in Wave 3 goes near them.

SETUP
  nvm use
  git worktree add ../sj-W3-A -b parity/W3-A main
  cd ../sj-W3-A && npm ci
  python3 docs/prototype/tools/split-prototypes.py

READ FIRST (in this order, and nothing else)
  1. docs/plan_parity.md — §1 Ground rules, §2 Session protocol (§2.3 twice: the roles harness is
     the one check that lies when it is run wrong), §4 Testing, then ONLY your entry for W3-A in
     §6, and §8 questions Q4, Q5, Q6, Q7, Q8, Q9 and Q16 — seven of the plan's open questions are
     yours to settle.
  2. Your worklist:
       python3 docs/prototype/tools/findings.py --area "Roles" --sev P0,P1 --full
       python3 docs/prototype/tools/findings.py --area "Admin console" --screen "permission" --full
  3. migrations/0029_role_permissions.sql and the `PERMISSION_TASKS` / `RolePermissionRow`
     exports in src/shared/types.ts — the seeded matrix you are making live.
  4. The files you own, and scripts/role-matrix.ts's PROBES list, which is what 526 means.
  Do NOT read docs/PARITY-FINDINGS.md whole (1.4 MB). Do NOT read a prototype HTML whole.

BUILD
  The table is seeded and the vocabulary exists; what is missing is that nothing reads it. Roles are
  compile-time literals in ~40 `requireRole(...)` call sites and in `nav.ts`.
  1. A `can(edition, role, task)` helper over `role_permissions`, resolved once per request and
     carried on the session, with `GET`/`PUT /api/permissions` behind it.
  2. Re-point `nav.ts` and every `requireRole` call site at it. §8 Q8 is binding: a permission is a
     GATE, not a grant — AND it with the existing rule (pipeline transition role lists, stage
     gating, `requireRole`) rather than replacing it, or the default seed stops reproducing today's
     matrix and 526/526 goes red for the wrong reason.
  3. The six tasks the prototype names and the product lacks: Out of office delegation, Remind,
     Reassign / Resubmit, Activate / Deactivate / Delete user, Access to admin console, Permit to
     add team members.
  4. Settle Q4, Q5 and Q6 — the sidebar items the prototypes show to roles the app withholds them
     from (Collaborate, Sign up Pipeline / Onboard ready for the PM, Core Parameters / Set up).
     §1.4 gives the Program Manager decision authority, which points at Q5 being a real gap.
  5. Q16 is the one that bites two other sessions: **does every internal role get an Admin console
     entry, and is the non-admin console read-only?** `W1-C` built `canSeeAdminGroup()` so the
     Sign-up group can be withheld independently of console reachability, and `W2-A` already
     serves `GET /api/config/scoring` to any authed non-founder with an `editable` flag and renders
     its section read-only when it is false — so widening reachability is a permission decision,
     not a rebuild. Decide it, or record the client's answer.
  6. `parameters.config_permitted` is live: `W2-A` made `PUT /api/config/additional-params/:id`
     accept the OWNING role for a permitted row while `PUT /api/config/parameters` stayed
     admin-only (which is what kept 526/526). Q6 / F0080 — whether Program Managers and Partners
     are default config editors — is yours; if you widen it, the probe `config.params` in
     role-matrix.ts moves and you must say so.

CONSTRAINTS
  - Own only: src/shared/nav.ts, src/shared/roles.ts, src/server/auth/middleware.ts,
    src/client/routes/guards.tsx, scripts/role-matrix.ts, plus the ~40 `requireRole` call sites you
    must re-point (name every file you touched in your handoff — this is the one session whose
    ownership cannot be a disjoint path list).
  - You own migration 0041 and only 0041.
  - §1.2 stands: `mentor` gains nothing. `denyMentor` must survive the refactor intact.
  - Do not weaken `npm run roles` to make a change pass (§4). If a probe's `allow` list is genuinely
    wrong, change it in the same commit and say which finding says so.

TEST
  - Roles: 526/526 with the default seed, BEFORE and AFTER the refactor. Run it against your own
    server on a port you have proved you own (§2.3) — a bare `npm run roles` exits 0 with no server
    and a neighbour's server is the same false pass wearing a better disguise.
  - Unit: `can()` over the seeded matrix, including the AND-with-existing-rule case from Q8.
  - Worker: flipping ONE permission changes exactly one capability and nothing else; a 403 path for
    every newly gated route.
  - E2E: a role that loses a permission stops seeing its nav item and gets 403 on the route.
  Green gate: npm run typecheck && npm run lint && npm test && npm run build && npm run test:e2e
  Plus `npm run roles` and `npm run parity:nav` — you are the session most likely to move the
  nav baseline, and if you close one of its 70 known gaps you must delete that EXPECTED_GAPS entry
  in the same commit (§2.5).

FINISH
  Complete the §2.4 exit checklist: update §7 Progress, §8 Open questions (settle or re-state Q4,
  Q5, Q6, Q8, Q9, Q16) and §9 Cross-session requests in docs/plan_parity.md, then write the next
  prompt(s) into §10 using the §5 template. Commit to parity/W3-A. Do not merge to main.
```

---

## 11. Reference

| What | Where |
|---|---|
| The findings, human-readable | `docs/PARITY-FINDINGS.md` — 1.4 MB, **query it, don't read it** |
| The findings, machine-readable | `docs/PARITY-FINDINGS.json` |
| Query tool | `docs/prototype/tools/findings.py` |
| Prototype splitter | `docs/prototype/tools/split-prototypes.py` |
| Prototype sources (11 roles) | `docs/prototype/source/{incubator,vc}/` |
| Written product specs | `docs/prototype/source/specs/{incubator,vc}.html` |
| Extracted build spec (709 requirements) | `docs/PARITY-BUILD-SPEC.md` |
| How the sources fit together | `docs/prototype/README-sources.md` |
| Parity harness — nav | `scripts/parity-nav.ts` · `npm run parity:nav` (§2.5) |
| Parity harness — tokens | `scripts/parity-tokens.ts` · `npm run parity:tokens` (§2.5) |
| Parity harness — screen walk | `e2e/parity.spec.ts` · titles + table headers, 243 screens |
| Architecture & workflow | `HANDOFF.md` |
| The previous finish track | `docs/FINISH-PLAN.md` (§8 meeting decisions stay authoritative) |
| The tester's closed issue log | `docs/issue-log-2026-08.csv` |
| Live prototypes | `aisj-incubator-v2.netlify.app` · `aisj-venturecapitalv2.netlify.app` |
