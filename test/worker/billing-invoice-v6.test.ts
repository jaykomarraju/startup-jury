import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import {
  LUT_DECLARATION,
  SELLER_LEGAL_NAME,
  UNSNAPSHOTTED_INVOICE_FIELDS,
  deliverySentence,
  invoiceEmailDedupeKey,
  invoiceTemplateOf,
  invoiceTitleOf,
  loadInvoiceRecord,
  renderInvoiceDocument,
  supportsInputTaxCredit,
  type InvoiceRecord,
} from "../../src/server/billing/invoice";
import {
  STORAGE_GB_BY_TIER,
  STORAGE_GB_PER_SEAT,
  storageAllowanceForSeats,
  storageAllowanceOf,
} from "../../src/server/billing/storage";
import { issueMissingInvoices } from "../../src/server/billing/ledger";
import { DEFAULT_TENANT_ID, type TenantScope } from "../../src/shared/tenant";

/**
 * V6-INVOICE — the two invoice templates, the record behind them, and the
 * 10 GB-per-seat figure.
 *
 * What this suite exists to hold, in the order it matters:
 *
 *  1. **An invoice is a record, not a view.** The rate a document was issued
 *     under survives an admin raising the rate. This is the one property that
 *     cannot be repaired after the fact, because by then the customer has filed
 *     their copy.
 *  2. **Which template follows the STORED currency**, and a row that contradicts
 *     itself is refused rather than rendered as the less wrong document.
 *  3. **The document never claims more than happened** — no input-tax-credit
 *     promise without a confirmed payment, no LUT declaration over a supply that
 *     has not been made, and no "sent to your registered email" without an outbox
 *     row that says sent.
 *  4. **Mobile-first**, measured on the rendered HTML rather than asserted in
 *     prose: these are documents people open on a phone.
 *  5. The seller's GSTIN on a tax invoice is the SELLER'S.
 *
 * Why the pure cases live in the worker project and not `test/unit`: nothing in
 * `test/unit` imports a type from `src/server`, and `tsconfig.json` includes
 * `test/unit` with only `src/client` + `src/shared`. Pulling `src/server` into
 * that graph to save a few milliseconds is a typecheck risk for every other lane.
 */

const BASE = "https://example.com";
const ADMIN = "nisha.kapoor@demo.startupjury.ai";

async function login(email: string): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "demo1234" }),
  });
  const setCookie = res.headers.get("set-cookie");
  return setCookie ? setCookie.split(";")[0] : "";
}

const get = (p: string, c: string) => SELF.fetch(`${BASE}${p}`, { headers: { cookie: c } });
const E = () => env as unknown as import("../../src/server/types").Env;
const W = (edition: "incubator" | "vc"): TenantScope => ({
  tenantId: DEFAULT_TENANT_ID,
  edition,
});

/** `0046`'s seeded incubator invoice: ₹20,000 + ₹3,600 GST, place of supply Karnataka. */
const SEEDED = "inv_cl_inc_0002";

// ── A record to render, with nothing read from anywhere ──────────────────────

function record(over: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    id: "inv_fixture",
    number: "INV-2026-9001",
    issuedAt: "2026-06-03 16:20:00",
    currency: "INR",
    description: "50-unit pack",
    units: 50,
    seats: 5,
    subtotalMinor: 2_000_000,
    taxMinor: 360_000,
    totalMinor: 2_360_000,
    ratePct: 18,
    placeOfSupply: "Karnataka",
    seller: {
      name: SELLER_LEGAL_NAME,
      addressLines: [],
      gstin: "29ABCDE1234F1Z5",
      email: "support@startupjury.ai",
      country: "India",
    },
    buyer: {
      name: "Demo Incubator",
      addressLines: [],
      gstin: "27AAAAA0000A1Z5",
      email: "billing@demo.test",
      country: null,
    },
    payment: { state: "unconfirmed", reference: "RZP250603112244", intentStatus: null },
    delivery: { state: "not_attempted", to: "billing@demo.test", attemptedAt: null, reason: null },
    storage: storageAllowanceForSeats(5),
    ...over,
  };
}

/** USD: no GST, so `priceBreakdown` leaves tax at zero and total equals subtotal. */
const exportRecord = (over: Partial<InvoiceRecord> = {}): InvoiceRecord =>
  record({
    currency: "USD",
    subtotalMinor: 53_500,
    taxMinor: 0,
    totalMinor: 53_500,
    placeOfSupply: null,
    buyer: { ...record().buyer, gstin: null, country: "Singapore" },
    ...over,
  });

