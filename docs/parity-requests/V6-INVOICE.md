# V6-INVOICE — the two invoice templates, the record behind them, and 10 GB per seat

Lane: `src/server/routes/billing.ts` · `src/server/billing/**` · tests covering them.
Wave: My Account V6, 2026-10-04. Branch `main`, shared checkout with two sibling lanes.

Files written: `src/server/billing/invoice.ts` (new) · `src/server/billing/storage.ts` (new) ·
`src/server/billing/ledger.ts` (one hunk) · `src/server/routes/billing.ts` ·
`test/worker/billing-invoice-v6.test.ts` (new, 28 cases) ·
`test/worker/billing.test.ts` (one assertion restated, see §6).

---

## 1. The brief's LUT premise is wrong, and it is worth saying first

> "The file mentions LUT 17 times — read those occurrences before designing the template."

**V6 does not mention LUT once.** All 17 case-insensitive matches are substrings:

```
grep -o -iE "[a-z]*lut[a-z]*" docs/prototype/source/incubator/AISJ_MyAccount_V6.HTM \
  | sort | uniq -c
  16 absolute      ← position:absolute, in the stylesheet
   1 SOLUTIONS     ← "STARTUPJURY AI SOLUTIONS PRIVATE LIMITED", the invoice header (:3464)
```

"IGST" appears **zero** times. The one occurrence of "export" (`:2843`) is a feature bullet about
report exports. What V6 actually draws for a non-Indian customer is:

* `:3277` — order summary: "Invoice provided (no GST — billed outside India)"
* `:3478` — invoice notes: "Payment: Processed via Razorpay · billed in USD, no GST (billing
  address outside India)"
* `:3357` — success screen: "(no GST — billed outside India)"

So the **export invoice and its LUT declaration come from the client's 24-Sep checklist, not from
this mockup.** Both templates are built, because the checklist named them and the brief asks for
them — but the exact declaration is a question for the client's CA and is one editable constant,
`LUT_DECLARATION` in `src/server/billing/invoice.ts`.

**→ ASK 1 (client):** confirm the wording. The two positions are materially different tax
treatments: supply under LUT *without* payment of IGST (what we have assumed), versus supply *on*
payment of IGST claimed back as a refund. The second needs an IGST line on the document and a
different total, so this is not a copy change.

---

## 2. What the invoice stores, and the one gap that needs a migration

An invoice is a record. `renderInvoiceDocument` is **pure** — no clock, no settings read, no
database — so byte identity on a reissue is a property of the input, and "what is not stored" is one
answerable question. A worker case proves the property that matters: raise
`pricing_settings.gst_rate_pct` to 28 and an already-issued invoice still renders `GST (18%)` and
`₹23,600`, byte-identical to the first render.

**Snapshotted today** (`billing_invoices`, `0046` + `0097`), and therefore correct on a reissue:
number · issue date · currency · description · units · subtotal / tax / total in minor units ·
`gst_rate_pct` · `gst_registration` · `place_of_supply` · `reference`.

**Read LIVE, and listed in `UNSNAPSHOTTED_INVOICE_FIELDS` so it is greppable rather than prose:**

| field | live source | why it drifts |
| --- | --- | --- |
| `buyer.name` | `account_profiles.billing_name` (`0104`) | the billing screen edits it |
| `buyer.addressLines` | `account_profiles.billing_address` + `billing_city` | same |
| `buyer.country` | `account_profiles.billing_country` | same |
| `buyer.gstin` | `billing_subscriptions.gstin` | `PUT /api/billing/subscription` edits it |
| `buyer.email` | `billing_subscriptions.billing_email` | same |
| `seller.addressLines` | **nowhere** | the product does not store it at all |

**→ ASK 2 (whoever holds the next migration slot):** one nullable
`billing_invoices.party_snapshot_json TEXT`, written at issue by `issueMissingInvoices`, read in
preference to the live values by `loadInvoiceRecord`. Four nullable columns would do as well. I did
not take a migration number: `migrations/` ended at `0103`, the sibling lane has taken `0104`, and
the slot needs `ALLOTMENT_CEILING` in `test/worker/migrations-w1b.test.ts` — a file three lanes share
this wave. Taking a second number behind the sibling's back is how `0076` got double-claimed.

**→ ASK 3 (client):** a GST tax invoice must carry the **supplier's registered address**. The
product stores it nowhere — `pricing_settings` holds only `gst_registration`, and `org_settings` is
the *customer's* branding. `SELLER_LEGAL_NAME` is V6's own header text (`:3464`); `addressLines` is
deliberately **empty** and the block is omitted, because inventing an address puts a fabrication on a
legal document. It needs a platform setting and the real registered address.

