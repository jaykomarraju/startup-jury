# Multi-tenancy and the AISJ Admin tier

**Scoped 2026-09-24**, after the client confirmed on 24-Sep: *"It's going to be multi-tenant, so the
role of AISJ Admin and a dashboard is required."* Four agents — the schema cost, the authorisation
surface, the AISJ screens, and the staging — then one synthesis. Every number below was either a
counted query on this repo or a statement executed against a scratch SQLite database built from all
61 migrations.

**Already actioned from this scoping, before the plan was even filed:** §2's finding A1-A4 is not a
day-one-of-tenancy risk, it is live. `GET /api/pricing` returned 200 with all 24 plans, the working
draft and the version history to an incubator ADMIN **in production**, and the router carries zero
scope predicates, so that principal could publish a catalogue serving every customer. Closed by a
platform-owner gate that ships fail-closed; see `test/worker/pricing-owner.test.ts`.

---

# Multi-tenancy and the AISJ Admin tier — one plan

*Scoped 2026-09-24 against `main` @ `b189abf` (schema unchanged since `3a17dae`). Nothing under `src/`, `test/`, `e2e/` or `migrations/` was touched; `git status --porcelain` is empty. Every number below is either a counted query on the repo or a statement executed against a scratch SQLite database built by applying all 61 migration files (`/private/tmp/claude-501/.../scratchpad/s.db`). Where the four input reports disagreed, I re-measured and say which one was right.*

---

## 1. What the client actually asked for, and what it costs

On 24-Sep the client confirmed that the product is going to be multi-tenant: there will be many customer organisations, each with its own admin, and above all of them an ai.STARTUPJURY tier — "AISJ Admin" — that owns pricing, receives escalated tickets, and approves trial requests at `info@startupjury.ai`. Three sentences. Each one is reasonable on its own and each one is what a SaaS product normally does.

**The honest size: this is the largest single piece of work in the programme so far — larger than the whole parity programme's biggest wave, larger than the My Account wave, larger than Wave R.** The reason is not the features. It is that the database was built, deliberately and in writing, for exactly one customer. `migrations/0001_init.sql:1` says so in its own words: *"Single-tenant: one implicit organization."* There are **69 live tables** and not one of them records which customer a row belongs to. The product has been getting away with this because there is exactly one customer, and because a column called `edition` — which really means "which product variant, incubator or VC" — has quietly been doing the job of a customer key. It works today because the two things happen to coincide. The day a second customer exists on the same edition, every screen in the product will show them each other's data: startup names, founder emails and phone numbers, scores, evaluator rosters, invoices, legal documents, the audit trail. Section 2 lists the routes, one by one. That list is the reason this has to be done properly rather than bolted on.

**What it costs, in plain terms.** Roughly **4–6 weeks of concentrated engineering across 2–3 waves** for the tenancy foundation itself, plus a block of **about 26 database migrations** (against the single slot that is free today), plus one genuinely dangerous operation: rebuilding the `users` table, which 34 other tables point at through 41 foreign keys. The good news is real and worth stating: the mechanism for scoping queries already exists and is already disciplined — **211 SQL predicates already bind a workspace key, and not one of them takes that key from the browser**; every one reads it from the logged-in session. So this is "generalise a two-value enum into a real organisation key", not "invent data isolation from nothing". The second piece of good news is that **not all of what the client asked for is blocked on this.** Price configuration — the item he was most emphatic about — needs *zero* migrations and can ship this week, and it happens to close a live security defect nobody has filed. That is where to start.

---

## 2. The leak table — what a second tenant would see on day one

Read this in two halves. **Class A is broken today**, before tenancy exists: these routes carry no scope key at all, so they already cross the incubator/VC line. **Class B is correct today and becomes a cross-customer leak the instant two customers share an edition value** — which is every customer, because there are only two edition values and `CHECK (edition IN ('incubator','vc'))` is asserted in 25 places.

### Class A — no scope key of any kind (leaking across editions *now*)

| # | Route | Gate | Scope in the query | What crosses |
|---|---|---|---|---|
| A1 | `PUT /api/pricing/draft` (`pricing.ts:509`) | `requireTask("adminconsole","admin")` @ `pricing.ts:308` | **none** — `pricing_draft_meta WHERE id = 1`, `UPDATE price_plans WHERE id = ?` | **A customer's admin edits ai.STARTUPJURY's price book.** Directly contradicts *"this has to be in AISJ Admin control, NOT the client admin."* |
| A2 | `POST /api/pricing/publish` (`:606`) | same | **none** — `UPDATE pricing_versions SET status='superseded' WHERE status='published'` | A customer admin replaces the live catalogue **for every customer** |
| A3 | `POST /api/pricing/rollback` (`:634`) | same | **none** | Same, in reverse |
| A4 | `GET /api/pricing/` (`:312`) | same | **none** | Full draft, every historical version, `published_by` identity, FX and GST settings |
| A5 | `GET /api/pricing/published` (`:300`) | `denyMentor` only | **none** | Any authenticated non-mentor reads the live catalogue. Correct for a global list; wrong the moment any customer gets negotiated pricing |
| A6 | `GET /api/account/` (`account.ts:214`, query `:150`) | `requireAuth` | **none** | The same catalogue, reached from My Account |
| A7 | `POST /api/auth/login` (`auth.ts:42`) | — | **none** — `users.email` is globally `UNIQUE` (`0001_init.sql:7`) | Not a read leak: an **identity collision**. Two customers cannot both employ `alice@gmail.com`, and there is no tenant selector at login. This blocks the model outright |
| A8 | `email_outbox` dedupe (`email/outbox.ts:124-126`) | — | **none** | `monthly_usage_summary:${edition}:${month}` (`scheduled.ts:199`) is tenant-blind. Tenant B's month-end digest is **silently swallowed** as a duplicate of tenant A's. Every other dedupe key is id-derived and safe |

