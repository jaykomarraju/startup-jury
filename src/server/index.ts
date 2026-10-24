import { Hono } from "hono";
import type { AppEnv, Env, EvalMessage } from "./types";
import auth from "./routes/auth";
import registration from "./routes/registration"; // L2 · public sign-up + password reset
import decks from "./routes/decks";
import pipeline from "./routes/pipeline";
import config from "./routes/config";
import anchors from "./routes/anchors";
import aiPrompts from "./routes/aiPrompts"; // V3-AW · AI prompts per area + seat configurability
import crm from "./routes/crm";
import billing from "./routes/billing";
import account from "./routes/account";
import programs from "./routes/programs";
import users from "./routes/users";
import permissions from "./routes/permissions";
import analytics from "./routes/analytics";
import questions from "./routes/questions";
import audit from "./routes/audit";
import pricing from "./routes/pricing";
import resubmit from "./routes/resubmit";
import notifications from "./routes/notifications";
import signupConfig from "./routes/signup-config";
import seats from "./routes/seats"; // W6-C · purchased seats (Set up → Team)
import esign from "./esign/routes";
import signups, { esignWorkspaceGate } from "./routes/signups";
import diligence from "./routes/diligence";
import { tickets, messages, issues, help } from "./routes/support";
import { calls } from "./routes/calls";
import { assignments } from "./routes/assignments"; // W7-E · Assign: board + cross-product confirm
import { handleQueue } from "./queue";
import { runMonthlyUsageSummary, runReminders, runShortlistSweep, runStuckSweep } from "./scheduled";
import { withSecurityHeaders } from "./security";
import { rateLimit, AUTH_RATE_LIMITS } from "./middleware/rateLimit";

export type { Env } from "./types";

const app = new Hono<AppEnv>();

// Security headers on every response (`src/server/security.ts` explains the
// policy). Runs first so it wraps the SPA documents, the API and the R2 deck
// stream alike — the CSP itself is applied to HTML documents only.
app.use("*", async (c, next) => {
  await next();
  c.res = withSecurityHeaders(c.res);
});

app.get("/api/health", (c) =>
  c.json({
    status: "ok",
    service: "startup-jury",
    time: new Date().toISOString(),
  }),
);

// ── THE FOUR PUBLIC AUTH ROUTES, AND THE LIMITER IN FRONT OF THEM ───────────
//
// §5.3 measured the hole: no rate limiting anywhere in the product, and 40
// wrong-password logins answered 401 forty times in 292 ms. §6 then made a limiter a
// hard prerequisite for the public sign-up — "a public POST with no limiter is a
// free account-creation faucet from the conference wifi".
//
// Mounted path by path rather than as `/api/auth/*`, because the four limits are
// different and because `/logout` and `/me` must stay unlimited: a limiter in front
// of `/me` would throttle ordinary page loads, which is the quickest way to make
// everyone turn it off. `src/server/middleware/rateLimit.ts` has the numbers and why
// they are generous per IP and strict per address.
app.use("/api/auth/login", rateLimit("login", AUTH_RATE_LIMITS.login));
app.use("/api/auth/register", rateLimit("register", AUTH_RATE_LIMITS.register));
app.use("/api/auth/forgot-password", rateLimit("forgot-password", AUTH_RATE_LIMITS["forgot-password"]));
app.use("/api/auth/reset-password", rateLimit("reset-password", AUTH_RATE_LIMITS["reset-password"]));

app.route("/api/auth", auth);
// PUBLIC (no requireAuth): sign-up, forgot-password and reset-password. A SECOND
// router on the same prefix, which Hono supports — `app.route` registers each
// router's paths independently, so these three and `auth`'s three coexist and the
// unmatched-path 404 below is unaffected. `test/worker/registration.test.ts` asserts
// both halves still answer, because "Hono allows this" is the kind of claim that
// should be measured rather than believed.
app.route("/api/auth", registration);
app.route("/api/config", config);
app.route("/api/anchors", anchors);
app.route("/api/ai-prompts", aiPrompts); // V3-AW · Area weights → AI prompt + Seat configurability
app.route("/api/crm", crm);
app.route("/api/billing", billing);
app.route("/api/account", account); // W6-B · My account — the purchase wizard
app.route("/api/programs", programs);
app.route("/api/users", users);
app.route("/api/permissions", permissions);
app.route("/api/analytics", analytics);
app.route("/api/questions", questions);
app.route("/api/audit", audit);
app.route("/api/pricing", pricing);
app.route("/api/notifications", notifications);
app.route("/api/signup-config", signupConfig);
app.use("/api/esign/signups/:signupId/*", esignWorkspaceGate); // W6-A · §8.3 PM assignment gate
app.route("/api/seats", seats);
app.route("/api/esign", esign); // W5-B · agreements library, signatories, signing method
app.route("/api/signups", signups); // W6-A · the three-tab sign-up workspace
app.route("/api/diligence", diligence); // W9-C · VC diligence checklists, deal record, term sheet
app.route("/api/tickets", tickets);
app.route("/api/issues", issues);
app.route("/api/messages", messages);
app.route("/api/help", help); // V3 item 15 · JURYbuddy FAQ clips (R2)
app.route("/api/calls", calls);
app.route("/api/assignments", assignments);
app.route("/api/decks", decks);
// PUBLIC (no requireAuth): the tokenized founder resubmit loop. The link in the
// Incomplete-deck email is the credential — see src/server/routes/resubmit.ts.
app.route("/api/resubmit", resubmit);
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
  // Cron Triggers (wrangler.jsonc `triggers.crons`). Two schedules with
  // different jobs, so the handler branches on `controller.cron`:
  //   "0 8 * * *"    — daily evaluator reminders.
  //   "*/10 * * * *" — re-drive decks stranded at `pending_ai` (§9). It runs
  //                    often because a stranded deck is invisible to its
  //                    uploader until something picks it back up. Since 23-Oct
  //                    it also re-applies the shortlist criteria
  //                    (`runShortlistSweep`), for the same reason: a deck that
  //                    meets them and is not moved is invisible to the Sign up
  //                    Pipeline.
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    // W3-B rides the daily schedule rather than adding a third cron: the
    // monthly digest is made monthly by its dedupe key (see `scheduled.ts`), so
    // thirty of every thirty-one runs are no-ops.
    if (controller.cron === "0 8 * * *")
      ctx.waitUntil(Promise.all([runReminders(env), runMonthlyUsageSummary(env)]));
    else ctx.waitUntil(Promise.all([runStuckSweep(env), runShortlistSweep(env)]));
  },
} satisfies ExportedHandler<Env, EvalMessage>;