**→ ASK 4 (client):** `place_of_supply` means a **state** (`0046` seeds `'Karnataka'`), and GST
needs the state code. V6's billing screen captures name · city · country and **no state**. The
column is therefore left NULL on every invoice issued from the ledger rather than quietly filled with
a country. Either V6 gains a state field, or we derive the state from the city and accept the error
rate.

Also still missing for literal GST compliance, none of it in V6 or the schema: an **SAC/HSN code**
for the service, the CGST/SGST split for an intra-state supply (we print one combined GST line), and
a signature block. Deliberately not invented.

---

## 3. The two templates, and what each one may claim

`invoiceTemplateOf` reads the invoice's **stored currency** through the sibling lane's
`gstApplies()` — imported, never re-spelled. That lane's own header says why: *"A second copy of
`=== \"INR\"` is how a product ends up charging GST on a screen that says it does not"*, and here the
second copy would be on a tax document. It deliberately does **not** look at an address:

* the country → currency rule is one rule and it lives in `src/shared/plans.ts`
  (`billingCurrencyFor`, `resolveBillingLocale`);
* that rule answers at **order** time. `billing_invoices.currency` is the frozen answer the order was
  priced under, which is the only answer a historical document may use.

A **self-contradictory row** — non-INR carrying tax — renders neither template. The route answers
`409 invoice_tax_contradicts_currency` with a repair message. An export invoice declaring "without
payment of IGST" over a taxed line, or a GST invoice in dollars, is worse than a refusal.

### The honesty stamp, per template

`ADAPTERS` in `provider.ts` is empty by design, `status='completed'` is unreachable, and
`EMAIL_FROM` is unset on every deployment. So:

| | payment unconfirmed (every build today) | payment confirmed |
| --- | --- | --- |
| **title** | "Pro-forma tax invoice" / "Pro-forma export invoice" | "Tax invoice" / "Export invoice" |
| **band** | `NOT A TAX INVOICE · NO PAYMENT RECEIVED` | none |
| **GST template** | "cannot be used to claim input tax credit" | "suitable for input tax credit" (and only with a buyer GSTIN) |
| **export template** | "On payment, this supply **will be** invoiced under LUT…" | `LUT_DECLARATION` outright |

Two decisions worth defending:

1. **The layout is the GST (or export) invoice either way; the title is what the document legally
   IS.** The client asked for a GST-compliant invoice and gets the GST format, with every field,
   from day one. What it does not get until a payment exists is the claim.
2. **The LUT declaration is withheld on an unpaid export document** for a stronger reason than the
   ITC line: it is a statement to the authorities, under a bond, about a supply that has not
   happened. The pro-forma states the position that *will* apply instead.

Every one of those switches on data. **Going live changes no line in these files** — it is the
`ADAPTERS` entry and a webhook, exactly as `provider.ts` reserves. This is the same shape
`docs/plan_parity.md` §8 Q71 already ruled for the success screen.

---

## 4. What the outbox did, never what we hope it will

Applying the 2026-10-02 correction before the fact: the row was stamped `'sent'` forty lines before
delivery was attempted, and the row is what the screens read.

* `invoiceDeliveryOf` **reads** `email_outbox` by the key `invoice:<invoiceId>` and reports `sent` /
  `failed` / `recorded` / `not_attempted`. `deliverySentence` has four sentences and **only one of
  them says an email arrived.**
* The lookup matches `idx_outbox_dedupe`'s **global** shape (`dedupe_key` only), for the reason
  `outbox.ts`'s `findByDedupeKey` documents at length: a lookup scoped tighter than the unique index
  it guards misses the row and then collides on insert. `tenant_id` is selected and checked instead,
  and a cross-tenant key logs and reports `not_attempted`.
* `GET /api/billing` now serves `invoiceDelivery: { configured, promise }`. With `EMAIL_FROM` unset
  the promise is *"GST-compliant invoice available to download · suitable for input tax credit"*;
  V6's literal *"sent to your registered email"* (`:2807`) is served **only** when
  `emailDeliveryConfigured` is true.

**→ ASK 5 (whoever owns `src/server/email/outbox.ts`): one member on `EmailKind`.** Nothing in this
wave *sends* the invoice email, because `EmailKind` is a closed union in a file this lane does not
own and casting past it is precisely the dishonest shortcut this lane exists to prevent. Add
`| "invoice_issued"`; then one `sendEmail` call in `issueMissingInvoices` with
`dedupeKey: invoiceEmailDedupeKey(id)`, `html: renderInvoiceDocument(record)`, and the outbox's own
returned status written nowhere else — `invoiceDeliveryOf` already reports it with **no change to
this lane**, which a worker case proves by inserting the row directly.

---

## 5. 10 GB per seat

V6 states the figure three times and never as a property of a plan — `:2671`, `:2674`, and `:3271`
where it is interpolated into markup by hand. Ported as-is that becomes the string `"10 GB storage"`
in JSX on four screens (plan · annual · entplans · team), and the first time the client raises it the
product says two numbers at once.

