# V6-CURRENCY — currency and GST, resolved from the billing address

Built 2026-10-04 against `docs/prototype/source/incubator/AISJ_MyAccount_V6.HTM`.
This lane is the foundation the other V6 lanes build on: **ask the server what
currency a customer is in; do not derive it on a screen.**

---

## The rule, from V6

`#acs-billing`, verbatim:

> We use this to set your billing currency and generate your invoice. Indian
> billing addresses are charged in **INR with GST**; every other country is
> billed in **USD with no GST**.

GST is 18 % — and it is a **setting**, not a literal. Everything below reads it
from the published catalogue.

---

## What other lanes need from this one

### 1. `GET /api/account` now returns a `billing` block

```jsonc
{
  "profile":  { … },          // unchanged
  "saved":    true,
  "billing": {
    "name":    "CV Accelerator Private Limited",   // null until the screen is filled
    "city":    "Hyderabad",
    "country": "India",
    "address": "Plot 42, Hitec City, 500081",
    "locale": {
      "country":  "India",
      "currency": "INR",      // null when NO billing country is on file
      "taxed":    true,
      "ratePct":  18,         // 0 when GST does not apply
      "note":     "Billed in INR with 18% GST — GST-compliant invoice provided."
    }
  },
  "orders": [ … ],
  "paymentConfigured": false
}
```

`locale.note` is V6's own sentence, both branches, with the configured rate
interpolated. **Use it** rather than writing a third wording into a screen.

`locale.currency === null` means nobody has filled the billing screen. That is
the cue to send the customer through `#acs-billing` before `#acs-payment` — which
is V6's own order of steps.

### 2. The billing screen saves with `PATCH /api/account/profile`

```jsonc
PATCH /api/account/profile
{ "billing": { "name": "…", "city": "…", "country": "…", "address": "…" } }
```

* All four fields are required — V6 gates Continue on exactly those four
  (`acBillingValidate()`).
* `400 {"error":"invalid_billing_address","fields":{…}}` — per-field messages,
  same shape as `invalid_profile`.
* `409 {"error":"account_required"}` when no profile exists yet. The billing
  screen cannot create one: the row is `work_email NOT NULL` and `0053` CHECKs
  that an organisation account names its organisation.
* `200 {"ok":true,"profile":…,"billing":…}` — the same `billing` block as above,
  already resolved. Render from the response; do not recompute.

`PUT /api/account/profile` also accepts an optional `billing` key, for a save
that carries everything. **Omitting it does not erase what is on file**, the same
way an individual save leaves the organisation block alone.

### 3. The order route enforces the currency

`POST /api/account/orders` refuses a currency the billing country does not allow:

```jsonc
400 { "error": "currency_not_for_billing_country",
      "required": "INR", "requested": "USD", "country": "India" }
```

Refused **before** the price is computed — no intent, no order row. It is a
refusal and not a silent correction, because re-denominating a purchase under
the customer means the figure on screen is not the figure charged. The response
names `required`, so a client can retry with it; it is the same value
`GET /api/account` already served as `billing.locale.currency`.

Nothing is enforced while `locale.currency` is `null` — see the next section.

### 4. Shared helpers (`src/shared/plans.ts`)

| Export | What it answers |
| --- | --- |
| `billingCurrencyFor(country)` | `"INR"` / `"USD"` / `null`. The ONLY country → currency map. |
| `isIndianBillingCountry(country)` | Handles `india`, `in`, `ind`, `bharat`, `republic of india`, trimmed and case-insensitive. |
| `resolveBillingLocale(country, tax)` | The whole `BillingLocale`, rate from `TaxSettings`. |
| `gstApplies(currency)` | The one predicate `priceBreakdown` itself uses. |
| `validateBillingAddress({name,city,country,address})` | `{}` or per-field errors. |
| `INTERNATIONAL_CURRENCY` | `"USD"`. |

A screen may call `resolveBillingLocale` for live feedback as the country field
is typed (V6 updates its note on `oninput`). It will agree with the server,
because it is the same function.

---

## The existing customer, stated plainly

Production holds **two `account_profiles` rows** (`0094`, measured read-only:
`incubator 1, vc 1` — one customer, one commercial record per workspace). Both
predate any billing screen.

`0104` adds four nullable columns with **no DEFAULT and no backfill**, so after
it applies those two rows carry no billing country. They therefore resolve to
`currency: null`, and:

* `POST /orders` constrains nothing for them — the request is priced exactly as
  it is today.
* No figure they have been quoted changes on the day this deploys.

This is deliberate. Backfilling `India` would start adding 18 % GST to what they
are quoted; backfilling anything else would stop charging GST that may be due.
Both are a change to what a real customer is billed, made by a migration, with
no human in the loop. The invariant binds from the moment the address is
recorded, which is what the billing screen is for.

A worker test pins it: *"leaves a customer with NO billing country exactly as it
is today"*. If that test ever starts failing, a migration has begun deciding
what a real customer is billed.

---

## What is NOT in this lane, and should be picked up

1. **`POST /orders` does not yet REQUIRE a resolved locale.** It cannot today
   without breaking every caller that has no billing address, and no money moves
   while `ADAPTERS` is empty. Once pricing is finalised and a Razorpay adapter
   lands, the refusal should widen from "wrong currency" to "no billing country"
   — one `if`, in the same place.
2. **The GST tax invoice** (downloadable AND emailed, "suitable for input tax
   credit") is a different lane. This one makes the pro-forma carry the billing
   name and address, which is what V6's invoice prints in BILL TO.
3. **`gstin`** stays on `billing_subscriptions`. V6's billing screen does not
   capture one, so `0104` does not add one to `account_profiles`.
4. **No `billing_currency` column exists, and none should be added.** The
   currency is a function of the country; persisting it is the drift class that
   gave this product four low-credit thresholds. What an order was priced in is
   already persisted, on the intent, because that is a fact and not a
   derivation.

---

## Files

* `src/shared/plans.ts` — the resolver, the validator, `gstApplies`.
* `src/server/routes/account.ts` — the `billing` payload, `PATCH /profile`, the
  order invariant, the pro-forma's bill-to.
* `migrations/0104_billing_address.sql` — four nullable columns, `ALTER TABLE`.
* `test/unit/billing-currency.test.ts` · `test/worker/billing-currency.test.ts`.