`migrations/0033_price_configuration.sql:6-7` already calls pricing *"a PLATFORM-OWNER surface ... one catalogue serves the whole product."* **The code's own comment agrees with the client; only the gate does not.**

### Class B — scoped by `edition` only (correct today, cross-tenant on day one)

The "Predicate" column is the *only* thing standing between two customers.

| # | Route family | Predicate — file:line | What crosses |
|---|---|---|---|
| B1 | `GET /api/decks` + `/:id`, `/tags`, `/report`, `/versions`, `/file`, `PATCH`, `/onboarding`, `/rescore`, `/retry-ai`, `/upload`, `/bulk` (14) | `decks.ts:480` `["d.edition = ?"]`; `:610-612`, `:770`, `:942`, `:1006` | **The highest-value data on the platform** — startup names, founder names, **founder email and phone** (`:857`), sector, AI score, verdict, tags, and the PDF |
| B2 | `/api/decks/:id/{transition,assign,evaluate,queries,send-signup,recommendation,ic-vote,events,my-scores}` (10) | `pipeline.ts:101-112` `loadDeck` | Stage control **and mutation** of another customer's pipeline. `scores`, `evaluations`, `pipeline_events`, `queries`, `ic_votes` are then reached by `deck_id` with no scope of their own |
| B3 | `GET /api/queries` | `pipeline.ts:694` | Every clarification question and founder response |
| B4/B5 | `GET /api/activity`, `GET /api/audit`, `PUT /api/audit/retention` | `audit/log.ts:468-469` | **The security audit trail**, including `ownership_transferred` rows |
| B6 | `/api/users` GET/POST/PATCH/DELETE, `/reset-password`, `/resend-invite`, `/transfer-ownership` (7) | `users.ts:216-219`, `:487-491` | **The staff roster** — names, emails, roles, invite state — and password reset and ownership transfer **targeting another customer's people** (§6) |
| B7 | `GET /api/evaluators`, `/api/jury` | `pipeline.ts:1186`, `:1225` | Evaluator roster and per-person workload |
| B8 | `/api/analytics/*` (12) | `analytics.ts:111-113`, `:189`, `:437`, `:464` | **Aggregates are the worst shape here** — a mean or count silently sums across customers, so the leak is invisible in the response |
| B9 | `/api/config/*` (16) | `config.ts` via `edition`; parameter writes at `:350`, `:591`, `:647`, `:678` are `WHERE id = ?` after an edition-scoped load | Rubric, weights, AI prompts, **credit balance and credit purchase** |
| B10 | `GET/PUT /api/permissions` | `permissions.ts:35`, `:98` | **The authorisation matrix itself.** A cross-tenant write re-gates another customer's entire console |
| B11 | `/api/calls/*` (9) | `calls.ts:608-618`, `:380`, `:484`, `:547` | Calendar, **participant email addresses**, ICS; `POST /:id/invite` **sends mail to them** |
| B12 | `/api/signups/*` (9) | `signups.ts:305-311` | **Founder-submitted legal documents** streamed from R2; seat allocation |
| B13 | `/api/signup-config/*` (11) | `signup-config.ts:218`, `:224`, `:632` | Document checklists, **fund size and allocation**, seat capacity |
| B14 | `/api/diligence/*` (8) | `diligence.ts:114`, `:137`, `:269`, `:301` — **hardcoded** `edition = 'vc'` (verified) | **Term sheets, valuations, ownership percentages, legal and investment DD.** A literal is worse than a bound parameter: there is not even a variable to re-point |
| B15 | `/api/esign/*` | `esign/store.ts:66-72`, `:227-229` | Agreement templates, **authorised signatories**; `agreements`/`signatures` carry no scope column |
| B16 | `/api/billing/*` (5) | `billing.ts:122,161,242,313,373` | **Invoices, subscriptions, payment intents** |
| B17/B18 | `/api/seats/*` (4), `/api/account/orders/*` (2) | `seats.ts:132`, `:172`; `account.ts:208` | Seat grants and tiers; order history and receipt PDFs |
| B19 | `/api/crm/*` (6) | `crm/store.ts:72` | CRM base URLs, webhook paths, **credential hints**, sync log |
| B20 | `/api/tickets`, `/api/issues`, `/api/messages` (9) | `support.ts:39-41`, `:89-91`, `:133`, `:273-281` | **The exact surface the client's tenancy sentence is about.** Today every ticket sits in one flat edition-keyed pool with no upstream |
| B21 | `/api/notifications` + bell, outbox, prefs (6) | `notifications.ts:88-91` | Notification bodies quote deck names and founder identities |
| **B22** | **Notification fan-out** (`email/outbox.ts:713-716`) | `SELECT … FROM users WHERE edition = ? AND active = 1 AND <roles>` | **Outbound.** One customer's deck event **emails every other customer's admins and PMs**, startup name in the subject. A leak that leaves the building |
| B23 | Monthly usage cron (`scheduled.ts:190-199`) | `for (const edition of ["incubator","vc"])` | Two digests platform-wide, each summing **every** customer's deck and evaluation counts — and colliding per A8 |
| B24–B30 | `/api/programs/*` (9), `/api/questions/*` (6), `/api/assignments/*` (3), `/api/ai-prompts/*` (5), `/api/anchors` (2), `/api/resubmit/*` (2), AI rescore + credit refund (`ai/health.ts:150`) | see the AUTHZ report for each line | Programmes and **fund size**, question bank, assignment roster, AI prompts, rubric bands — and **credit refunds charged to an edition, not a customer**, so tenant A's failed evaluation refunds a balance tenant B draws on |

