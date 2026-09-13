import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

/**
 * W9-D — the six VC report routes' role gates, each with a role the nav manifest
 * allows AND one it does not. `guard(slug)` delegates to `canAccessNav`, so these
 * pin the manifest's report rows as the API sees them: a report a role cannot
 * reach in the sidebar must 403, not merely disappear.
 *
 * The prototype grants the analyst all six reports and the IC member everything
 * but the funnel (`AISJ_VC_Analyst_V1/_sidebar.html` / `AISJ_VC_IC_member_V2`);
 * the manifest grants the analyst Scoring Summary only. That is a §9 request to
 * `nav.ts`'s owner (F0796) — when it lands, the analyst's 403s below flip to 200
 * and this file is the one to update, deliberately.
 */

const BASE = "https://example.com";
const VC = {
  superuser: "aarav.khanna@demo.startupjury.ai",
  admin: "nisha.kapoor.vc@demo.startupjury.ai",
  partner: "ishaan.sethi@demo.startupjury.ai",
  ic_member: "rajesh.kumar.vc@demo.startupjury.ai",
  associate: "sunita.rao.vc@demo.startupjury.ai",
  analyst: "rhea.nair@demo.startupjury.ai",
} as const;
const INC_ADMIN = "nisha.kapoor@demo.startupjury.ai";

const cookies = new Map<string, string>();
async function login(email: string): Promise<string> {
  const hit = cookies.get(email);
  if (hit) return hit;
  const res = await SELF.fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "demo1234" }),
  });
  expect(res.status).toBe(200);
  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
  cookies.set(email, cookie);
  return cookie;
}

const status = async (path: string, email: string) =>
  (await SELF.fetch(`${BASE}/api/analytics/${path}`, { headers: { cookie: await login(email) } })).status;

type VcRole = keyof typeof VC;

const GATES: Array<{ path: string; allowed: VcRole[]; forbidden: VcRole[] }> = [
  { path: "funnel", allowed: ["superuser", "admin", "partner", "associate"], forbidden: ["ic_member", "analyst"] },
  { path: "capital", allowed: ["superuser", "admin", "partner", "ic_member", "associate"], forbidden: ["analyst"] },
  { path: "portfolio", allowed: ["superuser", "admin", "partner", "ic_member", "associate"], forbidden: ["analyst"] },
  { path: "scoring", allowed: ["superuser", "admin", "partner", "ic_member", "associate", "analyst"], forbidden: [] },
  { path: "diligence", allowed: ["superuser", "admin", "partner", "ic_member", "associate"], forbidden: ["analyst"] },
  { path: "decisions", allowed: ["superuser", "admin", "partner", "ic_member", "associate"], forbidden: ["analyst"] },
];

describe("VC report routes — who may read each one", () => {
  for (const g of GATES) {
    it(`/${g.path}: ${g.allowed.join(", ")} → 200; ${g.forbidden.length ? `${g.forbidden.join(", ")} → 403` : "no VC role forbidden"}`, async () => {
      for (const role of g.allowed) expect({ role, status: await status(g.path, VC[role]) }).toEqual({ role, status: 200 });
      for (const role of g.forbidden) expect({ role, status: await status(g.path, VC[role]) }).toEqual({ role, status: 403 });
    });

    it(`/${g.path}: another edition's admin → 403`, async () => {
      // `/funnel` is the one slug both editions share, so the incubator admin reads their OWN funnel there.
      expect(await status(g.path, INC_ADMIN)).toBe(g.path === "funnel" ? 200 : 403);
    });
  }

  it("the pre-rebuild payloads the screens read still carry every field they render", async () => {
    const cookie = await login(VC.admin);
    const body = async (p: string) =>
      (await (await SELF.fetch(`${BASE}/api/analytics/${p}`, { headers: { cookie } })).json()) as Record<string, unknown>;
    expect(Object.keys(await body("funnel"))).toEqual(expect.arrayContaining(["rows", "top", "bottom", "biggestStepDrop"]));
    expect(Object.keys(await body("capital"))).toEqual(
      expect.arrayContaining(["committed", "deployed", "dryPowder", "deployedPct", "companies", "byCompany"]),
    );
    expect(Object.keys(await body("portfolio"))).toEqual(
      expect.arrayContaining(["companies", "medianCheck", "sectors", "sectorMix", "stageMix", "geoMix"]),
    );
    expect(Object.keys(await body("scoring"))).toEqual(
      expect.arrayContaining(["rows", "avgScore", "dealsScored", "evaluators", "avgVariance"]),
    );
    expect(Object.keys(await body("diligence"))).toEqual(
      expect.arrayContaining(["inDiligence", "redFlags", "clarifications", "onTrack", "items", "flags"]),
    );
    expect(Object.keys(await body("decisions"))).toEqual(expect.arrayContaining(["rows", "total", "invest", "pass", "revisit"]));
    // The funnel's stage labels the screen keys its hues by.
    const funnel = (await body("funnel")) as { rows: Array<{ label: string }> };
    expect(funnel.rows.map((r) => r.label)).toEqual(["Sourced", "Screened", "Partner call", "Diligence", "IC review", "Term sheet", "Closed"]);
  });
});