`src/server/billing/storage.ts` carries it with the seat model instead: `STORAGE_GB_BY_TIER` (three
tens, because V6 says "Standard / Pro / Premium — 10 GB storage **each**", asserted by a test so it
cannot drift), `STORAGE_GB_PER_SEAT` derived from that table and `null` if tiers ever disagree,
`storageAllowanceOf(TierCounts)` and `storageAllowanceForSeats(n)` with the labels a screen prints
verbatim. The invoice line carries it: `"50-unit pack · 50 credits · 50 GB storage (5 seats × 10 GB)"`.

**→ ASK 6 (the team / plan-screens lane): move `STORAGE_GB_BY_TIER` to `src/shared/seats.ts` and
import it.** That is the right permanent home — `seats.ts` models the purchased seat and is shared,
so the plan screens can import the constant instead of reading it off an API response. It lives in
`src/server/billing/` only because `seats.ts` is another lane's file this wave. Until then the figure
is served at `GET /api/billing` → `storage: { gbPerSeat, seats, totalGb, perSeatLabel, totalLabel }`.
**Do not write "10 GB" into a screen.**

---

## 6. One real defect fixed, and one assertion restated

**The defect** (`src/server/billing/ledger.ts`, `issueMissingInvoices`): `gst_registration` was
written as `tax.registration ?? sub?.gstin ?? null` — **our** GST registration falling back to **the
customer's**, into one column — and `routes/billing.ts` then printed that column under the label
"Our GST registration". `0046`'s own comment on `billing_subscriptions.gstin` says it plainly: *"The
CUSTOMER's GSTIN (ours is `pricing_settings.gst_registration`)"*.

So on any workspace where `pricing_settings.gst_registration` is NULL — it is nullable and the Price
configuration screen can clear it — **the invoice declared the customer as the supplier of their own
purchase.** Not a cosmetic mislabel: a tax invoice naming the wrong supplier GSTIN is unusable for
input tax credit, which is the one job V6 gives this document. Now `tax.registration` only, NULL when
we hold none, and the line is omitted rather than printing someone else's number. The customer's
GSTIN is read from the subscription into the "Billed to" block, where it belongs.

**The restated assertion** (`test/worker/billing.test.ts`, *"serves the invoice document as a
download"* — a test file covering this lane, flagged per §4): it asserted
`toContain("suitable for input tax credit")` against `0046`'s seeded row, which has no linked payment
intent and for which no build can produce one. It was pinning a promise of input tax credit on a
purchase nobody paid for — the same class of claim as the row stamped `'sent'` before delivery. Now
asserts the refusal, with the promise as an explicit negative; the paid branch is asserted in the new
suite.

---

## 7. Mobile-first, measured on the output

Four worker cases read the rendered HTML rather than trusting prose:

* a `viewport` meta, and `padding:16px` in the **base** `body` rule — widened to 24px only at
  ≥560px, not the other way round;
* **no `min-width` declaration anywhere.** The only occurrence of the string in the whole document is
  the one `@media (min-width:560px)` query, and the test checks both the count and the shape
  (`/[;{]\s*min-width:/`) so a retrofitted `table{min-width:520px}` is caught. The line-items table
  is `width:100%; table-layout:fixed` with a `word-break:break-word` description cell, so four
  columns compress instead of forcing a page scroll;
* the table is nonetheless inside its own `.scroll{overflow-x:auto}`, so an unbreakable string
  scrolls the **table**, never the page;
* the label/value rows **stack** at phone width and only become two columns at ≥560px — the failure
  in `routes/account.ts:586`'s `th{width:200px}`, which eats a 358px content box.

`@media print` strips the chrome, because "download" here is a page the browser prints to PDF.

**The download is a real server response**, `content-disposition: attachment`. The prototype does the
opposite — `acDownloadInvoice()` (`:3417`) builds the markup in the page and `window.open`s it, then
apologises ("Please allow pop-ups to download the invoice"). A sandboxed client cannot do that at
all, and a tax document must not be assembled by code the customer can edit.

---

## 8. Not done, on purpose

* **No Razorpay adapter.** `ADAPTERS` stays empty. Nothing in this lane writes a card, CVV, expiry or
  any instrument field, and no route accepts one.
* **No invoice email is sent** (ASK 5). Every invoice honestly reports `not_attempted`.
* **No migration** (ASK 2, ASK 4).
* **The VC edition is untouched.** No gate was needed: the invoice route is edition-agnostic and
  `GET /api/billing` already served both; the only edition-dependent string is the fallback workspace
  name, unchanged. `e2e/vc-intake.spec.ts` not run (e2e is out of scope for this lane), but nothing
  here is reachable from the intake path.