**One more, not a route.** R2 object keys are flat: `versionKey(id, 1)` (`decks.ts:1476`), `signups/${row.id}/${doc.id}/${safeName}` (`signups.ts:582`). Unguessable ids reached only through a scoped D1 lookup, so not an independent read leak — but one bucket with no tenant prefix means no per-customer lifecycle policy, no per-customer export, and no per-customer deletion at offboarding.

**Why this table is the argument.** Of 510 prepared statements under `src/server/`, **243 carry an `edition` token and 267 do not** — and most of the 267 are child reads keyed off a parent id that a scoped loader validated one frame up. They are safe *because* the check happened above them, which is precisely why they break together. A plan that adds an AISJ principal without adding a tenant key leaves every row above intact and simply gives ai.STARTUPJURY a console from which to watch customers read each other's data.

---

## 3. What does NOT need tenancy

Three of the four blocked items are gated on a **principal**, not on a tenant key. Evidence for each.

### Price configuration — the test case. **The price book is global, and the schema already built it that way.**

Five independent measurements:

1. `src/server/routes/pricing.ts` contains the string `edition` **zero times** — the only one of the 25 files in `src/server/routes/` at zero (next lowest `resubmit.ts` at 4; `config.ts` at 126).
2. **None of the eight pricing tables carries an `edition` column** (verified against the parsed schema: `currencies`, `fx_rates`, `price_plans`, `price_amounts`, `price_groups`, `pricing_settings`, `pricing_versions`, `pricing_draft_meta` are absent from the 28-table edition list).
3. **The database enforces one live catalogue product-wide**, verified on the materialised schema:
   `CREATE UNIQUE INDEX pricing_versions_one_published ON pricing_versions (status) WHERE status = 'published'`. Under a per-customer catalogue that index would be a bug. It is not a bug; it is the schema already modelling the client's sentence.
4. Every purchase path reads that one book — `src/shared/seats.ts:165-210`, and `:271` returns `tier_not_purchasable` rather than falling back to a local number.
5. **No per-customer price exists anywhere.** `billing_subscriptions` can hold a negotiated plan label (`0046:35-38`) but **has no amount column at all**.

**So moving Price configuration to AISJ is a gate change, zero migrations.** A platform middleware in front of `pricing.ts:308`'s four editor routes, `pc` filtered out of `adminSectionsFor` (`admin/sections.ts:385-387`), and `GET /published` left on `denyMentor` because the plan tiles, Buy credits and the My Account overlay all read it.

**It is also a live P0 that nobody has filed.** `pricing.use("*", requireTask("adminconsole","admin"))` is the only gate; `types.ts:176`/`:205` seed `adminconsole: ["superuser","admin"]` in both editions; `middleware.ts:63` passes anyone in that list whose grid cell is on. So **any customer admin, in either edition, can publish the catalogue every buyer is priced from** — self-service discounting, on a surface about to be pointed at real buyers.

### Ticket escalation — mechanism no, purpose yes

Half of what the client asked for is already true by accident: `GET /api/tickets` is `requireRole("admin")` (`support.ts:34`) and returns every `category='support'` row in the edition, so "whatever tickets raised will go to Client Admin" is what the product does, with no recipient column. `tickets` has no destination, escalation or routing column; `billing_routed` routes nothing (its only consumer is a badge at `SupportPages.tsx:122`). The second half — "whatever Client Admin raises would reach AISJ admin" — needs a `scope`/`destination` column plus a platform inbox: **two plain `ALTER TABLE`s** (`status` has no CHECK to widen). Do **not** reuse `messages`: `to_scope` carries `CHECK (to_scope IN ('admin','team'))` (`0001_init.sql:200`) and widening a SQLite CHECK means rebuilding the table — the exact hazard `0073_seat_pricing_v3.sql:19-31` documented and routed around.

### Payment — taking one, no; reconciling one, yes

`billing/provider.ts:96` is `const ADAPTERS = {}` by design; `resolvePaymentClient` returns `null` unconditionally; invoices are stamped `NOT A TAX INVOICE · NO PAYMENT RECEIVED` (`account.ts:505`). The client answered Q4: **Stripe**. The merchant account is AISJ's either way, so the money lands in the same place regardless of who paid — but nothing records *who paid* beyond `edition`. **Two instructions for whoever writes the adapter:** `provider.ts:162` hardcodes `returnUrl: "/app/admin?section=bl"`, wrong for a customer-specific host; and the webhook's `metadata`/`client_reference_id` must carry a tenant field **from the first live transaction**, even if it is a constant until tenancy lands. Reserving that field now costs nothing and is the only part of item 9 that gets more expensive by waiting.

