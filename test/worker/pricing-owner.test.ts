import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";

/**
 * The price catalogue is a PLATFORM-OWNER surface, and until 24-Sep-2026 it was
 * gated as a customer one.
 *
 * `migrations/0033_price_configuration.sql:6-7` already called it "a
 * PLATFORM-OWNER surface … one catalogue serves the whole product", and the
 * client said the same thing in his own words: *"this has to be in AISJ Admin
 * control, NOT the client admin."* The gate said otherwise. Verified against
 * PRODUCTION before the fix: `GET /api/pricing` returned 200 with all 24 plans,
 * the working draft and the full version history to `nisha.kapoor@…`, an
 * incubator ADMIN — and the router carries no scope predicate of any kind
 * (`grep -c edition src/server/routes/pricing.ts` → 0), so that principal could
 * publish a catalogue that serves every customer of the product.
 *
 * The real AISJ Admin role arrives with multi-tenancy (`docs/plan_myaccount.md`
 * §10). Until then the owner is a deployment fact — `PLATFORM_OWNER_EMAILS` —
 * and the point of these tests is that the gate turns on IDENTITY, not on role:
 * being an admin is necessary and no longer sufficient.
 *
 * The configured owner for this project is `nisha.kapoor@…` (see
 * `vitest.worker.config.ts`), which is why the sibling `pricing.test.ts` still
 * exercises the editor. Every principal below is deliberately NOT that address.
 */

const BASE = "https://example.com";
const OWNER = "nisha.kapoor@demo.startupjury.ai"; //     the configured platform owner
const VC_ADMIN = "nisha.kapoor.vc@demo.startupjury.ai"; // an admin, not the owner
const SUPERUSER = "priya.sharma@demo.startupjury.ai"; //  the top customer role, not the owner
const ASSOCIATE = "sunita.rao@demo.startupjury.ai"; //    no console permission at all

async function login(email: string): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "demo1234" }),
  });
  const setCookie = res.headers.get("set-cookie");
  return setCookie ? setCookie.split(";")[0] : "";
}

const get = (path: string, cookie: string) => SELF.fetch(`${BASE}${path}`, { headers: { cookie } });

describe("the price catalogue is the platform owner's, not the customer's", () => {
  it("lets the configured owner read the editor", async () => {
    const res = await get("/api/pricing", await login(OWNER));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { draft?: unknown; published?: unknown };
    // Not just a 200 — the editor payload, which is what leaked.
    expect(body.draft).toBeDefined();
    expect(body.published).toBeDefined();
  });

  it("refuses an admin who is not the owner — the exact production defect", async () => {
    const cookie = await login(VC_ADMIN);
    // Being an admin with the console permission got you the whole catalogue.
    expect((await get("/api/pricing", cookie)).status).toBe(403);
  });

  it("refuses the customer's SUPERUSER too, because role is not the question", async () => {
    expect((await get("/api/pricing", await login(SUPERUSER))).status).toBe(403);
  });

  it("still refuses a role that never had the console permission", async () => {
    expect((await get("/api/pricing", await login(ASSOCIATE))).status).toBe(403);
  });

  it("refuses every WRITE on the catalogue, not just the read", async () => {
    const cookie = await login(VC_ADMIN);
    const draft = await SELF.fetch(`${BASE}/api/pricing/draft`, {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ plans: [] }),
    });
    expect(draft.status).toBe(403);
    // Publish is the dangerous one: it supersedes the live version for everyone.
    const publish = await SELF.fetch(`${BASE}/api/pricing/publish`, { method: "POST", headers: { cookie } });
    expect(publish.status).toBe(403);
    const rollback = await SELF.fetch(`${BASE}/api/pricing/rollback`, { method: "POST", headers: { cookie } });
    expect(rollback.status).toBe(403);
  });

  it("leaves the PUBLISHED catalogue readable — every price screen calls it", async () => {
    // The gate is on editing, not on reading the live prices. Buy credits and
    // My Account would both go dark if this moved.
    for (const who of [VC_ADMIN, SUPERUSER, ASSOCIATE]) {
      const res = await get("/api/pricing/published", await login(who));
      expect(res.status, who).toBe(200);
    }
  });

  it("a publish refused by the gate does not move the live version", async () => {
    const before = await (await get("/api/pricing/published", await login(OWNER))).json();
    await SELF.fetch(`${BASE}/api/pricing/publish`, { method: "POST", headers: { cookie: await login(VC_ADMIN) } });
    const after = await (await get("/api/pricing/published", await login(OWNER))).json();
    // The assertion that matters: the refusal is not merely a status code.
    expect(after).toEqual(before);
  });

  it("fails CLOSED when no owner is configured", async () => {
    const saved = env.PLATFORM_OWNER_EMAILS;
    try {
      (env as { PLATFORM_OWNER_EMAILS?: string }).PLATFORM_OWNER_EMAILS = "";
      // A deployment that forgets the var must not hand the catalogue to
      // whoever asks first — including the principal who normally owns it.
      expect((await get("/api/pricing", await login(OWNER))).status).toBe(403);
    } finally {
      (env as { PLATFORM_OWNER_EMAILS?: string }).PLATFORM_OWNER_EMAILS = saved;
    }
  });

  it("matches the owner case-insensitively, and ignores spacing in the list", async () => {
    const saved = env.PLATFORM_OWNER_EMAILS;
    try {
      (env as { PLATFORM_OWNER_EMAILS?: string }).PLATFORM_OWNER_EMAILS =
        ` someone@else.example ,  ${OWNER.toUpperCase()} `;
      expect((await get("/api/pricing", await login(OWNER))).status).toBe(200);
    } finally {
      (env as { PLATFORM_OWNER_EMAILS?: string }).PLATFORM_OWNER_EMAILS = saved;
    }
  });
});
