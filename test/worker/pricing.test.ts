import { SELF, env } from "cloudflare:test";
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { loadDraft } from "../../src/server/routes/pricing";
import {
  perDeckArtefacts,
  priceBooksEqual,
  type PriceBook,
  type PublishedPriceBook,
} from "../../src/shared/priceBook";

/**
 * W4-D — `/api/pricing`.
 *
 * Four properties, each of which is the whole point of the section:
 *
 *   1. **A draft edit is invisible to a reader until it is published.**
 *   2. **Publishing is atomic** — an interrupted publish leaves the previous
 *      version intact, and there is never more than one live version.
 *   3. **A publish is reversible** — the predecessor is kept and can be
 *      restored.
 *   4. **AuthZ** — editing is admin-and-console-permission; reading the live
 *      catalogue is any authenticated non-mentor.
 *
 * Plus the §8 Q1 ruling: no published price may expose a per-deck derivation,
 * and the store itself is checked, not just the request body.
 */

const BASE = "https://example.com";
const ADMIN = "nisha.kapoor@demo.startupjury.ai"; //        incubator admin
const ASSOCIATE = "sunita.rao@demo.startupjury.ai"; //      program_associate — not an admin
const MENTOR = "anil.mehta@demo.startupjury.ai"; //         directory record, no pipeline authority

async function login(email: string): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "demo1234" }),
  });
  const setCookie = res.headers.get("set-cookie");
  return setCookie ? setCookie.split(";")[0] : "";
}

interface EditorPayload {
  draft: PriceBook;
  published: PublishedPriceBook | null;
  dirty: boolean;
  errors: string[];
  lastSavedAt: string | null;
  versions: { version: number; status: string }[];
  previousVersion: number | null;
}

function editor(cookie: string): Promise<EditorPayload> {
  return SELF.fetch(`${BASE}/api/pricing`, { headers: { cookie } }).then((r) =>
    r.json<EditorPayload>(),
  );
}

function published(cookie: string): Promise<Response> {
  return SELF.fetch(`${BASE}/api/pricing/published`, { headers: { cookie } });
}

