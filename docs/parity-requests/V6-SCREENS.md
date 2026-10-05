# V6-SCREENS — handoff

Lane: the five screens **My Account V6**
(`docs/prototype/source/incubator/AISJ_MyAccount_V6.HTM`, received 2026-10-04)
adds — `acs-billing`, `acs-super`, `acs-team`, `acs-annual`, `acs-entplans` —
built mobile-first, plus the ruling on `orgplan`.

Files touched, all inside the lane:

- `src/shared/accountOrder.ts`
- `src/client/routes/account/AccountScreens.tsx`
- `src/client/routes/account/AccountOverlay.tsx`
- `src/client/routes/account/accountApi.ts`
- `test/unit/accountOrderV6.test.ts` (new), `test/client/accountV6Screens.test.tsx` (new),
  `test/client/accountOverlay.test.tsx` (four walks added; two org-branch walks taught the
  new step; the harness now mirrors the route's billing payload and currency invariant)

Nothing outside the lane was edited. `src/shared/plans.ts` and
`src/server/routes/account.ts` are **read** (the V6-CURRENCY lane's) and never written.

---

## 1. `orgplan` is NOT superseded. It stays.

The brief flagged it as "looks superseded by `annual` + `entplans` splitting it
in two". Measured, it is not:

- V6 **deletes the `<div id="acs-orgplan">` markup and keeps the entire driver** —
  `renderOrgPlans`, `acOrgPlan`, `acOrgPlanKey`, `acSetOrgSel`, the `acGo` hook at
  line 2969 and the `acRefreshPricing` branch at 3517 all survive. `orgplan` is
  simply absent from `SCREENS` and from both `setSteps` index maps, so the
  prototype would try to show a div that is not there.
- V6's own comment calls the `PRICING.ent` figures behind it "dead code —
  unreachable path". **That is a statement about the incubator superuser file,
  the only one V6 re-exports.**
- In this build the screen is still reached where `seatFlow` is false — the **VC
  edition's** organisation branch, through `LegacyOrgPlanScreen`. The client put
  the VC edition out of scope on 2026-10-01 with the instruction that it must
  keep working, and `e2e/account-purchase.spec.ts`'s "an organisation buys an
  annual plan through to a receipt (USD, no GST)" walks that exact path from
  "Create account" straight to "Choose your plan".
- `entplans` is not a replacement either way: V6's bundles are **two fixed
  literals** (`entBundles.basic` / `.basicplus`), reached from the individual
  `annual` screen. This build renders the catalogue's `enterprise` rows there
  instead, because §1.1 forbids a price literal.

So: `super` was inserted **between Org details and `orgplan`** on the incubator
seat flow, and `orgplan` keeps serving the branch V6 does not draw.
`test/unit/accountOrderV6.test.ts` carries a guard that fails if a later sweep
deletes it.

## 2. What shipped

| V6 screen | Component | Entry | Exit |
| --- | --- | --- | --- |
| `acs-super` | `SuperUserScreen` | Org details → Continue (incubator seat flow only) | → `orgplan` |
| `acs-annual` | `AnnualSubscriptionScreen` | Trial complete → "Annual subscriptions" (`acStartAnnual`) | → Billing → Payment |
| `acs-entplans` | `EnterprisePlansScreen` | Annual → "Enterprise Plans" (`acStartEntPlans`) | → Billing → Payment |
| `acs-billing` | `BillingDetailsScreen` | `acGoBilling(from)` from Annual or Enterprise Plans | → Payment; Back → whoever sent it |
| `acs-team` | `TeamScreen` | **the receipt**, organisation accounts only | → closes the overlay |

Stepper positions are V6's `setSteps()` maps verbatim. `team` is in V6's
`SCREENS` and in **neither** map, so the mockup renders a stepper with nothing
active; here it takes the last position.

Three additive props on existing screens, all optional so no current caller
changes: `TrialScreen.onAnnual` (the only route into `annual`),
`PaymentScreen.billing` (V6's `billToLine()`), `ReceiptScreen.onTeam`.

**10 GB per seat** (`SEAT_STORAGE_GB`) is one constant, stated on every seat row
and every bundle bullet, as V6 states it on Standard / Pro / Premium alike.
**No discount anywhere**: V6's `ann-save-pill` ("You save $X") is not drawn — the
instruction says V6 has none, and §8 Q1 forbids publishing a saving derived from
a base rate. A test asserts the absence.

## 3. Integrated with V6-CURRENCY mid-session

The sibling lane's resolver landed while this lane was building, so the billing
screen was rewired onto it rather than shipping with the gap this doc first
recorded. **Nothing in this lane holds a copy of the currency rule.**

- `BillingDetailsScreen` takes `draft: BillingAddress` and
  `locale: BillingLocale`, both from `src/shared/plans.ts`. The sentence under
  the country field **is** `locale.note` — one copy, beside the rule that
  produces it. The gate on Continue is `validateBillingAddress`, theirs.
  A first draft of this lane had its own `BillingDetails`,
  `validateBillingDetails` and a `{currency, gstApplies}` shape; all three were
  deleted. Only the datalist (`BILLING_COUNTRIES`) and a blank seed
  (`EMPTY_BILLING_ADDRESS`) stayed, because those are the field's furniture.
- `accountApi.ts` gained `AccountBillingView` (what `GET /api/account` now
  serves) and `saveBillingAddress` → `PATCH /api/account/profile`, which is the
  verb their route added so the billing screen can save only itself.
- **The order currency now follows the address.** `POST /orders` refuses a
  currency that disagrees with the saved billing country
  (`currency_not_for_billing_country`) and refuses rather than re-denominating,
  so the overlay (a) seeds `currency` from `billing.locale` on load, (b) adopts
  the server's resolved currency when the billing screen saves, and (c) narrows
  `CurrencyPicker`'s list to the one legal currency, which hides it — V6 deletes
  that control, and narrowing the list removes it without deleting a component
  three un-rescoped prototypes still draw.
- `orderErrorMessage` learned `currency_not_for_billing_country` and
  `invalid_billing_address`.

The client test harness in `accountOverlay.test.tsx` now mirrors the real route:
`GET /api/account` returns `billing` through `resolveBillingLocale`, `PATCH`
validates with `validateBillingAddress`, and **`POST /orders` enforces the
currency invariant**. That last one is what makes "adopts the currency the
billing address resolves to" a test: a client that kept quoting INR after a UK
address gets a 400 from the stub.

## 4. Needs an owner — outside this lane

1. **A multi-line annual cart cannot be ordered.** `POST /api/account/orders`
   takes one `planCode` + `quantity` + `extraCredits` and re-prices it. V6's
   `annTotal()` is `annBase + Σ seats×seatPrice + Σ packs×packPrice` — a cart.
   `annualCartQuote` prices the whole cart (so the screen is honest) but returns
   `order: null` with `blocked: "mixed_tiers"` when it holds two seat tiers, and
   Continue stays shut with the reason on it. Sending one tier's code with the
   other tier's money was the alternative.
   *To finish:* an order with `lines: [{planCode, quantity}]`, priced server-side.

2. **The super-user nomination is not persisted.** There is no field for it on
   `AccountProfile` / `/api/account/profile`. It is prefilled from the
   organisation's own contact person and carried in client state only. Needs a
   column and a route before "You can reassign this later in Team & roles" is
   true.

3. **Team invites are not sent.** V6's `aetMembers` is local state too, and this
   build matches it; the screen says so in as many words ("Invitations are sent
   from Admin console → Team & roles once your subscription is active") rather
   than implying an email went out. Needs a pending-member route.

4. **V6 adds a fifth payment-method row, "Razorpay" (UPI / Cards / Netbanking /
   Intl.).** Not added: `PaymentMethod` is persisted on
   `billing_payment_intents`, so a new value is a schema change. The provider is
   **named** in copy on the payment screen instead, which is what V6's
   "Payments secured by Razorpay" line does.

5. **V6's credit packs are 125 / 1,000 / 1,500 / 2,000 decks with their own
   prices.** The annual screen reuses `ExtraCredits` — `EXTRA_CREDIT_PACKS`
   (125 / 250 / 375 / 500) at the rate **derived** from the Premium annual seat,
   which is the one rate the server re-prices against. Pack sizes and pack
   pricing are a Price-configuration change, not a screen change.

6. **`PaymentScreen`'s own layout is still desktop-first** (`grid-cols-[1fr_296px]`
   with a `max-[680px]:` override). It collapses correctly at 390 px, so it is
   not a defect — but it is one of the ten retrofitted screens, and the five new
   ones here are written the other way round (`min-[…]:` variants over a
   one-column base) on purpose.

7. **The currency can change between the cart and the payment screen**, because
   V6 quotes pre-billing in one currency and bills in another. That is V6's own
   behaviour (its `usd()` is "pre-billing display: always USD" and `fmt()`
   converts afterwards) and the figure a customer presses Pay on is always the
   final one — but the *order of the steps* is why. If the client would rather
   the price never move, the billing step has to come before the plan step,
   which is a flow change and not this lane's to make.

## 4. Mobile-first, as a test rather than a promise

`test/client/accountV6Screens.test.tsx` renders all five and fails on any
**unconditional** class that forces an element wider than 358 px (390 px less
the overlay's two 16 px gutters): `w-[Npx]`, `min-w-[Npx]`, `basis-[Npx]`, or a
grid track `minmax(Npx, …)`. Classes behind a `min-[…]:` variant are exempt —
that is the point. Negative control: adding `min-w-[520px]` to the Billing grid
reddened exactly that test.

No screen in this lane carries a table, so none needed an `overflow-x` wrapper.
The team roster is a list of cards for that reason.