const html = (r: InvoiceRecord): string => {
  const out = renderInvoiceDocument(r);
  expect(out, "this record was expected to render").not.toBeNull();
  return out!;
};

// ── 1. Which template, from the stored currency ──────────────────────────────

describe("invoiceTemplateOf", () => {
  it("picks the template from the STORED currency, never from an address", () => {
    expect(invoiceTemplateOf({ currency: "INR", taxMinor: 360_000 })).toBe("gst_tax_invoice");
    expect(invoiceTemplateOf({ currency: "INR", taxMinor: 0 })).toBe("gst_tax_invoice");
    expect(invoiceTemplateOf({ currency: "USD", taxMinor: 0 })).toBe("export_invoice");
    expect(invoiceTemplateOf({ currency: "SGD", taxMinor: 0 })).toBe("export_invoice");
  });

  it("refuses a row that contradicts itself rather than picking the less wrong document", () => {
    // A foreign-currency invoice carrying tax. An export template would declare
    // "without payment of IGST" over a taxed line; a GST template would be in the
    // wrong currency. Neither may be rendered.
    expect(invoiceTemplateOf({ currency: "USD", taxMinor: 1 })).toBeNull();
    expect(renderInvoiceDocument(exportRecord({ taxMinor: 1, totalMinor: 53_501 }))).toBeNull();
  });
});

// ── 2. The GST tax invoice ───────────────────────────────────────────────────

describe("the GST tax-invoice template", () => {
  it("states the GST line at the SNAPSHOTTED rate and names the place of supply", () => {
    const doc = html(record());
    expect(doc).toContain("GST (18%)");
    expect(doc).toContain("₹3,600");
    expect(doc).toContain("₹23,600");
    expect(doc).toContain("Total (incl. GST)");
    expect(doc).toContain("Place of supply: Karnataka");
    // A rate with real decimals is printed with them, not rounded away.
    expect(html(record({ ratePct: 12.5 }))).toContain("GST (12.50%)");
  });

  it("carries NO export declaration", () => {
    // The declaration is a statement about an export supply. On a domestic
    // invoice it is simply false.
    expect(html(record())).not.toContain(LUT_DECLARATION);
    expect(html(record())).not.toContain("IGST");
  });

  it("is titled a pro-forma and withholds input tax credit while payment is unconfirmed", () => {
    const r = record();
    expect(invoiceTitleOf(r)).toBe("Pro-forma tax invoice");
    expect(supportsInputTaxCredit(r)).toBe(false);
    const doc = html(r);
    expect(doc).toContain("NOT A TAX INVOICE · NO PAYMENT RECEIVED");
    expect(doc).toContain("cannot be used to claim input tax credit");
    expect(doc).not.toContain("suitable for input tax credit");
  });

  it("becomes a tax invoice fit for input tax credit once an intent says completed", () => {
    // Unreachable on every build today (`ADAPTERS` is empty by design), which is
    // exactly why it is asserted here: going live must change no line of the
    // template, only the data.
    const r = record({
      payment: { state: "completed", reference: "RZP123", intentStatus: "completed" },
    });
    expect(invoiceTitleOf(r)).toBe("Tax invoice");
    expect(supportsInputTaxCredit(r)).toBe(true);
    const doc = html(r);
    expect(doc).toContain("suitable for input tax credit");
    expect(doc).not.toContain("NOT A TAX INVOICE");
  });

  it("withholds input tax credit from a paid invoice with no buyer GSTIN", () => {
    // ITC needs the recipient's registration on the document. A paid invoice to
    // an unregistered buyer is a valid tax invoice that cannot support a claim.
    const r = record({
      payment: { state: "completed", reference: "RZP123", intentStatus: "completed" },
      buyer: { ...record().buyer, gstin: null },
    });
    expect(supportsInputTaxCredit(r)).toBe(false);
    expect(html(r)).toContain("cannot be used to claim input tax credit");
  });
});

// ── 3. The export invoice ────────────────────────────────────────────────────

