# The re-shared My Account — build plan

**Scoped 2026-09-23 against `96a1465`.** Produced by a six-agent pass over
`docs/prototype/source/incubator/AISJ_MyAccount.HTM` (303,349 B, sha256 `d5905060…908b11`, committed
byte-identical to the file the client sent): a screen-by-screen diff against the build, an
investigation of the two screens this re-share deletes, the payment flow, the sign-up chain against
the Set up wizard we narrowed on 21-Sep, and the test/VC/migration blast radius. Three agents died
on network errors in the first run and were resumed; all six reported.

Companion to `docs/plan_v3_superuser.md` (the superuser work, incl. §12.6 which this re-share partly
invalidates) and `docs/plan_roles_incubator.md` (the four-role extension).

**Established at import, ahead of the scoping, and not re-derived below:**

- **The live flow is USD throughout.** The file defines both `rupee()` and `usd()` and calls each
  about twenty times, which reads as a half-finished migration. It is not: the rupee renderers
  (`renderOrgPlans`, `renderPacks`, `renderIPeriods`) target `itiers`, `iprice`, `iperiods`,
  `ac-orgplans` and `ac-packs`, and **every one of those appears only inside JavaScript with zero
  `id=` attributes in the markup**. They have nothing to render into — dead code for the two screens
  this re-share deletes.
- **GST is still charged at 18% on those USD totals.** That contradicts a rule we built on purpose:
  `src/shared/plans.ts:200` fixes `BASE_CURRENCY = "INR"` with the comment *"GST is the INR-billing
  tax"*, and `e2e/account-purchase.spec.ts:145` is titled *"…(USD, no GST)"*. It needs the client's
  answer, not a guess — either it is copy that survived the currency switch, or they are still
  billing Indian customers and only the display changed, and those are different tax regimes.
- **Our build is entirely INR today**: 82 hardcoded `₹` across 21 files, and zero dollar amounts in
  `src/`.

---

# Build plan — re-shared **My Account** (`AISJ_MyAccount.HTM`, 2026-09-23)

**Source:** `docs/prototype/source/incubator/AISJ_MyAccount.HTM` (303,349 bytes, 3,520 lines, sha256 `d59050605aa0062d94f3d7f0ac331e644987bfc93154718439f0e43f71908b11`).

**Correction to all four scoping reports before anything else:** they each recorded the file as untracked. It is now **committed** — `96a1465 Commit the re-shared My Account prototype`; `git ls-files` returns it and `git status --porcelain` is empty. Worktrees will see it. No import step is needed, and `~/Downloads/AISJ_MYACCOUNT$.HTM` is byte-identical, so there is no second copy to chase.

---

## 1. What actually changed

**Most of the screens survive; the thing underneath them does not.** Six of the ten screens in the re-share are ones we already built and they still match — Create your account, What best describes your organisation, Tell us about your organisation, the 3-deck free trial, Complete payment and Payment successful are all still there, mostly word-for-word against what is in the build today. Three screens are genuinely new and unbuilt: **Nominate your super user**, **Annual subscription** and **Enterprise Plans**. One screen, Add your team, is drawn but unreachable in the prototype and always has been — it is not work.

**Two screens we shipped eleven days ago have been deleted by the client.** *Choose your seat* (`acs-plan`) and *Choose your Enterprise plan* (`acs-orgplan`) do not exist in the new file — `grep 'acs-plan'` and `grep 'acs-orgplan'` both return zero. Those are `SeatScreen` (`src/client/routes/account/AccountScreens.tsx:1054`) and `EnterpriseSeatScreen` (`:1188`), built in session S3-ACCOUNT item 14 and recorded in `docs/plan_v3_superuser.md` §12.6. Both are now orphaned. Say this to the client plainly: **we built two screens that their re-share removes, and the components, their tests and their seeded prices go with them.**

**The expensive part is not the screens — it is that the pricing model changed shape.** The old model was *pick one SKU from a 3×3 grid* (three seat tiers × quarterly/half-yearly/annual), priced from one catalogue row, stored as one order row. The new model is a **cart**: a base line of "1 Premium Seat — Annual · 125 Credits included" at `$535` that is always charged, plus quantity steppers for three add-on seat tiers and six credit packs — up to ten priced lines in a single order (`AISJ_MyAccount.HTM:2791-2829`, `annTotal()` at `:3320`). Quarterly and half-yearly billing vanish entirely. Every price on every new screen is **USD** (`usd()`, `:3013`) and carries a **hard-coded `save` / "You save $X" discount** we have no column for — and the prototype charges **18% GST on those USD totals**, which directly contradicts a rule we built, documented and test (`e2e/account-purchase.spec.ts:145`, "*an organisation buys an annual plan through to a receipt (USD, no GST)*"). Migration `0073_seat_pricing_v3.sql` exists specifically to express quarter/half-year seat pricing; its thirteen seeded SKUs are consumed by **none** of the new screens. That is the real cost of this re-share: a catalogue and order-model rewrite with a migration, not a screen swap.

---

## 2. The screen table