### Trial approval — **this one does need tenancy, and it is the hardest**

There is no object to move. There is no trial *request*: the trial is a grant (`credit_ledger` reason `'trial_grant'`, `0032:27`, seeded three per edition), and `billing.ts:237-238` says so — *"The free trial is granted, not bought."* There is no registration route: `src/server/routes/auth.ts` has exactly three (`/login:42`, `/logout:104`, `/me:115`), and the only way a `users` row is created is an existing admin adding a colleague (`users.ts:263`). `grep -rniE 'trial_request|trial_approval|info@startupjury'` over `src/` and `migrations/` returns zero. **"Approve" means create a workspace** — and with four tables whose primary key *is* `edition`, creating a second workspace is a schema change, not an insert.

The email leg of both item 8 and item 12 is separately blocked: `emailDeliveryConfigured` is `Boolean(env.EMAIL && env.EMAIL_FROM?.trim())` (`email/outbox.ts:155`), and `EMAIL_FROM` has been unset since 2026-08-12. Everything records as `status='recorded'` and nothing leaves the Worker.

### The structural reason an AISJ principal cannot be a role

Both gate constructors carry the same bypass, verbatim (verified):

```
middleware.ts:32   if (user.role !== "superuser" && !roles.includes(user.role)) { 403 }
middleware.ts:63   if (user.role !== "superuser" && !roles.includes(user.role)) { 403 }   // requireTask
nav.ts:367         role === "superuser" || item.roles.includes(role)
```

So a `requireRole("aisj_admin")` is **passed by every customer superuser** — every account owner becomes a platform administrator. And the reverse asymmetry is worse: `canSeeNav` has no bypass for an unknown role, so the AISJ principal sees **nothing** in nav, while `shared/permissions.ts:97` (`if (!isMatrixRole(edition, role)) return true;`) returns **true for every task** for any role outside `PERMISSION_ROLES`. A naively added vendor role is invisible in nav and ungated in `requireTask`. `SessionUser.edition` is required and non-nullable (`types.ts:54-66`) and an AISJ admin has no edition.

**Therefore: AISJ Admin is a second principal *type*, never a `Role`.** A discriminant on the session (`kind: "tenant" | "platform"`), and a check that runs **before** the superuser short-circuit on `:32`/`:63` — not as an extra clause in the same expression, because the point is that the two ladders must not be comparable. `creatableStaffRoles()` (`roles.ts:220-222`) already excludes superuser "because a workspace has exactly one owner"; the same reasoning says a vendor principal is not creatable from inside a workspace at all.

*(Doc drift to correct: `plan_roles_incubator.md` cites the `canSeeNav` bypass at `nav.ts:339`; it is now `nav.ts:363` (declaration) / `:367` (the expression). `middleware.ts:32` is still accurate.)*

---

## 4. The staged path

Each stage ships independently and is valuable on its own.

### Stage 0 — the platform-owner gate. **Ship this week. One session, 3–5 days.**

`PLATFORM_OWNER_EMAILS` in `wrangler.jsonc` vars, a `requirePlatformOwner` middleware replacing the single line at `pricing.ts:308`, `pc` filtered out of the console rail, customer-facing price cards left read-only against `GET /published`. **Migrations: none.**

*Measured cost:* the section id `pc` appears in tests exactly once (`test/client/adminConsole.test.tsx:126`); the concentration is `test/worker/pricing.test.ts` (450 lines, 48 mentioning `admin`/`superuser`/`403`) plus `test/client/priceConfiguration.test.tsx` (639) and `e2e/price-configuration.spec.ts` (114) — test restatement, not redesign.

*Unblocks:* item 10 fully; gives items 8 and 9 a named recipient; answers My Account's Q4 as a side effect; and is the cheapest possible proof of the platform-principal concept — if an env-var allowlist turns out to be wrong because the client wants a real user row and a dashboard, we learn that after a week, not after a wave.

*Record, do not fix:* `audit_log` is edition-scoped (`0030:22`) and the three pricing `recordAudit` calls (`pricing.ts:518,614,645`) inherit that, so a platform owner's global edit lands in whichever edition their session carries. Accept at Stage 0; resolves for free at Stage 4.

*Prohibition, in the session prompt, in those words:* **do not touch `src/server/routes/users.ts`.** See §6.

### Stage 1 — the My Account wave. **Can start NOW — the day Stage 0 merges, and not behind it in the same session.**

Exactly as `docs/plan_myaccount.md` §5 scopes it: three work sessions plus integration, one full wave, migrations `0077`–`0078`. Its own estimate ("~160 unit/client/worker assertions and 60 e2e across 12 files") is the number to trust; I did not re-derive it and will not flatter it.

**Why Stage 0 must be separate and first rather than folded in:** S-CAT already owns `admin/PriceConfiguration.tsx`, so Stage 0 either hands that file over clean or S-CAT inherits a moving gate. A gate change with negative controls is reviewable; a gate change buried in a catalogue rewrite is not.

**One instruction Stage 4 imposes on S-CAT, one line:** the new order-lines table must carry an `edition` column, following the convention on `account_orders` (`0053`), so it rides the same sweep as the other 28 tables. It must **not** put an edition or org key on the price catalogue tables.

