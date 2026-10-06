/**
 * RATE LIMITING ON THE FOUR PUBLIC AUTH ROUTES
 * ============================================
 *
 * `plan_pilot_gcw.md` §5.3, measured: `grep -rniE "rate.?limit|throttle|turnstile|
 * captcha" src/ wrangler.jsonc` returned NOTHING, and **40 wrong-password logins
 * returned 401 forty times in 292 ms**, after which the correct password worked.
 * No lockout, no backoff, not even an audit row on failure. Against
 * `tempPassword()` — `aisj-` + 6 hex, ~24 bits, never expiring (`users.ts:111-113`)
 * — 137 guesses a second exhausts the whole keyspace in about a day and a half.
 *
 * That measurement is also why the limiter had to arrive in the same wave as the
 * public registration route: §6 calls it "a hard prerequisite, not a nicety: a
 * public POST with no limiter is a free account-creation faucet from the conference
 * wifi."
 *
 * ── WHY THIS IS IN-WORKER AND NOT A DASHBOARD WAF RULE ──────────────────────
 *
 * §5.3: "a dashboard WAF rule is not available — a `*.workers.dev` hostname has no
 * zone." The custom domain (`app.startupjury.ai`) is the same wave's deploy step and
 * a WAF rule on it is strictly better than this for volumetric abuse — but it does
 * not exist yet, it cannot see a per-EMAIL dimension, and the demo happens either
 * way. Cloudflare's native `ratelimit` binding would also be better than KV and is
 * NOT used here for one reason: it lives in `wrangler.jsonc`, which this lane does
 * not own. See the integration note at the foot of this file.
 *
 * ── TWO LAYERS, BECAUSE NEITHER ONE IS SUFFICIENT ALONE ─────────────────────
 *
 * **Layer 1 — an in-isolate counter.** A plain `Map` in module scope. It sees every
 * request this isolate handles, instantly, with no I/O and no write amplification.
 * It is the ONLY layer that reliably catches the measured attack — 40 requests in
 * 292 ms — because of what KV cannot do (below). What it cannot do is survive an
 * isolate eviction or see a sibling isolate, so an attacker who can spread requests
 * across isolates walks past it.
 *
 * **Layer 2 — a KV counter on the existing SESSIONS namespace.** Shared across
 * isolates and colos, so it is the layer that sees a distributed or sustained
 * attack. Its limits are honest ones:
 *
 *   · KV is eventually consistent, and a read-modify-write increment is not atomic.
 *     Concurrent requests read the same value and write the same successor, so the
 *     count UNDER-reports under concurrency. By design: an undercount lets a few
 *     extra requests through, an overcount locks out a real user.
 *   · Writes to one key are coalesced at roughly one per second, so a sub-second
 *     burst may register as a single increment. That is precisely the measured
 *     attack, and precisely why layer 1 exists.
 *   · `get` is given `cacheTtl: 60` explicitly rather than left to the default,
 *     so the value being read is at least STATED. A counter read through a 60 s
 *     edge cache is a 60 s window seen slightly late, which the window arithmetic
 *     below already tolerates: windows are fixed-boundary, so a stale read inside a
 *     window is a lower count in that same window, never a count from another.
 *
 * Together: layer 1 stops the burst, layer 2 stops the grind. Neither is an
 * anti-DDoS control and this file does not claim to be one.
 *
 * ── IT FAILS OPEN, DELIBERATELY ─────────────────────────────────────────────
 *
 * Every KV call is wrapped and a failure ALLOWS the request. The brief is explicit
 * and it is right: "a rate limiter that locks everyone out of a conference demo is
 * worse than the attack." Layer 1 cannot fail — it is a `Map` — so a KV outage
 * degrades to in-isolate limiting rather than to nothing.
 *
 * ── THE NUMBERS, AND WHY THE TWO DIMENSIONS ARE SO DIFFERENT ────────────────
 *
 * **Generous on IP, strict on email.** A conference room shares one NAT address, so
 * an IP is a BUILDING, not a person; an email address is an account under attack.
 *
 *   route            per IP / min   per email / min
 *   login                   300            10 (FAILURES only — see below)
 *   register                 30             3
 *   forgot-password          20             3
 *   reset-password           30            10
 *
 * The per-ADDRESS limit is the one that stops credential guessing, and it does not
 * care about the IP ceiling: 10 failed guesses a minute against one account turns
 * §5.3's measured 11.8 million guesses a day into 14,400, which takes the 24-bit
 * `tempPassword()` keyspace from about a day and a half to about three years. The IP
 * ceiling is a volumetric backstop against spraying across many addresses, so it is
 * set where it cannot plausibly catch a real user:
 *
 *   · **300 logins a minute** is far more than a room of fifty people signing in
 *     twice, and it is also measured headroom over this repo's own gates — the e2e
 *     suite runs 172 specs on 2 Playwright workers over ~3.9 min with 48 sign-in
 *     sites (~30-50 logins/min at peak), `npm run roles` opens ONE session per seed
 *     account (~18 logins for 526 cases), and `npm run smoke` does 5. A limit that
 *     reddens the gate gets raised until it does nothing, which is worse than a
 *     generous one that stays on.
 *   · **30 registrations a minute** covers an administrator walking a dozen
 *     colleagues through sign-up on a call, and still closes the faucet.
 *
 * **Login's email dimension counts FAILURES, not attempts, and a success clears
 * it.** Not a softening — it is what makes the limit deployable at all. The e2e
 * suite signs in as the same handful of seeded demo accounts across 172 specs and
 * `npm run roles` drives 526 cases; counting successful logins per email would
 * redden both suites and teach everyone to raise the limit until it did nothing. An
 * attacker gets no benefit: they have no correct password to clear the counter with.
 * This is why login's email bucket is handled by the three exported helpers rather
 * than by the middleware, which cannot know a request's outcome.
 *
 * ── WHAT IDENTIFIES A CALLER ────────────────────────────────────────────────
 *
 * `CF-Connecting-IP`, which Cloudflare sets on every request to a Worker and which
 * a client cannot forge (`X-Forwarded-For` can be, and is deliberately not read).
 * It is ABSENT under Miniflare, so in tests every caller shares the bucket
 * `ip:unspecified` — which is what lets `test/worker/registration.test.ts` drive a
 * 429 at all, and which is also the honest behaviour for any deployment where the
 * header is missing: one shared bucket, still limited, rather than silently off.
 */