describe("the export-invoice template", () => {
  it("applies no GST and says the customer owes their own local tax", () => {
    const doc = html(exportRecord());
    expect(doc).toContain("$535");
    expect(doc).toContain("Not applicable");
    expect(doc).not.toContain("GST (");
    expect(doc).not.toContain("incl. GST");
    expect(doc).toContain("responsible for any VAT, GST or equivalent");
    expect(doc).not.toContain("input tax credit");
  });

  it("states the LUT position forward-looking while nothing has been paid", () => {
    // An LUT declaration is a statement to the authorities about a supply that HAS
    // been made. Printing it on a document for which no payment was received would
    // assert a supply that has not happened, under a bond.
    const r = exportRecord();
    expect(invoiceTitleOf(r)).toBe("Pro-forma export invoice");
    const doc = html(r);
    expect(doc).toContain("NOT A TAX INVOICE · NO PAYMENT RECEIVED");
    expect(doc).toContain("On payment, this supply will be invoiced under LUT");
    expect(doc).not.toContain(LUT_DECLARATION);
  });

  it("makes the declaration outright once the supply is paid for", () => {
    const r = exportRecord({
      payment: { state: "completed", reference: "RZP777", intentStatus: "completed" },
    });
    expect(invoiceTitleOf(r)).toBe("Export invoice");
    const doc = html(r);
    expect(doc).toContain(LUT_DECLARATION);
    expect(doc).not.toContain("On payment, this supply will be invoiced");
    expect(doc).not.toContain("NOT A TAX INVOICE");
  });
});

// ── 4. A record, not a view ──────────────────────────────────────────────────

describe("an invoice is a record, not a view", () => {
  it("renders byte-identically from the same record, twice", () => {
    // `renderInvoiceDocument` reads no clock, no settings and no database, so a
    // reissue of an unchanged record cannot differ. A `new Date()` anywhere in the
    // template breaks this.
    const r = record();
    expect(renderInvoiceDocument(r)).toBe(renderInvoiceDocument(r));
  });

  it("keeps an issued invoice at its OWN rate after the platform rate changes", async () => {
    const admin = await login(ADMIN);
    const before = await (await get(`/api/billing/invoices/${SEEDED}/document`, admin)).text();
    expect(before).toContain("GST (18%)");
    expect(before).toContain("₹23,600");

    // `pricing_settings` is platform-global; an owner raising GST must not rewrite
    // documents customers have already filed.
    await env.DB.prepare("UPDATE pricing_settings SET gst_rate_pct = 28 WHERE id = 1").run();
    const after = await (await get(`/api/billing/invoices/${SEEDED}/document`, admin)).text();

    expect(after, "a rate change rewrote an invoice that was already issued").toContain("GST (18%)");
    expect(after).not.toContain("GST (28%)");
    expect(after).toContain("₹23,600");
    expect(after).toBe(before);
  });

  it("names the fields a reissue still reads live, so the gap cannot be forgotten", () => {
    // Not a celebration of a defect — a pin. `billing_invoices` has no column for
    // the party details, so these five are read live and a reissue follows today's
    // values. The migration is the first ask in docs/parity-requests/V6-INVOICE.md;
    // when it lands, entries leave this list and this assertion moves with them.
    expect(UNSNAPSHOTTED_INVOICE_FIELDS).toContain("buyer.gstin");
    expect(UNSNAPSHOTTED_INVOICE_FIELDS).toContain("buyer.addressLines");
    expect(UNSNAPSHOTTED_INVOICE_FIELDS).toContain("seller.addressLines");
    // Everything the document DOES snapshot is absent from the gap list.
    for (const snapshotted of ["number", "issuedAt", "ratePct", "totalMinor", "placeOfSupply"]) {
      expect(UNSNAPSHOTTED_INVOICE_FIELDS).not.toContain(snapshotted);
    }
  });
});

// ── 4b. The buyer block is the V6 billing address ────────────────────────────