| # | Screen | Status | Effort | The one sentence that decides it |
|---|---|---|---|---|
| 1 | `acs-account` "Create your account" | **Built, matches** | trivial | Heading, sub and both account-type options are verbatim (`AccountScreens.tsx:321,434,442` vs prototype `:2554-2555,2583-2584`); the only literal differences are the prototype's Password field (`:2578-2580`, correctly absent from an in-app overlay) and the trial strip we already suppress (`AccountOverlay.tsx:606`). |
| 2 | `acs-orgtype` "What best describes your organisation?" | **Built, matches** | trivial | Both option cards are word-for-word (`AccountScreens.tsx:484-502` vs `:2596-2600`); the only delta is that the prototype's footer is `<div class="ac-foot end">` with Continue only (`:2602-2604`) while we render a Back button — keep ours. |
| 3 | `acs-orgdetails` "Tell us about your organisation" | **Built, exit changes** | trivial | Every field and every option matches (`:2609-2680` vs `AccountScreens.tsx:568-660`, lists at `accountOrder.ts:138-160`); only the Continue target moves, from `orgplan` to the new `super` (`:2685`). |
| 4 | `acs-super` "Nominate your super user" | **NEW — not built** | small | Two fields and a hint (`:2691-2703`), no member of the `AccountScreen` union (`accountOrder.ts:47-58`) — but it is **not** our kept `nominateOnly` branch and it carries the upgrade detour (`acSuperNext:3058`, Back = `acGo(acUpgrading?'annual':'orgtype')`), so it needs a client answer on intent before it is coded (§7 Q5). |
| 5 | `acs-trial` "Your 3-deck free trial" | **Built, differs** | small | The counter, tiles and "Trial complete" fork all have equivalents, but the sub no longer names a chosen plan (`:2707`) because no plan is chosen before the trial any more, and the fork's first button is now **"Annual subscriptions"** → `acs-annual` (`:2717`) instead of our "Pay for the plan chosen" (`AccountScreens.tsx:1571-1573`). |
| 6 | `acs-team` "Add your team" | **Dead in the prototype — do not build** | none | `acGo('team')` has exactly one caller, `acRoleNext` (`:3108`), and `acRoleNext` is invoked from nowhere — its only other occurrence in 3,520 lines is the `window.` export at `:3506`, above the surviving comment `<!-- 3. ROLE (removed from flow) -->` (`:2727`). |
| 7 | `acs-paidtrial` "Try a paid trial" | **Built, differs materially** | medium | The heading matches and everything below it changed: five rate-multiplied packs `[10,20,30,40,50]` (`accountOrder.ts:609`) become **two fixed SKUs**, q25 `$117` and q50 `$210 (save $24)` (`:2996`, rendered `:3301-3314`), each with "Valid for a quarter" and "decks + reports + platform fees" — our `pp_paid_trial` would quote 25 credits at $30, not $117. |
| 8 | `acs-annual` "Annual subscription" | **NEW — not built** | **large** | It is a ten-line cart with a mandatory `$535` base bundle, three seat steppers at `$30/$45/$60` and six credit-pack steppers with savings badges, plus a live 18% GST total (`:2791-2829`, `:3320-3333`) — a radiogroup does not become a cart, and `account_orders` (`0053:60-75`) cannot store it. |
| 9 | `acs-entplans` "Enterprise Plans" | **NEW — not built** | medium | Two fixed bundles from `ENTPLANS` (`:2928-2931`) — Basic `$4,020` / 5 seats / 1,500 credits / save `$3,300`, Basic plus `$5,480` / 10 / 2,000 / save `$4,480` — structurally the closest thing to a rename of `EnterpriseSeatScreen`, but with no seat ladder, no extra-credit picker, no trial button, a new compare-at field and a new entry point (from `acs-annual`, both branches, not from org details). |
| 10 | `acs-payment` "Complete payment" | **Built, back-link differs** | small | Heading, sub and the two-column order summary match verbatim (`AccountScreens.tsx:1799,1861` vs `:2847-2848`); only `acPayBack` changes (`:3089-3095`, now branching on `acPayMode`) — and its first branch, `acGo('orgplan')` for enterprise (`:3090`), is a **prototype bug** (`orgplan` is not in `SCREENS`, `:2925`), so do not port it. |
| 11 | `acs-success` "Payment successful" | **Built, one open copy question** | trivial | The receipt rows, GST note and both actions match; the unchanged "What happens next" block (`:2902-2905`, reproduced at `AccountScreens.tsx:2011-2018`) still says *"1. Select your role … 2. Invite team members"* and our Set up wizard has neither step since 21-Sep item 7 — this is the same question §12.6 raised and the re-share does **not** answer it. |
| — | `acs-plan` "Choose your seat" | **BUILT, DELETED BY THIS RE-SHARE** | medium (removal) | Zero hits in the new file; its renderer ids (`itiers`, `iprice`, `iperiods`) survive only as orphaned JS at `:3258,3271,3293` with no markup, and the individual branch now runs `account → trial` directly (`acAccountNext:3057`). |
| — | `acs-orgplan` "Choose your Enterprise plan" | **BUILT, DELETED BY THIS RE-SHARE** | medium (removal) | Zero hits; `renderOrgPlans` / `acOrgPlanKey='s10'` survive only in dead JS (`:3097,3471`) and `acGo('orgplan')` silently no-ops, so the organisation branch now runs `orgdetails → super → trial` and buys through `acs-annual` or `acs-entplans`. |