import { createMiddleware } from "hono/factory";
import type { Context } from "hono";
import type { AppEnv, Env } from "../types";

/** Fixed-boundary window. 60 s is also KV's minimum `expirationTtl` granularity. */
const WINDOW_SECONDS = 60;

/** Per-route ceilings. One place, so a limit cannot be tuned in two. */
export interface RateLimitRule {
  /** Requests per window from one `CF-Connecting-IP`. A building, not a person. */
  readonly ip: number;
  /**
   * Requests per window for one email address in the body. Omit on a route whose
   * email dimension counts failures instead (login) — see the module header.
   */
  readonly email?: number;
}

export const AUTH_RATE_LIMITS: Readonly<Record<string, RateLimitRule>> = {
  // No `email` on login: its address dimension counts FAILURES and is cleared by a
  // success, which the middleware cannot see. See the module header.
  login: { ip: 300 },
  register: { ip: 30, email: 3 },
  "forgot-password": { ip: 20, email: 3 },
  "reset-password": { ip: 30, email: 10 },
};

/** How many failed logins one address may accumulate per window. */
export const LOGIN_FAILURES_PER_WINDOW = 10;

// ── Layer 1: the in-isolate counter ─────────────────────────────────────────

interface LocalCount {
  windowStart: number;
  count: number;
}

/**
 * Bucket key → count, for this isolate only.
 *
 * Bounded. An unbounded map keyed by attacker-controlled input is a memory
 * exhaustion vector, so a sweep drops expired entries whenever the map grows past
 * the cap, and if a sweep cannot get it under the cap the map is cleared outright.
 * Clearing resets counts, which fails OPEN — consistent with everything else here,
 * and it takes `MAX_LOCAL_KEYS` distinct live keys in one 60 s window to reach.
 */
const local = new Map<string, LocalCount>();
const MAX_LOCAL_KEYS = 5000;

function windowStart(now: number): number {
  return Math.floor(now / (WINDOW_SECONDS * 1000)) * (WINDOW_SECONDS * 1000);
}

function sweepLocal(start: number): void {
  for (const [k, v] of local) if (v.windowStart !== start) local.delete(k);
  if (local.size > MAX_LOCAL_KEYS) local.clear();
}

/** Increment this isolate's counter and report the count AFTER the increment. */
function bumpLocal(key: string, now: number): number {
  const start = windowStart(now);
  if (local.size >= MAX_LOCAL_KEYS) sweepLocal(start);
  const entry = local.get(key);
  if (!entry || entry.windowStart !== start) {
    local.set(key, { windowStart: start, count: 1 });
    return 1;
  }
  entry.count += 1;
  return entry.count;
}