function putDraft(cookie: string, body: unknown): Promise<Response> {
  return SELF.fetch(`${BASE}/api/pricing/draft`, {
    method: "PUT",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** The Standard subscription's INR price, in paise, from a book. */
function standardInr(book: PriceBook): number {
  return book.plans.find((p) => p.code === "standard")?.amounts.INR ?? -1;
}

/**
 * Storage is isolated per FILE, not per test, so a suite that publishes
 * versions and edits the catalogue would otherwise depend on its own order —
 * the non-determinism §8 Q32 already has enough of. The seeded state is
 * captured once and restored before each test, `sqlite_sequence` included, so
 * every test starts at "version 1 is live, draft equals published".
 */
const PRICING_TABLES = [
  "currencies",
  "fx_rates",
  "price_groups",
  "price_plans",
  "price_amounts",
  "pricing_versions",
  "pricing_settings",
  "pricing_draft_meta",
] as const;

type Row = Record<string, unknown>;
const seeded: Record<string, Row[]> = {};

function insertStmt(table: string, row: Row) {
  const keys = Object.keys(row);
  return env.DB.prepare(
    `INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`,
  ).bind(...(keys.map((k) => row[k]) as never[]));
}

beforeAll(async () => {
  for (const table of PRICING_TABLES) {
    const rows = await env.DB.prepare(`SELECT * FROM ${table}`).all<Row>();
    seeded[table] = rows.results;
  }
});

let admin = "";
beforeEach(async () => {
  const stmts = [
    // Children first: `price_amounts` references both plans and currencies.
    ...["price_amounts", "fx_rates", "price_plans", "currencies", "price_groups", "pricing_versions", "pricing_settings", "pricing_draft_meta"].map(
      (t) => env.DB.prepare(`DELETE FROM ${t}`),
    ),
    // …so the next publish is version 2 again, not version 2 + whatever the
    // previous test published.
    env.DB.prepare("DELETE FROM sqlite_sequence WHERE name = 'pricing_versions'"),
    ...["currencies", "fx_rates", "price_groups", "price_plans", "price_amounts", "pricing_versions", "pricing_settings", "pricing_draft_meta"].flatMap(
      (t) => seeded[t].map((row) => insertStmt(t, row)),
    ),
    env.DB.prepare("DELETE FROM audit_log WHERE action LIKE 'price%'"),
  ];
  await env.DB.batch(stmts);
  admin = await login(ADMIN);
});

describe("the seeded catalogue", () => {
  it("publishes version 1, and it is exactly the seeded draft", async () => {
    // `0047` seeds the published document as a literal. If someone edits a seed
    // row and forgets that line, the two diverge — and this is where it shows.
    const state = await editor(admin);
    expect(state.published?.version).toBe(1);
    expect(state.dirty).toBe(false);
    expect(priceBooksEqual(state.draft, state.published as PriceBook)).toBe(true);
  });

  it("carries no per-deck rate, no per-deck column and no saving percentage", async () => {
    const state = await editor(admin);
    const live = state.published as PublishedPriceBook;

    // §8 Q1: the ruling, asserted against what is PUBLISHED.
    expect(perDeckArtefacts(live)).toEqual([]);
    expect(live.plans.map((p) => p.code)).not.toContain("base_rate");
    for (const plan of live.plans) {
      expect(Object.keys(plan)).not.toContain("savingPct");
      expect(Object.keys(plan)).not.toContain("perDeck");
    }
    // And the row `0033` seeded for it is gone from the store as well.
    const row = await env.DB.prepare("SELECT id FROM price_plans WHERE code = 'base_rate'").first();
    expect(row).toBeNull();
    const labelled = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM price_amounts WHERE per_unit_label IS NOT NULL",
    ).first<{ n: number }>();
    expect(labelled?.n).toBe(0);
  });

  it("activates the prototype's four currencies and offers the other three unrated", async () => {
    const { draft } = await editor(admin);
    expect(draft.currencies.filter((c) => c.active).map((c) => c.code)).toEqual([
      "INR",
      "USD",
      "GBP",
      "EUR",
    ]);
    expect(draft.currencies.map((c) => c.code)).toHaveLength(7);
    // §1.3 — no rates vendor, so nothing claims to be live.
    expect(draft.fx.every((f) => f.source === "manual")).toBe(true);
  });
});

describe("a draft is invisible until it is published", () => {
  it("does not move the live catalogue when the draft changes", async () => {
    const before = await editor(admin);
    const wasLive = standardInr(before.published as PriceBook);

    const res = await putDraft(admin, {
      plans: [{ id: "pp_standard", amounts: { INR: 129900 } }],
    });
    expect(res.status).toBe(200);

    const after = await editor(admin);
    expect(standardInr(after.draft)).toBe(129900);
    expect(after.dirty).toBe(true);
    // The reader's endpoint — what Credits & billing and Buy credits call.
    const live = await published(admin).then((r) => r.json<PublishedPriceBook>());
    expect(standardInr(live)).toBe(wasLive);
    expect(live.version).toBe(1);
  });

  it("makes the draft live, and only then, on publish", async () => {
    await putDraft(admin, { plans: [{ id: "pp_standard", amounts: { INR: 129900 } }] });
    const res = await SELF.fetch(`${BASE}/api/pricing/publish`, {
      method: "POST",
      headers: { cookie: admin },
    });
    expect(res.status).toBe(200);

    const live = await published(admin).then((r) => r.json<PublishedPriceBook>());
    expect(standardInr(live)).toBe(129900);
    expect(live.version).toBe(2);
    expect((await editor(admin)).dirty).toBe(false);
  });
});

describe("publishing is atomic", () => {
  it("leaves the previous version live when the publish is refused", async () => {
    // The interruption a real publish can actually suffer: the draft turns out
    // to be unpublishable. Nothing may be half-written on the way to finding out.
    await env.DB.prepare("UPDATE price_plans SET features = '₹500/deck' WHERE code = 'pack_10'").run();


    const res = await SELF.fetch(`${BASE}/api/pricing/publish`, {
      method: "POST",
      headers: { cookie: admin },
    });
    expect(res.status).toBe(400);
    const body = await res.json<{ error: string; errors: string[] }>();
    expect(body.error).toBe("invalid_price_book");
    expect(body.errors.join(" ")).toContain("per-deck figure");

    const rows = await env.DB.prepare("SELECT version, status FROM pricing_versions").all<{
      version: number;
      status: string;
    }>();
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0]).toMatchObject({ version: 1, status: "published" });
  });

  it("rolls the whole batch back when one statement in it fails", async () => {
    // The shape `publishDocument()` uses: demote the incumbent, insert the
    // successor. This proves the demotion cannot survive a failed insert — the
    // half-published state the section must never have.
    await expect(
      env.DB.batch([
        env.DB.prepare("UPDATE pricing_versions SET status = 'superseded' WHERE status = 'published'"),
        // NOT NULL on `document`: the insert fails, so the batch must roll back.
        env.DB.prepare(
          "INSERT INTO pricing_versions (status, document, published_at) VALUES ('published', NULL, datetime('now'))",
        ),
      ]),
    ).rejects.toThrow();

    const live = await env.DB.prepare(
      "SELECT version FROM pricing_versions WHERE status = 'published'",
    ).first<{ version: number }>();
    expect(live?.version).toBe(1);
  });

  it("can never have two live versions", async () => {
    for (let i = 0; i < 3; i += 1) {
      await putDraft(admin, { plans: [{ id: "pp_standard", amounts: { INR: 100000 + i } }] });
      const res = await SELF.fetch(`${BASE}/api/pricing/publish`, {
        method: "POST",
        headers: { cookie: admin },
      });
      expect(res.status).toBe(200);
    }
    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM pricing_versions WHERE status = 'published'",
    ).first<{ n: number }>();
    expect(count?.n).toBe(1);

    // A reader always sees one COMPLETE catalogue, never a fragment.
    const live = await published(admin).then((r) => r.json<PublishedPriceBook>());
    expect(live.version).toBe(4);
    expect(new Set(live.groups.map((g) => g.group))).toEqual(
      new Set(["free_trial", "subscription", "credit_pack", "enterprise"]),
    );
    expect(live.plans.length).toBeGreaterThan(0);
  });
});