**Flow, from the handlers (this is the spec, not the markup order):**
`account` → individual: **`trial`**, organisation: `orgtype` → `orgdetails` → `super` → `trial` → fork → `paidtrial` | `annual` (→ optional `entplans`) → `payment` → `success`. Cross-over: `acUpgradeToEnt` (`:3059`) flips an individual to enterprise mid-purchase and routes `orgdetails → super → annual`.

---

## 3. The payment question

**This re-share specifies the screens in front of a gateway that still does not exist. It does not unblock item 9.** A payment UI is not a payment integration.

**What the file actually gives us:** one string, once in 303 KB — *"Payments secured by Razorpay · 256-bit SSL encryption · PCI DSS compliant"* (`:2874`) — a demo transaction id `RZP250604193847` (`:2899`), and an India-domestic method set (UPI + RuPay + HDFC/ICICI/SBI). That is the first artefact in the programme that names a gateway at all, and it is consistent with `src/server/billing/provider.ts:35` (`PaymentProvider = "razorpay" | "stripe" | "manual"`, probed razorpay-first at `:107`).

**What it does not give us, checked explicitly:** no script tags at all beyond Google Fonts (`:9`) and Tabler icons (`:10`) — no `checkout.razorpay.com`, no `Razorpay(` constructor, no key id, no `order_id`, no callback, no webhook, no signature verification. `#ac-paybtn` is `onclick="acGo('success')"` (`:2875`). `acPayMethod` (`:3238`) toggles CSS classes; the **Verify** button on the UPI field has no handler. Razorpay is asserted as ad copy.

**One thing genuinely improved.** §12.6 recorded that the *previous* prototype drew a raw card number and CVV in-app, which `provider.ts:9-14` refuses on §1.2 grounds. **The re-share draws no card field at all** — Card, Net banking and Wallets are headers with no body. The only instrument-shaped input left is the UPI VPA field (`:2861`), which is not cardholder data and which a hosted checkout would collect itself. The §1.2/§1.3 conflict is smaller than it was.

**Still needed from the client (blocking, business not engineering):**
1. A named platform-owner principal (§12.1, `docs/plan_v3_superuser.md:1140-1165`) — the merchant account is AISJ's, and there is still no principal inside the product to own it.
2. Confirmation that Razorpay is real: an account, KYC status, live-vs-test, and UPI/RuPay/net-banking each enabled on the merchant account (all four drawn methods must be individually enabled).
3. Who sets the Worker secret `PAYMENTS_RAZORPAY_KEY` (contract fixed at `provider.ts:75-79`), in which environment, and where the key-secret for webhook verification lives.
4. Whether the reachable flow is really USD-only, and whether GST applies to USD (see §7 Q1/Q2).
5. Scope and rules for the **"shareable payment link for the finance guy"** — nothing in this file authorises it: `grep -i 'share|finance|copy link|payment link'` returns only unrelated CSS comments, and the success screen's "Download invoice" (`:2910`) has no handler bound.

**Engineering decisions we own and should state, not ask:**
- Keep the pro-forma contract. `recordPaymentIntent` writes `status='recorded'`, `provider='none'` (`provider.ts:137-220`); `ADAPTERS` is empty by design (`:94`); the invoice is stamped `NOT A TAX INVOICE · NO PAYMENT RECEIVED` (`account.ts:505`). None of that changes in this plan.
- Keep our CTA and trust line. We say *"Your card, UPI or bank details are entered on the payment provider's secure page — never in this application"* (`AccountScreens.tsx:1838`) and `Place order · <total>` until a provider is configured. Do **not** ship "Pay ₹1,178 & activate plan" or the Razorpay badge.
- Keep half-up-on-minor-unit rounding (`plans.ts:165-176`, ₹1,178.82) over the prototype's `Math.floor(p*0.18)` (`:3014`, ₹1,178). Ours is the invoice-safe one; `plans.ts:157-163` already records why the prototype's two incompatible GST computations cannot be copied.
- The shareable link has a **seam already**: `billing_payment_intents.checkout_url` (`0046:75`), `PaymentIntentView.checkoutUrl` (`plans.ts:483`), and a rendered "Continue to secure payment" anchor (`AccountScreens.tsx:2004-2008`). A Razorpay Payment Link is exactly that URL shape. Note the asymmetry before anyone builds the share affordance: making that URL shareable turns it into a bearer token for a payable amount, and `provider.ts:157` hardcodes `returnUrl: "/app/admin?section=bl"`, which an external finance person cannot use.
- The prototype promises *"GST-compliant invoice sent to your registered email"* (`:2907`). `src/server/email/` has no invoice template and `EMAIL_FROM` is still unset (the domain is still not onboarded). Write this down as deferred, or it ships as a broken promise.
- Do **not** port `acPayBack`'s dead enterprise branch (`:3090`) or `acRefreshPricing`'s dead `renderOrgPlans()` call (`:3494`).

---

## 4. The item-7 contradiction — verdict: **there isn't one**