function readLocal(key: string, now: number): number {
  const entry = local.get(key);
  return entry && entry.windowStart === windowStart(now) ? entry.count : 0;
}

function clearLocal(key: string): void {
  local.delete(key);
}

// ── Layer 2: the KV counter ─────────────────────────────────────────────────

/**
 * `rl:` keeps these out of the way of `session:` in the same namespace
 * (`auth/session.ts`). The window stamp is IN the key, so a window rolls over by
 * addressing a fresh key rather than by anybody resetting a counter — there is no
 * moment where a reset and an increment can race.
 */
function kvKey(bucket: string, subject: string, now: number): string {
  return `rl:${bucket}:${windowStart(now)}:${subject}`;
}

/** Increment in KV and report the count after it, or `null` when KV is unusable. */
async function bumpKv(env: Env, bucket: string, subject: string, now: number): Promise<number | null> {
  const key = kvKey(bucket, subject, now);
  try {
    // `cacheTtl` is stated rather than defaulted — see the module header on why a
    // stale read inside a fixed window is tolerable.
    const raw = await env.SESSIONS.get(key, { cacheTtl: WINDOW_SECONDS });
    const next = (raw === null ? 0 : Number.parseInt(raw, 10) || 0) + 1;
    // Twice the window, so the row outlives the window it counts and a clock skew
    // at the boundary cannot resurrect an expired bucket as a fresh one.
    await env.SESSIONS.put(key, String(next), { expirationTtl: WINDOW_SECONDS * 2 });
    return next;
  } catch (err) {
    // FAIL OPEN. A KV outage must not close the door on a live demo.
    console.error(`rateLimit: KV unavailable for ${bucket} — failing open:`, err);
    return null;
  }
}

/** Read the KV count without incrementing. `null` when KV is unusable. */
async function peekKv(env: Env, bucket: string, subject: string, now: number): Promise<number | null> {
  try {
    const raw = await env.SESSIONS.get(kvKey(bucket, subject, now), { cacheTtl: WINDOW_SECONDS });
    return raw === null ? 0 : Number.parseInt(raw, 10) || 0;
  } catch (err) {
    console.error(`rateLimit: KV unavailable for ${bucket} — failing open:`, err);
    return null;
  }
}

async function dropKv(env: Env, bucket: string, subject: string, now: number): Promise<void> {
  try {
    await env.SESSIONS.delete(kvKey(bucket, subject, now));
  } catch (err) {
    // A counter that could not be cleared costs the user the rest of one window.
    console.error(`rateLimit: could not clear ${bucket} counter:`, err);
  }
}

/** Seconds until the current window ends — the `Retry-After` value. */
function retryAfter(now: number): number {
  return Math.max(1, Math.ceil((windowStart(now) + WINDOW_SECONDS * 1000 - now) / 1000));
}

// ── The middleware ──────────────────────────────────────────────────────────

/**
 * `CF-Connecting-IP`, or a single shared bucket when it is absent. Never
 * `X-Forwarded-For`: a client can set that header, so reading it would hand every
 * attacker an unlimited supply of fresh buckets.
 */
function callerIp(c: Context<AppEnv>): string {
  return c.req.header("CF-Connecting-IP")?.trim() || "unspecified";
}

/**
 * The email in the body, normalised the way every write of an address in this
 * product is normalised (`.trim().toLowerCase()`) so `A@x.com` and `a@x.com` share
 * one bucket rather than two.
 *
 * Hono caches a parsed body on the request, so reading it here does not consume it
 * for the handler — `c.req.json()` in the route returns the same cached value. A
 * body that is not JSON yields no email dimension and the IP dimension still applies.
 */
async function bodyEmail(c: Context<AppEnv>): Promise<string | null> {
  const body = await c.req.json<{ email?: unknown }>().catch(() => null);
  const raw = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  return raw === "" ? null : raw;
}

function tooMany(c: Context<AppEnv>, now: number) {
  const seconds = retryAfter(now);
  return c.json({ error: "rate_limited", retryAfter: seconds }, 429, {
    "Retry-After": String(seconds),
  });
}

/**
 * Mount in front of one public auth route. `bucket` names the counter, so two
 * routes never share one: a registration attempt must not consume a login's budget.
 */
