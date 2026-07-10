import { Hono } from "hono";

export interface Env {
  ASSETS: Fetcher;
  // D1/R2/KV/Queue bindings are added in later phases.
}

const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (c) =>
  c.json({
    status: "ok",
    service: "startup-jury",
    time: new Date().toISOString(),
  }),
);

// Unknown API routes return JSON 404 (never the SPA) so client `response.json()`
// fails loudly instead of silently parsing index.html.
app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));

// Any non-API route falls through to the SPA. `not_found_handling:
// single-page-application` makes the ASSETS binding return index.html for
// unmatched paths, so client-side routing works.
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