### Stage 2 — trial requests + platform approval queue. **No tenancy. ~1 week, 1 session, 1 migration (`0079`).**

A `trial_requests` table with no tenant key (it predates the tenant by definition), an unauthenticated `POST` — the product's first, so it needs its own rate limiting and abuse thinking — and an approve/decline screen behind the platform middleware. **Provisioning stays manual:** "approve" records the decision and notifies; a human creates the workspace until Stage 4 can. That is not a fudge — the client said *"I see and approve"*, which is a human step by his own description. Email stays recorded-not-sent until `EMAIL_FROM` is set.

### Stage 3 — ticket escalation. **No tenancy. ~1 week, 1 session, 1 migration (`0080`).**

`tickets.scope TEXT DEFAULT 'tenant'` plus `escalated_at`, an "Escalate to ai.STARTUPJURY" action, and a platform inbox reading across editions. Also fix the JURYbuddy defect `plan_v3_superuser.md:2105-2110` records — the raiser cannot see their own ticket — which is one extra arm on `GET /`, the shape `messages.get("/")` already ships at `support.ts:264-290`. Note `support.ts:226-228` validates assignee against `c.var.user.edition`, so a platform principal has nowhere for a ticket to land until `scope` exists.

### Stage 4 — tenancy proper. **4–6 weeks, 2–3 waves. This is the number I am least sure of.**

An `organizations` table, `tenant_id` added **alongside** `edition` (not replacing it), the session generalised, a backfill making today's data one organisation, the roles harness given a second tenant, and self-serve provisioning closing Stage 2's manual step.

*Why 4–6 weeks and not two:* 28 tables take a column; **211 `edition = ?` predicates** each take a second bind; **1,282 server references and 518 client/shared references** to `edition` must each be triaged as "tenant-scoping" or "product-variant" — two meanings sharing one word, and separating them is the actual work, not the SQL. Then the roles harness (526 cases) and e2e (72) need a second-tenant fixture to be worth anything, because a tenancy bug with one tenant in the database is invisible. *Why not twelve weeks:* the scoping mechanism already exists and is already tested. Stage 4 changes what the bound value is, not how it gets there.

**Ceiling summary:** Stages 0–3 need `ALLOTMENT_CEILING` **76 → 80**. Stage 4 needs a second, separate, deliberate raise (§5).

---

## 5. The schema plan

### 5a. The premise corrected: **69 live tables, not 70**

70 `CREATE TABLE` statements exist; `rubric_anchors` (`0001_init.sql:44`) is dropped at `0039_five_band_signal.sql:44`. Verified on the materialised schema: `select count(*) from sqlite_master where type='table'` → **69**. The "70" in `plan_myaccount.md` §10 and `plan_v3_superuser.md` §12.1 counts a table that has not existed since `0039`.

### 5b. The 69, classified — **28 tenant-owned · 8 platform-global · 33 scoped by proxy · 0 indifferent**

The buckets sum exactly to 69 with no remainder. **There is no table in this schema that is indifferent to tenancy.**

- **Tenant-owned (28, verified by parsing every `CREATE TABLE` body for an `edition` column):** `account_orders`, `account_profiles`, `agreement_templates`, `audit_log`, `authorised_signatories`, `billing_invoices`, `billing_payment_intents`, `billing_subscriptions`, `credit_ledger`, `crm_connections`, `crm_sync_log`, `decks`, `messages`, `notification_preferences`, `notifications`, `org_scoring_settings`, `org_settings`, `parameters`, `programs`, `required_documents`, `resubmit_tokens`, `role_permissions`, `score_visibility`, `seat_capabilities`, `seat_grants`, `sectors`, `tickets`, `users`.
- **Platform-global (8):** the pricing tables of §3. **Do not add a tenant key to these.** The work here is the gate, not the data.
- **Scoped by proxy (33):** 21 via `decks.edition` one hop (`scores`, `evaluations`, `calls`, `signups`, `email_outbox`, …), 12 via another keyed parent one to three hops (`signatures` → `agreements` → `signups` → `decks` is the deepest).

**The proxy bucket is where the silent failures will be.** Across ten of those tables there are **69 `FROM <table>` sites in `src/server/` and only 26 carry a `JOIN`** — `email_outbox` 3/0, `esign_outbox` 2/0, `signatures` 1/0, `evaluations` 24/7, `scores` 13/8. Forty-three reads of tenant-scoped data with nothing in the statement naming the owner. Same defect class as the two P0s closed this week; the difference is that today a missing predicate leaks across an *edition* and afterwards it leaks across a *customer*.

### 5c. Tenant key placement, and what `org_settings` becomes

**A tenant is an organisation that HAS an edition. `edition` survives; `tenant_id` is added alongside.** Reasons in order of weight:

1. Collapsing `edition` into the tenant means rewriting **211 predicates** and their binds. Adding `tenant_id` alongside leaves all 211 *correct but insufficient* rather than *wrong* — a failure mode a compiler and a negative control can find, not one that silently returns another customer's rows.
2. `edition` is not only tenancy; it is the product variant, and four sites branch on it to decide which features exist: `diligence.ts:69` (403 `wrong_edition`), `pipeline.ts:955`, `:1006`, `config.ts:824`.
3. `ROLES_BY_EDITION`, `PERMISSION_ROLES`, `DEFAULT_ROLE_PERMISSIONS`, `VISIBILITY_ROLES`, `CALL_KINDS_BY_EDITION`, `NAV_BY_EDITION` and 25 `CHECK (edition IN (...))` constraints are all dimensioned on the two values. If `edition` survives, **none of the 25 CHECKs move.**