export function rateLimit(bucket: string, rule: RateLimitRule) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const now = Date.now();

    const ipSubject = `ip:${callerIp(c)}`;
    // Layer 1 first, and unconditionally: it is free, it cannot fail, and it is the
    // only one that sees a sub-second burst.
    if (bumpLocal(`${bucket}:${ipSubject}`, now) > rule.ip) return tooMany(c, now);
    const ipCount = await bumpKv(c.env, bucket, ipSubject, now);
    if (ipCount !== null && ipCount > rule.ip) return tooMany(c, now);

    if (rule.email !== undefined) {
      const email = await bodyEmail(c);
      if (email) {
        const subject = `email:${email}`;
        if (bumpLocal(`${bucket}:${subject}`, now) > rule.email) return tooMany(c, now);
        const emailCount = await bumpKv(c.env, bucket, subject, now);
        if (emailCount !== null && emailCount > rule.email) return tooMany(c, now);
      }
    }

    await next();
  });
}

// ── Login's failure counter ─────────────────────────────────────────────────
//
// Three calls instead of one middleware, because the middleware cannot know
// whether a login succeeded and the whole point of this bucket is that a success
// does not consume it. See the module header.

/** The bucket name the three helpers below share. Not a route name — a counter. */
const LOGIN_FAILURE_BUCKET = "login-failures";

/**
 * Has this address already failed too often this window? Called BEFORE the password
 * is verified, so a locked-out address does not even spend the ~8 ms of PBKDF2 —
 * which also means the 429 is faster than the 401, and that difference is about the
 * COUNTER, not about whether the account exists.
 *
 * `>=` here, where `rateLimit` uses `>`, and the asymmetry is deliberate rather than
 * an off-by-one: the middleware BUMPS and then compares, so `count > limit` means
 * "this request is the one past the limit", while this PEEKS before the attempt, so
 * `count >= limit` means "the budget is already spent". Both admit exactly `limit`
 * requests and refuse the next; `test/worker/registration.test.ts` pins the boundary
 * by counting to `LOGIN_FAILURES_PER_WINDOW` and asserting the one after it.
 */
export async function loginLockedOut(env: Env, email: string): Promise<{ locked: boolean; retryAfter: number }> {
  const now = Date.now();
  const subject = `email:${email}`;
  if (readLocal(`${LOGIN_FAILURE_BUCKET}:${subject}`, now) >= LOGIN_FAILURES_PER_WINDOW) {
    return { locked: true, retryAfter: retryAfter(now) };
  }
  const kv = await peekKv(env, LOGIN_FAILURE_BUCKET, subject, now);
  if (kv !== null && kv >= LOGIN_FAILURES_PER_WINDOW) {
    return { locked: true, retryAfter: retryAfter(now) };
  }
  return { locked: false, retryAfter: 0 };
}

/** Record one refused sign-in for this address. */
export async function recordLoginFailure(env: Env, email: string): Promise<void> {
  const now = Date.now();
  const subject = `email:${email}`;
  bumpLocal(`${LOGIN_FAILURE_BUCKET}:${subject}`, now);
  await bumpKv(env, LOGIN_FAILURE_BUCKET, subject, now);
}

/**
 * Clear the address's failure budget after a successful sign-in — which is what
 * keeps the e2e suite and the roles harness green, and what makes the limit
 * meaningful rather than merely annoying.
 */
export async function clearLoginFailures(env: Env, email: string): Promise<void> {
  const now = Date.now();
  const subject = `email:${email}`;
  clearLocal(`${LOGIN_FAILURE_BUCKET}:${subject}`);
  await dropKv(env, LOGIN_FAILURE_BUCKET, subject, now);
}

/**
 * TEST SEAM. The in-isolate map outlives a single request by construction, so a
 * suite that drives a 429 would poison every later case in the same isolate. This
 * is the only way to put it back, and it exists for `test/worker/*.test.ts` alone —
 * nothing in `src/` calls it.
 */
export function __resetLocalRateLimitState(): void {
  local.clear();
}

// ── INTEGRATION NOTE ────────────────────────────────────────────────────────
//
// `wrangler.jsonc` is not this lane's file, so the two things that want a line
// there are written down instead of done:
//
//   1. Cloudflare's native rate-limiting binding is a true atomic counter and would
//      replace layer 2 outright:
//
//        "unsafe": { "bindings": [{ "name": "AUTH_LIMITER", "type": "ratelimit",
//                                   "namespace_id": "1001",
//                                   "simple": { "limit": 120, "period": 60 } }] }
//
//      It is per-binding, so the four routes and the two dimensions need four to
//      eight of them, and `Env` (`src/server/types.ts`) grows a matching optional
//      field. Layer 1 stays either way — it is the burst layer.
//   2. Once `app.startupjury.ai` is attached, a dashboard WAF rate-limit rule on
//      `/api/auth/*` sits in FRONT of the Worker and is the right place for
//      volumetric abuse. It cannot see the email dimension, so it complements this
//      file rather than replacing it.
