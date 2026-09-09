# plan_parity.md — the parity & production-readiness programme

**Goal.** Close all **1,107 audited parity findings** between the ai.STARTUPJURY prototypes and this
application, and leave the product **launch-ready**.

**Shape.** ~61 sessions in **15 waves**. Sessions inside a wave run **in parallel**, each in its own git
worktree. Every wave ends with a short **integration session** that merges the wave, re-runs the full
green gate on the merged result, and writes the next wave's prompts.

**Status:** pre-flight done, Wave 0 ready to start. Baseline `main` @ `89e5125`.

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
- **`migrations/` is owned by `W1-B` for the whole programme.** Every table the plan needs is created
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

Baselines, measured on `main` @ `5592a4d` (2026-09-09): **typecheck clean · lint clean ·
453 passed / 1 skipped · build clean**. E2E and roles are W0's to establish — expect **72 e2e** and
**roles 526/526** from the previous track. If your change moves a count, the new count is the
baseline — record it in §7. A red gate is never "someone else's problem": if you broke it, fix it; if
you inherited it, say so in your handoff and stop.

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
| `W0` | not started | — | to establish: e2e (expect 72) · roles (expect 526/526) | |

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

---

## 9. Cross-session requests

When you need a change in a file you do not own, write it here instead of making it. The integration
session places it.

| From | File needed | Change | Placed by |
|---|---|---|---|

---

## 10. Next prompts

The prompts to paste into the next wave's sessions. Each session appends here; each integration
session replaces this list with the following wave's.

> **Wave 0 is a single session. Its prompt is below.**

```
You are running session W0 — baseline, guardrails and the parity test harness — of the
ai.STARTUPJURY parity programme. You have no prior context. Everything you need is in the repo.

SETUP
  cd /Users/jayanthkomarraju/Documents/GitHub/startup-jury && nvm use
  git worktree add ../sj-W0 -b parity/W0 main
  cd ../sj-W0 && npm ci
  python3 docs/prototype/tools/split-prototypes.py

READ FIRST (in this order, and nothing else)
  1. docs/plan_parity.md — §1 Ground rules, §2 Session protocol, §3 Prototypes, §4 Testing,
     §5 Prompt template, and ONLY the Wave 0 entry in §6.
  2. HANDOFF.md — the Status block and the workflow section. Skim, do not read whole.
  Do NOT read docs/PARITY-FINDINGS.md whole (1.4 MB). Do NOT read a prototype HTML whole.

BUILD
  1. Establish the rest of the baseline and record the REAL counts in §7 of the plan.
     Pre-flight already measured these on main @ 89e5125 — re-confirm, do not re-investigate:
       typecheck clean · lint clean · 453 passed / 1 skipped · build clean
     What is NOT yet measured, and is yours:
       npm run test:e2e                      # expect 72 from the previous track
       npm run e2e:serve   (in THIS worktree, own port) then
       ROLES_BASE=http://localhost:<port> npm run roles      # expect 526/526
     `npm run roles` is a runtime probe that exits 0 EVEN WHEN IT CANNOT CONNECT — it only
     prints "runtime probe could not reach ...". Confirm you actually got 526/526; a bare
     `npm run roles` with no server is a false pass. `e2e:serve` starts with
     `rm -rf .wrangler/state`, so never run it outside your own worktree.
     If e2e or roles is red, STOP and report. Do not start a programme on a red baseline.
  2. Add `npm run parity:nav` (scripts/parity-nav.ts): for all 11 prototype _sidebar.html files
     under ${TMPDIR:-/tmp}/sj-prototype-split, assert every sidebar item maps to a route that
     role can reach, comparing against navForUser() in src/shared/nav.ts. It WILL fail today —
     commit it with the current failures listed as expected, so later sessions un-skip their part.
  3. Add `npm run parity:tokens` (scripts/parity-tokens.ts): assert the CSS custom properties in
     src/client/index.css match the prototype :root block for the tokens the prototype actually
     uses. Same expected-failure treatment. Note the prototype's primary family is OLIVE
     (--olive #6B8454, --olive-dk #4A5E3A, --olive-lt #EBF0E4, --olive-md #8FA67A); the app has
     no olive token and paints those states amber.
  4. Add e2e/parity.spec.ts: a per-role walk that visits every nav item and asserts the page
     title and the table header set. Seed it with what passes today.
  5. Confirm docs/prototype/tools/split-prototypes.py and findings.py both run clean from this
     fresh worktree.

CONSTRAINTS
  - Own only: scripts/, e2e/parity.spec.ts, package.json (scripts block), docs/plan_parity.md.
  - eslint.config.js already ignores .claude/worktrees/** — pre-flight fixed 318 lint errors
    coming from a stale nested worktree. Do not undo it.
  - Change no application code. This session builds measurement, not fixes.
  - The three harness commands must fail loudly when pointed at something wrong — prove it by
    temporarily breaking a token and showing parity:tokens catches it.

TEST
  The harness itself is the deliverable; it must be green with documented, enumerated skips.
  Green gate: npm run typecheck && npm run lint && npm test && npm run build

FINISH
  Complete the §2.4 exit checklist. Record the real baseline counts in §7. Then write the three
  Wave 1 prompts (W1-A design system, W1-B schema, W1-C admin console shell) into §10 using the
  §5 template, each branching from main. Commit to parity/W0. Do not merge to main.
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
| Architecture & workflow | `HANDOFF.md` |
| The previous finish track | `docs/FINISH-PLAN.md` (§8 meeting decisions stay authoritative) |
| The tester's closed issue log | `docs/issue-log-2026-08.csv` |
| Live prototypes | `aisj-incubator-v2.netlify.app` · `aisj-venturecapitalv2.netlify.app` |