So: **`org_settings`, `org_scoring_settings`, `parameters`, `role_permissions`, `score_visibility`, `seat_capabilities` become `(tenant_id, edition)`-keyed** — what they configure is edition-shaped. **`account_profiles` and `billing_subscriptions` should be keyed by `tenant_id` alone** — they are the commercial record, and `0053_account_profile.sql:12-14`'s own words, *"one commercial account per workspace"*, become true per customer. `account_profiles` (`organization_name`, `org_kind`, `business_type`, `employees`, `city`, `country`, contact block) is already the closest thing in the schema to an organisations row; the new table is largely a re-key of it, not a new concept.

*One decision to put to the client, not to assume:* `seat_capabilities` says which parameter sets each **tier** may configure. That is an entitlement of a purchased tier, and the client just said tier pricing is AISJ's. If entitlement follows price it belongs in the global bucket, and bucket (a) is 27, not 28.

### 5d. What `ALTER TABLE` can and cannot do — measured, not assumed

Executed against the materialised schema:

| Statement | Result |
|---|---|
| `ALTER TABLE users ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 't_default'` (4 CHECKs on the table) | **OK** |
| `ALTER TABLE role_permissions ADD COLUMN …` (composite PK `edition,role,task_id`) | **OK** |
| `ALTER TABLE programs ADD COLUMN tt TEXT UNIQUE` | **Error: Cannot add a UNIQUE column** |
| `PRAGMA foreign_keys=ON; ALTER TABLE decks ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES organizations(id)` | **Error: Cannot add a REFERENCES column with non-NULL default value** |
| the same without `REFERENCES` | **OK** |

**So a CHECK constraint does not force a rebuild and neither does a composite PK** — the commonly stated rule is wrong. But **you get a backfilled `NOT NULL` tenant key or a declared foreign key to `organizations`, not both in one statement.** Accept 28 tenant columns with no declared FK, or go nullable → backfill → rebuild for `NOT NULL`, which doubles the rebuild count. **Recommendation: no declared FK on the added columns**, with the integrity assertion of §5f standing in for it.

### 5e. What genuinely needs a rebuild: **11 tables**

Only where the tenant key must enter a PRIMARY KEY or a table-level UNIQUE.

- **PK is `edition` (4):** `org_settings`, `org_scoring_settings`, `billing_subscriptions`, `account_profiles`
- **Composite PK carrying `edition` (3):** `role_permissions`, `score_visibility`, `seat_capabilities`
- **Table-level UNIQUE that is tenant-blind (4):** `users UNIQUE(email)`, `agreement_templates UNIQUE(edition,code)`, `billing_invoices UNIQUE(edition,number)`, `crm_connections UNIQUE(edition,provider)`

The other 17 of the 28 take a plain `ADD COLUMN`. **21 non-unique indexes lead with `edition`** and **5 unique indexes mention it** (both counts verified on the materialised schema); the unique ones are `CREATE INDEX`-origin, so DROP + recreate, no rebuild. All 21 must be re-cut as `(tenant_id, edition, …)` or they stop being selective the moment a second customer exists.

**`users` is the eleventh and it is a decision, not a given.** It joins the rebuild set *only if* email uniqueness becomes per-tenant. Today's seed already shows the cost of not deciding: `0002_seed.sql` ships **Nisha Kapoor twice** (`nisha.kapoor@` and `nisha.kapoor.vc@`), one human with two mangled addresses, purely to get past a tenant-blind unique index. Under real tenancy that stops being a seed quirk and becomes a product defect — two customers cannot both employ `alice@gmail.com`.

### 5f. The `0038`-class trap for **this** migration, named

`0038`'s failure was loud: it asserted the parameters it deleted had no children, production had 9 `scores` rows referencing them, and the apply died on `FOREIGN KEY constraint failed`. Recoverable.

**This one is silent.** `users` must be rebuilt to turn `UNIQUE(email)` into `UNIQUE(tenant_id, email)`. Measured on the materialised schema: **41 inbound foreign-key edges from 34 tables** point at `users` — the most in the schema, out of 99 FK edges total. The standard SQLite rebuild starts with a rename. Tested both ways:

| | `ALTER TABLE users RENAME TO users_old` |
|---|---|
| `PRAGMA foreign_keys=OFF` (sqlite3 CLI default) | child clauses untouched — `decks.assigned_to TEXT REFERENCES users (id)` |
| `PRAGMA foreign_keys=ON` (**D1's behaviour**) | **all 41 child clauses rewritten** — `REFERENCES "users_old" (id)`; a `pragma_foreign_key_list` count confirms 41 edges now point at `users_old` |

**The rebuild reports success and leaves 41 foreign keys in 34 tables pointing at a table you are about to drop.** It is invisible on the seed (2,413 application rows; every row resolves either way) and invisible on production too — nothing surfaces until a later `INSERT` or `DELETE` behaves as though the constraint were gone.

**Nothing in the repo would catch it.** `grep -rn "foreign_key_check\|integrity_check" src test e2e scripts package.json` returns **zero** (verified). `test/worker/migrations-w1b.test.ts` asserts numbering, contiguity, `IF NOT EXISTS` guards, re-executable inserts and idempotent re-apply — never referential integrity. **The detector has to be written before the first rebuild lands:** a `PRAGMA foreign_key_check` assertion after apply, plus a per-table `SELECT count(*) WHERE tenant_id IS NULL` backfill assertion. Treat that test as the first deliverable of Stage 4, not as a follow-up.

Two smaller live-data traps: **A8's `monthly_usage_summary:${edition}:${month}` dedupe key**, which will not show up until the second customer's first month-end; and **the deployed D1 drifts behind the repo every wave** (22 behind on 2026-09-12; the local ledger is at 61 files / `0075`). A rebuild written against repo HEAD will `INSERT INTO users_new SELECT …` a column the deployed table does not have. **Apply `0001`–`0075` to remote first, verify `d1_migrations` reports 61, then start** — and rehearse the whole chain against a restored copy of production before any of it is applied. A 26-migration chain against a drifted production database is the single largest operational risk in this programme.

### 5g. Migration slots and `ALLOTMENT_CEILING`

`main` ends at `0075`; `ALLOTMENT_CEILING` is **76** at `test/worker/migrations-w1b.test.ts:40`, asserted at `:71` (verified). `0076` is reserved by `plan_roles_incubator.md:122` and `:172` for Wave R+1's V3-SF answer. **One slot exists. This work does not fit in one slot, and saying otherwise would be false.**

**Raise it twice, deliberately, and say so in both commits.**

**Raise #1 — now, with Stage 1's first migration: 76 → 80.**

| Slot | Work |
|---|---|
| `0076` | V3-SF `score_visibility` (already reserved) |
| `0077`–`0078` | My Account wave (catalogue + order lines) |
| `0079` | `trial_requests` (Stage 2) |
| `0080` | `tickets.scope` + `escalated_at` (Stage 3) |

**Raise #2 — as the first commit of the tenancy block: 80 → 110.** Allot **`0081`–`0106`** (26 slots), with `0107`–`0110` as declared headroom:

| Slots | Work |
|---|---|
| `0081` | `organizations`; seed the one existing tenant; re-home `account_profiles`' org columns |
| `0082` | `platform_principals` (if AISJ staff do not live in `users` — §7 Q3) |
| `0083`–`0085` | `ADD COLUMN tenant_id` nullable, no `REFERENCES`, on the 17 non-rebuild tables, batched by subsystem, + backfill |
| `0086`–`0088` | Denormalise `tenant_id` onto the hot proxy tables (`scores`, `evaluations`, `deck_assignments`, `email_outbox`, `signatures`, `calls`, `signups`, `queries`, `pipeline_events`) rather than pay a 1-to-3-hop join on 43 join-free read sites |
| `0089` | **Rebuild `users` alone**, with its own verification migration |
| `0090`–`0099` | Rebuild the other 10, **one table per migration for reviewability** |
| `0100`–`0101` | Index pass: re-cut the 21 edition-leading indexes, swap the 5 unique ones, fix the dedupe key |
| `0102` | `NOT NULL` enforcement on the columns added nullable |
| `0103`–`0106` | Spillover — a rebuild wave has never fit its first estimate in this repo |

Raise it to the **wave's** ceiling, never to a session's number — the convention the test file records at `:35-38`. Every parallel session in the wave hits that line; expect a one-line conflict and take the highest value.

**State the corollary plainly to the client: eleven table rebuilds cannot safely share one migration.** "Add multi-tenancy" is not a task that fits in the slot that is free. It is its own numbered block sitting *underneath* the My Account wave, not beside it.

---

## 6. What this invalidates

| Planned work | Effect |
|---|---|
| **R8-AW/SF** (V3-SF `score_visibility`) | **Not invalidated.** A role×role matrix *inside* a workspace stays edition-scoped and picks up `tenant_id` in the Stage 4 sweep. Its reserved slot `0076` is the only collision, and that is the ceiling problem, not a tenancy problem |
| **R9-GAPS** | **Not invalidated.** Prototype-vs-build permission gaps within a workspace. Orthogonal |
| **My Account S-CAT / S-FLOW / S-SUPER / S-INT** | **Not invalidated**, with the one-line instruction in Stage 1. The tables S-CAT touches that *will* move (`account_orders`, `account_profiles`, `billing_*`, `credit_ledger`, `seat_grants`) all already carry `edition`, so following the convention is sufficient |
| **`plan_myaccount.md` §10 and `plan_v3_superuser.md` §12.1 — "70 tables"** | **Correct to 69** (§5a) |
| **`plan_roles_incubator.md` — `nav.ts:339`** | **Correct to `nav.ts:363`/`:367`** |
| **`plan_v3_superuser.md` §12.1 option (i)** — `PLATFORM_OWNER_EMAILS` + `requirePlatformOwner` | **Right shape, keep it — but name what it is.** An env-var allowlist is a principal with no row in any table, so it can hold no audit actor id (`audit_log.actor_id` references `users(id)`), no notification preference, and no ticket thread. Item 12 needs a principal with an inbox. Under real tenancy the platform principal wants its own table |
| **`scripts/role-matrix.ts` (962 lines)** | **Structurally invalidated for this work.** All three layers close over `ROLES_BY_EDITION` (`:152-153`, `:222-224`, `:393`): a principal outside it produces no columns, no rows and **no failure** — the harness stays green while the vendor principal is entirely untested. Worse, `expectedAllowed()` at `:859-863` reads `if (!probe.strict && user.role === "superuser") return true;` — **the harness encodes the superuser bypass as the expected answer**, so a customer superuser reaching a vendor-only route is recorded as *correct*. It needs a fourth section: a cross-principal matrix over `{tenant A, tenant B, platform} × {A's resource, B's resource, platform resource}` asserting 403/404 off the diagonal, and `SEED_USERS` (13 hand-listed accounts, `:466-479`) roughly doubles |
| **`users.ts:724` — the transfer-ownership tripwire** | **Tenancy makes it the most dangerous route in the codebase, and Stage 0 must not touch it.** Three reasons, and a required change |

**The tripwire, in full.** `users.post("/:id/transfer-ownership", requireTask("adminconsole"), …)` — with `roles = []`, `middleware.ts:63` reduces to exactly `role === "superuser"`, ANDed with the console's own cell. **The emptiness *is* the gate.**

1. It is the one route whose authorisation is expressed as an *absence*. Every tenancy sweep — adding a clause, threading a scope object, regenerating guards — is exactly the mechanical pass that "tidies" an empty varargs list. In a diff of 65 `requireTask` sites it looks like an oversight being corrected.
2. The bypass it relies on is the bypass §3 says must change. Insert a platform check ahead of `:63` and an empty role list silently comes to mean *"superuser OR anyone the new check waves through"* — and the new check exists precisely to let a vendor principal through.
3. Its two `UPDATE`s (`users.ts:741-750`) are `WHERE id = ? AND edition = ?`. With `tenant_id` on the table but not in those clauses, the batch promotes a target and demotes the actor **in whichever customer's row matched** — a silent cross-tenant ownership transfer. The invariant at `users.ts:719`, *"exactly one superuser per edition"*, becomes *per (tenant, edition)*.

**What it must become:** retire the empty-list idiom rather than carry it forward — a dedicated `requireWorkspaceOwner()` whose name cannot be widened by a sweep and whose test asserts 403 for `admin`. A platform principal must be **explicitly refused** here; if AISJ should ever rescue a stuck customer's ownership, that gets its own route, its own audit category and its own confirmation, not a side effect. And note `deleteSession` at `:763-764` ends only the *caller's* session: sessions snapshot `role` and `edition` into KV for 7 days (`session.ts:6`) and will snapshot `tenant_id` the same way, with **no invalidation path when a principal's tenant changes**.

---

## 7. Questions for the client — each with the answer we ship if he does not reply

1. **Does a tenant map to an ORGANISATION, or to an organisation-and-edition pair — i.e. can one customer run both an incubator and a VC workspace under one account?** → *We ship: an organisation that HAS an edition, keys becoming `(tenant_id, edition)`, which supports both readings and leaves all 211 existing predicates correct-but-insufficient rather than wrong.*
2. **Is the price book GLOBAL — one list every customer pays from — or per-tenant?** → *We ship: global, because `0033:6-7`, the eight edition-free pricing tables and the `pricing_versions_one_published` unique index already built it that way; get this confirmed in writing before the gate moves, because per-customer pricing afterwards is a migration, not a setting.*
3. **Do AISJ staff exist as rows in the customer `users` table, or in their own platform table?** → *We ship: their own table, because an env-var principal can hold no audit actor id, no notification preference and no ticket thread — but the env-var allowlist is the Stage 0 stopgap either way.*
4. **Can one human belong to two customers — i.e. does `users.email` become unique per tenant?** → *We ship: yes, per-tenant, which forces the `users` rebuild; it is the difference between ten rebuilds and eleven and it must be decided before the block is numbered.*
5. **Does "self-serve trial" mean signup provisions a workspace with no human step, or does he personally approve each one as he described?** → *We ship: he approves, and provisioning is manual until Stage 4 — if no human step is acceptable, Stage 2 collapses into Stage 4 and its week disappears into the 4–6.*
6. **Should the AISJ tier ever be able to act inside a customer's workspace (impersonation for support), or only observe?** → *We ship: observe only, with every cross-boundary action refused by default, because an impersonation path is what turns the transfer-ownership tripwire into a cross-tenant ownership transfer.*
7. **Is `seat_capabilities` — which parameter sets each purchased tier may configure — AISJ's entitlement definition or the customer's setting?** → *We ship: the customer's (it keeps `(tenant_id, edition)`), but if entitlement follows price it is AISJ's and moves to the global bucket.*
8. **When is the sending domain being onboarded?** → *We ship: nothing leaves the Worker; `EMAIL_FROM` has been unset since 2026-08-12 (`email/outbox.ts:155`), so the `info@startupjury.ai` leg of both the trial queue and ticket escalation is audit-only until it is set — this is a business step, not an engineering one.*

---

### The one thing to do first

**Stage 0: move price configuration behind a platform principal, this week, as its own session.** It is a live P0 the client independently asked for; it is the only one of the four items where the data model is already right; it unblocks the wave that is actually ready by answering My Account's Q4 as a side effect; and it is the cheapest possible test of the platform-principal concept. Parking a scoped, valuable wave behind a 4–6 week foundation rewrite in order to close a gate that takes 3–5 days would be the expensive mistake available here.

**And the session prompt carries one prohibition in these words: do not touch `src/server/routes/users.ts`.**
