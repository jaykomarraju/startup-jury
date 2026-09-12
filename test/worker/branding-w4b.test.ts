import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { brandingPatch, mergeBranding, readBranding } from "../../src/shared/branding";

/**
 * W4-B — the Branding console section, from the server's side.
 *
 * `test/worker/branding.test.ts` (W1-A) pins the route's contract: **`PUT
 * /api/config/branding` REPLACES `branding_json` wholesale**, which is why
 * every caller has to merge. That contract is deliberately unchanged here — the
 * route is the only way to REMOVE a key, and this session does not own
 * `src/server/routes/config.ts` (plan §9 carries the recommendation to move the
 * merge server-side).
 *
 * What is new is a second caller with a much larger payload — fourteen colour
 * tokens, two wordmark halves, a tagline and a logo URL — so these tests walk
 * the exact sequence `BrandingSection.save()` performs, using the same
 * `brandingPatch` / `mergeBranding` helpers the screen calls, and prove that the
 * Set up wizard's `orgName` / `orgType` come out the other side intact.
 */

const BASE = "https://example.com";
const ADMIN = "nisha.kapoor@demo.startupjury.ai"; // incubator admin
const JURY = "rajesh.kumar@demo.startupjury.ai"; // reads branding, cannot write it

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

/** Exactly what `BrandingSection.save()` does: re-read, merge, put. */
async function saveSection(cookie: string, edit: Partial<Parameters<typeof brandingPatch>[0]>) {
  const current = await summary(cookie);
  const draft = { ...readBranding(current), ...edit };
  return put(cookie, mergeBranding(current, brandingPatch(draft)));
}

describe("branding · the console section's save", () => {
  it("does not destroy orgName/orgType, even though the section never edits them", async () => {
    const admin = await login(ADMIN);
    await put(admin, { orgName: "T-Hub", orgType: "accelerator" });

    const res = await saveSection(admin, {
      wordmarkPrefix: "the",
      wordmark: "T-HUB JURY",
      tokens: { "--olive": "#2E5E4E", "--gold": "#C2185B" },
    });
    expect(res.status).toBe(200);

    const after = await summary(admin);
    expect(after).toMatchObject({
      orgName: "T-Hub",
      orgType: "accelerator",
      wordmarkPrefix: "the",
      wordmark: "T-HUB JURY",
    });
  });

  it("round-trips the whole token map, so the applier has something to read", async () => {
    const admin = await login(ADMIN);
    await saveSection(admin, {
      tagline: "Backed by data",
      logoUrl: "/brand/logo.svg",
      tokens: { "--olive": "#2E5E4E", "--gold": "#C2185B", "--purple": "#3C3489" },
    });

    const applied = readBranding(await summary(admin));
    expect(applied.tokens).toEqual({
      "--olive": "#2E5E4E",
      "--gold": "#C2185B",
      "--purple": "#3C3489",
    });
    expect(applied.tagline).toBe("Backed by data");
    expect(applied.logoUrl).toBe("/brand/logo.svg");
  });

  it("mirrors the accent into `accent`, so the older Config branding card agrees", async () => {
    const admin = await login(ADMIN);
    await saveSection(admin, { tokens: { "--gold": "#C2185B" } });
    expect(await summary(admin)).toMatchObject({ accent: "#C2185B" });
  });

  it("is readable by every role — the applier runs for jury and founders too", async () => {
    const admin = await login(ADMIN);
    await saveSection(admin, { wordmark: "T-HUB JURY" });

    const jury = await login(JURY);
    expect(readBranding(await summary(jury)).wordmark).toBe("T-HUB JURY");
    // …but only an admin may change it.
    expect((await put(jury, { wordmark: "nope" })).status).toBe(403);
  });
});
