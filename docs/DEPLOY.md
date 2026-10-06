# Deploy, cut-over and rollback — ai.STARTUPJURY

_Operations runbook. `docs/plan_parity.md:797-820` names this as **W13-C** ("the
operations runbook — deploy, rollback, restore, rotate, on-call") and the wave was
never started; this is the deploy/cut-over half of it. The demo script is
`docs/DEMO-RUNBOOK.md`._

Everything below was **measured on 2026-10-05**, against `main@defbc76`, the live
Worker at `https://startup-jury.jay-komarraju.workers.dev`, and public DNS. Each
claim carries the command that produced it or a `file:line`. Where a step needs a
human in a browser it says so, because none of it can be driven from the repo.

**Node 22 in every shell:**

```bash
export PATH="$HOME/.nvm/versions/node/v22.23.1/bin:$PATH"
```

---

## 0. The two-minute version

| | |
|---|---|
| **Deploy today** | `npm run db:migrate:remote` → check → `npm run deploy`. §4. |
| **`app.startupjury.ai`** | Needs the whole `startupjury.ai` zone moved to Cloudflare. Not a same-day change. §2, §3. |
| **Email delivery** | Needs a sending domain onboarded in the dashboard, which needs the zone on Cloudflare first. §5. |
| **Rollback** | Worker: `npx wrangler rollback`, seconds. DNS: up to **6 hours**, measured. §3.6. |

**Do not do the DNS cut-over on the day of a demo or a customer call.** The reason
is in §3.6 and it is a measured number, not caution.

---

## 1. What is deployed, and the one thing that is not

One Worker, one environment. `wrangler.jsonc` has **no `env` block** — there is no
staging. A deploy goes straight to the surface the customer uses.

Bindings that must exist in the account before a deploy that references them
(all three already do, noted here because a new account would fail on them):

| Binding | Resource | Created by |
|---|---|---|
| `DB` | D1 `startup-jury-db` | `wrangler d1 create` |
| `SESSIONS` | KV | `wrangler kv namespace create` |
| `DECKS`, `HELP_MEDIA` | R2 buckets | `wrangler r2 bucket create` |
| `EVAL_QUEUE` + `startup-jury-evals-dlq` | Queues | `wrangler queues create` (both; the DLQ is a separate create — see the comment at `wrangler.jsonc`'s consumer block) |
| `EMAIL` | Email Sending | binding deploys fine with no domain; delivery is separately gated, §5 |

### The deployed bundle is behind HEAD, measured

```
$ curl -s https://startup-jury.jay-komarraju.workers.dev/ | grep assets/
  src="/assets/index-XffRqztI.js"
$ curl -s …/assets/index-XffRqztI.js | grep -c -F demo1234
2
$ … grep -c -F '@demo.startupjury.ai'
12
$ … grep -c -F 'Demo logins'
1
```

`index-XffRqztI.js` is a build of `main@ff62f12`, and that is not an inference: a
local `npm run build` at `ff62f12` emits
`dist/client/assets/index-XffRqztI.js`, **1,274,550 bytes, sha256
`2f81f5260a5edb3b1e2500cf6394c1bf84075f5f8e3bcc0c17d500153f70ee69`**, which `cmp`
reports byte-identical to the file production serves.

**So `defbc76` — which put the demo-logins card behind `import.meta.env.DEV` and
applied the five phone fixes (`docs/plan_pilot_gcw.md` §11) — is not deployed.**
Until it is, the production login page still prints twelve working addresses and
the shared password `demo1234` to anyone who opens it.

The useful corollary of a reproducible build: **after any deploy, diff the hash.**
If `curl`'s `assets/index-*.js` does not match what `npm run build` just produced,
the edge is serving something other than what you shipped.

Hiding the card does **not** revoke the credential. The twelve accounts and their
one shared hash (`migrations/0002_seed.sql:45-56`) stay live in production D1, and
`scripts/smoke.mjs:20` signs in with them on purpose. Removing or rotating them is
`docs/plan_parity.md`'s W13-A ("demo seed logins gated or removed") and is not in
this document.

---

## 2. `app.startupjury.ai` — what it actually takes

### 2.1 Measured: who serves this domain today

```
$ whois startupjury.ai | grep -iE 'Registrar:|Name Server|Domain Status'
Registrar: GoDaddy.com, LLC
Name Server: nova.dns-parking.com
Name Server: cosmos.dns-parking.com
Domain Status: clientDeleteProhibited / clientRenewProhibited
Domain Status: clientTransferProhibited / clientUpdateProhibited
$ dig +short SOA startupjury.ai
nova.dns-parking.com. dns.hostinger.com. …
```

**The registrar is GoDaddy; the authoritative DNS is Hostinger.** Those are two
different vendors and two different logins, and the distinction is the most
likely way this cut-over goes wrong:

- **Nameservers** are changed at **GoDaddy** (it holds the delegation).
- **The records themselves** live at **Hostinger** (`nova`/`cosmos.dns-parking.com`
  are Hostinger's parking nameservers; the SOA contact is `dns.hostinger.com`).

Someone who logs into GoDaddy to "look at the DNS" will see a near-empty zone,
conclude there is nothing to migrate, flip the nameservers — and take down both
the marketing site and the company's email. Pull the record list from Hostinger's
hPanel, or from the live zone as captured below.

### 2.2 Measured: the live zone, which is what must be recreated

```
$ dig +noall +answer startupjury.ai A AAAA MX TXT
$ dig +noall +answer www.startupjury.ai A
$ dig +short TXT google._domainkey.startupjury.ai
$ dig +short TXT _dmarc.startupjury.ai
```

| Name | Type | Value | TTL | Proxy on import |
|---|---|---|---|---|
| `startupjury.ai` | A | `82.25.123.37` | 1800 | **DNS only** |
| `startupjury.ai` | AAAA | `2a02:4780:57:10:4c2b:708f:3782:ccaf` | — | **DNS only** |
| `www` | CNAME | `startupjury.ai.` | 300 | **DNS only** |
| `startupjury.ai` | MX | `1 smtp.google.com.` | 3600 | n/a |
| `startupjury.ai` | TXT | `google-site-verification=Y6tRknUtSlXsdA6k67HXzYLyLsNrio-jhABR4y-ZJ9I` | 3600 | n/a |
| `startupjury.ai` | TXT | `v=spf1 include:_spf.google.com ~all` | 3600 | n/a |
| `google._domainkey` | TXT | `v=DKIM1;k=rsa;p=MIIBIjANBgkq…` (2048-bit, **two quoted strings**) | — | n/a |
| `_dmarc` | TXT | `v=DMARC1; p=none; rua=mailto:postmaster@startupjury.ai, mailto:dmarc@startupjury.ai; pct=100; adkim=s; aspf=s` | — | n/a |
| `autodiscover` | CNAME | `autodiscover.mail.hostinger.com.` | — | DNS only |
| `app` | — | **does not resolve** | — | — |

Four things in that table are load-bearing:

1. **The apex is a live website**, not a parking page: `curl -I https://startupjury.ai/`
   returns `200`, `server: hws`, `platform: hostinger`, 54,996 bytes, last modified
   2026-09-28. If the A/AAAA records are not recreated exactly, the marketing site
   goes dark.
2. **Company email is Google Workspace** (`MX 1 smtp.google.com` is the modern
   single-record form). MX + SPF + the Google DKIM key + the site-verification TXT
   all have to survive, or **mail stops**. This is a bigger blast radius than the
   subdomain we are trying to add.
3. **Set the apex and `www` records to "DNS only" (grey cloud) at import.**
   Cloudflare defaults imported A/AAAA/CNAME records to **proxied**, which puts
   Cloudflare in front of a Hostinger origin it has never been tested against and
   makes the TLS mode (`Full` vs `Flexible`) suddenly matter. Grey-cloud keeps the
   marketing site behaving byte-for-byte as it does today, and the cut-over then
   changes exactly one hostname.
4. **`app` does not resolve.** That is good news: Cloudflare refuses to create a
   Custom Domain "on a hostname with an existing CNAME DNS record"
   (developers.cloudflare.com/workers/configuration/routing/custom-domains/), and
   there is nothing in the way. Do not create an `app` record by hand — Cloudflare
   creates it, §3.4.

There is **no CAA record** (`dig +short CAA startupjury.ai` → empty), so nothing
restricts which CA may issue for `app.`, and Cloudflare's certificate will issue.

### 2.3 Why the zone has to move — the three options, and the two that are closed

Verified against current Cloudflare documentation on 2026-10-05, not from memory:

- A Workers **Custom Domain** requires "an active Cloudflare zone", and "you
  cannot create a Custom Domain … on a zone you do not own".
  (developers.cloudflare.com/workers/configuration/routing/custom-domains/)
- A Workers **Route** also requires an active Cloudflare zone, plus a proxied DNS
  record for the hostname. (developers.cloudflare.com/workers/configuration/routing/)
- **Partial (CNAME) setup** — the way to get a zone onto Cloudflare without moving
  nameservers — is **Business and Enterprise plans only**.
  (developers.cloudflare.com/dns/zone-setups/partial-setup/)
- **Subdomain setup** — `app.startupjury.ai` as its own Cloudflare zone, delegated
  by NS records at the parent — is **Enterprise only**.
  (developers.cloudflare.com/dns/zone-setups/subdomain-setup/)

So:

| Option | Gets us `app.startupjury.ai`? | Verdict |
|---|---|---|
| **A. Full setup** — move `startupjury.ai` nameservers to Cloudflare at GoDaddy | Yes | **The only path on a Free/Pro plan.** §3. |
| **B. Partial (CNAME) setup** at Hostinger | Yes | Closed: Business+ only. |
| **C. Subdomain zone** + NS delegation at Hostinger | Yes | Closed: Enterprise only. |
| **D. CNAME `app` → `…workers.dev` from Hostinger** | **No** | Does not work. Cloudflare has no way to map an arbitrary SNI/Host to a specific Worker, so the request arrives with a `*.workers.dev` certificate mismatch and no route. Rejected — do not try this on the call. |
| **E. Keep `…workers.dev`** | No | Zero risk, zero work, ugly URL. **This is the fallback for any call that happens before the cut-over window.** |
| **F. HTTP redirect** `app.` → workers.dev, served by Hostinger | Cosmetically | The address bar shows `workers.dev` from the first navigation onward, and the session cookie is set on that host. Worse than E, not better. |

Cloudflare for SaaS / custom hostnames would also work and is a paid product for a
different problem (serving *your customers'* domains). Out of scope.

---

## 3. Option A — the cut-over, in order

Read §3.6 before starting. The whole sequence is reversible, but not quickly.

### 3.1 Before the window opens (no risk, do this any time)

1. **Capture the zone.** Run the `dig` commands in §2.2 and keep the output. This
   is the rollback source of truth; do not rely on anyone's memory of hPanel.
2. **Lower the record TTLs at Hostinger** to 300s for the apex A/AAAA, `www` and
   MX. It does not speed up the nameserver change (§3.6) but it makes a *record*
   correction propagate in five minutes instead of an hour.
3. **Confirm who can log into GoDaddy and Hostinger.** Both, with 2FA, in the
   room. A cut-over blocked on a password reset is the common failure.
4. **Check the GoDaddy locks.** `whois` shows `clientUpdateProhibited` and
   `clientTransferProhibited`. These four codes are GoDaddy's defaults on every
   domain and its own dashboard changes nameservers through them; if the UI
   refuses the change, that lock is the reason, and it is toggled under the
   domain's own settings. We did not attempt it — nobody should log into the
   registrar from a build agent.

### 3.2 Human, in a browser: add the zone to Cloudflare (still no risk)

Adding a zone changes nothing until the nameservers move. This step is safe and
should be done *and reviewed* before the window.

1. Cloudflare Dashboard → **Add a domain** → `startupjury.ai` → Free plan.
2. Cloudflare scans the existing zone and pre-fills records. **Check every row in
   §2.2 against what it imported.** The scan is best-effort — it can only find
   names it thinks to ask for, and `_dmarc`, `google._domainkey` and
   `autodiscover` are exactly the kind it misses.
3. **The DKIM TXT is the one to inspect character by character.** It is 2048-bit,
   longer than the 255-byte TXT string limit, and therefore stored as two quoted
   strings. A truncated or re-wrapped key fails DKIM silently — mail still sends,
   it just starts failing authentication. Paste it from the `dig` output, never
   retype it.
4. **Set the apex A, apex AAAA and `www` CNAME to "DNS only"** (grey cloud). See
   §2.2 note 3.
5. Note the two assigned Cloudflare nameservers. They are per-account.
6. Leave the zone **Pending**. Do not move on yet.

### 3.3 Human, in a browser: flip the nameservers at GoDaddy

**This is the irreversible-for-6-hours step.** GoDaddy → the domain →
**Nameservers** → change from `nova.dns-parking.com` / `cosmos.dns-parking.com`
to the two Cloudflare nameservers from §3.2.5. Cloudflare's zone flips from
Pending to Active once it sees its own delegation at the registry — minutes to a
few hours.

Until that moment, and for up to 6 hours afterwards, **some resolvers answer from
Hostinger and some from Cloudflare.** If the records match exactly, that window is
invisible. If they do not, it is an intermittent outage that looks like a caching
bug. This is the whole reason §3.2.2 matters.

**Verify before going further:**

```bash
dig +short NS startupjury.ai                      # expect the Cloudflare pair
dig +short A startupjury.ai                       # expect 82.25.123.37
dig +short MX startupjury.ai                      # expect 1 smtp.google.com.
curl -sI https://startupjury.ai/ | head -3        # expect 200, platform: hostinger
```

**Then have a human send and receive one real email on the domain.** Not a DNS
lookup — an actual message, both directions. Nothing else proves Google Workspace
survived.

### 3.4 In the repo: point the Worker at the hostname

Two lines in `wrangler.jsonc`, both shipped commented out so that a deploy *today*
cannot fail on a hostname that does not resolve. **Uncomment them together** — a
route without the matching `APP_BASE_URL` mints founder links on the old host.

1. The `routes` entry, immediately after `"main"`:

   ```jsonc
   "routes": [{ "pattern": "app.startupjury.ai", "custom_domain": true }],
   ```

2. Swap `vars.APP_BASE_URL` to `"https://app.startupjury.ai"` (the commented
   alternative sits directly below the live value).

Then `npm run deploy`. Wrangler creates the Custom Domain and its DNS record and
Cloudflare issues the certificate. A deploy with this route in place against a
zone the account does not hold fails the deploy — which is precisely why it ships
inert, and why §3.3 comes first.

### 3.5 Verify

```bash
curl -sI https://app.startupjury.ai/ | head -5                 # 200, text/html
curl -s  https://app.startupjury.ai/api/health                 # {status,service,time}
curl -s  https://app.startupjury.ai/ | grep -o 'assets/[^"]*'  # matches the local build
curl -sI https://startup-jury.jay-komarraju.workers.dev/ | head -3   # still 200
```

The workers.dev hostname keeps working **because `wrangler.jsonc` sets
`workers_dev: true` explicitly**, and that line is load-bearing rather than
decorative: `workers_dev` defaults to `true` only while the configuration has no
`route`/`routes`, and to **`false`** once one exists. Without it, the very deploy
that adds the custom domain would silently retire the fallback URL — the one this
runbook tells a presenter to use, and the only host that works until the zone move
completes. It ships uncommented for that reason, and it is a no-op until the route
is enabled. Then open the app in a real
browser on the new host and sign in: the console must be clean (the CSP's
`script-src 'self'` is the one directive e2e cannot prove —
`src/server/security.ts:76-77`), and the deck viewer must render a PDF.

### 3.6 Roll back

| Layer | How | How long |
|---|---|---|
| Worker code | `npx wrangler rollback` | seconds |
| The route | remove the `routes` entry, re-comment `APP_BASE_URL`, `npm run deploy`; delete the Custom Domain under the Worker's **Settings → Domains & Routes** | a minute. The Advanced Certificate is **not** deleted with it and must be removed by hand from SSL/TLS |
| DNS records | fix them in Cloudflare | TTL, so ~5 min if §3.1.2 was done |
| **The nameserver change** | point GoDaddy back at `nova`/`cosmos.dns-parking.com` | **up to 6 hours** |

That last number is measured, not assumed:

```
$ dig @v0n0.nic.ai startupjury.ai NS +noall +answer
startupjury.ai.   21600   IN   NS   cosmos.dns-parking.com.
startupjury.ai.   21600   IN   NS   nova.dns-parking.com.
```

**21600 seconds = 6 hours** is the TTL the `.ai` registry serves on the delegation.
Resolvers that cached the Cloudflare nameservers keep using them for that long
after a rollback. There is no way to shorten it from either vendor.

**Therefore: do the cut-over at the start of a day with no customer commitments,
with both vendor logins in the room, and with someone who can send a test email on
the domain.** Not before a demo, and not on a Friday.

### 3.7 Knock-ons at cut-over — four, all measured

1. **Everyone is signed out, once.** The session cookie is host-only: `setCookie`
   at `src/server/routes/auth.ts:164-170` sets `httpOnly`, `sameSite: "Lax"`,
   `path: "/"` and **no `Domain` attribute**, so a cookie issued on
   `startup-jury.jay-komarraju.workers.dev` is not sent to `app.startupjury.ai`.
   One sign-in, cosmetic — but do not discover it on stage.

2. **`APP_BASE_URL` is hardcoded in two places as a fallback.** Not owned by this
   lane; reported for whoever owns them:
   - `src/server/resubmit.ts:93-96` — `resubmitLink()` falls back to
     `"https://startup-jury.jay-komarraju.workers.dev"`.
   - `src/server/routes/users.ts:119-122` — `loginUrl()`, "Mirrors `resubmitLink`'s
     base resolution", same literal.

   Setting the var is enough for correct behaviour (`env.APP_BASE_URL ||` wins), so
   nothing breaks. But the fallback is now wrong in a way that only shows up if the
   var is ever unset, and it bakes a retired hostname into founder-facing emails.
   Both should become a single shared constant or a hard failure.

3. **No `Strict-Transport-Security`.** Measured on production:

   ```
   $ curl -sD - -o /dev/null https://startup-jury.jay-komarraju.workers.dev/
   content-security-policy: …   referrer-policy: …   x-content-type-options: nosniff
   ```

   No HSTS header. `src/server/security.ts:113-124` sets exactly three headers (CSP
   on HTML documents only). Not owned by this lane. HSTS was *fine* to omit on
   `*.workers.dev` — that domain is on the preload list already — and becomes worth
   adding on a domain we control. The one line, for whoever owns that file:
   `out.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")`.
   **Do not add `preload`**, and do not set `includeSubDomains` until after the
   cut-over: on `startupjury.ai` it would pin *every* subdomain to HTTPS, including
   any the marketing site adds later.

4. **No `X-Robots-Tag`, and `/robots.txt` returns the SPA.** Measured:
   `curl -D - https://…/robots.txt` → `200`, `content-type: text/html`,
   `content-length: 491`, same `etag` as `/` — it is the single-page-application
   fallback (`wrangler.jsonc` `assets.not_found_handling`). An unparseable
   robots.txt is treated as "crawl everything". On `workers.dev` that is nearly
   harmless; on `app.startupjury.ai`, next to a marketing site that *wants* to be
   indexed, a customer's login surface should not be. Not owned by this lane:
   whoever owns `src/server/index.ts` should add a real `GET /robots.txt`
   (`User-agent: *` / `Disallow: /`) and `src/server/security.ts` an
   `X-Robots-Tag: noindex, nofollow` on HTML documents.

---

## 4. The deploy path, and the step it was missing

### 4.1 The scripts

`package.json`'s `deploy` was `vite build && wrangler deploy` with **no remote
migration**, and there was **no remote-migration script at all**, while
`docs/plan_parity.md:819` says to apply migrations `--remote` *first*. Two scripts
are added:

```
"db:migrate:remote:list":  "wrangler d1 migrations list startup-jury-db --remote"
"db:migrate:remote":       "wrangler d1 migrations apply startup-jury-db --remote"
```

### 4.2 Why a migration is not chained into `deploy`

It would be one character of JSON to write `"deploy": "npm run db:migrate:remote && vite build && wrangler deploy"`,
and it is deliberately not done:

- **A migration against production D1 is not a side effect of a build.** It is the
  one step in this repo that can destroy customer data, and this project has
  already shipped migrations that did. `migrations/0101`'s own header records the
  case: five earlier migrations left a transitional unique index standing, which
  turned nine `ON CONFLICT` upserts into silent cross-tenant overwrites that
  returned `200`, and all five headers had predicted the opposite — "a loud, safe
  error". A migration should be typed on purpose by someone who has read the
  pending SQL, not executed as a step in a build.
- **It is not idempotent in effect, only in bookkeeping.** `d1 migrations apply`
  skips files already in `d1_migrations`, so a *re-run* is safe — but a *first* run
  of a bad file is not, and chaining it means the first time anyone ever executes
  it is as a side effect of a deploy they were thinking about differently.
- **The orderings differ.** Migrations must land *before* code that depends on
  them, and that means a human decides, per release, whether the schema change is
  backwards-compatible with the running Worker. A script cannot.
- **Precedent:** the deployed D1 has drifted behind the repo at the end of
  essentially every wave of this project, which is why `db:migrate:remote:list` is
  a named step and not a footnote. Run it, read it, then decide — do not automate
  past the one place a human is supposed to look.

### 4.3 The procedure

```bash
export PATH="$HOME/.nvm/versions/node/v22.23.1/bin:$PATH"

# 1. Gate. All four green, no exceptions.
npm run typecheck && npm run lint && npm test && npm run build

# 2. What would the migration do? Read the pending files before applying them.
npm run db:migrate:remote:list          # expect: nothing pending, or a list you have read

# 3. Only if step 2 listed something. Answer the prompt yourself.
npm run db:migrate:remote

# 4. Confirm it landed, then ship the code.
npm run db:migrate:remote:list          # expect: no pending migrations
npm run deploy

# 5. Post-deploy.
npm run smoke
curl -s https://…/ | grep -o 'assets/index-[^.]*\.js'   # note the hash
curl -s https://…/assets/index-<hash>.js | grep -c -F demo1234   # expect 0
```

The repo is at `migrations/0104_billing_address.sql`. Production was at `0104` when
this was written, so a deploy today should list nothing pending — **confirm it, do
not assume it.**

`npm run smoke` currently reports **6 failures that are not regressions.** It
defaults to production (`scripts/smoke.mjs:14-18`) and six of its checks assert on
fixtures the 2026-09-30 clear deleted (`?q=FinStack`, `call_seed_wealthos_intro`,
the two NimbusHR resubmit tokens, a deck in state `failed`, a deck in the PM
decision queue). A sibling measured **48 passed, 6 failed**, with nothing failing
in the authZ, security-header, auth-gate or cross-edition blocks. Read the names of
the failures; do not read the count.

---

## 5. Email — why nothing is delivered, and how to change that

### 5.1 The gate

`wrangler.jsonc`'s `vars.EMAIL_FROM` is `""`. `emailDeliveryConfigured`
(`src/server/email/outbox.ts:257-259`) is `Boolean(env.EMAIL && env.EMAIL_FROM?.trim())`,
so with the var empty **every message is written to `email_outbox` with
`status='recorded'` and nothing is dispatched.** That is deliberate and it fails
closed: `POST /api/users` checks the gate and hands the operator the temporary
password to relay by hand rather than entrusting a new account's only credential
to a transport that is not delivering.

Consequences to know: a forgot-password link cannot reach anyone, and anything the
UI calls "sent" is a database row. The working path for a credential today is the
admin-mediated `POST /api/users/:id/reset-password`, which returns the temporary
password in its response when delivery is unconfigured.

### 5.2 Onboarding the sending domain

**The domain must already be a zone in the Cloudflare account** — Cloudflare's own
wording is that you choose the domain "from your Cloudflare account". So **§3.3 is
a prerequisite for this whole section.** Email delivery cannot be turned on while
DNS is at Hostinger.

**Do it in the dashboard.** A CLI path exists — wrangler 4.110.0 ships
`email sending enable <domain>` ("Enable Email Sending for a zone or subdomain")
and `email sending dns` — but **the OAuth token on this machine lacks the email
scope**: `npx wrangler email sending list` returns `Unauthorized [code: 2036]`.
Using the CLI therefore means a fresh `npx wrangler login` to re-consent with that
scope, and a build agent should not be re-consenting an account's OAuth grant. The
dashboard also shows the records it is about to add, which on a zone carrying live
Google Workspace mail is the point.

1. Dashboard → **Compute & AI** → **Email Service** → **Email Sending** →
   **Onboard Domain**.
2. **Choose a subdomain, not the apex: `mail.startupjury.ai`.** Onboarding adds
   `cf-bounce` MX records, an SPF TXT (`v=spf1 include:_spf.mx.cloudflare.net ~all`),
   a DKIM TXT on `cf-bounce._domainkey`, and a DMARC TXT on `_dmarc.<domain>`.
   Cloudflare's own documentation is that "Email Sending treats a subdomain as a
   separate sending domain", which keeps all of that off the apex — and the apex
   already carries a Google Workspace MX, a Google SPF include, a Google DKIM key
   and a `_dmarc` record (§2.2). Onboarding the apex would put a second `_dmarc`
   TXT where one already exists. **Do not.**

   The existing apex policy is `p=none; adkim=s; aspf=s`. Strict alignment means
   the DKIM `d=` must equal the From domain exactly, which the subdomain satisfies
   (`d=mail.startupjury.ai` signing `…@mail.startupjury.ai`), and it inherits
   `p=none` because the apex record sets no `sp=`. So nothing is rejected either
   way; the subdomain is simply the only option that does not edit a record the
   client's email already depends on.

   *Noted in passing, for whoever recreates it:* the apex `rua` value is
   `mailto:postmaster@…, mailto:dmarc@…` — with a space after the comma, which
   RFC 7489's URI list does not allow. Tolerated by most parsers. The cut-over
   retypes this record anyway; drop the space while you are in there.
3. Approve the records. Cloudflare adds them to the zone itself. Verification
   usually completes in 5–15 minutes on Cloudflare DNS.
4. Set the var in `wrangler.jsonc` and redeploy:

   ```jsonc
   "EMAIL_FROM": "no-reply@mail.startupjury.ai",
   "EMAIL_FROM_NAME": "ai.STARTUPJURY",
   "EMAIL_REPLY_TO": "",          // optional; a real monitored mailbox or nothing
   ```

   `npm run deploy`. **No code change is needed** — the binding and every call site
   already exist.
5. Verify end to end: trigger one real send (the admin-mediated password reset is
   the smallest), then read the row back and check it is not `recorded`:

   ```bash
   npx wrangler d1 execute startup-jury-db --remote \
     --command "SELECT kind, to_email, status, error FROM email_outbox ORDER BY created_at DESC LIMIT 5;"
   ```

   `status='sent'` with a message id, and the message in the inbox. If it is
   `failed`, the reason is in that row — the outbox never throws on a delivery
   failure (`outbox.ts:261-266`), so a misconfigured domain degrades to an
   auditable no-send rather than breaking the flow that triggered it.

A zone supports at most 30 domains across Email Routing and Email Sending
combined, apex included — not a constraint here, recorded so nobody rediscovers it.

---

## 5b. Restore points — the D1 bookmarks, kept HERE and not in anyone's notes

D1 time-travel is the only rollback the database has, and a bookmark is useless if
nobody can find it. Until 2026-10-05 every bookmark this project ever took lived in
a Claude memory file outside the repo, and all three predated the state they would
have restored — using one would have undone migration `0104`, the 3-Oct fixes and
the pilot customer's 23 decks.

**Two things to know before using any of these.** A restore is WHOLE-DATABASE and
point-in-time: it takes every tenant back with it, and it cannot restore one
workspace. And R2 is not covered at all — the deck PDFs are not versioned, so a
restore recovers the rows and relies on the objects still being there, which holds
only because nothing in the product deletes an R2 object.

| Taken | State it returns to | Bookmark |
|---|---|---|
| 2026-10-05, immediately before `0105`–`0108` | D1 at `0104`; GCW's 23 decks present; workspace still named "Anthill Ventures Incubator"; credits 0; no registration schema | `00001e4b-00000000-000050fb-3c5f25423dc6ed1613d839a58250a10e` |

```bash
npx wrangler d1 time-travel restore startup-jury-db --bookmark=<bookmark>
```

Take a fresh one before every migration that touches production, and add the row
here in the same change:

```bash
npx wrangler d1 time-travel info startup-jury-db
```

The Worker itself rolls back separately and in seconds — `npx wrangler rollback` —
and that is almost always the right first move, because a bad deploy is far more
likely than a bad migration and reverting code does not touch data.

## 6. Open items this document does not close

- **W13-A security**, untouched: no rate limiting anywhere (40 wrong-password
  logins returned 401 forty times in 292ms), `tempPassword()`
  (`src/server/routes/users.ts:111-113`) is ~24 bits and never expires, and a
  removed admin's KV session keeps working for 7 days
  (`src/server/auth/middleware.ts:15-22`, `src/server/auth/session.ts:6`).
- **The twelve seeded demo logins are still live in production D1** (§1). Hiding
  the card is not revoking the credential.
- **HSTS, `X-Robots-Tag`, `/robots.txt`** — §3.7, files this lane does not own.
- **The two hardcoded `APP_BASE_URL` fallbacks** — §3.7.2, files this lane does not
  own.
- **No staging and no rehearsed D1 restore.** `wrangler.jsonc` has no `env` block,
  so every deploy is to production, and `plan_parity.md`'s W13-B ("a backup and
  restore path for D1 with a **rehearsed restore**") has never been exercised. Take
  a D1 time-travel bookmark before any migration and write it down —
  `npx wrangler d1 time-travel info startup-jury-db` — because
  `d1 time-travel restore` needs a bookmark or a timestamp and the window is 30
  days, not forever.
