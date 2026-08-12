import { test, expect, type Page } from "@playwright/test";
import { enforceWorkerCsp, watchCspViolations } from "./csp-enforce";

// Content-Security-Policy (src/server/security.ts).
//
// READ-ONLY on shared state — the suite is fullyParallel over one local D1.
// The real-PDF proof (img-src data: + worker-src blob: actually rendering
// slides) lives in upload.spec.ts, which already owns the one deck it uploads.
//
// See ./csp-enforce.ts for why the document has to be re-stamped here instead
// of asserted straight off `page.goto`.

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@firm.com").fill(email);
  await page.locator('input[type="password"]').fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/app/**");
}

test("the Worker serves the SPA document with the security headers", async ({ request }) => {
  // A plain fetch, not a navigation: in dev only this reaches the Worker (see
  // csp-enforce.ts). In production the browser's own navigation gets this same
  // response, headers included.
  const response = await request.get("/login");
  const headers = response.headers();

  expect(headers["content-type"]).toContain("text/html");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");

  const csp = headers["content-security-policy"];
  expect(csp).toBeTruthy();
  // The load-bearing trio, identical in dev and production.
  expect(csp).toContain("img-src 'self' data:");
  expect(csp).toContain("worker-src 'self' blob:");
  expect(csp).toContain("style-src 'self' 'unsafe-inline'");
  // And the lockdown half.
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("base-uri 'self'");
});

test("the API carries the hardening headers but no CSP", async ({ request }) => {
  // A CSP on a non-document response is pointless, and on the streamed PDF it
  // is actively harmful: `object-src 'none'` blanks Chrome's built-in viewer,
  // which is the deck viewer's "Open PDF" fallback. Same code path, unit-tested
  // per content-type in test/worker/security.test.ts.
  const res = await request.get("/api/health");
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");
  expect(res.headers()["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(res.headers()["content-security-policy"]).toBeUndefined();
});

test("no CSP violations on the core authed screens", async ({ page, request }) => {
  const violations = watchCspViolations(page);
  await enforceWorkerCsp(page, request);

  await login(page, "nisha.kapoor@demo.startupjury.ai"); // incubator admin

  await page.goto("/app/alldecks");
  await expect(page.getByRole("button", { name: "Export" })).toBeEnabled();

  // Charts + token-driven inline styles + the self-hosted fonts — the surfaces
  // most likely to trip a policy.
  await page.goto("/app/evaluatorscores");
  await expect(page.getByRole("heading", { name: "Evaluator scores" })).toBeVisible();
  await page.goto("/app/config");
  await expect(page.getByText("coming soon")).toHaveCount(0);

  expect(violations, `CSP violations:\n${violations.join("\n")}`).toEqual([]);
});
