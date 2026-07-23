import { Hono } from "hono";
import type { AppEnv, Env, EvalMessage } from "./types";
import auth from "./routes/auth";
import decks from "./routes/decks";
import pipeline from "./routes/pipeline";
import config from "./routes/config";
import analytics from "./routes/analytics";
import { tickets, messages } from "./routes/support";
import { handleQueue } from "./queue";
import { runReminders } from "./scheduled";

export type { Env } from "./types";

const app = new Hono<AppEnv>();

app.get("/api/health", (c) =>
  c.json({
    status: "ok",
    service: "startup-jury",
    time: new Date().toISOString(),
  }),
);

app.route("/api/auth", auth);
app.route("/api/config", config);
app.route("/api/analytics", analytics);
app.route("/api/tickets", tickets);
app.route("/api/messages", messages);
app.route("/api/decks", decks);
// Workflow endpoints (transitions, assign, jury scoring, queries, signup,
// audit, lookups). Mounted at /api so it can own /queries, /jury, /parameters
// alongside its /decks/:id/* actions.
app.route("/api", pipeline);

// Unknown API routes return JSON 404 (never the SPA) so client `response.json()`
// fails loudly instead of silently parsing index.html.
app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));

// Any non-API route falls through to the SPA. `not_found_handling:
// single-page-application` makes the ASSETS binding return index.html for
// unmatched paths, so client-side routing works.
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

// Worker with both an HTTP handler (SPA + API) and a Queue consumer (bulk
// evaluation). The single-upload path evaluates inline in the request.
export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<EvalMessage>, env: Env) {
    await handleQueue(batch, env);
  },
  // Cron Trigger (wrangler.jsonc `triggers.crons`): sweep for evaluators with
  // decks still awaiting their score and send stubbed reminder emails.
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runReminders(env));
  },
} satisfies ExportedHandler<Env, EvalMessage>;
