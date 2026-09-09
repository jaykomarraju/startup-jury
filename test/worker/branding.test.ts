import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

/**
 * W1-A — the §1.5 branding-wipe defect.
 *
 * `PUT /api/config/branding` replaces `branding_json` WHOLESALE. That is the
 * route's contract and it is not being changed here; what was broken was the
 * caller: `BrandingSection.save()` posted only `{wordmark, tagline, accent}`,
 * so every branding save silently dropped the `orgName` / `orgType` the Set up
 * wizard had written — which the account screen and the founder resubmit email
 * both read back.
 *
 * These tests pin both halves: the replace semantics that make the merge
 * necessary, and the read-then-merge sequence the client now performs.
 */

const BASE = "https://example.com";
const ADMIN = "nisha.kapoor@demo.startupjury.ai"; // incubator admin
const PA = "sunita.rao@demo.startupjury.ai"; // program_associate — not an admin

async function login(email: string): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "demo1234" }),
  });
  const setCookie = res.headers.get("set-cookie");
  return setCookie ? setCookie.split(";")[0] : "";
}

function put(cookie: string, branding: Record<string, unknown>) {
  return SELF.fetch(`${BASE}/api/config/branding`, {
    method: "PUT",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ branding }),
  });
}

async function summary(cookie: string): Promise<Record<string, unknown>> {
  const res = await SELF.fetch(`${BASE}/api/config/summary`, { headers: { cookie } });
  const body = await res.json<{ branding: Record<string, unknown> }>();
  return body.branding;
}

describe("branding save", () => {
  it("replaces branding_json wholesale — which is why the client must merge", async () => {
    const admin = await login(ADMIN);
    await put(admin, { orgName: "Nasscom Foundation", orgType: "incubator", wordmark: "NF" });
    expect(await summary(admin)).toMatchObject({ orgName: "Nasscom Foundation" });

    // A partial POST — what ConfigPage used to send — loses the wizard's fields.
    await put(admin, { wordmark: "NF2", tagline: "T", accent: "#E8A020" });
    const after = await summary(admin);
    expect(after.wordmark).toBe("NF2");
    expect(after.orgName).toBeUndefined();
  });

  it("preserves orgName/orgType when the caller reads and merges first", async () => {
    const admin = await login(ADMIN);
    await put(admin, {
      orgName: "T-Hub",
      orgType: "accelerator",
      wordmark: "STARTUPJURY",
      tagline: "Venture Intelligence First",
      accent: "#E8A020",
    });

    // Exactly the sequence BrandingSection.save() now performs: re-read the
    // current branding, spread it, then overwrite only the three fields the
    // card edits.
    const current = await summary(admin);
    const res = await put(admin, {
      ...current,
      wordmark: "T-HUB JURY",
      tagline: "Backed by data",
      accent: "#6B8454",
    });
    expect(res.status).toBe(200);

    const after = await summary(admin);
    expect(after).toMatchObject({
      orgName: "T-Hub",
      orgType: "accelerator",
      wordmark: "T-HUB JURY",
      tagline: "Backed by data",
      accent: "#6B8454",
    });
  });

  it("is admin-only", async () => {
    const pa = await login(PA);
    const res = await put(pa, { wordmark: "nope" });
    expect(res.status).toBe(403);
  });
});