describe("a publish is reversible", () => {
  it("restores the previous document as a new version and leaves the draft alone", async () => {
    const original = standardInr((await editor(admin)).published as PriceBook);

    await putDraft(admin, { plans: [{ id: "pp_standard", amounts: { INR: 500000 } }] });
    await SELF.fetch(`${BASE}/api/pricing/publish`, { method: "POST", headers: { cookie: admin } });
    expect(standardInr(await published(admin).then((r) => r.json<PublishedPriceBook>()))).toBe(500000);

    const res = await SELF.fetch(`${BASE}/api/pricing/rollback`, {
      method: "POST",
      headers: { cookie: admin },
    });
    expect(res.status).toBe(200);

    const live = await published(admin).then((r) => r.json<PublishedPriceBook>());
    expect(standardInr(live)).toBe(original);
    expect(live.version).toBe(3); // append-only history, not a resurrected row

    // The draft an administrator was working on is untouched by a rollback.
    expect(standardInr((await editor(admin)).draft)).toBe(500000);
  });

  it("refuses a rollback when there is nothing to go back to", async () => {
    const res = await SELF.fetch(`${BASE}/api/pricing/rollback`, {
      method: "POST",
      headers: { cookie: admin },
    });
    expect(res.status).toBe(409);
  });
});

describe("FX and the draft", () => {
  it("moves every derived price when a rate moves, and leaves overrides alone", async () => {
    // Standard's $12 is an override (`0047`); its GBP price is not, once cleared.
    await putDraft(admin, {
      plans: [{ id: "pp_standard", amounts: { INR: 99900 }, overrides: ["USD"] }],
      fx: [{ currency: "GBP", rate: 0.01 }],
    });
    const { draft } = await editor(admin);
    const standard = draft.plans.find((p) => p.code === "standard");
    expect(standard?.amounts.GBP).toBe(999); // 99 900 × 0.01
    expect(standard?.amounts.USD).toBe(1200); // typed, therefore kept
  });

  it("refuses to activate a currency that has no rate", async () => {
    const res = await putDraft(admin, {
      currencies: [
        { code: "INR", active: true },
        { code: "USD", active: true },
        { code: "GBP", active: true },
        { code: "EUR", active: true },
        { code: "AED", active: true },
      ],
    });
    expect(res.status).toBe(400);
    const body = await res.json<{ errors: string[] }>();
    expect(body.errors.join(" ")).toContain("AED is active but has no exchange rate");

    // …and nothing was written: the currency is still off.
    const { draft } = await editor(admin);
    expect(draft.currencies.find((c) => c.code === "AED")?.active).toBe(false);
  });

  it("accepts a currency activated together with its rate", async () => {
    const res = await putDraft(admin, {
      currencies: [{ code: "AED", active: true }],
      fx: [{ currency: "AED", rate: 0.044 }],
    });
    expect(res.status).toBe(200);
    const { draft } = await editor(admin);
    expect(draft.currencies.find((c) => c.code === "AED")?.active).toBe(true);
    expect(draft.plans.find((p) => p.code === "standard")?.amounts.AED).toBe(4396); // 99 900 × 0.044
  });
});

