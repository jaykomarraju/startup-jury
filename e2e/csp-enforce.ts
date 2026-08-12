import type { Page, APIRequestContext } from "@playwright/test";

// Not a spec (no `.spec.ts`) — a helper the CSP-aware specs share.

/**
 * Make the browser enforce the CSP the Worker actually produces.
 *
 * **Why this is needed.** `npm run e2e:serve` is the Vite dev server, and
 * `@cloudflare/vite-plugin` short-circuits navigation requests — anything with
 * `Sec-Fetch-Dest: document`, hence the `Vary: Sec-Fetch-Dest` it sets — into
 * Vite's own HTML pipeline so HMR keeps working. The Worker's fetch handler
 * never runs for the document, so in dev the SPA page arrives with **no**
 * headers at all. In production `app.all("*")` serves that document through the
 * Worker and it carries the policy.
 *
 * Left alone, that means every browser-level CSP assertion in this suite would
 * pass vacuously — exactly the "green suite, blanked deck viewer" trap the
 * header was held back for. So: ask the Worker for the real policy over a
 * non-navigation fetch (which does reach it), then stamp it onto the document
 * response. From there Chromium enforces it for real.
 *
 * ⚠️ The policy this returns is the **dev** one, which relaxes `script-src`
 * (Vite injects the React Refresh preamble inline) and `connect-src` (HMR
 * socket). Everything the deck viewer depends on — `img-src 'self' data:`,
 * `worker-src 'self' blob:`, `style-src 'unsafe-inline'`, `font-src 'self'` —
 * is byte-identical to production and IS enforced here. `script-src 'self'` is
 * the one directive only the deployed app can prove.
 */
export async function enforceWorkerCsp(
  page: Page,
  request: APIRequestContext,
): Promise<string> {
  const probe = await request.get("/login");
  const csp = probe.headers()["content-security-policy"];
  if (!csp) {
    throw new Error(
      "the Worker served no Content-Security-Policy — see src/server/security.ts",
    );
  }

  await page.route("**/*", async (route) => {
    // Documents only; re-fetching every asset through the proxy would be slow
    // and pointless (a CSP applies per document, not per subresource).
    if (route.request().resourceType() !== "document") return route.fallback();
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: { ...response.headers(), "content-security-policy": csp },
    });
  });

  return csp;
}

/**
 * Collects the browser's own CSP violation reports. Chromium logs a blocked
 * resource as a console error ("Refused to load …"), which is the only signal
 * a headless run gets.
 */
export function watchCspViolations(page: Page): string[] {
  const violations: string[] = [];
  page.on("console", (msg) => {
    const text = msg.text();
    if (/Content Security Policy|Refused to (load|execute|apply|connect)/i.test(text)) {
      violations.push(text);
    }
  });
  return violations;
}