describe("the Billed to block", () => {
  it("is the V6 billing address, and its name outranks the workspace trading name", async () => {
    // `0104` (the sibling lane) is the four fields `#acs-billing` captures, and
    // "Name or company to appear on the invoice" (V6 `:2715`) is literally what
    // that field is for — so it wins over `org_settings.branding_json.orgName`,
    // which is a dashboard heading rather than a legal payee.
    const scope = W("vc");
    const id = "inv_billto_probe";
    await env.DB.prepare(
      "INSERT INTO billing_invoices (id, tenant_id, edition, number, kind, description, units, currency, " +
        "subtotal_minor, tax_minor, total_minor, gst_rate_pct, issued_at) " +
        "VALUES (?, ?, 'vc', 'INV-2026-9301', 'invoice', 'Bill-to probe', NULL, 'INR', 1000, 180, 1180, 18, '2026-10-04 00:00:00')",
    )
      .bind(id, DEFAULT_TENANT_ID)
      .run();
    await env.DB.prepare(
      "INSERT INTO account_profiles (tenant_id, edition, account_type, work_email, first_name, last_name, " +
        "billing_name, billing_city, billing_country, billing_address) " +
        "VALUES (?, 'vc', 'individual', 'cfo@buyer.test', 'Asha', 'Rao', 'Northwind Capital LLP', " +
        "'Hyderabad', 'India', '4th Floor, Jubilee Hills\nPlot 12') " +
        "ON CONFLICT (tenant_id, edition) DO UPDATE SET billing_name = excluded.billing_name, " +
        "billing_city = excluded.billing_city, billing_country = excluded.billing_country, " +
        "billing_address = excluded.billing_address",
    )
      .bind(DEFAULT_TENANT_ID)
      .run();

    const r = await loadInvoiceRecord(E(), scope, id, "Investor workspace");
    expect(r!.buyer.name).toBe("Northwind Capital LLP");
    // Each line of the textarea is its own line on the document, plus the city.
    expect(r!.buyer.addressLines).toEqual([
      "4th Floor, Jubilee Hills",
      "Plot 12",
      "Hyderabad",
    ]);
    expect(r!.buyer.country).toBe("India");

    const doc = html(r!);
    expect(doc).toContain("Northwind Capital LLP");
    expect(doc).toContain("4th Floor, Jubilee Hills");
    expect(doc).toContain("Hyderabad");
    expect(doc).not.toContain("Investor workspace");
  });
});

// ── 5. Honesty about what was sent ───────────────────────────────────────────

describe("the document reports what the outbox DID", () => {
  it("has four sentences and only one of them claims an email arrived", () => {
    expect(deliverySentence({ state: "not_attempted", to: null, attemptedAt: null, reason: null })).toContain(
      "Not emailed",
    );
    expect(
      deliverySentence({ state: "recorded", to: "a@b.test", attemptedAt: "2026-10-04", reason: null }),
    ).toContain("NOT emailed");
    expect(
      deliverySentence({ state: "sent", to: "a@b.test", attemptedAt: "2026-10-04", reason: null }),
    ).toBe("Emailed to a@b.test on 2026-10-04.");
    expect(
      deliverySentence({
        state: "failed",
        to: "a@b.test",
        attemptedAt: "2026-10-04",
        reason: "Error: no domain",
      }),
    ).toContain("failed");
  });

  it("says NOT emailed for a recorded outbox row, and Emailed once the row says sent", async () => {
    // The 2026-10-02 correction, applied to the invoice: the ROW's own answer is
    // reported, never a status stamped before the attempt. With `EMAIL_FROM` unset
    // — every deployment — `sendEmail` writes `status='recorded'`.
    const scope = W("vc");
    const id = "inv_delivery_probe";
    await env.DB.prepare(
      "INSERT INTO billing_invoices (id, tenant_id, edition, number, kind, description, units, currency, " +
        "subtotal_minor, tax_minor, total_minor, gst_rate_pct, issued_at) " +
        "VALUES (?, ?, 'vc', 'INV-2026-9101', 'invoice', 'Delivery probe', NULL, 'INR', 1000, 180, 1180, 18, '2026-10-04 00:00:00')",
    )
      .bind(id, DEFAULT_TENANT_ID)
      .run();

    const key = invoiceEmailDedupeKey(id);
    expect(key).toBe(`invoice:${id}`);

    const before = await loadInvoiceRecord(E(), scope, id, "Investor workspace");
    expect(before!.delivery.state).toBe("not_attempted");
    expect(html(before!)).toContain("Not emailed");

    await env.DB.prepare(
      "INSERT INTO email_outbox (id, tenant_id, kind, to_email, subject, body, status, created_at, dedupe_key) " +
        "VALUES ('mail_inv_probe', ?, 'invoice_issued', 'cfo@buyer.test', 'Your invoice', 'body', 'recorded', '2026-10-04 01:00:00', ?)",
    )
      .bind(DEFAULT_TENANT_ID, key)
      .run();

    const recorded = await loadInvoiceRecord(E(), scope, id, "Investor workspace");
    expect(recorded!.delivery).toMatchObject({ state: "recorded", to: "cfo@buyer.test" });
    const recordedDoc = html(recorded!);
    expect(recordedDoc).toContain("NOT emailed");
    expect(recordedDoc).not.toContain("Emailed to cfo@buyer.test on");

    await env.DB.prepare("UPDATE email_outbox SET status = 'sent' WHERE id = 'mail_inv_probe'").run();
    const sent = await loadInvoiceRecord(E(), scope, id, "Investor workspace");
    expect(sent!.delivery.state).toBe("sent");
    expect(html(sent!)).toContain("Emailed to cfo@buyer.test on 2026-10-04");
  });

  it("GET /api/billing promises a download, not an email, while EMAIL_FROM is unset", async () => {
    const admin = await login(ADMIN);
    const view = (await (await get("/api/billing", admin)).json()) as {
      invoiceDelivery: { configured: boolean; promise: string };
    };
    expect(view.invoiceDelivery.configured).toBe(false);
    expect(view.invoiceDelivery.promise).toContain("available to download");
    expect(view.invoiceDelivery.promise).toContain("suitable for input tax credit");
    expect(
      view.invoiceDelivery.promise,
      "V6's success-screen copy must not promise mail this deployment cannot send",
    ).not.toContain("sent to your registered email");
  });
});