**`acs-orgtype`, `acs-super` and `acs-team` belong to My Account, not to the in-app Set up wizard. Nothing here reinstates what 21-Sep item 7 deleted.** Four independent proofs, all inside the re-shared file:

- All ten screens live inside `#acct-overlay`, opened by `openAccount()` (`:3466`) from the sidebar row `si-myaccount` (`:2459`). The sidebar's *separate* `si-settings` row calls `openSetup()` — and `openSetup` occurs **exactly once** in the file, as that onclick, with no definition. There is no `#setup-overlay` markup and no `#sus-*` element; only two orphaned CSS rules survive (`:2052-2053`). **A file that does not contain the Set up wizard cannot reinstate its steps.**
- The two "Org type" screens are different screens: `#sus-orgtype` has **three** tiles (Consulting Firm · Incubator/Accelerator · Investor, `SuperuserV3.HTM:7757-7759`) under the stepper `Org type · Configure · Select · Team`; `#acs-orgtype` has **two** (`MyAccount.HTM:2598-2599`) under `Account · Org type · Org details · Trial & plan · Payment · Done` (`:2958`). They share a headline string and nothing else — and `acs-orgtype` was in the *previous* My Account prototype too. It is not new.
- `acs-super` is **not** our kept `nominateOnly` branch. `TeamStep.tsx:323-400` renders a plan toggle, a seats purchase path and an "Open Team & roles" handoff; `acs-super` is two text fields with the hint *"They'll log in with this email and set their password."* Different screen, different act. `STEPS_SUPERUSER` and `nominateOnly` stay unreachable, and §12.7's "clean deletion if item 7 survives review" is still the right read.
- `acs-team` is dead (row 6 above). It cannot feed a wizard; even its own footer buttons call `acctClose()`.

**Also correct the brief's framing:** this is not a pre-login sign-up flow either. The shell behind the overlay is signed in as Priya Sharma (`:2391`), and both `acs-account` (`:2562`) and `acs-super` (`:2695-2696`) are **pre-filled with that same user**. The prototype models a signed-out state — `#prof-out-view`, "Log in / Forgot password" (`:2436-2444`) — and it contains **no "Create an account" link anywhere**. Our side agrees: `src/server/routes/auth.ts` has only `/login`, `/logout`, `/me`; `App.tsx:143-167` has no `/signup`; `account.ts:56,59` gates the whole wizard behind `requireAuth` + `requireTask("upgrade","admin")`; and `PUT /profile` upserts `account_profiles ON CONFLICT (edition)` (`:235`) — one row per existing workspace. "Create your account" here means *state the billing identity of this workspace*, not *register*. (`SignupWorkspace.tsx` and `pipeline/incubator.ts:24-25` are the **startup deck** sign-up — a false friend; ignore.)

**What we do about it this week — three things, all cheap:**
1. **Write the verdict into the plan file** (`docs/plan_v3_superuser.md` §12.6, and a line in `docs/plan_roles_incubator.md`) in one sentence with the `openSetup`-is-undefined evidence, so the next reviewer does not re-open it. This is the single highest-value hour in this whole plan.
2. **Send the client one question about `acs-super`** — §7 Q5 — before S-SUPER writes a line of code.
3. **Send the client the `acs-success` copy question** (§7 Q6). It is the one *real* contradiction in the file: the receipt still tells the user to "Select your role" and "Invite team members" in Set up, and Set up has neither step since item 7. That is a copy fix waiting on an answer, not a flow reversal.

---

## 5. The sessions

Wave shape as `docs/plan_parity.md` already uses: **three work sessions in parallel worktrees, one integration session last.** File ownership is disjoint — no path appears in two `owns` blocks.

### S-CAT — catalogue, order model, migration (**must land first**; S-FLOW reads the catalogue)
```
migrations/0076_*.sql   (and 0077 if the order-lines table is separate)
src/shared/priceBook.ts
src/shared/plans.ts                      — types only, no signature may change (23 importers)
src/server/routes/account.ts
src/server/routes/pricing.ts
src/client/routes/admin/PriceConfiguration.tsx
test/unit/priceBook.test.ts
test/worker/account.test.ts
test/worker/pricing.test.ts
test/client/priceConfiguration.test.tsx
test/worker/migrations-w1b.test.ts       — the ceiling edit, only if the decision below is taken
e2e/price-configuration.spec.ts
```
**Closes:** the money behind `acs-paidtrial`, `acs-annual`, `acs-entplans`. **Size: large.** It carries the compare-at (`save`) column, the two fixed trial SKUs replacing a per-deck rate, the base-bundle SKU, three annual add-on seat prices, six credit packs, two enterprise bundles, the currency question and the `plan_group` CHECK widening.

### S-FLOW — the overlay: three new screens, two deletions
```
src/client/routes/account/AccountOverlay.tsx
src/client/routes/account/AccountScreens.tsx
src/client/routes/account/accountApi.ts
src/client/routes/AccountPage.tsx
src/client/routes/BuyCreditsPage.tsx
test/client/accountOverlay.test.tsx
e2e/account-purchase.spec.ts
```
**Closes:** `acs-annual`, `acs-entplans`, the `acs-trial` fork and sub, `acs-paidtrial`'s two packs, `acs-payment`'s back-link, and the removal of `SeatScreen` / `EnterpriseSeatScreen` / `ExtraCredits`. **Size: large.** It also owns the buy-credits landing move (`AccountOverlay.tsx:175`) — `openBuyCredits` now lands on `acs-paidtrial` (`:3481-3483`), not a plan screen.

