import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { contentSecurityPolicy, withSecurityHeaders } from "../../src/server/security";

// This file lives under the WORKER tsconfig: security.ts builds a `Response`,
// which needs the workers runtime, and the SELF.fetch case exercises the
// middleware wired into src/server/index.ts.
//
// Every policy assertion passes `dev` EXPLICITLY. The default comes from
// `import.meta.env.DEV`, which Vite sets true under vitest and false in the
// deployed bundle — so an implicit default here would assert the dev policy
// while claiming to test production.

/** Directive value for `name`, e.g. cspOf(p, "img-src") === "'self' data:". */
function cspOf(policy: string, name: string): string | undefined {
  const found = policy
    .split(";")
    .map((d) => d.trim())
    .find((d) => d === name || d.startsWith(`${name} `));
  return found === undefined ? undefined : found.slice(name.length).trim();
}

describe("contentSecurityPolicy", () => {
  const prod = contentSecurityPolicy(false);
  const dev = contentSecurityPolicy(true);

  it("keeps the three directives the deck viewer depends on", () => {
    // Tightening any of these blanks DeckPdfViewer, and the e2e suite alone
    // will not catch it — see src/server/security.ts.
    for (const policy of [prod, dev]) {
      // canvas.toDataURL() per rendered page.
      expect(cspOf(policy, "img-src")).toBe("'self' data:");
      // pdf.js worker: self-hosted asset URL, blob: for its fallback path.
      expect(cspOf(policy, "worker-src")).toBe("'self' blob:");
      // Token-driven style={{…}} throughout the design system.
      expect(cspOf(policy, "style-src")).toBe("'self' 'unsafe-inline'");
      // Self-hosted @fontsource woff/woff2 — no external font host.
      expect(cspOf(policy, "font-src")).toBe("'self'");
    }
  });

  it("locks down the directives that have no legitimate use here", () => {
    for (const policy of [prod, dev]) {
      expect(cspOf(policy, "default-src")).toBe("'self'");
      expect(cspOf(policy, "base-uri")).toBe("'self'");
      expect(cspOf(policy, "object-src")).toBe("'none'");
      expect(cspOf(policy, "frame-src")).toBe("'none'");
      expect(cspOf(policy, "frame-ancestors")).toBe("'none'");
      expect(cspOf(policy, "form-action")).toBe("'self'");
    }
  });

  it("production allows no inline script and no off-origin connection", () => {
    expect(cspOf(prod, "script-src")).toBe("'self'");
    expect(cspOf(prod, "connect-src")).toBe("'self'");
    expect(prod).not.toContain("unsafe-eval");
    // 'unsafe-inline' must appear for styles only, never for scripts.
    expect(prod.match(/'unsafe-inline'/g)).toHaveLength(1);
  });

  it("dev relaxes ONLY script-src and connect-src (Vite preamble + HMR socket)", () => {
    expect(cspOf(dev, "script-src")).toBe("'self' 'unsafe-inline'");
    expect(cspOf(dev, "connect-src")).toBe("'self' ws: wss:");

    const shared = (policy: string) =>
      policy
        .split(";")
        .map((d) => d.trim())
        .filter((d) => !d.startsWith("script-src") && !d.startsWith("connect-src"));
    expect(shared(dev)).toEqual(shared(prod));
  });
});

describe("withSecurityHeaders", () => {
  it("adds the CSP to HTML documents", () => {
    const res = withSecurityHeaders(
      new Response("<!doctype html><html></html>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
      false,
    );
    expect(res.headers.get("content-security-policy")).toBe(contentSecurityPolicy(false));
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    // Without this the edge cached a pre-deploy index.html and browsers never
    // saw the CSP at all — see the note on withSecurityHeaders.
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("does NOT put a CSP on the streamed PDF", () => {
    // Chrome renders a top-level PDF through a plugin document, and a CSP
    // carrying `object-src 'none'` on that response blanks it — which would
    // break the deck viewer's "Open PDF" fallback link. Regression guard.
    const res = withSecurityHeaders(
      new Response("%PDF-1.4", { headers: { "content-type": "application/pdf" } }),
      false,
    );
    expect(res.headers.get("content-security-policy")).toBeNull();
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    // And no-store is HTML-only — the deck stream keeps whatever R2 set.
    expect(res.headers.get("cache-control")).toBeNull();
  });

  it("does not put a CSP on JSON, but still hardens it", () => {
    const res = withSecurityHeaders(
      new Response("{}", { headers: { "content-type": "application/json" } }),
      false,
    );
    expect(res.headers.get("content-security-policy")).toBeNull();
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("preserves status, body and existing headers", async () => {
    const res = withSecurityHeaders(
      new Response("nope", {
        status: 404,
        headers: { "content-type": "text/html", "x-thing": "kept" },
      }),
      false,
    );
    expect(res.status).toBe(404);
    expect(res.headers.get("x-thing")).toBe("kept");
    expect(await res.text()).toBe("nope");
  });

  it("passes a 101 through untouched (re-wrapping would drop the socket)", () => {
    // Only the runtime can mint a real 101 (the Response constructor rejects
    // the status outright — it comes back from a WebSocket upgrade, e.g. the
    // Vite HMR socket proxied through ASSETS.fetch), so assert on the branch:
    // the exact object is returned, never re-wrapped.
    const upgrade = { status: 101 } as Response;
    expect(withSecurityHeaders(upgrade, false)).toBe(upgrade);
  });
});

describe("the middleware is actually wired into the app", () => {
  it("hardens an API response", async () => {
    const res = await SELF.fetch("https://example.com/api/health");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    // JSON, so no CSP — but the shared directives are asserted above and the
    // document response is asserted in e2e/csp.spec.ts against a real browser.
    expect(res.headers.get("content-security-policy")).toBeNull();
  });
});

// ── AuthZ: the mentor user-type ──────────────────────────────────────────────
// Session 4 resolved `mentor` as a DIRECTORY user-type, not a role: it appears
// in no authZ list and no nav manifest, so `requireRole` refuses it everywhere
// a role list is named. The surfaces below name none — they only asked for an
// authenticated user — so before `denyMentor` a signed-in mentor could read the
// whole deck pipeline. `npm run roles` asserts the same six as a live probe.

describe("the mentor user-type reaches no pipeline surface", () => {
  const MENTOR = "anil.mehta@demo.startupjury.ai"; // seeded incubator mentor

  async function mentorCookie(): Promise<string> {
    const res = await SELF.fetch("https://example.com/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: MENTOR, password: "demo1234" }),
    });
    expect(res.status).toBe(200); // a mentor still holds a valid session
    return (res.headers.get("set-cookie") ?? "").split(";")[0];
  }

  it("is refused on every read that only required a session", async () => {
    const cookie = await mentorCookie();
    for (const path of [
      "/api/decks",
      "/api/programs",
      "/api/parameters",
      "/api/issues",
      "/api/calls",
    ]) {
      const res = await SELF.fetch(`https://example.com${path}`, { headers: { cookie } });
      expect([path, res.status]).toEqual([path, 403]);
    }
  });

  it("is refused before the handler validates a write body", async () => {
    // 403, not the 400 an empty body would otherwise earn: the gate runs first.
    const res = await SELF.fetch("https://example.com/api/issues", {
      method: "POST",
      headers: { cookie: await mentorCookie(), "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(403);
  });
});