// ── 6. The route ─────────────────────────────────────────────────────────────

describe("GET /api/billing/invoices/:id/document", () => {
  it("is a real server-rendered download, not a blob built in the page", async () => {
    const admin = await login(ADMIN);
    const res = await get(`/api/billing/invoices/${SEEDED}/document`, admin);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    expect(res.headers.get("content-disposition")).toMatch(
      /attachment; filename="INV-2026-0001\.html"/,
    );
    const doc = await res.text();
    expect(doc).toContain("INV-2026-0001");
    expect(doc).toContain(SELLER_LEGAL_NAME);
    expect(doc).toContain("Pro-forma tax invoice");
  });

  it("refuses a self-contradictory stored row with a named 409 instead of a wrong document", async () => {
    const admin = await login(ADMIN);
    await env.DB.prepare(
      "INSERT INTO billing_invoices (id, tenant_id, edition, number, kind, description, units, currency, " +
        "subtotal_minor, tax_minor, total_minor, gst_rate_pct, issued_at) " +
        "VALUES ('inv_contradiction', ?, 'incubator', 'INV-2026-9201', 'invoice', 'Bad row', NULL, 'USD', " +
        "53500, 9630, 63130, 18, '2026-10-04 00:00:00')",
    )
      .bind(DEFAULT_TENANT_ID)
      .run();
    const res = await get("/api/billing/invoices/inv_contradiction/document", admin);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; detail: string };
    expect(body.error).toBe("invoice_tax_contradicts_currency");
    expect(body.detail).toContain("INV-2026-9201");
  });
});

// ── 7. The seller's GSTIN is the SELLER'S ────────────────────────────────────

describe("issueMissingInvoices snapshots the supplier registration", () => {
  it("leaves gst_registration NULL rather than filing the CUSTOMER's GSTIN as the supplier's", async () => {
    // Before this lane the column was `tax.registration ?? sub.gstin ?? null`, and
    // the template printed it under "Our GST registration". With the platform
    // registration cleared — the Price configuration screen can clear it — every
    // invoice declared the customer as the supplier of their own purchase, which
    // makes the document unusable for the one job V6 gives it.
    const scope = W("vc");
    await env.DB.prepare("UPDATE pricing_settings SET gst_registration = NULL WHERE id = 1").run();
    await env.DB.prepare(
      "UPDATE billing_subscriptions SET gstin = '27CUSTM0000C1Z5' WHERE tenant_id = ? AND edition = 'vc'",
    )
      .bind(DEFAULT_TENANT_ID)
      .run();
    await env.DB.prepare(
      "INSERT INTO credit_ledger (id, tenant_id, edition, delta, reason, amount_minor, currency, note) " +
        "VALUES ('cl_seller_gstin_probe', ?, 'vc', 10, 'purchase', 500000, 'INR', '10-unit pack')",
    )
      .bind(DEFAULT_TENANT_ID)
      .run();

    expect(await issueMissingInvoices(E(), scope)).toBeGreaterThan(0);

    const row = await env.DB.prepare(
      "SELECT gst_registration FROM billing_invoices WHERE ledger_id = 'cl_seller_gstin_probe'",
    ).first<{ gst_registration: string | null }>();
    expect(row, "the purchase was issued no invoice at all").toBeTruthy();
    expect(
      row!.gst_registration,
      "the customer's own GSTIN was filed as the supplier's registration",
    ).toBeNull();
    expect(row!.gst_registration).not.toBe("27CUSTM0000C1Z5");
  });
});

// ── 8. Mobile-first, measured on the output ──────────────────────────────────