### S-SUPER — `acs-super`, and the wizard / Team & roles reconciliation
```
src/client/routes/SetupWizard.tsx        — STEPS_SUPERUSER / nominateOnly only
src/client/routes/admin/TeamRoles.tsx    — AccountOwnerCard only
src/server/routes/users.ts
test/client/setupWizard.test.tsx
test/client/teamRoles.test.tsx
e2e/setup-wizard.spec.ts
```
**Closes:** `acs-super`, plus the written §4 verdict. **Size: small**, and **independent of the other two** — but gated on client Q5. If Q5 is unanswered at wave start, ship the fallback (confirmation-only step) and note it.

### S-INT — integration only; nothing else may touch these
```
src/shared/accountOrder.ts               — the contested file
test/unit/accountOrder.test.ts
e2e/parity.spec.ts
e2e/roles.spec.ts
e2e/upload.spec.ts
```
`src/shared/accountOrder.ts` (628 lines) holds **both** halves: the pricing half S-CAT wants (`quoteOrder:473`, `OrderExtras:441`, `PAID_TRIAL_PACKS:609`) and the navigation half S-FLOW wants (`AccountScreen:47-58`, `STEPS_*:68-79`, `stepperFor:94`, `planScreenFor:130`). **S-INT owns it; both sessions submit patch files and every patch gets `git apply --check` before the wave** — four parity-request patches have already sat unapplied for one-to-two waves on this programme. The alternative, splitting it into `accountOrder.ts` + `accountSteps.ts`, is itself a plan decision; take it explicitly or not at all.

`e2e/roles.spec.ts:82` and `e2e/upload.spec.ts:164` go **together, with their exact diffs** — they are the same two rows that failed at S3-ACCOUNT. `e2e/parity.spec.ts:252` and `:326` (both `title: "Choose your seat"`) move; `:591`/`:695` (VC, "Choose your plan") must not. Re-capture parity once per wave.

### The VC negative control is mandatory in every session
`AccountOverlay.tsx:317` — `const seatFlow = edition === "incubator" && (role === "superuser" || role === "admin")` — is the **only** thing separating the two editions, and `AccountScreens.tsx` holds both sets in one 2,050-line file. `AccountStep`, `OrgTypeScreen`, `OrgDetailsScreen`, `PaymentScreen`, `ReceiptScreen` and `Stepper` are **shared**. §12.6 proved the gate in both directions by reverting; every session here repeats it: revert the gate → incubator tests fail; drop the `edition` guard → the VC controls fail. The 17 VC assertions that must be proved *not* to move: `accountOverlay.test.tsx:680,697,704,750,761` + `parity.spec.ts:591,695` + `account-purchase.spec.ts:145,232`.

### Out of scope, stated
`src/shared/seats.ts`, `seats/BuySeats.tsx`, `setup/TeamStep.tsx`. `seatPricesFromBook` (`seats.ts:174`) prices a purchased seat from the `subscription` rows coded `standard`/`pro`/`premium`, and `0073`'s own header (`:40-44`) warns that deleting those rows makes every seat unpurchasable. `annualSeat: {30,45,60}` will tempt S-CAT to retire them. **It must not** — `e2e/seats.spec.ts` (23 expects) and `test/unit/seats.test.ts` (54) would go red with no owner in this wave.

### Migration position — **this is a decision, not a session's discretion**
`migrations/` ends at `0075_deck_ai_complete.sql`. `test/worker/migrations-w1b.test.ts:40` sets `ALLOTMENT_CEILING = 76` and asserts it at `:71`. **Exactly one slot exists, and `docs/plan_roles_incubator.md:122,172` already reserves it for Wave R+1's V3-SF `score_visibility` question.**

**This work needs schema. It cannot be done under the ceiling.** Four structural reasons:
- `account_orders` (`0053:60-75`) has `plan_group`, `period`, `payment_method`, `taxed`, `price_version` — **no plan code, no quantity, no amount, no line table**. `acs-annual` is up to ten priced lines in one order.
- `account_orders.plan_group` CHECK is `('subscription','credit_pack','enterprise')` (`0053:64`); an annual order is subscription **and** credit_pack at once, and SQLite cannot widen a CHECK without a table rebuild.
- `PricePlanRow` (`priceBook.ts:127-171`) has `badge`, `tagline`, `features`, `units`, `period`, `periodMonths`, `tier`, `seats`, `amounts` — **no compare-at field**. Six credit packs and two enterprise bundles each carry a `save` (`saving_pct` at `0033:57` is a percentage, not an amount).
- The catalogue must be reseeded and republished, repeating `0073`'s tail pattern (`UPDATE pricing_versions SET status='superseded'` + a frozen document), which moves `test/worker/pricing.test.ts`.

**State this verbatim in the plan file:** *this work takes `0076` and requires `ALLOTMENT_CEILING` (`test/worker/migrations-w1b.test.ts:40`) to be raised — to `0078` if the Wave R+1 `score_visibility` slot is to survive alongside it.*

