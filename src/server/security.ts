/**
 * Security response headers — Content-Security-Policy and friends.
 *
 * FINISH-PLAN §6 (Session 8) audited the client and found it genuinely
 * CSP-clean: no CDN, no external font (DM Sans/DM Mono are bundled by
 * `@fontsource`), no remote image, no `eval`, no `dangerouslySetInnerHTML`, and
 * a **self-hosted** pdf.js worker. The header itself was deliberately left for a
 * follow-up because getting it wrong blanks the deck viewer on the main demo
 * path. This is that follow-up.
 *
 * Three directives are load-bearing and must not be tightened without opening a
 * deck with a real PDF in a browser afterwards — the e2e suite will NOT catch a
 * blanked viewer:
 *
 *   img-src    'self' data:  — `DeckPdfViewer` renders each page to a canvas and
 *                              stores it as a `data:` URL (`canvas.toDataURL`).
 *   worker-src 'self' blob:  — pdf.js spawns its worker from a same-origin asset
 *                              URL (Vite `?url` import); `blob:` covers pdf.js's
 *                              own fallback path, which builds the worker from a
 *                              Blob when it can't use the URL directly.
 *   style-src  'unsafe-inline' — the design system drives token-driven inline
 *                              `style={{…}}` (score bars, KPI tiles, charts)
 *                              throughout, and Vite injects <style> tags in dev.
 *
 * The policy is applied to **HTML documents only** (see `withSecurityHeaders`).
 * Chrome renders a top-level PDF through a plugin document, and a CSP carrying
 * `object-src 'none'` on that response blanks it — which would break the deck
 * viewer's "Open PDF" fallback link.
 */

declare global {
  interface ImportMeta {
    /**
     * Injected by Vite. `true` under `npm run dev` / `npm run e2e:serve`,
     * absent-or-false in the deployed Worker bundle — so if the injection ever
     * stops working the policy fails **closed** (strict), never open.
     */
    readonly env?: { readonly DEV?: boolean };
  }
}

/** True only when this Worker is running inside the Vite dev server. */
export const IS_DEV: boolean = import.meta.env?.DEV === true;

/**
 * Directives that are identical in dev and production. Everything the deck
 * viewer depends on lives here on purpose, so `npm run test:e2e` — which runs
 * against the dev server — exercises the real policy for those.
 */
const SHARED_DIRECTIVES = [
  "default-src 'self'",
  "base-uri 'self'",
  // No <object>/<embed>/<iframe> anywhere in the client.
  "object-src 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  // data: is the deck viewer's rendered pages; /favicon.png is 'self'.
  "img-src 'self' data:",
  // @fontsource woff/woff2, emitted into /assets by the build.
  "font-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "worker-src 'self' blob:",
];

/**
 * Builds the policy. `dev` relaxes exactly two directives, both of which are
 * artefacts of the Vite dev server and cannot occur in the built bundle:
 *
 *   script-src 'unsafe-inline' — @vitejs/plugin-react injects the React Refresh
 *                                preamble as an inline module script. The
 *                                production `index.html` has **no** inline
 *                                script at all (verified in `dist/client`).
 *   connect-src ws: wss:       — the HMR socket.
 *
 * Which means `script-src 'self'` is the one directive e2e cannot prove. It is
 * covered by opening the deployed app in a browser and watching the console.
 */
export function contentSecurityPolicy(dev: boolean = IS_DEV): string {
  return [
    ...SHARED_DIRECTIVES,
    dev ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
    dev ? "connect-src 'self' ws: wss:" : "connect-src 'self'",
  ].join("; ");
}

/**
 * Returns `res` with the security headers added.
 *
 * `nosniff` + `Referrer-Policy` go on every response; **CSP goes on HTML
 * documents only** (see the header comment — a CSP on the streamed PDF blanks
 * Chrome's built-in viewer). A `101` is passed through untouched because
 * re-wrapping a Response drops its `webSocket`.
 *
 * The HTML document is also marked `no-store`. Found the hard way: the first
 * deploy of this header changed only the Worker, not the asset bundle, so
 * Cloudflare's edge kept serving browsers a pre-deploy `index.html` —
 * `cf-cache-status: HIT`, no CSP — while a plain `curl`, a different cache
 * variant, got the fresh one. The SPA shell is the one asset that should never
 * be cached anyway: it names the hashed `/assets/*` bundles, so a stale copy
 * points at files a later deploy has already removed.
 *
 * ⚠️ Two things to know about that fix:
 *   1. The real guarantee is `assets.run_worker_first` in `wrangler.jsonc` —
 *      without it a navigation can be answered by the asset layer and never
 *      reach this code at all. Do not remove one without the other.
 *   2. Cloudflare's asset layer **rewrites** this `Cache-Control` at the edge
 *      back to `public, max-age=0, must-revalidate`; only the local/dev
 *      response shows `no-store` verbatim. That is still revalidate-on-every-
 *      navigation, so the intent holds — but don't "fix" the smoke assertion
 *      by expecting `no-store` from production.
 */
export function withSecurityHeaders(res: Response, dev: boolean = IS_DEV): Response {
  if (res.status === 101) return res;

  const out = new Response(res.body, res);
  out.headers.set("X-Content-Type-Options", "nosniff");
  out.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

  if ((out.headers.get("content-type") ?? "").includes("text/html")) {
    out.headers.set("Content-Security-Policy", contentSecurityPolicy(dev));
    out.headers.set("Cache-Control", "no-store");
  }
  return out;
}
