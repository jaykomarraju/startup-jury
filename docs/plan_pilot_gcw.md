# Pilot productionisation — Global Carbon Warriors

> Written 2026-10-05 for a conference demo on 2026-10-06, against `main@ff62f12`,
> production Worker `efe672d7-0d36-49a1-84a5-a174b7cce85f`, D1 at `0104`.
>
> Measured by eighteen agents across eight lanes: 114 findings, each adversarially
> re-checked against the cited code. 30 were claimed demo-blocking and 30
> pilot-blocking; the verify pass downgraded six and refuted one. Everything below
> carries a `file:line` or a command output. Where a fact could only come from
> production it says so.

---

## 0. The correction that changes this plan

**`t_default` is not a demo workspace. It is already Global Carbon Warriors' live
workspace.** A live authenticated read of production returned **23 real climate
decks uploaded 2026-10-01 → 10-03** under the **Climate Cohort** programme, plus two
real staff accounts (`chandrasekhar@`, `ravi@startupjury.ai`). That is the same data
the 1-Oct, 2-Oct and 3-Oct tester issues were about — BiocharIND, NatureMark and
UshaKiran are GCW's decks, not fixtures.

So the question "new organisation or rename `t_default`?" was asked on a wrong
premise, and the answer inverts:

| | What it actually costs |
|---|---|
| **Rebrand `t_default` as GCW** *(recommended)* | Zero data movement. GCW keeps their 23 decks, their rubric, their programme and their history. Costs: 13 demo accounts sit on their roster, and the workspace carries a demo audit tail. |
| **Create an empty `t_gcw`** | Orphans the 23 decks — they would have to be migrated across tenants by hand, on demo eve, with no staging environment and no tested provisioning script. |

Nothing in the test estate objects to a rebrand: `scripts/role-matrix.ts:534` pins
`TENANT_A = "t_default"` — the organisation **id**, which a rename does not touch —
and `grep -rn "ai.STARTUPJURY Demo Workspace|slug=.default." e2e/ test/ src/ scripts/`
returns nothing. Nobody references the slug or the display name.

**The multi-tenant work does not disappear; it changes from "stand GCW up" to "make a
second customer safe to add".** That is §6, and it is a week-one block, not a
demo-eve one. Tenancy itself already shipped and is live.

> If you still want a separate `t_gcw`, say so and I will add the cross-tenant data
> migration for the 23 decks as its own gated step. It is not something to attempt
> tonight.

---

## 1. What "production ready" means — the repo already answered

`docs/plan_parity.md:797-820` names two waves that have **never been started**, and
between them they list almost exactly what the eight lanes rediscovered
independently:

- **W13-A Security** — "rate limiting on auth and upload; **demo seed logins gated or
  removed**; a secrets audit; upload validation hardening; the PBKDF2 and
  session-cookie posture re-checked."
- **W13-B Resilience** — "error monitoring; a backup and restore path for D1 with a
  **rehearsed restore**; a migration rollback drill; queue and cron failure handling."
- **W13-C** — "the operations runbook — deploy, rollback, restore, rotate, on-call."
- **W10-A** — "**set / change password**, **forgot password with a real reset
  transport**" — the plan's own words: "this closes a live functional hole."

`grep -nE '^\| .W1[0-3]' docs/plan_parity.md` returns no ledger rows for W10–W13
while Waves 0–9 all have them. So the honest answer to "is it production ready" is:
**the platform works, the hardening wave was planned and skipped.** Stop
re-deriving the list — work it in its stated order.

---

## 2. Tonight, data only — no deploy, no code

There is **no staging environment**: `wrangler.jsonc` has no `env` block, one Worker,
one D1, one KV. Every code change lands directly on the URL GCW projects tomorrow.
So do the data fixes first — each is verifiable in the live UI and revertible the
same way.

**Ordered. What breaks if skipped is stated.**

1. **Capture a restore point and write it in the repo, not in a memory file.**
   ```bash
   npx wrangler d1 time-travel info startup-jury-db
   ```
   All three recorded bookmarks predate the current state — restoring any of them
   would undo migration `0104`, the 3-Oct fixes **and the 23 decks**. Note also that
   D1 time-travel is whole-database: a restore takes every tenant back with it.
   R2 has no recovery story at all.

2. **Top up the credit balance. This is the single highest-value action tonight.**
   Production `(t_default, incubator)` measured **`creditsBalance: 0`** via
   `GET /api/config/summary`. `src/server/routes/decks.ts:2393` reserves the credit
   *before* anything else, so at zero the money shot cannot run — the client doesn't
   even send the upload (`UploadPage.tsx:325` returns early, `ReviewScreen.tsx:243`
   renders "Not enough credits — this batch needs 1 credit and 0 remain").
   Fix: **Settings → Core Parameters → Plan & credits → set 50 → Save**
   (`POST /api/config/credits`, `config.ts:1306`, writes a ledger row).
   **Do not use the on-screen "Buy credits" link** — `billing/provider.ts:116` is
   `ADAPTERS = {}` and `account.ts` grants `creditsGranted: 0`, so it leads to a
   wizard that cannot take money.

3. **Rename the workspace. It currently carries another real company's name.**
   `migrations/0020_seed_demo_refresh.sql:732` wrote
   `branding_json = {"orgName":"Anthill Ventures Incubator"}` — a live Hyderabad
   accelerator — and `scripts/clear-deck-data.sql:16` lists `org_settings` under
   "deliberately not touched", so the 30-Sep clear left it. It renders in My Account →
   Workspace (`AccountPage.tsx:73-86`), on **every invoice** as `buyerName`
   (`billing/invoice.ts:478-485`), and in the invite and founder emails
   (`email/outbox.ts:627`, `:564`).
   Fix: **Admin console → System → Branding → Organisation name → "Global Carbon
   Warriors"** (`Branding.tsx:330-339`). Two minutes.