### Sequencing
`S-CAT → S-FLOW`, `S-SUPER` in parallel with both, `S-INT` last. Migrate before deploying (`0038` breaks on real data); the gate is ~4.5 min on an idle box — do not attribute its failures to flakiness.

---

## 6. What NOT to build

| Don't build | Why |
|---|---|
| **`acs-team` "Add your team"** | Unreachable. `acGo('team')`'s only caller `acRoleNext` (`:3108`) is invoked from nowhere; the screen it followed is gone (`<!-- 3. ROLE (removed from flow) -->`, `:2727`); its own footer buttons call `acctClose()`. §12.6 measured this on V3 and it is unchanged. **This is the third scoping pass to reach this conclusion — write it into the plan file so it is the last.** |
| **A pre-login sign-up / registration flow** | The prototype has no "Create an account" link anywhere, models a signed-out state that offers only Log in / Forgot password (`:2436-2444`), and pre-fills both account screens with the signed-in user. If the client wants one it is a **new item**, not part of this. |
| **A Razorpay integration, or the Razorpay trust line** | The file supplies zero integration surface — no script, key, order creation, callback or webhook. Keep our provider-neutral copy (`AccountScreens.tsx:1838`) and the `Place order` CTA. Shipping the badge would claim a gateway we do not have. |
| **The UPI "Verify" button as a working control** | It has no handler in the prototype (`:2861`). Draw it only if a real gateway lands; otherwise it is a dead affordance on a screen that already tells the truth. |
| **`acPayBack`'s enterprise branch** | `acGo('orgplan')` (`:3090`) targets a name not in `SCREENS` (`:2925`), so `acGo` returns at `:3036` and the link does nothing. A prototype bug. Use the `acPayMode` branches below it. |
| **`renderOrgPlans()` / `acOrgPlanKey='s10'` / `#itiers` / `#iprice` / `#iperiods` / `IEXTRA_PACKS`** | All orphaned JS with no markup (`:3097,3471,3258,3271,3293,3005`). Dead data carried forward from the deleted screens. |
| **The static ₹ figures on `acs-payment` / `acs-success`** | `₹999 / ₹179 / ₹1,178` (`:2881-2883`) and `₹1,178 (incl. GST)` (`:2898`) are placeholder markup, overwritten on every entry by `renderPayment` (`:3334`) / `renderSuccess` (`:3414`), whose three reachable branches are all USD. The only static value never overwritten is the demo transaction id `RZP250604193847` (`:2899`) — do not ship it. |
| **The prototype's GST rounding** | `Math.floor(p*0.18)` (`:3014`) vs our half-up-on-minor-unit (`plans.ts:165-176`). `plans.ts:157-163` already records that the prototype computes GST two incompatible ways and therefore cannot be copied. |
| **A Back button removal on `acs-orgtype`** | The prototype's footer has Continue only (`:2602-2604`); our Back button is a usability improvement on a step the user can legitimately return from. Keep it and note the deliberate divergence. |
| **Anything in the Set up wizard** | See §4. Do not touch `SetupWizard.tsx` beyond S-SUPER's `STEPS_SUPERUSER` / `nominateOnly` tidy-up. |

**Also worth not doing: a second scoping pass on any of the above.** Every "don't build" row here was already established in §12.6 or in the four reports feeding this plan; the cost of this wave is inflated by exactly that kind of re-derivation.

---

## 7. Questions for the client

Each one sentence; each with the fallback we ship if it goes unanswered.

**Q1 — Is the whole reachable flow priced in USD now, replacing the INR catalogue we publish today?**
*Fallback:* treat the USD figures as the literal spec, seed them as a new published catalogue version, and keep INR available only on the untouched VC legacy screens.