describe("the GST rate is configuration, not a literal", () => {
  it("stores a changed rate and publishes it", async () => {
    await putDraft(admin, { tax: { gstRatePct: 12 } });
    await SELF.fetch(`${BASE}/api/pricing/publish`, { method: "POST", headers: { cookie: admin } });
    const live = await published(admin).then((r) => r.json<PublishedPriceBook>());
    expect(live.tax.gstRatePct).toBe(12);
    expect(live.tax.gstRegistration).toBe("29ABCDE1234F1Z5");
  });

  it("refuses an impossible rate", async () => {
    const res = await putDraft(admin, { tax: { gstRatePct: 150 } });
    expect(res.status).toBe(400);
  });
});

describe("authorization", () => {
  it("403s a non-admin on every editing route", async () => {
    const associate = await login(ASSOCIATE);
    expect((await SELF.fetch(`${BASE}/api/pricing`, { headers: { cookie: associate } })).status).toBe(
      403,
    );
    expect((await putDraft(associate, { tax: { gstRatePct: 5 } })).status).toBe(403);
    expect(
      (await SELF.fetch(`${BASE}/api/pricing/publish`, { method: "POST", headers: { cookie: associate } }))
        .status,
    ).toBe(403);
    expect(
      (await SELF.fetch(`${BASE}/api/pricing/rollback`, { method: "POST", headers: { cookie: associate } }))
        .status,
    ).toBe(403);
  });

  it("lets any internal role read the live catalogue — a price is not a secret", async () => {
    const associate = await login(ASSOCIATE);
    const res = await published(associate);
    expect(res.status).toBe(200);
    const live = await res.json<PublishedPriceBook>();
    expect(live.version).toBe(1);
    // The read carries the catalogue and nothing else: no draft, no history.
    expect(Object.keys(live)).not.toContain("draft");
    expect(Object.keys(live)).not.toContain("versions");
  });

  it("turns the mentor user-type away from the catalogue entirely", async () => {
    const mentor = await login(MENTOR);
    expect((await published(mentor)).status).toBe(403);
  });

  it("401s an anonymous caller", async () => {
    expect((await SELF.fetch(`${BASE}/api/pricing/published`)).status).toBe(401);
    expect((await SELF.fetch(`${BASE}/api/pricing`)).status).toBe(401);
  });
});

describe("the audit trail", () => {
  it("records the save and the publish", async () => {
    await putDraft(admin, { plans: [{ id: "pp_pro", amounts: { INR: 249900 } }] });
    await SELF.fetch(`${BASE}/api/pricing/publish`, { method: "POST", headers: { cookie: admin } });

    const rows = await env.DB.prepare(
      "SELECT action, category, summary FROM audit_log WHERE action LIKE 'price%' ORDER BY id",
    ).all<{ action: string; category: string; summary: string }>();
    const actions = rows.results.map((r) => r.action);
    expect(actions).toContain("price_draft_saved");
    expect(actions).toContain("price_book_published");
    expect(rows.results.find((r) => r.action === "price_book_published")?.category).toBe("billing");
  });
});

describe("the draft store", () => {
  it("round-trips through loadDraft without the route", async () => {
    const book = await loadDraft(env);
    expect(book.baseCurrency).toBe("INR");
    expect(book.groups).toHaveLength(4);
    expect(book.trial).toEqual({ decks: 3, expiryDays: 0, showOnPricingPage: true });
  });
});