4. **Fix the two dropdowns on the money-shot screen.** `clear-deck-data.sql`
   deliberately spares `programs`, `cohorts` and `sectors`, and those programmes were
   derived from the demo decks (`0011_program_hierarchy.sql:59-68`). Production still
   holds **Fintech Accelerator** and **SaaS Accelerator** beside Climate Cohort, and
   the sector list is EdTech / FinTech / SaaS / B2B SaaS / Cybersecurity / Logistics.
   Both render on the Upload screen (`Wizard.tsx:388-400` groups the cohort dropdown
   by programme). A carbon accelerator has no Carbon Removal, MRV or Industrial
   Decarbonisation sector.
   Fix: Programmes → add GCW's sectors, retire the seeded ones; rename or retire the
   two foreign programmes. ~15 min. Note `src/shared/intake.ts:230-237` falls back to
   "the workspace's only sector" when exactly one exists, so get this right *before*
   the first upload.

5. **Invite GCW's real team so the Assign and jury pickers show real names.** Thirteen
   `@demo.startupjury.ai` accounts are active and appear in every picker
   (`pipeline.ts:1419`, `:1470`, `assignments.ts:209`, `calls.ts:649`). The invite
   path works without email: `users.ts:391` returns `tempPassword` when delivery
   didn't happen and `admin/TeamRoles.tsx:1111-1120` renders it with purpose-written
   copy. See the decision in §7 before deactivating anything.