**Q2 — Is 18% GST really charged on USD prices?** (The prototype applies `gstOf` unconditionally at `:3320` and `:3336-3348`; our published book's own footnote — *"International pricing shown exclusive of local taxes"*, `0073:143` — and `priceBreakdown` (`plans.ts:223-241`) say no, and `e2e/account-purchase.spec.ts:145` tests it.)
*Fallback:* keep our rule (no GST on non-INR), treat the prototype's GST-on-USD as a mock-up artefact, and flag every affected figure in the handover — we do not re-arm a divergence Wave 4 deliberately closed.

**Q3 — Is per-seat quarterly / half-yearly subscription retired, or does it survive alongside the annual bundle?**
*Fallback:* retire it deliberately — mark `0073`'s nine `seat_*_{3,6,12}` SKUs superseded, drop `period_months` 3/6 from the new flow, and keep the columns so nothing breaks.

**Q4 — Who edits `annBase`, `annualSeat`, the six credit packs and the two ENTPLANS bundles?** (The prototype gives them **no admin surface** — its `aisjPricing` handler at `:3496-3501` still syncs only `paidRate`, `ind[tier]` and `ent[s5|s10|s15]`, so the thirteen numbers our console edits at `PriceConfiguration.tsx:704-800` would be read by **no screen at all**.)
*Fallback:* seed the fourteen new numbers catalogue-side and leave the console cards pointed at them read-only, with the editor deferred to the platform-owner work in §12.1 item 10.

**Q5 — Is "Nominate your super user" (i) a confirmation of the current owner during an Enterprise upgrade, (ii) a genuine invite that creates a second login — duplicating Admin console → Team & roles' `AccountOwnerCard` (`TeamRoles.tsx:403`) — or (iii) a screen for a pre-login sign-up page we do not have?**
*Fallback:* ship (i) — a confirmation step pre-filled from the signed-in user, no invite sent, with a link to Team & roles for reassignment; (iii) would be a new item, not part of this wave.

**Q6 — The receipt still says "Go to Set up: 1. Select your role, 2. Invite team members", but Set up no longer has either step — what should it say?**
*Fallback:* keep our current corrected copy ("Configure your programmes" / "Invite team members in Admin console → Team & roles", `AccountScreens.tsx:2022-2032`) and note the divergence from the prototype.

**Q7 — Is Razorpay confirmed, with a live merchant account, completed KYC and UPI/RuPay/net-banking each enabled?**
*Fallback:* build no adapter, keep `ADAPTERS` empty, keep the pro-forma stamped `NOT A TAX INVOICE · NO PAYMENT RECEIVED`, and keep provider-neutral copy on the payment screen.

**Q8 — For the "shareable payment link to the finance guy": who may generate it, how long is it valid, is it emailed or copied, and must the recipient authenticate?**
*Fallback:* do not build the share affordance this wave — note that the `checkout_url` seam exists (`0046:75`, `plans.ts:483`, rendered at `AccountScreens.tsx:2004-2008`), that making it shareable turns it into a bearer token for a payable amount, and that `returnUrl` (`provider.ts:157`) would need replacing.

**Q9 — Do we confirm that the trial's "Annual subscriptions" fork replaces "Pay for the plan chosen" for every buyer, so nobody picks a plan before spending their three free decks?**
*Fallback:* follow the prototype literally — `account → trial` for individuals, `orgdetails → super → trial` for organisations — and delete the pre-trial plan choice.

**Q10 — Confirm the 25/50-credit paid trial at $117/$210 "valid for a quarter" replaces the 10–50-deck rate-multiplied packs, and that Buy credits should now land there rather than on a plan screen?**
*Fallback:* implement both as stated (two fixed SKUs, Buy credits → `acs-paidtrial`) and re-point `e2e/roles.spec.ts:82` and `e2e/upload.spec.ts:164` accordingly — the second time in three weeks those two rows have moved.

---

## Honest cost summary

**Survives:** six screens, largely verbatim — `acs-account`, `acs-orgtype`, `acs-orgdetails`, the shell of `acs-trial`, `acs-payment`, `acs-success`. Plus the shared components, the server contract, the pro-forma invoice, and the whole VC edition (untouched).

**Thrown away:** `SeatScreen` and `EnterpriseSeatScreen` (`AccountScreens.tsx:1054-1310`), `ExtraCredits` (`:985-1045`), the derived `extraCreditRate` concept (`accountOrder.ts:449-456`, which we built specifically so that editing a price in the console flowed through), quarterly and half-yearly billing, migration `0073`'s thirteen seeded SKUs and its published v2 catalogue, and the three console price cards' entire subject. Shipped 2026-09-12; deleted by the client 2026-09-23.

**Test cost:** approximately **160 unit/client/worker assertions and 60 e2e assertions across 12 files**, plus 2 `parity.spec.ts` table rows — and 17 VC assertions that must be proved *not* to move. `test/client/accountOverlay.test.tsx` alone moves 119 of its 141 expects.

**Net:** three work sessions plus one integration, at least one migration above a ceiling that is already spoken for, and a catalogue republish. The screens are the cheap half. **Tell the client that the deletion of two screens they approved eleven days ago is what makes this a wave rather than an afternoon** — and that the way to not repeat it is Q1–Q4 answered before S-CAT opens, because those four answers, not the markup, set the size of this work.


---

## 8. Readiness check — run 2026-09-23 against `96a1465`

Verified mechanically before the prompts were issued, not asserted:

| Check | Result |
|---|---|
| Every owned path exists | ✅ — the only absentees are the two files a session CREATES (`migrations/0076_*`, `test/worker/deck-scope.test.ts`) |
| Wave R internally disjoint | ✅ — 29 paths, 6 sessions, **no path owned twice** |
| Branches `parity/R*` free | ✅ all six |
| Worktrees `../sj-R*` free | ✅ all six |
| `main` pushed | ✅ `origin/main..main` = 0 commits |
| Wave R migrations | ✅ **zero** — main ends at `0075`, ceiling is 76, nothing in Wave R persists |

**The two waves CANNOT run together.** Six paths collide between Wave R and the My Account wave:

```
src/client/routes/SetupWizard.tsx        R3-SETUP ✕ S-SUPER
src/client/routes/admin/TeamRoles.tsx    R3-SETUP ✕ S-SUPER
test/client/setupWizard.test.tsx         R3-SETUP ✕ S-SUPER
test/client/teamRoles.test.tsx           R3-SETUP ✕ S-SUPER
e2e/setup-wizard.spec.ts                 R3-SETUP ✕ S-SUPER
e2e/upload.spec.ts                       R2-UPEVAL ✕ S-INT
```

That is not a scheduling inconvenience to work around — it is the correct answer. **Wave R runs
first because it is unblocked and needs no schema; the My Account wave is blocked on two client
answers anyway** (GST on USD billing, and whether the annual cart really replaces per-seat
pricing). Starting S-CAT before those answers is how `0073_seat_pricing_v3.sql` came to be
superseded 48 hours after it shipped.

---

## 9. The client's answers — 24-Sep-2026. These supersede the fallbacks above.

**Q1 / the currency — answered by implication, and left to us.** *"If the payment gateway
automatically converts the local currency to dollar and further converts to INR, we don't need that
intervening screen in the settings. I leave it to you."* Read with Q2, the intent is clear: **price
in USD as the prototype does, and let the gateway handle presentation currency.** No currency
selector. Our `PublishedPrice.currency` already models this (`plans.ts:98-120`), so the catalogue
is seeded in USD and nothing in the UI offers a choice.

**Q2 / GST — KEEP IT, on USD.** *"Let's keep the GST aspect as it is. In the first run, we are
expecting Indian users mostly. Meanwhile I will cross-check with our CA too."*

This reverses the fallback, and it is the one answer to revisit. `plans.ts:200` fixes
`BASE_CURRENCY = "INR"` with the comment *"GST is the INR-billing tax"*, `0073:143` carries the
footnote *"International pricing shown exclusive of local taxes"*, and
`e2e/account-purchase.spec.ts:145` is titled *"…(USD, no GST)"*. All three encode the opposite
rule and were written deliberately. **Build what he asked for — 18% GST on the USD total — but make
it a SETTING, not a constant**, because "I will cross-check with our CA" is an answer that can
change, and a tax rule hard-coded across a catalogue is expensive to reverse. The three artefacts
above get updated, not deleted, so the reasoning survives.

**Q3 / per-seat pricing — NOT retired. The ladder, in his words:**

> 3-deck free trial → paid trials of either 25 or 50 credit packs (valid for a quarter) → if
> individual, an annual plan (1 premium seat with 125 credits) with a choice to add more credits as
> per credit packs available → if the individual upgrades to Organization, one of two plans, Basic
> (5 seats, 1500 decks) or Basic Plus (2000 decks), with more decks or seats addable per packs.
> *"This has been done to provide more flexibility in line with self-serve concept."*

That is exactly the re-shared prototype's flow, and it settles the shape: **seats survive as a
CONCEPT** (1 premium seat; 5 seats; add more), while the 3×3 grid of tier × quarter/half-year/year
does not. So `0073`'s nine `seat_*_{3,6,12}` SKUs are superseded by the ladder rather than by a
decision to stop selling seats — keep the columns, keep `seatPricesFromBook`, retire the SKUs.

**Q4 / the gateway — STRIPE, not Razorpay.** *"No. it's just indicative. I will open the account on
Stripe and share details."* The `RZP…` transaction id in the prototype is a mock.

**Consequences:** the `ADAPTERS` seam stays empty until the account exists, and nothing behind the
payment screen is real until then — but the screens themselves are unblocked, and Stripe rather
than Razorpay changes what we build later (Payment Intents and a webhook, not Razorpay Checkout).
**Do not begin an adapter before the account, the keys and the enabled payment methods arrive.**

**The FAQ copy — his to fix, and he will.** *"I will change that and also add a few related to
Evaluation and configuration FAQs and clips. Let's add them in the last before release."* So the
six wrong answers stay verbatim for now, and the FAQ set is re-shared before release. `faqs.ts` is
generated from the spec by `docs/prototype/tools/extract-help-clips.py`, so a re-share is a re-run
plus a clip upload, not hand-editing.

**The re-share cost — acknowledged.** *"Sorry for that… That's because of our pricing dilemmas. Now
it's done for sure."* Taken at face value; the ladder above is the settled model.

---

## 10. What his answer to Q1 actually opened: MULTI-TENANCY

> *"It's going to be multi-tenant, so the role of AISJ Admin and a dashboard is required. By
> default, whatever tickets raised will go to Client Admin. Whatever Client Admin raises would
> reach AISJ admin."* — and, on price configuration, *"this has to be in AISJ Admin control, NOT
> the client admin."*

This is not the small platform-owner gate §12.1 scoped. **It is a foundational change, and no plan
in this repo covers it.** Measured, not assumed:

| | |
|---|---|
| `migrations/0001_init.sql:1` | *"Single-tenant: one implicit organization"* — the schema says so itself |
| organisations / tenants table | **none** |
| tables in the schema | **70**, none carrying a tenant key |
| `org_settings` | keyed by **`edition`**, not by organisation (`0001_init.sql:19`) |

So every table, every query and every authorisation check currently assumes one workspace. Adding a
real AISJ Admin above it means a tenant key on the data, tenant scoping on every read, a second
principal type outside the customer's role set, and a dashboard that spans customers — plus the
four items it unblocks (trial approval to **info@startupjury.ai**, ticket escalation, price config,
payment).

**This must be scoped before anything is built.** It is larger than the My Account wave and it sits
underneath it: who owns a price book, who a ticket escalates to, and who may approve a trial are
all tenancy questions. Scoping it is the next action, not building it.
