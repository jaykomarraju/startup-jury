# The Global Carbon Warriors onboarding call

_For the call where GCW's administrator creates their account. Everything below was
executed against production on 2026-10-06 and works; where something does not work
yet it says so._

**Live URL:** https://startup-jury.jay-komarraju.workers.dev
(`app.startupjury.ai` is not live — it needs the DNS move in `docs/DEPLOY.md`.)

---

## Before the call — two minutes

| Check | Expect |
|---|---|
| `curl -s https://startup-jury.jay-komarraju.workers.dev/api/health` | `{"status":"ok"…}` |
| Open `/login` | **No** "Demo logins" card. If you see one, the deploy did not land. |
| Open `/signup` | The three-field form renders. |

**Global Carbon Warriors now have their own organisation, `t_gcw`, and it shares
nothing with the demo workspace.** Separate decks, roster, rubric, dashboard, audit
trail and credits. A `@globalcarbonwarriors.com` registration resolves to their
workspace automatically — verified live.

**Viiveck is already their Super User**, so you do not need our demo account on this
call at all. He approves his own team.

| | |
|---|---|
| Workspace | Global Carbon Warriors (`t_gcw`), slug `global-carbon-warriors` |
| Opens with | **0 decks** — theirs to populate |
| Rubric | the 23 parameters, 110 band anchors and 68 clarification questions, cloned |
| Sector | one, `Climatetech` — a single sector makes every upload auto-resolve |
| Programme | `Carbon Accelerator` / `Cohort 1`, theirs to rename |
| Credits | 2500, on a ledger that balances |
| Seats | 25 |

The demo workspace (`ai.STARTUPJURY Demo Workspace`, slug `default`) keeps its 23 QA
decks and the seven `@demo.startupjury.ai` logins. GCW cannot see any of it: measured,
a deck that exists there returns 404 to a GCW principal, including its PDF and report.

---

## The call, in order

### 1. They create their account (they drive)

Send them to **`/signup`**. Work email on `@globalcarbonwarriors.com`, their name, a
password of at least 8 characters.

They land on **"waiting for approval"**. That is correct and is the point: nothing
they typed decided which organisation they joined or what they can do. The tenant
came from their email domain, server-side, and the role is assigned by you.

Three things they may hit, all deliberate:
- a `@gmail.com` address is refused — personal addresses cannot self-register, and
  anyone on one has to be invited by an administrator instead;
- a different domain is refused with "ask your administrator for an invite";
- signing in before approval says so plainly rather than "wrong password".

### 2. Viiveck approves them

Viiveck signs in as **Super User** of their own workspace -> **Admin console ->
Team & roles**. The **"Waiting for approval"** card is at the top with a count.

He approves and **chooses the role**. The role is the administrator's to pick and
never came from the registrant — which matters, because only `jury` is scoped to its
own decks; every other staff role reads the whole workspace.

Our demo account plays no part in this. It is in a different organisation and cannot
see or touch theirs.

### 3. They sign in and take over

They can now sign in. Walk them through, in this order, because step 4 re-scores and
is free only while the workspace has few decks:

1. **Admin console → System → Branding** — their colours, wordmark and tagline. The
   organisation name is already **Global Carbon Warriors**.
2. **Programmes → Sectors** — add GCW's carbon sectors, retire the seeded EdTech /
   FinTech / SaaS ones. Do this **before** the first upload: when exactly one sector
   exists the intake auto-resolves to it.
3. **Programmes** — their cohorts. "Climate Cohort" already exists with their 23
   decks; "Fintech Accelerator" and "SaaS Accelerator" are demo leftovers to rename
   or retire.
4. **Core Parameters** — the 13 weighted areas and their weights. The seeded rubric
   is already a climate rubric and includes "Climate Impact & Integrity" at weight
   10, so this is tuning rather than authoring. They cannot add a 14th weighted
   parameter — only rename the 13 and add up to 3 unweighted per role.
5. **My account → Change password**, and **Out of office** if they want it.

### 4. Their team joins

Everyone else on `@globalcarbonwarriors.com` self-registers at `/signup` and the
administrator approves them with the right role. Anyone on a personal address has to
be invited from **Team & roles** instead; the invite shows a one-time password on
screen for the administrator to pass on, because email does not send yet.

---

## What works, and what does not

**Works, verified on production today:** registration with domain resolution and the
approval queue; login telling the truth about pending, disabled and
more-than-one-workspace; change password; forgot/reset password *as far as minting
and storing a single-use token*; out-of-office with a delegate who can open and
submit the work they cover; 2500 evaluation credits on a ledger that balances; the
deck pipeline, AI scoring and the evaluation report.

**Does not work yet, and do not promise it on the call:**

- **No email is delivered.** `EMAIL_FROM` is empty, so a forgot-password link is
  minted, hashed and stored — and never sent. Anything the product says is "sent" is
  a row in `email_outbox` with status `recorded`. Password recovery today is
  administrator-mediated: **Team & roles → reset password**, which shows the new
  password on screen. Fixing this needs the zone on Cloudflare first.
- **`app.startupjury.ai` does not resolve.** `docs/DEPLOY.md` §2–§3. The zone move
  is scheduled work, not a same-day change: `startupjury.ai` is registered at GoDaddy
  but served by Hostinger, the apex is a live site and the MX is Google Workspace, so
  a nameserver flip without recreating every record first takes down company email.
- **No payment.** The credit top-up in the console is an operator grant, not a sale.

## On a phone

The demo is driven in **portrait**. Stay there — landscape is the worst case. Page a
deck from the thumbnail strip rather than the full-screen lightbox. Do not reach for
"Notify by email" on Assign: it defaults on, the help launcher overlaps it, and it
would not send anything anyway.

## If something goes wrong

- **Bad deploy:** `npx wrangler rollback` — seconds, and it does not touch data.
- **Bad data:** the pre-wave D1 restore point is in `docs/DEPLOY.md` §5b. A restore is
  whole-database and takes every tenant back with it.
- **A screen says "Invalid email or password" and the password is right:** that used
  to mean a server error too. It no longer does — pending, disabled and
  two-workspace cases now say what they are. If you still see it, the password is
  genuinely wrong.