6. **Identify the three decks that score 0.00 and keep the presenter away from them.**
   `evaluate.ts:722-737` documents the truncation bug it fixed ("UshaKiran Ecoplast
   scored 5.51 once and 0.00 twice"); three survivors still carry `ai: 0`. They render
   as ordinary **Incomplete / flagged** decks, and **no product lever repairs them**:
   `retry-ai` → 409 `not_pending` (`decks.ts:2476`), `rescore` → 409 `already_scored`
   (`decks.ts:2211`), and a weight change calls `rescoreEdition`, which recomputes from
   *stored* `scores` rows and never calls the model (`config/rescore.ts:62-70`). Only a
   new deck version or a D1 write unblocks them.

7. **Do one real upload end to end, against production, that actually scores.** This
   has not been done since the 30-Sep clear. It proves `ANTHROPIC_API_KEY` is set *and
   valid*, the balance, the queue, R2 and — most importantly — the **real latency**, in
   one shot. **Assert the response is `{"evaluated": true}`**: a `202
   evaluation_pending` is indistinguishable from a missing key without reading
   `reason`.

8. **Rehearse at the projector's resolution and the presenter's zoom level.** This is
   the finding nobody else looked for and it silently reconfigures the demo:
   `index.css:421` `@media (max-width: 899px)` hides **every sidebar label** and
   **every non-primary toolbar button**, and Tailwind's default `lg:` = 1024px collapses
   the Evaluation Report — Act 2's money shot — from two columns to one
   (`EvaluationDrawer.tsx:238`). Browser zoom scales the CSS-pixel viewport: 1280px at
   150% = **853 CSS px**, under both thresholds. Presenters zoom so the back row can
   read. The e2e suite drives a default-sized Chromium and covers none of this.
   Present at 100% on ≥1280px, or verify the narrow tier looks deliberate first.

9. **Open the deployed URL once in Safari and once on an iPhone.** `playwright.config.ts`
   has no `projects` array — all 229 e2e tests run one Chromium. `DeckPdfViewer.tsx:45-60`
   renders every page to a canvas and keeps it as `canvas.toDataURL("image/png")`;
   Safari's canvas-memory ceiling is the one plausible break. Ten minutes. Do **not**
   add a WebKit Playwright project tonight — the suite is already port-constrained at
   two workers.

---

## 3. Tonight, one scoped deploy

Client-only, no migration, revertible with `npx wrangler rollback`.

1. **Gate the demo-logins card.** `LoginPage.tsx:23-36` lists 12 addresses and `:110`
   renders "Demo logins · password demo1234". **Confirmed in the live production
   bundle**: `index-XffRqztI.js` contains all 12 `@demo.startupjury.ai` addresses and
   the literal password string. All 12 share one hash from
   `migrations/0002_seed.sql:45-56`, re-derived and byte-matched against `demo1234`.
   Fix: wrap the second `<Card>` at `LoginPage.tsx:107-128` in
   `{import.meta.env.DEV && ( … )}`. Measured: vitest runs with `DEV === true`, so
   `test/client/loginDemoLogins.test.tsx` **stays green with no edit**, and no e2e spec
   touches the card — all ~20 fill `input[type="password"]` directly. One line, zero
   test churn.

2. **Fix the browser tab.** `index.html:7` is
   `<title>ai.STARTUPJURY — Venture intelligence first</title>` — static HTML, no
   Branding field reaches it, and it sits on the projector for the entire demo. Same
   for `/favicon.png`.

3. **Add the missing deploy step.** `package.json:10` is
   `"deploy": "vite build && wrangler deploy"` — **no remote migration**, and no
   `db:migrate:remote` script exists at all, while `plan_parity.md:819` says to apply
   migrations `--remote` *first*. Add:
   ```
   "db:migrate:remote": "wrangler d1 migrations apply startup-jury-db --remote"
   ```
   and confirm remote is at `0104` before shipping:
   `npx wrangler d1 migrations list startup-jury-db --remote`.

**Gate before deploying:** `npm run typecheck && npm run lint && npm test && npm run build`.
**After deploying:** re-grep the new bundle for `demo1234` **and**
`@demo.startupjury.ai` — both must return zero.

**`npm run smoke` will report 6 failures and they are not regressions.** It defaults to
production (`scripts/smoke.mjs:14-18`) and 6 of its checks assert on fixtures the
30-Sep clear deleted (`?q=FinStack`, `call_seed_wealthos_intro`, the two NimbusHR
tokens, a deck in state `failed`, a deck in the PM decision queue). A sibling ran it:
**48 passed, 6 failed**, and nothing in the authZ, security-header, auth-gate or
cross-edition blocks failed.

---

## 4. The runbook is the real problem

`docs/DEMO-RUNBOOK.md` was last refreshed **2026-08-12** and describes a database that
was emptied **2026-09-30**. It has not been opened since. **Every fixture it names is
gone:**

| Beat | Fixture | State |
|---|---|---|
| Act 1 `[+]` "click a seeded row" | FinStack, InsureFlow | deleted |
| Act 3b AI-health banner | PitchLoop | deleted |
| Act 3b "already rescheduled" | MedGrid | `calls` deleted |
| Act 3b resubmit | NimbusHR, CloudBridge | deleted |
| §0.6 "do not touch" | GreenRoute, WealthOS, LearnLoop | deleted |

Measured live, unauthenticated: `/api/resubmit/aisj-demo-nimbushr-resubmit-2026` →
**404 `invalid_token`**. On the projector in a private window the audience would get
**our** `ai · STARTUPJURY` wordmark (`BrandingProvider` never fetches without a
session) above "This link can't be opened."

**Rewrite the script against the decks that actually exist**, with three changes:

- **Cut Act 5 and Act 1's "one platform, two editions" framing.** The VC edition was
  descoped 2026-10-01. It cannot appear by accident — there is no edition switcher
  (`grep -rln "setEdition|switchEdition" src/client/` → nothing) — but the framing
  invites questions about something nobody is building.
- **Replace the Act 3b resubmit beat with FounderFlow** (`QueryPage.tsx:266`, `:782-850`),
  whose own header reads "This is what the founder sees when their pitchdeck is flagged
  as incomplete." Built from live data, no token, no email. The beat survives intact.
- **Avoid two "coming soon" surfaces on the scripted path**: the CRM upload method
  (`upload/CrmMethod.tsx:62`) and `Send signup`, which transitions correctly but lands
  on a screen whose primary action is disabled for every role including superuser
  (`StagePage.tsx:2068` `signupComingSoon: true`). Relatedly the Admin console's whole
  Sign-up group is hidden (`admin/sections.ts:102`), taking four built sections and 14
  e2e tests with it.

**Pre-staged fallbacks, each executable in five seconds:**

| Risk | Fallback |
|---|---|
| Out of credits | Settings → Core Parameters → Plan & credits → Save. **Not** "Buy credits". |
| Resubmit 404s | Query screen → FounderFlow. |
| AI hangs >40s | Keep talking. **Do not re-submit** — it spends another credit and creates a second deck. Have a second tab already open on a scored deck's report. |
| AI fails outright | No instant fix: `retry-ai` only enqueues, and the sweep needs `STUCK_AFTER_MINUTES=10` × `MAX_AI_ATTEMPTS=3` ≈ 30–40 min. Cut to the pre-opened deck. |
| A 0.00 deck opens | Close it. Know which three they are. |

One more latency note: the client aborts a single upload at 60s
(`api.ts:66-72`, `UPLOAD_DEADLINE_FLOOR_MS = 60_000`) while the server runs the
Anthropic call **inline** (`decks.ts:2385` → `await evaluateDeck`) with no
`AbortController` and `max_tokens: 8192`. The runbook's "~10–20s" was measured in July
at 4096. If step 2.7 times a real deck over ~45s, drive the stage demo through the
bulk/queue path (`api.ts:484`), which returns immediately.

---

## 5. Week one — before any real external person signs up

Ordered by severity, each measured.

1. **Session revocation. A removed admin minted a new admin.** `requireAuth`
   (`auth/middleware.ts:15-22`) resolves the whole principal from KV and never reads
   D1; TTL is 7 days (`session.ts:6`); the only `deleteSession` calls pass the
   caller's *own* cookie. **Measured on local wrangler dev:** a soft-deleted admin's
   live session ran `POST /api/users` and created a new admin called "Backdoor",
   HTTP 200. A demoted program manager kept `assign` authority; a deactivated user
   kept full access. No test covers it — `users.test.ts:291` only asserts a fresh
   *login* is refused.
   Fix: one `SELECT role, active, deleted_at FROM users WHERE id=? AND tenant_id=?`
   inside `requireAuth`, 401 on inactive-or-deleted, and refresh `role` from the row.
   Preferred over an epoch-in-KV because it cannot be forgotten at a call site —
   `users.ts:843-848` is this codebase's own proof that it forgets exactly that.

2. **Nobody can change their own password.** `PUT /api/users/me/password` is real,
   scoped and tested (`users.ts:520-556`), the client wrapper exists
   (`teamApi.ts:117`) — and `grep -rn "changeOwnPassword" src/ test/ e2e/` returns
   **exactly one line: the definition**. Zero callers. Meanwhile the product promises
   the change twice: the invite email says "choose your own password straight away"
   (`outbox.ts:635`) and the console says "they can change it from their account once
   they're in" (`TeamRoles.tsx:1120`). Both false. `must_change_password` is written by
   three routes and enforced nowhere (`users.ts:511-516` says so outright), so
   Admin → User access reads "Temporary — not yet changed" for every row forever.
   Fix: one screen calling the existing route, plus `mustChangePassword` on `/me` —
   nearly free, because `auth.ts:223-226` already does a per-request read of that row.

3. **Rate limiting.** `grep -rniE "rate.?limit|throttle|turnstile|captcha" src/ wrangler.jsonc`
   returns nothing. Measured: **40 wrong-password logins returned 401 forty times in
   292 ms**, then the correct password worked — no lockout, no backoff, no audit row on
   failure. Login also leaks address existence by timing (1 ms unknown vs 8 ms known,
   because `verifyPassword` is never called for an unknown address). And
   `tempPassword()` is `aisj-` + 6 hex ≈ **24 bits** (`users.ts:111-113`), never
   expires — so an invited account's only credential is guessable.
   Note: **a dashboard WAF rule is not available** — a `*.workers.dev` hostname has no
   zone. It must be in-Worker (a rate-limit binding in `wrangler.jsonc` plus
   middleware) or it must wait for the custom domain.

4. **The team channel is open to every session.** `support.ts:331` is
   `messages.use("*", requireAuth)` and nothing more; `:355` sets
   `sharedView = channel === "team" || isAdmin`, so the per-user predicate is skipped
   and `scope=team` returns every row to everyone. Measured: a **mentor** — whose
   `/api/decks` and `/api/notifications` are both 403 — read the seeded team message.
   Fix: `denyMentor` plus a staff-role list, and **lead with the founder exclusion**,
   because founders are the external party who will certainly hold accounts.

5. **Upload accepts any file whose *name* ends in `.pdf`.** `versions.ts:44-49`
   `isPdf` accepts the extension alone — no magic bytes, no minimum size, so a 0-byte
   file passes. The credit is reserved first (`decks.ts:2393`), the object is stored,
   four model calls are wasted, and the R2 object can never be deleted. This is on the
   **public unauthenticated** route too (`resubmit.ts:207-217`).
   Fix: require the first five bytes to be `%PDF-` and reject size 0, before the credit.
   One function, three call sites. Already on `plan_parity.md:801`'s own W13-A list.
   *(Negative results worth not re-investigating: the file is served back with a forced
   `application/pdf`, `nosniff` and a scoped `canReadDeck` check, so a renamed HTML file
   is not an XSS vector; and the CSP at `security.ts:51-64` is complete and correct.)*

6. **Migration 0105 — the two indexes `0101` missed.** `authorised_signatories` still
   carries `idx_auth_sig_role ON (edition, role)` and `idx_auth_sig_user ON (edition, user_id)`
   with no `tenant_id`, created by `0035:113-114`. `0101` drops exactly five indexes, all
   named `<table>__pre_tenant_key`, and neither is among them — even though its own header
   line 39 lists this table as one of the nine upserts it widened. Measured twice:
   `PUT /api/esign/signatories` on a fully provisioned second tenant → **HTTP 500**,
   `UNIQUE constraint failed: authorised_signatories.edition, authorised_signatories.role`.
   `esign/store.ts:466-470` predicted it in a comment. Add the drop with `0101`'s own
   assert-before-drop pattern, and give `tenant-scope.test.ts` the role-arm case that
   would have caught it.

7. **Two notification scope leaks, two lines.** `decks/versions.ts:139`
   (`announceIfCreditsLow`) and `auth.ts:192` (`invite_accepted`) are the only two of ten
   emitters that pass neither `scope` nor `deckId`, so `outbox.ts:216-231` falls back to
   `t_default`: a second customer's low-credit alert, and a new employee's name and
   address, get written into and mailed from the **first** customer's workspace. The
   fallback was observed firing live in the dev log. Add `scope,` at both; `crm/provider.ts:256`
   wants it too. Making `NotificationInput.scope` required is right but is its own change —
   it breaks the seven sites that pass only `deckId`.

8. **Config writes return 200 and persist nothing when the row is absent.** Seven bare
   `UPDATE … WHERE tenant_id=? AND edition=?` statements with no upsert and no
   `changes` check (`config.ts:1151, 1221, 1243, 1266, 1286, 1313, 1351`), four of which
   echo the request back as the response (`:1230, :1272, :1296, :1327`) — which is what
   makes the loss invisible. Measured: a credit top-up returned
   `{"creditsBalance":50}`, wrote a `+50 credit_ledger` row, and the balance table had
   no row at all; the next upload was 402. The codebase already does this correctly in
   three other places (`permissions.ts:138`, `config.ts:1045`, `account.ts:535`).
   Convert all seven and return a read-back.

9. **Credits can be minted for free; paying grants nothing.** `POST /api/config/credits`
   — the route the console button actually calls (`ConfigPage.tsx:834`) — has **no upper
   bound** (`config.ts:1310` rejects only non-integers and negatives), while
   `/credits/purchase` is capped at 1000 and reachable only by curl
   (`purchaseCredits` has zero callers). Each credit is a real Anthropic call billed to
   you. Meanwhile `account.ts:28-31` returns `creditsGranted: 0` — "no credits have
   been added — our team will follow up."
   **Do not gate these behind `isPlatformOwner`**: `PLATFORM_OWNER_EMAILS` is `""` in
   production and the check fails closed, so that change locks *you* out of the only
   working top-up path. The no-code fix is a `role_permissions` row removing `upgrade`
   from `admin` for that tenant.

10. **Cron error isolation.** `scheduled.ts:36-47` builds the cross product of every
    active organisation with **both** editions, and the loops at `:93-95` and `:436-439`
    are bare `await`s inside `ctx.waitUntil` — one rejection aborts the rest and is never
    reported. Wrap each workspace body in try/catch naming the tenant. *(Reassuring and
    measured: an unprovisioned workspace mails nobody — `outbox.ts:903` returns early on
    zero recipients.)*

11. **Legal, and it is GCW's exposure not ours.** There is no privacy policy, terms,
    cookie notice, consent, data-processing statement or retention policy anywhere —
    a case-insensitive grep across `src/client`, `src/shared`, `index.html` and `public/`
    returns one unrelated hit. The only retention policy in the schema is for
    `audit_log`. The public founder surface says only "This link is private to your
    submission" (`ResubmitPage.tsx:41`) and never what is collected, why, who sees it or
    for how long — while the product stores founders' names, emails, phones, cities and
    their confidential decks. GCW is the controller; ai.STARTUPJURY is the processor and
    there is no DPA.
    **For tomorrow the minimum is that the presenter does not invite founders to submit
    decks through the product on stage.** Then: two static pages, one collection notice,
    and a DPA. GCW's counsel supplies the text — do not write it.

12. **Nothing can delete a deck or an R2 object.**
    `grep -rn "DELETE FROM decks\b|DECKS\.delete|deleteObject" src/ scripts/ migrations/`
    returns exactly one hit in the whole tree, in `clear-deck-data.sql`. So there is no
    erasure path for a founder, and every PDF from the 30-Sep clear is still in the
    bucket with its row gone — orphaned and enumerable only by `wrangler r2 object list`.
    Ship a scoped, audited admin delete that removes the row and the object together, and
    run the orphan reconciliation before GCW's real submissions mix in with them. It gets
    harder every day.

13. **Custom domain, then email.** `APP_BASE_URL` is a `workers.dev` subdomain, hardcoded
    as a fallback in two more places (`resubmit.ts:93-96`, `users.ts:119-122`). Email can
    never send from `workers.dev`. Cut over with: the domain attached, `APP_BASE_URL` set,
    the sending domain onboarded, `EMAIL_FROM` set, `workers_dev: false`, and — measured
    absent on every production response — `Strict-Transport-Security` and an `X-Robots-Tag`
    or a real `robots.txt` (`/robots.txt` currently returns the app, so a crawler gets no
    rules at all). The cookie is host-only with no `Domain` (`auth.ts:164-170`), so the
    cut-over signs everyone out once. Accept that rather than working around it.

---

## 6. The sign-up — build on what already exists

**Four lanes designed join-link schemes from scratch. None of them noticed the client
already specified this and the screens are already built.**

`docs/PARITY-BUILD-SPEC.md:149-166` is a complete three-step registration spec: "Create
your account" / "Work email required to sign up", with work email, first/last name,
phone + country code, **password (min. 8 characters)**, designation and organisation
name; an account-type picker whose Organization option reads "For VC firms, incubators,
and accelerators"; an org-details form; and a success screen pointing at Set up.

The UI exists at `account/AccountScreens.tsx:313-689` and
`AccountOverlay.tsx:736-775 createOrganization()`, with validators **shared between
client and server** at `shared/accountOrder.ts:289 validateAccountFields` and
`:322 validateOrgDetails`. `accountOrder.ts:249-278` already holds
`PERSONAL_EMAIL_DOMAINS` and `isWorkEmail`, which is the client's own stated rule
("Personal email addresses are not accepted") — so refusing free-mail needs no new
decision.

What is missing is small and specific:

- A **password field and hash** — removed on purpose (`AccountOverlay.tsx:27-28`:
  "everyone who can open this overlay is already signed in").
- The **`organizations` insert**, which `account.put("/profile")` does not do — it is
  behind `requireAuth`, takes the scope from `c.var.user`, and writes
  `account_profiles`, the *commercial* record (`account.ts:437-461`).
- **`organizations.email_domain`** — the column your own assumption needs. **GCW's domain is
  `globalcarbonwarriors.com`** (confirmed 2026-10-05), so the allowlist entry is that one value, stored
  lower-case. Note `isWorkEmail` already refuses the 16 free-mail domains in
  `accountOrder.ts:249-266`, so a `@gmail.com` colleague cannot self-register at all and must be
  invited by an admin — worth telling GCW before the team tries it. The table is
  id, name, slug, status, timestamps and nothing else (`0083:94-112`). Without it a
  signup route must hardcode `tenant_id = 't_gcw'`, which breaks on customer two. Add it
  nullable and lower-case, resolve the tenant from the submitted address's domain, and
  **fail closed** with "ask your administrator for an invite" when no organisation claims
  it.
- **Approval.** Your chosen gate — domain allowlist **plus** admin approval — is the
  right one, and the approval half is the load-bearing one: with no email verification, a
  stranger typing `anyone@gcw.org` would otherwise be inside. Land the account
  `active = 0` and have a GCW admin activate it.
- **Rate limiting** (§5.3) is a hard prerequisite, not a nicety: a public POST with no
  limiter is a free account-creation faucet from the conference wifi.

Two traps nobody flagged:

- **"Organisation" means two different things**, and `0083:98-99` says so:
  `organizations.name` is "what the platform calls this customer";
  `account_profiles.org_name` is "what the customer calls themselves".
- **`account_profiles` is PK `(tenant_id, edition)`** — one row per workspace
  (`0094:96`). A second GCW admin walking the wizard **overwrites the first's record,
  including the V6 billing address** that `ff62f12` says "decides everything
  downstream". Gate the org branch to the first admin only.

**And there is a recorded client decision to honour or overrule explicitly.**
`plan_multitenancy.md:162-164` specifies Stage 2 as "a `trial_requests` table …
**an unauthenticated POST — the product's first, so it needs its own rate limiting and
abuse thinking** — and an approve/decline screen behind the platform middleware.
**Provisioning stays manual.**" Line 315 records his own answer: "he approves, and
provisioning is manual until Stage 4." `grep -rn trial_requests migrations/ src/`
returns nothing. Also note the approval screen has nowhere to live: `isPlatformOwner`
appears in exactly one file (`pricing.ts:334`) and there is no platform router.

---

## 7. Decisions, with the default I would ship

1. **Rebrand `t_default` or migrate to a new `t_gcw`?** → *Rebrand.* §0.
2. **The demo accounts.** Rotating or deactivating `demo1234` breaks **both**
   `npm run smoke` (`smoke.mjs:20` hardcodes it, signs in as four of them) and
   `npm run roles` (`role-matrix.ts:69`, used at `:922` and `:1133`). And
   `raj.kumar@demo.startupjury.ai` is currently the **only superuser in production** —
   priya.sharma is now an `admin` — so a blanket `active = 0` locks you out of the
   workspace you are demoing.
   → *Default:* gate the card tonight; invite GCW's real team; deactivate the demo
   accounts **except** the superuser, run the two gates **before** doing it, and record
   the expected failures. Full rotation after the conference, with `SMOKE_PASSWORD`
   threaded through both scripts.
3. **How many credits?** → *50.* Enough that rehearsal plus the demo cannot run dry.
4. **Which roles may self-register?** → *One code or allowlist entry per role, role
   chosen by the GCW admin, never from the registrant.* Measured: a self-registered
   **program associate** reads every startup's name, sector, city, founder name, founder
   email and AI score — `decks.ts:558` scopes to own-decks for `jury` **only**. Jury-only
   would be safest but leaves GCW's own managers still needing an admin, which is the
   status quo you are trying to fix.
5. **Email tonight or week one?** → *Week one.* Staff invites already work without it
   through a designed fallback screen (`TeamRoles.tsx:1111-1120`), so email buys nothing
   for a presenter-driven demo and the first real send is necessarily against production.
   *(One unresolved contradiction: one lane measured that **miniflare does** emulate
   `send_email`, returning `{"delivered":true}` and writing an emulator temp file, which
   flatly contradicts `types.ts:36-41` and the `wrangler.jsonc` comment. Worth settling
   before relying on a local rehearsal either way.)*

---

## 8. Customer two — the real multi-tenant proof

Tenancy shipped; what is missing is everything around standing a second customer up.

- **There is no provisioning path at all.** `grep -rn "INSERT INTO organizations" src/ scripts/`
  returns nothing; the only INSERT is the single seed row at `0083:117`, and a migration
  runs once. The first user is a chicken-and-egg: `POST /api/users` takes its workspace
  from the *actor* (`users.ts:302`), and `seats.ts:99-105` answers 409 `superuser_required`
  until a superuser exists. A validated 11-step script was produced and driven end to end
  during this measurement — login, every config read, a persisted save, member creation and
  a deck upload that spent a credit — and it belongs in `scripts/provision-tenant.mjs`,
  **not** as pure SQL: `password.ts` fixes the hash format at
  `pbkdf2$100000$<salt>$<hash>`, which SQL cannot produce, and copying a seed hash would
  silently set the new owner's password to `demo1234`. D1 takes no explicit transaction
  either, so it must be one `DB.batch()`.
- **Required rows, measured:** `organizations` (status `active` — note `auth.ts:128`
  refuses only `suspended`, so `trial` also signs in), `org_settings` per edition **with a
  non-zero `credits_balance`**, `org_scoring_settings` (naming `auto_clarification = 0`
  explicitly — the column still DEFAULTs to 1), the 23 `parameters` **plus**
  `parameter_rubric_bands` and `question_bank`, `sectors`, `required_documents`,
  `programs`, `agreement_templates`.
  **The rubric clone is the trap**: `parameters.id` is a global PK and both children
  reference it by id with no tenant key, so the clone must mint new ids and remap by
  joining on `key` — copying `parameter_id` gives a rubric with no anchors and an empty
  question bank.
  **Measured safe to leave empty:** `role_permissions` (249 of 249 cells agree with the
  code defaults — zero disagreements), `seat_capabilities`, `notification_preferences`.
- **The login lockout becomes reachable.** `auth.ts:139-152` returns
  `409 tenant_required` when one password opens two workspaces, and the client never
  sends or handles a tenant: `AuthProvider.tsx:69-83` posts only `{email, password}` and
  `LoginPage.tsx:51-54` catches everything as **"Invalid email or password."** Measured
  with a screenshot. The user resets their password and it doesn't help.
  *Tonight's cheap half:* the error string already reaches the client as
  `Error("tenant_required")`, so three lines in `LoginPage.tsx` turn an unrecoverable
  lockout into a solvable one. *Operational half:* give GCW's first admin an address that
  exists in no other tenant, which removes the condition entirely.
- **The isolation harness you would reach for is vacuous in both directions.**
  `role-matrix.ts:1069` reads `ROLES_TENANT_B_EMAIL`/`_SLUG` and prints
  "NOT RUN — no second tenant to probe with" when unset. Worse, its only by-id probe uses
  `GHOST_DECK` — documented at `:553` as "a non-existent id" — so its 404 is guaranteed
  **against completely unscoped code**; and the other five probes score
  `403 || 404` as a pass (`:1156`), so a correctly-scoped tenant-B admin getting 200 with
  their own empty list is scored as a **finding**. It false-passes the one check that
  matters and false-fails the five that work. Three edits fix it: a real tenant-A deck id,
  score the index probes on whether a tenant-A row id appears in the **body**, and add
  `ROLES_TENANT_B_PASSWORD`.
  Until then the only honest isolation evidence is `test/worker/tenant-scope.test.ts`,
  which seeds its own second tenant — cite that, not a green `npm run roles`.
- **A staging environment** (`env.staging` with its own D1/KV/R2) is the prerequisite for
  ever rehearsing a restore, and the structural reason a demo-eve code change is risky
  here in a way it would not be elsewhere.

---

## 9. Measured corrections worth keeping

- **`ai_gate_threshold` DOES reach the client at HEAD.** The memory note saying it never
  does, and that the Dashboard uses a hardcoded 5.0, is **stale**.
- **`/app/assign` does not clip at phone width.** `AssignPage.tsx:644` already has
  `overflow-x: auto`; measured `scrollWidth 1000 / clientWidth 390` with both panels
  reachable. A lane filed it as the one mobile defect worth fixing tonight and its own
  verifier refuted it.
- **`t_default` credits: 3 vs 50 vs 0 — all three are real.** `0002_seed.sql:11` seeds 3,
  then `0007_config_plans_credits.sql:12` is an **unscoped** `UPDATE org_settings SET
  credits_balance = 50`, so any freshly migrated local DB reads 50. Production reads **0**,
  and that is the only number that matters. *(That unscoped UPDATE is itself the pattern
  that would rewrite every customer's balance if re-run.)*
- **The seeded rubric is already a climate rubric** — 13 core areas including "Climate
  Impact & Integrity" at weight 10 (`0002_seed.sql:34`). A straight copy is defensible for
  a carbon accelerator. But GCW **cannot add a 14th weighted parameter** — only rename the
  13 and add ≤3 unweighted per role — and **45 of 110 rubric band descriptions are blank**
  on the 9 role parameters.
- **The deployed bundle is byte-identical to a local build of `main@ff62f12`**
  (`index-XffRqztI.js`, 1,274,550 bytes, sha256 `2f81f526…`). Every "already fixed in
  code" conclusion holds on stage.
- **The unauthenticated surface is clean.** All 14 probed API paths return 401; `/api/health`
  returns only `{status, service, time}`; no sourcemap; `/.env` falls back to the SPA. Every
  router applies `requireAuth` except `/api/health` and `/api/resubmit`, and the one that
  guards by path prefix (`pipeline.ts:75-86`, mounted at `/api`) was enumerated — all 18
  registrations are covered, no hole. **The entire readable unauthenticated surface is the
  login page — and its bundle ships the keys to everything else.**

---

## 10. How this was measured

Eight parallel lanes (tenant provisioning · the sign-up surface · residual isolation ·
demo-day production facts · day one in an empty workspace · credential lifecycle ·
the loose-ends ledger · making it theirs), each followed by an adversarial pass whose
default was that a blocker claim is overstated until the cited code says otherwise, then
a completeness critic and a demo-day red team. 3.3M tokens, 1,368 tool calls.

The lanes did not only read code: they provisioned second and third tenants in local D1,
drove the real HTTP API against them, re-derived the seed password hash to prove the
published credential is live, and measured login timing and brute-force behaviour.

**Two production facts came from an authenticated read of the live app using the
credentials that are printed in the production bundle** — the 23 decks and
`creditsBalance: 0`. Both are load-bearing here, and the fact that they were reachable
that way is itself the proof that §3.1 is urgent. Everything else marked production was
measured unauthenticated or is flagged `NEEDS-VERIFY` with the command.

---

# 11. Mobile — measured 2026-10-05, and five fixes applied

> Added after the client said **"mobile is extremely important for the presentations"** and confirmed
> the device is a **phone**, with a laptop as the other surface. Four lanes drove the real spine at
> 393px and across 744–1194px, in Chromium **and in WebKit — the first WebKit coverage in this
> project's history** (`playwright.config.ts` has no `projects` array, so all 229 e2e tests run one
> desktop Chromium).

## What was already fine

- **The whole incubator spine completes by tap at 393px.** Login → Dashboard → upload wizard →
  Assign (all four panels) → Evaluate → jury score entry and submit. **Zero page-level horizontal
  overflow on all 14 screens measured.**
- **The PDF viewer survives mobile WebKit.** This was the risk rated highest before measurement and
  it is **refuted**: all 14 pages of the seeded deck rendered, 0 blank, 0 undecoded, ~0.94 MB of
  retained data URLs against a predicted 20–25 MB, and the self-hosted pdf.js worker spawned fine
  under `worker-src 'self' blob:`. **Caveat that still stands:** the repo has exactly one PDF fixture
  and it is 6,891 bytes of text across 14 pages. A photographic 40-page investor deck has never been
  exercised on any engine. **Present the seeded deck.**
- **The sidebar is not the problem on a phone.** `.sj-rail` is `hidden sm:block`, so at 393px the rail
  is `display:none` entirely and navigation is the drawer — which shows all 25 labels and is clean.
  The `.sj-rail a > span { display: none }` half of the 899px rule never fires on a phone.

## The breakpoint decision: `@media (max-width: 899px)` does NOT move

Moving it was tempting and is wrong, for three measured reasons:

1. The rail's width is set separately at `AppShell.tsx:140` (`min-[900px]:w-[190px]`), so restoring
   labels below 900px renders them inside a still-52px `overflow-x-hidden` rail — section headers clip
   to `WOR` / `EVA` / `REP` stubs.
2. `.tbr` is `flex-shrink: 0` and `.tbb` is `white-space: nowrap`, so re-admitting the buttons at 640px
   crushes the screen **title to width 0** and makes the toolbar 160px tall.
3. It is prototype parity, not drift: `AISJ_IC_SuserV15.HTM:293` carries the same `max-width:900px`
   block and `:303` the same `.tbr .tbb:not(.pr){display:none}`.

It is also a **measured no-op above its own max-width**, so the argument against moving it is not
desktop regression — it is that the 640–899 result is worse than the status quo. The device is a
phone, so the band does not arise. **One surgical exception was added instead (fix 3 below).**

## Applied, gated and verified — NOT deployed

| # | Fix | File | Measured before → after |
|---|---|---|---|
| 1 | `min-h-0` → `lg:min-h-0` on both grid children | `components/EvaluationDrawer.tsx:240,302` | rows `300.75/308.75px` → `399.25/1567.38px`; spill **82px → 0**; worst overlap **28px → none** |
| 2 | `flex-wrap justify-end` on the Research cluster | `components/EvalScorecard.tsx:376` | Research right edge **417px → 377px** in a 393px viewport; off-screen **24px → 0** |
| 3 | `:not([aria-haspopup="listbox"])` on the narrow-toolbar rule | `index.css:449` | Programme + Cohort pickers **`display:none` → `inline-flex`, 120px each**; the one other non-primary button **still hidden** |
| 4 | `text-sm` → `text-base` on both login inputs | `routes/LoginPage.tsx` | **14px → 16px**, the threshold below which iOS Safari zooms the page and does not zoom back |
| 5 | `@media (hover: hover)` around the two `.tbb` hover rules | `index.css:336,348` | the only two `:hover` rules in the stylesheet that escaped the capability gate, so a tapped **AI Evaluate** stayed stuck in its pressed colour |

Plus the §3.1 credential fix: the demo-logins card is now behind `import.meta.env.DEV`.

**Fix 1 is the important one.** The Evaluation Report — the demo's money shot — printed the startup
name *on top of* the Deck versions card at every iPhone viewport height from 600 to 734 CSS px, with
the olive eyebrow striking through "Initial upload". It is **height**-driven, not width-driven, which
is why nothing caught it: a default Playwright 393×852 run is clean, and so is iPad portrait. Only
driving at a realistic height — a phone *with the Safari toolbar on screen* — reproduces it.

**Gate:** typecheck · lint green; **3029 passed, 1 skipped across 159 files — byte-identical to the
pre-change baseline**, so zero test churn, and `loginDemoLogins.test.tsx` still passes (vitest runs
with `DEV === true`, as measured). Build green.

**Bundle proof:** the fresh `dist/client/assets/index-BFvdHxCW.js` contains **0** occurrences of
`demo1234`, **0** of `@demo.startupjury.ai` and **0** of `Demo logins`, and is 1,430 bytes smaller
than the deployed bundle — consistent with `DEMO_LOGINS` being tree-shaken out.

**Desktop regression check, driven at 1920/1440/1280/1024:** report still two-column, both sections
still `overflow-y: auto` (the independent scrolling `min-h-0` existed for), Research on screen,
`docOverflow` 0, and both toolbar states unchanged. At **1000px and 960px** — the laptop-zoom band —
fix 1 also removes a 25px spill that previously cleared the eyebrow by only 4px.

## Deliberately not fixed tonight

Each is real, and each has a fix nobody has *rendered*, which is the bar for a change the night before.

- **The deck lightbox's paging chevrons** are centred at x=−16 and x=409 in a 393px viewport, so 4px of
  each is on screen, and tapping the backdrop does not close it. The proposed `max-sm:absolute` inside
  an `overflow-auto` row was never rendered, and the backdrop change alters *desktop* behaviour — at
  1440px a stray click in the dark surround would start closing the slide mid-presentation.
  **Workaround: page the deck from the thumbnail strip, which is `overflow-x-auto` and swipeable.**
- **Evaluate in phone landscape** gives the deck list a 27px window over 73px rows. The lane's fix
  zeroed the sibling panel when rendered. **Workaround: stay in portrait.**
- **The app-wide 16px input sweep.** 227 controls compute below 16px, but `.sj-input` is 11.5px inside
  explicit `h-[27px]` boxes that would clip. Only the two login fields were changed — the first tap of
  the demo, and the one that matters.
- **`h-screen` → `h-dvh`.** On real iOS Safari `100vh` is the *large* viewport and the page cannot
  scroll, so ~50–86px of the shell bottom sits behind the browser chrome. One token, identical on
  every non-iOS engine — but **no emulator can verify it** (Playwright WebKit reports
  `100vh == 100dvh == 100svh`). Ship it only after someone has held a real iPhone.
- **The JURYbuddy launcher** covers 79% of Assign's "Notify by email" switch. No proposed fix was
  sound, and the blocked action was refuted: `notify` defaults ON, so the step completes untouched.

## Tell the presenter

- **Stay in portrait.** Landscape is the worst case: still under 899px so the toolbar is stripped, but
  not yet at `lg:` so the report is single-column, with only ~390px of height.
- **Sign in before walking on stage**, and note the demo-logins card is gone from production now.
- **Present the seeded 14-page deck.** Do not upload a large customer deck live.
- **Page the deck from the thumbnail strip, not the full-screen lightbox.**
- **Don't reach for "Notify by email" on Assign** — it defaults on, and the help launcher covers it.
  It would not send anything anyway: `EMAIL_FROM` is unset, so the outbox records and nothing leaves.
- **Tap deliberately.** The 28px **Log out** button sits 6px from the avatar with no confirmation.
- **A laptop at 100% on ≥1280px is the safest surface.** Zooming to 150% on a 1280px screen puts you at
  853 CSS px — under both breakpoints — which strips the toolbar and single-columns the report.

## Still unmeasured

- **Real iOS Safari.** Everything used Playwright WebKit, which shares the CSS engine but emulates none
  of Safari's UI layer. Three findings depend on behaviour only a device shows: input auto-zoom
  (trigger measured, consequence inferred), the `100vh` clipping, and the canvas-memory ceiling.
- **A large or image-heavy PDF**, on any engine.
- **One timed upload to completion.** Nobody has submitted a live evaluation on any engine, so the
  `60_000ms + bytes/150` client budget against the inline Anthropic call is still untested. Because the
  size term is `bytes/150`, any uplink at or above 1.2 Mbit/s makes deck size cancel out — the only
  failure mode is server time ≥60s.
- **Orientation change mid-session**, and dark mode at phone width.

## One product defect found in passing

A **500 from `POST /api/auth/login` renders to the user as "Invalid email or password."** — the client
catches every non-ok response identically (`AuthProvider.tsx:77-78` → `LoginPage.tsx:51-54`). It is the
same class as the `409 tenant_required` lockout in §8: a server condition the user cannot act on,
reported as a credential error that sends them to reset a password that was never wrong.