describe("the document at 390px", () => {
  const docs = () => [html(record()), html(exportRecord())];

  it("declares a viewport and a 16px gutter before any media query", () => {
    for (const doc of docs()) {
      expect(doc).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
      // The gutter is in the base `body` rule, so it holds at phone width and is
      // only WIDENED at >=560px — not the other way round.
      expect(doc).toMatch(/body\{margin:0;padding:16px;/);
      expect(doc).toMatch(/@media \(min-width:560px\)\{\s*body\{padding:24px\}/);
    }
  });

  it("sets no min-width anywhere, so the PAGE never scrolls sideways", () => {
    // The measured failure mode in this product: ten screens carry a table wider
    // than the viewport because a `min-width` was retrofitted onto a desktop
    // layout. A table with no min-width compresses instead.
    for (const doc of docs()) {
      // No RULE sets one. A declaration is always preceded by `{` or `;`, which a
      // media query's `(min-width:...)` is not — so this catches a retrofitted
      // `table{min-width:520px}` and still allows the one query below.
      expect(doc).not.toMatch(/[;{]\s*min-width:/);
      // And that query is the ONLY occurrence of the string in the document, so a
      // second one cannot sneak in as a rule the regex above happens to miss.
      expect(doc.match(/min-width/g)).toEqual(["min-width"]);
      expect(doc).toMatch(/@media \(min-width:560px\)/);
    }
  });

  it("keeps the wide table inside its own overflow-x container", () => {
    for (const doc of docs()) {
      expect(doc).toContain(".scroll{overflow-x:auto");
      expect(doc).toMatch(/<div class="scroll"><table>/);
      expect(doc).toContain("table-layout:fixed");
      // The one cell that can hold an unbounded string wraps rather than widening.
      expect(doc).toMatch(/td:first-child\{text-align:left;width:46%;word-break:break-word\}/);
    }
  });

  it("stacks the label/value rows at phone width and only pairs them on a wider screen", () => {
    for (const doc of docs()) {
      expect(doc).toMatch(/\.kv\{display:grid;grid-template-columns:1fr;/);
      expect(doc).toMatch(/\.kv\{grid-template-columns:170px 1fr\}/);
    }
  });
});

// ── 9. 10 GB per seat, carried with the seat model ───────────────────────────

describe("storage per seat", () => {
  it("is 10 GB, and the same on all three tiers, as V6 states", () => {
    // `AISJ_MyAccount_V6.HTM:2671` — "Standard / Pro / Premium — 10 GB storage
    // each". If a future catalogue differs by tier this fails here, in one place,
    // instead of four screens quietly disagreeing.
    expect(STORAGE_GB_BY_TIER).toEqual({ standard: 10, pro: 10, premium: 10 });
    expect(STORAGE_GB_PER_SEAT).toBe(10);
  });

  it("sums over a tier count and labels a total the screens can print verbatim", () => {
    expect(storageAllowanceOf({ standard: 2, pro: 1, premium: 0 })).toMatchObject({
      seats: 3,
      totalGb: 30,
      perSeatLabel: "10 GB storage",
      totalLabel: "30 GB storage (3 seats × 10 GB)",
    });
    expect(storageAllowanceForSeats(1).totalLabel).toBe("10 GB storage (1 seat × 10 GB)");
    // Nothing bought yet: the rate is the only true sentence, not a total of zero.
    expect(storageAllowanceForSeats(0).totalLabel).toBe("10 GB storage per seat");
  });

  it("is served by the API so no screen writes the figure into copy", async () => {
    const admin = await login(ADMIN);
    const view = (await (await get("/api/billing", admin)).json()) as {
      subscription: { seats: number };
      storage: { gbPerSeat: number; seats: number; totalGb: number; totalLabel: string };
    };
    expect(view.storage.gbPerSeat).toBe(10);
    expect(view.storage.seats).toBe(view.subscription.seats);
    expect(view.storage.totalGb).toBe(view.subscription.seats * 10);
    expect(view.storage.totalLabel).toContain("10 GB");
  });

  it("is carried onto the invoice line rather than typed into it", () => {
    // The seeded subscription is 5 seats, so the document says 50 GB — and says it
    // from the seat model, which is what makes raising the allowance a one-line
    // data change instead of a grep across four screens plus a template.
    expect(html(record({ seats: 5, storage: storageAllowanceForSeats(5) }))).toContain(
      "50 GB storage (5 seats × 10 GB)",
    );
    // A workspace on no plan has no seats, so no storage claim is made at all.
    expect(html(record({ seats: 0, storage: storageAllowanceForSeats(0) }))).not.toContain("GB storage");
  });
});
